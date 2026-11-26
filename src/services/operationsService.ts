import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type {
  InventoryItem,
  MenuItem,
  MenuRecipeItem,
  PurchaseItemRecord,
  PurchaseRecord,
  StockOpnameDetailItem,
  StockOpnameLog,
  StockOpnameSchedule,
  StoreSettings,
} from '../types';
import type { SupabaseSyncStatus } from './posService';

export type InventoryStockSeverity = 'asset' | 'critical' | 'low' | 'ok';

/**
 * Pure function: determines badge severity for inventory rows.
 * - Assets return 'asset' (condition-based rather than stock threshold)
 * - Stock <= 50% of threshold or 0 returns 'critical' (red badge)
 * - Stock <= threshold returns 'low' (yellow/amber badge)
 * - Otherwise returns 'ok' (emerald badge)
 */
export function getInventoryStockStatus(item: InventoryItem): InventoryStockSeverity {
  if (item.category_type === 'asset') return 'asset';
  if (item.current_stock <= 0 || item.current_stock <= item.min_stock_threshold * 0.5) {
    return 'critical';
  }
  if (item.current_stock <= item.min_stock_threshold) {
    return 'low';
  }
  return 'ok';
}

/**
 * Pure function: applies a multi-item purchase to inventory state.
 * Increments `current_stock` and refreshes `last_purchase_price` so HPP
 * calculations immediately reflect latest supplier market prices.
 */
export function applyPurchaseToInventory(
  inventory: InventoryItem[],
  purchaseItems: PurchaseItemRecord[],
  timestampIso = new Date().toISOString()
): InventoryItem[] {
  const aggregated = new Map<string, { totalQty: number; latestPrice: number }>();

  for (const line of purchaseItems) {
    if (!line.inventory_item_id) continue;
    const existing = aggregated.get(line.inventory_item_id);
    aggregated.set(line.inventory_item_id, {
      totalQty: Number(((existing?.totalQty ?? 0) + line.quantity).toFixed(2)),
      latestPrice: line.unit_price,
    });
  }

  return inventory.map((inv) => {
    const entry = aggregated.get(inv.id);
    if (!entry) return inv;
    return {
      ...inv,
      current_stock: Number((inv.current_stock + entry.totalQty).toFixed(2)),
      last_purchase_price: entry.latestPrice,
      updated_at: timestampIso,
    };
  });
}

/**
 * Pure function: removes an inventory item and cleans up any menu_recipes
 * referencing it so HPP calculations and BOM deductions never hold stale IDs.
 */
export function removeInventoryAndPruneRecipes(
  inventory: InventoryItem[],
  menus: MenuItem[],
  itemId: string
): { inventory: InventoryItem[]; menus: MenuItem[]; affectedMenuCount: number } {
  let affectedMenuCount = 0;
  const nextMenus = menus.map((menu) => {
    const hasRef = menu.recipes.some((r) => r.inventory_item_id === itemId);
    if (!hasRef) return menu;
    affectedMenuCount += 1;
    return {
      ...menu,
      recipes: menu.recipes.filter((r) => r.inventory_item_id !== itemId),
    };
  });

  return {
    inventory: inventory.filter((inv) => inv.id !== itemId),
    menus: nextMenus,
    affectedMenuCount,
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

/**
 * Persists a newly created or edited inventory item to Supabase `inventory_items`.
 */
export async function upsertInventoryItemToSupabase(
  item: InventoryItem,
  isNew: boolean,
  enableSupabaseSync = false
): Promise<SupabaseSyncStatus> {
  if (!enableSupabaseSync || !isSupabaseConfigured || !supabase) {
    return { mode: 'local', synced: true };
  }

  try {
    const payload = {
      name: item.name,
      sku: item.sku,
      category_type: item.category_type,
      expense_category: item.expense_category ?? null,
      unit: item.unit,
      current_stock: item.current_stock,
      min_stock_threshold: item.min_stock_threshold,
      last_purchase_price: item.last_purchase_price,
      asset_condition: item.category_type === 'asset' ? item.asset_condition ?? 'Baik' : null,
      updated_at: item.updated_at,
    };

    if (isNew || !isUuid(item.id)) {
      if (!isNew && item.sku) {
        const { data: updatedBySku, error: skuErr } = await supabase
          .from('inventory_items')
          .update(payload)
          .eq('sku', item.sku)
          .select('id')
          .maybeSingle();

        if (!skuErr && updatedBySku?.id) {
          return { mode: 'supabase', synced: true, id: String(updatedBySku.id) };
        }
      }

      const { data, error } = await supabase
        .from('inventory_items')
        .upsert(payload, { onConflict: 'sku' })
        .select('id')
        .single();

      if (error) return { mode: 'supabase', synced: false, error: error.message };
      return { mode: 'supabase', synced: true, id: data?.id ? String(data.id) : undefined };
    }

    const { error } = await supabase.from('inventory_items').update(payload).eq('id', item.id);
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true, id: item.id };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyinkronkan inventori ke Supabase.',
    };
  }
}

