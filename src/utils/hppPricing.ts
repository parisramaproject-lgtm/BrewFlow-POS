export type PricingTierId = 'competitive' | 'ideal' | 'premium';

export interface OwnerPricingSuggestion {
  id: PricingTierId;
  label: string;
  badge?: string;
  targetFoodCostPercent: number;
  suggestedPrice: number;
  actualFoodCostPercent: number;
  actualMarginPercent: number;
  estimatedProfit: number;
  rationale: string;
  recommended: boolean;
}

export type PricingHealthStatus =
  | 'no_hpp'
  | 'missing_price'
  | 'loss'
  | 'thin'
  | 'fair'
  | 'healthy'
  | 'high';

export interface PricingEvaluation {
  status: PricingHealthStatus;
  title: string;
  message: string;
  foodCostPercent: number;
  marginPercent: number;
  grossProfit: number;
  recommendedMinPrice: number;
}

/**
 * Rounds raw target prices upward to clean, customer-friendly cafe menu increments
 * (Rp 500 increments below Rp 20.000, Rp 1.000 increments at or above Rp 20.000).
 */
export function roundMenuSellingPrice(rawPrice: number): number {
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return 0;
  const step = rawPrice < 20000 ? 500 : 1000;
  return Math.max(1000, Math.ceil(rawPrice / step) * step);
}

/**
 * Generates three structured selling-price suggestions for the coffee shop Owner
 * derived directly from the calculated HPP (COGS per serving).
 */
export function generateOwnerPricingSuggestions(totalHpp: number): OwnerPricingSuggestion[] {
  const cleanHpp = Math.round(totalHpp);
  if (!Number.isFinite(cleanHpp) || cleanHpp <= 0) return [];

  const tiers: Array<{
    id: PricingTierId;
    label: string;
    badge?: string;
    targetFoodCostPercent: number;
    rationale: string;
    recommended: boolean;
  }> = [
    {
      id: 'competitive',
      label: 'Harga Kompetitif',
      targetFoodCostPercent: 35,
      rationale: 'Cocok untuk menu pendorong trafik & harga ramah pelanggan (target FC ~35%).',
      recommended: false,
    },
    {
      id: 'ideal',
      label: 'Rekomendasi Ideal',
      badge: 'Disarankan',
      targetFoodCostPercent: 30,
      rationale: 'Standar sehat coffee shop untuk menutup operasional & menjaga profit (target FC ~30%).',
      recommended: true,
    },
    {
      id: 'premium',
      label: 'Premium / Signature',
      targetFoodCostPercent: 25,
      rationale: 'Cocok untuk menu unggulan / specialty dengan margin kuat (target FC ~25%).',
      recommended: false,
    },
  ];

  let previousPrice = 0;

  return tiers.map((tier) => {
    const rawTarget = cleanHpp / (tier.targetFoodCostPercent / 100);
    let suggestedPrice = roundMenuSellingPrice(rawTarget);
    // Ensure strictly ascending tiers even for very small HPP items
    if (suggestedPrice <= previousPrice) {
      const bump = previousPrice < 20000 ? 500 : 1000;
      suggestedPrice = previousPrice + bump;
    }
    previousPrice = suggestedPrice;

    const estimatedProfit = suggestedPrice - cleanHpp;
    const actualFoodCostPercent = (cleanHpp / suggestedPrice) * 100;
    const actualMarginPercent = (estimatedProfit / suggestedPrice) * 100;

    return {
      id: tier.id,
      label: tier.label,
      badge: tier.badge,
      targetFoodCostPercent: tier.targetFoodCostPercent,
      suggestedPrice,
      actualFoodCostPercent,
      actualMarginPercent,
      estimatedProfit,
      rationale: tier.rationale,
      recommended: tier.recommended,
    };
  });
}

function formatIdrInline(amount: number): string {
  return `Rp ${Math.round(amount).toLocaleString('id-ID')}`;
}

/**
 * Evaluates an Owner's chosen selling price against calculated HPP and returns
 * actionable Indonesian pricing advice.
 */
