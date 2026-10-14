import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AgenticFeatureQuery, AgenticFeaturesService, errorText } from '../agentic-features.service';

// ── Response shapes (agent runtime: app/features/slippage/api.py and advisor.py, passed through by the Tenant API) ──

type Row = Record<string, any>;

/** POST /query: one verified query. Columns and row keys are the query's output contract (snake_case). */
interface QueryResult { key: string; columns: string[]; rows: Row[]; truncated: boolean }

/** One verified query's call state on this page. */
interface QueryState { loading: boolean; error: string; data: QueryResult | null }

interface MilestoneEvidence {
  milestone: string; owner: string; deadline: string | null; actual: string | null; status: string | null; variance_days: number | null;
}
/** listed: true = in the slippage listing; false = no milestone failed; null = the listing could not be read (note says why). */
interface WellEvidence { listed: boolean | null; headline: string | null; milestones: MilestoneEvidence[]; note: string | null }

interface TaskAdvice {
  summary: string;
  caused_by_other_delay: string;
  causes: { cause: string; evidence: string; confidence: string }[];
  actions: { action: string; crew_id: string | number | null; rationale: string; crew_unverified?: boolean }[];
  checks: string[];
  caveats: string[];
}

interface TaskSuggestion {
  well_id: string; task_code: string; generated_at: string; model: string; cached: boolean;
  /** Null when the reply was not the structure asked for: raw then holds what the model said. */
  advice: TaskAdvice | null; raw: string | null;
  evidence: {
    task: Row; earlier_late_tasks: Row[]; same_wbs_late_tasks: Row[]; well: WellEvidence;
    crew: {
      crew_type_id: string | number | null; assigned_crew_id: string | number | null; assigned: Row | null; available: Row[];
      available_count: number; busy_count: number; type_total: number; note: string | null;
    };
  };
}

interface WellAdvice {
  description: string;
  delayed: string;
  why_delayed: { reason: string; evidence: string; owner: string; confidence: string }[];
  actions: {
    priority: number; action: string; crew_type_id: string | number | null; crew_id: string | number | null; rationale: string;
    crew_unverified?: boolean; type_unverified?: boolean;
  }[];
  checks: string[];
  caveats: string[];
}

interface CrewTypeGroup {
  crew_type_id: string | null; late_tasks: number; worst_overrun_days: number | null; wbs: string[]; unassigned_late_tasks: number;
  assigned_crews: Row[]; available_count: number; busy_count: number; type_total: number; candidates: Row[];
}

interface WellSuggestion {
  well_id: string; generated_at: string; model: string; cached: boolean;
  advice: WellAdvice | null; raw: string | null;
  evidence: {
    well: WellEvidence;
    tasks: { total: number; late: number; red: number; amber: number; not_started_late: number; in_progress: number; completed: number; due_today: number };
    late_by_wbs: { wbs: string; late_tasks: number; red: number; not_started_late: number; worst_overrun_days: number | null; crew_type_ids: string[] }[];
    late_by_crew_type: CrewTypeGroup[];
    most_urgent: Row[];
    crew_note: string | null;
  };
}

/** An advisor call's state (the well's, or one task's). */
interface AdvisorState<T> { open: boolean; loading: boolean; error: string; data: T | null }

/** A contractual milestone, found from the well slippage query's columns (<prefix>_deadline/_actual/_status/_variance_days). */
interface Milestone { prefix: string; label: string }

type Tone = 'bad' | 'warn' | 'ok' | 'info' | 'neutral';
type WellSort = 'overrun' | 'well' | 'status' | 'activity';
type CrewSort = 'open' | 'overdue' | 'crew' | 'recent';

/**
 * DISPLAY ONLY: the colour of a status token the verified queries report. The vocabularies themselves are tenant settings
 * (AI Settings → Ask Data & Features → Slippage), so an unknown value is shown as written in a neutral colour, never dropped.
 * DATA_QUALITY_ISSUE is not red: it means the date needed to judge is missing, not that the work is late.
 */
const STATUS_TONE: Record<string, Tone> = {
  MISSED: 'bad', DELAYED: 'bad', OVERDUE: 'bad', COMPLETED_LATE: 'bad', START_DELAYED: 'bad', RED: 'bad',
  NOT_STARTED_LATE: 'bad', NOT_STARTED_SLIPPING: 'bad',
  DUE_TODAY: 'warn', BUSY: 'warn',
  AHEAD_OF_SCHEDULE: 'ok', ON_SCHEDULE: 'ok', COMPLETED_EARLY: 'ok', COMPLETED_ON_TIME: 'ok', STARTED_EARLY: 'ok',
  STARTED_ON_TIME: 'ok', GREEN: 'ok', COMPLETED: 'ok', AVAILABLE: 'ok', IN_PROGRESS_NOT_LATE: 'ok',
  DATA_QUALITY_ISSUE: 'info',
};

