import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessPage,
  canManageEmployees,
  canManageOpnameSchedules,
  canViewHPP,
  getVisibleNavItems,
} from './rbac';

test('owner has full access to all 10 pages and sensitive features', () => {
  const ownerNav = getVisibleNavItems('owner');
  assert.equal(ownerNav.length, 10);
  assert.equal(canAccessPage('owner', 'employees'), true);
  assert.equal(canAccessPage('owner', 'menu-hpp'), true);
  assert.equal(canAccessPage('owner', 'settings'), true);
  assert.equal(canViewHPP('owner'), true);
  assert.equal(canManageEmployees('owner'), true);
  assert.equal(canManageOpnameSchedules('owner'), true);
});

test('manager cannot see or access employees, HPP, or opname schedule management', () => {
  const managerNav = getVisibleNavItems('manager');
  const ids = managerNav.map((item) => item.id);
  assert.equal(ids.includes('employees'), false);
  assert.equal(canAccessPage('manager', 'employees'), false);
  assert.equal(canViewHPP('manager'), false);
  assert.equal(canManageEmployees('manager'), false);
  assert.equal(canManageOpnameSchedules('manager'), false);

  const menuNav = managerNav.find((item) => item.id === 'menu-hpp');
  assert.equal(menuNav?.displayLabel, 'Menu');
});

test('cashier only sees operational front-of-house pages', () => {
  const cashierNav = getVisibleNavItems('cashier');
  const ids = cashierNav.map((item) => item.id);
  assert.deepEqual(ids, ['dashboard', 'pos', 'orders', 'membership']);
  assert.equal(canAccessPage('cashier', 'menu-hpp'), false);
  assert.equal(canAccessPage('cashier', 'inventory'), false);
  assert.equal(canAccessPage('cashier', 'purchasing'), false);
  assert.equal(canAccessPage('cashier', 'stock-opname'), false);
  assert.equal(canAccessPage('cashier', 'employees'), false);
  assert.equal(canAccessPage('cashier', 'settings'), false);
  assert.equal(canViewHPP('cashier'), false);
});
