import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { ColDef, ColGroupDef } from 'ag-grid-community';
import { Observable, catchError, concatMap, forkJoin, from, last, map, of, switchMap } from 'rxjs';
import { CommonApiService, DbSchemaTable } from '../../../core/services/common-api.service';
import {
  DatasetConnection, DatasetDetail, ImportOptions, ImportPreview, ImportTable, ImportType, ModelStudioService, ViewChoice,
} from '../../../core/services/model-studio.service';
import { PermissionService } from '../../../core/services/permission.service';
import { buildReportGridColumns } from '../../reports/shared/report-grid-columns.util';
import { MODEL_STUDIO_MODULE, SourceOrigin, apiErrorMessage, suggestAlias, tableKey } from '../model-studio.util';
import { gridTheme } from '../studio/data-view/data-view.component';
import {
  GROUP_ICONS, GROUP_LABELS, IMPORT_TYPE_LABELS, LoadSettings, NavigatorGroup, NavigatorItem,
  filterItems, itemOrigin, navigatorItems, newSettings, settingsProblem, sourceBody,
} from './get-data.util';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([hidden]), select:not([disabled]), textarea:not([disabled])';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** What the studio shows after a load: the dataset as the server now has it, and one sentence. */
export interface LoadedResult { dataset: DatasetDetail; message: string; }

/**
 * The Get Data navigator: tick tenant tables, contract-compliant views, uploaded tables or the sheets of a new
 * file, preview the focused entry, choose how each is added, and load them into the dataset one after another.
 */
/** Entries of the navigator under one heading: a schema of a database, or a whole group. database is set for another database than the model's. */
export interface NavigatorSection { key: string; label: string | null; items: NavigatorItem[]; database?: string; }

