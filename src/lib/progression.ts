import {
  AlarmClock, Award, BadgeCheck, Banknote, BellRing, Blocks, Brain, BrainCircuit, CalendarCheck, CalendarCheck2,
  CalendarClock, CalendarCog, CalendarDays, CalendarHeart, CalendarPlus, CalendarRange, CalendarSync, Castle,
  CheckCheck, CheckCircle2, ClipboardCheck, Clock, Clock3, Coffee, Crown, Diamond, Dumbbell, Flag, Flame,
  FlameKindling, Focus, FolderCheck, FolderKanban, FolderPlus, Gauge, Gem, Glasses, Goal, Headphones, HeartPulse,
  Hourglass, Inbox, Infinity as InfinityIcon, Landmark, Layers, Lightbulb, Link, Link2, ListChecks, ListTodo, Medal,
  Milestone, Moon, MoonStar, Mountain, NotebookPen, Orbit, PiggyBank, RefreshCw, Repeat, Repeat2, Rocket, RotateCw,
  Scale, Shapes, ShieldCheck, Signpost, Sparkles, SquareCheckBig, SquareKanban, Sprout, Star, Sun, SunDim, Sunrise,
  Sunset, Target, Timer, TreeDeciduous, TreePalm, TreePine, TrendingUp, Trophy, Undo2, Wallet, Watch, Waves,
  Workflow, Zap,
} from 'lucide-react';
import type { AppData, CategoryKey, Routine } from '../types';
import type { FocusRecord } from './focus';
import { dateKey, mondayOf, parseDate, shiftDate, todayKey } from './date';
import { daysBetween, isDateKey, isTaskSeries, occursOn } from './recurrence';

/** Rangi, poziomy i osiągnięcia liczone wyłącznie z ukończonych zadań i rutyn. */
export type AchievementGroup = 'tasks' | 'consistency' | 'time' | 'planning' | 'routines' | 'money' | 'projects' | 'focus' | 'xp';

/** Kolejność i nazwy grup w Statystykach. */
export const ACHIEVEMENT_GROUPS: { id: AchievementGroup; label: string }[] = [
  { id: 'tasks', label: 'Zadania' },
  { id: 'consistency', label: 'Regularność' },
  { id: 'time', label: 'Czas działania' },
  { id: 'planning', label: 'Planowanie' },
  { id: 'routines', label: 'Rutyny i serie' },
  { id: 'money', label: 'Przychód i rozwój' },
  { id: 'projects', label: 'Projekty' },
  { id: 'focus', label: 'Focus Mode' },
  { id: 'xp', label: 'Doświadczenie' },
];

export type AchievementView = {
  id: string;
  group: AchievementGroup;
  title: string;
  description: string;
  reward: string;
  progress: number;
  target: number;
  unlocked: boolean;
  icon: typeof Trophy;
  accent: string;
  tint: string;
  art: string;
};

export type RankView = {
  id: string;
  title: string;
  subtitle: string;
  minXp: number;
  accent: string;
  tint: string;
  icon: typeof Trophy;
  art: string;
};

export const RANKS: RankView[] = [
  { id: 'spark', title: 'Iskra Startu', subtitle: 'Zaczynasz świadomie planować swój czas.', minXp: 0, accent: '#7f72ff', tint: '#f0edff', icon: Sparkles, art: '/assets/progression/rank-spark.svg' },
  { id: 'builder', title: 'Budowniczy Nawyków', subtitle: 'Tworzysz solidne fundamenty codziennej regularności.', minXp: 500, accent: '#3aa0ff', tint: '#edf6ff', icon: ShieldCheck, art: '/assets/progression/rank-builder.svg' },
  { id: 'pilot', title: 'Pilot Progresu', subtitle: 'Sterujesz tygodniem z coraz większą pewnością.', minXp: 1200, accent: '#ff8a57', tint: '#fff3ec', icon: Rocket, art: '/assets/progression/rank-pilot.svg' },
  { id: 'master', title: 'Mistrz Momentum', subtitle: 'Systematyczność zaczyna naprawdę procentować.', minXp: 2500, accent: '#26b274', tint: '#ecfaf3', icon: Crown, art: '/assets/progression/rank-master.svg' },
  { id: 'legend', title: 'Legenda Momentum', subtitle: 'Twoje dni działają jak dopracowany system.', minXp: 5000, accent: '#f3b23c', tint: '#fff8e8', icon: Gem, art: '/assets/progression/rank-legend.svg' },
];

export function resolveRank(totalXp: number) {
  return [...RANKS].reverse().find(rank => totalXp >= rank.minXp) ?? RANKS[0];
}

export function resolveNextRank(totalXp: number) {
  return RANKS.find(rank => rank.minXp > totalXp) ?? null;
}

/** Liczby, z których wynikają postępy odznak — liczone raz dla całego katalogu. */
export type AchievementMetrics = {
  totalXp: number;
  /** Seria dni z App (maks. 365). */
  streak: number;
  /** Ukończone zadania + ukończone wystąpienia zadań cyklicznych. */
  completedTasks: number;
  /** Ukończone wykonania rutyn (bez zadań cyklicznych). */
  completedRoutineSessions: number;
  completedCount: number;
  /** Minuty wszystkich ukończonych zadań, rutyn i wystąpień. */
  completedMinutes: number;
  /** Zadania z godziną + zadania cykliczne. */
  scheduledTasks: number;
  activeDays: number;
  incomeMinutes: number;
  potentialMinutes: number;
  unpaidMinutes: number;
  incomeCount: number;
  potentialCount: number;
  usedCategories: number;
  morningCount: number;
  eveningCount: number;
  dawnCount: number;
  nightCount: number;
  quickWins: number;
  marathon: number;
  inboxZero: number;
  withReminders: number;
  listedTasks: number;
  weekendCount: number;
  activeMonths: number;
  comeback: number;
  planAheadDays: number;
  perfectDays: number;
  bestDay: number;
  bestWeek: number;
  balancedDay: number;
  balancedWeek: number;
  activeRoutines: number;
  longestChain: number;
  seriesCreated: number;
  seriesCompleted: number;
  projects: number;
  projectsCompleted: number;
  milestonesDone: number;
  projectTasksDone: number;
  subtasksDone: number;
  focusSessions: number;
  focusMinutes: number;
  deepWork: number;
};