/**
 * Deletes an inventory item from Supabase `inventory_items`.
 */
export async function deleteInventoryItemFromSupabase(
  itemId: string,
  enableSupabaseSync = false,
  skuFallback?: string
): Promise<SupabaseSyncStatus> {
  if (!enableSupabaseSync || !isSupabaseConfigured || !supabase) {
    return { mode: 'local', synced: true };
  }

  try {
    if (isUuid(itemId)) {
      const { error } = await supabase.from('inventory_items').delete().eq('id', itemId);
      if (error) return { mode: 'supabase', synced: false, error: error.message };
      return { mode: 'supabase', synced: true };
    }
    if (skuFallback) {
      const { error } = await supabase.from('inventory_items').delete().eq('sku', skuFallback);
      if (error) return { mode: 'supabase', synced: false, error: error.message };
    }
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menghapus item inventori di Supabase.',
    };
  }
}

/**
 * Persists a supplier purchase / operational expense to Supabase:
 * 1. Inserts header into `purchases`
 * 2. Inserts line items into `purchase_items`
 * 3. Updates `current_stock` and `last_purchase_price` in `inventory_items`
 */
export async function persistPurchaseToSupabase(params: {
  purchase: PurchaseRecord;
  purchasedById: string;
  updatedInventoryItems: InventoryItem[];
  enableSupabaseSync?: boolean;
}): Promise<SupabaseSyncStatus> {
  if (!params.enableSupabaseSync || !isSupabaseConfigured || !supabase) {
    return { mode: 'local', synced: true };
  }

  try {
    const { purchase, purchasedById, updatedInventoryItems } = params;
    const { data: insertedPurchase, error: purchaseError } = await supabase
      .from('purchases')
      .insert({
        expense_category: purchase.expense_category,
        supplier_name: purchase.supplier_name,
        invoice_number: purchase.invoice_number,
        total_cost: purchase.total_cost,
        payment_method: purchase.payment_method ?? 'transfer',
        notes: purchase.notes ?? '',
        purchased_by: isUuid(purchasedById) ? purchasedById : null,
        purchased_by_name: purchase.purchased_by_name,
        purchase_date: purchase.purchase_date,
      })
      .select('id')
      .single();

    if (purchaseError || !insertedPurchase) {
      return {
        mode: 'supabase',
        synced: false,
        error: purchaseError?.message || 'Gagal menyimpan header pembelian.',
      };
    }

    const lineRows = purchase.items.map((line) => ({
      purchase_id: insertedPurchase.id,
      inventory_item_id: isUuid(line.inventory_item_id) ? line.inventory_item_id : null,
      item_name: line.item_name,
      unit: line.unit,
      quantity: line.quantity,
      unit_price: line.unit_price,
    }));

    if (lineRows.length > 0) {
      const { error: lineError } = await supabase.from('purchase_items').insert(lineRows);
      if (lineError) {
        return {
          mode: 'supabase',
          synced: false,
          id: String(insertedPurchase.id),
          error: lineError.message,
        };
      }
    }

    const stockUpdateResults = await Promise.all(
      updatedInventoryItems.map((inv) => {
        const patch = {
          current_stock: inv.current_stock,
          last_purchase_price: inv.last_purchase_price,
          updated_at: inv.updated_at,
        };
        if (isUuid(inv.id)) {
          return supabase!.from('inventory_items').update(patch).eq('id', inv.id);
        }
        return supabase!.from('inventory_items').update(patch).eq('sku', inv.sku);
      })
    );

    const failedStock = stockUpdateResults.find((res) => res.error);
    if (failedStock?.error) {
      return {
        mode: 'supabase',
        synced: false,
        id: String(insertedPurchase.id),
        error: `Pembelian tersimpan, tetapi gagal memperbarui stok inventori: ${failedStock.error.message}`,
      };
    }

    return { mode: 'supabase', synced: true, id: String(insertedPurchase.id) };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan transaksi pembelian ke Supabase.',
    };
  }
}

/**
 * Persists a menu creation or update to Supabase `menus`.
 */
