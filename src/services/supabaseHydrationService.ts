import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type {
  AppNotification,
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
  OperationalNotificationType,
  OrderItemRecord,
  OrderRecord,
  OrderStatus,
  OrderType,
  PageId,
  PaymentMethod,
  PurchaseItemRecord,
  PurchaseRecord,
  RestockRequestRecord,
  RestockRequestStatus,
  StockOpnameDetailItem,
  StockOpnameLog,
  StockOpnameSchedule,
  StoreSettings,
  StoreVideoItem,
  UserRole,
  UsernameLoginAuditLog,
  VendorRecord,
  VoucherRecord,
  VoucherSchemeType,
  WhatsAppEventType,
  WhatsAppLogEntry,
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
  vouchers?: VoucherRecord[];
  vendors?: VendorRecord[];
  restockRequests?: RestockRequestRecord[];
  customNotifications?: AppNotification[];
  whatsappLogs?: WhatsAppLogEntry[];
  loginAuditLogs?: UsernameLoginAuditLog[];
}

function mapStoreSettingsRow(
  s: Record<string, unknown>,
  defaultSettings: StoreSettings
): Partial<StoreSettings> {
  return {
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

/**
 * Hydrates all operational BrewFlow POS tables from Supabase in parallel.
 * - Returns `[]` for tables whose query succeeded with 0 rows (prevents demo seed data leakage!).
 * - Falls back to safe RPCs (`get_pos_stock_levels`, `get_pos_store_settings`) for Cashier role
 *   where strict RLS restricts direct access to cost/secret columns.
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
    voucherRes,
    vendorRes,
    restockRes,
    notifRes,
    waLogRes,
    loginAuditRes,
  ] = await Promise.allSettled([
    supabase.from('categories').select('*').order('sort_order', { ascending: true }),
    supabase.from('inventory_items').select('*').order('name', { ascending: true }),
    supabase.from('menus').select('*').order('name', { ascending: true }),
    supabase.from('menu_recipes').select('*'),
    supabase.from('customers').select('*').order('created_at', { ascending: false }).limit(2000),
    supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(1000),
    supabase.from('order_items').select('*').limit(5000),
    supabase.from('purchases').select('*').order('purchase_date', { ascending: false }).limit(500),
    supabase.from('purchase_items').select('*').limit(2000),
    supabase.from('stock_opname_schedules').select('*').order('created_at', { ascending: false }),
    supabase
      .from('stock_opname_logs')
      .select('*')
      .order('completed_at', { ascending: false })
      .limit(200),
    supabase.from('stock_opname_details').select('*').limit(3000),
    supabase.from('store_settings').select('*').eq('id', 'default').maybeSingle(),
    supabase.from('membership_program_settings').select('*').eq('id', 'default').maybeSingle(),
    supabase
      .from('member_redemption_logs')
      .select('*')
      .order('redeemed_at', { ascending: false })
      .limit(300),
    supabase.from('store_videos').select('*').order('sort_order', { ascending: true }),
    supabase.from('vouchers').select('*').order('created_at', { ascending: false }),
    supabase.from('vendors').select('*').order('created_at', { ascending: false }),
    supabase.from('restock_requests').select('*').order('created_at', { ascending: false }).limit(200),
    supabase
      .from('operational_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('whatsapp_logs').select('*').order('sent_at', { ascending: false }).limit(200),
    supabase.from('login_audit_logs').select('*').order('logged_in_at', { ascending: false }).limit(100),
  ]);

  const result: HydratedSupabaseData = {};

  if (catRes.status === 'fulfilled' && !catRes.value.error && Array.isArray(catRes.value.data)) {
    result.categories = catRes.value.data.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      icon_name: (row.icon_name as Category['icon_name']) || 'coffee',
      sort_order: Number(row.sort_order) || 0,
    }));
  }

  let inventoryMap = new Map<string, InventoryItem>();
  if (
    invRes.status === 'fulfilled' &&
    !invRes.value.error &&
    Array.isArray(invRes.value.data) &&
    invRes.value.data.length > 0
  ) {
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
  } else {
    // Fallback for Cashier role blocked by strict RLS on `inventory_items` (no cost/HPP exposed)
    try {
      const { data: safeStockRows, error: rpcErr } = await supabase.rpc('get_pos_stock_levels');
      if (!rpcErr && Array.isArray(safeStockRows)) {
        const mappedInv: InventoryItem[] = safeStockRows.map((row: Record<string, unknown>) => ({
          id: String(row.id),
          name: String(row.name),
          sku: String(row.sku || ''),
          category_type: (row.category_type as ItemCategoryType) || 'raw_material',
          expense_category: (row.expense_category as ExpenseCategoryId) || undefined,
          unit: String(row.unit || 'pcs'),
          current_stock: Number(row.current_stock) || 0,
          min_stock_threshold: Number(row.min_stock_threshold) || 0,
          last_purchase_price: 0,
          asset_condition: (row.asset_condition as AssetCondition) || undefined,
          updated_at: String(row.updated_at || new Date().toISOString()),
        }));
        result.inventory = mappedInv;
        inventoryMap = new Map(mappedInv.map((item) => [item.id, item]));
      } else if (
        invRes.status === 'fulfilled' &&
        !invRes.value.error &&
        Array.isArray(invRes.value.data)
      ) {
        result.inventory = [];
      }
    } catch {
      if (invRes.status === 'fulfilled' && !invRes.value.error && Array.isArray(invRes.value.data)) {
        result.inventory = [];
      }
    }
  }

  if (menuRes.status === 'fulfilled' && !menuRes.value.error && Array.isArray(menuRes.value.data)) {
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

  if (custRes.status === 'fulfilled' && !custRes.value.error && Array.isArray(custRes.value.data)) {
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

  if (orderRes.status === 'fulfilled' && !orderRes.value.error && Array.isArray(orderRes.value.data)) {
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
          unit_hpp:
            row.unit_hpp !== null && row.unit_hpp !== undefined ? Number(row.unit_hpp) : undefined,
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
      voucher_code: row.voucher_code ? String(row.voucher_code) : null,
      voucher_discount_amount: Number(row.voucher_discount_amount) || 0,
      tax_amount: Number(row.tax_amount) || 0,
      total_amount: Number(row.total_amount) || 0,
      points_earned:
        row.points_earned !== null && row.points_earned !== undefined
          ? Number(row.points_earned)
          : undefined,
      payment_method: (row.payment_method as PaymentMethod) || 'cash',
      status: (row.status as OrderStatus) || 'completed',
      sync_status: 'synced',
      notes: String(row.notes || ''),
      items: itemsByOrder.get(String(row.id)) ?? [],
      created_at: String(row.created_at || new Date().toISOString()),
    }));
  }

  if (purchaseRes.status === 'fulfilled' && !purchaseRes.value.error && Array.isArray(purchaseRes.value.data)) {
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
  if (scheduleRes.status === 'fulfilled' && !scheduleRes.value.error && Array.isArray(scheduleRes.value.data)) {
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

  if (opnameLogRes.status === 'fulfilled' && !opnameLogRes.value.error && Array.isArray(opnameLogRes.value.data)) {
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
    result.settings = mapStoreSettingsRow(
      settingsRes.value.data as Record<string, unknown>,
      defaultSettings
    );
  } else {
    // Fallback for Cashier role blocked by strict RLS on `store_settings`
    try {
      const { data: safeSettings, error: safeErr } = await supabase.rpc('get_pos_store_settings');
      if (!safeErr && safeSettings && typeof safeSettings === 'object') {
        result.settings = mapStoreSettingsRow(
          safeSettings as Record<string, unknown>,
          defaultSettings
        );
      }
    } catch {
      // Ignore if RPC not yet deployed
    }
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
    Array.isArray(redemptionRes.value.data)
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

  if (videoRes.status === 'fulfilled' && !videoRes.value.error && Array.isArray(videoRes.value.data)) {
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

  if (voucherRes.status === 'fulfilled' && !voucherRes.value.error && Array.isArray(voucherRes.value.data)) {
    result.vouchers = voucherRes.value.data.map((row) => ({
      id: String(row.id),
      code: String(row.code || '').toUpperCase(),
      title: String(row.title || 'Voucher Promo'),
      description: String(row.description || ''),
      scheme_type: (row.scheme_type as VoucherSchemeType) || 'percentage_discount',
      discount_percent: Number(row.discount_percent) || 0,
      max_discount_amount: Number(row.max_discount_amount) || 0,
      discount_amount: Number(row.discount_amount) || 0,
      special_price: Number(row.special_price) || 0,
      buy_quantity: Number(row.buy_quantity) || 1,
      free_quantity: Number(row.free_quantity) || 1,
      bundle_quantity: Number(row.bundle_quantity) || 2,
      bundle_price: Number(row.bundle_price) || 0,
      target_menu_ids: Array.isArray(row.target_menu_ids)
        ? row.target_menu_ids.map((id: unknown) => String(id))
        : [],
      min_purchase_amount: Number(row.min_purchase_amount) || 0,
      valid_from_date: String(row.valid_from_date || '').slice(0, 10),
      valid_until_date: String(row.valid_until_date || '').slice(0, 10),
      start_time: String(row.start_time || '00:00').slice(0, 5),
      end_time: String(row.end_time || '23:59').slice(0, 5),
      active_days: Array.isArray(row.active_days)
        ? row.active_days.map((d: unknown) => Number(d)).filter((d: number) => d >= 0 && d <= 6)
        : [0, 1, 2, 3, 4, 5, 6],
      max_usage_quota: Number(row.max_usage_quota) || 0,
      used_count: Number(row.used_count) || 0,
      stackable_with_member_discount: row.stackable_with_member_discount === true,
      is_rush_hour: row.is_rush_hour !== false,
      is_active: row.is_active !== false,
      created_by_name: row.created_by_name ? String(row.created_by_name) : undefined,
      created_at: String(row.created_at || new Date().toISOString()),
    }));
  }

  // Multi-device operational tables (P1-1)
  if (vendorRes.status === 'fulfilled' && !vendorRes.value.error && Array.isArray(vendorRes.value.data)) {
    result.vendors = vendorRes.value.data.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      contact_person: String(row.contact_person || ''),
      phone: String(row.phone || row.phone_number || ''),
      email: row.email ? String(row.email) : undefined,
      category_type: (row.category_type as ItemCategoryType) || 'raw_material',
      supplied_items: Array.isArray(row.supplied_items)
        ? row.supplied_items.map((item: unknown) => String(item))
        : typeof row.supplied_items === 'string' && row.supplied_items.trim()
          ? row.supplied_items.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [],
      address: row.address ? String(row.address) : undefined,
      payment_terms: row.payment_terms ? String(row.payment_terms) : undefined,
      notes: row.notes ? String(row.notes) : undefined,
      is_active: row.is_active !== false,
      created_at: String(row.created_at || new Date().toISOString()),
    }));
  }

  if (restockRes.status === 'fulfilled' && !restockRes.value.error && Array.isArray(restockRes.value.data)) {
    result.restockRequests = restockRes.value.data.map((row) => ({
      id: String(row.id),
      inventory_item_id: String(row.inventory_item_id || ''),
      item_name: String(row.item_name || ''),
      unit: String(row.unit || 'pcs'),
      current_stock: Number(row.current_stock) || 0,
      requested_quantity: Number(row.requested_quantity) || 1,
      urgency: row.urgency === 'urgent' ? 'urgent' : 'normal',
      notes: row.notes ? String(row.notes) : undefined,
      requested_by_id: String(row.requested_by_id || ''),
      requested_by_name: String(row.requested_by_name || 'Kasir'),
      requested_by_role: (row.requested_by_role as UserRole) || 'cashier',
      status: (row.status as RestockRequestStatus) || 'pending',
      handled_by_name: row.handled_by_name ? String(row.handled_by_name) : undefined,
      created_at: String(row.created_at || new Date().toISOString()),
      updated_at: String(row.updated_at || row.created_at || new Date().toISOString()),
    }));
  }

  if (notifRes.status === 'fulfilled' && !notifRes.value.error && Array.isArray(notifRes.value.data)) {
    result.customNotifications = notifRes.value.data.map((row) => {
      const createdAt = String(row.created_at || new Date().toISOString());
      return {
        id: String(row.id),
        type: (row.type as OperationalNotificationType) || 'info',
        title: String(row.title || ''),
        message: String(row.message || ''),
        targetPage: (row.target_page as PageId) || 'dashboard',
        targetRoles: Array.isArray(row.target_roles)
          ? (row.target_roles.filter((r: unknown) =>
              ['owner', 'manager', 'cashier'].includes(String(r))
            ) as UserRole[])
          : undefined,
        senderName: row.sender_name ? String(row.sender_name) : undefined,
        senderRole: row.sender_role ? (row.sender_role as UserRole) : undefined,
        restockRequestId: row.restock_request_id ? String(row.restock_request_id) : undefined,
        timestamp: new Date(createdAt).toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        createdAt,
        unread: row.unread !== false,
      };
    });
  }

  if (waLogRes.status === 'fulfilled' && !waLogRes.value.error && Array.isArray(waLogRes.value.data)) {
    result.whatsappLogs = waLogRes.value.data.map((row) => ({
      id: String(row.id),
      event_type: (row.event_type as WhatsAppEventType) || 'pos_receipt',
      targets: Array.isArray(row.targets) ? row.targets.map((t: unknown) => String(t)) : [],
      preview: String(row.preview || ''),
      mode: row.mode === 'local' ? 'local' : 'edge_function',
      status: row.status === 'failed' ? 'failed' : 'sent',
      error: row.error ? String(row.error) : undefined,
      sent_at: String(row.sent_at || new Date().toISOString()),
    }));
  }

  if (
    loginAuditRes.status === 'fulfilled' &&
    !loginAuditRes.value.error &&
    Array.isArray(loginAuditRes.value.data)
  ) {
    result.loginAuditLogs = loginAuditRes.value.data.map((row) => ({
      id: String(row.id),
      employee_id: String(row.employee_id || ''),
      employee_name: String(row.employee_name || ''),
      username: String(row.username || ''),
      role: (row.role as UserRole) || 'cashier',
      owner_email: String(row.owner_email || ''),
      email_status: 'sent',
      email_provider: 'Supabase Auth Audit',
      device_info: String(row.device_info || 'Perangkat Terverifikasi'),
      logged_in_at: String(row.logged_in_at || new Date().toISOString()),
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

export async function upsertVoucherToSupabase(
  voucher: VoucherRecord
): Promise<SupabaseSyncStatus & { id?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { mode: 'local', synced: true };
  }
  try {
    const payload = {
      code: voucher.code,
      title: voucher.title,
      description: voucher.description ?? '',
      scheme_type: voucher.scheme_type,
      discount_percent: voucher.discount_percent ?? 0,
      max_discount_amount: voucher.max_discount_amount ?? 0,
      discount_amount: voucher.discount_amount ?? 0,
      special_price: voucher.special_price ?? 0,
      buy_quantity: voucher.buy_quantity ?? 1,
      free_quantity: voucher.free_quantity ?? 1,
      bundle_quantity: voucher.bundle_quantity ?? 2,
      bundle_price: voucher.bundle_price ?? 0,
      target_menu_ids: voucher.target_menu_ids ?? [],
      min_purchase_amount: voucher.min_purchase_amount ?? 0,
      valid_from_date: voucher.valid_from_date,
      valid_until_date: voucher.valid_until_date,
      start_time: voucher.start_time,
      end_time: voucher.end_time,
      active_days: voucher.active_days ?? [0, 1, 2, 3, 4, 5, 6],
      max_usage_quota: voucher.max_usage_quota ?? 0,
      used_count: voucher.used_count ?? 0,
      stackable_with_member_discount: voucher.stackable_with_member_discount ?? false,
      is_rush_hour: voucher.is_rush_hour ?? true,
      is_active: voucher.is_active !== false,
      created_by_name: voucher.created_by_name ?? 'Owner',
    };

    if (isUuid(voucher.id)) {
      const { error } = await supabase.from('vouchers').update(payload).eq('id', voucher.id);
      if (error) return { mode: 'supabase', synced: false, error: error.message };
      return { mode: 'supabase', synced: true, id: voucher.id };
    }

    const { data, error } = await supabase
      .from('vouchers')
      .upsert(payload, { onConflict: 'code' })
      .select('id')
      .single();
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true, id: data?.id ? String(data.id) : undefined };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan voucher ke Supabase.',
    };
  }
}

export async function deleteVoucherFromSupabase(voucherId: string, code?: string): Promise<SupabaseSyncStatus> {
  if (!isSupabaseConfigured || !supabase) {
    return { mode: 'local', synced: true };
  }
  try {
    const query = isUuid(voucherId)
      ? supabase.from('vouchers').delete().eq('id', voucherId)
      : code
        ? supabase.from('vouchers').delete().eq('code', code)
        : null;
    if (!query) return { mode: 'local', synced: true };
    const { error } = await query;
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menghapus voucher dari Supabase.',
    };
  }
}

export async function incrementVoucherUsageInSupabase(
  voucherId: string,
  code: string,
  nextUsedCount: number
): Promise<SupabaseSyncStatus> {
  if (!isSupabaseConfigured || !supabase) {
    return { mode: 'local', synced: true };
  }
  try {
    const query = isUuid(voucherId)
      ? supabase.from('vouchers').update({ used_count: nextUsedCount }).eq('id', voucherId)
      : supabase.from('vouchers').update({ used_count: nextUsedCount }).eq('code', code);
    const { error } = await query;
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal memperbarui kuota voucher di Supabase.',
    };
  }
}

/**
 * Cancels an order atomically in Supabase via `cancel_order_atomic` RPC
 * (restoring recipe stock, reversing member points/spent, and restoring voucher quota),
 * falling back to direct `orders` status update if RPC is not installed yet.
 */
export async function cancelOrderInSupabase(
  orderId: string,
  orderNumber: string,
  notes?: string
): Promise<SupabaseSyncStatus> {
  if (!isSupabaseConfigured || !supabase) {
    return { mode: 'local', synced: true };
  }
  try {
    if (isUuid(orderId)) {
      const { data: rpcData, error: rpcError } = await supabase.rpc('cancel_order_atomic', {
        p_order_id: orderId,
        p_reason: notes ?? null,
      });

      if (!rpcError && rpcData && typeof rpcData === 'object') {
        const record = rpcData as { ok?: boolean; error?: string };
        if (record.ok === true) {
          return { mode: 'supabase', synced: true, id: orderId };
        }
        if (record.ok === false) {
          return {
            mode: 'supabase',
            synced: false,
            error: record.error || 'Pembatalan atomik ditolak oleh Supabase.',
          };
        }
      }

      const rpcMissing =
        rpcError &&
        (rpcError.code === 'PGRST202' ||
          rpcError.code === '42883' ||
          rpcError.message.toLowerCase().includes('could not find the function'));

      if (rpcError && !rpcMissing) {
        return { mode: 'supabase', synced: false, error: rpcError.message };
      }
    }

    const patch: Record<string, unknown> = { status: 'cancelled' };
    if (notes !== undefined) patch.notes = notes;
    const query = isUuid(orderId)
      ? supabase.from('orders').update(patch).eq('id', orderId)
      : supabase.from('orders').update(patch).eq('order_number', orderNumber);
    const { error } = await query;
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal membatalkan pesanan di Supabase.',
    };
  }
}

// -----------------------------------------------------------------------------
// Multi-Device Write Helpers (P1-1): Vendors, Restock Requests, Notifications, WA Logs
// -----------------------------------------------------------------------------
export async function upsertVendorToSupabase(
  vendor: VendorRecord
): Promise<SupabaseSyncStatus & { id?: string }> {
  if (!isSupabaseConfigured || !supabase) return { mode: 'local', synced: true };
  try {
    const payload = {
      name: vendor.name,
      contact_person: vendor.contact_person,
      phone: vendor.phone,
      email: vendor.email ?? '',
      category_type: vendor.category_type,
      supplied_items: vendor.supplied_items ?? [],
      address: vendor.address ?? '',
      payment_terms: vendor.payment_terms ?? 'Cash / Transfer',
      notes: vendor.notes ?? '',
      is_active: vendor.is_active !== false,
    };

    if (isUuid(vendor.id)) {
      const { error } = await supabase.from('vendors').update(payload).eq('id', vendor.id);
      if (error) return { mode: 'supabase', synced: false, error: error.message };
      return { mode: 'supabase', synced: true, id: vendor.id };
    }

    const { data, error } = await supabase.from('vendors').insert(payload).select('id').single();
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true, id: data?.id ? String(data.id) : undefined };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan data vendor ke Supabase.',
    };
  }
}

