-- BrewFlow POS — Skema Daftar Karyawan (Allowlist Email) untuk Supabase Google OAuth
-- Jalankan seluruh query ini di Supabase Dashboard -> SQL Editor.
-- Aman dijalankan berulang kali (idempotent) dan kompatibel dengan tabel `profiles` bawaan.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Tabel utama karyawan untuk verifikasi Google OAuth (bisa didaftarkan SEBELUM karyawan login pertama kali)
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
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

-- Normalisasi email otomatis ke huruf kecil + hapus spasi agar pencocokan selalu akurat
CREATE OR REPLACE FUNCTION public.normalize_employee_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_employee_email ON public.employees;
CREATE TRIGGER trg_normalize_employee_email
  BEFORE INSERT OR UPDATE OF email ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_employee_email();

-- 2. Fungsi helper RLS (SECURITY DEFINER agar tidak terjadi infinite recursion)
CREATE OR REPLACE FUNCTION public.is_active_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE lower(e.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      AND e.role = 'owner'
      AND e.is_active = true
  );
$$;

-- 3. Aktifkan Row Level Security (RLS) pada tabel employees
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- Karyawan yang login via Google/Email dapat membaca data dirinya sendiri; Owner aktif dapat membaca semua karyawan
DROP POLICY IF EXISTS "Employees read own or owner reads all" ON public.employees;
CREATE POLICY "Employees read own or owner reads all"
  ON public.employees
  FOR SELECT
  TO authenticated
  USING (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    OR public.is_active_owner()
  );

-- Hanya Owner aktif yang boleh menambah, mengubah, atau menghapus data karyawan
DROP POLICY IF EXISTS "Owner can insert employees" ON public.employees;
CREATE POLICY "Owner can insert employees"
  ON public.employees
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_active_owner());

DROP POLICY IF EXISTS "Owner can update employees" ON public.employees;
CREATE POLICY "Owner can update employees"
  ON public.employees
  FOR UPDATE
  TO authenticated
  USING (public.is_active_owner())
  WITH CHECK (public.is_active_owner());

DROP POLICY IF EXISTS "Owner can delete employees" ON public.employees;
CREATE POLICY "Owner can delete employees"
  ON public.employees
  FOR DELETE
  TO authenticated
  USING (public.is_active_owner());

-- 4. Seed akun Owner utama (ubah nama/email bila diperlukan)
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
VALUES (
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

-- 5. Sinkronisasi aman ke tabel `profiles` bawaan HANYA untuk user yang sudah pernah login di `auth.users`
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
    ON CONFLICT (id) DO UPDATE
    SET
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      phone_number = EXCLUDED.phone_number;
  END IF;
EXCEPTION
  WHEN undefined_object THEN
    -- Jika kolom profiles.role bertipe text (bukan enum user_role)
    INSERT INTO public.profiles (id, full_name, role, phone_number)
    SELECT
      u.id,
      e.full_name,
      e.role,
      e.phone_number
    FROM auth.users u
    JOIN public.employees e ON lower(e.email) = lower(u.email)
    ON CONFLICT (id) DO UPDATE
    SET
      full_name = EXCLUDED.full_name,
      role = EXCLUDED.role,
      phone_number = EXCLUDED.phone_number;
END $$;
