import { ArrowRight, CalendarOff, Check, Clock3, Play, Sparkles, Zap } from 'lucide-react';
import { CategoryBadge, TaskVisual } from './VisualIdentity';
import { formatDuration, parseDate, todayKey, weekdayLongLabels, weekdayShortLabels } from '../lib/date';
import { count, plural, tr } from '../lib/i18n';
import type { CategoryConfig, Routine, RoutineLog } from '../types';

/** Kolejność od poniedziałku; wartości to Date.getDay() (0 = niedziela). */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function stepsLabel(steps: number): string {
  return count(steps, ['krok', 'kroki', 'kroków'], ['step', 'steps']);
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
  /** XP za dzisiejsze wystąpienie (liczy aplikacja: czas, kategoria, kroki i regularność). */
  xp: number;
  /** Kroki zaplanowane na dziś (część kroków może mieć własny harmonogram). */
  stepsToday: number;
  checkedToday: number;
  occursToday: boolean;
  categories: CategoryConfig;
  onOpen: () => void;
}

export function RoutineCard({ routine, log, xp, stepsToday, checkedToday, occursToday, categories, onOpen }: Props) {
  const today = todayKey();
  const todayDow = parseDate(today).getDay();
  const style = categories[routine.category] ?? categories.unpaid;
  const state = log.completed ? 'done' : !occursToday ? 'off' : checkedToday > 0 ? 'progress' : 'todo';
  const percent = state === 'done' ? 100 : stepsToday ? Math.round(checkedToday / stepsToday * 100) : 0;
  const nextDay = nextScheduledDay(routine, today);
  const dayLabels = weekdayShortLabels();
  const dayNames = weekdayLongLabels();
  const frequency = routine.weekdays.length === 7 ? tr('Codziennie', 'Every day') : routine.weekdays.length === 0 ? tr('Bez harmonogramu', 'No schedule') : tr(`${routine.weekdays.length}× w tygodniu`, `${routine.weekdays.length}× a week`);
  const status = state === 'done' ? <><Check size={14} strokeWidth={3}/> {tr(`Ukończona dziś · +${xp} XP`, `Completed today · +${xp} XP`)}</>
    : state === 'progress' ? <><Play size={12} fill="currentColor"/> {tr('W trakcie', 'In progress')} · {checkedToday}/{stepsToday}</>
    : state === 'todo' ? <><Sparkles size={13}/> {tr('Dziś', 'Today')} · {stepsToday ? stepsLabel(stepsToday) : tr('bez kroków', 'no steps')}</>
    : <><CalendarOff size={13}/> {tr('Dziś wolne', 'Off today')}{nextDay !== null ? tr(` · następna: ${dayNames[nextDay]}`, ` · next: ${dayNames[nextDay]}`) : ''}</>;

  return <button type="button" className={`routine-card rcard rcard--${state}`} onClick={onOpen}
    style={{ '--rc-color': style.color, '--rc-tint': style.tint, '--rc-progress': `${percent}%` } as React.CSSProperties}>
    <span className="rcard-head">
      <TaskVisual icon={routine.icon} image={routine.image} category={routine.category} categories={categories} size="large" className="rcard-visual"/>
      <span className="rcard-title">
        <span className="rcard-eyebrow">{frequency}</span>
        <h3>{routine.title}</h3>
        {routine.description && <p>{routine.description}</p>}
      </span>
      <span className="rcard-ring" aria-label={state === 'done' ? tr('Ukończona', 'Completed') : !stepsToday ? tr('Bez kroków', 'No steps') : tr(`${checkedToday} z ${stepsToday} kroków`, `${checkedToday} of ${stepsToday} ${plural(stepsToday, ['krok', 'kroki', 'kroków'], ['step', 'steps'])}`)}>
        <span>{state === 'done' ? <Check size={18} strokeWidth={3}/> : state === 'off' ? <CalendarOff size={16}/> : !stepsToday ? <Sparkles size={16}/> : <><strong>{checkedToday}</strong><small>/{stepsToday}</small></>}</span>
      </span>
    </span>
    <span className="rcard-chips">
      <span><Clock3 size={13}/> {routine.time} · {formatDuration(routine.duration)}</span>
      <span><Zap size={13}/> +{xp} XP</span>
      <CategoryBadge category={routine.category} categories={categories} compact/>
    </span>
    <span className="rcard-days" aria-label={tr('Dni: ', 'Days: ') + (routine.weekdays.length === 7 ? tr('codziennie', 'every day') : WEEK_ORDER.filter(day => routine.weekdays.includes(day)).map(day => dayLabels[day]).join(', '))}>
      {WEEK_ORDER.map(day => <span key={day} className={`${routine.weekdays.includes(day) ? 'is-on' : ''} ${day === todayDow ? 'is-today' : ''}`}>{dayLabels[day]}</span>)}
    </span>
    <span className="rcard-foot">
      <span className="rcard-status">{status}</span>
      <span className="rcard-cta">{state === 'done' ? tr('Zobacz', 'View') : state === 'off' ? tr('Szczegóły', 'Details') : tr('Otwórz', 'Open')} <ArrowRight size={15}/></span>
    </span>
  </button>;
}
