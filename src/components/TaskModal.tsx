import { useEffect, useRef, useState } from 'react';
import { CalendarClock, CalendarX2, Camera, Check, CheckCircle2, ChevronDown, Clock3, Flag, FolderKanban, ImagePlus, Link2, Plus, Play, Repeat2, RotateCcw, Timer, Trash2, X } from 'lucide-react';
import { TaskIcon } from '../lib/icons';
import { CategoryBadge, TaskVisual } from './VisualIdentity';
import { IconPicker } from './IconPicker';
import { DatePicker } from './DatePicker';
import { TimePicker, DurationPicker, XpPreview } from './FormControls';
import { PhotoPicker } from './PhotoPicker';
import { PHOTO_OPTIONS } from '../lib/photos';
import { CategoryChoices } from './CategoryChoices';
import { ReminderPicker } from './ReminderPicker';
import { MoveOccurrenceModal, OccurrenceBar, SkippedOccurrenceBar, SkippedOccurrences } from './MoveOccurrenceModal';
import { TASK_PRESETS } from '../lib/seed';
import { ALL_WEEKDAYS, WEEKDAYS_FROM_MONDAY, describeRepeat, shortDayLabel } from '../lib/recurrence';
import { fullDate, parseDate, shiftDate, todayKey, weekdayLongLabels, weekdayShortLabels } from '../lib/date';
import { locale, tr } from '../lib/i18n';
import { XP_RULES, taskXp } from '../lib/xp';
import type { CategoryConfig, Project, RepeatUnit, Routine, Task } from '../types';
import { newSubtask } from '../lib/projects';

/** Wystąpienie zadania cyklicznego, z którego otwarto okno (kalendarz, lista na dziś, powiadomienie). */
export interface SeriesOccurrence {
  /** Dzień z harmonogramu — klucz logu. */
  sourceDate: string;
  /** Rzeczywisty termin, także po ręcznym przeniesieniu. */
  date: string;
  time: string;
  done: boolean;
  /** Wystąpienie usunięte z planu (okno otwarte np. ze starego powiadomienia). */
  skipped?: boolean;
}

export interface SeriesSaveOptions {
  /** Zwykłe zadanie zamienione na cykliczne — usuwamy je z listy zadań. */
  replaceTaskId?: string;
  /** Zmiana statusu jednego wystąpienia. */
  setDone?: { sourceDate: string; done: boolean };
}

interface Props {
  task?: Task;
  /** Edycja istniejącego zadania cyklicznego (w danych: rutyna bez kroków). */
  series?: Routine;
  occurrence?: SeriesOccurrence;
  /** Najbliższe niewykonane wystąpienie — od niego „Zakończ serię” w widoku całej serii. */
  nextSourceDate?: string;
  initialDate?: string | null;
  initialTime?: string | null;
  initialDuration?: number;
  initialProjectId?: string;
  initialMilestoneId?: string;
  projects: Project[];
  categories: CategoryConfig;
  focusSeconds: number;
  /** Przypomnienia proponowane dla nowego zadania (z ustawień powiadomień). */
  defaultReminders?: number[];
  notificationsEnabled?: boolean;
  onEnableNotifications?: () => void;
  onFocus: (id: string) => void;
  onSave: (task: Task) => void;
  onDelete: (id: string) => void;
  onSaveSeries: (routine: Routine, options: SeriesSaveOptions) => void;
  onSkipOccurrence: (routineId: string, sourceDate: string) => void;
  onEndSeries: (routineId: string, fromSourceDate: string) => void;
  onDeleteSeries: (routineId: string) => void;
  /** Przeniesienie zwykłego zadania na inny dzień (zapisuje się od razu). */
  onMoveTask?: (taskId: string, date: string, time: string | null) => void;
  /** Przeniesienie tylko tego wystąpienia zadania cyklicznego. */
  onMoveOccurrence?: (sourceDate: string, date: string, time: string) => void;
  /** Godziny innych wystąpień tej serii w wybranym dniu — ostrzeżenie przy przenoszeniu. */
  otherTimesOn?: (date: string) => string[];
  /** Usunięte pojedyncze wystąpienia serii od dziś — do przywrócenia. */
  skippedDates?: string[];
  onRestoreOccurrence?: (sourceDate: string) => void;
  onClose: () => void;
}

