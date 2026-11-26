# Product Requirements Document (PRD)
**Nama Proyek:** BrewFlow POS & Coffee Shop Management System  
**Versi:** 1.0  
**Tech Stack:** React (Vite) / Next.js, Tailwind CSS, Lucide Icons, Supabase (Auth, PostgreSQL, Edge Functions), WhatsApp Gateway API (Fonnte/Wablas/Twilio).

---

## 1. Ringkasan Eksekutif
Aplikasi POS (*Point of Sale*) dan manajemen operasional berbasis web yang dirancang khusus untuk *coffee shop*. Sistem ini mengintegrasikan transaksi kasir harian, manajemen inventori (bahan baku & aset), pembelian barang (*purchasing*), loyalitas pelanggan (*membership*), perhitungan Harga Pokok Penjualan (HPP) otomatis, jadwal *stock opname* berkala, serta notifikasi *push* melalui WhatsApp.

## 2. Role & Hak Akses (Role-Based Access Control - RBAC)
1. **Owner (Pemilik):**
   - Akses penuh ke seluruh fitur.
   - Mengakses & mengelola perhitungan **HPP (COGS)** dan margin profit setiap menu.
   - Mengatur jadwal *stock opname* (harian, mingguan, bulanan).
   - Melihat laporan keuangan menyeluruh (laba/rugi, penjualan, pembelian).
   - Mengelola user/karyawan dan pengaturan integrasi WhatsApp.
2. **Manager / Head Bar:**
   - Mengelola stok inventori (bahan baku & aset).
   - Input pembelian barang (*purchasing*).
   - Melakukan *stock opname* sesuai jadwal.
   - Mengelola menu dan kategori.
3. **Kasir (Cashier):**
   - Akses layar POS (input penjualan).
   - Mendaftarkan dan memilih *membership* pelanggan saat transaksi.
   - Melihat riwayat transaksi shift berjalan.
   - *Tidak dapat* melihat HPP, laporan laba bersih, atau mengubah master stok.

## 3. Fitur Utama (Functional Requirements)

### 3.1. Modul Kasir (POS)
- **Tampilan Grid Menu & Kategori:** Filter cepat berdasarkan kategori (Kopi, Non-Kopi, Makanan, Snack, dll) dan kolom pencarian.
- **Keranjang Belanja (Current Order):** Pilih tipe pesanan (*Dine-in / Sur place*, *Takeaway / À emporter*, *Delivery*), nomor meja, catatan pesanan (*less sugar, extra shot*), diskon, dan pajak (PPN/PB1).
- **Integrasi Membership:** Pencarian member berdasarkan nomor HP/Nama, otomatis menghitung poin loyalitas atau menerapkan diskon khusus member.
- **Pemotongan Stok Otomatis:** Setiap transaksi berhasil akan otomatis mengurangi stok bahan baku berdasarkan resep (*Bill of Materials* / BOM) yang terhubung dengan menu tersebut.

### 3.2. Modul Manajemen Menu & Kalkulasi HPP (Khusus Owner)
- **Resep Menu (BOM):** Menghubungkan 1 menu dengan beberapa bahan baku (misal: *Es Kopi Susu* = 18gr Biji Kopi + 120ml Susu UHT + 20ml Gula Aren + 1 Cup + 1 Sedotan).
- **Kalkulator HPP Otomatis:** Menghitung total biaya bahan baku per porsi berdasarkan harga beli terakhir dari modul *Purchasing*, lalu menampilkan persentase *Food Cost* dan rekomendasi harga jual.
- **Proteksi Role:** Kolom HPP dan tab "Resep & HPP" disembunyikan dari role Kasir dan Manager (dilindungi di level UI dan Supabase RLS).

### 3.3. Modul Inventori (Bahan Baku & Aset)
- **Kategorisasi Item:**
  - *Raw Materials (Bahan Baku):* Biji kopi, susu, sirup, kemasan (cup, lid).
  - *Assets (Aset Coffee Shop):* Mesin espresso, grinder, meja, kursi, peralatan bar (dilengkapi kondisi: Baik, Perlu Servis, Rusak).
- **Alert Stok Menipis:** Indikator visual jika stok berada di bawah batas minimum (*minimum stock threshold*).

### 3.4. Modul Pembelian Barang (Purchasing)
- Mencatat belanja kebutuhan operasional dan restock bahan baku dari supplier.
- Input harga beli terbaru (yang otomatis memperbarui referensi harga HPP bahan baku).
- Upload bukti nota/struk pembelian (disimpan di Supabase Storage).

### 3.5. Modul Stock Opname & Penjadwalan Otomatis
- **Penjadwalan oleh Owner:** Owner dapat mengatur jadwal wajib *stock opname* (Harian: misal jam 22:00 untuk bahan krusial; Mingguan: setiap Minggu; Bulanan: setiap tanggal 28 untuk seluruh bahan & aset).
- **Notifikasi Sistem & WhatsApp:**
  - Muncul *banner/modal* pengingat otomatis di dashboard saat memasuki jadwal *stock opname*.
  - Sistem mengirim pesan WhatsApp otomatis ke HP Manager/Kepala Bar dan Owner saat jadwal tiba, serta mengirim laporan selisih stok (*variance*) setelah opname selesai.
- **Form Opname:** Menampilkan *Stok Sistem* vs *Stok Fisik*, menghitung selisih otomatis, dan kolom alasan selisih (*spillage/tumpah, expired, hilang*).

### 3.6. Modul Membership Pelanggan
- Data pelanggan: Nama, No. WhatsApp, Email, Tanggal Lahir, Poin, Tier Member (Silver, Gold).
- **Notifikasi WhatsApp Pelanggan:** Mengirim struk digital (*e-receipt*) dan info perolehan poin via WhatsApp setelah transaksi selesai.

## 4. Non-Functional Requirements
- **Performa:** Transaksi POS harus responsif (< 1 detik untuk menambah item ke keranjang).
- **Keamanan:** Menggunakan Supabase Row Level Security (RLS) agar data sensitif seperti HPP tidak bisa diakses melalui API oleh user non-owner.
- **Responsivitas:** Dioptimalkan untuk layar Tablet (iPad/Android Tab landscape) dan Desktop.