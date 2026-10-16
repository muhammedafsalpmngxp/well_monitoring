import { Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output } from '@angular/core';
import { DbSchemaColumn } from '../../../core/services/common-api.service';
import { DatasetDetail, DatasetMeasure, DatasetSource, DatasetSummary } from '../../../core/services/model-studio.service';
import { DataPaneField, DataPaneTable, dataPaneMeasures, dataPaneTables, measureTables } from '../../model-studio/model-studio.util';
import { DataDrag } from '../canvas-wells.util';
import { FilterScope } from '../canvas-filters/canvas-filters.component';

/** The entry the Data pane's menu was opened on, and where the menu shows. */
interface EntryMenu { x: number; y: number; drag: DataDrag; label: string; measure?: DatasetMeasure; source?: DatasetSource; hidden: boolean; }

/**
 * The canvas Data pane (D-13, D-14): the canvas dataset, its measures, and its tables with their columns and
 * calculated columns, listed and searched as Model Studio's Data pane does. Entries are dragged into the field
 * wells, or clicked to fill the selected object's first well that takes them. With model.studio modify it also
 * adds measures and columns to the dataset (D-16). A right-click on an entry opens its menu: add it to the selected
 * object or to a filter, rename or hide it on this canvas only (the dataset keeps its names), edit a measure, add a column.
 */
@Component({
  selector: 'app-canvas-data-pane',
  standalone: false,
  templateUrl: './canvas-data-pane.component.html',
  styleUrls: ['./canvas-data-pane.component.scss'],
})
export class CanvasDataPaneComponent implements OnChanges {
  @Input() datasets: DatasetSummary[] = [];
  @Input() datasetId: number | null = null;
  @Input() dataset: DatasetDetail | null = null;
  @Input() columns: ReadonlyMap<string, DbSchemaColumn[]> = new Map();
  @Input() loading = false;
  /** model.studio modify: Edit measure and New column. New measure is on the canvas toolbar. */
  @Input() canChangeModel = false;
  /** Canvas-only names and hidden entries, by field ("alias.column") or measure name. */
  @Input() fieldNames: Record<string, string> = {};
  @Input() hiddenFields: string[] = [];
  /** An object is selected, so entries can be added to it and to its filters. */
  @Input() hasSelection = false;
  @Output() datasetChange = new EventEmitter<number | null>();
  @Output() dragStarted = new EventEmitter<DataDrag>();
  @Output() dragEnded = new EventEmitter<void>();
  @Output() collapse = new EventEmitter<void>();
  @Output() picked = new EventEmitter<DataDrag>();
  @Output() editMeasure = new EventEmitter<DatasetMeasure>();
  @Output() newColumn = new EventEmitter<DatasetSource>();
  @Output() renameField = new EventEmitter<{ key: string; name: string }>();
  @Output() hideField = new EventEmitter<{ key: string; hidden: boolean }>();
  @Output() addFilter = new EventEmitter<{ scope: FilterScope; drag: DataDrag }>();

  readonly trackTable = (_: number, table: DataPaneTable) => table.source.id;
  readonly kindLabel: Record<string, string> = { number: 'Number', date: 'Date', text: 'Text' };
  search = '';
  tables: DataPaneTable[] = [];
  measures: DatasetMeasure[] = [];
  menu: EntryMenu | null = null;
  /** The entry being renamed for this canvas, and the name being typed. */
  renaming: string | null = null;
  renameValue = '';
  /** Entries hidden on this canvas are listed, greyed, so they can be shown again. */
  showHidden = false;

  constructor(private readonly host: ElementRef<HTMLElement>) {}

  ngOnChanges(): void {
    this.filter();
  }

  filter(): void {
    const hidden = new Set(this.showHidden ? [] : this.hiddenFields);
    this.tables = this.dataset
      ? dataPaneTables(this.dataset, this.columns, this.search, true).map(table => ({
        ...table,
        fields: table.fields.filter(field => !hidden.has(this.fieldKey(table, field))),
        measures: table.measures.map(group => ({ ...group, measures: group.measures.filter(m => !hidden.has(m.name)) }))
          .filter(group => group.measures.length),
      }))
      : [];
    this.measures = this.dataset ? dataPaneMeasures(this.dataset, this.search).filter(m => !hidden.has(m.name)) : [];
  }

  /** The name an entry shows under on this canvas. */
  label(key: string, name: string): string { return this.fieldNames[key] ?? name; }

  isHidden(key: string): boolean { return this.hiddenFields.includes(key); }

  // ── Menu ───────────────────────────────────────────────────────────────────

  openMenu(event: MouseEvent, drag: DataDrag, label: string, extra: { measure?: DatasetMeasure; source?: DatasetSource } = {}): void {
    event.preventDefault();
    // The context menu key gives no pointer position, so the menu opens next to the entry.
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX || box.left + 24;
    const y = event.clientY || box.bottom;
    this.menu = { x: Math.min(x, window.innerWidth - 230), y: Math.min(y, window.innerHeight - 300), drag, label, ...extra, hidden: this.isHidden(drag.name) };
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  @HostListener('window:resize')
  closeMenu(): void {
    this.menu = null;
  }

  menuAdd(): void { const menu = this.take(); if (menu) this.picked.emit(menu.drag); }

  menuFilter(scope: FilterScope): void { const menu = this.take(); if (menu) this.addFilter.emit({ scope, drag: menu.drag }); }

  menuRename(): void {
    const menu = this.take();
    if (!menu) return;
    this.renaming = menu.drag.name;
    this.renameValue = menu.label;
    setTimeout(() => this.host.nativeElement.querySelector<HTMLInputElement>('.canvas-data__rename')?.select());
  }

  menuHide(): void {
    const menu = this.take();
    if (menu) this.hideField.emit({ key: menu.drag.name, hidden: !menu.hidden });
  }

  menuEditMeasure(): void { const menu = this.take(); if (menu?.measure) this.editMeasure.emit(menu.measure); }

  menuNewColumn(): void { const menu = this.take(); if (menu?.source) this.newColumn.emit(menu.source); }

  /** Enter or leaving the box keeps the name; a blank name goes back to the dataset's name. */
  finishRename(): void {
    const key = this.renaming;
    if (key === null) return;
    this.renaming = null;
    this.renameField.emit({ key, name: this.renameValue.trim() });
  }

  cancelRename(): void { this.renaming = null; }

  toggleShowHidden(): void {
    this.showHidden = !this.showHidden;
    this.filter();
  }

  private take(): EntryMenu | null {
    const menu = this.menu;
    this.menu = null;
    return menu;
  }

  /** What a well stores for a field: "alias.column". */
  fieldKey(table: DataPaneTable, field: DataPaneField): string {
    return `${table.source.alias}.${field.name}`;
  }

  /** The select keeps showing the canvas dataset; the editor may ask to confirm before the choice applies. */
  chooseDataset(select: HTMLSelectElement): void {
    const chosen = select.value ? Number(select.value) : null;
    select.value = this.datasetId === null ? '' : String(this.datasetId);
    this.datasetChange.emit(chosen);
  }

  startDrag(event: DragEvent, drag: DataDrag): void {
    // Some browsers start a drag only when data is set. The wells read the drag from the editor, not from here.
    event.dataTransfer?.setData('text/plain', drag.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    this.dragStarted.emit(drag);
  }

  /** A measure that reads more than one table is marked apart, since it depends on the relationships between them. */
  isMultiTable(measure: DatasetMeasure): boolean {
    return measureTables(measure.expression).length > 1;
  }
}
