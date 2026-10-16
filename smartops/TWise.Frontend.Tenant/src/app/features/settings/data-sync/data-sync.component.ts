import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, HostListener, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { DatasetRefreshStatus, RefreshJob, RefreshSchedule, RefreshService } from '../../../core/services/refresh.service';
import { ClientSideRowModelModule, ColDef, ModuleRegistry, RowSelectionModule, RowSelectionOptions, SelectionColumnDef, themeQuartz } from 'ag-grid-community';
import { JobStatusCellRendererComponent, STATUS_STYLE } from './cell-renderers/job-status-cell-renderer.component';
import { JobActionsCellRendererComponent } from './cell-renderers/job-actions-cell-renderer.component';
import { RecurringActionsCellRendererComponent } from './cell-renderers/recurring-actions-cell-renderer.component';
import { LOG_STATUS_STYLE } from './cell-renderers/log-status-cell-renderer.component';
import { PermissionService } from '../../../core/services/permission.service';

ModuleRegistry.registerModules([ClientSideRowModelModule, RowSelectionModule]);

const gridTheme = themeQuartz.withParams({
    accentColor: '#21409A',
    backgroundColor: '#ffffff',
    borderColor: '#dfe6e9',
    borderRadius: 8,
    checkboxBorderRadius: 4,
    fontFamily: 'Inter, sans-serif',
    headerBackgroundColor: '#ffffff',
    headerTextColor: '#344054',
    headerFontWeight: 700,
    rowHoverColor: '#F5F8FF',
    wrapperBorder: false,
    wrapperBorderRadius: 0,
});

const rowSelection: RowSelectionOptions = {
    mode: 'multiRow',
    checkboxes: true,
    headerCheckbox: true,
    enableClickSelection: false,
};

const selectionColumnDef: SelectionColumnDef = {
    width: 48,
    maxWidth: 48,
    minWidth: 48,
    suppressHeaderMenuButton: true,
    suppressMovable: true,
};

export type SyncJobStatus = 'queued' | 'processing' | 'scheduled' | 'succeeded' | 'failed' | 'deleted' | 'awaiting';
export type ScheduleFrequency = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'monthly';

export interface SyncJob {
    /** Database id, used for retry. The displayed `id` is the human job code. */
    jobId: number;
    id: string;
    jobProcess: string;
    status: SyncJobStatus;
    started: string;
    completed: string;
    duration: string;
    createdDate: string;
}

export interface RecurringSyncJob {
    /** Database id, used for run/edit/delete. */
    scheduleId: number;
    scheduleName: string;
    jobProcess: string;
    frequency: string;
    cronExpression: string;
    timeZone: string;
    nextRun: string;
    lastRun: string;
    createdDate: string;
}

export type JobSyncLogStatus = 'succeeded' | 'partial' | 'failed';

export interface JobSyncLogFieldMapping {
    source: string;
    target: string;
}

export interface JobSyncLogIssue {
    message: string;
    count: number;
}

export interface JobSyncLogRow {
    sourceTable: string;
    targetTable: string;
    read: number;
    inserted: number;
    updated: number;
    skipped: number;
    failed: number;
    status: JobSyncLogStatus;
    fieldMappings: JobSyncLogFieldMapping[];
    issues: JobSyncLogIssue[];
}

export interface JobTimelineEvent {
    time: string;
    title: string;
    description: string;
    state: 'success' | 'warning' | 'error';
}

type DataSyncTab = 'jobs' | 'recurring';

/** Server statuses are a subset of the grid's; the rest are legacy display-only values. */
const SERVER_STATUSES: SyncJobStatus[] = ['queued', 'processing', 'succeeded', 'failed'];

const STATUS_LABELS: Record<SyncJobStatus, string> = {
    queued: 'Queued',
    processing: 'Processing',
    scheduled: 'Scheduled',
    succeeded: 'Succeeded',
    failed: 'Failed',
    deleted: 'Deleted',
    awaiting: 'Awaiting',
};

