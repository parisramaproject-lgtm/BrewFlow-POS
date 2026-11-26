import type { UserProfile } from '../types';

export interface GoogleAccountIdentity {
  uid: string;
  email: string | null;
  displayName?: string | null;
  photoURL?: string | null;
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
 * Converts Firebase Auth / Google OAuth popup error codes into clear Indonesian messages.
 */
export function getGoogleAuthErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';

  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Jendela login Google ditutup sebelum proses selesai. Silakan coba lagi.';
    case 'auth/cancelled-popup-request':
      return 'Permintaan login Google sebelumnya dibatalkan. Silakan klik kembali tombol Masuk dengan Google.';
    case 'auth/popup-blocked':
      return 'Popup login Google diblokir oleh browser. Izinkan popup untuk situs ini lalu coba lagi.';
    case 'auth/network-request-failed':
      return 'Koneksi internet terganggu saat menghubungi layanan Google. Periksa jaringan Anda lalu coba lagi.';
    case 'auth/unauthorized-domain': {
      const host = typeof window !== 'undefined' ? window.location.hostname : 'domain Anda';
      return `Domain "${host}" belum terdaftar di Firebase Console → Authentication → Settings → Authorized domains. Tambahkan domain Vercel Anda terlebih dahulu.`;
    }
    default: {
      if (error instanceof Error && error.message) {
        return error.message;
      }
      return 'Gagal masuk menggunakan akun Google. Silakan coba beberapa saat lagi.';
    }
  }
}
