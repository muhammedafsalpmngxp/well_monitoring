import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, QueryList, ViewChild, ViewChildren } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CompactType, DisplayGrid, GridsterConfig, GridsterItemConfig, GridType } from 'angular-gridster2';
import html2canvas from 'html2canvas';
import { Observable, catchError, forkJoin, map, of, shareReplay, switchMap } from 'rxjs';
import { ROUTES } from '../../../core/constants/route.constants';
import { DashboardDetailResponse } from '../../../core/models/dashboard.model';
import { CommonApiService, DbSchema, DbSchemaColumn } from '../../../core/services/common-api.service';
import { DashboardService } from '../../../core/services/dashboard.service';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import {
  DatasetDetail, DatasetMeasure, DatasetSource, DatasetSummary, ModelStudioService, QueryFilter,
} from '../../../core/services/model-studio.service';
import { PermissionService } from '../../../core/services/permission.service';
import { SCHEDULES_MODULE } from '../../../core/services/schedule.service';
import { FormulaStart, QuickMeasure, SavedMeasure } from '../../model-studio/formula-builder/formula-builder.util';
import { MODEL_STUDIO_MODULE, apiErrorMessage, dataPaneTables, readQueryError } from '../../model-studio/model-studio.util';
import { ReportSheet, ReportSheetsService } from '../../reports/shared/report-sheets.service';
import {
  CANVAS_COLUMNS, CANVAS_MODULE, MAX_ROWS, CanvasItem, CanvasSheet, FloatBox, copyItem, CrossFilter, Highlight, SlicerState, columnMap, highlightFor, isDataItem, isForeign,
  moveToDataset, newItem,
  CanvasBookmark, CanvasFields, MAX_BOOKMARKS, crossQuery, readCanvasBookmarks, levelLabel, recordFields, renameSyncedSheet, syncedSlicers, readCanvasConfig, readCanvasDataset, readCanvasFields, readCanvasFilters, readCanvasLook, renameMeasure, serializeCanvas, sheetFilters,
} from '../canvas-config.util';
import { CanvasFilter, FieldKind, MAX_FILTERS, fieldLabel, newFilter } from '../canvas-filter.util';
import { FilterScope } from '../canvas-filters/canvas-filters.component';
import { CanvasObjectComponent, PointClickEvent } from '../canvas-object/canvas-object.component';
import { ExportSize, SheetShot, fileName, fitPng, rowsToExcel, sheetsToPdf, sheetsToPptx } from '../canvas-export.util';
import { displayValue } from '../canvas-format.util';
import { BrandKitService, SavedBrandKit } from '../brand-kit.service';
import { CommentDto, CommentService } from '../../../core/services/comment.service';
import { DataDrag, Visual, addToFirstWell } from '../canvas-wells.util';
import { BrandKit, PageSize, PageStyle, frameCss, pageCss, sanitizeRichText, titleCss } from '../canvas-style.util';

interface PendingConfirm { title: string; message: string; confirmLabel: string; run: () => void; }

/** The side panes folded to a strip, remembered per browser. */
type CanvasPane = 'filters' | 'visuals' | 'data';
const FOLDED_KEY = 'twise.canvas.folded';
/** The copied object, kept for the browser tab so it can be pasted on another sheet or canvas. */
const CLIPBOARD_KEY = 'twise.canvas.clipboard';

function readFolded(): Record<CanvasPane, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '{}') as Partial<Record<CanvasPane, boolean>>;
    // The Filters pane starts folded, so the sheet keeps its width until filters are wanted.
    return { filters: saved.filters !== false, visuals: saved.visuals === true, data: saved.data === true };
  } catch {
    return { filters: true, visuals: false, data: false };
  }
}

/**
 * html2canvas copies custom elements such as Gridster's items with their computed style, so an item's place arrives
 * as transform: matrix(1, 0, 0, 1, x, y). It clips an element's overflow before applying that transform, which cuts
 * off the content of every object below the top row. The copy it draws gets left and top instead of a plain move.
 */
/** A sheet picture's own size, drawn at twice the screen size, as a page. */
function shotPage(shot: SheetShot | undefined): { width: number; height: number } | null {
  return shot ? { width: shot.canvas.width / 2, height: shot.canvas.height / 2 } : null;
}

function placeItems(clone: Document): void {
  clone.querySelectorAll<HTMLElement>('[style*="transform"]').forEach(element => {
    // html2canvas also copies each chart element's computed transform inline; an SVG element has no left or top, and
    // taking its transform away would pile every label, legend item and gauge value into a corner.
    if (element.namespaceURI === 'http://www.w3.org/2000/svg') return;
    const transform = element.style.transform;
    const both = /^matrix\(1, 0, 0, 1, (-?[\d.]+), (-?[\d.]+)\)$/.exec(transform)
      ?? /^translate(?:3d)?\((-?[\d.]+)px, (-?[\d.]+)px(?:, 0px)?\)$/.exec(transform);
    // AG Grid places each table row with translateY; drawn with the export's scale it lands twice as far down.
    const down = /^translateY\((-?[\d.]+)px\)$/.exec(transform);
    const move = both ? [Number(both[1]), Number(both[2])] : down ? [0, Number(down[1])] : null;
    if (!move) return;
    element.style.transform = 'none';
    element.style.left = `${(parseFloat(element.style.left) || 0) + move[0]}px`;
    element.style.top = `${(parseFloat(element.style.top) || 0) + move[1]}px`;
  });
}

const COLOR_PROPERTIES = [
  'color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline-color', 'text-decoration-color', 'fill', 'stroke',
] as const;

/**
 * html2canvas reads only rgb, hsl and hex colours and fails on the color(), oklch() and oklab() values the browser
 * computes for color-mix (AG Grid's theme uses it). Each such colour of the copy is painted once on a 1x1 canvas and
 * written back as rgba. Shadows and gradients with them are dropped from the copy.
 */
function plainColors(clone: Document): void {
  const view = clone.defaultView;
  const context = clone.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!view || !context) return;
  const unsupported = /(color|oklch|oklab|lch|lab)\(/;
  const known = new Map<string, string>();
  const rgba = (value: string): string => {
    let plain = known.get(value);
    if (plain === undefined) {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      plain = `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 100) / 100})`;
      known.set(value, plain);
    }
    return plain;
  };
  clone.querySelectorAll<HTMLElement>('*').forEach(element => {
    const style = view.getComputedStyle(element);
    for (const property of COLOR_PROPERTIES) {
      const value = style.getPropertyValue(property);
      if (unsupported.test(value)) element.style.setProperty(property, rgba(value));
    }
    if (unsupported.test(style.boxShadow)) element.style.boxShadow = 'none';
    if (unsupported.test(style.backgroundImage)) element.style.backgroundImage = 'none';
  });
}

/**
 * html2canvas draws AG Grid's absolutely placed rows twice as far apart as they are, and the grid's theme colours do
 * not resolve in its copy. Each grid on the page is written out as a plain table of the rows it shows, with the
 * header, the grand total row and each cell's colours, weight and bars read from the page, to go in its place.
 */
function gridTables(target: HTMLElement): HTMLTableElement[] {
  const doc = target.ownerDocument;
  const view = doc.defaultView;
  if (!view) return [];
  const look = (from: HTMLElement, to: HTMLElement) => {
    const style = view.getComputedStyle(from);
    for (const property of ['background-color', 'background-image', 'color', 'font-weight', 'text-align'] as const) {
      const value = style.getPropertyValue(property);
      if (value && value !== 'none' && value !== 'rgba(0, 0, 0, 0)') to.style.setProperty(property, value);
    }
  };
  const byColumn = (a: HTMLElement, b: HTMLElement) => Number(a.getAttribute('aria-colindex')) - Number(b.getAttribute('aria-colindex'));
  return [...target.querySelectorAll<HTMLElement>('.ag-root-wrapper')].map(grid => {
    const table = doc.createElement('table');
    table.setAttribute('style', 'width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px;');
    const head = table.createTHead().insertRow();
    const header = grid.querySelector<HTMLElement>('.ag-header');
    // The header colour sits on one of the header's own wrappers; the first one that has a colour gives it.
    for (let node = grid.querySelector<HTMLElement>('.ag-header-cell'); node && node !== grid; node = node.parentElement) {
      const fill = view.getComputedStyle(node).backgroundColor;
      if (fill && fill !== 'rgba(0, 0, 0, 0)' && fill !== 'transparent') { head.style.backgroundColor = fill; break; }
    }
    [...grid.querySelectorAll<HTMLElement>('.ag-header-row-column .ag-header-cell')].sort(byColumn).forEach(cell => {
      const th = doc.createElement('th');
      th.textContent = cell.querySelector('.ag-header-cell-text')?.textContent?.trim() ?? '';
      th.setAttribute('style', `width: ${cell.getBoundingClientRect().width}px; padding: 6px 8px; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`);
      look(cell, th);
      if (header) th.style.color = view.getComputedStyle(cell.querySelector('.ag-header-cell-text') ?? cell).color;
      head.appendChild(th);
    });
    const all = [...grid.querySelectorAll<HTMLElement>('.ag-row')];
    const bottom = all.filter(row => row.closest('.ag-floating-bottom'));
    const rows = [...all.filter(row => !row.closest('.ag-floating-bottom') && !row.closest('.ag-floating-top'))
      .sort((a, b) => Number(a.getAttribute('row-index')) - Number(b.getAttribute('row-index'))), ...bottom];
    const body = table.createTBody();
    rows.forEach(row => {
      const tr = body.insertRow();
      look(row, tr);
      tr.style.height = `${row.getBoundingClientRect().height}px`;
      tr.style.borderBottom = '1px solid #e5e7eb';
      [...row.querySelectorAll<HTMLElement>('.ag-cell')].sort(byColumn).forEach(cell => {
        const td = tr.insertCell();
        td.textContent = cell.textContent?.trim() ?? '';
        td.setAttribute('style', 'padding: 3px 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;');
        look(cell, td);
      });
    });
    return table;
  });
}

