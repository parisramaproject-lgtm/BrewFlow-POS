import { buildXlsxBytes } from './ooxmlWriter';
import type {
  Category,
  ExpenseCategoryId,
  InventoryItem,
  MenuItem,
  OrderRecord,
  OrderStatus,
  PurchaseRecord,
  StockOpnameLog,
} from '../types';
import {
  getDefaultExpenseCategoryForInventory,
  getExpenseCategoryLabel,
  isInventoryLinkedExpenseCategory,
} from './expenseCategories';
import { calculateMenuHpp } from './posCalculations';

export type ExportPeriodPreset =
  | 'today'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'last_month'
  | 'all'
  | 'custom';

export interface ExportPeriodOption {
  id: Exclude<ExportPeriodPreset, 'custom'>;
  label: string;
}

export const EXPORT_PERIOD_OPTIONS: ExportPeriodOption[] = [
  { id: 'today', label: 'Hari Ini' },
  { id: 'last_7_days', label: '7 Hari Terakhir' },
  { id: 'last_30_days', label: '30 Hari Terakhir' },
  { id: 'this_month', label: 'Bulan Ini' },
  { id: 'last_month', label: 'Bulan Lalu' },
  { id: 'all', label: 'Semua Periode' },
];

export interface ExcelSheetDefinition {
  name: string;
  rows: Array<Record<string, string | number>>;
}

export interface ExcelExportPayload {
  fileName: string;
  sheets: ExcelSheetDefinition[];
  recordCount: number;
  summaryText: string;
}

export function formatLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function resolvePeriodDateRange(
  preset: Exclude<ExportPeriodPreset, 'custom'>,
  now: Date = new Date()
): { startDate: string; endDate: string; label: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayKey = formatLocalYmd(today);

  switch (preset) {
    case 'today':
      return { startDate: todayKey, endDate: todayKey, label: 'Hari Ini' };
    case 'last_7_days': {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { startDate: formatLocalYmd(start), endDate: todayKey, label: '7 Hari Terakhir' };
    }
    case 'last_30_days': {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { startDate: formatLocalYmd(start), endDate: todayKey, label: '30 Hari Terakhir' };
    }
    case 'this_month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: formatLocalYmd(start), endDate: todayKey, label: 'Bulan Ini' };
    }
    case 'last_month': {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return {
        startDate: formatLocalYmd(start),
        endDate: formatLocalYmd(end),
        label: 'Bulan Lalu',
      };
    }
    case 'all':
      return { startDate: '', endDate: '', label: 'Semua Periode' };
  }
}

export function extractLocalYmd(isoOrYmd: string | null | undefined): string | null {
  if (!isoOrYmd) return null;
  const trimmed = isoOrYmd.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatLocalYmd(parsed);
}

export function isIsoDateInRange(
  isoOrYmd: string | null | undefined,
  startDate: string,
  endDate: string
): boolean {
  if (!startDate && !endDate) return true;
  const ymd = extractLocalYmd(isoOrYmd);
  if (!ymd) return false;
  if (startDate && ymd < startDate) return false;
  if (endDate && ymd > endDate) return false;
  return true;
}

export function formatPeriodLabel(startDate: string, endDate: string): string {
  if (!startDate && !endDate) return 'Semua Periode';
  const fmt = (ymd: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
    const [y, m, d] = ymd.split('-').map(Number);
    return new Intl.DateTimeFormat('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(y, m - 1, d));
  };
  if (startDate && endDate) {
    return startDate === endDate ? fmt(startDate) : `${fmt(startDate)} – ${fmt(endDate)}`;
  }
  if (startDate) return `Mulai ${fmt(startDate)}`;
  return `Sampai ${fmt(endDate)}`;
}

function formatPeriodFileSlug(startDate: string, endDate: string): string {
  if (!startDate && !endDate) return 'Semua_Periode';
  if (startDate && endDate) {
    return startDate === endDate ? startDate : `${startDate}_sd_${endDate}`;
  }
  return startDate || endDate;
}

function formatDateTimeId(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt);
}

function sanitizeFilePrefix(shopName?: string): string {
  const base = (shopName || 'BrewFlow').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || 'BrewFlow';
}

function sanitizeSheetName(name: string): string {
  const clean = name.replace(/[\\/?*[\]:]/g, ' ').trim();
  return clean.slice(0, 31) || 'Sheet';
}

