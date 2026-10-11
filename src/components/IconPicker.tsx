import { useMemo, useState } from 'react';
import { Search, Shapes } from 'lucide-react';
import { TaskIcon, ICON_OPTIONS, ICON_GROUP_ALL, POPULAR_ICON_NAMES, iconGroup } from '../lib/icons';
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

export function IconPicker({value,onSelect}:{value:IconKey;onSelect:(icon:IconKey)=>void}) {
  const [query,setQuery] = useState('');
  const [group,setGroup] = useState('popular');
  const [limit,setLimit] = useState(48);
  const filtered = useMemo(() => {
    const q=normalize(query);
    const englishTerm = aliases[query.toLowerCase()] ?? aliases[q] ?? '';
    const matchedGroups = ICON_GROUP_ALL.filter(g=>g.aliases && normalize(g.label+' '+g.aliases).includes(q)).map(g=>g.id);
    const source = q ? ICON_OPTIONS : group==='popular' ? POPULAR_ICON_NAMES : ICON_OPTIONS.filter(name=>iconGroup(name)===group);
    return source.filter(name=>!q || name.includes(q.replace(/\s+/g,'-')) || (englishTerm && name.includes(englishTerm)) || matchedGroups.includes(iconGroup(name)));
  },[query,group]);
  const selectGroup=(next:string)=>{setGroup(next);setLimit(48);setQuery('');};
  return <div className="asset-picker icon-catalog">
    <div className="asset-picker-top"><strong><Shapes size={16}/> Biblioteka ikon Lucide</strong><span>{ICON_OPTIONS.length.toLocaleString('pl-PL')} ikon</span></div>
    <label className="asset-search"><Search size={16}/><input autoFocus placeholder="Szukaj, np. rower, serce, praca, camera…" value={query} onChange={e=>{setQuery(e.target.value);setLimit(48);}} /></label>
    <div className="asset-groups">{ICON_GROUP_ALL.map(c=><button key={c.id} className={!query && group===c.id?'selected':''} onClick={()=>selectGroup(c.id)}>{c.label}</button>)}</div>
    <div className="asset-results-heading"><span>{query?`Wyniki dla „${query}”`:ICON_GROUP_ALL.find(g=>g.id===group)?.label}</span><small>{filtered.length} ikon</small></div>
    <div className="icon-catalog-grid">{filtered.slice(0,limit).map(name=><button type="button" key={name} title={name} aria-label={`Wybierz ikonę ${name}`} className={value===name?'selected':''} onClick={()=>onSelect(name)}><TaskIcon name={name} size={22}/></button>)}</div>
    {filtered.length===0&&<p className="asset-no-results">Nie znaleziono ikony. Spróbuj innego słowa.</p>}
    {limit<filtered.length&&<button className="asset-more" onClick={()=>setLimit(x=>x+48)}>Pokaż więcej ikon ({filtered.length-limit} pozostało)</button>}
    <small className="asset-tip">Ikony doczytują się na bieżąco. Wyszukiwarka obsługuje polskie i angielskie hasła.</small>
  </div>;
}
