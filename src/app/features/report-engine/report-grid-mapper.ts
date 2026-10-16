import { ColNode, ReportSpec, getDataset } from './report-spec';

/**
 * Map a ReportSpec + rows → an AG Grid Enterprise gridOptions object.
 * Uses native multi-level row grouping, aggregation, group/grand totals and
 * nested column groups — driven entirely by the spec (no per-report code).
 */
export function buildReportGridOptions(spec: ReportSpec, rows: any[]): any {
  const ds = getDataset(spec.datasetId);
  console.log('Dataset:', ds);
  const fieldHeader = (f: string) => ds?.fields.find(x => x.field === f)?.header || f;

  const fmt = (type?: string) => {
    if (type === 'percent') return (p: any) => (p.value == null || p.value === '') ? '' : Math.round(p.value) + '%';
    if (type === 'money') return (p: any) => (p.value == null || p.value === '') ? '' : Number(p.value).toLocaleString();
    if (type === 'number') return (p: any) => (p.value == null || p.value === '') ? '' : p.value;
    return undefined;
  };

  // Per column-group colouring: each group / sub-group can carry its own colour
  // which bands the whole column — the group + sub-group header cells and every
  // data cell beneath it. A leaf inherits its nearest coloured ancestor group.
  const st = spec.style || {};
  const cgClass = columnGroupClassMap(st.columnGroupColors);   // group node key → class

  const mapNode = (n: ColNode, colorKey: string | null = null): any => {
    if (n.children && n.children.length) {
      const myKey = cgClass[n.key] ? n.key : colorKey;   // this group if coloured, else inherit
      return {
        headerName: n.header, marryChildren: true,
        // Colour the group bar with its own colour, or cascade the parent group's
        // colour down when this level has none — so colouring a Group tints the
        // whole block (its sub-group bars + columns), and a sub-group can override.
        headerClass: myKey ? cgClass[myKey] : undefined,
        children: n.children.map(c => mapNode(c, myKey))
      };
    }
    const isNum = n.type === 'number' || n.type === 'percent' || n.type === 'money';
    const def: any = {
      field: n.field, headerName: n.header,
      width: n.width, minWidth: n.width || 90,
      aggFunc: n.agg || undefined,
      enableValue: !!n.agg,
      type: isNum ? 'numericColumn' : undefined,
      filter: isNum ? 'agNumberColumnFilter' : 'agSetColumnFilter',
      valueFormatter: fmt(n.type)
    };
    // Band the column with the nearest coloured group's colour (header + cells),
    // on screen (cellStyle) and in Excel (cellClass → excelStyle).
    const bg = colorKey ? (st.columnGroupColors || {})[colorKey] : '';
    if (bg) {
      const tx = contrastText(bg);
      def.headerClass = cgClass[colorKey!];
      def.cellStyle = () => ({ backgroundColor: bg, color: tx });
      def.cellClass = ['rptCell', cgClass[colorKey!]];
    }
    return def;
  };

  // Hidden row-group columns (ordered) → sections then sub-sections.
  const groupCols = spec.rowGroups.map((f, i) => ({
    field: f, headerName: fieldHeader(f), rowGroup: true, rowGroupIndex: i, hide: true,
    filter: 'agSetColumnFilter', enableRowGroup: true
  }));

  const groupHeader = spec.rowGroups.map(fieldHeader).join('  ›  ') || 'Group';

  // Row-wise colour by the top-level row-group value.
  const groupColors = spec.style?.groupColors || {};
  const topField = spec.rowGroups[0];
  const topKeyOf = (node: any): any => {
    if (!node) return null;
    if (node.data && !node.group && !node.footer) return node.data[topField];
    let n = node; while (n && n.level > 0) n = n.parent;
    return n ? n.key : null;
  };
  const hasGroupColors = !!(topField && Object.keys(groupColors).length);
  const getRowStyle = hasGroupColors
    ? (p: any) => { const c = groupColors[topKeyOf(p.node)]; return c ? { background: c } : undefined; }
    : undefined;
  // Same colour, carried into the Excel export via a per-group cell class → excelStyle.
  const groupCellClass = hasGroupColors
    ? (p: any) => { const k = topKeyOf(p.node); return (k != null && groupColors[k]) ? excelGroupStyleId(k) : ''; }
    : undefined;

  // Base cell class for Excel: report font ('rptCell') + row-group colour.
  // (Column-group colours are set per leaf in mapNode and take precedence there.)
  const cellClassFn = (p: any) => {
    const arr = ['rptCell'];
    if (groupCellClass) { const g = groupCellClass(p); if (g) arr.push(g); }
    return arr;
  };

  return {
    columnDefs: [...groupCols, ...spec.columns.map(n => mapNode(n))],
    rowData: rows,
    defaultColDef: {
      sortable: true, filter: true, floatingFilter: true, resizable: true,
      enableRowGroup: true, minWidth: 90,
      cellClass: cellClassFn
    },
    autoGroupColumnDef: {
      headerName: groupHeader,
      minWidth: 280, pinned: 'left',
      cellClass: cellClassFn,
      cellRendererParams: {
        suppressCount: false,
        footerValueGetter: (p: any) => {
          const k = p.node && p.node.key;
          return (k == null) ? 'GRAND TOTAL' : String(k).toUpperCase() + ' TOTAL';
        }
      }
    },
    groupDefaultExpanded: -1,
    suppressAggFuncInHeader: true,
    groupTotalRow: spec.totals.perGroup ? 'bottom' : undefined,
    grandTotalRow: spec.totals.grand ? 'bottom' : undefined,
    rowGroupPanelShow: 'always',
    sideBar: { toolPanels: ['columns', 'filters'] },
    animateRows: true,
    getRowStyle,
    excelStyles: buildExcelStyles(spec)
  };
}

