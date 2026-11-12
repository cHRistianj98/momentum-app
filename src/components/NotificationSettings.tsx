import { useState } from 'react';
import { BellRing, CloudLightning, Send, Sparkles } from 'lucide-react';
import { NotificationStatusCard } from './NotificationCenter';
import { ReminderPicker } from './ReminderPicker';
import { plural, tr } from '../lib/i18n';
import type { PushApi } from '../lib/push';
import { isTaskSeries } from '../lib/recurrence';
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
const tasksGenitive = (count: number) => `${count} ${plural(count, ['zadania', 'zadań', 'zadań'], ['task', 'tasks'])}`;
const routinesGenitive = (count: number) => `${count} ${plural(count, ['rutyny', 'rutyn', 'rutyn'], ['routine', 'routines'])}`;

/** Powiadomienia z serwera (Web Push): przychodzą także przy zamkniętej aplikacji. */
function PushBackgroundCard({ push }: { push: PushApi }) {
  const [busy, setBusy] = useState<'test' | 'off' | null>(null);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const { status, message } = push.state;
  if (status === 'unsupported') return null;
  const active = status === 'active';
  const description = active
    ? tr('Włączone. Przypomnienia wysyła serwer Momentum — dotrą nawet wtedy, gdy aplikacja jest zamknięta.', 'On. The Momentum server sends your reminders — they’ll arrive even when the app is closed.')
    : status === 'unavailable' ? (message ?? tr('Serwer powiadomień jest niedostępny.', 'The notification server is unavailable.'))
    : tr('Przypomnienia przyjdą nawet wtedy, gdy Momentum jest zamknięte. Wysyła je serwer Momentum.', 'Reminders will arrive even when Momentum is closed. The Momentum server sends them.');
  const run = (kind: 'test' | 'off', action: () => Promise<void>, success: string) => {
    setBusy(kind);
    setNote(null);
    void action()
      .then(() => setNote({ text: success, error: false }))
      .catch((error: unknown) => setNote({ text: error instanceof Error ? error.message : tr('Coś poszło nie tak.', 'Something went wrong.'), error: true }))
      .finally(() => setBusy(null));
  };
  const feedback = note ?? (message && status !== 'unavailable' ? { text: message, error: true } : null);
  return <div className={`notify-push${active ? ' is-active' : ''}`}>
    <div className="notify-push-head">
      <span className="notify-push-icon"><CloudLightning size={18}/></span>
      <div><strong>{tr('Także przy zamkniętej aplikacji', 'Even when the app is closed')}</strong><small>{description}</small></div>
      {!active && status !== 'unavailable' && <button type="button" className="btn btn--primary notify-push-enable" disabled={status === 'working'}
        // Bez opóźnień przed wywołaniem: na iPhonie subskrypcja musi wystartować w tym samym stuknięciu.
        onClick={() => {
          setNote(null);
          void push.enable()
            .then(() => setNote({ text: tr('Gotowe! Wyślij test, a potem zamknij aplikację — przypomnienia przyjdą tak samo.', 'Done! Send a test, then close the app — reminders will arrive the same way.'), error: false }))
            .catch(() => undefined);
        }}>{status === 'working' ? tr('Włączam…', 'Turning on…') : tr('Włącz', 'Turn on')}</button>}
    </div>
    {active && <div className="notify-push-actions">
      <button type="button" className="btn btn--secondary" disabled={busy !== null} onClick={() => run('test', push.test, tr('Wysłano test z serwera — powinien pojawić się za chwilę.', 'Test sent from the server — it should appear in a moment.'))}>
        <Send size={15}/>{busy === 'test' ? tr('Wysyłam…', 'Sending…') : tr('Test z serwera', 'Server test')}
      </button>
      <button type="button" className="btn btn--ghost" disabled={busy !== null} onClick={() => run('off', push.disable, tr('Wyłączono powiadomienia z serwera na tym urządzeniu.', 'Server notifications turned off on this device.'))}>
        {busy === 'off' ? tr('Wyłączam…', 'Turning off…') : tr('Wyłącz', 'Turn off')}
      </button>
    </div>}
    {feedback && <p className={`notify-push-note${feedback.error ? ' is-error' : ''}`} role="status">{feedback.text}</p>}
  </div>;
}

