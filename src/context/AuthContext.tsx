import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { DEMO_USERS } from '../data/seedData';
import type { PageId, UserProfile, UserRole } from '../types';
import {
  canAccessPage as checkCanAccessPage,
  canManageEmployees,
  canManageInventory,
  canManageOpnameSchedules,
  canViewHPP,
} from '../utils/rbac';

const DEMO_STORAGE_KEY = 'brewflow_demo_role_v1';

interface AuthContextValue {
  user: UserProfile | null;
  authMode: 'supabase' | 'demo' | null;
  isLoading: boolean;
  isSupabaseReady: boolean;
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
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authMode, setAuthMode] = useState<'supabase' | 'demo' | null>(null);
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

  useEffect(() => {
    let active = true;

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

      // Otherwise check live Supabase session if configured
      if (supabase) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          if (session?.user && active) {
            await loadSupabaseProfile(session.user.id, session.user.email ?? '');
          }
        } catch {
          // Safe fallback to logged-out state
        }
      }

      if (active) {
        setIsLoading(false);
      }
    }

    bootstrapSession();

    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        loadSupabaseProfile(session.user.id, session.user.email ?? '');
      } else if (!window.localStorage.getItem(DEMO_STORAGE_KEY)) {
        setUser(null);
        setAuthMode(null);
      }
    });

    return () => {
      active = false;
      subscription?.data.subscription.unsubscribe();
    };
  }, [loadSupabaseProfile]);

  const signInWithEmail = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      const trimmedEmail = email.trim();
      if (!trimmedEmail || !password.trim()) {
        return { error: 'Email dan kata sandi wajib diisi.' };
      }

      if (!supabase) {
        return {
          error:
            'Koneksi Supabase belum dikonfigurasi (VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY). Gunakan tombol Demo Quick Login di bawah untuk mencoba aplikasi.',
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
    [user, authMode, isLoading, signInWithEmail, demoLogin, logout, hasRole, canAccess]
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
