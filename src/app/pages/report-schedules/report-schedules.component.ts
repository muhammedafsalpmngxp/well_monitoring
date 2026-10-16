import { Component, AfterViewInit, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';
import { SavedReport, readAllReports } from '../reports/reports.component';

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly' | 'custom';
export type ScheduleFormat = 'pdf' | 'xlsx' | 'csv' | 'html';

export interface ReportSchedule {
  id: string;
  reportId: string;
  reportName: string;
  name: string;
  active: boolean;
  frequency: ScheduleFrequency;
  daysOfWeek?: number[];        // 0=Sun .. 6=Sat (weekly)
  dayOfMonth?: number;           // 1..28 (monthly)
  cron?: string;                 // raw cron (custom)
  timeOfDay: string;             // 'HH:mm' 24h
  timezone?: string;
  recipients: string[];
  format: ScheduleFormat;
  subject: string;
  body: string;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount?: number;
  createdAt: string;
  updatedAt: string;
  owner?: string;
}

const STORAGE_KEY = 'altasnim.report.schedules';

const DEFAULT_SCHEDULES: ReportSchedule[] = [
  {
    id: 'sched-seed-weekly-penalty',
    reportId: 'rep-seed-penalty-by-cluster',
    reportName: 'Penalty Exposure by Cluster',
    name: 'Weekly Penalty Exposure Digest',
    active: true,
    frequency: 'weekly',
    daysOfWeek: [1],
    timeOfDay: '07:00',
    timezone: 'Asia/Muscat',
    recipients: ['md@altasnim.com', 'finance@altasnim.com', 'pm.lead@altasnim.com'],
    format: 'pdf',
    subject: '[Weekly] Penalty Exposure by Cluster',
    body: 'Attached is this week\'s penalty exposure breakdown by cluster. Wells driving exposure are highlighted in the report.',
    lastRunAt: '2026-04-27T07:00:00.000Z',
    nextRunAt: '2026-05-04T07:00:00.000Z',
    runCount: 12,
    createdAt: '2026-02-15T09:30:00.000Z',
    updatedAt: '2026-04-27T07:00:00.000Z',
    owner: 'You'
  },
  {
    id: 'sched-seed-daily-status',
    reportId: 'rep-seed-status-distribution',
    reportName: 'Status Distribution',
    name: 'Daily Programme Health Snapshot',
    active: true,
    frequency: 'daily',
    timeOfDay: '06:00',
    timezone: 'Asia/Muscat',
    recipients: ['ops.lead@altasnim.com', 'site.managers@altasnim.com'],
    format: 'html',
    subject: 'Daily Programme Health — {{date}}',
    body: 'Good morning,\n\nProgramme health snapshot for the day attached below. On Track / At Risk / Critical / Ahead distribution.',
    lastRunAt: '2026-05-02T06:00:00.000Z',
    nextRunAt: '2026-05-03T06:00:00.000Z',
    runCount: 87,
    createdAt: '2026-02-04T08:00:00.000Z',
    updatedAt: '2026-05-02T06:00:00.000Z',
    owner: 'You'
  },
  {
    id: 'sched-seed-monthly-crew',
    reportId: 'rep-seed-crew-discipline',
    reportName: 'Crew Discipline Mix',
    name: 'Monthly Crew Mix Review',
    active: false,
    frequency: 'monthly',
    dayOfMonth: 1,
    timeOfDay: '08:00',
    timezone: 'Asia/Muscat',
    recipients: ['hr@altasnim.com'],
    format: 'xlsx',
    subject: 'Monthly Crew Discipline Mix — {{month}}',
    body: 'HR team — please review the crew discipline mix for the month and flag any imbalances.',
    nextRunAt: '2026-06-01T08:00:00.000Z',
    runCount: 3,
    createdAt: '2026-02-01T10:00:00.000Z',
    updatedAt: '2026-04-01T08:00:00.000Z',
    owner: 'You'
  }
];

function readAllSchedules(): ReportSchedule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      writeAllSchedules(DEFAULT_SCHEDULES);
      return DEFAULT_SCHEDULES.slice();
    }
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAllSchedules(items: ReportSchedule[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }
  catch (e) { console.error('[report-schedules] persist failed', e); }
}

