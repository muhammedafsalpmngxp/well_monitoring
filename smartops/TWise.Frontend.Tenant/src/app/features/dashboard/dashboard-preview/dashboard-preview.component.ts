import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, Input, OnDestroy, ViewChild } from '@angular/core';
import { CircleX, createElement, ScanEye } from 'lucide';
import html2canvas from 'html2canvas';
import { createDashboardExportHeader } from '../../../core/utils/dashboard-export-header.util';
import { SharedModule } from '../../../shared/shared.module';

@Component({
  selector: 'app-dashboard-preview',
  standalone: true,
  imports: [CommonModule, SharedModule],
  template: `<button #trigger type="button" class="preview-button" aria-label="Preview dashboard" data-tooltip="Preview" [disabled]="disabled || loading" (click)="open()"></button>
    <dialog #dialog aria-labelledby="dashboard-preview-title" (cancel)="close()">
      <header><div class="preview-heading"><span #headingIcon class="preview-heading-icon" aria-hidden="true"></span><h2 id="dashboard-preview-title">Preview</h2><span #infoIcon class="preview-info" data-tooltip="Preview of the dashboard&#10;export layout" aria-hidden="true"></span></div><button #closeButton type="button" aria-label="Close preview" title="Close" (click)="close()"></button></header>
      <div class="preview-body" [attr.aria-busy]="loading">
        <app-loader *ngIf="loading" role="status" size="lg" message="Preparing preview..."></app-loader>
        <p *ngIf="error" role="alert">{{ error }}</p>
        <img *ngIf="imageUrl" [src]="imageUrl" [alt]="title + ' dashboard preview'" />
      </div>
    </dialog>`,
  styles: [`:host { display: inline-flex; }
    button { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 1px solid #21409a; border-radius: 8px; background: #fff; color: #21409a; cursor: pointer; }
    button:disabled { opacity: .5; cursor: wait; } button:focus-visible { outline: 2px solid #1674d1; outline-offset: 3px; }
    .preview-button { position: relative; overflow: visible; }
    .preview-button[data-tooltip]::after { content: attr(data-tooltip); position: absolute; top: calc(100% + 10px); left: 50%; transform: translateX(-50%); border-radius: 8px; background: #172B4D; box-shadow: 0 4px 8px #00000033, 0 0 2px #0000001a; color: #fff; font-size: 13px; font-weight: 400; line-height: 1.5; padding: 7px 12px; white-space: nowrap; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity .15s ease, visibility .15s ease; z-index: 200; }
    .preview-button[data-tooltip]::before { content: ''; position: absolute; top: calc(100% + 4px); left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-bottom: 8px solid #172B4D; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity .15s ease, visibility .15s ease; z-index: 201; }
    .preview-button[data-tooltip]:hover::after, .preview-button[data-tooltip]:hover::before { opacity: 1; visibility: visible; }
    dialog { position: fixed; inset: auto; top: 61px; left: var(--sidebar-collapsed-width); right: calc(24px / var(--app-zoom-factor, 1)); bottom: calc(41px / var(--app-zoom-factor, 1)); margin: 0; padding: 0; border: 0; border-radius: 16px; width: auto; height: auto; max-width: none; max-height: none; box-sizing: border-box; overflow: hidden; background: linear-gradient(90deg, #0A2468 0%, #21409A 45%, #5E4A73 78%, #F58220 100%); box-shadow: 0 20px 60px rgba(0, 0, 0, 0.18); }
    dialog::backdrop { background: rgba(0, 0, 0, 0.45); } header { display: flex; align-items: center; justify-content: space-between; height: 56px; padding: 0 16px; background: transparent; box-sizing: border-box; color: #fff; }
    .preview-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .preview-heading-icon { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 10px; background: #0F6CBD; }
    .preview-info { position: relative; display: inline-flex; align-items: center; cursor: default; } h2 { margin: 0; font-size: 20px; font-weight: 700; color: #fff; letter-spacing: 0; }
    .preview-info[data-tooltip]::after { content: attr(data-tooltip); position: absolute; top: calc(100% + 10px); left: 50%; transform: translateX(-50%); border-radius: 8px; background: #172B4D; box-shadow: 0 4px 8px #00000033, 0 0 2px #0000001a; color: #fff; font-size: 13px; font-weight: 400; line-height: 1.5; padding: 7px 12px; white-space: pre-line; width: 200px; max-width: 200px; text-align: center; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity .15s ease, visibility .15s ease; z-index: 1100; }
    .preview-info[data-tooltip]::before { content: ''; position: absolute; top: calc(100% + 4px); left: 50%; transform: translateX(-50%); width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-bottom: 8px solid #172B4D; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity .15s ease, visibility .15s ease; z-index: 1101; }
    .preview-info[data-tooltip]:hover::after, .preview-info[data-tooltip]:hover::before { opacity: 1; visibility: visible; }
    header button { border: 0; color: #fff; background: transparent; cursor: pointer; } header button:focus-visible { outline-color: #fff; }
    .preview-body { height: calc(100% - 56px); overflow: auto; box-sizing: border-box; text-align: center; background: #fff; border-radius: 16px; scrollbar-width: thin; scrollbar-color: #21409A transparent; }
    .preview-body::-webkit-scrollbar { width: 4px; height: 4px; }
    .preview-body::-webkit-scrollbar-track { background: transparent; }
    .preview-body::-webkit-scrollbar-thumb { background: #21409A; border-radius: 30px; }
    img { display: block; width: 100%; height: auto; background: #f8fafc; }
    p { color: #344054; font-size: 14px; padding: 20px; }`],
})
export class DashboardPreviewComponent implements OnDestroy {
  @Input() title = 'Dashboard';
  @Input() disabled = false;
  @Input() prepare?: () => Promise<void>;
  @Input() capture?: (keepFullTitle?: boolean, signal?: AbortSignal, includeScrollableContent?: boolean) => Promise<HTMLCanvasElement>;
  @ViewChild('dialog', { static: true }) dialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('trigger', { static: true }) trigger!: ElementRef<HTMLButtonElement>;
  @ViewChild('closeButton', { static: true }) closeButton!: ElementRef<HTMLButtonElement>;
  @ViewChild('headingIcon', { static: true }) headingIcon!: ElementRef<HTMLElement>;
  @ViewChild('infoIcon', { static: true }) infoIcon!: ElementRef<HTMLElement>;
  loading = false;
  error = '';
  imageUrl = '';
  private generation = 0;
  private captureController?: AbortController;

