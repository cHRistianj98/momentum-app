import { useEffect, useMemo, useState } from 'react';
import { readMomentumKey, saveMomentumKey } from '../lib/offlineDatabase';
import { Activity, CalendarDays, CheckCircle2, Clock3, Info, PencilLine, RotateCcw, Target, TrendingUp } from 'lucide-react';
import { fullDate, parseDate, shiftDate, todayKey } from '../lib/date';
import { buildDailyReality, parseActualOverrides, REALITY_STORAGE_KEY, summarizeReality, type ActualOverrides, type RealityItem } from '../lib/planReality';
import type { FocusRecord } from '../lib/focus';
import type { AppData } from '../types';

const compactMinutes = (minutes: number): string => {
  const rounded = Math.round(minutes);
  return rounded >= 60 ? `${Math.floor(rounded / 60)} h ${rounded % 60 ? `${rounded % 60} min` : ''}`.trim() : `${rounded} min`;
};

function TimeEditor({ item, onSave, onClear }: { item: RealityItem; onSave: (value: number) => void; onClear: () => void }) {
  const [draft, setDraft] = useState(item.actualMinutes === null ? '' : String(Math.round(item.actualMinutes)));
  useEffect(() => { setDraft(item.actualMinutes === null ? '' : String(Math.round(item.actualMinutes))); }, [item.key, item.actualMinutes]);
  function commit() {
    const cleaned = draft.trim();
    if (!cleaned) { if (item.source === 'manual') onClear(); return; }
    const numeric = Number(cleaned.replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1440) {
      setDraft(item.actualMinutes === null ? '' : String(Math.round(item.actualMinutes)));
      return;
    }
    const normalized = Math.round(numeric);
    if (item.source !== 'manual' && item.actualMinutes !== null && Math.round(item.actualMinutes) === normalized) return;
    onSave(normalized);
  }
  return <div className="pv-entry-control">
    <label className="pv-minute-input">
      <input aria-label={`Rzeczywisty czas: ${item.title} (w minutach)`} inputMode="numeric" type="text" pattern="[0-9]*" placeholder="—" value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
      <span>min</span>
    </label>
    {item.source === 'manual' && <button className="pv-reset" type="button" onClick={onClear} title="Usuń ręczny pomiar i przywróć Focus, jeśli jest dostępny" aria-label={`Usuń ręczny czas dla ${item.title}`}><RotateCcw size={14} /></button>}
  </div>;
}

