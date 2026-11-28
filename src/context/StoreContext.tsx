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
  INITIAL_RESTOCK_REQUESTS,
  INITIAL_VENDORS,
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
  OperationalNotificationType,
  OrderRecord,
  OrderStatus,
  OrderType,
  PageId,
  PaymentMethod,
  PurchaseItemRecord,
  PurchaseRecord,
  RedeemableRewardItem,
  RedemptionLimitConfig,
  RestockRequestRecord,
  RestockRequestStatus,
  StockOpnameDetailItem,
  StockOpnameLog,
  StockOpnameSchedule,
  StoreSettings,
  StoreVideoItem,
  UserProfile,
  UserRole,
  UsernameLoginAuditLog,
  VendorRecord,
  VoucherRecord,
  WhatsAppEventType,
  WhatsAppLogEntry,
} from '../types';
import { DEFAULT_OWNER_ALERT_EMAIL } from '../services/loginAlertService';
import {
  hashPasswordLocal,
  normalizeUsername,
  sanitizeEmployeeForLocalCache,
  validatePassword,
  validateUsername,
} from '../utils/usernameAuth';
import { generateNextOrderNumber } from '../utils/orderNumber';
import { computeOrderReversal } from '../utils/orderReversal';
import {
  enqueuePendingOrder,
  getPendingOrders,
  isLikelyNetworkFailure,
  markPendingOrderFailed,
  removePendingOrder,
} from '../services/offlineQueueService';
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
  mergeInventoryWithNewItems,
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
import {
  broadcastOperationalEvent,
  subscribeOperationalBroadcast,
} from '../services/pwaNotificationService';
import { getAppSessionToken, supabase } from '../lib/supabase';
import {
  cancelOrderInSupabase,
  deleteOrderFromSupabase,
  deleteStoreVideoFromSupabase,
  deleteVendorFromSupabase,
  deleteVoucherFromSupabase,
  hydrateAllTablesFromSupabase,
  incrementVoucherUsageInSupabase,
  insertOperationalNotificationToSupabase,
  insertRestockRequestToSupabase,
  insertWhatsAppLogToSupabase,
  isUuid,
  markOperationalNotificationReadInSupabase,
  persistMemberRedemptionToSupabase,
  persistMembershipProgramToSupabase,
  updateCustomerPointsInSupabase,
  updateRestockRequestStatusInSupabase,
  upsertStoreVideoToSupabase,
  upsertVendorToSupabase,
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
  forceOfflineQueue?: boolean;
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
  recipes?: MenuItem['recipes'];
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
  vendors: VendorRecord[];
  restockRequests: RestockRequestRecord[];
  prefilledPurchaseVendorId: string | null;
  setPrefilledPurchaseVendorId: (vendorId: string | null) => void;
  purchases: PurchaseRecord[];
  opnameSchedules: StockOpnameSchedule[];
  dueOpnameSchedules: StockOpnameSchedule[];
  opnameLogs: StockOpnameLog[];
  whatsappLogs: WhatsAppLogEntry[];
  usernameLoginLogs: UsernameLoginAuditLog[];
  employees: UserProfile[];
  employeesSyncStatus: 'idle' | 'synced' | 'local_only' | 'error';
  employeesSyncError: string | null;
  settings: StoreSettings;
  notifications: AppNotification[];
  hasDueOpname: boolean;
  lowStockItems: InventoryItem[];
  pendingOfflineOrdersCount: number;
  isSyncingOfflineQueue: boolean;
  syncOfflineQueueNow: () => Promise<{ syncedCount: number; remainingCount: number }>;
  addVendor: (input: Omit<VendorRecord, 'id' | 'created_at'>) => VendorRecord;
  updateVendor: (vendorId: string, patch: Partial<Omit<VendorRecord, 'id' | 'created_at'>>) => void;
  deleteVendor: (vendorId: string) => void;
  submitRestockRequest: (input: {
    inventory_item_id: string;
    requested_quantity: number;
    urgency: 'normal' | 'urgent';
    notes?: string;
    requested_by_id: string;
    requested_by_name: string;
    requested_by_role: UserRole;
  }) => RestockRequestRecord | null;
  updateRestockRequestStatus: (
    requestId: string,
    status: RestockRequestStatus,
    handledByName: string
  ) => void;
  sendOperationalMessage: (input: {
    title: string;
    message: string;
    type?: OperationalNotificationType;
    targetRoles: UserRole[];
    targetPage: PageId;
    senderName: string;
    senderRole: UserRole;
  }) => AppNotification;
  markNotificationRead: (notificationId: string) => void;
  markAllNotificationsRead: (role: UserRole) => void;
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
  cancelOrder: (input: {
    orderId: string;
    reason?: string;
    cancelledByName: string;
    cancelledByRole: UserRole;
  }) => Promise<{ ok: boolean; error?: string }>;
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
    extraInventoryItems?: InventoryItem[];
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
  }) => Promise<{ ok: boolean; error?: string; syncedToSupabase?: boolean }>;
  updateEmployee: (
    employeeId: string,
    patch: Partial<UserProfile>
  ) => Promise<{ ok: boolean; error?: string }>;
  setEmployeeCredentials: (
    employeeId: string,
    username: string,
    password?: string
  ) => Promise<{ ok: boolean; error?: string }>;
  recordUsernameLoginLog: (entry: UsernameLoginAuditLog) => void;
  deleteEmployee: (employeeId: string) => Promise<{ ok: boolean; error?: string }>;
  revokeAllEmployeeSessions: (
    employeeId: string
  ) => Promise<{ ok: boolean; revokedCount?: number; error?: string }>;
  updateEmployeeRole: (
    employeeId: string,
    role: UserRole
  ) => Promise<{ ok: boolean; error?: string }>;
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

const VENDORS_STORAGE_KEY = 'brewflow_vendors_v1';
const RESTOCK_REQUESTS_STORAGE_KEY = 'brewflow_restock_requests_v1';
const OPS_NOTIFICATIONS_STORAGE_KEY = 'brewflow_ops_notifications_v1';

