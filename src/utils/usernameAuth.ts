/**
 * Username & password validation and salted PBKDF2 hashing helpers for
 * Owner-managed employee username login (non-OAuth).
 */

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const PBKDF2_PREFIX = 'pbkdf2_sha256$';
const PBKDF2_ITERATIONS = 100_000;

export function normalizeUsername(raw: string | null | undefined): string {
  return (raw ?? '').trim().replace(/^@+/, '').toLowerCase();
}

export function validateUsername(raw: string): { valid: boolean; normalized: string; error?: string } {
  const normalized = normalizeUsername(raw);
  if (!normalized) {
    return { valid: false, normalized: '', error: 'Username wajib diisi.' };
  }
  if (normalized.length < 3 || normalized.length > 32) {
    return {
      valid: false,
      normalized,
      error: 'Username harus terdiri dari 3 sampai 32 karakter.',
    };
  }
  if (!USERNAME_PATTERN.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Username hanya boleh berisi huruf kecil, angka, titik (.), garis bawah (_), atau tanda hubung (-).',
    };
  }
  return { valid: true, normalized };
}

export function validatePassword(raw: string): { valid: boolean; error?: string } {
  if (!raw || raw.trim().length < 6) {
    return {
      valid: false,
      error: 'Kata sandi minimal 6 karakter dan tidak boleh hanya berisi spasi.',
    };
  }
  return { valid: true };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function derivePbkdf2Hex(password: string, saltBytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Web Crypto API tidak tersedia di browser ini.');
  }
  const encoder = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const saltBuffer = new Uint8Array(saltBytes).buffer as ArrayBuffer;
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

/**
 * Hashes a password with a fresh 16-byte random salt using Web Crypto PBKDF2-SHA256.
 * Plaintext passwords are never stored in browser state or localStorage.
 */
export async function hashPasswordLocal(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  const derivedHex = await derivePbkdf2Hex(password, salt);
  return `${PBKDF2_PREFIX}${bytesToHex(salt)}$${derivedHex}`;
}

/**
 * Verifies a plaintext password against a stored PBKDF2-SHA256 hash using constant-time comparison.
 */
export async function verifyPasswordLocal(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash || !storedHash.startsWith(PBKDF2_PREFIX)) return false;
  const parts = storedHash.slice(PBKDF2_PREFIX.length).split('$');
  if (parts.length !== 2) return false;
  const [saltHex, expectedHex] = parts;
  if (!saltHex || !expectedHex || saltHex.length % 2 !== 0) return false;

  try {
    const derivedHex = await derivePbkdf2Hex(password, hexToBytes(saltHex));
    return constantTimeEqual(derivedHex, expectedHex);
  } catch {
    return false;
  }
}

export function getBrowserDeviceSummary(): string {
  if (typeof navigator === 'undefined') return 'Web Browser';
  const ua = navigator.userAgent || '';
  const browser = /Edg\//.test(ua)
    ? 'Microsoft Edge'
    : /Chrome\//.test(ua)
      ? 'Google Chrome'
      : /Firefox\//.test(ua)
        ? 'Mozilla Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Perangkat';
  return `${browser} · ${os}`;
}
