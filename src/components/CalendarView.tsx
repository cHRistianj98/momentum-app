import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Check, GripVertical, GripHorizontal, Play, Plus } from 'lucide-react';
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
  onAddAt: (date: string, time: string, duration?: number) => void;
  onOpenBlock: (block: CalendarBlock) => void;
  onFocusBlock: (block: CalendarBlock) => void;
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
  fromHandle: boolean;
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

export function CalendarView({ referenceDate, onChangeDate, blocks, categories, mode, onChangeMode, onAddAt, onOpenBlock, onFocusBlock, onToggleBlock, onDropBlock, onResizeBlock, compact = false }: CalendarViewProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date());
  // Refresh the red current-time line while the PWA stays open or returns to foreground.
  useEffect(() => {
    const refresh = () => setClock(new Date());
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const [resizePreview, setResizePreview] = useState<{ id: string; duration: number } | null>(null);
  const resizeSession = useRef<ResizeSession | null>(null);
  const moveSession = useRef<MoveSession | null>(null);
  const calendarScrollRef = useRef<HTMLDivElement>(null);
  const animationFrame = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const [movePreview, setMovePreview] = useState<MovePreview | null>(null);
  const [externalPreview, setExternalPreview] = useState<{date: string; time: string} | null>(null);
  const [emptyHover, setEmptyHover] = useState<{date: string; time: string} | null>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  // Gesture tracking on the hour grid: horizontal swipe = adjacent day/week;
  // vertical swipe still scrolls, while long press keeps move/range selection.
  const gridSwipeRef = useRef<{ startX: number; startY: number; lastX: number; lastY: number; horizontal: boolean; cancelled: boolean } | null>(null);
  const [daySwipeDirection, setDaySwipeDirection] = useState<'next' | 'previous' | null>(null);
  const daySwipeResetRef = useRef<number | null>(null);
  useEffect(() => () => { if (daySwipeResetRef.current !== null) window.clearTimeout(daySwipeResetRef.current); }, []);

  const [rangePreview, setRangePreview] = useState<{date:string;start:number;end:number}|null>(null);
  const rangeRef = useRef<{timer:ReturnType<typeof setTimeout>|null; date:string; lane:HTMLDivElement; y:number; x:number; startY:number; active:boolean; anchor:number}|null>(null);
  const stopTouchScroll = useRef<(event:TouchEvent)=>void>((event)=>{ if(touchMoveRef.current?.active || rangeRef.current?.active) event.preventDefault(); });
  useEffect(()=>{const block=stopTouchScroll.current;document.addEventListener('touchmove',block,{passive:false,capture:true});return()=>document.removeEventListener('touchmove',block,true)},[]);
  const touchMoveRef = useRef<{timer: ReturnType<typeof setTimeout> | null; block: CalendarBlock; element: HTMLDivElement; startX:number; startY:number; x:number; y:number; active:boolean; offsetY:number} | null>(null);

  // On opening the calendar, centre the current-time red line rather than midnight.
  // Do this only when entering/changing the view; never fight manual scrolling.
  useLayoutEffect(() => {
    const scroller = calendarScrollRef.current;
    if (!scroller) return;
    const centreOnNow = () => {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
      const heading = scroller.querySelector<HTMLElement>('.calendar-head');
      const availableHeight = scroller.clientHeight - (heading?.offsetHeight ?? 0);
      if (availableHeight <= 0) return;
      const position = ((minutes - START) / 60) * HOUR_HEIGHT;
      const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      scroller.scrollTop = Math.max(0, Math.min(maximum, position - availableHeight / 2));
    };
    centreOnNow();
    const frame = requestAnimationFrame(centreOnNow);
    return () => cancelAnimationFrame(frame);
  }, [mode, compact]);


  // iOS: short tap opens details; a normal swipe scrolls; long press enters drag mode.
  const touchStartEvent = (event: React.TouchEvent<HTMLDivElement>, block: CalendarBlock) => {
    if (event.touches.length !== 1 || (event.target as HTMLElement).closest('button, .event-resize-handle')) return;
    const finger = event.touches[0];
    const element = event.currentTarget;
    const rect = element.getBoundingClientRect();
    const session = { timer: null as ReturnType<typeof setTimeout> | null, block, element, startX:finger.clientX, startY:finger.clientY, x:finger.clientX, y:finger.clientY, active:false, offsetY:Math.max(0,Math.min(rect.height,finger.clientY-rect.top)) };
    touchMoveRef.current = session;
    session.timer = setTimeout(() => {
      if (touchMoveRef.current !== session) return;
      session.active = true;
      suppressClick.current = true;
      element.classList.add('calendar-event--moving');
      calendarScrollRef.current?.classList.add('calendar-scroll--gesture');
      const move: MoveSession = { pointerId:-1, block, startX:session.startX, startY:session.startY, lastX:session.x, lastY:session.y, grabOffsetY:session.offsetY, fromHandle:false, dragging:true };
      moveSession.current = move;
      updatePreview(move, session.x, session.y);
      animationFrame.current = requestAnimationFrame(autoScroll);
    }, 480);
  };
  const touchMoveEvent = (event: React.TouchEvent<HTMLDivElement>) => {
    const session = touchMoveRef.current;
    if (!session || !event.touches.length) return;
    const finger = event.touches[0];
    session.x = finger.clientX; session.y = finger.clientY;
    if (!session.active) {
      if (Math.hypot(session.x-session.startX,session.y-session.startY)>9) {
        if (session.timer) clearTimeout(session.timer);
        touchMoveRef.current=null;
      }
      return;
    }
    event.preventDefault();
    if (moveSession.current) updatePreview(moveSession.current,session.x,session.y);
  };
  const touchEndEvent = (event: React.TouchEvent<HTMLDivElement>) => {
    const session=touchMoveRef.current;
    if (!session) return;
    if (session.timer) clearTimeout(session.timer);
    touchMoveRef.current=null;
    if (!session.active) return;
    event.preventDefault(); event.stopPropagation();
    const touch = event.changedTouches[0];
    const drop = moveSession.current && touch ? previewAt(moveSession.current,touch.clientX,touch.clientY) : null;
    session.element.classList.remove('calendar-event--moving');
    calendarScrollRef.current?.classList.remove('calendar-scroll--gesture');
    moveSession.current=null; stopAutoScroll();setMovePreview(null);
    if (drop && (drop.date!==session.block.date || drop.time!==session.block.time)) {
      onDropBlock(session.block.kind,session.block.sourceId,drop.date,drop.time,session.block.occurrenceDate??session.block.date);
    }
    suppressClick.current=true;
    setTimeout(()=>{suppressClick.current=false;},100);
  };

  const minuteAt = (lane:HTMLDivElement, y:number) => {
    const rect=lane.getBoundingClientRect();
    return Math.max(0,Math.min(END-15,Math.floor(((y-rect.top)/HOUR_HEIGHT*60)/15)*15));
  };
  const updateRange=(session:NonNullable<typeof rangeRef.current>,y:number)=>{
    session.y=y;
    const at=minuteAt(session.lane,y);
    const start=Math.min(session.anchor,at);
    const end=Math.min(END,Math.max(session.anchor,at)+15);
    setRangePreview({date:session.date,start,end});
  };
  const rangeStart=(event:React.TouchEvent<HTMLDivElement>,date:string)=>{
    if(event.touches.length!==1 || event.target!==event.currentTarget || touchMoveRef.current?.active) return;
    const finger=event.touches[0],lane=event.currentTarget;
    const session={timer:null as ReturnType<typeof setTimeout>|null,date,lane,y:finger.clientY,x:finger.clientX,startY:finger.clientY,active:false,anchor:minuteAt(lane,finger.clientY)};
    rangeRef.current=session;
    session.timer=setTimeout(()=>{
      if(rangeRef.current!==session)return;
      session.active=true;suppressClick.current=true;
      calendarScrollRef.current?.classList.add('calendar-scroll--gesture');
      updateRange(session,session.y);
      stopAutoScroll();animationFrame.current=requestAnimationFrame(autoScroll);
    },480);
  };
  const rangeMove=(event:React.TouchEvent<HTMLDivElement>)=>{
    const session=rangeRef.current;if(!session||!event.touches.length)return;
    const finger=event.touches[0];
    if(!session.active){
      if(Math.hypot(finger.clientY-session.startY,finger.clientX-session.x)>9){
        if(session.timer)clearTimeout(session.timer);rangeRef.current=null;
      }
      return;
    }
    event.preventDefault();session.x=finger.clientX;updateRange(session,finger.clientY);
  };
  const rangeEnd=(event:React.TouchEvent<HTMLDivElement>)=>{
    const session=rangeRef.current;if(!session)return;
    if(session.timer)clearTimeout(session.timer);
    rangeRef.current=null;stopAutoScroll();
    calendarScrollRef.current?.classList.remove('calendar-scroll--gesture');
    if(!session.active)return;
    event.preventDefault();event.stopPropagation();
    const y=event.changedTouches[0]?.clientY??session.y;
    const at=minuteAt(session.lane,y);
    const start=Math.min(session.anchor,at),end=Math.min(END,Math.max(session.anchor,at)+15);
    setRangePreview(null);
    onAddAt(session.date,timeFromMinutes(start),end-start);
    suppressClick.current=true;
    setTimeout(()=>{suppressClick.current=false;},150);
  };

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
    if (!scroller || (!session?.dragging && !rangeRef.current?.active)) { animationFrame.current = null; return; }
    const rect = scroller.getBoundingClientRect();
    const lastX = session?.lastX ?? rangeRef.current!.x;
    const lastY = session?.lastY ?? rangeRef.current!.y;
    let velocity = 0;
    if (lastX >= rect.left && lastX <= rect.right && lastY >= rect.top - 18 && lastY <= rect.bottom + 18) {
      if (lastY < rect.top + 52) velocity = -Math.min(17, Math.max(4, (rect.top + 52 - lastY) / 3));
      else if (lastY > rect.bottom - 52) velocity = Math.min(17, Math.max(4, (lastY - (rect.bottom - 52)) / 3));
    }
    if (velocity) {
      const previousScroll = scroller.scrollTop;
      scroller.scrollTop += velocity;
      if (scroller.scrollTop !== previousScroll) {
        if(session) updatePreview(session,lastX,lastY);
        else if(rangeRef.current?.active) updateRange(rangeRef.current,lastY);
      }
    }
    animationFrame.current = requestAnimationFrame(autoScroll);
  };

  const startMove = (event: React.PointerEvent<HTMLDivElement>, block: CalendarBlock) => {
    if (event.button !== 0 || resizeSession.current) return;
    const target = event.target as HTMLElement;
    // Na iOS palec na treści wydarzenia przewija pionowo kalendarz.
    // Przenoszenie dotykiem uruchamiamy wyłącznie z dedykowanego uchwytu.
    if (event.pointerType === 'touch') return;
    if (target.closest('button:not(.event-move-handle), .event-resize-handle')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    moveSession.current = {
      pointerId: event.pointerId, block, startX: event.clientX, startY: event.clientY,
      lastX: event.clientX, lastY: event.clientY,
      grabOffsetY: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      fromHandle: Boolean(target.closest('.event-move-handle')),
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
    if (session.dragging || session.fromHandle) {
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
    }
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

  const gridSwipeStart = (event: React.TouchEvent<HTMLDivElement>) => {
    gridSwipeRef.current = null;
    if (event.touches.length !== 1 || !window.matchMedia('(max-width: 850px)').matches) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, .event-resize-handle, .momentum-control-popover')) return;
    const point = event.touches[0];
    gridSwipeRef.current = { startX: point.clientX, startY: point.clientY,
      lastX: point.clientX, lastY: point.clientY, horizontal: false, cancelled: false };
  };
  const gridSwipeMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const swipe = gridSwipeRef.current;
    if (!swipe || event.touches.length !== 1 || swipe.cancelled) return;
    if (touchMoveRef.current?.active || rangeRef.current?.active || moveSession.current?.dragging || resizeSession.current) {
      swipe.cancelled = true;
      return;
    }
    const finger = event.touches[0];
    swipe.lastX = finger.clientX; swipe.lastY = finger.clientY;
    const dx = finger.clientX - swipe.startX;
    const dy = finger.clientY - swipe.startY;
    if (!swipe.horizontal) {
      if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx) * 1.2) {
        swipe.cancelled = true; // The user is scrolling hours vertically.
        return;
      }
      if (Math.abs(dx) > 25 && Math.abs(dx) > Math.abs(dy) * 1.5) swipe.horizontal = true;
    }
    if (swipe.horizontal && event.cancelable) event.preventDefault();
  };
  const gridSwipeEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const swipe = gridSwipeRef.current;
    gridSwipeRef.current = null;
    if (!swipe || swipe.cancelled || !swipe.horizontal || touchMoveRef.current?.active || rangeRef.current?.active || moveSession.current?.dragging || resizeSession.current) return;
    const point = event.changedTouches[0];
    const dx = (point?.clientX ?? swipe.lastX) - swipe.startX;
    const dy = (point?.clientY ?? swipe.lastY) - swipe.startY;
    if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.35) return;
    if (event.cancelable) event.preventDefault();
    suppressClick.current = true;
    setDaySwipeDirection(dx < 0 ? 'next' : 'previous');
    if (daySwipeResetRef.current !== null) window.clearTimeout(daySwipeResetRef.current);
    daySwipeResetRef.current = window.setTimeout(() => setDaySwipeDirection(null), 230);
    change(dx < 0 ? 1 : -1);
    window.setTimeout(() => { suppressClick.current = false; }, 250);
  };

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
        <div className="calendar-heading" onTouchStart={e=>{
            if (e.touches.length===1) swipeStart.current={x:e.touches[0].clientX,y:e.touches[0].clientY};
          }} onTouchEnd={e=>{
            const start=swipeStart.current;
            swipeStart.current=null;
            if(!start || !e.changedTouches.length) return;
            const dx=e.changedTouches[0].clientX-start.x;
            const dy=e.changedTouches[0].clientY-start.y;
            if(Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.6) change(dx<0?1:-1);
          }}>
          <div className="eyebrow"><CalendarDays size={14} /> TWÓJ HARMONOGRAM</div>
          <h2>{header}</h2><span className="calendar-mobile-swipe-hint">Przesuń nagłówek, aby zmienić {mode==='day'?'dzień':'tydzień'} <ChevronRight size={12}/></span>
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
      {mode === 'week' && <div className="mobile-week-agenda" aria-label="Tygodniowy przegląd aktywności">
        <div className="mobile-week-hint">Dotknij daty, aby otworzyć harmonogram dnia</div>
        <div className="mobile-week-grid">
          {dates.map(date => {
            const dayBlocks = blocks.filter(block => block.date === date)
              .sort((a, b) => a.time.localeCompare(b.time) || a.title.localeCompare(b.title));
            const visible = dayBlocks.slice(0, 7);
            const remaining = dayBlocks.length - visible.length;
            return <div className={`mobile-week-day ${date === today ? 'mobile-week-day--today' : ''}`} key={date}>
              <button type="button" className="mobile-week-date" onClick={() => { onChangeDate(date); onChangeMode('day'); }} aria-label={`Otwórz dzień ${fullDate(date)}`}>
                <span>{shortWeekday(date)}</span><strong>{parseDate(date).getDate()}</strong>
              </button>
              <div className="mobile-week-day-events">
                {visible.map(block => <button type="button" key={block.id}
                  className={`mobile-week-item ${block.done ? 'mobile-week-item--done' : ''}`}
                  style={{'--week-color': (categories[block.category] ?? categories.unpaid).color} as React.CSSProperties}
                  onClick={() => { onChangeDate(date); onChangeMode('day'); }}
                  title={`${block.title} • ${block.time} — otwórz plan dnia`}>
                  <span className="mobile-week-item-title">{block.done ? '✓ ' : ''}{block.title}</span>
                </button>)}
                {remaining > 0 && <button className="mobile-week-more" type="button" onClick={() => { onChangeDate(date); onChangeMode('day'); }}>+{remaining}</button>}
                {!dayBlocks.length && <span className="mobile-week-empty">—</span>}
              </div>
              <button className="mobile-week-open" type="button" aria-label={`Zobacz szczegóły ${fullDate(date)}`} onClick={() => { onChangeDate(date); onChangeMode('day'); }}>•••</button>
            </div>;
          })}
        </div>
      </div>}
      <div className={`calendar-scroll ${daySwipeDirection ? `calendar-scroll--swipe-${daySwipeDirection}` : ''}`} ref={calendarScrollRef}
        onTouchStart={gridSwipeStart} onTouchMove={gridSwipeMove}
        onTouchEnd={gridSwipeEnd} onTouchCancel={() => { gridSwipeRef.current = null; }}>
        <div className={`calendar-body ${mode === 'day' ? 'calendar-body--day' : 'calendar-body--week'}`} style={{ minWidth: mode === 'week' ? 980 : 520 }}>
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
              const nowMinutes = clock.getHours() * 60 + clock.getMinutes() + clock.getSeconds() / 60;
              return (
                <div
                  className={`day-lane ${d === today ? 'day-lane--today' : ''} ${hovered === d || movePreview?.date === d ? 'day-lane--hover' : ''}`}
                  data-calendar-date={d}
                  style={{ height: GRID_HEIGHT, backgroundSize: `100% ${HOUR_HEIGHT}px` }} key={d}
                  onTouchStart={e=>rangeStart(e,d)}
                  onTouchMove={rangeMove}
                  onTouchEnd={rangeEnd}
                  onTouchCancel={()=>{const session=rangeRef.current;if(session?.timer)clearTimeout(session.timer);rangeRef.current=null;setRangePreview(null);stopAutoScroll();calendarScrollRef.current?.classList.remove('calendar-scroll--gesture');}}
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
                        onTouchStart={e => touchStartEvent(e, block)}
                        onTouchMove={touchMoveEvent}
                        onTouchEnd={touchEndEvent}
                        onTouchCancel={touchEndEvent}
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
                          left: `calc(${placement?.leftPercent ?? 0}% + var(--lane-event-inset, 4px))`,
                          width: `calc(${placement?.widthPercent ?? 100}% - var(--lane-event-width-offset, 7px))`,
                          right: 'auto',
                          zIndex: 2 + (placement?.column ?? 0),
                          '--event-color': style.color,
                          '--event-tint': style.tint,
                          '--event-columns': placement?.columns ?? 1,
                        } as React.CSSProperties}
                        title={`${block.title} • ${block.time} • ${block.duration} min`}
                        key={block.id}
                      >
                        <div className="event-body">
                          <TaskVisual icon={block.icon} image={block.image} category={block.category} categories={categories} className="event-visual" size="small" />
                          <div className="event-text"><strong>{block.title}</strong><small>{block.time} · {displayDuration} min</small></div>
                          {block.kind === 'task' && !block.done && <button
                            type="button"
                            className="event-focus"
                            aria-label={`Rozpocznij Focus: ${block.title}`}
                            title="Rozpocznij Focus Mode"
                            onPointerDown={e=>e.stopPropagation()}
                            onClick={e=>{e.stopPropagation();onFocusBlock(block);}}
                          ><Play size={12} fill="currentColor" /></button>}
                          <button
                            className={`event-check ${block.done ? 'checked' : ''}`}
                            aria-label={block.done ? 'Oznacz jako niewykonane' : 'Oznacz jako wykonane'}
                            title={block.kind === 'routine' ? 'Otwórz kroki rutyny' : 'Zmień status'}
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => { e.stopPropagation(); onToggleBlock(block); }}
                          ><Check size={13} strokeWidth={3} /></button>
                        </div>
                        {height > 105 && <CategoryBadge category={block.category} categories={categories} compact className="event-footer-badge" />}
                        {height >= 72 && height <= 105 && <CategoryBadge category={block.category} categories={categories} compact className="event-footer-badge event-footer-badge--mobile" />}
                        <button type="button" className="event-move-handle" aria-label={`Przesuń ${block.title} na inną godzinę lub dzień`}
                          title="Przytrzymaj i przeciągnij" onClick={e=>e.stopPropagation()}>
                          <GripVertical size={15}/>
                        </button>
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
                  {rangePreview?.date===d && <div className="calendar-range-preview" style={{top:(rangePreview.start/60)*HOUR_HEIGHT,height:((rangePreview.end-rangePreview.start)/60)*HOUR_HEIGHT}}>
                    <span>{timeFromMinutes(rangePreview.start)} – {timeFromMinutes(rangePreview.end)} · {rangePreview.end-rangePreview.start} min</span>
                  </div>}
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
