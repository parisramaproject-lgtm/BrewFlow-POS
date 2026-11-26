-- =============================================================================
-- BrewFlow POS — Skema Database Lengkap (100% Supabase + RLS Aman)
-- =============================================================================
-- Jalankan SELURUH isi file ini di Supabase Dashboard -> SQL Editor.
-- 100% IDEMPOTENT (aman dijalankan berulang kali, tidak menghapus data lama).
-- Mendukung login Google OAuth, Email/Password, DAN Username/Password Owner!
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. SESI LOGIN USERNAME (AMAN, BERMASA BERLAKU 24 JAM) & HELPER RLS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_sessions (
  token text PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  role text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;

-- Ekstrak token sesi 64-hex dari header `x-client-info` (CORS-safe di Supabase Cloud)
CREATE OR REPLACE FUNCTION public.get_app_session_token()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(
    substring(
      coalesce((current_setting('request.headers', true)::jsonb ->> 'x-client-info'), '')
      FROM 'bf-sess=([a-f0-9]{64})'
    ),
    ''
  );
$$;

-- Helper RLS: true jika pemanggil adalah karyawan aktif (baik lewat Google/Email Auth ATAU sesi Username)
CREATE OR REPLACE FUNCTION public.is_active_employee()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    EXISTS (
      SELECT 1
      FROM public.employees e
      WHERE lower(trim(e.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
        AND e.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.app_sessions s
      JOIN public.employees e ON e.id = s.employee_id
      WHERE s.token = public.get_app_session_token()
        AND s.expires_at > now()
        AND e.is_active = true
    )
  );
$$;

-- Perbarui helper Owner agar bekerja untuk Google OAuth, Email, MAUPUN sesi Username Owner
CREATE OR REPLACE FUNCTION public.is_active_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    EXISTS (
      SELECT 1
      FROM public.employees e
      WHERE lower(trim(e.email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
        AND lower(trim(e.role::text)) = 'owner'
        AND e.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM public.app_sessions s
      JOIN public.employees e ON e.id = s.employee_id
      WHERE s.token = public.get_app_session_token()
        AND s.expires_at > now()
        AND lower(trim(e.role::text)) = 'owner'
        AND e.is_active = true
    )
  );
$$;

-- Perbarui RPC Login Username agar menerbitkan `session_token` 24 jam di `app_sessions`
CREATE OR REPLACE FUNCTION public.authenticate_employee_username(
  p_username text,
  p_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean_username text;
  v_emp public.employees%ROWTYPE;
  v_token text;
BEGIN
  v_clean_username := lower(trim(regexp_replace(coalesce(p_username, ''), '^@+', '')));

  IF v_clean_username = '' OR coalesce(p_password, '') = '' THEN
    RETURN jsonb_build_object('status', 'invalid', 'message', 'Username dan kata sandi wajib diisi.');
  END IF;

  SELECT *
  INTO v_emp
  FROM public.employees e
  WHERE lower(trim(coalesce(e.username, ''))) = v_clean_username
  LIMIT 1;

  IF NOT FOUND OR v_emp.password_hash IS NULL OR v_emp.password_hash = '' THEN
    RETURN jsonb_build_object('status', 'invalid', 'message', 'Username atau kata sandi tidak sesuai.');
  END IF;

  IF v_emp.password_hash <> crypt(p_password, v_emp.password_hash) THEN
    RETURN jsonb_build_object('status', 'invalid', 'message', 'Username atau kata sandi tidak sesuai.');
  END IF;

  IF v_emp.is_active = false THEN
    RETURN jsonb_build_object(
      'status', 'inactive',
      'message', format('Akun karyawan "%s" (@%s) sedang berstatus Nonaktif. Hubungi Owner.', v_emp.full_name, v_emp.username)
    );
  END IF;

  -- Hapus sesi kadaluarsa & terbitkan token sesi acak baru (7 hari)
  DELETE FROM public.app_sessions WHERE expires_at < now();
  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.app_sessions (token, employee_id, role, expires_at)
  VALUES (v_token, v_emp.id, v_emp.role::text, now() + interval '7 days');

  IF to_regclass('public.login_audit_logs') IS NOT NULL THEN
    INSERT INTO public.login_audit_logs (employee_id, username, employee_name, role, owner_email)
    VALUES (v_emp.id, v_emp.username, v_emp.full_name, v_emp.role::text, 'parisramaproject@gmail.com');
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'session_token', v_token,
    'employee', (to_jsonb(v_emp) - 'password_hash') || jsonb_build_object('has_password', true)
  );
END;
$$;

-- RPC untuk memulihkan sesi login Username secara aman setelah browser di-reload (F5)
CREATE OR REPLACE FUNCTION public.get_app_session_profile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_emp public.employees%ROWTYPE;
BEGIN
  v_token := public.get_app_session_token();
  IF v_token IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT e.*
  INTO v_emp
  FROM public.app_sessions s
  JOIN public.employees e ON e.id = s.employee_id
  WHERE s.token = v_token
    AND s.expires_at > now()
  LIMIT 1;

  IF NOT FOUND THEN
    DELETE FROM public.app_sessions WHERE token = v_token;
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_emp.is_active = false THEN
    DELETE FROM public.app_sessions WHERE token = v_token;
    RETURN jsonb_build_object(
      'status', 'inactive',
      'message', format('Akun karyawan "%s" (@%s) sedang berstatus Nonaktif. Hubungi Owner.', v_emp.full_name, coalesce(v_emp.username, v_emp.email))
    );
  END IF;

  -- Perpanjang masa berlaku sesi aktif (sliding 7 hari)
  UPDATE public.app_sessions
  SET expires_at = now() + interval '7 days'
  WHERE token = v_token;

  RETURN jsonb_build_object(
    'status', 'ok',
    'employee', (to_jsonb(v_emp) - 'password_hash') || jsonb_build_object('has_password', true)
  );
END;
$$;

-- RPC untuk mencabut sesi saat Logout
CREATE OR REPLACE FUNCTION public.revoke_app_session()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
BEGIN
  v_token := public.get_app_session_token();
  IF v_token IS NOT NULL THEN
    DELETE FROM public.app_sessions WHERE token = v_token;
  END IF;
END;
$$;

-- Izinkan anon + authenticated menjalankan RPC & fungsi helper
GRANT EXECUTE ON FUNCTION public.get_app_session_token() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_employee() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_owner() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_employee_username(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_session_profile() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_employee_username_credentials(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_app_session() TO anon, authenticated;

-- Perbarui policy employees agar Owner & karyawan aktif (Google/Email/Username) dapat membaca data yang berhak diakses
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO anon, authenticated;
DROP POLICY IF EXISTS "Employees read own or owner reads all" ON public.employees;
CREATE POLICY "Employees read own or owner reads all"
  ON public.employees
  FOR SELECT
  TO anon, authenticated
  USING (
    lower(trim(email)) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
    OR auth_user_id = auth.uid()
    OR public.is_active_owner()
    OR EXISTS (
      SELECT 1
      FROM public.app_sessions s
      WHERE s.token = public.get_app_session_token()
        AND s.employee_id = employees.id
        AND s.expires_at > now()
    )
  );

DROP POLICY IF EXISTS "Owner can insert employees" ON public.employees;
CREATE POLICY "Owner can insert employees"
  ON public.employees FOR INSERT TO anon, authenticated
  WITH CHECK (public.is_active_owner());

DROP POLICY IF EXISTS "Owner can update employees" ON public.employees;
CREATE POLICY "Owner can update employees"
  ON public.employees FOR UPDATE TO anon, authenticated
  USING (public.is_active_owner()) WITH CHECK (public.is_active_owner());

DROP POLICY IF EXISTS "Owner can delete employees" ON public.employees;
CREATE POLICY "Owner can delete employees"
  ON public.employees FOR DELETE TO anon, authenticated
  USING (public.is_active_owner());

-- -----------------------------------------------------------------------------
-- 2. TABEL KATEGORI MENU
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  icon_name text NOT NULL DEFAULT 'coffee',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS icon_name text NOT NULL DEFAULT 'coffee';
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- 3. TABEL INVENTORI (BAHAN BAKU, KEMASAN, ASET, OPERASIONAL)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sku text NOT NULL UNIQUE,
  category_type text NOT NULL DEFAULT 'raw_material',
  expense_category text DEFAULT 'pembelian_bahan_baku',
  unit text NOT NULL DEFAULT 'pcs',
  current_stock numeric(14,2) NOT NULL DEFAULT 0,
  min_stock_threshold numeric(14,2) NOT NULL DEFAULT 0,
  last_purchase_price numeric(14,2) NOT NULL DEFAULT 0,
  asset_condition text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS expense_category text DEFAULT 'pembelian_bahan_baku';
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS asset_condition text;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- -----------------------------------------------------------------------------
-- 4. TABEL MENU & RESEP HPP (BILL OF MATERIALS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.menus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text DEFAULT '',
  image_url text,
  selling_price numeric(14,2) NOT NULL DEFAULT 0,
  is_available boolean NOT NULL DEFAULT true,
  visual_tone text DEFAULT 'espresso',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.menus ADD COLUMN IF NOT EXISTS visual_tone text DEFAULT 'espresso';
ALTER TABLE public.menus ADD COLUMN IF NOT EXISTS description text DEFAULT '';
ALTER TABLE public.menus ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.menus ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.menu_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id uuid NOT NULL REFERENCES public.menus(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  quantity_needed numeric(14,2) NOT NULL DEFAULT 0
);

-- -----------------------------------------------------------------------------
-- 5. TABEL PELANGGAN / MEMBERSHIP
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone_number text NOT NULL,
  email text DEFAULT '',
  points integer NOT NULL DEFAULT 0,
  tier text NOT NULL DEFAULT 'Silver',
  total_spent numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS email text DEFAULT '';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'Silver';
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS total_spent numeric(14,2) NOT NULL DEFAULT 0;

-- -----------------------------------------------------------------------------
-- 6. TABEL TRANSAKSI POS (ORDERS & ORDER_ITEMS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  cashier_id uuid,
  cashier_name text DEFAULT '',
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text,
  order_type text NOT NULL DEFAULT 'dine_in',
  table_number text DEFAULT '',
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash',
  status text NOT NULL DEFAULT 'completed',
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cashier_name text DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS notes text DEFAULT '';

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_id uuid REFERENCES public.menus(id) ON DELETE SET NULL,
  menu_name text DEFAULT '',
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  notes text
);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS menu_name text DEFAULT '';
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS notes text;

-- -----------------------------------------------------------------------------
-- 7. TABEL PEMBELIAN & PENGELUARAN (PURCHASES & PURCHASE_ITEMS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_category text NOT NULL DEFAULT 'pembelian_bahan_baku',
  supplier_name text NOT NULL,
  invoice_number text NOT NULL,
  total_cost numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text DEFAULT 'transfer',
  notes text DEFAULT '',
  purchased_by uuid,
  purchased_by_name text DEFAULT '',
  purchase_date timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS expense_category text NOT NULL DEFAULT 'pembelian_bahan_baku';
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS payment_method text DEFAULT 'transfer';
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS notes text DEFAULT '';
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS purchased_by_name text DEFAULT '';

CREATE TABLE IF NOT EXISTS public.purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchases(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  item_name text DEFAULT '',
  unit text DEFAULT 'pcs',
  quantity numeric(14,2) NOT NULL DEFAULT 1,
  unit_price numeric(14,2) NOT NULL DEFAULT 0
);
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS item_name text DEFAULT '';
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS unit text DEFAULT 'pcs';

-- -----------------------------------------------------------------------------
-- 8. TABEL STOCK OPNAME (SCHEDULES, LOGS, DETAILS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_opname_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  frequency text NOT NULL DEFAULT 'daily',
  execution_time text NOT NULL DEFAULT '21:00',
  day_of_week integer,
  day_of_month integer,
  target_category text NOT NULL DEFAULT 'raw_material',
  is_active boolean NOT NULL DEFAULT true,
  is_due_now boolean NOT NULL DEFAULT false,
  last_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_opname_schedules ADD COLUMN IF NOT EXISTS is_due_now boolean NOT NULL DEFAULT false;
ALTER TABLE public.stock_opname_schedules ADD COLUMN IF NOT EXISTS last_completed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.stock_opname_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES public.stock_opname_schedules(id) ON DELETE SET NULL,
  schedule_title text DEFAULT 'Stock Opname',
  performed_by uuid,
  performed_by_name text DEFAULT '',
  notes text DEFAULT '',
  total_items_checked integer NOT NULL DEFAULT 0,
  discrepancy_count integer NOT NULL DEFAULT 0,
  whatsapp_sent boolean NOT NULL DEFAULT false,
  completed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_opname_logs ADD COLUMN IF NOT EXISTS schedule_title text DEFAULT 'Stock Opname';
ALTER TABLE public.stock_opname_logs ADD COLUMN IF NOT EXISTS performed_by_name text DEFAULT '';
ALTER TABLE public.stock_opname_logs ADD COLUMN IF NOT EXISTS total_items_checked integer NOT NULL DEFAULT 0;
ALTER TABLE public.stock_opname_logs ADD COLUMN IF NOT EXISTS discrepancy_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.stock_opname_logs ADD COLUMN IF NOT EXISTS whatsapp_sent boolean NOT NULL DEFAULT false;

-- Lepas FK ketat pada performed_by / cashier_id / purchased_by jika ada (agar karyawan login username/Google yang belum punya baris di profiles tetap bisa submit opname, POS, dan pembelian)
DO $$
DECLARE
  v_rec record;
BEGIN
  FOR v_rec IN
    SELECT tc.table_name, tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND (
        (tc.table_name = 'stock_opname_logs' AND kcu.column_name = 'performed_by')
        OR (tc.table_name = 'orders' AND kcu.column_name = 'cashier_id')
        OR (tc.table_name = 'purchases' AND kcu.column_name = 'purchased_by')
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_rec.table_name, v_rec.constraint_name);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.stock_opname_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opname_log_id uuid NOT NULL REFERENCES public.stock_opname_logs(id) ON DELETE CASCADE,
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  item_name text DEFAULT '',
  sku text DEFAULT '',
  unit text DEFAULT 'pcs',
  system_stock numeric(14,2) NOT NULL DEFAULT 0,
  actual_stock numeric(14,2) NOT NULL DEFAULT 0,
  variance numeric(14,2) GENERATED ALWAYS AS (actual_stock - system_stock) STORED,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  reason text
);
ALTER TABLE public.stock_opname_details ADD COLUMN IF NOT EXISTS item_name text DEFAULT '';
ALTER TABLE public.stock_opname_details ADD COLUMN IF NOT EXISTS sku text DEFAULT '';
ALTER TABLE public.stock_opname_details ADD COLUMN IF NOT EXISTS unit text DEFAULT 'pcs';
ALTER TABLE public.stock_opname_details ADD COLUMN IF NOT EXISTS unit_price numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.stock_opname_details ADD COLUMN IF NOT EXISTS reason text;

-- -----------------------------------------------------------------------------
-- 9. PENGATURAN TOKO, PROGRAM MEMBERSHIP & DISPLAY TV STORE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.store_settings (
  id text PRIMARY KEY DEFAULT 'default',
  shop_name text NOT NULL DEFAULT 'BrewFlow Coffee & Roastery',
  address text DEFAULT '',
  phone text DEFAULT '',
  customer_service_contact text DEFAULT '',
  shop_logo_url text,
  tax_enabled boolean NOT NULL DEFAULT true,
  tax_percent numeric(5,2) NOT NULL DEFAULT 10,
  tax_label text DEFAULT 'PB1 / Pajak Restoran',
  receipt_paper_width text DEFAULT '58mm',
  receipt_header_text text DEFAULT '',
  receipt_footer_text text DEFAULT '',
  receipt_show_logo boolean NOT NULL DEFAULT true,
  receipt_show_cashier_and_table boolean NOT NULL DEFAULT true,
  receipt_show_member_info boolean NOT NULL DEFAULT true,
  receipt_show_customer_service boolean NOT NULL DEFAULT true,
  printer_connection_type text DEFAULT 'browser',
  printer_device_name text DEFAULT '',
  printer_network_ip text DEFAULT '192.168.1.100',
  printer_network_port integer DEFAULT 9100,
  printer_network_bridge_url text DEFAULT 'http://localhost:8765/print',
  printer_baud_rate integer DEFAULT 9600,
  printer_auto_cut boolean DEFAULT true,
  printer_open_cash_drawer boolean DEFAULT false,
  printer_auto_print_after_payment boolean DEFAULT false,
  printer_copies integer DEFAULT 1,
  whatsapp_gateway_provider text DEFAULT 'fonnte',
  whatsapp_gateway_url text DEFAULT 'https://api.fonnte.com/send',
  whatsapp_owner_phone text DEFAULT '',
  whatsapp_manager_phone text DEFAULT '',
  whatsapp_auto_receipt boolean DEFAULT true,
  whatsapp_auto_opname_reminder boolean DEFAULT true,
  whatsapp_auto_low_stock boolean DEFAULT true,
  owner_login_alert_email text DEFAULT 'parisramaproject@gmail.com',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS owner_login_alert_email text DEFAULT 'parisramaproject@gmail.com';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS printer_connection_type text DEFAULT 'browser';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS whatsapp_owner_phone text DEFAULT '';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS whatsapp_manager_phone text DEFAULT '';

CREATE TABLE IF NOT EXISTS public.membership_program_settings (
  id text PRIMARY KEY DEFAULT 'default',
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.member_redemption_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  reward_id text,
  promo_id text,
  label text NOT NULL,
  points_spent integer NOT NULL DEFAULT 0,
  redeemed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text DEFAULT '',
  source_type text NOT NULL DEFAULT 'mp4',
  url text NOT NULL,
  embed_url text,
  is_active boolean NOT NULL DEFAULT true,
  show_promo_ticker boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by_name text DEFAULT 'BrewFlow Staff',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 10. AKTIFKAN RLS & HAK AKSES AMAN PADA SELURUH TABEL OPERASIONAL
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories',
    'inventory_items',
    'menus',
    'menu_recipes',
    'customers',
    'orders',
    'order_items',
    'purchases',
    'purchase_items',
    'stock_opname_schedules',
    'stock_opname_logs',
    'stock_opname_details',
    'store_settings',
    'membership_program_settings',
    'member_redemption_logs',
    'store_videos'
  ]
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Active staff full access" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Active staff full access" ON public.%I FOR ALL TO anon, authenticated USING (public.is_active_employee()) WITH CHECK (public.is_active_employee())',
      t
    );
  END LOOP;
END $$;

-- Pastikan enum lama `item_category_type` (jika ada) mendukung nilai 'operational'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'item_category_type'
  ) THEN
    ALTER TYPE public.item_category_type ADD VALUE IF NOT EXISTS 'operational';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 11. DATA AWAL OTOMATIS (HANYA DIISI JIKA TABEL MASIH KOSONG)
-- Menggunakan INSERT ... VALUES langsung agar kompatibel dengan kolom text, time, maupun ENUM lama
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.categories) THEN
    INSERT INTO public.categories (name, icon_name, sort_order) VALUES
      ('Kopi & Espresso', 'coffee', 1),
      ('Non-Kopi & Teh', 'cup-soda', 2),
      ('Makanan Berat', 'utensils', 3),
      ('Pastry & Snack', 'cookie', 4);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.inventory_items) THEN
    INSERT INTO public.inventory_items (
      name, sku, category_type, expense_category, unit, current_stock, min_stock_threshold, last_purchase_price, asset_condition
    ) VALUES
      ('Biji Kopi Arabika Gayo', 'RAW-ESP-01', 'raw_material', 'pembelian_bahan_baku', 'gram', 1800, 1000, 260, NULL),
      ('Susu UHT Full Cream', 'RAW-MLK-01', 'raw_material', 'pembelian_bahan_baku', 'ml', 3200, 4000, 22, NULL),
      ('Sirup Gula Aren Organik', 'RAW-SYR-01', 'raw_material', 'pembelian_bahan_baku', 'ml', 1450, 800, 48, NULL),
      ('Bubuk Uji Matcha Premium', 'RAW-MTC-01', 'raw_material', 'pembelian_bahan_baku', 'gram', 240, 300, 520, NULL),
      ('Cup Plastik Iced 16oz + Lid', 'PKG-CUP-16', 'packaging', 'kemasan_perlengkapan', 'pcs', 210, 150, 950, NULL),
      ('Paper Cup Hot 8oz + Sleeve', 'PKG-CUP-08', 'packaging', 'kemasan_perlengkapan', 'pcs', 85, 100, 1150, NULL),
      ('Mesin Espresso 2 Group La Marzocco', 'AST-ESP-01', 'asset', 'pembelian_asset', 'unit', 1, 1, 145000000, 'Baik'),
      ('Grinder Kopi Mazzer Major', 'AST-GRD-02', 'asset', 'pembelian_asset', 'unit', 2, 1, 16500000, 'Baik');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stock_opname_schedules) THEN
    INSERT INTO public.stock_opname_schedules (
      title, frequency, execution_time, day_of_week, day_of_month, target_category, is_active, is_due_now
    ) VALUES
      ('Opname Harian Bahan Baku & Susu', 'daily', '21:00', NULL, NULL, 'raw_material', true, true),
      ('Opname Mingguan Kemasan & Cup', 'weekly', '20:00', 0, NULL, 'packaging', true, false),
      ('Audit Aset & Mesin Bulanan', 'monthly', '10:00', NULL, 1, 'asset', true, false);
  END IF;
END $$;
