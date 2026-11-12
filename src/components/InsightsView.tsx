import { useMemo, useState } from 'react';
import { Activity, Award, CalendarRange, CheckCircle2, ChevronDown, ChevronUp, Clock3, Flame, Lock, Sparkles, Target, TrendingDown, TrendingUp, Trophy, Zap } from 'lucide-react';
import { PlanReality } from './PlanReality';
import { formatDuration, monthTitle, mondayOf, parseDate, shiftDate, todayKey, weekdayShortLabels } from '../lib/date';
import { formatFocusClock, type FocusRecord } from '../lib/focus';
import { formatNumber, locale, plural, tr, useLanguage } from '../lib/i18n';
import { buildDailyReality, summarizeReality } from '../lib/planReality';
import { resolveCategories } from '../lib/storage';
import { ACHIEVEMENT_GROUPS, RANKS, type AchievementGroup, type AchievementView, type RankView } from '../lib/progression';
import { XP_RULES, sumXp, type LevelInfo, type XpEntry } from '../lib/xp';
import type { AppData, CategoryKey } from '../types';

const CATEGORY_KEYS: CategoryKey[] = ['unpaid', 'potential', 'income'];
const HEATMAP_WEEKS = 12;
/** Dwuliterowe nazwy dni tygodnia od poniedziałku: Pn… / Mo… */
const weekdayInitials = () => { const [sunday, ...rest] = weekdayShortLabels(); return [...rest, sunday]; };
/** „dzień” / „dni” (po angielsku day / days). */
const dayWord = (days: number) => plural(days, ['dzień', 'dni', 'dni'], ['day', 'days']);
/** Przecinek dziesiętny po polsku, kropka po angielsku. */
const localDecimal = (value: string) => value.replace('.', tr(',', '.'));

type DayStat = { count: number; minutes: number };

interface Props {
  data: AppData;
  totalXp: number;
  level: LevelInfo;
  /** Wszystkie zdobyte punkty (lib/xp.ts) — do podziału XP z ostatnich dni. */
  xpLedger: XpEntry[];
  streak: number;
  achievements: AchievementView[];
  rank: RankView;
  nextRank: RankView | null;
  focusHistory: FocusRecord[];
}

/** Ukończone zadania (wg daty zadania) i rutyny (wg dnia wystąpienia) zgrupowane po dniach. */
function useDailyStats(data: AppData) {
  return useMemo(() => {
    const byDate = new Map<string, DayStat>();
    const byCategory: Record<CategoryKey, number> = { unpaid: 0, potential: 0, income: 0 };
    const add = (date: string, minutes: number, category: CategoryKey) => {
      const current = byDate.get(date) ?? { count: 0, minutes: 0 };
      byDate.set(date, { count: current.count + 1, minutes: current.minutes + minutes });
      byCategory[category] += minutes;
    };
    let completed = 0;
    let minutes = 0;
    for (const task of data.tasks) {
      if (!task.done) continue;
      completed++;
      minutes += task.duration;
      if (task.date) add(task.date, task.duration, task.category);
      else byCategory[task.category] += task.duration;
    }
    const routines = new Map(data.routines.map(routine => [routine.id, routine]));
    for (const [key, log] of Object.entries(data.routineLogs)) {
      if (!log.completed) continue;
      const separator = key.lastIndexOf(':');
      const routine = routines.get(key.slice(0, separator));
      const duration = log.durationOverride ?? routine?.duration ?? 0;
      completed++;
      minutes += duration;
      add(key.slice(separator + 1), duration, routine?.category ?? 'unpaid');
    }
    return { byDate, byCategory, completed, minutes };
  }, [data.tasks, data.routines, data.routineLogs]);
}

function sumRange(byDate: Map<string, DayStat>, start: string, days: number): DayStat {
  let count = 0;
  let minutes = 0;
  for (let index = 0; index < days; index++) {
    const stat = byDate.get(shiftDate(start, index));
    if (stat) { count += stat.count; minutes += stat.minutes; }
  }
  return { count, minutes };
}

