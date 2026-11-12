import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, CalendarX2, Camera, Check, CheckCircle2, Clock3, Flame, GripVertical, MoreHorizontal, Pause, PencilLine, Play, Plus, RotateCcw, Timer, Trash2, X } from 'lucide-react';
import { TaskIcon } from '../lib/icons';
import { CategoryBadge, TaskVisual } from './VisualIdentity';
import { IconPicker } from './IconPicker';
import { PhotoPicker } from './PhotoPicker';
import { PHOTO_OPTIONS } from '../lib/photos';
import { TimePicker, DurationPicker, XpPreview } from './FormControls';
import { CategoryChoices } from './CategoryChoices';
import { ReminderPicker } from './ReminderPicker';
import { MoveOccurrenceModal, OccurrenceBar, SkippedOccurrenceBar, SkippedOccurrences } from './MoveOccurrenceModal';
import { formatDuration, fullDate, todayKey } from '../lib/date';
import { pick, tr } from '../lib/i18n';
import { orderRoutineSteps, placeRoutineStep, unnestRoutineStep } from '../lib/routineHierarchy';
import { useRoutineStepDrag } from '../lib/useRoutineStepDrag';
import { normalizeStepWeekdays, routineStepsOnDate, stepWeekdaysLabel } from '../lib/routineStepSchedule';
import { occursOn } from '../lib/recurrence';
import { XP_RULES, routineXp } from '../lib/xp';
import {
  STEP_TIMER_MAX_SECONDS, STEP_TIMER_PRESETS, describeStepTimer, formatStepTimer, isStepTimerFor, primeStepTimerSound,
  resetStepTimer, shortStepTimer, stepTimerRemainingMs, stepTimerSeconds, toggleStepTimer, useStepTimer,
} from '../lib/stepTimer';
import type { CategoryConfig, CategoryKey, IconKey, Routine, RoutineLog, RoutineStep } from '../types';

interface SessionProps {
  routine: Routine;
  date: string;
  log: RoutineLog;
  /** XP za to wystąpienie — liczy aplikacja (czas, kategoria, kroki, regularność). */
  xp: number;
  duration: number;
  displayTime: string;
  categoryColor: string;
  categories: CategoryConfig;
  onToggleStep: (stepId: string) => void;
  /** Compatibility with Momentum <=0.5.17; editing the step hierarchy is editor-only. */
  onChangeSteps?: (steps: RoutineStep[]) => void;
  onComplete: () => void;
  onUndo: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  /** Dzień z harmonogramu (klucz logu); `date` to dzień, w którym wystąpienie jest teraz. */
  sourceDate?: string;
  /** Godziny innych wystąpień tej rutyny w wybranym dniu — ostrzeżenie przy przenoszeniu. */
  otherTimesOn?: (date: string) => string[];
  /** Przeniesienie tylko tego wystąpienia na inny dzień/godzinę. */
  onMove?: (date: string, time: string) => void;
  /** Usunięcie tylko tego wystąpienia (np. wolny dzień) — reszta rutyny bez zmian. */
  onSkip?: () => void;
  /** Przywrócenie usuniętego wystąpienia. */
  onRestore?: () => void;
}

