import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, CalendarClock, CalendarX2, Check, ChevronLeft, ChevronRight, CornerUpLeft, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { TimePicker } from './FormControls';
import { dateKey, fullDate, mondayOf, monthTitle, parseDate, shiftDate, todayKey } from '../lib/date';
import { daysBetween, shortDayLabel } from '../lib/recurrence';

export type MoveKind = 'routine' | 'series' | 'task';

/** O ile dni od terminu z harmonogramu można przenieść wystąpienie — tyle obejmują widoki kalendarza i listy dnia. */
export const MAX_OCCURRENCE_SHIFT = 42;
const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase('pl-PL') + value.slice(1);
const startOfMonth = (date: string) => { const value = parseDate(date); return dateKey(new Date(value.getFullYear(), value.getMonth(), 1)); };
const addMonths = (month: string, delta: number) => { const value = parseDate(month); return dateKey(new Date(value.getFullYear(), value.getMonth() + delta, 1)); };
const DAY_SHORT = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'so'];
/** „pt 7.11”. */
const chipDate = (date: string) => { const value = parseDate(date); return `${DAY_SHORT[value.getDay()]} ${value.getDate()}.${String(value.getMonth() + 1).padStart(2, '0')}`; };

type Chip = { id: string; label: string; date: string; time?: string | null };

type ModalProps = {
  kind: MoveKind;
  title: string;
  /** Obecny dzień i godzina (po ewentualnym wcześniejszym przeniesieniu). */
  date: string;
  time: string | null;
  /** Wystąpienie rutyny lub serii: dzień z harmonogramu i godzina z szablonu. */
  sourceDate?: string;
  originalTime?: string;
  /** Godziny innych wystąpień tej samej rutyny/serii w danym dniu — ostrzeżenie o dwóch terminach. */
  otherTimesOn?: (date: string) => string[];
  onMove: (date: string, time: string | null) => void;
  onClose: () => void;
};

