import { useEffect, useMemo, useState } from 'react';
import { readMomentumKey, saveMomentumKey } from '../lib/offlineDatabase';
import { ArrowRight, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Compass, Flame, Info, Lightbulb, ListChecks, PencilLine, ShieldCheck, Sparkles, TrendingUp, Trophy, Wallet } from 'lucide-react';
import { fullDate, mondayOf, parseDate, shiftDate, shortWeekday, todayKey } from '../lib/date';
import { REALITY_STORAGE_KEY, parseActualOverrides } from '../lib/planReality';
import { buildWeeklyReport, compactWeekMinutes, mostRecentReviewMonday, percentageChange } from '../lib/weeklyReview';
import { resolveCategories } from '../lib/storage';
import { CategoryBadge, TaskVisual } from './VisualIdentity';
import type { AppData, CategoryKey } from '../types';
import type { FocusRecord } from '../lib/focus';

const PLAN_KEY = 'momentum.weekly-plan.v1';
type PlanningState = { checks: Record<string, boolean>; notes: Record<string, string> };
const emptyPlanning: PlanningState = { checks: {}, notes: {} };
function loadPlanning(): PlanningState {
  try {
    const data: unknown = JSON.parse(readMomentumKey(PLAN_KEY) || 'null');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return emptyPlanning;
    const parsed = data as Partial<PlanningState>;
    return { checks: parsed.checks && typeof parsed.checks === 'object' ? parsed.checks : {}, notes: parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {} };
  } catch { return emptyPlanning; }
}
function displayDate(date: string) {
  return new Intl.DateTimeFormat('pl-PL', {day: 'numeric', month: 'short'}).format(parseDate(date));
}
function metricTrend(value: number, previous: number, unit: string) {
  const change = percentageChange(value, previous);
  return change === null ? 'Brak danych porównawczych' : `${change > 0 ? '+' : ''}${change}% ${unit}`;
}
function ReviewStat({ label, value, sub, icon: Icon, className }: {label: string; value: string; sub: string; icon: typeof Trophy; className: string}) {
  return <div className="wr-stat"><div className={`wr-stat-icon ${className}`}><Icon size={19}/></div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}

