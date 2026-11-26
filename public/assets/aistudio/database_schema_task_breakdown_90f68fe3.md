# Arsitektur Database Supabase & Daftar Tugas (Tasks)

## 1. Skema Database PostgreSQL (Supabase)

Jalankan query SQL berikut di **Supabase SQL Editor** untuk menyiapkan tabel dan relasi dasar:

```sql
-- 1. Profiles & Roles
CREATE TYPE user_role AS ENUM ('owner', 'manager', 'cashier');

CREATE TABLE profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT NOT NULL,
  role user_role DEFAULT 'cashier',
  phone_number TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Inventory Items (Bahan Baku & Aset)
CREATE TYPE item_category_type AS ENUM ('raw_material', 'asset', 'packaging');

CREATE TABLE inventory_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  category_type item_category_type NOT NULL,
  unit TEXT NOT NULL, -- gram, ml, pcs, unit
  current_stock NUMERIC(12,2) DEFAULT 0,
  min_stock_threshold NUMERIC(12,2) DEFAULT 0,
  last_purchase_price NUMERIC(12,2) DEFAULT 0, -- Harga per unit (untuk kalkulasi HPP)
  asset_condition TEXT, -- Khusus aset: 'Baik', 'Perlu Servis', 'Rusak'
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Menu Categories & Menus
CREATE TABLE categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  icon_name TEXT DEFAULT 'coffee',
  sort_order INT DEFAULT 0
);

CREATE TABLE menus (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  selling_price NUMERIC(12,2) NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Menu Recipes / Bill of Materials (Untuk HPP & Potong Stok Otomatis)
CREATE TABLE menu_recipes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  menu_id UUID REFERENCES menus(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity_needed NUMERIC(12,2) NOT NULL -- Jumlah bahan yang terpakai per 1 porsi menu
);

-- 5. Customers / Membership
CREATE TABLE customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone_number TEXT UNIQUE NOT NULL,
  email TEXT,
  points INT DEFAULT 0,
  tier TEXT DEFAULT 'Silver', -- Silver, Gold, Platinum
  total_spent NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Sales / Orders
CREATE TABLE orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  cashier_id UUID REFERENCES profiles(id),
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  order_type TEXT DEFAULT 'dine_in', -- dine_in, takeaway, delivery
  table_number TEXT,
  subtotal NUMERIC(12,2) NOT NULL,
  discount_amount NUMERIC(12,2) DEFAULT 0,
  tax_amount NUMERIC(12,2) DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT DEFAULT 'cash', -- cash, qris, debit
  status TEXT DEFAULT 'completed', -- draft, completed, cancelled
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE order_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  menu_id UUID REFERENCES menus(id),
  quantity INT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL,
  notes TEXT
);

-- 7. Purchasing (Pembelian Barang)
CREATE TABLE purchases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_name TEXT NOT NULL,
  invoice_number TEXT,
  total_cost NUMERIC(12,2) NOT NULL,
  receipt_image_url TEXT,
  purchased_by UUID REFERENCES profiles(id),
  purchase_date TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE purchase_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  purchase_id UUID REFERENCES purchases(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES inventory_items(id),
  quantity NUMERIC(12,2) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL
);

-- 8. Stock Opname Schedules & Records
CREATE TABLE stock_opname_schedules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL, -- Misal: "Opname Harian Bar", "Opname Bulanan Aset"
  frequency TEXT NOT NULL, -- 'daily', 'weekly', 'monthly'
  execution_time TIME NOT NULL, -- Misal: '22:00:00'
  day_of_week INT, -- 0-6 (untuk weekly)
  day_of_month INT, -- 1-31 (untuk monthly)
  target_category item_category_type, -- NULL jika semua kategori
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id)
);

CREATE TABLE stock_opname_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_id UUID REFERENCES stock_opname_schedules(id) ON DELETE SET NULL,
  performed_by UUID REFERENCES profiles(id),
  notes TEXT,
  completed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stock_opname_details (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  opname_log_id UUID REFERENCES stock_opname_logs(id) ON DELETE CASCADE,
  inventory_item_id UUID REFERENCES inventory_items(id),
  system_stock NUMERIC(12,2) NOT NULL,
  actual_stock NUMERIC(12,2) NOT NULL,
  variance NUMERIC(12,2) GENERATED ALWAYS AS (actual_stock - system_stock) STORED,
  reason TEXT
);
```

---

## 2. Daftar Tugas Pengembangan (Task Breakdown)

### Fase 1: Fondasi & UI Shell
- [ ] Inisialisasi proyek React + Vite + Tailwind CSS + Lucide Icons.
- [ ] Setup Supabase Client & Environment Variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
- [ ] Implementasi Halaman Login & Middleware/Context untuk Role (`owner`, `manager`, `cashier`).
- [ ] Membangun *App Shell* (Sidebar kiri, Top Header bar dengan search & profil user) sesuai `DESIGN_SYSTEM.md`.

### Fase 2: Modul POS & Membership
- [ ] Membangun tampilan katalog menu (Filter kategori horizontal + Grid kartu produk dengan tombol `+ Tambah`).
- [ ] Membangun panel kanan (*Current Order*): keranjang belanja, tipe pesanan, kalkulasi pajak/diskon.
- [ ] Integrasi modal pemilihan & pendaftaran *Membership* pelanggan.
- [ ] Proses checkout: simpan ke tabel `orders`, `order_items`, tambah poin member, dan potong stok bahan baku berdasarkan `menu_recipes`.

### Fase 3: Inventori, Purchasing & Kalkulasi HPP (Owner)
- [ ] Halaman manajemen Inventori dengan tab terpisah: *Bahan Baku*, *Kemasan*, dan *Aset Coffee Shop*.
- [ ] Form *Purchasing* (Pembelian barang) yang otomatis menambah stok dan mengupdate `last_purchase_price`.
- [ ] Halaman Manajemen Menu & **Kalkulator HPP** (Hanya bisa diakses `owner`): input resep per menu dan hitung otomatis total modal vs harga jual.

### Fase 4: Stock Opname, Penjadwalan & Notifikasi WhatsApp
- [ ] Halaman pengaturan jadwal *Stock Opname* (Harian, Mingguan, Bulanan) oleh Owner.
- [ ] Sistem pengecekan jadwal otomatis di frontend (menampilkan banner/modal notifikasi saat jadwal tiba) + *Cron Job* (pg_cron di Supabase).
- [ ] Form pelaksanaan *Stock Opname* (input stok fisik, hitung selisih otomatis, update stok sistem).
- [ ] Pembuatan Supabase Edge Function untuk mengirim notifikasi *push* WhatsApp (pengingat opname, stok menipis, dan struk pelanggan).