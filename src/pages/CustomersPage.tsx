import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Award,
  CheckCircle2,
  Gift,
  Plus,
  ReceiptText,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { MembershipProgramPanel } from '../components/membership/MembershipProgramPanel';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import type { Customer, MemberTier } from '../types';
import { formatDateTime, formatRupiah, formatShortDate } from '../utils/format';
import {
  getPromoStatus,
  isNewMemberPromoEligible,
  validatePromoClaim,
  validateRewardRedemption,
} from '../utils/membershipProgram';
import { getMemberDiscountRate } from '../utils/posCalculations';
import { canManageMembershipProgram } from '../utils/rbac';

interface CustomersPageProps {
  searchQuery: string;
}

export function CustomersPage({ searchQuery }: CustomersPageProps) {
  const { user, authMode } = useAuth();
  const {
    customers,
    orders,
    membershipProgram,
    redemptionLogs,
    addCustomer,
    redeemMemberReward,
    claimMemberPromo,
  } = useStore();

  const isOwnerPromoManager = Boolean(user && canManageMembershipProgram(user.role));

  const [mainTab, setMainTab] = useState<'members' | 'program'>('members');
  const [tierFilter, setTierFilter] = useState<'all' | MemberTier>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Registration form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const effectiveTab = isOwnerPromoManager ? mainTab : 'members';

  const tierFilters = useMemo(() => {
    const getPct = (tier: MemberTier) =>
      Math.round(getMemberDiscountRate(tier, membershipProgram.tiers) * 100);
    return [
      { id: 'all' as const, label: 'Semua Tier' },
      { id: 'Platinum' as const, label: `Platinum (${getPct('Platinum')}%)` },
      { id: 'Gold' as const, label: `Gold (${getPct('Gold')}%)` },
      { id: 'Silver' as const, label: `Silver (${getPct('Silver')}%)` },
    ];
  }, [membershipProgram.tiers]);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return customers.filter((customer) => {
      const matchesTier = tierFilter === 'all' || customer.tier === tierFilter;
      const matchesSearch =
        !q ||
        customer.name.toLowerCase().includes(q) ||
        customer.phone_number.toLowerCase().includes(q) ||
        customer.email.toLowerCase().includes(q);
      return matchesTier && matchesSearch;
    });
  }, [customers, tierFilter, searchQuery]);

  const metrics = useMemo(() => {
    const totalMembers = customers.length;
    const vipMembers = customers.filter((c) => c.tier === 'Gold' || c.tier === 'Platinum').length;
    const totalPoints = customers.reduce((sum, c) => sum + c.points, 0);
    const activePromosCount = membershipProgram.promos.filter(
      (p) => getPromoStatus(p) === 'active'
    ).length;
    return { totalMembers, vipMembers, totalPoints, activePromosCount };
  }, [customers, membershipProgram.promos]);

  const selectedCustomer: Customer | null = useMemo(
    () => (selectedCustomerId ? customers.find((c) => c.id === selectedCustomerId) ?? null : null),
    [customers, selectedCustomerId]
  );

  const selectedCustomerOrders = useMemo(() => {
    if (!selectedCustomer) return [];
    return orders.filter((o) => o.customer_id === selectedCustomer.id);
  }, [orders, selectedCustomer]);

  const selectedCustomerRedemptions = useMemo(() => {
    if (!selectedCustomer) return [];
    return redemptionLogs.filter((l) => l.customer_id === selectedCustomer.id);
  }, [redemptionLogs, selectedCustomer]);

  const newMemberPromoActive = isNewMemberPromoEligible(membershipProgram.limits);

  const showBanner = (type: 'success' | 'error', text: string) => {
    setStatusBanner({ type, text });
    window.setTimeout(() => setStatusBanner(null), 5000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setErrorMsg('Nama pelanggan dan nomor WhatsApp wajib diisi.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    const created = await addCustomer({
      name,
      phone_number: phone,
      email,
      enableSupabaseSync: authMode === 'supabase',
    });
    setSaving(false);
    setName('');
    setPhone('');
    setEmail('');
    setShowAddForm(false);
    showBanner(
      'success',
      created.points > 0
        ? `Member "${created.name}" berhasil terdaftar dengan bonus ${created.points} poin dari Program Member Baru.`
        : `Member "${created.name}" berhasil terdaftar di Tier Silver.`
    );
  };

  const handleRedeemReward = (customerId: string, rewardId: string) => {
    const res = redeemMemberReward(customerId, rewardId);
    showBanner(res.ok ? 'success' : 'error', res.message);
  };

  const handleClaimPromo = (customerId: string, promoId: string) => {
    const res = claimMemberPromo(customerId, promoId);
    showBanner(res.ok ? 'success' : 'error', res.message);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#1A2E26]">Membership &amp; Program Promo</h1>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            Kelola pelanggan setia, penukaran produk gratis dengan poin, tier diskon, dan promo
            berkala.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isOwnerPromoManager && (
            <div
              role="tablist"
              aria-label="Menu Membership"
              className="inline-flex rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] p-1"
            >
              <button
                type="button"
                role="tab"
                data-testid="tab-membership-members"
                aria-selected={effectiveTab === 'members'}
                onClick={() => setMainTab('members')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  effectiveTab === 'members'
                    ? 'bg-[#E6F5EE] text-[#109A58]'
                    : 'text-[#6B7280] hover:text-[#1A2E26]'
                }`}
              >
                <Users className="h-3.5 w-3.5" />
                <span>Daftar Member</span>
              </button>
              <button
                type="button"
                role="tab"
                data-testid="tab-membership-program"
                aria-selected={effectiveTab === 'program'}
                onClick={() => setMainTab('program')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  effectiveTab === 'program'
                    ? 'bg-[#E6F5EE] text-[#109A58]'
                    : 'text-[#6B7280] hover:text-[#1A2E26]'
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Atur Promo &amp; Tier</span>
              </button>
            </div>
          )}

          {effectiveTab === 'members' && (
            <button
              type="button"
              onClick={() => setShowAddForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#109A58] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E] whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              <span>Daftar Member Baru</span>
            </button>
          )}
        </div>
      </div>

      {statusBanner && (
        <div
          role="status"
          data-testid="membership-status-banner"
          className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-semibold ${
            statusBanner.type === 'success'
              ? 'border-[#109A58]/30 bg-[#E6F5EE] text-[#109A58]'
              : 'border-[#EF4444]/30 bg-[#FEF2F2] text-[#EF4444]'
          }`}
        >
          <span className="flex items-center gap-2">
            {statusBanner.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {statusBanner.text}
          </span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            aria-label="Tutup pemberitahuan"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* OWNER-ONLY TAB: Program Promo, Tier, Produk Tukar Poin, Batas & Kuota */}
      {effectiveTab === 'program' && isOwnerPromoManager ? (
        <MembershipProgramPanel />
      ) : (
        <>
          {/* 4-Column Membership KPI Strip */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
              <p className="text-xs font-medium text-[#6B7280]">Total Member Aktif</p>
              <p className="mt-1.5 text-2xl font-bold text-[#1A2E26] tabular-nums">
                {metrics.totalMembers}
              </p>
              <p className="mt-1 text-[11px] text-[#6B7280]">Terdaftar di program loyalitas</p>
            </div>
            <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
              <p className="text-xs font-medium text-[#6B7280]">Member Gold &amp; Platinum</p>
              <p className="mt-1.5 text-2xl font-bold text-[#109A58] tabular-nums">
                {metrics.vipMembers}
              </p>
              <p className="mt-1 text-[11px] text-[#6B7280]">
                Batas tukar {membershipProgram.limits.max_free_products_per_day}x/hari ·{' '}
                {membershipProgram.limits.max_free_products_per_month}x/bulan
              </p>
            </div>
            <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
              <p className="text-xs font-medium text-[#6B7280]">Total Poin Aktif</p>
              <p className="mt-1.5 text-2xl font-bold text-[#1A2E26] tabular-nums">
                {metrics.totalPoints.toLocaleString('id-ID')} pts
              </p>
              <p className="mt-1 text-[11px] text-[#6B7280]">
                1 poin per {formatRupiah(membershipProgram.limits.point_earning_step_rupiah)}
              </p>
            </div>
            <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
              <p className="text-xs font-medium text-[#6B7280]">Program Promo Aktif</p>
              <p className="mt-1.5 text-2xl font-bold text-[#109A58] tabular-nums">
                {metrics.activePromosCount} promo
              </p>
              <p className="mt-1 text-[11px] text-[#6B7280]">
                {membershipProgram.rewards.filter((r) => r.is_active).length} produk tukar poin
                tersedia
              </p>
            </div>
          </div>

          {/* Registration Panel */}
          {showAddForm && (
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5"
              noValidate
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-[#1A2E26]">Registrasi Member Baru</h2>
                  <p className="mt-0.5 text-xs text-[#6B7280]">
                    {newMemberPromoActive
                      ? `${membershipProgram.limits.new_member_promo_title} — Bonus ${membershipProgram.limits.new_member_welcome_points} poin (Sisa kuota: ${Math.max(0, membershipProgram.limits.new_member_max_quota - membershipProgram.limits.new_member_claimed_count)} orang).`
                      : 'Member baru langsung aktif di layar Kasir / POS dengan Tier Silver.'}
                  </p>
                </div>
                {newMemberPromoActive && (
                  <span className="rounded-full bg-[#E6F5EE] px-3 py-1 text-[11px] font-semibold text-[#109A58]">
                    Promo Member Baru Aktif
                  </span>
                )}
              </div>
              {errorMsg && (
                <p role="alert" className="mt-2.5 text-xs font-medium text-[#EF4444]">
                  {errorMsg}
                </p>
              )}
              <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nama lengkap pelanggan"
                  aria-label="Nama lengkap pelanggan"
                  className="h-10 rounded-xl border border-[#E5E7EB] px-3.5 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="No. WhatsApp (08xx-xxxx-xxxx)"
                  aria-label="Nomor WhatsApp pelanggan"
                  className="h-10 rounded-xl border border-[#E5E7EB] px-3.5 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email (opsional)"
                  aria-label="Email pelanggan"
                  className="h-10 rounded-xl border border-[#E5E7EB] px-3.5 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>
              <div className="mt-3.5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="h-9 rounded-full border border-[#E5E7EB] px-4 text-xs font-semibold text-[#6B7280] hover:text-[#1A2E26]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-9 rounded-full bg-[#109A58] px-5 text-xs font-semibold text-white hover:bg-[#0D8A4E] disabled:opacity-50"
                >
                  {saving ? 'Menyimpan...' : 'Simpan Member'}
                </button>
              </div>
            </form>
          )}

          {/* Tier Filter Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="Filter Tier Member"
              className="inline-flex rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] p-1"
            >
              {tierFilters.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={tierFilter === tab.id}
                  onClick={() => setTierFilter(tab.id)}
                  className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    tierFilter === tab.id
                      ? 'bg-[#E6F5EE] text-[#109A58]'
                      : 'text-[#6B7280] hover:text-[#1A2E26]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <span className="text-xs text-[#6B7280] tabular-nums">
              Menampilkan {filteredCustomers.length} dari {customers.length} member
            </span>
          </div>

          {/* Customers Directory Table */}
          <div className="overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF]">
            {filteredCustomers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <Users className="h-9 w-9 text-[#6B7280]/50" />
                <p className="mt-3 text-sm font-semibold text-[#1A2E26]">Member tidak ditemukan</p>
                <p className="mt-1 text-xs text-[#6B7280]">
                  Ubah filter tier atau daftarkan pelanggan baru.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E5E7EB] bg-[#F4F6F5]/60 text-xs font-semibold text-[#6B7280]">
                      <th className="px-5 py-3.5">Pelanggan</th>
                      <th className="px-5 py-3.5">No. WhatsApp</th>
                      <th className="px-5 py-3.5">Tier &amp; Diskon</th>
                      <th className="px-5 py-3.5 text-right">Poin Aktif</th>
                      <th className="px-5 py-3.5 text-right">Total Belanja</th>
                      <th className="px-5 py-3.5 text-right">Bergabung</th>
                      <th className="px-5 py-3.5 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {filteredCustomers.map((customer) => {
                      const discPct = Math.round(
                        getMemberDiscountRate(customer.tier, membershipProgram.tiers) * 100
                      );
                      return (
                        <tr key={customer.id} className="hover:bg-[#F4F6F5]/50">
                          <td className="px-5 py-3.5">
                            <p className="text-xs font-semibold text-[#1A2E26]">{customer.name}</p>
                            <p className="text-[11px] text-[#6B7280]">{customer.email || '-'}</p>
                          </td>
                          <td className="px-5 py-3.5 font-mono text-xs text-[#1A2E26]">
                            {customer.phone_number}
                          </td>
                          <td className="px-5 py-3.5 text-xs">
                            <span className="font-semibold text-[#109A58]">{customer.tier}</span>
                            <span className="ml-1.5 text-[#6B7280]">· {discPct}%</span>
                          </td>
                          <td className="px-5 py-3.5 text-right text-xs font-bold text-[#1A2E26] tabular-nums">
                            {customer.points} pts
                          </td>
                          <td className="px-5 py-3.5 text-right text-xs font-semibold text-[#1A2E26] tabular-nums">
                            {formatRupiah(customer.total_spent)}
                          </td>
                          <td className="px-5 py-3.5 text-right text-xs text-[#6B7280] tabular-nums">
                            {formatShortDate(customer.created_at)}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <button
                              type="button"
                              onClick={() => setSelectedCustomerId(customer.id)}
                              className="text-xs font-semibold text-[#109A58] hover:underline whitespace-nowrap"
                            >
                              Detail &amp; Tukar Poin
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Member Detail, Dynamic Reward Redemption & Promo Claim Modal */}
      {selectedCustomer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label={`Detail Member ${selectedCustomer.name}`}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-[#E5E7EB] bg-[#FFFFFF] px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-[#1A2E26]">{selectedCustomer.name}</h2>
                <p className="text-xs text-[#6B7280]">
                  {selectedCustomer.phone_number} · Tier {selectedCustomer.tier} (Diskon{' '}
                  {Math.round(
                    getMemberDiscountRate(selectedCustomer.tier, membershipProgram.tiers) * 100
                  )}
                  %)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomerId(null)}
                aria-label="Tutup detail member"
                className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#F4F6F5]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 p-6">
              {/* Points Balance Summary */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] bg-[#E6F5EE]/60 p-4">
                <div>
                  <p className="text-xs text-[#6B7280]">Saldo Poin Loyalitas</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xl font-bold text-[#109A58] tabular-nums">
                    <Award className="h-5 w-5" />
                    {selectedCustomer.points} poin
                  </p>
                </div>
                <div className="text-right text-[11px] text-[#6B7280] tabular-nums">
                  <p>Min. tukar: {membershipProgram.limits.min_points_to_redeem} pts</p>
                  <p>
                    Batas gratis: {membershipProgram.limits.max_free_products_per_day}x/hari ·{' '}
                    {membershipProgram.limits.max_free_products_per_month}x/bulan
                  </p>
                </div>
              </div>

              {/* Dynamic Redeemable Products Catalog */}
              <div>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[#1A2E26]">
                  <Gift className="h-4 w-4 text-[#109A58]" />
                  <span>Tukar Poin dengan Produk Gratis</span>
                </h3>
                <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {membershipProgram.rewards
                    .filter((r) => r.is_active)
                    .map((reward) => {
                      const check = validateRewardRedemption({
                        customer: selectedCustomer,
                        reward,
                        limits: membershipProgram.limits,
                        logs: redemptionLogs,
                      });
                      const cost = Math.max(
                        reward.points_required,
                        membershipProgram.limits.min_points_to_redeem
                      );
                      return (
                        <div
                          key={reward.id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-[#E5E7EB] p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-[#1A2E26]">
                              {reward.menu_name}
                            </p>
                            <p className="text-[11px] text-[#6B7280] tabular-nums">
                              {cost} pts · Sisa {Math.max(0, reward.total_quota - reward.redeemed_count)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRedeemReward(selectedCustomer.id, reward.id)}
                            title={check.ok ? 'Tukar poin sekarang' : check.reason}
                            className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                              check.ok
                                ? 'bg-[#109A58] text-white hover:bg-[#0D8A4E]'
                                : 'bg-[#F4F6F5] text-[#6B7280]'
                            }`}
                          >
                            Tukar
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Active Membership Promos */}
              <div>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[#1A2E26]">
                  <Sparkles className="h-4 w-4 text-[#109A58]" />
                  <span>Promo Membership Tersedia</span>
                </h3>
                <div className="mt-2.5 space-y-2">
                  {membershipProgram.promos
                    .filter((p) => p.is_active)
                    .map((promo) => {
                      const check = validatePromoClaim({
                        customer: selectedCustomer,
                        promo,
                        logs: redemptionLogs,
                      });
                      const remainingQuota = Math.max(
                        0,
                        promo.max_customer_quota - promo.claimed_count
                      );
                      return (
                        <div
                          key={promo.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E5E7EB] bg-[#F4F6F5]/50 px-3.5 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-[#1A2E26]">{promo.title}</p>
                            <p className="text-[11px] text-[#6B7280] tabular-nums">
                              {promo.start_date} s/d {promo.end_date} · Sisa kuota {remainingQuota}{' '}
                              orang · Maks {promo.max_redemptions_per_member}x/member
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleClaimPromo(selectedCustomer.id, promo.id)}
                            title={check.ok ? 'Klaim promo untuk member ini' : check.reason}
                            className={`rounded-full px-3.5 py-1.5 text-[11px] font-semibold transition-colors ${
                              check.ok
                                ? 'bg-[#E6F5EE] text-[#109A58] hover:bg-[#D5EFE2]'
                                : 'bg-white text-[#6B7280]'
                            }`}
                          >
                            {check.ok ? 'Klaim Promo' : 'Tidak Memenuhi'}
                          </button>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Redemption History */}
              {selectedCustomerRedemptions.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-[#1A2E26]">
                    Riwayat Penukaran &amp; Klaim ({selectedCustomerRedemptions.length})
                  </h3>
                  <div className="mt-2 max-h-36 divide-y divide-[#E5E7EB] overflow-y-auto rounded-xl border border-[#E5E7EB]">
                    {selectedCustomerRedemptions.map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between px-3.5 py-2 text-xs"
                      >
                        <div>
                          <p className="font-medium text-[#1A2E26]">{log.label}</p>
                          <p className="text-[10px] text-[#6B7280]">
                            {formatDateTime(log.redeemed_at)}
                          </p>
                        </div>
                        {log.points_spent > 0 && (
                          <span className="font-bold text-[#EF4444] tabular-nums">
                            -{log.points_spent} pts
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Order History */}
              <div>
                <h3 className="flex items-center gap-1.5 text-xs font-semibold text-[#1A2E26]">
                  <ReceiptText className="h-4 w-4 text-[#109A58]" />
                  <span>Riwayat Transaksi ({selectedCustomerOrders.length})</span>
                </h3>

                {selectedCustomerOrders.length === 0 ? (
                  <p className="mt-2.5 rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] px-4 py-6 text-center text-xs text-[#6B7280]">
                    Belum ada transaksi tercatat pada sesi ini.
                  </p>
                ) : (
                  <div className="mt-2.5 max-h-44 divide-y divide-[#E5E7EB] overflow-y-auto rounded-xl border border-[#E5E7EB]">
                    {selectedCustomerOrders.map((ord) => (
                      <div
                        key={ord.id}
                        className="flex items-center justify-between px-4 py-3 text-xs"
                      >
                        <div>
                          <p className="font-mono font-semibold text-[#1A2E26]">
                            {ord.order_number}
                          </p>
                          <p className="text-[11px] text-[#6B7280]">
                            {formatDateTime(ord.created_at)} · {ord.items.length} menu
                          </p>
                        </div>
                        <span className="font-bold text-[#1A2E26] tabular-nums">
                          {formatRupiah(ord.total_amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
