import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Coffee,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Store,
  UserCog,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { UserRole } from '../types';

const DEMO_ROLES: Array<{
  role: UserRole;
  title: string;
  userName: string;
  email: string;
  scope: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    role: 'owner',
    title: 'Owner',
    userName: 'Budi Santoso',
    email: 'generalaffairhrandelajaya@gmail.com',
    scope: 'Akses penuh · Menu & Kalkulator HPP · Karyawan · Jadwal Opname',
    icon: ShieldCheck,
  },
  {
    role: 'manager',
    title: 'Manager',
    userName: 'Rina Wijaya',
    email: 'manager@brewflow.id',
    scope: 'Operasional · POS · Menu · Inventori · Pembelian · Stock Opname',
    icon: UserCog,
  },
  {
    role: 'cashier',
    title: 'Kasir',
    userName: 'Dimas Pratama',
    email: 'kasir@brewflow.id',
    scope: 'Front-of-House · Kasir / POS · Riwayat Pesanan · Membership',
    icon: Store,
  },
];

function GoogleLogoSvg() {
  return (
    <svg
      version="1.1"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
  );
}

export function LoginPage() {
  const { signInWithGoogle, signInWithEmail, demoLogin, isSupabaseReady, isGoogleReady } =
    useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setGoogleSubmitting(true);
    const result = await signInWithGoogle();
    if (result.error) {
      setErrorMessage(result.error);
    }
    setGoogleSubmitting(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSubmitting(true);
    const result = await signInWithEmail(email, password);
    if (result.error) {
      setErrorMessage(result.error);
    }
    setSubmitting(false);
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#F4F6F5] px-4 py-10 text-[#1A2E26]">
      <div className="grid w-full max-w-4xl grid-cols-1 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] md:grid-cols-12">
        {/* Left Column: Google OAuth + Supabase Auth Login Form */}
        <div className="flex flex-col justify-between p-8 md:col-span-7 md:p-10">
          <div>
            {/* Brand Header */}
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#109A58] text-white">
                <Coffee className="h-6 w-6" strokeWidth={2.2} />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-[#1A2E26]">BrewFlow POS</h1>
                <p className="text-xs text-[#6B7280]">Coffee Shop Point of Sale &amp; Management</p>
              </div>
            </div>

            <div className="mt-7">
              <h2 className="text-2xl font-bold tracking-tight text-[#1A2E26]">
                Masuk ke Akun Anda
              </h2>
              <p className="mt-1.5 text-sm text-[#6B7280]">
                Masuk dengan akun Google yang emailnya terdaftar di data karyawan, atau gunakan
                login email &amp; kata sandi.
              </p>
            </div>

            {errorMessage && (
              <div
                role="alert"
                data-testid="login-error-alert"
                className="mt-5 flex items-start gap-2.5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Official Google Sign-In Section */}
            <div className="mt-6">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={googleSubmitting || submitting || !isGoogleReady}
                aria-label="Masuk dengan Google"
                className="flex h-11 w-full items-center justify-center gap-3 rounded-full border border-[#DADCE0] bg-[#FFFFFF] px-5 text-sm font-semibold text-[#1F1F1F] shadow-xs transition-colors hover:bg-[#F8FAFC] hover:border-[#C7CCD1] active:bg-[#F1F5F9] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#109A58]"
              >
                <GoogleLogoSvg />
                <span>
                  {googleSubmitting ? 'Memverifikasi akun Google...' : 'Masuk dengan Google'}
                </span>
              </button>
              <p className="mt-2 text-center text-[11px] leading-relaxed text-[#6B7280]">
                Akses role (Owner, Manager, Kasir) otomatis dicocokkan dengan email aktif di data
                karyawan.
              </p>
            </div>

            {/* Divider */}
            <div className="my-5 flex items-center gap-3" aria-hidden="true">
              <div className="h-px flex-1 bg-[#E5E7EB]" />
              <span className="text-[11px] font-medium text-[#6B7280]">
                atau masuk dengan email &amp; kata sandi
              </span>
              <div className="h-px flex-1 bg-[#E5E7EB]" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-[#1A2E26]">
                  Alamat Email
                </label>
                <div className="relative mt-1.5">
                  <Mail
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]"
                    aria-hidden="true"
                  />
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nama@brewflow.id"
                    className="h-11 w-full rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] pl-10 pr-4 text-sm text-[#1A2E26] placeholder:text-[#6B7280] focus:border-[#109A58] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="block text-sm font-medium text-[#1A2E26]"
                >
                  Kata Sandi
                </label>
                <div className="relative mt-1.5">
                  <Lock
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]"
                    aria-hidden="true"
                  />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan kata sandi"
                    className="h-11 w-full rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] pl-10 pr-11 text-sm text-[#1A2E26] placeholder:text-[#6B7280] focus:border-[#109A58] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#1A2E26]"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || googleSubmitting}
                className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#109A58] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#0D8A4E] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#109A58]"
              >
                <span>{submitting ? 'Memverifikasi...' : 'Masuk dengan Supabase Auth'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </div>

          <div className="mt-7 border-t border-[#E5E7EB] pt-4 text-xs text-[#6B7280]">
            {isSupabaseReady ? (
              <span>Google OAuth aktif · Terhubung ke proyek Supabase aktif.</span>
            ) : (
              <span>
                Google OAuth aktif · Mode Demo lokal untuk data toko (isi{' '}
                <code className="font-mono text-[#1A2E26]">VITE_SUPABASE_URL</code> di{' '}
                <code className="font-mono text-[#1A2E26]">.env</code> untuk sinkronisasi Supabase).
              </span>
            )}
          </div>
        </div>

        {/* Right Column: Demo Quick Login (RBAC Tester) */}
        <div className="flex flex-col justify-between border-t border-[#E5E7EB] bg-[#F4F6F5] p-8 md:col-span-5 md:border-l md:border-t-0 md:p-9">
          <div>
            <h3 className="text-base font-semibold text-[#1A2E26]">Demo Quick Login</h3>
            <p className="mt-1 text-xs leading-relaxed text-[#6B7280]">
              Uji tampilan dan pembatasan hak akses (RBAC) setiap role secara langsung tanpa perlu
              konfigurasi database terlebih dahulu.
            </p>

            <div className="mt-5 space-y-3">
              {DEMO_ROLES.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.role}
                    type="button"
                    onClick={() => demoLogin(item.role)}
                    className="group flex w-full items-start gap-3.5 rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-4 text-left transition-all duration-150 hover:border-[#109A58] hover:bg-[#E6F5EE]/40 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#109A58]"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E6F5EE] text-[#109A58] transition-colors group-hover:bg-[#109A58] group-hover:text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[#1A2E26]">
                          Masuk sebagai {item.title}
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-[#6B7280] transition-transform group-hover:translate-x-0.5 group-hover:text-[#109A58]" />
                      </div>
                      <p className="mt-0.5 text-xs font-medium text-[#109A58]">{item.userName}</p>
                      <p className="mt-1 text-[11px] leading-relaxed text-[#6B7280]">{item.scope}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <p className="mt-6 text-[11px] leading-relaxed text-[#6B7280]">
            Menu <strong className="font-semibold text-[#1A2E26]">Kalkulator HPP</strong>,{' '}
            <strong className="font-semibold text-[#1A2E26]">Karyawan</strong>, dan{' '}
            <strong className="font-semibold text-[#1A2E26]">Pengaturan Jadwal</strong> dilindungi
            khusus untuk role Owner.
          </p>
        </div>
      </div>
    </div>
  );
}
