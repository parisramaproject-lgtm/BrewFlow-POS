import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  initGoogleAuthListener,
  isGoogleOAuthConfigured,
  signInWithGooglePopup,
  signOutGoogle,
} from '../lib/googleAuth';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { DEMO_USERS } from '../data/seedData';
import type { PageId, UserProfile, UserRole } from '../types';
import {
  getGoogleAuthErrorMessage,
  matchEmployeeByEmail,
  mergeGoogleProfileIntoEmployee,
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
  authMode: 'google' | 'supabase' | 'demo' | null;
  isLoading: boolean;
  isSupabaseReady: boolean;
  isGoogleReady: boolean;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { employees } = useStore();
  const employeesRef = useRef<UserProfile[]>(employees);
  employeesRef.current = employees;

  const [user, setUser] = useState<UserProfile | null>(null);
  const [authMode, setAuthMode] = useState<'google' | 'supabase' | 'demo' | null>(null);
  const authModeRef = useRef<'google' | 'supabase' | 'demo' | null>(null);
  authModeRef.current = authMode;
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const loadSupabaseProfile = useCallback(async (userId: string, email: string) => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role, phone_number, created_at')
      .eq('id', userId)
      .single();

    if (error || !data) {
      const fallbackName = email.split('@')[0] || 'Pengguna';
      setUser({
        id: userId,
        full_name: fallbackName,
        email,
        role: 'cashier',
        phone_number: '-',
        avatar_initials: fallbackName.slice(0, 2).toUpperCase(),
        is_active: true,
        created_at: new Date().toISOString(),
      });
      setAuthMode('supabase');
      return;
    }

    const initials = (data.full_name as string)
      .split(' ')
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    setUser({
      id: data.id,
      full_name: data.full_name,
      email,
      role: (data.role as UserRole) || 'cashier',
      phone_number: data.phone_number || '-',
      avatar_initials: initials || 'BF',
      is_active: true,
      created_at: data.created_at || new Date().toISOString(),
    });
    setAuthMode('supabase');
  }, []);

  /**
   * Matches an authenticated Google user's email against the active employee directory
   * (and optionally Supabase `profiles` when connected).
   */
  const resolveEmployeeForGoogleUser = useCallback(
    async (
      fbUser: FirebaseUser
    ): Promise<{ ok: true; profile: UserProfile } | { ok: false; error: string }> => {
      const localMatch = matchEmployeeByEmail(fbUser.email, employeesRef.current);

      if (localMatch.status === 'matched') {
        return {
          ok: true,
          profile: mergeGoogleProfileIntoEmployee(localMatch.employee, {
            uid: fbUser.uid,
            email: fbUser.email,
            displayName: fbUser.displayName,
            photoURL: fbUser.photoURL,
          }),
        };
      }

      if (localMatch.status === 'inactive' || localMatch.status === 'invalid_email') {
        return { ok: false, error: localMatch.message };
      }

      // Secondary check against live Supabase `profiles` table if configured
      if (supabase && localMatch.status === 'not_found') {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('id, full_name, email, role, phone_number, is_active, created_at')
            .ilike('email', localMatch.email)
            .maybeSingle();

          if (data) {
            if (data.is_active === false) {
              return {
                ok: false,
                error: `Akun karyawan "${data.full_name}" (${localMatch.email}) sedang berstatus Nonaktif. Hubungi Owner untuk mengaktifkan kembali akses.`,
              };
            }
            const initials = String(data.full_name || localMatch.email)
              .split(/\s+/)
              .map((part) => part[0])
              .join('')
              .slice(0, 2)
              .toUpperCase();
            const dbEmployee: UserProfile = {
              id: data.id,
              full_name: data.full_name || fbUser.displayName || localMatch.email.split('@')[0],
              email: data.email || localMatch.email,
              role: (data.role as UserRole) || 'cashier',
              phone_number: data.phone_number || '-',
              avatar_initials: initials || 'BF',
              is_active: true,
              created_at: data.created_at || new Date().toISOString(),
            };
            return {
              ok: true,
              profile: mergeGoogleProfileIntoEmployee(dbEmployee, {
                uid: fbUser.uid,
                email: fbUser.email,
                displayName: fbUser.displayName,
                photoURL: fbUser.photoURL,
              }),
            };
          }
        } catch {
          // Fall through to standard unregistered-email rejection
        }
      }

      return { ok: false, error: localMatch.message };
    },
    []
  );

  useEffect(() => {
    let active = true;
    let unsubscribeGoogle: (() => void) | undefined;

    async function bootstrapSession() {
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

      // Check persisted Demo Quick Login first
      const storedDemoRole = parseDemoRole(window.localStorage.getItem(DEMO_STORAGE_KEY));
      if (storedDemoRole) {
        if (active) {
          setUser(DEMO_USERS[storedDemoRole]);
          setAuthMode('demo');
          setIsLoading(false);
        }
        return;
      }

      // Check live Supabase session if configured
      let restoredSupabase = false;
      if (supabase) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session?.user && active) {
            await loadSupabaseProfile(session.user.id, session.user.email ?? '');
            restoredSupabase = true;
          }
        } catch {
          // Safe fallback to logged-out state
        }
      }

      if (restoredSupabase) {
        if (active) setIsLoading(false);
        return;
      }

      // Otherwise subscribe to Firebase Google OAuth session state
      if (isGoogleOAuthConfigured) {
        unsubscribeGoogle = initGoogleAuthListener(
          async (fbUser) => {
            if (!active || window.localStorage.getItem(DEMO_STORAGE_KEY)) return;
            const resolved = await resolveEmployeeForGoogleUser(fbUser);
            if (!active) return;
            if (resolved.ok) {
              setUser(resolved.profile);
              setAuthMode('google');
            } else {
              await signOutGoogle();
              setUser(null);
              setAuthMode(null);
            }
            setIsLoading(false);
          },
          () => {
            if (!active) return;
            if (
              !window.localStorage.getItem(DEMO_STORAGE_KEY) &&
              authModeRef.current === 'google'
            ) {
              setUser(null);
              setAuthMode(null);
            }
            setIsLoading(false);
          }
        );
      } else if (active) {
        setIsLoading(false);
      }
    }

    bootstrapSession();

    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadSupabaseProfile(session.user.id, session.user.email ?? '');
      } else if (
        !window.localStorage.getItem(DEMO_STORAGE_KEY) &&
        authModeRef.current === 'supabase'
      ) {
        setUser(null);
        setAuthMode(null);
      }
    });

    return () => {
      active = false;
      unsubscribeGoogle?.();
      subscription?.data.subscription.unsubscribe();
    };
  }, [loadSupabaseProfile, resolveEmployeeForGoogleUser]);

  // Keep active Google-authenticated user synced with live employee edits (role/name/status)
  useEffect(() => {
    if (authMode !== 'google' || !user) return;
    const matched = employees.find((emp) => emp.id === user.id);
    if (!matched || !matched.is_active) {
      void signOutGoogle();
      setUser(null);
      setAuthMode(null);
      return;
    }
    if (
      matched.full_name !== user.full_name ||
      matched.role !== user.role ||
      matched.email !== user.email ||
      matched.avatar_initials !== user.avatar_initials
    ) {
      setUser((prev) => (prev ? { ...matched, photo_url: prev.photo_url } : matched));
    }
  }, [employees, authMode, user]);

  const signInWithGoogle = useCallback(async (): Promise<{ error: string | null }> => {
    try {
      const result = await signInWithGooglePopup();
      const resolved = await resolveEmployeeForGoogleUser(result.user);

      if (!resolved.ok) {
        // Immediately revoke unauthorized Google session and clear in-memory token
        await signOutGoogle();
        setUser(null);
        setAuthMode(null);
        return { error: resolved.error };
      }

      window.localStorage.removeItem(DEMO_STORAGE_KEY);
      setUser(resolved.profile);
      setAuthMode('google');
      return { error: null };
    } catch (error) {
      return { error: getGoogleAuthErrorMessage(error) };
    }
  }, [resolveEmployeeForGoogleUser]);

  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      const trimmedEmail = email.trim();
      if (!trimmedEmail || !password.trim()) {
        return { error: 'Email dan kata sandi wajib diisi.' };
      }

      if (!supabase) {
        return {
          error:
            'Koneksi Supabase belum dikonfigurasi (VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY). Gunakan tombol Masuk dengan Google atau Demo Quick Login di samping.',
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
        window.localStorage.removeItem(DEMO_STORAGE_KEY);
        await loadSupabaseProfile(data.user.id, data.user.email ?? trimmedEmail);
      }
      return { error: null };
    },
    [loadSupabaseProfile]
  );

  const demoLogin = useCallback((role: UserRole) => {
    window.localStorage.setItem(DEMO_STORAGE_KEY, role);
    setUser(DEMO_USERS[role]);
    setAuthMode('demo');
  }, []);

  const logout = useCallback(async () => {
    window.localStorage.removeItem(DEMO_STORAGE_KEY);
    if (authMode === 'google') {
      await signOutGoogle();
    }
    if (supabase && authMode === 'supabase') {
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
      isLoading,
      isSupabaseReady: isSupabaseConfigured,
      isGoogleReady: isGoogleOAuthConfigured,
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
