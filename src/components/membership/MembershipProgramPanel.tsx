import React, { useState } from 'react';
import {
  Award,
  Calendar,
  CheckCircle2,
  Gift,
  Lock,
  Plus,
  Save,
  Sparkles,
  Tag,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import type { MemberTier, MembershipPromoType, MembershipTierRule } from '../../types';
import { formatRupiah } from '../../utils/format';
import { getPromoStatus } from '../../utils/membershipProgram';

const ALL_TIERS: MemberTier[] = ['Silver', 'Gold', 'Platinum'];

const PROMO_TYPE_LABELS: Record<MembershipPromoType, string> = {
  new_member: 'Program Member Baru',
  free_product: 'Produk Gratis',
  discount: 'Diskon Khusus',
  double_points: 'Bonus Poin',
};

export function MembershipProgramPanel() {
  const {
    menus,
    membershipProgram,
    updateMembershipLimits,
    updateMembershipTier,
    addRedeemableReward,
    updateRedeemableReward,
    deleteRedeemableReward,
    addMembershipPromo,
    updateMembershipPromo,
    deleteMembershipPromo,
  } = useStore();

  const [toast, setToast] = useState<string | null>(null);

  // Section 1: Redemption Limits & New Member Program draft state
  const [limitsDraft, setLimitsDraft] = useState(membershipProgram.limits);

  // Section 2: Tier rules draft state
  const [tiersDraft, setTiersDraft] = useState<MembershipTierRule[]>(membershipProgram.tiers);

  // Section 3: Add Redeemable Product form
  const [rewardMenuId, setRewardMenuId] = useState(menus[0]?.id ?? '');
  const [rewardPoints, setRewardPoints] = useState('60');
  const [rewardPerMember, setRewardPerMember] = useState('2');
  const [rewardQuota, setRewardQuota] = useState('50');

  // Section 4: Add Promo Program form
  const [promoTitle, setPromoTitle] = useState('');
  const [promoDesc, setPromoDesc] = useState('');
  const [promoType, setPromoType] = useState<MembershipPromoType>('new_member');
  const [promoStart, setPromoStart] = useState('2026-11-25');
  const [promoEnd, setPromoEnd] = useState('2026-12-31');
  const [promoPerMember, setPromoPerMember] = useState('1');
  const [promoCustomerQuota, setPromoCustomerQuota] = useState('100');
  const [promoBonusPoints, setPromoBonusPoints] = useState('30');
  const [promoDiscountPct, setPromoDiscountPct] = useState('15');
  const [promoRewardMenuId, setPromoRewardMenuId] = useState(menus[0]?.id ?? '');
  const [promoTiers, setPromoTiers] = useState<MemberTier[]>(['Silver', 'Gold', 'Platinum']);
  const [promoError, setPromoError] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4000);
  };

  const handleSaveLimits = (e: React.FormEvent) => {
    e.preventDefault();
    updateMembershipLimits({
      ...limitsDraft,
      min_points_to_redeem: Math.max(1, Number(limitsDraft.min_points_to_redeem) || 1),
      max_free_products_per_day: Math.max(1, Number(limitsDraft.max_free_products_per_day) || 1),
      max_free_products_per_month: Math.max(
        1,
        Number(limitsDraft.max_free_products_per_month) || 1
      ),
      point_earning_step_rupiah: Math.max(
        1000,
        Number(limitsDraft.point_earning_step_rupiah) || 10000
      ),
      new_member_welcome_points: Math.max(0, Number(limitsDraft.new_member_welcome_points) || 0),
      new_member_max_quota: Math.max(1, Number(limitsDraft.new_member_max_quota) || 1),
    });
    notify('Aturan batas penukaran & program member baru berhasil disimpan.');
  };

  const handleSaveTiers = (e: React.FormEvent) => {
    e.preventDefault();
    for (const rule of tiersDraft) {
      updateMembershipTier(rule.tier, {
        min_total_spent: Math.max(0, Number(rule.min_total_spent) || 0),
        discount_percent: Math.max(0, Math.min(80, Number(rule.discount_percent) || 0)),
        points_multiplier: Math.max(0.5, Number(rule.points_multiplier) || 1),
        welcome_benefit: rule.welcome_benefit.trim(),
      });
    }
    notify('Pengaturan Tier Membership (Silver, Gold, Platinum) diperbarui & langsung aktif di POS.');
  };

  const handleAddReward = (e: React.FormEvent) => {
    e.preventDefault();
    const menu = menus.find((m) => m.id === rewardMenuId);
    if (!menu) return;
    addRedeemableReward({
      menu_id: menu.id,
      menu_name: menu.name,
      points_required: Math.max(1, Number(rewardPoints) || 50),
      max_redemptions_per_member: Math.max(1, Number(rewardPerMember) || 1),
      total_quota: Math.max(1, Number(rewardQuota) || 20),
      is_active: true,
    });
    notify(`Produk "${menu.name}" ditambahkan ke katalog penukaran poin.`);
  };

  const handleTogglePromoTier = (tier: MemberTier) => {
    setPromoTiers((prev) => {
      if (prev.includes(tier)) {
        return prev.length > 1 ? prev.filter((t) => t !== tier) : prev;
      }
      return [...prev, tier];
    });
  };

  const handleAddPromo = (e: React.FormEvent) => {
    e.preventDefault();
    setPromoError(null);
    if (!promoTitle.trim()) {
      setPromoError('Nama program promo wajib diisi.');
      return;
    }
    if (promoStart && promoEnd && promoEnd < promoStart) {
      setPromoError('Tanggal berakhir promo tidak boleh lebih awal dari tanggal mulai.');
      return;
    }

    const rewardMenu = menus.find((m) => m.id === promoRewardMenuId);
    addMembershipPromo({
      title: promoTitle.trim(),
      description:
        promoDesc.trim() ||
        `${PROMO_TYPE_LABELS[promoType]} berlaku periode ${promoStart} s/d ${promoEnd}.`,
      promo_type: promoType,
      start_date: promoStart,
      end_date: promoEnd,
      max_redemptions_per_member: Math.max(1, Number(promoPerMember) || 1),
      max_customer_quota: Math.max(1, Number(promoCustomerQuota) || 10),
      bonus_points:
        promoType === 'new_member' || promoType === 'double_points'
          ? Math.max(0, Number(promoBonusPoints) || 0)
          : undefined,
      discount_percent:
        promoType === 'discount' ? Math.max(1, Math.min(80, Number(promoDiscountPct) || 10)) : undefined,
      reward_menu_id:
        promoType === 'free_product' || promoType === 'new_member' ? rewardMenu?.id ?? null : null,
      reward_menu_name:
        promoType === 'free_product' || promoType === 'new_member'
          ? rewardMenu?.name ?? null
          : null,
      eligible_tiers: promoTiers,
      is_active: true,
    });

    setPromoTitle('');
    setPromoDesc('');
    notify('Program promo membership baru berhasil ditambahkan.');
  };

  return (
    <div className="space-y-6" data-testid="membership-program-owner-panel">
      {/* Owner-Only Security Notice */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#109A58]/25 bg-[#E6F5EE]/70 px-4 py-3 text-xs text-[#1A2E26]">
        <span className="flex items-center gap-2 font-medium">
          <Lock className="h-4 w-4 shrink-0 text-[#109A58]" />
          <span>
            <strong>Panel Khusus Owner:</strong> Semua aturan penukaran poin, tier diskon, dan kuota
            promo langsung tersinkron ke layar Kasir POS, Membership, serta Display TV Store.
          </span>
        </span>
      </div>

      {toast && (
        <div
          role="status"
          data-testid="membership-program-toast"
          className="flex items-center gap-2 rounded-xl border border-[#109A58]/30 bg-[#E6F5EE] px-4 py-3 text-xs font-semibold text-[#109A58]"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* SECTION 1: Batas Penukaran Produk Gratis & Program Member Baru */}
      <form
        onSubmit={handleSaveLimits}
        className="space-y-5 rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-[#1A2E26]">
              <UserPlus className="h-4 w-4 text-[#109A58]" />
              <span>Batas Penukaran Produk Gratis &amp; Program Member Baru</span>
            </h2>
            <p className="mt-0.5 text-xs text-[#6B7280]">
              Atur minimal poin penukaran, kuota produk gratis per hari/bulan, serta periode &amp;
              kuota promo pendaftaran member baru.
            </p>
          </div>
          <button
            type="submit"
            data-testid="save-membership-limits-btn"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#109A58] px-4 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Simpan Aturan &amp; Member Baru</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="limit-min-points" className="block text-xs font-semibold text-[#1A2E26]">
              Minimal Poin untuk Tukar
            </label>
            <input
              id="limit-min-points"
              type="number"
              min={1}
              value={limitsDraft.min_points_to_redeem}
              onChange={(e) =>
                setLimitsDraft((p) => ({ ...p, min_points_to_redeem: Number(e.target.value) }))
              }
              className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="limit-day" className="block text-xs font-semibold text-[#1A2E26]">
              Batas Tukar Gratis / Hari
            </label>
            <input
              id="limit-day"
              type="number"
              min={1}
              value={limitsDraft.max_free_products_per_day}
              onChange={(e) =>
                setLimitsDraft((p) => ({
                  ...p,
                  max_free_products_per_day: Number(e.target.value),
                }))
              }
              className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="limit-month" className="block text-xs font-semibold text-[#1A2E26]">
              Batas Tukar Gratis / Bulan
            </label>
            <input
              id="limit-month"
              type="number"
              min={1}
              value={limitsDraft.max_free_products_per_month}
              onChange={(e) =>
                setLimitsDraft((p) => ({
                  ...p,
                  max_free_products_per_month: Number(e.target.value),
                }))
              }
              className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="limit-step" className="block text-xs font-semibold text-[#1A2E26]">
              Belanja per 1 Poin (Rp)
            </label>
            <input
              id="limit-step"
              type="number"
              min={1000}
              step={1000}
              value={limitsDraft.point_earning_step_rupiah}
              onChange={(e) =>
                setLimitsDraft((p) => ({
                  ...p,
                  point_earning_step_rupiah: Number(e.target.value),
                }))
              }
              className="mt-1.5 h-10 w-full rounded-xl border border-[#E5E7EB] px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
            />
          </div>
        </div>

        {/* Program Member Baru */}
        <div className="space-y-4 rounded-2xl border border-[#E5E7EB] bg-[#F4F6F5]/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-[#1A2E26]">Program Khusus Member Baru</p>
              <p className="text-[11px] text-[#6B7280]">
                Otomatis diterapkan saat pelanggan mendaftar baru jika masih dalam periode &amp;
                kuota.
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#1A2E26]">
              <input
                type="checkbox"
                checked={limitsDraft.new_member_promo_enabled}
                onChange={(e) =>
                  setLimitsDraft((p) => ({ ...p, new_member_promo_enabled: e.target.checked }))
                }
                className="h-4 w-4 accent-[#109A58]"
              />
              <span>{limitsDraft.new_member_promo_enabled ? 'Promo Aktif' : 'Nonaktif'}</span>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2">
              <label htmlFor="nm-title" className="block text-xs font-medium text-[#6B7280]">
                Nama Promo Member Baru
              </label>
              <input
                id="nm-title"
                type="text"
                value={limitsDraft.new_member_promo_title}
                onChange={(e) =>
                  setLimitsDraft((p) => ({ ...p, new_member_promo_title: e.target.value }))
                }
                className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="nm-welcome-pts" className="block text-xs font-medium text-[#6B7280]">
                Bonus Poin Daftar Baru
              </label>
              <input
                id="nm-welcome-pts"
                type="number"
                min={0}
                value={limitsDraft.new_member_welcome_points}
                onChange={(e) =>
                  setLimitsDraft((p) => ({
                    ...p,
                    new_member_welcome_points: Number(e.target.value),
                  }))
                }
                className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="nm-menu" className="block text-xs font-medium text-[#6B7280]">
                Produk Gratis Member Baru
              </label>
              <select
                id="nm-menu"
                value={limitsDraft.new_member_free_menu_id ?? ''}
                onChange={(e) =>
                  setLimitsDraft((p) => ({
                    ...p,
                    new_member_free_menu_id: e.target.value || null,
                  }))
                }
                className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              >
                <option value="">Hanya Bonus Poin (Tanpa Produk Gratis)</option>
                {menus.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({formatRupiah(m.selling_price)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="nm-start" className="block text-xs font-medium text-[#6B7280]">
                Periode Mulai
              </label>
              <input
                id="nm-start"
                type="date"
                value={limitsDraft.new_member_promo_start_date}
                onChange={(e) =>
                  setLimitsDraft((p) => ({ ...p, new_member_promo_start_date: e.target.value }))
                }
                className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="nm-end" className="block text-xs font-medium text-[#6B7280]">
                Periode Berakhir
              </label>
              <input
                id="nm-end"
                type="date"
                value={limitsDraft.new_member_promo_end_date}
                onChange={(e) =>
                  setLimitsDraft((p) => ({ ...p, new_member_promo_end_date: e.target.value }))
                }
                className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="nm-quota" className="block text-xs font-medium text-[#6B7280]">
                Kuota Kustomer Member Baru
              </label>
              <input
                id="nm-quota"
                type="number"
                min={1}
                value={limitsDraft.new_member_max_quota}
                onChange={(e) =>
                  setLimitsDraft((p) => ({ ...p, new_member_max_quota: Number(e.target.value) }))
                }
                className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div className="flex items-end sm:col-span-2">
              <div className="w-full rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2 text-xs">
                <div className="flex items-center justify-between text-[#6B7280]">
                  <span>Kuota Member Baru Terpakai</span>
                  <span className="font-bold text-[#109A58] tabular-nums">
                    {membershipProgram.limits.new_member_claimed_count} /{' '}
                    {limitsDraft.new_member_max_quota} orang
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#F4F6F5]">
                  <div
                    className="h-full rounded-full bg-[#109A58]"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (membershipProgram.limits.new_member_claimed_count /
                            Math.max(1, limitsDraft.new_member_max_quota)) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>

      {/* SECTION 2: Pengaturan Tier Membership */}
      <form
        onSubmit={handleSaveTiers}
        className="space-y-4 rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-[#1A2E26]">
              <Award className="h-4 w-4 text-[#109A58]" />
              <span>Pengaturan Tier Membership (Silver · Gold · Platinum)</span>
            </h2>
            <p className="mt-0.5 text-xs text-[#6B7280]">
              Tentukan syarat total belanja, persentase diskon kasir, dan pengali poin per tier.
            </p>
          </div>
          <button
            type="submit"
            data-testid="save-tiers-btn"
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#109A58] px-4 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Simpan Tier Membership</span>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {tiersDraft.map((rule, idx) => (
            <div
              key={rule.tier}
              data-testid={`tier-config-${rule.tier}`}
              className="space-y-3 rounded-2xl border border-[#E5E7EB] bg-[#F4F6F5]/60 p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-[#1A2E26]">Tier {rule.tier}</span>
                <span className="rounded-full bg-[#E6F5EE] px-2.5 py-0.5 text-[11px] font-bold text-[#109A58] tabular-nums">
                  Diskon {rule.discount_percent}%
                </span>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#6B7280]">
                  Min. Akumulasi Belanja (Rp)
                </label>
                <input
                  type="number"
                  min={0}
                  step={100000}
                  value={rule.min_total_spent}
                  onChange={(e) =>
                    setTiersDraft((prev) =>
                      prev.map((t, i) =>
                        i === idx ? { ...t, min_total_spent: Number(e.target.value) } : t
                      )
                    )
                  }
                  className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-[#6B7280]">
                    Diskon Kasir (%)
                  </label>
                  <input
                    data-testid={`tier-discount-${rule.tier}`}
                    type="number"
                    min={0}
                    max={80}
                    value={rule.discount_percent}
                    onChange={(e) =>
                      setTiersDraft((prev) =>
                        prev.map((t, i) =>
                          i === idx ? { ...t, discount_percent: Number(e.target.value) } : t
                        )
                      )
                    }
                    className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#6B7280]">
                    Pengali Poin (x)
                  </label>
                  <input
                    type="number"
                    min={0.5}
                    max={5}
                    step={0.5}
                    value={rule.points_multiplier}
                    onChange={(e) =>
                      setTiersDraft((prev) =>
                        prev.map((t, i) =>
                          i === idx ? { ...t, points_multiplier: Number(e.target.value) } : t
                        )
                      )
                    }
                    className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#6B7280]">
                  Benefit &amp; Keuntungan Tier
                </label>
                <input
                  type="text"
                  value={rule.welcome_benefit}
                  onChange={(e) =>
                    setTiersDraft((prev) =>
                      prev.map((t, i) =>
                        i === idx ? { ...t, welcome_benefit: e.target.value } : t
                      )
                    )
                  }
                  className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                />
              </div>
            </div>
          ))}
        </div>
      </form>

      {/* SECTION 3: Produk yang Bisa Ditukar dengan Poin */}
      <div className="space-y-4 rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-[#1A2E26]">
            <Gift className="h-4 w-4 text-[#109A58]" />
            <span>Produk yang Dapat Ditukar dengan Poin</span>
          </h2>
          <p className="mt-0.5 text-xs text-[#6B7280]">
            Pilih menu kopi/makanan yang dapat ditebus gratis menggunakan poin member beserta batas
            penukaran dan kuota totalnya.
          </p>
        </div>

        <form
          onSubmit={handleAddReward}
          className="grid grid-cols-1 gap-3 rounded-2xl border border-[#E5E7EB] bg-[#F4F6F5]/70 p-4 sm:grid-cols-12"
        >
          <div className="sm:col-span-4">
            <label htmlFor="rew-menu" className="block text-[11px] font-semibold text-[#1A2E26]">
              Produk Menu
            </label>
            <select
              id="rew-menu"
              value={rewardMenuId}
              onChange={(e) => setRewardMenuId(e.target.value)}
              className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
            >
              {menus.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({formatRupiah(m.selling_price)})
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="rew-pts" className="block text-[11px] font-semibold text-[#1A2E26]">
              Poin Tukar
            </label>
            <input
              id="rew-pts"
              type="number"
              min={1}
              value={rewardPoints}
              onChange={(e) => setRewardPoints(e.target.value)}
              className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="rew-limit" className="block text-[11px] font-semibold text-[#1A2E26]">
              Batas / Member
            </label>
            <input
              id="rew-limit"
              type="number"
              min={1}
              value={rewardPerMember}
              onChange={(e) => setRewardPerMember(e.target.value)}
              className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="rew-quota" className="block text-[11px] font-semibold text-[#1A2E26]">
              Kuota Total
            </label>
            <input
              id="rew-quota"
              type="number"
              min={1}
              value={rewardQuota}
              onChange={(e) => setRewardQuota(e.target.value)}
              className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
            />
          </div>
          <div className="flex items-end sm:col-span-2">
            <button
              type="submit"
              data-testid="add-reward-btn"
              className="flex h-9 w-full items-center justify-center gap-1 rounded-full bg-[#109A58] px-3 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Tambah</span>
            </button>
          </div>
        </form>

        <div className="divide-y divide-[#E5E7EB] rounded-xl border border-[#E5E7EB]">
          {membershipProgram.rewards.length === 0 ? (
            <p className="py-8 text-center text-xs text-[#6B7280]">
              Belum ada produk yang terdaftar untuk ditukar dengan poin.
            </p>
          ) : (
            membershipProgram.rewards.map((rew) => (
              <div
                key={rew.id}
                data-testid={`reward-row-${rew.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-[#1A2E26]">{rew.menu_name}</p>
                  <p className="mt-0.5 text-[11px] text-[#6B7280] tabular-nums">
                    {rew.points_required} poin · Maks {rew.max_redemptions_per_member}x/member ·
                    Terpakai {rew.redeemed_count}/{rew.total_quota}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateRedeemableReward(rew.id, { is_active: !rew.is_active })}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                      rew.is_active
                        ? 'bg-[#E6F5EE] text-[#109A58]'
                        : 'bg-[#F4F6F5] text-[#6B7280]'
                    }`}
                  >
                    {rew.is_active ? 'Aktif' : 'Nonaktif'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      deleteRedeemableReward(rew.id);
                      notify(`Produk "${rew.menu_name}" dihapus dari katalog penukaran.`);
                    }}
                    aria-label={`Hapus produk tukar ${rew.menu_name}`}
                    className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#FEF2F2] hover:text-[#EF4444]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* SECTION 4: Program Promo Membership (Periode, Batas Penukaran & Kuota Kustomer) */}
      <div className="space-y-4 rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-6">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-[#1A2E26]">
            <Sparkles className="h-4 w-4 text-[#109A58]" />
            <span>Program Promo Membership (Periode, Batas Penukaran &amp; Kuota Kustomer)</span>
          </h2>
          <p className="mt-0.5 text-xs text-[#6B7280]">
            Buat promo berkala untuk member baru maupun member lama lengkap dengan rentang tanggal,
            batas penukaran per member, dan kuota total kustomer.
          </p>
        </div>

        <form
          onSubmit={handleAddPromo}
          className="space-y-3.5 rounded-2xl border border-[#E5E7EB] bg-[#F4F6F5]/70 p-4"
        >
          {promoError && (
            <p role="alert" className="text-xs font-medium text-[#EF4444]">
              {promoError}
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2">
              <label htmlFor="promo-title" className="block text-[11px] font-semibold text-[#1A2E26]">
                Nama Program Promo *
              </label>
              <input
                id="promo-title"
                type="text"
                value={promoTitle}
                onChange={(e) => setPromoTitle(e.target.value)}
                placeholder="Misal: Promo Payday — Gratis Americano untuk 50 Member Pertama"
                className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="promo-type" className="block text-[11px] font-semibold text-[#1A2E26]">
                Jenis Program Promo
              </label>
              <select
                id="promo-type"
                value={promoType}
                onChange={(e) => setPromoType(e.target.value as MembershipPromoType)}
                className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              >
                <option value="new_member">Program Member Baru</option>
                <option value="free_product">Produk Gratis</option>
                <option value="discount">Diskon Khusus</option>
                <option value="double_points">Bonus Poin</option>
              </select>
            </div>

            <div>
              <label htmlFor="promo-start" className="block text-[11px] font-semibold text-[#1A2E26]">
                Tanggal Mulai Promo
              </label>
              <input
                id="promo-start"
                type="date"
                value={promoStart}
                onChange={(e) => setPromoStart(e.target.value)}
                className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="promo-end" className="block text-[11px] font-semibold text-[#1A2E26]">
                Tanggal Berakhir Promo
              </label>
              <input
                id="promo-end"
                type="date"
                value={promoEnd}
                onChange={(e) => setPromoEnd(e.target.value)}
                className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="promo-per-member"
                  className="block text-[11px] font-semibold text-[#1A2E26]"
                >
                  Batas / Member
                </label>
                <input
                  id="promo-per-member"
                  type="number"
                  min={1}
                  value={promoPerMember}
                  onChange={(e) => setPromoPerMember(e.target.value)}
                  className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-2.5 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                />
              </div>
              <div>
                <label
                  htmlFor="promo-quota"
                  className="block text-[11px] font-semibold text-[#1A2E26]"
                >
                  Kuota Kustomer
                </label>
                <input
                  id="promo-quota"
                  type="number"
                  min={1}
                  value={promoCustomerQuota}
                  onChange={(e) => setPromoCustomerQuota(e.target.value)}
                  className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-2.5 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                />
              </div>
            </div>

            {(promoType === 'free_product' || promoType === 'new_member') && (
              <div key="promo-field-reward-menu">
                <label
                  htmlFor="promo-reward-menu"
                  className="block text-[11px] font-semibold text-[#1A2E26]"
                >
                  Produk Hadiah Gratis
                </label>
                <select
                  id="promo-reward-menu"
                  value={promoRewardMenuId}
                  onChange={(e) => setPromoRewardMenuId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
                >
                  {menus.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(promoType === 'new_member' || promoType === 'double_points') && (
              <div key="promo-field-bonus-pts">
                <label
                  htmlFor="promo-bonus-pts"
                  className="block text-[11px] font-semibold text-[#1A2E26]"
                >
                  Bonus Poin Tambahan
                </label>
                <input
                  id="promo-bonus-pts"
                  type="number"
                  min={0}
                  value={promoBonusPoints}
                  onChange={(e) => setPromoBonusPoints(e.target.value)}
                  className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                />
              </div>
            )}

            {promoType === 'discount' && (
              <div key="promo-field-discount-pct">
                <label
                  htmlFor="promo-disc-pct"
                  className="block text-[11px] font-semibold text-[#1A2E26]"
                >
                  Besaran Diskon Promo (%)
                </label>
                <input
                  id="promo-disc-pct"
                  type="number"
                  min={1}
                  max={80}
                  value={promoDiscountPct}
                  onChange={(e) => setPromoDiscountPct(e.target.value)}
                  className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] tabular-nums focus:border-[#109A58] focus:outline-none"
                />
              </div>
            )}

            <div className="sm:col-span-2 lg:col-span-3">
              <label htmlFor="promo-desc" className="block text-[11px] font-semibold text-[#1A2E26]">
                Syarat &amp; Deskripsi Singkat
              </label>
              <input
                id="promo-desc"
                type="text"
                value={promoDesc}
                onChange={(e) => setPromoDesc(e.target.value)}
                placeholder="Misal: Berlaku untuk Dine-in & Takeaway, klaim 1x per member selama kuota tersedia."
                className="mt-1 h-9 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs text-[#1A2E26] focus:border-[#109A58] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold text-[#6B7280]">Tier Berlaku:</span>
              {ALL_TIERS.map((tier) => {
                const checked = promoTiers.includes(tier);
                return (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => handleTogglePromoTier(tier)}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${
                      checked
                        ? 'bg-[#109A58] text-white'
                        : 'border border-[#E5E7EB] bg-white text-[#6B7280]'
                    }`}
                  >
                    {tier}
                  </button>
                );
              })}
            </div>

            <button
              type="submit"
              data-testid="add-promo-btn"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#109A58] px-5 text-xs font-semibold text-white hover:bg-[#0D8A4E]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Buat Program Promo</span>
            </button>
          </div>
        </form>

        {/* Active & Scheduled Promo List */}
        <div className="space-y-3">
          {membershipProgram.promos.map((promo) => {
            const status = getPromoStatus(promo);
            const quotaPct = Math.min(
              100,
              Math.round((promo.claimed_count / Math.max(1, promo.max_customer_quota)) * 100)
            );
            const statusStyle =
              status === 'active'
                ? 'bg-[#E6F5EE] text-[#109A58]'
                : status === 'scheduled'
                  ? 'bg-[#EFF6FF] text-[#2563EB]'
                  : status === 'quota_full' || status === 'expired'
                    ? 'bg-[#FEF2F2] text-[#EF4444]'
                    : 'bg-[#F4F6F5] text-[#6B7280]';
            const statusLabel =
              status === 'active'
                ? 'Aktif'
                : status === 'scheduled'
                  ? 'Terjadwal'
                  : status === 'quota_full'
                    ? 'Kuota Penuh'
                    : status === 'expired'
                      ? 'Berakhir'
                      : 'Nonaktif';

            return (
              <div
                key={promo.id}
                data-testid={`promo-card-${promo.id}`}
                className="rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-[#1A2E26]">{promo.title}</span>
                      <span className="rounded-full bg-[#F4F6F5] px-2.5 py-0.5 text-[10px] font-semibold text-[#6B7280]">
                        {PROMO_TYPE_LABELS[promo.promo_type]}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${statusStyle}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <p className="text-xs text-[#6B7280]">{promo.description}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-[#6B7280] tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5 text-[#109A58]" />
                        Periode: {promo.start_date} s/d {promo.end_date}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Tag className="h-3.5 w-3.5 text-[#109A58]" />
                        Batas: {promo.max_redemptions_per_member}x/member
                      </span>
                      <span>Tier: {promo.eligible_tiers.join(', ')}</span>
                      {promo.reward_menu_name && (
                        <span className="font-semibold text-[#109A58]">
                          Hadiah: Gratis {promo.reward_menu_name}
                        </span>
                      )}
                      {promo.bonus_points ? (
                        <span className="font-semibold text-[#109A58]">
                          +{promo.bonus_points} poin
                        </span>
                      ) : null}
                      {promo.discount_percent ? (
                        <span className="font-semibold text-[#109A58]">
                          Diskon {promo.discount_percent}%
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateMembershipPromo(promo.id, { is_active: !promo.is_active })}
                      className="rounded-full border border-[#E5E7EB] px-3 py-1 text-[11px] font-semibold text-[#1A2E26] hover:border-[#109A58] hover:text-[#109A58]"
                    >
                      {promo.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        deleteMembershipPromo(promo.id);
                        notify(`Program promo "${promo.title}" dihapus.`);
                      }}
                      aria-label={`Hapus promo ${promo.title}`}
                      className="rounded-lg p-1.5 text-[#6B7280] hover:bg-[#FEF2F2] hover:text-[#EF4444]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Quota Progress Bar */}
                <div className="mt-3 flex items-center gap-3 text-[11px]">
                  <span className="text-[#6B7280] whitespace-nowrap">Kuota Kustomer:</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#F4F6F5]">
                    <div
                      className={`h-full rounded-full ${
                        quotaPct >= 100 ? 'bg-[#EF4444]' : 'bg-[#109A58]'
                      }`}
                      style={{ width: `${quotaPct}%` }}
                    />
                  </div>
                  <span className="font-bold text-[#1A2E26] tabular-nums whitespace-nowrap">
                    {promo.claimed_count} / {promo.max_customer_quota} orang ({quotaPct}%)
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