export async function upsertMenuItemToSupabase(
  menu: MenuItem,
  isNew: boolean,
  enableSupabaseSync = false
): Promise<SupabaseSyncStatus> {
  if (!enableSupabaseSync || !isSupabaseConfigured || !supabase) {
    return { mode: 'local', synced: true };
  }

  try {
    const payload = {
      category_id: isUuid(menu.category_id) ? menu.category_id : null,
      name: menu.name,
      description: menu.description,
      image_url: menu.image_url ?? null,
      selling_price: menu.selling_price,
      is_available: menu.is_available,
      visual_tone: menu.visual_tone,
    };

    if (isNew || !isUuid(menu.id)) {
      const { data, error } = await supabase
        .from('menus')
        .insert(payload)
        .select('id')
        .single();
      if (error) return { mode: 'supabase', synced: false, error: error.message };
      return { mode: 'supabase', synced: true, id: data?.id ? String(data.id) : undefined };
    }

    const { error } = await supabase.from('menus').update(payload).eq('id', menu.id);
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true, id: menu.id };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan data menu ke Supabase.',
    };
  }
}

/**
 * Deletes a menu from Supabase `menus`.
 */
export async function deleteMenuItemFromSupabase(
  menuId: string,
  enableSupabaseSync = false
): Promise<SupabaseSyncStatus> {
  if (!enableSupabaseSync || !isSupabaseConfigured || !supabase || !isUuid(menuId)) {
    return { mode: 'local', synced: true };
  }

  try {
    const { error } = await supabase.from('menus').delete().eq('id', menuId);
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menghapus menu di Supabase.',
    };
  }
}

/**
 * Replaces a menu's BOM recipes in Supabase `menu_recipes`.
 */
export async function syncMenuRecipesToSupabase(
  menuId: string,
  recipes: MenuRecipeItem[],
  enableSupabaseSync = false
): Promise<SupabaseSyncStatus> {
  if (!enableSupabaseSync || !isSupabaseConfigured || !supabase || !isUuid(menuId)) {
    return { mode: 'local', synced: true };
  }

  try {
    const { error: deleteErr } = await supabase
      .from('menu_recipes')
      .delete()
      .eq('menu_id', menuId);

    if (deleteErr) {
      return { mode: 'supabase', synced: false, error: deleteErr.message };
    }

    const validRecipes = recipes.filter((r) => isUuid(r.inventory_item_id));
    if (validRecipes.length > 0) {
      const { error: insertErr } = await supabase.from('menu_recipes').insert(
        validRecipes.map((r) => ({
          menu_id: menuId,
          inventory_item_id: r.inventory_item_id,
          quantity_needed: r.quantity_needed,
        }))
      );
      if (insertErr) {
        return { mode: 'supabase', synced: false, error: insertErr.message };
      }
    }

    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan resep HPP ke Supabase.',
    };
  }
}

/**
 * Persists store settings (tax config, logo, receipt, WA & login alert config) to Supabase `store_settings`.
 */
export async function persistStoreSettingsToSupabase(
  settings: StoreSettings,
  enableSupabaseSync = false
): Promise<SupabaseSyncStatus> {
  if (!enableSupabaseSync || !isSupabaseConfigured || !supabase) {
    return { mode: 'local', synced: true };
  }

  const corePayload = {
    id: 'default',
    shop_name: settings.shopName,
    address: settings.address,
    phone: settings.phone,
    customer_service_contact: settings.customerServiceContact,
    shop_logo_url: settings.shopLogoUrl,
    tax_enabled: settings.taxEnabled,
    tax_percent: settings.taxPercent,
    tax_label: settings.taxLabel,
    receipt_paper_width: settings.receiptPaperWidth,
    receipt_header_text: settings.receiptHeaderText,
    receipt_footer_text: settings.receiptFooterText,
    receipt_show_logo: settings.receiptShowLogo,
    receipt_show_cashier_and_table: settings.receiptShowCashierAndTable,
    receipt_show_member_info: settings.receiptShowMemberInfo,
    receipt_show_customer_service: settings.receiptShowCustomerService,
    updated_at: new Date().toISOString(),
  };

  try {
    const { error } = await supabase.from('store_settings').upsert({
      ...corePayload,
      printer_connection_type: settings.printerConnectionType,
      whatsapp_owner_phone: settings.whatsappOwnerPhone,
      whatsapp_manager_phone: settings.whatsappManagerPhone,
      owner_login_alert_email: settings.ownerLoginAlertEmail,
    });

    if (error) {
      // Fallback to core columns if database hasn't added extended columns yet
      const { error: fallbackErr } = await supabase.from('store_settings').upsert(corePayload);
      if (fallbackErr) {
        return { mode: 'supabase', synced: false, error: fallbackErr.message };
      }
    }
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan pengaturan toko ke Supabase.',
    };
  }
}

