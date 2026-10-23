import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of, Subject } from 'rxjs';
import type { PreviewViewRequest } from '../core/services/common-api.service';
import type { WidgetDataFilter } from '../core/services/widget.service';
import { advancedHierarchyFilters } from '../core/utils/advanced-hierarchy-filter.util';
import { WidgetViewComponent } from './charts-tiles/widget-view/widget-view.component';
import { OperationsDashboardComponent } from './dashboard/operations-dashboard/operations-dashboard.component';
import { ChartBuilderComponent } from './charts-tiles/chart-builder/chart-builder.component';
import { TileBuilderComponent } from './charts-tiles/tile-builder/tile-builder.component';
import { ChartDrilldownComponent } from './charts-tiles/chart-drilldown/chart-drilldown.component';
import { BoardBuilderComponent } from './dashboard/board-builder/board-builder.component';
import { DashboardBuilderComponent } from './dashboard/dashboard-builder/dashboard-builder.component';
import { BoardBuilderTestComponent } from './dashboard/board-builder-test/board-builder-test.component';
import { ReportBuilderComponent } from './reports/report-builder/report-builder.component';
import { ReportViewerComponent } from './reports/report-viewer/report-viewer.component';

const selection = { wellId: '', hierarchy: { 'resource-type': ['SubContractor'] } };

