import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { DbSchemaColumn } from '../../../../core/services/common-api.service';
import { AddTransformBody, DatasetDetail, DatasetSource, DatasetTransform } from '../../../../core/services/model-studio.service';
import { keepFocusInside } from '../../model-studio.util';

/**
 * Transform data, as a dialog like New column and New measure: a table to work on, its transforms in the
 * order they apply, and the form to add one. Each change saves at once through add and remove.
 */
@Component({
  selector: 'app-transform-dialog',
  standalone: false,
  templateUrl: './transform-dialog.component.html',
  styleUrls: ['../../formula-builder/formula-builder.component.scss', './transform-dialog.component.scss'],
})
export class TransformDialogComponent implements AfterViewInit, OnDestroy {
  @Input() dataset!: DatasetDetail;
  @Input() columns = new Map<string, DbSchemaColumn[]>();
  @Input() sourceId: number | null = null;
  @Input() column: string | null = null;
  @Input() readonly = false;
  @Input() saving = false;
  @Output() add = new EventEmitter<AddTransformBody>();
  @Output() remove = new EventEmitter<DatasetTransform>();
  @Output() closed = new EventEmitter<void>();

  @ViewChild('dialog') dialog?: ElementRef<HTMLElement>;
  @ViewChild('tableSelect') tableSelect?: ElementRef<HTMLSelectElement>;

  private readonly opener = document.activeElement as HTMLElement | null;

  get source(): DatasetSource | undefined {
    return this.dataset.sources.find(s => s.id === this.sourceId) ?? this.dataset.sources[0];
  }

  ngAfterViewInit(): void {
    this.tableSelect?.nativeElement.focus();
  }

  ngOnDestroy(): void {
    queueMicrotask(() => this.opener?.focus());
  }

  chooseTable(id: string): void {
    this.sourceId = Number(id);
    this.column = null;
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closed.emit();
      return;
    }
    if (this.dialog) keepFocusInside(event, this.dialog.nativeElement);
  }
}
