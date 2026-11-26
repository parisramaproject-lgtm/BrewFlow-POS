import test from 'node:test';
import assert from 'node:assert/strict';
import type { UserProfile } from '../types';
import {
  getGoogleAuthErrorMessage,
  isSafeAvatarUrl,
  matchEmployeeByEmail,
  mergeGoogleProfileIntoEmployee,
  normalizeEmail,
} from './googleAuth';

const SAMPLE_EMPLOYEES: UserProfile[] = [
  {
    id: 'emp-owner',
    full_name: 'Budi Santoso',
    email: 'Owner.BrewFlow@gmail.com',
    role: 'owner',
    phone_number: '0812-8800-1101',
    avatar_initials: 'BS',
    is_active: true,
    created_at: '2025-01-10T08:00:00Z',
  },
  {
    id: 'emp-cashier-inactive',
    full_name: 'Raka Pratama',
    email: 'raka.barista@gmail.com',
    role: 'cashier',
    phone_number: '0857-9044-2203',
    avatar_initials: 'RP',
    is_active: false,
    created_at: '2025-04-02T08:00:00Z',
  },
];

test('normalizeEmail trims whitespace and lowercases email', () => {
  assert.equal(normalizeEmail('  Owner.BrewFlow@Gmail.COM  '), 'owner.brewflow@gmail.com');
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(undefined), '');
});

test('matchEmployeeByEmail matches active employee case-insensitively', () => {
  const result = matchEmployeeByEmail('  owner.brewflow@gmail.com ', SAMPLE_EMPLOYEES);
  assert.equal(result.status, 'matched');
  if (result.status === 'matched') {
    assert.equal(result.employee.id, 'emp-owner');
    assert.equal(result.employee.role, 'owner');
  }
});

test('matchEmployeeByEmail rejects inactive employee with clear message', () => {
  const result = matchEmployeeByEmail('raka.barista@gmail.com', SAMPLE_EMPLOYEES);
  assert.equal(result.status, 'inactive');
  if (result.status === 'inactive') {
    assert.equal(result.employee.id, 'emp-cashier-inactive');
    assert.match(result.message, /Nonaktif/i);
  }
});

test('matchEmployeeByEmail rejects unregistered email', () => {
  const result = matchEmployeeByEmail('stranger@gmail.com', SAMPLE_EMPLOYEES);
  assert.equal(result.status, 'not_found');
  if (result.status === 'not_found') {
    assert.equal(result.email, 'stranger@gmail.com');
    assert.match(result.message, /belum terdaftar/i);
  }
});

test('matchEmployeeByEmail rejects empty or malformed email', () => {
  assert.equal(matchEmployeeByEmail('', SAMPLE_EMPLOYEES).status, 'invalid_email');
  assert.equal(matchEmployeeByEmail('not-an-email', SAMPLE_EMPLOYEES).status, 'invalid_email');
});

test('isSafeAvatarUrl accepts https URLs and rejects unsafe schemes', () => {
  assert.equal(isSafeAvatarUrl('https://lh3.googleusercontent.com/a/avatar.png'), true);
  assert.equal(isSafeAvatarUrl('http://insecure.example.com/a.png'), false);
  assert.equal(isSafeAvatarUrl('javascript:alert(1)'), false);
  assert.equal(isSafeAvatarUrl('data:image/svg+xml,<svg/>'), false);
  assert.equal(isSafeAvatarUrl(''), false);
});

test('mergeGoogleProfileIntoEmployee preserves authoritative employee role and attaches safe photo', () => {
  const merged = mergeGoogleProfileIntoEmployee(SAMPLE_EMPLOYEES[0], {
    uid: 'google-uid-123',
    email: 'owner.brewflow@gmail.com',
    displayName: 'Google Display Name',
    photoURL: 'https://lh3.googleusercontent.com/a/photo',
  });
  assert.equal(merged.role, 'owner');
  assert.equal(merged.full_name, 'Budi Santoso');
  assert.equal(merged.photo_url, 'https://lh3.googleusercontent.com/a/photo');

  const mergedUnsafe = mergeGoogleProfileIntoEmployee(SAMPLE_EMPLOYEES[0], {
    uid: 'google-uid-123',
    email: 'owner.brewflow@gmail.com',
    photoURL: 'javascript:alert(1)',
  });
  assert.equal(mergedUnsafe.photo_url, undefined);
});

test('getGoogleAuthErrorMessage maps Firebase auth popup codes cleanly', () => {
  assert.match(getGoogleAuthErrorMessage({ code: 'auth/popup-closed-by-user' }), /ditutup/i);
  assert.match(getGoogleAuthErrorMessage({ code: 'auth/popup-blocked' }), /diblokir/i);
  assert.match(getGoogleAuthErrorMessage(new Error('Custom error')), /Custom error/);
});