describe('advanced hierarchy filters use view SQL independently of local filters', () => {
  it('synchronizes widget-view local filters with matching advanced hierarchy values', () => {
    const applyGlobalFilter = vi.fn();
    const component: WidgetViewComponent = Object.assign(Object.create(WidgetViewComponent.prototype), {
      filters: [
        { id: 1, sourceColumn: 'ATNM_SC', controlType: 'MultiSelect', values: ['Old'], locked: false },
        { id: 2, sourceColumn: 'Resource Type', controlType: 'Dropdown', value: 'Old', locked: false },
        { id: 3, sourceColumn: 'Resource_Type', controlType: 'MultiSelect', values: ['Locked'], locked: true },
        { id: 4, sourceColumn: 'Department', controlType: 'MultiSelect', values: ['Finance'], locked: false },
      ],
      applyGlobalFilter,
    });

    component.applyAdvancedFilter({ wellId: '', hierarchy: { 'resource-type': ['ATNM', 'SubContractor'] } });

    expect(component.filters[0].values).toEqual(['ATNM', 'SubContractor']);
    expect(component.filters[1].value).toBe('');
    expect(component.filters[2].values).toEqual(['Locked']);
    expect(component.filters[3].values).toEqual(['Finance']);
    expect(applyGlobalFilter).toHaveBeenCalledOnce();

    component.applyAdvancedFilter({ wellId: '', hierarchy: { 'resource-type': [] } });
    expect(component.filters[0].values).toEqual([]);
  });

  it('sends Advanced Filters in real chart editor reloads and ignores a superseded response', () => {
    const component: ChartBuilderComponent = Object.create(ChartBuilderComponent.prototype);
    const pending = new Subject<{ columns: string[]; rows: Record<string, unknown>[] }>();
    const getFilteredChartData = vi.fn((_request: { filters: WidgetDataFilter[] }) => pending);
    const applyRows = vi.fn();
    Object.assign(component, {
      dataSourceMode: 'view', selectedViewId: 7, selectedChartModelId: 'CrewView',
      availableViews: [{ id: 7, viewName: 'CrewView' }], selectedChartType: 'pie',
      attachedTileIds: [], availableTiles: [], interactiveFilters: [], filterValues: {}, viewDateParameters: new Map(),
      sourceLoadVersion: 0, widgetService: { getFilteredChartData },
      destroy$: new Subject<void>(), applyParameterDrivenTransformations: applyRows,
      cdr: { detectChanges: vi.fn() },
    });

    const multipleResourceSelection = { wellId: '', hierarchy: { 'resource-type': ['SubContractor', 'ATNM'] } };
    component.applyAdvancedFilter(multipleResourceSelection);
    component.applyAdvancedFilter({ wellId: '', hierarchy: {} });
    expect(getFilteredChartData.mock.calls[0][0].filters).toEqual(advancedHierarchyFilters(multipleResourceSelection.hierarchy));
    expect(getFilteredChartData.mock.calls[1][0].filters).toEqual([]);
    pending.next({ columns: ['Total'], rows: [{ Total: 42 }] });
    expect(applyRows).toHaveBeenCalledOnce();
  });

  it('sends Advanced Filters in real tile editor previews and drops them when cleared', () => {
    const component: TileBuilderComponent = Object.create(TileBuilderComponent.prototype);
    const previewView = vi.fn((_request: PreviewViewRequest) => of({ columns: ['Total'], rows: [{ Total: 7 }] }));
    Object.assign(component, {
      dataSourceMode: 'view', currentViewDetail: { id: 7, connectionId: 1, generatedSql: 'SELECT COUNT(*) AS Total FROM Crew' },
      filterValues: {}, breakdownRows: [], commonApi: { previewView }, computeTileValue: vi.fn(),
      cdr: { markForCheck: vi.fn() },
    });
    component.applyAdvancedFilter(selection);
    expect(previewView.mock.calls[0][0].filters).toEqual(advancedHierarchyFilters(selection.hierarchy));
    component.applyAdvancedFilter({ wellId: '', hierarchy: {} });
    expect(previewView.mock.calls[1][0].filters).toEqual([]);
  });

  it('includes the report viewer selection in the request used for sheets and exports', async () => {
    const component: ReportViewerComponent = Object.create(ReportViewerComponent.prototype);
    const view = { id: 7, viewName: 'CrewView', connectionId: 1, generatedSql: 'SELECT COUNT(*) AS Total FROM Crew', manualSql: '' };
    const previewView = vi.fn((_request: PreviewViewRequest) => of({ columns: ['Total'], rows: [{ Total: 7 }] }));
    Object.assign(component, {
      applyGlobalFilter: vi.fn(),
      commonApi: { getDatabaseViews: () => of([view]), getDatabaseViewById: () => of(view), previewView },
    });
    component.applyAdvancedFilter(selection);
    await firstValueFrom(component['loadViewData']('CrewView'));
    expect(previewView.mock.calls[0][0].filters).toEqual(advancedHierarchyFilters(selection.hierarchy));
  });

  it.each(['chart', 'tile'] as const)('reloads the %s editor and sends selections only to view requests', editor => {
    const component = editor === 'chart'
      ? Object.create(ChartBuilderComponent.prototype) as ChartBuilderComponent
      : Object.create(TileBuilderComponent.prototype) as TileBuilderComponent;
    const reload = vi.fn();
    Object.assign(component, { dataSourceMode: 'view', filterValues: {}, reloadGlobalViewPreview: reload, hydrateBreakdownValues: vi.fn() });
    const payload = component instanceof ChartBuilderComponent
      ? component['globalHierarchyFilterPayload'].bind(component)
      : component['globalHierarchyFilterPayload'].bind(component);

    component.applyAdvancedFilter(selection);
    expect(reload).toHaveBeenCalledOnce();
    expect(payload()).toEqual([
      expect.objectContaining({ advancedHierarchy: 'resource-type', values: ['SubContractor'] }),
    ]);
    expect(payload(false)).toEqual([]);

    Object.assign(component, { dataSourceMode: 'table' });
    expect(payload()).toEqual([]);
    expect(payload(true)).toHaveLength(1);

    component.applyAdvancedFilter({ wellId: '', hierarchy: {} });
    expect(payload(true)).toEqual([]);
  });

  it.each(['board', 'dashboard'] as const)('reloads %s editor previews and keeps single selections in preview payloads', editor => {
    const component = editor === 'board'
      ? Object.create(BoardBuilderComponent.prototype) as BoardBuilderComponent
      : Object.create(DashboardBuilderComponent.prototype) as DashboardBuilderComponent;
    const other = editor === 'board'
      ? Object.create(BoardBuilderComponent.prototype) as BoardBuilderComponent
      : Object.create(DashboardBuilderComponent.prototype) as DashboardBuilderComponent;
    const reload = vi.fn();
    Object.assign(component, {
      reloadPlacedPreviews: reload, standardCharts: [], myCharts: [], standardTiles: [], myTiles: [],
      loadedChartPreviewIds: new Set(), tilePreviewRequests: new Map(),
    });
    const payload = component instanceof BoardBuilderComponent
      ? component['globalHierarchyFilterPayload'].bind(component)
      : component['globalHierarchyFilterPayload'].bind(component);
    const otherPayload = other instanceof BoardBuilderComponent
      ? other['globalHierarchyFilterPayload'].bind(other)
      : other['globalHierarchyFilterPayload'].bind(other);

    component.applyAdvancedFilter(selection);
    expect(reload).toHaveBeenCalledOnce();
    expect(payload(true)).toEqual([
      expect.objectContaining({ advancedHierarchy: 'resource-type', values: ['SubContractor'] }),
    ]);
    expect(payload(false)).toEqual([]);
    expect(otherPayload(true)).toEqual([]);
    if (component instanceof DashboardBuilderComponent) {
      expect(component['globalPreviewFilters'](7)).toHaveLength(1);
    } else {
      const previewView = vi.fn().mockReturnValue(of({ columns: [], rows: [] }));
      Object.assign(component, { commonApi: { previewView } });
      component['previewViewWithGlobalFilters']({ connectionId: 1, sql: 'SELECT 1', viewId: 7, maxRows: 1000 });
      expect(previewView.mock.calls[0][0].filters).toHaveLength(1);
    }

    component.applyAdvancedFilter({ wellId: '', hierarchy: {} });
    expect(payload(true)).toEqual([]);
  });

  it('reloads Board Builder Test without reusing its cached previews', () => {
    const component: BoardBuilderTestComponent = Object.create(BoardBuilderTestComponent.prototype);
    const chart = { id: 'chart', title: 'Chart', source: 'Crew', sourceType: 'View', chartType: 'pie' };
    const tile = { id: 'tile', designJson: '{}', title: 'Tile', value: '42' };
    const cancel = new Subject<void>();
    const cancelled = vi.fn();
    cancel.subscribe(cancelled);
    Object.assign(component, {
      advancedFilterReload$: cancel, loadedChartPreviewIds: new Set(['chart']),
      tilePreviewRequests: new Map([[JSON.stringify([tile.id, tile.designJson]), of('42')]]),
      standardCharts: [chart], myCharts: [], standardTiles: [tile], myTiles: [], boardItems: [],
      loadChartPreview: vi.fn(), loadTilePreview: vi.fn(),
    });
    component.applyAdvancedFilter(selection);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(component['loadChartPreview']).toHaveBeenCalledWith(chart);
    expect(component['loadTilePreview']).toHaveBeenCalledWith(tile);
    expect(component['tilePreviewRequests'].size).toBe(0);
  });

  it('requeries drill-down view data with its page-local selections', () => {
    const component: ChartDrilldownComponent = Object.create(ChartDrilldownComponent.prototype);
    Object.assign(component, { viewIdForPreview: 7, filterValues: {}, applyGlobalFilter: vi.fn() });
    component.applyAdvancedFilter(selection);
    expect(component['applyGlobalFilter']).toHaveBeenCalledOnce();
    expect(component['globalHierarchyFilterPayload']()).toEqual([
      expect.objectContaining({ advancedHierarchy: 'resource-type', values: ['SubContractor'] }),
    ]);
    component.applyAdvancedFilter({ wellId: '', hierarchy: {} });
    expect(component['globalHierarchyFilterPayload']()).toEqual([]);
  });

  it.each(['editor', 'viewer'] as const)('reloads the report %s with independent Advanced Filter state', page => {
    const reload = vi.fn();
    if (page === 'editor') {
      const component: ReportBuilderComponent = Object.create(ReportBuilderComponent.prototype);
      Object.assign(component, { refreshGlobalFilterData: reload });
      component.applyAdvancedFilter(selection);
      expect(component['advancedFilters']).toEqual(advancedHierarchyFilters(selection.hierarchy));
      component.applyAdvancedFilter({ wellId: '', hierarchy: {} });
      expect(component['advancedFilters']).toEqual([]);
    } else {
      const component: ReportViewerComponent = Object.create(ReportViewerComponent.prototype);
      Object.assign(component, { applyGlobalFilter: reload });
      component.applyAdvancedFilter(selection);
      expect(component['advancedFilters']).toEqual(advancedHierarchyFilters(selection.hierarchy));
      component.applyAdvancedFilter({ wellId: '', hierarchy: {} });
      expect(component['advancedFilters']).toEqual([]);
    }
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it.each(['chart', 'dashboard'] as const)('keeps advanced and local restrictions on the same breakdown column in %s', viewer => {
    const getBreakdownValueFiltered = vi.fn().mockReturnValue(of(5));
    const local = {
      sourceTable: 'Crew', sourceColumn: 'resource_type', controlType: 'Dropdown',
      value: 'ATNM', values: [], label: 'resource_type',
    };
    const component = viewer === 'chart'
      ? Object.create(WidgetViewComponent.prototype) as WidgetViewComponent
      : Object.create(OperationsDashboardComponent.prototype) as OperationsDashboardComponent;
    Object.assign(component, {
      advancedFilters: advancedHierarchyFilters(selection.hierarchy),
      viewIdForPreview: 7,
      filterValues: {},
      filters: [local],
      commonApi: { getBreakdownValueFiltered },
      destroy$: new Subject<void>(),
      cdr: { detectChanges: vi.fn(), markForCheck: vi.fn() },
    });
    const target = [{ label: 'Total', value: '', color: '' }];
    const definitions = [{ sourceName: 'CrewView', sourceType: 'View', column: 'Total' }];
    if (component instanceof WidgetViewComponent) {
      component['hydrateBreakdownValues'](target, definitions);
    } else {
      component['hydrateBreakdown'](target, definitions, [local]);
    }

    expect(getBreakdownValueFiltered).toHaveBeenCalledOnce();
    expect(getBreakdownValueFiltered.mock.calls[0][0].filters).toEqual([
      expect.objectContaining({ sourceColumn: 'resource_type', value: 'ATNM' }),
      expect.objectContaining({ advancedHierarchy: 'resource-type', values: ['SubContractor'] }),
    ]);
    expect(target[0].value).toBe('5');
  });

  it('reloads Chart Details with a source-column filter and leaves local controls unchanged', () => {
    const component: WidgetViewComponent = Object.create(WidgetViewComponent.prototype);
    const localFilters = [{
      id: 1, label: 'Resources', sourceColumn: 'unrelated_column', sourceTable: 'Crew',
      controlType: 'Dropdown', value: 'Original', values: [], options: ['SubContractor'], dateFrom: '', dateTo: '',
    }];
    Object.assign(component, { filters: localFilters, viewIdForPreview: 7, filterValues: {} });
    component['applyGlobalFilter'] = vi.fn();

    component.applyAdvancedFilter(selection);

    expect(component['applyGlobalFilter']).toHaveBeenCalledOnce();
    expect(component['globalHierarchyFilterPayload']()).toEqual([
      expect.objectContaining({ advancedHierarchy: 'resource-type', sourceColumn: 'resource_type', values: ['SubContractor'] }),
    ]);
    expect(localFilters[0]).toMatchObject({ controlType: 'Dropdown', value: 'Original', sourceColumn: 'unrelated_column' });

    component.applyAdvancedFilter({ wellId: '', hierarchy: {} });
    expect(component['globalHierarchyFilterPayload']()).toEqual([]);
    expect(localFilters[0].value).toBe('Original');
  });

  it('reloads dashboard view-backed cards even when they have no local controls', () => {
    const component: OperationsDashboardComponent = Object.create(OperationsDashboardComponent.prototype);
    const localFilters = [{ label: 'Resources', sourceColumn: 'unrelated', controlType: 'Dropdown', value: 'Original' }];
    Object.assign(component, {
      cancelReload$: new Subject<void>(),
      chartCards: [
        { design: { viewId: 7 }, localFilters: [] },
        { design: { viewId: 8 }, localFilters },
        { design: { sourceType: 'Table' }, localFilters: [] },
      ],
    });
    component['reloadCardData'] = vi.fn();
    component['reloadKpiTiles'] = vi.fn();

    component.applyAdvancedFilter(selection);

    expect(component['reloadCardData']).toHaveBeenCalledTimes(2);
    expect(component['reloadKpiTiles']).toHaveBeenCalledOnce();
    expect(component['reloadCardData']).toHaveBeenCalledWith(0);
    expect(component['reloadCardData']).toHaveBeenCalledWith(1);
    expect(component['globalPreviewFilters'](7)).toEqual([
      expect.objectContaining({ advancedHierarchy: 'resource-type', values: ['SubContractor'] }),
    ]);
    expect(component['globalHierarchyFilterPayload'](null)).toEqual([]);
    expect(localFilters[0].value).toBe('Original');

    component.applyAdvancedFilter({ wellId: '', hierarchy: {} });
    expect(component['globalPreviewFilters'](7)).toEqual([]);
    expect(component['reloadCardData']).toHaveBeenCalledTimes(4);
  });
});