export function WeeklyReview({ data, focusHistory, onOpenNextWeek }: {data: AppData; focusHistory: FocusRecord[]; onOpenNextWeek: (nextMonday: string) => void}) {
  const [weekStart, setWeekStart] = useState(() => mostRecentReviewMonday());
  const [plan, setPlan] = useState<PlanningState>(loadPlanning);
  const [overrides] = useState(() => {
    try { return parseActualOverrides(readMomentumKey(REALITY_STORAGE_KEY)); }
    catch { return {}; }
  });
  const today = todayKey();
  const maxStart = mostRecentReviewMonday(today);
  const report = useMemo(() => buildWeeklyReport(data, focusHistory, overrides, weekStart), [data, focusHistory, overrides, weekStart]);
  const prior = useMemo(() => buildWeeklyReport(data, focusHistory, overrides, shiftDate(weekStart, -7)), [data, focusHistory, overrides, weekStart]);
  const categories = useMemo(() => resolveCategories(data.categories), [data.categories]);
  const nextMonday = shiftDate(mondayOf(today), 7);
  const isCurrentWeek = weekStart === mondayOf(today);
  const bestDay = report.bestDay && (report.bestDay.completedCount > 0 || report.bestDay.actualMinutes > 0) ? report.bestDay : null;
  const periodMeasured = report.measuredCount > 0 || report.measuredMinutes > 0;
  const trendMax = Math.max(1, ...report.days.map(day => day.completedCount));
  const maximumCategory = Math.max(1, ...report.categories.flatMap(category => [category.planned, category.measured]));
  const nextPlanNote = plan.notes[nextMonday] ?? '';
  const nextPlanChecks = report.tips.filter(tip => plan.checks[`${nextMonday}:${tip.id}`]).length;
  const changingWeek = (delta: number) => {
    const next = shiftDate(weekStart, delta * 7);
    if (next <= maxStart) setWeekStart(next);
  };
  useEffect(() => {
    try { saveMomentumKey(PLAN_KEY, JSON.stringify(plan)); }
    catch { /* Przegląd pozostaje dostępny także gdy zapis lokalny jest zablokowany. */ }
  }, [plan]);

  return <div className="wr-page">
    <section className="wr-hero">
      <div className="wr-hero-copy">
        <span className="wr-hero-eyebrow"><Sparkles size={14}/> TWOJE TYGODNIOWE PODSUMOWANIE</span>
        <h2>Dobry tydzień to nie tylko <em>pełny kalendarz.</em></h2>
        <p>Zobacz, co rzeczywiście zrobiłeś, co działało najlepiej i jak spokojniej zaplanować kolejny tydzień.</p>
        <div className="wr-hero-period"><CalendarDays size={17}/><span>{displayDate(report.start)} – {displayDate(report.end)}</span><small>{isCurrentWeek ? 'Trwający tydzień' : 'Zakończony tydzień'}</small></div>
      </div>
      <div className="wr-hero-ornament" aria-hidden="true"><div><Trophy size={54}/></div><span>✦</span></div>
    </section>

    <div className="wr-toolbar">
      <div><span className="eyebrow">PRZEGLĄD TYGODNIA</span><h3>{displayDate(report.start)} – {displayDate(report.end)}</h3></div>
      <div className="wr-toolbar-actions">
        <button type="button" className="wr-step" onClick={() => changingWeek(-1)} title="Poprzedni tydzień" aria-label="Poprzedni tydzień"><ChevronLeft size={18}/></button>
        <button type="button" className="wr-today" onClick={() => setWeekStart(maxStart)} disabled={weekStart === maxStart}>Najnowszy raport</button>
        <button type="button" className="wr-step" disabled={weekStart >= maxStart} onClick={() => changingWeek(1)} title="Następny tydzień" aria-label="Następny tydzień"><ChevronRight size={18}/></button>
      </div>
    </div>

    <div className="wr-stats">
      <ReviewStat label="Ukończone aktywności" value={`${report.completed} / ${report.scheduled}`} sub={report.completionRate === null ? 'Brak zaplanowanych zadań' : `${report.completionRate}% realizacji planu`} icon={CheckCircle2} className="wr-icon--green"/>
      <ReviewStat label="Zmierzony czas" value={periodMeasured ? compactWeekMinutes(report.measuredMinutes) : 'Brak pomiarów'} sub="Focus Mode + wpisy ręczne" icon={Clock3} className="wr-icon--violet"/>
      <ReviewStat label="Ukończone rutyny" value={`${report.completedRoutines} / ${report.scheduledRoutines}`} sub="Wystąpienia w tym tygodniu" icon={Flame} className="wr-icon--coral"/>
      <ReviewStat label="Dni z postępem" value={`${report.activeDays} / 7`} sub="Bez karania za dni odpoczynku" icon={ShieldCheck} className="wr-icon--amber"/>
    </div>

    <div className="wr-overview-grid">
      <section className="wr-card wr-chart-card">
        <div className="wr-section-heading"><div><span className="eyebrow">DZIEŃ PO DNIU</span><h3>Rytm Twojego tygodnia</h3><p>Liczba ukończonych zadań i rutyn w poszczególne dni.</p></div><TrendingUp size={19}/></div>
        <div className="wr-activity-plot">
          {report.days.map(day => <div className={`wr-day-column ${day.date === today ? 'is-today' : ''}`} key={day.date} title={`${fullDate(day.date)}: ${day.completedCount} wykonane`}>
            <span className="wr-day-count">{day.completedCount}</span>
            <div className="wr-day-track"><span style={{height: `${day.completedCount > 0 ? Math.max(12, 100 * day.completedCount / trendMax) : 0}%`}}/></div>
            <span className="wr-day-label">{shortWeekday(day.date)}</span>
          </div>)}
        </div>
        <div className="wr-best-day">{bestDay ? <><span className="wr-best-medal"><Trophy size={18}/></span><div><strong>Najaktywniejszy dzień: {fullDate(bestDay.date)}</strong><small>{bestDay.completedCount} ukończonych aktywności{bestDay.actualMinutes > 0 ? ` · ${compactWeekMinutes(bestDay.actualMinutes)} zmierzonego czasu` : ''}</small></div></> : <><span className="wr-best-medal"><Compass size={18}/></span><div><strong>Twój najlepszy dzień dopiero przed Tobą</strong><small>Wybierz jedną rzecz i zacznij od niej.</small></div></>}</div>
      </section>
      <section className="wr-card wr-trends-card">
        <div className="wr-section-heading"><div><span className="eyebrow">TRENDY</span><h3>W porównaniu z poprzednim</h3><p>Małe zmiany dają dobry obraz regularności.</p></div><TrendingUp size={19}/></div>
        <div className="wr-trend-rows">
          <div className="wr-trend-row"><span className="wr-trend-icon wr-trend-icon--violet"><ListChecks size={19}/></span><div><strong>Wykonane działania</strong><small>{prior.completed} → {report.completed}</small></div><span className="wr-trend-value">{metricTrend(report.completed, prior.completed, 'względem poprzedniego tygodnia')}</span></div>
          <div className="wr-trend-row"><span className="wr-trend-icon wr-trend-icon--green"><Clock3 size={19}/></span><div><strong>Zmierzony czas</strong><small>{prior.measuredCount > 0 || prior.measuredMinutes > 0 ? compactWeekMinutes(prior.measuredMinutes) : 'Brak danych'} → {periodMeasured ? compactWeekMinutes(report.measuredMinutes) : 'Brak danych'}</small></div><span className="wr-trend-value">{periodMeasured && (prior.measuredCount > 0 || prior.measuredMinutes > 0) ? metricTrend(report.measuredMinutes, prior.measuredMinutes, 'zmierzonego czasu') : 'Brak porównywalnych pomiarów'}</span></div>
          <div className="wr-trend-row"><span className="wr-trend-icon wr-trend-icon--amber"><Flame size={19}/></span><div><strong>Zakończone rutyny</strong><small>{prior.completedRoutines} → {report.completedRoutines}</small></div><span className="wr-trend-value">{metricTrend(report.completedRoutines, prior.completedRoutines, 'wykonań')}</span></div>
        </div>
        <div className="wr-neutral-note"><Info size={15}/> Spadek wyniku nie oznacza porażki. Porównania pomagają lepiej planować, nie oceniają odpoczynku.</div>
      </section>
    </div>

    <section className="wr-card wr-category-section">
      <div className="wr-section-heading"><div><span className="eyebrow">TWÓJ CZAS W TRZECH KOLORACH</span><h3>Na co poszła energia?</h3><p>Osobno plan i zmierzony czas, bez automatycznego dopisywania minut za ukończenie.</p></div><Wallet size={20}/></div>
      <div className="wr-category-grid">
        {report.categories.map(category => {
          const style = categories[category.category] ?? categories.unpaid;
          return <div className="wr-category" key={category.category} style={{'--wr-category-color': style.color, '--wr-category-tint': style.tint} as React.CSSProperties}>
            <CategoryBadge category={category.category} categories={categories}/>
            <div className="wr-category-values"><div><small>Plan</small><strong>{compactWeekMinutes(category.planned)}</strong></div><div><small>Pomiar</small><strong>{category.measuredCount > 0 ? compactWeekMinutes(category.measured) : '—'}</strong></div></div>
            <div className="wr-bar-pair"><div className="wr-bar-track" title="Plan"><span style={{width:`${Math.min(100, category.planned / maximumCategory * 100)}%`}}/></div><div className="wr-bar-track wr-bar-track--actual" title="Rzeczywisty czas"><span style={{width:`${Math.min(100, category.measured / maximumCategory * 100)}%`}}/></div></div>
            <small className="wr-category-note">{category.completedCount} / {category.scheduledCount} aktywności wykonanych · {category.measuredCount} zmierzonych</small>
          </div>;
        })}
      </div>
      <div className="wr-neutral-note"><Info size={15}/> Nieprzypisane sesje Focus mogą zwiększać łączny czas pomiaru, ale nie są przypisywane do kategorii bez rozpoznanego zadania.</div>
    </section>

    <section className="wr-card wr-routine-section">
      <div className="wr-section-heading"><div><span className="eyebrow">SYSTEMATYCZNOŚĆ</span><h3>Które rutyny udało się utrzymać?</h3><p>Każda rutyna ma własną liczbę zaplanowanych wystąpień.</p></div><Flame size={19}/></div>
      {report.routines.length > 0 ? <div className="wr-routine-grid">{report.routines.map(routine => {
        const template = data.routines.find(item => item.id === routine.id);
        const category: CategoryKey = template?.category ?? 'unpaid';
        const percent = Math.round(routine.completed / Math.max(1, routine.planned) * 100);
        return <div className="wr-routine" key={routine.id}>
          <TaskVisual icon={routine.icon} image={routine.image} category={category} categories={categories} size="small"/>
          <div className="wr-routine-main"><div><strong>{routine.title}</strong><span>{routine.completed} / {routine.planned} · {percent}%</span></div><div className="wr-routine-track"><span style={{width:`${percent}%`,background:categories[category]?.color ?? '#7461e8'}}/></div></div>
        </div>;
      })}</div> : <div className="wr-empty">W wybranym tygodniu nie było zaplanowanych rutyn.</div>}
    </section>

    <section className="wr-card wr-next-section">
      <div className="wr-section-heading"><div><span className="eyebrow">NADCHODZĄCY TYDZIEŃ</span><h3>Co warto zrobić inaczej?</h3><p>Podpowiedzi wynikają z Twoich danych. Wybierz te, które mają sens dla Ciebie.</p></div><Lightbulb size={20}/></div>
      <div className="wr-next-grid"><div className="wr-next-advice">
        {report.tips.map(tip => <label className="wr-advice" key={tip.id}><input type="checkbox" checked={!!plan.checks[`${nextMonday}:${tip.id}`]} onChange={event => setPlan(current => ({...current,checks:{...current.checks,[`${nextMonday}:${tip.id}`]:event.target.checked}}))}/><span className="wr-advice-mark"><Check size={14}/></span><span><strong>{tip.title}</strong><small>{tip.detail}</small></span></label>)}
        <div className="wr-advice-progress">{nextPlanChecks} / {report.tips.length} pomysłów wybranych na kolejny tydzień</div>
      </div><div className="wr-plan-card">
        <div className="wr-plan-header"><span><PencilLine size={20}/></span><div><strong>Twój plan na kolejny tydzień</strong><small>{displayDate(nextMonday)} – {displayDate(shiftDate(nextMonday,6))}</small></div></div>
        <label htmlFor="wr-next-priorities">Najważniejsze priorytety</label>
        <textarea id="wr-next-priorities" placeholder={'1. Najważniejsza rzecz\n2. Projekt, który chcę rozwinąć\n3. Co zrobię dla siebie'} maxLength={1000} value={nextPlanNote} onChange={event => setPlan(current => ({...current,notes:{...current.notes,[nextMonday]:event.target.value}}))} rows={5}/>
        <small>Notatka i zaznaczone pomysły zapisują się lokalnie.</small>
        <button type="button" className="wr-plan-cta" onClick={() => onOpenNextWeek(nextMonday)}>Otwórz kalendarz następnego tygodnia <ArrowRight size={17}/></button>
      </div></div>
    </section>
  </div>;
}
