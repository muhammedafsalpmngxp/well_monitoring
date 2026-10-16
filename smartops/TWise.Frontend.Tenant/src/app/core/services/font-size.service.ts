import { Injectable } from '@angular/core';
import { StorageService } from './storage.service';

export type FontSizeId = 'small' | 'medium' | 'large';

export interface FontSizePreset {
  id: FontSizeId;
  label: string;
  zoom: number;
  previewPx: number;
}

const STORAGE_KEY = 'app-font-zoom';

/**
 * App-wide text scale, applied via `zoom` on `<app-root>`. Most of this app's
 * CSS is written in fixed px (not rem), so scaling the root font-size would
 * have no cascading effect — `zoom` is the only lever that reliably scales
 * everything regardless of unit.
 *
 * `zoom` scales how an element's *descendants* render, but viewport units
 * (vh/vw) inside those descendants don't scale with it — they always measure
 * the real, physical viewport regardless of any ancestor's zoom. A few core
 * layout pieces size themselves that way (`.main-content`, `.sidebar`, both
 * `height: 100vh`), so at zoom != 100% they'd render taller or shorter than
 * the real viewport (e.g. pushing the footer below the fold at Large) — and
 * critically, wheel-driven scrolling does not reliably reach content that
 * only overflows this way (confirmed empirically: scrollHeight correctly
 * reports the overflow and `el.scrollTop = x` works, but no amount of actual
 * mouse-wheel scrolling moves it, with or without anything blocking the
 * scroll chain). So this can't be fixed by making it scrollable — it has to
 * not overflow in the first place. `--app-zoom-factor` is published here so
 * `calc(100vh / var(--app-zoom-factor, 1))` in those rules pre-compensates:
 * at 90% zoom that's ~111vh pre-scale, which *zoom* then renders back down to
 * exactly 100vh on screen, and symmetrically at 110%.
 */
@Injectable({ providedIn: 'root' })
export class FontSizeService {
  readonly minZoom = 85;
  readonly maxZoom = 115;
  readonly defaultZoom = 100;

  readonly presets: FontSizePreset[] = [
    { id: 'small', label: 'Small', zoom: 90, previewPx: 13 },
    { id: 'medium', label: 'Medium', zoom: 100, previewPx: 16 },
    { id: 'large', label: 'Large', zoom: 110, previewPx: 19 },
  ];

  zoom = this.defaultZoom;

  constructor(private readonly storage: StorageService) {
    const saved = Number(this.storage.getItem(STORAGE_KEY));
    this.zoom = saved >= this.minZoom && saved <= this.maxZoom ? saved : this.defaultZoom;
    this.apply();
  }

  setZoom(zoom: number): void {
    this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, zoom));
    this.apply();
    this.storage.setItem(STORAGE_KEY, String(this.zoom));
  }

  reset(): void {
    this.setZoom(this.defaultZoom);
  }

  private apply(): void {
    const root = document.querySelector('app-root') as (HTMLElement & { style: CSSStyleDeclaration & { zoom: string } }) | null;
    if (!root) return;
    root.style.zoom = `${this.zoom}%`;
    document.documentElement.style.setProperty('--app-zoom-factor', String(this.zoom / 100));
  }
}
