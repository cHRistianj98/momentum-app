import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { dateKey, mondayOf, monthTitle, parseDate, shiftDate, todayKey } from '../lib/date';

interface MiniMonthPickerProps {
  selectedDate: string;
  scheduledDates: ReadonlySet<string>;
  onSelectWeek: (date: string) => void;
  /** 'day' podświetla wybrany dzień zamiast całego tygodnia (np. widok dnia na telefonie). */
  selection?: 'week' | 'day';
  /** Własna zawartość przycisku otwierającego (np. tytuł z datą w mobilnym pasku). */
  triggerContent?: React.ReactNode;
  triggerClassName?: string;
  triggerLabel?: string;
}

const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];

function startOfMonth(date: string): string {
  const d = parseDate(date);
  return dateKey(new Date(d.getFullYear(), d.getMonth(), 1));
}

function shiftMonth(monthStart: string, months: number): string {
  const d = parseDate(monthStart);
  return dateKey(new Date(d.getFullYear(), d.getMonth() + months, 1));
}

function weekLabel(start: string): string {
  const end = shiftDate(start, 6);
  const first = parseDate(start);
  const last = parseDate(end);
  const fmt = (date: Date) => new Intl.DateTimeFormat('pl-PL', { month: 'short' }).format(date);
  return first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()
    ? `${first.getDate()}–${last.getDate()} ${fmt(last)} ${last.getFullYear()}`
    : `${first.getDate()} ${fmt(first)} – ${last.getDate()} ${fmt(last)} ${last.getFullYear()}`;
}

export function MiniMonthPicker({ selectedDate, scheduledDates, onSelectWeek, selection = 'week', triggerContent, triggerClassName, triggerLabel }: MiniMonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [shownMonth, setShownMonth] = useState(() => startOfMonth(selectedDate));
  const [hoveredWeek, setHoveredWeek] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const today = todayKey();
  const selectedWeek = mondayOf(selectedDate);
  const daySelection = selection === 'day';

  const calendarDays = useMemo(() => {
    // Always show complete Monday–Sunday weeks, including days from adjacent months.
    const first = mondayOf(shownMonth);
    const lastDate = parseDate(shownMonth);
    const daysInMonth = new Date(lastDate.getFullYear(), lastDate.getMonth() + 1, 0).getDate();
    const lastDay = dateKey(new Date(lastDate.getFullYear(), lastDate.getMonth(), daysInMonth));
    const weeks = Math.ceil((Math.round((parseDate(lastDay).getTime() - parseDate(first).getTime()) / 86_400_000) + 1) / 7);
    return Array.from({ length: weeks * 7 }, (_, index) => shiftDate(first, index));
  }, [shownMonth]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        rootRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  function choose(date: string) {
    onSelectWeek(date);
    setShownMonth(startOfMonth(date));
    setOpen(false);
  }

  return (
    <div className={`mini-month-picker ${daySelection ? 'mini-month-picker--day' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`${triggerClassName ?? 'mini-month-trigger'} ${open ? `${triggerClassName ?? 'mini-month-trigger'}--active` : ''}`}
        aria-label={triggerLabel ?? 'Wybierz tydzień z kalendarza miesięcznego'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) setShownMonth(startOfMonth(selectedDate));
          setOpen(value => !value);
        }}
      >
        {triggerContent ?? <>
          <CalendarDays size={16} aria-hidden="true" />
          <span>Wybierz tydzień</span>
          <ChevronDown size={14} aria-hidden="true" />
        </>}
      </button>

      {open && (
        <div className="mini-month-popover" role="dialog" aria-label={daySelection ? 'Wybór dnia' : 'Wybór tygodnia'} onMouseLeave={() => setHoveredWeek(null)}>
          <div className="mini-month-header">
            <div>
              <span className="mini-month-kicker">SZYBKA NAWIGACJA</span>
              <h3>{monthTitle(shownMonth)}</h3>
            </div>
            <div className="mini-month-nav">
              <button type="button" aria-label="Poprzedni miesiąc" onClick={() => setShownMonth(month => shiftMonth(month, -1))}><ChevronLeft size={17} /></button>
              <button type="button" aria-label="Następny miesiąc" onClick={() => setShownMonth(month => shiftMonth(month, 1))}><ChevronRight size={17} /></button>
            </div>
          </div>
          <div className="mini-month-weekdays" aria-hidden="true">
            {WEEKDAYS.map(name => <span key={name}>{name}</span>)}
          </div>
          <div className="mini-month-grid" aria-label={daySelection ? 'Wybierz dzień' : 'Wybierz dzień należący do tygodnia'}>
            {calendarDays.map(date => {
              const inMonth = parseDate(date).getMonth() === parseDate(shownMonth).getMonth();
              const currentWeek = mondayOf(date);
              const isSelectedWeek = !daySelection && currentWeek === selectedWeek;
              const isHoveredWeek = !daySelection && currentWeek === hoveredWeek;
              const isToday = date === today;
              const weekDay = (parseDate(date).getDay() + 6) % 7;
              return (
                <button
                  type="button"
                  key={date}
                  className={[
                    'mini-month-day',
                    !inMonth ? 'mini-month-day--outside' : '',
                    isSelectedWeek ? 'mini-month-day--week' : '',
                    isHoveredWeek ? 'mini-month-day--hover-week' : '',
                    isToday ? 'mini-month-day--today' : '',
                    date === selectedDate ? 'mini-month-day--selected' : '',
                    weekDay === 0 ? 'mini-month-day--monday' : '',
                    weekDay === 6 ? 'mini-month-day--sunday' : '',
                  ].filter(Boolean).join(' ')}
                  aria-label={daySelection ? `${date} — pokaż ten dzień` : `${date} — wybierz tydzień ${weekLabel(currentWeek)}`}
                  aria-pressed={daySelection ? date === selectedDate : isSelectedWeek}
                  onMouseEnter={() => setHoveredWeek(currentWeek)}
                  onFocus={() => setHoveredWeek(currentWeek)}
                  onClick={() => choose(date)}
                  title={daySelection ? `Pokaż ${date}` : `Przejdź do tygodnia ${weekLabel(currentWeek)}`}
                >
                  <span className="mini-month-day-number">{parseDate(date).getDate()}</span>
                  {scheduledDates.has(date) && <span className="mini-month-task-dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <div className="mini-month-footer">
            {daySelection
              ? <span><span className="mini-month-legend-dot" /> Wybrany dzień: <strong>{new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'long' }).format(parseDate(selectedDate))}</strong></span>
              : <span><span className="mini-month-legend-dot" /> Wybrany tydzień: <strong>{weekLabel(selectedWeek)}</strong></span>}
            <button type="button" onClick={() => choose(today)}>Dziś</button>
          </div>
        </div>
      )}
    </div>
  );
}
