import { useMemo, useState } from 'react';
import { Camera, Search, X } from 'lucide-react';
import { PHOTO_GROUPS, PHOTO_OPTIONS } from '../lib/photos';
import { plural, tr } from '../lib/i18n';

const normalize=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
/** 1 miniaturka, 2–4 miniaturki, 5+ miniaturek (z wyjątkiem 12–14); po angielsku 1 thumbnail / thumbnails. */
const thumbnailsLabel=(count:number)=>plural(count,['miniaturka','miniaturki','miniaturek'],['thumbnail','thumbnails']);
export function PhotoPicker({value,onSelect}:{value?:string;onSelect:(image?:string)=>void}) {
  const [query,setQuery]=useState('');
  const [group,setGroup]=useState('all');
  // Szukamy po tytułach i nazwach grup w obu językach (`keywords`), więc wynik nie zależy od języka interfejsu.
  const filtered=useMemo(()=>PHOTO_OPTIONS.filter(p=>(group==='all'||p.group===group)&&(!query||normalize(p.keywords).includes(normalize(query)))),[group,query]);
  return <div className="asset-picker photo-catalog">
    <div className="asset-picker-top"><strong><Camera size={16}/> {tr('Miniatury do zadań i rutyn','Thumbnails for tasks and routines')}</strong><span>{tr(`${PHOTO_OPTIONS.length} zdjęć`,`${PHOTO_OPTIONS.length} photos`)}</span></div>
    <label className="asset-search"><Search size={16}/><input placeholder={tr('Szukaj np. praca, sport, kuchnia…','Search, e.g. work, sport, cooking…')} value={query} onChange={e=>setQuery(e.target.value)}/></label>
    <div className="asset-groups"><button className={group==='all'?'selected':''} onClick={()=>setGroup('all')}>{tr('Wszystkie','All')}</button>{PHOTO_GROUPS.map(g=><button key={g.id} className={group===g.id?'selected':''} onClick={()=>setGroup(g.id)}>{g.label}</button>)}</div>
    <div className="asset-results-heading"><span>{tr('Wybierz zdjęcie','Choose a photo')}</span><small>{filtered.length} {thumbnailsLabel(filtered.length)}</small></div>
    <div className="photo-catalog-grid">{filtered.map(p=><button className={value===p.src?'selected':''} key={p.id} title={p.title} type="button" onClick={()=>onSelect(p.src)}><img src={p.src} alt={p.title} loading="lazy"/><span>{p.title}</span></button>)}</div>
    {filtered.length===0&&<p className="asset-no-results">{tr('Nie znaleziono zdjęcia.','No photos found.')}</p>}
    {value&&<button className="asset-remove" type="button" onClick={()=>onSelect(undefined)}><X size={14}/> {tr('Usuń wybrane zdjęcie','Remove selected photo')}</button>}
    <small className="asset-tip">{tr(`${PHOTO_OPTIONS.length} lokalnych miniaturek WebP, działają również bez połączenia z internetem.`,`${PHOTO_OPTIONS.length} local WebP thumbnails — they work offline, too.`)}</small>
  </div>;
}
