import { useMemo, useState } from 'react';
import { Activity, Award, CalendarRange, CheckCircle2, Clock3, Flame, Lock, Sparkles, Target, TrendingDown, TrendingUp, Trophy, Zap } from 'lucide-react';
import { PlanReality } from './PlanReality';
import { formatDuration, monthTitle, mondayOf, parseDate, shiftDate, todayKey } from '../lib/date';
import { formatFocusClock, type FocusRecord } from '../lib/focus';
import { buildDailyReality, summarizeReality } from '../lib/planReality';
import { resolveCategories } from '../lib/storage';
import { RANKS, type AchievementView, type RankView } from '../lib/progression';
import type { AppData, CategoryKey } from '../types';

const CATEGORY_KEYS: CategoryKey[] = ['unpaid', 'potential', 'income'];
const HEATMAP_WEEKS = 12;
const WEEKDAY_INITIALS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];

type DayStat = { count: number; minutes: number };

interface Props {
  data: AppData;
  totalXp: number;
  currentLevel: number;
  levelXp: number;
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
  return `${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10} h`.replace('.', ',');
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
  if (previous <= 0) return current > 0 ? <span className="ins-delta is-up"><TrendingUp size={12}/> nowy wynik</span> : <span className="ins-delta">—</span>;
  const change = Math.round((current - previous) / previous * 100);
  if (change === 0) return <span className="ins-delta">bez zmian</span>;
  return <span className={`ins-delta ${change > 0 ? 'is-up' : 'is-down'}`}>{change > 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>} {change > 0 ? '+' : ''}{change}%</span>;
}

