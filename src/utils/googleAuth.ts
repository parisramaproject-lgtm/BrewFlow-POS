import type { UserProfile } from '../types';

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

  return {
    uid: sbUser.id,
    email: sbUser.email ?? null,
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
