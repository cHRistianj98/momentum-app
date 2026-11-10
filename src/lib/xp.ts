import type { AppData, CategoryKey, Routine, RoutineLog } from '../types';
import type { FocusRecord } from './focus';
import { dateKey, shiftDate } from './date';
import { isTaskSeries, occursOn } from './recurrence';
import { routineStepsOnDate } from './routineStepSchedule';

/**
 * Doświadczenie (XP) przyznaje aplikacja według stałego klucza — użytkownik go nie ustawia.
 *
 * Zadania i zadania cykliczne: +2 XP za ukończenie oraz za każde 15 minut zaplanowanego czasu
 *   8 XP (przychód) · 5 XP (możliwy przychód) · 3 XP (bez przychodu).
 *   Minuty ponad 2 h liczą się w połowie, a ponad 4 h już wcale — długi blok jest premiowany, ale XP nie da się „nabić”.
 * Focus Mode: połowa tej stawki za każde 15 minut realnego skupienia (4 · 2,5 · 1,5 XP), najwyżej 4 h na sesję.
 *   To premia za faktyczną pracę — należy się także wtedy, gdy zadanie nie jest jeszcze ukończone.
 * Rutyny: czas liczy się jak w zadaniach (+2 XP za ukończenie i stawka za 15 minut wg kategorii), do tego
 *   +1 XP za każdy wykonany krok (najwyżej 10) i premia za regularność: +1 XP za każde poprzednie
 *   wykonanie z rzędu (najwyżej +10).
 *
 * Kalibracja: przy regularnym korzystaniu (4–5 h ukończonych bloków dziennie, 1–2 rutyny, trochę Focus Mode)
 * wychodzi ok. 100–150 XP dziennie. Na tej skali opierają się progi poziomów, rang i odznak (progression.ts).
 * XP jest zawsze przeliczane z historii, więc zmiana klucza obejmuje także wcześniejsze dni.
 */
export const XP_RULES = {
  completion: 2,
  taskPer15: { income: 8, potential: 5, unpaid: 3 } as Readonly<Record<CategoryKey, number>>,
  focusPer15: { income: 4, potential: 2.5, unpaid: 1.5 } as Readonly<Record<CategoryKey, number>>,
  focusSessionCapMinutes: 240,
  routineStep: 1,
  routineStepCap: 10,
  routineStreakCap: 10,
  /** Do tylu minut bloku liczy się w całości… */
  fullRateMinutes: 120,
  /** …a powyżej tej długości już nic nie dodaje. */
  capMinutes: 240,
} as const;

/** Poziom N wymaga łącznie LEVEL_BASE × (N − 1)² XP: szybko na starcie, coraz wolniej później. */
export const LEVEL_BASE = 100;

const categoryOf = (value: unknown): CategoryKey => (value === 'income' || value === 'potential' ? value : 'unpaid');

/** Minuty, które liczą się do XP: w całości do 2 h, w połowie od 2 do 4 h, dalej wcale. */
export function countedMinutes(minutes: number): number {
  const value = Math.max(0, Math.min(XP_RULES.capMinutes, Number.isFinite(minutes) ? minutes : 0));
  return value <= XP_RULES.fullRateMinutes ? value : XP_RULES.fullRateMinutes + (value - XP_RULES.fullRateMinutes) / 2;
}

/** XP za ukończenie zadania albo wystąpienia zadania cyklicznego. */
export function taskXp(duration: number, category: CategoryKey): number {
  return Math.round(XP_RULES.completion + countedMinutes(duration) / 15 * XP_RULES.taskPer15[categoryOf(category)]);
}

/** XP za sesję Focus: realny czas skupienia (bez przerw), najwyżej 4 h. */
export function focusXp(focusSeconds: number, category: CategoryKey): number {
  const minutes = Math.min(XP_RULES.focusSessionCapMinutes, Math.max(0, (Number(focusSeconds) || 0) / 60));
  return Math.round(minutes / 15 * XP_RULES.focusPer15[categoryOf(category)]);
}

