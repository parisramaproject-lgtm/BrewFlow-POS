import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, ImagePlus, Lock, Plus, Trash2, X } from 'lucide-react';
import type { MenuItemInput } from '../../context/StoreContext';
import type { Category, InventoryItem, MenuItem, MenuRecipeItem } from '../../types';
import { formatPercent, formatRupiah } from '../../utils/format';
import { calculateMenuHpp } from '../../utils/posCalculations';
import { ProductVisual } from '../common/ProductVisual';
import { OwnerPricingAdvisor } from './OwnerPricingAdvisor';

interface MenuFormModalProps {
  isOpen: boolean;
  categories: Category[];
  editingMenu: MenuItem | null;
  inventory?: InventoryItem[];
  showHppWorkflow?: boolean;
  onClose: () => void;
  onSubmit: (data: MenuItemInput, editingId: string | null) => Promise<void>;
}

const CATEGORY_DEFAULT_TONES: Record<string, MenuItem['visual_tone']> = {
  'cat-coffee': 'latte',
  'cat-non-coffee': 'matcha',
  'cat-food': 'savory',
  'cat-snack': 'pastry',
};

export function MenuFormModal({
  isOpen,
  categories,
  editingMenu,
  inventory = [],
  showHppWorkflow = false,
  onClose,
  onSubmit,
}: MenuFormModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('cat-coffee');
  const [sellingPrice, setSellingPrice] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState<string | undefined>(undefined);
  const [isAvailable, setIsAvailable] = useState(true);
  const [draftRecipes, setDraftRecipes] = useState<MenuRecipeItem[]>([]);
  const [ingredientId, setIngredientId] = useState('');
  const [ingredientQty, setIngredientQty] = useState('');
  const [recipeInlineError, setRecipeInlineError] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const consumableInventory = useMemo(
    () =>
      inventory.filter(
        (item) => item.category_type === 'raw_material' || item.category_type === 'packaging'
      ),
    [inventory]
  );

  const inventoryById = useMemo(
    () => new Map(inventory.map((item) => [item.id, item])),
    [inventory]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (editingMenu) {
      setName(editingMenu.name);
      setCategoryId(editingMenu.category_id);
      setSellingPrice(String(editingMenu.selling_price));
      setDescription(editingMenu.description);
      setImageUrl(editingMenu.image_url);
      setIsAvailable(editingMenu.is_available);
      setDraftRecipes(editingMenu.recipes.map((r) => ({ ...r })));
    } else {
      setName('');
      setCategoryId('cat-coffee');
      setSellingPrice('');
      setDescription('');
      setImageUrl(undefined);
      setIsAvailable(true);
      setDraftRecipes([]);
    }
    setIngredientId(consumableInventory[0]?.id ?? '');
    setIngredientQty('');
    setRecipeInlineError(null);
    setErrorMsg(null);
  }, [isOpen, editingMenu, consumableInventory]);

  const parsedSellingPrice = Number(sellingPrice) || 0;

  const hppSummary = useMemo(
    () => calculateMenuHpp(parsedSellingPrice, draftRecipes, inventory),
    [parsedSellingPrice, draftRecipes, inventory]
  );

  if (!isOpen) return null;

  const selectableCategories = categories.filter((c) => c.id !== 'all');
  const selectedIngredientMeta = consumableInventory.find((i) => i.id === ingredientId);
  const requiresHppBeforePrice = showHppWorkflow && consumableInventory.length > 0;
  const isPriceStepUnlocked = !requiresHppBeforePrice || hppSummary.totalHpp > 0;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorMsg('File yang diunggah harus berupa gambar (JPG, PNG, WEBP).');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setErrorMsg('Ukuran gambar maksimal 3 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setImageUrl(reader.result);
        setErrorMsg(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAddDraftIngredient = () => {
    const qty = Number(ingredientQty);
    if (!ingredientId || !qty || qty <= 0) {
      setRecipeInlineError('Pilih bahan baku/kemasan dan isi takaran lebih dari 0.');
      return;
    }

    setDraftRecipes((prev) => {
      const existing = prev.find((r) => r.inventory_item_id === ingredientId);
      if (existing) {
        return prev.map((r) =>
          r.inventory_item_id === ingredientId ? { ...r, quantity_needed: qty } : r
        );
      }
      return [
        ...prev,
        {
          id: `draft-rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          menu_id: editingMenu?.id ?? 'draft-menu',
          inventory_item_id: ingredientId,
          quantity_needed: qty,
        },
      ];
    });
    setIngredientQty('');
    setRecipeInlineError(null);
    setErrorMsg(null);
  };

  const handleUpdateDraftQty = (recipeId: string, rawQty: string) => {
    const qty = Number(rawQty);
    if (Number.isNaN(qty) || qty <= 0) return;
    setDraftRecipes((prev) =>
      prev.map((r) => (r.id === recipeId ? { ...r, quantity_needed: qty } : r))
    );
  };

  const handleRemoveDraftIngredient = (recipeId: string) => {
    setDraftRecipes((prev) => prev.filter((r) => r.id !== recipeId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = Number(sellingPrice);
    if (!name.trim()) {
      setErrorMsg('Nama menu wajib diisi.');
      return;
    }
    if (requiresHppBeforePrice && hppSummary.totalHpp <= 0) {
      setErrorMsg(
        'Lengkapi Kalkulasi HPP (minimal 1 bahan baku/kemasan) pada Langkah 2 terlebih dahulu sebelum menentukan harga jual.'
      );
      return;
    }
    if (!priceNum || priceNum <= 0) {
      setErrorMsg('Harga jual harus berupa angka lebih dari 0.');
      return;
    }

    setSubmitting(true);
    await onSubmit(
      {
        name,
        category_id: categoryId,
        selling_price: priceNum,
        description: description.trim() || 'Menu pilihan BrewFlow Coffee Shop',
        visual_tone: editingMenu?.visual_tone ?? CATEGORY_DEFAULT_TONES[categoryId] ?? 'latte',
        image_url: imageUrl,
        is_available: isAvailable,
        ...(showHppWorkflow ? { recipes: draftRecipes } : {}),
      },
      editingMenu?.id ?? null
    );
    setSubmitting(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label={editingMenu ? `Edit Menu ${editingMenu.name}` : 'Tambah Menu Baru'}
    >
      <div
        className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] shadow-xl ${
          showHppWorkflow ? 'max-w-3xl' : 'max-w-lg'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-[#1A2E26]">
              {editingMenu ? `Edit Menu: ${editingMenu.name}` : 'Tambah Menu Baru'}
            </h2>
            <p className="mt-0.5 text-xs text-[#6B7280]">
              {showHppWorkflow
                ? 'Isi detail menu, hitung komposisi HPP, lalu tentukan harga jual berdasarkan saran profitabilitas.'
                : 'Menu yang aktif langsung muncul pada layar Kasir / POS.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup form menu"
            className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#F4F6F5] hover:text-[#1A2E26]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            {errorMsg && (
              <div
                role="alert"
                className="rounded-xl border border-[#EF4444]/30 bg-[#FEF2F2] px-3.5 py-2.5 text-xs font-medium text-[#EF4444]"
              >
                {errorMsg}
              </div>
            )}

            {/* SECTION 1: Informasi Dasar Menu */}
            <section className="space-y-4">
              {showHppWorkflow && (
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#109A58] text-[11px] font-bold text-white">
                    1
                  </span>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-[#1A2E26]">
                    Informasi Dasar Menu
                  </h3>
                </div>
              )}

              {/* Photo Upload Row */}
              <div className="flex items-center gap-4 rounded-xl border border-[#E5E7EB] bg-[#F4F6F5]/60 p-3.5">
                <ProductVisual
                  tone={editingMenu?.visual_tone ?? CATEGORY_DEFAULT_TONES[categoryId] ?? 'latte'}
                  name={name || 'Preview Menu'}
                  imageUrl={imageUrl}
                  size="md"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-xs font-semibold text-[#1A2E26]">Foto Produk Menu</p>
                  <p className="text-[11px] text-[#6B7280]">
                    Format JPG/PNG/WEBP, maks. 3 MB. Ditampilkan pada kartu produk kasir.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      aria-label="Unggah foto produk menu"
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[#E6F5EE] px-3.5 py-1.5 text-xs font-semibold text-[#109A58] hover:bg-[#D5EFE2]"
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                      <span>{imageUrl ? 'Ganti Gambar' : 'Upload Gambar'}</span>
                    </button>
                    {imageUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          setImageUrl(undefined);
                          if (fileInputRef.current) fileInputRef.current.value = '';
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-[#E5E7EB] bg-white px-3 py-1.5 text-xs font-semibold text-[#6B7280] hover:text-[#EF4444]"
                      >
                        <Trash2 className="h-3 w-3" />
                        <span>Hapus Foto</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className={showHppWorkflow ? 'sm:col-span-1' : 'sm:col-span-2'}>
                  <label htmlFor="menu-name" className="block text-xs font-semibold text-[#1A2E26]">
                    Nama Menu *
                  </label>
                  <input
                    id="menu-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Misal: Caramel Oat Latte"
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="menu-category"
                    className="block text-xs font-semibold text-[#1A2E26]"
                  >
                    Kategori *
                  </label>
                  <select
                    id="menu-category"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  >
                    {selectableCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Non-Owner retains standard price field here (HPP is Owner-only) */}
                {!showHppWorkflow && (
                  <div>
                    <label
                      htmlFor="menu-price"
                      className="block text-xs font-semibold text-[#1A2E26]"
                    >
                      Harga Jual (Rp) *
                    </label>
                    <input
                      id="menu-price"
                      type="number"
                      min={500}
                      step={500}
                      value={sellingPrice}
                      onChange={(e) => setSellingPrice(e.target.value)}
                      placeholder="32000"
                      className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs font-semibold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                    />
                  </div>
                )}

                <div className="sm:col-span-2">
                  <label htmlFor="menu-desc" className="block text-xs font-semibold text-[#1A2E26]">
                    Deskripsi Menu
                  </label>
                  <input
                    id="menu-desc"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Deskripsi singkat cita rasa menu..."
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-[#1A2E26]">
                    <input
                      type="checkbox"
                      checked={isAvailable}
                      onChange={(e) => setIsAvailable(e.target.checked)}
                      className="h-4 w-4 accent-[#109A58]"
                    />
                    <span>Tampilkan menu sebagai tersedia di layar Kasir / POS</span>
                  </label>
                </div>
              </div>
            </section>

            {/* SECTION 2 (OWNER ONLY): Kalkulasi HPP (Komposisi Bahan Baku & Kemasan) */}
            {showHppWorkflow && (
              <section
                data-testid="menu-modal-hpp-section"
                className="space-y-3 rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#109A58] text-[11px] font-bold text-white">
                      2
                    </span>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-[#1A2E26]">
                      Kalkulasi HPP (Resep Bahan &amp; Kemasan)
                    </h3>
                  </div>
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-[#109A58]/25 bg-[#E6F5EE] px-3 py-1 text-xs font-bold text-[#109A58] tabular-nums">
                    <Calculator className="h-3.5 w-3.5" />
                    <span data-testid="modal-total-hpp">
                      Modal HPP: {formatRupiah(hppSummary.totalHpp)}
                    </span>
                  </div>
                </div>

                <p className="text-[11px] text-[#6B7280]">
                  Masukkan bahan baku dan kemasan per 1 porsi. Harga satuan otomatis mengambil harga
                  beli terakhir dari Inventori.
                </p>

                {/* Add Ingredient Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    id="modal-hpp-ingredient"
                    value={ingredientId}
                    onChange={(e) => setIngredientId(e.target.value)}
                    aria-label="Pilih bahan baku untuk kalkulasi HPP"
                    className="h-9 min-w-[200px] flex-1 rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  >
                    {consumableInventory.length === 0 ? (
                      <option value="">Belum ada bahan baku / kemasan di Inventori</option>
                    ) : (
                      consumableInventory.map((inv) => (
                        <option key={inv.id} value={inv.id}>
                          {inv.name} ({formatRupiah(inv.last_purchase_price)}/{inv.unit})
                        </option>
                      ))
                    )}
                  </select>
                  <input
                    id="modal-hpp-qty"
                    type="number"
                    min={0.1}
                    step="any"
                    value={ingredientQty}
                    onChange={(e) => setIngredientQty(e.target.value)}
                    placeholder={`Takaran (${selectedIngredientMeta?.unit ?? 'unit'})`}
                    aria-label="Takaran bahan per porsi"
                    className="h-9 w-36 rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                  />
                  <button
                    type="button"
                    data-testid="modal-add-hpp-ingredient"
                    onClick={handleAddDraftIngredient}
                    disabled={consumableInventory.length === 0}
                    className="inline-flex h-9 items-center gap-1 rounded-full bg-[#109A58] px-3.5 text-xs font-semibold text-white hover:bg-[#0D8A4E] disabled:opacity-50 whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Tambah Bahan</span>
                  </button>
                </div>

                {recipeInlineError && (
                  <p className="text-[11px] font-medium text-[#EF4444]">{recipeInlineError}</p>
                )}

                {/* Draft Recipe List */}
                {draftRecipes.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-white px-4 py-4 text-center text-xs text-[#6B7280]">
                    Belum ada bahan yang dimasukkan. Tambahkan bahan di atas untuk menghitung HPP.
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[#E5E7EB] bg-[#F4F6F5]/70 text-[11px] text-[#6B7280]">
                          <th className="px-3 py-2">Bahan / Kemasan</th>
                          <th className="px-2 py-2 text-right">Takaran</th>
                          <th className="px-2 py-2 text-right">Harga/Unit</th>
                          <th className="px-3 py-2 text-right">Subtotal</th>
                          <th className="px-2 py-2 text-right"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5E7EB]">
                        {draftRecipes.map((recipe) => {
                          const inv = inventoryById.get(recipe.inventory_item_id);
                          if (!inv) return null;
                          const lineCost = Math.round(
                            inv.last_purchase_price * recipe.quantity_needed
                          );
                          return (
                            <tr key={recipe.id}>
                              <td className="px-3 py-2 font-medium text-[#1A2E26]">{inv.name}</td>
                              <td className="px-2 py-2 text-right">
                                <div className="inline-flex items-center justify-end gap-1">
                                  <input
                                    type="number"
                                    min={0.1}
                                    step="any"
                                    value={recipe.quantity_needed}
                                    aria-label={`Ubah takaran ${inv.name}`}
                                    onChange={(e) =>
                                      handleUpdateDraftQty(recipe.id, e.target.value)
                                    }
                                    className="h-7 w-16 rounded-lg border border-[#E5E7EB] px-1.5 text-right text-xs font-semibold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                                  />
                                  <span className="w-7 text-left text-[11px] text-[#6B7280]">
                                    {inv.unit}
                                  </span>
                                </div>
                              </td>
                              <td className="px-2 py-2 text-right text-[11px] text-[#6B7280] tabular-nums whitespace-nowrap">
                                {formatRupiah(inv.last_purchase_price)}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold text-[#1A2E26] tabular-nums whitespace-nowrap">
                                {formatRupiah(lineCost)}
                              </td>
                              <td className="px-2 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveDraftIngredient(recipe.id)}
                                  aria-label={`Hapus ${inv.name} dari kalkulasi HPP`}
                                  className="rounded-lg p-1 text-[#6B7280] hover:bg-[#FEF2F2] hover:text-[#EF4444]"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {/* SECTION 3 (OWNER ONLY): Saran & Penentuan Harga Jual (STRICTLY AFTER HPP!) */}
            {showHppWorkflow && (
              <section
                data-testid="menu-modal-pricing-section"
                className="space-y-4 rounded-2xl border border-[#109A58]/25 bg-white p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                        isPriceStepUnlocked
                          ? 'bg-[#109A58] text-white'
                          : 'bg-[#E5E7EB] text-[#6B7280]'
                      }`}
                    >
                      3
                    </span>
                    <h3 className="text-xs font-bold uppercase tracking-wide text-[#1A2E26]">
                      Saran &amp; Penentuan Harga Jual
                    </h3>
                  </div>
                  {!isPriceStepUnlocked && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#FFFBEB] px-2.5 py-0.5 text-[11px] font-semibold text-[#B45309]">
                      <Lock className="h-3 w-3" />
                      Isi HPP di Langkah 2 dulu
                    </span>
                  )}
                </div>

                <OwnerPricingAdvisor
                  totalHpp={hppSummary.totalHpp}
                  currentSellingPrice={parsedSellingPrice}
                  onSelectSuggestedPrice={(suggested) => {
                    setSellingPrice(String(suggested));
                    setErrorMsg(null);
                  }}
                  compact
                  testIdPrefix="modal-pricing"
                />

                <div className="grid grid-cols-1 gap-3 border-t border-[#E5E7EB] pt-3 sm:grid-cols-12 sm:items-end">
                  <div className="sm:col-span-6">
                    <label
                      htmlFor="menu-price"
                      className="block text-xs font-semibold text-[#1A2E26]"
                    >
                      Harga Jual Final (Rp) *
                    </label>
                    <input
                      id="menu-price"
                      type="number"
                      min={500}
                      step={500}
                      disabled={!isPriceStepUnlocked}
                      value={sellingPrice}
                      onChange={(e) => setSellingPrice(e.target.value)}
                      placeholder={
                        isPriceStepUnlocked
                          ? 'Pilih saran di atas atau ketik harga jual'
                          : 'Terbuka otomatis setelah HPP diisi'
                      }
                      className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-sm font-bold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none disabled:cursor-not-allowed disabled:bg-[#F4F6F5] disabled:text-[#9CA3AF]"
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 sm:col-span-6">
                    <div className="rounded-xl bg-[#F4F6F5] px-2.5 py-2">
                      <p className="text-[10px] text-[#6B7280]">Modal HPP</p>
                      <p className="text-xs font-bold text-[#1A2E26] tabular-nums">
                        {formatRupiah(hppSummary.totalHpp)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#F4F6F5] px-2.5 py-2">
                      <p className="text-[10px] text-[#6B7280]">Food Cost</p>
                      <p
                        className={`text-xs font-bold tabular-nums ${
                          parsedSellingPrice > 0 && hppSummary.foodCostPercent > 35
                            ? 'text-[#EF4444]'
                            : parsedSellingPrice > 0 && hppSummary.foodCostPercent > 30
                              ? 'text-[#D97706]'
                              : 'text-[#109A58]'
                        }`}
                      >
                        {parsedSellingPrice > 0 ? formatPercent(hppSummary.foodCostPercent) : '—'}
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#E6F5EE]/70 px-2.5 py-2">
                      <p className="text-[10px] text-[#065F46]">Profit/Cup</p>
                      <p
                        className={`text-xs font-bold tabular-nums ${
                          parsedSellingPrice > 0 && hppSummary.grossProfit <= 0
                            ? 'text-[#EF4444]'
                            : 'text-[#109A58]'
                        }`}
                      >
                        {parsedSellingPrice > 0 ? formatRupiah(hppSummary.grossProfit) : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-[#E5E7EB] bg-[#FFFFFF] px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-full border border-[#E5E7EB] px-5 text-xs font-semibold text-[#6B7280] hover:text-[#1A2E26]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting || !isPriceStepUnlocked}
              className="h-10 rounded-full bg-[#109A58] px-6 text-xs font-semibold text-white hover:bg-[#0D8A4E] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Menyimpan...' : editingMenu ? 'Simpan Perubahan' : 'Simpan Menu'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
