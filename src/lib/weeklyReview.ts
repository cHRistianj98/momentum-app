import { mondayOf, parseDate, shiftDate, todayKey } from './date';
import { tr } from './i18n';
import { buildDailyReality, summarizeReality, type ActualOverrides, type DayReality } from './planReality';
import { isTaskSeries } from './recurrence';
import type { FocusRecord } from './focus';
import type { AppData, CategoryKey } from '../types';

export type WeekCategorySummary = {
  category: CategoryKey;
  planned: number;
  measured: number;
  measuredCount: number;
  scheduledCount: number;
  completedCount: number;
};
export type RoutineWeeklyResult = {
  id: string;
  title: string;
  icon: string;
  image?: string;
  planned: number;
  completed: number;
  /** Zadanie cykliczne (bez kroków), a nie rutyna. */
  series?: boolean;
};
export type WeekAdvice = { id: string; title: string; detail: string };

export interface WeeklyReport {
  start: string;
  end: string;
  days: DayReality[];
  completed: number;
  scheduled: number;
  completedTasks: number;
  scheduledTasks: number;
  completedRoutines: number;
  scheduledRoutines: number;
  plannedMinutes: number;
  measuredMinutes: number;
  measuredCount: number;
  coverage: number | null;
  completionRate: number | null;
  categories: WeekCategorySummary[];
  routines: RoutineWeeklyResult[];
  bestDay: DayReality | null;
  activeDays: number;
  tips: WeekAdvice[];
}

export function mostRecentReviewMonday(today = todayKey()): string {
  const current = mondayOf(today);
  return parseDate(today).getDay() === 0 ? current : shiftDate(current, -7);
}

export function weekDates(start: string): string[] {
  return Array.from({length: 7}, (_, index) => shiftDate(start, index));
}

/** Wszelkie statystyki odczytujemy z terminarza, logów rutyn i pomiarów Focus/manual. */
export function buildWeeklyReport(data: AppData, history: FocusRecord[], overrides: ActualOverrides, start: string): WeeklyReport {
  const days = buildDailyReality(data, history, overrides, weekDates(start));
  const period = summarizeReality(days);
  const items = days.flatMap(day => day.items);
  // Zadania cykliczne liczą się jako zadania, ale w sekcji systematyczności pokazujemy je obok rutyn.
  const taskItems = items.filter(item => item.kind === 'task' || item.series);
  const routineItems = items.filter(item => item.kind === 'routine' && !item.series);
  const seriesAndRoutineItems = items.filter(item => item.kind === 'routine');
  const categoryKeys: CategoryKey[] = ['unpaid', 'potential', 'income'];
  const categories = categoryKeys.map(category => {
    const matching = items.filter(item => item.category === category);
    return {
      category,
      planned: matching.reduce((sum, item) => sum + item.plannedMinutes, 0),
      measured: matching.reduce((sum, item) => sum + (item.actualMinutes ?? 0), 0),
      measuredCount: matching.filter(item => item.actualMinutes !== null).length,
      scheduledCount: matching.length,
      completedCount: matching.filter(item => item.done).length,
    };
  });
  const routines: RoutineWeeklyResult[] = data.routines.map(routine => {
    const occurrences = seriesAndRoutineItems.filter(item => item.sourceId === routine.id);
    return { id: routine.id, title: routine.title, icon: routine.icon, image: routine.image,
      planned: occurrences.length, completed: occurrences.filter(item => item.done).length,
      ...(isTaskSeries(routine) ? { series: true } : {}) };
  }).filter(item => item.planned > 0 || item.completed > 0)
    .sort((a, b) => b.planned - a.planned || a.title.localeCompare(b.title, 'pl'));
  const eligibleDays = days.filter(day => day.plannedCount > 0 || day.completedCount > 0 || day.actualMinutes > 0);
  const bestDay = [...eligibleDays].sort((a, b) => b.completedCount - a.completedCount || b.actualMinutes - a.actualMinutes || a.date.localeCompare(b.date))[0] ?? null;
  const activeDays = days.filter(day => day.completedCount > 0 || day.actualMinutes > 0).length;
  const completionRate = period.plannedCount > 0 ? Math.round(period.completedCount / period.plannedCount * 100) : null;
  const tips = suggestNextWeek({days, categories, routines, scheduled: period.plannedCount, completed: period.completedCount,
    measuredCount: period.measuredCount, measuredMinutes: period.actualMinutes, coverage: period.coverage});

  return {
    start,
    end: shiftDate(start, 6),
    days,
    completed: period.completedCount,
    scheduled: period.plannedCount,
    completedTasks: taskItems.filter(item => item.done).length,
    scheduledTasks: taskItems.length,
    completedRoutines: routineItems.filter(item => item.done).length,
    scheduledRoutines: routineItems.length,
    plannedMinutes: period.plannedMinutes,
    measuredMinutes: period.actualMinutes,
    measuredCount: period.measuredCount,
    coverage: period.coverage,
    completionRate,
    categories,
    routines,
    bestDay,
    activeDays,
    tips,
  };
}

