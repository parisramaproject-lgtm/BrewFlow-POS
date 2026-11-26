import type {
  Customer,
  MemberRedemptionLog,
  MemberTier,
  MembershipProgramConfig,
  MembershipPromoProgram,
  MembershipTierRule,
  RedeemableRewardItem,
  RedemptionLimitConfig,
} from '../types';

export const DEFAULT_MEMBERSHIP_PROGRAM: MembershipProgramConfig = {
  limits: {
    min_points_to_redeem: 50,
    max_free_products_per_day: 2,
    max_free_products_per_month: 8,
    point_earning_step_rupiah: 10000,
    new_member_welcome_points: 20,
    new_member_promo_enabled: true,
    new_member_promo_title: 'Welcome Drink Member Baru (Gratis Americano + 20 Poin)',
    new_member_promo_start_date: '2026-11-01',
    new_member_promo_end_date: '2026-12-31',
    new_member_max_quota: 100,
    new_member_claimed_count: 14,
    new_member_free_menu_id: 'menu-americano',
  },
  tiers: [
    {
      tier: 'Silver',
      min_total_spent: 0,
      discount_percent: 5,
      points_multiplier: 1,
      welcome_benefit: 'Diskon 5% semua menu + 1x poin setiap transaksi',
    },
    {
      tier: 'Gold',
      min_total_spent: 3000000,
      discount_percent: 10,
      points_multiplier: 1.5,
      welcome_benefit: 'Diskon 10% semua menu + 1.5x poin + prioritas promo musiman',
    },
    {
      tier: 'Platinum',
      min_total_spent: 8000000,
      discount_percent: 15,
      points_multiplier: 2,
      welcome_benefit: 'Diskon 15% semua menu + 2x poin + gratis 1 pastry saat ulang tahun',
    },
  ],
  rewards: [
    {
      id: 'rew-americano',
      menu_id: 'menu-americano',
      menu_name: 'Iced Americano',
      points_required: 50,
      max_redemptions_per_member: 3,
      total_quota: 60,
      redeemed_count: 9,
      is_active: true,
    },
    {
      id: 'rew-aren-latte',
      menu_id: 'menu-aren-latte',
      menu_name: 'Es Kopi Susu Gula Aren',
      points_required: 75,
      max_redemptions_per_member: 2,
      total_quota: 40,
      redeemed_count: 11,
      is_active: true,
    },
    {
      id: 'rew-croissant',
      menu_id: 'menu-croissant',
      menu_name: 'Butter Croissant',
      points_required: 90,
      max_redemptions_per_member: 2,
      total_quota: 30,
      redeemed_count: 4,
      is_active: true,
    },
  ],
  promos: [
    {
      id: 'promo-welcome-q4',
      title: 'Promo Member Baru — Bonus 50 Poin & Gratis Kopi',
      description:
        'Khusus pelanggan baru yang mendaftar selama periode promo. Berlaku 1x penukaran per member selama kuota tersedia.',
      promo_type: 'new_member',
      start_date: '2026-11-01',
      end_date: '2026-12-31',
      max_redemptions_per_member: 1,
      max_customer_quota: 100,
      claimed_count: 14,
      bonus_points: 50,
      reward_menu_id: 'menu-americano',
      reward_menu_name: 'Iced Americano',
      eligible_tiers: ['Silver', 'Gold', 'Platinum'],
      is_active: true,
    },
    {
      id: 'promo-gold-pastry',
      title: 'Treats Akhir Bulan — Gratis Croissant Member VIP',
      description:
        'Penukaran produk gratis spesial bagi member Gold & Platinum di bulan November–Desember.',
      promo_type: 'free_product',
      start_date: '2026-11-15',
      end_date: '2026-12-20',
      max_redemptions_per_member: 2,
      max_customer_quota: 50,
      claimed_count: 12,
      reward_menu_id: 'menu-croissant',
      reward_menu_name: 'Butter Croissant',
      eligible_tiers: ['Gold', 'Platinum'],
      is_active: true,
    },
  ],
};

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getTierRule(
  tiers: MembershipTierRule[] | undefined,
  tier: MemberTier | null
): MembershipTierRule | null {
  if (!tier) return null;
  const list = tiers && tiers.length > 0 ? tiers : DEFAULT_MEMBERSHIP_PROGRAM.tiers;
  return list.find((t) => t.tier === tier) ?? null;
}

export function computeTierBySpend(
  totalSpent: number,
  tiers: MembershipTierRule[] = DEFAULT_MEMBERSHIP_PROGRAM.tiers
): MemberTier {
  const sorted = [...tiers].sort((a, b) => b.min_total_spent - a.min_total_spent);
  for (const rule of sorted) {
    if (totalSpent >= rule.min_total_spent) {
      return rule.tier;
    }
  }
  return 'Silver';
}

export function isWithinDatePeriod(
  startDate: string,
  endDate: string,
  now: Date = new Date()
): boolean {
  const today = toDateKey(now);
  if (startDate && today < startDate) return false;
  if (endDate && today > endDate) return false;
  return true;
}

