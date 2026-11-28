import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type {
  CartItem,
  Customer,
  InventoryItem,
  MemberTier,
  MembershipTierRule,
  OrderRecord,
} from '../types';
import { computeTierBySpend } from '../utils/membershipProgram';
import { generateCollisionRetryOrderNumber } from '../utils/orderNumber';

export interface StockDeductionSummary {
  inventoryItemId: string;
  itemName: string;
  unit: string;
  quantityDeducted: number;
  remainingStock: number;
}

/**
 * Pure function: calculates total raw material / packaging deductions from cart items
 * based on each menu item's Bill of Materials (menu_recipes).
 */
export function computeRecipeStockDeductions(
  cartItems: CartItem[],
  inventory: InventoryItem[]
): {
  deductionsMap: Map<string, number>;
  updatedInventory: InventoryItem[];
  summary: StockDeductionSummary[];
} {
  const deductionsMap = new Map<string, number>();

  for (const cartItem of cartItems) {
    for (const recipe of cartItem.menu.recipes) {
      const prev = deductionsMap.get(recipe.inventory_item_id) ?? 0;
      const next = Number((prev + recipe.quantity_needed * cartItem.quantity).toFixed(2));
      deductionsMap.set(recipe.inventory_item_id, next);
    }
  }

  const nowIso = new Date().toISOString();
  const summary: StockDeductionSummary[] = [];

  const updatedInventory = inventory.map((inv) => {
    const used = deductionsMap.get(inv.id);
    if (!used) return inv;
    const remaining = Math.max(0, Number((inv.current_stock - used).toFixed(2)));
    summary.push({
      inventoryItemId: inv.id,
      itemName: inv.name,
      unit: inv.unit,
      quantityDeducted: used,
      remainingStock: remaining,
    });
    return {
      ...inv,
      current_stock: remaining,
      updated_at: nowIso,
    };
  });

  return { deductionsMap, updatedInventory, summary };
}

/**
 * Pure function: calculates a member's next tier, points, and total spent after an order.
 */
export function computeUpdatedMember(
  customer: Customer,
  orderTotalAmount: number,
  pointsEarned: number,
  tierRules?: MembershipTierRule[]
): Customer {
  const nextSpent = customer.total_spent + orderTotalAmount;
  const nextPoints = customer.points + pointsEarned;
  const nextTier: MemberTier = computeTierBySpend(nextSpent, tierRules);

  return {
    ...customer,
    points: nextPoints,
    total_spent: nextSpent,
    tier: nextTier,
  };
}

export interface SupabaseSyncStatus {
  mode: 'supabase' | 'local';
  synced: boolean;
  queuedOffline?: boolean;
  error?: string;
  id?: string;
  orderNumber?: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

function isRpcMissingError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    msg.includes('could not find the function') ||
    msg.includes('does not exist')
  );
}

/**
 * Persists a completed or draft POS order to Supabase:
 * - Primary path: calls atomic Postgres RPC `checkout_order_atomic` (single transaction for
 *   daily order number, `orders`, `order_items` with historical `unit_hpp`, relative stock
 *   deduction, relative member points/spent, and atomic voucher quota increment).
 * - Fallback path (only if RPC is not installed yet): multi-step insert with automatic
 *   order-number collision retry (PostgreSQL 23505).
 */
