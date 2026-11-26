import { createClient } from '@supabase/supabase-js';

const env = ((import.meta as { env?: Record<string, string | undefined> }).env ?? {}) as Record<
  string,
  string | undefined
>;

// Support both Vite (`VITE_*`) and Vercel-Supabase Marketplace (`NEXT_PUBLIC_*`) public env vars.
const supabaseUrl = (env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const supabaseAnonKey = (
  env.VITE_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  ''
).trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// In-memory cryptographic session token issued by Supabase `authenticate_employee_username` RPC.
// Never persisted to localStorage; sent over HTTPS inside the CORS-allowed `x-client-info` header.
let activeAppSessionToken: string | null = null;

export function setAppSessionToken(token: string | null): void {
  activeAppSessionToken = token && /^[a-f0-9]{64}$/i.test(token.trim()) ? token.trim() : null;
}

export function getAppSessionToken(): string | null {
  return activeAppSessionToken;
}

const sessionAwareFetch: typeof fetch = (input, init) => {
  if (!activeAppSessionToken) {
    return fetch(input, init);
  }
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const currentClientInfo = headers.get('x-client-info') || 'supabase-js-web';
  if (!currentClientInfo.includes('bf-sess=')) {
    headers.set('x-client-info', `${currentClientInfo}; bf-sess=${activeAppSessionToken}`);
  }
  return fetch(input, { ...init, headers });
};

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
      global: {
        fetch: sessionAwareFetch,
      },
    })
  : null;
