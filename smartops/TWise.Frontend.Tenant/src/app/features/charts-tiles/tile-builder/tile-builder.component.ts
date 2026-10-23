import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { dateRangePopupPlacement } from '../../../shared/components/date-range-popup/date-range-popup.placement';
import { advancedHierarchyFilters } from '../../../core/utils/advanced-hierarchy-filter.util';
import { AdvancedFilterComponent, type AdvancedFilterValue } from '../../../shared/components/advanced-filter/advanced-filter.component';
import { ActivatedRoute, Router } from '@angular/router';
import { Location } from '@angular/common';
import { Subscription, of, EMPTY, expand, reduce } from 'rxjs';
import { switchMap, map, catchError } from 'rxjs/operators';
import { ColDef, RowClassParams, themeQuartz } from 'ag-grid-community';
import { WidgetService } from '../../../core/services/widget.service';
import { CommonApiService, DatabaseViewListItem, PlantFilterDto } from '../../../core/services/common-api.service';
import { CategoryService } from '../../../core/services/category.service';
import { ToastService } from '../../../core/services/toast.service';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { AuthService } from '../../../core/services/auth.service';
import { ImportedDatasetListItem, ImportedDatasetService } from '../../../core/services/imported-dataset.service';
import { ListRouteReuseStrategy } from '../../../core/services/list-route-reuse.strategy';
import { DaxModelSaveRequest, DaxModelService, SavedDaxModelDto } from '../../../core/services/dax-model.service';
import { tableClusterPlantFilters } from '../../../core/utils/table-global-filter.util';
import { resolveTileLayout, type TileLayout } from '../../../core/utils/tile-layout.util';
import {
  GlobalFilterSelection,
  globalSelectionLabel,
  globalSelectionPayload,
  hasGlobalSelection,
  matchesGlobalSelection,
  isGlobalFilterOptionChecked, GlobalFilterClearState, toggleGlobalSelection,
} from '../../../core/utils/global-filter-selection.util';
import {
  createDefaultDaxMeasure,
  createDefaultDaxModel,
  DAX_FUNCTION_SNIPPETS, buildDaxOperationExpression, restoreDaxOperation,
  getTileDaxRequest, evaluateTileDaxValue, formatDaxValue, validateDaxExpression, getActiveDaxMeasures, getDaxReferencedColumns,
} from '../../../core/utils/dax-evaluator.util';
import type { DaxMeasureConfig, DaxEvaluationScope, DaxModelConfig } from '../../../core/utils/dax-evaluator.util';
export type { DaxMeasureConfig, DaxEvaluationScope, DaxModelConfig } from '../../../core/utils/dax-evaluator.util';

export type TileColor = 'blue' | 'green' | 'red' | 'amber' | 'teal' | 'gray';
export type TileIconId = 'well' | 'gauge' | 'crew' | 'calendar' | 'derrick' | 'trend';
export type CalculationType = 'count' | 'countDistinct' | 'total' | 'average' | 'value';

/** Shown when no valid category can be resolved — see resolvedCategoryId. */
const CATEGORY_REQUIRED_MESSAGE =
  'Select a category before saving. If the category list is empty, reload the page — categories could not be loaded.';

export interface DataSourceOption {
  id: string;
  label: string;
  icon: 'derrick' | 'gauge' | 'crew' | 'calendar' | 'trend';
  columns: number;
  modelType: 'Table' | 'View' | 'Import';
  iconBg: string;
}

export interface BreakdownRow {
  id: number;
  label: string;
  value: string;
  color: TileColor;
  sourceName?: string;
  sourceType?: string;
  column?: string;
}

interface TileHelpArticle {
  id: string;
  question: string;
  steps: string[];
  expanded: boolean;
}

export interface BuilderTab {
  id: string;
  label: string;
}

/** Per-tab tile configuration snapshot */
interface TabState {
  daxModel: DaxModelConfig;
  tileTitle: string;
  selectedDataSourceId: string;
  dataSourceMode: 'table' | 'view' | 'import';
  viewId: number | null;
  calculation: CalculationType;
  valueColumn: string;
  tileColor: TileColor;
  tileIcon: TileIconId;
  showTileIcon: boolean;
  tileLayout: TileLayout;
  valueBold: boolean;
  valueItalic: boolean;
  valueColor: string;
  prefix: string;
  suffix: string;
  decimalPlaces: number;
  shortenBigNumbers: boolean;
  badgeText: string;
  badgeColor: string;
  breakdownRows: BreakdownRow[];
  interactiveFilters: InteractiveFilter[];
  drillDownViewId: number | null;
}

interface InteractiveFilter {
  id: number;
  label: string;
  controlType: string;
  sourceTable: string;
  sourceColumn: string;
}

interface DaxSavedModelCard {
  id: string;
  name: string;
  subtitle: string;
  tags: string[];
  expression: string;
  sourceId?: string;
}

@Component({
  selector: 'app-tile-builder',
  standalone: false,
  templateUrl: './tile-builder.component.html',
  styleUrls: ['./tile-builder.component.scss'],
})
export class TileBuilderComponent implements OnInit, OnDestroy {
  tileTitle = 'Tile Name';
  tileDescription = '';
  editingTitle = false;
  editingDescription = false;

  categories: string[] = [];
  private apiCategories: { categoryId: number; categoryName: string }[] = [];
  category = '';
  showCategoryDropdown = false;
  categoryDropdownSearch = '';

  get filteredCategories(): string[] {
    const term = this.categoryDropdownSearch.trim().toLowerCase();
    if (!term) return this.categories;
    return this.categories.filter(c => c.toLowerCase().includes(term));
  }
  private categorySub!: Subscription;

  tabs: BuilderTab[] = [{ id: 'tile-1', label: 'Tile' }];
  activeTabId = 'tile-1';
  private nextTabIndex = 2;
  /** Saved state for each tab (keyed by tab id) */
  private readonly tabStates = new Map<string, TabState>();
  showAddPageConfirm = false;

  locked = false;
  zoomLevel = 100;
  panelCollapsed = false;
  openSections = new Set<number>([1]);
  private _prevSidebarState: boolean | undefined;
  private returnUrl = '/charts-tiles/wip-tiles';

  isSectionOpen(n: number): boolean { return this.openSections.has(n); }
  toggleSection(n: number): void {
    if (this.openSections.has(n)) { this.openSections.delete(n); }
    else { this.openSections.add(n); }
  }
  private _sidebarSub?: Subscription;
  showClearAllConfirm = false;

  private readonly undoStack: TabState[] = [];
  private readonly redoStack: TabState[] = [];
  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  dataSources: DataSourceOption[] = [
    { id: 'wells',           label: 'Wells',           icon: 'gauge',    columns: 24, modelType: 'Table', iconBg: '#FEFAF1' },
    { id: 'crew',            label: 'Crew',            icon: 'crew',     columns: 24, modelType: 'View',  iconBg: '#F4F8FD' },
    { id: 'ph-productivity', label: 'PH Productivity', icon: 'trend',    columns: 24, modelType: 'View',  iconBg: '#F3FBF7' },
    { id: 'activities',      label: 'Activities',      icon: 'derrick',  columns: 24, modelType: 'Table', iconBg: '#F6F5FD' },
    { id: 'daily-plan',      label: 'Daily Plan',      icon: 'calendar', columns: 24, modelType: 'View',  iconBg: '#F4F9F9' },
  ];
  selectedDataSourceId = '';
  showDataSourceDropdown = false;
  dataSourceSearch = '';

  /**
   * Table (common sources) | View (database views) | Import (uploaded files and
   * connector-ingested datasets — CSV/Excel/JSON, REST API, Google Sheets/Drive).
   */
  dataSourceMode: 'table' | 'view' | 'import' = 'table';
  availableViews: DatabaseViewListItem[] = [];
  viewSearch = '';

  availableImportDatasets: ImportedDatasetListItem[] = [];
  importSearch = '';
  importUploading = false;
  importUploadError: string | null = null;
  importDragOver = false;
  importPasteMode = false;
  importPasteText = '';
  private readonly importAllowedExtensions = ['.csv', '.xlsx', '.xls', '.json'];
  private readonly importMaxFileSizeBytes = 8 * 1024 * 1024;

  get importAcceptAttr(): string {
    return this.importAllowedExtensions.join(',');
  }

  get filteredImportDatasets(): ImportedDatasetListItem[] {
    const term = this.importSearch.trim().toLowerCase();
    if (!term) return this.availableImportDatasets;
    return this.availableImportDatasets.filter(d => d.datasetName.toLowerCase().includes(term));
  }

  /** The dataset backing the tile; selection is stored by id, as the chart builder does. */
  get selectedImportDataset(): ImportedDatasetListItem | undefined {
    return this.availableImportDatasets.find(d => String(d.id) === this.selectedDataSourceId);
  }

  get filteredViews(): DatabaseViewListItem[] {
    const term = this.viewSearch.trim().toLowerCase();
    if (!term) return this.availableViews;
    return this.availableViews.filter(v => v.viewName.toLowerCase().includes(term));
  }

  get selectedView(): DatabaseViewListItem | undefined {
    return this.availableViews.find(v => v.viewName === this.selectedDataSourceId);
  }

  get filteredDataSources(): DataSourceOption[] {
    const term = this.dataSourceSearch.trim().toLowerCase();
    if (!term) return this.dataSources;
    return this.dataSources.filter(m => m.label.toLowerCase().includes(term));
  }

  get selectedDataSource(): DataSourceOption | undefined {
    return this.dataSources.find(m => m.id === this.selectedDataSourceId);
  }

  calculation: CalculationType = 'value';

  /** Column for Total/Average/Value calculations */
  valueColumn = '';
  showValueColumnDropdown = false;
  valueColumnSearch = '';
  columnsForSource: string[] = [];
  private tableRows: Record<string, unknown>[] = [];

  get filteredColumnsForSource(): string[] {
    const term = this.valueColumnSearch.trim().toLowerCase();
    if (!term) return this.columnsForSource;
    return this.columnsForSource.filter(col => col.toLowerCase().includes(term));
  }

  showTablePreview = false;
  readonly tablePreviewTheme = themeQuartz.withParams({
    accentColor: '#21409A', headerBackgroundColor: '#2948A3', headerTextColor: '#FFFFFF',
    headerFontWeight: 600, rowHoverColor: '#F5F8FF',
  });
  readonly tablePreviewDefaultColDef: ColDef = {
    sortable: true, resizable: true, filter: true, flex: 1, minWidth: 110,
    headerStyle: { background: 'linear-gradient(180deg, #2948A3 0%, #3B58B6 100%)', color: '#FFFFFF' },
  };
  private readonly tablePreviewRowColors = ['#EFF6FF', '#FFF7ED', '#F0FDF4', '#FEFCE8', '#FEF2F2', '#F5F3FF', '#F8FAFC', '#F0FDFA', '#FDF2F8', '#EEF2FF'];
  readonly tablePreviewRowStyle = (params: RowClassParams) => ({
    backgroundColor: this.tablePreviewRowColors[(params.node.rowIndex ?? 0) % this.tablePreviewRowColors.length],
    color: '#101828',
  });
  private tablePreviewColumnsSource: string[] | null = null;
  private tablePreviewColumnsCache: ColDef[] = [];

  get isTablePreviewVisible(): boolean {
    return !this.daxEnabled && this.showTablePreview && !!this.selectedDataSourceId;
  }

  get tablePreviewColumnDefs(): ColDef[] {
    if (this.tablePreviewColumnsSource !== this.columnsForSource) {
      this.tablePreviewColumnsSource = this.columnsForSource;
      this.tablePreviewColumnsCache = this.columnsForSource.map(column => ({
        colId: column, headerName: column, valueGetter: params => params.data?.[column],
      }));
    }
    return this.tablePreviewColumnsCache;
  }

  get tablePreviewRows(): Record<string, unknown>[] { return this.tableRows; }

  interactiveFilters: InteractiveFilter[] = [];

  // Drill Down: optional database view opened when a viewer clicks this tile (mirrors chart drill-down).
  drillDownViewId: number | null = null;
  drillDownViewName = '';
  showDrillDownDropdown = false;
  drillDownSearch = '';
  drillDownViews: DatabaseViewListItem[] = [];
  get filteredDrillDownViews(): DatabaseViewListItem[] {
    const term = this.drillDownSearch.trim().toLowerCase();
    return term ? this.drillDownViews.filter(v => v.viewName.toLowerCase().includes(term)) : this.drillDownViews;
  }
  showFilterPanel = true;
  private nextFilterId = 1;
  controlTypeOptions = ['Dropdown', 'Date', 'Text'];
  filterColumnsCache: Record<string, string[]> = {};

  get filterSourceOptions(): string[] { return this.dataSources.map(m => m.id); }

  getSourceColumns(sourceTable: string): string[] {
    if (!sourceTable) return [];
    if (this.filterColumnsCache[sourceTable]) return this.filterColumnsCache[sourceTable];
    this.loadFilterColumns(sourceTable);
    return [];
  }

  private loadFilterColumns(sourceTable: string): void {
    if (this.filterColumnsCache[sourceTable]) return;
    this.filterColumnsCache[sourceTable] = [];
    const model = this.dataSources.find(m => m.id === sourceTable);
    const sourceType = model?.modelType ?? 'Table';
    this.widgetService.getTableData(sourceTable, sourceType).subscribe({
      next: (res) => {
        this.filterColumnsCache[sourceTable] = res?.columns ?? [];
        this.cdr.markForCheck();
      },
    });
  }

  onFilterSourceChange(filter: InteractiveFilter): void {
    filter.sourceColumn = '';
    this.loadFilterColumns(filter.sourceTable);
  }

  /** Live computed tile value from real data */
  liveValue: number | null = null;
  private tileValueSubscription?: Subscription;
  private savedDaxModelsSubscription?: Subscription;
  private selectedCategoryId = 0;
  private selectedLibraryId: number | null = null;

  readonly isSaving = signal(false);
  readonly saveError = signal('');
  readonly saveSuccess = signal('');
  private saveSuccessTimeout?: ReturnType<typeof setTimeout>;

  private static readonly MISSING_SOURCE_ERROR = 'Please select a source first.';

  /** The save-time "no source" complaint is stale the moment a source is picked. */
  private clearMissingSourceError(): void {
    if (this.saveError() === TileBuilderComponent.MISSING_SOURCE_ERROR) this.saveError.set('');
  }

  readonly descriptionValidationError = signal('');
  editId: number | null = null;
  get isEditMode(): boolean { return !!this.editId; }
  get canGeneratePreview(): boolean {
    return !!this.selectedDataSourceId && this.tableRows.length > 0;
  }

