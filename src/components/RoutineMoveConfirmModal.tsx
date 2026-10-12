import { ArrowRight, CalendarClock, Check, Repeat2, X } from 'lucide-react';
import { fullDate } from '../lib/date';

interface Props {
  title: string;
  previousDate: string;
  previousTime: string;
  targetDate: string;
  targetTime: string;
  shiftsWeekdays: boolean;
  onOnlyThis: () => void;
  onAll: () => void;
  onCancel: () => void;
}

export function RoutineMoveConfirmModal({ title, previousDate, previousTime, targetDate, targetTime, shiftsWeekdays, onOnlyThis, onAll, onCancel }: Props) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onCancel(); }}>
    <div className="modal resize-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="routine-move-title">
      <div className="modal-heading"><div><span className="eyebrow"><Repeat2 size={14}/> RUTYNA CYKLICZNA</span><h2 id="routine-move-title">Przenieść całą serię?</h2></div>
        <button type="button" className="icon-btn" aria-label="Zamknij" onClick={onCancel}><X size={20}/></button></div>
      <p className="resize-confirm-intro">Przesuwasz <strong>„{title}”</strong>. Zdecyduj, czy przenieść jedno wystąpienie, czy zmienić harmonogram wszystkich.</p>
      <div className="routine-move-summary">
        <div><small>WCZEŚNIEJ</small><strong>{fullDate(previousDate)}</strong><span>{previousTime}</span></div>
        <ArrowRight size={20}/>
        <div><small>NOWY TERMIN</small><strong>{fullDate(targetDate)}</strong><span>{targetTime}</span></div>
      </div>
      <div className="resize-confirm-choices">
        <button type="button" className="resize-confirm-choice" onClick={onOnlyThis}>
          <span className="resize-confirm-choice-icon"><CalendarClock size={20}/></span>
          <span><strong>Tylko to wystąpienie</strong><small>Wyjątek wyłącznie dla tego dnia. Pozostałe wystąpienia nie zmienią terminu.</small></span><Check size={17}/>
        </button>
        <button type="button" className="resize-confirm-choice" onClick={onAll}>
          <span className="resize-confirm-choice-icon"><Repeat2 size={20}/></span>
          <span><strong>Wszystkie wystąpienia</strong><small>{shiftsWeekdays ? 'Zmień godzinę i przesuń dni tygodnia całej serii. ' : 'Zmień godzinę całej serii. '}Wcześniejsze wyjątki terminu zostaną zastąpione.</small></span><Check size={17}/>
        </button>
      </div>
      <div className="modal-bottom"><span className="modal-tip">Zapis nastąpi dopiero po Twoim wyborze.</span>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Anuluj</button></div>
    </div>
  </div>;
}
