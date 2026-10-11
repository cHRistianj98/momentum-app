export const dateKey = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const parseDate = (key: string): Date => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const shiftDate = (key: string, amount: number): string => {
  const d = parseDate(key);
  d.setDate(d.getDate() + amount);
  return dateKey(d);
};

export const mondayOf = (key: string): string => {
  const d = parseDate(key);
  const mondayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - mondayOffset);
  return dateKey(d);
};

export const fullDate = (key: string): string =>
  new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(parseDate(key));

export const monthTitle = (key: string): string =>
  new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(parseDate(key));

export const shortWeekday = (key: string): string =>
  new Intl.DateTimeFormat('pl-PL', { weekday: 'short' }).format(parseDate(key)).replace('.', '');

export const minuteOfDay = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

export const timeFromMinutes = (minutes: number): string => {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
};

export const formatDuration = (duration: number): string => {
  const h = Math.floor(duration / 60);
  const m = duration % 60;
  return [h ? `${h} godz.` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min';
};

export const todayKey = () => dateKey(new Date());