function longestStreak(dates: Iterable<string>): number {
  const sorted = [...dates].sort();
  let best = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of sorted) {
    run = previous && shiftDate(previous, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return best;
}

function compactHours(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return localDecimal(`${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10} h`);
}

function Ring({ value, size = 112, stroke = 10, children, className = '' }: { value: number; size?: number; stroke?: number; children?: React.ReactNode; className?: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, value));
  return <div className={`ins-ring ${className}`} style={{ width: size, height: size }}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="ins-ring-track"/>
      <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="ins-ring-value"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} transform={`rotate(-90 ${size / 2} ${size / 2})`}/>
    </svg>
    <div className="ins-ring-content">{children}</div>
  </div>;
}

function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous <= 0) return current > 0 ? <span className="ins-delta is-up"><TrendingUp size={12}/> {tr('nowy wynik', 'up from 0')}</span> : <span className="ins-delta">—</span>;
  const change = Math.round((current - previous) / previous * 100);
  if (change === 0) return <span className="ins-delta">{tr('bez zmian', 'no change')}</span>;
  return <span className={`ins-delta ${change > 0 ? 'is-up' : 'is-down'}`}>{change > 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>} {change > 0 ? '+' : ''}{change}%</span>;
}

export function InsightsView({ data, totalXp, level, xpLedger, streak, achievements, rank, nextRank, focusHistory }: Props) {
  const [chartView, setChartView] = useState<'week' | 'month'>('week');
  const [achievementFilter, setAchievementFilter] = useState<'all' | 'earned' | 'locked'>('all');
  const [expandedGroups, setExpandedGroups] = useState<AchievementGroup[]>([]);
  const language = useLanguage();
  const weekdays = weekdayInitials();
  const categories = resolveCategories(data.categories);
  const today = todayKey();
  const stats = useDailyStats(data);

  const last7Start = shiftDate(today, -6);
  const last7 = sumRange(stats.byDate, last7Start, 7);
  const prev7 = sumRange(stats.byDate, shiftDate(today, -13), 7);
  const best = useMemo(() => longestStreak([...stats.byDate.entries()].filter(([, stat]) => stat.count > 0).map(([date]) => date)), [stats.byDate]);
  const recentDays = Array.from({ length: 7 }, (_, index) => shiftDate(last7Start, index));

  const planWeek = useMemo(() => summarizeReality(buildDailyReality(data, focusHistory, {}, Array.from({ length: 7 }, (_, index) => shiftDate(last7Start, index)))), [data, focusHistory, last7Start]);

  const chart = useMemo(() => chartView === 'week'
    ? recentDays.map(date => ({ key: date, ...sumRange(stats.byDate, date, 1), label: new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(parseDate(date)).replace('.', ''), sub: String(parseDate(date).getDate()), today: date === today }))
    : Array.from({ length: 4 }, (_, index) => {
      const start = shiftDate(today, -27 + index * 7);
      const end = shiftDate(start, 6);
      return { key: start, ...sumRange(stats.byDate, start, 7), label: `${parseDate(start).getDate()}–${parseDate(end).getDate()}`, sub: monthTitle(end).slice(0, 3), today: index === 3 };
    }), [chartView, recentDays, stats.byDate, today, language]);
  const chartMax = Math.max(1, ...chart.map(item => item.count));
  const chartCount = chart.reduce((sum, item) => sum + item.count, 0);
  const chartMinutes = chart.reduce((sum, item) => sum + item.minutes, 0);

  const heatmap = useMemo(() => {
    const start = shiftDate(mondayOf(today), -(HEATMAP_WEEKS - 1) * 7);
    const weeks = Array.from({ length: HEATMAP_WEEKS }, (_, week) => Array.from({ length: 7 }, (_, day) => {
      const date = shiftDate(start, week * 7 + day);
      return { date, count: stats.byDate.get(date)?.count ?? 0, future: date > today };
    }));
    const max = Math.max(1, ...weeks.flat().map(cell => cell.count));
    const months = weeks.map((week, index) => {
      const month = parseDate(week[0].date).getMonth();
      const previous = index > 0 ? parseDate(weeks[index - 1][0].date).getMonth() : -1;
      return month !== previous ? new Intl.DateTimeFormat(locale(), { month: 'short' }).format(parseDate(week[0].date)).replace('.', '') : '';
    });
    const past = weeks.flat().filter(cell => !cell.future);
    return { weeks, max, months, activeDays: past.filter(cell => cell.count > 0).length, totalDays: past.length };
  }, [stats.byDate, today, language]);
  const heatLevel = (count: number) => count === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(count / heatmap.max * 4)));

  const categoryTotal = CATEGORY_KEYS.reduce((sum, key) => sum + stats.byCategory[key], 0);
  let cumulative = 0;
  const donutStops = CATEGORY_KEYS.filter(key => stats.byCategory[key] > 0).map(key => {
    const start = cumulative;
    cumulative += stats.byCategory[key] / Math.max(1, categoryTotal) * 100;
    return `${categories[key].color} ${start}% ${cumulative}%`;
  });

  const earned = achievements.filter(item => item.unlocked).length;
  const closest = achievements.filter(item => !item.unlocked)
    .sort((a, b) => b.progress / b.target - a.progress / a.target || a.target - b.target).slice(0, 3);
  const visibleAchievements = achievementFilter === 'all' ? achievements : achievements.filter(item => achievementFilter === 'earned' ? item.unlocked : !item.unlocked);
  // Kolekcja w grupach; zwinięta grupa pokazuje jeden rząd odznak (liczbę kolumn ustala CSS).
  const badgeGroups = ACHIEVEMENT_GROUPS.map(group => {
    const all = achievements.filter(item => item.group === group.id);
    return { ...group, total: all.length, earned: all.filter(item => item.unlocked).length, items: visibleAchievements.filter(item => item.group === group.id) };
  }).filter(group => group.items.length > 0);
  const toggleGroup = (id: AchievementGroup) => setExpandedGroups(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const focusSeconds = focusHistory.reduce((sum, record) => sum + record.focusSeconds, 0);
  const rankProgress = nextRank ? Math.max(0, Math.min(1, (totalXp - rank.minXp) / Math.max(1, nextRank.minXp - rank.minXp))) : 1;
  const RankIcon = rank.icon;
  // Skąd pochodziło XP w ostatnich 7 dniach (wpisy bez daty — zadania z Inboxu — pomijamy).
  const recentXp = (kinds: XpEntry['kind'][]) => sumXp(xpLedger, entry => kinds.includes(entry.kind) && !!entry.date && entry.date >= last7Start && entry.date <= today);
  const xpRecent = { tasks: recentXp(['task', 'series']), routines: recentXp(['routine']), focus: recentXp(['focus']) };
  const rate = (value: number) => localDecimal(String(value));

  return <div className="ins-page">
    <section className="ins-hero" style={{ '--rank-accent': rank.accent, '--rank-tint': rank.tint } as React.CSSProperties}>
      <img className="ins-hero-art" src={rank.art} alt="" aria-hidden="true"/>
      <div className="ins-hero-top">
        <Ring value={level.progress} className="ins-hero-ring">
          <small>{tr('POZIOM', 'LEVEL')}</small><strong>{level.level}</strong><span>{formatNumber(level.into)}/{formatNumber(level.size)} XP</span>
        </Ring>
        <div className="ins-hero-copy">
          <span className="ins-hero-eyebrow"><RankIcon size={13}/> {tr('TWOJA RANGA', 'YOUR RANK')}</span>
          <h2>{rank.title}</h2>
          <p><strong>{formatNumber(totalXp)} XP</strong> {tr('łącznie', 'total')} · {formatNumber(level.toNext)} XP {tr('do poziomu', 'to level')} {level.level + 1}</p>
        </div>
      </div>
      <div className="ins-hero-rank">
        <div className="ins-hero-rank-track"><span style={{ width: `${Math.max(4, rankProgress * 100)}%` }}/></div>
        <small>{nextRank ? <>{tr(`Do rangi „${nextRank.title}”: `, `Next rank “${nextRank.title}” in `)}<b>{formatNumber(nextRank.minXp - totalXp)} XP</b></> : tr('Masz najwyższą rangę — gratulacje!', "You've reached the highest rank — congratulations!")}</small>
      </div>
      <div className="ins-hero-chips">
        <span><Flame size={14}/> {tr(`${streak} ${dayWord(streak)} serii`, `${streak}-day streak`)}</span>
        <span><Award size={14}/> {earned}/{achievements.length} {tr('odznak', 'badges')}</span>
        <span><CheckCircle2 size={14}/> {stats.completed} {tr('ukończonych', 'completed')}</span>
      </div>
      <details className="ins-xp-key">
        <summary><Zap size={14}/> {tr('Jak liczymy XP?', 'How is XP calculated?')} <small>{tr(`7 dni: zadania +${xpRecent.tasks} · rutyny +${xpRecent.routines} · Focus +${xpRecent.focus}`, `7 days: tasks +${xpRecent.tasks} · routines +${xpRecent.routines} · Focus +${xpRecent.focus}`)}</small></summary>
        <ul>
          <li><b>{tr('Zadania', 'Tasks')}</b> — {tr('za każde 15 min:', 'for every 15 min:')} {CATEGORY_KEYS.slice().reverse().map(key => `${categories[key].label} ${rate(XP_RULES.taskPer15[key])}`).join(' · ')} XP, {tr(`do tego +${XP_RULES.completion} za ukończenie. Czas ponad 2 h liczy się w połowie, ponad 4 h już nie.`, `and +${XP_RULES.completion} for completing it. Time over 2 h counts at half rate, over 4 h not at all.`)}</li>
          <li><b>Focus Mode</b> — {tr('połowa tej stawki za każde 15 min realnego skupienia (do 4 h na sesję), także bez kończenia zadania.', "half that rate for every 15 min of actual focus (up to 4 h per session), even if you don't complete the task.")}</li>
          <li><b>{tr('Rutyny', 'Routines')}</b> — {tr(`czas jak w zadaniach, +${XP_RULES.routineStep} XP za każdy krok i do +${XP_RULES.routineStreakCap} XP za wykonania z rzędu.`, `time counts as for tasks, +${XP_RULES.routineStep} XP for each step and up to +${XP_RULES.routineStreakCap} XP for completions in a row.`)}</li>
        </ul>
        <p>{tr('XP przyznaje aplikacja i przelicza je z całej historii. Kolejne poziomy wymagają coraz więcej punktów, a najwyższa ranga i największe odznaki to efekt ponad roku regularnej pracy.', 'XP is awarded by the app and recalculated from your entire history. Each level takes more points than the last, and the highest rank and biggest badges take over a year of consistent work.')}</p>
      </details>
    </section>

    <div className="ins-tiles">
      <article className="ins-tile ins-tile--streak">
        <div className="ins-tile-head"><span className="ins-tile-icon"><Flame size={17}/></span><small>{tr('Seria', 'Streak')}</small></div>
        <strong>{streak} <em>{dayWord(streak)}</em></strong>
        <div className="ins-week-dots" aria-label={tr('Aktywność w ostatnich 7 dniach', 'Activity in the last 7 days')}>{recentDays.map(date => {
          const active = (stats.byDate.get(date)?.count ?? 0) > 0;
          return <span key={date} className={`${active ? 'is-active' : ''} ${date === today ? 'is-today' : ''}`} title={date}>
            <i/>{weekdays[(parseDate(date).getDay() + 6) % 7]}
          </span>;
        })}</div>
        <small className="ins-tile-foot">{tr(`Rekord: ${best} ${dayWord(best)}`, `Best: ${best} ${dayWord(best)}`)}</small>
      </article>
      <article className="ins-tile ins-tile--done">
        <div className="ins-tile-head"><span className="ins-tile-icon"><CheckCircle2 size={17}/></span><small>{tr('Ukończone · 7 dni', 'Completed · 7 days')}</small></div>
        <strong>{last7.count}</strong>
        <Delta current={last7.count} previous={prev7.count}/>
        <small className="ins-tile-foot">{tr('Łącznie', 'Total')} {stats.completed}</small>
      </article>
      <article className="ins-tile ins-tile--time">
        <div className="ins-tile-head"><span className="ins-tile-icon"><Clock3 size={17}/></span><small>{tr('Czas w działaniu', 'Time in action')}</small></div>
        <strong>{compactHours(last7.minutes)}</strong>
        <div className="ins-spark" aria-hidden="true">{recentDays.map(date => {
          const value = stats.byDate.get(date)?.minutes ?? 0;
          const max = Math.max(1, ...recentDays.map(day => stats.byDate.get(day)?.minutes ?? 0));
          return <span key={date} style={{ height: `${Math.max(8, value / max * 100)}%` }} className={value ? '' : 'is-empty'}/>;
        })}</div>
        <small className="ins-tile-foot">{tr('Łącznie', 'Total')} {compactHours(stats.minutes)}</small>
      </article>
      <article className="ins-tile ins-tile--plan">
        <div className="ins-tile-head"><span className="ins-tile-icon"><Target size={17}/></span><small>{tr('Realizacja planu', 'Plan completion')}</small></div>
        <div className="ins-tile-ring">
          <Ring value={(planWeek.completion ?? 0) / 100} size={66} stroke={7}><strong>{planWeek.completion === null ? '—' : `${planWeek.completion}%`}</strong></Ring>
          <span>{planWeek.completedCount}/{planWeek.plannedCount}<small>{tr('z planu na 7 dni', 'of the 7-day plan')}</small></span>
        </div>
      </article>
    </div>

    <div className="ins-grid">
      <section className="ins-card ins-card--chart">
        <div className="ins-card-head">
          <div><span className="eyebrow">{chartView === 'week' ? tr('OSTATNIE 7 DNI', 'LAST 7 DAYS') : tr('OSTATNIE 4 TYGODNIE', 'LAST 4 WEEKS')}</span><h3>{tr('Twoja aktywność', 'Your activity')}</h3></div>
          <div className="ins-switch" role="tablist" aria-label={tr('Zakres wykresu', 'Chart range')} data-active={chartView}>
            <button type="button" role="tab" aria-selected={chartView === 'week'} onClick={() => setChartView('week')}>{tr('Tydzień', 'Week')}</button>
            <button type="button" role="tab" aria-selected={chartView === 'month'} onClick={() => setChartView('month')}>{tr('Miesiąc', 'Month')}</button>
          </div>
        </div>
        <div className={`ins-bars ins-bars--${chartView}`}>{chart.map(item => <div key={item.key} className={`ins-bar ${item.today ? 'is-today' : ''}`}
          title={tr(`${item.count} ukończonych · ${formatDuration(item.minutes)}`, `${item.count} completed · ${formatDuration(item.minutes)}`)}>
          <span className="ins-bar-value">{item.count || ''}</span>
          <div className="ins-bar-stage"><span style={{ height: `${item.count ? Math.max(10, item.count / chartMax * 100) : 3}%` }}/></div>
          <span className="ins-bar-label">{item.label}</span>
          <small>{item.sub}</small>
        </div>)}</div>
        <div className="ins-summary">
          <div><strong>{chartCount}</strong><span>{tr('ukończonych', 'completed')}</span></div>
          <div><strong>{compactHours(chartMinutes)}</strong><span>{tr('czasu działania', 'time in action')}</span></div>
          <div><strong>{localDecimal((chartCount / (chartView === 'week' ? 7 : 28)).toFixed(1))}</strong><span>{tr('średnio dziennie', 'daily average')}</span></div>
        </div>
      </section>

      <section className="ins-card ins-card--heatmap">
        <div className="ins-card-head">
          <div><span className="eyebrow">{tr(`OSTATNIE ${HEATMAP_WEEKS} TYGODNI`, `LAST ${HEATMAP_WEEKS} WEEKS`)}</span><h3>{tr('Mapa regularności', 'Consistency map')}</h3></div>
          <span className="ins-card-badge"><CalendarRange size={14}/> {heatmap.activeDays}/{heatmap.totalDays} {tr('dni', 'days')}</span>
        </div>
        <div className="ins-heatmap" style={{ '--weeks': HEATMAP_WEEKS } as React.CSSProperties}>
          <div className="ins-heatmap-months">{heatmap.months.map((label, index) => <span key={index}>{label}</span>)}</div>
          <div className="ins-heatmap-body">
            <div className="ins-heatmap-days">{weekdays.map((label, index) => <span key={label}>{index % 2 === 0 ? label : ''}</span>)}</div>
            <div className="ins-heatmap-grid">{heatmap.weeks.map((week, index) => <div className="ins-heatmap-week" key={index}>
              {week.map(cell => <span key={cell.date} className={`ins-heat ins-heat--${cell.future ? 'future' : heatLevel(cell.count)} ${cell.date === today ? 'is-today' : ''}`}
                title={cell.future ? undefined : `${new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long' }).format(parseDate(cell.date))}: ${tr(`${cell.count} ukończonych`, `${cell.count} completed`)}`}/>)}
            </div>)}</div>
          </div>
          <div className="ins-heatmap-legend"><span>{tr('Mniej', 'Less')}</span>{[0, 1, 2, 3, 4].map(level => <i key={level} className={`ins-heat ins-heat--${level}`}/>)}<span>{tr('Więcej', 'More')}</span></div>
        </div>
      </section>

      <section className="ins-card ins-card--donut">
        <div className="ins-card-head"><div><span className="eyebrow">{tr('PODZIAŁ CZASU', 'TIME BREAKDOWN')}</span><h3>{tr('Na co poświęcasz czas?', 'Where does your time go?')}</h3></div><Target size={19}/></div>
        <div className="ins-donut-layout">
          <div className="ins-donut" style={{ background: categoryTotal ? `conic-gradient(${donutStops.join(',')})` : 'var(--line)' }}>
            <div><strong>{compactHours(categoryTotal)}</strong><small>{tr('ukończonego czasu', 'completed time')}</small></div>
          </div>
          <div className="ins-legend">{CATEGORY_KEYS.map(key => {
            const percent = categoryTotal ? Math.round(stats.byCategory[key] / categoryTotal * 100) : 0;
            return <div key={key} style={{ '--cat': categories[key].color } as React.CSSProperties}>
              <span className="ins-legend-dot"/>
              <span className="ins-legend-main"><b>{categories[key].label}</b><small>{formatDuration(stats.byCategory[key])}</small></span>
              <strong>{percent}%</strong>
              <span className="ins-legend-track"><span style={{ width: `${percent}%` }}/></span>
            </div>;
          })}</div>
        </div>
      </section>

      <section className="ins-card ins-card--next">
        <div className="ins-card-head"><div><span className="eyebrow">{tr('KOLEJNE CELE', 'NEXT GOALS')}</span><h3>{tr('Najbliżej odblokowania', 'Closest to unlocking')}</h3></div><Trophy size={19}/></div>
        {closest.length ? <div className="ins-next-list">{closest.map(item => {
          const percent = Math.min(100, Math.round(item.progress / item.target * 100));
          const Icon = item.icon;
          return <div className="ins-next" key={item.id} style={{ '--achievement-accent': item.accent, '--achievement-tint': item.tint } as React.CSSProperties}>
            <span className="ins-next-art"><img src={item.art} alt=""/><i><Icon size={12}/></i></span>
            <span className="ins-next-main"><strong>{item.title}</strong><small>{item.description}</small>
              <span className="ins-next-track"><span style={{ width: `${Math.max(4, percent)}%` }}/></span></span>
            <span className="ins-next-value">{percent}%<small>{Math.min(item.progress, item.target)}/{item.target}</small></span>
          </div>;
        })}</div> : <p className="ins-empty"><Sparkles size={16}/> {tr('Wszystkie odznaki zdobyte. Niesamowite!', 'All badges earned. Amazing!')}</p>}
      </section>
    </div>

    <PlanReality data={data} focusHistory={focusHistory}/>

    <section className="ins-card ins-card--focus">
      <div className="ins-card-head"><div><span className="eyebrow">FOCUS MODE</span><h3>{tr('Sesje skupienia', 'Focus sessions')}</h3></div><Zap size={19}/></div>
      <div className="ins-focus-metrics">
        <div><small>{tr('Łącznie', 'Total')}</small><strong>{formatFocusClock(focusSeconds)}</strong></div>
        <div><small>{tr('Sesje', 'Sessions')}</small><strong>{focusHistory.length}</strong></div>
        <div><small>{tr('Średnio', 'Average')}</small><strong>{focusHistory.length ? formatFocusClock(Math.round(focusSeconds / focusHistory.length)) : '00:00'}</strong></div>
      </div>
      {focusHistory.length > 0 ? <div className="ins-focus-list">{focusHistory.slice(-5).reverse().map(record => <div className="ins-focus-row" key={record.id}>
        <span><strong>{record.taskTitle}</strong><small>{new Date(record.finishedAt).toLocaleDateString(locale())} · {record.taskCompleted ? tr('zadanie ukończone', 'task completed') : tr('zapisana sesja', 'session saved')}</small></span>
        <span className="ins-focus-compare"><b>{formatFocusClock(record.focusSeconds)}</b><small>{tr('plan', 'planned')} {record.plannedMinutes} min</small>
          <i><span style={{ width: `${Math.min(100, record.focusSeconds / Math.max(60, record.plannedMinutes * 60) * 100)}%` }}/></i></span>
      </div>)}</div> : <p className="ins-empty"><Activity size={16}/> {tr('Uruchom Focus Mode z zadania w kalendarzu, a tutaj zobaczysz przepracowany czas.', 'Start Focus Mode from a task in the calendar and your focus time will show up here.')}</p>}
    </section>

    <section className="ins-card ins-card--badges">
      <div className="ins-card-head"><div><span className="eyebrow">{tr('OSIĄGNIĘCIA I ODZNAKI', 'ACHIEVEMENTS & BADGES')}</span><h3>{tr('Kolekcja', 'Collection')} · {earned}/{achievements.length}</h3></div><Award size={19}/></div>
      <div className="ins-rank-path" aria-label={tr('Ścieżka rang', 'Rank path')}>{RANKS.map(item => {
        const Icon = item.icon;
        const state = item.id === rank.id ? 'is-current' : totalXp >= item.minXp ? 'is-earned' : '';
        return <span key={item.id} className={`ins-rank-step ${state}`} style={{ '--rank-accent': item.accent } as React.CSSProperties} title={tr(`${item.title} · od ${formatNumber(item.minXp)} XP`, `${item.title} · from ${formatNumber(item.minXp)} XP`)}>
          <i><Icon size={14}/></i><small>{item.title}</small>
        </span>;
      })}</div>
      <div className="ins-filter" role="tablist" aria-label={tr('Filtr osiągnięć', 'Achievement filter')}>
        {([['all', tr(`Wszystkie ${achievements.length}`, `All ${achievements.length}`)], ['earned', tr(`Zdobyte ${earned}`, `Earned ${earned}`)], ['locked', tr(`Do zdobycia ${achievements.length - earned}`, `Locked ${achievements.length - earned}`)]] as const).map(([id, label]) =>
          <button type="button" key={id} role="tab" aria-selected={achievementFilter === id} className={achievementFilter === id ? 'is-active' : ''} onClick={() => setAchievementFilter(id)}>{label}</button>)}
      </div>
      <div className="ins-badge-groups">{badgeGroups.map(group => {
        const expanded = expandedGroups.includes(group.id);
        return <section key={group.id} className={`ins-badge-group ${expanded ? 'is-expanded' : ''}`} data-count={group.items.length} aria-label={group.label}>
          <div className="ins-badge-group-head">
            <h4>{group.label}</h4>
            <span className="ins-badge-group-count">{group.earned}/{group.total}</span>
            <span className="ins-badge-group-track" aria-hidden="true"><span style={{ width: `${group.earned / Math.max(1, group.total) * 100}%` }}/></span>
          </div>
          <div className="ins-badges">{group.items.map(item => {
            const percent = Math.min(100, Math.round(item.progress / item.target * 100));
            return <article key={item.id} className={`ins-badge ${item.unlocked ? 'is-unlocked' : 'is-locked'}`} title={item.description} style={{ '--achievement-accent': item.accent, '--achievement-tint': item.tint } as React.CSSProperties}>
              <span className="ins-badge-art"><img src={item.art} alt="" loading="lazy"/>{!item.unlocked && <i><Lock size={12}/></i>}</span>
              <strong>{item.title}</strong>
              <small>{item.description}</small>
              {item.unlocked ? <span className="ins-badge-reward">{item.reward}</span> : <span className="ins-badge-progress"><span style={{ width: `${Math.max(4, percent)}%` }}/></span>}
            </article>;
          })}</div>
          {group.items.length > 2 && <button type="button" className="ins-badge-more" aria-expanded={expanded} onClick={() => toggleGroup(group.id)}>
            {expanded ? <>{tr('Pokaż mniej', 'Show less')} <ChevronUp size={14}/></> : <>{tr(`Pokaż wszystkie (${group.items.length})`, `Show all (${group.items.length})`)} <ChevronDown size={14}/></>}
          </button>}
        </section>;
      })}</div>
      {!badgeGroups.length && <p className="ins-empty"><Sparkles size={16}/> {achievementFilter === 'earned' ? tr('Pierwsza odznaka czeka — ukończ dowolne zadanie albo rutynę.', 'Your first badge is waiting — complete any task or routine.') : tr('Wszystkie odznaki zdobyte. Niesamowite!', 'All badges earned. Amazing!')}</p>}
    </section>
  </div>;
}
