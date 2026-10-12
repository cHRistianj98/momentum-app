import { dateKey, parseDate } from './date';
import type { AppData, CategoryKey } from '../types';
import type { FocusRecord } from './focus';

/** Lokalny pomiar czasu. Nie zmienia terminarza ani punktów XP. */
export const REALITY_STORAGE_KEY = 'momentum.reality.v1';
export type ActualOverrides = Record<string, number>;
export type ActualSource = 'focus' | 'manual' | 'none';

export interface RealityItem {
  key: string;
  date: string;
  kind: 'task' | 'routine';
  sourceId: string;
  title: string;
  category: CategoryKey;
  time: string | null;
  plannedMinutes: number;
  done: boolean;
  actualMinutes: number | null;
  source: ActualSource;
}
export interface DayReality {
  date: string;
  items: RealityItem[];
  plannedMinutes: number;
  actualMinutes: number;
  measuredPlanMinutes: number;
  matchedActualMinutes: number;
  comparedPlanMinutes: number;
  comparedAbsoluteError: number;
  completedCount: number;
  plannedCount: number;
  measuredCount: number;
  extraFocusMinutes: number;
}
export interface PeriodReality {
  days: DayReality[];
  plannedMinutes: number;
  actualMinutes: number;
  comparedPlanMinutes: number;
  comparedAbsoluteError: number;
  measuredPlanMinutes: number;
  plannedCount: number;
  completedCount: number;
  measuredCount: number;
  /** Trafność szacunków TYLKO dla bloków z pomiarem. */
  accuracy: number | null;
  /** Jaka część zaplanowanych minut ma porównywalny pomiar. */
  coverage: number | null;
  completion: number | null;
}

export function parseActualOverrides(raw: string | null): ActualOverrides {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, minutes]) =>
      key.length < 180 && typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0 && minutes <= 1440
    ).map(([key, minutes]) => [key, Math.round(minutes as number)]));
  } catch { return {}; }
}

function positiveMinutes(value: number) { return Number.isFinite(value) ? Math.max(0, value) : 0; }
function focusDate(record: FocusRecord): string | null {
  const end = new Date(record.finishedAt);
  return Number.isNaN(end.getTime()) ? null : dateKey(end);
}

