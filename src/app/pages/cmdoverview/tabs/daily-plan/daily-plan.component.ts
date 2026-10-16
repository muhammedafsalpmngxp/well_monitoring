import { Component, AfterViewInit, OnDestroy } from '@angular/core';

interface CrewProductivityRow {
  rank: number;
  crew: string;
  discipline: string;
  qtyPerHour: number;
  totalQty: number;
  hours: number;
}

const CREW_PRODUCTIVITY_DATA: CrewProductivityRow[] = [
  { rank: 1, crew: 'CR-12', discipline: 'Mechanical', qtyPerHour: 5.42, totalQty: 271, hours: 50 },
  { rank: 2, crew: 'CR-07', discipline: 'Electrical', qtyPerHour: 4.85, totalQty: 218, hours: 45 },
  { rank: 3, crew: 'CR-03', discipline: 'Mechanical', qtyPerHour: 4.25, totalQty: 204, hours: 48 },
  { rank: 4, crew: 'CR-09', discipline: 'Civil',      qtyPerHour: 3.78, totalQty: 182, hours: 48 },
  { rank: 5, crew: 'CR-02', discipline: 'Instrument', qtyPerHour: 3.64, totalQty: 160, hours: 44 },
  { rank: 6, crew: 'CR-15', discipline: 'Mechanical', qtyPerHour: 3.42, totalQty: 154, hours: 45 },
  { rank: 7, crew: 'CR-08', discipline: 'Electrical', qtyPerHour: 3.18, totalQty: 140, hours: 44 },
  { rank: 8, crew: 'CR-04', discipline: 'Civil',      qtyPerHour: 2.95, totalQty: 130, hours: 44 },
  { rank: 9, crew: 'CR-11', discipline: 'Instrument', qtyPerHour: 2.78, totalQty: 122, hours: 44 },
  { rank: 10, crew: 'CR-06', discipline: 'Mechanical', qtyPerHour: 2.62, totalQty: 115, hours: 44 },
  { rank: 11, crew: 'CR-14', discipline: 'Electrical', qtyPerHour: 2.45, totalQty: 108, hours: 44 },
  { rank: 12, crew: 'CR-10', discipline: 'Civil',      qtyPerHour: 2.30, totalQty: 101, hours: 44 }
];

interface DelayedTaskRow {
  taskId: string;
  taskName: string;
  well: string;
  delayDays: number;
  remainingDuration: string;
  status: 'High' | 'Medium' | 'Low';
}

const DELAYED_TASKS_DATA: DelayedTaskRow[] = [
  { taskId: 'TSK-1156', taskName: 'Pipe Spooling',            well: 'NMR-02', delayDays: 3, remainingDuration: '16:00', status: 'High'   },
  { taskId: 'TSK-1123', taskName: 'Instrument Cable Pulling', well: 'MRM-01', delayDays: 2, remainingDuration: '08:00', status: 'High'   },
  { taskId: 'TSK-1108', taskName: 'Tray Installation',        well: 'NMR-03', delayDays: 2, remainingDuration: '12:00', status: 'Medium' },
  { taskId: 'TSK-1177', taskName: 'Concrete Pouring',         well: 'NMR-04', delayDays: 1, remainingDuration: '10:00', status: 'Medium' },
  { taskId: 'TSK-1144', taskName: 'Equipment Erection',       well: 'MRM-02', delayDays: 1, remainingDuration: '06:00', status: 'Low'    },
  { taskId: 'TSK-1198', taskName: 'Valve Installation',       well: 'NMR-01', delayDays: 1, remainingDuration: '04:00', status: 'Low'    },
  { taskId: 'TSK-1201', taskName: 'Pipe Hydro Testing',       well: 'MRM-03', delayDays: 2, remainingDuration: '14:00', status: 'Medium' },
  { taskId: 'TSK-1215', taskName: 'Cable Termination',        well: 'NMR-05', delayDays: 3, remainingDuration: '18:00', status: 'High'   },
  { taskId: 'TSK-1218', taskName: 'Pump Alignment',           well: 'MRM-01', delayDays: 1, remainingDuration: '05:00', status: 'Low'    },
  { taskId: 'TSK-1224', taskName: 'NDT Inspection',           well: 'NMR-02', delayDays: 2, remainingDuration: '09:00', status: 'Medium' },
  { taskId: 'TSK-1227', taskName: 'Painting',                 well: 'MRM-02', delayDays: 1, remainingDuration: '07:00', status: 'Low'    },
  { taskId: 'TSK-1232', taskName: 'Final Punch-list',         well: 'NMR-04', delayDays: 4, remainingDuration: '20:00', status: 'High'   }
];

