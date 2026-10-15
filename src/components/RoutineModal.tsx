import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check, CheckCircle2, Clock3, Flame, GripVertical, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { TaskIcon } from '../lib/icons';
import { CategoryBadge, TaskVisual } from './VisualIdentity';
import { IconPicker } from './IconPicker';
import { PhotoPicker } from './PhotoPicker';
import { TimePicker, DurationPicker, XpStepper } from './FormControls';
import { CategoryChoices } from './CategoryChoices';
import { formatDuration, fullDate, todayKey } from '../lib/date';
import { orderRoutineSteps, placeRoutineStep, unnestRoutineStep } from '../lib/routineHierarchy';
import { useRoutineStepDrag } from '../lib/useRoutineStepDrag';
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
  onChangeSteps: (steps: RoutineStep[]) => void;
  onComplete: () => void;
  onUndo: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function RoutineSession({ routine, date, log, duration, displayTime, categoryColor, categories, onToggleStep, onChangeSteps, onComplete, onUndo, onEdit, onDelete, onClose }: SessionProps) {
  const visibleSteps = orderRoutineSteps(routine.steps);
  const { listRef, hint, suppressClickRef } = useRoutineStepDrag(visibleSteps, onChangeSteps, false, !log.completed);
  const completed = routine.steps.filter(step => log.checkedStepIds.includes(step.id)).length;
  const count = routine.steps.length;
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal routine-modal" role="dialog" aria-modal="true" aria-label="Rutyna">
    <div className="modal-heading modal-heading--identity"><div className="modal-heading-identity"><TaskVisual icon={routine.icon} image={routine.image} category={routine.category} categories={categories} size="large" className="modal-heading-art"/><div><span className="eyebrow">TWOJA RUTYNA · {fullDate(date)}</span><h2>{routine.title}</h2><CategoryBadge category={routine.category} categories={categories} compact/></div></div><button className="icon-btn" onClick={onClose} aria-label="Zamknij"><X size={20} /></button></div>
    <div className="routine-banner" style={{ '--routine-color': categoryColor } as React.CSSProperties}><TaskVisual icon={routine.icon} image={routine.image} category={routine.category} categories={categories} size="large" className="routine-banner-icon"/><div><strong>{routine.description || 'Małe kroki, wielki progres.'}</strong><span><Clock3 size={14} /> {displayTime} · {formatDuration(duration)} <span className="dot-spacer">·</span> <Flame size={14} /> +{routine.xp} XP</span></div></div>
    <div className="routine-progress-heading"><strong>Twoje kroki</strong><span>{completed}/{count} wykonane</span></div><div className="progress-track"><div style={{ width: `${count ? completed/count*100 : 0}%` }} /></div>
    <div className="routine-gesture-note">Przytrzymaj krok i przesuń go w prawo pod inny, aby utworzyć podzadanie. W lewo — aby odłączyć.</div>
    <div className="routine-checklist" ref={listRef} onClickCapture={e => { if (suppressClickRef.current) { e.preventDefault(); e.stopPropagation(); suppressClickRef.current = false; } }}>
      {visibleSteps.map((step, i) => <button key={step.id} type="button" data-routine-step-id={step.id}
        className={`routine-step ${step.parentId ? 'routine-step--child' : ''} ${log.checkedStepIds.includes(step.id) ? 'checked' : ''} ${hint?.id === step.id ? 'routine-step--dragging' : ''} ${hint?.parentId === step.id ? 'routine-step--drop-parent' : ''}`}
        disabled={log.completed} onClick={() => onToggleStep(step.id)}>
        <span className="step-counter">{log.checkedStepIds.includes(step.id) ? <Check size={17} strokeWidth={3} /> : step.parentId ? '↳' : String(i + 1).padStart(2, '0')}</span>
        <span className="routine-step-title">{step.title}</span>
        <CheckCircle2 className="step-right" size={18}/>
      </button>)}
    </div>
    {hint && <div className="routine-drag-hint" role="status">{hint.label}</div>}
    {log.completed && <div className="completion-message"><span>✦</span><div><strong>Rutyna ukończona!</strong><small>Świetna robota. +{routine.xp} XP zostało uwzględnione w Twoim progresie.</small></div></div>}
    <div className="modal-bottom routine-session-actions"><div className="routine-session-manage"><button className="btn btn--ghost" onClick={onEdit}>Edytuj szablon</button><button type="button" className="btn btn--danger routine-session-delete" onClick={()=>{if(window.confirm(`Usunąć rutynę „${routine.title}” wraz z całą historią wykonań? Tej operacji nie można cofnąć.`))onDelete();}}><Trash2 size={15}/> Usuń rutynę</button></div><div className="modal-bottom-right">{log.completed ? <button className="btn btn--secondary" onClick={onUndo}><RotateCcw size={15}/> Cofnij</button> : <button disabled={count === 0 || completed !== count} className="btn btn--primary" onClick={onComplete}><Check size={16}/> Zakończ rutynę · +{routine.xp} XP</button>}</div></div>
  </div></div>;
}

interface EditorProps {
  routine?: Routine;
  categories: CategoryConfig;
  onSave: (routine: Routine) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}
const WEEK = ['N', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];

