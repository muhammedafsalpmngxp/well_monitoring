import { NEVER, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ChartSelectorItem, DashboardBuilderComponent } from './dashboard-builder/dashboard-builder.component';
import { OperationsDashboardComponent } from './operations-dashboard/operations-dashboard.component';
import { DashboardModule } from './dashboard.module';
import { BoardBuilderComponent } from './board-builder/board-builder.component';

const shared = {
  id: 'Plants::Plant_description', label: 'Plant', sourceTable: 'Plants',
  sourceColumn: 'Plant_description', value: 'Amal',
};
const interactiveFilter = {
  id: 1, label: 'Plant', sourceTable: 'Plants', sourceColumn: 'Plant_description', controlType: 'Dropdown',
};

describe('saved period chart category colors', () => {
  const design = {
    chartType: 'multiline', xAxis: 'Period',
    colorRules: [{ id: 1, field: 'Category', operator: '', value: '',
      categories: ['Actual'], color: '#123456' }],
  };

  it('matches the legend category in dashboard view', () => {
    const viewer: OperationsDashboardComponent = Object.create(OperationsDashboardComponent.prototype);
    expect(viewer['categoryColorFor']('Oct 2026', design, 'Actual')).toBe('#123456');
    expect(viewer['colorForRule']('Nov 2026', 3, design, 'Actual')).toBe('#123456');
    expect(viewer['categoryColorFor']('Actual', design, 'Plan')).toBeUndefined();
  });

  it.each([
    ['dashboard view', OperationsDashboardComponent],
    ['dashboard builder', DashboardBuilderComponent],
    ['board builder', BoardBuilderComponent],
  ] as const)('colors only the line for %s and retains point colors', (_page, ComponentType) => {
    const component = Object.create(ComponentType.prototype) as any;
    const rendered = component['applyColorRulesToSeries'](
      [{ type: 'line', name: 'Actual', color: '#aabbcc', data: [2, 3] }],
      ['Oct 2026', 'Nov 2026'],
      design,
    );
    expect(rendered[0].color).toBe('#123456');
    expect(rendered[0].data.map((point: { color: string }) => point.color)).toEqual([
      component['pointColor']('Oct 2026', 2, design, 0, 'Actual', false),
      component['pointColor']('Nov 2026', 3, design, 1, 'Actual', false),
    ]);
    expect(rendered[0].data[0].color).not.toBe('#123456');
    expect(rendered[0].data[1].color).not.toBe('#123456');
  });

  it('matches the legend category in dashboard builder previews', () => {
    const builder: DashboardBuilderComponent = Object.create(DashboardBuilderComponent.prototype);
    expect(builder['categoryColorFor']('Oct 2026', design, 'Actual')).toBe('#123456');
    expect(builder['colorForRule']('Nov 2026', 3, design, 'Actual')).toBe('#123456');
  });

  it('matches the legend category in board builder previews', () => {
    const builder: BoardBuilderComponent = Object.create(BoardBuilderComponent.prototype);
    expect(builder['categoryColorFor']('Oct 2026', design, 'Actual')).toBe('#123456');
    expect(builder['colorForRule']('Nov 2026', 3, design, 'Actual')).toBe('#123456');
  });
});

