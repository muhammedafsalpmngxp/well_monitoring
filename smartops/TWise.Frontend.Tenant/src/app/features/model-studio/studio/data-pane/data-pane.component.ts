import { Component, EventEmitter, HostListener, Input, OnChanges, Output } from '@angular/core';
import { DbSchemaColumn } from '../../../../core/services/common-api.service';
import {
  DatasetCalculatedColumn, DatasetDetail, DatasetMeasure, DatasetSource, MeasureNode,
} from '../../../../core/services/model-studio.service';
import {
  DataPaneField, DataPaneTable, MeasureGroup, Selection, dataPaneMeasures, dataPaneTables, describeMeasure, groupMeasures, measureFolders,
} from '../../model-studio.util';

/** Where a measure is listed: under a table or with the dataset (null), and in a folder or none (null). */
export interface MeasurePlacement { measure: DatasetMeasure; homeSourceId: number | null; folder: string | null; }

/** The open context menu: the measure, where it opened, and whether the folder name box is showing. */
interface MeasureMenu { measure: DatasetMeasure; x: number; y: number; naming: boolean; }

/**
 * The Data pane of the Model and Data views: each table with its fields and the measures listed under it,
 * then the dataset's own measures, both grouped by folder. A measure moves with its menu (right-click or
 * the more button) or by dragging it onto a table or the Measures heading.
 */
@Component({
  selector: 'app-model-data-pane',
  standalone: false,
  templateUrl: './data-pane.component.html',
  styleUrls: ['./data-pane.component.scss'],
})
export class DataPaneComponent implements OnChanges {
  @Input() dataset: DatasetDetail | null = null;
  @Input() columns = new Map<string, DbSchemaColumn[]>();
  /** The table the Data view shows and New column adds to. */
  @Input() activeSourceId: number | null = null;
  @Input() selection: Selection = null;
  @Input() readonly = false;
  @Output() selectSource = new EventEmitter<number>();
  @Output() selectionChange = new EventEmitter<Selection>();
  /** Opens the formula builder on a measure. */
  @Output() editMeasure = new EventEmitter<DatasetMeasure>();
  @Output() removeMeasure = new EventEmitter<DatasetMeasure>();
  @Output() placeMeasure = new EventEmitter<MeasurePlacement>();
  /** Opens the calculated-column dialog on a stored column. */
  @Output() editColumn = new EventEmitter<{ source: DatasetSource; column: DatasetCalculatedColumn }>();
  @Output() removeColumn = new EventEmitter<DatasetCalculatedColumn>();
  /** Hides a column from report builders, or shows it again. */
  @Output() toggleHidden = new EventEmitter<{ source: DatasetSource; column: string }>();
  @Output() collapse = new EventEmitter<void>();

  search = '';
  tables: DataPaneTable[] = [];
  measures: MeasureGroup[] = [];
  folders: string[] = [];
  menu: MeasureMenu | null = null;
  folderName = '';
  /** The table or the Measures heading (0) a dragged measure is over. */
  dropTarget: number | null = null;
  /** Tables and folders opened by the user (tables by source id, folders by key); everything starts folded. */
  private readonly opened = new Set<string>();
  private dragged: DatasetMeasure | null = null;

  ngOnChanges(): void {
    this.filter();
  }

  filter(): void {
    this.tables = this.dataset ? dataPaneTables(this.dataset, this.columns, this.search) : [];
    this.measures = this.dataset ? groupMeasures(dataPaneMeasures(this.dataset, this.search)) : [];
    this.folders = this.dataset ? measureFolders(this.dataset) : [];
  }

  get measureCount(): number {
    return this.measures.reduce((total, group) => total + group.measures.length, 0);
  }

  /** A search shows every table and folder that matches unfolded, so a match is never hidden. */
  isOpen(sourceId: number): boolean {
    return !!this.search.trim() || this.opened.has(String(sourceId));
  }

  toggleTable(sourceId: number): void {
    this.toggle(String(sourceId));
  }

  /** A folder under a table, or with the dataset's measures for 0. */
  isFolderOpen(sourceId: number, folder: string): boolean {
    return !!this.search.trim() || this.opened.has(`${sourceId}/${folder}`);
  }

  toggleFolder(sourceId: number, folder: string): void {
    this.toggle(`${sourceId}/${folder}`);
  }

  private toggle(key: string): void {
    if (!this.opened.delete(key)) this.opened.add(key);
  }

