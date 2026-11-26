import { useMemo, useState } from 'react';
import {
  Check,
  Clock,
  Copy,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Ticket,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import type { VoucherRecord, VoucherSchemeType } from '../types';
import { formatRupiah } from '../utils/format';
import { canManageVouchers } from '../utils/rbac';
import {
  DAY_LABELS_SHORT,
  RUSH_HOUR_PRESETS,
  VOUCHER_SCHEME_LABELS,
  formatDateIdShort,
  formatLocalDateKey,
  formatVoucherDaysSummary,
  formatVoucherSchemeSummary,
  generateBatchVoucherCodes,
  generateVoucherCode,
  getVoucherAvailability,
  normalizeVoucherCode,
} from '../utils/vouchers';

interface VouchersPageProps {
  searchQuery: string;
}

type StatusFilter = 'all' | 'active_now' | 'rush_hour' | 'scheduled' | 'inactive';

interface VoucherFormState {
  mode: 'single' | 'batch';
  code: string;
  batchPrefix: string;
  batchCount: number;
  title: string;
  description: string;
  scheme_type: VoucherSchemeType;
  discount_percent: number;
  max_discount_amount: number;
  discount_amount: number;
  special_price: number;
  buy_quantity: number;
  free_quantity: number;
  bundle_quantity: number;
  bundle_price: number;
  target_menu_ids: string[];
  min_purchase_amount: number;
  valid_from_date: string;
  valid_until_date: string;
  start_time: string;
  end_time: string;
  active_days: number[];
  max_usage_quota: number;
  stackable_with_member_discount: boolean;
  is_rush_hour: boolean;
  is_active: boolean;
}

function buildDefaultFormState(): VoucherFormState {
  const today = new Date();
  const nextMonth = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30);
  return {
    mode: 'single',
    code: generateVoucherCode('RUSH', 6),
    batchPrefix: 'RUSH',
    batchCount: 5,
    title: '',
    description: '',
    scheme_type: 'percentage_discount',
    discount_percent: 20,
    max_discount_amount: 15000,
    discount_amount: 10000,
    special_price: 18000,
    buy_quantity: 1,
    free_quantity: 1,
    bundle_quantity: 2,
    bundle_price: 39000,
    target_menu_ids: [],
    min_purchase_amount: 0,
    valid_from_date: formatLocalDateKey(today),
    valid_until_date: formatLocalDateKey(nextMonth),
    start_time: '07:00',
    end_time: '10:00',
    active_days: [1, 2, 3, 4, 5],
    max_usage_quota: 50,
    stackable_with_member_discount: false,
    is_rush_hour: true,
    is_active: true,
  };
}

