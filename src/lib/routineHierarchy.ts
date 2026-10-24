import type { RoutineStep } from '../types';

/** Flat storage preserves original step IDs and daily routineLogs.
 * `parentId` is optional, with only one nesting level supported. */
export function orderRoutineSteps(steps: RoutineStep[]): RoutineStep[] {
  const ids = new Set(steps.map(step => step.id));
  const roots = steps.filter(step => !step.parentId || !ids.has(step.parentId) || step.parentId === step.id);
  const output: RoutineStep[] = [];
  const used = new Set<string>();
  for (const root of roots) {
    if (used.has(root.id)) continue;
    output.push({ ...root, parentId: undefined });
    used.add(root.id);
    for (const child of steps) {
      if (child.parentId !== root.id || used.has(child.id)) continue;
      output.push(child);
      used.add(child.id);
    }
  }
  // Flatten malformed old/nested references rather than dropping steps.
  for (const step of steps) if (!used.has(step.id)) output.push({ ...step, parentId: undefined });
  return output;
}

export function toggleRoutineStepBranch(steps: RoutineStep[], checked: string[], stepId: string): string[] {
  const selected = new Set(checked);
  const nextDone = !selected.has(stepId);
  const children = steps.filter(step => step.parentId === stepId).map(step => step.id);
  for (const id of [stepId, ...children]) {
    if (nextDone) selected.add(id);
    else selected.delete(id);
  }
  const changed = steps.find(step => step.id === stepId);
  if (changed?.parentId) {
    const siblings = steps.filter(step => step.parentId === changed.parentId);
    if (siblings.length && siblings.every(step => selected.has(step.id))) selected.add(changed.parentId);
    else selected.delete(changed.parentId);
  }
  return [...selected];
}

/** Change parent while keeping its children adjacent, without losing any IDs. */
export function placeRoutineStep(steps: RoutineStep[], draggedId: string, parentId: string | null, beforeId?: string): RoutineStep[] {
  const ordered = orderRoutineSteps(steps);
  const dragged = ordered.find(step => step.id === draggedId);
  if (!dragged) return ordered;
  if (parentId === draggedId) return ordered;
  const descendants = ordered.filter(step => step.parentId === draggedId);
  if (parentId && descendants.length) return ordered; // one-level rule
  const parent = ordered.find(step => step.id === parentId);
  if (parentId && (!parent || parent.parentId)) return ordered;

  const block = [dragged, ...descendants].map((step, i) => i === 0 ? { ...step, parentId: parentId ?? undefined } : step);
  const remaining = ordered.filter(step => !block.some(item => item.id === step.id));
  if (parent) {
    const group = remaining.filter(step => step.id === parent.id || step.parentId === parent.id);
    const insertAt = remaining.indexOf(group[group.length - 1]) + 1;
    remaining.splice(insertAt, 0, ...block);
  } else if (beforeId) {
    const index = remaining.findIndex(step => step.id === beforeId);
    remaining.splice(index >= 0 ? index : remaining.length, 0, ...block);
  } else {
    remaining.push(...block);
  }
  return orderRoutineSteps(remaining);
}

/** Migrate previously checked parents when a new child gets attached. */
export function checkedWithParentPropagation(steps: RoutineStep[], checked: string[]): string[] {
  const result = new Set(checked);
  for (const step of steps) if (step.parentId && result.has(step.parentId)) result.add(step.id);
  return [...result];
}

/** Promote a child after the original parent's entire group. */
export function unnestRoutineStep(steps: RoutineStep[], id: string): RoutineStep[] {
  const ordered = orderRoutineSteps(steps);
  const item = ordered.find(step => step.id === id);
  if (!item?.parentId) return ordered;
  const parentIndex = ordered.findIndex(step => step.id === item.parentId);
  const nextRoot = ordered.slice(parentIndex + 1).find(step => !step.parentId);
  return placeRoutineStep(ordered, id, null, nextRoot?.id);
}

/** Sort steps without changing their nesting. A parent moves together with all its children.
 * Children can be sorted only within the same parent; nesting is a separate horizontal gesture.
 */
export function reorderRoutineStep(
  steps: RoutineStep[], draggedId: string, targetId: string, position: 'before' | 'after',
): RoutineStep[] {
  const ordered = orderRoutineSteps(steps);
  const dragged = ordered.find(step => step.id === draggedId);
  const hovered = ordered.find(step => step.id === targetId);
  if (!dragged || !hovered || dragged.id === hovered.id) return ordered;

  if (!dragged.parentId) {
    // Root steps are whole movable groups: keep all children with their parent.
    const targetRootId = hovered.parentId ?? hovered.id;
    if (targetRootId === dragged.id) return ordered;
    const block = ordered.filter(step => step.id === dragged.id || step.parentId === dragged.id);
    const remaining = ordered.filter(step => !block.some(part => part.id === step.id));
    const targetIndex = remaining.findIndex(step => step.id === targetRootId);
    if (targetIndex < 0) return ordered;
    let insertion = targetIndex;
    if (position === 'after') {
      while (insertion < remaining.length &&
        (remaining[insertion].id === targetRootId || remaining[insertion].parentId === targetRootId)) insertion++;
    }
    remaining.splice(insertion, 0, ...block);
    return orderRoutineSteps(remaining);
  }

  // Children can be rearranged after the parent or among their own siblings.
  if (hovered.id !== dragged.parentId && hovered.parentId !== dragged.parentId) return ordered;
  if (hovered.id === dragged.parentId && position === 'before') return ordered;
  const remaining = ordered.filter(step => step.id !== dragged.id);
  const at = remaining.findIndex(step => step.id === hovered.id);
  if (at < 0) return ordered;
  remaining.splice(at + (position === 'after' ? 1 : 0), 0, dragged);
  return orderRoutineSteps(remaining);
}
