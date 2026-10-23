import { CommonModule, Location } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { NEVER, of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiResponse } from '../../../core/models/api-response.model';
import { DashboardDetailResponse, WidgetLibraryResponse } from '../../../core/models/dashboard.model';
import { AuthService } from '../../../core/services/auth.service';
import { CategoryService } from '../../../core/services/category.service';
import { CommonApiService } from '../../../core/services/common-api.service';
import { DashboardSavedFilterService } from '../../../core/services/dashboard-saved-filter.service';
import { DashboardService } from '../../../core/services/dashboard.service';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { ChartSource, WidgetService } from '../../../core/services/widget.service';
import { ButtonComponent } from '../../../shared/components/button/button.component';
import { LoaderComponent } from '../../../shared/components/loader/loader.component';
import { DateInputComponent } from '../../../shared/components/date-input/date-input.component';
import { ChartNoDataComponent } from '../../../shared/components/chart-no-data/chart-no-data.component';
import { PieChartEmptyPipe } from '../../../shared/pipes/pie-chart-empty.pipe';
import { OperationsDashboardComponent } from '../operations-dashboard/operations-dashboard.component';
import { Board as StandardBoard, StandardBoardsComponent } from '../standard-boards/standard-boards.component';
import { Board as WipBoard, WipBoardsComponent } from '../wip-boards/wip-boards.component';
import { ChartSelectorItem, DashboardBuilderComponent, TileSelectorItem } from './dashboard-builder.component';

