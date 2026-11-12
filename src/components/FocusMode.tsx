import { useEffect } from 'react';
import { ArrowUpRight, Check, Clock3, Coffee, Flame, Minimize2, Pause, Play, Square, Zap } from 'lucide-react';import { formatFocusClock, type FocusRecord, type FocusSession, type FocusPhase } from '../lib/focus';
import { tr } from '../lib/i18n';
import { CategoryBadge, TaskVisual } from './VisualIdentity';
import type { CategoryConfig, Task } from '../types';

interface Props {
  task: Task | undefined;
  session: FocusSession;
  history: FocusRecord[];
  focusMs: number;
  breakMs: number;
  breakElapsedMs: number;
  /** XP za ukończenie zadania (0, gdy już ukończone). */
  completionXp: number;
  /** XP za dotychczasowy czas skupienia w tej sesji. */
  focusXp: number;
  categories: CategoryConfig;
  onPhase: (phase: FocusPhase, breakMinutes?: number) => void;
  onFinish: (complete: boolean) => void;
  onClose: () => void;
}

export function FocusMode({ task, session, history, focusMs, breakMs, breakElapsedMs, completionXp, focusXp, categories, onPhase, onFinish, onClose }: Props) {
  const focusSeconds = Math.floor(focusMs / 1000);
  const plannedSeconds = session.plannedMinutes * 60;
  const progress = plannedSeconds > 0 ? Math.min(100, (focusSeconds / plannedSeconds) * 100) : 0;
  const overtime = Math.max(0, focusSeconds - plannedSeconds);
  const breakRemaining = Math.max(0, Math.ceil((session.breakTargetMs - breakElapsedMs) / 1000));
  const previousSeconds = history.filter(record => record.taskId === session.taskId).reduce((sum, record) => sum + record.focusSeconds, 0);
  const displayedTask = task ?? {title: session.taskTitle, category: 'potential' as const, icon: 'target', image: undefined};
  const phaseLabel = session.phase === 'focus' ? tr('W trakcie skupienia', 'Focusing') : session.phase === 'break' ? tr('Przerwa regeneracyjna', 'Recovery break') : tr('Sesja wstrzymana', 'Session paused');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return <div className="focus-overlay" role="presentation">
    <div className="focus-panel" role="dialog" aria-modal="true" aria-labelledby="focus-heading">
      <div className="focus-ambient focus-ambient--a" aria-hidden="true" />
      <div className="focus-ambient focus-ambient--b" aria-hidden="true" />
      <header className="focus-header">
        <span className="focus-brand"><Zap size={20} fill="currentColor" /> momentum<span>.</span> <b>FOCUS</b></span>
        <button className="focus-close" onClick={onClose} aria-label={tr('Zminimalizuj Focus Mode', 'Minimize Focus Mode')} title={tr('Zminimalizuj — licznik nadal działa', 'Minimize — the timer keeps running')}><Minimize2 size={17} /> {tr('Zminimalizuj', 'Minimize')}</button>
      </header>
      <main className="focus-main">
        <div className="focus-kicker"><Flame size={14} /> {tr('CZAS NA GŁĘBOKĄ PRACĘ', 'TIME FOR DEEP WORK')}</div>
        <div className="focus-task-header">
          <TaskVisual icon={displayedTask.icon} image={displayedTask.image} category={displayedTask.category} categories={categories} size="large" />
          <div><h2 id="focus-heading">{displayedTask.title}</h2><CategoryBadge category={displayedTask.category} categories={categories} compact /></div>
        </div>
        <div className={`focus-clock-ring ${session.phase === 'focus' ? 'is-running' : ''}`} style={{ '--focus-progress': `${progress}%` } as React.CSSProperties}>
          <div className="focus-clock-core">
            <span className="focus-mode-status"><span /> {phaseLabel}</span>
            <strong className="focus-clock-time" aria-live="off">{session.phase === 'break' ? formatFocusClock(breakRemaining) : formatFocusClock(focusSeconds)}</strong>
            <span className="focus-clock-hint">{session.phase === 'break' ? tr('do końca przerwy', 'until the break ends') : tr(`z ${session.plannedMinutes} min w planie`, `of ${session.plannedMinutes} min planned`)}</span>
            {overtime > 0 && session.phase !== 'break' && <span className="focus-overtime"><ArrowUpRight size={14} /> +{formatFocusClock(overtime)} {tr('ponad plan', 'over plan')}</span>}
          </div>
        </div>
        <div className="focus-controls">
          {session.phase === 'focus'
            ? <button className="focus-control focus-control--main" onClick={() => onPhase('paused')}><Pause size={19} fill="currentColor" /> {tr('Pauza', 'Pause')}</button>
            : <button className="focus-control focus-control--main" onClick={() => onPhase('focus')}><Play size={19} fill="currentColor" /> {session.phase === 'break' ? tr('Wracam do pracy', 'Back to work') : tr('Wznów', 'Resume')}</button>}
          {session.phase !== 'break' && <button className="focus-control focus-control--secondary" onClick={() => onPhase('break', 5)}><Coffee size={18} /> {tr('Przerwa 5 min', '5 min break')}</button>}
        </div>
        <div className="focus-progress-meta"><span>{tr('Postęp planu', 'Plan progress')}</span><strong>{Math.round(progress)}%</strong></div>
        <div className="focus-progress-track"><div style={{width:`${progress}%`}} /></div>
        <div className="focus-stat-grid">
          <div className="focus-stat"><Clock3 size={17} /><span>{tr('Skupienie', 'Focus time')}</span><strong>{formatFocusClock(focusSeconds)}</strong></div>
          <div className="focus-stat"><Coffee size={17} /><span>{tr('Przerwy', 'Breaks')}</span><strong>{formatFocusClock(Math.floor(breakMs / 1000))}</strong></div>
          <div className="focus-stat"><Zap size={17} /><span>{tr('Wcześniej', 'Previously')}</span><strong>{formatFocusClock(previousSeconds)}</strong></div>
        </div>
        <div className="focus-finish-area">
          <button className="focus-complete" onClick={() => onFinish(true)}><Check size={19} /> {tr('Zakończ zadanie', 'Complete task')} {task && completionXp + focusXp > 0 ? `· +${completionXp + focusXp} XP` : ''}</button>
          <button className="focus-save" onClick={() => onFinish(false)}><Square size={15} /> {tr('Zapisz czas bez oznaczania zadania', 'Save time without completing the task')}{focusXp > 0 ? ` · +${focusXp} XP` : ''}</button>
        </div>
      </main>
      <footer className="focus-footer">{tr('Realny czas jest liczony bez przerw i pozostaje zapisany po odświeżeniu strony.', 'Actual time is counted without breaks and stays saved if you refresh the page.')}</footer>
    </div>
  </div>;
}

export function FocusDock({ title, seconds, phase, onOpen }: { title: string; seconds: number; phase: FocusPhase; onOpen: () => void }) {
  return <button className="focus-dock" onClick={onOpen} title={tr('Otwórz trwającą sesję Focus', 'Open the ongoing Focus session')}>
    <span className="focus-dock-pulse"><Flame size={18} /></span>
    <span className="focus-dock-label"><strong>{title}</strong><small>{phase === 'focus' ? tr('Trwa skupienie', 'Focusing') : phase === 'break' ? tr('Przerwa', 'Break') : tr('Pauza', 'Paused')}</small></span>
    <span className="focus-dock-time">{formatFocusClock(seconds)}</span>
    <Play size={15} />
  </button>;
}
