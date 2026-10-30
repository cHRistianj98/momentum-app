import { dateKey, parseDate, shiftDate } from './date';
import type { AppData, NotificationSettings, Routine } from '../types';

/** Gotowe przypomnienia (minuty przed startem) proponowane w formularzach. */
export const REMINDER_PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440] as const;
/** Najdalsze przypomnienie: tydzień przed rozpoczęciem. */
export const MAX_REMINDER_OFFSET = 7 * 24 * 60;
export const MAX_REMINDERS = 6;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: false,
  taskDefaults: [10],
  routineDefaults: [5],
};

/** Usuwa duplikaty i wartości spoza zakresu; zwraca posortowaną listę albo undefined dla braku danych. */
export function normalizeReminders(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const minutes = value
    .filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    .map(item => Math.round(item))
    .filter(item => item >= 0 && item <= MAX_REMINDER_OFFSET);
  return [...new Set(minutes)].sort((a, b) => a - b).slice(0, MAX_REMINDERS);
}

export function resolveNotificationSettings(value: unknown): NotificationSettings {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<NotificationSettings> : {};
  return {
    enabled: source.enabled === true,
    taskDefaults: normalizeReminders(source.taskDefaults) ?? DEFAULT_NOTIFICATION_SETTINGS.taskDefaults,
    routineDefaults: normalizeReminders(source.routineDefaults) ?? DEFAULT_NOTIFICATION_SETTINGS.routineDefaults,
  };
}

function durationParts(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(days === 1 ? '1 dzień' : `${days} dni`);
  if (hours) parts.push(`${hours} godz.`);
  if (rest) parts.push(`${rest} min`);
  return parts.join(' ');
}

/** Krótka etykieta na chipie, np. „5 min”, „1 godz.”, „Na start”. */
export function reminderChipLabel(offset: number): string {
  return offset === 0 ? 'Na start' : durationParts(offset);
}

/** Pełna etykieta, np. „30 min przed” albo „W chwili rozpoczęcia”. */
export function reminderLongLabel(offset: number): string {
  return offset === 0 ? 'W chwili rozpoczęcia' : `${durationParts(offset)} przed`;
}

/** Zdanie podsumowujące listę przypomnień w formularzu. */
export function reminderSummary(offsets: number[], time: string | null): string {
  if (!offsets.length) return 'Bez przypomnień.';
  const labels = offsets.map(offset => offset === 0 ? 'w chwili startu' : `${durationParts(offset)} wcześniej`);
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} i ${labels[labels.length - 1]}` : labels[0];
  return time ? `Przypomnimy ${list} (start o ${time}).` : `Przypomnimy ${list}.`;
}

/** Treść powiadomienia zależna od tego, ile czasu zostało do startu. */
export function reminderLeadText(startAt: number, now: number): string {
  const minutes = Math.round((startAt - now) / 60_000);
  if (minutes <= 0) return minutes > -2 ? 'Zaczyna się teraz' : 'Już trwa';
  if (minutes < 60) return `Za ${minutes} min`;
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `Za ${hours} godz.${rest ? ` ${rest} min` : ''}`;
  }
  const days = Math.round(minutes / 1440);
  return days === 1 ? 'Jutro' : `Za ${days} dni`;
}

export interface ScheduledReminder {
  /** Unikalny identyfikator przypomnienia: źródło + termin + wyprzedzenie. */
  id: string;
  kind: 'task' | 'routine';
  sourceId: string;
  /** Dzień źródłowy (dla rutyn: dzień cyklu, także po przeniesieniu wystąpienia). */
  occurrenceDate: string;
  /** Rzeczywisty dzień wydarzenia. */
  date: string;
  time: string;
  title: string;
  icon: string;
  duration: number;
  offset: number;
  startAt: number;
  fireAt: number;
}

export function localTimestamp(date: string, time: string): number {
  const day = parseDate(date);
  const [hours, minutes] = time.split(':').map(Number);
  day.setHours(hours || 0, minutes || 0, 0, 0);
  return day.getTime();
}

function routineScheduledOn(routine: Routine, date: string): boolean {
  return routine.active && routine.weekdays.includes(parseDate(date).getDay());
}

/**
 * Wszystkie przypomnienia, których moment wysłania wypada w przedziale (fromMs, toMs].
 * Pomija ukończone zadania i rutyny oraz zadania bez daty lub godziny.
 */
export function collectReminders(data: AppData, fromMs: number, toMs: number): ScheduledReminder[] {
  const result: ScheduledReminder[] = [];
  if (toMs <= fromMs) return result;

  for (const task of data.tasks) {
    if (task.done || !task.date || !task.time || !task.reminders?.length) continue;
    const startAt = localTimestamp(task.date, task.time);
    for (const offset of task.reminders) {
      const fireAt = startAt - offset * 60_000;
      if (fireAt <= fromMs || fireAt > toMs) continue;
      result.push({
        id: `task:${task.id}:${task.date}T${task.time}:${offset}`, kind: 'task', sourceId: task.id,
        occurrenceDate: task.date, date: task.date, time: task.time, title: task.title, icon: task.icon,
        duration: task.duration, offset, startAt, fireAt,
      });
    }
  }

  const routines = data.routines.filter(routine => routine.reminders?.length);
  if (routines.length) {
    const maxOffset = Math.max(...routines.flatMap(routine => routine.reminders ?? [0]));
    const firstDate = shiftDate(dateKey(new Date(fromMs)), -1);
    const lastDate = shiftDate(dateKey(new Date(toMs + maxOffset * 60_000)), 1);
    const seen = new Set<string>();
    const addOccurrence = (routine: Routine, sourceDate: string) => {
      const logKey = `${routine.id}:${sourceDate}`;
      if (seen.has(logKey)) return;
      seen.add(logKey);
      const log = data.routineLogs[logKey];
      if (log?.completed) return;
      if (!routineScheduledOn(routine, sourceDate) && !log?.dateOverride) return;
      const date = log?.dateOverride ?? sourceDate;
      const time = log?.timeOverride ?? routine.time;
      const startAt = localTimestamp(date, time);
      for (const offset of routine.reminders ?? []) {
        const fireAt = startAt - offset * 60_000;
        if (fireAt <= fromMs || fireAt > toMs) continue;
        result.push({
          id: `routine:${routine.id}:${sourceDate}:${date}T${time}:${offset}`, kind: 'routine', sourceId: routine.id,
          occurrenceDate: sourceDate, date, time, title: routine.title, icon: routine.icon,
          duration: log?.durationOverride ?? routine.duration, offset, startAt, fireAt,
        });
      }
    };
    for (let date = firstDate; date <= lastDate; date = shiftDate(date, 1)) {
      for (const routine of routines) addOccurrence(routine, date);
    }
    // Wystąpienia przeniesione do okna z dnia spoza zakresu iteracji.
    for (const [key, log] of Object.entries(data.routineLogs)) {
      if (!log.dateOverride || log.dateOverride < firstDate || log.dateOverride > lastDate) continue;
      const separator = key.lastIndexOf(':');
      const routine = routines.find(item => item.id === key.slice(0, separator));
      if (routine) addOccurrence(routine, key.slice(separator + 1));
    }
  }

  return result.sort((a, b) => a.fireAt - b.fireAt || a.title.localeCompare(b.title, 'pl'));
}
