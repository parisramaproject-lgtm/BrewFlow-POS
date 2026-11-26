import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type {
  AssetCondition,
  Category,
  Customer,
  ExpenseCategoryId,
  ExpensePaymentMethod,
  InventoryItem,
  ItemCategoryType,
  MemberRedemptionLog,
  MemberTier,
  MembershipProgramConfig,
  MenuItem,
  MenuRecipeItem,
  OrderItemRecord,
  OrderRecord,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PurchaseItemRecord,
  PurchaseRecord,
  StockOpnameDetailItem,
  StockOpnameLog,
  StockOpnameSchedule,
  StoreSettings,
  StoreVideoItem,
} from '../types';
import type { SupabaseSyncStatus } from './posService';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

export interface HydratedSupabaseData {
  categories?: Category[];
  inventory?: InventoryItem[];
  menus?: MenuItem[];
  customers?: Customer[];
  orders?: OrderRecord[];
  purchases?: PurchaseRecord[];
  opnameSchedules?: StockOpnameSchedule[];
  opnameLogs?: StockOpnameLog[];
  settings?: Partial<StoreSettings>;
  membershipProgram?: MembershipProgramConfig;
  redemptionLogs?: MemberRedemptionLog[];
  storeVideos?: StoreVideoItem[];
}

/**
 * Hydrates all operational BrewFlow POS tables from Supabase in parallel.
 * Tables that don't exist yet or return 0 rows are safely omitted so existing local state stays intact.
 */
