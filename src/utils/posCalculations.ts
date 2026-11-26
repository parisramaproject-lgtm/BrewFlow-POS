import type { CartItem, InventoryItem, MemberTier, MenuRecipeItem } from '../types';

export const TAX_RATE = 0.1;

export function getMemberDiscountRate(tier: MemberTier | null): number {
  if (!tier) return 0;
  switch (tier) {
    case 'Platinum':
      return 0.15;
    case 'Gold':
      return 0.1;
    case 'Silver':
      return 0.05;
  }
}

export interface TaxConfig {
  taxEnabled: boolean;
  taxPercent: number;
}

export interface CartSummary {
  itemCount: number;
  subtotal: number;
  discountRate: number;
  discountAmount: number;
  taxableAmount: number;
  taxEnabled: boolean;
  taxPercent: number;
  taxAmount: number;
  totalAmount: number;
  pointsEarned: number;
}

export function calculateCartSummary(
  items: CartItem[],
  memberTier: MemberTier | null,
  taxConfig: TaxConfig = { taxEnabled: true, taxPercent: TAX_RATE * 100 }
): CartSummary {
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce((sum, item) => sum + item.menu.selling_price * item.quantity, 0);
  const discountRate = getMemberDiscountRate(memberTier);
  const discountAmount = Math.round(subtotal * discountRate);
  const taxableAmount = Math.max(0, subtotal - discountAmount);
  const effectiveTaxPercent = taxConfig.taxEnabled ? Math.max(0, taxConfig.taxPercent) : 0;
  const taxAmount = Math.round(taxableAmount * (effectiveTaxPercent / 100));
  const totalAmount = taxableAmount + taxAmount;
  const pointsEarned = memberTier ? Math.floor(totalAmount / 10000) : 0;

  return {
    itemCount,
    subtotal,
    discountRate,
    discountAmount,
    taxableAmount,
    taxEnabled: taxConfig.taxEnabled,
    taxPercent: effectiveTaxPercent,
    taxAmount,
    totalAmount,
    pointsEarned,
  };
}

export interface MenuHppResult {
  totalHpp: number;
  grossProfit: number;
  foodCostPercent: number;
  marginPercent: number;
}

export function calculateMenuHpp(
  sellingPrice: number,
  recipes: MenuRecipeItem[],
  inventoryItems: InventoryItem[]
): MenuHppResult {
  const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));
  const totalHpp = recipes.reduce((sum, recipe) => {
    const inv = inventoryById.get(recipe.inventory_item_id);
    if (!inv) return sum;
    return sum + inv.last_purchase_price * recipe.quantity_needed;
  }, 0);

  const roundedHpp = Math.round(totalHpp);
  const grossProfit = sellingPrice - roundedHpp;
  const foodCostPercent = sellingPrice > 0 ? (roundedHpp / sellingPrice) * 100 : 0;
  const marginPercent = sellingPrice > 0 ? (grossProfit / sellingPrice) * 100 : 0;

  return {
    totalHpp: roundedHpp,
    grossProfit,
    foodCostPercent,
    marginPercent,
  };
}

export function calculateOpnameVariance(systemStock: number, actualStock: number): number {
  return Number((actualStock - systemStock).toFixed(2));
}
