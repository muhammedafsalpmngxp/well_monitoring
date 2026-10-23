import { describe, expect, it, vi } from 'vitest';
import { Observable, Subject, of, throwError } from 'rxjs';
import Highcharts from 'highcharts';
import { aggregateChartRows } from '../../core/utils/chart-aggregation.util';
import { ChartBuilderComponent } from './chart-builder/chart-builder.component';
import { WidgetViewComponent } from './widget-view/widget-view.component';

const rows = [
  { Period: 'Jan-26', Value: 1 }, { Period: 'Jan-26', Value: 9 },
  { Period: 'Feb-26', Value: 2 }, { Period: 'Feb-26', Value: 8 },
  { Period: 'Mar-26', Value: 1 }, { Period: 'Mar-26', Value: 10 },
  { Period: 'Apr-26', Value: 3 }, { Period: 'Apr-26', Value: 8 },
  { Period: 'May-26', Value: 0 },
];

function editor(operation = ''): ChartBuilderComponent {
  const component: ChartBuilderComponent = Object.assign(Object.create(ChartBuilderComponent.prototype), {
    xAxis: 'Period', yAxis: operation, yAggColumn: 'Value', tableRows: rows,
    parameterFilters: [], limitEnabled: false, filterValues: {},
    dataSourceMode: 'view', multiYColumns: [], selectedChartType: 'pie',
    colorRules: [], colorOverrides: {}, showLegend: true,
    cdr: { detectChanges: vi.fn(), markForCheck: vi.fn() },
  });
  vi.spyOn(component, 'previewRows', 'get').mockReturnValue(rows);
  return component;
}

function details(): WidgetViewComponent {
  return Object.assign(Object.create(WidgetViewComponent.prototype), {
    design: { source: 'Supervisor view', viewId: 12, dataSourceMode: 'view' },
    savedWidget: { source: 'Supervisor view', sourceId: 99, sourceType: 'View' },
    viewIdForPreview: 12, viewConnectionId: 7,
    viewSql: "DECLARE @start_date DATE; DECLARE @end_date DATE; SELECT Period, Value FROM Supervisor;",
    fromDate: '2026-01-01', toDate: '2026-10-13',
    filters: [], advancedFilters: [], filterValues: {}, filterOptionsRequested: new Set(),
    cancelGlobalFilter$: new Subject<void>(), destroy$: new Subject<void>(),
    cdr: { markForCheck: vi.fn() },
  });
}

