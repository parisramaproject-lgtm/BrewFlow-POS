import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Info, Sparkles, TrendingUp } from 'lucide-react';
import { formatPercent, formatRupiah } from '../../utils/format';
import {
  evaluateSellingPriceAgainstHpp,
  generateOwnerPricingSuggestions,
} from '../../utils/hppPricing';

interface OwnerPricingAdvisorProps {
  totalHpp: number;
  currentSellingPrice: number;
  onSelectSuggestedPrice: (price: number) => void;
  compact?: boolean;
  testIdPrefix?: string;
}

export function OwnerPricingAdvisor({
  totalHpp,
  currentSellingPrice,
  onSelectSuggestedPrice,
  compact = false,
  testIdPrefix = 'pricing-advisor',
}: OwnerPricingAdvisorProps) {
  const suggestions = useMemo(() => generateOwnerPricingSuggestions(totalHpp), [totalHpp]);
  const evaluation = useMemo(
    () => evaluateSellingPriceAgainstHpp(currentSellingPrice, totalHpp),
    [currentSellingPrice, totalHpp]
  );

  if (totalHpp <= 0) {
    return (
      <div
        data-testid={`${testIdPrefix}-empty`}
        className="flex items-start gap-2.5 rounded-xl border border-dashed border-[#D97706]/45 bg-[#FFFBEB] p-3.5 text-xs text-[#92400E]"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#D97706]" />
        <div>
          <p className="font-semibold text-[#92400E]">
            Isi Kalkulasi HPP terlebih dahulu untuk membuka saran harga jual
          </p>
          <p className="mt-0.5 leading-relaxed text-[#B45309]">
            Tambahkan minimal 1 bahan baku atau kemasan pada bagian Kalkulasi HPP di atas agar
            sistem dapat menghitung modal per porsi dan memberikan rekomendasi harga jual terbaik
            untuk Owner.
          </p>
        </div>
      </div>
    );
  }

  const evalStyles =
    evaluation.status === 'loss'
      ? {
          box: 'border-[#EF4444]/35 bg-[#FEF2F2] text-[#991B1B]',
          icon: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#EF4444]" />,
        }
      : evaluation.status === 'thin'
        ? {
            box: 'border-[#F59E0B]/40 bg-[#FFFBEB] text-[#92400E]',
            icon: <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#D97706]" />,
          }
        : evaluation.status === 'fair'
          ? {
              box: 'border-[#3B82F6]/30 bg-[#EFF6FF] text-[#1E40AF]',
              icon: <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-[#2563EB]" />,
            }
          : evaluation.status === 'healthy' || evaluation.status === 'high'
            ? {
                box: 'border-[#109A58]/30 bg-[#E6F5EE] text-[#065F46]',
                icon: <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#109A58]" />,
              }
            : {
                box: 'border-[#E5E7EB] bg-[#F4F6F5] text-[#1A2E26]',
                icon: <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#6B7280]" />,
              };

  return (
    <div data-testid={`${testIdPrefix}-panel`} className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-[#109A58]" />
          <p className="text-xs font-semibold text-[#1A2E26]">
            Saran Harga Jual untuk Owner (Berdasarkan HPP {formatRupiah(totalHpp)})
          </p>
        </div>
        <span className="text-[11px] font-medium text-[#6B7280]">
          Klik salah satu opsi untuk menerapkan harga
        </span>
      </div>

      {/* 3 Pricing Suggestion Cards */}
      <div className={`grid grid-cols-1 gap-2.5 ${compact ? 'sm:grid-cols-3' : 'md:grid-cols-3'}`}>
        {suggestions.map((item) => {
          const isSelected = Math.round(currentSellingPrice) === item.suggestedPrice;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`${testIdPrefix}-tier-${item.id}`}
              onClick={() => onSelectSuggestedPrice(item.suggestedPrice)}
              className={`group flex flex-col justify-between rounded-xl border p-3 text-left transition-all ${
                isSelected
                  ? 'border-[#109A58] bg-[#E6F5EE]/75 ring-2 ring-[#109A58]/20'
                  : item.recommended
                    ? 'border-[#109A58]/45 bg-[#F4FBF7] hover:border-[#109A58]'
                    : 'border-[#E5E7EB] bg-white hover:border-[#109A58]/50 hover:bg-[#F9FAFB]'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[11px] font-semibold text-[#1A2E26]">{item.label}</span>
                  {item.badge && (
                    <span className="rounded-full bg-[#109A58] px-2 py-0.5 text-[10px] font-semibold text-white">
                      {item.badge}
                    </span>
                  )}
                </div>

                <p className="mt-1.5 text-base font-bold text-[#109A58] tabular-nums">
                  {formatRupiah(item.suggestedPrice)}
                </p>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[#6B7280] tabular-nums">
                  <span>FC {formatPercent(item.actualFoodCostPercent)}</span>
                  <span>·</span>
                  <span className="font-semibold text-[#1A2E26]">
                    Laba {formatRupiah(item.estimatedProfit)}
                  </span>
                </div>

                <p className="mt-1.5 text-[10.5px] leading-snug text-[#6B7280]">
                  {item.rationale}
                </p>
              </div>

              <div className="mt-2.5 flex items-center justify-between border-t border-[#E5E7EB]/80 pt-2 text-[11px] font-semibold">
                <span className={isSelected ? 'text-[#109A58]' : 'text-[#6B7280] group-hover:text-[#109A58]'}>
                  {isSelected ? 'Harga terpilih' : 'Gunakan harga ini'}
                </span>
                <span className="text-[10px] text-[#6B7280] tabular-nums">
                  Margin {formatPercent(item.actualMarginPercent)}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Live Evaluation Banner */}
      <div
        data-testid={`${testIdPrefix}-evaluation`}
        className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs ${evalStyles.box}`}
      >
        {evalStyles.icon}
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{evaluation.title}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed opacity-90">{evaluation.message}</p>
        </div>
      </div>
    </div>
  );
}