/** XP za ukończoną rutynę: jak za zadanie tej długości, plus kroki i premia za regularność. */
export function routineXp(category: CategoryKey, minutes: number, steps: number, streakBefore: number): number {
  return taskXp(minutes, category)
    + Math.min(XP_RULES.routineStepCap, Math.max(0, Math.floor(steps))) * XP_RULES.routineStep
    + Math.min(XP_RULES.routineStreakCap, Math.max(0, Math.floor(streakBefore)));
}

/** Bezpiecznik pętli po dniach (ok. 100 lat) — w praktyce zakres wyznacza pierwsze ukończenie rutyny. */
const MAX_SCAN_DAYS = 40000;

/** Pierwszy dzień (z harmonogramu), w którym rutynę ukończono — wcześniej łańcuch nie może sięgać. */
function firstCompletedDate(routineId: string, logs: AppData['routineLogs']): string | null {
  let first: string | null = null;
  const prefix = `${routineId}:`;
  for (const [key, log] of Object.entries(logs)) {
    if (!log?.completed || !key.startsWith(prefix)) continue;
    const date = key.slice(prefix.length);
    if (!first || date < first) first = date;
  }
  return first;
}

/**
 * Ile poprzednich wystąpień rutyny ukończono z rzędu przed `sourceDate`. Łańcuch przerywa tylko termin
 * z harmonogramu, który minął bez ukończenia; usunięte wystąpienia i dni bez terminu go nie przerywają.
 */
export function routineStreakBefore(routine: Routine, logs: AppData['routineLogs'], sourceDate: string, floor = firstCompletedDate(routine.id, logs)): number {
  if (!floor || floor >= sourceDate) return 0;
  // Harmonogram oceniamy także dla wstrzymanych rutyn — wstrzymanie nie dopisuje wykonań wstecz.
  const template = routine.active ? routine : { ...routine, active: true };
  let streak = 0;
  let cursor = sourceDate;
  for (let guard = 0; guard < MAX_SCAN_DAYS && streak < XP_RULES.routineStreakCap; guard++) {
    cursor = shiftDate(cursor, -1);
    if (cursor < floor) break;
    const log = logs[`${routine.id}:${cursor}`];
    if (log?.completed) { streak++; continue; }
    if (log?.skipped) continue;
    if (log?.dateOverride || occursOn(template, cursor)) break;
  }
  return streak;
}

/** Wykonane kroki rutyny (tylko te, które nadal są w szablonie). */
function checkedSteps(routine: Routine, log: RoutineLog): number {
  const ids = new Set(routine.steps.map(step => step.id));
  return new Set(log.checkedStepIds.filter(id => ids.has(id))).size;
}

/**
 * Premia za regularność dla wszystkich ukończonych wystąpień jednej rutyny — jedno przejście po dniach
 * (te same zasady co `routineStreakBefore`, ale bez cofania się osobno od każdego wystąpienia).
 */
function streaksForRoutine(routine: Routine, logs: AppData['routineLogs'], completedDates: string[]): Map<string, number> {
  const streaks = new Map<string, number>();
  if (!completedDates.length) return streaks;
  const sorted = [...completedDates].sort();
  const template = routine.active ? routine : { ...routine, active: true };
  const last = sorted[sorted.length - 1];
  let run = 0;
  let cursor = sorted[0];
  for (let guard = 0; guard < MAX_SCAN_DAYS && cursor <= last; guard++) {
    const log = logs[`${routine.id}:${cursor}`];
    if (log?.completed) { streaks.set(cursor, run); run++; }
    else if (!log?.skipped && (log?.dateOverride || occursOn(template, cursor))) run = 0;
    cursor = shiftDate(cursor, 1);
  }
  return streaks;
}

/**
 * XP za wystąpienie rutyny lub zadania cyklicznego z dnia `sourceDate` (klucz logu).
 * Dla nieukończonego wystąpienia to podgląd: tyle XP da ukończenie wszystkich kroków.
 */
export function occurrenceXp(routine: Routine, logs: AppData['routineLogs'], sourceDate: string): number {
  const log = logs[`${routine.id}:${sourceDate}`];
  const minutes = log?.durationOverride ?? routine.duration;
  if (isTaskSeries(routine)) return taskXp(minutes, routine.category);
  const steps = log?.completed ? checkedSteps(routine, log) : routineStepsOnDate(routine.steps, log?.dateOverride ?? sourceDate).length;
  return routineXp(routine.category, minutes, steps, routineStreakBefore(routine, logs, sourceDate));
}

