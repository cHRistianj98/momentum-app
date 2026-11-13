import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, BarChart3, CalendarDays, Check, CheckCircle2,
  ChevronRight, Focus, LayoutDashboard, Menu, Moon, MoreHorizontal,
  Plus, Upload, FolderKanban, Repeat2, RotateCcw, Search, Settings2, Sparkles, Sun, Target, Trash2, Trophy, X, Zap,
} from 'lucide-react';
import { CalendarView, type CalendarBlock } from './components/CalendarView';
import { MobileMonthView } from './components/MobileMonthView';
import { ResizeConfirmModal } from './components/ResizeConfirmModal';
import { RoutineMoveConfirmModal } from './components/RoutineMoveConfirmModal';
import { TaskModal, type SeriesOccurrence, type SeriesSaveOptions } from './components/TaskModal';
import { FocusMode, FocusDock } from './components/FocusMode';
import { InsightsView } from './components/InsightsView';
import { RoutineCard } from './components/RoutineCard';
import { WeeklyReview } from './components/WeeklyReview';
import { ProjectsView } from './components/ProjectsView';
import { DataBackup } from './components/DataBackup';
import { CLOUD_SYNC_PANEL_ID, CloudSyncBanner, CloudSyncPanel } from './components/CloudSyncPanel';
import { NotificationCenter, ReminderBanner } from './components/NotificationCenter';
import { NotificationSettingsPanel } from './components/NotificationSettings';
import { useFocusTimer } from './lib/useFocusTimer';
import { formatFocusClock, snapshot } from './lib/focus';
import { emptyLog, RoutineEditor, RoutineSession } from './components/RoutineModal';
import { checkedWithParentPropagation, toggleRoutineStepBranch } from './lib/routineHierarchy';
import { routineStepsOnDate } from './lib/routineStepSchedule';
import { parseRoutineTransfer, replaceRoutineKeepingIdentity } from './lib/routineImport';
import { describeRepeat, isTaskSeries, nextOccurrence, occurrenceExists, shiftSeries, shortDayLabel, skippedOccurrences } from './lib/recurrence';
import type { RoutineLog, RoutineStep } from './types';
import { TaskIcon } from './lib/icons';
import { CategoryBadge, TaskVisual } from './components/VisualIdentity';
import { formatDuration, mondayOf, parseDate, shiftDate, todayKey } from './lib/date';
import { TASK_PRESETS } from './lib/seed';
import { eraseStoredData, resolveCategories, useAppData } from './lib/storage';
import { getOfflineDatabaseStatus, readMomentumKey, saveMomentumKey } from './lib/offlineDatabase';
import { buildAchievements, resolveNextRank, resolveRank, type AchievementView } from './lib/progression';
import { buildXpLedger, focusXp, levelInfo, occurrenceXp, routineXp, sumXp, taskXp } from './lib/xp';
import { playStepTimerSound, resetStepTimer, useStepTimerRuntime } from './lib/stepTimer';
import { LANGUAGES, applyLanguage, count, formatNumber, isLanguage, plural, tr, type Language } from './lib/i18n';
import { useReminders } from './lib/useReminders';
import { useCloudSync } from './lib/useCloudSync';
import { usePushNotifications } from './lib/push';
import { parseOpenTarget, type NotificationFeedItem, type OpenTarget } from './lib/notifications';
import type { CategoryKey, IconKey, Page, Routine, Task, Project } from './types';

// Etykiety jako gettery — tekst w bieżącym języku powstaje przy renderze, nie przy imporcie modułu.
const NAV: { id: Page; label: string; icon: typeof CalendarDays }[] = [
  { id: 'overview', get label() { return tr('Pulpit', 'Dashboard'); }, icon: LayoutDashboard },
  { id: 'calendar', get label() { return tr('Kalendarz', 'Calendar'); }, icon: CalendarDays },
  { id: 'tasks', get label() { return tr('Moje zadania', 'My tasks'); }, icon: CheckCircle2 },
  { id: 'routines', get label() { return tr('Rutyny', 'Routines'); }, icon: RotateCcw },
  { id: 'projects', get label() { return tr('Projekty i cele', 'Projects & goals'); }, icon: FolderKanban },
  { id: 'insights', get label() { return tr('Statystyki', 'Insights'); }, icon: BarChart3 },
  { id: 'review', label: 'Weekly Review', icon: CalendarDays },
];
const CATEGORY_KEYS: CategoryKey[] = ['unpaid','potential','income'];

/** Okno zadania; `seriesId` otwiera zadanie cykliczne (z wystąpieniem `occurrenceDate` albo całą serię). */
type TaskDialog = { id?: string; date?: string | null; time?: string | null; duration?: number; projectId?: string; milestoneId?: string; seriesId?: string; occurrenceDate?: string };
type RoutineDialog = { id: string; date: string; occurrenceDate?: string };
type RoutineEditorDialog = { id?: string };
type PendingResize = { block: CalendarBlock; nextDuration: number };
type PendingRoutineMove = { block: CalendarBlock; date: string; time: string };
/** Wystąpienie zadania cyklicznego zaplanowane na dziś (lista „Do zrobienia” i „Moje zadania”). */
type SeriesToday = { routine: Routine; occurrenceDate: string; time: string; done: boolean; /** XP za to wystąpienie (z uwzględnieniem zmienionej długości). */ xp: number };
/** Pozycja listy „Do zrobienia”: zwykłe zadanie albo dzisiejsze wystąpienie zadania cyklicznego. */
type TodoEntry = { type: 'task'; task: Task } | ({ type: 'series' } & SeriesToday);
/** Opis opcji „Wszystkie wystąpienia” przy przeciąganiu serii dziennej lub miesięcznej (tygodniowa ma opis domyślny). */
function seriesMoveHint(routine: Routine | undefined, date: string, time: string): string | undefined {
  const rule = isTaskSeries(routine) ? routine?.repeat : undefined;
  if (!rule || rule.every === 'week') return undefined;
  if (rule.every === 'month') return tr(`Cała seria: ${Number(date.slice(8, 10))}. dnia miesiąca o ${time}. `, `Whole series: day ${Number(date.slice(8, 10))} of every month at ${time}. `);
  return rule.interval > 1 ? tr(`Cała seria przesunie się na nowy dzień, o ${time}. `, `The whole series moves to the new day at ${time}. `) : tr(`Cała seria: codziennie o ${time}. `, `Whole series: every day at ${time}. `);
}

function H({ children }: { children: React.ReactNode }) { return <span className="heading-spark">{children}</span>; }

/** Odhaczenie kroku, ukończenie albo przeniesienie usuniętego wystąpienia przywraca je do planu. */
function unskipped(log: RoutineLog): RoutineLog {
  if (!log.skipped) return log;
  const restored = { ...log };
  delete restored.skipped;
  return restored;
}