export function isNewMemberPromoEligible(
  limits: RedemptionLimitConfig,
  now: Date = new Date()
): boolean {
  if (!limits.new_member_promo_enabled) return false;
  if (!isWithinDatePeriod(limits.new_member_promo_start_date, limits.new_member_promo_end_date, now)) {
    return false;
  }
  return limits.new_member_claimed_count < limits.new_member_max_quota;
}

export function getPromoStatus(
  promo: MembershipPromoProgram,
  now: Date = new Date()
): 'active' | 'scheduled' | 'expired' | 'quota_full' | 'inactive' {
  if (!promo.is_active) return 'inactive';
  if (promo.claimed_count >= promo.max_customer_quota) return 'quota_full';
  const today = toDateKey(now);
  if (promo.start_date && today < promo.start_date) return 'scheduled';
  if (promo.end_date && today > promo.end_date) return 'expired';
  return 'active';
}

export function validateRewardRedemption(params: {
  customer: Customer;
  reward: RedeemableRewardItem;
  limits: RedemptionLimitConfig;
  logs: MemberRedemptionLog[];
  now?: Date;
}): { ok: true } | { ok: false; reason: string } {
  const { customer, reward, limits, logs } = params;
  const now = params.now ?? new Date();

  if (!reward.is_active) {
    return { ok: false, reason: 'Produk penukaran sedang dinonaktifkan oleh Owner.' };
  }

  const requiredPoints = Math.max(reward.points_required, limits.min_points_to_redeem);
  if (customer.points < requiredPoints) {
    return {
      ok: false,
      reason: `Poin belum mencukupi (dibutuhkan minimal ${requiredPoints} pts, saldo saat ini ${customer.points} pts).`,
    };
  }

  if (reward.redeemed_count >= reward.total_quota) {
    return {
      ok: false,
      reason: `Kuota penukaran untuk ${reward.menu_name} (${reward.total_quota}x) sudah habis.`,
    };
  }

  const memberRewardCount = logs.filter(
    (log) => log.customer_id === customer.id && log.reward_id === reward.id
  ).length;
  if (memberRewardCount >= reward.max_redemptions_per_member) {
    return {
      ok: false,
      reason: `Batas penukaran ${reward.menu_name} per member (${reward.max_redemptions_per_member}x) telah tercapai.`,
    };
  }

  const todayKey = toDateKey(now);
  const monthPrefix = todayKey.slice(0, 7);
  const rewardLogsForMember = logs.filter(
    (log) => log.customer_id === customer.id && Boolean(log.reward_id)
  );
  const todayCount = rewardLogsForMember.filter((log) =>
    log.redeemed_at.startsWith(todayKey)
  ).length;
  if (todayCount >= limits.max_free_products_per_day) {
    return {
      ok: false,
      reason: `Batas penukaran produk gratis harian (${limits.max_free_products_per_day}x/hari) telah tercapai.`,
    };
  }

  const monthCount = rewardLogsForMember.filter((log) =>
    log.redeemed_at.startsWith(monthPrefix)
  ).length;
  if (monthCount >= limits.max_free_products_per_month) {
    return {
      ok: false,
      reason: `Batas penukaran produk gratis bulanan (${limits.max_free_products_per_month}x/bulan) telah tercapai.`,
    };
  }

  return { ok: true };
}

export function validatePromoClaim(params: {
  customer: Customer;
  promo: MembershipPromoProgram;
  logs: MemberRedemptionLog[];
  now?: Date;
}): { ok: true } | { ok: false; reason: string } {
  const { customer, promo, logs } = params;
  const now = params.now ?? new Date();
  const status = getPromoStatus(promo, now);

  if (status === 'inactive') {
    return { ok: false, reason: 'Program promo sedang tidak aktif.' };
  }
  if (status === 'scheduled') {
    return { ok: false, reason: `Promo baru berlaku mulai ${promo.start_date}.` };
  }
  if (status === 'expired') {
    return { ok: false, reason: `Periode promo sudah berakhir pada ${promo.end_date}.` };
  }
  if (status === 'quota_full') {
    return {
      ok: false,
      reason: `Kuota kustomer untuk promo ini (${promo.max_customer_quota} orang) sudah penuh.`,
    };
  }
  if (!promo.eligible_tiers.includes(customer.tier)) {
    return {
      ok: false,
      reason: `Promo ini hanya berlaku untuk tier: ${promo.eligible_tiers.join(', ')}.`,
    };
  }

  const memberClaimCount = logs.filter(
    (log) => log.customer_id === customer.id && log.promo_id === promo.id
  ).length;
  if (memberClaimCount >= promo.max_redemptions_per_member) {
    return {
      ok: false,
      reason: `Batas klaim promo per member (${promo.max_redemptions_per_member}x) sudah tercapai.`,
    };
  }

  return { ok: true };
}
