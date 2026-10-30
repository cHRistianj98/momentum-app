import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Camera, Check, CheckCircle2, Clock3, Flame, GripVertical, MoreHorizontal, Pause, PencilLine, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { TaskIcon } from '../lib/icons';
import { CategoryBadge, TaskVisual } from './VisualIdentity';
import { IconPicker } from './IconPicker';
import { PhotoPicker } from './PhotoPicker';
import { TimePicker, DurationPicker, XpStepper } from './FormControls';
import { CategoryChoices } from './CategoryChoices';
import { ReminderPicker } from './ReminderPicker';
import { formatDuration, fullDate, todayKey } from '../lib/date';
import { orderRoutineSteps, placeRoutineStep, unnestRoutineStep } from '../lib/routineHierarchy';
import { useRoutineStepDrag } from '../lib/useRoutineStepDrag';
import { normalizeStepWeekdays, routineStepsOnDate, stepWeekdaysLabel } from '../lib/routineStepSchedule';
import type { CategoryConfig, CategoryKey, IconKey, Routine, RoutineLog, RoutineStep } from '../types';

interface SessionProps {
  routine: Routine;
  date: string;
  log: RoutineLog;
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
}

export function RoutineSession({ routine, date, log, duration, displayTime, categoryColor, categories, onToggleStep, onComplete, onUndo, onEdit, onDelete, onClose }: SessionProps) {
  const visibleSteps = orderRoutineSteps(routineStepsOnDate(routine.steps, date));
  const completed = visibleSteps.filter(step => log.checkedStepIds.includes(step.id)).length;
  const count = visibleSteps.length;
  const [timer, setTimer] = useState<{ stepId: string; seconds: number; endAt: number | null } | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);
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
  useEffect(() => {
    if (!timer?.endAt) return;
    const handle = window.setInterval(() => setTimerNow(Date.now()), 250);
    return () => window.clearInterval(handle);
  }, [timer?.endAt]);
  useEffect(() => {
    if (timer?.endAt && timerNow >= timer.endAt) {
      setTimer(previous => previous?.endAt && timerNow >= previous.endAt
        ? { ...previous, seconds: 0, endAt: null } : previous);
    }
  }, [timer?.endAt, timerNow]);
  const remaining = (step: RoutineStep) => timer?.stepId !== step.id
    ? (step.timerSeconds ?? 0)
    : timer.endAt ? Math.max(0, Math.ceil((timer.endAt - timerNow) / 1000)) : timer.seconds;
  function toggleTimer(step: RoutineStep) {
    setTimer(previous => {
      if (previous?.stepId !== step.id) return { stepId: step.id, seconds: step.timerSeconds ?? 30, endAt: Date.now() + (step.timerSeconds ?? 30) * 1000 };
      if (previous.endAt) return { ...previous, seconds: Math.max(0, Math.ceil((previous.endAt - Date.now()) / 1000)), endAt: null };
      const seconds = previous.seconds > 0 ? previous.seconds : step.timerSeconds ?? 30;
      return { ...previous, seconds, endAt: Date.now() + seconds * 1000 };
    });
    setTimerNow(Date.now());
  }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal routine-modal" role="dialog" aria-modal="true" aria-label="Rutyna">
    <div className="routine-session-scroll">
    <div className="modal-heading modal-heading--identity"><div className="modal-heading-identity"><TaskVisual icon={routine.icon} image={routine.image} category={routine.category} categories={categories} size="large" className="modal-heading-art"/><div><span className="eyebrow">TWOJA RUTYNA · {fullDate(date)}</span><h2>{routine.title}</h2><CategoryBadge category={routine.category} categories={categories} compact/></div></div><button className="icon-btn" onClick={onClose} aria-label="Zamknij"><X size={20} /></button></div>
    <div className="routine-banner" style={{ '--routine-color': categoryColor } as React.CSSProperties}><TaskVisual icon={routine.icon} image={routine.image} category={routine.category} categories={categories} size="large" className="routine-banner-icon"/><div><strong>{routine.description || 'Małe kroki, wielki progres.'}</strong><span><Clock3 size={14} /> {displayTime} · {formatDuration(duration)} <span className="dot-spacer">·</span> <Flame size={14} /> +{routine.xp} XP</span></div></div>
    <div className="routine-progress-heading"><strong>Twoje kroki</strong><span>{completed}/{count} wykonane</span></div><div className="progress-track"><div style={{ width: `${count ? completed/count*100 : 0}%` }} /></div>
    <div className="routine-checklist">
      {count === 0 && <div className="routine-no-steps">W tym dniu nie zaplanowano żadnych kroków. Harmonogram każdego kroku zmienisz w „Edytuj szablon”.</div>}
      {visibleSteps.map((step, i) => {
        const isDone = log.checkedStepIds.includes(step.id);
        const body = <>
          <span className="step-counter">{isDone ? <Check size={17} strokeWidth={3} /> : step.parentId ? '↳' : String(i + 1).padStart(2, '0')}</span>
          <span className="routine-step-title">{step.title}</span>
          <CheckCircle2 className="step-right" size={18}/>
        </>;
        if (!step.timerSeconds) return <button key={step.id} type="button" data-routine-step-id={step.id}
          className={`routine-step ${step.parentId ? 'routine-step--child' : ''} ${isDone ? 'checked' : ''}`}
          disabled={log.completed} onClick={() => onToggleStep(step.id)}>{body}</button>;
        const active = timer?.stepId === step.id;
        const running = active && Boolean(timer.endAt);
        return <div key={step.id} data-routine-step-id={step.id}
          className={`routine-step routine-step--timed ${step.parentId ? 'routine-step--child' : ''} ${isDone ? 'checked' : ''}`}>
          <button type="button" className="routine-step-main" disabled={log.completed}
            aria-label={`${isDone ? 'Odznacz' : 'Oznacz'} ${step.title}`} onClick={() => onToggleStep(step.id)}>{body}</button>
          <button type="button" className={`routine-step-timer ${running ? 'routine-step-timer--running' : ''}`}
            aria-label={`${running ? 'Pauza' : 'Uruchom stoper'}: ${step.title}`}
            title="Stoper kroku — dotknij, aby uruchomić lub zatrzymać"
            onClick={() => toggleTimer(step)}>
            {running ? <Pause size={13}/> : <Play size={13} fill="currentColor"/>}
            <span>{remaining(step)} s</span>
          </button>
        </div>;
      })}
    </div>
    {log.completed && <div className="completion-message"><span>✦</span><div><strong>Rutyna ukończona!</strong><small>Świetna robota. +{routine.xp} XP zostało uwzględnione w Twoim progresie.</small></div></div>}
    </div>
    <div className="modal-bottom routine-session-actions routine-actions">
      <button type="button" className="routine-actions-icon" onClick={onClose} aria-label="Wróć do kalendarza" title="Wróć do kalendarza"><ArrowLeft size={19}/></button>
      {log.completed
        ? <button type="button" className="btn btn--secondary routine-actions-main" onClick={onUndo}><RotateCcw size={16}/> Cofnij ukończenie</button>
        : <button type="button" disabled={count === 0 || completed !== count} className="btn btn--primary routine-actions-main" onClick={onComplete}>
          <Check size={17}/> Zakończ rutynę <span className="routine-actions-badge">{count > 0 && completed === count ? `+${routine.xp} XP` : `${completed}/${count}`}</span>
        </button>}
      <div className="routine-actions-more-wrap" ref={menuRef}>
        <button type="button" className="routine-actions-icon routine-actions-more" aria-label="Więcej opcji rutyny" title="Więcej opcji"
          aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)}><MoreHorizontal size={19}/></button>
        {menuOpen && <div className="routine-actions-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEdit(); }}><PencilLine size={16}/> Edytuj szablon</button>
          <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenuOpen(false); if (window.confirm(`Usunąć rutynę „${routine.title}” wraz z całą historią wykonań? Tej operacji nie można cofnąć.`)) onDelete(); }}><Trash2 size={16}/> Usuń rutynę</button>
        </div>}
      </div>
    </div>
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
}
const WEEK = ['N', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];

