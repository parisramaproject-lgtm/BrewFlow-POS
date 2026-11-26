import type { UserProfile, UserRole } from '../types';

export interface GoogleAccountIdentity {
  uid: string;
  email: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  provider?: string | null;
}

export type EmployeeEmailMatchResult =
  | {
      status: 'matched';
      employee: UserProfile;
    }
  | {
      status: 'inactive';
      employee: UserProfile;
      message: string;
    }
  | {
      status: 'not_found';
      email: string;
      message: string;
    }
  | {
      status: 'invalid_email';
      message: string;
    };

/**
 * Normalizes an email address for deterministic, case-insensitive matching.
 */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/**
 * Normalizes a database role value (case-insensitive, supports Indonesian aliases).
 */
export function normalizeEmployeeRole(raw: unknown): UserRole {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (value === 'owner' || value === 'pemilik' || value === 'admin') return 'owner';
  if (value === 'manager' || value === 'manajer') return 'manager';
  return 'cashier';
}

/**
 * Determines whether a database employee/profile row is active.
 * Missing or null `is_active` defaults to true for compatibility with minimal schemas.
 */
export function isEmployeeRowActive(row: Record<string, unknown>): boolean {
  const val = row.is_active;
  if (val === false) return false;
  if (typeof val === 'string' && val.trim().toLowerCase() === 'false') return false;
  if (val === 0) return false;
  return true;
}

/**
 * Finds a matching database row by normalized email (handling leading/trailing spaces
 * and uppercase letters in DB) or by Supabase auth user ID.
 */
export function findMatchingDatabaseRow(
  rows: Array<Record<string, unknown>>,
  normalizedEmail: string,
  authUserId?: string | null
): Record<string, unknown> | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  if (normalizedEmail) {
    const byEmail = rows.find((row) => {
      const candidate =
        typeof row.email === 'string'
          ? row.email
          : typeof row.user_email === 'string'
            ? row.user_email
            : '';
      return normalizeEmail(candidate) === normalizedEmail;
    });
    if (byEmail) return byEmail;
  }

  if (authUserId) {
    const byAuthId = rows.find(
      (row) => row.auth_user_id === authUserId || row.id === authUserId
    );
    if (byAuthId) return byAuthId;
  }

  return null;
}

/**
 * Validates that an avatar URL uses a safe HTTPS scheme before rendering in <img src>.
 */
export function isSafeAvatarUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Extracts normalized Google / OAuth identity metadata from a Supabase Auth user object.
 */
export function extractSupabaseUserIdentity(sbUser: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
}): GoogleAccountIdentity {
  const meta = sbUser.user_metadata ?? {};
  const appMeta = sbUser.app_metadata ?? {};
  const displayName =
    typeof meta.full_name === 'string'
      ? meta.full_name
      : typeof meta.name === 'string'
        ? meta.name
        : null;
  const photoURL =
    typeof meta.avatar_url === 'string'
      ? meta.avatar_url
      : typeof meta.picture === 'string'
        ? meta.picture
        : null;
  const provider = typeof appMeta.provider === 'string' ? appMeta.provider : null;
  const resolvedEmail =
    (typeof sbUser.email === 'string' && sbUser.email.trim()) ||
    (typeof meta.email === 'string' && meta.email.trim()) ||
    null;

  return {
    uid: sbUser.id,
    email: resolvedEmail,
    displayName,
    photoURL,
    provider,
  };
}

/**
 * Matches a Google OAuth authenticated email against the registered employee directory.
 * Only active employees whose email matches (case-insensitive) are granted access.
 */
export function matchEmployeeByEmail(
  googleEmail: string | null | undefined,
  employees: UserProfile[]
): EmployeeEmailMatchResult {
  const normalized = normalizeEmail(googleEmail);
  if (!normalized || !normalized.includes('@')) {
    return {
      status: 'invalid_email',
      message: 'Akun Google Anda tidak menyediakan alamat email yang valid untuk verifikasi karyawan.',
    };
  }

  const matched = employees.find((emp) => normalizeEmail(emp.email) === normalized);
  if (!matched) {
    return {
      status: 'not_found',
      email: normalized,
      message: `Email "${normalized}" belum terdaftar di data karyawan BrewFlow POS. Minta Owner menambahkan email Google ini di menu Karyawan.`,
    };
  }

  if (!matched.is_active) {
    return {
      status: 'inactive',
      employee: matched,
      message: `Akun karyawan "${matched.full_name}" (${normalized}) sedang berstatus Nonaktif. Hubungi Owner untuk mengaktifkan kembali akses.`,
    };
  }

  return {
    status: 'matched',
    employee: matched,
  };
}

/**
 * Combines the authoritative employee record (role, shift, permissions) with
 * safe visual profile metadata from the authenticated Google account.
 */
export function mergeGoogleProfileIntoEmployee(
  employee: UserProfile,
  googleIdentity: GoogleAccountIdentity
): UserProfile {
  const safePhoto = isSafeAvatarUrl(googleIdentity.photoURL)
    ? googleIdentity.photoURL!.trim()
    : employee.photo_url;

  const resolvedName = employee.full_name.trim() || googleIdentity.displayName?.trim() || 'Karyawan';

  return {
    ...employee,
    full_name: resolvedName,
    photo_url: safePhoto,
  };
}

/**
 * Converts Supabase Google OAuth errors into clear Indonesian user guidance.
 */
export function getSupabaseGoogleAuthErrorMessage(error: unknown): string {
  const rawMessage =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : '';

  const lower = rawMessage.toLowerCase();

  if (lower.includes('provider is not enabled') || lower.includes('unsupported provider')) {
    return 'Provider Google belum diaktifkan di Supabase Dashboard → Authentication → Providers → Google.';
  }
  if (lower.includes('access_denied')) {
    return 'Login Google dibatalkan atau izin akses akun Google ditolak.';
  }
  if (lower.includes('redirect') && (lower.includes('mismatch') || lower.includes('not allowed'))) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'URL Vercel Anda';
    return `URL "${origin}" belum terdaftar di Supabase Dashboard → Authentication → URL Configuration → Redirect URLs.`;
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Koneksi ke server Supabase terganggu. Periksa jaringan internet Anda lalu coba lagi.';
  }
  if (rawMessage.trim()) {
    return rawMessage;
  }
  return 'Gagal masuk menggunakan Google melalui Supabase Auth. Silakan coba lagi.';
}

export const CANONICAL_PRODUCTION_URL = 'https://brewflow-pos.vercel.app/';

/**
 * Resolves the safe OAuth `redirectTo` URL for Supabase Google sign-in.
 * - Uses explicit `VITE_APP_URL` / `NEXT_PUBLIC_APP_URL` when configured.
 * - Pins any `brewflow-pos*.vercel.app` deployment/preview host to the canonical
 *   production alias (`https://brewflow-pos.vercel.app/`) so redeploys never break
 *   Supabase Redirect URLs or trigger Vercel Deployment Protection screens.
 */
export function resolveOAuthRedirectUrl(
  currentOrigin: string,
  configuredAppUrl?: string | null
): string {
  const candidate = (configuredAppUrl ?? '').trim();
  if (candidate && candidate !== 'MY_APP_URL') {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return `${parsed.origin}/`;
      }
    } catch {
      // Ignore malformed env var and fall through to origin resolution
    }
  }

  try {
    const parsedOrigin = new URL(currentOrigin);
    if (/^brewflow-pos(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(parsedOrigin.hostname)) {
      return CANONICAL_PRODUCTION_URL;
    }
    return `${parsedOrigin.origin}/`;
  } catch {
    return CANONICAL_PRODUCTION_URL;
  }
}