/** The copy html2canvas draws: objects placed with left and top, and colours it can read. */
function prepareClone(clone: Document, tables: HTMLTableElement[] = []): void {
  // The grids in the copy are in page order, as the tables were written.
  clone.querySelectorAll<HTMLElement>('.ag-root-wrapper').forEach((grid, i) => {
    if (tables[i]) grid.replaceWith(clone.importNode(tables[i], true));
  });
  placeItems(clone);
  plainColors(clone);
  // html2canvas writes an input's value as text; a range slider's number is not shown on the page.
  clone.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(input => (input.style.color = 'transparent'));
  // The object menu shows while the pointer is over an object; it is not part of the sheet.
  clone.querySelectorAll<HTMLElement>('.canvas-editor__item-action').forEach(button => (button.style.visibility = 'hidden'));
  fitImages(clone);
}

/**
 * html2canvas ignores object-fit and stretches or crops an image to its box. Each image of the copy is drawn as a
 * background of the same size instead, which it sizes as contain or cover.
 */
function fitImages(clone: Document): void {
  clone.querySelectorAll<HTMLImageElement>('img').forEach(image => {
    const fit = image.style.objectFit || clone.defaultView?.getComputedStyle(image).objectFit;
    if (fit !== 'contain' && fit !== 'cover') return;
    const box = clone.createElement('div');
    box.className = image.className;
    box.setAttribute('style', image.getAttribute('style') ?? '');
    box.style.backgroundImage = `url("${image.currentSrc || image.src}")`;
    box.style.backgroundSize = fit;
    box.style.backgroundPosition = 'center';
    box.style.backgroundRepeat = 'no-repeat';
    box.style.display = 'block';
    image.replaceWith(box);
  });
}

/** The choices of the Export dialog. */
interface ExportChoice {
  kind: 'png' | 'pdf' | 'pptx';
  sheets: 'current' | 'all' | 'chosen';
  chosen: Set<string>;
  size: ExportSize;
}

/** The canvas dataset as the Data pane and the Model Studio dialogs need it. */
interface CanvasModel { dataset: DatasetDetail; columns: Map<string, DbSchemaColumn[]>; }

function kindsOf(dataset: DatasetDetail, columns: ReadonlyMap<string, DbSchemaColumn[]>): Map<string, FieldKind> {
  return new Map(dataPaneTables(dataset, columns, '').flatMap(table =>
    table.fields.map(field => [`${table.source.alias}.${field.name}`, field.kind as FieldKind] as [string, FieldKind])));
}

/**
 * The reporting canvas as a full-screen desktop tool, restyled after Power BI Desktop (D-13): a ribbon toolbar, a
 * Gridster sheet with sheet tabs under it, a Visualizations pane and a Data pane. It fills what plan 7b's full-bleed
 * shell gives it and folds the sidebar to its rail while open. A canvas is built on one dataset (D-14). Measures and calculated columns can be added
 * to that dataset from the Data pane (D-16). Sheets are kept by ReportSheetsService; each sheet's state is its
 * CanvasItem list. Save writes the whole canvas through PUT /api/dashboard/{id}.
 */
// ponytail: no prompt about unsaved changes when leaving; Open model saves first. Add a canDeactivate guard if users lose work.
@Component({
  selector: 'app-canvas-editor',
  standalone: false,
  templateUrl: './canvas-editor.component.html',
  styleUrls: ['./canvas-editor.component.scss'],
  // One sheet list per open canvas.
  providers: [ReportSheetsService],
})
export class CanvasEditorComponent implements OnInit, OnDestroy {
  readonly listRoute = `/${ROUTES.CANVAS}`;
  readonly noColumns = new Map<string, DbSchemaColumn[]>();

  canvas: DashboardDetailResponse | null = null;
  datasets: DatasetSummary[] = [];
  /** The canvas dataset: new objects use it and the Data pane lists it. */
  datasetId: number | null = null;
  model: CanvasModel | null = null;
  modelLoading = false;
  /** What is being dragged from the Data pane, for the wells. */
  dragging: DataDrag | null = null;
  /** The open formula builder: the measure it edits (null for a new one) and a quick measure to start from. */
  formula: { measure: DatasetMeasure | null; start: FormulaStart | null } | null = null;
  /** The open calculated-column dialog and its table. */
  columnDialog: { source: DatasetSource } | null = null;
  /** Why the server refused the last measure or column save; shown inside the dialog. */
  formulaError = '';
  busy = false;
  selectedId: string | null = null;
  presenting = false;
  loading = true;
  saving = false;
  error = '';
  renaming = false;
  renameValue = '';
  toast: { kind: 'success' | 'error'; text: string } | null = null;
  confirm: PendingConfirm | null = null;
  /** The canvas as last loaded or saved. */
  private savedSnapshot = '';
  /** Raised by Refresh all; each object on the open sheet then reads its data from the database again. */
  refreshToken = 0;
  exporting = false;
  /** The point clicked on a chart; filters the other objects of the sheet until cleared (P10-3). Not saved. */
  crossFilter: CrossFilter | null = null;
  private readonly highlightCache = new Map<string, { key: string; highlight: Highlight | null }>();
  /** Page settings by sheet id: background, wallpaper, theme and spacing. Saved with the canvas. */
  pages = new Map<string, PageStyle>();
  /** The Filters pane's filters by sheet id, and on all sheets. Saved with the canvas. */
  pageFilters = new Map<string, CanvasFilter[]>();
  canvasFilters: CanvasFilter[] = [];
  /** The canvas brand kit (colours, font, logo) and its fixed page size; null when not set. Saved with the canvas. */
  brand: BrandKit | null = null;
  pageSize: PageSize | null = null;
  /** The object whose three-dot menu is open, and where the menu shows on the screen. */
  itemMenu: { item: CanvasItem; x: number; y: number } | null = null;
  @ViewChildren(CanvasObjectComponent) private objects?: QueryList<CanvasObjectComponent>;
  /** The Export menu is open. */
  exportDialog: ExportChoice | null = null;
  /** The rows behind an object (Show records): its columns, its rows once read, or why they could not be read. */
  records: { title: string; columns: string[]; rows: Record<string, unknown>[]; loading: boolean; error: string } | null = null;
  columnMenu = false;
  /** The stage's size, which a fixed page is scaled to fit. */
  stageBox = { width: 0, height: 0 };
  private stageObserver?: ResizeObserver;

