import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCartSummary,
  calculateMenuHpp,
  calculateOpnameVariance,
} from './posCalculations';
import type { CartItem, InventoryItem, MenuItem } from '../types';

const sampleMenu: MenuItem = {
  id: 'menu-1',
  category_id: 'cat-coffee',
  name: 'Es Kopi Susu Gula Aren',
  description: 'Espresso blend dengan susu segar dan gula aren organik',
  selling_price: 28000,
  is_available: true,
  visual_tone: 'latte',
  recipes: [
    { id: 'r1', menu_id: 'menu-1', inventory_item_id: 'inv-coffee', quantity_needed: 18 },
    { id: 'r2', menu_id: 'menu-1', inventory_item_id: 'inv-milk', quantity_needed: 120 },
    { id: 'r3', menu_id: 'menu-1', inventory_item_id: 'inv-cup', quantity_needed: 1 },
  ],
};

const sampleInventory: InventoryItem[] = [
  {
    id: 'inv-coffee',
    name: 'Biji Kopi House Blend',
    sku: 'RM-001',
    category_type: 'raw_material',
    unit: 'gr',
    current_stock: 2500,
    min_stock_threshold: 500,
    last_purchase_price: 250,
    updated_at: '2026-11-25T08:00:00Z',
  },
  {
    id: 'inv-milk',
    name: 'Susu Fresh Milk',
    sku: 'RM-002',
    category_type: 'raw_material',
    unit: 'ml',
    current_stock: 8000,
    min_stock_threshold: 2000,
    last_purchase_price: 22,
    updated_at: '2026-11-25T08:00:00Z',
  },
  {
    id: 'inv-cup',
    name: 'Cup Plastik 16oz + Lid',
    sku: 'PK-001',
    category_type: 'packaging',
    unit: 'pcs',
    current_stock: 200,
    min_stock_threshold: 50,
    last_purchase_price: 950,
    updated_at: '2026-11-25T08:00:00Z',
  },
];

test('calculateCartSummary computes subtotal, tax, and total without member', () => {
  const cart: CartItem[] = [{ menu: sampleMenu, quantity: 2 }];
  const summary = calculateCartSummary(cart, null);

  assert.equal(summary.itemCount, 2);
  assert.equal(summary.subtotal, 56000);
  assert.equal(summary.discountAmount, 0);
  assert.equal(summary.taxAmount, 5600);
  assert.equal(summary.totalAmount, 61600);
  assert.equal(summary.pointsEarned, 0);
});

test('calculateCartSummary applies Gold member 10% discount and awards points', () => {
  const cart: CartItem[] = [{ menu: sampleMenu, quantity: 2 }];
  const summary = calculateCartSummary(cart, 'Gold');

  assert.equal(summary.discountRate, 0.1);
  assert.equal(summary.discountAmount, 5600);
  assert.equal(summary.taxableAmount, 50400);
  assert.equal(summary.taxAmount, 5040);
  assert.equal(summary.totalAmount, 55440);
  assert.equal(summary.pointsEarned, 5);
});

test('calculateMenuHpp computes COGS, gross profit, and food cost percentage accurately', () => {
  const result = calculateMenuHpp(sampleMenu.selling_price, sampleMenu.recipes, sampleInventory);
  // 18 * 250 = 4500, 120 * 22 = 2640, 1 * 950 = 950 => 8090
  assert.equal(result.totalHpp, 8090);
  assert.equal(result.grossProfit, 19910);
  assert.equal(Number(result.foodCostPercent.toFixed(1)), 28.9);
});

test('calculateOpnameVariance calculates negative and positive discrepancies', () => {
  assert.equal(calculateOpnameVariance(100, 94.5), -5.5);
  assert.equal(calculateOpnameVariance(50, 52), 2);
  assert.equal(calculateOpnameVariance(25, 25), 0);
});

test('calculateCartSummary sets tax to 0 when taxEnabled is false and supports custom rate', () => {
  const cart: CartItem[] = [{ menu: sampleMenu, quantity: 2 }]; // subtotal 56000
  const noTax = calculateCartSummary(cart, null, { taxEnabled: false, taxPercent: 10 });
  assert.equal(noTax.taxEnabled, false);
  assert.equal(noTax.taxAmount, 0);
  assert.equal(noTax.totalAmount, 56000);

  const customTax = calculateCartSummary(cart, null, { taxEnabled: true, taxPercent: 11 });
  assert.equal(customTax.taxPercent, 11);
  assert.equal(customTax.taxAmount, 6160);
  assert.equal(customTax.totalAmount, 62160);
});

