import assert from 'node:assert/strict';
import test from 'node:test';
import {
  APP_SESSION_COOKIE_NAME,
  buildClearSessionCookieHeader,
  buildSessionSetCookieHeader,
  isSameOriginRequest,
  isValidSessionToken,
  parseSessionCookieHeader,
  sanitizeUsernameHint,
} from '../../api/auth-session';
import { normalizeSupabaseUrl } from '../lib/supabase';

const VALID_HEX_64 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

test('normalizeSupabaseUrl strips accidental /rest/v1 or /auth/v1 suffixes and trailing slashes', () => {
  assert.equal(
    normalizeSupabaseUrl('https://example.supabase.co/rest/v1/'),
    'https://example.supabase.co'
  );
  assert.equal(
    normalizeSupabaseUrl('https://example.supabase.co/auth/v1'),
    'https://example.supabase.co'
  );
  assert.equal(
    normalizeSupabaseUrl('  https://example.supabase.co/  '),
    'https://example.supabase.co'
  );
  assert.equal(normalizeSupabaseUrl(''), '');
});

test('isValidSessionToken strictly validates 64-character hex tokens', () => {
  assert.equal(isValidSessionToken(VALID_HEX_64), true);
  assert.equal(isValidSessionToken(VALID_HEX_64.toUpperCase()), true);
  assert.equal(isValidSessionToken('short-token'), false);
  assert.equal(isValidSessionToken(`${VALID_HEX_64}ff`), false);
  assert.equal(isValidSessionToken('z'.repeat(64)), false);
  assert.equal(isValidSessionToken(null), false);
});

test('sanitizeUsernameHint strips leading @ and rejects unsafe characters', () => {
  assert.equal(sanitizeUsernameHint('@Owner_Brew.1'), 'owner_brew.1');
  assert.equal(sanitizeUsernameHint('a'), null);
  assert.equal(sanitizeUsernameHint('owner; HttpOnly'), null);
  assert.equal(sanitizeUsernameHint('owner\r\nSet-Cookie: bad=1'), null);
});

test('buildSessionSetCookieHeader emits hardened HttpOnly Secure SameSite=None Partitioned cookie', () => {
  const header = buildSessionSetCookieHeader(VALID_HEX_64, '@Owner');
  assert.match(header, new RegExp(`^${APP_SESSION_COOKIE_NAME}=${VALID_HEX_64}\\.owner;`));
  assert.ok(header.includes('HttpOnly'));
  assert.ok(header.includes('Secure'));
  assert.ok(header.includes('SameSite=None'));
  assert.ok(header.includes('Partitioned'));
  assert.ok(header.includes('Path=/'));
  assert.ok(header.includes('Max-Age=604800'));
});

test('buildClearSessionCookieHeader expires the cookie with hardened attributes', () => {
  const header = buildClearSessionCookieHeader();
  assert.ok(header.startsWith(`${APP_SESSION_COOKIE_NAME}=;`));
  assert.ok(header.includes('HttpOnly'));
  assert.ok(header.includes('Secure'));
  assert.ok(header.includes('SameSite=None'));
  assert.ok(header.includes('Partitioned'));
  assert.ok(header.includes('Max-Age=0'));
});

test('parseSessionCookieHeader extracts valid token and username hint while rejecting malformed cookies', () => {
  const parsed = parseSessionCookieHeader(
    `theme=light; ${APP_SESSION_COOKIE_NAME}=${VALID_HEX_64}.kasir_pagi; other=1`
  );
  assert.deepEqual(parsed, { token: VALID_HEX_64, username: 'kasir_pagi' });

  const tokenOnly = parseSessionCookieHeader(`${APP_SESSION_COOKIE_NAME}=${VALID_HEX_64}`);
  assert.deepEqual(tokenOnly, { token: VALID_HEX_64, username: null });

  assert.equal(parseSessionCookieHeader(`${APP_SESSION_COOKIE_NAME}=not-a-valid-token`), null);
  assert.equal(parseSessionCookieHeader(undefined), null);
});

test('isSameOriginRequest enforces X-Requested-With and Origin matching Host / X-Forwarded-Host', () => {
  assert.equal(
    isSameOriginRequest({
      'x-requested-with': 'XMLHttpRequest',
      origin: 'https://brewflow-pos.vercel.app',
      'x-forwarded-host': 'brewflow-pos.vercel.app',
    }),
    true
  );

  // Rejects cross-origin CSRF attempt even if X-Requested-With is set
  assert.equal(
    isSameOriginRequest({
      'x-requested-with': 'XMLHttpRequest',
      origin: 'https://evil.example.com',
      host: 'brewflow-pos.vercel.app',
    }),
    false
  );

  // Rejects missing custom header (e.g., plain HTML form POST)
  assert.equal(
    isSameOriginRequest({
      origin: 'https://brewflow-pos.vercel.app',
      host: 'brewflow-pos.vercel.app',
    }),
    false
  );
});
