import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPurchaseToInventory,
  getInventoryStockStatus,
  mergeInventoryWithNewItems,
  persistStockOpnameToSupabase,
  removeInventoryAndPruneRecipes,
} from './operationsService';
import { isUuid } from './supabaseHydrationService';
import { getAppSessionToken, setAppSessionToken } from '../lib/supabase';
import { calculateMenuHpp } from '../utils/posCalculations';
import type { InventoryItem, MenuItem, PurchaseItemRecord } from '../types';

const seedInventory: InventoryItem[] = [
  {
    id: 'inv-coffee',
    name: 'Biji Kopi House Blend',
    sku: 'RM-001',
    category_type: 'raw_material',
    unit: 'gr',
    current_stock: 200,
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
    current_stock: 1800,
    min_stock_threshold: 2000,
    last_purchase_price: 22,
    updated_at: '2026-11-25T08:00:00Z',
  },
  {
    id: 'inv-cup',
    name: 'Cup 16oz',
    sku: 'PK-001',
    category_type: 'packaging',
    unit: 'pcs',
    current_stock: 300,
    min_stock_threshold: 50,
    last_purchase_price: 950,
    updated_at: '2026-11-25T08:00:00Z',
  },
  {
    id: 'inv-machine',
    name: 'Mesin Espresso',
    sku: 'AS-001',
    category_type: 'asset',
    unit: 'unit',
    current_stock: 1,
    min_stock_threshold: 0,
    last_purchase_price: 45000000,
    asset_condition: 'Baik',
    updated_at: '2026-11-25T08:00:00Z',
  },
];

const seedMenus: MenuItem[] = [
  {
    id: 'menu-1',
    category_id: 'cat-coffee',
    name: 'Es Kopi Susu',
    description: 'Signature',
    selling_price: 28000,
    is_available: true,
    visual_tone: 'latte',
    recipes: [
      { id: 'r1', menu_id: 'menu-1', inventory_item_id: 'inv-coffee', quantity_needed: 18 },
      { id: 'r2', menu_id: 'menu-1', inventory_item_id: 'inv-milk', quantity_needed: 120 },
      { id: 'r3', menu_id: 'menu-1', inventory_item_id: 'inv-cup', quantity_needed: 1 },
    ],
  },
];

test('getInventoryStockStatus distinguishes critical, low, ok, and asset rows', () => {
  assert.equal(getInventoryStockStatus(seedInventory[0]), 'critical'); // 200 <= 250 (50% of 500)
  assert.equal(getInventoryStockStatus(seedInventory[1]), 'low'); // 1800 <= 2000
  assert.equal(getInventoryStockStatus(seedInventory[2]), 'ok'); // 300 > 50
  assert.equal(getInventoryStockStatus(seedInventory[3]), 'asset');
});

test('applyPurchaseToInventory increments stock, updates last_purchase_price, and cascades to HPP', () => {
  const beforeHpp = calculateMenuHpp(
    seedMenus[0].selling_price,
    seedMenus[0].recipes,
    seedInventory
  );
  // 18*250 + 120*22 + 1*950 = 4500 + 2640 + 950 = 8090
  assert.equal(beforeHpp.totalHpp, 8090);

  const lines: PurchaseItemRecord[] = [
    {
      inventory_item_id: 'inv-coffee',
      item_name: 'Biji Kopi House Blend',
      unit: 'gr',
      quantity: 1000,
      unit_price: 300,
    },
    {
      inventory_item_id: 'inv-milk',
      item_name: 'Susu Fresh Milk',
      unit: 'ml',
      quantity: 2000,
      unit_price: 25,
    },
  ];

  const updated = applyPurchaseToInventory(seedInventory, lines, '2026-11-25T10:00:00Z');
  const coffee = updated.find((i) => i.id === 'inv-coffee');
  const milk = updated.find((i) => i.id === 'inv-milk');
  assert.equal(coffee?.current_stock, 1200);
  assert.equal(coffee?.last_purchase_price, 300);
  assert.equal(milk?.current_stock, 3800);
  assert.equal(milk?.last_purchase_price, 25);

  const afterHpp = calculateMenuHpp(seedMenus[0].selling_price, seedMenus[0].recipes, updated);
  // 18*300 + 120*25 + 1*950 = 5400 + 3000 + 950 = 9350
  assert.equal(afterHpp.totalHpp, 9350);
  assert.equal(afterHpp.grossProfit, 28000 - 9350);
});