export async function hydrateAllTablesFromSupabase(
  defaultSettings: StoreSettings
): Promise<HydratedSupabaseData | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const [
    catRes,
    invRes,
    menuRes,
    recipeRes,
    custRes,
    orderRes,
    orderItemRes,
    purchaseRes,
    purchaseItemRes,
    scheduleRes,
    opnameLogRes,
    opnameDetailRes,
    settingsRes,
    membershipRes,
    redemptionRes,
    videoRes,
  ] = await Promise.allSettled([
    supabase.from('categories').select('*').order('sort_order', { ascending: true }),
    supabase.from('inventory_items').select('*').order('name', { ascending: true }),
    supabase.from('menus').select('*').order('name', { ascending: true }),
    supabase.from('menu_recipes').select('*'),
    supabase.from('customers').select('*').order('created_at', { ascending: false }),
    supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(200),
    supabase.from('order_items').select('*').limit(1000),
    supabase.from('purchases').select('*').order('purchase_date', { ascending: false }).limit(200),
    supabase.from('purchase_items').select('*').limit(1000),
    supabase.from('stock_opname_schedules').select('*').order('created_at', { ascending: false }),
    supabase
      .from('stock_opname_logs')
      .select('*')
      .order('completed_at', { ascending: false })
      .limit(100),
    supabase.from('stock_opname_details').select('*').limit(1500),
    supabase.from('store_settings').select('*').eq('id', 'default').maybeSingle(),
    supabase.from('membership_program_settings').select('*').eq('id', 'default').maybeSingle(),
    supabase
      .from('member_redemption_logs')
      .select('*')
      .order('redeemed_at', { ascending: false })
      .limit(200),
    supabase.from('store_videos').select('*').order('sort_order', { ascending: true }),
  ]);

  const result: HydratedSupabaseData = {};

  if (catRes.status === 'fulfilled' && !catRes.value.error && Array.isArray(catRes.value.data) && catRes.value.data.length > 0) {
    result.categories = catRes.value.data.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      icon_name: (row.icon_name as Category['icon_name']) || 'coffee',
      sort_order: Number(row.sort_order) || 0,
    }));
  }

  let inventoryMap = new Map<string, InventoryItem>();
  if (invRes.status === 'fulfilled' && !invRes.value.error && Array.isArray(invRes.value.data) && invRes.value.data.length > 0) {
    const mappedInv: InventoryItem[] = invRes.value.data.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      sku: String(row.sku || ''),
      category_type: (row.category_type as ItemCategoryType) || 'raw_material',
      expense_category: (row.expense_category as ExpenseCategoryId) || undefined,
      unit: String(row.unit || 'pcs'),
      current_stock: Number(row.current_stock) || 0,
      min_stock_threshold: Number(row.min_stock_threshold) || 0,
      last_purchase_price: Number(row.last_purchase_price) || 0,
      asset_condition: (row.asset_condition as AssetCondition) || undefined,
      updated_at: String(row.updated_at || new Date().toISOString()),
    }));
    result.inventory = mappedInv;
    inventoryMap = new Map(mappedInv.map((item) => [item.id, item]));
  }

  if (menuRes.status === 'fulfilled' && !menuRes.value.error && Array.isArray(menuRes.value.data) && menuRes.value.data.length > 0) {
    const recipeList: MenuRecipeItem[] =
      recipeRes.status === 'fulfilled' && !recipeRes.value.error && Array.isArray(recipeRes.value.data)
        ? recipeRes.value.data.map((r) => ({
            id: String(r.id),
            menu_id: String(r.menu_id),
            inventory_item_id: String(r.inventory_item_id),
            quantity_needed: Number(r.quantity_needed) || 0,
          }))
        : [];

    const recipesByMenu = new Map<string, MenuRecipeItem[]>();
    for (const r of recipeList) {
      const list = recipesByMenu.get(r.menu_id) ?? [];
      list.push(r);
      recipesByMenu.set(r.menu_id, list);
    }

    result.menus = menuRes.value.data.map((row) => ({
      id: String(row.id),
      category_id: String(row.category_id || ''),
      name: String(row.name),
      description: String(row.description || ''),
      image_url: row.image_url ? String(row.image_url) : undefined,
      selling_price: Number(row.selling_price) || 0,
      is_available: row.is_available !== false,
      visual_tone: (row.visual_tone as MenuItem['visual_tone']) || 'espresso',
      recipes: recipesByMenu.get(String(row.id)) ?? [],
    }));
  }

  if (custRes.status === 'fulfilled' && !custRes.value.error && Array.isArray(custRes.value.data) && custRes.value.data.length > 0) {
    result.customers = custRes.value.data.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      phone_number: String(row.phone_number || ''),
      email: String(row.email || ''),
      points: Number(row.points) || 0,
      tier: (row.tier as MemberTier) || 'Silver',
      total_spent: Number(row.total_spent) || 0,
      created_at: String(row.created_at || new Date().toISOString()),
    }));
  }

  if (orderRes.status === 'fulfilled' && !orderRes.value.error && Array.isArray(orderRes.value.data) && orderRes.value.data.length > 0) {
    const itemsByOrder = new Map<string, OrderItemRecord[]>();
    if (orderItemRes.status === 'fulfilled' && !orderItemRes.value.error && Array.isArray(orderItemRes.value.data)) {
      for (const row of orderItemRes.value.data) {
        const orderId = String(row.order_id);
        const list = itemsByOrder.get(orderId) ?? [];
        list.push({
          id: String(row.id),
          menu_id: String(row.menu_id || ''),
          menu_name: String(row.menu_name || 'Menu'),
          quantity: Number(row.quantity) || 1,
          unit_price: Number(row.unit_price) || 0,
          subtotal: Number(row.subtotal) || 0,
          notes: row.notes ? String(row.notes) : undefined,
        });
        itemsByOrder.set(orderId, list);
      }
    }

    result.orders = orderRes.value.data.map((row) => ({
      id: String(row.id),
      order_number: String(row.order_number),
      cashier_id: String(row.cashier_id || ''),
      cashier_name: String(row.cashier_name || 'Kasir'),
      customer_id: row.customer_id ? String(row.customer_id) : null,
      customer_name: row.customer_name ? String(row.customer_name) : null,
      order_type: (row.order_type as OrderType) || 'dine_in',
      table_number: String(row.table_number || ''),
      subtotal: Number(row.subtotal) || 0,
      discount_amount: Number(row.discount_amount) || 0,
      tax_amount: Number(row.tax_amount) || 0,
      total_amount: Number(row.total_amount) || 0,
      payment_method: (row.payment_method as PaymentMethod) || 'cash',
      status: (row.status as OrderStatus) || 'completed',
      notes: String(row.notes || ''),
      items: itemsByOrder.get(String(row.id)) ?? [],
      created_at: String(row.created_at || new Date().toISOString()),
    }));
  }

  if (purchaseRes.status === 'fulfilled' && !purchaseRes.value.error && Array.isArray(purchaseRes.value.data) && purchaseRes.value.data.length > 0) {
    const itemsByPurchase = new Map<string, PurchaseItemRecord[]>();
    if (purchaseItemRes.status === 'fulfilled' && !purchaseItemRes.value.error && Array.isArray(purchaseItemRes.value.data)) {
      for (const row of purchaseItemRes.value.data) {
        const pid = String(row.purchase_id);
        const inv = row.inventory_item_id ? inventoryMap.get(String(row.inventory_item_id)) : undefined;
        const list = itemsByPurchase.get(pid) ?? [];
        list.push({
          inventory_item_id: row.inventory_item_id ? String(row.inventory_item_id) : null,
          item_name: String(row.item_name || inv?.name || 'Item'),
          unit: String(row.unit || inv?.unit || 'pcs'),
          quantity: Number(row.quantity) || 0,
          unit_price: Number(row.unit_price) || 0,
        });
        itemsByPurchase.set(pid, list);
      }
    }

    result.purchases = purchaseRes.value.data.map((row) => ({
      id: String(row.id),
      expense_category: (row.expense_category as ExpenseCategoryId) || 'pembelian_bahan_baku',
      supplier_name: String(row.supplier_name || ''),
      invoice_number: String(row.invoice_number || ''),
      total_cost: Number(row.total_cost) || 0,
      payment_method: (row.payment_method as ExpensePaymentMethod) || 'transfer',
      notes: row.notes ? String(row.notes) : undefined,
      purchased_by_name: String(row.purchased_by_name || 'Staff'),
      purchase_date: String(row.purchase_date || new Date().toISOString()),
      items: itemsByPurchase.get(String(row.id)) ?? [],
    }));
  }

  let scheduleTitleMap = new Map<string, string>();
  if (scheduleRes.status === 'fulfilled' && !scheduleRes.value.error && Array.isArray(scheduleRes.value.data) && scheduleRes.value.data.length > 0) {
    const mappedSchedules: StockOpnameSchedule[] = scheduleRes.value.data.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      frequency: row.frequency,
      execution_time: String(row.execution_time || '21:00').slice(0, 5),
      day_of_week: row.day_of_week ?? undefined,
      day_of_month: row.day_of_month ?? undefined,
      target_category: row.target_category,
      is_active: row.is_active !== false,
      is_due_now: Boolean(row.is_due_now),
      last_completed_at: row.last_completed_at ? String(row.last_completed_at) : undefined,
    }));
    result.opnameSchedules = mappedSchedules;
    scheduleTitleMap = new Map(mappedSchedules.map((s) => [s.id, s.title]));
  }

  if (opnameLogRes.status === 'fulfilled' && !opnameLogRes.value.error && Array.isArray(opnameLogRes.value.data) && opnameLogRes.value.data.length > 0) {
    const detailsByLog = new Map<string, StockOpnameDetailItem[]>();
    if (opnameDetailRes.status === 'fulfilled' && !opnameDetailRes.value.error && Array.isArray(opnameDetailRes.value.data)) {
      for (const row of opnameDetailRes.value.data) {
        const logId = String(row.opname_log_id);
        const inv = row.inventory_item_id ? inventoryMap.get(String(row.inventory_item_id)) : undefined;
        const list = detailsByLog.get(logId) ?? [];
        const systemStock = Number(row.system_stock) || 0;
        const actualStock = Number(row.actual_stock) || 0;
        const computedVariance = Number((actualStock - systemStock).toFixed(2));
        list.push({
          inventory_item_id: String(row.inventory_item_id || ''),
          item_name: String(row.item_name || inv?.name || 'Item'),
          sku: String(row.sku || inv?.sku || ''),
          unit: String(row.unit || inv?.unit || 'pcs'),
          system_stock: systemStock,
          actual_stock: actualStock,
          variance:
            row.variance !== null && row.variance !== undefined && Number(row.variance) !== 0
              ? Number(row.variance)
              : computedVariance,
          unit_price: Number(row.unit_price) || inv?.last_purchase_price || 0,
          reason: row.reason ? String(row.reason) : undefined,
        });
        detailsByLog.set(logId, list);
      }
    }

    result.opnameLogs = opnameLogRes.value.data.map((row) => {
      const logId = String(row.id);
      const details = detailsByLog.get(logId) ?? [];
      const schedId = row.schedule_id ? String(row.schedule_id) : null;
      return {
        id: logId,
        schedule_id: schedId,
        schedule_title: String(
          row.schedule_title || (schedId ? scheduleTitleMap.get(schedId) : null) || 'Stock Opname'
        ),
        performed_by_name: String(row.performed_by_name || 'Staff'),
        notes: String(row.notes || ''),
        total_items_checked: Number(row.total_items_checked) || details.length,
        discrepancy_count:
          Number(row.discrepancy_count) || details.filter((d) => d.variance !== 0).length,
        completed_at: String(row.completed_at || new Date().toISOString()),
        whatsapp_sent: Boolean(row.whatsapp_sent),
        details,
      };
    });
  }

  if (settingsRes.status === 'fulfilled' && !settingsRes.value.error && settingsRes.value.data) {
    const s = settingsRes.value.data as Record<string, unknown>;
    result.settings = {
      shopName: typeof s.shop_name === 'string' ? s.shop_name : defaultSettings.shopName,
      address: typeof s.address === 'string' ? s.address : defaultSettings.address,
      phone: typeof s.phone === 'string' ? s.phone : defaultSettings.phone,
      customerServiceContact:
        typeof s.customer_service_contact === 'string'
          ? s.customer_service_contact
          : defaultSettings.customerServiceContact,
      shopLogoUrl: typeof s.shop_logo_url === 'string' ? s.shop_logo_url : null,
      taxEnabled: typeof s.tax_enabled === 'boolean' ? s.tax_enabled : defaultSettings.taxEnabled,
      taxPercent:
        typeof s.tax_percent === 'number'
          ? s.tax_percent
          : Number(s.tax_percent) || defaultSettings.taxPercent,
      taxLabel: typeof s.tax_label === 'string' ? s.tax_label : defaultSettings.taxLabel,
      receiptPaperWidth: s.receipt_paper_width === '80mm' ? '80mm' : '58mm',
      receiptHeaderText:
        typeof s.receipt_header_text === 'string'
          ? s.receipt_header_text
          : defaultSettings.receiptHeaderText,
      receiptFooterText:
        typeof s.receipt_footer_text === 'string'
          ? s.receipt_footer_text
          : defaultSettings.receiptFooterText,
      receiptShowLogo:
        typeof s.receipt_show_logo === 'boolean'
          ? s.receipt_show_logo
          : defaultSettings.receiptShowLogo,
      receiptShowCashierAndTable:
        typeof s.receipt_show_cashier_and_table === 'boolean'
          ? s.receipt_show_cashier_and_table
          : defaultSettings.receiptShowCashierAndTable,
      receiptShowMemberInfo:
        typeof s.receipt_show_member_info === 'boolean'
          ? s.receipt_show_member_info
          : defaultSettings.receiptShowMemberInfo,
      receiptShowCustomerService:
        typeof s.receipt_show_customer_service === 'boolean'
          ? s.receipt_show_customer_service
          : defaultSettings.receiptShowCustomerService,
      whatsappOwnerPhone:
        typeof s.whatsapp_owner_phone === 'string'
          ? s.whatsapp_owner_phone
          : defaultSettings.whatsappOwnerPhone,
      whatsappManagerPhone:
        typeof s.whatsapp_manager_phone === 'string'
          ? s.whatsapp_manager_phone
          : defaultSettings.whatsappManagerPhone,
      ownerLoginAlertEmail:
        typeof s.owner_login_alert_email === 'string' && s.owner_login_alert_email.trim()
          ? s.owner_login_alert_email
          : defaultSettings.ownerLoginAlertEmail,
    };
  }

  if (
    membershipRes.status === 'fulfilled' &&
    !membershipRes.value.error &&
    membershipRes.value.data &&
    typeof membershipRes.value.data.config === 'object'
  ) {
    result.membershipProgram = membershipRes.value.data.config as MembershipProgramConfig;
  }

  if (
    redemptionRes.status === 'fulfilled' &&
    !redemptionRes.value.error &&
    Array.isArray(redemptionRes.value.data) &&
    redemptionRes.value.data.length > 0
  ) {
    result.redemptionLogs = redemptionRes.value.data.map((row) => ({
      id: String(row.id),
      customer_id: String(row.customer_id || ''),
      customer_name: String(row.customer_name || ''),
      reward_id: row.reward_id ? String(row.reward_id) : undefined,
      promo_id: row.promo_id ? String(row.promo_id) : undefined,
      label: String(row.label || ''),
      points_spent: Number(row.points_spent) || 0,
      redeemed_at: String(row.redeemed_at || new Date().toISOString()),
    }));
  }

  if (
    videoRes.status === 'fulfilled' &&
    !videoRes.value.error &&
    Array.isArray(videoRes.value.data) &&
    videoRes.value.data.length > 0
  ) {
    result.storeVideos = videoRes.value.data.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      subtitle: row.subtitle ? String(row.subtitle) : undefined,
      source_type: (row.source_type as StoreVideoItem['source_type']) || 'mp4',
      url: String(row.url),
      embed_url: row.embed_url ? String(row.embed_url) : undefined,
      is_active: row.is_active !== false,
      show_promo_ticker: row.show_promo_ticker !== false,
      created_by_name: String(row.created_by_name || 'BrewFlow Staff'),
      created_at: String(row.created_at || new Date().toISOString()),
    }));
  }

  return result;
}

