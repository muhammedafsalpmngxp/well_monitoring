import {
  AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, SimpleChanges,
} from '@angular/core';
import { DbSchemaColumn } from '../../../../core/services/common-api.service';
import { CHART_COLORS } from '../../../../core/constants/chart-view.constants';
import {
  DatasetCalculatedColumn, DatasetMeasure, DatasetRelationship, DatasetSource, RelationshipSuggestion,
} from '../../../../core/services/model-studio.service';
import { CardBox, DiagramLayout, HEADER_HEIGHT, LinkEnd, Point, ROW_HEIGHT, layoutCards, linkPath, placeCards } from '../../diagram-layout.util';
import { Link, Selection, orientLink, sameName, tableKey } from '../../model-studio.util';

/** A row of a table card: a stored column, a calculated column or a measure listed under the table. */
export interface DiagramRow {
  kind: 'column' | 'calculated' | 'measure';
  name: string;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  /** The catalogue column, for a stored column only; a drag connects stored columns. */
  column?: DbSchemaColumn;
  measure?: DatasetMeasure;
}

/** A collapsed card shows this many rows: its keys and linked columns first, then the first other columns. */
export const COLLAPSED_ROWS = 6;

/**
 * accent: the card's colour from the chart palette, by position in the dataset, so a table is easy to spot.
 * rows are the rows shown; hidden counts the rest, and a card with more rows than a collapsed one shows has a footer to switch.
 */
interface CardView {
  source: DatasetSource; box: CardBox; rows: DiagramRow[]; accent: string; expanded: boolean; hidden: number; footer: boolean;
}

interface LineView {
  key: string;
  d: string;
  mid: Point;
  from: LinkEnd;
  to: LinkEnd;
  /** The marks at each end, as in Power BI: * on the many side, 1 on the one side. */
  fromMark: string;
  toMark: string;
  label: string;
  title: string;
  relationship?: DatasetRelationship;
  suggestion?: RelationshipSuggestion;
}

/**
 * Table cards in an automatic grid that the user can rearrange by dragging a card's header; moved cards keep their
 * place in this browser, per dataset. Relationships are lines between column rows with * and 1 at their ends,
 * suggestions dashed.
 */
@Component({
  selector: 'app-model-diagram',
  standalone: false,
  templateUrl: './diagram.component.html',
  styleUrls: ['./diagram.component.scss'],
})
export class DiagramComponent implements OnChanges, AfterViewInit, OnDestroy {
  /** Keys the saved card places. */
  @Input() datasetId = 0;
  @Input() sources: DatasetSource[] = [];
  @Input() relationships: DatasetRelationship[] = [];
  @Input() suggestions: RelationshipSuggestion[] = [];
  @Input() columns = new Map<string, DbSchemaColumn[]>();
  @Input() calculatedColumns: DatasetCalculatedColumn[] = [];
  @Input() measures: DatasetMeasure[] = [];
  @Input() selection: Selection = null;
  @Input() readonly = false;
  @Output() selectionChange = new EventEmitter<Selection>();
  @Output() connect = new EventEmitter<Link>();
  @Output() acceptSuggestion = new EventEmitter<RelationshipSuggestion>();

  readonly headerHeight = HEADER_HEIGHT;
  readonly rowHeight = ROW_HEIGHT;
  layout: DiagramLayout = { cards: [], width: 0, height: 0 };
  cards: CardView[] = [];
  lines: LineView[] = [];

  /** Cards opened to every row, by source id; kept while the dataset is swapped after a save. */
  private readonly expanded = new Set<number>();
  private width = 900;
  private dragged: { sourceId: number; column: DbSchemaColumn } | null = null;
  /** Cards the user moved, by source id. */
  private moved = new Map<number, Point>();
  private moving: { id: number; pointerX: number; pointerY: number; x: number; y: number; started: boolean } | null = null;
  /** Set for the click that ends a card move, so the move does not also select the table. */
  private suppressClick = false;
  private resizeObserver?: ResizeObserver;

  constructor(private readonly host: ElementRef<HTMLElement>, private readonly cdr: ChangeDetectorRef) {}

  ngOnChanges(changes?: SimpleChanges): void {
    if (changes?.['datasetId']) this.moved = readPlaces(this.datasetId);
    this.render();
  }

  get arranged(): boolean { return this.moved.size > 0; }

  /** Starts moving a card from its header; the move begins once the pointer travels a few pixels. */
  startMove(event: PointerEvent, card: CardView): void {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.diagram__card-toggle')) return;
    this.moving = { id: card.source.id, pointerX: event.clientX, pointerY: event.clientY, x: card.box.x, y: card.box.y, started: false };
  }