  constructor(private readonly host: ElementRef<HTMLElement>, private readonly cdr: ChangeDetectorRef) {}

  ngAfterViewInit(): void {
    this.trigger.nativeElement.replaceChildren(createElement(ScanEye, { width: '20', height: '20', 'aria-hidden': 'true' }));
    this.closeButton.nativeElement.replaceChildren(createElement(CircleX, { width: '18', height: '18', 'aria-hidden': 'true' }));
    this.headingIcon.nativeElement.replaceChildren(createElement(ScanEye, { width: '18', height: '18' }));
    this.infoIcon.nativeElement.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 0.5C13.6944 0.5 17.5 4.30558 17.5 9C17.5 13.6944 13.6944 17.5 9 17.5C4.30558 17.5 0.5 13.6944 0.5 9C0.5 4.30558 4.30558 0.5 9 0.5Z" fill="#EAF1FF" stroke="#CFE0FF"/><path d="M10.9461 12.6598C10.8933 12.645 10.8329 12.6576 10.7923 12.6926C9.66367 13.6944 9.33467 13.8176 9.24547 13.824C9.23427 13.8248 9.20947 13.8144 9.17667 13.7818C9.13547 13.7416 9.11327 13.6888 9.10827 13.6204C9.07387 13.1438 9.39767 11.6722 10.0707 9.24642C10.6359 7.21782 10.6885 6.80642 10.6789 6.67382C10.6647 6.47582 10.5663 6.32202 10.3869 6.21642C10.2161 6.11622 9.98187 6.07622 9.69147 6.09722C9.20187 6.13262 8.61907 6.33842 7.95927 6.70922C7.77067 6.81542 7.57407 6.94242 7.37527 7.08642C6.85087 7.46642 6.56327 8.04442 6.60567 8.63222C6.60907 8.68042 6.64687 8.72142 6.70127 8.73662C6.75587 8.75162 6.81687 8.73762 6.85587 8.70122C7.37627 8.21742 7.72287 7.92082 7.88647 7.81942C8.06107 7.71142 8.21667 7.65202 8.34947 7.64242C8.39847 7.63882 8.42307 7.63702 8.42887 7.71842C8.43667 7.82662 8.41947 7.95602 8.37787 8.10222C7.39247 11.5004 6.94387 13.5708 7.00587 14.4316C7.02707 14.7242 7.14027 14.9516 7.34267 15.108C7.54747 15.2666 7.81527 15.3354 8.13787 15.312C8.48927 15.2866 8.91107 15.1316 9.42707 14.8382C9.67527 14.697 9.99687 14.4688 10.3831 14.16C10.8385 13.7956 11.0781 13.2868 11.0405 12.764C11.0369 12.7162 11.0001 12.6754 10.9461 12.6598Z" fill="#21409A"/><path d="M10.1678 5.15199C10.8494 5.15199 11.402 4.59942 11.402 3.91779C11.402 3.23616 10.8494 2.68359 10.1678 2.68359C9.48616 2.68359 8.93359 3.23616 8.93359 3.91779C8.93359 4.59942 9.48616 5.15199 10.1678 5.15199Z" fill="#21409A"/></svg>';
  }

