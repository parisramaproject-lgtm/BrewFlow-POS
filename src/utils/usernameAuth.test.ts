import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPasswordLocal,
  normalizeUsername,
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

test('validatePassword enforces minimum 6 non-whitespace characters', () => {
  assert.equal(validatePassword('BrewFlow2026').valid, true);
  assert.equal(validatePassword('12345').valid, false);
  assert.equal(validatePassword('      ').valid, false);
});

test('hashPasswordLocal and verifyPasswordLocal use salted PBKDF2 hashes', async () => {
  const hash1 = await hashPasswordLocal('KopiRahasia#99');
  const hash2 = await hashPasswordLocal('KopiRahasia#99');

  assert.ok(hash1.startsWith('pbkdf2_sha256$'));
  assert.notEqual(hash1, hash2, 'each hash must use a unique random salt');
  assert.equal(await verifyPasswordLocal('KopiRahasia#99', hash1), true);
  assert.equal(await verifyPasswordLocal('SalahPassword', hash1), false);
  assert.equal(await verifyPasswordLocal('KopiRahasia#99', 'not-a-valid-hash'), false);
});
