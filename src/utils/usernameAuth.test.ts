import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PBKDF2_ITERATIONS,
  hashPasswordLocal,
  normalizeUsername,
  sanitizeEmployeeForLocalCache,
  validatePassword,
  validateUsername,
  verifyPasswordLocal,
} from './usernameAuth';

test('normalizeUsername trims whitespace, strips leading @, and lowercases', () => {
  assert.equal(normalizeUsername('  @Kasir.Dimas  '), 'kasir.dimas');
  assert.equal(normalizeUsername('OWNER_01'), 'owner_01');
  assert.equal(normalizeUsername(null), '');
});

test('validateUsername enforces format and length rules', () => {
  assert.equal(validateUsername('kasir.dimas').valid, true);
  assert.equal(validateUsername('ab').valid, false);
  assert.equal(validateUsername('user name').valid, false);
  assert.equal(validateUsername('bad$char').valid, false);
});

test('validatePassword enforces minimum 8 non-whitespace characters', () => {
  assert.equal(validatePassword('BrewFlow2026').valid, true);
  assert.equal(validatePassword('1234567').valid, false);
  assert.equal(validatePassword('        ').valid, false);
});

test('hashPasswordLocal and verifyPasswordLocal use 600k OWASP PBKDF2-SHA256 salted hashes', async () => {
  assert.equal(PBKDF2_ITERATIONS, 600_000);
  const hash1 = await hashPasswordLocal('KopiRahasia#99');
  const hash2 = await hashPasswordLocal('KopiRahasia#99');

  assert.ok(hash1.startsWith('pbkdf2_sha256$600000$'));
  assert.notEqual(hash1, hash2, 'each hash must use a unique random salt');
  assert.equal(await verifyPasswordLocal('KopiRahasia#99', hash1), true);
  assert.equal(await verifyPasswordLocal('SalahPassword', hash1), false);
  assert.equal(await verifyPasswordLocal('KopiRahasia#99', 'not-a-valid-hash'), false);
});

test('sanitizeEmployeeForLocalCache strips password_hash, salary, and emergency_contact', () => {
  const sanitized = sanitizeEmployeeForLocalCache({
    id: 'emp-1',
    full_name: 'Dimas Pratama',
    email: 'kasir@brewflow.id',
    username: 'kasir.dimas',
    password_hash: 'pbkdf2_sha256$600000$abc$def',
    role: 'cashier',
    phone_number: '081234567890',
    avatar_initials: 'DP',
    is_active: true,
    monthly_salary: 4600000,
    emergency_contact: 'Ibu Sari 081111',
    created_at: '2026-01-01T00:00:00Z',
  });

  assert.equal(sanitized.password_hash, undefined);
  assert.equal(sanitized.monthly_salary, undefined);
  assert.equal(sanitized.emergency_contact, undefined);
  assert.equal(sanitized.has_password, true);
  assert.equal(sanitized.full_name, 'Dimas Pratama');
});