export function VouchersPage({ searchQuery }: VouchersPageProps) {
  const { user } = useAuth();
  const {
    vouchers,
    menus,
    addVoucher,
    addVoucherBatch,
    updateVoucher,
    toggleVoucherActive,
    deleteVoucher,
  } = useStore();

  const canManage = user ? canManageVouchers(user.role) : false;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [schemeFilter, setSchemeFilter] = useState<VoucherSchemeType | 'all'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [recentBatchCodes, setRecentBatchCodes] = useState<string[]>([]);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVoucherId, setEditingVoucherId] = useState<string | null>(null);
  const [form, setForm] = useState<VoucherFormState>(buildDefaultFormState);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const now = new Date();

  const evaluatedList = useMemo(
    () =>
      vouchers.map((voucher) => ({
        voucher,
        availability: getVoucherAvailability(voucher, now),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vouchers]
  );

  const stats = useMemo(() => {
    const activeNowCount = evaluatedList.filter((item) => item.availability.active).length;
    const rushHourCount = vouchers.filter((v) => v.is_rush_hour).length;
    const totalUsed = vouchers.reduce((sum, v) => sum + (v.used_count || 0), 0);
    return {
      total: vouchers.length,
      activeNowCount,
      rushHourCount,
      totalUsed,
    };
  }, [evaluatedList, vouchers]);

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return evaluatedList.filter(({ voucher, availability }) => {
      if (statusFilter === 'active_now' && !availability.active) return false;
      if (statusFilter === 'rush_hour' && !voucher.is_rush_hour) return false;
      if (statusFilter === 'scheduled' && availability.status !== 'scheduled') return false;
      if (
        statusFilter === 'inactive' &&
        !['inactive', 'expired', 'quota_exhausted'].includes(availability.status)
      ) {
        return false;
      }
      if (schemeFilter !== 'all' && voucher.scheme_type !== schemeFilter) return false;
      if (!q) return true;
      return (
        voucher.code.toLowerCase().includes(q) ||
        voucher.title.toLowerCase().includes(q) ||
        voucher.description.toLowerCase().includes(q)
      );
    });
  }, [evaluatedList, statusFilter, schemeFilter, searchQuery]);

  const showToast = (msg: string) => {
    setFeedbackBanner(msg);
    window.setTimeout(() => setFeedbackBanner(null), 5000);
  };

  const handleCopyCode = async (voucher: VoucherRecord) => {
    try {
      await navigator.clipboard.writeText(voucher.code);
      setCopiedId(voucher.id);
      window.setTimeout(() => setCopiedId((prev) => (prev === voucher.id ? null : prev)), 1800);
    } catch {
      showToast(`Kode voucher: ${voucher.code}`);
    }
  };

  const handleCopyAllBatch = async () => {
    if (recentBatchCodes.length === 0) return;
    try {
      await navigator.clipboard.writeText(recentBatchCodes.join('\n'));
      showToast(`${recentBatchCodes.length} kode voucher berhasil disalin ke clipboard.`);
    } catch {
      // Ignore clipboard restriction
    }
  };

  const openCreateModal = () => {
    setEditingVoucherId(null);
    setForm(buildDefaultFormState());
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (voucher: VoucherRecord) => {
    setEditingVoucherId(voucher.id);
    setForm({
      mode: 'single',
      code: voucher.code,
      batchPrefix: 'RUSH',
      batchCount: 5,
      title: voucher.title,
      description: voucher.description,
      scheme_type: voucher.scheme_type,
      discount_percent: voucher.discount_percent ?? 20,
      max_discount_amount: voucher.max_discount_amount ?? 0,
      discount_amount: voucher.discount_amount ?? 10000,
      special_price: voucher.special_price ?? 18000,
      buy_quantity: voucher.buy_quantity ?? 1,
      free_quantity: voucher.free_quantity ?? 1,
      bundle_quantity: voucher.bundle_quantity ?? 2,
      bundle_price: voucher.bundle_price ?? 39000,
      target_menu_ids: voucher.target_menu_ids ?? [],
      min_purchase_amount: voucher.min_purchase_amount ?? 0,
      valid_from_date: voucher.valid_from_date,
      valid_until_date: voucher.valid_until_date,
      start_time: voucher.start_time,
      end_time: voucher.end_time,
      active_days: voucher.active_days?.length ? voucher.active_days : [0, 1, 2, 3, 4, 5, 6],
      max_usage_quota: voucher.max_usage_quota ?? 0,
      stackable_with_member_discount: voucher.stackable_with_member_discount ?? false,
      is_rush_hour: voucher.is_rush_hour ?? true,
      is_active: voucher.is_active,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const toggleDay = (dayIndex: number) => {
    setForm((prev) => {
      const exists = prev.active_days.includes(dayIndex);
      const next = exists
        ? prev.active_days.filter((d) => d !== dayIndex)
        : [...prev.active_days, dayIndex].sort((a, b) => a - b);
      return { ...prev, active_days: next };
    });
  };

  const toggleTargetMenu = (menuId: string) => {
    setForm((prev) => {
      const exists = prev.target_menu_ids.includes(menuId);
      return {
        ...prev,
        target_menu_ids: exists
          ? prev.target_menu_ids.filter((id) => id !== menuId)
          : [...prev.target_menu_ids, menuId],
      };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!form.title.trim()) {
      setFormError('Nama program voucher wajib diisi.');
      return;
    }
    if (!form.valid_from_date || !form.valid_until_date || form.valid_from_date > form.valid_until_date) {
      setFormError('Rentang tanggal berlaku tidak valid (tanggal mulai harus <= tanggal berakhir).');
      return;
    }
    if (form.active_days.length === 0) {
      setFormError('Pilih minimal 1 hari aktif untuk voucher ini.');
      return;
    }
    if (form.scheme_type === 'percentage_discount' && (form.discount_percent <= 0 || form.discount_percent > 100)) {
      setFormError('Persentase diskon harus antara 1% sampai 100%.');
      return;
    }
    if (form.scheme_type === 'fixed_discount' && form.discount_amount <= 0) {
      setFormError('Nominal potongan harga harus lebih besar dari Rp 0.');
      return;
    }
    if (form.scheme_type === 'special_item_price' && form.special_price <= 0) {
      setFormError('Harga spesial item harus lebih besar dari Rp 0.');
      return;
    }
    if (form.scheme_type === 'bundle_price' && (form.bundle_quantity < 2 || form.bundle_price <= 0)) {
      setFormError('Harga paket membutuhkan minimal 2 item dan nominal harga paket > Rp 0.');
      return;
    }

    const template = {
      title: form.title.trim(),
      description: form.description.trim(),
      scheme_type: form.scheme_type,
      discount_percent: form.scheme_type === 'percentage_discount' ? Number(form.discount_percent) : 0,
      max_discount_amount:
        form.scheme_type === 'percentage_discount' ? Math.max(0, Number(form.max_discount_amount) || 0) : 0,
      discount_amount: form.scheme_type === 'fixed_discount' ? Number(form.discount_amount) : 0,
      special_price: form.scheme_type === 'special_item_price' ? Number(form.special_price) : 0,
      buy_quantity: form.scheme_type === 'buy_x_get_y' ? Math.max(1, Number(form.buy_quantity) || 1) : 1,
      free_quantity: form.scheme_type === 'buy_x_get_y' ? Math.max(1, Number(form.free_quantity) || 1) : 1,
      bundle_quantity: form.scheme_type === 'bundle_price' ? Math.max(2, Number(form.bundle_quantity) || 2) : 2,
      bundle_price: form.scheme_type === 'bundle_price' ? Number(form.bundle_price) : 0,
      target_menu_ids: form.target_menu_ids,
      min_purchase_amount: Math.max(0, Number(form.min_purchase_amount) || 0),
      valid_from_date: form.valid_from_date,
      valid_until_date: form.valid_until_date,
      start_time: form.start_time || '00:00',
      end_time: form.end_time || '23:59',
      active_days: form.active_days,
      max_usage_quota: Math.max(0, Number(form.max_usage_quota) || 0),
      stackable_with_member_discount: form.stackable_with_member_discount,
      is_rush_hour: form.is_rush_hour,
      is_active: form.is_active,
      created_by_name: user?.full_name || 'Owner',
    };

    setSubmitting(true);
    try {
      if (editingVoucherId) {
        const res = await updateVoucher(editingVoucherId, {
          ...template,
          code: normalizeVoucherCode(form.code),
        });
        if (!res.ok) {
          setFormError(res.error || 'Gagal memperbarui voucher.');
          return;
        }
        setModalOpen(false);
        showToast(`Voucher ${normalizeVoucherCode(form.code)} berhasil diperbarui.`);
        return;
      }

      if (form.mode === 'batch') {
        const safeCount = Math.max(2, Math.min(50, Number(form.batchCount) || 5));
        const codes = generateBatchVoucherCodes(
          form.batchPrefix || 'RUSH',
          safeCount,
          vouchers.map((v) => v.code),
          6
        );
        const batchRes = await addVoucherBatch(codes, template);
        if (!batchRes.ok) {
          setFormError('Gagal men-generate batch voucher.');
          return;
        }
        setRecentBatchCodes(batchRes.vouchers.map((v) => v.code));
        setModalOpen(false);
        showToast(`${batchRes.count} kode voucher unik berhasil dibuat untuk "${template.title}".`);
        return;
      }

      const cleanCode = normalizeVoucherCode(form.code);
      if (cleanCode.length < 3) {
        setFormError('Kode voucher minimal 3 karakter.');
        return;
      }
      const res = await addVoucher({
        ...template,
        code: cleanCode,
      });
      if (!res.ok) {
        setFormError(res.error || 'Gagal menambahkan voucher.');
        return;
      }
      setRecentBatchCodes([]);
      setModalOpen(false);
      showToast(`Voucher ${cleanCode} siap digunakan pada jadwal ${template.start_time}–${template.end_time}.`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-8">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#1A2E26]">
            Voucher &amp; Promo Rush Hour
          </h1>
          <p className="mt-1 text-sm text-[#6B7280]">
            Buat kode voucher otomatis dengan jadwal tanggal &amp; jam khusus, potongan harga, harga spesial menu, hingga paket bundling.
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={openCreateModal}
            data-testid="create-voucher-button"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#109A58] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#0D8A4E] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>Buat / Generate Voucher</span>
          </button>
        )}
      </div>

      {/* Feedback Banner */}
      {feedbackBanner && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-[#109A58]/30 bg-[#E6F5EE] px-4 py-3 text-sm font-medium text-[#109A58]"
        >
          <span>{feedbackBanner}</span>
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

      {/* Recent Batch Generated Codes Strip */}
      {recentBatchCodes.length > 0 && (
        <section className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[#1A2E26]">
                Hasil Generate Massal ({recentBatchCodes.length} kode baru)
              </h2>
              <p className="text-xs text-[#6B7280]">
                Salin seluruh kode di bawah untuk dibagikan ke pelanggan atau dicetak sebagai kupon Rush Hour.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyAllBatch}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#109A58]/40 bg-[#E6F5EE] px-3 text-xs font-semibold text-[#109A58] hover:bg-[#D5EFE2] whitespace-nowrap"
              >
                <Copy className="h-3.5 w-3.5" />
                <span>Salin Semua Kode</span>
              </button>
              <button
                type="button"
                onClick={() => setRecentBatchCodes([])}
                aria-label="Tutup daftar kode baru"
                className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#F4F6F5] hover:text-[#1A2E26]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {recentBatchCodes.map((code) => (
              <span
                key={code}
                className="rounded-lg border border-[#E5E7EB] bg-[#F4F6F5] px-2.5 py-1 font-mono text-xs font-semibold text-[#1A2E26] tabular-nums"
              >
                {code}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* 4-Column Summary Strip (Single Elevation, Hairline Dividers) */}
      <section
        aria-label="Ringkasan Voucher"
        className="grid grid-cols-2 divide-y divide-[#E5E7EB] rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] sm:grid-cols-4 sm:divide-x sm:divide-y-0"
      >
        <div className="p-5">
          <p className="text-xs font-medium text-[#6B7280]">Aktif Saat Ini</p>
          <p className="mt-1.5 text-2xl font-bold text-[#109A58] tabular-nums">
            {stats.activeNowCount}
          </p>
          <p className="mt-0.5 text-xs text-[#6B7280]">Sesuai tanggal &amp; jam sekarang</p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-[#6B7280]">Promo Rush Hour</p>
          <p className="mt-1.5 text-2xl font-bold text-[#1A2E26] tabular-nums">
            {stats.rushHourCount}
          </p>
          <p className="mt-0.5 text-xs text-[#6B7280]">Terjadwal per rentang jam</p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-[#6B7280]">Total Penukaran</p>
          <p className="mt-1.5 text-2xl font-bold text-[#1A2E26] tabular-nums">
            {stats.totalUsed}x
          </p>
          <p className="mt-0.5 text-xs text-[#6B7280]">Digunakan di transaksi POS</p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-[#6B7280]">Total Kode Voucher</p>
          <p className="mt-1.5 text-2xl font-bold text-[#1A2E26] tabular-nums">
            {stats.total}
          </p>
          <p className="mt-0.5 text-xs text-[#6B7280]">Semua skema terdaftar</p>
        </div>
      </section>

      {/* Filter Bar + Data Table */}
      <section className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF]">
        <div className="flex flex-col gap-3 border-b border-[#E5E7EB] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div
            role="tablist"
            aria-label="Filter Status Voucher"
            className="flex items-center gap-1 overflow-x-auto rounded-lg bg-[#F4F6F5] p-1"
          >
            {(
              [
                { id: 'all', label: 'Semua' },
                { id: 'active_now', label: 'Aktif Sekarang' },
                { id: 'rush_hour', label: 'Rush Hour' },
                { id: 'scheduled', label: 'Terjadwal' },
                { id: 'inactive', label: 'Berakhir / Nonaktif' },
              ] as const
            ).map((tab) => {
              const active = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-[#FFFFFF] text-[#1A2E26] shadow-xs'
                      : 'text-[#6B7280] hover:text-[#1A2E26]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="voucher-scheme-filter" className="text-xs font-medium text-[#6B7280] whitespace-nowrap">
              Skema:
            </label>
            <select
              id="voucher-scheme-filter"
              value={schemeFilter}
              onChange={(e) => setSchemeFilter(e.target.value as VoucherSchemeType | 'all')}
              className="h-9 rounded-lg border border-[#E5E7EB] bg-[#FFFFFF] px-3 text-xs font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            >
              <option value="all">Semua Skema</option>
              {(Object.keys(VOUCHER_SCHEME_LABELS) as VoucherSchemeType[]).map((key) => (
                <option key={key} value={key}>
                  {VOUCHER_SCHEME_LABELS[key]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredList.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <Ticket className="mx-auto h-10 w-10 text-[#6B7280]/40" />
            <p className="mt-3 text-sm font-semibold text-[#1A2E26]">
              Belum ada voucher sesuai filter
            </p>
            <p className="mt-1 text-xs text-[#6B7280]">
              Ubah filter pencarian atau buat kode voucher Rush Hour baru untuk pelanggan Anda.
            </p>
            {canManage && (
              <button
                type="button"
                onClick={openCreateModal}
                className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#109A58] px-4 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Buat Voucher Pertama</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-xs font-semibold text-[#6B7280]">
                  <th className="px-4 py-3">Kode Voucher</th>
                  <th className="px-4 py-3">Program &amp; Skema</th>
                  <th className="px-4 py-3">Jadwal &amp; Jam Berlaku</th>
                  <th className="px-4 py-3 text-right">Kuota</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {filteredList.map(({ voucher, availability }) => {
                  const statusColor =
                    availability.status === 'active'
                      ? 'text-[#109A58]'
                      : availability.status === 'outside_hours' ||
                          availability.status === 'outside_day' ||
                          availability.status === 'scheduled'
                        ? 'text-[#D97706]'
                        : 'text-[#DC2626]';

                  return (
                    <tr key={voucher.id} className="transition-colors hover:bg-[#F9FAFB]">
                      <td className="px-4 py-3.5 align-top">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-[#1A2E26] tabular-nums">
                            {voucher.code}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleCopyCode(voucher)}
                            title="Salin kode voucher"
                            aria-label={`Salin kode ${voucher.code}`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[#E5E7EB] text-[#6B7280] transition-colors hover:border-[#109A58] hover:text-[#109A58]"
                          >
                            {copiedId === voucher.id ? (
                              <Check className="h-3.5 w-3.5 text-[#109A58]" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                        <p className="mt-1 text-xs text-[#6B7280]">
                          {voucher.is_rush_hour ? 'Rush Hour' : 'Promo Reguler'}
                          {voucher.stackable_with_member_discount ? ' · Gabung Member' : ' · Non-Gabung'}
                        </p>
                      </td>

                      <td className="px-4 py-3.5 align-top">
                        <p className="font-semibold text-[#1A2E26]">{voucher.title}</p>
                        <p className="mt-0.5 text-xs text-[#109A58] font-medium">
                          {formatVoucherSchemeSummary(voucher, menus)}
                        </p>
                        {voucher.min_purchase_amount > 0 && (
                          <p className="mt-0.5 text-xs text-[#6B7280] tabular-nums">
                            Min. belanja {formatRupiah(voucher.min_purchase_amount)}
                          </p>
                        )}
                      </td>

                      <td className="px-4 py-3.5 align-top text-xs text-[#1A2E26]">
                        <p className="font-medium tabular-nums whitespace-nowrap">
                          {formatDateIdShort(voucher.valid_from_date)} – {formatDateIdShort(voucher.valid_until_date)}
                        </p>
                        <p className="mt-0.5 text-[#6B7280] tabular-nums">
                          Jam {voucher.start_time}–{voucher.end_time} · {formatVoucherDaysSummary(voucher.active_days)}
                        </p>
                      </td>

                      <td className="px-4 py-3.5 text-right align-top font-mono text-xs text-[#1A2E26] tabular-nums whitespace-nowrap">
                        {voucher.max_usage_quota > 0
                          ? `${voucher.used_count} / ${voucher.max_usage_quota}`
                          : `${voucher.used_count} / ∞`}
                      </td>

                      <td className="px-4 py-3.5 align-top">
                        <p className={`text-xs font-semibold ${statusColor}`}>
                          {availability.label}
                        </p>
                        {availability.reason && (
                          <p className="mt-0.5 max-w-[200px] text-[11px] leading-snug text-[#6B7280]">
                            {availability.reason}
                          </p>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-right align-top">
                        <div className="inline-flex items-center gap-1.5">
                          {canManage ? (
                            <>
                              <button
                                type="button"
                                onClick={() => toggleVoucherActive(voucher.id)}
                                className="rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 text-xs font-medium text-[#1A2E26] hover:border-[#109A58] hover:text-[#109A58] whitespace-nowrap"
                              >
                                {voucher.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(voucher)}
                                aria-label={`Edit voucher ${voucher.code}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] text-[#6B7280] hover:border-[#109A58] hover:text-[#109A58]"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  deleteVoucher(voucher.id);
                                  showToast(`Voucher ${voucher.code} telah dihapus.`);
                                }}
                                aria-label={`Hapus voucher ${voucher.code}`}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] text-[#6B7280] hover:border-[#EF4444] hover:text-[#EF4444]"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleCopyCode(voucher)}
                              className="rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-xs font-semibold text-[#109A58] hover:bg-[#E6F5EE] whitespace-nowrap"
                            >
                              {copiedId === voucher.id ? 'Tersalin' : 'Salin Kode'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create / Generate / Edit Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A2E26]/45 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-label="Form Generator Voucher Rush Hour"
        >
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-[#1A2E26]">
                  {editingVoucherId ? 'Edit Voucher Promo' : 'Generate Kode Voucher & Rush Hour'}
                </h2>
                <p className="mt-0.5 text-xs text-[#6B7280]">
                  Atur kode, skema promo, tanggal berlaku, dan jam Rush Hour.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Tutup modal voucher"
                className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#F4F6F5] hover:text-[#1A2E26]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {formError && (
                <div
                  role="alert"
                  className="rounded-xl border border-[#EF4444]/30 bg-[#FEF2F2] px-3.5 py-2.5 text-xs font-medium text-[#B91C1C]"
                >
                  {formError}
                </div>
              )}

              {/* Mode Switcher (Create only) */}
              {!editingVoucherId && (
                <div>
                  <label className="block text-xs font-semibold text-[#1A2E26]">
                    Mode Pembuatan Kode
                  </label>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 rounded-xl bg-[#F4F6F5] p-1">
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, mode: 'single' }))}
                      className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                        form.mode === 'single'
                          ? 'bg-[#FFFFFF] text-[#109A58] shadow-xs'
                          : 'text-[#6B7280] hover:text-[#1A2E26]'
                      }`}
                    >
                      <Ticket className="h-3.5 w-3.5" />
                      <span>1 Kode Voucher</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, mode: 'batch' }))}
                      className={`flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                        form.mode === 'batch'
                          ? 'bg-[#FFFFFF] text-[#109A58] shadow-xs'
                          : 'text-[#6B7280] hover:text-[#1A2E26]'
                      }`}
                    >
                      <Layers className="h-3.5 w-3.5" />
                      <span>Generate Massal (Batch)</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Code & Title */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {form.mode === 'single' || editingVoucherId ? (
                  <div>
                    <label htmlFor="voucher-code-input" className="block text-xs font-semibold text-[#1A2E26]">
                      Kode Voucher
                    </label>
                    <div className="mt-1.5 flex gap-2">
                      <input
                        id="voucher-code-input"
                        type="text"
                        required
                        value={form.code}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            code: normalizeVoucherCode(e.target.value),
                          }))
                        }
                        placeholder="Misal: RUSH-PAGI20"
                        className="h-10 flex-1 rounded-xl border border-[#E5E7EB] px-3 font-mono text-sm font-bold uppercase text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            code: generateVoucherCode(prev.is_rush_hour ? 'RUSH' : 'PROMO', 6),
                          }))
                        }
                        title="Generate kode acak baru"
                        className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] px-3 text-xs font-semibold text-[#1A2E26] hover:border-[#109A58] hover:text-[#109A58] whitespace-nowrap"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span>Acak</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="voucher-prefix-input" className="block text-xs font-semibold text-[#1A2E26]">
                        Awalan (Prefix)
                      </label>
                      <input
                        id="voucher-prefix-input"
                        type="text"
                        value={form.batchPrefix}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            batchPrefix: normalizeVoucherCode(e.target.value).slice(0, 10),
                          }))
                        }
                        placeholder="RUSH"
                        className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 font-mono text-sm font-bold uppercase text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="voucher-batch-count" className="block text-xs font-semibold text-[#1A2E26]">
                        Jumlah Kode
                      </label>
                      <input
                        id="voucher-batch-count"
                        type="number"
                        min={2}
                        max={50}
                        value={form.batchCount}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            batchCount: Math.max(2, Math.min(50, Number(e.target.value) || 2)),
                          }))
                        }
                        className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm font-semibold text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label htmlFor="voucher-title-input" className="block text-xs font-semibold text-[#1A2E26]">
                    Nama Program Promo
                  </label>
                  <input
                    id="voucher-title-input"
                    type="text"
                    required
                    value={form.title}
                    onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                    placeholder="Misal: Rush Hour Kopi Pagi"
                    className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="voucher-desc-input" className="block text-xs font-semibold text-[#1A2E26]">
                  Deskripsi Singkat (Opsional)
                </label>
                <input
                  id="voucher-desc-input"
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Misal: Berlaku khusus takeaway jam 07.00 - 10.00 WIB"
                  className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>

              {/* Promo Scheme Section */}
              <div className="space-y-3 border-t border-[#E5E7EB] pt-4">
                <label htmlFor="voucher-scheme-select" className="block text-xs font-semibold text-[#1A2E26]">
                  Skema Promo Voucher
                </label>
                <select
                  id="voucher-scheme-select"
                  value={form.scheme_type}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      scheme_type: e.target.value as VoucherSchemeType,
                    }))
                  }
                  className="h-10 w-full rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] px-3 text-sm font-medium text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                >
                  {(Object.keys(VOUCHER_SCHEME_LABELS) as VoucherSchemeType[]).map((key) => (
                    <option key={key} value={key}>
                      {VOUCHER_SCHEME_LABELS[key]}
                    </option>
                  ))}
                </select>

                {/* Dynamic Scheme Fields */}
                {form.scheme_type === 'percentage_discount' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="voucher-pct" className="block text-xs font-medium text-[#6B7280]">
                        Persentase Diskon (%)
                      </label>
                      <input
                        id="voucher-pct"
                        type="number"
                        min={1}
                        max={100}
                        value={form.discount_percent}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, discount_percent: Number(e.target.value) || 0 }))
                        }
                        className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm font-semibold tabular-nums focus:border-[#109A58] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="voucher-max-disc" className="block text-xs font-medium text-[#6B7280]">
                        Maksimal Diskon (Rp, 0 = tanpa batas)
                      </label>
                      <input
                        id="voucher-max-disc"
                        type="number"
                        min={0}
                        step={500}
                        value={form.max_discount_amount}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            max_discount_amount: Number(e.target.value) || 0,
                          }))
                        }
                        className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm font-semibold tabular-nums focus:border-[#109A58] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {form.scheme_type === 'fixed_discount' && (
                  <div>
                    <label htmlFor="voucher-fixed" className="block text-xs font-medium text-[#6B7280]">
                      Nominal Potongan Langsung (Rp)
                    </label>
                    <input
                      id="voucher-fixed"
                      type="number"
                      min={500}
                      step={500}
                      value={form.discount_amount}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, discount_amount: Number(e.target.value) || 0 }))
                      }
                      className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm font-semibold tabular-nums focus:border-[#109A58] focus:outline-none"
                    />
                  </div>
                )}

                {form.scheme_type === 'special_item_price' && (
                  <div>
                    <label htmlFor="voucher-special-price" className="block text-xs font-medium text-[#6B7280]">
                      Harga Spesial per Item (Rp)
                    </label>
                    <input
                      id="voucher-special-price"
                      type="number"
                      min={1000}
                      step={500}
                      value={form.special_price}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, special_price: Number(e.target.value) || 0 }))
                      }
                      className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm font-semibold tabular-nums focus:border-[#109A58] focus:outline-none"
                    />
                    <p className="mt-1 text-[11px] text-[#6B7280]">
                      Setiap menu yang memenuhi syarat akan otomatis dipotong menjadi harga spesial ini.
                    </p>
                  </div>
                )}

                {form.scheme_type === 'buy_x_get_y' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="voucher-buy-qty" className="block text-xs font-medium text-[#6B7280]">
                        Jumlah Beli (X)
                      </label>
                      <input
                        id="voucher-buy-qty"
                        type="number"
                        min={1}
                        max={20}
                        value={form.buy_quantity}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, buy_quantity: Number(e.target.value) || 1 }))
                        }
                        className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm font-semibold tabular-nums focus:border-[#109A58] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="voucher-free-qty" className="block text-xs font-medium text-[#6B7280]">
                        Jumlah Gratis (Y)
                      </label>
                      <input
                        id="voucher-free-qty"
                        type="number"
                        min={1}
                        max={10}
                        value={form.free_quantity}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, free_quantity: Number(e.target.value) || 1 }))
                        }
                        className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm font-semibold tabular-nums focus:border-[#109A58] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {form.scheme_type === 'bundle_price' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="voucher-bundle-qty" className="block text-xs font-medium text-[#6B7280]">
                        Jumlah Item per Paket
                      </label>
                      <input
                        id="voucher-bundle-qty"
                        type="number"
                        min={2}
                        max={20}
                        value={form.bundle_quantity}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            bundle_quantity: Math.max(2, Number(e.target.value) || 2),
                          }))
                        }
                        className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm font-semibold tabular-nums focus:border-[#109A58] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="voucher-bundle-price" className="block text-xs font-medium text-[#6B7280]">
                        Total Harga Paket (Rp)
                      </label>
                      <input
                        id="voucher-bundle-price"
                        type="number"
                        min={1000}
                        step={500}
                        value={form.bundle_price}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, bundle_price: Number(e.target.value) || 0 }))
                        }
                        className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm font-semibold tabular-nums focus:border-[#109A58] focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {/* Target Menu Selector */}
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#6B7280]">
                      Menu yang Berlaku ({form.target_menu_ids.length === 0 ? 'Semua Menu' : `${form.target_menu_ids.length} dipilih`})
                    </span>
                    {form.target_menu_ids.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, target_menu_ids: [] }))}
                        className="text-xs font-semibold text-[#109A58] hover:underline"
                      >
                        Berlaku Semua Menu
                      </button>
                    )}
                  </div>
                  <div className="mt-1.5 grid max-h-36 grid-cols-1 gap-1.5 overflow-y-auto rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-2.5 sm:grid-cols-2">
                    {menus.map((menu) => {
                      const checked = form.target_menu_ids.includes(menu.id);
                      return (
                        <label
                          key={menu.id}
                          className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-[#FFFFFF]"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleTargetMenu(menu.id)}
                              className="h-3.5 w-3.5 rounded accent-[#109A58]"
                            />
                            <span className="truncate font-medium text-[#1A2E26]">{menu.name}</span>
                          </span>
                          <span className="shrink-0 font-mono text-[11px] text-[#6B7280] tabular-nums">
                            {formatRupiah(menu.selling_price)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Rush Hour Date & Time Window */}
              <div className="space-y-3 border-t border-[#E5E7EB] pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-[#1A2E26]">
                    <Clock className="h-3.5 w-3.5 text-[#109A58]" />
                    Jangka Waktu &amp; Jam Rush Hour
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {RUSH_HOUR_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            start_time: preset.startTime,
                            end_time: preset.endTime,
                            is_rush_hour: preset.id !== 'allday',
                          }))
                        }
                        className="rounded-lg border border-[#E5E7EB] bg-[#F4F6F5] px-2 py-1 text-[11px] font-medium text-[#1A2E26] hover:border-[#109A58] hover:text-[#109A58] whitespace-nowrap"
                      >
                        {preset.label} ({preset.startTime}–{preset.endTime})
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <label htmlFor="voucher-date-from" className="block text-xs font-medium text-[#6B7280]">
                      Tanggal Mulai
                    </label>
                    <input
                      id="voucher-date-from"
                      type="date"
                      required
                      value={form.valid_from_date}
                      onChange={(e) => setForm((prev) => ({ ...prev, valid_from_date: e.target.value }))}
                      className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-2.5 text-xs font-medium tabular-nums focus:border-[#109A58] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="voucher-date-until" className="block text-xs font-medium text-[#6B7280]">
                      Tanggal Berakhir
                    </label>
                    <input
                      id="voucher-date-until"
                      type="date"
                      required
                      value={form.valid_until_date}
                      onChange={(e) => setForm((prev) => ({ ...prev, valid_until_date: e.target.value }))}
                      className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-2.5 text-xs font-medium tabular-nums focus:border-[#109A58] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="voucher-time-start" className="block text-xs font-medium text-[#6B7280]">
                      Jam Mulai
                    </label>
                    <input
                      id="voucher-time-start"
                      type="time"
                      required
                      value={form.start_time}
                      onChange={(e) => setForm((prev) => ({ ...prev, start_time: e.target.value }))}
                      className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-2.5 text-xs font-medium tabular-nums focus:border-[#109A58] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="voucher-time-end" className="block text-xs font-medium text-[#6B7280]">
                      Jam Selesai
                    </label>
                    <input
                      id="voucher-time-end"
                      type="time"
                      required
                      value={form.end_time}
                      onChange={(e) => setForm((prev) => ({ ...prev, end_time: e.target.value }))}
                      className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-2.5 text-xs font-medium tabular-nums focus:border-[#109A58] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Days of Week Picker */}
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#6B7280]">Hari Berlaku</span>
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-[#109A58]">
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, active_days: [0, 1, 2, 3, 4, 5, 6] }))}
                        className="hover:underline"
                      >
                        Setiap Hari
                      </button>
                      <span aria-hidden="true" className="text-[#D1D5DB]">·</span>
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, active_days: [1, 2, 3, 4, 5] }))}
                        className="hover:underline"
                      >
                        Sen–Jum
                      </button>
                      <span aria-hidden="true" className="text-[#D1D5DB]">·</span>
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, active_days: [0, 6] }))}
                        className="hover:underline"
                      >
                        Akhir Pekan
                      </button>
                    </div>
                  </div>
                  <div className="mt-1.5 grid grid-cols-7 gap-1.5">
                    {DAY_LABELS_SHORT.map((label, idx) => {
                      const active = form.active_days.includes(idx);
                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={() => toggleDay(idx)}
                          className={`h-9 rounded-lg border text-xs font-semibold transition-colors ${
                            active
                              ? 'border-[#109A58] bg-[#E6F5EE] text-[#109A58]'
                              : 'border-[#E5E7EB] bg-[#FFFFFF] text-[#6B7280] hover:text-[#1A2E26]'
                          }`}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Limits & Options */}
              <div className="grid grid-cols-1 gap-3 border-t border-[#E5E7EB] pt-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="voucher-min-spend" className="block text-xs font-medium text-[#6B7280]">
                    Minimal Belanja (Rp, 0 = tanpa minimal)
                  </label>
                  <input
                    id="voucher-min-spend"
                    type="number"
                    min={0}
                    step={1000}
                    value={form.min_purchase_amount}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, min_purchase_amount: Number(e.target.value) || 0 }))
                    }
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm font-semibold tabular-nums focus:border-[#109A58] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="voucher-quota" className="block text-xs font-medium text-[#6B7280]">
                    Kuota Pemakaian (0 = tak terbatas)
                  </label>
                  <input
                    id="voucher-quota"
                    type="number"
                    min={0}
                    value={form.max_usage_quota}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, max_usage_quota: Number(e.target.value) || 0 }))
                    }
                    className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-sm font-semibold tabular-nums focus:border-[#109A58] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-5 text-xs text-[#1A2E26]">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.is_rush_hour}
                    onChange={(e) => setForm((prev) => ({ ...prev, is_rush_hour: e.target.checked }))}
                    className="h-4 w-4 rounded accent-[#109A58]"
                  />
                  <span>Tandai sebagai Promo Rush Hour</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.stackable_with_member_discount}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        stackable_with_member_discount: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded accent-[#109A58]"
                  />
                  <span>Boleh digabung dengan Diskon Member</span>
                </label>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-2.5 border-t border-[#E5E7EB] pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="h-10 rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] px-4 text-sm font-semibold text-[#6B7280] hover:text-[#1A2E26]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-10 rounded-xl bg-[#109A58] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#0D8A4E] disabled:opacity-50"
                >
                  {submitting
                    ? 'Menyimpan...'
                    : editingVoucherId
                      ? 'Simpan Perubahan'
                      : form.mode === 'batch'
                        ? `Generate ${form.batchCount} Voucher`
                        : 'Simpan Voucher'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
