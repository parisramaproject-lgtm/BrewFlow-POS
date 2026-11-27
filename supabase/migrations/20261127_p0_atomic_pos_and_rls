-- ============================================================================
-- 1. P0-2: COUNTER NOMOR ORDER HARIAN ANTI-BENTROK (BF-YYMMDD-XXX)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.daily_order_counters (
  order_date DATE PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.generate_next_order_number(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_seq INTEGER;
BEGIN
  INSERT INTO public.daily_order_counters (order_date, last_seq, updated_at)
  VALUES (p_date, 1, NOW())
  ON CONFLICT (order_date)
  DO UPDATE SET
    last_seq = public.daily_order_counters.last_seq + 1,
    updated_at = NOW()
  RETURNING last_seq INTO v_seq;

  RETURN 'BF-' || TO_CHAR(p_date, 'YYMMDD') || '-' || LPAD(v_seq::TEXT, 3, '0');
END;
$$;

-- ============================================================================
-- 2. P1-4: KOLOM HPP HISTORIS PADA ORDER_ITEMS
-- ============================================================================
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit_hpp NUMERIC(12, 2) NOT NULL DEFAULT 0;

-- ============================================================================
-- 3. P0-4: RPC CHECKOUT TRANSAKSIONAL (ACID)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_pos_checkout(
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID := COALESCE((p_payload->>'id')::UUID, gen_random_uuid());
  v_order_number TEXT;
  v_customer_id UUID := NULLIF(p_payload->>'customer_id', '')::UUID;
  v_cashier_id UUID := NULLIF(p_payload->>'cashier_id', '')::UUID;
  v_voucher_code TEXT := NULLIF(TRIM(p_payload->>'voucher_code'), '');
  v_points_earned INTEGER := COALESCE((p_payload->>'points_earned')::INTEGER, 0);
  v_points_redeemed INTEGER := COALESCE((p_payload->>'points_redeemed')::INTEGER, 0);
  v_item JSONB;
  v_recipe RECORD;
  v_updated_rows INTEGER;
  v_current_points INTEGER;
BEGIN
  -- Pastikan pemanggil adalah karyawan aktif
  IF NOT public.is_active_employee() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Sesi karyawan tidak aktif atau tidak valid';
  END IF;

  -- Idempotency check jika client melakukan retry dengan order_id yang sama
  IF EXISTS (SELECT 1 FROM public.orders WHERE id = v_order_id) THEN
    SELECT order_number INTO v_order_number FROM public.orders WHERE id = v_order_id;
    RETURN jsonb_build_object(
      'synced', true,
      'duplicate_ignored', true,
      'order_id', v_order_id,
      'order_number', v_order_number
    );
  END IF;

  -- Generate nomor order atomik berbasis tanggal server
  v_order_number := public.generate_next_order_number(CURRENT_DATE);

  -- Insert header order
  INSERT INTO public.orders (
    id,
    order_number,
    customer_id,
    cashier_id,
    table_number,
    order_type,
    payment_method,
    subtotal,
    discount_amount,
    tax_amount,
    total_amount,
    cash_received,
    change_amount,
    voucher_code,
    points_earned,
    points_redeemed,
    status,
    notes,
    created_at
  ) VALUES (
    v_order_id,
    v_order_number,
    v_customer_id,
    v_cashier_id,
    p_payload->>'table_number',
    COALESCE(p_payload->>'order_type', 'dine_in'),
    COALESCE(p_payload->>'payment_method', 'cash'),
    COALESCE((p_payload->>'subtotal')::NUMERIC, 0),
    COALESCE((p_payload->>'discount_amount')::NUMERIC, 0),
    COALESCE((p_payload->>'tax_amount')::NUMERIC, 0),
    COALESCE((p_payload->>'total_amount')::NUMERIC, 0),
    COALESCE((p_payload->>'cash_received')::NUMERIC, 0),
    COALESCE((p_payload->>'change_amount')::NUMERIC, 0),
    v_voucher_code,
    v_points_earned,
    v_points_redeemed,
    'completed',
    p_payload->>'notes',
    COALESCE((p_payload->>'created_at')::TIMESTAMPTZ, NOW())
  );

  -- Insert item & potong stok bahan baku berdasarkan resep secara atomik
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    INSERT INTO public.order_items (
      order_id,
      menu_id,
      menu_name,
      quantity,
      unit_price,
      unit_hpp,
      subtotal,
      notes
    ) VALUES (
      v_order_id,
      (v_item->>'menu_id')::UUID,
      v_item->>'menu_name',
      (v_item->>'quantity')::INTEGER,
      (v_item->>'unit_price')::NUMERIC,
      COALESCE((v_item->>'unit_hpp')::NUMERIC, 0),
      (v_item->>'subtotal')::NUMERIC,
      v_item->>'notes'
    );

    -- Pemotongan stok relatif untuk setiap komposisi resep menu
    FOR v_recipe IN
      SELECT mr.inventory_item_id, mr.quantity_required
      FROM public.menu_recipes mr
      WHERE mr.menu_id = (v_item->>'menu_id')::UUID
    LOOP
      UPDATE public.inventory_items
      SET
        current_stock = current_stock - (v_recipe.quantity_required * (v_item->>'quantity')::NUMERIC),
        updated_at = NOW()
      WHERE id = v_recipe.inventory_item_id
        AND current_stock >= (v_recipe.quantity_required * (v_item->>'quantity')::NUMERIC);

      GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
      IF v_updated_rows = 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_STOCK: Stok bahan baku tidak mencukupi untuk item %', v_item->>'menu_name';
      END IF;
    END LOOP;
  END LOOP;

  -- Update poin member secara relatif (anti lost-update)
  IF v_customer_id IS NOT NULL THEN
    SELECT points INTO v_current_points
    FROM public.customers
    WHERE id = v_customer_id
    FOR UPDATE;

    IF COALESCE(v_current_points, 0) < v_points_redeemed THEN
      RAISE EXCEPTION 'INSUFFICIENT_POINTS: Poin member tidak mencukupi';
    END IF;

    UPDATE public.customers
    SET
      points = points - v_points_redeemed + v_points_earned,
      total_spent = COALESCE(total_spent, 0) + COALESCE((p_payload->>'total_amount')::NUMERIC, 0),
      visit_count = COALESCE(visit_count, 0) + 1,
      updated_at = NOW()
    WHERE id = v_customer_id;
  END IF;

  -- Increment kuota voucher secara atomik
  IF v_voucher_code IS NOT NULL THEN
    UPDATE public.vouchers
    SET
      used_count = COALESCE(used_count, 0) + 1,
      updated_at = NOW()
    WHERE LOWER(code) = LOWER(v_voucher_code)
      AND is_active = TRUE
      AND (usage_limit IS NULL OR COALESCE(used_count, 0) < usage_limit);

    GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
    IF v_updated_rows = 0 THEN
      RAISE EXCEPTION 'INVALID_VOUCHER: Voucher tidak valid atau kuota sudah habis';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'synced', true,
    'order_id', v_order_id,
    'order_number', v_order_number
  );
END;
$$;

-- ============================================================================
-- 4. P0-5: RPC PEMBATALAN / VOID ATOMIK (PULIHKAN STOK, POIN & VOUCHER)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_pos_order(
  p_order_id UUID,
  p_reason TEXT,
  p_cancelled_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_item RECORD;
  v_recipe RECORD;
BEGIN
  IF NOT public.is_active_employee() THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Akses ditolak';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND: Transaksi tidak ditemukan';
  END IF;

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'ALREADY_CANCELLED: Transaksi sudah pernah dibatalkan';
  END IF;

  -- 1. Kembalikan stok bahan baku
  FOR v_item IN
    SELECT menu_id, quantity FROM public.order_items WHERE order_id = p_order_id
  LOOP
    FOR v_recipe IN
      SELECT inventory_item_id, quantity_required
      FROM public.menu_recipes
      WHERE menu_id = v_item.menu_id
    LOOP
      UPDATE public.inventory_items
      SET
        current_stock = current_stock + (v_recipe.quantity_required * v_item.quantity),
        updated_at = NOW()
      WHERE id = v_recipe.inventory_item_id;
    END LOOP;
  END LOOP;

  -- 2. Pulihkan poin member
  IF v_order.customer_id IS NOT NULL THEN
    UPDATE public.customers
    SET
      points = GREATEST(0, points - COALESCE(v_order.points_earned, 0) + COALESCE(v_order.points_redeemed, 0)),
      total_spent = GREATEST(0, COALESCE(total_spent, 0) - COALESCE(v_order.total_amount, 0)),
      visit_count = GREATEST(0, COALESCE(visit_count, 0) - 1),
      updated_at = NOW()
    WHERE id = v_order.customer_id;
  END IF;

  -- 3. Pulihkan kuota voucher
  IF v_order.voucher_code IS NOT NULL AND TRIM(v_order.voucher_code) <> '' THEN
    UPDATE public.vouchers
    SET
      used_count = GREATEST(0, COALESCE(used_count, 0) - 1),
      updated_at = NOW()
    WHERE LOWER(code) = LOWER(v_order.voucher_code);
  END IF;

  -- 4. Update status order
  UPDATE public.orders
  SET
    status = 'cancelled',
    notes = CONCAT_WS(' | ', NULLIF(notes, ''), 'VOID: ' || COALESCE(NULLIF(TRIM(p_reason), ''), 'Dibatalkan')),
    updated_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'synced', true,
    'order_id', p_order_id,
    'status', 'cancelled'
  );
END;
$$;

-- ============================================================================
-- 5. P0-3: PENGETATAN RLS BERBASIS ROLE & PROTEKSI KOLOM HPP / PASSWORD_HASH
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_current_employee_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT LOWER(role)
  FROM public.employees
  WHERE LOWER(email) = LOWER(COALESCE(auth.jwt()->>'email', ''))
    AND is_active = TRUE
  LIMIT 1;
$$;

-- Cabut akses langsung ke kolom sensitif dari role klien
REVOKE SELECT (password_hash) ON public.employees FROM anon, authenticated;
REVOKE SELECT (last_purchase_price) ON public.inventory_items FROM anon, authenticated;

-- Hapus policy lama yang terlalu permisif pada tabel operasional
DROP POLICY IF EXISTS "active_employees_all_inventory" ON public.inventory_items;
DROP POLICY IF EXISTS "active_employees_all_recipes" ON public.menu_recipes;
DROP POLICY IF EXISTS "active_employees_all_purchases" ON public.purchases;
DROP POLICY IF EXISTS "active_employees_all_settings" ON public.store_settings;

-- Inventory: Semua karyawan aktif boleh baca kolom non-HPP; hanya owner/manager boleh ubah
CREATE POLICY "inventory_select_active"
  ON public.inventory_items FOR SELECT
  TO authenticated
  USING (public.is_active_employee());

CREATE POLICY "inventory_modify_manager_owner"
  ON public.inventory_items FOR ALL
  TO authenticated
  USING (public.get_current_employee_role() IN ('owner', 'manager'))
  WITH CHECK (public.get_current_employee_role() IN ('owner', 'manager'));

-- Menu Recipes (Data HPP): Hanya owner & manager yang bisa membaca dan mengubah
CREATE POLICY "recipes_manager_owner_only"
  ON public.menu_recipes FOR ALL
  TO authenticated
  USING (public.get_current_employee_role() IN ('owner', 'manager'))
  WITH CHECK (public.get_current_employee_role() IN ('owner', 'manager'));

-- Purchases & Vendors: Hanya owner & manager
CREATE POLICY "purchases_manager_owner_only"
  ON public.purchases FOR ALL
  TO authenticated
  USING (public.get_current_employee_role() IN ('owner', 'manager'))
  WITH CHECK (public.get_current_employee_role() IN ('owner', 'manager'));

-- Store Settings: Semua karyawan boleh baca konfigurasi dasar; hanya owner boleh ubah
CREATE POLICY "settings_read_active"
  ON public.store_settings FOR SELECT
  TO authenticated
  USING (public.is_active_employee());

CREATE POLICY "settings_write_owner_only"
  ON public.store_settings FOR ALL
  TO authenticated
  USING (public.get_current_employee_role() = 'owner')
  WITH CHECK (public.get_current_employee_role() = 'owner');

-- Employees: Hanya owner bisa kelola semua karyawan; karyawan biasa hanya baca profil sendiri (tanpa password_hash)
CREATE POLICY "employees_read_self_or_owner"
  ON public.employees FOR SELECT
  TO authenticated
  USING (
    public.get_current_employee_role() = 'owner'
    OR LOWER(email) = LOWER(COALESCE(auth.jwt()->>'email', ''))
  );

CREATE POLICY "employees_write_owner_only"
  ON public.employees FOR ALL
  TO authenticated
  USING (public.get_current_employee_role() = 'owner')
  WITH CHECK (public.get_current_employee_role() = 'owner');
