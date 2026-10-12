import { CircleMinus, Sprout, Wallet } from 'lucide-react';
import { TaskIcon } from '../lib/icons';
import type { CategoryConfig, CategoryKey, IconKey } from '../types';

const FALLBACK_STYLES = {
  unpaid: { label: 'Bez przychodu', description: '', color: '#ed5e67', tint: '#fff0f1' },
  potential: { label: 'Potencjalny przychód', description: '', color: '#d59a20', tint: '#fff8e7' },
  income: { label: 'Przychód', description: '', color: '#17a76c', tint: '#eaf9f1' },
} as const;

export const FINANCIAL_ICONS = {
  unpaid: CircleMinus,
  potential: Sprout,
  income: Wallet,
};

const shortLabels = {
  unpaid: 'Bez przychodu',
  potential: 'Potencjał',
  income: 'Przychód',
};

export function financialStyle(category: CategoryKey, categories: CategoryConfig) {
  return categories?.[category] ?? FALLBACK_STYLES[category] ?? FALLBACK_STYLES.unpaid;
}

interface CategoryBadgeProps {
  category: CategoryKey;
  categories: CategoryConfig;
  compact?: boolean;
  iconOnly?: boolean;
  className?: string;
}

export function CategoryBadge({ category, categories, compact = false, iconOnly = false, className = '' }: CategoryBadgeProps) {
  const safeCategory = category in FINANCIAL_ICONS ? category : 'unpaid';
  const Icon = FINANCIAL_ICONS[safeCategory];
  const colors = financialStyle(safeCategory, categories);
  const label = shortLabels[safeCategory];
  return <span
    className={`financial-badge financial-badge--${safeCategory} ${compact ? 'financial-badge--compact' : ''} ${iconOnly ? 'financial-badge--icon' : ''} ${className}`.trim()}
    style={{ '--financial-color': colors.color, '--financial-tint': colors.tint } as React.CSSProperties}
    title={label}
    aria-label={iconOnly ? label : undefined}
  >
    <Icon size={compact ? 12 : 14} strokeWidth={2.25} aria-hidden="true" />
    {!iconOnly && <span>{label}</span>}
  </span>;
}

interface TaskVisualProps {
  icon: IconKey;
  image?: string;
  category: CategoryKey;
  categories: CategoryConfig;
  className?: string;
  size?: 'mini' | 'small' | 'medium' | 'large' | 'hero';
}

export function TaskVisual({ icon, image, category, categories, className = '', size = 'medium' }: TaskVisualProps) {
  const colors = financialStyle(category, categories);
  return <span
    className={`visual-tile visual-tile--${size} visual-tile--${category} ${image ? 'has-image' : ''} ${className}`.trim()}
    style={{ '--visual-color': colors.color, '--visual-tint': colors.tint } as React.CSSProperties}
  >
    {image && <img src={image} alt="" loading="lazy" />}
    <span className="visual-tile-badge"><TaskIcon name={icon} size={size === 'hero' ? 33 : size === 'large' ? 29 : size === 'medium' ? 24 : size === 'small' ? 21 : 17} strokeWidth={2.1} /></span>
  </span>;
}