/** DISPLAY ONLY: the advisor verdicts (the reply protocol of the advisor prompts, normalised by the runtime). */
const TASK_VERDICT: Record<string, { label: string; tone: Tone }> = {
  yes: { label: 'Yes: a knock-on from another delay', tone: 'bad' },
  possibly: { label: 'Possibly: the timing points upstream', tone: 'warn' },
  no: { label: 'No: nothing upstream in the data', tone: 'neutral' },
  unknown: { label: 'Unknown from the data', tone: 'neutral' },
};
const WELL_VERDICT: Record<string, { label: string; tone: Tone }> = {
  yes: { label: 'Delayed', tone: 'bad' },
  at_risk: { label: 'At risk: late work, no milestone failed yet', tone: 'warn' },
  no: { label: 'Not delayed', tone: 'ok' },
  unknown: { label: 'Unknown from the data', tone: 'neutral' },
};

const EMPTY = '—';
const PAGE_SIZE = 25;
const CREW_PAGE_SIZE = 15;

/**
 * Agentic AI → Agentic Features → Slippage.
 *
 * Overview: the wells that failed a contractual milestone (well_slippage), the delayed activity codes per well
 * (activity_summary) and crew availability, all from the tenant's verified SQL (no AI). Well view (?well=<id>): the well's
 * milestones, its task-level delay (activity_delay) and the AI advisor, for the well and for each late task. The
 * advisor's answer is shown beside the verified evidence it was given, never mixed with the figures.
 *
 * Null is never zero here: a missing date or variance is an em dash, and a missing variance never sorts as on time.
 */