describe('dashboard builder loading', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup(
    queryParams: Record<string, string> = {},
    routeParams: Record<string, string> = {},
    renderTemplate = false,
  ) {
    const dashboard = new Subject<ApiResponse<DashboardDetailResponse>>();
    const library = new Subject<WidgetLibraryResponse>();
    const placedWidgets = new Subject<WidgetLibraryResponse>();
    const sources = new Subject<ChartSource[]>();
    const sourceData = new Subject<{ columns: string[]; rows: Record<string, unknown>[] }>();
    const getTableData = vi.fn(() => sourceData);
    const createDashboard = vi.fn(() => NEVER);
    const testBed = TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [DashboardBuilderComponent, LoaderComponent, DateInputComponent, ButtonComponent, PieChartEmptyPipe, ChartNoDataComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: {
          queryParamMap: convertToParamMap(queryParams), paramMap: convertToParamMap(routeParams),
        } } },
        { provide: Router, useValue: {} },
        { provide: CategoryService, useValue: { getCategoriesByType: () => of([]) } },
        { provide: DashboardService, useValue: {
          getDashboardById: vi.fn(() => dashboard),
          getWidgetLibrary: vi.fn(() => library),
          getDashboardWidgets: vi.fn(() => placedWidgets),
          createDashboard,
        } },
        { provide: WidgetService, useValue: { getBISources: () => sources, getTableData, getFilteredChartData: () => sourceData } },
        { provide: CommonApiService, useValue: {} },
        { provide: DashboardSavedFilterService, useValue: {} },
        { provide: AuthService, useValue: { isAdmin: () => false, getCurrentUser: () => null } },
        { provide: LayoutStateService, useValue: {
          isCollapsed: false, sidebarCollapsed$: NEVER, collapse: vi.fn(), expand: vi.fn(),
        } },
        { provide: Location, useValue: {} },
      ],
    });
    if (!renderTemplate) testBed.overrideComponent(DashboardBuilderComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(DashboardBuilderComponent);
    const component = fixture.componentInstance;
    Object.assign(component, {
      loadPlantFilters: vi.fn(), restoreFilterState: vi.fn(),
      refreshEditorGrid: vi.fn(), applyDefaultFilterIfAny: vi.fn(),
    });
    fixture.detectChanges();
    return { component, dashboard, library, placedWidgets, fixture, sources, sourceData, getTableData, createDashboard };
  }

  function respond(dashboard: Subject<ApiResponse<DashboardDetailResponse>>, name: string) {
    dashboard.next({
      data: {
        dashboardId: 42, dashboardName: name, categoryId: 1, categoryName: 'Energy',
        status: 'Draft', isActive: true, isLatestVersion: true,
      },
      success: true, statusCode: 200, message: '',
    });
    dashboard.complete();
  }

  it.each(['standard', 'my'] as const)('refreshes loaded Add Charts and Add Tiles %s cards when hierarchy filters change', tab => {
    const { component } = setup();
    Object.assign(component, {
      country: 'Oman', cluster: 'North', plant: 'Plant A',
      rebuildCascadingOptions: vi.fn(), persistFilterState: vi.fn(),
    });
    const tile: TileSelectorItem = {
      id: 'tile-1', title: 'Tile', value: '-', accent: 'blue', icon: 'well',
      active: 0, inactive: 0, activeLabel: 'Active', inactiveLabel: 'Inactive',
      designJson: JSON.stringify({ source: 'Wells', sourceType: 'Table', aggregation: 'count' }),
    };
    const chart: ChartSelectorItem = {
      id: 'chart-1', title: 'Chart', description: '', chartType: 'line',
      source: 'WellView', sourceType: 'View',
      designJson: JSON.stringify({
        source: 'WellView', sourceType: 'View', dataSourceMode: 'view', viewId: 3,
        chartType: 'line', xAxis: 'Period', yAxis: 'Sum (F)', yAggColumn: 'Plan',
      }),
    };
    component.standardTiles = tab === 'standard' ? [tile] : [];
    component.myTiles = tab === 'my' ? [tile] : [];
    component.standardCharts = tab === 'standard' ? [chart] : [];
    component.myCharts = tab === 'my' ? [chart] : [];
    const pending = new Subject<{ columns: string[]; rows: Record<string, unknown>[] }>();
    const getFilteredChartData = vi.spyOn(TestBed.inject(WidgetService), 'getFilteredChartData')
      .mockReturnValue(pending);
    component.onTileVisible(tile);
    component.onChartVisible(chart);
    expect(getFilteredChartData).toHaveBeenCalledTimes(2);

    component.selectFilterOption('plant', 'Plant B');

    expect(getFilteredChartData).toHaveBeenCalledTimes(4);
    const requests = getFilteredChartData.mock.calls.slice(2).map(([request]) => request);
    expect(requests).toContainEqual(expect.objectContaining({
      chartSource: 'WellView', viewId: 3, mode: 'monthly',
      fromDate: component.fromDate, toDate: component.toDate,
      filters: expect.arrayContaining([expect.objectContaining({ sourceColumn: 'plant', values: ['Plant A', 'Plant B'] })]),
    }));
    expect(requests).toContainEqual(expect.objectContaining({
      chartSource: 'Wells', aggregation: 'count',
      filters: expect.arrayContaining([expect.objectContaining({ values: ['Plant A', 'Plant B'] })]),
    }));
    expect(component.tileSlots.every(slot => slot === null)).toBe(true);
    expect(component.chartSlotsData).toEqual([]);
  });

  it('invalidates library previews on date changes, cancels old requests, and leaves unseen cards lazy', () => {
    const { component } = setup();
    Object.assign(component, {
      cluster: 'North', plant: 'Plant A', persistFilterState: vi.fn(),
    });
    const tile: TileSelectorItem = {
      id: 'tile-1', title: 'Tile', value: '-', accent: 'blue', icon: 'well',
      active: 0, inactive: 0, activeLabel: 'Active', inactiveLabel: 'Inactive',
      designJson: JSON.stringify({ source: 'Wells', sourceType: 'Table', aggregation: 'count' }),
    };
    const chart: ChartSelectorItem = {
      id: 'chart-1', title: 'Chart', description: '', chartType: 'line',
      source: 'WellView', sourceType: 'View',
      designJson: JSON.stringify({ source: 'WellView', sourceType: 'View', dataSourceMode: 'view', viewId: 3, chartType: 'line' }),
    };
    component.standardTiles = [tile, { ...tile, id: 'unseen-tile' }];
    component.standardCharts = [chart, { ...chart, id: 'unseen-chart' }];
    const oldRequests = new Subject<{ columns: string[]; rows: Record<string, unknown>[] }>();
    const newRequests = new Subject<{ columns: string[]; rows: Record<string, unknown>[] }>();
    const getFilteredChartData = vi.spyOn(TestBed.inject(WidgetService), 'getFilteredChartData')
      .mockReturnValue(oldRequests);
    component.onTileVisible(tile);
    component.onChartVisible(chart);
    expect(oldRequests.observed).toBe(true);
    getFilteredChartData.mockReturnValue(newRequests);
    component.fromDate = '2026-02-01';
    component.toDate = '2026-06-30';

    component.onGlobalDateChange();

    expect(oldRequests.observed).toBe(false);
    expect(newRequests.observed).toBe(true);
    expect(getFilteredChartData).toHaveBeenCalledTimes(4);
    expect(getFilteredChartData).toHaveBeenLastCalledWith(expect.objectContaining({
      fromDate: '2026-02-01', toDate: '2026-06-30',
    }));
    expect(component['loadedChartPreviewIds'].has('unseen-chart')).toBe(false);
    expect(component['tilePreviewRequests'].has(JSON.stringify(['unseen-tile', tile.designJson]))).toBe(false);
  });

  it('updates both placed and library tile objects when they refer to the same widget', () => {
    const { component } = setup();
    Object.assign(component, { cluster: 'North', plant: 'Plant A', persistFilterState: vi.fn() });
    const tile: TileSelectorItem = {
      id: 'tile-1', title: 'Tile', value: '-', accent: 'blue', icon: 'well',
      active: 0, inactive: 0, activeLabel: 'Active', inactiveLabel: 'Inactive',
      designJson: JSON.stringify({ source: 'Wells', sourceType: 'Table', aggregation: 'count' }),
    };
    const placed = { ...tile };
    component.standardTiles = [tile];
    component.tileSlots = [placed];
    const getFilteredChartData = vi.spyOn(TestBed.inject(WidgetService), 'getFilteredChartData')
      .mockReturnValue(of({ columns: ['Value'], rows: [{ Value: 10 }] }));
    component.onTileVisible(tile);
    getFilteredChartData.mockReturnValue(of({ columns: ['Value'], rows: [{ Value: 20 }] }));

    component.onGlobalDateChange();

    expect(tile.value).toBe('20');
    expect(placed.value).toBe('20');
    expect(getFilteredChartData).toHaveBeenCalledTimes(2);
  });

  it.each(['complete', 'error'] as const)('keeps the filter loading indication until tiles and charts finish (%s)', outcome => {
    const { component } = setup();
    Object.assign(component, { cluster: 'North', plant: 'Plant A' });
    const tile: TileSelectorItem = {
      id: 'tile-1', title: 'Tile', value: '-', accent: 'blue', icon: 'well',
      active: 0, inactive: 0, activeLabel: 'Active', inactiveLabel: 'Inactive',
      designJson: JSON.stringify({ source: 'Wells', sourceType: 'Table', aggregation: 'count' }),
    };
    const chart: ChartSelectorItem = {
      id: 'chart-1', title: 'Chart', description: '', chartType: 'line',
      source: 'WellView', sourceType: 'View',
      designJson: JSON.stringify({ source: 'WellView', sourceType: 'View', dataSourceMode: 'view', viewId: 3, chartType: 'line' }),
    };
    const tileRequest = new Subject<{ columns: string[]; rows: Record<string, unknown>[] }>();
    const chartRequest = new Subject<{ columns: string[]; rows: Record<string, unknown>[] }>();
    vi.spyOn(TestBed.inject(WidgetService), 'getFilteredChartData')
      .mockImplementation(request => request.chartSource === 'Wells' ? tileRequest : chartRequest);
    expect(component.isRefreshingPreviews).toBe(false);
    component.onTileVisible(tile);
    component.onChartVisible(chart);
    expect(component.isRefreshingPreviews).toBe(true);
    if (outcome === 'error') tileRequest.error(new Error('Failed to load tile'));
    else tileRequest.complete();
    expect(component.isRefreshingPreviews).toBe(true);
    if (outcome === 'error') chartRequest.error(new Error('Failed to load chart'));
    else chartRequest.complete();
    expect(component.isRefreshingPreviews).toBe(false);
  });

  it.each(['tiles', 'charts'] as const)('shows an accessible filter loading status in the Add %s dialog', dialog => {
    const { component, fixture } = setup({}, {}, true);
    component.selectPanel(dialog);
    component['pendingTilePreviews'].add('pending-preview');
    fixture.detectChanges();
    const status = fixture.debugElement.query(By.css('.preview-filter-loading'));
    expect(status.attributes['role']).toBe('status');
    expect(status.attributes['aria-label']).toBe('Updating filtered previews');
    expect(status.nativeElement.textContent).not.toContain('Applying filters and updating previews');
    expect(status.query(By.directive(LoaderComponent)).componentInstance.size).toBe('sm');
    component['pendingTilePreviews'].clear();
    component['cdr'].markForCheck();
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.preview-filter-loading'))).toBeNull();
  });

  it('clears every checkbox, applies only the next pick, and reverts to All when closed unpicked', () => {
    const { component } = setup();
    const reload = vi.spyOn(component as any, 'reloadPlacedPreviews').mockImplementation(() => undefined);
    Object.assign(component, { clusterOptions: ['Amal', 'GB', 'Nimr'], cluster: ['Amal', 'GB'] });
    component.openFilterName = 'tm_cluster';

    component.clearGlobalFilterSelection('cluster', new MouseEvent('click'));
    expect(component.isGlobalFilterCleared('cluster')).toBe(true);
    expect(component.cluster).toEqual(['Amal', 'GB']);
    expect(reload).not.toHaveBeenCalled();

    component.selectFilterOption('cluster', 'Nimr');
    expect(component.cluster).toBe('Nimr');
    expect(component.isGlobalFilterCleared('cluster')).toBe(false);

    component.openFilterName = 'tm_cluster';
    component.clearGlobalFilterSelection('cluster', new MouseEvent('click'));
    component.openFilterName = null;
    expect(component.cluster).toBe('All');
    expect(component.isGlobalFilterCleared('cluster')).toBe(false);
  });

  it('does not leave loading active when a chart has invalid saved JSON', () => {
    const { component } = setup();
    component.onChartVisible({
      id: 'bad-chart', title: 'Chart', description: '', chartType: 'line',
      source: 'WellView', sourceType: 'View', designJson: '{',
    });
    expect(component.isRefreshingPreviews).toBe(false);
  });

  it.each([
    [{ dashboardId: '42', name: 'Production & Safety' }, {}],
    [{ name: 'Production & Safety' }, { id: '42' }],
  ])('keeps the selected name while edit requests are pending', (query, route) => {
    const { component, dashboard, library, placedWidgets } = setup(query, route);
    expect(component.isEditMode).toBe(true);
    expect(component.pageName).toBe('Production & Safety');
    expect(component.tabs[0].label).toBe('Production & Safety');
    library.next({ tiles: [], charts: [] });
    library.complete();
    placedWidgets.next({ tiles: [], charts: [] });
    placedWidgets.complete();
    expect(component.pageName).toBe('Production & Safety');
    respond(dashboard, 'Production & Safety');
    expect(component.pageName).toBe('Production & Safety');
  });

  it.each([
    [{ dashboardId: '42' }, {}],
    [{}, { id: '42' }],
  ])('never uses Overview for a direct edit link', (query, route) => {
    const { component, dashboard } = setup(query, route);
    expect(component.pageName).toBe('');
    expect(component.tabs[0].label).toBe('');
    respond(dashboard, 'Saved Dashboard');
    expect(component.pageName).toBe('Saved Dashboard');
    expect(component.tabs[0].label).toBe('Saved Dashboard');
  });

  it('uses the authoritative name before either widget request completes', () => {
    const { component, dashboard, library, placedWidgets } = setup({ dashboardId: '42', name: 'Old Name' });
    respond(dashboard, 'Renamed Dashboard');
    expect(component.pageName).toBe('Renamed Dashboard');
    expect(component.tabs[0].label).toBe('Renamed Dashboard');
    library.next({ tiles: [], charts: [] });
    library.complete();
    expect(component.pageName).toBe('Renamed Dashboard');
    placedWidgets.next({ tiles: [], charts: [] });
    placedWidgets.complete();
    expect(component.pageName).toBe('Renamed Dashboard');
  });

  it('retains the selected name and surfaces a widget loading failure', () => {
    const { component, library } = setup({ dashboardId: '42', name: 'Saved Dashboard' });
    library.error(new Error('Widget loading failed'));
    expect(component.pageName).toBe('Saved Dashboard');
    expect(component.saveError).toBe('Widget loading failed');
  });

  it('retains Overview for a new dashboard', () => {
    const { component } = setup();
    expect(component.isEditMode).toBe(false);
    expect(component.pageName).toBe('Overview');
    expect(component.tabs[0].label).toBe('Overview');
  });

  it('retains a supplied name for a new dashboard', () => {
    const { component } = setup({ name: 'New Dashboard' });
    expect(component.isEditMode).toBe(false);
    expect(component.pageName).toBe('New Dashboard');
  });

  it('shows the shared loader until dashboard and widget contents have been applied', () => {
    const { component, dashboard, library, placedWidgets, fixture } = setup(
      { dashboardId: '42', name: 'Saved Dashboard' }, {}, true,
    );
    const loader = fixture.debugElement.query(By.directive(LoaderComponent));
    expect(loader.componentInstance.size).toBe('lg');
    expect(loader.attributes['role']).toBe('status');
    expect(fixture.debugElement.query(By.css('.builder-card')).attributes['aria-busy']).toBe('true');
    expect(fixture.debugElement.query(By.css('.builder-body'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.builder-toolbar__page-name-text')).nativeElement.textContent)
      .toBe('Saved Dashboard');
    const saveButtons = fixture.debugElement.queryAll(By.directive(ButtonComponent))
      .filter(button => button.nativeElement.textContent.includes('Update'));
    expect(saveButtons).toHaveLength(2);
    expect(saveButtons.every(button => button.componentInstance.disabled)).toBe(true);
    component.save();
    expect(component.saveError).toBe('');
    expect(component.isSaving).toBe(false);

    respond(dashboard, 'Saved Dashboard');
    library.next({ tiles: [], charts: [] });
    library.complete();
    fixture.detectChanges();
    expect(component.isLoadingDashboard).toBe(true);
    expect(fixture.debugElement.query(By.directive(LoaderComponent))).not.toBeNull();

    placedWidgets.next({ tiles: [], charts: [] });
    placedWidgets.complete();
    fixture.detectChanges();
    expect(component.isLoadingDashboard).toBe(false);
    expect(fixture.debugElement.query(By.directive(LoaderComponent))).toBeNull();
    expect(fixture.debugElement.query(By.css('.builder-body'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('.builder-card')).attributes['aria-busy']).toBe('false');
    expect(saveButtons.every(button => !button.componentInstance.disabled)).toBe(true);
  });

  it.each(['dashboard', 'library', 'placedWidgets'] as const)(
    'clears the loader and displays the error when %s fails',
    request => {
      const state = setup({ dashboardId: '42' }, {}, true);
      state[request].error(new Error('Dashboard loading failed'));
      state.fixture.detectChanges();
      expect(state.component.isLoadingDashboard).toBe(false);
      expect(state.fixture.debugElement.query(By.directive(LoaderComponent))).toBeNull();
      expect(state.fixture.debugElement.query(By.css('.board-toast--error')).nativeElement.textContent)
        .toContain('Dashboard loading failed');
    },
  );

  it('clears loading when the page is destroyed with requests pending', () => {
    const { component, fixture } = setup({ dashboardId: '42' });
    expect(component.isLoadingDashboard).toBe(true);
    fixture.destroy();
    expect(component.isLoadingDashboard).toBe(false);
  });

  it('does not show the edit loader for a new dashboard', () => {
    const { component, fixture } = setup({}, {}, true);
    expect(component.isLoadingDashboard).toBe(false);
    expect(fixture.debugElement.query(By.directive(LoaderComponent))).toBeNull();
    expect(fixture.debugElement.query(By.css('.builder-body'))).not.toBeNull();
  });

  it('opens the additional picker from the Filters modal and adds a selected view column', () => {
    const { component, fixture, sources, sourceData, getTableData } = setup({}, {}, true);
    component.selectPanel('filters');
    fixture.detectChanges();
    const button = fixture.debugElement.queryAll(By.css('button'))
      .find(element => element.nativeElement.textContent.trim() === 'Add additional filters +');
    expect(button).toBeDefined();
    button!.nativeElement.click();
    expect(component.additionalFilterSourcesLoading).toBe(true);
    sources.next([{ name: 'Production', sourceType: 'View', schemaName: 'dbo', columnCount: 1 }]);
    sources.complete();
    component.selectAdditionalFilterSource('Production');
    expect(getTableData).toHaveBeenCalledWith('Production', 'View');
    sourceData.next({ columns: ['Discipline'], rows: [{ Discipline: 'Civil' }] });
    sourceData.complete();
    component.additionalFilterColumn = 'Discipline';
    component.additionalFilterLabel = 'Trade';
    component.addAdditionalFilter();
    fixture.detectChanges();
    expect(component.customFilters).toEqual([{
      id: 'Production::Discipline', label: 'Trade', sourceTable: 'Production',
      sourceColumn: 'Discipline', additional: true, value: 'All',
    }]);
    expect(component.getFilterValues(component.customFilters[0])).toEqual(['Civil']);
    expect(getTableData).toHaveBeenCalledOnce();
    expect(component.showFiltersModal).toBe(true);
    expect(component.showAdditionalFilterForm).toBe(false);
    expect(fixture.debugElement.query(By.css('.add-filters-modal__additional'))).toBeNull();
    expect(button!.nativeElement.getAttribute('aria-expanded')).toBe('false');
    button!.nativeElement.click();
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.add-filters-modal__additional'))).not.toBeNull();
    component.additionalFilterColumn = 'Discipline';
    component.addAdditionalFilter();
    expect(component.customFilters).toHaveLength(1);
    expect(component.additionalFilterError).toContain('already added');
    expect(component.showAdditionalFilterForm).toBe(true);
  });

  it('validates additional source and column selection', () => {
    const { component } = setup();
    component.showAdditionalFilterForm = true;
    component.addAdditionalFilter();
    expect(component.customFilters).toEqual([]);
    expect(component.additionalFilterError).toContain('valid source and column');
    expect(component.showAdditionalFilterForm).toBe(true);
  });

  it('shows source loading failures and allows retry', () => {
    const { component, sources } = setup();
    component.openAdditionalFilters();
    sources.error(new Error('Offline'));
    expect(component.additionalFilterSourcesLoading).toBe(false);
    expect(component.additionalFilterError).toContain('Failed to load filter sources');
    vi.spyOn(TestBed.inject(WidgetService), 'getBISources').mockReturnValue(of([
      { name: 'Plants', sourceType: 'Table', schemaName: 'dbo', columnCount: 1 },
    ]));
    component.retryAdditionalFilterLoading();
    expect(component.additionalFilterError).toBe('');
    expect(component.additionalFilterSources[0].name).toBe('Plants');
  });

  it('shows column loading failures and retries the selected source', () => {
    const { component, sources, sourceData } = setup();
    component.openAdditionalFilters();
    sources.next([{ name: 'Plants', sourceType: 'Table', schemaName: 'dbo', columnCount: 1 }]);
    sources.complete();
    component.selectAdditionalFilterSource('Plants');
    sourceData.error(new Error('Offline'));
    expect(component.additionalFilterColumnsLoading).toBe(false);
    expect(component.additionalFilterError).toContain('Failed to load filter columns');
    vi.spyOn(TestBed.inject(WidgetService), 'getTableData').mockReturnValue(of({
      columns: ['Region'], rows: [],
    }));
    component.retryAdditionalFilterLoading();
    expect(component.additionalFilterColumns).toEqual(['Region']);
    expect(component.additionalFilterError).toBe('');
  });

  it('cancels previous column requests when the source changes', () => {
    const { component, sources, sourceData } = setup();
    component.openAdditionalFilters();
    sources.next([
      { name: 'First', sourceType: 'Table', schemaName: 'dbo', columnCount: 1 },
      { name: 'Second', sourceType: 'Table', schemaName: 'dbo', columnCount: 1 },
    ]);
    sources.complete();
    component.selectAdditionalFilterSource('First');
    expect(sourceData.observed).toBe(true);
    component.selectAdditionalFilterSource('');
    expect(sourceData.observed).toBe(false);
    expect(component.additionalFilterColumnsLoading).toBe(false);
    expect(component.additionalFilterColumn).toBe('');
  });

  it('persists additional definitions without persisting current selections', () => {
    const { component, createDashboard } = setup();
    component.apiCategories = [{ categoryId: 7, categoryName: 'Energy' }];
    component.category = 'Energy';
    component.dashboardDescription = 'Description';
    component.customFilters = [{
      id: 'Plants::Region', label: 'Region', sourceTable: 'Plants',
      sourceColumn: 'Region', additional: true, value: 'North',
    }];
    component.save();
    expect(createDashboard).toHaveBeenCalledOnce();
    expect(createDashboard).toHaveBeenCalledWith(expect.objectContaining({
      configJson: expect.stringContaining('"additional":true'),
    }));
    const request = TestBed.inject(DashboardService);
    expect(request.createDashboard).toHaveBeenCalledWith(expect.objectContaining({
      configJson: expect.not.stringContaining('"value":"North"'),
    }));
  });

  it('restores additional filter metadata when dashboard details load', () => {
    const { component, dashboard, library, placedWidgets } = setup({ dashboardId: '42' });
    library.next({ tiles: [], charts: [] });
    library.complete();
    placedWidgets.next({ tiles: [], charts: [] });
    placedWidgets.complete();
    dashboard.next({
      data: {
        dashboardId: 42, dashboardName: 'Saved', categoryId: 1, categoryName: 'Energy',
        status: 'Draft', isActive: true, isLatestVersion: true,
        configJson: JSON.stringify({ customFilters: [{
          id: 'Plants::Region', label: 'Region', sourceTable: 'Plants', sourceColumn: 'Region', additional: true,
        }] }),
      }, success: true, statusCode: 200, message: '',
    });
    dashboard.complete();
    expect(component.customFilters[0]).toEqual({
      id: 'Plants::Region', label: 'Region', sourceTable: 'Plants',
      sourceColumn: 'Region', additional: true, value: 'All',
    });
  });

  it.each(['bar', 'table', 'gauge', 'treemap'])(
    'renders the existing no-data illustration for an empty additional-filter result on %s',
    chartType => {
      const { component, fixture, sourceData } = setup({}, {}, true);
      const chart: ChartSelectorItem = {
        id: '42', title: 'Production', description: '', source: 'Production', sourceType: 'Table',
        chartType, designJson: JSON.stringify({ chartType, xAxis: 'Name', yAxis: 'Value' }),
      };
      component.chartSlotsData = [chart];
      component.customFilters = [{
        id: 'Plants::Region', label: 'Region', sourceTable: 'Plants',
        sourceColumn: 'Region', additional: true, value: 'North',
      }];
      component['syncUnifiedLayout']();
      component.onChartVisible(chart);
      sourceData.next({ columns: ['Name', 'Value'], rows: [] });
      fixture.detectChanges();
      expect(component.chartAdditionalFilterNoData[chart.id]).toBe(true);
      expect(fixture.debugElement.query(By.directive(ChartNoDataComponent))).not.toBeNull();
      expect(fixture.debugElement.query(By.css('highcharts-chart'))).toBeNull();
      expect(fixture.debugElement.query(By.css('app-advanced-chart'))).toBeNull();
      expect(fixture.debugElement.query(By.css('app-chart-table'))).toBeNull();

      component.customFilters[0].value = 'All';
      component['loadedChartPreviewIds'].delete(chart.id);
      component.onChartVisible(chart);
      sourceData.next({ columns: ['Name', 'Value'], rows: [{ Name: 'Plant A', Value: 2 }] });
      fixture.detectChanges();
      expect(component.chartAdditionalFilterNoData[chart.id]).toBe(false);
      expect(fixture.debugElement.query(By.directive(ChartNoDataComponent))).toBeNull();
    },
  );
});

describe('edit dashboard navigation', () => {
  const board: StandardBoard & WipBoard = {
    id: '42', title: 'Production & Safety', description: '', category: 'Energy',
    chartCount: 0, modifiedLabel: '', modifiedDate: '', favorite: false,
    recentlyViewed: false, status: 'Draft', isActive: true, draft: true,
    accent: 'purple', icon: 'gauge',
  };

  it.each([
    ['WIP boards', WipBoardsComponent],
    ['standard boards', StandardBoardsComponent],
  ] as const)('passes the selected name from %s', (_label, ComponentType) => {
    const component: WipBoardsComponent | StandardBoardsComponent = Object.create(ComponentType.prototype);
    const navigate = vi.fn();
    Object.assign(component, { router: { navigate } });
    component.editBoard(board);
    expect(navigate).toHaveBeenCalledWith(['/dashboard/builder'], {
      queryParams: { dashboardId: '42', name: 'Production & Safety' },
    });
  });

  it('passes the selected name and return URL from dashboard view', () => {
    const component: OperationsDashboardComponent = Object.create(OperationsDashboardComponent.prototype);
    const navigate = vi.fn();
    Object.assign(component, {
      board, isAnonymousShareView: false,
      router: { navigate, url: '/dashboard/operations-dashboard/42?from=wip' },
    });
    component.editInBuilder();
    expect(navigate).toHaveBeenCalledWith(['/dashboard/builder', '42'], {
      queryParams: { name: 'Production & Safety', returnUrl: '/dashboard/operations-dashboard/42?from=wip' },
    });
  });
});
