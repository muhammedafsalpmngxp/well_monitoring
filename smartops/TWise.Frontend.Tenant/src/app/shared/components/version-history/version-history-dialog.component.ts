import { Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * One entry in a version history, normalised so dashboards and reports — which have
 * different backend shapes — can share this dialog.
 */
export interface VersionHistoryItem {
  versionNo: number;
  /** Free-text line under the version number (report description, dashboard status…). */
  label?: string | null;
  /** True for the version currently live. */
  isCurrent: boolean;
  publishedBy?: string | null;
  publishedAt?: string | null;
  /** 'publish' | 'restore' — 'restore' entries show where they were rolled back from. */
  reason?: string | null;
  restoredFromVersionNo?: number | null;
}

/**
 * Lists published versions and lets an admin roll back to one.
 *
 * Restore is append-only on the backend: rolling back to v0 publishes a NEW version
 * containing v0's content rather than deleting anything, so the history only ever grows.
 * The wording here reflects that, so nobody expects a destructive revert.
 */
@Component({
  selector: 'app-version-history-dialog',
  standalone: false,
  templateUrl: './version-history-dialog.component.html',
  styleUrls: ['./version-history-dialog.component.scss'],
})
export class VersionHistoryDialogComponent {
  @Input() isOpen = false;
  @Input() title = 'Version history';
  @Input() subtitle = '';
  @Input() versions: VersionHistoryItem[] = [];
  @Input() loading = false;
  /** Version number currently being restored, so only that row shows a spinner. */
  @Input() restoringVersionNo: number | null = null;
  /** Restore is admin-only on the backend; hide the action when the user cannot use it. */
  @Input() canRestore = true;
  @Input() errorMessage = '';

  @Output() restore = new EventEmitter<number>();
  @Output() closed = new EventEmitter<void>();

  /** Set when the user has clicked Restore and is being asked to confirm. */
  pendingVersionNo: number | null = null;

  get pendingVersion(): VersionHistoryItem | undefined {
    return this.versions.find(v => v.versionNo === this.pendingVersionNo);
  }

  /** The version number the restore will produce — one past the highest that exists. */
  get nextVersionNo(): number {
    return this.versions.length === 0 ? 0 : Math.max(...this.versions.map(v => v.versionNo)) + 1;
  }

  askRestore(versionNo: number): void {
    this.pendingVersionNo = versionNo;
  }

  cancelRestore(): void {
    this.pendingVersionNo = null;
  }

  confirmRestore(): void {
    if (this.pendingVersionNo === null) return;
    this.restore.emit(this.pendingVersionNo);
    this.pendingVersionNo = null;
  }

  close(): void {
    this.pendingVersionNo = null;
    this.closed.emit();
  }

  trackByVersion(_index: number, item: VersionHistoryItem): number {
    return item.versionNo;
  }
}
