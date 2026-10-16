import { Component, AfterViewInit, OnDestroy, OnInit, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  DbViewSpec, getView, viewSQL, runPreview, columnHeader, tablesUsed, SCHEMA
} from '../../features/db-views/db-views';

/**
 * Database View detail (/db-view-detail?id=…).
 * Renders the view's output data in an AG Grid, lists the source tables used
 * to build it, and shows the generated SQL query.
 */
@Component({
  selector: 'app-db-view-detail',
  templateUrl: './db-view-detail.component.html',
  styleUrls: ['./db-view-detail.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class DbViewDetailComponent implements OnInit, AfterViewInit, OnDestroy {

  spec: DbViewSpec | null = null;
  sql = '';
  tables: Array<{ table: string; alias: string; columns: number }> = [];
  rowCount = 0;
  private grid: any = null;
  private sub?: Subscription;

  constructor(private route: ActivatedRoute, private router: Router) {}

  ngOnInit(): void {
    this.sub = this.route.queryParams.subscribe(p => {
      this.spec = getView(p['id'] || '') || null;
      if (this.spec) {
        this.sql = viewSQL(this.spec);
        // Distinct source tables, in declared order, with their alias + column count.
        this.tables = tablesUsed(this.spec).map(name => {
          const ref = this.spec!.tables.find(t => t.table === name)!;
          return { table: name, alias: ref.alias, columns: SCHEMA[name]?.columns.length || 0 };
        });
      }
      setTimeout(() => this.render(), 40);
    });
  }

  ngAfterViewInit(): void { setTimeout(() => this.render(), 40); }
  ngOnDestroy(): void { this.destroy(); this.sub?.unsubscribe(); }

  back(): void { this.router.navigateByUrl('/db-views'); }
  get canEdit(): boolean { return !!this.spec && !this.spec.builtIn; }
  editView(): void { if (this.spec) this.router.navigateByUrl('/db-view-builder?id=' + this.spec.id); }
  exportCsv(): void { if (this.grid) this.grid.exportDataAsCsv({ fileName: (this.spec?.name || 'view') + '.csv' }); }

  async copySql(): Promise<void> {
    try { await navigator.clipboard.writeText(this.sql); } catch { /* clipboard unavailable */ }
  }

  private destroy(): void { if (this.grid) { try { this.grid.destroy(); } catch { /* noop */ } this.grid = null; } }

  private render(): void {
    this.destroy();
    const el = document.getElementById('dbvdGrid');
    const agGrid = (window as any).agGrid;
    if (!el || !agGrid || !this.spec) return;
    const dk = !document.documentElement.classList.contains('navbar-light');
    el.className = (dk ? 'ag-theme-alpine-dark' : 'ag-theme-alpine') + ' dbvd-grid';
    el.style.height = '100%';

    const { cols, rows } = runPreview(this.spec);
    this.rowCount = rows.length;
    const columnDefs = cols.map((c, i) => ({
      headerName: columnHeader(c),
      field: 'c' + i,
      minWidth: 130,
      flex: 1,
      type: (c.type === 'int' || c.type === 'number') ? 'numericColumn' : undefined
    }));
    const rowData = rows.map(r => {
      const o: any = {};
      r.forEach((v: any, i: number) => o['c' + i] = v);
      return o;
    });
    this.grid = agGrid.createGrid(el, {
      columnDefs,
      rowData,
      defaultColDef: { sortable: true, filter: true, resizable: true, minWidth: 110 },
      rowHeight: 36,
      animateRows: true
    });
  }
}
