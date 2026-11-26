import { useState } from 'react';
import { Coffee, Cookie, CupSoda, Utensils } from 'lucide-react';
import type { MenuItem } from '../../types';

interface ProductVisualProps {
  tone: MenuItem['visual_tone'];
  name: string;
  imageUrl?: string;
  size?: 'sm' | 'md';
}

const TONE_MAP: Record<
  MenuItem['visual_tone'],
  { bg: string; iconColor: string; icon: 'coffee' | 'soda' | 'food' | 'snack' }
> = {
  espresso: { bg: 'bg-[#F3EFEA]', iconColor: '#5D4037', icon: 'coffee' },
  latte: { bg: 'bg-[#F5EFE7]', iconColor: '#8D5524', icon: 'coffee' },
  matcha: { bg: 'bg-[#EAF5EE]', iconColor: '#2E7D32', icon: 'soda' },
  berry: { bg: 'bg-[#FDF0F3]', iconColor: '#AD1457', icon: 'soda' },
  chocolate: { bg: 'bg-[#F2ECE9]', iconColor: '#3E2723', icon: 'coffee' },
  citrus: { bg: 'bg-[#FFF8E7]', iconColor: '#D97706', icon: 'soda' },
  pastry: { bg: 'bg-[#FBF4E9]', iconColor: '#B45309', icon: 'snack' },
  savory: { bg: 'bg-[#EEF5F0]', iconColor: '#0D8A4E', icon: 'food' },
};

export function ProductVisual({ tone, name, imageUrl, size = 'md' }: ProductVisualProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const palette = TONE_MAP[tone] ?? TONE_MAP.latte;
  const dim = size === 'sm' ? 'h-10 w-10 rounded-xl' : 'h-24 w-24 rounded-full';

  if (imageUrl && !imgFailed) {
    return (
      <div
        className={`${dim} relative shrink-0 overflow-hidden border border-[#E5E7EB]/80 bg-[#F4F6F5]`}
      >
        <img
          src={imageUrl}
          alt={name}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`${palette.bg} ${dim} flex shrink-0 items-center justify-center border border-[#E5E7EB]/70`}
      role="img"
      aria-label={name}
    >
      {palette.icon === 'coffee' && (
        <Coffee
          className={size === 'sm' ? 'h-5 w-5' : 'h-10 w-10'}
          style={{ color: palette.iconColor }}
          strokeWidth={1.75}
        />
      )}
      {palette.icon === 'soda' && (
        <CupSoda
          className={size === 'sm' ? 'h-5 w-5' : 'h-10 w-10'}
          style={{ color: palette.iconColor }}
          strokeWidth={1.75}
        />
      )}
      {palette.icon === 'food' && (
        <Utensils
          className={size === 'sm' ? 'h-5 w-5' : 'h-10 w-10'}
          style={{ color: palette.iconColor }}
          strokeWidth={1.75}
        />
      )}
      {palette.icon === 'snack' && (
        <Cookie
          className={size === 'sm' ? 'h-5 w-5' : 'h-10 w-10'}
          style={{ color: palette.iconColor }}
          strokeWidth={1.75}
        />
      )}
    </div>
  );
}
