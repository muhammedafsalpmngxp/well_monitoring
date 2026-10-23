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
const COVERAGE: Record<string, { label: string; tone: Tone; hint: string }> = {
  NO_FREE_CREW: { label: 'No free crew', tone: 'bad', hint: 'Delayed work needs this crew type, but no crew of the type is free' },
  SHORT: { label: 'Short of crews', tone: 'warn', hint: 'Fewer free crews of this type than delayed activities that need it' },
  COVERED: { label: 'Covered', tone: 'ok', hint: 'At least one free crew of this type for every delayed activity that needs it' },
  NO_DELAYED_WORK: { label: 'No delayed work', tone: 'neutral', hint: 'No delayed activity needs this crew type' },
};
const DELAY: Record<string, { label: string; tone: Tone; hint: string }> = {
  OVERDUE_IN_PROGRESS: { label: 'Overdue, in progress', tone: 'bad', hint: 'Started, not finished, and past its target end date' },
  OVERDUE_NOT_STARTED: { label: 'Overdue, not started', tone: 'bad', hint: 'Not started, and already past its target end date' },
  START_SLIPPING: { label: 'Start slipping', tone: 'warn', hint: 'Past its target start date and not started; the target end date has not passed yet' },
  AWAITING_CLOSE_OUT: { label: 'Awaiting close-out', tone: 'info', hint: 'Recorded as 100% done, but the task record is still open' },
};
const ACTION: Record<string, { label: string; tone: Tone; hint: string }> = {
  ASSIGN_FREE_CREW: { label: 'Assign a free crew', tone: 'bad', hint: 'No crew is recorded on this activity: assign one of the free crews listed' },
  ADD_SUPPORT_CREW: { label: 'Add a support crew', tone: 'warn', hint: 'A crew is working on it but it is overdue: a free crew can help it finish' },
  ASSIGNED_CREW_BUSY: { label: 'Recorded crew is busy elsewhere', tone: 'warn', hint: 'The crew recorded on this activity has not started it and is working on another task: wait for it or send a free crew' },
  MOBILISE_ASSIGNED_CREW: { label: 'Mobilise the recorded crew', tone: 'ok', hint: 'The crew recorded on this activity has not started it and is free: send it now' },
  CONFIRM_ASSIGNED_CREW: { label: 'Confirm the recorded crew', tone: 'info', hint: 'The crew recorded on this activity has no recent task record: confirm it is still on the project' },
  CREW_TYPE_NOT_RESOLVED: { label: 'Crew type not resolved', tone: 'neutral', hint: 'The activity is not mapped to a crew type, so no crew can be matched' },
  CLOSE_OUT_RECORD: { label: 'Close out the record', tone: 'info', hint: 'The work is recorded as done: close the task record, no crew is needed' },
};

/**
 * DISPLAY ONLY: a table column in plain words. `sub` is the short qualifier under the header; `help` is the full
 * meaning, shown on hover and in the "What each column means" list. {DAYS} = the recent activity window.
 */
interface Column {
  label: string; sub?: string; help: string; num?: boolean; sort?: CrewSort; dir?: 'ascending' | 'descending';
  hidden?: boolean;
}

const DELAYED_MEANS = 'past a target date and not finished: past the target end date (overdue), or past the target start date without starting (start slipping)';
const FREE_HELP = 'Crews of this type whose whole team has nothing in progress and was recorded on a task in the last {DAYS} days of data. Only free crews are suggested.';
const BUSY_HELP = 'Crews of this type with a task in progress on a live well.';
const TEAM_BUSY_HELP = 'Crews of this type with nothing in progress themselves, while another crew of the same supervisor is working: the same people are busy.';
const INACTIVE_HELP = 'Crews of this type whose team has no task record in the last {DAYS} days of data. They may have left the project and are never suggested.';
const OVERDUE_HELP = 'How many days the latest of these activities is past its target end date, counted to today.';

const PLAN_COLUMNS: Column[] = [
  { label: 'Crew type needed', help: 'The crew type these activities need, from the activity master (or from the task record when the activity is not mapped).' },
  { label: 'Delayed activities', sub: 'on this well', num: true, help: `Activities on this well that need this crew type and are ${DELAYED_MEANS}. Activities awaiting close-out are not counted.` },
  { label: 'Most overdue', sub: 'days past target end', num: true, help: OVERDUE_HELP },
  { label: 'Free crews', sub: 'whole fleet', num: true, help: FREE_HELP },
  { label: 'Busy crews', sub: 'whole fleet', num: true, help: BUSY_HELP },
  { label: 'Team busy', sub: 'whole fleet', num: true, help: TEAM_BUSY_HELP },
  { label: 'Inactive crews', sub: 'whole fleet', num: true, help: INACTIVE_HELP },
  { label: 'Free crews to approach first', sub: 'best first', help: "The best free crews of this type: most past completions of this well's activities first, then the shortest queue, then the most recently recorded." },
];

const TYPE_COLUMNS: Column[] = [
  { label: 'Crew type', help: 'The crew type, from the crew type register.' },
  { label: 'Coverage', help: 'Whether the free crews of this type cover its delayed work. No free crew: delayed work but no free crew. Short of crews: fewer free crews than delayed activities. Covered: at least one free crew per delayed activity. No delayed work: nothing late needs this type.' },
  { label: 'Delayed activities', sub: 'need this type', num: true, help: `Activities on all live wells that need this crew type and are ${DELAYED_MEANS}. Activities awaiting close-out are not counted.` },
  { label: 'Wells', sub: 'with that work', num: true, help: 'How many live wells those delayed activities are on.' },
  { label: 'No crew recorded', sub: 'of the delayed', num: true, help: 'Of those delayed activities, how many have no crew named on their task record.' },
  { label: 'Most overdue', sub: 'days past target end', num: true, help: OVERDUE_HELP },
  { label: 'Free crews', num: true, help: FREE_HELP },
  { label: 'Busy crews', num: true, help: BUSY_HELP },
  { label: 'Team busy', num: true, help: TEAM_BUSY_HELP },
  { label: 'Inactive crews', num: true, help: INACTIVE_HELP },
  { label: 'People', sub: 'each counted once', num: true, help: 'People in the crews of this type. A person on several crews is counted once.' },
  { label: 'Crews', help: 'How many crews have this type. Select it to list them on the crew board below.' },
];

