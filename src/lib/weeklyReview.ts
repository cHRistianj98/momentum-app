import { mondayOf, parseDate, shiftDate, todayKey } from './date';
import { buildDailyReality, summarizeReality, type ActualOverrides, type DayReality } from './planReality';
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
  const taskItems = items.filter(item => item.kind === 'task');
  const routineItems = items.filter(item => item.kind === 'routine');
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
    const occurrences = routineItems.filter(item => item.sourceId === routine.id);
    return { id: routine.id, title: routine.title, icon: routine.icon, image: routine.image,
      planned: occurrences.length, completed: occurrences.filter(item => item.done).length };
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
      {id: 'calendar', title: 'Zbuduj szkic tygodnia', detail: 'Dodaj po jednym istotnym bloku na kilka najbliższych dni. Nie trzeba od razu wypełniać kalendarza.'},
      {id: 'routine', title: 'Wybierz jedną stałą rutynę', detail: 'Regularność jest łatwiejsza, gdy zaczynasz od małej, powtarzalnej czynności.'},
    ];
  }
  if (coverage === null || coverage < 50 || measuredCount === 0) {
    tips.push({id: 'measure', title: 'Zbieraj trochę więcej pomiarów', detail: 'Uruchom Focus Mode lub wpisz rzeczywisty czas dla kilku bloków. Bez pomiaru nie oceniamy, ile naprawdę trwały.'});
  }
  if (completed / scheduled < 0.65) {
    tips.push({id: 'lighter-plan', title: 'Zostaw więcej przestrzeni', detail: 'W tym tygodniu ukończono mniej niż 65% zaplanowanych aktywności. Zaplanuj mniej bloków albo dodaj bufory między nimi.'});
  }
  const weakRoutine = routines.filter(routine => routine.planned >= 2 && routine.completed < routine.planned).sort((a,b) => (a.completed / a.planned) - (b.completed / b.planned))[0];
  if (weakRoutine) {
    tips.push({id: 'routine-focus', title: `Ułatw sobie „${weakRoutine.title}”`, detail: `Wykonano ${weakRoutine.completed} z ${weakRoutine.planned} wystąpień. Rozważ krótszą wersję albo spokojniejszą godzinę.`});
  }
  const heaviestDay = [...days].sort((a, b) => b.plannedMinutes - a.plannedMinutes)[0];
  if (heaviestDay && heaviestDay.plannedMinutes >= 7 * 60 && days.some(day => day.plannedMinutes <= 2 * 60)) {
    tips.push({id: 'spread', title: 'Rozłóż obciążenie równiej', detail: 'Niektóre dni są znacznie pełniejsze od innych. Rozłożenie zadań może uczynić plan wygodniejszym.'});
  }
  const potential = categories.find(item => item.category === 'potential');
  if (potential && potential.planned === 0) {
    tips.push({id: 'potential', title: 'Zarezerwuj czas na projekt przyszłości', detail: 'Jeśli rozwijasz projekt lub uczysz się pod przyszłe zarobki, dodaj jeden niewielki blok w żółtej kategorii.'});
  }
  if (tips.length < 3 && completed / scheduled >= 0.75) {
    tips.push({id: 'keep', title: 'Zachowaj to, co działa', detail: 'Wysoka realizacja planu to cenna informacja. Powtórz skuteczne bloki i zostaw miejsce na regenerację.'});
  }
  if (tips.length < 3) {
    tips.push({id: 'priorities', title: 'Wybierz trzy ważne sprawy', detail: 'Ustal najważniejsze cele przyszłego tygodnia, a resztę potraktuj elastycznie.'});
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
