/** Model sesji Focus niezależny od komponentów i danych Momentum. */
export type FocusPhase = 'focus' | 'paused' | 'break';

export interface FocusSession {
  id: string;
  taskId: string;
  taskTitle: string;
  plannedMinutes: number;
  startedAt: string;
  phase: FocusPhase;
  focusMs: number;
  breakMs: number;
  /** Timestamp przejścia do bieżącej fazy. Null, kiedy jest pauza. */
  phaseStartedAt: number | null;
  breakTargetMs: number;
}

export interface FocusRecord {
  id: string;
  taskId: string;
  taskTitle: string;
  plannedMinutes: number;
  /** Dokładny czas pracy, z wyłączeniem przerw. */
  focusSeconds: number;
  breakSeconds: number;
  startedAt: string;
  finishedAt: string;
  taskCompleted: boolean;
  xpAwarded: number;
}

export interface FocusStore {
  active: FocusSession | null;
  history: FocusRecord[];
}

export const FOCUS_STORAGE_KEY = 'momentum.focus.v1';
export const EMPTY_FOCUS_STORE: FocusStore = { active: null, history: [] };

export function snapshot(session: FocusSession, now: number): { focusMs: number; breakMs: number } {
  const runningMs = session.phaseStartedAt === null ? 0 : Math.max(0, now - session.phaseStartedAt);
  return {
    focusMs: session.focusMs + (session.phase === 'focus' ? runningMs : 0),
    breakMs: session.breakMs + (session.phase === 'break' ? runningMs : 0),
  };
}

export function changePhase(session: FocusSession, phase: FocusPhase, now: number, breakTargetMs = session.breakTargetMs): FocusSession {
  const elapsed = snapshot(session, now);
  return {
    ...session,
    ...elapsed,
    phase,
    breakTargetMs,
    phaseStartedAt: phase === 'paused' ? null : now,
  };
}

export function createFocusSession(taskId: string, taskTitle: string, plannedMinutes: number, now: number, id: string): FocusSession {
  return {
    id,
    taskId,
    taskTitle,
    plannedMinutes: Math.max(15, Math.round(plannedMinutes || 45)),
    startedAt: new Date(now).toISOString(),
    phase: 'focus',
    focusMs: 0,
    breakMs: 0,
    phaseStartedAt: now,
    breakTargetMs: 5 * 60 * 1000,
  };
}

export function finishFocusSession(session: FocusSession, now: number, taskCompleted: boolean, xpAwarded: number): FocusRecord {
  const elapsed = snapshot(session, now);
  return {
    id: session.id,
    taskId: session.taskId,
    taskTitle: session.taskTitle,
    plannedMinutes: session.plannedMinutes,
    focusSeconds: Math.floor(elapsed.focusMs / 1000),
    breakSeconds: Math.floor(elapsed.breakMs / 1000),
    startedAt: session.startedAt,
    finishedAt: new Date(now).toISOString(),
    taskCompleted,
    xpAwarded,
  };
}

export function readFocusStore(raw: string | null): FocusStore {
  if (!raw) return EMPTY_FOCUS_STORE;
  try {
    const value = JSON.parse(raw) as Partial<FocusStore>;
    const history = Array.isArray(value.history) ? value.history.filter(record =>
      record && typeof record.taskId === 'string' && Number.isFinite(record.focusSeconds) && record.focusSeconds >= 0
    ).slice(-500) : [];
    const active = value.active;
    if (!active || typeof active.taskId !== 'string' || !['focus','paused','break'].includes(active.phase) ||
      !Number.isFinite(active.focusMs) || !Number.isFinite(active.breakMs) ||
      (active.phase !== 'paused' && !Number.isFinite(active.phaseStartedAt))) {
      return { active: null, history };
    }
    return { active: { ...active, phaseStartedAt: active.phase === 'paused' ? null : active.phaseStartedAt }, history };
  } catch {
    return EMPTY_FOCUS_STORE;
  }
}

export function formatFocusClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = seconds % 60;
  return hh > 0
    ? [hh, mm, ss].map(part => String(part).padStart(2, '0')).join(':')
    : `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
