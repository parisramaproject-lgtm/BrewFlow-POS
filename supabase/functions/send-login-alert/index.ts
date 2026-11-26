// Supabase Edge Function: supabase/functions/send-login-alert/index.ts
// Sends an email confirmation alert to the Owner (default: parisramaproject@gmail.com)
// whenever an account logs into BrewFlow POS using Username & Password (without Google OAuth).
//
// Deploy:
//   supabase functions deploy send-login-alert --no-verify-jwt
//
// Secrets required (choose Resend API — recommended, free 3,000 emails/month — OR custom Email Webhook):
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxx
//   supabase secrets set OWNER_ALERT_EMAIL=parisramaproject@gmail.com
//   supabase secrets set ALERT_FROM_EMAIL="BrewFlow POS <onboarding@resend.dev>"
//   # Optional: restrict CORS to your Vercel domain
//   supabase secrets set ALLOWED_ORIGIN=https://brewflow-pos.vercel.app

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const DEFAULT_OWNER_EMAIL = 'parisramaproject@gmail.com';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface LoginAlertPayload {
  ownerEmail?: string;
  username?: string;
  employeeName?: string;
  employeeEmail?: string;
  role?: string;
  shopName?: string;
  deviceInfo?: string;
  origin?: string;
  loggedInAt?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildCorsHeaders(req: Request): Record<string, string> {
  const configuredOrigin = Deno.env.get('ALLOWED_ORIGIN')?.trim();
  const requestOrigin = (req.headers.get('origin') ?? '').trim();

  let allowOrigin = 'https://brewflow-pos.vercel.app';
  if (configuredOrigin) {
    allowOrigin = configuredOrigin;
  } else if (
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(requestOrigin) ||
    requestOrigin === 'http://localhost:3000'
  ) {
    allowOrigin = requestOrigin;
  }

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function formatRoleLabel(role: string): string {
  const normalized = role.trim().toLowerCase();
  if (normalized === 'owner') return 'Owner';
  if (normalized === 'manager') return 'Manager';
  return 'Kasir';
}

function formatWibDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'full',
    timeStyle: 'medium',
    timeZone: 'Asia/Jakarta',
  }).format(parsed);
}

serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ sent: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json()) as LoginAlertPayload;
    const username = String(body.username ?? '').trim().slice(0, 64);
    const employeeName = String(body.employeeName ?? 'Karyawan').trim().slice(0, 120);
    const employeeEmail = String(body.employeeEmail ?? '-').trim().slice(0, 160);
    const roleLabel = formatRoleLabel(String(body.role ?? 'cashier'));
    const shopName = String(body.shopName ?? 'BrewFlow POS').trim().slice(0, 100);
    const deviceInfo = String(body.deviceInfo ?? 'Web Browser').trim().slice(0, 140);
    const loggedInAt = formatWibDateTime(String(body.loggedInAt ?? new Date().toISOString()));

    if (!username) {
      return new Response(JSON.stringify({ sent: false, error: 'Username wajib disertakan.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Lock destination strictly to server-configured OWNER_ALERT_EMAIL (default: parisramaproject@gmail.com)
    // so the endpoint can never be abused as an open email relay.
    const serverOwnerEmail = Deno.env.get('OWNER_ALERT_EMAIL')?.trim().toLowerCase();
    const targetOwnerEmail =
      serverOwnerEmail && EMAIL_PATTERN.test(serverOwnerEmail)
        ? serverOwnerEmail
        : DEFAULT_OWNER_EMAIL;

    const subject = `[${shopName}] Konfirmasi Login Username: @${username} (${roleLabel})`;

    const plainText = [
      `Halo Owner ${shopName},`,
      '',
      'Terdeteksi login ke sistem menggunakan Username & Password (tanpa Google OAuth):',
      `- Username: @${username}`,
      `- Nama Karyawan: ${employeeName}`,
      `- Role Akses: ${roleLabel}`,
      `- Email Karyawan: ${employeeEmail}`,
      `- Waktu Login: ${loggedInAt} WIB`,
      `- Perangkat: ${deviceInfo}`,
      '',
      'Jika login ini tidak dikenali, segera ubah kata sandi atau nonaktifkan akun karyawan tersebut melalui menu Karyawan di BrewFlow POS.',
    ].join('\n');

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#F4F6F5; padding:24px; color:#1A2E26;">
        <div style="max-width:560px; margin:0 auto; background:#FFFFFF; border:1px solid #E5E7EB; border-radius:16px; padding:28px;">
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
            <span style="display:inline-block; background:#109A58; color:#FFFFFF; font-weight:700; font-size:13px; padding:6px 12px; border-radius:8px;">${escapeHtml(shopName)}</span>
            <span style="font-size:12px; color:#6B7280;">Notifikasi Keamanan Login</span>
          </div>
          <h2 style="margin:0 0 8px; font-size:18px; color:#1A2E26;">Konfirmasi Login Menggunakan Username</h2>
          <p style="margin:0 0 18px; font-size:14px; color:#4B5563; line-height:1.5;">
            Seseorang baru saja masuk ke sistem <strong>${escapeHtml(shopName)}</strong> menggunakan <strong>Username &amp; Kata Sandi</strong> (tanpa Google OAuth).
          </p>
          <table style="width:100%; border-collapse:collapse; font-size:13px; background:#F9FAFB; border-radius:12px; overflow:hidden;">
            <tr><td style="padding:10px 14px; color:#6B7280; border-bottom:1px solid #E5E7EB;">Username</td><td style="padding:10px 14px; font-weight:700; color:#1A2E26; border-bottom:1px solid #E5E7EB;">@${escapeHtml(username)}</td></tr>
            <tr><td style="padding:10px 14px; color:#6B7280; border-bottom:1px solid #E5E7EB;">Nama Karyawan</td><td style="padding:10px 14px; font-weight:600; color:#1A2E26; border-bottom:1px solid #E5E7EB;">${escapeHtml(employeeName)}</td></tr>
            <tr><td style="padding:10px 14px; color:#6B7280; border-bottom:1px solid #E5E7EB;">Role Akses</td><td style="padding:10px 14px; font-weight:600; color:#109A58; border-bottom:1px solid #E5E7EB;">${escapeHtml(roleLabel)}</td></tr>
            <tr><td style="padding:10px 14px; color:#6B7280; border-bottom:1px solid #E5E7EB;">Email Terdaftar</td><td style="padding:10px 14px; color:#1A2E26; border-bottom:1px solid #E5E7EB;">${escapeHtml(employeeEmail)}</td></tr>
            <tr><td style="padding:10px 14px; color:#6B7280; border-bottom:1px solid #E5E7EB;">Waktu Login</td><td style="padding:10px 14px; color:#1A2E26; border-bottom:1px solid #E5E7EB;">${escapeHtml(loggedInAt)} WIB</td></tr>
            <tr><td style="padding:10px 14px; color:#6B7280;">Perangkat</td><td style="padding:10px 14px; color:#1A2E26;">${escapeHtml(deviceInfo)}</td></tr>
          </table>
          <p style="margin:18px 0 0; font-size:12px; color:#6B7280; line-height:1.5;">
            Jika aktivitas login ini tidak Anda kenali, segera buka menu <strong>Karyawan</strong> di BrewFlow POS untuk mengganti kata sandi atau menonaktifkan akun terkait.
          </p>
        </div>
      </div>
    `;

    // Option A: Resend API (recommended — https://resend.com)
    const resendApiKey = Deno.env.get('RESEND_API_KEY')?.trim();
    const fromEmail = Deno.env.get('ALERT_FROM_EMAIL')?.trim() || `${shopName} <onboarding@resend.dev>`;

    if (resendApiKey) {
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [targetOwnerEmail],
          subject,
          html,
          text: plainText,
        }),
      });

      const resendBody = await resendRes.json().catch(() => ({}));
      if (!resendRes.ok) {
        return new Response(
          JSON.stringify({
            sent: false,
            error:
              (resendBody as { message?: string }).message ||
              `Resend API menolak pengiriman (HTTP ${resendRes.status}).`,
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }

      return new Response(
        JSON.stringify({
          sent: true,
          provider: 'resend',
          to: targetOwnerEmail,
          id: (resendBody as { id?: string }).id ?? null,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Option B: Generic Email Webhook / SMTP Relay (e.g., Make, Zapier, Brevo, n8n)
    const webhookUrl = Deno.env.get('EMAIL_WEBHOOK_URL')?.trim();
    if (webhookUrl) {
      const parsedWebhook = new URL(webhookUrl);
      if (parsedWebhook.protocol !== 'https:') {
        return new Response(
          JSON.stringify({ sent: false, error: 'EMAIL_WEBHOOK_URL wajib menggunakan HTTPS.' }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
      const webhookSecret = Deno.env.get('EMAIL_WEBHOOK_SECRET')?.trim();
      const webhookRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(webhookSecret ? { Authorization: `Bearer ${webhookSecret}` } : {}),
        },
        body: JSON.stringify({
          to: targetOwnerEmail,
          subject,
          text: plainText,
          html,
          metadata: { username, employeeName, role: roleLabel, deviceInfo, loggedInAt },
        }),
      });

      return new Response(
        JSON.stringify({
          sent: webhookRes.ok,
          provider: 'webhook',
          to: targetOwnerEmail,
          error: webhookRes.ok ? undefined : `Webhook HTTP ${webhookRes.status}`,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        sent: false,
        to: targetOwnerEmail,
        error:
          'RESEND_API_KEY belum dipasang di Supabase Edge Function Secrets. Jalankan: supabase secrets set RESEND_API_KEY=re_xxx',
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        sent: false,
        error: err instanceof Error ? err.message : 'Terjadi kesalahan saat mengirim email alert.',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