export type AchievementContext = {
  /** Historia Focus Mode (osobny magazyn, nie część AppData). */
  focusHistory?: FocusRecord[];
  /** Dzisiejsza data YYYY-MM-DD; domyślnie bieżący dzień. */
  today?: string;
};

type AchievementDefinition = {
  id: string;
  group: AchievementGroup;
  title: string;
  description: string;
  reward: string;
  target: number;
  metric: keyof AchievementMetrics;
  icon: typeof Trophy;
  accent: string;
  /** Pierwsze 28 odznak ma ręcznie dobrane tło; nowe dostają jasny odcień koloru odznaki. */
  tint?: string;
};

/**
 * Katalog 100 odznak. Pierwsze 28 (z wersji 0.4.2) zachowują identyfikatory i zasady,
 * więc zdobyte wcześniej odznaki pozostają zdobyte.
 */
export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  // Zadania (16)
  { id: 'first-step', group: 'tasks', title: 'Pierwszy krok', description: 'Ukończ pierwsze zadanie albo rutynę.', reward: '+ motywacja', target: 1, metric: 'completedCount', icon: Award, accent: '#7f72ff', tint: '#f2efff' },
  { id: 'tasks-5', group: 'tasks', title: 'Dobry początek', description: 'Ukończ 5 zadań.', reward: 'Małe zwycięstwa', target: 5, metric: 'completedTasks', icon: CheckCircle2, accent: '#7f72ff', tint: '#f2efff' },
  { id: 'tasks-25', group: 'tasks', title: 'Maszyna do działania', description: 'Ukończ 25 zadań.', reward: 'Systematyczność', target: 25, metric: 'completedTasks', icon: ShieldCheck, accent: '#5d8ef7', tint: '#edf3ff' },
  { id: 'tasks-50', group: 'tasks', title: 'Pół setki', description: 'Ukończ 50 zadań.', reward: 'Rozpęd', target: 50, metric: 'completedTasks', icon: ListChecks, accent: '#6c7cf2' },
  { id: 'tasks-100', group: 'tasks', title: 'Setka sukcesów', description: 'Ukończ 100 zadań.', reward: 'Legenda działania', target: 100, metric: 'completedTasks', icon: Trophy, accent: '#d9a535', tint: '#fff8e5' },
  { id: 'tasks-250', group: 'tasks', title: 'Ćwierć tysiąca', description: 'Ukończ 250 zadań.', reward: 'Stały rytm działania', target: 250, metric: 'completedTasks', icon: ClipboardCheck, accent: '#4f6fe0' },
  { id: 'tasks-500', group: 'tasks', title: 'Pięćsetka', description: 'Ukończ 500 zadań.', reward: 'Ikona działania', target: 500, metric: 'completedTasks', icon: Medal, accent: '#3f5bd1' },
  { id: 'completions-50', group: 'tasks', title: 'Pięćdziesiąt razy tak', description: 'Ukończ łącznie 50 zadań lub wykonań rutyn.', reward: 'Dobra passa', target: 50, metric: 'completedCount', icon: CheckCheck, accent: '#8a7cf6' },
  { id: 'completions-150', group: 'tasks', title: 'Nie do zatrzymania', description: 'Ukończ 150 zadań lub wykonań rutyn.', reward: 'Wielkie osiągnięcie', target: 150, metric: 'completedCount', icon: Trophy, accent: '#bb86e7', tint: '#f6efff' },
  { id: 'completions-300', group: 'tasks', title: 'Trzysta kroków', description: 'Ukończ łącznie 300 zadań lub wykonań rutyn.', reward: 'Siła nawyku', target: 300, metric: 'completedCount', icon: BadgeCheck, accent: '#a370ec' },
  { id: 'completions-500', group: 'tasks', title: 'Szczyt możliwości', description: 'Ukończ łącznie 500 zadań lub wykonań rutyn.', reward: 'Widok ze szczytu', target: 500, metric: 'completedCount', icon: Mountain, accent: '#8656d9' },
  { id: 'quick-wins-25', group: 'tasks', title: 'Szybkie zwycięstwa', description: 'Ukończ 25 krótkich zadań (do 15 minut).', reward: 'Lekkość', target: 25, metric: 'quickWins', icon: Timer, accent: '#38a3e8' },
  { id: 'marathon-180', group: 'tasks', title: 'Maraton', description: 'Ukończ zadanie lub rutynę trwającą min. 3 godziny.', reward: 'Wytrzymałość', target: 1, metric: 'marathon', icon: Hourglass, accent: '#e0794c' },
  { id: 'inbox-zero', group: 'tasks', title: 'Pusty Inbox', description: 'Ukończ 10 zadań i opróżnij Inbox (zadania bez daty).', reward: 'Czysta głowa', target: 1, metric: 'inboxZero', icon: Inbox, accent: '#3ab0a2' },
  { id: 'reminders-10', group: 'tasks', title: 'Nic nie umknie', description: 'Ustaw przypomnienia w 10 zadaniach lub rutynach.', reward: 'Spokój ducha', target: 10, metric: 'withReminders', icon: BellRing, accent: '#f08a3e' },
  { id: 'tasks-listed-50', group: 'tasks', title: 'Skarbnica pomysłów', description: 'Zbierz na liście 50 zadań, także ukończonych.', reward: 'Pełna głowa pomysłów', target: 50, metric: 'listedTasks', icon: NotebookPen, accent: '#e45f9b' },

  // Regularność (16)
  { id: 'streak-3', group: 'consistency', title: 'Seria 3 dni', description: 'Utrzymaj ciągłość działania przez 3 dni.', reward: '+ ogień serii', target: 3, metric: 'streak', icon: Flame, accent: '#ff7d73', tint: '#fff0ef' },
  { id: 'streak-7', group: 'consistency', title: 'Tydzień bez przerwy', description: 'Utrzymaj serię przez 7 kolejnych dni.', reward: 'Płomień', target: 7, metric: 'streak', icon: Flame, accent: '#ff816d', tint: '#fff1ed' },
  { id: 'streak-14', group: 'consistency', title: 'Dwa tygodnie w ogniu', description: 'Utrzymaj serię przez 14 kolejnych dni.', reward: 'Żar', target: 14, metric: 'streak', icon: Flame, accent: '#f86f62' },
  { id: 'streak-30', group: 'consistency', title: 'Miesiąc determinacji', description: 'Utrzymaj serię przez 30 kolejnych dni.', reward: 'Nieustępliwość', target: 30, metric: 'streak', icon: Flame, accent: '#e96987', tint: '#fff0f3' },
  { id: 'streak-60', group: 'consistency', title: 'Dwa miesiące serii', description: 'Utrzymaj serię przez 60 kolejnych dni.', reward: 'Niegasnący płomień', target: 60, metric: 'streak', icon: FlameKindling, accent: '#e8586f' },
  { id: 'streak-100', group: 'consistency', title: 'Seria stulecia', description: 'Utrzymaj serię przez 100 kolejnych dni.', reward: 'Legenda wytrwałości', target: 100, metric: 'streak', icon: InfinityIcon, accent: '#d24a78' },
  { id: 'active-7', group: 'consistency', title: 'Tydzień progresu', description: 'Bądź aktywny w 7 różnych dniach.', reward: '+ wytrwałość', target: 7, metric: 'activeDays', icon: Star, accent: '#f0a52f', tint: '#fff8e8' },
  { id: 'active-30', group: 'consistency', title: '30 dni na mapie', description: 'Zrealizuj coś w 30 różnych dniach.', reward: 'Stały rozwój', target: 30, metric: 'activeDays', icon: Star, accent: '#e7ad4c', tint: '#fff7e9' },
  { id: 'active-60', group: 'consistency', title: '60 dni w ruchu', description: 'Zrealizuj coś w 60 różnych dniach.', reward: 'Konsekwencja', target: 60, metric: 'activeDays', icon: CalendarCheck, accent: '#eba23f' },
  { id: 'active-100', group: 'consistency', title: 'Sto dni działania', description: 'Zrealizuj coś w 100 różnych dniach.', reward: 'Trwały nawyk', target: 100, metric: 'activeDays', icon: CalendarCheck2, accent: '#df8f35' },
  { id: 'active-365', group: 'consistency', title: 'Rok działania', description: 'Zrealizuj coś w 365 różnych dniach.', reward: 'Rok progresu', target: 365, metric: 'activeDays', icon: CalendarHeart, accent: '#cf7a2e' },
  { id: 'weekend-10', group: 'consistency', title: 'Weekendowy rytm', description: 'Ukończ 10 zadań lub rutyn w weekendy.', reward: 'Weekend z głową', target: 10, metric: 'weekendCount', icon: Coffee, accent: '#f2985a' },
  { id: 'weekend-50', group: 'consistency', title: 'Aktywne weekendy', description: 'Ukończ 50 zadań lub rutyn w weekendy.', reward: 'Wolny czas, dobry czas', target: 50, metric: 'weekendCount', icon: TreePalm, accent: '#e57f45' },
  { id: 'months-3', group: 'consistency', title: 'Kwartał z Momentum', description: 'Ukończ coś w 3 różnych miesiącach.', reward: 'Długi oddech', target: 3, metric: 'activeMonths', icon: CalendarRange, accent: '#f2b14b' },
  { id: 'months-6', group: 'consistency', title: 'Pół roku progresu', description: 'Ukończ coś w 6 różnych miesiącach.', reward: 'Pory roku', target: 6, metric: 'activeMonths', icon: TreeDeciduous, accent: '#d99a3a' },
  { id: 'comeback', group: 'consistency', title: 'Wielki powrót', description: 'Wróć do działania po co najmniej tygodniu przerwy.', reward: 'Nowy start', target: 1, metric: 'comeback', icon: Undo2, accent: '#f7a26a' },

  // Czas działania (12)
  { id: 'focus-180', group: 'time', title: '3 godziny skupienia', description: 'Ukończ łącznie co najmniej 180 minut zaplanowanych bloków.', reward: '+ fokus', target: 180, metric: 'completedMinutes', icon: Target, accent: '#4e97ff', tint: '#edf4ff' },
  { id: 'focus-600', group: 'time', title: '10 godzin w działaniu', description: 'Ukończ łącznie 10 godzin zadań i rutyn.', reward: 'Skupienie', target: 600, metric: 'completedMinutes', icon: Clock, accent: '#4c8ef5' },
  { id: 'focus-1200', group: 'time', title: '20 godzin skupienia', description: 'Ukończ 20 godzin zaplanowanego działania.', reward: 'Koncentracja', target: 1200, metric: 'completedMinutes', icon: Focus, accent: '#629eeb', tint: '#eef6ff' },
  { id: 'focus-3000', group: 'time', title: '50 godzin w działaniu', description: 'Ukończ łącznie 50 godzin zadań i rutyn.', reward: 'Głęboka praca', target: 3000, metric: 'completedMinutes', icon: AlarmClock, accent: '#3d78e0' },
  { id: 'focus-6000', group: 'time', title: '100 godzin progresu', description: 'Ukończ 100 godzin działania.', reward: 'Długofalowy progres', target: 6000, metric: 'completedMinutes', icon: Clock3, accent: '#467bd9', tint: '#eef3ff' },
  { id: 'focus-12000', group: 'time', title: '200 godzin w działaniu', description: 'Ukończ łącznie 200 godzin zadań i rutyn.', reward: 'Mistrzostwo czasu', target: 12000, metric: 'completedMinutes', icon: Watch, accent: '#2f62c7' },
  { id: 'morning-5', group: 'time', title: 'Ranny ptaszek', description: 'Ukończ 5 zadań zaplanowanych przed 9:00.', reward: 'Dobry poranek', target: 5, metric: 'morningCount', icon: Sun, accent: '#e7a23d', tint: '#fff5e8' },
  { id: 'morning-25', group: 'time', title: 'Poranny rytm', description: 'Ukończ 25 zadań zaplanowanych przed 9:00.', reward: 'Złota godzina', target: 25, metric: 'morningCount', icon: Sunrise, accent: '#e9973a' },
  { id: 'dawn-5', group: 'time', title: 'Przed świtem', description: 'Ukończ 5 zadań zaplanowanych przed 7:00.', reward: 'Pierwsze światło', target: 5, metric: 'dawnCount', icon: SunDim, accent: '#f0a845' },
  { id: 'evening-5', group: 'time', title: 'Nocny strateg', description: 'Ukończ 5 zadań zaplanowanych po 20:00.', reward: 'Wieczorny fokus', target: 5, metric: 'eveningCount', icon: Moon, accent: '#7783c8', tint: '#eef0ff' },
  { id: 'evening-25', group: 'time', title: 'Wieczorny rytm', description: 'Ukończ 25 zadań zaplanowanych od 20:00.', reward: 'Spokojny wieczór', target: 25, metric: 'eveningCount', icon: Sunset, accent: '#6f6fc4' },
  { id: 'night-5', group: 'time', title: 'Nocna zmiana', description: 'Ukończ 5 zadań zaplanowanych od 22:00.', reward: 'Cisza nocy', target: 5, metric: 'nightCount', icon: MoonStar, accent: '#5d68b8' },

  // Planowanie (10)
  { id: 'planner-10', group: 'planning', title: 'Planista', description: 'Nadaj godzinę przynajmniej 10 zadaniom.', reward: '+ kontrola planu', target: 10, metric: 'scheduledTasks', icon: CalendarDays, accent: '#a564ff', tint: '#f5efff' },
  { id: 'planner-50', group: 'planning', title: 'Architekt czasu', description: 'Zaplanuj godzinę dla 50 zadań.', reward: 'Świetne planowanie', target: 50, metric: 'scheduledTasks', icon: CalendarDays, accent: '#ae7ff3', tint: '#f6efff' },
  { id: 'planner-100', group: 'planning', title: 'Setka w kalendarzu', description: 'Nadaj godzinę 100 zadaniom.', reward: 'Plan pod kontrolą', target: 100, metric: 'scheduledTasks', icon: CalendarClock, accent: '#9a6cf0' },
  { id: 'planner-250', group: 'planning', title: 'Kalendarz pod kontrolą', description: 'Nadaj godzinę 250 zadaniom.', reward: 'Mistrzowskie planowanie', target: 250, metric: 'scheduledTasks', icon: CalendarCog, accent: '#8456dc' },
  { id: 'plan-ahead-7', group: 'planning', title: 'Tydzień do przodu', description: 'Zaplanuj zadania na każdy z 7 najbliższych dni.', reward: 'Spokojna głowa', target: 7, metric: 'planAheadDays', icon: CalendarPlus, accent: '#b07cf6' },
  { id: 'perfect-day-1', group: 'planning', title: 'Perfekcyjny dzień', description: 'Ukończ wszystkie zadania dnia (co najmniej 3).', reward: 'Czysta lista', target: 1, metric: 'perfectDays', icon: SquareCheckBig, accent: '#7c6af0' },
  { id: 'perfect-days-10', group: 'planning', title: 'Dziesięć czystych list', description: 'Zalicz 10 dni z kompletem ukończonych zadań.', reward: 'Precyzja', target: 10, metric: 'perfectDays', icon: Goal, accent: '#6a55dd' },
  { id: 'day-5', group: 'planning', title: 'Produktywny dzień', description: 'Ukończ 5 zadań lub rutyn jednego dnia.', reward: 'Pełne obroty', target: 5, metric: 'bestDay', icon: TrendingUp, accent: '#a985f5' },
  { id: 'day-10', group: 'planning', title: 'Dzień rekordów', description: 'Ukończ 10 zadań lub rutyn jednego dnia.', reward: 'Rekordowe tempo', target: 10, metric: 'bestDay', icon: Flag, accent: '#946df0' },
  { id: 'week-25', group: 'planning', title: 'Tydzień pełen działania', description: 'Ukończ 25 zadań lub rutyn w jednym tygodniu.', reward: 'Tygodniowy szczyt', target: 25, metric: 'bestWeek', icon: Layers, accent: '#8a64e6' },

  // Rutyny i serie (13)
  { id: 'routines-1', group: 'routines', title: 'Pierwszy rytuał', description: 'Ukończ pierwszą całą rutynę.', reward: 'Moc nawyków', target: 1, metric: 'completedRoutineSessions', icon: Sparkles, accent: '#bd76f5', tint: '#f9edff' },
  { id: 'routines-10', group: 'routines', title: 'Żelazny nawyk', description: 'Zakończ 10 rutyn.', reward: 'Dyscyplina', target: 10, metric: 'completedRoutineSessions', icon: ShieldCheck, accent: '#45a4c8', tint: '#ebfaff' },
  { id: 'routines-25', group: 'routines', title: 'Rytm codzienności', description: 'Zakończ 25 rutyn.', reward: 'Stabilność', target: 25, metric: 'completedRoutineSessions', icon: Repeat, accent: '#a86ef0' },
  { id: 'routines-50', group: 'routines', title: 'Mistrz rutyn', description: 'Zakończ 50 rutyn.', reward: 'Wewnętrzna siła', target: 50, metric: 'completedRoutineSessions', icon: Crown, accent: '#4bb992', tint: '#eafaf4' },
  { id: 'routines-100', group: 'routines', title: 'Sto rytuałów', description: 'Zakończ 100 rutyn.', reward: 'Automatyzm', target: 100, metric: 'completedRoutineSessions', icon: Repeat2, accent: '#3c94b8' },
  { id: 'routines-250', group: 'routines', title: 'Twierdza nawyków', description: 'Zakończ 250 rutyn.', reward: 'Niewzruszoność', target: 250, metric: 'completedRoutineSessions', icon: Castle, accent: '#3a9e7f' },
  { id: 'routine-builder-3', group: 'routines', title: 'Trzy filary', description: 'Miej jednocześnie 3 aktywne rutyny.', reward: 'Solidne fundamenty', target: 3, metric: 'activeRoutines', icon: Blocks, accent: '#c47ae8' },
  { id: 'routine-chain-7', group: 'routines', title: 'Łańcuch 7', description: 'Wykonaj rutynę lub zadanie cykliczne 7 razy z rzędu.', reward: 'Nie przerywaj łańcucha', target: 7, metric: 'longestChain', icon: Link, accent: '#5aa9d6' },
  { id: 'routine-chain-30', group: 'routines', title: 'Łańcuch 30', description: 'Wykonaj rutynę lub zadanie cykliczne 30 razy z rzędu.', reward: 'Żelazna konsekwencja', target: 30, metric: 'longestChain', icon: Link2, accent: '#3f8fc0' },
  { id: 'series-1', group: 'routines', title: 'Na powtórce', description: 'Utwórz pierwsze zadanie cykliczne.', reward: 'Automatyczny plan', target: 1, metric: 'seriesCreated', icon: RefreshCw, accent: '#5f9cf0' },
  { id: 'series-10', group: 'routines', title: 'Dziesięć powtórek', description: 'Ukończ 10 wystąpień zadań cyklicznych.', reward: 'Rytm', target: 10, metric: 'seriesCompleted', icon: RotateCw, accent: '#4c8be3' },
  { id: 'series-50', group: 'routines', title: 'Pięćdziesiąt powtórek', description: 'Ukończ 50 wystąpień zadań cyklicznych.', reward: 'Maszyna nawyków', target: 50, metric: 'seriesCompleted', icon: Workflow, accent: '#3b78d4' },
  { id: 'series-100', group: 'routines', title: 'Setka powtórek', description: 'Ukończ 100 wystąpień zadań cyklicznych.', reward: 'Perpetuum mobile', target: 100, metric: 'seriesCompleted', icon: CalendarSync, accent: '#2f66c2' },

  // Przychód i rozwój (15)
  { id: 'income-120', group: 'money', title: 'Monetyzacja', description: 'Ukończ 120 minut zadań przynoszących przychód.', reward: '+ złota odznaka', target: 120, metric: 'incomeMinutes', icon: Wallet, accent: '#1ca36f', tint: '#eaf8f1' },
  { id: 'income-600', group: 'money', title: '10 godzin zarobkowych', description: 'Ukończ 10 godzin działań dających przychód.', reward: 'Solidny fundament', target: 600, metric: 'incomeMinutes', icon: Banknote, accent: '#22a971' },
  { id: 'income-1500', group: 'money', title: '25 godzin zarobkowych', description: 'Ukończ 25 godzin działań dających przychód.', reward: 'Rozwój finansowy', target: 1500, metric: 'incomeMinutes', icon: Wallet, accent: '#1da67c', tint: '#eaf9f3' },
  { id: 'income-6000', group: 'money', title: '100 godzin zarobkowych', description: 'Ukończ 100 godzin działań dających przychód.', reward: 'Finansowa siła', target: 6000, metric: 'incomeMinutes', icon: Landmark, accent: '#168a5c' },
  { id: 'income-10', group: 'money', title: 'Pracowity tydzień', description: 'Ukończ 10 zadań przynoszących przychód.', reward: 'Zarabianie', target: 10, metric: 'incomeCount', icon: Wallet, accent: '#46b875', tint: '#ebfaf2' },
  { id: 'income-50', group: 'money', title: 'Pięćdziesiąt zleceń', description: 'Ukończ 50 zadań przynoszących przychód.', reward: 'Stabilny przychód', target: 50, metric: 'incomeCount', icon: PiggyBank, accent: '#2fb27a' },
  { id: 'potential-300', group: 'money', title: 'Inwestycja w przyszłość', description: 'Poświęć 5 godzin na działania z potencjalnym przychodem.', reward: 'Budowanie przyszłości', target: 300, metric: 'potentialMinutes', icon: Rocket, accent: '#e3a32b', tint: '#fff8e8' },
  { id: 'potential-1200', group: 'money', title: 'Ziarno sukcesu', description: 'Poświęć 20 godzin na działania z potencjalnym przychodem.', reward: 'Rośnie potencjał', target: 1200, metric: 'potentialMinutes', icon: Sprout, accent: '#dc9a27' },
  { id: 'potential-3000', group: 'money', title: 'Drzewo możliwości', description: 'Poświęć 50 godzin na działania z potencjalnym przychodem.', reward: 'Owoce pracy', target: 3000, metric: 'potentialMinutes', icon: TreePine, accent: '#c98a1f' },
  { id: 'potential-count-25', group: 'money', title: 'Fabryka pomysłów', description: 'Ukończ 25 zadań z potencjalnym przychodem.', reward: 'Inwestycja w siebie', target: 25, metric: 'potentialCount', icon: Lightbulb, accent: '#e8b23a' },
  { id: 'unpaid-600', group: 'money', title: 'Czas dla siebie', description: 'Ukończ 10 godzin działań bez przychodu: zdrowie, dom, relaks.', reward: 'Dbanie o siebie', target: 600, metric: 'unpaidMinutes', icon: HeartPulse, accent: '#ec6573' },
  { id: 'unpaid-3000', group: 'money', title: 'Siła codzienności', description: 'Ukończ 50 godzin działań bez przychodu.', reward: 'Dobre nawyki', target: 3000, metric: 'unpaidMinutes', icon: Dumbbell, accent: '#d9505f' },
  { id: 'balanced', group: 'money', title: 'Wszechstronny plan', description: 'Ukończ zadania ze wszystkich 3 kategorii finansowych.', reward: 'Równowaga', target: 3, metric: 'usedCategories', icon: Target, accent: '#8c7be5', tint: '#f1efff' },
  { id: 'balanced-day', group: 'money', title: 'Zrównoważony dzień', description: 'Jednego dnia ukończ coś z każdej z 3 kategorii.', reward: 'Harmonia', target: 1, metric: 'balancedDay', icon: Scale, accent: '#8c7be5' },
  { id: 'balanced-week', group: 'money', title: 'Zrównoważony tydzień', description: 'W jednym tygodniu ukończ coś z każdej kategorii.', reward: 'Pełny obraz', target: 1, metric: 'balancedWeek', icon: Shapes, accent: '#7a68d8' },

  // Projekty (7)
  { id: 'project-1', group: 'projects', title: 'Pierwszy projekt', description: 'Utwórz pierwszy projekt.', reward: 'Cel na horyzoncie', target: 1, metric: 'projects', icon: FolderPlus, accent: '#ff8a57' },
  { id: 'projects-3', group: 'projects', title: 'Wiele frontów', description: 'Prowadź 3 projekty.', reward: 'Szeroka perspektywa', target: 3, metric: 'projects', icon: FolderKanban, accent: '#f27a48' },
  { id: 'project-complete-1', group: 'projects', title: 'Projekt domknięty', description: 'Ukończ wszystkie kamienie milowe projektu.', reward: 'Satysfakcja', target: 1, metric: 'projectsCompleted', icon: FolderCheck, accent: '#e46a3c' },
  { id: 'milestones-5', group: 'projects', title: 'Kamienie milowe', description: 'Ukończ 5 kamieni milowych.', reward: 'Widać postęp', target: 5, metric: 'milestonesDone', icon: Milestone, accent: '#ff9a62' },
  { id: 'milestones-25', group: 'projects', title: 'Droga do celu', description: 'Ukończ 25 kamieni milowych.', reward: 'Wytyczona ścieżka', target: 25, metric: 'milestonesDone', icon: Signpost, accent: '#e9844f' },
  { id: 'project-tasks-10', group: 'projects', title: 'Projekt w ruchu', description: 'Ukończ 10 zadań przypisanych do projektów.', reward: 'Cel coraz bliżej', target: 10, metric: 'projectTasksDone', icon: SquareKanban, accent: '#f5925a' },
  { id: 'subtasks-25', group: 'projects', title: 'Krok po kroku', description: 'Odhacz 25 podzadań w zadaniach i projektach.', reward: 'Małe kroki', target: 25, metric: 'subtasksDone', icon: ListTodo, accent: '#ffa26f' },

  // Focus Mode (5)
  { id: 'focus-session-1', group: 'focus', title: 'Pierwsza sesja Focus', description: 'Zakończ pierwszą sesję Focus Mode.', reward: 'Tryb skupienia', target: 1, metric: 'focusSessions', icon: Headphones, accent: '#5b7fe6' },
  { id: 'focus-sessions-10', group: 'focus', title: 'Dziesięć sesji Focus', description: 'Zakończ 10 sesji Focus Mode.', reward: 'Koncentracja', target: 10, metric: 'focusSessions', icon: Brain, accent: '#4d6fd8' },
  { id: 'focus-sessions-50', group: 'focus', title: 'Sztuka skupienia', description: 'Zakończ 50 sesji Focus Mode.', reward: 'Umysł jak brzytwa', target: 50, metric: 'focusSessions', icon: BrainCircuit, accent: '#3f5fc8' },
  { id: 'focus-hours-10', group: 'focus', title: '10 godzin z Focus', description: 'Przepracuj łącznie 10 godzin w Focus Mode.', reward: 'Głęboka koncentracja', target: 600, metric: 'focusMinutes', icon: Glasses, accent: '#6a7ff0' },
  { id: 'deep-work-90', group: 'focus', title: 'Głęboka praca', description: 'Przepracuj 90 minut w jednej sesji Focus.', reward: 'Stan flow', target: 1, metric: 'deepWork', icon: Waves, accent: '#4a68d0' },

  // Doświadczenie (6)
  { id: 'xp-500', group: 'xp', title: 'Poziom 2', description: 'Zdobądź 500 XP i wejdź na kolejny poziom.', reward: '+ nowa ranga', target: 500, metric: 'totalXp', icon: Trophy, accent: '#6a5cff', tint: '#f0edff' },
  { id: 'xp-1000', group: 'xp', title: 'Tysiąc punktów', description: 'Zdobądź 1 000 XP.', reward: 'Nowa energia', target: 1000, metric: 'totalXp', icon: Gauge, accent: '#8a63f4' },
  { id: 'xp-2000', group: 'xp', title: 'Łowca doświadczenia', description: 'Zdobądź 2 000 XP.', reward: 'Mistrz progresu', target: 2000, metric: 'totalXp', icon: Zap, accent: '#9d6bfa', tint: '#f5ecff' },
  { id: 'xp-5000', group: 'xp', title: 'Elita Momentum', description: 'Zdobądź 5 000 XP.', reward: 'Elitarna odznaka', target: 5000, metric: 'totalXp', icon: Gem, accent: '#f0ad33', tint: '#fff7e8' },
  { id: 'xp-10000', group: 'xp', title: 'Dziesięć tysięcy', description: 'Zdobądź 10 000 XP.', reward: 'Diamentowa forma', target: 10000, metric: 'totalXp', icon: Diamond, accent: '#7a4fe0' },
  { id: 'xp-25000', group: 'xp', title: 'Orbita Momentum', description: 'Zdobądź 25 000 XP.', reward: 'Poza skalą', target: 25000, metric: 'totalXp', icon: Orbit, accent: '#5b3fc4' },
];

