import { useEffect, useRef, useState } from 'react';
import type { RoutineStep } from '../types';
import { orderRoutineSteps, placeRoutineStep, unnestRoutineStep } from './routineHierarchy';

type DragSession = { id: string; x: number; y: number; active: boolean; timer: ReturnType<typeof setTimeout> | null };
type Hint = { id: string; parentId: string | null; label: string };

/** Long press -> horizontal drag. Native page scrolling is cancelled only AFTER activation. */
export function useRoutineStepDrag(steps: RoutineStep[], onChange: (steps: RoutineStep[]) => void, handleOnly = false, enabled = true) {
  const listRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef(steps);
  const onChangeRef = useRef(onChange);
  const hintRef = useRef<Hint | null>(null);
  const [hint, setHint] = useState<Hint | null>(null);
  const suppressClickRef = useRef(false);
  stepRef.current = steps;
  onChangeRef.current = onChange;

  useEffect(() => {
    const list = listRef.current;
    if (!list || !enabled) return;
    let session: DragSession | null = null;
    let touchId: number | null = null;
    const ordered = () => orderRoutineSteps(stepRef.current);
    const clear = () => {
      for (const row of list.querySelectorAll<HTMLElement>('[data-routine-step-id]')) {
        row.style.removeProperty('transform');
        row.style.removeProperty('opacity');
      }
      if (session?.timer) clearTimeout(session.timer);
      session = null;
      touchId = null;
      hintRef.current = null;
      setHint(null);
      list.classList.remove('routine-gesture-active');
    };
    const start = (target: EventTarget | null, x: number, y: number) => {
      if (!(target instanceof Element)) return;
      if (handleOnly && !target.closest('[data-step-drag-handle]')) return;
      const row = target.closest<HTMLElement>('[data-routine-step-id]');
      if (!row || !list.contains(row)) return;
      const id = row.dataset.routineStepId;
      if (!id) return;
      clear();
      session = { id, x, y, active: false, timer: null };
      const current = session;
      current.timer = setTimeout(() => {
        if (session !== current) return;
        current.active = true;
        list.classList.add('routine-gesture-active');
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(12);
        setHint({ id, parentId: null, label: 'Przesuń w prawo, aby utworzyć podzadanie' });
      }, 470);
    };
    const move = (x: number, y: number, prevent?: () => void) => {
      if (!session) return;
      const dx = x - session.x;
      const dy = y - session.y;
      if (!session.active) {
        if (Math.hypot(dx, dy) > 10) clear(); // native scroll stays native
        return;
      }
      prevent?.();
      const current = ordered();
      const row = Array.from(list.querySelectorAll<HTMLElement>('[data-routine-step-id]'))
        .find(element => element.dataset.routineStepId === session?.id);
      if (row) {
        row.style.transform = `translate3d(${Math.max(-72, Math.min(72, dx))}px, ${Math.max(-96, Math.min(96, dy))}px, 0)`;
        row.style.opacity = '0.85';
      }
      const dragged = current.find(step => step.id === session?.id);
      if (!dragged) return;
      let next: Hint;
      if (dx < -32 && dragged.parentId) {
        next = { id: dragged.id, parentId: null, label: '↤ Przenieś na główny poziom' };
      } else if (dx > 32) {
        const rowElements = Array.from(list.querySelectorAll<HTMLElement>('[data-routine-step-id]'));
        let parent = rowElements.map(element => {
          const step = current.find(item => item.id === element.dataset.routineStepId);
          const box = element.getBoundingClientRect();
          return { step, center: (box.top + box.bottom) / 2, inside: y >= box.top && y <= box.bottom };
        }).filter((item): item is { step: RoutineStep; center: number; inside: boolean } => Boolean(item.step))
          .filter(item => item.step.id !== dragged.id)
          .sort((a, b) => a.center - b.center);
        // Dropping over another row makes it the parent; otherwise use the prior root.
        let selected = parent.find(item => item.inside)?.step;
        if (!selected) {
          const index = current.findIndex(step => step.id === dragged.id);
          selected = [...current.slice(0, index)].reverse().find(step => !step.parentId);
        }
        if (selected?.parentId) selected = current.find(step => step.id === selected?.parentId);
        if (selected?.id === dragged.id || current.some(step => step.parentId === dragged.id)) selected = undefined;
        next = selected ? { id: dragged.id, parentId: selected.id, label: `↳ Podzadanie: ${selected.title}` }
          : { id: dragged.id, parentId: null, label: 'Przesuń na inny krok, aby go wybrać' };
      } else {
        next = { id: dragged.id, parentId: dragged.parentId ?? null, label: '↔ Przesuń w prawo lub w lewo' };
      }
      // Avoid extra renders while touchmove is firing at 60 Hz.
      if (hintRef.current?.id !== next.id || hintRef.current?.parentId !== next.parentId || hintRef.current?.label !== next.label) {
        hintRef.current = next;
        setHint(next);
      }
    };
    const finish = (x: number, prevent?: () => void) => {
      if (!session) return;
      const active = session.active;
      const id = session.id;
      const dx = x - session.x;
      const target = hintRef.current;
      if (active) {
        prevent?.();
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 350);
        const current = ordered();
        const step = current.find(item => item.id === id);
        if (step && dx > 32 && target?.parentId) onChangeRef.current(placeRoutineStep(current, id, target.parentId));
        if (step?.parentId && dx < -32) onChangeRef.current(unnestRoutineStep(current, id));
      }
      clear();
    };
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.changedTouches[0];
      start(event.target, touch.clientX, touch.clientY);
      if (session) touchId = touch.identifier;
    };
    const touchMove = (event: TouchEvent) => {
      if (touchId === null) return;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === touchId);
      if (!touch) return;
      move(touch.clientX, touch.clientY, () => { if (event.cancelable) event.preventDefault(); });
    };
    const touchEnd = (event: TouchEvent) => {
      if (touchId === null) return;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === touchId);
      if (touch) finish(touch.clientX, () => { if (event.cancelable) event.preventDefault(); });
    };
    const mouseStart = (event: MouseEvent) => {
      if (event.button !== 0) return;
      start(event.target, event.clientX, event.clientY);
    };
    const mouseMove = (event: MouseEvent) => {
      if (session && (event.buttons & 1) === 0) { clear(); return; }
      move(event.clientX, event.clientY, () => event.preventDefault());
    };
    const mouseEnd = (event: MouseEvent) => finish(event.clientX);
    const cancel = () => clear();
    list.addEventListener('touchstart', touchStart, { passive: true });
    list.addEventListener('touchmove', touchMove, { passive: false });
    list.addEventListener('touchend', touchEnd, { passive: false });
    list.addEventListener('touchcancel', cancel);
    list.addEventListener('mousedown', mouseStart);
    window.addEventListener('mousemove', mouseMove);
    window.addEventListener('mouseup', mouseEnd);
    return () => {
      clear();
      list.removeEventListener('touchstart', touchStart);
      list.removeEventListener('touchmove', touchMove);
      list.removeEventListener('touchend', touchEnd);
      list.removeEventListener('touchcancel', cancel);
      list.removeEventListener('mousedown', mouseStart);
      window.removeEventListener('mousemove', mouseMove);
      window.removeEventListener('mouseup', mouseEnd);
    };
  }, [enabled, handleOnly]);

  return { listRef, hint, suppressClickRef };
}
