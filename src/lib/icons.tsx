import { lazy, Suspense, type ComponentType } from 'react';
import { Target } from 'lucide-react';
import dynamicIconImports from 'lucide-react/dynamicIconImports';
import type { IconKey } from '../types';
import { text, type Localized } from './i18n';

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

/** Grupa w wyszukiwarce: `label` w bieżącym języku (getter), `labels` i `aliases` — hasła po polsku i po angielsku. */
interface IconGroupOption { id: string; readonly label: string; labels: Localized; aliases: string }
interface GroupDefinition extends IconGroupOption { match: RegExp }
interface GroupSource { id: string; labels: Localized; match: RegExp; aliases: Localized }

const groupOption = (id: string, labels: Localized, aliases = ''): IconGroupOption => ({
  id, labels, aliases,
  get label() { return text(labels); },
});
// Object.assign dopisuje `match` do obiektu z getterem (rozwinięcie `...` policzyłoby `label` raz, w jednym języku).
const defineGroup = ({ id, labels, match, aliases }: GroupSource): GroupDefinition =>
  Object.assign(groupOption(id, labels, `${aliases.pl} ${aliases.en}`), { match });
const GROUP_SOURCES: GroupSource[] = [
  { id:'work',labels:{pl:'Praca i biznes',en:'Work & business'},match:/briefcase|building|office|factory|calendar|presentation|handshake|file|clipboard|contact|badge|user-round|users|network|chart|trending|award|receipt|signature/,aliases:{pl:'praca biuro biznes firma spotkanie dokument kontrakt klienci',en:'work office business company meeting document contract clients job'} },
  { id:'money',labels:{pl:'Finanse i zakupy',en:'Finance & shopping'},match:/bank|coins?|wallet|credit|euro|dollar|pound|bitcoin|cash|money|receipt|piggy|shopping|store|package|badge-dollar|currency|percent|landmark/,aliases:{pl:'pieniadze finanse zakupy sklep portfel kasa bank sprzedaz inwestycje oszczednosci',en:'money finance shopping store shop wallet cash bank sales investments savings budget'} },
  { id:'tech',labels:{pl:'Technologia',en:'Technology'},match:/code|terminal|laptop|computer|monitor|keyboard|mouse|cpu|server|database|cloud|wifi|bluetooth|binary|braces|git-|github|hard-drive|smartphone|tablet|circuit|router|bug|bot|plug/,aliases:{pl:'programowanie kod komputer tworzenie aplikacji projekt aplikacja it internet urzadzenia',en:'programming code computer app development project application it internet devices software'} },
  { id:'health',labels:{pl:'Sport i zdrowie',en:'Sports & health'},match:/dumbbell|bike|footprints|activity|heart|pulse|stethoscope|hospital|pill|syringe|weight|timer|trophy|medal|target|volleyball|football|basketball|swim|waves|person-standing|accessibility|biceps|nutrition|ambulance|cross/,aliases:{pl:'trening silownia rower bieganie spacer sport zdrowie cwiczenia fitness',en:'workout gym bike running walk sport sports health exercise fitness training'} },
  { id:'home',labels:{pl:'Dom i obowiązki',en:'Home & chores'},match:/house|home|bed|bath|shower|sofa|armchair|lamp|door|key|paint|hammer|wrench|drill|trash|recycle|washing|shirt|soap|spray|clean|toilet|leaf|flower|tree|sunflower|tractor/,aliases:{pl:'dom sprzatanie ogrod pranie remont porzadki mieszkanie',en:'home house cleaning garden laundry renovation chores tidying apartment'} },
  { id:'food',labels:{pl:'Jedzenie i napoje',en:'Food & drinks'},match:/coffee|cup|utensils|fork|knife|chef|cooking|pan|pizza|hamburger|sandwich|cake|cookie|ice-cream|beer|wine|glass|milk|apple|banana|carrot|fish|beef|egg|salad|candy|citrus|soup/,aliases:{pl:'jedzenie gotowanie sniadanie obiad kolacja kuchnia napoje posilek',en:'food cooking breakfast lunch dinner kitchen drinks meal'} },
  { id:'learning',labels:{pl:'Nauka i rozwój',en:'Learning & growth'},match:/book|graduation|school|notebook|pencil|pen|library|brain|glasses|languages|letter|spell|scroll|lightbulb|telescope|microscope|flask|atom|puzzle|notepad|bookmark/,aliases:{pl:'nauka ksiazki czytanie kurs szkolenie edukacja rozwoj wiedza',en:'learning books reading course training education growth knowledge study'} },
  { id:'travel',labels:{pl:'Podróże i transport',en:'Travel & transport'},match:/plane|train|car-|car$|bus|bike|ship|boat|sail|truck|map|navigation|compass|route|tent|mountain|globe|earth|suitcase|luggage|hotel|passport|ticket|fuel|signpost/,aliases:{pl:'podroz wycieczka wakacje auto samochod pociag samolot autobus rower mapa turystyka',en:'travel trip vacation holiday car train plane bus bike map tourism'} },
  { id:'leisure',labels:{pl:'Rozrywka i hobby',en:'Leisure & hobbies'},match:/tv|film|video|camera|image|music|audio|headphones|gamepad|joystick|guitar|piano|mic-|microphone|palette|paintbrush|drama|popcorn|clapper|dice|chess|party|smile|gift|star|sparkles/,aliases:{pl:'rozrywka film telewizja gry muzyka hobby zdjecia kultura kino',en:'entertainment movie film tv television games music hobby photos culture cinema'} },
  { id:'time',labels:{pl:'Czas i planowanie',en:'Time & planning'},match:/clock|alarm|hourglass|calendar|timer|watch|sun|moon|sunrise|sunset|repeat|refresh|rotate|check|circle|list|bell|hour|schedule|flag/,aliases:{pl:'kalendarz czas data rutyna planowanie priorytety przypomnienia nawyki',en:'calendar time date routine planning priorities reminders habits schedule'} },
  { id:'people',labels:{pl:'Ludzie i relacje',en:'People & relationships'},match:/user|users|person|baby|hand|heart|message|mail|phone|contact|speech|smile|frown|laugh|thumbs|hug|accessibility/,aliases:{pl:'ludzie rodzina relacje spotkanie dziecko rozmowa przyjaciele',en:'people family relationships meeting child kids conversation friends'} },
  { id:'nature',labels:{pl:'Natura i pogoda',en:'Nature & weather'},match:/cloud|sun|moon|wind|rain|snow|thermometer|tree|leaf|flower|mountain|water|waves|fish|dog|cat|bird|rabbit|paw|earth|sprout/,aliases:{pl:'natura przyroda pogoda zwierzeta spacer swieze powietrze',en:'nature weather animals walk fresh air outdoors'} },
];
export const ICON_GROUPS: GroupDefinition[] = GROUP_SOURCES.map(defineGroup);

export function iconGroup(name: string) {
  return ICON_GROUPS.find(g => g.match.test(name))?.id ?? 'other';
}
export const ICON_GROUP_ALL: IconGroupOption[] = [
  groupOption('popular', {pl:'Popularne',en:'Popular'}),
  ...ICON_GROUPS,
  groupOption('other', {pl:'Pozostałe',en:'Other'}),
];
export const POPULAR_ICON_NAMES = [
  'sun', 'alarm-clock', 'calendar-days', 'check-check', 'target', 'sparkles',
  'dumbbell', 'bike', 'footprints', 'heart', 'book-open', 'graduation-cap',
  'code-2', 'laptop', 'briefcase-business', 'wallet-cards', 'coins', 'piggy-bank',
  'shopping-basket', 'house', 'coffee', 'utensils', 'tv', 'music-2',
  'plane', 'mountain', 'camera', 'bed', 'list-todo', 'clock', 'flower-2', 'trophy',
].filter(name => availableNames.has(name));