/** Jasne tło odznaki: 10% koloru odznaki na białym. */
function tintOf(accent: string): string {
  const value = Number.parseInt(accent.slice(1), 16);
  const mix = (channel: number) => Math.round(channel * 0.1 + 255 * 0.9).toString(16).padStart(2, '0');
  return `#${mix((value >> 16) & 255)}${mix((value >> 8) & 255)}${mix(value & 255)}`;
}

const sum = <T,>(items: T[], value: (item: T) => number) => items.reduce((total, item) => total + value(item), 0);
const hourOf = (time: string | null | undefined) => (time ? Number(time.slice(0, 2)) : Number.NaN);

/** Ukończone wystąpienie rutyny albo zadania cyklicznego. */
type CompletedOccurrence = {
  sourceDate: string;
  /** Dzień, w którym wystąpienie faktycznie było (po ewentualnym przeniesieniu). */
  date: string;
  time: string | null;
  minutes: number;
  category: CategoryKey | null;
  series: boolean;
};

/** Daty powtarzają się setki razy (logi, zadania), więc ich parsowanie liczymy raz na datę. */
function createDateCache() {
  const valid = new Map<string, boolean>();
  const mondays = new Map<string, string>();
  const weekdays = new Map<string, number>();
  return {
    isValid(value: string | null | undefined): value is string {
      if (typeof value !== 'string') return false;
      let result = valid.get(value);
      if (result === undefined) { result = isDateKey(value); valid.set(value, result); }
      return result;
    },
    monday(date: string): string {
      let result = mondays.get(date);
      if (result === undefined) { result = mondayOf(date); mondays.set(date, result); }
      return result;
    },
    weekday(date: string): number {
      let result = weekdays.get(date);
      if (result === undefined) { result = parseDate(date).getDay(); weekdays.set(date, result); }
      return result;
    },
  };
}

