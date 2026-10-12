import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Clock3, FolderKanban, ImagePlus, Link2, Plus, Play, Timer, Trash2, X } from 'lucide-react';
import { TaskIcon } from '../lib/icons';
import { CategoryBadge, TaskVisual } from './VisualIdentity';
import { IconPicker } from './IconPicker';
import { DatePicker } from './DatePicker';
import { TimePicker, DurationPicker, XpStepper } from './FormControls';
import { PhotoPicker } from './PhotoPicker';
import { CategoryChoices } from './CategoryChoices';
import { TASK_PRESETS } from '../lib/seed';
import type { CategoryConfig, Project, Task } from '../types';
import { newSubtask } from '../lib/projects';

interface Props {
  task?: Task;
  initialDate?: string | null;
  initialTime?: string | null;
  initialProjectId?: string;
  initialMilestoneId?: string;
  projects: Project[];
  categories: CategoryConfig;
  focusSeconds: number;
  onFocus: (id: string) => void;
  onSave: (task: Task) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const EMPTY: Omit<Task, 'id' | 'createdAt'> = {
  title: '', description: '', category: 'potential', icon: 'target',
  image: undefined, date: null, time: null, duration: 45, done: false, xp: 40,
};

export function TaskModal({ task, initialDate, initialTime, initialProjectId, initialMilestoneId, projects, categories, focusSeconds, onFocus, onSave, onDelete, onClose }: Props) {
  const [form, setForm] = useState<Omit<Task, 'id' | 'createdAt'>>(() => task ? { ...task } : { ...EMPTY, date: initialDate ?? null, time: initialTime ?? null, projectId: initialProjectId ?? null, milestoneId: initialMilestoneId ?? null, subtasks: [] });
  const [subtaskText, setSubtaskText] = useState('');
  const selectedProject = projects.find(project => project.id === form.projectId);
  const [imageError, setImageError] = useState('');
  const [picker, setPicker] = useState<'icons' | 'photos' | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  const change = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(p => ({ ...p, [key]: value }));

  function save() {
    if (!form.title.trim()) { titleRef.current?.focus(); return; }
    onSave({ ...form, title: form.title.trim(), duration: Math.max(15, Number(form.duration)), xp: Math.max(0, Number(form.xp)), id: task?.id ?? crypto.randomUUID(), createdAt: task?.createdAt ?? new Date().toISOString() });
  }

  function onImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setImageError('Wybierz plik graficzny.'); return; }
    if (file.size > 900_000) { setImageError('Zdjęcie powinno mieć mniej niż 900 KB (zapis lokalny).'); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') { change('image', reader.result); setImageError(''); } };
    reader.readAsDataURL(file);
  }

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal task-modal" role="dialog" aria-modal="true" aria-label={task ? 'Edytuj zadanie' : 'Nowe zadanie'}>
        <div className="modal-heading modal-heading--identity"><div className="modal-heading-identity"><TaskVisual icon={form.icon} image={form.image} category={form.category} categories={categories} size="large" className="modal-heading-art"/><div><span className="eyebrow">TWOJE ZADANIA</span><h2>{task ? 'Edytuj zadanie' : 'Nowe zadanie'}</h2><CategoryBadge category={form.category} categories={categories} compact/></div></div><button className="icon-btn" onClick={onClose} aria-label="Zamknij"><X size={20} /></button></div>
        {!task && <div className="presets"><span>Dodaj szybko:</span>{TASK_PRESETS.slice(0, 5).map(p => <button key={p.title} onClick={() => setForm(f => ({ ...f, title: p.title, icon: p.icon, category: p.category, duration: p.duration, xp: p.xp }))}><TaskIcon name={p.icon} size={14} />{p.title}</button>)}</div>}
        <div className="modal-fields">
          <label className="field"><span>Nazwa zadania <i>*</i></span><input ref={titleRef} placeholder="Np. 45 minut pracy nad aplikacją" value={form.title} onChange={e => change('title', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} maxLength={90}/></label>
          <label className="field"><span>Opis / notatka</span><textarea placeholder="O czym warto pamiętać?" rows={2} value={form.description} onChange={e => change('description', e.target.value)} /></label>
          <div className="field"><span>Kategoria finansowa</span><CategoryChoices categories={categories} value={form.category} onChange={v=>change('category',v)}/></div>
          <div className="field"><span><FolderKanban size={14}/> Projekt i kamień milowy</span>
            <div className="two-fields project-task-links">
              <label className="project-select-field"><span>Projekt</span><select value={form.projectId ?? ''} onChange={e=>setForm(current=>({...current,projectId:e.target.value||null,milestoneId:null}))}><option value="">Bez projektu</option>{projects.filter(project=>!project.archived||project.id===form.projectId).map(project=><option key={project.id} value={project.id}>{project.title}</option>)}</select></label>
              <label className="project-select-field"><span>Etap</span><select disabled={!selectedProject} value={form.milestoneId ?? ''} onChange={e=>change('milestoneId',e.target.value||null)}><option value="">Bez kamienia milowego</option>{selectedProject?.milestones.map(milestone=><option value={milestone.id} key={milestone.id}>{milestone.title}</option>)}</select></label>
            </div>
            {selectedProject&&<small className="project-form-hint"><Link2 size={12}/> Ukończenie zadania automatycznie zwiększy postęp projektu.</small>}
          </div>
          <div className="field"><span><Check size={14}/> Podzadania / checklista</span>
            <div className="project-task-subtasks">{(form.subtasks??[]).map(item=><div key={item.id} className="project-task-subtask"><label><input type="checkbox" checked={item.done} onChange={e=>change('subtasks',(form.subtasks??[]).map(value=>value.id===item.id?{...value,done:e.target.checked}:value))}/><span className={item.done?'project-done-text':''}>{item.title}</span></label><button type="button" title="Usuń podzadanie" onClick={()=>change('subtasks',(form.subtasks??[]).filter(value=>value.id!==item.id))}><X size={14}/></button></div>)}</div>
            <form className="project-task-add-subtask" onSubmit={e=>{e.preventDefault();if(!subtaskText.trim())return;change('subtasks',[...(form.subtasks??[]),newSubtask(subtaskText)]);setSubtaskText('');}}><input value={subtaskText} onChange={e=>setSubtaskText(e.target.value)} maxLength={110} placeholder="Np. Napisać testy..."/><button type="submit" disabled={!subtaskText.trim()}><Plus size={15}/> Dodaj</button></form>
          </div>
          <div className="two-fields"><div className="field"><span>Data</span><DatePicker value={form.date} onChange={date => setForm(current => ({ ...current, date, time: date ? current.time : null }))}/></div><div className="field"><span>Godzina</span><TimePicker disabled={!form.date} allowClear value={form.time} onChange={time => change('time', time)}/></div></div>
          <div className="two-fields"><div className="field"><span>Czas trwania <Clock3 size={13} /></span><DurationPicker value={form.duration} onChange={duration => change('duration',duration)}/></div><div className="field"><span>Nagroda <span className="xp-text">✦ XP</span></span><XpStepper value={form.xp} onChange={xp => change('xp',xp)}/></div></div>
          <div className="field">
            <span>Ikona i zdjęcie</span>
            <div className="image-icon-row">
              <button type="button" className="selected-icon" onClick={()=>setPicker(p=>p==='icons'?null:'icons')} aria-expanded={picker==='icons'}><TaskIcon name={form.icon} size={24}/><span>Wybierz ikonę</span></button>
              <button type="button" className="selected-icon" onClick={()=>setPicker(p=>p==='photos'?null:'photos')} aria-expanded={picker==='photos'}><ImagePlus size={24}/><span>100 zdjęć</span></button>
              <label className="image-upload"><Camera size={20}/><span>Własne zdjęcie</span><input type="file" hidden accept="image/*" onChange={e=>onImage(e.target.files?.[0])}/></label>
              {form.image&&<div className="image-thumbnail"><img src={form.image} alt="Wybrana miniatura zadania"/><button type="button" title="Usuń zdjęcie" onClick={()=>change('image',undefined)}><X size={13}/></button></div>}
            </div>
            {imageError&&<small className="field-error"><Camera size={12}/>{imageError}</small>}
            {picker==='icons'&&<IconPicker value={form.icon} onSelect={icon=>{change('icon',icon);setPicker(null);}}/>}
            {picker==='photos'&&<PhotoPicker value={form.image} onSelect={image=>{change('image',image);setPicker(null);}}/>}
          </div>
          <label className="toggle-row"><span className={`toggle ${form.done ? 'on' : ''}`}><input type="checkbox" checked={form.done} onChange={e => change('done', e.target.checked)} /><Check size={13}/></span>Oznacz zadanie jako wykonane</label>
        </div>
        {task && <div className="task-focus-row"><div><Timer size={17}/><span><strong>Focus Mode</strong><small>Realnie przepracowano: {Math.floor(focusSeconds/3600)>0?`${Math.floor(focusSeconds/3600)} h `:''}${Math.floor((focusSeconds%3600)/60)} min</small></span></div><button className="btn btn--focus" type="button" onClick={()=>onFocus(task.id)}><Play size={15} fill="currentColor"/> Rozpocznij Focus</button></div>}
        <div className="modal-bottom">{task ? <button className="btn btn--danger" onClick={() => { if (window.confirm('Usunąć to zadanie?')) onDelete(task.id); }}><Trash2 size={16} /> Usuń</button> : <span className="modal-tip">Szybkie zadanie może pozostać w Inbox.</span>}<div className="modal-bottom-right"><button className="btn btn--ghost" onClick={onClose}>Anuluj</button><button className="btn btn--primary" disabled={!form.title.trim()} onClick={save}><Check size={16} />{task ? 'Zapisz zmiany' : 'Dodaj zadanie'}</button></div></div>
      </div>
    </div>
  );
}
