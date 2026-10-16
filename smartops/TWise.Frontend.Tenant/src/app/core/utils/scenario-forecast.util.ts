const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = 86_400_000;
export type ScenarioPeriodMode = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
type PeriodInterval = ScenarioPeriodMode | number;

interface Period {
  index: number;
  kind: string;
  start: number;
  end: number;
  step: number;
  next: (index: number) => Period;
  label: string;
}

function monthPeriod(index: number, format: 'short' | 'long' | 'iso', separator = '-', step = 1): Period {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return {
    index, kind: `month-${format}-${separator}-${step}`, step,
    start: Date.UTC(year, month, 1), end: Date.UTC(year, month + step, 0),
    label: format === 'iso' ? `${year}-${String(month + 1).padStart(2, '0')}`
      : `${MONTHS[month]}${separator}${format === 'short' ? String(year).slice(-2) : year}`,
    next: value => monthPeriod(value, format, separator, step),
  };
}

function dayPeriod(index: number, step: number): Period {
  const start = index * DAY;
  return {
    index, kind: `day-${step}`, step, start, end: start + (step - 1) * DAY,
    label: new Date(start).toISOString().slice(0, 10),
    next: value => dayPeriod(value, step),
  };
}

function quarterPeriod(index: number, yearFirst: boolean, separator: string, shortYear: boolean): Period {
  const year = Math.floor(index / 4);
  const quarter = index % 4;
  const yearLabel = shortYear ? String(year).slice(-2) : String(year);
  const quarterLabel = `Q${quarter + 1}`;
  return {
    index, kind: `quarter-${yearFirst}-${separator}-${shortYear}`, step: 1,
    start: Date.UTC(year, quarter * 3, 1), end: Date.UTC(year, quarter * 3 + 3, 0),
    label: yearFirst ? `${yearLabel}${separator}${quarterLabel}` : `${quarterLabel}${separator}${yearLabel}`,
    next: value => quarterPeriod(value, yearFirst, separator, shortYear),
  };
}

function yearPeriod(year: number): Period {
  return {
    index: year, kind: 'year', step: 1,
    start: Date.UTC(year, 0, 1), end: Date.UTC(year, 12, 0),
    label: String(year), next: yearPeriod,
  };
}

function isoDatePeriod(timestamp: number, mode: ScenarioPeriodMode): Period {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const index = year * 12 + month;
  const step = mode === 'yearly' ? 12 : mode === 'quarterly' ? 3 : 1;
  return {
    index, kind: `iso-calendar-${step}`, step,
    start: timestamp, end: Date.UTC(year, month + step, 0),
    label: date.toISOString().slice(0, 10),
    next: value => isoDatePeriod(Date.UTC(Math.floor(value / 12), value % 12, 1), mode),
  };
}

function isoWeekPeriod(year: number, week: number, yearFirst: boolean, separator: string): Period | null {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY;
  const start = monday + (week - 1) * 7 * DAY;
  const thursday = new Date(start + 3 * DAY);
  if (week < 1 || week > 53 || thursday.getUTCFullYear() !== year) return null;
  return weekPeriod(start / DAY, yearFirst, separator);
}

