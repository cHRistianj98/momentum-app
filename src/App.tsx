import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, BarChart3, CalendarDays, Check, CheckCircle2,
  ChevronRight, Clock3, Focus, LayoutDashboard, Menu, Moon, MoreHorizontal,
  Plus, Upload, FolderKanban, RotateCcw, Search, Settings2, Sparkles, Sun, Target, Trash2, Trophy, X, Zap,
} from 'lucide-react';
import { CalendarView, type CalendarBlock } from './components/CalendarView';
import { MobileMonthView } from './components/MobileMonthView';
import { ResizeConfirmModal } from './components/ResizeConfirmModal';
import { RoutineMoveConfirmModal } from './components/RoutineMoveConfirmModal';
import { TaskModal } from './components/TaskModal';
import { FocusMode, FocusDock } from './components/FocusMode';
import { InsightsView } from './components/InsightsView';
import { WeeklyReview } from './components/WeeklyReview';
import { ProjectsView } from './components/ProjectsView';
import { DataBackup } from './components/DataBackup';
import { NotificationCenter, ReminderBanner } from './components/NotificationCenter';
import { NotificationSettingsPanel } from './components/NotificationSettings';
import { useFocusTimer } from './lib/useFocusTimer';
import { formatFocusClock } from './lib/focus';
import { emptyLog, RoutineEditor, routineOccurs, RoutineSession } from './components/RoutineModal';
import { checkedWithParentPropagation, toggleRoutineStepBranch } from './lib/routineHierarchy';
import { routineStepsOnDate } from './lib/routineStepSchedule';
import { parseRoutineTransfer, replaceRoutineKeepingIdentity } from './lib/routineImport';
import type { RoutineStep } from './types';
import { TaskIcon } from './lib/icons';
import { CategoryBadge, TaskVisual } from './components/VisualIdentity';
import { formatDuration, mondayOf, parseDate, shiftDate, todayKey } from './lib/date';
import { TASK_PRESETS } from './lib/seed';
import { eraseStoredData, resolveCategories, useAppData } from './lib/storage';
import { getOfflineDatabaseStatus, readMomentumKey, saveMomentumKey } from './lib/offlineDatabase';
import { buildAchievements, resolveNextRank, resolveRank, type AchievementView } from './lib/progression';
import { useReminders } from './lib/useReminders';
import { parseOpenTarget, type NotificationFeedItem, type OpenTarget } from './lib/notifications';
import type { CategoryKey, IconKey, Page, Routine, Task, Project } from './types';

const NAV: { id: Page; label: string; icon: typeof CalendarDays }[] = [
  { id: 'overview', label: 'Pulpit', icon: LayoutDashboard },
  { id: 'calendar', label: 'Kalendarz', icon: CalendarDays },
  { id: 'tasks', label: 'Moje zadania', icon: CheckCircle2 },
  { id: 'routines', label: 'Rutyny', icon: RotateCcw },
  { id: 'projects', label: 'Projekty i cele', icon: FolderKanban },
  { id: 'insights', label: 'Statystyki', icon: BarChart3 },
  { id: 'review', label: 'Weekly Review', icon: CalendarDays },
];
const CATEGORY_KEYS: CategoryKey[] = ['unpaid','potential','income'];
const LEVEL_XP = 500;

// XP is a reward for completion: duration sets the base; the category sets its weight.
function automaticXp(duration: number, category: CategoryKey): number {
  const minutes = Math.max(15, Math.min(24 * 60, Number(duration) || 15));
  const multiplier = category === 'income' ? 2 : category === 'potential' ? 1.35 : 0.7;
  return Math.max(5, Math.round((minutes / 15) * 5 * multiplier / 5) * 5);
}


type TaskDialog = { id?: string; date?: string | null; time?: string | null; duration?: number; projectId?: string; milestoneId?: string };
type RoutineDialog = { id: string; date: string; occurrenceDate?: string };
type RoutineEditorDialog = { id?: string };
type PendingResize = { block: CalendarBlock; nextDuration: number };
type PendingRoutineMove = { block: CalendarBlock; date: string; time: string };

function H({ children }: { children: React.ReactNode }) { return <span className="heading-spark">{children}</span>; }

