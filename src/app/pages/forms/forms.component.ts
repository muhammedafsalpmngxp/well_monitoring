import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';
import {
  SavedCatalogue,
  readAllCatalogues,
  deleteCatalogue
} from '../cataloguenew/cataloguenew.component';

@Component({
  selector: 'app-forms',
  templateUrl: './forms.component.html',
  styleUrls: ['./forms.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class FormsComponent implements AfterViewInit, OnDestroy {

  items: SavedCatalogue[] = [];
  private gridInstance: any = null;

  constructor(private router: Router) {}

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;
    this.refresh();

    // Expose action callbacks for ag-grid cell renderers
    (window as any)['formsView'] = (id: string) => {
      const item = this.items.find(x => x.id === id);
      if (item) this.onViewForm(item);
    };
    (window as any)['formsEdit'] = (id: string) => {
      const item = this.items.find(x => x.id === id);
      if (item) this.onEditForm(item);
    };
    (window as any)['formsDelete'] = (id: string) => {
      const item = this.items.find(x => x.id === id);
      if (item) this.onDeleteForm(item);
    };

    (window as any).__formsThemeRefresh = () => {
      if (this.gridInstance) { try { this.gridInstance.destroy(); } catch (_) {} this.gridInstance = null; }
      setTimeout(() => this.renderGrid(), 0);
    };
  }

  ngOnDestroy(): void {}

  refresh(): void {
    this.items = readAllCatalogues();
    setTimeout(() => this.renderGrid(), 0);
  }

  private renderGrid(): void {
    const gridEl = document.getElementById('formsGrid');
    if (!gridEl || this.items.length === 0) return;

    const dk = !document.documentElement.classList.contains('navbar-light');
    gridEl.className = dk ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

    const self = this;
    const rowData = this.items.map(item => ({
      id: item.id,
      name: item.name,
      date: self.formattedDate(item),
      email: self.emailFor(item),
      phone: self.phoneFor(item)
    }));

    const columnDefs = [
      { headerName: 'Form Name', field: 'name', flex: 1, minWidth: 200, sortable: true, filter: true,
        cellRenderer: (p: any) => '<span style="font-weight:700;color:var(--txt-1)">' + p.value + '</span>' },
      { headerName: 'Date', field: 'date', width: 140, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '9pt', color: dk ? '#c7cfe0' : '#475569' } },
      { headerName: 'Email', field: 'email', width: 180, sortable: true, filter: true,
        cellStyle: { fontSize: '9pt', color: dk ? '#c7cfe0' : '#475569' } },
      { headerName: 'Phone', field: 'phone', width: 160, sortable: true, filter: true,
        cellStyle: { fontSize: '9pt', color: dk ? '#c7cfe0' : '#475569' } },
      { headerName: 'Action', field: 'id', width: 140, sortable: false, filter: false,
        cellRenderer: (p: any) => {
          const id = p.value;
          return '<div style="display:flex;gap:6px;justify-content:flex-end;align-items:center;height:100%">' +
            '<button class="form-act-btn" title="View" onclick="formsView(\'' + id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>' +
            '<button class="form-act-btn" title="Edit" onclick="formsEdit(\'' + id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
            '<button class="form-act-btn danger" title="Delete" onclick="formsDelete(\'' + id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>' +
            '</div>';
        },
        cellStyle: { textAlign: 'right' }
      }
    ];

    if (this.gridInstance) { try { this.gridInstance.destroy(); } catch (ex) {} this.gridInstance = null; }

    const gridOptions = {
      columnDefs: columnDefs,
      rowData: rowData,
      animateRows: true,
      rowSelection: 'multiple' as const,
      defaultColDef: { resizable: true, sortable: true, filter: true },
      domLayout: 'normal' as const,
      suppressHorizontalScroll: false,
      pagination: true,
      paginationPageSize: 20,
      paginationPageSizeSelector: [10, 20, 50, 100]
    };

    gridEl.style.height = '600px';
    this.gridInstance = (window as any).agGrid.createGrid(gridEl, gridOptions);
  }

  onNewForm(): void {
    // Both Catalogue pages share the same library — route with origin=forms
    // so the user lands back here after save.
    this.router.navigate(['/form-details'], { queryParams: { from: 'forms' } });
  }

  onViewForm(item: SavedCatalogue): void {
    this.router.navigate(['/form-details'], {
      queryParams: { from: 'forms', id: item.id, mode: 'view' }
    });
  }

  onEditForm(item: SavedCatalogue): void {
    this.router.navigate(['/form-details'], {
      queryParams: { from: 'forms', id: item.id }
    });
  }

  onDeleteForm(item: SavedCatalogue): void {
    if (!confirm(`Delete catalogue "${item.name}"?`)) return;
    deleteCatalogue(item.id);
    this.refresh();
  }

  /** Extract a value from the form's fields by matching the label loosely. */
  private fieldValue(item: SavedCatalogue, labelMatchers: RegExp[]): string {
    if (!Array.isArray(item.fields)) return '';
    for (const f of item.fields) {
      const lbl = (f && f.label || '').toLowerCase();
      if (labelMatchers.some(rx => rx.test(lbl))) {
        const v = f.value;
        if (v == null) return '';
        if (Array.isArray(v)) return v.join(', ');
        return String(v);
      }
    }
    return '';
  }

  formattedDate(item: SavedCatalogue): string {
    const iso = item.updatedAt || item.createdAt;
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const day = String(d.getDate()).padStart(2, '0');
      const mon = d.toLocaleString('en-GB', { month: 'short' });
      const yr = String(d.getFullYear()).slice(-2);
      return `${day}-${mon}-${yr}`;
    } catch {
      return iso;
    }
  }

  emailFor(item: SavedCatalogue): string {
    return this.fieldValue(item, [/email/, /e-mail/]) || '—';
  }

  phoneFor(item: SavedCatalogue): string {
    return this.fieldValue(item, [/phone/, /contact/, /mobile/]) || '—';
  }

  trackById = (_: number, item: SavedCatalogue) => item.id;
}
