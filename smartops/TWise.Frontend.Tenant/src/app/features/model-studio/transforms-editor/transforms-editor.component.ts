import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { DbSchemaColumn } from '../../../core/services/common-api.service';
import { AddTransformBody, DatasetDetail, DatasetSource, DatasetTransform, TransformKind } from '../../../core/services/model-studio.service';
import { DATE_STYLES, REMOVE_ROW_TESTS, TRANSFORM_LABELS, describeTransform, sameName, tableKey } from '../model-studio.util';

/**
 * The transforms of one table: the list in the order they apply, and a form to add one. It reports
 * through add and remove and the host saves, so any Model Studio page can place it.
 */
@Component({
  selector: 'app-transforms-editor',
  standalone: false,
  templateUrl: './transforms-editor.component.html',
  styleUrls: ['./transforms-editor.component.scss'],
})
export class TransformsEditorComponent implements OnChanges {
  @Input() dataset!: DatasetDetail;
  @Input() columns = new Map<string, DbSchemaColumn[]>();
  @Input() source!: DatasetSource;
  @Input() readonly = false;
  /** The column the form starts on, for a Transform opened from a column. */
  @Input() initialColumn: string | null = null;
  @Output() add = new EventEmitter<AddTransformBody>();
  @Output() remove = new EventEmitter<DatasetTransform>();

  readonly kinds = Object.entries(TRANSFORM_LABELS) as [TransformKind, string][];
  readonly tests = Object.entries(REMOVE_ROW_TESTS);
  readonly styles = Object.entries(DATE_STYLES);

  column = '';
  kind: TransformKind = 'trim';
  /** The fill value, the text a replace finds, or what a removal compares with. */
  value = '';
  replacement = '';
  match: 'part' | 'whole' = 'part';
  toType: 'number' | 'date' | 'text' = 'number';
  style = 'iso';
  op = 'eq';

  ngOnChanges(changes: SimpleChanges): void {
    // Another table: start the form again.
    if (changes['source'] || changes['initialColumn']) {
      this.column = this.tableColumns.find(c => sameName(c.columnName, this.initialColumn ?? ''))?.columnName ?? '';
      this.kind = 'trim';
      this.value = '';
      this.replacement = '';
      this.match = 'part';
      this.toType = 'number';
      this.style = 'iso';
      this.op = 'eq';
    }
  }

  get transforms(): DatasetTransform[] {
    return this.dataset.transforms.filter(t => t.sourceId === this.source.id).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  /** The table's own columns, except the one that decides who sees which rows: that one is read as stored. */
  get tableColumns(): DbSchemaColumn[] {
    const plant = this.source.rlsMode === 'plant' ? this.source.rlsPlantColumn ?? '' : '';
    return (this.columns.get(tableKey(this.source.schemaName, this.source.sourceName)) ?? [])
      .filter(c => !plant || !sameName(c.columnName, plant));
  }

  /** A fill, a replace and a removal that compares need a value; a removal of blank or filled cells does not. */
  get needsValue(): boolean {
    return this.kind === 'null_fill' || this.kind === 'replace'
      || (this.kind === 'remove_rows' && this.op !== 'blank' && this.op !== 'not_blank');
  }

  get canSubmit(): boolean {
    return !this.readonly && !!this.column && (this.kind !== 'replace' || this.value !== '');
  }

  describe(transform: DatasetTransform): string {
    return describeTransform(transform);
  }

  trackTransform(_index: number, transform: DatasetTransform): number {
    return transform.id;
  }

  submit(): void {
    if (this.canSubmit) this.add.emit(this.body());
  }

  private body(): AddTransformBody {
    const base = { sourceId: this.source.id, column: this.column, kind: this.kind };
    switch (this.kind) {
      case 'null_fill':
        return { ...base, value: this.value };
      case 'replace':
        return { ...base, value: this.value, options: { with: this.replacement, match: this.match } };
      case 'type':
        return this.toType === 'date' ? { ...base, value: 'date', options: { style: this.style } } : { ...base, value: this.toType };
      case 'remove_rows':
        return { ...base, value: this.needsValue ? this.value : null, options: { op: this.op } };
      default:
        return { ...base, value: null };
    }
  }
}
