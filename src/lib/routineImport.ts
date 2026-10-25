import type { Routine, RoutineStep } from '../types';

export interface RoutineTransfer {
  format: 'momentum-routine';
  schemaVersion: 1;
  createdAt: string;
  routine: Routine;
}

const object = (input: unknown): input is Record<string, unknown> =>
  typeof input === 'object' && input !== null && !Array.isArray(input);
const weekdaysValid = (input: unknown): input is number[] =>
  Array.isArray(input) && input.every(d => Number.isInteger(d) && d >= 0 && d <= 6);

/** Routine-only import; unlike importing Momentum backup, this never replaces the whole app state. */
export function parseRoutineTransfer(json: string): Routine {
  if (new Blob([json]).size > 300_000) throw new Error('Plik rutyny jest zbyt duży (maksymalnie 300 KB).');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('To nie jest poprawny plik JSON.'); }
  if (!object(value) || value.format !== 'momentum-routine' || value.schemaVersion !== 1 || !object(value.routine)) {
    throw new Error('Nieobsługiwany plik. Wybierz plik „momentum-routine” w wersji 1.');
  }
  const r = value.routine;
  if (typeof r.id !== 'string' || !r.id || typeof r.title !== 'string' || !r.title.trim()
    || typeof r.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)
    || !Number.isFinite(r.duration) || Number(r.duration) < 15 || Number(r.duration) > 1440
    || !weekdaysValid(r.weekdays) || r.weekdays.length < 1
    || !Array.isArray(r.steps) || r.steps.length === 0 || r.steps.length > 200
    || (r.category !== 'unpaid' && r.category !== 'income' && r.category !== 'potential')) {
    throw new Error('Plik zawiera nieprawidłowy harmonogram rutyny.');
  }
  const ids = new Set<string>();
  const steps: RoutineStep[] = r.steps.map((item: unknown) => {
    if (!object(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)
      || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 150
      || (item.parentId !== undefined && typeof item.parentId !== 'string')
      || (item.weekdays !== undefined && !weekdaysValid(item.weekdays))
      || (item.timerSeconds !== undefined && (typeof item.timerSeconds !== 'number' || !Number.isInteger(item.timerSeconds) || item.timerSeconds < 1 || item.timerSeconds > 3600))) {
      throw new Error('Plik zawiera nieprawidłowy lub powtórzony krok rutyny.');
    }
    ids.add(item.id);
    return {
      id: item.id,
      title: item.title.trim(),
      ...(typeof item.parentId === 'string' ? { parentId: item.parentId } : {}),
      ...(Array.isArray(item.weekdays) ? { weekdays: [...item.weekdays] } : {}),
      ...(typeof item.timerSeconds === 'number' ? { timerSeconds: item.timerSeconds } : {}),
    };
  });
  for (const step of steps) {
    if (step.parentId && (!ids.has(step.parentId) || step.parentId === step.id)) {
      throw new Error(`Krok „${step.title}” wskazuje nieistniejącego rodzica.`);
    }
    if (step.parentId && steps.find(parent => parent.id === step.parentId)?.parentId) {
      throw new Error('Plik ma więcej niż jeden poziom podzadań.');
    }
  }
  return {
    id: r.id, title: r.title.trim(), description: typeof r.description === 'string' ? r.description : '',
    icon: typeof r.icon === 'string' ? r.icon : 'sun',
    category: r.category, time: r.time, duration: Number(r.duration),
    weekdays: [...r.weekdays], steps,
    xp: typeof r.xp === 'number' && Number.isFinite(r.xp) ? Math.max(0, r.xp) : 40,
    active: r.active !== false,
  };
}

const keyOf = (title: string): string => title.normalize('NFKC').toLocaleLowerCase('pl').replace(/[^\p{L}\p{N}]/gu, '');

/** Preserve the existing routine id, checked step IDs and history for matching steps. */
export function replaceRoutineKeepingIdentity(existing: Routine, incoming: Routine): Routine {
  const oldByName = new Map<string, string[]>();
  existing.steps.forEach(step => {
    const key = keyOf(step.title);
    oldByName.set(key, [...(oldByName.get(key) ?? []), step.id]);
  });
  const ids = new Map<string, string>();
  const used = new Set<string>();
  for (const step of incoming.steps) {
    const candidates = oldByName.get(keyOf(step.title)) ?? [];
    const matching = candidates.find(id => !used.has(id));
    const id = matching ?? step.id;
    ids.set(step.id, id);
    used.add(id);
  }
  const steps = incoming.steps.map(step => ({
    ...step,
    id: ids.get(step.id)!,
    ...(step.parentId ? { parentId: ids.get(step.parentId) } : {}),
  }));
  return {
    ...incoming,
    id: existing.id,
    xp: existing.xp,
    image: existing.image,
    steps,
  };
}
