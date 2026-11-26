import type { CartItem, MenuItem, VoucherRecord, VoucherSchemeType } from '../types';
import { formatRupiah } from './format';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const DAY_LABELS_SHORT = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'] as const;

export const RUSH_HOUR_PRESETS = [
  { id: 'morning', label: 'Kopi Pagi', startTime: '07:00', endTime: '10:00' },
  { id: 'lunch', label: 'Jam Siang', startTime: '11:30', endTime: '14:00' },
  { id: 'afternoon', label: 'Sore Santai', startTime: '15:00', endTime: '18:00' },
  { id: 'evening', label: 'Malam Ramai', startTime: '19:00', endTime: '22:00' },
  { id: 'allday', label: 'Sepanjang Hari', startTime: '00:00', endTime: '23:59' },
] as const;

export const VOUCHER_SCHEME_LABELS: Record<VoucherSchemeType, string> = {
  percentage_discount: 'Potongan Persen (%)',
  fixed_discount: 'Potongan Nominal (Rp)',
  special_item_price: 'Harga Spesial Item',
  buy_x_get_y: 'Beli X Gratis Y',
  bundle_price: 'Harga Paket / Bundling',
};

export function normalizeVoucherCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

function randomCodeSegment(length: number): string {
  let out = '';
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    for (let i = 0; i < length; i += 1) {
      out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    return out;
  }
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export function generateVoucherCode(prefix = 'RUSH', segmentLength = 6): string {
  const cleanPrefix = normalizeVoucherCode(prefix).slice(0, 12);
  const seg = randomCodeSegment(Math.max(4, Math.min(10, segmentLength)));
  return cleanPrefix ? `${cleanPrefix}-${seg}` : seg;
}

export function generateBatchVoucherCodes(
  prefix: string,
  count: number,
  existingCodes: Iterable<string> = [],
  segmentLength = 6
): string[] {
  const safeCount = Math.max(1, Math.min(100, Math.floor(count)));
  const taken = new Set<string>();
  for (const c of existingCodes) {
    const norm = normalizeVoucherCode(c);
    if (norm) taken.add(norm);
  }

  const generated: string[] = [];
  let attempts = 0;
  const maxAttempts = safeCount * 20;

  while (generated.length < safeCount && attempts < maxAttempts) {
    attempts += 1;
    const candidate = generateVoucherCode(prefix, segmentLength);
    if (!taken.has(candidate)) {
      taken.add(candidate);
      generated.push(candidate);
    }
  }

  return generated;
}

export function formatLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseTimeToMinutes(timeStr: string): number {
  const [hStr, mStr] = (timeStr || '00:00').split(':');
  const h = Math.max(0, Math.min(23, Number(hStr) || 0));
  const m = Math.max(0, Math.min(59, Number(mStr) || 0));
  return h * 60 + m;
}

export function formatDateIdShort(ymd: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(dt);
}

export type VoucherAvailabilityStatus =
  | 'active'
  | 'scheduled'
  | 'expired'
  | 'outside_hours'
  | 'outside_day'
  | 'quota_exhausted'
  | 'inactive';

export interface VoucherAvailabilityResult {
  active: boolean;
  status: VoucherAvailabilityStatus;
  label: string;
  reason?: string;
}

export function getVoucherAvailability(
  voucher: VoucherRecord,
  now: Date = new Date()
): VoucherAvailabilityResult {
  if (!voucher.is_active) {
    return {
      active: false,
      status: 'inactive',
      label: 'Nonaktif',
      reason: `Voucher ${voucher.code} sedang dinonaktifkan.`,
    };
  }

  if (voucher.max_usage_quota > 0 && voucher.used_count >= voucher.max_usage_quota) {
    return {
      active: false,
      status: 'quota_exhausted',
      label: 'Kuota Habis',
      reason: `Kuota pemakaian voucher ${voucher.code} sudah habis (${voucher.used_count}/${voucher.max_usage_quota}).`,
    };
  }

  const todayKey = formatLocalDateKey(now);
  if (voucher.valid_from_date && todayKey < voucher.valid_from_date) {
    return {
      active: false,
      status: 'scheduled',
      label: 'Terjadwal',
      reason: `Voucher ${voucher.code} baru berlaku mulai ${formatDateIdShort(voucher.valid_from_date)}.`,
    };
  }

  if (voucher.valid_until_date && todayKey > voucher.valid_until_date) {
    return {
      active: false,
      status: 'expired',
      label: 'Kedaluwarsa',
      reason: `Masa berlaku voucher ${voucher.code} berakhir pada ${formatDateIdShort(voucher.valid_until_date)}.`,
    };
  }

  const allowedDays =
    Array.isArray(voucher.active_days) && voucher.active_days.length > 0
      ? voucher.active_days
      : [0, 1, 2, 3, 4, 5, 6];
  const currentDay = now.getDay();
  if (!allowedDays.includes(currentDay)) {
    const dayNames = allowedDays
      .slice()
      .sort((a, b) => a - b)
      .map((d) => DAY_LABELS_SHORT[d])
      .join(', ');
    return {
      active: false,
      status: 'outside_day',
      label: 'Di Luar Hari',
      reason: `Voucher ${voucher.code} hanya berlaku di hari ${dayNames}.`,
    };
  }

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = parseTimeToMinutes(voucher.start_time || '00:00');
  const endMinutes = parseTimeToMinutes(voucher.end_time || '23:59');

  const withinHours =
    startMinutes <= endMinutes
      ? nowMinutes >= startMinutes && nowMinutes <= endMinutes
      : nowMinutes >= startMinutes || nowMinutes <= endMinutes;

  if (!withinHours) {
    return {
      active: false,
      status: 'outside_hours',
      label: 'Di Luar Jam',
      reason: `Voucher ${voucher.code} hanya berlaku pada jam ${voucher.start_time}–${voucher.end_time}.`,
    };
  }

  return {
    active: true,
    status: 'active',
    label: 'Aktif Sekarang',
  };
}

export interface VoucherEvaluationResult {
  valid: boolean;
  discountAmount: number;
  matchedItemCount: number;
  summaryLabel: string;
  error?: string;
}

export function evaluateVoucherOnCart(
  voucher: VoucherRecord,
  cart: CartItem[],
  now: Date = new Date(),
  menusCatalog: MenuItem[] = []
): VoucherEvaluationResult {
  const availability = getVoucherAvailability(voucher, now);
  if (!availability.active) {
    return {
      valid: false,
      discountAmount: 0,
      matchedItemCount: 0,
      summaryLabel: '',
      error: availability.reason || 'Voucher tidak dapat digunakan saat ini.',
    };
  }

  if (cart.length === 0) {
    return {
      valid: false,
      discountAmount: 0,
      matchedItemCount: 0,
      summaryLabel: '',
      error: 'Tambahkan minimal 1 menu ke keranjang sebelum menerapkan voucher.',
    };
  }

  const cartSubtotal = cart.reduce((sum, item) => sum + item.menu.selling_price * item.quantity, 0);
  if (voucher.min_purchase_amount > 0 && cartSubtotal < voucher.min_purchase_amount) {
    return {
      valid: false,
      discountAmount: 0,
      matchedItemCount: 0,
      summaryLabel: '',
      error: `Minimal belanja ${formatRupiah(voucher.min_purchase_amount)} untuk menggunakan voucher ${voucher.code}.`,
    };
  }

  const targetIds = Array.isArray(voucher.target_menu_ids) ? voucher.target_menu_ids : [];
  const hasMenuFilter = targetIds.length > 0;
  const eligibleItems = hasMenuFilter
    ? cart.filter((item) => targetIds.includes(item.menu.id))
    : cart;

  const eligibleItemCount = eligibleItems.reduce((sum, item) => sum + item.quantity, 0);
  const eligibleSubtotal = eligibleItems.reduce(
    (sum, item) => sum + item.menu.selling_price * item.quantity,
    0
  );

  if (hasMenuFilter && eligibleItemCount === 0) {
    const names = menusCatalog
      .filter((m) => targetIds.includes(m.id))
      .map((m) => m.name)
      .slice(0, 3);
    const hint = names.length > 0 ? ` (${names.join(', ')}${targetIds.length > 3 ? ', dll.' : ''})` : '';
    return {
      valid: false,
      discountAmount: 0,
      matchedItemCount: 0,
      summaryLabel: '',
      error: `Voucher ${voucher.code} hanya berlaku untuk menu pilihan tertentu${hint}.`,
    };
  }

  switch (voucher.scheme_type) {
    case 'percentage_discount': {
      const pct = Math.max(0, Math.min(100, Number(voucher.discount_percent) || 0));
      let rawDiscount = Math.round(eligibleSubtotal * (pct / 100));
      if (voucher.max_discount_amount && voucher.max_discount_amount > 0) {
        rawDiscount = Math.min(rawDiscount, voucher.max_discount_amount);
      }
      const discountAmount = Math.min(cartSubtotal, Math.max(0, rawDiscount));
      return {
        valid: discountAmount > 0,
        discountAmount,
        matchedItemCount: eligibleItemCount,
        summaryLabel: `Potongan ${pct}%${voucher.max_discount_amount ? ` (maks ${formatRupiah(voucher.max_discount_amount)})` : ''}`,
        error: discountAmount > 0 ? undefined : 'Nominal potongan voucher adalah Rp 0.',
      };
    }

    case 'fixed_discount': {
      const fixed = Math.max(0, Number(voucher.discount_amount) || 0);
      const discountAmount = Math.min(eligibleSubtotal, fixed);
      return {
        valid: discountAmount > 0,
        discountAmount,
        matchedItemCount: eligibleItemCount,
        summaryLabel: `Potongan ${formatRupiah(fixed)}`,
        error: discountAmount > 0 ? undefined : 'Nominal potongan voucher adalah Rp 0.',
      };
    }

    case 'special_item_price': {
      const specialPrice = Math.max(0, Number(voucher.special_price) || 0);
      let discountAmount = 0;
      let discountedUnits = 0;
      for (const item of eligibleItems) {
        if (item.menu.selling_price > specialPrice) {
          discountAmount += (item.menu.selling_price - specialPrice) * item.quantity;
          discountedUnits += item.quantity;
        }
      }
      if (discountedUnits === 0) {
        return {
          valid: false,
          discountAmount: 0,
          matchedItemCount: 0,
          summaryLabel: '',
          error: `Harga menu di keranjang sudah lebih rendah atau sama dengan harga spesial ${formatRupiah(specialPrice)}.`,
        };
      }
      return {
        valid: true,
        discountAmount: Math.min(cartSubtotal, Math.round(discountAmount)),
        matchedItemCount: discountedUnits,
        summaryLabel: `Harga Spesial ${formatRupiah(specialPrice)} (${discountedUnits} item)`,
      };
    }

    case 'buy_x_get_y': {
      const buyQty = Math.max(1, Math.floor(Number(voucher.buy_quantity) || 1));
      const freeQty = Math.max(1, Math.floor(Number(voucher.free_quantity) || 1));
      const groupSize = buyQty + freeQty;

      if (eligibleItemCount < groupSize) {
        return {
          valid: false,
          discountAmount: 0,
          matchedItemCount: eligibleItemCount,
          summaryLabel: '',
          error: `Tambah minimal ${groupSize} item menu promo untuk menikmati Beli ${buyQty} Gratis ${freeQty}.`,
        };
      }

      const unitPrices: number[] = [];
      for (const item of eligibleItems) {
        for (let i = 0; i < item.quantity; i += 1) {
          unitPrices.push(item.menu.selling_price);
        }
      }
      unitPrices.sort((a, b) => a - b); // cheapest eligible units become free

      const totalFreeUnits = Math.floor(unitPrices.length / groupSize) * freeQty;
      let discountAmount = 0;
      for (let i = 0; i < totalFreeUnits; i += 1) {
        discountAmount += unitPrices[i];
      }

      return {
        valid: discountAmount > 0,
        discountAmount: Math.min(cartSubtotal, Math.round(discountAmount)),
        matchedItemCount: totalFreeUnits,
        summaryLabel: `Beli ${buyQty} Gratis ${freeQty} (${totalFreeUnits} item gratis)`,
      };
    }

    case 'bundle_price': {
      const bundleQty = Math.max(2, Math.floor(Number(voucher.bundle_quantity) || 2));
      const bundlePrice = Math.max(0, Number(voucher.bundle_price) || 0);

      if (eligibleItemCount < bundleQty) {
        return {
          valid: false,
          discountAmount: 0,
          matchedItemCount: eligibleItemCount,
          summaryLabel: '',
          error: `Pilih minimal ${bundleQty} item promo untuk mendapatkan Harga Paket ${formatRupiah(bundlePrice)}.`,
        };
      }

      const unitPrices: number[] = [];
      for (const item of eligibleItems) {
        for (let i = 0; i < item.quantity; i += 1) {
          unitPrices.push(item.menu.selling_price);
        }
      }
      // Group highest-priced eligible units first to maximize savings transparently
      unitPrices.sort((a, b) => b - a);

      const bundleCount = Math.floor(unitPrices.length / bundleQty);
      let discountAmount = 0;
      for (let b = 0; b < bundleCount; b += 1) {
        const groupSum = unitPrices
          .slice(b * bundleQty, (b + 1) * bundleQty)
          .reduce((acc, price) => acc + price, 0);
        if (groupSum > bundlePrice) {
          discountAmount += groupSum - bundlePrice;
        }
      }

      if (discountAmount <= 0) {
        return {
          valid: false,
          discountAmount: 0,
          matchedItemCount: eligibleItemCount,
          summaryLabel: '',
          error: `Total harga normal item sudah lebih hemat daripada harga paket ${formatRupiah(bundlePrice)}.`,
        };
      }

      return {
        valid: true,
        discountAmount: Math.min(cartSubtotal, Math.round(discountAmount)),
        matchedItemCount: bundleCount * bundleQty,
        summaryLabel: `Paket ${bundleQty} item ${formatRupiah(bundlePrice)} (${bundleCount}x)`,
      };
    }
  }
}

export function formatVoucherSchemeSummary(voucher: VoucherRecord, menus: MenuItem[] = []): string {
  const targetCount = voucher.target_menu_ids?.length ?? 0;
  const scopeText =
    targetCount === 0
      ? 'Semua menu'
      : targetCount === 1
        ? menus.find((m) => m.id === voucher.target_menu_ids[0])?.name || '1 menu pilihan'
        : `${targetCount} menu pilihan`;

  switch (voucher.scheme_type) {
    case 'percentage_discount': {
      const cap =
        voucher.max_discount_amount && voucher.max_discount_amount > 0
          ? ` (maks ${formatRupiah(voucher.max_discount_amount)})`
          : '';
      return `Diskon ${voucher.discount_percent ?? 0}%${cap} · ${scopeText}`;
    }
    case 'fixed_discount':
      return `Potongan ${formatRupiah(voucher.discount_amount ?? 0)} · ${scopeText}`;
    case 'special_item_price':
      return `Harga Spesial ${formatRupiah(voucher.special_price ?? 0)}/item · ${scopeText}`;
    case 'buy_x_get_y':
      return `Beli ${voucher.buy_quantity ?? 1} Gratis ${voucher.free_quantity ?? 1} · ${scopeText}`;
    case 'bundle_price':
      return `Paket ${voucher.bundle_quantity ?? 2} item ${formatRupiah(voucher.bundle_price ?? 0)} · ${scopeText}`;
  }
}

export function formatVoucherDaysSummary(days: number[]): string {
  if (!days || days.length === 0 || days.length === 7) return 'Setiap hari';
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.join(',') === '1,2,3,4,5') return 'Sen–Jum';
  if (sorted.join(',') === '0,6') return 'Akhir Pekan';
  return sorted.map((d) => DAY_LABELS_SHORT[d]).join(', ');
}
