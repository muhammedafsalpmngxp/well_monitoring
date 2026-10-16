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
