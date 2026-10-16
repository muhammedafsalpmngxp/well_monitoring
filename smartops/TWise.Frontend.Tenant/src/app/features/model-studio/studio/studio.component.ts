import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, forkJoin, map, of, switchMap } from 'rxjs';
import { ROUTES } from '../../../core/constants/route.constants';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { CommonApiService, DbSchemaColumn, DbSchemaTable } from '../../../core/services/common-api.service';
import {
  AddRelationshipBody, AddTransformBody, Cardinality, DatasetCalculatedColumn, DatasetDetail, DatasetMeasure, DatasetRelationship, DatasetSource, DatasetTransform,
  ModelStudioService, RelationshipSuggestion, RlsBody, SCRIPT_SCHEMA, VIEW_SCHEMA,
} from '../../../core/services/model-studio.service';
import { PermissionService } from '../../../core/services/permission.service';
import { Link, MODEL_STUDIO_MODULE, Selection, apiErrorMessage, selectedSourceId, tableKey } from '../model-studio.util';
import { MeasurePlacement } from './data-pane/data-pane.component';
import { SavedMeasure } from '../formula-builder/formula-builder.util';
import { LoadedResult } from '../get-data/get-data.component';
import { sameEnds } from '../relationship-dialog/relationship-dialog.component';
import { PANE_WIDTHS, StudioPane, clampPaneWidth, readPaneWidth, savePaneWidth } from './pane-width.util';

interface PendingConfirm { title: string; message: string; run: () => void; confirmLabel?: string; }

/** A side pane folded to a strip, remembered per browser like its width. */
type Folded = Record<StudioPane, boolean>;
const FOLDED_KEY = 'twise.model-studio.folded';

function readFolded(): Folded {
  try {
    const saved = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '{}') as Partial<Folded>;
    return { inspector: saved.inspector === true, pane: saved.pane === true };
  } catch {
    return { inspector: false, pane: false };
  }
}

/** Model: the diagram and the properties of what is selected. Data: the rows of one table as the model reads them. */
export type StudioView = 'model' | 'data';

@Component({
  selector: 'app-studio',
  standalone: false,
  templateUrl: './studio.component.html',
  styleUrls: ['./studio.component.scss'],
})
export class StudioComponent implements OnInit, OnDestroy {
  readonly listRoute = `/${ROUTES.MODEL_STUDIO}`;

