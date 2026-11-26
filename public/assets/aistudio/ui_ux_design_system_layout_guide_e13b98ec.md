# UI/UX Design System & Layout Guide
**Referensi Visual:** Clean Modern Mint & White POS Interface

## 1. Filosofi Desain
Mengadopsi tampilan yang bersih (*clean*), lapang (*airy*), dan modern dengan dominasi warna putih bersih, abu-abu lembut untuk latar belakang, serta aksen hijau emerald/mint yang memberikan kesan segar, organik, dan profesional khas *coffee shop* modern.

## 2. Palet Warna (Color Palette)
- **Background Utama (Canvas):** `#F4F6F5` (Abu-abu sangat muda dengan sedikit tint hijau)
- **Surface / Card / Sidebar:** `#FFFFFF` (Putih murni)
- **Primary Brand Color:** `#109A58` / `#0D8A4E` (Emerald Green - digunakan untuk tombol aksi utama seperti "Bayar/Encaisser", tombol "+ Tambah", dan status aktif)
- **Primary Light / Tint:** `#E6F5EE` (Mint Soft - digunakan untuk background menu sidebar yang aktif, tombol sekunder seperti "Simpan Draft", dan badge)
- **Text Primary:** `#1A2E26` (Hijau sangat gelap / hampir hitam untuk kontras tinggi yang nyaman di mata)
- **Text Secondary:** `#6B7280` (Abu-abu netral untuk sub-judul, deskripsi, dan harga coret)
- **Semantic Colors:**
  - *Danger / Diskon / Hapus:* `#EF4444` (Merah lembut)
  - *Warning / Stok Menipis:* `#F59E0B` (Amber/Kuning)
  - *Border / Divider:* `#E5E7EB` (Garis tipis 1px)

## 3. Tipografi (Typography)
- **Font Family:** `Plus Jakarta Sans` atau `Inter` (Google Fonts).
- **Hierarki Ukuran:**
  - Judul Halaman: `20px` / `SemiBold (600)`
  - Nama Kategori & Section: `16px` / `SemiBold (600)`
  - Nama Produk di Card: `14px` / `Medium (500)`
  - Harga Produk: `14px` / `Bold (700)`
  - Total Harga Akhir: `20px` / `Bold (700)`
  - Teks Mikro / Label: `12px` / `Regular (400)`

## 4. Struktur Layout (3-Column POS Layout)
Mengikuti struktur layar pada gambar referensi:

### A. Left Navigation Sidebar (Lebar: `220px` - Collapsible pada tablet)
- **Header:** Logo Coffee Shop + Nama Toko.
- **Menu Items (Icon + Label):**
  1. Dashboard (Laporan ringkas)
  2. Kasir / POS (Layar transaksi utama)
  3. Pesanan (Riwayat transaksi)
  4. Menu & HPP *(Badge khusus Owner pada sub-tab HPP)*
  5. Inventori (Bahan Baku & Aset)
  6. Pembelian (Purchasing)
  7. Stock Opname *(Dilengkapi indikator titik merah jika ada jadwal aktif)*
  8. Pelanggan (Membership)
  9. Karyawan & Role *(Khusus Owner)*
  10. Pengaturan (Jadwal Opname & WhatsApp API)
- **Active State:** Background `#E6F5EE`, teks & ikon `#109A58`, sudut membulat (`rounded-xl`).
- **Footer:** Tombol "Keluar / Logout" di bagian paling bawah.

### B. Center Workspace (Fleksibel / `flex-1`)
- **Top Bar:**
  - Search bar membulat (`rounded-full`, background `#FFFFFF`) dengan ikon kaca pembesar (*"Cari menu, bahan, atau member..."*).
  - Ikon Lonceng Notifikasi (menampilkan jadwal *stock opname* & peringatan stok menipis).
  - Profil User di kanan atas (Avatar bulat + sapaan *"Halo, [Nama User]"* + Badge Role).
- **Category Filter Strip:**
  - Deretan kartu kategori berbentuk persegi dengan sudut membulat (`rounded-2xl`), ikon garis (*outline icon*) di atas, dan label di bawah.
  - Kategori aktif memiliki border `#109A58` 1.5px dan background tint lembut.
- **Product Grid:**
  - Grid 3 hingga 4 kolom (`grid-cols-2 md:grid-cols-3 lg:grid-cols-4`, gap `16px`).
  - **Product Card:** Background putih, `rounded-2xl`, shadow sangat halus (`shadow-sm`). Berisi foto produk (rasio 1:1 / bulat di tengah atas), nama menu, harga di tengah, dan tombol penuh di bagian bawah: `+ Tambah` berwarna hijau `#109A58` dengan teks putih (`rounded-full`).

### C. Right Order Panel (Lebar: `360px` - Fixed di kanan pada layar POS)
- **Header Panel:** Judul *"Pesanan Saat Ini"*, Nomor Order/Meja, dan ikon pemilihan *Member Pelanggan*.
- **Order Type Switcher:** Segmented control 3 tombol (*Dine-in*, *Takeaway*, *Delivery*) dengan state aktif berwarna putih/border hijau.
- **Cart Item List:** Daftar item yang dipilih (Nomor urut, Nama menu, Varian/Catatan kecil, Qty stepper `- 1 +`, Subtotal item, dan ikon tempat sampah untuk hapus).
- **Order Note Input:** Kolom input kecil dengan ikon pensil (*"Tambah catatan pesanan..."*).
- **Summary Section:** Rincian Subtotal, Diskon Member (warna merah `#EF4444`), Pajak, diikuti garis pemisah putus-putus/tipis, dan **Total** berukuran besar & tebal.
- **Action Buttons (Bottom):**
  - Tombol Atas: `Simpan Pesanan` (Background `#E6F5EE`, Teks `#109A58`, `rounded-full`).
  - Tombol Bawah: `Proses Bayar` (Background `#109A58`, Teks `#FFFFFF`, `rounded-full`, tinggi `48px`).