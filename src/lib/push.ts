/**
 * Powiadomienia push z serwera Momentum (Web Push) — przypomnienia docierają także przy zamkniętej aplikacji.
 *
 * Aplikacja wylicza przypomnienia na 7 dni (tą samą funkcją co lokalny harmonogram) i wysyła je na serwer,
 * który co minutę wysyła te, których czas nadszedł. Gdy włączona jest synchronizacja w chmurze, lista jest
 * wspólna dla konta: zadanie dodane na laptopie powiadomi telefon, nawet jeśli aplikacja na nim jest zamknięta.
 *
 * iOS (16.4+, aplikacja z ekranu początkowego): pushManager.subscribe() musi być PIERWSZYM wywołaniem po
 * stuknięciu, bez wcześniejszego await — dlatego rejestrację service workera i klucz serwera pobieramy zawczasu.
 * Ustawienia urządzenia („momentum-push:*”) leżą poza przestrzenią „momentum.” (nie trafiają do kopii ani synchronizacji).
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { AppData } from '../types';
import { fingerprint, generateRecoveryCode, getCloudSyncEngine } from './cloudSync';
import { reminderOpenUrl } from './notifications';
import { collectReminders, reminderLeadText, resolveNotificationSettings } from './reminders';

const CONFIG_KEY = 'momentum-push:config';
const MEMO_KEY = 'momentum-push:schedule';
const HORIZON_MS = 7 * 86_400_000;
/** Właśnie minione przypomnienia zostają na liście, by cron zdążył je wysłać (serwer nie wysyła dwa razy). */
const LOOKBACK_MS = 10 * 60_000;
const MAX_JOBS = 150;
/** Nawet bez zmian odświeżamy listę co 6 h, żeby horyzont 7 dni przesuwał się z czasem. */
const REFRESH_MS = 6 * 60 * 60_000;
const UPLOAD_DEBOUNCE_MS = 3000;

export type PushStatus = 'unsupported' | 'unavailable' | 'inactive' | 'working' | 'active' | 'error';
export interface PushState { status: PushStatus; message: string | null; scope: 'account' | 'device' | null }

interface PushConfig {
  version: 1;
  secret: string;
  endpoint: string;
  scope: 'account' | 'device';
  /** Kod konta synchronizacji, z którym urządzenie jest powiązane na serwerze (null = tylko to urządzenie). */
  linkedCode: string | null;
}

interface PushJob {
  tag: string; at: number; title: string; body: string; url: string;
  kind: 'task' | 'routine'; sourceId: string; occurrenceDate: string; startAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window;
}

function loadConfig(): PushConfig | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null');
    if (!isRecord(parsed) || parsed.version !== 1 || typeof parsed.secret !== 'string' || typeof parsed.endpoint !== 'string') return null;
    return {
      version: 1, secret: parsed.secret, endpoint: parsed.endpoint,
      scope: parsed.scope === 'account' ? 'account' : 'device',
      linkedCode: typeof parsed.linkedCode === 'string' ? parsed.linkedCode : null,
    };
  } catch {
    return null;
  }
}

function saveConfig(config: PushConfig | null): void {
  try {
    if (config) localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    else { localStorage.removeItem(CONFIG_KEY); localStorage.removeItem(MEMO_KEY); }
  } catch { /* pełna pamięć — ustawienie zostaje w tej sesji */ }
}

