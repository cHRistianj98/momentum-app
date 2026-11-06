/**
 * Momentum Cloud Sync — opcjonalna synchronizacja włączana osobno na każdym urządzeniu (Ustawienia).
 *
 * Synchronizuje CAŁĄ lokalną przestrzeń momentum.* jako jedną migawkę z numerem rewizji:
 *  - zmiany z tego urządzenia wysyłamy ok. 2,5 s po zapisie (PUT z rewizją bazową),
 *  - nowsze dane z chmury pobieramy przy starcie (jeszcze przed renderem, bez przeładowania),
 *    po powrocie do aplikacji i co minutę, gdy jest widoczna,
 *  - gdy zmieniły się obie strony, łączymy zmiany (scalanie trójstronne względem ostatniej
 *    wspólnej wersji, zapisanej lokalnie w syncBase.ts). Wybór wersji zostaje tylko wtedy,
 *    gdy wspólnej wersji brak (np. pierwsza synchronizacja po aktualizacji aplikacji).
 *  - serwer prowadzi historię wersji (30 dni); dowolną z nich można przywrócić.
 *
 * Konto jest anonimowe: losowy 24-znakowy kod odzyskiwania (Crockford Base32, 120 bitów).
 * Ustawienia synchronizacji („momentum-sync:config”) są lokalne dla urządzenia i leżą poza
 * przestrzenią „momentum.”, więc nie trafiają ani do kopii JSON, ani na serwer.
 */
import { BACKUP_FORMAT, BACKUP_VERSION, parseMomentumBackup, restoreMomentumBackup, type BackupPreview } from './backup';
import { todayKey } from './date';
import {
  getMomentumSnapshot, initializeOfflineDatabase, setMomentumWritesPaused, subscribeMomentumWrites, syncOfflineSnapshot,
} from './offlineDatabase';
import { clearSyncBase, readSyncBase, writeSyncBase } from './syncBase';
import { mergeStorage } from './syncMerge';

const CONFIG_KEY = 'momentum-sync:config';
/** Komunikat po przeładowaniu (np. „Połączono zmiany…”), pokazywany raz jako toast. */
const NOTICE_KEY = 'momentum-sync:notice';
const REVISION_KEY = 'momentum.persistence.revision';
const SYNC_FORMAT = 'momentum-sync';
const SYNC_SCHEMA_VERSION = 1;
/** Musi zgadzać się z MAX_SNAPSHOT_BYTES w worker/sync.ts. */
export const MAX_SYNC_BYTES = 6 * 1024 * 1024;
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_BYTES = 15;

const PUSH_DEBOUNCE_MS = 2500;
const POLL_MS = 60_000;
const RECHECK_MS = 10_000;
const IDLE_BEFORE_RELOAD_MS = 20_000;
const STARTUP_TIMEOUT_MS = 2000;
const REQUEST_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 60_000;
/** Przeglądarki przyjmują keepalive tylko dla małych żądań (limit ok. 64 KB). */
const KEEPALIVE_LIMIT = 60_000;

const SERVER_MISSING = 'Serwer synchronizacji nie odpowiada. Sprawdź, czy wdrożenie zawiera Workera z pliku wrangler.jsonc.';
const DB_MISSING = 'Serwer działa, ale nie ma bazy danych. Wklej Database ID bazy D1 w wrangler.jsonc (d1_databases) i wdroż ponownie.';

export type CloudSyncPhase = 'off' | 'idle' | 'syncing' | 'offline' | 'conflict' | 'update-ready' | 'error';
export type CloudSyncErrorCode =
  'offline' | 'unavailable' | 'not-found' | 'conflict' | 'too-large' | 'rate-limited' | 'invalid' | 'server';

export interface CloudRemoteSummary {
  revision: number;
  updatedAt: string | null;
  preview: BackupPreview;
}

export interface CloudSyncState {
  phase: CloudSyncPhase;
  enabled: boolean;
  /** Kod odzyskiwania zapamiętany na tym urządzeniu (bez myślników) albo null. */
  code: string | null;
  lastSyncAt: string | null;
  pendingLocal: boolean;
  error: CloudSyncErrorCode | null;
  message: string | null;
  /** Nowsze dane z chmury czekające na decyzję (konflikt) lub bezpieczny moment (update-ready). */
  remote: CloudRemoteSummary | null;
  lastSize: number | null;
}

export interface CloudLinkPreview {
  code: string;
  remote: CloudRemoteSummary;
}

/** Wersja w historii serwera: dzienna, przed dużym usunięciem danych albo przed przywróceniem/wyborem wersji. */
export type CloudHistoryReason = 'daily' | 'shrink' | 'manual';
export interface CloudHistoryEntry {
  revision: number;
  savedAt: string;
  reason: CloudHistoryReason;
  size: number;
}

interface CloudSyncConfig {
  version: 1;
  enabled: boolean;
  code: string;
  userId: string | null;
  /** Rewizja na serwerze, która odpowiada lokalnym danym o skrócie `hash`. */
  revision: number;
  /** Odcisk lokalnych danych w chwili ostatniej synchronizacji (null = jeszcze nie wysłano). */
  hash: string | null;
  lastSyncAt: string | null;
}

interface LocalSnapshot {
  storage: Record<string, string>;
  canonical: string;
  hash: string;
}

