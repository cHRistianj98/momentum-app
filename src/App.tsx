import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Award, BarChart3, Bell, CalendarDays, Check, CheckCircle2,
  ChevronRight, Clock3, Crown, Flame, Focus, Gem, LayoutDashboard, Menu, Moon, MoreHorizontal,
  Plus, Rocket, RotateCcw, Search, Settings2, ShieldCheck, Sparkles, Star, Sun, Target, Trash2, Trophy, Wallet, X, Zap,
} from 'lucide-react';
import { CalendarView, type CalendarBlock } from './components/CalendarView';
import { ResizeConfirmModal } from './components/ResizeConfirmModal';
import { TaskModal } from './components/TaskModal';
import { emptyLog, RoutineEditor, routineOccurs, RoutineSession } from './components/RoutineModal';
import { TaskIcon } from './lib/icons';
import { CategoryBadge, TaskVisual } from './components/VisualIdentity';
import { formatDuration, monthTitle, parseDate, shiftDate, todayKey } from './lib/date';
import { TASK_PRESETS } from './lib/seed';
import { eraseStoredData, resolveCategories, useAppData } from './lib/storage';
import type { CategoryKey, IconKey, Page, Routine, Task } from './types';

const NAV: { id: Page; label: string; icon: typeof CalendarDays }[] = [
  { id: 'overview', label: 'Pulpit', icon: LayoutDashboard },
  { id: 'calendar', label: 'Kalendarz', icon: CalendarDays },
  { id: 'tasks', label: 'Moje zadania', icon: CheckCircle2 },
  { id: 'routines', label: 'Rutyny', icon: RotateCcw },
  { id: 'insights', label: 'Statystyki', icon: BarChart3 },
];
const CATEGORY_KEYS: CategoryKey[] = ['unpaid','potential','income'];
const LEVEL_XP = 500;

type TaskDialog = { id?: string; date?: string | null; time?: string | null };
type RoutineDialog = { id: string; date: string };
type RoutineEditorDialog = { id?: string };
type PendingResize = { block: CalendarBlock; nextDuration: number };

function H({ children }: { children: React.ReactNode }) { return <span className="heading-spark">{children}</span>; }