/** Push z serwera działa na tym urządzeniu — lokalny harmonogram nie wysyła wtedy własnych powiadomień systemowych. */
export function isPushActive(): boolean {
  return !!loadConfig() && typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

// ---------- stan dla UI ----------
let state: PushState = {
  status: !isPushSupported() ? 'unsupported' : loadConfig() ? 'active' : 'inactive',
  message: null,
  scope: loadConfig()?.scope ?? null,
};
const listeners = new Set<() => void>();
function setState(patch: Partial<PushState>): void {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener();
}
const subscribeState = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getState = () => state;

// ---------- serwer ----------
async function callApi(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, token: string | null,
  body?: unknown, extraHeaders: Record<string, string> = {}): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method, headers, cache: 'no-store', credentials: 'omit', body: body === undefined ? undefined : JSON.stringify(body),
  });
  const isJson = (response.headers.get('Content-Type') ?? '').includes('application/json');
  const data: unknown = isJson ? await response.json().catch(() => ({})) : {};
  // Bez Workera (np. fallback SPA) odpowiedź nie jest JSON-em — traktujemy jak niedostępny serwer.
  return { status: isJson ? response.status : 503, data: isRecord(data) ? data : {} };
}

function syncCode(): string | null {
  const sync = getCloudSyncEngine().getState();
  return sync.enabled && sync.code ? sync.code : null;
}

// ---------- przygotowanie (bez gestu) ----------
let registration: ServiceWorkerRegistration | null = null;
let vapidKey: string | null = null;
let priming: Promise<void> | null = null;

/** Pobiera zawczasu rejestrację service workera i klucz VAPID serwera, by subskrypcja po stuknięciu była natychmiastowa. */
export function primePush(): Promise<void> {
  if (!isPushSupported()) return Promise.resolve();
  priming ??= (async () => {
    if (!registration) {
      const timeout = new Promise<null>(resolve => window.setTimeout(() => resolve(null), 4000));
      registration = await Promise.race([navigator.serviceWorker.ready.catch(() => null), timeout]);
      if (!registration) {
        if (!loadConfig()) setState({ status: 'unavailable', message: 'Powiadomienia w tle działają w zainstalowanej aplikacji (wersja produkcyjna, HTTPS).' });
        return;
      }
    }
    if (!vapidKey) {
      try {
        const { status, data } = await callApi('GET', '/api/push/key', null);
        if (status === 200 && typeof data.publicKey === 'string') vapidKey = data.publicKey;
        else if (state.status === 'inactive') setState({ status: 'unavailable', message: 'Serwer powiadomień jest niedostępny.' });
      } catch { /* offline — spróbujemy przy kolejnym otwarciu */ }
    }
    if (vapidKey && state.status === 'unavailable') setState({ status: loadConfig() ? 'active' : 'inactive', message: null });
  })().finally(() => { priming = null; });
  return priming;
}

export function canSubscribeNow(): boolean {
  return isPushSupported() && !!registration && !!vapidKey;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function registerSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  const previous = loadConfig();
  const secret = previous?.secret ?? generateRecoveryCode();
  const account = syncCode();
  const { status, data } = await callApi('PUT', '/api/push/device', secret, { endpoint: json.endpoint, keys: json.keys },
    account ? { 'X-Momentum-Account': account } : {});
  if (status !== 200) {
    throw new Error(status === 429 ? 'Zbyt wiele prób z tej sieci. Spróbuj jutro.' : 'Serwer nie zapisał subskrypcji. Spróbuj ponownie później.');
  }
  const scope = data.scope === 'account' ? 'account' : 'device';
  saveConfig({ version: 1, secret, endpoint: json.endpoint ?? subscription.endpoint, scope, linkedCode: scope === 'account' ? account : null });
  try { localStorage.removeItem(MEMO_KEY); } catch { /* wymusza wysłanie listy przypomnień */ }
  setState({ status: 'active', message: null, scope });
}

/**
 * Wywołuj SYNCHRONICZNIE z obsługi kliknięcia: subskrypcja jest pierwszym wywołaniem (wymóg iOS).
 * Gdy zgoda nie została jeszcze udzielona, przeglądarka sama o nią zapyta.
 */
