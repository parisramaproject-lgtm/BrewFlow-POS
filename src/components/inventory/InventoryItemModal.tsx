import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { InventoryItemInput } from '../../context/StoreContext';
import type {
  AssetCondition,
  ExpenseCategoryId,
  InventoryItem,
  ItemCategoryType,
} from '../../types';
import {
  EXPENSE_CATEGORIES,
  getDefaultExpenseCategoryForInventory,
  getInventoryTypeForExpenseCategory,
} from '../../utils/expenseCategories';

interface InventoryItemModalProps {
  isOpen: boolean;
  defaultCategory: ItemCategoryType;
  editingItem: InventoryItem | null;
  onClose: () => void;
  onSubmit: (data: InventoryItemInput, editingId: string | null) => Promise<void>;
}

const INVENTORY_GROUP_OPTIONS: Array<{ value: ItemCategoryType; label: string }> = [
  { value: 'raw_material', label: 'Bahan Baku (Raw Materials)' },
  { value: 'packaging', label: 'Kemasan (Packaging)' },
  { value: 'asset', label: 'Aset Coffee Shop (Assets)' },
  { value: 'operational', label: 'Operasional & Biaya Lainnya' },
];

const UNIT_SUGGESTIONS: Record<ItemCategoryType, string[]> = {
  raw_material: ['gr', 'ml', 'kg', 'liter', 'pcs', 'botol'],
  packaging: ['pcs', 'pack', 'box', 'roll'],
  asset: ['unit', 'set', 'pcs'],
  operational: ['pcs', 'botol', 'tabung', 'paket', 'bulan', 'unit'],
};

