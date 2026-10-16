import type Highcharts from 'highcharts';

export function highlightLegendPoint(point: Highcharts.Point): void {
  point.setState('hover', true);
  if (point.series.type !== 'pie' || !point.graphic) return;

  const shape = point.shapeArgs;
  const radius = shape?.['r'];
  const start = shape?.['start'];
  const end = shape?.['end'];
  const borderWidth = Number(point.graphic.attr('stroke-width'));
  if (typeof radius !== 'number' || typeof start !== 'number' || typeof end !== 'number') return;

  // A white border can cover a narrow slice; expose its colour only while hovered.
  if (end > start && (end - start) * radius <= 2 * borderWidth) {
    point.graphic.attr({ stroke: String(point.graphic.attr('fill')) });
  }
}
