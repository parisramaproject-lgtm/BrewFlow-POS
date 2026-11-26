import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { UserRole, UsernameLoginAuditLog } from '../types';
import { getBrowserDeviceSummary } from '../utils/usernameAuth';

export const DEFAULT_OWNER_ALERT_EMAIL = 'parisramaproject@gmail.com';

export interface SendOwnerLoginAlertParams {
  username: string;
  employeeName: string;
  employeeEmail?: string;
  role: UserRole;
  shopName: string;
  ownerEmail?: string;
}

/**
 * Triggers the Supabase Edge Function `send-login-alert` to email the Owner
 * whenever a staff member signs in using a Username & Password (non-Google OAuth).
 */
export async function sendOwnerUsernameLoginAlert(
  params: SendOwnerLoginAlertParams
): Promise<UsernameLoginAuditLog> {
  const ownerEmail = (params.ownerEmail || DEFAULT_OWNER_ALERT_EMAIL).trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const deviceInfo = getBrowserDeviceSummary();
  const baseLog: UsernameLoginAuditLog = {
    id: `login-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    username: params.username,
    employee_name: params.employeeName,
    role: params.role,
    owner_email: ownerEmail,
    email_status: 'queued',
    device_info: deviceInfo,
    logged_in_at: nowIso,
  };

  if (!isSupabaseConfigured || !supabase) {
    return {
      ...baseLog,
      email_status: 'queued',
      email_error: 'Edge Function send-login-alert belum terhubung (Supabase belum aktif).',
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke('send-login-alert', {
      body: {
        ownerEmail,
        username: params.username,
        employeeName: params.employeeName,
        employeeEmail: params.employeeEmail || '',
        role: params.role,
        shopName: params.shopName || 'BrewFlow POS',
        deviceInfo,
        origin: typeof window !== 'undefined' ? window.location.origin : '',
        loggedInAt: nowIso,
      },
    });

    if (error) {
      return {
        ...baseLog,
        email_status: 'failed',
        email_error: error.message || 'Gagal memanggil Edge Function send-login-alert.',
      };
    }

    const result = data as { sent?: boolean; error?: string } | null;
    if (result && result.sent === false) {
      return {
        ...baseLog,
        email_status: 'failed',
        email_error: result.error || 'Provider email belum dikonfigurasi pada Edge Function.',
      };
    }

    return {
      ...baseLog,
      email_status: 'sent',
    };
  } catch (err) {
    return {
      ...baseLog,
      email_status: 'failed',
      email_error:
        err instanceof Error ? err.message : 'Gagal mengirim email konfirmasi login ke Owner.',
    };
  }
}
