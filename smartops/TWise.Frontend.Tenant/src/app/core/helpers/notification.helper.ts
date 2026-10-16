import { ChangeDetectorRef } from '@angular/core';

/**
 * Lightweight notification helper for showing success/error toasts.
 * Instantiate per-component via `new NotificationHelper(cdr)`.
 */
export class NotificationHelper {
  successMessage = '';
  error = '';
  infoMessage = '';

  private successTimeout: any;
  private errorTimeout: any;

  constructor(private readonly cdr: ChangeDetectorRef) {}

  showSuccess(message: string): void {
    this.successMessage = message;
    if (this.successTimeout) clearTimeout(this.successTimeout);
    this.successTimeout = setTimeout(() => {
      this.successMessage = '';
      this.cdr.markForCheck();
    }, 4000);
  }

  /**
   * Persistent "processing"/info toast that stays visible until clearInfo() is called
   * (e.g. when a slow request completes). Unlike success/error it does not auto-dismiss.
   */
  showInfo(message: string): void {
    this.infoMessage = message;
    this.cdr.markForCheck();
  }

  clearInfo(): void {
    this.infoMessage = '';
    this.cdr.markForCheck();
  }

  showError(message: string): void {
    this.error = message;
    if (this.errorTimeout) clearTimeout(this.errorTimeout);
    this.errorTimeout = setTimeout(() => {
      this.error = '';
      this.cdr.markForCheck();
    }, 5000);
  }

  clearError(): void {
    this.error = '';
    if (this.errorTimeout) clearTimeout(this.errorTimeout);
  }

  clearSuccess(): void {
    this.successMessage = '';
    if (this.successTimeout) clearTimeout(this.successTimeout);
  }

  destroy(): void {
    if (this.successTimeout) clearTimeout(this.successTimeout);
    if (this.errorTimeout) clearTimeout(this.errorTimeout);
  }
}
