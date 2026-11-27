import type { CartItem, InventoryItem, MenuItem } from '../types';

export interface MissingIngredientDetail {
  inventory_item_id: string;
  name: string;
  unit: string;
  current_stock: number;
  needed_per_serving: number;
}

export interface MenuStockAvailability {
  /** True when store inventory does not even have enough for 1 serving */
  isOutOfStock: boolean;
  /** True when at least +1 additional serving can be added given current cart reservations */
  canAddOneMore: boolean;
  /** Max total servings possible from current inventory (Infinity if menu has no recipes) */
  maxServingsFromStock: number;
  /** Remaining servings still available after subtracting all items already in cart */
  remainingServingsAfterCart: number;
  /** Ingredients that are depleted below 1 serving in store inventory */
  missingIngredients: MissingIngredientDetail[];
  /** Ingredients that prevent adding +1 more serving due to cart reservation */
  limitingIngredients: MissingIngredientDetail[];
  /** True when available servings are low (1..3 servings left) */
  isLowServings: boolean;
}

/**
 * Computes total ingredient usage currently reserved by items in the active POS cart.
 */
export function computeCartIngredientUsage(cart: CartItem[]): Map<string, number> {
  const usage = new Map<string, number>();
  for (const cartItem of cart) {
    if (cartItem.quantity <= 0) continue;
    for (const recipe of cartItem.menu.recipes) {
      if (recipe.quantity_needed <= 0) continue;
      const prev = usage.get(recipe.inventory_item_id) ?? 0;
      usage.set(recipe.inventory_item_id, prev + recipe.quantity_needed * cartItem.quantity);
    }
  }
  return usage;
}

/**
 * Evaluates whether a menu can be ordered in POS based on its BOM recipes,
 * live inventory stock, and any quantities already reserved in the current cart.
 */
export function evaluateMenuStockAvailability(
  menu: MenuItem,
  inventory: InventoryItem[],
  cart: CartItem[] = []
): MenuStockAvailability {
  if (!menu.recipes || menu.recipes.length === 0) {
    return {
      isOutOfStock: false,
      canAddOneMore: true,
      maxServingsFromStock: Number.POSITIVE_INFINITY,
      remainingServingsAfterCart: Number.POSITIVE_INFINITY,
      missingIngredients: [],
      limitingIngredients: [],
      isLowServings: false,
    };
  }

  const inventoryById = new Map(inventory.map((item) => [item.id, item]));
  const cartUsage = computeCartIngredientUsage(cart);

  let maxServingsFromStock = Number.POSITIVE_INFINITY;
  let remainingServingsAfterCart = Number.POSITIVE_INFINITY;
  const missingIngredients: MissingIngredientDetail[] = [];
  const limitingIngredients: MissingIngredientDetail[] = [];

  for (const recipe of menu.recipes) {
    if (recipe.quantity_needed <= 0) continue;
    const inv = inventoryById.get(recipe.inventory_item_id);
    if (!inv) continue;

    const currentStock = Math.max(0, Number(inv.current_stock) || 0);
    const totalPossible = Math.floor((currentStock + 1e-9) / recipe.quantity_needed);
    if (totalPossible < maxServingsFromStock) {
      maxServingsFromStock = totalPossible;
    }

    if (totalPossible <= 0) {
      missingIngredients.push({
        inventory_item_id: inv.id,
        name: inv.name,
        unit: inv.unit,
        current_stock: currentStock,
        needed_per_serving: recipe.quantity_needed,
      });
    }

    const reserved = cartUsage.get(inv.id) ?? 0;
    const availableAfterCart = Math.max(0, currentStock - reserved);
    const remainingPossible = Math.floor((availableAfterCart + 1e-9) / recipe.quantity_needed);
    if (remainingPossible < remainingServingsAfterCart) {
      remainingServingsAfterCart = remainingPossible;
    }

    if (remainingPossible <= 0) {
      limitingIngredients.push({
        inventory_item_id: inv.id,
        name: inv.name,
        unit: inv.unit,
        current_stock: currentStock,
        needed_per_serving: recipe.quantity_needed,
      });
    }
  }

  const isOutOfStock = missingIngredients.length > 0 || maxServingsFromStock <= 0;
  const canAddOneMore = !isOutOfStock && remainingServingsAfterCart > 0;
  const isLowServings =
    !isOutOfStock &&
    Number.isFinite(maxServingsFromStock) &&
    maxServingsFromStock >= 1 &&
    maxServingsFromStock <= 3;

  return {
    isOutOfStock,
    canAddOneMore,
    maxServingsFromStock,
    remainingServingsAfterCart,
    missingIngredients,
    limitingIngredients,
    isLowServings,
  };
}

/**
 * Formats a short, clear Indonesian card note listing depleted ingredients.
 */
export function formatMissingIngredientsLabel(missing: MissingIngredientDetail[]): string {
  if (missing.length === 0) return '';
  if (missing.length === 1) {
    return `Bahan habis: ${missing[0].name}`;
  }
  return `Bahan habis: ${missing[0].name} (+${missing.length - 1} lainnya)`;
}