  /** The stage appears once the canvas has loaded; its size is watched from then on. */
  @ViewChild('stage') set stageElement(stage: ElementRef<HTMLElement> | undefined) {
    this.stageObserver?.disconnect();
    if (!stage || typeof ResizeObserver === 'undefined') return;
    this.stageObserver = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width === this.stageBox.width && height === this.stageBox.height) return;
      this.stageBox = { width, height };
      this.cdr.markForCheck();
    });
    this.stageObserver.observe(stage.nativeElement);
  }

  /** The zoom chosen in the sheet bar; null fits the page to the stage. */
  zoom: number | null = null;
  readonly zoomLevels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

  /** One zoom step in or out from the scale shown now; Fit is left for the next level. */
  zoomBy(direction: 1 | -1): void {
    const current = this.pageScale;
    const next = direction > 0
      ? this.zoomLevels.find(level => level > current + 0.01)
      : [...this.zoomLevels].reverse().find(level => level < current - 0.01);
    if (next) this.zoom = next;
  }

  /**
   * A fixed page at the zoom chosen, or shrunk to fit the stage (grown up to twice its size when presenting);
   * 1 without a fixed page.
   */
  get pageScale(): number {
    const size = this.pageSize;
    if (!size || !this.stageBox.width) return 1;
    if (this.zoom) return this.zoom;
    const fit = Math.min((this.stageBox.width - 32) / size.width, (this.stageBox.height - 32) / size.height);
    return Math.max(0.2, Math.floor(Math.min(fit, this.presenting ? 2 : 1) * 100) / 100);
  }

  /** The room a fixed page takes on the stage once scaled. */
  get pageBoxStyle(): Record<string, string> {
    const size = this.pageSize;
    return size ? { width: `${size.width * this.pageScale}px`, height: `${size.height * this.pageScale}px` } : {};
  }

  /** A fixed page at its own size, scaled into its room; Gridster inside measures the unscaled size. */
  get pageInnerStyle(): Record<string, string> {
    const size = this.pageSize;
    return size ? { width: `${size.width}px`, height: `${size.height}px`, transform: `scale(${this.pageScale})` } : {};
  }

  /** The stage's wallpaper, and the brand font and text sizes, which every object on the sheet inherits. */
  get stageStyle(): Record<string, string> {
    const brand = this.brand;
    return {
      ...this.pageStyles.stage,
      ...(brand?.font ? { 'font-family': `"${brand.font}", var(--font-family-base)` } : {}),
      ...(brand?.titleSize ? { '--canvas-title-size': `${brand.titleSize}px` } : {}),
      ...(brand?.subtitleSize ? { '--canvas-subtitle-size': `${brand.subtitleSize}px` } : {}),
      ...(brand?.bodySize ? { '--canvas-body-size': `${brand.bodySize}px` } : {}),
    };
  }

  /** The tenant's saved brand kits, for the Brand kit card; read once, when the canvas opens. */
  savedKits: SavedBrandKit[] = [];
  kitMessage: { kind: 'success' | 'error'; text: string } | null = null;

  /** Applies a saved kit to this canvas as its own copy, noting where it came from. */
  applySavedKit(id: number): void {
    const saved = this.savedKits.find(kit => kit.id === id);
    if (saved) this.setBrand({ ...saved.kit, kitId: saved.id, kitName: saved.name });
  }

  /** Saves this canvas's kit under a new name, or over the saved kit it came from. */
  saveKit(request: { name: string; update: boolean }): void {
    const brand = this.brand ?? {};
    const call = request.update && brand.kitId
      ? this.brandKits.update(brand.kitId, request.name, brand)
      : this.brandKits.create(request.name, brand);
    call.subscribe({
      next: saved => {
        this.savedKits = [...this.savedKits.filter(kit => kit.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name));
        this.brand = { ...brand, kitId: saved.id, kitName: saved.name };
        this.kitMessage = { kind: 'success', text: `Brand kit "${saved.name}" saved. Any canvas can apply it now.` };
        this.cdr.markForCheck();
      },
      error: err => {
        this.kitMessage = { kind: 'error', text: apiErrorMessage(err, 'The brand kit could not be saved.') };
        this.cdr.markForCheck();
      },
    });
  }

  /** Deletes a saved kit; canvases that applied it keep their copy. */
  deleteKit(id: number): void {
    this.brandKits.delete(id).subscribe({
      next: () => {
        const name = this.savedKits.find(kit => kit.id === id)?.name ?? '';
        this.savedKits = this.savedKits.filter(kit => kit.id !== id);
        if (this.brand?.kitId === id) {
          const { kitId: _id, kitName: _name, ...rest } = this.brand;
          this.brand = rest;
        }
        this.kitMessage = { kind: 'success', text: `Brand kit "${name}" deleted. Canvases that use it keep their copy.` };
        this.cdr.markForCheck();
      },
      error: err => {
        this.kitMessage = { kind: 'error', text: apiErrorMessage(err, 'The brand kit could not be deleted.') };
        this.cdr.markForCheck();
      },
    });
  }

  /** The text object open in the large text dialog, and the text being written there. */
  textEdit: { id: string; title: string; html: string } | null = null;
  /** Names and hiding on this canvas only (Data pane menu). Saved with the canvas; the dataset is not changed. */
  fields: CanvasFields = { names: {}, hidden: [] };
  folded: Record<CanvasPane, boolean> = readFolded();
  /** Gridster options by spacing and mode, so a new object is made only when one of them changes. */
  private readonly gridOptions = new Map<string, GridsterConfig>();

  /** One schema request per connection. */
  private readonly schemas = new Map<number, Observable<DbSchema>>();
  private toastTimer?: ReturnType<typeof setTimeout>;
  /** The sidebar state before the canvas opened, restored when it closes, as the dashboard builder does. */
  private sidebarWasCollapsed = false;
  /** Per object, its last filters and their JSON, so an object gets the same array while its filters do not change. */
  private readonly filterCache = new Map<string, { key: string; filters: QueryFilter[] }>();

  /** Gridster reports where an object was moved or resized; the object keeps it until the next save. */
  private readonly placed = (changed: GridsterItemConfig): void => {
    const item = this.items.find(candidate => candidate.id === changed['id']);
    if (item) Object.assign(item, { x: changed.x, y: changed.y, cols: changed.cols, rows: changed.rows });
  };

  // The dashboard builder's grid settings; objects are dragged by their title bar so charts and tables stay usable.
  readonly editOptions: GridsterConfig = {
    gridType: GridType.VerticalFixed,
    fixedRowHeight: 24,
    keepFixedHeightInMobile: true,
    displayGrid: DisplayGrid.OnDragAndResize,
    compactType: CompactType.None,
    minCols: CANVAS_COLUMNS,
    maxCols: CANVAS_COLUMNS,
    minRows: 21,
    // Gridster stops at 100 rows unless told; the canvas keeps objects up to MAX_ROWS, so a long canvas lost its last ones.
    maxRows: MAX_ROWS,
    outerMargin: true,
    margin: 8,
    pushItems: true,
    draggable: { enabled: true, ignoreContent: true, dragHandleClass: 'canvas-editor__handle' },
    resizable: { enabled: true },
    itemChangeCallback: this.placed,
    itemResizeCallback: this.placed,
  };

  readonly viewOptions: GridsterConfig = {
    ...this.editOptions,
    displayGrid: DisplayGrid.None,
    draggable: { enabled: false },
    resizable: { enabled: false },
  };

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    readonly sheets: ReportSheetsService,
    private readonly dashboards: DashboardService,
    private readonly modelStudio: ModelStudioService,
    private readonly commonApi: CommonApiService,
    private readonly permissions: PermissionService,
    private readonly host: ElementRef<HTMLElement>,
    private readonly cdr: ChangeDetectorRef,
    private readonly layout: LayoutStateService,
    private readonly brandKits: BrandKitService,
    private readonly comments: CommentService,
  ) {}

  /** The server saves Draft and Completed canvases only, so a published canvas opens read-only. */
  get published(): boolean { return this.canvas?.status === 'Published'; }
  get readonly(): boolean { return this.published || !this.permissions.canModify(CANVAS_MODULE); }
  get canPublish(): boolean { return !!this.canvas && !this.readonly; }
  scheduleOpen = false;
  get canSchedule(): boolean { return this.permissions.canCreate(SCHEDULES_MODULE); }
  get canUnpublish(): boolean { return this.published && this.permissions.canModify(CANVAS_MODULE); }
  get editing(): boolean { return !this.presenting && !this.readonly; }
  /** A user who may only view canvases (Standard Canvases) sees the canvas as in present mode, with no editor around it. */
  get viewOnly(): boolean { return !this.permissions.canModify(CANVAS_MODULE); }
  get options(): GridsterConfig {
    const spacing = this.page?.spacing ?? 8;
    // Gridster needs the page's scale to follow the pointer while an object is dragged or resized.
    const scale = this.pageScale;
    const key = `${this.editing}:${spacing}:${scale}`;
    let options = this.gridOptions.get(key);
    if (!options) {
      options = { ...(this.editing ? this.editOptions : this.viewOptions), margin: spacing, scale };
      this.gridOptions.set(key, options);
    }
    return options;
  }
  /** The open sheet's page settings. */
  get page(): PageStyle | undefined { return this.sheets.activeId ? this.pages.get(this.sheets.activeId) : undefined; }
  get pageStyles(): { stage: Record<string, string>; sheet: Record<string, string> } { return pageCss(this.page); }
  /** Each field's kind (number, date, text) for slicer styles, from the canvas dataset. */
  fieldKinds = new Map<string, FieldKind>();
  /** The names of the sheets other than the open one, which slicers can sync to. */
  get otherSheets(): string[] { return this.sheets.sheets.filter(sheet => sheet.id !== this.sheets.activeId).map(sheet => sheet.name); }
  /** The open sheet's Filters pane filters. */
  get sheetFilterList(): CanvasFilter[] { return (this.sheets.activeId && this.pageFilters.get(this.sheets.activeId)) || []; }
  /** The objects on the grid, and the text and images floating over it. */
  get gridItems(): CanvasItem[] { return this.items.filter(item => !item.float); }
  get floatItems(): CanvasItem[] { return this.items.filter(item => !!item.float); }
  /** The objects of the active sheet. */
  get items(): CanvasItem[] { return (this.sheets.active?.state as CanvasItem[] | null) ?? []; }
  get selected(): CanvasItem | null { return this.items.find(item => item.id === this.selectedId) ?? null; }
  get sheetIndex(): number { return this.sheets.sheets.findIndex(sheet => sheet.id === this.sheets.activeId); }
  /** New measure, New column, Edit measure and quick measures (D-16). */
  get canChangeModel(): boolean { return this.permissions.canModify(MODEL_STUDIO_MODULE); }
  get canOpenModel(): boolean { return this.permissions.canView(MODEL_STUDIO_MODULE); }
  get datasetName(): string {
    return this.model?.dataset.name ?? this.datasets.find(dataset => dataset.id === this.datasetId)?.name ?? '';
  }
  /** The dialogs say that a change made here reaches every canvas on the dataset (D-16). */
  get modelNotice(): string {
    return `This saves to the data model "${this.datasetName}". Every canvas built on it sees the change.`;
  }
  /** Objects on any sheet that still query another dataset: canvases saved before one dataset per canvas. */
  get foreignCount(): number { return this.allItems().filter(item => isForeign(item, this.datasetId)).length; }
  get crossFilterLabel(): string {
    const cross = this.crossFilter;
    return cross ? `${this.fields.names[cross.field] ?? fieldLabel(cross.field)}: ${cross.values.map(value => value ?? '(blank)').join(', ')}` : '';
  }

  readonly trackSheet = (_: number, sheet: ReportSheet) => sheet.id;
  readonly trackItem = (_: number, item: CanvasItem) => item.id;

  ngOnInit(): void {
    this.sidebarWasCollapsed = this.layout.isCollapsed;
    this.layout.collapse();
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.dashboards.getDashboardById(id).subscribe({
      next: response => {
        const sheets = readCanvasConfig(response.data?.configJson);
        if (sheets) {
          this.canvas = response.data;
          this.sheets.seed(sheets.map(sheet => ({ name: sheet.name, state: sheet.items })));
          this.pages = new Map(this.sheets.sheets.flatMap((sheet, i) => (sheets[i]?.page ? [[sheet.id, sheets[i].page!] as [string, PageStyle]] : [])));
          this.pageFilters = new Map(this.sheets.sheets.flatMap((sheet, i) =>
            (sheets[i]?.filters?.length ? [[sheet.id, sheets[i].filters!] as [string, CanvasFilter[]]] : [])));
          this.canvasFilters = readCanvasFilters(response.data.configJson);
          this.fields = readCanvasFields(response.data.configJson);
          ({ brand: this.brand, size: this.pageSize } = readCanvasLook(response.data.configJson));
          this.bookmarks = readCanvasBookmarks(response.data.configJson);
          // A notification about a comment opens the canvas with its comments shown.
          if (this.route.snapshot.queryParamMap?.get('openComments') === '1') this.openComments();
          this.datasetId = readCanvasDataset(response.data.configJson);
          this.savedSnapshot = this.snapshot();
          this.presenting = this.viewOnly;
          this.loadModel();
        } else {
          this.error = 'This is not a canvas. Open dashboards from WIP Boards or Standard Boards.';
        }
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: err => {
        this.error = apiErrorMessage(err, 'The canvas could not be loaded.');
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
    this.modelStudio.list().subscribe({
      next: datasets => { this.datasets = datasets; this.cdr.markForCheck(); },
      error: () => { this.datasets = []; this.cdr.markForCheck(); },
    });
    this.brandKits.list().subscribe({
      next: kits => { this.savedKits = kits; this.cdr.markForCheck(); },
      error: () => { this.savedKits = []; },
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.toastTimer);
    this.stageObserver?.disconnect();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    if (!this.sidebarWasCollapsed) this.layout.expand();
  }

  // ── Dataset ────────────────────────────────────────────────────────────────

  /** One dataset per canvas: objects on another dataset lose their fields and measures, after a confirmation when any has some. */
  chooseDataset(datasetId: number | null): void {
    if (datasetId === this.datasetId) return;
    const cleared = this.allItems().filter(item => isDataItem(item.type) && item.datasetId !== datasetId
      && (item.dimensions.length > 0 || item.measures.length > 0)).length;
    const apply = (): void => {
      this.sheets.sheets.forEach(sheet => (sheet.state = moveToDataset((sheet.state as CanvasItem[] | null) ?? [], datasetId)));
      this.datasetId = datasetId;
      this.crossFilter = null;
      this.loadModel();
    };
    if (!cleared) {
      apply();
      return;
    }
    this.confirm = {
      title: 'Change the data model',
      message: `Use another data model for this canvas? The fields and measures of ${cleared} object${cleared === 1 ? '' : 's'} will be cleared. `
        + 'The change is kept when you save the canvas.',
      confirmLabel: 'Change data model',
      run: apply,
    };
  }

  /** Saves first, so nothing is lost on the way to Model Studio and back (D-16). */
  openModel(): void {
    const canvas = this.canvas;
    const datasetId = this.datasetId;
    if (!canvas || datasetId === null) return;
    const go = () => this.router.navigate(['/', ROUTES.MODEL_STUDIO, datasetId], { queryParams: { canvas: canvas.dashboardId } });
    if (this.readonly) go();
    else this.save(go);
  }

  /** Saves, then publishes (POST /api/dashboard/{id}/publish). The server's admin check and versioning apply. */
  publish(): void {
    const canvas = this.canvas;
    if (!canvas || this.readonly) return;
    this.save(() => this.dashboards.publishDashboard(canvas.dashboardId).subscribe({
      next: response => {
        this.canvas = { ...canvas, status: 'Published' };
        this.selectedId = null;
        this.renaming = false;
        this.showToast('success', response.data?.message || 'Canvas published.');
      },
      error: err => this.showToast('error', apiErrorMessage(err, 'The canvas could not be published.')),
    }));
  }

  /**
   * Keeps the published version in the history and opens a draft for editing under My canvases. The list is
   * opened rather than the returned id, which is 0 when the series already has a draft.
   */
  unpublish(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    this.dashboards.unpublishDashboard(canvas.dashboardId).subscribe({
      next: () => this.router.navigate(['/', ROUTES.CANVAS]),
      error: err => this.showToast('error', apiErrorMessage(err, 'The canvas could not be unpublished.')),
    });
  }

  // ── Sheets ─────────────────────────────────────────────────────────────────

  selectSheet(id: string): void {
    this.sheets.setActive(id);
    this.selectedId = null;
    this.renaming = false;
    this.crossFilter = null;
  }

  addSheet(): void {
    this.sheets.add();
    this.sheets.saveState([]);
    this.selectedId = null;
    this.renaming = false;
  }

  moveSheet(offset: -1 | 1): void {
    const sheet = this.sheets.active;
    if (sheet) this.sheets.move(sheet.id, offset);
  }

  startRename(): void {
    this.renameValue = this.sheets.active?.name ?? '';
    this.renaming = true;
  }

  /** Enter, and the rename box losing focus, both end a rename; only the first one renames. */
  finishRename(): void {
    if (!this.renaming) return;
    const sheet = this.sheets.active;
    if (sheet) {
      const from = sheet.name;
      this.sheets.rename(sheet.id, this.renameValue);
      const to = this.sheets.active?.name ?? from;
      // Slicers that sync to this sheet by name follow the new name.
      if (to !== from) this.sheets.sheets.forEach(other => (other.state = renameSyncedSheet((other.state as CanvasItem[] | null) ?? [], from, to)));
    }
    this.renaming = false;
  }

  deleteActiveSheet(): void {
    const sheet = this.sheets.active;
    if (!sheet || !this.sheets.canDelete) return;
    const count = ((sheet.state as CanvasItem[] | null) ?? []).length;
    const objects = count ? ` and the ${count} object${count === 1 ? '' : 's'} on it` : '';
    this.confirm = {
      title: 'Delete sheet',
      message: `Delete the sheet "${sheet.name}"${objects}? The change is kept when you save the canvas.`,
      confirmLabel: 'Delete',
      run: () => {
        this.sheets.remove(sheet.id);
        this.selectedId = null;
      },
    };
  }

  // ── Objects ────────────────────────────────────────────────────────────────

  addVisual(visual: Visual): void {
    const made = newItem(visual.type, this.items, this.datasetId);
    const item: CanvasItem = {
      ...made,
      ...(visual.chartType ? { chartType: visual.chartType } : {}),
      ...(visual.gauge ? { gauge: true } : {}),
      ...(visual.stacking ? { stacking: visual.stacking } : {}),
      ...(visual.smooth ? { style: { ...made.style, smooth: true } } : {}),
    };
    this.sheets.saveState([...this.items, item]);
    this.selectedId = item.id;
  }

  select(item: CanvasItem): void {
    if (this.editing) this.selectedId = item.id;
  }

  /** A press anywhere on an object selects it, as in Power BI; charts, slicers and grids still take the click. */
  selectFromSheet(item: CanvasItem): void {
    if (this.editing && this.selectedId !== item.id) this.selectedId = item.id;
  }

  /** A press on the empty sheet deselects, so the Format tab shows the page. */
  deselectFromSheet(event: PointerEvent): void {
    const target = event.target as HTMLElement | null;
    if (this.editing && target && !target.closest('gridster-item, .canvas-editor__float')) this.selectedId = null;
  }

  /** Renames the canvas or changes its description; Save writes them with the sheets. */
  setDetails(details: { name: string; description: string | null }): void {
    if (this.canvas) this.canvas = { ...this.canvas, dashboardName: details.name, description: details.description ?? undefined };
  }

  setPage(page: PageStyle): void {
    const id = this.sheets.activeId;
    if (!id) return;
    if (Object.keys(page).length) this.pages.set(id, page);
    else this.pages.delete(id);
    this.pages = new Map(this.pages);
  }

  setSheetFilters(filters: CanvasFilter[]): void {
    const id = this.sheets.activeId;
    if (!id) return;
    const next = new Map(this.pageFilters);
    if (filters.length) next.set(id, filters);
    else next.delete(id);
    this.pageFilters = next;
  }

  /** A Data pane entry added to a Filters pane section from its menu; the Filters pane opens to show it. */
  addFilterFrom(scope: FilterScope, field: string, kind: FieldKind): void {
    const filter = newFilter(field, kind);
    if (scope === 'visual') {
      const item = this.selected;
      if (!item || (item.filters?.length ?? 0) >= MAX_FILTERS) return;
      this.updateItem({ ...item, filters: [...(item.filters ?? []), filter] });
    } else if (scope === 'page') {
      if (this.sheetFilterList.length < MAX_FILTERS) this.setSheetFilters([...this.sheetFilterList, filter]);
    } else if (this.canvasFilters.length < MAX_FILTERS) {
      this.canvasFilters = [...this.canvasFilters, filter];
    }
    if (this.folded.filters) this.fold('filters', false);
  }

  setBrand(brand: BrandKit | null): void {
    this.brand = brand && Object.keys(brand).length ? brand : null;
  }

  setPageSize(size: PageSize | null): void {
    this.pageSize = size;
    // Gridster measures its width on window resizes only.
    setTimeout(() => window.dispatchEvent(new Event('resize')));
  }

  /** The brand logo as an image object on the open sheet, selected so it can be moved into place. */
  insertLogo(): void {
    const logo = this.brand?.logo;
    if (!logo) return;
    const item: CanvasItem = { ...newItem('image', this.items, null), imageUrl: logo, alt: 'Logo', title: 'Logo', cols: 3, rows: 3,
      style: { showTitle: false, border: false, shadow: false, background: 'transparent' } };
    this.sheets.saveState([...this.items, item]);
    this.selectedId = item.id;
  }

  /**
   * Reset filters, as Power BI's Reset to default: slicers, Filters pane filters and the cross-filter go back to the
   * canvas as it was last saved (or published), on every sheet. Nothing else changes.
   */
  resetFilters(): void {
    let saved: CanvasSheet[] | null = null;
    let savedFilters: CanvasFilter[] = [];
    try {
      const configJson = (JSON.parse(this.savedSnapshot) as [unknown, unknown, string])[2];
      saved = readCanvasConfig(configJson);
      savedFilters = readCanvasFilters(configJson);
    } catch {
      saved = null;
    }
    if (!saved) return;
    this.sheets.sheets.forEach((sheet, index) => {
      const before = new Map((saved![index]?.items ?? []).map(item => [item.id, item]));
      sheet.state = ((sheet.state as CanvasItem[] | null) ?? []).map(item => {
        const original = before.get(item.id);
        const { slicer: _slicer, filters: _filters, ...rest } = item;
        return {
          ...rest,
          ...(original?.slicer ? { slicer: original.slicer } : item.slicer ? { slicer: { ...item.slicer, values: [], last: undefined } } : {}),
          ...(original?.filters ? { filters: original.filters } : {}),
        } as CanvasItem;
      });
      const pageFilters = saved![index]?.filters;
      if (pageFilters?.length) this.pageFilters.set(sheet.id, pageFilters);
      else this.pageFilters.delete(sheet.id);
    });
    this.pageFilters = new Map(this.pageFilters);
    this.canvasFilters = savedFilters;
    this.crossFilter = null;
    this.showToast('success', 'Filters and slicers are back as the canvas was saved.');
  }

  // ── Bookmarks ──────────────────────────────────────────────────────────────

  /** Saved views of this canvas; added and removed while editing, kept when the canvas is saved. */
  bookmarks: CanvasBookmark[] = [];
  bookmarkMenu = false;
  bookmarkName = '';

  /** The canvas as it is shown now: the open sheet, every slicer's choice, the Filters pane and the chosen points. */
  addBookmark(): void {
    const name = this.bookmarkName.trim() || `View ${this.bookmarks.length + 1}`;
    if (this.bookmarks.length >= MAX_BOOKMARKS) return;
    const slicers: Record<string, SlicerState> = {};
    const pageFilters: Record<string, CanvasFilter[]> = {};
    for (const sheet of this.sheets.sheets) {
      ((sheet.state as CanvasItem[] | null) ?? []).forEach(item => { if (item.slicer) slicers[item.id] = item.slicer; });
      const filters = this.pageFilters.get(sheet.id);
      if (filters?.length) pageFilters[sheet.name] = filters;
    }
    this.bookmarks = [...this.bookmarks.filter(mark => mark.name !== name), {
      name, sheet: this.sheets.active?.name ?? '', slicers, filters: this.canvasFilters, pageFilters, cross: this.crossFilter,
    }];
    this.bookmarkName = '';
    this.showToast('success', `Bookmark "${name}" added. Save the canvas to keep it.`);
  }

  /** Opens the bookmark's sheet with its choices; slicers it does not know are left as they are. */
  applyBookmark(mark: CanvasBookmark): void {
    this.bookmarkMenu = false;
    this.sheets.sheets.forEach(sheet => {
      sheet.state = ((sheet.state as CanvasItem[] | null) ?? []).map(item =>
        item.slicer && mark.slicers[item.id] ? { ...item, slicer: mark.slicers[item.id] } : item);
      const filters = mark.pageFilters[sheet.name];
      if (filters?.length) this.pageFilters.set(sheet.id, filters);
      else this.pageFilters.delete(sheet.id);
    });
    this.pageFilters = new Map(this.pageFilters);
    this.canvasFilters = mark.filters;
    const target = this.sheets.sheets.find(sheet => sheet.name === mark.sheet);
    if (target && target.id !== this.sheets.activeId) this.selectSheet(target.id);
    this.crossFilter = mark.cross ?? null;
    this.cdr.markForCheck();
  }

  removeBookmark(mark: CanvasBookmark): void {
    this.bookmarks = this.bookmarks.filter(entry => entry !== mark);
  }

  // ── Comments (the comment threads reports and dashboards use) ─────────────

  commentsOpen = false;
  commentList: CommentDto[] = [];
  commentDraft = '';
  replyTo: number | null = null;
  replyDraft = '';
  commentsBusy = false;

  get commentCount(): number { return this.commentList.reduce((sum, comment) => sum + 1 + comment.replies.length, 0); }

  openComments(about?: CanvasItem): void {
    this.itemMenu = null;
    this.commentsOpen = true;
    if (about) this.commentDraft = `On "${about.title}": `;
    this.loadComments();
  }

  loadComments(): void {
    const id = this.canvas?.dashboardId;
    if (!id) return;
    this.comments.getThread('Canvas', id).subscribe({
      next: list => { this.commentList = list; this.cdr.markForCheck(); },
      error: () => this.showToast('error', 'The comments could not be read.'),
    });
  }

  postComment(parentCommentId: number | null = null): void {
    const id = this.canvas?.dashboardId;
    const body = (parentCommentId ? this.replyDraft : this.commentDraft).trim();
    if (!id || !body || this.commentsBusy) return;
    this.commentsBusy = true;
    this.comments.create({ targetType: 'Canvas', targetId: id, parentCommentId, body }).subscribe({
      next: () => {
        this.commentsBusy = false;
        if (parentCommentId) { this.replyDraft = ''; this.replyTo = null; } else this.commentDraft = '';
        this.loadComments();
      },
      error: () => { this.commentsBusy = false; this.showToast('error', 'The comment could not be posted.'); this.cdr.markForCheck(); },
    });
  }

  deleteComment(comment: CommentDto): void {
    this.comments.delete(comment.commentId).subscribe({
      next: () => this.loadComments(),
      error: () => this.showToast('error', 'Only the author or an administrator can delete this comment.'),
    });
  }

  /** A blank name goes back to the dataset's name. */
  renameField(key: string, name: string): void {
    const names = { ...this.fields.names };
    if (name && name !== key.slice(key.indexOf('.') + 1) && name !== key) names[key] = name;
    else delete names[key];
    this.fields = { ...this.fields, names };
  }

  hideField(key: string, hidden: boolean): void {
    const rest = this.fields.hidden.filter(entry => entry !== key);
    this.fields = { ...this.fields, hidden: hidden ? [...rest, key] : rest };
  }

  fold(pane: CanvasPane, folded: boolean): void {
    this.folded = { ...this.folded, [pane]: folded };
    // Gridster measures its columns on window resizes only; the sheet changed width, so it measures again
    // once the pane has finished folding.
    setTimeout(() => window.dispatchEvent(new Event('resize')), 260);
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify(this.folded));
    } catch {
      // ponytail: the fold is simply not remembered when storage is blocked.
    }
  }

  frameFor(item: CanvasItem): Record<string, string> {
    return frameCss(item.style);
  }

  titleFor(item: CanvasItem): Record<string, string> {
    return titleCss(item.style);
  }

  updateItem(changed: CanvasItem): void {
    this.sheets.saveState(this.items.map(item => (item.id === changed.id ? changed : item)));
  }

  /** A click on a Data pane entry puts it in the first well of the selected object that takes it. */
  pick(drag: DataDrag): void {
    const item = this.selected;
    if (!item) {
      this.showToast('error', 'Select an object on the sheet first, or add one from Visualizations.');
      return;
    }
    if (isForeign(item, this.datasetId)) {
      this.showToast('error', `This object uses another data model. Move it to ${this.datasetName || 'the canvas data model'} first.`);
      return;
    }
    const result = addToFirstWell(item, drag);
    if ('problem' in result) this.showToast('error', result.problem);
    else this.updateItem(result.item);
  }

  /**
   * Floats a text or image over the sheet at the place it has on the grid, or puts it back on the grid where it was.
   * The place is read from the page, in page pixels, so it does not jump.
   */
  setFloating(item: CanvasItem, on: boolean): void {
    if (!on) {
      const { float: _float, ...rest } = item;
      this.updateItem(rest);
      return;
    }
    const page = this.host.nativeElement.querySelector<HTMLElement>('.canvas-editor__page-inner');
    const placed = this.host.nativeElement.querySelector<HTMLElement>(`gridster-item[data-item-id="${item.id}"]`);
    const scale = this.pageScale;
    let box: FloatBox = { x: 24, y: 24, w: 240, h: 120 };
    if (page && placed) {
      const origin = page.getBoundingClientRect();
      const rect = placed.getBoundingClientRect();
      box = {
        x: Math.round((rect.left - origin.left) / scale), y: Math.round((rect.top - origin.top) / scale),
        w: Math.max(16, Math.round(rect.width / scale)), h: Math.max(16, Math.round(rect.height / scale)),
      };
    }
    this.updateItem({ ...item, float: box });
  }

  /** Moves a floating object by its body, or resizes it by its corner; pointer moves are divided by the page scale. */
  startFloatDrag(item: CanvasItem, event: PointerEvent, mode: 'move' | 'resize'): void {
    if (!this.editing || !item.float || event.button !== 0) return;
    event.stopPropagation();
    // A drag must not select the page's text on its way.
    event.preventDefault();
    this.selectedId = item.id;
    const start = { x: event.clientX, y: event.clientY, box: { ...item.float } };
    const scale = this.pageScale;
    let moved = false;
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - start.x) / scale;
      const dy = (e.clientY - start.y) / scale;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      const box = mode === 'move'
        ? { ...start.box, x: Math.max(0, Math.round(start.box.x + dx)), y: Math.max(0, Math.round(start.box.y + dy)) }
        : { ...start.box, w: Math.max(16, Math.round(start.box.w + dx)), h: Math.max(16, Math.round(start.box.h + dy)) };
      const current = this.items.find(candidate => candidate.id === item.id);
      if (current) this.updateItem({ ...current, float: box });
      this.cdr.markForCheck();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** The clone button: a copy next to the object, selected. */
  cloneItem(item: CanvasItem): void {
    const copy = copyItem(item, this.items);
    this.sheets.saveState([...this.items, copy]);
    this.selectedId = copy.id;
  }

  /** The large text dialog: from the Edit text button, or a double-click on a text object while editing. */
  openTextEditor(item: CanvasItem): void {
    if (!this.editing || item.type !== 'text') return;
    this.selectedId = item.id;
    this.textEdit = { id: item.id, title: item.title, html: item.style?.html ?? item.text ?? '' };
  }

  applyText(): void {
    const edit = this.textEdit;
    this.textEdit = null;
    const item = edit && this.items.find(candidate => candidate.id === edit.id);
    if (item) this.updateItem({ ...item, style: { ...item.style, html: sanitizeRichText(edit.html) } });
  }

  /**
   * The three-dot menu of an object: export its data, refresh it, clone or remove it, and when its data was read.
   * It is drawn once, outside the sheet, so an object's edges and the page's scale never cut it off.
   */
  toggleItemMenu(item: CanvasItem, event: MouseEvent): void {
    event.stopPropagation();
    if (this.itemMenu?.item.id === item.id) { this.itemMenu = null; return; }
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.itemMenu = { item, x: Math.max(8, Math.min(box.right - 210, window.innerWidth - 218)), y: Math.min(box.bottom + 4, window.innerHeight - 220) };
  }

  /** The drawn object behind the open menu, for its data time, export and refresh. */
  get menuObject(): CanvasObjectComponent | null {
    const id = this.itemMenu?.item.id;
    return this.objects?.find(object => object.item.id === id) ?? null;
  }

  @HostListener('document:click')
  @HostListener('window:resize')
  closeItemMenu(): void {
    this.itemMenu = null;
  }

  /** Ctrl+C and Ctrl+V copy the selected object and paste it on the open sheet, as in Power BI. Typing is left alone. */
  @HostListener('document:keydown', ['$event'])
  onCopyPaste(event: KeyboardEvent): void {
    if (!this.editing || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'c' && key !== 'v') return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]') || this.formula || this.columnDialog || this.confirm || this.textEdit) return;
    if (key === 'c') {
      const item = this.selected;
      if (!item || window.getSelection()?.toString()) return;
      try {
        sessionStorage.setItem(CLIPBOARD_KEY, JSON.stringify(item));
      } catch {
        // ponytail: without session storage the copy is not kept; Clone still works.
      }
      this.showToast('success', `"${item.title}" copied. Press Ctrl+V to paste it on any sheet.`);
    } else {
      const copied = this.readClipboard();
      if (!copied) return;
      event.preventDefault();
      this.cloneItem(copied);
    }
    this.cdr.markForCheck();
  }

  private readClipboard(): CanvasItem | null {
    try {
      // The copy goes through the same checks as a saved canvas before it is placed.
      const item = JSON.parse(sessionStorage.getItem(CLIPBOARD_KEY) ?? 'null') as CanvasItem | null;
      return item ? readCanvasConfig(serializeCanvas([{ name: 'c', items: [item] }]))?.[0].items[0] ?? null : null;
    } catch {
      return null;
    }
  }

  removeItem(item: CanvasItem): void {
    this.confirm = {
      title: 'Remove object',
      message: `Remove "${item.title}" from this sheet? The change is kept when you save the canvas.`,
      confirmLabel: 'Remove',
      run: () => {
        this.sheets.saveState(this.items.filter(candidate => candidate.id !== item.id));
        this.selectedId = null;
        if (this.crossFilter?.sourceId === item.id) this.crossFilter = null;
      },
    };
  }

  runConfirmed(): void {
    const pending = this.confirm;
    this.confirm = null;
    pending?.run();
  }

  // ── Slicers and cross-filter (P10-1 to P10-3) ─────────────────────────────

  /** The slicer and cross-filter filters of one object on the open sheet, as the same array while they do not change. */
  filtersFor(item: CanvasItem): QueryFilter[] {
    const synced = syncedSlicers(this.sheets.sheets.map(sheet => ({ name: sheet.name, items: (sheet.state as CanvasItem[] | null) ?? [] })),
      this.sheets.active?.name ?? '');
    const filters = sheetFilters(this.items, item, this.datasetId, this.crossFilter, [...this.canvasFilters, ...this.sheetFilterList], synced);
    const key = JSON.stringify(filters);
    const kept = this.filterCache.get(item.id);
    if (kept?.key === key) return kept.filters;
    this.filterCache.set(item.id, { key, filters });
    return filters;
  }

  /**
   * A click on a chart point filters or highlights the other objects; the same point again clears it. Ctrl (Cmd on a
   * Mac) or Shift adds the point to the chosen ones, or takes it out. Objects on another dataset do not filter.
   */
  onPointClick(item: CanvasItem, click: PointClickEvent): void {
    if (!isDataItem(item.type) || isForeign(item, this.datasetId)) return;
    const value = click.value === null || click.value === undefined ? null : String(click.value);
    const cross = this.crossFilter;
    const same = cross?.sourceId === item.id && cross.field === click.field ? cross : null;
    if (same && click.additive) {
      const values = same.values.includes(value) ? same.values.filter(entry => entry !== value) : [...same.values, value];
      this.crossFilter = values.length ? { ...same, values } : null;
    } else {
      this.crossFilter = same?.values.length === 1 && same.values[0] === value ? null : { sourceId: item.id, field: click.field, values: [value] };
    }
    this.cdr.markForCheck();
  }

  /** The highlight a chart draws after a click, as the same object while it does not change. */
  highlightOf(item: CanvasItem): Highlight | null {
    const highlight = highlightFor(item, this.crossFilter);
    const key = JSON.stringify(highlight);
    const kept = this.highlightCache.get(item.id);
    if (kept?.key === key) return kept.highlight;
    this.highlightCache.set(item.id, { key, highlight });
    return highlight;
  }

  clearCrossFilter(): void {
    this.crossFilter = null;
    this.cdr.markForCheck();
  }

  /** A slicer's choice is part of the canvas, as in Power BI, and is kept when the canvas is saved. */
  onSlicerChange(item: CanvasItem, slicer: SlicerState): void {
    this.updateItem({ ...item, slicer });
    this.cdr.markForCheck();
  }

  // ── Measures and calculated columns (D-16) ─────────────────────────────────

  openMeasure(measure: DatasetMeasure | null, quick: QuickMeasure | null = null): void {
    const alias = this.model?.dataset.sources[0]?.alias ?? '';
    this.formula = { measure, start: quick ? { name: quick.name, visual: quick.visual(alias) } : null };
    this.formulaError = '';
  }

  /** New column on the toolbar: straight to the dialog with one table, else a list of tables to pick from. */
  newColumn(): void {
    const sources = this.model?.dataset.sources ?? [];
    if (sources.length === 1) this.openColumn(sources[0]);
    else this.columnMenu = !this.columnMenu;
  }

  openColumn(source: DatasetSource): void {
    this.columnDialog = { source };
    this.formulaError = '';
  }

  /** A refusal keeps the builder open with the server's reason. A rename follows onto this canvas's objects. */
  saveMeasure(saved: SavedMeasure): void {
    const model = this.model;
    if (!model) return;
    const datasetId = model.dataset.id;
    const editing = this.formula?.measure ?? null;
    const renamed = !!editing && editing.name !== saved.name;
    this.saveToModel(
      editing
        ? this.modelStudio.updateMeasure(datasetId, editing.id, saved.name, saved.expression)
        : this.modelStudio.addMeasure(datasetId, saved.name, saved.expression),
      () => {
        this.formula = null;
        if (!editing) return;
        if (renamed) {
          this.sheets.sheets.forEach(sheet =>
            (sheet.state = renameMeasure((sheet.state as CanvasItem[] | null) ?? [], datasetId, editing.name, saved.name)));
        }
        // The objects show the changed calculation.
        this.refreshToken++;
      },
      !editing ? `${saved.name} was added.`
        : renamed ? `${saved.name} was saved. Save the canvas to keep the new name on its objects.` : `${saved.name} was saved.`,
      'The measure could not be saved.');
  }

  saveColumn(saved: SavedMeasure): void {
    const model = this.model;
    const open = this.columnDialog;
    if (!model || !open) return;
    this.saveToModel(
      this.modelStudio.addCalculatedColumn(model.dataset.id, open.source.id, saved.name, saved.expression),
      () => (this.columnDialog = null),
      `${open.source.alias}.${saved.name} was added.`,
      'The calculated column could not be saved.');
  }

  // ── Save and present ───────────────────────────────────────────────────────

  private configJson(): string {
    return serializeCanvas(this.sheets.sheets.map(sheet => ({
      name: sheet.name,
      items: (sheet.state as CanvasItem[] | null) ?? [],
      ...(this.pages.get(sheet.id) ? { page: this.pages.get(sheet.id) } : {}),
      ...(this.pageFilters.get(sheet.id) ? { filters: this.pageFilters.get(sheet.id) } : {}),
    })), this.datasetId, { filters: this.canvasFilters, fields: this.fields, brand: this.brand, size: this.pageSize, bookmarks: this.bookmarks });
  }

  /** The canvas as Save would write it, to tell whether Close loses changes. */
  private snapshot(): string {
    return JSON.stringify([this.canvas?.dashboardName, this.canvas?.description ?? null, this.configJson()]);
  }

  /** Back to the list; asks first when the canvas has changes that were not saved. */
  close(): void {
    const leave = () => this.router.navigateByUrl(this.listRoute);
    if (this.readonly || this.snapshot() === this.savedSnapshot) { leave(); return; }
    this.confirm = {
      title: 'Close without saving?',
      message: 'This canvas has changes that are not saved. Close it and lose them?',
      confirmLabel: 'Close without saving',
      run: leave,
    };
  }

  save(after?: () => void): void {
    if (!this.canvas || this.saving) return;
    this.saving = true;
    const configJson = this.configJson();
    const { dashboardId, dashboardName, categoryId, description } = this.canvas;
    const snapshot = this.snapshot();
    this.dashboards.updateDashboard(dashboardId, { dashboardName, categoryId, description, configJson }).subscribe({
      next: () => {
        this.saving = false;
        this.savedSnapshot = snapshot;
        this.showToast('success', 'Canvas saved.');
        after?.();
      },
      error: err => {
        this.saving = false;
        this.showToast('error', apiErrorMessage(err, 'The canvas could not be saved.'));
      },
    });
  }

  present(): void {
    this.presenting = true;
    this.selectedId = null;
    this.renaming = false;
    // The browser's own full screen when it allows it; the page presents without it too.
    this.host.nativeElement.requestFullscreen?.()?.catch(() => undefined);
  }

  /** A view-only user stays in present mode; only the browser's full screen ends. */
  stopPresenting(): void {
    this.presenting = this.viewOnly;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    this.cdr.markForCheck();
  }

  /** Escape in the browser's full screen ends it first; present mode follows. */
  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    if (!document.fullscreenElement && this.presenting) this.stopPresenting();
  }

  /** Escape ends present mode first; otherwise it clears the cross-filter. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.itemMenu) this.itemMenu = null;
    else if (this.textEdit) this.textEdit = null;
    else if (this.presenting) this.stopPresenting();
    else if (this.crossFilter) this.clearCrossFilter();
  }

  // ponytail: only the open sheet's objects exist, so objects on other sheets load from the cache when shown; refresh them too if users ask.
  refreshAll(): void {
    this.refreshToken++;
  }

  /**
   * The rows behind an object, as Power BI's See records: the columns of the table it adds up, under the filters it
   * shows now (its drill level and a point chosen on it included), up to 500 rows.
   */
  showRecords(item: CanvasItem): void {
    const object = this.menuObject;
    const model = this.model;
    this.itemMenu = null;
    if (!object || !model) return;
    const columns = recordFields(item, model.dataset, model.columns);
    if (!columns.length) return;
    const own = this.crossFilter?.sourceId === item.id ? [crossQuery(this.crossFilter)] : [];
    this.records = { title: item.title, columns, rows: [], loading: true, error: '' };
    this.modelStudio.runQuery({
      datasetId: model.dataset.id, dimensions: columns, measures: [], filters: [...object.recordFilters(), ...own], topN: 500,
      ...(this.published ? {} : { draft: true }),
    }).subscribe({
      next: result => {
        if (this.records) this.records = { ...this.records, rows: result.rows, loading: false };
        this.cdr.markForCheck();
      },
      error: err => {
        if (this.records) this.records = { ...this.records, loading: false, error: readQueryError(err).message };
        this.cdr.markForCheck();
      },
    });
  }

  recordHeader(column: string): string { return levelLabel(column, this.fields.names); }
  recordCell(value: unknown): string { return value === null || value === undefined ? '' : displayValue(value); }

  exportRecords(): void {
    const records = this.records;
    if (records) rowsToExcel(`${records.title} records`, records.columns, records.rows, this.fields.names).catch(() => undefined);
  }

  openExport(): void {
    const all = this.sheets.sheets.map(sheet => sheet.id);
    this.exportDialog = { kind: 'pdf', sheets: all.length > 1 ? 'all' : 'current', chosen: new Set(all), size: 'fit' };
  }

  toggleExportSheet(id: string): void {
    const chosen = this.exportDialog?.chosen;
    if (chosen && !chosen.delete(id)) chosen.add(id);
  }

  /** The sheets the dialog exports, in sheet order. */
  exportSheetIds(choice: ExportChoice): string[] {
    const all = this.sheets.sheets.map(sheet => sheet.id);
    if (choice.sheets === 'current') return this.sheets.activeId ? [this.sheets.activeId] : [];
    return choice.sheets === 'all' ? all : all.filter(id => choice.chosen.has(id));
  }

  runExport(choice: ExportChoice): void {
    const ids = this.exportSheetIds(choice);
    this.exportDialog = null;
    void this.exportAs(choice.kind, ids, choice.size);
  }

  /**
   * The chosen sheets, by default the open one, as PNG files, one PDF (a page each) or one PowerPoint file (a slide
   * each), in sheet order. Each sheet is shown in turn and drawn once its objects have their data. Actual size keeps a
   * page the size of its sheet; fit to width puts sheets on A4 landscape pages, 16:9 slides or 1920-pixel images.
   */
  // ponytail: sheets are drawn from the page as shown (html2canvas); a sheet taller than the screen in Fit to the screen is cut at the stage. Images from sites without cross-origin reads come out blank.
  async exportAs(kind: 'png' | 'pdf' | 'pptx', sheetIds?: string[], size: ExportSize = 'actual'): Promise<void> {
    if (this.exporting || !this.canvas) return;
    const ids = sheetIds ?? (this.sheets.activeId ? [this.sheets.activeId] : []);
    this.exporting = true;
    this.selectedId = null;
    // Paint the busy button before html2canvas clones the page, which blocks the main thread on a full sheet.
    this.cdr.detectChanges();
    const title = this.canvas.dashboardName;
    const start = this.sheets.activeId;
    try {
      const shots: SheetShot[] = [];
      for (const sheet of this.sheets.sheets.filter(s => ids.includes(s.id))) {
        if (sheet.id !== this.sheets.activeId) this.selectSheet(sheet.id);
        shots.push({ name: sheet.name, canvas: await this.captureSheet() });
      }
      if (start && start !== this.sheets.activeId) this.selectSheet(start);
      if (kind === 'png') {
        for (const shot of shots) {
          const link = document.createElement('a');
          link.download = `${fileName(title)} - ${fileName(shot.name)}.png`;
          link.href = (size === 'fit' ? fitPng(shot.canvas) : shot.canvas).toDataURL('image/png');
          link.click();
        }
      } else if (kind === 'pdf') {
        await sheetsToPdf(title, shots, size);
      } else {
        await sheetsToPptx(title, shots, size === 'fit' ? null : this.pageSize ?? shotPage(shots[0]));
      }
    } catch {
      this.showToast('error', 'The canvas could not be exported. Try again.');
    } finally {
      this.exporting = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * The open sheet as a picture: a fixed page as shown, drawn at twice its own size whatever its scale on screen, or
   * the stage as shown at twice the screen size.
   */
  private async captureSheet(): Promise<HTMLCanvasElement> {
    this.cdr.detectChanges();
    await this.settled();
    const target = this.host.nativeElement.querySelector<HTMLElement>(this.pageSize ? '.canvas-editor__page' : '.canvas-editor__stage');
    if (!target) throw new Error('The sheet is not shown.');
    const background = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-card').trim() || null;
    const tables = gridTables(target);
    return html2canvas(target, {
      scale: 2 / this.pageScale, useCORS: true, backgroundColor: background, imageTimeout: 8000, onclone: clone => prepareClone(clone, tables),
    });
  }

  /** Waits until no object on the sheet is loading (20 seconds at most), then lets charts finish drawing. */
  private async settled(): Promise<void> {
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    const deadline = Date.now() + 20_000;
    await wait(300);
    while (Date.now() < deadline && this.host.nativeElement.querySelector('.canvas-object__loading')) await wait(200);
    await wait(900);
  }

  private allItems(): CanvasItem[] {
    return this.sheets.sheets.flatMap(sheet => (sheet.state as CanvasItem[] | null) ?? []);
  }

  /** The canvas dataset with the catalogue columns of its tables and views. A later choice wins over a slow answer. */
  private loadModel(): void {
    const datasetId = this.datasetId;
    this.model = null;
    this.modelLoading = datasetId !== null;
    if (datasetId === null) return;
    this.modelStudio.get(datasetId).pipe(
      switchMap(dataset => forkJoin([
        this.schemaFor(dataset.connectionId),
        // ponytail: the view list can be refused to users with canvas permission only; view sources then show no fields in the Data pane. Widen that endpoint's read rule if canvas authors need them.
        this.modelStudio.viewTables(dataset).pipe(catchError(() => of([]))),
      ]).pipe(map(([schema, views]) => ({ dataset, columns: columnMap([...schema.tables, ...views]) })))),
    ).subscribe({
      next: model => {
        if (datasetId !== this.datasetId) return;
        this.model = model;
        this.fieldKinds = kindsOf(model.dataset, model.columns);
        this.modelLoading = false;
        this.cdr.markForCheck();
      },
      error: err => {
        if (datasetId !== this.datasetId) return;
        this.modelLoading = false;
        this.showToast('error', apiErrorMessage(err, 'The data model could not be loaded.'));
      },
    });
  }

  /** Saves a measure or a calculated column from its dialog. A refusal keeps the dialog open with the server's reason. */
  private saveToModel(request: Observable<DatasetDetail>, close: () => void, success: string, failure: string): void {
    this.busy = true;
    this.formulaError = '';
    request.subscribe({
      next: dataset => {
        this.busy = false;
        // A new calculated column needs no new catalogue columns: the Data pane reads it from the dataset.
        if (this.model) {
          this.model = { ...this.model, dataset };
          this.fieldKinds = kindsOf(dataset, this.model.columns);
        }
        close();
        this.showToast('success', success);
      },
      error: err => {
        this.busy = false;
        this.formulaError = apiErrorMessage(err, failure);
        this.cdr.markForCheck();
      },
    });
  }

  private schemaFor(connectionId: number): Observable<DbSchema> {
    let schema = this.schemas.get(connectionId);
    if (!schema) {
      // shareReplay resets on error, so a failed request is tried again by the next dataset that needs it.
      schema = this.commonApi.getConnectionSchema(connectionId).pipe(shareReplay(1));
      this.schemas.set(connectionId, schema);
    }
    return schema;
  }

  private showToast(kind: 'success' | 'error', text: string): void {
    this.toast = { kind, text };
    this.cdr.markForCheck();
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast = null; this.cdr.markForCheck(); }, 4000);
  }
}
