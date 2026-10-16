import type Highcharts from 'highcharts';
import { CHART_COLORS, CHART_THEME } from '../../core/constants/chart-view.constants';
import { QueryResult } from '../../core/services/model-studio.service';
import { comboAxes, gaugeShape, treemapShape } from '../../core/utils/chart-shapes.util';
import { CanvasItem, Highlight, MAX_SERIES, SERIES_CHART_TYPES } from './canvas-config.util';
import { displayValue, formatNumber, tileView } from './canvas-format.util';

/** A grouping value that is missing because the row had no match in a joined table. */
export const BLANK_LABEL = '(blank)';

const COMPACT_FORMAT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

type Rows = Pick<QueryResult, 'columns' | 'rows'>;

/** Receives the clicked category's value as the result holds it, null for a blank (P10-3). */
/** additive is set when Ctrl, Cmd or Shift was held, to add the point to the chosen ones. */
export type PointClick = (value: unknown, additive: boolean) => void;

/** One measure split by a second field: the categories in result order, the first MAX_SERIES series, and whether more were left out. */
export interface Pivot { categories: unknown[]; series: { name: string; data: (number | null)[] }[]; cut: boolean; }

/** An axis label: 12.5K and 3.4M for numbers, anything else as it is. */
export function compactLabel(value: number | string): string {
  return typeof value === 'number' ? COMPACT_FORMAT.format(value) : String(value);
}

/** Rows grouped by two fields, turned into one series per value of the second (P10-4). */
export function pivotSeries(result: Rows, axis: string, by: string, measure: string): Pivot {
  const categories: unknown[] = [];
  const positions = new Map<string, number>();
  const names: string[] = [];
  const cells = new Map<string, number | null>();
  for (const row of result.rows) {
    const category = categoryLabel(row[axis]);
    if (!positions.has(category)) {
      positions.set(category, categories.length);
      categories.push(row[axis]);
    }
    const name = categoryLabel(row[by]);
    if (!names.includes(name)) names.push(name);
    cells.set(`${category}\u0001${name}`, toNumber(row[measure]));
  }
  // ponytail: the series after the eighth are left out, not added into an "Other" series, which would be wrong for averages and ratios.
  return {
    categories,
    series: names.slice(0, MAX_SERIES).map(name => ({ name, data: [...positions.keys()].map(category => cells.get(`${category}\u0001${name}`) ?? null) })),
    cut: names.length > MAX_SERIES,
  };
}

/**
 * Highcharts options for a chart object, in the dashboard widgets' look (CHART_THEME). Pie, donut, treemap,
 * waterfall and funnel draw one measure; column, bar, line and area draw one series per measure, or one per
 * value of a second field; a combo draws the first measure as columns and the rest as lines on a second axis.
 * onPoint, when given, receives the value of the first field at the clicked category.
 */
/** The axis and value names of a chart that shows its measures as bars (measuresOnAxis). */
export const MEASURE_AXIS = 'Measure';
export const MEASURE_VALUE = 'Value';

/**
 * A chart with no axis field reads one row of measures; this turns it into one row per measure, named as the canvas
 * names it, so chartOptions draws one bar per measure.
 */
export function measureRows(item: CanvasItem, result: Rows, labels: Record<string, string> = {}): { item: CanvasItem; result: Rows } {
  const row = result.rows[0] ?? {};
  return {
    item: { ...item, dimensions: [MEASURE_AXIS], measures: [MEASURE_VALUE], tooltips: [], sortOrder: undefined },
    result: {
      columns: [MEASURE_AXIS, MEASURE_VALUE],
      rows: item.measures.map(name => ({ [MEASURE_AXIS]: labels[name] ?? name, [MEASURE_VALUE]: row[name] ?? null })),
    },
  };
}

