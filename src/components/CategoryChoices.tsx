import { FINANCIAL_ICONS, financialStyle } from './VisualIdentity';
import type { CategoryConfig, CategoryKey } from '../types';

const ORDER: CategoryKey[] = ['unpaid', 'potential', 'income'];

export function CategoryChoices({ categories, value, onChange }: { categories: CategoryConfig; value: CategoryKey; onChange: (category: CategoryKey) => void }) {
  return <div className="category-card-options" role="group" aria-label="Kategoria przychodu">
    {ORDER.map(key => {
      const style = financialStyle(key, categories);
      const Icon = FINANCIAL_ICONS[key];
      return <button type="button" key={key} aria-pressed={value === key} onClick={() => onChange(key)} className={`category-choice ${value === key ? 'chosen' : ''}`} style={{ '--chip-color': style.color, '--chip-tint': style.tint } as React.CSSProperties}>
        <span className="category-choice-head"><span className="category-choice-symbol"><Icon size={17} strokeWidth={2.2} /></span><strong>{style.label}</strong><span className="category-selected-check">{value === key ? '✓' : ''}</span></span>
        <span className="category-choice-desc">{style.description}</span>
      </button>;
    })}
  </div>;
}
