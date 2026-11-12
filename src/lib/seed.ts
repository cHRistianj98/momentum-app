import type { AppData, CategoryConfig, CategoryKey, CategoryStyle, Task, TaskPreset, Routine } from '../types';
import { shiftDate, todayKey } from './date';
import { detectLanguage, text, tr, type Language, type Localized } from './i18n';
import { routineXp, taskXp } from './xp';

interface CategoryDefault { label: Localized; description: Localized; color: string; tint: string }

/** Nazwy i opisy kategorii w obu językach; kolory wspólne. */
const CATEGORY_DEFAULTS: Record<CategoryKey, CategoryDefault> = {
  unpaid: {
    label: { pl: 'Bez przychodu', en: 'No income' },
    description: {
      pl: 'Nie przynosi pieniędzy: siłownia, gotowanie, sprzątanie, odpoczynek, TV.',
      en: 'Earns no money: gym, cooking, cleaning, rest, TV.',
    },
    color: '#ed5e67', tint: '#fff0f0',
  },
  potential: {
    label: { pl: 'Możliwy przychód', en: 'Potential income' },
    description: {
      pl: 'Nie zarabia teraz, ale może w przyszłości: tworzenie aplikacji, kursy, wystawienie oferty na OLX.',
      en: 'Earns nothing yet, but may in the future: building apps, courses, listing an item for sale.',
    },
    color: '#e7a72f', tint: '#fff6df',
  },
  income: {
    label: { pl: 'Przychód', en: 'Income' },
    description: {
      pl: 'Daje realny przychód: płatna praca, sprzedany przedmiot, otrzymane odsetki.',
      en: 'Brings in real money: paid work, a sold item, interest received.',
    },
    color: '#16a66a', tint: '#e5f8ef',
  },
};

/** Kategoria w bieżącym języku interfejsu — nazwa i opis czytane w chwili użycia (gettery). */
const currentStyle = ({ label, description, color, tint }: CategoryDefault): CategoryStyle => ({
  get label() { return text(label); },
  get description() { return text(description); },
  color, tint,
});

export const DEFAULT_CATEGORIES: CategoryConfig = {
  unpaid: currentStyle(CATEGORY_DEFAULTS.unpaid),
  potential: currentStyle(CATEGORY_DEFAULTS.potential),
  income: currentStyle(CATEGORY_DEFAULTS.income),
};

/** Kategorie w podanym języku jako zwykłe napisy — tak trafiają do danych nowej instalacji. */
function categoriesIn(language: Language): CategoryConfig {
  const style = ({ label, description, color, tint }: CategoryDefault): CategoryStyle => ({
    label: label[language], description: description[language], color, tint,
  });
  return {
    unpaid: style(CATEGORY_DEFAULTS.unpaid),
    potential: style(CATEGORY_DEFAULTS.potential),
    income: style(CATEGORY_DEFAULTS.income),
  };
}

/** Szybkie dodawanie. XP liczy aplikacja (lib/xp.ts) z czasu i kategorii. Tytuł w bieżącym języku (getter). */
export const TASK_PRESETS: TaskPreset[] = [
  { get title() { return tr('Praca głęboka', 'Deep work'); }, category: 'income', icon: 'briefcase', duration: 120 },
  { get title() { return tr('Rozwój aplikacji', 'App development'); }, category: 'potential', icon: 'code', duration: 90 },
  { get title() { return tr('Siłownia', 'Gym'); }, category: 'unpaid', icon: 'dumbbell', duration: 75 },
  { get title() { return tr('Czytanie książki', 'Reading a book'); }, category: 'potential', icon: 'book', duration: 30 },
  { get title() { return tr('Sprzątanie', 'Cleaning'); }, category: 'unpaid', icon: 'home', duration: 30 },
  { get title() { return tr('Czas dla siebie', 'Me time'); }, category: 'unpaid', icon: 'coffee', duration: 60 },
  { get title() { return tr('Gotowanie', 'Cooking'); }, category: 'unpaid', icon: 'utensils', duration: 45 },
  { get title() { return tr('Wystawienie przedmiotu na OLX', 'Listing an item for sale'); }, category: 'potential', icon: 'shopping-basket', duration: 30 },
  { get title() { return tr('Sprzedany przedmiot', 'Item sold'); }, category: 'income', icon: 'wallet-cards', duration: 15 },
  { get title() { return tr('Otrzymane odsetki', 'Interest received'); }, category: 'income', icon: 'coins', duration: 15 },
];

/** Zdjęcia zadań demonstracyjnych według stałego klucza (tytuł zależy od języka). */
const STARTER_IMAGES = {
  strength: '/assets/thumbs/fitness-02.webp',
  app: '/assets/thumbs/technology-02.webp',
  project: '/assets/thumbs/work-01.webp',
  reading: '/assets/thumbs/learning-02.webp',
} as const;
type StarterImage = keyof typeof STARTER_IMAGES;