const CREW_COLUMNS: Column[] = [
  { label: 'Crew', sort: 'crew', dir: 'ascending', help: "The crew's id on the daily task records." },
  { label: 'Crew type', help: 'The crew type most often recorded for this crew.' },
  { label: 'Supervisor', help: "The crew's supervisor. All crews of one supervisor are one team: the same people, under one crew id per crew type." },
  { label: 'Availability', sort: 'status', dir: 'ascending', help: 'Free, Busy, Team busy or Inactive, worked out from the task records (see Crew availability above).' },
  { label: 'People', sub: 'National · Expat', help: 'People in this crew, with their nationality where it is recorded.' },
  { label: 'In progress', sub: 'tasks, live wells', num: true, help: 'Tasks this crew has started and not finished, on wells still under construction.' },
  { label: 'Queued', sub: 'tasks not started', num: true, sort: 'queued', dir: 'descending', help: 'Tasks on live wells recorded for this crew that have not started yet: work already waiting for it.' },
  { label: 'Overdue', sub: 'of its open tasks', num: true, sort: 'overdue', dir: 'descending', help: 'Of its in-progress and queued tasks, how many are already past their target end date.' },
  { label: 'Open wells', sub: 'with its open tasks', num: true, help: 'How many different live wells this crew has in-progress or queued tasks on.' },
  { label: 'Completed', sub: 'tasks, all time', num: true, help: 'Tasks this crew has completed, on every well.' },
  { label: 'Last task record', sort: 'recent', dir: 'ascending', help: "The date of this crew's latest task record, and how far that is behind the newest record in the data." },
];

const WELL_COLUMNS: Column[] = [
  { label: 'Well', help: "The well id. Select it to open the well's crew plan." },
  { label: 'Delayed activities', sub: 'need work', num: true, help: `Activities on this well that are ${DELAYED_MEANS}.` },
  { label: 'No crew recorded', sub: 'of the delayed', num: true, help: 'Of those delayed activities, how many have no crew named on their task record.' },
  { label: 'Awaiting close-out', sub: 'done, record open', num: true, help: 'Activities recorded as 100% done whose task record is still open. They need the record closed, not a crew, and are not counted as delayed.' },
  { label: 'Most overdue', sub: 'days past target end', num: true, help: 'How many days the latest delayed activity on this well is past its target end date, counted to today.' },
  { label: 'Expected rig-on', sub: 'planned date', help: 'The date the rig is planned to arrive on the well.' },
  { label: 'Last task record', sub: 'this well', help: 'The date of the newest task record for this well. When it is old, the delays are as last recorded and may have moved since.' },
  { label: 'Open', hidden: true, help: '' },
];

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
  readonly planColumns = PLAN_COLUMNS;
  readonly typeColumns = TYPE_COLUMNS;
  readonly crewColumns = CREW_COLUMNS;
  readonly wellColumns = WELL_COLUMNS;
  readonly delayedMeans = DELAYED_MEANS;

  overview: Load<Overview> = { loading: false, error: '', data: null };
  loadedAt: Date | null = null;

  // Capacity
  coverageFilter = '';
  typeSearch = '';
  typeRows: CrewTypeCapacity[] = [];
  idleTypeRows: CrewTypeCapacity[] = [];   // crew types with no delayed work: one collapsed group row
  showIdleTypes = false;

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
    const rows = (this.overview.data?.crew_types ?? []).filter(t =>
      (!this.coverageFilter || t.coverage === this.coverageFilter) &&
      (!q || `${t.crew_type_code ?? ''} ${t.crew_type_name ?? ''}`.toLowerCase().includes(q)));
    // Unless the Coverage filter asks for them, types with no delayed work go in one collapsed group: nothing to act on.
    const group = !this.coverageFilter;
    this.typeRows = group ? rows.filter(t => t.coverage !== 'NO_DELAYED_WORK') : rows;
    this.idleTypeRows = group ? rows.filter(t => t.coverage === 'NO_DELAYED_WORK') : [];
  }

  toggleIdleTypes(): void { this.showIdleTypes = !this.showIdleTypes; }

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
  coverage(v: string) { return COVERAGE[v] ?? { label: v, tone: 'neutral' as Tone, hint: '' }; }
  delay(v: string) { return DELAY[v] ?? { label: v, tone: 'neutral' as Tone, hint: '' }; }
  action(v: string) { return ACTION[v] ?? { label: v, tone: 'neutral' as Tone, hint: '' }; }

  typeLabel(code: string | null | undefined, name: string | null | undefined, id?: number | null): string {
    if (code && name) return `${code} · ${name}`;
    return code || name || (id != null ? `Crew type ${id}` : 'Crew type not resolved');
  }

  /** A column's full meaning, with the recent activity window filled in. */
  help(c: Column): string {
    const days = this.overview.data?.rules.crew_recent_days ?? this.plan.data?.rules.crew_recent_days ?? 90;
    return c.help.replace(/\{DAYS\}/g, String(days));
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
