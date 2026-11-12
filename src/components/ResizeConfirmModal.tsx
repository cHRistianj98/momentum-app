import { CalendarClock, Check, Repeat2, X } from 'lucide-react';
import { formatDuration, fullDate, timeFromMinutes, minuteOfDay } from '../lib/date';
import { pick, tr } from '../lib/i18n';

interface Props {
  title: string;
  date: string;
  time: string;
  previousDuration: number;
  nextDuration: number;
  /** Nagłówek okna: rutyna albo zadanie cykliczne. */
  eyebrow?: string;
  /** Opis opcji „Wszystkie wystąpienia”. */
  allHint?: string;
  onOnlyThis: () => void;
  onAll: () => void;
  onCancel: () => void;
}

export function ResizeConfirmModal({ title, date, time, previousDuration, nextDuration, eyebrow = tr('RUTYNA CYKLICZNA', 'RECURRING ROUTINE'), allHint = tr('Zaktualizuj szablon rutyny oraz usuń wcześniejsze wyjątki długości.', 'Update the routine template and remove earlier duration exceptions.'), onOnlyThis, onAll, onCancel }: Props) {
  const previousEnd = timeFromMinutes(minuteOfDay(time) + previousDuration);
  const nextEnd = timeFromMinutes(minuteOfDay(time) + nextDuration);

  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="modal resize-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="resize-modal-heading">
        <div className="modal-heading">
          <div><span className="eyebrow"><Repeat2 size={13} /> {eyebrow}</span><h2 id="resize-modal-heading">{tr('Zmienić czas całej serii?', 'Change the duration of the whole series?')}</h2></div>
          <button type="button" className="icon-btn" aria-label={tr('Anuluj zmianę', 'Cancel change')} onClick={onCancel}><X size={20}/></button>
        </div>
        <p className="resize-confirm-intro">{pick(
          <>Zmieniasz długość bloku <strong>„{title}”</strong>. Wybierz, których wystąpień ma dotyczyć zmiana.</>,
          <>You’re changing the length of <strong>“{title}”</strong>. Choose which occurrences the change applies to.</>)}</p>
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
            <span><strong>{tr('Tylko to wystąpienie', 'Only this occurrence')}</strong><small>{tr(`Zmień czas wyłącznie ${date}. Pozostałe dni pozostaną bez zmian.`, `Change the duration only on ${date}. Other days stay unchanged.`)}</small></span>
            <Check size={17}/>
          </button>
          <button type="button" className="resize-confirm-choice" onClick={onAll}>
            <span className="resize-confirm-choice-icon"><Repeat2 size={20}/></span>
            <span><strong>{tr('Wszystkie wystąpienia', 'All occurrences')}</strong><small>{allHint}</small></span>
            <Check size={17}/>
          </button>
        </div>
        <div className="modal-bottom"><span className="modal-tip">{tr('Nic nie zapisze się bez Twojego wyboru.', 'Nothing is saved until you choose.')}</span><button type="button" className="btn btn--ghost" onClick={onCancel}>{tr('Anuluj', 'Cancel')}</button></div>
      </div>
    </div>
  );
}
