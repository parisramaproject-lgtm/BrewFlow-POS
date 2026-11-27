import test from 'node:test';
import assert from 'node:assert/strict';
import type { CartItem, InventoryItem, MenuItem } from '../types';
import {
  evaluateMenuStockAvailability,
  formatMissingIngredientsLabel,
} from './menuStockAvailability';

const baseInventory: InventoryItem[] = [
  {
    id: 'inv-beans',
    name: 'Biji Kopi Arabica',
    sku: 'RM-KOP-01',
    category_type: 'raw_material',
    unit: 'gr',
    current_stock: 36,
    min_stock_threshold: 100,
    last_purchase_price: 260,
    updated_at: '2026-11-26T00:00:00Z',
  },
  {
    id: 'inv-milk',
    name: 'Susu Fresh Milk',
    sku: 'RM-SUS-01',
    category_type: 'raw_material',
    unit: 'ml',
    current_stock: 0,
    min_stock_threshold: 500,
    last_purchase_price: 24,
    updated_at: '2026-11-26T00:00:00Z',
  },
  {
    id: 'inv-cup',
    name: 'Cup PET 16oz',
    sku: 'PK-CUP-16',
    category_type: 'packaging',
    unit: 'pcs',
    current_stock: 10,
    min_stock_threshold: 20,
    last_purchase_price: 950,
    updated_at: '2026-11-26T00:00:00Z',
  },
];

const latteMenu: MenuItem = {
  id: 'menu-latte',
  category_id: 'cat-coffee',
  name: 'Iced Caffe Latte',
  description: 'Espresso + Fresh Milk',
  selling_price: 30000,
  is_available: true,
  visual_tone: 'latte',
  recipes: [
    { id: 'r1', menu_id: 'menu-latte', inventory_item_id: 'inv-beans', quantity_needed: 18 },
    { id: 'r2', menu_id: 'menu-latte', inventory_item_id: 'inv-milk', quantity_needed: 150 },
    { id: 'r3', menu_id: 'menu-latte', inventory_item_id: 'inv-cup', quantity_needed: 1 },
  ],
};

const americanoMenu: MenuItem = {
  id: 'menu-americano',
  category_id: 'cat-coffee',
  name: 'Iced Americano',
  description: 'Espresso + Air',
  selling_price: 24000,
  is_available: true,
  visual_tone: 'espresso',
  recipes: [
    { id: 'r4', menu_id: 'menu-americano', inventory_item_id: 'inv-beans', quantity_needed: 18 },
    { id: 'r5', menu_id: 'menu-americano', inventory_item_id: 'inv-cup', quantity_needed: 1 },
  ],
};

test('evaluateMenuStockAvailability blocks menu when any required ingredient is depleted', () => {
  const result = evaluateMenuStockAvailability(latteMenu, baseInventory, []);
  assert.equal(result.isOutOfStock, true);
  assert.equal(result.canAddOneMore, false);
  assert.equal(result.maxServingsFromStock, 0);
  assert.equal(result.missingIngredients.length, 1);
  assert.equal(result.missingIngredients[0].name, 'Susu Fresh Milk');
  assert.equal(
    formatMissingIngredientsLabel(result.missingIngredients),
    'Bahan habis: Susu Fresh Milk'
  );
});

test('evaluateMenuStockAvailability tracks low servings and blocks over-ordering beyond cart reservations', () => {
  // 36gr beans / 18gr per serving = max 2 servings
  const initial = evaluateMenuStockAvailability(americanoMenu, baseInventory, []);
  assert.equal(initial.isOutOfStock, false);
  assert.equal(initial.canAddOneMore, true);
  assert.equal(initial.maxServingsFromStock, 2);
  assert.equal(initial.remainingServingsAfterCart, 2);
  assert.equal(initial.isLowServings, true);

  // Put 2 servings in cart -> cannot add 3rd serving
  const fullCart: CartItem[] = [{ menu: americanoMenu, quantity: 2 }];
  const afterFullCart = evaluateMenuStockAvailability(americanoMenu, baseInventory, fullCart);
  assert.equal(afterFullCart.isOutOfStock, false);
  assert.equal(afterFullCart.canAddOneMore, false);
  assert.equal(afterFullCart.remainingServingsAfterCart, 0);
  assert.equal(afterFullCart.limitingIngredients[0].name, 'Biji Kopi Arabica');
});

test('evaluateMenuStockAvailability treats menus without recipes as available', () => {
  const noRecipeMenu: MenuItem = { ...americanoMenu, id: 'menu-water', recipes: [] };
  const result = evaluateMenuStockAvailability(noRecipeMenu, baseInventory, []);
  assert.equal(result.isOutOfStock, false);
  assert.equal(result.canAddOneMore, true);
  assert.equal(result.maxServingsFromStock, Number.POSITIVE_INFINITY);
});
