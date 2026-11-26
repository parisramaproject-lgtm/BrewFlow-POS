import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  INITIAL_CATEGORIES,
  INITIAL_CUSTOMERS,
  INITIAL_EMPLOYEES,
  INITIAL_INVENTORY,
  INITIAL_MENUS,
  INITIAL_OPNAME_LOGS,
  INITIAL_OPNAME_SCHEDULES,
  INITIAL_ORDERS,
  INITIAL_PURCHASES,
  INITIAL_VOUCHERS,
} from '../data/seedData';
import type {
  AppNotification,
  AssetCondition,
  CartItem,
  Category,
  Customer,
  EmploymentStatus,
  ExpenseCategoryId,
  ExpensePaymentMethod,
  InventoryItem,
  ItemCategoryType,
  MemberRedemptionLog,
  MemberTier,
  MembershipProgramConfig,
  MembershipPromoProgram,
  MembershipTierRule,
  MenuItem,
  OpnameFrequency,
  OrderRecord,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PurchaseItemRecord,
  PurchaseRecord,
  RedeemableRewardItem,
  RedemptionLimitConfig,
  StockOpnameDetailItem,
  StockOpnameLog,
  StockOpnameSchedule,
  StoreSettings,
  StoreVideoItem,
  UserProfile,
  UserRole,
  UsernameLoginAuditLog,
  VoucherRecord,
  WhatsAppEventType,
  WhatsAppLogEntry,
} from '../types';
import { DEFAULT_OWNER_ALERT_EMAIL } from '../services/loginAlertService';
import { hashPasswordLocal, normalizeUsername, validatePassword, validateUsername } from '../utils/usernameAuth';
import { getDefaultExpenseCategoryForInventory } from '../utils/expenseCategories';
import {
  DEFAULT_MEMBERSHIP_PROGRAM,
  isNewMemberPromoEligible,
  validatePromoClaim,
  validateRewardRedemption,
} from '../utils/membershipProgram';
import { calculateCartSummary, calculateOpnameVariance } from '../utils/posCalculations';
import { isOpnameScheduleDue } from '../utils/opnameScheduler';
import { INITIAL_STORE_VIDEOS } from '../utils/tvDisplay';
import {
  computeRecipeStockDeductions,
  computeUpdatedMember,
  persistCustomerToSupabase,
  persistOrderToSupabase,
  type StockDeductionSummary,
  type SupabaseSyncStatus,
} from '../services/posService';
import {
  applyPurchaseToInventory,
  deleteInventoryItemFromSupabase,
  deleteMenuItemFromSupabase,
  deleteOpnameScheduleFromSupabase,
  fetchActiveOpnameSchedulesFromSupabase,
  persistPurchaseToSupabase,
  persistStockOpnameToSupabase,
  persistStoreSettingsToSupabase,
  removeInventoryAndPruneRecipes,
  syncMenuRecipesToSupabase,
  upsertInventoryItemToSupabase,
  upsertMenuItemToSupabase,
  upsertOpnameScheduleToSupabase,
} from '../services/operationsService';
import {
  buildLowStockPayload,
  buildOpnameReportPayload,
  buildPosReceiptPayload,
  dispatchWhatsAppNotification,
} from '../services/whatsappService';
import { getAppSessionToken, supabase } from '../lib/supabase';
import {
  deleteOrderFromSupabase,
  deleteStoreVideoFromSupabase,
  deleteVoucherFromSupabase,
  hydrateAllTablesFromSupabase,
  incrementVoucherUsageInSupabase,
  persistMemberRedemptionToSupabase,
  persistMembershipProgramToSupabase,
  updateCustomerPointsInSupabase,
  upsertStoreVideoToSupabase,
  upsertVoucherToSupabase,
} from '../services/supabaseHydrationService';
import { evaluateVoucherOnCart, normalizeVoucherCode } from '../utils/vouchers';

export type { StoreSettings };

const SETTINGS_STORAGE_KEY = 'brewflow_store_settings_v1';
const MEMBERSHIP_PROGRAM_STORAGE_KEY = 'brewflow_membership_program_v1';
const STORE_VIDEOS_STORAGE_KEY = 'brewflow_tv_videos_v1';
const EMPLOYEES_STORAGE_KEY = 'brewflow_employees_v1';
const USERNAME_LOGIN_LOGS_STORAGE_KEY = 'brewflow_username_login_logs_v1';
const VOUCHERS_STORAGE_KEY = 'brewflow_vouchers_v1';

interface CreateOrderInput {
  items: CartItem[];
  orderType: OrderType;
  tableNumber: string;
  customer: Customer | null;
  paymentMethod: PaymentMethod;
  notes: string;
  status: OrderStatus;
  cashier: UserProfile;
  replacesDraftId?: string | null;
  appliedVoucher?: VoucherRecord | null;
  enableSupabaseSync?: boolean;
}

export interface CreateOrderResult {
  order: OrderRecord;
  pointsEarned: number;
  deductions: StockDeductionSummary[];
  syncStatus: SupabaseSyncStatus;
  whatsappReceiptLog?: WhatsAppLogEntry | null;
}

export interface InventoryItemInput {
  name: string;
  sku: string;
  category_type: ItemCategoryType;
  expense_category?: ExpenseCategoryId;
  unit: string;
  current_stock: number;
  min_stock_threshold: number;
  last_purchase_price: number;
  asset_condition?: AssetCondition;
  enableSupabaseSync?: boolean;
}

export interface MenuItemInput {
  name: string;
  category_id: string;
  selling_price: number;
  description: string;
  visual_tone: MenuItem['visual_tone'];
  image_url?: string;
  is_available?: boolean;
  enableSupabaseSync?: boolean;
}

export interface SubmitStockOpnameResult {
  log: StockOpnameLog;
  whatsappLog: WhatsAppLogEntry | null;
  syncStatus: SupabaseSyncStatus;
}

interface SendWhatsAppActionInput {
  eventType: WhatsAppEventType;
  targets: string[];
  data?: Record<string, unknown>;
  customMessage?: string;
  enableSupabaseSync?: boolean;
}