@Component({
  selector: 'app-get-data',
  standalone: false,
  templateUrl: './get-data.component.html',
  styleUrls: ['./get-data.component.scss'],
})
export class GetDataComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() dataset!: DatasetDetail;
  /** Catalogue tables of the dataset's connection, import tables included. */
  @Input() tables: DbSchemaTable[] = [];
  /** The tenant's connections, each saying whether this model can add its tables. Empty until read, or when they cannot be. */
  connections: DatasetConnection[] = [];
  /** The database whose tables are listed: the model's own until another is chosen. */
  connectionId = 0;
  /** The tables of the chosen database when it is not the model's own. */
  private otherTables: DbSchemaTable[] = [];
  @Output() loaded = new EventEmitter<LoadedResult>();
  /** true when sources were added before a load stopped, so the studio reads the dataset again. */
  @Output() cancelled = new EventEmitter<boolean>();

  @ViewChild('dialog') dialog?: ElementRef<HTMLElement>;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  readonly groups: NavigatorGroup[] = ['tables', 'views', 'files'];
  /** Groups and schemas folded to their heading, by key ("tables", "tables:core"). A search unfolds everything. */
  readonly folded = new Set<string>();
  readonly groupLabels = GROUP_LABELS;
  readonly groupIcons = GROUP_ICONS;
  readonly typeChoices = Object.entries(IMPORT_TYPE_LABELS) as [ImportType, string][];
  readonly gridTheme = gridTheme;
  readonly defaultColDef: ColDef = { flex: 1, minWidth: 120, resizable: true };

  items: NavigatorItem[] = [];
  search = '';
  /** A Google Sheets link to read like an uploaded file. */
  sheetLink = '';
  checked = new Set<string>();
  focused: NavigatorItem | null = null;
  /** The file being uploaded. replacing is set when it replaces an uploaded table instead of adding sheets. */
  upload: { file: File; sheets: string[]; replacing: ImportTable | null } | null = null;
  /** The last preview of the focused sheet. */
  sheetPreview: ImportPreview | null = null;
  previewRows: Record<string, unknown>[] = [];
  columnDefs: (ColDef | ColGroupDef)[] = [];
  previewMessage = '';
  listing = true;
  /** The chosen database's tables are being read. */
  switching = false;
  previewing = false;
  loading = false;
  error = '';

  private views: ViewChoice[] = [];
  private imports: ImportTable[] = [];
  private readonly settings = new Map<string, LoadSettings>();
  private readonly sheetColumns = new Map<string, string[]>();
  private changed = false;
  // Focus goes back here when the dialog closes.
  private readonly opener = document.activeElement as HTMLElement | null;

  constructor(
    private readonly modelStudio: ModelStudioService,
    private readonly permissions: PermissionService,
    private readonly cdr: ChangeDetectorRef,
    private readonly commonApi: CommonApiService,
  ) {}

  get canUpload(): boolean {
    return this.permissions.canCreate(MODEL_STUDIO_MODULE);
  }

  get checkedItems(): NavigatorItem[] {
    return this.items.filter(item => this.checked.has(item.key));
  }

  /** The first thing to settle before Load, or '' when every ticked entry is ready. */
  get loadProblem(): string {
    const items = this.checkedItems;
    if (!items.length) return 'Tick at least one table, view or sheet.';
    for (const item of items) {
      const problem = settingsProblem(item, this.settings.get(item.key), this.takenAliases(item.key));
      if (problem) return problem;
    }
    return '';
  }

  /** Where the focused entry is read from. */
  get focusedOrigin(): SourceOrigin | null {
    return this.focused ? itemOrigin(this.focused, this.dataset, this.connections) : null;
  }

  ngOnInit(): void {
    this.connectionId = this.dataset.connectionId;
    // Without the list only the model's own database is offered, as before.
    this.modelStudio.sourceConnections(this.dataset.id).pipe(catchError(() => of([]))).subscribe(connections => {
      this.connections = connections;
      this.cdr.markForCheck();
    });
    forkJoin([this.modelStudio.views(this.dataset.id), this.modelStudio.imports(this.dataset.id)]).subscribe({
      next: ([views, imports]) => {
        this.views = views;
        this.imports = imports;
        this.listing = false;
        this.rebuild();
      },
      error: err => {
        this.error = apiErrorMessage(err, 'The views and uploaded files could not be listed.');
        this.listing = false;
        this.rebuild();
      },
    });
  }

  ngAfterViewInit(): void {
    this.searchInput?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    // As in the formula builder: the studio re-renders in the cycle that destroys this dialog.
    queueMicrotask(() => this.opener?.focus());
  }

  itemsIn(group: NavigatorGroup): NavigatorItem[] {
    return filterItems(this.items, this.search).filter(item => item.group === group);
  }

  /**
   * The group's entries in sections: database tables by database and schema, views and files in one section each.
   * Tables ticked on another database than the one listed stay in their own sections until loaded or cleared.
   */
  sectionsIn(group: NavigatorGroup): NavigatorSection[] {
    const items = this.itemsIn(group);
    if (group !== 'tables') return items.length ? [{ key: group, label: null, items }] : [];
    const sections = new Map<string, NavigatorSection>();
    for (const item of items) {
      const schema = item.source?.schemaName ?? '';
      const key = `tables:${item.source?.connectionId ?? ''}:${schema}`;
      const section = sections.get(key) ?? { key, label: schema, items: [], ...(item.database ? { database: item.database } : {}) };
      section.items.push(item);
      sections.set(key, section);
    }
    return [...sections.values()];
  }

  /** Lists the tables of another database of the tenant, or the model's own again. Ticked tables stay ticked. */
  chooseDatabase(connectionId: number): void {
    this.connectionId = connectionId;
    this.error = '';
    if (connectionId === this.dataset.connectionId) {
      this.otherTables = [];
      this.rebuild();
      return;
    }
    this.switching = true;
    this.otherTables = [];
    this.commonApi.getConnectionSchema(connectionId).subscribe({
      next: schema => {
        this.switching = false;
        if (this.connectionId !== connectionId) return;
        this.otherTables = schema.tables;
        this.rebuild();
      },
      error: err => {
        this.switching = false;
        this.error = apiErrorMessage(err, 'The tables of that database could not be read.');
        this.rebuild();
      },
    });
  }

  /** Ticked entries of a group, for its heading. */
  checkedIn(group: NavigatorGroup): number {
    return this.items.filter(item => item.group === group && this.checked.has(item.key)).length;
  }

  isOpen(key: string): boolean {
    return !!this.search.trim() || !this.folded.has(key);
  }

  toggleFold(key: string): void {
    if (!this.folded.delete(key)) this.folded.add(key);
  }

  /** Ticks every entry of a section that can be loaded, or clears them when all are ticked already. */
  toggleSection(section: NavigatorSection): void {
    const open = section.items.filter(item => !item.disabled);
    const all = open.length > 0 && open.every(item => this.checked.has(item.key));
    for (const item of open) {
      if (all) this.checked.delete(item.key);
      else if (!this.checked.has(item.key)) {
        this.checked.add(item.key);
        this.settingsOf(item);
      }
    }
  }

  sectionState(section: NavigatorSection): 'all' | 'some' | 'none' {
    const open = section.items.filter(item => !item.disabled);
    const ticked = open.filter(item => this.checked.has(item.key)).length;
    return ticked === 0 ? 'none' : ticked === open.length ? 'all' : 'some';
  }

  /** A table under its schema heading shows its own name; everything else shows its full label. */
  shortLabel(item: NavigatorItem): string {
    return item.group === 'tables' && item.source ? item.source.sourceName : item.label;
  }

  trackSection(_index: number, section: NavigatorSection): string {
    return section.key;
  }

  trackItem(_index: number, item: NavigatorItem): string {
    return item.key;
  }

  settingsOf(item: NavigatorItem): LoadSettings {
    let settings = this.settings.get(item.key);
    if (!settings) {
      settings = newSettings(item, this.takenAliases(item.key));
      this.settings.set(item.key, settings);
    }
    return settings;
  }

  columnsOf(item: NavigatorItem): string[] {
    return item.sheet ? this.sheetColumns.get(item.key) ?? [] : item.columns;
  }

  toggle(item: NavigatorItem): void {
    if (item.disabled) return;
    if (this.checked.has(item.key)) {
      this.checked.delete(item.key);
    } else {
      this.checked.add(item.key);
      this.settingsOf(item);
    }
    if (this.focused?.key !== item.key) this.focus(item);
  }

  /** Shows the entry's rows: a sheet from the uploaded file, a table or view from the database. */
  focus(item: NavigatorItem): void {
    this.focused = item;
    this.previewMessage = '';
    this.showRows([], []);
    if (item.sheet) this.previewSheet(item);
    else if (item.source && !item.reasons.length) this.previewSource(item);
  }

  /** A new file: its sheets are listed to load, or, with replacing, one of them replaces an uploaded table. */
  chooseFile(event: Event, replacing: ImportTable | null = null): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      this.error = 'The file is larger than 10 MB. Split it into smaller files.';
      return;
    }
    this.readFile(file, replacing);
  }

  /** A Google Sheet shared by link: the server downloads it, and its sheets are listed as for an uploaded file. */
  chooseGoogleSheet(): void {
    if (!this.sheetLink.trim() || this.previewing) return;
    this.error = '';
    this.previewing = true;
    this.modelStudio.googleSheet(this.dataset.id, this.sheetLink.trim()).subscribe({
      next: file => this.readFile(file, null),
      error: err => {
        this.previewing = false;
        this.error = apiErrorMessage(err, 'The Google Sheet could not be read.');
        this.cdr.markForCheck();
      },
    });
  }

  /** Ticks every sheet of the file, reading each one first so it loads without being opened. */
  tickAllSheets(): void {
    const sheets = this.items.filter(item => item.sheet && !item.disabled && !this.checked.has(item.key));
    for (const item of sheets) {
      this.checked.add(item.key);
      this.settingsOf(item);
    }
    this.previewing = true;
    // One at a time, as each preview reads the whole file on the server.
    from(sheets.filter(item => !this.settingsOf(item).types?.length)).pipe(
      concatMap(item => this.modelStudio.previewImport(this.dataset.id, this.upload!.file, this.readOptions(item)).pipe(map(preview => ({ item, preview })))),
    ).subscribe({
      next: ({ item, preview }) => this.applySheetPreview(item, preview),
      error: err => this.failPreview(err, 'A sheet could not be read. Untick it, or open it to change its rows.'),
      complete: () => {
        this.previewing = false;
        this.cdr.markForCheck();
      },
    });
  }

  get sheetCount(): number {
    return this.upload && !this.upload.replacing ? this.upload.sheets.length : 0;
  }

  private readFile(file: File, replacing: ImportTable | null): void {
    this.error = '';
    this.previewing = true;
    this.modelStudio.previewImport(this.dataset.id, file, {}).subscribe({
      next: preview => {
        // The sheets of an earlier file, and what was set for them, go with it.
        for (const sheet of this.upload?.sheets ?? []) {
          this.checked.delete(`sheet:${sheet}`);
          this.settings.delete(`sheet:${sheet}`);
          this.sheetColumns.delete(`sheet:${sheet}`);
        }
        this.upload = { file, sheets: preview.sheets, replacing };
        this.rebuild();
        const item = this.items.find(entry => entry.sheet === preview.sheet)!;
        this.focused = item;
        this.previewing = false;
        this.applySheetPreview(item, preview);
        this.cdr.markForCheck();
      },
      // Shown in the footer: nothing may be selected yet to show a preview message under.
      error: err => {
        this.previewing = false;
        this.error = apiErrorMessage(err, 'The file could not be read.');
        this.cdr.markForCheck();
      },
    });
  }

  /** A new header row or last row can change the columns, so the types are inferred again. */
  changeRange(item: NavigatorItem): void {
    this.settingsOf(item).types = undefined;
    this.previewSheet(item);
  }

  changeType(item: NavigatorItem, index: number, type: ImportType): void {
    const settings = this.settingsOf(item);
    settings.types = (settings.types ?? []).map((current, i) => (i === index ? type : current));
    this.previewSheet(item);
  }

  load(): void {
    const items = this.checkedItems;
    if (this.loadProblem || this.loading) return;
    this.loading = true;
    this.error = '';
    // One at a time: each call returns the whole dataset, so the last one is the result.
    from(items).pipe(concatMap(item => this.loadOne(item)), last()).subscribe({
      next: dataset => {
        this.loading = false;
        this.loaded.emit({ dataset, message: items.length === 1 ? `${items[0].label} was loaded.` : `${items.length} sources were loaded.` });
      },
      error: err => {
        this.loading = false;
        this.changed = true;
        this.error = apiErrorMessage(err, 'The load stopped.');
        this.refresh();
      },
    });
  }

  replace(item: NavigatorItem): void {
    const upload = this.upload;
    if (!upload?.replacing || this.loading) return;
    this.loading = true;
    this.error = '';
    this.modelStudio.replaceImport(this.dataset.id, upload.replacing.id, upload.file, this.readOptions(item)).pipe(
      switchMap(table => this.modelStudio.get(this.dataset.id).pipe(map(dataset => ({ table, dataset })))),
    ).subscribe({
      next: ({ table, dataset }) => {
        this.loading = false;
        this.loaded.emit({ dataset, message: `${table.tableName} was replaced with ${table.loadedRows} rows.` });
      },
      error: err => {
        this.loading = false;
        this.error = apiErrorMessage(err, 'The table could not be replaced.');
        this.cdr.markForCheck();
      },
    });
  }

  close(): void {
    this.cancelled.emit(this.changed);
  }

  /** Escape closes; Tab and Shift+Tab stay inside the dialog. */
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== 'Tab' || !this.dialog) return;
    const focusable = Array.from(this.dialog.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0];
    const lastOne = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      lastOne.focus();
    } else if (!event.shiftKey && document.activeElement === lastOne) {
      event.preventDefault();
      first.focus();
    }
  }

  private loadOne(item: NavigatorItem): Observable<DatasetDetail> {
    const settings = this.settingsOf(item);
    if (!item.sheet) return this.modelStudio.addSource(this.dataset.id, sourceBody(item, settings));
    return this.modelStudio.createImport(this.dataset.id, this.upload!.file, { ...this.readOptions(item), tableName: settings.tableName }).pipe(
      switchMap(table => this.modelStudio.addSource(this.dataset.id, sourceBody(item, settings, table.tableName))),
    );
  }

  private readOptions(item: NavigatorItem): ImportOptions {
    const settings = this.settingsOf(item);
    return { sheet: item.sheet, headerRow: settings.headerRow, lastRow: settings.lastRow, types: settings.types };
  }

  private previewSource(item: NavigatorItem): void {
    this.previewing = true;
    this.modelStudio.previewSource(this.dataset.id, item.source!).subscribe({
      next: result => {
        this.previewing = false;
        // A slow answer for an entry that is no longer selected is dropped.
        if (this.focused?.key === item.key) this.showRows(result.columns, result.rows);
        this.cdr.markForCheck();
      },
      error: err => this.failPreview(err, 'The preview could not be loaded.'),
    });
  }

  private previewSheet(item: NavigatorItem): void {
    if (!this.upload) return;
    this.previewing = true;
    this.modelStudio.previewImport(this.dataset.id, this.upload.file, this.readOptions(item)).subscribe({
      next: preview => {
        this.previewing = false;
        if (this.focused?.key === item.key) this.applySheetPreview(item, preview);
        this.cdr.markForCheck();
      },
      error: err => this.failPreview(err, 'The sheet could not be read.'),
    });
  }

  private applySheetPreview(item: NavigatorItem, preview: ImportPreview): void {
    const settings = this.settingsOf(item);
    if (!settings.tableName) {
      settings.tableName = preview.suggestedTableName;
      settings.alias = suggestAlias(preview.suggestedTableName, this.takenAliases(item.key));
    }
    settings.headerRow = preview.headerRow;
    settings.lastRow = preview.lastRow;
    settings.types = preview.columns.map(column => column.type);
    this.sheetColumns.set(item.key, preview.columns.map(column => column.name));
    // Ticking every sheet reads sheets that are not on screen.
    if (this.focused?.key !== item.key) return;
    this.sheetPreview = preview;
    this.previewMessage =
      `${preview.dataRows} data rows between row ${preview.headerRow} and row ${preview.lastRow}, of ${preview.sheetRows} rows in the sheet.`;
    this.showRows(preview.columns.map(column => column.name),
      preview.rows.map(row => Object.fromEntries(preview.columns.map((column, i) => [column.name, row[i]]))));
  }

  private failPreview(err: unknown, fallback: string): void {
    this.previewing = false;
    this.showRows([], []);
    this.previewMessage = apiErrorMessage(err, fallback);
    this.cdr.markForCheck();
  }

  private showRows(columns: string[], rows: Record<string, unknown>[]): void {
    this.previewRows = rows;
    this.columnDefs = columns.length ? buildReportGridColumns(() => null, columns, rows) : [];
  }

  /** After a load stopped part way: read the dataset and the uploads again, which unticks what is now added. */
  private refresh(): void {
    forkJoin([this.modelStudio.get(this.dataset.id), this.modelStudio.imports(this.dataset.id)]).subscribe({
      next: ([dataset, imports]) => {
        this.dataset = dataset;
        this.imports = imports;
        this.rebuild();
      },
      error: () => this.cdr.markForCheck(),
    });
  }

  private rebuild(): void {
    const other = this.connections.find(c => c.id === this.connectionId && c.id !== this.dataset.connectionId);
    const listed = navigatorItems(this.dataset, this.tables, this.views, this.imports, this.upload?.sheets ?? [],
      other ? { connection: other, tables: this.otherTables } : undefined);
    // Tables ticked on a database that is no longer listed are kept, so tables of two databases load together.
    const kept = this.items.filter(item => item.group === 'tables' && this.checked.has(item.key)
      && (item.source?.connectionId ?? this.dataset.connectionId) !== this.connectionId && !listed.some(entry => entry.key === item.key)
      && !this.dataset.sources.some(s => (s.connectionId ?? undefined) === item.source?.connectionId
        && tableKey(s.schemaName, s.sourceName) === tableKey(item.source!.schemaName, item.source!.sourceName)));
    this.items = [...listed, ...kept];
    const replacing = this.upload?.replacing;
    if (replacing) {
      for (const item of this.items.filter(entry => entry.sheet)) {
        item.disabled = true;
        item.detail = `Sheet of the new file for ${replacing.tableName}`;
      }
    }
    this.checked = new Set([...this.checked].filter(key => this.items.some(item => item.key === key && !item.disabled)));
    this.focused = this.items.find(item => item.key === this.focused?.key) ?? null;
    this.cdr.markForCheck();
  }

  private takenAliases(exceptKey: string): string[] {
    return [
      ...this.dataset.sources.map(source => source.alias),
      ...[...this.settings.entries()].filter(([key]) => key !== exceptKey && this.checked.has(key)).map(([, settings]) => settings.alias),
    ];
  }
}
