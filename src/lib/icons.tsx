import { lazy, Suspense, type ComponentType } from 'react';
import { Target } from 'lucide-react';
import dynamicIconImports from 'lucide-react/dynamicIconImports';
import type { IconKey } from '../types';

// Dynamic import map: the ~thousands of icons are NOT in the initial React bundle.
// Each displayed icon is loaded on demand, with lazy components cached globally.
export const ICON_OPTIONS = Object.keys(dynamicIconImports).filter(name => !name.endsWith('-icon')).sort();
const availableNames = new Set(ICON_OPTIONS);
const oldNames: Record<string, string> = {
  briefcase: 'briefcase-business', code: 'code-2', dumbbell: 'dumbbell',
  book: 'book-open', sparkles: 'sparkles', coffee: 'coffee', sun: 'sun',
  home: 'house', tv: 'tv', shopping: 'shopping-basket', heart: 'heart',
  camera: 'camera', music: 'music-2', graduation: 'graduation-cap',
  target: 'target', wallet: 'wallet-cards', running: 'footprints',
  leaf: 'leaf', check: 'check-check',
};
const loadedIcons = new Map<string, ComponentType<{size?:number; strokeWidth?:number}>>();

export function TaskIcon({ name, size = 19, strokeWidth = 1.9 }: {name: IconKey; size?: number; strokeWidth?: number}) {
  const resolved = availableNames.has(name) ? name : oldNames[name] ?? 'target';
  const validName = availableNames.has(resolved) ? resolved : 'target';
  let Component = loadedIcons.get(validName);
  if (!Component) {
    const importIcon = dynamicIconImports[validName as keyof typeof dynamicIconImports];
    Component = lazy(importIcon) as ComponentType<{ size?: number; strokeWidth?: number }>;
    loadedIcons.set(validName, Component);
  }
  return <Suspense fallback={<Target size={size} strokeWidth={strokeWidth} style={{opacity:.4}}/>}>
    <Component size={size} strokeWidth={strokeWidth}/>
  </Suspense>;
}

interface GroupDefinition { id: string; label: string; match: RegExp; aliases: string }
export const ICON_GROUPS: GroupDefinition[] = [
  { id:'work',label:'Praca i biznes',match:/briefcase|building|office|factory|calendar|presentation|handshake|file|clipboard|contact|badge|user-round|users|network|chart|trending|award|receipt|signature/,aliases:'praca biuro biznes firma spotkanie dokument kontrakt klienci' },
  { id:'money',label:'Finanse i zakupy',match:/bank|coins?|wallet|credit|euro|dollar|pound|bitcoin|cash|money|receipt|piggy|shopping|store|package|badge-dollar|currency|percent|landmark/,aliases:'pieniadze finanse zakupy sklep portfel kasa bank sprzedaz inwestycje oszczednosci' },
  { id:'tech',label:'Technologia',match:/code|terminal|laptop|computer|monitor|keyboard|mouse|cpu|server|database|cloud|wifi|bluetooth|binary|braces|git-|github|hard-drive|smartphone|tablet|circuit|router|bug|bot|plug/,aliases:'programowanie kod komputer tworzenie aplikacji projekt aplikacja it internet urzadzenia' },
  { id:'health',label:'Sport i zdrowie',match:/dumbbell|bike|footprints|activity|heart|pulse|stethoscope|hospital|pill|syringe|weight|timer|trophy|medal|target|volleyball|football|basketball|swim|waves|person-standing|accessibility|biceps|nutrition|ambulance|cross/,aliases:'trening silownia rower bieganie spacer sport zdrowie cwiczenia fitness' },
  { id:'home',label:'Dom i obowiązki',match:/house|home|bed|bath|shower|sofa|armchair|lamp|door|key|paint|hammer|wrench|drill|trash|recycle|washing|shirt|soap|spray|clean|toilet|leaf|flower|tree|sunflower|tractor/,aliases:'dom sprzatanie ogrod pranie remont porzadki mieszkanie' },
  { id:'food',label:'Jedzenie i napoje',match:/coffee|cup|utensils|fork|knife|chef|cooking|pan|pizza|hamburger|sandwich|cake|cookie|ice-cream|beer|wine|glass|milk|apple|banana|carrot|fish|beef|egg|salad|candy|citrus|soup/,aliases:'jedzenie gotowanie sniadanie obiad kolacja kuchnia napoje posilek' },
  { id:'learning',label:'Nauka i rozwój',match:/book|graduation|school|notebook|pencil|pen|library|brain|glasses|languages|letter|spell|scroll|lightbulb|telescope|microscope|flask|atom|puzzle|notepad|bookmark/,aliases:'nauka ksiazki czytanie kurs szkolenie edukacja rozwoj wiedza' },
  { id:'travel',label:'Podróże i transport',match:/plane|train|car-|car$|bus|bike|ship|boat|sail|truck|map|navigation|compass|route|tent|mountain|globe|earth|suitcase|luggage|hotel|passport|ticket|fuel|signpost/,aliases:'podroz wycieczka wakacje auto samochod pociag samolot autobus rower mapa turystyka' },
  { id:'leisure',label:'Rozrywka i hobby',match:/tv|film|video|camera|image|music|audio|headphones|gamepad|joystick|guitar|piano|mic-|microphone|palette|paintbrush|drama|popcorn|clapper|dice|chess|party|smile|gift|star|sparkles/,aliases:'rozrywka film telewizja gry muzyka hobby zdjecia kultura kino' },
  { id:'time',label:'Czas i planowanie',match:/clock|alarm|hourglass|calendar|timer|watch|sun|moon|sunrise|sunset|repeat|refresh|rotate|check|circle|list|bell|hour|schedule|flag/,aliases:'kalendarz czas data rutyna planowanie priorytety przypomnienia nawyki' },
  { id:'people',label:'Ludzie i relacje',match:/user|users|person|baby|hand|heart|message|mail|phone|contact|speech|smile|frown|laugh|thumbs|hug|accessibility/,aliases:'ludzie rodzina relacje spotkanie dziecko rozmowa przyjaciele' },
  { id:'nature',label:'Natura i pogoda',match:/cloud|sun|moon|wind|rain|snow|thermometer|tree|leaf|flower|mountain|water|waves|fish|dog|cat|bird|rabbit|paw|earth|sprout/,aliases:'natura przyroda pogoda zwierzeta spacer swieze powietrze' },
];

export function iconGroup(name: string) {
  return ICON_GROUPS.find(g => g.match.test(name))?.id ?? 'other';
}
export const ICON_GROUP_ALL = [
  {id:'popular',label:'Popularne',aliases:''},
  ...ICON_GROUPS.map(({id,label,aliases})=>({id,label,aliases})),
  {id:'other',label:'Pozostałe',aliases:''},
];
export const POPULAR_ICON_NAMES = [
  'sun', 'alarm-clock', 'calendar-days', 'check-check', 'target', 'sparkles',
  'dumbbell', 'bike', 'footprints', 'heart', 'book-open', 'graduation-cap',
  'code-2', 'laptop', 'briefcase-business', 'wallet-cards', 'coins', 'piggy-bank',
  'shopping-basket', 'house', 'coffee', 'utensils', 'tv', 'music-2',
  'plane', 'mountain', 'camera', 'bed', 'list-todo', 'clock', 'flower-2', 'trophy',
].filter(name => availableNames.has(name));
