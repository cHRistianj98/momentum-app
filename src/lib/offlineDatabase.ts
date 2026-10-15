/**
 * Momentum offline storage — IndexedDB mirror of the existing momentum.* namespace.
 * The localStorage copy is intentionally retained during migration, so legacy
 * components, existing JSON backups and current data remain compatible.
 * No data is ever deleted from localStorage just because IndexedDB is available.
 */
const DB_NAME = 'momentum-offline';
const DB_VERSION = 1;
const STORE = 'entries';
const PREFIX = 'momentum.';
const MAIN_KEY = 'momentum.v1';
const REVISION_KEY = 'momentum.persistence.revision';

export type OfflineDatabaseStatus = 'initializing' | 'ready' | 'local-only';
let status: OfflineDatabaseStatus = 'initializing';
let opening: Promise<IDBDatabase> | null = null;
let pendingWrites: Promise<void> = Promise.resolve();
let cachedSnapshot: Record<string, string> | null = null;

export function getOfflineDatabaseStatus(): OfflineDatabaseStatus { return status; }

/** Synchronous read from the database snapshot loaded before React mounts. */
export function readMomentumKey(key: string): string | null {
  if (cachedSnapshot) return cachedSnapshot[key] ?? null;
  try { return localStorage.getItem(key); } catch { return null; }
}

/** Snapshot used by the JSON backup, including values that exceed localStorage quota. */
export function getMomentumSnapshot(): Record<string, string> {
  return { ...(cachedSnapshot ?? readLocalSnapshot()) };
}

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onerror = () => reject(request.error ?? new Error('Cannot open IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
  }).catch(error => { opening = null; throw error; });
  return opening!;
}

function inTransaction(
  db: IDBDatabase, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    try { operation(transaction.objectStore(STORE)); }
    catch (error) { transaction.abort(); reject(error); }
  });
}

async function readDatabaseSnapshot(): Promise<Record<string, string>> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const snapshot: Record<string, string> = {};
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (typeof cursor.key === 'string' && cursor.key.startsWith(PREFIX) && typeof cursor.value === 'string') {
        snapshot[cursor.key] = cursor.value;
      }
      cursor.continue();
    };
    transaction.oncomplete = () => resolve(snapshot);
    transaction.onerror = () => reject(transaction.error ?? new Error('Cannot read offline database'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Offline database read aborted'));
  });
}

function readLocalSnapshot(): Record<string, string> {
  const output: Record<string, string> = {};
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const value = localStorage.getItem(key);
      if (value !== null) output[key] = value;
    }
  } catch (error) { console.warn('[Momentum] Cannot inspect local copy', error); }
  return output;
}

function validMainState(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return !!parsed && typeof parsed === 'object' &&
      Array.isArray((parsed as {tasks?: unknown}).tasks) &&
      Array.isArray((parsed as {routines?: unknown}).routines);
  } catch { return false; }
}

async function writeDatabaseSnapshot(snapshot: Record<string, string>): Promise<void> {
  const db = await openDatabase();
  await inTransaction(db, 'readwrite', store => {
    store.clear();
    for (const [key, value] of Object.entries(snapshot)) {
      if (key.startsWith(PREFIX)) store.put(value, key);
    }
  });
}

/** A monotonically increasing revision distinguishes an unfinished async write from
 * a completed write, protecting against old snapshots after iOS suspends the PWA. */