export async function persistOrderToSupabase(params: {
  order: OrderRecord;
  cartItems: CartItem[];
  updatedCustomer: Customer | null;
  deductions: StockDeductionSummary[];
  enableSupabaseSync?: boolean;
}): Promise<SupabaseSyncStatus> {
  if (!params.enableSupabaseSync || !isSupabaseConfigured || !supabase) {
    return { mode: 'local', synced: true, orderNumber: params.order.order_number };
  }

  const { order, updatedCustomer, deductions } = params;

  try {
    // Primary path: atomic Postgres checkout RPC
    const nonUuidMenuDeductions =
      order.items.some((item) => !isUuid(item.menu_id))
        ? deductions
            .filter((d) => isUuid(d.inventoryItemId))
            .map((d) => ({
              inventory_item_id: d.inventoryItemId,
              quantity_deducted: d.quantityDeducted,
            }))
        : [];

    const atomicPayload = {
      order_number: order.order_number,
      cashier_name: order.cashier_name,
      customer_id: isUuid(order.customer_id) ? order.customer_id : null,
      customer_name: order.customer_name,
      order_type: order.order_type,
      table_number: order.table_number,
      subtotal: order.subtotal,
      discount_amount: order.discount_amount,
      voucher_code: order.voucher_code ?? null,
      voucher_discount_amount: order.voucher_discount_amount ?? 0,
      tax_amount: order.tax_amount,
      total_amount: order.total_amount,
      points_earned: order.points_earned ?? 0,
      payment_method: order.payment_method,
      status: order.status,
      notes: order.notes,
      next_tier: updatedCustomer?.tier ?? null,
      items: order.items.map((item) => ({
        menu_id: isUuid(item.menu_id) ? item.menu_id : null,
        menu_name: item.menu_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        unit_hpp: item.unit_hpp ?? 0,
        subtotal: item.subtotal,
        notes: item.notes ?? null,
      })),
      fallback_deductions: nonUuidMenuDeductions,
    };

    const { data: rpcData, error: rpcError } = await supabase.rpc('checkout_order_atomic', {
      p_payload: atomicPayload,
    });

    if (!rpcError && rpcData && typeof rpcData === 'object') {
      const record = rpcData as { ok?: boolean; id?: string; order_number?: string; error?: string };
      if (record.ok === true && record.id) {
        return {
          mode: 'supabase',
          synced: true,
          id: String(record.id),
          orderNumber: record.order_number ? String(record.order_number) : order.order_number,
        };
      }
      if (record.ok === false) {
        return {
          mode: 'supabase',
          synced: false,
          error: record.error || 'Checkout atomik ditolak oleh server Supabase.',
        };
      }
    }

    // Only fall back to multi-step client insert if the RPC function is not deployed yet
    if (rpcError && !isRpcMissingError(rpcError)) {
      return {
        mode: 'supabase',
        synced: false,
        error: rpcError.message || 'Gagal menjalankan checkout atomik di Supabase.',
      };
    }

    // Fallback path: direct insert with collision retry (PostgreSQL 23505 unique_violation)
    let currentOrderNumber = order.order_number;
    let insertedOrder: { id: string } | null = null;
    let orderError: { code?: string; message: string } | null = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const baseOrderPayload = {
        order_number: currentOrderNumber,
        cashier_id: isUuid(order.cashier_id) ? order.cashier_id : null,
        cashier_name: order.cashier_name,
        customer_id: isUuid(order.customer_id) ? order.customer_id : null,
        customer_name: order.customer_name,
        order_type: order.order_type,
        table_number: order.table_number,
        subtotal: order.subtotal,
        discount_amount: order.discount_amount,
        tax_amount: order.tax_amount,
        total_amount: order.total_amount,
        payment_method: order.payment_method,
        status: order.status,
        notes: order.notes,
      };

      const res = await supabase
        .from('orders')
        .insert({
          ...baseOrderPayload,
          voucher_code: order.voucher_code ?? null,
          voucher_discount_amount: order.voucher_discount_amount ?? 0,
          points_earned: order.points_earned ?? 0,
        })
        .select('id')
        .single();

      insertedOrder = res.data as { id: string } | null;
      orderError = res.error;

      if (
        orderError &&
        (orderError.code === 'PGRST204' ||
          orderError.code === '42703' ||
          orderError.message.toLowerCase().includes('voucher_') ||
          orderError.message.toLowerCase().includes('points_earned'))
      ) {
        const retry = await supabase
          .from('orders')
          .insert(baseOrderPayload)
          .select('id')
          .single();
        insertedOrder = retry.data as { id: string } | null;
        orderError = retry.error;
      }

      if (!orderError && insertedOrder) {
        break;
      }

      if (orderError?.code === '23505' || orderError?.message.toLowerCase().includes('duplicate key')) {
        currentOrderNumber = generateCollisionRetryOrderNumber(currentOrderNumber, attempt);
        continue;
      }

      break;
    }

    if (orderError || !insertedOrder) {
      return {
        mode: 'supabase',
        synced: false,
        error: orderError?.message || 'Gagal menyimpan header transaksi ke tabel orders.',
      };
    }

    // 2. Insert line items into `order_items`
    const itemRows = order.items.map((item) => ({
      order_id: insertedOrder!.id,
      menu_id: isUuid(item.menu_id) ? item.menu_id : null,
      menu_name: item.menu_name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      unit_hpp: item.unit_hpp ?? 0,
      subtotal: item.subtotal,
      notes: item.notes ?? null,
    }));

    let { error: itemsError } = await supabase.from('order_items').insert(itemRows);
    if (
      itemsError &&
      (itemsError.code === 'PGRST204' ||
        itemsError.code === '42703' ||
        itemsError.message.toLowerCase().includes('unit_hpp'))
    ) {
      const withoutHpp = itemRows.map(({ unit_hpp: _omit, ...rest }) => rest);
      const retryRes = await supabase.from('order_items').insert(withoutHpp);
      itemsError = retryRes.error;
    }
    if (
      itemsError &&
      (itemsError.code === '428C9' || itemsError.message.toLowerCase().includes('non-default'))
    ) {
      const retryRows = itemRows.map(({ subtotal: _omit, unit_hpp: _omitHpp, ...rest }) => rest);
      const retryRes = await supabase.from('order_items').insert(retryRows);
      itemsError = retryRes.error;
    }
    if (itemsError) {
      return {
        mode: 'supabase',
        synced: false,
        error: itemsError.message,
      };
    }

    // 3. Post-payment updates when completed
    if (order.status === 'completed') {
      if (updatedCustomer && isUuid(updatedCustomer.id)) {
        const { error: custErr } = await supabase
          .from('customers')
          .update({
            points: updatedCustomer.points,
            total_spent: updatedCustomer.total_spent,
            tier: updatedCustomer.tier,
          })
          .eq('id', updatedCustomer.id);

        if (custErr) {
          return {
            mode: 'supabase',
            synced: false,
            id: String(insertedOrder.id),
            orderNumber: currentOrderNumber,
            error: `Transaksi tersimpan, tetapi gagal memperbarui poin member: ${custErr.message}`,
          };
        }
      }

      const stockUpdateResults = await Promise.all(
        deductions
          .filter((entry) => isUuid(entry.inventoryItemId))
          .map((entry) =>
            supabase!
              .from('inventory_items')
              .update({
                current_stock: entry.remainingStock,
                updated_at: new Date().toISOString(),
              })
              .eq('id', entry.inventoryItemId)
          )
      );

      const failedStock = stockUpdateResults.find((res) => res.error);
      if (failedStock?.error) {
        return {
          mode: 'supabase',
          synced: false,
          id: String(insertedOrder.id),
          orderNumber: currentOrderNumber,
          error: `Transaksi tersimpan, tetapi pengurangan stok gagal: ${failedStock.error.message}`,
        };
      }
    }

    return {
      mode: 'supabase',
      synced: true,
      id: String(insertedOrder.id),
      orderNumber: currentOrderNumber,
    };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Terjadi kesalahan saat sinkronisasi Supabase.',
    };
  }
}

/**
 * Persists a newly registered membership customer into Supabase `customers` table.
 */
export async function persistCustomerToSupabase(
  customer: Customer,
  enableSupabaseSync = false
): Promise<SupabaseSyncStatus> {
  if (!enableSupabaseSync || !isSupabaseConfigured || !supabase) {
    return { mode: 'local', synced: true };
  }

  try {
    const { data, error } = await supabase
      .from('customers')
      .insert({
        name: customer.name,
        phone_number: customer.phone_number,
        email: customer.email || null,
        points: customer.points,
        tier: customer.tier,
        total_spent: customer.total_spent,
      })
      .select('id')
      .single();

    if (error) {
      return { mode: 'supabase', synced: false, error: error.message };
    }

    return { mode: 'supabase', synced: true, id: data?.id ? String(data.id) : undefined };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan data member ke Supabase.',
    };
  }
}