/**
 * Fetches active Stock Opname schedules from Supabase `stock_opname_schedules`.
 */
export async function fetchActiveOpnameSchedulesFromSupabase(
  enableSupabaseSync = false
): Promise<StockOpnameSchedule[] | null> {
  if (!enableSupabaseSync || !isSupabaseConfigured || !supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from('stock_opname_schedules')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !data) return null;

    return data.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      frequency: row.frequency,
      execution_time: String(row.execution_time).slice(0, 5),
      day_of_week: row.day_of_week ?? undefined,
      day_of_month: row.day_of_month ?? undefined,
      target_category: row.target_category,
      is_active: Boolean(row.is_active),
      is_due_now: Boolean(row.is_due_now),
      last_completed_at: row.last_completed_at ?? undefined,
    }));
  } catch {
    return null;
  }
}

/**
 * Persists a newly created or toggled schedule to Supabase `stock_opname_schedules`.
 */
export async function upsertOpnameScheduleToSupabase(
  schedule: StockOpnameSchedule,
  isNew: boolean,
  enableSupabaseSync = false
): Promise<SupabaseSyncStatus> {
  if (!enableSupabaseSync || !isSupabaseConfigured || !supabase) {
    return { mode: 'local', synced: true };
  }

  try {
    const payload = {
      title: schedule.title,
      frequency: schedule.frequency,
      execution_time: schedule.execution_time,
      day_of_week: schedule.frequency === 'weekly' ? schedule.day_of_week ?? 0 : null,
      day_of_month: schedule.frequency === 'monthly' ? schedule.day_of_month ?? 1 : null,
      target_category: schedule.target_category,
      is_active: schedule.is_active,
      is_due_now: schedule.is_due_now,
      last_completed_at: schedule.last_completed_at ?? null,
    };

    if (isNew || !isUuid(schedule.id)) {
      const { data, error } = await supabase
        .from('stock_opname_schedules')
        .insert(payload)
        .select('id')
        .single();
      if (error) return { mode: 'supabase', synced: false, error: error.message };
      return { mode: 'supabase', synced: true, id: data?.id ? String(data.id) : undefined };
    }

    const { error } = await supabase
      .from('stock_opname_schedules')
      .update(payload)
      .eq('id', schedule.id);

    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true, id: schedule.id };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyimpan jadwal opname ke Supabase.',
    };
  }
}

/**
 * Deletes a Stock Opname schedule from Supabase `stock_opname_schedules`.
 */
export async function deleteOpnameScheduleFromSupabase(
  scheduleId: string,
  enableSupabaseSync = false
): Promise<SupabaseSyncStatus> {
  if (!enableSupabaseSync || !isSupabaseConfigured || !supabase || !isUuid(scheduleId)) {
    return { mode: 'local', synced: true };
  }

  try {
    const { error } = await supabase
      .from('stock_opname_schedules')
      .delete()
      .eq('id', scheduleId);
    if (error) return { mode: 'supabase', synced: false, error: error.message };
    return { mode: 'supabase', synced: true };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menghapus jadwal opname di Supabase.',
    };
  }
}

/**
 * Persists a completed Stock Opname session to Supabase:
 * 1. Inserts header into `stock_opname_logs`
 * 2. Resolves any non-UUID inventory items by SKU against live `inventory_items`
 * 3. Inserts per-item variance rows into `stock_opname_details`
 * 4. Updates `inventory_items.current_stock` for every checked item & verifies all updates succeeded
 * 5. Updates `stock_opname_schedules.last_completed_at` and clears `is_due_now`
 */
