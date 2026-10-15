export type CategoryKey = 'unpaid' | 'potential' | 'income';
export type Page = 'overview' | 'calendar' | 'tasks' | 'routines' | 'insights' | 'review' | 'projects';
export type IconKey = string; // Nazwa ikony Lucide, wybierana z katalogu ponad 1000 ikon.

export interface CategoryStyle {
  label: string;
  description: string;
  color: string;
  tint: string;
}

export type CategoryConfig = Record<CategoryKey, CategoryStyle>;

export interface Task {
  id: string;
  title: string;
  description: string;
  category: CategoryKey;
  icon: IconKey;
  image?: string;
  date: string | null; // YYYY-MM-DD (local), null = Inbox
  time: string | null; // HH:mm; null = bez godziny
  duration: number;
  done: boolean;
  xp: number;
  createdAt: string;
  projectId?: string | null;
  milestoneId?: string | null;
  subtasks?: ProjectSubtask[];
}

export interface RoutineStep {
  id: string;
  title: string;
  /** Optional ID of the parent step; only one level of nesting. */
  parentId?: string;
}

export interface Routine {
  id: string;
  title: string;
  description: string;
  icon: IconKey;
  image?: string; // miniatura lub własny obrazek dla rutyny
  category: CategoryKey;
  time: string;
  duration: number;
  weekdays: number[]; // 0 = niedziela ... 6 = sobota
  steps: RoutineStep[];
  xp: number;
  active: boolean;
}

export interface RoutineLog {
  id: string; // routineId + YYYY-MM-DD
  checkedStepIds: string[];
  completed: boolean;
  completedAt?: string;
  /** Wyjątek długości tylko dla danego dnia; szablon rutyny pozostaje bez zmian. */
  durationOverride?: number;
  /** Nadpisanie godziny tylko dla tego wystąpienia rutyny. */
  timeOverride?: string;
  /** Nadpisanie dnia: wpis logu zostaje pod pierwotną datą, wraz z krokami i XP. */
  dateOverride?: string;
}

export interface ProjectSubtask {
  id: string;
  title: string;
  done: boolean;
}

export interface ProjectMilestone {
  id: string;
  title: string;
  description: string;
  targetDate: string | null;
  done: boolean;
  subtasks: ProjectSubtask[];
}

export interface Project {
  id: string;
  title: string;
  description: string;
  icon: IconKey;
  category: CategoryKey;
  targetDate: string | null;
  createdAt: string;
  milestones: ProjectMilestone[];
  archived?: boolean;
}

export interface AppData {
  tasks: Task[];
  projects: Project[];
  routines: Routine[];
  routineLogs: Record<string, RoutineLog>;
  categories: CategoryConfig;
  theme: 'light' | 'dark';
}

export interface TaskPreset {
  title: string;
  icon: IconKey;
  category: CategoryKey;
  duration: number;
  xp: number;
}
