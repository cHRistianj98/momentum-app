import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, BellRing, CalendarClock, CheckCheck, ChevronRight, Repeat2, Settings2, Share, ShieldAlert, Smartphone, SquarePlus, Trash2, X } from 'lucide-react';
import { count, locale, tr } from '../lib/i18n';
import { TaskIcon } from '../lib/icons';
import { collectReminders, reminderChipLabel } from '../lib/reminders';
import { isIOSDevice, type NotificationFeedItem } from '../lib/notifications';
import { primePush, usePushState } from '../lib/push';
import type { RemindersApi } from '../lib/useReminders';
import type { AppData } from '../types';

function relativeTime(time: number, now: number): string {
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return tr('przed chwilą', 'just now');
  if (minutes < 60) return tr(`${minutes} min temu`, `${minutes} min ago`);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return tr(`${hours} godz. temu`, `${hours} h ago`);
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(time));
}

function dayLabel(time: number, now: number): string {
  const day = new Date(time); day.setHours(0, 0, 0, 0);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return tr('Dziś', 'Today');
  if (diff === 1) return tr('Jutro', 'Tomorrow');
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(day);
}

/** Krótki czas do wysłania przypomnienia: „25 min”, „3 godz.”, „2 dni”. */
function compactLead(time: number, now: number): string {
  const minutes = Math.max(1, Math.round((time - now) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    return tr(`${hours} godz.`, `${hours} h`);
  }
  const days = Math.round(minutes / 1440);
  return count(days, ['dzień', 'dni', 'dni'], ['day', 'days']);
}

/** Karta stanu: instrukcja dla iPhone’a, prośba o zgodę lub potwierdzenie działania. */
export function NotificationStatusCard({ api, compact = false }: { api: RemindersApi; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const { support, settings } = api;
  const push = usePushState();
  // Klucz serwera i rejestrację SW pobieramy zawczasu: na iPhonie subskrypcja musi ruszyć od razu po stuknięciu „Włącz”.
  useEffect(() => { if (support === 'default' || support === 'granted') void primePush(); }, [support]);
  if (support === 'insecure') return <div className="notify-status notify-status--warn">
    <span className="notify-status-icon"><ShieldAlert size={18}/></span>
    <div><strong>{tr('Powiadomienia wymagają HTTPS', 'Notifications require HTTPS')}</strong>
      <small>{tr('Otwórz Momentum pod adresem https:// (wersja produkcyjna)', 'Open Momentum at its https:// address (production version)')}{isIOSDevice() ? tr(', dodaj do ekranu początkowego', ', add it to your Home Screen') : ''}{tr(' i włącz powiadomienia. Adres http:// w sieci lokalnej ich nie obsługuje.', ' and turn on notifications. They don’t work at an http:// address on your local network.')}</small></div>
  </div>;
  if (support === 'ios-install') return <div className="notify-status notify-status--install">
    <span className="notify-status-icon"><Smartphone size={18}/></span>
    <div>
      <strong>{tr('Dodaj Momentum do ekranu początkowego', 'Add Momentum to your Home Screen')}</strong>
      <ol>
        <li>{tr('Otwórz Momentum w Safari i dotknij', 'Open Momentum in Safari and tap')} <Share size={13} aria-label={tr('Udostępnij', 'Share')}/> <b>{tr('Udostępnij', 'Share')}</b>.</li>
        <li>{tr('Wybierz', 'Choose')} <SquarePlus size={13} aria-hidden/> <b>{tr('Do ekranu początkowego', 'Add to Home Screen')}</b>.</li>
        <li>{tr('Uruchom aplikację z ikony i włącz tu powiadomienia.', 'Launch the app from its icon and turn on notifications here.')}</li>
      </ol>
      {!compact && <small>{tr('Tego wymaga iOS (16.4 lub nowszy) — powiadomienia web działają tylko w zainstalowanej aplikacji.', 'iOS (16.4 or later) requires this — web notifications only work in the installed app.')}</small>}
    </div>
  </div>;
  if (support === 'unsupported') return <div className="notify-status notify-status--muted">
    <span className="notify-status-icon"><BellOff size={18}/></span>
    <div><strong>{tr('Ta przeglądarka nie obsługuje powiadomień', 'This browser doesn’t support notifications')}</strong><small>{tr('Przypomnienia będą widoczne w dzwonku, gdy Momentum jest otwarte.', 'Reminders will show up in the bell while Momentum is open.')}</small></div>
  </div>;
  if (support === 'denied') return <div className="notify-status notify-status--warn">
    <span className="notify-status-icon"><BellOff size={18}/></span>
    <div><strong>{tr('Powiadomienia są zablokowane', 'Notifications are blocked')}</strong>
      <small>{isIOSDevice() ? tr('Włącz je w Ustawieniach iOS → Powiadomienia → Momentum.', 'Turn them on in iOS Settings → Notifications → Momentum.') : tr('Zezwól na powiadomienia w ustawieniach witryny (ikona kłódki przy adresie).', 'Allow notifications in the site settings (the padlock icon next to the address).')}</small></div>
  </div>;
  if (support === 'granted' && settings.enabled) return <div className="notify-status notify-status--ok">
    <span className="notify-status-icon"><BellRing size={18}/></span>
    <div><strong>{tr('Powiadomienia są włączone', 'Notifications are on')}</strong>{!compact && <small>{push.status === 'active'
      ? tr('Przypomnienia przyjdą także wtedy, gdy Momentum jest zamknięte.', 'Reminders will arrive even when Momentum is closed.')
      : tr('Przypomnienia trafią na ekran blokady, gdy Momentum działa. Poniżej włączysz je także przy zamkniętej aplikacji.', 'Reminders will reach your lock screen while Momentum is running. Turn them on below to get them even when the app is closed.')}</small>}</div>
    <button type="button" className="notify-status-action" onClick={() => { void api.sendTest(); }}>Test</button>
  </div>;
  return <div className="notify-status notify-status--cta">
    <span className="notify-status-icon"><Bell size={18}/></span>
    <div><strong>{tr('Włącz powiadomienia', 'Turn on notifications')}</strong><small>{tr('Przypomnienia o zadaniach i rutynach, np. 5 lub 30 minut przed startem.', 'Task and routine reminders, e.g. 5 or 30 minutes before they start.')}</small></div>
    <button type="button" className="notify-status-action notify-status-action--primary" disabled={busy}
      onClick={() => { setBusy(true); void api.enable().finally(() => setBusy(false)); }}>{busy ? tr('Czekam…', 'Waiting…') : tr('Włącz', 'Turn on')}</button>
  </div>;
}

interface CenterProps {
  api: RemindersApi;
  data: AppData;
  onOpenItem: (item: Pick<NotificationFeedItem, 'kind' | 'sourceId' | 'occurrenceDate'>) => void;
  onOpenSettings: () => void;
  /** Wywoływane przy otwarciu panelu (np. aby schować baner przypomnienia). */
  onOpenPanel?: () => void;
}

/** Baner przypomnienia, gdy Momentum jest otwarte — zamiast systemowego powiadomienia. */
export function ReminderBanner({ item, series = false, onOpen, onClose }: { item: NotificationFeedItem; series?: boolean; onOpen: () => void; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 9000);
    return () => window.clearTimeout(timer);
  }, [item.id, onClose]);
  return <div className="reminder-banner" role="alert">
    <span className="reminder-banner-icon"><BellRing size={19}/></span>
    <button type="button" className="reminder-banner-main" onClick={onOpen}>
      <small>{item.kind === 'routine' ? (series ? tr('PRZYPOMNIENIE · ZADANIE CYKLICZNE', 'REMINDER · RECURRING TASK') : tr('PRZYPOMNIENIE · RUTYNA', 'REMINDER · ROUTINE')) : tr('PRZYPOMNIENIE', 'REMINDER')}</small>
      <strong>{item.title}</strong>
      <span>{item.body}</span>
    </button>
    <button type="button" className="reminder-banner-open" onClick={onOpen}>{tr('Otwórz', 'Open')}</button>
    <button type="button" className="reminder-banner-close" aria-label={tr('Zamknij przypomnienie', 'Close reminder')} onClick={onClose}><X size={16}/></button>
  </div>;
}