  @HostListener('window:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    const moving = this.moving;
    if (!moving) return;
    const dx = event.clientX - moving.pointerX;
    const dy = event.clientY - moving.pointerY;
    if (!moving.started && Math.hypot(dx, dy) < 4) return;
    moving.started = true;
    event.preventDefault();
    this.moved.set(moving.id, { x: Math.max(0, Math.round(moving.x + dx)), y: Math.max(0, Math.round(moving.y + dy)) });
    this.render();
  }

  @HostListener('window:pointerup')
  onPointerUp(): void {
    if (this.moving?.started) {
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false));
      savePlaces(this.datasetId, this.moved);
    }
    this.moving = null;
  }

  selectSource(sourceId: number): void {
    if (!this.suppressClick) this.selectionChange.emit({ kind: 'source', id: sourceId });
  }

  /** Puts every card back in the automatic grid. */
  autoArrange(): void {
    this.moved.clear();
    savePlaces(this.datasetId, this.moved);
    this.render();
  }

  ngAfterViewInit(): void {
    // Re-flow the grid when the panel changes width (window resize, sidebar collapse).
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      const width = this.host.nativeElement.clientWidth;
      // A change the size of a scrollbar is ignored: re-flowing for it can show or hide the scrollbar again, and loop.
      if (width > 0 && Math.abs(width - this.width) > 24) {
        this.width = width;
        this.render();
        this.cdr.markForCheck();
      }
    });
    this.resizeObserver.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  isSelected(kind: 'source' | 'relationship', id: number | undefined): boolean {
    const selection = this.selection;
    return (selection?.kind === 'source' || selection?.kind === 'relationship') && selection.kind === kind && selection.id === id;
  }

  isRowSelected(card: CardView, row: DiagramRow): boolean {
    const selection = this.selection;
    if (row.kind === 'measure') return selection?.kind === 'measure' && selection.id === row.measure?.id;
    return selection?.kind === 'column' && selection.sourceId === card.source.id && sameName(selection.column, row.name);
  }

  selectRow(card: CardView, row: DiagramRow): void {
    this.selectionChange.emit(row.kind === 'measure' && row.measure
      ? { kind: 'measure', id: row.measure.id }
      : { kind: 'column', sourceId: card.source.id, column: row.name });
  }

  toggleCard(sourceId: number): void {
    if (!this.expanded.delete(sourceId)) this.expanded.add(sourceId);
    this.render();
  }

  /** Expands or collapses every card. */
  setAll(open: boolean): void {
    this.expanded.clear();
    if (open) this.sources.forEach(source => this.expanded.add(source.id));
    this.render();
  }

  get allExpanded(): boolean {
    return this.sources.length > 0 && this.sources.every(source => this.expanded.has(source.id));
  }

  onBadge(line: LineView): void {
    if (line.suggestion) this.acceptSuggestion.emit(line.suggestion);
    else if (line.relationship) this.selectionChange.emit({ kind: 'relationship', id: line.relationship.id });
  }

  onDragStart(event: DragEvent, sourceId: number, column: DbSchemaColumn): void {
    if (this.readonly) { event.preventDefault(); return; }
    this.dragged = { sourceId, column };
    // Firefox only starts a drag when some data is set.
    event.dataTransfer?.setData('text/plain', column.columnName);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'link';
  }

  onDragOver(event: DragEvent, sourceId: number): void {
    if (!this.dragged || this.dragged.sourceId === sourceId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'link';
  }

  onDrop(event: DragEvent, sourceId: number, column: DbSchemaColumn | undefined): void {
    event.preventDefault();
    const dragged = this.dragged;
    this.dragged = null;
    if (!dragged || !column || dragged.sourceId === sourceId) return;
    this.connect.emit(orientLink(
      { sourceId: dragged.sourceId, column: dragged.column.columnName, isPrimaryKey: dragged.column.isPrimaryKey },
      { sourceId, column: column.columnName, isPrimaryKey: column.isPrimaryKey }));
  }

  onDragEnd(): void {
    this.dragged = null;
  }

  trackCard(_: number, card: CardView): number { return card.source.id; }
  trackLine(_: number, line: LineView): string { return line.key; }
  trackRow(_: number, row: DiagramRow): string { return row.kind + ':' + row.name; }

  private render(): void {
    const ends = [...this.relationships, ...this.suggestions]
      .flatMap(r => [r.fromSourceId + ':' + r.fromColumn.toLowerCase(), r.toSourceId + ':' + r.toColumn.toLowerCase()]);
    const linked = new Set(ends);
    const views = this.sources.map((source, i) => {
      const all = this.rowsOf(source);
      const expanded = this.expanded.has(source.id);
      const shown = expanded ? all : collapsedRows(all, row => linked.has(source.id + ':' + row.name.toLowerCase()));
      return {
        source, rows: shown, accent: CHART_COLORS[i % CHART_COLORS.length], expanded,
        hidden: all.length - shown.length, footer: all.length > COLLAPSED_ROWS,
      };
    });
    this.layout = placeCards(
      layoutCards(views.map(view => ({ id: view.source.id, rowCount: view.rows.length + (view.footer ? 1 : 0) })), this.width), this.moved);
    const boxes = new Map(this.layout.cards.map(box => [box.id, box]));
    this.cards = views.map(view => ({ ...view, box: boxes.get(view.source.id)! }));
    const byId = new Map(this.cards.map(card => [card.source.id, card]));

    const line = (fromId: number, fromColumn: string, toId: number, toColumn: string) => {
      const from = byId.get(fromId);
      const to = byId.get(toId);
      const fromRow = from?.rows.findIndex(r => r.kind === 'column' && sameName(r.name, fromColumn)) ?? -1;
      const toRow = to?.rows.findIndex(r => r.kind === 'column' && sameName(r.name, toColumn)) ?? -1;
      if (!from || !to || fromRow < 0 || toRow < 0) return null;
      return { ...linkPath(from.box, fromRow, to.box, toRow), title: `${from.source.alias}.${fromColumn} to ${to.source.alias}.${toColumn}` };
    };

    this.lines = [
      ...this.relationships.flatMap(relationship => {
        const path = line(relationship.fromSourceId, relationship.fromColumn, relationship.toSourceId, relationship.toColumn);
        const oneToOne = relationship.cardinality === 'one_to_one';
        return path ? [{
          key: `r${relationship.id}`, ...path, relationship, label: oneToOne ? '1 : 1' : 'N : 1', fromMark: oneToOne ? '1' : '*', toMark: '1',
        }] : [];
      }),
      ...this.suggestions.flatMap((suggestion, i) => {
        const path = line(suggestion.fromSourceId, suggestion.fromColumn, suggestion.toSourceId, suggestion.toColumn);
        const basis = suggestion.basis === 'data'
          ? `found in the data: ${suggestion.matchPercent ?? 0}% of the values match` : 'a foreign key in the database';
        return path ? [{
          key: `s${i}`, ...path, title: `${path.title} (${basis})`, suggestion, fromMark: '*', toMark: '1',
          label: suggestion.basis === 'data' ? `Accept ${suggestion.matchPercent ?? 0}%` : 'Accept',
        }] : [];
      }),
    ];
  }

  /** Every row of a table: its stored columns in table order, its calculated columns, then its measures by name. */
  private rowsOf(source: DatasetSource): DiagramRow[] {
    const stored = this.columns.get(tableKey(source.schemaName, source.sourceName)) ?? [];
    return [
      ...stored.map((column): DiagramRow => ({
        kind: 'column', name: column.columnName, isPrimaryKey: column.isPrimaryKey, isForeignKey: column.isForeignKey, column,
      })),
      ...this.calculatedColumns.filter(c => c.sourceId === source.id).sort((a, b) => a.name.localeCompare(b.name))
        .map((c): DiagramRow => ({ kind: 'calculated', name: c.name, isPrimaryKey: false, isForeignKey: false })),
      ...this.measures.filter(m => m.homeSourceId === source.id).sort((a, b) => a.name.localeCompare(b.name))
        .map((m): DiagramRow => ({ kind: 'measure', name: m.name, isPrimaryKey: false, isForeignKey: false, measure: m })),
    ];
  }
}