export async function persistMembershipProgramToSupabase(
  config: MembershipProgramConfig
): Promise<SupabaseSyncStatus> {
  if (!isSupabaseConfigured || !supabase) return { mode: 'local', synced: true };
  try {
    const { error } = await supabase.from('membership_program_settings').upsert({
      id: 'default',
      config,
      updated_at: new Date().toISOString(),
    });
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan pengaturan membership.',
    };
  }
}

export async function persistMemberRedemptionToSupabase(
  log: MemberRedemptionLog,
  updatedCustomer?: Customer
): Promise<SupabaseSyncStatus> {
  if (!isSupabaseConfigured || !supabase) return { mode: 'local', synced: true };
  try {
    const { error } = await supabase.from('member_redemption_logs').insert({
      customer_id: isUuid(log.customer_id) ? log.customer_id : null,
      customer_name: log.customer_name,
      reward_id: log.reward_id ?? null,
      promo_id: log.promo_id ?? null,
      label: log.label,
      points_spent: log.points_spent,
      redeemed_at: log.redeemed_at,
    });
    if (error) return { mode: 'supabase', synced: false, error: error.message };

    if (updatedCustomer && isUuid(updatedCustomer.id)) {
      await supabase
        .from('customers')
        .update({ points: updatedCustomer.points, tier: updatedCustomer.tier })
        .eq('id', updatedCustomer.id);
    }
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan log penukaran poin.',
    };
  }
}