function formatPaymentMethodLabel(method?: string): string {
  switch (method) {
    case 'qris':
      return 'QRIS';
    case 'debit':
      return 'Kartu Debit';
    case 'transfer':
      return 'Transfer Bank';
    case 'cash':
      return 'Tunai';
    default:
      return method || '-';
  }
}

function formatOrderTypeLabel(type: OrderRecord['order_type']): string {
  switch (type) {
    case 'dine_in':
      return 'Dine-in';
    case 'takeaway':
      return 'Takeaway';
    case 'delivery':
      return 'Delivery';
  }
}

function formatInventoryCategoryLabel(cat: InventoryItem['category_type']): string {
  switch (cat) {
    case 'raw_material':
      return 'Bahan Baku';
    case 'packaging':
      return 'Kemasan';
    case 'asset':
      return 'Aset Coffee Shop';
    case 'operational':
      return 'Operasional & Lainnya';
  }
}

// ============================================================================
// 1. PESANAN (ORDERS)
// ============================================================================
export function buildOrdersExcelData(params: {
  orders: OrderRecord[];
  startDate: string;
  endDate: string;
  statusFilter?: 'all' | OrderStatus;
  shopName?: string;
}): ExcelExportPayload {
  const { orders, startDate, endDate, statusFilter = 'all', shopName } = params;
  const filtered = orders.filter((o) => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    return isIsoDateInRange(o.created_at, startDate, endDate);
  });

  const completed = filtered.filter((o) => o.status === 'completed');
  const drafts = filtered.filter((o) => o.status === 'draft');
  const totalSubtotal = completed.reduce((s, o) => s + o.subtotal, 0);
  const totalDiscount = completed.reduce((s, o) => s + o.discount_amount, 0);
  const totalVoucherDiscount = completed.reduce((s, o) => s + (o.voucher_discount_amount ?? 0), 0);
  const totalTax = completed.reduce((s, o) => s + o.tax_amount, 0);
  const totalRevenue = completed.reduce((s, o) => s + o.total_amount, 0);

  const byPayment = { qris: 0, cash: 0, debit: 0 };
  for (const o of completed) {
    byPayment[o.payment_method] = (byPayment[o.payment_method] ?? 0) + o.total_amount;
  }

  const periodLabel = formatPeriodLabel(startDate, endDate);

  const summaryRows: Array<Record<string, string | number>> = [
    { Keterangan: 'Nama Outlet', Nilai: shopName || 'BrewFlow Coffee' },
    { Keterangan: 'Periode Laporan', Nilai: periodLabel },
    {
      Keterangan: 'Filter Status',
      Nilai: statusFilter === 'all' ? 'Semua' : statusFilter === 'completed' ? 'Selesai' : 'Draft',
    },
    { Keterangan: 'Total Transaksi Tercatat', Nilai: filtered.length },
    { Keterangan: 'Transaksi Selesai', Nilai: completed.length },
    { Keterangan: 'Transaksi Draft', Nilai: drafts.length },
    { Keterangan: 'Total Penjualan Kotor / Subtotal (Rp)', Nilai: totalSubtotal },
    { Keterangan: 'Total Diskon Member & Voucher (Rp)', Nilai: totalDiscount },
    { Keterangan: 'Total Potongan Voucher Rush Hour (Rp)', Nilai: totalVoucherDiscount },
    { Keterangan: 'Total Pajak (Rp)', Nilai: totalTax },
    { Keterangan: 'Total Pendapatan Selesai (Rp)', Nilai: totalRevenue },
    { Keterangan: 'Pembayaran QRIS (Rp)', Nilai: byPayment.qris },
    { Keterangan: 'Pembayaran Tunai (Rp)', Nilai: byPayment.cash },
    { Keterangan: 'Pembayaran Debit (Rp)', Nilai: byPayment.debit },
  ];

  const orderRows: Array<Record<string, string | number>> = filtered.map((o) => ({
    'No. Order': o.order_number,
    'Tanggal & Jam': formatDateTimeId(o.created_at),
    Status: o.status === 'completed' ? 'Selesai' : 'Draft',
    'Tipe Pesanan': formatOrderTypeLabel(o.order_type),
    Meja: o.table_number || '-',
    Pelanggan: o.customer_name || 'Walk-in Guest',
    Kasir: o.cashier_name,
    'Metode Bayar': formatPaymentMethodLabel(o.payment_method),
    'Kode Voucher': o.voucher_code || '-',
    'Diskon Voucher (Rp)': o.voucher_discount_amount ?? 0,
    'Total Diskon (Rp)': o.discount_amount,
    'Subtotal (Rp)': o.subtotal,
    'Pajak (Rp)': o.tax_amount,
    'Total Akhir (Rp)': o.total_amount,
    'Jumlah Item': o.items.reduce((sum, it) => sum + it.quantity, 0),
    Catatan: o.notes || '-',
  }));

  const detailRows: Array<Record<string, string | number>> = [];
  for (const o of filtered) {
    for (const item of o.items) {
      detailRows.push({
        'No. Order': o.order_number,
        'Tanggal & Jam': formatDateTimeId(o.created_at),
        Status: o.status === 'completed' ? 'Selesai' : 'Draft',
        'Nama Menu': item.menu_name,
        Qty: item.quantity,
        'Harga Satuan (Rp)': item.unit_price,
        'Subtotal Item (Rp)': item.subtotal,
        'Catatan Varian': item.notes || '-',
      });
    }
  }

  return {
    fileName: `${sanitizeFilePrefix(shopName)}_Pesanan_${formatPeriodFileSlug(startDate, endDate)}.xlsx`,
    sheets: [
      { name: 'Ringkasan', rows: summaryRows },
      { name: 'Daftar Pesanan', rows: orderRows },
      { name: 'Detail Item Pesanan', rows: detailRows },
    ],
    recordCount: filtered.length,
    summaryText: `${filtered.length} pesanan (${completed.length} selesai, ${detailRows.length} baris item)`,
  };
}

