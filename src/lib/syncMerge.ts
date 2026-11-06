/**
 * Scalanie trójstronne migawek momentum.* przy synchronizacji w chmurze.
 *
 * Baza to ostatni stan uzgodniony z serwerem. Zmiany z tego urządzenia (local) i z chmury
 * (remote) łączymy po kluczach magazynu, polach obiektów i elementach list z polem `id`
 * (zadania, projekty, rutyny, kroki, kamienie milowe, podzadania, sesje Focus). Logi rutyn
 * są obiektem kluczy „rutyna:dzień”, więc łączą się tak samo jak pola obiektu.
 *
 * Zasady przy prawdziwym konflikcie (obie strony zmieniły TO SAMO miejsce inaczej):
 *  - pole lub wartość prosta: wygrywa nowsza zmiana (`preferLocal`),
 *  - usunięcie kontra edycja: zostaje edycja, żeby nic nie zginęło bez śladu,
 *  - listy wartości prostych (dni tygodnia, przypomnienia, odhaczone kroki): łączenie zbiorów.
 *
 * Moduł jest czysty (bez DOM i magazynu), więc da się go testować w Node.
 */

type PlainObject = Record<string, unknown>;
type Keyed = PlainObject & { id: string };

const MAIN_KEY = 'momentum.v1';

export function isPlainObject(value: unknown): value is PlainObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++) if (!deepEqual(a[index], b[index])) return false;
    return true;
  }
  const left = a as PlainObject;
  const right = b as PlainObject;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(right, key) || !deepEqual(left[key], right[key])) return false;
  }
  return true;
}

function isKeyedArray(value: unknown): value is Keyed[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (!isPlainObject(item) || typeof item.id !== 'string' || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return true;
}

type Primitive = string | number | boolean | null;
function isPrimitiveArray(value: unknown): value is Primitive[] {
  return Array.isArray(value) && value.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item));
}

/** Przypisanie odporne na klucz „__proto__” z danych JSON. */
function assign(target: PlainObject, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

export function mergeValue(base: unknown, local: unknown, remote: unknown, preferLocal: boolean): unknown {
  if (deepEqual(local, remote)) return local;
  if (deepEqual(base, local)) return remote;
  if (deepEqual(base, remote)) return local;
  // Obie strony zmieniły tę wartość, każda inaczej.
  if (local === undefined) return remote;
  if (remote === undefined) return local;
  if (isPlainObject(local) && isPlainObject(remote)) {
    // Dwa różne obiekty z identyfikatorem (np. dwie różne sesje Focus) nie mieszamy pole po polu.
    if (('id' in local || 'id' in remote) && local.id !== remote.id) return preferLocal ? local : remote;
    return mergeObjects(isPlainObject(base) && base.id === local.id ? base : {}, local, remote, preferLocal);
  }
  if (Array.isArray(local) && Array.isArray(remote)) {
    const baseArray = Array.isArray(base) ? base : [];
    if (isKeyedArray(local) && isKeyedArray(remote) && isKeyedArray(baseArray)) return mergeKeyedArrays(baseArray, local, remote, preferLocal);
    if (isPrimitiveArray(local) && isPrimitiveArray(remote) && isPrimitiveArray(baseArray)) return mergeSets(baseArray, local, remote);
  }
  return preferLocal ? local : remote;
}

function mergeObjects(base: PlainObject, local: PlainObject, remote: PlainObject, preferLocal: boolean): PlainObject {
  const result: PlainObject = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])) {
    const value = mergeValue(base[key], local[key], remote[key], preferLocal);
    if (value !== undefined) assign(result, key, value);
  }
  return result;
}

