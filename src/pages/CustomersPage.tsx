import React, { useMemo, useState } from 'react';
import { Award, CheckCircle2, Gift, Plus, ReceiptText, Users, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import type { Customer, MemberTier } from '../types';
import { formatDateTime, formatRupiah, formatShortDate } from '../utils/format';
import { getMemberDiscountRate } from '../utils/posCalculations';

interface CustomersPageProps {
  searchQuery: string;
}

const TIER_FILTERS: Array<{ id: 'all' | MemberTier; label: string }> = [
  { id: 'all', label: 'Semua Tier' },
  { id: 'Platinum', label: 'Platinum (15%)' },
  { id: 'Gold', label: 'Gold (10%)' },
  { id: 'Silver', label: 'Silver (5%)' },
];

export function CustomersPage({ searchQuery }: CustomersPageProps) {
  const { authMode } = useAuth();
  const { customers, orders, addCustomer, adjustCustomerPoints } = useStore();

  const [tierFilter, setTierFilter] = useState<'all' | MemberTier>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  // Registration form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

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
    const totalMemberSpend = customers.reduce((sum, c) => sum + c.total_spent, 0);
    return { totalMembers, vipMembers, totalPoints, totalMemberSpend };
  }, [customers]);

  const selectedCustomer: Customer | null = useMemo(
    () => (selectedCustomerId ? customers.find((c) => c.id === selectedCustomerId) ?? null : null),
    [customers, selectedCustomerId]
  );

  const selectedCustomerOrders = useMemo(() => {
    if (!selectedCustomer) return [];
    return orders.filter((o) => o.customer_id === selectedCustomer.id);
  }, [orders, selectedCustomer]);

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
    setStatusBanner(`Member "${created.name}" berhasil terdaftar dengan bonus 20 poin.`);
    window.setTimeout(() => setStatusBanner(null), 4500);
  };

  const handleRedeemPoints = (customer: Customer, cost: number, rewardName: string) => {
    if (customer.points < cost) return;
    adjustCustomerPoints(customer.id, -cost);
    setStatusBanner(
      `${customer.name} menukarkan ${cost} poin untuk ${rewardName}.`
    );
    window.setTimeout(() => setStatusBanner(null), 4500);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 lg:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[#1A2E26]">Membership &amp; Loyalitas</h1>
          <p className="mt-0.5 text-sm text-[#6B7280]">
            Kelola pelanggan setia, perolehan poin otomatis dari kasir POS, dan riwayat belanja.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAddForm((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#109A58] px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-[#0D8A4E] whitespace-nowrap"
        >
          <Plus className="h-4 w-4" />
          <span>Daftar Member Baru</span>
        </button>
      </div>

      {statusBanner && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-[#109A58]/30 bg-[#E6F5EE] px-4 py-3 text-xs font-semibold text-[#109A58]"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {statusBanner}
          </span>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            aria-label="Tutup pemberitahuan"
            className="text-[#109A58] hover:text-[#0D8A4E]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

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
          <p className="mt-1 text-[11px] text-[#6B7280]">Diskon transaksi 10% – 15%</p>
        </div>
        <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
          <p className="text-xs font-medium text-[#6B7280]">Total Poin Aktif</p>
          <p className="mt-1.5 text-2xl font-bold text-[#1A2E26] tabular-nums">
            {metrics.totalPoints.toLocaleString('id-ID')} pts
          </p>
          <p className="mt-1 text-[11px] text-[#6B7280]">1 poin per belanja Rp 10.000</p>
        </div>
        <div className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
          <p className="text-xs font-medium text-[#6B7280]">Akumulasi Belanja Member</p>
          <p className="mt-1.5 text-2xl font-bold text-[#1A2E26] tabular-nums">
            {formatRupiah(metrics.totalMemberSpend)}
          </p>
          <p className="mt-1 text-[11px] text-[#6B7280]">Total nilai transaksi member</p>
        </div>
      </div>

      {/* Registration Panel */}
      {showAddForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-5"
          noValidate
        >
          <h2 className="text-sm font-semibold text-[#1A2E26]">Registrasi Member Baru</h2>
          <p className="mt-0.5 text-xs text-[#6B7280]">
            Member baru langsung aktif di layar Kasir / POS dengan Tier Silver (5%) dan 20 poin.
          </p>
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
          {TIER_FILTERS.map((tab) => (
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
                  const discPct = Math.round(getMemberDiscountRate(customer.tier) * 100);
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
                          Detail &amp; Poin
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

      {/* Member Detail & Point Redemption Modal */}
      {selectedCustomer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label={`Detail Member ${selectedCustomer.name}`}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-[#1A2E26]">{selectedCustomer.name}</h2>
                <p className="text-xs text-[#6B7280]">
                  {selectedCustomer.phone_number} · Tier {selectedCustomer.tier}
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
              {/* Points Balance & Quick Redeem */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] bg-[#E6F5EE]/60 p-4">
                <div>
                  <p className="text-xs text-[#6B7280]">Saldo Poin Loyalitas</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xl font-bold text-[#109A58] tabular-nums">
                    <Award className="h-5 w-5" />
                    {selectedCustomer.points} poin
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={selectedCustomer.points < 50}
                    onClick={() =>
                      handleRedeemPoints(selectedCustomer, 50, 'Voucher Gratis Americano')
                    }
                    className="inline-flex items-center gap-1.5 rounded-full bg-[#109A58] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0D8A4E] disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
                  >
                    <Gift className="h-3.5 w-3.5" />
                    <span>Tukar 50 Poin (Gratis Kopi)</span>
                  </button>
                </div>
              </div>

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
                  <div className="mt-2.5 max-h-52 divide-y divide-[#E5E7EB] overflow-y-auto rounded-xl border border-[#E5E7EB]">
                    {selectedCustomerOrders.map((ord) => (
                      <div key={ord.id} className="flex items-center justify-between px-4 py-3 text-xs">
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
