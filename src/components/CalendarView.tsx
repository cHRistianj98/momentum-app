import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Check, GripVertical, GripHorizontal, Plus } from 'lucide-react';
import { CategoryBadge, TaskVisual } from './VisualIdentity';
import { MiniMonthPicker } from './MiniMonthPicker';
import { fullDate, minuteOfDay, mondayOf, monthTitle, parseDate, shiftDate, shortWeekday, timeFromMinutes, todayKey } from '../lib/date';
import type { CategoryConfig, CategoryKey, IconKey } from '../types';

export interface CalendarBlock {
  id: string;
  kind: 'task' | 'routine';
  sourceId: string;
  title: string;
  icon: IconKey;
  image?: string;
  category: CategoryKey;
  date: string;
  time: string;
  duration: number;
  done: boolean;
}

const START = 0;
const END = 24 * 60;
const HOUR_HEIGHT = 68;
const GRID_HEIGHT = (END - START) / 60 * HOUR_HEIGHT;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface CalendarViewProps {
  referenceDate: string;
  onChangeDate: (date: string) => void;
  blocks: CalendarBlock[];
  categories: CategoryConfig;
  mode: 'day' | 'week';
  onChangeMode: (mode: 'day' | 'week') => void;
  onAddAt: (date: string, time: string) => void;
  onOpenBlock: (block: CalendarBlock) => void;
  onToggleBlock: (block: CalendarBlock) => void;
  onDropBlock: (kind: 'task' | 'routine', id: string, date: string, time: string, sourceDate?: string) => void;
  onResizeBlock: (block: CalendarBlock, duration: number) => void;
  compact?: boolean;
}

interface ResizeSession {
  block: CalendarBlock;
  pointerId: number;
  startY: number;
}

interface PositionedBlock {
  block: CalendarBlock;
  column: number;
  columns: number;
}

function layoutOverlappingBlocks(input: CalendarBlock[]): PositionedBlock[] {
  const blocks = [...input].sort((a, b) => minuteOfDay(a.time) - minuteOfDay(b.time) || (minuteOfDay(b.time) + b.duration) - (minuteOfDay(a.time) + a.duration));
  const positioned: PositionedBlock[] = [];
  let group: CalendarBlock[] = [];
  let groupEnd = -1;

  const flushGroup = () => {
    if (!group.length) return;
    const columnEnds: number[] = [];
    const temp: { block: CalendarBlock; column: number }[] = [];
    for (const block of group) {
      const start = minuteOfDay(block.time);
      const end = start + block.duration;
      let column = columnEnds.findIndex(value => value <= start);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(end);
      } else {
        columnEnds[column] = end;
      }
      temp.push({ block, column });
    }
    const columns = Math.max(1, columnEnds.length);
    temp.forEach(item => positioned.push({ ...item, columns }));
    group = [];
    groupEnd = -1;
  };

  for (const block of blocks) {
    const start = minuteOfDay(block.time);
    const end = start + block.duration;
    if (!group.length) {
      group = [block];
      groupEnd = end;
      continue;
    }
    if (start < groupEnd) {
      group.push(block);
      groupEnd = Math.max(groupEnd, end);
    } else {
      flushGroup();
      group = [block];
      groupEnd = end;
    }
  }
  flushGroup();
  return positioned;
}