  get formattedValue(): string {
    if (this.liveValue === null) return '—';
    if (this.daxEnabled && this.selectedDaxMeasure?.expression?.trim()) return formatDaxValue(this.liveValue, this.selectedDaxMeasure);
    // A just-added empty measure has no format yet; keep the value's precision from the last measure that has one.
    if (this.tileDaxActive) return formatDaxValue(this.liveValue, this.previewFormatMeasure ?? [...this.daxModel.measures].reverse().find(m => !!m.expression?.trim()));
    let v = this.liveValue;
    if (this.shortenBigNumbers && v >= 1000) {
      if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
      return (v / 1000).toFixed(1) + 'K';
    }
    return v.toFixed(this.decimalPlaces);
  }

  readonly tileColors: { value: TileColor; label: string; hex: string }[] = [
    { value: 'blue',  label: 'Blue',  hex: '#2563EB' },
    { value: 'green', label: 'Green', hex: '#4ADE80' },
    { value: 'red',   label: 'Red',   hex: '#EF4444' },
    { value: 'amber', label: 'Amber', hex: '#F59E0B' },
    { value: 'teal',  label: 'Teal',  hex: '#14B8A6' },
    { value: 'gray',  label: 'Gray',  hex: '#9CA3AF' },
  ];
  tileColor: TileColor = 'blue';
  showColorDropdown = false;

  readonly tileIcons: { value: TileIconId; label: string }[] = [
    { value: 'well',     label: 'Well' },
    { value: 'gauge',    label: 'Gauge' },
    { value: 'crew',     label: 'Crew' },
    { value: 'calendar', label: 'Calendar' },
    { value: 'trend',    label: 'Trend' },
  ];
  tileIcon: TileIconId = 'well';
  showIconDropdown = false;
  // Icon is optional per tile; defaults on so existing tiles keep showing their icon.
  showTileIcon = true;
  tileLayout: TileLayout = 'two-rows';
  valueBold = false;
  valueItalic = false;
  valueColor = '';

  numberFormattingOpen = true;
  prefix = '';
  suffix = '';
  decimalPlaces = 0;
  readonly decimalPlaceOptions = [0, 1, 2];
  shortenBigNumbers = false;

  badgeOpen = true;
  badgeText = '';
  readonly badgeColorOptions: { value: string; label: string; hex: string }[] = [
    { value: 'none',   label: 'None',   hex: '#E5E7EB' },
    { value: 'blue',   label: 'Blue',   hex: '#2563EB' },
    { value: 'green',  label: 'Green',  hex: '#16A34A' },
    { value: 'orange', label: 'Orange', hex: '#EA580C' },
    { value: 'red',    label: 'Red',    hex: '#DC2626' },
  ];
  badgeColor = 'none';
  showBadgeColorDropdown = false;

  private nextRowId = 1;
  breakdownRows: BreakdownRow[] = [];

  readonly daxFunctionSnippets = [...DAX_FUNCTION_SNIPPETS];
  private nextDaxMeasureIndex = 1;
  selectedDaxSnippet = '';
  selectedDaxColumns: string[] = [];
  showDaxColumnDropdown = false;
  showDaxOperationDropdown = false;
  daxOperationSearch = '';
  showDaxNumeratorDropdown = false;
  showDaxDenominatorDropdown = false;
  daxMeasureApplied = false;
  daxMeasureMessage = 'Measure Saved';
  private daxMeasureAppliedTimer: ReturnType<typeof setTimeout> | null = null;
  daxModel: DaxModelConfig = this.createDefaultDaxModel();
  daxMeasureDraft: DaxMeasureConfig = { ...this.daxModel.measures[0] };
  daxExpressionError = '';

  daxActiveTab: 'saved' | 'create' = 'saved';
  daxSavedModelsSearch = '';
  private daxSavedModelSelectedIds = new Set<string>();
  daxSavedModelsCatalog: DaxSavedModelCard[] = [];
  private readonly daxSavedModelsById = new Map<string, SavedDaxModelDto>();

  get daxAddedToChart(): DaxSavedModelCard[] {
    return this.daxModel.measures.filter(measure => measure.savedModelId != null).map(measure => ({
      id: measure.id, sourceId: String(measure.savedModelId), name: measure.name,
      expression: measure.expression, tags: [...(measure.columns ?? [])],
      subtitle: `${measure.evaluationScope === 'row' ? 'Row' : 'Column'} · ${measure.operation ?? ''}`,
    }));
  }

  private loadSavedDaxModels(): void {
    this.savedDaxModelsSubscription?.unsubscribe();
    this.savedDaxModelsSubscription = this.daxModelService.list({ status: 'Active', page: 1, pageSize: 100 }).pipe(
      expand((page, index) => page.items.length && (index + 1) * 100 < page.total
        ? this.daxModelService.list({ status: 'Active', page: index + 2, pageSize: 100 }) : EMPTY),
      reduce((models, page) => [...models, ...page.items], [] as SavedDaxModelDto[]),
    ).subscribe({
      next: models => {
        this.daxSavedModelsById.clear();
        models.filter(model => model.status === 'Active').forEach(model => this.daxSavedModelsById.set(String(model.id), model));
        this.daxSavedModelsCatalog = [...this.daxSavedModelsById.values()].map(model => ({
          id: String(model.id), name: model.name, expression: model.expression, tags: [...model.columns],
          subtitle: `${model.calculatedBy} · ${model.operation ?? ''} · ${model.columns.length} columns`,
        }));
        this.cdr.markForCheck();
      },
      error: () => { this.daxExpressionError = 'Could not load saved DAX models.'; this.cdr.markForCheck(); },
    });
  }