export async function persistStockOpnameToSupabase(params: {
  log: StockOpnameLog;
  performedById: string;
  details: StockOpnameDetailItem[];
  enableSupabaseSync?: boolean;
}): Promise<SupabaseSyncStatus & { updatedCount?: number }> {
  if (!params.enableSupabaseSync || !isSupabaseConfigured || !supabase) {
    return { mode: 'local', synced: true };
  }

  try {
    const { log, performedById, details } = params;

    // 1. Insert header row into `stock_opname_logs`
    const { data: insertedLog, error: logError } = await supabase
      .from('stock_opname_logs')
      .insert({
        schedule_id: isUuid(log.schedule_id) ? log.schedule_id : null,
        schedule_title: log.schedule_title,
        performed_by: isUuid(performedById) ? performedById : null,
        performed_by_name: log.performed_by_name,
        notes: log.notes,
        total_items_checked: log.total_items_checked,
        discrepancy_count: log.discrepancy_count,
        whatsapp_sent: Boolean(log.whatsapp_sent),
        completed_at: log.completed_at,
      })
      .select('id')
      .single();

    if (logError || !insertedLog) {
      return {
        mode: 'supabase',
        synced: false,
        error:
          logError?.message ||
          'Gagal menyimpan header stock_opname_logs. Pastikan schema_full_brewflow.sql sudah dijalankan di Supabase.',
      };
    }

    let updatedCount = 0;

    if (details.length > 0) {
      // Resolve live UUIDs by SKU if any local item still holds a non-UUID ID
      const needsSkuResolution = details.some((d) => !isUuid(d.inventory_item_id));
      const skuToUuid = new Map<string, string>();
      if (needsSkuResolution) {
        const skus = details.map((d) => d.sku).filter(Boolean);
        if (skus.length > 0) {
          const { data: matchedInv } = await supabase
            .from('inventory_items')
            .select('id, sku')
            .in('sku', skus);
          if (Array.isArray(matchedInv)) {
            for (const row of matchedInv) {
              skuToUuid.set(String(row.sku), String(row.id));
            }
          }
        }
      }

      const resolvedDetails = details.map((d) => ({
        ...d,
        resolvedUuid: isUuid(d.inventory_item_id)
          ? d.inventory_item_id
          : skuToUuid.get(d.sku) ?? null,
      }));

      // 2. Insert per-item variance rows into `stock_opname_details`
      // Omit `variance` because PostgreSQL defines it as GENERATED ALWAYS AS (actual_stock - system_stock) STORED
      const { error: detailsErr } = await supabase.from('stock_opname_details').insert(
        resolvedDetails.map((d) => ({
          opname_log_id: insertedLog.id,
          inventory_item_id: d.resolvedUuid,
          item_name: d.item_name,
          sku: d.sku,
          unit: d.unit,
          system_stock: d.system_stock,
          actual_stock: d.actual_stock,
          unit_price: d.unit_price,
          reason: d.reason ?? null,
        }))
      );

      if (detailsErr) {
        return {
          mode: 'supabase',
          synced: false,
          id: String(insertedLog.id),
          error: `Gagal menyimpan detail opname: ${detailsErr.message}`,
        };
      }

      // 3. Update `inventory_items.current_stock` for every checked item & verify errors
      const updateResults = await Promise.all(
        resolvedDetails.map(async (d) => {
          const patch = {
            current_stock: d.actual_stock,
            updated_at: log.completed_at,
          };
          if (d.resolvedUuid) {
            return supabase!
              .from('inventory_items')
              .update(patch)
              .eq('id', d.resolvedUuid)
              .select('id');
          }
          if (d.sku) {
            return supabase!
              .from('inventory_items')
              .update(patch)
              .eq('sku', d.sku)
              .select('id');
          }
          return { data: null, error: null };
        })
      );

      const failedUpdate = updateResults.find((res) => res.error);
      if (failedUpdate?.error) {
        return {
          mode: 'supabase',
          synced: false,
          id: String(insertedLog.id),
          error: `Log opname tersimpan, tetapi gagal memperbarui stok di inventory_items: ${failedUpdate.error.message}`,
        };
      }

      updatedCount = updateResults.filter(
        (res) => Array.isArray(res.data) && res.data.length > 0
      ).length;

      if (updatedCount === 0) {
        return {
          mode: 'supabase',
          synced: false,
          id: String(insertedLog.id),
          updatedCount: 0,
          error:
            'Tidak ada baris inventory_items di Supabase yang ter-update (periksa RLS atau jalankan supabase/schema_full_brewflow.sql).',
        };
      }
    }

    // 4. Mark schedule as completed in `stock_opname_schedules`
    if (isUuid(log.schedule_id)) {
      const { error: schedErr } = await supabase
        .from('stock_opname_schedules')
        .update({
          last_completed_at: log.completed_at,
          is_due_now: false,
        })
        .eq('id', log.schedule_id);

      if (schedErr) {
        return {
          mode: 'supabase',
          synced: false,
          id: String(insertedLog.id),
          updatedCount,
          error: `Stok ter-update (${updatedCount} item), tetapi gagal memperbarui jadwal opname: ${schedErr.message}`,
        };
      }
    }

    return {
      mode: 'supabase',
      synced: true,
      id: String(insertedLog.id),
      updatedCount,
    };
  } catch (err) {
    return {
      mode: 'supabase',
      synced: false,
      error: err instanceof Error ? err.message : 'Gagal menyinkronkan Stock Opname ke Supabase.',
    };
  }
}