const EMPTY: Omit<Task, 'id' | 'createdAt'> = {
  title: '', description: '', category: 'potential', icon: 'target',
  image: undefined, date: null, time: null, duration: 45, done: false, xp: 0,
};

type RepeatMode = 'none' | RepeatUnit;
const repeatPresets = (): { id: string; label: string; every: RepeatMode; interval: number }[] => [
  { id: 'none', label: tr('Jednorazowo', 'One-time'), every: 'none', interval: 1 },
  { id: 'day', label: tr('Codziennie', 'Every day'), every: 'day', interval: 1 },
  { id: 'week', label: tr('Co tydzień', 'Every week'), every: 'week', interval: 1 },
  { id: 'week2', label: tr('Co 2 tygodnie', 'Every 2 weeks'), every: 'week', interval: 2 },
  { id: 'month', label: tr('Co miesiąc', 'Every month'), every: 'month', interval: 1 },
];
const weekdayOf = (date: string) => parseDate(date).getDay();
/** Domyślna godzina nowej serii: najbliższa pełna godzina. */
function nextFullHour(): string {
  return `${String(Math.min(23, new Date().getHours() + 1)).padStart(2, '0')}:00`;
}
/** „od dziś”, „od jutra”, „od pt, 13 lis”. */
function sinceLabel(date: string, today: string): string {
  if (date === today) return tr('od dziś', 'starting today');
  if (date === shiftDate(today, 1)) return tr('od jutra', 'starting tomorrow');
  const day = shortDayLabel(date, today);
  return tr(`od ${day}`, `starting ${day}`);
}

type PickerOption = { value: string; label: string };

function ProjectPicker({ label, value, options, disabled = false, onChange }: {
  label: string;
  value: string;
  options: PickerOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find(option => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={`project-select-field momentum-project-picker ${open ? 'is-open' : ''}`} ref={rootRef}>
      <span className="momentum-project-picker-label">{label}</span>
      <button type="button" className="momentum-project-picker-trigger" disabled={disabled}
        aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen(current => !current)}>
        <span className="momentum-project-picker-current">{selected?.label ?? tr('Wybierz', 'Choose')}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && <div className="momentum-project-picker-list" role="listbox" aria-label={label}>
        {options.map(option => (
          <button type="button" key={option.value || '__none'} role="option"
            aria-selected={option.value === value}
            className={`momentum-project-picker-option ${option.value === value ? 'is-selected' : ''}`}
            onClick={() => { onChange(option.value); setOpen(false); }}>
            <span>{option.label}</span>
            {option.value === value && <Check size={16} aria-hidden="true" />}
          </button>
        ))}
      </div>}
    </div>
  );
}

