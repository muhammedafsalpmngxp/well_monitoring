import type Highcharts from 'highcharts';

const label = (value: number): string => value.toLocaleString('en-US', { maximumFractionDigits: 2 });

/** Equal-width bins over a numeric column; bar height is the row count in each bin, labelled with its range. */
export function buildHistogramOptions(
  rows: Record<string, unknown>[], column: string, bins?: number | null, height?: number, colors: readonly string[] = [],
): Highcharts.Options {
  const values = rows
    .map(row => row[column])
    .filter(value => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter(Number.isFinite);

  const categories: string[] = [];
  const counts: number[] = [];
  if (values.length) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    // Sturges' rule when no bin count is given.
    const binCount = min === max ? 1 : Math.max(1, Math.floor(bins && bins > 0 ? bins : Math.ceil(Math.log2(values.length) + 1)));
    const width = (max - min) / binCount;
    for (let i = 0; i < binCount; i++) {
      categories.push(`${label(min + i * width)} - ${label(i === binCount - 1 ? max : min + (i + 1) * width)}`);
      counts.push(0);
    }
    for (const value of values) {
      counts[width ? Math.min(binCount - 1, Math.floor((value - min) / width)) : 0]++;
    }
  }

  return {
    chart: { type: 'column', backgroundColor: 'transparent', height },
    title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false },
    xAxis: { categories, title: { text: column || undefined } },
    yAxis: { title: { text: 'Frequency' }, allowDecimals: false },
    tooltip: { headerFormat: '<b>{point.key}</b><br/>', pointFormat: 'Count: <b>{point.y}</b>' },
    plotOptions: { column: { pointPadding: 0, groupPadding: 0, borderWidth: 1, borderColor: '#FFFFFF' } },
    series: [{
      type: 'column', name: column || 'Frequency',
      // Each bin keeps one colour across builder, view and boards; the id lets legends toggle it.
      data: counts.map((y, i) => ({ y, id: categories[i], name: categories[i], color: colors.length ? colors[i % colors.length] : undefined })),
    }],
  };
}
