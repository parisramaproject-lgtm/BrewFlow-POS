import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRecipeStockDeductions, computeUpdatedMember } from './posService';
import type { CartItem, Customer, InventoryItem, MenuItem } from '../types';

const inventory: InventoryItem[] = [
  {
    id: 'inv-beans',
    name: 'Biji Kopi Arabica',
    sku: 'RM-01',
    category_type: 'raw_material',
    unit: 'gr',
    current_stock: 100,
    min_stock_threshold: 20,
    last_purchase_price: 250,
    updated_at: '2026-11-25T08:00:00Z',
  },
  {
    id: 'inv-milk',
    name: 'Susu Segar',
    sku: 'RM-02',
    category_type: 'raw_material',
    unit: 'ml',
    current_stock: 200,
    min_stock_threshold: 50,
    last_purchase_price: 24,
    updated_at: '2026-11-25T08:00:00Z',
  },
];

const kopiSusu: MenuItem = {
  id: 'menu-1',
  category_id: 'cat-coffee',
  name: 'Es Kopi Susu',
  description: 'Kopi susu',
  selling_price: 28000,
  is_available: true,
  visual_tone: 'latte',
  recipes: [
    { id: 'r1', menu_id: 'menu-1', inventory_item_id: 'inv-beans', quantity_needed: 18 },
    { id: 'r2', menu_id: 'menu-1', inventory_item_id: 'inv-milk', quantity_needed: 120 },
  ],
};

test('computeRecipeStockDeductions aggregates ingredients and clamps stock at zero', () => {
  const cart: CartItem[] = [{ menu: kopiSusu, quantity: 2 }];
  const result = computeRecipeStockDeductions(cart, inventory);

  assert.equal(result.deductionsMap.get('inv-beans'), 36);
  assert.equal(result.deductionsMap.get('inv-milk'), 240);

  const updatedBeans = result.updatedInventory.find((i) => i.id === 'inv-beans');
  const updatedMilk = result.updatedInventory.find((i) => i.id === 'inv-milk');
  assert.equal(updatedBeans?.current_stock, 64);
  assert.equal(updatedMilk?.current_stock, 0);
  assert.equal(result.summary.length, 2);
});

test('computeUpdatedMember increments points, total_spent, and upgrades tier at thresholds', () => {
  const silverMember: Customer = {
    id: 'cust-1',
    name: 'Dina',
    phone_number: '08123456',
    email: 'dina@example.com',
    points: 100,
    tier: 'Silver',
    total_spent: 2950000,
    created_at: '2026-01-01T00:00:00Z',
  };

  const upgradedToGold = computeUpdatedMember(silverMember, 80000, 8);
  assert.equal(upgradedToGold.points, 108);
  assert.equal(upgradedToGold.total_spent, 3030000);
  assert.equal(upgradedToGold.tier, 'Gold');

  const upgradedToPlatinum = computeUpdatedMember(upgradedToGold, 5000000, 500);
  assert.equal(upgradedToPlatinum.tier, 'Platinum');
});