describe('Chart editor and details parity', () => {
  it.each<[string, number[]]>([
    ['', [1, 2, 1, 3, 0]],
    ['None', [1, 2, 1, 3, 0]],
    ['Sum (F)', [10, 10, 11, 11, 0]],
    ['Count (F)', [2, 2, 2, 2, 1]],
    ['Count Distinct (F)', [2, 2, 2, 2, 1]],
    ['Average (F)', [5, 5, 5.5, 5.5, 0]],
    ['Min (F)', [1, 2, 1, 3, 0]],
    ['Max (F)', [9, 8, 10, 8, 0]],
  ])('uses identical categories and values for operation "%s"', (operation, values) => {
    const edit = editor(operation);
    const view = details();
    const actual = edit['computeChartData']();
    expect(actual).toEqual({ categories: ['Jan-26', 'Feb-26', 'Mar-26', 'Apr-26', 'May-26'], values });
    expect(view['aggregate'](rows, 'Period', operation, 'Value'))
      .toEqual({ cats: actual.categories, vals: actual.values });
  });

  it('preserves decimal precision in both screens', () => {
    const data = [{ Period: 'Jan', Value: 1.2345 }, { Period: 'Jan', Value: 2.3456 }];
    const edit = editor('Average (F)');
    vi.spyOn(edit, 'previewRows', 'get').mockReturnValue(data);
    expect(details()['aggregate'](data, 'Period', 'Average (F)', 'Value').vals)
      .toEqual(edit['computeChartData']().values);
    expect(edit['computeChartData']().values[0]).toBeCloseTo(1.79005, 8);
  });

  it('retains legacy direct value-column mappings', () => {
    expect(aggregateChartRows(rows, 'Period', 'Value', '').values).toEqual([1, 2, 1, 3, 0]);
  });

  it('does not manufacture values when None has no value column', () => {
    expect(aggregateChartRows(rows, 'Period', 'None', '')).toEqual({ categories: [], values: [] });
    expect(aggregateChartRows([], 'Period', 'Sum (F)', 'Value')).toEqual({ categories: [], values: [] });
  });

  it('handles count nulls, distinct values and empty categories consistently', () => {
    const data = [null, '', '3', '3', 'invalid'].map(Value => ({ Period: null, Value }));
    expect(aggregateChartRows(data, 'Period', 'Count (F)', 'Value')).toEqual({ categories: ['(empty)'], values: [3] });
    expect(aggregateChartRows(data, 'Period', 'Count Distinct (F)', 'Value').values).toEqual([2]);
    expect(aggregateChartRows(data, 'Period', 'Sum (F)', 'Value').values).toEqual([6]);
    expect(aggregateChartRows(data, 'Period', 'Count (F)', '').values).toEqual([5]);
  });

  it('keeps the same first 100 category limit', () => {
    const data = Array.from({ length: 105 }, (_, i) => ({ Period: `Month ${i}`, Value: i }));
    const result = aggregateChartRows(data, 'Period', '', 'Value');
    expect(result.categories).toHaveLength(100);
    expect(result.categories[99]).toBe('Month 99');
    expect(details()['aggregate'](data, 'Period', '', 'Value')).toEqual({ cats: result.categories, vals: result.values });
  });

  it('uses category/value legends for a Period pie instead of a Value series legend', () => {
    const edit = editor();
    edit.previewData = edit['computeChartData']();
    Object.assign(edit, { previewPointColor: vi.fn(() => '#123456') });
    const chart: Highcharts.Chart = Object.assign(Object.create(Highcharts.Chart.prototype), {
      redraw: vi.fn(),
      series: [{ type: 'pie', name: 'Value', points: edit.previewData.categories.map((name, i) => ({
        name, y: edit.previewData.values[i], color: '#123456', options: {},
      })) }],
    });
    edit.onPreviewChartInstance(chart);
    expect(edit.previewLegendItems.map(item => ({ label: item.label, value: item.value })))
      .toEqual(edit.previewData.categories.map((label, i) => ({ label, value: edit.previewData.values[i] })));
  });

  it.each(['pie', 'donut'] as const)('keeps zero categories but hides their %s slice labels in both screens', type => {
    const edit = editor();
    edit.selectedChartType = type;
    edit.previewData = edit['computeChartData']();
    Object.assign(edit, { previewPointColor: vi.fn(() => '#123456') });
    const view = details();
    Object.assign(view, {
      chart: { title: 'Supervisor' },
      categories: edit.previewData.categories.map((label, i) => ({ key: label, label, value: edit.previewData.values[i], color: '#123456' })),
    });
    const editSeries = edit['buildSinglePreviewSeries']('pie', true, 'Value', edit.previewData.categories, edit.previewData.values) as Highcharts.SeriesPieOptions;
    const viewOptions = type === 'pie'
      ? view['buildPieOptions']('M', vi.fn())
      : view['buildDonutOptions']('M', vi.fn());
    const viewSeries = viewOptions.series?.[0] as Highcharts.SeriesPieOptions;
    expect(editSeries.data?.map(point => typeof point === 'object' && point && 'y' in point ? point.y : null))
      .toEqual(viewSeries.data?.map(point => typeof point === 'object' && point && 'y' in point ? point.y : null));
    expect(editSeries.data?.[4]).toMatchObject({ y: 0, dataLabels: { enabled: false } });
    expect(viewSeries.data?.[4]).toMatchObject({ y: 0, dataLabels: { enabled: false } });
  });

  it('does not re-filter aggregate view rows using an unrelated returned date column', () => {
    const edit = editor();
    Object.assign(edit, { fromDate: '2026-01-01', toDate: '2026-10-13', yAxisColumns: ['Period', 'Value', 'LastUpdatedDate'] });
    expect(edit['matchesGlobalDateRange']({ Period: 'Jan-26', Value: 1, LastUpdatedDate: '2025-01-01' })).toBe(true);
  });

  it('sends the same initial view request as the editor, including dates, locked and Advanced Filters', () => {
    const view = details();
    view['viewSql'] += " DECLARE @Site VARCHAR(100) = 'All';";
    const locked = { id: 1, sourceTable: 'Supervisor view', sourceColumn: 'Site', controlType: 'MultiSelect',
      locked: true, value: '', values: ['A', 'B'], label: 'Site' };
    Object.assign(view, { filters: [locked] });
    const globals = [{ sourceTable: '', sourceColumn: 'CEO', controlType: 'MultiSelect', value: 'Selected', advancedHierarchy: 'ceo-sector-head' }];
    Object.assign(view, { globalHierarchyFilterPayload: vi.fn(() => globals) });
    const edit = editor();
    const getFilteredChartData = vi.fn((_request: unknown) => new Subject());
    Object.assign(edit, {
      selectedChartModelId: 'Supervisor view', sourceLoadVersion: 0,
      viewDateParameters: new Map([[12, { fromDate: true, toDate: true }]]),
      fromDate: view.fromDate, toDate: view.toDate, interactiveFilters: [{ ...locked, lockedValues: locked.values }],
      rawLoadedColumns: ['Site'], viewSqlCache: new Map([[12, view['viewSql']]]),
      selectedViewId: 12, availableViews: [{ id: 12, viewName: 'Supervisor view' }],
      widgetService: { getFilteredChartData }, destroy$: new Subject<void>(),
      globalHierarchyFilterPayload: vi.fn(() => globals),
    });
    edit['hydrateViewSourcePreview']('Supervisor view', 12, {});
    expect(getFilteredChartData).toHaveBeenCalledOnce();
    expect(view['viewChartDataRequest']()).toEqual(getFilteredChartData.mock.calls[0][0]);
    expect(view['viewChartDataRequest']().viewId).toBe(12);
  });

  it('does not send workspace dates to views without date parameters', () => {
    const view = details();
    view['viewSql'] = 'SELECT Period, Value FROM Supervisor;';
    expect(view['viewChartDataRequest']()).toMatchObject({ fromDate: undefined, toDate: undefined });
  });

  it('keeps selected dates when initializing ordinary view parameters', () => {
    const view = details();
    view['initDateParamsFromSql']("DECLARE @start_date DATE = '2025-04-01'; DECLARE @end_date DATE;");
    expect([view.fromDate, view.toDate]).toEqual(['2026-01-01', '2026-10-13']);
  });

  it('preserves Tile Details SQL date defaults', () => {
    const view = details();
    Object.assign(view, { widgetType: 'tile' });
    const expectedEnd = view['lastTuesday'](new Date());
    view['initDateParamsFromSql']("DECLARE @start_date DATE = '2025-04-01'; DECLARE @end_date DATE;");
    expect([view.fromDate, view.toDate]).toEqual(['2025-04-01', expectedEnd]);
  });

  it.each(['tile', 'trend', 'table'] as const)('does not add chart-only hierarchy post-filtering to the existing %s loader', kind => {
    const view = details();
    Object.assign(view, {
      widgetType: kind === 'tile' ? 'tile' : 'chart', filterValues: { country: 'Oman' },
      design: kind === 'trend' ? { chartType: 'line' } : {},
      rebuildChart: vi.fn(), refreshTileValue: vi.fn(),
    });
    const data = [{ Country: 'Oman', Value: 1 }, { Country: 'Qatar', Value: 2 }];
    view['applyLoadedData'](['Country', 'Value'], data);
    expect(view.filteredRows).toEqual(data);
  });

  it('still applies global hierarchy restrictions to the unified chart loader', () => {
    const view = details();
    Object.assign(view, { filterValues: { country: 'Oman' }, rebuildChart: vi.fn() });
    const data = [{ Country: 'Oman', Value: 1 }, { Country: 'Qatar', Value: 2 }];
    view['applyLoadedData'](['Country', 'Value'], data, true);
    expect(view.filteredRows).toEqual([data[0]]);
  });

  it.each(['table', 'import'])('preserves existing %s date filtering', mode => {
    const edit = editor();
    Object.assign(edit, {
      dataSourceMode: mode, fromDate: '2026-01-01', toDate: '2026-10-13',
      findRowDate: (row: Record<string, unknown>) => String(row['EventDate']),
    });
    expect(edit['matchesGlobalDateRange']({ EventDate: '2025-12-31' })).toBe(false);
    expect(edit['matchesGlobalDateRange']({ EventDate: '2026-05-01' })).toBe(true);
    expect(edit['matchesGlobalDateRange']({ EventDate: '2026-10-14' })).toBe(false);
  });

  it.each(['top', 'bottom'])('retains %s category limits and Others totals', limitCategory => {
    const edit = editor('Sum (F)');
    Object.assign(edit, { limitCategory, topN: 2, bottomN: 2, groupRestAsOthers: true });
    expect(edit['computeChartData']()).toEqual(limitCategory === 'top'
      ? { categories: ['Mar-26', 'Apr-26', 'Others'], values: [11, 11, 20] }
      : { categories: ['May-26', 'Jan-26', 'Others'], values: [0, 10, 32] });
  });

  it('does not change trend chart loading to the single-series endpoint', () => {
    const view = details();
    const loadTrendData = vi.fn();
    const loadViewChartData = vi.fn();
    Object.assign(view, { design: { chartType: 'line' }, loadTrendData, loadViewChartData });
    view['applyGlobalFilter']();
    expect(loadTrendData).toHaveBeenCalledOnce();
    expect(loadViewChartData).not.toHaveBeenCalled();
  });

  it('leaves Advanced Filter payload empty when no hierarchy is selected', () => {
    const view = details();
    expect(view['viewChartDataRequest']().filters).toEqual([]);
  });

  it.each(['applyGlobalFilter', 'onDateChange'] as const)('uses the filtered chart endpoint on %s', action => {
    const view = details();
    const getFilteredChartData = vi.fn(() => of({ columns: ['Period', 'Value'], rows }));
    Object.assign(view, { widgetService: { getFilteredChartData }, datePattern: /^\d{4}-\d{2}-\d{2}$/, hasDateParams: true });
    const applyLoadedData = vi.fn();
    Object.assign(view, { applyLoadedData });
    view[action]();
    expect(getFilteredChartData).toHaveBeenCalledWith(view['viewChartDataRequest']());
    expect(applyLoadedData).toHaveBeenCalledWith(['Period', 'Value'], rows, true);
  });

  it('cancels stale reloads and explicitly surfaces failed view requests', () => {
    const view = details();
    const response$ = new Subject();
    const getFilteredChartData = vi.fn((): Observable<unknown> => response$);
    Object.assign(view, { widgetService: { getFilteredChartData } });
    const applyLoadedData = vi.fn();
    Object.assign(view, { applyLoadedData });
    view['applyGlobalFilter']();
    view['applyGlobalFilter']();
    response$.next({ rows, columns: ['Period', 'Value'] });
    expect(applyLoadedData).toHaveBeenCalledOnce();
    getFilteredChartData.mockImplementation(() => throwError(() => new Error('failed')));
    view['applyGlobalFilter']();
    expect(view.error).toContain('Failed to load chart data');
    expect(view.loading).toBe(false);
  });
});
