const AUTH_SESSION_ENDPOINT = '/api/auth-session';
const SESSION_TOKEN_REGEX = /^[a-f0-9]{64}$/i;

export interface RestoredAppSessionCookie {
  token: string;
  username: string | null;
}

export async function persistAppSessionCookie(
  token: string,
  username?: string | null
): Promise<boolean> {
  if (!SESSION_TOKEN_REGEX.test(token.trim())) return false;
  try {
    const res = await fetch(AUTH_SESSION_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify({
        token: token.trim().toLowerCase(),
        username: username ? username.trim().toLowerCase().replace(/^@+/, '') : undefined,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function restoreAppSessionCookie(): Promise<RestoredAppSessionCookie | null> {
  try {
    const res = await fetch(AUTH_SESSION_ENDPOINT, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;

    const payload = (await res.json()) as {
      authenticated?: boolean;
      token?: unknown;
      username?: unknown;
    };

    if (
      !payload.authenticated ||
      typeof payload.token !== 'string' ||
      !SESSION_TOKEN_REGEX.test(payload.token.trim())
    ) {
      return null;
    }

    return {
      token: payload.token.trim().toLowerCase(),
      username: typeof payload.username === 'string' && payload.username.trim()
        ? payload.username.trim().toLowerCase()
        : null,
    };
  } catch {
    return null;
  }
}

export async function clearAppSessionCookie(): Promise<void> {
  try {
    await fetch(AUTH_SESSION_ENDPOINT, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
  } catch {
    // Non-blocking cookie cleanup
  }
}
