import { useEffect, useMemo, useState } from 'react';
import { readMomentumKey, saveMomentumKey } from '../lib/offlineDatabase';
import { ArrowRight, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Clock3, Compass, Crown, Flame, Info, Lightbulb, ListChecks, Minus, PencilLine, Repeat2, ShieldCheck, Sparkles, TrendingDown, TrendingUp, Trophy, Wallet, Zap } from 'lucide-react';
import { fullDate, mondayOf, parseDate, shiftDate, shortWeekday, todayKey } from '../lib/date';
import { REALITY_STORAGE_KEY, parseActualOverrides } from '../lib/planReality';
import { buildWeeklyReport, compactWeekMinutes, mostRecentReviewMonday, percentageChange } from '../lib/weeklyReview';
import { resolveCategories } from '../lib/storage';
import { CategoryBadge, TaskVisual } from './VisualIdentity';
import { DayExportDialog } from './DayExport';
import { buildXpLedger, sumXp } from '../lib/xp';
import { locale, plural, tr, useLanguage } from '../lib/i18n';
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
  return new Intl.DateTimeFormat(locale(), {day: 'numeric', month: 'short'}).format(parseDate(date));
}
const capitalize = (value: string) => value.charAt(0).toLocaleUpperCase(locale()) + value.slice(1);
function rangeLabel(start: string, end: string) {
  const first = parseDate(start);
  const last = parseDate(end);
  const month = (date: Date) => new Intl.DateTimeFormat(locale(), { month: 'short' }).format(date).replace('.', '');
  return first.getMonth() === last.getMonth()
    ? `${first.getDate()}–${last.getDate()} ${month(last)}`
    : `${first.getDate()} ${month(first)} – ${last.getDate()} ${month(last)}`;
}

/** Ocena bez oceniania: ton zależy od realizacji, ale nigdy nie karze za odpoczynek. */
function weekMood(rate: number | null, ongoing: boolean): { title: string; text: string } {
  if (rate === null) return { title: tr('Czysta karta', 'Clean slate'), text: tr('Brak zaplanowanych aktywności. Zacznij od jednego ważnego bloku.', 'No activities planned. Start with one important block.') };
  if (ongoing && rate < 45) return { title: tr('Tydzień w toku', 'Week in progress'), text: tr('Jeszcze wszystko przed Tobą — wybierz jedną rzecz na dziś.', 'Everything is still ahead of you — pick one thing for today.') };
  if (rate >= 90) return { title: tr('Rewelacyjny tydzień!', 'An outstanding week!'), text: tr('Prawie cały plan za Tobą. Zadbaj też o regenerację.', 'You’ve done almost your whole plan. Make time to recover, too.') };
  if (rate >= 70) return { title: tr('Bardzo dobry tydzień', 'A very good week'), text: tr('Większość planu zrealizowana. Zobacz, co zadziałało najlepiej.', 'Most of your plan is done. See what worked best.') };
  if (rate >= 45) return { title: tr('Solidny tydzień', 'A solid week'), text: tr('Dobry rytm. Kilka drobnych zmian może jeszcze pomóc.', 'Good rhythm. A few small changes could help even more.') };
  if (rate > 0) return { title: tr('Dobry początek', 'A good start'), text: tr('Każdy ukończony krok się liczy. Kolejny tydzień zaplanuj lżej.', 'Every completed step counts. Plan a lighter week next time.') };
  return { title: tr('Nowy start', 'A fresh start'), text: tr('Ten tydzień wyglądał inaczej — to w porządku. Wybierz jedną rzecz na kolejny.', 'This week looked different — and that’s okay. Pick one thing for the next one.') };
}

function TrendPill({ current, previous }: { current: number; previous: number }) {
  const change = percentageChange(current, previous);
  if (change === null) return <span className="wrx-pill">{current > 0 ? tr('nowy wynik', 'new result') : tr('brak danych', 'no data')}</span>;
  if (change === 0) return <span className="wrx-pill"><Minus size={12}/> {tr('bez zmian', 'no change')}</span>;
  return <span className={`wrx-pill ${change > 0 ? 'is-up' : 'is-down'}`}>
    {change > 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>} {change > 0 ? '+' : ''}{change}%
  </span>;
}

