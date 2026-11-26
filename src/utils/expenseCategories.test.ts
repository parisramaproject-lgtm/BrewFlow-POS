import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EXPENSE_CATEGORIES,
  getDefaultExpenseCategoryForInventory,
  getExpenseCategory,
  getExpenseCategoryLabel,
  getInventoryTypeForExpenseCategory,
  isInventoryLinkedExpenseCategory,
} from './expenseCategories';
import { applyPurchaseToInventory } from '../services/operationsService';
import type { InventoryItem, PurchaseItemRecord } from '../types';

const REQUIRED_CATEGORY_LABELS = [
  'Pembelian Bahan Baku',
  'Gaji Barista & Karyawan',
  'Sewa Tempat',
  'Listrik/Air/Internet',
  'Gas & Kebersihan',
  'Kemasan & Perlengkapan',
  'Pemasaran & Promo',
  'Komisi Platform Online',
  'Perawatan Mesin',
  'Pajak & Perizinan',
  'Cicilan Pinjaman',
  'Pembelian Asset',
  'Biaya Lain-lain',
];

describe('expenseCategories catalog & helpers', () => {
  it('contains all 13 required Indonesian expense/purchase categories in exact wording', () => {
    assert.equal(EXPENSE_CATEGORIES.length, 13);
    const actualLabels = EXPENSE_CATEGORIES.map((c) => c.label);
    assert.deepEqual(actualLabels, REQUIRED_CATEGORY_LABELS);
  });

  it('classifies stock/asset-linked vs operational categories accurately', () => {
    assert.equal(isInventoryLinkedExpenseCategory('pembelian_bahan_baku'), true);
    assert.equal(isInventoryLinkedExpenseCategory('kemasan_perlengkapan'), true);
    assert.equal(isInventoryLinkedExpenseCategory('pembelian_asset'), true);

    assert.equal(getInventoryTypeForExpenseCategory('pembelian_bahan_baku'), 'raw_material');
    assert.equal(getInventoryTypeForExpenseCategory('kemasan_perlengkapan'), 'packaging');
    assert.equal(getInventoryTypeForExpenseCategory('pembelian_asset'), 'asset');

    const operationalIds = [
      'gaji_karyawan',
      'sewa_tempat',
      'listrik_air_internet',
      'gas_kebersihan',
      'pemasaran_promo',
      'komisi_platform_online',
      'perawatan_mesin',
      'pajak_perizinan',
      'cicilan_pinjaman',
      'biaya_lain_lain',
    ] as const;

    for (const id of operationalIds) {
      assert.equal(isInventoryLinkedExpenseCategory(id), false, `${id} should be non-stock operational`);
      assert.equal(getInventoryTypeForExpenseCategory(id), 'operational', `${id} should map to operational`);
    }
  });

  it('provides safe fallback & inventory-to-expense defaults', () => {
    assert.equal(getExpenseCategory(undefined).id, 'pembelian_bahan_baku');
    assert.equal(getExpenseCategoryLabel('perawatan_mesin'), 'Perawatan Mesin');
    assert.equal(getDefaultExpenseCategoryForInventory('raw_material'), 'pembelian_bahan_baku');
    assert.equal(getDefaultExpenseCategoryForInventory('packaging'), 'kemasan_perlengkapan');
    assert.equal(getDefaultExpenseCategoryForInventory('asset'), 'pembelian_asset');
    assert.equal(getDefaultExpenseCategoryForInventory('operational'), 'gas_kebersihan');
  });
});

describe('applyPurchaseToInventory with non-stock operational expense lines', () => {
  it('ignores non-inventory lines (inventory_item_id: null) while updating linked stock lines', () => {
    const sampleInventory: InventoryItem[] = [
      {
        id: 'raw-beans',
        sku: 'RM-001',
        name: 'Arabica House Blend',
        category_type: 'raw_material',
        expense_category: 'pembelian_bahan_baku',
        unit: 'gram',
        current_stock: 1000,
        min_stock_threshold: 500,
        last_purchase_price: 250,
        updated_at: '2026-11-25T00:00:00.000Z',
      },
    ];

    const lines: PurchaseItemRecord[] = [
      {
        inventory_item_id: null,
        item_name: 'Biaya Listrik PLN & Internet Outlet',
        unit: 'paket',
        quantity: 1,
        unit_price: 1850000,
      },
      {
        inventory_item_id: 'raw-beans',
        item_name: 'Arabica House Blend',
        unit: 'gram',
        quantity: 2000,
        unit_price: 265,
      },
    ];

    const updated = applyPurchaseToInventory(sampleInventory, lines, '2026-11-25T10:00:00.000Z');
    assert.equal(updated.length, 1);
    assert.equal(updated[0].current_stock, 3000);
    assert.equal(updated[0].last_purchase_price, 265);
    assert.equal(updated[0].updated_at, '2026-11-25T10:00:00.000Z');
  });
});
