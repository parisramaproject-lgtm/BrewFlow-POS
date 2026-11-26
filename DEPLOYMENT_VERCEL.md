# Panduan Deploy & Hosting BrewFlow POS di Vercel + Supabase (100% Supabase Auth)

Aplikasi **BrewFlow POS** menggunakan **Supabase** secara penuh (Supabase Auth Google OAuth + Email/Password + PostgreSQL) dan siap langsung di-deploy serta di-hosting di **Vercel** (tanpa Firebase).

## 1. Setup Google OAuth di Supabase Dashboard

1. Buka [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials):
   - Buat **OAuth 2.0 Client ID** (tipe **Web application**).
   - Pada **Authorized redirect URIs**, masukkan URL callback Supabase Anda:
     `https://<PROJECT-REF-SUPABASE-ANDA>.supabase.co/auth/v1/callback`
   - Salin **Client ID** dan **Client Secret**.
2. Buka **Supabase Dashboard → Authentication → Providers → Google**:
   - Aktifkan **Enable Sign in with Google**.
   - Tempel **Client ID** dan **Client Secret** dari Google Cloud Console, lalu simpan.
3. Jalankan file SQL `supabase/schema_google_oauth_employees.sql` di **Supabase Dashboard → SQL Editor** agar tabel `employees` siap mencocokkan email karyawan aktif secara otomatis saat login Google (bahkan sebelum karyawan login pertama kali).

## 2. Deploy & Hosting ke Vercel

1. Push proyek ini ke repository GitHub Anda, lalu buka [vercel.com/new](https://vercel.com/new) dan **Import** repository tersebut.
2. Pengaturan build otomatis terbaca dari `vercel.json`:
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Di **Vercel Project Settings → Environment Variables**, pastikan variabel Supabase Anda tersedia (salah satu format otomatis didukung oleh aplikasi):
   - Jika menggunakan **Integrasi Resmi Vercel × Supabase Marketplace**, variabel `NEXT_PUBLIC_SUPABASE_URL` dan `NEXT_PUBLIC_SUPABASE_ANON_KEY` (atau `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) **otomatis terbaca** tanpa perlu duplikasi.
   - Atau jika diisi manual: `VITE_SUPABASE_URL` = `https://<PROJECT-REF>.supabase.co` dan `VITE_SUPABASE_ANON_KEY` = Anon Public Key dari Supabase Dashboard → Project Settings → API.
4. Klik **Deploy** (atau **Redeploy** di tab Deployments jika Anda baru menambahkan/menghubungkan Environment Variables, karena Vite menyematkan env var saat proses build).

## 3. Wajib Setelah Deploy: Tambahkan URL Vercel di Supabase Auth

1. Buka **Supabase Dashboard → Authentication → URL Configuration**.
2. Isi **Site URL** dengan domain Vercel Anda (misal: `https://brewflow-pos.vercel.app`).
3. Tambahkan juga URL tersebut (beserta wildcard preview jika perlu, misal `https://*.vercel.app/**`) ke daftar **Redirect URLs**, lalu klik **Save**.

## 4. Fitur Tambahan Otomatis di Vercel

- **Printer Thermal Bluetooth & USB Serial**: Di Vercel (domain HTTPS top-level, di luar iframe preview), `vercel.json` sudah menyertakan header `Permissions-Policy: bluetooth=(self), serial=(self), usb=(self)` sehingga printer thermal dapat terhubung langsung lewat Chrome/Edge.
- **Verifikasi Email Karyawan**: Setiap login Google melalui Supabase Auth akan langsung dicocokkan dengan tabel `employees` Supabase. Email yang tidak terdaftar atau berstatus **Nonaktif** otomatis ditolak dan dikeluarkan.
