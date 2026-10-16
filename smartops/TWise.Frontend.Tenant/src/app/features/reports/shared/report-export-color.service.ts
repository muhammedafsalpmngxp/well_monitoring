import { Injectable } from '@angular/core';
import { ExcelStyle } from 'ag-grid-community';

/**
 * Where a body cell's manual colors come from. Viewer sources these from the saved report
 * config; the builder sources them from its live component state — both share this shape.
 */
export interface ExportCellColorSource {
  cellColors?: Record<string, string> | null;
  pageRowColors?: Record<number, string> | null;
  rowColors?: Record<number, string> | null;
  cellTextColors?: Record<string, string> | null;
  rowTextColors?: Record<number, string> | null;
  getColumnColor?: (field: string) => string | null | undefined;
  getColumnTextColor?: (field: string) => string | null | undefined;
}

/**
 * Single source of truth for the cell/row/column colors that flow into report exports
 * (Excel + HTML/PDF). Keeps the cell > row > column precedence and page-relative keying
 * in one place so the viewer and builder resolve identical colors. Also builds the AG Grid
 * `excelStyles` registry the builder's native Excel export needs.
 *
 * Note: CSV is a plain-text format and cannot carry colors — only the value is exported.
 */
@Injectable({ providedIn: 'root' })
export class ReportExportColorService {
  private static readonly SAFE_COLOR = /^#[0-9a-fA-F]{3,8}$/;
  private static readonly EXPORT_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  /** Manual colors are keyed by the row's absolute index (not per page), so export uses it directly. */
  private rowKey(rowIndex: number, _pageSize: number): number {
    return rowIndex;
  }

  /** Resolve a body cell's export background: cell > row > column, safe hex only. */
  resolveCellBackground(rowIndex: number, field: string, pageSize: number, src: ExportCellColorSource): string | null {
    const key = this.rowKey(rowIndex, pageSize);
    const raw = src.cellColors?.[`${key}:${field}`] || src.pageRowColors?.[key] || src.rowColors?.[key] || src.getColumnColor?.(field) || null;
    return raw && ReportExportColorService.SAFE_COLOR.test(raw) ? raw : null;
  }

  /** Resolve a body cell's export text color: cell > row > column, safe hex only. */
  resolveCellTextColor(rowIndex: number, field: string, pageSize: number, src: ExportCellColorSource): string | null {
    const key = this.rowKey(rowIndex, pageSize);
    const raw = src.cellTextColors?.[`${key}:${field}`] || src.rowTextColors?.[key] || src.getColumnTextColor?.(field) || null;
    return raw && ReportExportColorService.SAFE_COLOR.test(raw) ? raw : null;
  }

  // AG Grid native-export style registry (builder's right-click Export) 

  /** True when a value is a plain 3/6-digit hex safe to feed into the excelStyles registry. */
  isExportHex(value: string | null | undefined): value is string {
    return !!value && ReportExportColorService.EXPORT_HEX.test(value);
  }

  /** Normalizes a 3/6-digit hex to an uppercase `#RRGGBB`. */
  normalizeHex(hex: string): string {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
    return `#${full.toUpperCase()}`;
  }

  /** Deterministic class id AG Grid maps to an excelStyle (`xl-bg-<hex>` / `xl-fg-<hex>`). */
  classId(kind: 'bg' | 'fg', hex: string): string {
    return `xl-${kind}-${hex.replace('#', '').toLowerCase()}`;
  }

  /** Builds the excelStyles registry entries for every background/text color in use. */
  buildExcelStyles(bgHexes: Iterable<string>, fgHexes: Iterable<string>): ExcelStyle[] {
    const styles: ExcelStyle[] = [];
    for (const hex of new Set(bgHexes)) styles.push({ id: this.classId('bg', hex), interior: { color: hex, pattern: 'Solid' } });
    for (const hex of new Set(fgHexes)) styles.push({ id: this.classId('fg', hex), font: { color: hex } });
    return styles;
  }
}