function weekPeriod(index: number, yearFirst: boolean, separator: string): Period {
  const start = index * DAY;
  const thursday = new Date(start + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY;
  const weekLabel = `W${String(Math.round((start - monday) / (7 * DAY)) + 1).padStart(2, '0')}`;
  return {
    index, kind: `week-${yearFirst}-${separator}`, step: 7, start, end: start + 6 * DAY,
    label: yearFirst ? `${year}${separator}${weekLabel}` : `${weekLabel}${separator}${year}`,
    next: value => weekPeriod(value, yearFirst, separator),
  };
}

function numberedWeekPeriod(index: number): Period {
  const start = index * 7 * DAY;
  return {
    index, kind: 'numbered-week', step: 1, start, end: start + 6 * DAY,
    label: `week${index}`, next: numberedWeekPeriod,
  };
}

function parsePeriod(label: string, interval: PeriodInterval): Period | null {
  const text = label.trim();
  const numberedWeek = interval === 'weekly' ? /^week\s*(\d+)$/i.exec(text) : null;
  if (numberedWeek) {
    const index = Number(numberedWeek[1]);
    return Number.isSafeInteger(index) && index > 0 && Number.isFinite(new Date(index * 7 * DAY).getTime())
      ? numberedWeekPeriod(index) : null;
  }
  const quarter = /^(?:Q([1-4])([- ])(\d{2}|\d{4})|(\d{4})([- ])Q([1-4]))$/i.exec(text);
  if (quarter) {
    const yearText = quarter[3] ?? quarter[4];
    const year = Number(yearText) + (yearText.length === 2 ? 2000 : 0);
    return quarterPeriod(year * 4 + Number(quarter[1] ?? quarter[6]) - 1, !!quarter[4],
      quarter[2] ?? quarter[5], yearText.length === 2);
  }
  const week = /^(?:(\d{4})([- ])W(\d{1,2})|W(\d{1,2})([- ])(\d{4}))$/i.exec(text);
  if (week) return isoWeekPeriod(Number(week[1] ?? week[6]), Number(week[3] ?? week[4]), !!week[1], week[2] ?? week[5]);
  if (/^\d{4}$/.test(text)) return yearPeriod(Number(text));
  const monthStep = interval === 'quarterly' ? 3 : interval === 'yearly' ? 12 : 1;
  const namedMonth = /^([A-Za-z]{3})([- ])(\d{2}|\d{4})$/.exec(text);
  if (namedMonth) {
    const month = MONTHS.findIndex(value => value.toLowerCase() === namedMonth[1].toLowerCase());
    if (month < 0) return null;
    const year = Number(namedMonth[3]) + (namedMonth[3].length === 2 ? 2000 : 0);
    return monthPeriod(year * 12 + month, namedMonth[3].length === 2 ? 'short' : 'long', namedMonth[2], monthStep);
  }
  const isoMonth = /^(\d{4})-(\d{2})$/.exec(text);
  if (isoMonth && Number(isoMonth[2]) >= 1 && Number(isoMonth[2]) <= 12) {
    return monthPeriod(Number(isoMonth[1]) * 12 + Number(isoMonth[2]) - 1, 'iso', '-', monthStep);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const timestamp = Date.parse(`${text}T00:00:00Z`);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== text) return null;
    if (typeof interval === 'string' && interval !== 'weekly') return isoDatePeriod(timestamp, interval);
    return dayPeriod(timestamp / DAY, interval === 'weekly' ? 7 : interval);
  }
  return null;
}

export function hasScenarioDatePeriods(labels: string[], interval: PeriodInterval = 1): boolean {
  return labels.length > 0 && labels.every(label => parsePeriod(label, interval) !== null);
}

export type ScenarioForecast =
  | { labels: string[]; values: number[][]; error: null }
  | { labels: []; values: []; error: string };

export interface ScenarioRegressionHistory {
  labels: string[];
  values: number[][];
}

