import { useEffect, useState } from 'react';
import { createSeed } from './seed';
import type { AppData, CategoryConfig, CategoryKey, Routine, Task } from '../types';

const STORAGE_KEY = 'momentum.v1';

/**
 * Niezależne od seed.ts wartości zapasowe. Starsze lub niekompletnie
 * zaktualizowane pliki seed.ts mogą nie zawierać nowych kategorii.
 * Migracja musi działać także w takim przypadku.
 */
const CATEGORY_FALLBACKS: CategoryConfig = {
  unpaid: {
    label: 'Bez przychodu',
    description: 'Nie przynosi pieniędzy: siłownia, gotowanie, sprzątanie, odpoczynek, TV.',
    color: '#ed5e67',
    tint: '#fff0f0',
  },
  potential: {
    label: 'Możliwy przyszły przychód',
    description: 'Tworzenie aplikacji, rozwój zawodowy, kursy, wystawianie ofert na OLX.',
    color: '#e7a72f',
    tint: '#fff6df',
  },
  income: {
    label: 'Przychód',
    description: 'Płatna praca, opłacone zlecenia, zrealizowana sprzedaż, otrzymane odsetki.',
    color: '#16a66a',
    tint: '#e5f8ef',
  },
};

/** Kategorie z wersji v0.1 (health, chores, leisure) są teraz jedną kategorią unpaid. */
export function normalizeCategory(value: unknown): CategoryKey {
  return value === 'income' || value === 'potential' ? value : 'unpaid';
}

/** Zawsze zwraca kompletny zestaw trzech kategorii, nawet dla starych zapisów. */
export function resolveCategories(value: unknown): CategoryConfig {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  const getStyle = (key: CategoryKey) => {
    const fallback = CATEGORY_FALLBACKS[key];
    const saved = source[key] && typeof source[key] === 'object'
      ? source[key] as Record<string, unknown>
      : {};
    return {
      ...fallback,
      color: typeof saved.color === 'string' && /^#[\da-fA-F]{6}$/.test(saved.color)
        ? saved.color : fallback.color,
      tint: typeof saved.tint === 'string' && saved.tint.length > 0
        ? saved.tint : fallback.tint,
    };
  };

  return { unpaid: getStyle('unpaid'), potential: getStyle('potential'), income: getStyle('income') };
}

/** Migracja przy odczycie: bez resetowania zadań, rutyn, XP ani wykonanych kroków. */
export function migrateStoredData(value: unknown): AppData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Partial<AppData>;
  if (!Array.isArray(data.tasks) || !Array.isArray(data.routines)) return null;

  return {
    ...data,
    tasks: data.tasks
      .filter((task): task is Task => Boolean(task && typeof task === 'object'))
      .map(task => ({ ...task, category: normalizeCategory(task.category) })),
    routines: data.routines
      .filter((routine): routine is Routine => Boolean(routine && typeof routine === 'object'))
      .map(routine => ({ ...routine, category: normalizeCategory(routine.category) })),
    routineLogs: data.routineLogs && typeof data.routineLogs === 'object' && !Array.isArray(data.routineLogs)
      ? data.routineLogs : {},
    categories: resolveCategories(data.categories),
    theme: data.theme === 'dark' ? 'dark' : 'light',
  };
}

function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const migrated = migrateStoredData(JSON.parse(raw));
      if (migrated) return migrated;
      console.warn('Nieprawidłowa struktura danych Momentum. Przywrócono dane demonstracyjne bez usuwania starego zapisu.');
    }
  } catch (error) {
    console.warn('Nie udało się odczytać zapisanych danych Momentum:', error);
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
