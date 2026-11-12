import { buildDailyReality, type ActualOverrides, type RealityItem } from './planReality';
import { orderRoutineSteps } from './routineHierarchy';
import { routineStepsOnDate } from './routineStepSchedule';
import { dateKey, minuteOfDay, parseDate, shiftDate } from './date';
import { locale, tr } from './i18n';
import { isDateKey } from './recurrence';
import type { FocusRecord } from './focus';
import type { AppData, CategoryConfig, CategoryKey } from '../types';

/**
 * Eksport wybranych dni do zwykłego tekstu — np. do wklejenia do asystenta AI z prośbą o ocenę.
 * Pozycje dnia i ich status pochodzą z tego samego źródła co Weekly Review (buildDailyReality).
 */
export type DayExportOptions = {
  /** Pozycje zaplanowane, ale nieukończone, oraz niewykonane kroki. */
  includeOpen: boolean;
  /** Kroki rutyn i podzadania zadań. */
  includeSteps: boolean;
  /** Opisy zadań i rutyn. */
  includeNotes: boolean;
  /** Krótka prośba o ocenę na początku tekstu. */
  includePrompt: boolean;
};

export const DEFAULT_DAY_EXPORT_OPTIONS: DayExportOptions = { includeOpen: true, includeSteps: true, includeNotes: false, includePrompt: true };

export function parseDayExportOptions(raw: string | null): DayExportOptions {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_DAY_EXPORT_OPTIONS };
    const saved = value as Partial<Record<keyof DayExportOptions, unknown>>;
    const pick = (key: keyof DayExportOptions) => typeof saved[key] === 'boolean' ? saved[key] as boolean : DEFAULT_DAY_EXPORT_OPTIONS[key];
    return { includeOpen: pick('includeOpen'), includeSteps: pick('includeSteps'), includeNotes: pick('includeNotes'), includePrompt: pick('includePrompt') };
  } catch { return { ...DEFAULT_DAY_EXPORT_OPTIONS }; }
}

type ColorMark = { emoji: string; name: string };
const CATEGORY_ORDER: CategoryKey[] = ['income', 'potential', 'unpaid'];
/** Domyślne znaczniki — funkcja, żeby nazwy barw były w bieżącym języku. */
const defaultMarks = (): Record<CategoryKey, ColorMark> => ({
  income: { emoji: '🟢', name: tr('zielony', 'green') },
  potential: { emoji: '🟡', name: tr('żółty', 'yellow') },
  unpaid: { emoji: '🔴', name: tr('czerwony', 'red') },
});

/** Nazwa barwy koloru kategorii: domyślne kolory to czerwony, żółty i zielony; własne dostają najbliższą barwę. */
export function colorMark(hex: string): ColorMark | null {
  if (!/^#[\da-f]{6}$/i.test(hex)) return null;
  const value = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(channel => channel / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < 0.18) return { emoji: '⚪', name: tr('szary', 'gray') };
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 18 || hue >= 335) return { emoji: '🔴', name: tr('czerwony', 'red') };
  if (hue < 36) return { emoji: '🟠', name: tr('pomarańczowy', 'orange') };
  if (hue < 70) return { emoji: '🟡', name: tr('żółty', 'yellow') };
  if (hue < 170) return { emoji: '🟢', name: tr('zielony', 'green') };
  if (hue < 255) return { emoji: '🔵', name: tr('niebieski', 'blue') };
  return { emoji: '🟣', name: tr('fioletowy', 'purple') };
}

/** Znaczniki kategorii; gdy własne kolory dają dwie te same barwy, wracamy do domyślnych, żeby się nie myliły. */
function categoryMarks(categories: CategoryConfig): Record<CategoryKey, ColorMark> {
  const marks = { income: colorMark(categories.income.color), potential: colorMark(categories.potential.color), unpaid: colorMark(categories.unpaid.color) };
  const emojis = CATEGORY_ORDER.map(key => marks[key]?.emoji);
  if (emojis.some(emoji => !emoji) || new Set(emojis).size < emojis.length) return defaultMarks();
  return marks as Record<CategoryKey, ColorMark>;
}

export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const rest = total % 60;
  return rest ? `${Math.floor(total / 60)} h ${rest} min` : `${Math.floor(total / 60)} h`;
}

