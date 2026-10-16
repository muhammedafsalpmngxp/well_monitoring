import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject } from 'rxjs';
import { ChartBuilderComponent } from './chart-builder.component';

describe('Chart builder working state', () => {
  function createBuilder(userId = 1, tenantId = 7, chartId: string | null = null) {
    const component = Object.assign(Object.create(ChartBuilderComponent.prototype), {
      authService: { getCurrentUser: () => ({ userId, tenantId }) },
      route: { snapshot: {
        paramMap: { get: () => chartId },
        queryParamMap: { get: (key: string) => key === 'name' ? 'Import Chart' : null },
      } },
      router: { navigateByUrl: vi.fn() },
      returnUrl: '/charts-tiles/wip-charts',
      cdr: { markForCheck: vi.fn() }, destroy$: new Subject<void>(),
      tabs: [{ id: 'chart-1', label: 'Chart' }], activeTabId: 'chart-1', nextTabIndex: 2,
      tabStates: new Map(), savedChartIds: new Map(), sourceModeStates: new Map(), chartTypeStates: new Map(),
      sourceLoadVersion: 0, nextFilterId: 1, draftReady: true, discardDraftOnExit: false,
      savedDraftBaseline: '', selectedCategoryId: 2, category: 'Charts',
      chartModels: [{ id: 'Wells', label: 'Wells', modelType: 'Table' }],
      chartTypes: [{ id: 'table', widgetLibraryId: 1 }, { id: 'bar', widgetLibraryId: 2 }],
      // Built from the prototype, so the component's own field initialisers never run.
      // selectChartType reads this to tell an aggregation from a stale column name.
      yAxisFunctions: [
        { value: 'Count (F)', label: 'Count', requiresColumn: false, allowsColumn: false, requiresNumeric: false },
        { value: 'Sum (F)', label: 'Sum', requiresColumn: true, allowsColumn: true, requiresNumeric: true },
      ],
      importedChartModels: [{ id: '16', label: 'Sample Import', modelType: 'Import' }],
      availableImportDatasets: [{ id: 16, datasetName: 'Sample Import' }],
      availableViews: [{ id: 3, viewName: 'WellView' }], drillDownViews: [],
      filterValues: { country: 'Oman', cluster: 'Cluster A', plant: 'Plant A' }, fromDate: '2026-01-01', toDate: '2026-09-15',
      quickRange: 'Last Month', filterFields: Array.from({ length: 6 }, (_, index) => ({ options: index === 0 ? ['Oman'] : [] })),
      allPlants: [
        { country: 'Oman', sector: 'Construction Services', businessUnit: 'Energy', division: 'Oilfield Projects', cluster: 'North', plantDescription: 'Plant A' },
        { country: 'Oman', sector: 'Construction Services', businessUnit: 'Energy', division: 'Oilfield Projects', cluster: 'South', plantDescription: 'Plant B' },
      ],
      xAxisSearch: '', yAxisSearch: '', openSections: new Set([1]), undoStack: [], redoStack: [],
      selectedDaxColumns: [],
      loadColumnsForSource: vi.fn(), refreshPreview: vi.fn(),
      createDefaultDaxModel: () => ({ schemaVersion: 1, enabled: false, measures: [], selectedMeasureId: null }),
      cloneDaxModel: (model: unknown) => structuredClone(model), syncDaxSelectionFromModel: vi.fn(),
    }) as ChartBuilderComponent;
    component['resetChartState']();
    Object.assign(component, {
      chartTitle: 'Imported Chart', chartDescription: 'Working draft', selectedChartModelId: '16',
      dataSourceMode: 'import', selectedChartType: 'table', selectedLibraryId: 1,
      xAxis: 'WellName', yAxis: '', multiYColumns: ['WellName', 'Depth'],
    });
    component['draftStorageKey'] = component['getDraftStorageKey']();
    return component;
  }

  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('reloads imported preview rows on Undo and ignores the response after Redo', () => {
    const component = createBuilder();
    const response = new Subject<{ columns: string[]; rows: Record<string, unknown>[] }>();
    const getTableData = vi.fn(() => response);
    Object.assign(component, { widgetService: { getTableData } });
    component['loadColumnsForSource'] = ChartBuilderComponent.prototype['loadColumnsForSource'];
    component['applyPreviewFilters'] = vi.fn();
    const data = { columns: ['WellName', 'Depth'], rows: [{ WellName: 'Well-A101', Depth: 3200 }] };
    component['rawLoadedColumns'] = data.columns;
    component['rawLoadedRows'] = data.rows;
    component.tableRows = data.rows;

    component.switchDataSourceMode('table');
    component.undo();
    expect(getTableData).toHaveBeenCalledWith('16', 'Import');
    response.next(data);
    expect(component.selectedChartModelId).toBe('16');
    expect(component.tableRows).toEqual(data.rows);
    expect(component.xAxis).toBe('WellName');
    expect(component.multiYColumns).toEqual(['WellName', 'Depth']);

    component.redo();
    expect(component.dataSourceMode).toBe('table');
    expect(component.selectedChartModelId).toBe('');
    expect(component.tableRows).toEqual([]);
    component.undo();
    component.redo();
    response.next(data);
    expect(component.tableRows).toEqual([]);
    expect(component['rawLoadedRows']).toEqual([]);
  });

  it('keeps same-source Undo local without reloading data', () => {
    const component = createBuilder();
    component['applyPreviewFilters'] = vi.fn();
    const rows = [{ WellName: 'Well-A101', Depth: 3200 }];
    component['rawLoadedColumns'] = ['WellName', 'Depth'];
    component['rawLoadedRows'] = rows;
    component.tableRows = rows;
    component.pushUndo();
    component.chartTitle = 'Changed title';
    component.undo();
    expect(component.chartTitle).toBe('Imported Chart');
    expect(component.tableRows).toEqual(rows);
    expect(component['loadColumnsForSource']).not.toHaveBeenCalled();
  });

  it('restores the import selection and settings after switching sources', () => {
    const component = createBuilder();
    component.switchDataSourceMode('table');
    component.selectedChartModelId = 'Wells';
    component.switchDataSourceMode('import');
    expect(component.selectedChartModelId).toBe('16');
    expect(component.multiYColumns).toEqual(['WellName', 'Depth']);
    expect(component['loadColumnsForSource']).toHaveBeenLastCalledWith(
      { name: '16', sourceType: 'Import' }, { xAxis: 'WellName', yAxis: '', yAggColumn: '' },
    );
    component.switchDataSourceMode('table');
    expect(component.selectedChartModelId).toBe('Wells');
  });

  it('restores table and bar axis selections independently', () => {
    const component = createBuilder();
    component.xAxisOptions = ['WellName', 'Depth', 'Status'];
    component.yAxisColumns = ['WellName', 'Depth', 'Status'];
    component.multiYColumns.push('Status');
    component.selectChartType('bar');
    component.xAxis = 'Status'; component.yAxis = 'Sum (F)'; component.yAggColumn = 'Depth';
    component.selectChartType('table');
    expect(component.xAxis).toBe('WellName');
    expect(component.multiYColumns).toEqual(['WellName', 'Depth', 'Status']);
    component.selectChartType('bar');
    expect(component.xAxis).toBe('Status');
    expect(component.yAggColumn).toBe('Depth');
    expect(component.selectedChartModelId).toBe('16');
  });

  it('excludes deselected table columns from other chart type mappings', () => {
    const component = createBuilder();
    component['rawLoadedColumns'] = ['WellName', 'Depth'];
    component.xAxisOptions = ['WellName', 'Depth'];
    component.yAxisColumns = ['WellName', 'Depth'];

    component.toggleMultiYColumn('Depth');
    component.selectChartType('bar');

    expect(component.availableMappingColumns).toEqual(['WellName']);
    expect(component.filteredXAxisOptions).toEqual(['WellName']);
    expect(component.filteredYAxisColumns).toEqual(['WellName']);
  });

  it('retains chart tabs and per-tab source choices across a refresh', () => {
    const original = createBuilder();
    original['openNewChartTab']();
    original.selectedChartModelId = 'Wells';
    original.setActiveTab('chart-1');
    original.persistEditorDraft();
    const restored = createBuilder();
    expect(restored['restoreEditorDraft']()).toBe(true);
    expect(restored.tabs).toHaveLength(2);
    expect(restored.selectedChartModelId).toBe('16');
    expect(restored.selectedImportDataset?.datasetName).toBe('Sample Import');
    restored.setActiveTab('chart-2');
    expect(restored.selectedChartModelId).toBe('Wells');
  });

  it('stores configuration, filters and IDs but not dataset rows', () => {
    const original = createBuilder();
    original.previewFilterValues = { 1: 'Producing' };
    original['rawLoadedRows'] = [{ confidentialRow: 'not-in-draft' }];
    original['savedChartIds'].set('chart-1', 40296);
    original.persistEditorDraft();
    const stored = sessionStorage.getItem(original['draftStorageKey'])!;
    expect(stored).not.toContain('not-in-draft');
    const restored = createBuilder();
    expect(restored['restoreEditorDraft']()).toBe(true);
    expect(restored.previewFilterValues).toEqual({ 1: 'Producing' });
    expect(restored['savedChartIds'].get('chart-1')).toBe(40296);
    expect(restored.fromDate).toBe('2026-01-01');
  });

  it('persists on navigation out of the component', () => {
    const component = createBuilder();
    component.ngOnDestroy();
    expect(sessionStorage.getItem(component['draftStorageKey'])).not.toBeNull();
  });

  it('isolates drafts by user, tenant and saved chart ID', () => {
    createBuilder().persistEditorDraft();
    expect(createBuilder(2)['restoreEditorDraft']()).toBe(false);
    expect(createBuilder(1, 8)['restoreEditorDraft']()).toBe(false);
    expect(createBuilder(1, 7, '40296')['restoreEditorDraft']()).toBe(false);
  });

  it('does not persist while an existing chart is still loading', () => {
    const component = createBuilder();
    component['draftReady'] = false;
    component.persistEditorDraft();
    expect(sessionStorage.length).toBe(0);
  });

  it('does not persist after the user session changes', () => {
    const component = createBuilder();
    Object.assign(component, { authService: { getCurrentUser: () => null } });
    component.persistEditorDraft();
    expect(sessionStorage.length).toBe(0);
  });

  it('removes a discarded draft without recreating it on exit', () => {
    const component = createBuilder();
    component.persistEditorDraft();
    component.discard();
    component.ngOnDestroy();
    expect(sessionStorage.getItem(component['draftStorageKey'])).toBeNull();
  });

  it('does not recreate an unchanged saved draft, but preserves subsequent edits', () => {
    const component = createBuilder();
    component['savedDraftBaseline'] = JSON.stringify(component['createEditorDraft']());
    component.persistEditorDraft();
    expect(sessionStorage.length).toBe(0);
    component.chartTitle = 'Changed after save';
    component.persistEditorDraft();
    expect(sessionStorage.length).toBe(1);
  });

  it('Clear All does not resurrect the previous imported selection', () => {
    const component = createBuilder();
    component.switchDataSourceMode('table');
    component.switchDataSourceMode('import');
    component.confirmClearAll();
    component.switchDataSourceMode('import');
    expect(component.selectedChartModelId).toBe('');
    component.persistEditorDraft();
    const restored = createBuilder();
    restored['restoreEditorDraft']();
    expect(restored.selectedChartModelId).toBe('');
  });

  it('Clear All restores the create-page global filter defaults', () => {
    const component = createBuilder();
    const today = new Date();

    component.confirmClearAll();

    expect(component.filterValues).toEqual({
      country: 'Oman', sector: 'Construction Services', businessUnit: 'Energy',
      division: 'Oilfield Projects', cluster: 'All', plant: 'All',
    });
    expect(component.quickRange).toBe('');
    expect(component.fromDate).toBe(`${today.getFullYear()}-01-01`);
    expect(component.toDate).toBe(component['lastTuesday'](today));
  });

  it('ignores malformed drafts and tolerates unavailable storage', () => {
    const component = createBuilder();
    sessionStorage.setItem(component['draftStorageKey'], '{invalid');
    expect(component['restoreEditorDraft']()).toBe(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => component.persistEditorDraft()).not.toThrow();
  });

  it('clears an earlier temporary draft when changes return to the saved baseline', () => {
    const component = createBuilder();
    const originalTitle = component.chartTitle;
    component['savedDraftBaseline'] = JSON.stringify(component['createEditorDraft']());
    component.chartTitle = 'Temporary edit';
    component.persistEditorDraft();
    expect(sessionStorage.getItem(component['draftStorageKey'])).not.toBeNull();
    component.chartTitle = originalTitle;
    component.persistEditorDraft();
    expect(sessionStorage.getItem(component['draftStorageKey'])).toBeNull();
    expect(createBuilder()['restoreEditorDraft']()).toBe(false);
  });

  it.each([
    'missing snapshot', 'missing array', 'null filter', 'invalid filter values',
    'invalid metadata', 'invalid map', 'inactive tab', 'source snapshot',
    'type snapshot', 'missing tab state', 'wrong version',
  ])('rejects %s without partially changing the editor', corruption => {
    const component = createBuilder();
    const draft = JSON.parse(JSON.stringify(component['createEditorDraft']()));
    const state = draft.tabStates[0][1];
    switch (corruption) {
      case 'missing snapshot': draft.tabStates[0][1] = {}; break;
      case 'missing array': delete state.multiYColumns; break;
      case 'null filter': state.interactiveFilters = [null]; break;
      case 'invalid filter values': state.previewFilterMultiValues = { 1: 42 }; break;
      case 'invalid metadata': draft.availableImportDatasets = [null]; break;
      case 'invalid map': draft.savedChartIds = [['chart-1']]; break;
      case 'inactive tab': draft.tabStates.push(['chart-2', {}]); break;
      case 'source snapshot': draft.sourceModeStates = [['chart-1:import', {}]]; break;
      case 'type snapshot': draft.chartTypeStates = [['chart-1:import:16:table', {}]]; break;
      case 'missing tab state': draft.tabs.push({ id: 'chart-2', label: 'Chart 2' }); break;
      case 'wrong version': draft.version = 999; break;
    }
    const originalTabs = component.tabs;
    const originalStates = [...component['tabStates']];
    sessionStorage.setItem(component['draftStorageKey'], JSON.stringify(draft));
    sessionStorage.setItem('unrelated-draft', 'keep');
    expect(() => expect(component['restoreEditorDraft']()).toBe(false)).not.toThrow();
    expect(component.tabs).toBe(originalTabs);
    expect([...component['tabStates']]).toEqual(originalStates);
    expect(component['loadColumnsForSource']).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(component['draftStorageKey'])).toBeNull();
    expect(sessionStorage.getItem('unrelated-draft')).toBe('keep');
  });
});