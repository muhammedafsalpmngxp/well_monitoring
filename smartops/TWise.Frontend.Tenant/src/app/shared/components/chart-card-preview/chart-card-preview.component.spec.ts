import { describe, expect, it, vi } from 'vitest';
import { ChartCardPreviewComponent } from './chart-card-preview.component';
import { ChartsTilesModule } from '../../../features/charts-tiles/charts-tiles.module';

class PreviewHarness extends ChartCardPreviewComponent {
  build(type: string, categories: string[], values: number[]): void {
    // Exercise the same options builder used after data loading and chart-type switching.
    const build = Reflect.get(this, 'buildSingleChart') as (
      type: string, categories: string[], values: number[]
    ) => void;
    build.call(this, type, categories, values);
  }
}

function createPreview(): PreviewHarness {
  return Object.assign(Object.create(PreviewHarness.prototype), {
    cachedDesign: {}, cdr: { markForCheck: vi.fn() },
  });
}

describe('ChartCardPreviewComponent circular value labels', () => {
  const values = [128, 43, 27, 19, 38, 103, 65];
  const categories = values.map((_, i) => `Category ${i + 1}`);

  it('uses the existing chart module for template dependencies', () => {
    expect(ChartsTilesModule).toBeDefined();
  });

  it.each(['pie', 'donut'])('fits %s values outside slices without forced overlap', type => {
    const preview = createPreview();
    preview.build(type, categories, values);

    expect(preview.options?.plotOptions?.pie).toMatchObject({
      innerSize: type === 'donut' ? '55%' : '0%',
      showInLegend: true,
      dataLabels: {
        enabled: true, distance: 12, format: '{point.y}',
        connectorWidth: 1,
        style: { color: '#344054', textOutline: 'none' },
      },
    });
    expect(preview.options?.plotOptions?.series?.dataLabels).toMatchObject({ allowOverlap: false });
    expect(preview.options?.plotOptions?.pie?.size).toBeUndefined();
    expect(preview.options?.plotOptions?.pie?.center).toBeUndefined();
    expect(preview.options?.series?.[0]).toMatchObject({
      type: 'pie', data: values.map((y, i) => ({ name: categories[i], y })),
    });
  });

  it('preserves values, colors and zero filtering when switching pie to doughnut', () => {
    const preview = createPreview();
    preview.cachedDesign = {
      colorRules: [{ field: 'Category', categories: [categories[0]], color: '#123456' }],
    };
    preview.build('pie', [...categories, 'Empty'], [...values, 0]);
    const data = preview.options?.series?.[0];
    expect(data).toMatchObject({ data: [{ name: categories[0], y: 128, color: '#123456' },
      ...values.slice(1).map((y, i) => ({ name: categories[i + 1], y }))] });
    preview.build('donut', [...categories, 'Empty'], [...values, 0]);
    expect(preview.options?.series?.[0]).toEqual(data);
  });

  it.each(['pie', 'donut'])('respects hidden data labels for %s previews', type => {
    const preview = createPreview();
    preview.cachedDesign = { showDataLabels: false };
    preview.build(type, categories, values);
    expect(preview.options?.plotOptions?.pie?.dataLabels).toMatchObject({ enabled: false });
    expect(preview.options?.tooltip?.pointFormat).toContain('{point.y}');
  });
});

describe('ChartCardPreviewComponent color rules', () => {
  function buildMulti(preview: PreviewHarness, type: string, rows: Record<string, unknown>[]): void {
    const build = Reflect.get(preview, 'buildMultiSeriesChart') as (
      type: string, xAxis: string, yAxis: string, cols: string[], rows: Record<string, unknown>[]
    ) => void;
    build.call(preview, type, 'Month', 'Sum (F)', ['Drilled', 'Completed'], rows);
  }
  const rows = [
    { Month: 'Jan', Drilled: 116, Completed: 47 },
    { Month: 'Feb', Drilled: 169, Completed: 97 },
  ];

  it('colors a grouped series by its Category rule, including the legend color', () => {
    const preview = createPreview();
    preview.cachedDesign = { colorRules: [{ field: 'Category', categories: ['Completed'], color: '#ff0000' }] };
    buildMulti(preview, 'grouped', rows);
    const completed = (preview.options?.series as any[]).find(s => s.name === 'Completed');
    expect(completed.color).toBe('#ff0000');
    const drilled = (preview.options?.series as any[]).find(s => s.name === 'Drilled');
    expect(drilled.color).not.toBe('#ff0000');
  });

  it('colors grouped points matched by a value rule', () => {
    const preview = createPreview();
    preview.cachedDesign = { colorRules: [{ field: 'Drilled', operator: '>', value: '150', color: '#00aa00' }] };
    buildMulti(preview, 'grouped', rows);
    const drilled = (preview.options?.series as any[]).find(s => s.name === 'Drilled');
    expect(drilled.data).toEqual([116, { y: 169, color: '#00aa00' }]);
    const completed = (preview.options?.series as any[]).find(s => s.name === 'Completed');
    expect(completed.data).toEqual([47, 97]);
  });

  it('keeps stack totals numeric when points carry rule colors', () => {
    const preview = createPreview();
    preview.cachedDesign = { colorRules: [{ field: 'Drilled', operator: '>', value: '150', color: '#00aa00' }] };
    buildMulti(preview, 'stacked', rows);
    const total = (preview.options?.series as any[]).find(s => s.name === 'Total');
    expect(total.data).toEqual([163, 266]);
  });

  it('applies value rules to single-series bar previews', () => {
    const preview = createPreview();
    preview.cachedDesign = { colorRules: [{ field: 'Value', operator: '>=', value: '100', color: '#abcdef' }] };
    preview.build('bar', ['A', 'B'], [50, 120]);
    expect((preview.options?.series?.[0] as any).data).toEqual([50, { y: 120, color: '#abcdef' }]);
  });
});
