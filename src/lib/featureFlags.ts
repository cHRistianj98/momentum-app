/**
 * Feature flagi Momentum.
 *
 * Wartość domyślna pochodzi z buildu (zmienna VITE_FEATURE_*, np. ustawiona w Cloudflare Pages),
 * a nadpisanie dla jednego urządzenia z localStorage „momentum-flags”. Ten klucz leży poza
 * przestrzenią „momentum.”, więc nie trafia do kopii JSON ani do synchronizacji.
 *
 * Nadpisanie na urządzeniu:
 *  - w przeglądarce: ?ff=cloud-sync (włącz), ?ff=-cloud-sync (wyłącz), ?ff=reset (ustawienia buildu),
 *  - w zainstalowanej PWA (bez paska adresu): 5 szybkich stuknięć w nagłówek „Ustawienia”.
 */
export type FeatureFlag = 'cloudSync';

const STORAGE_KEY = 'momentum-flags';
const URL_NAMES: Record<string, FeatureFlag> = { 'cloud-sync': 'cloudSync' };
const BUILD_DEFAULTS: Record<FeatureFlag, boolean> = {
  cloudSync: import.meta.env.VITE_FEATURE_CLOUD_SYNC === 'true',
};

type Overrides = Partial<Record<FeatureFlag, boolean>>;

function readOverrides(): Overrides {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const overrides: Overrides = {};
    for (const flag of Object.keys(BUILD_DEFAULTS) as FeatureFlag[]) {
      const value = (parsed as Record<string, unknown>)[flag];
      if (typeof value === 'boolean') overrides[flag] = value;
    }
    return overrides;
  } catch {
    return {};
  }
}

function writeOverrides(overrides: Overrides): void {
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch { /* tryb prywatny lub pełna pamięć: flaga zostaje przy wartości z buildu */ }
}

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return readOverrides()[flag] ?? BUILD_DEFAULTS[flag];
}

/** true/false = nadpisanie na tym urządzeniu, null = powrót do wartości z buildu. */
export function setFeatureOverride(flag: FeatureFlag, value: boolean | null): void {
  const overrides = readOverrides();
  if (value === null) delete overrides[flag];
  else overrides[flag] = value;
  writeOverrides(overrides);
}

/** Odczytuje ?ff=… przy starcie, zapamiętuje nadpisania i usuwa parametr z paska adresu. */
export function applyFeatureFlagParams(): void {
  let url: URL;
  try { url = new URL(window.location.href); } catch { return; }
  const tokens = url.searchParams.getAll('ff').flatMap(value => value.split(',')).map(token => token.trim()).filter(Boolean);
  if (tokens.length === 0) return;
  for (const token of tokens) {
    if (token === 'reset') { writeOverrides({}); continue; }
    const disable = token.startsWith('-');
    const flag = URL_NAMES[disable ? token.slice(1) : token];
    if (flag) setFeatureOverride(flag, !disable);
  }
  url.searchParams.delete('ff');
  try { window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`); }
  catch { /* adres zostaje bez zmian */ }
}

/** Ukryty gest: zwraca true przy `required`-tym stuknięciu w ciągu `windowMs`. */
export function createTapCounter(required: number, windowMs: number): () => boolean {
  let taps: number[] = [];
  return () => {
    const now = Date.now();
    taps = [...taps.filter(time => now - time < windowMs), now];
    if (taps.length < required) return false;
    taps = [];
    return true;
  };
}