  private restoreTileDaxModel(model?: DaxModelConfig): void {
    this.daxModel = structuredClone(model ?? this.createDefaultDaxModel());
    this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? this.daxModel.measures[0] ?? createDefaultDaxMeasure('measure-1')) };
    this.selectedDaxSnippet = restoreDaxOperation(this.daxMeasureDraft.operation, this.daxMeasureDraft.expression);
    this.selectedDaxColumns = [...(this.daxMeasureDraft.columns ?? [])];
    this.daxExpressionError = '';
  }

  private validateTileDaxForSave(): boolean {
    try {
      if (getTileDaxRequest(this.daxModel, this.columnsForSource) && (this.daxExpressionError || this.liveValue === null || this.tileValueLoading))
        throw new Error(this.daxExpressionError || 'Wait for a valid DAX preview before saving.');
      return true;
    } catch (error) {
      this.saveError.set(error instanceof Error ? error.message : 'Invalid tile DAX measure.');
      return false;
    }
  }

  /** Measure whose result the preview still shows after Add Measure selects a new, empty one. */
  private previewFormatMeasure?: DaxMeasureConfig;
  private tileValueLoading = false;

  get daxEnabled(): boolean { return this.daxModel.enabled; }

  /** DAX drives the tile only once at least one measure has an expression; otherwise the normal calculation applies. */
  private get tileDaxActive(): boolean {
    return this.daxModel.enabled && this.daxModel.measures.some(measure => !!measure.expression?.trim());
  }

  private effectiveDaxModel(): DaxModelConfig {
    return this.tileDaxActive ? this.daxModel : { ...this.daxModel, enabled: false };
  }

  get selectedDaxMeasure(): DaxMeasureConfig | undefined {
    return this.daxModel.measures.find(m => m.id === this.daxModel.selectedMeasureId);
  }

  get isDaxPercentageOperation(): boolean {
    return this.selectedDaxSnippet.split('(')[0].trim().toUpperCase() === 'PERCENTAGE';
  }

  private createDefaultDaxMeasure(): DaxMeasureConfig {
    let id: string;
    do {
      id = `measure-${this.nextDaxMeasureIndex++}`;
    } while (this.daxModel.measures.some(measure => measure.id === id));
    return createDefaultDaxMeasure(id);
  }

  private createDefaultDaxModel(): DaxModelConfig {
    return createDefaultDaxModel();
  }

  toggleDaxModel(): void {
    this.pushUndo();
    this.daxModel = { ...this.daxModel, enabled: !this.daxModel.enabled };
    if (this.daxModel.enabled && !this.daxModel.measures.length) {
      const measure = this.createDefaultDaxMeasure();
      this.daxModel = { schemaVersion: 1, enabled: true, selectedMeasureId: measure.id, measures: [measure] };
    }
    this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? this.daxModel.measures[0]) };
    this.daxExpressionError = '';
    if (this.daxEnabled && this.daxActiveTab === 'saved') this.loadSavedDaxModels();
    this.computeTileValue(true);
    this.cdr.markForCheck();
  }

  get daxSelectableMeasureCount(): number {
    return getActiveDaxMeasures({ daxModel: this.daxModel }).length;
  }

  toggleDaxMetricSelector(): void {
    this.pushUndo();
    this.daxModel = { ...this.daxModel, allowMetricSelector: !this.daxModel.allowMetricSelector };
    this.cdr.markForCheck();
  }

  updateDaxMeasureDraft(changes: Partial<DaxMeasureConfig>): void {
    this.daxMeasureDraft = { ...this.daxMeasureDraft, ...changes };
    this.daxExpressionError = '';
  }

  saveDaxMeasure(): void {
    this.daxExpressionError = validateDaxExpression(this.daxMeasureDraft.expression, this.columnsForSource, this.daxMeasureDraft.evaluationScope ?? 'column');
    if (this.daxExpressionError) return;
    this.pushUndo();
    const id = this.daxModel.selectedMeasureId;
    if (!id) return;
    const activeMeasure = this.daxModel.measures.find(measure => measure.id === id);
    if (!activeMeasure) return;
    const measure: DaxMeasureConfig = {
      ...this.daxMeasureDraft,
      id,
      name: this.daxMeasureDraft.name.trim() || 'New Measure',
      expression: this.daxMeasureDraft.expression.trim(),
      operation: this.selectedDaxSnippet,
      columns: [...this.selectedDaxColumns],
    };
    const measures = this.daxModel.measures.map(m => m.id === id ? measure : m);
    this.daxModel = { ...this.daxModel, enabled: true, selectedMeasureId: id, measures };
    this.daxMeasureDraft = { ...measure };
    this.computeTileValue();
    this.showDaxMeasureApplied();
    this.cdr.markForCheck();
    this.persistDaxMeasureAsModel(measure);
  }

  /** Same as the chart builder: a saved measure is also added to (or updates) the Saved Models library. Imports have no library source. */
  private persistDaxMeasureAsModel(measure: DaxMeasureConfig): void {
    if (this.dataSourceMode === 'import' || !this.selectedDataSourceId) return;
    const body: DaxModelSaveRequest = {
      name: measure.name,
      sourceType: this.dataSourceMode === 'view' ? 'View' : 'Table',
      dataSource: this.selectedDataSourceId,
      calculatedBy: measure.evaluationScope === 'row' ? 'Row' : 'Column',
      operation: measure.operation?.split('(')[0].trim() || null,
      columns: getDaxReferencedColumns(measure),
      expression: measure.expression,
      status: 'Active',
    };
    const request$ = measure.savedModelId != null ? this.daxModelService.update(measure.savedModelId, body) : this.daxModelService.create(body);
    request$.subscribe({
      next: saved => {
        this.daxModel = { ...this.daxModel, measures: this.daxModel.measures.map(m => m.id === measure.id ? { ...m, savedModelId: saved.id } : m) };
        if (this.daxMeasureDraft.id === measure.id) this.daxMeasureDraft = { ...this.daxMeasureDraft, savedModelId: saved.id };
        this.loadSavedDaxModels();
        this.cdr.markForCheck();
      },
      error: err => {
        this.saveError.set(err?.error?.message ?? 'The measure was saved on this tile but could not be added to Saved Models.');
        this.cdr.markForCheck();
      },
    });
  }

  addDaxMeasure(): void {
    this.pushUndo();
    const currentMeasure: DaxMeasureConfig = {
      ...this.daxMeasureDraft,
      name: this.daxMeasureDraft.name.trim() || 'New Measure',
      expression: this.daxMeasureDraft.expression.trim(),
    };
    const savedMeasures = this.daxModel.measures.some(measure => measure.id === currentMeasure.id)
      ? this.daxModel.measures.map(measure => measure.id === currentMeasure.id ? currentMeasure : measure)
      : [...this.daxModel.measures, currentMeasure];
    const previewedMeasure = savedMeasures.find(measure => measure.id === this.daxModel.selectedMeasureId);
    if (previewedMeasure?.expression?.trim()) this.previewFormatMeasure = previewedMeasure;
    const newMeasure = this.createDefaultDaxMeasure();
    this.daxModel = {
      ...this.daxModel,
      enabled: true,
      selectedMeasureId: newMeasure.id,
      measures: [...savedMeasures, newMeasure],
    };
    this.daxMeasureDraft = { ...newMeasure };
    this.resetDaxOperationPickerState();
    this.daxExpressionError = '';
    this.computeTileValue(true);
    this.cdr.markForCheck();
  }

  private resetDaxOperationPickerState(): void {
    this.selectedDaxSnippet = '';
    this.selectedDaxColumns = [];
    this.showDaxColumnDropdown = false;
    this.showDaxOperationDropdown = false;
    this.daxOperationSearch = '';
    this.showDaxNumeratorDropdown = false;
    this.showDaxDenominatorDropdown = false;
  }

  /** Briefly flashes a confirmation badge next to the measure actions. */
  private showDaxMeasureApplied(message = 'Measure Saved'): void {
    this.daxMeasureMessage = message;
    if (this.daxMeasureAppliedTimer) clearTimeout(this.daxMeasureAppliedTimer);
    this.daxMeasureApplied = false;
    this.cdr.markForCheck();
    setTimeout(() => {
      this.daxMeasureApplied = true;
      this.cdr.markForCheck();
      this.daxMeasureAppliedTimer = setTimeout(() => {
        this.daxMeasureApplied = false;
        this.daxMeasureAppliedTimer = null;
        this.cdr.markForCheck();
      }, 2400);
    });
  }

  selectDaxMeasure(id: string): void {
    const measure = this.daxModel.measures.find(m => m.id === id);
    if (!measure) return;
    this.pushUndo();
    this.daxModel = { ...this.daxModel, selectedMeasureId: id };
    this.daxMeasureDraft = { ...measure };
    this.restoreTileDaxModel(this.daxModel);
    this.computeTileValue();
    this.cdr.markForCheck();
  }

  removeDaxMeasure(id: string): void {
    this.pushUndo();
    const deletedName = (id === this.daxMeasureDraft.id ? this.daxMeasureDraft.name?.trim() : '')
      || this.daxModel.measures.find(m => m.id === id)?.name?.trim();
    const deletedMessage = deletedName ? `The measure ${deletedName} is deleted` : 'Measure deleted';
    if (this.daxModel.measures.length <= 1) {
      // Only one measure exists - "delete" clears it back to a blank default instead of no-op.
      const measure = this.createDefaultDaxMeasure();
      this.daxModel = { ...this.daxModel, selectedMeasureId: measure.id, measures: [measure] };
      this.daxMeasureDraft = { ...measure };
      this.resetDaxOperationPickerState();
      this.daxExpressionError = '';
      this.computeTileValue();
      this.showDaxMeasureApplied(deletedMessage);
      this.cdr.markForCheck();
      return;
    }
    const measures = this.daxModel.measures.filter(m => m.id !== id);
    const selectedMeasureId = this.daxModel.selectedMeasureId === id ? measures[0].id : this.daxModel.selectedMeasureId;
    this.daxModel = { ...this.daxModel, selectedMeasureId, measures };
    this.daxMeasureDraft = { ...(this.selectedDaxMeasure ?? measures[0]) };
    this.restoreTileDaxModel(this.daxModel);
    this.computeTileValue();
    this.showDaxMeasureApplied(deletedMessage);
    this.cdr.markForCheck();
  }

  updateDaxColumns(columns: string[]): void {
    this.selectedDaxColumns = columns ?? [];
    this.daxModel = { ...this.daxModel, enabled: true, selectedColumns: [...this.selectedDaxColumns] };
    this.applyDaxSelectedOperation();
  }

  toggleDaxColumn(column: string): void {
    const columns = this.selectedDaxColumns.includes(column)
      ? this.selectedDaxColumns.filter(selected => selected !== column)
      : [...this.selectedDaxColumns, column];
    this.updateDaxColumns(columns);
  }

  selectAllDaxColumns(): void {
    this.updateDaxColumns([...this.columnsForSource]);
  }

  deselectAllDaxColumns(): void {
    this.updateDaxColumns([]);
  }

  toggleDaxNumeratorColumn(column: string): void {
    const columns = this.daxMeasureDraft.numeratorColumns ?? [];
    this.updateDaxNumeratorColumns(columns.includes(column) ? columns.filter(c => c !== column) : [...columns, column]);
  }

  toggleDaxDenominatorColumn(column: string): void {
    const columns = this.daxMeasureDraft.denominatorColumns ?? [];
    this.updateDaxDenominatorColumns(columns.includes(column) ? columns.filter(c => c !== column) : [...columns, column]);
  }

  updateDaxNumeratorColumns(columns: string[]): void {
    const numeratorColumns = columns ?? [];
    const expression = this.buildDaxPercentageExpression(numeratorColumns, this.daxMeasureDraft.denominatorColumns ?? []);
    this.updateDaxMeasureDraft({ numeratorColumns, expression });
  }

  updateDaxDenominatorColumns(columns: string[]): void {
    const denominatorColumns = columns ?? [];
    const expression = this.buildDaxPercentageExpression(this.daxMeasureDraft.numeratorColumns ?? [], denominatorColumns);
    this.updateDaxMeasureDraft({ denominatorColumns, expression });
  }

  selectAllDaxNumeratorColumns(): void { this.updateDaxNumeratorColumns([...this.columnsForSource]); }
  deselectAllDaxNumeratorColumns(): void { this.updateDaxNumeratorColumns([]); }
  selectAllDaxDenominatorColumns(): void { this.updateDaxDenominatorColumns([...this.columnsForSource]); }
  deselectAllDaxDenominatorColumns(): void { this.updateDaxDenominatorColumns([]); }

  /** Percentage = sum of chosen numerator columns divided by sum of chosen denominator columns. */
  private buildDaxPercentageExpression(numerator: string[], denominator: string[]): string {
    if (!numerator.length || !denominator.length) return this.selectedDaxSnippet || this.daxMeasureDraft.expression;
    const isRowScope = (this.daxMeasureDraft.evaluationScope ?? 'column') === 'row';
    const wrap = (column: string) => isRowScope ? `[${column}]` : `SUM([${column}])`;
    const numeratorExpr = numerator.map(wrap).join(' + ');
    const denominatorExpr = denominator.map(wrap).join(' + ');
    return `PERCENTAGE(${numeratorExpr}, ${denominatorExpr})`;
  }

  updateDaxEvaluationScope(scope: DaxEvaluationScope): void {
    const evaluationScope: DaxEvaluationScope = scope === 'row' ? 'row' : 'column';
    const measure = { ...this.daxMeasureDraft, evaluationScope };
    this.daxMeasureDraft = measure;
    this.daxExpressionError = '';
    if (this.selectedDaxSnippet) this.applyDaxSelectedOperation();
  }

  toggleDaxColumnDropdown(event: Event): void {
    event.stopPropagation();
    this.showDaxColumnDropdown = !this.showDaxColumnDropdown;
  }

  toggleDaxOperationDropdown(event: Event): void {
    event.stopPropagation();
    this.showDaxOperationDropdown = !this.showDaxOperationDropdown;
    if (!this.showDaxOperationDropdown) this.daxOperationSearch = '';
  }

  toggleDaxNumeratorDropdown(event: Event): void {
    event.stopPropagation();
    this.showDaxNumeratorDropdown = !this.showDaxNumeratorDropdown;
  }

  toggleDaxDenominatorDropdown(event: Event): void {
    event.stopPropagation();
    this.showDaxDenominatorDropdown = !this.showDaxDenominatorDropdown;
  }

  selectDaxOperation(fn: string): void {
    this.insertDaxSnippet(fn);
    this.showDaxOperationDropdown = false;
    this.daxOperationSearch = '';
  }

  daxOperationLabel(fn: string): string {
    if (fn === 'STDEV([Column])') return 'STANDARD DEVIATION';
    if (fn === 'VARIANCE([Column])') return 'VARIANCE';
    return fn;
  }

  get filteredDaxFunctionSnippets(): string[] {
    const query = this.daxOperationSearch.trim().toLowerCase();
    if (!query) return this.daxFunctionSnippets;
    return this.daxFunctionSnippets.filter(fn => this.daxOperationLabel(fn).toLowerCase().includes(query));
  }

  insertDaxSnippet(snippet: string): void {
    if (!snippet) return;
    this.selectedDaxSnippet = snippet;
    this.daxModel = { ...this.daxModel, enabled: true, selectedOperation: snippet };
    this.daxMeasureDraft = { ...this.daxMeasureDraft, numeratorColumns: [], denominatorColumns: [] };
    this.applyDaxSelectedOperation();
  }

  applyDaxSelectedOperation(): void {
    if (!this.selectedDaxSnippet) return;
    const operation = this.selectedDaxSnippet.split('(')[0].trim().toUpperCase();
    // Percentage uses the dedicated numerator/denominator column pickers instead of the generic
    // Column picker; rebuild from those selections so switching row/column scope keeps them.
    const expression = operation === 'PERCENTAGE'
      ? this.buildDaxPercentageExpression(this.daxMeasureDraft.numeratorColumns ?? [], this.daxMeasureDraft.denominatorColumns ?? [])
      : this.buildDaxExpressionFromSelection();
    // Percentile ranks a value within a dataset; percentage expresses a ratio out of 100 - only
    // the latter should auto-format with a trailing %.
    let format = this.daxMeasureDraft.format;
    if (operation === 'PERCENTAGE') format = 'percent';
    else if (format === 'percent') format = 'number';
    this.updateDaxMeasureDraft({ expression, format });
  }

  private buildDaxExpressionFromSelection(): string {
    return buildDaxOperationExpression(this.selectedDaxSnippet, this.selectedDaxColumns, this.daxMeasureDraft.evaluationScope ?? 'column');
  }

  private buildDaxMultiColumnExpression(snippet: string, columns: string[]): string {
    const isRowScope = (this.daxMeasureDraft.evaluationScope ?? 'column') === 'row';
    const terms = columns.map(column => isRowScope ? `[${column}]` : `SUM([${column}])`);
    const operation = snippet.split('(')[0].trim().toUpperCase();
    if (operation === 'PRODUCT') return terms.join(' * ');
    if (operation === 'AVERAGE') return `DIVIDE(${terms.join(' + ')}, ${terms.length})`;
    if (operation === 'DIVIDE' || operation === 'PERCENTAGE') return columns.length >= 2 ? `${operation}(${terms[0]}, ${terms[1]})` : terms[0];
    if (['SUM', 'COUNT', 'DISTINCTCOUNT', 'MEDIAN', 'STDEV', 'VARIANCE', 'MIN', 'MAX', 'PERCENTILE'].includes(operation)) {
      // Combine every chosen column's values into a single aggregate call instead of
      // summing per-column aggregates, so PERCENTILE/MEDIAN/MIN/MAX/DISTINCTCOUNT reflect the whole set.
      const columnArgs = columns.map(column => `[${column}]`).join(', ');
      if (operation === 'PERCENTILE') return `PERCENTILE(${columnArgs}, ${this.extractDaxPercentileFraction(snippet)})`;
      return `${operation}(${columnArgs})`;
    }
    return this.replaceDaxPlaceholders(snippet, columns);
  }

  private extractDaxPercentileFraction(snippet: string): string {
    const match = /,\s*([0-9.]+)\s*\)\s*$/.exec(snippet);
    return match ? match[1] : '0.9';
  }

  private replaceDaxPlaceholders(snippet: string, columns: string[]): string {
    let expression = snippet;
    for (const column of columns) {
      const columnRef = `[${column}]`;
      if (expression.includes('[Column]')) expression = expression.replace('[Column]', columnRef);
      else {
        const placeholder = ['[Actual]', '[Planned]', '[Target]', '[Score]'].find(token => expression.includes(token));
        if (placeholder) expression = expression.replace(placeholder, columnRef);
      }
    }
    return expression;
  }

  setDaxTab(tab: 'saved' | 'create'): void {
    this.daxActiveTab = tab;
    if (tab === 'create') this.daxExpressionError = '';
    if (tab === 'saved') this.loadSavedDaxModels();
    this.cdr.markForCheck();
  }

  get filteredDaxSavedModels(): DaxSavedModelCard[] {
    const query = this.daxSavedModelsSearch.trim().toLowerCase();
    const addedIds = new Set(this.daxModel.measures
      .filter(measure => measure.savedModelId != null)
      .map(measure => String(measure.savedModelId)));
    return this.daxSavedModelsCatalog.filter(model =>
      !addedIds.has(model.id) && model.name.toLowerCase().includes(query));
  }

  isDaxSavedModelSelected(id: string): boolean {
    return this.daxSavedModelSelectedIds.has(id);
  }

  toggleDaxSavedModelSelection(id: string): void {
    const next = new Set(this.daxSavedModelSelectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.daxSavedModelSelectedIds = next;
    this.cdr.markForCheck();
  }

  get daxSavedModelsAllSelected(): boolean {
    return this.filteredDaxSavedModels.length > 0
      && this.filteredDaxSavedModels.every(model => this.daxSavedModelSelectedIds.has(model.id));
  }

  toggleSelectAllDaxSavedModels(): void {
    const next = new Set(this.daxSavedModelSelectedIds);
    if (this.daxSavedModelsAllSelected) {
      this.filteredDaxSavedModels.forEach(model => next.delete(model.id));
    } else {
      this.filteredDaxSavedModels.forEach(model => next.add(model.id));
    }
    this.daxSavedModelSelectedIds = next;
    this.cdr.markForCheck();
  }

  get daxSavedModelsSelectedCount(): number {
    return this.daxSavedModelSelectedIds.size;
  }

  addSelectedDaxSavedModelsToChart(): void {
    if (!this.daxSavedModelsSelectedCount) return;
    if (!this.columnsForSource.length) { this.daxExpressionError = 'Choose a data source first.'; return; }
    const existing = new Set(this.daxModel.measures.map(measure => measure.savedModelId));
    const added: DaxMeasureConfig[] = [];
    const errors: string[] = [];
    for (const id of this.daxSavedModelSelectedIds) {
      const model = this.daxSavedModelsById.get(id);
      if (!model || existing.has(model.id)) continue;
      const scope = model.calculatedBy === 'Row' ? 'row' : 'column';
      const error = validateDaxExpression(model.expression, this.columnsForSource, scope);
      if (error) { errors.push(`${model.name}: ${error}`); continue; }
      added.push({ id: `measure-${Date.now()}-${model.id}`, name: model.name, expression: model.expression,
        evaluationScope: scope, operation: restoreDaxOperation(model.operation, model.expression),
        columns: [...model.columns], savedModelId: model.id, includeInSeries: true,
        format: /^\s*PERCENTAGE\s*\(/i.test(model.expression) ? 'percent' : 'number' });
    }
    if (added.length) {
      this.pushUndo();
      this.daxModel = { ...this.daxModel, enabled: true, selectedMeasureId: added[0].id, measures: [...this.daxModel.measures, ...added] };
      this.restoreTileDaxModel(this.daxModel);
      this.computeTileValue();
    }
    if (errors.length) this.daxExpressionError = errors.join(' ');
    this.daxSavedModelSelectedIds = new Set();
    this.cdr.markForCheck();
  }

  removeDaxAddedToChartItem(id: string): void {
    this.removeDaxMeasure(id);
    this.cdr.markForCheck();
  }

  editDaxAddedToChartItem(id?: string): void {
    if (id) this.selectDaxMeasure(id);
    this.setDaxTab('create');
  }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly location: Location,
    private readonly widgetService: WidgetService,
    private readonly commonApi: CommonApiService,
    private readonly categoryService: CategoryService,
    private readonly cdr: ChangeDetectorRef,
    private readonly toastService: ToastService,
    private readonly layoutState: LayoutStateService,
    private readonly authService: AuthService,
    private readonly importedDatasetService: ImportedDatasetService,
    private readonly listRouteReuse: ListRouteReuseStrategy,
    private readonly daxModelService: DaxModelService,
  ) {}

  get isAdmin(): boolean { return this.authService.isAdmin(); }
  get wipLabel(): string { return this.isAdmin ? 'WIP Tiles' : 'My Tiles'; }

  get breadcrumbs() {
    return [
      { label: 'Charts & Tiles', route: '/charts-tiles' },
      { label: this.wipLabel, route: '/charts-tiles/wip-tiles' },
      { label: this.editId ? 'Edit Tile' : 'Build Tile' },
    ];
  }

  // ── Global filter bar (Country/Sector/.../Plant + Quick Range + From/To), same as Tile Details ──
  showGlobalFilter = true;
  filterFields = [
    { key: 'country', label: 'Country', options: [] as string[] },
    { key: 'sector', label: 'Sector', options: [] as string[] },
    { key: 'businessUnit', label: 'Business Unit', options: [] as string[] },
    { key: 'division', label: 'Division', options: [] as string[] },
    { key: 'cluster', label: 'Cluster', options: [] as string[] },
    { key: 'plant', label: 'Plant', options: [] as string[] },
  ];
  readonly quickRangeOptions = ['Today', 'Till Last Tuesday', 'This Week', 'This Month', 'Last Month', 'This Quarter', 'This Year', 'After'];
  filterValues: Record<string, GlobalFilterSelection> = {
    country: 'All', sector: 'All', businessUnit: 'All', division: 'All', cluster: 'All', plant: 'All',
  };
  quickRange = '';
  fromDate = '';
  toDate = '';
  private globalFilterClearState?: GlobalFilterClearState;

  get globalFilterClear(): GlobalFilterClearState {
    return this.globalFilterClearState ??= new GlobalFilterClearState();
  }
  private openGlobalFilterNameValue: string | null = null;

  get openGlobalFilterName(): string | null {
    return this.openGlobalFilterNameValue;
  }

  set openGlobalFilterName(name: string | null) {
    this.openGlobalFilterNameValue = name;
    // Closing a dropdown left in the "Clear all" state reverts that filter to All.
    const abandoned = this.globalFilterClear.release(name);
    if (abandoned) this.revertClearedGlobalFilter(abandoned.key);
  }

  clearGlobalFilterSelection(key: unknown, event: Event): void {
    event.stopPropagation();
    this.globalFilterClear.clear(key, this.openGlobalFilterName);
  }

  isGlobalFilterCleared(key: unknown): boolean {
    return this.globalFilterClear.isCleared(key);
  }

  private revertClearedGlobalFilter(key: unknown): void {
    if (hasGlobalSelection(this.filterValues[String(key)])) this.selectGlobalFilterOption(String(key), 'All');
  }
  private allPlants: PlantFilterDto[] = [];
  private globalFilterSub?: Subscription;
  private globalTablePreviewSub?: Subscription;
  private currentViewDetail: { connectionId: number; generatedSql: string; id: number } | null = null;

  toggleGlobalFilter(): void { this.showGlobalFilter = !this.showGlobalFilter; }

  clearAllFilters(): void {
    this.advancedFilters = [];
    this.advancedFilterRef?.clear();
    this.quickRange = '';
    this.resetGlobalFilterDateRange();
    this.openGlobalFilterName = null;
    this.showDateRangePopup = false;
    this.filterValues = {
      country: 'All', sector: 'All', businessUnit: 'All', division: 'All', cluster: 'All', plant: 'All',
    };
    this.autoSelectGlobalFilters();
    this.rebuildGlobalFilterOptions();
    this.reloadGlobalViewPreview();
    this.hydrateBreakdownValues();
  }

  private resetGlobalFilterDateRange(): void {
    const today = new Date();
    this.fromDate = `${today.getFullYear()}-01-01`;
    this.toDate = this.lastTuesday(today);
  }

  toggleGlobalFilterDropdown(name: string, event: Event): void {
    event.stopPropagation();
    this.openGlobalFilterName = this.openGlobalFilterName === name ? null : name;
  }

  selectGlobalFilterOption(name: string, value: string): void {
    if (name === 'quickRange') {
      this.quickRange = value;
      this.applyQuickRange(value);
      this.openGlobalFilterName = null;
      this.reloadGlobalViewPreview();
      return;
    }
    const fieldIndex = this.filterFields.findIndex(field => field.key === name);
    if (this.isGlobalFilterLocked(fieldIndex)) return;
    this.filterValues[name] = value === 'All'
      ? 'All'
      : toggleGlobalSelection(this.filterValues[name] ?? 'All', value, this.filterFields.find(field => field.key === name)?.options, this.globalFilterClear.consume(name));
    const hierarchy = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
    const index = hierarchy.indexOf(name);
    for (let i = index + 1; i < hierarchy.length; i++) this.filterValues[hierarchy[i]] = 'All';
    this.rebuildGlobalFilterOptions();
    this.openGlobalFilterName = null;
    this.reloadGlobalViewPreview();
    // Table tiles don't reload via the view preview path above, so recompute their value directly.
    if (this.dataSourceMode === 'table') this.computeTileValue();
    this.hydrateBreakdownValues();
  }

  globalSelectionLabel(selection: GlobalFilterSelection | null | undefined): string {
    return globalSelectionLabel(selection);
  }

  hasSelectedGlobalFilter(name: string): boolean {
    return hasGlobalSelection(this.filterValues[name]);
  }

  isGlobalFilterOptionSelected(name: string, option: string): boolean {
    return isGlobalFilterOptionChecked(this.filterValues[name], option);
  }

  isGlobalFilterLocked(index: number): boolean {
    return !this.isAdmin && this.filterFields[index].options.length === 1;
  }

  private loadGlobalFilters(): void {
    this.globalFilterSub = this.commonApi.getPlantFilters().subscribe({
      next: plants => {
        this.allPlants = plants;
        this.filterFields[0].options = this.distinctPlantValues(plants, p => p.country);
        this.autoSelectGlobalFilters();
        this.rebuildGlobalFilterOptions();
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  private rebuildGlobalFilterOptions(): void {
    const active = (value: GlobalFilterSelection) => hasGlobalSelection(value);
    const selectors: ((plant: PlantFilterDto) => string)[] = [
      p => p.country, p => p.sector, p => p.businessUnit, p => p.division, p => p.cluster, p => p.plantDescription,
    ];
    const keys = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
    let filtered = this.allPlants;
    for (let i = 0; i < keys.length - 1; i++) {
      if (active(this.filterValues[keys[i]])) filtered = filtered.filter(plant => matchesGlobalSelection(selectors[i](plant), this.filterValues[keys[i]]));
      this.filterFields[i + 1].options = active(this.filterValues[keys[i]])
        ? this.distinctPlantValues(filtered, selectors[i + 1])
        : [];
    }
    if (!active(this.filterValues['cluster']) && hasGlobalSelection(this.filterValues['division']) && this.filterFields[4].options.length === 1) {
      this.filterValues['cluster'] = this.filterFields[4].options[0];
    }
    if (active(this.filterValues['cluster'])) filtered = filtered.filter(plant => matchesGlobalSelection(plant.cluster, this.filterValues['cluster']));
    this.filterFields[5].options = this.distinctPlantValues(filtered, selectors[5]);
    if (!active(this.filterValues['plant']) && this.filterFields[5].options.length === 1) {
      this.filterValues['plant'] = this.filterFields[5].options[0];
    }
  }

  private autoSelectGlobalFilters(): void {
    const active = (value: GlobalFilterSelection) => hasGlobalSelection(value);
    const selectors: ((plant: PlantFilterDto) => string)[] = [
      p => p.country, p => p.sector, p => p.businessUnit, p => p.division, p => p.cluster, p => p.plantDescription,
    ];
    const keys = ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant'];
    if (this.filterFields[0].options.length === 1) this.filterValues['country'] = this.filterFields[0].options[0];
    let filtered = this.allPlants;
    for (let i = 0; i < keys.length - 1; i++) {
      if (active(this.filterValues[keys[i]])) filtered = filtered.filter(plant => matchesGlobalSelection(selectors[i](plant), this.filterValues[keys[i]]));
      const options = this.distinctPlantValues(filtered, selectors[i + 1]);
      if (options.length === 1 && active(this.filterValues[keys[i]])) this.filterValues[keys[i + 1]] = options[0];
    }
  }

  private applyQuickRange(range: string): void {
    const today = new Date();
    const start = new Date(today);
    if (range === 'Today') {
      // Keep today's date in both fields.
    } else if (range === 'Till Last Tuesday') {
      const daysSinceTuesday = (today.getDay() + 5) % 7;
      start.setDate(today.getDate() - daysSinceTuesday - 7);
    } else if (range === 'This Week') {
      start.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    } else if (range === 'This Month') {
      start.setDate(1);
    } else if (range === 'Last Month') {
      const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
      start.setFullYear(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
      this.fromDate = this.toInputDate(start);
      this.toDate = this.toInputDate(lastMonthEnd);
      return;
    } else if (range === 'This Quarter') {
      start.setMonth(Math.floor(today.getMonth() / 3) * 3, 1);
    } else if (range === 'This Year') {
      start.setMonth(0, 1);
    } else if (range === 'After') {
      this.toDate = '';
      return;
    } else {
      return;
    }
    this.fromDate = this.toInputDate(start);
    this.toDate = this.toInputDate(today);
  }

  private toInputDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // ── Date range popup (From/To dual-calendar picker) ─────
  showDateRangePopup = false;
  dateRangeAnchorTop = 0;
  dateRangeAnchorLeft = 0;
  dateRangeMaxHeight = 0;

  openDateRangePopup(event: Event): void {
    event.stopPropagation();

    // Anchor to the clicked From/To field and keep the popup inside the viewport on any screen size.
    const placement = dateRangePopupPlacement(event);
    this.dateRangeAnchorLeft = placement.left;
    this.dateRangeAnchorTop = placement.top;
    this.dateRangeMaxHeight = placement.maxHeight;
    this.showDateRangePopup = true;
  }

  onDateRangeApply(range: { from: string; to: string }): void {
    this.fromDate = range.from;
    this.toDate = range.to;
    this.showDateRangePopup = false;
    this.onGlobalDateChange();
  }

  onDateRangeCancel(): void {
    this.showDateRangePopup = false;
  }

  /** mm-dd-yyyy display for the From/To trigger fields (matches app-date-input formatting). */
  formatFilterDate(iso: string): string {
    const parts = (iso || '').split('-');
    if (parts.length !== 3) return '';
    const [y, m, d] = parts;
    if (!y || !m || !d) return '';
    return `${m}-${d}-${y}`;
  }

  onGlobalDateChange(): void {
    this.reloadGlobalViewPreview();
    this.hydrateBreakdownValues();
  }

  private reloadGlobalViewPreview(): void {
    this.globalTablePreviewSub?.unsubscribe();
    if (this.dataSourceMode === 'table' && this.selectedDataSourceId) {
      const sourceType = this.selectedDataSource?.modelType ?? 'Table';
      const filters = this.globalHierarchyFilterPayload();
      const data$ = filters.length
        ? this.widgetService.getFilteredChartData({
            chartSource: this.selectedDataSourceId,
            chartSourceType: sourceType,
            viewId: null,
            filters,
          })
        : this.widgetService.getTableData(this.selectedDataSourceId, sourceType);
      this.globalTablePreviewSub = data$.subscribe({
        next: res => {
          this.columnsForSource = res.columns ?? [];
          this.tableRows = filters.length ? this.applyGlobalRowFilter(res.rows ?? []) : (res.rows ?? []);
          this.computeTileValue();
          this.cdr.markForCheck();
        },
        error: () => {
          this.liveValue = null;
          this.cdr.markForCheck();
        },
      });
      return;
    }
    if (this.dataSourceMode !== 'view' || !this.currentViewDetail) return;
    this.globalTablePreviewSub = this.commonApi.previewView({
      connectionId: this.currentViewDetail.connectionId,
      sql: this.injectGlobalFilterParams(this.currentViewDetail.generatedSql),
      viewId: this.currentViewDetail.id,
      maxRows: 1000,
      filters: this.globalHierarchyFilterPayload(),
    }).subscribe({
      next: (res) => {
        this.columnsForSource = res.columns ?? [];
        this.tableRows = res.rows ?? [];
        this.computeTileValue();
        this.cdr.markForCheck();
      },
      error: () => {
        this.liveValue = null;
        this.saveError.set('Failed to reload tile data with the selected filters.');
        this.cdr.markForCheck();
      },
    });
  }

  private lastTuesday(date: Date): string {
    const result = new Date(date);
    const daysSinceTuesday = (result.getDay() + 5) % 7;
    result.setDate(result.getDate() - daysSinceTuesday);
    return this.toInputDate(result);
  }

  /** Re-fetches each breakdown row's "1st value" live, honoring Cluster/Plant for view sources (same mechanism as the tile's own live value). */
  private hydrateBreakdownValues(): void {
    this.breakdownRows.forEach(row => {
      if (!row.sourceName || !row.column) return;
      const sourceType = row.sourceType ?? 'Table';
      const isView = sourceType === 'View';
      const value$ = isView
        ? this.commonApi.getDatabaseViews('view').pipe(
            switchMap(views => {
              const view = views.find(v => v.viewName === row.sourceName);
              if (!view) return of(0);
              return this.commonApi.getDatabaseViewById(view.id).pipe(
                switchMap(detail => this.commonApi.previewView({
                  connectionId: detail.connectionId,
                  sql: this.injectGlobalFilterParams(detail.generatedSql),
                  viewId: detail.id,
                  maxRows: 1000,
                  filters: this.globalHierarchyFilterPayload(true),
                })),
                map(res => Number(this.applyGlobalRowFilter(res.rows ?? [])[0]?.[row.column!] ?? 0) || 0),
              );
            }),
            catchError(() => of(0)),
          )
        // Table → server-side aggregate with the global Cluster/Plant as best-effort FK-joined filters.
        : this.commonApi.getBreakdownValueFiltered({ sourceName: row.sourceName!, sourceType, column: row.column!,
            filters: tableClusterPlantFilters(this.filterValues['cluster'], this.filterValues['plant']) });
      value$.subscribe(v => { row.value = String(v); this.cdr.markForCheck(); });
    });
  }

  /** Finds a row's column whose name matches (or contains) the given keyword, case-insensitive. */
  private findColumn(row: Record<string, unknown>, keyword: string): string | null {
    const lower = keyword.toLowerCase();
    const exact = Object.keys(row).find(k => k.toLowerCase() === lower);
    if (exact) return exact;
    return Object.keys(row).find(k => k.toLowerCase().includes(lower)) ?? null;
  }

  /** Client-side Cluster/Plant filter for Table-sourced rows (table sources have no SQL @cluster/@plant params to piggyback on, unlike views). */
  private applyGlobalRowFilter(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    const columns: Record<string, string> = {
      country: 'country', sector: 'sector', businessUnit: 'business_unit',
      division: 'division', cluster: 'cluster', plant: 'plant_description',
    };
    return rows.filter(row => Object.entries(columns).every(([key, column]) => {
      const selection = this.filterValues[key];
      if (!hasGlobalSelection(selection)) return true;
      const names = new Set([key, column].map(name => name.toLowerCase().replace(/[^a-z0-9]/g, '')));
      const found = Object.keys(row).find(name => names.has(name.toLowerCase().replace(/[^a-z0-9]/g, '')));
      return found === undefined || matchesGlobalSelection(row[found], selection);
    }));
  }

  private advancedFilters: ReturnType<typeof advancedHierarchyFilters> = [];
  @ViewChild('advancedFilter') private advancedFilterRef?: AdvancedFilterComponent;

  applyAdvancedFilter(value: AdvancedFilterValue): void {
    this.advancedFilters = advancedHierarchyFilters(value.hierarchy);
    this.onGlobalDateChange();
  }

  private globalHierarchyFilterPayload(isView = this.dataSourceMode === 'view'): ReturnType<typeof advancedHierarchyFilters> {
    const columns: Record<string, string> = {
      country: 'country', sector: 'sector', businessUnit: 'business_unit', division: 'division',
      cluster: 'cluster', plant: 'plant_description',
    };
    return [...Object.entries(columns)
      .filter(([key]) => hasGlobalSelection(this.filterValues[key]))
      .map(([key, column]) => ({
        globalHierarchy: true,
        sourceTable: column,
        sourceColumn: column,
        ...globalSelectionPayload(this.filterValues[key]),
        label: column,
      })), ...(isView ? this.advancedFilters ?? [] : [])];
  }

  private injectGlobalFilterParams(sql: string): string {
    const declarations: Record<string, GlobalFilterSelection> = {
      country: this.filterValues['country'],
      sector: this.filterValues['sector'],
      businessUnit: this.filterValues['businessUnit'],
      division: this.filterValues['division'],
      cluster: this.filterValues['cluster'],
      plant: this.filterValues['plant'],
    };
    for (const [name, value] of Object.entries(declarations)) {
      if (typeof value !== 'string' || !value || value === 'All' || !/^[A-Za-z0-9\s\-_.,()]+$/.test(value)) continue;
      const parameter = `@${name}`;
      const declaration = new RegExp(`DECLARE\\s+${parameter}\\s+(\\w+(?:\\s*\\([^)]*\\))?)(?:\\s*=[^;]+)?;`, 'i');
      if (declaration.test(sql)) {
        sql = sql.replace(declaration, `DECLARE ${parameter} $1 = '${value}';`);
      } else if (new RegExp(`\\b${parameter}\\b`, 'i').test(sql)) {
        sql = `DECLARE ${parameter} VARCHAR(100) = '${value}';\n${sql}`;
      }
    }
    for (const [parameter, value] of [['start_date', this.fromDate], ['end_date', this.toDate]] as const) {
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
      const declaration = new RegExp(`DECLARE\\s+@${parameter}\\s+(\\w+(?:\\s*\\([^)]*\\))?)(?:\\s*=[^;]+)?;`, 'i');
      if (declaration.test(sql)) sql = sql.replace(declaration, `DECLARE @${parameter} $1 = '${value}';`);
    }
    return sql;
  }

  private distinctPlantValues(plants: PlantFilterDto[], selector: (plant: PlantFilterDto) => string): string[] {
    return [...new Set(plants.map(selector).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  ngOnInit(): void {
    // Default From/To (Jan 1 of current year → last Tuesday), same as the Tile View page.
    this.fromDate = `${new Date().getFullYear()}-01-01`;
    this.toDate = this.lastTuesday(new Date());

    // Collapse sidebar on enter; restore on leave
    this._prevSidebarState = this.layoutState.isCollapsed;
    this.layoutState.collapse();

    // Sync panel with sidebar state
    this._sidebarSub = this.layoutState.sidebarCollapsed$.subscribe(collapsed => {
      this.panelCollapsed = !collapsed;
      this.cdr.markForCheck();
    });

    const params = this.route.snapshot.queryParamMap;
    this.returnUrl = params.get('returnUrl') || this.returnUrl;
    const editIdParam = params.get('editId');
    const name = params.get('name');
    const description = params.get('description');
    const category = params.get('category');
    const categoryIdParam = params.get('categoryId');
    if (name) this.tileTitle = name;
    if (description) this.tileDescription = description;
    if (category) this.category = category;
    if (categoryIdParam) this.selectedCategoryId = Number(categoryIdParam);

    this.categorySub = this.categoryService.getCategoriesByType('tile').subscribe((cats) => {
      this.apiCategories = cats;
      this.categories = cats.map(c => c.categoryName);
      if (!this.category && cats.length > 0) { this.category = cats[0].categoryName; this.selectedCategoryId = cats[0].categoryId; }
    });

    if (editIdParam) {
      this.editId = Number(editIdParam);
      this.loadExistingTile(this.editId);
    }

    // Load KPI tile library entry from ControlPlane
    this.widgetService.getWidgetLibraryCharts().subscribe({
      next: (items) => {
        // find tile type from ControlPlane (type=tile not chart, but reuse same API with filter)
      },
      error: () => {},
    });

    // Load data sources from AlTasnimBI — same source used by getTableData for Table sources
    this.widgetService.getBISources().subscribe({
      next: (sources) => {
        if (sources?.length) {
          this.dataSources = sources.map(s => ({
            id: s.name, label: s.name, icon: 'derrick' as const,
            columns: s.columnCount, modelType: s.sourceType as 'Table' | 'View',
            iconBg: '#FEF3C7',
          }));
          // Leave the source unselected so the dropdown shows its "Select a table" placeholder.
          this.cdr.markForCheck();
        }
      },
      error: () => {},
    });

    // Load widget library tile entry
    this.widgetService.getWidgetLibraryByType('tile').subscribe({
      next: (items) => {
        const kpi = items.find(i => i.widgetName.toLowerCase() === 'kpi');
        if (kpi) this.selectedLibraryId = kpi.id;
      },
      error: () => {},
    });

    this.loadGlobalFilters();
  }

  ngOnDestroy(): void {
    this.globalTablePreviewSub?.unsubscribe();
    this.tileValueSubscription?.unsubscribe();
    this.savedDaxModelsSubscription?.unsubscribe();
    // Restore previous sidebar state
    if (this._prevSidebarState !== undefined) {
      this._prevSidebarState ? this.layoutState.collapse() : this.layoutState.expand();
    }
    this._sidebarSub?.unsubscribe();
    this.categorySub?.unsubscribe();
    this.globalFilterSub?.unsubscribe();
    if (this.saveSuccessTimeout) clearTimeout(this.saveSuccessTimeout);
  }

  get activeTab(): BuilderTab | undefined {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  get selectedTileColorOption(): { value: TileColor; label: string; hex: string } {
    return this.tileColors.find(c => c.value === this.tileColor) ?? this.tileColors[0];
  }

  get selectedTileIconOption(): { value: TileIconId; label: string } {
    return this.tileIcons.find(i => i.value === this.tileIcon) ?? this.tileIcons[0];
  }

  get selectedBadgeColorOption(): { value: string; label: string; hex: string } {
    return this.badgeColorOptions.find(c => c.value === this.badgeColor) ?? this.badgeColorOptions[0];
  }

  startEditTitle(): void {
    this.editingTitle = true;
  }

  stopEditTitle(): void {
    this.editingTitle = false;
    if (!this.tileTitle.trim()) this.tileTitle = 'Tile Name';
  }

  toggleCategoryDropdown(): void {
    this.showCategoryDropdown = !this.showCategoryDropdown;
    if (this.showCategoryDropdown) this.categoryDropdownSearch = '';
  }

  selectCategory(category: string): void {
    this.pushUndo();
    this.category = category;
    const cat = this.apiCategories.find(c => c.categoryName === category);
    if (cat) this.selectedCategoryId = cat.categoryId;
    this.showCategoryDropdown = false;
  }

  toggleDataSourceDropdown(): void {
    this.showDataSourceDropdown = !this.showDataSourceDropdown;
    if (this.showDataSourceDropdown) { this.showColorDropdown = false; this.showIconDropdown = false; this.showValueColumnDropdown = false; }
  }

  toggleValueColumnDropdown(): void {
    this.showValueColumnDropdown = !this.showValueColumnDropdown;
    if (this.showValueColumnDropdown) { this.showDataSourceDropdown = false; this.showColorDropdown = false; this.showIconDropdown = false; }
    else { this.valueColumnSearch = ''; }
  }

  selectDataSource(source: DataSourceOption): void {
    this.pushUndo();
    this.showTablePreview = false;
    this.selectedDataSourceId = source.id;
    this.clearMissingSourceError();
    this.showDataSourceDropdown = false;
    this.dataSourceSearch = '';
    this.loadColumnsForSource(source.id, source.modelType);
  }

  switchDataSourceMode(mode: 'table' | 'view' | 'import'): void {
    if (this.dataSourceMode === mode) return;
    this.pushUndo();
    this.showTablePreview = false;
    this.dataSourceMode = mode;
    this.showDataSourceDropdown = false;
    this.dataSourceSearch = '';
    this.viewSearch = '';
    if (mode === 'view' && !this.availableViews.length) {
      this.loadDatabaseViews();
    }
    if (mode === 'import' && !this.availableImportDatasets.length) {
      this.loadImportedDatasets();
    }
    this.selectedDataSourceId = '';
    this.columnsForSource = []; this.tableRows = [];
    this.valueColumn = '';
    this.liveValue = null;
    this.cdr.markForCheck();
  }

  onImportDragOver(event: DragEvent): void {
    event.preventDefault();
    this.importDragOver = !this.importUploading;
  }

  onImportDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.importDragOver = false;
  }

  onImportDrop(event: DragEvent): void {
    event.preventDefault();
    this.importDragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (file) this.uploadImportFile(file);
  }

  onImportFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.uploadImportFile(file);
    input.value = '';
  }

  toggleImportPasteMode(): void {
    if (this.importUploading) return;
    this.importPasteMode = !this.importPasteMode;
    this.importPasteText = '';
    this.importUploadError = null;
  }

  submitPastedJson(): void {
    if (this.importUploading || !this.importPasteText.trim()) return;
    try {
      JSON.parse(this.importPasteText);
    } catch {
      this.importUploadError = 'That is not valid JSON.';
      return;
    }
    this.uploadImportFile(new File([this.importPasteText], 'pasted-data.json', { type: 'application/json' }));
  }

  uploadImportFile(file: File): void {
    if (this.importUploading) return;
    const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!this.importAllowedExtensions.includes(extension)) {
      this.importUploadError = `Unsupported file type '${extension}'. Allowed: csv, xlsx, xls, json.`;
      return;
    }
    if (file.size > this.importMaxFileSizeBytes) {
      this.importUploadError = 'File exceeds the 8MB limit.';
      return;
    }
    const tabId = this.activeTabId;
    const sourceId = this.selectedDataSourceId;
    this.importUploadError = null;
    this.importUploading = true;
    this.importedDatasetService.upload(file).subscribe({
      next: (dto) => {
        this.importUploading = false;
        this.importPasteMode = false;
        this.importPasteText = '';
        const item: ImportedDatasetListItem = {
          id: dto.id, datasetName: dto.datasetName, fileName: dto.fileName,
          fileType: dto.fileType, rowCount: dto.rowCount, status: dto.status,
          createdAt: new Date().toISOString(),
        };
        this.availableImportDatasets = [item, ...this.availableImportDatasets.filter(dataset => dataset.id !== item.id)];
        if (this.activeTabId === tabId && this.dataSourceMode === 'import' && this.selectedDataSourceId === sourceId) {
          this.selectImportDataset(item);
        }
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.importUploading = false;
        const messages: unknown[] = [
          error?.error?.error?.message,
          error?.error?.error,
          error?.error?.message,
          error?.error?.detail,
          error?.error?.title,
          error?.error,
        ];
        this.importUploadError = messages.find((message): message is string =>
          typeof message === 'string' && !!message.trim(),
        ) ?? 'Failed to import file. Please try again.';
        this.cdr.markForCheck();
      },
    });
  }

  pendingImportDelete: ImportedDatasetListItem | null = null;
  importDeleteBusy = false;
  importDeleteError: string | null = null;

  clearImportSelection(): void {
    this.selectedDataSourceId = '';
    this.columnsForSource = [];
    this.tableRows = [];
    this.valueColumn = '';
    this.liveValue = null;
    this.showTablePreview = false;
    this.importPasteMode = false;
    this.importPasteText = '';
    this.importSearch = '';
    this.importUploadError = null;
    this.cdr.markForCheck();
  }

  deleteImportDataset(item: ImportedDatasetListItem, event: Event): void {
    event.stopPropagation();
    if (this.importDeleteBusy) return;
    this.pendingImportDelete = item;
    this.importDeleteError = null;
    this.showDataSourceDropdown = false;
  }

  cancelDeleteImportDataset(): void {
    if (this.importDeleteBusy) return;
    this.pendingImportDelete = null;
    this.importDeleteError = null;
  }

  confirmDeleteImportDataset(): void {
    const item = this.pendingImportDelete;
    if (!item || this.importDeleteBusy) return;
    this.importDeleteBusy = true;
    this.importDeleteError = null;
    this.importedDatasetService.delete(item.id).subscribe({
      next: () => {
        this.availableImportDatasets = this.availableImportDatasets.filter(dataset => dataset.id !== item.id);
        if (this.dataSourceMode === 'import' && this.selectedDataSourceId === String(item.id)) {
          this.clearImportSelection();
        }
        for (const state of [...this.tabStates.values(), ...this.undoStack, ...this.redoStack]) {
          if (state.dataSourceMode === 'import' && state.selectedDataSourceId === String(item.id)) {
            state.selectedDataSourceId = '';
            state.valueColumn = '';
          }
        }
        this.importDeleteBusy = false;
        this.pendingImportDelete = null;
        this.showSaveSuccess(`Imported dataset "${item.datasetName}" deleted successfully.`);
        this.cdr.markForCheck();
      },
      error: () => {
        this.importDeleteBusy = false;
        this.importDeleteError = 'Could not delete the imported dataset. Please try again.';
        this.cdr.markForCheck();
      },
    });
  }

  private loadImportedDatasets(): void {
    this.importedDatasetService.list().subscribe({
      next: (datasets) => {
        this.availableImportDatasets = datasets;
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  /**
   * Picks an imported dataset as the tile's source. Datasets are addressed by id (not name),
   * matching the chart builder and the 'Import' branch in widget-view.
   */
  selectImportDataset(item: ImportedDatasetListItem): void {
    this.pushUndo();
    this.showTablePreview = false;
    this.selectedDataSourceId = String(item.id);
    this.clearMissingSourceError();
    this.showDataSourceDropdown = false;
    this.importSearch = '';
    this.loadColumnsForSource(String(item.id), 'Import');
    this.cdr.markForCheck();
  }

  private loadDatabaseViews(): void {
    this.commonApi.getDatabaseViews('view').subscribe({
      next: (views) => {
        this.availableViews = views;
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  toggleDrillDownDropdown(): void {
    this.showDrillDownDropdown = !this.showDrillDownDropdown;
    if (this.showDrillDownDropdown && !this.drillDownViews.length) {
      this.commonApi.getDatabaseViews('view').subscribe({ next: (views) => { this.drillDownViews = views; this.cdr.markForCheck(); } });
    }
    this.cdr.markForCheck();
  }

  selectDrillDownView(view: DatabaseViewListItem): void {
    this.pushUndo();
    this.drillDownViewId = view.id;
    this.drillDownViewName = view.viewName;
    this.showDrillDownDropdown = false;
    this.drillDownSearch = '';
    this.cdr.markForCheck();
  }

  removeDrillDownView(): void {
    this.pushUndo();
    this.drillDownViewId = null;
    this.drillDownViewName = '';
    this.cdr.markForCheck();
  }

  selectView(view: DatabaseViewListItem): void {
    this.pushUndo();
    this.showTablePreview = false;
    this.columnsForSource = [];
    this.tableRows = [];
    this.valueColumn = '';
    this.liveValue = null;
    this.selectedDataSourceId = view.viewName;
    this.clearMissingSourceError();
    this.showDataSourceDropdown = false;
    this.viewSearch = '';
    // fetch full view to get generatedSql (not included in list response)
    this.commonApi.getDatabaseViewById(view.id).subscribe({
      next: (detail) => {
        this.currentViewDetail = detail;
        this.commonApi.previewView({
          connectionId: detail.connectionId,
          sql: this.injectGlobalFilterParams(detail.generatedSql),
          viewId: detail.id,
          maxRows: 1000,
          filters: this.globalHierarchyFilterPayload(true),
        }).subscribe({
          next: (res) => {
            this.columnsForSource = res.columns ?? [];
            this.tableRows = res.rows ?? [];
            this.valueColumn = '';
            this.computeTileValue();
            this.cdr.markForCheck();
          },
          error: () => {},
        });
      },
      error: () => {},
    });
    this.cdr.markForCheck();
  }

  private loadColumnsForSource(name: string, sourceType: string, preserveColumn = false): void {
    this.columnsForSource = [];
    this.tableRows = [];
    this.liveValue = null;
    if (!preserveColumn) this.valueColumn = '';
    this.widgetService.getTableData(name, sourceType).subscribe({
      next: (res) => {
        if (sourceType === 'Import' && (this.dataSourceMode !== 'import' || this.selectedDataSourceId !== name)) return;
        this.columnsForSource = res.columns ?? [];
        this.tableRows = res.rows ?? [];
        if (!preserveColumn) this.valueColumn = '';
        this.computeTileValue();
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  selectValueColumn(col: string): void {
    this.pushUndo();
    this.showTablePreview = false;
    this.saveError.set('');
    this.valueColumn = col;
    this.showValueColumnDropdown = false;
    this.valueColumnSearch = '';
    this.computeTileValue();
    this.cdr.markForCheck();
  }

  private computeTileValue(preserveDraftPreview = false): void {
    this.tileValueSubscription?.unsubscribe();
    this.daxExpressionError = '';
    if (preserveDraftPreview && this.daxEnabled && !this.selectedDaxMeasure?.expression?.trim()) {
      this.cdr.markForCheck();
      return;
    }
    this.tileValueLoading = true;
    try { getTileDaxRequest(this.effectiveDaxModel(), this.columnsForSource); }
    catch (error) {
      this.setTileValue(null);
      this.daxExpressionError = error instanceof Error ? error.message : 'Invalid tile DAX measure.';
      this.cdr.markForCheck();
      return;
    }
    // Table sources aggregate server-side so the value is correct on multi-million-row tables
    // (the browser only holds the first 1000 rows). Views keep the row-based path — their SQL
    // already runs on the server via previewView.
    if (this.dataSourceMode === 'table' && this.selectedDataSourceId) {
      this.computeTileValueFromServer();
    } else {
      this.setTileValue(null);
      this.computeTileValueFromRows();
    }
  }

  /** The previous value stays on screen while a new one loads, so the tile doesn't flash the empty canvas. */
  private setTileValue(value: number | null): void {
    this.liveValue = value;
    this.previewFormatMeasure = undefined;
    this.tileValueLoading = false;
  }

  private computeTileValueFromServer(): void {
    const needsColumn = !this.tileDaxActive && this.calculation !== 'count';
    if (needsColumn && !this.valueColumn) { this.setTileValue(null); this.cdr.markForCheck(); return; }
    const sourceType = this.selectedDataSource?.modelType ?? 'Table';
    // Dev's global hierarchy (resolved by column name) + our FK Cluster/Plant for code-based Table tiles.
    const tableGlobals = !this.daxEnabled && sourceType.toLowerCase() === 'table'
      ? tableClusterPlantFilters(this.filterValues['cluster'], this.filterValues['plant']) : [];
    const globalFilters = [...this.globalHierarchyFilterPayload(), ...tableGlobals];
    if (globalFilters.length) {
      this.tileValueSubscription = this.widgetService.getFilteredChartData({
        chartSource: this.selectedDataSourceId,
        chartSourceType: sourceType,
        viewId: null,
        filters: globalFilters,
        aggregation: this.calculation,
        valueField: this.valueColumn || undefined,
        daxModel: this.daxModel,
      }).subscribe({
        next: res => {
          let value = Number(res.rows[0]?.['Value'] ?? 0);
          if (!this.daxEnabled && this.calculation === 'average') value = Math.round(value * 100) / 100;
          this.setTileValue(value);
          this.cdr.markForCheck();
        },
        error: error => {
          this.setTileValue(null);
          this.daxExpressionError = error?.error?.error ?? error?.message ?? 'Failed to calculate filtered tile value.';
          this.cdr.markForCheck();
        },
      });
      return;
    }
    this.tileValueSubscription = this.commonApi.getAggregate({
      sourceName: this.selectedDataSourceId,
      sourceType,
      aggregation: this.calculation,
      valueField: this.valueColumn || undefined,
      daxModel: this.effectiveDaxModel(),
    }).subscribe({
      next: (res) => {
        let v = res.value ?? 0;
        if (!this.tileDaxActive && this.calculation === 'average') v = Math.round(v * 100) / 100;
        this.setTileValue(v);
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.setTileValue(null);
        if (this.tileDaxActive) this.daxExpressionError = error?.error?.error ?? error?.message ?? 'DAX calculation failed.';
        this.cdr.markForCheck();
      },
    });
  }

  private computeTileValueFromRows(rows: Record<string, unknown>[] = this.tableRows): void {
    const daxValue = evaluateTileDaxValue(this.tableRows, this.effectiveDaxModel(), this.columnsForSource);
    if (daxValue !== undefined) { this.liveValue = daxValue; return; }
    if (!rows.length) { this.liveValue = null; return; }
    if (this.calculation === 'count') {
      this.liveValue = this.valueColumn
        ? rows.filter(r => { const v = r[this.valueColumn]; return v !== null && v !== undefined && v !== ''; }).length
        : rows.length;
    } else if (this.calculation === 'countDistinct' && this.valueColumn) {
      this.liveValue = new Set(rows.map(r => r[this.valueColumn]).filter(v => v !== null && v !== undefined && v !== '')).size;
    } else if (this.calculation === 'value' && this.valueColumn) {
      this.liveValue = Number(rows[0]?.[this.valueColumn] ?? 0) || 0;
    } else if (this.calculation === 'total' && this.valueColumn) {
      this.liveValue = rows.reduce((sum, row) => sum + (Number(row[this.valueColumn] ?? 0) || 0), 0);
    } else if (this.calculation === 'average' && this.valueColumn) {
      const sum = rows.reduce((s, row) => s + (Number(row[this.valueColumn] ?? 0) || 0), 0);
      this.liveValue = Math.round((sum / rows.length) * 100) / 100;
    } else {
      // Operation needs a column but none is picked yet → show no value.
      this.liveValue = null;
    }
  }

  setCalculation(value: CalculationType): void {
    this.pushUndo();
    this.calculation = value;
    this.computeTileValue();
    this.cdr.markForCheck();
  }

  addFilter(): void {
    const source = this.selectedDataSourceId || '';
    this.interactiveFilters.push({ id: this.nextFilterId++, label: '', controlType: 'Dropdown', sourceTable: source, sourceColumn: this.columnsForSource[0] ?? '' });
    this.cdr.markForCheck();
  }

  removeFilter(id: number): void {
    this.interactiveFilters = this.interactiveFilters.filter(f => f.id !== id);
    this.cdr.markForCheck();
  }

  toggleColorDropdown(): void {
    this.showColorDropdown = !this.showColorDropdown;
    if (this.showColorDropdown) { this.showDataSourceDropdown = false; this.showIconDropdown = false; }
  }

  selectColor(value: TileColor): void {
    this.pushUndo();
    this.tileColor = value;
    this.showColorDropdown = false;
  }

  toggleIconDropdown(): void {
    this.showIconDropdown = !this.showIconDropdown;
    if (this.showIconDropdown) { this.showDataSourceDropdown = false; this.showColorDropdown = false; }
  }

  selectIcon(value: TileIconId): void {
    this.pushUndo();
    this.tileIcon = value;
    this.showIconDropdown = false;
  }

  toggleShowTileIcon(): void {
    this.pushUndo();
    this.showTileIcon = !this.showTileIcon;
  }

  setTileLayout(layout: TileLayout): void {
    if (this.tileLayout === layout) return;
    this.pushUndo();
    this.tileLayout = layout;
  }

  toggleValueBold(): void {
    this.pushUndo();
    this.valueBold = !this.valueBold;
  }

  toggleValueItalic(): void {
    this.pushUndo();
    this.valueItalic = !this.valueItalic;
  }

  setValueColor(color: string): void {
    this.pushUndo();
    this.valueColor = color;
  }

  toggleBadgeColorDropdown(): void {
    this.showBadgeColorDropdown = !this.showBadgeColorDropdown;
  }

  selectBadgeColor(value: string): void {
    this.pushUndo();
    this.badgeColor = value;
    this.showBadgeColorDropdown = false;
  }

  toggleNumberFormatting(): void {
    this.numberFormattingOpen = !this.numberFormattingOpen;
  }

  toggleBadgeSection(): void {
    this.badgeOpen = !this.badgeOpen;
  }

  // ─── Help modal ───────────────────────────────────────────
  showHelpModal = false;
  helpSearchTerm = '';
  helpVote: 'yes' | 'no' | null = null;
  helpArticles: TileHelpArticle[] = [
    {
      id: 'data-source',
      question: 'How do I choose a data source?',
      expanded: false,
      steps: [
        'In Data Source, choose Table, View, or Import.',
        'Select the table or view to use, or choose an imported dataset. The available columns load for the selected source.',
        'Use the live preview to check the tile value before saving.',
      ],
    },
    {
      id: 'calculation',
      question: 'How do I calculate the tile value?',
      expanded: false,
      steps: [
        'In the calculation controls, choose Value, Count, Count Distinct, Total, or Average.',
        'Select a value column when the chosen calculation requires one. Count can count all records without a column.',
        'Value shows the first row’s selected column value; Count counts records or non-empty column values; Count Distinct counts unique values; Total sums a numeric column; Average calculates its mean.',
      ],
    },
    {
      id: 'visual-settings',
      question: 'How do I customize the tile appearance and number?',
      expanded: false,
      steps: [
        'Open Visual Settings to choose a tile color and icon.',
        'Open Number Formatting to add a prefix or suffix, set decimal places, and choose whether to shorten large numbers.',
        'Use the badge controls to add badge text and choose its color. Review the preview as you make changes.',
      ],
    },
    {
      id: 'breakdown',
      question: 'How do I add breakdown details?',
      expanded: false,
      steps: [
        'Add a row in the breakdown section and enter its label and value.',
        'Choose a source, column, and color for the row when you want its value to come from a data source.',
        'Remove a row with its delete control. Breakdown rows are optional.',
      ],
    },
    {
      id: 'dax-model',
      question: 'When should I use the DAX Model?',
      expanded: false,
      steps: [
        'Open the optional DAX Model section and enable it when the standard tile calculations do not meet your needs.',
        'Select or define a DAX measure and configure its expression and source columns.',
        'Resolve any validation errors and check the preview before saving.',
      ],
    },
    {
      id: 'filters',
      question: 'How do I filter the tile?',
      expanded: false,
      steps: [
        'Use Show Filter in the top toolbar to show or hide the workspace filter bar, then select the available filter values.',
        'In the interactive filters section, add a filter and set its label, control type, source table, and source column.',
        'Interactive filters let viewers narrow the tile data. Remove a filter using its row action.',
      ],
    },
    {
      id: 'save-tile',
      question: 'How do I save, update, or discard a tile?',
      expanded: false,
      steps: [
        'Enter a tile name, description, and category, then select a data source and complete any required calculation settings.',
        'Choose Save or Update to persist the tile and remain in the builder. Choose Save & Close to save and leave the builder.',
        'Choose Discard to leave without saving. If validation messages appear, complete the required fields and try again.',
      ],
    },
  ];

  get filteredHelpArticles(): TileHelpArticle[] {
    const term = this.helpSearchTerm.trim().toLowerCase();
    if (!term) return this.helpArticles;
    return this.helpArticles.filter(article =>
      `${article.question} ${article.steps.join(' ')}`.toLowerCase().includes(term),
    );
  }

  onHelpSearchChange(): void {
    const firstMatch = this.filteredHelpArticles[0];
    this.helpArticles.forEach(article => (article.expanded = article === firstMatch));
  }

  clearHelpSearch(): void {
    this.helpSearchTerm = '';
    this.helpArticles.forEach(article => (article.expanded = false));
  }

  openHelpModal(): void {
    this.helpSearchTerm = '';
    this.helpVote = null;
    this.helpArticles.forEach(article => (article.expanded = false));
    this.showHelpModal = true;
  }

  closeHelpModal(): void {
    this.showHelpModal = false;
    this.helpSearchTerm = '';
    this.helpVote = null;
  }

  toggleHelpArticle(article: TileHelpArticle): void {
    const shouldExpand = !article.expanded;
    this.helpArticles.forEach(a => (a.expanded = a.id === article.id && shouldExpand));
  }

  setHelpVote(vote: 'yes' | 'no'): void {
    this.helpVote = vote;
  }

  // ─── Learn modal ───────────────────────────────────────────
  showLearnModal = false;

  openLearnModal(): void { this.showLearnModal = true; }
  closeLearnModal(): void { this.showLearnModal = false; }

  addBreakdownRow(): void {
    this.pushUndo();
    const sourceType = this.dataSourceMode === 'view' ? 'View' : (this.selectedDataSource?.modelType ?? 'Table');
    const sourceName = this.selectedDataSourceId;
    this.breakdownRows.push({ id: this.nextRowId++, label: '', value: '', color: 'blue', sourceName, sourceType, column: '' });
    if (sourceName) this.loadBreakdownSource(sourceName, sourceType);
  }

  removeBreakdownRow(id: number): void {
    this.pushUndo();
    this.breakdownRows = this.breakdownRows.filter(r => r.id !== id);
  }

  breakdownColumnsCache: Record<string, string[]> = {};
  private breakdownFirstRow: Record<string, Record<string, unknown>> = {};

  /** Sources for a breakdown row's dropdown: tables or views per the main toggle. */
  get breakdownSourceOptions(): { name: string; label: string; type: string }[] {
    return this.dataSourceMode === 'view'
      ? this.availableViews.map(v => ({ name: v.viewName, label: v.viewName, type: 'View' }))
      : this.dataSources.map(d => ({ name: d.id, label: d.label, type: d.modelType ?? 'Table' }));
  }

  getBreakdownColumns(row: BreakdownRow): string[] {
    if (!row.sourceName) return [];
    if (this.breakdownColumnsCache[row.sourceName]) return this.breakdownColumnsCache[row.sourceName];
    this.loadBreakdownSource(row.sourceName, row.sourceType ?? 'Table');
    return [];
  }

  private loadBreakdownSource(sourceName: string, sourceType: string): void {
    if (this.breakdownColumnsCache[sourceName]) return;
    this.breakdownColumnsCache[sourceName] = [];
    const done = (res: { columns?: string[]; rows?: Record<string, unknown>[] }) => {
      this.breakdownColumnsCache[sourceName] = res.columns ?? [];
      this.breakdownFirstRow[sourceName] = res.rows?.[0] ?? {};
      this.cdr.markForCheck();
    };
    if (sourceType === 'View') {
      const view = this.availableViews.find(v => v.viewName === sourceName);
      if (!view) return;
      this.commonApi.getDatabaseViewById(view.id).subscribe({
        next: (detail) => this.commonApi.previewView({
          connectionId: detail.connectionId, sql: detail.generatedSql, viewId: detail.id, maxRows: 1000,
          filters: this.globalHierarchyFilterPayload(),
        }).subscribe({ next: done, error: () => {} }),
        error: () => {},
      });
    } else {
      this.widgetService.getTableData(sourceName, sourceType).subscribe({ next: done, error: () => {} });
    }
  }

  onBreakdownSourceChange(row: BreakdownRow): void {
    this.pushUndo();
    const opt = this.breakdownSourceOptions.find(s => s.name === row.sourceName);
    row.sourceType = opt?.type ?? 'Table';
    row.column = ''; row.label = ''; row.value = '';
    if (row.sourceName) this.loadBreakdownSource(row.sourceName, row.sourceType);
  }

  onBreakdownColumnChange(row: BreakdownRow): void {
    this.pushUndo();
    row.label = row.column ?? '';
    const first = row.sourceName ? this.breakdownFirstRow[row.sourceName] : undefined;
    const v = first?.[row.column ?? ''];
    row.value = (v === null || v === undefined || typeof v === 'object') ? '' : String(v);
  }

  // ── Custom (bounded) dropdown for the breakdown Source column ──
  // Replaces a native <select> whose OS popup overflowed the setup card.
  openBreakdownSourceRow: BreakdownRow | null = null;
  breakdownSourceSearch = '';

  toggleBreakdownSourceDropdown(row: BreakdownRow, event: Event): void {
    event.stopPropagation();
    this.showDataSourceDropdown = false;
    this.showColorDropdown = false;
    this.showIconDropdown = false;
    this.showCategoryDropdown = false;
    this.openBreakdownSourceRow = this.openBreakdownSourceRow === row ? null : row;
    this.breakdownSourceSearch = '';
  }

  /** Display label for a breakdown row's colour (tooltip on the narrow colour cell). */
  tileColorLabel(value: string | null | undefined): string | null {
    return this.tileColors.find(color => color.value === value)?.label ?? null;
  }

  getBreakdownSourceLabel(row: BreakdownRow): string {
    return this.breakdownSourceOptions.find(s => s.name === row.sourceName)?.label ?? 'Select source';
  }

  filteredBreakdownSourceOptions(): { name: string; label: string; type: string }[] {
    const t = this.breakdownSourceSearch.trim().toLowerCase();
    return t ? this.breakdownSourceOptions.filter(s => s.label.toLowerCase().includes(t)) : this.breakdownSourceOptions;
  }

  selectBreakdownSource(row: BreakdownRow, opt: { name: string; label: string; type: string } | null): void {
    row.sourceName = opt?.name ?? '';
    this.onBreakdownSourceChange(row);
    this.openBreakdownSourceRow = null;
  }

  @HostListener('document:click')
  closeAllDropdowns(): void {
    this.showDataSourceDropdown = false;
    this.showColorDropdown = false;
    this.showIconDropdown = false;
    this.showCategoryDropdown = false;
    this.showBadgeColorDropdown = false;
    this.openBreakdownSourceRow = null;
  }

  addPage(): void {
    this.showAddPageConfirm = true;
  }

  cancelAddPage(): void {
    this.showAddPageConfirm = false;
  }

  confirmAddPageDiscard(): void {
    this.showAddPageConfirm = false;
    this.openNewTileTab();
  }

  confirmAddPageSave(): void {
    if (!this.validateTileDaxForSave()) return;
    if (this.isTablePreviewVisible) {
      this.saveError.set('Select a column to return to the tile before saving.');
      return;
    }
    this.showAddPageConfirm = false;
    const tileName = this.tileTitle.trim();
    if (!tileName || tileName === 'Tile Name') { this.saveError.set('Please enter a tile name.'); return; }
    if (!this.tileDescription.trim()) { this.descriptionValidationError.set('Please enter a description.'); return; }
    this.descriptionValidationError.set('');
    const categoryId = this.resolvedCategoryId;
    if (categoryId === null) { this.saveError.set(CATEGORY_REQUIRED_MESSAGE); return; }

    this.isSaving.set(true); this.saveError.set('');
    const payload = {
      name: this.tileTitle, description: this.tileDescription, type: 'tile',
      libraryId: this.selectedLibraryId ?? 1002,
      source: this.selectedDataSourceId,
      sourceType: this.dataSourceMode === 'view' ? 'View'
                : this.dataSourceMode === 'import' ? 'Import'
                : (this.selectedDataSource?.modelType ?? 'Table'),
      sourceId: this.dataSourceMode === 'view' ? (this.selectedView?.id ?? null)
              : this.dataSourceMode === 'import' ? (Number(this.selectedDataSourceId) || null)
              : null,
      designJson: this.buildDesignJson(),
      categoryId,
    };
    const request$ = this.editId
      ? this.widgetService.updateWidget(this.editId, payload)
      : this.widgetService.createWidget(payload);
    request$.subscribe({
      next: () => {
        this.isSaving.set(false);
        const currentTab = this.tabs.find(t => t.id === this.activeTabId);
        if (currentTab) currentTab.label = this.tileTitle;
        this.openNewTileTab();
      },
      error: (err: unknown) => {
        this.isSaving.set(false);
        const msg = (err as any)?.error?.error ?? (err as any)?.message ?? 'Failed to save tile.';
        this.saveError.set(msg);
        this.cdr.markForCheck();
      },
    });
  }

  private openNewTileTab(): void {
    this.saveTabState(this.activeTabId);
    const id = `tile-${this.nextTabIndex}`;
    this.tabs.push({ id, label: `Tile ${this.nextTabIndex}` });
    this.nextTabIndex += 1;
    this.activeTabId = id;
    this.resetTileState();
    this.liveValue = null;
    this.cdr.markForCheck();
  }

  setActiveTab(id: string): void {
    if (id === this.activeTabId) return;
    this.saveTabState(this.activeTabId);          // save before switching
    this.activeTabId = id;
    this.restoreTabState(id);                     // load saved or defaults
    this.cdr.markForCheck();
  }

  closeTab(tab: BuilderTab): void {
    if (this.tabs.length <= 1) return;
    this.tabStates.delete(tab.id);
    const index = this.tabs.findIndex(t => t.id === tab.id);
    this.tabs = this.tabs.filter(t => t.id !== tab.id);
    if (this.activeTabId === tab.id) {
      const next = this.tabs[Math.max(0, index - 1)];
      this.activeTabId = next.id;
      this.restoreTabState(next.id);
    }
    this.cdr.markForCheck();
  }

  /** Snapshot current settings into the tab-state map */
  private saveTabState(id: string): void {
    this.tabStates.set(id, {
      daxModel: structuredClone(this.daxModel),
      tileTitle:           this.tileTitle,
      selectedDataSourceId: this.selectedDataSourceId,
      dataSourceMode:      this.dataSourceMode,
      viewId:              this.dataSourceMode === 'view' ? (this.selectedView?.id ?? null) : null,
      calculation:         this.calculation,
      valueColumn:         this.valueColumn,
      tileColor:           this.tileColor,
      tileIcon:            this.tileIcon,
      showTileIcon:        this.showTileIcon,
      tileLayout:          this.tileLayout,
      valueBold:           this.valueBold,
      valueItalic:         this.valueItalic,
      valueColor:          this.valueColor,
      prefix:              this.prefix,
      suffix:              this.suffix,
      decimalPlaces:       this.decimalPlaces,
      shortenBigNumbers:   this.shortenBigNumbers,
      badgeText:           this.badgeText,
      badgeColor:          this.badgeColor,
      breakdownRows:       this.breakdownRows.map(r => ({ ...r })),
      interactiveFilters:  this.interactiveFilters.map(f => ({ ...f })),
      drillDownViewId:     this.drillDownViewId,
    });
  }

  /** Restore settings from the tab-state map, or use defaults if first visit */
  private restoreTabState(id: string): void {
    this.showTablePreview = false;
    const s = this.tabStates.get(id);
    if (!s) { this.resetTileState(); this.liveValue = null; return; }
    this.restoreTileDaxModel(s.daxModel);
    this.tileTitle           = s.tileTitle;
    this.selectedDataSourceId = s.selectedDataSourceId;
    this.dataSourceMode      = s.dataSourceMode;
    this.calculation         = s.calculation;
    this.valueColumn         = s.valueColumn;
    this.tileColor           = s.tileColor;
    this.tileIcon            = s.tileIcon;
    this.showTileIcon        = s.showTileIcon ?? true;
    this.tileLayout          = resolveTileLayout(s.tileLayout);
    this.valueBold           = s.valueBold ?? false;
    this.valueItalic         = s.valueItalic ?? false;
    this.valueColor          = s.valueColor ?? '';
    this.prefix              = s.prefix;
    this.suffix              = s.suffix;
    this.decimalPlaces       = s.decimalPlaces;
    this.shortenBigNumbers   = s.shortenBigNumbers;
    this.badgeText           = s.badgeText;
    this.badgeColor          = s.badgeColor;
    this.breakdownRows       = s.breakdownRows.map(r => ({ ...r }));
    this.interactiveFilters  = s.interactiveFilters.map(f => ({ ...f }));
    this.drillDownViewId     = s.drillDownViewId ?? null;
    this.drillDownViewName   = this.drillDownViewId ? (this.drillDownViews.find(v => v.id === this.drillDownViewId)?.viewName ?? this.drillDownViewName) : '';
    // Reload columns for restored source (keep the restored column so preview reappears)
    const src = this.dataSources.find(d => d.id === this.selectedDataSourceId);
    if (src) { this.loadColumnsForSource(src.id, src.modelType, true); }
  }

  private resetTileState(): void {
    this.tileValueSubscription?.unsubscribe();
    this.restoreTileDaxModel();
    this.showTablePreview = false;
    this.tileTitle = 'Tile Name'; this.selectedDataSourceId = '';
    this.calculation = 'value'; this.valueColumn = '';
    // Clear the loaded source data too, so the Column dropdown/preview don't keep the previous source.
    this.columnsForSource = []; this.tableRows = []; this.valueColumnSearch = '';
    this.tileColor = 'blue'; this.tileIcon = 'well';
    this.showTileIcon = true; this.valueBold = false; this.valueItalic = false; this.valueColor = '';
    this.tileLayout = 'two-rows';
    this.prefix = ''; this.suffix = ''; this.decimalPlaces = 0; this.shortenBigNumbers = false;
    this.badgeText = ''; this.badgeColor = 'none';
    this.breakdownRows = [];
    this.interactiveFilters = [];
    this.drillDownViewId = null;
    this.drillDownViewName = '';
  }

  toggleLock(): void {
    this.locked = !this.locked;
  }

  private snapshotState(): TabState {
    return {
      daxModel: structuredClone(this.daxModel),
      tileTitle: this.tileTitle,
      selectedDataSourceId: this.selectedDataSourceId,
      dataSourceMode: this.dataSourceMode,
      viewId: this.dataSourceMode === 'view' ? (this.selectedView?.id ?? null) : null,
      calculation: this.calculation,
      valueColumn: this.valueColumn,
      tileColor: this.tileColor,
      tileIcon: this.tileIcon,
      showTileIcon: this.showTileIcon,
      tileLayout: this.tileLayout,
      valueBold: this.valueBold,
      valueItalic: this.valueItalic,
      valueColor: this.valueColor,
      prefix: this.prefix,
      suffix: this.suffix,
      decimalPlaces: this.decimalPlaces,
      shortenBigNumbers: this.shortenBigNumbers,
      badgeText: this.badgeText,
      badgeColor: this.badgeColor,
      breakdownRows: this.breakdownRows.map(r => ({ ...r })),
      interactiveFilters: this.interactiveFilters.map(f => ({ ...f })),
      drillDownViewId: this.drillDownViewId,
    };
  }

  private applyState(s: TabState): void {
    this.restoreTileDaxModel(s.daxModel);
    this.showTablePreview = false;
    this.tileTitle = s.tileTitle;
    this.selectedDataSourceId = s.selectedDataSourceId;
    this.dataSourceMode = s.dataSourceMode;
    this.calculation = s.calculation;
    this.valueColumn = s.valueColumn;
    this.tileColor = s.tileColor;
    this.tileIcon = s.tileIcon;
    this.showTileIcon = s.showTileIcon ?? true;
    this.tileLayout = resolveTileLayout(s.tileLayout);
    this.valueBold = s.valueBold ?? false;
    this.valueItalic = s.valueItalic ?? false;
    this.valueColor = s.valueColor ?? '';
    this.prefix = s.prefix;
    this.suffix = s.suffix;
    this.decimalPlaces = s.decimalPlaces;
    this.shortenBigNumbers = s.shortenBigNumbers;
    this.badgeText = s.badgeText;
    this.badgeColor = s.badgeColor;
    this.breakdownRows = s.breakdownRows.map(r => ({ ...r }));
    this.interactiveFilters = s.interactiveFilters.map(f => ({ ...f }));
    this.drillDownViewId = s.drillDownViewId ?? null;
    this.drillDownViewName = this.drillDownViewId ? (this.drillDownViews.find(v => v.id === this.drillDownViewId)?.viewName ?? this.drillDownViewName) : '';
    this.computeTileValue();
  }

  pushUndo(): void {
    if (this.locked) return;
    this.undoStack.push(this.snapshotState());
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.snapshotState());
    this.applyState(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshotState());
    this.applyState(next);
  }

  zoomIn(): void {
    this.zoomLevel = Math.min(200, this.zoomLevel + 10);
  }

  zoomOut(): void {
    this.zoomLevel = Math.max(50, this.zoomLevel - 10);
  }

  togglePanel(): void {
    this.panelCollapsed = !this.panelCollapsed;
  }

  requestClearAll(): void {
    this.showClearAllConfirm = true;
  }

  confirmClearAll(): void {
    this.pushUndo();
    this.resetTileState();
    this.liveValue = null;
    this.showClearAllConfirm = false;
  }

  cancelClearAll(): void {
    this.showClearAllConfirm = false;
  }

  showDiscardConfirm = false;

  discard(): void {
    this.showDiscardConfirm = true;
  }

  cancelDiscard(): void {
    this.showDiscardConfirm = false;
  }

  confirmDiscard(): void {
    this.showDiscardConfirm = false;
    this.router.navigateByUrl(this.returnUrl);
  }

  private loadExistingTile(id: number): void {
    this.widgetService.getWidgetById(id).subscribe({
      next: (widget) => {
        this.tileTitle = widget.name;
        this.tileDescription = widget.description ?? '';
        this.selectedCategoryId = widget.categoryId;
        this.selectedLibraryId = widget.libraryId;
        const catName = (widget as any).categoryName ?? this.apiCategories.find(c => c.categoryId === widget.categoryId)?.categoryName;
        if (catName) this.category = catName;

        let design: any = {};
        try { design = JSON.parse(widget.designJson || '{}'); } catch { /* ignore */ }
        this.restoreTileDaxModel(design.daxModel);
        if (this.daxEnabled && this.daxActiveTab === 'saved') this.loadSavedDaxModels();

        this.tileColor = design.tileColor ?? 'blue';
        this.tileIcon = design.tileIcon ?? 'well';
        this.showTileIcon = design.showTileIcon ?? true;
        this.tileLayout = resolveTileLayout(design.tileLayout);
        this.valueBold = design.valueBold ?? false;
        this.valueItalic = design.valueItalic ?? false;
        this.valueColor = design.valueColor ?? '';
        this.calculation = design.aggregation ?? 'count';
        this.valueColumn = design.valueField ?? '';
        this.prefix = design.prefix ?? '';
        this.suffix = design.suffix ?? '';
        this.decimalPlaces = design.decimalPlaces ?? 0;
        this.shortenBigNumbers = design.shortenBigNumbers ?? false;
        this.badgeText = design.badgeText ?? '';
        this.badgeColor = design.badgeColor ?? 'none';
        this.breakdownRows = design.breakdownRows ?? [];
        this.hydrateBreakdownValues();
        this.interactiveFilters = design.interactiveFilters ?? [];
        this.drillDownViewId = design.drillDownViewId ?? null;
        this.drillDownViewName = '';
        if (this.drillDownViewId) {
          this.commonApi.getDatabaseViews('view').subscribe({
            next: (views) => {
              this.drillDownViews = views;
              this.drillDownViewName = views.find(v => v.id === this.drillDownViewId)?.viewName ?? `View #${this.drillDownViewId}`;
              this.cdr.markForCheck();
            },
          });
        }

        // Restore data source mode and selection
        if (design.dataSourceMode === 'view') {
          this.dataSourceMode = 'view';
          this.selectedDataSourceId = design.source ?? '';
          this.commonApi.getDatabaseViews('view').subscribe({
            next: (views) => {
              this.availableViews = views;
              const match = views.find(v => v.id === widget.sourceId || v.viewName === this.selectedDataSourceId);
              if (match) {
                this.commonApi.getDatabaseViewById(match.id).subscribe({
                  next: (detail) => {
                    this.currentViewDetail = detail;
                    this.commonApi.previewView({
                      connectionId: detail.connectionId,
                      sql: this.injectGlobalFilterParams(detail.generatedSql),
                      viewId: detail.id,
                      maxRows: 1000,
                      filters: this.globalHierarchyFilterPayload(),
                    }).subscribe({
                      next: (res) => {
                        this.columnsForSource = res.columns ?? [];
                        this.tableRows = res.rows ?? [];
                        this.computeTileValue();
                        this.cdr.markForCheck();
                      },
                      error: () => {},
                    });
                  },
                  error: () => {},
                });
              }
              this.cdr.markForCheck();
            },
            error: () => {},
          });
        } else if (widget.sourceType === 'Import' || design.dataSourceMode === 'import') {
          // Imported datasets are addressed by id; the list is needed so the dropdown can
          // show the dataset's name rather than a bare number.
          this.dataSourceMode = 'import';
          this.selectedDataSourceId = String(widget.sourceId ?? widget.source ?? design.source ?? '');
          this.loadImportedDatasets();
          if (this.selectedDataSourceId) {
            this.loadColumnsForSource(this.selectedDataSourceId, 'Import', true);
          }
        } else {
          this.dataSourceMode = 'table';
          this.selectedDataSourceId = widget.source ?? design.source ?? '';
          if (this.selectedDataSourceId) {
            this.loadColumnsForSource(this.selectedDataSourceId, widget.sourceType ?? 'Table', true);
          }
        }

        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }


  /**
   * The category the widget will be filed under, or null when none is resolvable.
   *
   * There used to be a hardcoded `|| 2` fallback here. Category 2 does not exist in every
   * tenant, so when the category list failed to load the save was sent with an invalid FK and
   * died with an opaque "references a record that does not exist" database error. Blocking the
   * save with a clear message is both safer and diagnosable.
   */
  private get resolvedCategoryId(): number | null {
    return this.selectedCategoryId > 0 ? this.selectedCategoryId : null;
  }

  private buildDesignJson(): string {
    return JSON.stringify({
      daxModel: this.daxModel,
      tileType: 'kpi', title: this.tileTitle,
      source: this.selectedDataSourceId,
      sourceType: this.dataSourceMode === 'view' ? 'View'
            : this.dataSourceMode === 'import' ? 'Import'
            : (this.selectedDataSource?.modelType ?? 'Table'),
      dataSourceMode: this.dataSourceMode,
      viewId: this.dataSourceMode === 'view' ? this.selectedView?.id : undefined,
      valueField: this.valueColumn, aggregation: this.calculation,
      label: this.tileTitle, prefix: this.prefix, suffix: this.suffix,
      decimalPlaces: this.decimalPlaces, shortenBigNumbers: this.shortenBigNumbers,
      tileColor: this.tileColor, tileIcon: this.tileIcon,
      showTileIcon: this.showTileIcon, valueBold: this.valueBold, valueItalic: this.valueItalic, valueColor: this.valueColor,
      tileLayout: this.tileLayout,
      badgeText: this.badgeText, badgeColor: this.badgeColor,
      breakdownRows: this.breakdownRows,
      interactiveFilters: this.interactiveFilters.map(f => ({ ...f })),
      drillDownViewId: this.drillDownViewId,
    });
  }

  /** Save confirmation shown in place when the builder stays open (Save & Close hands it to the next page). */
  private showSaveSuccess(message: string): void {
    this.saveSuccess.set(message);
    if (this.saveSuccessTimeout) clearTimeout(this.saveSuccessTimeout);
    this.saveSuccessTimeout = setTimeout(() => { this.saveSuccess.set(''); this.cdr.markForCheck(); }, 4000);
    this.cdr.markForCheck();
  }

  private saveTile(closeAfterSave = false): void {
    if (!this.validateTileDaxForSave()) return;
    // Block the placeholder label 'Tile Name' (and empty) from being saved as the actual name.
    const tileName = this.tileTitle.trim();
    if (!tileName || tileName === 'Tile Name') { this.saveError.set('Please enter a tile name.'); return; }
    if (this.isTablePreviewVisible) {
      this.saveError.set('Select a column to return to the tile before saving.');
      return;
    }
    if (!this.selectedDataSourceId) {
      this.saveError.set(TileBuilderComponent.MISSING_SOURCE_ERROR);
      return;
    }
    // Every operation except Count works on a specific column.
    if (!this.daxEnabled && this.calculation !== 'count' && !this.valueColumn) {
      this.saveError.set('Please select a value column before saving.');
      return;
    }
    if (!this.tileDescription.trim()) { this.descriptionValidationError.set('Please enter a description.'); return; }
    this.descriptionValidationError.set('');
    this.isSaving.set(true); this.saveError.set(''); this.saveSuccess.set('');

    // Save state of current tab before collecting all
    this.saveTabState(this.activeTabId);

    // Collect all tabs to save
    const tabsToSave: { tabId: string; state: TabState }[] = [];
    for (const tab of this.tabs) {
      const state = this.tabStates.get(tab.id);
      if (state) {
        try { getTileDaxRequest(state.daxModel); }
        catch (error) {
          this.saveError.set(error instanceof Error ? error.message : 'Invalid tile DAX measure.');
          this.isSaving.set(false);
          return;
        }
        tabsToSave.push({ tabId: tab.id, state });
      }
    }

    // If only active tab (no saved states yet or single tab), save current directly
    if (tabsToSave.length === 0) {
      const categoryId = this.resolvedCategoryId;
      if (categoryId === null) { this.saveError.set(CATEGORY_REQUIRED_MESSAGE); this.isSaving.set(false); return; }

      const payload = {
        name: this.tileTitle, description: this.tileDescription, type: 'tile',
        libraryId: this.selectedLibraryId ?? 1002,
        source: this.selectedDataSourceId,
        sourceType: this.dataSourceMode === 'view' ? 'View'
            : this.dataSourceMode === 'import' ? 'Import'
            : (this.selectedDataSource?.modelType ?? 'Table'),
        sourceId: this.dataSourceMode === 'view' ? (this.selectedView?.id ?? null)
          : this.dataSourceMode === 'import' ? (Number(this.selectedDataSourceId) || null)
          : null,
        designJson: this.buildDesignJson(),
        categoryId,
      };
      const wasEditMode = !!this.editId;
      const request$ = wasEditMode
        ? this.widgetService.updateWidget(this.editId!, payload)
        : this.widgetService.createWidget(payload);
      request$.subscribe({
        next: (saved) => {
          this.isSaving.set(false);
          const successMsg = wasEditMode
            ? `'${this.tileTitle}' updated successfully.`
            : `'${this.tileTitle}' created successfully.`;
          if (closeAfterSave) this.toastService.pending = successMsg;
          else this.showSaveSuccess(successMsg);
          // Drop the cached tile list routes so they reload and show the new/updated tile on
          // return, instead of reattaching the stale (pre-save) list instance.
          this.listRouteReuse.invalidate('wip-tiles');
          this.listRouteReuse.invalidate('standard-tiles');
          // First save of a new tile: switch to edit mode so subsequent saves update instead of re-creating (avoids duplicate-name error)
          if (!wasEditMode) {
            this.editId = saved.id;
            this.location.replaceState(this.location.path().split('?')[0] + `?editId=${saved.id}`);
          }
          if (closeAfterSave) {
            this.router.navigate(['/charts-tiles/view', saved.id], { queryParams: { type: 'tile', from: 'wip' } });
          }
        },
        error: (err: unknown) => {
          this.isSaving.set(false);
          const msg = (err as any)?.error?.error ?? (err as any)?.message ?? 'Failed to save tile.';
          this.saveError.set(msg);
          this.cdr.markForCheck();
        },
      });
      return;
    }

    let completed = 0;
    let hasError = false;
    let savedId: number | null = null;
    const totalTabs = tabsToSave.length;

    for (const { state } of tabsToSave) {
      const designJson = JSON.stringify({
        daxModel: state.daxModel,
        tileType: 'kpi', title: state.tileTitle,
        source: state.selectedDataSourceId,
        sourceType: state.dataSourceMode === 'view' ? 'View'
            : state.dataSourceMode === 'import' ? 'Import'
            : (this.dataSources.find(d => d.id === state.selectedDataSourceId)?.modelType ?? 'Table'),
        dataSourceMode: state.dataSourceMode,
        viewId: state.dataSourceMode === 'view' ? state.viewId : undefined,
        valueField: state.valueColumn, aggregation: state.calculation,
        label: state.tileTitle, prefix: state.prefix, suffix: state.suffix,
        decimalPlaces: state.decimalPlaces, shortenBigNumbers: state.shortenBigNumbers,
        tileColor: state.tileColor, tileIcon: state.tileIcon,
        showTileIcon: state.showTileIcon, valueBold: state.valueBold, valueItalic: state.valueItalic, valueColor: state.valueColor,
        tileLayout: state.tileLayout,
        badgeText: state.badgeText, badgeColor: state.badgeColor,
        breakdownRows: state.breakdownRows,
        interactiveFilters: state.interactiveFilters,
        drillDownViewId: state.drillDownViewId,
      });

      const sourceModel = this.dataSources.find(d => d.id === state.selectedDataSourceId);
      const categoryId = this.resolvedCategoryId;
      if (categoryId === null) { this.saveError.set(CATEGORY_REQUIRED_MESSAGE); this.isSaving.set(false); return; }

      const payload = {
        name: state.tileTitle, description: this.tileDescription, type: 'tile',
        libraryId: this.selectedLibraryId ?? 1002,
        source: state.selectedDataSourceId,
        sourceType: state.dataSourceMode === 'view' ? 'View'
            : state.dataSourceMode === 'import' ? 'Import'
            : (sourceModel?.modelType ?? 'Table'),
        sourceId: state.dataSourceMode === 'view' ? (state.viewId ?? null)
          : state.dataSourceMode === 'import' ? (Number(state.selectedDataSourceId) || null)
          : null,
        designJson,
        categoryId,
      };

      const wasEditMode = this.editId && totalTabs === 1;
      const request$ = wasEditMode
        ? this.widgetService.updateWidget(this.editId!, payload)
        : this.widgetService.createWidget(payload);

      request$.subscribe({
        next: (saved) => {
          savedId = savedId ?? saved.id;
          completed++;
          // First save of a new tile: switch to edit mode so subsequent saves update instead of re-creating (avoids duplicate-name error)
          if (!wasEditMode && totalTabs === 1) {
            this.editId = saved.id;
            this.location.replaceState(this.location.path().split('?')[0] + `?editId=${saved.id}`);
          }
          if (completed === totalTabs && !hasError) {
            this.isSaving.set(false);
            // Drop the cached tile list routes so they reload and show the new/updated tile on
            // return, instead of reattaching the stale (pre-save) list instance.
            this.listRouteReuse.invalidate('wip-tiles');
            this.listRouteReuse.invalidate('standard-tiles');
            let msg: string;
            if (totalTabs > 1) msg = `${totalTabs} tiles created successfully.`;
            else if (wasEditMode) msg = `'${state.tileTitle}' updated successfully.`;
            else msg = `'${state.tileTitle}' created successfully.`;
            if (closeAfterSave) this.toastService.pending = msg;
            else this.showSaveSuccess(msg);
            if (closeAfterSave && savedId) {
              this.router.navigate(['/charts-tiles/view', savedId], { queryParams: { type: 'tile', from: 'wip' } });
            }
          }
        },
        error: (err: unknown) => {
          if (!hasError) {
            hasError = true;
            this.isSaving.set(false);
            const msg = (err as any)?.error?.error ?? (err as any)?.message ?? 'Failed to save tile.';
            this.saveError.set(msg);
            this.cdr.markForCheck();
          }
        },
      });
    }
  }

  saveAndClose(): void { this.saveTile(true); }
  saveAsDraft(): void { this.saveTile(false); }
  addTile():    void { this.saveTile(false); }
}
