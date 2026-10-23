import { Injectable } from '@angular/core';
import { ExcelStyle } from 'ag-grid-community';
import { reportCellSettingKey } from './report-grid-columns.util';

/**
 * Where a body cell's manual colors come from. Viewer sources these from the saved report
 * config; the builder sources them from its live component state — both share this shape.
 */
export interface ExportCellColorSource {
  cellColors?: Record<string, string> | null;
  pageRowColors?: Record<number, string> | null;
  rowColors?: Record<number, string> | null;
  rowColorsByKey?: Record<string, string> | null;
  cellTextColors?: Record<string, string> | null;
  rowTextColors?: Record<number, string> | null;
  rowTextColorsByKey?: Record<string, string> | null;
  getColumnColor?: (field: string) => string | null | undefined;
  getColumnTextColor?: (field: string) => string | null | undefined;
}

/**
 * Single source of truth for the cell/row/column colors that flow into report exports
 * (Excel + HTML/PDF). Keeps the cell > row > column precedence and absolute grid-position keying
 * in one place so the viewer and builder resolve identical colors. Stable-key row backgrounds
 * take precedence over legacy index-keyed row backgrounds. Also builds the AG Grid
 * `excelStyles` registry the builder's native Excel export needs.
 *
 * Note: CSV is a plain-text format and cannot carry colors — only the value is exported.
 */
@Injectable({ providedIn: 'root' })
export class ReportExportColorService {
  private static readonly SAFE_COLOR = /^#[0-9a-fA-F]{3,8}$/;
  private static readonly EXPORT_HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  /** Null marks a collapsed/filtered leaf with no displayed position or positional paint. */
  private rowKey(rowIndex: number | null, _pageSize: number): number | null {
    return rowIndex;
  }

  /** Resolve a body cell's export background: cell > row > column, safe hex only. */
  resolveCellBackground(rowIndex: number | null, field: string, pageSize: number, src: ExportCellColorSource, rowColorKey?: string): string | null {
    const key = this.rowKey(rowIndex, pageSize);
    const raw = (rowColorKey ? src.cellColors?.[reportCellSettingKey(rowColorKey, field)] : undefined)
      || (key != null ? src.cellColors?.[`${key}:${field}`] : undefined)
      || (rowColorKey ? src.rowColorsByKey?.[rowColorKey] : undefined)
      || (key != null ? src.pageRowColors?.[key] || src.rowColors?.[key] : undefined)
      || src.getColumnColor?.(field) || null;
    return raw && ReportExportColorService.SAFE_COLOR.test(raw) ? raw : null;
  }

  /** Resolve a body cell's export text color: cell > row > column, safe hex only. */
  resolveCellTextColor(rowIndex: number | null, field: string, pageSize: number, src: ExportCellColorSource, rowColorKey?: string): string | null {
    const key = this.rowKey(rowIndex, pageSize);
    const raw = (rowColorKey ? src.cellTextColors?.[reportCellSettingKey(rowColorKey, field)] : undefined)
      || (key != null ? src.cellTextColors?.[`${key}:${field}`] : undefined)
      || (rowColorKey ? src.rowTextColorsByKey?.[rowColorKey] : undefined)
      || (key != null ? src.rowTextColors?.[key] : undefined)
      || src.getColumnTextColor?.(field) || null;
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