function App() {
  const [data, setData] = useAppData();
  const routineImportRef = useRef<HTMLInputElement>(null);
  const categories = useMemo(() => resolveCategories(data.categories), [data.categories]);
  const [page, setPage] = useState<Page>('overview');
  const [referenceDate, setReferenceDate] = useState(todayKey());
  const [calendarMode, setCalendarMode] = useState<'day' | 'week'>('week');
  const [taskDialog, setTaskDialog] = useState<TaskDialog | null>(null);
  const [routineDialog, setRoutineDialog] = useState<RoutineDialog | null>(null);
  const [editorDialog, setEditorDialog] = useState<RoutineEditorDialog | null>(null);
  const [pendingResize, setPendingResize] = useState<PendingResize | null>(null);
  const [pendingRoutineMove, setPendingRoutineMove] = useState<PendingRoutineMove | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [taskFilter, setTaskFilter] = useState<'all' | 'today' | 'completed'>('all');
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileMore, setMobileMore] = useState(false);
  const [reminderBanner, setReminderBanner] = useState<NotificationFeedItem | null>(null);
  const [weeklyNudge, setWeeklyNudge] = useState(false);
  const focus = useFocusTimer();
  const [focusOpen, setFocusOpen] = useState(false);
  const [achievementQueue, setAchievementQueue] = useState<AchievementView[]>([]);
  const [activeAchievement, setActiveAchievement] = useState<AchievementView | null>(null);
  const [earnedAchievementIds, setEarnedAchievementIds] = useState<string[]>(() => {
    try {
      const parsed: unknown = JSON.parse(readMomentumKey('momentum.earned-achievements') ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch { return []; }
  });
  const searchRef = useRef<HTMLInputElement>(null);
  // Otwiera zadanie lub rutynę wskazane przez powiadomienie (dzwonek, baner albo system).
  const openTarget = (target: OpenTarget) => {
    if (target.kind === 'task') {
      if (data.tasks.some(task => task.id === target.id)) { setRoutineDialog(null); setTaskDialog({ id: target.id }); }
      else setToast('To zadanie zostało już usunięte.');
      return;
    }
    if (!data.routines.some(routine => routine.id === target.id)) { setToast('Ta rutyna została już usunięta.'); return; }
    const displayDate = data.routineLogs[`${target.id}:${target.date}`]?.dateOverride ?? target.date;
    setTaskDialog(null);
    setRoutineDialog({ id: target.id, date: displayDate, occurrenceDate: target.date });
  };
  const openNotificationItem = (item: Pick<NotificationFeedItem, 'kind' | 'sourceId' | 'occurrenceDate'>) => {
    if (item.kind === 'task' && item.sourceId) openTarget({ kind: 'task', id: item.sourceId });
    else if (item.kind === 'routine' && item.sourceId) openTarget({ kind: 'routine', id: item.sourceId, date: item.occurrenceDate ?? todayKey() });
  };
  const reminders = useReminders({ data, setData, onInApp: setReminderBanner, onOpen: openNotificationItem });
  const openTargetRef = useRef(openTarget);
  openTargetRef.current = openTarget;
  // Dotknięcie powiadomienia: ?open=... przy zimnym starcie albo wiadomość z service workera.
  useEffect(() => {
    const openFromUrl = (value: string) => {
      const query = value.includes('?') ? value.slice(value.indexOf('?')) : value;
      const target = parseOpenTarget(new URLSearchParams(query).get('open'));
      if (target) openTargetRef.current(target);
    };
    if (new URLSearchParams(window.location.search).has('open')) {
      openFromUrl(window.location.search);
      const url = new URL(window.location.href);
      url.searchParams.delete('open');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; url?: unknown } | null;
      if (message?.type === 'MOMENTUM_OPEN' && typeof message.url === 'string') openFromUrl(message.url);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);
  const closeReminderBanner = useCallback(() => setReminderBanner(null), []);
  const notificationsActive = reminders.settings.enabled && reminders.support === 'granted';
  const enableNotifications = () => {
    void reminders.enable().then(result => {
      if (result === 'granted') setToast('Powiadomienia włączone');
      else if (result === 'ios-install') setToast('Najpierw dodaj Momentum do ekranu początkowego: Udostępnij → Do ekranu początkowego.');
      else if (result === 'denied') setToast('Powiadomienia są zablokowane w ustawieniach systemu.');
      else if (result === 'insecure') setToast('Powiadomienia wymagają połączenia HTTPS (wersja produkcyjna).');
      else if (result === 'unsupported') setToast('Ta przeglądarka nie obsługuje powiadomień.');
    });
  };
  function applyDefaultReminders() {
    const { taskDefaults, routineDefaults } = reminders.settings;
    setData(prev => ({
      ...prev,
      tasks: prev.tasks.map(task => !task.done && task.date && task.time && !task.reminders?.length && taskDefaults.length ? { ...task, reminders: [...taskDefaults] } : task),
      routines: prev.routines.map(routine => routine.active && !routine.reminders?.length && routineDefaults.length ? { ...routine, reminders: [...routineDefaults] } : routine),
    }));
    setToast('Dodano domyślne przypomnienia');
  }
  const today = todayKey();
  // Niedzielny raport pojawia się raz w tygodniu, gdy aplikacja jest otwarta.
  // Sprawdzamy też zmianę daty i powrót do karty, bez uruchamiania procesów w tle.
  useEffect(() => {
    const checkSunday = () => {
      const localToday = todayKey();
      if (parseDate(localToday).getDay() !== 0) return;
      const key = `momentum.weekly-notice:${mondayOf(localToday)}`;
      try {
        if (readMomentumKey(key) === '1') return;
        saveMomentumKey(key, '1');
      } catch { /* localStorage może być wyłączony */ }
      setWeeklyNudge(true);
    };
    const checkOnReturn = () => { if (document.visibilityState === 'visible') checkSunday(); };
    checkSunday();
    const ticker = window.setInterval(checkSunday, 60_000);
    document.addEventListener('visibilitychange', checkOnReturn);
    return () => { window.clearInterval(ticker); document.removeEventListener('visibilitychange', checkOnReturn); };
  }, []);
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPage('tasks');
        window.requestAnimationFrame(() => searchRef.current?.focus());
      }
      const focused = event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName);
      if (event.key.toLowerCase() === 'n' && !event.metaKey && !event.ctrlKey && !event.altKey && !focused && !taskDialog && !routineDialog && !editorDialog && !settingsOpen) {
        event.preventDefault();
        setTaskDialog({ date: todayKey() });
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [taskDialog, routineDialog, editorDialog, settingsOpen]);
  const todayTasks = data.tasks.filter(t => t.date === today);
  const logFor = (id: string, date: string) => data.routineLogs[`${id}:${date}`] ?? emptyLog(`${id}:${date}`);
  // Dzisiejsza rutyna może pochodzić z innego dnia, jeśli przesunięto jedno wystąpienie.
  const todayOccurrences = useMemo(() => {
    const result: { routine: Routine; occurrenceDate: string }[] = [];
    for (let offset = -45; offset <= 45; offset++) {
      const source = shiftDate(today, offset);
      for (const r of data.routines) {
        const log = data.routineLogs[`${r.id}:${source}`];
        if (!routineOccurs(r, source) && !log?.completed && !log?.checkedStepIds?.length) continue;
        if ((log?.dateOverride ?? source) === today) result.push({ routine: r, occurrenceDate: source });
      }
    }
    return result;
  }, [data.routines, data.routineLogs, today]);
  const dueRoutines = todayOccurrences.filter((entry, index) => todayOccurrences.findIndex(e => e.routine.id === entry.routine.id) === index).map(entry => entry.routine);
  const sourceForToday = (id: string) => todayOccurrences.find(entry => entry.routine.id === id)?.occurrenceDate ?? today;
  const completedToday = todayTasks.filter(t => t.done).length + todayOccurrences.filter(entry => logFor(entry.routine.id, entry.occurrenceDate).completed).length;
  const totalToday = todayTasks.length + todayOccurrences.length;
  const completionPct = totalToday ? Math.round(completedToday/totalToday*100) : 0;
  const totalXp = useMemo(() => data.tasks.filter(t => t.done).reduce((s,t) => s+t.xp,0) + Object.entries(data.routineLogs).reduce((s,[key,log]) => {
    if (!log.completed) return s;
    const routineId = key.split(':')[0];
    return s + (data.routines.find(r => r.id === routineId)?.xp ?? 0);
  },0),[data]);
  const currentLevel = Math.floor(totalXp / LEVEL_XP) + 1;
  const xpIntoLevel = totalXp % LEVEL_XP;
  const xpToday = todayTasks.filter(t=>t.done).reduce((s,t)=>s+t.xp,0) + todayOccurrences.filter(entry => logFor(entry.routine.id, entry.occurrenceDate).completed).reduce((s,entry)=>s+entry.routine.xp,0);
  const focusMinutes = todayTasks.filter(t=>t.done && t.time).reduce((s,t)=>s+t.duration,0) + todayOccurrences.filter(entry => logFor(entry.routine.id, entry.occurrenceDate).completed).reduce((s,entry)=>s+(logFor(entry.routine.id, entry.occurrenceDate).durationOverride ?? entry.routine.duration),0);
  const daysStreak = useMemo(() => {
    // Serie liczymy z ostatnich dni, w których ukończono choć jedno zadanie lub rutynę.
    const dates = new Set([...data.tasks.filter(t=>t.done && t.date).map(t=>t.date!), ...Object.values(data.routineLogs).filter(l=>l.completed).map(l=>l.id.split(':').slice(1).join(':'))]);
    let streak=0, cursor=dates.has(today)?today:shiftDate(today,-1);
    while (dates.has(cursor) && streak<365) {streak++;cursor=shiftDate(cursor,-1);}
    return streak;
  },[data,today]);
  const computedAchievements = useMemo(() => buildAchievements(data, totalXp, daysStreak), [data, totalXp, daysStreak]);
  const achievements = useMemo(() => computedAchievements.map(achievement => {
    const preserved = earnedAchievementIds.includes(achievement.id);
    return {...achievement, unlocked: achievement.unlocked || preserved, progress: preserved ? Math.max(achievement.progress, achievement.target) : achievement.progress};
  }), [computedAchievements, earnedAchievementIds]);
  // An earned badge stays earned even if the user later breaks a streak or edits an old task.
  useEffect(() => {
    const newlyEarned = computedAchievements.filter(a => a.unlocked && !earnedAchievementIds.includes(a.id)).map(a => a.id);
    if (newlyEarned.length) setEarnedAchievementIds(current => [...new Set([...current, ...newlyEarned])]);
  }, [computedAchievements, earnedAchievementIds]);
  useEffect(() => {
    try { saveMomentumKey('momentum.earned-achievements', JSON.stringify(earnedAchievementIds)); }
    catch { /* localStorage unavailable or full: keep achievements in memory */ }
  }, [earnedAchievementIds]);
  const currentRank = useMemo(() => resolveRank(totalXp), [totalXp]);
  const nextRank = useMemo(() => resolveNextRank(totalXp), [totalXp]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storageKey = 'momentum.seen-achievements';
    const migrationKey = 'momentum.achievements.catalog.v042';
    let seenIds: string[] = [];
    try {
      const parsed: unknown = JSON.parse(readMomentumKey(storageKey) ?? '[]');
      seenIds = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch { /* corrupted notification history, not application data */ }
    const seen = new Set<string>(seenIds);
    if (readMomentumKey(migrationKey) !== '1') {
      // Existing achievements are shown as earned but do not flood the screen on upgrade.
      achievements.filter(a => a.unlocked).forEach(a => seen.add(a.id));
      saveMomentumKey(storageKey, JSON.stringify([...seen]));
      saveMomentumKey(migrationKey, '1');
      return;
    }
    const fresh = achievements.filter(achievement => achievement.unlocked && !seen.has(achievement.id));
    if (!fresh.length) return;
    fresh.forEach(achievement => seen.add(achievement.id));
    saveMomentumKey(storageKey, JSON.stringify(Array.from(seen)));
    setAchievementQueue(prev => {
      const merged = [...prev];
      fresh.forEach(achievement => {
        if (activeAchievement?.id === achievement.id || merged.some(item => item.id === achievement.id)) return;
        merged.push(achievement);
      });
      return merged;
    });
  }, [achievements, activeAchievement?.id]);

  useEffect(() => {
    if (activeAchievement || !achievementQueue.length) return;
    const [first, ...rest] = achievementQueue;
    setActiveAchievement(first);
    setAchievementQueue(rest);
  }, [achievementQueue, activeAchievement]);

  useEffect(() => {
    if (!activeAchievement) return;
    const timeout = window.setTimeout(() => setActiveAchievement(null), 5200);
    return () => window.clearTimeout(timeout);
  }, [activeAchievement]);

  function startFocus(taskId: string) {
    const task = data.tasks.find(item => item.id === taskId);
    if (!task) { setToast('Nie znaleziono zadania.'); return; }
    if (focus.active && focus.active.taskId !== taskId) {
      setTaskDialog(null);
      setFocusOpen(true);
      setToast('Najpierw zakończ trwającą sesję Focus.');
      return;
    }
    focus.start(task.id, task.title, task.duration);
    setTaskDialog(null);
    setFocusOpen(true);
  }

  function finishFocus(complete: boolean) {
    const task = focus.active ? data.tasks.find(item => item.id === focus.active?.taskId) : undefined;
    const shouldComplete = complete && Boolean(task);
    const award = shouldComplete && !task?.done ? task!.xp : 0;
    const record = focus.finish(shouldComplete, award);
    if (!record) return;
    if (shouldComplete) {
      setData(previous => ({ ...previous, tasks: previous.tasks.map(item => item.id === record.taskId ? {...item, done: true} : item) }));
    }
    setFocusOpen(false);
    setToast(shouldComplete
      ? `Focus zakończony · ${formatFocusClock(record.focusSeconds)} pracy${award ? ` · +${award} XP` : ''}`
      : `Zapisano ${formatFocusClock(record.focusSeconds)} pracy bez oznaczania zadania.`);
  }

  function toggleTask(id: string) {
    const task=data.tasks.find(t=>t.id===id);
    if (!task) return;
    setData(prev=>({...prev,tasks:prev.tasks.map(t=>t.id===id?{...t,done:!t.done}:t)}));
    setToast(task.done ? 'Zadanie przywrócone do realizacji' : `Świetnie! +${task.xp} XP za „${task.title}”`);
  }
  function saveProject(project: Project) {
    setData(prev => ({...prev, projects: prev.projects.some(item => item.id === project.id)
      ? prev.projects.map(item => item.id === project.id ? project : item)
      : [...prev.projects, project]}));
    setToast('Projekt zapisany');
  }
  function deleteProject(id: string) {
    setData(prev => ({...prev, projects: prev.projects.filter(project => project.id !== id),
      tasks: prev.tasks.map(task => task.projectId === id ? {...task, projectId: null, milestoneId: null} : task)}));
    setToast('Projekt usunięty; powiązane zadania zachowane');
  }
  function linkTaskToProject(taskId: string, projectId: string, milestoneId?: string) {
    setData(prev => ({...prev,tasks:prev.tasks.map(task => task.id === taskId ? {...task,projectId,milestoneId:milestoneId??null} : task)}));
    setToast('Zadanie przypisane do projektu');
  }
  function saveTask(task: Task) {
    const existing=data.tasks.find(t=>t.id===task.id);
    // Duration is initialised in TaskModal from the calendar selection.
    // Respect subsequent changes in the duration picker rather than overwriting on save.
    task = {...task, xp: automaticXp(task.duration, task.category)};
    setData(prev=>({...prev,tasks:existing?prev.tasks.map(t=>t.id===task.id?task:t):[...prev.tasks,task]}));
    setTaskDialog(null);
    setToast(existing && !existing.done && task.done
      ? `Zadanie ukończone! +${task.xp} XP za „${task.title}”`
      : existing && existing.done && !task.done
        ? 'Zadanie przywrócone do realizacji'
        : existing ? 'Zmiany w zadaniu zapisane' : 'Nowe zadanie dodane');
  }
  function deleteTask(id: string) {
    setData(prev=>({...prev,tasks:prev.tasks.filter(t=>t.id!==id)}));
    setTaskDialog(null);setToast('Zadanie usunięte');
  }
  function updateTaskSchedule(id: string, date: string, time: string) {
    const duration = data.tasks.find(t => t.id === id)?.duration ?? 45;
    const [hours, minutes] = time.split(':').map(Number);
    const latestStart = 24 * 60 - duration;
    const startMinutes = Math.max(0, Math.min(hours * 60 + minutes, latestStart));
    const plannedTime = `${String(Math.floor(startMinutes / 60)).padStart(2,'0')}:${String(startMinutes % 60).padStart(2,'0')}`;
    setData(prev=>({...prev,tasks:prev.tasks.map(t=>t.id===id?{...t,date,time:plannedTime}:t)}));
    setToast(`Przeniesiono zadanie na ${plannedTime}`);
  }
  function saveRoutine(routine: Routine) {
    setData(prev=>({
      ...prev,
      routines:prev.routines.some(r=>r.id===routine.id)?prev.routines.map(r=>r.id===routine.id?routine:r):[...prev.routines,routine],
      routineLogs:Object.fromEntries(Object.entries(prev.routineLogs).map(([key,log])=>
        key.startsWith(`${routine.id}:`)
          ? [key,{...log,checkedStepIds:checkedWithParentPropagation(routine.steps,log.checkedStepIds)}]
          : [key,log])),
    }));
    setEditorDialog(null);setRoutineDialog(null);setToast('Rutyna zapisana');
  }
  async function importRoutineFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const incoming = parseRoutineTransfer(await file.text());
      const normalize = (title: string) => title.trim().toLocaleLowerCase('pl');
      // If the user already has a morning routine (even named "Poranny start"), propose replacing it.
      const existing = data.routines.find(r => r.id === incoming.id)
        ?? data.routines.find(r => normalize(r.title) === normalize(incoming.title))
        ?? (/porann/i.test(incoming.title) ? data.routines.find(r => /porann/i.test(r.title)) : undefined);
      const message = existing
        ? `Zastąpić szablon „${existing.title}” nową rutyną „${incoming.title}” (${incoming.steps.length} kroków, ${incoming.time}, ${incoming.duration} min)?\n\nPozostałe dane i historia zostają zachowane. Zrób wcześniej backup JSON.`
        : `Dodać rutynę „${incoming.title}” (${incoming.steps.length} kroków, ${incoming.time}, ${incoming.duration} min)?\n\nPozostałe dane nie zostaną zmienione.`;
      if (!window.confirm(message)) return;
      const merged = existing ? replaceRoutineKeepingIdentity(existing, incoming) : incoming;
      setData(previous => ({
        ...previous,
        routines: existing
          ? previous.routines.map(r => r.id === existing.id ? merged : r)
          : [...previous.routines, merged],
      }));
      setToast(`Wczytano rutynę: ${merged.title} (${merged.steps.length} kroków)`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Nie udało się wczytać rutyny.');
    }
  }
  function deleteRoutine(id: string) {
    setData(prev=>({...prev,routines:prev.routines.filter(r=>r.id!==id),routineLogs:Object.fromEntries(Object.entries(prev.routineLogs).filter(([key])=>!key.startsWith(`${id}:`)))}));
    setEditorDialog(null);setRoutineDialog(null);setToast('Rutyna usunięta');
  }
  function updateRoutineLog(id: string, date: string, fn: (log: ReturnType<typeof emptyLog>) => ReturnType<typeof emptyLog>) {
    const key=`${id}:${date}`;
    setData(prev=>({...prev,routineLogs:{...prev.routineLogs,[key]:fn(prev.routineLogs[key]??emptyLog(key))}}));
  }
  function toggleRoutineStep(id: string,date: string,stepId: string, displayDate: string = date) {
    const routine = data.routines.find(r=>r.id===id);
    if (!routine) return;
    const activeSteps = routineStepsOnDate(routine.steps, displayDate);
    if (!activeSteps.some(step => step.id === stepId)) return;
    updateRoutineLog(id,date,log=>({...log,checkedStepIds:toggleRoutineStepBranch(activeSteps, log.checkedStepIds, stepId)}));
  }
  function changeRoutineSteps(id: string, steps: RoutineStep[]) {
    setData(prev => ({
      ...prev,
      routines: prev.routines.map(r=>r.id===id?{...r,steps}:r),
      routineLogs: Object.fromEntries(Object.entries(prev.routineLogs).map(([key,log])=>
        key.startsWith(`${id}:`)
          ? [key,{...log,checkedStepIds:checkedWithParentPropagation(steps,log.checkedStepIds)}]
          : [key,log])),
    }));
  }
  function completeRoutine(id: string,date: string, displayDate: string = date) {
    const routine=data.routines.find(r=>r.id===id);if(!routine)return;
    const log=logFor(id,date);
    const activeSteps = routineStepsOnDate(routine.steps, displayDate);
    if (log.completed || activeSteps.length === 0 || activeSteps.some(s=>!log.checkedStepIds.includes(s.id))) return;
    updateRoutineLog(id,date,l=>({...l,completed:true,completedAt:new Date().toISOString()}));
    setRoutineDialog(null);
    setToast(`Rutyna zakończona! +${routine.xp} XP`);
  }
  function resizeBlock(block: CalendarBlock, nextDuration: number) {
    if (nextDuration === block.duration) return;
    if (block.kind === 'task') {
      setData(prev => ({...prev, tasks: prev.tasks.map(t => t.id === block.sourceId ? {...t, duration: nextDuration} : t)}));
      setToast(`Czas „${block.title}” zmieniony na ${formatDuration(nextDuration)}`);
    } else {
      // Rutyna ma wiele wystąpień — wybór zakresu zmiany należy do użytkownika.
      setPendingResize({ block, nextDuration });
    }
  }
  function confirmResize(scope: 'single' | 'all') {
    if (!pendingResize) return;
    const { block, nextDuration } = pendingResize;
    if (scope === 'single') {
      const key = `${block.sourceId}:${block.occurrenceDate ?? block.date}`;
      setData(prev => {
        const template = prev.routines.find(r => r.id === block.sourceId);
        if (!template) return prev;
        const log = prev.routineLogs[key] ?? emptyLog(key);
        // Nie twórz wyjątku, jeśli ustawiono ponownie długość z szablonu.
        const updated = { ...log };
        delete updated.durationOverride;
        if (nextDuration !== template.duration) updated.durationOverride = nextDuration;
        return {...prev, routineLogs: {...prev.routineLogs, [key]: updated}};
      });
      setToast(`Zmieniono czas rutyny tylko na ${block.date}`);
    } else {
      setData(prev => ({
        ...prev,
        routines: prev.routines.map(r => r.id === block.sourceId ? {...r, duration: nextDuration} : r),
        routineLogs: Object.fromEntries(Object.entries(prev.routineLogs).map(([key, log]) => {
          if (!key.startsWith(`${block.sourceId}:`)) return [key, log];
          const updated = { ...log };
          delete updated.durationOverride;
          return [key, updated];
        })),
      }));
      setToast(`Zmieniono czas wszystkich wystąpień „${block.title}”`);
    }
    setPendingResize(null);
  }

  function moveRoutine(kind: 'task' | 'routine', id: string, date: string, time: string, occurrenceDate?: string) {
    if (kind === 'task') { updateTaskSchedule(id, date, time); return; }
    const block = calendarBlocks.find(b => b.kind === 'routine' && b.sourceId === id &&
      (b.occurrenceDate ?? b.date) === occurrenceDate);
    if (!block) return;
    if (block.date === date && block.time === time) return;
    setPendingRoutineMove({ block, date, time });
  }
  function confirmRoutineMove(scope: 'single' | 'all') {
    if (!pendingRoutineMove) return;
    const { block, date, time } = pendingRoutineMove;
    const sourceDate = block.occurrenceDate ?? block.date;
    if (scope === 'single') {
      const key = `${block.sourceId}:${sourceDate}`;
      setData(prev => {
        const template = prev.routines.find(r => r.id === block.sourceId);
        if (!template) return prev;
        const updated = { ...(prev.routineLogs[key] ?? emptyLog(key)) };
        delete updated.dateOverride;
        delete updated.timeOverride;
        if (date !== sourceDate) updated.dateOverride = date;
        if (time !== template.time) updated.timeOverride = time;
        return { ...prev, routineLogs: { ...prev.routineLogs, [key]: updated } };
      });
      setToast(`Przeniesiono tylko wystąpienie „${block.title}”`);
    } else {
      const fromWeekday = new Date(`${sourceDate}T12:00:00`).getDay();
      const toWeekday = new Date(`${date}T12:00:00`).getDay();
      const delta = (toWeekday - fromWeekday + 7) % 7;
      setData(prev => ({
        ...prev,
        routines: prev.routines.map(r => r.id === block.sourceId ? {
          ...r, time, weekdays: r.weekdays.map(day => (day + delta) % 7).sort((a,b) => a-b),
        } : r),
        routineLogs: Object.fromEntries(Object.entries(prev.routineLogs).map(([key, log]) => {
          if (!key.startsWith(`${block.sourceId}:`)) return [key, log];
          const updated = { ...log };
          delete updated.dateOverride;
          delete updated.timeOverride;
          return [key, updated];
        })),
      }));
      setToast(`Zaktualizowano harmonogram całej rutyny „${block.title}”`);
    }
    setPendingRoutineMove(null);
  }

  function openBlock(block: CalendarBlock) {
    if (block.kind==='task')setTaskDialog({id:block.sourceId});
    else setRoutineDialog({id:block.sourceId,date:block.date,occurrenceDate:block.occurrenceDate ?? block.date});
  }
  function toggleBlock(block:CalendarBlock) {
    if(block.kind==='task')toggleTask(block.sourceId);
    else setRoutineDialog({id:block.sourceId,date:block.date,occurrenceDate:block.occurrenceDate ?? block.date});
  }
  const calendarBlocks: CalendarBlock[] = useMemo(() => {
    const blocks: CalendarBlock[] = data.tasks.filter(t=>t.date && t.time).map(t=>({id:t.id,kind:'task',sourceId:t.id,title:t.title,icon:t.icon,image:t.image,category:t.category,date:t.date!,time:t.time!,duration:t.duration,done:t.done}));
    // Wirtualne wystąpienia rutyn: jeden szablon, osobny log każdego dnia.
    for (let offset=-45;offset<=45;offset++) {
      const d=shiftDate(referenceDate,offset);
      for(const r of data.routines) {
        const log = data.routineLogs[`${r.id}:${d}`];
        if (!routineOccurs(r,d) && !log?.completed && !log?.checkedStepIds?.length) continue;
        blocks.push({id:`routine:${r.id}:${d}`,kind:'routine',sourceId:r.id,title:r.title,icon:r.icon,image:r.image,category:r.category,
          occurrenceDate:d, date:log?.dateOverride ?? d, time:log?.timeOverride ?? r.time,
          duration:log?.durationOverride ?? r.duration,done:!!log?.completed});
      }
    }
    return blocks;
  },[data,referenceDate]);

  const upcomingTasks = data.tasks.filter(t=>!t.done && (t.date === today || !t.date)).sort((a,b)=>{
    if(a.date&&!b.date)return -1;if(!a.date&&b.date)return 1;
    if(a.time&&!b.time)return -1;if(!a.time&&b.time)return 1;
    return (a.time??'').localeCompare(b.time??'');
  });

  function goPage(id:Page){
    setPage(id);
    setMobileNav(false);
    setMobileMore(false);
    // Na małym ekranie pierwszy widok tygodnia jest trudny do obsługi.
    // Użytkownik może potem sam przełączyć kalendarz z powrotem na tydzień.
    if (id === 'calendar' && typeof window !== 'undefined' && window.matchMedia('(max-width: 620px)').matches) {
      setCalendarMode('day');
    }
    window.scrollTo(0, 0);
  }
  function addPreset(title:string,category:CategoryKey,icon:IconKey,duration:number,_xp:number){
    saveTask({id:crypto.randomUUID(),title,description:'',category,icon,date:null,time:null,duration,xp:automaticXp(duration,category),done:false,createdAt:new Date().toISOString()});
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar--open':''}`}>
      <div className="brand"><div className="brand-mark"><Zap size={23} fill="currentColor" /></div><div><div className="brand-name">momentum<span>.</span></div><div className="brand-subtitle">MAKE EVERY DAY COUNT</div></div><button className="mobile-close" onClick={()=>setMobileNav(false)}><X size={20}/></button></div>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Nawigacja">
        {NAV.map(n=><button key={n.id} className={`nav-item ${page===n.id?'active':''}`} onClick={()=>goPage(n.id)}><n.icon size={19} strokeWidth={1.9}/><span>{n.label}</span>{n.id==='tasks'&&data.tasks.filter(t=>!t.done).length>0&&<span className="nav-count">{data.tasks.filter(t=>!t.done).length}</span>}</button>)}
      </nav>
      <div className="sidebar-divider"/>
      <div className="sidebar-label-row"><span className="sidebar-section-label">TWOJE KATEGORIE</span><button className="tiny-icon-btn" aria-label="Dostosuj kategorie" onClick={()=>setSettingsOpen(true)}><Settings2 size={15}/></button></div>
      <div className="category-sidebar">{CATEGORY_KEYS.map(c=><div key={c} className="sidebar-category"><span className="category-dot" style={{background:categories[c].color}}/>{categories[c].label}</div>)}</div>
      <div className="sidebar-spacer"/>
      <div className="sidebar-level-card"><div className="level-card-top"><div className="level-orb"><Trophy size={20}/></div><div><span>TWÓJ POZIOM</span><strong>Level {currentLevel}</strong></div><Sparkles size={17} className="level-twinkle"/></div><div className="level-progress"><div style={{width:`${xpIntoLevel/LEVEL_XP*100}%`}} /></div><div className="level-card-sub"><span>{xpIntoLevel} / {LEVEL_XP} XP</span><span>Do awansu <ArrowUpRight size={13}/></span></div></div>
      <button className="sidebar-settings" onClick={()=>setSettingsOpen(true)}><Settings2 size={18}/> Ustawienia <ChevronRight size={15}/></button>
      <div className="sidebar-foot">Momentum v0.5.2 <span>✦</span> Made for progress</div>
    </aside>
    {mobileNav && <button className="sidebar-scrim" aria-label="Zamknij menu" onClick={()=>setMobileNav(false)}/>}
    <div className="app-workspace">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-btn" aria-label="Otwórz menu" onClick={()=>setMobileNav(true)}><Menu size={21}/></button><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14}/><strong>{NAV.find(n=>n.id===page)?.label}</strong></div></div><div className="topbar-right"><label className="global-search"><Search size={17}/><input ref={searchRef} aria-label="Szukaj zadań" placeholder="Szukaj zadań..." value={search} onChange={e=>{setSearch(e.target.value);if(e.target.value)goPage('tasks');}}/><span>⌘ K</span></label><button className="icon-btn theme-btn" aria-label="Przełącz motyw" title="Zmień motyw" onClick={()=>setData(p=>({...p,theme:p.theme==='light'?'dark':'light'}))}>{data.theme==='light'?<Moon size={19}/>:<Sun size={19}/>}</button><NotificationCenter api={reminders} data={data} onOpenItem={openNotificationItem} onOpenSettings={()=>setSettingsOpen(true)} onOpenPanel={closeReminderBanner}/><div className="topbar-avatar">M</div></div></header>
      <main className="main-content">
        {page==='overview' && <div className="overview-page">
          <div className="overview-block overview-block--heading"><div className="welcome-heading"><div><div className="eyebrow eyebrow--indigo">TWOJA PRZESTRZEŃ DO DZIAŁANIA <Sparkles size={13}/></div><h1>Twój dzień. <H>Twój progres.</H></h1><p>Każdy mały krok przybliża Cię do większego celu. Działaj po swojemu.</p></div><button className="btn btn--primary add-top" onClick={()=>setTaskDialog({date:today})}><Plus size={18}/> Nowe zadanie</button></div></div>
          <div className="overview-block overview-block--schedule"><div className="content-split overview-schedule-layout"><CalendarView referenceDate={referenceDate} onChangeDate={setReferenceDate} blocks={calendarBlocks} categories={categories} mode="day" onChangeMode={m=>{if(m==='week')goPage('calendar');setCalendarMode(m);}} onAddAt={(date,time,duration)=>setTaskDialog({date,time,duration})} onOpenBlock={openBlock} onFocusBlock={block=>startFocus(block.sourceId)} onToggleBlock={toggleBlock} onDropBlock={moveRoutine} onResizeBlock={resizeBlock} compact/></div></div><div className="overview-block overview-block--todo"><div className="overview-todo-heading"><h2>Do zrobienia i rutyny</h2><button type="button" onClick={()=>goPage('tasks')}>Wszystkie zadania <ArrowRight size={15}/></button></div><RightPanel upcoming={upcomingTasks} routines={dueRoutines} logFor={r=>logFor(r.id,sourceForToday(r.id))} categories={categories} onTask={t=>setTaskDialog({id:t.id})} onToggle={toggleTask} onAdd={()=>setTaskDialog({date:today})} onRoutine={r=>setRoutineDialog({id:r.id,date:today,occurrenceDate:sourceForToday(r.id)})} onPreset={addPreset}/></div>
          <div className="overview-block overview-block--review"><button type="button" className="wr-dashboard-link" onClick={()=>goPage('review')}><span className="wr-dashboard-icon"><CalendarDays size={20}/></span><span><strong>Twój tygodniowy przegląd jest pod ręką</strong><small>Wykonane zadania, rutyny, zmierzony czas i plan kolejnego tygodnia.</small></span><ArrowRight size={18}/></button></div>
          <div className="overview-block overview-block--stats"><div className="stats-grid"><StatCard label="Ukończone dzisiaj" main={`${completedToday} / ${totalToday}`} detail={`${completionPct}% dzisiejszego planu`} icon={CheckCircle2} iconClass="mint" progress={completionPct}/><StatCard label="Czas w skupieniu" main={formatDuration(focusMinutes)} detail="Ukończone bloki czasowe" icon={Focus} iconClass="purple"/><StatCard label="Zdobyte doświadczenie" main={`+${xpToday} XP`} detail={`Poziom ${currentLevel} · ${LEVEL_XP-xpIntoLevel} XP do awansu`} icon={Zap} iconClass="amber"/></div></div>
          <div className="overview-block overview-block--hero"><section className="welcome-banner"><div className="welcome-banner-content"><div className="banner-tag"><span/> TWOJA PODRÓŻ TRWA</div><h2>Masz dziś wszystko,<br/>żeby zrobić coś wielkiego<span>.</span></h2><p>Skup się na tym, co ma znaczenie. Resztą zajmie się Momentum.</p><button onClick={()=>{goPage('calendar');setCalendarMode('day');setReferenceDate(today);}}>Zaplanuj swój dzień <ArrowRight size={16}/></button></div><div className="hero-illustration" aria-hidden="true"><div className="hero-orbit hero-orbit--1"/><div className="hero-orbit hero-orbit--2"/><div className="hero-main-orb"><Zap size={76} strokeWidth={1.3} fill="currentColor"/></div><div className="hero-star star-a">✦</div><div className="hero-star star-b">✧</div><div className="hero-mini-card"><span>✦</span> +{xpToday} XP today <ArrowUpRight size={15}/></div><div className="hero-chip">LEVEL {currentLevel}</div></div></section></div>
        </div>}
        {page==='calendar'&&<><MobileMonthView referenceDate={referenceDate} onChangeDate={setReferenceDate} blocks={calendarBlocks} categories={categories} onOpenDate={date=>{setReferenceDate(date);goPage('overview');setCalendarMode('day');}}/><PageHeading kicker="TWÓJ CZAS MA ZNACZENIE" title="Kalendarz" accent=" & timeblocking" description="Zaplanuj dzień, przeciągaj zadania między godzinami i obserwuj swój progres. Kliknij puste miejsce, aby dodać blok."/><div className="calendar-page-layout"><CalendarView referenceDate={referenceDate} onChangeDate={setReferenceDate} blocks={calendarBlocks} categories={categories} mode={calendarMode} onChangeMode={setCalendarMode} onAddAt={(date,time,duration)=>setTaskDialog({date,time,duration})} onOpenBlock={openBlock} onFocusBlock={block=>startFocus(block.sourceId)} onToggleBlock={toggleBlock} onDropBlock={moveRoutine} onResizeBlock={resizeBlock}/><RightPanel upcoming={upcomingTasks} routines={dueRoutines} logFor={r=>logFor(r.id,sourceForToday(r.id))} categories={categories} onTask={t=>setTaskDialog({id:t.id})} onToggle={toggleTask} onAdd={()=>setTaskDialog({date:today})} onRoutine={r=>setRoutineDialog({id:r.id,date:today,occurrenceDate:sourceForToday(r.id)})} onPreset={addPreset}/></div></>}
        {page==='tasks'&&<><PageHeading kicker="MAŁE KROKI, WIELKIE EFEKTY" title="Moje" accent=" zadania" description="Wszystkie Twoje zadania w jednym miejscu. Zaplanuj je lub zrealizuj od razu." action={<button className="btn btn--primary" onClick={()=>setTaskDialog({})}><Plus size={18}/> Dodaj zadanie</button>}/><div className="tasks-page"><div className="task-filters">{([{id:'all',label:'Wszystkie'},{id:'today',label:'Na dzisiaj'},{id:'completed',label:'Ukończone'}] as const).map(f=><button key={f.id} className={taskFilter===f.id?'active':''} onClick={()=>setTaskFilter(f.id)}>{f.label}</button>)}</div><TaskGroups tasks={data.tasks.filter(t=>(!search||t.title.toLocaleLowerCase('pl-PL').includes(search.toLocaleLowerCase('pl-PL')))&&(taskFilter==='all'||(taskFilter==='today'&&t.date===today)||(taskFilter==='completed'&&t.done)))} categories={categories} projects={data.projects} onEdit={t=>setTaskDialog({id:t.id})} onToggle={toggleTask} onAdd={()=>setTaskDialog({})}/></div></>}
        {page==='routines'&&<><PageHeading kicker="KONSEKWENCJA TWORZY NAWYKI" title="Twoje" accent=" rutyny" description="Jeden prosty rytuał, wiele małych zwycięstw. Kończ wszystkie kroki jednym kliknięciem." action={<button className="btn btn--primary" onClick={()=>setEditorDialog({})}><Plus size={18}/> Nowa rutyna</button>}/><div className="routine-import-bar"><input ref={routineImportRef} type="file" accept=".json,application/json" hidden onChange={importRoutineFile}/><button type="button" className="btn btn--secondary" onClick={()=>routineImportRef.current?.click()}><Upload size={16}/> Wczytaj rutynę z pliku</button><small>Import dotyczy tylko jednej rutyny — pozostałe dane nie zostaną zastąpione.</small></div><div className="routines-intro"><div><span>✦ CODZIENNY RYTM</span><h3>Nie musisz robić wszystkiego naraz.</h3><p>Zaznacz kolejne kroki, a po zakończeniu rutyny zaktualizujemy kalendarz i XP automatycznie.</p></div><div className="routine-intro-ornament">☼</div></div><div className="routine-cards">{data.routines.map(r=>{const occurs=dueRoutines.some(item=>item.id===r.id),log=logFor(r.id,sourceForToday(r.id)),style=(categories[r.category] ?? categories.unpaid);const todaysSteps=routineStepsOnDate(r.steps,today);const checkedCount=todaysSteps.filter(s=>log.checkedStepIds.includes(s.id)).length;return <button key={r.id} className="routine-card" onClick={()=>setRoutineDialog({id:r.id,date:today,occurrenceDate:sourceForToday(r.id)})}><TaskVisual icon={r.icon} image={r.image} category={r.category} categories={categories} size="large" className="routine-icon-large"/><div className="routine-card-top"><span className="routine-card-frequency">{r.weekdays.length===7?'Codziennie':`${r.weekdays.length} dni w tygodniu`}</span><CategoryBadge category={r.category} categories={categories} compact/></div><h3>{r.title}</h3><p>{r.description}</p><div className="routine-mini-stats"><span><Clock3 size={15}/> {r.time} · {r.duration} min</span><span><Zap size={14}/> +{r.xp} XP</span></div><div className="routine-card-progress"><div><span style={{width:`${checkedCount/Math.max(todaysSteps.length,1)*100}%`,background:style.color}}/></div><small>{log.completed?'Zakończona ✓':!occurs?'Poza planem na dziś':`${checkedCount}/${todaysSteps.length} kroków`}</small></div><div className="routine-card-cta">{log.completed?'Zobacz ukończoną': 'Otwórz rutynę'} <ArrowRight size={15}/></div></button>;})}<button className="routine-card routine-card--add" onClick={()=>setEditorDialog({})}><span><Plus size={27}/></span><strong>Stwórz własną rutynę</strong><p>Dodaj kroki, harmonogram i nagrodę XP.</p></button></div></>}
        {page==='projects'&&<><div className="projects-mobile-heading"><PageHeading kicker="WIELKIE CELE · MAŁE KROKI" title="Projekty" accent=" & cele" description="Łącz zadania, kamienie milowe i checklisty w jedną drogę do celu."/></div><ProjectsView projects={data.projects} tasks={data.tasks} categories={categories} onSaveProject={saveProject} onDeleteProject={deleteProject} onToggleTask={toggleTask} onOpenTask={id=>setTaskDialog({id})} onCreateTask={(projectId,milestoneId)=>setTaskDialog({projectId,milestoneId})} onLinkTask={linkTaskToProject}/></>}
        {page==='review'&&<><PageHeading kicker="CO TYDZIEŃ O KROK DALEJ" title="Weekly" accent=" Review" description="Podsumuj ostatni tydzień, zobacz, co zadziałało, i zaplanuj następny bez presji."/><WeeklyReview data={data} focusHistory={focus.history} onOpenNextWeek={monday=>{setReferenceDate(monday);setCalendarMode('week');goPage('calendar');}}/></>}
        {page==='insights'&&<><PageHeading kicker="POSTĘP TO SUMA MAŁYCH KROKÓW" title="Twoje" accent=" statystyki" description="Zobacz, gdzie inwestujesz swój czas i jak rośnie Twoja regularność."/><InsightsView data={data} totalXp={totalXp} currentLevel={currentLevel} levelXp={LEVEL_XP} streak={daysStreak} achievements={achievements} rank={currentRank} nextRank={nextRank} focusHistory={focus.history}/></>}
        <footer className="main-footer"><span>✦ Momentum — małe kroki, wielki progres.</span><span>Wersja demonstracyjna · dane lokalne</span></footer>
      </main>
    </div>
    {pendingRoutineMove&&<RoutineMoveConfirmModal title={pendingRoutineMove.block.title}
      previousDate={pendingRoutineMove.block.date} previousTime={pendingRoutineMove.block.time}
      targetDate={pendingRoutineMove.date} targetTime={pendingRoutineMove.time}
      shiftsWeekdays={new Date(`${pendingRoutineMove.block.occurrenceDate ?? pendingRoutineMove.block.date}T12:00:00`).getDay() !== new Date(`${pendingRoutineMove.date}T12:00:00`).getDay()}
      onOnlyThis={()=>confirmRoutineMove('single')} onAll={()=>confirmRoutineMove('all')} onCancel={()=>setPendingRoutineMove(null)}/>}
    {pendingResize&&<ResizeConfirmModal title={pendingResize.block.title} date={pendingResize.block.date} time={pendingResize.block.time} previousDuration={pendingResize.block.duration} nextDuration={pendingResize.nextDuration} onOnlyThis={()=>confirmResize('single')} onAll={()=>confirmResize('all')} onCancel={()=>setPendingResize(null)}/>}
    {taskDialog&&<TaskModal task={taskDialog.id?data.tasks.find(t=>t.id===taskDialog.id):undefined} initialDate={taskDialog.date} initialTime={taskDialog.time} initialDuration={taskDialog.duration} initialProjectId={taskDialog.projectId} initialMilestoneId={taskDialog.milestoneId} projects={data.projects} categories={categories} focusSeconds={focus.history.filter(record=>record.taskId===taskDialog.id).reduce((sum,record)=>sum+record.focusSeconds,0)} defaultReminders={reminders.settings.taskDefaults} notificationsEnabled={notificationsActive} onEnableNotifications={enableNotifications} onFocus={startFocus} onSave={saveTask} onDelete={deleteTask} onClose={()=>setTaskDialog(null)}/>}
    {routineDialog&&(()=>{const r=data.routines.find(x=>x.id===routineDialog.id);return r?<RoutineSession routine={r} date={routineDialog.date} log={logFor(r.id,routineDialog.occurrenceDate ?? routineDialog.date)} duration={logFor(r.id,routineDialog.occurrenceDate ?? routineDialog.date).durationOverride ?? r.duration} displayTime={logFor(r.id,routineDialog.occurrenceDate ?? routineDialog.date).timeOverride ?? r.time} categoryColor={(categories[r.category] ?? categories.unpaid).color} categories={categories} onToggleStep={step=>toggleRoutineStep(r.id,routineDialog.occurrenceDate ?? routineDialog.date,step,routineDialog.date)} onChangeSteps={steps=>changeRoutineSteps(r.id,steps)} onComplete={()=>completeRoutine(r.id,routineDialog.occurrenceDate ?? routineDialog.date,routineDialog.date)} onUndo={()=>updateRoutineLog(r.id,routineDialog.occurrenceDate ?? routineDialog.date,l=>({...l,completed:false,completedAt:undefined}))} onEdit={()=>{setEditorDialog({id:r.id});setRoutineDialog(null);}} onDelete={()=>deleteRoutine(r.id)} onClose={()=>setRoutineDialog(null)}/>:null;})()}
    {editorDialog&&<RoutineEditor routine={editorDialog.id?data.routines.find(r=>r.id===editorDialog.id):undefined} categories={categories} defaultReminders={reminders.settings.routineDefaults} notificationsEnabled={notificationsActive} onEnableNotifications={enableNotifications} onSave={saveRoutine} onDelete={deleteRoutine} onClose={()=>setEditorDialog(null)}/>}
    {settingsOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSettingsOpen(false);}}><div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Ustawienia"><div className="modal-heading"><div><span className="eyebrow">DOSTOSUJ MOMENTUM</span><h2>Ustawienia</h2></div><button className="icon-btn" onClick={()=>setSettingsOpen(false)} aria-label="Zamknij"><X size={20}/></button></div><p className="settings-desc">Trzy kategorie określają związek aktywności z przychodem — nie jej wartość dla zdrowia czy samopoczucia. Możesz zmieniać ich kolory.</p><div className="settings-colors">{CATEGORY_KEYS.map(c=><div className="settings-color-row" key={c}><label className="color-input-wrap" title="Wybierz kolor"><input type="color" value={categories[c].color} onChange={e=>setData(prev=>({...prev,categories:{...prev.categories,[c]:{...categories[c],color:e.target.value}}}))}/></label><div><strong>{categories[c].label}</strong><span>{categories[c].description}</span></div><span>{categories[c].color.toUpperCase()}</span></div>)}</div><div className="settings-divider"/><label className="theme-setting"><div><strong>Wygląd aplikacji</strong><small>Przełącz jasny i ciemny motyw.</small></div><button className="btn btn--secondary" onClick={()=>setData(p=>({...p,theme:p.theme==='light'?'dark':'light'}))}>{data.theme==='light'?<Moon size={16}/>:<Sun size={16}/>} {data.theme==='light'?'Ciemny':'Jasny'}</button></label><div className="settings-divider"/><NotificationSettingsPanel api={reminders} data={data} onChange={settings=>setData(prev=>({...prev,notifications:settings}))} onApplyDefaults={applyDefaultReminders}/><div className="settings-divider"/><DataBackup data={data}/><div className="settings-divider"/><div className="danger-zone"><div><strong>Wyczyść dane demo</strong><small>Przywróci przykładowe zadania, rutyny i kolory.</small></div><button className="btn btn--danger" onClick={()=>{if(window.confirm('Zresetować wszystkie dane do początkowych?')){void eraseStoredData().then(()=>window.location.reload()).catch(()=>window.alert('Nie udało się zresetować danych. Spróbuj ponownie.'));}}}><Trash2 size={15}/> Resetuj</button></div><div className="modal-bottom"><small>{getOfflineDatabaseStatus() === 'ready' ? 'Dane lokalne: IndexedDB + kopia zgodności. Zapisuj backup JSON poza telefonem.' : 'Zapis lokalny: localStorage. IndexedDB niedostępne — zrób backup JSON.'}</small><button className="btn btn--primary" onClick={()=>setSettingsOpen(false)}>Gotowe</button></div></div></div>}
    {weeklyNudge && <div className="wr-notice" role="dialog" aria-label="Tygodniowe podsumowanie">
      <span className="wr-notice-icon"><Trophy size={22}/></span>
      <div><span className="eyebrow eyebrow--indigo">NIEDZIELNY PRZEGLĄD</span><strong>Twój tydzień w pigułce</strong><small>Postępy, rutyny, czas i pomysły na następne dni.</small><button type="button" onClick={()=>{setWeeklyNudge(false);goPage('review');}}>Zobacz raport <ArrowRight size={14}/></button></div>
      <button type="button" className="wr-notice-close" onClick={()=>setWeeklyNudge(false)} title="Zamknij" aria-label="Zamknij powiadomienie"><X size={17}/></button>
    </div>}
    {focus.active && !focusOpen && <><FocusDock title={focus.active.taskTitle} seconds={Math.floor(focus.elapsed.focusMs/1000)} phase={focus.active.phase} onOpen={()=>setFocusOpen(true)}/><button type="button" className="focus-dock-stop" onClick={()=>finishFocus(false)} title="Zakończ Focus bez kończenia zadania" aria-label="Wyłącz aktywną sesję Focus">Wyłącz Focus ×</button></>}
    {focus.active && focusOpen && <FocusMode task={data.tasks.find(task=>task.id===focus.active?.taskId)} session={focus.active} history={focus.history} focusMs={focus.elapsed.focusMs} breakMs={focus.elapsed.breakMs} breakElapsedMs={focus.breakElapsed} categories={categories} onPhase={focus.setPhase} onFinish={finishFocus} onClose={()=>setFocusOpen(false)}/>}
    {activeAchievement&&<AchievementPopup achievement={activeAchievement} onClose={()=>setActiveAchievement(null)}/>}
    {reminderBanner&&<ReminderBanner item={reminderBanner} onClose={closeReminderBanner} onOpen={()=>{reminders.markRead(reminderBanner.id);openNotificationItem(reminderBanner);setReminderBanner(null);}}/>}
    {toast&&<div className="toast" role="status"><span><Sparkles size={17}/></span>{toast}<button onClick={()=>setToast('')} aria-label="Zamknij"><X size={15}/></button></div>}
    {mobileMore && <>
      <button className="mobile-more-scrim" type="button" aria-label="Zamknij dodatkowe menu" onClick={()=>setMobileMore(false)} />
      <nav className="mobile-more-sheet" aria-label="Pozostałe moduły Momentum">
        <div className="mobile-more-heading"><strong>Twoje Momentum</strong><button type="button" aria-label="Zamknij menu" onClick={()=>setMobileMore(false)}><X size={20}/></button></div>
        {NAV.filter(n => !(['overview','calendar','tasks','projects'] as Page[]).includes(n.id)).map(n =>
          <button key={n.id} type="button" onClick={()=>goPage(n.id)} className={page===n.id?'active':''}>
            <n.icon size={21}/><span>{n.label}</span><ChevronRight size={16}/>
          </button>
        )}
        <button type="button" onClick={()=>{setMobileMore(false);setSettingsOpen(true);}}><Settings2 size={21}/><span>Ustawienia i kopie danych</span><ChevronRight size={16}/></button>
      </nav>
    </>}
    {(page === 'overview' || page === 'calendar' || page === 'tasks') && <button type="button" className="momentum-mobile-fab" onClick={()=>setTaskDialog({date:referenceDate})} aria-label="Nowe zadanie" title="Dodaj zadanie"><Plus size={28}/></button>}
    {page === 'routines' && <button type="button" className="momentum-mobile-fab" onClick={()=>setEditorDialog({})} aria-label="Nowa rutyna" title="Dodaj rutynę"><Plus size={28}/></button>}
    <nav className="mobile-bottom-nav" aria-label="Główna nawigacja mobilna">
      {NAV.filter(n => (['overview','calendar','tasks','projects'] as Page[]).includes(n.id)).map(n =>
        <button key={n.id} type="button" className={page===n.id?'active':''} onClick={()=>goPage(n.id)} aria-current={page===n.id?'page':undefined}>
          <n.icon size={21}/><span>{n.id==='overview'?'Pulpit':n.id==='calendar'?'Kalendarz':n.id==='tasks'?'Zadania':'Projekty'}</span>
        </button>
      )}
      <button type="button" className={mobileMore || (['routines','insights','review'] as Page[]).includes(page) ? 'active' : ''} onClick={()=>setMobileMore(prev=>!prev)} aria-expanded={mobileMore} aria-label="Więcej funkcji">
        <Menu size={21}/><span>Więcej</span>
      </button>
    </nav>
  </div>;
}

