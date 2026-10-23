import { describe, expect, it, vi } from 'vitest';
import { WidgetViewComponent, type ScenarioBuilderPreview } from './widget-view.component';
import { ChartsTilesModule } from '../charts-tiles.module';
import { of, Subject, throwError } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { WidgetService } from '../../../core/services/widget.service';
import { AuthService } from '../../../core/services/auth.service';
import { CommonApiService } from '../../../core/services/common-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { ListRouteReuseStrategy } from '../../../core/services/list-route-reuse.strategy';

function viewer(chartType = 'multiline', xAxis = 'Period', multi = true): WidgetViewComponent {
  return Object.assign(Object.create(WidgetViewComponent.prototype), {
    design: {
      chartType, xAxis, yAxis: 'Sum (F)', yAggColumn: 'Plan',
      multiYColumns: multi ? ['Plan', 'Actual'] : [],
    },
    chart: { title: 'Well progress' },
    filteredRows: [
      { [xAxis]: 'Jan-26', Plan: 100, Actual: 50 },
      { [xAxis]: 'Feb-26', Plan: 200, Actual: 80 },
    ],
    categories: [], baseCategories: [], multiSeriesData: [], tableColumns: [], toDate: '2026-12-31',
    scenarioCategoryTarget: '', scenarioPlanAdjustments: 0,
    scenarioScheduleSlippage: 0, scenarioItems: [],
    cancelScenarioMonthly$: new Subject<void>(), cancelGlobalFilter$: new Subject<void>(), destroy$: new Subject<void>(),
    scenarioMonthlyRows: null, scenarioMonthlyRequested: false, scenarioMonthlyLoading: false, scenarioMonthlyError: '',
    cdr: { markForCheck: vi.fn() },
    rebuildChartOptions: vi.fn(), rebuildChartOptions2: vi.fn(),
  });
}

function rebuild(component: WidgetViewComponent): void {
  component['rebuildChart']();
}

describe('table widget global filtering', () => {
  it.each(['count', 'total', 'average'])('aggregates standalone %s tiles on the server, not the capped preview', aggregation => {
    const component = viewer();
    const getFilteredChartData = vi.fn(() => of({ columns: ['Value'], rows: [{ Value: 25000 }] }));
    Object.assign(component, {
      design: { aggregation, valueField: 'Amount' }, savedWidget: { source: 'crew_employee', sourceType: 'Table' },
      filterValues: { country: 'Oman' }, filters: [], tileValueLoad: 0,
      widgetService: { getFilteredChartData },
    });

    component['refreshTileValue']([{ EmployeeId: 1 }]);

    expect(getFilteredChartData).toHaveBeenCalledWith(expect.objectContaining({
      chartSource: 'crew_employee', aggregation, valueField: 'Amount',
      filters: [expect.objectContaining({ sourceColumn: 'country', globalHierarchy: true })],
    }));
    expect(component.tileValue).toBe(25000);
  });

  it('uses a server aggregate for attached table tiles with global filters', () => {
    const component = viewer();
    const getFilteredChartData = vi.fn(() => of({ columns: ['Value'], rows: [{ Value: 25000 }] }));
    const done = vi.fn();
    Object.assign(component, {
      savedWidget: { attachedTiles: [{
        id: 12, name: 'Employees', source: 'crew_employee', sourceType: 'Table',
        designJson: JSON.stringify({ aggregation: 'total', valueField: 'Amount' }),
      }] },
      filterValues: { country: 'Oman' }, filters: [], inlineTiles: [], inlineTilesLoad: 0,
      widgetService: { getFilteredChartData },
    });

    component['loadInlineTiles']([12], done);

    expect(getFilteredChartData).toHaveBeenCalledWith(expect.objectContaining({
      chartSource: 'crew_employee', aggregation: 'total', valueField: 'Amount',
      filters: [expect.objectContaining({ sourceColumn: 'country', globalHierarchy: true })],
    }));
    expect(component.inlineTiles[0].value).toBe('25000');
    expect(done).toHaveBeenCalledOnce();
  });

  it('does not replace aggregate failures with a preview-derived total', () => {
    const component = viewer();
    Object.assign(component, {
      design: { aggregation: 'count' }, savedWidget: { source: 'crew_employee', sourceType: 'Table' },
      filterValues: { country: 'Oman' }, filters: [], tileValueLoad: 0,
      widgetService: { getFilteredChartData: () => throwError(() => new Error('Failed')) },
    });

    component['refreshTileValue']([{ EmployeeId: 1 }]);

    expect(component.tileValue).toBeNull();
    expect(component.error).toBe('Failed to calculate tile value.');
  });
});

