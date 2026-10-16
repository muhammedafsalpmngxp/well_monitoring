import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { PermissionService } from '../../../core/services/permission.service';
import { SCHEDULES_MODULE, ScheduleDto, ScheduleService, TargetType } from '../../../core/services/schedule.service';
import { TARGET_LABELS } from '../../../shared/schedule-dialog/schedule-dialog.component';
import { describeRecurrence, formatInZone, fromCron, utcToZoned } from '../../../shared/schedule-dialog/recurrence.util';
import { apiErrorMessage } from '../../model-studio/model-studio.util';

type StatusFilter = 'All' | 'Active' | 'Paused' | 'Failed';

/** Smart Alerts > Schedules: every scheduled delivery, with pause, resume, run now, edit and delete; and the mail groups tab. */
@Component({
  selector: 'app-schedules',
  standalone: false,
  templateUrl: './schedules.component.html',
  styleUrls: ['./delivery-pages.scss', './schedules.component.scss'],
})
export class SchedulesComponent implements OnInit, OnDestroy {
  schedules: ScheduleDto[] = [];
  loading = true;
  error = '';
  toast: { kind: 'success' | 'error'; text: string } | null = null;
  tab: 'schedules' | 'groups' = 'schedules';

  search = '';
  typeFilter: TargetType | 'All' = 'All';
  statusFilter: StatusFilter = 'All';
  readonly types: (TargetType | 'All')[] = ['All', 'Report', 'Dashboard', 'Canvas'];
  readonly statuses: StatusFilter[] = ['All', 'Active', 'Paused', 'Failed'];
  readonly targetLabels = TARGET_LABELS;

  /** The dialog: open with editing null to create. */
  dialogOpen = false;
  editing: ScheduleDto | null = null;
  pendingDelete: ScheduleDto | null = null;
  pendingRun: ScheduleDto | null = null;
  /** The schedule an action is running on. */
  busyId: number | null = null;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private readonly userId: number | null;

  constructor(
    private readonly service: ScheduleService,
    private readonly permissions: PermissionService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
    auth: AuthService,
  ) {
    this.userId = auth.getCurrentUser()?.userId ?? null;
  }

  get canCreate(): boolean { return this.permissions.canCreate(SCHEDULES_MODULE); }

  /** The owner may change their own schedule; modify lets anyone change any. */
  canChange(s: ScheduleDto): boolean {
    return this.permissions.canModify(SCHEDULES_MODULE) || s.ownerUserId === this.userId;
  }

  get shown(): ScheduleDto[] {
    const term = this.search.trim().toLowerCase();
    return this.schedules.filter(s =>
      (this.typeFilter === 'All' || s.targetType === this.typeFilter)
      && (this.statusFilter === 'All'
        || (this.statusFilter === 'Active' && s.isActive)
        || (this.statusFilter === 'Paused' && !s.isActive)
        || (this.statusFilter === 'Failed' && s.lastStatus === 'Failed'))
      && (!term || `${s.name} ${s.targetName ?? ''} ${s.ownerName ?? ''}`.toLowerCase().includes(term)));
  }

  get stats(): { label: string; value: number; tone: string; filter: StatusFilter | null; mark: string }[] {
    const dayAhead = Date.now() + 24 * 3600 * 1000;
    return [
      { label: 'Active', value: this.schedules.filter(s => s.isActive).length, tone: 'good', filter: 'Active', mark: 'A' },
      { label: 'Paused', value: this.schedules.filter(s => !s.isActive).length, tone: 'warn', filter: 'Paused', mark: 'P' },
      { label: 'Last run failed', value: this.schedules.filter(s => s.lastStatus === 'Failed').length, tone: 'bad', filter: 'Failed', mark: '!' },
      {
        label: 'Due in the next 24 hours', tone: '', filter: null, mark: '24',
        value: this.schedules.filter(s => s.isActive && s.nextRunAt && Date.parse(s.nextRunAt) <= dayAhead).length,
      },
    ];
  }

