import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { ChartBuilderComponent } from './chart-builder.component';
import { WidgetViewComponent } from '../widget-view/widget-view.component';
import { ChartsTilesModule } from '../charts-tiles.module';

const keys = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
const clearedHierarchy = Object.fromEntries(keys.map(key => [key, 'All']));
const plant = {
  country: 'Oman', sector: 'Energy', businessUnit: 'Services',
  division: 'Wells', cluster: 'North', plantDescription: 'Plant A',
};

function filterState(singleOption = false) {
  return {
    filterValues: Object.fromEntries(keys.map(key => [key, 'Selected'])),
    filterFields: keys.map(key => ({ key, label: key, options: singleOption && key === 'country' ? ['Oman'] : [] })),
    allPlants: singleOption ? [plant] : [],
    quickRange: 'After', fromDate: '2025-04-01', toDate: '',
    showDateRangePopup: true,
  };
}

describe('Chart Clear Filter action', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 10, 12));
  });
  afterEach(() => vi.useRealTimers());

  it('uses the chart module for template dependencies', () => {
    expect(ChartsTilesModule).toBeDefined();
  });

  it.each([false, true])('resets Chart Edit globals and retains setup (single option: %s)', single => {
    const reload = vi.fn();
    const persist = vi.fn();
    const localFilters = [{ id: 1, locked: true, value: 'Saved' }];
    const component: ChartBuilderComponent = Object.assign(Object.create(ChartBuilderComponent.prototype), {
      ...filterState(single), openGlobalFilterName: 'quickRange',
      interactiveFilters: localFilters, previewFilterValues: { 1: 'Saved' },
      chartTitle: 'My chart', xAxis: 'Well', yAxis: 'Value',
      reloadGlobalViewPreview: reload, persistEditorDraft: persist,
    });

    component.clearAllFilters();

    expect(component.filterValues).toEqual(single
      ? { country: 'Oman', sector: 'Energy', businessUnit: 'Services', division: 'Wells', cluster: 'North', plant: 'Plant A' }
      : clearedHierarchy);
    expect(component.quickRange).toBe('');
    expect(component.fromDate).toBe('2026-01-01');
    expect(component.toDate).toBe('2026-10-06');
    expect(component.openGlobalFilterName).toBeNull();
    expect(component.showDateRangePopup).toBe(false);
    expect(component.interactiveFilters).toBe(localFilters);
    expect(component.previewFilterValues).toEqual({ 1: 'Saved' });
    expect(component.chartTitle).toBe('My chart');
    expect(component.xAxis).toBe('Well');
    expect(reload).toHaveBeenCalledExactlyOnceWith();
    expect(persist).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([false, true])('resets Chart Details globals without changing local filters (single option: %s)', single => {
    const refresh = vi.fn();
    const localFilters = [{ id: 1, locked: true, value: 'Saved' }];
    const component: WidgetViewComponent = Object.assign(Object.create(WidgetViewComponent.prototype), {
      ...filterState(single), openFilterName: 'plant', filters: localFilters,
      applyGlobalFilter: refresh,
    });

    component.clearAllFilters();

    expect(component.filterValues).toEqual(single
      ? { country: 'Oman', sector: 'Energy', businessUnit: 'Services', division: 'Wells', cluster: 'North', plant: 'Plant A' }
      : clearedHierarchy);
    expect(component.quickRange).toBe('');
    expect(component.fromDate).toBe('2026-01-01');
    expect(component.toDate).toBe('2026-10-06');
    expect(component.openFilterName).toBeNull();
    expect(component.showDateRangePopup).toBe(false);
    expect(component.filters).toBe(localFilters);
    expect(refresh).toHaveBeenCalledExactlyOnceWith();
  });

  it('refreshes Chart Edit import previews through the existing reload path', () => {
    const refresh = vi.fn();
    const component: ChartBuilderComponent = Object.assign(Object.create(ChartBuilderComponent.prototype), {
      ...filterState(), dataSourceMode: 'import',
      refreshPreview: refresh, persistEditorDraft: vi.fn(),
    });
    component.clearAllFilters();
    expect(refresh).toHaveBeenCalledExactlyOnceWith();
    expect(component.chartRenderVisible).toBe(true);
  });

  it('rebuilds Chart Details table data after removing the global selection', () => {
    const rebuild = vi.fn();
    const rows = [{ Cluster: 'North', Plant: 'Plant A', Value: 12 }, { Cluster: 'South', Plant: 'Plant B', Value: 34 }];
    const component: WidgetViewComponent = Object.assign(Object.create(WidgetViewComponent.prototype), {
      ...filterState(), design: {}, viewSql: '', viewConnectionId: 0,
      cancelGlobalFilter$: new Subject<void>(), allRows: rows, filters: [],
      rebuildChart: rebuild, cdr: { markForCheck: vi.fn() },
    });
    component.clearAllFilters();
    expect(component.filteredRows).toEqual(rows);
    expect(rebuild).toHaveBeenCalledExactlyOnceWith();
  });

  it('reloads Chart Details trend data once using the reset filters', () => {
    const reloadTrend = vi.fn();
    const component: WidgetViewComponent = Object.assign(Object.create(WidgetViewComponent.prototype), {
      ...filterState(), design: { chartType: 'line' },
      cancelGlobalFilter$: new Subject<void>(), loadTrendData: reloadTrend,
    });
    vi.spyOn(component, 'isTrendChart', 'get').mockReturnValue(true);
    component.clearAllFilters();
    expect(component.filterValues).toEqual(clearedHierarchy);
    expect(reloadTrend).toHaveBeenCalledExactlyOnceWith();
  });

  it('reloads Chart Details view SQL once with the reset date range', () => {
    const previewView = vi.fn(() => new Subject());
    const component: WidgetViewComponent = Object.assign(Object.create(WidgetViewComponent.prototype), {
      ...filterState(), design: {}, viewConnectionId: 7, viewIdForPreview: 12,
      viewSql: "DECLARE @start_date DATE = '2025-04-01'; DECLARE @end_date DATE = '2025-04-30'; SELECT 1;",
      safeValuePattern: /^[A-Za-z0-9\s\-_.,()]+$/,
      cancelGlobalFilter$: new Subject<void>(), destroy$: new Subject<void>(),
      commonApi: { previewView }, cdr: { markForCheck: vi.fn() },
    });
    component.clearAllFilters();
    expect(previewView).toHaveBeenCalledTimes(1);
    expect(previewView).toHaveBeenCalledWith({
      connectionId: 7, viewId: 12, maxRows: 1000,
      sql: "DECLARE @start_date DATE = '2026-01-01'; DECLARE @end_date DATE = '2026-10-06'; SELECT 1;",
    });
  });
});
