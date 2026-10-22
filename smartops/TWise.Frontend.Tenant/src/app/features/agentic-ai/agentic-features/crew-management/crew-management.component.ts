import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { markdownToHtml } from '../../../../core/utils/markdown.util';
import { AgenticFeaturesService, errorText } from '../agentic-features.service';

// ── Response shapes (agent runtime: app/features/crew/engine.py and api.py, passed through by the Tenant API) ──

type Availability = 'FREE' | 'BUSY' | 'TEAM_BUSY' | 'INACTIVE';
type Coverage = 'NO_FREE_CREW' | 'SHORT' | 'COVERED' | 'NO_DELAYED_WORK';
type Tone = 'bad' | 'warn' | 'ok' | 'info' | 'neutral';

interface Rules { crew_recent_days: number; free_crew_definition: string; ranking: string }

/** One crew of the crew board (crew_board: a task_daily crew_id, never the ref.crew code text). */
interface Crew {
  crew_id: number; crew_type_id: number | null; crew_type_code: string | null; crew_type_name: string | null;
  supervisor_id: number | null; supervisor: string | null;
  members: number | null; national_members: number | null; expat_members: number | null;
  tasks_recorded: number; in_progress_tasks: number; queued_tasks: number; overdue_open_tasks: number;
  completed_tasks: number; open_wells: number; last_recorded_on: string | null; days_since_last_record: number | null;
  availability_status: Availability;
}

/** Free crews of a type against the delayed work that needs it. */
interface CrewTypeCapacity {
  crew_type_id: number; crew_type_code: string | null; crew_type_name: string | null;
  crews: number; free: number; busy: number; team_busy: number; inactive: number; members: number;
  queued_tasks: number; in_progress_tasks: number;
  delayed_activities: number; wells: number; without_recorded_crew: number; overdue: number; start_slipping: number;
  max_days_overdue: number; coverage: Coverage; free_shortfall: number;
}

interface WellRow {
  well_id: number; project_id: number | null; ex_rig_on_date: string | null; rig_on_date: string | null;
  delayed_activities: number; without_recorded_crew: number; awaiting_close_out: number; max_days_overdue: number | null;
  last_recorded_on: string | null;
}

interface Overview {
  as_of: string; data_as_of: string | null; rules: Rules; truncated: boolean;
  kpis: {
    crews: number; free: number; busy: number; team_busy: number; inactive: number; members: number;
    wells_with_delays: number; delayed_activities: number; without_recorded_crew: number; awaiting_close_out: number;
    crew_types_short: number; crew_type_not_resolved: number;
  };
  crew_types: CrewTypeCapacity[];
  crews: Crew[];
  wells: WellRow[];
}

interface Experience {
  completed_count: number; distinct_wells: number; typical_completion_days: number | null;
  average_completion_days: number | null; last_completed_on: string | null;
}

interface Candidate {
  crew_id: number; supervisor_id: number | null; supervisor: string | null; availability_status: Availability;
  members: number | null; queued_tasks: number; completed_tasks: number; tasks_recorded: number;
  last_recorded_on: string | null; days_since_last_record: number | null; activity_experience: Experience | null;
  same_team_top_pick_for?: string[]; completed_this_wells_activities?: number;
}

interface Activity {
  task_code: string; activity_id: string | null; activity_code: string | null; activity_description: string | null;
  wbs: string | null; target_start: string | null; target_end: string | null; actual_start: string | null;
  last_recorded_on: string | null; delay_status: string; days_overdue: number; start_variance_days: number | null;
  assigned_crew: {
    recorded: boolean; crew_id: number | null; supervisor: string | null; availability_status: Availability | null;
    in_progress_tasks: number | null; queued_tasks: number | null; last_recorded_on: string | null;
  };
  required_crew_type: { crew_type_id: number | null; crew_type_code: string | null; crew_type_name: string | null; source: string };
  action: string; recommended_crews: Candidate[]; free_crews_available: number; no_recommendation_reason: string | null;
}

