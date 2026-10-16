import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ColNode, ReportSpec, ReportHeader, ReportStyle, AggFn, ColType,
  getDatasets, getDataset, getRowsFor, saveSpec, getSpec
} from '../../features/report-engine/report-spec';
import { buildReportGridOptions, applyReportStyleVars } from '../../features/report-engine/report-grid-mapper';

interface ColCfg {
  field: string; header: string; type: ColType;
  include: boolean; group: string; subgroup: string; agg: '' | AggFn;
}

/**
 * Grouped-report builder — authors a ReportSpec (source dataset, ordered row
 * groups, a column tree with optional column-group / subgroup, aggregations and
 * totals) and previews it live with the same generic AG Grid renderer. Saving
 * stores the spec so it appears in the Reports gallery.
 */
@Component({
  selector: 'app-report-grid-builder',
  templateUrl: './report-grid-builder.component.html',
  styleUrls: ['./report-grid-builder.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ReportGridBuilderComponent implements AfterViewInit, OnDestroy {

  datasets = getDatasets();
  name = '';
  category = 'My Reports';
  /** Empty until the user picks one — a new report starts blank. */
  datasetId = '';
  cols: ColCfg[] = [];
  rowGroups: string[] = [];
  totalsPerGroup = true;
  totalsGrand = true;
  editId: string | null = null;

  header: ReportHeader = { title: '', subtitle: '', banner: '', logo: '', logoWidth: 120 };
  /** No colours by default — the user chooses them (header stays the neutral theme). */
  style: ReportStyle = { headerBg: '', headerText: '', bannerBg: '', groupColors: {}, columnGroupColors: {}, fontFamily: '', fontSize: 13, fontColor: '' };

  /** Font family choices for the report. */
  fontFamilies = ['IBM Plex Sans', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Roboto', 'Verdana', 'Courier New'];

  /** Cached colour-picker lists (recomputed on preview, not on every CD cycle,
   *  so binding them in *ngFor doesn't rebuild the inputs on each keystroke). */
  topGroups: string[] = [];
  colGroups: Array<{ key: string; label: string; level: number }> = [];
  trackByKey = (_: number, g: { key: string }) => g.key;
  trackByVal = (_: number, v: string) => v;

  /** Distinct values of the first row-group field → per-group row-colour pickers. */
  get topGroupValues(): string[] {
    const f = this.rowGroups[0];
    if (!f) return [];
    const ds = getDataset(this.datasetId);
    return Array.from(new Set((ds?.rows || []).map(r => String(r[f])).filter(v => v && v !== 'undefined')));
  }
  groupColor(v: string): string { return (this.style.groupColors || {})[v] || '#ffffff'; }
  setGroupColor(v: string, c: string): void { (this.style.groupColors = this.style.groupColors || {})[v] = c; this.preview(); }

  /** Distinct column groups + sub-groups (for per-node colour pickers). */
  get columnGroups(): Array<{ key: string; label: string; level: number }> {
    const seen = new Map<string, { key: string; label: string; level: number }>();
    for (const c of this.cols) {
      if (!c.include || this.rowGroups.includes(c.field)) continue;
      const segs = [...this.splitPath(c.group), ...this.splitPath(c.subgroup)];
      let cum = '';
      segs.forEach((seg, i) => {
        cum = cum ? cum + ' > ' + seg : seg;
        const key = 'g:' + cum;
        if (!seen.has(key)) seen.set(key, { key, label: seg, level: i });
      });
    }
    return [...seen.values()];
  }
  colGroupColor(key: string): string { return (this.style.columnGroupColors || {})[key] || '#ffffff'; }
  setColGroupColor(key: string, c: string): void { (this.style.columnGroupColors = this.style.columnGroupColors || {})[key] = c; this.preview(); }

  onLogoFile(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { this.header.logo = String(rd.result || ''); this.preview(); };
    rd.readAsDataURL(f);
  }
  removeLogo(): void { this.header.logo = ''; this.preview(); }
  /** Right-side logo (uploaded independently of the left logo). */
  onLogoFileRight(ev: Event): void {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { this.header.logoRight = String(rd.result || ''); this.preview(); };
    rd.readAsDataURL(f);
  }
  removeLogoRight(): void { this.header.logoRight = ''; this.preview(); }
  get hasChrome(): boolean { return !!(this.header.logo || this.header.logoRight || this.header.title || this.header.subtitle); }

  private grid: any = null;

  constructor(private router: Router, route: ActivatedRoute) {
    const id = route.snapshot.queryParamMap.get('id');
    const spec = id ? getSpec(id) : null;
    if (spec && !spec.builtIn) { this.loadFromSpec(spec); }
    else { this.onDataset(); }
  }

  /** Populate the form from an existing spec (edit mode). */
  private loadFromSpec(spec: ReportSpec): void {
    this.editId = spec.id;
    this.name = spec.name;
    this.category = spec.category;
    this.datasetId = spec.datasetId;
    this.totalsPerGroup = spec.totals.perGroup;
    this.totalsGrand = spec.totals.grand;
    this.rowGroups = [...spec.rowGroups];
    this.header = { title: '', subtitle: '', banner: '', logo: '', logoWidth: 120, ...(spec.header || {}) };
    this.style = { headerBg: '', headerText: '', bannerBg: '', groupColors: {}, columnGroupColors: {}, fontFamily: '', fontSize: 13, fontColor: '', ...(spec.style || {}) };
    const ds = getDataset(spec.datasetId);
    this.cols = (ds?.fields || []).map(f => ({
      field: f.field, header: f.header, type: f.type, include: false, group: '', subgroup: '', agg: '' as '' | AggFn
    }));
    // Flatten the column tree back into per-field group/subgroup + agg.
    const flat: Array<{ field: string; header: string; path: string[]; agg?: AggFn }> = [];
    const walk = (nodes: ColNode[], anc: string[]) => nodes.forEach(n => {
      if (n.children && n.children.length) walk(n.children, [...anc, n.header]);
      else if (n.field) flat.push({ field: n.field, header: n.header, path: anc, agg: n.agg });
    });
    walk(spec.columns, []);
    for (const item of flat) {
      const c = this.cols.find(x => x.field === item.field);
      if (!c) continue;
      c.include = true;
      c.header = item.header || c.header;
      c.agg = item.agg || '';
      c.group = item.path[0] || '';
      c.subgroup = item.path.slice(1).join(' > ');
    }
  }

  ngAfterViewInit(): void { setTimeout(() => this.preview(), 60); }
  ngOnDestroy(): void { this.destroy(); }

  back(): void { this.router.navigateByUrl('/myreports'); }

  /** Rebuild the column config when the dataset changes. */
  onDataset(): void {
    const ds = getDataset(this.datasetId);
    // No source selected → clear everything (blank builder).
    if (!ds) { this.cols = []; this.rowGroups = []; return; }
    // Selecting a source shows its data: all columns included, as a flat table
    // (no default row grouping) — the user adds grouping/colours themselves.
    this.cols = ds.fields.map(f => ({
      field: f.field, header: f.header, type: f.type,
      include: true, group: '', subgroup: '',
      agg: (f.type !== 'text' ? 'sum' : '') as '' | AggFn
    }));
    this.rowGroups = [];
    // Defer so the *ngIf'd preview grid element exists before we render into it.
    setTimeout(() => this.preview(), 30);
  }

  get groupableFields() { return (getDataset(this.datasetId)?.fields || []).filter(f => f.type === 'text'); }
  isRowGroup(f: string): boolean { return this.rowGroups.includes(f); }
  toggleRowGroup(f: string): void {
    const i = this.rowGroups.indexOf(f);
    if (i >= 0) this.rowGroups.splice(i, 1); else this.rowGroups.push(f);
    this.preview();
  }

  private slug(s: string): string { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  /** Split a Group/Subgroup value into path segments (">" → deeper header levels). */
  private splitPath(s: string): string[] {
    return (s || '').split('>').map(x => x.trim()).filter(Boolean);
  }

  /**
   * Build the column tree from the column config. Group + Subgroup are treated
   * as an ordered header path, and each may itself contain ">" to add further
   * levels — so headers can nest to any depth (e.g. "Progress % > Week-1" over
   * Plan/Actual). A column with no group is a top-level leaf.
   */
  private buildColumns(): ColNode[] {
    const out: ColNode[] = [];
    const nodeByPath = new Map<string, ColNode>();
    for (const c of this.cols) {
      if (!c.include || this.rowGroups.includes(c.field)) continue;
      const leaf: ColNode = { key: c.field, header: c.header, field: c.field, type: c.type, agg: c.agg || undefined };
      const segs = [...this.splitPath(c.group), ...this.splitPath(c.subgroup)];
      if (!segs.length) { out.push(leaf); continue; }
      let siblings = out;
      let cumKey = '';
      for (const seg of segs) {
        cumKey = cumKey ? cumKey + ' > ' + seg : seg;
        let node = nodeByPath.get(cumKey);
        if (!node) {
          node = { key: 'g:' + cumKey, header: seg, children: [] };
          nodeByPath.set(cumKey, node);
          siblings.push(node);
        }
        siblings = node.children!;
      }
      siblings.push(leaf);
    }
    return out;
  }

  private toSpec(id: string): ReportSpec {
    return {
      id, name: this.name.trim() || 'Untitled report', category: this.category.trim() || 'My Reports',
      datasetId: this.datasetId, rowGroups: [...this.rowGroups],
      columns: this.buildColumns(), totals: { perGroup: this.totalsPerGroup, grand: this.totalsGrand },
      header: { ...this.header }, style: { ...this.style, groupColors: { ...(this.style.groupColors || {}) } }
    };
  }

  private destroy(): void { if (this.grid) { try { this.grid.destroy(); } catch { /* noop */ } this.grid = null; } }

  preview(): void {
    // Recompute the colour-picker lists once here (not per change-detection cycle).
    this.topGroups = this.topGroupValues;
    this.colGroups = this.columnGroups;
    this.destroy();
    const el = document.getElementById('rgbPreview');
    const agGrid = (window as any).agGrid;
    if (!el || !agGrid) return;
    const dk = !document.documentElement.classList.contains('navbar-light');
    el.className = (dk ? 'ag-theme-alpine-dark' : 'ag-theme-alpine') + ' rgb-grid';
    el.style.height = '100%';
    const spec = this.toSpec('preview');
    applyReportStyleVars(el, spec);
    this.grid = agGrid.createGrid(el, buildReportGridOptions(spec, getRowsFor(spec)));
  }

  save(): void {
    if (!this.name.trim()) { alert('Please name the report.'); return; }
    if (this.editId) {
      // Editing an existing report — update in place and return to the report.
      saveSpec(this.toSpec(this.editId));
      this.router.navigateByUrl('/report-grid?id=' + this.editId);
    } else {
      // New report — save and land in My / WIP Reports.
      const id = this.slug(this.name) + '-' + Date.now().toString(36);
      saveSpec(this.toSpec(id));
      this.router.navigateByUrl('/myreports');
    }
  }
}