export async function deleteVendorFromSupabase(vendorId: string): Promise<SupabaseSyncStatus> {
  if (!isSupabaseConfigured || !supabase || !isUuid(vendorId)) {
    return { mode: 'local', synced: true };
  }
  try {
    const { error } = await supabase.from('vendors').delete().eq('id', vendorId);
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menghapus vendor dari Supabase.',
    };
  }
}

export async function insertRestockRequestToSupabase(
  request: RestockRequestRecord
): Promise<SupabaseSyncStatus & { id?: string }> {
  if (!isSupabaseConfigured || !supabase) return { mode: 'local', synced: true };
  try {
    const { data, error } = await supabase
      .from('restock_requests')
      .insert({
        inventory_item_id: isUuid(request.inventory_item_id) ? request.inventory_item_id : null,
        item_name: request.item_name,
        unit: request.unit,
        current_stock: request.current_stock,
        requested_quantity: request.requested_quantity,
        urgency: request.urgency,
        notes: request.notes ?? '',
        requested_by_id: request.requested_by_id,
        requested_by_name: request.requested_by_name,
        requested_by_role: request.requested_by_role,
        status: request.status,
        handled_by_name: request.handled_by_name ?? null,
      })
      .select('id')
      .single();

    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true, id: data?.id ? String(data.id) : undefined };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal mengirim permintaan restock ke Supabase.',
    };
  }
}

