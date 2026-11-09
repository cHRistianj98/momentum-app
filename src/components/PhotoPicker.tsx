import { useMemo, useState } from 'react';
import { Camera, Search, X } from 'lucide-react';
import { PHOTO_GROUPS, PHOTO_OPTIONS } from '../lib/photos';

const normalize=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
/** 1 miniaturka, 2–4 miniaturki, 5+ miniaturek (z wyjątkiem 12–14). */
const thumbnailsLabel=(count:number)=>count===1?'miniaturka':count%10>=2&&count%10<=4&&(count%100<12||count%100>14)?'miniaturki':'miniaturek';
export function PhotoPicker({value,onSelect}:{value?:string;onSelect:(image?:string)=>void}) {
  const [query,setQuery]=useState('');
  const [group,setGroup]=useState('all');
  const filtered=useMemo(()=>PHOTO_OPTIONS.filter(p=>(group==='all'||p.group===group)&&(!query||normalize(`${p.title} ${p.groupLabel}`).includes(normalize(query)))),[group,query]);
  return <div className="asset-picker photo-catalog">
    <div className="asset-picker-top"><strong><Camera size={16}/> Miniatury do zadań i rutyn</strong><span>{PHOTO_OPTIONS.length} zdjęć</span></div>
    <label className="asset-search"><Search size={16}/><input placeholder="Szukaj np. praca, sport, kuchnia…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="asset-groups"><button className={group==='all'?'selected':''} onClick={()=>setGroup('all')}>Wszystkie</button>{PHOTO_GROUPS.map(g=><button key={g.id} className={group===g.id?'selected':''} onClick={()=>setGroup(g.id)}>{g.label}</button>)}</div>
    <div className="asset-results-heading"><span>Wybierz zdjęcie</span><small>{filtered.length} {thumbnailsLabel(filtered.length)}</small></div>
    <div className="photo-catalog-grid">{filtered.map(p=><button className={value===p.src?'selected':''} key={p.id} title={p.title} type="button" onClick={()=>onSelect(p.src)}><img src={p.src} alt={p.title} loading="lazy"/><span>{p.title}</span></button>)}</div>
    {filtered.length===0&&<p className="asset-no-results">Nie znaleziono zdjęcia.</p>}
    {value&&<button className="asset-remove" type="button" onClick={()=>onSelect(undefined)}><X size={14}/> Usuń wybrane zdjęcie</button>}
    <small className="asset-tip">{PHOTO_OPTIONS.length} lokalnych miniaturek WebP, działają również bez połączenia z internetem.</small>
  </div>;
}
