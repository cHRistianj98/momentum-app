import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, BellRing, CalendarClock, CheckCheck, ChevronRight, Repeat2, Settings2, Share, ShieldAlert, Smartphone, SquarePlus, Trash2, X } from 'lucide-react';
import { TaskIcon } from '../lib/icons';
import { collectReminders, reminderChipLabel } from '../lib/reminders';
import { isIOSDevice, type NotificationFeedItem } from '../lib/notifications';
import type { RemindersApi } from '../lib/useReminders';
import type { AppData } from '../types';

function relativeTime(time: number, now: number): string {
  const minutes = Math.round((now - time) / 60_000);
  if (minutes < 1) return 'przed chwilą';
  if (minutes < 60) return `${minutes} min temu`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} godz. temu`;
  return new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(time));
}

function dayLabel(time: number, now: number): string {
  const day = new Date(time); day.setHours(0, 0, 0, 0);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return 'Dziś';
  if (diff === 1) return 'Jutro';
  return new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' }).format(day);
}

/** Krótki czas do wysłania przypomnienia: „25 min”, „3 godz.”, „2 dni”. */
function compactLead(time: number, now: number): string {
  const minutes = Math.max(1, Math.round((time - now) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} godz.`;
  const days = Math.round(minutes / 1440);
  return days === 1 ? '1 dzień' : `${days} dni`;
}