// ============================================================================
// 2. MENU & HPP
// ============================================================================
export function buildMenuHppExcelData(params: {
  menus: MenuItem[];
  categories: Category[];
  inventory: InventoryItem[];
  orders: OrderRecord[];
  startDate: string;
  endDate: string;
  includeHpp: boolean;
  shopName?: string;
}): ExcelExportPayload {
  const { menus, categories, inventory, orders, startDate, endDate, includeHpp, shopName } = params;
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  const invMap = new Map(inventory.map((i) => [i.id, i]));

  // Aggregate sales per menu in the selected period (completed orders only)
  const periodCompletedOrders = orders.filter(
    (o) => o.status === 'completed' && isIsoDateInRange(o.created_at, startDate, endDate)
  );
  const salesByMenu = new Map<string, { qty: number; revenue: number }>();
  for (const o of periodCompletedOrders) {
    for (const item of o.items) {
      const prev = salesByMenu.get(item.menu_id) ?? { qty: 0, revenue: 0 };
      prev.qty += item.quantity;
      prev.revenue += item.subtotal;
      salesByMenu.set(item.menu_id, prev);
    }
  }

  let totalUnitsSold = 0;
  let totalPeriodRevenue = 0;
  let totalPeriodHpp = 0;

  const menuRows: Array<Record<string, string | number>> = menus.map((menu) => {
    const sold = salesByMenu.get(menu.id) ?? { qty: 0, revenue: 0 };
    totalUnitsSold += sold.qty;
    totalPeriodRevenue += sold.revenue;

    const baseRow: Record<string, string | number> = {
      'Nama Menu': menu.name,
      Kategori: catMap.get(menu.category_id) ?? '-',
      'Status Tersedia': menu.is_available ? 'Tersedia' : 'Nonaktif',
      'Harga Jual (Rp)': menu.selling_price,
      'Qty Terjual (Periode)': sold.qty,
      'Omzet Periode (Rp)': sold.revenue,
    };

    if (includeHpp) {
      const hpp = calculateMenuHpp(menu.selling_price, menu.recipes, inventory);
      const periodHpp = hpp.totalHpp * sold.qty;
      const periodGrossProfit = sold.revenue - periodHpp;
      totalPeriodHpp += periodHpp;

      return {
        ...baseRow,
        'HPP / Porsi (Rp)': hpp.totalHpp,
        'Laba Kotor / Porsi (Rp)': hpp.grossProfit,
        'Food Cost (%)': Number(hpp.foodCostPercent.toFixed(1)),
        'Margin (%)': Number(hpp.marginPercent.toFixed(1)),
        'Total HPP Periode (Rp)': periodHpp,
        'Estimasi Laba Kotor Periode (Rp)': periodGrossProfit,
      };
    }

    return baseRow;
  });

  const periodLabel = formatPeriodLabel(startDate, endDate);
  const summaryRows: Array<Record<string, string | number>> = [
    { Keterangan: 'Nama Outlet', Nilai: shopName || 'BrewFlow Coffee' },
    { Keterangan: 'Periode Penjualan Menu', Nilai: periodLabel },
    { Keterangan: 'Total Daftar Menu', Nilai: menus.length },
    { Keterangan: 'Menu Tersedia di POS', Nilai: menus.filter((m) => m.is_available).length },
    { Keterangan: 'Total Porsi Terjual (Periode)', Nilai: totalUnitsSold },
    { Keterangan: 'Total Omzet Menu (Periode) (Rp)', Nilai: totalPeriodRevenue },
  ];

  if (includeHpp) {
    const totalGrossProfit = totalPeriodRevenue - totalPeriodHpp;
    const avgFoodCost = totalPeriodRevenue > 0 ? (totalPeriodHpp / totalPeriodRevenue) * 100 : 0;
    summaryRows.push(
      { Keterangan: 'Estimasi Total HPP Terjual (Rp)', Nilai: totalPeriodHpp },
      { Keterangan: 'Estimasi Laba Kotor Periode (Rp)', Nilai: totalGrossProfit },
      { Keterangan: 'Rata-rata Food Cost Periode (%)', Nilai: Number(avgFoodCost.toFixed(1)) }
    );
  }

  const sheets: ExcelSheetDefinition[] = [
    { name: 'Ringkasan', rows: summaryRows },
    { name: includeHpp ? 'Menu & HPP' : 'Daftar Menu', rows: menuRows },
  ];

  if (includeHpp) {
    const recipeRows: Array<Record<string, string | number>> = [];
    for (const menu of menus) {
      for (const rec of menu.recipes) {
        const inv = invMap.get(rec.inventory_item_id);
        const unitPrice = inv?.last_purchase_price ?? 0;
        recipeRows.push({
          'Nama Menu': menu.name,
          Kategori: catMap.get(menu.category_id) ?? '-',
          SKU: inv?.sku ?? '-',
          'Bahan Baku / Kemasan': inv?.name ?? rec.inventory_item_id,
          Takaran: rec.quantity_needed,
          Satuan: inv?.unit ?? '-',
          'Harga Satuan Bahan (Rp)': unitPrice,
          'Biaya Bahan per Porsi (Rp)': Math.round(unitPrice * rec.quantity_needed),
        });
      }
    }
    sheets.push({ name: 'Resep BOM', rows: recipeRows });
  }

  return {
    fileName: `${sanitizeFilePrefix(shopName)}_${includeHpp ? 'Menu_HPP' : 'Daftar_Menu'}_${formatPeriodFileSlug(startDate, endDate)}.xlsx`,
    sheets,
    recordCount: menus.length,
    summaryText: `${menus.length} menu · ${totalUnitsSold} porsi terjual pada periode terpilih`,
  };
}