test('removeInventoryAndPruneRecipes deletes item and cleans recipe references', () => {
  const result = removeInventoryAndPruneRecipes(seedInventory, seedMenus, 'inv-milk');
  assert.equal(result.inventory.length, 3);
  assert.equal(result.affectedMenuCount, 1);
  assert.equal(result.menus[0].recipes.length, 2);
  assert.equal(
    result.menus[0].recipes.some((r) => r.inventory_item_id === 'inv-milk'),
    false
  );
});

test('isUuid accurately distinguishes Supabase UUIDs from local seed IDs', () => {
  assert.equal(isUuid('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isUuid('inv-1'), false);
  assert.equal(isUuid('sch-1'), false);
  assert.equal(isUuid(''), false);
  assert.equal(isUuid(null), false);
});

test('appSessionToken accepts 64-hex tokens in memory, rejects malformed ones, and clears safely', () => {
  const validHex64 = 'a'.repeat(64);
  setAppSessionToken(`  ${validHex64}  `);
  assert.equal(getAppSessionToken(), validHex64);
  setAppSessionToken('too-short');
  assert.equal(getAppSessionToken(), null);
  setAppSessionToken(null);
  assert.equal(getAppSessionToken(), null);
});

test('persistStockOpnameToSupabase returns local synced status when Supabase sync disabled', async () => {
  const status = await persistStockOpnameToSupabase({
    log: {
      id: 'oplog-1',
      schedule_id: 'sch-1',
      schedule_title: 'Opname Harian',
      performed_by_name: 'Budi',
      notes: 'Tes',
      total_items_checked: 1,
      discrepancy_count: 1,
      completed_at: '2026-11-26T10:00:00Z',
    },
    performedById: 'emp-1',
    details: [
      {
        inventory_item_id: 'inv-coffee',
        item_name: 'Biji Kopi House Blend',
        sku: 'RM-001',
        unit: 'gr',
        system_stock: 200,
        actual_stock: 180,
        variance: -20,
        unit_price: 250,
      },
    ],
    enableSupabaseSync: false,
  });
  assert.equal(status.mode, 'local');
  assert.equal(status.synced, true);
});

test('mergeInventoryWithNewItems + applyPurchaseToInventory adds new Lainnya item and increments its stock cleanly', () => {
  const newItem: InventoryItem = {
    id: 'inv-new-hazelnut',
    name: 'Sirup Hazelnut Monin',
    sku: 'RM-901',
    category_type: 'raw_material',
    expense_category: 'pembelian_bahan_baku',
    unit: 'ml',
    current_stock: 0,
    min_stock_threshold: 250,
    last_purchase_price: 180,
    updated_at: '2026-11-26T10:00:00Z',
  };

  const merged = mergeInventoryWithNewItems(seedInventory, [newItem]);
  assert.equal(merged.length, seedInventory.length + 1);
  // Deduplicates if already present
  assert.equal(mergeInventoryWithNewItems(merged, [newItem]).length, merged.length);

  const lines: PurchaseItemRecord[] = [
    {
      inventory_item_id: 'inv-new-hazelnut',
      item_name: 'Sirup Hazelnut Monin',
      unit: 'ml',
      quantity: 750,
      unit_price: 185,
    },
  ];
  const afterPurchase = applyPurchaseToInventory(merged, lines, '2026-11-26T10:05:00Z');
  const created = afterPurchase.find((i) => i.id === 'inv-new-hazelnut');
  assert.equal(created?.current_stock, 750);
  assert.equal(created?.last_purchase_price, 185);
  assert.equal(created?.category_type, 'raw_material');
});

