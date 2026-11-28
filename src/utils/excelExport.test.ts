import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSpreadsheetText } from './ooxmlWriter';
import {
  buildInventoryExcelData,
  buildMenuHppExcelData,
  buildOrdersExcelData,
  buildPurchasingExcelData,
  buildStockOpnameExcelData,
  createExcelWorkbook,
  isIsoDateInRange,
  resolvePeriodDateRange,
} from './excelExport';
import {
  INITIAL_CATEGORIES,
  INITIAL_INVENTORY,
  INITIAL_MENUS,
  INITIAL_OPNAME_LOGS,
  INITIAL_ORDERS,
  INITIAL_PURCHASES,
} from '../data/seedData';

test('resolvePeriodDateRange computes accurate today, 7-day, month, and last-month bounds', () => {
  const ref = new Date(2026, 10, 26, 15, 30, 0); // 2026-11-26 local

  const today = resolvePeriodDateRange('today', ref);
  assert.equal(today.startDate, '2026-11-26');
  assert.equal(today.endDate, '2026-11-26');

  const last7 = resolvePeriodDateRange('last_7_days', ref);
  assert.equal(last7.startDate, '2026-11-20');
  assert.equal(last7.endDate, '2026-11-26');

  const thisMonth = resolvePeriodDateRange('this_month', ref);
  assert.equal(thisMonth.startDate, '2026-11-01');
  assert.equal(thisMonth.endDate, '2026-11-26');

  const lastMonth = resolvePeriodDateRange('last_month', ref);
  assert.equal(lastMonth.startDate, '2026-10-01');
  assert.equal(lastMonth.endDate, '2026-10-31');

  const all = resolvePeriodDateRange('all', ref);
  assert.equal(all.startDate, '');
  assert.equal(all.endDate, '');
});

test('isIsoDateInRange enforces inclusive start/end boundaries', () => {
  assert.equal(isIsoDateInRange('2026-11-15', '2026-11-01', '2026-11-30'), true);
  assert.equal(isIsoDateInRange('2026-11-01', '2026-11-01', '2026-11-30'), true);
  assert.equal(isIsoDateInRange('2026-11-30', '2026-11-01', '2026-11-30'), true);
  assert.equal(isIsoDateInRange('2026-10-31', '2026-11-01', '2026-11-30'), false);
  assert.equal(isIsoDateInRange('2026-12-01', '2026-11-01', '2026-11-30'), false);
  assert.equal(isIsoDateInRange('2026-12-01', '', ''), true);
});

test('buildOrdersExcelData filters orders by date period and generates valid .xlsx bytes', () => {
  const allData = buildOrdersExcelData({
    orders: INITIAL_ORDERS,
    startDate: '',
    endDate: '',
    shopName: 'BrewFlow Coffee',
  });
  assert.equal(allData.recordCount, INITIAL_ORDERS.length);
  assert.equal(allData.sheets.length, 3);
  assert.match(allData.fileName, /^BrewFlow_Coffee_Pesanan_Semua_Periode\.xlsx$/);

  // Filter out all records using a distant past range
  const emptyPeriod = buildOrdersExcelData({
    orders: INITIAL_ORDERS,
    startDate: '2020-01-01',
    endDate: '2020-01-31',
    shopName: 'BrewFlow Coffee',
  });
  assert.equal(emptyPeriod.recordCount, 0);

  // Verify real XLSX binary output starts with PK zip signature & contains EOCD
  const bytes = createExcelWorkbook(allData);
  assert.ok(bytes.byteLength > 500);
  assert.equal(bytes[0], 0x50); // 'P'
  assert.equal(bytes[1], 0x4b); // 'K'
  const textView = new TextDecoder().decode(bytes);
  assert.ok(textView.includes('xl/workbook.xml'));
  assert.ok(textView.includes('xl/worksheets/sheet1.xml'));
  assert.equal(sanitizeSpreadsheetText('=CMD|calc'), "'=CMD|calc");
  assert.equal(sanitizeSpreadsheetText('Normal Kopi'), 'Normal Kopi');
});

test('buildMenuHppExcelData enforces Owner RBAC by stripping HPP & BOM sheets when includeHpp is false', () => {
  const ownerExport = buildMenuHppExcelData({
    menus: INITIAL_MENUS,
    categories: INITIAL_CATEGORIES,
    inventory: INITIAL_INVENTORY,
    orders: INITIAL_ORDERS,
    startDate: '',
    endDate: '',
    includeHpp: true,
    shopName: 'BrewFlow',
  });
  assert.equal(ownerExport.sheets.length, 3);
  assert.equal(ownerExport.sheets[2].name, 'Resep BOM');
  assert.ok('HPP / Porsi (Rp)' in ownerExport.sheets[1].rows[0]);

  const managerExport = buildMenuHppExcelData({
    menus: INITIAL_MENUS,
    categories: INITIAL_CATEGORIES,
    inventory: INITIAL_INVENTORY,
    orders: INITIAL_ORDERS,
    startDate: '',
    endDate: '',
    includeHpp: false,
    shopName: 'BrewFlow',
  });
  assert.equal(managerExport.sheets.length, 2);
  assert.equal('HPP / Porsi (Rp)' in managerExport.sheets[1].rows[0], false);
});

test('buildInventoryExcelData, buildPurchasingExcelData, and buildStockOpnameExcelData return structured multi-sheet reports', () => {
  const invData = buildInventoryExcelData({
    inventory: INITIAL_INVENTORY,
    purchases: INITIAL_PURCHASES,
    opnameLogs: INITIAL_OPNAME_LOGS,
    startDate: '',
    endDate: '',
  });
  assert.equal(invData.sheets.length, 3);
  assert.equal(invData.recordCount, INITIAL_INVENTORY.length);

  const poData = buildPurchasingExcelData({
    purchases: INITIAL_PURCHASES,
    startDate: '',
    endDate: '',
  });
  assert.equal(poData.sheets.length, 3);
  assert.equal(poData.recordCount, INITIAL_PURCHASES.length);

  const opnameData = buildStockOpnameExcelData({
    opnameLogs: INITIAL_OPNAME_LOGS,
    startDate: '',
    endDate: '',
  });
  assert.equal(opnameData.sheets.length, 3);
  assert.equal(opnameData.recordCount, INITIAL_OPNAME_LOGS.length);
});
