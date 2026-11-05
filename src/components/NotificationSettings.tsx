import { useState } from 'react';
import { BellRing, CloudLightning, Send, Sparkles } from 'lucide-react';
import { NotificationStatusCard } from './NotificationCenter';
import { ReminderPicker } from './ReminderPicker';
import type { PushApi } from '../lib/push';
import type { RemindersApi } from '../lib/useReminders';
import type { AppData, NotificationSettings } from '../types';

interface Props {
  api: RemindersApi;
  push: PushApi;
  data: AppData;
  onChange: (settings: NotificationSettings) => void;
  /** Dodaje domyślne przypomnienia do zaplanowanych pozycji, które jeszcze ich nie mają. */
  onApplyDefaults: () => void;
}

/** Dopełniacz po „do”: 1 zadania / 5 zadań, 1 rutyny / 2 rutyn. */
const tasksGenitive = (count: number) => `${count} ${count === 1 ? 'zadania' : 'zadań'}`;
const routinesGenitive = (count: number) => `${count} ${count === 1 ? 'rutyny' : 'rutyn'}`;

/** Powiadomienia z serwera (Web Push): przychodzą także przy zamkniętej aplikacji. */
function PushBackgroundCard({ push }: { push: PushApi }) {
  const [busy, setBusy] = useState<'test' | 'off' | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const { status, message } = push.state;
  if (status === 'unsupported') return null;
  const active = status === 'active';
  const description = active
    ? 'Włączone. Przypomnienia wysyła serwer Momentum — dotrą nawet wtedy, gdy aplikacja jest zamknięta.'
    : status === 'unavailable' ? (message ?? 'Serwer powiadomień jest niedostępny.')
    : 'Przypomnienia przyjdą nawet wtedy, gdy Momentum jest zamknięte. Wysyła je serwer Momentum.';
  const run = (kind: 'test' | 'off', action: () => Promise<void>, success: string) => {
    setBusy(kind);
    setNote(null);
    void action()
      .then(() => setNote({ text: success, error: false }))
      .catch((error: unknown) => setNote({ text: error instanceof Error ? error.message : 'Coś poszło nie tak.', error: true }))
      .finally(() => setBusy(null));
  };
  const feedback = note ?? (message && status !== 'unavailable' ? { text: message, error: true } : null);
  return <div className={`notify-push${active ? ' is-active' : ''}`}>
    <div className="notify-push-head">
      <span className="notify-push-icon"><CloudLightning size={18}/></span>
      <div><strong>Także przy zamkniętej aplikacji</strong><small>{description}</small></div>
      {!active && status !== 'unavailable' && <button type="button" className="btn btn--primary notify-push-enable" disabled={status === 'working'}
        // Bez opóźnień przed wywołaniem: na iPhonie subskrypcja musi wystartować w tym samym stuknięciu.
        onClick={() => {
          setNote(null);
          void push.enable()
            .then(() => setNote({ text: 'Gotowe! Wyślij test, a potem zamknij aplikację — przypomnienia przyjdą tak samo.', error: false }))
            .catch(() => undefined);
        }}>{status === 'working' ? 'Włączam…' : 'Włącz'}</button>}
    </div>
    {active && <div className="notify-push-actions">
      <button type="button" className="btn btn--secondary" disabled={busy !== null} onClick={() => run('test', push.test, 'Wysłano test z serwera — powinien pojawić się za chwilę.')}>
        <Send size={15}/>{busy === 'test' ? 'Wysyłam…' : 'Test z serwera'}
      </button>
      <button type="button" className="btn btn--ghost" disabled={busy !== null} onClick={() => run('off', push.disable, 'Wyłączono powiadomienia z serwera na tym urządzeniu.')}>
        {busy === 'off' ? 'Wyłączam…' : 'Wyłącz'}
      </button>
    </div>}
    {feedback && <p className={`notify-push-note${feedback.error ? ' is-error' : ''}`} role="status">{feedback.text}</p>}
  </div>;
}

/** Sekcja ustawień: zgoda systemu, przełącznik i domyślne przypomnienia. */
export function NotificationSettingsPanel({ api, push, data, onChange, onApplyDefaults }: Props) {
  const { settings, support } = api;
  const granted = support === 'granted';
  const missingTasks = data.tasks.filter(task => !task.done && task.date && task.time && !task.reminders?.length).length;
  const missingRoutines = data.routines.filter(routine => routine.active && !routine.reminders?.length).length;
  const missingLabel = [missingTasks > 0 ? tasksGenitive(missingTasks) : '', missingRoutines > 0 ? routinesGenitive(missingRoutines) : ''].filter(Boolean).join(' i ');
  const pushActive = push.state.status === 'active';
  return <section className="notify-settings" aria-label="Powiadomienia">
    <div className="notify-settings-head">
      <span className="notify-settings-icon"><BellRing size={19}/></span>
      <div><strong>Powiadomienia i przypomnienia</strong><small>Zadania i rutyny mogą przypominać o sobie kilka razy, np. 30 i 5 minut przed startem.</small></div>
    </div>
    <NotificationStatusCard api={api}/>
    {granted && <label className="notify-switch-row">
      <span><strong>Powiadomienia systemowe</strong><small>Na ekranie blokady i w centrum powiadomień.</small></span>
      <input type="checkbox" role="switch" checked={settings.enabled} onChange={event => api.setEnabled(event.target.checked)}/>
      <span className="notify-switch" aria-hidden="true"/>
    </label>}
    {granted && settings.enabled && <PushBackgroundCard push={push}/>}
    <div className="notify-defaults">
      <ReminderPicker label="Domyślnie dla nowych zadań" value={settings.taskDefaults} time={null}
        onChange={taskDefaults => onChange({ ...settings, taskDefaults })}/>
      <ReminderPicker label="Domyślnie dla nowych rutyn" value={settings.routineDefaults} time={null}
        onChange={routineDefaults => onChange({ ...settings, routineDefaults })}/>
    </div>
    <div className="notify-settings-actions">
      {missingLabel && <button type="button" className="btn btn--secondary" onClick={onApplyDefaults}>
        <Sparkles size={15}/> Dodaj domyślne do {missingLabel}
      </button>}
      {granted && settings.enabled && <button type="button" className="btn btn--ghost" onClick={() => { void api.sendTest(); }}><Send size={15}/> Wyślij test</button>}
    </div>
    <p className="notify-settings-note">{pushActive
      ? 'Przypomnienia z najbliższych 7 dni wysyła serwer Momentum (ich treść jest tam przechowywana do wysłania) — dotrą także przy zamkniętej aplikacji. Wszystkie trafiają też do dzwonka w aplikacji.'
      : 'Bez powiadomień w tle przypomnienia wysyłane są, gdy Momentum jest uruchomione (na iPhonie: otwarte z ekranu początkowego). Wszystkie przypomnienia trafiają też do dzwonka w aplikacji.'}</p>
  </section>;
}
