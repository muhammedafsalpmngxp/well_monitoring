import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';

export interface SubmittedRequest {
  id: string;
  formName: string;
  submittedBy: string;
  submittedAt: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'In Review';
  reference: string;
}

const REQUESTS_KEY = 'altasnim.requests';

const DEFAULT_REQUESTS: SubmittedRequest[] = [
  {
    id: 'req-2026-0142',
    formName: 'Material Request',
    submittedBy: 'Ahmed Al-Harthy',
    submittedAt: '2026-05-02T09:30:00.000Z',
    status: 'Approved',
    reference: 'AFE-2026-0142'
  },
  {
    id: 'req-2026-0141',
    formName: 'Site Inspection',
    submittedBy: 'Ahmed Al-Hasani',
    submittedAt: '2026-05-01T14:18:00.000Z',
    status: 'In Review',
    reference: 'SI-2026-0091'
  },
  {
    id: 'req-2026-0140',
    formName: 'Incident Report',
    submittedBy: 'Khalid Al-Mazrouei',
    submittedAt: '2026-04-30T11:42:00.000Z',
    status: 'Pending',
    reference: 'IR-2026-0034'
  },
  {
    id: 'req-2026-0139',
    formName: 'PPE Audit',
    submittedBy: 'F. Al-Hamdi',
    submittedAt: '2026-04-29T08:05:00.000Z',
    status: 'Approved',
    reference: 'PPE-2026-0067'
  },
  {
    id: 'req-2026-0138',
    formName: 'Crew Daily Report',
    submittedBy: 'R. Krishnan',
    submittedAt: '2026-04-28T18:10:00.000Z',
    status: 'Approved',
    reference: 'CDR-2026-0212'
  }
];

function readAllRequests(): SubmittedRequest[] {
  try {
    const raw = localStorage.getItem(REQUESTS_KEY);
    if (raw === null) {
      localStorage.setItem(REQUESTS_KEY, JSON.stringify(DEFAULT_REQUESTS));
      return DEFAULT_REQUESTS.slice();
    }
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

@Component({
  selector: 'app-myrequests',
  templateUrl: './myrequests.component.html',
  styleUrls: ['./myrequests.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class MyRequestsComponent implements AfterViewInit {

  items: SubmittedRequest[] = [];
  private gridInstance: any = null;

  constructor(private router: Router) {}

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;
    this.items = readAllRequests();
    setTimeout(() => this.renderGrid(), 0);

    (window as any).__mrThemeRefresh = () => {
      if (this.gridInstance) { try { this.gridInstance.destroy(); } catch (_) {} this.gridInstance = null; }
      setTimeout(() => this.renderGrid(), 0);
    };
  }

  private renderGrid(): void {
    const gridEl = document.getElementById('mrRequestsGrid');
    if (!gridEl || this.items.length === 0) return;

    const dk = !document.documentElement.classList.contains('navbar-light');
    gridEl.className = dk ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

    const self = this;
    const rowData = this.items.map(item => ({
      reference: item.reference,
      formName: item.formName,
      submittedBy: item.submittedBy,
      submittedAt: self.formattedDate(item.submittedAt),
      status: item.status,
      statusColor: self.statusColor(item.status)
    }));

    const statusColors: Record<string, { bg: string; color: string; border: string }> = {
      green: { bg: 'rgba(0,176,80,0.10)', color: '#00B050', border: 'rgba(0,176,80,0.25)' },
      red:   { bg: 'rgba(255,0,0,0.10)', color: '#FF0000', border: 'rgba(255,0,0,0.25)' },
      amber: { bg: 'rgba(255,192,0,0.10)', color: '#FFC000', border: 'rgba(255,192,0,0.25)' },
      blue:  { bg: 'rgba(41,55,141,0.10)', color: dk ? '#00B0F0' : '#29378d', border: dk ? 'rgba(0,176,240,0.25)' : 'rgba(41,55,141,0.25)' },
      slate: { bg: 'rgba(165,165,165,0.10)', color: '#A5A5A5', border: 'rgba(165,165,165,0.25)' }
    };

    const columnDefs = [
      { headerName: 'Reference', field: 'reference', width: 180, sortable: true, filter: true,
        cellRenderer: (p: any) => '<span style="font-family:var(--font-family-mono);font-size:9pt;font-weight:700;color:' + (dk ? '#00B0F0' : '#29378d') + '">' + p.value + '</span>' },
      { headerName: 'Form', field: 'formName', flex: 1, minWidth: 180, sortable: true, filter: true },
      { headerName: 'Submitted By', field: 'submittedBy', width: 200, sortable: true, filter: true },
      { headerName: 'Submitted', field: 'submittedAt', width: 150, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '9pt', color: dk ? '#c7cfe0' : '#475569' } },
      { headerName: 'Status', field: 'status', width: 140, sortable: true, filter: true,
        cellRenderer: (p: any) => {
          const sc = statusColors[p.data.statusColor] || statusColors['slate'];
          return '<span style="display:inline-block;font-size:9pt;font-weight:700;padding:2px 10px;border-radius:10px;letter-spacing:0.2px;background:' + sc.bg + ';color:' + sc.color + ';border:1px solid ' + sc.border + '">' + p.value + '</span>';
        }
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

  onNewRequest(): void {
    this.router.navigate(['/requestportal']);
  }

  formattedDate(iso: string): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const day = String(d.getDate()).padStart(2, '0');
      const mon = d.toLocaleString('en-GB', { month: 'short' });
      const yr = String(d.getFullYear()).slice(-2);
      return `${day}-${mon}-${yr}`;
    } catch { return iso; }
  }

  statusColor(status: string): string {
    switch (status) {
      case 'Approved': return 'green';
      case 'Rejected': return 'red';
      case 'In Review': return 'amber';
      case 'Pending':  return 'blue';
      default:         return 'slate';
    }
  }

  trackById = (_: number, item: SubmittedRequest) => item.id;
}
