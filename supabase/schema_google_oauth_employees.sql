-- BrewFlow POS — Skema Daftar Karyawan (Google OAuth + Login Username & Password)
-- Jalankan seluruh query ini di Supabase Dashboard -> SQL Editor.
-- Aman dijalankan berulang kali (idempotent) dan kompatibel dengan tabel `profiles` bawaan.
-- Pembaruan Keamanan: Rate-limiting login, verifikasi email_confirmed_at, pencabutan SELECT
-- kolom password_hash, minimal kata sandi 8 karakter, serta RPC pencabutan semua sesi karyawan.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Tabel utama karyawan untuk verifikasi Google OAuth & Login Username/Password
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

-- Pastikan kolom username & password_hash ada jika tabel employees sudah dibuat sebelumnya
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS password_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS employees_username_lower_unique_idx
  ON public.employees (lower(trim(username)))
  WHERE username IS NOT NULL AND trim(username) <> '';

-- 1b. Tabel log audit login menggunakan username (termasuk status email konfirmasi ke Owner)
CREATE TABLE IF NOT EXISTS public.login_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  username text NOT NULL,
  employee_name text NOT NULL,
  role text NOT NULL,
  owner_email text NOT NULL DEFAULT 'parisramaproject@gmail.com',
  logged_in_at timestamptz NOT NULL DEFAULT now()
);

-- 1c. Tabel rate limiting percobaan login Username (maksimal 5 gagal -> kunci 15 menit)
CREATE TABLE IF NOT EXISTS public.login_rate_limits (
  username text PRIMARY KEY,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.login_rate_limits ENABLE ROW LEVEL SECURITY;

-- Normalisasi email & username otomatis ke huruf kecil + hapus spasi
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

-- Bersihkan spasi/huruf kapital pada data email/username yang sudah terlanjur dimasukkan manual
UPDATE public.employees
SET
  email = lower(trim(email)),
  username = CASE WHEN username IS NULL THEN NULL ELSE nullif(lower(trim(username)), '') END
WHERE email <> lower(trim(email))
   OR (username IS NOT NULL AND username <> lower(trim(username)));

-- 2. Tabel sesi login Username & fungsi helper RLS (SECURITY DEFINER agar tidak terjadi infinite recursion)
CREATE TABLE IF NOT EXISTS public.app_sessions (
  token text PRIMARY KEY,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  role text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;

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

-- Helper: mengembalikan role karyawan aktif saat ini ('owner', 'manager', 'cashier', atau NULL)
-- Memverifikasi `email_confirmed_at IS NOT NULL` untuk sesi JWT Supabase Auth agar email tak terverifikasi tidak bisa mencocokkan karyawan.
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

-- 2b. RPC SECURITY DEFINER untuk verifikasi login Google/Email (tidak pernah mengembalikan password_hash)
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

  IF v_result IS NULL AND to_regclass('public.profiles') IS NOT NULL THEN
    SELECT to_jsonb(p)
    INTO v_result
    FROM public.profiles p
    WHERE p.id = auth.uid()
    LIMIT 1;
  END IF;

  RETURN v_result;
END;
$$;

-- 2c. RPC SECURITY DEFINER untuk Login Username & Password (dengan rate limiting 5x / 15 menit)
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

  -- Periksa rate limit untuk username ini
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

  -- Reset counter percobaan gagal setelah berhasil login
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

-- 2c2. RPC SECURITY DEFINER untuk memulihkan sesi Username saat browser di-reload
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

-- 2c3. RPC bagi Owner untuk mencabut seluruh sesi aktif seorang karyawan (mis. saat perangkat hilang / resign)
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

-- 2d. RPC SECURITY DEFINER bagi Owner untuk mengatur/mengubah Username & Password karyawan (hash bcrypt di server)
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

  -- Jika password diubah atau username dicabut, cabut sesi lama perangkat lain & bersihkan rate limit
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

-- 2e. RPC SECURITY DEFINER bagi Owner untuk membaca, menyimpan/mengedit, dan menghapus data karyawan
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
      full_name,
      email,
      username,
      role,
      phone_number,
      is_active,
      shift,
      position,
      employment_status,
      monthly_salary,
      join_date,
      emergency_contact,
      notes
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

CREATE OR REPLACE FUNCTION public.delete_employee_by_owner(
  p_email text
)
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

-- Hak akses kolom ketat: kolom `password_hash` TIDAK PERNAH bisa dibaca via REST API oleh anon/authenticated!
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

-- 3. Aktifkan Row Level Security (RLS) pada tabel employees & login_audit_logs
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can read login audit logs" ON public.login_audit_logs;
CREATE POLICY "Owner can read login audit logs"
  ON public.login_audit_logs
  FOR SELECT
  TO anon, authenticated
  USING (public.is_active_owner());

DROP POLICY IF EXISTS "Employees read own or owner reads all" ON public.employees;
CREATE POLICY "Employees read own or owner reads all"
  ON public.employees
  FOR SELECT
  TO anon, authenticated
  USING (
    id = public.get_current_employee_id()
    OR public.is_active_owner()
  );

DROP POLICY IF EXISTS "Owner can insert employees" ON public.employees;
CREATE POLICY "Owner can insert employees"
  ON public.employees
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (public.is_active_owner());

DROP POLICY IF EXISTS "Owner can update employees" ON public.employees;
CREATE POLICY "Owner can update employees"
  ON public.employees
  FOR UPDATE
  TO anon, authenticated
  USING (public.is_active_owner())
  WITH CHECK (public.is_active_owner());

DROP POLICY IF EXISTS "Owner can delete employees" ON public.employees;
CREATE POLICY "Owner can delete employees"
  ON public.employees
  FOR DELETE
  TO anon, authenticated
  USING (public.is_active_owner());

-- 4. Seed akun Owner utama
INSERT INTO public.employees (
  full_name,
  email,
  role,
  phone_number,
  is_active,
  shift,
  position,
  employment_status
)
VALUES
  (
    'Owner BrewFlow',
    'parisramaproject@gmail.com',
    'owner',
    '0812-8800-1101',
    true,
    'Full Access',
    'Owner & Founder',
    'Tetap'
  ),
  (
    'Budi Santoso',
    'generalaffairhrandelajaya@gmail.com',
    'owner',
    '0812-8800-1101',
    true,
    'Full Access',
    'Owner & Founder',
    'Tetap'
  )
ON CONFLICT (email) DO UPDATE
SET
  role = 'owner',
  is_active = true;

-- 5. Sinkronisasi aman ke tabel `profiles` bawaan HANYA untuk user yang sudah terkonfirmasi
DO $$
BEGIN
  IF to_regclass('public.profiles') IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, role, phone_number)
    SELECT
      u.id,
      e.full_name,
      e.role::user_role,
      e.phone_number
    FROM auth.users u
    JOIN public.employees e ON lower(e.email) = lower(u.email)
    WHERE u.email_confirmed_at IS NOT NULL
    ON CONFLICT (id) DO UPDATE
    SET
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      phone_number = EXCLUDED.phone_number;
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    INSERT INTO public.profiles (id, full_name, role, phone_number)
    SELECT
      u.id,
      e.full_name,
      e.role,
      e.phone_number
    FROM auth.users u
    JOIN public.employees e ON lower(e.email) = lower(u.email)
    WHERE u.email_confirmed_at IS NOT NULL
    ON CONFLICT (id) DO UPDATE
    SET
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      phone_number = EXCLUDED.phone_number;
END $$;