export function RoutineEditor({ routine, categories, defaultReminders = [], notificationsEnabled = false, onEnableNotifications, onSave, onDelete, onClose }: EditorProps) {
  const [title, setTitle] = useState(routine?.title ?? '');
  const [description, setDescription] = useState(routine?.description ?? '');
  const [icon, setIcon] = useState<IconKey>(routine?.icon ?? 'sun');
  const [category, setCategory] = useState<CategoryKey>(routine?.category ?? 'unpaid');
  const [image, setImage] = useState<string | undefined>(routine?.image);
  const [time, setTime] = useState(routine?.time ?? '07:00');
  const [duration, setDuration] = useState(routine?.duration ?? 30);
  const [xp, setXp] = useState(routine?.xp ?? 40);
  const [weekdays, setWeekdays] = useState(routine?.weekdays ?? [0,1,2,3,4,5,6]);
  const [reminders, setReminders] = useState<number[]>(() => routine ? [...(routine.reminders ?? [])] : [...defaultReminders]);
  const [steps, setSteps] = useState<RoutineStep[]>(routine?.steps ?? [{ id: crypto.randomUUID(), title: '' }]);
  const [scheduleStepId, setScheduleStepId] = useState<string | null>(null);
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
    if (!scheduleStepId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setScheduleStepId(null); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [scheduleStepId]);
  function save() {
    const validSteps = orderRoutineSteps(steps.filter(s => s.title.trim()).map(s => ({ ...s, title: s.title.trim() })));
    if (!title.trim() || !validSteps.length || !weekdays.length) return;
    onSave({ id: routine?.id ?? crypto.randomUUID(), title: title.trim(), description: description.trim(), icon, image, category, time, duration, xp, weekdays, steps: validSteps, active: routine?.active ?? true, ...(reminders.length ? { reminders } : {}) });
  }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal routine-editor" role="dialog" aria-modal="true" aria-label="Edytor rutyny">
    <div className="modal-heading modal-heading--identity"><div className="modal-heading-identity"><TaskVisual icon={icon} image={image} category={category} categories={categories} size="large" className="modal-heading-art"/><div><span className="eyebrow">BUDUJ DOBRE NAWYKI</span><h2>{routine ? 'Edytuj rutynę' : 'Nowa rutyna'}</h2><CategoryBadge category={category} categories={categories} compact/></div></div><button className="icon-btn" onClick={onClose} aria-label="Zamknij"><X size={20}/></button></div>
    <div className="modal-fields"><div className="field"><span>Ikona i nazwa</span>
      <div className="name-icon-row"><button type="button" className="selected-icon selected-icon--square" onClick={()=>setPicker(p=>p==='icons'?null:'icons')} aria-label="Wybierz ikonę"><TaskIcon name={icon} size={24}/></button><input ref={inputRef} placeholder="Np. Wieczorna regeneracja" value={title} onChange={e=>setTitle(e.target.value)} maxLength={80}/></div>
      <div className="routine-assets-row"><button type="button" className="btn btn--secondary" onClick={()=>setPicker(p=>p==='icons'?null:'icons')}><TaskIcon name={icon} size={17}/> Ponad 1000 ikon</button><button type="button" className="btn btn--secondary" onClick={()=>setPicker(p=>p==='photos'?null:'photos')}><Camera size={17}/> Galeria 100 zdjęć</button>{image&&<span className="routine-selected-image"><img src={image} alt="Miniatura rutyny"/><button type="button" onClick={()=>setImage(undefined)} aria-label="Usuń zdjęcie"><X size={13}/></button></span>}</div>
      {picker==='icons'&&<IconPicker value={icon} onSelect={v=>{setIcon(v);setPicker(null);}}/>}
      {picker==='photos'&&<PhotoPicker value={image} onSelect={v=>{setImage(v);setPicker(null);}}/>}
    </div>
    <label className="field"><span>Opis</span><input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Co daje Ci ta rutyna?" /></label>
    <div className="field"><span>Kategoria finansowa</span><CategoryChoices categories={categories} value={category} onChange={setCategory}/></div>
    <div className="two-fields"><div className="field"><span>Godzina</span><TimePicker value={time} onChange={v => setTime(v ?? '07:00')}/></div><div className="field"><span>Czas trwania</span><DurationPicker value={duration} onChange={setDuration}/></div></div>
    <ReminderPicker value={reminders} onChange={setReminders} time={time} systemEnabled={notificationsEnabled} onEnableSystem={onEnableNotifications}/>
    <div className="field"><span>Powtarzaj w dni</span><div className="weekday-picker">{WEEK.map((w,i)=><button key={i} className={weekdays.includes(i) ? 'selected' : ''} onClick={()=>setWeekdays(arr=>arr.includes(i) ? arr.filter(x=>x!==i) : [...arr,i].sort())}>{w}</button>)}</div></div>
    <div className="field"><span>Lista kroków</span>
      <small className="routine-gesture-note">Przytrzymaj ⋮⋮: przesuń w górę lub dół, aby zmienić kolejność; w prawo — dodaj podzadanie, w lewo — odłącz.</small>
      <div className="editor-steps" ref={stepsRef}>
        {orderRoutineSteps(steps).map((s,i)=><div className={`editor-step ${s.parentId ? 'editor-step--child' : ''} ${editorHint?.id === s.id ? 'routine-step--dragging' : ''} ${editorHint?.action === 'nest' && editorHint.targetId === s.id ? 'routine-step--drop-parent' : ''} ${editorHint?.action === 'reorder' && editorHint.markerId === s.id ? `routine-step--drop-${editorHint.position}` : ''}`} data-routine-step-id={s.id} key={s.id}>
          <span className="editor-step-drag" data-step-drag-handle title="Przytrzymaj: w pionie zmienisz kolejność, w poziomie zagnieżdżenie" aria-label={`Przenieś krok ${s.title}`}><GripVertical size={18}/></span>
          <div className="editor-step-field">
            <span className="routine-step-days-badge" title={`Harmonogram: ${stepWeekdaysLabel(s)}`}>
              <CalendarDays size={11}/>{stepWeekdaysLabel(s)}
            </span>
            <input className="editor-step-name" value={s.title} placeholder={`Krok ${i+1}`} onChange={e=>setSteps(arr=>arr.map(x=>x.id===s.id ? {...x,title:e.target.value} : x))}/>
          </div>
          <button type="button" className={`routine-step-schedule-toggle ${Array.isArray(s.weekdays) || s.repeatEveryDays ? 'routine-step-schedule-toggle--custom' : ''}`}
            aria-label={`Harmonogram kroku ${s.title || i+1}: ${stepWeekdaysLabel(s)}`}
            title={`Wybierz dni wykonywania: ${stepWeekdaysLabel(s)}`}
            onClick={()=>setScheduleStepId(s.id)}>
            <CalendarDays size={15}/>

          </button>
          <button type="button" className="editor-step-nest" title={s.parentId ? 'Zmień na osobny krok' : 'Zrób podzadanie poprzedniego kroku'} aria-label={s.parentId ? `Odłącz ${s.title}` : `Zagnieźdź ${s.title}`} onClick={()=>setSteps(arr=>{
            const ordered=orderRoutineSteps(arr);
            if(s.parentId)return unnestRoutineStep(ordered,s.id);
            const index=ordered.findIndex(item=>item.id===s.id);
            const parent=[...ordered.slice(0,index)].reverse().find(item=>!item.parentId);
            return parent?placeRoutineStep(ordered,s.id,parent.id):ordered;
          })}>{s.parentId ? <ArrowLeft size={15}/> : <ArrowRight size={15}/>}</button>
          <button type="button" aria-label="Usuń krok" onClick={()=>{setScheduleStepId(current=>current===s.id?null:current);setSteps(arr=>arr.filter(x=>x.id!==s.id).map(x=>x.parentId===s.id?{...x,parentId:undefined}:x));}}><X size={16}/></button>
        </div>)}
      </div>
      {editorHint && <small className="routine-drag-hint" role="status">{editorHint.label}</small>}
      <button type="button" className="link-btn" onClick={()=>setSteps(arr=>[...arr,{id:crypto.randomUUID(),title:''}])}><Plus size={15}/> Dodaj kolejny krok</button>
    </div>
    <div className="field"><span>XP za całą rutynę</span><XpStepper value={xp} onChange={setXp}/></div></div>
    <div className="modal-bottom routine-editor-footer">
      {routine
        ? <button type="button" className="routine-editor-delete" aria-label="Usuń rutynę" title="Usuń rutynę" onClick={()=>{if(window.confirm('Usunąć rutynę i historię jej wykonań?')) onDelete(routine.id);}}><Trash2 size={18}/><span>Usuń</span></button>
        : <span className="modal-tip routine-editor-tip"><ArrowLeft size={13}/> Możesz edytować rutynę później</span>}
      <button type="button" className="btn btn--ghost routine-editor-cancel" onClick={onClose}>Anuluj</button>
      <button type="button" className="btn btn--primary routine-editor-save" disabled={!title.trim() || !weekdays.length || !steps.some(s=>s.title.trim())} onClick={save}><Check size={16}/> Zapisz rutynę</button>
    </div>
  </div>
    {scheduleStepId && (() => {
      const scheduledStep = steps.find(step => step.id === scheduleStepId);
      if (!scheduledStep) return null;
      return <div className="routine-weekdays-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setScheduleStepId(null);}}>
        <div className="routine-weekdays-dialog" role="dialog" aria-modal="true" aria-label={`Dni wykonywania kroku ${scheduledStep.title}`}>
          <div className="routine-weekdays-heading"><div><span className="eyebrow">HARMONOGRAM KROKU</span><h3>{scheduledStep.title || 'Krok rutyny'}</h3></div>
            <button type="button" className="icon-btn" aria-label="Zamknij wybór dni" onClick={()=>setScheduleStepId(null)}><X size={19}/></button>
          </div>
          <p className="routine-weekdays-description">Wybierz dni tygodnia albo powtarzanie co 2 dni.</p>
          <div className="routine-weekdays-actions">
            <button type="button" className={`btn ${scheduledStep.repeatEveryDays === 2 ? 'btn--primary' : 'btn--secondary'}`}
              onClick={() => setSteps(previous => previous.map(step => step.id === scheduledStep.id
                ? {...step, weekdays: undefined, repeatEveryDays: 2, repeatFrom: step.repeatFrom ?? todayKey()} : step))}>
              Co 2 dni
            </button>
          </div>
          {scheduledStep.repeatEveryDays === 2 && <label className="field">
            <span>Pierwszy dzień cyklu</span>
            <input type="date" value={scheduledStep.repeatFrom ?? todayKey()}
              onChange={event => { const date = event.target.value; if (!date) return;
                setSteps(previous => previous.map(step => step.id === scheduledStep.id ? {...step, repeatFrom: date} : step)); }}/>
          </label>}
          <div className="routine-step-weekdays">
            {WEEK.map((day,weekDay)=><button type="button" key={weekDay}
              className={!scheduledStep.repeatEveryDays && (!scheduledStep.weekdays || scheduledStep.weekdays.includes(weekDay)) ? 'selected' : ''}
              aria-pressed={!scheduledStep.repeatEveryDays && (!scheduledStep.weekdays || scheduledStep.weekdays.includes(weekDay))}
              onClick={()=>toggleStepWeekday(scheduledStep.id,weekDay)}>{day}</button>)}
          </div>
          {scheduledStep.parentId && <small className="routine-step-schedule-info">Ten krok będzie widoczny tylko wtedy, gdy aktywny jest również jego rodzic.</small>}
          <div className="routine-weekdays-actions">
            <button type="button" className="btn btn--ghost" onClick={()=>setSteps(previous=>previous.map(step=>step.id===scheduledStep.id?{...step,weekdays:[],repeatEveryDays:undefined,repeatFrom:undefined}:step))}>Żaden dzień</button>
            <button type="button" className="btn btn--ghost" onClick={()=>setSteps(previous=>previous.map(step=>step.id===scheduledStep.id?{...step,weekdays:undefined,repeatEveryDays:undefined,repeatFrom:undefined}:step))}>Codziennie</button>
            <button type="button" className="btn btn--primary" onClick={()=>setScheduleStepId(null)}><Check size={15}/> Gotowe</button>
          </div>
        </div>
      </div>;
    })()}
</div>;
}

export function emptyLog(id: string): RoutineLog { return { id, checkedStepIds: [], completed: false }; }
export function routineOccurs(routine: Routine, date: string) { return routine.active && routine.weekdays.includes(new Date(`${date}T12:00:00`).getDay()); }
export function isRoutineForToday(routine: Routine) { return routineOccurs(routine, todayKey()); }