describe('board builder shared filters panel', () => {
  it('opens the dashboard filters modal from the Filters panel button', () => {
    const builder: BoardBuilderComponent = Object.create(BoardBuilderComponent.prototype);
    Object.assign(builder, { activePanel: null, cdr: { markForCheck: vi.fn() } });

    builder.selectPanel('filters');

    expect(builder.activePanel).toBe('filters');
    expect(builder.showFiltersModal).toBe(true);
    expect(builder['cdr'].markForCheck).toHaveBeenCalledOnce();
  });

  it('offers unlocked dropdown filters from placed charts for promotion', () => {
    const builder: BoardBuilderComponent = Object.create(BoardBuilderComponent.prototype);
    const chart = { id: 'chart-1' };
    const localFilters = [
      { label: 'Region', sourceTable: 'Plants', sourceColumn: 'Region', controlType: 'Dropdown', hidden: false, locked: false, value: '', values: [], options: [] },
      { label: 'Locked', sourceTable: 'Plants', sourceColumn: 'Locked', controlType: 'Dropdown', hidden: false, locked: true, value: '', values: [], options: [] },
      { label: 'Hidden', sourceTable: 'Plants', sourceColumn: 'Hidden', controlType: 'Dropdown', hidden: true, locked: false, value: '', values: [], options: [] },
      { label: 'Comment', sourceTable: 'Plants', sourceColumn: 'Comment', controlType: 'Text', hidden: false, locked: false, value: '', values: [], options: [] },
    ];
    Object.assign(builder, {
      customFilters: [], tileSlots: [chart], chartSlotsData: [],
      isChartItem: vi.fn(() => true), getChartLocalFilters: vi.fn(() => localFilters),
    });

    expect(builder.availableCustomFilterCandidates).toEqual([
      { label: 'Region', sourceTable: 'Plants', sourceColumn: 'Region' },
    ]);
  });
});

