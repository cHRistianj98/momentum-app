import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Stoper kroku rutyny (np. „Mycie zębów — 2 min”).
 *
 * Jeden stoper naraz, trzymany poza oknem rutyny: odlicza dalej po zamknięciu okna, a po upływie czasu
 * aplikacja sama odhacza krok (App → useStepTimerRuntime). Czas liczymy od znacznika `endAt`, więc
 * blokada ekranu czy przejście do innej aplikacji nie psują odliczania — po powrocie krok jest już zaliczony.
 */
export interface StepTimer {
  routineId: string;
  /** Dzień z harmonogramu — klucz logu rutyny. */
  sourceDate: string;
  /** Dzień, w którym wystąpienie jest teraz (kroki z harmonogramu tego dnia). */
  date: string;
  stepId: string;
  title: string;
  totalSeconds: number;
  /** Koniec odliczania (ms od epoki), gdy stoper działa; null — wstrzymany. */
  endAt: number | null;
  /** Pozostały czas (ms), gdy stoper jest wstrzymany. */
  remainingMs: number;
}

export type StepTimerTarget = Omit<StepTimer, 'endAt' | 'remainingMs'>;

/** Najdłuższy stoper kroku (tyle samo przyjmuje import pliku rutyny: 1–3600 s). */
export const STEP_TIMER_MAX_SECONDS = 3600;
export const STEP_TIMER_PRESETS = [30, 60, 120, 180, 300, 600];

let current: StepTimer | null = null;
const listeners = new Set<() => void>();

function setStepTimer(next: StepTimer | null): void {
  current = next;
  listeners.forEach(listener => listener());
}

export const getStepTimer = (): StepTimer | null => current;

export function subscribeStepTimer(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Czas trwania stopera kroku w sekundach (dane z importu lub starszych wersji — zawsze w dozwolonym zakresie). */
export function stepTimerSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(STEP_TIMER_MAX_SECONDS, Math.max(1, Math.round(value)));
}

export const isStepTimerFor = (timer: StepTimer | null, routineId: string, sourceDate: string, stepId: string): timer is StepTimer =>
  Boolean(timer && timer.routineId === routineId && timer.sourceDate === sourceDate && timer.stepId === stepId);

export function stepTimerRemainingMs(timer: StepTimer, now = Date.now()): number {
  return timer.endAt === null ? Math.max(0, timer.remainingMs) : Math.max(0, timer.endAt - now);
}

/** Dotknięcie znaczka stopera: start, pauza albo wznowienie. Stoper innego kroku zastępuje poprzedni. */
export function toggleStepTimer(target: StepTimerTarget, now = Date.now()): StepTimer {
  const totalMs = target.totalSeconds * 1000;
  let next: StepTimer;
  if (!isStepTimerFor(current, target.routineId, target.sourceDate, target.stepId)) {
    next = { ...target, endAt: now + totalMs, remainingMs: totalMs };
  } else if (current.endAt !== null) {
    next = { ...current, endAt: null, remainingMs: Math.max(0, current.endAt - now) };
  } else {
    const remaining = current.remainingMs > 0 ? current.remainingMs : totalMs;
    next = { ...current, endAt: now + remaining, remainingMs: remaining };
  }
  setStepTimer(next);
  return next;
}

/** Zatrzymuje stoper (wszystkie albo tylko danej rutyny, opcjonalnie jednego wystąpienia). */
export function resetStepTimer(routineId?: string, sourceDate?: string): void {
  if (!current) return;
  if (routineId && current.routineId !== routineId) return;
  if (sourceDate && current.sourceDate !== sourceDate) return;
  setStepTimer(null);
}

/** Jeśli odliczanie się skończyło: zdejmuje stoper i zwraca go (inaczej null). */
export function takeElapsedStepTimer(now = Date.now()): StepTimer | null {
  const timer = current;
  if (!timer || timer.endAt === null || timer.endAt > now) return null;
  setStepTimer(null);
  return timer;
}