function suggestNextWeek(context: {
  days: DayReality[];
  categories: WeekCategorySummary[];
  routines: RoutineWeeklyResult[];
  scheduled: number;
  completed: number;
  measuredCount: number;
  measuredMinutes: number;
  coverage: number | null;
}): WeekAdvice[] {
  const tips: WeekAdvice[] = [];
  const {days, categories, routines, scheduled, completed, measuredCount, coverage} = context;
  if (scheduled === 0) {
    return [
      {id: 'calendar', title: tr('Zbuduj szkic tygodnia', 'Sketch out your week'), detail: tr('Dodaj po jednym istotnym bloku na kilka najbliższych dni. Nie trzeba od razu wypełniać kalendarza.', 'Add one meaningful block to each of the next few days. There’s no need to fill the whole calendar at once.')},
      {id: 'routine', title: tr('Wybierz jedną stałą rutynę', 'Pick one regular routine'), detail: tr('Regularność jest łatwiejsza, gdy zaczynasz od małej, powtarzalnej czynności.', 'Consistency is easier when you start with something small and repeatable.')},
    ];
  }
  if (coverage === null || coverage < 50 || measuredCount === 0) {
    tips.push({id: 'measure', title: tr('Zbieraj trochę więcej pomiarów', 'Collect a few more measurements'), detail: tr('Uruchom Focus Mode lub wpisz rzeczywisty czas dla kilku bloków. Bez pomiaru nie oceniamy, ile naprawdę trwały.', 'Start Focus Mode or enter the actual time for a few blocks. Without measurements, we can’t tell how long they really took.')});
  }
  if (completed / scheduled < 0.65) {
    tips.push({id: 'lighter-plan', title: tr('Zostaw więcej przestrzeni', 'Leave more breathing room'), detail: tr('W tym tygodniu ukończono mniej niż 65% zaplanowanych aktywności. Zaplanuj mniej bloków albo dodaj bufory między nimi.', 'Less than 65% of planned activities were completed this week. Plan fewer blocks or add buffers between them.')});
  }
  const weakRoutine = routines.filter(routine => routine.planned >= 2 && routine.completed < routine.planned).sort((a,b) => (a.completed / a.planned) - (b.completed / b.planned))[0];
  if (weakRoutine) {
    tips.push({id: 'routine-focus', title: tr(`Ułatw sobie „${weakRoutine.title}”`, `Make “${weakRoutine.title}” easier`), detail: tr(`Wykonano ${weakRoutine.completed} z ${weakRoutine.planned} wystąpień. Rozważ krótszą wersję albo spokojniejszą godzinę.`, `Completed ${weakRoutine.completed} of ${weakRoutine.planned} occurrences. Consider a shorter version or a calmer time of day.`)});
  }
  const heaviestDay = [...days].sort((a, b) => b.plannedMinutes - a.plannedMinutes)[0];
  if (heaviestDay && heaviestDay.plannedMinutes >= 7 * 60 && days.some(day => day.plannedMinutes <= 2 * 60)) {
    tips.push({id: 'spread', title: tr('Rozłóż obciążenie równiej', 'Spread the load more evenly'), detail: tr('Niektóre dni są znacznie pełniejsze od innych. Rozłożenie zadań może uczynić plan wygodniejszym.', 'Some days are much fuller than others. Spreading tasks out can make your plan more comfortable.')});
  }
  const potential = categories.find(item => item.category === 'potential');
  if (potential && potential.planned === 0) {
    tips.push({id: 'potential', title: tr('Zarezerwuj czas na projekt przyszłości', 'Set aside time for a future project'), detail: tr('Jeśli rozwijasz projekt lub uczysz się pod przyszłe zarobki, dodaj jeden niewielki blok w żółtej kategorii.', 'If you’re building a project or learning for future earnings, add one small block in the yellow category.')});
  }
  if (tips.length < 3 && completed / scheduled >= 0.75) {
    tips.push({id: 'keep', title: tr('Zachowaj to, co działa', 'Keep what works'), detail: tr('Wysoka realizacja planu to cenna informacja. Powtórz skuteczne bloki i zostaw miejsce na regenerację.', 'A high completion rate is valuable information. Repeat the blocks that worked and leave room to recover.')});
  }
  if (tips.length < 3) {
    tips.push({id: 'priorities', title: tr('Wybierz trzy ważne sprawy', 'Pick three important things'), detail: tr('Ustal najważniejsze cele przyszłego tygodnia, a resztę potraktuj elastycznie.', 'Set your top goals for next week and stay flexible about the rest.')});
  }
  return tips.slice(0, 4);
}

export function percentageChange(current: number, previous: number): number | null {
  return previous > 0 ? Math.round((current - previous) / previous * 100) : null;
}

export function compactWeekMinutes(minutes: number): string {
  const value = Math.round(Math.max(0, minutes));
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return `${hours} h${mins ? ` ${mins} min` : ''}`;
}