export async function updateCustomerPointsInSupabase(
  customer: Customer
): Promise<SupabaseSyncStatus> {
  if (!isSupabaseConfigured || !supabase || !isUuid(customer.id)) {
    return { mode: 'local', synced: true };
  }
  try {
    const { error } = await supabase
      .from('customers')
      .update({
        points: customer.points,
        tier: customer.tier,
        total_spent: customer.total_spent,
      })
      .eq('id', customer.id);
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal memperbarui poin member.',
    };
  }
}

export async function upsertStoreVideoToSupabase(
  video: StoreVideoItem,
  sortOrder: number
): Promise<SupabaseSyncStatus & { id?: string }> {
  if (!isSupabaseConfigured || !supabase) return { mode: 'local', synced: true };
  if (video.url.startsWith('blob:')) return { mode: 'local', synced: true };
  try {
    const payload = {
      title: video.title,
      subtitle: video.subtitle ?? '',
      source_type: video.source_type,
      url: video.url,
      embed_url: video.embed_url ?? null,
      is_active: video.is_active,
      show_promo_ticker: video.show_promo_ticker,
      sort_order: sortOrder,
      created_by_name: video.created_by_name,
    };

    if (isUuid(video.id)) {
      const { error } = await supabase.from('store_videos').update(payload).eq('id', video.id);
      if (error) return { mode: 'supabase', synced: false, error: error.message };
      return { mode: 'supabase', synced: true, id: video.id };
    }

    const { data, error } = await supabase
      .from('store_videos')
      .insert(payload)
      .select('id')
      .single();
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true, id: data?.id ? String(data.id) : undefined };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan video TV Store.',
    };
  }
}

export async function deleteStoreVideoFromSupabase(videoId: string): Promise<SupabaseSyncStatus> {
  if (!isSupabaseConfigured || !supabase || !isUuid(videoId)) {
    return { mode: 'local', synced: true };
  }
  try {
    const { error } = await supabase.from('store_videos').delete().eq('id', videoId);
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menghapus video TV Store.',
    };
  }
}

export async function deleteOrderFromSupabase(orderId: string): Promise<SupabaseSyncStatus> {
  if (!isSupabaseConfigured || !supabase || !isUuid(orderId)) {
    return { mode: 'local', synced: true };
  }
  try {
    const { error } = await supabase.from('orders').delete().eq('id', orderId);
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menghapus draft order di Supabase.',
    };
  }
}
