-- BrewFlow POS — Skema Employee Email Allowlist untuk Supabase Google OAuth
-- Jalankan SQL ini di Supabase Dashboard -> SQL Editor

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')) DEFAULT 'cashier',
  phone_number text DEFAULT '-',
  is_active boolean NOT NULL DEFAULT true,
  shift text DEFAULT 'Shift Pagi (07:00 - 15:00)',
  position text DEFAULT 'Barista & Kasir',
  employment_status text DEFAULT 'Kontrak',
  monthly_salary numeric DEFAULT 0,
  join_date date DEFAULT current_date,
  emergency_contact text DEFAULT '',
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Pastikan kolom tambahan tersedia jika tabel profiles sudah ada sebelumnya
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS shift text,
  ADD COLUMN IF NOT EXISTS position text,
  ADD COLUMN IF NOT EXISTS employment_status text,
  ADD COLUMN IF NOT EXISTS monthly_salary numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS join_date date,
  ADD COLUMN IF NOT EXISTS emergency_contact text,
  ADD COLUMN IF NOT EXISTS notes text;

-- Index unik case-insensitive untuk pencocokan email Google OAuth
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_uidx
  ON public.profiles (lower(email))
  WHERE email IS NOT NULL;

-- Aktifkan Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Karyawan yang login via Supabase Auth (Google / Email) dapat membaca profil miliknya berdasarkan email JWT
DROP POLICY IF EXISTS "Employee can read own profile by email" ON public.profiles;
CREATE POLICY "Employee can read own profile by email"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    OR id = auth.uid()
  );

-- Owner aktif dapat membaca, menambah, mengubah, dan menghapus semua data karyawan
DROP POLICY IF EXISTS "Owner can manage all employee profiles" ON public.profiles;
CREATE POLICY "Owner can manage all employee profiles"
  ON public.profiles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        AND p.role = 'owner'
        AND p.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE lower(p.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        AND p.role = 'owner'
        AND p.is_active = true
    )
  );

-- Seed akun Owner awal (ubah nama/email sesuai kebutuhan)
INSERT INTO public.profiles (full_name, email, role, phone_number, is_active, shift, position, employment_status)
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
ON CONFLICT DO NOTHING;
