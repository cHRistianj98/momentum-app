import { BellRing, Send, Sparkles } from 'lucide-react';
import { NotificationStatusCard } from './NotificationCenter';
import { ReminderPicker } from './ReminderPicker';
import type { RemindersApi } from '../lib/useReminders';
import type { AppData, NotificationSettings } from '../types';

interface Props {
  api: RemindersApi;
  data: AppData;
  onChange: (settings: NotificationSettings) => void;
  /** Dodaje domyślne przypomnienia do zaplanowanych pozycji, które jeszcze ich nie mają. */
  onApplyDefaults: () => void;
}

/** Dopełniacz po „do”: 1 zadania / 5 zadań, 1 rutyny / 2 rutyn. */
const tasksGenitive = (count: number) => `${count} ${count === 1 ? 'zadania' : 'zadań'}`;
const routinesGenitive = (count: number) => `${count} ${count === 1 ? 'rutyny' : 'rutyn'}`;

/** Sekcja ustawień: zgoda systemu, przełącznik i domyślne przypomnienia. */
export function NotificationSettingsPanel({ api, data, onChange, onApplyDefaults }: Props) {
  const { settings, support } = api;
  const granted = support === 'granted';
  const missingTasks = data.tasks.filter(task => !task.done && task.date && task.time && !task.reminders?.length).length;
  const missingRoutines = data.routines.filter(routine => routine.active && !routine.reminders?.length).length;
  const missingLabel = [missingTasks > 0 ? tasksGenitive(missingTasks) : '', missingRoutines > 0 ? routinesGenitive(missingRoutines) : ''].filter(Boolean).join(' i ');
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
    <p className="notify-settings-note">Bez serwera push przypomnienia wysyłane są, gdy Momentum jest uruchomione (na iPhonie: otwarte z ekranu początkowego). Wszystkie przypomnienia trafiają też do dzwonka w aplikacji.</p>
  </section>;
}