interface WellPlan {
  well_id: number; project_id: number | null; well_status: 'LIVE' | 'COMPLETED'; ex_rig_on_date: string | null;
  rig_on_date: string | null; as_of: string; data_as_of: string | null; well_last_recorded_on: string | null;
  stale_record_days: number; rules: Rules;
  summary: {
    delayed_activities: number; awaiting_close_out: number; overdue: number; start_slipping: number;
    without_recorded_crew: number; crew_type_not_resolved: number; with_free_crew: number; without_free_crew: number;
    max_days_overdue: number;
  };
  activities: Activity[];
  crew_types: {
    crew_type_id: number; crew_type_code: string | null; crew_type_name: string | null; delayed_activities: number;
    max_days_overdue: number; free: number; busy: number; team_busy: number; inactive: number; free_crews: Candidate[];
  }[];
}

interface Brief { well_id: number; brief: string | null; brief_error: string | null; unverified_references: string[]; plan: WellPlan }

interface Load<T> { loading: boolean; error: string; data: T | null }

type CrewSort = 'status' | 'crew' | 'queued' | 'overdue' | 'recent';

/** DISPLAY ONLY: labels and tones of the values the crew engine reports. An unknown value is shown as written. */
const AVAILABILITY: Record<string, { label: string; tone: Tone; hint: string }> = {
  FREE: { label: 'Free', tone: 'ok', hint: 'No work in progress for the whole team, recorded recently' },
  BUSY: { label: 'Busy', tone: 'warn', hint: 'Has a task in progress on a live well' },
  TEAM_BUSY: { label: 'Team busy', tone: 'info', hint: 'Another crew of the same supervisor is at work' },
  INACTIVE: { label: 'Inactive', tone: 'neutral', hint: 'No team task record in the recent window' },
};
const COVERAGE: Record<string, { label: string; tone: Tone }> = {
  NO_FREE_CREW: { label: 'No free crew', tone: 'bad' },
  SHORT: { label: 'Short of crews', tone: 'warn' },
  COVERED: { label: 'Covered', tone: 'ok' },
  NO_DELAYED_WORK: { label: 'No delayed work', tone: 'neutral' },
};
const DELAY: Record<string, { label: string; tone: Tone }> = {
  OVERDUE_IN_PROGRESS: { label: 'Overdue, in progress', tone: 'bad' },
  OVERDUE_NOT_STARTED: { label: 'Overdue, not started', tone: 'bad' },
  START_SLIPPING: { label: 'Start slipping', tone: 'warn' },
  AWAITING_CLOSE_OUT: { label: 'Awaiting close-out', tone: 'info' },
};
const ACTION: Record<string, { label: string; tone: Tone }> = {
  ASSIGN_FREE_CREW: { label: 'Assign a free crew', tone: 'bad' },
  ADD_SUPPORT_CREW: { label: 'Add a support crew', tone: 'warn' },
  ASSIGNED_CREW_BUSY: { label: 'Recorded crew is busy elsewhere', tone: 'warn' },
  MOBILISE_ASSIGNED_CREW: { label: 'Mobilise the recorded crew', tone: 'ok' },
  CONFIRM_ASSIGNED_CREW: { label: 'Confirm the recorded crew', tone: 'info' },
  CREW_TYPE_NOT_RESOLVED: { label: 'Crew type not resolved', tone: 'neutral' },
  CLOSE_OUT_RECORD: { label: 'Close out the record', tone: 'info' },
};
const STATUS_ORDER: Record<string, number> = { FREE: 0, TEAM_BUSY: 1, BUSY: 2, INACTIVE: 3 };

const EMPTY = '—';
const CREW_PAGE = 25;
const WELL_PAGE = 15;

/**
 * Agentic AI → Agentic Features → Crew Management.
 *
 * Overview: every crew seen on a task with its derived availability (free / busy / team busy / inactive), its team and
 * workload; crew capacity against the delayed work each crew type is needed for; and the live wells with delayed
 * activities. Well view (?well=<id>): each delayed activity with the crew recorded on it, what the planner should do,
 * and the free crews of the right type ranked by same-activity experience, plus an AI brief that narrates the plan.
 * Everything except the brief is computed by the verified SQL and the crew engine; nothing is ever assigned.
 */
