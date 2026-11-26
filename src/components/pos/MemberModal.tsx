import React, { useMemo, useState } from 'react';
import { Award, Search, UserPlus, Users, X } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import type { Customer } from '../../types';
import { getMemberDiscountRate } from '../../utils/posCalculations';

interface MemberModalProps {
  isOpen: boolean;
  customers: Customer[];
  selectedCustomerId: string | null;
  onClose: () => void;
  onSelectCustomer: (customer: Customer) => void;
  onCreateCustomer: (input: {
    name: string;
    phone_number: string;
    email: string;
  }) => Promise<Customer>;
}

export function MemberModal({
  isOpen,
  customers,
  selectedCustomerId,
  onClose,
  onSelectCustomer,
  onCreateCustomer,
}: MemberModalProps) {
  const { membershipProgram } = useStore();
  const [activeTab, setActiveTab] = useState<'select' | 'register'>('select');
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone_number.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q)
    );
  }, [customers, search]);

  if (!isOpen) return null;

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      setErrorMsg('Nama lengkap dan nomor WhatsApp wajib diisi.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    const created = await onCreateCustomer({
      name,
      phone_number: phone,
      email,
    });
    setSaving(false);
    setName('');
    setPhone('');
    setEmail('');
    onSelectCustomer(created);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-label="Pilih atau Daftar Member Pelanggan"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-[#1A2E26]">Member Pelanggan</h3>
            <p className="mt-0.5 text-xs text-[#6B7280]">
              Pilih member untuk menerapkan diskon otomatis &amp; akumulasi poin.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup modal member"
            className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#F4F6F5] hover:text-[#1A2E26]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="border-b border-[#E5E7EB] px-6 py-3">
          <div role="tablist" className="grid grid-cols-2 gap-1.5 rounded-xl bg-[#F4F6F5] p-1">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'select'}
              onClick={() => setActiveTab('select')}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                activeTab === 'select'
                  ? 'bg-[#FFFFFF] text-[#109A58] shadow-xs'
                  : 'text-[#6B7280] hover:text-[#1A2E26]'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              <span>Pilih Member ({customers.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'register'}
              onClick={() => setActiveTab('register')}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                activeTab === 'register'
                  ? 'bg-[#FFFFFF] text-[#109A58] shadow-xs'
                  : 'text-[#6B7280] hover:text-[#1A2E26]'
              }`}
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>Daftar Member Baru</span>
            </button>
          </div>
        </div>

        {activeTab === 'select' ? (
          <div className="p-6">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama atau nomor WhatsApp..."
                aria-label="Cari member pelanggan"
                className="h-10 w-full rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] pl-10 pr-3.5 text-sm text-[#1A2E26] placeholder:text-[#6B7280] focus:border-[#109A58] focus:bg-[#FFFFFF] focus:outline-none"
              />
            </div>

            <div className="mt-4 max-h-64 divide-y divide-[#E5E7EB] overflow-y-auto rounded-xl border border-[#E5E7EB]">
              {filteredCustomers.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-xs font-medium text-[#1A2E26]">Member tidak ditemukan</p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('register')}
                    className="mt-2 text-xs font-semibold text-[#109A58] hover:underline"
                  >
                    + Daftarkan pelanggan baru
                  </button>
                </div>
              ) : (
                filteredCustomers.map((customer) => {
                  const isSelected = customer.id === selectedCustomerId;
                  const discPct = Math.round(
                    getMemberDiscountRate(customer.tier, membershipProgram.tiers) * 100
                  );
                  return (
                    <button
                      key={customer.id}
                      type="button"
                      onClick={() => {
                        onSelectCustomer(customer);
                        onClose();
                      }}
                      className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${
                        isSelected ? 'bg-[#E6F5EE]' : 'hover:bg-[#F4F6F5]'
                      }`}
                    >
                      <div className="min-w-0 pr-3">
                        <p className="text-sm font-semibold text-[#1A2E26]">{customer.name}</p>
                        <p className="mt-0.5 text-xs text-[#6B7280]">
                          {customer.phone_number} · Tier {customer.tier} (Diskon {discPct}%)
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-[#109A58] tabular-nums">
                          <Award className="h-3.5 w-3.5" />
                          {customer.points} pts
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <form onSubmit={handleRegister} className="space-y-4 p-6" noValidate>
            {errorMsg && (
              <p role="alert" className="rounded-xl bg-[#FEF2F2] px-3.5 py-2.5 text-xs text-[#B91C1C]">
                {errorMsg}
              </p>
            )}

            <div>
              <label htmlFor="modal-member-name" className="block text-xs font-semibold text-[#1A2E26]">
                Nama Lengkap
              </label>
              <input
                id="modal-member-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Misal: Dina Lestari"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3.5 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="modal-member-phone" className="block text-xs font-semibold text-[#1A2E26]">
                Nomor WhatsApp
              </label>
              <input
                id="modal-member-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0812-xxxx-xxxx"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3.5 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="modal-member-email" className="block text-xs font-semibold text-[#1A2E26]">
                Email (Opsional)
              </label>
              <input
                id="modal-member-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="pelanggan@email.com"
                className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3.5 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div className="rounded-xl bg-[#E6F5EE]/70 px-3.5 py-2.5 text-xs text-[#109A58]">
              Member baru langsung mendapatkan <strong>Tier Silver (Diskon 5%)</strong> dan bonus{' '}
              <strong>20 poin</strong> selamat datang.
            </div>

            <div className="flex items-center gap-2.5 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="h-10 flex-1 rounded-full border border-[#E5E7EB] bg-[#FFFFFF] text-xs font-semibold text-[#6B7280] hover:text-[#1A2E26]"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={saving}
                className="h-10 flex-1 rounded-full bg-[#109A58] text-xs font-semibold text-white hover:bg-[#0D8A4E] disabled:opacity-50"
              >
                {saving ? 'Mendaftarkan...' : 'Simpan & Pilih Member'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