function revision(snapshot: Record<string, string>): number {
  const value = Number(snapshot[REVISION_KEY] ?? '0');
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function newRevision(): string {
  const current = Number(readMomentumKey(REVISION_KEY) ?? 0);
  return String(Math.max(Date.now(), Number.isSafeInteger(current) ? current + 1 : 0));
}

function restoreLocalSnapshot(snapshot: Record<string, string>, previous: Record<string, string>): void {
  try {
    for (const key of Object.keys(previous)) {
      if (!(key in snapshot)) localStorage.removeItem(key);
    }
    for (const [key, value] of Object.entries(snapshot)) localStorage.setItem(key, value);
  } catch (error) {
    // Restore the earlier view if quota was reached partway through.
    for (const key of Object.keys(snapshot)) {
      if (!(key in previous)) try { localStorage.removeItem(key); } catch { /* ignore */ }
    }
    for (const [key, value] of Object.entries(previous)) {
      try { localStorage.setItem(key, value); } catch { /* ignore */ }
    }
    throw error;
  }
}

/** Called before React mounts. On first run migrate the existing namespace.
 * On later boots compare revisions: newer local writes win if iOS interrupted the
 * IDB queue; newer IDB wins if localStorage failed or was purged independently. */
export async function initializeOfflineDatabase(): Promise<OfflineDatabaseStatus> {
  const local = readLocalSnapshot();
  try {
    const remote = await readDatabaseSnapshot();
    const localValid = validMainState(local[MAIN_KEY]);
    const remoteValid = validMainState(remote[MAIN_KEY]);
    if (remoteValid && (!localValid || revision(remote) > revision(local))) {
      cachedSnapshot = remote;
      try { restoreLocalSnapshot(remote, local); }
      catch (error) { console.warn('[Momentum] Local mirror is full; using IndexedDB snapshot:', error); }
    } else if (localValid) {
      cachedSnapshot = local;
      await writeDatabaseSnapshot(local);
    } else {
      cachedSnapshot = local;
    }
    status = 'ready';
  } catch (error) {
    status = 'local-only';
    cachedSnapshot = local;
    console.warn('[Momentum] IndexedDB unavailable; localStorage is still intact:', error);
  }
  return status;
}

function enqueue(write: () => Promise<void>): Promise<void> {
  // A failed write must not block subsequent changes.
  const operation = pendingWrites.then(write);
  pendingWrites = operation.catch(error => {
    status = 'local-only';
    console.warn('[Momentum] Offline database write failed:', error);
  });
  return operation;
}

/** Write through to both stores. React and legacy widgets read the local copy
 * synchronously, while IndexedDB protects it with atomic transactions. */
export function saveMomentumKey(key: string, value: string): void {
  if (!key.startsWith(PREFIX) || key === REVISION_KEY) throw new Error('Unsupported Momentum key');
  const next = newRevision();
  if (cachedSnapshot) {
    cachedSnapshot[key] = value;
    cachedSnapshot[REVISION_KEY] = next;
  }
  try {
    localStorage.setItem(key, value);
    localStorage.setItem(REVISION_KEY, next);
  } catch (error) { console.warn('[Momentum] Cannot write compatibility copy:', error); }
  if (status === 'ready') void enqueue(async () => {
    const db = await openDatabase();
    await inTransaction(db, 'readwrite', store => {
      store.put(value, key);
      store.put(next, REVISION_KEY);
    });
  });
}

export function removeMomentumKey(key: string): void {
  if (!key.startsWith(PREFIX) || key === REVISION_KEY) throw new Error('Unsupported Momentum key');
  const next = newRevision();
  if (cachedSnapshot) {
    delete cachedSnapshot[key];
    cachedSnapshot[REVISION_KEY] = next;
  }
  localStorage.removeItem(key);
  localStorage.setItem(REVISION_KEY, next);
  if (status === 'ready') void enqueue(async () => {
    const db = await openDatabase();
    await inTransaction(db, 'readwrite', store => {
      store.delete(key);
      store.put(next, REVISION_KEY);
    });
  });
}

/** After importing a validated backup, commit the newly restored local snapshot
 * to IndexedDB before reloading (including deletion of removed keys). */
export async function syncOfflineSnapshot(): Promise<void> {
  const next = newRevision();
  localStorage.setItem(REVISION_KEY, next);
  if (status !== 'ready') return;
  const snapshot = readLocalSnapshot();
  cachedSnapshot = snapshot;
  await enqueue(() => writeDatabaseSnapshot(snapshot));
}

/** Wait for all queued writes (testing and controlled shutdown only). */
export async function flushOfflineWrites(): Promise<void> { await pendingWrites; }
