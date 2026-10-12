import type { Project, ProjectMilestone, ProjectSubtask, Task } from '../types';

export interface ProgressCount { completed: number; total: number; percent: number }

const ratio = (completed: number, total: number): ProgressCount => ({
  completed, total, percent: total === 0 ? 0 : Math.round(completed / total * 100),
});

export function milestoneTasks(milestone: ProjectMilestone, tasks: Task[], projectId: string): Task[] {
  return tasks.filter(task => task.projectId === projectId && task.milestoneId === milestone.id);
}

export function taskFraction(task: Task): number {
  if (task.done) return 1;
  const subtasks = task.subtasks ?? [];
  return subtasks.length ? subtasks.filter(item => item.done).length / subtasks.length : 0;
}

/** Każdy checkpoint checklisty i task podpięty do kamienia milowego liczy się raz. */
export function milestoneProgress(milestone: ProjectMilestone, tasks: Task[], projectId: string): ProgressCount {
  const linked = milestoneTasks(milestone, tasks, projectId);
  const subtasks = milestone.subtasks ?? [];
  if (!linked.length && !subtasks.length) return ratio(milestone.done ? 1 : 0, 1);
  return ratio(linked.reduce((sum, task) => sum + taskFraction(task), 0) + subtasks.filter(item => item.done).length, linked.length + subtasks.length);
}

/** Postęp projektu to średnia kamieni milowych oraz niezależnych zadań projektu. */
export function projectProgress(project: Project, tasks: Task[]): ProgressCount {
  const milestones = project.milestones ?? [];
  const validIds = new Set(milestones.map(milestone => milestone.id));
  const direct = tasks.filter(task => task.projectId === project.id && (!task.milestoneId || !validIds.has(task.milestoneId)));
  const components = [
    ...milestones.map(milestone => { const progress = milestoneProgress(milestone, tasks, project.id); return progress.total ? progress.completed / progress.total : 0; }),
    ...direct.map(taskFraction),
  ];
  return {completed: components.filter(value => value >= 1).length, total: components.length,
    percent: components.length ? Math.round(100 * components.reduce((sum, value) => sum + value, 0) / components.length) : 0};
}

export function projectTasks(project: Project, tasks: Task[]): Task[] {
  return tasks.filter(task => task.projectId === project.id);
}

export function newSubtask(title: string): ProjectSubtask {
  return { id: crypto.randomUUID(), title: title.trim(), done: false };
}

export function newMilestone(title: string): ProjectMilestone {
  return { id: crypto.randomUUID(), title: title.trim(), description: '', targetDate: null, done: false, subtasks: [] };
}

export function newProject(title: string): Project {
  return { id: crypto.randomUUID(), title: title.trim(), description: '', icon: 'rocket',
    category: 'potential', targetDate: null, createdAt: new Date().toISOString(), milestones: [] };
}
