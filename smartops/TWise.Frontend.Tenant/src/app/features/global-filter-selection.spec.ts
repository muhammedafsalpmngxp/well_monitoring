import { describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { ChartBuilderComponent } from './charts-tiles/chart-builder/chart-builder.component';
import { TileBuilderComponent } from './charts-tiles/tile-builder/tile-builder.component';
import { ChartDrilldownComponent } from './charts-tiles/chart-drilldown/chart-drilldown.component';
import { WidgetViewComponent } from './charts-tiles/widget-view/widget-view.component';
import { ReportBuilderComponent } from './reports/report-builder/report-builder.component';
import { ReportViewerComponent } from './reports/report-viewer/report-viewer.component';
import { BoardBuilderComponent } from './dashboard/board-builder/board-builder.component';
import { BoardBuilderTestComponent } from './dashboard/board-builder-test/board-builder-test.component';
import { DashboardBuilderComponent } from './dashboard/dashboard-builder/dashboard-builder.component';
import { OperationsDashboardComponent } from './dashboard/operations-dashboard/operations-dashboard.component';
import { ActivityBreakdownComponent } from './dashboard/activity-breakdown/activity-breakdown.component';
import { ActivityLogComponent } from './agentic-ai/activity-log/activity-log.component';
import type { GlobalFilterSelection } from '../core/utils/global-filter-selection.util';

interface FilterPage {
  openFilterName: string | null;
  openGlobalFilterName: string | null;
  filterValues: Record<string, GlobalFilterSelection>;
  filterPlant: GlobalFilterSelection;
  plant: GlobalFilterSelection;
  selectFilterOption(name: string, value: string): void;
  selectGlobalFilterOption(name: string, value: string): void;
}

const pages = [
  { name: 'Chart Builder', prototype: ChartBuilderComponent.prototype, builder: true, state: 'filterValues' },
  { name: 'Tile Builder', prototype: TileBuilderComponent.prototype, builder: true, state: 'filterValues' },
  { name: 'Chart Drilldown', prototype: ChartDrilldownComponent.prototype, state: 'filterValues' },
  { name: 'Widget View', prototype: WidgetViewComponent.prototype, state: 'filterValues' },
  { name: 'Report Builder', prototype: ReportBuilderComponent.prototype, state: 'filterValues' },
  { name: 'Report Viewer', prototype: ReportViewerComponent.prototype, state: 'filterPlant' },
  { name: 'Board Builder', prototype: BoardBuilderComponent.prototype, state: 'plant' },
  { name: 'Test Board Builder', prototype: BoardBuilderTestComponent.prototype, state: 'plant' },
  { name: 'Dashboard Builder', prototype: DashboardBuilderComponent.prototype, state: 'plant' },
  { name: 'Operations Dashboard', prototype: OperationsDashboardComponent.prototype, state: 'filterPlant' },
  { name: 'Activity Breakdown', prototype: ActivityBreakdownComponent.prototype, state: 'filterPlant' },
];

describe('Global filter dropdowns collapse immediately after selection', () => {
  it.each(pages)('$name closes before reloading and retains multi-select values', page => {
    const openKey = page.builder ? 'openGlobalFilterName' : 'openFilterName';
    const assertClosed = vi.fn(() => expect(component[openKey]).toBeNull());
    const component: FilterPage = Object.assign(Object.create(page.prototype), {
      openFilterName: 'plant', openGlobalFilterName: 'plant',
      filterValues: { plant: 'All' }, filterPlant: 'All', plant: 'All',
      filterFields: [{ key: 'plant' }], dataSourceMode: 'view',
      cdr: { markForCheck: vi.fn() }, isGlobalFilterLocked: () => false,
      rebuildGlobalFilterOptions: vi.fn(), rebuildCascadingOptions: vi.fn(),
      reloadGlobalViewPreview: assertClosed, applyGlobalFilter: assertClosed,
      refreshGlobalFilterData: assertClosed, reloadPlacedPreviews: assertClosed,
      onClusterChange: assertClosed, persistEditorDraft: vi.fn(), persistFilterState: vi.fn(),
      hydrateBreakdownValues: vi.fn(), computeTileValue: vi.fn(),
    });
    const select = (value: string) => page.builder
      ? component.selectGlobalFilterOption('plant', value)
      : component.selectFilterOption('plant', value);
    const selected = () => page.state === 'filterValues'
      ? component.filterValues['plant']
      : page.state === 'filterPlant' ? component.filterPlant : component.plant;

    select('Amal');
    expect(component[openKey]).toBeNull();
    expect(selected()).toBe('Amal');
    component[openKey] = 'plant';
    select('Nimr');
    expect(component[openKey]).toBeNull();
    expect(selected()).toEqual(['Amal', 'Nimr']);
    component[openKey] = 'plant';
    select('Amal');
    expect(component[openKey]).toBeNull();
    expect(selected()).toBe('Nimr');
    component[openKey] = 'plant';
    select('All');
    expect(component[openKey]).toBeNull();
    expect(selected()).toBe('All');
  });

  it('closes Chart Details while the data request is still pending', () => {
    const response = new Subject<{ columns: string[]; rows: Record<string, unknown>[] }>();
    const component: WidgetViewComponent = Object.assign(Object.create(WidgetViewComponent.prototype), {
      openFilterName: 'plant', filterValues: { plant: 'All' }, filterFields: [{ key: 'plant' }],
      isGlobalFilterLocked: () => false, rebuildGlobalFilterOptions: vi.fn(),
      design: {}, viewSql: 'SELECT 1', viewConnectionId: 7,
      cancelGlobalFilter$: new Subject<void>(), destroy$: new Subject<void>(),
      commonApi: { previewView: () => response },
      cdr: { markForCheck: vi.fn() },
      injectDateParams: (sql: string) => sql, globalHierarchyFilterPayload: () => [],
      applyLoadedData: vi.fn(), reapplyActiveLocalFilters: vi.fn(),
      rebuildChart: vi.fn(), reloadInlineTilesForGlobal: vi.fn(),
    });
    component.selectFilterOption('plant', 'Amal');
    expect(component.loading).toBe(true);
    expect(component.openFilterName).toBeNull();
    // A response must not close a dropdown the user has deliberately reopened.
    component.openFilterName = 'plant';
    response.next({ columns: [], rows: [] });
    expect(component.openFilterName).toBe('plant');
  });

  it('closes Activity Log after each toggle without losing previous selections', () => {
    const component = new ActivityLogComponent();
    for (const option of ['Amal', 'Nimr']) {
      component.openGlobalFilter = 'plant';
      component.toggleGlobalFilter('plant', option);
      expect(component.openGlobalFilter).toBeNull();
    }
    expect(component.filterPlant).toEqual(['Amal', 'Nimr']);
    component.openGlobalFilter = 'plant';
    component.clearGlobalFilter('plant');
    expect(component.openGlobalFilter).toBeNull();
    expect(component.filterPlant).toBe('All');
  });
});
