import { useSyncExternalStore } from 'react';

/**
 * Język interfejsu: polski (domyślny) albo angielski — wybierany w Ustawieniach, zapisany w danych (`AppData.language`).
 *
 * Zasady:
 * - Tekst piszemy w miejscu użycia w obu językach: `tr('Zapisz', 'Save')`, także z wartościami:
 *   ``tr(`Usunięto „${title}”`, `Removed “${title}”`)``.
 * - Odmiana przez liczby: `plural(n, ['krok', 'kroki', 'kroków'], ['step', 'steps'])` albo `count(...)` z liczbą.
 * - Tabele i stałe modułu (np. odznaki, miniaturki) trzymają `{ pl, en }` i rozwiązują je `text()` w chwili użycia.
 *   Nie wołaj `tr()` na poziomie modułu — stała policzona przy imporcie zostałaby w jednym języku.
 * - Daty i liczby: `locale()` zamiast 'pl-PL' (`Intl.DateTimeFormat(locale(), …)`, `toLocaleString(locale())`).
 *
 * App ustawia język (`applyLanguage`) na początku renderu, więc `tr()` działa w komponentach, w funkcjach
 * wywoływanych podczas renderu i w kodzie uruchamianym później (przypomnienia, eksport, powiadomienia).
 */
export type Language = 'pl' | 'en';
export type Localized<T = string> = { pl: T; en: T };

export const LANGUAGES: readonly { id: Language; label: string }[] = [
  { id: 'pl', label: 'Polski' },
  { id: 'en', label: 'English' },
];

let current: Language = 'pl';
const listeners = new Set<() => void>();

export const isLanguage = (value: unknown): value is Language => value === 'pl' || value === 'en';

/** Język dla nowej instalacji: polski, gdy przeglądarka (pierwszy wybrany język) jest po polsku, inaczej angielski. */
export function detectLanguage(): Language {
  try {
    const preferred = (typeof navigator !== 'undefined' && (navigator.languages?.[0] ?? navigator.language)) || 'pl';
    return preferred.toLowerCase().startsWith('pl') ? 'pl' : 'en';
  } catch {
    return 'pl';
  }
}

export const getLanguage = (): Language => current;

/** Ustawia bieżący język (App, przed renderem). Subskrybentów powiadamiamy po renderze. */
export function applyLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  if (typeof document !== 'undefined') document.documentElement.lang = language;
  queueMicrotask(() => listeners.forEach(listener => listener()));
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Bieżący język w komponencie (odświeża komponent po zmianie). */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

/** Tekst w bieżącym języku. */
export function tr(pl: string, en: string): string {
  return current === 'en' ? en : pl;
}

/** Dowolna wartość zależna od języka (tablice nazw, elementy JSX). */
export function pick<T>(pl: T, en: T): T {
  return current === 'en' ? en : pl;
}

/** Tekst z tabeli `{ pl, en }` (zwykły napis zwraca bez zmian). */
export function text(value: Localized | string): string {
  return typeof value === 'string' ? value : current === 'en' ? value.en : value.pl;
}

/** Locale dla `Intl` i `toLocaleString` — angielski brytyjski: zegar 24 h i tydzień od poniedziałku, jak w aplikacji. */
export const locale = (): string => (current === 'en' ? 'en-GB' : 'pl-PL');

/** Słowo w formie zależnej od liczby: polskie 1 / 2–4 / 5+ (12–14 jak 5+) i angielskie 1 / pozostałe. */
export function plural(n: number, pl: readonly [string, string, string], en: readonly [string, string]): string {
  const value = Math.abs(Math.trunc(n));
  if (current === 'en') return value === 1 ? en[0] : en[1];
  if (value === 1) return pl[0];
  const last = value % 10;
  const lastTwo = value % 100;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? pl[1] : pl[2];
}

/** Liczba ze słowem: `count(5, ['krok', 'kroki', 'kroków'], ['step', 'steps'])` → „5 kroków” / “5 steps”. */
export function count(n: number, pl: readonly [string, string, string], en: readonly [string, string]): string {
  return `${formatNumber(n)} ${plural(n, pl, en)}`;
}

/** Liczba z separatorem tysięcy według języka. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(locale(), options);
}