function ScoreRing({ value }: { value: number | null }) {
  const size = 118;
  const stroke = 11;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = value === null ? 0 : Math.max(0, Math.min(1, value / 100));
  return <div className="wrx-ring" style={{ width: size, height: size }}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="wrx-ring-track"/>
      <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="wrx-ring-value" strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)} transform={`rotate(-90 ${size / 2} ${size / 2})`}/>
    </svg>
    <div className="wrx-ring-content"><strong>{value === null ? '—' : `${value}%`}</strong><small>{tr('realizacji', 'complete')}</small></div>
  </div>;
}

export function WeeklyReview({ data, focusHistory, onOpenNextWeek }: {data: AppData; focusHistory: FocusRecord[]; onOpenNextWeek: (nextMonday: string) => void}) {
  const [weekStart, setWeekStart] = useState(() => mostRecentReviewMonday());
  const [plan, setPlan] = useState<PlanningState>(loadPlanning);
  const [exportOpen, setExportOpen] = useState(false);
  const [overrides] = useState(() => {
    try { return parseActualOverrides(readMomentumKey(REALITY_STORAGE_KEY)); }
    catch { return {}; }
  });
  const today = todayKey();
  const maxStart = mostRecentReviewMonday(today);
  const language = useLanguage();
  const report = useMemo(() => buildWeeklyReport(data, focusHistory, overrides, weekStart), [data, focusHistory, overrides, weekStart, language]);
  const prior = useMemo(() => buildWeeklyReport(data, focusHistory, overrides, shiftDate(weekStart, -7)), [data, focusHistory, overrides, weekStart, language]);
  const categories = useMemo(() => resolveCategories(data.categories), [data.categories, language]);
  const nextMonday = shiftDate(mondayOf(today), 7);
  const isCurrentWeek = weekStart === mondayOf(today);
  const bestDay = report.bestDay && (report.bestDay.completedCount > 0 || report.bestDay.actualMinutes > 0) ? report.bestDay : null;
  const periodMeasured = report.measuredCount > 0 || report.measuredMinutes > 0;
  const trendMax = Math.max(1, ...report.days.map(day => day.completedCount));
  const maximumCategory = Math.max(1, ...report.categories.flatMap(category => [category.planned, category.measured]));
  const nextPlanNote = plan.notes[nextMonday] ?? '';
  const nextPlanChecks = report.tips.filter(tip => plan.checks[`${nextMonday}:${tip.id}`]).length;
  // W trwającym tygodniu liczymy realizację tylko do dzisiaj, żeby przyszłe bloki nie zaniżały wyniku.
  const elapsed = report.days.filter(day => day.date <= today);
  const elapsedPlanned = elapsed.reduce((sum, day) => sum + day.plannedCount, 0);
  const elapsedCompleted = elapsed.reduce((sum, day) => sum + day.completedCount, 0);
  const rate = isCurrentWeek ? (elapsedPlanned ? Math.round(elapsedCompleted / elapsedPlanned * 100) : null) : report.completionRate;
  const mood = weekMood(rate, isCurrentWeek);
  // XP liczy aplikacja (lib/xp.ts); klucze wpisów są takie same jak klucze pozycji planu (task:… / routine:…:dzień).
  const xpLedger = useMemo(() => buildXpLedger(data, focusHistory), [data, focusHistory]);
  const xpByKey = useMemo(() => new Map(xpLedger.map(entry => [entry.key, entry.xp])), [xpLedger]);
  const completedItems = useMemo(() => report.days.flatMap(day => day.items).filter(item => item.done).map(item => {
    const task = item.kind === 'task' ? data.tasks.find(entry => entry.id === item.sourceId) : undefined;
    const routine = item.kind === 'routine' ? data.routines.find(entry => entry.id === item.sourceId) : undefined;
    return { item, xp: xpByKey.get(item.key) ?? 0, icon: task?.icon ?? routine?.icon ?? 'check', image: task?.image ?? routine?.image };
  }), [report, data.tasks, data.routines, xpByKey]);
  const wins = [...completedItems].sort((a, b) => b.xp - a.xp || b.item.plannedMinutes - a.item.plannedMinutes).slice(0, 3);
  // Cały tydzień: zadania, rutyny i premie za sesje Focus z tych dni.
  const weekXp = sumXp(xpLedger, entry => !!entry.date && entry.date >= report.start && entry.date <= report.end);
  const changingWeek = (delta: number) => {
    const next = shiftDate(weekStart, delta * 7);
    if (next <= maxStart) setWeekStart(next);
  };
  useEffect(() => {
    try { saveMomentumKey(PLAN_KEY, JSON.stringify(plan)); }
    catch { /* Przegląd pozostaje dostępny także gdy zapis lokalny jest zablokowany. */ }
  }, [plan]);

  return <div className="wr-page wrx-page">
    <section className="wrx-hero">
      <div className="wrx-hero-nav">
        <button type="button" className="wrx-hero-step" onClick={() => changingWeek(-1)} aria-label={tr('Poprzedni tydzień', 'Previous week')}><ChevronLeft size={18}/></button>
        <div className="wrx-hero-period">
          <span><CalendarDays size={13}/> {isCurrentWeek ? tr('TRWAJĄCY TYDZIEŃ', 'CURRENT WEEK') : tr('PRZEGLĄD TYGODNIA', 'WEEK IN REVIEW')}</span>
          <strong>{rangeLabel(report.start, report.end)}</strong>
        </div>
        <button type="button" className="wrx-hero-step" disabled={weekStart >= maxStart} onClick={() => changingWeek(1)} aria-label={tr('Następny tydzień', 'Next week')}><ChevronRight size={18}/></button>
      </div>
      <div className="wrx-hero-body">
        <ScoreRing value={rate}/>
        <div className="wrx-hero-copy">
          <span className="wrx-hero-eyebrow"><Sparkles size={13}/> {tr('TWOJE PODSUMOWANIE', 'YOUR SUMMARY')}</span>
          <h2>{mood.title}</h2>
          <p>{mood.text}</p>
        </div>
      </div>
      <div className="wrx-hero-chips">
        <span><CheckCircle2 size={14}/> {report.completed}/{report.scheduled} {plural(report.scheduled, ['aktywności', 'aktywności', 'aktywności'], ['activity', 'activities'])}</span>
        <span><Zap size={14}/> +{weekXp} XP</span>
        <span><ShieldCheck size={14}/> {report.activeDays}/7 {tr('dni z postępem', 'days with progress')}</span>
      </div>
      <div className="wrx-hero-actions">
        <button type="button" className="wrx-hero-export" onClick={() => setExportOpen(true)}><ClipboardList size={15}/> {tr('Eksport dni do tekstu', 'Export days as text')}</button>
        {weekStart !== maxStart && <button type="button" className="wrx-hero-latest" onClick={() => setWeekStart(maxStart)}>{tr('Wróć do najnowszego raportu', 'Back to the latest report')} <ArrowRight size={14}/></button>}
      </div>
    </section>
    {exportOpen && <DayExportDialog data={data} focusHistory={focusHistory} overrides={overrides} initialWeek={weekStart} onClose={() => setExportOpen(false)}/>}

    <div className="wrx-tiles">
      <article className="wrx-tile wrx-tile--green">
        <span className="wrx-tile-icon"><ListChecks size={17}/></span>
        <small>{tr('Ukończone aktywności', 'Completed activities')}</small>
        <strong>{report.completed}<em>/{report.scheduled}</em></strong>
        <span className="wrx-tile-track"><span style={{ width: `${report.scheduled ? report.completed / report.scheduled * 100 : 0}%` }}/></span>
      </article>
      <article className="wrx-tile wrx-tile--coral">
        <span className="wrx-tile-icon"><Flame size={17}/></span>
        <small>{tr('Ukończone rutyny', 'Completed routines')}</small>
        <strong>{report.completedRoutines}<em>/{report.scheduledRoutines}</em></strong>
        <span className="wrx-tile-track"><span style={{ width: `${report.scheduledRoutines ? report.completedRoutines / report.scheduledRoutines * 100 : 0}%` }}/></span>
      </article>
      <article className="wrx-tile wrx-tile--amber">
        <span className="wrx-tile-icon"><ShieldCheck size={17}/></span>
        <small>{tr('Dni z postępem', 'Days with progress')}</small>
        <strong>{report.activeDays}<em>/7</em></strong>
        <span className="wrx-tile-days">{report.days.map(day => <i key={day.date} className={day.completedCount > 0 || day.actualMinutes > 0 ? 'is-active' : ''} title={fullDate(day.date)}/>)}</span>
      </article>
      <article className="wrx-tile wrx-tile--violet">
        <span className="wrx-tile-icon"><Clock3 size={17}/></span>
        <small>{tr('Zmierzony czas', 'Measured time')}</small>
        <strong className={periodMeasured ? '' : 'is-muted'}>{periodMeasured ? compactWeekMinutes(report.measuredMinutes) : tr('Brak', 'None')}</strong>
        <span className="wrx-tile-note">{periodMeasured ? tr('Focus Mode + wpisy ręczne', 'Focus Mode + manual entries') : tr('Uruchom Focus Mode', 'Start Focus Mode')}</span>
      </article>
    </div>

    <div className="wr-overview-grid">
      <section className="wr-card wr-chart-card">
        <div className="wr-section-heading"><div><span className="eyebrow">{tr('DZIEŃ PO DNIU', 'DAY BY DAY')}</span><h3>{tr('Rytm Twojego tygodnia', 'Your week’s rhythm')}</h3><p>{tr('Ukończone zadania i rutyny w kolejnych dniach.', 'Completed tasks and routines, day by day.')}</p></div><TrendingUp size={19}/></div>
        <div className="wr-activity-plot">
          {report.days.map(day => <div className={`wr-day-column ${day.date === today ? 'is-today' : ''} ${bestDay?.date === day.date ? 'is-best' : ''}`} key={day.date} title={tr(`${fullDate(day.date)}: ${day.completedCount} wykonane`, `${fullDate(day.date)}: ${day.completedCount} done`)}>
            <span className="wr-day-count">{bestDay?.date === day.date && <Crown size={12}/>}{day.completedCount}</span>
            <div className="wr-day-track"><span style={{height: `${day.completedCount > 0 ? Math.max(12, 100 * day.completedCount / trendMax) : 0}%`}}/></div>
            <span className="wr-day-label">{shortWeekday(day.date)}</span>
          </div>)}
        </div>
        <div className="wr-best-day">{bestDay ? <><span className="wr-best-medal"><Trophy size={18}/></span><div><strong>{tr('Najaktywniejszy dzień:', 'Most active day:')} {fullDate(bestDay.date)}</strong><small>{bestDay.completedCount} {plural(bestDay.completedCount, ['ukończonych aktywności', 'ukończonych aktywności', 'ukończonych aktywności'], ['completed activity', 'completed activities'])}{bestDay.actualMinutes > 0 ? tr(` · ${compactWeekMinutes(bestDay.actualMinutes)} zmierzonego czasu`, ` · ${compactWeekMinutes(bestDay.actualMinutes)} measured`) : ''}</small></div></> : <><span className="wr-best-medal"><Compass size={18}/></span><div><strong>{tr('Twój najlepszy dzień dopiero przed Tobą', 'Your best day is still ahead of you')}</strong><small>{tr('Wybierz jedną rzecz i zacznij od niej.', 'Pick one thing and start with it.')}</small></div></>}</div>
      </section>
      <section className="wr-card wr-trends-card">
        <div className="wr-section-heading"><div><span className="eyebrow">{tr('TRENDY', 'TRENDS')}</span><h3>{tr('W porównaniu z poprzednim', 'Compared with last week')}</h3><p>{tr('Małe zmiany dają dobry obraz regularności.', 'Small changes give a good picture of your consistency.')}</p></div><TrendingUp size={19}/></div>
        <div className="wr-trend-rows">
          <div className="wr-trend-row"><span className="wr-trend-icon wr-trend-icon--violet"><ListChecks size={19}/></span><div><strong>{tr('Wykonane działania', 'Completed activities')}</strong><small>{prior.completed} → {report.completed}</small></div><TrendPill current={report.completed} previous={prior.completed}/></div>
          <div className="wr-trend-row"><span className="wr-trend-icon wr-trend-icon--green"><Clock3 size={19}/></span><div><strong>{tr('Zmierzony czas', 'Measured time')}</strong><small>{prior.measuredCount > 0 || prior.measuredMinutes > 0 ? compactWeekMinutes(prior.measuredMinutes) : tr('Brak danych', 'No data')} → {periodMeasured ? compactWeekMinutes(report.measuredMinutes) : tr('Brak danych', 'No data')}</small></div>{periodMeasured && (prior.measuredCount > 0 || prior.measuredMinutes > 0) ? <TrendPill current={report.measuredMinutes} previous={prior.measuredMinutes}/> : <span className="wrx-pill">{tr('brak pomiarów', 'no measurements')}</span>}</div>
          <div className="wr-trend-row"><span className="wr-trend-icon wr-trend-icon--amber"><Flame size={19}/></span><div><strong>{tr('Zakończone rutyny', 'Completed routines')}</strong><small>{prior.completedRoutines} → {report.completedRoutines}</small></div><TrendPill current={report.completedRoutines} previous={prior.completedRoutines}/></div>
        </div>
        <div className="wr-neutral-note"><Info size={15}/> {tr('Spadek wyniku nie oznacza porażki. Porównania pomagają planować, nie oceniają odpoczynku.', 'A lower score isn’t a failure. Comparisons help you plan — they don’t judge rest.')}</div>
      </section>
    </div>

    {wins.length > 0 && <section className="wr-card wrx-wins">
      <div className="wr-section-heading"><div><span className="eyebrow">{tr('TWOJE WYGRANE', 'YOUR WINS')}</span><h3>{tr('Najważniejsze sukcesy tygodnia', 'Top wins of the week')}</h3></div><Trophy size={19}/></div>
      <div className="wrx-wins-list">{wins.map(({ item, xp, icon, image }, index) => <div className="wrx-win" key={item.key}>
        <span className="wrx-win-rank">{index + 1}</span>
        <TaskVisual icon={icon} image={image} category={item.category} categories={categories} size="small"/>
        <span className="wrx-win-main"><strong>{item.title}</strong><small>{capitalize(shortWeekday(item.date))}, {displayDate(item.date)}{item.time ? ` · ${item.time}` : ''}{item.kind === 'routine' ? (item.series ? tr(' · cykliczne', ' · recurring') : tr(' · rutyna', ' · routine')) : ''}</small></span>
        <span className="wrx-win-xp">+{xp} XP</span>
      </div>)}</div>
    </section>}

    <section className="wr-card wr-category-section">
      <div className="wr-section-heading"><div><span className="eyebrow">{tr('TWÓJ CZAS W TRZECH KOLORACH', 'YOUR TIME IN THREE COLORS')}</span><h3>{tr('Na co poszła energia?', 'Where did your energy go?')}</h3><p>{tr('Plan i zmierzony czas osobno — bez dopisywania minut za samo ukończenie.', 'Plan and measured time shown separately — no minutes added just for checking things off.')}</p></div><Wallet size={20}/></div>
      <div className="wr-category-grid">
        {report.categories.map(category => {
          const style = categories[category.category] ?? categories.unpaid;
          return <div className="wr-category" key={category.category} style={{'--wr-category-color': style.color, '--wr-category-tint': style.tint} as React.CSSProperties}>
            <CategoryBadge category={category.category} categories={categories}/>
            <div className="wr-category-values"><div><small>Plan</small><strong>{compactWeekMinutes(category.planned)}</strong></div><div><small>{tr('Pomiar', 'Measured')}</small><strong>{category.measuredCount > 0 ? compactWeekMinutes(category.measured) : '—'}</strong></div></div>
            <div className="wr-bar-pair"><div className="wr-bar-track" title="Plan"><span style={{width:`${Math.min(100, category.planned / maximumCategory * 100)}%`}}/></div><div className="wr-bar-track wr-bar-track--actual" title={tr('Rzeczywisty czas', 'Actual time')}><span style={{width:`${Math.min(100, category.measured / maximumCategory * 100)}%`}}/></div></div>
            <small className="wr-category-note">{category.completedCount} / {category.scheduledCount} {tr('wykonanych', 'done')} · {category.measuredCount} {tr('zmierzonych', 'measured')}</small>
          </div>;
        })}
      </div>
    </section>

    <section className="wr-card wr-routine-section">
      <div className="wr-section-heading"><div><span className="eyebrow">{tr('SYSTEMATYCZNOŚĆ', 'CONSISTENCY')}</span>{report.routines.some(routine => routine.series)
        ? <><h3>{tr('Co udało się utrzymać?', 'What did you keep up?')}</h3><p>{tr('Rutyny i zadania cykliczne — każde ma własną liczbę zaplanowanych wystąpień.', 'Routines and recurring tasks — each has its own number of scheduled occurrences.')}</p></>
        : <><h3>{tr('Które rutyny udało się utrzymać?', 'Which routines did you keep up?')}</h3><p>{tr('Każda rutyna ma własną liczbę zaplanowanych wystąpień.', 'Each routine has its own number of scheduled occurrences.')}</p></>}</div><Flame size={19}/></div>
      {report.routines.length > 0 ? <div className="wr-routine-grid">{report.routines.map(routine => {
        const template = data.routines.find(item => item.id === routine.id);
        const category: CategoryKey = template?.category ?? 'unpaid';
        const percent = Math.round(routine.completed / Math.max(1, routine.planned) * 100);
        return <div className="wr-routine" key={routine.id}>
          <TaskVisual icon={routine.icon} image={routine.image} category={category} categories={categories} size="small"/>
          <div className="wr-routine-main"><div><strong>{routine.title}{routine.series && <Repeat2 className="wr-series-mark" size={12} aria-label={tr('Zadanie cykliczne', 'Recurring task')}/>}</strong><span>{routine.completed} / {routine.planned} · {percent}%</span></div><div className="wr-routine-track"><span style={{width:`${percent}%`,background:categories[category]?.color ?? '#7461e8'}}/></div></div>
        </div>;
      })}</div> : <div className="wr-empty">{tr('W wybranym tygodniu nie było zaplanowanych rutyn.', 'No routines were scheduled in the selected week.')}</div>}
    </section>

    <section className="wr-card wr-next-section">
      <div className="wr-section-heading"><div><span className="eyebrow">{tr('NADCHODZĄCY TYDZIEŃ', 'THE WEEK AHEAD')}</span><h3>{tr('Co warto zrobić inaczej?', 'What could you do differently?')}</h3><p>{tr('Podpowiedzi wynikają z Twoich danych. Wybierz te, które mają sens dla Ciebie.', 'These suggestions come from your data. Pick the ones that make sense for you.')}</p></div><Lightbulb size={20}/></div>
      <div className="wr-next-grid"><div className="wr-next-advice">
        {report.tips.map(tip => <label className="wr-advice" key={tip.id}><input type="checkbox" checked={!!plan.checks[`${nextMonday}:${tip.id}`]} onChange={event => setPlan(current => ({...current,checks:{...current.checks,[`${nextMonday}:${tip.id}`]:event.target.checked}}))}/><span className="wr-advice-mark"><Check size={14}/></span><span><strong>{tip.title}</strong><small>{tip.detail}</small></span></label>)}
        <div className="wr-advice-progress">{nextPlanChecks} / {report.tips.length} {tr('pomysłów wybranych na kolejny tydzień', 'ideas picked for next week')}</div>
      </div><div className="wr-plan-card">
        <div className="wr-plan-header"><span><PencilLine size={20}/></span><div><strong>{tr('Twój plan na kolejny tydzień', 'Your plan for next week')}</strong><small>{displayDate(nextMonday)} – {displayDate(shiftDate(nextMonday,6))}</small></div></div>
        <label htmlFor="wr-next-priorities">{tr('Najważniejsze priorytety', 'Top priorities')}</label>
        <textarea id="wr-next-priorities" placeholder={tr('1. Najważniejsza rzecz\n2. Projekt, który chcę rozwinąć\n3. Co zrobię dla siebie', '1. The most important thing\n2. A project I want to move forward\n3. Something I’ll do for myself')} maxLength={1000} value={nextPlanNote} onChange={event => setPlan(current => ({...current,notes:{...current.notes,[nextMonday]:event.target.value}}))} rows={5}/>
        <small>{tr('Notatka i zaznaczone pomysły zapisują się lokalnie.', 'Your note and selected ideas are saved locally.')}</small>
        <button type="button" className="wr-plan-cta" onClick={() => onOpenNextWeek(nextMonday)}>{tr('Otwórz kalendarz następnego tygodnia', 'Open next week’s calendar')} <ArrowRight size={17}/></button>
      </div></div>
    </section>
  </div>;
}
