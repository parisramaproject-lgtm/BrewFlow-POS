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
import { isSupabaseConfigured, setAppSessionToken, supabase } from '../lib/supabase';
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
  resolveOAuthRedirectUrl,
} from '../utils/googleAuth';
import {
  canAccessPage as checkCanAccessPage,
  canManageEmployees,
  canManageInventory,
  canManageOpnameSchedules,
  canViewHPP,
} from '../utils/rbac';
import {
  DEFAULT_OWNER_ALERT_EMAIL,
  sendOwnerUsernameLoginAlert,
} from '../services/loginAlertService';
import {
  clearAppSessionCookie,
  persistAppSessionCookie,
  restoreAppSessionCookie,
} from '../services/sessionCookieService';
import { normalizeUsername, verifyPasswordLocal } from '../utils/usernameAuth';
import { useStore } from './StoreContext';

const LEGACY_DEMO_STORAGE_KEY = 'brewflow_demo_role_v1';

function mapEmployeeRowToProfile(
  row: Record<string, unknown>,
  fallbackUsername?: string
): UserProfile {
  const cleanFallback = fallbackUsername ? normalizeUsername(fallbackUsername) : '';
  const fullName = String(row.full_name || row.name || cleanFallback || 'Karyawan').trim();
  const initials = fullName
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return {
    id: String(row.id || `usr-${Date.now()}`),
    full_name: fullName,
    email: normalizeEmail(typeof row.email === 'string' ? row.email : ''),
    username:
      typeof row.username === 'string' && row.username.trim()
        ? normalizeUsername(row.username)
        : cleanFallback || undefined,
    has_password: Boolean(row.has_password ?? true),
    role: normalizeEmployeeRole(row.role),
    phone_number: String(row.phone_number || '-'),
    avatar_initials: initials || 'BF',
    is_active: row.is_active !== false,
    shift: typeof row.shift === 'string' ? row.shift : undefined,
    position: typeof row.position === 'string' ? row.position : undefined,
    created_at: String(row.created_at || new Date().toISOString()),
  };
}

function isLikelyTransientAuthOrNetworkError(message: string | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes('jwt') ||
    lower.includes('expired') ||
    lower.includes('401') ||
    lower.includes('failed to fetch') ||
    lower.includes('load failed') ||
    lower.includes('network') ||
    lower.includes('timeout') ||
    lower.includes('abort')
  );
}

