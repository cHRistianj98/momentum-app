import { Award, CalendarDays, CheckCircle2, Clock3, Crown, Flame, Focus, Gem, Moon, Rocket, ShieldCheck, Sparkles, Star, Sun, Target, Trophy, Wallet, Zap } from 'lucide-react';
import type { AppData, CategoryKey } from '../types';

/** Rangi, poziomy i osiągnięcia liczone wyłącznie z ukończonych zadań i rutyn. */
export type AchievementView = {
  id: string;
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

export function buildAchievements(data: AppData, totalXp: number, streak: number): AchievementView[] {
  const completedTasks = data.tasks.filter(task => task.done).length;
  const completedRoutineSessions = Object.values(data.routineLogs).filter(log => log.completed).length;
  const completedMinutes = data.tasks.filter(task => task.done).reduce((sum, task) => sum + task.duration, 0) + Object.entries(data.routineLogs).reduce((sum, [key, log]) => {
    if (!log.completed) return sum;
    const routineId = key.split(':')[0];
    const routine = data.routines.find(item => item.id === routineId);
    return sum + (log.durationOverride ?? routine?.duration ?? 0);
  }, 0);
  const scheduledTasks = data.tasks.filter(task => !!task.time).length;
  const activeDays = new Set([
    ...data.tasks.filter(task => task.done && task.date).map(task => task.date!),
    ...Object.entries(data.routineLogs).filter(([, log]) => log.completed).map(([key]) => key.split(':').slice(1).join(':')),
  ]).size;
  const completedTaskList = data.tasks.filter(task => task.done);
  const completedRoutineLogs = Object.entries(data.routineLogs).filter(([, log]) => log.completed);
  const categoryTaskList = (category: CategoryKey) => completedTaskList.filter(task => task.category === category);
  const incomeMinutes = categoryTaskList('income').reduce((sum, task) => sum + task.duration, 0) + completedRoutineLogs.reduce((sum, [key, log]) => {
    const routine = data.routines.find(r => key.startsWith(`${r.id}:`));
    return sum + (routine?.category === 'income' ? (log.durationOverride ?? routine.duration) : 0);
  }, 0);
  const potentialMinutes = categoryTaskList('potential').reduce((sum, task) => sum + task.duration, 0) + completedRoutineLogs.reduce((sum, [key, log]) => {
    const routine = data.routines.find(r => key.startsWith(`${r.id}:`));
    return sum + (routine?.category === 'potential' ? (log.durationOverride ?? routine.duration) : 0);
  }, 0);
  const completedCount = completedTasks + completedRoutineSessions;
  const morningCount = completedTaskList.filter(task => task.time && Number(task.time.slice(0, 2)) < 9).length;
  const eveningCount = completedTaskList.filter(task => task.time && Number(task.time.slice(0, 2)) >= 20).length;
  const incomeCount = categoryTaskList('income').length;
  const usedCategories = new Set([
    ...completedTaskList.map(task => task.category),
    ...completedRoutineLogs.map(([key]) => data.routines.find(r => key.startsWith(`${r.id}:`))?.category).filter((key): key is CategoryKey => !!key),
  ]).size;
  return [
    { id: 'first-step', title: 'Pierwszy krok', description: 'Ukończ pierwsze zadanie albo rutynę.', reward: '+ motywacja', progress: completedTasks + completedRoutineSessions, target: 1, unlocked: completedTasks + completedRoutineSessions >= 1, icon: Award, accent: '#7f72ff', tint: '#f2efff', art: '/assets/progression/ach-first-step.svg' },
    { id: 'xp-500', title: 'Poziom 2', description: 'Zdobądź 500 XP i wejdź na kolejny poziom.', reward: '+ nowa ranga', progress: totalXp, target: 500, unlocked: totalXp >= 500, icon: Trophy, accent: '#6a5cff', tint: '#f0edff', art: '/assets/progression/ach-xp-500.svg' },
    { id: 'streak-3', title: 'Seria 3 dni', description: 'Utrzymaj ciągłość działania przez 3 dni.', reward: '+ ogień serii', progress: streak, target: 3, unlocked: streak >= 3, icon: Flame, accent: '#ff7d73', tint: '#fff0ef', art: '/assets/progression/ach-streak-3.svg' },
    { id: 'focus-180', title: '3 godziny skupienia', description: 'Ukończ łącznie co najmniej 180 minut zaplanowanych bloków.', reward: '+ fokus', progress: completedMinutes, target: 180, unlocked: completedMinutes >= 180, icon: Target, accent: '#4e97ff', tint: '#edf4ff', art: '/assets/progression/ach-focus-180.svg' },
    { id: 'planner-10', title: 'Planista', description: 'Nadaj godzinę przynajmniej 10 zadaniom.', reward: '+ kontrola planu', progress: scheduledTasks, target: 10, unlocked: scheduledTasks >= 10, icon: CalendarDays, accent: '#a564ff', tint: '#f5efff', art: '/assets/progression/ach-planner-10.svg' },
    { id: 'income-120', title: 'Monetyzacja', description: 'Ukończ 120 minut zadań przynoszących przychód.', reward: '+ złota odznaka', progress: incomeMinutes, target: 120, unlocked: incomeMinutes >= 120, icon: Wallet, accent: '#1ca36f', tint: '#eaf8f1', art: '/assets/progression/ach-income-120.svg' },
    { id: 'active-7', title: 'Tydzień progresu', description: 'Bądź aktywny w 7 różnych dniach.', reward: '+ wytrwałość', progress: activeDays, target: 7, unlocked: activeDays >= 7, icon: Star, accent: '#f0a52f', tint: '#fff8e8', art: '/assets/progression/ach-active-7.svg' },
    { id: 'tasks-5', title: 'Dobry początek', description: 'Ukończ 5 zadań.', reward: 'Małe zwycięstwa', progress: completedTasks, target: 5, unlocked: completedTasks >= 5, icon: CheckCircle2, accent: '#7f72ff', tint: '#f2efff', art: '/assets/progression/ach-tasks-5.svg' },
    { id: 'tasks-25', title: 'Maszyna do działania', description: 'Ukończ 25 zadań.', reward: 'Systematyczność', progress: completedTasks, target: 25, unlocked: completedTasks >= 25, icon: ShieldCheck, accent: '#5d8ef7', tint: '#edf3ff', art: '/assets/progression/ach-tasks-25.svg' },
    { id: 'tasks-100', title: 'Setka sukcesów', description: 'Ukończ 100 zadań.', reward: 'Legenda działania', progress: completedTasks, target: 100, unlocked: completedTasks >= 100, icon: Trophy, accent: '#d9a535', tint: '#fff8e5', art: '/assets/progression/ach-tasks-100.svg' },
    { id: 'xp-2000', title: 'Łowca doświadczenia', description: 'Zdobądź 2 000 XP.', reward: 'Mistrz progresu', progress: totalXp, target: 2000, unlocked: totalXp >= 2000, icon: Zap, accent: '#9d6bfa', tint: '#f5ecff', art: '/assets/progression/ach-xp-2000.svg' },
    { id: 'xp-5000', title: 'Elita Momentum', description: 'Zdobądź 5 000 XP.', reward: 'Elitarna odznaka', progress: totalXp, target: 5000, unlocked: totalXp >= 5000, icon: Gem, accent: '#f0ad33', tint: '#fff7e8', art: '/assets/progression/ach-xp-5000.svg' },
    { id: 'routines-1', title: 'Pierwszy rytuał', description: 'Ukończ pierwszą całą rutynę.', reward: 'Moc nawyków', progress: completedRoutineSessions, target: 1, unlocked: completedRoutineSessions >= 1, icon: Sparkles, accent: '#bd76f5', tint: '#f9edff', art: '/assets/progression/ach-routines-1.svg' },
    { id: 'routines-10', title: 'Żelazny nawyk', description: 'Zakończ 10 rutyn.', reward: 'Dyscyplina', progress: completedRoutineSessions, target: 10, unlocked: completedRoutineSessions >= 10, icon: ShieldCheck, accent: '#45a4c8', tint: '#ebfaff', art: '/assets/progression/ach-routines-10.svg' },
    { id: 'routines-50', title: 'Mistrz rutyn', description: 'Zakończ 50 rutyn.', reward: 'Wewnętrzna siła', progress: completedRoutineSessions, target: 50, unlocked: completedRoutineSessions >= 50, icon: Crown, accent: '#4bb992', tint: '#eafaf4', art: '/assets/progression/ach-routines-50.svg' },
    { id: 'streak-7', title: 'Tydzień bez przerwy', description: 'Utrzymaj serię przez 7 kolejnych dni.', reward: 'Płomień', progress: streak, target: 7, unlocked: streak >= 7, icon: Flame, accent: '#ff816d', tint: '#fff1ed', art: '/assets/progression/ach-streak-7.svg' },
    { id: 'streak-30', title: 'Miesiąc determinacji', description: 'Utrzymaj serię przez 30 kolejnych dni.', reward: 'Nieustępliwość', progress: streak, target: 30, unlocked: streak >= 30, icon: Flame, accent: '#e96987', tint: '#fff0f3', art: '/assets/progression/ach-streak-30.svg' },
    { id: 'focus-1200', title: '20 godzin skupienia', description: 'Ukończ 20 godzin zaplanowanego działania.', reward: 'Koncentracja', progress: completedMinutes, target: 1200, unlocked: completedMinutes >= 1200, icon: Focus, accent: '#629eeb', tint: '#eef6ff', art: '/assets/progression/ach-focus-1200.svg' },
    { id: 'focus-6000', title: '100 godzin progresu', description: 'Ukończ 100 godzin działania.', reward: 'Długofalowy progres', progress: completedMinutes, target: 6000, unlocked: completedMinutes >= 6000, icon: Clock3, accent: '#467bd9', tint: '#eef3ff', art: '/assets/progression/ach-focus-6000.svg' },
    { id: 'planner-50', title: 'Architekt czasu', description: 'Zaplanuj godzinę dla 50 zadań.', reward: 'Świetne planowanie', progress: scheduledTasks, target: 50, unlocked: scheduledTasks >= 50, icon: CalendarDays, accent: '#ae7ff3', tint: '#f6efff', art: '/assets/progression/ach-planner-50.svg' },
    { id: 'income-1500', title: '25 godzin zarobkowych', description: 'Ukończ 25 godzin działań dających przychód.', reward: 'Rozwój finansowy', progress: incomeMinutes, target: 1500, unlocked: incomeMinutes >= 1500, icon: Wallet, accent: '#1da67c', tint: '#eaf9f3', art: '/assets/progression/ach-income-1500.svg' },
    { id: 'income-10', title: 'Pracowity tydzień', description: 'Ukończ 10 zadań przynoszących przychód.', reward: 'Zarabianie', progress: incomeCount, target: 10, unlocked: incomeCount >= 10, icon: Wallet, accent: '#46b875', tint: '#ebfaf2', art: '/assets/progression/ach-income-10.svg' },
    { id: 'potential-300', title: 'Inwestycja w przyszłość', description: 'Poświęć 5 godzin na działania z potencjalnym przychodem.', reward: 'Budowanie przyszłości', progress: potentialMinutes, target: 300, unlocked: potentialMinutes >= 300, icon: Rocket, accent: '#e3a32b', tint: '#fff8e8', art: '/assets/progression/ach-potential-300.svg' },
    { id: 'active-30', title: '30 dni na mapie', description: 'Zrealizuj coś w 30 różnych dniach.', reward: 'Stały rozwój', progress: activeDays, target: 30, unlocked: activeDays >= 30, icon: Star, accent: '#e7ad4c', tint: '#fff7e9', art: '/assets/progression/ach-active-30.svg' },
    { id: 'balanced', title: 'Wszechstronny plan', description: 'Ukończ zadania ze wszystkich 3 kategorii finansowych.', reward: 'Równowaga', progress: usedCategories, target: 3, unlocked: usedCategories >= 3, icon: Target, accent: '#8c7be5', tint: '#f1efff', art: '/assets/progression/ach-balanced.svg' },
    { id: 'morning-5', title: 'Ranny ptaszek', description: 'Ukończ 5 zadań zaplanowanych przed 9:00.', reward: 'Dobry poranek', progress: morningCount, target: 5, unlocked: morningCount >= 5, icon: Sun, accent: '#e7a23d', tint: '#fff5e8', art: '/assets/progression/ach-morning-5.svg' },
    { id: 'evening-5', title: 'Nocny strateg', description: 'Ukończ 5 zadań zaplanowanych po 20:00.', reward: 'Wieczorny fokus', progress: eveningCount, target: 5, unlocked: eveningCount >= 5, icon: Moon, accent: '#7783c8', tint: '#eef0ff', art: '/assets/progression/ach-evening-5.svg' },
    { id: 'completions-150', title: 'Nie do zatrzymania', description: 'Ukończ 150 zadań lub wykonań rutyn.', reward: 'Wielkie osiągnięcie', progress: completedCount, target: 150, unlocked: completedCount >= 150, icon: Trophy, accent: '#bb86e7', tint: '#f6efff', art: '/assets/progression/ach-completions-150.svg' },
  ];
}
