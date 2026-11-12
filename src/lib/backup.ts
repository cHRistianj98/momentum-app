import type { AppData } from '../types';
import { tr } from './i18n';

/** Exportujemy cały namespace Momentum: taski, projekty, rutyny, Focus, statystyki, odznaki i plany. */
export const MOMENTUM_STORAGE_PREFIX = 'momentum.';
export const MOMENTUM_DATA_KEY = 'momentum.v1';
export const BACKUP_FORMAT = 'momentum-backup';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;

export type BackupStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

export interface MomentumBackup {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_VERSION;
  createdAt: string;
  storage: Record<string, string>;
}

export interface BackupPreview {
  createdAt: string;
  tasks: number;
  routines: number;
  projects: number;
  completedTasks: number;
  focusSessions: number;
  storageKeys: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function readMomentumKeys(storage: BackupStorage): string[] {
  const result: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(MOMENTUM_STORAGE_PREFIX)) result.push(key);
  }
  return result;
}

export function snapshotMomentumStorage(storage: BackupStorage): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const key of readMomentumKeys(storage)) {
    const value = storage.getItem(key);
    if (value !== null) snapshot[key] = value;
  }
  return snapshot;
}

function parseAppData(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; }
  catch { throw new Error(tr('Kopia zawiera nieprawidłowe dane aplikacji (momentum.v1).', 'The backup contains invalid app data (momentum.v1).')); }
  if (!isRecord(parsed) || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.routines)) {
    throw new Error(tr('W kopii brakuje prawidłowych zadań lub rutyn Momentum.', 'The backup is missing valid Momentum tasks or routines.'));
  }
  if (parsed.projects !== undefined && !Array.isArray(parsed.projects)) {
    throw new Error(tr('Lista projektów w kopii ma nieprawidłowy format.', 'The project list in the backup has an invalid format.'));
  }
  for (const [name, nameEn, values] of [
    ['zadań', 'task', parsed.tasks], ['rutyn', 'routine', parsed.routines], ['projektów', 'project', parsed.projects ?? []],
  ] as [string, string, unknown[]][]) {
    if (!values.every(value => isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string')) {
      throw new Error(tr(`Lista ${name} w kopii zawiera nieprawidłowe elementy.`, `The ${nameEn} list in the backup contains invalid items.`));
    }
  }
  if (parsed.routineLogs !== undefined && !isRecord(parsed.routineLogs)) {
    throw new Error(tr('Historia rutyn w kopii jest nieprawidłowa.', 'The routine history in the backup is invalid.'));
  }
  return parsed;
}

export function createMomentumBackup(storage: BackupStorage, currentData: AppData, now = new Date()): MomentumBackup {
  const snapshot = snapshotMomentumStorage(storage);
  // W eksporcie zawsze używamy aktualnego stanu React — również jeśli useEffect jeszcze go nie zapisał.
  snapshot[MOMENTUM_DATA_KEY] = JSON.stringify(currentData);
  parseAppData(snapshot[MOMENTUM_DATA_KEY]);
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_VERSION,
    createdAt: now.toISOString(),
    storage: snapshot,
  };
}

export function encodeMomentumBackup(backup: MomentumBackup): string {
  return JSON.stringify(backup, null, 2);
}

export function parseMomentumBackup(raw: string): { backup: MomentumBackup; preview: BackupPreview } {
  if (new Blob([raw]).size > MAX_BACKUP_BYTES) {
    throw new Error(tr('Plik jest zbyt duży. Maksymalny rozmiar kopii wynosi 10 MB.', 'The file is too large. The maximum backup size is 10 MB.'));
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; }
  catch { throw new Error(tr('Plik nie jest poprawnym dokumentem JSON.', 'The file isn’t a valid JSON document.')); }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || parsed.schemaVersion !== BACKUP_VERSION || !isRecord(parsed.storage)) {
    throw new Error(tr('To nie jest obsługiwana kopia Momentum (format v1).', 'This isn’t a supported Momentum backup (format v1).'));
  }
  if (typeof parsed.createdAt !== 'string' || !Number.isFinite(Date.parse(parsed.createdAt))) {
    throw new Error(tr('Kopia nie zawiera prawidłowej daty utworzenia.', 'The backup doesn’t contain a valid creation date.'));
  }

  const storage: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.storage)) {
    if (!/^momentum\.[a-zA-Z0-9._:-]+$/.test(key) || typeof value !== 'string') {
      throw new Error(tr('Kopia zawiera nieprawidłowy klucz lub wartość zapisu.', 'The backup contains an invalid storage key or value.'));
    }
    storage[key] = value;
  }
  if (!Object.prototype.hasOwnProperty.call(storage, MOMENTUM_DATA_KEY)) {
    throw new Error(tr('Kopia nie zawiera głównych danych Momentum.', 'The backup doesn’t contain the main Momentum data.'));
  }
  const appData = parseAppData(storage[MOMENTUM_DATA_KEY]);
  let focusSessions = 0;
  const focusRaw = storage['momentum.focus.v1'];
  if (focusRaw) {
    try {
      const focus: unknown = JSON.parse(focusRaw);
      if (isRecord(focus) && Array.isArray(focus.history)) focusSessions = focus.history.length;
    } catch { throw new Error(tr('Historia Focus Mode w kopii nie jest poprawnym JSON.', 'The Focus Mode history in the backup isn’t valid JSON.')); }
  }
  return {
    backup: { format: BACKUP_FORMAT, schemaVersion: BACKUP_VERSION, createdAt: parsed.createdAt, storage },
    preview: {
      createdAt: parsed.createdAt,
      tasks: (appData.tasks as unknown[]).length,
      routines: (appData.routines as unknown[]).length,
      projects: Array.isArray(appData.projects) ? appData.projects.length : 0,
      completedTasks: (appData.tasks as Record<string, unknown>[]).filter(task => task.done === true).length,
      focusSessions,
      storageKeys: Object.keys(storage).length,
    },
  };
}

/** Całość lub nic: gdy zabraknie miejsca, przywracamy poprzednie lokalne dane. */
export function restoreMomentumBackup(storage: BackupStorage, backup: MomentumBackup): void {
  // Walidujemy ponownie, nawet jeśli wywołanie omija interfejs importu.
  const validated = parseMomentumBackup(encodeMomentumBackup(backup)).backup;
  const previous = snapshotMomentumStorage(storage);
  try {
    for (const key of readMomentumKeys(storage)) storage.removeItem(key);
    for (const [key, value] of Object.entries(validated.storage)) storage.setItem(key, value);
  } catch (error) {
    try {
      for (const key of readMomentumKeys(storage)) storage.removeItem(key);
      for (const [key, value] of Object.entries(previous)) storage.setItem(key, value);
    } catch {
      throw new Error(tr(
        'Import nie powiódł się i nie udało się automatycznie przywrócić poprzedniego zapisu. Użyj wcześniej pobranej kopii JSON.',
        'The import failed and the previous data couldn’t be restored automatically. Use a JSON backup you downloaded earlier.',
      ));
    }
    throw new Error(error instanceof Error
      ? tr(`Import został cofnięty: ${error.message}`, `The import was rolled back: ${error.message}`)
      : tr('Import został cofnięty: błąd zapisu danych.', 'The import was rolled back: data write error.'));
  }
}

export function backupFilename(date = new Date()): string {
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}`;
  return `momentum-backup_${stamp}.json`;
}