interface AuthContextValue {
  user: UserProfile | null;
  authMode: 'supabase' | null;
  authProvider: 'google' | 'email' | 'username' | null;
  authError: string | null;
  clearAuthError: () => void;
  isLoading: boolean;
  isSupabaseReady: boolean;
  signInWithGoogle: () => Promise<{ error: string | null }>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithUsername: (username: string, password: string) => Promise<{ error: string | null }>;
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
  const { employees, settings, recordUsernameLoginLog, refreshAllFromSupabase } = useStore();
  const employeesRef = useRef<UserProfile[]>(employees);
  employeesRef.current = employees;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const resolvingRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [authMode, setAuthMode] = useState<'supabase' | null>(null);
  const [authProvider, setAuthProvider] = useState<'google' | 'email' | 'username' | null>(null);
  const authProviderRef = useRef<'google' | 'email' | 'username' | null>(null);
  authProviderRef.current = authProvider;
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
  const resolveSupabaseUserInner = useCallback(
    async (sbUser: SupabaseUser, options?: { isSessionRestore?: boolean }) => {
      const identity = extractSupabaseUserIdentity(sbUser);
      const isGoogleLogin = identity.provider === 'google';
      const normalizedEmail = normalizeEmail(identity.email);
      let dbAccessError: string | null = null;

      if (supabase) {
        const client = supabase;
        const queryEmployeeFromSupabase = async (): Promise<{
          matchedRow: Record<string, unknown> | null;
          matchedFromEmployeesTable: boolean;
          accessError: string | null;
        }> => {
          let matchedRow: Record<string, unknown> | null = null;
          let matchedFromEmployeesTable = false;
          let accessError: string | null = null;

          // 1. Try SECURITY DEFINER RPC if deployed (immune to client-side RLS edge cases)
          try {
            const { data: rpcData, error: rpcError } = await client.rpc('get_my_employee_profile');
            if (!rpcError && rpcData && typeof rpcData === 'object') {
              const candidate = Array.isArray(rpcData) ? rpcData[0] : rpcData;
              if (candidate && typeof candidate === 'object') {
                matchedRow = candidate as Record<string, unknown>;
                matchedFromEmployeesTable = true;
              }
            } else if (rpcError) {
              const code = String(rpcError.code ?? '');
              if (code !== 'PGRST202' && code !== '42883') {
                accessError = rpcError.message;
              }
            }
          } catch (err) {
            if (err instanceof Error) accessError = err.message;
          }

          // 2. Query `employees` with select('*') so optional/missing columns never cause a query error
          if (!matchedRow && normalizedEmail) {
            const { data: empExactRows, error: empExactErr } = await client
              .from('employees')
              .select('*')
              .ilike('email', normalizedEmail)
              .limit(5);

            if (empExactErr) {
              const code = String(empExactErr.code ?? '');
              if (code !== '42P01' && code !== 'PGRST205') {
                accessError = empExactErr.message;
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

          // 2b. Fallback scan of visible `employees` rows
          if (!matchedRow) {
            const { data: empListRows, error: empListErr } = await client
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
            } else if (empListErr && !accessError) {
              const code = String(empListErr.code ?? '');
              if (code !== '42P01' && code !== 'PGRST205') {
                accessError = empListErr.message;
              }
            }
          }

          // 3. Fallback to `profiles` table by auth user ID
          if (!matchedRow) {
            const { data: profByIdRows, error: profByIdErr } = await client
              .from('profiles')
              .select('*')
              .eq('id', sbUser.id)
              .limit(1);

            if (!profByIdErr && profByIdRows && profByIdRows.length > 0) {
              matchedRow = profByIdRows[0] as Record<string, unknown>;
            }
          }

          // 3b. Fallback to `profiles` table by email
          if (!matchedRow && normalizedEmail) {
            const { data: profByEmailRows, error: profEmailErr } = await client
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

          return { matchedRow, matchedFromEmployeesTable, accessError };
        };

        try {
          let result = await queryEmployeeFromSupabase();
          dbAccessError = result.accessError;

          // If the JWT just expired or a transient 401 occurred on reload, refresh session once & retry
          if (
            !result.matchedRow &&
            (isLikelyTransientAuthOrNetworkError(dbAccessError) || options?.isSessionRestore)
          ) {
            const { data: refreshed } = await client.auth.refreshSession();
            if (refreshed.session?.user) {
              result = await queryEmployeeFromSupabase();
              dbAccessError = result.accessError;
            }
          }

          if (result.matchedRow) {
            const matchedRow = result.matchedRow;
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

            if (result.matchedFromEmployeesTable) {
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

            setAppSessionToken(null);
            void clearAppSessionCookie();
            setAuthError(null);
            setUser(mergeGoogleProfileIntoEmployee(dbEmployee, identity));
            setAuthMode('supabase');
            setAuthProvider(isGoogleLogin ? 'google' : 'email');
            void refreshAllFromSupabase();
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
        setAppSessionToken(null);
        void clearAppSessionCookie();
        setAuthError(null);
        setUser(mergeGoogleProfileIntoEmployee(localMatch.employee, identity));
        setAuthMode('supabase');
        setAuthProvider(isGoogleLogin ? 'google' : 'email');
        void refreshAllFromSupabase();
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
        // Never destroy a valid Google OAuth session on a transient DB/network hiccup during reload
        if (dbAccessError) {
          setAuthError(
            `Gagal membaca tabel karyawan di Supabase untuk "${normalizedEmail}" (${dbAccessError}). Muat ulang halaman atau pastikan policy RLS di supabase/schema_full_brewflow.sql sudah dijalankan.`
          );
          return;
        }
        if (supabase) await supabase.auth.signOut();
        setUser(null);
        setAuthMode(null);
        setAuthProvider(null);
        setAuthError(
          `Email "${normalizedEmail}" belum terbaca di tabel employees Supabase. Pastikan email terdaftar aktif di tabel public.employees (bukan hanya di Authentication → Users) dan policy RLS dari supabase/schema_full_brewflow.sql sudah dijalankan.`
        );
        return;
      }

      // Email/password Supabase user fallback when profile row is not yet created
      const fallbackName = identity.displayName || normalizedEmail.split('@')[0] || 'Pengguna';
      setAppSessionToken(null);
      void clearAppSessionCookie();
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
      void refreshAllFromSupabase();
    },
    [refreshAllFromSupabase]
  );

  const resolveSupabaseUser = useCallback(
    async (sbUser: SupabaseUser, options?: { isSessionRestore?: boolean }) => {
      if (resolvingRef.current && resolvingRef.current.userId === sbUser.id) {
        return resolvingRef.current.promise;
      }
      const promise = resolveSupabaseUserInner(sbUser, options).finally(() => {
        if (resolvingRef.current?.userId === sbUser.id) {
          resolvingRef.current = null;
        }
      });
      resolvingRef.current = { userId: sbUser.id, promise };
      return promise;
    },
    [resolveSupabaseUserInner]
  );

  const restoreUsernameSession = useCallback(async (): Promise<boolean> => {
    if (!supabase) return false;
    const cookieSession = await restoreAppSessionCookie();
    if (!cookieSession?.token) return false;

    setAppSessionToken(cookieSession.token);

    try {
      const { data, error } = await supabase.rpc('get_app_session_profile');

      if (!error && data && typeof data === 'object') {
        const payload = data as {
          status?: string;
          message?: string;
          employee?: Record<string, unknown>;
        };

        if (payload.status === 'ok' && payload.employee) {
          const restoredUser = mapEmployeeRowToProfile(
            payload.employee,
            cookieSession.username ?? undefined
          );
          setAuthError(null);
          setUser(restoredUser);
          setAuthMode('supabase');
          setAuthProvider('username');
          void persistAppSessionCookie(cookieSession.token, restoredUser.username);
          void refreshAllFromSupabase();
          return true;
        }

        if (payload.status === 'inactive') {
          setAppSessionToken(null);
          await clearAppSessionCookie();
          setAuthError(
            payload.message || 'Akun karyawan Anda sedang berstatus Nonaktif. Hubungi Owner.'
          );
          return false;
        }

        // Session expired or revoked in PostgreSQL
        setAppSessionToken(null);
        await clearAppSessionCookie();
        return false;
      }

      // Graceful fallback if user hasn't run updated SQL (`get_app_session_profile` not yet deployed)
      const errCode = String(error?.code ?? '');
      if (errCode === 'PGRST202' || errCode === '42883') {
        const [activeEmpRes, activeOwnerRes] = await Promise.all([
          supabase.rpc('is_active_employee'),
          supabase.rpc('is_active_owner'),
        ]);

        if (activeEmpRes.data === true && activeOwnerRes.data === true) {
          const { data: empRows } = await supabase
            .from('employees')
            .select('*')
            .eq('is_active', true)
            .limit(200);

          if (empRows && empRows.length > 0) {
            const matched =
              (cookieSession.username
                ? empRows.find(
                    (row) =>
                      typeof row.username === 'string' &&
                      normalizeUsername(row.username) === cookieSession.username
                  )
                : null) ||
              empRows.find((row) => normalizeEmployeeRole(row.role) === 'owner');

            if (matched) {
              const restoredUser = mapEmployeeRowToProfile(
                matched as Record<string, unknown>,
                cookieSession.username ?? undefined
              );
              setAuthError(null);
              setUser(restoredUser);
              setAuthMode('supabase');
              setAuthProvider('username');
              void refreshAllFromSupabase();
              return true;
            }
          }
        } else if (activeEmpRes.data === false) {
          setAppSessionToken(null);
          await clearAppSessionCookie();
        }
      }
    } catch {
      // Keep HttpOnly cookie intact on transient network failure so user isn't permanently logged out
      setAppSessionToken(null);
    }

    return false;
  }, [refreshAllFromSupabase]);

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

      let restoredFromSupabaseAuth = false;

      if (supabase) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (session?.user && active) {
            let activeUser = session.user;
            const expiresSoon =
              typeof session.expires_at === 'number' &&
              session.expires_at * 1000 <= Date.now() + 60_000;

            if (expiresSoon) {
              try {
                const { data: refreshed } = await supabase.auth.refreshSession();
                if (refreshed.session?.user) {
                  activeUser = refreshed.session.user;
                }
              } catch {
                // Continue with current session user if refresh fails transiently
              }
            }

            await resolveSupabaseUser(activeUser, { isSessionRestore: true });
            restoredFromSupabaseAuth = true;
          }
        } catch {
          // Fall through to check HttpOnly username session cookie
        }

        if (!restoredFromSupabaseAuth && active) {
          await restoreUsernameSession();
        }
      }

      if (active) {
        setIsLoading(false);
      }
    }

    void bootstrapSession();

    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        void resolveSupabaseUser(session.user, {
          isSessionRestore: event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED',
        });
      } else if (event === 'SIGNED_OUT' && authProviderRef.current !== 'username') {
        setUser(null);
        setAuthMode(null);
        setAuthProvider(null);
      }
    });

