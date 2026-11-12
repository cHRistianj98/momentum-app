import { dateKey, mondayOf, parseDate, shiftDate } from './date';
import { locale, pick, plural, tr } from './i18n';
import type { RepeatRule, Routine, RoutineLog } from '../types';

/**
 * Silnik powtarzania rutyn i zadań cyklicznych.
 * Zadanie cykliczne to wpis w `routines` z `kind: 'task'` i bez kroków — korzysta z tych samych
 * wirtualnych wystąpień, logów, przypomnień i statystyk co rutyny.
 */

export const MAX_REPEAT_INTERVAL = 52;
/** Kolejność od poniedziałku; wartości to Date.getDay() (0 = niedziela). */
export const WEEKDAYS_FROM_MONDAY = [1, 2, 3, 4, 5, 6, 0];
export const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
/** Skróty dni w opisie harmonogramu: „pn, śr, pt” / “Mon, Wed, Fri”. */
const dayShort = () => pick(['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'so'], ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
/** Biernik: „co piątek”, „co środę” / “every Friday”. */
const dayAccusative = () => pick(['niedzielę', 'poniedziałek', 'wtorek', 'środę', 'czwartek', 'piątek', 'sobotę'],
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);

export function isTaskSeries(routine: Pick<Routine, 'kind'> | null | undefined): boolean {
  return routine?.kind === 'task';
}

export function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && dateKey(parseDate(value)) === value;
}

/** Numer dnia liczony w UTC — odporny na zmianę czasu letniego i zimowego. */
function dayNumber(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** Liczba dni od `from` do `to` (ujemna, gdy `to` jest wcześniej). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

function safeInterval(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.min(MAX_REPEAT_INTERVAL, Math.floor(value)) : 1;
}

const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();
const pad = (value: number) => String(value).padStart(2, '0');

/** Czy szablon przewiduje wystąpienie w danym dniu (bez patrzenia na logi). */
export function occursOn(routine: Routine, date: string): boolean {
  if (!routine.active) return false;
  const weekday = parseDate(date).getDay();
  const rule = routine.repeat;
  if (!rule) return routine.weekdays.includes(weekday);
  if (date < rule.start || (rule.until && date > rule.until)) return false;
  const interval = safeInterval(rule.interval);
  if (rule.every === 'day') return daysBetween(rule.start, date) % interval === 0;
  if (rule.every === 'week') {
    if (!routine.weekdays.includes(weekday)) return false;
    return Math.floor(daysBetween(mondayOf(rule.start), date) / 7) % interval === 0;
  }
  const [startYear, startMonth, startDay] = rule.start.split('-').map(Number);
  const [year, month, day] = date.split('-').map(Number);
  if (((year - startYear) * 12 + month - startMonth) % interval !== 0) return false;
  // 31. dnia w krótszym miesiącu wypada ostatniego dnia miesiąca.
  return day === Math.min(startDay, daysInMonth(year, month));
}

/**
 * Wystąpienie istnieje, gdy wynika z harmonogramu albo zostawiło ślad w historii
 * (ukończenie, odhaczone kroki, ręczne przeniesienie). Usunięte wystąpienie nie istnieje.
 */
export function occurrenceExists(routine: Routine, sourceDate: string, log?: RoutineLog): boolean {
  if (log?.skipped) return false;
  return occursOn(routine, sourceDate) || Boolean(log?.completed) || (log?.checkedStepIds?.length ?? 0) > 0 || Boolean(log?.dateOverride);
}

export interface UpcomingOccurrence {
  /** Dzień z harmonogramu (klucz logu). */
  sourceDate: string;
  /** Rzeczywisty dzień — po ewentualnym przeniesieniu. */
  date: string;
  time: string;
}

/** Najbliższe niewykonane i nieusunięte wystąpienie od dnia `from` (włącznie). */
export function nextOccurrence(routine: Routine, logs: Record<string, RoutineLog>, from: string, horizonDays = 400): UpcomingOccurrence | null {
  for (let offset = 0; offset <= horizonDays; offset++) {
    const sourceDate = shiftDate(from, offset);
    if (routine.repeat?.until && sourceDate > routine.repeat.until) break;
    if (!occursOn(routine, sourceDate)) continue;
    const log = logs[`${routine.id}:${sourceDate}`];
    if (log?.skipped || log?.completed) continue;
    const date = log?.dateOverride ?? sourceDate;
    if (date < from) continue;
    return { sourceDate, date, time: log?.timeOverride ?? routine.time };
  }
  return null;
}

/**
 * Usunięte pojedyncze wystąpienia (od dnia `from` włącznie), które bez usunięcia byłyby w planie —
 * lista do przywrócenia w edycji rutyny lub serii. Rosnąco po dniu z harmonogramu.
 */
export function skippedOccurrences(routine: Routine, logs: Record<string, RoutineLog>, from: string): string[] {
  const prefix = `${routine.id}:`;
  const dates: string[] = [];
  for (const [key, log] of Object.entries(logs)) {
    if (!log?.skipped || !key.startsWith(prefix)) continue;
    const sourceDate = key.slice(prefix.length);
    if (isDateKey(sourceDate) && sourceDate >= from && occursOn(routine, sourceDate)) dates.push(sourceDate);
  }
  return dates.sort();
}

/** Zestaw dni z własną nazwą („codziennie”, „w dni robocze”, „w weekendy”) albo null. */
function namedWeekdays(weekdays: number[]): string | null {
  const days = new Set(weekdays);
  if (days.size === 7) return tr('codziennie', 'every day');
  if (days.size === 5 && [1, 2, 3, 4, 5].every(day => days.has(day))) return tr('w dni robocze', 'on weekdays');
  if (days.size === 2 && days.has(0) && days.has(6)) return tr('w weekendy', 'on weekends');
  return null;
}

function weekdayList(weekdays: number[]): string {
  const days = new Set(weekdays);
  const short = dayShort();
  return namedWeekdays(weekdays) ?? WEEKDAYS_FROM_MONDAY.filter(day => days.has(day)).map(day => short[day]).join(', ');
}

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase(locale()) + text.slice(1);

/** Opis harmonogramu, np. „Co tydzień: pn, śr, pt”, „Codziennie”, „Co miesiąc, 5. dnia” / “Every week: Mon, Wed, Fri”. */
export function describeRepeat(routine: Pick<Routine, 'weekdays' | 'repeat'>): string {
  const rule = routine.repeat;
  if (!rule) return capitalize(weekdayList(routine.weekdays));
  const interval = safeInterval(rule.interval);
  if (rule.every === 'day') return interval === 1 ? tr('Codziennie', 'Every day') : tr(`Co ${interval} dni`, `Every ${interval} days`);
  if (rule.every === 'week') {
    const days = [...new Set(routine.weekdays)];
    if (interval === 1) {
      if (days.length === 1) {
        const day = dayAccusative()[days[0]];
        return tr(`Co ${day}`, `Every ${day}`);
      }
      // Nazwane zestawy dni („Codziennie”, „W dni robocze”, „W weekendy”) zamiast „Co tydzień: …”.
      const named = namedWeekdays(days);
      if (named) return capitalize(named);
      const list = weekdayList(days);
      return tr(`Co tydzień: ${list}`, `Every week: ${list}`);
    }
    const weeks = plural(interval, ['tydzień', 'tygodnie', 'tygodni'], ['week', 'weeks']);
    const list = weekdayList(days);
    return tr(`Co ${interval} ${weeks}: ${list}`, `Every ${interval} ${weeks}: ${list}`);
  }
  const day = Number(rule.start.slice(8, 10));
  const months = plural(interval, ['miesiąc', 'miesiące', 'miesięcy'], ['month', 'months']);
  const every = interval === 1 ? tr('Co miesiąc', 'Every month') : tr(`Co ${interval} ${months}`, `Every ${interval} ${months}`);
  return tr(`${every}, ${day}. dnia${day > 28 ? ' (lub ostatniego)' : ''}`, `${every} on day ${day}${day > 28 ? ' (or the last day)' : ''}`);
}

/** Krótka etykieta dnia względem dziś: „dziś”, „jutro”, „pt, 13 lis” / “today”, “tomorrow”, “Fri 13 Nov”. */
export function shortDayLabel(date: string, today: string): string {
  const diff = daysBetween(today, date);
  if (diff === 0) return tr('dziś', 'today');
  if (diff === 1) return tr('jutro', 'tomorrow');
  if (diff === -1) return tr('wczoraj', 'yesterday');
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(parseDate(date)).replace(/\./g, '');
}

/** Reprezentant `delta` modulo `period` o najmniejszym module. */
function nearest(delta: number, period: number): number {
  const rest = ((delta % period) + period) % period;
  return rest > period / 2 ? rest - period : rest;
}

/**
 * Harmonogram po przeniesieniu całej serii: wystąpienie z dnia `from` ma odtąd wypadać `to`.
 * Dni tygodnia przesuwają się jak dotąd; dla reguły z interwałem przesuwa się też jej początek
 * (najmniejszym możliwym krokiem, tak by `to` należało do serii).
 */
export function shiftSeries(routine: Routine, from: string, to: string): { weekdays: number[]; repeat?: RepeatRule } {
  const weekdayDelta = (parseDate(to).getDay() - parseDate(from).getDay() + 7) % 7;
  const weekdays = [...new Set(routine.weekdays.map(day => (day + weekdayDelta) % 7))].sort((a, b) => a - b);
  const rule = routine.repeat;
  if (!rule) return { weekdays };
  const interval = safeInterval(rule.interval);
  let start: string;
  let guard = 0;
  if (rule.every === 'month') {
    const [fromYear, fromMonth] = from.split('-').map(Number);
    const [toYear, toMonth, toDay] = to.split('-').map(Number);
    const [startYear, startMonth] = rule.start.split('-').map(Number);
    let months = startYear * 12 + startMonth - 1 + nearest((toYear - fromYear) * 12 + toMonth - fromMonth, interval);
    const build = () => {
      const year = Math.floor(months / 12);
      const month = months % 12 + 1;
      return `${year}-${pad(month)}-${pad(Math.min(toDay, daysInMonth(year, month)))}`;
    };
    start = build();
    while (start > to && guard++ < 1000) { months -= interval; start = build(); }
  } else {
    const period = rule.every === 'week' ? 7 * interval : interval;
    start = shiftDate(rule.start, nearest(daysBetween(from, to), period));
    while (start > to && guard++ < 1000) start = shiftDate(start, -period);
  }
  return { weekdays, repeat: { ...rule, start } };
}

/** Reguła z importu lub starszego zapisu: tylko poprawne wartości, inaczej brak reguły. */
export function normalizeRepeatRule(value: unknown): RepeatRule | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (source.every !== 'day' && source.every !== 'week' && source.every !== 'month') return undefined;
  if (!isDateKey(source.start)) return undefined;
  const rule: RepeatRule = { every: source.every, interval: safeInterval(source.interval), start: source.start };
  if (isDateKey(source.until)) rule.until = source.until;
  return rule;
}
