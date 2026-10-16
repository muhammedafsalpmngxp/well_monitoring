import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Subscription, skip } from 'rxjs';
import { DashboardService, ActivitiesProgress, ActivitiesListResponse, ActivityRowDto, HfbFilter } from '../../services/dashboard.service';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

declare var agGrid: any;
declare var hfbState: any;

@Component({
  selector: 'app-activities',
  templateUrl: './activities.component.html',
  styleUrls: ['./activities.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ActivitiesComponent implements AfterViewInit, OnDestroy {
  private filterSub?: Subscription;
  private gridApi: any;
  private retryCount = 0;
  private listRetryCount = 0;
  private retryTimer: any;
  private listRetryTimer: any;
  private kpiSub?: Subscription;
  private listSub?: Subscription;
  private currentPage = 1;
  private pageSize = 50;
  private totalRows = 0;
  private totalPages = 0;
  private kpiTotal = 0;
  private isInitialLoad = true;
  // Snapshot of active filters — used for KPI + list + pagination to stay consistent
  private activeFilters: { odc: string; cluster?: string; wellId?: string; startDate?: string; endDate?: string } = { odc: 'south' };

  constructor(private readonly dashSvc: DashboardService) {}

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Initial load using current filter state
    this.loadData();

    // Re-fetch whenever the header filter changes (skip initial emission)
    this.filterSub = this.dashSvc.filter$.pipe(skip(1)).subscribe((f: HfbFilter) => {
      this.onFilterChange();
    });
  }

  ngOnDestroy(): void {
    this.filterSub?.unsubscribe();
    this.kpiSub?.unsubscribe();
    this.listSub?.unsubscribe();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.listRetryTimer) clearTimeout(this.listRetryTimer);
    if (this.gridApi) { try { this.gridApi.destroy(); } catch (_) {} }
  }

  private onFilterChange(): void {
    // Cancel any in-flight requests and pending retries
    this.kpiSub?.unsubscribe();
    this.listSub?.unsubscribe();
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.listRetryTimer) { clearTimeout(this.listRetryTimer); this.listRetryTimer = null; }
    this.retryCount = 0;
    this.listRetryCount = 0;
    this.isInitialLoad = false;
    this.currentPage = 1;

    // Show loading state immediately
    this.showGridLoading();
    this.loadData();
  }

  private getDefaultFrom(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  }

  private getDefaultTo(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private getFilters() {
    // Primary source: Angular filter service (authoritative, updated by filter bar events)
    const f = this.dashSvc.getCurrentFilter();

    let odc = 'south';
    let cluster: string | undefined = f.cluster || undefined;
    let wellId: string | undefined = f.wellId || undefined;
    let startDate: string | undefined = f.startDate || undefined;
    let endDate: string | undefined = f.endDate || undefined;

    // Secondary source: hfbState global (for odc and as fallback)
    try {
      if (typeof hfbState !== 'undefined' && hfbState) {
        odc = hfbState.odc || 'south';
        // Use hfbState as fallback if Angular service doesn't have values
        if (!cluster && hfbState.cluster) cluster = hfbState.cluster;
        if (!wellId && hfbState.well) wellId = hfbState.well.split('-').slice(1).join('-') || hfbState.well;
        if (!startDate && hfbState.startDate) startDate = hfbState.startDate;
        if (!endDate && hfbState.endDate) endDate = hfbState.endDate;
      }
    } catch (_) {}

    // Fall back to default date range (first of month → today)
    if (!startDate) startDate = this.getDefaultFrom();
    if (!endDate) endDate = this.getDefaultTo();

    return { odc, cluster, wellId, startDate, endDate };
  }

  private loadData(): void {
    // Capture filter snapshot ONCE — used for both KPI and list calls
    this.activeFilters = this.getFilters();
    const filters = this.activeFilters;

    console.log('[activities] loadData filters:', JSON.stringify(filters));

    // Cancel previous KPI request
    this.kpiSub?.unsubscribe();

    // 1. Load KPI numbers
    this.kpiSub = this.dashSvc.getActivitiesProgress(filters).subscribe({
      next: (data: ActivitiesProgress) => {
        // Only retry on initial load when no specific filter is applied (cache might not be ready)
        const hasSpecificFilter = !!filters.cluster || !!filters.wellId;
        if (data.total === 0 && this.isInitialLoad && !hasSpecificFilter && this.retryCount < 5) {
          this.retryCount++;
          this.retryTimer = setTimeout(() => this.loadData(), 3000);
          return;
        }
        this.retryCount = 0;
        this.kpiTotal = data.total;
        this.renderKpi(data);

        // 2. Load table data
        this.listRetryCount = 0;
        this.loadGridPage();
      },
      error: (err) => {
        console.error('[activities] KPI API error', err);
        if (this.retryCount < 5) {
          this.retryCount++;
          this.retryTimer = setTimeout(() => this.loadData(), 2000);
        }
      }
    });
  }

  private loadGridPage(): void {
    // Use the stored activeFilters snapshot (same filters as KPI)
    const filters = this.activeFilters;

    console.log('[activities] loadGridPage filters:', JSON.stringify(filters));

    // Cancel previous list request
    this.listSub?.unsubscribe();

    this.listSub = this.dashSvc.getActivitiesList({
      ...filters,
      page: this.currentPage,
      pageSize: this.pageSize
    }).subscribe({
      next: (res: ActivitiesListResponse) => {
        // Retry only on initial load if list cache not ready yet but KPI shows data
        if (res.totalRows === 0 && this.kpiTotal > 0 && this.isInitialLoad && this.listRetryCount < 5) {
          this.listRetryCount++;
          this.showGridLoading();
          this.listRetryTimer = setTimeout(() => this.loadGridPage(), 3000);
          return;
        }
        this.listRetryCount = 0;
        this.totalRows = res.totalRows;
        this.totalPages = res.totalPages;
        this.renderGrid(res.items, res.totalRows);
      },
      error: () => {
        console.warn('[activities] activities-list API error');
        if (this.isInitialLoad && this.kpiTotal > 0 && this.listRetryCount < 5) {
          this.listRetryCount++;
          this.showGridLoading();
          this.listRetryTimer = setTimeout(() => this.loadGridPage(), 2000);
          return;
        }
        this.renderGrid([], 0);
      }
    });
  }

  private renderKpi(data: ActivitiesProgress): void {
    const { total, completed, inProgress, notStarted, progress } = data;

    const setAct = (key: string, txt: string) => {
      document.querySelectorAll(`[data-act="${key}"]`).forEach(el => el.textContent = txt);
    };
    const setActHTML = (key: string, html: string) => {
      document.querySelectorAll(`[data-act="${key}"]`).forEach(el => el.innerHTML = html);
    };
    const setActStyle = (key: string, prop: string, val: string) => {
      document.querySelectorAll(`[data-act="${key}"]`).forEach((el: any) => el.style[prop] = val);
    };

    const filters = this.getFilters();
    const scopeLabel = filters.wellId ? `Well ${filters.wellId}` :
      (filters.cluster ? `${filters.cluster} Cluster` : 'ODC South Well Delivery');

    setAct('pageSub', `Activity Master · ${this.fmtK(total)} activit${total === 1 ? 'y' : 'ies'} · scope: ${scopeLabel}`);
    setAct('total', this.fmtK(total));
    setAct('totalSub', filters.cluster ? `${filters.cluster} cluster scope` : 'Across all disciplines');

    const compPct = total ? Math.round(completed / total * 100) : 0;
    setActHTML('completed', `${this.fmtK(completed)} <span class="small">/ ${this.fmtK(total)}</span>`);
    setActStyle('completedBar', 'width', compPct + '%');
    setAct('completedSub', compPct + '% of scope');

    const ipPct = total ? Math.round(inProgress / total * 100) : 0;
    setActHTML('inprogress', `${this.fmtK(inProgress)} <span class="small">/ ${this.fmtK(total)}</span>`);
    setActStyle('inprogressBar', 'width', ipPct + '%');
    setAct('inprogressSub', ipPct + '% currently active');

    setAct('atrisk', this.fmtK(notStarted));
    setAct('atriskSub', notStarted > 0 ? 'Not started yet' : '— No items');

    setActHTML('prod', `${Math.round(progress)}<span class="small">% complete</span>`);
    setActStyle('prodBar', 'width', Math.min(100, Math.round(progress)) + '%');

    setAct('gridSub', `${this.fmtK(total)} activit${total === 1 ? 'y' : 'ies'} · sortable · filterable`);
  }

  private fmtK(n: number): string {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  private showGridLoading(): void {
    const gridDiv = document.getElementById('actGrid');
    if (gridDiv && !this.gridApi) {
      gridDiv.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px;color:var(--txt-muted);font-size:13px;">
        <span>Loading activity data… (attempt ${this.listRetryCount}/40)</span></div>`;
    }
  }

  private renderGrid(items: ActivityRowDto[], totalRows: number): void {
    const gridDiv = document.getElementById('actGrid');
    if (!gridDiv || typeof agGrid === 'undefined') return;

    const statusColors: Record<string, string> = {
      'Completed': '#16a34a', 'In Progress': '#29378d', 'Not Started': '#f59e0b'
    };

    const columnDefs = [
      { headerName: 'Activity Code', field: 'code', width: 180, sortable: true, filter: true,
        cellRenderer: (p: any) => `<span style="font-family:var(--font-family-mono);font-size:9pt;color:var(--txt-2)">${p.value}</span>`
      },
      { headerName: 'Description', field: 'description', flex: 1, minWidth: 240, sortable: true, filter: true },
      { headerName: 'Well', field: 'wellId', width: 100, sortable: true, filter: true,
        cellRenderer: (p: any) => `<div style="line-height:1.3;padding:5px 0">
          <div style="font-family:var(--font-family-mono);font-size:10pt;font-weight:600;color:var(--txt-1)">${p.value || ''}</div>
          <div style="font-size:9pt;color:var(--txt-muted)">${p.data.cluster || ''}</div></div>`
      },
      { headerName: 'Cluster', field: 'cluster', width: 110, sortable: true, filter: true },
      { headerName: 'Status', field: 'status', width: 130, sortable: true, filter: true,
        cellRenderer: (p: any) => {
          const c = statusColors[p.value] || '#64748b';
          return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:9pt;font-weight:600;color:${c}"><span style="width:7px;height:7px;border-radius:50%;background:${c}"></span>${p.value}</span>`;
        }
      },
      { headerName: 'Progress', field: 'progressPct', width: 100, sortable: true, filter: 'agNumberColumnFilter',
        cellRenderer: (p: any) => `<span style="font-family:var(--font-family-mono);font-size:9pt;font-weight:600">${p.value}%</span>`
      },
      { headerName: 'Start Date', field: 'startDate', width: 115, sortable: true, filter: true },
      { headerName: 'End Date', field: 'endDate', width: 115, sortable: true, filter: true },
      { headerName: 'Assignee', field: 'assignee', width: 150, sortable: true, filter: true }
    ];

    if (this.gridApi) {
      this.gridApi.setGridOption('rowData', items);
      this.updatePaginationControls();
      return;
    }

    const gridOptions = {
      columnDefs,
      rowData: items,
      defaultColDef: { resizable: true, sortable: true, filter: true },
      animateRows: true,
      domLayout: 'normal',
      rowHeight: 56,
      headerHeight: 42,
      suppressCellFocus: false,
      enableCellTextSelection: true,
      suppressMovableColumns: false
    };

    this.gridApi = agGrid.createGrid(gridDiv, gridOptions);
    this.renderPaginationControls(gridDiv);
    this.updatePaginationControls();
  }

  private renderPaginationControls(gridDiv: Element): void {
    // Insert server-side pagination controls below the grid
    let paginationEl = document.getElementById('actGridPagination');
    if (!paginationEl) {
      paginationEl = document.createElement('div');
      paginationEl.id = 'actGridPagination';
      paginationEl.className = 'act-pagination';
      gridDiv.parentElement?.appendChild(paginationEl);
    }
    paginationEl.innerHTML = `
      <div class="act-pagination-info">
        <span data-act="paginationInfo"></span>
      </div>
      <div class="act-pagination-controls">
        <button id="actPrevPage" class="act-page-btn">‹ Prev</button>
        <span data-act="paginationPage" style="margin:0 12px;font-size:13px;color:var(--txt-2)"></span>
        <button id="actNextPage" class="act-page-btn">Next ›</button>
      </div>
    `;

    document.getElementById('actPrevPage')?.addEventListener('click', () => {
      if (this.currentPage > 1) { this.currentPage--; this.loadGridPage(); }
    });
    document.getElementById('actNextPage')?.addEventListener('click', () => {
      if (this.currentPage < this.totalPages) { this.currentPage++; this.loadGridPage(); }
    });
  }

  private updatePaginationControls(): void {
    const from = (this.currentPage - 1) * this.pageSize + 1;
    const to = Math.min(this.currentPage * this.pageSize, this.totalRows);
    const setAct = (key: string, txt: string) => {
      document.querySelectorAll(`[data-act="${key}"]`).forEach(el => el.textContent = txt);
    };
    setAct('paginationInfo', `Showing ${this.fmtK(from)}–${this.fmtK(to)} of ${this.fmtK(this.totalRows)} activities`);
    setAct('paginationPage', `Page ${this.currentPage} of ${this.totalPages}`);

    const prevBtn = document.getElementById('actPrevPage') as HTMLButtonElement;
    const nextBtn = document.getElementById('actNextPage') as HTMLButtonElement;
    if (prevBtn) prevBtn.disabled = this.currentPage <= 1;
    if (nextBtn) nextBtn.disabled = this.currentPage >= this.totalPages;
  }

  exportToExcel(): void {
    const filters = this.activeFilters;
    // Fetch all rows for export (up to 50000)
    this.dashSvc.getActivitiesList({
      ...filters,
      page: 1,
      pageSize: 50000
    }).subscribe({
      next: (res: ActivitiesListResponse) => {
        const data = res.items.map(item => ({
          'Activity Code': item.code,
          'Description': item.description,
          'Well': item.wellId,
          'Cluster': item.cluster,
          'Status': item.status,
          'Progress (%)': item.progressPct,
          'Start Date': item.startDate,
          'End Date': item.endDate,
          'Assignee': item.assignee
        }));

        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Activities');

        // Auto-size columns
        const colWidths = Object.keys(data[0] || {}).map(key => ({
          wch: Math.max(key.length, ...data.map(row => String((row as any)[key] || '').length))
        }));
        worksheet['!cols'] = colWidths;

        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const dateStr = new Date().toISOString().slice(0, 10);
        saveAs(blob, `Activities_Export_${dateStr}.xlsx`);
      },
      error: (err) => {
        console.error('[activities] Export failed', err);
      }
    });
  }
}