interface RemoteSnapshot extends LocalSnapshot {
  revision: number;
  updatedAt: string | null;
  createdAt: string;
  preview: BackupPreview;
}

type SyncReason = 'startup' | 'start' | 'resume' | 'poll' | 'online' | 'write' | 'flush' | 'manual';

const CLOUD_SYNC_OFF_STATE: CloudSyncState = Object.freeze({
  phase: 'off', enabled: false, code: null, lastSyncAt: null, pendingLocal: false,
  error: null, message: null, remote: null, lastSize: null,
});

export class CloudSyncError extends Error {
  readonly code: CloudSyncErrorCode;
  readonly revision: number | null;

  constructor(code: CloudSyncErrorCode, message: string, revision: number | null = null) {
    super(message);
    this.name = 'CloudSyncError';
    this.code = code;
    this.revision = revision;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const nowIso = () => new Date().toISOString();

function toRevision(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

// ---------- Kod odzyskiwania ----------
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_BYTES));
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += CODE_ALPHABET[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  return output;
}

/** Wielkie litery, bez spacji i myślników; O→0 oraz I/L→1 (pomyłki przy przepisywaniu). */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
}

export function isRecoveryCode(code: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{24}$/.test(code);
}

export function formatRecoveryCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? [code]).join('-');
}

// ---------- Migawka danych ----------
/** Szybki 64-bitowy odcisk (cyrb53) do wykrywania zmian — nie zabezpieczenie.
 * Działa też bez crypto.subtle (np. HTTP w sieci lokalnej). */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}-${text.length}`;
}

/** Posortowane klucze i bez lokalnego licznika zapisów, aby ten sam stan miał ten sam odcisk na każdym urządzeniu. */
function canonicalize(storage: Record<string, string>): LocalSnapshot {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(storage).filter(key => key !== REVISION_KEY).sort()) sorted[key] = storage[key];
  const canonical = JSON.stringify(sorted);
  return { storage: sorted, canonical, hash: fingerprint(canonical) };
}

function readLocal(): LocalSnapshot {
  return canonicalize(getMomentumSnapshot());
}

function parseRemote(revision: number, updatedAt: string | null, snapshot: unknown): RemoteSnapshot {
  if (!isRecord(snapshot) || snapshot.format !== SYNC_FORMAT || !isRecord(snapshot.storage)) {
    throw new CloudSyncError('invalid', 'Dane w chmurze mają nieznany format.');
  }
  if (snapshot.schemaVersion !== SYNC_SCHEMA_VERSION) {
    throw new CloudSyncError('invalid', 'Dane w chmurze zapisała nowsza wersja Momentum. Zaktualizuj aplikację na tym urządzeniu.');
  }
  const createdAt = typeof snapshot.createdAt === 'string' && Number.isFinite(Date.parse(snapshot.createdAt))
    ? snapshot.createdAt : nowIso();
  const storage: Record<string, unknown> = { ...snapshot.storage };
  delete storage[REVISION_KEY];
  try {
    // Ten sam walidator co import kopii JSON: klucze, typy, główne dane i historia Focus.
    const parsed = parseMomentumBackup(JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: BACKUP_VERSION, createdAt, storage }));
    return { ...canonicalize(parsed.backup.storage), revision, updatedAt, createdAt, preview: parsed.preview };
  } catch (error) {
    throw new CloudSyncError('invalid', `Dane w chmurze są nieprawidłowe: ${error instanceof Error ? error.message : 'uszkodzona migawka'}`);
  }
}

function summarize(remote: RemoteSnapshot): CloudRemoteSummary {
  return { revision: remote.revision, updatedAt: remote.updatedAt, preview: remote.preview };
}

/** Zastępuje lokalne dane podaną migawką (atomowo, jak import kopii JSON). */
async function writeStorageToDevice(storage: Record<string, string>, createdAt: string, beforeReload: boolean): Promise<void> {
  if (beforeReload) setMomentumWritesPaused(true);
  try {
    restoreMomentumBackup(window.localStorage, { format: BACKUP_FORMAT, schemaVersion: BACKUP_VERSION, createdAt, storage });
    await syncOfflineSnapshot();
  } catch (error) {
    setMomentumWritesPaused(false);
    throw new CloudSyncError('invalid', error instanceof Error ? error.message : 'Nie udało się zapisać danych z chmury na tym urządzeniu.');
  }
}

/**
 * Scalanie trójstronne: zmiany z tego urządzenia i z chmury względem ostatniej wspólnej wersji.
 * Gdy obie strony zmieniły to samo pole, wygrywa nowsza zmiana. Null = nie da się scalić bezpiecznie.
 */
function mergeSnapshots(base: LocalSnapshot, local: LocalSnapshot, remote: RemoteSnapshot): LocalSnapshot | null {
  try {
    const localTime = Number(getMomentumSnapshot()[REVISION_KEY] ?? 0);
    const remoteTime = Date.parse(remote.createdAt);
    const preferLocal = Number.isFinite(localTime) && localTime > 0 && (!Number.isFinite(remoteTime) || localTime >= remoteTime);
    const storage = mergeStorage(base.storage, local.storage, remote.storage, preferLocal);
    // Ten sam walidator co import kopii JSON — do urządzenia trafiają tylko poprawne dane.
    parseMomentumBackup(JSON.stringify({ format: BACKUP_FORMAT, schemaVersion: BACKUP_VERSION, createdAt: nowIso(), storage }));
    return canonicalize(storage);
  } catch (error) {
    console.warn('[Momentum] Cloud sync merge failed:', error);
    return null;
  }
}

function formatSavedAt(iso: string | null): string {
  const time = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return 'wybranego dnia';
  return new Date(time).toLocaleString('pl-PL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

/** Przeładowanie (potrzebne, by pokazać nowe dane) tylko wtedy, gdy niczego nie przerwie. */
function isSafeMomentToReload(lastInteractionAt: number): boolean {
  if (document.visibilityState === 'hidden') return true;
  if (Date.now() - lastInteractionAt < IDLE_BEFORE_RELOAD_MS) return false;
  if (document.querySelector('[aria-modal="true"], .modal-backdrop')) return false;
  const active = document.activeElement;
  return !(active instanceof HTMLElement && (active.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)));
}

// ---------- Ustawienia urządzenia ----------
function loadConfig(): CloudSyncConfig | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null');
    if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.code !== 'string' || !isRecoveryCode(parsed.code)) return null;
    return {
      version: 1,
      enabled: parsed.enabled === true,
      code: parsed.code,
      userId: typeof parsed.userId === 'string' ? parsed.userId : null,
      revision: toRevision(parsed.revision) ?? 0,
      hash: typeof parsed.hash === 'string' ? parsed.hash : null,
      lastSyncAt: typeof parsed.lastSyncAt === 'string' ? parsed.lastSyncAt : null,
    };
  } catch {
    return null;
  }
}

function storeConfig(config: CloudSyncConfig | null): void {
  try {
    if (config) localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    else localStorage.removeItem(CONFIG_KEY);
  } catch (error) {
    console.warn('[Momentum] Cannot store sync settings:', error);
  }
}

// ---------- API ----------
interface ApiResponse {
  status: number;
  data: Record<string, unknown>;
}

interface SnapshotResponse {
  revision: number;
  updatedAt: string | null;
  unchanged: boolean;
  remote: RemoteSnapshot | null;
}

async function callApi(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, code: string | null,
  options: { body?: string; timeoutMs?: number; keepalive?: boolean; headers?: Record<string, string> } = {},
): Promise<ApiResponse> {
  // Celowo bez navigator.onLine: bywa fałszywie „offline”; nieudane żądanie i tak kończy się szybko.
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { ...options.headers };
    if (code) headers.Authorization = `Bearer ${code}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(path, {
      method, headers, body: options.body, cache: 'no-store', credentials: 'omit',
      keepalive: options.keepalive ?? false, signal: controller.signal,
    });
    const text = await response.text();
    // Bez Workera Cloudflare zwróci index.html (fallback SPA) zamiast JSON.
    if (!(response.headers.get('Content-Type') ?? '').includes('application/json')) throw new CloudSyncError('unavailable', SERVER_MISSING);
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new CloudSyncError('unavailable', SERVER_MISSING); }
    return { status: response.status, data: isRecord(data) ? data : {} };
  } catch (error) {
    if (error instanceof CloudSyncError) throw error;
    throw new CloudSyncError('offline', 'Nie udało się połączyć z serwerem synchronizacji. Spróbuję ponownie.');
  } finally {
    window.clearTimeout(timer);
  }
}

