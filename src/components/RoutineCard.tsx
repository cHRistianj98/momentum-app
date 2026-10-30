import { ArrowRight, CalendarOff, Check, Clock3, Play, Sparkles, Zap } from 'lucide-react';
import { CategoryBadge, TaskVisual } from './VisualIdentity';
import { formatDuration, parseDate, todayKey } from '../lib/date';
import type { CategoryConfig, Routine, RoutineLog } from '../types';

/** Kolejność od poniedziałku; wartości to Date.getDay() (0 = niedziela). */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_LABELS: Record<number, string> = { 0: 'Nd', 1: 'Pn', 2: 'Wt', 3: 'Śr', 4: 'Cz', 5: 'Pt', 6: 'So' };
const DAY_NAMES: Record<number, string> = { 0: 'niedziela', 1: 'poniedziałek', 2: 'wtorek', 3: 'środa', 4: 'czwartek', 5: 'piątek', 6: 'sobota' };

function stepsLabel(count: number): string {
  if (count === 1) return '1 krok';
  const lastDigit = count % 10;
  const lastTwo = count % 100;
  return lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14) ? `${count} kroki` : `${count} kroków`;
}

/** Najbliższy dzień tygodnia po dzisiejszym, w którym rutyna jest zaplanowana. */
function nextScheduledDay(routine: Routine, today: string): number | null {
  if (!routine.active || !routine.weekdays.length) return null;
  const start = parseDate(today).getDay();
  for (let offset = 1; offset <= 7; offset++) {
    const day = (start + offset) % 7;
    if (routine.weekdays.includes(day)) return day;
  }
  return null;
}

interface Props {
  routine: Routine;
  log: RoutineLog;
  /** Kroki zaplanowane na dziś (część kroków może mieć własny harmonogram). */
  stepsToday: number;
  checkedToday: number;
  occursToday: boolean;
  categories: CategoryConfig;
  onOpen: () => void;
}

export function RoutineCard({ routine, log, stepsToday, checkedToday, occursToday, categories, onOpen }: Props) {
  const today = todayKey();
  const todayDow = parseDate(today).getDay();
  const style = categories[routine.category] ?? categories.unpaid;
  const state = log.completed ? 'done' : !occursToday ? 'off' : checkedToday > 0 ? 'progress' : 'todo';
  const percent = state === 'done' ? 100 : stepsToday ? Math.round(checkedToday / stepsToday * 100) : 0;
  const nextDay = nextScheduledDay(routine, today);
  const frequency = routine.weekdays.length === 7 ? 'Codziennie' : routine.weekdays.length === 0 ? 'Bez harmonogramu' : `${routine.weekdays.length}× w tygodniu`;
  const status = state === 'done' ? <><Check size={14} strokeWidth={3}/> Ukończona dziś · +{routine.xp} XP</>
    : state === 'progress' ? <><Play size={12} fill="currentColor"/> W trakcie · {checkedToday}/{stepsToday}</>
    : state === 'todo' ? <><Sparkles size={13}/> Dziś · {stepsLabel(stepsToday)}</>
    : <><CalendarOff size={13}/> Dziś wolne{nextDay !== null ? ` · następna: ${DAY_NAMES[nextDay]}` : ''}</>;

  return <button type="button" className={`routine-card rcard rcard--${state}`} onClick={onOpen}
    style={{ '--rc-color': style.color, '--rc-tint': style.tint, '--rc-progress': `${percent}%` } as React.CSSProperties}>
    <span className="rcard-head">
      <TaskVisual icon={routine.icon} image={routine.image} category={routine.category} categories={categories} size="large" className="rcard-visual"/>
      <span className="rcard-title">
        <span className="rcard-eyebrow">{frequency}</span>
        <h3>{routine.title}</h3>
        {routine.description && <p>{routine.description}</p>}
      </span>
      <span className="rcard-ring" aria-label={state === 'done' ? 'Ukończona' : `${checkedToday} z ${stepsToday} kroków`}>
        <span>{state === 'done' ? <Check size={18} strokeWidth={3}/> : state === 'off' ? <CalendarOff size={16}/> : <><strong>{checkedToday}</strong><small>/{stepsToday}</small></>}</span>
      </span>
    </span>
    <span className="rcard-chips">
      <span><Clock3 size={13}/> {routine.time} · {formatDuration(routine.duration)}</span>
      <span><Zap size={13}/> +{routine.xp} XP</span>
      <CategoryBadge category={routine.category} categories={categories} compact/>
    </span>
    <span className="rcard-days" aria-label={`Dni: ${routine.weekdays.length === 7 ? 'codziennie' : WEEK_ORDER.filter(day => routine.weekdays.includes(day)).map(day => DAY_LABELS[day]).join(', ')}`}>
      {WEEK_ORDER.map(day => <span key={day} className={`${routine.weekdays.includes(day) ? 'is-on' : ''} ${day === todayDow ? 'is-today' : ''}`}>{DAY_LABELS[day]}</span>)}
    </span>
    <span className="rcard-foot">
      <span className="rcard-status">{status}</span>
      <span className="rcard-cta">{state === 'done' ? 'Zobacz' : state === 'off' ? 'Szczegóły' : 'Otwórz'} <ArrowRight size={15}/></span>
    </span>
  </button>;
}