export function InventoryItemModal({
  isOpen,
  defaultCategory,
  editingItem,
  onClose,
  onSubmit,
}: InventoryItemModalProps) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [categoryType, setCategoryType] = useState<ItemCategoryType>(defaultCategory);
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategoryId>(
    getDefaultExpenseCategoryForInventory(defaultCategory)
  );
  const [unit, setUnit] = useState('gr');
  const [currentStock, setCurrentStock] = useState('');
  const [minThreshold, setMinThreshold] = useState('');
  const [lastPurchasePrice, setLastPurchasePrice] = useState('');
  const [assetCondition, setAssetCondition] = useState<AssetCondition>('Baik');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (editingItem) {
      setName(editingItem.name);
      setSku(editingItem.sku);
      setCategoryType(editingItem.category_type);
      setExpenseCategory(
        editingItem.expense_category ??
          getDefaultExpenseCategoryForInventory(editingItem.category_type)
      );
      setUnit(editingItem.unit);
      setCurrentStock(String(editingItem.current_stock));
      setMinThreshold(String(editingItem.min_stock_threshold));
      setLastPurchasePrice(String(editingItem.last_purchase_price));
      setAssetCondition(editingItem.asset_condition ?? 'Baik');
    } else {
      setName('');
      setSku('');
      setCategoryType(defaultCategory);
      setExpenseCategory(getDefaultExpenseCategoryForInventory(defaultCategory));
      setUnit(
        defaultCategory === 'raw_material'
          ? 'gr'
          : defaultCategory === 'packaging'
            ? 'pcs'
            : defaultCategory === 'asset'
              ? 'unit'
              : 'pcs'
      );
      setCurrentStock('');
      setMinThreshold(defaultCategory === 'asset' ? '0' : '');
      setLastPurchasePrice('');
      setAssetCondition('Baik');
    }
    setErrorMsg(null);
  }, [isOpen, editingItem, defaultCategory]);

  if (!isOpen) return null;

  const isAsset = categoryType === 'asset';

  const handleExpenseCategoryChange = (nextExpenseCat: ExpenseCategoryId) => {
    setExpenseCategory(nextExpenseCat);
    const mappedType = getInventoryTypeForExpenseCategory(nextExpenseCat);
    setCategoryType(mappedType);
    if (!editingItem) {
      setUnit(
        mappedType === 'raw_material'
          ? 'gr'
          : mappedType === 'packaging'
            ? 'pcs'
            : mappedType === 'asset'
              ? 'unit'
              : 'pcs'
      );
      if (mappedType === 'asset') {
        setMinThreshold('0');
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const stockNum = Number(currentStock);
    const minNum = isAsset ? 0 : Number(minThreshold);
    const priceNum = Number(lastPurchasePrice);

    if (!name.trim()) {
      setErrorMsg('Nama item wajib diisi.');
      return;
    }
    if (!unit.trim()) {
      setErrorMsg('Satuan (unit) wajib diisi.');
      return;
    }
    if (currentStock === '' || Number.isNaN(stockNum) || stockNum < 0) {
      setErrorMsg('Jumlah stok saat ini harus berupa angka >= 0.');
      return;
    }
    if (!isAsset && (minThreshold === '' || Number.isNaN(minNum) || minNum < 0)) {
      setErrorMsg('Batas minimum stok harus berupa angka >= 0.');
      return;
    }
    if (lastPurchasePrice === '' || Number.isNaN(priceNum) || priceNum < 0) {
      setErrorMsg('Harga beli / nilai satuan harus berupa angka >= 0.');
      return;
    }

    setSubmitting(true);
    await onSubmit(
      {
        name,
        sku,
        category_type: categoryType,
        expense_category: expenseCategory,
        unit,
        current_stock: stockNum,
        min_stock_threshold: minNum,
        last_purchase_price: priceNum,
        asset_condition: isAsset ? assetCondition : undefined,
      },
      editingItem?.id ?? null
    );
    setSubmitting(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={editingItem ? 'Edit Item Inventori' : 'Tambah Item Inventori'}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#1A2E26]">
              {editingItem ? `Edit Item: ${editingItem.name}` : 'Tambah Item Inventori Baru'}
            </h2>
            <p className="mt-0.5 text-xs text-[#6B7280]">
              Perubahan langsung tersinkronisasi ke Kalkulator HPP, Resep Menu, dan Pembelian.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup form inventori"
            className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#F4F6F5] hover:text-[#1A2E26]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[82vh] overflow-y-auto space-y-4 p-6">
          {errorMsg && (
            <div
              role="alert"
              className="rounded-xl border border-[#EF4444]/30 bg-[#FEF2F2] px-3.5 py-2.5 text-xs font-medium text-[#EF4444]"
            >
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="inv-name" className="block text-xs font-semibold text-[#1A2E26]">
                Nama Item *
              </label>
              <input
                id="inv-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  isAsset
                    ? 'Misal: Blender Commercial Vitamix'
                    : categoryType === 'packaging'
                      ? 'Misal: Paper Bag Craft Medium'
                      : categoryType === 'operational'
                        ? 'Misal: Gas LPG 12kg / Sabun Cuci Bar / Filter Air'
                        : 'Misal: Sirup Karamel Premium'
                }
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label
                htmlFor="inv-expense-category"
                className="block text-xs font-semibold text-[#1A2E26]"
              >
                Kategori Pengeluaran / Akun Biaya *
              </label>
              <select
                id="inv-expense-category"
                value={expenseCategory}
                onChange={(e) => handleExpenseCategoryChange(e.target.value as ExpenseCategoryId)}
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              >
                {EXPENSE_CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="inv-category" className="block text-xs font-semibold text-[#1A2E26]">
                Grup Tab Inventori *
              </label>
              <select
                id="inv-category"
                value={categoryType}
                onChange={(e) => {
                  const nextCat = e.target.value as ItemCategoryType;
                  setCategoryType(nextCat);
                  if (!editingItem) {
                    setUnit(
                      nextCat === 'raw_material'
                        ? 'gr'
                        : nextCat === 'packaging'
                          ? 'pcs'
                          : nextCat === 'asset'
                            ? 'unit'
                            : 'pcs'
                    );
                  }
                }}
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              >
                {INVENTORY_GROUP_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="inv-sku" className="block text-xs font-semibold text-[#1A2E26]">
                Kode SKU (Opsional)
              </label>
              <input
                id="inv-sku"
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Otomatis jika kosong (cth: RM-009)"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 font-mono text-xs uppercase text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="inv-unit" className="block text-xs font-semibold text-[#1A2E26]">
                Satuan (Unit) *
              </label>
              <input
                id="inv-unit"
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="gr / ml / pcs / unit"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {UNIT_SUGGESTIONS[categoryType].map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUnit(u)}
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                      unit === u
                        ? 'bg-[#E6F5EE] text-[#109A58]'
                        : 'bg-[#F4F6F5] text-[#6B7280] hover:text-[#1A2E26]'
                    }`}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="inv-stock" className="block text-xs font-semibold text-[#1A2E26]">
                {isAsset ? 'Jumlah Unit Aset *' : 'Stok Saat Ini *'}
              </label>
              <input
                id="inv-stock"
                type="number"
                min={0}
                step="any"
                value={currentStock}
                onChange={(e) => setCurrentStock(e.target.value)}
                placeholder="0"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
              />
            </div>

            {!isAsset ? (
              <div>
                <label htmlFor="inv-min" className="block text-xs font-semibold text-[#1A2E26]">
                  Batas Minimum Alert *
                </label>
                <input
                  id="inv-min"
                  type="number"
                  min={0}
                  step="any"
                  value={minThreshold}
                  onChange={(e) => setMinThreshold(e.target.value)}
                  placeholder="Misal: 500"
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                />
              </div>
            ) : (
              <div>
                <label htmlFor="inv-condition" className="block text-xs font-semibold text-[#1A2E26]">
                  Kondisi Aset *
                </label>
                <select
                  id="inv-condition"
                  value={assetCondition}
                  onChange={(e) => setAssetCondition(e.target.value as AssetCondition)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                >
                  <option value="Baik">Baik</option>
                  <option value="Perlu Servis">Perlu Servis</option>
                  <option value="Rusak">Rusak</option>
                </select>
              </div>
            )}

            <div>
              <label htmlFor="inv-price" className="block text-xs font-semibold text-[#1A2E26]">
                {isAsset ? 'Nilai Perolehan / Unit (Rp) *' : `Harga Beli / ${unit || 'unit'} (Rp) *`}
              </label>
              <input
                id="inv-price"
                type="number"
                min={0}
                step="any"
                value={lastPurchasePrice}
                onChange={(e) => setLastPurchasePrice(e.target.value)}
                placeholder={isAsset ? 'Misal: 12500000' : 'Misal: 250'}
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 border-t border-[#E5E7EB] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-full border border-[#E5E7EB] px-5 text-xs font-semibold text-[#6B7280] hover:text-[#1A2E26]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-10 rounded-full bg-[#109A58] px-6 text-xs font-semibold text-white hover:bg-[#0D8A4E] disabled:opacity-50"
            >
              {submitting ? 'Menyimpan...' : editingItem ? 'Simpan Perubahan' : 'Tambah Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
