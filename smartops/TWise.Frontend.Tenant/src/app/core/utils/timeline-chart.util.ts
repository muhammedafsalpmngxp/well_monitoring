import type Highcharts from 'highcharts';

export interface TimelineColumns {
  start: string;
  end?: string;
  task: string;
}

const text = (value: unknown): string =>
  value == null ? '' : (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') ? String(value) : '';

function toTime(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const dayFirst = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(value.trim());
  if (dayFirst) return Date.UTC(Number(dayFirst[3]), Number(dayFirst[2]) - 1, Number(dayFirst[1]));
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/** Gantt-style duration bars per task; charts saved before End Date existed keep their milestone view. */
export function buildTimelineOptions(
  rows: Record<string, unknown>[], columns: TimelineColumns, height?: number,
): Highcharts.Options {
  const { start, end, task } = columns;
  if (!end) {
    return {
      chart: { type: 'timeline' as any, backgroundColor: 'transparent', height },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
      xAxis: { visible: false }, yAxis: { visible: false },
      series: [{ type: 'timeline' as any, name: task || 'Timeline', data: rows.map(r => ({ name: text(r[task]), label: text(r[start]) })) }],
    };
  }

  const tasks: string[] = [];
  const data: Highcharts.XrangePointOptionsObject[] = [];
  for (const row of rows) {
    const from = toTime(row[start]);
    const to = toTime(row[end]);
    if (from === null || to === null) continue;
    const name = text(row[task]) || '(empty)';
    let y = tasks.indexOf(name);
    if (y < 0) y = tasks.push(name) - 1;
    data.push({ x: Math.min(from, to), x2: Math.max(from, to), y, name });
  }

  const minHeight = tasks.length * 28 + 80;
  const scrolls = !!height && minHeight > height;
  return {
    chart: {
      type: 'xrange', height,
      // The scroll mask is filled with the chart background; a transparent one lets bars show through the fixed date axis.
      backgroundColor: scrolls ? '#FFFFFF' : 'transparent',
      ...(scrolls ? { scrollablePlotArea: { minHeight, opacity: 1 } } : {}),
    },
    title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
    xAxis: { type: 'datetime' },
    yAxis: { type: 'category', categories: tasks, reversed: true, title: { text: undefined } },
    tooltip: { pointFormat: '<b>{point.name}</b><br/>{point.x:%d %b %Y} - {point.x2:%d %b %Y}' },
    series: [{ type: 'xrange', name: task || 'Tasks', colorByPoint: true, borderRadius: 3, data }],
  };
}
