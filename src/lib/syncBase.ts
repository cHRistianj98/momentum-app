/**
 * Baza scalania dla synchronizacji: ostatnia wersja danych uzgodniona z serwerem.
 *
 * Trzymamy ją w osobnej bazie IndexedDB („momentum-sync”), poza przestrzenią momentum.*,
 * więc nie trafia ani do kopii JSON, ani na serwer. Gdy IndexedDB nie działa, małe dane
 * zapisujemy w localStorage. Bez bazy aplikacja wraca do wyboru wersji przy konflikcie.
 */
const DB_NAME = 'momentum-sync';
const STORE = 'state';
const BASE_KEY = 'base';
const FALLBACK_KEY = 'momentum-sync:base';
/** localStorage ma ok. 5 MB na całą aplikację — duże bazy (zdjęcia) tylko w IndexedDB. */
const FALLBACK_LIMIT = 1_000_000;

export interface SyncBaseRecord {
  /** Odcisk danych (jak `hash` w ustawieniach synchronizacji). */
  hash: string;
  revision: number;
  /** Kanoniczny JSON migawki magazynu. */
  canonical: string;
}

let opening: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = () => reject(request.error ?? new Error('Cannot open sync database'));
    request.onblocked = () => reject(new Error('Sync database blocked by another tab'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
  }).catch(error => { opening = null; throw error; });
  return opening;
}

function isBaseRecord(value: unknown): value is SyncBaseRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<SyncBaseRecord>;
  return typeof record.hash === 'string' && typeof record.canonical === 'string'
    && typeof record.revision === 'number' && Number.isSafeInteger(record.revision);
}

export async function readSyncBase(): Promise<SyncBaseRecord | null> {
  try {
    const db = await openDatabase();
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(BASE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Cannot read sync base'));
    });
    if (isBaseRecord(value)) return value;
  } catch { /* IndexedDB niedostępne — sprawdzamy kopię zapasową */ }
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(FALLBACK_KEY) ?? 'null');
    return isBaseRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeSyncBase(record: SyncBaseRecord): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(record, BASE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Cannot store sync base'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Storing sync base aborted'));
    });
    try { localStorage.removeItem(FALLBACK_KEY); } catch { /* brak dostępu do localStorage */ }
    return;
  } catch { /* przechodzimy na localStorage */ }
  try {
    if (record.canonical.length <= FALLBACK_LIMIT) localStorage.setItem(FALLBACK_KEY, JSON.stringify(record));
    else localStorage.removeItem(FALLBACK_KEY);
  } catch { /* brak miejsca: bez bazy konflikt rozstrzygnie wybór wersji */ }
}

export async function clearSyncBase(): Promise<void> {
  try { localStorage.removeItem(FALLBACK_KEY); } catch { /* brak dostępu do localStorage */ }
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(BASE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Cannot clear sync base'));
    });
  } catch { /* nic do usunięcia */ }
}