export function subscribeFromGesture(): Promise<void> {
  const currentRegistration = registration;
  const key = vapidKey;
  if (!currentRegistration || !key) {
    void primePush();
    return Promise.reject(new Error('Przygotowuję połączenie z serwerem — spróbuj ponownie za chwilę.'));
  }
  const subscribing = currentRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  setState({ status: 'working', message: null });
  return subscribing.then(registerSubscription).catch((error: unknown) => {
    const denied = typeof Notification !== 'undefined' && Notification.permission === 'denied';
    // Subskrypcja z innym kluczem serwera (np. po odtworzeniu bazy): usuń ją; kolejne stuknięcie utworzy nową.
    const staleKey = error instanceof Error && error.name === 'InvalidStateError';
    if (staleKey) void currentRegistration.pushManager.getSubscription().then(old => old?.unsubscribe()).catch(() => undefined);
    const message = denied ? 'Powiadomienia są zablokowane w ustawieniach systemu.'
      : staleKey ? 'Odświeżono subskrypcję — stuknij „Włącz” jeszcze raz.'
      : error instanceof Error && error.name !== 'NotAllowedError' && error.name !== 'AbortError' ? error.message
      : 'Nie udało się włączyć powiadomień w tle. Spróbuj ponownie.';
    setState({ status: loadConfig() ? 'active' : 'inactive', message });
    throw error instanceof Error ? error : new Error(message);
  });
}

/** Bez gestu: sprawdza, czy subskrypcja nadal istnieje i czy jest powiązana z właściwym kontem synchronizacji. */
export async function refreshPushRegistration(): Promise<void> {
  const config = loadConfig();
  if (!config || !isPushSupported()) return;
  if (Notification.permission !== 'granted') {
    saveConfig(null);
    setState({ status: 'inactive', scope: null, message: 'Zgoda na powiadomienia została cofnięta w ustawieniach systemu.' });
    return;
  }
  await primePush();
  if (!registration) return;
  try {
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      saveConfig(null);
      setState({ status: 'inactive', scope: null, message: 'Subskrypcja wygasła — włącz powiadomienia w tle ponownie.' });
      void callApi('DELETE', '/api/push/device', config.secret).catch(() => undefined);
      return;
    }
    if (subscription.endpoint !== config.endpoint || syncCode() !== config.linkedCode) await registerSubscription(subscription);
    else if (state.status !== 'active') setState({ status: 'active', message: null, scope: config.scope });
  } catch {
    /* offline — stan sprawdzimy przy kolejnym powrocie do aplikacji */
  }
}

export async function disablePush(): Promise<void> {
  const config = loadConfig();
  setState({ status: 'working', message: null });
  try { await (await registration?.pushManager.getSubscription())?.unsubscribe(); } catch { /* subskrypcja już nie istnieje */ }
  if (config) await callApi('DELETE', '/api/push/device', config.secret).catch(() => undefined);
  saveConfig(null);
  setState({ status: 'inactive', message: null, scope: null });
}

export async function sendServerTest(): Promise<void> {
  const config = loadConfig();
  if (!config) throw new Error('Najpierw włącz powiadomienia w tle.');
  const { status } = await callApi('POST', '/api/push/test', config.secret);
  if (status === 200) return;
  if (status === 404 || status === 410) {
    saveConfig(null);
    setState({ status: 'inactive', scope: null, message: 'Subskrypcja wygasła — włącz powiadomienia w tle ponownie.' });
    throw new Error('Subskrypcja wygasła — włącz powiadomienia w tle ponownie.');
  }
  throw new Error(status === 429 ? 'Limit testów na dziś został wyczerpany.' : 'Serwer nie wysłał powiadomienia testowego.');
}

