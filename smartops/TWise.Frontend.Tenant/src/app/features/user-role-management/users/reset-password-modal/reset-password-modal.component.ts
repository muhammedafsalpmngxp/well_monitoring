import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-reset-password-modal',
  standalone: false,
  templateUrl: './reset-password-modal.component.html',
  styleUrls: ['./reset-password-modal.component.scss'],
})
export class ResetPasswordModalComponent {
  @Input() isOpen = false;
  @Input() userName = '';
  @Input() email = '';
  @Input() password = '';

  @Output() closed = new EventEmitter<void>();

  copied = false;

  async copyPassword(): Promise<void> {
    if (!this.password) return;
    try {
      await navigator.clipboard.writeText(this.password);
      this.copied = true;
      setTimeout(() => (this.copied = false), 2000);
    } catch {
      this.copied = false;
    }
  }

  close(): void {
    this.copied = false;
    this.closed.emit();
  }
}