const placesKey = (datasetId: number) => `twise.model-studio.diagram.${datasetId}`;

/** The card places saved in this browser for a dataset. Storage can be blocked, and the diagram works without it. */
function readPlaces(datasetId: number): Map<number, Point> {
  try {
    const saved = JSON.parse(localStorage.getItem(placesKey(datasetId)) ?? '{}') as Record<string, Point>;
    return new Map(Object.entries(saved)
      .filter(([, p]) => Number.isFinite(p?.x) && Number.isFinite(p?.y))
      .map(([id, p]) => [Number(id), { x: p.x, y: p.y }]));
  } catch {
    return new Map();
  }
}

function savePlaces(datasetId: number, places: Map<number, Point>): void {
  try {
    if (places.size) localStorage.setItem(placesKey(datasetId), JSON.stringify(Object.fromEntries(places)));
    else localStorage.removeItem(placesKey(datasetId));
  } catch {
    // ponytail: places are kept for this visit only when storage is blocked; saving them with the dataset would share them.
  }
}

/**
 * The rows a collapsed card shows, in table order: every key and every column in a relationship or a
 * suggestion, so each line keeps its end, then the first other rows up to COLLAPSED_ROWS.
 */
export function collapsedRows(rows: DiagramRow[], isLinked: (row: DiagramRow) => boolean): DiagramRow[] {
  const keep = new Set(rows.filter(row => row.kind === 'column' && (row.isPrimaryKey || row.isForeignKey || isLinked(row))));
  for (const row of rows) {
    if (keep.size >= COLLAPSED_ROWS) break;
    keep.add(row);
  }
  return rows.filter(row => keep.has(row));
}