  isColumnSelected(sourceId: number, name: string): boolean {
    const selection = this.selection;
    return selection?.kind === 'column' && selection.sourceId === sourceId && selection.column === name;
  }

  isMeasureSelected(measure: DatasetMeasure): boolean {
    return this.selection?.kind === 'measure' && this.selection.id === measure.id;
  }

  selectField(table: DataPaneTable, field: DataPaneField): void {
    this.selectionChange.emit({ kind: 'column', sourceId: table.source.id, column: field.name });
  }

  selectMeasure(measure: DatasetMeasure): void {
    this.selectionChange.emit({ kind: 'measure', id: measure.id });
  }

  openMenu(event: MouseEvent, measure: DatasetMeasure): void {
    if (this.readonly) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement | null;
    const box = target?.getBoundingClientRect();
    // A right-click opens where it was; the more button opens under itself.
    const x = event.type === 'contextmenu' ? event.clientX : (box?.right ?? event.clientX) - 200;
    const y = event.type === 'contextmenu' ? event.clientY : (box?.bottom ?? event.clientY) + 4;
    this.menu = { measure, x: Math.max(8, Math.min(x, window.innerWidth - 232)), y: Math.min(y, window.innerHeight - 320), naming: false };
    this.folderName = '';
  }

  closeMenu(): void {
    this.menu = null;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeMenu();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.closeMenu();
  }

  /** Moves the measure under a table, or with the dataset's measures for null, keeping its folder. */
  moveTo(homeSourceId: number | null): void {
    const menu = this.menu;
    if (!menu) return;
    this.closeMenu();
    this.place(menu.measure, homeSourceId, menu.measure.folder ?? null);
  }

  /** Puts the measure in a folder, or in none for null, keeping its table. */
  putInFolder(folder: string | null): void {
    const menu = this.menu;
    if (!menu) return;
    const name = folder?.trim() || null;
    this.closeMenu();
    this.place(menu.measure, menu.measure.homeSourceId ?? null, name);
  }

  startFolderName(event: Event): void {
    event.stopPropagation();
    if (this.menu) this.menu = { ...this.menu, naming: true };
  }

  menuAction(action: 'edit' | 'remove'): void {
    const measure = this.menu?.measure;
    this.closeMenu();
    if (!measure) return;
    if (action === 'edit') this.editMeasure.emit(measure);
    else this.removeMeasure.emit(measure);
  }

  onMeasureDragStart(event: DragEvent, measure: DatasetMeasure): void {
    if (this.readonly) { event.preventDefault(); return; }
    this.dragged = measure;
    event.dataTransfer?.setData('text/plain', measure.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  /** 0 is the Measures heading; any other number is a table. */
  onDragOver(event: DragEvent, target: number): void {
    if (!this.dragged) return;
    event.preventDefault();
    this.dropTarget = target;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  onDragLeave(target: number): void {
    if (this.dropTarget === target) this.dropTarget = null;
  }

  onDrop(event: DragEvent, target: number): void {
    event.preventDefault();
    const measure = this.dragged;
    this.dragged = null;
    this.dropTarget = null;
    if (measure) this.place(measure, target === 0 ? null : target, measure.folder ?? null);
  }

  onDragEnd(): void {
    this.dragged = null;
    this.dropTarget = null;
  }

  aliasOf(sourceId: number | null | undefined): string {
    return this.dataset?.sources.find(s => s.id === sourceId)?.alias ?? 'Measures';
  }

  describe(expression: MeasureNode | null): string {
    return describeMeasure(expression);
  }

  describeColumn(column: DatasetCalculatedColumn): string {
    return column.expression ? describeMeasure(column.expression) : 'This column cannot be read. Open it to write it again, or delete it.';
  }

  /** Keeps a field's row when the dataset is swapped, so only a field that is new fades in. */
  trackField(_index: number, field: DataPaneField): string {
    return field.name;
  }

  /** Keeps each row, and so its buttons, when the dataset is swapped after a save. */
  trackTable(_index: number, table: DataPaneTable): number {
    return table.source.id;
  }

  trackGroup(_index: number, group: MeasureGroup): string {
    return group.folder ?? '';
  }

  trackMeasure(_index: number, measure: DatasetMeasure): number {
    return measure.id;
  }

  private place(measure: DatasetMeasure, homeSourceId: number | null, folder: string | null): void {
    if ((measure.homeSourceId ?? null) === homeSourceId && (measure.folder ?? null) === folder) return;
    this.placeMeasure.emit({ measure, homeSourceId, folder });
  }
}
