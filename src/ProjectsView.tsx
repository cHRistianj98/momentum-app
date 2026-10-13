import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronDown, Circle, Clock3, Flag, Link2, MoreHorizontal, Plus, Rocket, Search, Sparkles, Trash2, X } from 'lucide-react';
import { DatePicker } from './DatePicker';
import { CategoryChoices } from './CategoryChoices';
import { CategoryBadge, TaskVisual } from './VisualIdentity';
import { TaskIcon } from '../lib/icons';
import { newMilestone, newProject, newSubtask, projectProgress, milestoneProgress, milestoneTasks, projectTasks } from '../lib/projects';
import type { CategoryConfig, Project, ProjectMilestone, Task } from '../types';

type Filter = 'all' | 'active' | 'completed' | 'archived';
type Props = {
  projects: Project[];
  tasks: Task[];
  categories: CategoryConfig;
  onSaveProject: (project: Project) => void;
  onDeleteProject: (id: string) => void;
  onCreateTask: (projectId: string, milestoneId?: string) => void;
  onOpenTask: (id: string) => void;
  onToggleTask: (id: string) => void;
  onLinkTask: (taskId: string, projectId: string, milestoneId?: string) => void;
};

const ICONS = ['rocket','code-2','graduation-cap','dumbbell','book-open','house','briefcase-business','plane','target','wallet','brain','heart-pulse'];
function prettyDate(value: string | null) {
  if (!value) return 'Bez terminu';
  const [y,m,d] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('pl-PL',{day:'numeric',month:'short',year:'numeric'}).format(new Date(y,m-1,d,12));
}

function ProjectEditor({ original, categories, onSave, onClose }:{ original?: Project; categories: CategoryConfig; onSave:(p:Project)=>void; onClose:()=>void }) {
  const [draft,setDraft]=useState<Project>(()=>original ? {...original} : newProject(''));
  const [error,setError]=useState('');
  const set = <K extends keyof Project>(key:K,value:Project[K])=>setDraft(old=>({...old,[key]:value}));
  function save(){if(!draft.title.trim()){setError('Nadaj projektowi nazwę.');return;}onSave({...draft,title:draft.title.trim(), description:draft.description.trim()});}
  return <div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="modal project-editor" role="dialog" aria-modal="true" aria-label={original?'Edytuj projekt':'Nowy projekt'}>
      <div className="modal-heading"><div><span className="eyebrow">TWOJE WIĘKSZE CELE</span><h2>{original?'Edytuj projekt':'Nowy projekt'}</h2></div><button className="icon-btn" onClick={onClose} aria-label="Zamknij"><X size={19}/></button></div>
      <div className="modal-fields">
        <label className="field"><span>Nazwa projektu *</span><input autoFocus maxLength={90} value={draft.title} placeholder="Np. Rozwój Momentum" onChange={e=>set('title',e.target.value)}/></label>
        <label className="field"><span>Co chcesz osiągnąć?</span><textarea value={draft.description} rows={3} placeholder="Cel, zakres projektu i motywacja..." onChange={e=>set('description',e.target.value)}/></label>
        <div className="field"><span>Kategoria finansowa</span><CategoryChoices value={draft.category} categories={categories} onChange={category=>set('category',category)}/></div>
        <div className="field"><span>Ikona projektu</span><div className="project-icon-grid">{ICONS.map(icon=><button type="button" key={icon} onClick={()=>set('icon',icon)} title={icon} className={`project-icon-choice ${draft.icon===icon?'selected':''}`}><TaskIcon name={icon} size={23}/></button>)}</div></div>
        <div className="field"><span>Docelowa data (opcjonalnie)</span><DatePicker value={draft.targetDate} onChange={date=>set('targetDate',date)}/></div>
        {error&&<p className="project-field-error">{error}</p>}
      </div>
      <div className="modal-bottom"><span className="modal-tip">Kamienie milowe i zadania dodasz po zapisaniu projektu.</span><div className="modal-bottom-right"><button className="btn btn--ghost" onClick={onClose}>Anuluj</button><button className="btn btn--primary" onClick={save}><Check size={16}/> {original?'Zapisz':'Utwórz projekt'}</button></div></div>
    </div>
  </div>;
}