interface StoreContextValue {
  categories: Category[];
  menus: MenuItem[];
  inventory: InventoryItem[];
  orders: OrderRecord[];
  customers: Customer[];
  membershipProgram: MembershipProgramConfig;
  redemptionLogs: MemberRedemptionLog[];
  storeVideos: StoreVideoItem[];
  vouchers: VoucherRecord[];
  purchases: PurchaseRecord[];
  opnameSchedules: StockOpnameSchedule[];
  dueOpnameSchedules: StockOpnameSchedule[];
  opnameLogs: StockOpnameLog[];
  whatsappLogs: WhatsAppLogEntry[];
  usernameLoginLogs: UsernameLoginAuditLog[];
  employees: UserProfile[];
  settings: StoreSettings;
  notifications: AppNotification[];
  hasDueOpname: boolean;
  lowStockItems: InventoryItem[];
  addVoucher: (input: Omit<VoucherRecord, 'id' | 'used_count' | 'created_at'>) => Promise<{ ok: boolean; voucher?: VoucherRecord; error?: string }>;
  addVoucherBatch: (
    codes: string[],
    template: Omit<VoucherRecord, 'id' | 'code' | 'used_count' | 'created_at'>
  ) => Promise<{ ok: boolean; count: number; vouchers: VoucherRecord[] }>;
  updateVoucher: (
    voucherId: string,
    patch: Partial<Omit<VoucherRecord, 'id' | 'created_at'>>
  ) => Promise<{ ok: boolean; error?: string }>;
  toggleVoucherActive: (voucherId: string) => void;
  deleteVoucher: (voucherId: string) => void;
  refreshAllFromSupabase: () => Promise<void>;
  refreshOpnameWatcher: (enableSupabaseSync?: boolean) => Promise<void>;
  sendWhatsAppMessage: (input: SendWhatsAppActionInput) => Promise<WhatsAppLogEntry>;
  createOrder: (input: CreateOrderInput) => Promise<CreateOrderResult>;
  deleteDraftOrder: (orderId: string) => void;
  addCustomer: (input: {
    name: string;
    phone_number: string;
    email: string;
    enableSupabaseSync?: boolean;
  }) => Promise<Customer>;
  adjustCustomerPoints: (customerId: string, delta: number) => void;
  updateMembershipLimits: (patch: Partial<RedemptionLimitConfig>) => void;
  updateMembershipTier: (
    tier: MemberTier,
    patch: Partial<Omit<MembershipTierRule, 'tier'>>
  ) => void;
  addRedeemableReward: (input: Omit<RedeemableRewardItem, 'id' | 'redeemed_count'>) => void;
  updateRedeemableReward: (rewardId: string, patch: Partial<RedeemableRewardItem>) => void;
  deleteRedeemableReward: (rewardId: string) => void;
  addMembershipPromo: (input: Omit<MembershipPromoProgram, 'id' | 'claimed_count'>) => void;
  updateMembershipPromo: (promoId: string, patch: Partial<MembershipPromoProgram>) => void;
  deleteMembershipPromo: (promoId: string) => void;
  redeemMemberReward: (
    customerId: string,
    rewardId: string
  ) => { ok: boolean; message: string };
  claimMemberPromo: (
    customerId: string,
    promoId: string
  ) => { ok: boolean; message: string };
  addStoreVideo: (input: Omit<StoreVideoItem, 'id' | 'created_at'>) => StoreVideoItem;
  deleteStoreVideo: (videoId: string) => void;
  toggleStoreVideo: (videoId: string) => void;
  moveStoreVideo: (videoId: string, direction: 'up' | 'down') => void;
  addMenuItem: (input: MenuItemInput) => Promise<MenuItem>;
  updateMenuItem: (menuId: string, patch: Partial<MenuItemInput>) => Promise<void>;
  deleteMenuItem: (menuId: string, enableSupabaseSync?: boolean) => Promise<void>;
  toggleMenuAvailability: (menuId: string, enableSupabaseSync?: boolean) => void;
  updateMenuRecipes: (
    menuId: string,
    recipes: MenuItem['recipes'],
    enableSupabaseSync?: boolean
  ) => Promise<void>;
  addInventoryItem: (input: InventoryItemInput) => Promise<InventoryItem>;
  updateInventoryItem: (
    itemId: string,
    patch: Partial<InventoryItemInput>
  ) => Promise<void>;
  deleteInventoryItem: (
    itemId: string,
    enableSupabaseSync?: boolean
  ) => Promise<{ affectedMenuCount: number }>;
  updateAssetCondition: (
    itemId: string,
    condition: AssetCondition,
    enableSupabaseSync?: boolean
  ) => Promise<void>;
  createPurchase: (input: {
    expense_category: ExpenseCategoryId;
    supplier_name: string;
    invoice_number: string;
    payment_method?: ExpensePaymentMethod;
    notes?: string;
    purchased_by_id: string;
    purchased_by_name: string;
    items: PurchaseItemRecord[];
    enableSupabaseSync?: boolean;
  }) => Promise<{ purchase: PurchaseRecord; syncStatus: SupabaseSyncStatus }>;
  submitStockOpname: (input: {
    scheduleId: string | null;
    scheduleTitle: string;
    performedById: string;
    performedByName: string;
    notes: string;
    counts: Array<{ inventoryItemId: string; actualStock: number; reason?: string }>;
    enableSupabaseSync?: boolean;
  }) => Promise<SubmitStockOpnameResult>;
  addOpnameSchedule: (input: {
    title: string;
    frequency: OpnameFrequency;
    execution_time: string;
    day_of_week?: number;
    day_of_month?: number;
    target_category: ItemCategoryType | 'all';
    enableSupabaseSync?: boolean;
  }) => Promise<StockOpnameSchedule>;
  toggleOpnameSchedule: (scheduleId: string, enableSupabaseSync?: boolean) => Promise<void>;
  deleteOpnameSchedule: (scheduleId: string, enableSupabaseSync?: boolean) => Promise<void>;
  addEmployee: (input: {
    full_name: string;
    email: string;
    username?: string;
    password?: string;
    role: UserRole;
    phone_number: string;
    shift: string;
    position?: string;
    employment_status?: EmploymentStatus;
    monthly_salary?: number;
    join_date?: string;
    emergency_contact?: string;
    notes?: string;
  }) => Promise<void>;
  updateEmployee: (employeeId: string, patch: Partial<UserProfile>) => void;
  setEmployeeCredentials: (
    employeeId: string,
    username: string,
    password?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  recordUsernameLoginLog: (entry: UsernameLoginAuditLog) => void;
  deleteEmployee: (employeeId: string) => void;
  updateEmployeeRole: (employeeId: string, role: UserRole) => void;
  updateSettings: (
    patch: Partial<StoreSettings>,
    enableSupabaseSync?: boolean
  ) => Promise<void>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export const INITIAL_SETTINGS: StoreSettings = {
  shopName: 'BrewFlow Coffee & Roastery',
  address: 'Jl. Kemang Raya No. 42, Jakarta Selatan',
  phone: '021-7192-4410',
  customerServiceContact: 'WA 0812-8800-1101 · @brewflow.coffee',
  shopLogoUrl: null,
  taxEnabled: true,
  taxPercent: 10,
  taxLabel: 'PB1 / Pajak Restoran',
  receiptPaperWidth: '58mm',
  receiptHeaderText: 'Freshly Roasted Specialty Coffee',
  receiptFooterText: 'Terima kasih telah berkunjung! Simpan struk ini untuk klaim poin member.',
  receiptShowLogo: true,
  receiptShowCashierAndTable: true,
  receiptShowMemberInfo: true,
  receiptShowCustomerService: true,
  // Thermal Printer Defaults
  printerConnectionType: 'browser',
  printerDeviceName: '',
  printerNetworkIp: '192.168.1.100',
  printerNetworkPort: 9100,
  printerNetworkBridgeUrl: 'http://localhost:8765/print',
  printerBaudRate: 9600,
  printerAutoCut: true,
  printerOpenCashDrawer: false,
  printerAutoPrintAfterPayment: false,
  printerCopies: 1,
  // WhatsApp Gateway Defaults
  whatsappGatewayProvider: 'fonnte',
  whatsappGatewayUrl: 'https://api.fonnte.com/send',
  whatsappOwnerPhone: '0812-8800-1101',
  whatsappManagerPhone: '0813-7721-4402',
  whatsappAutoReceipt: true,
  whatsappAutoOpnameReminder: true,
  whatsappAutoLowStock: true,
  // Owner Login Confirmation Email Alert
  ownerLoginAlertEmail: DEFAULT_OWNER_ALERT_EMAIL,
};

function loadInitialSettings(): StoreSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return INITIAL_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<StoreSettings>;
    return { ...INITIAL_SETTINGS, ...parsed };
  } catch {
    return INITIAL_SETTINGS;
  }
}

function loadInitialMembershipProgram(): MembershipProgramConfig {
  try {
    const raw = window.localStorage.getItem(MEMBERSHIP_PROGRAM_STORAGE_KEY);
    if (!raw) return DEFAULT_MEMBERSHIP_PROGRAM;
    const parsed = JSON.parse(raw) as Partial<MembershipProgramConfig>;
    return {
      limits: { ...DEFAULT_MEMBERSHIP_PROGRAM.limits, ...(parsed.limits ?? {}) },
      tiers:
        Array.isArray(parsed.tiers) && parsed.tiers.length > 0
          ? parsed.tiers
          : DEFAULT_MEMBERSHIP_PROGRAM.tiers,
      rewards: Array.isArray(parsed.rewards) ? parsed.rewards : DEFAULT_MEMBERSHIP_PROGRAM.rewards,
      promos: Array.isArray(parsed.promos) ? parsed.promos : DEFAULT_MEMBERSHIP_PROGRAM.promos,
    };
  } catch {
    return DEFAULT_MEMBERSHIP_PROGRAM;
  }
}

function loadInitialStoreVideos(): StoreVideoItem[] {
  try {
    const raw = window.localStorage.getItem(STORE_VIDEOS_STORAGE_KEY);
    if (!raw) return INITIAL_STORE_VIDEOS;
    const parsed = JSON.parse(raw) as StoreVideoItem[];
    if (!Array.isArray(parsed)) return INITIAL_STORE_VIDEOS;
    // Strip stale blob: URLs from previous browser sessions
    const valid = parsed.filter((v) => v && v.url && !v.url.startsWith('blob:'));
    return valid.length > 0 ? valid : INITIAL_STORE_VIDEOS;
  } catch {
    return INITIAL_STORE_VIDEOS;
  }
}

function loadInitialEmployees(): UserProfile[] {
  try {
    const raw = window.localStorage.getItem(EMPLOYEES_STORAGE_KEY);
    if (!raw) return INITIAL_EMPLOYEES;
    const parsed = JSON.parse(raw) as UserProfile[];
    if (!Array.isArray(parsed) || parsed.length === 0) return INITIAL_EMPLOYEES;
    return parsed;
  } catch {
    return INITIAL_EMPLOYEES;
  }
}

