export type UserRole = 'owner' | 'manager' | 'cashier';

export type PageId =
  | 'dashboard'
  | 'pos'
  | 'orders'
  | 'menu-hpp'
  | 'inventory'
  | 'purchasing'
  | 'stock-opname'
  | 'membership'
  | 'tv-display'
  | 'employees'
  | 'settings';

export type ItemCategoryType = 'raw_material' | 'packaging' | 'asset' | 'operational';
export type ExpenseCategoryId =
  | 'pembelian_bahan_baku'
  | 'gaji_karyawan'
  | 'sewa_tempat'
  | 'listrik_air_internet'
  | 'gas_kebersihan'
  | 'kemasan_perlengkapan'
  | 'pemasaran_promo'
  | 'komisi_platform_online'
  | 'perawatan_mesin'
  | 'pajak_perizinan'
  | 'cicilan_pinjaman'
  | 'pembelian_asset'
  | 'biaya_lain_lain';

export type AssetCondition = 'Baik' | 'Perlu Servis' | 'Rusak';
export type EmploymentStatus = 'Tetap' | 'Kontrak' | 'Part-Time' | 'Probation';
export type OrderType = 'dine_in' | 'takeaway' | 'delivery';
export type PaymentMethod = 'cash' | 'qris' | 'debit';
export type ExpensePaymentMethod = 'transfer' | 'cash' | 'qris' | 'debit';
export type OrderStatus = 'draft' | 'completed' | 'cancelled';
export type MemberTier = 'Silver' | 'Gold' | 'Platinum';
export type OpnameFrequency = 'daily' | 'weekly' | 'monthly';

export interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  phone_number: string;
  avatar_initials: string;
  photo_url?: string;
  is_active: boolean;
  shift?: string;
  position?: string;
  employment_status?: EmploymentStatus;
  monthly_salary?: number;
  join_date?: string;
  emergency_contact?: string;
  notes?: string;
  created_at: string;
}

export interface Category {
  id: string;
  name: string;
  icon_name: 'grid' | 'coffee' | 'cup-soda' | 'utensils' | 'cookie';
  sort_order: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  category_type: ItemCategoryType;
  expense_category?: ExpenseCategoryId;
  unit: string;
  current_stock: number;
  min_stock_threshold: number;
  last_purchase_price: number;
  asset_condition?: AssetCondition;
  updated_at: string;
}

export interface MenuRecipeItem {
  id: string;
  menu_id: string;
  inventory_item_id: string;
  quantity_needed: number;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  description: string;
  image_url?: string;
  selling_price: number;
  is_available: boolean;
  visual_tone: 'espresso' | 'latte' | 'matcha' | 'berry' | 'pastry' | 'savory' | 'chocolate' | 'citrus';
  recipes: MenuRecipeItem[];
}

export interface Customer {
  id: string;
  name: string;
  phone_number: string;
  email: string;
  points: number;
  tier: MemberTier;
  total_spent: number;
  created_at: string;
}

export interface CartItem {
  menu: MenuItem;
  quantity: number;
  note?: string;
}

export interface OrderItemRecord {
  id: string;
  menu_id: string;
  menu_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  notes?: string;
}

export interface OrderRecord {
  id: string;
  order_number: string;
  cashier_id: string;
  cashier_name: string;
  customer_id: string | null;
  customer_name: string | null;
  order_type: OrderType;
  table_number: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_method: PaymentMethod;
  status: OrderStatus;
  notes: string;
  items: OrderItemRecord[];
  created_at: string;
}

export interface PurchaseItemRecord {
  inventory_item_id: string | null;
  item_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
}

export interface PurchaseRecord {
  id: string;
  expense_category: ExpenseCategoryId;
  supplier_name: string;
  invoice_number: string;
  total_cost: number;
  payment_method?: ExpensePaymentMethod;
  notes?: string;
  purchased_by_name: string;
  purchase_date: string;
  items: PurchaseItemRecord[];
}

export interface StockOpnameSchedule {
  id: string;
  title: string;
  frequency: OpnameFrequency;
  execution_time: string;
  day_of_week?: number;
  day_of_month?: number;
  target_category: ItemCategoryType | 'all';
  is_active: boolean;
  is_due_now: boolean;
  last_completed_at?: string;
}

export interface StockOpnameDetailItem {
  inventory_item_id: string;
  item_name: string;
  sku: string;
  unit: string;
  system_stock: number;
  actual_stock: number;
  variance: number;
  unit_price: number;
  reason?: string;
}

