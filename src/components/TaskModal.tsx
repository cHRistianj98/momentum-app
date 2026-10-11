import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Clock3, ImagePlus, Trash2, X } from 'lucide-react';
import { TaskIcon } from '../lib/icons';
import { IconPicker } from './IconPicker';
import { PhotoPicker } from './PhotoPicker';
import { CategoryChoices } from './CategoryChoices';
import { TASK_PRESETS } from '../lib/seed';
import type { CategoryConfig, CategoryKey, Task } from '../types';

interface Props {
  task?: Task;
  initialDate?: string | null;
  initialTime?: string | null;
  categories: CategoryConfig;
  onSave: (task: Task) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const EMPTY: Omit<Task, 'id' | 'createdAt'> = {
  title: '', description: '', category: 'potential', icon: 'target',
  image: undefined, date: null, time: null, duration: 45, done: false, xp: 40,
};

export function TaskModal({ task, initialDate, initialTime, categories, onSave, onDelete, onClose }: Props) {
  const [form, setForm] = useState<Omit<Task, 'id' | 'createdAt'>>(() => task ? { ...task } : { ...EMPTY, date: initialDate ?? null, time: initialTime ?? null });
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
        <div className="modal-heading"><div><span className="eyebrow">TWOJE ZADANIA</span><h2>{task ? 'Edytuj zadanie' : 'Nowe zadanie'} <span className="heading-spark">✦</span></h2></div><button className="icon-btn" onClick={onClose} aria-label="Zamknij"><X size={20} /></button></div>
        {!task && <div className="presets"><span>Dodaj szybko:</span>{TASK_PRESETS.slice(0, 5).map(p => <button key={p.title} onClick={() => setForm(f => ({ ...f, title: p.title, icon: p.icon, category: p.category, duration: p.duration, xp: p.xp }))}><TaskIcon name={p.icon} size={14} />{p.title}</button>)}</div>}
        <div className="modal-fields">
          <label className="field"><span>Nazwa zadania <i>*</i></span><input ref={titleRef} placeholder="Np. 45 minut pracy nad aplikacją" value={form.title} onChange={e => change('title', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} maxLength={90}/></label>
          <label className="field"><span>Opis / notatka</span><textarea placeholder="O czym warto pamiętać?" rows={2} value={form.description} onChange={e => change('description', e.target.value)} /></label>
          <div className="field"><span>Kategoria finansowa</span><CategoryChoices categories={categories} value={form.category} onChange={v=>change('category',v)}/></div>
          <div className="two-fields"><label className="field"><span>Data</span><input type="date" value={form.date ?? ''} onChange={e => { change('date', e.target.value || null); if (!e.target.value) change('time', null); }}/></label><label className="field"><span>Godzina</span><input type="time" disabled={!form.date} value={form.time ?? ''} onChange={e => change('time', e.target.value || null)}/></label></div>
          <div className="two-fields"><label className="field"><span>Czas trwania <Clock3 size={13} /></span><select value={form.duration} onChange={e => change('duration', Number(e.target.value))}>{[15, 30, 45, 60, 75, 90, 120, 150, 180, 240].map(v => <option key={v} value={v}>{v} min</option>)}</select></label><label className="field"><span>Nagroda <span className="xp-text">✦ XP</span></span><input min={0} max={500} type="number" value={form.xp} onChange={e => change('xp', Number(e.target.value))} /></label></div>
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
        <div className="modal-bottom">{task ? <button className="btn btn--danger" onClick={() => { if (window.confirm('Usunąć to zadanie?')) onDelete(task.id); }}><Trash2 size={16} /> Usuń</button> : <span className="modal-tip">Szybkie zadanie może pozostać w Inbox.</span>}<div className="modal-bottom-right"><button className="btn btn--ghost" onClick={onClose}>Anuluj</button><button className="btn btn--primary" disabled={!form.title.trim()} onClick={save}><Check size={16} />{task ? 'Zapisz zmiany' : 'Dodaj zadanie'}</button></div></div>
      </div>
    </div>
  );
}
