import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppData } from '../types';
import { collectReminders, reminderLeadText, resolveNotificationSettings, type ScheduledReminder } from './reminders';
import {
  getNotificationSupport, loadDeliveredReminders, loadLastReminderCheck, loadNotificationFeed, reminderOpenUrl,
  requestNotificationPermission, saveDeliveredReminders, saveLastReminderCheck, saveNotificationFeed,
  showSystemNotification, updateAppBadge, type NotificationFeedItem, type NotificationSupport,
} from './notifications';

/** Po powrocie do aplikacji pokazujemy w dzwonku przypomnienia z ostatnich 12 godzin. */
const CATCH_UP_MS = 12 * 60 * 60_000;
/** Powiadomienie systemowe wysyłamy tylko wtedy, gdy nie jest spóźnione o więcej niż 3 minuty. */
const ON_TIME_MS = 3 * 60_000;
const MAX_TIMER_MS = 60_000;

function feedItemFor(reminder: ScheduledReminder, now: number): NotificationFeedItem {
  return {
    id: `${reminder.id}@${now}`,
    kind: reminder.kind,
    sourceId: reminder.sourceId,
    occurrenceDate: reminder.occurrenceDate,
    title: reminder.title,
    body: `${reminderLeadText(reminder.startAt, now)} · ${reminder.time}${reminder.kind === 'routine' ? ' · rutyna' : ''}`,
    createdAt: now,
    startAt: reminder.startAt,
    read: false,
  };
}

interface Options {
  data: AppData;
  setData: React.Dispatch<React.SetStateAction<AppData>>;
  /** Przypomnienie pojawiło się, gdy aplikacja jest na pierwszym planie. */
  onInApp: (item: NotificationFeedItem) => void;
  /** Użytkownik dotknął powiadomienia w trybie bez service workera. */
  onOpen: (item: NotificationFeedItem) => void;
}

export function useReminders({ data, setData, onInApp, onOpen }: Options) {
  const settings = useMemo(() => resolveNotificationSettings(data.notifications), [data.notifications]);
  const [feed, setFeed] = useState<NotificationFeedItem[]>(loadNotificationFeed);
  const [support, setSupport] = useState<NotificationSupport>(getNotificationSupport);
  const dataRef = useRef(data);
  const callbacks = useRef({ onInApp, onOpen });
  dataRef.current = data;
  callbacks.current = { onInApp, onOpen };

  const pushFeed = useCallback((items: NotificationFeedItem[]) => {
    if (!items.length) return;
    setFeed(previous => {
      const next = [...items, ...previous].slice(0, 60);
      saveNotificationFeed(next);
      return next;
    });
  }, []);

  // Uprawnienia mogą zmienić się w Ustawieniach systemu — sprawdzamy po powrocie do aplikacji.
  useEffect(() => {
    const refresh = () => setSupport(getNotificationSupport());
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const check = () => {
      const now = Date.now();
      const last = loadLastReminderCheck();
      const from = last === null || last > now ? now - 60_000 : Math.max(last, now - CATCH_UP_MS);
      const due = collectReminders(dataRef.current, from, now);
      const delivered = loadDeliveredReminders();
      const fresh = due.filter(reminder => !delivered[reminder.id]);
      if (fresh.length) {
        const items = fresh.map(reminder => { delivered[reminder.id] = now; return feedItemFor(reminder, now); });
        saveDeliveredReminders(delivered, now);
        pushFeed([...items].reverse());
        const foreground = document.visibilityState === 'visible' && document.hasFocus();
        if (foreground) callbacks.current.onInApp(items[items.length - 1]);
        else if (settings.enabled) {
          fresh.forEach((reminder, index) => {
            if (now - reminder.fireAt > ON_TIME_MS) return;
            const item = items[index];
            void showSystemNotification({
              title: reminder.title,
              body: item.body,
              tag: reminder.id,
              url: reminderOpenUrl(reminder.kind, reminder.sourceId, reminder.occurrenceDate),
            }, () => callbacks.current.onOpen(item));
          });
        }
      }
      saveLastReminderCheck(now);
      const next = collectReminders(dataRef.current, now, now + MAX_TIMER_MS)[0];
      const delay = next ? Math.max(500, next.fireAt - now + 150) : MAX_TIMER_MS;
      timer = window.setTimeout(check, Math.min(delay, MAX_TIMER_MS));
    };
    check();
    const onVisible = () => { if (document.visibilityState === 'visible') { window.clearTimeout(timer); check(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [data, settings.enabled, support, pushFeed]);

  const unread = feed.filter(item => !item.read).length;
  useEffect(() => { updateAppBadge(unread); }, [unread]);

  const setEnabled = useCallback((enabled: boolean) => {
    setData(previous => ({ ...previous, notifications: { ...resolveNotificationSettings(previous.notifications), enabled } }));
  }, [setData]);

  /** Prosi o zgodę (z kliknięcia) i włącza powiadomienia systemowe. */
  const enable = useCallback(async (): Promise<NotificationSupport> => {
    const current = getNotificationSupport();
    if (current === 'unsupported' || current === 'ios-install' || current === 'denied' || current === 'insecure') {
      setSupport(current);
      return current;
    }
    const result = current === 'granted' ? current : await requestNotificationPermission();
    setSupport(result);
    if (result === 'granted') {
      setEnabled(true);
      void showSystemNotification({ title: 'Powiadomienia włączone', body: 'Momentum przypomni Ci o zadaniach i rutynach.', tag: 'momentum-enabled', url: '/' });
    }
    return result;
  }, [setEnabled]);

  const sendTest = useCallback(async () => {
    const now = Date.now();
    const shown = await showSystemNotification({
      title: 'Momentum · test', body: 'Tak wyglądają przypomnienia o zadaniach i rutynach.', tag: `momentum-test-${now}`, url: '/',
    });
    pushFeed([{ id: `system:test@${now}`, kind: 'system', title: 'Powiadomienie testowe',
      body: shown ? 'Wysłano powiadomienie systemowe.' : 'Brak zgody systemu — widoczne tylko w aplikacji.', createdAt: now, read: false }]);
    return shown;
  }, [pushFeed]);

  const markAllRead = useCallback(() => setFeed(previous => {
    const next = previous.map(item => item.read ? item : { ...item, read: true });
    saveNotificationFeed(next);
    return next;
  }), []);

  const markRead = useCallback((id: string) => setFeed(previous => {
    const next = previous.map(item => item.id === id ? { ...item, read: true } : item);
    saveNotificationFeed(next);
    return next;
  }), []);

  const clearFeed = useCallback(() => { setFeed([]); saveNotificationFeed([]); }, []);

  return { settings, support, feed, unread, enable, setEnabled, sendTest, markAllRead, markRead, clearFeed };
}

export type RemindersApi = ReturnType<typeof useReminders>;
