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
  User,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStore } from '../context/StoreContext';
import { DEFAULT_OWNER_ALERT_EMAIL } from '../services/loginAlertService';

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

type CredentialTab = 'username' | 'email';

export function LoginPage() {
  const { signInWithGoogle, signInWithEmail, signInWithUsername, authError, clearAuthError } =
    useAuth();
  const { settings } = useStore();
  const [credentialTab, setCredentialTab] = useState<CredentialTab>('username');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const displayedError = errorMessage || authError;
  const ownerAlertEmail = settings.ownerLoginAlertEmail || DEFAULT_OWNER_ALERT_EMAIL;

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    clearAuthError();
    setGoogleSubmitting(true);
    const result = await signInWithGoogle();
    if (result.error) {
      setErrorMessage(result.error);
      setGoogleSubmitting(false);
    }
  };

  const handleTabSwitch = (nextTab: CredentialTab) => {
    setCredentialTab(nextTab);
    setErrorMessage(null);
    clearAuthError();
    setPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    clearAuthError();
    setSubmitting(true);

    const result =
      credentialTab === 'username'
        ? await signInWithUsername(username, password)
        : await signInWithEmail(email, password);

    if (result.error) {
      setErrorMessage(result.error);
    }
    setSubmitting(false);
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[#F4F6F5] px-4 py-10 text-[#1A2E26]">
      <div className="w-full max-w-[448px] overflow-hidden rounded-2xl border border-[#E5E7EB] bg-[#FFFFFF] p-8 sm:p-9">
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

        <div className="mt-6">
          <h2 className="text-2xl font-bold tracking-tight text-[#1A2E26]">Masuk ke Sistem</h2>
          <p className="mt-1.5 text-sm text-[#6B7280]">
            Masuk dengan akun Google karyawan, atau gunakan username &amp; kata sandi yang diatur
            oleh Owner.
          </p>
        </div>

        {displayedError && (
          <div
            role="alert"
            data-testid="login-error-alert"
            className="mt-5 flex items-start gap-2.5 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#B91C1C]"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{displayedError}</span>
          </div>
        )}

        {/* Primary Google OAuth Button */}
        <div className="mt-6">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleSubmitting || submitting}
            aria-label="Masuk dengan Google"
            className="flex h-11 w-full items-center justify-center gap-3 rounded-full border border-[#DADCE0] bg-[#FFFFFF] px-5 text-sm font-semibold text-[#1F1F1F] shadow-xs transition-colors hover:border-[#C7CCD1] hover:bg-[#F8FAFC] active:bg-[#F1F5F9] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#109A58]"
          >
            <GoogleLogoSvg />
            <span>
              {googleSubmitting ? 'Mengarahkan ke Google...' : 'Masuk dengan Google'}
            </span>
          </button>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-[#6B7280]">
            Hak akses role otomatis disesuaikan dengan email karyawan aktif.
          </p>
        </div>

        {/* Divider */}
        <div className="my-5 flex items-center gap-3" aria-hidden="true">
          <div className="h-px flex-1 bg-[#E5E7EB]" />
          <span className="text-[11px] font-medium text-[#6B7280]">atau masuk tanpa Google</span>
          <div className="h-px flex-1 bg-[#E5E7EB]" />
        </div>

        {/* Segmented Credential Mode Switcher */}
        <div
          role="tablist"
          aria-label="Metode Login Kredensial"
          className="mb-4 grid grid-cols-2 rounded-xl border border-[#E5E7EB] bg-[#F4F6F5] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={credentialTab === 'username'}
            onClick={() => handleTabSwitch('username')}
            className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors ${
              credentialTab === 'username'
                ? 'bg-[#FFFFFF] text-[#1A2E26] shadow-xs'
                : 'text-[#6B7280] hover:text-[#1A2E26]'
            }`}
          >
            <User className="h-3.5 w-3.5" />
            <span>Username</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={credentialTab === 'email'}
            onClick={() => handleTabSwitch('email')}
            className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors ${
              credentialTab === 'email'
                ? 'bg-[#FFFFFF] text-[#1A2E26] shadow-xs'
                : 'text-[#6B7280] hover:text-[#1A2E26]'
            }`}
          >
            <Mail className="h-3.5 w-3.5" />
            <span>Email</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {credentialTab === 'username' ? (
            <div>
              <label htmlFor="login-username" className="block text-sm font-medium text-[#1A2E26]">
                Username Karyawan
              </label>
              <div className="relative mt-1.5">
                <User
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]"
                  aria-hidden="true"
                />
                <input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="contoh: owner atau kasir.dimas"
                  className="h-11 w-full rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] pl-10 pr-4 text-sm text-[#1A2E26] placeholder:text-[#6B7280] focus:border-[#109A58] focus:outline-none"
                />
              </div>
            </div>
          ) : (
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
                  placeholder="nama@email.com"
                  className="h-11 w-full rounded-xl border border-[#E5E7EB] bg-[#FFFFFF] pl-10 pr-4 text-sm text-[#1A2E26] placeholder:text-[#6B7280] focus:border-[#109A58] focus:outline-none"
                />
              </div>
            </div>
          )}

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

          {credentialTab === 'username' && (
            <p className="rounded-xl border border-[#109A58]/20 bg-[#E6F5EE]/50 px-3.5 py-2.5 text-[11px] leading-relaxed text-[#1A2E26]">
              Setiap login menggunakan username akan otomatis mengirim email konfirmasi ke Owner (
              <span className="font-semibold text-[#109A58]">{ownerAlertEmail}</span>).
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || googleSubmitting}
            className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#109A58] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#0D8A4E] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#109A58]"
          >
            <span>
              {submitting
                ? 'Memverifikasi...'
                : credentialTab === 'username'
                  ? 'Masuk dengan Username'
                  : 'Masuk'}
            </span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <div className="mt-7 flex items-center gap-2 border-t border-[#E5E7EB] pt-4 text-[11px] text-[#6B7280]">
          <ShieldCheck className="h-4 w-4 shrink-0 text-[#109A58]" />
          <span>Akses dilindungi oleh Role-Based Access Control (Owner, Manager, Kasir).</span>
        </div>
      </div>
    </div>
  );
}
