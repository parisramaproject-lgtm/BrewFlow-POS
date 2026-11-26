# Panduan Prompt Bertahap untuk Google AI Studio

Gunakan prompt di bawah ini secara berurutan di **Google AI Studio** (gunakan model **Gemini 2.5 Pro** atau **Gemini 3 Pro** untuk hasil generasi kode yang paling akurat dan konsisten). Pastikan Anda melampirkan file `PRD.md`, `DESIGN_SYSTEM.md`, dan `DATABASE_AND_TASKS.md` (atau salin isinya) pada awal sesi.

---

### BATCH 1: Setup Arsitektur, Auth Role, & UI Layout Utama
**Tujuan:** Membuat kerangka aplikasi, sistem login multi-role, dan tampilan antarmuka yang identik dengan desain referensi.

> **Copy & Paste Prompt Batch 1:**
> ```text
> Saya ingin membangun aplikasi POS (Point of Sale) dan Manajemen Coffee Shop bernama "BrewFlow POS" menggunakan React (Vite), Tailwind CSS, Lucide React Icons, dan Supabase.
> 
> Berikut adalah aturan desain (Design System) yang WAJIB diikuti secara presisi:
> - Background utama: #F4F6F5, Card & Sidebar: #FFFFFF, Warna Utama (Primary): #109A58 (Emerald Green), Tint aktif: #E6F5EE, Teks utama: #1A2E26.
> - Layout menggunakan 3 kolom untuk layar utama:
>   1. Sidebar kiri (220px) dengan menu navigasi vertikal (Dashboard, Kasir/POS, Pesanan, Menu & HPP, Inventori, Pembelian, Stock Opname, Membership, Karyawan, Pengaturan) dan tombol Logout di bawah. Item aktif memiliki background #E6F5EE dan teks #109A58.
>   2. Header atas di area konten berisi Search bar membulat di kiri, ikon lonceng notifikasi, dan profil user di kanan ("Halo, [Nama]" + Badge Role).
> - Buat sistem Autentikasi & Role-Based Access Control (RBAC) menggunakan Supabase Auth dengan 3 role: 'owner', 'manager', dan 'cashier'. 
> - Sediakan juga fitur "Demo Quick Login" di halaman login agar saya bisa menguji tampilan sebagai Owner, Manager, atau Kasir dengan mudah sebelum menyambungkan data live.
> - Pastikan menu "Menu & HPP" (bagian HPP), "Karyawan", dan "Pengaturan Jadwal" hanya terlihat dan bisa diakses oleh role 'owner'.
> 
> Buatkan struktur folder, konfigurasi Supabase client, AuthContext, halaman Login, dan komponen AppLayout utama beserta navigasi antar halaman yang berfungsi penuh.
> ```

---

### BATCH 2: Modul Kasir (POS) & Membership Pelanggan
**Tujuan:** Membangun layar transaksi kasir yang interaktif persis seperti gambar referensi, lengkap dengan keranjang belanja dan fitur membership.

> **Copy & Paste Prompt Batch 2:**
> ```text
> Lanjutkan pengembangan aplikasi BrewFlow POS. Sekarang fokus pada pembuatan halaman utama "Kasir / POS" (POSPage.jsx) dan modul "Membership" (CustomersPage.jsx).
> 
> Spesifikasi halaman Kasir / POS:
> 1. Area Tengah:
>    - Strip kategori horizontal berbentuk kartu persegi membulat (rounded-2xl) dengan ikon di atas dan nama kategori di bawah (Semua, Kopi, Non-Kopi, Makanan, Snack). Kategori aktif memiliki border #109A58.
>    - Grid kartu produk (3-4 kolom). Setiap kartu memiliki foto produk, nama menu, harga (format Rupiah Rp), dan tombol penuh di bagian bawah bertuliskan "+ Tambah" berwarna #109A58 dengan bentuk pill (rounded-full).
> 2. Panel Kanan (Fixed width 360px - "Pesanan Saat Ini"):
>    - Header menampilkan nomor order/meja dan tombol pilih/tambah Member Pelanggan.
>    - Tab pilihan tipe pesanan: "Dine-in", "Takeaway", dan "Delivery".
>    - Daftar item keranjang dengan tombol stepper (- qty +), subtotal per item, dan ikon hapus.
>    - Input catatan pesanan kecil ("Tambah catatan...").
>    - Ringkasan pembayaran: Subtotal, Diskon Member (warna merah #EF4444 jika member dipilih), Pajak (10%), dan Total Akhir berukuran besar.
>    - Dua tombol aksi di bawah: "Simpan Draft" (background #E6F5EE, teks #109A58) dan "Proses Bayar" (background #109A58, teks putih) yang membuka modal pembayaran (Tunai, QRIS, Debit).
> 3. Logika Transaksi:
>    - Saat pembayaran selesai, simpan transaksi ke Supabase (tabel `orders` dan `order_items`), tambahkan poin ke customer jika member dipilih, dan jalankan fungsi pengurangan stok otomatis berdasarkan resep menu (`menu_recipes`).
> 
> Buatkan kode lengkap untuk POSPage.jsx, modal pembayaran, modal pilih/daftar member, dan halaman CustomersPage.jsx.
> ```