/** Karta stanu: instrukcja dla iPhone’a, prośba o zgodę lub potwierdzenie działania. */
export function NotificationStatusCard({ api, compact = false }: { api: RemindersApi; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const { support, settings } = api;
  if (support === 'insecure') return <div className="notify-status notify-status--warn">
    <span className="notify-status-icon"><ShieldAlert size={18}/></span>
    <div><strong>Powiadomienia wymagają HTTPS</strong>
      <small>Otwórz Momentum pod adresem https:// (wersja produkcyjna){isIOSDevice() ? ', dodaj do ekranu początkowego' : ''} i włącz powiadomienia. Adres http:// w sieci lokalnej ich nie obsługuje.</small></div>
  </div>;
  if (support === 'ios-install') return <div className="notify-status notify-status--install">
    <span className="notify-status-icon"><Smartphone size={18}/></span>
    <div>
      <strong>Dodaj Momentum do ekranu początkowego</strong>
      <ol>
        <li>Otwórz Momentum w Safari i dotknij <Share size={13} aria-label="Udostępnij"/> <b>Udostępnij</b>.</li>
        <li>Wybierz <SquarePlus size={13} aria-hidden/> <b>Do ekranu początkowego</b>.</li>
        <li>Uruchom aplikację z ikony i włącz tu powiadomienia.</li>
      </ol>
      {!compact && <small>Tego wymaga iOS (16.4 lub nowszy) — powiadomienia web działają tylko w zainstalowanej aplikacji.</small>}
    </div>
  </div>;
  if (support === 'unsupported') return <div className="notify-status notify-status--muted">
    <span className="notify-status-icon"><BellOff size={18}/></span>
    <div><strong>Ta przeglądarka nie obsługuje powiadomień</strong><small>Przypomnienia będą widoczne w dzwonku, gdy Momentum jest otwarte.</small></div>
  </div>;
  if (support === 'denied') return <div className="notify-status notify-status--warn">
    <span className="notify-status-icon"><BellOff size={18}/></span>
    <div><strong>Powiadomienia są zablokowane</strong>
      <small>{isIOSDevice() ? 'Włącz je w Ustawieniach iOS → Powiadomienia → Momentum.' : 'Zezwól na powiadomienia w ustawieniach witryny (ikona kłódki przy adresie).'}</small></div>
  </div>;
  if (support === 'granted' && settings.enabled) return <div className="notify-status notify-status--ok">
    <span className="notify-status-icon"><BellRing size={18}/></span>
    <div><strong>Powiadomienia są włączone</strong>{!compact && <small>Przypomnienia trafią na ekran blokady, gdy Momentum działa. Pełne działanie w tle wymaga serwera push.</small>}</div>
    <button type="button" className="notify-status-action" onClick={() => { void api.sendTest(); }}>Test</button>
  </div>;
  return <div className="notify-status notify-status--cta">
    <span className="notify-status-icon"><Bell size={18}/></span>
    <div><strong>Włącz powiadomienia</strong><small>Przypomnienia o zadaniach i rutynach, np. 5 lub 30 minut przed startem.</small></div>
    <button type="button" className="notify-status-action notify-status-action--primary" disabled={busy}
      onClick={() => { setBusy(true); void api.enable().finally(() => setBusy(false)); }}>{busy ? 'Czekam…' : 'Włącz'}</button>
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
export function ReminderBanner({ item, onOpen, onClose }: { item: NotificationFeedItem; onOpen: () => void; onClose: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 9000);
    return () => window.clearTimeout(timer);
  }, [item.id, onClose]);
  return <div className="reminder-banner" role="alert">
    <span className="reminder-banner-icon"><BellRing size={19}/></span>
    <button type="button" className="reminder-banner-main" onClick={onOpen}>
      <small>{item.kind === 'routine' ? 'PRZYPOMNIENIE · RUTYNA' : 'PRZYPOMNIENIE'}</small>
      <strong>{item.title}</strong>
      <span>{item.body}</span>
    </button>
    <button type="button" className="reminder-banner-open" onClick={onOpen}>Otwórz</button>
    <button type="button" className="reminder-banner-close" aria-label="Zamknij przypomnienie" onClick={onClose}><X size={16}/></button>
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
    <button type="button" className={`icon-btn notification-btn ${api.unread ? 'has-unread' : ''}`} aria-label={api.unread ? `Powiadomienia: ${api.unread} nowe` : 'Powiadomienia'}
      aria-expanded={open} aria-haspopup="dialog" title="Powiadomienia" onClick={() => { if (!open) onOpenPanel?.(); setOpen(value => !value); }}>
      {api.unread ? <BellRing size={19}/> : <Bell size={19}/>}
      {api.unread > 0 && <span className="notification-count">{api.unread > 9 ? '9+' : api.unread}</span>}
    </button>
    {open && <div className="notifications-popover notify-center" role="dialog" aria-label="Powiadomienia">
      <div className="notify-center-head">
        <div><span className="eyebrow eyebrow--indigo">CENTRUM POWIADOMIEŃ</span><strong>Powiadomienia</strong></div>
        <div className="notify-center-head-actions">
          <button type="button" className="icon-btn" aria-label="Ustawienia powiadomień" title="Ustawienia powiadomień" onClick={() => { close(); onOpenSettings(); }}><Settings2 size={17}/></button>
          <button type="button" className="icon-btn" aria-label="Zamknij powiadomienia" onClick={close}><X size={17}/></button>
        </div>
      </div>
      <div className="notify-center-body">
        <NotificationStatusCard api={api} compact/>
        <section className="notify-section">
          <div className="notify-section-title"><span>Nadchodzące</span><small>48 godz.</small></div>
          {upcoming.length ? <div className="notify-upcoming">{upcoming.map(reminder => <button type="button" key={reminder.id} className="notify-upcoming-row"
            onClick={() => { onOpenItem({ kind: reminder.kind, sourceId: reminder.sourceId, occurrenceDate: reminder.occurrenceDate }); close(); }}>
            <span className={`notify-item-icon notify-item-icon--${reminder.kind}`}><TaskIcon name={reminder.icon} size={16}/></span>
            <span className="notify-upcoming-main"><strong>{reminder.title}</strong>
              <small>{dayLabel(reminder.fireAt, now)} {new Date(reminder.fireAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })} · {reminder.offset === 0 ? 'na start' : `${reminderChipLabel(reminder.offset)} przed`} {reminder.time}</small></span>
            <span className="notify-upcoming-lead">za {compactLead(reminder.fireAt, now)}</span>
          </button>)}</div> : <p className="notify-empty-line"><CalendarClock size={15}/> Brak przypomnień w najbliższych 48 godzinach. Dodasz je w formularzu zadania lub rutyny.</p>}
        </section>
        <section className="notify-section">
          <div className="notify-section-title"><span>Ostatnie</span>
            {api.feed.length > 0 && <span className="notify-section-actions">
              {api.unread > 0 && <button type="button" onClick={api.markAllRead}><CheckCheck size={14}/> Przeczytane</button>}
              <button type="button" onClick={api.clearFeed} aria-label="Wyczyść historię"><Trash2 size={14}/></button>
            </span>}
          </div>
          {api.feed.length ? <div className="notify-feed">{api.feed.slice(0, 20).map(item => <button type="button" key={item.id}
            className={`notify-feed-row ${item.read ? '' : 'is-unread'}`} onClick={() => openItem(item)}>
            <span className={`notify-item-icon notify-item-icon--${item.kind}`}>{item.kind === 'routine' ? <Repeat2 size={16}/> : item.kind === 'system' ? <Bell size={16}/> : <CalendarClock size={16}/>}</span>
            <span className="notify-feed-main"><strong>{item.title}</strong><small>{item.body}</small></span>
            <span className="notify-feed-time">{relativeTime(item.createdAt, now)}{item.kind !== 'system' && <ChevronRight size={14}/>}</span>
          </button>)}</div> : <div className="notifications-empty"><Bell size={23}/><strong>Brak powiadomień</strong><span>Tutaj pojawią się przypomnienia o zadaniach i rutynach.</span></div>}
        </section>
      </div>
    </div>}
  </div>;
}