export function RoutineEditor({ routine, categories, onSave, onDelete, onClose }: EditorProps) {
  const [title, setTitle] = useState(routine?.title ?? '');
  const [description, setDescription] = useState(routine?.description ?? '');
  const [icon, setIcon] = useState<IconKey>(routine?.icon ?? 'sun');
  const [category, setCategory] = useState<CategoryKey>(routine?.category ?? 'unpaid');
  const [image, setImage] = useState<string | undefined>(routine?.image);
  const [time, setTime] = useState(routine?.time ?? '07:00');
  const [duration, setDuration] = useState(routine?.duration ?? 30);
  const [xp, setXp] = useState(routine?.xp ?? 40);
  const [weekdays, setWeekdays] = useState(routine?.weekdays ?? [0,1,2,3,4,5,6]);
  const [steps, setSteps] = useState<RoutineStep[]>(routine?.steps ?? [{ id: crypto.randomUUID(), title: '' }]);
  const [picker, setPicker] = useState<'icons' | 'photos' | null>(null);
  const { listRef: stepsRef, hint: editorHint } = useRoutineStepDrag(steps, setSteps, true);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  function save() {
    const validSteps = orderRoutineSteps(steps.filter(s => s.title.trim()).map(s => ({ ...s, title: s.title.trim() })));
    if (!title.trim() || !validSteps.length || !weekdays.length) return;
    onSave({ id: routine?.id ?? crypto.randomUUID(), title: title.trim(), description: description.trim(), icon, image, category, time, duration, xp, weekdays, steps: validSteps, active: routine?.active ?? true });
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
    <div className="field"><span>Powtarzaj w dni</span><div className="weekday-picker">{WEEK.map((w,i)=><button key={i} className={weekdays.includes(i) ? 'selected' : ''} onClick={()=>setWeekdays(arr=>arr.includes(i) ? arr.filter(x=>x!==i) : [...arr,i].sort())}>{w}</button>)}</div></div>
    <div className="field"><span>Lista kroków</span>
      <small className="routine-gesture-note">Przytrzymaj uchwyt ⋮⋮ i przeciągnij krok w prawo pod wybranego rodzica. W lewo — odłącz.</small>
      <div className="editor-steps" ref={stepsRef}>
        {orderRoutineSteps(steps).map((s,i)=><div className={`editor-step ${s.parentId ? 'editor-step--child' : ''} ${editorHint?.id === s.id ? 'routine-step--dragging' : ''} ${editorHint?.parentId === s.id ? 'routine-step--drop-parent' : ''}`} data-routine-step-id={s.id} key={s.id}>
          <span className="editor-step-drag" data-step-drag-handle title="Przytrzymaj i przesuń krok" aria-label={`Przenieś krok ${s.title}`}><GripVertical size={18}/></span>
          <input value={s.title} placeholder={`Krok ${i+1}`} onChange={e=>setSteps(arr=>arr.map(x=>x.id===s.id ? {...x,title:e.target.value} : x))}/>
          <button type="button" className="editor-step-nest" title={s.parentId ? 'Zmień na osobny krok' : 'Zrób podzadanie poprzedniego kroku'} aria-label={s.parentId ? `Odłącz ${s.title}` : `Zagnieźdź ${s.title}`} onClick={()=>setSteps(arr=>{
            const ordered=orderRoutineSteps(arr);
            if(s.parentId)return unnestRoutineStep(ordered,s.id);
            const index=ordered.findIndex(item=>item.id===s.id);
            const parent=[...ordered.slice(0,index)].reverse().find(item=>!item.parentId);
            return parent?placeRoutineStep(ordered,s.id,parent.id):ordered;
          })}>{s.parentId ? <ArrowLeft size={15}/> : <ArrowRight size={15}/>}</button>
          <button type="button" aria-label="Usuń krok" onClick={()=>setSteps(arr=>arr.filter(x=>x.id!==s.id).map(x=>x.parentId===s.id?{...x,parentId:undefined}:x))}><X size={16}/></button>
        </div>)}
      </div>
      {editorHint && <small className="routine-drag-hint" role="status">{editorHint.label}</small>}
      <button type="button" className="link-btn" onClick={()=>setSteps(arr=>[...arr,{id:crypto.randomUUID(),title:''}])}><Plus size={15}/> Dodaj kolejny krok</button>
    </div>
    <div className="field"><span>XP za całą rutynę</span><XpStepper value={xp} onChange={setXp}/></div></div>
    <div className="modal-bottom">{routine ? <button className="btn btn--danger" onClick={()=>{if(window.confirm('Usunąć rutynę i historię jej wykonań?')) onDelete(routine.id);}}><Trash2 size={15}/> Usuń</button> : <span className="modal-tip"><ArrowLeft size={13}/> Możesz edytować rutynę później</span>}<div className="modal-bottom-right"><button className="btn btn--ghost" onClick={onClose}>Anuluj</button><button className="btn btn--primary" disabled={!title.trim() || !weekdays.length || !steps.some(s=>s.title.trim())} onClick={save}><Check size={16}/> Zapisz rutynę</button></div></div>
  </div></div>;
}

export function emptyLog(id: string): RoutineLog { return { id, checkedStepIds: [], completed: false }; }
export function routineOccurs(routine: Routine, date: string) { return routine.active && routine.weekdays.includes(new Date(`${date}T12:00:00`).getDay()); }
export function isRoutineForToday(routine: Routine) { return routineOccurs(routine, todayKey()); }
