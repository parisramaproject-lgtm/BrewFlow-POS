import type { IncomingMessage, ServerResponse } from 'http';
import nodemailer from 'nodemailer';
import { isSameOriginRequest, parseSessionCookieHeader } from './auth-session';

const DEFAULT_OWNER_EMAIL = 'parisramaproject@gmail.com';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY_BYTES = 4096;

export interface LoginAlertPayload {
  username?: string;
  employeeName?: string;
  employeeEmail?: string;
  role?: string;
  shopName?: string;
  deviceInfo?: string;
  loggedInAt?: string;
}

export function normalizeGmailAppPassword(raw: string | undefined): string {
  // Google displays App Passwords in 4x4 groups with spaces (e.g. "abcd efgh ijkl mnop")
  return (raw ?? '').replace(/\s+/g, '').trim();
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function resolveTargetOwnerEmail(env: Record<string, string | undefined>): string {
  const configured = (env.OWNER_ALERT_EMAIL ?? '').trim().toLowerCase();
  if (configured && EMAIL_PATTERN.test(configured)) {
    return configured;
  }
  const gmailUser = (env.GMAIL_USER ?? '').trim().toLowerCase();
  if (gmailUser && EMAIL_PATTERN.test(gmailUser)) {
    return gmailUser;
  }
  return DEFAULT_OWNER_EMAIL;
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

export function buildLoginAlertEmailContent(payload: LoginAlertPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const username = String(payload.username ?? '').trim().slice(0, 64);
  const employeeName = String(payload.employeeName ?? 'Karyawan').trim().slice(0, 120);
  const employeeEmail = String(payload.employeeEmail ?? '-').trim().slice(0, 160);
  const roleLabel = formatRoleLabel(String(payload.role ?? 'cashier'));
  const shopName = String(payload.shopName ?? 'BrewFlow POS').trim().slice(0, 100);
  const deviceInfo = String(payload.deviceInfo ?? 'Web Browser').trim().slice(0, 140);
  const loggedInAt = formatWibDateTime(String(payload.loggedInAt ?? new Date().toISOString()));

  const subject = `[${shopName}] Konfirmasi Login Username: @${username} (${roleLabel})`;

  const text = [
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

  return { subject, text, html };
}

function getHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(direct)) return direct[0];
  return direct;
}

function sendJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<LoginAlertPayload | null> {
  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed && typeof preParsed === 'object' && !Buffer.isBuffer(preParsed)) {
    return preParsed as LoginAlertPayload;
  }
  if (typeof preParsed === 'string') {
    if (Buffer.byteLength(preParsed, 'utf8') > MAX_BODY_BYTES) return null;
    try {
      const parsed = JSON.parse(preParsed);
      return parsed && typeof parsed === 'object' ? (parsed as LoginAlertPayload) : null;
    } catch {
      return null;
    }
  }

  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer | string) => {
      if (aborted) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
      totalBytes += buf.length;
      if (totalBytes > MAX_BODY_BYTES) {
        aborted = true;
        resolve(null);
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (aborted) return;
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? (parsed as LoginAlertPayload) : null);
      } catch {
        resolve(null);
      }
    });

    req.on('error', () => {
      if (!aborted) {
        aborted = true;
        resolve(null);
      }
    });
  });
}

export default async function handleSendLoginAlertRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { sent: false, error: 'Method tidak diizinkan.' });
    return;
  }

  if (!isSameOriginRequest(req.headers)) {
    sendJson(res, 403, { sent: false, error: 'Permintaan tidak valid.' });
    return;
  }

  // Require an active app session cookie or Bearer token so anonymous bots cannot spam emails
  const sessionCookie = parseSessionCookieHeader(getHeaderValue(req.headers, 'cookie'));
  const authHeader = (getHeaderValue(req.headers, 'authorization') ?? '').trim();
  if (!sessionCookie && !authHeader.toLowerCase().startsWith('bearer ')) {
    sendJson(res, 401, { sent: false, error: 'Sesi aktif diperlukan untuk mengirim notifikasi email.' });
    return;
  }

  const body = await readJsonBody(req);
  if (!body || !String(body.username ?? '').trim()) {
    sendJson(res, 400, { sent: false, error: 'Username wajib disertakan.' });
    return;
  }

  const targetOwnerEmail = resolveTargetOwnerEmail(process.env);
  const { subject, text, html } = buildLoginAlertEmailContent(body);
  const shopName = String(body.shopName ?? 'BrewFlow POS').trim().slice(0, 100);

  // Option 1 (Primary): Google Gmail SMTP using Sandi Aplikasi (App Password)
  const gmailUser = (process.env.GMAIL_USER ?? '').trim();
  const gmailAppPassword = normalizeGmailAppPassword(process.env.GMAIL_APP_PASSWORD);

  if (gmailUser && gmailAppPassword) {
    if (!EMAIL_PATTERN.test(gmailUser)) {
      sendJson(res, 200, {
        sent: false,
        configured: true,
        provider: 'gmail_smtp',
        error: 'Format GMAIL_USER pada Environment Variables tidak valid.',
      });
      return;
    }

    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: gmailUser,
          pass: gmailAppPassword,
        },
      });

      const info = await transporter.sendMail({
        from: `"${shopName.replaceAll('"', '')}" <${gmailUser}>`,
        to: targetOwnerEmail,
        subject,
        text,
        html,
      });

      sendJson(res, 200, {
        sent: true,
        configured: true,
        provider: 'gmail_smtp',
        to: targetOwnerEmail,
        id: info.messageId ?? null,
      });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengirim via Gmail SMTP.';
      sendJson(res, 200, {
        sent: false,
        configured: true,
        provider: 'gmail_smtp',
        to: targetOwnerEmail,
        error: `Gmail SMTP gagal: ${msg}. Pastikan Verifikasi 2 Langkah aktif dan GMAIL_APP_PASSWORD adalah Sandi Aplikasi 16 karakter.`,
      });
      return;
    }
  }

  // Option 2 (Fallback): Resend API
  const resendApiKey = (process.env.RESEND_API_KEY ?? '').trim();
  if (resendApiKey) {
    try {
      const fromEmail =
        (process.env.ALERT_FROM_EMAIL ?? '').trim() || `${shopName} <onboarding@resend.dev>`;
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
          text,
          html,
        }),
      });
      const resendBody = (await resendRes.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };
      if (!resendRes.ok) {
        sendJson(res, 200, {
          sent: false,
          configured: true,
          provider: 'resend',
          to: targetOwnerEmail,
          error: resendBody.message || `Resend API HTTP ${resendRes.status}`,
        });
        return;
      }
      sendJson(res, 200, {
        sent: true,
        configured: true,
        provider: 'resend',
        to: targetOwnerEmail,
        id: resendBody.id ?? null,
      });
      return;
    } catch (err) {
      sendJson(res, 200, {
        sent: false,
        configured: true,
        provider: 'resend',
        error: err instanceof Error ? err.message : 'Gagal menghubungi Resend API.',
      });
      return;
    }
  }

  sendJson(res, 200, {
    sent: false,
    configured: false,
    to: targetOwnerEmail,
    error:
      'GMAIL_USER & GMAIL_APP_PASSWORD belum dipasang di Vercel Environment Variables. Tambahkan keduanya untuk mengirim email langsung via Sandi Aplikasi Google.',
  });
}