export type XpEntry = {
  /** `task:<id>`, `routine:<id>:<dzień z harmonogramu>` (jak w planReality) albo `focus:<id sesji>`. */
  key: string;
  kind: 'task' | 'series' | 'routine' | 'focus';
  /** Dzień, któremu przypisujemy XP; zadania bez daty (Inbox) mają null. */
  date: string | null;
  xp: number;
};

/** Dzień sesji Focus = lokalny dzień jej zakończenia. */
function focusDate(record: FocusRecord): string | null {
  const end = new Date(record.finishedAt);
  return Number.isNaN(end.getTime()) ? null : dateKey(end);
}

/** Wszystkie zdobyte punkty: ukończone zadania, wystąpienia rutyn i zadań cyklicznych oraz sesje Focus. */
export function buildXpLedger(data: AppData, focusHistory: FocusRecord[] = []): XpEntry[] {
  const entries: XpEntry[] = [];
  const taskCategory = new Map<string, CategoryKey>();
  for (const task of data.tasks) {
    taskCategory.set(task.id, task.category);
    if (task.done) entries.push({ key: `task:${task.id}`, kind: 'task', date: task.date, xp: taskXp(task.duration, task.category) });
  }

  // Ukończone wystąpienia pogrupowane po rutynie (logi usuniętych rutyn nie dają XP).
  const routineById = new Map(data.routines.map(routine => [routine.id, routine]));
  const completed = new Map<string, string[]>();
  for (const [key, log] of Object.entries(data.routineLogs)) {
    if (!log?.completed) continue;
    const separator = key.lastIndexOf(':');
    const routineId = key.slice(0, separator);
    if (!routineById.has(routineId)) continue;
    const dates = completed.get(routineId);
    if (dates) dates.push(key.slice(separator + 1));
    else completed.set(routineId, [key.slice(separator + 1)]);
  }
  for (const [routineId, dates] of completed) {
    const routine = routineById.get(routineId)!;
    const series = isTaskSeries(routine);
    const streaks = series ? null : streaksForRoutine(routine, data.routineLogs, dates);
    for (const sourceDate of dates) {
      const log = data.routineLogs[`${routineId}:${sourceDate}`];
      const minutes = log?.durationOverride ?? routine.duration;
      entries.push({
        key: `routine:${routineId}:${sourceDate}`,
        kind: series ? 'series' : 'routine',
        date: log?.dateOverride ?? sourceDate,
        xp: series ? taskXp(minutes, routine.category) : routineXp(routine.category, minutes, checkedSteps(routine, log), streaks?.get(sourceDate) ?? 0),
      });
    }
  }

  for (const record of focusHistory) {
    if (!(record?.focusSeconds > 0)) continue;
    const category = taskCategory.get(record.taskId) ?? record.category ?? 'unpaid';
    const xp = focusXp(record.focusSeconds, category);
    if (xp > 0) entries.push({ key: `focus:${record.id}`, kind: 'focus', date: focusDate(record), xp });
  }
  return entries;
}

export const sumXp = (entries: XpEntry[], include: (entry: XpEntry) => boolean = () => true) =>
  entries.reduce((total, entry) => (include(entry) ? total + entry.xp : total), 0);

/** Łączne XP potrzebne do osiągnięcia poziomu `level` (poziom 1 = 0 XP). */
export function xpForLevel(level: number): number {
  return LEVEL_BASE * (Math.max(1, Math.floor(level)) - 1) ** 2;
}

export type LevelInfo = { level: number; start: number; next: number; into: number; size: number; toNext: number; progress: number };

/** Poziom i postęp do następnego dla łącznej liczby XP. */
export function levelInfo(totalXp: number): LevelInfo {
  const xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  const level = Math.floor(Math.sqrt(xp / LEVEL_BASE)) + 1;
  const start = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, start, next, into: xp - start, size: next - start, toNext: next - xp, progress: (xp - start) / (next - start) };
}
