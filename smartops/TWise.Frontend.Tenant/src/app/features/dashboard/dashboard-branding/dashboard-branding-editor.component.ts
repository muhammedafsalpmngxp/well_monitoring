import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { forkJoin, of, Subscription, tap } from 'rxjs';
import { DashboardBranding, DashboardLogoAsset, normalizeDashboardBranding } from '../../../core/models/dashboard.model';
import { DashboardLogoService } from '../../../core/services/dashboard-logo.service';
import { DashboardLogoComponent } from './dashboard-logo.component';
import { DashboardBrandingIconDirective } from './dashboard-branding-icon.directive';

import { FieldLabelDirective } from '../../../shared/directives/field-label.directive';
type LogoSide = 'leftLogo' | 'rightLogo';
interface LogoSelection { asset: DashboardLogoAsset | null; file?: File; previewUrl: string; error: string; checking: boolean; version: number; }

@Component({
  selector: 'app-dashboard-branding-editor',
  standalone: true,
  imports: [FieldLabelDirective, CommonModule, DashboardLogoComponent, DashboardBrandingIconDirective],
  templateUrl: './dashboard-branding-editor.component.html',
  styleUrls: ['./dashboard-branding-editor.component.scss'],
})
export class DashboardBrandingEditorComponent implements OnInit, AfterViewInit, OnDestroy {
  @Input() branding: DashboardBranding = {};
  @Output() applied = new EventEmitter<DashboardBranding>();
  @Output() dismissed = new EventEmitter<void>();
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  readonly sides: { key: LogoSide; label: string }[] = [{ key: 'leftLogo', label: 'Left logo' }, { key: 'rightLogo', label: 'Right logo' }];
  readonly selections: Record<LogoSide, LogoSelection> = { leftLogo: this.empty(), rightLogo: this.empty() };
  saving = false;
  error = '';
  private request?: Subscription;
  private destroyed = false;
  private previousFocus?: HTMLElement;

  constructor(private readonly logos: DashboardLogoService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    const branding = normalizeDashboardBranding(this.branding);
    this.selections.leftLogo.asset = branding.leftLogo ?? null;
    this.selections.rightLogo.asset = branding.rightLogo ?? null;
  }

  ngAfterViewInit(): void {
    this.previousFocus = document.activeElement as HTMLElement;
    this.dialog.nativeElement.showModal();
  }

  get busy(): boolean { return this.saving || this.sides.some(side => this.selections[side.key].checking); }

  choose(side: LogoSide, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.selectFile(side, file);
  }

  drop(side: LogoSide, event: DragEvent): void {
    event.preventDefault();
    if (this.saving) return;
    if (event.dataTransfer?.files.length !== 1) {
      this.selections[side].error = 'Choose one image for this logo.';
      return;
    }
    void this.selectFile(side, event.dataTransfer.files[0]);
  }

  async selectFile(side: LogoSide, file: File): Promise<void> {
    if (this.saving) return;
    const selection = this.selections[side];
    const version = ++selection.version;
    selection.error = '';
    selection.checking = false;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size === 0) {
      selection.error = 'Choose a PNG, JPEG or WebP image.';
      return;
    }
    if (file.size > 2 * 1024 * 1024) { selection.error = 'Logo must not exceed 2 MB.'; return; }
    // Only surface the "Checking image..." status if decoding is slow, so fast
    // local uploads don't flash the status and jump the layout.
    const checkingTimer = setTimeout(() => {
      if (!this.destroyed && version === selection.version) { selection.checking = true; this.cdr.markForCheck(); }
    }, 250);
    const previewUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = previewUrl;
      await image.decode();
      if (image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error('Logo must not exceed 16 megapixels.');
      if (this.destroyed || version !== selection.version) { URL.revokeObjectURL(previewUrl); return; }
      if (selection.previewUrl) URL.revokeObjectURL(selection.previewUrl);
      selection.previewUrl = previewUrl;
      selection.file = file;
      selection.asset = null;
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      if (!this.destroyed && version === selection.version) selection.error = error instanceof Error && error.message.includes('megapixels') ? error.message : 'This image could not be opened.';
    } finally {
      clearTimeout(checkingTimer);
      if (!this.destroyed && version === selection.version) { selection.checking = false; this.cdr.markForCheck(); }
    }
  }

  remove(side: LogoSide): void {
    if (this.saving) return;
    const previous = this.selections[side];
    previous.version++;
    if (previous.previewUrl) URL.revokeObjectURL(previous.previewUrl);
    this.selections[side] = this.empty();
  }

  reset(): void { this.remove('leftLogo'); this.remove('rightLogo'); this.error = ''; }

  apply(): void {
    if (this.busy) return;
    this.saving = true;
    this.error = '';
    const upload = (side: LogoSide) => {
      const selection = this.selections[side];
      return selection.file ? this.logos.upload(selection.file).pipe(tap(asset => {
        selection.asset = asset;
        selection.file = undefined;
      })) : of(selection.asset);
    };
    this.request = forkJoin({ leftLogo: upload('leftLogo'), rightLogo: upload('rightLogo') }).subscribe({
      next: branding => { this.saving = false; this.applied.emit(branding); },
      error: error => {
        this.saving = false;
        this.error = error?.error?.message || 'Logo upload failed. Please try again.';
        this.cdr.markForCheck();
      },
    });
  }

  onDialogClick(event: MouseEvent): void {
    if (event.target !== this.dialog.nativeElement) return;
    const bounds = this.dialog.nativeElement.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right
        || event.clientY < bounds.top || event.clientY > bounds.bottom) this.cancel();
  }

  cancel(event?: Event): void {
    event?.preventDefault();
    if (!this.saving) this.dismissed.emit();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.request?.unsubscribe();
    for (const side of this.sides) {
      const url = this.selections[side.key].previewUrl;
      if (url) URL.revokeObjectURL(url);
    }
    this.dialog.nativeElement.close();
    this.previousFocus?.focus();
  }

  private empty(): LogoSelection { return { asset: null, previewUrl: '', error: '', checking: false, version: 0 }; }
}