/** Black or white text for readable contrast against a hex background. */
function contrastText(hex: string): string {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return '#1F2A38';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#1F2A38' : '#ffffff';
}

/** Deterministic group-node-key → CSS class map (stable across mapper + CSS). */
function columnGroupClassMap(colors?: Record<string, string>): Record<string, string> {
  const cg = colors || {};
  const map: Record<string, string> = {};
  Object.keys(cg).filter(k => cg[k]).sort().forEach((k, i) => { map[k] = 'rg-cg-' + i; });
  return map;
}

/**
 * Apply header colours + report font (theme CSS vars) to a grid container, and
 * inject the per column-group header colour rules (matching the mapper's class
 * assignment) into a shared <style> tag.
 */
export function applyReportStyleVars(el: HTMLElement, spec: ReportSpec): void {
  const s = spec.style || {};
  if (s.headerBg) el.style.setProperty('--ag-header-background-color', s.headerBg);
  if (s.headerText) el.style.setProperty('--ag-header-foreground-color', s.headerText);
  // Report font.
  el.style.setProperty('--ag-font-size', s.fontSize ? s.fontSize + 'px' : '13px');
  if (s.fontFamily) el.style.setProperty('--ag-font-family', s.fontFamily);
  if (s.fontColor) el.style.setProperty('--ag-foreground-color', s.fontColor);

  // Column group / sub-group header colours → shared stylesheet.
  const cg = s.columnGroupColors || {};
  const map = columnGroupClassMap(cg);
  let css = '';
  Object.keys(map).forEach(k => {
    const cls = map[k], bg = cg[k], tx = contrastText(bg);
    css += `.ag-header-group-cell.${cls},.ag-header-cell.${cls}{background-color:${bg} !important;}`;
    css += `.${cls} .ag-header-group-cell-label,.${cls} .ag-header-cell-label,.${cls} .ag-header-cell-text{color:${tx} !important;}`;
  });
  let styleEl = document.getElementById('rg-cg-style') as HTMLStyleElement | null;
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'rg-cg-style'; document.head.appendChild(styleEl); }
  styleEl.textContent = css;
}

/* ─────────────────────────── Export styling ───────────────────────────
   AG Grid's CSV/Excel export ignores CSS, so report colours (header, row-group
   bands, banner) and the centred title/subtitle/banner must be re-expressed as
   `excelStyles` + prepended content. */

/** Stable, class-safe Excel style id for a row-group value. */
function excelGroupStyleId(v: string): string { return 'grp_' + String(v).replace(/[^A-Za-z0-9]/g, '_'); }

