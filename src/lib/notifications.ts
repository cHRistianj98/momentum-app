/**
 * Powiadomienia systemowe Momentum: wykrywanie możliwości urządzenia, zgoda użytkownika,
 * wyświetlanie przez service worker oraz lokalna historia (dzwonek w aplikacji).
 *
 * iPhone/iPad: powiadomienia web działają od iOS 16.4 wyłącznie w aplikacji dodanej
 * do ekranu początkowego. Bez serwera push przypomnienia są wysyłane, gdy Momentum
 * jest uruchomione — system iOS usypia skrypty aplikacji działającej w tle.
 */

export type NotificationSupport = 'granted' | 'denied' | 'default' | 'unsupported' | 'ios-install' | 'insecure';

export interface NotificationFeedItem {
  id: string;
  kind: 'task' | 'routine' | 'system';
  sourceId?: string;
  occurrenceDate?: string;
  title: string;
  body: string;
  createdAt: number;
  startAt?: number;
  read: boolean;
}

/** Klucze poza przestrzenią „momentum.” — to dane techniczne, nie trafiają do kopii JSON. */
const FEED_KEY = 'momentum-runtime:notifications.feed';
const DELIVERED_KEY = 'momentum-runtime:notifications.delivered';
const LAST_CHECK_KEY = 'momentum-runtime:notifications.last-check';
const FEED_LIMIT = 60;

export function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false;
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return legacy || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function getNotificationSupport(): NotificationSupport {
  if (typeof window === 'undefined') return 'unsupported';
  // Powiadomienia i service worker działają tylko w bezpiecznym kontekście (HTTPS lub localhost).
  if (!window.isSecureContext) return 'insecure';
  if (!('Notification' in window)) return isIOSDevice() && !isStandaloneApp() ? 'ios-install' : 'unsupported';
  return Notification.permission;
}

/** Musi być wywołane bezpośrednio z kliknięcia — inaczej iOS i część przeglądarek odrzuci prośbę. */
export async function requestNotificationPermission(): Promise<NotificationSupport> {
  if (typeof window === 'undefined' || !('Notification' in window)) return getNotificationSupport();
  try {
    return await Notification.requestPermission();
  } catch {
    return getNotificationSupport();
  }
}

export interface SystemNotificationPayload {
  title: string;
  body: string;
  tag: string;
  /** Adres otwierany po dotknięciu powiadomienia, np. „/?open=task:ID”. */
  url: string;
}

/**
 * Wyświetla powiadomienie systemowe. Najpierw przez service worker (wymagane na iOS i Androidzie),
 * a w trybie deweloperskim, gdy service worker nie jest zarejestrowany, przez konstruktor Notification.
 */
export async function showSystemNotification(payload: SystemNotificationPayload, onClick?: () => void): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return false;
  const options: NotificationOptions = {
    body: payload.body,
    tag: payload.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    lang: 'pl',
    data: { url: payload.url },
  };
  try {
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (registration?.active) {
      await registration.showNotification(payload.title, options);
      return true;
    }
  } catch { /* przejdź do konstruktora Notification */ }
  try {
    const notification = new Notification(payload.title, options);
    notification.onclick = () => {
      window.focus();
      onClick?.();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

/** Ikona aplikacji na ekranie początkowym (iOS 16.4+, Chrome) pokazuje liczbę nieprzeczytanych. */
export function updateAppBadge(count: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (value?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => undefined);
    else void nav.clearAppBadge?.()?.catch(() => undefined);
  } catch { /* Badging API niedostępne */ }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* pełny lub zablokowany localStorage — historia powiadomień zostaje w pamięci */ }
}

export function loadNotificationFeed(): NotificationFeedItem[] {
  const value = readJson<unknown>(FEED_KEY, []);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is NotificationFeedItem => Boolean(item) && typeof item === 'object'
    && typeof (item as NotificationFeedItem).id === 'string' && typeof (item as NotificationFeedItem).title === 'string'
    && typeof (item as NotificationFeedItem).createdAt === 'number').slice(0, FEED_LIMIT);
}

export function saveNotificationFeed(items: NotificationFeedItem[]): void {
  writeJson(FEED_KEY, items.slice(0, FEED_LIMIT));
}

/** Identyfikatory już wysłanych przypomnień z czasem wysłania; starsze niż 3 dni są usuwane. */
export function loadDeliveredReminders(): Record<string, number> {
  const value = readJson<unknown>(DELIVERED_KEY, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, number> : {};
}

export function saveDeliveredReminders(delivered: Record<string, number>, now: number): void {
  const limit = now - 3 * 24 * 60 * 60_000;
  writeJson(DELIVERED_KEY, Object.fromEntries(Object.entries(delivered).filter(([, time]) => typeof time === 'number' && time >= limit)));
}

export function loadLastReminderCheck(): number | null {
  const value = readJson<unknown>(LAST_CHECK_KEY, null);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function saveLastReminderCheck(time: number): void {
  writeJson(LAST_CHECK_KEY, time);
}

/** Parametr ?open=task:ID lub ?open=routine:ID:YYYY-MM-DD dodawany do adresu powiadomienia. */
export function reminderOpenUrl(kind: 'task' | 'routine', sourceId: string, occurrenceDate?: string): string {
  const target = kind === 'task' ? `task:${sourceId}` : `routine:${sourceId}:${occurrenceDate ?? ''}`;
  return `/?open=${encodeURIComponent(target)}`;
}

export type OpenTarget = { kind: 'task'; id: string } | { kind: 'routine'; id: string; date: string };

export function parseOpenTarget(value: string | null | undefined): OpenTarget | null {
  if (!value) return null;
  const [kind, ...rest] = value.split(':');
  if (kind === 'task' && rest.length >= 1) return { kind: 'task', id: rest.join(':') };
  if (kind === 'routine' && rest.length >= 2) {
    const date = rest[rest.length - 1];
    const id = rest.slice(0, -1).join(':');
    if (id && /^\d{4}-\d{2}-\d{2}$/.test(date)) return { kind: 'routine', id, date };
  }
  return null;
}
