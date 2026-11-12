import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { dateKey, mondayOf, monthTitle, parseDate, shiftDate, todayKey } from '../lib/date';
import { locale, pick, tr } from '../lib/i18n';

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

/** Nagłówki kolumn kalendarza od poniedziałku. */
const weekdaysFromMonday = () => pick(['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'], ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);

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
  const fmt = (date: Date) => new Intl.DateTimeFormat(locale(), { month: 'short' }).format(date);
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
        aria-label={triggerLabel ?? tr('Wybierz tydzień z kalendarza miesięcznego', 'Choose a week from the month calendar')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (!open) setShownMonth(startOfMonth(selectedDate));
          setOpen(value => !value);
        }}
      >
        {triggerContent ?? <>
          <CalendarDays size={16} aria-hidden="true" />
          <span>{tr('Wybierz tydzień', 'Choose week')}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </>}
      </button>

      {open && (
        <div className="mini-month-popover" role="dialog" aria-label={daySelection ? tr('Wybór dnia', 'Day picker') : tr('Wybór tygodnia', 'Week picker')} onMouseLeave={() => setHoveredWeek(null)}>
          <div className="mini-month-header">
            <div>
              <span className="mini-month-kicker">{tr('SZYBKA NAWIGACJA', 'QUICK NAVIGATION')}</span>
              <h3>{monthTitle(shownMonth)}</h3>
            </div>
            <div className="mini-month-nav">
              <button type="button" aria-label={tr('Poprzedni miesiąc', 'Previous month')} onClick={() => setShownMonth(month => shiftMonth(month, -1))}><ChevronLeft size={17} /></button>
              <button type="button" aria-label={tr('Następny miesiąc', 'Next month')} onClick={() => setShownMonth(month => shiftMonth(month, 1))}><ChevronRight size={17} /></button>
            </div>
          </div>
          <div className="mini-month-weekdays" aria-hidden="true">
            {weekdaysFromMonday().map(name => <span key={name}>{name}</span>)}
          </div>
          <div className="mini-month-grid" aria-label={daySelection ? tr('Wybierz dzień', 'Choose a day') : tr('Wybierz dzień należący do tygodnia', 'Choose a day in the week')}>
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
                  aria-label={daySelection ? tr(`${date} — pokaż ten dzień`, `${date} — show this day`) : tr(`${date} — wybierz tydzień ${weekLabel(currentWeek)}`, `${date} — choose the week of ${weekLabel(currentWeek)}`)}
                  aria-pressed={daySelection ? date === selectedDate : isSelectedWeek}
                  onMouseEnter={() => setHoveredWeek(currentWeek)}
                  onFocus={() => setHoveredWeek(currentWeek)}
                  onClick={() => choose(date)}
                  title={daySelection ? tr(`Pokaż ${date}`, `Show ${date}`) : tr(`Przejdź do tygodnia ${weekLabel(currentWeek)}`, `Go to the week of ${weekLabel(currentWeek)}`)}
                >
                  <span className="mini-month-day-number">{parseDate(date).getDate()}</span>
                  {scheduledDates.has(date) && <span className="mini-month-task-dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          <div className="mini-month-footer">
            {daySelection
              ? <span><span className="mini-month-legend-dot" /> {tr('Wybrany dzień:', 'Selected day:')} <strong>{new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'long' }).format(parseDate(selectedDate))}</strong></span>
              : <span><span className="mini-month-legend-dot" /> {tr('Wybrany tydzień:', 'Selected week:')} <strong>{weekLabel(selectedWeek)}</strong></span>}
            <button type="button" onClick={() => choose(today)}>{tr('Dziś', 'Today')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