function apiError(response: ApiResponse): CloudSyncError {
  const error = typeof response.data.error === 'string' ? response.data.error : '';
  if (response.status === 409) {
    return new CloudSyncError('conflict', 'Dane w chmurze zmieniły się na innym urządzeniu.', toRevision(response.data.revision));
  }
  if (error === 'account-not-found' || error === 'unauthorized') {
    return new CloudSyncError('not-found', 'Na serwerze nie ma danych dla tego kodu. Mogły zostać usunięte z innego urządzenia.');
  }
  if (response.status === 413) {
    return new CloudSyncError('too-large', `Dane przekraczają limit synchronizacji (${formatSize(MAX_SYNC_BYTES)}). Usuń część zdjęć z zadań lub rutyn.`);
  }
  if (response.status === 429) return new CloudSyncError('rate-limited', 'Z tej sieci założono dziś zbyt wiele kont. Spróbuj ponownie jutro.');
  if (response.status === 503 || response.status === 404 || response.status === 405) {
    return new CloudSyncError('unavailable', error === 'database-not-configured' || error === 'database-unavailable' ? DB_MISSING : SERVER_MISSING);
  }
  return new CloudSyncError('server', 'Serwer synchronizacji zwrócił błąd. Spróbuję ponownie za chwilę.');
}

async function fetchSnapshot(code: string, since?: number, timeoutMs?: number): Promise<SnapshotResponse> {
  const response = await callApi('GET', since === undefined ? '/api/snapshot' : `/api/snapshot?since=${since}`, code, { timeoutMs });
  if (response.status !== 200) throw apiError(response);
  const revision = toRevision(response.data.revision);
  if (revision === null) throw new CloudSyncError('server', 'Serwer zwrócił nieprawidłową odpowiedź.');
  const updatedAt = typeof response.data.updatedAt === 'string' ? response.data.updatedAt : null;
  if (response.data.unchanged === true) return { revision, updatedAt, unchanged: true, remote: null };
  if (response.data.snapshot === null || response.data.snapshot === undefined) return { revision, updatedAt, unchanged: false, remote: null };
  return { revision, updatedAt, unchanged: false, remote: parseRemote(revision, updatedAt, response.data.snapshot) };
}