// ---------- lista przypomnień dla serwera ----------
function buildJobs(data: AppData, now: number): PushJob[] {
  return collectReminders(data, now - LOOKBACK_MS, now + HORIZON_MS).slice(0, MAX_JOBS).map(reminder => ({
    tag: reminder.id,
    at: reminder.fireAt,
    title: reminder.title,
    body: `${reminderLeadText(reminder.startAt, reminder.fireAt)} · ${reminder.time}${reminder.kind === 'routine' ? ' · rutyna' : ''}`,
    url: reminderOpenUrl(reminder.kind, reminder.sourceId, reminder.occurrenceDate),
    kind: reminder.kind, sourceId: reminder.sourceId, occurrenceDate: reminder.occurrenceDate, startAt: reminder.startAt,
  }));
}

/** Kod konta (lista wspólna dla wszystkich urządzeń konta) albo kod tego urządzenia. */
function scheduleCredentials(): { token: string; scope: 'account' | 'device' } | null {
  const config = loadConfig();
  const account = syncCode();
  if (config) return config.scope === 'account' && account ? { token: account, scope: 'account' } : { token: config.secret, scope: 'device' };
  return account ? { token: account, scope: 'account' } : null;
}

/** Wysyła listę przypomnień, gdy się zmieniła (albo co 6 h). Bez synchronizacji i bez push — nic nie robi. */
export async function uploadPushSchedule(data: AppData, now = Date.now()): Promise<void> {
  const credentials = scheduleCredentials();
  if (!credentials) return;
  const jobs = resolveNotificationSettings(data.notifications).enabled ? buildJobs(data, now) : [];
  const hash = fingerprint(`${credentials.scope}|${credentials.token}|${JSON.stringify(jobs)}`);
  try {
    const memo: unknown = JSON.parse(localStorage.getItem(MEMO_KEY) ?? 'null');
    const ttl = isRecord(memo) && typeof memo.ttl === 'number' ? memo.ttl : REFRESH_MS;
    if (isRecord(memo) && memo.hash === hash && typeof memo.at === 'number' && now - memo.at < ttl) return;
  } catch { /* brak zapisanej listy */ }
  const { status, data: response } = await callApi('PUT', '/api/push/schedule', credentials.token, { jobs });
  if (status === 200) {
    // Konto bez urządzeń z powiadomieniami w tle: sprawdzimy ponownie szybciej (ktoś mógł je właśnie włączyć).
    const ttl = response.devices === 0 ? 30 * 60_000 : REFRESH_MS;
    try { localStorage.setItem(MEMO_KEY, JSON.stringify({ hash, at: now, ttl })); } catch { /* wyślemy ponownie przy kolejnej zmianie */ }
  } else if (status === 404 && credentials.scope === 'device') {
    saveConfig(null);
    setState({ status: 'inactive', scope: null, message: 'Serwer nie zna już tego urządzenia — włącz powiadomienia w tle ponownie.' });
  }
}

// ---------- React ----------
/** Sam stan (np. do opisu w karcie statusu powiadomień). */
export function usePushState(): PushState {
  return useSyncExternalStore(subscribeState, getState);
}

export interface PushApi {
  state: PushState;
  /** Wywołuj synchronicznie z onClick (iOS). */
  enable(): Promise<void>;
  disable(): Promise<void>;
  test(): Promise<void>;
}

/** Utrzymuje rejestrację i wysyła listę przypomnień w tle (z opóźnieniem po zmianach i przy wyjściu z aplikacji). */
export function usePushNotifications(data: AppData, accountCode: string | null): PushApi {
  const current = useSyncExternalStore(subscribeState, getState);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    if (!isPushSupported()) return;
    if (loadConfig() || Notification.permission === 'granted') void primePush().then(refreshPushRegistration);
  }, []);
  useEffect(() => { void refreshPushRegistration(); }, [accountCode]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void uploadPushSchedule(dataRef.current).catch(() => undefined); }, UPLOAD_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [data, accountCode, current.status, current.scope]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshPushRegistration().then(() => uploadPushSchedule(dataRef.current)).catch(() => undefined);
      else void uploadPushSchedule(dataRef.current).catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return { state: current, enable: subscribeFromGesture, disable: disablePush, test: sendServerTest };
}
