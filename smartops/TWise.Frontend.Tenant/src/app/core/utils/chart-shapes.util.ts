import type Highcharts from 'highcharts';

/**
 * Highcharts shapes shared by the dashboard chart preview (ChartCardPreviewComponent) and the reporting canvas.
 * Moved out of the preview's private methods so both draw the same thing; each caller adds its own size.
 */

/** A half-circle solid gauge from min to max, red through amber to green. Needs the solid-gauge module (app.config.ts). */
export function gaugeShape(value: number, min: number, max: number, name: string): Highcharts.Options {
  return {
    chart: { type: 'solidgauge' as any, backgroundColor: 'transparent' },
    title: { text: undefined }, credits: { enabled: false },
    pane: { startAngle: -90, endAngle: 90, background: [{ backgroundColor: '#EEE', innerRadius: '60%', outerRadius: '100%', shape: 'arc' }] } as any,
    yAxis: { min, max, stops: [[0.1, '#DC2626'], [0.5, '#F59E0B'], [0.9, '#16A34A']], lineWidth: 0, tickWidth: 0, minorTickInterval: null as any, labels: { enabled: false } } as any,
    plotOptions: { solidgauge: { dataLabels: { y: -20, borderWidth: 0, format: '<div style="text-align:center"><span style="font-size:18px;font-weight:600">{y}</span></div>' } } } as any,
    series: [{ type: 'solidgauge' as any, name, data: [value] }],
  };
}

/** A squarified treemap, one rectangle per point, coloured from the given palette in turn. Needs the treemap module. */
export function treemapShape(points: { name: string; value: number }[], name: string, colors: readonly string[]): Highcharts.Options {
  return {
    chart: { type: 'treemap' as any, backgroundColor: 'transparent' },
    title: { text: undefined }, credits: { enabled: false },
    series: [{
      type: 'treemap' as any, name, layoutAlgorithm: 'squarified', dataLabels: { enabled: true },
      data: points.map((point, i) => ({ name: point.name, value: point.value, color: colors[i % colors.length] })),
    }],
  };
}

/** The two value axes of a combo chart: the columns' on the left with grid lines, the lines' on the right without. */
export function comboAxes(gridLineColor: string): Highcharts.YAxisOptions[] {
  return [
    { title: { text: undefined }, gridLineColor },
    { title: { text: undefined }, opposite: true, gridLineWidth: 0 },
  ];
}