---

### BATCH 3: Inventori (Bahan Baku & Aset), Purchasing, & Kalkulator HPP (Khusus Owner)
**Tujuan:** Membangun sistem manajemen stok, pembelian barang, dan perhitungan HPP rahasia untuk Owner.

> **Copy & Paste Prompt Batch 3:**
> ```text
> Lanjutkan pengembangan aplikasi BrewFlow POS untuk modul backend operasional:
> 
> 1. Halaman Inventori (InventoryPage.jsx):
>    - Gunakan Tab untuk memisahkan: "Bahan Baku (Raw Materials)", "Kemasan (Packaging)", dan "Aset Coffee Shop (Assets)".
>    - Tampilkan tabel stok lengkap dengan indikator badge merah/kuning jika `current_stock <= min_stock_threshold`.
>    - Khusus tab "Aset Coffee Shop", tampilkan kolom kondisi aset (Baik, Perlu Servis, Rusak) dan tombol update kondisi.
> 
> 2. Halaman Pembelian / Purchasing (PurchasingPage.jsx):
>    - Form untuk mencatat pembelian barang dari supplier (Nama Supplier, No. Nota, daftar item yang dibeli, jumlah, dan harga beli satuan).
>    - Saat pembelian disimpan: otomatis menambah `current_stock` pada tabel `inventory_items` DAN memperbarui `last_purchase_price` item tersebut agar perhitungan HPP selalu akurat mengikuti harga pasar terbaru.
> 
> 3. Halaman Menu & Kalkulator HPP (MenuHPPPage.jsx):
>    - Fitur kelola daftar menu (Tambah/Edit menu, harga jual, kategori, upload gambar).
>    - **KHUSUS ROLE 'owner'**: Sediakan panel/tab "Resep & Kalkulasi HPP". Di sini Owner bisa memilih bahan baku dari inventori dan memasukkan takaran per porsi (misal: 18 gr kopi, 120 ml susu). Sistem otomatis menghitung Total HPP berdasarkan `last_purchase_price`, menampilkan persentase Food Cost (HPP / Harga Jual * 100%), dan estimasi profit bersih per cup. Pastikan blok kode HPP ini terproteksi ketat untuk role selain 'owner'.
> 
> Buatkan kode lengkap untuk ketiga halaman tersebut beserta integrasi state dan Supabase-nya.
> ```

---

### BATCH 4: Stock Opname Terjadwal & Notifikasi Otomatis (Sistem + WhatsApp)
**Tujuan:** Mengimplementasikan penjadwalan stock opname harian/mingguan/bulanan dan integrasi notifikasi WhatsApp.

> **Copy & Paste Prompt Batch 4:**
> ```text
> Sekarang kita masuk ke tahap akhir pengembangan BrewFlow POS: Modul Stock Opname Terjadwal dan Integrasi Notifikasi WhatsApp.
> 
> 1. Pengaturan Jadwal Stock Opname (Owner Only - di SettingsPage.jsx):
>    - Form bagi Owner untuk membuat jadwal opname otomatis: Nama Jadwal, Frekuensi ('daily' / Harian, 'weekly' / Mingguan, 'monthly' / Bulanan), Jam Eksekusi, Hari (jika mingguan), Tanggal (jika bulanan), dan Target Kategori (Bahan Baku / Aset / Semua).
> 
> 2. Sistem Notifikasi Otomatis di Aplikasi:
>    - Buat hook/komponen `NotificationWatcher` yang mengecek jadwal aktif dari Supabase dan kondisi stok menipis.
>    - Jika waktu saat ini memasuki jadwal stock opname yang belum dikerjakan, tampilkan banner peringatan mencolok di bagian atas dashboard dan tambahkan badge merah pada menu "Stock Opname" di sidebar.
> 
> 3. Halaman Eksekusi Stock Opname (StockOpnamePage.jsx):
>    - Menampilkan daftar jadwal aktif dan riwayat opname.
>    - Form opname: menampilkan daftar item sesuai kategori jadwal, kolom "Stok Sistem" (read-only), input "Stok Fisik Aktual", kalkulasi otomatis kolom "Selisih (Variance)", dan input keterangan (misal: tumpah, rusak, expired).
>    - Saat opname disubmit, simpan log ke `stock_opname_logs` & `stock_opname_details`, perbarui `current_stock` di inventori sesuai stok fisik, dan picu pengiriman laporan ringkasan selisih stok ke WhatsApp Owner.
> 
> 4. Integrasi Push Notifikasi WhatsApp (Supabase Edge Function):
>    - Buatkan kode Supabase Edge Function (`send-whatsapp/index.ts`) yang menggunakan standar REST API WhatsApp Gateway (seperti Fonnte/Wablas) untuk mengirim pesan otomatis pada 3 kondisi:
>      a) Pengingat jadwal Stock Opname ke Manager & Owner.
>      b) Peringatan stok bahan baku di bawah batas minimum.
>      c) Struk digital & info poin ke nomor WhatsApp pelanggan setelah transaksi POS selesai.
> 
> Buatkan kode lengkap untuk semua fitur di Batch 4 ini beserta instruksi singkat cara deploy Edge Function-nya.
> ```