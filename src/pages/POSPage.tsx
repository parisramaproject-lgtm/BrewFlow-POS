import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Coffee,
  Cookie,
  CupSoda,
  FileClock,
  LayoutGrid,
  Minus,
  PackagePlus,
  Pencil,
  Plus,
  ShoppingBag,
  Ticket,
  Trash2,
  UserPlus,
  Utensils,
  X,
} from 'lucide-react';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { ProductVisual } from '../components/common/ProductVisual';
import { MemberModal } from '../components/pos/MemberModal';
import { PaymentModal } from '../components/pos/PaymentModal';
import { useAuth } from '../context/AuthContext';
import { useStore, type CreateOrderResult } from '../context/StoreContext';
import type {
  CartItem,
  Category,
  Customer,
  MenuItem,
  OrderRecord,
  OrderType,
  PaymentMethod,
  VoucherRecord,
} from '../types';
import { formatRupiah } from '../utils/format';
import {
  evaluateMenuStockAvailability,
  formatMissingIngredientsLabel,
} from '../utils/menuStockAvailability';
import { calculateCartSummary } from '../utils/posCalculations';
import { generateNextOrderNumber } from '../utils/orderNumber';
import {
  evaluateVoucherOnCart,
  formatVoucherSchemeSummary,
  getVoucherAvailability,
  normalizeVoucherCode,
} from '../utils/vouchers';

interface POSPageProps {
  searchQuery: string;
}

const CATEGORY_ICONS: Record<Category['icon_name'], React.ComponentType<{ className?: string }>> = {
  grid: LayoutGrid,
  coffee: Coffee,
  'cup-soda': CupSoda,
  utensils: Utensils,
  cookie: Cookie,
};

const ORDER_TYPES: Array<{ id: OrderType; label: string }> = [
  { id: 'dine_in', label: 'Dine-in' },
  { id: 'takeaway', label: 'Takeaway' },
  { id: 'delivery', label: 'Delivery' },
];

