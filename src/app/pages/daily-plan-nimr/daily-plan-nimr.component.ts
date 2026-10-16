import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';

interface Leaf {
  contractor: 'ATNM' | 'Sub Contractors';
  disc: 'Flowline' | 'Location' | 'Others';
  wellId: string; paName: string; paMob: string; phEmp: string; phName: string; phMob: string;
  poNo: string; wbs: string; category: string; location: string; job: string; activities: string;
  atnmPermit: string; pdoPermit: string;
  manpower: number; eqpt: number; vehicle: number | null; remarks: string;
}

/** Sample Daily Plan rows (NIMR scope). Flat — the grid derives the groups. */
const LEAVES: Leaf[] = [
  { contractor:'ATNM', disc:'Flowline', wellId:'30750', paName:'Karthik',  paMob:'79211154', phEmp:'970688', phName:'LAVLESH KUMAR SINGH', phMob:'71379925', poNo:'', wbs:'WD-3522-30750-FLC-1-M', category:'Nimr Conversion with Flowline', location:'AL BURJ', job:'ALBRG_1405250004_WI2', activities:'Stringing', atnmPermit:'PTW-26-4471', pdoPermit:'', manpower:5, eqpt:6, vehicle:2, remarks:'' },
  { contractor:'ATNM', disc:'Flowline', wellId:'31022', paName:'Rajesh',   paMob:'79210088', phEmp:'970712', phName:'SURESH MENON', phMob:'71380110', poNo:'', wbs:'WD-3610-31022-FLC-2-M', category:'Nimr Conversion with Flowline', location:'NIMR', job:'NIMR_1405250012_WI3', activities:'Trenching', atnmPermit:'PTW-26-4472', pdoPermit:'', manpower:4, eqpt:3, vehicle:1, remarks:'' },
  { contractor:'ATNM', disc:'Location', wellId:'30991', paName:'Anil',      paMob:'79215532', phEmp:'970655', phName:'MOHAMMED AL BALUSHI', phMob:'71377654', poNo:'', wbs:'WD-3522-30991-LOC-1-M', category:'Location Preparation', location:'RIMA', job:'RIMA_1405250021_LC', activities:'Grading', atnmPermit:'PTW-26-4502', pdoPermit:'', manpower:8, eqpt:4, vehicle:2, remarks:'Awaiting survey' },
  { contractor:'ATNM', disc:'Location', wellId:'31044', paName:'Anil',      paMob:'79215532', phEmp:'970659', phName:'RAKESH PILLAI', phMob:'71377661', poNo:'', wbs:'WD-3522-31044-LOC-2-M', category:'Location Preparation', location:'NIMR', job:'NIMR_1405250033_LC', activities:'Compaction', atnmPermit:'PTW-26-4510', pdoPermit:'', manpower:6, eqpt:3, vehicle:1, remarks:'' },
  { contractor:'ATNM', disc:'Others',   wellId:'30870', paName:'Vinod',     paMob:'79216690', phEmp:'970701', phName:'GEORGE THOMAS', phMob:'71378890', poNo:'', wbs:'WD-3522-30870-OTH-1-M', category:'Site Restoration', location:'NIMR', job:'NIMR_1405250040_OT', activities:'Housekeeping', atnmPermit:'PTW-26-4520', pdoPermit:'', manpower:3, eqpt:1, vehicle:1, remarks:'' },
  { contractor:'Sub Contractors', disc:'Flowline', wellId:'30480', paName:'Desert Line Svcs', paMob:'79218840', phEmp:'880231', phName:'K. SANTOSH', phMob:'71355012', poNo:'PO-88213', wbs:'WD-3401-30480-FLC-1-S', category:'Flowline Tie-in', location:'NIMR', job:'NIMR_1405250008_SC', activities:'Welding', atnmPermit:'', pdoPermit:'PDO-PTW-88213', manpower:6, eqpt:2, vehicle:2, remarks:'' },
  { contractor:'Sub Contractors', disc:'Flowline', wellId:'30512', paName:'Desert Line Svcs', paMob:'79218840', phEmp:'880240', phName:'A. RAHMAN', phMob:'71355088', poNo:'PO-88220', wbs:'WD-3401-30512-FLC-2-S', category:'Flowline Tie-in', location:'NIMR', job:'NIMR_1405250015_SC', activities:'Hydro-testing', atnmPermit:'', pdoPermit:'PDO-PTW-88220', manpower:5, eqpt:2, vehicle:1, remarks:'' },
  { contractor:'Sub Contractors', disc:'Others', wellId:'30640', paName:'Gulf Civil Works', paMob:'79219912', phEmp:'884410', phName:'M. IQBAL', phMob:'71356210', poNo:'PO-88301', wbs:'WD-3401-30640-OTH-1-S', category:'Civil Works', location:'MARMUL', job:'MRML_1405250027_SC', activities:'Culvert', atnmPermit:'', pdoPermit:'PDO-PTW-88301', manpower:7, eqpt:3, vehicle:2, remarks:'' }
];