export async function updateRestockRequestStatusInSupabase(
  requestId: string,
  status: RestockRequestStatus,
  handledByName: string
): Promise<SupabaseSyncStatus> {
  if (!isSupabaseConfigured || !supabase || !isUuid(requestId)) {
    return { mode: 'local', synced: true };
  }
  try {
    const { error } = await supabase
      .from('restock_requests')
      .update({
        status,
        handled_by_name: handledByName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId);
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal memperbarui status restock di Supabase.',
    };
  }
}

export async function insertOperationalNotificationToSupabase(
  notif: AppNotification
): Promise<SupabaseSyncStatus & { id?: string }> {
  if (!isSupabaseConfigured || !supabase) return { mode: 'local', synced: true };
  try {
    const { data, error } = await supabase
      .from('operational_notifications')
      .insert({
        type: notif.type,
        title: notif.title,
        message: notif.message,
        target_page: notif.targetPage,
        target_roles: notif.targetRoles ?? ['owner', 'manager', 'cashier'],
        sender_name: notif.senderName ?? 'BrewFlow System',
        sender_role: notif.senderRole ?? 'owner',
        restock_request_id: notif.restockRequestId ?? null,
        unread: notif.unread,
      })
      .select('id')
      .single();
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true, id: data?.id ? String(data.id) : undefined };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan notifikasi ke Supabase.',
    };
  }
}

export async function markOperationalNotificationReadInSupabase(
  notificationId: string
): Promise<SupabaseSyncStatus> {
  if (!isSupabaseConfigured || !supabase || !isUuid(notificationId)) {
    return { mode: 'local', synced: true };
  }
  try {
    const { error } = await supabase
      .from('operational_notifications')
      .update({ unread: false })
      .eq('id', notificationId);
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menandai notifikasi telah dibaca.',
    };
  }
}

export async function insertWhatsAppLogToSupabase(
  log: WhatsAppLogEntry
): Promise<SupabaseSyncStatus> {
  if (!isSupabaseConfigured || !supabase) return { mode: 'local', synced: true };
  try {
    const { error } = await supabase.from('whatsapp_logs').insert({
      event_type: log.event_type,
      targets: log.targets,
      preview: log.preview,
      mode: log.mode,
      status: log.status,
      error: log.error ?? null,
      sent_at: log.sent_at,
    });
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan log WhatsApp ke Supabase.',
    };
  }
}
