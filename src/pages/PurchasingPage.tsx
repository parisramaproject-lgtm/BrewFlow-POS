import React, { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Filter,
  Plus,
  ReceiptText,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import { PeriodicExcelExport } from '../components/common/PeriodicExcelExport';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import type {
  ExpenseCategoryId,
  ExpensePaymentMethod,
  InventoryItem,
  ItemCategoryType,
  PurchaseItemRecord,
  PurchaseRecord,
} from '../types';
import { buildPurchasingExcelData } from '../utils/excelExport';
import {
  EXPENSE_CATEGORIES,
  getDefaultExpenseCategoryForInventory,
  getExpenseCategory,
  getExpenseCategoryLabel,
  getInventoryTypeForExpenseCategory,
  isInventoryLinkedExpenseCategory,
} from '../utils/expenseCategories';
import { formatDateTime, formatRupiah } from '../utils/format';

const OTHER_INVENTORY_VALUE = '__other__';

const INVENTORY_CATEGORY_OPTIONS: Array<{ id: ItemCategoryType; label: string; defaultUnit: string }> = [
  { id: 'raw_material', label: 'Bahan Baku', defaultUnit: 'gr' },
  { id: 'packaging', label: 'Kemasan', defaultUnit: 'pcs' },
  { id: 'asset', label: 'Aset Coffee Shop', defaultUnit: 'unit' },
  { id: 'operational', label: 'Operasional & Lainnya', defaultUnit: 'pcs' },
];

function getDefaultUnitForInventoryCategory(cat: ItemCategoryType): string {
  return INVENTORY_CATEGORY_OPTIONS.find((opt) => opt.id === cat)?.defaultUnit ?? 'pcs';
}

function getInventoryCategoryLabel(cat: ItemCategoryType): string {
  return INVENTORY_CATEGORY_OPTIONS.find((opt) => opt.id === cat)?.label ?? 'Bahan Baku';
}

interface DraftPurchaseLine {
  rowId: string;
  mode: 'inventory' | 'custom';
  inventory_item_id: string;
  new_item_name: string;
  new_item_unit: string;
  new_item_sku: string;
  new_item_min_stock: string;
  new_item_category: ItemCategoryType;
  custom_name: string;
  custom_unit: string;
  quantity: string;
  unit_price: string;
}

const PAYMENT_METHOD_LABELS: Record<ExpensePaymentMethod, string> = {
  transfer: 'Transfer Bank',
  cash: 'Tunai / Kas Kedai',
  qris: 'QRIS',
  debit: 'Kartu Debit',
};

export function PurchasingPage() {
  const { user, authMode } = useAuth();
  const { inventory, purchases, settings, addInventoryItem, createPurchase } = useStore();
  const liveSupabaseEnabled = authMode === 'supabase';

  const inventoryById = useMemo(
    () => new Map(inventory.map((i) => [i.id, i])),
    [inventory]
  );

  const [expenseCategory, setExpenseCategory] =
    useState<ExpenseCategoryId>('pembelian_bahan_baku');
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('transfer');
  const [notes, setNotes] = useState('');
  const [historyCategoryFilter, setHistoryCategoryFilter] = useState<ExpenseCategoryId | 'all'>(
    'all'
  );

  const suggestedInventoryForCategory = useMemo(() => {
    const cat = getExpenseCategory(expenseCategory);
    const exactMatch = inventory.filter(
      (i) =>
        i.expense_category === expenseCategory ||
        i.category_type === cat.inventoryCategoryType
    );
    return exactMatch.length > 0 ? exactMatch : inventory;
  }, [inventory, expenseCategory]);

  const makeDefaultLine = (
    catId: ExpenseCategoryId,
    rowId: string,
    preferUnusedFrom?: DraftPurchaseLine[]
  ): DraftPurchaseLine => {
    const isInvLinked = isInventoryLinkedExpenseCategory(catId);
    const defaultInvCategory = getInventoryTypeForExpenseCategory(catId);
    const defaultInvUnit = getDefaultUnitForInventoryCategory(defaultInvCategory);

    if (isInvLinked) {
      const cat = getExpenseCategory(catId);
      const pool = inventory.filter(
        (i) => i.expense_category === catId || i.category_type === cat.inventoryCategoryType
      );
      const candidates = pool.length > 0 ? pool : inventory;
      const usedIds = new Set((preferUnusedFrom ?? []).map((l) => l.inventory_item_id));
      const picked = candidates.find((i) => !usedIds.has(i.id)) ?? candidates[0];
      return {
        rowId,
        mode: 'inventory',
        inventory_item_id: picked?.id ?? OTHER_INVENTORY_VALUE,
        new_item_name: '',
        new_item_unit: defaultInvUnit,
        new_item_sku: '',
        new_item_min_stock: defaultInvCategory === 'asset' ? '0' : '10',
        new_item_category: defaultInvCategory,
        custom_name: '',
        custom_unit: picked?.unit ?? defaultInvUnit,
        quantity: '',
        unit_price: picked ? String(picked.last_purchase_price) : '',
      };
    }

    const defaultUnit =
      catId === 'gaji_karyawan'
        ? 'orang'
        : catId === 'sewa_tempat' || catId === 'listrik_air_internet' || catId === 'cicilan_pinjaman'
          ? 'bulan'
          : catId === 'perawatan_mesin' || catId === 'pajak_perizinan'
            ? 'kali'
            : 'paket';

    return {
      rowId,
      mode: 'custom',
      inventory_item_id: '',
      new_item_name: '',
      new_item_unit: defaultInvUnit,
      new_item_sku: '',
      new_item_min_stock: '0',
      new_item_category: defaultInvCategory,
      custom_name: '',
      custom_unit: defaultUnit,
      quantity: '1',
      unit_price: '',
    };
  };

  const [lines, setLines] = useState<DraftPurchaseLine[]>(() => [
    makeDefaultLine('pembelian_bahan_baku', 'line-1'),
  ]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseRecord | null>(null);

  const handleCategoryChange = (nextCat: ExpenseCategoryId) => {
    setExpenseCategory(nextCat);
    setLines([makeDefaultLine(nextCat, `line-${Date.now()}`)]);
    setErrorMsg(null);
  };

  const draftTotalCost = useMemo(() => {
    return lines.reduce((sum, line) => {
      const qty = Number(line.quantity) || 0;
      const price = Number(line.unit_price) || 0;
      return sum + qty * price;
    }, 0);
  }, [lines]);

  const purchaseStats = useMemo(() => {
    let totalAll = 0;
    let totalStockAsset = 0;
    let totalOperational = 0;
    for (const po of purchases) {
      totalAll += po.total_cost;
      if (isInventoryLinkedExpenseCategory(po.expense_category)) {
        totalStockAsset += po.total_cost;
      } else {
        totalOperational += po.total_cost;
      }
    }
    return { totalAll, totalStockAsset, totalOperational };
  }, [purchases]);

  const filteredPurchases = useMemo(() => {
    if (historyCategoryFilter === 'all') return purchases;
    return purchases.filter((po) => po.expense_category === historyCategoryFilter);
  }, [purchases, historyCategoryFilter]);

  const handleAddLine = () => {
    setLines((prev) => [
      ...prev,
      makeDefaultLine(expenseCategory, `line-${Date.now()}-${prev.length + 1}`, prev),
    ]);
  };

  const handleUpdateLine = (
    rowId: string,
    field:
      | 'mode'
      | 'inventory_item_id'
      | 'new_item_name'
      | 'new_item_unit'
      | 'new_item_sku'
      | 'new_item_min_stock'
      | 'new_item_category'
      | 'custom_name'
      | 'custom_unit'
      | 'quantity'
      | 'unit_price',
    value: string
  ) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.rowId !== rowId) return line;
        if (field === 'mode') {
          const nextMode = value as 'inventory' | 'custom';
          const defaultInvCat = getInventoryTypeForExpenseCategory(expenseCategory);
          if (nextMode === 'inventory') {
            const firstInv = suggestedInventoryForCategory[0] ?? inventory[0];
            return {
              ...line,
              mode: 'inventory',
              inventory_item_id: firstInv?.id ?? OTHER_INVENTORY_VALUE,
              new_item_category: defaultInvCat,
              new_item_unit: getDefaultUnitForInventoryCategory(defaultInvCat),
              unit_price: firstInv ? String(firstInv.last_purchase_price) : line.unit_price,
            };
          }
          return {
            ...line,
            mode: 'custom',
            inventory_item_id: '',
          };
        }
        if (field === 'inventory_item_id') {
          if (value === OTHER_INVENTORY_VALUE) {
            const defaultInvCat = getInventoryTypeForExpenseCategory(expenseCategory);
            return {
              ...line,
              inventory_item_id: OTHER_INVENTORY_VALUE,
              new_item_category: line.new_item_category || defaultInvCat,
              new_item_unit:
                line.new_item_unit || getDefaultUnitForInventoryCategory(defaultInvCat),
              new_item_min_stock: defaultInvCat === 'asset' ? '0' : line.new_item_min_stock || '10',
              unit_price: '',
            };
          }
          const inv = inventoryById.get(value);
          return {
            ...line,
            inventory_item_id: value,
            unit_price: inv ? String(inv.last_purchase_price) : line.unit_price,
          };
        }
        if (field === 'new_item_category') {
          const nextCat = value as ItemCategoryType;
          return {
            ...line,
            new_item_category: nextCat,
            new_item_unit: getDefaultUnitForInventoryCategory(nextCat),
            new_item_min_stock: nextCat === 'asset' ? '0' : line.new_item_min_stock || '10',
          };
        }
        return { ...line, [field]: value };
      })
    );
  };

  const handleRemoveLine = (rowId: string) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((l) => l.rowId !== rowId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!supplierName.trim()) {
      setErrorMsg('Nama supplier / pihak penerima wajib diisi.');
      return;
    }

    // Validate all lines upfront before mutating inventory or creating the purchase
    for (const line of lines) {
      const qtyNum = Number(line.quantity);
      const priceNum = Number(line.unit_price);

      if (line.mode === 'inventory') {
        if (line.inventory_item_id === OTHER_INVENTORY_VALUE) {
          if (
            !line.new_item_name.trim() ||
            !line.new_item_unit.trim() ||
            !qtyNum ||
            qtyNum <= 0 ||
            !priceNum ||
            priceNum <= 0
          ) {
            setErrorMsg(
              'Untuk pilihan "Lainnya", isi nama item inventori baru, satuan, jumlah (> 0), dan harga satuan (> 0).'
            );
            return;
          }
        } else {
          const inv = inventoryById.get(line.inventory_item_id);
          if (!inv || !qtyNum || qtyNum <= 0 || !priceNum || priceNum <= 0) {
            setErrorMsg(
              'Pastikan setiap baris inventori memiliki item, jumlah (> 0), dan harga satuan (> 0) yang valid.'
            );
            return;
          }
        }
      } else {
        if (!line.custom_name.trim() || !qtyNum || qtyNum <= 0 || !priceNum || priceNum <= 0) {
          setErrorMsg(
            'Pastikan setiap baris pengeluaran memiliki deskripsi biaya, jumlah (> 0), dan nominal (> 0).'
          );
          return;
        }
      }
    }

    if (lines.length === 0) {
      setErrorMsg('Tambahkan minimal 1 rincian pembelian atau pengeluaran.');
      return;
    }

    setSubmitting(true);
    const parsedItems: PurchaseItemRecord[] = [];
    const newlyCreatedInventoryItems: InventoryItem[] = [];
    const createdByKey = new Map<string, InventoryItem>();

    for (const line of lines) {
      const qtyNum = Number(line.quantity);
      const priceNum = Number(line.unit_price);

      if (line.mode === 'inventory') {
        if (line.inventory_item_id === OTHER_INVENTORY_VALUE) {
          const cleanName = line.new_item_name.trim();
          const cleanUnit = line.new_item_unit.trim() || 'pcs';
          const targetCategory =
            line.new_item_category || getInventoryTypeForExpenseCategory(expenseCategory);
          const dedupKey = `${targetCategory}:${cleanName.toLowerCase()}`;

          let targetItem = createdByKey.get(dedupKey);
          if (!targetItem) {
            const minStockNum =
              targetCategory === 'asset' ? 0 : Math.max(0, Number(line.new_item_min_stock) || 0);
            const itemExpenseCat =
              getInventoryTypeForExpenseCategory(expenseCategory) === targetCategory
                ? expenseCategory
                : getDefaultExpenseCategoryForInventory(targetCategory);

            // Start with current_stock: 0 because createPurchase immediately adds qtyNum
            targetItem = await addInventoryItem({
              name: cleanName,
              sku: line.new_item_sku.trim(),
              category_type: targetCategory,
              expense_category: itemExpenseCat,
              unit: cleanUnit,
              current_stock: 0,
              min_stock_threshold: minStockNum,
              last_purchase_price: priceNum,
              asset_condition: targetCategory === 'asset' ? 'Baik' : undefined,
              enableSupabaseSync: liveSupabaseEnabled,
            });
            createdByKey.set(dedupKey, targetItem);
            newlyCreatedInventoryItems.push(targetItem);
          }

          parsedItems.push({
            inventory_item_id: targetItem.id,
            item_name: targetItem.name,
            unit: targetItem.unit,
            quantity: qtyNum,
            unit_price: priceNum,
          });
        } else {
          const inv = inventoryById.get(line.inventory_item_id)!;
          parsedItems.push({
            inventory_item_id: inv.id,
            item_name: inv.name,
            unit: inv.unit,
            quantity: qtyNum,
            unit_price: priceNum,
          });
        }
      } else {
        parsedItems.push({
          inventory_item_id: null,
          item_name: line.custom_name.trim(),
          unit: line.custom_unit.trim() || 'paket',
          quantity: qtyNum,
          unit_price: priceNum,
        });
      }
    }

    const { purchase } = await createPurchase({
      expense_category: expenseCategory,
      supplier_name: supplierName,
      invoice_number: invoiceNumber,
      payment_method: paymentMethod,
      notes,
      purchased_by_id: user.id,
      purchased_by_name: user.full_name,
      items: parsedItems,
      extraInventoryItems: newlyCreatedInventoryItems,
      enableSupabaseSync: liveSupabaseEnabled,
    });
    setSubmitting(false);

    const hasStockUpdates = parsedItems.some((item) => Boolean(item.inventory_item_id));
    const latestPriceById = new Map(
      parsedItems
        .filter((i): i is PurchaseItemRecord & { inventory_item_id: string } =>
          Boolean(i.inventory_item_id)
        )
        .map((item) => [item.inventory_item_id, item.unit_price])
    );

    const nextResetLine = makeDefaultLine(expenseCategory, `line-${Date.now()}`);
    if (
      nextResetLine.mode === 'inventory' &&
      nextResetLine.inventory_item_id &&
      nextResetLine.inventory_item_id !== OTHER_INVENTORY_VALUE
    ) {
      const updatedUnitPrice = latestPriceById.get(nextResetLine.inventory_item_id);
      if (updatedUnitPrice !== undefined) {
        nextResetLine.unit_price = String(updatedUnitPrice);
      }
    }

    setSupplierName('');
    setInvoiceNumber('');
    setNotes('');
    setLines([nextResetLine]);
    setErrorMsg(null);

    if (newlyCreatedInventoryItems.length > 0) {
      const addedNames = newlyCreatedInventoryItems.map((i) => i.name).join(', ');
      setSavedMsg(
        `${getExpenseCategoryLabel(expenseCategory)} (${purchase.invoice_number} · ${formatRupiah(purchase.total_cost)}) tersimpan. ${newlyCreatedInventoryItems.length} item inventori baru (${addedNames}) otomatis ditambahkan ke menu Inventori & stok diperbarui.`
      );
    } else {
      setSavedMsg(
        hasStockUpdates
          ? `${getExpenseCategoryLabel(expenseCategory)} (${purchase.invoice_number} · ${formatRupiah(purchase.total_cost)}) tersimpan. Stok inventori & harga referensi HPP otomatis diperbarui.`
          : `Pengeluaran "${getExpenseCategoryLabel(expenseCategory)}" (${purchase.invoice_number} · ${formatRupiah(purchase.total_cost)}) berhasil dicatat.`
      );
    }
    window.setTimeout(() => setSavedMsg(null), 7000);
  };

  const isCurrentCategoryStockLinked = isInventoryLinkedExpenseCategory(expenseCategory);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#1A2E26]">
            Pembelian &amp; Pengeluaran Operasional
          </h1>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            Catat pembelian bahan baku, kemasan, aset, hingga seluruh biaya operasional kedai (gaji,
            sewa, utilitas, perawatan mesin, promo, dan lainnya).
          </p>
        </div>

        <PeriodicExcelExport
          moduleTitle="Pembelian & Pengeluaran"
          description="Tarik rekap pengeluaran per kategori, daftar invoice, dan rincian item pembelian per periode."
          testId="export-purchasing-excel"
          buildExport={({ startDate, endDate }) =>
            buildPurchasingExcelData({
              purchases,
              startDate,
              endDate,
              categoryFilter: historyCategoryFilter,
              shopName: settings.shopName,
            })
          }
        />
      </div>

      {/* Expense Summary Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
          <p className="text-xs font-medium text-[#6B7280]">Total Pengeluaran Tercatat</p>
          <p className="mt-1.5 text-xl font-bold text-[#1A2E26] tabular-nums">
            {formatRupiah(purchaseStats.totalAll)}
          </p>
          <p className="mt-1 text-[11px] text-[#6B7280]">{purchases.length} bukti transaksi</p>
        </div>
        <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
          <p className="text-xs font-medium text-[#6B7280]">Pembelian Stok, Kemasan &amp; Asset</p>
          <p className="mt-1.5 text-xl font-bold text-[#109A58] tabular-nums">
            {formatRupiah(purchaseStats.totalStockAsset)}
          </p>
          <p className="mt-1 text-[11px] text-[#6B7280]">Tersinkron ke stok &amp; HPP</p>
        </div>
        <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
          <p className="text-xs font-medium text-[#6B7280]">Biaya Operasional &amp; Lainnya</p>
          <p className="mt-1.5 text-xl font-bold text-[#1A2E26] tabular-nums">
            {formatRupiah(purchaseStats.totalOperational)}
          </p>
          <p className="mt-1 text-[11px] text-[#6B7280]">Gaji, sewa, utilitas, promo, dll.</p>
        </div>
      </div>

      {savedMsg && (
        <div
          role="status"
          data-testid="purchase-saved-banner"
          className="flex items-center justify-between gap-3 rounded-xl border border-[#109A58]/30 bg-[#E6F5EE] px-4 py-3 text-xs font-semibold text-[#109A58]"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{savedMsg}</span>
          </span>
          <button
            type="button"
            onClick={() => setSavedMsg(null)}
            aria-label="Tutup pesan sukses pembelian"
            className="text-[#109A58] hover:text-[#0D8A4E]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Multi-Item Purchase / Expense Entry Form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5 space-y-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E7EB] pb-4">
          <div>
            <h2 className="text-base font-semibold text-[#1A2E26]">
              Form Catat Pembelian / Pengeluaran
            </h2>
            <p className="mt-0.5 text-xs text-[#6B7280]">
              Pilih kategori biaya di bawah. Pembelian stok otomatis memperbarui inventori &amp;
              harga modal HPP.
            </p>
          </div>
          <div className="rounded-xl bg-[#F4F6F5] px-4 py-2 text-right">
            <p className="text-[11px] font-medium text-[#6B7280]">Estimasi Total Nota</p>
            <p
              data-testid="purchase-draft-total"
              className="text-base font-bold text-[#1A2E26] tabular-nums"
            >
              {formatRupiah(Math.round(draftTotalCost))}
            </p>
          </div>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-xl border border-[#EF4444]/30 bg-[#FEF2F2] px-3.5 py-2.5 text-xs font-medium text-[#EF4444]"
          >
            {errorMsg}
          </div>
        )}

        {/* Category, Supplier, Invoice, Payment Method Header */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="po-category" className="block text-xs font-semibold text-[#1A2E26]">
              Kategori Pengeluaran / Pembelian *
            </label>
            <select
              id="po-category"
              value={expenseCategory}
              onChange={(e) => handleCategoryChange(e.target.value as ExpenseCategoryId)}
              className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            >
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="po-supplier" className="block text-xs font-semibold text-[#1A2E26]">
              {isCurrentCategoryStockLinked
                ? 'Nama Supplier / Vendor *'
                : 'Pihak Penerima / Vendor *'}
            </label>
            <input
              id="po-supplier"
              type="text"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder={
                isCurrentCategoryStockLinked
                  ? 'Misal: PT Kopi Nusantara Roastery'
                  : 'Misal: PLN / Pemilik Ruko / Payroll Tim'
              }
              className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="po-invoice" className="block text-xs font-semibold text-[#1A2E26]">
              No. Nota / Bukti Bayar
            </label>
            <input
              id="po-invoice"
              type="text"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="Otomatis jika kosong"
              className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 font-mono text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="po-payment" className="block text-xs font-semibold text-[#1A2E26]">
              Metode Pembayaran
            </label>
            <select
              id="po-payment"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as ExpensePaymentMethod)}
              className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            >
              {(Object.keys(PAYMENT_METHOD_LABELS) as ExpensePaymentMethod[]).map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Multi-Item Purchase / Expense Lines */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
              Rincian {getExpenseCategoryLabel(expenseCategory)} ({lines.length} baris)
            </h3>
            <button
              type="button"
              onClick={handleAddLine}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#E6F5EE] px-3.5 py-1.5 text-xs font-semibold text-[#109A58] transition-colors hover:bg-[#D5EFE2]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Tambah Baris Rincian</span>
            </button>
          </div>

          <div className="space-y-2.5">
            {lines.map((line, index) => {
              const isOtherInventory =
                line.mode === 'inventory' && line.inventory_item_id === OTHER_INVENTORY_VALUE;
              const selectedInv =
                line.mode === 'inventory' && !isOtherInventory
                  ? inventoryById.get(line.inventory_item_id)
                  : undefined;
              const activeUnit =
                line.mode === 'inventory'
                  ? isOtherInventory
                    ? line.new_item_unit.trim() || 'unit'
                    : selectedInv?.unit ?? 'unit'
                  : line.custom_unit || 'unit';
              const qtyNum = Number(line.quantity) || 0;
              const priceNum = Number(line.unit_price) || 0;
              const lineSubtotal = qtyNum * priceNum;
              const priceDelta = selectedInv ? priceNum - selectedInv.last_purchase_price : 0;

              return (
                <div
                  key={line.rowId}
                  className="grid grid-cols-1 gap-3 rounded-xl border border-[#E5E7EB] bg-[#F4F6F5]/60 p-3.5 lg:grid-cols-12 lg:items-end"
                >
                  {line.mode === 'inventory' ? (
                    <div className="lg:col-span-5">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor={`po-item-${index}`}
                          className="block text-[11px] font-medium text-[#6B7280]"
                        >
                          Item Inventori #{index + 1}
                        </label>
                        <button
                          type="button"
                          onClick={() => handleUpdateLine(line.rowId, 'mode', 'custom')}
                          className="text-[11px] font-semibold text-[#109A58] hover:underline"
                        >
                          Input Bebas
                        </button>
                      </div>
                      <select
                        id={`po-item-${index}`}
                        value={line.inventory_item_id}
                        onChange={(e) =>
                          handleUpdateLine(line.rowId, 'inventory_item_id', e.target.value)
                        }
                        className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                      >
                        {suggestedInventoryForCategory.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({item.sku} · Stok: {item.current_stock} {item.unit})
                          </option>
                        ))}
                        <option value={OTHER_INVENTORY_VALUE}>
                          Lainnya (Tambah Item Inventori Baru)
                        </option>
                      </select>
                    </div>
                  ) : (
                    <>
                      <div className="lg:col-span-4">
                        <div className="flex items-center justify-between">
                          <label
                            htmlFor={`po-custom-name-${index}`}
                            className="block text-[11px] font-medium text-[#6B7280]"
                          >
                            Deskripsi Pengeluaran #{index + 1}
                          </label>
                          <button
                            type="button"
                            onClick={() => handleUpdateLine(line.rowId, 'mode', 'inventory')}
                            className="text-[11px] font-semibold text-[#109A58] hover:underline"
                          >
                            Tautkan Inventori
                          </button>
                        </div>
                        <input
                          id={`po-custom-name-${index}`}
                          type="text"
                          value={line.custom_name}
                          onChange={(e) =>
                            handleUpdateLine(line.rowId, 'custom_name', e.target.value)
                          }
                          placeholder={`Contoh: ${getExpenseCategoryLabel(expenseCategory)}`}
                          className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                        />
                      </div>
                      <div className="lg:col-span-1">
                        <label
                          htmlFor={`po-custom-unit-${index}`}
                          className="block text-[11px] font-medium text-[#6B7280]"
                        >
                          Satuan
                        </label>
                        <input
                          id={`po-custom-unit-${index}`}
                          type="text"
                          value={line.custom_unit}
                          onChange={(e) =>
                            handleUpdateLine(line.rowId, 'custom_unit', e.target.value)
                          }
                          placeholder="paket"
                          className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-2.5 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                        />
                      </div>
                    </>
                  )}

                  <div className="lg:col-span-2">
                    <label
                      htmlFor={`po-qty-${index}`}
                      className="block text-[11px] font-medium text-[#6B7280]"
                    >
                      Jumlah ({activeUnit})
                    </label>
                    <input
                      id={`po-qty-${index}`}
                      type="number"
                      min={0.1}
                      step="any"
                      value={line.quantity}
                      onChange={(e) => handleUpdateLine(line.rowId, 'quantity', e.target.value)}
                      placeholder="1"
                      className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                    />
                  </div>

                  <div className="lg:col-span-2">
                    <label
                      htmlFor={`po-price-${index}`}
                      className="block text-[11px] font-medium text-[#6B7280]"
                    >
                      Nominal / {activeUnit} (Rp)
                    </label>
                    <input
                      id={`po-price-${index}`}
                      type="number"
                      min={1}
                      step="any"
                      value={line.unit_price}
                      onChange={(e) => handleUpdateLine(line.rowId, 'unit_price', e.target.value)}
                      placeholder="0"
                      className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 lg:col-span-3">
                    <div className="min-w-0">
                      <p className="text-[11px] text-[#6B7280]">Subtotal</p>
                      <p className="text-xs font-bold text-[#1A2E26] tabular-nums">
                        {formatRupiah(Math.round(lineSubtotal))}
                      </p>
                      {selectedInv && priceNum > 0 && priceDelta !== 0 && (
                        <p
                          className={`mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums ${
                            priceDelta > 0 ? 'text-[#EF4444]' : 'text-[#109A58]'
                          }`}
                        >
                          {priceDelta > 0 ? (
                            <ArrowUpRight className="h-3 w-3" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3" />
                          )}
                          {priceDelta > 0 ? '+' : ''}
                          {formatRupiah(priceDelta)} vs lalu
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={lines.length <= 1}
                      onClick={() => handleRemoveLine(line.rowId)}
                      aria-label={`Hapus baris rincian #${index + 1}`}
                      className="rounded-lg p-2 text-[#6B7280] transition-colors hover:bg-[#FEF2F2] hover:text-[#EF4444] disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Inline New Inventory Item Fields when "Lainnya" is selected */}
                  {isOtherInventory && (
                    <div
                      data-testid={`po-new-item-panel-${index}`}
                      className="grid grid-cols-1 gap-3 rounded-xl border border-[#109A58]/30 bg-[#E6F5EE]/50 p-3 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-12"
                    >
                      <div className="sm:col-span-2 lg:col-span-12">
                        <p className="text-[11px] font-semibold text-[#109A58]">
                          Item baru ini akan otomatis ditambahkan ke menu Inventori kategori{' '}
                          <span className="underline">
                            {getInventoryCategoryLabel(line.new_item_category)}
                          </span>{' '}
                          dengan stok sesuai jumlah pembelian.
                        </p>
                      </div>

                      <div className="lg:col-span-4">
                        <label
                          htmlFor={`po-new-name-${index}`}
                          className="block text-[11px] font-medium text-[#1A2E26]"
                        >
                          Nama Item Inventori Baru *
                        </label>
                        <input
                          id={`po-new-name-${index}`}
                          type="text"
                          value={line.new_item_name}
                          onChange={(e) =>
                            handleUpdateLine(line.rowId, 'new_item_name', e.target.value)
                          }
                          placeholder="Misal: Sirup Hazelnut / Cup 12oz / Grinder"
                          className="mt-1 h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                        />
                      </div>

                      <div className="lg:col-span-3">
                        <label
                          htmlFor={`po-new-category-${index}`}
                          className="block text-[11px] font-medium text-[#1A2E26]"
                        >
                          Kategori Inventori *
                        </label>
                        <select
                          id={`po-new-category-${index}`}
                          value={line.new_item_category}
                          onChange={(e) =>
                            handleUpdateLine(line.rowId, 'new_item_category', e.target.value)
                          }
                          className="mt-1 h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                        >
                          {INVENTORY_CATEGORY_OPTIONS.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="lg:col-span-2">
                        <label
                          htmlFor={`po-new-unit-${index}`}
                          className="block text-[11px] font-medium text-[#1A2E26]"
                        >
                          Satuan *
                        </label>
                        <input
                          id={`po-new-unit-${index}`}
                          type="text"
                          value={line.new_item_unit}
                          onChange={(e) =>
                            handleUpdateLine(line.rowId, 'new_item_unit', e.target.value)
                          }
                          placeholder="gr / ml / pcs / unit"
                          className="mt-1 h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                        />
                      </div>

                      {line.new_item_category !== 'asset' && (
                        <div className="lg:col-span-1">
                          <label
                            htmlFor={`po-new-min-${index}`}
                            className="block text-[11px] font-medium text-[#1A2E26] whitespace-nowrap"
                          >
                            Stok Min.
                          </label>
                          <input
                            id={`po-new-min-${index}`}
                            type="number"
                            min={0}
                            value={line.new_item_min_stock}
                            onChange={(e) =>
                              handleUpdateLine(line.rowId, 'new_item_min_stock', e.target.value)
                            }
                            className="mt-1 h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-2 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                          />
                        </div>
                      )}

                      <div
                        className={
                          line.new_item_category === 'asset' ? 'lg:col-span-3' : 'lg:col-span-2'
                        }
                      >
                        <label
                          htmlFor={`po-new-sku-${index}`}
                          className="block text-[11px] font-medium text-[#1A2E26]"
                        >
                          SKU (Opsional)
                        </label>
                        <input
                          id={`po-new-sku-${index}`}
                          type="text"
                          value={line.new_item_sku}
                          onChange={(e) =>
                            handleUpdateLine(line.rowId, 'new_item_sku', e.target.value)
                          }
                          placeholder="Otomatis"
                          className="mt-1 h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 font-mono text-xs text-[#1A2E26] uppercase focus:border-[#109A58] focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E7EB] pt-4">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Catatan tambahan (opsional, misal: periode pembayaran, nomor rekening, referensi promo)..."
            className="h-10 min-w-[260px] flex-1 rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] px-3.5 text-xs text-[#1A2E26] focus:border-[#109A58] focus:bg-white focus:outline-none"
          />
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#109A58] px-6 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E] disabled:opacity-50 whitespace-nowrap"
          >
            <ShoppingBag className="h-4 w-4" />
            <span>
              {submitting
                ? 'Menyimpan...'
                : isCurrentCategoryStockLinked
                  ? 'Simpan Pembelian & Update Stok'
                  : 'Simpan Pengeluaran'}
            </span>
          </button>
        </div>
      </form>

      {/* Purchase & Expense History Table */}
      <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#1A2E26]">
              Riwayat Pembelian &amp; Pengeluaran
            </h2>
            <p className="text-xs text-[#6B7280] tabular-nums">
              Menampilkan {filteredPurchases.length} dari {purchases.length} transaksi
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-[#6B7280]" />
            <select
              aria-label="Filter kategori pengeluaran"
              value={historyCategoryFilter}
              onChange={(e) =>
                setHistoryCategoryFilter(e.target.value as ExpenseCategoryId | 'all')
              }
              className="h-9 rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            >
              <option value="all">Semua Kategori ({purchases.length})</option>
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F4F6F5]/60 text-xs font-semibold text-[#6B7280]">
                <th className="px-5 py-3.5">No. Nota</th>
                <th className="px-4 py-3.5">Kategori</th>
                <th className="px-4 py-3.5">Supplier / Penerima</th>
                <th className="px-4 py-3.5">Rincian Item / Biaya</th>
                <th className="px-4 py-3.5">Tanggal</th>
                <th className="px-4 py-3.5 text-right">Total Biaya</th>
                <th className="px-5 py-3.5 text-right">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB]">
              {filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-xs text-[#6B7280]">
                    Belum ada catatan transaksi untuk kategori ini.
                  </td>
                </tr>
              ) : (
                filteredPurchases.map((po) => {
                  const stockLinked = isInventoryLinkedExpenseCategory(po.expense_category);
                  return (
                    <tr key={po.id} className="hover:bg-[#F4F6F5]/50">
                      <td className="px-5 py-3.5 font-mono text-xs font-medium text-[#1A2E26] whitespace-nowrap">
                        {po.invoice_number}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            stockLinked
                              ? 'bg-[#E6F5EE] text-[#109A58]'
                              : 'bg-[#F4F6F5] text-[#1A2E26]'
                          }`}
                        >
                          {getExpenseCategoryLabel(po.expense_category)}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-xs font-semibold text-[#1A2E26] whitespace-nowrap">
                        {po.supplier_name}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-[#6B7280]">
                        {po.items
                          .map((i) => `${i.item_name} (${i.quantity} ${i.unit})`)
                          .join(', ')}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-[#6B7280] tabular-nums whitespace-nowrap">
                        {formatDateTime(po.purchase_date)}
                      </td>
                      <td className="px-4 py-3.5 text-right text-xs font-bold text-[#1A2E26] tabular-nums whitespace-nowrap">
                        {formatRupiah(po.total_cost)}
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedPurchase(po)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#109A58] hover:underline"
                        >
                          <ReceiptText className="h-3.5 w-3.5" />
                          <span>Rincian</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Purchase / Expense Detail Modal */}
      {selectedPurchase && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label={`Rincian Nota ${selectedPurchase.invoice_number}`}
        >
          <div className="w-full max-w-lg rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3.5">
              <div>
                <span className="inline-flex rounded-full bg-[#E6F5EE] px-2.5 py-0.5 text-[11px] font-semibold text-[#109A58]">
                  {getExpenseCategoryLabel(selectedPurchase.expense_category)}
                </span>
                <h3 className="mt-1.5 text-base font-semibold text-[#1A2E26]">
                  Nota {selectedPurchase.invoice_number}
                </h3>
                <p className="mt-0.5 text-xs text-[#6B7280]">
                  {selectedPurchase.supplier_name} ·{' '}
                  {formatDateTime(selectedPurchase.purchase_date)}
                  {selectedPurchase.payment_method
                    ? ` · ${PAYMENT_METHOD_LABELS[selectedPurchase.payment_method]}`
                    : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPurchase(null)}
                aria-label="Tutup rincian pembelian"
                className="rounded-lg p-1 text-[#6B7280] hover:bg-[#F4F6F5]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 divide-y divide-[#E5E7EB]">
              {selectedPurchase.items.map((item, idx) => (
                <div
                  key={`${item.inventory_item_id ?? 'custom'}-${idx}`}
                  className="flex items-center justify-between py-2.5 text-xs"
                >
                  <div>
                    <p className="font-semibold text-[#1A2E26]">{item.item_name}</p>
                    <p className="text-[#6B7280] tabular-nums">
                      {item.quantity} {item.unit} × {formatRupiah(item.unit_price)}/{item.unit}
                    </p>
                  </div>
                  <span className="font-bold text-[#1A2E26] tabular-nums">
                    {formatRupiah(Math.round(item.quantity * item.unit_price))}
                  </span>
                </div>
              ))}
            </div>

            {selectedPurchase.notes && (
              <p className="mt-3 rounded-xl bg-[#F4F6F5] px-3 py-2 text-xs text-[#4B5563]">
                Catatan: {selectedPurchase.notes}
              </p>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-dashed border-[#E5E7EB] pt-3.5">
              <span className="text-xs font-medium text-[#6B7280]">
                Dicatat oleh {selectedPurchase.purchased_by_name}
              </span>
              <span className="text-base font-bold text-[#109A58] tabular-nums">
                {formatRupiah(selectedPurchase.total_cost)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