export function chartOptions(item: CanvasItem, result: Rows, onPoint?: PointClick, palette: string[] = CHART_COLORS): Highcharts.Options {
  const color = (index: number): string => palette[index % palette.length];
  const type = item.chartType ?? 'column';
  const measure = item.measures[0];
  const axis = item.dimensions[0];
  const values = result.rows.map(row => row[axis]);
  const labels = values.map(categoryLabel);
  const clicks = (from: unknown[]): Highcharts.PlotSeriesOptions => (onPoint
    ? {
        cursor: 'pointer',
        point: {
          events: {
            click(this: Highcharts.Point, event: Highcharts.PointClickEventObject) {
              const keys = event as unknown as { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
              if (this.index < from.length) onPoint(from[this.index], !!(keys.ctrlKey || keys.metaKey || keys.shiftKey));
            },
          },
        },
      }
    : {});
  const base: Highcharts.Options = {
    chart: { type: type === 'donut' ? 'pie' : type === 'combo' ? 'column' : type, backgroundColor: 'transparent', style: { fontFamily: 'inherit' } },
    title: { text: undefined },
    credits: { enabled: false },
  };

  if (type === 'pie' || type === 'donut') {
    return {
      ...base,
      tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
      legend: { enabled: false, itemStyle: { ...CHART_THEME.legendItem } },
      plotOptions: {
        series: clicks(values),
        pie: {
          borderWidth: 2,
          borderColor: CHART_THEME.pieBorder,
          ...(type === 'donut' ? { innerSize: '55%' } : {}),
          // With data labels on, each slice shows its value inside it, and its name stays in the legend; off, the name beside it.
          dataLabels: item.dataLabels
            ? {
                distance: -30, style: { ...CHART_THEME.dataLabel, color: '#ffffff', textOutline: 'none' },
                formatter(this: Highcharts.Point) { return typeof this.y === 'number' ? formatNumber(this.y, item.format) : ''; },
              }
            : { style: { ...CHART_THEME.dataLabel, textOutline: 'none' } },
        },
      },
      series: [{
        type: 'pie',
        // One legend entry per slice; the legend itself is off unless the Format pane turns it on.
        showInLegend: true,
        name: measure,
        data: result.rows.map((row, i) => ({ name: labels[i], y: toNumber(row[measure]), color: color(i) })),
      }],
    };
  }

  if (type === 'treemap') {
    const shape = treemapShape(result.rows.map((row, i) => ({ name: labels[i], value: toNumber(row[measure]) ?? 0 })), measure, palette);
    return {
      ...shape, chart: { ...shape.chart, style: { fontFamily: 'inherit' } },
      legend: { enabled: false, itemStyle: { ...CHART_THEME.legendItem } },
      plotOptions: { series: clicks(values), treemap: { showInLegend: true, legendType: 'point' } as Highcharts.PlotTreemapOptions },
    };
  }

  if (type === 'scatter' || type === 'bubble') {
    const xName = item.xMeasure!;
    const yName = measure;
    const sizeName = type === 'bubble' ? item.sizeMeasure : undefined;
    const shown = (value: unknown) => (typeof value === 'number' ? formatNumber(value, item.format) : '');
    const axisOf = (name: string): Highcharts.XAxisOptions => ({
      title: { text: name, style: { ...CHART_THEME.axisLabels } },
      gridLineColor: CHART_THEME.gridLine,
      labels: { style: { ...CHART_THEME.axisLabels }, formatter(this: Highcharts.AxisLabelsFormatterContextObject) { return compactLabel(this.value as number); } },
    });
    return {
      ...base,
      chart: { ...base.chart, type, zooming: { type: 'xy' } },
      xAxis: { ...axisOf(xName), lineColor: CHART_THEME.axisLine, tickColor: CHART_THEME.axisLine },
      yAxis: axisOf(yName) as Highcharts.YAxisOptions,
      legend: { enabled: false },
      tooltip: {
        headerFormat: '',
        pointFormatter(this: Highcharts.Point & { z?: number }) {
          const size = sizeName ? `<br/>${sizeName}: <b>${shown(this.z)}</b>` : '';
          return `<b>${this.name}</b><br/>${xName}: <b>${shown(this.x)}</b><br/>${yName}: <b>${shown(this.y)}</b>${size}`;
        },
      },
      plotOptions: {
        series: clicks(values),
        scatter: { marker: { radius: 5, symbol: 'circle' } },
        bubble: { minSize: 8, maxSize: '22%' },
      },
      series: [{
        type,
        name: yName,
        color: color(0),
        // A row with no X or Y cannot be placed, so it has no point.
        data: result.rows.map((row, i) => ({
          name: labels[i], x: toNumber(row[xName]), y: toNumber(row[yName]), ...(sizeName ? { z: toNumber(row[sizeName]) } : {}),
          ...(item.tooltips?.length ? { custom: { row: i } } : {}),
        })).filter(point => point.x !== null && point.y !== null),
      }] as Highcharts.SeriesOptionsType[],
    };
  }

  if (type === 'bullet') {
    const target = item.target!;
    return {
      ...base,
      chart: { ...base.chart, type: 'bullet', inverted: true },
      xAxis: { categories: labels, labels: { style: { ...CHART_THEME.axisLabels } }, lineColor: CHART_THEME.axisLine },
      yAxis: {
        title: { text: undefined }, gridLineColor: CHART_THEME.gridLine,
        labels: { style: { ...CHART_THEME.axisLabels }, formatter(this: Highcharts.AxisLabelsFormatterContextObject) { return compactLabel(this.value as number); } },
      },
      legend: { enabled: false },
      tooltip: {
        pointFormatter(this: Highcharts.Point & { target?: number }) {
          const value = typeof this.y === 'number' ? formatNumber(this.y, item.format) : '';
          const goal = typeof this.target === 'number' ? formatNumber(this.target, item.format) : '';
          return `${measure}: <b>${value}</b><br/>${target}: <b>${goal}</b>`;
        },
      },
      plotOptions: {
        series: clicks(values),
        bullet: { borderRadius: 3, borderWidth: 0, pointPadding: 0.25, targetOptions: { width: '140%', height: 3, color: '#334155' } },
      } as Highcharts.PlotOptions,
      series: [{
        type: 'bullet', name: measure, color: color(0),
        data: result.rows.map(row => ({ y: toNumber(row[measure]), target: toNumber(row[target]) ?? undefined })),
      }] as Highcharts.SeriesOptionsType[],
    };
  }

  if (type === 'funnel') {
    return {
      ...base,
      legend: { enabled: false, itemStyle: { ...CHART_THEME.legendItem } },
      plotOptions: {
        series: clicks(values),
        funnel: {
          neckWidth: '30%', neckHeight: '25%', width: '80%',
          dataLabels: { enabled: true, format: '<b>{point.name}</b> {point.y:,.0f}', style: { ...CHART_THEME.dataLabel, textOutline: 'none' } },
        },
      },
      series: [{
        type: 'funnel', name: measure, showInLegend: true, data: result.rows.map((row, i) => ({ name: labels[i], y: toNumber(row[measure]), color: color(i) })),
      }] as Highcharts.SeriesOptionsType[],
    };
  }

  // Column, bar, line, area, combo and waterfall share the axes, the tooltip, the labels and the click.
  const pivot = item.series && SERIES_CHART_TYPES.includes(type) ? pivotSeries(result, axis, item.series, measure) : null;
  const categoryValues = pivot ? pivot.categories : values;
  const categories = categoryValues.map(categoryLabel);
  const seriesType = type === 'combo' ? 'column' : type;
  const series: Highcharts.SeriesOptionsType[] = type === 'waterfall'
    ? [{
        type: 'waterfall', name: measure, upColor: color(0), color: color(4),
        data: [...result.rows.map((row, i) => ({ name: labels[i], y: toNumber(row[measure]) })), { name: 'Total', isSum: true, color: color(2) }],
      } as Highcharts.SeriesOptionsType]
    : pivot
      ? pivot.series.map((entry, i) => ({ type: seriesType, name: entry.name, color: color(i), data: entry.data }) as Highcharts.SeriesOptionsType)
      : item.measures.map((name, i) => ({
          type: type === 'combo' && i > 0 ? 'line' : seriesType,
          name,
          color: color(i),
          data: result.rows.map(row => toNumber(row[name])),
          ...(type === 'combo' ? { yAxis: i === 0 ? 0 : 1 } : {}),
        }) as Highcharts.SeriesOptionsType);
  const several = series.length > 1;
  const valueAxis: Highcharts.YAxisOptions = {
    title: { text: undefined },
    gridLineColor: CHART_THEME.gridLine,
    labels: {
      style: { ...CHART_THEME.axisLabels },
      formatter(this: Highcharts.AxisLabelsFormatterContextObject) { return compactLabel(this.value as number | string); },
    },
    // A stacked chart with data labels also shows each stack's total above it, as the operations dashboard does.
    ...(item.stacking === 'normal' && item.dataLabels
      ? { stackLabels: { enabled: true, style: { ...CHART_THEME.dataLabel }, formatter(this: { total: number }) { return formatNumber(this.total, item.format); } } }
      : {}),
  };
  const stacking = item.stacking ? { stacking: item.stacking } : {};
  return {
    ...base,
    xAxis: {
      categories: type === 'waterfall' ? [...categories, 'Total'] : categories,
      title: { text: undefined },
      labels: { style: { ...CHART_THEME.axisLabels } },
      lineColor: CHART_THEME.axisLine,
      tickColor: CHART_THEME.axisLine,
    },
    yAxis: type === 'combo' ? comboAxes(CHART_THEME.gridLine).map(extra => ({ ...extra, labels: valueAxis.labels })) : valueAxis,
    legend: { enabled: several, itemStyle: { ...CHART_THEME.legendItem }, symbolRadius: 6 },
    // One tooltip for every series at a category, as the dashboards' multi-series charts show it.
    tooltip: {
      shared: several,
      pointFormatter(this: Highcharts.Point) {
        const value = typeof this.y === 'number' ? formatNumber(this.y, item.format) : '';
        return several ? `<span style="color:${this.color}">●</span> ${this.series.name}: <b>${value}</b><br/>` : `<b>${value}</b>`;
      },
    },
    plotOptions: {
      series: {
        ...clicks(categoryValues),
        dataLabels: {
          enabled: !!item.dataLabels,
          style: { ...CHART_THEME.dataLabel },
          formatter(this: Highcharts.Point) { return typeof this.y === 'number' ? formatNumber(this.y, item.format) : ''; },
        },
      },
      column: { borderRadius: 4, borderWidth: 0, ...stacking },
      bar: { borderRadius: 4, borderWidth: 0, ...stacking },
      area: { fillOpacity: 0.15, marker: { radius: 3 }, ...stacking },
      line: { marker: { radius: 3 } },
    },
    series,
  };
}

/**
 * The chart with a highlight drawn in: on the field of its own axis, the chosen categories keep their colour and the
 * others fade; on another field, the whole bars or line fade and the part the highlight rows hold is drawn over them.
 */
export function withHighlight(options: Highcharts.Options, item: CanvasItem, result: Rows, highlight: Highlight | null, part: Rows | null): Highcharts.Options {
  if (!highlight || options.series === undefined) return options;
  const axis = item.dimensions[0];
  const fade = (hex: string | undefined) => (hex && /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}4d` : hex);
  if (highlight.field === axis) {
    const chosen = new Set(highlight.values.map(value => value ?? '\u0000'));
    const keep = result.rows.map(row => chosen.has(row[axis] === null || row[axis] === undefined ? '\u0000' : String(row[axis])));
    return {
      ...options,
      series: options.series.map(series => {
        const data = (series as { data?: unknown[] }).data;
        const color = (series as { color?: string }).color;
        if (!Array.isArray(data)) return series;
        return {
          ...series,
          data: data.map((point, i) => i >= keep.length || keep[i] ? point
            : { ...(typeof point === 'object' && point !== null ? point : { y: point }), color: fade(color) }),
        } as Highcharts.SeriesOptionsType;
      }),
    };
  }
  if (!part) return options;
  const measure = item.measures[0];
  const byValue = new Map(part.rows.map(row => [String(row[axis]), row[measure]]));
  const base = options.series[0] as { color?: string; type?: string; name?: string };
  return {
    ...options,
    plotOptions: {
      ...options.plotOptions,
      column: { ...options.plotOptions?.column, grouping: false },
      bar: { ...options.plotOptions?.bar, grouping: false },
    },
    series: [
      { ...options.series[0], color: fade(base.color) } as Highcharts.SeriesOptionsType,
      {
        type: base.type, name: `${base.name} (highlighted)`, color: base.color, showInLegend: false, enableMouseTracking: false,
        data: result.rows.map(row => toNumber(byValue.get(String(row[axis])) ?? null)),
      } as Highcharts.SeriesOptionsType,
      ...options.series.slice(1),
    ],
  };
}

/**
 * The chart's tooltips with the Tooltips well's measures added under each point, read from the point's row. A split
 * chart has no row per point, so it gets none. labels are the canvas names of the measures.
 */
export function withTooltips(options: Highcharts.Options, item: CanvasItem, result: Rows, labels: Record<string, string> = {}): Highcharts.Options {
  const tips = item.series ? [] : item.tooltips ?? [];
  if (!tips.length) return options;
  const tooltip = (options.tooltip ?? {}) as Highcharts.TooltipOptions;
  const own = tooltip.pointFormatter;
  const shared = !!tooltip.shared;
  return {
    ...options,
    tooltip: {
      ...tooltip,
      pointFormat: undefined,
      pointFormatter(this: Highcharts.Point) {
        const head = own ? own.call(this) : `${this.series.name}: <b>${typeof this.y === 'number' ? formatNumber(this.y, item.format) : ''}</b>`;
        // A shared tooltip lists every series of the category; the extra lines go once, after the last.
        const last = !shared || this.series.index === this.series.chart.series.length - 1;
        const row = result.rows[(this.options as { custom?: { row?: number } }).custom?.row ?? this.index];
        if (!last || !row) return head;
        const lines = tips.map(name => {
          const value = row[name];
          return `${labels[name] ?? name}: <b>${typeof value === 'number' ? formatNumber(value, item.format) : displayValue(value)}</b>`;
        });
        return `${head}<br/>${lines.join('<br/>')}`;
      },
    },
  };
}

/** A tile shown as a gauge from 0 to its target (or to its value, past the target), or null without both (P10-5). */
export function gaugeOptions(item: CanvasItem, result: Rows): Highcharts.Options | null {
  const view = tileView(item, result.rows[0]);
  if (view.number === null || view.targetNumber === null) return null;
  const shape = gaugeShape(view.number, 0, Math.max(view.targetNumber, view.number), item.measures[0]);
  // The shared shape prints the raw number; the canvas writes it in the object's format, grouped (73,302).
  const value = formatNumber(view.number, item.format);
  // The scale under the value, so 28.4 reads as 28.4 of a target of 100 and not as a bare number.
  const target = formatNumber(view.targetNumber, item.format);
  const solid = (shape.plotOptions as { solidgauge?: { dataLabels?: object } } | undefined)?.solidgauge ?? {};
  return {
    ...shape,
    // A half circle drawn in the middle of the box leaves its lower half empty. The arc is fitted to the plot area once
    // it is drawn: as wide as the card allows and never taller than it, centred in the space.
    chart: { ...shape.chart, events: { render(this: Highcharts.Chart) { fitHalfGauge(this); } } },
    plotOptions: {
      ...shape.plotOptions,
      solidgauge: {
        ...solid,
        dataLabels: { ...(solid.dataLabels ?? {}), y: -34, format: `<div style="text-align:center"><span style="font-size:20px;font-weight:600">${value}</span><br/><span style="font-size:11px;color:#64748b">of ${target}</span></div>` },
      },
    } as Highcharts.PlotOptions,
  };
}

/**
 * Sizes a half-circle gauge to its plot area. It runs on every render, and its own update renders again, so it
 * updates only for a change of more than two pixels and at most a few times in a row for the same box.
 */
export function fitHalfGauge(chart: Highcharts.Chart): void {
  const width = chart.plotWidth;
  const height = chart.plotHeight;
  const diameter = Math.round(Math.max(40, Math.min(width, 2 * height) * 0.96));
  const centerY = Math.round((height + diameter / 2) / 2);
  const state = chart as unknown as { gaugeFit?: { size: number; center: number; box: string; tries: number } };
  const box = `${chart.chartWidth}x${chart.chartHeight}`;
  const last = state.gaugeFit;
  if (last && Math.abs(last.size - diameter) <= 2 && Math.abs(last.center - centerY) <= 2) return;
  const tries = last?.box === box ? last.tries + 1 : 1;
  if (tries > 3) return;
  state.gaugeFit = { size: diameter, center: centerY, box, tries };
  chart.update({ pane: { size: diameter, center: ['50%', centerY] } }, true, false, false);
}

/** The tile's measure for reading, in the object's number format; text is shown as it is. */
export function tileValue(item: CanvasItem, result: Rows): string {
  return tileView(item, result.rows[0]).value;
}

function categoryLabel(value: unknown): string {
  return value === null || value === undefined ? BLANK_LABEL : displayValue(value);
}

/** A result value as a number, or null when it is empty or not a number (Highcharts leaves a gap for null). */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