    return () => {
      active = false;
      subscription?.data.subscription.unsubscribe();
    };
  }, [resolveSupabaseUser, restoreUsernameSession]);

  // Keep active Google/Username-authenticated user synced if Owner edits or deactivates them
  useEffect(() => {
    if ((authProvider !== 'google' && authProvider !== 'username') || !user) return;
    const matched = employees.find(
      (emp) =>
        emp.id === user.id ||
        normalizeEmail(emp.email) === normalizeEmail(user.email) ||
        (user.username && emp.username && normalizeUsername(emp.username) === normalizeUsername(user.username))
    );
    if (!matched) return;
    if (!matched.is_active) {
      if (supabase && authProvider === 'google') {
        void supabase.auth.signOut();
      } else if (authProvider === 'username') {
        if (supabase) void supabase.rpc('revoke_app_session');
        setAppSessionToken(null);
        void clearAppSessionCookie();
      }
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
      const env = ((import.meta as { env?: Record<string, string | undefined> }).env ?? {}) as Record<
        string,
        string | undefined
      >;
      const redirectTo = resolveOAuthRedirectUrl(
        window.location.origin,
        env.VITE_APP_URL || env.NEXT_PUBLIC_APP_URL
      );
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
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

  const signInWithUsername = useCallback(
    async (usernameInput: string, password: string): Promise<{ error: string | null }> => {
      setAuthError(null);
      const cleanUsername = normalizeUsername(usernameInput);
      if (!cleanUsername || !password.trim()) {
        return { error: 'Username dan kata sandi wajib diisi.' };
      }

      let authenticatedUser: UserProfile | null = null;
      let shouldTryLocalFallback = !supabase;

      // 1. Verify against Supabase server-side bcrypt RPC (`authenticate_employee_username`)
      if (supabase) {
        try {
          const { data, error } = await supabase.rpc('authenticate_employee_username', {
            p_username: cleanUsername,
            p_password: password,
          });

          if (error) {
            const code = String(error.code ?? '');
            // PGRST202 / 42883 = RPC not installed yet in Supabase SQL Editor
            if (code === 'PGRST202' || code === '42883') {
              shouldTryLocalFallback = true;
            } else {
              return {
                error: `Gagal memverifikasi username di Supabase (${error.message}). Pastikan file SQL supabase/schema_google_oauth_employees.sql terbaru sudah dijalankan.`,
              };
            }
          } else if (data && typeof data === 'object') {
            const payload = data as {
              status?: string;
              message?: string;
              session_token?: string;
              employee?: Record<string, unknown>;
            };
            if (payload.status === 'ok' && payload.employee) {
              authenticatedUser = mapEmployeeRowToProfile(payload.employee, cleanUsername);
              if (typeof payload.session_token === 'string' && payload.session_token.length >= 32) {
                setAppSessionToken(payload.session_token);
                await persistAppSessionCookie(payload.session_token, authenticatedUser.username);
              }
            } else if (payload.status === 'inactive') {
              return {
                error:
                  payload.message ||
                  `Akun "@${cleanUsername}" sedang berstatus Nonaktif. Hubungi Owner.`,
              };
            } else {
              // Check local fallback in case Owner just added username locally before syncing SQL
              shouldTryLocalFallback = true;
            }
          }
        } catch {
          shouldTryLocalFallback = true;
        }
      }

      // 2. Local PBKDF2 hash verification fallback (never plaintext)
      if (!authenticatedUser && shouldTryLocalFallback) {
        const localEmp = employeesRef.current.find(
          (emp) => emp.username && normalizeUsername(emp.username) === cleanUsername
        );
        if (localEmp && localEmp.password_hash) {
          const valid = await verifyPasswordLocal(password, localEmp.password_hash);
          if (valid) {
            if (!localEmp.is_active) {
              return {
                error: `Akun karyawan "${localEmp.full_name}" (@${cleanUsername}) sedang berstatus Nonaktif. Hubungi Owner.`,
              };
            }
            authenticatedUser = {
              ...localEmp,
              username: cleanUsername,
            };
          }
        }
      }

      if (!authenticatedUser) {
        return {
          error:
            'Username atau kata sandi tidak sesuai. Pastikan Owner sudah mengatur username & kata sandi akun ini.',
        };
      }

      setAuthError(null);
      setUser(authenticatedUser);
      setAuthMode('supabase');
      setAuthProvider('username');
      void refreshAllFromSupabase();

      // Send Owner login confirmation email alert (default: parisramaproject@gmail.com)
      void sendOwnerUsernameLoginAlert({
        username: authenticatedUser.username || cleanUsername,
        employeeName: authenticatedUser.full_name,
        employeeEmail: authenticatedUser.email,
        role: authenticatedUser.role,
        shopName: settingsRef.current.shopName,
        ownerEmail: settingsRef.current.ownerLoginAlertEmail || DEFAULT_OWNER_ALERT_EMAIL,
      }).then((auditLog) => {
        recordUsernameLoginLog(auditLog);
      });

      return { error: null };
    },
    [recordUsernameLoginLog, refreshAllFromSupabase]
  );

  const logout = useCallback(async () => {
    setAuthError(null);
    if (supabase) {
      if (authProviderRef.current === 'username') {
        try {
          await supabase.rpc('revoke_app_session');
        } catch {
          // Non-blocking session cleanup
        }
      } else {
        await supabase.auth.signOut();
      }
    }
    await clearAppSessionCookie();
    setAppSessionToken(null);
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
      signInWithUsername,
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
      signInWithUsername,
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
