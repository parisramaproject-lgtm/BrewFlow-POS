import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { CartItem, Customer, InventoryItem, MemberTier, OrderRecord } from '../types';

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
  pointsEarned: number
): Customer {
  const nextSpent = customer.total_spent + orderTotalAmount;
  const nextPoints = customer.points + pointsEarned;
  const nextTier: MemberTier =
    nextSpent >= 8000000 ? 'Platinum' : nextSpent >= 3000000 ? 'Gold' : 'Silver';

  return {
    ...customer,
    points: nextPoints,
    total_spent: nextSpent,
    tier: nextTier,
  };
}

export interface SupabaseSyncStatus {
  mode: 'supabase' | 'demo';
  synced: boolean;
  error?: string;
}

/**
 * Persists a completed or draft POS order to Supabase:
 * 1. Inserts into `orders`
 * 2. Inserts line items into `order_items`
 * 3. When status === 'completed':
 *    - Adds points & total_spent to `customers` (if member selected)
 *    - Deducts stock in `inventory_items` according to `menu_recipes`
 */
export async function persistOrderToSupabase(params: {
  order: OrderRecord;
  cartItems: CartItem[];
  updatedCustomer: Customer | null;
  deductions: StockDeductionSummary[];
  enableSupabaseSync?: boolean;
}): Promise<SupabaseSyncStatus> {
  if (!params.enableSupabaseSync || !isSupabaseConfigured || !supabase) {
    return { mode: 'demo', synced: true };
  }

  const { order, updatedCustomer, deductions } = params;

  try {
    // 1. Insert header row into `orders`
    const { data: insertedOrder, error: orderError } = await supabase
      .from('orders')
      .insert({
        order_number: order.order_number,
        cashier_id: order.cashier_id,
        customer_id: order.customer_id,
        order_type: order.order_type,
        table_number: order.table_number,
        subtotal: order.subtotal,
        discount_amount: order.discount_amount,
        tax_amount: order.tax_amount,
        total_amount: order.total_amount,
        payment_method: order.payment_method,
        status: order.status,
        notes: order.notes,
      })
      .select('id')
      .single();

    if (orderError || !insertedOrder) {
      return {
        mode: 'supabase',
        synced: false,
        error: orderError?.message || 'Gagal menyimpan header transaksi ke tabel orders.',
      };
    }

    // 2. Insert line items into `order_items`
    const itemRows = order.items.map((item) => ({
      order_id: insertedOrder.id,
      menu_id: item.menu_id,
      quantity: item.quantity,
      unit_price: item.unit_price,
      subtotal: item.subtotal,
      notes: item.notes ?? null,
    }));

    const { error: itemsError } = await supabase.from('order_items').insert(itemRows);
    if (itemsError) {
      return {
        mode: 'supabase',
        synced: false,
        error: itemsError.message,
      };
    }

    // 3. Post-payment updates when completed
    if (order.status === 'completed') {
      // 3a. Update loyalty points & tier on `customers`
      if (updatedCustomer) {
        await supabase
          .from('customers')
          .update({
            points: updatedCustomer.points,
            total_spent: updatedCustomer.total_spent,
            tier: updatedCustomer.tier,
          })
          .eq('id', updatedCustomer.id);
      }

      // 3b. Deduct `inventory_items` stock based on `menu_recipes`
      await Promise.all(
        deductions.map((entry) =>
          supabase!
            .from('inventory_items')
            .update({
              current_stock: entry.remainingStock,
              updated_at: new Date().toISOString(),
            })
            .eq('id', entry.inventoryItemId)
        )
      );
    }

    return { mode: 'supabase', synced: true };
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
    return { mode: 'demo', synced: true };
  }

  try {
    const { error } = await supabase.from('customers').insert({
      name: customer.name,
      phone_number: customer.phone_number,
      email: customer.email || null,
      points: customer.points,
      tier: customer.tier,
      total_spent: customer.total_spent,
    });

    if (error) {
      return { mode: 'supabase', synced: false, error: error.message };
    }

    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan data member ke Supabase.',
    };
  }
}