type AchievementView = {
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

type RankView = {
  id: string;
  title: string;
  subtitle: string;
  minXp: number;
  accent: string;
  tint: string;
  icon: typeof Trophy;
  art: string;
};

const RANKS: RankView[] = [
  { id: 'spark', title: 'Iskra Startu', subtitle: 'Zaczynasz świadomie planować swój czas.', minXp: 0, accent: '#7f72ff', tint: '#f0edff', icon: Sparkles, art: '/assets/progression/rank-spark.svg' },
  { id: 'builder', title: 'Budowniczy Nawyków', subtitle: 'Tworzysz solidne fundamenty codziennej regularności.', minXp: 500, accent: '#3aa0ff', tint: '#edf6ff', icon: ShieldCheck, art: '/assets/progression/rank-builder.svg' },
  { id: 'pilot', title: 'Pilot Progresu', subtitle: 'Sterujesz tygodniem z coraz większą pewnością.', minXp: 1200, accent: '#ff8a57', tint: '#fff3ec', icon: Rocket, art: '/assets/progression/rank-pilot.svg' },
  { id: 'master', title: 'Mistrz Momentum', subtitle: 'Systematyczność zaczyna naprawdę procentować.', minXp: 2500, accent: '#26b274', tint: '#ecfaf3', icon: Crown, art: '/assets/progression/rank-master.svg' },
  { id: 'legend', title: 'Legenda Momentum', subtitle: 'Twoje dni działają jak dopracowany system.', minXp: 5000, accent: '#f3b23c', tint: '#fff8e8', icon: Gem, art: '/assets/progression/rank-legend.svg' },
];

function resolveRank(totalXp: number) {
  return [...RANKS].reverse().find(rank => totalXp >= rank.minXp) ?? RANKS[0];
}

function resolveNextRank(totalXp: number) {
  return RANKS.find(rank => rank.minXp > totalXp) ?? null;
}

function buildAchievements(data: ReturnType<typeof useAppData>[0], totalXp: number, streak: number): AchievementView[] {
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
  const incomeMinutes = data.tasks.filter(task => task.done && task.category === 'income').reduce((sum, task) => sum + task.duration, 0);
  return [
    { id: 'first-step', title: 'Pierwszy krok', description: 'Ukończ pierwsze zadanie albo rutynę.', reward: '+ motywacja', progress: completedTasks + completedRoutineSessions, target: 1, unlocked: completedTasks + completedRoutineSessions >= 1, icon: Award, accent: '#7f72ff', tint: '#f2efff', art: '/assets/progression/ach-first-step.svg' },
    { id: 'xp-500', title: 'Poziom 2', description: 'Zdobądź 500 XP i wejdź na kolejny poziom.', reward: '+ nowa ranga', progress: totalXp, target: 500, unlocked: totalXp >= 500, icon: Trophy, accent: '#6a5cff', tint: '#f0edff', art: '/assets/progression/ach-xp-500.svg' },
    { id: 'streak-3', title: 'Seria 3 dni', description: 'Utrzymaj ciągłość działania przez 3 dni.', reward: '+ ogień serii', progress: streak, target: 3, unlocked: streak >= 3, icon: Flame, accent: '#ff7d73', tint: '#fff0ef', art: '/assets/progression/ach-streak-3.svg' },
    { id: 'focus-180', title: '3 godziny skupienia', description: 'Ukończ łącznie co najmniej 180 minut zaplanowanych bloków.', reward: '+ fokus', progress: completedMinutes, target: 180, unlocked: completedMinutes >= 180, icon: Target, accent: '#4e97ff', tint: '#edf4ff', art: '/assets/progression/ach-focus-180.svg' },
    { id: 'planner-10', title: 'Planista', description: 'Nadaj godzinę przynajmniej 10 zadaniom.', reward: '+ kontrola planu', progress: scheduledTasks, target: 10, unlocked: scheduledTasks >= 10, icon: CalendarDays, accent: '#a564ff', tint: '#f5efff', art: '/assets/progression/ach-planner-10.svg' },
    { id: 'income-120', title: 'Monetyzacja', description: 'Ukończ 120 minut zadań przynoszących przychód.', reward: '+ złota odznaka', progress: incomeMinutes, target: 120, unlocked: incomeMinutes >= 120, icon: Wallet, accent: '#1ca36f', tint: '#eaf8f1', art: '/assets/progression/ach-income-120.svg' },
    { id: 'active-7', title: 'Tydzień progresu', description: 'Bądź aktywny w 7 różnych dniach.', reward: '+ wytrwałość', progress: activeDays, target: 7, unlocked: activeDays >= 7, icon: Star, accent: '#f0a52f', tint: '#fff8e8', art: '/assets/progression/ach-active-7.svg' },
  ];
}

function App() {
  const [data, setData] = useAppData();
  const categories = useMemo(() => resolveCategories(data.categories), [data.categories]);
  const [page, setPage] = useState<Page>('overview');
  const [referenceDate, setReferenceDate] = useState(todayKey());
  const [calendarMode, setCalendarMode] = useState<'day' | 'week'>('week');
  const [taskDialog, setTaskDialog] = useState<TaskDialog | null>(null);
  const [routineDialog, setRoutineDialog] = useState<RoutineDialog | null>(null);
  const [editorDialog, setEditorDialog] = useState<RoutineEditorDialog | null>(null);
  const [pendingResize, setPendingResize] = useState<PendingResize | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [taskFilter, setTaskFilter] = useState<'all' | 'today' | 'inbox' | 'completed'>('all');
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [achievementQueue, setAchievementQueue] = useState<AchievementView[]>([]);
  const [activeAchievement, setActiveAchievement] = useState<AchievementView | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const today = todayKey();
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
  const dueRoutines = data.routines.filter(r => routineOccurs(r, today));
  const logFor = (id: string, date: string) => data.routineLogs[`${id}:${date}`] ?? emptyLog(`${id}:${date}`);
  const completedToday = todayTasks.filter(t => t.done).length + dueRoutines.filter(r => logFor(r.id,today).completed).length;
  const totalToday = todayTasks.length + dueRoutines.length;
  const completionPct = totalToday ? Math.round(completedToday/totalToday*100) : 0;
  const totalXp = useMemo(() => data.tasks.filter(t => t.done).reduce((s,t) => s+t.xp,0) + Object.entries(data.routineLogs).reduce((s,[key,log]) => {
    if (!log.completed) return s;
    const routineId = key.split(':')[0];
    return s + (data.routines.find(r => r.id === routineId)?.xp ?? 0);
  },0),[data]);
  const currentLevel = Math.floor(totalXp / LEVEL_XP) + 1;
  const xpIntoLevel = totalXp % LEVEL_XP;
  const xpToday = todayTasks.filter(t=>t.done).reduce((s,t)=>s+t.xp,0) + dueRoutines.filter(r=>logFor(r.id,today).completed).reduce((s,r)=>s+r.xp,0);
  const focusMinutes = todayTasks.filter(t=>t.done && t.time).reduce((s,t)=>s+t.duration,0) + dueRoutines.filter(r=>logFor(r.id,today).completed).reduce((s,r)=>s+(logFor(r.id,today).durationOverride ?? r.duration),0);
  const daysStreak = useMemo(() => {
    // Serie liczymy z ostatnich dni, w których ukończono choć jedno zadanie lub rutynę.
    const dates = new Set([...data.tasks.filter(t=>t.done && t.date).map(t=>t.date!), ...Object.values(data.routineLogs).filter(l=>l.completed).map(l=>l.id.split(':').slice(1).join(':'))]);
    let streak=0, cursor=dates.has(today)?today:shiftDate(today,-1);
    while (dates.has(cursor) && streak<365) {streak++;cursor=shiftDate(cursor,-1);}
    return streak;
  },[data,today]);
  const achievements = useMemo(() => buildAchievements(data, totalXp, daysStreak), [data, totalXp, daysStreak]);
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
    const seen = new Set<string>(JSON.parse(window.localStorage.getItem(storageKey) ?? '[]'));
    const fresh = achievements.filter(achievement => achievement.unlocked && !seen.has(achievement.id));
    if (!fresh.length) return;
    fresh.forEach(achievement => seen.add(achievement.id));
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(seen)));
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

  function toggleTask(id: string) {
    const task=data.tasks.find(t=>t.id===id);
    if (!task) return;
    setData(prev=>({...prev,tasks:prev.tasks.map(t=>t.id===id?{...t,done:!t.done}:t)}));
    setToast(task.done ? 'Zadanie przywrócone do realizacji' : `Świetnie! +${task.xp} XP za „${task.title}”`);
  }
  function saveTask(task: Task) {
    const existing=data.tasks.find(t=>t.id===task.id);
    setData(prev=>({...prev,tasks:existing?prev.tasks.map(t=>t.id===task.id?task:t):[...prev.tasks,task]}));
    setTaskDialog(null);
    setToast(existing?'Zmiany w zadaniu zapisane':'Nowe zadanie dodane');
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
    setData(prev=>({...prev,routines:prev.routines.some(r=>r.id===routine.id)?prev.routines.map(r=>r.id===routine.id?routine:r):[...prev.routines,routine]}));
    setEditorDialog(null);setRoutineDialog(null);setToast('Rutyna zapisana');
  }
  function deleteRoutine(id: string) {
    setData(prev=>({...prev,routines:prev.routines.filter(r=>r.id!==id),routineLogs:Object.fromEntries(Object.entries(prev.routineLogs).filter(([key])=>!key.startsWith(`${id}:`)))}));
    setEditorDialog(null);setRoutineDialog(null);setToast('Rutyna usunięta');
  }
  function updateRoutineLog(id: string, date: string, fn: (log: ReturnType<typeof emptyLog>) => ReturnType<typeof emptyLog>) {
    const key=`${id}:${date}`;
    setData(prev=>({...prev,routineLogs:{...prev.routineLogs,[key]:fn(prev.routineLogs[key]??emptyLog(key))}}));
  }
  function toggleRoutineStep(id: string,date: string,stepId: string) {
    updateRoutineLog(id,date,log=>({...log,checkedStepIds:log.checkedStepIds.includes(stepId)?log.checkedStepIds.filter(v=>v!==stepId):[...log.checkedStepIds,stepId]}));
  }
  function completeRoutine(id: string,date: string) {
    const routine=data.routines.find(r=>r.id===id);if(!routine)return;
    const log=logFor(id,date);
    if (log.completed || routine.steps.some(s=>!log.checkedStepIds.includes(s.id))) return;
    updateRoutineLog(id,date,l=>({...l,completed:true,completedAt:new Date().toISOString()}));
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
      const key = `${block.sourceId}:${block.date}`;
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

  function openBlock(block: CalendarBlock) {
    if (block.kind==='task')setTaskDialog({id:block.sourceId});
    else setRoutineDialog({id:block.sourceId,date:block.date});
  }
  function toggleBlock(block:CalendarBlock) {
    if(block.kind==='task')toggleTask(block.sourceId);
    else setRoutineDialog({id:block.sourceId,date:block.date});
  }
  const calendarBlocks: CalendarBlock[] = useMemo(() => {
    const blocks: CalendarBlock[] = data.tasks.filter(t=>t.date && t.time).map(t=>({id:t.id,kind:'task',sourceId:t.id,title:t.title,icon:t.icon,image:t.image,category:t.category,date:t.date!,time:t.time!,duration:t.duration,done:t.done}));
    // Wirtualne wystąpienia rutyn: jeden szablon, osobny log każdego dnia.
    for (let offset=-45;offset<=45;offset++) {
      const d=shiftDate(referenceDate,offset);
      for(const r of data.routines)if(routineOccurs(r,d)) {
        blocks.push({id:`routine:${r.id}:${d}`,kind:'routine',sourceId:r.id,title:r.title,icon:r.icon,image:r.image,category:r.category,date:d,time:r.time,duration:data.routineLogs[`${r.id}:${d}`]?.durationOverride ?? r.duration,done:!!data.routineLogs[`${r.id}:${d}`]?.completed});
      }
    }
    return blocks;
  },[data,referenceDate]);

  const upcomingTasks = data.tasks.filter(t=>!t.done && (t.date === today || !t.date)).sort((a,b)=>{
    if(a.date&&!b.date)return -1;if(!a.date&&b.date)return 1;
    if(a.time&&!b.time)return -1;if(!a.time&&b.time)return 1;
    return (a.time??'').localeCompare(b.time??'');
  });

  function goPage(id:Page){setPage(id);setMobileNav(false);}
  function addPreset(title:string,category:CategoryKey,icon:IconKey,duration:number,xp:number){
    saveTask({id:crypto.randomUUID(),title,description:'',category,icon,date:null,time:null,duration,xp,done:false,createdAt:new Date().toISOString()});
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
      <div className="sidebar-foot">Momentum v0.4.1 <span>✦</span> Made for progress</div>
    </aside>
    {mobileNav && <button className="sidebar-scrim" aria-label="Zamknij menu" onClick={()=>setMobileNav(false)}/>}
    <div className="app-workspace">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-btn" aria-label="Otwórz menu" onClick={()=>setMobileNav(true)}><Menu size={21}/></button><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14}/><strong>{NAV.find(n=>n.id===page)?.label}</strong></div></div><div className="topbar-right"><label className="global-search"><Search size={17}/><input ref={searchRef} aria-label="Szukaj zadań" placeholder="Szukaj zadań..." value={search} onChange={e=>{setSearch(e.target.value);if(e.target.value)goPage('tasks');}}/><span>⌘ K</span></label><button className="icon-btn theme-btn" aria-label="Przełącz motyw" title="Zmień motyw" onClick={()=>setData(p=>({...p,theme:p.theme==='light'?'dark':'light'}))}>{data.theme==='light'?<Moon size={19}/>:<Sun size={19}/>}</button><button className="icon-btn notification-btn" aria-label="Informacje" title="Dane zapisywane są lokalnie" onClick={()=>setToast('Twoje dane zapisują się automatycznie w tej przeglądarce')}><Bell size={19}/><i/></button><div className="topbar-avatar">M</div></div></header>
      <main className="main-content">
        {page==='overview' && <>
          <div className="welcome-heading"><div><div className="eyebrow eyebrow--indigo">TWOJA PRZESTRZEŃ DO DZIAŁANIA <Sparkles size={13}/></div><h1>Twój dzień. <H>Twój progres.</H></h1><p>Każdy mały krok przybliża Cię do większego celu. Działaj po swojemu.</p></div><button className="btn btn--primary add-top" onClick={()=>setTaskDialog({date:today})}><Plus size={18}/> Nowe zadanie</button></div>
          <section className="welcome-banner"><div className="welcome-banner-content"><div className="banner-tag"><span/> TWOJA PODRÓŻ TRWA</div><h2>Masz dziś wszystko,<br/>żeby zrobić coś wielkiego<span>.</span></h2><p>Skup się na tym, co ma znaczenie. Resztą zajmie się Momentum.</p><button onClick={()=>{goPage('calendar');setCalendarMode('day');setReferenceDate(today);}}>Zaplanuj swój dzień <ArrowRight size={16}/></button></div><div className="hero-illustration" aria-hidden="true"><div className="hero-orbit hero-orbit--1"/><div className="hero-orbit hero-orbit--2"/><div className="hero-main-orb"><Zap size={76} strokeWidth={1.3} fill="currentColor"/></div><div className="hero-star star-a">✦</div><div className="hero-star star-b">✧</div><div className="hero-mini-card"><span>✦</span> +{xpToday} XP today <ArrowUpRight size={15}/></div><div className="hero-chip">LEVEL {currentLevel}</div></div></section>
          <div className="stats-grid"><StatCard label="Ukończone dzisiaj" main={`${completedToday} / ${totalToday}`} detail={`${completionPct}% dzisiejszego planu`} icon={CheckCircle2} iconClass="mint" progress={completionPct}/><StatCard label="Czas w skupieniu" main={formatDuration(focusMinutes)} detail="Ukończone bloki czasowe" icon={Focus} iconClass="purple"/><StatCard label="Zdobyte doświadczenie" main={`+${xpToday} XP`} detail={`Poziom ${currentLevel} · ${LEVEL_XP-xpIntoLevel} XP do awansu`} icon={Zap} iconClass="amber"/></div>
          <div className="content-split"><CalendarView referenceDate={referenceDate} onChangeDate={setReferenceDate} blocks={calendarBlocks} categories={categories} mode="day" onChangeMode={m=>{if(m==='week')goPage('calendar');setCalendarMode(m);}} onAddAt={(date,time)=>setTaskDialog({date,time})} onOpenBlock={openBlock} onToggleBlock={toggleBlock} onDropBlock={(kind,id,date,time)=>{if(kind==='task')updateTaskSchedule(id,date,time);}} onResizeBlock={resizeBlock} compact/><RightPanel upcoming={upcomingTasks} routines={dueRoutines} logFor={r=>logFor(r.id,today)} categories={categories} onTask={t=>setTaskDialog({id:t.id})} onToggle={toggleTask} onAdd={()=>setTaskDialog({date:today})} onRoutine={r=>setRoutineDialog({id:r.id,date:today})} onPreset={addPreset}/></div>
        </>}
        {page==='calendar'&&<><PageHeading kicker="TWÓJ CZAS MA ZNACZENIE" title="Kalendarz" accent=" & timeblocking" description="Zaplanuj dzień, przeciągaj zadania między godzinami i obserwuj swój progres. Kliknij puste miejsce, aby dodać blok."/><div className="calendar-page-layout"><CalendarView referenceDate={referenceDate} onChangeDate={setReferenceDate} blocks={calendarBlocks} categories={categories} mode={calendarMode} onChangeMode={setCalendarMode} onAddAt={(date,time)=>setTaskDialog({date,time})} onOpenBlock={openBlock} onToggleBlock={toggleBlock} onDropBlock={(kind,id,date,time,sourceDate)=>{if(kind==='task')updateTaskSchedule(id,date,time);else if(sourceDate!==date)setToast('Przesuwanie całych rutyn między dniami będzie dostępne w kolejnej wersji');}} onResizeBlock={resizeBlock}/><RightPanel upcoming={upcomingTasks} routines={dueRoutines} logFor={r=>logFor(r.id,today)} categories={categories} onTask={t=>setTaskDialog({id:t.id})} onToggle={toggleTask} onAdd={()=>setTaskDialog({date:today})} onRoutine={r=>setRoutineDialog({id:r.id,date:today})} onPreset={addPreset}/></div></>}
        {page==='tasks'&&<><PageHeading kicker="MAŁE KROKI, WIELKIE EFEKTY" title="Moje" accent=" zadania" description="Wszystkie Twoje zadania w jednym miejscu. Zaplanuj je lub zrealizuj od razu." action={<button className="btn btn--primary" onClick={()=>setTaskDialog({})}><Plus size={18}/> Dodaj zadanie</button>}/><div className="tasks-page"><div className="task-filters">{([{id:'all',label:'Wszystkie'},{id:'today',label:'Na dzisiaj'},{id:'inbox',label:'Inbox'},{id:'completed',label:'Ukończone'}] as const).map(f=><button key={f.id} className={taskFilter===f.id?'active':''} onClick={()=>setTaskFilter(f.id)}>{f.label}{f.id==='inbox'&&<span>{data.tasks.filter(t=>!t.date&&!t.done).length}</span>}</button>)}</div><TaskGroups tasks={data.tasks.filter(t=>(!search||t.title.toLocaleLowerCase('pl-PL').includes(search.toLocaleLowerCase('pl-PL')))&&(taskFilter==='all'||(taskFilter==='today'&&t.date===today)||(taskFilter==='inbox'&&!t.date&&!t.done)||(taskFilter==='completed'&&t.done)))} categories={categories} onEdit={t=>setTaskDialog({id:t.id})} onToggle={toggleTask} onAdd={()=>setTaskDialog({})}/></div></>}
        {page==='routines'&&<><PageHeading kicker="KONSEKWENCJA TWORZY NAWYKI" title="Twoje" accent=" rutyny" description="Jeden prosty rytuał, wiele małych zwycięstw. Kończ wszystkie kroki jednym kliknięciem." action={<button className="btn btn--primary" onClick={()=>setEditorDialog({})}><Plus size={18}/> Nowa rutyna</button>}/><div className="routines-intro"><div><span>✦ CODZIENNY RYTM</span><h3>Nie musisz robić wszystkiego naraz.</h3><p>Zaznacz kolejne kroki, a po zakończeniu rutyny zaktualizujemy kalendarz i XP automatycznie.</p></div><div className="routine-intro-ornament">☼</div></div><div className="routine-cards">{data.routines.map(r=>{const occurs=routineOccurs(r,today),log=logFor(r.id,today),style=(categories[r.category] ?? categories.unpaid);return <button key={r.id} className="routine-card" onClick={()=>setRoutineDialog({id:r.id,date:today})}><TaskVisual icon={r.icon} image={r.image} category={r.category} categories={categories} size="large" className="routine-icon-large"/><div className="routine-card-top"><span className="routine-card-frequency">{r.weekdays.length===7?'Codziennie':`${r.weekdays.length} dni w tygodniu`}</span><CategoryBadge category={r.category} categories={categories} compact/></div><h3>{r.title}</h3><p>{r.description}</p><div className="routine-mini-stats"><span><Clock3 size={15}/> {r.time} · {r.duration} min</span><span><Zap size={14}/> +{r.xp} XP</span></div><div className="routine-card-progress"><div><span style={{width:`${log.checkedStepIds.length/Math.max(r.steps.length,1)*100}%`,background:style.color}}/></div><small>{log.completed?'Zakończona ✓':!occurs?'Poza planem na dziś':`${log.checkedStepIds.length}/${r.steps.length} kroków`}</small></div><div className="routine-card-cta">{log.completed?'Zobacz ukończoną': 'Otwórz rutynę'} <ArrowRight size={15}/></div></button>;})}<button className="routine-card routine-card--add" onClick={()=>setEditorDialog({})}><span><Plus size={27}/></span><strong>Stwórz własną rutynę</strong><p>Dodaj kroki, harmonogram i nagrodę XP.</p></button></div></>}
        {page==='insights'&&<><PageHeading kicker="POSTĘP TO SUMA MAŁYCH KROKÓW" title="Twoje" accent=" statystyki" description="Zobacz, gdzie inwestujesz swój czas i jak rośnie Twoja regularność."/><Insights data={data} totalXp={totalXp} currentLevel={currentLevel} streak={daysStreak} achievements={achievements} rank={currentRank} nextRank={nextRank}/></>}
        <footer className="main-footer"><span>✦ Momentum — małe kroki, wielki progres.</span><span>Wersja demonstracyjna · dane lokalne</span></footer>
      </main>
    </div>
    {pendingResize&&<ResizeConfirmModal title={pendingResize.block.title} date={pendingResize.block.date} time={pendingResize.block.time} previousDuration={pendingResize.block.duration} nextDuration={pendingResize.nextDuration} onOnlyThis={()=>confirmResize('single')} onAll={()=>confirmResize('all')} onCancel={()=>setPendingResize(null)}/>}
    {taskDialog&&<TaskModal task={taskDialog.id?data.tasks.find(t=>t.id===taskDialog.id):undefined} initialDate={taskDialog.date} initialTime={taskDialog.time} categories={categories} onSave={saveTask} onDelete={deleteTask} onClose={()=>setTaskDialog(null)}/>}
    {routineDialog&&(()=>{const r=data.routines.find(x=>x.id===routineDialog.id);return r?<RoutineSession routine={r} date={routineDialog.date} log={logFor(r.id,routineDialog.date)} duration={logFor(r.id,routineDialog.date).durationOverride ?? r.duration} categoryColor={(categories[r.category] ?? categories.unpaid).color} categories={categories} onToggleStep={step=>toggleRoutineStep(r.id,routineDialog.date,step)} onComplete={()=>completeRoutine(r.id,routineDialog.date)} onUndo={()=>updateRoutineLog(r.id,routineDialog.date,l=>({...l,completed:false,completedAt:undefined}))} onEdit={()=>{setEditorDialog({id:r.id});setRoutineDialog(null);}} onClose={()=>setRoutineDialog(null)}/>:null;})()}
    {editorDialog&&<RoutineEditor routine={editorDialog.id?data.routines.find(r=>r.id===editorDialog.id):undefined} categories={categories} onSave={saveRoutine} onDelete={deleteRoutine} onClose={()=>setEditorDialog(null)}/>}
    {settingsOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSettingsOpen(false);}}><div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Ustawienia"><div className="modal-heading"><div><span className="eyebrow">DOSTOSUJ MOMENTUM</span><h2>Twoje kolory i styl</h2></div><button className="icon-btn" onClick={()=>setSettingsOpen(false)} aria-label="Zamknij"><X size={20}/></button></div><p className="settings-desc">Trzy kategorie określają związek aktywności z przychodem — nie jej wartość dla zdrowia czy samopoczucia. Możesz zmieniać ich kolory.</p><div className="settings-colors">{CATEGORY_KEYS.map(c=><div className="settings-color-row" key={c}><label className="color-input-wrap" title="Wybierz kolor"><input type="color" value={categories[c].color} onChange={e=>setData(prev=>({...prev,categories:{...prev.categories,[c]:{...categories[c],color:e.target.value}}}))}/></label><div><strong>{categories[c].label}</strong><span>{categories[c].description}</span></div><span>{categories[c].color.toUpperCase()}</span></div>)}</div><div className="settings-divider"/><label className="theme-setting"><div><strong>Wygląd aplikacji</strong><small>Przełącz jasny i ciemny motyw.</small></div><button className="btn btn--secondary" onClick={()=>setData(p=>({...p,theme:p.theme==='light'?'dark':'light'}))}>{data.theme==='light'?<Moon size={16}/>:<Sun size={16}/>} {data.theme==='light'?'Ciemny':'Jasny'}</button></label><div className="settings-divider"/><div className="danger-zone"><div><strong>Wyczyść dane demo</strong><small>Przywróci przykładowe zadania, rutyny i kolory.</small></div><button className="btn btn--danger" onClick={()=>{if(window.confirm('Zresetować wszystkie dane do początkowych?')){eraseStoredData();window.location.reload();}}}><Trash2 size={15}/> Resetuj</button></div><div className="modal-bottom"><small>Dane zapisują się tylko w pamięci tej przeglądarki (localStorage).</small><button className="btn btn--primary" onClick={()=>setSettingsOpen(false)}>Gotowe</button></div></div></div>}
    {toast&&<div className="toast" role="status"><span><Sparkles size={17}/></span>{toast}<button onClick={()=>setToast('')} aria-label="Zamknij"><X size={15}/></button></div>}
    <nav className="mobile-bottom-nav">{NAV.slice(0,4).map(n=><button key={n.id} className={page===n.id?'active':''} onClick={()=>goPage(n.id)}><n.icon size={20}/><span>{n.label.split(' ')[0]}</span></button>)}</nav>
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
  return <aside className="right-panel"><div className="right-panel-header"><div><span className="eyebrow">TWÓJ DZISIEJSZY PLAN</span><h3>Do zrobienia <span>✦</span></h3></div><button className="tiny-icon-btn" title="Dodaj zadanie" onClick={onAdd}><Plus size={18}/></button></div><div className="mini-task-list">{currentItems.length?currentItems.map(t=>{return <div key={t.id} className="mini-task" draggable title="Przeciągnij na kalendarz, aby zaplanować" onDragStart={e=>{const payload=JSON.stringify({kind:'task',id:t.id,sourceDate:t.date});e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/momentum',payload);e.dataTransfer.setData('text/plain',payload);}}><button className={`task-checkbox ${t.done?'checked':''}`} aria-label="Ukończ zadanie" onClick={()=>onToggle(t.id)}><Check size={13}/></button><button className="mini-task-icon-btn" onClick={()=>onTask(t)} aria-label="Otwórz zadanie"><TaskVisual icon={t.icon} image={t.image} category={t.category} categories={categories} size="mini"/></button><button className="mini-task-main" onClick={()=>onTask(t)}><strong>{t.title}</strong><small>{t.time??(t.date?'Bez godziny':'Inbox')} · +{t.xp} XP</small><CategoryBadge category={t.category} categories={categories} compact/></button><ChevronRight size={14}/></div>}):<div className="empty-tasks"><CheckCircle2 size={26}/><strong>Wszystko gotowe!</strong><span>Dodaj zadanie, kiedy masz nowy plan.</span></div>}</div><button className="right-link" onClick={onAdd}><Plus size={15}/> Dodaj zadanie</button><div className="right-divider"/><div className="right-panel-header"><div><span className="eyebrow">CODZIENNE NAWYKI</span><h3>Moje rutyny</h3></div><span className="right-badge">{routines.length}</span></div><div className="mini-routines">{routines.map(r=>{const log=logFor(r),isDone=log.completed;return <button key={r.id} className="mini-routine" onClick={()=>onRoutine(r)}><TaskVisual icon={r.icon} image={r.image} category={r.category} categories={categories} size="small" className="mini-routine-icon"/><span><strong>{r.title}</strong><small>{isDone?'Ukończona ✓':`${log.checkedStepIds.length}/${r.steps.length} kroków · +${r.xp} XP`}</small><CategoryBadge category={r.category} categories={categories} compact/></span><ArrowUpRight size={16}/></button>;})}</div><div className="right-divider"/><div className="quick-section"><div className="eyebrow">JEDNYM KLIKNIĘCIEM</div><h3>Szybkie dodawanie</h3><div className="quick-presets">{TASK_PRESETS.slice(1,5).map(p=><button key={p.title} onClick={()=>onPreset(p.title,p.category,p.icon,p.duration,p.xp)}><TaskIcon name={p.icon} size={14}/>{p.title}<Plus size={14}/></button>)}</div></div><div className="right-tip"><Sparkles size={19}/><p><strong>Małe kroki się liczą.</strong><br/>Nie musisz zrobić wszystkiego. Najważniejsze to ruszyć naprzód.</p></div></aside>;
}
function TaskGroups({tasks,categories,onEdit,onToggle,onAdd}:{tasks:Task[];categories:ReturnType<typeof useAppData>[0]['categories'];onEdit:(t:Task)=>void;onToggle:(id:string)=>void;onAdd:()=>void}){
  const today=todayKey();
  const groups=[{title:'Dzisiaj',items:tasks.filter(t=>t.date===today)},{title:'Inbox · do zaplanowania',items:tasks.filter(t=>!t.date)},{title:'Zaplanowane na inne dni',items:tasks.filter(t=>t.date&&t.date!==today)}];
  return <div className="task-groups">{groups.filter(g=>g.items.length>0).map(group=><section className="task-group" key={group.title}><div className="task-group-heading"><h3>{group.title}<span>{group.items.length}</span></h3></div><div className="task-rows">{group.items.sort((a,b)=>(a.date??'').localeCompare(b.date??'')||(a.time??'z').localeCompare(b.time??'z')).map(t=>{return <div className={`task-row ${t.done?'task-row--done':''}`} key={t.id}><button className={`task-checkbox ${t.done?'checked':''}`} aria-label="Zmień status" onClick={()=>onToggle(t.id)}><Check size={16}/></button><button className="task-row-icon" onClick={()=>onEdit(t)}><TaskVisual icon={t.icon} image={t.image} category={t.category} categories={categories} size="medium"/></button><button className="task-row-body" onClick={()=>onEdit(t)}><strong>{t.title}</strong><span className="task-row-sub"><CategoryBadge category={t.category} categories={categories} compact/>{t.date?` ${t.date===today?'Dzisiaj':t.date}`:''} {t.time?` · ${t.time}`:''}</span></button><div className="task-row-xp"><Zap size={14}/> {t.xp} XP</div><button className="task-row-edit" onClick={()=>onEdit(t)} title="Edytuj"><MoreHorizontal size={20}/></button></div>})}</div></section>)}{tasks.length===0&&<div className="empty-list"><Target size={38}/><h3>Tu jest miejsce na nowe pomysły.</h3><p>Dodaj zadanie, zaplanuj termin i ruszaj po swoje.</p><button className="btn btn--primary" onClick={onAdd}><Plus size={17}/> Dodaj pierwsze zadanie</button></div>}</div>;
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

function Insights({data,totalXp,currentLevel,streak,achievements,rank,nextRank}:{data:ReturnType<typeof useAppData>[0];totalXp:number;currentLevel:number;streak:number;achievements:AchievementView[];rank:RankView;nextRank:RankView | null}){
  const [analyticsView, setAnalyticsView] = useState<'week' | 'month'>('week');
  const categories = resolveCategories(data.categories);
  const today=todayKey();
  const weekActivity=Array.from({length:7},(_,i)=>{
    const date=shiftDate(today,i-6);
    const count=data.tasks.filter(t=>t.date===date&&t.done).length+Object.entries(data.routineLogs).filter(([key,l])=>l.completed&&key.endsWith(`:${date}`)).length;
    const minutes=data.tasks.filter(t=>t.date===date&&t.done).reduce((s,t)=>s+t.duration,0)+Object.entries(data.routineLogs).reduce((sum,[key,log])=>{if(!log.completed||!key.endsWith(`:${date}`))return sum;const routineId=key.split(':')[0];const routine=data.routines.find(item=>item.id===routineId);return sum+(log.durationOverride ?? routine?.duration ?? 0);},0);
    return { key: date, count, minutes, topLabel: new Intl.DateTimeFormat('pl-PL',{day:'2-digit',month:'2-digit'}).format(parseDate(date)), bottomLabel: new Intl.DateTimeFormat('pl-PL',{weekday:'short'}).format(parseDate(date)).replace('.','') };
  });
  const monthActivity=Array.from({length:4},(_,i)=>{
    const start=shiftDate(today,-27 + i*7);
    const bucketDates=Array.from({length:7},(_,d)=>shiftDate(start,d));
    const end=bucketDates[bucketDates.length-1];
    const count=bucketDates.reduce((sum,date)=>sum + data.tasks.filter(t=>t.date===date&&t.done).length + Object.entries(data.routineLogs).filter(([key,l])=>l.completed&&key.endsWith(`:${date}`)).length,0);
    const minutes=bucketDates.reduce((sum,date)=>sum + data.tasks.filter(t=>t.date===date&&t.done).reduce((s,t)=>s+t.duration,0)+Object.entries(data.routineLogs).reduce((acc,[key,log])=>{if(!log.completed||!key.endsWith(`:${date}`))return acc;const routineId=key.split(':')[0];const routine=data.routines.find(item=>item.id===routineId);return acc+(log.durationOverride ?? routine?.duration ?? 0);},0),0);
    return { key: `${start}:${end}`, count, minutes, topLabel: `${parseDate(start).getDate()}–${parseDate(end).getDate()}`, bottomLabel: monthTitle(start).slice(0,3) };
  });
  const activity = analyticsView === 'week' ? weekActivity : monthActivity;
  const max=Math.max(...activity.map(x=>x.count),1);
  const doneTasks=data.tasks.filter(t=>t.done);
  const completedRoutineLogs = Object.entries(data.routineLogs).filter(([,log]) => log.completed);
  const doneTaskMinutes=doneTasks.reduce((s,t)=>s+t.duration,0);
  const doneRoutineMinutes=completedRoutineLogs.reduce((sum,[key,log])=>{const routineId=key.split(':')[0];const routine=data.routines.find(item=>item.id===routineId);return sum+(log.durationOverride ?? routine?.duration ?? 0);},0);
  const plannedMinutes=data.tasks.filter(t=>t.time).reduce((s,t)=>s+t.duration,0) + data.routines.reduce((sum,routine)=>sum + routine.duration * routine.weekdays.length,0);
  const doneMinutes=doneTasks.filter(t=>t.time).reduce((s,t)=>s+t.duration,0) + doneRoutineMinutes;
  const totalMinutes=doneTaskMinutes + doneRoutineMinutes;
  const pieValues=CATEGORY_KEYS.map(c=>({
    id:c,
    mins: doneTasks.filter(t=>t.category===c).reduce((s,t)=>s+t.duration,0) + completedRoutineLogs.reduce((sum,[key,log])=>{const routineId=key.split(':')[0];const routine=data.routines.find(item=>item.id===routineId);if(routine?.category!==c)return sum;return sum + (log.durationOverride ?? routine.duration ?? 0);},0)
  }));
  let cumulative=0;
  const gradientSegments=pieValues.filter(p=>p.mins>0).map(p=>{const percent=totalMinutes?p.mins/totalMinutes*100:0;const start=cumulative;cumulative+=percent;return `${categories[p.id].color} ${start}% ${cumulative}%`;});
  const completionRate = plannedMinutes ? Math.round(doneMinutes / plannedMinutes * 100) : 0;
  const nextRankDelta = nextRank ? Math.max(0, nextRank.minXp - totalXp) : 0;
  const RankIcon = rank.icon;
  const periodCount = activity.reduce((sum,item)=>sum+item.count,0);
  const periodMinutes = activity.reduce((sum,item)=>sum+item.minutes,0);
  return <div className="insights-page">
    <div className="insight-metrics">
      <div className="insight-metric"><span className="insight-icon insight-icon--violet"><Trophy size={21}/></span><small>Wszystkie punkty</small><strong>{totalXp.toLocaleString('pl-PL')} XP</strong><span>Poziom {currentLevel}</span></div>
      <div className="insight-metric"><span className="insight-icon insight-icon--coral"><Flame size={21}/></span><small>Aktualna seria</small><strong>{streak} dni</strong><span>Regularność napędza progres</span></div>
      <div className="insight-metric"><span className="insight-icon insight-icon--green"><CheckCircle2 size={21}/></span><small>Ukończone zadania</small><strong>{doneTasks.length + completedRoutineLogs.length}</strong><span>Taski i rutyny razem</span></div>
      <div className="insight-metric"><span className="insight-icon insight-icon--gold"><Clock3 size={21}/></span><small>Zaplanowany czas</small><strong>{formatDuration(plannedMinutes)}</strong><span>{formatDuration(doneMinutes)} ukończonych bloków</span></div>
    </div>
    <section className="rank-hero" style={{ '--rank-accent': rank.accent, '--rank-tint': rank.tint } as React.CSSProperties}>
      <div className="rank-hero-main">
        <div className="rank-medal"><RankIcon size={30} /></div>
        <div className="rank-hero-copy">
          <span className="eyebrow">TWOJA AKTUALNA RANGA</span>
          <h3>{rank.title}</h3>
          <p>{rank.subtitle}</p>
          {nextRank ? <div className="rank-progress-row"><div className="rank-progress"><span style={{ width: `${Math.max(8, Math.min(100, (totalXp - rank.minXp) / Math.max(1, nextRank.minXp - rank.minXp) * 100))}%` }} /></div><small>{nextRankDelta} XP do rangi „{nextRank.title}”</small></div> : <small>Masz już najwyższą rangę 🎉</small>}
        </div>
        <div className="rank-hero-art-wrap"><img className="rank-hero-art" src={rank.art} alt={rank.title} /></div>
      </div>
      <div className="rank-chip-row">{RANKS.map(item => { const RankChipIcon = item.icon; return <div key={item.id} className={`rank-chip ${item.id === rank.id ? 'is-active' : totalXp >= item.minXp ? 'is-earned' : ''}`}>
        <span className="rank-chip-icon"><RankChipIcon size={14} /></span>{item.title}
      </div>;})}</div>
    </section>
    <div className="insight-chart-layout">
      <section className="insight-card insight-card--activity">
        <div className="insight-card-title"><div><span className="eyebrow">{analyticsView === 'week' ? 'OSTATNIE 7 DNI' : 'OSTATNIE 4 TYGODNIE'}</span><h3>{analyticsView === 'week' ? 'Twoja aktywność' : 'Miesięczny przegląd'}</h3></div><div className="analytics-switch"><button className={analyticsView==='week'?'active':''} onClick={()=>setAnalyticsView('week')}>Tydzień</button><button className={analyticsView==='month'?'active':''} onClick={()=>setAnalyticsView('month')}>Miesiąc</button></div></div>
        <div className={`activity-chart activity-chart--deluxe activity-chart--${analyticsView}`}>{activity.map(item => {const height = Math.max(item.count ? 16 : 4, item.count / max * 100); return <div className={`chart-column-card ${item.key===today?'is-today':''}`} key={item.key}>
          <div className="chart-column-top"><strong>{item.count}</strong><span>{item.topLabel}</span></div>
          <div className="chart-column-stage"><span style={{height:`${height}%`}} className={item.key===today?'today':''}/></div>
          <small>{item.bottomLabel}</small>
        </div>;})}</div>
        <div className="chart-summary-row"><div><strong>{periodCount}</strong><span>{analyticsView === 'week' ? 'ukończonych działań w 7 dni' : 'ukończonych działań w 4 tygodnie'}</span></div><div><strong>{formatDuration(periodMinutes)}</strong><span>{analyticsView === 'week' ? 'przepracowanego czasu w tygodniu' : 'czasu z ostatnich 4 tygodni'}</span></div><div><strong>{completionRate}%</strong><span>realizacji zaplanowanego czasu</span></div></div>
        <div className="insight-note"><Activity size={16}/> Każdy ukończony task i rutyna zwiększa Twój wynik dnia.</div>
      </section>
      <section className="insight-card insight-card--donut">
        <div className="insight-card-title"><div><span className="eyebrow">PODZIAŁ CZASU</span><h3>Na co poświęcasz czas?</h3></div><Target size={20}/></div>
        <div className="donut-layout donut-layout--3d"><div className="donut-stack">
          <div className="donut-shadow-ring" />
          <div className="donut donut--3d" style={{background:totalMinutes?`conic-gradient(${gradientSegments.join(',')})`:'var(--line)'}}><div><strong>{formatDuration(totalMinutes)}</strong><small>ukończonego czasu</small></div></div>
        </div><div className="donut-legend donut-legend--detailed">{pieValues.map(p=><div key={p.id}><span className="category-dot" style={{background:categories[p.id].color}}/><div><span>{categories[p.id].label}</span><small>{formatDuration(p.mins)}</small></div><strong>{totalMinutes?Math.round(p.mins/totalMinutes*100):0}%</strong></div>)}</div></div>
      </section>
    </div>
    <section className="insight-card achievements-section">
      <div className="insight-card-title"><div><span className="eyebrow">OSIĄGNIĘCIA I ODZNAKI</span><h3>Odblokowane kamienie milowe</h3></div><Award size={20}/></div>
      <div className="achievement-grid">{achievements.map(achievement => { const Icon = achievement.icon; const progress = Math.min(100, achievement.progress / achievement.target * 100); return <article key={achievement.id} className={`achievement-card ${achievement.unlocked ? 'is-unlocked' : 'is-locked'}`} style={{ '--achievement-accent': achievement.accent, '--achievement-tint': achievement.tint } as React.CSSProperties}>
        <div className="achievement-card-art-wrap"><img src={achievement.art} alt={achievement.title} className="achievement-card-illustration" />{!achievement.unlocked && <div className="achievement-card-lock"><ShieldCheck size={16} /></div>}</div>
        <div className="achievement-card-body"><div className="achievement-card-head"><div><h4>{achievement.title}</h4><p>{achievement.description}</p></div><span>{achievement.unlocked ? 'Odblokowane' : `${Math.min(achievement.progress, achievement.target)} / ${achievement.target}`}</span></div><div className="achievement-card-meta"><span className="achievement-icon-pill"><Icon size={13} /> {achievement.reward}</span><span className="achievement-progress-copy">{Math.round(progress)}%</span></div><div className="achievement-progress"><span style={{ width: `${progress}%` }} /></div></div>
      </article>;})}</div>
    </section>
    <div className="insight-bottom-banner"><Sparkles size={22}/><div><strong>Twój postęp jest ważniejszy niż perfekcyjny plan.</strong><span>Momentum pomaga zauważać progres. Odpoczynek też jest częścią dobrze zaplanowanego dnia.</span></div><ArrowDownRight size={22}/></div>
  </div>;
}

export default App;