/** Dzwonek w górnym pasku: nadchodzące przypomnienia i historia powiadomień. */
export function NotificationCenter({ api, data, onOpenItem, onOpenSettings, onOpenPanel }: CenterProps) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    const dismiss = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => { window.clearInterval(timer); document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const upcoming = useMemo(() => open ? collectReminders(data, now, now + 48 * 60 * 60_000).slice(0, 6) : [], [open, data, now]);
  const close = () => setOpen(false);
  const openItem = (item: NotificationFeedItem) => {
    api.markRead(item.id);
    if (item.kind !== 'system') { onOpenItem(item); close(); }
  };

  return <div className="notifications-anchor" ref={rootRef}>
    <button type="button" className={`icon-btn notification-btn ${api.unread ? 'has-unread' : ''}`} aria-label={api.unread ? tr(`Powiadomienia: ${api.unread} nowe`, `Notifications: ${api.unread} new`) : tr('Powiadomienia', 'Notifications')}
      aria-expanded={open} aria-haspopup="dialog" title={tr('Powiadomienia', 'Notifications')} onClick={() => { if (!open) onOpenPanel?.(); setOpen(value => !value); }}>
      {api.unread ? <BellRing size={19}/> : <Bell size={19}/>}
      {api.unread > 0 && <span className="notification-count">{api.unread > 9 ? '9+' : api.unread}</span>}
    </button>
    {open && <div className="notifications-popover notify-center" role="dialog" aria-label={tr('Powiadomienia', 'Notifications')}>
      <div className="notify-center-head">
        <div><span className="eyebrow eyebrow--indigo">{tr('CENTRUM POWIADOMIEŃ', 'NOTIFICATION CENTER')}</span><strong>{tr('Powiadomienia', 'Notifications')}</strong></div>
        <div className="notify-center-head-actions">
          <button type="button" className="icon-btn" aria-label={tr('Ustawienia powiadomień', 'Notification settings')} title={tr('Ustawienia powiadomień', 'Notification settings')} onClick={() => { close(); onOpenSettings(); }}><Settings2 size={17}/></button>
          <button type="button" className="icon-btn" aria-label={tr('Zamknij powiadomienia', 'Close notifications')} onClick={close}><X size={17}/></button>
        </div>
      </div>
      <div className="notify-center-body">
        <NotificationStatusCard api={api} compact/>
        <section className="notify-section">
          <div className="notify-section-title"><span>{tr('Nadchodzące', 'Upcoming')}</span><small>{tr('48 godz.', '48 h')}</small></div>
          {upcoming.length ? <div className="notify-upcoming">{upcoming.map(reminder => <button type="button" key={reminder.id} className="notify-upcoming-row"
            onClick={() => { onOpenItem({ kind: reminder.kind, sourceId: reminder.sourceId, occurrenceDate: reminder.occurrenceDate }); close(); }}>
            <span className={`notify-item-icon notify-item-icon--${reminder.kind}`}><TaskIcon name={reminder.icon} size={16}/></span>
            <span className="notify-upcoming-main"><strong>{reminder.title}</strong>
              <small>{dayLabel(reminder.fireAt, now)} {new Date(reminder.fireAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })} · {reminder.offset === 0 ? tr('na start', 'starts at') : tr(`${reminderChipLabel(reminder.offset)} przed`, `${reminderChipLabel(reminder.offset)} before`)} {reminder.time}</small></span>
            <span className="notify-upcoming-lead">{tr('za', 'in')} {compactLead(reminder.fireAt, now)}</span>
          </button>)}</div> : <p className="notify-empty-line"><CalendarClock size={15}/> {tr('Brak przypomnień w najbliższych 48 godzinach. Dodasz je w formularzu zadania lub rutyny.', 'No reminders in the next 48 hours. You can add them in the task or routine form.')}</p>}
        </section>
        <section className="notify-section">
          <div className="notify-section-title"><span>{tr('Ostatnie', 'Recent')}</span>
            {api.feed.length > 0 && <span className="notify-section-actions">
              {api.unread > 0 && <button type="button" onClick={api.markAllRead}><CheckCheck size={14}/> {tr('Przeczytane', 'Mark all read')}</button>}
              <button type="button" onClick={api.clearFeed} aria-label={tr('Wyczyść historię', 'Clear history')}><Trash2 size={14}/></button>
            </span>}
          </div>
          {api.feed.length ? <div className="notify-feed">{api.feed.slice(0, 20).map(item => <button type="button" key={item.id}
            className={`notify-feed-row ${item.read ? '' : 'is-unread'}`} onClick={() => openItem(item)}>
            <span className={`notify-item-icon notify-item-icon--${item.kind}`}>{item.kind === 'routine' ? <Repeat2 size={16}/> : item.kind === 'system' ? <Bell size={16}/> : <CalendarClock size={16}/>}</span>
            <span className="notify-feed-main"><strong>{item.title}</strong><small>{item.body}</small></span>
            <span className="notify-feed-time">{relativeTime(item.createdAt, now)}{item.kind !== 'system' && <ChevronRight size={14}/>}</span>
          </button>)}</div> : <div className="notifications-empty"><Bell size={23}/><strong>{tr('Brak powiadomień', 'No notifications')}</strong><span>{tr('Tutaj pojawią się przypomnienia o zadaniach i rutynach.', 'Task and routine reminders will appear here.')}</span></div>}
        </section>
      </div>
    </div>}
  </div>;
}