export function InsightsView({ data, totalXp, currentLevel, levelXp, streak, achievements, rank, nextRank, focusHistory }: Props) {
  const [chartView, setChartView] = useState<'week' | 'month'>('week');
  const [achievementFilter, setAchievementFilter] = useState<'all' | 'earned' | 'locked'>('all');
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
    ? recentDays.map(date => ({ key: date, ...sumRange(stats.byDate, date, 1), label: new Intl.DateTimeFormat('pl-PL', { weekday: 'short' }).format(parseDate(date)).replace('.', ''), sub: String(parseDate(date).getDate()), today: date === today }))
    : Array.from({ length: 4 }, (_, index) => {
      const start = shiftDate(today, -27 + index * 7);
      const end = shiftDate(start, 6);
      return { key: start, ...sumRange(stats.byDate, start, 7), label: `${parseDate(start).getDate()}–${parseDate(end).getDate()}`, sub: monthTitle(end).slice(0, 3), today: index === 3 };
    }), [chartView, recentDays, stats.byDate, today]);
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
      return month !== previous ? new Intl.DateTimeFormat('pl-PL', { month: 'short' }).format(parseDate(week[0].date)).replace('.', '') : '';
    });
    const past = weeks.flat().filter(cell => !cell.future);
    return { weeks, max, months, activeDays: past.filter(cell => cell.count > 0).length, totalDays: past.length };
  }, [stats.byDate, today]);
  const heatLevel = (count: number) => count === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(count / heatmap.max * 4)));

  const categoryTotal = CATEGORY_KEYS.reduce((sum, key) => sum + stats.byCategory[key], 0);
  let cumulative = 0;
  const donutStops = CATEGORY_KEYS.filter(key => stats.byCategory[key] > 0).map(key => {
    const start = cumulative;
    cumulative += stats.byCategory[key] / Math.max(1, categoryTotal) * 100;
    return `${categories[key].color} ${start}% ${cumulative}%`;
  });

  const xpIntoLevel = totalXp % levelXp;
  const earned = achievements.filter(item => item.unlocked).length;
  const closest = achievements.filter(item => !item.unlocked)
    .sort((a, b) => b.progress / b.target - a.progress / a.target || a.target - b.target).slice(0, 3);
  const visibleAchievements = achievementFilter === 'all' ? achievements : achievements.filter(item => achievementFilter === 'earned' ? item.unlocked : !item.unlocked);
  const focusSeconds = focusHistory.reduce((sum, record) => sum + record.focusSeconds, 0);
  const rankProgress = nextRank ? Math.max(0, Math.min(1, (totalXp - rank.minXp) / Math.max(1, nextRank.minXp - rank.minXp))) : 1;
  const RankIcon = rank.icon;

  return <div className="ins-page">
    <section className="ins-hero" style={{ '--rank-accent': rank.accent, '--rank-tint': rank.tint } as React.CSSProperties}>
      <img className="ins-hero-art" src={rank.art} alt="" aria-hidden="true"/>
      <div className="ins-hero-top">
        <Ring value={xpIntoLevel / levelXp} className="ins-hero-ring">
          <small>POZIOM</small><strong>{currentLevel}</strong><span>{xpIntoLevel}/{levelXp} XP</span>
        </Ring>
        <div className="ins-hero-copy">
          <span className="ins-hero-eyebrow"><RankIcon size={13}/> TWOJA RANGA</span>
          <h2>{rank.title}</h2>
          <p><strong>{totalXp.toLocaleString('pl-PL')} XP</strong> łącznie · {levelXp - xpIntoLevel} XP do poziomu {currentLevel + 1}</p>
        </div>
      </div>
      <div className="ins-hero-rank">
        <div className="ins-hero-rank-track"><span style={{ width: `${Math.max(4, rankProgress * 100)}%` }}/></div>
        <small>{nextRank ? <>Do rangi „{nextRank.title}”: <b>{(nextRank.minXp - totalXp).toLocaleString('pl-PL')} XP</b></> : 'Masz najwyższą rangę — gratulacje!'}</small>
      </div>
      <div className="ins-hero-chips">
        <span><Flame size={14}/> {streak} {streak === 1 ? 'dzień' : 'dni'} serii</span>
        <span><Award size={14}/> {earned}/{achievements.length} odznak</span>
        <span><CheckCircle2 size={14}/> {stats.completed} ukończonych</span>
      </div>
    </section>

    <div className="ins-tiles">
      <article className="ins-tile ins-tile--streak">
        <div className="ins-tile-head"><span className="ins-tile-icon"><Flame size={17}/></span><small>Seria</small></div>
        <strong>{streak} <em>{streak === 1 ? 'dzień' : 'dni'}</em></strong>
        <div className="ins-week-dots" aria-label="Aktywność w ostatnich 7 dniach">{recentDays.map(date => {
          const active = (stats.byDate.get(date)?.count ?? 0) > 0;
          return <span key={date} className={`${active ? 'is-active' : ''} ${date === today ? 'is-today' : ''}`} title={date}>
            <i/>{WEEKDAY_INITIALS[(parseDate(date).getDay() + 6) % 7]}
          </span>;
        })}</div>
        <small className="ins-tile-foot">Rekord: {best} {best === 1 ? 'dzień' : 'dni'}</small>
      </article>
      <article className="ins-tile ins-tile--done">
        <div className="ins-tile-head"><span className="ins-tile-icon"><CheckCircle2 size={17}/></span><small>Ukończone · 7 dni</small></div>
        <strong>{last7.count}</strong>
        <Delta current={last7.count} previous={prev7.count}/>
        <small className="ins-tile-foot">Łącznie {stats.completed}</small>
      </article>
      <article className="ins-tile ins-tile--time">
        <div className="ins-tile-head"><span className="ins-tile-icon"><Clock3 size={17}/></span><small>Czas w działaniu</small></div>
        <strong>{compactHours(last7.minutes)}</strong>
        <div className="ins-spark" aria-hidden="true">{recentDays.map(date => {
          const value = stats.byDate.get(date)?.minutes ?? 0;
          const max = Math.max(1, ...recentDays.map(day => stats.byDate.get(day)?.minutes ?? 0));
          return <span key={date} style={{ height: `${Math.max(8, value / max * 100)}%` }} className={value ? '' : 'is-empty'}/>;
        })}</div>
        <small className="ins-tile-foot">Łącznie {compactHours(stats.minutes)}</small>
      </article>
      <article className="ins-tile ins-tile--plan">
        <div className="ins-tile-head"><span className="ins-tile-icon"><Target size={17}/></span><small>Realizacja planu</small></div>
        <div className="ins-tile-ring">
          <Ring value={(planWeek.completion ?? 0) / 100} size={66} stroke={7}><strong>{planWeek.completion === null ? '—' : `${planWeek.completion}%`}</strong></Ring>
          <span>{planWeek.completedCount}/{planWeek.plannedCount}<small>z planu na 7 dni</small></span>
        </div>
      </article>
    </div>

    <div className="ins-grid">
      <section className="ins-card ins-card--chart">
        <div className="ins-card-head">
          <div><span className="eyebrow">{chartView === 'week' ? 'OSTATNIE 7 DNI' : 'OSTATNIE 4 TYGODNIE'}</span><h3>Twoja aktywność</h3></div>
          <div className="ins-switch" role="tablist" aria-label="Zakres wykresu" data-active={chartView}>
            <button type="button" role="tab" aria-selected={chartView === 'week'} onClick={() => setChartView('week')}>Tydzień</button>
            <button type="button" role="tab" aria-selected={chartView === 'month'} onClick={() => setChartView('month')}>Miesiąc</button>
          </div>
        </div>
        <div className={`ins-bars ins-bars--${chartView}`}>{chart.map(item => <div key={item.key} className={`ins-bar ${item.today ? 'is-today' : ''}`}
          title={`${item.count} ukończonych · ${formatDuration(item.minutes)}`}>
          <span className="ins-bar-value">{item.count || ''}</span>
          <div className="ins-bar-stage"><span style={{ height: `${item.count ? Math.max(10, item.count / chartMax * 100) : 3}%` }}/></div>
          <span className="ins-bar-label">{item.label}</span>
          <small>{item.sub}</small>
        </div>)}</div>
        <div className="ins-summary">
          <div><strong>{chartCount}</strong><span>ukończonych</span></div>
          <div><strong>{compactHours(chartMinutes)}</strong><span>czasu działania</span></div>
          <div><strong>{(chartCount / (chartView === 'week' ? 7 : 28)).toFixed(1).replace('.', ',')}</strong><span>średnio dziennie</span></div>
        </div>
      </section>

      <section className="ins-card ins-card--heatmap">
        <div className="ins-card-head">
          <div><span className="eyebrow">OSTATNIE {HEATMAP_WEEKS} TYGODNI</span><h3>Mapa regularności</h3></div>
          <span className="ins-card-badge"><CalendarRange size={14}/> {heatmap.activeDays}/{heatmap.totalDays} dni</span>
        </div>
        <div className="ins-heatmap" style={{ '--weeks': HEATMAP_WEEKS } as React.CSSProperties}>
          <div className="ins-heatmap-months">{heatmap.months.map((label, index) => <span key={index}>{label}</span>)}</div>
          <div className="ins-heatmap-body">
            <div className="ins-heatmap-days">{WEEKDAY_INITIALS.map((label, index) => <span key={label}>{index % 2 === 0 ? label : ''}</span>)}</div>
            <div className="ins-heatmap-grid">{heatmap.weeks.map((week, index) => <div className="ins-heatmap-week" key={index}>
              {week.map(cell => <span key={cell.date} className={`ins-heat ins-heat--${cell.future ? 'future' : heatLevel(cell.count)} ${cell.date === today ? 'is-today' : ''}`}
                title={cell.future ? undefined : `${new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long' }).format(parseDate(cell.date))}: ${cell.count} ukończonych`}/>)}
            </div>)}</div>
          </div>
          <div className="ins-heatmap-legend"><span>Mniej</span>{[0, 1, 2, 3, 4].map(level => <i key={level} className={`ins-heat ins-heat--${level}`}/>)}<span>Więcej</span></div>
        </div>
      </section>

      <section className="ins-card ins-card--donut">
        <div className="ins-card-head"><div><span className="eyebrow">PODZIAŁ CZASU</span><h3>Na co poświęcasz czas?</h3></div><Target size={19}/></div>
        <div className="ins-donut-layout">
          <div className="ins-donut" style={{ background: categoryTotal ? `conic-gradient(${donutStops.join(',')})` : 'var(--line)' }}>
            <div><strong>{compactHours(categoryTotal)}</strong><small>ukończonego czasu</small></div>
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
        <div className="ins-card-head"><div><span className="eyebrow">KOLEJNE CELE</span><h3>Najbliżej odblokowania</h3></div><Trophy size={19}/></div>
        {closest.length ? <div className="ins-next-list">{closest.map(item => {
          const percent = Math.min(100, Math.round(item.progress / item.target * 100));
          const Icon = item.icon;
          return <div className="ins-next" key={item.id} style={{ '--achievement-accent': item.accent, '--achievement-tint': item.tint } as React.CSSProperties}>
            <span className="ins-next-art"><img src={item.art} alt=""/><i><Icon size={12}/></i></span>
            <span className="ins-next-main"><strong>{item.title}</strong><small>{item.description}</small>
              <span className="ins-next-track"><span style={{ width: `${Math.max(4, percent)}%` }}/></span></span>
            <span className="ins-next-value">{percent}%<small>{Math.min(item.progress, item.target)}/{item.target}</small></span>
          </div>;
        })}</div> : <p className="ins-empty"><Sparkles size={16}/> Wszystkie odznaki zdobyte. Niesamowite!</p>}
      </section>
    </div>

    <PlanReality data={data} focusHistory={focusHistory}/>

    <section className="ins-card ins-card--focus">
      <div className="ins-card-head"><div><span className="eyebrow">FOCUS MODE</span><h3>Sesje skupienia</h3></div><Zap size={19}/></div>
      <div className="ins-focus-metrics">
        <div><small>Łącznie</small><strong>{formatFocusClock(focusSeconds)}</strong></div>
        <div><small>Sesje</small><strong>{focusHistory.length}</strong></div>
        <div><small>Średnio</small><strong>{focusHistory.length ? formatFocusClock(Math.round(focusSeconds / focusHistory.length)) : '00:00'}</strong></div>
      </div>
      {focusHistory.length > 0 ? <div className="ins-focus-list">{focusHistory.slice(-5).reverse().map(record => <div className="ins-focus-row" key={record.id}>
        <span><strong>{record.taskTitle}</strong><small>{new Date(record.finishedAt).toLocaleDateString('pl-PL')} · {record.taskCompleted ? 'zadanie ukończone' : 'zapisana sesja'}</small></span>
        <span className="ins-focus-compare"><b>{formatFocusClock(record.focusSeconds)}</b><small>plan {record.plannedMinutes} min</small>
          <i><span style={{ width: `${Math.min(100, record.focusSeconds / Math.max(60, record.plannedMinutes * 60) * 100)}%` }}/></i></span>
      </div>)}</div> : <p className="ins-empty"><Activity size={16}/> Uruchom Focus Mode z zadania w kalendarzu, a tutaj zobaczysz przepracowany czas.</p>}
    </section>

    <section className="ins-card ins-card--badges">
      <div className="ins-card-head"><div><span className="eyebrow">OSIĄGNIĘCIA I ODZNAKI</span><h3>Kolekcja · {earned}/{achievements.length}</h3></div><Award size={19}/></div>
      <div className="ins-rank-path" aria-label="Ścieżka rang">{RANKS.map(item => {
        const Icon = item.icon;
        const state = item.id === rank.id ? 'is-current' : totalXp >= item.minXp ? 'is-earned' : '';
        return <span key={item.id} className={`ins-rank-step ${state}`} style={{ '--rank-accent': item.accent } as React.CSSProperties} title={`${item.title} · od ${item.minXp} XP`}>
          <i><Icon size={14}/></i><small>{item.title}</small>
        </span>;
      })}</div>
      <div className="ins-filter" role="tablist" aria-label="Filtr osiągnięć">
        {([['all', `Wszystkie ${achievements.length}`], ['earned', `Zdobyte ${earned}`], ['locked', `Do zdobycia ${achievements.length - earned}`]] as const).map(([id, label]) =>
          <button type="button" key={id} role="tab" aria-selected={achievementFilter === id} className={achievementFilter === id ? 'is-active' : ''} onClick={() => setAchievementFilter(id)}>{label}</button>)}
      </div>
      <div className="ins-badges">{visibleAchievements.map(item => {
        const percent = Math.min(100, Math.round(item.progress / item.target * 100));
        return <article key={item.id} className={`ins-badge ${item.unlocked ? 'is-unlocked' : 'is-locked'}`} style={{ '--achievement-accent': item.accent, '--achievement-tint': item.tint } as React.CSSProperties}>
          <span className="ins-badge-art"><img src={item.art} alt="" loading="lazy"/>{!item.unlocked && <i><Lock size={12}/></i>}</span>
          <strong>{item.title}</strong>
          <small>{item.description}</small>
          {item.unlocked ? <span className="ins-badge-reward">{item.reward}</span> : <span className="ins-badge-progress"><span style={{ width: `${Math.max(4, percent)}%` }}/></span>}
        </article>;
      })}</div>
    </section>
  </div>;
}