// ============================================================================
// 3. INVENTORI
// ============================================================================
export function buildInventoryExcelData(params: {
  inventory: InventoryItem[];
  purchases: PurchaseRecord[];
  opnameLogs: StockOpnameLog[];
  startDate: string;
  endDate: string;
  shopName?: string;
}): ExcelExportPayload {
  const { inventory, purchases, opnameLogs, startDate, endDate, shopName } = params;

  const periodPurchases = purchases.filter((p) =>
    isIsoDateInRange(p.purchase_date, startDate, endDate)
  );
  const periodOpnames = opnameLogs.filter((l) =>
    isIsoDateInRange(l.completed_at, startDate, endDate)
  );

  // Per-item inbound purchase quantity & opname variance in period
  const inboundQtyMap = new Map<string, number>();
  const inboundValueMap = new Map<string, number>();
  const opnameVarianceMap = new Map<string, number>();
  const movementRows: Array<Record<string, string | number>> = [];

  for (const po of periodPurchases) {
    for (const item of po.items) {
      if (!item.inventory_item_id) continue;
      inboundQtyMap.set(
        item.inventory_item_id,
        (inboundQtyMap.get(item.inventory_item_id) ?? 0) + item.quantity
      );
      const val = Math.round(item.quantity * item.unit_price);
      inboundValueMap.set(
        item.inventory_item_id,
        (inboundValueMap.get(item.inventory_item_id) ?? 0) + val
      );
      movementRows.push({
        Tanggal: formatDateTimeId(po.purchase_date),
        Jenis: 'Pembelian Masuk',
        Referensi: po.invoice_number,
        'Nama Item': item.item_name,
        'Perubahan Qty': item.quantity,
        Satuan: item.unit,
        'Estimasi Nilai (Rp)': val,
        Keterangan: `Supplier: ${po.supplier_name}`,
      });
    }
  }

  for (const log of periodOpnames) {
    for (const d of log.details ?? []) {
      opnameVarianceMap.set(
        d.inventory_item_id,
        (opnameVarianceMap.get(d.inventory_item_id) ?? 0) + d.variance
      );
      if (d.variance !== 0) {
        movementRows.push({
          Tanggal: formatDateTimeId(log.completed_at),
          Jenis: 'Penyesuaian Opname',
          Referensi: log.schedule_title,
          'Nama Item': d.item_name,
          'Perubahan Qty': d.variance,
          Satuan: d.unit,
          'Estimasi Nilai (Rp)': Math.round(d.variance * d.unit_price),
          Keterangan: d.reason || log.notes || `Pelaksana: ${log.performed_by_name}`,
        });
      }
    }
  }

  const totalValuation = inventory.reduce(
    (sum, item) => sum + Math.round(item.current_stock * item.last_purchase_price),
    0
  );
  const lowStockCount = inventory.filter(
    (item) => item.category_type !== 'asset' && item.current_stock <= item.min_stock_threshold
  ).length;
  const totalInboundValue = Array.from(inboundValueMap.values()).reduce((a, b) => a + b, 0);

  const periodLabel = formatPeriodLabel(startDate, endDate);
  const summaryRows: Array<Record<string, string | number>> = [
    { Keterangan: 'Nama Outlet', Nilai: shopName || 'BrewFlow Coffee' },
    { Keterangan: 'Periode Aktivitas Stok', Nilai: periodLabel },
    { Keterangan: 'Total Item Inventori', Nilai: inventory.length },
    { Keterangan: 'Item Stok Menipis / Habis', Nilai: lowStockCount },
    { Keterangan: 'Total Valuasi Stok Saat Ini (Rp)', Nilai: totalValuation },
    { Keterangan: 'Total Nilai Pembelian Stok Periode (Rp)', Nilai: totalInboundValue },
    { Keterangan: 'Jumlah Sesi Stock Opname Periode', Nilai: periodOpnames.length },
    { Keterangan: 'Total Baris Mutasi Periode', Nilai: movementRows.length },
  ];

  const masterRows: Array<Record<string, string | number>> = inventory.map((item) => {
    const expCat =
      item.expense_category ?? getDefaultExpenseCategoryForInventory(item.category_type);
    const status =
      item.category_type === 'asset'
        ? item.asset_condition || 'Baik'
        : item.current_stock <= 0
          ? 'Habis'
          : item.current_stock <= item.min_stock_threshold
            ? 'Menipis'
            : 'Aman';

    return {
      SKU: item.sku,
      'Nama Item': item.name,
      Kategori: formatInventoryCategoryLabel(item.category_type),
      'Kategori Biaya': getExpenseCategoryLabel(expCat),
      Satuan: item.unit,
      'Stok Saat Ini': item.current_stock,
      'Batas Minimal': item.min_stock_threshold,
      'Status / Kondisi': status,
      'Harga Beli Terakhir (Rp)': item.last_purchase_price,
      'Valuasi Stok (Rp)': Math.round(item.current_stock * item.last_purchase_price),
      'Masuk Pembelian (Periode)': inboundQtyMap.get(item.id) ?? 0,
      'Selisih Opname (Periode)': opnameVarianceMap.get(item.id) ?? 0,
      'Terakhir Diperbarui': formatDateTimeId(item.updated_at),
    };
  });

  return {
    fileName: `${sanitizeFilePrefix(shopName)}_Inventori_${formatPeriodFileSlug(startDate, endDate)}.xlsx`,
    sheets: [
      { name: 'Ringkasan', rows: summaryRows },
      { name: 'Master Stok & Valuasi', rows: masterRows },
      { name: 'Mutasi Stok Periode', rows: movementRows },
    ],
    recordCount: inventory.length,
    summaryText: `${inventory.length} item inventori · ${movementRows.length} mutasi stok di periode terpilih`,
  };
}

