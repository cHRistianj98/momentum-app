import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Check, GripVertical, GripHorizontal, Plus } from 'lucide-react';
import { CategoryBadge, TaskVisual } from './VisualIdentity';
import { layoutOverlappingEvents } from '../lib/calendarOverlap';
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
  /** Oryginalny dzień cyklicznego wystąpienia, niezależny od ręcznego przesunięcia. */
  occurrenceDate?: string;
  time: string;
  duration: number;
  done: boolean;
}

const START = 0;
const END = 24 * 60;
const HOUR_HEIGHT = 74;
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
interface MoveSession {
  pointerId: number;
  block: CalendarBlock;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  grabOffsetY: number;
  dragging: boolean;
}
interface MovePreview {
  id: string;
  sourceId: string;
  date: string;
  time: string;
  duration: number;
  title: string;
  category: CategoryKey;
}

export function CalendarView({ referenceDate, onChangeDate, blocks, categories, mode, onChangeMode, onAddAt, onOpenBlock, onToggleBlock, onDropBlock, onResizeBlock, compact = false }: CalendarViewProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [resizePreview, setResizePreview] = useState<{ id: string; duration: number } | null>(null);
  const resizeSession = useRef<ResizeSession | null>(null);
  const moveSession = useRef<MoveSession | null>(null);
  const calendarScrollRef = useRef<HTMLDivElement>(null);
  const animationFrame = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const [movePreview, setMovePreview] = useState<MovePreview | null>(null);
  const [externalPreview, setExternalPreview] = useState<{date: string; time: string} | null>(null);
  const [emptyHover, setEmptyHover] = useState<{date: string; time: string} | null>(null);

  // Pełna doba pozostaje dostępna przez przewijanie, a początkowy widok zaczyna się rano.
  useEffect(() => {
    const scroller = calendarScrollRef.current;
    if (!scroller) return;
    scroller.scrollTop = 7 * HOUR_HEIGHT - 120;
  }, [mode, compact]);


  // Pointer-based movement is independent of the browser's native HTML5 drag ghost.
  // Preserve the exact point at which the user grabbed the block, then snap its start to 15 min.
  const previewAt = (session: MoveSession, clientX: number, clientY: number): MovePreview | null => {
    const scroll = calendarScrollRef.current;
    if (!scroll) return null;
    const area = scroll.getBoundingClientRect();
    if (clientX < area.left || clientX > area.right || clientY < area.top || clientY > area.bottom) return null;
    const node = document.elementFromPoint(clientX, clientY);
    let lane = node?.closest<HTMLElement>('.day-lane[data-calendar-date]') ?? null;
    // The sticky weekday header can cover the lane at the top of the scroll area.
    // Resolve the day by its column, so dragging up to 07:00 still works.
    if (!lane || !scroll.contains(lane)) {
      lane = Array.from(scroll.querySelectorAll<HTMLElement>('.day-lane[data-calendar-date]')).find(day => {
        const bounds = day.getBoundingClientRect();
        return clientX >= bounds.left && clientX <= bounds.right;
      }) ?? null;
    }
    if (!lane) return null;
    const date = lane.dataset.calendarDate;
    if (!date) return null;
    const rect = lane.getBoundingClientRect();
    const start = START + Math.round(((clientY - rect.top - session.grabOffsetY) / HOUR_HEIGHT * 60) / 15) * 15;
    const latest = Math.max(START, END - Math.max(15, session.block.duration));
    return {
      id: session.block.id, sourceId: session.block.sourceId, date, time: timeFromMinutes(Math.max(START, Math.min(latest, start))),
      duration: session.block.duration, title: session.block.title, category: session.block.category,
    };
  };

  const updatePreview = (session: MoveSession, x: number, y: number) => {
    session.lastX = x;
    session.lastY = y;
    const next = previewAt(session, x, y);
    setMovePreview(previous => previous?.date === next?.date && previous?.time === next?.time && previous?.id === next?.id ? previous : next);
  };

  const stopAutoScroll = () => {
    if (animationFrame.current !== null) cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
  };
  const autoScroll = () => {
    const session = moveSession.current;
    const scroller = calendarScrollRef.current;
    if (!session?.dragging || !scroller) { animationFrame.current = null; return; }
    const rect = scroller.getBoundingClientRect();
    const { lastX, lastY } = session;
    let velocity = 0;
    if (lastX >= rect.left && lastX <= rect.right && lastY >= rect.top - 18 && lastY <= rect.bottom + 18) {
      if (lastY < rect.top + 52) velocity = -Math.min(17, Math.max(4, (rect.top + 52 - lastY) / 3));
      else if (lastY > rect.bottom - 52) velocity = Math.min(17, Math.max(4, (lastY - (rect.bottom - 52)) / 3));
    }
    if (velocity) {
      const previousScroll = scroller.scrollTop;
      scroller.scrollTop += velocity;
      if (scroller.scrollTop !== previousScroll) updatePreview(session, lastX, lastY);
    }
    animationFrame.current = requestAnimationFrame(autoScroll);
  };

  const startMove = (event: React.PointerEvent<HTMLDivElement>, block: CalendarBlock) => {
    if (event.button !== 0 || resizeSession.current) return;
    if ((event.target as HTMLElement).closest('button, .event-resize-handle')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    moveSession.current = {
      pointerId: event.pointerId, block, startX: event.clientX, startY: event.clientY,
      lastX: event.clientX, lastY: event.clientY,
      grabOffsetY: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveBlock = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = moveSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (!session.dragging && Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 6) return;
    if (!session.dragging) {
      session.dragging = true;
      suppressClick.current = true;
      animationFrame.current = requestAnimationFrame(autoScroll);
    }
    event.preventDefault();
    updatePreview(session, event.clientX, event.clientY);
  };
  const finishMove = (event: React.PointerEvent<HTMLDivElement>, cancel = false) => {
    const session = moveSession.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.stopPropagation();
    // Releasing outside the calendar cancels the move rather than using a stale preview.
    const drop = session.dragging ? previewAt(session, event.clientX, event.clientY) : null;
    moveSession.current = null;
    stopAutoScroll();
    setMovePreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancel && session.dragging && drop && (drop.date !== session.block.date || drop.time !== session.block.time)) {
      onDropBlock(session.block.kind, session.block.sourceId, drop.date, drop.time, session.block.occurrenceDate ?? session.block.date);
    }
    // Pointer-generated click follows pointerup; suppress only that click, not subsequent clicks.
    if (session.dragging) setTimeout(() => { suppressClick.current = false; }, 0);
  };

  useEffect(() => {
    const clearExternal = () => { setExternalPreview(null); setHovered(null); };
    window.addEventListener('dragend', clearExternal);
    window.addEventListener('drop', clearExternal);
    return () => { window.removeEventListener('dragend', clearExternal); window.removeEventListener('drop', clearExternal); stopAutoScroll(); };
  }, []);

  // Zmiana wielkości odbywa się co 15 minut, zawsze w granicach siatki (do 23:00).
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
      <div className="calendar-scroll" ref={calendarScrollRef}>
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
              const todaysBlocks = blocks.filter(b => b.date === d && minuteOfDay(b.time) >= START && minuteOfDay(b.time) < END);
              const eventPositions = layoutOverlappingEvents(todaysBlocks.map(block => ({
                id: block.id,
                start: minuteOfDay(block.time),
                end: Math.min(END, minuteOfDay(block.time) + (resizePreview?.id === block.id ? resizePreview.duration : block.duration)),
              })));
              const now = new Date();
              const nowMinutes = now.getHours() * 60 + now.getMinutes();
              return (
                <div
                  className={`day-lane ${d === today ? 'day-lane--today' : ''} ${hovered === d || movePreview?.date === d ? 'day-lane--hover' : ''}`}
                  data-calendar-date={d}
                  style={{ height: GRID_HEIGHT, backgroundSize: `100% ${HOUR_HEIGHT}px` }} key={d}
                  onDragOver={e => {
                    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
                    setEmptyHover(null);
                    const time = getTimeFromPosition(e, e.currentTarget);
                    setHovered(d);
                    setExternalPreview(previous => previous?.date === d && previous.time === time ? previous : { date: d, time });
                  }}
                  onDragLeave={e => {
                    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
                    setHovered(null); setExternalPreview(null);
                  }}
                  onDrop={e => {
                    e.preventDefault(); setHovered(null); setExternalPreview(null);
                    const raw = e.dataTransfer.getData('application/momentum') || e.dataTransfer.getData('text/plain');
                    try {
                      const item = JSON.parse(raw) as { kind: 'task' | 'routine'; id: string; sourceDate?: string };
                      if (item.kind === 'task' || item.kind === 'routine') onDropBlock(item.kind, item.id, d, getTimeFromPosition(e, e.currentTarget), item.sourceDate);
                    } catch { /* ignore drops coming from other apps */ }
                  }}
                  onMouseMove={e => {
                    if (e.target !== e.currentTarget || moveSession.current?.dragging || resizeSession.current) {
                      setEmptyHover(current => current?.date === d ? null : current);
                      return;
                    }
                    const time = getTimeFromPosition(e, e.currentTarget);
                    setEmptyHover(current => current?.date === d && current.time === time ? current : { date: d, time });
                  }}
                  onMouseLeave={() => setEmptyHover(current => current?.date === d ? null : current)}
                  onClick={e => {
                    if (e.target !== e.currentTarget || suppressClick.current) return;
                    setEmptyHover(null);
                    onAddAt(d, getTimeFromPosition(e, e.currentTarget));
                  }}
                  title="Kliknij puste miejsce, aby dodać zadanie na wybraną godzinę"
                >
                  {d === today && nowMinutes >= START && nowMinutes < END && (
                    <div className="now-line" style={{ top: ((nowMinutes - START) / 60) * HOUR_HEIGHT }}><span /></div>
                  )}
                  {todaysBlocks.map(block => {
                    const style = categories[block.category] ?? categories.unpaid;
                    const displayDuration = resizePreview?.id === block.id ? resizePreview.duration : block.duration;
                    const top = ((minuteOfDay(block.time) - START) / 60) * HOUR_HEIGHT;
                    const height = Math.max(32, Math.min(displayDuration, END - minuteOfDay(block.time)) / 60 * HOUR_HEIGHT - 3);
                    const placement = eventPositions.get(block.id);
                    const crowded = (placement?.columns ?? 1) > 1;
                    return (
                      <div
                        className={`calendar-event ${block.done ? 'calendar-event--done' : ''} ${height < 62 ? 'calendar-event--small' : ''} ${resizePreview?.id === block.id ? 'calendar-event--resizing' : ''} ${movePreview?.id === block.id ? 'calendar-event--moving' : ''} ${crowded ? 'calendar-event--overlap' : ''}`}
                        draggable={false}
                        onDragStart={e => e.preventDefault()}
                        onPointerDown={e => startMove(e, block)}
                        onPointerMove={moveBlock}
                        onPointerUp={e => finishMove(e)}
                        onPointerCancel={e => finishMove(e, true)}
                        onLostPointerCapture={e => {
                          const session = moveSession.current;
                          if (session?.pointerId === e.pointerId) {
                            moveSession.current = null;
                            stopAutoScroll();
                            setMovePreview(null);
                          }
                        }}
                        onClick={e => {
                          e.stopPropagation();
                          if (suppressClick.current) { suppressClick.current = false; return; }
                          onOpenBlock(block);
                        }}
                        style={{
                          top, height,
                          left: `calc(${placement?.leftPercent ?? 0}% + 4px)`,
                          width: `calc(${placement?.widthPercent ?? 100}% - 7px)`,
                          right: 'auto',
                          zIndex: 2 + (placement?.column ?? 0),
                          '--event-color': style.color, '--event-tint': style.tint,
                        } as React.CSSProperties}
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
                        {height > 65 && <GripVertical className="event-grip" size={12} />}
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
                  {emptyHover?.date === d && !movePreview && !externalPreview && (
                    <div className="calendar-empty-hint" style={{ top: ((minuteOfDay(emptyHover.time) - START) / 60) * HOUR_HEIGHT }}>
                      <Plus size={13} /> {emptyHover.time} · Dodaj zadanie
                    </div>
                  )}
                  {movePreview?.date === d && (
                    <div className="calendar-move-preview" style={{
                      top: ((minuteOfDay(movePreview.time) - START) / 60) * HOUR_HEIGHT,
                      height: Math.max(32, movePreview.duration / 60 * HOUR_HEIGHT - 3),
                      '--event-color': categories[movePreview.category]?.color ?? '#7061ee',
                    } as React.CSSProperties}>
                      <strong>{movePreview.title}</strong>
                      <span>{movePreview.time} – {timeFromMinutes(minuteOfDay(movePreview.time) + movePreview.duration)}</span>
                    </div>
                  )}
                  {externalPreview?.date === d && !movePreview && (
                    <div className="calendar-drop-time" style={{ top: ((minuteOfDay(externalPreview.time) - START) / 60) * HOUR_HEIGHT }}>
                      <span>{externalPreview.time}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="calendar-footer"><span className="legend-dot" /> Kliknij puste miejsce, aby dodać zadanie. Przeciągnij blok, aby zmienić termin. <span className="footnote">Widok 24 h · czas lokalny</span></div>
    </section>
  );
}
