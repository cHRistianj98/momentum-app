import type { CategoryConfig, CategoryKey } from '../types';
const ORDER: CategoryKey[]=['unpaid','potential','income'];
export function CategoryChoices({categories,value,onChange}:{categories:CategoryConfig;value:CategoryKey;onChange:(category:CategoryKey)=>void}) {
  return <div className="category-card-options" role="group" aria-label="Kategoria przychodu">
    {ORDER.map(key=><button type="button" key={key} aria-pressed={value===key} onClick={()=>onChange(key)} className={`category-choice ${value===key?'chosen':''}`} style={{'--chip-color':categories[key].color,'--chip-tint':categories[key].tint} as React.CSSProperties}>
      <span className="category-choice-head"><span className="category-dot"/><strong>{categories[key].label}</strong><span className="category-selected-check">{value===key?'✓':''}</span></span>
      <span className="category-choice-desc">{categories[key].description}</span>
    </button>)}
  </div>;
}
