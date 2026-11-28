-- =============================================================================
-- BrewFlow POS — Skema Database Lengkap (Standalone, Idempotent, RLS Per-Role)
-- =============================================================================
-- Jalankan SELURUH isi file ini di Supabase Dashboard -> SQL Editor.
-- 100% STANDALONE & IDEMPOTENT: aman dijalankan pada proyek Supabase baru
-- maupun proyek yang sudah berjalan (tidak menghapus data lama).
--
-- Mencakup:
--   1. Karyawan, Google OAuth, Login Username (rate-limiting 5x/15 mnt), Sesi 7 Hari
--   2. Strict RLS Per-Role (Owner vs Manager vs Cashier) + proteksi kolom password_hash
--   3. RPC Atomik POS: `checkout_order_atomic` (nomor urut harian, unit_hpp historis,
--      potong stok relatif, poin member relatif, kuota voucher atomik)
--   4. RPC Atomik Pembatalan: `cancel_order_atomic` (pulihkan stok, poin, kuota voucher)
--   5. RPC Aman untuk Kasir: `get_pos_stock_levels()` & `get_pos_store_settings()`
--   6. Tabel Multi-Perangkat: `vendors`, `restock_requests`, `operational_notifications`, `whatsapp_logs`
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. TABEL KARYAWAN, AUDIT LOGIN, RATE LIMIT, DAN SESI (STANDALONE)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  username text UNIQUE,
  password_hash text,
  role text NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')) DEFAULT 'cashier',
  phone_number text DEFAULT '-',
  is_active boolean NOT NULL DEFAULT true,
  shift text DEFAULT 'Shift Pagi (07:00 - 15:00)',
  position text DEFAULT 'Barista & Kasir',
  employment_status text DEFAULT 'Kontrak',
  monthly_salary numeric(12,2) DEFAULT 0,
  join_date date DEFAULT current_date,
  emergency_contact text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS password_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS employees_username_lower_unique_idx
  ON public.employees (lower(trim(username)))
  WHERE username IS NOT NULL AND trim(username) <> '';

CREATE TABLE IF NOT EXISTS public.login_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  username text NOT NULL,
  employee_name text NOT NULL,
  role text NOT NULL,
  owner_email text NOT NULL DEFAULT 'parisramaproject@gmail.com',
  logged_in_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.login_rate_limits (
  username text PRIMARY KEY,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.login_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.app_sessions (
  token text PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  role text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.normalize_employee_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  IF NEW.username IS NOT NULL THEN
    NEW.username := nullif(lower(trim(regexp_replace(NEW.username, '^@+', ''))), '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_employee_email ON public.employees;
CREATE TRIGGER trg_normalize_employee_email
  BEFORE INSERT OR UPDATE OF email, username ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_employee_email();

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

CREATE OR REPLACE FUNCTION public.get_current_employee_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT lower(trim(e.role::text))
      FROM public.app_sessions s
      JOIN public.employees e ON e.id = s.employee_id
      WHERE s.token = public.get_app_session_token()
        AND s.expires_at > now()
        AND e.is_active = true
      LIMIT 1
    ),
    (
      SELECT lower(trim(e.role::text))
      FROM auth.users u
      JOIN public.employees e
        ON (e.auth_user_id = u.id OR lower(trim(e.email)) = lower(trim(coalesce(u.email, ''))))
      WHERE u.id = auth.uid()
        AND u.email_confirmed_at IS NOT NULL
        AND e.is_active = true
      LIMIT 1
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_current_employee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT e.id
      FROM public.app_sessions s
      JOIN public.employees e ON e.id = s.employee_id
      WHERE s.token = public.get_app_session_token()
        AND s.expires_at > now()
        AND e.is_active = true
      LIMIT 1
    ),
    (
      SELECT e.id
      FROM auth.users u
      JOIN public.employees e
        ON (e.auth_user_id = u.id OR lower(trim(e.email)) = lower(trim(coalesce(u.email, ''))))
      WHERE u.id = auth.uid()
        AND u.email_confirmed_at IS NOT NULL
        AND e.is_active = true
      LIMIT 1
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_employee()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_current_employee_role() IN ('owner', 'manager', 'cashier');
$$;

CREATE OR REPLACE FUNCTION public.is_active_manager_or_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_current_employee_role() IN ('owner', 'manager');
$$;

CREATE OR REPLACE FUNCTION public.is_active_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_current_employee_role() = 'owner';
$$;

CREATE OR REPLACE FUNCTION public.get_my_employee_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_confirmed timestamptz;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT lower(trim(coalesce(u.email, ''))), u.email_confirmed_at
  INTO v_email, v_confirmed
  FROM auth.users u
  WHERE u.id = auth.uid()
  LIMIT 1;

  IF v_confirmed IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_email IS NOT NULL AND v_email <> '' THEN
    SELECT (to_jsonb(e) - 'password_hash') || jsonb_build_object('has_password', (e.password_hash IS NOT NULL AND e.password_hash <> ''))
    INTO v_result
    FROM public.employees e
    WHERE lower(trim(e.email)) = v_email
       OR e.auth_user_id = auth.uid()
    LIMIT 1;
  END IF;

  RETURN v_result;
END;
$$;

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
  v_rl public.login_rate_limits%ROWTYPE;
  v_next_attempts integer;
  v_wait_minutes integer;
  v_token text;
BEGIN
  v_clean_username := lower(trim(regexp_replace(coalesce(p_username, ''), '^@+', '')));

  IF v_clean_username = '' OR coalesce(p_password, '') = '' THEN
    RETURN jsonb_build_object('status', 'invalid', 'message', 'Username dan kata sandi wajib diisi.');
  END IF;

  SELECT * INTO v_rl
  FROM public.login_rate_limits
  WHERE username = v_clean_username
  FOR UPDATE;

  IF FOUND AND v_rl.locked_until IS NOT NULL AND v_rl.locked_until > now() THEN
    v_wait_minutes := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_rl.locked_until - now())) / 60.0)::integer);
    RETURN jsonb_build_object(
      'status', 'locked',
      'message', format('Terlalu banyak percobaan gagal. Coba lagi dalam %s menit.', v_wait_minutes)
    );
  END IF;

  SELECT *
  INTO v_emp
  FROM public.employees e
  WHERE lower(trim(coalesce(e.username, ''))) = v_clean_username
  LIMIT 1;

  IF NOT FOUND OR v_emp.password_hash IS NULL OR v_emp.password_hash = '' OR v_emp.password_hash <> crypt(p_password, v_emp.password_hash) THEN
    v_next_attempts := CASE
      WHEN v_rl.username IS NULL THEN 1
      WHEN v_rl.locked_until IS NOT NULL AND v_rl.locked_until <= now() THEN 1
      ELSE v_rl.failed_attempts + 1
    END;

    INSERT INTO public.login_rate_limits (username, failed_attempts, locked_until, last_attempt_at)
    VALUES (
      v_clean_username,
      v_next_attempts,
      CASE WHEN v_next_attempts >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
      now()
    )
    ON CONFLICT (username) DO UPDATE
    SET
      failed_attempts = EXCLUDED.failed_attempts,
      locked_until = EXCLUDED.locked_until,
      last_attempt_at = now();

    IF v_next_attempts >= 5 THEN
      RETURN jsonb_build_object(
        'status', 'locked',
        'message', 'Terlalu banyak percobaan login gagal (5 kali). Akun dikunci sementara selama 15 menit.'
      );
    END IF;

    RETURN jsonb_build_object('status', 'invalid', 'message', 'Username atau kata sandi tidak sesuai.');
  END IF;

  IF v_emp.is_active = false THEN
    RETURN jsonb_build_object(
      'status', 'inactive',
      'message', format('Akun karyawan "%s" (@%s) sedang berstatus Nonaktif. Hubungi Owner.', v_emp.full_name, v_emp.username)
    );
  END IF;

  DELETE FROM public.login_rate_limits WHERE username = v_clean_username;
  DELETE FROM public.app_sessions WHERE expires_at < now();

  v_token := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.app_sessions (token, employee_id, role, expires_at)
  VALUES (v_token, v_emp.id, v_emp.role::text, now() + interval '7 days');

  INSERT INTO public.login_audit_logs (employee_id, username, employee_name, role, owner_email)
  VALUES (v_emp.id, v_emp.username, v_emp.full_name, v_emp.role::text, 'parisramaproject@gmail.com');

  RETURN jsonb_build_object(
    'status', 'ok',
    'session_token', v_token,
    'employee', (to_jsonb(v_emp) - 'password_hash') || jsonb_build_object('has_password', true)
  );
