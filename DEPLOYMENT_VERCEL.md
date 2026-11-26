# Panduan Deploy & Hosting BrewFlow POS ke Vercel

Aplikasi **BrewFlow POS** sudah dikonfigurasi penuh untuk langsung di-deploy dan di-hosting di **Vercel** (`vercel.json`, `.vercelignore`, dan dukungan environment variable `VITE_*`).

## 1. Deploy via GitHub + Vercel Dashboard (Direkomendasikan)

1. Push kode proyek ini ke repository GitHub / GitLab / Bitbucket Anda.
2. Buka [vercel.com/new](https://vercel.com/new), pilih repository BrewFlow POS, lalu klik **Import**.
3. Pastikan pengaturan build (terdeteksi otomatis dari `vercel.json`):
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Tambahkan **Environment Variables** di **Project Settings → Environment Variables** (opsional jika ingin menyambungkan data live Supabase):
   - `VITE_SUPABASE_URL` = URL proyek Supabase Anda
   - `VITE_SUPABASE_ANON_KEY` = Anon Public Key Supabase Anda
   - *(Opsional)* `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` jika ingin mengganti proyek Firebase bawaan (`firebase-applet-config.json`).
5. Klik **Deploy**.

## 2. Deploy Langsung via Vercel CLI

```bash
npm i -g vercel
vercel --prod
```

## 3. Wajib Setelah Deploy: Daftarkan Domain Vercel untuk Login Google

Agar tombol **Masuk dengan Google** berfungsi di domain Vercel Anda (`https://nama-app.vercel.app` atau custom domain):

1. Buka [Firebase Console](https://console.firebase.google.com/) → pilih proyek **`gen-lang-client-0234623454`** (atau proyek Firebase Anda).
2. Masuk ke **Authentication → Settings → Authorized domains**.
3. Klik **Add domain**, lalu masukkan domain Vercel Anda (contoh: `brewflow-pos.vercel.app`).
4. Jika menggunakan Supabase Auth, tambahkan juga URL Vercel tersebut di **Supabase Dashboard → Authentication → URL Configuration → Site URL & Redirect URLs**.

## 4. Keuntungan Hosting di Vercel untuk Hardware POS

- **Printer Thermal Bluetooth & USB Serial**: Karena di Vercel aplikasi berjalan langsung di domain HTTPS top-level (bukan di dalam iframe preview) dan `vercel.json` sudah mengatur header `Permissions-Policy: bluetooth=(self), serial=(self), usb=(self)`, koneksi **Web Bluetooth** dan **USB Serial** pada Chrome/Edge desktop maupun Android akan langsung aktif tanpa error pembatasan iframe.
- **Google OAuth Popup**: Header `Cross-Origin-Opener-Policy: same-origin-allow-popups` sudah dikonfigurasi di `vercel.json` agar popup login Google berjalan mulus.
