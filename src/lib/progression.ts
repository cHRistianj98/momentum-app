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
import { text, tr, type Localized } from './i18n';
import { daysBetween, isDateKey, isTaskSeries, occursOn } from './recurrence';

/** Rangi i osiągnięcia liczone z ukończonych zadań, rutyn i sesji Focus (klucz XP — xp.ts). */
export type AchievementGroup = 'tasks' | 'consistency' | 'time' | 'planning' | 'routines' | 'money' | 'projects' | 'focus' | 'xp';

/** Kolejność i nazwy grup w Statystykach (nazwy to gettery — zawsze w bieżącym języku). */
export const ACHIEVEMENT_GROUPS: { id: AchievementGroup; label: string }[] = [
  { id: 'tasks', get label() { return tr('Zadania', 'Tasks'); } },
  { id: 'consistency', get label() { return tr('Regularność', 'Consistency'); } },
  { id: 'time', get label() { return tr('Czas działania', 'Time in action'); } },
  { id: 'planning', get label() { return tr('Planowanie', 'Planning'); } },
  { id: 'routines', get label() { return tr('Rutyny i serie', 'Routines & recurring tasks'); } },
  { id: 'money', get label() { return tr('Przychód i rozwój', 'Income & growth'); } },
  { id: 'projects', get label() { return tr('Projekty', 'Projects'); } },
  { id: 'focus', label: 'Focus Mode' },
  { id: 'xp', get label() { return tr('Doświadczenie', 'Experience'); } },
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

/**
 * Rangi według łącznego XP (klucz w xp.ts). Przy regularnym korzystaniu: druga ranga po ok. tygodniu,
 * trzecia po ok. miesiącu, czwarta po ok. pół roku, najwyższa po ponad roku.
 * Nazwy i opisy to gettery, więc `resolveRank`/`resolveNextRank` zwracają teksty w bieżącym języku.
 */
export const RANKS: RankView[] = [
  { id: 'spark', get title() { return tr('Iskra Startu', 'Starter Spark'); }, get subtitle() { return tr('Zaczynasz świadomie planować swój czas.', "You're starting to plan your time with intention."); }, minXp: 0, accent: '#7f72ff', tint: '#f0edff', icon: Sparkles, art: '/assets/progression/rank-spark.svg' },
  { id: 'builder', get title() { return tr('Budowniczy Nawyków', 'Habit Builder'); }, get subtitle() { return tr('Tworzysz solidne fundamenty codziennej regularności.', "You're laying solid foundations for everyday consistency."); }, minXp: 1000, accent: '#3aa0ff', tint: '#edf6ff', icon: ShieldCheck, art: '/assets/progression/rank-builder.svg' },
  { id: 'pilot', get title() { return tr('Pilot Progresu', 'Progress Pilot'); }, get subtitle() { return tr('Sterujesz tygodniem z coraz większą pewnością.', "You're steering your week with growing confidence."); }, minXp: 5000, accent: '#ff8a57', tint: '#fff3ec', icon: Rocket, art: '/assets/progression/rank-pilot.svg' },
  { id: 'master', get title() { return tr('Mistrz Momentum', 'Momentum Master'); }, get subtitle() { return tr('Systematyczność zaczyna naprawdę procentować.', 'Your consistency is really starting to pay off.'); }, minXp: 20000, accent: '#26b274', tint: '#ecfaf3', icon: Crown, art: '/assets/progression/rank-master.svg' },
  { id: 'legend', get title() { return tr('Legenda Momentum', 'Momentum Legend'); }, get subtitle() { return tr('Twoje dni działają jak dopracowany system.', 'Your days run like a finely tuned system.'); }, minXp: 60000, accent: '#f3b23c', tint: '#fff8e8', icon: Gem, art: '/assets/progression/rank-legend.svg' },
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

/** Odznaka z tekstami w obu językach (`{ pl, en }`) — w `ACHIEVEMENT_DEFINITIONS` teksty stają się getterami. */
type LocalizedAchievementDefinition = Omit<AchievementDefinition, 'title' | 'description' | 'reward'> & {
  title: Localized;
  description: Localized;
  reward: Localized;
};

/**
 * Katalog 100 odznak. Identyfikatory się nie zmieniają, więc zdobyte wcześniej odznaki pozostają zdobyte;
 * liczba w identyfikatorze to historyczny próg i nie musi już odpowiadać `target`.
 * Progi skalibrowano symulacją dwóch lat korzystania: przy regularnym używaniu najmniejsze odznaki
 * w grupie wpadają w 1. dniu, tygodniu albo miesiącu, a najwyższe dopiero po ponad roku.
 */
const ACHIEVEMENT_CATALOG: LocalizedAchievementDefinition[] = [
  // Zadania (16)
  { id: 'first-step', group: 'tasks', title: { pl: 'Pierwszy krok', en: 'First step' }, description: { pl: 'Ukończ pierwsze zadanie albo rutynę.', en: 'Complete your first task or routine.' }, reward: { pl: '+ motywacja', en: '+ motivation' }, target: 1, metric: 'completedCount', icon: Award, accent: '#7f72ff', tint: '#f2efff' },
  { id: 'tasks-5', group: 'tasks', title: { pl: 'Dobry początek', en: 'Good start' }, description: { pl: 'Ukończ 5 zadań.', en: 'Complete 5 tasks.' }, reward: { pl: 'Małe zwycięstwa', en: 'Small wins' }, target: 5, metric: 'completedTasks', icon: CheckCircle2, accent: '#7f72ff', tint: '#f2efff' },
  { id: 'tasks-25', group: 'tasks', title: { pl: 'Maszyna do działania', en: 'Task machine' }, description: { pl: 'Ukończ 25 zadań.', en: 'Complete 25 tasks.' }, reward: { pl: 'Systematyczność', en: 'Systematic approach' }, target: 25, metric: 'completedTasks', icon: ShieldCheck, accent: '#5d8ef7', tint: '#edf3ff' },
  { id: 'tasks-50', group: 'tasks', title: { pl: 'Pół setki', en: 'Fifty and counting' }, description: { pl: 'Ukończ 50 zadań.', en: 'Complete 50 tasks.' }, reward: { pl: 'Rozpęd', en: 'Picking up speed' }, target: 50, metric: 'completedTasks', icon: ListChecks, accent: '#6c7cf2' },
  { id: 'tasks-100', group: 'tasks', title: { pl: 'Setka sukcesów', en: 'A hundred wins' }, description: { pl: 'Ukończ 100 zadań.', en: 'Complete 100 tasks.' }, reward: { pl: 'Legenda działania', en: 'Legendary doer' }, target: 100, metric: 'completedTasks', icon: Trophy, accent: '#d9a535', tint: '#fff8e5' },
  { id: 'tasks-250', group: 'tasks', title: { pl: 'Pięćsetka', en: 'The 500 club' }, description: { pl: 'Ukończ 500 zadań.', en: 'Complete 500 tasks.' }, reward: { pl: 'Stały rytm działania', en: 'Steady rhythm' }, target: 500, metric: 'completedTasks', icon: ClipboardCheck, accent: '#4f6fe0' },
  { id: 'tasks-500', group: 'tasks', title: { pl: 'Półtora tysiąca', en: 'Fifteen hundred' }, description: { pl: 'Ukończ 1 500 zadań.', en: 'Complete 1,500 tasks.' }, reward: { pl: 'Ikona działania', en: 'Productivity icon' }, target: 1500, metric: 'completedTasks', icon: Medal, accent: '#3f5bd1' },
  { id: 'completions-50', group: 'tasks', title: { pl: 'Pięćdziesiąt razy tak', en: 'Fifty times yes' }, description: { pl: 'Ukończ łącznie 50 zadań lub wykonań rutyn.', en: 'Complete 50 tasks or routines in total.' }, reward: { pl: 'Dobra passa', en: 'On a roll' }, target: 50, metric: 'completedCount', icon: CheckCheck, accent: '#8a7cf6' },
  { id: 'completions-150', group: 'tasks', title: { pl: 'Nie do zatrzymania', en: 'Unstoppable' }, description: { pl: 'Ukończ 150 zadań lub wykonań rutyn.', en: 'Complete 150 tasks or routines.' }, reward: { pl: 'Wielkie osiągnięcie', en: 'Major achievement' }, target: 150, metric: 'completedCount', icon: Trophy, accent: '#bb86e7', tint: '#f6efff' },
  { id: 'completions-300', group: 'tasks', title: { pl: 'Osiemset kroków', en: 'Eight hundred steps' }, description: { pl: 'Ukończ łącznie 800 zadań lub wykonań rutyn.', en: 'Complete 800 tasks or routines in total.' }, reward: { pl: 'Siła nawyku', en: 'Power of habit' }, target: 800, metric: 'completedCount', icon: BadgeCheck, accent: '#a370ec' },
  { id: 'completions-500', group: 'tasks', title: { pl: 'Szczyt możliwości', en: 'Peak performance' }, description: { pl: 'Ukończ łącznie 2 000 zadań lub wykonań rutyn.', en: 'Complete 2,000 tasks or routines in total.' }, reward: { pl: 'Widok ze szczytu', en: 'View from the top' }, target: 2000, metric: 'completedCount', icon: Mountain, accent: '#8656d9' },
  { id: 'quick-wins-25', group: 'tasks', title: { pl: 'Szybkie zwycięstwa', en: 'Quick wins' }, description: { pl: 'Ukończ 25 krótkich zadań (do 15 minut).', en: 'Complete 25 short tasks (up to 15 minutes).' }, reward: { pl: 'Lekkość', en: 'Effortless' }, target: 25, metric: 'quickWins', icon: Timer, accent: '#38a3e8' },
  { id: 'marathon-180', group: 'tasks', title: { pl: 'Maraton', en: 'Marathon' }, description: { pl: 'Ukończ zadanie lub rutynę trwającą min. 3 godziny.', en: 'Complete a task or routine lasting at least 3 hours.' }, reward: { pl: 'Wytrzymałość', en: 'Endurance' }, target: 1, metric: 'marathon', icon: Hourglass, accent: '#e0794c' },
  { id: 'inbox-zero', group: 'tasks', title: { pl: 'Pusty Inbox', en: 'Inbox zero' }, description: { pl: 'Ukończ 10 zadań i opróżnij Inbox (zadania bez daty).', en: 'Complete 10 tasks and empty your Inbox (tasks without a date).' }, reward: { pl: 'Czysta głowa', en: 'Clear head' }, target: 1, metric: 'inboxZero', icon: Inbox, accent: '#3ab0a2' },
  { id: 'reminders-10', group: 'tasks', title: { pl: 'Nic nie umknie', en: 'Nothing slips through' }, description: { pl: 'Ustaw przypomnienia w 10 zadaniach lub rutynach.', en: 'Set reminders on 10 tasks or routines.' }, reward: { pl: 'Spokój ducha', en: 'Peace of mind' }, target: 10, metric: 'withReminders', icon: BellRing, accent: '#f08a3e' },
  { id: 'tasks-listed-50', group: 'tasks', title: { pl: 'Skarbnica pomysłów', en: 'Treasure trove of ideas' }, description: { pl: 'Zbierz na liście 50 zadań, także ukończonych.', en: 'Collect 50 tasks on your list, completed ones included.' }, reward: { pl: 'Pełna głowa pomysłów', en: 'Head full of ideas' }, target: 50, metric: 'listedTasks', icon: NotebookPen, accent: '#e45f9b' },

  // Regularność (16)
  { id: 'streak-3', group: 'consistency', title: { pl: 'Seria 3 dni', en: '3-day streak' }, description: { pl: 'Utrzymaj ciągłość działania przez 3 dni.', en: 'Stay active for 3 days in a row.' }, reward: { pl: '+ ogień serii', en: '+ streak fire' }, target: 3, metric: 'streak', icon: Flame, accent: '#ff7d73', tint: '#fff0ef' },
  { id: 'streak-7', group: 'consistency', title: { pl: 'Tydzień bez przerwy', en: 'Unbroken week' }, description: { pl: 'Utrzymaj serię przez 7 kolejnych dni.', en: 'Keep your streak going for 7 days in a row.' }, reward: { pl: 'Płomień', en: 'Flame' }, target: 7, metric: 'streak', icon: Flame, accent: '#ff816d', tint: '#fff1ed' },
  { id: 'streak-14', group: 'consistency', title: { pl: 'Dwa tygodnie w ogniu', en: 'Two weeks on fire' }, description: { pl: 'Utrzymaj serię przez 14 kolejnych dni.', en: 'Keep your streak going for 14 days in a row.' }, reward: { pl: 'Żar', en: 'Embers' }, target: 14, metric: 'streak', icon: Flame, accent: '#f86f62' },
  { id: 'streak-30', group: 'consistency', title: { pl: 'Miesiąc determinacji', en: 'A month of grit' }, description: { pl: 'Utrzymaj serię przez 30 kolejnych dni.', en: 'Keep your streak going for 30 days in a row.' }, reward: { pl: 'Nieustępliwość', en: 'Tenacity' }, target: 30, metric: 'streak', icon: Flame, accent: '#e96987', tint: '#fff0f3' },
  { id: 'streak-60', group: 'consistency', title: { pl: 'Dwa miesiące serii', en: 'Two-month streak' }, description: { pl: 'Utrzymaj serię przez 60 kolejnych dni.', en: 'Keep your streak going for 60 days in a row.' }, reward: { pl: 'Niegasnący płomień', en: 'Undying flame' }, target: 60, metric: 'streak', icon: FlameKindling, accent: '#e8586f' },
  { id: 'streak-100', group: 'consistency', title: { pl: 'Seria stulecia', en: 'Streak of the century' }, description: { pl: 'Utrzymaj serię przez 100 kolejnych dni.', en: 'Keep your streak going for 100 days in a row.' }, reward: { pl: 'Legenda wytrwałości', en: 'Legend of perseverance' }, target: 100, metric: 'streak', icon: InfinityIcon, accent: '#d24a78' },
  { id: 'active-7', group: 'consistency', title: { pl: 'Tydzień progresu', en: 'A week of progress' }, description: { pl: 'Bądź aktywny w 7 różnych dniach.', en: 'Be active on 7 different days.' }, reward: { pl: '+ wytrwałość', en: '+ persistence' }, target: 7, metric: 'activeDays', icon: Star, accent: '#f0a52f', tint: '#fff8e8' },
  { id: 'active-30', group: 'consistency', title: { pl: '30 dni na mapie', en: '30 days on the map' }, description: { pl: 'Zrealizuj coś w 30 różnych dniach.', en: 'Get something done on 30 different days.' }, reward: { pl: 'Stały rozwój', en: 'Steady growth' }, target: 30, metric: 'activeDays', icon: Star, accent: '#e7ad4c', tint: '#fff7e9' },
  { id: 'active-60', group: 'consistency', title: { pl: '60 dni w ruchu', en: '60 days in motion' }, description: { pl: 'Zrealizuj coś w 60 różnych dniach.', en: 'Get something done on 60 different days.' }, reward: { pl: 'Konsekwencja', en: 'Consistency' }, target: 60, metric: 'activeDays', icon: CalendarCheck, accent: '#eba23f' },
  { id: 'active-100', group: 'consistency', title: { pl: 'Sto dni działania', en: 'A hundred days of action' }, description: { pl: 'Zrealizuj coś w 100 różnych dniach.', en: 'Get something done on 100 different days.' }, reward: { pl: 'Trwały nawyk', en: 'Lasting habit' }, target: 100, metric: 'activeDays', icon: CalendarCheck2, accent: '#df8f35' },
  { id: 'active-365', group: 'consistency', title: { pl: 'Rok działania', en: 'A year of action' }, description: { pl: 'Zrealizuj coś w 365 różnych dniach.', en: 'Get something done on 365 different days.' }, reward: { pl: 'Rok progresu', en: 'A year of progress' }, target: 365, metric: 'activeDays', icon: CalendarHeart, accent: '#cf7a2e' },
  { id: 'weekend-10', group: 'consistency', title: { pl: 'Weekendowy rytm', en: 'Weekend rhythm' }, description: { pl: 'Ukończ 10 zadań lub rutyn w weekendy.', en: 'Complete 10 tasks or routines on weekends.' }, reward: { pl: 'Weekend z głową', en: 'Weekend well spent' }, target: 10, metric: 'weekendCount', icon: Coffee, accent: '#f2985a' },
  { id: 'weekend-50', group: 'consistency', title: { pl: 'Aktywne weekendy', en: 'Active weekends' }, description: { pl: 'Ukończ 150 zadań lub rutyn w weekendy.', en: 'Complete 150 tasks or routines on weekends.' }, reward: { pl: 'Wolny czas, dobry czas', en: 'Free time, good time' }, target: 150, metric: 'weekendCount', icon: TreePalm, accent: '#e57f45' },
  { id: 'months-3', group: 'consistency', title: { pl: 'Kwartał z Momentum', en: 'A quarter with Momentum' }, description: { pl: 'Ukończ coś w 3 różnych miesiącach.', en: 'Complete something in 3 different months.' }, reward: { pl: 'Długi oddech', en: 'Staying power' }, target: 3, metric: 'activeMonths', icon: CalendarRange, accent: '#f2b14b' },
  { id: 'months-6', group: 'consistency', title: { pl: 'Pół roku progresu', en: 'Six months of progress' }, description: { pl: 'Ukończ coś w 6 różnych miesiącach.', en: 'Complete something in 6 different months.' }, reward: { pl: 'Pory roku', en: 'Changing seasons' }, target: 6, metric: 'activeMonths', icon: TreeDeciduous, accent: '#d99a3a' },
  { id: 'comeback', group: 'consistency', title: { pl: 'Wielki powrót', en: 'Big comeback' }, description: { pl: 'Wróć do działania po co najmniej tygodniu przerwy.', en: 'Get back into action after a break of at least a week.' }, reward: { pl: 'Nowy start', en: 'Fresh start' }, target: 1, metric: 'comeback', icon: Undo2, accent: '#f7a26a' },

  // Czas działania (12)
  { id: 'focus-180', group: 'time', title: { pl: '3 godziny skupienia', en: '3 hours of focus' }, description: { pl: 'Ukończ łącznie co najmniej 180 minut zaplanowanych bloków.', en: 'Complete at least 180 minutes of planned time blocks in total.' }, reward: { pl: '+ fokus', en: '+ focus' }, target: 180, metric: 'completedMinutes', icon: Target, accent: '#4e97ff', tint: '#edf4ff' },
  { id: 'focus-600', group: 'time', title: { pl: '20 godzin w działaniu', en: '20 hours in action' }, description: { pl: 'Ukończ łącznie 20 godzin zadań i rutyn.', en: 'Complete 20 hours of tasks and routines in total.' }, reward: { pl: 'Skupienie', en: 'Focused mind' }, target: 1200, metric: 'completedMinutes', icon: Clock, accent: '#4c8ef5' },
  { id: 'focus-1200', group: 'time', title: { pl: '100 godzin skupienia', en: '100 hours of focus' }, description: { pl: 'Ukończ 100 godzin zaplanowanego działania.', en: 'Complete 100 hours of planned activity.' }, reward: { pl: 'Koncentracja', en: 'Concentration' }, target: 6000, metric: 'completedMinutes', icon: Focus, accent: '#629eeb', tint: '#eef6ff' },
  { id: 'focus-3000', group: 'time', title: { pl: '400 godzin w działaniu', en: '400 hours in action' }, description: { pl: 'Ukończ łącznie 400 godzin zadań i rutyn.', en: 'Complete 400 hours of tasks and routines in total.' }, reward: { pl: 'Głęboka praca', en: 'Deep work' }, target: 24000, metric: 'completedMinutes', icon: AlarmClock, accent: '#3d78e0' },
  { id: 'focus-6000', group: 'time', title: { pl: '800 godzin progresu', en: '800 hours of progress' }, description: { pl: 'Ukończ 800 godzin działania.', en: 'Complete 800 hours of activity.' }, reward: { pl: 'Długofalowy progres', en: 'Long-term progress' }, target: 48000, metric: 'completedMinutes', icon: Clock3, accent: '#467bd9', tint: '#eef3ff' },
  { id: 'focus-12000', group: 'time', title: { pl: '2000 godzin w działaniu', en: '2,000 hours in action' }, description: { pl: 'Ukończ łącznie 2 000 godzin zadań i rutyn.', en: 'Complete 2,000 hours of tasks and routines in total.' }, reward: { pl: 'Mistrzostwo czasu', en: 'Master of time' }, target: 120000, metric: 'completedMinutes', icon: Watch, accent: '#2f62c7' },
  { id: 'morning-5', group: 'time', title: { pl: 'Ranny ptaszek', en: 'Early bird' }, description: { pl: 'Ukończ 5 zadań zaplanowanych przed 9:00.', en: 'Complete 5 tasks scheduled before 9:00.' }, reward: { pl: 'Dobry poranek', en: 'Good morning' }, target: 5, metric: 'morningCount', icon: Sun, accent: '#e7a23d', tint: '#fff5e8' },
  { id: 'morning-25', group: 'time', title: { pl: 'Poranny rytm', en: 'Morning rhythm' }, description: { pl: 'Ukończ 100 zadań zaplanowanych przed 9:00.', en: 'Complete 100 tasks scheduled before 9:00.' }, reward: { pl: 'Złota godzina', en: 'Golden hour' }, target: 100, metric: 'morningCount', icon: Sunrise, accent: '#e9973a' },
  { id: 'dawn-5', group: 'time', title: { pl: 'Przed świtem', en: 'Before dawn' }, description: { pl: 'Ukończ 5 zadań zaplanowanych przed 7:00.', en: 'Complete 5 tasks scheduled before 7:00.' }, reward: { pl: 'Pierwsze światło', en: 'First light' }, target: 5, metric: 'dawnCount', icon: SunDim, accent: '#f0a845' },
  { id: 'evening-5', group: 'time', title: { pl: 'Nocny strateg', en: 'Night strategist' }, description: { pl: 'Ukończ 5 zadań zaplanowanych po 20:00.', en: 'Complete 5 tasks scheduled for 20:00 or later.' }, reward: { pl: 'Wieczorny fokus', en: 'Evening focus' }, target: 5, metric: 'eveningCount', icon: Moon, accent: '#7783c8', tint: '#eef0ff' },
  { id: 'evening-25', group: 'time', title: { pl: 'Wieczorny rytm', en: 'Evening rhythm' }, description: { pl: 'Ukończ 100 zadań zaplanowanych od 20:00.', en: 'Complete 100 tasks scheduled for 20:00 or later.' }, reward: { pl: 'Spokojny wieczór', en: 'Calm evening' }, target: 100, metric: 'eveningCount', icon: Sunset, accent: '#6f6fc4' },
  { id: 'night-5', group: 'time', title: { pl: 'Nocna zmiana', en: 'Night shift' }, description: { pl: 'Ukończ 5 zadań zaplanowanych od 22:00.', en: 'Complete 5 tasks scheduled for 22:00 or later.' }, reward: { pl: 'Cisza nocy', en: 'Still of the night' }, target: 5, metric: 'nightCount', icon: MoonStar, accent: '#5d68b8' },

  // Planowanie (10)
  { id: 'planner-10', group: 'planning', title: { pl: 'Planista', en: 'Planner' }, description: { pl: 'Nadaj godzinę przynajmniej 10 zadaniom.', en: 'Assign a time to at least 10 tasks.' }, reward: { pl: '+ kontrola planu', en: '+ plan control' }, target: 10, metric: 'scheduledTasks', icon: CalendarDays, accent: '#a564ff', tint: '#f5efff' },
  { id: 'planner-50', group: 'planning', title: { pl: 'Architekt czasu', en: 'Time architect' }, description: { pl: 'Zaplanuj godzinę dla 50 zadań.', en: 'Schedule a time for 50 tasks.' }, reward: { pl: 'Świetne planowanie', en: 'Great planning' }, target: 50, metric: 'scheduledTasks', icon: CalendarDays, accent: '#ae7ff3', tint: '#f6efff' },
  { id: 'planner-100', group: 'planning', title: { pl: 'Pięćset w kalendarzu', en: '500 on the calendar' }, description: { pl: 'Nadaj godzinę 500 zadaniom.', en: 'Assign a time to 500 tasks.' }, reward: { pl: 'Plan pod kontrolą', en: 'Plan under control' }, target: 500, metric: 'scheduledTasks', icon: CalendarClock, accent: '#9a6cf0' },
  { id: 'planner-250', group: 'planning', title: { pl: 'Kalendarz pod kontrolą', en: 'Calendar under control' }, description: { pl: 'Nadaj godzinę 1 500 zadaniom.', en: 'Assign a time to 1,500 tasks.' }, reward: { pl: 'Mistrzowskie planowanie', en: 'Masterful planning' }, target: 1500, metric: 'scheduledTasks', icon: CalendarCog, accent: '#8456dc' },
  { id: 'plan-ahead-7', group: 'planning', title: { pl: 'Tydzień do przodu', en: 'A week ahead' }, description: { pl: 'Zaplanuj zadania na każdy z 7 najbliższych dni.', en: 'Plan tasks for each of the next 7 days.' }, reward: { pl: 'Spokojna głowa', en: 'Calm mind' }, target: 7, metric: 'planAheadDays', icon: CalendarPlus, accent: '#b07cf6' },
  { id: 'perfect-day-1', group: 'planning', title: { pl: 'Perfekcyjny dzień', en: 'Perfect day' }, description: { pl: 'Ukończ wszystkie zadania dnia (co najmniej 3).', en: "Complete all of a day's tasks (at least 3)." }, reward: { pl: 'Czysta lista', en: 'All checked off' }, target: 1, metric: 'perfectDays', icon: SquareCheckBig, accent: '#7c6af0' },
  { id: 'perfect-days-10', group: 'planning', title: { pl: 'Mistrz czystych list', en: 'Master of clean lists' }, description: { pl: 'Zalicz 150 dni z kompletem ukończonych zadań.', en: 'Rack up 150 days with all tasks completed.' }, reward: { pl: 'Precyzja', en: 'Precision' }, target: 150, metric: 'perfectDays', icon: Goal, accent: '#6a55dd' },
  { id: 'day-5', group: 'planning', title: { pl: 'Produktywny dzień', en: 'Productive day' }, description: { pl: 'Ukończ 5 zadań lub rutyn jednego dnia.', en: 'Complete 5 tasks or routines in a single day.' }, reward: { pl: 'Pełne obroty', en: 'Full throttle' }, target: 5, metric: 'bestDay', icon: TrendingUp, accent: '#a985f5' },
  { id: 'day-10', group: 'planning', title: { pl: 'Dzień rekordów', en: 'Record-breaking day' }, description: { pl: 'Ukończ 10 zadań lub rutyn jednego dnia.', en: 'Complete 10 tasks or routines in a single day.' }, reward: { pl: 'Rekordowe tempo', en: 'Record pace' }, target: 10, metric: 'bestDay', icon: Flag, accent: '#946df0' },
  { id: 'week-25', group: 'planning', title: { pl: 'Tydzień pełen działania', en: 'Action-packed week' }, description: { pl: 'Ukończ 25 zadań lub rutyn w jednym tygodniu.', en: 'Complete 25 tasks or routines in a single week.' }, reward: { pl: 'Tygodniowy szczyt', en: 'Weekly peak' }, target: 25, metric: 'bestWeek', icon: Layers, accent: '#8a64e6' },

  // Rutyny i serie (13)
  { id: 'routines-1', group: 'routines', title: { pl: 'Pierwszy rytuał', en: 'First ritual' }, description: { pl: 'Ukończ pierwszą całą rutynę.', en: 'Complete your first full routine.' }, reward: { pl: 'Moc nawyków', en: 'Habit power' }, target: 1, metric: 'completedRoutineSessions', icon: Sparkles, accent: '#bd76f5', tint: '#f9edff' },
  { id: 'routines-10', group: 'routines', title: { pl: 'Żelazny nawyk', en: 'Iron habit' }, description: { pl: 'Zakończ 10 rutyn.', en: 'Finish 10 routines.' }, reward: { pl: 'Dyscyplina', en: 'Discipline' }, target: 10, metric: 'completedRoutineSessions', icon: ShieldCheck, accent: '#45a4c8', tint: '#ebfaff' },
  { id: 'routines-25', group: 'routines', title: { pl: 'Rytm codzienności', en: 'Everyday rhythm' }, description: { pl: 'Zakończ 25 rutyn.', en: 'Finish 25 routines.' }, reward: { pl: 'Stabilność', en: 'Stability' }, target: 25, metric: 'completedRoutineSessions', icon: Repeat, accent: '#a86ef0' },
  { id: 'routines-50', group: 'routines', title: { pl: 'Mistrz rutyn', en: 'Routine master' }, description: { pl: 'Zakończ 50 rutyn.', en: 'Finish 50 routines.' }, reward: { pl: 'Wewnętrzna siła', en: 'Inner strength' }, target: 50, metric: 'completedRoutineSessions', icon: Crown, accent: '#4bb992', tint: '#eafaf4' },
  { id: 'routines-100', group: 'routines', title: { pl: 'Dwieście rytuałów', en: 'Two hundred rituals' }, description: { pl: 'Zakończ 200 rutyn.', en: 'Finish 200 routines.' }, reward: { pl: 'Automatyzm', en: 'Second nature' }, target: 200, metric: 'completedRoutineSessions', icon: Repeat2, accent: '#3c94b8' },
  { id: 'routines-250', group: 'routines', title: { pl: 'Twierdza nawyków', en: 'Habit fortress' }, description: { pl: 'Zakończ 600 rutyn.', en: 'Finish 600 routines.' }, reward: { pl: 'Niewzruszoność', en: 'Unshakeable' }, target: 600, metric: 'completedRoutineSessions', icon: Castle, accent: '#3a9e7f' },
  { id: 'routine-builder-3', group: 'routines', title: { pl: 'Trzy filary', en: 'Three pillars' }, description: { pl: 'Miej jednocześnie 3 aktywne rutyny.', en: 'Have 3 active routines at the same time.' }, reward: { pl: 'Solidne fundamenty', en: 'Solid foundations' }, target: 3, metric: 'activeRoutines', icon: Blocks, accent: '#c47ae8' },
  { id: 'routine-chain-7', group: 'routines', title: { pl: 'Łańcuch 7', en: 'Chain of 7' }, description: { pl: 'Wykonaj rutynę lub zadanie cykliczne 7 razy z rzędu.', en: 'Complete a routine or recurring task 7 times in a row.' }, reward: { pl: 'Nie przerywaj łańcucha', en: "Don't break the chain" }, target: 7, metric: 'longestChain', icon: Link, accent: '#5aa9d6' },
  { id: 'routine-chain-30', group: 'routines', title: { pl: 'Łańcuch 30', en: 'Chain of 30' }, description: { pl: 'Wykonaj rutynę lub zadanie cykliczne 30 razy z rzędu.', en: 'Complete a routine or recurring task 30 times in a row.' }, reward: { pl: 'Żelazna konsekwencja', en: 'Iron consistency' }, target: 30, metric: 'longestChain', icon: Link2, accent: '#3f8fc0' },
  { id: 'series-1', group: 'routines', title: { pl: 'Na powtórce', en: 'On repeat' }, description: { pl: 'Utwórz pierwsze zadanie cykliczne.', en: 'Create your first recurring task.' }, reward: { pl: 'Automatyczny plan', en: 'Plan on autopilot' }, target: 1, metric: 'seriesCreated', icon: RefreshCw, accent: '#5f9cf0' },
  { id: 'series-10', group: 'routines', title: { pl: 'Dziesięć powtórek', en: 'Ten repeats' }, description: { pl: 'Ukończ 10 wystąpień zadań cyklicznych.', en: 'Complete 10 occurrences of recurring tasks.' }, reward: { pl: 'Rytm', en: 'Rhythm' }, target: 10, metric: 'seriesCompleted', icon: RotateCw, accent: '#4c8be3' },
  { id: 'series-50', group: 'routines', title: { pl: 'Pięćdziesiąt powtórek', en: 'Fifty repeats' }, description: { pl: 'Ukończ 50 wystąpień zadań cyklicznych.', en: 'Complete 50 occurrences of recurring tasks.' }, reward: { pl: 'Maszyna nawyków', en: 'Habit machine' }, target: 50, metric: 'seriesCompleted', icon: Workflow, accent: '#3b78d4' },
  { id: 'series-100', group: 'routines', title: { pl: 'Setka powtórek', en: 'A hundred repeats' }, description: { pl: 'Ukończ 100 wystąpień zadań cyklicznych.', en: 'Complete 100 occurrences of recurring tasks.' }, reward: { pl: 'Perpetuum mobile', en: 'Perpetual motion' }, target: 100, metric: 'seriesCompleted', icon: CalendarSync, accent: '#2f66c2' },

  // Przychód i rozwój (15)
  { id: 'income-120', group: 'money', title: { pl: 'Monetyzacja', en: 'Time is money' }, description: { pl: 'Ukończ 120 minut zadań przynoszących przychód.', en: 'Complete 120 minutes of income-generating tasks.' }, reward: { pl: '+ złota odznaka', en: '+ gold badge' }, target: 120, metric: 'incomeMinutes', icon: Wallet, accent: '#1ca36f', tint: '#eaf8f1' },
  { id: 'income-600', group: 'money', title: { pl: '10 godzin zarobkowych', en: '10 hours of earning' }, description: { pl: 'Ukończ 10 godzin działań dających przychód.', en: 'Complete 10 hours of income-generating activities.' }, reward: { pl: 'Solidny fundament', en: 'Firm footing' }, target: 600, metric: 'incomeMinutes', icon: Banknote, accent: '#22a971' },
  { id: 'income-1500', group: 'money', title: { pl: '50 godzin zarobkowych', en: '50 hours of earning' }, description: { pl: 'Ukończ 50 godzin działań dających przychód.', en: 'Complete 50 hours of income-generating activities.' }, reward: { pl: 'Rozwój finansowy', en: 'Financial growth' }, target: 3000, metric: 'incomeMinutes', icon: Wallet, accent: '#1da67c', tint: '#eaf9f3' },
  { id: 'income-6000', group: 'money', title: { pl: '1000 godzin zarobkowych', en: '1,000 hours of earning' }, description: { pl: 'Ukończ 1 000 godzin działań dających przychód.', en: 'Complete 1,000 hours of income-generating activities.' }, reward: { pl: 'Finansowa siła', en: 'Financial muscle' }, target: 60000, metric: 'incomeMinutes', icon: Landmark, accent: '#168a5c' },
  { id: 'income-10', group: 'money', title: { pl: 'Pracowity tydzień', en: 'Busy week' }, description: { pl: 'Ukończ 10 zadań przynoszących przychód.', en: 'Complete 10 income-generating tasks.' }, reward: { pl: 'Zarabianie', en: 'Earning mode' }, target: 10, metric: 'incomeCount', icon: Wallet, accent: '#46b875', tint: '#ebfaf2' },
  { id: 'income-50', group: 'money', title: { pl: 'Pięćset zleceń', en: 'Five hundred gigs' }, description: { pl: 'Ukończ 500 zadań przynoszących przychód.', en: 'Complete 500 income-generating tasks.' }, reward: { pl: 'Stabilny przychód', en: 'Steady income' }, target: 500, metric: 'incomeCount', icon: PiggyBank, accent: '#2fb27a' },
  { id: 'potential-300', group: 'money', title: { pl: 'Inwestycja w przyszłość', en: 'Investing in the future' }, description: { pl: 'Poświęć 5 godzin na działania z potencjalnym przychodem.', en: 'Spend 5 hours on activities with potential income.' }, reward: { pl: 'Budowanie przyszłości', en: 'Building the future' }, target: 300, metric: 'potentialMinutes', icon: Rocket, accent: '#e3a32b', tint: '#fff8e8' },
  { id: 'potential-1200', group: 'money', title: { pl: 'Ziarno sukcesu', en: 'Seed of success' }, description: { pl: 'Poświęć 20 godzin na działania z potencjalnym przychodem.', en: 'Spend 20 hours on activities with potential income.' }, reward: { pl: 'Rośnie potencjał', en: 'Growing potential' }, target: 1200, metric: 'potentialMinutes', icon: Sprout, accent: '#dc9a27' },
  { id: 'potential-3000', group: 'money', title: { pl: 'Drzewo możliwości', en: 'Tree of possibilities' }, description: { pl: 'Poświęć 300 godzin na działania z potencjalnym przychodem.', en: 'Spend 300 hours on activities with potential income.' }, reward: { pl: 'Owoce pracy', en: 'Fruits of your work' }, target: 18000, metric: 'potentialMinutes', icon: TreePine, accent: '#c98a1f' },
  { id: 'potential-count-25', group: 'money', title: { pl: 'Fabryka pomysłów', en: 'Idea factory' }, description: { pl: 'Ukończ 25 zadań z potencjalnym przychodem.', en: 'Complete 25 tasks with potential income.' }, reward: { pl: 'Inwestycja w siebie', en: 'Investing in yourself' }, target: 25, metric: 'potentialCount', icon: Lightbulb, accent: '#e8b23a' },
  { id: 'unpaid-600', group: 'money', title: { pl: 'Czas dla siebie', en: 'Me time' }, description: { pl: 'Ukończ 10 godzin działań bez przychodu: zdrowie, dom, relaks.', en: 'Complete 10 hours of activities with no income: health, home, relaxation.' }, reward: { pl: 'Dbanie o siebie', en: 'Self-care' }, target: 600, metric: 'unpaidMinutes', icon: HeartPulse, accent: '#ec6573' },
  { id: 'unpaid-3000', group: 'money', title: { pl: 'Siła codzienności', en: 'Everyday strength' }, description: { pl: 'Ukończ 800 godzin działań bez przychodu.', en: 'Complete 800 hours of activities with no income.' }, reward: { pl: 'Dobre nawyki', en: 'Good habits' }, target: 48000, metric: 'unpaidMinutes', icon: Dumbbell, accent: '#d9505f' },
  { id: 'balanced', group: 'money', title: { pl: 'Wszechstronny plan', en: 'Well-rounded plan' }, description: { pl: 'Ukończ zadania ze wszystkich 3 kategorii finansowych.', en: 'Complete tasks from all 3 financial categories.' }, reward: { pl: 'Równowaga', en: 'Balance' }, target: 3, metric: 'usedCategories', icon: Target, accent: '#8c7be5', tint: '#f1efff' },
  { id: 'balanced-day', group: 'money', title: { pl: 'Zrównoważony dzień', en: 'Balanced day' }, description: { pl: 'Jednego dnia ukończ coś z każdej z 3 kategorii.', en: 'Complete something from each of the 3 categories in one day.' }, reward: { pl: 'Harmonia', en: 'Harmony' }, target: 1, metric: 'balancedDay', icon: Scale, accent: '#8c7be5' },
  { id: 'balanced-week', group: 'money', title: { pl: 'Zrównoważony tydzień', en: 'Balanced week' }, description: { pl: 'W jednym tygodniu ukończ coś z każdej kategorii.', en: 'Complete something from every category in one week.' }, reward: { pl: 'Pełny obraz', en: 'The full picture' }, target: 1, metric: 'balancedWeek', icon: Shapes, accent: '#7a68d8' },

  // Projekty (7)
  { id: 'project-1', group: 'projects', title: { pl: 'Pierwszy projekt', en: 'First project' }, description: { pl: 'Utwórz pierwszy projekt.', en: 'Create your first project.' }, reward: { pl: 'Cel na horyzoncie', en: 'Goal on the horizon' }, target: 1, metric: 'projects', icon: FolderPlus, accent: '#ff8a57' },
  { id: 'projects-3', group: 'projects', title: { pl: 'Wiele frontów', en: 'On many fronts' }, description: { pl: 'Prowadź 3 projekty.', en: 'Run 3 projects.' }, reward: { pl: 'Szeroka perspektywa', en: 'Broad perspective' }, target: 3, metric: 'projects', icon: FolderKanban, accent: '#f27a48' },
  { id: 'project-complete-1', group: 'projects', title: { pl: 'Projekt domknięty', en: 'Project wrapped up' }, description: { pl: 'Ukończ wszystkie kamienie milowe projektu.', en: 'Complete all milestones of a project.' }, reward: { pl: 'Satysfakcja', en: 'Satisfaction' }, target: 1, metric: 'projectsCompleted', icon: FolderCheck, accent: '#e46a3c' },
  { id: 'milestones-5', group: 'projects', title: { pl: 'Kamienie milowe', en: 'Milestones' }, description: { pl: 'Ukończ 5 kamieni milowych.', en: 'Complete 5 milestones.' }, reward: { pl: 'Widać postęp', en: 'Progress you can see' }, target: 5, metric: 'milestonesDone', icon: Milestone, accent: '#ff9a62' },
  { id: 'milestones-25', group: 'projects', title: { pl: 'Droga do celu', en: 'Road to the goal' }, description: { pl: 'Ukończ 25 kamieni milowych.', en: 'Complete 25 milestones.' }, reward: { pl: 'Wytyczona ścieżka', en: 'A clear path' }, target: 25, metric: 'milestonesDone', icon: Signpost, accent: '#e9844f' },
  { id: 'project-tasks-10', group: 'projects', title: { pl: 'Projekt w ruchu', en: 'Project in motion' }, description: { pl: 'Ukończ 10 zadań przypisanych do projektów.', en: 'Complete 10 tasks assigned to projects.' }, reward: { pl: 'Cel coraz bliżej', en: 'Closer to the goal' }, target: 10, metric: 'projectTasksDone', icon: SquareKanban, accent: '#f5925a' },
  { id: 'subtasks-25', group: 'projects', title: { pl: 'Krok po kroku', en: 'Step by step' }, description: { pl: 'Odhacz 25 podzadań w zadaniach i projektach.', en: 'Check off 25 subtasks in tasks and projects.' }, reward: { pl: 'Małe kroki', en: 'Small steps' }, target: 25, metric: 'subtasksDone', icon: ListTodo, accent: '#ffa26f' },

  // Focus Mode (5)
  { id: 'focus-session-1', group: 'focus', title: { pl: 'Pierwsza sesja Focus', en: 'First Focus session' }, description: { pl: 'Zakończ pierwszą sesję Focus Mode.', en: 'Finish your first Focus Mode session.' }, reward: { pl: 'Tryb skupienia', en: 'In the zone' }, target: 1, metric: 'focusSessions', icon: Headphones, accent: '#5b7fe6' },
  { id: 'focus-sessions-10', group: 'focus', title: { pl: 'Dziesięć sesji Focus', en: 'Ten Focus sessions' }, description: { pl: 'Zakończ 10 sesji Focus Mode.', en: 'Finish 10 Focus Mode sessions.' }, reward: { pl: 'Koncentracja', en: 'Concentration' }, target: 10, metric: 'focusSessions', icon: Brain, accent: '#4d6fd8' },
  { id: 'focus-sessions-50', group: 'focus', title: { pl: 'Sztuka skupienia', en: 'The art of focus' }, description: { pl: 'Zakończ 300 sesji Focus Mode.', en: 'Finish 300 Focus Mode sessions.' }, reward: { pl: 'Umysł jak brzytwa', en: 'Razor-sharp mind' }, target: 300, metric: 'focusSessions', icon: BrainCircuit, accent: '#3f5fc8' },
  { id: 'focus-hours-10', group: 'focus', title: { pl: '100 godzin z Focus', en: '100 hours in Focus' }, description: { pl: 'Przepracuj łącznie 100 godzin w Focus Mode.', en: 'Work a total of 100 hours in Focus Mode.' }, reward: { pl: 'Głęboka koncentracja', en: 'Deep concentration' }, target: 6000, metric: 'focusMinutes', icon: Glasses, accent: '#6a7ff0' },
  { id: 'deep-work-90', group: 'focus', title: { pl: 'Głęboka praca', en: 'Deep work' }, description: { pl: 'Przepracuj 90 minut w jednej sesji Focus.', en: 'Work for 90 minutes in a single Focus session.' }, reward: { pl: 'Stan flow', en: 'Flow state' }, target: 1, metric: 'deepWork', icon: Waves, accent: '#4a68d0' },

  // Doświadczenie (6) — progi dla klucza XP z xp.ts: 1. dzień, tydzień, miesiąc, kwartał, ok. 9 miesięcy, ponad rok.
  { id: 'xp-500', group: 'xp', title: { pl: 'Poziom 2', en: 'Level 2' }, description: { pl: 'Zdobądź 100 XP i wejdź na kolejny poziom.', en: 'Earn 100 XP and reach the next level.' }, reward: { pl: '+ nowa ranga', en: '+ new rank' }, target: 100, metric: 'totalXp', icon: Trophy, accent: '#6a5cff', tint: '#f0edff' },
  { id: 'xp-1000', group: 'xp', title: { pl: 'Tysiąc punktów', en: 'A thousand points' }, description: { pl: 'Zdobądź 1 000 XP.', en: 'Earn 1,000 XP.' }, reward: { pl: 'Nowa energia', en: 'Fresh energy' }, target: 1000, metric: 'totalXp', icon: Gauge, accent: '#8a63f4' },
  { id: 'xp-2000', group: 'xp', title: { pl: 'Łowca doświadczenia', en: 'XP hunter' }, description: { pl: 'Zdobądź 4 000 XP.', en: 'Earn 4,000 XP.' }, reward: { pl: 'Mistrz progresu', en: 'Master of progress' }, target: 4000, metric: 'totalXp', icon: Zap, accent: '#9d6bfa', tint: '#f5ecff' },
  { id: 'xp-5000', group: 'xp', title: { pl: 'Elita Momentum', en: 'Momentum elite' }, description: { pl: 'Zdobądź 12 000 XP.', en: 'Earn 12,000 XP.' }, reward: { pl: 'Elitarna odznaka', en: 'Elite badge' }, target: 12000, metric: 'totalXp', icon: Gem, accent: '#f0ad33', tint: '#fff7e8' },
  { id: 'xp-10000', group: 'xp', title: { pl: 'Diamentowa forma', en: 'Diamond form' }, description: { pl: 'Zdobądź 30 000 XP.', en: 'Earn 30,000 XP.' }, reward: { pl: 'Blask doświadczenia', en: 'Glow of experience' }, target: 30000, metric: 'totalXp', icon: Diamond, accent: '#7a4fe0' },
  { id: 'xp-25000', group: 'xp', title: { pl: 'Orbita Momentum', en: 'Momentum orbit' }, description: { pl: 'Zdobądź 75 000 XP.', en: 'Earn 75,000 XP.' }, reward: { pl: 'Poza skalą', en: 'Off the charts' }, target: 75000, metric: 'totalXp', icon: Orbit, accent: '#5b3fc4' },
];

/**
 * Katalog odznak w kształcie `AchievementDefinition`: `title`, `description` i `reward` to gettery zwracające tekst
 * w bieżącym języku (nie liczymy ich przy imporcie). `buildAchievements` kopiuje je podczas renderu.
 */
export const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = ACHIEVEMENT_CATALOG.map(({ title, description, reward, ...definition }) => ({
  ...definition,
  get title() { return text(title); },
  get description() { return text(description); },
  get reward() { return text(reward); },
}));

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
