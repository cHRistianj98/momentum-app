import { useEffect, useState } from 'react';
import { readMomentumKey, saveMomentumKey } from './offlineDatabase';
import {
  FOCUS_STORAGE_KEY, changePhase, createFocusSession, finishFocusSession, readFocusStore, snapshot,
  type FocusPhase, type FocusRecord,
} from './focus';

export function useFocusTimer() {
  const [store, setStore] = useState(() => readFocusStore(readMomentumKey(FOCUS_STORAGE_KEY)));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    try { saveMomentumKey(FOCUS_STORAGE_KEY, JSON.stringify(store)); }
    catch (error) { console.warn('Nie można zapisać sesji Focus:', error); }
  }, [store]);

  useEffect(() => {
    if (!store.active || store.active.phase === 'paused') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [store.active?.id, store.active?.phase]);

  const active = store.active;
  const elapsed = active ? snapshot(active, now) : { focusMs: 0, breakMs: 0 };
  const breakElapsed = active?.phase === 'break' && active.phaseStartedAt !== null
    ? Math.max(0, now - active.phaseStartedAt) : 0;

  function start(taskId: string, taskTitle: string, plannedMinutes: number): boolean {
    if (store.active) return store.active.taskId === taskId;
    const when = Date.now();
    setNow(when);
    setStore(previous => ({ ...previous, active: createFocusSession(taskId, taskTitle, plannedMinutes, when, crypto.randomUUID()) }));
    return true;
  }

  function setPhase(phase: FocusPhase, breakMinutes = 5) {
    const when = Date.now();
    setNow(when);
    setStore(previous => previous.active
      ? { ...previous, active: changePhase(previous.active, phase, when, breakMinutes * 60 * 1000) }
      : previous);
  }

  function finish(taskCompleted: boolean, xpAwarded: number): FocusRecord | null {
    if (!store.active) return null;
    const record = finishFocusSession(store.active, Date.now(), taskCompleted, xpAwarded);
    setStore(previous => ({ active: null, history: [...previous.history, record].slice(-500) }));
    return record;
  }

  return {
    active, history: store.history, elapsed, breakElapsed,
    start, setPhase, finish,
  };
}
