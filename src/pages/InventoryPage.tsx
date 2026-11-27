import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Package,
  Pencil,
  Plus,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { PeriodicExcelExport } from '../components/common/PeriodicExcelExport';
import { InventoryItemModal } from '../components/inventory/InventoryItemModal';
import { useAuth } from '../context/AuthContext';
import { useStore, type InventoryItemInput } from '../context/StoreContext';
import { getInventoryStockStatus } from '../services/operationsService';
import type { AssetCondition, InventoryItem, ItemCategoryType } from '../types';
import { buildInventoryExcelData } from '../utils/excelExport';
import {
  getDefaultExpenseCategoryForInventory,
  getExpenseCategoryLabel,
} from '../utils/expenseCategories';
import { formatDateTime, formatRupiah } from '../utils/format';

interface InventoryPageProps {
  searchQuery: string;
}

const TABS: Array<{ id: ItemCategoryType; label: string }> = [
  { id: 'raw_material', label: 'Bahan Baku' },
  { id: 'packaging', label: 'Kemasan' },
  { id: 'asset', label: 'Aset Coffee Shop' },
  { id: 'operational', label: 'Operasional & Lainnya' },
];

const ASSET_CONDITIONS: AssetCondition[] = ['Baik', 'Perlu Servis', 'Rusak'];

