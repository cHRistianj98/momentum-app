export type CategoryKey = 'unpaid' | 'potential' | 'income';
export type Page = 'overview' | 'calendar' | 'tasks' | 'routines' | 'insights';
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
}

export interface RoutineStep {
  id: string;
  title: string;
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

export interface AppData {
  tasks: Task[];
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
