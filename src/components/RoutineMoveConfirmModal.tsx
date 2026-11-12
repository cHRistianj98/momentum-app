import { ArrowRight, CalendarClock, Check, Repeat2, X } from 'lucide-react';
import { fullDate } from '../lib/date';
import { pick, tr } from '../lib/i18n';

interface Props {
  title: string;
  previousDate: string;
  previousTime: string;
  targetDate: string;
  targetTime: string;
  shiftsWeekdays: boolean;
  /** Nagłówek okna, np. „ZADANIE CYKLICZNE” dla zadań cyklicznych. */
  eyebrow?: string;
  /** Opis opcji „Wszystkie wystąpienia”, gdy domyślny tekst o dniach tygodnia nie pasuje. */
  allHint?: string;
  onOnlyThis: () => void;
  onAll: () => void;
  onCancel: () => void;
}

export function RoutineMoveConfirmModal({ title, previousDate, previousTime, targetDate, targetTime, shiftsWeekdays, eyebrow = tr('RUTYNA CYKLICZNA', 'RECURRING ROUTINE'), allHint, onOnlyThis, onAll, onCancel }: Props) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
    <div className="modal resize-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="routine-move-title">
      <div className="modal-heading"><div><span className="eyebrow"><Repeat2 size={14}/> {eyebrow}</span><h2 id="routine-move-title">{tr('Przenieść całą serię?', 'Move the whole series?')}</h2></div>
        <button type="button" className="icon-btn" aria-label={tr('Zamknij', 'Close')} onClick={onCancel}><X size={20}/></button></div>
      <p className="resize-confirm-intro">{pick(
        <>Przesuwasz <strong>„{title}”</strong>. Zdecyduj, czy przenieść jedno wystąpienie, czy zmienić harmonogram wszystkich.</>,
        <>You’re moving <strong>“{title}”</strong>. Decide whether to move just this occurrence or change the schedule of all of them.</>)}</p>
      <div className="routine-move-summary">
        <div><small>{tr('WCZEŚNIEJ', 'BEFORE')}</small><strong>{fullDate(previousDate)}</strong><span>{previousTime}</span></div>
        <ArrowRight size={20}/>
        <div><small>{tr('NOWY TERMIN', 'NEW DATE')}</small><strong>{fullDate(targetDate)}</strong><span>{targetTime}</span></div>
      </div>
      <div className="resize-confirm-choices">
        <button type="button" className="resize-confirm-choice" onClick={onOnlyThis}>
          <span className="resize-confirm-choice-icon"><CalendarClock size={20}/></span>
          <span><strong>{tr('Tylko to wystąpienie', 'Only this occurrence')}</strong><small>{tr('Wyjątek wyłącznie dla tego dnia. Pozostałe wystąpienia nie zmienią terminu.', 'An exception for this day only. Other occurrences keep their dates.')}</small></span><Check size={17}/>
        </button>
        <button type="button" className="resize-confirm-choice" onClick={onAll}>
          <span className="resize-confirm-choice-icon"><Repeat2 size={20}/></span>
          <span><strong>{tr('Wszystkie wystąpienia', 'All occurrences')}</strong><small>{allHint ?? (shiftsWeekdays ? tr('Zmień godzinę i przesuń dni tygodnia całej serii. ', 'Change the time and shift the weekdays of the whole series. ') : tr('Zmień godzinę całej serii. ', 'Change the time of the whole series. '))}{tr('Wcześniejsze wyjątki terminu zostaną zastąpione.', 'Earlier date exceptions will be replaced.')}</small></span><Check size={17}/>
        </button>
      </div>
      <div className="modal-bottom"><span className="modal-tip">{tr('Zapis nastąpi dopiero po Twoim wyborze.', 'Changes are saved only after you choose.')}</span>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>{tr('Anuluj', 'Cancel')}</button></div>
    </div>
  </div>;
}