/** Oparcie o daty terminarza; wystąpienie rutyny może być przeniesione na inny dzień. */
export function buildDailyReality(data: AppData, records: FocusRecord[], overrides: ActualOverrides, dates: string[]): DayReality[] {
  const dateSet = new Set(dates);
  const itemsByDay = new Map(dates.map(date => [date, [] as RealityItem[]]));
  const focusByDateAndTask = new Map<string, number>();
  for (const record of records) {
    const date = focusDate(record);
    if (!date || !dateSet.has(date) || !Number.isFinite(record.focusSeconds) || record.focusSeconds < 0) continue;
    const key = `${date}:${record.taskId}`;
    focusByDateAndTask.set(key, (focusByDateAndTask.get(key) ?? 0) + record.focusSeconds / 60);
  }

  for (const task of data.tasks) {
    if (!task.date || !dateSet.has(task.date)) continue;
    const day = itemsByDay.get(task.date)!;
    const key = `task:${task.id}`;
    const manuallyMeasured = Object.prototype.hasOwnProperty.call(overrides, key);
    const focused = focusByDateAndTask.get(`${task.date}:${task.id}`);
    const source: ActualSource = manuallyMeasured ? 'manual' : focused === undefined ? 'none' : 'focus';
    day.push({ key, date: task.date, kind: 'task', sourceId: task.id, title: task.title,
      category: task.category, time: task.time, plannedMinutes: task.time ? positiveMinutes(task.duration) : 0,
      done: task.done, source, actualMinutes: manuallyMeasured ? overrides[key] : focused === undefined ? null : focused });
    if (focused !== undefined) focusByDateAndTask.delete(`${task.date}:${task.id}`);
  }

  const routineById = new Map(data.routines.map(r => [r.id, r]));
  const occurrenceKeys = new Set<string>();
  const addOccurrence = (routineId: string, sourceDate: string) => {
    const routine = routineById.get(routineId);
    if (!routine) return;
    const log = data.routineLogs[`${routineId}:${sourceDate}`];
    const date = log?.dateOverride || sourceDate;
    if (!dateSet.has(date)) return;
    const key = `routine:${routineId}:${sourceDate}`;
    if (occurrenceKeys.has(key)) return;
    occurrenceKeys.add(key);
    const manuallyMeasured = Object.prototype.hasOwnProperty.call(overrides, key);
    itemsByDay.get(date)!.push({ key, date, kind: 'routine', sourceId: routineId,
      title: routine.title, category: routine.category, time: log?.timeOverride ?? routine.time,
      plannedMinutes: positiveMinutes(log?.durationOverride ?? routine.duration), done: Boolean(log?.completed),
      source: manuallyMeasured ? 'manual' : 'none', actualMinutes: manuallyMeasured ? overrides[key] : null });
  };

  for (const sourceDate of dates) {
    const weekday = parseDate(sourceDate).getDay();
    for (const routine of data.routines) {
      const log = data.routineLogs[`${routine.id}:${sourceDate}`];
      if ((routine.active && routine.weekdays.includes(weekday)) || log?.completed || (log?.checkedStepIds?.length ?? 0) > 0 || log?.dateOverride) {
        addOccurrence(routine.id, sourceDate);
      }
    }
  }
  // Przeniesione do okresu wystąpienia mogą mieć źródło spoza zakresu.
  for (const [key, log] of Object.entries(data.routineLogs)) {
    if (!log.dateOverride || !dateSet.has(log.dateOverride)) continue;
    const separator = key.lastIndexOf(':');
    if (separator < 0) continue;
    addOccurrence(key.slice(0, separator), key.slice(separator + 1));
  }

  return dates.map(date => {
    const items = itemsByDay.get(date)!;
    items.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.title.localeCompare(b.title));
    let extraFocusMinutes = 0;
    for (const [key, minutes] of focusByDateAndTask) {
      if (key.startsWith(`${date}:`)) extraFocusMinutes += minutes;
    }
    const compared = items.filter(item => item.actualMinutes !== null && item.plannedMinutes > 0);
    const plannedMinutes = items.reduce((sum, item) => sum + item.plannedMinutes, 0);
    const actualMinutes = items.reduce((sum, item) => sum + (item.actualMinutes ?? 0), 0) + extraFocusMinutes;
    return {
      date, items, plannedMinutes, actualMinutes,
      measuredPlanMinutes: compared.reduce((sum, item) => sum + item.plannedMinutes, 0),
      matchedActualMinutes: compared.reduce((sum, item) => sum + item.actualMinutes!, 0),
      comparedPlanMinutes: compared.reduce((sum, item) => sum + item.plannedMinutes, 0),
      comparedAbsoluteError: compared.reduce((sum, item) => sum + Math.abs(item.plannedMinutes - item.actualMinutes!), 0),
      plannedCount: items.length, completedCount: items.filter(item => item.done).length,
      measuredCount: items.filter(item => item.actualMinutes !== null).length, extraFocusMinutes,
    };
  });
}

export function summarizeReality(days: DayReality[]): PeriodReality {
  const sum = (key: keyof DayReality) => days.reduce((total, day) => total + Number(day[key]), 0);
  const plannedMinutes = sum('plannedMinutes');
  const comparedPlanMinutes = sum('comparedPlanMinutes');
  const plannedCount = sum('plannedCount');
  return {
    days, plannedMinutes,
    actualMinutes: sum('actualMinutes'),
    comparedPlanMinutes,
    comparedAbsoluteError: sum('comparedAbsoluteError'),
    measuredPlanMinutes: sum('measuredPlanMinutes'),
    plannedCount, completedCount: sum('completedCount'), measuredCount: sum('measuredCount'),
    accuracy: comparedPlanMinutes > 0 ? Math.max(0, Math.round((1 - sum('comparedAbsoluteError') / comparedPlanMinutes) * 100)) : null,
    coverage: plannedMinutes > 0 ? Math.min(100, Math.round(sum('measuredPlanMinutes') / plannedMinutes * 100)) : null,
    completion: plannedCount > 0 ? Math.round(sum('completedCount') / plannedCount * 100) : null,
  };
}