function StatCard({label,main,detail,icon:Icon,iconClass,progress}:{label:string;main:string;detail:string;icon:typeof CheckCircle2;iconClass:string;progress?:number}){
  return <div className="stat-card"><div className="stat-card-header"><span>{label}</span><div className={`stat-card-icon ${iconClass}`}><Icon size={20}/></div></div><strong>{main}</strong><div className="stat-detail">{progress!==undefined?<span className="stat-bullet">↗</span>:<ArrowUpRight size={14}/>} {detail}</div>{progress!==undefined&&<div className="stat-progress"><span style={{width:`${progress}%`}}/></div>}</div>;
}
function PageHeading({kicker,title,accent,description,action}:{kicker:string;title:string;accent:string;description:string;action?:React.ReactNode}){
  return <div className="page-heading"><div><div className="eyebrow eyebrow--indigo">{kicker} <Sparkles size={13}/></div><h1>{title}<H>{accent}</H></h1><p>{description}</p></div>{action}</div>;
}
function RightPanel({upcoming,routines,logFor,categories,onTask,onToggle,onAdd,onRoutine,onPreset}:{upcoming:Task[];routines:Routine[];logFor:(r:Routine)=>ReturnType<typeof emptyLog>;categories:ReturnType<typeof useAppData>[0]['categories'];onTask:(t:Task)=>void;onToggle:(id:string)=>void;onAdd:()=>void;onRoutine:(r:Routine)=>void;onPreset:(title:string,category:CategoryKey,icon:IconKey,duration:number,xp:number)=>void}) {
  const currentItems=upcoming.slice(0,5);
  return <aside className="right-panel"><div className="right-panel-header"><div><span className="eyebrow">TWÓJ DZISIEJSZY PLAN</span><h3>Do zrobienia <span>✦</span></h3></div><button className="tiny-icon-btn" title="Dodaj zadanie" onClick={onAdd}><Plus size={18}/></button></div><div className="mini-task-list">{currentItems.length?currentItems.map(t=>{return <div key={t.id} className="mini-task" draggable title="Przeciągnij na kalendarz, aby zaplanować" onDragStart={e=>{const payload=JSON.stringify({kind:'task',id:t.id,sourceDate:t.date});e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/momentum',payload);e.dataTransfer.setData('text/plain',payload);}}><button className={`task-checkbox ${t.done?'checked':''}`} aria-label="Ukończ zadanie" onClick={()=>onToggle(t.id)}><Check size={13}/></button><button className="mini-task-icon-btn" onClick={()=>onTask(t)} aria-label="Otwórz zadanie"><TaskVisual icon={t.icon} image={t.image} category={t.category} categories={categories} size="mini"/></button><button className="mini-task-main" onClick={()=>onTask(t)}><strong>{t.title}</strong><small>{t.time??(t.date?'Bez godziny':'Inbox')} · +{t.xp} XP</small><CategoryBadge category={t.category} categories={categories} compact/></button><ChevronRight size={14}/></div>}):<div className="empty-tasks"><CheckCircle2 size={26}/><strong>Wszystko gotowe!</strong><span>Dodaj zadanie, kiedy masz nowy plan.</span></div>}</div><button className="right-link" onClick={onAdd}><Plus size={15}/> Dodaj zadanie</button><div className="right-divider"/><div className="right-panel-header"><div><span className="eyebrow">CODZIENNE NAWYKI</span><h3>Moje rutyny</h3></div><span className="right-badge">{routines.length}</span></div><div className="mini-routines">{routines.map(r=>{const log=logFor(r),isDone=log.completed;return <button key={r.id} className="mini-routine" onClick={()=>onRoutine(r)}><TaskVisual icon={r.icon} image={r.image} category={r.category} categories={categories} size="small" className="mini-routine-icon"/><span><strong>{r.title}</strong><small>{isDone?'Ukończona ✓':`${routineStepsOnDate(r.steps,todayKey()).filter(s=>log.checkedStepIds.includes(s.id)).length}/${routineStepsOnDate(r.steps,todayKey()).length} kroków · +${r.xp} XP`}</small><CategoryBadge category={r.category} categories={categories} compact/></span><ArrowUpRight size={16}/></button>;})}</div><div className="right-divider"/><div className="quick-section"><div className="eyebrow">JEDNYM KLIKNIĘCIEM</div><h3>Szybkie dodawanie</h3><div className="quick-presets">{TASK_PRESETS.slice(1,5).map(p=><button key={p.title} onClick={()=>onPreset(p.title,p.category,p.icon,p.duration,p.xp)}><TaskIcon name={p.icon} size={14}/>{p.title}<Plus size={14}/></button>)}</div></div><div className="right-tip"><Sparkles size={19}/><p><strong>Małe kroki się liczą.</strong><br/>Nie musisz zrobić wszystkiego. Najważniejsze to ruszyć naprzód.</p></div></aside>;
}
function TaskGroups({tasks,categories,projects,onEdit,onToggle,onAdd}:{tasks:Task[];projects:Project[];categories:ReturnType<typeof useAppData>[0]['categories'];onEdit:(t:Task)=>void;onToggle:(id:string)=>void;onAdd:()=>void}){
  const today=todayKey();
  const groups=[{title:'Dzisiaj',items:tasks.filter(t=>t.date===today)},{title:'Do zaplanowania',items:tasks.filter(t=>!t.date)},{title:'Zaplanowane na inne dni',items:tasks.filter(t=>t.date&&t.date!==today)}];
  return <div className="task-groups">{groups.filter(g=>g.items.length>0).map(group=><section className="task-group" key={group.title}><div className="task-group-heading"><h3>{group.title}<span>{group.items.length}</span></h3></div><div className="task-rows">{group.items.sort((a,b)=>(a.date??'').localeCompare(b.date??'')||(a.time??'z').localeCompare(b.time??'z')).map(t=>{return <div className={`task-row ${t.done?'task-row--done':''}`} key={t.id}><button className={`task-checkbox ${t.done?'checked':''}`} aria-label="Zmień status" onClick={()=>onToggle(t.id)}><Check size={16}/></button><button className="task-row-icon" onClick={()=>onEdit(t)}><TaskVisual icon={t.icon} image={t.image} category={t.category} categories={categories} size="medium"/></button><button className="task-row-body" onClick={()=>onEdit(t)}><strong>{t.title}</strong><span className="task-row-sub"><CategoryBadge category={t.category} categories={categories} compact/>{t.date&&<span className="task-row-meta">{t.date===today?'Dzisiaj':t.date}</span>}{t.time&&<span className="task-row-meta task-row-time">{t.time}</span>}{t.projectId&&<span className="task-row-project"><FolderKanban size={12}/>{projects.find(p=>p.id===t.projectId)?.title??"Projekt"}</span>}</span></button><div className="task-row-xp"><Zap size={14}/> {t.xp} XP</div><button className="task-row-edit" onClick={()=>onEdit(t)} title="Edytuj"><MoreHorizontal size={20}/></button></div>})}</div></section>)}{tasks.length===0&&<div className="empty-list"><Target size={38}/><h3>Tu jest miejsce na nowe pomysły.</h3><p>Dodaj zadanie, zaplanuj termin i ruszaj po swoje.</p><button className="btn btn--primary" onClick={onAdd}><Plus size={17}/> Dodaj pierwsze zadanie</button></div>}</div>;
}
function AchievementPopup({ achievement, onClose }: { achievement: AchievementView; onClose: () => void }) {
  const Icon = achievement.icon;
  return <div className="achievement-popup" role="dialog" aria-live="polite">
    <div className="achievement-popup-confetti" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => <span key={index} style={{ '--i': index } as React.CSSProperties} />)}
    </div>
    <button className="achievement-popup-close" aria-label="Zamknij powiadomienie" onClick={onClose}><X size={16} /></button>
    <div className="achievement-popup-art" style={{ '--achievement-accent': achievement.accent, '--achievement-tint': achievement.tint } as React.CSSProperties}>
      <img src={achievement.art} alt="" loading="lazy" />
      <span className="achievement-popup-art-badge"><Icon size={16} /></span>
    </div>
    <div className="achievement-popup-body">
      <span className="eyebrow eyebrow--indigo">NOWE OSIĄGNIĘCIE</span>
      <h3>{achievement.title}</h3>
      <p>{achievement.description}</p>
      <div className="achievement-popup-reward">{achievement.reward}</div>
    </div>
  </div>;
}

export default App;