/** Kolejne dni od `from` do `to` włącznie (maks. ok. 11 lat). */
function daySequence(from: string, to: string): string[] {
  const days: string[] = [];
  const cursor = parseDate(from);
  for (let guard = 0; guard < 4000; guard++) {
    const key = dateKey(cursor);
    if (key > to) break;
    days.push(key);
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * Najdłuższy łańcuch kolejnych ukończonych wystąpień jednej rutyny lub zadania cyklicznego.
 * Przerywa go tylko termin z harmonogramu, który minął bez ukończenia; usunięte wystąpienia
 * i dzisiejsze (jeszcze trwające) nie przerywają łańcucha.
 */
function longestChainOf(routine: Routine, firstCompleted: string, days: string[], dayIndex: Map<string, number>, logs: AppData['routineLogs'], today: string): number {
  let best = 0;
  let run = 0;
  for (let index = dayIndex.get(firstCompleted) ?? days.length; index < days.length; index++) {
    const date = days[index];
    const log = logs[`${routine.id}:${date}`];
    if (log?.completed) { run++; if (run > best) best = run; continue; }
    // Bez trwającego łańcucha nie ma czego przerywać — pomijamy sprawdzanie harmonogramu.
    if (run === 0 || log?.skipped || (log?.dateOverride ?? date) >= today) continue;
    if (log?.dateOverride || occursOn(routine, date)) run = 0;
  }
  return best;
}

export function computeAchievementMetrics(data: AppData, totalXp: number, streak: number, context: AchievementContext = {}): AchievementMetrics {
  const today = context.today ?? todayKey();
  const focusHistory = context.focusHistory ?? [];
  const dates = createDateCache();
  const routineById = new Map(data.routines.map(routine => [routine.id, routine]));
  const doneTasks = data.tasks.filter(task => task.done);

  const occurrences: CompletedOccurrence[] = [];
  // Pierwszy i ostatni ukończony dzień każdej rutyny — początek łańcucha i zakres dni do przejrzenia.
  const firstCompleted = new Map<string, string>();
  let lastCompleted = today;
  for (const [key, log] of Object.entries(data.routineLogs)) {
    if (!log?.completed) continue;
    const separator = key.lastIndexOf(':');
    const routineId = key.slice(0, separator);
    const routine = routineById.get(routineId);
    const sourceDate = key.slice(separator + 1);
    occurrences.push({
      sourceDate,
      date: log.dateOverride ?? sourceDate,
      time: log.timeOverride ?? routine?.time ?? null,
      minutes: log.durationOverride ?? routine?.duration ?? 0,
      category: routine?.category ?? null,
      // Ukończone wystąpienia zadań cyklicznych liczą się jak zadania, a nie jak rutyny.
      series: isTaskSeries(routine),
    });
    if (routine && dates.isValid(sourceDate)) {
      const first = firstCompleted.get(routineId);
      if (!first || sourceDate < first) firstCompleted.set(routineId, sourceDate);
      if (sourceDate > lastCompleted) lastCompleted = sourceDate;
    }
  }
  const seriesOccurrences = occurrences.filter(item => item.series);
  const completedTasks = doneTasks.length + seriesOccurrences.length;
  const completedRoutineSessions = occurrences.length - seriesOccurrences.length;

  // Zadania i wystąpienia zadań cyklicznych w kształcie zadania: kategoria, godzina, długość.
  const taskLike = [
    ...doneTasks.map(task => ({ time: task.time, category: task.category as CategoryKey | null, minutes: task.duration })),
    ...seriesOccurrences.map(item => ({ time: item.time, category: item.category, minutes: item.minutes })),
  ];
  const countTimed = (matches: (hour: number) => boolean) => taskLike.filter(item => item.time && matches(hourOf(item.time))).length;
  const minutesIn = (category: CategoryKey) => sum(doneTasks.filter(task => task.category === category), task => task.duration)
    + sum(occurrences.filter(item => item.category === category), item => item.minutes);

  // Ukończone pozycje w kalendarzu: zadania wg swojej daty, wystąpienia wg dnia, w którym były.
  const events: { date: string; category: CategoryKey | null }[] = [];
  for (const task of doneTasks) if (dates.isValid(task.date)) events.push({ date: task.date, category: task.category });
  for (const item of occurrences) if (dates.isValid(item.date)) events.push({ date: item.date, category: item.category });
  const byDay = new Map<string, { count: number; categories: Set<CategoryKey> }>();
  const byWeek = new Map<string, { count: number; categories: Set<CategoryKey> }>();
  let weekendCount = 0;
  const addTo = (map: typeof byDay, key: string, category: CategoryKey | null) => {
    let bucket = map.get(key);
    if (!bucket) { bucket = { count: 0, categories: new Set<CategoryKey>() }; map.set(key, bucket); }
    bucket.count++;
    if (category) bucket.categories.add(category);
  };
  for (const event of events) {
    const weekday = dates.weekday(event.date);
    if (weekday === 0 || weekday === 6) weekendCount++;
    addTo(byDay, event.date, event.category);
    addTo(byWeek, dates.monday(event.date), event.category);
  }
  const eventDates = [...byDay.keys()].sort();
  const comeback = eventDates.some((date, index) => index > 0 && daysBetween(eventDates[index - 1], date) >= 8);

  // Dzień z kompletem: co najmniej 3 zadania z tą datą (do dziś) i wszystkie ukończone.
  const plannedByDay = new Map<string, { total: number; done: number }>();
  for (const task of data.tasks) {
    if (!dates.isValid(task.date) || task.date > today) continue;
    const day = plannedByDay.get(task.date) ?? { total: 0, done: 0 };
    day.total++;
    if (task.done) day.done++;
    plannedByDay.set(task.date, day);
  }
  const weekAhead = shiftDate(today, 7);

  // Łańcuchy: jedna wspólna lista dni od najwcześniejszego ukończenia do dziś (lub ostatniego ukończenia).
  const earliest = [...firstCompleted.values()].sort()[0];
  const days = earliest ? daySequence(earliest, lastCompleted) : [];
  const dayIndex = new Map(days.map((date, index) => [date, index]));
  const longestChain = Math.max(0, ...data.routines.map(routine => {
    const first = firstCompleted.get(routine.id);
    return first ? longestChainOf(routine, first, days, dayIndex, data.routineLogs, today) : 0;
  }));

  const milestones = data.projects.flatMap(project => project.milestones ?? []);
  const focusSeconds = sum(focusHistory, record => Math.max(0, record.focusSeconds || 0));

  return {
    totalXp,
    streak,
    completedTasks,
    completedRoutineSessions,
    completedCount: completedTasks + completedRoutineSessions,
    completedMinutes: sum(doneTasks, task => task.duration) + sum(occurrences, item => item.minutes),
    scheduledTasks: data.tasks.filter(task => !!task.time).length + data.routines.filter(routine => isTaskSeries(routine)).length,
    activeDays: new Set([...doneTasks.filter(task => task.date).map(task => task.date as string), ...occurrences.map(item => item.sourceDate)]).size,
    incomeMinutes: minutesIn('income'),
    potentialMinutes: minutesIn('potential'),
    unpaidMinutes: minutesIn('unpaid'),
    incomeCount: taskLike.filter(item => item.category === 'income').length,
    potentialCount: taskLike.filter(item => item.category === 'potential').length,
    usedCategories: new Set([...doneTasks.map(task => task.category), ...occurrences.flatMap(item => item.category ? [item.category] : [])]).size,
    morningCount: countTimed(hour => hour < 9),
    eveningCount: countTimed(hour => hour >= 20),
    dawnCount: countTimed(hour => hour < 7),
    nightCount: countTimed(hour => hour >= 22),
    quickWins: taskLike.filter(item => item.minutes <= 15).length,
    marathon: doneTasks.some(task => task.duration >= 180) || occurrences.some(item => item.minutes >= 180) ? 1 : 0,
    inboxZero: completedTasks >= 10 && !data.tasks.some(task => !task.done && !task.date) ? 1 : 0,
    withReminders: data.tasks.filter(task => task.reminders?.length).length + data.routines.filter(routine => routine.reminders?.length).length,
    listedTasks: data.tasks.length + data.routines.filter(routine => isTaskSeries(routine)).length,
    weekendCount,
    activeMonths: new Set(eventDates.map(date => date.slice(0, 7))).size,
    comeback: comeback ? 1 : 0,
    planAheadDays: new Set(data.tasks.filter(task => dates.isValid(task.date) && task.date > today && task.date <= weekAhead).map(task => task.date)).size,
    perfectDays: [...plannedByDay.values()].filter(day => day.total >= 3 && day.done === day.total).length,
    bestDay: Math.max(0, ...[...byDay.values()].map(day => day.count)),
    bestWeek: Math.max(0, ...[...byWeek.values()].map(week => week.count)),
    balancedDay: [...byDay.values()].some(day => day.categories.size >= 3) ? 1 : 0,
    balancedWeek: [...byWeek.values()].some(week => week.categories.size >= 3) ? 1 : 0,
    activeRoutines: data.routines.filter(routine => routine.active && !isTaskSeries(routine)).length,
    longestChain,
    seriesCreated: data.routines.filter(routine => isTaskSeries(routine)).length,
    seriesCompleted: seriesOccurrences.length,
    projects: data.projects.length,
    projectsCompleted: data.projects.filter(project => (project.milestones ?? []).length > 0 && project.milestones.every(milestone => milestone.done)).length,
    milestonesDone: milestones.filter(milestone => milestone.done).length,
    projectTasksDone: doneTasks.filter(task => task.projectId).length,
    subtasksDone: sum(data.tasks, task => (task.subtasks ?? []).filter(subtask => subtask.done).length)
      + sum(milestones, milestone => (milestone.subtasks ?? []).filter(subtask => subtask.done).length),
    focusSessions: focusHistory.filter(record => record.focusSeconds >= 60).length,
    focusMinutes: Math.floor(focusSeconds / 60),
    deepWork: focusHistory.some(record => record.focusSeconds >= 90 * 60) ? 1 : 0,
  };
}

export function buildAchievements(data: AppData, totalXp: number, streak: number, context: AchievementContext = {}): AchievementView[] {
  const metrics = computeAchievementMetrics(data, totalXp, streak, context);
  return ACHIEVEMENT_DEFINITIONS.map(({ metric, tint, ...definition }) => {
    const progress = metrics[metric];
    return {
      ...definition,
      progress,
      unlocked: progress >= definition.target,
      tint: tint ?? tintOf(definition.accent),
      art: `/assets/progression/ach-${definition.id}.svg`,
    };
  });
}
