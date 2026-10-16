import { Component, OnInit, OnDestroy, AfterViewInit, ChangeDetectorRef, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { DashboardService, WmrWell, WmrWellsPage } from '../../services/dashboard.service';

declare var agGrid: any;

@Component({
  selector: 'app-cprog-drilldown',
  templateUrl: './cprog-drilldown.component.html',
  styleUrls: ['./cprog-drilldown.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class CprogDrilldownComponent implements OnInit, AfterViewInit, OnDestroy {

  filter: string = 'plan';
  cluster?: string;
  wellType?: string;
  project?: string;
  fromDate?: string;
  toDate?: string;
  isLoading = true;
  errorMsg = '';

  // Pagination
  totalCount = 0;
  currentPage = 1;
  pageSize = 20;
  totalPages = 0;

  // Status filter pills
  activeStatusFilter: string = 'all';
  statusCounts: Record<string, number> = { all: 0, inprogress: 0, completed: 0, planned: 0 };
  private allItems: WmrWell[] = [];

  private sub?: Subscription;
  private gridApi: any = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly dashSvc: DashboardService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  get pageTitle(): string {
    return 'Construction Progress — Flowline & OHL';
  }

  get filterLabel(): string {
    const filterLabels: Record<string, string> = {
      plan: 'Plan – PDO Rig Sequence',
      flafscr: 'Plan – FLAF & SCR Adjusted',
      clean: 'Plan – PDO Issues Removed',
      backlog: 'Backlogs (−) / Extra (+)',
      completed: 'Total Completed'
    };
    return filterLabels[this.filter] || 'All Wells';
  }

  get filterBadgeClass(): string {
    switch (this.filter) {
      case 'plan': return 'badge--blue';
      case 'flafscr': return 'badge--blue';
      case 'clean': return 'badge--blue';
      case 'backlog': return 'badge--red';
      case 'completed': return 'badge--green';
      default: return 'badge--blue';
    }
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParams;
    this.filter   = params['filter']   || 'plan';
    this.cluster  = params['cluster']  || undefined;
    this.wellType = params['wellType'] || undefined;
    this.project  = params['project']  || undefined;
    this.fromDate = params['fromDate'] || undefined;
    this.toDate   = params['toDate']   || undefined;
  }

  ngAfterViewInit(): void {
    this.loadWells();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    if (this.gridApi) {
      try { this.gridApi.destroy(); } catch (e) { console.warn('Grid cleanup', e); }
      this.gridApi = null;
    }
  }

  goBack(): void {
    this.router.navigate(['/cmdoverview']);
  }

  onPageChange(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
    this.loadWells();
  }

  onPageSizeChange(size: number): void {
    this.pageSize = size;
    this.currentPage = 1;
    this.loadWells();
  }

  loadWells(): void {
    this.isLoading = true;
    this.errorMsg = '';
    this.cdr.detectChanges();

    this.sub?.unsubscribe();

    const currentYear = new Date().getFullYear();

    this.sub = this.dashSvc.getConstructionProgressWells({
      filter: this.filter,
      year: currentYear,
      cluster:  this.cluster,
      wellType: this.wellType,
      project:  this.project,
      fromDate: this.fromDate,
      toDate:   this.toDate,
      page: this.currentPage,
      pageSize: this.pageSize
    }).subscribe({
      next: (response: WmrWellsPage) => {
        this.allItems = response.items;
        this.totalCount = response.totalCount;
        this.totalPages = Math.ceil(response.totalCount / this.pageSize);
        this.computeStatusCounts(response.items);
        this.isLoading = false;
        this.cdr.detectChanges();
        this.renderGrid(this.getFilteredItems());
      },
      error: () => {
        this.errorMsg = 'Unable to load wells data. Please try again.';
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  onStatusFilter(status: string): void {
    this.activeStatusFilter = status;
    this.cdr.detectChanges();
    this.renderGrid(this.getFilteredItems());
  }

  exportCsv(): void {
    if (this.gridApi) {
      this.gridApi.exportDataAsCsv({ fileName: 'construction-progress-wells.csv' });
    }
  }

  private computeStatusCounts(items: WmrWell[]): void {
    this.statusCounts = { all: items.length, inprogress: 0, completed: 0, planned: 0 };
    for (const item of items) {
      const s = (item.status || '').toLowerCase();
      if (s in this.statusCounts) this.statusCounts[s]++;
    }
  }

  private getFilteredItems(): WmrWell[] {
    if (this.activeStatusFilter === 'all') return this.allItems;
    return this.allItems.filter(i => (i.status || '').toLowerCase() === this.activeStatusFilter);
  }

  private renderGrid(data: WmrWell[]): void {
    const gridDiv = document.getElementById('cprogDrillGrid');
    if (!gridDiv || !agGrid) return;

    const isDark = !document.documentElement.classList.contains('navbar-light');
    gridDiv.className = (isDark ? 'ag-theme-alpine-dark' : 'ag-theme-alpine') + ' cprog-drill-grid';

    const statusColors: Record<string, { color: string; darkColor: string; label: string }> = {
      completed:  { color: '#00B050', darkColor: '#00B050', label: 'COMPLETED' },
      inprogress: { color: '#29378d', darkColor: '#60A5FA', label: 'IN PROGRESS' },
      planned:    { color: '#7F7F7F', darkColor: '#A5A5A5', label: 'PLANNED' },
    };

    const statusCellRenderer = (params: any) => {
      if (!params.value) return '<span style="color:var(--txt-dim)">—</span>';
      const dk = !document.documentElement.classList.contains('navbar-light');
      const s = statusColors[params.value.toLowerCase()] || statusColors['planned'];
      const col = dk ? s.darkColor : s.color;
      return '<span style="display:inline-flex;align-items:center;gap:6px;color:' + col + ';font-weight:700;font-size:9pt;letter-spacing:0.4px;font-family:var(--font-family-mono);text-transform:uppercase">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0"></span>' + s.label +
      '</span>';
    };

    const progressCell = (params: any) => {
      if (params.value == null) return '<span style="color:var(--txt-dim)">—</span>';
      const v = Math.round(params.value);
      const col = v >= 90 ? '#00B050' : v >= 60 ? '#00B0F0' : v >= 30 ? '#FFC000' : '#FF0000';
      return '<span style="font-family:var(--font-family-mono);font-size:9pt;font-weight:700;color:' + col + '">' + v + '%</span>';
    };

    const dateFormatter = (params: any) => {
      if (!params.value) return '<span style="color:var(--txt-dim)">—</span>';
      const d = new Date(params.value);
      if (Number.isNaN(d.getTime())) return '<span style="color:var(--txt-dim)">—</span>';
      const dd = String(d.getDate()).padStart(2, '0');
      const mmm = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
      return '<span style="font-family:var(--font-family-mono);font-size:9pt;color:var(--txt-2)">' + dd + ' ' + mmm + ' ' + d.getFullYear() + '</span>';
    };

    const wellIdCell = (params: any) => {
      if (!params.value) return '<span style="color:var(--txt-dim)">—</span>';
      return '<a href="javascript:void(0)" style="color:var(--primary, #29378d);font-weight:600;text-decoration:underline;cursor:pointer;font-size:9pt;font-family:var(--font-family-mono)">' + params.value + '</a>';
    };

    const pageOffset = (this.currentPage - 1) * this.pageSize;

    const columnDefs = [
      { headerName: '#', valueGetter: (params: any) => pageOffset + params.node.rowIndex + 1, width: 50, sortable: false, filter: false, pinned: 'left',
        cellStyle: { color: 'var(--txt-muted)', fontSize: '9pt' } },
      { headerName: 'Well ID', field: 'wellId', width: 130, sortable: true, filter: true, pinned: 'left', cellRenderer: wellIdCell },
      { headerName: 'Well Name', field: 'location', width: 200, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '9pt', fontWeight: '600', color: 'var(--txt-1)' } },
      { headerName: 'Status', field: 'status', width: 150, sortable: true, filter: true, cellRenderer: statusCellRenderer },
      { headerName: 'Field', field: 'field', width: 100, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family)', fontSize: '9pt' } },
      { headerName: 'Rig', field: 'rig', width: 110, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '9pt', color: 'var(--txt-2)' } },
      { headerName: 'Well Type', field: 'wellType', width: 140, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '9pt', color: 'var(--txt-2)' } },
      { headerName: 'Progress', field: 'progressPct', width: 110, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: progressCell },
      { headerName: 'Loc. Prep %', field: 'locPrepPct', width: 120, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: progressCell },
      { headerName: 'FL Construc. %', field: 'flConstructionPct', width: 140, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: progressCell },
      { headerName: 'OHL %', field: 'ohlPct', width: 100, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: progressCell },
      { headerName: 'Commission. %', field: 'commPct', width: 140, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: progressCell },
      { headerName: 'Rig On Date', field: 'rigOnDate', width: 130, sortable: true, filter: true, cellRenderer: dateFormatter },
      { headerName: 'Rig Off Date', field: 'rigOffDate', width: 130, sortable: true, filter: true, cellRenderer: dateFormatter },
    ];

    const gridOptions: any = {
      columnDefs,
      rowData: data,
      defaultColDef: { resizable: true, sortable: true, filter: true },
      animateRows: true,
      domLayout: 'normal',
      headerHeight: 44,
      rowHeight: 50,
      suppressPaginationPanel: true,
      suppressCellFocus: false,
      enableCellTextSelection: true,
      suppressMovableColumns: false,
    };

    if (this.gridApi) {
      try { this.gridApi.destroy(); } catch (e) { console.warn('Grid cleanup', e); }
      this.gridApi = null;
    }
    gridDiv.innerHTML = '';
    this.gridApi = agGrid.createGrid(gridDiv, gridOptions);
  }
}
