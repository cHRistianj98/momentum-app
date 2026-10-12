import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import { dateKey, mondayOf, monthTitle, parseDate, shiftDate, todayKey } from '../lib/date';

const WEEKDAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const isValidDate = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && dateKey(parseDate(value)) === value;
const startOfMonth = (key: string) => {
  const d = parseDate(key);
  return dateKey(new Date(d.getFullYear(), d.getMonth(), 1));
};
const nextMonth = (key: string, delta: number) => {
  const d = parseDate(key);
  return dateKey(new Date(d.getFullYear(), d.getMonth() + delta, 1));
};

interface DatePickerProps {
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
}

/** Popover in a portal: not clipped by modals with overflow-y: auto. */
export function DatePicker({ value, onChange, placeholder = 'Wybierz datę' }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => startOfMonth(isValidDate(value) ? value : todayKey()));
  const [position, setPosition] = useState({ top: 0, left: 0, above: false, maxHeight: 450 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const today = todayKey();

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(318, Math.max(260, window.innerWidth - 24));
    const maxLeft = window.innerWidth - width - 12;
    const left = Math.max(12, Math.min(rect.left, maxLeft));
    const belowSpace = window.innerHeight - rect.bottom - 12;
    const aboveSpace = rect.top - 12;
    const above = belowSpace < 355 && aboveSpace > belowSpace;
    const maxHeight = Math.min(450, Math.max(170, above ? aboveSpace : belowSpace));
    setPosition({ top: above ? rect.top - 8 : rect.bottom + 8, left, above, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  const days = useMemo(() => {
    const first = mondayOf(month);
    const year = parseDate(month).getFullYear();
    const m = parseDate(month).getMonth();
    const last = dateKey(new Date(year, m + 1, 0));
    const weeks = Math.ceil((Math.round((parseDate(last).getTime() - parseDate(first).getTime()) / 86_400_000) + 1) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => shiftDate(first, i));
  }, [month]);

  const select = (date: string | null) => { onChange(date); setOpen(false); triggerRef.current?.focus(); };
  const formatSelected = value && isValidDate(value)
    ? new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }).format(parseDate(value))
    : placeholder;

  return <>
    <button type="button" ref={triggerRef} className={`momentum-date-trigger ${open ? 'is-open' : ''} ${!value ? 'is-empty' : ''}`}
      aria-label="Wybierz datę zadania" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { if (!open) setMonth(startOfMonth(isValidDate(value) ? value : today)); setOpen(v => !v); }}>
      <CalendarDays size={17} aria-hidden="true" />
      <span>{formatSelected}</span>
      <ChevronDown size={15} aria-hidden="true" />
    </button>
    {open && createPortal(
      <div ref={popoverRef} role="dialog" aria-label="Wybierz datę" className={`momentum-date-popover ${position.above ? 'is-above' : ''}`}
        style={{ top: position.top, left: position.left, maxHeight: position.maxHeight }}>
        <div className="momentum-date-header">
          <div><span className="momentum-date-kicker">ZAPLANUJ ZADANIE</span><strong>{monthTitle(month)}</strong></div>
          <div className="momentum-date-nav">
            <button type="button" title="Poprzedni miesiąc" aria-label="Poprzedni miesiąc" onClick={() => setMonth(m => nextMonth(m, -1))}><ChevronLeft size={18} /></button>
            <button type="button" title="Następny miesiąc" aria-label="Następny miesiąc" onClick={() => setMonth(m => nextMonth(m, 1))}><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="momentum-date-weekdays">{WEEKDAYS.map(d => <span key={d}>{d}</span>)}</div>
        <div className="momentum-date-grid">{days.map(d => {
          const inMonth = parseDate(d).getMonth() === parseDate(month).getMonth();
          const selected = d === value;
          return <button type="button" key={d} className={`momentum-date-day ${!inMonth ? 'outside' : ''} ${selected ? 'selected' : ''} ${d === today ? 'today' : ''}`}
            aria-pressed={selected} aria-label={new Intl.DateTimeFormat('pl-PL', { dateStyle: 'full' }).format(parseDate(d))}
            onClick={() => select(d)}>{parseDate(d).getDate()}{selected && <Check size={9} aria-hidden="true" />}</button>;
        })}</div>
        <div className="momentum-date-footer">
          <button type="button" onClick={() => select(null)}><X size={14} /> Wyczyść</button>
          <button type="button" className="momentum-date-today" onClick={() => { setMonth(startOfMonth(today)); select(today); }}><RotateCcw size={14} /> Dziś</button>
        </div>
      </div>, document.body)}
  </>;
}
