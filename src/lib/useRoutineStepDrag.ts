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
  source: 'pointer' | 'touch';
  identifier: number;
  id: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  initialScrollTop: number;
  active: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  preview: RoutineStep[];
  grip: HTMLElement;
};

/**
 * Sortable routine template steps. Only the grip starts a drag, so form inputs
 * and the weekday picker retain their normal touch/scroll behaviour.
 *
 * iOS Safari can cancel Pointer Events when the scrollable modal handles a
 * touch. We therefore handle Touch Events separately and prevent the native
 * gesture *from touchstart on the grip*. Mouse/pen retain Pointer Events.
 * The DOM order is stable during dragging; rows are moved visually using FLIP-
 * like transforms and the new step order is committed only on release.
 */
export function useRoutineStepDrag(steps: RoutineStep[], onChange: (steps: RoutineStep[]) => void) {
  const listRef = useRef<HTMLDivElement>(null);
  const currentSteps = useRef(steps);
  const changeRef = useRef(onChange);
  const dropRef = useRef<DropHint | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);
  currentSteps.current = steps;
  changeRef.current = onChange;

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const modal = list.closest<HTMLElement>('.modal');
    let session: DragSession | null = null;
    let autoScrollFrame = 0;
    let clearFrame = 0;
    let previousHint: DropHint | null = null;

    const rows = () => Array.from(list.querySelectorAll<HTMLElement>('[data-routine-step-id]'));
    const cleanupTransforms = () => {
      for (const row of rows()) {
        row.style.removeProperty('transform');
        row.style.removeProperty('transition');
        row.style.removeProperty('z-index');
        row.style.removeProperty('will-change');
      }
    };
    const stop = (afterCommit = false) => {
      const old = session;
      if (old?.timer) clearTimeout(old.timer);
      session = null;
      if (autoScrollFrame) cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = 0;
      previousHint = null;
      dropRef.current = null;
      setHint(null);
      list.classList.remove('routine-gesture-active');
      if (clearFrame) cancelAnimationFrame(clearFrame);
      // React must render the committed order before dropping visual transforms.
      if (afterCommit) {
        clearFrame = requestAnimationFrame(() => {
          clearFrame = requestAnimationFrame(() => { clearFrame = 0; cleanupTransforms(); });
        });
      } else cleanupTransforms();
      if (old?.source === 'pointer' && old.grip.hasPointerCapture(old.identifier)) {
        try { old.grip.releasePointerCapture(old.identifier); } catch { /* pointer already released */ }
      }
    };
    const setDrop = (next: DropHint) => {
      dropRef.current = next;
      if (previousHint && previousHint.id === next.id && previousHint.action === next.action &&
        previousHint.targetId === next.targetId && previousHint.markerId === next.markerId &&
        previousHint.position === next.position && previousHint.label === next.label) return;
      previousHint = next;
      setHint(next);
    };

    // The list stays in the old DOM order until the finger is released.
    // Put each row in the slot it will occupy after the drop. Neighbours slide
    // out of the way while the dragged row follows the finger directly.
    const renderPositions = (gesture: DragSession, ordered: RoutineStep[], dx: number, dy: number) => {
      const dom = rows();
      const byId = new Map(dom.map(row => [row.dataset.routineStepId!, row]));
      const moving = new Set([gesture.id, ...gesture.preview.filter(s => s.parentId === gesture.id).map(s => s.id)]);
      const rowGap = parseFloat(getComputedStyle(list).rowGap) || 0;
      let nextTop = dom[0]?.offsetTop ?? 0;
      const scrollDelta = (modal?.scrollTop ?? 0) - gesture.initialScrollTop;
      for (const step of ordered) {
        const row = byId.get(step.id);
        if (!row) continue;
        const dragged = moving.has(step.id);
        const x = dragged ? Math.max(-54, Math.min(54, dx)) : 0;
        const y = dragged ? dy + scrollDelta : nextTop - row.offsetTop;
        row.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        row.style.transition = dragged ? 'none' : 'transform 170ms cubic-bezier(.2,.8,.2,1)';
        row.style.zIndex = dragged ? '40' : '1';
        row.style.willChange = 'transform';
        nextTop += row.offsetHeight + rowGap;
      }
    };

    const update = () => {
      const drag = session;
      if (!drag?.active) return;
      const ordered = orderRoutineSteps(currentSteps.current);
      const moving = ordered.find(step => step.id === drag.id);
      if (!moving) { stop(); return; }
      const dx = drag.x - drag.startX;
      const dy = drag.y - drag.startY;
      const dom = rows();
      const byId = new Map(dom.map(row => [row.dataset.routineStepId!, row]));
      const movingRow = byId.get(moving.id);
      if (!movingRow) { stop(); return; }
      const scrollDelta = (modal?.scrollTop ?? 0) - drag.initialScrollTop;
      // offsetTop is not affected by transforms, so the threshold never
      // oscillates while neighbouring rows animate.
      const centerY = movingRow.offsetTop + movingRow.offsetHeight / 2 + dy + scrollDelta;
      const underFingerY = drag.y - list.getBoundingClientRect().top;
      const excluded = new Set([moving.id, ...ordered.filter(s => s.parentId === moving.id).map(s => s.id)]);
      const underFinger = dom.find(row => !excluded.has(row.dataset.routineStepId!) &&
        underFingerY >= row.offsetTop && underFingerY <= row.offsetTop + row.offsetHeight);
      const hoveredStep = ordered.find(step => step.id === underFinger?.dataset.routineStepId);

      const display = (preview: RoutineStep[], next: DropHint) => {
        drag.preview = preview;
        renderPositions(drag, preview, dx, dy);
        setDrop(next);
      };
      if (dx < -45 && moving.parentId) {
        display(ordered, { id: moving.id, action: 'unnest', label: 'Odłącz od rodzica' });
        return;
      }
      if (dx > 45) {
        const parent = hoveredStep?.parentId ? ordered.find(s => s.id === hoveredStep.parentId) : hoveredStep;
        if (parent && parent.id !== moving.id && !ordered.some(s => s.parentId === moving.id)) {
          display(ordered, { id: moving.id, action: 'nest', targetId: parent.id, label: `Podzadanie: ${parent.title || 'krok'}` });
        } else display(ordered, { id: moving.id, action: 'none', label: 'Przesuń w prawo na krok nadrzędny' });
        return;
      }

      const siblings = moving.parentId
        ? ordered.filter(s => s.parentId === moving.parentId && s.id !== moving.id)
        : ordered.filter(s => !s.parentId && s.id !== moving.id);
      if (!siblings.length) {
        display(ordered, { id: moving.id, action: 'none', label: 'Brak kroków do przestawienia' });
        return;
      }
      const firstBelow = siblings.find(step => {
        const row = byId.get(step.id);
        return row && centerY < row.offsetTop + row.offsetHeight / 2;
      });
      const target = firstBelow ?? siblings[siblings.length - 1];
      const position: 'before' | 'after' = firstBelow ? 'before' : 'after';
      const next = reorderRoutineStep(ordered, moving.id, target.id, position);
      const changed = next.some((step, index) => step.id !== ordered[index]?.id);
      display(next, changed
        ? { id: moving.id, action: 'reorder', targetId: target.id, markerId: target.id, position, label: 'Puść, aby zapisać kolejność' }
        : { id: moving.id, action: 'none', label: 'Przesuń krok w górę lub w dół' });
    };

    const scrollNearEdge = () => {
      autoScrollFrame = 0;
      if (!session?.active || !modal) return;
      const rect = modal.getBoundingClientRect();
      const { x, y } = session;
      if (x >= rect.left && x <= rect.right) {
        const band = 64;
        const speed = y < rect.top + band ? -Math.min(12, (rect.top + band - y) / 4) :
          y > rect.bottom - band ? Math.min(12, (y - (rect.bottom - band)) / 4) : 0;
        if (speed) {
          const before = modal.scrollTop;
          modal.scrollTop += speed;
          if (modal.scrollTop !== before) update();
        }
      }
      autoScrollFrame = requestAnimationFrame(scrollNearEdge);
    };

    const activate = (drag: DragSession) => {
      if (session !== drag || drag.active) return;
      drag.active = true;
      drag.preview = orderRoutineSteps(currentSteps.current);
      list.classList.add('routine-gesture-active');
      if (typeof navigator.vibrate === 'function') navigator.vibrate(8);
      update();
      autoScrollFrame = requestAnimationFrame(scrollNearEdge);
    };
    const begin = (source: DragSession['source'], identifier: number, grip: HTMLElement, id: string, x: number, y: number) => {
      if (session) return;
      session = {
        source, identifier, id, grip,
        startX: x, startY: y, x, y,
        initialScrollTop: modal?.scrollTop ?? 0,
        active: false, timer: null, preview: [],
      };
      if (source === 'touch') {
        // A short hold works, but moving straight away also works since the
        // grip is a dedicated drag handle, not a scrolling surface.
        const created = session;
        created.timer = setTimeout(() => activate(created), 120);
      } else activate(session);
    };
    const move = (source: DragSession['source'], identifier: number, x: number, y: number) => {
      const drag = session;
      if (!drag || drag.source !== source || drag.identifier !== identifier) return;
      drag.x = x;
      drag.y = y;
      if (!drag.active && Math.hypot(x - drag.startX, y - drag.startY) > 4) activate(drag);
      if (drag.active) update();
    };
    const release = (source: DragSession['source'], identifier: number) => {
      const drag = session;
      if (!drag || drag.source !== source || drag.identifier !== identifier) return;
      if (drag.active) {
        const action = dropRef.current;
        const before = orderRoutineSteps(currentSteps.current);
        let next = before;
        if (action?.action === 'nest' && action.targetId) next = placeRoutineStep(before, drag.id, action.targetId);
        else if (action?.action === 'unnest') next = unnestRoutineStep(before, drag.id);
        else if (action?.action === 'reorder') next = drag.preview;
        const changed = next.some((step, index) => step.id !== before[index]?.id || step.parentId !== before[index]?.parentId);
        if (changed) changeRef.current(next);
        stop(changed);
      } else stop();
    };

    const handleFromTarget = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return null;
      const grip = target.closest<HTMLElement>('[data-step-drag-handle]');
      const row = grip?.closest<HTMLElement>('[data-routine-step-id]');
      return grip && row && list.contains(row) && row.dataset.routineStepId
        ? { grip, id: row.dataset.routineStepId } : null;
    };

    // Touch Events intentionally take priority over Pointer Events on iOS.
    // Prevent native modal scrolling ONLY when the finger starts on ⋮⋮.
    const touchStart = (event: TouchEvent) => {
      const hit = handleFromTarget(event.target);
      if (!hit || session || event.changedTouches.length !== 1) return;
      if (event.cancelable) event.preventDefault();
      const touch = event.changedTouches[0];
      begin('touch', touch.identifier, hit.grip, hit.id, touch.clientX, touch.clientY);
    };
    const findTouch = (event: TouchEvent) => {
      if (!session || session.source !== 'touch') return null;
      return Array.from(event.changedTouches).find(t => t.identifier === session?.identifier) ?? null;
    };
    const touchMove = (event: TouchEvent) => {
      const touch = findTouch(event);
      if (!touch) return;
      if (event.cancelable) event.preventDefault();
      move('touch', touch.identifier, touch.clientX, touch.clientY);
    };
    const touchEnd = (event: TouchEvent) => {
      const touch = findTouch(event);
      if (!touch) return;
      if (event.cancelable) event.preventDefault();
      move('touch', touch.identifier, touch.clientX, touch.clientY);
      release('touch', touch.identifier);
    };
    const touchCancel = (event: TouchEvent) => {
      if (findTouch(event)) stop();
    };
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.button !== 0 || session) return;
      const hit = handleFromTarget(event.target);
      if (!hit) return;
      event.preventDefault();
      try { hit.grip.setPointerCapture(event.pointerId); } catch { /* unsupported capture */ }
      begin('pointer', event.pointerId, hit.grip, hit.id, event.clientX, event.clientY);
    };
    const pointerMove = (event: PointerEvent) => {
      if (session?.source !== 'pointer') return;
      if (event.cancelable) event.preventDefault();
      move('pointer', event.pointerId, event.clientX, event.clientY);
    };
    const pointerUp = (event: PointerEvent) => {
      if (session?.source === 'pointer') {
        move('pointer', event.pointerId, event.clientX, event.clientY);
        release('pointer', event.pointerId);
      }
    };
    const pointerCancel = (event: PointerEvent) => {
      if (session?.source === 'pointer' && session.identifier === event.pointerId) stop();
    };

    list.addEventListener('touchstart', touchStart, { passive: false });
    window.addEventListener('touchmove', touchMove, { passive: false });
    window.addEventListener('touchend', touchEnd, { passive: false });
    window.addEventListener('touchcancel', touchCancel);
    list.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove, { passive: false });
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerCancel);
    return () => {
      stop();
      if (clearFrame) cancelAnimationFrame(clearFrame);
      list.removeEventListener('touchstart', touchStart);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('touchend', touchEnd);
      window.removeEventListener('touchcancel', touchCancel);
      list.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerCancel);
    };
  }, []);

  return { listRef, hint };
}