/**
 * Excel style definitions mirroring the on-screen report: header background/text,
 * one style per row-group colour, and the centred title/subtitle/banner rows.
 * The reserved ids `header` / `headerGroup` restyle the exported column headers.
 */
function buildExcelStyles(spec: ReportSpec): any[] {
  const s = spec.style || {};
  const styles: any[] = [];
  // Report font, shared by every style (Excel font key is `fontName`).
  const fontBase: any = {};
  if (s.fontFamily) fontBase.fontName = s.fontFamily;
  if (s.fontSize) fontBase.size = s.fontSize;

  const headerFill = s.headerBg ? { interior: { color: s.headerBg, pattern: 'Solid' } } : {};
  const headerFont = { font: { bold: true, color: s.headerText || undefined, ...fontBase } };
  const centre = { alignment: { horizontal: 'Center', vertical: 'Center' } };
  styles.push({ id: 'header', ...headerFill, ...headerFont, ...centre });
  styles.push({ id: 'headerGroup', ...headerFill, ...headerFont, ...centre });

  // Base data-cell font (applied to every cell via the 'rptCell' class).
  styles.push({ id: 'rptCell', font: { color: s.fontColor || undefined, ...fontBase } });

  // Row-group band colours.
  const groupColors = s.groupColors || {};
  Object.keys(groupColors).forEach(k => {
    styles.push({ id: excelGroupStyleId(k), interior: { color: groupColors[k], pattern: 'Solid' }, font: { ...fontBase } });
  });

  // Column-group / sub-group band colours (header + data cells).
  const cgColors = s.columnGroupColors || {};
  const cgMap = columnGroupClassMap(cgColors);
  Object.keys(cgMap).forEach(k => {
    const bg = cgColors[k];
    // No alignment here: leaf/group headers keep their centred 'header'/'headerGroup'
    // alignment, while banded data cells stay in the default (left) alignment.
    styles.push({ id: cgMap[k], interior: { color: bg, pattern: 'Solid' }, font: { color: contrastText(bg), bold: true, ...fontBase } });
  });

  styles.push({ id: 'rptTitle', font: { bold: true, size: 14, ...(s.fontFamily ? { fontName: s.fontFamily } : {}) }, ...centre });
  styles.push({ id: 'rptSub', font: { size: 11, ...(s.fontFamily ? { fontName: s.fontFamily } : {}) }, ...centre });
  styles.push({
    id: 'rptBanner',
    interior: { color: s.bannerBg || '#2E7D32', pattern: 'Solid' },
    font: { bold: true, color: '#FFFFFF', ...fontBase }, ...centre
  });
  return styles;
}

/** Total displayed columns (leaves + the pinned auto-group column) — for merge span. */
export function reportColumnCount(spec: ReportSpec): number {
  const count = (nodes: ColNode[]): number =>
    nodes.reduce((a, n) => a + (n.children && n.children.length ? count(n.children) : 1), 0);
  return count(spec.columns) + 1;
}

/** Centred, full-width title/subtitle/banner rows to prepend to the Excel export. */
export function excelPrependContent(spec: ReportSpec): any[] {
  const h = spec.header;
  if (!h) return [];
  const span = Math.max(0, reportColumnCount(spec) - 1);
  const rows: any[] = [];
  const push = (value: string | undefined, styleId: string) => {
    if (value) rows.push({ cells: [{ data: { type: 'String', value }, mergeAcross: span, styleId }] });
  };
  push(h.title, 'rptTitle');
  push(h.subtitle, 'rptSub');
  push(h.banner, 'rptBanner');
  return rows;
}

/** Title/subtitle/banner lines to prepend to the CSV export (CSV carries no styling). */
export function csvPrependContent(spec: ReportSpec): string {
  const h = spec.header;
  if (!h) return '';
  // Quote each line so embedded commas don't spill into adjacent CSV columns.
  const lines = [h.title, h.subtitle, h.banner]
    .filter(Boolean)
    .map(v => '"' + String(v).replace(/"/g, '""') + '"');
  return lines.length ? lines.join('\n') + '\n' : '';
}