@Component({
  selector: 'app-daily-plan',
  templateUrl: './daily-plan.component.html',
  styleUrls: ['./daily-plan.component.scss']
})
export class DailyPlanComponent implements AfterViewInit, OnDestroy {

  private crewGridInstance: any = null;
  private delayedGridInstance: any = null;

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.renderCrewGrid();
      this.renderDelayedGrid();
    }, 0);
  }

  ngOnDestroy(): void {
    if (this.crewGridInstance) {
      try { this.crewGridInstance.destroy(); } catch (_) {}
      this.crewGridInstance = null;
    }
    if (this.delayedGridInstance) {
      try { this.delayedGridInstance.destroy(); } catch (_) {}
      this.delayedGridInstance = null;
    }
  }

  private renderCrewGrid(): void {
    const gridEl = document.getElementById('dpCrewGrid');
    if (!gridEl) return;

    const dk = !document.documentElement.classList.contains('navbar-light');
    gridEl.className = (dk ? 'ag-theme-alpine-dark' : 'ag-theme-alpine') + ' dp-grid';

    const rankMedalColors: Record<number, { bg: string; border: string }> = {
      1: { bg: '#f59e0b', border: 'rgba(245,158,11,0.45)' },
      2: { bg: '#9ca3af', border: 'rgba(156,163,175,0.45)' },
      3: { bg: '#b45309', border: 'rgba(180,83,9,0.45)' }
    };

    const columnDefs = [
      {
        headerName: 'Rank', field: 'rank', width: 150, minWidth: 150, sortable: true, filter: 'agNumberColumnFilter',
        cellRenderer: (p: any) => {
          const m = rankMedalColors[p.value];
          if (!m) {
            return '<span style="font-family:var(--font-family-mono);font-weight:700;color:' + (dk ? '#c7cfe0' : '#475569') + '">' + p.value + '</span>';
          }
          return '<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:' + m.bg + ';color:#fff;font-family:var(--font-family-mono);font-size:9pt;font-weight:800;border:1px solid ' + m.border + '">' + p.value + '</span>';
        }
      },
      { headerName: 'Crew', field: 'crew', width: 100, minWidth: 100, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontWeight: '600' }
      },
      { headerName: 'Discipline', field: 'discipline', flex: 1, minWidth: 100, sortable: true, filter: true,
        cellStyle: { color: dk ? '#00B0F0' : '#29378d' }
      },
      { headerName: 'Qty/Hr', field: 'qtyPerHour', width: 150, minWidth: 150, sortable: true, filter: 'agNumberColumnFilter',
        type: 'numericColumn',
        cellRenderer: (p: any) => '<span style="font-family:var(--font-family-mono);font-weight:700;color:#16a34a">' + Number(p.value).toFixed(2) + '</span>'
      },
      { headerName: 'Total', field: 'totalQty', width: 100, minWidth: 100, sortable: true, filter: 'agNumberColumnFilter',
        type: 'numericColumn',
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontWeight: '600' }
      },
      { headerName: 'Hours', field: 'hours', width: 150, minWidth: 150, sortable: true, filter: 'agNumberColumnFilter',
        type: 'numericColumn',
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontWeight: '600' }
      }
    ];

    if (this.crewGridInstance) {
      try { this.crewGridInstance.destroy(); } catch (_) {}
      this.crewGridInstance = null;
    }

    const gridOptions = {
      columnDefs: columnDefs,
      rowData: CREW_PRODUCTIVITY_DATA,
      animateRows: true,
      defaultColDef: { resizable: true, sortable: true, filter: true },
      domLayout: 'normal' as const,
      suppressHorizontalScroll: false,
      pagination: true,
      paginationPageSize: 10,
      paginationPageSizeSelector: [10, 20, 50, 100]
    };

    gridEl.style.height = '480px';

    const agGrid = (window as any).agGrid;
    if (agGrid && typeof agGrid.createGrid === 'function') {
      this.crewGridInstance = agGrid.createGrid(gridEl, gridOptions);
    }
  }

  private renderDelayedGrid(): void {
    const gridEl = document.getElementById('dpDelayedGrid');
    if (!gridEl) return;

    const dk = !document.documentElement.classList.contains('navbar-light');
    gridEl.className = (dk ? 'ag-theme-alpine-dark' : 'ag-theme-alpine') + ' dp-grid';

    const statusColors: Record<string, { bg: string; color: string; border: string }> = {
      High:   { bg: 'rgba(220,38,38,0.10)',  color: '#dc2626', border: 'rgba(220,38,38,0.25)' },
      Medium: { bg: 'rgba(245,158,11,0.12)', color: '#b45309', border: 'rgba(245,158,11,0.30)' },
      Low:    { bg: 'rgba(22,163,74,0.12)',  color: '#16a34a', border: 'rgba(22,163,74,0.25)' }
    };

    const columnDefs = [
      { headerName: 'Task ID', field: 'taskId', width: 110, minWidth: 100, sortable: true, filter: true,
        cellRenderer: (p: any) => '<span style="font-family:var(--font-family-mono);font-size:9pt;font-weight:700;color:' + (dk ? '#00B0F0' : '#29378d') + '">' + p.value + '</span>'
      },
      { headerName: 'Task Name', field: 'taskName', flex: 1, minWidth: 140, sortable: true, filter: true },
      { headerName: 'Well', field: 'well', width: 90, minWidth: 80, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontWeight: '600' }
      },
      { headerName: 'Delay (Days)', field: 'delayDays', width: 120, minWidth: 100, sortable: true, filter: 'agNumberColumnFilter',
        type: 'numericColumn',
        cellRenderer: (p: any) => '<span style="font-family:var(--font-family-mono);font-weight:700;color:#dc2626">' + p.value + '</span>'
      },
      { headerName: 'Remaining', field: 'remainingDuration', width: 110, minWidth: 90, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontWeight: '600' }
      },
      { headerName: 'Status', field: 'status', width: 110, minWidth: 100, sortable: true, filter: true,
        cellStyle: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
        cellRenderer: (p: any) => {
          const sc = statusColors[p.value] || statusColors['Low'];
          return '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:70px;font-size:8.5pt;font-weight:700;padding:3px 10px;border-radius:999px;letter-spacing:0.3px;background:' + sc.bg + ';color:' + sc.color + ';border:1px solid ' + sc.border + ';line-height:1.2">' + p.value + '</span>';
        }
      }
    ];

    if (this.delayedGridInstance) {
      try { this.delayedGridInstance.destroy(); } catch (_) {}
      this.delayedGridInstance = null;
    }

    const gridOptions = {
      columnDefs: columnDefs,
      rowData: DELAYED_TASKS_DATA,
      animateRows: true,
      defaultColDef: { resizable: true, sortable: true, filter: true },
      domLayout: 'normal' as const,
      suppressHorizontalScroll: false,
      pagination: true,
      paginationPageSize: 10,
      paginationPageSizeSelector: [10, 20, 50, 100]
    };

    gridEl.style.height = '480px';

    const agGrid = (window as any).agGrid;
    if (agGrid && typeof agGrid.createGrid === 'function') {
      this.delayedGridInstance = agGrid.createGrid(gridEl, gridOptions);
    }
  }
}