function App() {
  const [data, setData] = useAppData();
  // Język ustawiamy przed renderem dzieci — tr() w całym drzewie i w funkcjach pomocniczych zwraca już nowy tekst.
  const language: Language = isLanguage(data.language) ? data.language : 'pl';
  applyLanguage(language);
  const routineImportRef = useRef<HTMLInputElement>(null);
  const categories = useMemo(() => resolveCategories(data.categories), [data.categories, language]);
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
  /** Akcja przypięta do konkretnego komunikatu — znika, gdy pojawi się inny. */
  const [toastAction, setToastAction] = useState<{ message: string; label: string; run: () => void } | null>(null);
  const showToast = (message: string, action?: { label: string; run: () => void }) => {
    setToast(message);
    setToastAction(action ? { message, ...action } : null);
  };
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
      else setToast(tr('To zadanie zostało już usunięte.', 'This task has already been deleted.'));
      return;
    }
    const routine = data.routines.find(item => item.id === target.id);
    if (!routine) { setToast(tr('Ta rutyna została już usunięta.', 'This routine has already been deleted.')); return; }
    if (isTaskSeries(routine)) {
      setRoutineDialog(null);
      setTaskDialog({ seriesId: routine.id, occurrenceDate: target.date });
      return;
    }
    const displayDate = data.routineLogs[`${target.id}:${target.date}`]?.dateOverride ?? target.date;
    setTaskDialog(null);
    setRoutineDialog({ id: target.id, date: displayDate, occurrenceDate: target.date });
  };
  const openNotificationItem = (item: Pick<NotificationFeedItem, 'kind' | 'sourceId' | 'occurrenceDate'>) => {
    if (item.kind === 'task' && item.sourceId) openTarget({ kind: 'task', id: item.sourceId });
    else if (item.kind === 'routine' && item.sourceId) openTarget({ kind: 'routine', id: item.sourceId, date: item.occurrenceDate ?? todayKey() });
  };
  const reminders = useReminders({ data, setData, onInApp: setReminderBanner, onOpen: openNotificationItem });
  // Synchronizacja w chmurze — dopóki nie zostanie włączona na urządzeniu, nie wykonuje żadnych żądań.
  const cloudSync = useCloudSync();
  // Komunikat po scaleniu zmian z innego urządzenia albo po przywróceniu wersji z historii.
  useEffect(() => {
    const notice = cloudSync.engine.takeNotice();
    if (notice) setToast(notice);
  }, [cloudSync.engine]);
  // Powiadomienia z serwera (także przy zamkniętej aplikacji); lista wspólna dla konta synchronizacji.
  const push = usePushNotifications(data, cloudSync.state.enabled ? cloudSync.state.code : null);
  const openCloudSyncSettings = () => {
    setSettingsOpen(true);
    window.setTimeout(() => document.getElementById(CLOUD_SYNC_PANEL_ID)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80);
  };
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
      if (result === 'granted') setToast(tr('Powiadomienia włączone', 'Notifications turned on'));
      else if (result === 'ios-install') setToast(tr('Najpierw dodaj Momentum do ekranu początkowego: Udostępnij → Do ekranu początkowego.', 'First add Momentum to your Home Screen: Share → Add to Home Screen.'));
      else if (result === 'denied') setToast(tr('Powiadomienia są zablokowane w ustawieniach systemu.', 'Notifications are blocked in your system settings.'));
      else if (result === 'insecure') setToast(tr('Powiadomienia wymagają połączenia HTTPS (wersja produkcyjna).', 'Notifications require an HTTPS connection (production version).'));
      else if (result === 'unsupported') setToast(tr('Ta przeglądarka nie obsługuje powiadomień.', 'This browser doesn’t support notifications.'));
    });
  };
  function applyDefaultReminders() {
    const { taskDefaults, routineDefaults } = reminders.settings;
    setData(prev => ({
      ...prev,
      tasks: prev.tasks.map(task => !task.done && task.date && task.time && !task.reminders?.length && taskDefaults.length ? { ...task, reminders: [...taskDefaults] } : task),
      // Zadania cykliczne dostają domyślne przypomnienia zadań, a rutyny — rutyn.
      routines: prev.routines.map(routine => {
        const defaults = isTaskSeries(routine) ? taskDefaults : routineDefaults;
        return routine.active && !routine.reminders?.length && defaults.length ? { ...routine, reminders: [...defaults] } : routine;
      }),
    }));
    setToast(tr('Dodano domyślne przypomnienia', 'Default reminders added'));
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
        if (!occurrenceExists(r, source, log)) continue;
        if ((log?.dateOverride ?? source) === today) result.push({ routine: r, occurrenceDate: source });
      }
    }
    return result;
  }, [data.routines, data.routineLogs, today]);
  // Rutyny (z krokami) i zadania cykliczne korzystają z tych samych wystąpień, ale żyją w innych listach.
  const routineOccurrencesToday = todayOccurrences.filter(entry => !isTaskSeries(entry.routine));
  const seriesToday: SeriesToday[] = todayOccurrences.filter(entry => isTaskSeries(entry.routine)).map(({ routine, occurrenceDate }) => {
    const log = data.routineLogs[`${routine.id}:${occurrenceDate}`];
    return { routine, occurrenceDate, time: log?.timeOverride ?? routine.time, done: Boolean(log?.completed), xp: taskXp(log?.durationOverride ?? routine.duration, routine.category) };
  });
  const dueRoutines = routineOccurrencesToday.filter((entry, index) => routineOccurrencesToday.findIndex(e => e.routine.id === entry.routine.id) === index).map(entry => entry.routine);
  const sourceForToday = (id: string) => todayOccurrences.find(entry => entry.routine.id === id)?.occurrenceDate ?? today;
  const completedToday = todayTasks.filter(t => t.done).length + todayOccurrences.filter(entry => logFor(entry.routine.id, entry.occurrenceDate).completed).length;
  const totalToday = todayTasks.length + todayOccurrences.length;
  const completionPct = totalToday ? Math.round(completedToday/totalToday*100) : 0;
  // XP przyznaje aplikacja (klucz w lib/xp.ts) — zawsze przeliczane z historii zadań, rutyn i sesji Focus.
  const xpLedger = useMemo(() => buildXpLedger(data, focus.history), [data, focus.history]);
  const totalXp = useMemo(() => sumXp(xpLedger), [xpLedger]);
  const level = levelInfo(totalXp);
  const currentLevel = level.level;
  const xpToday = useMemo(() => sumXp(xpLedger, entry => entry.date === today), [xpLedger, today]);
  const focusMinutes = todayTasks.filter(t=>t.done && t.time).reduce((s,t)=>s+t.duration,0) + todayOccurrences.filter(entry => logFor(entry.routine.id, entry.occurrenceDate).completed).reduce((s,entry)=>s+(logFor(entry.routine.id, entry.occurrenceDate).durationOverride ?? entry.routine.duration),0);
  const daysStreak = useMemo(() => {
    // Serie liczymy z ostatnich dni, w których ukończono choć jedno zadanie lub rutynę.
    const dates = new Set([...data.tasks.filter(t=>t.done && t.date).map(t=>t.date!), ...Object.values(data.routineLogs).filter(l=>l.completed).map(l=>l.id.split(':').slice(1).join(':'))]);
    let streak=0, cursor=dates.has(today)?today:shiftDate(today,-1);
    while (dates.has(cursor) && streak<365) {streak++;cursor=shiftDate(cursor,-1);}
    return streak;
  },[data,today]);
  const computedAchievements = useMemo(() => buildAchievements(data, totalXp, daysStreak, { focusHistory: focus.history, today }), [data, totalXp, daysStreak, focus.history, today, language]);
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
  const currentRank = useMemo(() => resolveRank(totalXp), [totalXp, language]);
  const nextRank = useMemo(() => resolveNextRank(totalXp), [totalXp, language]);

  useEffect(() => {
    if (!toast) return;
    // Komunikat z przyciskiem (np. „Cofnij”) wisi dłużej, żeby zdążyć go użyć.
    const timeout = window.setTimeout(() => setToast(''), toastAction?.message === toast ? 7000 : 3600);
    return () => window.clearTimeout(timeout);
  }, [toast, toastAction]);
  // Stoper kroku rutyny: po upływie czasu krok sam się odhacza (także przy zamkniętym oknie rutyny) i słychać sygnał.
  useStepTimerRuntime(timer => {
    const routine = data.routines.find(r => r.id === timer.routineId);
    const log = data.routineLogs[`${timer.routineId}:${timer.sourceDate}`];
    const visible = Boolean(routine && routineStepsOnDate(routine.steps, timer.sourceDate).some(step => step.id === timer.stepId));
    const willCheck = visible && !log?.completed && !log?.checkedStepIds.includes(timer.stepId);
    playStepTimerSound();
    if (willCheck) checkRoutineStep(timer.routineId, timer.sourceDate, timer.stepId);
    setToast(willCheck ? tr(`Czas minął — krok „${timer.title}” zaliczony`, `Time’s up — step “${timer.title}” checked off`) : tr(`Czas minął — „${timer.title}”`, `Time’s up — “${timer.title}”`));
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storageKey = 'momentum.seen-achievements';
    const migrationKey = 'momentum.achievements.catalog.v042';
    const catalogKey = 'momentum.achievements.catalog.v100';
    const rulesKey = 'momentum.achievements.rules.v2';
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
      saveMomentumKey(catalogKey, '1');
      saveMomentumKey(rulesKey, '1');
      return;
    }
    if (readMomentumKey(catalogKey) !== '1') {
      // Katalog urósł z 28 do 100 odznak: nowe, które już są spełnione, trafiają do kolekcji
      // po cichu — jeden komunikat zamiast serii okienek.
      const covered = achievements.filter(achievement => achievement.unlocked && !seen.has(achievement.id));
      covered.forEach(achievement => seen.add(achievement.id));
      saveMomentumKey(storageKey, JSON.stringify([...seen]));
      saveMomentumKey(catalogKey, '1');
      saveMomentumKey(rulesKey, '1');
      if (covered.length) setToast(current => current || tr(`100 odznak w kolekcji! ${covered.length} nowych już masz — zajrzyj do Statystyk.`, `100 badges in the collection! You already have ${count(covered.length, ['nową', 'nowe', 'nowych'], ['new one', 'new ones'])} — take a look at Insights.`));
      return;
    }
    if (readMomentumKey(rulesKey) !== '1') {
      // Nowy klucz XP (lib/xp.ts) i nowe progi odznak: XP przelicza się z całej historii, a odznaki
      // spełnione po przeliczeniu trafiają do kolekcji po cichu. Zdobyte wcześniej zostają zdobyte.
      const covered = achievements.filter(achievement => achievement.unlocked && !seen.has(achievement.id));
      covered.forEach(achievement => seen.add(achievement.id));
      saveMomentumKey(storageKey, JSON.stringify([...seen]));
      saveMomentumKey(rulesKey, '1');
      setToast(current => current || tr(`Nowy system XP: punkty przeliczone z całej historii${covered.length ? ` · ${covered.length} nowych odznak` : ''}. Zdobyte odznaki zostają.`, `New XP system: points recalculated from your whole history${covered.length ? ` · ${count(covered.length, ['nowa odznaka', 'nowe odznaki', 'nowych odznak'], ['new badge', 'new badges'])}` : ''}. Badges you’ve earned stay yours.`));
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
    if (!task) { setToast(tr('Nie znaleziono zadania.', 'Task not found.')); return; }
    if (focus.active && focus.active.taskId !== taskId) {
      setTaskDialog(null);
      setFocusOpen(true);
      setToast(tr('Najpierw zakończ trwającą sesję Focus.', 'Finish the current Focus session first.'));
      return;
    }
    focus.start(task.id, task.title, task.duration);
    setTaskDialog(null);
    setFocusOpen(true);
  }

  function finishFocus(complete: boolean) {
    const task = focus.active ? data.tasks.find(item => item.id === focus.active?.taskId) : undefined;
    const shouldComplete = complete && Boolean(task);
    // XP: premia za realny czas skupienia (zawsze) + ukończenie zadania (jeśli jeszcze nie było ukończone).
    const focusSeconds = focus.active ? snapshot(focus.active, Date.now()).focusMs / 1000 : 0;
    const completionXp = shouldComplete && !task?.done ? taskXp(task!.duration, task!.category) : 0;
    const award = completionXp + (task ? focusXp(focusSeconds, task.category) : 0);
    const record = focus.finish(shouldComplete, award, task?.category);
    if (!record) return;
    if (shouldComplete) {
      setData(previous => ({ ...previous, tasks: previous.tasks.map(item => item.id === record.taskId ? {...item, done: true} : item) }));
    }
    setFocusOpen(false);
    setToast(shouldComplete
      ? tr(`Focus zakończony · ${formatFocusClock(record.focusSeconds)} pracy${award ? ` · +${award} XP` : ''}`, `Focus finished · ${formatFocusClock(record.focusSeconds)} of work${award ? ` · +${award} XP` : ''}`)
      : tr(`Zapisano ${formatFocusClock(record.focusSeconds)} pracy bez oznaczania zadania${award ? ` · +${award} XP za skupienie` : '.'}`, `Saved ${formatFocusClock(record.focusSeconds)} of work without marking the task as done${award ? ` · +${award} XP for focus` : '.'}`));
  }

  function toggleTask(id: string) {
    const task=data.tasks.find(t=>t.id===id);
    if (!task) return;
    setData(prev=>({...prev,tasks:prev.tasks.map(t=>t.id===id?{...t,done:!t.done}:t)}));
    setToast(task.done ? tr('Zadanie przywrócone do realizacji', 'Task reopened') : tr(`Świetnie! +${taskXp(task.duration, task.category)} XP za „${task.title}”`, `Great! +${taskXp(task.duration, task.category)} XP for “${task.title}”`));
  }
  function saveProject(project: Project) {
    setData(prev => ({...prev, projects: prev.projects.some(item => item.id === project.id)
      ? prev.projects.map(item => item.id === project.id ? project : item)
      : [...prev.projects, project]}));
    setToast(tr('Projekt zapisany', 'Project saved'));
  }
  function deleteProject(id: string) {
    setData(prev => ({...prev, projects: prev.projects.filter(project => project.id !== id),
      tasks: prev.tasks.map(task => task.projectId === id ? {...task, projectId: null, milestoneId: null} : task)}));
    setToast(tr('Projekt usunięty; powiązane zadania zachowane', 'Project deleted; linked tasks kept'));
  }
  function linkTaskToProject(taskId: string, projectId: string, milestoneId?: string) {
    setData(prev => ({...prev,tasks:prev.tasks.map(task => task.id === taskId ? {...task,projectId,milestoneId:milestoneId??null} : task)}));
    setToast(tr('Zadanie przypisane do projektu', 'Task linked to the project'));
  }
  function saveTask(task: Task) {
    const existing=data.tasks.find(t=>t.id===task.id);
    // Duration is initialised in TaskModal from the calendar selection.
    // Respect subsequent changes in the duration picker rather than overwriting on save.
    // XP liczy aplikacja; pole `xp` zostaje tylko dla zgodności ze starszymi wersjami (np. drugie urządzenie przed aktualizacją).
    task = {...task, xp: taskXp(task.duration, task.category)};
    setData(prev=>({...prev,tasks:existing?prev.tasks.map(t=>t.id===task.id?task:t):[...prev.tasks,task]}));
    setTaskDialog(null);
    setToast(existing && !existing.done && task.done
      ? tr(`Zadanie ukończone! +${taskXp(task.duration, task.category)} XP za „${task.title}”`, `Task completed! +${taskXp(task.duration, task.category)} XP for “${task.title}”`)
      : existing && existing.done && !task.done
        ? tr('Zadanie przywrócone do realizacji', 'Task reopened')
        : existing ? tr('Zmiany w zadaniu zapisane', 'Task changes saved') : tr('Nowe zadanie dodane', 'New task added'));
  }
  function deleteTask(id: string) {
    setData(prev=>({...prev,tasks:prev.tasks.filter(t=>t.id!==id)}));
    setTaskDialog(null);setToast(tr('Zadanie usunięte', 'Task deleted'));
  }
  function updateTaskSchedule(id: string, date: string, time: string) {
    const duration = data.tasks.find(t => t.id === id)?.duration ?? 45;
    const [hours, minutes] = time.split(':').map(Number);
    const latestStart = 24 * 60 - duration;
    const startMinutes = Math.max(0, Math.min(hours * 60 + minutes, latestStart));
    const plannedTime = `${String(Math.floor(startMinutes / 60)).padStart(2,'0')}:${String(startMinutes % 60).padStart(2,'0')}`;
    setData(prev=>({...prev,tasks:prev.tasks.map(t=>t.id===id?{...t,date,time:plannedTime}:t)}));
    setToast(tr(`Przeniesiono zadanie na ${plannedTime}`, `Task moved to ${plannedTime}`));
  }
  function saveRoutine(routine: Routine) {
    // Pole `xp` tylko dla zgodności ze starszymi wersjami: bazowe XP rutyny bez premii za regularność.
    routine = { ...routine, xp: routineXp(routine.category, routine.duration, routine.steps.length, 0) };
    setData(prev=>({
      ...prev,
      routines:prev.routines.some(r=>r.id===routine.id)?prev.routines.map(r=>r.id===routine.id?routine:r):[...prev.routines,routine],
      routineLogs:Object.fromEntries(Object.entries(prev.routineLogs).map(([key,log])=>
        key.startsWith(`${routine.id}:`)
          ? [key,{...log,checkedStepIds:checkedWithParentPropagation(routine.steps,log.checkedStepIds)}]
          : [key,log])),
    }));
    setEditorDialog(null);setRoutineDialog(null);setToast(tr('Rutyna zapisana', 'Routine saved'));
  }
  async function importRoutineFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const incoming = parseRoutineTransfer(await file.text());
      const normalize = (title: string) => title.trim().toLocaleLowerCase('pl');
      // If the user already has a morning routine (even named "Poranny start"), propose replacing it.
      // Zadania cykliczne (bez kroków) nie są kandydatami do zastąpienia rutyną z pliku.
      const routinesOnly = data.routines.filter(r => !isTaskSeries(r));
      const existing = routinesOnly.find(r => r.id === incoming.id)
        ?? routinesOnly.find(r => normalize(r.title) === normalize(incoming.title))
        ?? (/porann/i.test(incoming.title) ? routinesOnly.find(r => /porann/i.test(r.title)) : undefined);
      const message = existing
        ? tr(`Zastąpić szablon „${existing.title}” nową rutyną „${incoming.title}” (${incoming.steps.length} kroków, ${incoming.time}, ${incoming.duration} min)?\n\nPozostałe dane i historia zostają zachowane. Zrób wcześniej backup JSON.`,
          `Replace the template “${existing.title}” with the new routine “${incoming.title}” (${count(incoming.steps.length, ['krok', 'kroki', 'kroków'], ['step', 'steps'])}, ${incoming.time}, ${incoming.duration} min)?\n\nThe rest of your data and history will be kept. Make a JSON backup first.`)
        : tr(`Dodać rutynę „${incoming.title}” (${incoming.steps.length} kroków, ${incoming.time}, ${incoming.duration} min)?\n\nPozostałe dane nie zostaną zmienione.`,
          `Add the routine “${incoming.title}” (${count(incoming.steps.length, ['krok', 'kroki', 'kroków'], ['step', 'steps'])}, ${incoming.time}, ${incoming.duration} min)?\n\nThe rest of your data won’t be changed.`);
      if (!window.confirm(message)) return;
      const merged = existing ? replaceRoutineKeepingIdentity(existing, incoming)
        : data.routines.some(r => r.id === incoming.id) ? { ...incoming, id: crypto.randomUUID() } : incoming;
      setData(previous => ({
        ...previous,
        routines: existing
          ? previous.routines.map(r => r.id === existing.id ? merged : r)
          : [...previous.routines, merged],
      }));
      setToast(tr(`Wczytano rutynę: ${merged.title} (${merged.steps.length} kroków)`, `Routine imported: ${merged.title} (${count(merged.steps.length, ['krok', 'kroki', 'kroków'], ['step', 'steps'])})`));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : tr('Nie udało się wczytać rutyny.', 'Couldn’t import the routine.'));
    }
  }
  function deleteRoutine(id: string) {
    resetStepTimer(id);
    setData(prev=>({...prev,routines:prev.routines.filter(r=>r.id!==id),routineLogs:Object.fromEntries(Object.entries(prev.routineLogs).filter(([key])=>!key.startsWith(`${id}:`)))}));
    setEditorDialog(null);setRoutineDialog(null);setToast(tr('Rutyna usunięta', 'Routine deleted'));
  }
  function updateRoutineLog(id: string, date: string, fn: (log: ReturnType<typeof emptyLog>) => ReturnType<typeof emptyLog>) {
    const key=`${id}:${date}`;
    setData(prev=>({...prev,routineLogs:{...prev.routineLogs,[key]:fn(prev.routineLogs[key]??emptyLog(key))}}));
  }
  // Kroki wystąpienia wynikają z dnia z harmonogramu (`date` = klucz logu), także po przeniesieniu na inny dzień —
  // przeniesiona środa zabiera ze sobą kroki środy.
  function toggleRoutineStep(id: string,date: string,stepId: string) {
    const routine = data.routines.find(r=>r.id===id);
    if (!routine) return;
    const activeSteps = routineStepsOnDate(routine.steps, date);
    if (!activeSteps.some(step => step.id === stepId)) return;
    updateRoutineLog(id,date,log=>({...unskipped(log),checkedStepIds:toggleRoutineStepBranch(activeSteps, log.checkedStepIds, stepId)}));
  }
  /** Stoper kroku: po upływie czasu krok zostaje odhaczony (jeśli był już odhaczony — bez zmian). */
  function checkRoutineStep(id: string, date: string, stepId: string) {
    setData(prev => {
      const routine = prev.routines.find(r => r.id === id);
      if (!routine) return prev;
      const activeSteps = routineStepsOnDate(routine.steps, date);
      if (!activeSteps.some(step => step.id === stepId)) return prev;
      const key = `${id}:${date}`;
      const log = prev.routineLogs[key] ?? emptyLog(key);
      if (log.completed || log.checkedStepIds.includes(stepId)) return prev;
      return { ...prev, routineLogs: { ...prev.routineLogs, [key]: { ...unskipped(log), checkedStepIds: toggleRoutineStepBranch(activeSteps, log.checkedStepIds, stepId) } } };
    });
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
  /** Rutynę kończymy, gdy odhaczone są wszystkie kroki tego wystąpienia; bez kroków (w ogóle albo w tym dniu) — od razu. */
  function completeRoutine(id: string,date: string) {
    const routine=data.routines.find(r=>r.id===id);if(!routine)return;
    const log=logFor(id,date);
    const activeSteps = routineStepsOnDate(routine.steps, date);
    if (log.completed || activeSteps.some(s=>!log.checkedStepIds.includes(s.id))) return;
    updateRoutineLog(id,date,l=>({...unskipped(l),completed:true,completedAt:new Date().toISOString()}));
    resetStepTimer(id, date);
    setRoutineDialog(null);
    setToast(tr(`Rutyna zakończona! +${occurrenceXp(routine, data.routineLogs, date)} XP`, `Routine completed! +${occurrenceXp(routine, data.routineLogs, date)} XP`));
  }
  // ---------- Zadania cykliczne: rutyny bez kroków (kind: 'task'), odhaczane jednym dotknięciem ----------
  function saveSeries(input: Routine, options: SeriesSaveOptions = {}) {
    const existing = data.routines.some(r => r.id === input.id);
    const routine: Routine = { ...input, xp: taskXp(input.duration, input.category) };
    const { replaceTaskId, setDone } = options;
    setData(prev => {
      let routineLogs = prev.routineLogs;
      if (setDone) {
        const key = `${routine.id}:${setDone.sourceDate}`;
        const log = unskipped(prev.routineLogs[key] ?? emptyLog(key));
        if (log.completed !== setDone.done) {
          routineLogs = { ...prev.routineLogs, [key]: setDone.done
            ? { ...log, completed: true, completedAt: new Date().toISOString() }
            : { ...log, completed: false, completedAt: undefined } };
        }
      }
      return {
        ...prev,
        tasks: replaceTaskId ? prev.tasks.filter(task => task.id !== replaceTaskId) : prev.tasks,
        routines: prev.routines.some(r => r.id === routine.id) ? prev.routines.map(r => r.id === routine.id ? routine : r) : [...prev.routines, routine],
        routineLogs,
      };
    });
    setTaskDialog(null);
    setToast(replaceTaskId ? tr(`Zadanie jest teraz cykliczne · ${describeRepeat(routine)}`, `The task is now recurring · ${describeRepeat(routine)}`)
      : setDone?.done ? tr(`Świetnie! +${occurrenceXp(routine, data.routineLogs, setDone.sourceDate)} XP za „${routine.title}”`, `Great! +${occurrenceXp(routine, data.routineLogs, setDone.sourceDate)} XP for “${routine.title}”`)
      : setDone ? tr('Wystąpienie przywrócone do realizacji', 'Occurrence reopened')
      : existing ? tr('Zmiany w zadaniu cyklicznym zapisane', 'Recurring task changes saved')
      : tr(`Dodano zadanie cykliczne · ${describeRepeat(routine)}`, `Recurring task added · ${describeRepeat(routine)}`));
  }
  function toggleSeriesOccurrence(routineId: string, sourceDate: string) {
    const routine = data.routines.find(r => r.id === routineId);
    if (!routine) return;
    const done = logFor(routineId, sourceDate).completed;
    updateRoutineLog(routineId, sourceDate, log => done
      ? { ...log, completed: false, completedAt: undefined }
      : { ...unskipped(log), completed: true, completedAt: new Date().toISOString() });
    setToast(done ? tr('Wystąpienie przywrócone do realizacji', 'Occurrence reopened') : tr(`Świetnie! +${occurrenceXp(routine, data.routineLogs, sourceDate)} XP za „${routine.title}”`, `Great! +${occurrenceXp(routine, data.routineLogs, sourceDate)} XP for “${routine.title}”`));
  }
  function skipOccurrence(routineId: string, sourceDate: string) {
    const routine = data.routines.find(r => r.id === routineId);
    if (!routine) return;
    const key = `${routineId}:${sourceDate}`;
    const previous = data.routineLogs[key];
    // Pusty log z flagą „skipped”: bez XP i bez wcześniejszych wyjątków terminu. „Cofnij” przywraca poprzedni stan.
    setData(prev => ({ ...prev, routineLogs: { ...prev.routineLogs, [key]: { id: key, checkedStepIds: [], completed: false, skipped: true } } }));
    resetStepTimer(routineId, sourceDate);
    setTaskDialog(null);
    setRoutineDialog(null);
    showToast(tr(`Usunięto „${routine.title}” (${shortDayLabel(previous?.dateOverride ?? sourceDate, today)}) — reszta ${isTaskSeries(routine) ? 'serii' : 'rutyny'} bez zmian`, `Removed “${routine.title}” (${shortDayLabel(previous?.dateOverride ?? sourceDate, today)}) — the rest of the ${isTaskSeries(routine) ? 'series' : 'routine'} is unchanged`),
      { label: tr('Cofnij', 'Undo'), run: () => restoreOccurrence(routineId, sourceDate, previous) });
  }
  /** Przywraca usunięte wystąpienie: z „Cofnij” dokładnie poprzedni stan, z listy usuniętych — termin z harmonogramu. */
  function restoreOccurrence(routineId: string, sourceDate: string, previous?: RoutineLog) {
    const routine = data.routines.find(r => r.id === routineId);
    if (!routine) return;
    const key = `${routineId}:${sourceDate}`;
    setData(prev => {
      if (!prev.routines.some(r => r.id === routineId)) return prev;
      const routineLogs = { ...prev.routineLogs };
      if (previous && !previous.skipped) routineLogs[key] = previous;
      else if (routineLogs[key]?.skipped) delete routineLogs[key];
      return { ...prev, routineLogs };
    });
    showToast(tr(`„${routine.title}” wraca do planu (${shortDayLabel(previous?.dateOverride ?? sourceDate, today)})`, `“${routine.title}” is back in the plan (${shortDayLabel(previous?.dateOverride ?? sourceDate, today)})`));
  }
  function endSeries(routineId: string, fromSourceDate: string) {
    const routine = data.routines.find(r => r.id === routineId);
    if (!routine?.repeat) return;
    const prefix = `${routineId}:`;
    const until = shiftDate(fromSourceDate, -1);
    // Historia sprzed zakończenia zostaje; logi od dnia zakończenia (wyjątki, pominięcia) są już zbędne.
    const keepLog = (key: string) => !key.startsWith(prefix) || key.slice(prefix.length) < fromSourceDate;
    const hasHistory = Object.entries(data.routineLogs).some(([key, log]) => key.startsWith(prefix) && keepLog(key) && log.completed);
    if (until < routine.repeat.start && !hasHistory) { deleteSeries(routineId); return; }
    setData(prev => ({
      ...prev,
      routines: prev.routines.map(r => r.id === routineId && r.repeat ? { ...r, repeat: { ...r.repeat, until } } : r),
      routineLogs: Object.fromEntries(Object.entries(prev.routineLogs).filter(([key]) => keepLog(key))),
    }));
    setTaskDialog(null);
    setToast(tr(`Seria „${routine.title}” zakończona. Historia i XP zostają.`, `Series “${routine.title}” ended. History and XP are kept.`));
  }
  function deleteSeries(id: string) {
    setData(prev => ({ ...prev, routines: prev.routines.filter(r => r.id !== id), routineLogs: Object.fromEntries(Object.entries(prev.routineLogs).filter(([key]) => !key.startsWith(`${id}:`))) }));
    setTaskDialog(null);
    setToast(tr('Zadanie cykliczne usunięte', 'Recurring task deleted'));
  }
  function seriesOccurrence(routine: Routine, sourceDate: string): SeriesOccurrence {
    const log: RoutineLog | undefined = data.routineLogs[`${routine.id}:${sourceDate}`];
    return { sourceDate, date: log?.dateOverride ?? sourceDate, time: log?.timeOverride ?? routine.time, done: Boolean(log?.completed), ...(log?.skipped ? { skipped: true } : {}) };
  }
  const openSeries = (routineId: string, occurrenceDate?: string) => { setRoutineDialog(null); setTaskDialog({ seriesId: routineId, occurrenceDate }); };
  function resizeBlock(block: CalendarBlock, nextDuration: number) {
    if (nextDuration === block.duration) return;
    if (block.kind === 'task') {
      setData(prev => ({...prev, tasks: prev.tasks.map(t => t.id === block.sourceId ? {...t, duration: nextDuration} : t)}));
      setToast(tr(`Czas „${block.title}” zmieniony na ${formatDuration(nextDuration)}`, `Duration of “${block.title}” changed to ${formatDuration(nextDuration)}`));
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
      setToast(block.series ? tr(`Zmieniono czas tylko tego wystąpienia (${shortDayLabel(block.date, today)})`, `Duration changed for this occurrence only (${shortDayLabel(block.date, today)})`) : tr(`Zmieniono czas rutyny tylko na ${block.date}`, `Routine duration changed for ${block.date} only`));
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
      setToast(tr(`Zmieniono czas wszystkich wystąpień „${block.title}”`, `Duration changed for all occurrences of “${block.title}”`));
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
  /** Wyjątek terminu jednego wystąpienia: log zostaje pod dniem z harmonogramu, a wystąpienie (z krokami i XP) idzie na nowy dzień. */
  function applyOccurrenceMove(routineId: string, sourceDate: string, date: string, time: string) {
    const key = `${routineId}:${sourceDate}`;
    setData(prev => {
      const template = prev.routines.find(r => r.id === routineId);
      if (!template) return prev;
      const updated = unskipped({ ...(prev.routineLogs[key] ?? emptyLog(key)) });
      delete updated.dateOverride;
      delete updated.timeOverride;
      if (date !== sourceDate) updated.dateOverride = date;
      if (time !== template.time) updated.timeOverride = time;
      return { ...prev, routineLogs: { ...prev.routineLogs, [key]: updated } };
    });
  }
  /** Przycisk „Przenieś” w oknie rutyny lub zadania cyklicznego. */
  function moveOccurrence(routineId: string, sourceDate: string, date: string, time: string) {
    const routine = data.routines.find(r => r.id === routineId);
    if (!routine) return;
    applyOccurrenceMove(routineId, sourceDate, date, time);
    // Otwarte okno rutyny pokazuje odtąd nowy dzień (kroki dnia, nagłówek).
    setRoutineDialog(current => current && current.id === routineId && (current.occurrenceDate ?? current.date) === sourceDate ? { ...current, date } : current);
    setToast(date === sourceDate && time === routine.time
      ? tr(`„${routine.title}” wraca na pierwotny termin`, `“${routine.title}” is back at its original time`)
      : tr(`Przeniesiono „${routine.title}” na ${shortDayLabel(date, today)}, ${time} — reszta ${isTaskSeries(routine) ? 'serii' : 'rutyny'} bez zmian`, `Moved “${routine.title}” to ${shortDayLabel(date, today)}, ${time} — the rest of the ${isTaskSeries(routine) ? 'series' : 'routine'} is unchanged`));
  }
  /** Zwykłe zadanie: nowy dzień (i godzina) bez otwierania edycji pól. */
  function moveTaskTo(id: string, date: string, time: string | null) {
    const task = data.tasks.find(t => t.id === id);
    if (!task) return;
    setData(prev => ({ ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, date, time } : t) }));
    setToast(tr(`Przeniesiono „${task.title}” na ${shortDayLabel(date, today)}${time ? `, ${time}` : ''}`, `Moved “${task.title}” to ${shortDayLabel(date, today)}${time ? `, ${time}` : ''}`));
  }
  /** Godziny innych wystąpień tej samej rutyny/serii w danym dniu (bez przenoszonego). */
  const otherOccurrenceTimes = (routineId: string, sourceDate: string) => (date: string): string[] => {
    const routine = data.routines.find(r => r.id === routineId);
    if (!routine) return [];
    const times: string[] = [];
    const own = data.routineLogs[`${routineId}:${date}`];
    if (date !== sourceDate && occurrenceExists(routine, date, own) && (own?.dateOverride ?? date) === date) times.push(own?.timeOverride ?? routine.time);
    for (const [key, log] of Object.entries(data.routineLogs)) {
      if (!key.startsWith(`${routineId}:`) || key === `${routineId}:${sourceDate}` || log.skipped || log.dateOverride !== date) continue;
      times.push(log.timeOverride ?? routine.time);
    }
    return times.sort();
  };
  function confirmRoutineMove(scope: 'single' | 'all') {
    if (!pendingRoutineMove) return;
    const { block, date, time } = pendingRoutineMove;
    const sourceDate = block.occurrenceDate ?? block.date;
    if (scope === 'single') {
      applyOccurrenceMove(block.sourceId, sourceDate, date, time);
      setToast(tr(`Przeniesiono tylko wystąpienie „${block.title}”`, `Moved only this occurrence of “${block.title}”`));
    } else {
      // Dni tygodnia przesuwają się jak dotąd; reguła z interwałem (co 2 tyg., co miesiąc) przesuwa też początek serii.
      setData(prev => ({
        ...prev,
        routines: prev.routines.map(r => r.id === block.sourceId ? { ...r, time, ...shiftSeries(r, sourceDate, date) } : r),
        routineLogs: Object.fromEntries(Object.entries(prev.routineLogs).map(([key, log]) => {
          if (!key.startsWith(`${block.sourceId}:`)) return [key, log];
          const updated = { ...log };
          delete updated.dateOverride;
          delete updated.timeOverride;
          return [key, updated];
        })),
      }));
      setToast(block.series ? tr(`Zaktualizowano harmonogram całej serii „${block.title}”`, `Schedule updated for the whole series “${block.title}”`) : tr(`Zaktualizowano harmonogram całej rutyny „${block.title}”`, `Schedule updated for the whole routine “${block.title}”`));
    }
    setPendingRoutineMove(null);
  }

  function openBlock(block: CalendarBlock) {
    if (block.kind==='task')setTaskDialog({id:block.sourceId});
    else if (block.series) openSeries(block.sourceId, block.occurrenceDate ?? block.date);
    else setRoutineDialog({id:block.sourceId,date:block.date,occurrenceDate:block.occurrenceDate ?? block.date});
  }
  function toggleBlock(block:CalendarBlock) {
    if(block.kind==='task')toggleTask(block.sourceId);
    else if (block.series) toggleSeriesOccurrence(block.sourceId, block.occurrenceDate ?? block.date);
    else setRoutineDialog({id:block.sourceId,date:block.date,occurrenceDate:block.occurrenceDate ?? block.date});
  }
  const calendarBlocks: CalendarBlock[] = useMemo(() => {
    const blocks: CalendarBlock[] = data.tasks.filter(t=>t.date && t.time).map(t=>({id:t.id,kind:'task',sourceId:t.id,title:t.title,icon:t.icon,image:t.image,category:t.category,date:t.date!,time:t.time!,duration:t.duration,done:t.done}));
    // Wirtualne wystąpienia rutyn i zadań cyklicznych: jeden szablon, osobny log każdego dnia.
    for (let offset=-45;offset<=45;offset++) {
      const d=shiftDate(referenceDate,offset);
      for(const r of data.routines) {
        const log = data.routineLogs[`${r.id}:${d}`];
        if (!occurrenceExists(r, d, log)) continue;
        blocks.push({id:`routine:${r.id}:${d}`,kind:'routine',sourceId:r.id,title:r.title,icon:r.icon,image:r.image,category:r.category,
          occurrenceDate:d, date:log?.dateOverride ?? d, time:log?.timeOverride ?? r.time,
          duration:log?.durationOverride ?? r.duration,done:!!log?.completed,
          ...(isTaskSeries(r) ? { series: true } : {})});
      }
    }
    return blocks;
  },[data,referenceDate]);

  const upcomingTasks = data.tasks.filter(t=>!t.done && (t.date === today || !t.date)).sort((a,b)=>{
    if(a.date&&!b.date)return -1;if(!a.date&&b.date)return 1;
    if(a.time&&!b.time)return -1;if(!a.time&&b.time)return 1;
    return (a.time??'').localeCompare(b.time??'');
  });
  // „Do zrobienia”: dzisiejsze wystąpienia zadań cyklicznych między zadaniami z godziną, przed Inboxem.
  const todoEntries: TodoEntry[] = [
    ...upcomingTasks.map(task => ({ type: 'task' as const, task })),
    ...seriesToday.filter(entry => !entry.done).map(entry => ({ type: 'series' as const, ...entry })),
  ].sort((a, b) => {
    const rank = (entry: TodoEntry) => entry.type === 'series' ? 0 : entry.task.date ? (entry.task.time ? 0 : 1) : 2;
    const time = (entry: TodoEntry) => entry.type === 'series' ? entry.time : entry.task.time ?? '';
    return rank(a) - rank(b) || (rank(a) === 0 ? time(a).localeCompare(time(b)) : 0);
  });
  const openTaskCount = data.tasks.filter(t => !t.done).length + seriesToday.filter(entry => !entry.done).length;
  // Strona „Moje zadania”: wyszukiwanie i filtr obejmują też zadania cykliczne.
  const searchQuery = search.toLocaleLowerCase('pl-PL');
  const matchesSearch = (title: string) => !search || title.toLocaleLowerCase('pl-PL').includes(searchQuery);
  const visibleSeriesToday = seriesToday.filter(entry => matchesSearch(entry.routine.title) && (taskFilter !== 'completed' || entry.done));
  const seriesList = useMemo(() => taskFilter !== 'all' ? [] : data.routines
    .filter(routine => isTaskSeries(routine) && (!search || routine.title.toLocaleLowerCase('pl-PL').includes(search.toLocaleLowerCase('pl-PL'))))
    .map(routine => ({ routine, next: nextOccurrence(routine, data.routineLogs, today) }))
    .sort((a, b) => (a.next ? 0 : 1) - (b.next ? 0 : 1)
      || (a.next && b.next ? `${a.next.date}T${a.next.time}`.localeCompare(`${b.next.date}T${b.next.time}`) : 0)
      || a.routine.title.localeCompare(b.routine.title, 'pl')), [data.routines, data.routineLogs, today, search, taskFilter]);

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
  // Z bocznego menu: na telefonie najpierw zamykamy szufladę, żeby nie została pod oknem ustawień.
  function openSettingsFromNav(){
    setMobileNav(false);
    setSettingsOpen(true);
  }
  function addPreset(title:string,category:CategoryKey,icon:IconKey,duration:number){
    saveTask({id:crypto.randomUUID(),title,description:'',category,icon,date:null,time:null,duration,xp:taskXp(duration,category),done:false,createdAt:new Date().toISOString()});
  }

  // Zmiana języka montuje widok od nowa, więc wszystkie komponenty pokazują teksty w nowym języku.
  return <div className="app-shell" key={language}>
    <aside className={`sidebar ${mobileNav ? 'sidebar--open':''}`}>
      <div className="brand"><div className="brand-mark"><Zap size={23} fill="currentColor" /></div><div><div className="brand-name">momentum<span>.</span></div><div className="brand-subtitle">{tr('KAŻDY DZIEŃ SIĘ LICZY', 'MAKE EVERY DAY COUNT')}</div></div><button className="mobile-close" onClick={()=>setMobileNav(false)}><X size={20}/></button></div>
      <div className="sidebar-section-label">{tr('PRZESTRZEŃ ROBOCZA', 'WORKSPACE')}</div>
      <nav className="main-nav" aria-label={tr('Nawigacja', 'Navigation')}>
        {NAV.map(n=><button key={n.id} className={`nav-item ${page===n.id?'active':''}`} onClick={()=>goPage(n.id)}><n.icon size={19} strokeWidth={1.9}/><span>{n.label}</span>{n.id==='tasks'&&openTaskCount>0&&<span className="nav-count">{openTaskCount}</span>}</button>)}
        {/* Ustawienia tuż pod Weekly Review — na telefonie zawsze widoczne bez przewijania menu. */}
        <button type="button" className="nav-item nav-item--settings" aria-haspopup="dialog" onClick={openSettingsFromNav}><Settings2 size={19} strokeWidth={1.9}/><span>{tr('Ustawienia', 'Settings')}</span></button>
      </nav>
      <div className="sidebar-divider"/>
      <div className="sidebar-label-row"><span className="sidebar-section-label">{tr('TWOJE KATEGORIE', 'YOUR CATEGORIES')}</span><button className="tiny-icon-btn" aria-label={tr('Dostosuj kategorie', 'Customize categories')} onClick={openSettingsFromNav}><Settings2 size={15}/></button></div>
      <div className="category-sidebar">{CATEGORY_KEYS.map(c=><div key={c} className="sidebar-category"><span className="category-dot" style={{background:categories[c].color}}/>{categories[c].label}</div>)}</div>
      <div className="sidebar-spacer"/>
      <div className="sidebar-level-card"><div className="level-card-top"><div className="level-orb"><Trophy size={20}/></div><div><span>{tr('TWÓJ POZIOM', 'YOUR LEVEL')}</span><strong>{tr(`Poziom ${currentLevel}`, `Level ${currentLevel}`)}</strong></div><Sparkles size={17} className="level-twinkle"/></div><div className="level-progress"><div style={{width:`${level.progress*100}%`}} /></div><div className="level-card-sub"><span>{formatNumber(level.into)} / {formatNumber(level.size)} XP</span><span>{tr('Do awansu', 'To level up')} <ArrowUpRight size={13}/></span></div></div>
      <div className="sidebar-foot">Momentum v0.5.2 <span>✦</span> {tr('Stworzone dla progresu', 'Made for progress')}</div>
    </aside>
    {mobileNav && <button className="sidebar-scrim" aria-label={tr('Zamknij menu', 'Close menu')} onClick={()=>setMobileNav(false)}/>}
    <div className="app-workspace">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-btn" aria-label={tr('Otwórz menu', 'Open menu')} onClick={()=>setMobileNav(true)}><Menu size={21}/></button><div className="breadcrumbs"><span>{tr('Przestrzeń robocza', 'Workspace')}</span><ChevronRight size={14}/><strong>{NAV.find(n=>n.id===page)?.label}</strong></div></div><div className="topbar-right"><label className="global-search"><Search size={17}/><input ref={searchRef} aria-label={tr('Szukaj zadań', 'Search tasks')} placeholder={tr('Szukaj zadań...', 'Search tasks...')} value={search} onChange={e=>{setSearch(e.target.value);if(e.target.value)goPage('tasks');}}/><span>⌘ K</span></label><button className="icon-btn theme-btn" aria-label={tr('Przełącz motyw', 'Toggle theme')} title={tr('Zmień motyw', 'Change theme')} onClick={()=>setData(p=>({...p,theme:p.theme==='light'?'dark':'light'}))}>{data.theme==='light'?<Moon size={19}/>:<Sun size={19}/>}</button><NotificationCenter api={reminders} data={data} onOpenItem={openNotificationItem} onOpenSettings={()=>setSettingsOpen(true)} onOpenPanel={closeReminderBanner}/></div></header>
      <main className="main-content">
        {page==='overview' && <div className="overview-page">
          <div className="overview-block overview-block--heading"><div className="welcome-heading"><div><div className="eyebrow eyebrow--indigo">{tr('TWOJA PRZESTRZEŃ DO DZIAŁANIA', 'YOUR SPACE TO GET THINGS DONE')} <Sparkles size={13}/></div><h1>{tr('Twój dzień. ', 'Your day. ')}<H>{tr('Twój progres.', 'Your progress.')}</H></h1><p>{tr('Każdy mały krok przybliża Cię do większego celu. Działaj po swojemu.', 'Every small step brings you closer to a bigger goal. Do it your way.')}</p></div><button className="btn btn--primary add-top" onClick={()=>setTaskDialog({date:today})}><Plus size={18}/> {tr('Nowe zadanie', 'New task')}</button></div></div>
          <div className="overview-block overview-block--schedule"><div className="content-split overview-schedule-layout"><CalendarView referenceDate={referenceDate} onChangeDate={setReferenceDate} blocks={calendarBlocks} categories={categories} mode="day" onChangeMode={m=>{if(m==='week')goPage('calendar');setCalendarMode(m);}} onAddAt={(date,time,duration)=>setTaskDialog({date,time,duration})} onOpenBlock={openBlock} onFocusBlock={block=>startFocus(block.sourceId)} onToggleBlock={toggleBlock} onDropBlock={moveRoutine} onResizeBlock={resizeBlock} compact/></div></div><div className="overview-block overview-block--todo"><div className="overview-todo-heading"><h2>{tr('Do zrobienia i rutyny', 'To do & routines')}</h2><button type="button" onClick={()=>goPage('tasks')}>{tr('Wszystkie zadania', 'All tasks')} <ArrowRight size={15}/></button></div><RightPanel upcoming={todoEntries} routines={dueRoutines} logFor={r=>logFor(r.id,sourceForToday(r.id))} routineDateFor={r=>sourceForToday(r.id)} routineXpFor={r=>occurrenceXp(r,data.routineLogs,sourceForToday(r.id))} categories={categories} onTask={t=>setTaskDialog({id:t.id})} onToggle={toggleTask} onSeries={entry=>openSeries(entry.routine.id,entry.occurrenceDate)} onToggleSeries={entry=>toggleSeriesOccurrence(entry.routine.id,entry.occurrenceDate)} onAdd={()=>setTaskDialog({date:today})} onRoutine={r=>setRoutineDialog({id:r.id,date:today,occurrenceDate:sourceForToday(r.id)})} onPreset={addPreset}/></div>
          <div className="overview-block overview-block--review"><button type="button" className="wr-dashboard-link" onClick={()=>goPage('review')}><span className="wr-dashboard-icon"><CalendarDays size={20}/></span><span><strong>{tr('Twój tygodniowy przegląd jest pod ręką', 'Your weekly review is always at hand')}</strong><small>{tr('Wykonane zadania, rutyny, zmierzony czas i plan kolejnego tygodnia.', 'Completed tasks, routines, tracked time and a plan for the week ahead.')}</small></span><ArrowRight size={18}/></button></div>
          <div className="overview-block overview-block--stats"><div className="stats-grid"><StatCard label={tr('Ukończone dzisiaj', 'Completed today')} main={`${completedToday} / ${totalToday}`} detail={tr(`${completionPct}% dzisiejszego planu`, `${completionPct}% of today’s plan`)} icon={CheckCircle2} iconClass="mint" progress={completionPct}/><StatCard label={tr('Czas w skupieniu', 'Focus time')} main={formatDuration(focusMinutes)} detail={tr('Ukończone bloki czasowe', 'Completed time blocks')} icon={Focus} iconClass="purple"/><StatCard label={tr('Zdobyte doświadczenie', 'Experience earned')} main={`+${xpToday} XP`} detail={tr(`Poziom ${currentLevel} · ${formatNumber(level.toNext)} XP do awansu`, `Level ${currentLevel} · ${formatNumber(level.toNext)} XP to level up`)} icon={Zap} iconClass="amber"/></div></div>
          <div className="overview-block overview-block--hero"><section className="welcome-banner"><div className="welcome-banner-content"><div className="banner-tag"><span/> {tr('TWOJA PODRÓŻ TRWA', 'YOUR JOURNEY CONTINUES')}</div><h2>{tr('Masz dziś wszystko,', 'Today you have everything')}<br/>{tr('żeby zrobić coś wielkiego', 'you need to do something great')}<span>.</span></h2><p>{tr('Skup się na tym, co ma znaczenie. Resztą zajmie się Momentum.', 'Focus on what matters. Momentum will take care of the rest.')}</p><button onClick={()=>{goPage('calendar');setCalendarMode('day');setReferenceDate(today);}}>{tr('Zaplanuj swój dzień', 'Plan your day')} <ArrowRight size={16}/></button></div><div className="hero-illustration" aria-hidden="true"><div className="hero-orbit hero-orbit--1"/><div className="hero-orbit hero-orbit--2"/><div className="hero-main-orb"><Zap size={76} strokeWidth={1.3} fill="currentColor"/></div><div className="hero-star star-a">✦</div><div className="hero-star star-b">✧</div><div className="hero-mini-card"><span>✦</span> {tr(`+${xpToday} XP dziś`, `+${xpToday} XP today`)} <ArrowUpRight size={15}/></div><div className="hero-chip">{tr(`POZIOM ${currentLevel}`, `LEVEL ${currentLevel}`)}</div></div></section></div>
        </div>}
        {page==='calendar'&&<><MobileMonthView referenceDate={referenceDate} onChangeDate={setReferenceDate} blocks={calendarBlocks} categories={categories} onOpenDate={date=>{setReferenceDate(date);goPage('overview');setCalendarMode('day');}}/><PageHeading kicker={tr('TWÓJ CZAS MA ZNACZENIE', 'YOUR TIME MATTERS')} title={tr('Kalendarz', 'Calendar')} accent={tr(' & bloki czasu', ' & time blocking')} description={tr('Zaplanuj dzień, przeciągaj zadania między godzinami i obserwuj swój progres. Kliknij puste miejsce, aby dodać blok.', 'Plan your day, drag tasks between hours and watch your progress. Click an empty slot to add a block.')}/><div className="calendar-page-layout"><CalendarView referenceDate={referenceDate} onChangeDate={setReferenceDate} blocks={calendarBlocks} categories={categories} mode={calendarMode} onChangeMode={setCalendarMode} onAddAt={(date,time,duration)=>setTaskDialog({date,time,duration})} onOpenBlock={openBlock} onFocusBlock={block=>startFocus(block.sourceId)} onToggleBlock={toggleBlock} onDropBlock={moveRoutine} onResizeBlock={resizeBlock}/><RightPanel upcoming={todoEntries} routines={dueRoutines} logFor={r=>logFor(r.id,sourceForToday(r.id))} routineDateFor={r=>sourceForToday(r.id)} routineXpFor={r=>occurrenceXp(r,data.routineLogs,sourceForToday(r.id))} categories={categories} onTask={t=>setTaskDialog({id:t.id})} onToggle={toggleTask} onSeries={entry=>openSeries(entry.routine.id,entry.occurrenceDate)} onToggleSeries={entry=>toggleSeriesOccurrence(entry.routine.id,entry.occurrenceDate)} onAdd={()=>setTaskDialog({date:today})} onRoutine={r=>setRoutineDialog({id:r.id,date:today,occurrenceDate:sourceForToday(r.id)})} onPreset={addPreset}/></div></>}
        {page==='tasks'&&<><PageHeading kicker={tr('MAŁE KROKI, WIELKIE EFEKTY', 'SMALL STEPS, BIG RESULTS')} title={tr('Moje', 'My')} accent={tr(' zadania', ' tasks')} description={tr('Wszystkie Twoje zadania w jednym miejscu. Zaplanuj je lub zrealizuj od razu.', 'All your tasks in one place. Schedule them or get them done right away.')} action={<button className="btn btn--primary" onClick={()=>setTaskDialog({})}><Plus size={18}/> {tr('Dodaj zadanie', 'Add task')}</button>}/><div className="tasks-page"><div className="task-filters">{([{id:'all',label:tr('Wszystkie', 'All')},{id:'today',label:tr('Na dzisiaj', 'Today')},{id:'completed',label:tr('Ukończone', 'Completed')}] as const).map(f=><button key={f.id} className={taskFilter===f.id?'active':''} onClick={()=>setTaskFilter(f.id)}>{f.label}</button>)}</div><TaskGroups tasks={data.tasks.filter(t=>matchesSearch(t.title)&&(taskFilter==='all'||(taskFilter==='today'&&t.date===today)||(taskFilter==='completed'&&t.done)))} seriesToday={visibleSeriesToday} seriesList={seriesList} categories={categories} projects={data.projects} onEdit={t=>setTaskDialog({id:t.id})} onToggle={toggleTask} onOpenSeries={openSeries} onToggleSeries={entry=>toggleSeriesOccurrence(entry.routine.id,entry.occurrenceDate)} onAdd={()=>setTaskDialog({})}/></div></>}
        {page==='routines'&&<><PageHeading kicker={tr('KONSEKWENCJA TWORZY NAWYKI', 'CONSISTENCY BUILDS HABITS')} title={tr('Twoje', 'Your')} accent={tr(' rutyny', ' routines')} description={tr('Jeden prosty rytuał, wiele małych zwycięstw. Kończ wszystkie kroki jednym kliknięciem.', 'One simple ritual, many small wins. Finish all the steps with a single click.')} action={<button className="btn btn--primary" onClick={()=>setEditorDialog({})}><Plus size={18}/> {tr('Nowa rutyna', 'New routine')}</button>}/><div className="routine-import-bar"><input ref={routineImportRef} type="file" accept=".json,application/json" hidden onChange={importRoutineFile}/><button type="button" className="btn btn--secondary" onClick={()=>routineImportRef.current?.click()}><Upload size={16}/> {tr('Wczytaj rutynę z pliku', 'Import routine from file')}</button><small>{tr('Import dotyczy tylko jednej rutyny — pozostałe dane nie zostaną zastąpione.', 'The import covers a single routine only — the rest of your data won’t be replaced.')}</small></div><div className="routines-intro"><div><span>{tr('✦ CODZIENNY RYTM', '✦ DAILY RHYTHM')}</span><h3>{tr('Nie musisz robić wszystkiego naraz.', 'You don’t have to do everything at once.')}</h3><p>{tr('Zaznacz kolejne kroki, a po zakończeniu rutyny zaktualizujemy kalendarz i XP automatycznie.', 'Check off the steps one by one — once you finish the routine, we’ll update your calendar and XP automatically.')}</p></div><div className="routine-intro-ornament">☼</div></div><div className="routine-cards">{data.routines.filter(r=>!isTaskSeries(r)).map(r=>{const source=sourceForToday(r.id);const log=logFor(r.id,source);const todaysSteps=routineStepsOnDate(r.steps,source);return <RoutineCard key={r.id} routine={r} log={log} xp={occurrenceXp(r,data.routineLogs,source)} stepsToday={todaysSteps.length} checkedToday={todaysSteps.filter(s=>log.checkedStepIds.includes(s.id)).length} occursToday={dueRoutines.some(item=>item.id===r.id)} categories={categories} onOpen={()=>setRoutineDialog({id:r.id,date:today,occurrenceDate:source})}/>;})}<button className="routine-card routine-card--add" onClick={()=>setEditorDialog({})}><span><Plus size={27}/></span><strong>{tr('Stwórz własną rutynę', 'Create your own routine')}</strong><p>{tr('Dodaj kroki i harmonogram — XP policzymy sami.', 'Add steps and a schedule — we’ll calculate the XP for you.')}</p></button></div></>}
        {page==='projects'&&<><div className="projects-mobile-heading"><PageHeading kicker={tr('WIELKIE CELE · MAŁE KROKI', 'BIG GOALS · SMALL STEPS')} title={tr('Projekty', 'Projects')} accent={tr(' & cele', ' & goals')} description={tr('Łącz zadania, kamienie milowe i checklisty w jedną drogę do celu.', 'Combine tasks, milestones and checklists into one path to your goal.')}/></div><ProjectsView projects={data.projects} tasks={data.tasks} categories={categories} onSaveProject={saveProject} onDeleteProject={deleteProject} onToggleTask={toggleTask} onOpenTask={id=>setTaskDialog({id})} onCreateTask={(projectId,milestoneId)=>setTaskDialog({projectId,milestoneId})} onLinkTask={linkTaskToProject}/></>}
        {page==='review'&&<><PageHeading kicker={tr('CO TYDZIEŃ O KROK DALEJ', 'ONE STEP FURTHER EVERY WEEK')} title="Weekly" accent=" Review" description={tr('Podsumuj ostatni tydzień, zobacz, co zadziałało, i zaplanuj następny bez presji.', 'Look back on the past week, see what worked and plan the next one without pressure.')}/><WeeklyReview data={data} focusHistory={focus.history} onOpenNextWeek={monday=>{setReferenceDate(monday);setCalendarMode('week');goPage('calendar');}}/></>}
        {page==='insights'&&<><PageHeading kicker={tr('POSTĘP TO SUMA MAŁYCH KROKÓW', 'PROGRESS IS THE SUM OF SMALL STEPS')} title={tr('Twoje', 'Your')} accent={tr(' statystyki', ' insights')} description={tr('Zobacz, gdzie inwestujesz swój czas i jak rośnie Twoja regularność.', 'See where your time goes and how your consistency grows.')}/><InsightsView data={data} totalXp={totalXp} level={level} xpLedger={xpLedger} streak={daysStreak} achievements={achievements} rank={currentRank} nextRank={nextRank} focusHistory={focus.history}/></>}
        <footer className="main-footer"><span>{tr('✦ Momentum — małe kroki, wielki progres.', '✦ Momentum — small steps, big progress.')}</span><span>{tr('Wersja demonstracyjna · dane lokalne', 'Demo version · local data')}</span></footer>
      </main>
    </div>
    {pendingRoutineMove&&<RoutineMoveConfirmModal title={pendingRoutineMove.block.title}
      previousDate={pendingRoutineMove.block.date} previousTime={pendingRoutineMove.block.time}
      targetDate={pendingRoutineMove.date} targetTime={pendingRoutineMove.time}
      shiftsWeekdays={new Date(`${pendingRoutineMove.block.occurrenceDate ?? pendingRoutineMove.block.date}T12:00:00`).getDay() !== new Date(`${pendingRoutineMove.date}T12:00:00`).getDay()}
      eyebrow={pendingRoutineMove.block.series ? tr('ZADANIE CYKLICZNE', 'RECURRING TASK') : undefined}
      allHint={seriesMoveHint(data.routines.find(r => r.id === pendingRoutineMove.block.sourceId), pendingRoutineMove.date, pendingRoutineMove.time)}
      onOnlyThis={()=>confirmRoutineMove('single')} onAll={()=>confirmRoutineMove('all')} onCancel={()=>setPendingRoutineMove(null)}/>}
    {pendingResize&&<ResizeConfirmModal title={pendingResize.block.title} date={pendingResize.block.date} time={pendingResize.block.time} previousDuration={pendingResize.block.duration} nextDuration={pendingResize.nextDuration}
      {...(pendingResize.block.series ? { eyebrow: tr('ZADANIE CYKLICZNE', 'RECURRING TASK'), allHint: tr('Zmień czas trwania wszystkich wystąpień i usuń wcześniejsze wyjątki długości.', 'Change the duration of all occurrences and remove earlier duration exceptions.') } : {})}
      onOnlyThis={()=>confirmResize('single')} onAll={()=>confirmResize('all')} onCancel={()=>setPendingResize(null)}/>}
    {taskDialog&&(()=>{
      const series = taskDialog.seriesId ? data.routines.find(r=>r.id===taskDialog.seriesId) : undefined;
      if (taskDialog.seriesId && !series) return null;
      return <TaskModal key={`${taskDialog.seriesId ?? taskDialog.id ?? 'new'}:${taskDialog.occurrenceDate ?? ''}`}
        task={taskDialog.id?data.tasks.find(t=>t.id===taskDialog.id):undefined}
        series={series} occurrence={series && taskDialog.occurrenceDate ? seriesOccurrence(series, taskDialog.occurrenceDate) : undefined}
        nextSourceDate={series ? nextOccurrence(series, data.routineLogs, today)?.sourceDate : undefined}
        initialDate={taskDialog.date} initialTime={taskDialog.time} initialDuration={taskDialog.duration} initialProjectId={taskDialog.projectId} initialMilestoneId={taskDialog.milestoneId} projects={data.projects} categories={categories} focusSeconds={focus.history.filter(record=>record.taskId===taskDialog.id).reduce((sum,record)=>sum+record.focusSeconds,0)} defaultReminders={reminders.settings.taskDefaults} notificationsEnabled={notificationsActive} onEnableNotifications={enableNotifications} onFocus={startFocus} onSave={saveTask} onDelete={deleteTask}
        onSaveSeries={saveSeries} onSkipOccurrence={skipOccurrence} onEndSeries={endSeries} onDeleteSeries={deleteSeries}
        onMoveTask={moveTaskTo}
        onMoveOccurrence={series ? (sourceDate, date, time) => moveOccurrence(series.id, sourceDate, date, time) : undefined}
        otherTimesOn={series && taskDialog.occurrenceDate ? otherOccurrenceTimes(series.id, taskDialog.occurrenceDate) : undefined}
        skippedDates={series ? skippedOccurrences(series, data.routineLogs, today) : undefined}
        onRestoreOccurrence={series ? sourceDate => restoreOccurrence(series.id, sourceDate) : undefined}
        onClose={()=>setTaskDialog(null)}/>;
    })()}
    {routineDialog&&(()=>{const r=data.routines.find(x=>x.id===routineDialog.id);const occurrenceDate=routineDialog.occurrenceDate ?? routineDialog.date;return r?<RoutineSession routine={r} date={routineDialog.date} log={logFor(r.id,occurrenceDate)} xp={occurrenceXp(r,data.routineLogs,occurrenceDate)} duration={logFor(r.id,occurrenceDate).durationOverride ?? r.duration} displayTime={logFor(r.id,occurrenceDate).timeOverride ?? r.time} categoryColor={(categories[r.category] ?? categories.unpaid).color} categories={categories} onToggleStep={step=>toggleRoutineStep(r.id,occurrenceDate,step)} onChangeSteps={steps=>changeRoutineSteps(r.id,steps)} onComplete={()=>completeRoutine(r.id,occurrenceDate)} onUndo={()=>updateRoutineLog(r.id,occurrenceDate,l=>({...l,completed:false,completedAt:undefined}))} onEdit={()=>{setEditorDialog({id:r.id});setRoutineDialog(null);}} onDelete={()=>deleteRoutine(r.id)}
      sourceDate={occurrenceDate} otherTimesOn={otherOccurrenceTimes(r.id,occurrenceDate)} onMove={(date,time)=>moveOccurrence(r.id,occurrenceDate,date,time)}
      onSkip={()=>skipOccurrence(r.id,occurrenceDate)} onRestore={()=>restoreOccurrence(r.id,occurrenceDate)}
      onClose={()=>setRoutineDialog(null)}/>:null;})()}
    {editorDialog&&(()=>{const edited=editorDialog.id?data.routines.find(r=>r.id===editorDialog.id):undefined;return <RoutineEditor routine={edited} categories={categories} defaultReminders={reminders.settings.routineDefaults} notificationsEnabled={notificationsActive} onEnableNotifications={enableNotifications} onSave={saveRoutine} onDelete={deleteRoutine} onClose={()=>setEditorDialog(null)}
      skippedDates={edited?skippedOccurrences(edited,data.routineLogs,today):[]} onRestoreOccurrence={edited?sourceDate=>restoreOccurrence(edited.id,sourceDate):undefined}/>;})()}
    {settingsOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSettingsOpen(false);}}><div className="modal settings-modal" role="dialog" aria-modal="true" aria-label={tr('Ustawienia', 'Settings')}><div className="modal-heading"><div><span className="eyebrow">{tr('DOSTOSUJ MOMENTUM', 'CUSTOMIZE MOMENTUM')}</span><h2>{tr('Ustawienia', 'Settings')}</h2></div><button className="icon-btn" onClick={()=>setSettingsOpen(false)} aria-label={tr('Zamknij', 'Close')}><X size={20}/></button></div><p className="settings-desc">{tr('Trzy kategorie określają związek aktywności z przychodem — nie jej wartość dla zdrowia czy samopoczucia. Możesz zmieniać ich kolory.', 'The three categories describe how an activity relates to income — not its value for your health or well-being. You can change their colors.')}</p><div className="settings-colors">{CATEGORY_KEYS.map(c=><div className="settings-color-row" key={c}><label className="color-input-wrap" title={tr('Wybierz kolor', 'Pick a color')}><input type="color" value={categories[c].color} onChange={e=>setData(prev=>({...prev,categories:{...prev.categories,[c]:{...categories[c],color:e.target.value}}}))}/></label><div><strong>{categories[c].label}</strong><span>{categories[c].description}</span></div><span>{categories[c].color.toUpperCase()}</span></div>)}</div><div className="settings-divider"/><label className="theme-setting"><div><strong>{tr('Wygląd aplikacji', 'Appearance')}</strong><small>{tr('Przełącz jasny i ciemny motyw.', 'Switch between the light and dark theme.')}</small></div><button className="btn btn--secondary" onClick={()=>setData(p=>({...p,theme:p.theme==='light'?'dark':'light'}))}>{data.theme==='light'?<Moon size={16}/>:<Sun size={16}/>} {data.theme==='light'?tr('Ciemny', 'Dark'):tr('Jasny', 'Light')}</button></label><div className="settings-divider"/><div className="theme-setting language-setting"><div><strong>Język · Language</strong><small>{tr('Teksty aplikacji, daty i przypomnienia. Twoje zadania i rutyny zostają bez zmian.','App texts, dates and reminders. Your tasks and routines stay as they are.')}</small></div><div className="language-switch" role="radiogroup" aria-label="Język · Language">{LANGUAGES.map(option=><button key={option.id} type="button" role="radio" aria-checked={language===option.id} className={language===option.id?'is-active':''} onClick={()=>setData(prev=>({...prev,language:option.id}))}>{option.label}</button>)}</div></div><div className="settings-divider"/><NotificationSettingsPanel api={reminders} push={push} data={data} onChange={settings=>setData(prev=>({...prev,notifications:settings}))} onApplyDefaults={applyDefaultReminders}/><div className="settings-divider"/><CloudSyncPanel api={cloudSync} data={data}/><div className="settings-divider"/><DataBackup data={data}/><div className="settings-divider"/><div className="danger-zone"><div><strong>{tr('Wyczyść dane demo', 'Clear demo data')}</strong><small>{tr('Przywróci przykładowe zadania, rutyny i kolory.', 'Restores the sample tasks, routines and colors.')}</small></div><button className="btn btn--danger" onClick={()=>{if(window.confirm(tr('Zresetować wszystkie dane do początkowych?', 'Reset all data to the initial state?'))){void eraseStoredData().then(()=>window.location.reload()).catch(()=>window.alert(tr('Nie udało się zresetować danych. Spróbuj ponownie.', 'Couldn’t reset the data. Please try again.')));}}}><Trash2 size={15}/> {tr('Resetuj', 'Reset')}</button></div><div className="modal-bottom"><small>{getOfflineDatabaseStatus() === 'ready' ? tr('Dane lokalne: IndexedDB + kopia zgodności. Zapisuj backup JSON poza telefonem.', 'Local data: IndexedDB + a compatibility copy. Keep a JSON backup off your phone.') : tr('Zapis lokalny: localStorage. IndexedDB niedostępne — zrób backup JSON.', 'Saved locally: localStorage. IndexedDB is unavailable — make a JSON backup.')}</small><button className="btn btn--primary" onClick={()=>setSettingsOpen(false)}>{tr('Gotowe', 'Done')}</button></div></div></div>}
    {weeklyNudge && <div className="wr-notice" role="dialog" aria-label={tr('Tygodniowe podsumowanie', 'Weekly summary')}>
      <span className="wr-notice-icon"><Trophy size={22}/></span>
      <div><span className="eyebrow eyebrow--indigo">{tr('NIEDZIELNY PRZEGLĄD', 'SUNDAY REVIEW')}</span><strong>{tr('Twój tydzień w pigułce', 'Your week at a glance')}</strong><small>{tr('Postępy, rutyny, czas i pomysły na następne dni.', 'Progress, routines, time and ideas for the days ahead.')}</small><button type="button" onClick={()=>{setWeeklyNudge(false);goPage('review');}}>{tr('Zobacz raport', 'View report')} <ArrowRight size={14}/></button></div>
      <button type="button" className="wr-notice-close" onClick={()=>setWeeklyNudge(false)} title={tr('Zamknij', 'Close')} aria-label={tr('Zamknij powiadomienie', 'Close notification')}><X size={17}/></button>
    </div>}
    {focus.active && !focusOpen && <><FocusDock title={focus.active.taskTitle} seconds={Math.floor(focus.elapsed.focusMs/1000)} phase={focus.active.phase} onOpen={()=>setFocusOpen(true)}/><button type="button" className="focus-dock-stop" onClick={()=>finishFocus(false)} title={tr('Zakończ Focus bez kończenia zadania', 'End Focus without completing the task')} aria-label={tr('Wyłącz aktywną sesję Focus', 'Stop the active Focus session')}>{tr('Wyłącz Focus ×', 'Stop Focus ×')}</button></>}
    {focus.active && focusOpen && (()=>{const focusTask=data.tasks.find(task=>task.id===focus.active?.taskId);return <FocusMode task={focusTask} session={focus.active} history={focus.history} focusMs={focus.elapsed.focusMs} breakMs={focus.elapsed.breakMs} breakElapsedMs={focus.breakElapsed}
      completionXp={focusTask && !focusTask.done ? taskXp(focusTask.duration, focusTask.category) : 0} focusXp={focusTask ? focusXp(focus.elapsed.focusMs/1000, focusTask.category) : 0}
      categories={categories} onPhase={focus.setPhase} onFinish={finishFocus} onClose={()=>setFocusOpen(false)}/>;})()}
    {activeAchievement&&<AchievementPopup achievement={activeAchievement} onClose={()=>setActiveAchievement(null)}/>}
    {reminderBanner&&<ReminderBanner item={reminderBanner} series={isTaskSeries(data.routines.find(r=>r.id===reminderBanner.sourceId))} onClose={closeReminderBanner} onOpen={()=>{reminders.markRead(reminderBanner.id);openNotificationItem(reminderBanner);setReminderBanner(null);}}/>}
    {!settingsOpen&&<CloudSyncBanner api={cloudSync} onResolve={openCloudSyncSettings}/>}
    {toast&&<div className="toast" role="status"><span><Sparkles size={17}/></span>{toast}{toastAction?.message===toast&&<button type="button" className="toast-action" onClick={()=>{const action=toastAction;setToast('');setToastAction(null);action.run();}}>{toastAction.label}</button>}<button onClick={()=>setToast('')} aria-label={tr('Zamknij', 'Close')}><X size={15}/></button></div>}
    {mobileMore && <>
      <button className="mobile-more-scrim" type="button" aria-label={tr('Zamknij dodatkowe menu', 'Close the extra menu')} onClick={()=>setMobileMore(false)} />
      <nav className="mobile-more-sheet" aria-label={tr('Pozostałe moduły Momentum', 'Other Momentum modules')}>
        <div className="mobile-more-heading"><strong>{tr('Twoje Momentum', 'Your Momentum')}</strong><button type="button" aria-label={tr('Zamknij menu', 'Close menu')} onClick={()=>setMobileMore(false)}><X size={20}/></button></div>
        {NAV.filter(n => !(['overview','calendar','tasks','projects'] as Page[]).includes(n.id)).map(n =>
          <button key={n.id} type="button" onClick={()=>goPage(n.id)} className={page===n.id?'active':''}>
            <n.icon size={21}/><span>{n.label}</span><ChevronRight size={16}/>
          </button>
        )}
        <button type="button" onClick={()=>{setMobileMore(false);setSettingsOpen(true);}}><Settings2 size={21}/><span>{tr('Ustawienia i kopie danych', 'Settings & backups')}</span><ChevronRight size={16}/></button>
      </nav>
    </>}
    {(page === 'overview' || page === 'calendar' || page === 'tasks') && <button type="button" className="momentum-mobile-fab" onClick={()=>setTaskDialog({date:referenceDate})} aria-label={tr('Nowe zadanie', 'New task')} title={tr('Dodaj zadanie', 'Add task')}><Plus size={28}/></button>}
    {page === 'routines' && <button type="button" className="momentum-mobile-fab" onClick={()=>setEditorDialog({})} aria-label={tr('Nowa rutyna', 'New routine')} title={tr('Dodaj rutynę', 'Add routine')}><Plus size={28}/></button>}
    <nav className="mobile-bottom-nav" aria-label={tr('Główna nawigacja mobilna', 'Main mobile navigation')}>
      {NAV.filter(n => (['overview','calendar','tasks','projects'] as Page[]).includes(n.id)).map(n =>
        <button key={n.id} type="button" className={page===n.id?'active':''} onClick={()=>goPage(n.id)} aria-current={page===n.id?'page':undefined}>
          <n.icon size={21}/><span>{n.id==='overview'?tr('Pulpit', 'Dashboard'):n.id==='calendar'?tr('Kalendarz', 'Calendar'):n.id==='tasks'?tr('Zadania', 'Tasks'):tr('Projekty', 'Projects')}</span>
        </button>
      )}
      <button type="button" className={mobileMore || (['routines','insights','review'] as Page[]).includes(page) ? 'active' : ''} onClick={()=>setMobileMore(prev=>!prev)} aria-expanded={mobileMore} aria-label={tr('Więcej funkcji', 'More features')}>
        <Menu size={21}/><span>{tr('Więcej', 'More')}</span>
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
function RightPanel({upcoming,routines,logFor,routineDateFor,routineXpFor,categories,onTask,onToggle,onSeries,onToggleSeries,onAdd,onRoutine,onPreset}:{upcoming:TodoEntry[];routines:Routine[];logFor:(r:Routine)=>ReturnType<typeof emptyLog>;/** Dzień z harmonogramu dzisiejszego wystąpienia — od niego zależą kroki. */routineDateFor:(r:Routine)=>string;routineXpFor:(r:Routine)=>number;categories:ReturnType<typeof useAppData>[0]['categories'];onTask:(t:Task)=>void;onToggle:(id:string)=>void;onSeries:(entry:SeriesToday)=>void;onToggleSeries:(entry:SeriesToday)=>void;onAdd:()=>void;onRoutine:(r:Routine)=>void;onPreset:(title:string,category:CategoryKey,icon:IconKey,duration:number)=>void}) {
  const currentItems=upcoming.slice(0,5);
  const startDrag=(e:React.DragEvent,payload:string)=>{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/momentum',payload);e.dataTransfer.setData('text/plain',payload);};
  return <aside className="right-panel"><div className="right-panel-header"><div><span className="eyebrow">{tr('TWÓJ DZISIEJSZY PLAN', 'YOUR PLAN FOR TODAY')}</span><h3>{tr('Do zrobienia', 'To do')} <span>✦</span></h3></div><button className="tiny-icon-btn" title={tr('Dodaj zadanie', 'Add task')} onClick={onAdd}><Plus size={18}/></button></div><div className="mini-task-list">{currentItems.length?currentItems.map(entry=>{
    if(entry.type==='series') return <div key={`series:${entry.routine.id}:${entry.occurrenceDate}`} className="mini-task mini-task--series" draggable title={tr('Przeciągnij na kalendarz, aby przenieść to wystąpienie', 'Drag onto the calendar to move this occurrence')} onDragStart={e=>startDrag(e,JSON.stringify({kind:'routine',id:entry.routine.id,sourceDate:entry.occurrenceDate}))}><button className={`task-checkbox ${entry.done?'checked':''}`} aria-label={tr('Ukończ zadanie', 'Complete task')} onClick={()=>onToggleSeries(entry)}><Check size={13}/></button><button className="mini-task-icon-btn" onClick={()=>onSeries(entry)} aria-label={tr('Otwórz zadanie cykliczne', 'Open recurring task')}><TaskVisual icon={entry.routine.icon} image={entry.routine.image} category={entry.routine.category} categories={categories} size="mini"/></button><button className="mini-task-main" onClick={()=>onSeries(entry)}><strong>{entry.routine.title}</strong><small>{entry.time} · +{entry.xp} XP · <span className="mini-task-repeat"><Repeat2 size={11}/> {tr('cykliczne', 'recurring')}</span></small><CategoryBadge category={entry.routine.category} categories={categories} compact/></button><ChevronRight size={14}/></div>;
    const t=entry.task;
    return <div key={t.id} className="mini-task" draggable title={tr('Przeciągnij na kalendarz, aby zaplanować', 'Drag onto the calendar to schedule')} onDragStart={e=>startDrag(e,JSON.stringify({kind:'task',id:t.id,sourceDate:t.date}))}><button className={`task-checkbox ${t.done?'checked':''}`} aria-label={tr('Ukończ zadanie', 'Complete task')} onClick={()=>onToggle(t.id)}><Check size={13}/></button><button className="mini-task-icon-btn" onClick={()=>onTask(t)} aria-label={tr('Otwórz zadanie', 'Open task')}><TaskVisual icon={t.icon} image={t.image} category={t.category} categories={categories} size="mini"/></button><button className="mini-task-main" onClick={()=>onTask(t)}><strong>{t.title}</strong><small>{t.time??(t.date?tr('Bez godziny', 'No time set'):'Inbox')} · +{taskXp(t.duration,t.category)} XP</small><CategoryBadge category={t.category} categories={categories} compact/></button><ChevronRight size={14}/></div>}):<div className="empty-tasks"><CheckCircle2 size={26}/><strong>{tr('Wszystko gotowe!', 'All done!')}</strong><span>{tr('Dodaj zadanie, kiedy masz nowy plan.', 'Add a task when you have a new plan.')}</span></div>}</div><button className="right-link" onClick={onAdd}><Plus size={15}/> {tr('Dodaj zadanie', 'Add task')}</button><div className="right-divider"/><div className="right-panel-header"><div><span className="eyebrow">{tr('CODZIENNE NAWYKI', 'DAILY HABITS')}</span><h3>{tr('Moje rutyny', 'My routines')}</h3></div><span className="right-badge">{routines.length}</span></div><div className="mini-routines">{routines.map(r=>{const log=logFor(r),isDone=log.completed;const stepsToday=routineStepsOnDate(r.steps,routineDateFor(r)),checkedToday=stepsToday.filter(s=>log.checkedStepIds.includes(s.id)).length;return <button key={r.id} className="mini-routine" onClick={()=>onRoutine(r)}><TaskVisual icon={r.icon} image={r.image} category={r.category} categories={categories} size="small" className="mini-routine-icon"/><span><strong>{r.title}</strong><small>{isDone?tr('Ukończona ✓', 'Completed ✓'):stepsToday.length?tr(`${checkedToday}/${stepsToday.length} kroków · +${routineXpFor(r)} XP`, `${checkedToday}/${stepsToday.length} ${plural(stepsToday.length, ['krok', 'kroki', 'kroków'], ['step', 'steps'])} · +${routineXpFor(r)} XP`):tr(`Bez kroków · +${routineXpFor(r)} XP`, `No steps · +${routineXpFor(r)} XP`)}</small><CategoryBadge category={r.category} categories={categories} compact/></span><ArrowUpRight size={16}/></button>;})}</div><div className="right-divider"/><div className="quick-section"><div className="eyebrow">{tr('JEDNYM KLIKNIĘCIEM', 'ONE CLICK AWAY')}</div><h3>{tr('Szybkie dodawanie', 'Quick add')}</h3><div className="quick-presets">{TASK_PRESETS.slice(1,5).map(p=><button key={p.title} onClick={()=>onPreset(p.title,p.category,p.icon,p.duration)}><TaskIcon name={p.icon} size={14}/>{p.title}<Plus size={14}/></button>)}</div></div><div className="right-tip"><Sparkles size={19}/><p><strong>{tr('Małe kroki się liczą.', 'Small steps count.')}</strong><br/>{tr('Nie musisz zrobić wszystkiego. Najważniejsze to ruszyć naprzód.', 'You don’t have to do it all. What matters most is moving forward.')}</p></div></aside>;
}
type SeriesListItem = { routine: Routine; next: ReturnType<typeof nextOccurrence> };
function TaskGroups({tasks,seriesToday,seriesList,categories,projects,onEdit,onToggle,onOpenSeries,onToggleSeries,onAdd}:{tasks:Task[];seriesToday:SeriesToday[];seriesList:SeriesListItem[];projects:Project[];categories:ReturnType<typeof useAppData>[0]['categories'];onEdit:(t:Task)=>void;onToggle:(id:string)=>void;onOpenSeries:(routineId:string,occurrenceDate?:string)=>void;onToggleSeries:(entry:SeriesToday)=>void;onAdd:()=>void}){
  const today=todayKey();
  type Row = { type: 'task'; task: Task } | { type: 'occurrence'; entry: SeriesToday } | ({ type: 'series' } & SeriesListItem);
  const sortTasks=(items:Task[])=>[...items].sort((a,b)=>(a.date??'').localeCompare(b.date??'')||(a.time??'z').localeCompare(b.time??'z'));
  // „Dzisiaj” łączy zwykłe zadania i dzisiejsze wystąpienia zadań cyklicznych, posortowane po godzinie.
  const todayRows:Row[]=[...tasks.filter(t=>t.date===today).map(task=>({type:'task' as const,task})),...seriesToday.map(entry=>({type:'occurrence' as const,entry}))]
    .sort((a,b)=>(a.type==='task'?a.task.time??'z':a.type==='occurrence'?a.entry.time:'z').localeCompare(b.type==='task'?b.task.time??'z':b.type==='occurrence'?b.entry.time:'z'));
  // Logika (klasa, klucz) opiera się na `id` — tytuł zależy od języka.
  const groups:{id:string;title:string;rows:Row[]}[]=[
    {id:'today',title:tr('Dzisiaj', 'Today'),rows:todayRows},
    {id:'unscheduled',title:tr('Do zaplanowania', 'Unscheduled'),rows:sortTasks(tasks.filter(t=>!t.date)).map(task=>({type:'task' as const,task}))},
    {id:'later',title:tr('Zaplanowane na inne dni', 'Scheduled for other days'),rows:sortTasks(tasks.filter(t=>t.date&&t.date!==today)).map(task=>({type:'task' as const,task}))},
    {id:'series',title:tr('Cykliczne', 'Recurring'),rows:seriesList.map(item=>({type:'series' as const,...item}))},
  ];
  const renderRow=(row:Row)=>{
    if(row.type==='task'){const t=row.task;return <div className={`task-row ${t.done?'task-row--done':''}`} key={t.id}><button className={`task-checkbox ${t.done?'checked':''}`} aria-label={tr('Zmień status', 'Change status')} onClick={()=>onToggle(t.id)}><Check size={16}/></button><button className="task-row-icon" onClick={()=>onEdit(t)}><TaskVisual icon={t.icon} image={t.image} category={t.category} categories={categories} size="medium"/></button><button className="task-row-body" onClick={()=>onEdit(t)}><strong>{t.title}</strong><span className="task-row-sub"><CategoryBadge category={t.category} categories={categories} compact/>{t.date&&<span className="task-row-meta">{t.date===today?tr('Dzisiaj', 'Today'):t.date}</span>}{t.time&&<span className="task-row-meta task-row-time">{t.time}</span>}{t.projectId&&<span className="task-row-project"><FolderKanban size={12}/>{projects.find(p=>p.id===t.projectId)?.title??tr('Projekt', 'Project')}</span>}</span></button><div className="task-row-xp"><Zap size={14}/> {taskXp(t.duration,t.category)} XP</div><button className="task-row-edit" onClick={()=>onEdit(t)} title={tr('Edytuj', 'Edit')}><MoreHorizontal size={20}/></button></div>;}
    if(row.type==='occurrence'){const {entry}=row;const r=entry.routine;const open=()=>onOpenSeries(r.id,entry.occurrenceDate);return <div className={`task-row task-row--series ${entry.done?'task-row--done':''}`} key={`occurrence:${r.id}:${entry.occurrenceDate}`}><button className={`task-checkbox ${entry.done?'checked':''}`} aria-label={tr('Zmień status', 'Change status')} onClick={()=>onToggleSeries(entry)}><Check size={16}/></button><button className="task-row-icon" onClick={open}><TaskVisual icon={r.icon} image={r.image} category={r.category} categories={categories} size="medium"/></button><button className="task-row-body" onClick={open}><strong>{r.title}</strong><span className="task-row-sub"><CategoryBadge category={r.category} categories={categories} compact/><span className="task-row-meta">{tr('Dzisiaj', 'Today')}</span><span className="task-row-meta task-row-time">{entry.time}</span><span className="task-row-repeat"><Repeat2 size={12}/>{describeRepeat(r)}</span></span></button><div className="task-row-xp"><Zap size={14}/> {entry.xp} XP</div><button className="task-row-edit" onClick={open} title={tr('Edytuj', 'Edit')}><MoreHorizontal size={20}/></button></div>;}
    const r=row.routine;const open=()=>onOpenSeries(r.id);
    return <div className={`task-row task-row--series ${row.next?'':'task-row--ended'}`} key={`series:${r.id}`}><span className="task-row-series-mark" aria-hidden="true"><Repeat2 size={13}/></span><button className="task-row-icon" onClick={open}><TaskVisual icon={r.icon} image={r.image} category={r.category} categories={categories} size="medium"/></button><button className="task-row-body" onClick={open}><strong>{r.title}</strong><span className="task-row-sub"><CategoryBadge category={r.category} categories={categories} compact/><span className="task-row-repeat"><Repeat2 size={12}/>{describeRepeat(r)} · {r.time}</span><span className="task-row-meta task-row-next">{row.next?`${tr('Następnie:', 'Next:')} ${shortDayLabel(row.next.date,today)}${row.next.time!==r.time?` ${row.next.time}`:''}`:tr('Seria zakończona', 'Series ended')}</span></span></button><div className="task-row-xp"><Zap size={14}/> {taskXp(r.duration,r.category)} XP</div><button className="task-row-edit" onClick={open} title={tr('Edytuj serię', 'Edit series')}><MoreHorizontal size={20}/></button></div>;
  };
  const empty=tasks.length===0&&seriesToday.length===0&&seriesList.length===0;
  return <div className="task-groups">{groups.filter(g=>g.rows.length>0).map(group=><section className={`task-group ${group.id==='series'?'task-group--series':''}`} key={group.id}><div className="task-group-heading"><h3>{group.title}<span>{group.rows.length}</span></h3></div><div className="task-rows">{group.rows.map(renderRow)}</div></section>)}{empty&&<div className="empty-list"><Target size={38}/><h3>{tr('Tu jest miejsce na nowe pomysły.', 'This is the place for new ideas.')}</h3><p>{tr('Dodaj zadanie, zaplanuj termin i ruszaj po swoje.', 'Add a task, pick a date and go for it.')}</p><button className="btn btn--primary" onClick={onAdd}><Plus size={17}/> {tr('Dodaj pierwsze zadanie', 'Add your first task')}</button></div>}</div>;
}
function AchievementPopup({ achievement, onClose }: { achievement: AchievementView; onClose: () => void }) {
  const Icon = achievement.icon;
  return <div className="achievement-popup" role="dialog" aria-live="polite">
    <div className="achievement-popup-confetti" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => <span key={index} style={{ '--i': index } as React.CSSProperties} />)}
    </div>
    <button className="achievement-popup-close" aria-label={tr('Zamknij powiadomienie', 'Close notification')} onClick={onClose}><X size={16} /></button>
    <div className="achievement-popup-art" style={{ '--achievement-accent': achievement.accent, '--achievement-tint': achievement.tint } as React.CSSProperties}>
      <img src={achievement.art} alt="" loading="lazy" />
      <span className="achievement-popup-art-badge"><Icon size={16} /></span>
    </div>
    <div className="achievement-popup-body">
      <span className="eyebrow eyebrow--indigo">{tr('NOWE OSIĄGNIĘCIE', 'NEW ACHIEVEMENT')}</span>
      <h3>{achievement.title}</h3>
      <p>{achievement.description}</p>
      <div className="achievement-popup-reward">{achievement.reward}</div>
    </div>
  </div>;
}

export default App;
