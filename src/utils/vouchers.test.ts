import assert from 'node:assert/strict';
import test from 'node:test';
import type { CartItem, MenuItem, VoucherRecord } from '../types';
import {
  evaluateVoucherOnCart,
  generateBatchVoucherCodes,
  generateVoucherCode,
  getVoucherAvailability,
  normalizeVoucherCode,
} from './vouchers';

const menuAren: MenuItem = {
  id: 'menu-1',
  category_id: 'cat-coffee',
  name: 'Es Kopi Susu Gula Aren',
  description: '',
  selling_price: 28000,
  is_available: true,
  visual_tone: 'latte',
  recipes: [],
};

const menuLatte: MenuItem = {
  id: 'menu-3',
  category_id: 'cat-coffee',
  name: 'Hot Caffe Latte',
  description: '',
  selling_price: 32000,
  is_available: true,
  visual_tone: 'latte',
  recipes: [],
};

const menuCroissant: MenuItem = {
  id: 'menu-7',
  category_id: 'cat-snack',
  name: 'Butter Croissant',
  description: '',
  selling_price: 24000,
  is_available: true,
  visual_tone: 'pastry',
  recipes: [],
};

function makeBaseVoucher(overrides: Partial<VoucherRecord> = {}): VoucherRecord {
  return {
    id: 'v-1',
    code: 'RUSH-TEST01',
    title: 'Rush Hour Kopi Pagi',
    description: 'Promo jam ramai pagi',
    scheme_type: 'percentage_discount',
    discount_percent: 20,
    max_discount_amount: 15000,
    target_menu_ids: [],
    min_purchase_amount: 0,
    valid_from_date: '2026-11-01',
    valid_until_date: '2026-12-31',
    start_time: '07:00',
    end_time: '10:00',
    active_days: [1, 2, 3, 4, 5],
    max_usage_quota: 50,
    used_count: 5,
    stackable_with_member_discount: false,
    is_rush_hour: true,
    is_active: true,
    created_at: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

test('normalizeVoucherCode and generateBatchVoucherCodes produce unique readable codes', () => {
  assert.equal(normalizeVoucherCode('  rush pagi!! 20 '), 'RUSHPAGI20');
  const single = generateVoucherCode('RUSH', 6);
  assert.match(single, /^RUSH-[A-Z2-9]{6}$/);

  const batch = generateBatchVoucherCodes('PAGI', 15, ['PAGI-AAAAAA']);
  assert.equal(batch.length, 15);
  assert.equal(new Set(batch).size, 15);
  assert.ok(batch.every((code) => code.startsWith('PAGI-')));
});

test('getVoucherAvailability enforces date window, rush hour clock window, weekday, and quota', () => {
  const voucher = makeBaseVoucher();

  // Thursday 2026-11-26 at 08:30 local -> ACTIVE
  const activeTime = new Date(2026, 10, 26, 8, 30);
  assert.equal(getVoucherAvailability(voucher, activeTime).active, true);

  // Thursday 2026-11-26 at 11:15 -> OUTSIDE HOURS
  const outsideHours = new Date(2026, 10, 26, 11, 15);
  assert.equal(getVoucherAvailability(voucher, outsideHours).status, 'outside_hours');

  // Sunday 2026-11-29 at 08:30 -> OUTSIDE DAY (only Mon-Fri)
  const sunday = new Date(2026, 10, 29, 8, 30);
  assert.equal(getVoucherAvailability(voucher, sunday).status, 'outside_day');

  // Before start date -> SCHEDULED
  const beforeDate = new Date(2026, 9, 25, 8, 30);
  assert.equal(getVoucherAvailability(voucher, beforeDate).status, 'scheduled');

  // After end date -> EXPIRED
  const afterDate = new Date(2027, 0, 5, 8, 30);
  assert.equal(getVoucherAvailability(voucher, afterDate).status, 'expired');

  // Exhausted quota -> QUOTA EXHAUSTED
  const fullVoucher = makeBaseVoucher({ max_usage_quota: 10, used_count: 10 });
  assert.equal(getVoucherAvailability(fullVoucher, activeTime).status, 'quota_exhausted');
});

test('getVoucherAvailability supports overnight rush hour windows (e.g. 22:00 to 02:00)', () => {
  const nightVoucher = makeBaseVoucher({
    start_time: '22:00',
    end_time: '02:00',
    active_days: [0, 1, 2, 3, 4, 5, 6],
  });
  assert.equal(getVoucherAvailability(nightVoucher, new Date(2026, 10, 26, 23, 15)).active, true);
  assert.equal(getVoucherAvailability(nightVoucher, new Date(2026, 10, 26, 1, 30)).active, true);
  assert.equal(
    getVoucherAvailability(nightVoucher, new Date(2026, 10, 26, 14, 0)).status,
    'outside_hours'
  );
});

test('evaluateVoucherOnCart computes percentage discount with cap and min purchase check', () => {
  const now = new Date(2026, 10, 26, 8, 30);
  const voucher = makeBaseVoucher({
    scheme_type: 'percentage_discount',
    discount_percent: 25,
    max_discount_amount: 15000,
    min_purchase_amount: 50000,
  });

  // Below min purchase (28,000 < 50,000)
  const smallCart: CartItem[] = [{ menu: menuAren, quantity: 1 }];
  const rejected = evaluateVoucherOnCart(voucher, smallCart, now);
  assert.equal(rejected.valid, false);
  assert.match(rejected.error ?? '', /Minimal belanja/);

  // 28,000 * 3 = 84,000 -> 25% = 21,000, capped at 15,000
  const bigCart: CartItem[] = [{ menu: menuAren, quantity: 3 }];
  const applied = evaluateVoucherOnCart(voucher, bigCart, now);
  assert.equal(applied.valid, true);
  assert.equal(applied.discountAmount, 15000);
});

test('evaluateVoucherOnCart computes special_item_price strictly on target menus', () => {
  const now = new Date(2026, 10, 26, 8, 30);
  const voucher = makeBaseVoucher({
    scheme_type: 'special_item_price',
    special_price: 18000,
    target_menu_ids: ['menu-1', 'menu-3'],
  });

  // Only non-eligible item in cart
  const onlyPastry: CartItem[] = [{ menu: menuCroissant, quantity: 2 }];
  assert.equal(
    evaluateVoucherOnCart(voucher, onlyPastry, now, [menuAren, menuLatte, menuCroissant]).valid,
    false
  );

  // 2x Aren (28k -> 18k = -20k) + 1x Latte (32k -> 18k = -14k) + 1x Croissant (unchanged) => -34k
  const mixedCart: CartItem[] = [
    { menu: menuAren, quantity: 2 },
    { menu: menuLatte, quantity: 1 },
    { menu: menuCroissant, quantity: 1 },
  ];
  const res = evaluateVoucherOnCart(voucher, mixedCart, now);
  assert.equal(res.valid, true);
  assert.equal(res.discountAmount, 34000);
  assert.equal(res.matchedItemCount, 3);
});

test('evaluateVoucherOnCart computes buy_x_get_y and bundle_price accurately', () => {
  const now = new Date(2026, 10, 26, 8, 30);

  // Buy 1 Get 1 on Coffee: 1x Latte (32k) + 1x Aren (28k) => free cheapest (28k)
  const bogo = makeBaseVoucher({
    scheme_type: 'buy_x_get_y',
    buy_quantity: 1,
    free_quantity: 1,
    target_menu_ids: ['menu-1', 'menu-3'],
  });
  const cart: CartItem[] = [
    { menu: menuLatte, quantity: 1 },
    { menu: menuAren, quantity: 1 },
  ];
  const bogoRes = evaluateVoucherOnCart(bogo, cart, now);
  assert.equal(bogoRes.valid, true);
  assert.equal(bogoRes.discountAmount, 28000);

  // Bundle 2 items for 40,000: 32k + 28k = 60k -> 40k => saves 20,000
  const bundle = makeBaseVoucher({
    scheme_type: 'bundle_price',
    bundle_quantity: 2,
    bundle_price: 40000,
    target_menu_ids: ['menu-1', 'menu-3'],
  });
  const bundleRes = evaluateVoucherOnCart(bundle, cart, now);
  assert.equal(bundleRes.valid, true);
  assert.equal(bundleRes.discountAmount, 20000);
});