END;
$$;

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

  UPDATE public.app_sessions
  SET expires_at = now() + interval '7 days'
  WHERE token = v_token;

  RETURN jsonb_build_object(
    'status', 'ok',
    'employee', (to_jsonb(v_emp) - 'password_hash') || jsonb_build_object('has_password', true)
  );
END;
$$;

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

CREATE OR REPLACE FUNCTION public.revoke_all_employee_sessions(
  p_employee_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF NOT public.is_active_owner() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Hanya Owner aktif yang dapat mencabut sesi karyawan.');
  END IF;

  IF p_employee_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ID karyawan tidak valid.');
  END IF;

  DELETE FROM public.app_sessions WHERE employee_id = p_employee_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'revoked_count', v_deleted);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_employee_username_credentials(
  p_email text,
  p_username text,
  p_password text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean_email text;
  v_clean_username text;
  v_emp_id uuid;
BEGIN
  IF NOT public.is_active_owner() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Hanya Owner aktif yang dapat mengatur username & kata sandi karyawan.');
  END IF;

  v_clean_email := lower(trim(coalesce(p_email, '')));
  v_clean_username := nullif(lower(trim(regexp_replace(coalesce(p_username, ''), '^@+', ''))), '');

  IF v_clean_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Email karyawan wajib diisi.');
  END IF;

  IF v_clean_username IS NOT NULL AND length(v_clean_username) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Username minimal 3 karakter.');
  END IF;

  IF p_password IS NOT NULL AND trim(p_password) <> '' AND length(trim(p_password)) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Kata sandi minimal 8 karakter.');
  END IF;

  IF v_clean_username IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE lower(trim(coalesce(e.username, ''))) = v_clean_username
      AND lower(trim(e.email)) <> v_clean_email
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', format('Username "@%s" sudah dipakai karyawan lain.', v_clean_username));
  END IF;

  UPDATE public.employees
  SET
    username = v_clean_username,
    password_hash = CASE
      WHEN v_clean_username IS NULL THEN NULL
      WHEN p_password IS NOT NULL AND trim(p_password) <> '' THEN crypt(p_password, gen_salt('bf', 10))
      ELSE password_hash
    END
  WHERE lower(trim(email)) = v_clean_email
  RETURNING id INTO v_emp_id;

  IF v_emp_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Data karyawan tidak ditemukan di tabel employees. Simpan data karyawan ke Supabase terlebih dahulu.');
  END IF;

  IF v_clean_username IS NULL OR (p_password IS NOT NULL AND trim(p_password) <> '') THEN
    DELETE FROM public.app_sessions
    WHERE employee_id = v_emp_id
      AND token <> coalesce(public.get_app_session_token(), '');
  END IF;
  IF v_clean_username IS NOT NULL THEN
    DELETE FROM public.login_rate_limits WHERE username = v_clean_username;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_all_employees_for_owner()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public.is_active_owner() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Hanya Owner aktif yang dapat membaca seluruh daftar karyawan.');
  END IF;

  SELECT coalesce(
    jsonb_agg(
      (to_jsonb(e) - 'password_hash')
      || jsonb_build_object('has_password', (e.password_hash IS NOT NULL AND e.password_hash <> ''))
      ORDER BY e.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.employees e;

  RETURN jsonb_build_object('ok', true, 'employees', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_employee_by_owner(
  p_id uuid DEFAULT NULL,
  p_previous_email text DEFAULT NULL,
  p_full_name text DEFAULT 'Karyawan',
  p_email text DEFAULT '',
  p_username text DEFAULT NULL,
  p_role text DEFAULT 'cashier',
  p_phone_number text DEFAULT '-',
  p_is_active boolean DEFAULT true,
  p_shift text DEFAULT 'Shift Pagi (07:00 - 15:00)',
  p_position text DEFAULT 'Barista & Kasir',
  p_employment_status text DEFAULT 'Kontrak',
  p_monthly_salary numeric DEFAULT 0,
  p_join_date date DEFAULT current_date,
  p_emergency_contact text DEFAULT '',
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_email text;
  v_clean_prev_email text;
  v_clean_username text;
  v_clean_role text;
  v_existing_id uuid;
  v_saved public.employees%ROWTYPE;
BEGIN
  IF NOT public.is_active_owner() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Hanya Owner aktif yang dapat menambah atau mengubah data karyawan.');
  END IF;

  v_clean_email := lower(trim(coalesce(p_email, '')));
  v_clean_prev_email := nullif(lower(trim(coalesce(p_previous_email, ''))), '');
  v_clean_username := nullif(lower(trim(regexp_replace(coalesce(p_username, ''), '^@+', ''))), '');
  v_clean_role := CASE
    WHEN lower(trim(coalesce(p_role, ''))) IN ('owner', 'manager', 'cashier') THEN lower(trim(p_role))
    ELSE 'cashier'
  END;

  IF v_clean_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Email karyawan wajib diisi.');
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.employees WHERE id = p_id LIMIT 1;
  END IF;
  IF v_existing_id IS NULL AND v_clean_prev_email IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM public.employees WHERE lower(trim(email)) = v_clean_prev_email LIMIT 1;
  END IF;
  IF v_existing_id IS NULL THEN
    SELECT id INTO v_existing_id FROM public.employees WHERE lower(trim(email)) = v_clean_email LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.employees
    SET
      full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
      email = v_clean_email,
      username = CASE WHEN p_username IS NULL THEN username ELSE v_clean_username END,
      role = v_clean_role,
      phone_number = coalesce(nullif(trim(p_phone_number), ''), '-'),
      is_active = coalesce(p_is_active, true),
      shift = coalesce(p_shift, shift),
      position = coalesce(p_position, position),
      employment_status = coalesce(p_employment_status, employment_status),
      monthly_salary = coalesce(p_monthly_salary, 0),
      join_date = coalesce(p_join_date, join_date),
      emergency_contact = coalesce(p_emergency_contact, ''),
      notes = coalesce(p_notes, '')
    WHERE id = v_existing_id
    RETURNING * INTO v_saved;

    IF v_saved.is_active = false THEN
      DELETE FROM public.app_sessions WHERE employee_id = v_saved.id;
    END IF;
  ELSE
    INSERT INTO public.employees (
      full_name, email, username, role, phone_number, is_active, shift,
      position, employment_status, monthly_salary, join_date, emergency_contact, notes
    )
    VALUES (
      coalesce(nullif(trim(p_full_name), ''), 'Karyawan'),
      v_clean_email,
      v_clean_username,
      v_clean_role,
      coalesce(nullif(trim(p_phone_number), ''), '-'),
      coalesce(p_is_active, true),
      coalesce(p_shift, 'Shift Pagi (07:00 - 15:00)'),
      coalesce(p_position, 'Barista & Kasir'),
      coalesce(p_employment_status, 'Kontrak'),
      coalesce(p_monthly_salary, 0),
      coalesce(p_join_date, current_date),
      coalesce(p_emergency_contact, ''),
      coalesce(p_notes, '')
    )
    RETURNING * INTO v_saved;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'employee', (to_jsonb(v_saved) - 'password_hash') || jsonb_build_object('has_password', (v_saved.password_hash IS NOT NULL AND v_saved.password_hash <> ''))
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Email atau username sudah digunakan karyawan lain di Supabase.');
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_employee_by_owner(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_email text;
BEGIN
  IF NOT public.is_active_owner() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Hanya Owner aktif yang dapat menghapus karyawan.');
  END IF;

  v_clean_email := lower(trim(coalesce(p_email, '')));
  IF v_clean_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Email karyawan tidak valid.');
  END IF;

  DELETE FROM public.employees WHERE lower(trim(email)) = v_clean_email;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Proteksi kolom `password_hash` di level PostgreSQL privilege
GRANT USAGE ON SCHEMA public TO anon, authenticated;
REVOKE ALL ON public.employees FROM anon, authenticated;
GRANT SELECT (
  id, auth_user_id, full_name, email, username, role, phone_number,
  is_active, shift, position, employment_status, monthly_salary,
  join_date, emergency_contact, notes, created_at
) ON public.employees TO anon, authenticated;
GRANT INSERT (
  full_name, email, username, role, phone_number, is_active, shift,
  position, employment_status, monthly_salary, join_date, emergency_contact, notes
) ON public.employees TO anon, authenticated;
GRANT UPDATE (
  full_name, email, username, role, phone_number, is_active, shift,
  position, employment_status, monthly_salary, join_date, emergency_contact, notes
) ON public.employees TO anon, authenticated;
GRANT DELETE ON public.employees TO anon, authenticated;

GRANT SELECT ON public.login_audit_logs TO anon, authenticated;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can read login audit logs" ON public.login_audit_logs;
CREATE POLICY "Owner can read login audit logs"
  ON public.login_audit_logs FOR SELECT TO anon, authenticated
  USING (public.is_active_owner());

DROP POLICY IF EXISTS "Employees read own or owner reads all" ON public.employees;
CREATE POLICY "Employees read own or owner reads all"
  ON public.employees FOR SELECT TO anon, authenticated
  USING (id = public.get_current_employee_id() OR public.is_active_owner());

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

-- Seed akun Owner default (hanya jika belum ada)
INSERT INTO public.employees (full_name, email, role, phone_number, is_active, shift, position, employment_status)
VALUES
  ('Owner BrewFlow', 'parisramaproject@gmail.com', 'owner', '0812-8800-1101', true, 'Full Access', 'Owner & Founder', 'Tetap')
ON CONFLICT (email) DO NOTHING;

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
-- 6. TABEL TRANSAKSI POS (ORDERS, ORDER_ITEMS, DAILY SEQUENCE)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_order_counters (
  order_date date PRIMARY KEY,
  last_seq integer NOT NULL DEFAULT 0
);
ALTER TABLE public.daily_order_counters ENABLE ROW LEVEL SECURITY;

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
  voucher_code text,
  voucher_discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  points_earned integer NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash',
  status text NOT NULL DEFAULT 'completed',
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cashier_name text DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS notes text DEFAULT '';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS voucher_code text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS voucher_discount_amount numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS points_earned integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_id uuid REFERENCES public.menus(id) ON DELETE SET NULL,
  menu_name text DEFAULT '',
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  unit_hpp numeric(14,2) NOT NULL DEFAULT 0,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  notes text
);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS menu_name text DEFAULT '';
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS unit_hpp numeric(14,2) NOT NULL DEFAULT 0;
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

-- Lepas FK ketat pada performed_by / cashier_id / purchased_by jika berasal dari skema lama
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
-- 9. PENGATURAN TOKO, PROGRAM MEMBERSHIP, DISPLAY TV STORE, VOUCHER
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

CREATE TABLE IF NOT EXISTS public.vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text DEFAULT '',
  scheme_type text NOT NULL DEFAULT 'percentage_discount'
    CHECK (scheme_type IN ('percentage_discount', 'fixed_discount', 'special_item_price', 'buy_x_get_y', 'bundle_price')),
  discount_percent numeric(6,2) DEFAULT 0,
  max_discount_amount numeric(14,2) DEFAULT 0,
  discount_amount numeric(14,2) DEFAULT 0,
  special_price numeric(14,2) DEFAULT 0,
  buy_quantity integer DEFAULT 1,
  free_quantity integer DEFAULT 1,
  bundle_quantity integer DEFAULT 2,
  bundle_price numeric(14,2) DEFAULT 0,
  target_menu_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  min_purchase_amount numeric(14,2) NOT NULL DEFAULT 0,
  valid_from_date date NOT NULL DEFAULT current_date,
  valid_until_date date NOT NULL DEFAULT (current_date + interval '30 days')::date,
  start_time text NOT NULL DEFAULT '00:00',
  end_time text NOT NULL DEFAULT '23:59',
  active_days jsonb NOT NULL DEFAULT '[0,1,2,3,4,5,6]'::jsonb,
  max_usage_quota integer NOT NULL DEFAULT 0,
  used_count integer NOT NULL DEFAULT 0,
  stackable_with_member_discount boolean NOT NULL DEFAULT false,
  is_rush_hour boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by_name text DEFAULT 'Owner',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 9B. TABEL MULTI-PERANGKAT: VENDOR, RESTOCK REQUEST, NOTIFIKASI, WHATSAPP LOGS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_person text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  category_type text NOT NULL DEFAULT 'raw_material',
  supplied_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  address text DEFAULT '',
  payment_terms text DEFAULT 'Cash / Transfer',
  notes text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS phone text DEFAULT '';
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS category_type text NOT NULL DEFAULT 'raw_material';

CREATE TABLE IF NOT EXISTS public.restock_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  unit text DEFAULT 'pcs',
  current_stock numeric(14,2) NOT NULL DEFAULT 0,
  requested_quantity numeric(14,2) NOT NULL DEFAULT 1,
  urgency text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal', 'urgent')),
  notes text DEFAULT '',
  requested_by_id text DEFAULT '',
  requested_by_name text NOT NULL DEFAULT 'Kasir',
  requested_by_role text NOT NULL DEFAULT 'cashier',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ordered', 'completed')),
  handled_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.restock_requests ADD COLUMN IF NOT EXISTS handled_by_name text;
ALTER TABLE public.restock_requests ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.operational_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'owner_message',
  title text NOT NULL,
  message text NOT NULL,
  target_page text DEFAULT 'dashboard',
  target_roles jsonb NOT NULL DEFAULT '["owner","manager","cashier"]'::jsonb,
  sender_name text DEFAULT 'BrewFlow System',
  sender_role text DEFAULT 'owner',
  restock_request_id text,
  unread boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  targets jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview text NOT NULL DEFAULT '',
  mode text NOT NULL DEFAULT 'edge_function',
  status text NOT NULL DEFAULT 'sent',
  error text,
  sent_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 10. RPC AMAN UNTUK KASIR & OPERASI POS ATOMIK (ANTI RACE-CONDITION)
-- -----------------------------------------------------------------------------

-- 10a. Stok aman untuk Kasir (tanpa kolom harga modal `last_purchase_price`)
CREATE OR REPLACE FUNCTION public.get_pos_stock_levels()
RETURNS TABLE (
  id uuid,
  name text,
  sku text,
  category_type text,
  expense_category text,
  unit text,
  current_stock numeric,
  min_stock_threshold numeric,
  asset_condition text,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_employee() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    i.id,
    i.name,
    i.sku,
    i.category_type,
    i.expense_category,
    i.unit,
    i.current_stock,
    i.min_stock_threshold,
    i.asset_condition,
    i.updated_at
  FROM public.inventory_items i
  ORDER BY i.name ASC;
END;
$$;

-- 10b. Pengaturan toko aman untuk Kasir (tanpa nomor WA privat Owner / email alert / URL gateway)
CREATE OR REPLACE FUNCTION public.get_pos_store_settings()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.store_settings%ROWTYPE;
BEGIN
  IF NOT public.is_active_employee() THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row FROM public.store_settings WHERE id = 'default' LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'shop_name', v_row.shop_name,
    'address', v_row.address,
    'phone', v_row.phone,
    'customer_service_contact', v_row.customer_service_contact,
    'shop_logo_url', v_row.shop_logo_url,
    'tax_enabled', v_row.tax_enabled,
    'tax_percent', v_row.tax_percent,
    'tax_label', v_row.tax_label,
    'receipt_paper_width', v_row.receipt_paper_width,
    'receipt_header_text', v_row.receipt_header_text,
    'receipt_footer_text', v_row.receipt_footer_text,
    'receipt_show_logo', v_row.receipt_show_logo,
    'receipt_show_cashier_and_table', v_row.receipt_show_cashier_and_table,
    'receipt_show_member_info', v_row.receipt_show_member_info,
    'receipt_show_customer_service', v_row.receipt_show_customer_service
  );
END;
$$;

-- 10c. Generator nomor pesanan harian atomik: BF-YYMMDD-NNN (zona waktu WIB / Asia/Jakarta)
CREATE OR REPLACE FUNCTION public.next_order_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date;
  v_prefix text;
  v_existing_max integer := 0;
  v_seq integer;
BEGIN
  v_today := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_prefix := 'BF-' || to_char(v_today, 'YYMMDD') || '-';

  INSERT INTO public.daily_order_counters (order_date, last_seq)
  VALUES (v_today, 0)
  ON CONFLICT (order_date) DO NOTHING;

  SELECT last_seq INTO v_seq
  FROM public.daily_order_counters
  WHERE order_date = v_today
  FOR UPDATE;

  SELECT coalesce(max(substring(o.order_number FROM '([0-9]+)$')::integer), 0)
  INTO v_existing_max
  FROM public.orders o
  WHERE o.order_number LIKE (v_prefix || '%');

  v_seq := GREATEST(coalesce(v_seq, 0), v_existing_max) + 1;

  UPDATE public.daily_order_counters
  SET last_seq = v_seq
  WHERE order_date = v_today;

  RETURN v_prefix || lpad(v_seq::text, 3, '0');
END;
$$;

-- 10d. Checkout Atomik: 1 transaksi penuh untuk orders + order_items (unit_hpp historis) + potong stok relatif + poin member + kuota voucher
CREATE OR REPLACE FUNCTION public.checkout_order_atomic(
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_id uuid;
  v_order_number text;
  v_order_id uuid;
  v_status text;
  v_customer_id uuid;
  v_voucher_code text;
  v_points_earned integer;
  v_total_amount numeric(14,2);
  v_next_tier text;
  v_item jsonb;
  v_menu_uuid uuid;
  v_qty integer;
  v_unit_hpp numeric(14,2);
  v_deduction jsonb;
  v_inv_uuid uuid;
  v_used_qty numeric(14,2);
  v_voucher_updated integer := 0;
BEGIN
  IF NOT public.is_active_employee() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sesi tidak valid atau karyawan tidak aktif.');
  END IF;

  v_emp_id := public.get_current_employee_id();
  v_status := coalesce(nullif(trim(p_payload->>'status'), ''), 'completed');
  IF v_status NOT IN ('completed', 'draft', 'cancelled') THEN
    v_status := 'completed';
  END IF;

  v_order_number := public.next_order_number();
  v_total_amount := coalesce((p_payload->>'total_amount')::numeric, 0);
  v_points_earned := GREATEST(0, coalesce((p_payload->>'points_earned')::integer, 0));
  v_voucher_code := nullif(upper(trim(coalesce(p_payload->>'voucher_code', ''))), '');
  v_next_tier := nullif(trim(coalesce(p_payload->>'next_tier', '')), '');

  BEGIN
    v_customer_id := nullif(trim(coalesce(p_payload->>'customer_id', '')), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_customer_id := NULL;
  END;

  -- Jika ada voucher pada transaksi completed, validasi & naikkan kuota atomik sebelum insert order
  IF v_status = 'completed' AND v_voucher_code IS NOT NULL THEN
    UPDATE public.vouchers
    SET used_count = used_count + 1
    WHERE upper(trim(code)) = v_voucher_code
      AND is_active = true
      AND (max_usage_quota = 0 OR used_count < max_usage_quota);
    GET DIAGNOSTICS v_voucher_updated = ROW_COUNT;

    IF v_voucher_updated = 0 AND EXISTS (SELECT 1 FROM public.vouchers WHERE upper(trim(code)) = v_voucher_code) THEN
      RETURN jsonb_build_object('ok', false, 'error', format('Kuota voucher %s sudah habis atau tidak aktif.', v_voucher_code));
    END IF;
  END IF;

  INSERT INTO public.orders (
    order_number,
    cashier_id,
    cashier_name,
    customer_id,
    customer_name,
    order_type,
    table_number,
    subtotal,
    discount_amount,
    voucher_code,
    voucher_discount_amount,
    tax_amount,
    total_amount,
    points_earned,
    payment_method,
    status,
    notes
  )
  VALUES (
    v_order_number,
    v_emp_id,
    coalesce(p_payload->>'cashier_name', 'Kasir'),
    v_customer_id,
    nullif(p_payload->>'customer_name', ''),
    coalesce(nullif(p_payload->>'order_type', ''), 'dine_in'),
    coalesce(p_payload->>'table_number', ''),
    coalesce((p_payload->>'subtotal')::numeric, 0),
    coalesce((p_payload->>'discount_amount')::numeric, 0),
    v_voucher_code,
    coalesce((p_payload->>'voucher_discount_amount')::numeric, 0),
    coalesce((p_payload->>'tax_amount')::numeric, 0),
    v_total_amount,
    v_points_earned,
    coalesce(nullif(p_payload->>'payment_method', ''), 'cash'),
    v_status,
    coalesce(p_payload->>'notes', '')
  )
  RETURNING id INTO v_order_id;

  -- Insert order_items + hitung unit_hpp historis langsung dari resep di server (aman untuk role Kasir)
  FOR v_item IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb))
  LOOP
    v_qty := GREATEST(1, coalesce((v_item->>'quantity')::integer, 1));
    v_menu_uuid := NULL;
    BEGIN
      v_menu_uuid := nullif(trim(coalesce(v_item->>'menu_id', '')), '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_menu_uuid := NULL;
    END;

    v_unit_hpp := coalesce((v_item->>'unit_hpp')::numeric, 0);
    IF v_menu_uuid IS NOT NULL THEN
      SELECT coalesce(round(sum(mr.quantity_needed * coalesce(ii.last_purchase_price, 0))::numeric, 2), v_unit_hpp)
      INTO v_unit_hpp
      FROM public.menu_recipes mr
      JOIN public.inventory_items ii ON ii.id = mr.inventory_item_id
      WHERE mr.menu_id = v_menu_uuid;
    END IF;

    INSERT INTO public.order_items (
      order_id, menu_id, menu_name, quantity, unit_price, unit_hpp, subtotal, notes
    )
    VALUES (
      v_order_id,
      v_menu_uuid,
      coalesce(v_item->>'menu_name', 'Menu'),
      v_qty,
      coalesce((v_item->>'unit_price')::numeric, 0),
      coalesce(v_unit_hpp, 0),
      coalesce((v_item->>'subtotal')::numeric, 0),
      nullif(v_item->>'notes', '')
    );

    -- Potong stok bahan baku secara relatif (anti lost-update) jika pesanan completed
    IF v_status = 'completed' AND v_menu_uuid IS NOT NULL THEN
      UPDATE public.inventory_items ii
      SET
        current_stock = GREATEST(0, round((ii.current_stock - (mr.quantity_needed * v_qty))::numeric, 2)),
        updated_at = now()
      FROM public.menu_recipes mr
      WHERE mr.menu_id = v_menu_uuid
        AND ii.id = mr.inventory_item_id;
    END IF;
  END LOOP;

  -- Fallback potongan stok eksplisit jika item tidak punya menu_id UUID di DB
  IF v_status = 'completed' AND jsonb_array_length(coalesce(p_payload->'fallback_deductions', '[]'::jsonb)) > 0 THEN
    FOR v_deduction IN SELECT * FROM jsonb_array_elements(p_payload->'fallback_deductions')
    LOOP
      BEGIN
        v_inv_uuid := (v_deduction->>'inventory_item_id')::uuid;
        v_used_qty := GREATEST(0, coalesce((v_deduction->>'quantity_deducted')::numeric, 0));
        IF v_used_qty > 0 THEN
          UPDATE public.inventory_items
          SET
            current_stock = GREATEST(0, round((current_stock - v_used_qty)::numeric, 2)),
            updated_at = now()
          WHERE id = v_inv_uuid;
        END IF;
      EXCEPTION WHEN invalid_text_representation THEN
        NULL;
      END;
    END LOOP;
  END IF;

  -- Perbarui poin & total belanja member secara relatif
  IF v_status = 'completed' AND v_customer_id IS NOT NULL THEN
    UPDATE public.customers
    SET
      points = GREATEST(0, points + v_points_earned),
      total_spent = GREATEST(0, total_spent + v_total_amount),
      tier = coalesce(v_next_tier, tier)
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_order_id,
    'order_number', v_order_number
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- 10e. Pembatalan Pesanan Atomik: ubah status -> pulihkan stok resep -> balikkan poin/belanja member -> pulihkan kuota voucher
CREATE OR REPLACE FUNCTION public.cancel_order_atomic(
  p_order_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_next_notes text;
  v_item record;
BEGIN
  IF NOT public.is_active_employee() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sesi tidak valid atau karyawan tidak aktif.');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pesanan tidak ditemukan.');
  END IF;

  IF v_order.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'already_cancelled', true);
  END IF;

  v_next_notes := CASE
    WHEN p_reason IS NOT NULL AND trim(p_reason) <> '' THEN trim(p_reason)
    ELSE v_order.notes
  END;

  UPDATE public.orders
  SET
    status = 'cancelled',
    notes = coalesce(v_next_notes, notes)
  WHERE id = p_order_id;

  IF v_order.status = 'completed' THEN
    -- 1. Pulihkan stok bahan baku sesuai resep setiap item pesanan
    FOR v_item IN
      SELECT oi.menu_id, oi.quantity
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
        AND oi.menu_id IS NOT NULL
    LOOP
      UPDATE public.inventory_items ii
      SET
        current_stock = round((ii.current_stock + (mr.quantity_needed * v_item.quantity))::numeric, 2),
        updated_at = now()
      FROM public.menu_recipes mr
      WHERE mr.menu_id = v_item.menu_id
        AND ii.id = mr.inventory_item_id;
    END LOOP;

    -- 2. Balikkan poin & total belanja member
    IF v_order.customer_id IS NOT NULL THEN
      UPDATE public.customers
      SET
        points = GREATEST(0, points - coalesce(v_order.points_earned, 0)),
        total_spent = GREATEST(0, total_spent - coalesce(v_order.total_amount, 0))
      WHERE id = v_order.customer_id;
    END IF;

    -- 3. Pulihkan kuota voucher jika ada
    IF v_order.voucher_code IS NOT NULL AND trim(v_order.voucher_code) <> '' THEN
      UPDATE public.vouchers
      SET used_count = GREATEST(0, used_count - 1)
      WHERE upper(trim(code)) = upper(trim(v_order.voucher_code));
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'restored_stock', v_order.status = 'completed');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

-- Izinkan eksekusi fungsi helper & RPC oleh anon/authenticated (validasi role dilakukan di dalam fungsi)
GRANT EXECUTE ON FUNCTION public.get_app_session_token() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_employee_role() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_employee_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_employee() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_manager_or_owner() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_owner() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_employee_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.authenticate_employee_username(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_session_profile() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_app_session() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_all_employee_sessions(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_employee_username_credentials(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_all_employees_for_owner() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_employee_by_owner(uuid, text, text, text, text, text, text, boolean, text, text, text, numeric, date, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_employee_by_owner(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pos_stock_levels() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pos_store_settings() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_order_number() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_order_atomic(jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order_atomic(uuid, text) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 11. STRICT RLS PER-ROLE (OWNER vs MANAGER vs CASHIER)
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
    'store_videos',
    'vouchers',
    'vendors',
    'restock_requests',
    'operational_notifications',
    'whatsapp_logs'
  ]
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Active staff full access" ON public.%I', t);
  END LOOP;
END $$;

-- A. Master katalog & promo: semua staf baca; hanya Owner/Manager ubah
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories',
    'menus',
    'menu_recipes',
    'vouchers',
    'membership_program_settings',
    'store_videos',
    'stock_opname_schedules'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Staff read catalog" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Staff read catalog" ON public.%I FOR SELECT TO anon, authenticated USING (public.is_active_employee())', t);

    EXECUTE format('DROP POLICY IF EXISTS "Manager/Owner manage catalog" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Manager/Owner manage catalog" ON public.%I FOR ALL TO anon, authenticated USING (public.is_active_manager_or_owner()) WITH CHECK (public.is_active_manager_or_owner())', t);
  END LOOP;
END $$;

-- B. Data biaya sensitif (Inventori penuh termasuk HPP/harga beli, Pembelian, Vendor): HANYA Owner & Manager!
--    Kasir membaca ketersediaan stok lewat RPC aman `get_pos_stock_levels()` (tanpa last_purchase_price).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inventory_items',
    'purchases',
    'purchase_items',
    'vendors'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Manager/Owner manage cost data" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Manager/Owner manage cost data" ON public.%I FOR ALL TO anon, authenticated USING (public.is_active_manager_or_owner()) WITH CHECK (public.is_active_manager_or_owner())', t);
  END LOOP;
END $$;

-- C. Pengaturan Toko (memuat nomor WA Owner/Manager & email alert): baca/ubah terbatas!
--    Kasir membaca konfigurasi struk & pajak lewat RPC aman `get_pos_store_settings()`.
DROP POLICY IF EXISTS "Manager/Owner read store_settings" ON public.store_settings;
CREATE POLICY "Manager/Owner read store_settings"
  ON public.store_settings FOR SELECT TO anon, authenticated
  USING (public.is_active_manager_or_owner());

DROP POLICY IF EXISTS "Owner manage store_settings" ON public.store_settings;
CREATE POLICY "Owner manage store_settings"
  ON public.store_settings FOR ALL TO anon, authenticated
  USING (public.is_active_owner()) WITH CHECK (public.is_active_owner());

-- D. Transaksi POS (orders & order_items): Kasir boleh baca & buat transaksi; edit/hapus hanya draft atau Manager/Owner
DROP POLICY IF EXISTS "Staff read orders" ON public.orders;
CREATE POLICY "Staff read orders"
  ON public.orders FOR SELECT TO anon, authenticated
  USING (public.is_active_employee());

DROP POLICY IF EXISTS "Staff insert orders" ON public.orders;
CREATE POLICY "Staff insert orders"
  ON public.orders FOR INSERT TO anon, authenticated
  WITH CHECK (public.is_active_employee());

DROP POLICY IF EXISTS "Manager/Owner or draft update orders" ON public.orders;
CREATE POLICY "Manager/Owner or draft update orders"
  ON public.orders FOR UPDATE TO anon, authenticated
  USING (public.is_active_manager_or_owner() OR (public.is_active_employee() AND status = 'draft'))
  WITH CHECK (public.is_active_employee());

DROP POLICY IF EXISTS "Manager/Owner or draft delete orders" ON public.orders;
CREATE POLICY "Manager/Owner or draft delete orders"
  ON public.orders FOR DELETE TO anon, authenticated
  USING (public.is_active_manager_or_owner() OR (public.is_active_employee() AND status = 'draft'));

DROP POLICY IF EXISTS "Staff read order_items" ON public.order_items;
CREATE POLICY "Staff read order_items"
  ON public.order_items FOR SELECT TO anon, authenticated
  USING (public.is_active_employee());

DROP POLICY IF EXISTS "Staff insert order_items" ON public.order_items;
CREATE POLICY "Staff insert order_items"
  ON public.order_items FOR INSERT TO anon, authenticated
  WITH CHECK (public.is_active_employee());

DROP POLICY IF EXISTS "Manager/Owner modify order_items" ON public.order_items;
CREATE POLICY "Manager/Owner modify order_items"
  ON public.order_items FOR ALL TO anon, authenticated
  USING (public.is_active_manager_or_owner()) WITH CHECK (public.is_active_manager_or_owner());

-- E. Pelanggan & Penukaran Poin: Kasir boleh baca/tambah/edit; hapus hanya Owner/Manager
DROP POLICY IF EXISTS "Staff read customers" ON public.customers;
CREATE POLICY "Staff read customers"
  ON public.customers FOR SELECT TO anon, authenticated USING (public.is_active_employee());
DROP POLICY IF EXISTS "Staff insert customers" ON public.customers;
CREATE POLICY "Staff insert customers"
  ON public.customers FOR INSERT TO anon, authenticated WITH CHECK (public.is_active_employee());
DROP POLICY IF EXISTS "Staff update customers" ON public.customers;
CREATE POLICY "Staff update customers"
  ON public.customers FOR UPDATE TO anon, authenticated USING (public.is_active_employee()) WITH CHECK (public.is_active_employee());
DROP POLICY IF EXISTS "Manager/Owner delete customers" ON public.customers;
CREATE POLICY "Manager/Owner delete customers"
  ON public.customers FOR DELETE TO anon, authenticated USING (public.is_active_manager_or_owner());

DROP POLICY IF EXISTS "Staff read redemptions" ON public.member_redemption_logs;
CREATE POLICY "Staff read redemptions"
  ON public.member_redemption_logs FOR SELECT TO anon, authenticated USING (public.is_active_employee());
DROP POLICY IF EXISTS "Staff insert redemptions" ON public.member_redemption_logs;
CREATE POLICY "Staff insert redemptions"
  ON public.member_redemption_logs FOR INSERT TO anon, authenticated WITH CHECK (public.is_active_employee());
DROP POLICY IF EXISTS "Manager/Owner manage redemptions" ON public.member_redemption_logs;
CREATE POLICY "Manager/Owner manage redemptions"
  ON public.member_redemption_logs FOR DELETE TO anon, authenticated USING (public.is_active_manager_or_owner());

-- F. Log Stock Opname: staf boleh baca & kirim hasil hitung; edit/hapus hanya Owner/Manager
DROP POLICY IF EXISTS "Staff read opname logs" ON public.stock_opname_logs;
CREATE POLICY "Staff read opname logs"
  ON public.stock_opname_logs FOR SELECT TO anon, authenticated USING (public.is_active_employee());
DROP POLICY IF EXISTS "Staff insert opname logs" ON public.stock_opname_logs;
CREATE POLICY "Staff insert opname logs"
  ON public.stock_opname_logs FOR INSERT TO anon, authenticated WITH CHECK (public.is_active_employee());
DROP POLICY IF EXISTS "Manager/Owner modify opname logs" ON public.stock_opname_logs;
CREATE POLICY "Manager/Owner modify opname logs"
  ON public.stock_opname_logs FOR UPDATE TO anon, authenticated USING (public.is_active_manager_or_owner()) WITH CHECK (public.is_active_manager_or_owner());
DROP POLICY IF EXISTS "Manager/Owner delete opname logs" ON public.stock_opname_logs;
CREATE POLICY "Manager/Owner delete opname logs"
  ON public.stock_opname_logs FOR DELETE TO anon, authenticated USING (public.is_active_manager_or_owner());

DROP POLICY IF EXISTS "Staff read opname details" ON public.stock_opname_details;
CREATE POLICY "Staff read opname details"
  ON public.stock_opname_details FOR SELECT TO anon, authenticated USING (public.is_active_employee());
DROP POLICY IF EXISTS "Staff insert opname details" ON public.stock_opname_details;
CREATE POLICY "Staff insert opname details"
  ON public.stock_opname_details FOR INSERT TO anon, authenticated WITH CHECK (public.is_active_employee());
DROP POLICY IF EXISTS "Manager/Owner manage opname details" ON public.stock_opname_details;
CREATE POLICY "Manager/Owner manage opname details"
  ON public.stock_opname_details FOR DELETE TO anon, authenticated USING (public.is_active_manager_or_owner());

-- G. Pengajuan Restock: Kasir boleh baca & mengajukan; hanya Owner/Manager yang menyetujui/menolak
DROP POLICY IF EXISTS "Staff read restock_requests" ON public.restock_requests;
CREATE POLICY "Staff read restock_requests"
  ON public.restock_requests FOR SELECT TO anon, authenticated USING (public.is_active_employee());
DROP POLICY IF EXISTS "Staff insert restock_requests" ON public.restock_requests;
CREATE POLICY "Staff insert restock_requests"
  ON public.restock_requests FOR INSERT TO anon, authenticated WITH CHECK (public.is_active_employee());
DROP POLICY IF EXISTS "Manager/Owner update restock_requests" ON public.restock_requests;
CREATE POLICY "Manager/Owner update restock_requests"
  ON public.restock_requests FOR UPDATE TO anon, authenticated USING (public.is_active_manager_or_owner()) WITH CHECK (public.is_active_manager_or_owner());
DROP POLICY IF EXISTS "Manager/Owner delete restock_requests" ON public.restock_requests;
CREATE POLICY "Manager/Owner delete restock_requests"
  ON public.restock_requests FOR DELETE TO anon, authenticated USING (public.is_active_manager_or_owner());

-- H. Notifikasi Operasional: staf membaca notifikasi untuk role-nya (atau Owner melihat semua)
DROP POLICY IF EXISTS "Staff read operational_notifications" ON public.operational_notifications;
CREATE POLICY "Staff read operational_notifications"
  ON public.operational_notifications FOR SELECT TO anon, authenticated
  USING (
    public.is_active_owner()
    OR (
      public.is_active_employee()
      AND (
        target_roles ? public.get_current_employee_role()
        OR target_roles ? 'all'
      )
    )
  );
DROP POLICY IF EXISTS "Staff insert operational_notifications" ON public.operational_notifications;
CREATE POLICY "Staff insert operational_notifications"
  ON public.operational_notifications FOR INSERT TO anon, authenticated WITH CHECK (public.is_active_employee());
DROP POLICY IF EXISTS "Staff update operational_notifications" ON public.operational_notifications;
CREATE POLICY "Staff update operational_notifications"
  ON public.operational_notifications FOR UPDATE TO anon, authenticated USING (public.is_active_employee()) WITH CHECK (public.is_active_employee());
DROP POLICY IF EXISTS "Manager/Owner delete operational_notifications" ON public.operational_notifications;
CREATE POLICY "Manager/Owner delete operational_notifications"
  ON public.operational_notifications FOR DELETE TO anon, authenticated USING (public.is_active_manager_or_owner());

-- I. Log WhatsApp: staf boleh mencatat log struk; baca & hapus hanya Owner/Manager
DROP POLICY IF EXISTS "Manager/Owner read whatsapp_logs" ON public.whatsapp_logs;
CREATE POLICY "Manager/Owner read whatsapp_logs"
  ON public.whatsapp_logs FOR SELECT TO anon, authenticated USING (public.is_active_manager_or_owner());
DROP POLICY IF EXISTS "Staff insert whatsapp_logs" ON public.whatsapp_logs;
CREATE POLICY "Staff insert whatsapp_logs"
  ON public.whatsapp_logs FOR INSERT TO anon, authenticated WITH CHECK (public.is_active_employee());
DROP POLICY IF EXISTS "Manager/Owner delete whatsapp_logs" ON public.whatsapp_logs;
CREATE POLICY "Manager/Owner delete whatsapp_logs"
  ON public.whatsapp_logs FOR DELETE TO anon, authenticated USING (public.is_active_manager_or_owner());

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
-- 12. DATA AWAL OTOMATIS (HANYA DIISI JIKA TABEL MASIH KOSONG)
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
