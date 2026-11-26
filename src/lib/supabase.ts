import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;

const supabaseUrl = (env?.VITE_SUPABASE_URL || env?.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const supabaseAnonKey = (
  env?.VITE_SUPABASE_ANON_KEY ||
  env?.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env?.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  ''
).trim();

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    !supabaseUrl.includes('your-project-id') &&
    !supabaseAnonKey.includes('your-supabase-anon-key')
);

/**
 * Production Supabase client instance.
 * Automatically reads VITE_SUPABASE_* or NEXT_PUBLIC_SUPABASE_* public keys
 * (compatible with both manual Vercel env vars and the official Vercel-Supabase integration).
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null;