  ngOnInit(): void {
    this.service.list().subscribe({
      next: list => { this.schedules = list; this.loading = false; this.cdr.markForCheck(); },
      error: err => { this.error = apiErrorMessage(err, 'Schedules could not be loaded.'); this.loading = false; this.cdr.markForCheck(); },
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.toastTimer);
  }

  summary(s: ScheduleDto): string {
    const rec = fromCron(s.cron);
    try {
      return describeRecurrence(s.runOnceAt ? { ...rec, ...utcToZoned(s.runOnceAt, s.timeZone) } : rec, s.timeZone);
    } catch {
      return s.cron ?? 'Once';
    }
  }

  when(iso: string | null, timeZone: string): string {
    if (!iso) return '';
    try { return formatInZone(iso, timeZone); } catch { return iso; }
  }

  recipientText(s: ScheduleDto): string {
    const n = s.recipients.length;
    return `${n} recipient${n === 1 ? '' : 's'}`;
  }

  trackSchedule(_: number, s: ScheduleDto): number { return s.id; }
  trackStat(_: number, s: { label: string }): string { return s.label; }

  openNew(): void {
    this.editing = null;
    this.dialogOpen = true;
  }

  edit(s: ScheduleDto): void {
    this.editing = s;
    this.dialogOpen = true;
  }

  onClosed(saved: ScheduleDto | null): void {
    this.dialogOpen = false;
    if (saved) {
      this.replace(saved, !this.editing);
      this.showToast('success', this.editing ? `"${saved.name}" was saved.` : `"${saved.name}" was scheduled.`);
    }
    this.editing = null;
  }

  toggleActive(s: ScheduleDto): void {
    if (this.busyId !== null) return;
    this.busyId = s.id;
    (s.isActive ? this.service.pause(s.id) : this.service.resume(s.id)).subscribe({
      next: updated => {
        this.busyId = null;
        this.replace(updated);
        this.showToast('success', updated.isActive ? `"${s.name}" was resumed.` : `"${s.name}" was paused. It will not run until you resume it.`);
      },
      error: err => { this.busyId = null; this.showToast('error', apiErrorMessage(err, 'The schedule could not be changed.')); },
    });
  }

  confirmRun(): void {
    const s = this.pendingRun;
    this.pendingRun = null;
    if (!s) return;
    this.busyId = s.id;
    this.service.runNow(s.id).subscribe({
      next: run => {
        this.busyId = null;
        const lastRun = { ...s, lastRunAt: run.startedAt, lastStatus: run.status };
        this.replace(lastRun);
        if (run.status === 'Failed') this.showToast('error', `"${s.name}" failed: ${run.error || 'see the delivery log.'}`);
        else this.showToast('success', run.status === 'Sent' ? `"${s.name}" was sent to ${run.recipientCount} recipient${run.recipientCount === 1 ? '' : 's'}.` : `"${s.name}" had no rows, so nothing was sent.`);
      },
      error: err => { this.busyId = null; this.showToast('error', apiErrorMessage(err, 'The schedule could not be run.')); },
    });
  }

  confirmDelete(): void {
    const s = this.pendingDelete;
    this.pendingDelete = null;
    if (!s) return;
    this.service.delete(s.id).subscribe({
      next: () => {
        this.schedules = this.schedules.filter(x => x.id !== s.id);
        this.showToast('success', `"${s.name}" was deleted. Its runs stay in the delivery log.`);
      },
      error: err => this.showToast('error', apiErrorMessage(err, 'The schedule could not be deleted.')),
    });
  }

  viewRuns(s: ScheduleDto): void {
    this.router.navigate(['/smart-alerts/delivery-log'], { queryParams: { scheduleId: s.id } });
  }

  get deleteMessage(): string {
    return `Delete "${this.pendingDelete?.name ?? ''}"? It stops running at once. Its past runs stay in the delivery log.`;
  }

  get runMessage(): string {
    const s = this.pendingRun;
    return s ? `Send "${s.name}" now to its ${this.recipientText(s)}? This does not change when it runs next.` : '';
  }

  private replace(s: ScheduleDto, prepend = false): void {
    this.schedules = prepend ? [s, ...this.schedules] : this.schedules.map(x => x.id === s.id ? s : x);
    this.cdr.markForCheck();
  }

  private showToast(kind: 'success' | 'error', text: string): void {
    this.toast = { kind, text };
    this.cdr.markForCheck();
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast = null; this.cdr.markForCheck(); }, 5000);
  }
}