const pad = (value: number) => String(value).padStart(2, '0');
const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase(locale()) + value.slice(1);
/** „06.11.2026”; po angielsku „6 Nov 2026” (jednoznaczne dla czytelnika i asystenta AI). */
const numericDate = (date: string) => {
  const value = parseDate(date);
  return tr(`${pad(value.getDate())}.${pad(value.getMonth() + 1)}.${value.getFullYear()}`,
    new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(value));
};
/** „Piątek 06.11.2026” / “Friday 6 Nov 2026”. */
export function exportDayTitle(date: string): string {
  return `${capitalize(new Intl.DateTimeFormat(locale(), { weekday: 'long' }).format(parseDate(date)))} ${numericDate(date)}`;
}
/** Jedna linia tekstu: bez znaków nowej linii i bardzo długich opisów. */
function oneLine(text: string, max = 280): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}
/** „Płatna praca, ….” → „płatna praca, …” (opis kategorii w nawiasie legendy). */
function legendDescription(text: string): string {
  const value = oneLine(text, 160).replace(/\.$/, '');
  return value.charAt(0).toLocaleLowerCase(locale()) + value.slice(1);
}
function timeRange(start: string | null, minutes: number): string | null {
  if (!start) return null;
  const from = minuteOfDay(start);
  if (!Number.isFinite(from) || minutes <= 0) return start;
  const to = (from + Math.round(minutes)) % (24 * 60);
  return `${start}–${pad(Math.floor(to / 60))}:${pad(to % 60)}`;
}

export type DayExportInput = {
  data: AppData;
  categories: CategoryConfig;
  /** Wybrane dni (YYYY-MM-DD) w dowolnej kolejności. */
  dates: string[];
  options: DayExportOptions;
  focusHistory?: FocusRecord[];
  overrides?: ActualOverrides;
  /** Chwila eksportu: późniejsze dzisiejsze pozycje są „zaplanowane”, a nie „nieukończone”. */
  now?: Date;
};

type Step = { title: string; done: boolean; depth: 0 | 1 };
type Tally = { done: number; count: number; minutes: Record<CategoryKey, number>; measured: number };
const emptyTally = (): Tally => ({ done: 0, count: 0, minutes: { income: 0, potential: 0, unpaid: 0 }, measured: 0 });

