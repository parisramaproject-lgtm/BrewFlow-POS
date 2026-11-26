import type { IncomingMessage, ServerResponse } from 'http';

export const APP_SESSION_COOKIE_NAME = 'bf_app_sess';
export const APP_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days
const MAX_BODY_BYTES = 1024;
const SESSION_TOKEN_REGEX = /^[a-f0-9]{64}$/i;
const USERNAME_HINT_REGEX = /^[a-z0-9._-]{2,40}$/;

export interface ParsedSessionCookie {
  token: string;
  username: string | null;
}

export function isValidSessionToken(value: unknown): value is string {
  return typeof value === 'string' && SESSION_TOKEN_REGEX.test(value.trim());
}

export function sanitizeUsernameHint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().toLowerCase().replace(/^@+/, '');
  return USERNAME_HINT_REGEX.test(cleaned) ? cleaned : null;
}

export function buildSessionSetCookieHeader(token: string, username?: string | null): string {
  const cleanToken = token.trim().toLowerCase();
  const cleanUsername = sanitizeUsernameHint(username);
  const rawValue = cleanUsername ? `${cleanToken}.${cleanUsername}` : cleanToken;
  return `${APP_SESSION_COOKIE_NAME}=${rawValue}; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=${APP_SESSION_MAX_AGE_SECONDS}`;
}

export function buildClearSessionCookieHeader(): string {
  return `${APP_SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=None; Partitioned; Path=/; Max-Age=0`;
}

export function parseSessionCookieHeader(
  cookieHeader: string | undefined
): ParsedSessionCookie | null {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(';');
  for (const part of pairs) {
    const eqIndex = part.indexOf('=');
    if (eqIndex <= 0) continue;
    const name = part.slice(0, eqIndex).trim();
    if (name !== APP_SESSION_COOKIE_NAME) continue;
    const rawValue = part.slice(eqIndex + 1).trim();
    if (!rawValue) return null;

    const dotIndex = rawValue.indexOf('.');
    const tokenPart = dotIndex >= 0 ? rawValue.slice(0, dotIndex) : rawValue;
    const usernamePart = dotIndex >= 0 ? rawValue.slice(dotIndex + 1) : null;

    if (!isValidSessionToken(tokenPart)) {
      return null;
    }

    return {
      token: tokenPart.trim().toLowerCase(),
      username: sanitizeUsernameHint(usernamePart),
    };
  }
  return null;
}

function getHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(direct)) return direct[0];
  return direct;
}

export function isSameOriginRequest(
  headers: Record<string, string | string[] | undefined>
): boolean {
  const xRequestedWith = (getHeaderValue(headers, 'x-requested-with') || '').trim().toLowerCase();
  if (xRequestedWith !== 'xmlhttprequest') {
    return false;
  }

  const origin = getHeaderValue(headers, 'origin');
  if (!origin) {
    // Allow same-origin requests where Origin header is omitted if X-Requested-With is set
    return true;
  }

  const forwardedHost = (getHeaderValue(headers, 'x-forwarded-host') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const host = (getHeaderValue(headers, 'host') || '').trim().toLowerCase();
  const expectedHost = forwardedHost || host;
  if (!expectedHost) return false;

  try {
    const originHost = new URL(origin).host.toLowerCase();
    return originHost === expectedHost;
  } catch {
    return false;
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  // Support frameworks (like Vercel Node runtime) that may already parse req.body
  const preParsed = (req as IncomingMessage & { body?: unknown }).body;
  if (preParsed && typeof preParsed === 'object' && !Buffer.isBuffer(preParsed)) {
    return preParsed as Record<string, unknown>;
  }
  if (typeof preParsed === 'string') {
    if (Buffer.byteLength(preParsed, 'utf8') > MAX_BODY_BYTES) return null;
    try {
      const parsed = JSON.parse(preParsed);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
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
        resolve(parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null);
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

export default async function handleAuthSessionRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'GET') {
    const parsed = parseSessionCookieHeader(getHeaderValue(req.headers, 'cookie'));
    if (!parsed) {
      sendJson(res, 200, { authenticated: false, token: null, username: null });
      return;
    }
    sendJson(res, 200, {
      authenticated: true,
      token: parsed.token,
      username: parsed.username,
    });
    return;
  }

  if (method === 'POST') {
    if (!isSameOriginRequest(req.headers)) {
      sendJson(res, 403, { ok: false, error: 'Permintaan tidak valid.' });
      return;
    }

    const body = await readJsonBody(req);
    if (!body || !isValidSessionToken(body.token)) {
      sendJson(res, 400, { ok: false, error: 'Format token sesi tidak valid.' });
      return;
    }

    const username = sanitizeUsernameHint(body.username);
    res.setHeader('Set-Cookie', buildSessionSetCookieHeader(body.token, username));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'DELETE') {
    if (!isSameOriginRequest(req.headers)) {
      sendJson(res, 403, { ok: false, error: 'Permintaan tidak valid.' });
      return;
    }
    res.setHeader('Set-Cookie', buildClearSessionCookieHeader());
    sendJson(res, 200, { ok: true });
    return;
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  sendJson(res, 405, { ok: false, error: 'Method tidak diizinkan.' });
}
