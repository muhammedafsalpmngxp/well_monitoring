import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';
import {
  DbViewSpec, getAllViews, deleteView, tablesUsed, orderedColumns, runPreview
} from '../../features/db-views/db-views';

/**
 * Database Views list (Settings → Database Views).
 * Shows every saved view in an AG Grid. "Create view" opens the builder;
 * opening a row drills into the view's detail page (data + tables + SQL).
 */
@Component({
  selector: 'app-db-views',
  templateUrl: './db-views.component.html',
  styleUrls: ['./db-views.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class DbViewsComponent implements AfterViewInit, OnDestroy {

  private grid: any = null;

  constructor(private router: Router) {}

  ngAfterViewInit(): void { setTimeout(() => this.render(), 40); }
  ngOnDestroy(): void { this.destroy(); }

  createView(): void { this.router.navigateByUrl('/db-view-builder'); }
  openView(id: string): void { this.router.navigateByUrl('/db-view-detail?id=' + id); }

  private destroy(): void { if (this.grid) { try { this.grid.destroy(); } catch { /* noop */ } this.grid = null; } }

  /** Build a display row per saved view (name, tables, column count, source). */
  private rows(): any[] {
    return getAllViews().map(v => ({
      id: v.id,
      name: v.name,
      description: v.description || '',
      tables: tablesUsed(v).join(', '),
      columns: orderedColumns(v).length,
      rows: runPreview(v).rows.length,
      source: v.builtIn ? 'Built-in' : 'Custom'
    }));
  }

  private render(): void {
    this.destroy();
    const el = document.getElementById('dbvGrid');
    const agGrid = (window as any).agGrid;
    if (!el || !agGrid) return;
    const dk = !document.documentElement.classList.contains('navbar-light');
    el.className = (dk ? 'ag-theme-alpine-dark' : 'ag-theme-alpine') + ' dbv-grid';
    el.style.height = '100%';

    const openView = (id: string) => this.openView(id);
    const removeView = (id: string, name: string) => {
      if (confirm('Delete view “' + name + '”? This cannot be undone.')) { deleteView(id); this.render(); }
    };

    const opts = {
      columnDefs: [
        {
          headerName: 'View name', field: 'name', flex: 1.4, minWidth: 200,
          cellClass: 'dbv-name-cell',
          cellRenderer: (p: any) =>
            `<span class="dbv-name">${p.value}</span>` +
            (p.data.description ? `<span class="dbv-desc">${p.data.description}</span>` : '')
        },
        { headerName: 'Tables used', field: 'tables', flex: 1.6, minWidth: 220 },
        { headerName: 'Columns', field: 'columns', width: 110, type: 'numericColumn' },
        { headerName: 'Rows', field: 'rows', width: 100, type: 'numericColumn' },
        {
          headerName: 'Source', field: 'source', width: 120,
          cellRenderer: (p: any) => `<span class="dbv-tag dbv-tag--${p.value === 'Built-in' ? 'builtin' : 'custom'}">${p.value}</span>`
        },
        {
          headerName: 'Actions', width: 170, sortable: false, filter: false,
          cellRenderer: (p: any) =>
            `<button class="dbv-rowbtn" data-act="open">Open</button>` +
            (p.data.source === 'Custom' ? `<button class="dbv-rowbtn dbv-rowbtn--danger" data-act="del">Delete</button>` : ''),
          onCellClicked: (p: any) => {
            const act = (p.event.target as HTMLElement)?.getAttribute('data-act');
            if (act === 'open') openView(p.data.id);
            else if (act === 'del') removeView(p.data.id, p.data.name);
          }
        }
      ],
      rowData: this.rows(),
      defaultColDef: { sortable: true, filter: true, resizable: true, minWidth: 90 },
      rowHeight: 46,
      animateRows: true,
      onRowClicked: (p: any) => {
        // Ignore clicks that land on the Actions buttons (handled per-cell).
        if ((p.event.target as HTMLElement)?.closest('.dbv-rowbtn')) return;
        openView(p.data.id);
      }
    };
    this.grid = agGrid.createGrid(el, opts);
  }
}
