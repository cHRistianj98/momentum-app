import type { RoutineStep } from '../types';

/** Existing steps without a schedule stay visible every day (backwards compatible). */
export function routineStepOnDate(step: RoutineStep, date: string): boolean {
  const days = step.weekdays;
  return !Array.isArray(days) || days.includes(new Date(`${date}T12:00:00`).getDay());
}

/** Return only steps applicable to this occurrence; don't leave orphan child steps. */
export function routineStepsOnDate(steps: RoutineStep[], occurrenceDate: string): RoutineStep[] {
  const scheduled = steps.filter(step => routineStepOnDate(step, occurrenceDate));
  const visible = new Set(scheduled.map(step => step.id));
  return scheduled.filter(step => !step.parentId || visible.has(step.parentId));
}

/** Unspecified schedule = daily; explicit days have to be within 0..6 and unique. */
export function normalizeStepWeekdays(days: number[]): number[] | undefined {
  const valid = [...new Set(days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a,b) => a-b);
  return valid.length === 7 ? undefined : valid;
}

export function stepWeekdaysLabel(step: RoutineStep): string {
  const days = step.weekdays;
  if (!Array.isArray(days) || days.length === 7) return 'Codziennie';
  const short = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
  return days.map(day => short[day]).filter(Boolean).join(', ') || 'Nie wybrano dni';
}