describe('Chart Details scenario categories', () => {
  it('renders the existing scenario controls inside the builder without detail-page headers or charts', async () => {
    await TestBed.configureTestingModule({
      imports: [ChartsTilesModule],
      providers: [
        { provide: ActivatedRoute, useValue: {} },
        { provide: Router, useValue: {} },
        { provide: Location, useValue: {} },
        { provide: WidgetService, useValue: {} },
        { provide: AuthService, useValue: { isAdmin: () => false } },
        { provide: CommonApiService, useValue: {} },
        { provide: ToastService, useValue: {} },
        { provide: LayoutStateService, useValue: {} },
        { provide: ListRouteReuseStrategy, useValue: {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(WidgetViewComponent);
    const reference = viewer();
    fixture.componentRef.setInput('scenarioBuilderPreview', {
      key: 'chart-1', design: { ...reference.design, scenarioParametersEnabled: true },
      rows: reference.filteredRows, columns: ['Period', 'Plan', 'Actual'],
      fromDate: '2026-01-01', toDate: '2026-12-31',
      hierarchyFilters: [], filters: [], reportFilters: [],
    } satisfies ScenarioBuilderPreview);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('app-page-header')).toBeNull();
    expect(element.querySelector('highcharts-chart')).toBeNull();
    expect(element.querySelector('app-advanced-filter')).toBeNull();
    expect(element.querySelector('[aria-label="Close scenario parameters"]')).toBeNull();
    expect(element.querySelector('[aria-label="Plan adjustment in percent"]')).not.toBeNull();
    expect(element.querySelector('[aria-label="Schedule Slippage forecast extension in days"]')).not.toBeNull();
    const add = element.querySelector<HTMLButtonElement>('[aria-label="Add scenario"]')!;
    add.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.scenarioItems).toHaveLength(1);
    expect(element.querySelector('[aria-label="Scenario item 1 name"]')).not.toBeNull();
    fixture.destroy();
    TestBed.resetTestingModule();
  });

  it.each([undefined, false, true])('only exposes the scenario control for an explicitly enabled chart (%s)', enabled => {
    const component = viewer();
    component.design['scenarioParametersEnabled'] = enabled;
    component.showScenarioPanel = false;
    expect(component.scenarioEnabled).toBe(enabled === true);
    component.toggleScenarioPanel();
    expect(component.showScenarioPanel).toBe(enabled === true);
    component.widgetType = 'tile';
    expect(component.scenarioEnabled).toBe(false);
  });

  it('uses the existing simulation engine in builder mode without altering source rows', () => {
    const component = viewer();
    const emit = vi.fn();
    const rows = structuredClone(component.filteredRows);
    const preview: ScenarioBuilderPreview = {
      key: 'chart-1:view:3',
      design: { ...component.design, scenarioParametersEnabled: true, chartTitle: 'Builder preview' },
      rows, columns: ['Period', 'Plan', 'Actual'], fromDate: '2026-01-01', toDate: '2026-12-31',
      hierarchyFilters: [], filters: [], reportFilters: [],
    };
    Object.assign(component, {
      scenarioBuilderPreview: preview, scenarioPreviewChange: { emit },
      chartOptions: { title: { text: 'Scenario' } }, scenarioBuilderKey: '',
    });
    component.ngOnChanges();
    expect(emit).toHaveBeenLastCalledWith(null);
    component.selectScenarioPlanTarget('Plan');
    component.scenarioPlanAdjustments = 10;
    component.onScenarioChange();
    expect(component.multiSeriesData[0].data).toEqual([110, 220]);
    expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({
      categories: ['Jan-26', 'Feb-26'],
      series: expect.arrayContaining([expect.objectContaining({ name: 'Plan', data: [110, 220] })]),
    }));
    expect(rows).toEqual([
      { Period: 'Jan-26', Plan: 100, Actual: 50 },
      { Period: 'Feb-26', Plan: 200, Actual: 80 },
    ]);
    component.ngOnChanges();
    expect(component.scenarioPlanAdjustments).toBe(10);
    component.scenarioBuilderPreview = { ...preview, key: 'chart-2:view:3' };
    component.ngOnChanges();
    expect(component.scenarioPlanAdjustments).toBe(0);
    expect(component.scenarioItems).toEqual([]);
    expect(emit).toHaveBeenLastCalledWith(null);
  });

  it('does not load detail-page data or change navigation layout in builder mode', () => {
    const component = viewer();
    const collapse = vi.fn();
    const expand = vi.fn();
    const getWidgetById = vi.fn();
    Object.assign(component, {
      scenarioBuilderPreview: { key: 'builder' },
      layoutState: { collapse, expand, setActiveNavOverride: vi.fn() },
      widgetService: { getWidgetById },
    });
    component.ngOnInit();
    component.ngOnDestroy();
    expect(getWidgetById).not.toHaveBeenCalled();
    expect(collapse).not.toHaveBeenCalled();
    expect(expand).not.toHaveBeenCalled();
  });

  it('restores the default plan adjustment and clears its direct and predicted effects', () => {
    const component = relatedCategoryViewer();
    component.showScenarioPanel = true;
    rebuild(component);
    expect(component.canRemoveScenarioParameter).toBe(true);
    component.removeScenarioParameter('plan');
    expect(component.scenarioPlanAdjustments).toBe(0);
    expect(component.scenarioPlanAdjustmentMode).toBe('percentage');
    expect(component.scenarioCategoryTarget).toBe('');
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[100, 200, 300], [50, 80, 110]]);
    expect(component.canRemoveScenarioParameter).toBe(true);
  });

  it('restores slippage to zero and removes its forecasts without hiding the control', () => {
    const component = viewer();
    component.showScenarioPanel = true;
    component.scenarioScheduleSlippage = 30;
    rebuild(component);
    expect(component.scenarioForecastLabels.length).toBeGreaterThan(0);
    component.removeScenarioParameter('slippage');
    expect(component.scenarioScheduleSlippage).toBe(0);
    expect(component.scenarioForecastLabels).toEqual([]);
    expect(component.showScenarioScheduleSlippage).toBe(true);
    expect(component.canRemoveScenarioParameter).toBe(true);
  });

  it('removes custom items and never removes the last visible parameter on non-date charts', () => {
    const component = viewer('line', 'Category', false);
    component.filteredRows = [{ Category: 'North', Plan: 100 }];
    component.showScenarioPanel = true;
    component.scenarioItems = [{ id: 1, name: 'Extra', value: 20, target: '' }];
    rebuild(component);
    expect(component.categories[0].value).toBe(120);
    component.removeScenarioParameter(1);
    expect(component.scenarioItems).toEqual([]);
    expect(component.categories[0].value).toBe(100);
    expect(component.canRemoveScenarioParameter).toBe(false);
    component.scenarioPlanAdjustments = 10;
    component.removeScenarioParameter('plan');
    expect(component.scenarioPlanAdjustments).toBe(10);
  });

  it('restores both defaults without removing custom items and reset clears all adjustments', () => {
    const component = viewer();
    component.showScenarioPanel = true;
    component.scenarioItems = [{ id: 1, name: 'Extra', value: 20, target: '' }];
    component.scenarioPlanAdjustments = 15;
    component.scenarioPlanAdjustmentMode = 'absolute';
    component.scenarioScheduleSlippage = 30;
    component.removeScenarioParameter('plan');
    component.removeScenarioParameter('slippage');
    expect(component.scenarioPlanAdjustments).toBe(0);
    expect(component.scenarioPlanAdjustmentMode).toBe('percentage');
    expect(component.scenarioScheduleSlippage).toBe(0);
    expect(component.canRemoveScenarioParameter).toBe(true);
    expect(component.scenarioItems).toHaveLength(1);
    expect(component.multiSeriesData[0].data).toEqual([120, 240]);
    component.resetScenarioParameters();
    expect(component.scenarioItems).toEqual([]);
    expect(component.canRemoveScenarioParameter).toBe(true);
  });

  it('retains the default plan parameter when filters make slippage unsupported', () => {
    const component = viewer();
    component.showScenarioPanel = true;
    component.removeScenarioParameter('plan');
    component.filteredRows = [{ Period: 'North', Plan: 100, Actual: 50 }];
    rebuild(component);
    expect(component.scenarioPlanAdjustments).toBe(0);
    expect(component.canRemoveScenarioParameter).toBe(false);
  });

  function relatedCategoryViewer(chartType = 'multiline'): WidgetViewComponent {
    const component = viewer(chartType);
    component.filteredRows = [
      { Period: 'Jan-26', Plan: 100, Actual: 50 },
      { Period: 'Feb-26', Plan: 200, Actual: 80 },
      { Period: 'Mar-26', Plan: 300, Actual: 110 },
    ];
    component.scenarioCategoryTarget = 'Plan';
    component.scenarioPlanAdjustments = 10;
    return component;
  }

  it.each(['multiline', 'area', 'stacked', 'grouped', 'combo'])(
    'predicts related %s categories and keeps totals and exports consistent', type => {
      const component = relatedCategoryViewer(type);
      const source = structuredClone(component.filteredRows);
      rebuild(component);
      expect(component.multiSeriesData[0].data).toEqual([110, 220, 330]);
      expect(component.multiSeriesData[1].data).toEqual([53, 86, 119]);
      expect(component.categories.map(category => category.value)).toEqual([163, 306, 449]);
      if (type === 'stacked') expect(component.multiSeriesData[2].data).toEqual([163, 306, 449]);
      expect(component.savedTableRows[0].slice(0, 3)).toEqual(['Jan-26', 110, 53]);
      expect(component.scenarioPredictionMessages).toEqual(['Actual: estimated from Plan (r=1.00, 3 periods).']);
      rebuild(component);
      expect(component.multiSeriesData[1].data).toEqual([53, 86, 119]);
      expect(component.filteredRows).toEqual(source);
    },
  );

  it('predicts inverse relationships for absolute adjustments, including a zero driver', () => {
    const component = relatedCategoryViewer();
    component.filteredRows = [
      { Period: 'Jan-26', Plan: 0, Actual: 100 },
      { Period: 'Feb-26', Plan: 100, Actual: 50 },
      { Period: 'Mar-26', Plan: 200, Actual: 0 },
    ];
    component.scenarioPlanAdjustmentMode = 'absolute';
    component.scenarioPlanAdjustments = 20;
    rebuild(component);
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[20, 120, 220], [90, 40, -10]]);
    expect(component.scenarioPredictionMessages[0]).toContain('r=-1.00');
  });

  it('does not learn a relationship from appended schedule forecasts', () => {
    const component = viewer();
    component.scenarioCategoryTarget = 'Plan';
    component.scenarioPlanAdjustments = 10;
    component.scenarioScheduleSlippage = 30;
    rebuild(component);
    expect(component.multiSeriesData[1].data).toEqual([50, 80, 110]);
    expect(component.scenarioPredictionMessages[0]).toContain('at least 3 paired historical periods');
  });

  it('applies learned relationships to forecast deltas without fitting forecast points', () => {
    const component = relatedCategoryViewer();
    component.scenarioScheduleSlippage = 30;
    rebuild(component);
    expect(component.multiSeriesData[0].data).toEqual([110, 220, 330, 440]);
    expect(component.multiSeriesData[1].data).toEqual([53, 86, 119, 152]);
    expect(component.scenarioPredictionMessages[0]).toContain('3 periods');
  });

  it('does not use missing numeric source values as evidence of a relationship', () => {
    const component = relatedCategoryViewer();
    component.filteredRows[0]['Actual'] = null;
    rebuild(component);
    expect(component.multiSeriesData[1].data).toEqual([0, 80, 110]);
    expect(component.scenarioPredictionMessages[0]).toContain('unchanged');
  });

  it('honors explicit custom targets instead of overwriting them with predictions', () => {
    const component = relatedCategoryViewer();
    component.scenarioItems = [{ id: 1, name: 'Actual change', value: 20, target: 'Actual' }];
    rebuild(component);
    expect(component.multiSeriesData[1].data).toEqual([60, 96, 132]);
    expect(component.scenarioPredictionMessages).toEqual([]);
  });

  it('uses targeted custom items as prediction drivers', () => {
    const component = relatedCategoryViewer();
    component.scenarioCategoryTarget = '';
    component.scenarioPlanAdjustments = 0;
    component.scenarioItems = [{ id: 1, name: 'Plan change', value: 10, target: 'Plan' }];
    rebuild(component);
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[110, 220, 330], [53, 86, 119]]);
  });

  it('keeps period targeting independent and explains charts without paired category history', () => {
    const component = relatedCategoryViewer();
    component.scenarioTargetMode = 'period';
    component.scenarioCategoryTarget = 'Jan-26';
    rebuild(component);
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[110, 200, 300], [55, 80, 110]]);
    expect(component.scenarioPredictionMessages).toEqual([]);
    const single = viewer('line', 'Month', false);
    single.scenarioCategoryTarget = 'Jan-26';
    single.scenarioPlanAdjustments = 10;
    rebuild(single);
    expect(single.categories.map(category => category.value)).toEqual([110, 200]);
    expect(single.scenarioPredictionMessages[0]).toContain('unavailable');
  });

  it('clears predicted changes and messages when reset or filters remove history', () => {
    const component = relatedCategoryViewer();
    component.showScenarioPanel = true;
    rebuild(component);
    component.filteredRows = component.filteredRows.slice(0, 2);
    rebuild(component);
    expect(component.multiSeriesData[1].data).toEqual([50, 80]);
    expect(component.scenarioPredictionMessages[0]).toContain('unchanged');
    component.resetScenarioParameters();
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[100, 200], [50, 80]]);
    expect(component.scenarioPredictionMessages).toEqual([]);
  });

  function singleYearViewer(chartType = 'multiline'): WidgetViewComponent {
    const component = viewer(chartType);
    Object.assign(component, {
      trendMode: 'yearly', toDate: '2026-10-06', fromDate: '2026-01-01', scenarioScheduleSlippage: 120,
      savedWidget: { source: 'Progress', sourceType: 'View', sourceId: 1 },
      filters: [], globalHierarchyFilterPayload: () => [{ sourceTable: 'country', sourceColumn: 'country', controlType: 'Dropdown', value: 'Oman' }],
    });
    component.filteredRows = [{ Period: '2026', Plan: 61, Actual: 59 }];
    return component;
  }

  const monthlyRows = [
    { Period: 'Aug-26', Plan: 10, Actual: 30 },
    { Period: 'Sep-26', Plan: 20, Actual: 20 },
    { Period: 'Oct-26', Plan: 30, Actual: 10 },
  ];

  it.each(['multiline', 'stacked'])('uses filtered monthly history to forecast a single-year %s chart', type => {
    const component = singleYearViewer(type);
    const getFilteredChartData = vi.fn(() => of({ columns: ['Period', 'Plan', 'Actual'], rows: monthlyRows }));
    Object.assign(component, { widgetService: { getFilteredChartData } });
    rebuild(component);
    expect(getFilteredChartData).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'monthly', fromDate: '2026-01-01', toDate: '2026-10-06',
      filters: [expect.objectContaining({ value: 'Oman' })],
    }));
    expect(component.scenarioForecastError).toBe('');
    expect(component.scenarioForecastLabels).toEqual(['2027']);
    // Jan + Feb forecasts: 60 + 70 for Plan, -20 + -30 for Actual.
    expect(component.multiSeriesData[0].data).toEqual([61, 130]);
    expect(component.multiSeriesData[1].data).toEqual([59, -50]);
    if (type === 'stacked') expect(component.multiSeriesData[2].data).toEqual([120, 80]);
    rebuild(component);
    expect(getFilteredChartData).toHaveBeenCalledTimes(1);
    expect(component.filteredRows).toEqual([{ Period: '2026', Plan: 61, Actual: 59 }]);
    component.scenarioScheduleSlippage = 0;
    rebuild(component);
    expect(component.multiSeriesData[0].data).toEqual([61]);
  });

  it('shows monthly history failures instead of fabricating a yearly value', () => {
    const component = singleYearViewer();
    Object.assign(component, { widgetService: { getFilteredChartData: vi.fn(() => throwError(() => new Error('Failed'))) } });
    rebuild(component);
    expect(component.scenarioForecastError).toContain('Failed to load monthly history');
    expect(component.scenarioForecastLabels).toEqual([]);
    expect(component.multiSeriesData[0].data).toEqual([61]);
  });

  it('rejects monthly results that lack a plotted series', () => {
    const component = singleYearViewer();
    Object.assign(component, { widgetService: { getFilteredChartData: vi.fn(() => of({
      columns: ['Period', 'Plan'], rows: monthlyRows.map(({ Period, Plan }) => ({ Period, Plan })),
    })) } });
    rebuild(component);
    expect(component.scenarioForecastError).toContain('every plotted series');
    expect(component.scenarioForecastLabels).toEqual([]);
  });

  it('cancels monthly fallback when another trend mode is selected', () => {
    const component = singleYearViewer();
    const pending = new Subject<{ columns: string[]; rows: Record<string, unknown>[] }>();
    const getFilteredChartData = vi.fn()
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(of({ columns: ['Period', 'Plan', 'Actual'], rows: monthlyRows }));
    Object.assign(component, { widgetService: { getFilteredChartData }, applyLoadedData: vi.fn() });
    rebuild(component);
    expect(component.scenarioForecastError).toContain('Loading monthly history');
    component.selectTrendMode('monthly');
    pending.next({ columns: ['Period', 'Plan', 'Actual'], rows: monthlyRows });
    expect(component['scenarioMonthlyRows']).toBeNull();
    expect(getFilteredChartData).toHaveBeenCalledTimes(2);
  });

  it('anchors yearly slippage to the global To date and rebuilds when it changes', () => {
    const component = viewer();
    component.trendMode = 'yearly';
    component.filteredRows = [{ Period: '2025', Plan: 10, Actual: 30 }, { Period: '2026', Plan: 20, Actual: 20 }];
    component.toDate = '2026-10-06';
    component.scenarioScheduleSlippage = 86;
    rebuild(component);
    expect(component.scenarioForecastError).toBe('');
    expect(component.scenarioForecastLabels).toEqual([]);
    expect(component.multiSeriesData[0].data).toEqual([10, 20]);
    component.scenarioScheduleSlippage = 87;
    rebuild(component);
    expect(component.scenarioForecastLabels).toEqual(['2027']);
    expect(component.multiSeriesData[0].data).toEqual([10, 20, 30]);
    component.toDate = '2026-06-10';
    component.scenarioScheduleSlippage = 120;
    rebuild(component);
    expect(component.scenarioForecastLabels).toEqual([]);
    expect(component.multiSeriesData[0].data).toEqual([10, 20]);
    component.toDate = '';
    rebuild(component);
    expect(component.scenarioForecastError).toContain('global To date');
  });

  it('loads weekly data from the dropdown and appends numbered forecast weeks', () => {
    const component = viewer();
    const rows = [
      { Period: 'week51', Plan: 10, Actual: 30 },
      { Period: 'week52', Plan: 20, Actual: 20 },
    ];
    const getFilteredChartData = vi.fn(() => of({ columns: ['Period', 'Plan', 'Actual'], rows }));
    Object.assign(component, {
      trendMode: 'monthly', trendMenuOpen: true, scenarioScheduleSlippage: 8,
      savedWidget: { source: 'Progress', sourceType: 'View', sourceId: 1 },
      filters: [], widgetService: { getFilteredChartData },
      cancelGlobalFilter$: new Subject<void>(), destroy$: new Subject<void>(),
      globalHierarchyFilterPayload: () => [],
      applyLoadedData: (_columns: string[], loadedRows: Record<string, unknown>[]) => {
        component.filteredRows = loadedRows;
        rebuild(component);
      },
    });
    component.selectTrendMode('weekly');
    expect(component.trendMenuOpen).toBe(false);
    expect(getFilteredChartData).toHaveBeenCalledWith(expect.objectContaining({ mode: 'weekly' }));
    expect(component.showScenarioScheduleSlippage).toBe(true);
    expect(component.scenarioForecastLabels).toEqual(['week53', 'week54']);
    expect(component.categories.map(category => category.label)).toEqual(['week51', 'week52', 'week53', 'week54']);
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[10, 20, 30, 40], [30, 20, 10, 0]]);
    component.scenarioScheduleSlippage = 0;
    rebuild(component);
    expect(component.categories.map(category => category.label)).toEqual(['week51', 'week52']);
    expect(rows).toHaveLength(2);
  });

  it('keeps slippage enabled and rebuilds forecasts when switching all four trend modes', () => {
    const component = viewer();
    component.scenarioScheduleSlippage = 60;
    const cases = [
      { mode: 'weekly' as const, labels: ['2026-W41', '2026-W42'], first: 'week43', count: 9 },
      { mode: 'monthly' as const, labels: ['Sep-26', 'Oct-26'], first: 'Nov-26', count: 2 },
      { mode: 'quarterly' as const, labels: ['Q3-2026', 'Q4-2026'], first: 'Q1-2027', count: 1 },
      { mode: 'yearly' as const, labels: ['2025', '2026'], first: '2027', count: 1 },
    ];
    for (const { mode, labels, first, count } of cases) {
      component.trendMode = mode;
      component.filteredRows = labels.map((Period, index) => ({ Period, Plan: 10 + index * 10, Actual: 30 - index * 10 }));
      expect(component.showScenarioScheduleSlippage).toBe(true);
      rebuild(component);
      expect(component.scenarioForecastError).toBe('');
      expect(component.scenarioForecastLabels[0]).toBe(first);
      expect(component.scenarioForecastLabels).toHaveLength(count);
      expect(component.multiSeriesData[0].data).toEqual([10, 20, ...Array.from({ length: count }, (_, i) => 30 + i * 10)]);
      expect(component.multiSeriesData[1].data).toEqual([30, 20, ...Array.from({ length: count }, (_, i) => 10 - i * 10)]);
      expect(component.categories).toHaveLength(2 + count);
    }
    component.showScenarioPanel = true;
    component.resetScenarioParameters();
    expect(component.scenarioForecastLabels).toEqual([]);
    expect(component.categories).toHaveLength(2);
  });

  it.each(['multiline', 'stacked', 'combo'])('extends %s with forecasts without changing history or compounding', type => {
    const component = viewer(type);
    component.filteredRows = [
      { Period: 'Aug-26', Plan: 10, Actual: 30 },
      { Period: 'Sep-26', Plan: 20, Actual: 20 },
      { Period: 'Oct-26', Plan: 30, Actual: 10 },
    ];
    component.scenarioScheduleSlippage = 30;
    component.scenarioCategoryTarget = 'Actual';
    rebuild(component);
    expect(component.scenarioForecastError).toBe('');
    expect(component.scenarioForecastLabels).toEqual(['Nov-26']);
    expect(component.categories.map(category => category.label)).toEqual(['Aug-26', 'Sep-26', 'Oct-26', 'Nov-26']);
    expect(component.multiSeriesData[0].data).toEqual([10, 20, 30, 40]);
    expect(component.multiSeriesData[1].data).toEqual([30, 20, 10, 0]);
    if (type === 'stacked') expect(component.multiSeriesData[2].data).toEqual([40, 40, 40, 40]);
    rebuild(component);
    expect(component.multiSeriesData[0].data).toEqual([10, 20, 30, 40]);
    expect(component.filteredRows).toHaveLength(3);
    component.showScenarioPanel = true;
    component.resetScenarioParameters();
    expect(component.categories).toHaveLength(3);
    expect(component.scenarioForecastLabels).toEqual([]);
  });

  it('forecasts a single series and removes future periods when slippage returns to zero', () => {
    const component = viewer('line', 'Period', false);
    component.scenarioScheduleSlippage = 30;
    rebuild(component);
    expect(component.categories.map(category => category.value)).toEqual([100, 200, 300]);
    component.scenarioScheduleSlippage = 0;
    rebuild(component);
    expect(component.categories.map(category => category.value)).toEqual([100, 200]);
  });

  it('hides and skips slippage for a non-date axis without changing values', () => {
    const component = viewer();
    component.filteredRows = [{ Period: 'North', Plan: 10, Actual: 20 }, { Period: 'South', Plan: 20, Actual: 30 }];
    component.scenarioScheduleSlippage = 30;
    rebuild(component);
    expect(component.showScenarioScheduleSlippage).toBe(false);
    expect(component.scenarioForecastError).toBe('');
    expect(component.scenarioForecastLabels).toEqual([]);
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[10, 20], [20, 30]]);
  });

  it('shows slippage for date values even when the axis is not named Period', () => {
    const component = viewer('line', 'Month', false);
    expect(component.showScenarioScheduleSlippage).toBe(true);
    component.filteredRows = [];
    expect(component.showScenarioScheduleSlippage).toBe(false);
  });

  it('hides slippage when any axis value is not a date', () => {
    const component = viewer();
    component.filteredRows[1]['Period'] = 'Other';
    expect(component.showScenarioScheduleSlippage).toBe(false);
  });

  it('hides slippage for tables even with date columns', () => {
    expect(viewer('table').showScenarioScheduleSlippage).toBe(false);
  });

  it('keeps zero unchanged in percentage mode', () => {
    const component = viewer();
    component.filteredRows[0]['Plan'] = 0;
    component.scenarioTargetMode = 'period';
    component.scenarioCategoryTarget = 'Jan-26';
    component.scenarioPlanAdjustmentMode = 'percentage';
    component.scenarioPlanAdjustments = 33;
    rebuild(component);
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[0, 200], [66.5, 80]]);
  });

  it('adds absolute units to zero and non-zero values in the selected period', () => {
    const component = viewer();
    component.filteredRows[0]['Plan'] = 0;
    component.scenarioTargetMode = 'period';
    component.scenarioCategoryTarget = 'Jan-26';
    component.scenarioPlanAdjustmentMode = 'absolute';
    component.scenarioPlanAdjustments = 33;
    rebuild(component);
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[33, 200], [83, 80]]);
    expect(component.categories.map(category => category.value)).toEqual([116, 280]);
    rebuild(component);
    expect(component.multiSeriesData[0].data).toEqual([33, 200]);
  });

  it('supports absolute subtraction for a category and recomputes stacked totals', () => {
    const component = viewer('stacked');
    component.scenarioCategoryTarget = 'Plan';
    component.scenarioPlanAdjustmentMode = 'absolute';
    component.scenarioPlanAdjustments = -20;
    rebuild(component);
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[80, 180], [50, 80], [130, 260]]);
  });

  it('applies absolute adjustments to single-series zero values and resets the mode', () => {
    const component = viewer('line', 'Period', false);
    component.filteredRows[0]['Plan'] = 0;
    component.showScenarioPanel = true;
    component.scenarioCategoryTarget = 'Plan';
    component.scenarioPlanAdjustmentMode = 'absolute';
    component.scenarioPlanAdjustments = 12;
    rebuild(component);
    expect(component.categories.map(category => category.value)).toEqual([12, 212]);
    component.resetScenarioParameters();
    expect(component.scenarioPlanAdjustmentMode).toBe('percentage');
    expect(component.categories.map(category => category.value)).toEqual([0, 200]);
  });

  it('lets Period-axis scenarios target a period across every series', () => {
    const component = viewer();
    component.scenarioTargetMode = 'period';
    component.scenarioCategoryTarget = 'Jan-26';
    component.scenarioPlanAdjustments = 10;
    rebuild(component);
    expect(component.scenarioHasPeriodAxis).toBe(true);
    expect(component.scenarioAllTargetsLabel).toBe('All periods');
    expect(component.scenarioCategoryOptions).toEqual(['Jan-26', 'Feb-26']);
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[110, 200], [55, 80]]);
  });

  it('clears old targets when switching between Category and Period', () => {
    const component = viewer();
    component.scenarioCategoryTarget = 'Actual';
    component.scenarioItems = [{ id: 1, name: 'Extra', value: 20, target: 'Plan' }];
    component.scenarioTargetMode = 'period';
    component.onScenarioTargetModeChange();
    expect(component.scenarioCategoryTarget).toBe('');
    expect(component.scenarioItems[0].target).toBe('');
    component.scenarioTargetMode = 'category';
    rebuild(component);
    expect(component.scenarioCategoryOptions).toEqual(['Plan', 'Actual']);
    expect(component.scenarioAllTargetsLabel).toBe('All categories');
  });

  it('uses existing chart module dependencies', () => {
    expect(ChartsTilesModule).toBeDefined();
  });

  it.each(['multiline', 'area'])('lists series rather than periods for %s Period charts', type => {
    const component = viewer(type, ' Period ');
    rebuild(component);
    expect(component.scenarioCategoryOptions).toEqual(['Plan', 'Actual']);
  });

  it('changes the selected series across periods and does not compound on rebuild', () => {
    const component = viewer();
    component.scenarioCategoryTarget = 'Actual';
    component.scenarioPlanAdjustments = -10;
    rebuild(component);
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[100, 200], [45, 72]]);
    expect(component.categories.map(category => category.value)).toEqual([145, 272]);
    rebuild(component);
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[100, 200], [45, 72]]);
  });

  it('applies all-category assumptions and custom series targets', () => {
    const component = viewer();
    component.scenarioScheduleSlippage = 5;
    component.scenarioItems = [{ id: 1, name: 'Extra', value: 20, target: 'Plan' }];
    rebuild(component);
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[120, 240, 360], [50, 80, 110]]);
  });

  it('uses a single series name for a Period-axis chart', () => {
    const component = viewer('line', 'Period', false);
    component.scenarioCategoryTarget = 'Plan';
    component.scenarioPlanAdjustments = 10;
    rebuild(component);
    expect(component.scenarioCategoryOptions).toEqual(['Plan']);
    expect(component.categories.map(category => category.value)).toEqual([110, 220]);
  });

  it('retains category options and targeting for non-Period charts', () => {
    const component = viewer('line', 'Month', false);
    component.scenarioCategoryTarget = 'Jan-26';
    component.scenarioPlanAdjustments = 10;
    rebuild(component);
    expect(component.scenarioCategoryOptions).toEqual(['Jan-26', 'Feb-26']);
    expect(component.categories.map(category => category.value)).toEqual([110, 200]);
  });

  it('updates plotted multi-series values for a non-Period category target', () => {
    const component = viewer('multiline', 'Month');
    component.scenarioCategoryTarget = 'Jan-26';
    component.scenarioPlanAdjustments = 10;
    rebuild(component);
    expect(component.scenarioCategoryOptions).toEqual(['Jan-26', 'Feb-26']);
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[110, 200], [55, 80]]);
  });

  it.each(['stacked', 'grouped', 'combo'])('uses series categories for %s charts', type => {
    const component = viewer(type, 'Month');
    component.scenarioCategoryTarget = 'Plan';
    component.scenarioPlanAdjustments = 10;
    rebuild(component);
    expect(component.scenarioCategoryOptions).toEqual(['Plan', 'Actual']);
    expect(component.multiSeriesData[0].data).toEqual([110, 220]);
    expect(component.multiSeriesData[1].data).toEqual([50, 80]);
    if (type === 'stacked') expect(component.multiSeriesData[2].data).toEqual([160, 300]);
  });

  it('does not discard a data series when stacked totals are disabled', () => {
    const component = viewer('stacked');
    component.design['showStackTotal'] = false;
    component.scenarioPlanAdjustments = 10;
    rebuild(component);
    expect(component.scenarioCategoryOptions).toEqual(['Plan', 'Actual']);
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[110, 220], [55, 88]]);
  });

  it('preserves scalar and JSON-encoded multi-value filters when opening drilldown', () => {
    const component = viewer();
    const navigate = vi.fn();
    Object.assign(component, {
      router: { navigate },
      chart: { id: '42', title: 'Well progress' },
      design: { ...component.design, drillDownViewId: 9 },
      filterValues: {
        country: 'Oman',
        sector: ['Construction Services', 'Energy'],
        businessUnit: 'All', division: 'All', cluster: 'All', plant: 'All',
      },
      filters: [],
      fromDate: '2026-01-01',
      toDate: '2026-09-15',
    });

    component.navigateToDrillDown();

    expect(navigate).toHaveBeenCalledWith(['/charts-tiles/view', '42', 'drilldown'], {
      queryParams: expect.objectContaining({
        country: 'Oman',
        sector: '["Construction Services","Energy"]',
        fromDate: '2026-01-01',
        toDate: '2026-09-15',
      }),
    });
    expect(component['globalHierarchyFilterPayload']()).toEqual([
      { sourceTable: 'country', sourceColumn: 'country', controlType: 'Dropdown', value: 'Oman', label: 'country', globalHierarchy: true },
      {
        sourceTable: 'sector', sourceColumn: 'sector', controlType: 'MultiSelect', value: '',
        values: ['Construction Services', 'Energy'], label: 'sector', globalHierarchy: true,
      },
    ]);
  });

  it('retains locked global filter selections and does not reload when a change is blocked', () => {
    const component = viewer();
    const applyGlobalFilter = vi.fn();
    Object.assign(component, {
      authService: { isAdmin: () => false },
      filterFields: [{ key: 'plant', options: ['Marmul ODC'] }],
      filterValues: { plant: 'Marmul ODC' }, applyGlobalFilter,
    });
    component.selectFilterOption('plant', 'Amal ODC');
    expect(component.filterValues['plant']).toBe('Marmul ODC');
    expect(applyGlobalFilter).not.toHaveBeenCalled();
  });

  it('retains scalar plant-only request payloads and unrestricted cluster selections', () => {
    const component = viewer();
    Object.assign(component, {
      filterValues: {
        country: 'All', sector: 'All', businessUnit: 'All',
        division: 'All', cluster: 'All', plant: 'Marmul ODC',
      },
    });
    expect(component['globalHierarchyFilterPayload']()).toEqual([{
      sourceTable: 'plant_description', sourceColumn: 'plant_description',
      label: 'plant_description', controlType: 'Dropdown', value: 'Marmul ODC', globalHierarchy: true,
    }]);
  });

  it('reset restores unadjusted plotted values', () => {
    const component = viewer();
    component.showScenarioPanel = true;
    component.scenarioPlanAdjustments = 10;
    rebuild(component);
    component.resetScenarioParameters();
    expect(component.multiSeriesData.map(series => series.data)).toEqual([[100, 200], [50, 80]]);
    expect(component.scenarioCategoryTarget).toBe('');
  });
});
