import type { Customer, InventoryItem, MembershipTierRule, MenuItem, OrderRecord } from '../types';
import { computeTierBySpend } from './membershipProgram';

export interface StockRestorationEntry {
  inventoryItemId: string;
  itemName: string;
  unit: string;
  quantityRestored: number;
  nextStock: number;
}

export interface OrderReversalResult {
  updatedInventory: InventoryItem[];
  restoredStock: StockRestorationEntry[];
  updatedCustomer: Customer | null;
  pointsReversed: number;
  voucherCodeToRestore: string | null;
}

/**
 * Pure function: calculates exact atomic reversal for a cancelled/refunded order.
 * Only reverses stock, customer points, and voucher usage when the order was previously 'completed'.
 */
export function computeOrderReversal(params: {
  order: OrderRecord;
  menus: MenuItem[];
  inventory: InventoryItem[];
  customers: Customer[];
  tierRules?: MembershipTierRule[];
  pointEarningStepRupiah?: number;
}): OrderReversalResult {
  const { order, menus, inventory, customers, tierRules, pointEarningStepRupiah = 10000 } = params;

  if (order.status !== 'completed') {
    return {
      updatedInventory: inventory,
      restoredStock: [],
      updatedCustomer: null,
      pointsReversed: 0,
      voucherCodeToRestore: null,
    };
  }

  // 1. Compute recipe stock restoration across all items in the cancelled order
  const menuById = new Map(menus.map((m) => [m.id, m]));
  const restoreMap = new Map<string, number>();

  for (const line of order.items) {
    const menu = menuById.get(line.menu_id);
    if (!menu) continue;
    for (const recipe of menu.recipes) {
      const prev = restoreMap.get(recipe.inventory_item_id) ?? 0;
      const added = Number((recipe.quantity_needed * line.quantity).toFixed(2));
      restoreMap.set(recipe.inventory_item_id, Number((prev + added).toFixed(2)));
    }
  }

  const nowIso = new Date().toISOString();
  const restoredStock: StockRestorationEntry[] = [];
  const updatedInventory = inventory.map((inv) => {
    const qty = restoreMap.get(inv.id);
    if (!qty || qty <= 0) return inv;
    const nextStock = Number((inv.current_stock + qty).toFixed(2));
    restoredStock.push({
      inventoryItemId: inv.id,
      itemName: inv.name,
      unit: inv.unit,
      quantityRestored: qty,
      nextStock,
    });
    return {
      ...inv,
      current_stock: nextStock,
      updated_at: nowIso,
    };
  });

  // 2. Reverse customer loyalty points & total_spent
  let updatedCustomer: Customer | null = null;
  let pointsReversed = 0;

  if (order.customer_id) {
    const existingCustomer = customers.find((c) => c.id === order.customer_id);
    if (existingCustomer) {
      const computedPoints =
        typeof order.points_earned === 'number' && order.points_earned >= 0
          ? order.points_earned
          : Math.floor(order.total_amount / Math.max(1000, pointEarningStepRupiah));
      pointsReversed = Math.min(existingCustomer.points, Math.max(0, computedPoints));
      const nextPoints = Math.max(0, existingCustomer.points - pointsReversed);
      const nextTotalSpent = Math.max(0, existingCustomer.total_spent - order.total_amount);
      const nextTier = computeTierBySpend(nextTotalSpent, tierRules);

      updatedCustomer = {
        ...existingCustomer,
        points: nextPoints,
        total_spent: nextTotalSpent,
        tier: nextTier,
      };
    }
  }

  // 3. Restore voucher quota if a voucher code was used on this completed order
  const voucherCodeToRestore =
    order.voucher_code && order.voucher_code.trim() ? order.voucher_code.trim().toUpperCase() : null;

  return {
    updatedInventory,
    restoredStock,
    updatedCustomer,
    pointsReversed,
    voucherCodeToRestore,
  };
}