export function InventoryPage({ searchQuery }: InventoryPageProps) {
  const { authMode, canManageInventory } = useAuth();
  const {
    inventory,
    menus,
    purchases,
    opnameLogs,
    settings,
    addInventoryItem,
    updateInventoryItem,
    deleteInventoryItem,
    updateAssetCondition,
  } = useStore();
  const liveSupabaseEnabled = authMode === 'supabase';

  const [activeTab, setActiveTab] = useState<ItemCategoryType>('raw_material');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<InventoryItem | null>(null);
  const [pendingItemEdit, setPendingItemEdit] = useState<{
    id: string;
    data: InventoryItemInput;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [conditionModalAsset, setConditionModalAsset] = useState<InventoryItem | null>(null);
  const [nextCondition, setNextCondition] = useState<AssetCondition>('Baik');
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const showFeedback = (msg: string) => {
    setFeedbackBanner(msg);
    window.setTimeout(() => setFeedbackBanner(null), 5000);
  };

  const tabCounts = useMemo(() => {
    return {
      raw_material: inventory.filter((i) => i.category_type === 'raw_material').length,
      packaging: inventory.filter((i) => i.category_type === 'packaging').length,
      asset: inventory.filter((i) => i.category_type === 'asset').length,
      operational: inventory.filter((i) => i.category_type === 'operational').length,
    };
  }, [inventory]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return inventory.filter((item) => {
      if (item.category_type !== activeTab) return false;
      if (!q) return true;
      const expLabel = getExpenseCategoryLabel(
        item.expense_category ?? getDefaultExpenseCategoryForInventory(item.category_type)
      ).toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        expLabel.includes(q)
      );
    });
  }, [inventory, activeTab, searchQuery]);

  const categorySummary = useMemo(() => {
    const itemsInTab = inventory.filter((i) => i.category_type === activeTab);
    const totalValuation = itemsInTab.reduce(
      (sum, item) => sum + item.current_stock * item.last_purchase_price,
      0
    );
    const alertCount =
      activeTab === 'asset'
        ? itemsInTab.filter((i) => i.asset_condition && i.asset_condition !== 'Baik').length
        : itemsInTab.filter((i) => i.current_stock <= i.min_stock_threshold).length;
    return { totalItems: itemsInTab.length, totalValuation, alertCount };
  }, [inventory, activeTab]);

  const menusUsingDeletingItem = useMemo(() => {
    if (!deletingItem) return [];
    return menus.filter((m) =>
      m.recipes.some((r) => r.inventory_item_id === deletingItem.id)
    );
  }, [deletingItem, menus]);

  const handleOpenAdd = () => {
    setEditingItem(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setModalOpen(true);
  };

  const handleSaveItem = async (data: InventoryItemInput, editingId: string | null) => {
    if (editingId) {
      setPendingItemEdit({ id: editingId, data });
      return;
    }
    const created = await addInventoryItem({
      ...data,
      enableSupabaseSync: liveSupabaseEnabled,
    });
    setActiveTab(created.category_type);
    showFeedback(
      `Item "${created.name}" (${created.sku}) ditambahkan dan siap digunakan di resep HPP & pembelian.`
    );
  };

  const handleConfirmDelete = async () => {
    if (!deletingItem) return;
    const itemName = deletingItem.name;
    const { affectedMenuCount } = await deleteInventoryItem(
      deletingItem.id,
      liveSupabaseEnabled
    );
    setDeletingItem(null);
    showFeedback(
      affectedMenuCount > 0
        ? `Item "${itemName}" dihapus & dilepas dari ${affectedMenuCount} resep menu.`
        : `Item "${itemName}" berhasil dihapus dari inventori.`
    );
  };

  const handleOpenConditionModal = (asset: InventoryItem) => {
    setConditionModalAsset(asset);
    setNextCondition(asset.asset_condition ?? 'Baik');
  };

  const handleSaveAssetCondition = async () => {
    if (!conditionModalAsset) return;
    await updateAssetCondition(conditionModalAsset.id, nextCondition, liveSupabaseEnabled);
    showFeedback(`Kondisi aset "${conditionModalAsset.name}" diperbarui menjadi "${nextCondition}".`);
    setConditionModalAsset(null);
  };

  const renderConditionBadge = (condition: AssetCondition = 'Baik') => {
    if (condition === 'Rusak') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#FEF2F2] px-2.5 py-1 text-xs font-semibold text-[#EF4444]">
          <AlertTriangle className="h-3.5 w-3.5" />
          Rusak
        </span>
      );
    }
    if (condition === 'Perlu Servis') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-[#FFFBEB] px-2.5 py-1 text-xs font-semibold text-[#D97706]">
          <Wrench className="h-3.5 w-3.5" />
          Perlu Servis
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[#E6F5EE] px-2.5 py-1 text-xs font-semibold text-[#109A58]">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Baik
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#1A2E26]">Inventori Bahan Baku &amp; Aset</h1>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            Kelola stok bahan baku, kemasan, dan aset kedai. Perubahan otomatis tersinkron ke HPP,
            resep menu, dan modul pembelian.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <PeriodicExcelExport
            moduleTitle="Inventori"
            description="Tarik master stok, valuasi aset/bahan, serta riwayat mutasi pembelian & opname per periode."
            testId="export-inventory-excel"
            buildExport={({ startDate, endDate }) =>
              buildInventoryExcelData({
                inventory,
                purchases,
                opnameLogs,
                startDate,
                endDate,
                shopName: settings.shopName,
              })
            }
          />

          {canManageInventory && (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#109A58] px-5 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E] whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              <span>Tambah Item Inventori</span>
            </button>
          )}
        </div>
      </div>

      {feedbackBanner && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-[#109A58]/30 bg-[#E6F5EE] px-4 py-3 text-xs font-semibold text-[#109A58]"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {feedbackBanner}
          </span>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            aria-label="Tutup notifikasi inventori"
            className="text-[#109A58] hover:text-[#0D8A4E]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Category Tabs & Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div
          role="tablist"
          aria-label="Kategori Inventori"
          className="inline-flex flex-wrap rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] p-1"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-[#E6F5EE] text-[#109A58]'
                  : 'text-[#6B7280] hover:text-[#1A2E26]'
              }`}
            >
              {tab.label}{' '}
              <span className="ml-1 opacity-75 tabular-nums">({tabCounts[tab.id]})</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] px-3.5 py-2">
            <Boxes className="h-4 w-4 text-[#109A58]" />
            <span className="text-[#6B7280]">Estimasi Nilai:</span>
            <span className="font-bold text-[#1A2E26] tabular-nums">
              {formatRupiah(Math.round(categorySummary.totalValuation))}
            </span>
          </div>
          {categorySummary.alertCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-xl border border-[#EF4444]/30 bg-[#FEF2F2] px-3.5 py-2 font-semibold text-[#EF4444] tabular-nums">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>
                {categorySummary.alertCount}{' '}
                {activeTab === 'asset' ? 'aset butuh perhatian' : 'item perlu restock'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Inventory Table */}
      <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF]">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <Package className="h-9 w-9 text-[#6B7280]/50" />
            <p className="mt-3 text-sm font-semibold text-[#1A2E26]">Belum ada item di kategori ini</p>
            <p className="mt-1 text-xs text-[#6B7280]">
              Gunakan tombol &ldquo;Tambah Item Inventori&rdquo; untuk mulai mencatat stok.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F4F6F5]/60 text-xs font-semibold text-[#6B7280]">
                  <th className="px-5 py-3.5">SKU</th>
                  <th className="px-5 py-3.5">Nama Item</th>
                  <th className="px-5 py-3.5 text-right">
                    {activeTab === 'asset' ? 'Jumlah Unit' : 'Stok Saat Ini'}
                  </th>
                  {activeTab !== 'asset' && (
                    <th className="px-5 py-3.5 text-right">Batas Minimum</th>
                  )}
                  <th className="px-5 py-3.5 text-right">
                    {activeTab === 'asset' ? 'Nilai Aset / Unit' : 'Harga Beli Terakhir'}
                  </th>
                  <th className="px-5 py-3.5">
                    {activeTab === 'asset' ? 'Kondisi Aset' : 'Status Stok'}
                  </th>
                  <th className="px-5 py-3.5 text-right">Diperbarui</th>
                  {(canManageInventory || activeTab === 'asset') && (
                    <th className="px-5 py-3.5 text-right">Aksi</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filteredItems.map((item) => {
                  const status = getInventoryStockStatus(item);
                  return (
                    <tr key={item.id} className="hover:bg-[#F4F6F5]/50">
                      <td className="px-5 py-3.5 font-mono text-xs text-[#6B7280]">{item.sku}</td>
                      <td className="px-5 py-3.5 text-xs">
                        <p className="font-semibold text-[#1A2E26]">{item.name}</p>
                        <p className="mt-0.5 text-[11px] text-[#6B7280]">
                          {getExpenseCategoryLabel(
                            item.expense_category ??
                              getDefaultExpenseCategoryForInventory(item.category_type)
                          )}
                        </p>
                      </td>
                      <td className="px-5 py-3.5 text-right text-xs font-bold text-[#1A2E26] tabular-nums">
                        {item.current_stock} {item.unit}
                      </td>
                      {activeTab !== 'asset' && (
                        <td className="px-5 py-3.5 text-right text-xs text-[#6B7280] tabular-nums">
                          {item.min_stock_threshold} {item.unit}
                        </td>
                      )}
                      <td className="px-5 py-3.5 text-right text-xs text-[#1A2E26] tabular-nums">
                        {formatRupiah(item.last_purchase_price)}
                        {activeTab !== 'asset' && (
                          <span className="text-[#6B7280]"> / {item.unit}</span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-xs">
                        {activeTab === 'asset' ? (
                          renderConditionBadge(item.asset_condition)
                        ) : status === 'critical' ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FEF2F2] px-2.5 py-1 font-semibold text-[#EF4444]">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Stok Kritis
                          </span>
                        ) : status === 'low' ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFFBEB] px-2.5 py-1 font-semibold text-[#D97706]">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            Stok Menipis
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E6F5EE] px-2.5 py-1 font-semibold text-[#109A58]">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Aman
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right text-xs text-[#6B7280] tabular-nums">
                        {formatDateTime(item.updated_at)}
                      </td>
                      {(canManageInventory || activeTab === 'asset') && (
                        <td className="px-5 py-3.5 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {activeTab === 'asset' && (
                              <button
                                type="button"
                                onClick={() => handleOpenConditionModal(item)}
                                aria-label={`Update kondisi ${item.name}`}
                                className="rounded-full bg-[#E6F5EE] px-3 py-1 text-[11px] font-semibold text-[#109A58] transition-colors hover:bg-[#D5EFE2] whitespace-nowrap"
                              >
                                Update Kondisi
                              </button>
                            )}
                            {canManageInventory && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleOpenEdit(item)}
                                  aria-label={`Edit ${item.name}`}
                                  className="rounded-lg p-1.5 text-[#6B7280] transition-colors hover:bg-[#E6F5EE] hover:text-[#109A58]"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingItem(item)}
                                  aria-label={`Hapus ${item.name}`}
                                  className="rounded-lg p-1.5 text-[#6B7280] transition-colors hover:bg-[#FEF2F2] hover:text-[#EF4444]"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Item Modal (Owner & Manager) */}
      <InventoryItemModal
        isOpen={modalOpen}
        defaultCategory={activeTab}
        editingItem={editingItem}
        onClose={() => {
          setModalOpen(false);
          setEditingItem(null);
        }}
        onSubmit={handleSaveItem}
      />

      {/* Update Asset Condition Modal */}
      {conditionModalAsset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label={`Update Kondisi ${conditionModalAsset.name}`}
        >
          <div className="w-full max-w-sm rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#1A2E26]">Update Kondisi Aset</h2>
              <button
                type="button"
                onClick={() => setConditionModalAsset(null)}
                aria-label="Tutup modal kondisi aset"
                className="rounded-lg p-1 text-[#6B7280] hover:bg-[#F4F6F5]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-1 text-xs text-[#6B7280]">
              {conditionModalAsset.name} ({conditionModalAsset.sku})
            </p>

            <div className="mt-4 space-y-2">
              {ASSET_CONDITIONS.map((cond) => (
                <button
                  key={cond}
                  type="button"
                  onClick={() => setNextCondition(cond)}
                  className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition-colors ${
                    nextCondition === cond
                      ? 'border-[#109A58] bg-[#E6F5EE] text-[#109A58]'
                      : 'border-[#E5E7EB] bg-[#FFFFFF] text-[#1A2E26] hover:bg-[#F4F6F5]'
                  }`}
                >
                  <span>{cond}</span>
                  {renderConditionBadge(cond)}
                </button>
              ))}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConditionModalAsset(null)}
                className="h-9 rounded-full border border-[#E5E7EB] px-4 text-xs font-semibold text-[#6B7280]"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSaveAssetCondition}
                className="h-9 rounded-full bg-[#109A58] px-5 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
              >
                Simpan Kondisi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete & Edit Inventory Dialogs */}
      <ConfirmDialog
        open={Boolean(deletingItem)}
        variant="danger"
        title="Hapus Item Inventori?"
        description={
          deletingItem && (
            <div className="space-y-2.5">
              <p>
                Anda akan menghapus <strong className="text-[#1A2E26]">{deletingItem.name}</strong> (
                {deletingItem.sku}) secara permanen dari inventori.
              </p>
              {menusUsingDeletingItem.length > 0 && (
                <div className="rounded-xl border border-[#F59E0B]/40 bg-[#FFFBEB] p-3 text-xs text-[#92400E]">
                  Perhatian: Bahan ini sedang dipakai pada resep{' '}
                  <strong>{menusUsingDeletingItem.length} menu</strong> (
                  {menusUsingDeletingItem.map((m) => m.name).join(', ')}). Menghapus item ini akan
                  otomatis melepaskannya dari resep &amp; memperbarui perhitungan HPP.
                </div>
              )}
            </div>
          )
        }
        confirmLabel="Ya, Hapus Item"
        cancelLabel="Batal"
        onCancel={() => setDeletingItem(null)}
        onConfirm={handleConfirmDelete}
      />

      <ConfirmDialog
        open={Boolean(pendingItemEdit)}
        variant="warning"
        title="Konfirmasi Perubahan Item Inventori"
        description={
          pendingItemEdit && (
            <span>
              Simpan perubahan pada item{' '}
              <strong className="text-[#1A2E26]">{pendingItemEdit.data.name}</strong>? Kalkulasi
              HPP menu dan stok minimum akan otomatis menyesuaikan.
            </span>
          )
        }
        confirmLabel="Ya, Simpan Perubahan"
        cancelLabel="Batal"
        isBusy={confirmBusy}
        onCancel={() => setPendingItemEdit(null)}
        onConfirm={async () => {
          if (!pendingItemEdit) return;
          setConfirmBusy(true);
          try {
            await updateInventoryItem(pendingItemEdit.id, {
              ...pendingItemEdit.data,
              enableSupabaseSync: liveSupabaseEnabled,
            });
            showFeedback(
              `Item "${pendingItemEdit.data.name}" diperbarui. Kalkulasi HPP & daftar pembelian otomatis menyesuaikan.`
            );
            setPendingItemEdit(null);
          } finally {
            setConfirmBusy(false);
          }
        }}
      />
    </div>
  );
}
