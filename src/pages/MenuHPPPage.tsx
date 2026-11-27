import React, { useEffect, useMemo, useState } from 'react';
import {
  Calculator,
  CheckCircle2,
  Lock,
  Pencil,
  Plus,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { AccessDenied } from '../components/common/AccessDenied';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { PeriodicExcelExport } from '../components/common/PeriodicExcelExport';
import { ProductVisual } from '../components/common/ProductVisual';
import { MenuFormModal } from '../components/menu/MenuFormModal';
import { OwnerPricingAdvisor } from '../components/menu/OwnerPricingAdvisor';
import { useAuth } from '../context/AuthContext';
import { useStore, type MenuItemInput } from '../context/StoreContext';
import type { MenuItem } from '../types';
import { buildMenuHppExcelData } from '../utils/excelExport';
import { formatPercent, formatRupiah } from '../utils/format';
import { calculateMenuHpp } from '../utils/posCalculations';

interface MenuHPPPageProps {
  searchQuery: string;
}

export function MenuHPPPage({ searchQuery }: MenuHPPPageProps) {
  const { user, authMode, canSeeHPP } = useAuth();
  const {
    categories,
    menus,
    inventory,
    orders,
    settings,
    addMenuItem,
    updateMenuItem,
    deleteMenuItem,
    toggleMenuAvailability,
    updateMenuRecipes,
  } = useStore();
  const liveSupabaseEnabled = authMode === 'supabase';

  // Strict double-check: HPP module is strictly restricted to role === 'owner'
  const isOwnerHppAuthorized = user?.role === 'owner' && canSeeHPP;

  const [activeTab, setActiveTab] = useState<'menus' | 'hpp'>('menus');
  const [menuModalOpen, setMenuModalOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<MenuItem | null>(null);
  const [deletingMenu, setDeletingMenu] = useState<MenuItem | null>(null);
  const [pendingMenuEdit, setPendingMenuEdit] = useState<{
    id: string;
    data: MenuItemInput;
  } | null>(null);
  const [confirmMenuBusy, setConfirmMenuBusy] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const consumableInventory = useMemo(
    () =>
      inventory.filter(
        (item) => item.category_type === 'raw_material' || item.category_type === 'packaging'
      ),
    [inventory]
  );

  // Owner HPP Calculator state
  const [selectedMenuId, setSelectedMenuId] = useState<string>(menus[0]?.id ?? '');
  const [newIngredientId, setNewIngredientId] = useState<string>(
    consumableInventory[0]?.id ?? ''
  );
  const [newIngredientQty, setNewIngredientQty] = useState<string>('');
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [hppSellingPriceInput, setHppSellingPriceInput] = useState<string>('');
  const [savingTabPrice, setSavingTabPrice] = useState(false);

  useEffect(() => {
    if (
      consumableInventory.length > 0 &&
      !consumableInventory.some((inv) => inv.id === newIngredientId)
    ) {
      setNewIngredientId(consumableInventory[0].id);
    }
  }, [consumableInventory, newIngredientId]);

  const effectiveTab = isOwnerHppAuthorized ? activeTab : 'menus';

  const filteredMenus = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return menus;
    return menus.filter(
      (m) => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q)
    );
  }, [menus, searchQuery]);

  const categoryNameMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories]
  );

  const selectedMenu: MenuItem | undefined =
    menus.find((m) => m.id === selectedMenuId) ?? menus[0];

  useEffect(() => {
    if (selectedMenu) {
      setHppSellingPriceInput(String(selectedMenu.selling_price));
    }
  }, [selectedMenu?.id, selectedMenu?.selling_price]);

  const selectedHpp = useMemo(() => {
    if (!selectedMenu || !isOwnerHppAuthorized) return null;
    return calculateMenuHpp(selectedMenu.selling_price, selectedMenu.recipes, inventory);
  }, [selectedMenu, isOwnerHppAuthorized, inventory]);

  const handleApplyHppSellingPrice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMenu || !isOwnerHppAuthorized) return;
    if (!selectedHpp || selectedHpp.totalHpp <= 0) {
      setRecipeError('Isi komposisi resep HPP terlebih dahulu sebelum menetapkan harga jual.');
      return;
    }
    const nextPrice = Number(hppSellingPriceInput);
    if (!nextPrice || nextPrice <= 0) {
      setRecipeError('Harga jual harus berupa angka lebih dari 0.');
      return;
    }
    setSavingTabPrice(true);
    await updateMenuItem(selectedMenu.id, {
      selling_price: nextPrice,
      enableSupabaseSync: liveSupabaseEnabled,
    });
    setSavingTabPrice(false);
    setRecipeError(null);
    showFeedback(
      `Harga jual "${selectedMenu.name}" diperbarui menjadi ${formatRupiah(nextPrice)}.`
    );
  };

  const showFeedback = (msg: string) => {
    setFeedbackBanner(msg);
    window.setTimeout(() => setFeedbackBanner(null), 5000);
  };

  const handleSaveMenu = async (data: MenuItemInput, editingId: string | null) => {
    if (editingId) {
      setPendingMenuEdit({ id: editingId, data });
      return;
    }
    const created = await addMenuItem({
      ...data,
      enableSupabaseSync: liveSupabaseEnabled,
    });
    setSelectedMenuId(created.id);
    showFeedback(`Menu "${created.name}" ditambahkan ke katalog POS.`);
  };

  const handleConfirmDeleteMenu = async () => {
    if (!deletingMenu) return;
    const deletedName = deletingMenu.name;
    await deleteMenuItem(deletingMenu.id, liveSupabaseEnabled);
    setDeletingMenu(null);
    showFeedback(`Menu "${deletedName}" dihapus dari katalog.`);
  };

  const handleAddRecipeIngredient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMenu || !isOwnerHppAuthorized) return;
    const qty = Number(newIngredientQty);
    if (!newIngredientId || !qty || qty <= 0) {
      setRecipeError('Pilih bahan baku dan masukkan takaran lebih dari 0.');
      return;
    }

    const existing = selectedMenu.recipes.find((r) => r.inventory_item_id === newIngredientId);
    const updatedRecipes = existing
      ? selectedMenu.recipes.map((r) =>
          r.inventory_item_id === newIngredientId ? { ...r, quantity_needed: qty } : r
        )
      : [
          ...selectedMenu.recipes,
          {
            id: `rec-${Date.now()}`,
            menu_id: selectedMenu.id,
            inventory_item_id: newIngredientId,
            quantity_needed: qty,
          },
        ];

    await updateMenuRecipes(selectedMenu.id, updatedRecipes, liveSupabaseEnabled);
    setNewIngredientQty('');
    setRecipeError(null);
    showFeedback(`Komposisi resep "${selectedMenu.name}" & kalkulasi HPP diperbarui.`);
  };

  const handleUpdateRecipeQty = async (recipeId: string, nextQtyRaw: string) => {
    if (!selectedMenu || !isOwnerHppAuthorized) return;
    const qty = Number(nextQtyRaw);
    if (Number.isNaN(qty) || qty <= 0) return;
    const updatedRecipes = selectedMenu.recipes.map((r) =>
      r.id === recipeId ? { ...r, quantity_needed: qty } : r
    );
    await updateMenuRecipes(selectedMenu.id, updatedRecipes, liveSupabaseEnabled);
  };

  const handleRemoveRecipeIngredient = async (recipeId: string) => {
    if (!selectedMenu || !isOwnerHppAuthorized) return;
    await updateMenuRecipes(
      selectedMenu.id,
      selectedMenu.recipes.filter((r) => r.id !== recipeId),
      liveSupabaseEnabled
    );
  };

  const selectedIngredientMeta = consumableInventory.find((i) => i.id === newIngredientId);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#1A2E26]">
            {isOwnerHppAuthorized ? 'Manajemen Menu & Kalkulator HPP' : 'Manajemen Menu'}
          </h1>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            {isOwnerHppAuthorized
              ? 'Kelola daftar menu, foto produk, resep bahan baku (BOM), food cost %, dan profit bersih per cup.'
              : 'Kelola daftar menu, harga jual, foto produk, dan ketersediaan di layar kasir.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isOwnerHppAuthorized && (
            <div
              role="tablist"
              aria-label="Tab Menu dan HPP"
              className="inline-flex rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={effectiveTab === 'menus'}
                onClick={() => setActiveTab('menus')}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  effectiveTab === 'menus'
                    ? 'bg-[#E6F5EE] text-[#109A58]'
                    : 'text-[#6B7280] hover:text-[#1A2E26]'
                }`}
              >
                <UtensilsCrossed className="h-3.5 w-3.5" />
                <span>Daftar Menu</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={effectiveTab === 'hpp'}
                onClick={() => setActiveTab('hpp')}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  effectiveTab === 'hpp'
                    ? 'bg-[#E6F5EE] text-[#109A58]'
                    : 'text-[#6B7280] hover:text-[#1A2E26]'
                }`}
              >
                <Calculator className="h-3.5 w-3.5" />
                <span>Resep &amp; Kalkulasi HPP</span>
              </button>
            </div>
          )}

          <PeriodicExcelExport
            moduleTitle={isOwnerHppAuthorized ? 'Menu & HPP' : 'Daftar Menu'}
            description={
              isOwnerHppAuthorized
                ? 'Tarik katalog menu, performa penjualan per periode, HPP, margin, dan resep BOM.'
                : 'Tarik daftar menu, harga jual, dan ringkasan penjualan menu per periode.'
            }
            testId="export-menu-hpp-excel"
            buildExport={({ startDate, endDate }) =>
              buildMenuHppExcelData({
                menus,
                categories,
                inventory,
                orders,
                startDate,
                endDate,
                includeHpp: isOwnerHppAuthorized,
                shopName: settings.shopName,
              })
            }
          />

          {effectiveTab === 'menus' && (
            <button
              type="button"
              onClick={() => {
                setEditingMenu(null);
                setMenuModalOpen(true);
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#109A58] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E] whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              <span>Tambah Menu</span>
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
            aria-label="Tutup notifikasi menu"
            className="text-[#109A58] hover:text-[#0D8A4E]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* TAB 1: Menu Catalog Table */}
      {effectiveTab === 'menus' && (
        <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F4F6F5]/60 text-xs font-semibold text-[#6B7280]">
                  <th className="px-5 py-3.5">Menu</th>
                  <th className="px-5 py-3.5">Kategori</th>
                  <th className="px-5 py-3.5 text-right">Harga Jual</th>
                  {isOwnerHppAuthorized && <th className="px-5 py-3.5 text-right">Modal HPP</th>}
                  {isOwnerHppAuthorized && <th className="px-5 py-3.5 text-right">Food Cost</th>}
                  {isOwnerHppAuthorized && (
                    <th className="px-5 py-3.5 text-right">Profit / Cup</th>
                  )}
                  <th className="px-5 py-3.5 text-center">Status POS</th>
                  <th className="px-5 py-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filteredMenus.map((menu) => {
                  const hpp = isOwnerHppAuthorized
                    ? calculateMenuHpp(menu.selling_price, menu.recipes, inventory)
                    : null;
                  return (
                    <tr key={menu.id} className="hover:bg-[#F4F6F5]/50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <ProductVisual
                            tone={menu.visual_tone}
                            name={menu.name}
                            imageUrl={menu.image_url}
                            size="sm"
                          />
                          <div>
                            <p className="text-xs font-semibold text-[#1A2E26]">{menu.name}</p>
                            <p className="max-w-xs truncate text-[11px] text-[#6B7280]">
                              {menu.description}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs text-[#6B7280]">
                        {categoryNameMap.get(menu.category_id) ?? 'Lainnya'}
                      </td>
                      <td className="px-5 py-3 text-right text-xs font-semibold text-[#1A2E26] tabular-nums">
                        {formatRupiah(menu.selling_price)}
                      </td>
                      {isOwnerHppAuthorized && hpp && (
                        <>
                          <td className="px-5 py-3 text-right text-xs font-medium text-[#6B7280] tabular-nums">
                            {formatRupiah(hpp.totalHpp)}
                          </td>
                          <td className="px-5 py-3 text-right text-xs font-semibold tabular-nums">
                            <span
                              className={
                                hpp.foodCostPercent > 35
                                  ? 'text-[#EF4444]'
                                  : hpp.foodCostPercent > 30
                                    ? 'text-[#D97706]'
                                    : 'text-[#109A58]'
                              }
                            >
                              {formatPercent(hpp.foodCostPercent)}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right text-xs font-bold text-[#109A58] tabular-nums">
                            {formatRupiah(hpp.grossProfit)}
                          </td>
                        </>
                      )}
                      <td className="px-5 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => toggleMenuAvailability(menu.id, liveSupabaseEnabled)}
                          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                            menu.is_available
                              ? 'bg-[#E6F5EE] text-[#109A58] hover:bg-[#D5EFE2]'
                              : 'bg-[#F4F6F5] text-[#6B7280] hover:bg-[#E5E7EB]'
                          }`}
                        >
                          {menu.is_available ? 'Aktif' : 'Nonaktif'}
                        </button>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          {isOwnerHppAuthorized && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedMenuId(menu.id);
                                setActiveTab('hpp');
                              }}
                              aria-label={`Atur resep HPP ${menu.name}`}
                              title="Atur Resep & HPP"
                              className="rounded-lg p-1.5 text-[#6B7280] transition-colors hover:bg-[#E6F5EE] hover:text-[#109A58]"
                            >
                              <Calculator className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMenu(menu);
                              setMenuModalOpen(true);
                            }}
                            aria-label={`Edit menu ${menu.name}`}
                            className="rounded-lg p-1.5 text-[#6B7280] transition-colors hover:bg-[#E6F5EE] hover:text-[#109A58]"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingMenu(menu)}
                            aria-label={`Hapus menu ${menu.name}`}
                            className="rounded-lg p-1.5 text-[#6B7280] transition-colors hover:bg-[#FEF2F2] hover:text-[#EF4444]"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Strictly Owner-Only Recipe & HPP Calculator */}
      {effectiveTab === 'hpp' &&
        (!isOwnerHppAuthorized ? (
          <AccessDenied
            title="Akses Kalkulator HPP Terbatas"
            description="Panel Resep & Kalkulasi HPP hanya dapat diakses oleh akun dengan role Owner."
            onNavigateBack={() => setActiveTab('menus')}
          />
        ) : (
          selectedMenu &&
          selectedHpp && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              {/* Left Selector List */}
              <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4 lg:col-span-4">
                <div className="flex items-center justify-between pb-3">
                  <h2 className="text-sm font-semibold text-[#1A2E26]">Pilih Menu</h2>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#109A58]">
                    <Lock className="h-3 w-3" />
                    Khusus Owner
                  </span>
                </div>
                <div className="max-h-[460px] space-y-1 overflow-y-auto pb-2 pr-1">
                  {menus.map((menu) => {
                    const active = menu.id === selectedMenu.id;
                    const menuHpp = calculateMenuHpp(menu.selling_price, menu.recipes, inventory);
                    return (
                      <button
                        key={menu.id}
                        type="button"
                        onClick={() => setSelectedMenuId(menu.id)}
                        className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs transition-colors ${
                          active
                            ? 'bg-[#E6F5EE] text-[#109A58]'
                            : 'text-[#1A2E26] hover:bg-[#F4F6F5]'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <p className="truncate font-semibold">{menu.name}</p>
                          <p className="text-[11px] opacity-75 tabular-nums">
                            {menu.recipes.length} bahan · FC {formatPercent(menuHpp.foodCostPercent)}
                          </p>
                        </div>
                        <span className="shrink-0 font-bold tabular-nums">
                          {formatRupiah(menu.selling_price)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right BOM Recipe & Cost Breakdown */}
              <div className="space-y-4 lg:col-span-8">
                {/* HPP Summary Row */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
                    <p className="text-xs text-[#6B7280]">Harga Jual</p>
                    <p
                      data-testid="hpp-selling-price"
                      className="mt-1 text-lg font-bold text-[#1A2E26] tabular-nums"
                    >
                      {formatRupiah(selectedMenu.selling_price)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
                    <p className="text-xs text-[#6B7280]">Total HPP</p>
                    <p
                      data-testid="hpp-total-cost"
                      className="mt-1 text-lg font-bold text-[#1A2E26] tabular-nums"
                    >
                      {formatRupiah(selectedHpp.totalHpp)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
                    <p className="text-xs text-[#6B7280]">Food Cost %</p>
                    <p
                      data-testid="hpp-food-cost"
                      className={`mt-1 text-lg font-bold tabular-nums ${
                        selectedHpp.foodCostPercent > 35
                          ? 'text-[#EF4444]'
                          : selectedHpp.foodCostPercent > 30
                            ? 'text-[#D97706]'
                            : 'text-[#109A58]'
                      }`}
                    >
                      {formatPercent(selectedHpp.foodCostPercent)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
                    <p className="text-xs text-[#6B7280]">Profit Bersih / Cup</p>
                    <p
                      data-testid="hpp-net-profit"
                      className="mt-1 text-lg font-bold text-[#109A58] tabular-nums"
                    >
                      {formatRupiah(selectedHpp.grossProfit)}
                    </p>
                  </div>
                </div>

                {/* Recipe Ingredients Card */}
                <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-[#1A2E26]">
                        Komposisi Resep (BOM) — {selectedMenu.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-[#6B7280]">
                        Biaya per bahan otomatis mengikuti{' '}
                        <code className="font-mono text-[11px]">last_purchase_price</code> terbaru
                        dari Inventori &amp; Pembelian.
                      </p>
                    </div>
                    <span className="rounded-full bg-[#E6F5EE] px-3 py-1 text-xs font-semibold text-[#109A58] tabular-nums">
                      Margin {formatPercent(selectedHpp.marginPercent)}
                    </span>
                  </div>

                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#E5E7EB] text-[#6B7280]">
                          <th className="py-2.5 pr-3">Bahan Baku / Kemasan</th>
                          <th className="px-2 py-2.5 text-right whitespace-nowrap">Takaran / Porsi</th>
                          <th className="px-2 py-2.5 text-right whitespace-nowrap">Harga Beli / Unit</th>
                          <th className="px-3 py-2.5 text-right whitespace-nowrap">Subtotal HPP</th>
                          <th className="py-2.5 pl-2 text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5E7EB]">
                        {selectedMenu.recipes.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-[#6B7280]">
                              Belum ada bahan resep untuk menu ini. Tambahkan bahan baku di bawah.
                            </td>
                          </tr>
                        ) : (
                          selectedMenu.recipes.map((recipe) => {
                            const inv = inventory.find(
                              (i) => i.id === recipe.inventory_item_id
                            );
                            if (!inv) return null;
                            const lineCost = Math.round(
                              inv.last_purchase_price * recipe.quantity_needed
                            );
                            return (
                              <tr key={recipe.id}>
                                <td className="py-3 pr-3 font-medium text-[#1A2E26]">
                                  {inv.name}
                                  <span className="ml-1.5 font-mono text-[10px] text-[#6B7280]">
                                    ({inv.sku})
                                  </span>
                                </td>
                                <td className="px-2 py-3 text-right">
                                  <div className="inline-flex items-center justify-end gap-1.5">
                                    <input
                                      type="number"
                                      min={0.1}
                                      step="any"
                                      value={recipe.quantity_needed}
                                      aria-label={`Takaran ${inv.name} untuk ${selectedMenu.name}`}
                                      onChange={(e) =>
                                        handleUpdateRecipeQty(recipe.id, e.target.value)
                                      }
                                      className="h-7 w-20 rounded-lg border border-[#E5E7EB] px-2 text-right text-xs font-semibold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                                    />
                                    <span className="w-8 text-left text-[#6B7280]">{inv.unit}</span>
                                  </div>
                                </td>
                                <td className="px-2 py-3 text-right text-[#6B7280] tabular-nums whitespace-nowrap">
                                  {formatRupiah(inv.last_purchase_price)} / {inv.unit}
                                </td>
                                <td className="px-3 py-3 text-right font-semibold text-[#1A2E26] tabular-nums whitespace-nowrap">
                                  {formatRupiah(lineCost)}
                                </td>
                                <td className="py-3 pl-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveRecipeIngredient(recipe.id)}
                                    aria-label={`Hapus ${inv.name} dari resep`}
                                    className="rounded-lg p-1 text-[#6B7280] hover:bg-[#FEF2F2] hover:text-[#EF4444]"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Add Ingredient to Recipe */}
                  <form
                    onSubmit={handleAddRecipeIngredient}
                    className="mt-4 space-y-2 border-t border-[#E5E7EB] pt-4"
                  >
                    {recipeError && (
                      <p className="text-xs font-medium text-[#EF4444]">{recipeError}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-2.5">
                      <select
                        value={newIngredientId}
                        onChange={(e) => setNewIngredientId(e.target.value)}
                        aria-label="Pilih bahan baku dari inventori"
                        className="h-9 min-w-[220px] flex-1 rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                      >
                        {consumableInventory.map((inv) => (
                          <option key={inv.id} value={inv.id}>
                            {inv.name} ({inv.unit} · {formatRupiah(inv.last_purchase_price)}/
                            {inv.unit})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0.1}
                        step="any"
                        value={newIngredientQty}
                        onChange={(e) => setNewIngredientQty(e.target.value)}
                        placeholder={`Takaran (${selectedIngredientMeta?.unit ?? 'unit'})`}
                        aria-label="Takaran bahan per porsi"
                        className="h-9 w-36 rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                      />
                      <button
                        type="submit"
                        className="h-9 rounded-full bg-[#109A58] px-4 text-xs font-semibold text-white hover:bg-[#0D8A4E] whitespace-nowrap"
                      >
                        + Tambah Bahan
                      </button>
                    </div>
                  </form>
                </div>

                {/* Owner Pricing Suggestions & Selling Price Determination (AFTER HPP Calculation) */}
                <div
                  data-testid="hpp-tab-pricing-card"
                  className="rounded-2xl border border-[#109A58]/25 bg-[#FFFFFF] p-5 space-y-4"
                >
                  <div>
                    <h3 className="text-sm font-semibold text-[#1A2E26]">
                      Penentuan &amp; Saran Harga Jual — {selectedMenu.name}
                    </h3>
                    <p className="mt-0.5 text-xs text-[#6B7280]">
                      Tetapkan harga jual setelah komposisi HPP di atas selesai diisi. Rekomendasi
                      harga otomatis dihitung dari total modal HPP saat ini.
                    </p>
                  </div>

                  <OwnerPricingAdvisor
                    totalHpp={selectedHpp.totalHpp}
                    currentSellingPrice={Number(hppSellingPriceInput) || 0}
                    onSelectSuggestedPrice={(suggested) => {
                      setHppSellingPriceInput(String(suggested));
                      setRecipeError(null);
                    }}
                    testIdPrefix="hpp-tab-pricing"
                  />

                  <form
                    onSubmit={handleApplyHppSellingPrice}
                    className="flex flex-wrap items-end gap-3 border-t border-[#E5E7EB] pt-4"
                  >
                    <div className="min-w-[200px] flex-1">
                      <label
                        htmlFor="hpp-tab-selling-price"
                        className="block text-xs font-semibold text-[#1A2E26]"
                      >
                        Harga Jual Menu (Rp)
                      </label>
                      <input
                        id="hpp-tab-selling-price"
                        type="number"
                        min={500}
                        step={500}
                        disabled={selectedHpp.totalHpp <= 0}
                        value={hppSellingPriceInput}
                        onChange={(e) => setHppSellingPriceInput(e.target.value)}
                        placeholder={
                          selectedHpp.totalHpp > 0
                            ? 'Pilih saran di atas atau masukkan harga jual'
                            : 'Tambahkan bahan HPP terlebih dahulu'
                        }
                        className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-sm font-bold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none disabled:cursor-not-allowed disabled:bg-[#F4F6F5] disabled:text-[#9CA3AF]"
                      />
                    </div>
                    <button
                      type="submit"
                      data-testid="hpp-tab-apply-price"
                      disabled={
                        savingTabPrice ||
                        selectedHpp.totalHpp <= 0 ||
                        Number(hppSellingPriceInput) <= 0 ||
                        Number(hppSellingPriceInput) === selectedMenu.selling_price
                      }
                      className="h-10 rounded-full bg-[#109A58] px-5 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                    >
                      {savingTabPrice ? 'Menyimpan...' : 'Terapkan Harga Jual'}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )
        ))}

      {/* Add / Edit Menu Modal */}
      <MenuFormModal
        isOpen={menuModalOpen}
        categories={categories}
        editingMenu={editingMenu}
        inventory={inventory}
        showHppWorkflow={isOwnerHppAuthorized}
        onClose={() => {
          setMenuModalOpen(false);
          setEditingMenu(null);
        }}
        onSubmit={handleSaveMenu}
      />

      {/* Confirm Delete Menu Dialog */}
      <ConfirmDialog
        open={Boolean(deletingMenu)}
        variant="danger"
        title="Hapus Menu?"
        description={
          deletingMenu && (
            <span>
              Menu <strong className="text-[#1A2E26]">{deletingMenu.name}</strong> akan dihapus
              permanen dari katalog POS dan daftar resep.
            </span>
          )
        }
        confirmLabel="Ya, Hapus Menu"
        cancelLabel="Batal"
        onCancel={() => setDeletingMenu(null)}
        onConfirm={handleConfirmDeleteMenu}
      />

      {/* Confirm Edit Menu Dialog */}
      <ConfirmDialog
        open={Boolean(pendingMenuEdit)}
        variant="warning"
        title="Konfirmasi Perubahan Data Menu"
        description={
          pendingMenuEdit && (
            <span>
              Simpan perubahan pada menu{' '}
              <strong className="text-[#1A2E26]">{pendingMenuEdit.data.name}</strong> dengan harga
              jual <strong>{formatRupiah(pendingMenuEdit.data.selling_price)}</strong>?
            </span>
          )
        }
        confirmLabel="Ya, Simpan Perubahan"
        cancelLabel="Batal"
        isBusy={confirmMenuBusy}
        onCancel={() => setPendingMenuEdit(null)}
        onConfirm={async () => {
          if (!pendingMenuEdit) return;
          setConfirmMenuBusy(true);
          try {
            await updateMenuItem(pendingMenuEdit.id, {
              ...pendingMenuEdit.data,
              enableSupabaseSync: liveSupabaseEnabled,
            });
            showFeedback(`Menu "${pendingMenuEdit.data.name}" berhasil diperbarui.`);
            setPendingMenuEdit(null);
          } finally {
            setConfirmMenuBusy(false);
          }
        }}
      />
    </div>
  );
}
