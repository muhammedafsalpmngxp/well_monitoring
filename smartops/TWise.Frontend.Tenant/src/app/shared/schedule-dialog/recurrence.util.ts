/** How often a schedule runs, as the dialog offers it. Custom keeps any other cron as typed. */
export type Frequency = 'Once' | 'Hourly' | 'Daily' | 'Weekdays' | 'Weekly' | 'Monthly' | 'Custom';

/** day: on day N. lastDay: on the last day. first / last: on the first or last given weekday of the month. */
export type MonthlyMode = 'day' | 'lastDay' | 'first' | 'last';

/**
 * The friendly form of a recurrence. time is HH:mm (Hourly reads only the minutes); days and weekday are cron
 * day numbers, 0 Sunday to 6 Saturday; date is yyyy-MM-dd, for Once only; cron is for Custom only.
 */
export interface Recurrence {
  frequency: Frequency;
  time: string;
  date: string;
  days: number[];
  monthly: MonthlyMode;
  dayOfMonth: number;
  weekday: number;
  cron: string;
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function defaultRecurrence(): Recurrence {
  return { frequency: 'Daily', time: '07:00', date: '', days: [1], monthly: 'day', dayOfMonth: 1, weekday: 1, cron: '' };
}

/** The 5-field cron of a recurrence (Cronos standard format), or null for a single run. */
export function toCron(r: Recurrence): string | null {
  const [h, m] = r.time.split(':').map(Number);
  switch (r.frequency) {
    case 'Once': return null;
    case 'Custom': return r.cron.trim();
    case 'Hourly': return `${m} * * * *`;
    case 'Daily': return `${m} ${h} * * *`;
    case 'Weekdays': return `${m} ${h} * * 1-5`;
    case 'Weekly': return `${m} ${h} * * ${[...r.days].sort((a, b) => a - b).join(',')}`;
    case 'Monthly':
      if (r.monthly === 'lastDay') return `${m} ${h} L * *`;
      if (r.monthly === 'first') return `${m} ${h} * * ${r.weekday}#1`;
      if (r.monthly === 'last') return `${m} ${h} * * ${r.weekday}L`;
      return `${m} ${h} ${r.dayOfMonth} * *`;
  }
}

const NUM = /^\d{1,2}$/;

/** Reads cron back into the friendly form; anything the dialog cannot show comes back as Custom, unchanged. */
export function fromCron(cron: string | null): Recurrence {
  const base = defaultRecurrence();
  if (cron === null) return { ...base, frequency: 'Once' };
  const custom: Recurrence = { ...base, frequency: 'Custom', cron };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return custom;
  const [min, hour, dom, month, dow] = parts;
  if (!NUM.test(min) || +min > 59 || month !== '*') return custom;
  const mm = min.padStart(2, '0');
  if (hour === '*') return dom === '*' && dow === '*' ? { ...base, frequency: 'Hourly', time: `00:${mm}` } : custom;
  if (!NUM.test(hour) || +hour > 23) return custom;
  const time = `${hour.padStart(2, '0')}:${mm}`;

  if (dom === '*' && dow === '*') return { ...base, frequency: 'Daily', time };
  if (dom === '*' && dow === '1-5') return { ...base, frequency: 'Weekdays', time };
  if (dom === '*' && /^[0-6](,[0-6])*$/.test(dow)) {
    return { ...base, frequency: 'Weekly', time, days: [...new Set(dow.split(',').map(Number))].sort((a, b) => a - b) };
  }
  if (dom === '*' && /^[0-6]#1$/.test(dow)) return { ...base, frequency: 'Monthly', time, monthly: 'first', weekday: +dow[0] };
  if (dom === '*' && /^[0-6]L$/.test(dow)) return { ...base, frequency: 'Monthly', time, monthly: 'last', weekday: +dow[0] };
  if (dow === '*' && dom === 'L') return { ...base, frequency: 'Monthly', time, monthly: 'lastDay' };
  if (dow === '*' && NUM.test(dom) && +dom >= 1 && +dom <= 31) return { ...base, frequency: 'Monthly', time, monthly: 'day', dayOfMonth: +dom };
  return custom;
}

/** "Every weekday at 07:00 (Asia/Muscat)" and the like. */
export function describeRecurrence(r: Recurrence, timeZone: string): string {
  const at = `at ${r.time}`;
  const text = ((): string => {
    switch (r.frequency) {
      case 'Once': return `Once on ${formatDate(r.date)} ${at}`;
      case 'Hourly': return `Every hour at ${Number(r.time.split(':')[1])} minutes past`;
      case 'Daily': return `Every day ${at}`;
      case 'Weekdays': return `Every weekday ${at}`;
      case 'Weekly': return `Every ${listWords([...r.days].sort((a, b) => a - b).map(d => DAY_NAMES[d]))} ${at}`;
      case 'Monthly':
        if (r.monthly === 'lastDay') return `On the last day of every month ${at}`;
        if (r.monthly === 'first' || r.monthly === 'last') return `On the ${r.monthly} ${DAY_NAMES[r.weekday]} of every month ${at}`;
        return `On day ${r.dayOfMonth} of every month ${at}`;
      case 'Custom': return `Custom schedule: ${r.cron.trim()}`;
    }
  })();
  return `${text} (${timeZone})`;
}

/** The UTC ISO time of a wall-clock date (yyyy-MM-dd) and time (HH:mm) in an IANA zone. */
export function zonedToUtc(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // The zone's offset at the guess, then again at the corrected instant, settles summer-time changes.
  let utc = wall - zoneOffset(wall, timeZone);
  utc = wall - zoneOffset(utc, timeZone);
  return new Date(utc).toISOString();
}

/** The wall-clock date and time of a UTC instant in an IANA zone. */
export function utcToZoned(iso: string, timeZone: string): { date: string; time: string } {
  const p = zoneParts(Date.parse(iso), timeZone);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** A UTC instant as the schedule's zone reads it, e.g. "Mon 12 Oct 2026, 07:00". */
export function formatInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso));
}

function zoneParts(ms: number, timeZone: string): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

function zoneOffset(ms: number, timeZone: string): number {
  const p = zoneParts(ms, timeZone);
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000;
}

function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return 'a date to choose';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
}

function listWords(words: string[]): string {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}
