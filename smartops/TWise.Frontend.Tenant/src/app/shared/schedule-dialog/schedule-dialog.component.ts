import { ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { Observable, Subject, Subscription, catchError, debounceTime, forkJoin, map, of, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { DashboardCategoryResponse } from '../../core/models/dashboard.model';
import {
  DeliveryFormat, FORMATS_BY_TARGET, RecipientKind, ScheduleDto, ScheduleRecipient, ScheduleRequest, ScheduleRunDto, ScheduleService, TargetType,
} from '../../core/services/schedule.service';
import { TenantReportsService } from '../../core/services/tenant-reports.service';
import { UserManagementService } from '../../core/services/user-management.service';
import { apiErrorMessage } from '../../features/model-studio/model-studio.util';
import { addRecipients, parseAddresses } from './recipients.util';
import {
  DAY_NAMES, Frequency, MonthlyMode, Recurrence, defaultRecurrence, describeRecurrence, formatInZone, fromCron, toCron, utcToZoned, zonedToUtc,
} from './recurrence.util';

/** The item a schedule delivers. */
export interface ScheduleTarget { type: TargetType; id: number; name: string; }

interface Suggestion extends ScheduleRecipient { hint: string; }

export const TARGET_LABELS: Record<TargetType, string> = { Report: 'Report', Dashboard: 'Dashboard', Canvas: 'BI Canvas' };

const FORMAT_INFO: Record<DeliveryFormat, { label: string; hint: string }> = {
  Xlsx: { label: 'Excel workbook', hint: 'Attached as .xlsx' },
  Csv: { label: 'CSV file', hint: 'Attached as .csv, opens in Excel' },
  Link: { label: 'Link only', hint: 'A link to open it in the app' },
};

const TOKENS = [
  { token: '{{name}}', label: 'Schedule name' },
  { token: '{{item}}', label: 'Item name' },
  { token: '{{run_date}}', label: 'Run date' },
  { token: '{{run_time}}', label: 'Run time' },
  { token: '{{link}}', label: 'Link' },
  { token: '{{owner}}', label: 'Owner' },
];

const DEFAULT_SUBJECT = '{{item}} for {{run_date}}';
const DEFAULT_BODY = 'Hello,\n\nHere is {{item}} as of {{run_date}} {{run_time}}.\n\nOpen it in TWise: {{link}}\n\nRegards,\n{{owner}}';

/** The app path of an item, for the sample link. */
function itemPath(type: TargetType, id: number): string {
  return type === 'Report' ? `/reports/view/${id}` : type === 'Canvas' ? `/canvas/${id}` : `/dashboard/operations-dashboard/${id}`;
}

/** A list that failed to load reads as empty, so one refused list does not block the rest. */
function orEmpty<T>(source: Observable<T[]>): Observable<T[]> {
  return source.pipe(catchError(() => of([] as T[])));
}

function flatten(groups: DashboardCategoryResponse[]): { id: number; name: string }[] {
  return groups.flatMap(g => g.dashboards.map(d => ({ id: d.dashboardId, name: d.dashboardName })));
}

/**
 * Creates or edits a scheduled delivery. Opened from an item (target set, item fixed) or from the Schedules page.
 * Emits closed with the saved schedule, or null when cancelled.
 */
@Component({
  selector: 'app-schedule-dialog',
  standalone: false,
  templateUrl: './schedule-dialog.component.html',
  styleUrls: ['./schedule-dialog.component.scss'],
})
export class ScheduleDialogComponent implements OnInit, OnDestroy {
  @Input() target: ScheduleTarget | null = null;
  @Input() schedule: ScheduleDto | null = null;
  @Output() closed = new EventEmitter<ScheduleDto | null>();

  @ViewChild('subjectInput') subjectInput?: ElementRef<HTMLInputElement>;
  @ViewChild('bodyInput') bodyInput?: ElementRef<HTMLTextAreaElement>;

  readonly targetTypes: TargetType[] = ['Report', 'Dashboard', 'Canvas'];
  readonly targetLabels = TARGET_LABELS;
  readonly frequencies: Frequency[] = ['Once', 'Hourly', 'Daily', 'Weekdays', 'Weekly', 'Monthly', 'Custom'];
  /** Monday first, as the week reads in the app. */
  readonly weekOrder = [1, 2, 3, 4, 5, 6, 0];
  readonly dayNames = DAY_NAMES;
  readonly monthDays = Array.from({ length: 31 }, (_, i) => i + 1);
  readonly monthlyModes: { value: MonthlyMode; label: string }[] = [
    { value: 'day', label: 'On day' }, { value: 'lastDay', label: 'On the last day' },
    { value: 'first', label: 'On the first' }, { value: 'last', label: 'On the last' },
  ];
  readonly kinds: RecipientKind[] = ['To', 'Cc', 'Bcc'];
  readonly tokens = TOKENS;
  readonly formatInfo = FORMAT_INFO;
  readonly zones: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];

  fixedTarget = false;
  name = '';
  targetType: TargetType = 'Report';
  targetId: number | null = null;
  targetName = '';
  items: { id: number; name: string }[] = [];
  itemsLoading = false;

  rec: Recurrence = defaultRecurrence();
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  startDate = '';
  endDate = '';
  nextRuns: string[] = [];
  previewError = '';
  previewLoading = false;

  recipients: ScheduleRecipient[] = [];
  drafts: Record<RecipientKind, string> = { To: '', Cc: '', Bcc: '' };
  draftErrors: Record<RecipientKind, string> = { To: '', Cc: '', Bcc: '' };
  showCc = false;
  focusedKind: RecipientKind | null = null;
  private directory: Suggestion[] = [];

  subject = DEFAULT_SUBJECT;
  body = DEFAULT_BODY;
  format: DeliveryFormat = 'Xlsx';
  skipIfEmpty = false;

  saving = false;
  testing = false;
  errors: string[] = [];
  testResult: { ok: boolean; text: string } | null = null;

  private lastField: 'subject' | 'body' = 'body';
  private readonly preview$ = new Subject<void>();
  private readonly subs = new Subscription();
  private readonly owner: string;
  private readonly tenantId: number | null;
  private readonly userId: number | null;

  constructor(
    private readonly schedules: ScheduleService,
    private readonly users: UserManagementService,
    private readonly reports: TenantReportsService,
    private readonly dashboards: DashboardService,
    private readonly cdr: ChangeDetectorRef,
    auth: AuthService,
  ) {
    const user = auth.getCurrentUser();
    this.owner = user?.displayName || user?.email || 'You';
    this.tenantId = user?.tenantId ?? null;
    this.userId = user?.userId ?? null;
  }

  get isEdit(): boolean { return !!this.schedule; }

  /** Saving another user's schedule makes the editor its owner, so it runs with the editor's access. */
  get takesOwnership(): boolean { return !!this.schedule && this.schedule.ownerUserId !== this.userId; }
  get formats(): DeliveryFormat[] { return FORMATS_BY_TARGET[this.targetType]; }
  get summary(): string { return describeRecurrence(this.rec, this.timeZone); }
  get showTime(): boolean { return this.rec.frequency !== 'Custom'; }

  ngOnInit(): void {
    const s = this.schedule;
    if (s) {
      this.name = s.name;
      this.targetType = s.targetType;
      this.targetId = s.targetId;
      this.targetName = s.targetName ?? '';
      this.fixedTarget = true;
      this.timeZone = s.timeZone;
      this.rec = fromCron(s.cron);
      if (s.runOnceAt) this.rec = { ...this.rec, ...utcToZoned(s.runOnceAt, s.timeZone) };
      this.startDate = s.startAt ? utcToZoned(s.startAt, s.timeZone).date : '';
      this.endDate = s.endAt ? utcToZoned(s.endAt, s.timeZone).date : '';
      this.recipients = [...s.recipients];
      this.showCc = s.recipients.some(r => r.kind !== 'To');
      this.subject = s.subject;
      this.body = s.body;
      this.format = s.format;
      this.skipIfEmpty = s.skipIfEmpty;
    } else if (this.target) {
      this.targetType = this.target.type;
      this.targetId = this.target.id;
      this.targetName = this.target.name;
      this.name = this.target.name;
      this.fixedTarget = true;
      this.format = this.formats[0];
    } else {
      this.loadItems();
    }

    this.subs.add(this.preview$.pipe(
      debounceTime(350),
      switchMap(() => {
        const request = this.recurrenceRequest();
        if (!request) return of({ runs: [] as string[], error: '' });
        this.previewLoading = true;
        this.cdr.markForCheck();
        return this.schedules.previewRuns(request).pipe(
          map(runs => ({ runs, error: '' })),
          catchError(err => of({ runs: [] as string[], error: apiErrorMessage(err, 'The next run times could not be worked out.') })),
        );
      }),
    ).subscribe(({ runs, error }) => {
      this.nextRuns = runs;
      this.previewError = error;
      this.previewLoading = false;
      this.cdr.markForCheck();
    }));
    this.recurrenceChanged();
    this.loadDirectory();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  // ── Item ────────────────────────────────────────────────────────────────

  changeTargetType(type: TargetType): void {
    this.targetType = type;
    this.targetId = null;
    this.targetName = '';
    this.format = this.formats[0];
    this.loadItems();
  }

  pickItem(id: number | null): void {
    this.targetId = id;
    const previous = this.targetName;
    this.targetName = this.items.find(i => i.id === id)?.name ?? '';
    if (!this.name || this.name === previous) this.name = this.targetName;
  }

  private loadItems(): void {
    this.items = [];
    this.itemsLoading = true;
    const source: Observable<{ id: number; name: string }[]> =
      this.targetType === 'Report'
        ? orEmpty(this.reports.getAll().pipe(map(list => list.map(r => ({ id: r.id, name: r.reportName })))))
        : this.targetType === 'Canvas'
          ? forkJoin([orEmpty(this.dashboards.getPublishedCanvases().pipe(map(flatten))), orEmpty(this.dashboards.getMyCanvases().pipe(map(flatten)))])
            .pipe(map(([a, b]) => [...a, ...b]))
          : forkJoin([orEmpty(this.dashboards.loadPublishedDashboards().pipe(map(flatten))), orEmpty(this.dashboards.loadWipDashboards().pipe(map(flatten)))])
            .pipe(map(([a, b]) => [...a, ...b]));
    const type = this.targetType;
    this.subs.add(source.subscribe(list => {
      if (type !== this.targetType) return;
      const seen = new Set<number>();
      this.items = list.filter(i => !seen.has(i.id) && !!seen.add(i.id)).sort((a, b) => a.name.localeCompare(b.name));
      this.itemsLoading = false;
      this.cdr.markForCheck();
    }));
  }

  // ── When ────────────────────────────────────────────────────────────────

  setFrequency(frequency: Frequency): void {
    if (frequency === 'Custom' && this.rec.frequency !== 'Custom') this.rec = { ...this.rec, cron: toCron(this.rec) ?? '0 7 * * *' };
    if (frequency === 'Once' && !this.rec.date) this.rec = { ...this.rec, date: this.validZone() ? utcToZoned(new Date().toISOString(), this.timeZone).date : '' };
    this.rec = { ...this.rec, frequency };
    this.recurrenceChanged();
  }

  toggleDay(day: number): void {
    const days = this.rec.days.includes(day) ? this.rec.days.filter(d => d !== day) : [...this.rec.days, day];
    this.rec = { ...this.rec, days };
    this.recurrenceChanged();
  }

  /** Hourly shows only the minute; its time keeps the hour at 00. */
  setMinute(minute: number): void {
    const m = Math.max(0, Math.min(59, Math.floor(Number(minute) || 0)));
    this.rec = { ...this.rec, time: `00:${String(m).padStart(2, '0')}` };
    this.recurrenceChanged();
  }

  get minute(): number { return Number(this.rec.time.split(':')[1]) || 0; }

  recurrenceChanged(): void {
    this.preview$.next();
  }

  formatRun(iso: string): string {
    try { return formatInZone(iso, this.timeZone); } catch { return iso; }
  }

  private validZone(): boolean {
    try { new Intl.DateTimeFormat('en', { timeZone: this.timeZone }); return true; } catch { return false; }
  }

  private recurrenceRequest(): { cron: string | null; timeZone: string; startAt: string | null; endAt: string | null; runOnceAt: string | null } | null {
    const r = this.rec;
    if (!this.validZone() || !/^\d{2}:\d{2}$/.test(r.time)) return null;
    if (r.frequency === 'Once' && !r.date) return null;
    if (r.frequency === 'Weekly' && !r.days.length) return null;
    if (r.frequency === 'Custom' && !r.cron.trim()) return null;
    return {
      cron: toCron(r),
      timeZone: this.timeZone,
      startAt: this.startDate ? zonedToUtc(this.startDate, '00:00', this.timeZone) : null,
      endAt: this.endDate ? zonedToUtc(this.endDate, '23:59', this.timeZone) : null,
      runOnceAt: r.frequency === 'Once' ? zonedToUtc(r.date, r.time, this.timeZone) : null,
    };
  }

  // ── Recipients ──────────────────────────────────────────────────────────

  chips(kind: RecipientKind): ScheduleRecipient[] {
    return this.recipients.filter(r => r.kind === kind);
  }

  suggestions(kind: RecipientKind): Suggestion[] {
    if (this.focusedKind !== kind) return [];
    const term = this.drafts[kind].trim().toLowerCase();
    if (!term) return [];
    const taken = new Set(this.recipients.map(r => `${r.type}:${r.value.toLowerCase()}`));
    return this.directory
      .filter(s => !taken.has(`${s.type}:${s.value.toLowerCase()}`) && `${s.label} ${s.hint}`.toLowerCase().includes(term))
      .slice(0, 8);
  }

  pick(kind: RecipientKind, s: Suggestion): void {
    this.add([{ kind, type: s.type, value: s.value, label: s.label }]);
    this.drafts[kind] = '';
    this.draftErrors[kind] = '';
  }

  /** Turns the typed addresses into chips; what is not an address stays in the box. */
  commit(kind: RecipientKind): void {
    const { valid, invalid } = parseAddresses(this.drafts[kind]);
    this.add(valid.map(value => ({ kind, type: 'Email' as const, value })));
    this.drafts[kind] = invalid.join(' ');
    this.draftErrors[kind] = invalid.length ? `Not an email address: ${invalid.join(', ')}. Pick a user, role or mail group, or type a full address.` : '';
  }

  onRecipientKey(kind: RecipientKind, event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      event.preventDefault();
      const first = this.suggestions(kind)[0];
      if (first && event.key === 'Enter' && !this.drafts[kind].includes('@')) this.pick(kind, first);
      else this.commit(kind);
    } else if (event.key === 'Backspace' && !this.drafts[kind]) {
      const last = this.chips(kind).at(-1);
      if (last) this.remove(last);
    }
  }

  blurRecipients(kind: RecipientKind): void {
    // Lets a click on a suggestion land before the list closes.
    setTimeout(() => {
      if (this.focusedKind === kind) this.focusedKind = null;
      if (this.drafts[kind].trim()) this.commit(kind);
      this.cdr.markForCheck();
    }, 150);
  }

  remove(recipient: ScheduleRecipient): void {
    this.recipients = this.recipients.filter(r => r !== recipient);
  }

  trackRecipient(_: number, r: ScheduleRecipient): string { return `${r.kind}:${r.type}:${r.value}`; }
  trackSuggestion(_: number, s: Suggestion): string { return `${s.type}:${s.value}`; }
  trackText(_: number, text: string): string { return text; }

  private add(incoming: ScheduleRecipient[]): void {
    this.recipients = addRecipients(this.recipients, incoming).list;
  }

  private loadDirectory(): void {
    // Users and roles come from the control plane; someone who may not list them can still pick mail groups and type addresses.
    const users = this.tenantId === null ? of([] as Suggestion[]) : orEmpty(this.users.listUsersByTenant(this.tenantId, 1, 500).pipe(
      map(page => page.items.filter(u => u.isActive).map((u): Suggestion => ({ kind: 'To', type: 'User', value: String(u.userId), label: u.displayName || u.email, hint: u.email }))),
    ));
    const roles = orEmpty(this.users.listRoles().pipe(
      map(page => page.items.filter(r => r.isActive).map((r): Suggestion => ({ kind: 'To', type: 'Role', value: r.roleCode, label: r.roleName || r.roleCode, hint: 'Everyone with this role' }))),
    ));
    const groups = orEmpty(this.schedules.mailGroups().pipe(
      map(list => list.map((g): Suggestion => ({ kind: 'To', type: 'Group', value: String(g.id), label: g.name, hint: `Mail group, ${g.members.length} address${g.members.length === 1 ? '' : 'es'}` }))),
    ));
    this.subs.add(forkJoin([users, roles, groups]).subscribe(([u, r, g]) => {
      this.directory = [...g, ...r, ...u];
      // Names for saved recipients that came back without one.
      this.recipients = this.recipients.map(x => x.label ? x : { ...x, label: this.directory.find(d => d.type === x.type && d.value === x.value)?.label });
      this.cdr.markForCheck();
    }));
  }

  // ── Message ─────────────────────────────────────────────────────────────

  rememberField(field: 'subject' | 'body'): void { this.lastField = field; }

  /** Puts a token where the cursor was in the subject or the message. */
  insertToken(token: string): void {
    const field = this.lastField;
    const el = field === 'subject' ? this.subjectInput?.nativeElement : this.bodyInput?.nativeElement;
    const text = field === 'subject' ? this.subject : this.body;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + token + text.slice(end);
    if (field === 'subject') this.subject = next; else this.body = next;
    setTimeout(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  /** The subject and message with sample values, as the first run would send them. */
  get sample(): { subject: string; body: string } {
    const first = this.nextRuns[0];
    const when = first ? utcToZoned(first, this.timeZone) : null;
    const runDate = when
      ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' })
        .format(new Date(`${when.date}T00:00:00Z`))
      : '12 Oct 2026';
    const values: Record<string, string> = {
      name: this.name || 'Schedule',
      item: this.targetName || 'Item',
      run_date: runDate,
      run_time: when?.time ?? '07:00',
      link: `${location.origin}${this.targetId !== null ? itemPath(this.targetType, this.targetId) : ''}`,
      owner: this.schedule?.ownerName ?? this.owner,
    };
    const fill = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (all, token: string) => values[token] ?? all);
    return { subject: fill(this.subject), body: fill(this.body) };
  }

  // ── Save and test ───────────────────────────────────────────────────────

  private validate(): string[] {
    const errors: string[] = [];
    if (!this.name.trim()) errors.push('Give the schedule a name.');
    if (this.targetId === null) errors.push(`Choose the ${TARGET_LABELS[this.targetType].toLowerCase()} to send.`);
    const r = this.rec;
    if (!this.validZone()) errors.push('Choose a time zone from the list.');
    if (r.frequency === 'Once' && !r.date) errors.push('Choose the date to send it on.');
    if (r.frequency === 'Weekly' && !r.days.length) errors.push('Choose at least one day of the week.');
    if (r.frequency === 'Custom' && r.cron.trim().split(/\s+/).length !== 5) errors.push('A custom schedule needs five cron fields: minute, hour, day of month, month and day of week.');
    if (this.startDate && this.endDate && this.endDate < this.startDate) errors.push('The end date is before the start date.');
    if (!this.chips('To').length) errors.push('Add at least one recipient under To.');
    if (this.recipients.length > 100) errors.push('A schedule can have up to 100 recipients.');
    if (this.kinds.some(k => this.draftErrors[k])) errors.push('Fix or clear the recipients that are not email addresses.');
    if (!this.subject.trim()) errors.push('Write a subject.');
    return errors;
  }

  private request(): ScheduleRequest | null {
    this.kinds.forEach(k => { if (this.drafts[k].trim()) this.commit(k); });
    this.errors = this.validate();
    const when = this.errors.length ? null : this.recurrenceRequest();
    if (!when || this.targetId === null) return null;
    return {
      name: this.name.trim(),
      targetType: this.targetType,
      targetId: this.targetId,
      format: this.format,
      ...when,
      skipIfEmpty: this.format !== 'Link' && this.skipIfEmpty,
      subject: this.subject.trim(),
      body: this.body,
      recipients: this.recipients,
    };
  }

  save(): void {
    const request = this.request();
    if (!request || this.saving) return;
    this.saving = true;
    const call = this.schedule ? this.schedules.update(this.schedule.id, request) : this.schedules.create(request);
    call.subscribe({
      next: saved => { this.saving = false; this.closed.emit(saved); },
      error: err => {
        this.saving = false;
        this.errors = [apiErrorMessage(err, 'The schedule could not be saved.')];
        this.cdr.markForCheck();
      },
    });
  }

  /** Sends this schedule, as it stands, to the signed-in user only. Nothing is saved. */
  sendTest(): void {
    const request = this.request();
    if (!request || this.testing) return;
    this.testing = true;
    this.testResult = null;
    this.schedules.test(request).subscribe({
      next: run => { this.testing = false; this.testResult = this.describeTest(run); this.cdr.markForCheck(); },
      error: err => {
        this.testing = false;
        this.testResult = { ok: false, text: apiErrorMessage(err, 'The test could not be sent.') };
        this.cdr.markForCheck();
      },
    });
  }

  private describeTest(run: ScheduleRunDto): { ok: boolean; text: string } {
    if (run.status === 'Sent') return { ok: true, text: 'A test was sent to your email address. Check your inbox.' };
    if (run.status === 'Skipped') return { ok: true, text: 'Nothing was sent: the item has no rows and Skip if empty is on.' };
    return { ok: false, text: run.error || 'The test could not be sent.' };
  }

  cancel(): void {
    if (!this.saving) this.closed.emit(null);
  }
}