export interface StockOpnameLog {
  id: string;
  schedule_id?: string | null;
  schedule_title: string;
  performed_by_name: string;
  notes: string;
  total_items_checked: number;
  discrepancy_count: number;
  completed_at: string;
  whatsapp_sent?: boolean;
  details?: StockOpnameDetailItem[];
}

export type WhatsAppEventType =
  | 'opname_reminder'
  | 'low_stock_alert'
  | 'pos_receipt'
  | 'opname_report'
  | 'test_message';

export interface WhatsAppLogEntry {
  id: string;
  event_type: WhatsAppEventType;
  targets: string[];
  preview: string;
  mode: 'edge_function' | 'demo_simulated';
  status: 'sent' | 'failed';
  error?: string;
  sent_at: string;
}

export type ThermalPrinterConnectionType = 'browser' | 'bluetooth' | 'network' | 'usb_serial';

export interface AppNotification {
  id: string;
  type: 'opname' | 'low_stock' | 'info';
  title: string;
  message: string;
  targetPage: PageId;
  timestamp: string;
  unread: boolean;
}

export interface StoreSettings {
  shopName: string;
  address: string;
  phone: string;
  customerServiceContact: string;
  shopLogoUrl: string | null;
  taxEnabled: boolean;
  taxPercent: number;
  taxLabel: string;
  receiptPaperWidth: '58mm' | '80mm';
  receiptHeaderText: string;
  receiptFooterText: string;
  receiptShowLogo: boolean;
  receiptShowCashierAndTable: boolean;
  receiptShowMemberInfo: boolean;
  receiptShowCustomerService: boolean;
  // Thermal Printer Hardware Sync Settings
  printerConnectionType: ThermalPrinterConnectionType;
  printerDeviceName: string;
  printerNetworkIp: string;
  printerNetworkPort: number;
  printerNetworkBridgeUrl: string;
  printerBaudRate: number;
  printerAutoCut: boolean;
  printerOpenCashDrawer: boolean;
  printerAutoPrintAfterPayment: boolean;
  printerCopies: number;
  // WhatsApp Gateway Settings
  whatsappGatewayProvider: 'fonnte' | 'wablas';
  whatsappGatewayUrl: string;
  whatsappOwnerPhone: string;
  whatsappManagerPhone: string;
  whatsappAutoReceipt: boolean;
  whatsappAutoOpnameReminder: boolean;
  whatsappAutoLowStock: boolean;
}

export type MembershipPromoType = 'new_member' | 'free_product' | 'discount' | 'double_points';

export interface MembershipTierRule {
  tier: MemberTier;
  min_total_spent: number;
  discount_percent: number;
  points_multiplier: number;
  welcome_benefit: string;
}

export interface RedeemableRewardItem {
  id: string;
  menu_id: string;
  menu_name: string;
  points_required: number;
  max_redemptions_per_member: number;
  total_quota: number;
  redeemed_count: number;
  is_active: boolean;
}

export interface MembershipPromoProgram {
  id: string;
  title: string;
  description: string;
  promo_type: MembershipPromoType;
  start_date: string;
  end_date: string;
  max_redemptions_per_member: number;
  max_customer_quota: number;
  claimed_count: number;
  bonus_points?: number;
  discount_percent?: number;
  reward_menu_id?: string | null;
  reward_menu_name?: string | null;
  eligible_tiers: MemberTier[];
  is_active: boolean;
}

export interface RedemptionLimitConfig {
  min_points_to_redeem: number;
  max_free_products_per_day: number;
  max_free_products_per_month: number;
  point_earning_step_rupiah: number;
  new_member_welcome_points: number;
  new_member_promo_enabled: boolean;
  new_member_promo_title: string;
  new_member_promo_start_date: string;
  new_member_promo_end_date: string;
  new_member_max_quota: number;
  new_member_claimed_count: number;
  new_member_free_menu_id: string | null;
}

export interface MembershipProgramConfig {
  limits: RedemptionLimitConfig;
  tiers: MembershipTierRule[];
  rewards: RedeemableRewardItem[];
  promos: MembershipPromoProgram[];
}

export interface MemberRedemptionLog {
  id: string;
  customer_id: string;
  customer_name: string;
  reward_id?: string;
  promo_id?: string;
  label: string;
  points_spent: number;
  redeemed_at: string;
}

export interface StoreVideoItem {
  id: string;
  title: string;
  subtitle?: string;
  source_type: 'mp4' | 'youtube' | 'upload';
  url: string;
  embed_url?: string;
  is_active: boolean;
  show_promo_ticker: boolean;
  created_by_name: string;
  created_at: string;
}