@Component({
  selector: 'app-crew-management',
  standalone: false,
  templateUrl: './crew-management.component.html',
  styleUrls: ['./crew-management.component.scss'],
})
export class CrewManagementComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(AgenticFeaturesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly breadcrumbs = [{ label: 'Home' }, { label: 'Agentic AI' }, { label: 'Agentic Features', route: '/agentic-ai/features' }, { label: 'Crew Management' }];
  readonly empty = EMPTY;
  readonly availabilityKeys: Availability[] = ['FREE', 'BUSY', 'TEAM_BUSY', 'INACTIVE'];
  readonly crewPage = CREW_PAGE;
  readonly wellPageSize = WELL_PAGE;

  overview: Load<Overview> = { loading: false, error: '', data: null };
  loadedAt: Date | null = null;

  // Capacity
  coverageFilter = '';
  typeSearch = '';
  typeRows: CrewTypeCapacity[] = [];

  // Crew board
  crewSearch = '';
  crewStatus = '';
  crewType = '';
  crewSort: CrewSort = 'status';
  crewPageIndex = 0;
  crewRows: Crew[] = [];
  crewTypeOptions: { id: number; label: string }[] = [];

  // Wells
  wellSearch = '';
  wellPageIndex = 0;
  wellRows: WellRow[] = [];
  lookup = '';
  lookupTouched = false;

  // Well view
  wellId: string | null = null;
  plan: Load<WellPlan> = { loading: false, error: '', data: null };
  showCloseOut = false;
  brief: Load<Brief> & { open: boolean; html: string } = { open: false, loading: false, error: '', data: null, html: '' };
  private planSub?: Subscription;
  private briefSub?: Subscription;

  ngOnInit(): void {
    this.loadOverview(false);
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const id = (params.get('well') ?? '').trim();
      this.showWell(id || null);
    });
    this.destroyRef.onDestroy(() => { this.planSub?.unsubscribe(); this.briefSub?.unsubscribe(); });
  }

  // ── Loading ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Refresh reads the fleet-wide results again (the server keeps them a few minutes). */
  refresh(): void {
    this.loadOverview(true);
    if (this.wellId) this.loadPlan(true);
  }

  loadOverview(fresh: boolean): void {
    this.overview = { loading: true, error: '', data: this.overview.data };
    this.api.crewOverview<Overview>(fresh).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => {
        this.overview = { loading: false, error: '', data };
        this.loadedAt = new Date();
        this.crewTypeOptions = data.crew_types
          .filter(t => t.crews > 0)
          .map(t => ({ id: t.crew_type_id, label: this.typeLabel(t.crew_type_code, t.crew_type_name, t.crew_type_id) }))
          .sort((a, b) => a.label.localeCompare(b.label));
        this.applyTypes();
        this.applyCrews();
        this.applyWells();
        this.cdr.markForCheck();
      },
      error: err => {
        this.overview = { loading: false, error: errorText(err, 'The crew overview could not be loaded.'), data: null };
        this.cdr.markForCheck();
      },
    });
  }

  private loadPlan(fresh: boolean): void {
    if (!this.wellId) return;
    this.planSub?.unsubscribe();
    this.plan = { loading: true, error: '', data: null };
    this.planSub = this.api.crewWell<WellPlan>(this.wellId, fresh).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => { this.plan = { loading: false, error: '', data }; this.cdr.markForCheck(); },
      error: err => {
        const msg = err?.status === 404 ? `Well ${this.wellId} was not found.` : errorText(err, 'The crew plan of this well could not be loaded.');
        this.plan = { loading: false, error: msg, data: null };
        this.cdr.markForCheck();
      },
    });
  }

  // ── Navigation ──────────────────────────────────────────────────────────────────────────────────────────

  openWell(id: number | string): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: { well: String(id) } });
  }

  backToOverview(): void {
    this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  submitLookup(): void {
    this.lookupTouched = true;
    if (this.lookupValid) this.openWell(this.lookup.trim());
  }

  get lookupValid(): boolean { return /^\d{1,20}$/.test(this.lookup.trim()) && Number(this.lookup.trim()) > 0; }

  private showWell(id: string | null): void {
    this.briefSub?.unsubscribe();
    this.brief = { open: false, loading: false, error: '', data: null, html: '' };
    this.showCloseOut = false;
    this.wellId = id;
    if (id) {
      this.loadPlan(false);
      window.scrollTo({ top: 0 });
    } else {
      this.planSub?.unsubscribe();
      this.plan = { loading: false, error: '', data: null };
    }
  }

  // ── Capacity table ──────────────────────────────────────────────────────────────────────────────────────

  applyTypes(): void {
    const q = this.typeSearch.trim().toLowerCase();
    this.typeRows = (this.overview.data?.crew_types ?? []).filter(t =>
      (!this.coverageFilter || t.coverage === this.coverageFilter) &&
      (!q || `${t.crew_type_code ?? ''} ${t.crew_type_name ?? ''}`.toLowerCase().includes(q)));
  }

  /** Show the crews of one type on the crew board. */
  showTypeCrews(t: CrewTypeCapacity): void {
    this.crewType = String(t.crew_type_id);
    this.crewStatus = '';
    this.crewSearch = '';
    this.applyCrews();
    document.getElementById('cm-board')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Crew board ──────────────────────────────────────────────────────────────────────────────────────────

  applyCrews(resetPage = true): void {
    const q = this.crewSearch.trim().toLowerCase();
    const rows = (this.overview.data?.crews ?? []).filter(c =>
      (!this.crewStatus || c.availability_status === this.crewStatus) &&
      (!this.crewType || String(c.crew_type_id) === this.crewType) &&
      (!q || `crew ${c.crew_id} ${c.supervisor ?? ''} ${c.crew_type_code ?? ''} ${c.crew_type_name ?? ''}`.toLowerCase().includes(q)));
    const by: Record<CrewSort, (a: Crew, b: Crew) => number> = {
      status: (a, b) => (STATUS_ORDER[a.availability_status] ?? 9) - (STATUS_ORDER[b.availability_status] ?? 9) || a.queued_tasks - b.queued_tasks || a.crew_id - b.crew_id,
      crew: (a, b) => a.crew_id - b.crew_id,
      queued: (a, b) => b.queued_tasks - a.queued_tasks || a.crew_id - b.crew_id,
      overdue: (a, b) => b.overdue_open_tasks - a.overdue_open_tasks || a.crew_id - b.crew_id,
      recent: (a, b) => (a.days_since_last_record ?? 1e9) - (b.days_since_last_record ?? 1e9) || a.crew_id - b.crew_id,
    };
    this.crewRows = rows.sort(by[this.crewSort]);
    if (resetPage) this.crewPageIndex = 0;
  }

  sortCrews(sort: CrewSort): void { this.crewSort = sort; this.applyCrews(); }

  clearCrewFilters(): void { this.crewSearch = ''; this.crewStatus = ''; this.crewType = ''; this.applyCrews(); }

  get crewFiltered(): boolean { return !!(this.crewSearch || this.crewStatus || this.crewType); }

  get crewPageRows(): Crew[] { return this.crewRows.slice(this.crewPageIndex * CREW_PAGE, (this.crewPageIndex + 1) * CREW_PAGE); }

  get crewPages(): number { return Math.max(1, Math.ceil(this.crewRows.length / CREW_PAGE)); }

  /** Width of each availability segment of the fleet bar, in percent. */
  share(status: Availability): number {
    const k = this.overview.data?.kpis;
    if (!k || !k.crews) return 0;
    const n = status === 'FREE' ? k.free : status === 'BUSY' ? k.busy : status === 'TEAM_BUSY' ? k.team_busy : k.inactive;
    return (n / k.crews) * 100;
  }

  count(status: Availability): number {
    const k = this.overview.data?.kpis;
    if (!k) return 0;
    return status === 'FREE' ? k.free : status === 'BUSY' ? k.busy : status === 'TEAM_BUSY' ? k.team_busy : k.inactive;
  }

  filterStatus(status: Availability): void {
    this.crewStatus = this.crewStatus === status ? '' : status;
    this.applyCrews();
    document.getElementById('cm-board')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Wells ───────────────────────────────────────────────────────────────────────────────────────────────

  applyWells(): void {
    const q = this.wellSearch.trim();
    this.wellRows = (this.overview.data?.wells ?? []).filter(w => !q || String(w.well_id).includes(q));
    this.wellPageIndex = 0;
  }

  get wellPageRows(): WellRow[] { return this.wellRows.slice(this.wellPageIndex * WELL_PAGE, (this.wellPageIndex + 1) * WELL_PAGE); }

  get wellPages(): number { return Math.max(1, Math.ceil(this.wellRows.length / WELL_PAGE)); }

  // ── Well view ───────────────────────────────────────────────────────────────────────────────────────────

  get needCrew(): Activity[] { return (this.plan.data?.activities ?? []).filter(a => a.action !== 'CLOSE_OUT_RECORD'); }

  get closeOut(): Activity[] { return (this.plan.data?.activities ?? []).filter(a => a.action === 'CLOSE_OUT_RECORD'); }

  /** The well's records are older than the stale threshold: its delays are as last recorded. */
  get staleDays(): number | null {
    const p = this.plan.data;
    if (!p?.well_last_recorded_on) return null;
    const days = Math.round((Date.parse(p.as_of) - Date.parse(p.well_last_recorded_on)) / 86_400_000);
    return days > p.stale_record_days ? days : null;
  }

  writeBrief(): void {
    if (!this.wellId) return;
    this.briefSub?.unsubscribe();
    this.brief = { open: true, loading: true, error: '', data: null, html: '' };
    this.briefSub = this.api.crewBrief<Brief>(this.wellId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => {
        this.brief = { open: true, loading: false, error: data.brief_error ?? '', data, html: data.brief ? markdownToHtml(data.brief) : '' };
        this.cdr.markForCheck();
      },
      error: err => {
        this.brief = { open: true, loading: false, error: errorText(err, 'The crew brief could not be written.'), data: null, html: '' };
        this.cdr.markForCheck();
      },
    });
  }

  closeBrief(): void { this.briefSub?.unsubscribe(); this.brief = { open: false, loading: false, error: '', data: null, html: '' }; }

  // ── Display helpers ─────────────────────────────────────────────────────────────────────────────────────

  availability(v: string | null | undefined) { return (v && AVAILABILITY[v]) || { label: v ?? EMPTY, tone: 'neutral' as Tone, hint: '' }; }
  coverage(v: string) { return COVERAGE[v] ?? { label: v, tone: 'neutral' as Tone }; }
  delay(v: string) { return DELAY[v] ?? { label: v, tone: 'neutral' as Tone }; }
  action(v: string) { return ACTION[v] ?? { label: v, tone: 'neutral' as Tone }; }

  typeLabel(code: string | null | undefined, name: string | null | undefined, id?: number | null): string {
    if (code && name) return `${code} · ${name}`;
    return code || name || (id != null ? `Crew type ${id}` : 'Crew type not resolved');
  }

  activityName(a: Activity): string { return a.activity_description || a.wbs || a.activity_id || a.task_code; }

  date(v: string | null | undefined): string {
    if (!v) return EMPTY;
    const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
    return isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  }

  num(v: number | null | undefined): string { return v === null || v === undefined ? EMPTY : String(v); }

  days(v: number | null | undefined): string {
    if (v === null || v === undefined) return EMPTY;
    return v === 1 ? '1 day' : `${v} days`;
  }

  team(c: { members: number | null; national_members?: number | null; expat_members?: number | null }): string {
    if (!c.members) return EMPTY;
    const parts = [];
    if (c.national_members) parts.push(`${c.national_members} National`);
    if (c.expat_members) parts.push(`${c.expat_members} Expat`);
    const other = c.members - (c.national_members ?? 0) - (c.expat_members ?? 0);
    if (other > 0) parts.push(`${other} not recorded`);
    return parts.length ? parts.join(' · ') : '';
  }

  trackCrew(_: number, c: { crew_id: number }): number { return c.crew_id; }
  trackType(_: number, t: { crew_type_id: number }): number { return t.crew_type_id; }
  trackWell(_: number, w: WellRow): number { return w.well_id; }
  trackActivity(_: number, a: Activity): string { return a.task_code; }
}