describe('dashboard shared filter requests', () => {
  it('uses components declared in the dashboard module', () => {
    expect(DashboardModule).toBeDefined();
  });

  describe('dashboard view global date initialization', () => {
    const firstSql = `
      DECLARE @start_date DATE;
      SET @start_date = '2026-10-06';
      DECLARE @future_date DATE = DATEADD(MONTH, 4, @start_date);
    `;
    const secondSql = "DECLARE @start_date DATE = '2026-11-01'; DECLARE @future_date DATE = '2027-03-01';";

    function viewer(viewIds: number[] = [1, 2]) {
      const component: OperationsDashboardComponent = Object.create(OperationsDashboardComponent.prototype);
      const getDatabaseViewById = vi.fn((id: number) => of({ generatedSql: id === 1 ? firstSql : secondSql }));
      Object.assign(component, {
        commonApi: { getDatabaseViewById }, destroy$: new Subject(),
        cdr: { markForCheck: vi.fn() }, showError: vi.fn(),
        filterFrom: '2026-01-01', filterTo: '2026-10-06', filterQuickRange: '',
        chartCards: viewIds.map(viewId => ({ design: { sourceType: 'View', viewId } })),
      });
      return { component, getDatabaseViewById };
    }

    it('uses the first chart range only after every chart view is checked, regardless of response order', () => {
      const { component, getDatabaseViewById } = viewer();
      const first = new Subject<{ generatedSql: string }>();
      const second = new Subject<{ generatedSql: string }>();
      getDatabaseViewById.mockImplementation(id => id === 1 ? first : second);
      component['initializeDashboardChartDates']();
      second.next({ generatedSql: secondSql });
      second.complete();
      expect(component.filterFrom).toBe('2026-01-01');
      expect(component.filterTo).toBe('2026-10-06');
      first.next({ generatedSql: firstSql });
      first.complete();
      expect(component.filterFrom).toBe('2026-10-06');
      expect(component.filterTo).toBe('2027-02-06');
      expect(component.filterQuickRange).toBe('Custom');
      expect(getDatabaseViewById).toHaveBeenCalledTimes(2);
    });

    it('retains the default dates when any view lacks future_date, including an off-screen chart', () => {
      const { component, getDatabaseViewById } = viewer();
      getDatabaseViewById.mockImplementation(id => of({
        generatedSql: id === 1 ? firstSql : "DECLARE @start_date DATE = '2020-01-01'; DECLARE @end_date DATE;",
      }));
      component['initializeDashboardChartDates']();
      expect(component.filterFrom).toBe('2026-01-01');
      expect(component.filterTo).toBe('2026-10-06');
      expect(component.filterQuickRange).toBe('');
    });

    it('retains the default dates when a table chart is present', () => {
      const { component, getDatabaseViewById } = viewer();
      component.chartCards[1].design.sourceType = 'Table';
      component['initializeDashboardChartDates']();
      expect(getDatabaseViewById).not.toHaveBeenCalled();
      expect(component.filterFrom).toBe('2026-01-01');
      expect(component.filterTo).toBe('2026-10-06');
    });

    it('does not change dates for an empty dashboard', () => {
      const { component, getDatabaseViewById } = viewer([]);
      component['initializeDashboardChartDates']();
      expect(getDatabaseViewById).not.toHaveBeenCalled();
      expect(component.filterFrom).toBe('2026-01-01');
    });

    it('reuses cached view metadata for cloned charts and their lazy loaders', () => {
      const { component, getDatabaseViewById } = viewer([1, 1]);
      const views = component['initializeDashboardChartDates']();
      const result = vi.fn();
      views.get(1)?.subscribe(result);
      expect(getDatabaseViewById).toHaveBeenCalledOnce();
      expect(result).toHaveBeenCalledWith({ generatedSql: firstSql });
      expect(component.filterTo).toBe('2027-02-06');
    });

    it('restores defaults when moving from a future-only board to a mixed board', () => {
      const { component } = viewer([1]);
      component['initializeDashboardChartDates']();
      expect(component.filterTo).toBe('2027-02-06');
      component.chartCards[0].design.sourceType = 'Table';
      component['initializeDashboardChartDates']();
      const today = new Date();
      expect(component.filterFrom).toBe(`${today.getFullYear()}-01-01`);
      expect(component.filterTo).toBe(component['lastTuesday'](today));
      expect(component.filterQuickRange).toBe('');
    });

    it('ignores in-flight metadata from a previous board', () => {
      const { component, getDatabaseViewById } = viewer([1]);
      const pending = new Subject<{ generatedSql: string }>();
      getDatabaseViewById.mockReturnValue(pending);
      component['initializeDashboardChartDates']();
      Object.assign(component, { chartCards: [{ design: { sourceType: 'Table' } }] });
      component['initializeDashboardChartDates']();
      pending.next({ generatedSql: firstSql });
      pending.complete();
      expect(component.filterFrom).toBe('2026-01-01');
      expect(component.filterTo).toBe('2026-10-06');
    });

    it('keeps the chart range when dashboard saved-default filters arrive later', () => {
      const { component } = viewer([1]);
      component['initializeDashboardChartDates']();
      Object.assign(component, { filterFrom: '2026-01-01', filterTo: '2026-10-06', filterCluster: 'Amal' });
      component['applyDashboardChartDates']();
      expect(component.filterFrom).toBe('2026-10-06');
      expect(component.filterTo).toBe('2027-02-06');
      expect(component.filterCluster).toBe('Amal');
    });

    it('reports metadata failures without overriding the defaults', () => {
      const { component, getDatabaseViewById } = viewer([1]);
      getDatabaseViewById.mockReturnValue(throwError(() => new Error('View unavailable')));
      component['initializeDashboardChartDates']();
      expect(component['showError']).toHaveBeenCalledWith('View unavailable');
      expect(component.filterFrom).toBe('2026-01-01');
    });

    it('reports an unsupported chart date expression instead of inventing a range', () => {
      const { component, getDatabaseViewById } = viewer([1]);
      getDatabaseViewById.mockReturnValue(of({ generatedSql: 'DECLARE @start_date DATE; DECLARE @future_date DATE;' }));
      component['initializeDashboardChartDates']();
      expect(component['showError']).toHaveBeenCalledWith(expect.stringContaining('Unable to resolve'));
      expect(component.filterFrom).toBe('2026-01-01');
    });
  });
  it('sends the shared selection with edit dashboard chart previews and preserves dates', () => {
    const component: DashboardBuilderComponent = Object.create(DashboardBuilderComponent.prototype);
    const getFilteredChartData = vi.fn((_request: unknown) => NEVER);
    Object.assign(component, {
      widgetService: { getFilteredChartData }, customFilters: [shared],
      loadedChartPreviewIds: new Set(), chartPreviewGenerations: {}, chartPreviewLoading: {}, chartAdditionalFilterNoData: {},
      trendChartPreviews: {}, chartTrendModes: {}, chartLocalFilterValues: {},
      slotPreviewFiltersCache: new WeakMap(), destroy$: new Subject(),
      fromDate: '2026-01-01', toDate: '2026-09-22',
    });
    const chart: ChartSelectorItem = {
      id: '1', title: 'Readiness', description: '', chartType: 'bar',
      source: 'Readiness', sourceType: 'Table',
      designJson: JSON.stringify({ interactiveFilters: [interactiveFilter] }),
    };
    component.onChartVisible(chart);
    expect(getFilteredChartData).toHaveBeenCalledWith(expect.objectContaining({
      chartSource: 'Readiness',
      filters: [expect.objectContaining({ sourceTable: 'Plants', sourceColumn: 'Plant_description', value: 'Amal' })],
      fromDate: '2026-01-01', toDate: '2026-09-22',
      preserveFutureDateRange: true,
    }));
  });

  it.each([false, true])('preserves dates and the clone plant selection in builder view requests (additional: %s)', additional => {
    const component: DashboardBuilderComponent = Object.create(DashboardBuilderComponent.prototype);
    const getFilteredChartData = vi.fn((_request: unknown) => NEVER);
    Object.assign(component, {
      widgetService: { getFilteredChartData }, customFilters: additional ? [{ ...shared, additional: true }] : [],
      loadedChartPreviewIds: new Set(), chartPreviewGenerations: {}, chartPreviewLoading: {}, chartAdditionalFilterNoData: {},
      trendChartPreviews: {}, chartTrendModes: {}, chartLocalFilterValues: {},
      slotPreviewFiltersCache: new WeakMap(), destroy$: new Subject(),
      fromDate: '2026-01-01', toDate: '2026-09-22', plant: 'Global Plant', cluster: 'Cluster A',
    });
    component.onChartVisible({
      id: 'clone_1', title: 'Readiness', description: '', chartType: 'bar',
      source: 'Readiness', sourceType: 'View', isClone: true,
      presetColumn: 'Plant_description', presetValue: 'Clone Plant',
      designJson: JSON.stringify({
        dataSourceMode: 'view', viewId: 1, interactiveFilters: [interactiveFilter],
      }),
    });
    expect(getFilteredChartData).toHaveBeenCalledWith(expect.objectContaining({
      viewId: 1, preserveFutureDateRange: true,
      fromDate: '2026-01-01', toDate: '2026-09-22',
      filters: [
        expect.objectContaining({ sourceColumn: 'Plant_description', value: 'Clone Plant' }),
        expect.objectContaining({ sourceColumn: 'cluster', value: 'Cluster A' }),
      ],
    }));
  });

  it('sends additional fields for builder charts without local filters', () => {
    const component: DashboardBuilderComponent = Object.create(DashboardBuilderComponent.prototype);
    const getFilteredChartData = vi.fn(() => NEVER);
    Object.assign(component, {
      widgetService: { getFilteredChartData }, customFilters: [{ ...shared, additional: true }],
      loadedChartPreviewIds: new Set(), chartPreviewGenerations: {}, chartPreviewLoading: {}, chartAdditionalFilterNoData: {},
      trendChartPreviews: {}, chartTrendModes: {}, chartLocalFilterValues: {},
      slotPreviewFiltersCache: new WeakMap(), destroy$: new Subject(),
      fromDate: '2026-01-01', toDate: '2026-09-22',
    });
    component.onChartVisible({
      id: '42', title: 'Readiness', description: '', chartType: 'bar',
      source: 'Readiness', sourceType: 'Table', designJson: '{}',
    });
    expect(getFilteredChartData).toHaveBeenCalledWith(expect.objectContaining({
      chartSource: 'Readiness',
      filters: [expect.objectContaining({
        sourceColumn: 'Plant_description', value: 'Amal', dashboardAdditional: true,
      })],
    }));
  });

  it('appends newly added filters and refreshes when a selection is removed', () => {
    const component: DashboardBuilderComponent = Object.create(DashboardBuilderComponent.prototype);
    const reload = vi.fn();
    Object.assign(component, {
      customFilters: [shared], getFilterValues: vi.fn(), persistFilterState: vi.fn(),
      reloadPlacedPreviews: reload, cdr: { markForCheck: vi.fn() },
    });
    component.addCustomFilter({ label: 'Region', sourceTable: 'Plants', sourceColumn: 'Region' });
    expect(component.customFilters.map(filter => filter.sourceColumn)).toEqual(['Plant_description', 'Region']);
    component.removeCustomFilter(shared.id);
    expect(reload).toHaveBeenCalledOnce();
  });

  function viewer() {
    const component: OperationsDashboardComponent = Object.create(OperationsDashboardComponent.prototype);
    const getFilteredChartData = vi.fn((_request: unknown, _context?: unknown) => NEVER);
    Object.assign(component, {
      widgetService: { getFilteredChartData }, customFilters: [shared],
      destroy$: new Subject(), cancelReload$: new Subject(),
      filterFrom: '2026-01-01', filterTo: '2026-09-22',
      chartCards: [{
        title: 'Readiness', design: { source: 'Readiness', sourceType: 'Table' },
        localFilters: [{ ...interactiveFilter, value: '', options: [] }],
        trendMode: 'monthly',
      }],
    });
    return { component, getFilteredChartData };
  }

  it('sends matching shared selections on dashboard view reloads', () => {
    const { component, getFilteredChartData } = viewer();
    component['reloadCardData$'](0);
    expect(getFilteredChartData).toHaveBeenCalledWith(expect.objectContaining({
      filters: [expect.objectContaining({ value: 'Amal', sourceColumn: 'Plant_description' })],
      fromDate: '2026-01-01', toDate: '2026-09-22',
      preserveFutureDateRange: true,
    }), undefined);
  });

  it('sends additional selections even when a dashboard-view chart has no local filters', () => {
    const { component, getFilteredChartData } = viewer();
    component.customFilters = [{ ...shared, additional: true }];
    component.chartCards[0].localFilters = [];
    component['reloadCardData$'](0);
    expect(getFilteredChartData).toHaveBeenCalledWith(expect.objectContaining({
      filters: [expect.objectContaining({
        sourceTable: 'Plants', sourceColumn: 'Plant_description', value: 'Amal',
        dashboardAdditional: true,
      })],
    }), undefined);
  });

  describe('dashboard view additional-filter no-data state', () => {
    function filteredViewer() {
      const { component } = viewer();
      component.customFilters = [{ ...shared, additional: true }];
      const card = component.chartCards[0];
      card.chartType = 'bar';
      card.design = { chartType: 'bar', xAxis: 'Plant', yAxis: 'Value' };
      const buildCardData = vi.fn(() => ({
        cats: [], vals: [], multiSeries: [], options: {},
      }));
      Object.assign(component, { buildCardData, fillCardChartHeight: vi.fn(() => ({})) });
      return { component, card, buildCardData };
    }

    it('shows no data for an empty response and clears the state when matching rows return', () => {
      const { component, card } = filteredViewer();
      expect(component['buildCardResult']([], card).additionalFilterNoData).toBe(true);
      expect(component['buildCardResult']([{ Plant: 'Amal', Value: 5 }], card).additionalFilterNoData).toBe(false);
    });

    it.each(['all', 'removed', 'ordinary'] as const)('does not retain the additional-filter state when %s', state => {
      const { component, card } = filteredViewer();
      expect(component['buildCardResult']([], card).additionalFilterNoData).toBe(true);
      if (state === 'all') component.customFilters[0].value = 'All';
      else if (state === 'removed') component.customFilters = [];
      else component.customFilters[0].additional = false;
      expect(component['buildCardResult']([], card).additionalFilterNoData).toBe(false);
    });

    it('shows no data when saved conditional filters remove the remaining rows', () => {
      const { component, card, buildCardData } = filteredViewer();
      card.design.conditionalFilters = [{
        sourceColumn: 'Value', operator: 'greater than', valueText: '10',
      }];
      expect(component['buildCardResult']([{ Plant: 'Amal', Value: 5 }], card).additionalFilterNoData).toBe(true);
      expect(buildCardData).toHaveBeenCalledWith([], expect.anything(), card.title, 'bar');
    });

    it('preserves the existing empty-chart behavior when the matching local filter is locked', () => {
      const { component, card } = filteredViewer();
      card.localFilters[0].locked = true;
      expect(component['buildCardResult']([], card).additionalFilterNoData).toBe(false);
    });

    it.each([false, true])('applies transformations once and preserves DAX summaries with additional filters %s', additional => {
      const { component } = viewer();
      component.customFilters = additional ? [{ ...shared, additional: true }] : [];
      const card = component.chartCards[0];
      card.chartType = 'gauge';
      card.design = {
        chartType: 'gauge', yAxis: 'Value',
        parameterFilters: [{ id: 1, action: 'math_transform', sourceColumn: 'Value', mathOperator: '*', mathValue: 2 }],
        conditionalFilters: [{ sourceColumn: 'Value', operator: 'less than', valueText: '15' }],
        daxModel: { schemaVersion: 1, enabled: true, measures: [{ id: 'total', name: 'Total', expression: 'SUM([Value])' }] },
      };
      const buildGaugeCardData = vi.fn(() => ({ cats: [], vals: [], multiSeries: [], options: {} }));
      Object.assign(component, { buildGaugeCardData, fillCardChartHeight: vi.fn(() => ({})) });
      const originalRows = [{ Value: 5 }];

      const result = component['buildCardResult'](originalRows, card);

      expect(buildGaugeCardData).toHaveBeenCalledWith([{ Value: 10 }], expect.anything());
      expect(result.daxSummaries).toEqual([{ name: 'Total', value: 10, formattedValue: '10' }]);
      expect(result.additionalFilterNoData).toBe(false);
      expect(originalRows).toEqual([{ Value: 5 }]);

      const emptyResult = component['buildCardResult']([{ Value: 10 }], card);
      expect(buildGaugeCardData).toHaveBeenLastCalledWith([], expect.anything());
      expect(emptyResult.additionalFilterNoData).toBe(additional);
    });
  });

  it('keeps shared selections when changing trend modes or chart-local filters', () => {
    const { component, getFilteredChartData } = viewer();
    component.setCardTrendMode(0, 'yearly');
    component.applyLocalFilter(0);
    expect(getFilteredChartData).toHaveBeenCalledTimes(2);
    for (const [request] of getFilteredChartData.mock.calls) {
      expect(request).toEqual(expect.objectContaining({
        filters: [expect.objectContaining({ value: 'Amal' })],
        preserveFutureDateRange: true,
      }));
    }
  });

  it.each(['reload', 'trend'] as const)('preserves dates and clone plant filters on viewer %s requests', action => {
    const { component, getFilteredChartData } = viewer();
    Object.assign(component, {
      customFilters: [], filterPlant: 'Global Plant', filterCluster: 'Cluster A',
    });
    Object.assign(component.chartCards[0], {
      isClone: true,
      design: { source: 'Readiness', sourceType: 'View', dataSourceMode: 'view', viewId: 1, chartType: 'bar' },
      localFilters: [{ ...interactiveFilter, value: 'Clone Plant', options: [], locked: true }],
    });
    if (action === 'reload') component['reloadCardData$'](0);
    else component.setCardTrendMode(0, 'yearly');
    expect(getFilteredChartData).toHaveBeenCalledOnce();
    expect(getFilteredChartData.mock.calls[0][0]).toEqual(expect.objectContaining({
      viewId: 1, preserveFutureDateRange: true,
      fromDate: '2026-01-01', toDate: '2026-09-22',
      filters: [
        expect.objectContaining({ sourceColumn: 'Plant_description', value: 'Clone Plant' }),
        expect.objectContaining({ sourceColumn: 'cluster', value: 'Cluster A' }),
      ],
    }));
    const [request] = getFilteredChartData.mock.calls[0];
    if (action === 'reload') expect(request).not.toHaveProperty('mode');
    else expect(request).toHaveProperty('mode', 'yearly');
  });

  describe('dashboard future-date SQL previews', () => {
    const futureSql = `
      DECLARE @start_date DATE;
      SET @start_date = CAST(GETDATE() AS DATE);
      DECLARE @future_date DATE = DATEADD(MONTH, 4, @start_date);
      DECLARE @end_date DATE = '2027-01-01';
      DECLARE @cluster NVARCHAR(100) = NULL;
      SELECT @start_date, @future_date;
    `;
    const normalSql = "DECLARE @start_date DATE = '2026-02-01'; DECLARE @end_date DATE = '2026-03-01';";

    it.each([false, true])('preserves builder future-date SQL when chart exemption is %s', preserve => {
      const component: DashboardBuilderComponent = Object.create(DashboardBuilderComponent.prototype);
      Object.assign(component, {
        fromDate: '2026-01-01', toDate: '2026-10-06', cluster: 'Amal',
      });
      const sql = component['injectGlobalFilterParams'](futureSql, preserve);
      expect(sql).toContain("DECLARE @cluster NVARCHAR(100) = 'Amal';");
      expect(sql).toContain('DECLARE @future_date DATE = DATEADD(MONTH, 4, @start_date);');
      expect(sql).toContain(preserve ? 'DECLARE @start_date DATE;' : "DECLARE @start_date DATE = '2026-01-01';");
      expect(sql).toContain(preserve ? "DECLARE @end_date DATE = '2027-01-01';" : "DECLARE @end_date DATE = '2026-10-06';");
    });

    it.each([false, true])('preserves viewer future-date SQL when chart exemption is %s', preserve => {
      const component: OperationsDashboardComponent = Object.create(OperationsDashboardComponent.prototype);
      Object.assign(component, {
        filterFrom: '2026-01-01', filterTo: '2026-10-06', filterCluster: 'Amal',
        datePattern: /^\d{4}-\d{2}-\d{2}$/, safeValuePattern: /^[A-Za-z0-9\s\-_.,()]+$/,
      });
      const sql = component['injectDateParams'](futureSql, preserve);
      expect(sql).toContain("DECLARE @cluster NVARCHAR(100) = 'Amal';");
      expect(sql).toContain('DECLARE @future_date DATE = DATEADD(MONTH, 4, @start_date);');
      expect(sql).toContain(preserve ? 'DECLARE @start_date DATE;' : "DECLARE @start_date DATE = '2026-01-01';");
      expect(sql).toContain(preserve ? "DECLARE @end_date DATE = '2027-01-01';" : "DECLARE @end_date DATE = '2026-10-06';");
    });

    it('still substitutes global dates for ordinary charts in both dashboard pages', () => {
      const builder: DashboardBuilderComponent = Object.create(DashboardBuilderComponent.prototype);
      Object.assign(builder, { fromDate: '2026-01-01', toDate: '2026-10-06' });
      const viewer: OperationsDashboardComponent = Object.create(OperationsDashboardComponent.prototype);
      Object.assign(viewer, {
        filterFrom: '2026-01-01', filterTo: '2026-10-06', datePattern: /^\d{4}-\d{2}-\d{2}$/,
      });
      const expected = "DECLARE @start_date DATE = '2026-01-01'; DECLARE @end_date DATE = '2026-10-06';";
      expect(builder['injectGlobalFilterParams'](normalSql, true)).toBe(expected);
      expect(viewer['injectDateParams'](normalSql, true)).toBe(expected);
    });
  });
});