export function POSPage({ searchQuery }: POSPageProps) {
  const { user, authMode } = useAuth();
  const {
    categories,
    menus,
    inventory,
    customers,
    orders,
    vouchers,
    settings,
    membershipProgram,
    createOrder,
    deleteDraftOrder,
    addCustomer,
    submitRestockRequest,
  } = useStore();
  const liveSupabaseEnabled = authMode === 'supabase';

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<OrderType>('dine_in');
  const [tableNumber, setTableNumber] = useState<string>('Meja 01');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [orderNote, setOrderNote] = useState<string>('');
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [editingNoteMenuId, setEditingNoteMenuId] = useState<string | null>(null);

  // Rush Hour voucher redemption state
  const [voucherInput, setVoucherInput] = useState<string>('');
  const [appliedVoucherId, setAppliedVoucherId] = useState<string | null>(null);
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [voucherPickerOpen, setVoucherPickerOpen] = useState<boolean>(false);

  // Modals & UI feedback
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [draftsDrawerOpen, setDraftsDrawerOpen] = useState(false);
  const [confirmClearCartOpen, setConfirmClearCartOpen] = useState(false);
  const [deletingDraftOrder, setDeletingDraftOrder] = useState<OrderRecord | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const filteredMenus = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return menus.filter((menu) => {
      if (!menu.is_available) return false;
      const matchesCategory = selectedCategory === 'all' || menu.category_id === selectedCategory;
      const matchesSearch =
        !q ||
        menu.name.toLowerCase().includes(q) ||
        menu.description.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [menus, selectedCategory, searchQuery]);

  const savedDrafts = useMemo(
    () => orders.filter((order) => order.status === 'draft'),
    [orders]
  );

  const activeVouchersNow = useMemo(() => {
    const now = new Date();
    return vouchers.filter((voucher) => getVoucherAvailability(voucher, now).active);
  }, [vouchers]);

  const appliedVoucher = useMemo(
    () => (appliedVoucherId ? vouchers.find((v) => v.id === appliedVoucherId) ?? null : null),
    [appliedVoucherId, vouchers]
  );

  const appliedVoucherEval = useMemo(() => {
    if (!appliedVoucher) return null;
    return evaluateVoucherOnCart(appliedVoucher, cart, new Date(), menus);
  }, [appliedVoucher, cart, menus]);

  const summary = useMemo(
    () =>
      calculateCartSummary(cart, selectedCustomer?.tier ?? null, {
        taxEnabled: settings.taxEnabled,
        taxPercent: settings.taxPercent,
        tierRules: membershipProgram.tiers,
        pointEarningStepRupiah: membershipProgram.limits.point_earning_step_rupiah,
        voucherDiscountAmount: appliedVoucherEval?.valid ? appliedVoucherEval.discountAmount : 0,
        voucherCode: appliedVoucherEval?.valid ? appliedVoucher?.code ?? null : null,
        voucherStackableWithMember: appliedVoucher?.stackable_with_member_discount ?? true,
      }),
    [
      cart,
      selectedCustomer,
      settings.taxEnabled,
      settings.taxPercent,
      membershipProgram.tiers,
      membershipProgram.limits.point_earning_step_rupiah,
      appliedVoucherEval,
      appliedVoucher,
    ]
  );

  const nextOrderNumber = useMemo(
    () => generateNextOrderNumber(orders.map((order) => order.order_number)),
    [orders]
  );

  const menuAvailabilityMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof evaluateMenuStockAvailability>>();
    for (const menu of menus) {
      map.set(menu.id, evaluateMenuStockAvailability(menu, inventory, cart));
    }
    return map;
  }, [menus, inventory, cart]);

  const outOfStockMenuCount = useMemo(
    () => filteredMenus.filter((m) => menuAvailabilityMap.get(m.id)?.isOutOfStock).length,
    [filteredMenus, menuAvailabilityMap]
  );

  const handleAddToCart = (menu: MenuItem) => {
    const availability = evaluateMenuStockAvailability(menu, inventory, cart);
    if (availability.isOutOfStock) {
      setFeedbackBanner(
        `"${menu.name}" tidak dapat dipesan karena ${formatMissingIngredientsLabel(availability.missingIngredients).toLowerCase()}.`
      );
      window.setTimeout(() => setFeedbackBanner(null), 4500);
      return;
    }
    if (!availability.canAddOneMore) {
      setFeedbackBanner(
        `Jumlah "${menu.name}" sudah mencapai batas maksimum stok bahan baku yang tersedia.`
      );
      window.setTimeout(() => setFeedbackBanner(null), 4000);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((item) => item.menu.id === menu.id);
      if (existing) {
        return prev.map((item) =>
          item.menu.id === menu.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { menu, quantity: 1 }];
    });
  };

  const handleQuickRequestRestock = (menu: MenuItem) => {
    if (!user) return;
    const availability = menuAvailabilityMap.get(menu.id);
    const firstMissing = availability?.missingIngredients[0];
    if (!firstMissing) return;
    const invItem = inventory.find((i) => i.id === firstMissing.inventory_item_id);
    const suggestedQty = Math.max(
      invItem ? invItem.min_stock_threshold * 2 : 10,
      firstMissing.needed_per_serving * 10
    );
    submitRestockRequest({
      inventory_item_id: firstMissing.inventory_item_id,
      requested_quantity: Math.round(suggestedQty),
      urgency: 'urgent',
      notes: `Bahan habis di Kasir POS (memblokir menu ${menu.name}).`,
      requested_by_id: user.id,
      requested_by_name: user.full_name,
      requested_by_role: user.role,
    });
    setFeedbackBanner(
      `Notifikasi permintaan restock "${firstMissing.name}" berhasil dikirim ke Owner & Manager.`
    );
    window.setTimeout(() => setFeedbackBanner(null), 5000);
  };

  const handleUpdateQty = (menuId: string, delta: number) => {
    if (delta > 0) {
      const targetMenu = menus.find((m) => m.id === menuId);
      if (targetMenu) {
        const availability = evaluateMenuStockAvailability(targetMenu, inventory, cart);
        if (!availability.canAddOneMore) {
          setFeedbackBanner(
            `Stok bahan untuk "${targetMenu.name}" tidak mencukupi untuk menambah porsi lagi.`
          );
          window.setTimeout(() => setFeedbackBanner(null), 4000);
          return;
        }
      }
    }
    setCart((prev) =>
      prev
        .map((item) =>
          item.menu.id === menuId ? { ...item, quantity: item.quantity + delta } : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const handleUpdateItemNote = (menuId: string, note: string) => {
    setCart((prev) =>
      prev.map((item) => (item.menu.id === menuId ? { ...item, note } : item))
    );
  };

  const handleRemoveItem = (menuId: string) => {
    setCart((prev) => prev.filter((item) => item.menu.id !== menuId));
  };

  const resetCart = () => {
    setCart([]);
    setSelectedCustomer(null);
    setOrderNote('');
    setActiveDraftId(null);
    setEditingNoteMenuId(null);
    setVoucherInput('');
    setAppliedVoucherId(null);
    setVoucherError(null);
    setVoucherPickerOpen(false);
  };

  const applyVoucherRecord = (voucher: VoucherRecord) => {
    const evaluation = evaluateVoucherOnCart(voucher, cart, new Date(), menus);
    if (!evaluation.valid) {
      setVoucherError(evaluation.error || 'Voucher belum memenuhi syarat pesanan saat ini.');
      return;
    }
    setAppliedVoucherId(voucher.id);
    setVoucherInput(voucher.code);
    setVoucherError(null);
    setVoucherPickerOpen(false);
  };

  const handleApplyVoucherCode = () => {
    const normalized = normalizeVoucherCode(voucherInput);
    if (!normalized) {
      setVoucherError('Masukkan kode voucher terlebih dahulu.');
      return;
    }
    const found = vouchers.find((v) => normalizeVoucherCode(v.code) === normalized);
    if (!found) {
      setVoucherError(`Kode voucher "${normalized}" tidak ditemukan.`);
      return;
    }
    applyVoucherRecord(found);
  };

  const handleRemoveVoucher = () => {
    setAppliedVoucherId(null);
    setVoucherInput('');
    setVoucherError(null);
  };

  const handleSaveDraft = async () => {
    if (!user || cart.length === 0) return;
    const result = await createOrder({
      items: cart,
      orderType,
      tableNumber,
      customer: selectedCustomer,
      appliedVoucher: appliedVoucherEval?.valid ? appliedVoucher : null,
      paymentMethod: 'cash',
      notes: orderNote,
      status: 'draft',
      cashier: user,
      replacesDraftId: activeDraftId,
      enableSupabaseSync: liveSupabaseEnabled,
    });
    if (result.syncStatus.synced || result.syncStatus.queuedOffline) {
      resetCart();
      setFeedbackBanner(
        result.syncStatus.queuedOffline
          ? `Draft pesanan ${result.order.order_number} disimpan ke antrean offline dan akan disinkronkan saat koneksi kembali.`
          : `Draft pesanan ${result.order.order_number} berhasil disimpan.`
      );
      window.setTimeout(() => setFeedbackBanner(null), 4500);
    } else {
      setFeedbackBanner(
        result.syncStatus.error ||
          'Gagal menyimpan draft ke server. Keranjang tetap dipertahankan agar Anda dapat mencoba ulang.'
      );
      window.setTimeout(() => setFeedbackBanner(null), 6000);
    }
  };

  const handleLoadDraft = (draft: OrderRecord) => {
    const menuById = new Map(menus.map((m) => [m.id, m]));
    const restoredCart: CartItem[] = [];
    for (const line of draft.items) {
      const foundMenu = menuById.get(line.menu_id);
      if (foundMenu) {
        restoredCart.push({
          menu: foundMenu,
          quantity: line.quantity,
          note: line.notes,
        });
      }
    }
    setCart(restoredCart);
    setOrderType(draft.order_type);
    setTableNumber(draft.table_number);
    setOrderNote(draft.notes);
    setSelectedCustomer(
      draft.customer_id ? customers.find((c) => c.id === draft.customer_id) ?? null : null
    );
    if (draft.voucher_code) {
      const matchedVoucher = vouchers.find(
        (v) => normalizeVoucherCode(v.code) === normalizeVoucherCode(draft.voucher_code ?? '')
      );
      setAppliedVoucherId(matchedVoucher?.id ?? null);
      setVoucherInput(matchedVoucher?.code ?? '');
    } else {
      setAppliedVoucherId(null);
      setVoucherInput('');
    }
    setVoucherError(null);
    setActiveDraftId(draft.id);
    setDraftsDrawerOpen(false);
  };

  const handleConfirmPayment = async (
    paymentMethod: PaymentMethod,
    options?: { forceOfflineQueue?: boolean }
  ): Promise<CreateOrderResult | null> => {
    if (!user || cart.length === 0) return null;
    const result = await createOrder({
      items: cart,
      orderType,
      tableNumber,
      customer: selectedCustomer,
      appliedVoucher: appliedVoucherEval?.valid ? appliedVoucher : null,
      paymentMethod,
      notes: orderNote,
      status: 'completed',
      cashier: user,
      replacesDraftId: activeDraftId,
      enableSupabaseSync: liveSupabaseEnabled,
      forceOfflineQueue: options?.forceOfflineQueue,
    });

    if (result.syncStatus.synced || result.syncStatus.queuedOffline) {
      resetCart();
      setFeedbackBanner(
        result.syncStatus.queuedOffline
          ? `Transaksi ${result.order.order_number} tersimpan di antrean offline. Akan otomatis disinkronkan saat internet aktif.`
          : result.pointsEarned > 0
            ? `Transaksi ${result.order.order_number} selesai · +${result.pointsEarned} poin member & stok otomatis diperbarui.`
            : `Transaksi ${result.order.order_number} selesai · Stok bahan baku otomatis terpotong sesuai resep.`
      );
      window.setTimeout(() => setFeedbackBanner(null), 5000);
    }
    return result;
  };

  return (
    <div className="flex min-h-full flex-col md:h-full md:min-h-0 md:flex-row md:overflow-hidden">
      {/* Column 2: Center Menu Catalog */}
      <section
        aria-label="Katalog Menu POS"
        className="flex min-w-0 flex-col px-4 py-4 md:flex-1 md:overflow-y-auto lg:px-6 lg:py-5"
      >
        {feedbackBanner && (
          <div
            role="status"
            className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#109A58]/30 bg-[#E6F5EE] px-4 py-3 text-sm font-medium text-[#109A58]"
          >
            <span className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {feedbackBanner}
            </span>
            <button
              type="button"
              onClick={() => setFeedbackBanner(null)}
              aria-label="Tutup pemberitahuan"
              className="text-[#109A58] hover:text-[#0D8A4E]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Horizontal Category Strip */}
        <div className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-semibold text-[#1A2E26]">Kategori Menu</h1>
            <div className="flex items-center gap-2 text-xs tabular-nums">
              <span className="text-[#6B7280]">{filteredMenus.length} menu tampil</span>
              {outOfStockMenuCount > 0 && (
                <span
                  data-testid="pos-outofstock-summary"
                  className="inline-flex items-center gap-1 rounded-full border border-[#EF4444]/30 bg-[#FEF2F2] px-2.5 py-0.5 text-[11px] font-semibold text-[#DC2626]"
                >
                  <AlertTriangle className="h-3 w-3" />
                  <span>{outOfStockMenuCount} bahan habis</span>
                </span>
              )}
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Filter Kategori Menu"
            className="mt-3 flex gap-3 overflow-x-auto pb-1"
          >
            {categories.map((cat) => {
              const Icon = CATEGORY_ICONS[cat.icon_name] ?? LayoutGrid;
              const isActive = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`flex min-w-[96px] shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border px-4 py-3.5 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#109A58] ${
                    isActive
                      ? 'border-[#109A58] bg-[#E6F5EE] text-[#109A58]'
                      : 'border-[#E5E7EB] bg-[#FFFFFF] text-[#6B7280] hover:border-[#109A58]/40 hover:text-[#1A2E26]'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-xs font-semibold whitespace-nowrap">{cat.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Product Grid (3-4 columns on desktop) */}
        {filteredMenus.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] px-6 py-14 text-center">
            <Coffee className="h-10 w-10 text-[#6B7280]/50" />
            <p className="mt-3 text-sm font-semibold text-[#1A2E26]">Menu tidak ditemukan</p>
            <p className="mt-1 text-xs text-[#6B7280]">
              Coba kata kunci pencarian lain atau pilih kategori &ldquo;Semua&rdquo;.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3.5 md:grid-cols-[repeat(auto-fill,minmax(168px,1fr))] lg:gap-4">
            {filteredMenus.map((menu) => {
              const inCartQty = cart.find((item) => item.menu.id === menu.id)?.quantity ?? 0;
              const availability =
                menuAvailabilityMap.get(menu.id) ??
                evaluateMenuStockAvailability(menu, inventory, cart);
              const isBlocked = availability.isOutOfStock;
              const isCartFull = !isBlocked && !availability.canAddOneMore;

              return (
                <article
                  key={menu.id}
                  data-testid={`pos-menu-card-${menu.id}`}
                  data-stock-status={isBlocked ? 'out-of-stock' : 'available'}
                  className={`flex flex-col items-center rounded-2xl border p-4 text-center shadow-xs transition-colors ${
                    isBlocked
                      ? 'border-[#FCA5A5] bg-[#FEF2F2]/40'
                      : 'border-[#E5E7EB] bg-[#FFFFFF] hover:border-[#109A58]/40'
                  }`}
                >
                  <div className="relative flex justify-center pt-1">
                    <div className={isBlocked ? 'opacity-50 grayscale' : ''}>
                      <ProductVisual
                        tone={menu.visual_tone}
                        name={menu.name}
                        imageUrl={menu.image_url}
                      />
                    </div>
                    {isBlocked ? (
                      <span
                        data-testid={`pos-menu-oos-badge-${menu.id}`}
                        className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#DC2626] px-2.5 py-0.5 text-[10px] font-bold text-white shadow-xs"
                      >
                        Bahan Habis
                      </span>
                    ) : availability.isLowServings ? (
                      <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-[#D97706] px-2 py-0.5 text-[10px] font-bold text-white shadow-xs tabular-nums">
                        Sisa {availability.maxServingsFromStock} porsi
                      </span>
                    ) : null}
                    {inCartQty > 0 && (
                      <span
                        aria-label={`${inCartQty} di keranjang`}
                        className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#109A58] px-1.5 text-xs font-bold text-white shadow-xs tabular-nums"
                      >
                        {inCartQty}
                      </span>
                    )}
                  </div>

                  <h2
                    className={`mt-3.5 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug ${
                      isBlocked ? 'text-[#6B7280]' : 'text-[#1A2E26]'
                    }`}
                  >
                    {menu.name}
                  </h2>

                  <p
                    className={`mt-1 text-sm font-bold tabular-nums ${
                      isBlocked ? 'text-[#9CA3AF] line-through' : 'text-[#1A2E26]'
                    }`}
                  >
                    {formatRupiah(menu.selling_price)}
                  </p>

                  {isBlocked && (
                    <p
                      data-testid={`pos-menu-oos-note-${menu.id}`}
                      className="mt-1.5 line-clamp-2 rounded-lg bg-[#FEF2F2] px-2 py-1 text-[10.5px] font-semibold leading-snug text-[#B91C1C]"
                    >
                      {formatMissingIngredientsLabel(availability.missingIngredients)}
                    </p>
                  )}

                  {isCartFull && (
                    <p className="mt-1.5 rounded-lg bg-[#FFFBEB] px-2 py-1 text-[10.5px] font-semibold text-[#B45309]">
                      Maks. stok bahan ({availability.maxServingsFromStock} porsi)
                    </p>
                  )}

                  <div className="mt-auto w-full pt-3 space-y-1.5">
                    <button
                      type="button"
                      disabled={isBlocked || isCartFull}
                      onClick={() => handleAddToCart(menu)}
                      aria-label={
                        isBlocked
                          ? `${menu.name} tidak bisa dipesan karena bahan baku habis`
                          : `Tambah ${menu.name} ke pesanan`
                      }
                      className={`flex h-9 w-full items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#109A58] ${
                        isBlocked
                          ? 'cursor-not-allowed bg-[#E5E7EB] text-[#6B7280]'
                          : isCartFull
                            ? 'cursor-not-allowed bg-[#FEF3C7] text-[#92400E]'
                            : 'bg-[#109A58] text-white hover:bg-[#0D8A4E]'
                      }`}
                    >
                      {isBlocked ? (
                        <span className="whitespace-nowrap">Tidak Bisa Dipesan</span>
                      ) : isCartFull ? (
                        <span className="whitespace-nowrap">Stok Maksimal</span>
                      ) : (
                        <>
                          <Plus className="h-3.5 w-3.5" />
                          <span className="whitespace-nowrap">Tambah</span>
                        </>
                      )}
                    </button>

                    {isBlocked && (
                      <button
                        type="button"
                        data-testid={`pos-request-restock-${menu.id}`}
                        onClick={() => handleQuickRequestRestock(menu)}
                        className="flex h-7 w-full items-center justify-center gap-1 rounded-full border border-[#F59E0B]/40 bg-[#FFFBEB] px-3 text-[11px] font-semibold text-[#B45309] transition-colors hover:bg-[#FEF3C7]"
                      >
                        <PackagePlus className="h-3 w-3 shrink-0" />
                        <span className="whitespace-nowrap">Ajukan Restock</span>
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Column 3: Right Order Panel (Side-by-side on tablet md+ and desktop) */}
      <aside
        aria-label="Pesanan Saat Ini"
        className="flex w-full shrink-0 flex-col border-t border-[#E5E7EB] bg-[#FFFFFF] md:h-full md:w-[300px] md:border-l md:border-t-0 lg:w-[330px] xl:w-[360px]"
      >
        {/* Order Header */}
        <div className="border-b border-[#E5E7EB] px-4 py-3.5 xl:px-5 xl:py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-[#1A2E26]">Pesanan Saat Ini</h2>
              <p className="mt-0.5 font-mono text-xs text-[#6B7280] tabular-nums">
                {nextOrderNumber}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {cart.length > 0 && (
                <button
                  type="button"
                  data-testid="pos-clear-cart-button"
                  onClick={() => setConfirmClearCartOpen(true)}
                  aria-label="Batalkan dan kosongkan keranjang"
                  title="Batalkan / Kosongkan keranjang"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-[#FCA5A5] bg-[#FEF2F2] text-[#DC2626] transition-colors hover:bg-[#FEE2E2]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
              {savedDrafts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDraftsDrawerOpen((prev) => !prev)}
                  aria-label={`Lihat ${savedDrafts.length} draft tersimpan`}
                  className="flex items-center gap-1 rounded-full border border-[#E5E7EB] bg-[#F4F6F5] px-2.5 py-1.5 text-xs font-semibold text-[#1A2E26] hover:border-[#109A58] hover:text-[#109A58] whitespace-nowrap"
                >
                  <FileClock className="h-3.5 w-3.5" />
                  <span className="tabular-nums">Draft ({savedDrafts.length})</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setMemberModalOpen(true)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  selectedCustomer
                    ? 'border-[#109A58] bg-[#E6F5EE] text-[#109A58]'
                    : 'border-[#E5E7EB] bg-[#F4F6F5] text-[#1A2E26] hover:border-[#109A58] hover:text-[#109A58]'
                }`}
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>
                  {selectedCustomer ? selectedCustomer.name.split(' ')[0] : 'Pilih Member'}
                </span>
              </button>
            </div>
          </div>

          {/* Saved Drafts Quick Picker */}
          {draftsDrawerOpen && savedDrafts.length > 0 && (
            <div className="mt-3 rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] p-2.5">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-[#6B7280]">
                <span>Pilih Draft untuk Dilanjutkan</span>
                <button
                  type="button"
                  onClick={() => setDraftsDrawerOpen(false)}
                  className="text-[#6B7280] hover:text-[#1A2E26]"
                >
                  Tutup
                </button>
              </div>
              <div className="space-y-1.5">
                {savedDrafts.map((draft) => (
                  <div
                    key={draft.id}
                    className="flex items-center gap-1.5 rounded-lg bg-[#FFFFFF] px-2.5 py-2 hover:bg-[#E6F5EE]/50"
                  >
                    <button
                      type="button"
                      onClick={() => handleLoadDraft(draft)}
                      className="flex min-w-0 flex-1 items-center justify-between text-left text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono font-semibold text-[#1A2E26]">
                          {draft.order_number}
                        </p>
                        <p className="text-[11px] text-[#6B7280]">
                          {draft.table_number} · {draft.items.length} menu
                        </p>
                      </div>
                      <span className="ml-2 shrink-0 font-bold text-[#109A58] tabular-nums">
                        {formatRupiah(draft.total_amount)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingDraftOrder(draft)}
                      aria-label={`Hapus draft ${draft.order_number}`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#6B7280] hover:bg-[#FEF2F2] hover:text-[#EF4444]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedCustomer && (
            <div className="mt-2.5 flex items-center justify-between rounded-xl bg-[#E6F5EE] px-3 py-2 text-xs text-[#109A58]">
              <span>
                Member {selectedCustomer.tier} · {selectedCustomer.points} poin
              </span>
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                aria-label="Hapus pilihan member"
                className="font-semibold underline hover:text-[#0D8A4E]"
              >
                Lepas
              </button>
            </div>
          )}

          {/* Order Type Switcher */}
          <div
            role="group"
            aria-label="Tipe Pesanan"
            className="mt-3.5 grid grid-cols-3 gap-1 rounded-xl bg-[#F4F6F5] p-1"
          >
            {ORDER_TYPES.map((type) => {
              const active = orderType === type.id;
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => setOrderType(type.id)}
                  className={`rounded-lg py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    active
                      ? 'border border-[#109A58]/40 bg-[#FFFFFF] text-[#109A58]'
                      : 'text-[#6B7280] hover:text-[#1A2E26]'
                  }`}
                >
                  {type.label}
                </button>
              );
            })}
          </div>

          {orderType === 'dine_in' && (
            <div className="mt-2.5 flex items-center gap-2">
              <label htmlFor="table-number" className="shrink-0 text-xs font-medium text-[#6B7280]">
                Meja:
              </label>
              <input
                id="table-number"
                type="text"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                className="h-8 flex-1 rounded-lg border border-[#E5E7EB] bg-[#F4F6F5] px-2.5 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:bg-white focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Cart Items List */}
        <div className="min-h-[180px] flex-1 overflow-y-auto px-4 py-3 xl:px-5">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F4F6F5] text-[#6B7280]">
                <ShoppingBag className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-medium text-[#1A2E26]">Keranjang masih kosong</p>
              <p className="mt-1 text-xs text-[#6B7280]">
                Klik tombol &ldquo;+ Tambah&rdquo; pada menu untuk memulai pesanan.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[#E5E7EB]">
              {cart.map((item, idx) => (
                <li key={item.menu.id} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#1A2E26]">
                        <span className="mr-1.5 text-xs text-[#6B7280] tabular-nums">
                          {idx + 1}.
                        </span>
                        {item.menu.name}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-[#6B7280]">
                        <span className="tabular-nums">
                          {formatRupiah(item.menu.selling_price)} / item
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setEditingNoteMenuId((prev) =>
                              prev === item.menu.id ? null : item.menu.id
                            )
                          }
                          className="text-[11px] font-medium text-[#109A58] hover:underline"
                        >
                          {item.note ? 'Edit varian' : '+ Varian'}
                        </button>
                      </div>
                      {item.note && editingNoteMenuId !== item.menu.id && (
                        <p className="mt-1 text-[11px] text-[#6B7280]">Catatan: {item.note}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.menu.id)}
                      aria-label={`Hapus ${item.menu.name} dari pesanan`}
                      className="rounded-lg p-1 text-[#6B7280] transition-colors hover:bg-[#FEF2F2] hover:text-[#EF4444]"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {editingNoteMenuId === item.menu.id && (
                    <div className="mt-2">
                      <input
                        type="text"
                        value={item.note ?? ''}
                        onChange={(e) => handleUpdateItemNote(item.menu.id, e.target.value)}
                        onBlur={() => setEditingNoteMenuId(null)}
                        placeholder="Misal: Less sugar, extra shot, oat milk..."
                        aria-label={`Catatan varian untuk ${item.menu.name}`}
                        className="h-8 w-full rounded-lg border border-[#109A58]/50 bg-[#F4F6F5] px-2.5 text-xs text-[#1A2E26] focus:bg-white focus:outline-none"
                      />
                    </div>
                  )}

                  <div className="mt-2.5 flex items-center justify-between">
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#E5E7EB] bg-[#F4F6F5] px-1.5 py-0.5">
                      <button
                        type="button"
                        onClick={() => handleUpdateQty(item.menu.id, -1)}
                        aria-label={`Kurangi jumlah ${item.menu.name}`}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FFFFFF] text-[#1A2E26] hover:text-[#109A58]"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="min-w-5 text-center text-xs font-semibold text-[#1A2E26] tabular-nums">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        disabled={!menuAvailabilityMap.get(item.menu.id)?.canAddOneMore}
                        onClick={() => handleUpdateQty(item.menu.id, 1)}
                        aria-label={`Tambah jumlah ${item.menu.name}`}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-[#109A58] text-white hover:bg-[#0D8A4E] disabled:cursor-not-allowed disabled:bg-[#D1D5DB]"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    <span className="text-sm font-semibold text-[#1A2E26] tabular-nums">
                      {formatRupiah(item.menu.selling_price * item.quantity)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Order Note + Voucher Rush Hour + Payment Summary + Bottom Actions */}
        <div className="border-t border-[#E5E7EB] px-4 py-3.5 xl:px-5 xl:py-4">
          <div className="relative mb-3">
            <Pencil
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7280]"
              aria-hidden="true"
            />
            <input
              type="text"
              value={orderNote}
              onChange={(e) => setOrderNote(e.target.value)}
              placeholder="Tambah catatan..."
              aria-label="Catatan pesanan"
              className="h-9 w-full rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] pl-8 pr-3 text-xs text-[#1A2E26] placeholder:text-[#6B7280] focus:border-[#109A58] focus:bg-[#FFFFFF] focus:outline-none"
            />
          </div>

          {/* Rush Hour Voucher Control */}
          <div className="mb-3.5">
            {appliedVoucher ? (
              <div
                className={`rounded-xl border px-3 py-2 text-xs ${
                  appliedVoucherEval?.valid
                    ? 'border-[#109A58]/35 bg-[#E6F5EE] text-[#1A2E26]'
                    : 'border-[#F59E0B]/40 bg-[#FFFBEB] text-[#92400E]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Ticket className="h-3.5 w-3.5 shrink-0 text-[#109A58]" />
                      <span className="truncate font-mono font-bold text-[#1A2E26]">
                        {appliedVoucher.code}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-[#6B7280]">
                      {appliedVoucherEval?.valid
                        ? appliedVoucherEval.summaryLabel
                        : appliedVoucherEval?.error || 'Belum memenuhi syarat promo'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRemoveVoucher}
                    aria-label="Lepas kode voucher"
                    className="shrink-0 text-[11px] font-semibold text-[#EF4444] hover:underline"
                  >
                    Lepas
                  </button>
                </div>
                {appliedVoucherEval?.valid &&
                  selectedCustomer &&
                  !appliedVoucher.stackable_with_member_discount && (
                    <p className="mt-1 text-[10px] text-[#6B7280]">
                      Voucher ini tidak digabung dengan diskon member.
                    </p>
                  )}
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1">
                    <Ticket
                      className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7280]"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      value={voucherInput}
                      onChange={(e) => {
                        setVoucherInput(e.target.value.toUpperCase());
                        if (voucherError) setVoucherError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleApplyVoucherCode();
                        }
                      }}
                      placeholder="Kode voucher / Rush Hour"
                      aria-label="Kode voucher promo"
                      className="h-9 w-full rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] pl-8 pr-2.5 font-mono text-xs text-[#1A2E26] uppercase placeholder:font-sans placeholder:normal-case placeholder:text-[#6B7280] focus:border-[#109A58] focus:bg-[#FFFFFF] focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleApplyVoucherCode}
                    className="h-9 shrink-0 rounded-xl border border-[#109A58] bg-[#E6F5EE] px-3 text-xs font-semibold text-[#109A58] transition-colors hover:bg-[#109A58] hover:text-white"
                  >
                    Pakai
                  </button>
                </div>

                {activeVouchersNow.length > 0 && (
                  <div className="mt-1.5 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setVoucherPickerOpen((prev) => !prev)}
                      aria-expanded={voucherPickerOpen}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#109A58] hover:underline"
                    >
                      <Clock className="h-3 w-3" />
                      <span>
                        {voucherPickerOpen
                          ? 'Sembunyikan promo aktif'
                          : `Promo Rush Hour aktif (${activeVouchersNow.length})`}
                      </span>
                    </button>
                  </div>
                )}

                {voucherPickerOpen && activeVouchersNow.length > 0 && (
                  <div className="mt-2 max-h-36 space-y-1.5 overflow-y-auto rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] p-2">
                    {activeVouchersNow.map((voucher) => (
                      <button
                        key={voucher.id}
                        type="button"
                        onClick={() => applyVoucherRecord(voucher)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-transparent bg-[#FFFFFF] px-2.5 py-2 text-left transition-colors hover:border-[#109A58]/40 hover:bg-[#E6F5EE]/40"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-mono text-[11px] font-bold text-[#1A2E26]">
                            {voucher.code}
                          </p>
                          <p className="truncate text-[10px] text-[#6B7280]">
                            {formatVoucherSchemeSummary(voucher)} · {voucher.start_time}–
                            {voucher.end_time}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] font-semibold text-[#109A58]">
                          Pakai
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {voucherError && (
                  <p role="alert" className="mt-1.5 text-[11px] font-medium text-[#EF4444]">
                    {voucherError}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between text-[#6B7280]">
              <span>Subtotal ({summary.itemCount} item)</span>
              <span className="font-medium text-[#1A2E26] tabular-nums">
                {formatRupiah(summary.subtotal)}
              </span>
            </div>

            {summary.memberDiscountAmount > 0 && (
              <div className="flex items-center justify-between text-[#EF4444]">
                <span>Diskon Member ({Math.round(summary.discountRate * 100)}%)</span>
                <span className="font-semibold tabular-nums">
                  -{formatRupiah(summary.memberDiscountAmount)}
                </span>
              </div>
            )}

            {summary.voucherDiscountAmount > 0 && (
              <div
                data-testid="pos-voucher-discount"
                className="flex items-center justify-between text-[#109A58]"
              >
                <span className="truncate pr-2">
                  Voucher {summary.voucherCode || 'Promo'}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  -{formatRupiah(summary.voucherDiscountAmount)}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between text-[#6B7280]">
              <span>
                {settings.taxEnabled
                  ? `${settings.taxLabel || 'Pajak'} (${settings.taxPercent}%)`
                  : 'Pajak (Nonaktif)'}
              </span>
              <span
                data-testid="pos-tax-amount"
                className="font-medium text-[#1A2E26] tabular-nums"
              >
                {formatRupiah(summary.taxAmount)}
              </span>
            </div>

            <div className="my-2.5 border-t border-dashed border-[#E5E7EB]" />

            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[#1A2E26]">Total Akhir</span>
              <span
                data-testid="pos-grand-total"
                className="text-xl font-bold text-[#1A2E26] tabular-nums"
              >
                {formatRupiah(summary.totalAmount)}
              </span>
            </div>
          </div>

          <div className="mt-4 space-y-2.5">
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={handleSaveDraft}
              className="flex h-10 w-full items-center justify-center rounded-full bg-[#E6F5EE] text-sm font-semibold text-[#109A58] transition-colors hover:bg-[#D5EFE2] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Simpan Draft
            </button>
            <button
              type="button"
              disabled={cart.length === 0}
              onClick={() => setPaymentModalOpen(true)}
              className="flex h-12 w-full items-center justify-center rounded-full bg-[#109A58] text-sm font-semibold text-white transition-colors hover:bg-[#0D8A4E] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Proses Bayar
            </button>
          </div>
        </div>
      </aside>

      {/* Modular Modals */}
      <MemberModal
        isOpen={memberModalOpen}
        customers={customers}
        selectedCustomerId={selectedCustomer?.id ?? null}
        onClose={() => setMemberModalOpen(false)}
        onSelectCustomer={(customer) => setSelectedCustomer(customer)}
        onCreateCustomer={(input) =>
          addCustomer({ ...input, enableSupabaseSync: liveSupabaseEnabled })
        }
      />

      <PaymentModal
        isOpen={paymentModalOpen}
        orderNumber={nextOrderNumber}
        summary={summary}
        customer={selectedCustomer}
        settings={settings}
        onClose={() => setPaymentModalOpen(false)}
        onConfirm={handleConfirmPayment}
      />

      <ConfirmDialog
        open={confirmClearCartOpen}
        variant="danger"
        title="Batalkan Pesanan di Keranjang?"
        description={
          <span>
            Seluruh <strong>{summary.itemCount} item</strong> pada keranjang aktif senilai{' '}
            <strong className="text-[#1A2E26]">{formatRupiah(summary.totalAmount)}</strong> akan
            dihapus dan pesanan dibatalkan.
          </span>
        }
        confirmLabel="Ya, Batalkan Pesanan"
        cancelLabel="Kembali"
        onCancel={() => setConfirmClearCartOpen(false)}
        onConfirm={() => {
          setCart([]);
          setOrderNote('');
          setSelectedCustomer(null);
          setAppliedVoucherId(null);
          setVoucherInput('');
          setVoucherError(null);
          setActiveDraftId(null);
          setConfirmClearCartOpen(false);
          setFeedbackBanner('Pesanan di keranjang telah dibatalkan.');
          window.setTimeout(() => setFeedbackBanner(null), 3500);
        }}
      />

      <ConfirmDialog
        open={Boolean(deletingDraftOrder)}
        variant="danger"
        title="Hapus Draft Pesanan?"
        description={
          deletingDraftOrder && (
            <span>
              Draft <strong className="font-mono text-[#1A2E26]">{deletingDraftOrder.order_number}</strong>{' '}
              ({deletingDraftOrder.table_number} · {formatRupiah(deletingDraftOrder.total_amount)})
              akan dihapus permanen.
            </span>
          )
        }
        confirmLabel="Ya, Hapus Draft"
        cancelLabel="Batal"
        onCancel={() => setDeletingDraftOrder(null)}
        onConfirm={() => {
          if (!deletingDraftOrder) return;
          const draftNo = deletingDraftOrder.order_number;
          deleteDraftOrder(deletingDraftOrder.id);
          if (activeDraftId === deletingDraftOrder.id) {
            setActiveDraftId(null);
          }
          setDeletingDraftOrder(null);
          setFeedbackBanner(`Draft pesanan ${draftNo} telah dihapus.`);
          window.setTimeout(() => setFeedbackBanner(null), 3500);
        }}
      />
    </div>
  );
}