  async open(): Promise<void> {
    if (this.disabled || this.loading) return;
    const generation = ++this.generation;
    const controller = new AbortController();
    this.captureController = controller;
    this.error = '';
    this.imageUrl = '';
    this.loading = true;
    this.dialog.nativeElement.showModal();
    try {
      await this.prepare?.();
      if (generation !== this.generation) return;
      const canvas = await (this.capture ? this.capture(false, controller.signal, true) : this.captureEditor());
      if (generation === this.generation) this.imageUrl = canvas.toDataURL('image/png');
    } catch {
      if (generation === this.generation) this.error = 'Preview could not be generated. Wait for the charts to load and try again.';
    } finally {
      if (generation === this.generation) {
        this.captureController = undefined;
        this.loading = false;
        this.cdr.markForCheck();
      }
    }
  }

  close(): void {
    this.generation++;
    this.captureController?.abort();
    this.captureController = undefined;
    this.loading = false;
    this.imageUrl = '';
    this.dialog.nativeElement.close();
    this.trigger.nativeElement.focus();
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.generation++;
    this.captureController?.abort();
    this.dialog.nativeElement.close();
  }

  private async captureEditor(): Promise<HTMLCanvasElement> {
    const root = this.host.nativeElement.closest('app-dashboard-builder, app-board-builder') as HTMLElement | null;
    const grid = root?.querySelector<HTMLElement>('gridster');
    if (!root || !grid) throw new Error('Dashboard grid unavailable');
    const header = await createDashboardExportHeader(this.title, root);
    const bounds = grid.getBoundingClientRect();
    const items = Array.from(grid.querySelectorAll<HTMLElement>('gridster-item')).filter(item => item.querySelector('.board-chart-slot--filled, .board-kpi-slot--filled'));
    const bottom = Math.max(1, ...items.map(item => item.getBoundingClientRect().bottom - bounds.top));
    const width = Math.ceil(grid.clientWidth);
    if (width <= 0) throw new Error('Dashboard grid is not visible');
    const height = Math.ceil(bottom);
    const body = await html2canvas(grid, {
      backgroundColor: '#f8fafc', scale: 2, useCORS: true, width, height,
      onclone: (_document, clonedGrid) => {
        clonedGrid.style.height = `${height}px`;
        clonedGrid.style.overflow = 'visible';
        clonedGrid.style.background = '#f8fafc';
        clonedGrid.querySelectorAll<HTMLElement>('button:not(.board-chart-slot__type-btn), .board-local-filters, .board-trend-mode, .board-chart-slot__menu, .board-chart-slot__type-menu, .board-chart-slot__drag-handle, .gridster-item-resizable-handler').forEach(control => control.style.display = 'none');
        clonedGrid.querySelectorAll<HTMLElement>('.board-chart-slot--filled, .board-kpi-slot--filled').forEach(card => {
          card.style.border = '1px solid #e4e7ec';
          card.style.borderRadius = '8px';
          card.style.background = '#fff';
          card.style.boxShadow = '0 1px 3px #1018280a';
        });
        clonedGrid.querySelectorAll<HTMLElement>('gridster-item').forEach(item => {
          if (!item.querySelector('.board-chart-slot--filled, .board-kpi-slot--filled')) item.style.visibility = 'hidden';
        });
        let ancestor = clonedGrid.parentElement;
        while (ancestor) { ancestor.style.overflow = 'visible'; ancestor = ancestor.parentElement; }
      },
    });
    const canvas = document.createElement('canvas');
    const margin = 48;
    canvas.width = header.width + margin * 2;
    canvas.height = margin * 2 + header.height + 24 + body.height * header.width / body.width;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f8fafc';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(header, margin, margin);
    context.drawImage(body, margin, margin + header.height + 24, header.width, body.height * header.width / body.width);
    return canvas;
  }
}