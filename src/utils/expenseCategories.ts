import type { ExpenseCategoryId, ItemCategoryType } from '../types';

export interface ExpenseCategoryDefinition {
  id: ExpenseCategoryId;
  label: string;
  inventoryCategoryType: ItemCategoryType;
  /** True when purchases in this category normally link to tracked stock/asset items */
  isInventoryLinked: boolean;
  group: 'stock_asset' | 'operational';
}

export const EXPENSE_CATEGORIES: ExpenseCategoryDefinition[] = [
  {
    id: 'pembelian_bahan_baku',
    label: 'Pembelian Bahan Baku',
    inventoryCategoryType: 'raw_material',
    isInventoryLinked: true,
    group: 'stock_asset',
  },
  {
    id: 'gaji_karyawan',
    label: 'Gaji Barista & Karyawan',
    inventoryCategoryType: 'operational',
    isInventoryLinked: false,
    group: 'operational',
  },
  {
    id: 'sewa_tempat',
    label: 'Sewa Tempat',
    inventoryCategoryType: 'operational',
    isInventoryLinked: false,
    group: 'operational',
  },
  {
    id: 'listrik_air_internet',
    label: 'Listrik/Air/Internet',
    inventoryCategoryType: 'operational',
    isInventoryLinked: false,
    group: 'operational',
  },
  {
    id: 'gas_kebersihan',
    label: 'Gas & Kebersihan',
    inventoryCategoryType: 'operational',
    isInventoryLinked: false,
    group: 'operational',
  },
  {
    id: 'kemasan_perlengkapan',
    label: 'Kemasan & Perlengkapan',
    inventoryCategoryType: 'packaging',
    isInventoryLinked: true,
    group: 'stock_asset',
  },
  {
    id: 'pemasaran_promo',
    label: 'Pemasaran & Promo',
    inventoryCategoryType: 'operational',
    isInventoryLinked: false,
    group: 'operational',
  },
  {
    id: 'komisi_platform_online',
    label: 'Komisi Platform Online',
    inventoryCategoryType: 'operational',
    isInventoryLinked: false,
    group: 'operational',
  },
  {
    id: 'perawatan_mesin',
    label: 'Perawatan Mesin',
    inventoryCategoryType: 'operational',
    isInventoryLinked: false,
    group: 'operational',
  },
  {
    id: 'pajak_perizinan',
    label: 'Pajak & Perizinan',
    inventoryCategoryType: 'operational',
    isInventoryLinked: false,
    group: 'operational',
  },
  {
    id: 'cicilan_pinjaman',
    label: 'Cicilan Pinjaman',
    inventoryCategoryType: 'operational',
    isInventoryLinked: false,
    group: 'operational',
  },
  {
    id: 'pembelian_asset',
    label: 'Pembelian Asset',
    inventoryCategoryType: 'asset',
    isInventoryLinked: true,
    group: 'stock_asset',
  },
  {
    id: 'biaya_lain_lain',
    label: 'Biaya Lain-lain',
    inventoryCategoryType: 'operational',
    isInventoryLinked: false,
    group: 'operational',
  },
];

const CATEGORY_MAP = new Map(EXPENSE_CATEGORIES.map((c) => [c.id, c]));

export function getExpenseCategory(id?: ExpenseCategoryId): ExpenseCategoryDefinition {
  if (id && CATEGORY_MAP.has(id)) {
    return CATEGORY_MAP.get(id)!;
  }
  return EXPENSE_CATEGORIES[0];
}

export function getExpenseCategoryLabel(id?: ExpenseCategoryId): string {
  return getExpenseCategory(id).label;
}

export function getDefaultExpenseCategoryForInventory(
  categoryType: ItemCategoryType
): ExpenseCategoryId {
  switch (categoryType) {
    case 'raw_material':
      return 'pembelian_bahan_baku';
    case 'packaging':
      return 'kemasan_perlengkapan';
    case 'asset':
      return 'pembelian_asset';
    case 'operational':
      return 'gas_kebersihan';
  }
}

export function getInventoryTypeForExpenseCategory(id: ExpenseCategoryId): ItemCategoryType {
  return getExpenseCategory(id).inventoryCategoryType;
}

export function isInventoryLinkedExpenseCategory(id: ExpenseCategoryId): boolean {
  return getExpenseCategory(id).isInventoryLinked;
}
