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
import type { PageId, UserProfile, UserRole } from '../types';
import {
  extractSupabaseUserIdentity,
  findMatchingDatabaseRow,
  getSupabaseGoogleAuthErrorMessage,
  isEmployeeRowActive,
  matchEmployeeByEmail,
  mergeGoogleProfileIntoEmployee,
  normalizeEmail,
  normalizeEmployeeRole,
} from '../utils/googleAuth';
import {
  canAccessPage as checkCanAccessPage,
  canManageEmployees,
  canManageInventory,
  canManageOpnameSchedules,
  canViewHPP,
} from '../utils/rbac';
import { useStore } from './StoreContext';

const LEGACY_DEMO_STORAGE_KEY = 'brewflow_demo_role_v1';

interface AuthContextValue {
  user: UserProfile | null;
  authMode: 'supabase' | null;
  authProvider: 'google' | 'email' | null;
  authError: string | null;
  clearAuthError: () => void;
  isLoading: boolean;
  isSupabaseReady: boolean;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
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

function extractOAuthCallbackError(): string | null {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const errDesc =
    searchParams.get('error_description') ||
    hashParams.get('error_description') ||
    searchParams.get('error') ||
    hashParams.get('error');

  if (!errDesc) return null;

  try {
    window.history.replaceState({}, document.title, window.location.pathname);
  } catch {
    // Ignore history errors in restricted frames
  }
  return getSupabaseGoogleAuthErrorMessage(errDesc);
}

const MISSING_SUPABASE_CONFIG_MESSAGE =
  'Koneksi Supabase belum terdeteksi pada build ini. Pastikan variabel VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY (atau NEXT_PUBLIC_SUPABASE_URL & NEXT_PUBLIC_SUPABASE_ANON_KEY dari integrasi Supabase-Vercel) sudah terpasang di Vercel Environment Variables, lalu lakukan Redeploy.';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { employees } = useStore();
  const employeesRef = useRef<UserProfile[]>(employees);
  employeesRef.current = employees;
  const resolvingRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [authMode, setAuthMode] = useState<'supabase' | null>(null);
  const [authProvider, setAuthProvider] = useState<'google' | 'email' | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  /**
   * Resolves a Supabase authenticated user (Google OAuth or Email/Password) against:
   * 1. SECURITY DEFINER RPC `get_my_employee_profile` (if installed)
   * 2. Live Supabase `employees` table (case-insensitive & trim-safe email or auth_user_id)
   * 3. Live Supabase `profiles` table (by auth user id or email, resilient to minimal schemas)
   * 4. Fallback to hydrated employee directory in StoreContext
   *
   * Strictly rejects unregistered or inactive Google accounts and signs them out immediately,
   * while surfacing actionable RLS/permission diagnostics if the database query itself was blocked.
   */
  const resolveSupabaseUserInner = useCallback(async (sbUser: SupabaseUser) => {
    const identity = extractSupabaseUserIdentity(sbUser);
    const isGoogleLogin = identity.provider === 'google';
    const normalizedEmail = normalizeEmail(identity.email);
    let dbAccessError: string | null = null;

    if (supabase) {
      try {
        let matchedRow: Record<string, unknown> | null = null;
        let matchedFromEmployeesTable = false;

        // 1. Try SECURITY DEFINER RPC if deployed (immune to client-side RLS edge cases)
        try {
          const { data: rpcData, error: rpcError } = await supabase.rpc('get_my_employee_profile');
          if (!rpcError && rpcData && typeof rpcData === 'object') {
            const candidate = Array.isArray(rpcData) ? rpcData[0] : rpcData;
            if (candidate && typeof candidate === 'object') {
              matchedRow = candidate as Record<string, unknown>;
              matchedFromEmployeesTable = true;
            }
          }
        } catch {
          // RPC not installed yet — proceed with direct table queries
        }

        // 2. Query `employees` with select('*') so optional/missing columns never cause a query error
        if (!matchedRow && normalizedEmail) {
          const { data: empExactRows, error: empExactErr } = await supabase
            .from('employees')
            .select('*')
            .ilike('email', normalizedEmail)
            .limit(5);

          if (empExactErr) {
            const code = String(empExactErr.code ?? '');
            if (code !== '42P01' && code !== 'PGRST205') {
              dbAccessError = empExactErr.message;
            }
          } else if (empExactRows && empExactRows.length > 0) {
            matchedRow = findMatchingDatabaseRow(
              empExactRows as Array<Record<string, unknown>>,
              normalizedEmail,
              sbUser.id
            );
            if (matchedRow) matchedFromEmployeesTable = true;
          }
        }

        // 2b. Fallback scan of visible `employees` rows (handles accidental leading/trailing spaces in DB email or auth_user_id match)
        if (!matchedRow) {
          const { data: empListRows, error: empListErr } = await supabase
            .from('employees')
            .select('*')
            .limit(200);

          if (!empListErr && empListRows && empListRows.length > 0) {
            matchedRow = findMatchingDatabaseRow(
              empListRows as Array<Record<string, unknown>>,
              normalizedEmail,
              sbUser.id
            );
            if (matchedRow) matchedFromEmployeesTable = true;
          } else if (empListErr && !dbAccessError) {
            const code = String(empListErr.code ?? '');
            if (code !== '42P01' && code !== 'PGRST205') {
              dbAccessError = empListErr.message;
            }
          }
        }

        // 3. Fallback to `profiles` table by auth user ID (works for both Google OAuth and Email logins)
        if (!matchedRow) {
          const { data: profByIdRows, error: profByIdErr } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', sbUser.id)
            .limit(1);

          if (!profByIdErr && profByIdRows && profByIdRows.length > 0) {
            matchedRow = profByIdRows[0] as Record<string, unknown>;
          }
        }

        // 3b. Fallback to `profiles` table by email (if `email` column exists in `profiles`)
        if (!matchedRow && normalizedEmail) {
          const { data: profByEmailRows, error: profEmailErr } = await supabase
            .from('profiles')
            .select('*')
            .ilike('email', normalizedEmail)
            .limit(5);

          if (!profEmailErr && profByEmailRows && profByEmailRows.length > 0) {
            matchedRow = findMatchingDatabaseRow(
              profByEmailRows as Array<Record<string, unknown>>,
              normalizedEmail,
              sbUser.id
            );
          }
        }

        if (matchedRow) {
          if (!isEmployeeRowActive(matchedRow)) {
            const name = String(matchedRow.full_name || normalizedEmail || 'Karyawan');
            await supabase.auth.signOut();
            setUser(null);
            setAuthMode(null);
            setAuthProvider(null);
            setAuthError(
              `Akun karyawan "${name}" (${normalizedEmail}) sedang berstatus Nonaktif. Hubungi Owner untuk mengaktifkan kembali akses.`
            );
            return;
          }

          const fullName = String(
            matchedRow.full_name ||
              matchedRow.name ||
              identity.displayName ||
              normalizedEmail.split('@')[0] ||
              'Karyawan'
          ).trim();
          const initials = fullName
            .split(/\s+/)
            .map((part) => part[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();

          const dbEmployee: UserProfile = {
            id: sbUser.id,
            full_name: fullName,
            email: normalizeEmail(
              typeof matchedRow.email === 'string' ? matchedRow.email : normalizedEmail
            ),
            role: normalizeEmployeeRole(matchedRow.role),
            phone_number: String(matchedRow.phone_number || '-'),
            avatar_initials: initials || 'BF',
            is_active: true,
            shift: typeof matchedRow.shift === 'string' ? matchedRow.shift : undefined,
            position: typeof matchedRow.position === 'string' ? matchedRow.position : undefined,
            created_at: String(matchedRow.created_at || new Date().toISOString()),
          };

          if (matchedFromEmployeesTable) {
            void (async () => {
              try {
                await supabase.from('profiles').upsert(
                  {
                    id: sbUser.id,
                    full_name: dbEmployee.full_name,
                    role: dbEmployee.role,
                    phone_number: dbEmployee.phone_number,
                  },
                  { onConflict: 'id' }
                );
              } catch {
                // Non-blocking FK sync
              }
            })();
          }

          setAuthError(null);
          setUser(mergeGoogleProfileIntoEmployee(dbEmployee, identity));
          setAuthMode('supabase');
          setAuthProvider(isGoogleLogin ? 'google' : 'email');
          return;
        }
      } catch (err) {
        if (!dbAccessError && err instanceof Error) {
          dbAccessError = err.message;
        }
      }
    }

    const localMatch = matchEmployeeByEmail(identity.email, employeesRef.current);

    if (localMatch.status === 'matched') {
      setAuthError(null);
      setUser(mergeGoogleProfileIntoEmployee(localMatch.employee, identity));
      setAuthMode('supabase');
      setAuthProvider(isGoogleLogin ? 'google' : 'email');
      return;
    }

    if (localMatch.status === 'inactive') {
      if (supabase) await supabase.auth.signOut();
      setUser(null);
      setAuthMode(null);
      setAuthProvider(null);
      setAuthError(localMatch.message);
      return;
    }

    if (isGoogleLogin) {
      if (supabase) await supabase.auth.signOut();
      setUser(null);
      setAuthMode(null);
      setAuthProvider(null);
      if (dbAccessError) {
        setAuthError(
          `Gagal membaca tabel karyawan di Supabase untuk "${normalizedEmail}" (${dbAccessError}). Pastikan file SQL supabase/schema_google_oauth_employees.sql sudah dijalankan di Supabase SQL Editor agar policy RLS mengizinkan verifikasi email.`
        );
      } else {
        setAuthError(
          `Email "${normalizedEmail}" belum terbaca di tabel employees Supabase. Pastikan email terdaftar aktif di tabel public.employees (bukan hanya di Authentication → Users) dan policy RLS dari supabase/schema_google_oauth_employees.sql sudah dijalankan.`
        );
      }
      return;
    }

    // Email/password Supabase user fallback when profile row is not yet created
    const fallbackName = identity.displayName || normalizedEmail.split('@')[0] || 'Pengguna';
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
    setAuthProvider('email');
  }, []);

  const resolveSupabaseUser = useCallback(
    async (sbUser: SupabaseUser) => {
      if (resolvingRef.current && resolvingRef.current.userId === sbUser.id) {
        return resolvingRef.current.promise;
      }
      const promise = resolveSupabaseUserInner(sbUser).finally(() => {
        if (resolvingRef.current?.userId === sbUser.id) {
          resolvingRef.current = null;
        }
      });
      resolvingRef.current = { userId: sbUser.id, promise };
      return promise;
    },
    [resolveSupabaseUserInner]
  );

  useEffect(() => {
    let active = true;

    // Clean up any legacy storage key from earlier builds
    try {
      window.localStorage.removeItem(LEGACY_DEMO_STORAGE_KEY);
    } catch {
      // Ignore storage restrictions
    }

    async function bootstrapSession() {
      const callbackError = extractOAuthCallbackError();
      if (callbackError && active) {
        setAuthError(callbackError);
      }

      if (supabase) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session?.user && active) {
            await resolveSupabaseUser(session.user);
          }
        } catch {
          // Stay logged out on session read error
        }
      }

      if (active) {
        setIsLoading(false);
      }
    }

    void bootstrapSession();

    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void resolveSupabaseUser(session.user);
      } else {
        setUser(null);
        setAuthMode(null);
        setAuthProvider(null);
      }
    });

    return () => {
      active = false;
      subscription?.data.subscription.unsubscribe();
    };
  }, [resolveSupabaseUser]);

  // Keep active Google-authenticated user synced if Owner edits or deactivates them
  useEffect(() => {
    if (authProvider !== 'google' || !user) return;
    const matched = employees.find(
      (emp) => emp.id === user.id || normalizeEmail(emp.email) === normalizeEmail(user.email)
    );
    if (!matched) return;
    if (!matched.is_active) {
      if (supabase) void supabase.auth.signOut();
      setUser(null);
      setAuthMode(null);
      setAuthProvider(null);
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
      setUser((prev) => (prev ? { ...matched, id: prev.id, photo_url: prev.photo_url } : matched));
    }
  }, [employees, authProvider, user]);

  const signInWithGoogle = useCallback(async (): Promise<{ error: string | null }> => {
    setAuthError(null);

    if (!supabase) {
      setAuthError(MISSING_SUPABASE_CONFIG_MESSAGE);
      return { error: MISSING_SUPABASE_CONFIG_MESSAGE };
    }

    try {
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
        return { error: MISSING_SUPABASE_CONFIG_MESSAGE };
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

  const logout = useCallback(async () => {
    setAuthError(null);
    if (supabase) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setAuthMode(null);
    setAuthProvider(null);
  }, []);

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
      authProvider,
      authError,
      clearAuthError,
      isLoading,
      isSupabaseReady: isSupabaseConfigured,
      signInWithGoogle,
      signInWithEmail,
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
      authProvider,
      authError,
      clearAuthError,
      isLoading,
      signInWithGoogle,
      signInWithEmail,
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