const makeTask = (title: string, date: string | null, time: string | null, category: Task['category'], icon: Task['icon'], duration: number, done = false, description = '', image?: StarterImage): Task => ({
  id: crypto.randomUUID(), title, description, category, icon, image: image ? STARTER_IMAGES[image] : undefined, date, time, duration, xp: taskXp(duration, category), done, createdAt: new Date().toISOString(),
});

/** Tekst danych demonstracyjnych w języku nowej instalacji (nie w bieżącym języku interfejsu). */
type InLanguage = (pl: string, en: string) => string;

const starterRoutines = (l: InLanguage): Routine[] => [
  {
    id: 'morning', image: '/assets/thumbs/wellness-01.webp', title: l('Poranny start', 'Morning kickoff'), description: l('Spokojny początek produktywnego dnia', 'A calm start to a productive day'), icon: 'sun', category: 'unpaid', time: '07:00', duration: 45, weekdays: [0,1,2,3,4,5,6], xp: routineXp('unpaid', 45, 4, 0), active: true,
    steps: [
      { id: 'water', title: l('Wypij szklankę wody', 'Drink a glass of water') },
      { id: 'hygiene', title: l('Poranna higiena', 'Freshen up') },
      { id: 'breakfast', title: l('Zjedz śniadanie', 'Eat breakfast') },
      { id: 'plan', title: l('Ustal 3 priorytety dnia', 'Set 3 priorities for the day') },
    ],
  },
  {
    id: 'evening', image: '/assets/thumbs/wellness-08.webp', title: l('Wieczorny reset', 'Evening reset'), description: l('Domknij dzień z czystą głową', 'Wrap up the day with a clear head'), icon: 'sparkles', category: 'unpaid', time: '21:00', duration: 30, weekdays: [0,1,2,3,4,5,6], xp: routineXp('unpaid', 30, 3, 0), active: true,
    steps: [
      { id: 'tidy', title: l('10 minut porządku', '10 minutes of tidying') },
      { id: 'reflect', title: l('Zapisz jedną dobrą rzecz', 'Write down one good thing') },
      { id: 'tomorrow', title: l('Przygotuj się na jutro', 'Get ready for tomorrow') },
    ],
  },
];

/** Dane nowej instalacji: zadania, rutyny i kroki w podanym języku (domyślnie według języka przeglądarki). */
export function createSeed(language: Language = detectLanguage()): AppData {
  const today = todayKey();
  const l: InLanguage = (pl, en) => (language === 'en' ? en : pl);
  return {
    categories: categoriesIn(language),
    theme: 'light',
    routines: starterRoutines(l),
    projects: [],
    routineLogs: {},
    tasks: [
      makeTask(l('Praca nad projektem', 'Work on the project'), today, '09:00', 'income', 'briefcase', 150, true, l('Najważniejszy blok pracy bez rozpraszaczy', 'Your most important work block, free of distractions'), 'project'),
      makeTask(l('Trening siłowy', 'Strength training'), today, '12:30', 'unpaid', 'dumbbell', 75, false, '', 'strength'),
      makeTask(l('Rozwój aplikacji', 'App development'), today, '15:00', 'potential', 'code', 120, false, '', 'app'),
      makeTask(l('Czytanie książki', 'Reading a book'), today, '19:15', 'potential', 'book', 45, false, '', 'reading'),
      makeTask(l('Odpoczynek i serial', 'Rest and a TV show'), today, '20:15', 'unpaid', 'tv', 40),
      makeTask(l('Odpowiedz na wiadomości', 'Reply to messages'), today, null, 'unpaid', 'check', 15),
      makeTask(l('Przejrzyj pomysły do aplikacji', 'Review app ideas'), today, null, 'potential', 'target', 20),
      makeTask(l('Wystaw przedmioty na sprzedaż', 'List items for sale'), null, null, 'potential', 'wallet', 45),
      makeTask(l('Zakupy spożywcze', 'Grocery shopping'), null, null, 'unpaid', 'shopping', 40),
      makeTask(l('Posłuchaj podcastu', 'Listen to a podcast'), null, null, 'unpaid', 'music', 30),
      makeTask(l('Praca projektowa', 'Project work'), shiftDate(today, 1), '10:00', 'income', 'briefcase', 180),
      makeTask(l('Spacer', 'Walk'), shiftDate(today, 1), '16:00', 'unpaid', 'leaf', 60),
      makeTask(l('Praca głęboka', 'Deep work'), shiftDate(today, -1), '09:30', 'income', 'briefcase', 120, true),
      makeTask(l('Siłownia', 'Gym'), shiftDate(today, -2), '18:00', 'unpaid', 'dumbbell', 70, true),
      makeTask(l('Programowanie', 'Coding'), shiftDate(today, -3), '16:00', 'potential', 'code', 90, true),
    ],
    language,
  };
}
