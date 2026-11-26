import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
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
  MenuItem,
  OpnameFrequency,
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
  UserProfile,
  UserRole,
  WhatsAppEventType,
  WhatsAppLogEntry,
} from '../types';
import { getDefaultExpenseCategoryForInventory } from '../utils/expenseCategories';
import { calculateCartSummary, calculateOpnameVariance } from '../utils/posCalculations';
import { isOpnameScheduleDue } from '../utils/opnameScheduler';
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

export type { StoreSettings };

const SETTINGS_STORAGE_KEY = 'brewflow_store_settings_v1';

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
  purchases: PurchaseRecord[];
  opnameSchedules: StockOpnameSchedule[];
  dueOpnameSchedules: StockOpnameSchedule[];
  opnameLogs: StockOpnameLog[];
  whatsappLogs: WhatsAppLogEntry[];
  employees: UserProfile[];
  settings: StoreSettings;
  notifications: AppNotification[];
  hasDueOpname: boolean;
  lowStockItems: InventoryItem[];
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
    role: UserRole;
    phone_number: string;
    shift: string;
    position?: string;
    employment_status?: EmploymentStatus;
    monthly_salary?: number;
    join_date?: string;
    emergency_contact?: string;
    notes?: string;
  }) => void;
  updateEmployee: (employeeId: string, patch: Partial<UserProfile>) => void;
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

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [categories] = useState<Category[]>(INITIAL_CATEGORIES);
  const [menus, setMenus] = useState<MenuItem[]>(INITIAL_MENUS);
  const [inventory, setInventory] = useState<InventoryItem[]>(INITIAL_INVENTORY);
  const [orders, setOrders] = useState<OrderRecord[]>(INITIAL_ORDERS);
  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>(INITIAL_PURCHASES);
  const [opnameSchedules, setOpnameSchedules] =
    useState<StockOpnameSchedule[]>(INITIAL_OPNAME_SCHEDULES);
  const [opnameLogs, setOpnameLogs] = useState<StockOpnameLog[]>(INITIAL_OPNAME_LOGS);
  const [whatsappLogs, setWhatsappLogs] = useState<WhatsAppLogEntry[]>([]);
  const [employees, setEmployees] = useState<UserProfile[]>(INITIAL_EMPLOYEES);
  const [settings, setSettings] = useState<StoreSettings>(loadInitialSettings);
  const [watcherNow, setWatcherNow] = useState<Date>(() => new Date());

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
      const summary = calculateCartSummary(input.items, input.customer?.tier ?? null, {
        taxEnabled: settings.taxEnabled,
        taxPercent: settings.taxPercent,
      });
      const sequence = String(orders.length + 2).padStart(3, '0');
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
        tax_amount: summary.taxAmount,
        total_amount: summary.totalAmount,
        payment_method: input.paymentMethod,
        status: input.status,
        notes: input.notes.trim(),
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
            summary.pointsEarned
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
        order: newOrder,
        pointsEarned: summary.pointsEarned,
        deductions,
        syncStatus,
        whatsappReceiptLog,
      };
    },
    [
      orders.length,
      inventory,
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
  }, []);

  const addCustomer = useCallback(
    async (input: {
      name: string;
      phone_number: string;
      email: string;
      enableSupabaseSync?: boolean;
    }): Promise<Customer> => {
      const created: Customer = {
        id: `cust-${Date.now()}`,
        name: input.name.trim(),
        phone_number: input.phone_number.trim(),
        email: input.email.trim(),
        points: 20,
        tier: 'Silver',
        total_spent: 0,
        created_at: new Date().toISOString(),
      };
      setCustomers((prev) => [created, ...prev]);
      await persistCustomerToSupabase(created, input.enableSupabaseSync ?? false);
      return created;
    },
    []
  );

  const adjustCustomerPoints = useCallback((customerId: string, delta: number) => {
    setCustomers((prev) =>
      prev.map((c) =>
        c.id === customerId ? { ...c, points: Math.max(0, c.points + delta) } : c
      )
    );
  }, []);

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
    await upsertMenuItemToSupabase(created, true, input.enableSupabaseSync ?? false);
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
      await upsertInventoryItemToSupabase(created, true, input.enableSupabaseSync ?? false);
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
        await upsertInventoryItemToSupabase(updatedItem, false, patch.enableSupabaseSync ?? false);
      }
    },
    []
  );

  const deleteInventoryItem = useCallback(
    async (itemId: string, enableSupabaseSync = false): Promise<{ affectedMenuCount: number }> => {
      const result = removeInventoryAndPruneRecipes(inventory, menus, itemId);
      setInventory(result.inventory);
      if (result.affectedMenuCount > 0) {
        setMenus(result.menus);
      }
      await deleteInventoryItemFromSupabase(itemId, enableSupabaseSync);
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

      return { purchase: record, syncStatus };
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
      await upsertOpnameScheduleToSupabase(created, true, input.enableSupabaseSync ?? false);
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

  const addEmployee = useCallback(
    (input: {
      full_name: string;
      email: string;
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
      const created: UserProfile = {
        id: `emp-${Date.now()}`,
        full_name: input.full_name.trim(),
        email: input.email.trim(),
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
      setEmployees((prev) => [...prev, created]);
    },
    []
  );

  const updateEmployee = useCallback((employeeId: string, patch: Partial<UserProfile>) => {
    setEmployees((prev) =>
      prev.map((emp) => {
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
        return {
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
      })
    );
  }, []);

  const deleteEmployee = useCallback((employeeId: string) => {
    setEmployees((prev) => prev.filter((emp) => emp.id !== employeeId));
  }, []);

  const updateEmployeeRole = useCallback((employeeId: string, role: UserRole) => {
    setEmployees((prev) => prev.map((emp) => (emp.id === employeeId ? { ...emp, role } : emp)));
  }, []);

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

  const value = useMemo<StoreContextValue>(
    () => ({
      categories,
      menus,
      inventory,
      orders,
      customers,
      purchases,
      opnameSchedules,
      dueOpnameSchedules,
      opnameLogs,
      whatsappLogs,
      employees,
      settings,
      notifications,
      hasDueOpname,
      lowStockItems,
      refreshOpnameWatcher,
      sendWhatsAppMessage,
      createOrder,
      deleteDraftOrder,
      addCustomer,
      adjustCustomerPoints,
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
      purchases,
      opnameSchedules,
      dueOpnameSchedules,
      opnameLogs,
      whatsappLogs,
      employees,
      settings,
      notifications,
      hasDueOpname,
      lowStockItems,
      refreshOpnameWatcher,
      sendWhatsAppMessage,
      createOrder,
      deleteDraftOrder,
      addCustomer,
      adjustCustomerPoints,
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
