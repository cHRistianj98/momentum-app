import { useEffect, useMemo, useState } from 'react';
import { readMomentumKey, saveMomentumKey } from '../lib/offlineDatabase';
import { Activity, CalendarDays, CheckCircle2, Clock3, Info, PencilLine, RotateCcw, Target, TrendingUp } from 'lucide-react';
import { fullDate, parseDate, shiftDate, todayKey } from '../lib/date';
import { locale, plural, tr, useLanguage } from '../lib/i18n';
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
      <input aria-label={tr(`Rzeczywisty czas: ${item.title} (w minutach)`, `Actual time: ${item.title} (in minutes)`)} inputMode="numeric" type="text" pattern="[0-9]*" placeholder="—" value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
      <span>min</span>
    </label>
    {item.source === 'manual' && <button className="pv-reset" type="button" onClick={onClear} title={tr('Usuń ręczny pomiar i przywróć Focus, jeśli jest dostępny', 'Remove the manual entry and restore the Focus time, if available')} aria-label={tr(`Usuń ręczny czas dla ${item.title}`, `Remove manual time for ${item.title}`)}><RotateCcw size={14} /></button>}
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
  const language = useLanguage();
  const buckets = useMemo(() => {
    if (period === 'week') return days.map(day => ({ id: day.date, label: new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(parseDate(day.date)).replace('.', ''), dates: [day.date], planned: day.plannedMinutes, actual: day.actualMinutes, completed: day.completedCount, total: day.plannedCount }));
    const groups: typeof days[] = [];
    for (let i = 0; i < days.length; i += 7) groups.push(days.slice(i, i + 7));
    return groups.map((group, i) => ({ id: group[group.length - 1].date, label: tr(`Tydz. ${i + 1}`, `Wk ${i + 1}`), dates: group.map(day => day.date), planned: group.reduce((total, day) => total + day.plannedMinutes, 0), actual: group.reduce((total, day) => total + day.actualMinutes, 0), completed: group.reduce((total, day) => total + day.completedCount, 0), total: group.reduce((total, day) => total + day.plannedCount, 0) }));
  }, [days, period, language]);
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
    : `${new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(parseDate(detailedDays[0].date))} – ${new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(parseDate(detailedDays[detailedDays.length - 1].date))}`;
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

  return <section className="insight-card pv-section" aria-label={tr('Plan kontra rzeczywistość', 'Plan vs reality')}>
    <div className="pv-topline">
      <div className="insight-card-title pv-title"><div><span className="eyebrow">{tr('PLAN VS RZECZYWISTOŚĆ', 'PLAN VS REALITY')}</span><h3>{tr('Jak rzeczywiście wygląda Twój czas?', 'What does your time really look like?')}</h3><p>{tr('Porównuj zamiary z wykonaniem i ucz się lepiej planować — bez oceniania odpoczynku.', 'Compare what you intended with what you did, and learn to plan better — without judging rest.')}</p></div><div className="pv-top-icon"><Target size={23}/></div></div>
      <div className="analytics-switch" aria-label={tr('Okres porównania', 'Comparison period')}><button type="button" className={period === 'week' ? 'active' : ''} onClick={() => { setPeriod('week'); setSelectedDate(today); }}>{tr('7 dni', '7 days')}</button><button type="button" className={period === 'month' ? 'active' : ''} onClick={() => { setPeriod('month'); setSelectedDate(today); }}>{tr('30 dni', '30 days')}</button></div>
    </div>

    <div className="pv-metrics">
      <div className="pv-metric"><span className="pv-metric-icon pv-metric-icon--planned"><CalendarDays size={18}/></span><small>{tr('Zaplanowany czas', 'Planned time')}</small><strong>{compactMinutes(summary.plannedMinutes)}</strong><span>{tr('Bloki w kalendarzu', 'Calendar blocks')}</span></div>
      <div className="pv-metric"><span className="pv-metric-icon pv-metric-icon--actual"><Clock3 size={18}/></span><small>{tr('Zarejestrowany czas', 'Recorded time')}</small><strong>{hasMeasurements ? compactMinutes(summary.actualMinutes) : tr('Brak pomiarów', 'No measurements')}</strong><span>{tr('Focus + wpisy ręczne', 'Focus + manual entries')}</span></div>
      <div className="pv-metric"><span className="pv-metric-icon pv-metric-icon--done"><CheckCircle2 size={18}/></span><small>{tr('Wykonane aktywności', 'Completed activities')}</small><strong>{summary.completedCount} / {summary.plannedCount}</strong><span>{summary.completion === null ? tr('Brak zaplanowanych', 'Nothing planned') : tr(`${summary.completion}% ukończonych`, `${summary.completion}% completed`)}</span></div>
      <div className="pv-metric"><span className="pv-metric-icon pv-metric-icon--accuracy"><TrendingUp size={18}/></span><small>{tr('Dokładność szacowania', 'Estimate accuracy')}</small><strong>{summary.accuracy === null ? '—' : `${summary.accuracy}%`}</strong><span>{summary.accuracy === null ? tr('Dodaj pomiary czasu', 'Add time measurements') : tr('Dla zmierzonych bloków', 'For measured blocks')}</span></div>
    </div>

    <div className="pv-grid">
      <div className="pv-trend-panel">
        <div className="pv-panel-title"><div><strong>{period === 'week' ? tr('Ostatnie 7 dni', 'Last 7 days') : tr('Ostatnie 30 dni', 'Last 30 days')}</strong><small>{tr('Wybierz dzień lub tydzień na wykresie', 'Pick a day or week on the chart')}</small></div><span className="pv-period-note"><Activity size={14}/> {measuredDayCount} {plural(measuredDayCount, ['dni z pomiarem', 'dni z pomiarem', 'dni z pomiarem'], ['day with measurements', 'days with measurements'])}</span></div>
        <div className="pv-legend"><span><i className="pv-dot pv-dot--plan"/> Plan</span><span><i className="pv-dot pv-dot--actual"/> {tr('Zmierzony czas', 'Measured time')}</span></div>
        <div className={`pv-chart pv-chart--${period}`} role="group" aria-label={tr('Trend zaplanowanego i rzeczywistego czasu', 'Planned vs actual time trend')}>
          {buckets.map(bucket => {
            const isSelected = bucket.dates.includes(chosen.date);
            return <button className={`pv-chart-column ${isSelected ? 'is-selected' : ''}`} type="button" key={bucket.id} onClick={() => setSelectedDate(bucket.dates.includes(chosen.date) ? chosen.date : bucket.id)} title={tr(`${bucket.label}: plan ${compactMinutes(bucket.planned)}, pomiar ${compactMinutes(bucket.actual)}, wykonane ${bucket.completed}/${bucket.total}`, `${bucket.label}: plan ${compactMinutes(bucket.planned)}, measured ${compactMinutes(bucket.actual)}, done ${bucket.completed}/${bucket.total}`)}>
              <span className="pv-bar-values"><span>{bucket.completed}/{bucket.total}</span></span>
              <span className="pv-bar-stage"><i className="pv-bar-plan" style={{ height: `${bucket.planned ? Math.max(4, bucket.planned / maxValue * 100) : 0}%` }}/><i className="pv-bar-actual" style={{ height: `${bucket.actual ? Math.max(4, bucket.actual / maxValue * 100) : 0}%` }}/></span>
              <span className="pv-bar-label">{bucket.label}</span>
            </button>;
          })}
        </div>
        <div className="pv-measurement-summary">
          <div><strong>{summary.coverage === null ? '—' : `${summary.coverage}%`}</strong><span>{tr('pokrycia planu pomiarem', 'of the plan covered by measurements')}</span></div>
          <div><strong>{summary.accuracy === null ? '—' : `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${compactMinutes(Math.abs(delta))}`}</strong><span>{tr('różnica w zmierzonych blokach', 'difference in measured blocks')}</span></div>
        </div>
        <p className="pv-neutral-note"><Info size={15}/> {tr('Odznaczenie nie oznacza pomiaru czasu. Bez sesji Focus lub wpisu ręcznego nie znamy faktycznej długości pracy. Historia zwykłych tasków bazuje na ich aktualnym statusie i zaplanowanej dacie.', 'Checking something off doesn’t measure time. Without a Focus session or a manual entry, we don’t know how long the work actually took. History for regular tasks is based on their current status and scheduled date.')}</p>
      </div>

      <div className="pv-detail-panel">
        <div className="pv-panel-title"><div><strong>{detailHeading}</strong><small>{tr('Wpisz rzeczywisty czas w minutach lub użyj Focus Mode', 'Enter the actual time in minutes or use Focus Mode')}</small></div><span className="pv-detail-count">{detailedCompleted}/{detailedCount} {tr('wykonane', 'done')}</span></div>
        <div className="pv-detail-summary"><span><CalendarDays size={13}/> Plan: {compactMinutes(detailedPlanned)}</span><span><Clock3 size={13}/> {tr('Zmierzono:', 'Measured:')} {compactMinutes(detailedActual)}</span></div>
        <div className="pv-entries">
          {detailedItems.length ? detailedItems.map(item => <div className="pv-entry" key={item.key}>
            <span className={`pv-entry-status ${item.done ? 'is-complete' : ''}`} title={item.done ? tr('Wykonane', 'Done') : tr('Niewykonane', 'Not done')}>{item.done ? <CheckCircle2 size={17}/> : <span/>}</span>
            <div className="pv-entry-main"><strong>{item.title}</strong><small>{detailedDays.length > 1 ? `${item.date.slice(5)} · ` : ''}{item.time ? `${item.time} · ` : ''}{item.plannedMinutes ? `plan ${compactMinutes(item.plannedMinutes)}` : tr('bez godziny', 'no set time')} · {item.source === 'focus' ? 'Focus Mode' : item.source === 'manual' ? tr('pomiar ręczny', 'manual entry') : tr('brak pomiaru', 'not measured')}</small></div>
            <TimeEditor key={item.key} item={item} onSave={minutes => changeManual(item.key, minutes)} onClear={() => changeManual(item.key, null)} />
          </div>) : <div className="pv-no-tasks"><CalendarDays size={25}/><strong>{tr('Brak zaplanowanych aktywności', 'No planned activities')}</strong><span>{tr('Wybierz inny dzień albo dodaj blok w kalendarzu.', 'Pick another day or add a block in the calendar.')}</span></div>}
          {detailedExtraFocus > 0 && <div className="pv-extra-focus"><Clock3 size={16}/> <span>{tr('Focus poza planem', 'Focus outside the plan')}</span><strong>{compactMinutes(detailedExtraFocus)}</strong></div>}
        </div>
        <div className="pv-detail-footer"><PencilLine size={14}/> {tr('Wpisany czas zastępuje automatyczny pomiar Focus dla tej aktywności. Możesz go cofnąć ikoną', 'An entered time replaces the automatic Focus measurement for this activity. You can undo it with the')} <RotateCcw size={12}/>{tr('. Zmiana nie wpływa na XP ani termin.', ' icon. This doesn’t affect XP or the scheduled date.')}</div>
      </div>
    </div>
  </section>;
}
