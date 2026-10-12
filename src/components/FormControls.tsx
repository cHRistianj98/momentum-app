import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Clock3, Minus, Plus, Sparkles, Timer } from 'lucide-react';
import { formatDuration } from '../lib/date';

interface FloatingProps {
  open: boolean;
  trigger: React.RefObject<HTMLButtonElement | null>;
  close: () => void;
  label: string;
  children: React.ReactNode;
  className?: string;
}
function Floating({ open, trigger, close, label, children, className = '' }: FloatingProps) {
  const popover = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 276, maxHeight: 420, above: false });
  const place = useCallback(() => {
    const node = trigger.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const width = Math.min(305, window.innerWidth - 24);
    const below = window.innerHeight - rect.bottom - 14;
    const aboveSpace = rect.top - 14;
    const above = below < 320 && aboveSpace > below;
    setPos({ top: above ? rect.top - 8 : rect.bottom + 8,
      left: Math.min(Math.max(rect.left, 12), window.innerWidth - width - 12),
      width, maxHeight: Math.max(150, Math.min(420, above ? aboveSpace : below)), above });
  }, [trigger]);
  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: PointerEvent) => {
      if (!trigger.current?.contains(e.target as Node) && !popover.current?.contains(e.target as Node)) close();
    };
    const keyboard = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); trigger.current?.focus(); } };
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', keyboard, true);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, close, place, trigger]);
  if (!open) return null;
  return createPortal(<div ref={popover} className={`momentum-control-popover ${className} ${pos.above ? 'is-above' : ''}`}
    role="dialog" aria-label={label} style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}>{children}</div>, document.body);
}

const parseTime = (value: string | null) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  return match ? { h: Math.max(0, Math.min(23, Number(match[1]))), m: Math.max(0, Math.min(59, Number(match[2]))) } : { h: 9, m: 0 };
};
const pad = (number: number) => String(number).padStart(2, '0');

export function TimePicker({ value, onChange, disabled = false, allowClear = false }: { value: string | null; onChange: (time: string | null) => void; disabled?: boolean; allowClear?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState(() => parseTime(value));
  const close = useCallback(() => setOpen(false), []);
  const apply = () => { onChange(`${pad(draft.h)}:${pad(draft.m)}`); close(); ref.current?.focus(); };
  return <>
    <button ref={ref} type="button" disabled={disabled} className={`momentum-control-trigger ${open ? 'is-open' : ''} ${!value ? 'is-empty' : ''}`}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (!open) setDraft(parseTime(value)); setOpen(v => !v); }}>
      <Clock3 size={16}/><span>{value ?? 'Wybierz godzinę'}</span><ChevronDown size={15}/>
    </button>
    <Floating open={open} trigger={ref} close={close} label="Wybierz godzinę" className="momentum-time-popover">
      <div className="momentum-control-heading"><span>GODZINA ROZPOCZĘCIA</span><strong>Wybierz czas</strong></div>
      <div className="momentum-time-columns">
        <div className="momentum-time-column"><small>GODZINA</small><div className="momentum-time-scroll">
          {Array.from({length:24}, (_,i) => <button type="button" key={i} className={draft.h === i ? 'selected' : ''} onClick={() => setDraft(p => ({ ...p, h: i }))}>{pad(i)}</button>)}
        </div></div>
        <span className="momentum-time-colon">:</span>
        <div className="momentum-time-column"><small>MINUTA</small><div className="momentum-time-scroll">
          {Array.from({length:60}, (_,i) => <button type="button" key={i} className={draft.m === i ? 'selected' : ''} onClick={() => setDraft(p => ({ ...p, m: i }))}>{pad(i)}</button>)}
        </div></div>
      </div>
      <div className="momentum-time-presets">{['07:00','08:00','09:00','12:00','18:00'].map(t =>
        <button type="button" key={t} onClick={() => { onChange(t); close(); }}>{t}</button>)}</div>
      <div className="momentum-time-actions">
        {allowClear && <button type="button" className="momentum-control-clear" onClick={() => { onChange(null); close(); }}>Wyczyść</button>}
        <button type="button" className="momentum-time-apply" onClick={apply}><Check size={15}/> Ustaw {pad(draft.h)}:{pad(draft.m)}</button>
      </div>
    </Floating>
  </>;
}

const DURATIONS = [15,30,45,60,75,90,120,150,180,240,300,360];
export function DurationPicker({ value, onChange }: { value: number; onChange: (duration: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const choices = [...new Set([...DURATIONS, value])].sort((a,b) => a-b);
  return <>
    <button ref={ref} type="button" className={`momentum-control-trigger ${open ? 'is-open' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(v => !v)}>
      <Timer size={16}/><span>{formatDuration(value)}</span><ChevronDown size={15}/>
    </button>
    <Floating open={open} trigger={ref} close={close} label="Czas trwania" className="momentum-duration-popover">
      <div className="momentum-control-heading"><span>PLANOWANY CZAS</span><strong>Jak długo?</strong></div>
      <div className="momentum-duration-list">{choices.map(v => <button key={v} type="button" className={v === value ? 'selected' : ''}
        onClick={() => { onChange(v); close(); }}><span>{formatDuration(v)}</span>{v === value && <Check size={17}/>}</button>)}</div>
      <div className="momentum-duration-custom"><span>Dokładnie (co 15 min)</span><div>
        <button type="button" title="Skróć o 15 minut" onClick={() => onChange(Math.max(15, value-15))}><Minus size={16}/></button>
        <strong>{value} min</strong>
        <button type="button" title="Wydłuż o 15 minut" onClick={() => onChange(Math.min(960, value+15))}><Plus size={16}/></button>
      </div></div>
    </Floating>
  </>;
}

export function XpStepper({ value, onChange, label = 'Nagroda XP' }: { value: number; onChange: (xp: number) => void; label?: string }) {
  const normalize = (n: number) => Math.max(0, Math.min(500, Math.round(n)));
  return <div className="momentum-xp-stepper">
    <button type="button" aria-label="Odejmij 5 XP" disabled={value <= 0} onClick={() => onChange(normalize(value-5))}><Minus size={15}/></button>
    <div className="momentum-xp-input"><Sparkles size={15}/><input aria-label={label} type="text" inputMode="numeric" pattern="[0-9]*" value={value}
      onChange={e => { if (/^\d*$/.test(e.target.value)) onChange(normalize(Number(e.target.value || '0'))); }}/></div>
    <button type="button" aria-label="Dodaj 5 XP" disabled={value >= 500} onClick={() => onChange(normalize(value+5))}><Plus size={15}/></button>
  </div>;
}