@Component({
    selector: 'app-data-sync',
    standalone: false,
    templateUrl: './data-sync.component.html',
    styleUrls: ['./data-sync.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataSyncComponent implements OnInit {
    private readonly permissions = inject(PermissionService);

    get canCreate(): boolean {
        return this.permissions.canView('settings.data-sync') && this.permissions.canCreate('settings.data-sync');
    }

    get canModify(): boolean {
        return this.permissions.canView('settings.data-sync') && this.permissions.canModify('settings.data-sync');
    }

    readonly gridTheme = gridTheme;
    readonly rowSelection = rowSelection;
    readonly selectionColumnDef = selectionColumnDef;

    readonly defaultColDef: ColDef = {
        sortable: true,
        resizable: true,
        flex: 1,
    };

    readonly jobColumnDefs: ColDef<SyncJob>[] = [
        { headerName: 'Job ID', field: 'id', minWidth: 120, cellClass: 'data-sync-table__id-cell' },
        { headerName: 'Job / Process', field: 'jobProcess', minWidth: 150 },
        { headerName: 'Status', field: 'status', cellRenderer: JobStatusCellRendererComponent, minWidth: 140 },
        { headerName: 'Started', field: 'started', minWidth: 150 },
        { headerName: 'Completed', field: 'completed', minWidth: 150 },
        { headerName: 'Duration', field: 'duration', minWidth: 110 },
        { headerName: 'Created Date', field: 'createdDate', minWidth: 160 },
        { headerName: 'Actions', sortable: false, filter: false, cellRenderer: JobActionsCellRendererComponent, minWidth: 200, maxWidth: 200 },
    ];

    readonly recurringColumnDefs: ColDef<RecurringSyncJob>[] = [
        { headerName: 'Schedule Name', field: 'scheduleName', minWidth: 200 },
        { headerName: 'Job / Process', field: 'jobProcess', minWidth: 140 },
        { headerName: 'Frequency', field: 'frequency', minWidth: 140 },
        {
            headerName: 'Cron Expression', field: 'cronExpression', minWidth: 130,
            cellRenderer: (p: { value?: string }) => `<span class="data-sync-cron">${p.value ?? ''}</span>`
        },
        { headerName: 'Time Zone', field: 'timeZone', minWidth: 100 },
        { headerName: 'Next Run', field: 'nextRun', minWidth: 150 },
        { headerName: 'Last Run', field: 'lastRun', minWidth: 150 },
        { headerName: 'Created Date', field: 'createdDate', minWidth: 160 },
        { headerName: 'Actions', sortable: false, filter: false, cellRenderer: RecurringActionsCellRendererComponent, minWidth: 240, maxWidth: 240 },
    ];

    get gridContext() {
        return {
            canModify: () => this.canModify,
            onCopyJobId: (job: SyncJob) => this.copyJobId(job),
            onViewJobDetails: (job: SyncJob) => this.openJobDetails(job),
            onRetryJob: (job: SyncJob) => this.retryJob(job),
            onEditRecurring: (row: RecurringSyncJob) => this.editRecurring(row),
            onRunRecurring: (row: RecurringSyncJob) => this.runRecurring(row),
            onDeleteRecurring: (row: RecurringSyncJob) => this.deleteRecurring(row),
        };
    }

    activeTab: DataSyncTab = 'jobs';
    loading = false;

    searchTerm = '';
    statusFilter = 'All Status';
    timeFilter = 'All Time';
    frequencyFilter = 'All frequencies';
    openFilterName: string | null = null;

    readonly statusOptions = ['All Status', ...Object.values(STATUS_LABELS)];
    readonly timeOptions = ['All Time', 'Today', 'Last 7 days', 'Last 30 days'];
    readonly frequencyOptions = ['All frequencies', 'Every 5 minutes', 'Hourly', 'Daily', 'Weekly'];

    jobs: SyncJob[] = [];

    recurringJobs: RecurringSyncJob[] = [];

    private readonly api = inject(RefreshService);
    private readonly destroyRef = inject(DestroyRef);

    /** Surfaced under the toolbar when a load or action fails. */
    errorMessage = '';

    constructor(private readonly cdr: ChangeDetectorRef) { }

    ngOnInit(): void {
        this.reload();
    }

    /** Loads both tabs together so the grid is never half-populated. */
    reload(): void {
        this.loading = true;
        this.errorMessage = '';

        forkJoin({
            jobs: this.api.getJobs(),
            schedules: this.api.getSchedules(),
            datasets: this.api.getDatasetStatuses(),
        })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: ({ jobs, schedules, datasets }) => {
                    this.jobs = jobs.map(j => this.toSyncJob(j));
                    this.recurringJobs = schedules.map(s => this.toRecurringJob(s));
                    this.refreshTargets = datasets.filter(d => d.dataSourceConnectionId != null);
                    this.loading = false;
                    this.cdr.markForCheck();
                },
                error: (err) => {
                    this.loading = false;
                    this.errorMessage = this.readError(err, 'Failed to load sync data.');
                    this.cdr.markForCheck();
                },
            });
    }

    private toSyncJob(j: RefreshJob): SyncJob {
        return {
            jobId: j.id,
            id: j.jobCode,
            jobProcess: j.jobProcess,
            // Server statuses are a subset of the grid's; anything unexpected shows as queued
            // rather than breaking the status renderer.
            status: SERVER_STATUSES.includes(j.status) ? j.status : 'queued',
            started: this.formatDateTime(j.startedAt),
            completed: this.formatDateTime(j.completedAt),
            duration: this.formatDuration(j.durationMs),
            createdDate: this.formatDateTime(j.queuedAt, true),
        };
    }

    private toRecurringJob(s: RefreshSchedule): RecurringSyncJob {
        return {
            scheduleId: s.id,
            scheduleName: s.scheduleName,
            jobProcess: s.dataSourceName ?? s.datasetName ?? '—',
            frequency: s.frequencyLabel ?? s.cronExpression,
            cronExpression: s.cronExpression,
            timeZone: s.timeZoneId,
            // A disabled schedule has no next run; say so rather than showing an empty cell.
            nextRun: s.isEnabled ? this.formatDateTime(s.nextRunAt) : 'Disabled',
            lastRun: this.formatDateTime(s.lastRunAt),
            createdDate: this.formatDateTime(s.createdAt, true),
        };
    }

    private formatDateTime(iso?: string | null, withYear = false): string {
        if (!iso) return '—';

        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return '—';

        return date.toLocaleString(undefined, {
            day: 'numeric',
            month: 'short',
            ...(withYear ? { year: 'numeric' } : {}),
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    private formatDuration(ms?: number | null): string {
        if (ms === null || ms === undefined) return '—';
        if (ms < 1000) return `${ms} ms`;

        const seconds = ms / 1000;
        return seconds < 60 ? `${seconds.toFixed(1)} sec` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    }

    private readError(err: unknown, fallback: string): string {
        const body = (err as { error?: { error?: string; message?: string } })?.error;
        return body?.error ?? body?.message ?? fallback;
    }

    get breadcrumbs() {
        return [
            { label: 'Home', route: '/' },
            { label: 'Settings', route: '/settings' },
            { label: 'Data Sync' },
        ];
    }

    get statusCounts(): Record<SyncJobStatus, number> {
        const counts: Record<SyncJobStatus, number> = {
            queued: 0, processing: 0, scheduled: 0, succeeded: 0, failed: 0, deleted: 0, awaiting: 0,
        };
        for (const job of this.jobs) counts[job.status]++;
        return counts;
    }

    get filteredJobs(): SyncJob[] {
        const term = this.searchTerm.trim().toLowerCase();
        return this.jobs.filter(job => {
            const matchesTerm = !term || job.id.toLowerCase().includes(term) || job.jobProcess.toLowerCase().includes(term);
            const matchesStatus = this.statusFilter === 'All Status' || STATUS_LABELS[job.status] === this.statusFilter;
            return matchesTerm && matchesStatus;
        });
    }

    get filteredRecurringJobs(): RecurringSyncJob[] {
        const term = this.searchTerm.trim().toLowerCase();
        return this.recurringJobs.filter(row => {
            const matchesTerm = !term || row.scheduleName.toLowerCase().includes(term) || row.jobProcess.toLowerCase().includes(term);
            const matchesFrequency = this.frequencyFilter === 'All frequencies' || row.frequency === this.frequencyFilter;
            return matchesTerm && matchesFrequency;
        });
    }

    statusLabel(status: SyncJobStatus): string {
        return STATUS_LABELS[status];
    }

    // ── Pagination ────────────────────────────────────────────
    pageSize = 20;
    currentPage = 1;

    private get activeFilteredLength(): number {
        return this.activeTab === 'jobs' ? this.filteredJobs.length : this.filteredRecurringJobs.length;
    }

    get totalPages(): number {
        return Math.max(1, Math.ceil(this.activeFilteredLength / this.pageSize));
    }

    get rangeStart(): number {
        return this.activeFilteredLength === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
    }

    get rangeEnd(): number {
        return Math.min(this.currentPage * this.pageSize, this.activeFilteredLength);
    }

    get pagedJobs(): SyncJob[] {
        const start = (this.currentPage - 1) * this.pageSize;
        return this.filteredJobs.slice(start, start + this.pageSize);
    }

    get pagedRecurringJobs(): RecurringSyncJob[] {
        const start = (this.currentPage - 1) * this.pageSize;
        return this.filteredRecurringJobs.slice(start, start + this.pageSize);
    }

    goToFirstPage(): void { this.currentPage = 1; this.cdr.markForCheck(); }
    goToPrevPage(): void { this.currentPage = Math.max(1, this.currentPage - 1); this.cdr.markForCheck(); }
    goToNextPage(): void { this.currentPage = Math.min(this.totalPages, this.currentPage + 1); this.cdr.markForCheck(); }
    goToLastPage(): void { this.currentPage = this.totalPages; this.cdr.markForCheck(); }

    setTab(tab: DataSyncTab): void {
        this.activeTab = tab;
        this.openFilterName = null;
        this.currentPage = 1;
        this.cdr.markForCheck();
    }

    @HostListener('document:click')
    onDocumentClick(): void {
        if (this.openFilterName) { this.openFilterName = null; this.cdr.markForCheck(); }
        if (this.scheduleOpenDropdown) { this.scheduleOpenDropdown = null; this.cdr.markForCheck(); }
    }

    toggleFilterDropdown(name: string, event: Event): void {
        event.stopPropagation();
        this.openFilterName = this.openFilterName === name ? null : name;
        this.cdr.markForCheck();
    }

    selectStatusFilter(value: string, event?: Event): void {
        event?.stopPropagation();
        this.statusFilter = value;
        this.openFilterName = null;
        this.currentPage = 1;
        this.cdr.markForCheck();
    }

    selectTimeFilter(value: string, event?: Event): void {
        event?.stopPropagation();
        this.timeFilter = value;
        this.openFilterName = null;
        this.currentPage = 1;
        this.cdr.markForCheck();
    }

    selectFrequencyFilter(value: string, event?: Event): void {
        event?.stopPropagation();
        this.frequencyFilter = value;
        this.openFilterName = null;
        this.currentPage = 1;
        this.cdr.markForCheck();
    }

    refresh(): void {
        this.loading = true;
        this.cdr.markForCheck();
        setTimeout(() => { this.loading = false; this.cdr.markForCheck(); }, 500);
    }

    runAgain(): void {
        if (!this.canModify) return;
        this.refresh();
    }

    retryJob(job: SyncJob, event?: Event): void {
        if (!this.canModify) return;
        event?.stopPropagation();

        // Optimistic, so the row reacts immediately; reload() reconciles with the real outcome.
        job.status = 'processing';
        this.errorMessage = '';
        this.cdr.markForCheck();

        this.api.retryJob(job.jobId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                // A retry creates a NEW job, so the whole list is reloaded rather than patched.
                next: () => this.reload(),
                error: (err) => {
                    job.status = 'failed';
                    this.errorMessage = this.readError(err, 'Retry failed.');
                    this.cdr.markForCheck();
                },
            });
    }

    copyJobId(job: SyncJob, event?: Event): void {
        event?.stopPropagation();
        navigator.clipboard?.writeText(job.id);
    }

    // ── Job details modal ────────────────────────────────
    showJobDetailsModal = false;
    selectedJobForDetails: SyncJob | null = null;
    jobLogsSearch = '';
    jobLogsStatusFilter: 'all' | JobSyncLogStatus = 'all';

    readonly jobDetailsSummary = { tables: 4, recordsRead: 8640, inserted: 160, updated: 8360, skipped: 80, failed: 20 };

    private readonly defaultLogFieldMappings: JobSyncLogFieldMapping[] = [
        { source: 'crew_id', target: 'id' },
        { source: 'crew_id', target: 'id' },
        { source: 'crew_id', target: 'id' },
    ];

    private readonly defaultLogIssues: JobSyncLogIssue[] = [
        { message: 'Missing crew ID', count: 6 },
        { message: 'Missing crew ID', count: 6 },
    ];

    readonly jobDetailsLogs: JobSyncLogRow[] = [
        { sourceTable: 'src.customers', targetTable: 'core.customers', read: 4320, inserted: 80, updated: 4180, skipped: 40, failed: 20, status: 'partial', fieldMappings: this.defaultLogFieldMappings, issues: this.defaultLogIssues },
        { sourceTable: 'src.customers', targetTable: 'core.customers', read: 4320, inserted: 80, updated: 4180, skipped: 40, failed: 0, status: 'succeeded', fieldMappings: this.defaultLogFieldMappings, issues: [] },
        { sourceTable: 'src.customers', targetTable: 'core.customers', read: 4320, inserted: 80, updated: 4180, skipped: 40, failed: 0, status: 'succeeded', fieldMappings: this.defaultLogFieldMappings, issues: [] },
        { sourceTable: 'src.customers', targetTable: 'core.customers', read: 4320, inserted: 80, updated: 4180, skipped: 40, failed: 0, status: 'succeeded', fieldMappings: this.defaultLogFieldMappings, issues: [] },
        { sourceTable: 'src.customers', targetTable: 'core.customers', read: 4320, inserted: 80, updated: 4180, skipped: 40, failed: 0, status: 'succeeded', fieldMappings: this.defaultLogFieldMappings, issues: [] },
        { sourceTable: 'src.customers', targetTable: 'core.customers', read: 4320, inserted: 80, updated: 4180, skipped: 40, failed: 0, status: 'succeeded', fieldMappings: this.defaultLogFieldMappings, issues: [] },
        { sourceTable: 'src.customers', targetTable: 'core.customers', read: 4320, inserted: 80, updated: 4180, skipped: 40, failed: 0, status: 'succeeded', fieldMappings: this.defaultLogFieldMappings, issues: [] },
    ];

    readonly expandedLogRows = new Set<number>();

    readonly jobDetailsTimeline: JobTimelineEvent[] = [
        { time: '11:57:02', title: 'Sync started', description: 'Execution JB-1208 started successfully.', state: 'success' },
        { time: '11:57:02', title: 'Source connected', description: 'Connection to the source system was established.', state: 'success' },
        { time: '11:57:02', title: 'Customer table started', description: '2,140 records read.', state: 'success' },
        { time: '11:57:02', title: 'Customer table completed with issues', description: '20 records could not be synchronized.', state: 'warning' },
        { time: '11:57:02', title: 'Source connected', description: 'Connection to the source system was established.', state: 'success' },
        { time: '11:57:02', title: 'Source connected', description: 'Connection to the source system was established.', state: 'success' },
    ];

    get filteredJobDetailsLogs(): JobSyncLogRow[] {
        const q = this.jobLogsSearch.trim().toLowerCase();
        return this.jobDetailsLogs.filter(l => {
            const matchesStatus = this.jobLogsStatusFilter === 'all' || l.status === this.jobLogsStatusFilter;
            const matchesSearch = !q || l.sourceTable.toLowerCase().includes(q) || l.targetTable.toLowerCase().includes(q);
            return matchesStatus && matchesSearch;
        });
    }

    openJobDetails(job: SyncJob, event?: Event): void {
        event?.stopPropagation();
        this.selectedJobForDetails = job;
        this.jobLogsSearch = '';
        this.jobLogsStatusFilter = 'all';
        this.expandedLogRows.clear();
        this.showJobDetailsModal = true;
        this.cdr.markForCheck();
    }

    closeJobDetailsModal(): void {
        this.showJobDetailsModal = false;
        this.cdr.markForCheck();
    }

    selectJobLogsStatusFilter(value: 'all' | JobSyncLogStatus): void {
        this.jobLogsStatusFilter = value;
        this.expandedLogRows.clear();
        this.cdr.markForCheck();
    }

    onJobLogsSearchChange(): void {
        this.expandedLogRows.clear();
        this.cdr.markForCheck();
    }

    isLogRowExpanded(index: number): boolean {
        return this.expandedLogRows.has(index);
    }

    toggleLogRow(index: number): void {
        if (this.expandedLogRows.has(index)) {
            this.expandedLogRows.delete(index);
        } else {
            this.expandedLogRows.add(index);
        }
        this.cdr.markForCheck();
    }

    jobStatusStyle(status: SyncJobStatus) {
        return STATUS_STYLE[status];
    }

    logStatusStyle(status: JobSyncLogStatus) {
        return LOG_STATUS_STYLE[status];
    }

    createSchedule(): void {
        if (!this.canCreate) return;
        this.openCreateScheduleModal();
    }

    // ── Create Schedule modal ────────────────────────────────
    showCreateScheduleModal = false;
    showAdvancedScheduleDetails = false;
    scheduleName = '';
    scheduleJobProcess = '';
    scheduleFrequency: ScheduleFrequency = 'minutes';
    scheduleRunEvery = '';
    scheduleRunAt = '';
    scheduleDayOfMonth = '';
    scheduleWeekDays: string[] = [];
    scheduleTimeZone = 'UTC';

    readonly frequencyTypes: { value: ScheduleFrequency; label: string; sub: string }[] = [
        { value: 'minutes', label: 'Minutes', sub: 'Every few minutes' },
        { value: 'hourly', label: 'Hourly', sub: 'Every few hours' },
        { value: 'daily', label: 'Daily', sub: 'At a time each day' },
        { value: 'weekly', label: 'Weekly', sub: 'On selected weekdays' },
        { value: 'monthly', label: 'Monthly', sub: 'On a day each month' },
    ];

    readonly runEveryOptionsByFrequency: Record<ScheduleFrequency, string[]> = {
        minutes: ['1', '5', '10', '15', '30'],
        hourly: ['1', '2', '3', '6', '12'],
        daily: [],
        weekly: [],
        monthly: [],
    };

    readonly dayOfMonthOptions: string[] = [
        ...Array.from({ length: 31 }, (_, i) => this.ordinal(i + 1)),
        'Last day',
    ];

    readonly weekDayOptions: { value: string; label: string }[] = [
        { value: 'sun', label: 'Sun' },
        { value: 'mon', label: 'Mon' },
        { value: 'tue', label: 'Tue' },
        { value: 'wed', label: 'Wed' },
        { value: 'thu', label: 'Thu' },
        { value: 'fri', label: 'Fri' },
        { value: 'sat', label: 'Sat' },
    ];

    readonly scheduleTimeZoneOptions = ['UTC', 'GMT', 'IST', 'EST', 'PST'];
    /**
     * Datasets that can actually be refreshed — i.e. those that came from a connector.
     * An uploaded file has no source to re-fetch from, so it is not a valid schedule target.
     */
    refreshTargets: DatasetRefreshStatus[] = [];

    get scheduleJobProcessOptions(): string[] {
        return this.refreshTargets.map(t => t.datasetName);
    }

    private get selectedTarget(): DatasetRefreshStatus | undefined {
        return this.refreshTargets.find(t => t.datasetName === this.scheduleJobProcess);
    }

    private ordinal(n: number): string {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
    }

    get scheduleShowsRunEvery(): boolean {
        return this.scheduleFrequency === 'minutes' || this.scheduleFrequency === 'hourly';
    }

    get scheduleShowsRunAt(): boolean {
        return this.scheduleFrequency === 'daily' || this.scheduleFrequency === 'weekly' || this.scheduleFrequency === 'monthly';
    }

    get scheduleShowsDayOfMonth(): boolean {
        return this.scheduleFrequency === 'monthly';
    }

    get scheduleShowsWeekDays(): boolean {
        return this.scheduleFrequency === 'weekly';
    }

    get scheduleShowsHint(): boolean {
        return this.scheduleFrequency === 'minutes' || this.scheduleFrequency === 'hourly';
    }

    get scheduleHintText(): string {
        return this.scheduleFrequency === 'hourly'
            ? 'Runs at minute 00 of the matching hour.'
            : 'Choose a sensible interval to avoid unnecessary load.';
    }

    toggleScheduleWeekDay(day: string): void {
        const idx = this.scheduleWeekDays.indexOf(day);
        if (idx > -1) {
            this.scheduleWeekDays.splice(idx, 1);
        } else {
            this.scheduleWeekDays.push(day);
        }
        this.cdr.markForCheck();
    }

  scheduleOpenDropdown: string | null = null;

  toggleScheduleDropdown(name: string, event: Event): void {
    event.stopPropagation();
    this.scheduleOpenDropdown = this.scheduleOpenDropdown === name ? null : name;
    this.cdr.markForCheck();
  }

  selectScheduleJobProcess(value: string, event?: Event): void {
    event?.stopPropagation();
    this.scheduleJobProcess = value;
    this.scheduleOpenDropdown = null;
    this.cdr.markForCheck();
  }

  selectScheduleRunEvery(value: string, event?: Event): void {
    event?.stopPropagation();
    this.scheduleRunEvery = value;
    this.scheduleOpenDropdown = null;
    this.cdr.markForCheck();
  }

  selectScheduleDayOfMonth(value: string, event?: Event): void {
    event?.stopPropagation();
    this.scheduleDayOfMonth = value;
    this.scheduleOpenDropdown = null;
    this.cdr.markForCheck();
  }

  selectScheduleTimeZone(value: string, event?: Event): void {
    event?.stopPropagation();
    this.scheduleTimeZone = value;
    this.scheduleOpenDropdown = null;
    this.cdr.markForCheck();
  }
  get scheduleRunsLabel(): string {
    const n = this.scheduleRunEvery;
    switch (this.scheduleFrequency) {
      case 'minutes': return `Every ${n || '5'} minutes`;
      case 'hourly':  return `Every ${n || '1'} hour(s)`;
      case 'daily':   return `Daily at ${this.scheduleRunAt || '00:00'}`;
      case 'weekly': {
        const labels = this.weekDayOptions.filter(d => this.scheduleWeekDays.includes(d.value)).map(d => d.label);
                return `Weekly on ${labels.length ? labels.join(', ') : 'Monday'} at ${this.scheduleRunAt || '00:00'}`;
            }
            case 'monthly': return `Monthly on the ${this.scheduleDayOfMonth || '1st'} at ${this.scheduleRunAt || '00:00'}`;
            default: return '';
        }
    }

    get scheduleCronExpression(): string {
        const [hh, mm] = (this.scheduleRunAt || '00:00').split(':');
        switch (this.scheduleFrequency) {
            case 'minutes': return `*/${this.scheduleRunEvery || '5'} * * * *`;
            case 'hourly': return `0 */${this.scheduleRunEvery || '1'} * * *`;
            case 'daily': return `${mm} ${hh} * * *`;
            case 'weekly': {
                const dayIndex: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
                const days = this.scheduleWeekDays.length
                    ? this.scheduleWeekDays.map(d => dayIndex[d]).sort((a, b) => a - b).join(',')
                    : '1';
                return `${mm} ${hh} * * ${days}`;
            }
            case 'monthly': {
                const day = this.scheduleDayOfMonth === 'Last day' ? 'L' : parseInt(this.scheduleDayOfMonth, 10) || 1;
                return `${mm} ${hh} ${day} * *`;
            }
            default: return '';
        }
    }

    readonly scheduleNextRunLabel = '16 Sept, 16:31';

    get canSubmitSchedule(): boolean {
        if (!this.canCreate) return false;
        if (!this.scheduleName.trim() || !this.scheduleJobProcess || !this.scheduleTimeZone) return false;
        if (this.scheduleShowsRunAt && !this.scheduleRunAt) return false;
        if (this.scheduleShowsWeekDays && this.scheduleWeekDays.length === 0) return false;
        return true;
    }

    openCreateScheduleModal(): void {
        if (!this.canCreate) return;
        this.scheduleName = '';
        this.scheduleJobProcess = '';
        this.scheduleFrequency = 'minutes';
        this.scheduleRunEvery = '';
        this.scheduleRunAt = '';
        this.scheduleDayOfMonth = '';
        this.scheduleWeekDays = [];
        this.scheduleTimeZone = 'UTC';
        this.scheduleOpenDropdown = null;
        this.showAdvancedScheduleDetails = false;
        this.showCreateScheduleModal = true;
        this.cdr.markForCheck();
    }

    closeCreateScheduleModal(): void {
        this.showCreateScheduleModal = false;
        this.cdr.markForCheck();
    }

    selectScheduleFrequency(freq: ScheduleFrequency): void {
        this.scheduleFrequency = freq;
        this.scheduleRunEvery = '';
        this.scheduleRunAt = '';
        this.scheduleDayOfMonth = '';
        this.scheduleWeekDays = [];
        this.scheduleOpenDropdown = null;
        this.cdr.markForCheck();
    }

    toggleAdvancedScheduleDetails(): void {
        this.showAdvancedScheduleDetails = !this.showAdvancedScheduleDetails;
        this.cdr.markForCheck();
    }

    submitCreateSchedule(): void {
        if (!this.canSubmitSchedule) return;

        const target = this.selectedTarget;
        if (!target?.dataSourceConnectionId) {
            this.errorMessage = 'Choose a dataset that came from a data source — uploaded files cannot be refreshed.';
            this.cdr.markForCheck();
            return;
        }

        this.errorMessage = '';

        this.api.createSchedule({
            scheduleName: this.scheduleName.trim(),
            dataSourceConnectionId: target.dataSourceConnectionId,
            importedDatasetId: target.datasetId,
            cronExpression: this.scheduleCronExpression,
            objectRef: target.sourceObjectRef ?? null,
            timeZoneId: this.scheduleTimeZone,
            frequencyLabel: this.scheduleRunsLabel,
            refreshMode: 'full',
            isEnabled: true,
        })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    this.closeCreateScheduleModal();
                    this.reload();
                },
                error: (err) => {
                    // The server validates the cron against the time zone, so its message is
                    // more precise than anything the form can infer.
                    this.errorMessage = this.readError(err, 'Could not create this schedule.');
                    this.cdr.markForCheck();
                },
            });
    }

    /** Runs a schedule now. This is an extra run — its next fire time is unchanged. */
    runRecurring(row: RecurringSyncJob, event?: Event): void {
        if (!this.canModify) return;
        event?.stopPropagation();
        this.errorMessage = '';

        this.api.runSchedule(row.scheduleId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (job) => {
                    if (job.status === 'failed') {
                        this.errorMessage = job.errorMessage ?? `Refresh ${job.jobCode} failed.`;
                    }
                    this.reload();
                },
                error: (err) => {
                    this.errorMessage = this.readError(err, 'Could not run this schedule.');
                    this.cdr.markForCheck();
                },
            });
    }

    editRecurring(row: RecurringSyncJob, event?: Event): void {
        if (!this.canModify) return;
        event?.stopPropagation();
    }

    deleteRecurring(row: RecurringSyncJob, event?: Event): void {
        if (!this.canModify) return;
        event?.stopPropagation();
        this.errorMessage = '';

        this.api.deleteSchedule(row.scheduleId)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: () => {
                    // Removed locally first so the grid responds without waiting for a reload.
                    this.recurringJobs = this.recurringJobs.filter(r => r.scheduleId !== row.scheduleId);
                    this.cdr.markForCheck();
                },
                error: (err) => {
                    this.errorMessage = this.readError(err, 'Could not delete this schedule.');
                    this.cdr.markForCheck();
                },
            });
    }
}