// ============================================================================
// 4. PEMBELIAN & PENGELUARAN
// ============================================================================
export function buildPurchasingExcelData(params: {
  purchases: PurchaseRecord[];
  startDate: string;
  endDate: string;
  categoryFilter?: ExpenseCategoryId | 'all';
  shopName?: string;
}): ExcelExportPayload {
  const { purchases, startDate, endDate, categoryFilter = 'all', shopName } = params;
  const filtered = purchases.filter((po) => {
    if (categoryFilter !== 'all' && po.expense_category !== categoryFilter) return false;
    return isIsoDateInRange(po.purchase_date, startDate, endDate);
  });

  let totalAll = 0;
  let totalStockAsset = 0;
  let totalOperational = 0;
  const byCategory = new Map<ExpenseCategoryId, { count: number; total: number }>();

  for (const po of filtered) {
    totalAll += po.total_cost;
    if (isInventoryLinkedExpenseCategory(po.expense_category)) {
      totalStockAsset += po.total_cost;
    } else {
      totalOperational += po.total_cost;
    }
    const prev = byCategory.get(po.expense_category) ?? { count: 0, total: 0 };
    prev.count += 1;
    prev.total += po.total_cost;
    byCategory.set(po.expense_category, prev);
  }

  const periodLabel = formatPeriodLabel(startDate, endDate);
  const summaryRows: Array<Record<string, string | number>> = [
    { Keterangan: 'Nama Outlet', Nilai: shopName || 'BrewFlow Coffee' },
    { Keterangan: 'Periode Laporan', Nilai: periodLabel },
    {
      Keterangan: 'Filter Kategori',
      Nilai: categoryFilter === 'all' ? 'Semua Kategori' : getExpenseCategoryLabel(categoryFilter),
    },
    { Keterangan: 'Total Bukti Transaksi', Nilai: filtered.length },
    { Keterangan: 'Total Pengeluaran (Rp)', Nilai: totalAll },
    { Keterangan: 'Pembelian Stok, Kemasan & Aset (Rp)', Nilai: totalStockAsset },
    { Keterangan: 'Biaya Operasional & Lainnya (Rp)', Nilai: totalOperational },
  ];

  for (const [catId, stat] of byCategory.entries()) {
    summaryRows.push({
      Keterangan: `Kategori: ${getExpenseCategoryLabel(catId)} (${stat.count}x)`,
      Nilai: stat.total,
    });
  }

  const purchaseRows: Array<Record<string, string | number>> = filtered.map((po) => ({
    'Tanggal & Jam': formatDateTimeId(po.purchase_date),
    'No. Invoice': po.invoice_number,
    'Kategori Pengeluaran': getExpenseCategoryLabel(po.expense_category),
    'Supplier / Penerima': po.supplier_name,
    'Metode Bayar': formatPaymentMethodLabel(po.payment_method),
    'Dicatat Oleh': po.purchased_by_name,
    'Jumlah Baris Item': po.items.length,
    'Total Biaya (Rp)': po.total_cost,
    Catatan: po.notes || '-',
  }));

  const detailRows: Array<Record<string, string | number>> = [];
  for (const po of filtered) {
    for (const item of po.items) {
      detailRows.push({
        'Tanggal & Jam': formatDateTimeId(po.purchase_date),
        'No. Invoice': po.invoice_number,
        Kategori: getExpenseCategoryLabel(po.expense_category),
        Supplier: po.supplier_name,
        'Nama Item / Deskripsi': item.item_name,
        Tipe: item.inventory_item_id ? 'Inventori' : 'Biaya Non-Stok',
        Qty: item.quantity,
        Satuan: item.unit,
        'Harga Satuan (Rp)': item.unit_price,
        'Subtotal (Rp)': Math.round(item.quantity * item.unit_price),
      });
    }
  }

  return {
    fileName: `${sanitizeFilePrefix(shopName)}_Pembelian_${formatPeriodFileSlug(startDate, endDate)}.xlsx`,
    sheets: [
      { name: 'Ringkasan', rows: summaryRows },
      { name: 'Daftar Pembelian', rows: purchaseRows },
      { name: 'Detail Item Pembelian', rows: detailRows },
    ],
    recordCount: filtered.length,
    summaryText: `${filtered.length} transaksi pembelian/pengeluaran (${detailRows.length} rincian item)`,
  };
}

