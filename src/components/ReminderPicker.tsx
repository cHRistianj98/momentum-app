import { useState } from 'react';
import { Bell, BellOff, BellRing, Check, Plus, X } from 'lucide-react';
import { MAX_REMINDER_OFFSET, MAX_REMINDERS, REMINDER_PRESETS, normalizeReminders, reminderChipLabel, reminderLongLabel, reminderSummary } from '../lib/reminders';
import { tr } from '../lib/i18n';

type Unit = 'min' | 'h' | 'd';
const UNIT_MINUTES: Record<Unit, number> = { min: 1, h: 60, d: 1440 };

interface Props {
  value: number[];
  onChange: (value: number[]) => void;
  /** Godzina rozpoczęcia — potrzebna do opisu; null oznacza brak terminu. */
  time: string | null;
  disabled?: boolean;
  disabledHint?: string;
  /** Wybór jest możliwy, ale przypomnienia jeszcze nie zadziałają (np. zadanie bez godziny). */
  inactiveHint?: string;
  /** Status powiadomień systemowych — pozwala zaproponować ich włączenie. */
  systemEnabled?: boolean;
  onEnableSystem?: () => void;
  label?: string;
}

/** Wybór wielu przypomnień: gotowe chipy (np. 5 min, 30 min) i własny czas. */
export function ReminderPicker({ value, onChange, time, disabled = false, disabledHint, inactiveHint, systemEnabled = true, onEnableSystem, label = tr('Przypomnienia', 'Reminders') }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [amount, setAmount] = useState('45');
  const [unit, setUnit] = useState<Unit>('min');
  const selected = normalizeReminders(value) ?? [];
  const custom = selected.filter(offset => !(REMINDER_PRESETS as readonly number[]).includes(offset));
  const full = selected.length >= MAX_REMINDERS;

  const toggle = (offset: number) => {
    if (selected.includes(offset)) onChange(selected.filter(item => item !== offset));
    else if (!full) onChange(normalizeReminders([...selected, offset]) ?? []);
  };
  const minutes = Math.round(Number(amount.replace(',', '.')) * UNIT_MINUTES[unit]);
  const customValid = Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_REMINDER_OFFSET;
  const addCustom = () => {
    if (!customValid || full) return;
    onChange(normalizeReminders([...selected, minutes]) ?? []);
    setCustomOpen(false);
  };

  return <div className={`field reminder-field ${disabled ? 'is-disabled' : ''}`}>
    <span className="reminder-field-label">{selected.length && !disabled ? <BellRing size={14}/> : <Bell size={14}/>} {label}
      {selected.length > 0 && !disabled && <em>{selected.length}</em>}</span>
    <div className="reminder-chips" role="group" aria-label={label}>
      {REMINDER_PRESETS.map(offset => {
        const active = selected.includes(offset);
        return <button type="button" key={offset} disabled={disabled || (!active && full)} aria-pressed={active}
          className={`reminder-chip ${active ? 'is-active' : ''}`} title={reminderLongLabel(offset)} onClick={() => toggle(offset)}>
          {active && <Check size={13} strokeWidth={3}/>}{reminderChipLabel(offset)}
        </button>;
      })}
      {custom.map(offset => <button type="button" key={`custom-${offset}`} disabled={disabled} aria-pressed
        className="reminder-chip is-active is-custom" title={tr(`Usuń: ${reminderLongLabel(offset)}`, `Remove: ${reminderLongLabel(offset)}`)} onClick={() => toggle(offset)}>
        {reminderChipLabel(offset)}<X size={13}/>
      </button>)}
      <button type="button" className={`reminder-chip reminder-chip--add ${customOpen ? 'is-open' : ''}`} disabled={disabled || full}
        aria-expanded={customOpen} onClick={() => setCustomOpen(open => !open)}><Plus size={13}/> {tr('Własne', 'Custom')}</button>
    </div>
    {customOpen && !disabled && <div className="reminder-custom">
      <span>{tr('Przypomnij', 'Remind me')}</span>
      <input aria-label={tr('Ile wcześniej', 'How long before')} inputMode="decimal" value={amount} maxLength={4}
        onChange={event => setAmount(event.target.value.replace(/[^\d.,]/g, ''))}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } }}/>
      <div className="reminder-units" role="radiogroup" aria-label={tr('Jednostka', 'Unit')}>
        {(['min', 'h', 'd'] as const).map(item => <button type="button" key={item} role="radio" aria-checked={unit === item}
          className={unit === item ? 'is-active' : ''} onClick={() => setUnit(item)}>{item === 'min' ? 'min' : item === 'h' ? tr('godz.', 'h') : tr('dni', 'days')}</button>)}
      </div>
      <span>{tr('przed', 'before')}</span>
      <button type="button" className="reminder-custom-add" disabled={!customValid} onClick={addCustom}><Check size={15}/> {tr('Dodaj', 'Add')}</button>
    </div>}
    <small className="reminder-hint">
      {disabled
        ? <>{disabledHint ?? tr('Ustaw datę i godzinę, aby dodać przypomnienia.', 'Set a date and time to add reminders.')}</>
        : inactiveHint
          ? <>{selected.length ? tr(`Wybrano: ${selected.map(reminderChipLabel).join(', ')}. `, `Selected: ${selected.map(reminderChipLabel).join(', ')}. `) : ''}{inactiveHint}</>
          : <>{reminderSummary(selected, time)}{full ? tr(` Maksymalnie ${MAX_REMINDERS} przypomnień.`, ` Up to ${MAX_REMINDERS} reminders.`) : ''}</>}
    </small>
    {!disabled && !inactiveHint && selected.length > 0 && !systemEnabled && onEnableSystem && <button type="button" className="reminder-enable" onClick={onEnableSystem}>
      <BellOff size={15}/><span><strong>{tr('Powiadomienia na telefonie są wyłączone', 'Phone notifications are turned off')}</strong><small>{tr('Przypomnienia pojawią się tylko w aplikacji. Dotknij, aby włączyć.', 'Reminders will only appear in the app. Tap to turn them on.')}</small></span>
    </button>}
  </div>;
}