  dataset: DatasetDetail | null = null;
  /** The connection's tables, for the Get Data navigator. */
  tables: DbSchemaTable[] = [];
  columns = new Map<string, DbSchemaColumn[]>();
  suggestions: RelationshipSuggestion[] = [];
  selection: Selection = null;
  view: StudioView = 'model';
  loading = true;
  busy = false;
  error = '';
  toast: { kind: 'success' | 'error'; text: string } | null = null;
  confirm: PendingConfirm | null = null;
  /** The open formula builder and the measure it edits, null for a new one. */
  formula: { measure: DatasetMeasure | null } | null = null;
  /** Why the server refused the last measure save; shown inside the formula builder. */
  formulaError = '';
  /** The open calculated-column dialog: its table, and the column it edits or null for a new one. */
  columnDialog: { source: DatasetSource; column: DatasetCalculatedColumn | null } | null = null;
  /** The Get Data navigator is open. */
  getDataOpen = false;
  /** The open relationship editor: the relationship it edits, or null for a new one. */
  relationshipDialog: { relationship: DatasetRelationship | null } | null = null;
  /** The open Transform dialog: its table, and the column it starts on. */
  transformDialog: { sourceId: number; column: string | null } | null = null;
  publishing = false;
  /** Folded panes show as a strip this wide. */
  readonly foldedWidth = 40;
  folded: Folded = readFolded();
  /** The canvas this page was opened from with Open model; Back to canvas returns to it (D-16). */
  returnCanvasId: number | null = null;
  readonly paneLimits = PANE_WIDTHS;
  /** The side panes' widths in CSS pixels, remembered per browser (plan decision P7b-11). */
  widths: Record<StudioPane, number> = { inspector: readPaneWidth('inspector'), pane: readPaneWidth('pane') };
  private toastTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly modelStudio: ModelStudioService,
    private readonly commonApi: CommonApiService,
    private readonly permissions: PermissionService,
    private readonly cdr: ChangeDetectorRef,
    private readonly breadcrumbs: BreadcrumbService,
  ) {}

  get readonly(): boolean { return !this.permissions.canModify(MODEL_STUDIO_MODULE); }

  get isPublished(): boolean { return !!this.dataset?.publishedAt; }

  /** Draft until the first Publish; then Published, or Published with changes canvases do not see yet. */
  get statusLabel(): string {
    if (!this.isPublished) return 'Draft, not published';
    return this.dataset?.hasDraftChanges ? 'Unpublished changes' : 'Published';
  }

  /** The table the Data view shows and New column adds to: the selected table or column's table, or the first one. */
  get activeSource(): DatasetSource | undefined {
    const sources = this.dataset?.sources ?? [];
    const id = selectedSourceId(this.selection);
    return (id === null ? undefined : sources.find(s => s.id === id)) ?? sources[0];
  }

  get canvasRoute(): string | null {
    return this.returnCanvasId === null ? null : `/${ROUTES.CANVAS}/${this.returnCanvasId}`;
  }

  ngOnInit(): void {
    // The canvas's Open model link adds ?canvas=<id>. Anything but a positive whole number is ignored.
    const canvas = this.route.snapshot.queryParamMap.get('canvas');
    this.returnCanvasId = canvas && /^[1-9][0-9]{0,9}$/.test(canvas) ? Number(canvas) : null;
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.publishBreadcrumbs('Data model');
    this.modelStudio.get(id).pipe(
      switchMap(dataset => this.sourceTables(dataset).pipe(map(tables => ({ dataset, tables })))),
    ).subscribe({
      next: ({ dataset, tables }) => {
        this.setSchema(tables);
        this.apply(dataset);
        this.publishBreadcrumbs(dataset.name);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: err => {
        this.error = apiErrorMessage(err, 'The data model could not be loaded.');
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.toastTimer);
  }

  select(selection: Selection): void {
    this.selection = selection;
  }

  /** A table picked in the Data pane is selected in the diagram and shown in the Data view. */
  selectSource(sourceId: number): void {
    this.select({ kind: 'source', id: sourceId });
  }

  /** New column in the ribbon adds to the active table. */
  newColumn(): void {
    const source = this.activeSource;
    if (source) this.openColumn(source, null);
  }

  /** Transform in the ribbon opens the Transform dialog on the active table, or on the selected column. */
  openTransforms(): void {
    const source = this.activeSource;
    const selection = this.selection;
    if (source) this.openTransformsFor(source, selection?.kind === 'column' && selection.sourceId === source.id ? selection.column : null);
  }

  openTransformsFor(source: DatasetSource, column: string | null): void {
    this.transformDialog = { sourceId: source.id, column };
  }

  fold(pane: StudioPane, folded: boolean): void {
    this.folded = { ...this.folded, [pane]: folded };
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify(this.folded));
    } catch {
      // ponytail: the fold is simply not remembered when storage is blocked.
    }
  }

  /** Makes the draft the version canvases read. */
  publish(): void {
    const dataset = this.dataset;
    if (!dataset) return;
    this.publishing = true;
    this.run(this.modelStudio.publish(dataset.id),
      `${dataset.name} is published. Published canvases now read this version.`, () => (this.publishing = false), false,
      () => (this.publishing = false));
  }

  /** Throws the draft away after a confirmation; the tables, measures and columns go back to the published version. */
  discardDraft(): void {
    const dataset = this.dataset;
    if (!dataset) return;
    this.confirm = {
      title: 'Discard draft',
      message: 'Discard every change since the last Publish? Tables, relationships, measures, calculated columns and transforms go back to the published version.',
      confirmLabel: 'Discard',
      run: () => this.run(this.modelStudio.discardDraft(dataset.id), 'The draft was discarded.', () => (this.selection = null)),
    };
  }

  /** Lists a measure under another table or folder (Data pane menu or drag). */
  placeMeasure(event: MeasurePlacement): void {
    const where = event.homeSourceId === null ? 'Measures' : this.aliasOf(event.homeSourceId);
    this.run(this.modelStudio.placeMeasure(this.datasetId, event.measure.id, event.homeSourceId, event.folder),
      `${event.measure.name} is listed under ${where}${event.folder ? ' in ' + event.folder : ''}.`, undefined, false);
  }

  /** Arrow keys on a pane's handle. Both panes sit right of their handle, so Left widens and Right narrows. */
  nudgePane(pane: StudioPane, event: KeyboardEvent): void {
    const step = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0;
    if (!step) return;
    event.preventDefault();
    this.setPaneWidth(pane, this.widths[pane] + step);
    savePaneWidth(pane, this.widths[pane]);
  }

  /**
   * Dragging a pane's handle. The handle captures the pointer, so the drag keeps working over the grid
   * and the diagram. Pointer positions are in screen pixels and the layout in zoomed ones, so the move
   * is divided by the text-size zoom (FontSizeService). The width is saved when the drag ends.
   */
  startResize(pane: StudioPane, event: PointerEvent): void {
    const handle = event.currentTarget as HTMLElement;
    const startX = event.clientX;
    const startWidth = this.widths[pane];
    const zoom = parseFloat(getComputedStyle(handle).getPropertyValue('--app-zoom-factor')) || 1;
    const move = (e: PointerEvent) => {
      this.setPaneWidth(pane, startWidth + (startX - e.clientX) / zoom);
      this.cdr.markForCheck();
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      savePaneWidth(pane, this.widths[pane]);
    };
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    event.preventDefault();
  }

  /** Hides the column from report builders, or shows it again; part of the draft, like any model change. */
  toggleHidden(source: DatasetSource, column: string): void {
    const hidden = source.hiddenColumns ?? [];
    const isHidden = hidden.some(name => name.toLowerCase() === column.toLowerCase());
    const next = isHidden ? hidden.filter(name => name.toLowerCase() !== column.toLowerCase()) : [...hidden, column];
    this.run(this.modelStudio.setHiddenColumns(this.datasetId, source.id, next),
      isHidden ? `${source.alias}.${column} shows in report builders again.` : `${source.alias}.${column} is hidden from report builders.`,
      undefined, false);
  }

  saveDetails(event: { name: string; description: string | null }): void {
    this.run(this.modelStudio.updateDetails(this.datasetId, event.name, event.description), 'Name and description saved.', undefined, false);
  }

  saveRls(event: { sourceId: number; body: RlsBody }): void {
    this.run(this.modelStudio.updateSource(this.datasetId, event.sourceId, event.body), 'Row filter saved.', undefined, false);
  }

  refreshViewSource(source: DatasetSource): void {
    this.run(this.modelStudio.refreshViewSource(this.datasetId, source.id), `${source.alias} was updated from the view.`, undefined, false);
  }

  removeSource(source: DatasetSource): void {
    this.confirm = {
      title: 'Remove table',
      message: `Remove ${source.alias} and its relationships from this data model?`,
      run: () => this.run(this.modelStudio.removeSource(this.datasetId, source.id), `${source.alias} was removed.`,
        () => (this.selection = null)),
    };
  }

  connect(link: Link): void {
    this.run(this.modelStudio.addRelationship(this.datasetId, { ...link, cardinality: 'many_to_one', detectedFrom: 'user' }),
      'Relationship added.');
  }

  acceptSuggestion(suggestion: RelationshipSuggestion): void {
    const { basis, matchPercent: _match, ...link } = suggestion;
    this.run(this.modelStudio.addRelationship(this.datasetId, { ...link, detectedFrom: basis === 'data' ? 'user' : 'fk' }), 'Relationship added.');
  }

  /**
   * Saves the relationship editor. The same columns keep the relationship and change its cardinality; other columns
   * replace it. A refusal keeps the editor open.
   */
  saveRelationship(body: AddRelationshipBody): void {
    const editing = this.relationshipDialog?.relationship ?? null;
    const request = !editing
      ? this.modelStudio.addRelationship(this.datasetId, body)
      : sameEnds(body, editing)
        ? this.modelStudio.updateRelationship(this.datasetId, editing.id, body.cardinality)
        : this.modelStudio.removeRelationship(this.datasetId, editing.id).pipe(switchMap(() => this.modelStudio.addRelationship(this.datasetId, body)));
    this.run(request, editing ? 'Relationship saved.' : 'Relationship added.', () => (this.relationshipDialog = null));
  }

  saveSourceDetails(event: { sourceId: number; caption: string | null; description: string | null }): void {
    this.run(this.modelStudio.setSourceDetails(this.datasetId, event.sourceId, event.caption, event.description), 'Table saved.', undefined, false);
  }

  saveParameters(event: { sourceId: number; bindings: { name: string; field: string | null }[] }): void {
    this.run(this.modelStudio.setSourceParameters(this.datasetId, event.sourceId, event.bindings), 'Parameters saved.', undefined, false);
  }

  saveCardinality(event: { relationshipId: number; cardinality: Cardinality }): void {
    this.run(this.modelStudio.updateRelationship(this.datasetId, event.relationshipId, event.cardinality), 'Relationship saved.');
  }

  removeRelationship(relationshipId: number): void {
    this.confirm = {
      title: 'Remove relationship',
      message: 'Remove this relationship? Previews that need it will stop working until it is added again.',
      run: () => this.run(this.modelStudio.removeRelationship(this.datasetId, relationshipId), 'Relationship removed.',
        () => (this.selection = null)),
    };
  }

  openFormula(measure: DatasetMeasure | null): void {
    this.formula = { measure };
    this.formulaError = '';
  }

  closeFormula(): void {
    this.formula = null;
  }

  /** A refusal keeps the builder open with the server's reason; success closes it with a toast. */
  saveMeasure(saved: SavedMeasure): void {
    const editing = this.formula?.measure;
    this.saveFormula(
      editing
        ? this.modelStudio.updateMeasure(this.datasetId, editing.id, saved.name, saved.expression)
        : this.modelStudio.addMeasure(this.datasetId, saved.name, saved.expression),
      () => (this.formula = null),
      editing ? `${saved.name} was saved.` : `${saved.name} was added.`,
      'The measure could not be saved.');
  }

  removeMeasure(measure: DatasetMeasure): void {
    this.confirm = {
      title: 'Delete measure',
      message: `Delete the measure "${measure.name}"?`,
      run: () => this.run(this.modelStudio.removeMeasure(this.datasetId, measure.id), `${measure.name} was deleted.`, undefined, false),
    };
  }

  openColumn(source: DatasetSource, column: DatasetCalculatedColumn | null): void {
    this.columnDialog = { source, column };
    this.formulaError = '';
  }

  /** As for measures: a refusal keeps the dialog open with the server's reason. */
  saveColumn(saved: SavedMeasure): void {
    const open = this.columnDialog;
    if (!open) return;
    const label = `${open.source.alias}.${saved.name}`;
    this.saveFormula(
      open.column
        ? this.modelStudio.updateCalculatedColumn(this.datasetId, open.column.id, saved.name, saved.expression)
        : this.modelStudio.addCalculatedColumn(this.datasetId, open.source.id, saved.name, saved.expression),
      () => (this.columnDialog = null),
      open.column ? `${label} was saved.` : `${label} was added.`,
      'The calculated column could not be saved.');
  }

  removeColumn(column: DatasetCalculatedColumn): void {
    const label = `${this.aliasOf(column.sourceId)}.${column.name}`;
    this.confirm = {
      title: 'Delete calculated column',
      message: `Delete the calculated column "${label}"? Canvas objects that show it will stop working.`,
      run: () => this.run(this.modelStudio.removeCalculatedColumn(this.datasetId, column.id), `${label} was deleted.`, undefined, false),
    };
  }

  addTransform(body: AddTransformBody): void {
    this.run(this.modelStudio.addTransform(this.datasetId, body), 'Transform added.', undefined, false);
  }

  removeTransform(transform: DatasetTransform): void {
    this.confirm = {
      title: 'Remove transform',
      message: `Remove the transform of ${this.aliasOf(transform.sourceId)}.${transform.column}? Its values are read as stored again.`,
      run: () => this.run(this.modelStudio.removeTransform(this.datasetId, transform.id), 'Transform removed.', undefined, false),
    };
  }

  /** A load or replace returns the dataset. The schema is read again, because an upload adds a table to it. */
  onDataLoaded(result: LoadedResult): void {
    this.getDataOpen = false;
    this.sourceTables(result.dataset).subscribe({
      next: tables => {
        this.setSchema(tables);
        this.apply(result.dataset);
        this.showToast('success', result.message);
      },
      error: err => this.showToast('error', apiErrorMessage(err, 'The tables could not be read again. Reload the page.')),
    });
  }

  /** Closing after a load stopped part way reads the dataset again, so whatever was added shows. */
  closeGetData(changed: boolean): void {
    this.getDataOpen = false;
    if (!changed || !this.dataset) return;
    this.modelStudio.get(this.dataset.id).pipe(
      switchMap(dataset => this.sourceTables(dataset).pipe(map(tables => ({ dataset, tables })))),
    ).subscribe({
      next: ({ dataset, tables }) => {
        this.setSchema(tables);
        this.apply(dataset);
        this.cdr.markForCheck();
      },
      error: err => this.showToast('error', apiErrorMessage(err, 'The data model could not be read again. Reload the page.')),
    });
  }

  runConfirmed(): void {
    const pending = this.confirm;
    this.confirm = null;
    pending?.run();
  }

  private get datasetId(): number {
    return this.dataset!.id;
  }

  /** The Studio has no page header, which is what normally gives the navbar its trail. */
  private publishBreadcrumbs(name: string): void {
    this.breadcrumbs.set([{ label: 'Home' }, { label: 'Model Studio', route: this.listRoute }, { label: name }]);
  }

  private setPaneWidth(pane: StudioPane, width: number): void {
    this.widths = { ...this.widths, [pane]: clampPaneWidth(pane, width) };
  }

  private aliasOf(sourceId: number): string {
    return this.dataset?.sources.find(s => s.id === sourceId)?.alias ?? '?';
  }

  /**
   * Saves a measure or a calculated column from its dialog. A refusal keeps the dialog open with the
   * server's reason; success closes it with a toast. Neither changes the relationship suggestions.
   */
  private saveFormula(request: Observable<DatasetDetail>, close: () => void, success: string, failure: string): void {
    this.busy = true;
    this.formulaError = '';
    request.subscribe({
      next: dataset => {
        this.busy = false;
        close();
        this.apply(dataset, false);
        this.showToast('success', success);
      },
      error: err => {
        this.busy = false;
        this.formulaError = apiErrorMessage(err, failure);
        this.cdr.markForCheck();
      },
    });
  }

  /** Every change returns the whole dataset, so the page swaps it in. */
  private run(request: Observable<DatasetDetail>, success: string, after?: () => void, suggestionsMayChange = true, failed?: () => void): void {
    this.busy = true;
    request.subscribe({
      next: dataset => {
        this.busy = false;
        this.apply(dataset, suggestionsMayChange);
        after?.();
        this.showToast('success', success);
      },
      error: err => {
        this.busy = false;
        failed?.();
        this.showToast('error', apiErrorMessage(err, 'The change could not be saved.'));
      },
    });
  }

  /** Suggestions depend on the tables and the relationships only, so measure and row-filter saves keep the ones shown. */
  private apply(dataset: DatasetDetail, suggestionsMayChange = true): void {
    this.dataset = dataset;
    if (!suggestionsMayChange) return;
    this.modelStudio.suggestions(dataset.id).subscribe({
      next: suggestions => { this.suggestions = suggestions; this.cdr.markForCheck(); },
      error: () => { this.suggestions = []; this.cdr.markForCheck(); },
    });
  }

  /**
   * The connection's tables and, for view sources, the views' columns in the same shape (own), then the tables the
   * model reads from other databases (other), each read from its own connection's catalogue.
   */
  private sourceTables(dataset: DatasetDetail): Observable<{ own: DbSchemaTable[]; other: DbSchemaTable[] }> {
    const others = [...new Set(dataset.sources.map(s => s.connectionId).filter((id): id is number => id != null))];
    const otherTables = others.map(id => this.commonApi.getConnectionSchema(id).pipe(map(schema => schema.tables.filter(t => dataset.sources
      .some(s => s.connectionId === id && tableKey(s.schemaName, s.sourceName) === tableKey(t.schemaName, t.tableName))))));
    return forkJoin([this.commonApi.getConnectionSchema(dataset.connectionId), this.modelStudio.viewTables(dataset), forkJoin([of([]), ...otherTables])])
      .pipe(map(([schema, views, other]) => ({ own: [...schema.tables, ...views], other: other.flat() })));
  }

  private setSchema({ own, other }: { own: DbSchemaTable[]; other: DbSchemaTable[] }): void {
    // View columns and the tables of other databases join the columns map; the navigator lists the model's own database tables only.
    this.tables = own.filter(t => t.schemaName !== VIEW_SCHEMA && t.schemaName !== SCRIPT_SCHEMA)
      .sort((a, b) => `${a.schemaName}.${a.tableName}`.localeCompare(`${b.schemaName}.${b.tableName}`));
    this.columns = new Map([...own, ...other].map(t => [
      tableKey(t.schemaName, t.tableName),
      [...t.columns].sort((a, b) => a.ordinalPosition - b.ordinalPosition),
    ]));
  }

  private showToast(kind: 'success' | 'error', text: string): void {
    this.toast = { kind, text };
    this.cdr.markForCheck();
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast = null; this.cdr.markForCheck(); }, 4000);
  }
}
