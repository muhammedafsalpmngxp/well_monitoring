import { Component, Input, Output, EventEmitter } from '@angular/core';

export type DialogVariant = 'danger' | 'warning' | 'info';

@Component({
  selector: 'app-confirmation-dialog',
  standalone: false,
  templateUrl: './confirmation-dialog.component.html',
  styleUrls: ['./confirmation-dialog.component.scss'],
  // Prevent the `title` input (passed as a static attribute by callers) from also
  // landing on the host element, which native-tooltip-inherits onto child buttons
  // (e.g. Cancel) that don't set their own title.
  host: { '[attr.title]': 'null' },
})
export class ConfirmationDialogComponent {
  @Input() isOpen = false;
  @Input() title = 'Confirm Action';
  @Input() message = 'Are you sure you want to proceed?';
  @Input() confirmLabel = 'Confirm';
  @Input() cancelLabel = 'Cancel';
  @Input() showCancel = true;
  @Input() customActions = false;
  @Input() secondaryLabel = '';
  @Input() variant: DialogVariant = 'danger';
  @Input() busy = false;
  @Input() details = '';
  @Input() error: string | null = null;
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() secondary = new EventEmitter<void>();

  onConfirm(): void { if (!this.busy) this.confirmed.emit(); }
  onCancel(): void  { if (!this.busy) this.cancelled.emit(); }
}