export function PlanReality({ data, focusHistory }: { data: AppData; focusHistory: FocusRecord[] }) {
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [overrides, setOverrides] = useState<ActualOverrides>(() => {
    try { return parseActualOverrides(readMomentumKey(REALITY_STORAGE_KEY)); }
    catch { return {}; }
  });
  useEffect(() => {
    try { saveMomentumKey(REALITY_STORAGE_KEY, JSON.stringify(overrides)); }
    catch (error) { console.warn('Nie udało się zapisać rzeczywistych czasów:', error); }
  }, [overrides]);

  const today = todayKey();
  const dates = useMemo(() => {
    const count = period === 'week' ? 7 : 30;
    return Array.from({ length: count }, (_, index) => shiftDate(today, index - count + 1));
  }, [period, today]);
  const days = useMemo(() => buildDailyReality(data, focusHistory, overrides, dates), [data, focusHistory, overrides, dates]);
  const summary = useMemo(() => summarizeReality(days), [days]);
  const chosen = days.find(day => day.date === selectedDate) ?? days[days.length - 1];
  const buckets = useMemo(() => {
    if (period === 'week') return days.map(day => ({ id: day.date, label: new Intl.DateTimeFormat('pl-PL', { weekday: 'short' }).format(parseDate(day.date)).replace('.', ''), dates: [day.date], planned: day.plannedMinutes, actual: day.actualMinutes, completed: day.completedCount, total: day.plannedCount }));
    const groups: typeof days[] = [];
    for (let i = 0; i < days.length; i += 7) groups.push(days.slice(i, i + 7));
    return groups.map((group, i) => ({ id: group[group.length - 1].date, label: `Tydz. ${i + 1}`, dates: group.map(day => day.date), planned: group.reduce((total, day) => total + day.plannedMinutes, 0), actual: group.reduce((total, day) => total + day.actualMinutes, 0), completed: group.reduce((total, day) => total + day.completedCount, 0), total: group.reduce((total, day) => total + day.plannedCount, 0) }));
  }, [days, period]);
  const selectedBucket = buckets.find(bucket => bucket.dates.includes(chosen.date)) ?? buckets[buckets.length - 1];
  const detailedDays = days.filter(day => selectedBucket.dates.includes(day.date));
  const detailedItems = detailedDays.flatMap(day => day.items);
  const detailedPlanned = detailedDays.reduce((sum, day) => sum + day.plannedMinutes, 0);
  const detailedActual = detailedDays.reduce((sum, day) => sum + day.actualMinutes, 0);
  const detailedCompleted = detailedDays.reduce((sum, day) => sum + day.completedCount, 0);
  const detailedCount = detailedDays.reduce((sum, day) => sum + day.plannedCount, 0);
  const detailedExtraFocus = detailedDays.reduce((sum, day) => sum + day.extraFocusMinutes, 0);
  const detailHeading = detailedDays.length === 1
    ? fullDate(chosen.date)
    : `${new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' }).format(parseDate(detailedDays[0].date))} – ${new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short' }).format(parseDate(detailedDays[detailedDays.length - 1].date))}`;
  const maxValue = Math.max(1, ...buckets.flatMap(bucket => [bucket.planned, bucket.actual]));
  const measuredDayCount = days.filter(day => day.measuredCount > 0 || day.extraFocusMinutes > 0).length;
  const hasMeasurements = summary.measuredCount > 0 || summary.actualMinutes > 0;
  const delta = summary.actualMinutes - summary.comparedPlanMinutes;

  const changeManual = (key: string, minutes: number | null) => setOverrides(previous => {
    const next = { ...previous };
    if (minutes === null) delete next[key];
    else next[key] = minutes;
    return next;
  });

  return <section className="insight-card pv-section" aria-label="Plan kontra rzeczywistość">
    <div className="pv-topline">
      <div className="insight-card-title pv-title"><div><span className="eyebrow">PLAN VS RZECZYWISTOŚĆ</span><h3>Jak rzeczywiście wygląda Twój czas?</h3><p>Porównuj zamiary z wykonaniem i ucz się lepiej planować — bez oceniania odpoczynku.</p></div><div className="pv-top-icon"><Target size={23}/></div></div>
      <div className="analytics-switch" aria-label="Okres porównania"><button type="button" className={period === 'week' ? 'active' : ''} onClick={() => { setPeriod('week'); setSelectedDate(today); }}>7 dni</button><button type="button" className={period === 'month' ? 'active' : ''} onClick={() => { setPeriod('month'); setSelectedDate(today); }}>30 dni</button></div>
    </div>

    <div className="pv-metrics">
      <div className="pv-metric"><span className="pv-metric-icon pv-metric-icon--planned"><CalendarDays size={18}/></span><small>Zaplanowany czas</small><strong>{compactMinutes(summary.plannedMinutes)}</strong><span>Bloki w kalendarzu</span></div>
      <div className="pv-metric"><span className="pv-metric-icon pv-metric-icon--actual"><Clock3 size={18}/></span><small>Zarejestrowany czas</small><strong>{hasMeasurements ? compactMinutes(summary.actualMinutes) : 'Brak pomiarów'}</strong><span>Focus + wpisy ręczne</span></div>
      <div className="pv-metric"><span className="pv-metric-icon pv-metric-icon--done"><CheckCircle2 size={18}/></span><small>Wykonane aktywności</small><strong>{summary.completedCount} / {summary.plannedCount}</strong><span>{summary.completion === null ? 'Brak zaplanowanych' : `${summary.completion}% ukończonych`}</span></div>
      <div className="pv-metric"><span className="pv-metric-icon pv-metric-icon--accuracy"><TrendingUp size={18}/></span><small>Dokładność szacowania</small><strong>{summary.accuracy === null ? '—' : `${summary.accuracy}%`}</strong><span>{summary.accuracy === null ? 'Dodaj pomiary czasu' : 'Dla zmierzonych bloków'}</span></div>
    </div>

    <div className="pv-grid">
      <div className="pv-trend-panel">
        <div className="pv-panel-title"><div><strong>{period === 'week' ? 'Ostatnie 7 dni' : 'Ostatnie 30 dni'}</strong><small>Wybierz dzień lub tydzień na wykresie</small></div><span className="pv-period-note"><Activity size={14}/> {measuredDayCount} dni z pomiarem</span></div>
        <div className="pv-legend"><span><i className="pv-dot pv-dot--plan"/> Plan</span><span><i className="pv-dot pv-dot--actual"/> Zmierzony czas</span></div>
        <div className={`pv-chart pv-chart--${period}`} role="group" aria-label="Trend zaplanowanego i rzeczywistego czasu">
          {buckets.map(bucket => {
            const isSelected = bucket.dates.includes(chosen.date);
            return <button className={`pv-chart-column ${isSelected ? 'is-selected' : ''}`} type="button" key={bucket.id} onClick={() => setSelectedDate(bucket.dates.includes(chosen.date) ? chosen.date : bucket.id)} title={`${bucket.label}: plan ${compactMinutes(bucket.planned)}, pomiar ${compactMinutes(bucket.actual)}, wykonane ${bucket.completed}/${bucket.total}`}>
              <span className="pv-bar-values"><span>{bucket.completed}/{bucket.total}</span></span>
              <span className="pv-bar-stage"><i className="pv-bar-plan" style={{ height: `${bucket.planned ? Math.max(4, bucket.planned / maxValue * 100) : 0}%` }}/><i className="pv-bar-actual" style={{ height: `${bucket.actual ? Math.max(4, bucket.actual / maxValue * 100) : 0}%` }}/></span>
              <span className="pv-bar-label">{bucket.label}</span>
            </button>;
          })}
        </div>
        <div className="pv-measurement-summary">
          <div><strong>{summary.coverage === null ? '—' : `${summary.coverage}%`}</strong><span>pokrycia planu pomiarem</span></div>
          <div><strong>{summary.accuracy === null ? '—' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${compactMinutes(Math.abs(delta))}`}</strong><span>różnica w zmierzonych blokach</span></div>
        </div>
        <p className="pv-neutral-note"><Info size={15}/> Odznaczenie nie oznacza pomiaru czasu. Bez sesji Focus lub wpisu ręcznego nie znamy faktycznej długości pracy. Historia zwykłych tasków bazuje na ich aktualnym statusie i zaplanowanej dacie.</p>
      </div>

      <div className="pv-detail-panel">
        <div className="pv-panel-title"><div><strong>{detailHeading}</strong><small>Wpisz rzeczywisty czas w minutach lub użyj Focus Mode</small></div><span className="pv-detail-count">{detailedCompleted}/{detailedCount} wykonane</span></div>
        <div className="pv-detail-summary"><span><CalendarDays size={13}/> Plan: {compactMinutes(detailedPlanned)}</span><span><Clock3 size={13}/> Zmierzono: {compactMinutes(detailedActual)}</span></div>
        <div className="pv-entries">
          {detailedItems.length ? detailedItems.map(item => <div className="pv-entry" key={item.key}>
            <span className={`pv-entry-status ${item.done ? 'is-complete' : ''}`} title={item.done ? 'Wykonane' : 'Niewykonane'}>{item.done ? <CheckCircle2 size={17}/> : <span/>}</span>
            <div className="pv-entry-main"><strong>{item.title}</strong><small>{detailedDays.length > 1 ? `${item.date.slice(5)} · ` : ''}{item.time ? `${item.time} · ` : ''}{item.plannedMinutes ? `plan ${compactMinutes(item.plannedMinutes)}` : 'bez godziny'} · {item.source === 'focus' ? 'Focus Mode' : item.source === 'manual' ? 'pomiar ręczny' : 'brak pomiaru'}</small></div>
            <TimeEditor key={item.key} item={item} onSave={minutes => changeManual(item.key, minutes)} onClear={() => changeManual(item.key, null)} />
          </div>) : <div className="pv-no-tasks"><CalendarDays size={25}/><strong>Brak zaplanowanych aktywności</strong><span>Wybierz inny dzień albo dodaj blok w kalendarzu.</span></div>}
          {detailedExtraFocus > 0 && <div className="pv-extra-focus"><Clock3 size={16}/> <span>Focus poza planem</span><strong>{compactMinutes(detailedExtraFocus)}</strong></div>}
        </div>
        <div className="pv-detail-footer"><PencilLine size={14}/> Wpisany czas zastępuje automatyczny pomiar Focus dla tej aktywności. Możesz go cofnąć ikoną <RotateCcw size={12}/>. Zmiana nie wpływa na XP ani termin.</div>
      </div>
    </div>
  </section>;
}
