import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessPage,
  canManageEmployees,
  canManageMembershipProgram,
  canManageOpnameSchedules,
  canViewHPP,
  getVisibleNavItems,
} from './rbac';

test('owner has full access to all 11 pages and sensitive features', () => {
  const ownerNav = getVisibleNavItems('owner');
  assert.equal(ownerNav.length, 11);
  assert.equal(canAccessPage('owner', 'employees'), true);
  assert.equal(canAccessPage('owner', 'menu-hpp'), true);
  assert.equal(canAccessPage('owner', 'settings'), true);
  assert.equal(canAccessPage('owner', 'tv-display'), true);
  assert.equal(canViewHPP('owner'), true);
  assert.equal(canManageEmployees('owner'), true);
  assert.equal(canManageOpnameSchedules('owner'), true);
  assert.equal(canManageMembershipProgram('owner'), true);
});

test('manager can access tv-display but cannot see employees, HPP, opname schedules, or membership promo settings', () => {
  const managerNav = getVisibleNavItems('manager');
  const ids = managerNav.map((item) => item.id);
  assert.equal(ids.includes('employees'), false);
  assert.equal(ids.includes('tv-display'), true);
  assert.equal(canAccessPage('manager', 'employees'), false);
  assert.equal(canAccessPage('manager', 'tv-display'), true);
  assert.equal(canViewHPP('manager'), false);
  assert.equal(canManageEmployees('manager'), false);
  assert.equal(canManageOpnameSchedules('manager'), false);
  assert.equal(canManageMembershipProgram('manager'), false);

  const menuNav = managerNav.find((item) => item.id === 'menu-hpp');
  assert.equal(menuNav?.displayLabel, 'Menu');
});

test('cashier sees operational front-of-house pages including Display TV Store', () => {
  const cashierNav = getVisibleNavItems('cashier');
  const ids = cashierNav.map((item) => item.id);
  assert.deepEqual(ids, ['dashboard', 'pos', 'orders', 'membership', 'tv-display']);
  assert.equal(canAccessPage('cashier', 'tv-display'), true);
  assert.equal(canAccessPage('cashier', 'menu-hpp'), false);
  assert.equal(canAccessPage('cashier', 'inventory'), false);
  assert.equal(canAccessPage('cashier', 'purchasing'), false);
  assert.equal(canAccessPage('cashier', 'stock-opname'), false);
  assert.equal(canAccessPage('cashier', 'employees'), false);
  assert.equal(canAccessPage('cashier', 'settings'), false);
  assert.equal(canViewHPP('cashier'), false);
  assert.equal(canManageMembershipProgram('cashier'), false);
});