export function evaluateSellingPriceAgainstHpp(
  sellingPrice: number,
  totalHpp: number
): PricingEvaluation {
  const cleanHpp = Math.round(totalHpp);
  const cleanPrice = Math.round(sellingPrice);
  const suggestions = generateOwnerPricingSuggestions(cleanHpp);
  const idealSuggestion = suggestions.find((s) => s.id === 'ideal');
  const competitiveSuggestion = suggestions.find((s) => s.id === 'competitive');
  const recommendedMinPrice = idealSuggestion?.suggestedPrice ?? 0;

  if (!Number.isFinite(cleanHpp) || cleanHpp <= 0) {
    return {
      status: 'no_hpp',
      title: 'Kalkulasi HPP belum terisi',
      message:
        'Tambahkan komposisi bahan baku/kemasan terlebih dahulu agar sistem dapat menghitung modal HPP dan memberi saran harga jual.',
      foodCostPercent: 0,
      marginPercent: 0,
      grossProfit: 0,
      recommendedMinPrice: 0,
    };
  }

  if (!Number.isFinite(cleanPrice) || cleanPrice <= 0) {
    return {
      status: 'missing_price',
      title: 'Tentukan harga jual berdasarkan saran HPP',
      message: `Modal HPP terhitung ${formatIdrInline(cleanHpp)}. Pilih salah satu saran harga (rekomendasi ideal ${formatIdrInline(recommendedMinPrice)}) atau masukkan nominal sendiri.`,
      foodCostPercent: 0,
      marginPercent: 0,
      grossProfit: -cleanHpp,
      recommendedMinPrice,
    };
  }

  const grossProfit = cleanPrice - cleanHpp;
  const foodCostPercent = (cleanHpp / cleanPrice) * 100;
  const marginPercent = (grossProfit / cleanPrice) * 100;

  if (cleanPrice <= cleanHpp) {
    return {
      status: 'loss',
      title: 'Harga jual di bawah atau sama dengan modal HPP',
      message: `Menu ini berpotensi rugi karena modal HPP ${formatIdrInline(cleanHpp)}. Disarankan naikkan minimal ke ${formatIdrInline(competitiveSuggestion?.suggestedPrice ?? recommendedMinPrice)} (ideal ${formatIdrInline(recommendedMinPrice)}).`,
      foodCostPercent,
      marginPercent,
      grossProfit,
      recommendedMinPrice,
    };
  }

  if (foodCostPercent > 38) {
    return {
      status: 'thin',
      title: 'Margin terlalu tipis (Food Cost > 38%)',
      message: `Biaya bahan memakan ${foodCostPercent.toFixed(1)}% dari harga jual sehingga rawan tergerus biaya sewa & barista. Pertimbangkan menaikkan harga ke kisaran ${formatIdrInline(recommendedMinPrice)}.`,
      foodCostPercent,
      marginPercent,
      grossProfit,
      recommendedMinPrice,
    };
  }

  if (foodCostPercent > 32) {
    return {
      status: 'fair',
      title: 'Margin kompetitif (Food Cost 32%–38%)',
      message: `Profit ${formatIdrInline(grossProfit)}/porsi cukup kompetitif untuk mendorong volume penjualan. Untuk margin lebih aman, kisaran ideal ada di ${formatIdrInline(recommendedMinPrice)}.`,
      foodCostPercent,
      marginPercent,
      grossProfit,
      recommendedMinPrice,
    };
  }

  if (foodCostPercent >= 20) {
    return {
      status: 'healthy',
      title: 'Margin sehat untuk operasional coffee shop',
      message: `Food cost ${foodCostPercent.toFixed(1)}% dengan profit kotor ${formatIdrInline(grossProfit)}/porsi sudah ideal untuk menjaga profitabilitas kedai.`,
      foodCostPercent,
      marginPercent,
      grossProfit,
      recommendedMinPrice,
    };
  }

  return {
    status: 'high',
    title: 'Margin sangat tinggi (Kelas Premium)',
    message: `Profit kotor ${formatIdrInline(grossProfit)}/porsi (margin ${marginPercent.toFixed(1)}%). Pastikan penyajian, porsi, dan kualitas produk sepadan dengan kelas harga premium.`,
    foodCostPercent,
    marginPercent,
    grossProfit,
    recommendedMinPrice,
  };
}