function TaskAttach({ tasks, onAttach, label = 'Dołącz zadanie' }:{tasks:Task[];onAttach:(id:string)=>void; label?:string}){
  const [open,setOpen]=useState(false);
  const [query,setQuery]=useState('');
  const available=tasks.filter(t=>t.title.toLocaleLowerCase('pl-PL').includes(query.toLocaleLowerCase('pl-PL'))).slice(0,20);
  return <div className="project-attach">
    <button className="project-action-light" onClick={()=>setOpen(!open)}><Link2 size={14}/>{label}<ChevronDown size={13}/></button>
    {open&&<div className="project-attach-panel"><label><Search size={14}/><input autoFocus value={query} onChange={e=>setQuery(e.target.value)} placeholder="Znajdź istniejące zadanie"/></label>
      <div className="project-attach-list">{available.map(task=><button key={task.id} onClick={()=>{onAttach(task.id);setOpen(false);setQuery('');}}><span className={`project-attach-dot ${task.done?'done':''}`}/><span>{task.title}</span><ArrowRight size={14}/></button>)}{!available.length&&<small>Brak pasujących zadań</small>}</div>
    </div>}
  </div>;
}

function ProjectCard({project,tasks,categories,onClick}:{project:Project;tasks:Task[];categories:CategoryConfig;onClick:()=>void}){
  const progress=projectProgress(project,tasks);
  const related=projectTasks(project,tasks);
  const finished=related.filter(task=>task.done).length;
  return <button className={`project-overview-card ${project.archived?'project-overview-card--archived':''}`} onClick={onClick}>
    <div className="project-overview-head"><TaskVisual icon={project.icon} category={project.category} categories={categories} size="large"/><CategoryBadge category={project.category} categories={categories} compact/></div>
    <h3>{project.title}</h3><p>{project.description||'Duży cel, który podzielisz na mniejsze kroki.'}</p>
    <div className="project-overview-progress-head"><span>Postęp projektu</span><strong>{progress.percent}%</strong></div>
    <div className="project-track"><span style={{width:`${progress.percent}%`,background:categories[project.category].color}}/></div>
    <div className="project-overview-foot"><span><Flag size={13}/>{project.milestones.length} kamieni</span><span><CheckCircle2 size={13}/>{finished}/{related.length} zadań</span></div>
    <div className="project-overview-date"><CalendarDays size={14}/>{prettyDate(project.targetDate)}<ArrowRight size={17}/></div>
  </button>;
}

