import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { DEMO_USERS } from '../data/seedData';
import type { PageId, UserProfile, UserRole } from '../types';
import {
  extractSupabaseUserIdentity,
  getSupabaseGoogleAuthErrorMessage,
  matchEmployeeByEmail,
  mergeGoogleProfileIntoEmployee,
  normalizeEmail,
} from '../utils/googleAuth';
import {
  canAccessPage as checkCanAccessPage,
  canManageEmployees,
  canManageInventory,
  canManageOpnameSchedules,
  canViewHPP,
} from '../utils/rbac';
import { useStore } from './StoreContext';

const DEMO_STORAGE_KEY = 'brewflow_demo_role_v1';

interface AuthContextValue {
  user: UserProfile | null;
  authMode: 'supabase_google' | 'supabase' | 'demo' | null;
  authError: string | null;
  clearAuthError: () => void;
  isLoading: boolean;
  isSupabaseReady: boolean;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  demoLogin: (role: UserRole) => void;
  logout: () => Promise<void>;
  hasRole: (roles: UserRole | UserRole[]) => boolean;
  canAccess: (page: PageId) => boolean;
  isOwner: boolean;
  canSeeHPP: boolean;
  canSeeEmployees: boolean;
  canSeeOpnameScheduleSettings: boolean;
  canManageInventory: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function parseDemoRole(raw: string | null): UserRole | null {
  if (raw === 'owner' || raw === 'manager' || raw === 'cashier') {
    return raw;
  }
  return null;
}

function extractOAuthCallbackError(): string | null {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const errDesc =
    searchParams.get('error_description') ||
    hashParams.get('error_description') ||
    searchParams.get('error') ||
    hashParams.get('error');

  if (!errDesc) return null;

  // Clean error query/hash parameters from address bar
  try {
    const cleanUrl = `${window.location.pathname}`;
    window.history.replaceState({}, document.title, cleanUrl);
  } catch {
    // Ignore history errors in restricted frames
  }
  return getSupabaseGoogleAuthErrorMessage(errDesc);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { employees } = useStore();
  const employeesRef = useRef<UserProfile[]>(employees);
  employeesRef.current = employees;

  const [user, setUser] = useState<UserProfile | null>(null);
  const [authMode, setAuthMode] = useState<'supabase_google' | 'supabase' | 'demo' | null>(null);
  const authModeRef = useRef<'supabase_google' | 'supabase' | 'demo' | null>(null);
  authModeRef.current = authMode;
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  /**
   * Resolves a Supabase authenticated user (Google OAuth or Email/Password) against:
   * 1. Live Supabase `profiles` table (matching by email case-insensitively, or by user ID)
   * 2. Local employee directory (`employees`) as fallback when `profiles` is not yet seeded
   *
   * For Google OAuth sign-ins, strictly enforces that the email is registered AND active
   * in employee data; otherwise signs out immediately and surfaces a clear rejection error.
   */
  const resolveSupabaseUser = useCallback(async (sbUser: SupabaseUser) => {
    const identity = extractSupabaseUserIdentity(sbUser);
    const isGoogleLogin = identity.provider === 'google';
    const normalizedEmail = normalizeEmail(identity.email);

    // Step 1: Try matching in Supabase `profiles` table (by email first, then by auth user id)
    if (supabase) {
      try {
        let profileRow: Record<string, unknown> | null = null;

        if (normalizedEmail) {
          const { data: byEmail } = await supabase
            .from('profiles')
            .select(
              'id, full_name, email, role, phone_number, is_active, shift, position, created_at'
            )
            .ilike('email', normalizedEmail)
            .maybeSingle();
          if (byEmail) {
            profileRow = byEmail as Record<string, unknown>;
          }
        }

        if (!profileRow && !isGoogleLogin) {
          const { data: byId } = await supabase
            .from('profiles')
            .select('id, full_name, email, role, phone_number, is_active, created_at')
            .eq('id', sbUser.id)
            .maybeSingle();
          if (byId) {
            profileRow = byId as Record<string, unknown>;
          }
        }

        if (profileRow) {
          if (profileRow.is_active === false) {
            const name = String(profileRow.full_name || normalizedEmail || 'Karyawan');
            await supabase.auth.signOut();
            setUser(null);
            setAuthMode(null);
            setAuthError(
              `Akun karyawan "${name}" (${normalizedEmail}) sedang berstatus Nonaktif. Hubungi Owner untuk mengaktifkan kembali akses.`
            );
            return;
          }

          const fullName = String(
            profileRow.full_name || identity.displayName || normalizedEmail.split('@')[0] || 'Karyawan'
          );
          const initials = fullName
            .split(/\s+/)
            .map((part) => part[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();

          const dbEmployee: UserProfile = {
            id: String(profileRow.id),
            full_name: fullName,
            email: String(profileRow.email || normalizedEmail),
            role: (profileRow.role as UserRole) || 'cashier',
            phone_number: String(profileRow.phone_number || '-'),
            avatar_initials: initials || 'BF',
            is_active: true,
            shift: typeof profileRow.shift === 'string' ? profileRow.shift : undefined,
            position: typeof profileRow.position === 'string' ? profileRow.position : undefined,
            created_at: String(profileRow.created_at || new Date().toISOString()),
          };

          window.localStorage.removeItem(DEMO_STORAGE_KEY);
          setAuthError(null);
          setUser(mergeGoogleProfileIntoEmployee(dbEmployee, identity));
          setAuthMode(isGoogleLogin ? 'supabase_google' : 'supabase');
          return;
        }
      } catch {
        // If `profiles` table does not yet have extended columns, fall through to employee directory match
      }
    }

    // Step 2: Validate against registered employee directory in StoreContext
    const localMatch = matchEmployeeByEmail(identity.email, employeesRef.current);

    if (localMatch.status === 'matched') {
      window.localStorage.removeItem(DEMO_STORAGE_KEY);
      setAuthError(null);
      setUser(mergeGoogleProfileIntoEmployee(localMatch.employee, identity));
      setAuthMode(isGoogleLogin ? 'supabase_google' : 'supabase');
      return;
    }

    if (localMatch.status === 'inactive') {
      if (supabase) await supabase.auth.signOut();
      setUser(null);
      setAuthMode(null);
      setAuthError(localMatch.message);
      return;
    }

    // For Google OAuth, strictly reject emails not found in employee data
    if (isGoogleLogin) {
      if (supabase) await supabase.auth.signOut();
      setUser(null);
      setAuthMode(null);
      setAuthError(localMatch.message);
      return;
    }

    // Non-Google Supabase Email/Password fallback when profiles row hasn't been created yet
    const fallbackName = identity.displayName || normalizedEmail.split('@')[0] || 'Pengguna';
    window.localStorage.removeItem(DEMO_STORAGE_KEY);
    setAuthError(null);
    setUser({
      id: sbUser.id,
      full_name: fallbackName,
      email: normalizedEmail,
      role: 'cashier',
      phone_number: '-',
      avatar_initials: fallbackName.slice(0, 2).toUpperCase(),
      is_active: true,
      created_at: new Date().toISOString(),
    });
    setAuthMode('supabase');
  }, []);

  useEffect(() => {
    let active = true;

    async function bootstrapSession() {
      // Surface any Supabase OAuth redirect error (e.g. access_denied)
      const callbackError = extractOAuthCallbackError();
      if (callbackError && active) {
        setAuthError(callbackError);
      }

      // Support ?autostart=1 (& optional ?role=owner|manager|cashier) for instant preview
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        const paramRole = parseDemoRole(params.get('role')) ?? 'owner';
        window.localStorage.setItem(DEMO_STORAGE_KEY, paramRole);
        if (active) {
          setUser(DEMO_USERS[paramRole]);
          setAuthMode('demo');
          setIsLoading(false);
        }
        return;
      }

      // Check live Supabase session first (so returning Google OAuth callbacks take priority)
      if (supabase) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session?.user && active) {
            await resolveSupabaseUser(session.user);
            if (active) setIsLoading(false);
            return;
          }
        } catch {
          // Safe fallback to demo or logged-out state
        }
      }

      // Otherwise check persisted Demo Quick Login
      const storedDemoRole = parseDemoRole(window.localStorage.getItem(DEMO_STORAGE_KEY));
      if (storedDemoRole) {
        if (active) {
          setUser(DEMO_USERS[storedDemoRole]);
          setAuthMode('demo');
          setIsLoading(false);
        }
        return;
      }

      if (active) {
        setIsLoading(false);
      }
    }

    bootstrapSession();

    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void resolveSupabaseUser(session.user);
      } else if (
        !window.localStorage.getItem(DEMO_STORAGE_KEY) &&
        (authModeRef.current === 'supabase' || authModeRef.current === 'supabase_google')
      ) {
        setUser(null);
        setAuthMode(null);
      }
    });

    return () => {
      active = false;
      subscription?.data.subscription.unsubscribe();
    };
  }, [resolveSupabaseUser]);

  // Keep active Google-authenticated user synced if Owner edits/deactivates them in EmployeesPage
  useEffect(() => {
    if (authMode !== 'supabase_google' || !user) return;
    const matched = employees.find(
      (emp) => emp.id === user.id || normalizeEmail(emp.email) === normalizeEmail(user.email)
    );
    if (!matched) return;
    if (!matched.is_active) {
      if (supabase) void supabase.auth.signOut();
      setUser(null);
      setAuthMode(null);
      setAuthError(
        `Akun karyawan "${matched.full_name}" telah dinonaktifkan oleh Owner. Anda telah dikeluarkan otomatis.`
      );
      return;
    }
    if (
      matched.full_name !== user.full_name ||
      matched.role !== user.role ||
      matched.avatar_initials !== user.avatar_initials
    ) {
      setUser((prev) => (prev ? { ...matched, photo_url: prev.photo_url } : matched));
    }
  }, [employees, authMode, user]);

  const signInWithGoogle = useCallback(async (): Promise<{ error: string | null }> => {
    setAuthError(null);

    if (!supabase) {
      const msg =
        'Koneksi Supabase belum dikonfigurasi (VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY). Isi variabel tersebut di .env / Vercel dan aktifkan Google Provider di Supabase Auth, atau gunakan Demo Quick Login di samping.';
      setAuthError(msg);
      return { error: msg };
    }

    try {
      window.localStorage.removeItem(DEMO_STORAGE_KEY);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          queryParams: {
            prompt: 'select_account',
          },
        },
      });

      if (error) {
        const msg = getSupabaseGoogleAuthErrorMessage(error);
        setAuthError(msg);
        return { error: msg };
      }

      return { error: null };
    } catch (error) {
      const msg = getSupabaseGoogleAuthErrorMessage(error);
      setAuthError(msg);
      return { error: msg };
    }
  }, []);

  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      setAuthError(null);
      const trimmedEmail = email.trim();
      if (!trimmedEmail || !password.trim()) {
        return { error: 'Email dan kata sandi wajib diisi.' };
      }

      if (!supabase) {
        return {
          error:
            'Koneksi Supabase belum dikonfigurasi (VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY). Gunakan tombol Demo Quick Login di samping untuk mencoba aplikasi.',
        };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        return { error: error.message || 'Gagal masuk. Periksa kembali email dan kata sandi Anda.' };
      }

      if (data.user) {
        await resolveSupabaseUser(data.user);
      }
      return { error: null };
    },
    [resolveSupabaseUser]
  );

  const demoLogin = useCallback((role: UserRole) => {
    setAuthError(null);
    window.localStorage.setItem(DEMO_STORAGE_KEY, role);
    setUser(DEMO_USERS[role]);
    setAuthMode('demo');
  }, []);

  const logout = useCallback(async () => {
    setAuthError(null);
    window.localStorage.removeItem(DEMO_STORAGE_KEY);
    if (supabase && (authMode === 'supabase' || authMode === 'supabase_google')) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setAuthMode(null);
  }, [authMode]);

  const hasRole = useCallback(
    (roles: UserRole | UserRole[]) => {
      if (!user) return false;
      return Array.isArray(roles) ? roles.includes(user.role) : user.role === roles;
    },
    [user]
  );

  const canAccess = useCallback(
    (page: PageId) => {
      if (!user) return false;
      return checkCanAccessPage(user.role, page);
    },
    [user]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      authMode,
      authError,
      clearAuthError,
      isLoading,
      isSupabaseReady: isSupabaseConfigured,
      signInWithGoogle,
      signInWithEmail,
      demoLogin,
      logout,
      hasRole,
      canAccess,
      isOwner: user?.role === 'owner',
      canSeeHPP: user ? canViewHPP(user.role) : false,
      canSeeEmployees: user ? canManageEmployees(user.role) : false,
      canSeeOpnameScheduleSettings: user ? canManageOpnameSchedules(user.role) : false,
      canManageInventory: user ? canManageInventory(user.role) : false,
    }),
    [
      user,
      authMode,
      authError,
      clearAuthError,
      isLoading,
      signInWithGoogle,
      signInWithEmail,
      demoLogin,
      logout,
      hasRole,
      canAccess,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth harus digunakan di dalam AuthProvider.');
  }
  return ctx;
}