export function RoutineSession({ routine, date, log, xp, duration, displayTime, categoryColor, categories, onToggleStep, onComplete, onUndo, onEdit, onDelete, onClose, sourceDate, otherTimesOn, onMove, onSkip, onRestore }: SessionProps) {
  const visibleSteps = orderRoutineSteps(routineStepsOnDate(routine.steps, date));
  const completed = visibleSteps.filter(step => log.checkedStepIds.includes(step.id)).length;
  const count = visibleSteps.length;
  // Stoper kroku żyje poza oknem — odlicza dalej po jego zamknięciu, a po upływie czasu App odhacza krok.
  const { timer, now } = useStepTimer();
  const occurrenceKey = sourceDate ?? date;
  const timerFor = (step: RoutineStep) => isStepTimerFor(timer, routine.id, occurrenceKey, step.id) ? timer : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const movedFrom = sourceDate && (sourceDate !== date || displayTime !== routine.time) ? { date: sourceDate, time: routine.time } : null;
  const skipped = Boolean(log.skipped);
  // Ukończone wystąpienie ma już XP w historii — usunięcie wymaga potwierdzenia.
  const skipThisOccurrence = () => {
    if (!onSkip) return;
    if (log.completed && !window.confirm(tr(`To wystąpienie „${routine.title}” jest już ukończone. Usunąć je razem z XP za ten dzień?`, `This occurrence of “${routine.title}” is already completed. Delete it along with the XP for that day?`))) return;
    onSkip();
  };
  const menuRef = useRef<HTMLDivElement>(null);
  // Menu „więcej” zamykamy dotknięciem obok albo klawiszem Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setMenuOpen(false); } };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);
  function toggleTimer(step: RoutineStep, totalSeconds: number) {
    primeStepTimerSound();
    toggleStepTimer({ routineId: routine.id, sourceDate: occurrenceKey, date, stepId: step.id, title: step.title, totalSeconds });
  }
  // Ręczne odhaczenie (albo odznaczenie) kroku z działającym stoperem kończy odliczanie — bez sygnału później.
  function toggleStep(step: RoutineStep) {
    if (timerFor(step)) resetStepTimer(routine.id, occurrenceKey);
    onToggleStep(step.id);
  }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal routine-modal" role="dialog" aria-modal="true" aria-label={tr('Rutyna', 'Routine')}>
    <div className="routine-session-scroll">
    <div className="modal-heading modal-heading--identity"><div className="modal-heading-identity"><TaskVisual icon={routine.icon} image={routine.image} category={routine.category} categories={categories} size="large" className="modal-heading-art"/><div><span className="eyebrow">{tr('TWOJA RUTYNA', 'YOUR ROUTINE')} · {fullDate(date)}</span><h2>{routine.title}</h2><CategoryBadge category={routine.category} categories={categories} compact/></div></div><button className="icon-btn" onClick={onClose} aria-label={tr('Zamknij', 'Close')}><X size={20} /></button></div>
    <div className="routine-banner" style={{ '--routine-color': categoryColor } as React.CSSProperties}><TaskVisual icon={routine.icon} image={routine.image} category={routine.category} categories={categories} size="large" className="routine-banner-icon"/><div><strong>{routine.description || tr('Małe kroki, wielki progres.', 'Small steps, big progress.')}</strong><span><Clock3 size={14} /> {displayTime} · {formatDuration(duration)} <span className="dot-spacer">·</span> <Flame size={14} /> +{xp} XP</span></div></div>
    {onMove && (skipped && onRestore
      ? <SkippedOccurrenceBar date={date} hint={tr('Odhaczenie kroku też przywróci rutynę na ten dzień.', 'Checking off a step will also restore the routine for this day.')} onRestore={onRestore}/>
      : <OccurrenceBar label={tr('To wystąpienie', 'This occurrence')} date={date} time={displayTime} movedFrom={movedFrom} onMove={() => setMoving(true)} onDelete={onSkip ? skipThisOccurrence : undefined}/>)}
    <div className="routine-progress-heading"><strong>{tr('Twoje kroki', 'Your steps')}</strong><span>{completed}/{count} {tr('wykonane', 'done')}</span></div><div className="progress-track"><div style={{ width: `${count ? completed/count*100 : 0}%` }} /></div>
    <div className="routine-checklist">
      {count === 0 && <div className="routine-no-steps">{tr('W tym dniu nie zaplanowano żadnych kroków. Harmonogram każdego kroku zmienisz w „Edytuj szablon”.', 'No steps are scheduled for this day. You can change each step’s schedule in “Edit template”.')}</div>}
      {visibleSteps.map((step, i) => {
        const isDone = log.checkedStepIds.includes(step.id);
        const body = <>
          <span className="step-counter">{isDone ? <Check size={17} strokeWidth={3} /> : step.parentId ? '↳' : String(i + 1).padStart(2, '0')}</span>
          <span className="routine-step-title">{step.title}</span>
          <CheckCircle2 className="step-right" size={18}/>
        </>;
        if (!stepTimerSeconds(step.timerSeconds)) return <button key={step.id} type="button" data-routine-step-id={step.id}
          className={`routine-step ${step.parentId ? 'routine-step--child' : ''} ${isDone ? 'checked' : ''}`}
          disabled={log.completed} onClick={() => toggleStep(step)}>{body}</button>;
        const seconds = stepTimerSeconds(step.timerSeconds)!;
        const active = timerFor(step);
        const running = Boolean(active?.endAt);
        const totalMs = (active?.totalSeconds ?? seconds) * 1000;
        const remainingMs = active ? stepTimerRemainingMs(active, now) : totalMs;
        const progress = active ? Math.min(100, Math.max(0, (1 - remainingMs / totalMs) * 100)) : 0;
        return <div key={step.id} data-routine-step-id={step.id}
          className={`routine-step routine-step--timed ${step.parentId ? 'routine-step--child' : ''} ${isDone ? 'checked' : ''} ${active ? 'routine-step--timing' : ''}`}>
          <button type="button" className="routine-step-main" disabled={log.completed}
            aria-label={isDone ? tr(`Odznacz ${step.title}`, `Uncheck ${step.title}`) : tr(`Oznacz ${step.title}`, `Check off ${step.title}`)} onClick={() => toggleStep(step)}>{body}</button>
          <button type="button" className={`routine-step-timer ${running ? 'routine-step-timer--running' : active ? 'routine-step-timer--paused' : ''}`}
            style={{ '--timer-progress': `${progress}%` } as React.CSSProperties} disabled={log.completed}
            aria-label={running ? tr(`Wstrzymaj stoper: ${step.title}`, `Pause timer: ${step.title}`) : active ? tr(`Wznów stoper: ${step.title}`, `Resume timer: ${step.title}`) : tr(`Uruchom stoper ${describeStepTimer(seconds)}: ${step.title}`, `Start ${describeStepTimer(seconds)} timer: ${step.title}`)}
            title={tr(`Stoper ${describeStepTimer(seconds)} — dotknij, aby uruchomić lub wstrzymać. Gdy czas minie, krok sam się odhaczy.`, `${describeStepTimer(seconds)} timer — tap to start or pause. When time is up, the step checks itself off.`)}
            onClick={() => toggleTimer(step, seconds)}>
            {running ? <Pause size={13}/> : <Play size={13} fill="currentColor"/>}
            <span>{formatStepTimer(remainingMs / 1000)}</span>
          </button>
        </div>;
      })}
    </div>
    {log.completed && <div className="completion-message"><span>✦</span><div><strong>{tr('Rutyna ukończona!', 'Routine completed!')}</strong><small>{tr(`Świetna robota. +${xp} XP zostało uwzględnione w Twoim progresie.`, `Great job. +${xp} XP has been added to your progress.`)}</small></div></div>}
    </div>
    <div className="modal-bottom routine-session-actions routine-actions">
      <button type="button" className="routine-actions-icon" onClick={onClose} aria-label={tr('Wróć do kalendarza', 'Back to calendar')} title={tr('Wróć do kalendarza', 'Back to calendar')}><ArrowLeft size={19}/></button>
      {log.completed
        ? <button type="button" className="btn btn--secondary routine-actions-main" onClick={onUndo}><RotateCcw size={16}/> {tr('Cofnij ukończenie', 'Undo completion')}</button>
        : <button type="button" disabled={count === 0 || completed !== count} className="btn btn--primary routine-actions-main" onClick={onComplete}>
          <Check size={17}/> {tr('Zakończ rutynę', 'Finish routine')} <span className="routine-actions-badge">{count > 0 && completed === count ? `+${xp} XP` : `${completed}/${count}`}</span>
        </button>}
      <div className="routine-actions-more-wrap" ref={menuRef}>
        <button type="button" className="routine-actions-icon routine-actions-more" aria-label={tr('Więcej opcji rutyny', 'More routine options')} title={tr('Więcej opcji', 'More options')}
          aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><MoreHorizontal size={19}/></button>
        {menuOpen && <div className="routine-actions-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEdit(); }}><PencilLine size={16}/> {tr('Edytuj szablon', 'Edit template')}</button>
          {onSkip && !skipped && <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); skipThisOccurrence(); }}><CalendarX2 size={16}/> {tr('Usuń to wystąpienie', 'Delete this occurrence')}</button>}
          <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenuOpen(false); if (window.confirm(tr(`Usunąć rutynę „${routine.title}” wraz z całą historią wykonań? Tej operacji nie można cofnąć.`, `Delete the routine “${routine.title}” along with its entire completion history? This can’t be undone.`))) onDelete(); }}><Trash2 size={16}/> {tr('Usuń całą rutynę', 'Delete entire routine')}</button>
        </div>}
      </div>
    </div>
    {moving && onMove && <MoveOccurrenceModal kind="routine" title={routine.title} date={date} time={displayTime} sourceDate={sourceDate ?? date} originalTime={routine.time}
      otherTimesOn={otherTimesOn} onMove={(nextDate, nextTime) => onMove(nextDate, nextTime ?? displayTime)} onClose={() => setMoving(false)}/>}
  </div></div>;
}

