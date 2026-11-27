import { getAppSessionToken, isSupabaseConfigured, supabase } from '../lib/supabase';
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
 * Sends an email confirmation alert to the Owner whenever a staff member signs in
 * using Username & Password (non-Google OAuth).
 *
 * Delivery order:
 * 1. Same-origin Vercel Serverless API `/api/send-login-alert` (supports Google Gmail App Password SMTP directly & Resend)
 * 2. Fallback to Supabase Edge Function `send-login-alert` if `/api/send-login-alert` is unconfigured.
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

  const payload = {
    ownerEmail,
    username: params.username,
    employeeName: params.employeeName,
    employeeEmail: params.employeeEmail || '',
    role: params.role,
    shopName: params.shopName || 'BrewFlow POS',
    deviceInfo,
    origin: typeof window !== 'undefined' ? window.location.origin : '',
    loggedInAt: nowIso,
  };

  // 1. Primary: Vercel Serverless Function `/api/send-login-alert` (Gmail App Password SMTP)
  let apiNotConfiguredMessage: string | null = null;
  if (typeof window !== 'undefined') {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      };
      const sessionToken = getAppSessionToken();
      if (sessionToken) {
        headers.Authorization = `Bearer ${sessionToken}`;
      } else if (supabase) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token) {
          headers.Authorization = `Bearer ${session.access_token}`;
        }
      }

      const response = await fetch('/api/send-login-alert', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(payload),
      });

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const result = (await response.json()) as {
          sent?: boolean;
          configured?: boolean;
          to?: string;
          error?: string;
        };

        if (result.sent) {
          return {
            ...baseLog,
            owner_email: result.to || ownerEmail,
            email_status: 'sent',
          };
        }

        if (result.configured) {
          // Gmail App Password or Resend IS configured on Vercel, but delivery failed — report directly
          return {
            ...baseLog,
            owner_email: result.to || ownerEmail,
            email_status: 'failed',
            email_error: result.error || 'Gagal mengirim email via server.',
          };
        }

        apiNotConfiguredMessage = result.error || null;
      }
    } catch {
      // Fall through to Supabase Edge Function if same-origin API is unavailable
    }
  }

  // 2. Fallback: Supabase Edge Function `send-login-alert`
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('send-login-alert', {
        body: payload,
      });

      if (!error) {
        const result = data as { sent?: boolean; to?: string; error?: string } | null;
        if (result?.sent) {
          return {
            ...baseLog,
            owner_email: result.to || ownerEmail,
            email_status: 'sent',
          };
        }
        return {
          ...baseLog,
          email_status: 'failed',
          email_error:
            apiNotConfiguredMessage ||
            result?.error ||
            'Atur GMAIL_USER & GMAIL_APP_PASSWORD di Vercel Environment Variables untuk kirim email langsung.',
        };
      }
    } catch {
      // Return friendly setup guidance below
    }
  }

  return {
    ...baseLog,
    email_status: 'failed',
    email_error:
      apiNotConfiguredMessage ||
      'Atur GMAIL_USER & GMAIL_APP_PASSWORD (Sandi Aplikasi Google) di Vercel Environment Variables untuk mengaktifkan pengiriman email.',
  };
}