/** Extend from the supplied date or last bucket's end; regress against calendar positions. */
export function forecastScenarioPeriods(
  labels: string[], series: number[][], days: number, interval: PeriodInterval = 1, horizonAnchor?: string,
  monthlyHistory?: ScenarioRegressionHistory,
): ScenarioForecast {
  const fail = (error: string): ScenarioForecast => ({ labels: [], values: [], error });
  if (typeof interval === 'number' && (!Number.isInteger(interval) || interval < 1 || interval > 7)) {
    return fail('Schedule Slippage requires a daily or weekly date interval.');
  }
  if (!Number.isInteger(days) || days < 1 || days > 120) return fail('Schedule Slippage must be between 1 and 120 whole days.');
  if (!labels.length) return fail('At least two existing periods are required to forecast Schedule Slippage.');
  const periods: Period[] = [];
  for (const label of labels) {
    const period = parsePeriod(label, interval);
    if (!period) return fail('Schedule Slippage requires date periods such as Oct-26, 2026-W42, Q4-2026, 2026 or 2026-10-01.');
    if (periods.length && (period.kind !== periods[0].kind || period.index <= periods[periods.length - 1].index)) {
      return fail('Schedule Slippage requires unique periods in chronological order and a consistent date format.');
    }
    periods.push(period);
  }
  if (!series.length || series.some(values => values.length !== labels.length || values.some(value => !Number.isFinite(value)))) {
    return fail('Every series must contain a finite numeric value for each period to forecast Schedule Slippage.');
  }
  const last = periods[periods.length - 1];
  let anchor = last.end;
  if (horizonAnchor !== undefined) {
    const parsedAnchor = parsePeriod(horizonAnchor, 1);
    if (!parsedAnchor || !/^\d{4}-\d{2}-\d{2}$/.test(horizonAnchor)) {
      return fail('Schedule Slippage requires a valid global To date.');
    }
    anchor = parsedAnchor.start;
  }
  const horizon = anchor + days * DAY;
  const future: Period[] = [];
  let next = last.next(last.index + last.step);
  while (next.start <= horizon) {
    future.push(next);
    next = last.next(next.index + last.step);
  }
  if (!future.length) return { labels: [], values: series.map(() => []), error: null };
  if (labels.length < 2) {
    if (interval === 'yearly' && monthlyHistory && horizonAnchor) {
      if (monthlyHistory.values.length !== series.length) return fail('Monthly history must contain every plotted series.');
      const months = monthlyHistory.labels.map(label => parsePeriod(label, 'monthly'));
      if (months.some(month => !month || !['month-', 'iso-calendar-'].some(kind => month.kind.startsWith(kind))
        || month.start > anchor)) {
        return fail('Monthly regression history requires monthly periods no later than the global To date.');
      }
      const monthly = forecastScenarioPeriods(monthlyHistory.labels, monthlyHistory.values, days, 'monthly', horizonAnchor);
      if (monthly.error !== null) return monthly;
      const forecastMonths = monthly.labels.map(label => parsePeriod(label, 'monthly')!);
      const values = monthly.values.map(data => future.map(year => {
        const calendarYear = new Date(year.start).getUTCFullYear();
        const sum = data.reduce((total, value, index) =>
          new Date(forecastMonths[index].start).getUTCFullYear() === calendarYear ? total + value : total, 0);
        return Math.round(sum * 100) / 100;
      }));
      if (values.some(data => data.some(value => !Number.isFinite(value)))) return fail('Schedule Slippage forecast exceeded the numeric range.');
      return { labels: future.map(year => year.label), values, error: null };
    }
    return fail('At least two existing periods are required to forecast Schedule Slippage.');
  }
  const x = periods.map(period => period.index - periods[0].index);
  const meanX = x.reduce((sum, value) => sum + value, 0) / x.length;
  const denominator = x.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  const values = series.map(data => {
    const meanY = data.reduce((sum, value) => sum + value, 0) / data.length;
    const slope = data.reduce((sum, value, index) => sum + (x[index] - meanX) * (value - meanY), 0) / denominator;
    return future.map(period => Math.round((meanY + slope * (period.index - periods[0].index - meanX)) * 100) / 100);
  });
  if (values.some(data => data.some(value => !Number.isFinite(value)))) return fail('Schedule Slippage forecast exceeded the numeric range.');
  let futureLabels = future.map(period => period.label);
  if (interval === 'weekly') {
    const date = new Date(last.start);
    const monday = last.start / DAY - ((date.getUTCDay() + 6) % 7);
    const lastWeek = last.kind === 'numbered-week' ? last.index : Number(weekPeriod(monday, true, '-').label.slice(-2));
    futureLabels = future.map((_, index) => `week${lastWeek + index + 1}`);
  }
  return { labels: futureLabels, values, error: null };
}