/** „0:30”, „2:00”, „10:00” — odliczanie na znaczku kroku. */
export function formatStepTimer(seconds: number): string {
  const value = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

/** „30 s”, „2 min”, „1 min 30 s” — opis czasu w edytorze i podpowiedziach. */
export function describeStepTimer(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(value / 60);
  const rest = value % 60;
  if (!minutes) return `${rest} s`;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** Krótka etykieta na przycisku w edytorze: „30 s”, „2 min”, „1:30”. */
export function shortStepTimer(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  if (value < 60) return `${value} s`;
  return value % 60 ? formatStepTimer(value) : `${value / 60} min`;
}

// ---------- dźwięk końca odliczania ----------
let audio: AudioContext | null = null;

/** Odblokowuje dźwięk w Safari — wywołaj w obsłudze dotknięcia (start stopera). */
export function primeStepTimerSound(): void {
  try {
    if (typeof window === 'undefined' || typeof window.AudioContext !== 'function') return;
    audio ??= new window.AudioContext();
    if (audio.state === 'suspended') void audio.resume().catch(() => {});
  } catch { /* bez dźwięku */ }
}

/** Krótki, łagodny dźwięk (dwa tony) i wibracja tam, gdzie jest dostępna. Tryb cichy w iPhonie wycisza dźwięk. */
export function playStepTimerSound(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate([140, 90, 140]);
  } catch { /* bez wibracji */ }
  try {
    const context = audio;
    if (!context) return;
    if (context.state === 'suspended') void context.resume().catch(() => {});
    const start = context.currentTime + 0.03;
    [880, 1318.51].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const at = start + index * 0.2;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.6);
    });
  } catch { /* bez dźwięku */ }
}

// ---------- React ----------
/** Aktualny stoper i bieżący czas (odświeżany 4× na sekundę, gdy stoper działa). */
export function useStepTimer(): { timer: StepTimer | null; now: number } {
  const timer = useSyncExternalStore(subscribeStepTimer, getStepTimer, getStepTimer);
  const [now, setNow] = useState(() => Date.now());
  const running = timer?.endAt ?? null;
  useEffect(() => {
    setNow(Date.now());
    if (running === null) return;
    const handle = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(handle);
  }, [running]);
  return { timer, now };
}

/**
 * Montowane raz (App): pilnuje końca odliczania także przy zamkniętym oknie rutyny i po powrocie
 * do aplikacji, a gdy stoper działa — prosi system, żeby nie wygaszał ekranu (Screen Wake Lock).
 */
export function useStepTimerRuntime(onElapsed: (timer: StepTimer) => void): void {
  const timer = useSyncExternalStore(subscribeStepTimer, getStepTimer, getStepTimer);
  const callback = useRef(onElapsed);
  useEffect(() => { callback.current = onElapsed; });
  const endAt = timer?.endAt ?? null;

  useEffect(() => {
    if (endAt === null) return;
    const finish = () => {
      const elapsed = takeElapsedStepTimer();
      if (elapsed) callback.current(elapsed);
    };
    const handle = window.setTimeout(finish, Math.max(0, endAt - Date.now()) + 40);
    // Po odblokowaniu ekranu lub powrocie z innej aplikacji timeout mógł się spóźnić — sprawdzamy od razu.
    const onVisible = () => { if (document.visibilityState === 'visible') finish(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearTimeout(handle); document.removeEventListener('visibilitychange', onVisible); };
  }, [endAt]);

  useEffect(() => {
    if (endAt === null || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = () => {
      if (sentinel && !sentinel.released) return;
      navigator.wakeLock.request('screen')
        .then(lock => { if (cancelled) void lock.release().catch(() => {}); else sentinel = lock; })
        .catch(() => { /* np. tryb oszczędzania energii — ekran może zgasnąć */ });
    };
    acquire();
    // System zwalnia blokadę po ukryciu strony; po powrocie prosimy o nią ponownie.
    const onVisible = () => { if (document.visibilityState === 'visible' && !cancelled) acquire(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [endAt]);
}
