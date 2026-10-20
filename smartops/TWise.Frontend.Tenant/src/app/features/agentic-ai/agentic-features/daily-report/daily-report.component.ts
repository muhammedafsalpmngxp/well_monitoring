import { ChangeDetectorRef, Component, DestroyRef, ElementRef, inject, OnInit, ViewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subscription, finalize } from 'rxjs';
import { AgenticFeatureQuery, AgenticFeaturesService, errorText, localToday, saveFile } from '../agentic-features.service';
import {
  AgentAnswer, DailyTask, GroupDetailsResponse, Load, LogicalTask, MilestoneAlert, MilestonesResponse, RecentDate,
  RecentDatesResponse, StatusGroup, SummaryResponse, WbsGroup, WellActivity, WellActivityResponse, WellDetailResponse, idle,
} from './daily-report.models';
import { TextBlock, codeLabel, dueText, orderedKeys, parseLengthRule, statusHint, statusTone, taskStateTone, toBlocks } from './daily-report.format';

/** One row of the wells table: the day's per-well roll-up joined (by well id) to the well's task activity. */
export interface WellRow {
  well_id: number;
  task_count: number;
  status_counts: Record<string, number>;
  activity: WellActivity | null;
  /** The busiest activity of the day's tasks, and how many distinct activities the well ran. */
  topActivity: string | null;
  activityKinds: number;
}

type WellScope = 'active' | 'reported' | 'all';
type Metric = 'open' | 'incomplete' | 'ongoing' | 'today';

/** The figure a group-details drill-down was opened from. */
interface GroupFilter { status: string | null; wbs: string | null; activityCode: string | null; title: string }

/**
 * Agentic AI → Agentic Features → Daily Report: the day's entries validated against plan (status → WBS → activity,
 * or task cards on a small day), per-well task activity, one well's tasks, lifecycle milestones, and the agents
 * (day / well / task briefs, open questions) whose every figure is checked against the data before it is shown.
 * Every figure is the runtime's; this page counts nothing itself. The AI is only called on a button press.
 */