// ============================================================================
// 5. STOCK OPNAME
// ============================================================================
export function buildStockOpnameExcelData(params: {
  opnameLogs: StockOpnameLog[];
  startDate: string;
  endDate: string;
  shopName?: string;
}): ExcelExportPayload {
  const { opnameLogs, startDate, endDate, shopName } = params;
  const filtered = opnameLogs.filter((log) =>
    isIsoDateInRange(log.completed_at, startDate, endDate)
  );

  let totalItemsChecked = 0;
  let totalDiscrepancies = 0;
  let totalVarianceValue = 0;

  const sessionRows: Array<Record<string, string | number>> = [];
  const detailRows: Array<Record<string, string | number>> = [];

  for (const log of filtered) {
    totalItemsChecked += log.total_items_checked;
    totalDiscrepancies += log.discrepancy_count;

    const sessionVarValue = (log.details ?? []).reduce(
      (sum, d) => sum + Math.round(d.variance * d.unit_price),
      0
    );
    totalVarianceValue += sessionVarValue;

    sessionRows.push({
      'Tanggal & Jam Selesai': formatDateTimeId(log.completed_at),
      'Jadwal Opname': log.schedule_title,
      Pelaksana: log.performed_by_name,
      'Item Diperiksa': log.total_items_checked,
      'Jumlah Selisih': log.discrepancy_count,
      'Estimasi Nilai Selisih (Rp)': sessionVarValue,
      'Laporan WhatsApp': log.whatsapp_sent ? 'Terkirim' : 'Tidak / Belum',
      Catatan: log.notes || '-',
    });

    for (const d of log.details ?? []) {
      detailRows.push({
        'Tanggal Opname': formatDateTimeId(log.completed_at),
        'Jadwal Opname': log.schedule_title,
        Pelaksana: log.performed_by_name,
        SKU: d.sku,
        'Nama Item': d.item_name,
        Satuan: d.unit,
        'Stok Sistem': d.system_stock,
        'Stok Fisik Aktual': d.actual_stock,
        Selisih: d.variance,
        'Harga Satuan (Rp)': d.unit_price,
        'Nilai Selisih (Rp)': Math.round(d.variance * d.unit_price),
        Keterangan: d.reason || '-',
      });
    }
  }

  const periodLabel = formatPeriodLabel(startDate, endDate);
  const summaryRows: Array<Record<string, string | number>> = [
    { Keterangan: 'Nama Outlet', Nilai: shopName || 'BrewFlow Coffee' },
    { Keterangan: 'Periode Laporan', Nilai: periodLabel },
    { Keterangan: 'Total Sesi Stock Opname', Nilai: filtered.length },
    { Keterangan: 'Total Item Diperiksa', Nilai: totalItemsChecked },
    { Keterangan: 'Total Temuan Selisih', Nilai: totalDiscrepancies },
    { Keterangan: 'Estimasi Nilai Selisih Total (Rp)', Nilai: totalVarianceValue },
  ];

  return {
    fileName: `${sanitizeFilePrefix(shopName)}_Stock_Opname_${formatPeriodFileSlug(startDate, endDate)}.xlsx`,
    sheets: [
      { name: 'Ringkasan', rows: summaryRows },
      { name: 'Sesi Stock Opname', rows: sessionRows },
      { name: 'Detail Selisih Item', rows: detailRows },
    ],
    recordCount: filtered.length,
    summaryText: `${filtered.length} sesi stock opname (${detailRows.length} rincian item)`,
  };
}

// ============================================================================
// WORKBOOK GENERATOR & BROWSER DOWNLOAD
// ============================================================================
export function createExcelWorkbook(payload: ExcelExportPayload): Uint8Array {
  return buildXlsxBytes(
    payload.sheets.map((sheet) => ({
      name: sanitizeSheetName(sheet.name),
      rows:
        sheet.rows.length > 0
          ? sheet.rows
          : [{ Info: 'Tidak ada data pada periode yang dipilih.' }],
    }))
  );
}

export function downloadExcelWorkbook(payload: ExcelExportPayload): void {
  const bytes = createExcelWorkbook(payload);
  const blob = new Blob([bytes.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = payload.fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
