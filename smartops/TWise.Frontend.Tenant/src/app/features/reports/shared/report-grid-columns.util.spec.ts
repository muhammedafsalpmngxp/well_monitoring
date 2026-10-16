import { describe, expect, it } from 'vitest';
import { buildReportGridColumns, computeTotalsRow, isBooleanColumn, isDateColumn, isNumericColumn } from './report-grid-columns.util';
import { ReportJsonConfig } from './report-config.model';

/**
 * Fixture-based tests locking down report-grid-columns.util behavior — both the
 * report builder (live preview) and the report viewer (final render) call these
 * exact functions, so a regression here would affect both surfaces identically.
 */

describe('report-grid-columns.util', () => {
  const rows = [
    { name: 'Well A', qty: '10', when: '2024-01-01', active: 'true' },
    { name: 'Well B', qty: '20', when: '2024-01-02', active: 'false' },
    { name: 'Well C', qty: '30', when: '2024-01-03', active: 'true' },
  ];

  describe('type inference', () => {
    it('detects a numeric column', () => {
      expect(isNumericColumn(rows, 'qty')).toBe(true);
      expect(isNumericColumn(rows, 'name')).toBe(false);
    });

    it('detects a date column', () => {
      expect(isDateColumn(rows, 'when')).toBe(true);
      expect(isDateColumn(rows, 'name')).toBe(false);
    });

    it('detects a boolean column', () => {
      expect(isBooleanColumn(rows, 'active')).toBe(true);
      expect(isBooleanColumn(rows, 'qty')).toBe(false);
    });
  });

  describe('buildReportGridColumns', () => {
    it('builds one ColDef per visible field with the configured header and pin state', () => {
      const config: ReportJsonConfig = {
        columns: [
          { field: 'name', header: 'Well Name', pinned: 'left' },
          { field: 'qty', header: 'Quantity' },
        ],
      };
      const defs = buildReportGridColumns(() => config, ['name', 'qty'], rows);

      // First column is always the synthetic row-number column.
      expect(defs[0]).toMatchObject({ headerName: '#' });
      const nameCol = defs.find((d: any) => d.field === 'name') as any;
      const qtyCol = defs.find((d: any) => d.field === 'qty') as any;
      expect(nameCol.headerName).toBe('Well Name');
      expect(nameCol.pinned).toBe('left');
      expect(qtyCol.headerName).toBe('Quantity');
      expect(qtyCol.type).toBe('numericColumn');
    });

    it('nests columns under group/subGroup headers', () => {
      const config: ReportJsonConfig = {
        columns: [
          { field: 'name', header: 'Name', group: 'Details' },
          { field: 'qty', header: 'Qty', group: 'Details', subGroup: 'Numbers' },
        ],
      };
      const defs = buildReportGridColumns(() => config, ['name', 'qty'], rows) as any[];
      const group = defs.find(d => d.headerName === 'Details');
      expect(group).toBeTruthy();
      expect(group.children.some((c: any) => c.field === 'name')).toBe(true);
      const subGroup = group.children.find((c: any) => c.headerName === 'Numbers');
      expect(subGroup.children[0].field).toBe('qty');
    });

    it('anchors a subgroup at its first member position within the group, not appended after direct columns', () => {
      // Within a group, a subgroup must stay where its column sits (here between "a" and "c"),
      // instead of being pushed after every un-subgrouped column — otherwise a newly added
      // subgroup jumps to the end and the user has to drag it back to preserve order.
      const config: ReportJsonConfig = {
        columns: [
          { field: 'a', header: 'A', group: 'G' },
          { field: 'b', header: 'B', group: 'G', subGroup: 'Sub' },
          { field: 'c', header: 'C', group: 'G' },
        ],
      };
      const defs = buildReportGridColumns(() => config, ['a', 'b', 'c'], rows) as any[];
      const group = defs.find(d => d.headerName === 'G');
      // Order within the group: A, [Sub(B)], C — the subgroup keeps B's original slot.
      const childOrder = group.children.map((c: any) => c.headerName ?? c.field);
      expect(childOrder).toEqual(['A', 'Sub', 'C']);
      const sub = group.children.find((c: any) => c.headerName === 'Sub');
      expect(sub.children.map((c: any) => c.field)).toEqual(['b']);
    });

    it('renders a Sub group without a Group at the sub-group tier, wrapped in a blank main-group tier', () => {
      // A Sub group is the nested second tier. Without a Group it must sit at the sub-group row
      // under an EMPTY main-group header (blank space), lining up with sub groups that nest inside
      // real groups — not as a header at the main-group tier itself.
      const config: ReportJsonConfig = {
        columns: [
          { field: 'a', header: 'A', group: 'G', subGroup: 'Sub' },
          { field: 'b', header: 'B', subGroup: 'Lonely' },
        ],
      };
      const defs = buildReportGridColumns(() => config, ['a', 'b'], rows) as any[];
      // The standalone sub group is wrapped in a blank (headerName: '') main-group tier.
      const wrap = defs.find((d: any) => d.children && d.headerName === '' &&
        d.children.some((c: any) => c.headerName === 'Lonely'));
      expect(wrap).toBeTruthy();
      const lonely = wrap.children.find((c: any) => c.headerName === 'Lonely');
      expect(lonely.children.map((c: any) => c.field)).toEqual(['b']);
      // 'Lonely' is never a top-level (main-tier) header.
      expect(defs.some((d: any) => d.headerName === 'Lonely')).toBe(false);
    });

    it('treats a whitespace-only group/subGroup title as "no group" (backspaced-to-blank leftover)', () => {
      // When a user backspaces a group title in the multiline textarea they can leave a stray
      // space or newline. That must not render a ghost empty group-header bar, and must not
      // split columns that share a title but differ only by trailing whitespace.
      const config: ReportJsonConfig = {
        columns: [
          { field: 'name', header: 'Name', group: ' ' },
          { field: 'qty', header: 'Qty', subGroup: '\n' },
        ],
      };
      const defs = buildReportGridColumns(() => config, ['name', 'qty'], rows) as any[];
      // No group/subGroup wrappers — both columns are flat leaf columns.
      expect(defs.every(d => !d.children)).toBe(true);
      expect(defs.some(d => d.field === 'name')).toBe(true);
      expect(defs.some(d => d.field === 'qty')).toBe(true);
    });

    it('merges columns whose group titles differ only by surrounding whitespace into one group', () => {
      const config: ReportJsonConfig = {
        columns: [
          { field: 'name', header: 'Name', group: 'Details' },
          { field: 'qty', header: 'Qty', group: 'Details ' },
        ],
      };
      const defs = buildReportGridColumns(() => config, ['name', 'qty'], rows) as any[];
      const groups = defs.filter(d => d.children);
      expect(groups.length).toBe(1);
      expect(groups[0].headerName).toBe('Details');
      expect(groups[0].children.map((c: any) => c.field)).toEqual(['name', 'qty']);
    });

    it('gives every group/subGroup a stable content-derived groupId', () => {
      // Without an explicit groupId, AG Grid auto-assigns sequential ids ("0", "1"...) by build
      // order. When the group *shape* changes on a live grid (e.g. a column moves from one
      // subGroup to a brand-new one), those auto ids drift and corrupt AG Grid's own internal
      // display-instance cache, crashing its `ColumnGroupService.prune()` on the next rebuild.
      // A stable, name-derived groupId keeps that cache correctly keyed across rebuilds.
      const config: ReportJsonConfig = {
        columns: [
          { field: 'name', header: 'Name', group: 'Details', subGroup: 'Numbers' },
          { field: 'qty', header: 'Qty', group: 'Details', subGroup: 'Numbers' },
        ],
      };
      const defs = buildReportGridColumns(() => config, ['name', 'qty'], rows) as any[];
      const group = defs.find(d => d.headerName === 'Details');
      expect(group.groupId).toBe('grp:Details');
      const subGroup = group.children.find((c: any) => c.headerName === 'Numbers');
      expect(subGroup.groupId).toBe('grp:Details>Numbers');
    });

    it('anchors a group at the position of its first member instead of moving it to the end', () => {
      const config: ReportJsonConfig = {
        columns: [
          { field: 'name', header: 'Name' },
          { field: 'qty', header: 'Qty', group: 'Details' },
          { field: 'when', header: 'When', group: 'Details' },
          { field: 'active', header: 'Active' },
        ],
      };
      const defs = buildReportGridColumns(() => config, ['name', 'qty', 'when', 'active'], rows) as any[];
      // [#, name, Details(qty, when), active] — the group sits where "qty" originally was,
      // not appended after every ungrouped column.
      const headerNames = defs.map(d => d.headerName ?? d.field);
      // The config above gives 'name' and 'active' explicit headers, and buildReportGridColumns
      // honours `header` over the raw field name, so the labels are 'Name' and 'Active'.
      expect(headerNames).toEqual(['#', 'Name', 'Details', 'Active']);
      const group = defs.find(d => d.headerName === 'Details');
      expect(group.children.map((c: any) => c.field)).toEqual(['qty', 'when']);
    });

    it('applies cell color over row color over column color, in that precedence order', () => {
      const config: ReportJsonConfig = {
        columns: [{ field: 'name', header: 'Name', color: 'columncolor' }],
        rowColors: { 0: 'rowcolor' },
        cellColors: { '0:name': 'cellcolor' },
      };
      const defs = buildReportGridColumns(() => config, ['name'], rows) as any[];
      const nameCol = defs.find(d => d.field === 'name');
      const style = nameCol.cellStyle({ node: { rowIndex: 0 } });
      expect(style.backgroundColor).toBe('cellcolor');

      const rowOnlyStyle = nameCol.cellStyle({ node: { rowIndex: 1 } });
      expect(rowOnlyStyle.backgroundColor).toBe('columncolor');
    });

    it('cellStyle reads the config getter live, so color edits repaint without rebuilding columnDefs', () => {
      const config: ReportJsonConfig = { columns: [{ field: 'name', header: 'Name' }], cellColors: {} };
      const defs = buildReportGridColumns(() => config, ['name'], rows) as any[];
      const nameCol = defs.find(d => d.field === 'name');
      expect(nameCol.cellStyle({ node: { rowIndex: 0 } })).toBeNull();

      config.cellColors!['0:name'] = 'newcolor';
      // Same colDef object, same cellStyle function — no rebuild — yet it now reflects the edit.
      expect(nameCol.cellStyle({ node: { rowIndex: 0 } }).backgroundColor).toBe('newcolor');
    });

    it('with no merges, a column gets colSpan (default 1) but no spanRows — column and row merging are mutually exclusive per AG Grid', () => {
      const config: ReportJsonConfig = { columns: [{ field: 'name', header: 'Name' }] };
      const defs = buildReportGridColumns(() => config, ['name'], rows) as any[];
      const nameCol = defs.find(d => d.field === 'name');
      expect(nameCol.colSpan({ node: { rowIndex: 0 } })).toBe(1);
      expect(nameCol.spanRows).toBeUndefined();
    });

    it('a column merge (colSpan > 1, rowSpan === 1) wires colSpan at the anchor row only, no spanRows', () => {
      const config: ReportJsonConfig = {
        columns: [{ field: 'name', header: 'Name' }],
        mergedCellRanges: [{ rowIndex: 1, field: 'name', rowSpan: 1, colSpan: 2 }],
      };
      const defs = buildReportGridColumns(() => config, ['name'], rows) as any[];
      const nameCol = defs.find(d => d.field === 'name');
      expect(nameCol.colSpan({ node: { rowIndex: 0 } })).toBe(1);
      expect(nameCol.colSpan({ node: { rowIndex: 1 } })).toBe(2);
      expect(nameCol.spanRows).toBeUndefined();
    });

    it('a row merge (rowSpan > 1, colSpan === 1) wires spanRows instead of colSpan, true only within the merged row range', () => {
      const config: ReportJsonConfig = {
        columns: [{ field: 'name', header: 'Name' }],
        mergedCellRanges: [
          { rowIndex: 0, field: 'name', rowSpan: 2, colSpan: 1 },
          { rowIndex: 3, field: 'name', rowSpan: 2, colSpan: 1 },
        ],
      };
      const defs = buildReportGridColumns(() => config, ['name'], rows) as any[];
      const nameCol = defs.find(d => d.field === 'name');
      expect(nameCol.colSpan).toBeUndefined();
      expect(nameCol.spanRows({ nodeA: { rowIndex: 0 }, nodeB: { rowIndex: 1 } })).toBe(true);
      expect(nameCol.spanRows({ nodeA: { rowIndex: 1 }, nodeB: { rowIndex: 2 } })).toBe(false);
      expect(nameCol.spanRows({ nodeA: { rowIndex: 3 }, nodeB: { rowIndex: 4 } })).toBe(true);
    });

    it('merged cells (either axis) get centered content in cellStyle, matching Excel merge & center', () => {
      const config: ReportJsonConfig = {
        columns: [{ field: 'name', header: 'Name' }],
        mergedCellRanges: [{ rowIndex: 0, field: 'name', rowSpan: 2, colSpan: 1 }],
      };
      const defs = buildReportGridColumns(() => config, ['name'], rows) as any[];
      const nameCol = defs.find(d => d.field === 'name');
      expect(nameCol.cellStyle({ node: { rowIndex: 0 } })).toMatchObject({ display: 'flex', alignItems: 'center', justifyContent: 'center' });
      // Row 2 is outside this field's merged range entirely, so no centering.
      expect(nameCol.cellStyle({ node: { rowIndex: 2 } })).toBeNull();
    });
  });

  describe('computeTotalsRow', () => {
    it('sums a column marked with total "sum" and leaves untotaled columns blank', () => {
      const config: ReportJsonConfig = {
        columns: [{ field: 'qty', header: 'Qty', total: 'sum' }, { field: 'name', header: 'Name' }],
      };
      const { totals, hasAnyTotal } = computeTotalsRow(config, rows, ['qty', 'name']);
      expect(hasAnyTotal).toBe(true);
      expect(totals['qty']).toBe(60);
      expect(totals['name']).toBe('');
    });

    it('reports no totals when nothing is configured', () => {
      const { hasAnyTotal } = computeTotalsRow(null, rows, ['qty', 'name']);
      expect(hasAnyTotal).toBe(false);
    });
  });
});
