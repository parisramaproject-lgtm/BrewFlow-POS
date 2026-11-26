import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Coffee,
  Cookie,
  CupSoda,
  FileClock,
  LayoutGrid,
  Minus,
  Pencil,
  Plus,
  ShoppingBag,
  Ticket,
  Trash2,
  UserPlus,
  Utensils,
  X,
} from 'lucide-react';
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
import { calculateCartSummary } from '../utils/posCalculations';
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
    customers,
    orders,
    vouchers,
    settings,
    membershipProgram,
    createOrder,
    addCustomer,
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
    () => `BF-261125-${String(orders.length + 2).padStart(3, '0')}`,
    [orders.length]
  );

  const handleAddToCart = (menu: MenuItem) => {
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

  const handleUpdateQty = (menuId: string, delta: number) => {
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
    resetCart();
    setFeedbackBanner(`Draft pesanan ${result.order.order_number} berhasil disimpan.`);
    window.setTimeout(() => setFeedbackBanner(null), 4500);
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
    paymentMethod: PaymentMethod
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
    });
    resetCart();
    setFeedbackBanner(
      result.pointsEarned > 0
        ? `Transaksi ${result.order.order_number} selesai · +${result.pointsEarned} poin member & stok otomatis diperbarui.`
        : `Transaksi ${result.order.order_number} selesai · Stok bahan baku otomatis terpotong sesuai resep.`
    );
    window.setTimeout(() => setFeedbackBanner(null), 5000);
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
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-[#1A2E26]">Kategori Menu</h1>
            <span className="text-xs text-[#6B7280] tabular-nums">
              {filteredMenus.length} menu tersedia
            </span>
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
              return (
                <article
                  key={menu.id}
                  className="flex flex-col items-center rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4 text-center shadow-xs transition-colors hover:border-[#109A58]/40"
                >
                  <div className="relative flex justify-center pt-1">
                    <ProductVisual
                      tone={menu.visual_tone}
                      name={menu.name}
                      imageUrl={menu.image_url}
                    />
                    {inCartQty > 0 && (
                      <span
                        aria-label={`${inCartQty} di keranjang`}
                        className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-[#109A58] px-1.5 text-xs font-bold text-white shadow-xs tabular-nums"
                      >
                        {inCartQty}
                      </span>
                    )}
                  </div>

                  <h2 className="mt-3.5 line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-snug text-[#1A2E26]">
                    {menu.name}
                  </h2>

                  <p className="mt-1 text-sm font-bold text-[#1A2E26] tabular-nums">
                    {formatRupiah(menu.selling_price)}
                  </p>

                  <button
                    type="button"
                    onClick={() => handleAddToCart(menu)}
                    aria-label={`Tambah ${menu.name} ke pesanan`}
                    className="mt-4 flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-[#109A58] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#109A58]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span className="whitespace-nowrap">Tambah</span>
                  </button>
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
                  <button
                    key={draft.id}
                    type="button"
                    onClick={() => handleLoadDraft(draft)}
                    className="flex w-full items-center justify-between rounded-lg bg-[#FFFFFF] px-3 py-2 text-left text-xs hover:bg-[#E6F5EE]/60"
                  >
                    <div>
                      <p className="font-mono font-semibold text-[#1A2E26]">{draft.order_number}</p>
                      <p className="text-[11px] text-[#6B7280]">
                        {draft.table_number} · {draft.items.length} menu
                      </p>
                    </div>
                    <span className="font-bold text-[#109A58] tabular-nums">
                      {formatRupiah(draft.total_amount)}
                    </span>
                  </button>
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
                        onClick={() => handleUpdateQty(item.menu.id, 1)}
                        aria-label={`Tambah jumlah ${item.menu.name}`}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-[#109A58] text-white hover:bg-[#0D8A4E]"
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
    </div>
  );
}
