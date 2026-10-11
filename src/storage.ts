import { useEffect, useState } from 'react';
import { createSeed, DEFAULT_CATEGORIES } from './seed';
import type { AppData } from '../types';

const STORAGE_KEY = 'momentum.v1';

function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as AppData;
      if (Array.isArray(data.tasks) && Array.isArray(data.routines)) {
        // Zachowaj zadania z wcześniejszej wersji. Trzy dawne czerwone
        // kategorie (health, chores, leisure) są teraz jedną: unpaid.
        const category = (value: unknown) =>
          value === 'income' || value === 'potential' ? value : 'unpaid';
        return {
          ...data,
          tasks: data.tasks.map(task => ({ ...task, category: category(task.category) })),
          routines: data.routines.map(routine => ({ ...routine, category: category(routine.category) })),
          routineLogs: data.routineLogs ?? {},
          categories: {
            unpaid: DEFAULT_CATEGORIES.unpaid,
            potential: { ...DEFAULT_CATEGORIES.potential, color: data.categories?.potential?.color ?? DEFAULT_CATEGORIES.potential.color },
            income: { ...DEFAULT_CATEGORIES.income, color: data.categories?.income?.color ?? DEFAULT_CATEGORIES.income.color },
          },
          theme: data.theme === 'dark' ? 'dark' : 'light',
        } as AppData;
      }
    }
  } catch (error) {
    console.warn('Nie udało się odczytać zapisanych danych:', error);
  }
  return createSeed();
}

export function useAppData() {
  const [data, setData] = useState<AppData>(loadData);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch (error) { console.warn('Nie udało się zapisać danych (możliwy limit localStorage):', error); }
  }, [data]);
  useEffect(() => { document.documentElement.dataset.theme = data.theme; }, [data.theme]);
  return [data, setData] as const;
}

export function eraseStoredData() { localStorage.removeItem(STORAGE_KEY); }