function MilestoneCard({project,milestone,tasks,onUpdate,onCreateTask,onOpenTask,onToggleTask,onLinkTask,unlinkedTasks}:{
  project:Project;milestone:ProjectMilestone;tasks:Task[];unlinkedTasks:Task[];
  onUpdate:(milestone:ProjectMilestone)=>void;onCreateTask:()=>void;onOpenTask:(id:string)=>void;onToggleTask:(id:string)=>void;onLinkTask:(id:string)=>void;
}){
  const [editing,setEditing]=useState(false);
  const [expanded,setExpanded]=useState(true);
  const [entry,setEntry]=useState('');
  const [title,setTitle]=useState(milestone.title);
  const [description,setDescription]=useState(milestone.description ?? '');
  const [targetDate,setTargetDate]=useState<string|null>(milestone.targetDate ?? null);
  useEffect(()=>{setTitle(milestone.title);setDescription(milestone.description??'');setTargetDate(milestone.targetDate??null);},[milestone.id,milestone.title,milestone.description,milestone.targetDate]);
  const linked=milestoneTasks(milestone,tasks,project.id);
  const progress=milestoneProgress(milestone,tasks,project.id);
  const hasItems=linked.length>0||milestone.subtasks.length>0;
  return <article className="project-milestone">
    <div className="project-milestone-heading"><div className="project-milestone-status">{progress.percent===100?<CheckCircle2 size={22}/>:<Flag size={22}/>}</div><button className="project-milestone-title" onClick={()=>setExpanded(!expanded)} aria-expanded={expanded}><strong>{milestone.title}</strong><small>{milestone.targetDate?`Cel: ${prettyDate(milestone.targetDate)}`:'Kamień milowy'} · {progress.percent}% ukończone</small></button><button className="project-action-icon" title="Edytuj kamień milowy" onClick={()=>setEditing(!editing)}><MoreHorizontal size={20}/></button><button className="project-action-icon" title={expanded?'Zwiń':'Rozwiń'} onClick={()=>setExpanded(!expanded)}><ChevronDown size={20}/></button></div>
    <div className="project-track project-track--milestone"><span style={{width:`${progress.percent}%`}}/></div>
    {editing&&<div className="project-milestone-edit"><label>Nazwa<input maxLength={80} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Opis<input maxLength={220} value={description} onChange={e=>setDescription(e.target.value)}/></label><label>Planowany termin<DatePicker value={targetDate} onChange={setTargetDate}/></label><div className="project-milestone-edit-actions"><button className="btn btn--danger" onClick={()=>{if(window.confirm('Usunąć kamień milowy? Powiązane zadania pozostaną w projekcie.'))onUpdate({...milestone,title:'__DELETE__'});}}><Trash2 size={14}/> Usuń</button><button className="btn btn--primary" disabled={!title.trim()} onClick={()=>{onUpdate({...milestone,title:title.trim(),description:description.trim(),targetDate});setEditing(false);}}>Zapisz</button></div></div>}
    {expanded&&<div className="project-milestone-content">
      {milestone.subtasks.map(item=><label key={item.id} className="project-checkline"><input type="checkbox" checked={item.done} onChange={e=>onUpdate({...milestone,done:false,subtasks:milestone.subtasks.map(s=>s.id===item.id?{...s,done:e.target.checked}:s)})}/><span className={item.done?'project-done-text':''}>{item.title}</span><button type="button" title="Usuń krok" onClick={e=>{e.preventDefault();onUpdate({...milestone,subtasks:milestone.subtasks.filter(s=>s.id!==item.id)});}}><X size={14}/></button></label>)}
      {linked.map(task=><div className="project-linked-task" key={task.id}><button className={`project-mini-check ${task.done?'done':''}`} title="Zmień status zadania" onClick={()=>onToggleTask(task.id)}>{task.done?<Check size={14}/>:<Circle size={15}/>}</button><button className={task.done?'project-done-text':''} onClick={()=>onOpenTask(task.id)}>{task.title}</button><span>+{task.xp} XP</span></div>)}
      {!hasItems&&<label className="project-checkline project-manual-check"><input type="checkbox" checked={milestone.done} onChange={e=>onUpdate({...milestone,done:e.target.checked})}/><span>Oznacz ten kamień milowy jako zrealizowany</span></label>}
      <form className="project-add-check" onSubmit={event=>{event.preventDefault();if(!entry.trim())return;onUpdate({...milestone,done:false,subtasks:[...milestone.subtasks,newSubtask(entry)]});setEntry('');}}><Plus size={17}/><input placeholder="Dodaj krok do kamienia milowego..." value={entry} maxLength={110} onChange={e=>setEntry(e.target.value)}/><button disabled={!entry.trim()} type="submit">Dodaj</button></form>
      <div className="project-milestone-footer"><button className="project-action-light" onClick={onCreateTask}><Plus size={15}/> Nowe zadanie</button><TaskAttach tasks={unlinkedTasks} onAttach={onLinkTask} label="Przypnij zadanie"/></div>
    </div>}
  </article>;
}

