import { Pipe, PipeTransform } from '@angular/core';
import type Highcharts from 'highcharts';

/**
 * True only for a pie/donut whose every slice is 0/empty — the case where Highcharts would
 * otherwise draw an empty ring. Any other chart type, a still-loading (null) options object, or a
 * pie with at least one non-zero slice returns false so existing rendering is untouched.
 */
@Pipe({ name: 'pieChartEmpty', standalone: false })
export class PieChartEmptyPipe implements PipeTransform {
  transform(options: Highcharts.Options | null | undefined): boolean {
    if (!options) return false;
    const series = options.series;
    if (!Array.isArray(series) || series.length === 0) return false;

    const chartType = options.chart?.type;
    const pieSeries = series.filter(s => ((s as { type?: string }).type ?? chartType) === 'pie');
    if (pieSeries.length === 0) return false;

    return pieSeries.every(s => {
      const data = (s as { data?: unknown[] }).data;
      if (!Array.isArray(data) || data.length === 0) return true;
      return data.every(point => !this.pointValue(point));
    });
  }

  private pointValue(point: unknown): number {
    if (typeof point === 'number') return point;
    if (Array.isArray(point)) return Number(point.at(-1)) || 0;
    if (point && typeof point === 'object') {
      const record = point as { y?: unknown; value?: unknown };
      return Number(record.y ?? record.value ?? 0) || 0;
    }
    return 0;
  }
}
