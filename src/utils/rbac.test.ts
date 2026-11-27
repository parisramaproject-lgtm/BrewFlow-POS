import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessPage,
  canManageEmployees,
  canManageMembershipProgram,
  canManageOpnameSchedules,
  canManageVendors,
  canManageVouchers,
  canViewHPP,
  getVisibleNavItems,
} from './rbac';

test('owner has full access to all 13 pages and sensitive features', () => {
  const ownerNav = getVisibleNavItems('owner');
  assert.equal(ownerNav.length, 13);
  assert.equal(canAccessPage('owner', 'employees'), true);
  assert.equal(canAccessPage('owner', 'menu-hpp'), true);
  assert.equal(canAccessPage('owner', 'vendors'), true);
  assert.equal(canAccessPage('owner', 'settings'), true);
  assert.equal(canAccessPage('owner', 'tv-display'), true);
  assert.equal(canAccessPage('owner', 'vouchers'), true);
  assert.equal(canViewHPP('owner'), true);
  assert.equal(canManageEmployees('owner'), true);
  assert.equal(canManageOpnameSchedules('owner'), true);
  assert.equal(canManageMembershipProgram('owner'), true);
  assert.equal(canManageVouchers('owner'), true);
  assert.equal(canManageVendors('owner'), true);
});

test('manager can access vendors, tv-display, and manage vouchers but cannot see employees, HPP, opname schedules, or membership promo settings', () => {
  const managerNav = getVisibleNavItems('manager');
  const ids = managerNav.map((item) => item.id);
  assert.equal(ids.includes('employees'), false);
  assert.equal(ids.includes('vendors'), true);
  assert.equal(ids.includes('tv-display'), true);
  assert.equal(ids.includes('vouchers'), true);
  assert.equal(canAccessPage('manager', 'employees'), false);
  assert.equal(canAccessPage('manager', 'vendors'), true);
  assert.equal(canAccessPage('manager', 'tv-display'), true);
  assert.equal(canAccessPage('manager', 'vouchers'), true);
  assert.equal(canViewHPP('manager'), false);
  assert.equal(canManageEmployees('manager'), false);
  assert.equal(canManageOpnameSchedules('manager'), false);
  assert.equal(canManageMembershipProgram('manager'), false);
  assert.equal(canManageVouchers('manager'), true);
  assert.equal(canManageVendors('manager'), true);

  const menuNav = managerNav.find((item) => item.id === 'menu-hpp');
  assert.equal(menuNav?.displayLabel, 'Menu');
});

test('cashier sees operational front-of-house pages and cannot access vendors or back-office pages', () => {
  const cashierNav = getVisibleNavItems('cashier');
  const ids = cashierNav.map((item) => item.id);
  assert.deepEqual(ids, ['dashboard', 'pos', 'orders', 'vouchers', 'membership', 'tv-display']);
  assert.equal(canAccessPage('cashier', 'tv-display'), true);
  assert.equal(canAccessPage('cashier', 'vouchers'), true);
  assert.equal(canManageVouchers('cashier'), false);
  assert.equal(canManageVendors('cashier'), false);
  assert.equal(canAccessPage('cashier', 'vendors'), false);
  assert.equal(canAccessPage('cashier', 'menu-hpp'), false);
  assert.equal(canAccessPage('cashier', 'inventory'), false);
  assert.equal(canAccessPage('cashier', 'purchasing'), false);
  assert.equal(canAccessPage('cashier', 'stock-opname'), false);
  assert.equal(canAccessPage('cashier', 'employees'), false);
  assert.equal(canAccessPage('cashier', 'settings'), false);
  assert.equal(canViewHPP('cashier'), false);
  assert.equal(canManageMembershipProgram('cashier'), false);
});
