import type { AppData, CategoryConfig, Task, TaskPreset, Routine } from '../types';
import { shiftDate, todayKey } from './date';

export const DEFAULT_CATEGORIES: CategoryConfig = {
  unpaid: {
    label: 'Bez przychodu',
    description: 'Nie przynosi pieniędzy: siłownia, gotowanie, sprzątanie, odpoczynek, TV.',
    color: '#ed5e67', tint: '#fff0f0',
  },
  potential: {
    label: 'Możliwy przychód',
    description: 'Nie zarabia teraz, ale może w przyszłości: tworzenie aplikacji, kursy, wystawienie oferty na OLX.',
    color: '#e7a72f', tint: '#fff6df',
  },
  income: {
    label: 'Przychód',
    description: 'Daje realny przychód: płatna praca, sprzedany przedmiot, otrzymane odsetki.',
    color: '#16a66a', tint: '#e5f8ef',
  },
};

export const TASK_PRESETS: TaskPreset[] = [
  { title: 'Praca głęboka', category: 'income', icon: 'briefcase', duration: 120, xp: 90 },
  { title: 'Rozwój aplikacji', category: 'potential', icon: 'code', duration: 90, xp: 75 },
  { title: 'Siłownia', category: 'unpaid', icon: 'dumbbell', duration: 75, xp: 60 },
  { title: 'Czytanie książki', category: 'potential', icon: 'book', duration: 30, xp: 35 },
  { title: 'Sprzątanie', category: 'unpaid', icon: 'home', duration: 30, xp: 25 },
  { title: 'Czas dla siebie', category: 'unpaid', icon: 'coffee', duration: 60, xp: 15 },
  { title: 'Gotowanie', category: 'unpaid', icon: 'utensils', duration: 45, xp: 25 },
  { title: 'Wystawienie przedmiotu na OLX', category: 'potential', icon: 'shopping-basket', duration: 30, xp: 35 },
  { title: 'Sprzedany przedmiot', category: 'income', icon: 'wallet-cards', duration: 15, xp: 30 },
  { title: 'Otrzymane odsetki', category: 'income', icon: 'coins', duration: 15, xp: 20 },
];

const STARTER_IMAGES: Record<string,string> = {
  'Trening siłowy':'/assets/thumbs/fitness-02.webp',
  'Rozwój aplikacji':'/assets/thumbs/technology-02.webp',
  'Praca nad projektem':'/assets/thumbs/work-01.webp',
  'Czytanie książki':'/assets/thumbs/learning-02.webp',
};

const makeTask = (title: string, date: string | null, time: string | null, category: Task['category'], icon: Task['icon'], duration: number, xp: number, done = false, description = ''): Task => ({
  id: crypto.randomUUID(), title, description, category, icon, image: STARTER_IMAGES[title], date, time, duration, xp, done, createdAt: new Date().toISOString(),
});

const routines: Routine[] = [
  {
    id: 'morning', image: '/assets/thumbs/wellness-01.webp', title: 'Poranny start', description: 'Spokojny początek produktywnego dnia', icon: 'sun', category: 'unpaid', time: '07:00', duration: 45, weekdays: [0,1,2,3,4,5,6], xp: 50, active: true,
    steps: [
      { id: 'water', title: 'Wypij szklankę wody' },
      { id: 'hygiene', title: 'Poranna higiena' },
      { id: 'breakfast', title: 'Zjedz śniadanie' },
      { id: 'plan', title: 'Ustal 3 priorytety dnia' },
    ],
  },
  {
    id: 'evening', image: '/assets/thumbs/wellness-08.webp', title: 'Wieczorny reset', description: 'Domknij dzień z czystą głową', icon: 'sparkles', category: 'unpaid', time: '21:00', duration: 30, weekdays: [0,1,2,3,4,5,6], xp: 40, active: true,
    steps: [
      { id: 'tidy', title: '10 minut porządku' },
      { id: 'reflect', title: 'Zapisz jedną dobrą rzecz' },
      { id: 'tomorrow', title: 'Przygotuj się na jutro' },
    ],
  },
];

export function createSeed(): AppData {
  const today = todayKey();
  return {
    categories: DEFAULT_CATEGORIES,
    theme: 'light',
    routines,
    projects: [],
    routineLogs: {},
    tasks: [
      makeTask('Praca nad projektem', today, '09:00', 'income', 'briefcase', 150, 100, true, 'Najważniejszy blok pracy bez rozpraszaczy'),
      makeTask('Trening siłowy', today, '12:30', 'unpaid', 'dumbbell', 75, 60),
      makeTask('Rozwój aplikacji', today, '15:00', 'potential', 'code', 120, 90),
      makeTask('Czytanie książki', today, '19:15', 'potential', 'book', 45, 35),
      makeTask('Odpoczynek i serial', today, '20:15', 'unpaid', 'tv', 40, 15),
      makeTask('Odpowiedz na wiadomości', today, null, 'unpaid', 'check', 15, 20),
      makeTask('Przejrzyj pomysły do aplikacji', today, null, 'potential', 'target', 20, 25),
      makeTask('Wystaw przedmioty na sprzedaż', null, null, 'potential', 'wallet', 45, 45),
      makeTask('Zakupy spożywcze', null, null, 'unpaid', 'shopping', 40, 25),
      makeTask('Posłuchaj podcastu', null, null, 'unpaid', 'music', 30, 20),
      makeTask('Praca projektowa', shiftDate(today, 1), '10:00', 'income', 'briefcase', 180, 100),
      makeTask('Spacer', shiftDate(today, 1), '16:00', 'unpaid', 'leaf', 60, 30),
      makeTask('Praca głęboka', shiftDate(today, -1), '09:30', 'income', 'briefcase', 120, 85, true),
      makeTask('Siłownia', shiftDate(today, -2), '18:00', 'unpaid', 'dumbbell', 70, 60, true),
      makeTask('Programowanie', shiftDate(today, -3), '16:00', 'potential', 'code', 90, 75, true),
    ],
  };
}
