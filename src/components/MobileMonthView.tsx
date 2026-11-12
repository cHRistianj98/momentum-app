import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TaskVisual } from './VisualIdentity';
import type { CalendarBlock } from './CalendarView';
import type { CategoryConfig } from '../types';
import { parseDate, todayKey } from '../lib/date';
import { locale, pick, tr } from '../lib/i18n';

type Props = {
  referenceDate: string;
  blocks: CalendarBlock[];
  categories: CategoryConfig;
  onChangeDate: (date: string) => void;
  onOpenDate: (date: string) => void;
};
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

export function MobileMonthView({ referenceDate, blocks, categories, onChangeDate, onOpenDate }: Props) {
  const month = useMemo(() => {
    const ref = parseDate(referenceDate);
    const first = new Date(ref.getFullYear(), ref.getMonth(), 1, 12);
    const start = new Date(first);
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    const count = Math.ceil(((new Date(ref.getFullYear(), ref.getMonth()+1, 0).getDate()) + (first.getDay()+6)%7)/7)*7;
    return { ref, dates: Array.from({length: count}, (_, i) => { const d = new Date(start); d.setDate(start.getDate()+i); return key(d); }) };
  }, [referenceDate]);
  const byDate = useMemo(() => {
    const grouped = new Map<string, CalendarBlock[]>();
    blocks.forEach(b => grouped.set(b.date, [...(grouped.get(b.date) ?? []), b]));
    grouped.forEach(items => items.sort((a,b)=>a.time.localeCompare(b.time)));
    return grouped;
  }, [blocks]);
  const changeMonth = (delta: number) => {
    const d = new Date(month.ref.getFullYear(), month.ref.getMonth()+delta, 1, 12);
    onChangeDate(key(d));
  };
  return <section className="momentum-month" aria-label={tr('Kalendarz miesięczny', 'Monthly calendar')}>
    <div className="momentum-month-toolbar">
      <button type="button" className="momentum-month-title" onClick={() => onChangeDate(todayKey())} title={tr('Wróć do bieżącego miesiąca', 'Back to the current month')}>
        {new Intl.DateTimeFormat(locale(),{month:'long',year:'numeric'}).format(month.ref)}
      </button>
      <div className="momentum-month-arrows"><button type="button" aria-label={tr('Poprzedni miesiąc', 'Previous month')} onClick={()=>changeMonth(-1)}><ChevronLeft size={18}/></button><button type="button" aria-label={tr('Następny miesiąc', 'Next month')} onClick={()=>changeMonth(1)}><ChevronRight size={18}/></button></div>
    </div>
    <div className="momentum-month-weekdays">{pick(['Pon','Wt','Śr','Czw','Pt','Sob','Nd'], ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']).map(d=><span key={d}>{d}</span>)}</div>
    <div className="momentum-month-grid">
      {month.dates.map(date=> {
        const list=byDate.get(date) ?? [];
        const isCurrent=parseDate(date).getMonth()===month.ref.getMonth();
        const visible=list.slice(0,4);
        return <div className={`momentum-month-cell ${isCurrent?'':'is-outside'} ${date===todayKey()?'is-today':''}`} key={date}>
          <button type="button" className="momentum-month-date" onClick={()=>onOpenDate(date)} aria-label={tr(`Otwórz ${date}`, `Open ${date}`)}>{parseDate(date).getDate()}</button>
          <div className="momentum-month-events">{visible.map(b=> <button type="button" key={b.id} className={`momentum-month-event ${b.done?'is-done':''}`} style={{'--mini-color':categories[b.category]?.color ?? '#7666e8','--mini-tint':categories[b.category]?.tint ?? '#eeeaff'} as React.CSSProperties} onClick={()=>onOpenDate(date)} title={`${b.time} ${b.title}`}>
            <TaskVisual icon={b.icon} image={b.image} category={b.category} categories={categories} size="mini" className="momentum-month-icon"/><span>{b.title}</span>
          </button>)}{list.length>visible.length&&<button type="button" className="momentum-month-more" onClick={()=>onOpenDate(date)}>+{list.length-visible.length}</button>}</div>
        </div>;
      })}
    </div>
    <p className="momentum-month-help">{tr('Dotknij dnia lub zadania, aby przejść do planu dnia.', 'Tap a day or task to open the day plan.')}</p>
  </section>;
}