/** Ta sama kolejność wspólnych elementów (dodane i usunięte pomijamy). */
function sameRelativeOrder(a: string[], b: string[]): boolean {
  const inB = new Set(b);
  const inA = new Set(a);
  const left = a.filter(id => inB.has(id));
  const right = b.filter(id => inA.has(id));
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function mergeKeyedArrays(base: Keyed[], local: Keyed[], remote: Keyed[], preferLocal: boolean): Keyed[] {
  const byId = (items: Keyed[]) => new Map(items.map(item => [item.id, item]));
  const baseItems = byId(base);
  const localItems = byId(local);
  const remoteItems = byId(remote);
  const merged = new Map<string, Keyed>();
  for (const id of new Set([...localItems.keys(), ...remoteItems.keys()])) {
    const value = mergeValue(baseItems.get(id), localItems.get(id), remoteItems.get(id), preferLocal);
    if (value !== undefined) merged.set(id, value as Keyed);
  }
  const order = (items: Keyed[]) => items.map(item => item.id).filter(id => merged.has(id));
  const baseOrder = order(base);
  const localOrder = order(local);
  const remoteOrder = order(remote);
  // Zmianę kolejności (np. kroków rutyny) bierzemy od strony, która ją wprowadziła.
  const remoteLeads = !sameRelativeOrder(remoteOrder, baseOrder) && sameRelativeOrder(localOrder, baseOrder);
  const result = remoteLeads ? [...remoteOrder] : [...localOrder];
  const other = remoteLeads ? localOrder : remoteOrder;
  const placed = new Set(result);
  other.forEach((id, index) => {
    if (placed.has(id)) return;
    // Nowy element trafia przed swojego następnika z tej samej listy, a bez niego na koniec.
    let position = result.length;
    for (let next = index + 1; next < other.length; next++) {
      const at = result.indexOf(other[next]);
      if (at >= 0) { position = at; break; }
    }
    result.splice(position, 0, id);
    placed.add(id);
  });
  return result.map(id => merged.get(id)!);
}

function mergeSets(base: Primitive[], local: Primitive[], remote: Primitive[]): Primitive[] {
  const inBase = new Set(base);
  const inLocal = new Set(local);
  const inRemote = new Set(remote);
  const seen = new Set<Primitive>();
  const result: Primitive[] = [];
  for (const value of [...local, ...remote]) {
    if (seen.has(value)) continue;
    seen.add(value);
    // Element z bazy zostaje, jeśli nikt go nie usunął; nowy — jeśli dodała go którakolwiek strona.
    if (!inBase.has(value) || (inLocal.has(value) && inRemote.has(value))) result.push(value);
  }
  const ascending = (items: Primitive[]) => items.every((item, index) =>
    typeof item === 'number' && (index === 0 || (items[index - 1] as number) <= item));
  if (local.length && remote.length && ascending(local) && ascending(remote)) result.sort((a, b) => (a as number) - (b as number));
  return result;
}

/** Po scaleniu: logi usuniętych rutyn i powiązania z usuniętymi projektami nie mają już sensu. */
function repairAppData(data: PlainObject): PlainObject {
  const next: PlainObject = { ...data };
  if (Array.isArray(next.routines) && isPlainObject(next.routineLogs)) {
    const routineIds = new Set(next.routines.filter(isPlainObject).map(routine => routine.id).filter(id => typeof id === 'string'));
    next.routineLogs = Object.fromEntries(Object.entries(next.routineLogs)
      .filter(([key]) => key.includes(':') && routineIds.has(key.slice(0, key.lastIndexOf(':')))));
  }
  if (Array.isArray(next.tasks) && Array.isArray(next.projects)) {
    const projects = new Map(next.projects.filter(isPlainObject).map(project => [project.id, project]));
    next.tasks = next.tasks.map(task => {
      if (!isPlainObject(task) || typeof task.projectId !== 'string') return task;
      const project = projects.get(task.projectId);
      if (!project) return { ...task, projectId: null, milestoneId: null };
      const milestones = Array.isArray(project.milestones) ? project.milestones : [];
      if (typeof task.milestoneId === 'string' && !milestones.some(milestone => isPlainObject(milestone) && milestone.id === task.milestoneId)) {
        return { ...task, milestoneId: null };
      }
      return task;
    });
  }
  return next;
}

function parseJson(text: string | undefined): { ok: true; value: unknown } | { ok: false } {
  if (text === undefined) return { ok: true, value: undefined };
  try { return { ok: true, value: JSON.parse(text) as unknown }; }
  catch { return { ok: false }; }
}

/** Jeden klucz zmieniony po obu stronach: scalamy wartości JSON, a gdy to niemożliwe — wygrywa nowsza zmiana. */
function mergeEncoded(key: string, base: string | undefined, local: string, remote: string, preferLocal: boolean): string {
  const parsedBase = parseJson(base);
  const parsedLocal = parseJson(local);
  const parsedRemote = parseJson(remote);
  if (!parsedLocal.ok || !parsedRemote.ok) return preferLocal ? local : remote;
  let merged = mergeValue(parsedBase.ok ? parsedBase.value : undefined, parsedLocal.value, parsedRemote.value, preferLocal);
  if (key === MAIN_KEY && isPlainObject(merged)) merged = repairAppData(merged);
  // Ten sam stan co po jednej ze stron: zostawiamy jej oryginalny zapis (identyczny odcisk danych).
  if (deepEqual(merged, parsedLocal.value)) return local;
  if (deepEqual(merged, parsedRemote.value)) return remote;
  return JSON.stringify(merged);
}

/**
 * Łączy trzy migawki magazynu (klucz → zapisany tekst). `preferLocal` rozstrzyga prawdziwe
 * konflikty: true, gdy ostatnia zmiana na tym urządzeniu jest nowsza niż wersja w chmurze.
 */
export function mergeStorage(
  base: Record<string, string>, local: Record<string, string>, remote: Record<string, string>, preferLocal: boolean,
): Record<string, string> {
  const result: Record<string, string> = {};
  const keys = [...new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])].sort();
  for (const key of keys) {
    const b = base[key];
    const l = local[key];
    const r = remote[key];
    let value: string | undefined;
    if (l === r) value = l;
    else if (l === b) value = r;
    else if (r === b) value = l;
    else if (l === undefined) value = r;
    else if (r === undefined) value = l;
    else value = mergeEncoded(key, b, l, r, preferLocal);
    if (value !== undefined) assign(result, key, value);
  }
  return result;
}