/** Sekcja ustawień: zgoda systemu, przełącznik i domyślne przypomnienia. */
export function NotificationSettingsPanel({ api, push, data, onChange, onApplyDefaults }: Props) {
  const { settings, support } = api;
  const granted = support === 'granted';
  // Zadania cykliczne dostają domyślne przypomnienia zadań, rutyny — domyślne rutyn.
  const missingTasks = data.tasks.filter(task => !task.done && task.date && task.time && !task.reminders?.length).length
    + data.routines.filter(routine => routine.active && isTaskSeries(routine) && !routine.reminders?.length).length;
  const missingRoutines = data.routines.filter(routine => routine.active && !isTaskSeries(routine) && !routine.reminders?.length).length;
  const missingLabel = [missingTasks > 0 ? tasksGenitive(missingTasks) : '', missingRoutines > 0 ? routinesGenitive(missingRoutines) : ''].filter(Boolean).join(tr(' i ', ' and '));
  const pushActive = push.state.status === 'active';
  return <section className="notify-settings" aria-label={tr('Powiadomienia', 'Notifications')}>
    <div className="notify-settings-head">
      <span className="notify-settings-icon"><BellRing size={19}/></span>
      <div><strong>{tr('Powiadomienia i przypomnienia', 'Notifications & reminders')}</strong><small>{tr('Zadania i rutyny mogą przypominać o sobie kilka razy, np. 30 i 5 minut przed startem.', 'Tasks and routines can remind you several times, e.g. 30 and 5 minutes before they start.')}</small></div>
    </div>
    <NotificationStatusCard api={api}/>
    {granted && <label className="notify-switch-row">
      <span><strong>{tr('Powiadomienia systemowe', 'System notifications')}</strong><small>{tr('Na ekranie blokady i w centrum powiadomień.', 'On the lock screen and in the notification center.')}</small></span>
      <input type="checkbox" role="switch" checked={settings.enabled} onChange={event => api.setEnabled(event.target.checked)}/>
      <span className="notify-switch" aria-hidden="true"/>
    </label>}
    {granted && settings.enabled && <PushBackgroundCard push={push}/>}
    <div className="notify-defaults">
      <ReminderPicker label={tr('Domyślnie dla nowych zadań', 'Default for new tasks')} value={settings.taskDefaults} time={null}
        onChange={taskDefaults => onChange({ ...settings, taskDefaults })}/>
      <ReminderPicker label={tr('Domyślnie dla nowych rutyn', 'Default for new routines')} value={settings.routineDefaults} time={null}
        onChange={routineDefaults => onChange({ ...settings, routineDefaults })}/>
    </div>
    <div className="notify-settings-actions">
      {missingLabel && <button type="button" className="btn btn--secondary" onClick={onApplyDefaults}>
        <Sparkles size={15}/> {tr(`Dodaj domyślne do ${missingLabel}`, `Add defaults to ${missingLabel}`)}
      </button>}
      {granted && settings.enabled && <button type="button" className="btn btn--ghost" onClick={() => { void api.sendTest(); }}><Send size={15}/> {tr('Wyślij test', 'Send test')}</button>}
    </div>
    <p className="notify-settings-note">{pushActive
      ? tr('Przypomnienia z najbliższych 7 dni wysyła serwer Momentum (ich treść jest tam przechowywana do wysłania) — dotrą także przy zamkniętej aplikacji. Wszystkie trafiają też do dzwonka w aplikacji.', 'The Momentum server sends reminders for the next 7 days (their content is stored there until sent) — they’ll arrive even when the app is closed. All of them also appear in the in-app bell.')
      : tr('Bez powiadomień w tle przypomnienia wysyłane są, gdy Momentum jest uruchomione (na iPhonie: otwarte z ekranu początkowego). Wszystkie przypomnienia trafiają też do dzwonka w aplikacji.', 'Without background notifications, reminders are sent while Momentum is running (on iPhone: opened from the Home Screen). All reminders also appear in the in-app bell.')}</p>
  </section>;
}