@Component({
  selector: 'app-daily-report',
  standalone: false,
  templateUrl: './daily-report.component.html',
  styleUrls: ['./daily-report.component.scss'],
})
export class DailyReportComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('wellPanel') private wellPanel?: ElementRef<HTMLElement>;
  @ViewChild('groupPanel') private groupPanel?: ElementRef<HTMLElement>;

  readonly breadcrumbs = [{ label: 'Home' }, { label: 'Agentic AI' }, { label: 'Agentic Features', route: '/agentic-ai/features' }, { label: 'Daily Report' }];

  // helpers for the template
  readonly codeLabel = codeLabel;
  readonly statusTone = statusTone;
  readonly taskStateTone = taskStateTone;
  readonly statusHint = statusHint;
  readonly orderedKeys = orderedKeys;
  readonly dueText = dueText;

  reportDate = '';
  dates: Load<RecentDate[]> = idle();
  summary: Load<SummaryResponse> = idle();
  dayWells: Load<GroupDetailsResponse> = idle();
  activity: Load<WellActivityResponse> = idle();
  milestones: Load<MilestonesResponse> = idle();
  queries: Load<AgenticFeatureQuery[]> = idle();

  /** The wells and tasks behind one summary figure. */
  group: Load<GroupDetailsResponse> = idle();
  groupFilter: GroupFilter | null = null;

  /** The well whose tasks are open below the table. */
  selectedWellId: number | null = null;
  well: Load<WellDetailResponse> = idle();

  /** A figure of one well's row, expanded in place to the tasks behind it. */
  expanded: { wellId: number; metric: Metric } | null = null;
  rowTasks: Load<LogicalTask[]> = idle();

  exporting = false;
  exportError = '';

  // summary tree
  readonly openStatuses = new Set<string>();
  readonly openWbs = new Set<string>();

  // wells table
  wellScope: WellScope = 'active';
  wellSearch = '';
  wellLimit = 50;
  private allRows: WellRow[] = [];
  scopeCounts: Record<WellScope, number> = { active: 0, reported: 0, all: 0 };
  visibleRows: WellRow[] = [];
  filteredCount = 0;
  private tasksByWell = new Map<number, DailyTask[]>();

  // milestones
  readonly upcomingPreview = 5;
  showAllUpcoming = false;
  showOverdue = false;
  openMilestone: string | null = null;

  // AI
  private readonly briefs = new Map<string, Load<AgentAnswer>>();
  private readonly blockCache = new WeakMap<AgentAnswer, TextBlock[]>();
  question = '';
  asked = '';
  askState: Load<AgentAnswer> = idle();
  askRule: { min: number; max: number } | null = null;

  private daySubs: Subscription[] = [];

  constructor(private readonly api: AgenticFeaturesService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadMilestones();
    this.loadDates(true);
  }

  // ── Loading ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** Runs one call into a Load state; the page re-renders when it settles. */
  private run<T>(state: Load<T>, call: Observable<T>, fallback: string, done?: (data: T) => void, failed?: (err: any) => void): Subscription {
    state.loading = true;
    state.error = '';
    state.data = null;
    this.cdr.markForCheck();
    return call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => { state.loading = false; state.data = data; done?.(data); this.cdr.markForCheck(); },
      error: err => { state.loading = false; state.error = errorText(err, fallback); failed?.(err); this.cdr.markForCheck(); },
    });
  }

  /** The recent dates with entries; on first load the newest becomes the report date (else today). */
  private loadDates(pickDefault: boolean): void {
    this.run(this.dates, this.mapDates(this.api.dailyDates<RecentDatesResponse>()), 'The recent report dates could not be loaded.',
      list => { if (pickDefault) this.selectDate(this.newest(list) ?? localToday()); },
      () => { if (pickDefault) this.selectDate(localToday()); });
  }

  private mapDates(call: Observable<RecentDatesResponse>): Observable<RecentDate[]> {
    return new Observable<RecentDate[]>(sub => call.subscribe({
      next: r => { sub.next(r?.dates ?? []); sub.complete(); },
      error: e => sub.error(e),
    }));
  }

  private newest(list: RecentDate[]): string | null {
    return list.reduce<string | null>((best, d) => (!best || d.report_date > best ? d.report_date : best), null);
  }

  loadMilestones(): void {
    this.run(this.milestones, this.api.dailyMilestones<MilestonesResponse>(null), 'The milestones could not be loaded.');
  }

  /** Everything about one date. Refresh reloads the date's data on the server (and drops its AI answers) first. */
  private loadDay(refresh: boolean): void {
    this.daySubs.forEach(s => s.unsubscribe());
    const date = this.reportDate;
    const rest = () => {
      if (date !== this.reportDate) return;
      this.daySubs.push(
        this.run(this.dayWells, this.api.daily<GroupDetailsResponse>('group-details', { reportDate: date }),
          'The wells of this date could not be loaded.', () => this.rebuildRows(), () => this.rebuildRows()),
        this.run(this.activity, this.api.daily<WellActivityResponse>('well-activity', { reportDate: date }),
          'The task activity of the wells could not be loaded.', () => this.rebuildRows(), () => this.rebuildRows()));
      if (this.selectedWellId !== null) this.loadWell(this.selectedWellId, false);
      if (this.groupFilter) this.loadGroup(this.groupFilter, false);
    };
    // The summary goes first when refreshing, so the date is reloaded once and the other views read the new copy.
    const summary$ = this.api.daily<SummaryResponse>('summary', { reportDate: date, refresh }).pipe(finalize(() => { if (refresh) rest(); }));
    this.daySubs = [this.run(this.summary, summary$, 'The daily summary could not be loaded.')];
    if (!refresh) rest();
    this.allRows = [];
    this.rebuildRows();
  }

  // ── Header controls ───────────────────────────────────────────────────────────────────────────────────────────

  selectDate(date: string): void {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const changed = date !== this.reportDate;
    this.reportDate = date;
    if (changed) {
      this.selectedWellId = null;
      this.well = idle();
      this.groupFilter = null;
      this.group = idle();
      this.expanded = null;
      this.openStatuses.clear();
      this.openWbs.clear();
      this.askState = idle();
      this.asked = '';
      this.wellLimit = 50;
    }
    this.loadDay(false);
  }

  onDateInput(event: Event): void { this.selectDate((event.target as HTMLInputElement).value); }

  onRecentPick(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (select.value) this.selectDate(select.value);
  }

  get isRecentDate(): boolean { return (this.dates.data ?? []).some(d => d.report_date === this.reportDate); }

  refresh(): void {
    if (!this.reportDate) return;
    this.briefs.clear();
    this.askState = idle();
    this.asked = '';
    this.loadDay(true);
    this.loadDates(false);
    this.loadMilestones();
  }

  exportExcel(): void {
    if (!this.reportDate || this.exporting) return;
    this.exporting = true;
    this.exportError = '';
    this.api.dailyExport(this.reportDate).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: file => { this.exporting = false; saveFile(file); this.cdr.markForCheck(); },
      error: err => { this.exporting = false; this.exportError = errorText(err, 'The Excel export could not be created.'); this.cdr.markForCheck(); },
    });
  }

  // ── Summary ──────────────────────────────────────────────────────────────────────────────────────────────────

  get statusCountKeys(): string[] { return orderedKeys(this.summary.data?.totals.status_counts); }

  get flagKeys(): string[] { return Object.keys(this.summary.data?.data_quality.flag_counts ?? {}); }

  dqTotal(counts: Record<string, number> | null | undefined): number {
    return Object.values(counts ?? {}).reduce((a, b) => a + b, 0);
  }

  toggleStatus(g: StatusGroup): void { this.toggle(this.openStatuses, g.status); }
  toggleWbs(g: StatusGroup, w: WbsGroup): void { this.toggle(this.openWbs, this.wbsKey(g, w)); }
  wbsKey(g: StatusGroup, w: WbsGroup): string { return `${g.status}|${w.wbs ?? ''}`; }

  private toggle(set: Set<string>, key: string): void {
    if (set.has(key)) set.delete(key); else set.add(key);
  }

  expandAll(open: boolean): void {
    this.openStatuses.clear();
    this.openWbs.clear();
    if (!open) return;
    for (const g of this.summary.data?.status_groups ?? []) {
      this.openStatuses.add(g.status);
      for (const w of g.wbs_groups) this.openWbs.add(this.wbsKey(g, w));
    }
  }

  /**
   * The wells and tasks behind one figure. A null WBS / activity means the "not recorded" group, which the runtime
   * selects with an empty string; a filter left out (undefined) is not applied.
   */
  openGroup(status: string | null, wbs?: string | null, activityCode?: string | null, label?: string | null): void {
    const parts = [status ? codeLabel(status) : null,
      wbs === undefined ? null : (wbs || 'No WBS'),
      activityCode === undefined ? null : (label || activityCode || 'Activity not mapped')].filter(Boolean);
    this.groupFilter = {
      status,
      wbs: wbs === undefined ? null : (wbs ?? ''),
      activityCode: activityCode === undefined ? null : (activityCode ?? ''),
      title: parts.join(' · ') || 'All tasks',
    };
    this.loadGroup(this.groupFilter, true);
  }

  private loadGroup(f: GroupFilter, scroll: boolean): void {
    this.run(this.group, this.api.daily<GroupDetailsResponse>('group-details',
      { reportDate: this.reportDate, status: f.status, wbs: f.wbs, activityCode: f.activityCode }),
      'The tasks behind this figure could not be loaded.');
    if (scroll) this.scrollTo(() => this.groupPanel);
  }

  closeGroup(): void { this.groupFilter = null; this.group = idle(); }

  // ── Wells ────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Joins the day's per-well roll-up and the wells' task activity by well id (a lookup, not a calculation). */
  private rebuildRows(): void {
    const byId = new Map<number, WellRow>();
    const tasks = this.dayWells.data?.tasks ?? [];
    this.tasksByWell = new Map();
    for (const t of tasks) {
      const list = this.tasksByWell.get(t.well_id) ?? [];
      list.push(t);
      this.tasksByWell.set(t.well_id, list);
    }
    for (const a of this.activity.data?.wells ?? []) {
      byId.set(a.well_id, { well_id: a.well_id, task_count: 0, status_counts: {}, activity: a, topActivity: null, activityKinds: 0 });
    }
    for (const w of this.dayWells.data?.wells ?? []) {
      const existing = byId.get(w.well_id);
      byId.set(w.well_id, { well_id: w.well_id, task_count: w.task_count, status_counts: w.status_counts,
        activity: existing?.activity ?? null, topActivity: null, activityKinds: 0 });
    }
    for (const [id, list] of this.tasksByWell) {
      const row = byId.get(id);
      if (!row) continue;
      const counts = new Map<string, number>();
      for (const t of list) {
        const label = t.activity_description || t.activity_code || '';
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      let top = '';
      let best = -1;
      for (const [label, n] of counts) if (n > best) { top = label; best = n; }
      row.topActivity = top || null;
      row.activityKinds = counts.size;
    }
    this.allRows = [...byId.values()];
    this.applyWellFilter();
  }

  reported(r: WellRow): boolean { return (r.activity?.today_reported_task_count || r.task_count) > 0; }
  private active(r: WellRow): boolean { return this.reported(r) || (r.activity?.open_task_count ?? 0) > 0; }

  applyWellFilter(): void {
    const scoped = {
      active: this.allRows.filter(r => this.active(r)),
      reported: this.allRows.filter(r => this.reported(r)),
      all: this.allRows,
    };
    this.scopeCounts = { active: scoped.active.length, reported: scoped.reported.length, all: scoped.all.length };
    const needle = this.wellSearch.trim();
    const rows = scoped[this.wellScope]
      .filter(r => !needle || String(r.well_id).includes(needle))
      .sort((a, b) => Number(this.reported(b)) - Number(this.reported(a)) || b.task_count - a.task_count
        || (b.activity?.open_task_count ?? 0) - (a.activity?.open_task_count ?? 0)
        || (b.activity?.ongoing_task_count ?? 0) - (a.activity?.ongoing_task_count ?? 0) || a.well_id - b.well_id);
    this.filteredCount = rows.length;
    this.visibleRows = rows.slice(0, this.wellLimit);
    this.cdr.markForCheck();
  }

  setScope(scope: WellScope): void { this.wellScope = scope; this.wellLimit = 50; this.applyWellFilter(); }

  showMoreWells(): void { this.wellLimit += 50; this.applyWellFilter(); }

  metricCount(r: WellRow, m: Metric): number | null {
    if (m === 'today') return r.activity?.today_reported_task_count ?? r.task_count;
    if (!r.activity) return null;
    return m === 'open' ? r.activity.open_task_count : m === 'incomplete' ? r.activity.incomplete_task_count : r.activity.ongoing_task_count;
  }

  isExpanded(r: WellRow, m: Metric): boolean { return this.expanded?.wellId === r.well_id && this.expanded.metric === m; }

  /** Expands one figure of a row: open work comes from well-activity for that well; "today" is the day's own tasks. */
  toggleMetric(r: WellRow, m: Metric): void {
    if (this.isExpanded(r, m)) { this.expanded = null; return; }
    const sameWell = this.expanded?.wellId === r.well_id && this.expanded.metric !== 'today' && !!this.rowTasks.data;
    this.expanded = { wellId: r.well_id, metric: m };
    if (m === 'today' || sameWell) return;
    this.run(this.rowTasks, new Observable<LogicalTask[]>(sub => this.api.daily<WellActivityResponse>('well-activity',
      { reportDate: this.reportDate, wellId: r.well_id }).subscribe({
      next: res => { sub.next(res?.tasks ?? []); sub.complete(); }, error: e => sub.error(e),
    })), 'The tasks of this well could not be loaded.');
  }

  /** The open tasks behind the expanded figure (open = all; incomplete = not ongoing; ongoing). */
  get expandedOpenTasks(): LogicalTask[] {
    const m = this.expanded?.metric;
    return (this.rowTasks.data ?? []).filter(t => m === 'ongoing' ? t.task_state === 'ONGOING'
      : m === 'incomplete' ? t.task_state !== 'ONGOING' : true);
  }

  todaysTasks(wellId: number): DailyTask[] { return this.tasksByWell.get(wellId) ?? []; }

  metricTitle(m: Metric, wellId: number): string {
    switch (m) {
      case 'open': return `Open tasks on well ${wellId}`;
      case 'incomplete': return `Incomplete tasks on well ${wellId} (not ongoing)`;
      case 'ongoing': return `Ongoing tasks on well ${wellId}`;
      default: return `Tasks reported by well ${wellId} on this date`;
    }
  }

  // ── One well ─────────────────────────────────────────────────────────────────────────────────────────────────

  selectWell(wellId: number): void {
    this.selectedWellId = wellId;
    this.loadWell(wellId, true);
  }

  private loadWell(wellId: number, scroll: boolean): void {
    this.run(this.well, this.api.daily<WellDetailResponse>('well', { reportDate: this.reportDate, wellId }),
      `Well ${wellId} could not be loaded.`);
    if (scroll) this.scrollTo(() => this.wellPanel);
  }

  closeWell(): void { this.selectedWellId = null; this.well = idle(); }

  yesNo(v: boolean | null | undefined): string | null { return v === null || v === undefined ? null : (v ? 'Yes' : 'No'); }

  private scrollTo(target: () => ElementRef<HTMLElement> | undefined): void {
    setTimeout(() => {
      const el = target()?.nativeElement;
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.focus({ preventScroll: true });
    });
  }

  // ── Milestones ───────────────────────────────────────────────────────────────────────────────────────────────

  get upcomingShown(): MilestoneAlert[] {
    const all = this.milestones.data?.upcoming ?? [];
    return this.showAllUpcoming ? all : all.slice(0, this.upcomingPreview);
  }

  milestoneKey(a: MilestoneAlert): string { return `${a.well_id}-${a.milestone}-${a.overdue}`; }

  toggleMilestone(a: MilestoneAlert): void {
    const key = this.milestoneKey(a);
    this.openMilestone = this.openMilestone === key ? null : key;
  }

  // ── AI ───────────────────────────────────────────────────────────────────────────────────────────────────────

  private briefKey(scope: 'day' | 'well' | 'task', wellId?: number | null, taskDailyId?: number | null): string {
    return `${this.reportDate}|${scope}|${wellId ?? ''}|${taskDailyId ?? ''}`;
  }

  brief(scope: 'day' | 'well' | 'task', wellId?: number | null, taskDailyId?: number | null): Load<AgentAnswer> | null {
    return this.briefs.get(this.briefKey(scope, wellId, taskDailyId)) ?? null;
  }

  /** Asks for a brief (the runtime reuses an answer written on the same data, so asking again costs nothing new). */
  generateBrief(scope: 'day' | 'well' | 'task', wellId?: number | null, taskDailyId?: number | null): void {
    if (!this.reportDate) return;
    const state: Load<AgentAnswer> = idle();
    this.briefs.set(this.briefKey(scope, wellId, taskDailyId), state);
    this.run(state, this.api.dailyBrief<AgentAnswer>(this.reportDate, scope, wellId, taskDailyId), 'The AI brief could not be produced.');
  }

  closeBrief(scope: 'day' | 'well' | 'task', wellId?: number | null, taskDailyId?: number | null): void {
    this.briefs.delete(this.briefKey(scope, wellId, taskDailyId));
  }

  get questionLength(): number { return this.question.trim().length; }

  get questionProblem(): string {
    const n = this.questionLength;
    if (!this.askRule || n === 0) return '';
    if (n < this.askRule.min) return `At least ${this.askRule.min} characters.`;
    if (n > this.askRule.max) return `At most ${this.askRule.max} characters.`;
    return '';
  }

  ask(): void {
    const q = this.question.trim();
    if (!q || this.questionProblem || this.askState.loading || !this.reportDate) return;
    this.asked = q;
    this.run(this.askState, this.api.dailyAsk<AgentAnswer>(this.reportDate, q), 'The agent could not answer.', undefined,
      err => { const rule = parseLengthRule(errorText(err, '')); if (rule) this.askRule = rule; });
  }

  clearAsk(): void { this.askState = idle(); this.asked = ''; }

  blocks(r: AgentAnswer): TextBlock[] {
    let b = this.blockCache.get(r);
    if (!b) { b = toBlocks(r.explanation); this.blockCache.set(r, b); }
    return b;
  }

  models(r: AgentAnswer): string {
    return Object.entries(r.models ?? {}).map(([role, model]) => `${role}: ${model}`).join(' · ');
  }

  traceDetail(step: AgentAnswer['trace'] extends (infer S)[] | undefined ? S : never): string {
    const passed = step.passed === undefined ? null : step.passed ? 'passed' : `${step.issues ?? 0} issue(s)`;
    return [step.why, step.mode, step.error, passed].filter(Boolean).join(' — ');
  }

  hasEvidence(r: AgentAnswer): boolean { return !!r.evidence && Object.keys(r.evidence).length > 0; }

  // ── Verified SQL ─────────────────────────────────────────────────────────────────────────────────────────────

  onSqlToggle(event: Event): void {
    if ((event.target as HTMLDetailsElement).open && !this.queries.data && !this.queries.loading) this.loadQueries();
  }

  loadQueries(): void {
    this.run(this.queries, this.api.queries('dailyreport'), 'The verified queries could not be loaded.');
  }

  // ── trackBy ──────────────────────────────────────────────────────────────────────────────────────────────────

  trackKey(_: number, key: string): string { return key; }
  trackWell(_: number, r: { well_id: number }): number { return r.well_id; }
  trackTask(_: number, t: DailyTask): number { return t.task_daily_id; }
  trackStatus(_: number, g: StatusGroup): string { return g.status; }
  trackWbs(_: number, w: WbsGroup): string { return w.wbs ?? ''; }
  trackMilestone = (_: number, a: MilestoneAlert): string => this.milestoneKey(a);
  trackQuery(_: number, q: AgenticFeatureQuery): string { return q.key; }
}
