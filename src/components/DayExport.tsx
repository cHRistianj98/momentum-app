import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, ClipboardCopy, Download, Share2, X } from 'lucide-react';
import { buildDailyReality, type ActualOverrides } from '../lib/planReality';
import { buildDayExport, parseDayExportOptions, type DayExportOptions } from '../lib/dayExport';
import { mondayOf, parseDate, shiftDate, todayKey } from '../lib/date';
import { weekDates } from '../lib/weeklyReview';
import { readMomentumKey, saveMomentumKey } from '../lib/offlineDatabase';
import { resolveCategories } from '../lib/storage';
import type { AppData } from '../types';
import type { FocusRecord } from '../lib/focus';

const OPTIONS_KEY = 'momentum.day-export.v1';
const WEEKDAY_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];
const OPTION_LABELS: [keyof DayExportOptions, string][] = [
  ['includeOpen', 'Niewykonane'],
  ['includeSteps', 'Kroki i podzadania'],
  ['includeNotes', 'Notatki'],
  ['includePrompt', 'Prośba o ocenę dla AI'],
];

function weekLabel(start: string): string {
  const first = parseDate(start);
  const last = parseDate(shiftDate(start, 6));
  const long = (date: Date, withYear: boolean) => new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', ...(withYear ? { year: 'numeric' } : {}) }).format(date);
  return first.getMonth() === last.getMonth() ? `${first.getDate()}–${long(last, true)}` : `${long(first, false)} – ${long(last, true)}`;
}
/** Domyślnie wszystkie dni tygodnia do dziś włącznie (przyszłych nie da się wybrać). */
const pastDays = (start: string, today: string) => weekDates(start).filter(date => date <= today);

/** Kopiowanie bez Clipboard API (starsze przeglądarki, brak HTTPS). */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;';
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { copied = false; }
  area.remove();
  return copied;
}

type Props = {
  data: AppData;
  focusHistory: FocusRecord[];
  overrides: ActualOverrides;
  /** Tydzień otwarty w Weekly Review (poniedziałek). */
  initialWeek: string;
  onClose: () => void;
};

