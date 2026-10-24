import { useEffect, useRef, useState } from 'react';
import type { RoutineStep } from '../types';
import { orderRoutineSteps, placeRoutineStep, reorderRoutineStep, unnestRoutineStep } from './routineHierarchy';

type DropHint = {
  id: string;
  targetId?: string;
  markerId?: string;
  action: 'nest' | 'unnest' | 'reorder' | 'none';
  position?: 'before' | 'after';
  label: string;
};
type DragSession = {
  id: string;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  listTop: number;
  active: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  preview: RoutineStep[];
};

/** Gesture handling belongs ONLY to the template editor.
 * Keep DOM nodes in place throughout a touch gesture (Safari cancels touches if the
 * original target is reordered). Instead, slide siblings into the future slots using
 * CSS transforms and commit the order when the user lifts their finger.
 */
export function useRoutineStepDrag(steps: RoutineStep[], onChange: (steps: RoutineStep[]) => void) {
  const listRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef(steps);
  const onChangeRef = useRef(onChange);
  const hintRef = useRef<DropHint | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);
  stepsRef.current = steps;
  onChangeRef.current = onChange;

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const modal = list.closest<HTMLElement>('.modal');
    let session: DragSession | null = null;
    let touchId: number | null = null;
    let lastHint: DropHint | null = null;
    let scrollFrame = 0;
    let cleanupFrame = 0;

    const rows = () => Array.from(list.querySelectorAll<HTMLElement>('[data-routine-step-id]'));
    const resetTransforms = () => {
      for (const row of rows()) {
        row.style.removeProperty('transform');
        row.style.removeProperty('transition');
        row.style.removeProperty('will-change');
        row.style.removeProperty('z-index');
      }
    };
    const reset = (delayForReact = false) => {
      if (session?.timer) clearTimeout(session.timer);
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      scrollFrame = 0;
      session = null;
      touchId = null;
      hintRef.current = null;
      lastHint = null;
      setHint(null);
      list.classList.remove('routine-gesture-active');
      if (cleanupFrame) cancelAnimationFrame(cleanupFrame);
      if (delayForReact) cleanupFrame = requestAnimationFrame(() => { cleanupFrame = 0; resetTransforms(); });
      else resetTransforms();
    };
    const setDropHint = (next: DropHint) => {
      const old = lastHint;
      if (old?.id === next.id && old?.action === next.action && old?.targetId === next.targetId && old?.markerId === next.markerId && old?.position === next.position && old?.label === next.label) return;
      lastHint = next;
      hintRef.current = next;
      setHint(next);
    };

    const moveRows = (gesture: DragSession, nextOrder: RoutineStep[], deltaX: number, deltaY: number) => {
      const allRows = rows();
      const elements = new Map(allRows.map(row => [row.dataset.routineStepId!, row]));
      const movedIds = new Set([gesture.id, ...gesture.preview.filter(step => step.parentId === gesture.id).map(step => step.id)]);
      const gap = parseFloat(window.getComputedStyle(list).rowGap) || 0;
      const originalY = allRows[0]?.offsetTop ?? 0;
      let desiredY = originalY;
      for (const step of nextOrder) {
        const row = elements.get(step.id);
        if (!row) continue;
        const dragging = movedIds.has(step.id);
        // Account for a modal scroll while holding the row, so it follows the finger.
        const scrollDelta = gesture.listTop - list.getBoundingClientRect().top;
        const shiftY = dragging ? deltaY + scrollDelta : desiredY - row.offsetTop;
        row.style.transform = `translate3d(${dragging ? Math.max(-68, Math.min(68, deltaX)) : 0}px, ${shiftY}px, 0)`;
        row.style.transition = dragging ? 'none' : 'transform 170ms cubic-bezier(.22,.8,.22,1)';
        row.style.willChange = 'transform';
        row.style.zIndex = dragging ? '20' : '1';
        desiredY += row.offsetHeight + gap;
      }
    };

    const update = (x: number, y: number) => {
      const gesture = session;
      if (!gesture?.active) return;
      gesture.lastX = x;
      gesture.lastY = y;
      const dx = x - gesture.x;
      const dy = y - gesture.y;
      const ordered = orderRoutineSteps(stepsRef.current);
      const moved = ordered.find(step => step.id === gesture.id);
      if (!moved) { reset(); return; }
      const allRows = rows();
      // offsetTop is layout position, unaffected by our sibling transforms.
      const topOfList = list.getBoundingClientRect().top;
      const relativeY = y - topOfList;
      const center = (id: string) => {
        const row = allRows.find(item => item.dataset.routineStepId === id);
        return row ? row.offsetTop + row.offsetHeight / 2 : 0;
      };
      const excluded = new Set([moved.id, ...ordered.filter(step => step.parentId === moved.id).map(step => step.id)]);
      const hovered = allRows.find(row => {
        const id = row.dataset.routineStepId!;
        return !excluded.has(id) && relativeY >= row.offsetTop && relativeY <= row.offsetTop + row.offsetHeight;
      });
      const hoveredStep = ordered.find(step => step.id === hovered?.dataset.routineStepId);
      const noDrop = (label: string) => {
        gesture.preview = ordered;
        moveRows(gesture, ordered, dx, dy);
        setDropHint({ id: moved.id, action: 'none', label });
      };
      if (dx < -38 && moved.parentId) {
        gesture.preview = ordered;
        moveRows(gesture, ordered, dx, dy);
        setDropHint({ id: moved.id, action: 'unnest', label: '↤ Odłącz krok od rodzica' });
        return;
      }
      if (dx > 38) {
        const target = hoveredStep?.parentId ? ordered.find(step => step.id === hoveredStep.parentId) : hoveredStep;
        if (target && target.id !== moved.id && !ordered.some(step => step.parentId === moved.id)) {
          gesture.preview = ordered;
          moveRows(gesture, ordered, dx, dy);
          setDropHint({ id: moved.id, action: 'nest', targetId: target.id, label: `↳ Podzadanie: ${target.title || 'krok'}` });
        } else noDrop('Przesuń na inny krok, aby zrobić podzadanie');
        return;
      }

      // Determine insertion by crossing another item's midpoint. No requirement
      // to hit a narrow row with the finger on release; empty gaps work too.
      const candidates = moved.parentId
        ? ordered.filter(step => step.parentId === moved.parentId && step.id !== moved.id)
        : ordered.filter(step => !step.parentId && step.id !== moved.id);
      if (!candidates.length) { noDrop('Brak innych kroków do przestawienia'); return; }
      const next = candidates.find(step => relativeY < center(step.id));
      const target = next ?? candidates[candidates.length - 1];
      const position: 'before' | 'after' = next ? 'before' : 'after';
      const preview = reorderRoutineStep(ordered, moved.id, target.id, position);
      gesture.preview = preview;
      moveRows(gesture, preview, dx, dy);
      const changed = preview.some((step, i) => step.id !== ordered[i]?.id);
      setDropHint(changed
        ? { id: moved.id, action: 'reorder', targetId: target.id, markerId: target.id, position, label: 'Przeciągnij i puść — pozostałe kroki robią miejsce' }
        : { id: moved.id, action: 'none', label: 'Przesuń w górę lub w dół' });
    };

    const tickScroll = () => {
      scrollFrame = 0;
      if (!session?.active || !modal) return;
      const rect = modal.getBoundingClientRect();
      const y = session.lastY;
      let velocity = 0;
      if (y >= rect.top && y <= rect.bottom && session.lastX >= rect.left && session.lastX <= rect.right) {
        if (y < rect.top + 48) velocity = -Math.min(12, (rect.top + 48 - y) / 4);
        else if (y > rect.bottom - 48) velocity = Math.min(12, (y - (rect.bottom - 48)) / 4);
      }
      if (velocity) {
        const before = modal.scrollTop;
        modal.scrollTop += velocity;
        if (before !== modal.scrollTop) update(session.lastX, session.lastY);
      }
      scrollFrame = requestAnimationFrame(tickScroll);
    };

    const start = (target: EventTarget | null, x: number, y: number) => {
      if (!(target instanceof Element) || !target.closest('[data-step-drag-handle]')) return;
      const row = target.closest<HTMLElement>('[data-routine-step-id]');
      const id = row?.dataset.routineStepId;
      if (!row || !id || !list.contains(row)) return;
      reset();
      const gesture: DragSession = { id, x, y, lastX: x, lastY: y, listTop: list.getBoundingClientRect().top, active: false, timer: null, preview: [] };
      session = gesture;
      gesture.timer = setTimeout(() => {
        if (session !== gesture) return;
        gesture.active = true;
        gesture.preview = orderRoutineSteps(stepsRef.current);
        list.classList.add('routine-gesture-active');
        if (navigator.vibrate) navigator.vibrate(12);
        update(x, y);
        scrollFrame = requestAnimationFrame(tickScroll);
      }, 420);
    };
    const move = (x: number, y: number, prevent?: () => void) => {
      if (!session) return;
      if (!session.active) {
        if (Math.hypot(x - session.x, y - session.y) > 12) reset();
        return;
      }
      prevent?.();
      update(x, y);
    };
    const finish = (prevent?: () => void) => {
      if (!session) return;
      if (!session.active) { reset(); return; }
      prevent?.();
      const drop = hintRef.current;
      const current = orderRoutineSteps(stepsRef.current);
      const dragged = session.id;
      if (drop?.action === 'nest' && drop.targetId) onChangeRef.current(placeRoutineStep(current, dragged, drop.targetId));
      else if (drop?.action === 'unnest') onChangeRef.current(unnestRoutineStep(current, dragged));
      else if (drop?.action === 'reorder') onChangeRef.current(session.preview);
      reset(true);
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
      if (touch) move(touch.clientX, touch.clientY, () => { if (event.cancelable) event.preventDefault(); });
    };
    const touchEnd = (event: TouchEvent) => {
      if (touchId === null) return;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === touchId);
      if (touch) finish(() => { if (event.cancelable) event.preventDefault(); });
    };
    const mouseStart = (event: MouseEvent) => { if (event.button === 0) start(event.target, event.clientX, event.clientY); };
    const mouseMove = (event: MouseEvent) => {
      if (session && (event.buttons & 1) === 0) { reset(); return; }
      move(event.clientX, event.clientY, () => event.preventDefault());
    };
    const mouseEnd = () => finish();
    const cancel = () => reset();
    list.addEventListener('touchstart', touchStart, { passive: true });
    list.addEventListener('touchmove', touchMove, { passive: false });
    list.addEventListener('touchend', touchEnd, { passive: false });
    list.addEventListener('touchcancel', cancel);
    list.addEventListener('mousedown', mouseStart);
    window.addEventListener('mousemove', mouseMove);
    window.addEventListener('mouseup', mouseEnd);
    return () => {
      reset();
      if (cleanupFrame) cancelAnimationFrame(cleanupFrame);
      list.removeEventListener('touchstart', touchStart);
      list.removeEventListener('touchmove', touchMove);
      list.removeEventListener('touchend', touchEnd);
      list.removeEventListener('touchcancel', cancel);
      list.removeEventListener('mousedown', mouseStart);
      window.removeEventListener('mousemove', mouseMove);
      window.removeEventListener('mouseup', mouseEnd);
    };
  }, []);

  return { listRef, hint };
}