export function TaskModal({ task, series, occurrence, nextSourceDate, initialDate, initialTime, initialDuration, initialProjectId, initialMilestoneId, projects, categories, focusSeconds, defaultReminders = [], notificationsEnabled = false, onEnableNotifications, onFocus, onSave, onDelete, onSaveSeries, onSkipOccurrence, onEndSeries, onDeleteSeries, onMoveTask, onMoveOccurrence, otherTimesOn, skippedDates = [], onRestoreOccurrence, onClose }: Props) {
  const today = todayKey();
  const [moving, setMoving] = useState(false);
  const [form, setForm] = useState<Omit<Task, 'id' | 'createdAt'>>(() => series
    ? { title: series.title, description: series.description, category: series.category, icon: series.icon, image: series.image,
      date: series.repeat?.start ?? occurrence?.sourceDate ?? today, time: series.time, duration: series.duration, done: occurrence?.done ?? false,
      xp: series.xp, reminders: [...(series.reminders ?? [])], projectId: null, milestoneId: null, subtasks: [] }
    : task ? { ...task } : { ...EMPTY, date: initialDate ?? null, time: initialTime ?? null, duration: initialDuration ?? EMPTY.duration, projectId: initialProjectId ?? null, milestoneId: initialMilestoneId ?? null, subtasks: [], reminders: [...defaultReminders] });
  // Powtarzanie: „none” = zwykłe zadanie. Seria zapisuje się jako rutyna bez kroków (kind: 'task').
  const [repeat, setRepeat] = useState<{ every: RepeatMode; interval: number }>(() => series
    ? { every: series.repeat?.every ?? 'week', interval: series.repeat?.interval ?? 1 }
    : { every: 'none', interval: 1 });
  const [weekdays, setWeekdays] = useState<number[]>(() => series?.weekdays.length ? [...series.weekdays] : []);
  const [until, setUntil] = useState<string | undefined>(series?.repeat?.until);
  const [deleteMenu, setDeleteMenu] = useState(false);
  const deleteRef = useRef<HTMLDivElement>(null);
  const recurring = repeat.every !== 'none';
  const [subtaskText, setSubtaskText] = useState('');
  const selectedProject = projects.find(project => project.id === form.projectId);
  const [imageError, setImageError] = useState('');
  const [picker, setPicker] = useState<'icons' | 'photos' | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  // Menu usuwania serii zamykamy dotknięciem obok albo klawiszem Escape.
  useEffect(() => {
    if (!deleteMenu) return;
    const dismiss = (event: PointerEvent) => { if (!deleteRef.current?.contains(event.target as Node)) setDeleteMenu(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setDeleteMenu(false); } };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', onKey); };
  }, [deleteMenu]);
  const change = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(p => ({ ...p, [key]: value }));
  const start = form.date ?? initialDate ?? today;
  const seriesWeekdays = repeat.every === 'week' ? weekdays : repeat.every === 'day' ? ALL_WEEKDAYS : [weekdayOf(start)];
  const repeatSummary = repeat.every !== 'none'
    ? `${describeRepeat({ weekdays: seriesWeekdays, repeat: { every: repeat.every, interval: repeat.interval, start } })} · ${form.time ?? '—'} · ${sinceLabel(start, today)}`
    : '';
  const movedOccurrence = Boolean(occurrence && series && (occurrence.date !== occurrence.sourceDate || occurrence.time !== series.time));
  const endFrom = occurrence?.sourceDate ?? nextSourceDate;
  // Tylko ten jeden termin; ukończone wystąpienie ma już XP w historii, więc pytamy o potwierdzenie.
  function skipThisOccurrence() {
    if (!series || !occurrence) return;
    if (occurrence.done && !window.confirm(tr(`To wystąpienie „${series.title}” jest już ukończone. Usunąć je razem z XP za ten dzień?`, `This occurrence of “${series.title}” is already completed. Delete it along with the XP for that day?`))) return;
    onSkipOccurrence(series.id, occurrence.sourceDate);
  }

  function chooseRepeat(every: RepeatMode, interval: number) {
    setRepeat({ every, interval });
    if (every === 'none') return;
    // Seria potrzebuje dnia startu i godziny — uzupełniamy je, jeśli jeszcze ich nie ma.
    setForm(current => ({ ...current, date: current.date ?? initialDate ?? today, time: current.time ?? nextFullHour() }));
    if (every === 'week') setWeekdays(current => current.length ? current : [weekdayOf(start)]);
  }
  function changeDate(date: string | null) {
    if (recurring && !date) return;
    // Domyślny dzień tygodnia podąża za datą startu, dopóki użytkownik go nie zmienił.
    if (recurring && date && form.date && weekdays.length === 1 && weekdays[0] === weekdayOf(form.date)) setWeekdays([weekdayOf(date)]);
    setForm(current => ({ ...current, date, time: date ? current.time : null }));
  }
  function toggleWeekday(day: number) {
    setWeekdays(current => current.includes(day)
      ? (current.length > 1 ? current.filter(item => item !== day) : current)
      : [...current, day].sort((a, b) => a - b));
  }

  function save(doneOverride?: boolean) {
    if (!form.title.trim()) { titleRef.current?.focus(); return; }
    const reminders = form.reminders?.length ? [...form.reminders] : undefined;
    const done = doneOverride ?? form.done;
    if (repeat.every === 'none') {
      onSave({ ...form, reminders, done, title: form.title.trim(), duration: Math.max(15, Number(form.duration)), xp: taskXp(Math.max(15, Number(form.duration)), form.category), id: task?.id ?? crypto.randomUUID(), createdAt: task?.createdAt ?? new Date().toISOString() });
      return;
    }
    const routine: Routine = {
      ...series,
      id: series?.id ?? crypto.randomUUID(),
      kind: 'task',
      title: form.title.trim(),
      description: form.description.trim(),
      icon: form.icon,
      image: form.image,
      category: form.category,
      time: form.time ?? nextFullHour(),
      duration: Math.max(15, Number(form.duration)),
      xp: taskXp(Math.max(15, Number(form.duration)), form.category),
      weekdays: seriesWeekdays,
      steps: series?.steps ?? [],
      active: series?.active ?? true,
      repeat: { every: repeat.every, interval: repeat.interval, start, ...(until ? { until } : {}) },
    };
    if (reminders) routine.reminders = reminders;
    else delete routine.reminders;
    const options: SeriesSaveOptions = {};
    if (task) {
      options.replaceTaskId = task.id;
      // Ukończone zadanie zamienione na serię zachowuje XP jako ukończone wystąpienie.
      if (done) options.setDone = { sourceDate: task.date ?? start, done: true };
    } else if (occurrence && done !== occurrence.done) {
      options.setDone = { sourceDate: occurrence.sourceDate, done };
    }
    onSaveSeries(routine, options);
  }

  function onImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setImageError(tr('Wybierz plik graficzny.', 'Choose an image file.')); return; }
    if (file.size > 900_000) { setImageError(tr('Zdjęcie powinno mieć mniej niż 900 KB (zapis lokalny).', 'The photo should be smaller than 900 KB (it’s stored locally).')); return; }
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') { change('image', reader.result); setImageError(''); } };
    reader.readAsDataURL(file);
  }

  const heading = series ? tr('Zadanie cykliczne', 'Recurring task') : task ? (recurring ? tr('Zamień na cykliczne', 'Make recurring') : tr('Edytuj zadanie', 'Edit task')) : recurring ? tr('Nowe zadanie cykliczne', 'New recurring task') : tr('Nowe zadanie', 'New task');
  const hideTaskOnlyFields = recurring;
  const lostTaskLinks = Boolean(task && recurring && (task.projectId || task.subtasks?.length));
  const dayChips = weekdayShortLabels();
  const dayNames = weekdayLongLabels();

  return (
    <div className="modal-backdrop task-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal task-modal" role="dialog" aria-modal="true" aria-label={heading}>
        <div className="task-modal-scroll">
        <div className="modal-heading modal-heading--identity"><div className="modal-heading-identity"><TaskVisual icon={form.icon} image={form.image} category={form.category} categories={categories} size="large" className="modal-heading-art"/><div><span className="eyebrow">{series ? <><Repeat2 size={12}/> {occurrence ? fullDate(occurrence.date).toLocaleUpperCase(locale()) : tr('CAŁA SERIA', 'WHOLE SERIES')}</> : tr('TWOJE ZADANIA', 'YOUR TASKS')}</span><h2>{heading}</h2><CategoryBadge category={form.category} categories={categories} compact/></div></div><button className="icon-btn" onClick={onClose} aria-label={tr('Zamknij', 'Close')}><X size={20} /></button></div>
        {!task && !series && <div className="presets"><span>{tr('Dodaj szybko:', 'Quick add:')}</span>{TASK_PRESETS.slice(0, 5).map(p => <button key={p.title} onClick={() => setForm(f => ({ ...f, title: p.title, icon: p.icon, category: p.category, duration: p.duration }))}><TaskIcon name={p.icon} size={14} />{p.title}</button>)}</div>}
        <div className="modal-fields">
          {series && occurrence?.skipped && onRestoreOccurrence && <SkippedOccurrenceBar date={occurrence.date} hint={tr('Pola poniżej zmieniają całą serię.', 'The fields below change the whole series.')} onRestore={() => onRestoreOccurrence(occurrence.sourceDate)}/>}
          {series && occurrence && !occurrence.skipped && onMoveOccurrence && <OccurrenceBar label={tr('To wystąpienie', 'This occurrence')} date={occurrence.date} time={occurrence.time}
            movedFrom={movedOccurrence ? { date: occurrence.sourceDate, time: series.time } : null} note={tr('Pola poniżej zmieniają całą serię.', 'The fields below change the whole series.')} onMove={() => setMoving(true)} onDelete={skipThisOccurrence}/>}
          {task && !recurring && form.date && onMoveTask && <OccurrenceBar label={tr('Termin', 'Scheduled for')} date={form.date} time={form.time} onMove={() => setMoving(true)}/>}
          <label className="field"><span>{tr('Nazwa zadania', 'Task name')} <i>*</i></span><input ref={titleRef} placeholder={tr('Np. 45 minut pracy nad aplikacją', 'E.g. 45 minutes of work on the app')} value={form.title} onChange={e => change('title', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} maxLength={90}/></label>
          <label className="field"><span>{tr('Opis / notatka', 'Description / note')}</span><textarea placeholder={tr('O czym warto pamiętać?', 'Anything worth remembering?')} rows={2} value={form.description} onChange={e => change('description', e.target.value)} /></label>
          <div className="field"><span>{tr('Kategoria finansowa', 'Financial category')}</span><CategoryChoices categories={categories} value={form.category} onChange={v=>change('category',v)}/></div>
          {!hideTaskOnlyFields && <div className="field"><span><FolderKanban size={14}/> {tr('Projekt i kamień milowy', 'Project & milestone')}</span>
            <div className="two-fields project-task-links">
              <ProjectPicker label={tr('Projekt', 'Project')} value={form.projectId ?? ''}
                options={[{ value: '', label: tr('Bez projektu', 'No project') }, ...projects.filter(project => !project.archived || project.id === form.projectId).map(project => ({ value: project.id, label: project.title }))]}
                onChange={projectId => setForm(current => ({ ...current, projectId: projectId || null, milestoneId: null }))} />
              <ProjectPicker label={tr('Etap', 'Milestone')} disabled={!selectedProject} value={form.milestoneId ?? ''}
                options={[{ value: '', label: tr('Bez kamienia milowego', 'No milestone') }, ...(selectedProject?.milestones ?? []).map(milestone => ({ value: milestone.id, label: milestone.title }))]}
                onChange={milestoneId => change('milestoneId', milestoneId || null)} />
            </div>
            {selectedProject&&<small className="project-form-hint"><Link2 size={12}/> {tr('Ukończenie zadania automatycznie zwiększy postęp projektu.', 'Completing this task will automatically increase the project’s progress.')}</small>}
          </div>}
          {!hideTaskOnlyFields && <div className="field"><span><Check size={14}/> {tr('Podzadania / checklista', 'Subtasks / checklist')}</span>
            <div className="project-task-subtasks">{(form.subtasks??[]).map(item=><div key={item.id} className="project-task-subtask"><label><input type="checkbox" checked={item.done} onChange={e=>change('subtasks',(form.subtasks??[]).map(value=>value.id===item.id?{...value,done:e.target.checked}:value))}/><span className={item.done?'project-done-text':''}>{item.title}</span></label><button type="button" title={tr('Usuń podzadanie', 'Delete subtask')} onClick={()=>change('subtasks',(form.subtasks??[]).filter(value=>value.id!==item.id))}><X size={14}/></button></div>)}</div>
            <form className="project-task-add-subtask" onSubmit={e=>{e.preventDefault();if(!subtaskText.trim())return;change('subtasks',[...(form.subtasks??[]),newSubtask(subtaskText)]);setSubtaskText('');}}><input value={subtaskText} onChange={e=>setSubtaskText(e.target.value)} maxLength={110} placeholder={tr('Np. Napisać testy...', 'E.g. Write tests...')}/><button type="submit" disabled={!subtaskText.trim()}><Plus size={15}/> {tr('Dodaj', 'Add')}</button></form>
          </div>}
          <div className="two-fields"><div className="field"><span>{recurring ? tr('Od dnia', 'Start date') : tr('Data', 'Date')}</span><DatePicker value={form.date} onChange={changeDate}/></div><div className="field"><span>{tr('Godzina', 'Time')}</span><TimePicker disabled={!form.date} allowClear={!recurring} value={form.time} onChange={time => change('time', recurring ? time ?? form.time : time)}/></div></div>
          <div className="field repeat-field">
            <span><Repeat2 size={14}/> {tr('Powtarzanie', 'Repeat')}</span>
            <div className="repeat-options" role="radiogroup" aria-label={tr('Powtarzanie', 'Repeat')}>
              {repeatPresets().filter(preset => !(series && preset.every === 'none')).map(preset => {
                const active = repeat.every === preset.every && (preset.every === 'none' || repeat.interval === preset.interval);
                return <button type="button" key={preset.id} role="radio" aria-checked={active} className={active ? 'is-active' : ''} onClick={() => chooseRepeat(preset.every, preset.interval)}>{preset.label}</button>;
              })}
            </div>
            {repeat.every === 'week' && <div className="repeat-weekdays" role="group" aria-label={tr('Dni tygodnia', 'Days of the week')}>
              {WEEKDAYS_FROM_MONDAY.map(day => <button type="button" key={day} className={weekdays.includes(day) ? 'is-active' : ''} aria-pressed={weekdays.includes(day)} aria-label={dayNames[day]} onClick={() => toggleWeekday(day)}>{dayChips[day]}</button>)}
            </div>}
            {recurring
              ? <small className="repeat-summary"><Repeat2 size={13}/> {repeatSummary}</small>
              : <small className="repeat-hint">{tr('Np. siłownia w pn, śr i pt — jak zwykłe zadanie, tylko powtarzane. Bez listy kroków.', 'E.g. the gym on Mon, Wed and Fri — just like a regular task, only repeated. No list of steps.')}</small>}
            {recurring && until && <small className="repeat-note repeat-note--ended"><Flag size={13}/> <span>{tr(`Seria zakończona — ostatnie wystąpienie ${shortDayLabel(until, today)}.`, `Series ended — last occurrence: ${shortDayLabel(until, today)}.`)}</span> <button type="button" onClick={() => setUntil(undefined)}>{tr('Wznów serię', 'Resume series')}</button></small>}
            {series && recurring && onRestoreOccurrence && <SkippedOccurrences dates={skippedDates} onRestore={onRestoreOccurrence}/>}
            {movedOccurrence && occurrence && !onMoveOccurrence && <small className="repeat-note"><CalendarClock size={13}/> <span>{tr(`To wystąpienie przeniesiono na ${fullDate(occurrence.date)}, ${occurrence.time}. Zmiany godziny poniżej dotyczą całej serii.`, `This occurrence was moved to ${fullDate(occurrence.date)}, ${occurrence.time}. Time changes below apply to the whole series.`)}</span></small>}
            {lostTaskLinks && <small className="repeat-note"><FolderKanban size={13}/> <span>{tr('Zadanie cykliczne nie ma podzadań ani projektu — zostaną pominięte.', 'A recurring task has no subtasks or project — they will be dropped.')}</span></small>}
          </div>
          <ReminderPicker value={form.reminders ?? []} onChange={reminders => change('reminders', reminders)} time={form.time}
            inactiveHint={!recurring && (!form.date || !form.time) ? tr('Przypomnienia zaczną działać po ustawieniu daty i godziny.', 'Reminders will start working once you set a date and time.') : undefined}
            systemEnabled={notificationsEnabled} onEnableSystem={onEnableNotifications}/>
          <div className="two-fields"><div className="field"><span>{tr('Czas trwania', 'Duration')} <Clock3 size={13} /></span><DurationPicker value={form.duration} onChange={duration => change('duration',duration)}/></div><div className="field"><span>{tr('Nagroda', 'Reward')} <span className="xp-text">✦ XP</span></span><XpPreview xp={taskXp(form.duration, form.category)} label={tr('XP za ukończenie', 'XP for completion')}
            hint={tr(`Liczone automatycznie: ${String(XP_RULES.taskPer15[form.category]).replace('.', ',')} XP za każde 15 min (${categories[form.category]?.label ?? 'kategoria'}) + ${XP_RULES.completion} za ukończenie; czas ponad 2 h liczy się w połowie. Focus Mode doda premię za realny czas pracy.`,
              `Calculated automatically: ${XP_RULES.taskPer15[form.category]} XP for every 15 min (${categories[form.category]?.label ?? 'category'}) + ${XP_RULES.completion} for completion; time over 2 h counts at half rate. Focus Mode adds a bonus for actual work time.`)}/></div></div>
          <div className="field">
            <span>{tr('Ikona i zdjęcie', 'Icon & photo')}</span>
            <div className="image-icon-row">
              <button type="button" className="selected-icon" onClick={()=>setPicker(p=>p==='icons'?null:'icons')} aria-expanded={picker==='icons'}><TaskIcon name={form.icon} size={24}/><span>{tr('Wybierz ikonę', 'Choose icon')}</span></button>
              <button type="button" className="selected-icon" onClick={()=>setPicker(p=>p==='photos'?null:'photos')} aria-expanded={picker==='photos'}><ImagePlus size={24}/><span>{tr(`${PHOTO_OPTIONS.length} zdjęć`, `${PHOTO_OPTIONS.length} photos`)}</span></button>
              <label className="image-upload"><Camera size={20}/><span>{tr('Własne zdjęcie', 'Your own photo')}</span><input type="file" hidden accept="image/*" onChange={e=>onImage(e.target.files?.[0])}/></label>
              {form.image&&<div className="image-thumbnail"><img src={form.image} alt={tr('Wybrana miniatura zadania', 'Selected task thumbnail')}/><button type="button" title={tr('Usuń zdjęcie', 'Remove photo')} onClick={()=>change('image',undefined)}><X size={13}/></button></div>}
            </div>
            {imageError&&<small className="field-error"><Camera size={12}/>{imageError}</small>}
            {picker==='icons'&&<IconPicker value={form.icon} onSelect={icon=>{change('icon',icon);setPicker(null);}}/>}
            {picker==='photos'&&<PhotoPicker value={form.image} onSelect={image=>{change('image',image);setPicker(null);}}/>}
          </div>
        </div>
        {task && !recurring && <div className="task-focus-row"><div><Timer size={17}/><span><strong>Focus Mode</strong><small>{tr('Realnie przepracowano: ', 'Time actually worked: ')}{Math.floor(focusSeconds/3600)>0?`${Math.floor(focusSeconds/3600)} h `:''}{Math.floor((focusSeconds%3600)/60)} min</small></span></div><button className="btn btn--focus" type="button" onClick={()=>onFocus(task.id)}><Play size={15} fill="currentColor"/> {tr('Rozpocznij Focus', 'Start Focus')}</button></div>}
        </div>
        <div className="modal-bottom task-modal-footer task-footer">
          {series ? <>
            <div className="series-delete-wrap" ref={deleteRef}>
              <button type="button" className="task-footer-delete" aria-label={tr('Usuń zadanie cykliczne', 'Delete recurring task')} title={tr('Usuń', 'Delete')} aria-haspopup="menu" aria-expanded={deleteMenu}
                onClick={() => setDeleteMenu(open => !open)}><Trash2 size={18} /><span className="task-footer-long">{tr('Usuń', 'Delete')}</span></button>
              {deleteMenu && <div className="series-delete-menu" role="menu" aria-label={tr('Co usunąć?', 'What do you want to delete?')}>
                {occurrence && !occurrence.skipped && <button type="button" role="menuitem" onClick={() => { setDeleteMenu(false); skipThisOccurrence(); }}>
                  <CalendarX2 size={17}/><span><strong>{tr('Tylko to wystąpienie', 'Only this occurrence')}</strong><small>{tr(`${fullDate(occurrence.date)} — reszta serii bez zmian.`, `${fullDate(occurrence.date)} — the rest of the series stays unchanged.`)}</small></span>
                </button>}
                {endFrom && <button type="button" role="menuitem" onClick={() => { setDeleteMenu(false); onEndSeries(series.id, endFrom); }}>
                  <Flag size={17}/><span><strong>{tr('Zakończ serię', 'End series')}</strong><small>{occurrence ? tr('To i kolejne wystąpienia znikną', 'This and all later occurrences will be removed') : tr(`Od ${shortDayLabel(endFrom, today)} kolejne wystąpienia znikną`, `Occurrences from ${shortDayLabel(endFrom, today)} onwards will be removed`)}{tr('. Historia zostaje.', '. Your history is kept.')}</small></span>
                </button>}
                <button type="button" role="menuitem" className="is-danger" onClick={() => { setDeleteMenu(false); if (window.confirm(tr(`Usunąć zadanie cykliczne „${series.title}” wraz z całą historią wykonań?`, `Delete the recurring task “${series.title}” along with its entire completion history?`))) onDeleteSeries(series.id); }}>
                  <Trash2 size={17}/><span><strong>{tr('Usuń całą serię', 'Delete entire series')}</strong><small>{tr('Razem z historią i zdobytym XP.', 'Including its history and earned XP.')}</small></span>
                </button>
              </div>}
            </div>
            {occurrence && <button type="button" className={`task-footer-status ${form.done ? 'is-done' : ''}`} onClick={() => save(!form.done)}
              title={form.done ? tr('Oznacz to wystąpienie jako niewykonane', 'Mark this occurrence as not done') : tr('Oznacz to wystąpienie jako ukończone', 'Mark this occurrence as done')}>
              {form.done ? <RotateCcw size={17} /> : <CheckCircle2 size={17} />}
              <span className="task-footer-long">{form.done ? tr('Oznacz jako niewykonane', 'Mark as not done') : tr('Oznacz jako ukończone', 'Mark as done')}</span>
              <span className="task-footer-short">{form.done ? tr('Przywróć', 'Reopen') : tr('Ukończ', 'Complete')}</span>
            </button>}
          </> : task ? <>
            <button type="button" className="task-footer-delete" aria-label={tr('Usuń zadanie', 'Delete task')} title={tr('Usuń zadanie', 'Delete task')}
              onClick={() => { if (window.confirm(tr('Usunąć to zadanie?', 'Delete this task?'))) onDelete(task.id); }}><Trash2 size={18} /><span className="task-footer-long">{tr('Usuń', 'Delete')}</span></button>
            <button type="button" className={`task-footer-status ${form.done ? 'is-done' : ''}`} onClick={() => save(!form.done)}
              title={form.done ? tr('Oznacz jako niewykonane', 'Mark as not done') : tr('Oznacz jako ukończone', 'Mark as done')}>
              {form.done ? <RotateCcw size={17} /> : <CheckCircle2 size={17} />}
              <span className="task-footer-long">{form.done ? tr('Oznacz jako niewykonane', 'Mark as not done') : tr('Oznacz jako ukończone', 'Mark as done')}</span>
              <span className="task-footer-short">{form.done ? tr('Przywróć', 'Reopen') : tr('Ukończ', 'Complete')}</span>
            </button>
          </> : <span className="modal-tip task-footer-tip">{recurring ? tr('Kolejne terminy pojawią się w kalendarzu.', 'Upcoming dates will appear in the calendar.') : tr('Możesz zapisać zadanie bez podawania daty.', 'You can save a task without a date.')}</span>}
          <button type="button" className="btn btn--ghost task-footer-cancel" onClick={onClose}>{tr('Anuluj', 'Cancel')}</button>
          <button type="button" className="btn btn--primary task-footer-save" disabled={!form.title.trim()} onClick={() => save()}>
            <Check size={16} />{task || series ? <><span className="task-footer-long">{tr('Zapisz zmiany', 'Save changes')}</span><span className="task-footer-short">{tr('Zapisz', 'Save')}</span></> : tr('Dodaj zadanie', 'Add task')}
          </button>
        </div>
      </div>
      {moving && series && occurrence && onMoveOccurrence && <MoveOccurrenceModal kind="series" title={series.title} date={occurrence.date} time={occurrence.time}
        sourceDate={occurrence.sourceDate} originalTime={series.time} otherTimesOn={otherTimesOn}
        onMove={(date, time) => onMoveOccurrence(occurrence.sourceDate, date, time ?? occurrence.time)} onClose={() => setMoving(false)}/>}
      {moving && task && !series && form.date && onMoveTask && <MoveOccurrenceModal kind="task" title={form.title.trim() || task.title} date={form.date} time={form.time}
        onMove={(date, time) => { setForm(current => ({ ...current, date, time })); onMoveTask(task.id, date, time); }} onClose={() => setMoving(false)}/>}
    </div>
  );
}