// ---------- Silnik synchronizacji ----------
export class CloudSyncEngine {
  private config: CloudSyncConfig | null = loadConfig();
  private state: CloudSyncState;
  private readonly listeners = new Set<() => void>();
  private chain: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private dirty = false;
  private reloading = false;
  private active = false;
  private teardown: (() => void)[] = [];
  private pushTimer: number | undefined;
  private lastCheckAt = 0;
  private lastInteractionAt = 0;
  private remote: RemoteSnapshot | null = null;
  private linkCandidate: (RemoteSnapshot & { code: string }) | null = null;
  private historyCandidate: RemoteSnapshot | null = null;
  /** Odcisk zapisanej bazy scalania; undefined = jeszcze nie sprawdzono magazynu. */
  private baseHash: string | null | undefined = undefined;
  private pendingNotice: string | null = null;

  constructor() {
    this.state = {
      ...CLOUD_SYNC_OFF_STATE,
      phase: this.config?.enabled ? 'idle' : 'off',
      enabled: !!this.config?.enabled,
      code: this.config?.code ?? null,
      lastSyncAt: this.config?.lastSyncAt ?? null,
    };
  }

  readonly getState = (): CloudSyncState => this.state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Jednorazowy komunikat dla użytkownika (np. po scaleniu zmian albo przywróceniu wersji). */
  takeNotice(): string | null {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(NOTICE_KEY);
      sessionStorage.removeItem(NOTICE_KEY);
    } catch { /* sessionStorage niedostępny */ }
    const notice = this.pendingNotice ?? stored;
    this.pendingNotice = null;
    return notice;
  }

  private setNotice(text: string, afterReload: boolean): void {
    this.pendingNotice = text;
    if (afterReload) try { sessionStorage.setItem(NOTICE_KEY, text); } catch { /* bez komunikatu po przeładowaniu */ }
  }

  // ----- baza scalania: ostatnia wersja uzgodniona z serwerem -----
  private async rememberBase(snapshot: Pick<LocalSnapshot, 'hash' | 'canonical'>, revision: number): Promise<void> {
    this.baseHash = snapshot.hash;
    await writeSyncBase({ hash: snapshot.hash, revision, canonical: snapshot.canonical });
  }

  private async loadBase(config: CloudSyncConfig): Promise<LocalSnapshot | null> {
    const record = await readSyncBase();
    if (!record || record.hash !== config.hash) return null;
    try {
      const parsed: unknown = JSON.parse(record.canonical);
      if (!isRecord(parsed) || !Object.values(parsed).every(value => typeof value === 'string')) return null;
      const snapshot = canonicalize(parsed as Record<string, string>);
      return snapshot.hash === config.hash ? snapshot : null;
    } catch {
      return null;
    }
  }

  /** Dane bez lokalnych zmian są dokładnie ostatnią wspólną wersją — zapamiętujemy je, jeśli trzeba (np. po aktualizacji aplikacji). */
  private async ensureBase(local: LocalSnapshot, config: CloudSyncConfig): Promise<void> {
    if (local.hash !== config.hash) return;
    if (this.baseHash === undefined) this.baseHash = (await readSyncBase())?.hash ?? null;
    if (this.baseHash !== local.hash) await this.rememberBase(local, config.revision);
  }

  private update(patch: Partial<CloudSyncState>): void {
    const config = this.config;
    this.state = {
      ...this.state, ...patch,
      enabled: !!config?.enabled, code: config?.code ?? null, lastSyncAt: config?.lastSyncAt ?? null,
    };
    for (const listener of [...this.listeners]) listener();
  }

  private saveConfig(next: CloudSyncConfig | null): void {
    this.config = next;
    storeConfig(next);
  }

  private patchConfig(patch: Partial<CloudSyncConfig>): void {
    if (this.config) this.saveConfig({ ...this.config, ...patch });
  }

  /** Jedna operacja sieciowa naraz; akcje użytkownika czekają w kolejce. */
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    this.queued++;
    const result = this.chain.then(operation).finally(() => {
      this.queued--;
      if (this.queued === 0 && this.dirty) {
        this.dirty = false;
        this.schedulePush();
      }
    });
    this.chain = result.catch(() => undefined);
    return result;
  }

  // ----- cykl życia (wywołuje hook useCloudSync, gdy flaga i synchronizacja są włączone) -----
  start(): void {
    if (this.active || this.reloading || !this.config?.enabled) return;
    this.active = true;
    const onVisibility = () => { if (document.visibilityState === 'hidden') this.flush(); else this.trigger('resume'); };
    const onOnline = () => this.trigger('online');
    const onPageHide = () => this.flush();
    const onInteraction = () => { this.lastInteractionAt = Date.now(); };
    const interactions = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    const unsubscribe = subscribeMomentumWrites(() => this.schedulePush());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', onPageHide);
    for (const type of interactions) window.addEventListener(type, onInteraction, { capture: true, passive: true });
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') this.trigger('poll'); }, POLL_MS);
    this.teardown = [
      unsubscribe,
      () => document.removeEventListener('visibilitychange', onVisibility),
      () => window.removeEventListener('online', onOnline),
      () => window.removeEventListener('pagehide', onPageHide),
      ...interactions.map(type => () => window.removeEventListener(type, onInteraction, { capture: true })),
      () => window.clearInterval(poll),
      () => { window.clearTimeout(this.pushTimer); this.pushTimer = undefined; },
    ];
    this.trigger('start');
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    for (const dispose of this.teardown.splice(0)) dispose();
  }

  private trigger(reason: SyncReason): void {
    if (!this.active || this.reloading || !this.config?.enabled) return;
    if (this.state.error === 'not-found') return; // konto usunięte: czekamy na decyzję użytkownika
    if (this.queued > 0) {
      if (reason === 'write' || reason === 'flush') this.dirty = true;
      return;
    }
    void this.exclusive(() => this.syncOnce(reason));
  }

  private schedulePush(): void {
    if (!this.active || this.reloading) return;
    window.clearTimeout(this.pushTimer);
    this.pushTimer = window.setTimeout(() => {
      this.pushTimer = undefined;
      this.trigger('write');
    }, PUSH_DEBOUNCE_MS);
  }

  /** Aplikacja schodzi do tła: wyślij oczekujące zmiany od razu. */
  private flush(): void {
    if (this.pushTimer === undefined) return;
    window.clearTimeout(this.pushTimer);
    this.pushTimer = undefined;
    this.trigger('flush');
  }

  private settle(): void {
    this.update({ phase: this.config?.enabled ? 'idle' : 'off', pendingLocal: false, error: null, message: null, remote: null });
  }

  private fail(error: unknown): void {
    const failure = error instanceof CloudSyncError
      ? error : new CloudSyncError('server', error instanceof Error ? error.message : 'Nieznany błąd synchronizacji.');
    const config = this.config;
    if (failure.code === 'conflict' && config?.enabled) {
      // Chmura zmieniła się tuż przed naszym zapisem: spokojnie ponawiamy (pobranie + scalenie), bez komunikatu o błędzie.
      this.update({ phase: 'idle', error: null, message: null, pendingLocal: true });
      this.schedulePush();
      return;
    }
    if (failure.code !== 'offline') console.warn('[Momentum] Cloud sync:', failure.message);
    this.update({
      phase: failure.code === 'offline' ? 'offline' : 'error',
      error: failure.code, message: failure.message,
      pendingLocal: config ? readLocal().hash !== config.hash : false,
    });
  }

  private async syncOnce(reason: SyncReason): Promise<void> {
    const config = this.config;
    if (!config?.enabled || this.reloading) return;
    if (this.state.phase === 'conflict' && reason !== 'manual') return;
    const local = readLocal();
    const pendingLocal = local.hash !== config.hash;
    const writeOnly = reason === 'write' || reason === 'flush';
    if (writeOnly && this.state.phase === 'update-ready' && this.remote) {
      // Czekają nowsze dane z chmury: zamiast zapisu, który skończyłby się 409, łączymy z nimi zmiany
      // (po cichu, jeśli to bezpieczny moment, np. aplikacja schodzi do tła).
      try { await this.handleRemote(this.remote, local, reason); } catch (error) { this.fail(error); }
      return;
    }
    const throttled = (reason === 'start' || reason === 'resume') && this.state.phase !== 'update-ready'
      && Date.now() - this.lastCheckAt < RECHECK_MS;
    const checkRemote = !writeOnly && !throttled;
    if (!checkRemote && !pendingLocal) return;
    this.update({ phase: 'syncing', pendingLocal });
    try {
      if (!pendingLocal) await this.ensureBase(local, config);
      if (checkRemote) {
        const result = await fetchSnapshot(config.code, config.revision);
        this.lastCheckAt = Date.now();
        if (!result.unchanged) {
          if (result.remote) await this.handleRemote(result.remote, local, reason);
          else await this.push(local, result.revision); // pusty serwer: wysyłamy dane od nowa
          return;
        }
      }
      if (pendingLocal) await this.push(local, config.revision, { keepalive: reason === 'flush' });
      else this.settle();
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * Nowsza wersja w chmurze. Bez lokalnych zmian — wczytujemy ją. Ze zmianami po obu stronach —
   * scalamy je; gdy to wymaga odświeżenia widoku, robimy to w bezpiecznym momencie (albo od razu
   * przy starcie lub na prośbę użytkownika: `force`). Wybór wersji tylko bez wspólnej bazy.
   */
  private async handleRemote(remote: RemoteSnapshot, local: LocalSnapshot, reason: SyncReason, force = false): Promise<void> {
    const config = this.config;
    if (!config) return;
    if (remote.hash === local.hash) {
      // Te same dane (np. nie dotarła odpowiedź na nasz własny zapis).
      this.remote = null;
      this.patchConfig({ revision: remote.revision, hash: local.hash, lastSyncAt: nowIso() });
      await this.rememberBase(local, remote.revision);
      this.settle();
      return;
    }
    this.remote = remote;
    const startup = reason === 'startup';
    const applyNow = startup || force || isSafeMomentToReload(this.lastInteractionAt);
    const localChanged = local.hash !== config.hash;
    if (!localChanged) {
      if (applyNow) { await this.apply(remote, !startup); return; }
      this.update({ phase: 'update-ready', remote: summarize(remote), error: null, message: null });
      return;
    }
    const base = await this.loadBase(config);
    const merged = base ? mergeSnapshots(base, local, remote) : null;
    if (!merged) {
      this.update({ phase: 'conflict', remote: summarize(remote), pendingLocal: true, error: null, message: null });
      return;
    }
    if (merged.hash === local.hash) {
      // Zmiany z chmury już tu są: wysyłamy dane z tego urządzenia na nowej bazie, bez przeładowania.
      this.remote = null;
      this.patchConfig({ revision: remote.revision, hash: remote.hash });
      await this.rememberBase(remote, remote.revision);
      await this.push(local, remote.revision, { attempt: 1 });
      return;
    }
    if (!applyNow) {
      this.update({ phase: 'update-ready', remote: summarize(remote), pendingLocal: true, error: null, message: null });
      return;
    }
    if (merged.hash === remote.hash) await this.apply(remote, !startup); // lokalne zmiany są już w chmurze
    else await this.applyMerged(remote, merged, !startup);
  }

  private async upload(snapshot: Pick<LocalSnapshot, 'canonical'>, base: number, options: { keepalive?: boolean; archive?: boolean } = {}): Promise<{ response: ApiResponse; size: number }> {
    const config = this.config;
    if (!config) throw new CloudSyncError('invalid', 'Synchronizacja jest wyłączona.');
    const body = `{"format":"${SYNC_FORMAT}","schemaVersion":${SYNC_SCHEMA_VERSION},"createdAt":"${nowIso()}","storage":${snapshot.canonical}}`;
    const size = new Blob([body]).size;
    if (size > MAX_SYNC_BYTES) {
      throw new CloudSyncError('too-large', `Dane zajmują ${formatSize(size)}, a limit synchronizacji to ${formatSize(MAX_SYNC_BYTES)}. Usuń część zdjęć z zadań lub rutyn.`);
    }
    // Dzień według kalendarza użytkownika: serwer archiwizuje wersję przy pierwszym zapisie dnia.
    const response = await callApi('PUT', `/api/snapshot?base=${base}${options.archive ? '&archive=1' : ''}`, config.code, {
      body, keepalive: !!options.keepalive && size <= KEEPALIVE_LIMIT, timeoutMs: UPLOAD_TIMEOUT_MS,
      headers: { 'X-Momentum-Day': todayKey() },
    });
    return { response, size };
  }

  private async push(local: LocalSnapshot, base: number, options: { keepalive?: boolean; archive?: boolean; attempt?: number } = {}): Promise<void> {
    const config = this.config;
    if (!config) return;
    const { response, size } = await this.upload(local, base, options);
    if (response.status === 200) {
      const revision = toRevision(response.data.revision);
      if (revision === null) throw new CloudSyncError('server', 'Serwer zwrócił nieprawidłową odpowiedź.');
      this.remote = null;
      this.patchConfig({ revision, hash: local.hash, lastSyncAt: nowIso() });
      await this.rememberBase(local, revision);
      this.update({ lastSize: size });
      this.settle();
      return;
    }
    if (response.status === 409 && (options.attempt ?? 0) === 0) {
      const latest = await fetchSnapshot(config.code);
      if (latest.remote) await this.handleRemote(latest.remote, local, 'write');
      else await this.push(local, latest.revision, { ...options, attempt: 1 });
      return;
    }
    throw apiError(response);
  }

  private async apply(remote: RemoteSnapshot, reload: boolean, patch: Partial<CloudSyncConfig> = {}): Promise<void> {
    await writeStorageToDevice(remote.storage, remote.createdAt, reload);
    this.remote = null;
    const base: CloudSyncConfig = this.config
      ?? { version: 1, enabled: false, code: patch.code ?? '', userId: null, revision: 0, hash: null, lastSyncAt: null };
    this.saveConfig({ ...base, ...patch, revision: remote.revision, hash: remote.hash, lastSyncAt: nowIso() });
    await this.rememberBase(remote, remote.revision);
    if (reload) {
      this.reloading = true;
      this.stop();
      window.location.reload();
      return;
    }
    // Przed pierwszym renderem: odśwież pamięć podręczną magazynu offline zamiast przeładowania.
    await initializeOfflineDatabase();
    this.settle();
  }

  /** Zapisuje scalone dane. Bazą staje się wersja z chmury, więc scalony wynik wyjdzie na serwer jako zwykła zmiana. */
  private async applyMerged(remote: RemoteSnapshot, merged: LocalSnapshot, reload: boolean): Promise<void> {
    await writeStorageToDevice(merged.storage, nowIso(), reload);
    this.remote = null;
    this.patchConfig({ revision: remote.revision, hash: remote.hash, lastSyncAt: nowIso() });
    await this.rememberBase(remote, remote.revision);
    this.setNotice('Połączono zmiany z innego urządzenia.', reload);
    if (reload) {
      this.reloading = true;
      this.stop();
      window.location.reload();
      return;
    }
    await initializeOfflineDatabase();
    this.update({ phase: 'idle', pendingLocal: true, error: null, message: null, remote: null });
  }

  // ----- akcje publiczne -----
  /** Przy starcie, przed renderem: nowsze dane z chmury wczytujemy bez przeładowania strony. */
  async startup(): Promise<void> {
    const config = this.config;
    if (!config?.enabled) return;
    await this.exclusive(async () => {
      const local = readLocal();
      try {
        const result = await fetchSnapshot(config.code, config.revision, STARTUP_TIMEOUT_MS);
        this.lastCheckAt = Date.now();
        if (result.unchanged) {
          this.update({ pendingLocal: local.hash !== config.hash });
          await this.ensureBase(local, config);
        } else if (result.remote) await this.handleRemote(result.remote, local, 'startup');
      } catch (error) {
        this.fail(error); // offline lub wolna sieć: startujemy na danych lokalnych
      }
    });
  }

  /** Nowe konto (albo ponowne włączenie z zapamiętanym kodem) i pierwsza synchronizacja. */
  async enable(): Promise<void> {
    await this.exclusive(async () => {
      const previous = this.config;
      const code = previous?.code ?? generateRecoveryCode();
      this.update({ phase: 'syncing', error: null, message: null });
      try {
        const response = await callApi('POST', '/api/account', code);
        if (response.status !== 200 && response.status !== 201) throw apiError(response);
        const userId = typeof response.data.userId === 'string' ? response.data.userId : null;
        this.saveConfig(previous
          ? { ...previous, enabled: true, userId }
          : { version: 1, enabled: true, code, userId, revision: toRevision(response.data.revision) ?? 0, hash: null, lastSyncAt: null });
        this.update({ phase: 'idle' });
      } catch (error) {
        this.fail(error);
        if (!this.config?.enabled) this.update({ phase: 'off' });
        throw error;
      }
    });
    await this.exclusive(() => this.syncOnce('manual'));
  }

  /** Sprawdza kod z innego urządzenia i zwraca podgląd danych z chmury (bez zmian lokalnych). */
  async previewLink(input: string): Promise<CloudLinkPreview> {
    const code = normalizeRecoveryCode(input);
    if (!isRecoveryCode(code)) {
      throw new CloudSyncError('invalid', 'Kod ma 24 znaki: cyfry i litery (bez I, L, O i U). Sprawdź, czy przepisano go w całości.');
    }
    if (this.config?.enabled && this.config.code === code) throw new CloudSyncError('invalid', 'To urządzenie już używa tego kodu.');
    const result = await fetchSnapshot(code);
    if (!result.remote) {
      throw new CloudSyncError('not-found', 'Konto istnieje, ale nie ma jeszcze danych. Otwórz Momentum na pierwszym urządzeniu z internetem i spróbuj ponownie.');
    }
    this.linkCandidate = { ...result.remote, code };
    return { code, remote: summarize(result.remote) };
  }

  /** Zastępuje dane tego urządzenia danymi z chmury, zapamiętuje kod i przeładowuje aplikację. */
  async confirmLink(code: string): Promise<void> {
    const candidate = this.linkCandidate;
    if (!candidate || candidate.code !== code) throw new CloudSyncError('invalid', 'Sprawdź kod ponownie.');
    await this.exclusive(async () => {
      this.stop();
      await this.apply(candidate, true, { enabled: true, code, userId: null });
    });
  }

  async syncNow(): Promise<void> {
    await this.exclusive(() => this.syncOnce('manual'));
  }

  /** Konflikt bez wspólnej wersji: zachowaj dane z tego urządzenia. Wersja z chmury trafia do historii (?archive=1). */
  async keepLocal(): Promise<void> {
    await this.exclusive(async () => {
      const config = this.config;
      if (!config?.enabled) return;
      this.update({ phase: 'syncing' });
      try {
        const base = this.remote?.revision ?? (await fetchSnapshot(config.code)).revision;
        await this.push(readLocal(), base, { archive: true });
      } catch (error) {
        this.fail(error);
      }
    });
  }

  /** Konflikt bez wspólnej wersji: wczytaj najnowszą wersję z chmury (zastępuje dane lokalne) i przeładuj. */
  async takeRemote(): Promise<void> {
    await this.exclusive(async () => {
      const config = this.config;
      if (!config?.enabled) return;
      this.update({ phase: 'syncing' });
      try {
        const latest = await fetchSnapshot(config.code);
        if (latest.remote) await this.apply(latest.remote, true);
        else await this.push(readLocal(), latest.revision);
      } catch (error) {
        this.fail(error);
      }
    });
  }

  /** „Wczytaj”: najnowsza wersja z chmury; zmiany z tego urządzenia zostają do niej dołączone (scalanie). */
  async loadUpdate(): Promise<void> {
    await this.exclusive(async () => {
      const config = this.config;
      if (!config?.enabled) return;
      this.update({ phase: 'syncing' });
      try {
        const latest = await fetchSnapshot(config.code);
        const local = readLocal();
        if (latest.remote) await this.handleRemote(latest.remote, local, 'manual', true);
        else await this.push(local, latest.revision);
      } catch (error) {
        this.fail(error);
      }
    });
  }

  // ----- historia wersji (serwer: 30 dni) -----
  async listHistory(): Promise<CloudHistoryEntry[]> {
    const config = this.config;
    if (!config?.enabled) throw new CloudSyncError('invalid', 'Włącz synchronizację, aby zobaczyć historię wersji.');
    const response = await callApi('GET', '/api/history', config.code);
    if (response.status === 404 && response.data.error === 'not-found') {
      throw new CloudSyncError('unavailable', 'Historia wersji będzie dostępna po wdrożeniu nowej wersji serwera.');
    }
    if (response.status !== 200) throw apiError(response);
    const entries = Array.isArray(response.data.entries) ? response.data.entries : [];
    return entries.flatMap(entry => {
      if (!isRecord(entry)) return [];
      const revision = toRevision(entry.revision);
      const savedAt = typeof entry.savedAt === 'string' && Number.isFinite(Date.parse(entry.savedAt)) ? entry.savedAt : null;
      if (revision === null || !savedAt) return [];
      const reason: CloudHistoryReason = entry.reason === 'shrink' || entry.reason === 'manual' ? entry.reason : 'daily';
      return [{ revision, savedAt, reason, size: typeof entry.size === 'number' && entry.size > 0 ? entry.size : 0 }];
    });
  }

  /** Pobiera i sprawdza wersję z historii (bez zmian lokalnych); zwraca podgląd do potwierdzenia. */
  async previewHistory(revision: number): Promise<CloudRemoteSummary> {
    const config = this.config;
    if (!config?.enabled) throw new CloudSyncError('invalid', 'Włącz synchronizację, aby przywrócić wersję.');
    const response = await callApi('GET', `/api/history/${revision}`, config.code, { timeoutMs: UPLOAD_TIMEOUT_MS });
    if (response.status === 404 && response.data.error === 'version-not-found') {
      throw new CloudSyncError('not-found', 'Tej wersji nie ma już w historii. Odśwież listę.');
    }
    if (response.status !== 200) throw apiError(response);
    const savedAt = typeof response.data.updatedAt === 'string' ? response.data.updatedAt : null;
    const candidate = parseRemote(revision, savedAt, response.data.snapshot);
    this.historyCandidate = candidate;
    return summarize(candidate);
  }

  /**
   * Przywraca wersję z historii na wszystkich urządzeniach: wysyła ją jako najnowszą (bieżąca wersja
   * z chmury trafia przy tym do historii, więc można to cofnąć), zapisuje lokalnie i przeładowuje.
   */
  async restoreHistory(revision: number): Promise<void> {
    const candidate = this.historyCandidate;
    if (!candidate || candidate.revision !== revision) throw new CloudSyncError('invalid', 'Najpierw otwórz podgląd tej wersji.');
    await this.exclusive(async () => {
      const config = this.config;
      if (!config?.enabled) return;
      this.update({ phase: 'syncing', error: null, message: null });
      try {
        let { response } = await this.upload(candidate, config.revision, { archive: true });
        const current = response.status === 409 ? toRevision(response.data.revision) : null;
        if (current !== null) ({ response } = await this.upload(candidate, current, { archive: true }));
        if (response.status !== 200) throw apiError(response);
        const pushed = toRevision(response.data.revision);
        if (pushed === null) throw new CloudSyncError('server', 'Serwer zwrócił nieprawidłową odpowiedź.');
        await writeStorageToDevice(candidate.storage, nowIso(), true);
        this.historyCandidate = null;
        this.remote = null;
        this.patchConfig({ revision: pushed, hash: candidate.hash, lastSyncAt: nowIso() });
        await this.rememberBase(candidate, pushed);
        this.setNotice(`Przywrócono wersję z ${formatSavedAt(candidate.updatedAt)}. Poprzednia jest w historii wersji.`, true);
        this.reloading = true;
        this.stop();
        window.location.reload();
      } catch (error) {
        this.fail(error);
        throw error;
      }
    });
  }

  /** Wyłącza synchronizację na tym urządzeniu; kod i dane w chmurze zostają. */
  disable(): void {
    this.stop();
    this.remote = null;
    this.patchConfig({ enabled: false });
    this.update({ phase: 'off', pendingLocal: false, error: null, message: null, remote: null });
  }

  /** Usuwa zapamiętany kod z tego urządzenia (dane w chmurze zostają). */
  forget(): void {
    this.stop();
    this.remote = null;
    this.historyCandidate = null;
    this.saveConfig(null);
    this.baseHash = null;
    void clearSyncBase();
    this.update({ phase: 'off', pendingLocal: false, error: null, message: null, remote: null, lastSize: null });
  }

  /** Usuwa konto i dane z serwera; dane na urządzeniu zostają bez zmian. */
  async deleteRemote(): Promise<void> {
    await this.exclusive(async () => {
      const config = this.config;
      if (!config) return;
      const response = await callApi('DELETE', '/api/account', config.code);
      if (response.status !== 200 && response.status !== 404) throw apiError(response);
      this.forget();
    });
  }

  async checkServer(): Promise<{ ok: boolean; message: string | null }> {
    try {
      const response = await callApi('GET', '/api/health', null, { timeoutMs: 8000 });
      if (response.status === 200 && response.data.ok === true) return { ok: true, message: null };
      return { ok: false, message: apiError(response).message };
    } catch (error) {
      return { ok: false, message: error instanceof CloudSyncError ? error.message : SERVER_MISSING };
    }
  }
}

let engine: CloudSyncEngine | null = null;

export function getCloudSyncEngine(): CloudSyncEngine {
  engine ??= new CloudSyncEngine();
  return engine;
}

/** Wywoływane w main.tsx przed renderem. Bez włączonej synchronizacji kończy się od razu (bez żądań);
 * z włączoną nigdy nie blokuje startu dłużej niż ~2 s. */
export async function syncBeforeRender(): Promise<void> {
  try {
    await getCloudSyncEngine().startup();
  } catch (error) {
    console.warn('[Momentum] Cloud sync startup skipped:', error);
  }
}