const esc = (s: any) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c]);

/**
 * Daily Plan-Nimr — page-backed Standard Report reproducing the AG Grid daily
 * plan: rows grouped by ATNM / Sub Contractors → Discipline with per-contractor
 * totals and a grand total, search, discipline filter, expand/collapse and CSV
 * export. Community AG Grid → grouping is built from a computed row model.
 */
@Component({
  selector: 'app-daily-plan-nimr',
  templateUrl: './daily-plan-nimr.component.html',
  styleUrls: ['./daily-plan-nimr.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class DailyPlanNimrComponent implements AfterViewInit, OnDestroy {

  private grid: any = null;
  private collapsed = new Set<string>();
  search = '';
  discFilter = '';
  locFilter = '';
  catFilter = '';
  private sortField = '';
  private sortDir: '' | 'asc' | 'desc' = '';
  /** Per-column search text (field/colId → query), driven by the floating filter row. */
  private colSearch: Record<string, string> = {};
  colSearchGet(field: string): string { return this.colSearch[field] || ''; }
  setColSearch(field: string, val: string): void {
    if (val) this.colSearch[field] = val; else delete this.colSearch[field];
    this.refresh();
  }

  get locationOptions(): string[] { return Array.from(new Set(LEAVES.map(l => l.location))).sort(); }
  get categoryOptions(): string[] { return Array.from(new Set(LEAVES.map(l => l.category))).sort(); }

  // Metric strip
  mPh = 0; mWells = 0; mMp = 0; mEq = 0; mVh = 0;

  constructor(private router: Router) {}

  ngAfterViewInit(): void { setTimeout(() => this.renderGrid(), 0); }
  ngOnDestroy(): void { if (this.grid) { try { this.grid.destroy(); } catch { /* noop */ } this.grid = null; } }

  back(): void { this.router.navigateByUrl('/standardreports'); }

  // ── Row model ──────────────────────────────────────────────────────────
  private filteredLeaves(): Leaf[] {
    const q = this.search.trim().toLowerCase();
    return LEAVES.filter(l => {
      if (this.discFilter && l.disc !== this.discFilter) return false;
      if (this.locFilter && l.location !== this.locFilter) return false;
      if (this.catFilter && l.category !== this.catFilter) return false;
      // Per-column search (floating filter row).
      for (const f in this.colSearch) {
        const cq = this.colSearch[f].trim().toLowerCase();
        if (cq && !String((l as any)[f] ?? '').toLowerCase().includes(cq)) return false;
      }
      if (!q) return true;
      return [l.wellId, l.phName, l.wbs, l.category, l.paName, l.location, l.job].join(' ').toLowerCase().includes(q);
    });
  }

  /** Sort leaf rows within a group by the active column sort (keeps groups intact). */
  private sortLeaves(rows: Leaf[]): Leaf[] {
    if (!this.sortField || !this.sortDir) return rows;
    const f = this.sortField as keyof Leaf;
    const numeric = ['manpower', 'eqpt', 'vehicle'].includes(this.sortField);
    const dir = this.sortDir === 'desc' ? -1 : 1;
    return rows.slice().sort((a, b) => {
      const av = a[f], bv = b[f];
      if (numeric) return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
      return String(av == null ? '' : av).localeCompare(String(bv == null ? '' : bv)) * dir;
    });
  }

  private sum(rows: Leaf[]): { phCount: number; manpower: number; eqpt: number; vehicle: number } {
    return rows.reduce((a, r) => ({
      phCount: a.phCount + 1,
      manpower: a.manpower + (r.manpower || 0),
      eqpt: a.eqpt + (r.eqpt || 0),
      vehicle: a.vehicle + (r.vehicle || 0)
    }), { phCount: 0, manpower: 0, eqpt: 0, vehicle: 0 });
  }

  private buildRows(): any[] {
    const leaves = this.filteredLeaves();
    const out: any[] = [];
    (['ATNM', 'Sub Contractors'] as const).forEach(ct => {
      const ctLeaves = leaves.filter(l => l.contractor === ct);
      if (!ctLeaves.length) return;
      const ctKey = 'c:' + ct;
      const ctSum = this.sum(ctLeaves);
      const ctOpen = !this.collapsed.has(ctKey);
      out.push({ _type: 'group', _level: 0, _key: ctKey, _label: ct, _expanded: ctOpen, ...ctSum });
      if (ctOpen) {
        const discs = Array.from(new Set(ctLeaves.map(l => l.disc)));
        discs.forEach(d => {
          const dLeaves = ctLeaves.filter(l => l.disc === d);
          const dKey = ctKey + '|d:' + d;
          const dOpen = !this.collapsed.has(dKey);
          out.push({ _type: 'group', _level: 1, _key: dKey, _label: d, _expanded: dOpen, ...this.sum(dLeaves) });
          if (dOpen) this.sortLeaves(dLeaves).forEach(l => out.push({ ...l, _type: 'leaf' }));
        });
      }
      out.push({ _type: 'total', _label: ct.toUpperCase() + ' TOTAL', ...ctSum });
    });
    out.push({ _type: 'grand', _label: 'GRAND TOTAL', ...this.sum(leaves) });
    return out;
  }

  private refresh(): void {
    if (!this.grid) return;
    this.grid.setGridOption('rowData', this.buildRows());
    const leaves = this.filteredLeaves();
    const s = this.sum(leaves);
    this.mPh = s.phCount; this.mMp = s.manpower; this.mEq = s.eqpt; this.mVh = s.vehicle;
    this.mWells = new Set(leaves.map(l => l.wellId)).size;
  }

  // ── Toolbar ────────────────────────────────────────────────────────────
  onSearch(v: string): void { this.search = v; this.refresh(); }
  onDisc(v: string): void { this.discFilter = v; this.refresh(); }
  onLoc(v: string): void { this.locFilter = v; this.refresh(); }
  onCat(v: string): void { this.catFilter = v; this.refresh(); }
  expandAll(): void { this.collapsed.clear(); this.refresh(); }
  collapseAll(): void {
    (['ATNM', 'Sub Contractors'] as const).forEach(ct => {
      const ctKey = 'c:' + ct;
      this.collapsed.add(ctKey);
      Array.from(new Set(LEAVES.filter(l => l.contractor === ct).map(l => l.disc))).forEach(d => this.collapsed.add(ctKey + '|d:' + d));
    });
    this.refresh();
  }
  exportCsv(): void { if (this.grid) this.grid.exportDataAsCsv({ fileName: 'daily-plan-nimr.csv', allColumns: true }); }

  // ── Grid ───────────────────────────────────────────────────────────────
  private renderGrid(): void {
    const el = document.getElementById('dpnGrid');
    const agGrid = (window as any).agGrid;
    if (!el || !agGrid || typeof agGrid.createGrid !== 'function') return;

    const dk = !document.documentElement.classList.contains('navbar-light');
    el.className = (dk ? 'ag-theme-alpine-dark' : 'ag-theme-alpine') + ' dpn-grid';

    const numFmt = (p: any) => (p.value == null || p.value === '') ? '' : p.value;
    const phFmt = (p: any) => (p.data && p.data._type === 'leaf') ? '' : (p.value == null ? '' : p.value);

    const self = this;
    // No-op filter so the floating filter row shows but AG never removes rows
    // (all real filtering happens in buildRows() → grouping stays intact).
    class PassFilter {
      init() { /* noop */ }
      getGui() { return document.createElement('div'); }
      doesFilterPass() { return true; }
      isFilterActive() { return false; }
      getModel() { return null; }
      setModel() { /* noop */ }
    }
    // A search input rendered under each column header.
    class SearchFloatingFilter {
      private gui!: HTMLElement; private inp!: HTMLInputElement; private field = '';
      init(p: any) {
        this.field = p.column.getColId();
        this.gui = document.createElement('div'); this.gui.className = 'dpn-ff';
        this.inp = document.createElement('input');
        this.inp.type = 'text'; this.inp.className = 'dpn-ff-input'; this.inp.placeholder = 'Search…';
        this.inp.value = self.colSearchGet(this.field);
        this.inp.addEventListener('input', () => self.setColSearch(this.field, this.inp.value));
        this.inp.addEventListener('click', e => e.stopPropagation());
        this.gui.appendChild(this.inp);
      }
      onParentModelChanged() { /* noop */ }
      getGui() { return this.gui; }
    }

    const columnDefs: any[] = [
      { colId: 'grp', headerName: 'ATNM / Sub Contractor  ›  Discipline', pinned: 'left', minWidth: 250, width: 280,
        sortable: false, suppressMovable: true, filter: false, floatingFilter: false, cellRenderer: (p: any) => this.grpRenderer(p) },
      { field: 'phCount', headerName: 'PH Count', pinned: 'left', width: 96, sortable: false, filter: false, floatingFilter: false, cellClass: 'num-cell', valueFormatter: phFmt },
      { field: 'wellId', headerName: 'Well ID', pinned: 'left', width: 110, cellClass: 'mono-cell' },
      { field: 'paName', headerName: 'PA Name', width: 140 },
      { field: 'paMob', headerName: 'PA Mob No', width: 134, cellClass: 'mono-cell' },
      { field: 'phEmp', headerName: 'PH Emp ID', width: 122, cellClass: 'mono-cell' },
      { field: 'phName', headerName: 'PH Name', width: 200, cellStyle: { fontWeight: '600' } },
      { field: 'phMob', headerName: 'PH Mob No', width: 134, cellClass: 'mono-cell' },
      { field: 'poNo', headerName: 'PO No', width: 116, cellClass: 'mono-cell' },
      { field: 'wbs', headerName: 'WBS', width: 210, cellClass: 'mono-cell' },
      { field: 'category', headerName: 'Well Category', width: 210,
        cellRenderer: (p: any) => p.value ? '<span class="cat-tag">' + esc(p.value) + '</span>' : '' },
      { field: 'location', headerName: 'Location', width: 100 },
      { field: 'job', headerName: 'Job Title / Project Name', width: 210, cellClass: 'mono-cell' },
      { field: 'activities', headerName: 'Activities', width: 120 },
      { headerName: 'Permit No', headerClass: 'dpn-grp-head', children: [
        { field: 'atnmPermit', headerName: 'ATNM Permit No', width: 140, cellClass: 'permit-cell' },
        { field: 'pdoPermit', headerName: 'PDO Permit No', width: 140, cellClass: 'permit-cell' }
      ]},
      { headerName: 'Resource Details (Nos)', headerClass: 'dpn-grp-head', children: [
        { field: 'manpower', headerName: 'Manpower', width: 110, cellClass: 'num-cell', headerClass: 'num-head', valueFormatter: numFmt },
        { field: 'eqpt', headerName: 'Eqpt', width: 90, cellClass: 'num-cell', headerClass: 'num-head', valueFormatter: numFmt },
        { field: 'vehicle', headerName: 'Vehicle', width: 96, cellClass: 'num-cell', headerClass: 'num-head', valueFormatter: numFmt }
      ]},
      { field: 'remarks', headerName: 'Remarks', width: 150 }
    ];

    const gridOptions: any = {
      columnDefs,
      rowData: this.buildRows(),
      // sortable headers + reorder + resize. comparator is a no-op so AG never
      // reorders the flat rows itself — sorting is applied to leaves in buildRows,
      // keeping the group/total rows in place.
      defaultColDef: {
        resizable: true, sortable: true, suppressMovable: false, comparator: () => 0, minWidth: 80,
        filter: PassFilter, floatingFilter: true, floatingFilterComponent: SearchFloatingFilter,
        floatingFilterComponentParams: { suppressFilterButton: true },
        suppressHeaderMenuButton: true, suppressHeaderFilterButton: true
      },
      animateRows: true,
      getRowId: (p: any) => p.data._key || (p.data._type + ':' + (p.data.wellId || p.data._label)),
      rowClassRules: {
        'dpn-grp-atnm': (p: any) => p.data?._type === 'group' && p.data._level === 0 && p.data._label === 'ATNM',
        'dpn-grp-sc':   (p: any) => p.data?._type === 'group' && p.data._level === 0 && p.data._label === 'Sub Contractors',
        'dpn-sub':      (p: any) => p.data?._type === 'group' && p.data._level === 1,
        'dpn-total':    (p: any) => p.data?._type === 'total',
        'dpn-grand':    (p: any) => p.data?._type === 'grand'
      },
      onCellClicked: (e: any) => {
        if (e.colDef.colId === 'grp' && e.data && e.data._type === 'group') {
          const k = e.data._key;
          if (this.collapsed.has(k)) this.collapsed.delete(k); else this.collapsed.add(k);
          this.refresh();
        }
      },
      // Native sort UI → re-sort leaves within each group and rebuild.
      onSortChanged: () => {
        const st = (this.grid.getColumnState() || []).find((c: any) => c.sort);
        this.sortField = st ? st.colId : '';
        this.sortDir = st ? st.sort : '';
        this.refresh();
      }
    };

    el.style.height = '100%';
    this.grid = agGrid.createGrid(el, gridOptions);
    this.refresh();
  }

  private grpRenderer(p: any): string {
    const r = p.data;
    if (!r || r._type === 'leaf') return '';
    if (r._type === 'total') return '<span class="dpn-total-lbl">' + esc(r._label) + '</span>';
    if (r._type === 'grand') return '<span class="dpn-grand-lbl">' + esc(r._label) + '</span>';
    const caret = r._expanded
      ? '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9l6 6 6-6"/></svg>'
      : '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>';
    return '<span class="dpn-grp-lbl" style="padding-left:' + (r._level * 16) + 'px">'
      + '<span class="dpn-caret">' + caret + '</span>' + esc(r._label) + '</span>';
  }
}
