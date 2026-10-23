import type { Column, GridApi, IRowNode } from 'ag-grid-community';

/** Cell borders plus a little slack for sub-pixel text rounding. */
const CELL_EXTRA_PX = 6;
const FALLBACK_HORIZONTAL_PADDING_PX = 32;

export interface GrowReportColumnsOptions {
  /** The grid element (or an ancestor); a rendered cell inside it supplies the font and padding. */
  container?: Element | null;
  /** Cells whose text should not drive the column width (e.g. rotated vertical text). */
  skipCell?: (node: IRowNode, column: Column) => boolean;
}

let measureContext: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    try {
      measureContext = document.createElement('canvas').getContext('2d');
    } catch {
      measureContext = null;
    }
  }
  return measureContext;
}

/**
 * Widens report data columns so the longest value in any filtered row fits on one line.
 * AG Grid's autoSizeAllColumns only measures the rows currently rendered (one page), so values
 * on other pages — or rows loaded later, e.g. after a global filter change — would otherwise be
 * cut off. Grow-only: wider widths from header auto-sizing or manual resizing are kept.
 */
export function growReportColumnsToFitValues(
  api: GridApi | null | undefined,
  options: GrowReportColumnsOptions = {},
): void {
  if (!api || api.isDestroyed()) return;
  const ctx = getMeasureContext();
  if (!ctx) return;

  const sampleCell = options.container?.querySelector<HTMLElement>('.ag-cell:not(.ag-cell-inline-editing)');
  const style = sampleCell ? getComputedStyle(sampleCell) : null;
  const fontFamily = style?.fontFamily || 'sans-serif';
  const fontSize = parseFloat(style?.fontSize ?? '') || 14;
  const bodyFont = `${style?.fontStyle ?? 'normal'} ${style?.fontWeight ?? '400'} ${fontSize}px ${fontFamily}`;
  // Subtotal/grand-total/pinned total rows render bold at body size + 2px.
  const totalFont = `700 ${fontSize + 2}px ${fontFamily}`;
  const padding = style
    ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
    : FALLBACK_HORIZONTAL_PADDING_PX;

  const columns = api.getAllDisplayedColumns()
    .filter(column => !!column.getColDef().field && !column.getColId().startsWith('ag-Grid-AutoColumn'));
  if (!columns.length) return;

  const widthCache = new Map<string, number>();
  const textWidth = (text: string, font: string): number => {
    const key = `${font}|${text}`;
    let width = widthCache.get(key);
    if (width === undefined) {
      ctx.font = font;
      width = ctx.measureText(text).width;
      widthCache.set(key, width);
    }
    return width;
  };

  const needed = new Map<Column, number>();
  const measureNode = (node: IRowNode, font: string): void => {
    for (const column of columns) {
      // A merged (column-spanning) cell's text spreads over several columns, so it must not
      // stretch its anchor column alone.
      if (column.getColSpan(node) > 1 || options.skipCell?.(node, column)) continue;
      const value = api.getCellValue({ rowNode: node, colKey: column, useFormatter: true });
      if (value == null || value === '') continue;
      const width = textWidth(String(value), font);
      if (width > (needed.get(column) ?? 0)) needed.set(column, width);
    }
  };

  api.forEachNodeAfterFilterAndSort(node => measureNode(node, node.footer ? totalFont : bodyFont));
  for (let i = 0; i < api.getPinnedBottomRowCount(); i++) {
    const node = api.getPinnedBottomRow(i);
    if (node) measureNode(node, totalFont);
  }

  const widths: { key: Column; newWidth: number }[] = [];
  for (const [column, text] of needed) {
    const required = Math.ceil(text + padding + CELL_EXTRA_PX);
    const maxWidth = column.getColDef().maxWidth;
    const newWidth = maxWidth ? Math.min(required, maxWidth) : required;
    if (newWidth > column.getActualWidth()) widths.push({ key: column, newWidth });
  }
  if (widths.length) api.setColumnWidths(widths);
}