export function CalendarView({ referenceDate, onChangeDate, blocks, categories, mode, onChangeMode, onAddAt, onOpenBlock, onToggleBlock, onDropBlock, onResizeBlock, compact = false }: CalendarViewProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [resizePreview, setResizePreview] = useState<{ id: string; duration: number } | null>(null);
  const resizeSession = useRef<ResizeSession | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const morningTop = (7 * HOUR_HEIGHT) - (compact ? 84 : 140);
    if (!el.dataset.positioned || referenceDate === todayKey()) {
      el.scrollTop = Math.max(0, morningTop);
      el.dataset.positioned = '1';
    }
  }, [referenceDate, compact, mode]);

  // Zmiana wielkości odbywa się co 15 minut, zawsze w granicach siatki (pełna doba).
  const proposedDuration = (session: ResizeSession, clientY: number): number => {
    const deltaSteps = Math.round((clientY - session.startY) / HOUR_HEIGHT * 4);
    const maxDuration = END - minuteOfDay(session.block.time);
    return Math.max(15, Math.min(maxDuration, session.block.duration + deltaSteps * 15));
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>, block: CalendarBlock) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    resizeSession.current = { block, pointerId: event.pointerId, startY: event.clientY };
    setResizePreview({ id: block.id, duration: block.duration });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = resizeSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const duration = proposedDuration(session, event.clientY);
    setResizePreview(current => current?.id === session.block.id && current.duration === duration
      ? current : { id: session.block.id, duration });
  };
  const finishResize = (event: React.PointerEvent<HTMLDivElement>, cancel = false) => {
    const session = resizeSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const duration = proposedDuration(session, event.clientY);
    resizeSession.current = null;
    setResizePreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancel && duration !== session.block.duration) onResizeBlock(session.block, duration);
  };

  const dates = useMemo(() => {
    if (mode === 'day') return [referenceDate];
    const first = mondayOf(referenceDate);
    return Array.from({ length: 7 }, (_, i) => shiftDate(first, i));
  }, [referenceDate, mode]);

  const change = (direction: number) => onChangeDate(shiftDate(referenceDate, direction * (mode === 'week' ? 7 : 1)));
  const scheduledDates = useMemo(() => new Set(blocks.map(block => block.date)), [blocks]);
  const header = mode === 'day'
    ? fullDate(referenceDate)
    : `${parseDate(dates[0]).getDate()} ${new Intl.DateTimeFormat('pl-PL', { month: 'short' }).format(parseDate(dates[0]))} – ${parseDate(dates[6]).getDate()} ${monthTitle(dates[6])}`;
  const today = todayKey();

  const getTimeFromPosition = (event: React.DragEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>, element: HTMLDivElement): string => {
    const rect = element.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    const min = Math.min(END - 15, START + Math.round((y / HOUR_HEIGHT * 60) / 15) * 15);
    return timeFromMinutes(min);
  };

  return (
    <section className={`calendar-panel ${compact ? 'calendar-panel--compact' : ''}`}>
      <div className="calendar-toolbar">
        <div className="calendar-heading">
          <div className="eyebrow"><CalendarDays size={14} /> TWÓJ HARMONOGRAM</div>
          <h2>{header}</h2>
        </div>
        <div className="calendar-actions">
          <MiniMonthPicker selectedDate={referenceDate} scheduledDates={scheduledDates} onSelectWeek={date => { onChangeDate(date); onChangeMode('week'); }} />
          <div className="view-switch" aria-label="Widok kalendarza">
            <button className={mode === 'day' ? 'active' : ''} onClick={() => onChangeMode('day')}>Dzień</button>
            <button className={mode === 'week' ? 'active' : ''} onClick={() => onChangeMode('week')}>Tydzień</button>
          </div>
          <button className="btn btn--secondary btn--today" onClick={() => onChangeDate(today)}>Dziś</button>
          <div className="calendar-arrows">
            <button aria-label="Poprzedni" onClick={() => change(-1)}><ChevronLeft size={18} /></button>
            <button aria-label="Następny" onClick={() => change(1)}><ChevronRight size={18} /></button>
          </div>
        </div>
      </div>
      <div className="calendar-scroll" ref={scrollRef}>
        <div className={`calendar-body ${mode === 'day' ? 'calendar-body--day' : ''}`} style={{ minWidth: mode === 'week' ? 980 : 520 }}>
          <div className="calendar-head" style={{ gridTemplateColumns: `66px repeat(${dates.length}, minmax(0, 1fr))` }}>
            <div className="timezone">LOKALNIE</div>
            {dates.map(d => (
              <div className={`calendar-head-day ${d === today ? 'is-today' : ''}`} key={d}>
                <span>{shortWeekday(d)}</span><strong>{parseDate(d).getDate()}</strong>
              </div>
            ))}
          </div>
          <div className="calendar-grid" style={{ gridTemplateColumns: `66px repeat(${dates.length}, minmax(0, 1fr))` }}>
            <div className="time-gutter" style={{ height: GRID_HEIGHT }}>
              {HOURS.map((h, i) => <span className="time-label" style={{ top: i * HOUR_HEIGHT }} key={h}>{String(h).padStart(2, '0')}:00</span>)}
            </div>
            {dates.map(d => {
              const todaysBlocks = layoutOverlappingBlocks(blocks.filter(b => b.date === d && minuteOfDay(b.time) >= START && minuteOfDay(b.time) < END));
              const now = new Date();
              const nowMinutes = now.getHours() * 60 + now.getMinutes();
              return (
                <div
                  className={`day-lane ${d === today ? 'day-lane--today' : ''} ${hovered === d ? 'day-lane--hover' : ''}`}
                  style={{ height: GRID_HEIGHT, backgroundSize: `100% ${HOUR_HEIGHT}px` }} key={d}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setHovered(d); }}
                  onDragLeave={() => setHovered(null)}
                  onDrop={e => {
                    e.preventDefault(); setHovered(null);
                    const raw = e.dataTransfer.getData('application/momentum') || e.dataTransfer.getData('text/plain');
                    try {
                      const item = JSON.parse(raw) as { kind: 'task' | 'routine'; id: string; sourceDate?: string };
                      if (item.kind === 'task' || item.kind === 'routine') onDropBlock(item.kind, item.id, d, getTimeFromPosition(e, e.currentTarget), item.sourceDate);
                    } catch { /* ignore drops coming from other apps */ }
                  }}
                  onClick={e => {
                    if (e.target === e.currentTarget) onAddAt(d, getTimeFromPosition(e, e.currentTarget));
                  }}
                  title="Kliknij, aby zaplanować zadanie • Przeciągnij zadanie, aby zmienić termin"
                >
                  {d === today && nowMinutes >= START && nowMinutes < END && (
                    <div className="now-line" style={{ top: ((nowMinutes - START) / 60) * HOUR_HEIGHT }}><span /></div>
                  )}
                  {todaysBlocks.map(({ block, column, columns }) => {
                    const style = categories[block.category] ?? categories.unpaid;
                    const displayDuration = resizePreview?.id === block.id ? resizePreview.duration : block.duration;
                    const top = ((minuteOfDay(block.time) - START) / 60) * HOUR_HEIGHT;
                    const height = Math.max(32, Math.min(displayDuration, END - minuteOfDay(block.time)) / 60 * HOUR_HEIGHT - 3);
                    const laneGap = 8;
                    const eventWidth = `calc(${100 / columns}% - ${laneGap}px)`;
                    const eventLeft = `calc(${(100 / columns) * column}% + ${laneGap / 2}px)`;
                    return (
                      <div
                        className={`calendar-event ${block.done ? 'calendar-event--done' : ''} ${height < 62 ? 'calendar-event--small' : ''} ${resizePreview?.id === block.id ? 'calendar-event--resizing' : ''}`}
                        draggable={block.kind === 'task' && resizePreview?.id !== block.id}
                        onDragStart={e => {
                          if (resizeSession.current) { e.preventDefault(); return; }
                          e.stopPropagation();
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('application/momentum', JSON.stringify({ kind: block.kind, id: block.sourceId, sourceDate: block.date }));
                          e.dataTransfer.setData('text/plain', JSON.stringify({ kind: block.kind, id: block.sourceId, sourceDate: block.date }));
                        }}
                        onClick={e => { e.stopPropagation(); onOpenBlock(block); }}
                        style={{ top, height, left: eventLeft, width: eventWidth, zIndex: 2 + column, '--event-color': style.color, '--event-tint': style.tint } as React.CSSProperties}
                        title={`${block.title} • ${block.time} • ${block.duration} min`}
                        key={block.id}
                      >
                        <div className="event-body">
                          <TaskVisual icon={block.icon} image={block.image} category={block.category} categories={categories} className="event-visual" size="small" />
                          <div className="event-text"><strong>{block.title}</strong><small>{block.time} · {displayDuration} min</small></div>
                          <button
                            className={`event-check ${block.done ? 'checked' : ''}`}
                            aria-label={block.done ? 'Oznacz jako niewykonane' : 'Oznacz jako wykonane'}
                            title={block.kind === 'routine' ? 'Otwórz kroki rutyny' : 'Zmień status'}
                            onClick={e => { e.stopPropagation(); onToggleBlock(block); }}
                          ><Check size={13} strokeWidth={3} /></button>
                        </div>
                        {height > 105 && <CategoryBadge category={block.category} categories={categories} compact className="event-footer-badge" />}
                        {height > 65 && block.kind === 'task' && <GripVertical className="event-grip" size={12} />}
                        <div
                          className="event-resize-handle"
                          role="slider"
                          tabIndex={0}
                          aria-label={`Zmień długość bloku ${block.title}`}
                          aria-valuenow={displayDuration}
                          aria-valuemin={15}
                          aria-valuemax={END - minuteOfDay(block.time)}
                          aria-valuetext={`${displayDuration} minut`}
                          title="Złap i przeciągnij, aby zmienić czas trwania (co 15 minut)"
                          draggable={false}
                          onDragStart={e => { e.preventDefault(); e.stopPropagation(); }}
                          onClick={e => e.stopPropagation()}
                          onPointerDown={e => startResize(e, block)}
                          onPointerMove={moveResize}
                          onPointerUp={e => finishResize(e)}
                          onPointerCancel={e => finishResize(e, true)}
                          onKeyDown={e => {
                            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                            e.preventDefault(); e.stopPropagation();
                            const next = Math.max(15, Math.min(END - minuteOfDay(block.time), block.duration + (e.key === 'ArrowDown' ? 15 : -15)));
                            if (next !== block.duration) onResizeBlock(block, next);
                          }}
                        ><GripHorizontal size={15} aria-hidden="true" /></div>
                      </div>
                    );
                  })}
                  {hovered === d && <div className="drop-cue"><Plus size={15} /> Upuść, aby zaplanować</div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="calendar-footer"><span className="legend-dot" /> Kliknij puste miejsce, aby dodać zadanie. Przeciągnij blok, aby go przenieść, albo złap dolną krawędź, by zmienić jego długość. <span className="footnote">Widok 24h · czas lokalny</span></div>
    </section>
  );
}
