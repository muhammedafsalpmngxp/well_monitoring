import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AllCommunityModule, ColDef, RowClickedEvent } from 'ag-grid-community';
import { RunStatus, ScheduleDto, ScheduleRunDto, ScheduleService } from '../../../core/services/schedule.service';
import { ARC_GRID_THEME } from '../alert-rule-configuration/alert-rule-configuration.component';
import { apiErrorMessage } from '../../model-studio/model-studio.util';
import { DeliveryBadgeRendererComponent } from './delivery-badge-renderer.component';

const TRIGGER_LABELS: Record<ScheduleRunDto['trigger'], string> = { Schedule: 'Scheduled', RunNow: 'Run now', Test: 'Test' };

function localTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
}

function fileSize(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Smart Alerts > Delivery Log: every run of every schedule, newest first, a page at a time from the server. */
@Component({
  selector: 'app-delivery-log',
  standalone: false,
  templateUrl: './delivery-log.component.html',
  styleUrls: ['../schedules/delivery-pages.scss', './delivery-log.component.scss'],
})
export class DeliveryLogComponent implements OnInit {
  runs: ScheduleRunDto[] = [];
  total = 0;
  page = 1;
  readonly pageSize = 25;
  loading = true;
  error = '';

  schedules: ScheduleDto[] = [];
  scheduleId: number | null = null;
  status: RunStatus | 'All' = 'All';
  from = '';
  to = '';
  readonly statuses: (RunStatus | 'All')[] = ['All', 'Sent', 'Skipped', 'Failed'];
  selected: ScheduleRunDto | null = null;

  readonly gridTheme = ARC_GRID_THEME;
  readonly gridModules = [AllCommunityModule];
  readonly columnDefs: ColDef<ScheduleRunDto>[] = [
    { headerName: 'Started', field: 'startedAt', minWidth: 180, valueFormatter: p => localTime(p.value) },
    { headerName: 'Schedule', field: 'scheduleName', minWidth: 180, flex: 2 },
    { headerName: 'Type', field: 'targetType', minWidth: 110, maxWidth: 130, cellRenderer: DeliveryBadgeRendererComponent },
    { headerName: 'Item', field: 'targetName', minWidth: 160, flex: 2 },
    { headerName: 'Trigger', field: 'trigger', minWidth: 110, maxWidth: 130, valueFormatter: p => TRIGGER_LABELS[p.value as ScheduleRunDto['trigger']] ?? p.value },
    { headerName: 'Status', field: 'status', minWidth: 120, maxWidth: 140, cellRenderer: DeliveryBadgeRendererComponent },
    { headerName: 'Recipients', field: 'recipientCount', minWidth: 110, maxWidth: 130, type: 'rightAligned' },
    { headerName: 'Attachment', field: 'attachmentBytes', minWidth: 120, maxWidth: 140, type: 'rightAligned', valueFormatter: p => fileSize(p.value) },
    { headerName: 'Attempts', field: 'attempt', minWidth: 100, maxWidth: 120, type: 'rightAligned' },
  ];
  readonly defaultColDef: ColDef<ScheduleRunDto> = { sortable: false, resizable: true, flex: 1 };
  readonly getRowId = (p: { data: ScheduleRunDto }) => String(p.data.id);

  constructor(
    private readonly service: ScheduleService,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  get totalPages(): number { return Math.max(1, Math.ceil(this.total / this.pageSize)); }
  get rangeStart(): number { return this.total === 0 ? 0 : (this.page - 1) * this.pageSize + 1; }
  get rangeEnd(): number { return Math.min(this.page * this.pageSize, this.total); }

  ngOnInit(): void {
    const id = Number(this.route.snapshot.queryParamMap.get('scheduleId'));
    this.scheduleId = id > 0 ? id : null;
    this.service.list().subscribe({
      next: list => { this.schedules = [...list].sort((a, b) => a.name.localeCompare(b.name)); this.cdr.markForCheck(); },
      error: () => { this.schedules = []; },
    });
    this.load();
  }

  trackSchedule(_: number, s: ScheduleDto): number { return s.id; }

  setStatus(status: RunStatus | 'All'): void {
    this.status = status;
    this.reload();
  }

  reload(): void {
    this.page = 1;
    this.load();
  }

  goTo(page: number): void {
    this.page = Math.min(this.totalPages, Math.max(1, page));
    this.load();
  }

  clearFilters(): void {
    this.scheduleId = null;
    this.status = 'All';
    this.from = '';
    this.to = '';
    this.reload();
  }

  onRowClicked(event: RowClickedEvent<ScheduleRunDto>): void {
    this.selected = event.data && this.selected?.id !== event.data.id ? event.data : null;
    this.cdr.markForCheck();
  }

  duration(run: ScheduleRunDto): string {
    if (!run.finishedAt) return 'Still running';
    const seconds = Math.max(0, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000));
    return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  }

  started(run: ScheduleRunDto): string { return localTime(run.startedAt); }
  triggerLabel(run: ScheduleRunDto): string { return TRIGGER_LABELS[run.trigger]; }
  size(run: ScheduleRunDto): string { return fileSize(run.attachmentBytes) || 'None'; }

  private load(): void {
    this.loading = true;
    this.error = '';
    this.service.runs({
      scheduleId: this.scheduleId ?? undefined,
      status: this.status === 'All' ? undefined : this.status,
      // The dates are the viewer's own days.
      from: this.from ? new Date(`${this.from}T00:00:00`).toISOString() : undefined,
      to: this.to ? new Date(`${this.to}T23:59:59`).toISOString() : undefined,
      page: this.page,
      pageSize: this.pageSize,
    }).subscribe({
      next: result => {
        this.runs = result.items;
        this.total = result.total;
        this.selected = this.selected ? result.items.find(r => r.id === this.selected?.id) ?? null : null;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: err => {
        this.error = apiErrorMessage(err, 'The delivery log could not be loaded.');
        this.runs = [];
        this.total = 0;
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }
}