function loadInitialVendors(): VendorRecord[] {
  try {
    const raw = window.localStorage.getItem(VENDORS_STORAGE_KEY);
    if (!raw) return INITIAL_VENDORS;
    const parsed = JSON.parse(raw) as VendorRecord[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : INITIAL_VENDORS;
  } catch {
    return INITIAL_VENDORS;
  }
}

function loadInitialRestockRequests(): RestockRequestRecord[] {
  try {
    const raw = window.localStorage.getItem(RESTOCK_REQUESTS_STORAGE_KEY);
    if (!raw) return INITIAL_RESTOCK_REQUESTS;
    const parsed = JSON.parse(raw) as RestockRequestRecord[];
    return Array.isArray(parsed) ? parsed : INITIAL_RESTOCK_REQUESTS;
  } catch {
    return INITIAL_RESTOCK_REQUESTS;
  }
}

function loadInitialOpsNotifications(): AppNotification[] {
  try {
    const raw = window.localStorage.getItem(OPS_NOTIFICATIONS_STORAGE_KEY);
    if (!raw) {
      return [
        {
          id: 'notif-seed-restock-matcha',
          type: 'restock_request',
          title: 'Permintaan Restock dari Kasir',
          message:
            'Dimas Pratama mengajukan restock Bubuk Uji Matcha Ceremonial (500 gr · Mendesak). Sisa stok 180 gr.',
          targetPage: 'purchasing',
          targetRoles: ['owner', 'manager'],
          senderName: 'Dimas Pratama',
          senderRole: 'cashier',
          restockRequestId: 'req-init-matcha',
          timestamp: 'Hari ini, 09:15',
          createdAt: '2026-11-26T09:15:00Z',
          unread: true,
        },
      ];
    }
    const parsed = JSON.parse(raw) as AppNotification[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatShortTimeLabel(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(/\./g, ':');
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
  const [vendors, setVendors] = useState<VendorRecord[]>(loadInitialVendors);
  const [restockRequests, setRestockRequests] = useState<RestockRequestRecord[]>(
    loadInitialRestockRequests
  );
  const [prefilledPurchaseVendorId, setPrefilledPurchaseVendorId] = useState<string | null>(null);
  const [customNotifications, setCustomNotifications] = useState<AppNotification[]>(
    loadInitialOpsNotifications
  );
  const [readAutoNotifIds, setReadAutoNotifIds] = useState<Set<string>>(() => new Set());
  const [purchases, setPurchases] = useState<PurchaseRecord[]>(INITIAL_PURCHASES);
  const [opnameSchedules, setOpnameSchedules] =
    useState<StockOpnameSchedule[]>(INITIAL_OPNAME_SCHEDULES);
  const [opnameLogs, setOpnameLogs] = useState<StockOpnameLog[]>(INITIAL_OPNAME_LOGS);
  const [whatsappLogs, setWhatsappLogs] = useState<WhatsAppLogEntry[]>([]);
  const [usernameLoginLogs, setUsernameLoginLogs] = useState<UsernameLoginAuditLog[]>(
    loadInitialUsernameLoginLogs
  );
  const [employees, setEmployees] = useState<UserProfile[]>(loadInitialEmployees);
  const [employeesSyncStatus, setEmployeesSyncStatus] = useState<
    'idle' | 'synced' | 'local_only' | 'error'
  >('idle');
  const [employeesSyncError, setEmployeesSyncError] = useState<string | null>(null);
  const [settings, setSettings] = useState<StoreSettings>(loadInitialSettings);
  const [watcherNow, setWatcherNow] = useState<Date>(() => new Date());
  const [pendingOfflineOrdersCount, setPendingOfflineOrdersCount] = useState<number>(0);
  const [isSyncingOfflineQueue, setIsSyncingOfflineQueue] = useState<boolean>(false);

  const persistVouchers = useCallback((next: VoucherRecord[]) => {
    try {
      window.localStorage.setItem(VOUCHERS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  const persistVendors = useCallback((next: VendorRecord[]) => {
    try {
      window.localStorage.setItem(VENDORS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  const persistRestockRequests = useCallback((next: RestockRequestRecord[]) => {
    try {
      window.localStorage.setItem(RESTOCK_REQUESTS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  const persistOpsNotifications = useCallback((next: AppNotification[]) => {
    try {
      window.localStorage.setItem(OPS_NOTIFICATIONS_STORAGE_KEY, JSON.stringify(next.slice(0, 60)));
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  const pushOperationalNotification = useCallback(
    (notif: Omit<AppNotification, 'id' | 'timestamp' | 'createdAt' | 'unread'>): AppNotification => {
      const now = new Date();
      const created: AppNotification = {
        ...notif,
        id: `ops-notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: `Hari ini, ${formatShortTimeLabel(now)}`,
        createdAt: now.toISOString(),
        unread: true,
      };
      setCustomNotifications((prev) => {
        const next = [created, ...prev].slice(0, 60);
        persistOpsNotifications(next);
        return next;
      });
      broadcastOperationalEvent(created);
      void insertOperationalNotificationToSupabase(created).then((sync) => {
        if (sync.synced && sync.id) {
          setCustomNotifications((prev) => {
            const next = prev.map((n) => (n.id === created.id ? { ...n, id: sync.id! } : n));
            persistOpsNotifications(next);
            return next;
          });
        }
      });
      return created;
    },
    [persistOpsNotifications]
  );

  // Sync operational notifications & restock requests across tabs in real time
  useEffect(() => {
    const unsubscribe = subscribeOperationalBroadcast((incoming) => {
      setCustomNotifications((prev) => {
        if (prev.some((n) => n.id === incoming.id)) return prev;
        return [incoming, ...prev].slice(0, 60);
      });
    });

    const handleStorage = (event: StorageEvent) => {
      if (event.key === OPS_NOTIFICATIONS_STORAGE_KEY && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue) as AppNotification[];
          if (Array.isArray(parsed)) setCustomNotifications(parsed);
        } catch {
          // Ignore malformed storage payload
        }
      }
      if (event.key === RESTOCK_REQUESTS_STORAGE_KEY && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue) as RestockRequestRecord[];
          if (Array.isArray(parsed)) setRestockRequests(parsed);
        } catch {
          // Ignore malformed storage payload
        }
      }
      if (event.key === VENDORS_STORAGE_KEY && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue) as VendorRecord[];
          if (Array.isArray(parsed)) setVendors(parsed);
        } catch {
          // Ignore malformed storage payload
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const addVendor = useCallback(
    (input: Omit<VendorRecord, 'id' | 'created_at'>): VendorRecord => {
      const created: VendorRecord = {
        ...input,
        id: `vnd-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        name: input.name.trim(),
        contact_person: input.contact_person.trim(),
        phone: input.phone.trim(),
        email: input.email?.trim() || undefined,
        address: input.address?.trim() || undefined,
        payment_terms: input.payment_terms?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        supplied_items: input.supplied_items.map((s) => s.trim()).filter(Boolean),
        created_at: new Date().toISOString(),
      };
      setVendors((prev) => {
        const next = [created, ...prev];
        persistVendors(next);
        return next;
      });
      void upsertVendorToSupabase(created).then((sync) => {
        if (sync.synced && sync.id) {
          setVendors((prev) => {
            const next = prev.map((v) => (v.id === created.id ? { ...v, id: sync.id! } : v));
            persistVendors(next);
            return next;
          });
        }
      });
      return created;
    },
    [persistVendors]
  );

  const updateVendor = useCallback(
    (vendorId: string, patch: Partial<Omit<VendorRecord, 'id' | 'created_at'>>) => {
      let updatedTarget: VendorRecord | null = null;
      setVendors((prev) => {
        const next = prev.map((v) => {
          if (v.id !== vendorId) return v;
          updatedTarget = {
            ...v,
            ...patch,
            name: patch.name !== undefined ? patch.name.trim() : v.name,
            contact_person:
              patch.contact_person !== undefined
                ? patch.contact_person.trim()
                : v.contact_person,
            phone: patch.phone !== undefined ? patch.phone.trim() : v.phone,
            supplied_items:
              patch.supplied_items !== undefined
                ? patch.supplied_items.map((s) => s.trim()).filter(Boolean)
                : v.supplied_items,
          };
          return updatedTarget;
        });
        persistVendors(next);
        return next;
      });
      if (updatedTarget) {
        void upsertVendorToSupabase(updatedTarget);
      }
    },
    [persistVendors]
  );

  const deleteVendor = useCallback(
    (vendorId: string) => {
      setVendors((prev) => {
        const next = prev.filter((v) => v.id !== vendorId);
        persistVendors(next);
        return next;
      });
      void deleteVendorFromSupabase(vendorId);
    },
    [persistVendors]
  );

  const submitRestockRequest = useCallback(
    (input: {
      inventory_item_id: string;
      requested_quantity: number;
      urgency: 'normal' | 'urgent';
      notes?: string;
      requested_by_id: string;
      requested_by_name: string;
      requested_by_role: UserRole;
    }): RestockRequestRecord | null => {
      const inv = inventory.find((item) => item.id === input.inventory_item_id);
      if (!inv) return null;
      const nowIso = new Date().toISOString();
      const created: RestockRequestRecord = {
        id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        inventory_item_id: inv.id,
        item_name: inv.name,
        unit: inv.unit,
        current_stock: inv.current_stock,
        requested_quantity: Math.max(1, input.requested_quantity),
        urgency: input.urgency,
        notes: input.notes?.trim() || undefined,
        requested_by_id: input.requested_by_id,
        requested_by_name: input.requested_by_name,
        requested_by_role: input.requested_by_role,
        status: 'pending',
        created_at: nowIso,
        updated_at: nowIso,
      };
      setRestockRequests((prev) => {
        const next = [created, ...prev].slice(0, 50);
        persistRestockRequests(next);
        return next;
      });
      void insertRestockRequestToSupabase(created).then((sync) => {
        if (sync.synced && sync.id) {
          setRestockRequests((prev) => {
            const next = prev.map((r) => (r.id === created.id ? { ...r, id: sync.id! } : r));
            persistRestockRequests(next);
            return next;
          });
        }
      });

      const urgencyTag = input.urgency === 'urgent' ? 'Mendesak' : 'Normal';
      pushOperationalNotification({
        type: 'restock_request',
        title: `Permintaan Restock (${urgencyTag})`,
        message: `${input.requested_by_name} mengajukan pembelian ${inv.name} sejumlah ${created.requested_quantity} ${inv.unit} (sisa stok ${inv.current_stock} ${inv.unit})${created.notes ? ` · "${created.notes}"` : ''}.`,
        targetPage: 'purchasing',
        targetRoles: ['owner', 'manager'],
        senderName: input.requested_by_name,
        senderRole: input.requested_by_role,
        restockRequestId: created.id,
      });

      return created;
    },
    [inventory, persistRestockRequests, pushOperationalNotification]
  );

  const updateRestockRequestStatus = useCallback(
    (requestId: string, status: RestockRequestStatus, handledByName: string) => {
      const target = restockRequests.find((r) => r.id === requestId);
      setRestockRequests((prev) => {
        const next = prev.map((r) =>
          r.id === requestId
            ? { ...r, status, handled_by_name: handledByName, updated_at: new Date().toISOString() }
            : r
        );
        persistRestockRequests(next);
        return next;
      });
      void updateRestockRequestStatusInSupabase(requestId, status, handledByName);
      if (target) {
        const label =
          status === 'ordered'
            ? 'sedang diproses pemesanan ke vendor'
            : status === 'completed'
              ? 'sudah selesai direstock'
              : 'menunggu diproses';
        pushOperationalNotification({
          type: 'purchase',
          title: `Update Restock: ${target.item_name}`,
          message: `Permintaan restock ${target.item_name} (${target.requested_quantity} ${target.unit}) ${label} oleh ${handledByName}.`,
          targetPage: 'pos',
          targetRoles: ['cashier', 'manager', 'owner'],
          senderName: handledByName,
          restockRequestId: requestId,
        });
      }
    },
    [restockRequests, persistRestockRequests, pushOperationalNotification]
  );

  const sendOperationalMessage = useCallback(
    (input: {
      title: string;
      message: string;
      type?: OperationalNotificationType;
      targetRoles: UserRole[];
      targetPage: PageId;
      senderName: string;
      senderRole: UserRole;
    }): AppNotification => {
      return pushOperationalNotification({
        type: input.type ?? 'owner_message',
        title: input.title.trim() || 'Pesan dari Owner',
        message: input.message.trim(),
        targetPage: input.targetPage,
        targetRoles: input.targetRoles,
        senderName: input.senderName,
        senderRole: input.senderRole,
      });
    },
    [pushOperationalNotification]
  );

  const markNotificationRead = useCallback(
    (notificationId: string) => {
      if (notificationId.startsWith('notif-opname-') || notificationId.startsWith('notif-stock-')) {
        setReadAutoNotifIds((prev) => {
          const next = new Set(prev);
          next.add(notificationId);
          return next;
        });
        return;
      }
      setCustomNotifications((prev) => {
        const next = prev.map((n) => (n.id === notificationId ? { ...n, unread: false } : n));
        persistOpsNotifications(next);
        return next;
      });
      void markOperationalNotificationReadInSupabase(notificationId);
    },
    [persistOpsNotifications]
  );

  const markAllNotificationsRead = useCallback(
    (role: UserRole) => {
      setReadAutoNotifIds((prev) => {
        const next = new Set(prev);
        for (const sch of opnameSchedules) next.add(`notif-opname-${sch.id}`);
        for (const inv of inventory) next.add(`notif-stock-${inv.id}`);
        return next;
      });
      setCustomNotifications((prev) => {
        const next = prev.map((n) =>
          !n.targetRoles || n.targetRoles.includes(role) ? { ...n, unread: false } : n
        );
        persistOpsNotifications(next);
        return next;
      });
    },
    [inventory, opnameSchedules, persistOpsNotifications]
  );

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
    const autoItems: AppNotification[] = [];
    for (const schedule of dueOpnameSchedules) {
      const id = `notif-opname-${schedule.id}`;
      autoItems.push({
        id,
        type: 'opname',
        title: 'Jadwal Stock Opname Jatuh Tempo',
        message: `${schedule.title} dijadwalkan pukul ${schedule.execution_time} WIB dan belum dikerjakan hari ini.`,
        targetPage: 'stock-opname',
        targetRoles: ['owner', 'manager'],
        timestamp: 'Hari ini',
        unread: !readAutoNotifIds.has(id),
      });
    }
    for (const inv of lowStockItems) {
      const id = `notif-stock-${inv.id}`;
      const isDepleted = inv.current_stock <= 0;
      autoItems.push({
        id,
        type: 'low_stock',
        title: isDepleted ? `Stok Habis: ${inv.name}` : `Stok Menipis: ${inv.name}`,
        message: isDepleted
          ? `${inv.name} HABIS (0 ${inv.unit}). Menu terkait otomatis dikunci di Kasir sampai direstock.`
          : `${inv.name} tersisa ${inv.current_stock} ${inv.unit} (batas min. ${inv.min_stock_threshold} ${inv.unit}).`,
        targetPage: 'inventory',
        targetRoles: ['owner', 'manager', 'cashier'],
        timestamp: 'Otomatis',
        unread: !readAutoNotifIds.has(id),
      });
    }
    return [...customNotifications, ...autoItems];
  }, [customNotifications, dueOpnameSchedules, lowStockItems, readAutoNotifIds]);

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
      setWhatsappLogs((prev) => [log, ...prev].slice(0, 50));
      void insertWhatsAppLogToSupabase(log);
      return log;
    },
    [settings.shopName]
  );

  const syncOfflineQueueNow = useCallback(async (): Promise<{
    syncedCount: number;
    remainingCount: number;
  }> => {
    const queue = await getPendingOrders();
    setPendingOfflineOrdersCount(queue.length);
    if (queue.length === 0) {
      return { syncedCount: 0, remainingCount: 0 };
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return { syncedCount: 0, remainingCount: queue.length };
    }

    setIsSyncingOfflineQueue(true);
    let syncedCount = 0;

    try {
      for (const entry of queue) {
        const res = await persistOrderToSupabase({
          order: entry.order,
          cartItems: entry.cartItems ?? [],
          updatedCustomer: entry.updatedCustomer,
          deductions: entry.deductions,
          enableSupabaseSync: true,
        });

        if (res.synced) {
          await removePendingOrder(entry.localId);
          syncedCount += 1;
          setOrders((prev) =>
            prev.map((o) =>
              o.id === entry.order.id
                ? {
                    ...o,
                    id: res.id || o.id,
                    order_number: res.orderNumber || o.order_number,
                    sync_status: 'synced',
                  }
                : o
            )
          );
        } else {
          await markPendingOrderFailed(entry.localId, res.error || 'Sinkronisasi tertunda.');
        }
      }
    } finally {
      const remaining = await getPendingOrders();
      setPendingOfflineOrdersCount(remaining.length);
      setIsSyncingOfflineQueue(false);
    }

    const latest = await getPendingOrders();
    return { syncedCount, remainingCount: latest.length };
  }, []);

  // Load any pending offline transactions from IndexedDB on startup & auto-flush when online
  useEffect(() => {
    let active = true;
    void getPendingOrders().then((pending) => {
      if (!active) return;
      setPendingOfflineOrdersCount(pending.length);
      if (pending.length > 0) {
        setOrders((prev) => {
          const existingIds = new Set(prev.map((o) => o.id));
          const missing = pending
            .map((p) => ({ ...p.order, sync_status: 'pending_sync' as const }))
            .filter((o) => !existingIds.has(o.id));
          return missing.length > 0 ? [...missing, ...prev] : prev;
        });
        if (typeof navigator === 'undefined' || navigator.onLine) {
          void syncOfflineQueueNow();
        }
      }
    });

    const handleOnline = () => {
      void syncOfflineQueueNow();
    };
    window.addEventListener('online', handleOnline);
    return () => {
      active = false;
      window.removeEventListener('online', handleOnline);
    };
  }, [syncOfflineQueueNow]);

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
      const now = new Date();
      const voucherEval = input.appliedVoucher
        ? evaluateVoucherOnCart(input.appliedVoucher, input.items, now, menus)
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

      const orderNumber = generateNextOrderNumber(
        orders.map((o) => o.order_number),
        now
      );
      const voucherNoteSuffix =
        appliedVoucherValid && input.appliedVoucher
          ? `[Voucher ${input.appliedVoucher.code}: -Rp ${summary.voucherDiscountAmount.toLocaleString('id-ID')}]`
          : '';
      const combinedNotes = [input.notes.trim(), voucherNoteSuffix].filter(Boolean).join(' · ');

      const invPriceMap = new Map(inventory.map((inv) => [inv.id, inv.last_purchase_price]));
      const newOrder: OrderRecord = {
        id: `ord-${Date.now()}`,
        order_number: orderNumber,
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
        points_earned: input.status === 'completed' ? summary.pointsEarned : 0,
        payment_method: input.paymentMethod,
        status: input.status,
        sync_status: input.enableSupabaseSync ? 'pending_sync' : 'local',
        notes: combinedNotes,
        items: input.items.map((cartItem, idx) => {
          const unitHpp = Math.round(
            cartItem.menu.recipes.reduce(
              (sum, recipe) =>
                sum + recipe.quantity_needed * (invPriceMap.get(recipe.inventory_item_id) ?? 0),
              0
            )
          );
          return {
            id: `oi-${Date.now()}-${idx}`,
            menu_id: cartItem.menu.id,
            menu_name: cartItem.menu.name,
            quantity: cartItem.quantity,
            unit_price: cartItem.menu.selling_price,
            unit_hpp: unitHpp,
            subtotal: cartItem.menu.selling_price * cartItem.quantity,
            notes: cartItem.note,
          };
        }),
        created_at: now.toISOString(),
      };

      // Pre-compute stock & member deltas before committing state so failed online syncs don't corrupt local state
      const stockCalc =
        input.status === 'completed'
          ? computeRecipeStockDeductions(input.items, inventory)
          : { summary: [] as StockDeductionSummary[], updatedInventory: inventory };
      const deductions = stockCalc.summary;
      const touchedIds = new Set(deductions.map((d) => d.inventoryItemId));
      const newlyLowStock =
        input.status === 'completed' && deductions.length > 0
          ? stockCalc.updatedInventory.filter(
              (inv) =>
                touchedIds.has(inv.id) &&
                inv.category_type !== 'asset' &&
                inv.current_stock <= inv.min_stock_threshold
            )
          : [];

      const updatedCustomer: Customer | null =
        input.status === 'completed' && input.customer
          ? computeUpdatedMember(
              input.customer,
              summary.totalAmount,
              summary.pointsEarned,
              membershipProgram.tiers
            )
          : null;

      const enableSync = input.enableSupabaseSync ?? false;
      const isOfflineNow = typeof navigator !== 'undefined' && !navigator.onLine;
      let syncStatus: SupabaseSyncStatus;

      if (enableSync && (input.forceOfflineQueue || isOfflineNow)) {
        await enqueuePendingOrder({
          localId: newOrder.id,
          order: { ...newOrder, sync_status: 'pending_sync' },
          cartItems: input.items,
          updatedCustomer,
          deductions,
          voucherId: input.appliedVoucher?.id ?? null,
          voucherCode: newOrder.voucher_code ?? null,
          pointsEarned: summary.pointsEarned,
          queuedAt: now.toISOString(),
          retryCount: 0,
        });
        const pending = await getPendingOrders();
        setPendingOfflineOrdersCount(pending.length);
        syncStatus = {
          mode: 'supabase',
          synced: false,
          queuedOffline: true,
          orderNumber: newOrder.order_number,
          error: isOfflineNow
            ? 'Perangkat sedang offline. Transaksi disimpan di antrean lokal dan akan tersinkron otomatis saat online.'
            : 'Disimpan ke antrean offline lokal.',
        };
      } else {
        syncStatus = await persistOrderToSupabase({
          order: newOrder,
          cartItems: input.items,
          updatedCustomer,
          deductions,
          enableSupabaseSync: enableSync,
        });

        // If online Supabase sync failed due to network interruption, queue safely to IndexedDB
        if (enableSync && !syncStatus.synced && isLikelyNetworkFailure(syncStatus.error)) {
          await enqueuePendingOrder({
            localId: newOrder.id,
            order: { ...newOrder, sync_status: 'pending_sync' },
            cartItems: input.items,
            updatedCustomer,
            deductions,
            voucherId: input.appliedVoucher?.id ?? null,
            voucherCode: newOrder.voucher_code ?? null,
            pointsEarned: summary.pointsEarned,
            queuedAt: now.toISOString(),
            retryCount: 1,
            lastError: syncStatus.error,
          });
          const pending = await getPendingOrders();
          setPendingOfflineOrdersCount(pending.length);
          syncStatus = {
            ...syncStatus,
            queuedOffline: true,
          };
        }
      }

      // P0-1: Do NOT mutate local store or falsely mark completed if online Supabase rejected the transaction
      if (enableSync && !syncStatus.synced && !syncStatus.queuedOffline) {
        return {
          order: newOrder,
          pointsEarned: summary.pointsEarned,
          deductions,
          syncStatus,
          whatsappReceiptLog: null,
        };
      }

      const finalOrder: OrderRecord = {
        ...newOrder,
        id: syncStatus.synced && syncStatus.id ? syncStatus.id : newOrder.id,
        order_number:
          syncStatus.synced && syncStatus.orderNumber
            ? syncStatus.orderNumber
            : newOrder.order_number,
        sync_status: !enableSync
          ? 'local'
          : syncStatus.synced
            ? 'synced'
            : 'pending_sync',
      };

      setOrders((prev) => {
        const filtered = input.replacesDraftId
          ? prev.filter((o) => o.id !== input.replacesDraftId)
          : prev;
        return [finalOrder, ...filtered];
      });

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
          // Note: atomic RPC already increments voucher quota in Supabase; fallback only if not synced via RPC
          if (enableSync && !syncStatus.synced && !syncStatus.queuedOffline) {
            void incrementVoucherUsageInSupabase(
              targetVoucher.id,
              targetVoucher.code,
              nextUsedCount
            );
          }
        }

        if (deductions.length > 0) {
          setInventory(stockCalc.updatedInventory);
        }

        if (input.customer && updatedCustomer) {
          const customerId = input.customer.id;
          const nextCustomer = updatedCustomer;
          setCustomers((prev) => prev.map((c) => (c.id === customerId ? nextCustomer : c)));
        }

        const itemsPreview = input.items
          .slice(0, 2)
          .map((it) => `${it.quantity}x ${it.menu.name}`)
          .join(', ');
        const extraItemSuffix =
          input.items.length > 2 ? ` +${input.items.length - 2} menu lainnya` : '';
        pushOperationalNotification({
          type: 'new_order',
          title: `Orderan Masuk ${finalOrder.order_number}`,
          message: `Rp ${summary.totalAmount.toLocaleString('id-ID')} (${input.paymentMethod.toUpperCase()}) · ${itemsPreview}${extraItemSuffix} · Kasir: ${input.cashier.full_name}`,
          targetPage: 'orders',
          targetRoles: ['owner', 'manager'],
          senderName: input.cashier.full_name,
          senderRole: input.cashier.role,
        });

        if (newlyLowStock.length > 0) {
          const depletedList = newlyLowStock.filter((i) => i.current_stock <= 0);
          const headline =
            depletedList.length > 0
              ? `Stok Bahan Habis (${depletedList.map((i) => i.name).join(', ')})`
              : `Stok Menipis Setelah Transaksi`;
          pushOperationalNotification({
            type: 'low_stock',
            title: headline,
            message: newlyLowStock
              .map((i) => `${i.name}: sisa ${i.current_stock} ${i.unit}`)
              .join(' · '),
            targetPage: 'inventory',
            targetRoles: ['owner', 'manager', 'cashier'],
          });
        }
      }

      if (input.replacesDraftId && enableSync) {
        void deleteOrderFromSupabase(input.replacesDraftId);
      }

      let whatsappReceiptLog: WhatsAppLogEntry | null = null;
      if (input.status === 'completed') {
        if (settings.whatsappAutoReceipt && input.customer?.phone_number) {
          whatsappReceiptLog = await sendWhatsAppMessage({
            eventType: 'pos_receipt',
            targets: [input.customer.phone_number],
            data: buildPosReceiptPayload({
              order: finalOrder,
              pointsEarned: summary.pointsEarned,
              totalPoints: updatedCustomer?.points,
              memberTier: updatedCustomer?.tier,
            }),
            enableSupabaseSync: enableSync,
          });
        }

        if (settings.whatsappAutoLowStock && newlyLowStock.length > 0) {
          const targets = [settings.whatsappOwnerPhone, settings.whatsappManagerPhone].filter(
            Boolean
          );
          if (targets.length > 0) {
            void sendWhatsAppMessage({
              eventType: 'low_stock_alert',
              targets,
              data: buildLowStockPayload(newlyLowStock),
              enableSupabaseSync: enableSync,
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
      orders,
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
      pushOperationalNotification,
    ]
  );

  const deleteDraftOrder = useCallback((orderId: string) => {
    setOrders((prev) => prev.filter((o) => !(o.id === orderId && o.status === 'draft')));
    void deleteOrderFromSupabase(orderId);
  }, []);

  const cancelOrder = useCallback(
    async (input: {
      orderId: string;
      reason?: string;
      cancelledByName: string;
      cancelledByRole: UserRole;
    }): Promise<{ ok: boolean; error?: string }> => {
      const target = orders.find((o) => o.id === input.orderId);
      if (!target) {
        return { ok: false, error: 'Data pesanan tidak ditemukan.' };
      }
      if (target.status === 'cancelled') {
        return { ok: true };
      }
      const cleanReason = (input.reason ?? '').trim();
      const cancelTag = cleanReason
        ? `[DIBATALKAN oleh ${input.cancelledByName}: ${cleanReason}]`
        : `[DIBATALKAN oleh ${input.cancelledByName}]`;
      const nextNotes = target.notes ? `${target.notes} · ${cancelTag}` : cancelTag;

      // P0-5: Atomic reversal in Supabase (`cancel_order_atomic`) + mirrored local state reversal
      const syncRes = await cancelOrderInSupabase(target.id, target.order_number, nextNotes);
      if (syncRes.mode === 'supabase' && !syncRes.synced && syncRes.error) {
        return { ok: false, error: syncRes.error };
      }

      const reversal = computeOrderReversal({
        order: target,
        menus,
        inventory,
        customers,
        tierRules: membershipProgram.tiers,
        pointEarningStepRupiah: membershipProgram.limits.point_earning_step_rupiah,
      });

      if (reversal.restoredStock.length > 0) {
        setInventory(reversal.updatedInventory);
      }
      if (reversal.updatedCustomer) {
        const reversed = reversal.updatedCustomer;
        setCustomers((prev) => prev.map((c) => (c.id === reversed.id ? reversed : c)));
      }
      if (reversal.voucherCodeToRestore) {
        const normalizedTarget = normalizeVoucherCode(reversal.voucherCodeToRestore);
        const nextVouchers = vouchers.map((v) =>
          normalizeVoucherCode(v.code) === normalizedTarget
            ? { ...v, used_count: Math.max(0, v.used_count - 1) }
            : v
        );
        setVouchers(nextVouchers);
        persistVouchers(nextVouchers);
      }

      setOrders((prev) =>
        prev.map((o) =>
          o.id === input.orderId ? { ...o, status: 'cancelled', notes: nextNotes } : o
        )
      );

      pushOperationalNotification({
        type: 'info',
        title: `Pesanan ${target.order_number} Dibatalkan`,
        message: `${input.cancelledByName} membatalkan pesanan senilai Rp ${target.total_amount.toLocaleString('id-ID')}${reversal.restoredStock.length > 0 ? ` · Stok ${reversal.restoredStock.length} bahan dipulihkan` : ''}${cleanReason ? ` · Alasan: ${cleanReason}` : ''}.`,
        targetPage: 'orders',
        targetRoles: ['owner', 'manager'],
        senderName: input.cancelledByName,
        senderRole: input.cancelledByRole,
      });

      return { ok: true };
    },
    [
      orders,
      menus,
      inventory,
      customers,
      vouchers,
      membershipProgram.tiers,
      membershipProgram.limits.point_earning_step_rupiah,
      persistVouchers,
      pushOperationalNotification,
    ]
  );

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
    const tempId = `menu-${Date.now()}`;
    const initialRecipes: MenuItem['recipes'] = (input.recipes ?? []).map((r, idx) => ({
      ...r,
      id: r.id || `rec-${Date.now()}-${idx}`,
      menu_id: tempId,
    }));
    const created: MenuItem = {
      id: tempId,
      category_id: input.category_id,
      name: input.name.trim(),
      description: input.description.trim(),
      image_url: input.image_url,
      selling_price: input.selling_price,
      is_available: input.is_available ?? true,
      visual_tone: input.visual_tone,
      recipes: initialRecipes,
    };
    setMenus((prev) => [created, ...prev]);
    const enableSync = input.enableSupabaseSync ?? false;
    const sync = await upsertMenuItemToSupabase(created, true, enableSync);
    if (sync.synced && sync.id) {
      const syncedRecipes = initialRecipes.map((r) => ({ ...r, menu_id: sync.id! }));
      const persisted: MenuItem = { ...created, id: sync.id, recipes: syncedRecipes };
      setMenus((prev) => prev.map((m) => (m.id === created.id ? persisted : m)));
      if (syncedRecipes.length > 0) {
        await syncMenuRecipesToSupabase(sync.id, syncedRecipes, enableSync);
      }
      return persisted;
    }
    return created;
  }, []);

  const updateMenuItem = useCallback(
    async (menuId: string, patch: Partial<MenuItemInput>): Promise<void> => {
      let updatedMenu: MenuItem | null = null;
      const normalizedRecipes =
        patch.recipes !== undefined
          ? patch.recipes.map((r, idx) => ({
              ...r,
              id: r.id || `rec-${Date.now()}-${idx}`,
              menu_id: menuId,
            }))
          : undefined;
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
            recipes: normalizedRecipes !== undefined ? normalizedRecipes : m.recipes,
          };
          return updatedMenu;
        })
      );
      if (updatedMenu) {
        const enableSync = patch.enableSupabaseSync ?? false;
        await upsertMenuItemToSupabase(updatedMenu, false, enableSync);
        if (normalizedRecipes !== undefined) {
          await syncMenuRecipesToSupabase(menuId, normalizedRecipes, enableSync);
        }
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
      const uniqueSuffix = `${Date.now().toString().slice(-4)}${Math.random()
        .toString(36)
        .slice(2, 4)
        .toUpperCase()}`;
      const created: InventoryItem = {
        id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: input.name.trim(),
        sku: input.sku.trim().toUpperCase() || `${prefix}-${uniqueSuffix}`,
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
      extraInventoryItems?: InventoryItem[];
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
      const extraItems = input.extraInventoryItems ?? [];
      const touchedIds = new Set(
        input.items
          .map((i) => i.inventory_item_id)
          .filter((id): id is string => Boolean(id))
      );

      let updatedInventoryItems: InventoryItem[] = [];
      if (touchedIds.size > 0) {
        const mergedSnapshot = mergeInventoryWithNewItems(inventory, extraItems);
        const nextSnapshot = applyPurchaseToInventory(mergedSnapshot, input.items, nowIso);
        updatedInventoryItems = nextSnapshot.filter((inv) => touchedIds.has(inv.id));
        setInventory((prev) =>
          applyPurchaseToInventory(mergeInventoryWithNewItems(prev, extraItems), input.items, nowIso)
        );
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

      // Auto-complete any pending/ordered cashier restock requests covered by this purchase
      if (touchedIds.size > 0) {
        setRestockRequests((prev) => {
          let changed = false;
          const next = prev.map((req) => {
            if (req.status !== 'completed' && touchedIds.has(req.inventory_item_id)) {
              changed = true;
              return {
                ...req,
                status: 'completed' as RestockRequestStatus,
                handled_by_name: input.purchased_by_name,
                updated_at: nowIso,
              };
            }
            return req;
          });
          if (changed) {
            persistRestockRequests(next);
          }
          return changed ? next : prev;
        });
      }

      pushOperationalNotification({
        type: 'purchase',
        title: `Pembelian / Restock: ${record.supplier_name}`,
        message: `${input.purchased_by_name} mencatat pembelian ${record.items.length} item senilai Rp ${totalCost.toLocaleString('id-ID')}. Stok inventori otomatis diperbarui.`,
        targetPage: 'purchasing',
        targetRoles: ['owner', 'manager', 'cashier'],
        senderName: input.purchased_by_name,
      });

      return { purchase: finalPurchase, syncStatus };
    },
    [inventory, persistRestockRequests, pushOperationalNotification]
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

  // P1-6: Never persist sensitive fields (password_hash, monthly_salary, emergency_contact) to localStorage
  const persistEmployees = useCallback((next: UserProfile[]) => {
    try {
      const sanitized = next.map((emp) => sanitizeEmployeeForLocalCache(emp));
      window.localStorage.setItem(EMPLOYEES_STORAGE_KEY, JSON.stringify(sanitized));
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

      const [hydrated, empRpcRes, empTableRes] = await Promise.all([
        hydrateAllTablesFromSupabase(INITIAL_SETTINGS),
        supabase.rpc('get_all_employees_for_owner').then(
          (res) => res,
          () => ({ data: null, error: { message: 'RPC unavailable' } })
        ),
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
        if (hydrated.vendors) {
          setVendors(hydrated.vendors);
          persistVendors(hydrated.vendors);
        }
        if (hydrated.restockRequests) {
          setRestockRequests(hydrated.restockRequests);
          persistRestockRequests(hydrated.restockRequests);
        }
        if (hydrated.customNotifications) {
          setCustomNotifications(hydrated.customNotifications);
          persistOpsNotifications(hydrated.customNotifications);
        }
        if (hydrated.whatsappLogs) {
          setWhatsappLogs(hydrated.whatsappLogs);
        }
        if (hydrated.loginAuditLogs) {
          setUsernameLoginLogs(hydrated.loginAuditLogs);
        }
      }

      // Extract employees from SECURITY DEFINER RPC first (works for both Google OAuth & Username sessions),
      // falling back to direct table select.
      let remoteEmployeeRows: Array<Record<string, unknown>> | null = null;
      const rpcPayload = empRpcRes?.data as
        | { ok?: boolean; employees?: Array<Record<string, unknown>> }
        | null;
      if (!empRpcRes?.error && rpcPayload?.ok && Array.isArray(rpcPayload.employees)) {
        remoteEmployeeRows = rpcPayload.employees;
      } else if (!empTableRes.error && Array.isArray(empTableRes.data) && empTableRes.data.length > 0) {
        remoteEmployeeRows = empTableRes.data as Array<Record<string, unknown>>;
      }

      if (remoteEmployeeRows && remoteEmployeeRows.length > 0) {
        const mapped: UserProfile[] = remoteEmployeeRows.map((row) => {
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
        setEmployeesSyncStatus('synced');
        setEmployeesSyncError(null);
      } else {
        // Direct select returned 0 rows (commonly because RLS policy was still `TO authenticated` during a Username session)
        setEmployeesSyncStatus('error');
        setEmployeesSyncError(
          empTableRes.error?.message ||
            'Daftar karyawan belum tersinkron dari tabel Supabase employees. Jalankan ulang file SQL supabase/schema_google_oauth_employees.sql terbaru di Supabase SQL Editor.'
        );
      }
    } catch {
      // Keep local state intact if remote tables are not yet created
    }
  }, [
    persistEmployees,
    persistVideos,
    persistVouchers,
    persistVendors,
    persistRestockRequests,
    persistOpsNotifications,
  ]);

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

  const syncEmployeeToSupabase = useCallback(
    async (
      employee: UserProfile,
      previousEmail?: string
    ): Promise<{ ok: boolean; id?: string; error?: string }> => {
      if (!supabase) return { ok: true };
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session && !getAppSessionToken()) {
          return {
            ok: false,
            error: 'Sesi Supabase belum aktif. Silakan masuk ulang agar perubahan tersimpan ke database.',
          };
        }

        const cleanEmail = employee.email.trim().toLowerCase();
        const cleanPrevEmail = previousEmail ? previousEmail.trim().toLowerCase() : null;
        const cleanUsername = employee.username ? normalizeUsername(employee.username) : null;

        // 1. Prefer SECURITY DEFINER RPC (works for both Google OAuth & Username sessions cleanly)
        const rpcRes = await supabase.rpc('upsert_employee_by_owner', {
          p_id: isUuid(employee.id) ? employee.id : null,
          p_previous_email: cleanPrevEmail,
          p_full_name: employee.full_name,
          p_email: cleanEmail,
          p_username: cleanUsername,
          p_role: employee.role,
          p_phone_number: employee.phone_number,
          p_is_active: employee.is_active,
          p_shift: employee.shift ?? 'Shift Pagi (07:00 - 15:00)',
          p_position: employee.position ?? 'Barista & Kasir',
          p_employment_status: employee.employment_status ?? 'Kontrak',
          p_monthly_salary: employee.monthly_salary ?? 0,
          p_join_date: employee.join_date || new Date().toISOString().slice(0, 10),
          p_emergency_contact: employee.emergency_contact ?? '',
          p_notes: employee.notes ?? '',
        });

        if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
          const payload = rpcRes.data as {
            ok?: boolean;
            error?: string;
            employee?: { id?: string };
          };
          if (payload.ok) {
            return { ok: true, id: payload.employee?.id ? String(payload.employee.id) : undefined };
          }
          return {
            ok: false,
            error: payload.error || 'Gagal menyimpan data karyawan ke Supabase.',
          };
        }

        // 2. Fallback to direct table update / upsert (when RPC is not yet installed in SQL Editor)
        const rowPayload = {
          full_name: employee.full_name,
          email: cleanEmail,
          username: cleanUsername,
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
        };

        if (isUuid(employee.id)) {
          const { data, error } = await supabase
            .from('employees')
            .update(rowPayload)
            .eq('id', employee.id)
            .select('id')
            .maybeSingle();
          if (!error && data?.id) {
            return { ok: true, id: String(data.id) };
          }
        } else if (cleanPrevEmail && cleanPrevEmail !== cleanEmail) {
          const { data, error } = await supabase
            .from('employees')
            .update(rowPayload)
            .ilike('email', cleanPrevEmail)
            .select('id')
            .maybeSingle();
          if (!error && data?.id) {
            return { ok: true, id: String(data.id) };
          }
        }

        const { data, error } = await supabase
          .from('employees')
          .upsert(rowPayload, { onConflict: 'email' })
          .select('id')
          .maybeSingle();

        if (error) {
          return {
            ok: false,
            error: `Supabase menolak penyimpanan karyawan (${error.message}). Jalankan ulang file SQL supabase/schema_google_oauth_employees.sql terbaru di Supabase SQL Editor.`,
          };
        }
        return { ok: true, id: data?.id ? String(data.id) : undefined };
      } catch (err) {
        return {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : 'Gagal menyinkronkan data karyawan ke Supabase.',
        };
      }
    },
    []
  );

  const deleteEmployeeFromSupabase = useCallback(
    async (email: string): Promise<{ ok: boolean; error?: string }> => {
      if (!supabase || !email.trim()) return { ok: true };
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session && !getAppSessionToken()) {
          return { ok: false, error: 'Sesi Supabase belum aktif.' };
        }

        const rpcRes = await supabase.rpc('delete_employee_by_owner', {
          p_email: email.trim().toLowerCase(),
        });
        if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object') {
          const payload = rpcRes.data as { ok?: boolean; error?: string };
          if (payload.ok) return { ok: true };
          return { ok: false, error: payload.error || 'Gagal menghapus karyawan di Supabase.' };
        }

        const { error } = await supabase
          .from('employees')
          .delete()
          .ilike('email', email.trim());
        if (error) {
          return { ok: false, error: error.message };
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Gagal menghapus karyawan di Supabase.',
        };
      }
    },
    []
  );

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
    }): Promise<{ ok: boolean; error?: string; syncedToSupabase?: boolean }> => {
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
        email: input.email.trim().toLowerCase(),
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

      const syncRes = await syncEmployeeToSupabase(created);
      const savedEmployee: UserProfile =
        syncRes.ok && syncRes.id ? { ...created, id: syncRes.id } : created;

      setEmployees((prev) => {
        const next = [...prev, savedEmployee];
        persistEmployees(next);
        return next;
      });

      if (!syncRes.ok) {
        return {
          ok: false,
          syncedToSupabase: false,
          error:
            syncRes.error ||
            'Karyawan hanya tersimpan lokal dan belum masuk ke Supabase employees. Jalankan ulang SQL supabase/schema_google_oauth_employees.sql.',
        };
      }

      if (supabase && normalizedUser && trimmedPass) {
        try {
          const { data, error } = await supabase.rpc('set_employee_username_credentials', {
            p_email: savedEmployee.email.trim().toLowerCase(),
            p_username: normalizedUser,
            p_password: trimmedPass,
          });
          if (error) {
            return {
              ok: false,
              syncedToSupabase: false,
              error: `Karyawan tersimpan, tetapi gagal menyimpan kata sandi ke Supabase (${error.message}).`,
            };
          }
          if (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
            return {
              ok: false,
              syncedToSupabase: false,
              error: String(
                (data as { error?: string }).error ||
                  'Karyawan tersimpan, tetapi gagal menyimpan username & kata sandi ke Supabase.'
              ),
            };
          }
        } catch (err) {
          return {
            ok: false,
            syncedToSupabase: false,
            error:
              err instanceof Error
                ? err.message
                : 'Gagal menyimpan username & kata sandi ke Supabase.',
          };
        }
      }

      setEmployeesSyncStatus('synced');
      setEmployeesSyncError(null);
      return { ok: true, syncedToSupabase: Boolean(supabase) };
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
          error: 'Atur kata sandi (minimal 8 karakter) saat pertama kali mengaktifkan username login.',
        };
      }

      const nextHash = trimmedPass ? await hashPasswordLocal(trimmedPass) : target.password_hash;
      const updatedTarget: UserProfile = {
        ...target,
        username: normalizedUser,
        password_hash: normalizedUser ? nextHash : undefined,
        has_password: Boolean(normalizedUser && (nextHash || target.has_password)),
      };

      // Ensure employee row exists in Supabase `public.employees` BEFORE updating password_hash via RPC
      if (supabase) {
        const ensureRowRes = await syncEmployeeToSupabase(updatedTarget);
        if (!ensureRowRes.ok) {
          return {
            ok: false,
            error:
              ensureRowRes.error ||
              'Gagal menyinkronkan data karyawan ke tabel employees di Supabase.',
          };
        }
        if (ensureRowRes.id) {
          updatedTarget.id = ensureRowRes.id;
        }

        try {
          const { data, error } = await supabase.rpc('set_employee_username_credentials', {
            p_email: updatedTarget.email.trim().toLowerCase(),
            p_username: normalizedUser ?? '',
            p_password: trimmedPass || null,
          });
          if (error) {
            return {
              ok: false,
              error: `Gagal menyimpan username & kata sandi ke Supabase (${error.message}).`,
            };
          }
          if (data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
            return {
              ok: false,
              error: String(
                (data as { error?: string }).error || 'Gagal menyimpan kredensial ke Supabase.'
              ),
            };
          }
        } catch (err) {
          return {
            ok: false,
            error:
              err instanceof Error ? err.message : 'Gagal menyimpan kredensial ke Supabase.',
          };
        }
      }

      setEmployees((prev) => {
        const next = prev.map((emp) => (emp.id === employeeId ? updatedTarget : emp));
        persistEmployees(next);
        return next;
      });

      return { ok: true };
    },
    [employees, persistEmployees, syncEmployeeToSupabase]
  );

  const updateEmployee = useCallback(
    async (
      employeeId: string,
      patch: Partial<UserProfile>
    ): Promise<{ ok: boolean; error?: string }> => {
      const existing = employees.find((emp) => emp.id === employeeId);
      if (!existing) {
        return { ok: false, error: 'Data karyawan tidak ditemukan.' };
      }

      const previousEmail = existing.email;
      const nextName =
        patch.full_name !== undefined
          ? patch.full_name.trim() || existing.full_name
          : existing.full_name;
      const nextInitials =
        patch.full_name !== undefined
          ? nextName
              .split(/\s+/)
              .map((p) => p[0])
              .join('')
              .slice(0, 2)
              .toUpperCase() || existing.avatar_initials
          : existing.avatar_initials;

      const updatedRecord: UserProfile = {
        ...existing,
        ...patch,
        full_name: nextName,
        avatar_initials: nextInitials,
        email: patch.email !== undefined ? patch.email.trim().toLowerCase() : existing.email,
        phone_number:
          patch.phone_number !== undefined ? patch.phone_number.trim() : existing.phone_number,
        shift: patch.shift !== undefined ? patch.shift.trim() : existing.shift,
        position: patch.position !== undefined ? patch.position.trim() : existing.position,
        emergency_contact:
          patch.emergency_contact !== undefined
            ? patch.emergency_contact.trim()
            : existing.emergency_contact,
        notes: patch.notes !== undefined ? patch.notes.trim() : existing.notes,
      };

      setEmployees((prev) => {
        const next = prev.map((emp) => (emp.id === employeeId ? updatedRecord : emp));
        persistEmployees(next);
        return next;
      });

      const syncRes = await syncEmployeeToSupabase(updatedRecord, previousEmail);
      if (syncRes.ok && syncRes.id && syncRes.id !== updatedRecord.id) {
        setEmployees((prev) => {
          const next = prev.map((emp) =>
            emp.id === employeeId ? { ...emp, id: syncRes.id! } : emp
          );
          persistEmployees(next);
          return next;
        });
      }
      return { ok: syncRes.ok, error: syncRes.error };
    },
    [employees, persistEmployees, syncEmployeeToSupabase]
  );

  const deleteEmployee = useCallback(
    async (employeeId: string): Promise<{ ok: boolean; error?: string }> => {
      const target = employees.find((emp) => emp.id === employeeId);
      const removedEmail = target?.email ?? '';
      setEmployees((prev) => {
        const next = prev.filter((emp) => emp.id !== employeeId);
        persistEmployees(next);
        return next;
      });
      if (removedEmail) {
        return deleteEmployeeFromSupabase(removedEmail);
      }
      return { ok: true };
    },
    [employees, persistEmployees, deleteEmployeeFromSupabase]
  );

  const revokeAllEmployeeSessions = useCallback(
    async (
      employeeId: string
    ): Promise<{ ok: boolean; revokedCount?: number; error?: string }> => {
      if (!supabase || !isUuid(employeeId)) {
        return {
          ok: false,
          error: 'Sesi hanya dapat dicabut untuk akun karyawan yang tersinkron di Supabase.',
        };
      }
      try {
        const { data, error } = await supabase.rpc('revoke_all_employee_sessions', {
          p_employee_id: employeeId,
        });
        if (error) {
          return { ok: false, error: error.message };
        }
        const payload = data as { ok?: boolean; revoked_count?: number; error?: string } | null;
        if (payload?.ok) {
          return { ok: true, revokedCount: payload.revoked_count ?? 0 };
        }
        return {
          ok: false,
          error: payload?.error || 'Gagal mencabut sesi aktif karyawan di Supabase.',
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : 'Gagal mencabut sesi karyawan.',
        };
      }
    },
    []
  );

  const updateEmployeeRole = useCallback(
    async (employeeId: string, role: UserRole): Promise<{ ok: boolean; error?: string }> => {
      const existing = employees.find((emp) => emp.id === employeeId);
      if (!existing) return { ok: false, error: 'Data karyawan tidak ditemukan.' };
      const updatedRecord: UserProfile = { ...existing, role };
      setEmployees((prev) => {
        const next = prev.map((emp) => (emp.id === employeeId ? updatedRecord : emp));
        persistEmployees(next);
        return next;
      });
      const syncRes = await syncEmployeeToSupabase(updatedRecord, existing.email);
      return { ok: syncRes.ok, error: syncRes.error };
    },
    [employees, persistEmployees, syncEmployeeToSupabase]
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
      vendors,
      restockRequests,
      prefilledPurchaseVendorId,
      setPrefilledPurchaseVendorId,
      purchases,
      opnameSchedules,
      dueOpnameSchedules,
      opnameLogs,
      whatsappLogs,
      usernameLoginLogs,
      employees,
      employeesSyncStatus,
      employeesSyncError,
      settings,
      notifications,
      hasDueOpname,
      lowStockItems,
      pendingOfflineOrdersCount,
      isSyncingOfflineQueue,
      syncOfflineQueueNow,
      addVendor,
      updateVendor,
      deleteVendor,
      submitRestockRequest,
      updateRestockRequestStatus,
      sendOperationalMessage,
      markNotificationRead,
      markAllNotificationsRead,
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
      cancelOrder,
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
      revokeAllEmployeeSessions,
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
      vendors,
      restockRequests,
      prefilledPurchaseVendorId,
      purchases,
      opnameSchedules,
      dueOpnameSchedules,
      opnameLogs,
      whatsappLogs,
      usernameLoginLogs,
      employees,
      employeesSyncStatus,
      employeesSyncError,
      settings,
      notifications,
      hasDueOpname,
      lowStockItems,
      pendingOfflineOrdersCount,
      isSyncingOfflineQueue,
      syncOfflineQueueNow,
      addVendor,
      updateVendor,
      deleteVendor,
      submitRestockRequest,
      updateRestockRequestStatus,
      sendOperationalMessage,
      markNotificationRead,
      markAllNotificationsRead,
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
      cancelOrder,
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
      revokeAllEmployeeSessions,
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