export function ProjectsView({projects,tasks,categories,onSaveProject,onDeleteProject,onCreateTask,onOpenTask,onToggleTask,onLinkTask}:Props){
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [editor,setEditor]=useState<'new'|'edit'|null>(null);
  const [filter,setFilter]=useState<Filter>('all');
  const [search,setSearch]=useState('');
  const [newMilestoneTitle,setNewMilestoneTitle]=useState('');
  const active=projects.find(project=>project.id===selectedId);
  const visible=useMemo(()=>projects.filter(project=>{
    const progress=projectProgress(project,tasks);
    const matches=project.title.toLocaleLowerCase('pl-PL').includes(search.toLocaleLowerCase('pl-PL'));
    return matches&&(filter==='all'||(filter==='archived'&&project.archived)||(filter==='completed'&&!project.archived&&progress.total>0&&progress.percent===100)||(filter==='active'&&!project.archived&&(progress.total===0||progress.percent<100)));
  }),[projects,tasks,search,filter]);
  const unlinkedTasks=tasks.filter(task=>!task.projectId);

  function updateMilestone(milestone:ProjectMilestone){
    if(!active)return;
    if(milestone.title==='__DELETE__'){
      onSaveProject({...active,milestones:active.milestones.filter(item=>item.id!==milestone.id)});
      // Zadania pozostałe po usunięciu kamienia nadal liczą się do postępu projektu.
      return;
    }
    onSaveProject({...active,milestones:active.milestones.map(item=>item.id===milestone.id?milestone:item)});
  }
  return <div className="projects-root">
    {active? <div className="project-detail">
      <div className="project-detail-actions"><button className="project-back" onClick={()=>setSelectedId(null)}><ArrowLeft size={16}/> Wszystkie projekty</button><div><button className="btn btn--secondary" onClick={()=>setEditor('edit')}><MoreHorizontal size={16}/> Edytuj</button><button className="btn btn--secondary" onClick={()=>onSaveProject({...active,archived:!active.archived})}>{active.archived?'Przywróć':'Archiwizuj'}</button><button className="btn btn--danger" title="Usuń projekt" onClick={()=>{if(window.confirm('Usunąć projekt? Zadania pozostaną, ale stracą przypisanie do projektu.')){onDeleteProject(active.id);setSelectedId(null);}}}><Trash2 size={16}/></button></div></div>
      <div className="project-detail-hero"><TaskVisual icon={active.icon} category={active.category} categories={categories} size="hero"/><div className="project-detail-hero-main"><div className="project-label-row"><CategoryBadge category={active.category} categories={categories}/><span><CalendarDays size={14}/>{prettyDate(active.targetDate)}</span></div><h2>{active.title}</h2><p>{active.description||'Zamień swój duży cel na konkretne, wykonalne kroki.'}</p></div><div className="project-detail-ring" style={{'--project-progress':`${projectProgress(active,tasks).percent}%`,'--project-color':categories[active.category].color} as React.CSSProperties}><strong>{projectProgress(active,tasks).percent}%</strong><small>postępu</small></div></div>
      <div className="project-detail-metrics"><div><Flag size={18}/><strong>{active.milestones.filter(m=>milestoneProgress(m,tasks,active.id).percent===100).length}/{active.milestones.length}</strong><span>Kamienie milowe</span></div><div><CheckCircle2 size={18}/><strong>{projectTasks(active,tasks).filter(t=>t.done).length}/{projectTasks(active,tasks).length}</strong><span>Zadania</span></div><div><Clock3 size={18}/><strong>{projectTasks(active,tasks).reduce((s,t)=>s+(t.done?t.duration:0),0)} min</strong><span>Ukończonych bloków</span></div></div>
      <div className="project-detail-section-title"><div><span className="eyebrow">DROGA DO CELU</span><h3>Kamienie milowe</h3></div></div>
      <div className="project-milestone-list">{active.milestones.map(m=><MilestoneCard key={m.id} project={active} milestone={m} tasks={tasks} onUpdate={updateMilestone} onOpenTask={onOpenTask} onToggleTask={onToggleTask} onCreateTask={()=>onCreateTask(active.id,m.id)} onLinkTask={taskId=>onLinkTask(taskId,active.id,m.id)} unlinkedTasks={unlinkedTasks}/>)}
        <form className="project-add-milestone" onSubmit={e=>{e.preventDefault();if(!newMilestoneTitle.trim())return;onSaveProject({...active,milestones:[...active.milestones,newMilestone(newMilestoneTitle)]});setNewMilestoneTitle('');}}><Flag size={19}/><input placeholder="Nowy kamień milowy, np. Wersja beta gotowa" maxLength={90} value={newMilestoneTitle} onChange={e=>setNewMilestoneTitle(e.target.value)}/><button className="btn btn--primary" disabled={!newMilestoneTitle.trim()} type="submit"><Plus size={15}/> Dodaj etap</button></form>
      </div>
      <div className="project-detail-section-title"><div><span className="eyebrow">ZADANIA POWIĄZANE</span><h3>Pozostałe zadania projektu</h3></div></div>
      <div className="project-direct-task-list">{projectTasks(active,tasks).filter(t=>!active.milestones.some(m=>m.id===t.milestoneId)).map(task=><div className="project-linked-task" key={task.id}><button className={`project-mini-check ${task.done?'done':''}`} onClick={()=>onToggleTask(task.id)} title="Zmień status zadania">{task.done?<Check size={14}/>:<Circle size={15}/>}</button><button onClick={()=>onOpenTask(task.id)} className={task.done?'project-done-text':''}>{task.title}</button><small>{task.time??'Inbox'}</small></div>)}
      {!projectTasks(active,tasks).some(t=>!active.milestones.some(m=>m.id===t.milestoneId))&&<p className="project-empty-line">Zadania bez kamienia milowego pojawią się tutaj.</p>}
      <div className="project-direct-actions"><button className="btn btn--secondary" onClick={()=>onCreateTask(active.id)}><Plus size={16}/> Nowe zadanie</button><TaskAttach tasks={unlinkedTasks} onAttach={id=>onLinkTask(id,active.id)}/></div></div>
    </div> : <>
      <div className="project-intro"><div><span className="eyebrow eyebrow--indigo"><Sparkles size={13}/> TWÓJ DŁUGI HORYZONT</span><h2>Wielkie cele zaczynają się od małych kroków<span>.</span></h2><p>Łącz codzienne zadania w większe przedsięwzięcia. Każdy odhaczony krok przybliża Cię do celu.</p></div><div className="project-intro-ornament"><Rocket size={70}/></div></div>
      <div className="project-toolbar"><div className="project-tabs">{([{id:'all',label:'Wszystkie'},{id:'active',label:'W trakcie'},{id:'completed',label:'Ukończone'},{id:'archived',label:'Archiwum'}] as const).map(tab=><button className={filter===tab.id?'active':''} key={tab.id} onClick={()=>setFilter(tab.id)}>{tab.label}</button>)}</div><label className="project-search"><Search size={16}/><input placeholder="Szukaj projektów" value={search} onChange={e=>setSearch(e.target.value)}/></label><button className="btn btn--primary project-toolbar-create" onClick={()=>setEditor('new')}><Plus size={17}/> Nowy projekt</button></div>
      <div className="project-grid">{visible.map(project=><ProjectCard key={project.id} project={project} tasks={tasks} categories={categories} onClick={()=>setSelectedId(project.id)}/>)}<button className="project-create-card" onClick={()=>setEditor('new')}><span><Plus size={28}/></span><strong>Stwórz nowy projekt</strong><p>Dodaj cel, etapy i powiąż z nim zadania.</p></button></div>
    </>}
    {editor&&<ProjectEditor original={editor==='edit'?active:undefined} categories={categories} onSave={project=>{onSaveProject(project);setSelectedId(project.id);setEditor(null);}} onClose={()=>setEditor(null)}/>}
  </div>;
}
