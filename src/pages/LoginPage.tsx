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
    email: 'owner@brewflow.id',
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

export function LoginPage() {
  const { signInWithEmail, demoLogin, isSupabaseReady } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
        {/* Left Column: Supabase Auth Login Form */}
        <div className="flex flex-col justify-between p-8 md:col-span-7 md:p-10">
          <div>
            {/* Brand Header */}
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#109A58] text-white">
                <Coffee className="h-6 w-6" strokeWidth={2.2} />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-[#1A2E26]">BrewFlow POS</h1>
                <p className="text-xs text-[#6B7280]">Coffee Shop Point of Sale & Management</p>
              </div>
            </div>

            <div className="mt-8">
              <h2 className="text-2xl font-bold tracking-tight text-[#1A2E26]">Masuk ke Akun Anda</h2>
              <p className="mt-1.5 text-sm text-[#6B7280]">
                Gunakan akun Supabase Auth toko Anda atau pilih akses cepat demo di samping.
              </p>
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="mt-5 flex items-start gap-2.5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
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
                <label htmlFor="login-password" className="block text-sm font-medium text-[#1A2E26]">
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
                disabled={submitting}
                className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#109A58] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#0D8A4E] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#109A58]"
              >
                <span>{submitting ? 'Memverifikasi...' : 'Masuk dengan Supabase Auth'}</span>
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </div>

          <div className="mt-8 border-t border-[#E5E7EB] pt-4 text-xs text-[#6B7280]">
            {isSupabaseReady ? (
              <span>Terhubung ke proyek Supabase aktif.</span>
            ) : (
              <span>
                Mode Demo aktif · Isi <code className="font-mono text-[#1A2E26]">VITE_SUPABASE_URL</code> &amp;{' '}
                <code className="font-mono text-[#1A2E26]">VITE_SUPABASE_ANON_KEY</code> di{' '}
                <code className="font-mono text-[#1A2E26]">.env</code> untuk data live.
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
