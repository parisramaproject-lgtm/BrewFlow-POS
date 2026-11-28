# Panduan Deploy & Hosting BrewFlow POS di Vercel + Supabase

Aplikasi **BrewFlow POS** menggunakan **Supabase** (PostgreSQL, Row Level Security, RPC atomik, Auth Google OAuth, dan Edge Functions) serta **Vercel** (frontend SPA + serverless API `/api/send-login-alert`).

## 1. Setup Database Supabase (Sekali Jalan & Idempoten)

1. Buka **Supabase Dashboard → SQL Editor**.
2. Jalankan seluruh isi file **`supabase/schema_full_brewflow.sql`**.
   - File ini bersifat **standalone & idempoten** (aman dijalankan berulang pada database baru maupun lama).
   - Mencakup tabel karyawan (`employees`, `app_sessions`, `login_audit_logs`, `login_rate_limits`), katalog & transaksi (`categories`, `menus`, `menu_recipes`, `inventory_items`, `orders`, `order_items`, `daily_order_counters`, `customers`, `vouchers`, `purchases`, `purchase_items`, `stock_opname_*`, `store_settings`), tabel operasional multi-device (`vendors`, `restock_requests`, `operational_notifications`, `whatsapp_logs`), seluruh fungsi RPC atomik (`checkout_order_atomic`, `cancel_order_atomic`, `next_order_number`, `revoke_all_employee_sessions`, `get_pos_stock_levels`, `get_pos_store_settings`), serta kebijakan RLS ketat per peran (Owner / Manager / Kasir).

## 2. Setup Google OAuth & Checklist Keamanan Auth Supabase

1. Di [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials):
   - Buat **OAuth 2.0 Client ID** (tipe **Web application**).
   - Tambahkan **Authorized redirect URI**:
     `https://<PROJECT-REF-SUPABASE-ANDA>.supabase.co/auth/v1/callback`
2. Di **Supabase Dashboard → Authentication → Providers → Google**:
   - Aktifkan **Enable Sign in with Google** dan tempel **Client ID** serta **Client Secret**.
3. **Checklist Keamanan Wajib di Supabase Dashboard → Authentication → Providers → Email**:
   - Nonaktifkan **Allow new users to sign up** (Disable Public Signups) agar hanya karyawan terdaftar di tabel `public.employees` yang dapat masuk.
   - Pastikan **Confirm email** tetap aktif.

## 3. Deploy & Environment Variables di Vercel

1. Import repository GitHub ke [vercel.com/new](https://vercel.com/new). Konfigurasi build otomatis terbaca dari `vercel.json` (`Framework: Vite`, `Build: npm run build`, `Output: dist`).
2. Di **Vercel Project Settings → Environment Variables**, atur variabel berikut:
   - `VITE_SUPABASE_URL` — URL project Supabase (`https://<PROJECT-REF>.supabase.co`)
   - `VITE_SUPABASE_ANON_KEY` — Anon/Publishable Key dari **Supabase → Project Settings → API**
   - `GMAIL_USER` — Alamat Gmail pengirim notifikasi login (opsional, untuk `/api/send-login-alert`)
   - `GMAIL_APP_PASSWORD` — Sandi Aplikasi (App Password) 16 karakter dari akun Google (bukan password utama)
   - `OWNER_ALERT_EMAIL` — Email default Owner penerima notifikasi login username
3. Setelah deploy, buka **Supabase Dashboard → Authentication → URL Configuration**:
   - Isi **Site URL** dengan domain produksi Vercel Anda (misal `https://brewflow-pos.vercel.app`).
   - Tambahkan domain produksi pada **Redirect URLs** lalu simpan.

## 4. Deploy Edge Function WhatsApp (Opsional)

Jika menggunakan notifikasi WhatsApp otomatis:

```bash
supabase secrets set ALLOWED_ORIGINS="https://brewflow-pos.vercel.app"
supabase secrets set WA_GATEWAY_TOKEN="TOKEN_FONNTE_ANDA"
supabase functions deploy send-whatsapp
```

Edge Function `send-whatsapp` memverifikasi token sesi karyawan aktif serta membatasi pengiriman pesan tes dan laporan opname hanya untuk peran **Owner / Manager**.

## 5. Fitur Bawaan di Domain Produksi HTTPS

- **PWA & Antrean Transaksi Offline**: Aplikasi dapat dipasang ke homescreen perangkat. Jika internet terputus saat checkout, transaksi tersimpan aman di antrean lokal (IndexedDB) dan otomatis tersinkronisasi saat koneksi kembali.
- **Printer Thermal Bluetooth & USB Serial**: Header `Permissions-Policy: bluetooth=(self), serial=(self), usb=(self)` pada `vercel.json` mengaktifkan koneksi printer thermal langsung melalui Chrome/Edge di domain HTTPS.