export function buildDayExport(input: DayExportInput): string {
  const { data, categories, options } = input;
  const dates = [...new Set(input.dates)].filter(isDateKey).sort();
  if (!dates.length) return '';
  const now = input.now ?? new Date();
  const today = dateKey(now);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const marks = categoryMarks(categories);
  const taskById = new Map(data.tasks.map(task => [task.id, task]));
  const routineById = new Map(data.routines.map(routine => [routine.id, routine]));
  const projectById = new Map(data.projects.map(project => [project.id, project]));
  const days = buildDailyReality(data, input.focusHistory ?? [], input.overrides ?? {}, dates);

  /** Szczegóły pozycji: długość, kroki/podzadania, opis i projekt. */
  const details = (item: RealityItem) => {
    if (item.kind === 'task') {
      const task = taskById.get(item.sourceId);
      return {
        minutes: task?.duration ?? item.plannedMinutes,
        steps: (task?.subtasks ?? []).map((subtask): Step => ({ title: subtask.title, done: subtask.done, depth: 0 })),
        suffix: '',
        note: task?.description ?? '',
        project: task?.projectId ? projectById.get(task.projectId)?.title : undefined,
      };
    }
    const routine = routineById.get(item.sourceId);
    const sourceDate = item.key.slice(`routine:${item.sourceId}:`.length);
    const checked = new Set(data.routineLogs[`${item.sourceId}:${sourceDate}`]?.checkedStepIds ?? []);
    // Kroki jak w oknie rutyny: według dnia, w którym wystąpienie jest w kalendarzu.
    const steps = item.series || !routine ? [] : orderRoutineSteps(routineStepsOnDate(routine.steps, item.date))
      .map((step): Step => ({ title: step.title, done: checked.has(step.id), depth: step.parentId ? 1 : 0 }));
    return { minutes: item.plannedMinutes, steps, suffix: item.series ? tr(' (cykliczne)', ' (recurring)') : tr(' (rutyna)', ' (routine)'), note: routine?.description ?? '', project: undefined };
  };

  const summary = (tally: Tally) => {
    const doneMinutes = CATEGORY_ORDER.reduce((sum, key) => sum + tally.minutes[key], 0);
    const parts = [tr(`ukończono ${tally.done} z ${tally.count}`, `completed ${tally.done} of ${tally.count}`)];
    if (doneMinutes > 0) {
      const byCategory = CATEGORY_ORDER.filter(key => tally.minutes[key] > 0).map(key => `${marks[key].emoji} ${formatMinutes(tally.minutes[key])}`).join(' · ');
      parts.push(tr(`czas ukończonych ${formatMinutes(doneMinutes)} (${byCategory})`, `time of completed items ${formatMinutes(doneMinutes)} (${byCategory})`));
    }
    if (tally.measured > 0) parts.push(tr(`zmierzono ${formatMinutes(tally.measured)}`, `measured ${formatMinutes(tally.measured)}`));
    return parts.join(' · ');
  };

  const lines: string[] = [];
  if (options.includePrompt) {
    lines.push(tr('Poniżej mój dziennik z aplikacji Momentum — plan i wykonanie w wybranych dniach.',
      'Below is my log from the Momentum app — my plan and what I actually did on the selected days.'));
    lines.push(tr('Oceń proszę: co poszło dobrze, co warto poprawić i jak rozkładam czas między kategorie (kolory).',
      'Please review it: what went well, what is worth improving, and how I split my time between the categories (colors).'), '');
  }
  const contiguous = dates.every((date, index) => index === 0 || shiftDate(dates[index - 1], 1) === date);
  lines.push(dates.length === 1
    ? tr(`Momentum — eksport dnia ${numericDate(dates[0])}`, `Momentum — export of ${numericDate(dates[0])}`)
    : tr(`Momentum — eksport ${dates.length} ${contiguous ? 'dni' : 'wybranych dni'}: ${numericDate(dates[0])} – ${numericDate(dates[dates.length - 1])}`,
      `Momentum — export of ${dates.length} ${contiguous ? 'days' : 'selected days'}: ${numericDate(dates[0])} – ${numericDate(dates[dates.length - 1])}`));
  lines.push(tr('Kolory kategorii:', 'Category colors:'));
  for (const key of CATEGORY_ORDER) lines.push(`${marks[key].emoji} ${marks[key].name} = ${categories[key].label} (${legendDescription(categories[key].description)})`);
  if (options.includeSteps) lines.push(options.includeOpen
    ? tr('Kroki i podzadania: ✓ wykonane · ○ niewykonane', 'Steps and subtasks: ✓ done · ○ not done')
    : tr('Kroki i podzadania: ✓ wykonane', 'Steps and subtasks: ✓ done'));

  const total = emptyTally();
  for (const day of days) {
    lines.push('', exportDayTitle(day.date));
    const tally = emptyTally();
    let shown = 0;
    for (const item of day.items) {
      const { minutes, steps, suffix, note, project } = details(item);
      const stepsDone = steps.filter(step => step.done).length;
      tally.count++;
      if (item.done) { tally.done++; tally.minutes[item.category] += minutes; }
      if (item.actualMinutes !== null) tally.measured += item.actualMinutes;
      // „Co faktycznie zrobione” obejmuje też rozpoczęte rutyny i zadania z odhaczonymi podzadaniami.
      if (!options.includeOpen && !item.done && stepsDone === 0) continue;
      shown++;
      const feminine = item.kind === 'routine' && !item.series;
      const later = !item.done && (item.date > today || (item.date === today && item.time !== null && minuteOfDay(item.time) > nowMinutes));
      // Po angielsku bez rodzajów: jedna forma statusu.
      const status = item.done ? tr(feminine ? 'ukończona' : 'ukończone', 'completed')
        : stepsDone > 0 ? tr('w trakcie', 'in progress')
          : later ? tr(feminine ? 'zaplanowana' : 'zaplanowane', 'scheduled')
            : tr(feminine ? 'nieukończona' : 'nieukończone', 'not completed');
      const extras: string[] = [];
      if (feminine && steps.length) extras.push(tr(`kroki ${stepsDone}/${steps.length}`, `steps ${stepsDone}/${steps.length}`));
      if (!item.time && minutes > 0) extras.push(formatMinutes(minutes));
      if (project) extras.push(tr(`projekt: ${oneLine(project, 80)}`, `project: ${oneLine(project, 80)}`));
      if (item.actualMinutes !== null) extras.push(tr(`zmierzono ${formatMinutes(item.actualMinutes)}${item.source === 'focus' ? ' w Focus' : ''}`,
        `measured ${formatMinutes(item.actualMinutes)}${item.source === 'focus' ? ' in Focus' : ''}`));
      const when = timeRange(item.time, minutes) ?? tr('bez godziny', 'no set time');
      lines.push(`${when} ${marks[item.category].emoji} ${oneLine(item.title, 160)}${suffix} — ${status}${extras.length ? ` · ${extras.join(' · ')}` : ''}`);
      if (options.includeSteps && (item.done || stepsDone > 0)) {
        // Lista kroków tylko przy rozpoczętych lub ukończonych pozycjach — przy nietkniętych wystarczy „kroki 0/4”.
        for (const step of steps) {
          if (!step.done && !options.includeOpen) continue;
          lines.push(`${step.depth ? '      ' : '    '}${step.done ? '✓' : '○'} ${oneLine(step.title, 160)}`);
        }
      }
      if (options.includeNotes && note.trim()) lines.push(tr(`    Notatka: ${oneLine(note)}`, `    Note: ${oneLine(note)}`));
    }
    tally.measured += day.extraFocusMinutes;
    if (!day.items.length) lines.push(tr('Brak zaplanowanych zadań i rutyn.', 'No tasks or routines planned.'));
    else {
      if (!shown) lines.push(tr('Nic nie zostało ukończone.', 'Nothing was completed.'));
      lines.push(`${tr('Podsumowanie dnia:', 'Day summary:')} ${summary(tally)}`);
    }
    total.done += tally.done;
    total.count += tally.count;
    total.measured += tally.measured;
    for (const key of CATEGORY_ORDER) total.minutes[key] += tally.minutes[key];
  }
  if (dates.length > 1) lines.push('', `${tr(`Razem (${dates.length} dni):`, `Total (${dates.length} days):`)} ${summary(total)}`);
  return lines.join('\n');
}
