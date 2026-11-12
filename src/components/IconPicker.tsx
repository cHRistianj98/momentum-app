import { useMemo, useState } from 'react';
import { Search, Shapes } from 'lucide-react';
import { TaskIcon, ICON_OPTIONS, ICON_GROUP_ALL, POPULAR_ICON_NAMES, iconGroup } from '../lib/icons';
import { formatNumber, plural, tr } from '../lib/i18n';
import type { IconKey } from '../types';

const aliases: Record<string,string> = {
  'rower':'bike','silownia':'dumbbell','książka':'book','ksiazka':'book',
  'praca':'briefcase','komputer':'laptop','pieniadze':'wallet','pieniądze':'wallet',
  'dom':'house','telewizja':'tv','samochod':'car','samochód':'car',
  'gotowanie':'utensils','sprzatanie':'trash','sprzątanie':'trash',
  'muzyka':'music','kawa':'coffee','urlop':'plane','podroz':'plane',
  'podróż':'plane','sen':'bed','nauka':'book','bieganie':'footprints',
  'kalendarz':'calendar','telefon':'phone','zakupy':'shopping',
};
const normalize = (value:string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
/** Po polsku zawsze „ikon” (jak dotąd), po angielsku 1 icon / icons. */
const iconsLabel = (count:number) => plural(count,['ikon','ikon','ikon'],['icon','icons']);

export function IconPicker({value,onSelect}:{value:IconKey;onSelect:(icon:IconKey)=>void}) {
  const [query,setQuery] = useState('');
  const [group,setGroup] = useState('popular');
  const [limit,setLimit] = useState(48);
  const filtered = useMemo(() => {
    const q=normalize(query);
    const englishTerm = aliases[query.toLowerCase()] ?? aliases[q] ?? '';
    // Nazwy grup i hasła w obu językach — wynik nie zależy od języka interfejsu.
    const matchedGroups = ICON_GROUP_ALL.filter(g=>g.aliases && normalize(`${g.labels.pl} ${g.labels.en} ${g.aliases}`).includes(q)).map(g=>g.id);
    const source = q ? ICON_OPTIONS : group==='popular' ? POPULAR_ICON_NAMES : ICON_OPTIONS.filter(name=>iconGroup(name)===group);
    return source.filter(name=>!q || name.includes(q.replace(/\s+/g,'-')) || (englishTerm && name.includes(englishTerm)) || matchedGroups.includes(iconGroup(name)));
  },[query,group]);
  const selectGroup=(next:string)=>{setGroup(next);setLimit(48);setQuery('');};
  return <div className="asset-picker icon-catalog">
    <div className="asset-picker-top"><strong><Shapes size={16}/> {tr('Biblioteka ikon Lucide','Lucide icon library')}</strong><span>{formatNumber(ICON_OPTIONS.length)} {iconsLabel(ICON_OPTIONS.length)}</span></div>
    <label className="asset-search"><Search size={16}/><input autoFocus placeholder={tr('Szukaj, np. rower, serce, praca, camera…','Search, e.g. bike, heart, work, camera…')} value={query} onChange={e=>{setQuery(e.target.value);setLimit(48);}} /></label>
    <div className="asset-groups">{ICON_GROUP_ALL.map(c=><button key={c.id} className={!query && group===c.id?'selected':''} onClick={()=>selectGroup(c.id)}>{c.label}</button>)}</div>
    <div className="asset-results-heading"><span>{query?tr(`Wyniki dla „${query}”`,`Results for “${query}”`):ICON_GROUP_ALL.find(g=>g.id===group)?.label}</span><small>{filtered.length} {iconsLabel(filtered.length)}</small></div>
    <div className="icon-catalog-grid">{filtered.slice(0,limit).map(name=><button type="button" key={name} title={name} aria-label={tr(`Wybierz ikonę ${name}`,`Choose the ${name} icon`)} className={value===name?'selected':''} onClick={()=>onSelect(name)}><TaskIcon name={name} size={22}/></button>)}</div>
    {filtered.length===0&&<p className="asset-no-results">{tr('Nie znaleziono ikony. Spróbuj innego słowa.','No icons found. Try another word.')}</p>}
    {limit<filtered.length&&<button className="asset-more" onClick={()=>setLimit(x=>x+48)}>{tr(`Pokaż więcej ikon (${filtered.length-limit} pozostało)`,`Show more icons (${filtered.length-limit} left)`)}</button>}
    <small className="asset-tip">{tr('Ikony doczytują się na bieżąco. Wyszukiwarka obsługuje polskie i angielskie hasła.','Icons load on demand. Search works with both English and Polish terms.')}</small>
  </div>;
}