/** Tekstowy eksport wybranych dni: plan, wykonanie, kroki rutyn i kolory kategorii — do skopiowania. */
export function DayExportDialog({ data, focusHistory, overrides, initialWeek, onClose }: Props) {
  const today = todayKey();
  const currentMonday = mondayOf(today);
  const [weekStart, setWeekStart] = useState(() => mondayOf(initialWeek) > currentMonday ? currentMonday : mondayOf(initialWeek));
  const [selected, setSelected] = useState<string[]>(() => pastDays(mondayOf(initialWeek) > currentMonday ? currentMonday : mondayOf(initialWeek), today));
  const [options, setOptions] = useState<DayExportOptions>(() => {
    try { return parseDayExportOptions(readMomentumKey(OPTIONS_KEY)); } catch { return parseDayExportOptions(null); }
  });
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual' | 'shared'>('idle');
  const dialogRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => weekDates(weekStart), [weekStart]);
  const categories = useMemo(() => resolveCategories(data.categories), [data.categories]);
  const weekStats = useMemo(() => buildDailyReality(data, focusHistory, overrides, days), [data, focusHistory, overrides, days]);
  const text = useMemo(() => buildDayExport({ data, categories, dates: selected, options, focusHistory, overrides }), [data, categories, selected, options, focusHistory, overrides]);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const sortedSelection = [...selected].sort();

  useEffect(() => {
    try { saveMomentumKey(OPTIONS_KEY, JSON.stringify(options)); }
    catch { /* Ustawienia eksportu są wygodą — bez zapisu działa tak samo. */ }
  }, [options]);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  // Klawiatura na czas otwarcia okna: Escape zamyka (także gdy fokus wypadł na <body>),
  // a skróty aplikacji (np. „N” — nowe zadanie) nie działają pod spodem.
  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    if (status !== 'copied' && status !== 'shared') return;
    const timeout = window.setTimeout(() => setStatus('idle'), 2600);
    return () => window.clearTimeout(timeout);
  }, [status]);

  const changeWeek = (delta: number) => {
    const next = shiftDate(weekStart, delta * 7);
    if (next > currentMonday) return;
    setWeekStart(next);
    setSelected(pastDays(next, today));
    setStatus('idle');
  };
  const toggleDay = (date: string) => {
    setSelected(current => current.includes(date) ? current.filter(item => item !== date) : [...current, date]);
    setStatus('idle');
  };
  const choose = (dates: string[]) => { setSelected(dates.filter(date => date <= today)); setStatus('idle'); };
  const selectPreview = () => {
    const node = previewRef.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  async function copy() {
    if (!text) return;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true; }
    } catch { copied = false; }
    if (!copied) copied = legacyCopy(text);
    if (copied) setStatus('copied');
    else { selectPreview(); setStatus('manual'); }
  }
  async function share() {
    if (!text || !canShare) return;
    try { await navigator.share({ title: 'Momentum — eksport dni', text }); setStatus('shared'); }
    catch { /* Anulowanie arkusza udostępniania to nie błąd. */ }
  }
  function download() {
    if (!text) return;
    const first = sortedSelection[0];
    const last = sortedSelection[sortedSelection.length - 1];
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `momentum-${first}${last !== first ? `_${last}` : ''}.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  const todayInWeek = days.includes(today);
  return createPortal(<div className="modal-backdrop dx-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="modal dx-modal" role="dialog" aria-modal="true" aria-labelledby="dx-title" tabIndex={-1}>
      <div className="modal-heading dx-heading">
        <div><span className="eyebrow eyebrow--indigo">TEKST DO SKOPIOWANIA</span><h2 id="dx-title">Eksport dni</h2></div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Zamknij"><X size={20}/></button>
      </div>
      <p className="dx-intro">Zaznacz dni — powstanie tekst z planem i wykonaniem, krokami rutyn i kolorem kategorii. Gotowy do wklejenia np. do ChatGPT albo Gemini.</p>

      <div className="dx-week">
        <button type="button" className="dx-week-step" onClick={() => changeWeek(-1)} aria-label="Poprzedni tydzień"><ChevronLeft size={18}/></button>
        <strong>{weekLabel(weekStart)}</strong>
        <button type="button" className="dx-week-step" onClick={() => changeWeek(1)} disabled={weekStart >= currentMonday} aria-label="Następny tydzień"><ChevronRight size={18}/></button>
      </div>
      <div className="dx-days" role="group" aria-label="Dni do eksportu">{days.map((date, index) => {
        const stat = weekStats[index];
        const value = parseDate(date);
        const active = selected.includes(date);
        return <button key={date} type="button" className={`dx-day ${active ? 'is-active' : ''} ${date === today ? 'is-today' : ''}`} aria-pressed={active} disabled={date > today}
          onClick={() => toggleDay(date)} title={stat.plannedCount ? `Ukończone ${stat.completedCount} z ${stat.plannedCount}` : 'Brak zaplanowanych pozycji'}>
          <small>{WEEKDAY_SHORT[value.getDay()]}</small>
          <strong>{value.getDate()}.{String(value.getMonth() + 1).padStart(2, '0')}</strong>
          <span>{stat.plannedCount ? `${stat.completedCount}/${stat.plannedCount}` : '—'}</span>
          {active && <i aria-hidden="true"><Check size={10} strokeWidth={3.2}/></i>}
        </button>;
      })}</div>
      <div className="dx-quick">
        <button type="button" onClick={() => choose(days)}>Cały tydzień</button>
        <button type="button" onClick={() => choose(days.slice(0, 5))}>Pn–Pt</button>
        {todayInWeek && <button type="button" onClick={() => choose([today])}>Dziś</button>}
        <button type="button" onClick={() => choose([])}>Wyczyść</button>
      </div>
      <div className="dx-options" role="group" aria-label="Co uwzględnić">{OPTION_LABELS.map(([key, label]) =>
        <button key={key} type="button" className={`dx-option ${options[key] ? 'is-on' : ''}`} aria-pressed={options[key]}
          onClick={() => { setOptions(current => ({ ...current, [key]: !current[key] })); setStatus('idle'); }}>
          <span aria-hidden="true">{options[key] && <Check size={11} strokeWidth={3.2}/>}</span>{label}
        </button>)}
      </div>

      <div ref={previewRef} className={`dx-preview ${text ? '' : 'is-empty'}`} tabIndex={0} aria-label="Podgląd eksportu">{text || 'Zaznacz co najmniej jeden dzień, żeby zobaczyć tekst.'}</div>

      {status === 'manual' && <p className="dx-status is-warn" role="status">Nie udało się skopiować automatycznie — tekst w podglądzie jest zaznaczony, skopiuj go ręcznie.</p>}
      <div className="dx-actions">
        <button type="button" className={`btn btn--primary dx-copy ${status === 'copied' ? 'is-done' : ''}`} disabled={!text} onClick={() => void copy()}>
          {status === 'copied' ? <><Check size={16}/> Skopiowano</> : <><ClipboardCopy size={16}/> Kopiuj tekst</>}
        </button>
        {canShare && <button type="button" className="btn btn--secondary" disabled={!text} onClick={() => void share()}><Share2 size={15}/> {status === 'shared' ? 'Wysłano' : 'Udostępnij'}</button>}
        <button type="button" className="btn btn--secondary" disabled={!text} onClick={download} title="Pobierz jako plik tekstowy"><Download size={15}/> .txt</button>
      </div>
      <small className="dx-foot">{sortedSelection.length ? `Wybrane dni: ${sortedSelection.length}` : 'Nie wybrano dni'} · tekst nie opuszcza urządzenia, dopóki go nie wkleisz lub nie udostępnisz.</small>
    </div>
  </div>, document.body);
}