function upsertSchedule(s: ReportSchedule): void {
  const items = readAllSchedules();
  const idx = items.findIndex(x => x.id === s.id);
  if (idx >= 0) items[idx] = s;
  else items.unshift(s);
  writeAllSchedules(items);
}

function deleteSchedule(id: string): void {
  writeAllSchedules(readAllSchedules().filter(x => x.id !== id));
}

@Component({
  selector: 'app-report-schedules',
  templateUrl: './report-schedules.component.html',
  styleUrls: ['./report-schedules.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ReportSchedulesComponent implements AfterViewInit {

  schedules: ReportSchedule[] = [];
  reports: SavedReport[] = [];
  private gridInstance: any = null;

  modalOpen = false;
  isEditing = false;
  editing: ReportSchedule = this.makeBlank();
  recipientDraft = '';

  // Day-of-week labels (Sun..Sat for weekly picker)
  weekDays = [
    { idx: 0, short: 'Sun', long: 'Sunday' },
    { idx: 1, short: 'Mon', long: 'Monday' },
    { idx: 2, short: 'Tue', long: 'Tuesday' },
    { idx: 3, short: 'Wed', long: 'Wednesday' },
    { idx: 4, short: 'Thu', long: 'Thursday' },
    { idx: 5, short: 'Fri', long: 'Friday' },
    { idx: 6, short: 'Sat', long: 'Saturday' }
  ];

  constructor(private router: Router) {}

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;
    this.refresh();

    // Expose action callbacks for ag-grid cell renderers
    (window as any)['rsToggleActive'] = (id: string) => {
      const s = this.schedules.find(x => x.id === id);
      if (s) this.onToggleActive(s);
    };
    (window as any)['rsRunNow'] = (id: string) => {
      const s = this.schedules.find(x => x.id === id);
      if (s) this.onRunNow(s);
    };
    (window as any)['rsEditSchedule'] = (id: string) => {
      const s = this.schedules.find(x => x.id === id);
      if (s) this.onEdit(s);
    };
    (window as any)['rsDeleteSchedule'] = (id: string) => {
      const s = this.schedules.find(x => x.id === id);
      if (s) this.onDelete(s);
    };

    (window as any).__rsThemeRefresh = () => {
      if (this.gridInstance) { try { this.gridInstance.destroy(); } catch (_) {} this.gridInstance = null; }
      setTimeout(() => this.renderGrid(), 0);
    };
  }

  refresh(): void {
    this.schedules = readAllSchedules();
    this.reports = readAllReports();
    setTimeout(() => this.renderGrid(), 0);
  }

  private renderGrid(): void {
    const gridEl = document.getElementById('rsScheduleGrid');
    if (!gridEl || this.schedules.length === 0) return;

    const dk = !document.documentElement.classList.contains('navbar-light');
    gridEl.className = dk ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

    const self = this;
    const rowData = this.schedules.map(s => ({
      id: s.id,
      name: s.name,
      runInfo: (s.runCount && s.runCount > 0) ? `${self.formatInt(s.runCount)} runs \u00B7 last ${self.formatDateTime(s.lastRunAt)}` : '',
      reportName: s.reportName,
      reportId: s.reportId,
      frequency: self.frequencyLabel(s),
      nextRun: s.active ? self.formatDateTime(s.nextRunAt) : 'Paused',
      recipients: self.recipientsSummary(s),
      recipientsFull: s.recipients.join(', '),
      format: s.format,
      formatLabel: self.formatLabel(s.format),
      active: s.active
    }));

    const formatColors: Record<string, { bg: string; color: string; border: string }> = {
      pdf:  { bg: 'rgba(255,0,0,0.10)', color: '#FF0000', border: 'rgba(255,0,0,0.25)' },
      xlsx: { bg: 'rgba(0,176,80,0.10)', color: '#00B050', border: 'rgba(0,176,80,0.25)' },
      csv:  { bg: 'rgba(255,192,0,0.10)', color: '#FFC000', border: 'rgba(255,192,0,0.25)' },
      html: { bg: 'rgba(41,55,141,0.10)', color: '#29378d', border: 'rgba(41,55,141,0.25)' }
    };

    const columnDefs = [
      { headerName: 'Schedule Name', field: 'name', width: 240, sortable: true, filter: true,
        cellRenderer: (p: any) => {
          let html = '<div style="font-weight:700;color:var(--txt-1)">' + p.value + '</div>';
          if (p.data.runInfo) html += '<div style="font-size:9pt;color:var(--txt-muted);margin-top:2px">' + p.data.runInfo + '</div>';
          return html;
        }
      },
      { headerName: 'Report', field: 'reportName', width: 200, sortable: true, filter: true,
        cellRenderer: (p: any) => '<span style="color:#29378d;font-weight:500;cursor:pointer">' + p.value + '</span>' },
      { headerName: 'Frequency', field: 'frequency', width: 200, sortable: true, filter: true },
      { headerName: 'Next Run', field: 'nextRun', width: 150, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '9pt', color: dk ? '#c7cfe0' : '#475569' } },
      { headerName: 'Recipients', field: 'recipients', width: 200, sortable: true, filter: true,
        cellStyle: { fontSize: '9pt', color: dk ? '#c7cfe0' : '#475569' },
        tooltipField: 'recipientsFull' },
      { headerName: 'Format', field: 'format', width: 100, sortable: true, filter: true,
        cellRenderer: (p: any) => {
          const fc = formatColors[p.value] || formatColors['pdf'];
          return '<span style="font-size:9pt;font-weight:700;padding:2px 8px;border-radius:8px;letter-spacing:0.4px;background:' + fc.bg + ';color:' + fc.color + ';border:1px solid ' + fc.border + '">' + p.data.formatLabel + '</span>';
        },
        cellStyle: { textAlign: 'center' }
      },
      { headerName: 'Active', field: 'active', width: 100, sortable: true, filter: true,
        cellRenderer: (p: any) => {
          const checked = p.value ? 'checked' : '';
          return '<label class="rs-toggle"><input type="checkbox" ' + checked + ' onchange="rsToggleActive(\'' + p.data.id + '\')"/><span class="rs-toggle-slider"></span></label>';
        },
        cellStyle: { textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center' }
      },
      { headerName: 'Actions', field: 'id', width: 130, sortable: false, filter: false,
        cellRenderer: (p: any) => {
          const id = p.value;
          return '<div style="display:flex;gap:6px;justify-content:flex-end;align-items:center;height:100%">' +
            '<button class="form-act-btn" title="Run Now" onclick="rsRunNow(\'' + id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3"/></svg></button>' +
            '<button class="form-act-btn" title="Edit" onclick="rsEditSchedule(\'' + id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
            '<button class="form-act-btn danger" title="Delete" onclick="rsDeleteSchedule(\'' + id + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg></button>' +
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
      paginationPageSizeSelector: [10, 20, 50, 100],
      getRowStyle: (params: any) => {
        if (!params.data.active) return { opacity: '0.55' };
        return null;
      }
    };

    gridEl.style.height = '600px';
    this.gridInstance = (window as any).agGrid.createGrid(gridEl, gridOptions);
  }

  // ────────────────────────────────────────────────
  // Listing actions
  // ────────────────────────────────────────────────
  onNew(): void {
    this.editing = this.makeBlank();
    if (this.reports.length > 0) {
      this.editing.reportId = this.reports[0].id;
      this.editing.reportName = this.reports[0].name;
      this.editing.subject = `[Scheduled] ${this.reports[0].name}`;
    }
    this.isEditing = false;
    this.modalOpen = true;
    this.recipientDraft = '';
  }

  onEdit(s: ReportSchedule): void {
    // Deep clone so the user can cancel without mutating the saved record
    this.editing = JSON.parse(JSON.stringify(s));
    this.isEditing = true;
    this.modalOpen = true;
    this.recipientDraft = '';
  }

  onDelete(s: ReportSchedule): void {
    if (!confirm(`Delete schedule "${s.name}"? This cannot be undone.`)) return;
    deleteSchedule(s.id);
    this.refresh();
  }

  onToggleActive(s: ReportSchedule): void {
    s.active = !s.active;
    s.updatedAt = new Date().toISOString();
    upsertSchedule(s);
    this.refresh();
  }

  onRunNow(s: ReportSchedule): void {
    s.lastRunAt = new Date().toISOString();
    s.runCount = (s.runCount || 0) + 1;
    upsertSchedule(s);
    this.refresh();
    alert(
      `Schedule "${s.name}" triggered manually.\n\n` +
      `Report: ${s.reportName}\n` +
      `Format: ${s.format.toUpperCase()}\n` +
      `Sent to: ${s.recipients.join(', ')}\n\n` +
      `(This is a UI mockup — no email actually sent.)`
    );
  }

  // ────────────────────────────────────────────────
  // Modal save / cancel
  // ────────────────────────────────────────────────
  onSave(): void {
    const e = this.editing;
    const name = (e.name || '').trim();
    if (!name) { alert('Please name the schedule.'); return; }
    if (!e.reportId) { alert('Please select a report to schedule.'); return; }
    if (e.recipients.length === 0) { alert('Please add at least one recipient email.'); return; }
    if (e.frequency === 'weekly' && (!e.daysOfWeek || e.daysOfWeek.length === 0)) {
      alert('Please pick at least one day of the week.');
      return;
    }
    if (e.frequency === 'monthly' && !e.dayOfMonth) {
      alert('Please pick a day of the month.');
      return;
    }
    if (e.frequency === 'custom' && !((e.cron || '').trim())) {
      alert('Please enter a cron expression.');
      return;
    }

    // Sync denormalized report name
    const rep = this.reports.find(r => r.id === e.reportId);
    if (rep) e.reportName = rep.name;

    e.name = name;
    e.nextRunAt = this.computeNextRun(e);
    e.updatedAt = new Date().toISOString();

    if (!this.isEditing) {
      e.id = 'sched-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      e.createdAt = e.updatedAt;
      e.runCount = 0;
      e.owner = 'You';
    }

    upsertSchedule(e);
    this.modalOpen = false;
    this.refresh();
  }

  onCancel(): void {
    this.modalOpen = false;
  }

  onMaybeCloseBackdrop(ev: Event): void {
    const tgt = ev.target as HTMLElement;
    if (tgt.classList.contains('rs-modal-backdrop')) this.modalOpen = false;
  }

  // ────────────────────────────────────────────────
  // Frequency UI helpers
  // ────────────────────────────────────────────────
  pickFrequency(f: ScheduleFrequency): void {
    this.editing.frequency = f;
    if (f === 'weekly' && (!this.editing.daysOfWeek || this.editing.daysOfWeek.length === 0)) {
      this.editing.daysOfWeek = [1]; // default Monday
    }
    if (f === 'monthly' && !this.editing.dayOfMonth) {
      this.editing.dayOfMonth = 1;
    }
    if (f === 'custom' && !this.editing.cron) {
      this.editing.cron = '0 6 * * 1';
    }
  }

  toggleDayOfWeek(idx: number): void {
    if (!this.editing.daysOfWeek) this.editing.daysOfWeek = [];
    const i = this.editing.daysOfWeek.indexOf(idx);
    if (i >= 0) this.editing.daysOfWeek.splice(i, 1);
    else this.editing.daysOfWeek.push(idx);
    this.editing.daysOfWeek.sort((a, b) => a - b);
  }

  isDayPicked(idx: number): boolean {
    return (this.editing.daysOfWeek || []).indexOf(idx) >= 0;
  }

  // ────────────────────────────────────────────────
  // Recipient chip management
  // ────────────────────────────────────────────────
  onRecipientKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' || ev.key === ',') {
      ev.preventDefault();
      this.addRecipient();
    } else if (ev.key === 'Backspace' && !this.recipientDraft && this.editing.recipients.length > 0) {
      // Backspace on empty input removes last chip
      this.editing.recipients.pop();
    }
  }

  addRecipient(): void {
    const email = this.recipientDraft.trim().replace(/,$/, '');
    if (!email) return;
    if (!this.isValidEmail(email)) {
      alert('Please enter a valid email address.');
      return;
    }
    if (this.editing.recipients.indexOf(email) === -1) {
      this.editing.recipients.push(email);
    }
    this.recipientDraft = '';
  }

  removeRecipient(idx: number): void {
    this.editing.recipients.splice(idx, 1);
  }

  private isValidEmail(s: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  // ────────────────────────────────────────────────
  // Schedule summary + next-run computation
  // ────────────────────────────────────────────────
  frequencyLabel(s: ReportSchedule): string {
    const t = s.timeOfDay || '06:00';
    if (s.frequency === 'daily') return `Daily at ${t}`;
    if (s.frequency === 'weekly') {
      const days = (s.daysOfWeek || []).map(d => this.weekDays[d]?.short || '?').join(', ');
      return `Weekly · ${days || '—'} at ${t}`;
    }
    if (s.frequency === 'monthly') {
      return `Monthly on day ${s.dayOfMonth || 1} at ${t}`;
    }
    if (s.frequency === 'custom') return `Custom: ${s.cron || '—'}`;
    return '—';
  }

  formatDateTime(iso?: string): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const dd = ('0' + d.getDate()).slice(-2);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const mmm = months[d.getMonth()];
      const yy = String(d.getFullYear()).slice(-2);
      const hh = ('0' + d.getHours()).slice(-2);
      const mi = ('0' + d.getMinutes()).slice(-2);
      return dd + '-' + mmm + '-' + yy + ' ' + hh + ':' + mi;
    } catch { return iso; }
  }

  formatInt(n: number | undefined): string {
    if (n == null) return '0';
    return Number(n).toLocaleString('en-US');
  }

  formatLabel(f: ScheduleFormat): string {
    return ({ pdf: 'PDF', xlsx: 'Excel', csv: 'CSV', html: 'HTML' } as Record<string,string>)[f] || f;
  }

  recipientsSummary(s: ReportSchedule): string {
    if (!s.recipients || s.recipients.length === 0) return '—';
    if (s.recipients.length === 1) return s.recipients[0];
    return `${s.recipients[0]} +${s.recipients.length - 1}`;
  }

  private computeNextRun(s: ReportSchedule): string {
    const now = new Date();
    const [hh, mm] = (s.timeOfDay || '06:00').split(':').map(n => parseInt(n, 10) || 0);

    if (s.frequency === 'daily') {
      const d = new Date(now);
      d.setHours(hh, mm, 0, 0);
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
      return d.toISOString();
    }

    if (s.frequency === 'weekly') {
      const days = (s.daysOfWeek && s.daysOfWeek.length) ? s.daysOfWeek : [1];
      for (let i = 0; i < 14; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() + i);
        d.setHours(hh, mm, 0, 0);
        if (days.indexOf(d.getDay()) >= 0 && d.getTime() > now.getTime()) {
          return d.toISOString();
        }
      }
    }

    if (s.frequency === 'monthly') {
      const day = s.dayOfMonth || 1;
      const d = new Date(now);
      d.setDate(day);
      d.setHours(hh, mm, 0, 0);
      if (d.getTime() <= now.getTime()) {
        d.setMonth(d.getMonth() + 1);
        d.setDate(day);
      }
      return d.toISOString();
    }

    return '';
  }

  private makeBlank(): ReportSchedule {
    return {
      id: '',
      reportId: '',
      reportName: '',
      name: '',
      active: true,
      frequency: 'daily',
      timeOfDay: '06:00',
      timezone: 'Asia/Muscat',
      recipients: [],
      format: 'pdf',
      subject: '',
      body: '',
      runCount: 0,
      createdAt: '',
      updatedAt: ''
    };
  }

  trackById = (_: number, item: ReportSchedule) => item.id;
}
