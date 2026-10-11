import { CalendarClock, Check, Repeat2, X } from 'lucide-react';
import { formatDuration, fullDate, timeFromMinutes, minuteOfDay } from '../lib/date';

interface Props {
  title: string;
  date: string;
  time: string;
  previousDuration: number;
  nextDuration: number;
  onOnlyThis: () => void;
  onAll: () => void;
  onCancel: () => void;
}

export function ResizeConfirmModal({ title, date, time, previousDuration, nextDuration, onOnlyThis, onAll, onCancel }: Props) {
  const previousEnd = timeFromMinutes(minuteOfDay(time) + previousDuration);
  const nextEnd = timeFromMinutes(minuteOfDay(time) + nextDuration);

  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="modal resize-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="resize-modal-heading">
        <div className="modal-heading">
          <div><span className="eyebrow"><Repeat2 size={13} /> ZADANIE CYKLICZNE</span><h2 id="resize-modal-heading">Zmienić czas całej serii?</h2></div>
          <button type="button" className="icon-btn" aria-label="Anuluj zmianę" onClick={onCancel}><X size={20}/></button>
        </div>
        <p className="resize-confirm-intro">Zmieniasz długość bloku <strong>„{title}”</strong>. Wybierz, których wystąpień ma dotyczyć zmiana.</p>
        <div className="resize-confirm-summary">
          <div className="resize-confirm-symbol"><CalendarClock size={22}/></div>
          <div className="resize-confirm-details">
            <strong>{fullDate(date)}</strong>
            <span>{time}–{previousEnd} <span aria-hidden="true">→</span> <b>{time}–{nextEnd}</b></span>
          </div>
          <div className="resize-confirm-duration">{formatDuration(nextDuration)}</div>
        </div>
        <div className="resize-confirm-choices">
          <button type="button" className="resize-confirm-choice" onClick={onOnlyThis}>
            <span className="resize-confirm-choice-icon"><CalendarClock size={20}/></span>
            <span><strong>Tylko to wystąpienie</strong><small>Zmień czas wyłącznie {date}. Pozostałe dni pozostaną bez zmian.</small></span>
            <Check size={17}/>
          </button>
          <button type="button" className="resize-confirm-choice" onClick={onAll}>
            <span className="resize-confirm-choice-icon"><Repeat2 size={20}/></span>
            <span><strong>Wszystkie wystąpienia</strong><small>Zaktualizuj szablon rutyny oraz usuń wcześniejsze wyjątki długości.</small></span>
            <Check size={17}/>
          </button>
        </div>
        <div className="modal-bottom"><span className="modal-tip">Nic nie zapisze się bez Twojego wyboru.</span><button type="button" className="btn btn--ghost" onClick={onCancel}>Anuluj</button></div>
      </div>
    </div>
  );
}
