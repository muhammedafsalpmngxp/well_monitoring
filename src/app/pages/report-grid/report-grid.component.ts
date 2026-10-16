import { Component, AfterViewInit, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ReportSpec, getSpec, getRowsFor } from '../../features/report-engine/report-spec';
import {
  buildReportGridOptions, applyReportStyleVars, excelPrependContent, csvPrependContent
} from '../../features/report-engine/report-grid-mapper';

/**
 * Generic spec-driven report renderer (AG Grid Enterprise). Opened via
 * /report-grid?id=<specId>. Reads the ReportSpec and renders it — multi-level
 * row grouping, subtotals/grand total, nested column groups, native filters &
 * sorting all come from the spec, no per-report code.
 */
@Component({
  selector: 'app-report-grid',
  templateUrl: './report-grid.component.html',
  styleUrls: ['./report-grid.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ReportGridComponent implements OnInit, AfterViewInit, OnDestroy {

  spec: ReportSpec | null = null;
  private grid: any = null;
  private sub?: Subscription;

  constructor(private route: ActivatedRoute, private router: Router) {}

  ngOnInit(): void {
    this.sub = this.route.queryParams.subscribe(p => {
      this.spec = getSpec(p['id'] || '') || null;
      setTimeout(() => this.render(), 40);
    });
  }

  ngAfterViewInit(): void { setTimeout(() => this.render(), 40); }
  ngOnDestroy(): void { this.destroy(); this.sub?.unsubscribe(); }

  back(): void { this.router.navigateByUrl('/standardreports'); }
  get hasHeader(): boolean { const h = this.spec?.header; return !!(h && (h.logo || h.logoRight || h.title || h.subtitle)); }
  /** User-authored (non built-in) specs can be edited in the builder. */
  get canEdit(): boolean { return !!this.spec && !this.spec.builtIn; }
  editReport(): void { if (this.spec) this.router.navigateByUrl('/report-grid-builder?id=' + this.spec.id); }
  exportCsv(): void {
    if (!this.grid || !this.spec) return;
    this.grid.exportDataAsCsv({ fileName: this.spec.id + '.csv', prependContent: csvPrependContent(this.spec) });
  }
  exportExcel(): void {
    if (!this.grid || !this.spec || !this.grid.exportDataAsExcel) return;
    this.grid.exportDataAsExcel({ fileName: this.spec.id + '.xlsx', prependContent: excelPrependContent(this.spec) });
  }

  private destroy(): void { if (this.grid) { try { this.grid.destroy(); } catch { /* noop */ } this.grid = null; } }

  private render(): void {
    this.destroy();
    const el = document.getElementById('rgGrid');
    const agGrid = (window as any).agGrid;
    if (!el || !agGrid || !this.spec) return;
    const dk = !document.documentElement.classList.contains('navbar-light');
    el.className = (dk ? 'ag-theme-alpine-dark' : 'ag-theme-alpine') + ' rg-grid';
    el.style.height = '100%';
    applyReportStyleVars(el, this.spec);
    const opts = buildReportGridOptions(this.spec, getRowsFor(this.spec));
    this.grid = agGrid.createGrid(el, opts);
  }
}