/** Przeniesienie jednego terminu na inny dzień (i opcjonalnie inną godzinę). */
export function MoveOccurrenceModal({ kind, title, date, time, sourceDate, originalTime, otherTimesOn, onMove, onClose }: ModalProps) {
  const today = todayKey();
  const anchor = sourceDate ?? date;
  const occurrence = kind !== 'task';
  const inRange = (candidate: string) => !occurrence || Math.abs(daysBetween(anchor, candidate)) <= MAX_OCCURRENCE_SHIFT;
  // Domyślnie: dziś, gdy termin już minął (nadrabianie), w przeciwnym razie dzień później.
  const [target, setTarget] = useState(() => [date < today ? today : shiftDate(date, 1), shiftDate(date, 1), shiftDate(date, -1)].find(inRange) ?? date);
  const [targetTime, setTargetTime] = useState<string | null>(time);
  const [month, setMonth] = useState(() => startOfMonth(target));
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  // Escape zamyka tylko to okno (nie okno zadania pod spodem); otwarta lista godzin zamyka się pierwsza.
  useEffect(() => {
    // Fokus w oknie: pisanie nie trafia do pól okna zadania pod spodem, a na iPhonie chowa się klawiatura.
    dialogRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.momentum-control-popover')) return;
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const moved = Boolean(sourceDate && (date !== sourceDate || (originalTime && time !== originalTime)));
  const chips = (() => {
    const list: Chip[] = [
      ...(moved && sourceDate ? [{ id: 'original', label: 'Pierwotny termin', date: sourceDate, time: originalTime ?? time }] : []),
      { id: 'previous', label: 'Dzień wcześniej', date: shiftDate(date, -1) },
      { id: 'next', label: 'Dzień później', date: shiftDate(date, 1) },
      { id: 'today', label: 'Dziś', date: today },
      { id: 'tomorrow', label: 'Jutro', date: shiftDate(today, 1) },
    ];
    const seen = new Set<string>();
    return list.filter(chip => {
      if (chip.id !== 'original' && (chip.date === date || seen.has(chip.date))) return false;
      if (!inRange(chip.date)) return false;
      seen.add(chip.date);
      return true;
    }).slice(0, 4);
  })();
  const days = useMemo(() => {
    const first = mondayOf(month);
    const value = parseDate(month);
    const last = dateKey(new Date(value.getFullYear(), value.getMonth() + 1, 0));
    const count = Math.ceil((daysBetween(first, last) + 1) / 7) * 7;
    return Array.from({ length: count }, (_, index) => shiftDate(first, index));
  }, [month]);
  const choose = (next: string, nextTime?: string | null) => {
    setTarget(next);
    if (nextTime !== undefined) setTargetTime(nextTime);
    setMonth(startOfMonth(next));
  };
  const unchanged = target === date && targetTime === time;
  const valid = inRange(target) && (!occurrence || Boolean(targetTime));
  const others = (otherTimesOn?.(target) ?? []).filter(Boolean);
  const nounWhere = kind === 'routine' ? 'rutyny' : 'serii';
  const whenLabel = (day: string, at: string | null) => `${shortDayLabel(day, today)}${at ? `, ${at}` : ''}`;

  return createPortal(<div className="modal-backdrop move-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="modal move-modal" role="dialog" aria-modal="true" aria-labelledby="move-title" tabIndex={-1}>
      <div className="modal-heading move-heading">
        <div><span className="eyebrow eyebrow--indigo"><CalendarClock size={13}/> {kind === 'task' ? 'ZADANIE' : kind === 'routine' ? 'RUTYNA · JEDNO WYSTĄPIENIE' : 'ZADANIE CYKLICZNE · JEDNO WYSTĄPIENIE'}</span>
          <h2 id="move-title">Przenieś na inny dzień</h2></div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Zamknij"><X size={20}/></button>
      </div>
      <div className="move-body">
        <div className="routine-move-summary move-summary">
          <div><small>TERAZ</small><strong>{capitalize(fullDate(date))}</strong><span>{time ?? 'bez godziny'}</span></div>
          <ArrowRight size={20}/>
          <div className={unchanged ? 'is-same' : ''}><small>NOWY TERMIN</small><strong>{capitalize(fullDate(target))}</strong><span>{targetTime ?? 'bez godziny'}</span></div>
        </div>
        {others.length > 0 && <p className="move-warning" role="status"><TriangleAlert size={15}/> <span>Tego dnia jest już „{title}” ({others.join(', ')}). Po przeniesieniu w kalendarzu będą oba terminy.</span></p>}
        <p className="move-title-line"><strong>{title}</strong>{occurrence && <> — zmieni się tylko ten jeden termin, pozostałe terminy {nounWhere} zostają bez zmian.</>}</p>

        {chips.length > 0 && <div className="move-chips" role="group" aria-label="Szybki wybór dnia">{chips.map(chip =>
          <button key={chip.id} type="button" className={`move-chip ${chip.date === target && (chip.time === undefined || chip.time === targetTime) ? 'is-active' : ''} ${chip.id === 'original' ? 'is-original' : ''}`}
            onClick={() => choose(chip.date, chip.time)}>
            {chip.id === 'original' && <CornerUpLeft size={14}/>}<span>{chip.label}</span><small>{chipDate(chip.date)}</small>
          </button>)}
        </div>}

        <div className="move-calendar">
          <div className="move-calendar-head">
            <strong>{monthTitle(month)}</strong>
            <div className="momentum-date-nav">
              <button type="button" aria-label="Poprzedni miesiąc" onClick={() => setMonth(current => addMonths(current, -1))}><ChevronLeft size={18}/></button>
              <button type="button" aria-label="Następny miesiąc" onClick={() => setMonth(current => addMonths(current, 1))}><ChevronRight size={18}/></button>
            </div>
          </div>
          <div className="momentum-date-weekdays">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
          <div className="momentum-date-grid">{days.map(day => {
            const outside = parseDate(day).getMonth() !== parseDate(month).getMonth();
            const selected = day === target;
            return <button key={day} type="button" disabled={!inRange(day)}
              className={`momentum-date-day ${outside ? 'outside' : ''} ${selected ? 'selected' : ''} ${day === today ? 'today' : ''} ${day === date ? 'is-current' : ''}`}
              aria-pressed={selected} aria-label={`${capitalize(fullDate(day))}${day === date ? ' (obecny termin)' : ''}`} onClick={() => choose(day)}>
              {parseDate(day).getDate()}{selected && <Check size={9} aria-hidden="true"/>}
            </button>;
          })}</div>
          {occurrence && <small className="move-range-note">Można przenieść do {MAX_OCCURRENCE_SHIFT / 7} tygodni od pierwotnego terminu.</small>}
        </div>

        <div className="move-time">
          <span>Godzina</span>
          <TimePicker value={targetTime} allowClear={kind === 'task'} onChange={value => setTargetTime(occurrence ? value ?? targetTime : value)}/>
        </div>
      </div>
      <div className="move-actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>Anuluj</button>
        <button type="button" className="btn btn--primary move-confirm" disabled={unchanged || !valid} onClick={() => { onMove(target, targetTime); onClose(); }}>
          <CalendarClock size={16}/> Przenieś na {whenLabel(target, targetTime)}
        </button>
      </div>
    </div>
  </div>, document.body);
}

type BarProps = {
  /** „To wystąpienie” albo „Termin”. */
  label: string;
  date: string;
  time: string | null;
  /** Pierwotny termin, gdy wystąpienie zostało już przeniesione. */
  movedFrom?: { date: string; time: string } | null;
  note?: string;
  onMove: () => void;
  /** Usunięcie tylko tego wystąpienia rutyny lub zadania cyklicznego (reszta bez zmian). */
  onDelete?: () => void;
};

/** Pasek z terminem i przyciskami „Przenieś” (oraz „Usuń to wystąpienie”) w oknach rutyny i zadania. */
export function OccurrenceBar({ label, date, time, movedFrom, note, onMove, onDelete }: BarProps) {
  const move = <button type="button" className="occurrence-bar-move" onClick={onMove}><CalendarClock size={15}/> Przenieś</button>;
  return <div className={`occurrence-bar ${onDelete ? 'occurrence-bar--actions' : ''}`}>
    <span className="occurrence-bar-icon" aria-hidden="true"><CalendarClock size={18}/></span>
    <div className="occurrence-bar-main">
      <small>{label}</small>
      <strong>{capitalize(fullDate(date))} <span>· {time ?? 'bez godziny'}</span></strong>
      {movedFrom && <em>Przeniesione z: {fullDate(movedFrom.date)}, {movedFrom.time}</em>}
      {note && <em>{note}</em>}
    </div>
    {onDelete
      ? <div className="occurrence-bar-actions">
        {move}
        <button type="button" className="occurrence-bar-delete" onClick={onDelete} title="Usuwa tylko ten jeden termin — pozostałe zostają bez zmian">
          <CalendarX2 size={15}/> Usuń to wystąpienie
        </button>
      </div>
      : move}
  </div>;
}

/** Okno otwarte dla wystąpienia, które usunięto z planu (np. z karty rutyny albo starego powiadomienia). */
export function SkippedOccurrenceBar({ date, hint, onRestore }: { date: string; hint?: string; onRestore: () => void }) {
  return <div className="occurrence-bar occurrence-bar--skipped">
    <span className="occurrence-bar-icon" aria-hidden="true"><CalendarX2 size={18}/></span>
    <div className="occurrence-bar-main">
      <small>Usunięte z planu</small>
      <strong>{capitalize(fullDate(date))}</strong>
      {hint && <em>{hint}</em>}
    </div>
    <button type="button" className="occurrence-bar-move occurrence-bar-restore" onClick={onRestore}><RotateCcw size={15}/> Przywróć</button>
  </div>;
}

/** Usunięte pojedyncze wystąpienia (od dziś) — dotknięcie przywraca dzień do planu. */
export function SkippedOccurrences({ dates, onRestore }: { dates: string[]; onRestore: (sourceDate: string) => void }) {
  const today = todayKey();
  if (!dates.length) return null;
  return <div className="skipped-occurrences">
    <span className="skipped-occurrences-title"><CalendarX2 size={14}/> Usunięte wystąpienia</span>
    <div className="skipped-occurrences-list">
      {dates.map(date => <button key={date} type="button" className="skipped-chip" onClick={() => onRestore(date)}
        aria-label={`Przywróć: ${fullDate(date)}`} title="Przywróć to wystąpienie">
        <span>{shortDayLabel(date, today)}</span><RotateCcw size={13} aria-hidden="true"/>
      </button>)}
    </div>
    <small>Dotknij dzień, aby przywrócić go do planu. Pozostałe terminy się nie zmieniają.</small>
  </div>;
}
