import type Highcharts from 'highcharts';

interface PositionedLabel extends Highcharts.SVGElement {
  alignAttr?: { x: number; y: number };
}

interface LabeledPoint extends Highcharts.Point {
  dataLabel?: PositionedLabel;
}

const lineTypes = new Set(['line', 'spline', 'area', 'areaspline']);

/** Keep line-chart values visible, moving only colliding labels rather than suppressing them. */
export function applyLineDataLabelLayout(options: Highcharts.Options): Highcharts.Options {
  if (!options.series?.length || !options.series.every(series => 'type' in series && lineTypes.has(series.type ?? ''))) return options;
  keepLabelsVisible(options.plotOptions);
  keepLabelsVisible(options.series);
  const render = options.chart?.events?.render;
  options.chart = {
    ...options.chart,
    events: {
      ...options.chart?.events,
      render(event) {
        render?.call(this, event);
        positionLineDataLabels(this);
      },
    },
  };
  return options;
}

function keepLabelsVisible(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'dataLabels') {
      for (const label of Array.isArray(value) ? value : [value]) {
        if (label && typeof label === 'object') (label as Record<string, unknown>)['allowOverlap'] = true;
      }
    } else {
      keepLabelsVisible(value);
    }
  }
}

export function positionLineDataLabels(chart: Highcharts.Chart): void {
  const labels = chart.series.filter(series => series.visible && lineTypes.has(series.type))
    .flatMap(series => series.points.flatMap((point: LabeledPoint) => {
      const label = point.dataLabel;
      if (!label || !label.element || label.attr('visibility') === 'hidden') return [];
      const bounds = label.getBBox();
      const x = label.alignAttr?.x ?? Number(label.attr('x'));
      const y = label.alignAttr?.y ?? Number(label.attr('y'));
      return [{
        label, x: x + chart.plotLeft, y: y + chart.plotTop,
        width: bounds.width, height: bounds.height,
      }];
    }))
    .sort((a, b) => b.y - a.y);
  const placed: { x: number; y: number; width: number; height: number }[] = [];
  const gap = 2;
  for (const item of labels) {
    const neighbours = placed.filter(other =>
      item.x < other.x + other.width + gap && item.x + item.width + gap > other.x);
    const minY = chart.plotTop;
    const maxY = chart.plotTop + chart.plotHeight - item.height;
    const preferred = Math.max(minY, Math.min(item.y, maxY));
    const candidates = [preferred, ...neighbours.flatMap(other =>
      [other.y - item.height - gap, other.y + other.height + gap])]
      .filter(y => y >= minY && y <= maxY)
      .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred) || a - b);
    const y = candidates.find(candidate => neighbours.every(other =>
      candidate + item.height + gap <= other.y || candidate >= other.y + other.height + gap)) ?? item.y;
    item.label.attr({ y: y - chart.plotTop });
    placed.push({ ...item, y });
  }
}