function loadInitialUsernameLoginLogs(): UsernameLoginAuditLog[] {
  try {
    const raw = window.localStorage.getItem(USERNAME_LOGIN_LOGS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UsernameLoginAuditLog[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadInitialVouchers(): VoucherRecord[] {
  try {
    const raw = window.localStorage.getItem(VOUCHERS_STORAGE_KEY);
    if (!raw) return INITIAL_VOUCHERS;
    const parsed = JSON.parse(raw) as VoucherRecord[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_VOUCHERS;
  } catch {
    return INITIAL_VOUCHERS;
  }
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [categories, setCategories] = useState<Category[]>(INITIAL_CATEGORIES);
  const [menus, setMenus] = useState<MenuItem[]>(INITIAL_MENUS);
  const [inventory, setInventory] = useState<InventoryItem[]>(INITIAL_INVENTORY);
  const [orders, setOrders] = useState<OrderRecord[]>(INITIAL_ORDERS);
  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS);
  const [membershipProgram, setMembershipProgram] = useState<MembershipProgramConfig>(
    loadInitialMembershipProgram
  );
  const [redemptionLogs, setRedemptionLogs] = useState<MemberRedemptionLog[]>([]);
  const [storeVideos, setStoreVideos] = useState<StoreVideoItem[]>(loadInitialStoreVideos);
  const [vouchers, setVouchers] = useState<VoucherRecord[]>(loadInitialVouchers);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>(INITIAL_PURCHASES);
  const [opnameSchedules, setOpnameSchedules] =
    useState<StockOpnameSchedule[]>(INITIAL_OPNAME_SCHEDULES);
  const [opnameLogs, setOpnameLogs] = useState<StockOpnameLog[]>(INITIAL_OPNAME_LOGS);
  const [whatsappLogs, setWhatsappLogs] = useState<WhatsAppLogEntry[]>([]);
  const [usernameLoginLogs, setUsernameLoginLogs] = useState<UsernameLoginAuditLog[]>(
    loadInitialUsernameLoginLogs
  );
  const [employees, setEmployees] = useState<UserProfile[]>(loadInitialEmployees);
  const [settings, setSettings] = useState<StoreSettings>(loadInitialSettings);
  const [watcherNow, setWatcherNow] = useState<Date>(() => new Date());

  const persistVouchers = useCallback((next: VoucherRecord[]) => {
    try {
      window.localStorage.setItem(VOUCHERS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  const lowStockItems = useMemo(
    () =>
      inventory.filter(
        (item) => item.category_type !== 'asset' && item.current_stock <= item.min_stock_threshold
      ),
    [inventory]
  );

  const dueOpnameSchedules = useMemo(
    () => opnameSchedules.filter((sch) => isOpnameScheduleDue(sch, watcherNow)),
    [opnameSchedules, watcherNow]
  );

  const hasDueOpname = dueOpnameSchedules.length > 0;

  const notifications = useMemo<AppNotification[]>(() => {
    const items: AppNotification[] = [];
    for (const schedule of dueOpnameSchedules) {
      items.push({
        id: `notif-opname-${schedule.id}`,
        type: 'opname',
        title: 'Jadwal Stock Opname Jatuh Tempo',
        message: `${schedule.title} dijadwalkan pukul ${schedule.execution_time} WIB dan belum dikerjakan hari ini.`,
        targetPage: 'stock-opname',
        timestamp: 'Hari ini',
        unread: true,
      });
    }
    for (const inv of lowStockItems) {
      items.push({
        id: `notif-stock-${inv.id}`,
        type: 'low_stock',
        title: 'Stok Menipis',
        message: `${inv.name} tersisa ${inv.current_stock} ${inv.unit} (batas min. ${inv.min_stock_threshold} ${inv.unit}).`,
        targetPage: 'inventory',
        timestamp: 'Otomatis',
        unread: true,
      });
    }
    return items;
  }, [dueOpnameSchedules, lowStockItems]);

  const sendWhatsAppMessage = useCallback(
    async (input: SendWhatsAppActionInput): Promise<WhatsAppLogEntry> => {
      const log = await dispatchWhatsAppNotification({
        eventType: input.eventType,
        targets: input.targets,
        shopName: settings.shopName,
        data: input.data,
        customMessage: input.customMessage,
        enableSupabaseSync: input.enableSupabaseSync ?? false,
      });
      setWhatsappLogs((prev) => [log, ...prev].slice(0, 30));
      return log;
    },
    [settings.shopName]
  );

  const refreshOpnameWatcher = useCallback(async (enableSupabaseSync = false) => {
    setWatcherNow(new Date());
    if (enableSupabaseSync) {
      const remoteSchedules = await fetchActiveOpnameSchedulesFromSupabase(true);
      if (remoteSchedules && remoteSchedules.length > 0) {
        setOpnameSchedules(remoteSchedules);
      }
    }
  }, []);

  const createOrder = useCallback(
    async (input: CreateOrderInput): Promise<CreateOrderResult> => {
      const voucherEval = input.appliedVoucher
        ? evaluateVoucherOnCart(input.appliedVoucher, input.items, new Date(), menus)
        : null;
      const appliedVoucherValid = Boolean(input.appliedVoucher && voucherEval?.valid);
      const voucherDiscount = appliedVoucherValid ? voucherEval!.discountAmount : 0;

      const summary = calculateCartSummary(input.items, input.customer?.tier ?? null, {
        taxEnabled: settings.taxEnabled,
        taxPercent: settings.taxPercent,
        tierRules: membershipProgram.tiers,
        pointEarningStepRupiah: membershipProgram.limits.point_earning_step_rupiah,
        voucherDiscountAmount: voucherDiscount,
        voucherCode: appliedVoucherValid ? input.appliedVoucher!.code : null,
        voucherStackableWithMember: input.appliedVoucher?.stackable_with_member_discount ?? true,
      });
      const sequence = String(orders.length + 2).padStart(3, '0');
      const voucherNoteSuffix =
        appliedVoucherValid && input.appliedVoucher
          ? `[Voucher ${input.appliedVoucher.code}: -Rp ${summary.voucherDiscountAmount.toLocaleString('id-ID')}]`
          : '';
      const combinedNotes = [input.notes.trim(), voucherNoteSuffix].filter(Boolean).join(' · ');

      const newOrder: OrderRecord = {
        id: `ord-${Date.now()}`,
        order_number: `BF-261125-${sequence}`,
        cashier_id: input.cashier.id,
        cashier_name: input.cashier.full_name,
        customer_id: input.customer?.id ?? null,
        customer_name: input.customer?.name ?? null,
        order_type: input.orderType,
        table_number:
          input.orderType === 'dine_in'
            ? input.tableNumber || 'Meja 01'
            : input.orderType === 'takeaway'
              ? 'Takeaway'
              : 'Delivery',
        subtotal: summary.subtotal,
        discount_amount: summary.discountAmount,
        voucher_code: summary.voucherCode,
        voucher_discount_amount: summary.voucherDiscountAmount,
        tax_amount: summary.taxAmount,
        total_amount: summary.totalAmount,
        payment_method: input.paymentMethod,
        status: input.status,
        notes: combinedNotes,
        items: input.items.map((cartItem, idx) => ({
          id: `oi-${Date.now()}-${idx}`,
          menu_id: cartItem.menu.id,
          menu_name: cartItem.menu.name,
          quantity: cartItem.quantity,
          unit_price: cartItem.menu.selling_price,
          subtotal: cartItem.menu.selling_price * cartItem.quantity,
          notes: cartItem.note,
        })),
        created_at: new Date().toISOString(),
      };

      setOrders((prev) => {
        const filtered = input.replacesDraftId
          ? prev.filter((o) => o.id !== input.replacesDraftId)
          : prev;
        return [newOrder, ...filtered];
      });

      let deductions: StockDeductionSummary[] = [];
      let updatedCustomer: Customer | null = null;
      let newlyLowStock: InventoryItem[] = [];

      if (input.status === 'completed') {
        if (appliedVoucherValid && input.appliedVoucher) {
          const targetVoucher = input.appliedVoucher;
          const nextUsedCount = (targetVoucher.used_count || 0) + 1;
          setVouchers((prev) => {
            const next = prev.map((v) =>
              v.id === targetVoucher.id ? { ...v, used_count: nextUsedCount } : v
            );
            persistVouchers(next);
            return next;
          });
          if (input.enableSupabaseSync ?? false) {
            void incrementVoucherUsageInSupabase(
              targetVoucher.id,
              targetVoucher.code,
              nextUsedCount
            );
          }
        }

        const stockCalc = computeRecipeStockDeductions(input.items, inventory);
        deductions = stockCalc.summary;
        if (deductions.length > 0) {
          setInventory(stockCalc.updatedInventory);
          const touchedIds = new Set(deductions.map((d) => d.inventoryItemId));
          newlyLowStock = stockCalc.updatedInventory.filter(
            (inv) =>
              touchedIds.has(inv.id) &&
              inv.category_type !== 'asset' &&
              inv.current_stock <= inv.min_stock_threshold
          );
        }

        if (input.customer) {
          updatedCustomer = computeUpdatedMember(
            input.customer,
            summary.totalAmount,
            summary.pointsEarned,
            membershipProgram.tiers
          );
          const customerId = input.customer.id;
          const nextCustomer = updatedCustomer;
          setCustomers((prev) => prev.map((c) => (c.id === customerId ? nextCustomer : c)));
        }
      }

      const syncStatus = await persistOrderToSupabase({
        order: newOrder,
        cartItems: input.items,
        updatedCustomer,
        deductions,
        enableSupabaseSync: input.enableSupabaseSync ?? false,
      });

      const finalOrder: OrderRecord =
        syncStatus.synced && syncStatus.id ? { ...newOrder, id: syncStatus.id } : newOrder;

      if (syncStatus.synced && syncStatus.id) {
        setOrders((prev) =>
          prev.map((o) => (o.id === newOrder.id ? { ...o, id: syncStatus.id! } : o))
        );
      }

      if (input.replacesDraftId && (input.enableSupabaseSync ?? false)) {
        void deleteOrderFromSupabase(input.replacesDraftId);
      }

      let whatsappReceiptLog: WhatsAppLogEntry | null = null;
      if (input.status === 'completed') {
        // Auto-send digital WhatsApp receipt & points to member customer
        if (settings.whatsappAutoReceipt && input.customer?.phone_number) {
          whatsappReceiptLog = await sendWhatsAppMessage({
            eventType: 'pos_receipt',
            targets: [input.customer.phone_number],
            data: buildPosReceiptPayload({
              order: newOrder,
              pointsEarned: summary.pointsEarned,
              totalPoints: updatedCustomer?.points,
              memberTier: updatedCustomer?.tier,
            }),
            enableSupabaseSync: input.enableSupabaseSync ?? false,
          });
        }

        // Auto-send low-stock alert if recipe deduction pushed items below threshold
        if (settings.whatsappAutoLowStock && newlyLowStock.length > 0) {
          const targets = [settings.whatsappOwnerPhone, settings.whatsappManagerPhone].filter(
            Boolean
          );
          if (targets.length > 0) {
            void sendWhatsAppMessage({
              eventType: 'low_stock_alert',
              targets,
              data: buildLowStockPayload(newlyLowStock),
              enableSupabaseSync: input.enableSupabaseSync ?? false,
            });
          }
        }
      }

      return {
        order: finalOrder,
        pointsEarned: summary.pointsEarned,
        deductions,
        syncStatus,
        whatsappReceiptLog,
      };
    },
    [
      orders.length,
      menus,
      inventory,
      persistVouchers,
      membershipProgram.tiers,
      membershipProgram.limits.point_earning_step_rupiah,
      settings.taxEnabled,
      settings.taxPercent,
      settings.whatsappAutoReceipt,
      settings.whatsappAutoLowStock,
      settings.whatsappOwnerPhone,
      settings.whatsappManagerPhone,
      sendWhatsAppMessage,
    ]
  );

  const deleteDraftOrder = useCallback((orderId: string) => {
    setOrders((prev) => prev.filter((o) => !(o.id === orderId && o.status === 'draft')));
    void deleteOrderFromSupabase(orderId);
  }, []);

  const persistProgram = useCallback((next: MembershipProgramConfig) => {
    try {
      window.localStorage.setItem(MEMBERSHIP_PROGRAM_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
    void persistMembershipProgramToSupabase(next);
  }, []);

  const persistVideos = useCallback((next: StoreVideoItem[]) => {
    try {
      const storable = next.filter((v) => !v.url.startsWith('blob:'));
      window.localStorage.setItem(STORE_VIDEOS_STORAGE_KEY, JSON.stringify(storable));
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  const addCustomer = useCallback(
    async (input: {
      name: string;
      phone_number: string;
      email: string;
      enableSupabaseSync?: boolean;
    }): Promise<Customer> => {
      const promoEligible = isNewMemberPromoEligible(membershipProgram.limits);
      const welcomePoints = promoEligible
        ? Math.max(0, membershipProgram.limits.new_member_welcome_points)
        : 0;

      const created: Customer = {
        id: `cust-${Date.now()}`,
        name: input.name.trim(),
        phone_number: input.phone_number.trim(),
        email: input.email.trim(),
        points: welcomePoints,
        tier: 'Silver',
        total_spent: 0,
        created_at: new Date().toISOString(),
      };
      setCustomers((prev) => [created, ...prev]);

      if (promoEligible) {
        setMembershipProgram((prev) => {
          const next: MembershipProgramConfig = {
            ...prev,
            limits: {
              ...prev.limits,
              new_member_claimed_count: prev.limits.new_member_claimed_count + 1,
            },
          };
          persistProgram(next);
          return next;
        });
      }

      const sync = await persistCustomerToSupabase(created, input.enableSupabaseSync ?? false);
      if (sync.synced && sync.id) {
        const persisted = { ...created, id: sync.id };
        setCustomers((prev) => prev.map((c) => (c.id === created.id ? persisted : c)));
        return persisted;
      }
      return created;
    },
    [membershipProgram.limits, persistProgram]
  );

  const adjustCustomerPoints = useCallback((customerId: string, delta: number) => {
    let updatedTarget: Customer | null = null;
    setCustomers((prev) =>
      prev.map((c) => {
        if (c.id !== customerId) return c;
        updatedTarget = { ...c, points: Math.max(0, c.points + delta) };
        return updatedTarget;
      })
    );
    if (updatedTarget) {
      void updateCustomerPointsInSupabase(updatedTarget);
    }
  }, []);

  const updateMembershipLimits = useCallback(
    (patch: Partial<RedemptionLimitConfig>) => {
      setMembershipProgram((prev) => {
        const next: MembershipProgramConfig = {
          ...prev,
          limits: { ...prev.limits, ...patch },
        };
        persistProgram(next);
        return next;
      });
    },
    [persistProgram]
  );

  const updateMembershipTier = useCallback(
    (tier: MemberTier, patch: Partial<Omit<MembershipTierRule, 'tier'>>) => {
      setMembershipProgram((prev) => {
        const next: MembershipProgramConfig = {
          ...prev,
          tiers: prev.tiers.map((rule) => (rule.tier === tier ? { ...rule, ...patch } : rule)),
        };
        persistProgram(next);
        return next;
      });
    },
    [persistProgram]
  );

  const addRedeemableReward = useCallback(
    (input: Omit<RedeemableRewardItem, 'id' | 'redeemed_count'>) => {
      const created: RedeemableRewardItem = {
        ...input,
        id: `rew-${Date.now()}`,
        redeemed_count: 0,
      };
      setMembershipProgram((prev) => {
        const next: MembershipProgramConfig = {
          ...prev,
          rewards: [created, ...prev.rewards],
        };
        persistProgram(next);
        return next;
      });
    },
    [persistProgram]
  );

  const updateRedeemableReward = useCallback(
    (rewardId: string, patch: Partial<RedeemableRewardItem>) => {
      setMembershipProgram((prev) => {
        const next: MembershipProgramConfig = {
          ...prev,
          rewards: prev.rewards.map((r) => (r.id === rewardId ? { ...r, ...patch } : r)),
        };
        persistProgram(next);
        return next;
      });
    },
    [persistProgram]
  );

  const deleteRedeemableReward = useCallback(
    (rewardId: string) => {
      setMembershipProgram((prev) => {
        const next: MembershipProgramConfig = {
          ...prev,
          rewards: prev.rewards.filter((r) => r.id !== rewardId),
        };
        persistProgram(next);
        return next;
      });
    },
    [persistProgram]
  );

  const addMembershipPromo = useCallback(
    (input: Omit<MembershipPromoProgram, 'id' | 'claimed_count'>) => {
      const created: MembershipPromoProgram = {
        ...input,
        id: `promo-${Date.now()}`,
        claimed_count: 0,
      };
      setMembershipProgram((prev) => {
        const next: MembershipProgramConfig = {
          ...prev,
          promos: [created, ...prev.promos],
        };
        persistProgram(next);
        return next;
      });
    },
    [persistProgram]
  );

  const updateMembershipPromo = useCallback(
    (promoId: string, patch: Partial<MembershipPromoProgram>) => {
      setMembershipProgram((prev) => {
        const next: MembershipProgramConfig = {
          ...prev,
          promos: prev.promos.map((p) => (p.id === promoId ? { ...p, ...patch } : p)),
        };
        persistProgram(next);
        return next;
      });
    },
    [persistProgram]
  );

  const deleteMembershipPromo = useCallback(
    (promoId: string) => {
      setMembershipProgram((prev) => {
        const next: MembershipProgramConfig = {
          ...prev,
          promos: prev.promos.filter((p) => p.id !== promoId),
        };
        persistProgram(next);
        return next;
      });
    },
    [persistProgram]
  );

  const redeemMemberReward = useCallback(
    (customerId: string, rewardId: string): { ok: boolean; message: string } => {
      const customer = customers.find((c) => c.id === customerId);
      const reward = membershipProgram.rewards.find((r) => r.id === rewardId);
      if (!customer || !reward) {
        return { ok: false, message: 'Data member atau produk penukaran tidak ditemukan.' };
      }

      const check = validateRewardRedemption({
        customer,
        reward,
        limits: membershipProgram.limits,
        logs: redemptionLogs,
      });
      if (!check.ok) {
        return { ok: false, message: check.reason };
      }

      const cost = Math.max(reward.points_required, membershipProgram.limits.min_points_to_redeem);
      const updatedCustomer: Customer = {
        ...customer,
        points: Math.max(0, customer.points - cost),
      };
      setCustomers((prev) =>
        prev.map((c) => (c.id === customerId ? updatedCustomer : c))
      );
      setMembershipProgram((prev) => {
        const next: MembershipProgramConfig = {
          ...prev,
          rewards: prev.rewards.map((r) =>
            r.id === rewardId ? { ...r, redeemed_count: r.redeemed_count + 1 } : r
          ),
        };
        persistProgram(next);
        return next;
      });
      const logEntry: MemberRedemptionLog = {
        id: `rdm-${Date.now()}`,
        customer_id: customer.id,
        customer_name: customer.name,
        reward_id: reward.id,
        label: `Tukar Poin: Gratis ${reward.menu_name}`,
        points_spent: cost,
        redeemed_at: new Date().toISOString(),
      };
      setRedemptionLogs((prev) => [logEntry, ...prev]);
      void persistMemberRedemptionToSupabase(logEntry, updatedCustomer);

      return {
        ok: true,
        message: `${customer.name} berhasil menukarkan ${cost} poin untuk Gratis ${reward.menu_name}.`,
      };
    },
    [customers, membershipProgram, redemptionLogs, persistProgram]
  );

  const claimMemberPromo = useCallback(
    (customerId: string, promoId: string): { ok: boolean; message: string } => {
      const customer = customers.find((c) => c.id === customerId);
      const promo = membershipProgram.promos.find((p) => p.id === promoId);
      if (!customer || !promo) {
        return { ok: false, message: 'Data member atau promo tidak ditemukan.' };
      }

      const check = validatePromoClaim({
        customer,
        promo,
        logs: redemptionLogs,
      });
      if (!check.ok) {
        return { ok: false, message: check.reason };
      }

      const bonusPts = promo.bonus_points ?? 0;
      const updatedCustomer: Customer | undefined =
        bonusPts > 0 ? { ...customer, points: customer.points + bonusPts } : undefined;
      if (updatedCustomer) {
        setCustomers((prev) =>
          prev.map((c) => (c.id === customerId ? updatedCustomer : c))
        );
      }

      setMembershipProgram((prev) => {
        const next: MembershipProgramConfig = {
          ...prev,
          promos: prev.promos.map((p) =>
            p.id === promoId ? { ...p, claimed_count: p.claimed_count + 1 } : p
          ),
        };
        persistProgram(next);
        return next;
      });

      const logEntry: MemberRedemptionLog = {
        id: `clm-${Date.now()}`,
        customer_id: customer.id,
        customer_name: customer.name,
        promo_id: promo.id,
        label: `Klaim Promo: ${promo.title}`,
        points_spent: 0,
        redeemed_at: new Date().toISOString(),
      };
      setRedemptionLogs((prev) => [logEntry, ...prev]);
      void persistMemberRedemptionToSupabase(logEntry, updatedCustomer);

      return {
        ok: true,
        message: `${customer.name} berhasil mengikuti promo "${promo.title}"${bonusPts > 0 ? ` (+${bonusPts} poin)` : ''}.`,
      };
    },
    [customers, membershipProgram, redemptionLogs, persistProgram]
  );

  const addStoreVideo = useCallback(
    (input: Omit<StoreVideoItem, 'id' | 'created_at'>): StoreVideoItem => {
      const created: StoreVideoItem = {
        ...input,
        id: `vid-${Date.now()}`,
        created_at: new Date().toISOString(),
      };
      setStoreVideos((prev) => {
        const next = [created, ...prev];
        persistVideos(next);
        return next;
      });
      void upsertStoreVideoToSupabase(created, 0).then((sync) => {
        if (sync.synced && sync.id) {
          setStoreVideos((prev) => {
            const next = prev.map((v) => (v.id === created.id ? { ...v, id: sync.id! } : v));
            persistVideos(next);
            return next;
          });
        }
      });
      return created;
    },
    [persistVideos]
  );

  const deleteStoreVideo = useCallback(
    (videoId: string) => {
      setStoreVideos((prev) => {
        const target = prev.find((v) => v.id === videoId);
        if (target?.url.startsWith('blob:')) {
          URL.revokeObjectURL(target.url);
        }
        const next = prev.filter((v) => v.id !== videoId);
        persistVideos(next);
        return next;
      });
      void deleteStoreVideoFromSupabase(videoId);
    },
    [persistVideos]
  );

  const toggleStoreVideo = useCallback(
    (videoId: string) => {
      let toggled: StoreVideoItem | null = null;
      let toggledIdx = 0;
      setStoreVideos((prev) => {
        const next = prev.map((v, idx) => {
          if (v.id !== videoId) return v;
          toggled = { ...v, is_active: !v.is_active };
          toggledIdx = idx;
          return toggled;
        });
        persistVideos(next);
        return next;
      });
      if (toggled) {
        void upsertStoreVideoToSupabase(toggled, toggledIdx);
      }
    },
    [persistVideos]
  );

  const moveStoreVideo = useCallback(
    (videoId: string, direction: 'up' | 'down') => {
      let reordered: StoreVideoItem[] = [];
      setStoreVideos((prev) => {
        const idx = prev.findIndex((v) => v.id === videoId);
        if (idx < 0) return prev;
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= prev.length) return prev;
        const next = [...prev];
        [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
        reordered = next;
        persistVideos(next);
        return next;
      });
      if (reordered.length > 0) {
        reordered.forEach((v, idx) => {
          void upsertStoreVideoToSupabase(v, idx);
        });
      }
    },
    [persistVideos]
  );

  const addMenuItem = useCallback(async (input: MenuItemInput): Promise<MenuItem> => {
    const created: MenuItem = {
      id: `menu-${Date.now()}`,
      category_id: input.category_id,
      name: input.name.trim(),
      description: input.description.trim(),
      image_url: input.image_url,
      selling_price: input.selling_price,
      is_available: input.is_available ?? true,
      visual_tone: input.visual_tone,
      recipes: [],
    };
    setMenus((prev) => [created, ...prev]);
    const sync = await upsertMenuItemToSupabase(created, true, input.enableSupabaseSync ?? false);
    if (sync.synced && sync.id) {
      const persisted = { ...created, id: sync.id };
      setMenus((prev) => prev.map((m) => (m.id === created.id ? persisted : m)));
      return persisted;
    }
    return created;
  }, []);

  const updateMenuItem = useCallback(
    async (menuId: string, patch: Partial<MenuItemInput>): Promise<void> => {
      let updatedMenu: MenuItem | null = null;
      setMenus((prev) =>
        prev.map((m) => {
          if (m.id !== menuId) return m;
          updatedMenu = {
            ...m,
            name: patch.name !== undefined ? patch.name.trim() : m.name,
            category_id: patch.category_id ?? m.category_id,
            selling_price: patch.selling_price ?? m.selling_price,
            description:
              patch.description !== undefined ? patch.description.trim() : m.description,
            visual_tone: patch.visual_tone ?? m.visual_tone,
            image_url: 'image_url' in patch ? patch.image_url : m.image_url,
            is_available: patch.is_available ?? m.is_available,
          };
          return updatedMenu;
        })
      );
      if (updatedMenu) {
        await upsertMenuItemToSupabase(updatedMenu, false, patch.enableSupabaseSync ?? false);
      }
    },
    []
  );

  const deleteMenuItem = useCallback(
    async (menuId: string, enableSupabaseSync = false): Promise<void> => {
      setMenus((prev) => prev.filter((m) => m.id !== menuId));
      await deleteMenuItemFromSupabase(menuId, enableSupabaseSync);
    },
    []
  );

  const toggleMenuAvailability = useCallback(
    (menuId: string, enableSupabaseSync = false) => {
      const target = menus.find((m) => m.id === menuId);
      if (!target) return;
      const updated: MenuItem = { ...target, is_available: !target.is_available };
      setMenus((prev) => prev.map((m) => (m.id === menuId ? updated : m)));
      void upsertMenuItemToSupabase(updated, false, enableSupabaseSync);
    },
    [menus]
  );

  const updateMenuRecipes = useCallback(
    async (
      menuId: string,
      recipes: MenuItem['recipes'],
      enableSupabaseSync = false
    ): Promise<void> => {
      setMenus((prev) => prev.map((m) => (m.id === menuId ? { ...m, recipes } : m)));
      await syncMenuRecipesToSupabase(menuId, recipes, enableSupabaseSync);
    },
    []
  );

  const addInventoryItem = useCallback(
    async (input: InventoryItemInput): Promise<InventoryItem> => {
      const prefix =
        input.category_type === 'raw_material'
          ? 'RM'
          : input.category_type === 'packaging'
            ? 'PK'
            : input.category_type === 'asset'
              ? 'AS'
              : 'OP';
      const created: InventoryItem = {
        id: `inv-${Date.now()}`,
        name: input.name.trim(),
        sku: input.sku.trim().toUpperCase() || `${prefix}-${Date.now().toString().slice(-3)}`,
        category_type: input.category_type,
        expense_category:
          input.expense_category ?? getDefaultExpenseCategoryForInventory(input.category_type),
        unit: input.unit.trim() || 'pcs',
        current_stock: Number(input.current_stock),
        min_stock_threshold:
          input.category_type === 'asset' ? 0 : Number(input.min_stock_threshold),
        last_purchase_price: Number(input.last_purchase_price),
        asset_condition:
          input.category_type === 'asset' ? input.asset_condition ?? 'Baik' : undefined,
        updated_at: new Date().toISOString(),
      };
      setInventory((prev) => [created, ...prev]);
      const sync = await upsertInventoryItemToSupabase(
        created,
        true,
        input.enableSupabaseSync ?? false
      );
      if (sync.synced && sync.id) {
        const persisted = { ...created, id: sync.id };
        setInventory((prev) => prev.map((inv) => (inv.id === created.id ? persisted : inv)));
        return persisted;
      }
      return created;
    },
    []
  );

  const updateInventoryItem = useCallback(
    async (itemId: string, patch: Partial<InventoryItemInput>): Promise<void> => {
      const nowIso = new Date().toISOString();
      let updatedItem: InventoryItem | null = null;
      setInventory((prev) =>
        prev.map((inv) => {
          if (inv.id !== itemId) return inv;
          const nextCategory = patch.category_type ?? inv.category_type;
          updatedItem = {
            ...inv,
            name: patch.name !== undefined ? patch.name.trim() : inv.name,
            sku: patch.sku !== undefined ? patch.sku.trim().toUpperCase() : inv.sku,
            category_type: nextCategory,
            expense_category:
              patch.expense_category ??
              inv.expense_category ??
              getDefaultExpenseCategoryForInventory(nextCategory),
            unit: patch.unit !== undefined ? patch.unit.trim() : inv.unit,
            current_stock:
              patch.current_stock !== undefined ? Number(patch.current_stock) : inv.current_stock,
            min_stock_threshold:
              nextCategory === 'asset'
                ? 0
                : patch.min_stock_threshold !== undefined
                  ? Number(patch.min_stock_threshold)
                  : inv.min_stock_threshold,
            last_purchase_price:
              patch.last_purchase_price !== undefined
                ? Number(patch.last_purchase_price)
                : inv.last_purchase_price,
            asset_condition:
              nextCategory === 'asset'
                ? patch.asset_condition ?? inv.asset_condition ?? 'Baik'
                : undefined,
            updated_at: nowIso,
          };
          return updatedItem;
        })
      );
      if (updatedItem) {
        const sync = await upsertInventoryItemToSupabase(
          updatedItem,
          false,
          patch.enableSupabaseSync ?? false
        );
        if (sync.synced && sync.id && sync.id !== itemId) {
          setInventory((prev) =>
            prev.map((inv) => (inv.id === itemId ? { ...inv, id: sync.id! } : inv))
          );
        }
      }
    },
    []
  );

  const deleteInventoryItem = useCallback(
    async (itemId: string, enableSupabaseSync = false): Promise<{ affectedMenuCount: number }> => {
      const targetSku = inventory.find((i) => i.id === itemId)?.sku;
      const result = removeInventoryAndPruneRecipes(inventory, menus, itemId);
      setInventory(result.inventory);
      if (result.affectedMenuCount > 0) {
        setMenus(result.menus);
      }
      await deleteInventoryItemFromSupabase(itemId, enableSupabaseSync, targetSku);
      return { affectedMenuCount: result.affectedMenuCount };
    },
    [inventory, menus]
  );

  const updateAssetCondition = useCallback(
    async (
      itemId: string,
      condition: AssetCondition,
      enableSupabaseSync = false
    ): Promise<void> => {
      const target = inventory.find((i) => i.id === itemId);
      if (!target) return;
      const updated: InventoryItem = {
        ...target,
        asset_condition: condition,
        updated_at: new Date().toISOString(),
      };
      setInventory((prev) => prev.map((inv) => (inv.id === itemId ? updated : inv)));
      await upsertInventoryItemToSupabase(updated, false, enableSupabaseSync);
    },
    [inventory]
  );

  const createPurchase = useCallback(
    async (input: {
      expense_category: ExpenseCategoryId;
      supplier_name: string;
      invoice_number: string;
      payment_method?: ExpensePaymentMethod;
      notes?: string;
      purchased_by_id: string;
      purchased_by_name: string;
      items: PurchaseItemRecord[];
      enableSupabaseSync?: boolean;
    }): Promise<{ purchase: PurchaseRecord; syncStatus: SupabaseSyncStatus }> => {
      const nowIso = new Date().toISOString();
      const totalCost = input.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
      const record: PurchaseRecord = {
        id: `po-${Date.now()}`,
        expense_category: input.expense_category,
        supplier_name: input.supplier_name.trim(),
        invoice_number: input.invoice_number.trim() || `EXP-${Date.now().toString().slice(-6)}`,
        total_cost: totalCost,
        payment_method: input.payment_method ?? 'transfer',
        notes: input.notes?.trim() || undefined,
        purchased_by_name: input.purchased_by_name,
        purchase_date: nowIso,
        items: input.items,
      };
      setPurchases((prev) => [record, ...prev]);

      // Update inventory stock and latest purchase price for any stock-linked items
      const touchedIds = new Set(
        input.items
          .map((i) => i.inventory_item_id)
          .filter((id): id is string => Boolean(id))
      );

      let updatedInventoryItems: InventoryItem[] = [];
      if (touchedIds.size > 0) {
        const nextInventory = applyPurchaseToInventory(inventory, input.items, nowIso);
        setInventory(nextInventory);
        updatedInventoryItems = nextInventory.filter((inv) => touchedIds.has(inv.id));
      }

      const syncStatus = await persistPurchaseToSupabase({
        purchase: record,
        purchasedById: input.purchased_by_id,
        updatedInventoryItems,
        enableSupabaseSync: input.enableSupabaseSync ?? false,
      });

      const finalPurchase =
        syncStatus.synced && syncStatus.id ? { ...record, id: syncStatus.id } : record;
      if (syncStatus.synced && syncStatus.id) {
        setPurchases((prev) =>
          prev.map((p) => (p.id === record.id ? { ...p, id: syncStatus.id! } : p))
        );
      }

      return { purchase: finalPurchase, syncStatus };
    },
    [inventory]
  );

  const submitStockOpname = useCallback(
    async (input: {
      scheduleId: string | null;
      scheduleTitle: string;
      performedById: string;
      performedByName: string;
      notes: string;
      counts: Array<{ inventoryItemId: string; actualStock: number; reason?: string }>;
      enableSupabaseSync?: boolean;
    }): Promise<SubmitStockOpnameResult> => {
      const nowIso = new Date().toISOString();
      const countMap = new Map(input.counts.map((c) => [c.inventoryItemId, c]));
      const details: StockOpnameDetailItem[] = [];

      const nextInventory = inventory.map((inv) => {
        const entry = countMap.get(inv.id);
        if (!entry) return inv;
        const variance = calculateOpnameVariance(inv.current_stock, entry.actualStock);
        details.push({
          inventory_item_id: inv.id,
          item_name: inv.name,
          sku: inv.sku,
          unit: inv.unit,
          system_stock: inv.current_stock,
          actual_stock: entry.actualStock,
          variance,
          unit_price: inv.last_purchase_price,
          reason: entry.reason?.trim() || undefined,
        });
        return {
          ...inv,
          current_stock: entry.actualStock,
          updated_at: nowIso,
        };
      });

      const discrepancyCount = details.filter((d) => d.variance !== 0).length;
      const cleanNotes =
        input.notes.trim() || 'Stock opname selesai dan stok sistem telah disesuaikan.';

      setInventory(nextInventory);

      if (input.scheduleId) {
        setOpnameSchedules((prev) =>
          prev.map((sch) =>
            sch.id === input.scheduleId
              ? { ...sch, is_due_now: false, last_completed_at: nowIso }
              : sch
          )
        );
      }

      const baseLog: StockOpnameLog = {
        id: `oplog-${Date.now()}`,
        schedule_id: input.scheduleId,
        schedule_title: input.scheduleTitle,
        performed_by_name: input.performedByName,
        notes: cleanNotes,
        total_items_checked: details.length,
        discrepancy_count: discrepancyCount,
        completed_at: nowIso,
        details,
      };

      const syncStatus = await persistStockOpnameToSupabase({
        log: baseLog,
        performedById: input.performedById,
        details,
        enableSupabaseSync: input.enableSupabaseSync ?? false,
      });

      // Trigger discrepancy summary report to Owner's WhatsApp
      let whatsappLog: WhatsAppLogEntry | null = null;
      if (settings.whatsappOwnerPhone.trim()) {
        whatsappLog = await sendWhatsAppMessage({
          eventType: 'opname_report',
          targets: [settings.whatsappOwnerPhone],
          data: buildOpnameReportPayload({
            scheduleTitle: input.scheduleTitle,
            performedBy: input.performedByName,
            totalItemsChecked: details.length,
            discrepancyCount,
            notes: cleanNotes,
            details,
          }),
          enableSupabaseSync: input.enableSupabaseSync ?? false,
        });
      }

      const finalLog: StockOpnameLog = {
        ...baseLog,
        id: syncStatus.synced && syncStatus.id ? syncStatus.id : baseLog.id,
        whatsapp_sent: whatsappLog?.status === 'sent',
      };
      setOpnameLogs((prev) => [finalLog, ...prev]);

      return { log: finalLog, whatsappLog, syncStatus };
    },
    [inventory, settings.whatsappOwnerPhone, sendWhatsAppMessage]
  );

  const addOpnameSchedule = useCallback(
    async (input: {
      title: string;
      frequency: OpnameFrequency;
      execution_time: string;
      day_of_week?: number;
      day_of_month?: number;
      target_category: ItemCategoryType | 'all';
      enableSupabaseSync?: boolean;
    }): Promise<StockOpnameSchedule> => {
      const created: StockOpnameSchedule = {
        id: `sch-${Date.now()}`,
        title: input.title.trim(),
        frequency: input.frequency,
        execution_time: input.execution_time,
        day_of_week: input.frequency === 'weekly' ? input.day_of_week ?? 1 : undefined,
        day_of_month: input.frequency === 'monthly' ? input.day_of_month ?? 1 : undefined,
        target_category: input.target_category,
        is_active: true,
        is_due_now: false,
      };
      setOpnameSchedules((prev) => [created, ...prev]);
      setWatcherNow(new Date());
      const sync = await upsertOpnameScheduleToSupabase(
        created,
        true,
        input.enableSupabaseSync ?? false
      );
      if (sync.synced && sync.id) {
        const persisted = { ...created, id: sync.id };
        setOpnameSchedules((prev) => prev.map((s) => (s.id === created.id ? persisted : s)));
        return persisted;
      }
      return created;
    },
    []
  );

  const toggleOpnameSchedule = useCallback(
    async (scheduleId: string, enableSupabaseSync = false): Promise<void> => {
      const target = opnameSchedules.find((s) => s.id === scheduleId);
      if (!target) return;
      const updated: StockOpnameSchedule = { ...target, is_active: !target.is_active };
      setOpnameSchedules((prev) => prev.map((sch) => (sch.id === scheduleId ? updated : sch)));
      await upsertOpnameScheduleToSupabase(updated, false, enableSupabaseSync);
    },
    [opnameSchedules]
  );

  const deleteOpnameSchedule = useCallback(
    async (scheduleId: string, enableSupabaseSync = false): Promise<void> => {
      setOpnameSchedules((prev) => prev.filter((sch) => sch.id !== scheduleId));
      await deleteOpnameScheduleFromSupabase(scheduleId, enableSupabaseSync);
    },
    []
  );

  const persistEmployees = useCallback((next: UserProfile[]) => {
    try {
      window.localStorage.setItem(EMPLOYEES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  // Hydrate ALL operational tables + employees from Supabase when either Supabase Auth OR Username session is active
  const refreshAllFromSupabase = useCallback(async () => {
    if (!supabase) return;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session && !getAppSessionToken()) return;

      const [hydrated, empRes] = await Promise.all([
        hydrateAllTablesFromSupabase(INITIAL_SETTINGS),
        supabase.from('employees').select('*').order('created_at', { ascending: true }),
      ]);

      if (hydrated) {
        if (hydrated.categories) setCategories(hydrated.categories);
        if (hydrated.inventory) setInventory(hydrated.inventory);
        if (hydrated.menus) setMenus(hydrated.menus);
        if (hydrated.customers) setCustomers(hydrated.customers);
        if (hydrated.orders) setOrders(hydrated.orders);
        if (hydrated.purchases) setPurchases(hydrated.purchases);
        if (hydrated.opnameSchedules) setOpnameSchedules(hydrated.opnameSchedules);
        if (hydrated.opnameLogs) setOpnameLogs(hydrated.opnameLogs);
        if (hydrated.settings) {
          setSettings((prev) => {
            const merged = { ...prev, ...hydrated.settings };
            try {
              window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(merged));
            } catch {
              // Ignore storage quota errors
            }
            return merged;
          });
        }
        if (hydrated.membershipProgram) {
          setMembershipProgram(hydrated.membershipProgram);
          try {
            window.localStorage.setItem(
              MEMBERSHIP_PROGRAM_STORAGE_KEY,
              JSON.stringify(hydrated.membershipProgram)
            );
          } catch {
            // Ignore storage quota errors
          }
        }
        if (hydrated.redemptionLogs) setRedemptionLogs(hydrated.redemptionLogs);
        if (hydrated.storeVideos) {
          setStoreVideos(hydrated.storeVideos);
          persistVideos(hydrated.storeVideos);
        }
        if (hydrated.vouchers) {
          setVouchers(hydrated.vouchers);
          persistVouchers(hydrated.vouchers);
        }
      }

      if (!empRes.error && empRes.data && empRes.data.length > 0) {
        const mapped: UserProfile[] = empRes.data.map((row) => {
          const name = String(row.full_name || 'Karyawan');
          const initials = name
            .split(/\s+/)
            .map((p: string) => p[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();
          return {
            id: String(row.id),
            full_name: name,
            email: String(row.email || ''),
            username: row.username ? normalizeUsername(String(row.username)) : undefined,
            has_password: Boolean(row.has_password || row.password_hash),
            role: (row.role as UserRole) || 'cashier',
            phone_number: String(row.phone_number || '-'),
            avatar_initials: initials || 'ST',
            is_active: row.is_active !== false,
            shift: row.shift ? String(row.shift) : undefined,
            position: row.position ? String(row.position) : undefined,
            employment_status: (row.employment_status as EmploymentStatus) || 'Tetap',
            monthly_salary: Number(row.monthly_salary) || 0,
            join_date: row.join_date ? String(row.join_date) : undefined,
            emergency_contact: row.emergency_contact ? String(row.emergency_contact) : '',
            notes: row.notes ? String(row.notes) : '',
            created_at: String(row.created_at || new Date().toISOString()),
          };
        });

        setEmployees((prev) => {
          const merged = mapped.map((remote) => {
            const localMatch = prev.find(
              (item) => item.email.trim().toLowerCase() === remote.email.trim().toLowerCase()
            );
            return {
              ...remote,
              password_hash: localMatch?.password_hash,
              has_password: remote.has_password || Boolean(localMatch?.password_hash),
            };
          });
          persistEmployees(merged);
          return merged;
        });
      }
    } catch {
      // Keep local state intact if remote tables are not yet created
    }
  }, [persistEmployees, persistVideos]);

  useEffect(() => {
    if (!supabase) return;
    void refreshAllFromSupabase();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        void refreshAllFromSupabase();
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [refreshAllFromSupabase]);

  const syncEmployeeToSupabase = useCallback(async (employee: UserProfile) => {
    if (!supabase) return;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session && !getAppSessionToken()) return;

      await supabase.from('employees').upsert(
        {
          full_name: employee.full_name,
          email: employee.email.trim().toLowerCase(),
          username: employee.username ? normalizeUsername(employee.username) : null,
          role: employee.role,
          phone_number: employee.phone_number,
          is_active: employee.is_active,
          shift: employee.shift ?? null,
          position: employee.position ?? null,
          employment_status: employee.employment_status ?? null,
          monthly_salary: employee.monthly_salary ?? 0,
          join_date: employee.join_date || null,
          emergency_contact: employee.emergency_contact ?? '',
          notes: employee.notes ?? '',
        },
        { onConflict: 'email' }
      );
    } catch {
      // Safe fallback when Supabase `employees` table is not yet created
    }
  }, []);

  const deleteEmployeeFromSupabase = useCallback(async (email: string) => {
    if (!supabase || !email.trim()) return;
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session && !getAppSessionToken()) return;
      await supabase.from('employees').delete().ilike('email', email.trim());
    } catch {
      // Safe fallback
    }
  }, []);

  const recordUsernameLoginLog = useCallback((entry: UsernameLoginAuditLog) => {
    setUsernameLoginLogs((prev) => {
      const next = [entry, ...prev].slice(0, 50);
      try {
        window.localStorage.setItem(USERNAME_LOGIN_LOGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage quota restrictions
      }
      return next;
    });
  }, []);

  const addEmployee = useCallback(
    async (input: {
      full_name: string;
      email: string;
      username?: string;
      password?: string;
      role: UserRole;
      phone_number: string;
      shift: string;
      position?: string;
      employment_status?: EmploymentStatus;
      monthly_salary?: number;
      join_date?: string;
      emergency_contact?: string;
      notes?: string;
    }) => {
      const initials = input.full_name
        .trim()
        .split(/\s+/)
        .map((p) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
      const normalizedUser = input.username ? normalizeUsername(input.username) : undefined;
      const trimmedPass = input.password?.trim() || '';
      const passwordHash = trimmedPass ? await hashPasswordLocal(trimmedPass) : undefined;

      const created: UserProfile = {
        id: `emp-${Date.now()}`,
        full_name: input.full_name.trim(),
        email: input.email.trim(),
        username: normalizedUser || undefined,
        has_password: Boolean(passwordHash),
        password_hash: passwordHash,
        role: input.role,
        phone_number: input.phone_number.trim(),
        avatar_initials: initials || 'ST',
        is_active: true,
        shift: input.shift.trim() || 'Shift Pagi (07:00 - 15:00)',
        position: input.position?.trim() || 'Barista & Kasir',
        employment_status: input.employment_status ?? 'Kontrak',
        monthly_salary: input.monthly_salary ?? 0,
        join_date: input.join_date || new Date().toISOString().slice(0, 10),
        emergency_contact: input.emergency_contact?.trim() || '',
        notes: input.notes?.trim() || '',
        created_at: new Date().toISOString(),
      };
      setEmployees((prev) => {
        const next = [...prev, created];
        persistEmployees(next);
        return next;
      });
      await syncEmployeeToSupabase(created);
      if (supabase && normalizedUser && trimmedPass) {
        try {
          await supabase.rpc('set_employee_username_credentials', {
            p_email: created.email.trim().toLowerCase(),
            p_username: normalizedUser,
            p_password: trimmedPass,
          });
        } catch {
          // Safe fallback if RPC is not yet installed
        }
      }
    },
    [persistEmployees, syncEmployeeToSupabase]
  );

  const setEmployeeCredentials = useCallback(
    async (
      employeeId: string,
      usernameInput: string,
      passwordInput?: string
    ): Promise<{ ok: boolean; error?: string }> => {
      const target = employees.find((emp) => emp.id === employeeId);
      if (!target) {
        return { ok: false, error: 'Data karyawan tidak ditemukan.' };
      }

      const trimmedUsername = usernameInput.trim();
      let normalizedUser: string | undefined;
      if (trimmedUsername) {
        const checkUser = validateUsername(trimmedUsername);
        if (!checkUser.valid) {
          return { ok: false, error: checkUser.error };
        }
        normalizedUser = checkUser.normalized;
        const duplicate = employees.some(
          (other) =>
            other.id !== employeeId &&
            other.username &&
            normalizeUsername(other.username) === normalizedUser
        );
        if (duplicate) {
          return {
            ok: false,
            error: `Username "@${normalizedUser}" sudah dipakai karyawan lain.`,
          };
        }
      }

      const trimmedPass = (passwordInput ?? '').trim();
      if (trimmedPass) {
        const checkPass = validatePassword(trimmedPass);
        if (!checkPass.valid) {
          return { ok: false, error: checkPass.error };
        }
      } else if (normalizedUser && !target.has_password && !target.password_hash) {
        return {
          ok: false,
          error: 'Atur kata sandi (minimal 6 karakter) saat pertama kali mengaktifkan username login.',
        };
      }

      const nextHash = trimmedPass ? await hashPasswordLocal(trimmedPass) : target.password_hash;

      setEmployees((prev) => {
        const next = prev.map((emp) => {
          if (emp.id !== employeeId) return emp;
          return {
            ...emp,
            username: normalizedUser,
            password_hash: normalizedUser ? nextHash : undefined,
            has_password: Boolean(normalizedUser && (nextHash || emp.has_password)),
          };
        });
        persistEmployees(next);
        return next;
      });

      if (supabase) {
        try {
          const { data, error } = await supabase.rpc('set_employee_username_credentials', {
            p_email: target.email.trim().toLowerCase(),
            p_username: normalizedUser ?? '',
            p_password: trimmedPass || null,
          });
          if (!error && data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
            return {
              ok: false,
              error: String((data as { error?: string }).error || 'Gagal menyimpan kredensial ke Supabase.'),
            };
          }
        } catch {
          // Local PBKDF2 fallback remains updated
        }
      }

      return { ok: true };
    },
    [employees, persistEmployees]
  );

  const updateEmployee = useCallback(
    (employeeId: string, patch: Partial<UserProfile>) => {
      let updatedRecord: UserProfile | null = null;
      setEmployees((prev) => {
        const next = prev.map((emp) => {
          if (emp.id !== employeeId) return emp;
          const nextName =
            patch.full_name !== undefined ? patch.full_name.trim() || emp.full_name : emp.full_name;
          const nextInitials =
            patch.full_name !== undefined
              ? nextName
                  .split(/\s+/)
                  .map((p) => p[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase() || emp.avatar_initials
              : emp.avatar_initials;
          updatedRecord = {
            ...emp,
            ...patch,
            full_name: nextName,
            avatar_initials: nextInitials,
            email: patch.email !== undefined ? patch.email.trim() : emp.email,
            phone_number:
              patch.phone_number !== undefined ? patch.phone_number.trim() : emp.phone_number,
            shift: patch.shift !== undefined ? patch.shift.trim() : emp.shift,
            position: patch.position !== undefined ? patch.position.trim() : emp.position,
            emergency_contact:
              patch.emergency_contact !== undefined
                ? patch.emergency_contact.trim()
                : emp.emergency_contact,
            notes: patch.notes !== undefined ? patch.notes.trim() : emp.notes,
          };
          return updatedRecord;
        });
        persistEmployees(next);
        return next;
      });
      if (updatedRecord) {
        void syncEmployeeToSupabase(updatedRecord);
      }
    },
    [persistEmployees, syncEmployeeToSupabase]
  );

  const deleteEmployee = useCallback(
    (employeeId: string) => {
      let removedEmail = '';
      setEmployees((prev) => {
        const target = prev.find((emp) => emp.id === employeeId);
        removedEmail = target?.email ?? '';
        const next = prev.filter((emp) => emp.id !== employeeId);
        persistEmployees(next);
        return next;
      });
      if (removedEmail) {
        void deleteEmployeeFromSupabase(removedEmail);
      }
    },
    [persistEmployees, deleteEmployeeFromSupabase]
  );

  const updateEmployeeRole = useCallback(
    (employeeId: string, role: UserRole) => {
      let updatedRecord: UserProfile | null = null;
      setEmployees((prev) => {
        const next = prev.map((emp) => {
          if (emp.id !== employeeId) return emp;
          updatedRecord = { ...emp, role };
          return updatedRecord;
        });
        persistEmployees(next);
        return next;
      });
      if (updatedRecord) {
        void syncEmployeeToSupabase(updatedRecord);
      }
    },
    [persistEmployees, syncEmployeeToSupabase]
  );

  const updateSettings = useCallback(
    async (patch: Partial<StoreSettings>, enableSupabaseSync = false): Promise<void> => {
      const next: StoreSettings = { ...settings, ...patch };
      setSettings(next);
      try {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore quota errors (e.g. very large logo data URL)
      }
      await persistStoreSettingsToSupabase(next, enableSupabaseSync);
    },
    [settings]
  );

  const addVoucher = useCallback(
    async (
      input: Omit<VoucherRecord, 'id' | 'used_count' | 'created_at'>
    ): Promise<{ ok: boolean; voucher?: VoucherRecord; error?: string }> => {
      const code = normalizeVoucherCode(input.code);
      if (!code || code.length < 3) {
        return { ok: false, error: 'Kode voucher minimal 3 karakter huruf/angka.' };
      }
      if (vouchers.some((v) => normalizeVoucherCode(v.code) === code)) {
        return { ok: false, error: `Kode voucher "${code}" sudah terdaftar.` };
      }

      const newVoucher: VoucherRecord = {
        ...input,
        id: `vch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        code,
        used_count: 0,
        created_at: new Date().toISOString(),
      };

      setVouchers((prev) => {
        const next = [newVoucher, ...prev];
        persistVouchers(next);
        return next;
      });

      const sync = await upsertVoucherToSupabase(newVoucher);
      if (sync.synced && sync.id) {
        const persistedId = sync.id;
        setVouchers((prev) => {
          const next = prev.map((v) => (v.id === newVoucher.id ? { ...v, id: persistedId } : v));
          persistVouchers(next);
          return next;
        });
        return { ok: true, voucher: { ...newVoucher, id: persistedId } };
      }

      return { ok: true, voucher: newVoucher };
    },
    [vouchers, persistVouchers]
  );

  const addVoucherBatch = useCallback(
    async (
      codes: string[],
      template: Omit<VoucherRecord, 'id' | 'code' | 'used_count' | 'created_at'>
    ): Promise<{ ok: boolean; count: number; vouchers: VoucherRecord[] }> => {
      const existingSet = new Set(vouchers.map((v) => normalizeVoucherCode(v.code)));
      const nowIso = new Date().toISOString();
      const created: VoucherRecord[] = [];

      for (let i = 0; i < codes.length; i += 1) {
        const code = normalizeVoucherCode(codes[i]);
        if (!code || code.length < 3 || existingSet.has(code)) continue;
        existingSet.add(code);
        created.push({
          ...template,
          id: `vch-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 5)}`,
          code,
          used_count: 0,
          created_at: nowIso,
        });
      }

      if (created.length === 0) {
        return { ok: false, count: 0, vouchers: [] };
      }

      setVouchers((prev) => {
        const next = [...created, ...prev];
        persistVouchers(next);
        return next;
      });

      void Promise.all(
        created.map(async (voucher) => {
          const sync = await upsertVoucherToSupabase(voucher);
          if (sync.synced && sync.id) {
            setVouchers((prev) => {
              const next = prev.map((v) => (v.id === voucher.id ? { ...v, id: sync.id! } : v));
              persistVouchers(next);
              return next;
            });
          }
        })
      );

      return { ok: true, count: created.length, vouchers: created };
    },
    [vouchers, persistVouchers]
  );

  const updateVoucher = useCallback(
    async (
      voucherId: string,
      patch: Partial<Omit<VoucherRecord, 'id' | 'created_at'>>
    ): Promise<{ ok: boolean; error?: string }> => {
      const current = vouchers.find((v) => v.id === voucherId);
      if (!current) return { ok: false, error: 'Voucher tidak ditemukan.' };

      const nextCode = patch.code !== undefined ? normalizeVoucherCode(patch.code) : current.code;
      if (!nextCode || nextCode.length < 3) {
        return { ok: false, error: 'Kode voucher minimal 3 karakter.' };
      }
      if (
        nextCode !== current.code &&
        vouchers.some((v) => v.id !== voucherId && normalizeVoucherCode(v.code) === nextCode)
      ) {
        return { ok: false, error: `Kode voucher "${nextCode}" sudah digunakan.` };
      }

      const updated: VoucherRecord = {
        ...current,
        ...patch,
        code: nextCode,
      };

      setVouchers((prev) => {
        const next = prev.map((v) => (v.id === voucherId ? updated : v));
        persistVouchers(next);
        return next;
      });

      void upsertVoucherToSupabase(updated);
      return { ok: true };
    },
    [vouchers, persistVouchers]
  );

  const toggleVoucherActive = useCallback(
    (voucherId: string) => {
      let updatedVoucher: VoucherRecord | null = null;
      setVouchers((prev) => {
        const next = prev.map((v) => {
          if (v.id !== voucherId) return v;
          updatedVoucher = { ...v, is_active: !v.is_active };
          return updatedVoucher;
        });
        persistVouchers(next);
        return next;
      });
      if (updatedVoucher) {
        void upsertVoucherToSupabase(updatedVoucher);
      }
    },
    [persistVouchers]
  );

  const deleteVoucher = useCallback(
    (voucherId: string) => {
      const target = vouchers.find((v) => v.id === voucherId);
      setVouchers((prev) => {
        const next = prev.filter((v) => v.id !== voucherId);
        persistVouchers(next);
        return next;
      });
      void deleteVoucherFromSupabase(voucherId, target?.code);
    },
    [vouchers, persistVouchers]
  );

  const value = useMemo<StoreContextValue>(
    () => ({
      categories,
      menus,
      inventory,
      orders,
      customers,
      membershipProgram,
      redemptionLogs,
      storeVideos,
      vouchers,
      purchases,
      opnameSchedules,
      dueOpnameSchedules,
      opnameLogs,
      whatsappLogs,
      usernameLoginLogs,
      employees,
      settings,
      notifications,
      hasDueOpname,
      lowStockItems,
      addVoucher,
      addVoucherBatch,
      updateVoucher,
      toggleVoucherActive,
      deleteVoucher,
      refreshAllFromSupabase,
      refreshOpnameWatcher,
      sendWhatsAppMessage,
      createOrder,
      deleteDraftOrder,
      addCustomer,
      adjustCustomerPoints,
      updateMembershipLimits,
      updateMembershipTier,
      addRedeemableReward,
      updateRedeemableReward,
      deleteRedeemableReward,
      addMembershipPromo,
      updateMembershipPromo,
      deleteMembershipPromo,
      redeemMemberReward,
      claimMemberPromo,
      addStoreVideo,
      deleteStoreVideo,
      toggleStoreVideo,
      moveStoreVideo,
      addMenuItem,
      updateMenuItem,
      deleteMenuItem,
      toggleMenuAvailability,
      updateMenuRecipes,
      addInventoryItem,
      updateInventoryItem,
      deleteInventoryItem,
      updateAssetCondition,
      createPurchase,
      submitStockOpname,
      addOpnameSchedule,
      toggleOpnameSchedule,
      deleteOpnameSchedule,
      addEmployee,
      updateEmployee,
      setEmployeeCredentials,
      recordUsernameLoginLog,
      deleteEmployee,
      updateEmployeeRole,
      updateSettings,
    }),
    [
      categories,
      menus,
      inventory,
      orders,
      customers,
      membershipProgram,
      redemptionLogs,
      storeVideos,
      vouchers,
      purchases,
      opnameSchedules,
      dueOpnameSchedules,
      opnameLogs,
      whatsappLogs,
      usernameLoginLogs,
      employees,
      settings,
      notifications,
      hasDueOpname,
      lowStockItems,
      addVoucher,
      addVoucherBatch,
      updateVoucher,
      toggleVoucherActive,
      deleteVoucher,
      refreshAllFromSupabase,
      refreshOpnameWatcher,
      sendWhatsAppMessage,
      createOrder,
      deleteDraftOrder,
      addCustomer,
      adjustCustomerPoints,
      updateMembershipLimits,
      updateMembershipTier,
      addRedeemableReward,
      updateRedeemableReward,
      deleteRedeemableReward,
      addMembershipPromo,
      updateMembershipPromo,
      deleteMembershipPromo,
      redeemMemberReward,
      claimMemberPromo,
      addStoreVideo,
      deleteStoreVideo,
      toggleStoreVideo,
      moveStoreVideo,
      addMenuItem,
      updateMenuItem,
      deleteMenuItem,
      toggleMenuAvailability,
      updateMenuRecipes,
      addInventoryItem,
      updateInventoryItem,
      deleteInventoryItem,
      updateAssetCondition,
      createPurchase,
      submitStockOpname,
      addOpnameSchedule,
      toggleOpnameSchedule,
      deleteOpnameSchedule,
      addEmployee,
      updateEmployee,
      setEmployeeCredentials,
      recordUsernameLoginLog,
      deleteEmployee,
      updateEmployeeRole,
      updateSettings,
    ]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) {
    throw new Error('useStore harus digunakan di dalam StoreProvider.');
  }
  return ctx;
}
