import type Highcharts from 'highcharts';
import {
  AdvancedCustomRenderer,
  getAdvancedCustomRenderers,
  registerAdvancedCustomRenderer,
} from './advanced-chart.util';

/**
 * Renderers for the "Custom Visual / Extensibility" chart type.
 *
 * The three renderers shipped with advanced-chart.util (Column, Line, Pie) duplicate chart types
 * the builder already offers, so selecting a custom visual gained the user nothing. These add
 * shapes the built-in palette genuinely cannot produce — polar and stepped forms — which is the
 * point of the feature.
 *
 * Adding one still needs a code change and a deployment: this is a compile-time extension point,
 * not runtime extensibility.
 *
 * Every renderer that sets `chart` must carry `animation: false` and
 * `backgroundColor: 'transparent'` through, because buildAdvancedChartOptions merges the returned
 * options over its base SHALLOWLY — a `chart` key here replaces the base's `chart` outright.
 *
 * Polar forms need highcharts-more, which app.config.ts already loads before these are used.
 */
// polar and inverted are stated explicitly, not left to defaults: the host updates the chart by
// MERGING options, so a flag set by one renderer survives a switch to another. Without this,
// selecting Radar then Column leaves the column chart drawn on a polar axis.
const CHART_BASE = { animation: false, backgroundColor: 'transparent', polar: false, inverted: false } as const;

const SERIES_NAME = 'Value';

const RENDERERS: AdvancedCustomRenderer[] = [
  {
    // Compares one measure across categories on a closed loop, so the overall "shape" is the
    // message. A bar chart shows the same numbers but not the profile.
    id: 'radar',
    label: 'Radar',
    render: (categories, values): Highcharts.Options => ({
      chart: { ...CHART_BASE, polar: true, type: 'area' },
      xAxis: { categories, tickmarkPlacement: 'on', lineWidth: 0 },
      yAxis: { gridLineInterpolation: 'polygon', lineWidth: 0, min: 0 },
      legend: { enabled: false },
      series: [{ type: 'area', name: SERIES_NAME, data: values, pointPlacement: 'on' }],
    }),
  },
  {
    // Wind rose: magnitude by direction/segment. Reading circular data on a linear axis hides
    // that the first and last categories are adjacent.
    id: 'polar-column',
    label: 'Polar Column (Wind Rose)',
    render: (categories, values): Highcharts.Options => ({
      chart: { ...CHART_BASE, polar: true, type: 'column' },
      xAxis: { categories, tickmarkPlacement: 'on', lineWidth: 0 },
      yAxis: { min: 0, endOnTick: false, showLastLabel: true },
      legend: { enabled: false },
      plotOptions: { column: { pointPadding: 0, groupPadding: 0, borderWidth: 0 } },
      series: [{ type: 'column', name: SERIES_NAME, data: values }],
    }),
  },
  {
    // Bars bent around a circle. Suits a handful of categories where the ranking matters more
    // than precise comparison, and reads well in a small dashboard tile.
    id: 'radial-bar',
    label: 'Radial Bar',
    render: (categories, values): Highcharts.Options => ({
      chart: { ...CHART_BASE, polar: true, type: 'column', inverted: true },
      pane: { innerSize: '20%', endAngle: 270 },
      xAxis: { categories, lineWidth: 0, tickInterval: 1, labels: { align: 'right', style: { fontSize: '11px' } } },
      yAxis: { min: 0, lineWidth: 0 },
      legend: { enabled: false },
      plotOptions: { column: { borderWidth: 0, pointPadding: 0, groupPadding: 0.15 } },
      series: [{ type: 'column', name: SERIES_NAME, data: values }],
    }),
  },
  {
    // Holds each value until the next one changes, so the data reads as discrete states rather
    // than a continuous trend. A plain line implies interpolation that did not happen.
    id: 'step-line',
    label: 'Step Line',
    render: (categories, values): Highcharts.Options => ({
      chart: { ...CHART_BASE, type: 'line' },
      xAxis: { categories },
      yAxis: { title: { text: undefined } },
      legend: { enabled: false },
      series: [{ type: 'line', name: SERIES_NAME, data: values, step: 'center', marker: { enabled: true, radius: 3 } }],
    }),
  },
  {
    // Same information as a bar chart with far less ink, which keeps many categories readable.
    // Built from a hairline column plus a marker, so it needs no extra Highcharts module.
    id: 'lollipop',
    label: 'Lollipop',
    render: (categories, values): Highcharts.Options => ({
      chart: { ...CHART_BASE, type: 'column' },
      xAxis: { categories },
      yAxis: { title: { text: undefined } },
      legend: { enabled: false },
      series: [
        {
          type: 'column', name: SERIES_NAME, data: values, pointWidth: 2, borderWidth: 0,
          // The stem is decoration; the marker carries the tooltip and the legend entry.
          enableMouseTracking: false, showInLegend: false,
        },
        { type: 'scatter', name: SERIES_NAME, data: values, marker: { radius: 6, symbol: 'circle' } },
      ],
    }),
  },
];

/**
 * Registers the renderers above. Idempotent: registerAdvancedCustomRenderer throws on a duplicate
 * id, and this can run more than once under hot module replacement.
 */
export function registerDefaultCustomRenderers(): void {
  const existing = new Set(getAdvancedCustomRenderers().map(renderer => renderer.id));
  for (const renderer of RENDERERS) {
    if (!existing.has(renderer.id)) registerAdvancedCustomRenderer(renderer);
  }
}