interface EditorProps {
  routine?: Routine;
  categories: CategoryConfig;
  /** Przypomnienia proponowane dla nowej rutyny (z ustawień powiadomień). */
  defaultReminders?: number[];
  notificationsEnabled?: boolean;
  onEnableNotifications?: () => void;
  onSave: (routine: Routine) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  /** Usunięte pojedyncze wystąpienia od dziś (dni z harmonogramu) — do przywrócenia. */
  skippedDates?: string[];
  onRestoreOccurrence?: (sourceDate: string) => void;
}
/** Dni tygodnia w edytorze, indeks jak Date.getDay(). */
const weekLabels = () => pick(['N', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'], ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);

export function RoutineEditor({ routine, categories, defaultReminders = [], notificationsEnabled = false, onEnableNotifications, onSave, onDelete, onClose, skippedDates = [], onRestoreOccurrence }: EditorProps) {
  const [title, setTitle] = useState(routine?.title ?? '');
  const [description, setDescription] = useState(routine?.description ?? '');
  const [icon, setIcon] = useState<IconKey>(routine?.icon ?? 'sun');
  const [category, setCategory] = useState<CategoryKey>(routine?.category ?? 'unpaid');
  const [image, setImage] = useState<string | undefined>(routine?.image);
  const [time, setTime] = useState(routine?.time ?? '07:00');
  const [duration, setDuration] = useState(routine?.duration ?? 30);
  const [weekdays, setWeekdays] = useState(routine?.weekdays ?? [0,1,2,3,4,5,6]);
  const [reminders, setReminders] = useState<number[]>(() => routine ? [...(routine.reminders ?? [])] : [...defaultReminders]);
  const [steps, setSteps] = useState<RoutineStep[]>(routine?.steps ?? [{ id: crypto.randomUUID(), title: '' }]);
  const [scheduleStepId, setScheduleStepId] = useState<string | null>(null);
  const [timerStepId, setTimerStepId] = useState<string | null>(null);
  const [picker, setPicker] = useState<'icons' | 'photos' | null>(null);
  const toggleStepWeekday = (stepId: string, weekday: number) => setSteps(previous => previous.map(step => {
    if (step.id !== stepId) return step;
    // On the first tap, switch from daily to this one day (e.g. Sunday peeling).
    if (step.repeatEveryDays) return {...step, weekdays: [weekday], repeatEveryDays: undefined, repeatFrom: undefined};
    if (!Array.isArray(step.weekdays)) return {...step, weekdays: [weekday]};
    const selected = step.weekdays;
    // Keep at least one day active. Use "Codziennie" to reset the schedule.
    if (selected.includes(weekday) && selected.length === 1) return step;
    return {...step, weekdays: normalizeStepWeekdays(selected.includes(weekday) ? selected.filter(d => d !== weekday) : [...selected,weekday])};
  }));
  const { listRef: stepsRef, hint: editorHint } = useRoutineStepDrag(steps, setSteps);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (!scheduleStepId && !timerStepId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setScheduleStepId(null); setTimerStepId(null); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [scheduleStepId, timerStepId]);
  /** Stoper kroku w edytorze: liczba sekund albo null (bez stopera); zapis razem z rutyną. */
  const setStepTimer = (stepId: string, seconds: number | null) => setSteps(previous => previous.map(step => {
    if (step.id !== stepId) return step;
    const next = { ...step };
    if (seconds && seconds > 0) next.timerSeconds = Math.min(STEP_TIMER_MAX_SECONDS, Math.max(1, Math.round(seconds)));
    else delete next.timerSeconds;
    return next;
  }));
  // XP rutyny liczy aplikacja: czas × kategoria jak w zadaniach + 1 XP za krok; premia za regularność dochodzi przy wykonaniu.
  const namedSteps = steps.filter(s => s.title.trim()).length;
  const baseXp = routineXp(category, duration, namedSteps, 0);
  const week = weekLabels();
  function save() {
    const validSteps = orderRoutineSteps(steps.filter(s => s.title.trim()).map(s => ({ ...s, title: s.title.trim() })));
    if (!title.trim() || !validSteps.length || !weekdays.length) return;
    onSave({ id: routine?.id ?? crypto.randomUUID(), title: title.trim(), description: description.trim(), icon, image, category, time, duration, xp: routineXp(category, duration, validSteps.length, 0), weekdays, steps: validSteps, active: routine?.active ?? true, ...(reminders.length ? { reminders } : {}) });
  }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal routine-editor" role="dialog" aria-modal="true" aria-label={tr('Edytor rutyny', 'Routine editor')}>
    <div className="modal-heading modal-heading--identity"><div className="modal-heading-identity"><TaskVisual icon={icon} image={image} category={category} categories={categories} size="large" className="modal-heading-art"/><div><span className="eyebrow">{tr('BUDUJ DOBRE NAWYKI', 'BUILD GOOD HABITS')}</span><h2>{routine ? tr('Edytuj rutynę', 'Edit routine') : tr('Nowa rutyna', 'New routine')}</h2><CategoryBadge category={category} categories={categories} compact/></div></div><button className="icon-btn" onClick={onClose} aria-label={tr('Zamknij', 'Close')}><X size={20}/></button></div>
    <div className="modal-fields"><div className="field"><span>{tr('Ikona i nazwa', 'Icon & name')}</span>
      <div className="name-icon-row"><button type="button" className="selected-icon selected-icon--square" onClick={()=>setPicker(p=>p==='icons'?null:'icons')} aria-label={tr('Wybierz ikonę', 'Choose icon')}><TaskIcon name={icon} size={24}/></button><input ref={inputRef} placeholder={tr('Np. Wieczorna regeneracja', 'E.g. Evening wind-down')} value={title} onChange={e=>setTitle(e.target.value)} maxLength={80}/></div>
      <div className="routine-assets-row"><button type="button" className="btn btn--secondary" onClick={()=>setPicker(p=>p==='icons'?null:'icons')}><TaskIcon name={icon} size={17}/> {tr('Ponad 1000 ikon', 'Over 1,000 icons')}</button><button type="button" className="btn btn--secondary" onClick={()=>setPicker(p=>p==='photos'?null:'photos')}><Camera size={17}/> {tr(`Galeria ${PHOTO_OPTIONS.length} zdjęć`, `Gallery of ${PHOTO_OPTIONS.length} photos`)}</button>{image&&<span className="routine-selected-image"><img src={image} alt={tr('Miniatura rutyny', 'Routine thumbnail')}/><button type="button" onClick={()=>setImage(undefined)} aria-label={tr('Usuń zdjęcie', 'Remove photo')}><X size={13}/></button></span>}</div>
      {picker==='icons'&&<IconPicker value={icon} onSelect={v=>{setIcon(v);setPicker(null);}}/>}
      {picker==='photos'&&<PhotoPicker value={image} onSelect={v=>{setImage(v);setPicker(null);}}/>}
    </div>
    <label className="field"><span>{tr('Opis', 'Description')}</span><input value={description} onChange={e=>setDescription(e.target.value)} placeholder={tr('Co daje Ci ta rutyna?', 'What does this routine give you?')} /></label>
    <div className="field"><span>{tr('Kategoria finansowa', 'Financial category')}</span><CategoryChoices categories={categories} value={category} onChange={setCategory}/></div>
    <div className="two-fields"><div className="field"><span>{tr('Godzina', 'Time')}</span><TimePicker value={time} onChange={v => setTime(v ?? '07:00')}/></div><div className="field"><span>{tr('Czas trwania', 'Duration')}</span><DurationPicker value={duration} onChange={setDuration}/></div></div>
    <ReminderPicker value={reminders} onChange={setReminders} time={time} systemEnabled={notificationsEnabled} onEnableSystem={onEnableNotifications}/>
    <div className="field"><span>{tr('Powtarzaj w dni', 'Repeat on')}</span><div className="weekday-picker">{week.map((w,i)=><button key={i} className={weekdays.includes(i) ? 'selected' : ''} onClick={()=>setWeekdays(arr=>arr.includes(i) ? arr.filter(x=>x!==i) : [...arr,i].sort())}>{w}</button>)}</div>
      {routine && onRestoreOccurrence && <SkippedOccurrences dates={skippedDates} onRestore={onRestoreOccurrence}/>}
    </div>
    <div className="field"><span>{tr('Lista kroków', 'Steps')}</span>
      <small className="routine-gesture-note">{tr('Przytrzymaj ⋮⋮: przesuń w górę lub dół, aby zmienić kolejność; w prawo — dodaj podzadanie, w lewo — odłącz.', 'Hold ⋮⋮ and drag up or down to reorder; drag right to make it a subtask, left to detach it.')}</small>
      <div className="editor-steps" ref={stepsRef}>
        {orderRoutineSteps(steps).map((s,i)=><div className={`editor-step ${s.parentId ? 'editor-step--child' : ''} ${editorHint?.id === s.id ? 'routine-step--dragging' : ''} ${editorHint?.action === 'nest' && editorHint.targetId === s.id ? 'routine-step--drop-parent' : ''} ${editorHint?.action === 'reorder' && editorHint.markerId === s.id ? `routine-step--drop-${editorHint.position}` : ''}`} data-routine-step-id={s.id} key={s.id}>
          <span className="editor-step-drag" data-step-drag-handle title={tr('Przytrzymaj: w pionie zmienisz kolejność, w poziomie zagnieżdżenie', 'Hold and drag: vertically to reorder, horizontally to nest')} aria-label={tr(`Przenieś krok ${s.title}`, `Move step ${s.title}`)}><GripVertical size={18}/></span>
          <div className="editor-step-field">
            {stepTimerSeconds(s.timerSeconds) && <span className="routine-step-timer-badge" title={tr(`Stoper: ${describeStepTimer(stepTimerSeconds(s.timerSeconds)!)}`, `Timer: ${describeStepTimer(stepTimerSeconds(s.timerSeconds)!)}`)}>
              <Timer size={10}/>{shortStepTimer(stepTimerSeconds(s.timerSeconds)!)}
            </span>}
            <span className="routine-step-days-badge" title={tr(`Harmonogram: ${stepWeekdaysLabel(s)}`, `Schedule: ${stepWeekdaysLabel(s)}`)}>
              <CalendarDays size={11}/>{stepWeekdaysLabel(s)}
            </span>
            <input className="editor-step-name" value={s.title} placeholder={tr(`Krok ${i+1}`, `Step ${i+1}`)} onChange={e=>setSteps(arr=>arr.map(x=>x.id===s.id ? {...x,title:e.target.value} : x))}/>
          </div>
          {(() => { const seconds = stepTimerSeconds(s.timerSeconds); return <button type="button" className={`routine-step-timer-toggle ${seconds ? 'routine-step-timer-toggle--set' : ''}`}
            aria-label={seconds ? tr(`Stoper kroku ${s.title || i+1}: ${describeStepTimer(seconds)}`, `Timer for step ${s.title || i+1}: ${describeStepTimer(seconds)}`) : tr(`Dodaj stoper do kroku ${s.title || i+1}`, `Add a timer to step ${s.title || i+1}`)}
            title={seconds ? tr(`Stoper: ${describeStepTimer(seconds)}`, `Timer: ${describeStepTimer(seconds)}`) : tr('Dodaj stoper, np. mycie zębów 2 min', 'Add a timer, e.g. brushing teeth 2 min')}
            onClick={()=>setTimerStepId(s.id)}>
            <Timer size={15}/>
          </button>; })()}
          <button type="button" className={`routine-step-schedule-toggle ${Array.isArray(s.weekdays) || s.repeatEveryDays ? 'routine-step-schedule-toggle--custom' : ''}`}
            aria-label={tr(`Harmonogram kroku ${s.title || i+1}: ${stepWeekdaysLabel(s)}`, `Schedule for step ${s.title || i+1}: ${stepWeekdaysLabel(s)}`)}
            title={tr(`Wybierz dni wykonywania: ${stepWeekdaysLabel(s)}`, `Choose the days: ${stepWeekdaysLabel(s)}`)}
            onClick={()=>setScheduleStepId(s.id)}>
            <CalendarDays size={15}/>

          </button>
          <button type="button" className="editor-step-nest" title={s.parentId ? tr('Zmień na osobny krok', 'Make it a separate step') : tr('Zrób podzadanie poprzedniego kroku', 'Make it a subtask of the previous step')} aria-label={s.parentId ? tr(`Odłącz ${s.title}`, `Detach ${s.title}`) : tr(`Zagnieźdź ${s.title}`, `Nest ${s.title}`)} onClick={()=>setSteps(arr=>{
            const ordered=orderRoutineSteps(arr);
            if(s.parentId)return unnestRoutineStep(ordered,s.id);
            const index=ordered.findIndex(item=>item.id===s.id);
            const parent=[...ordered.slice(0,index)].reverse().find(item=>!item.parentId);
            return parent?placeRoutineStep(ordered,s.id,parent.id):ordered;
          })}>{s.parentId ? <ArrowLeft size={15}/> : <ArrowRight size={15}/>}</button>
          <button type="button" aria-label={tr('Usuń krok', 'Delete step')} onClick={()=>{setScheduleStepId(current=>current===s.id?null:current);setTimerStepId(current=>current===s.id?null:current);setSteps(arr=>arr.filter(x=>x.id!==s.id).map(x=>x.parentId===s.id?{...x,parentId:undefined}:x));}}><X size={16}/></button>
        </div>)}
      </div>
      {editorHint && <small className="routine-drag-hint" role="status">{editorHint.label}</small>}
      <button type="button" className="link-btn" onClick={()=>setSteps(arr=>[...arr,{id:crypto.randomUUID(),title:''}])}><Plus size={15}/> {tr('Dodaj kolejny krok', 'Add another step')}</button>
    </div>
    <div className="field"><span>{tr('Nagroda', 'Reward')} <span className="xp-text">✦ XP</span></span><XpPreview xp={baseXp} label={tr('XP za wykonanie rutyny', 'XP for completing the routine')}
      hint={tr(`Liczone automatycznie: czas i kategoria jak w zadaniach, +${XP_RULES.routineStep} XP za każdy krok. Za wykonania z rzędu dochodzi do +${XP_RULES.routineStreakCap} XP.`, `Calculated automatically: time and category as for tasks, +${XP_RULES.routineStep} XP for each step. Completions in a row add up to +${XP_RULES.routineStreakCap} XP.`)}/></div></div>
    <div className="modal-bottom routine-editor-footer">
      {routine
        ? <button type="button" className="routine-editor-delete" aria-label={tr('Usuń rutynę', 'Delete routine')} title={tr('Usuń rutynę', 'Delete routine')} onClick={()=>{if(window.confirm(tr('Usunąć rutynę i historię jej wykonań?', 'Delete the routine and its completion history?'))) onDelete(routine.id);}}><Trash2 size={18}/><span>{tr('Usuń', 'Delete')}</span></button>
        : <span className="modal-tip routine-editor-tip"><ArrowLeft size={13}/> {tr('Możesz edytować rutynę później', 'You can edit the routine later')}</span>}
      <button type="button" className="btn btn--ghost routine-editor-cancel" onClick={onClose}>{tr('Anuluj', 'Cancel')}</button>
      <button type="button" className="btn btn--primary routine-editor-save" disabled={!title.trim() || !weekdays.length || !steps.some(s=>s.title.trim())} onClick={save}><Check size={16}/> {tr('Zapisz rutynę', 'Save routine')}</button>
    </div>
  </div>
    {scheduleStepId && (() => {
      const scheduledStep = steps.find(step => step.id === scheduleStepId);
      if (!scheduledStep) return null;
      return <div className="routine-weekdays-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setScheduleStepId(null);}}>
        <div className="routine-weekdays-dialog" role="dialog" aria-modal="true" aria-label={tr(`Dni wykonywania kroku ${scheduledStep.title}`, `Days for step ${scheduledStep.title}`)}>
          <div className="routine-weekdays-heading"><div><span className="eyebrow">{tr('HARMONOGRAM KROKU', 'STEP SCHEDULE')}</span><h3>{scheduledStep.title || tr('Krok rutyny', 'Routine step')}</h3></div>
            <button type="button" className="icon-btn" aria-label={tr('Zamknij wybór dni', 'Close day picker')} onClick={()=>setScheduleStepId(null)}><X size={19}/></button>
          </div>
          <p className="routine-weekdays-description">{tr('Wybierz dni tygodnia albo powtarzanie co 2 dni.', 'Choose days of the week or repeat every 2 days.')}</p>
          <div className="routine-weekdays-actions">
            <button type="button" className={`btn ${scheduledStep.repeatEveryDays === 2 ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => setSteps(previous => previous.map(step => step.id === scheduledStep.id
                ? {...step, weekdays: undefined, repeatEveryDays: 2, repeatFrom: step.repeatFrom ?? todayKey()} : step))}>
              {tr('Co 2 dni', 'Every 2 days')}
            </button>
          </div>
          {scheduledStep.repeatEveryDays === 2 && <label className="field">
            <span>{tr('Pierwszy dzień cyklu', 'First day of the cycle')}</span>
            <input type="date" value={scheduledStep.repeatFrom ?? todayKey()}
              onChange={event => { const date = event.target.value; if (!date) return;
                setSteps(previous => previous.map(step => step.id === scheduledStep.id ? {...step, repeatFrom: date} : step)); }}/>
          </label>}
          <div className="routine-step-weekdays">
            {week.map((day,weekDay)=><button type="button" key={weekDay}
              className={!scheduledStep.repeatEveryDays && (!scheduledStep.weekdays || scheduledStep.weekdays.includes(weekDay)) ? 'selected' : ''}
              aria-pressed={!scheduledStep.repeatEveryDays && (!scheduledStep.weekdays || scheduledStep.weekdays.includes(weekDay))}
              onClick={()=>toggleStepWeekday(scheduledStep.id,weekDay)}>{day}</button>)}
          </div>
          {scheduledStep.parentId && <small className="routine-step-schedule-info">{tr('Ten krok będzie widoczny tylko wtedy, gdy aktywny jest również jego rodzic.', 'This step will only show when its parent step is active too.')}</small>}
          <div className="routine-weekdays-actions">
            <button type="button" className="btn btn--ghost" onClick={()=>setSteps(previous=>previous.map(step=>step.id===scheduledStep.id?{...step,weekdays:[],repeatEveryDays:undefined,repeatFrom:undefined}:step))}>{tr('Żaden dzień', 'No days')}</button>
            <button type="button" className="btn btn--ghost" onClick={()=>setSteps(previous=>previous.map(step=>step.id===scheduledStep.id?{...step,weekdays:undefined,repeatEveryDays:undefined,repeatFrom:undefined}:step))}>{tr('Codziennie', 'Every day')}</button>
            <button type="button" className="btn btn--primary" onClick={()=>setScheduleStepId(null)}><Check size={15}/> {tr('Gotowe', 'Done')}</button>
          </div>
        </div>
      </div>;
    })()}
    {timerStepId && (() => {
      const timedStep = steps.find(step => step.id === timerStepId);
      if (!timedStep) return null;
      const seconds = stepTimerSeconds(timedStep.timerSeconds);
      const minutes = seconds ? Math.floor(seconds / 60) : 0;
      const rest = seconds ? seconds % 60 : 0;
      // Pole puste albo nieliczbowe = 0; zakres pilnuje setStepTimer (1 s – 60 min).
      const parse = (value: string, max: number) => Math.min(max, Math.max(0, Number.parseInt(value, 10) || 0));
      return <div className="routine-weekdays-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setTimerStepId(null);}}>
        <div className="routine-weekdays-dialog routine-timer-dialog" role="dialog" aria-modal="true" aria-label={tr(`Stoper kroku ${timedStep.title}`, `Step timer: ${timedStep.title}`)}>
          <div className="routine-weekdays-heading"><div><span className="eyebrow">{tr('STOPER KROKU', 'STEP TIMER')}</span><h3>{timedStep.title || tr('Krok rutyny', 'Routine step')}</h3></div>
            <button type="button" className="icon-btn" aria-label={tr('Zamknij stoper', 'Close timer')} onClick={()=>setTimerStepId(null)}><X size={19}/></button>
          </div>
          <p className="routine-weekdays-description">{tr('W rutynie dotknij czasu po prawej stronie kroku, żeby uruchomić odliczanie. Gdy czas minie, krok sam się odhaczy (zawsze możesz go odznaczyć), a telefon da krótki sygnał.', 'In the routine, tap the time on the right of the step to start the countdown. When time is up, the step checks itself off (you can always uncheck it) and your phone gives a short signal.')}</p>
          <div className="routine-timer-presets" role="group" aria-label={tr('Gotowe czasy', 'Preset times')}>
            {STEP_TIMER_PRESETS.map(value => <button type="button" key={value} className={seconds === value ? 'selected' : ''} aria-pressed={seconds === value}
              onClick={()=>setStepTimer(timedStep.id, value)}>{describeStepTimer(value)}</button>)}
          </div>
          <div className="routine-timer-custom">
            <span>{tr('Własny czas', 'Custom time')}</span>
            <label><input type="number" inputMode="numeric" min={0} max={60} placeholder="0" aria-label={tr('Minuty', 'Minutes')} value={seconds ? minutes : ''}
              onChange={e=>setStepTimer(timedStep.id, parse(e.target.value, 60) * 60 + rest)}/> min</label>
            <label><input type="number" inputMode="numeric" min={0} max={59} placeholder="0" aria-label={tr('Sekundy', 'Seconds')} value={seconds ? rest : ''}
              onChange={e=>setStepTimer(timedStep.id, minutes * 60 + parse(e.target.value, 59))}/> s</label>
          </div>
          <div className="routine-weekdays-actions">
            <button type="button" className="btn btn--ghost" disabled={!seconds} onClick={()=>{setStepTimer(timedStep.id, null);setTimerStepId(null);}}>{tr('Bez stopera', 'No timer')}</button>
            <button type="button" className="btn btn--primary" onClick={()=>setTimerStepId(null)}><Check size={15}/> {tr('Gotowe', 'Done')}</button>
          </div>
        </div>
      </div>;
    })()}
</div>;
}

export function emptyLog(id: string): RoutineLog { return { id, checkedStepIds: [], completed: false }; }
export function routineOccurs(routine: Routine, date: string) { return occursOn(routine, date); }
export function isRoutineForToday(routine: Routine) { return routineOccurs(routine, todayKey()); }
