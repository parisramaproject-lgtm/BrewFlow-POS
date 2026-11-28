# BrewFlow POS — Coffee Shop POS & Operational Management System

Aplikasi web manajemen operasional kedai kopi (PWA) berbasis **React 19 + TypeScript + Vite + Tailwind CSS v4 + Supabase**, siap di-deploy ke **Vercel**.

## Fitur Utama

- **Kasir / POS**: Penomoran pesanan harian atomik (`BF-YYMMDD-NNN`), dukungan Dine-in/Takeaway/Delivery, diskon member & voucher Rush Hour, kalkulasi pajak PB1, pemblokiran otomatis menu saat bahan baku habis, antrean transaksi offline berbasis **IndexedDB** dengan sinkronisasi otomatis, serta cetak struk thermal (Browser/Bluetooth/USB/Network).
- **Pesanan & Pembatalan Atomik**: Riwayat transaksi lengkap dengan pembatalan pesanan yang mengembalikan stok bahan baku, poin member, dan kuota voucher secara atomik.
- **Menu & HPP (BOM)**: Pengelolaan menu, komposisi resep bahan baku, kalkulasi HPP otomatis, dan rekomendasi harga jual.
- **Inventori, Pembelian, Vendor & Stock Opname**: Pengelolaan stok bahan baku & aset, pembelian barang dengan pencatatan item baru otomatis, manajemen kontak vendor, penjadwalan stock opname, serta ekspor laporan Excel (`.xlsx`) periodik.
- **Membership, Voucher & Display TV Store**: Manajemen tier loyalitas, poin & penukaran hadiah, voucher promo terjadwal, serta layar TV promosi kedai.
- **Karyawan & RBAC (Owner / Manager / Kasir)**: Login Google OAuth & Username/Password (rate limiting + sesi database + notifikasi email ke Owner), kontrol akses per peran, serta pencabutan sesi aktif karyawan.

## Menjalankan Secara Lokal

**Prasyarat:** Node.js 20+

```bash
# 1. Install dependencies
npm install

# 2. Salin konfigurasi environment
cp .env.example .env.local
# Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY (opsional untuk mode demo lokal)

# 3. Jalankan dev server (port 3000)
npm run dev
```

## Perintah Penting

- `npm run dev` — Menjalankan dev server lokal di `http://localhost:3000`
- `npm run build` — Build produksi ke folder `dist/`
- `npm run lint` — Pengecekan tipe TypeScript (`tsc --noEmit`)
- `npm test` — Menjalankan unit test (`src/utils/*.test.ts`, `src/services/*.test.ts`, `api/*.test.ts`)

## Setup Database & Deployment

Lihat panduan lengkap setup Supabase SQL (`supabase/schema_full_brewflow.sql`), konfigurasi environment variable Vercel, dan checklist keamanan produksi di [`DEPLOYMENT_VERCEL.md`](./DEPLOYMENT_VERCEL.md).