@Component({
  selector: 'app-slippage',
  standalone: false,
  templateUrl: './slippage.component.html',
  styleUrls: ['./slippage.component.scss'],
})
export class SlippageComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(AgenticFeaturesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly breadcrumbs = [{ label: 'Home' }, { label: 'Agentic AI' }, { label: 'Agentic Features', route: '/agentic-ai/features' }, { label: 'Slippage' }];
  readonly empty = EMPTY;

  // ── Overview data ───────────────────────────────────────────────────────────────────────────────────────
  wells: QueryState = this.idle();
  activity: QueryState = this.idle();
  crews: QueryState = this.idle();
  loadedAt: Date | null = null;

  milestones: Milestone[] = [];
  /** Delayed activity codes per well id (activity_summary). */
  private activityByWell = new Map<string, number>();

  // KPIs
  kpi = { wells: 0, worst: null as number | null, dataQuality: 0, wellsWithActivity: 0, delayedCodes: 0 };
  byMilestone: { milestone: Milestone; count: number }[] = [];
  maxMilestoneCount = 1;
  crewStatusCounts: { value: string; count: number; tone: Tone }[] = [];

  // Well table
  wellSearch = '';
  wellMilestone = '';
  wellHeadline = '';
  wellSort: WellSort = 'overrun';
  wellPage = 0;
  headlines: string[] = [];
  wellRows: Row[] = [];
  readonly pageSize = PAGE_SIZE;

  // Activity summary
  activitySearch = '';
  activityPage = 0;
  activityRows: Row[] = [];

  // Crew table
  crewSearch = '';
  crewStatus = '';
  crewType = '';
  crewSort: CrewSort = 'open';
  crewPage = 0;
  crewTypes: string[] = [];
  crewStatuses: string[] = [];
  crewRows: Row[] = [];
  readonly crewPageSize = CREW_PAGE_SIZE;

  // Lookup
  lookup = '';
  lookupTouched = false;

  // ── Well view ───────────────────────────────────────────────────────────────────────────────────────────
  wellId: string | null = null;
  tasks: QueryState = this.idle();
  taskFilter = 'all';
  taskSearch = '';
  taskRows: Row[] = [];
  taskRiskOptions: { value: string; count: number }[] = [];
  taskExecOptions: { value: string; count: number }[] = [];
  taskKpi = { total: 0, late: 0, bad: 0, execLate: 0, activities: 0, unmapped: 0, worst: null as number | null };

  wellAdvisor: AdvisorState<WellSuggestion> = this.idleAdvisor();
  taskAdvisors = new Map<string, AdvisorState<TaskSuggestion>>();
  private wellAdvisorSub?: Subscription;
  private taskAdvisorSubs = new Map<string, Subscription>();
  private tasksSub?: Subscription;

  // ── Show SQL ────────────────────────────────────────────────────────────────────────────────────────────
  sqlOpen = false;
  sqlLoading = false;
  sqlError = '';
  sqlQueries: AgenticFeatureQuery[] | null = null;
  sqlKey = '';
  sqlCopied = false;

  ngOnInit(): void {
    this.loadOverview();
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const id = (params.get('well') ?? '').trim();
      this.showWell(id || null);
    });
    this.destroyRef.onDestroy(() => {
      this.wellAdvisorSub?.unsubscribe();
      this.tasksSub?.unsubscribe();
      this.taskAdvisorSubs.forEach(s => s.unsubscribe());
    });
  }

  // ── Loading ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Reload everything on screen: the overview queries and, in the well view, the well's tasks. */
  refresh(): void {
    this.loadOverview();
    if (this.wellId) this.loadTasks();
  }

  loadOverview(): void {
    this.run('well_slippage', s => { this.wells = s; }, () => this.onWells());
    this.run('activity_summary', s => { this.activity = s; }, () => this.onActivity());
    this.run('crew_availability', s => { this.crews = s; }, () => this.onCrews());
  }

  loadWells(): void { this.run('well_slippage', s => { this.wells = s; }, () => this.onWells()); }
  loadActivity(): void { this.run('activity_summary', s => { this.activity = s; }, () => this.onActivity()); }
  loadCrews(): void { this.run('crew_availability', s => { this.crews = s; }, () => this.onCrews()); }

  /** One overview query: its state is replaced (not mutated) so the template sees each step. */
  private run(key: string, set: (s: QueryState) => void, done: () => void): void {
    const previous = key === 'well_slippage' ? this.wells : key === 'activity_summary' ? this.activity : this.crews;
    set({ loading: true, error: '', data: previous.data });
    this.api.slippageQuery<QueryResult>(key).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => {
        set({ loading: false, error: '', data: this.normaliseResult(r) });
        this.loadedAt = new Date();
        done();
        this.cdr.markForCheck();
      },
      error: err => {
        set({ loading: false, error: errorText(err, 'This Slippage query could not be run.'), data: null });
        done();
        this.cdr.markForCheck();
      },
    });
  }

  private normaliseResult(r: QueryResult | null): QueryResult {
    return { key: r?.key ?? '', columns: r?.columns ?? [], rows: Array.isArray(r?.rows) ? r!.rows : [], truncated: !!r?.truncated };
  }

  // ── Overview: derived figures ───────────────────────────────────────────────────────────────────────────

  private onWells(): void {
    const data = this.wells.data;
    const cols = new Set(data?.columns ?? []);
    // The milestones are the column groups the query returns, in its column order (the list is a tenant setting).
    this.milestones = (data?.columns ?? [])
      .filter(c => c.endsWith('_status') && c !== 'well_slippage_status')
      .map(c => c.slice(0, -'_status'.length))
      .filter(p => cols.has(`${p}_deadline`) || cols.has(`${p}_variance_days`))
      .map(prefix => ({ prefix, label: this.humanise(prefix) }));

    const rows = data?.rows ?? [];
    const counts = new Map<string, number>();
    let worst: number | null = null;
    let dataQuality = 0;
    for (const w of rows) {
      for (const m of this.failed(w)) counts.set(m.prefix, (counts.get(m.prefix) ?? 0) + 1);
      const v = this.worstVariance(w);
      if (v !== null && (worst === null || v > worst)) worst = v;
      if (this.milestones.some(m => this.tone(w[`${m.prefix}_status`]) === 'info')) dataQuality++;
    }
    this.byMilestone = this.milestones.map(m => ({ milestone: m, count: counts.get(m.prefix) ?? 0 }));
    this.maxMilestoneCount = Math.max(1, ...this.byMilestone.map(b => b.count));
    this.kpi = { ...this.kpi, wells: rows.length, worst, dataQuality };
    this.headlines = this.distinct(rows.map(r => r['well_slippage_status']));
    if (this.wellHeadline && !this.headlines.includes(this.wellHeadline)) this.wellHeadline = '';
    if (this.wellMilestone && !this.milestones.some(m => m.prefix === this.wellMilestone)) this.wellMilestone = '';
    this.applyWellFilters(false);
  }

  private onActivity(): void {
    const rows = this.activity.data?.rows ?? [];
    this.activityByWell = new Map(rows.map(r => [this.idKey(r['well_id']), Number(r['delayed_activity_codes'])]));
    const delayed = rows.filter(r => Number(r['delayed_activity_codes']) > 0);
    this.kpi = {
      ...this.kpi,
      wellsWithActivity: delayed.length,
      delayedCodes: delayed.reduce((sum, r) => sum + (Number(r['delayed_activity_codes']) || 0), 0),
    };
    this.applyActivityFilters(false);
    this.applyWellFilters(false);
  }

  private onCrews(): void {
    const rows = this.crews.data?.rows ?? [];
    const counts = new Map<string, number>();
    for (const c of rows) {
      const s = String(c['availability_status'] ?? '');
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    this.crewStatusCounts = [...counts.entries()]
      .map(([value, count]) => ({ value, count, tone: this.tone(value) }))
      .sort((a, b) => b.count - a.count);
    this.crewStatuses = this.distinct(rows.map(r => r['availability_status']));
    this.crewTypes = this.distinct(rows.map(r => r['crew_type_id'])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (this.crewStatus && !this.crewStatuses.includes(this.crewStatus)) this.crewStatus = '';
    if (this.crewType && !this.crewTypes.includes(this.crewType)) this.crewType = '';
    this.applyCrewFilters(false);
  }

  // ── Overview: well table ────────────────────────────────────────────────────────────────────────────────

  applyWellFilters(resetPage = true): void {
    if (resetPage) this.wellPage = 0;
    const needle = this.wellSearch.trim().toLowerCase();
    const rows = (this.wells.data?.rows ?? []).filter(w => {
      if (this.wellMilestone && !this.failed(w).some(m => m.prefix === this.wellMilestone)) return false;
      if (this.wellHeadline && String(w['well_slippage_status'] ?? '') !== this.wellHeadline) return false;
      return !needle || String(w['well_id'] ?? '').toLowerCase().includes(needle);
    });
    const byId = (a: Row, b: Row) => String(a['well_id']).localeCompare(String(b['well_id']), undefined, { numeric: true });
    rows.sort((a, b) => {
      switch (this.wellSort) {
        case 'well': return byId(a, b);
        case 'status': return String(a['well_slippage_status'] ?? '').localeCompare(String(b['well_slippage_status'] ?? '')) || byId(a, b);
        case 'activity': return this.nullLast(this.activityCount(a), this.activityCount(b)) || byId(a, b);
        default: return this.nullLast(this.worstVariance(a), this.worstVariance(b)) || byId(a, b);
      }
    });
    this.wellRows = rows;
    this.wellPage = Math.min(this.wellPage, Math.max(0, this.pages(rows.length, PAGE_SIZE) - 1));
  }

  sortWells(sort: WellSort): void { this.wellSort = sort; this.applyWellFilters(); }

  clearWellFilters(): void {
    this.wellSearch = ''; this.wellMilestone = ''; this.wellHeadline = '';
    this.applyWellFilters();
  }

  get wellPageRows(): Row[] { return this.wellRows.slice(this.wellPage * PAGE_SIZE, (this.wellPage + 1) * PAGE_SIZE); }

  activityCount(w: Row): number | null {
    const n = this.activityByWell.get(this.idKey(w['well_id']));
    return n === undefined || Number.isNaN(n) ? null : n;
  }

  // ── Overview: activity summary ──────────────────────────────────────────────────────────────────────────

  applyActivityFilters(resetPage = true): void {
    if (resetPage) this.activityPage = 0;
    const needle = this.activitySearch.trim().toLowerCase();
    this.activityRows = (this.activity.data?.rows ?? [])
      .filter(r => !needle || String(r['well_id'] ?? '').toLowerCase().includes(needle))
      .sort((a, b) => this.nullLast(this.num(a['delayed_activity_codes']), this.num(b['delayed_activity_codes']))
        || String(a['well_id']).localeCompare(String(b['well_id']), undefined, { numeric: true }));
    this.activityPage = Math.min(this.activityPage, Math.max(0, this.pages(this.activityRows.length, CREW_PAGE_SIZE) - 1));
  }

  get activityPageRows(): Row[] {
    return this.activityRows.slice(this.activityPage * CREW_PAGE_SIZE, (this.activityPage + 1) * CREW_PAGE_SIZE);
  }

  /** The well is in the slippage listing (activity can be delayed on a well whose milestones are on track). */
  isListed(id: unknown): boolean {
    return (this.wells.data?.rows ?? []).some(w => this.sameId(w['well_id'], id));
  }

  // ── Overview: crews ─────────────────────────────────────────────────────────────────────────────────────

  applyCrewFilters(resetPage = true): void {
    if (resetPage) this.crewPage = 0;
    const needle = this.crewSearch.trim().toLowerCase();
    const rows = (this.crews.data?.rows ?? []).filter(c => {
      if (this.crewStatus && String(c['availability_status'] ?? '') !== this.crewStatus) return false;
      if (this.crewType && String(c['crew_type_id'] ?? '') !== this.crewType) return false;
      return !needle || String(c['crew_id'] ?? '').toLowerCase().includes(needle);
    });
    const byId = (a: Row, b: Row) => String(a['crew_id']).localeCompare(String(b['crew_id']), undefined, { numeric: true });
    rows.sort((a, b) => {
      switch (this.crewSort) {
        case 'crew': return byId(a, b);
        case 'overdue': return this.nullLast(this.num(a['overdue_tasks']), this.num(b['overdue_tasks'])) || byId(a, b);
        case 'recent': return String(b['latest_action_on'] ?? '').localeCompare(String(a['latest_action_on'] ?? '')) || byId(a, b);
        default: return this.nullLast(this.num(a['open_tasks']), this.num(b['open_tasks'])) || byId(a, b);
      }
    });
    this.crewRows = rows;
    this.crewPage = Math.min(this.crewPage, Math.max(0, this.pages(rows.length, CREW_PAGE_SIZE) - 1));
  }

  get crewPageRows(): Row[] { return this.crewRows.slice(this.crewPage * CREW_PAGE_SIZE, (this.crewPage + 1) * CREW_PAGE_SIZE); }

  // ── Well lookup and navigation ──────────────────────────────────────────────────────────────────────────

  get lookupValid(): boolean { const v = this.lookup.trim(); return v.length > 0 && v.length <= 100; }

  /** A well id the overview knows nothing about: the lookup still runs (late tasks can exist with milestones on track). */
  get lookupUnknown(): boolean {
    const v = this.lookup.trim();
    if (!v || (!this.wells.data && !this.activity.data)) return false;
    return !this.isListed(v) && !(this.activity.data?.rows ?? []).some(r => this.sameId(r['well_id'], v));
  }

  investigate(event?: Event): void {
    event?.preventDefault();
    this.lookupTouched = true;
    if (!this.lookupValid) return;
    this.openWell(this.lookup.trim());
  }

  openWell(id: unknown): void {
    const well = String(id ?? '').trim();
    if (!well) return;
    this.router.navigate([], { relativeTo: this.route, queryParams: { well }, queryParamsHandling: 'merge' });
  }

  backToOverview(): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: { well: null }, queryParamsHandling: 'merge' });
  }

  private showWell(id: string | null): void {
    if (id === this.wellId) return;
    this.wellId = id;
    this.wellAdvisorSub?.unsubscribe();
    this.taskAdvisorSubs.forEach(s => s.unsubscribe());
    this.taskAdvisorSubs.clear();
    this.taskAdvisors = new Map();
    this.wellAdvisor = this.idleAdvisor();
    this.taskFilter = 'all';
    this.taskSearch = '';
    this.tasks = this.idle();
    this.taskRows = [];
    if (id) {
      this.lookup = id;
      this.loadTasks();
    }
    this.cdr.markForCheck();
  }

  // ── Well view ───────────────────────────────────────────────────────────────────────────────────────────

  /** The well's row in the slippage listing: undefined while it loads, null when the well is not listed. */
  get wellRow(): Row | null | undefined {
    if (!this.wellId) return null;
    if (this.wells.loading && !this.wells.data) return undefined;
    return (this.wells.data?.rows ?? []).find(w => this.sameId(w['well_id'], this.wellId)) ?? null;
  }

  loadTasks(): void {
    const id = this.wellId;
    if (!id) return;
    this.tasksSub?.unsubscribe();
    this.tasks = { loading: true, error: '', data: this.tasks.data };
    this.tasksSub = this.api.slippageQuery<QueryResult>('activity_delay', id).subscribe({
      next: r => {
        if (id !== this.wellId) return;
        this.tasks = { loading: false, error: '', data: this.normaliseResult(r) };
        this.onTasks();
        this.cdr.markForCheck();
      },
      error: err => {
        if (id !== this.wellId) return;
        // Not an empty list: an empty list would say "no late work" when nothing could be measured.
        this.tasks = { loading: false, error: errorText(err, "This well's tasks could not be loaded."), data: null };
        this.onTasks();
        this.cdr.markForCheck();
      },
    });
  }

  private onTasks(): void {
    const rows = this.tasks.data?.rows ?? [];
    const late = rows.filter(t => this.isLate(t));
    let worst: number | null = null;
    for (const t of rows) {
      const v = this.num(t['end_variance_days']);
      if (v !== null && (worst === null || v > worst)) worst = v;
    }
    this.taskKpi = {
      total: rows.length,
      late: late.length,
      bad: rows.filter(t => this.tone(t['schedule_risk']) === 'bad').length,
      execLate: rows.filter(t => this.tone(t['execution_status']) === 'bad').length,
      // Distinct activity CODES among the late tasks; an unmapped task is counted apart, not as a phantom code.
      activities: new Set(late.map(t => t['activity_code']).filter(c => !this.missing(c))).size,
      unmapped: late.filter(t => this.missing(t['activity_code'])).length,
      worst,
    };
    this.taskRiskOptions = this.counted(rows, 'schedule_risk');
    this.taskExecOptions = this.counted(rows, 'execution_status');
    const known = ['all', 'late', ...this.taskRiskOptions.map(o => 'risk:' + o.value), ...this.taskExecOptions.map(o => 'exec:' + o.value)];
    if (!known.includes(this.taskFilter)) this.taskFilter = 'all';
    this.applyTaskFilters();
  }

  applyTaskFilters(): void {
    const needle = this.taskSearch.trim().toLowerCase();
    const f = this.taskFilter;
    this.taskRows = (this.tasks.data?.rows ?? []).filter(t => {
      if (f === 'late' && !this.isLate(t)) return false;
      if (f.startsWith('risk:') && String(t['schedule_risk'] ?? '') !== f.slice(5)) return false;
      if (f.startsWith('exec:') && String(t['execution_status'] ?? '') !== f.slice(5)) return false;
      if (!needle) return true;
      return ['wbs', 'activity_code', 'task_code', 'crew_id', 'crew_type_id']
        .some(k => String(t[k] ?? '').toLowerCase().includes(needle));
    });
  }

  /** A task the advisor can help with: its schedule risk is not on track (unknown values count, so they stay reachable). */
  isLate(t: Row): boolean {
    const risk = t['schedule_risk'];
    return !this.missing(risk) && this.tone(risk) !== 'ok';
  }

  // ── Advisor ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Why is this well delayed and how to overcome it. fresh: ask the AI again instead of reusing a stored answer. */
  askWell(fresh = false): void {
    const id = this.wellId;
    if (!id) return;
    this.wellAdvisorSub?.unsubscribe();
    this.wellAdvisor = { open: true, loading: true, error: '', data: this.wellAdvisor.data };
    this.wellAdvisorSub = this.api.slippageAdvise<WellSuggestion>(id, null, fresh).subscribe({
      next: r => {
        if (id !== this.wellId) return;
        this.wellAdvisor = { open: true, loading: false, error: '', data: r };
        this.cdr.markForCheck();
      },
      error: err => {
        if (id !== this.wellId) return;
        this.wellAdvisor = { open: true, loading: false, error: errorText(err, 'The advisor could not answer. Try again.'), data: null };
        this.cdr.markForCheck();
      },
    });
  }

  toggleWellAdvisor(): void {
    if (this.wellAdvisor.open) { this.closeWellAdvisor(); return; }
    if (this.wellAdvisor.data) { this.wellAdvisor = { ...this.wellAdvisor, open: true }; return; }
    this.askWell(false);
  }

  closeWellAdvisor(): void {
    this.wellAdvisorSub?.unsubscribe();
    this.wellAdvisor = { ...this.wellAdvisor, open: false, loading: false };
  }

  taskState(t: Row): AdvisorState<TaskSuggestion> | undefined { return this.taskAdvisors.get(this.taskKey(t)); }

  toggleTask(t: Row): void {
    const key = this.taskKey(t);
    const state = this.taskAdvisors.get(key);
    if (state?.open) { this.closeTask(t); return; }
    if (state?.data) { this.setTask(key, { ...state, open: true }); return; }
    this.askTask(t, false);
  }

  askTask(t: Row, fresh: boolean): void {
    const id = this.wellId;
    const code = this.taskKey(t);
    if (!id || !code) return;
    this.taskAdvisorSubs.get(code)?.unsubscribe();
    this.setTask(code, { open: true, loading: true, error: '', data: this.taskAdvisors.get(code)?.data ?? null });
    this.taskAdvisorSubs.set(code, this.api.slippageAdvise<TaskSuggestion>(id, code, fresh).subscribe({
      next: r => {
        if (id !== this.wellId) return;
        this.setTask(code, { open: true, loading: false, error: '', data: r });
        this.cdr.markForCheck();
      },
      error: err => {
        if (id !== this.wellId) return;
        this.setTask(code, { open: true, loading: false, error: errorText(err, 'The advisor could not answer. Try again.'), data: null });
        this.cdr.markForCheck();
      },
    }));
  }

  closeTask(t: Row): void {
    const key = this.taskKey(t);
    this.taskAdvisorSubs.get(key)?.unsubscribe();
    const state = this.taskAdvisors.get(key);
    if (state) this.setTask(key, { ...state, open: false, loading: false });
  }

  private setTask(key: string, state: AdvisorState<TaskSuggestion>): void {
    const next = new Map(this.taskAdvisors);
    next.set(key, state);
    this.taskAdvisors = next;
  }

  taskKey(t: Row): string { return String(t['task_code'] ?? '').trim(); }

  taskVerdict(v: string | null | undefined): { label: string; tone: Tone } { return TASK_VERDICT[String(v ?? '')] ?? TASK_VERDICT['unknown']; }
  wellVerdict(v: string | null | undefined): { label: string; tone: Tone } { return WELL_VERDICT[String(v ?? '')] ?? WELL_VERDICT['unknown']; }

  /** The well advisor's actions in their priority order. */
  wellActions(a: WellAdvice): WellAdvice['actions'] {
    return [...(a.actions ?? [])].sort((x, y) => (Number(x.priority) || 0) - (Number(y.priority) || 0));
  }

  /** The milestones of the evidence that failed. */
  failedEvidence(w: WellEvidence | null | undefined): MilestoneEvidence[] {
    return (w?.milestones ?? []).filter(m => this.milestoneFailed(m.status, m.variance_days));
  }

  // ── Show SQL ────────────────────────────────────────────────────────────────────────────────────────────

  toggleSql(): void {
    this.sqlOpen = !this.sqlOpen;
    if (this.sqlOpen && !this.sqlQueries && !this.sqlLoading) this.loadSql();
  }

  loadSql(): void {
    this.sqlLoading = true;
    this.sqlError = '';
    this.api.queries('slippage').pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: q => {
        this.sqlQueries = q ?? [];
        if (!this.sqlQueries.some(x => x.key === this.sqlKey)) this.sqlKey = this.sqlQueries[0]?.key ?? '';
        this.sqlLoading = false;
        this.cdr.markForCheck();
      },
      error: err => {
        this.sqlLoading = false;
        this.sqlError = errorText(err, 'The verified queries could not be loaded.');
        this.cdr.markForCheck();
      },
    });
  }

  get sqlSelected(): AgenticFeatureQuery | undefined { return this.sqlQueries?.find(q => q.key === this.sqlKey); }

  sqlLines(sql: string | null | undefined): number { return sql ? sql.split('\n').length : 0; }

  async copySql(): Promise<void> {
    const sql = this.sqlSelected?.sql;
    if (!sql) return;
    try {
      await navigator.clipboard.writeText(sql);
      this.sqlCopied = true;
      this.cdr.markForCheck();
      setTimeout(() => { this.sqlCopied = false; this.cdr.markForCheck(); }, 1800);
    } catch {
      // Clipboard blocked (insecure context, embedded view): the text stays selectable.
    }
  }

  // ── Milestones ──────────────────────────────────────────────────────────────────────────────────────────

  /** Every milestone this well failed (not only its headline): the headline carries only the first failure. */
  failed(w: Row): Milestone[] {
    return this.milestones.filter(m => this.milestoneFailed(w[`${m.prefix}_status`], w[`${m.prefix}_variance_days`]));
  }

  /** A failed milestone: a red status, or (for a status this page does not know) a positive overrun. */
  milestoneFailed(status: unknown, variance: unknown): boolean {
    const tone = this.tone(status);
    if (tone === 'bad') return true;
    if (tone !== 'neutral' || this.missing(status)) return false;
    const v = this.num(variance);
    return v !== null && v > 0;
  }

  /** The worst overrun among the milestones the well failed. Null variances are skipped, never read as 0. */
  worstVariance(w: Row): number | null {
    let worst: number | null = null;
    for (const m of this.failed(w)) {
      const v = this.num(w[`${m.prefix}_variance_days`]);
      if (v !== null && (worst === null || v > worst)) worst = v;
    }
    return worst;
  }

  // ── Formatting ──────────────────────────────────────────────────────────────────────────────────────────

  tone(value: unknown): Tone {
    if (this.missing(value)) return 'neutral';
    const v = String(value).trim().toUpperCase();
    return STATUS_TONE[v] ?? (v.startsWith('AMBER') ? 'warn' : 'neutral');
  }

  /** A status token as text: "NOT_STARTED_LATE" → "Not started late". The raw token is kept for the tooltip. */
  humanise(value: unknown): string {
    if (this.missing(value)) return EMPTY;
    const s = String(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    // Mixed-case text (e.g. "Slipped - FLAF") is shown as written; only SHOUTED or snake tokens are softened.
    if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s;
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  /** A date as "12 Mar 2026"; a value that is not a date is shown as written. */
  date(value: unknown): string {
    if (this.missing(value)) return EMPTY;
    const text = String(value);
    const d = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(text + 'T00:00:00') : new Date(text);
    if (Number.isNaN(d.getTime())) return text;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  dateTime(value: unknown): string {
    if (this.missing(value)) return EMPTY;
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /** Signed days: a negative variance is early (good), so the sign is always shown. */
  variance(value: unknown): string {
    const v = this.num(value);
    if (v === null) return EMPTY;
    if (v === 0) return '0d';
    return `${v > 0 ? '+' : ''}${Number.isInteger(v) ? v : v.toFixed(1)}d`;
  }

  varianceTone(value: unknown): Tone {
    const v = this.num(value);
    if (v === null || v === 0) return 'neutral';
    return v > 0 ? 'bad' : 'ok';
  }

  number(value: unknown): string {
    const v = this.num(value);
    return v === null ? EMPTY : v.toLocaleString('en-GB');
  }

  percent(value: unknown): string {
    const v = this.num(value);
    return v === null ? EMPTY : `${Math.round(v)}%`;
  }

  /** WBS names carry embedded newlines: collapse whitespace for one-line cells. */
  clean(value: unknown): string {
    if (this.missing(value)) return EMPTY;
    return String(value).split(/\s+/).join(' ').trim() || EMPTY;
  }

  text(value: unknown): string { return this.missing(value) ? EMPTY : String(value); }

  missing(value: unknown): boolean { return value === null || value === undefined || value === ''; }

  barWidth(count: number): number { return Math.round((count / this.maxMilestoneCount) * 100); }

  pages(total: number, size: number): number { return Math.max(1, Math.ceil(total / size)); }

  min(a: number, b: number): number { return Math.min(a, b); }

  goPage(which: 'wells' | 'activity' | 'crews', page: number): void {
    const p = Math.max(0, page);
    if (which === 'wells') this.wellPage = p;
    else if (which === 'activity') this.activityPage = p;
    else this.crewPage = p;
  }

  // ── trackBy ─────────────────────────────────────────────────────────────────────────────────────────────

  trackWell = (_: number, w: Row) => String(w['well_id']);
  trackCrew = (_: number, c: Row) => String(c['crew_id']);
  trackTask = (i: number, t: Row) => `${t['task_code']}-${i}`;
  trackMilestone = (_: number, m: Milestone) => m.prefix;
  trackIndex = (i: number) => i;

  // ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────

  num(value: unknown): number | null {
    if (this.missing(value)) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /** One comparable form of an id: 287, "287" and 287.0 are one well. */
  private idKey(value: unknown): string {
    const n = this.num(value);
    return n !== null && Number.isInteger(n) ? String(n) : String(value ?? '').trim();
  }

  private sameId(a: unknown, b: unknown): boolean {
    return !this.missing(a) && !this.missing(b) && this.idKey(a) === this.idKey(b);
  }

  /** Descending, with nulls last: an unmeasured value is not zero. */
  private nullLast(a: number | null, b: number | null): number {
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return b - a;
  }

  private distinct(values: unknown[]): string[] {
    return [...new Set(values.filter(v => !this.missing(v)).map(v => String(v)))].sort();
  }

  private counted(rows: Row[], column: string): { value: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (this.missing(r[column])) continue;
      const v = String(r[column]);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  }

  private idle(): QueryState { return { loading: false, error: '', data: null }; }
  private idleAdvisor<T>(): AdvisorState<T> { return { open: false, loading: false, error: '', data: null }; }
}
