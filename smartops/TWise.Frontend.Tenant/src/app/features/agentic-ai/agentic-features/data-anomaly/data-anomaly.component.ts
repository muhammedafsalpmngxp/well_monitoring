import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subscription } from 'rxjs';
import type Highcharts from 'highcharts';
import { PermissionService } from '../../../../core/services/permission.service';
import { AgenticFeaturesService, AiFeatureJob, errorText, saveFile } from '../agentic-features.service';
import {
  AnomalyCheck, AnomalyOverview, AnomalyProposal, AnomalyRule, AnomalyRun, AnomalyRunSummary, Load, PROPOSAL_STATUSES, RULE_STATUSES,
  RankedFinding, RunResult, SEVERITIES, SchemaInfo, TextBlock, asText, idle, jobActive, jobPercent, label, sevClass,
  severityRank, statusTone, toBlocks,
} from './data-anomaly.models';

type Tab = 'overview' | 'findings' | 'runs' | 'rules' | 'proposals' | 'schema';
type JobKind = 'compile' | 'run' | 'discover';
type Format = 'xlsx' | 'docx';

const MODULE = 'agentic-ai.data-anomaly';
const POLL_MS = 3000;
const SEVERITY_COLOURS: Record<string, string> = { critical: '#b42318', high: '#c4320a', medium: '#b54708', low: '#475467' };

/**
 * Agentic AI → Agentic Features → Data Anomaly: the data-quality score of the latest run, its findings ranked worst
 * first, run history with Excel / Word reports, the rules and their compiled checks, the rules Discover proposed, and
 * the jobs (compile / run / discover) the server's worker runs: one at a time, polled while active.
 * Every figure is the engine's; this page computes none of them.
 */
@Component({
  selector: 'app-data-anomaly',
  standalone: false,
  templateUrl: './data-anomaly.component.html',
  styleUrls: ['./data-anomaly.component.scss'],
})
export class DataAnomalyComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  readonly breadcrumbs = [{ label: 'Home' }, { label: 'Agentic AI' }, { label: 'Agentic Features', route: '/agentic-ai/features' }, { label: 'Data Anomaly' }];

  // template helpers
  readonly label = label;
  readonly sevClass = sevClass;
  readonly statusTone = statusTone;
  readonly asText = asText;
  readonly jobPercent = jobPercent;
  readonly severities = SEVERITIES;
  readonly ruleStatuses = RULE_STATUSES;
  readonly proposalStatuses = PROPOSAL_STATUSES;
  readonly tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' }, { id: 'findings', label: 'Findings' }, { id: 'runs', label: 'Runs' },
    { id: 'rules', label: 'Rules' }, { id: 'proposals', label: 'Proposals' }, { id: 'schema', label: 'Schema' },
  ];

  tab: Tab = 'overview';

  overview: Load<AnomalyOverview> = idle();
  runs: Load<AnomalyRunSummary[]> = idle();
  rules: Load<AnomalyRule[]> = idle();
  proposals: Load<AnomalyProposal[]> = idle();
  schema: Load<SchemaInfo> = idle();

  /** The run shown under Findings (the latest, or one picked from Runs). */
  run: Load<AnomalyRun> = idle();
  selectedRunId: string | null = null;
  summaryBlocks: TextBlock[] = [];
  scoreChart: Highcharts.Options | null = null;
  severityChart: Highcharts.Options | null = null;
  categoryChart: Highcharts.Options | null = null;
  readonly openFindings = new Set<string>();

  // jobs
  job: AiFeatureJob | null = null;
  lastJob: AiFeatureJob | null = null;
  jobError = '';
  starting: JobKind | null = null;
  confirmCancel = false;
  cancelling = false;
  compileOpts = { retryFailed: false, force: false };
  /** Every run builds both reports: there is nothing to choose before running. */
  private readonly runFormats: Format[] = ['xlsx', 'docx'];
  maxProposals = 10;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollSub: Subscription | null = null;
  private destroyed = false;

  // downloads
  downloading: string | null = null;
  downloadError = '';

  // compiled SQL of a finding / rule, loaded when it is first opened
  private readonly checkLoads = new Map<string, Load<AnomalyCheck[]>>();
  copied: string | null = null;
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  // rules
  ruleSearch = '';
  ruleCategory = '';
  ruleSeverity = '';
  ruleStatus = '';
  ruleProbe = '';
  ruleCategories: string[] = [];
  filteredRules: AnomalyRule[] = [];
  selectedRule: AnomalyRule | null = null;
  ruleNewStatus = '';
  ruleSaving = false;
  ruleMessage = '';
  ruleError = '';

  // proposals
  proposalFilter = 'pending';
  readonly acceptForm = new Map<number, { ruleId: string; status: string }>();
  readonly rejectReason = new Map<number, string>();
  deciding: number | null = null;
  decideError = new Map<number, string>();
  confirmReject: AnomalyProposal | null = null;

  constructor(private readonly api: AgenticFeaturesService, private readonly permissions: PermissionService,
              private readonly cdr: ChangeDetectorRef) {}

  get canCreate(): boolean { return this.permissions.canCreate(MODULE); }
  get canModify(): boolean { return this.permissions.canModify(MODULE); }
  get isAdmin(): boolean { return this.permissions.isAdminUser; }
  get jobRunning(): boolean { return jobActive(this.job); }
  get configured(): boolean { return this.overview.data?.configured ?? true; }
  get aiEnabled(): boolean { return this.overview.data?.aiEnabled ?? true; }
  get result(): RunResult | null { return this.run.data?.result ?? null; }

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => { this.destroyed = true; this.stopPolling(); });
    this.loadOverview(true);
    this.loadRuns();
  }

  // ── Loading ──────────────────────────────────────────────────────────────────────────────────────────────────

  private load<T>(state: Load<T>, call: Observable<T>, fallback: string, done?: (data: T) => void): Subscription {
    state.loading = true;
    state.error = '';
    this.cdr.markForCheck();
    return call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => { state.loading = false; state.data = data; done?.(data); this.cdr.markForCheck(); },
      error: err => { state.loading = false; state.error = errorText(err, fallback); this.cdr.markForCheck(); },
    });
  }

  /** The dashboard; first: also pick up the job in progress and show the latest run. */
  loadOverview(first = false): void {
    this.load(this.overview, this.api.anomalyOverview<AnomalyOverview>(), 'The Data Anomaly overview could not be loaded.', o => {
      this.lastJob = o.lastJob ?? this.lastJob;
      if (o.activeJob && jobActive(o.activeJob) && !this.jobRunning) this.track(o.activeJob);
      if (first || (!this.selectedRunId && o.latestRun)) {
        if (o.latestRun) this.selectRun(o.latestRun.runId, false);
        else { this.run = idle(); this.buildCharts(); }
      }
    });
  }

  loadRuns(): void {
    this.load(this.runs, this.api.anomalyRuns<AnomalyRunSummary[]>(30), 'The runs could not be loaded.');
  }

  loadRules(): void {
    this.load(this.rules, this.api.anomalyRules<AnomalyRule[]>(), 'The rules could not be loaded.', list => {
      this.ruleCategories = [...new Set(list.map(r => r.category).filter((c): c is string => !!c))].sort();
      if (this.selectedRule) this.selectedRule = list.find(r => r.ruleId === this.selectedRule!.ruleId) ?? null;
      this.filterRules();
    });
  }

  loadProposals(): void {
    this.load(this.proposals, this.api.anomalyProposals<AnomalyProposal[]>(this.proposalFilter || undefined),
      'The proposals could not be loaded.');
  }

  loadSchema(refresh = false): void {
    this.load(this.schema, this.api.anomalySchema<SchemaInfo>(refresh), 'The schema description could not be loaded.');
  }

  setTab(t: Tab): void {
    this.tab = t;
    if (t === 'rules' && !this.rules.data && !this.rules.loading) this.loadRules();
    if (t === 'proposals' && !this.proposals.data && !this.proposals.loading) this.loadProposals();
    if (t === 'schema' && !this.schema.data && !this.schema.loading) this.loadSchema();
    if (t === 'runs' && !this.runs.data && !this.runs.loading) this.loadRuns();
  }

  /** Loads one run into Findings (and the Overview charts). */
  selectRun(runId: string, show = true): void {
    this.selectedRunId = runId;
    this.openFindings.clear();
    if (show) this.tab = 'findings';
    this.load(this.run, this.api.anomalyRun<AnomalyRun>(runId), 'The run could not be loaded.', () => this.buildCharts());
  }

  get isLatestRun(): boolean {
    return !!this.selectedRunId && this.selectedRunId === this.overview.data?.latestRun?.runId;
  }

  // ── Charts ───────────────────────────────────────────────────────────────────────────────────────────────────

  private buildCharts(): void {
    const r = this.result;
    this.summaryBlocks = toBlocks(r?.summary);
    // A failed run, or one where no check ran, has no score (the formula would read 100 on no data).
    const ran = this.run.data?.run.status !== 'failed' && !r?.error && (r?.totals?.probes_run ?? 0) > 0;
    const score = ran ? (r?.score ?? this.run.data?.run.score ?? null) : null;
    this.scoreChart = score == null ? null : {
      chart: { type: 'solidgauge', height: 190, backgroundColor: 'transparent', spacing: [0, 0, 0, 0] },
      title: { text: undefined }, credits: { enabled: false }, exporting: { enabled: false },
      accessibility: { description: `Data-quality score ${score} out of 100. ${r?.score_basis ?? ''}` },
      tooltip: { enabled: !!r?.score_basis, useHTML: false, outside: true,
        formatter: function () { return r?.score_basis ?? ''; } } as Highcharts.TooltipOptions,
      pane: { center: ['50%', '80%'], size: '150%', startAngle: -90, endAngle: 90,
        background: [{ backgroundColor: '#f2f4f7', innerRadius: '62%', outerRadius: '100%', shape: 'arc', borderWidth: 0 }] },
      yAxis: { min: 0, max: 100, lineWidth: 0, tickWidth: 0, minorTickInterval: undefined, tickAmount: 2,
        labels: { y: 14, style: { color: '#667085' } },
        stops: [[0.5, '#b42318'], [0.75, '#b54708'], [0.9, '#21409a'], [1, '#067647']] },
      plotOptions: { solidgauge: { innerRadius: '62%', dataLabels: { y: -28, borderWidth: 0, useHTML: false,
        format: '<span style="font-size:26px;color:#101828">{y}</span>' } } },
      series: [{ type: 'solidgauge', name: 'Score', data: [score] }],
    } as Highcharts.Options;

    const bySev = r?.by_severity ?? {};
    const sevKeys = [...SEVERITIES.filter(s => s in bySev), ...Object.keys(bySev).filter(k => !(SEVERITIES as string[]).includes(k))];
    this.severityChart = !sevKeys.length ? null : {
      chart: { type: 'column', height: 220, backgroundColor: 'transparent' },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false }, exporting: { enabled: false },
      xAxis: { categories: sevKeys.map(label), lineColor: '#e4e7ec' },
      yAxis: { title: { text: 'Checks with findings' }, allowDecimals: false, gridLineColor: '#f2f4f7' },
      tooltip: { pointFormat: '<b>{point.y}</b> checks with findings' },
      series: [{ type: 'column', name: 'Checks with findings', borderRadius: 3,
        data: sevKeys.map(k => ({ y: bySev[k] ?? 0, color: SEVERITY_COLOURS[k] ?? '#21409a' })) }],
    } as Highcharts.Options;

    const cats = (r?.by_category ?? []).slice(0, 12);
    this.categoryChart = !cats.length ? null : {
      chart: { type: 'bar', height: Math.max(180, 34 * cats.length + 60), backgroundColor: 'transparent' },
      title: { text: undefined }, credits: { enabled: false }, legend: { enabled: false }, exporting: { enabled: false },
      xAxis: { categories: cats.map(c => c.category), lineColor: '#e4e7ec' },
      yAxis: { title: { text: 'Records flagged' }, gridLineColor: '#f2f4f7' },
      tooltip: { pointFormat: '<b>{point.y:,.0f}</b> records flagged by {point.rules} check(s)' },
      series: [{ type: 'bar', name: 'Records flagged', color: '#21409a', borderRadius: 3,
        data: cats.map(c => ({ y: c.anomalies, rules: c.rules })) }],
    } as Highcharts.Options;
  }

  // ── Findings ─────────────────────────────────────────────────────────────────────────────────────────────────

  toggleFinding(f: RankedFinding, group: string): void {
    const key = `${group}:${f.rule_id}`;
    if (this.openFindings.has(key)) this.openFindings.delete(key);
    else { this.openFindings.add(key); this.checksFor(f.rule_id); }
  }

  // ── Compiled SQL ─────────────────────────────────────────────────────────────────────────────────────────────

  /** The compiled checks of a rule or family member, loaded once and kept for the page. */
  checksFor(id: string): Load<AnomalyCheck[]> {
    let state = this.checkLoads.get(id);
    if (!state) {
      state = idle<AnomalyCheck[]>();
      this.checkLoads.set(id, state);
      this.load(state, this.api.anomalyChecks<AnomalyCheck[]>(id), 'The SQL of this check could not be loaded.');
    }
    return state;
  }

  /** What the template shows for a rule / family member (loading is started by the click that opens it). */
  checksOf(id: string): Load<AnomalyCheck[]> | undefined { return this.checkLoads.get(id); }

  /** Reloads the SQL after a compile changed it (the open rule's is fetched again at once). */
  private forgetChecks(): void {
    this.checkLoads.clear();
    if (this.selectedRule) this.checksFor(this.selectedRule.ruleId);
    for (const key of this.openFindings) this.checksFor(key.slice(key.indexOf(':') + 1));
  }

  /** True when the check was compiled again after the run shown, so its SQL may differ from what that run executed. */
  recompiledAfterRun(c: AnomalyCheck): boolean {
    const started = this.run.data?.run.startedAt;
    return !!started && !!c.compiledAt && new Date(c.compiledAt).getTime() > new Date(started).getTime();
  }

  copySql(text: string | null | undefined, key: string): void {
    if (!text) return;
    const done = () => {
      this.copied = key;
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => { this.copied = null; this.cdr.markForCheck(); }, 2000);
      this.cdr.markForCheck();
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => this.copyFallback(text, done));
    else this.copyFallback(text, done);
  }

  /** For pages served without HTTPS / clipboard permission: copy through a hidden text area. */
  private copyFallback(text: string, done: () => void): void {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { if (document.execCommand('copy')) done(); } finally { document.body.removeChild(area); }
  }

  isOpen(f: RankedFinding, group: string): boolean { return this.openFindings.has(`${group}:${f.rule_id}`); }

  trackFinding(_: number, f: RankedFinding): string { return f.rule_id; }

  /** Opens a finding's rule under Rules. */
  openRule(ruleId: string): void {
    this.setTab('rules');
    const pick = () => { const r = this.rules.data?.find(x => x.ruleId === ruleId); if (r) this.selectRule(r); };
    if (this.rules.data) pick();
    else this.load(this.rules, this.api.anomalyRules<AnomalyRule[]>(), 'The rules could not be loaded.', list => {
      this.ruleCategories = [...new Set(list.map(r => r.category).filter((c): c is string => !!c))].sort();
      this.filterRules();
      pick();
    });
  }

  download(runId: string, format: Format): void {
    this.downloading = `${runId}:${format}`;
    this.downloadError = '';
    this.api.anomalyReport(runId, format).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: file => { saveFile(file); this.downloading = null; this.cdr.markForCheck(); },
      error: err => { this.downloading = null; this.downloadError = errorText(err, 'The report could not be downloaded.'); this.cdr.markForCheck(); },
    });
  }

  hasReport(run: AnomalyRunSummary | null | undefined, format: Format): boolean {
    return !!run?.reports?.some(r => r.toLowerCase() === format);
  }

  // ── Jobs ─────────────────────────────────────────────────────────────────────────────────────────────────────

  canStart(kind: JobKind): boolean {
    if (this.jobRunning || this.starting || !this.configured) return false;
    if (kind === 'run') return this.canCreate;
    return this.canModify && this.aiEnabled;
  }

  startCompile(ruleIds: string[] = [], force = this.compileOpts.force): void {
    this.start('compile', { ruleIds, force, retryFailed: ruleIds.length ? false : this.compileOpts.retryFailed });
  }

  startRun(): void {
    this.start('run', { formats: [...this.runFormats] });
  }

  startDiscover(): void {
    const n = Math.round(Number(this.maxProposals));
    if (!Number.isFinite(n) || n < 1 || n > 50) { this.jobError = 'Ask for 1 to 50 proposals.'; return; }
    this.start('discover', { maxProposals: n });
  }

  private start(kind: JobKind, opts: { ruleIds?: string[]; force?: boolean; retryFailed?: boolean; formats?: Format[]; maxProposals?: number }): void {
    this.starting = kind;
    this.jobError = '';
    this.api.anomalyStartJob({ kind, ...opts }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: job => { this.starting = null; this.track(job); this.cdr.markForCheck(); },
      error: err => {
        this.starting = null;
        this.jobError = errorText(err, `The ${kind} could not be started.`);
        // Another job holds the slot: show it.
        if (err?.status === 409) this.loadOverview();
        this.cdr.markForCheck();
      },
    });
  }

  /** Follows a job until it finishes. */
  private track(job: AiFeatureJob): void {
    this.stopPolling();
    this.job = job;
    if (jobActive(job)) this.schedulePoll();
    else this.finished(job);
  }

  private schedulePoll(): void {
    if (this.destroyed) return;
    this.pollTimer = setTimeout(() => this.poll(), POLL_MS);
  }

  private poll(): void {
    this.pollTimer = null;
    const id = this.job?.id;
    if (id == null || this.destroyed) return;
    this.pollSub = this.api.anomalyJob(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: job => {
        this.pollSub = null;
        this.job = job;
        if (jobActive(job)) this.schedulePoll(); else this.finished(job);
        this.cdr.markForCheck();
      },
      // A dropped poll is retried; the job keeps running on the server.
      error: () => { this.pollSub = null; this.schedulePoll(); },
    });
  }

  private stopPolling(): void {
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }

  /** A job ended: keep it as the last outcome and reload what it changed. */
  private finished(job: AiFeatureJob): void {
    this.lastJob = job;
    this.job = null;
    this.loadOverview();
    if (job.kind === 'compile') { this.forgetChecks(); if (this.rules.data || this.tab === 'rules') this.loadRules(); }
    if (job.kind === 'run') {
      this.loadRuns();
      const runId = job.result?.runId ?? job.result?.run_id;
      if (job.status === 'succeeded' && runId) this.selectRun(String(runId), false);
      if (this.rules.data) this.loadRules();
    }
    if (job.kind === 'discover') this.loadProposals();
  }

  cancelJob(): void {
    const id = this.job?.id;
    if (id == null) return;
    this.cancelling = true;
    this.api.anomalyCancelJob(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: job => { this.cancelling = false; this.confirmCancel = false; this.track(job); this.cdr.markForCheck(); },
      error: err => {
        this.cancelling = false;
        this.confirmCancel = false;
        this.jobError = errorText(err, 'The job could not be cancelled.');
        this.cdr.markForCheck();
      },
    });
  }

  /** The key facts of a finished job's result summary, as label / value pairs. */
  jobOutcome(job: AiFeatureJob | null): { label: string; value: string }[] {
    const r = job?.result;
    if (!r || typeof r !== 'object') return [];
    const pick: Record<JobKind, [string, string][]> = {
      compile: [['compiled', 'Compiled'], ['reused', 'Reused'], ['failed', 'Failed'], ['notApplicable', 'Not applicable'],
        ['removed', 'Removed'], ['llmCalls', 'AI calls'], ['seconds', 'Seconds']],
      run: [['score', 'Score'], ['recordsFlagged', 'Records flagged'], ['probesRun', 'Checks run'], ['status', 'Run status']],
      discover: [['proposals', 'Proposals added'], ['dropped', 'Dropped'], ['llmCalls', 'AI calls'], ['seconds', 'Seconds']],
    };
    return (pick[job!.kind] ?? [])
      .filter(([k]) => r[k] !== undefined && r[k] !== null && typeof r[k] !== 'object')
      .map(([k, l]) => ({ label: l, value: typeof r[k] === 'number' ? r[k].toLocaleString() : label(String(r[k])) }));
  }

  /** Errors a finished job reported in its result (compile errors, a run's error). */
  jobErrors(job: AiFeatureJob | null): string[] {
    const r = job?.result;
    if (!r || typeof r !== 'object') return [];
    const out: string[] = [];
    if (Array.isArray(r.errors)) out.push(...r.errors.map((e: unknown) => asText(e)));
    else if (r.errors && typeof r.errors === 'object') out.push(...Object.entries(r.errors).map(([k, v]) => `${k}: ${asText(v)}`));
    if (r.error) out.push(asText(r.error));
    if (r.stoppedEarly) out.push('The compile stopped early.');
    return out.slice(0, 20);
  }

  // ── Rules ────────────────────────────────────────────────────────────────────────────────────────────────────

  filterRules(): void {
    const q = this.ruleSearch.trim().toLowerCase();
    this.filteredRules = (this.rules.data ?? [])
      .filter(r => !this.ruleCategory || r.category === this.ruleCategory)
      .filter(r => !this.ruleSeverity || r.severity?.toLowerCase() === this.ruleSeverity)
      .filter(r => !this.ruleStatus || r.status === this.ruleStatus)
      .filter(r => !this.ruleProbe || (this.ruleProbe === 'none' ? !r.probeStatus : r.probeStatus === this.ruleProbe))
      .filter(r => !q || [r.ruleId, r.title, r.category, r.definition?.body, r.definition?.entity]
        .some(v => (v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.ruleId.localeCompare(b.ruleId));
  }

  clearRuleFilters(): void {
    this.ruleSearch = this.ruleCategory = this.ruleSeverity = this.ruleStatus = this.ruleProbe = '';
    this.filterRules();
  }

  selectRule(r: AnomalyRule): void {
    this.selectedRule = r;
    this.checksFor(r.ruleId);
    this.ruleNewStatus = r.status;
    this.ruleMessage = '';
    this.ruleError = '';
  }

  closeRule(): void { this.selectedRule = null; }

  saveRuleStatus(): void {
    const r = this.selectedRule;
    if (!r || !this.ruleNewStatus || this.ruleNewStatus === r.status) return;
    this.ruleSaving = true;
    this.ruleError = '';
    this.ruleMessage = '';
    this.api.anomalySetRuleStatus<AnomalyRule>(r.ruleId, this.ruleNewStatus).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: updated => {
        this.ruleSaving = false;
        const list = this.rules.data ?? [];
        const i = list.findIndex(x => x.ruleId === updated.ruleId);
        if (i >= 0) list[i] = updated;
        this.selectRule(updated);
        this.ruleMessage = `Status set to ${label(updated.status)}.`;
        this.filterRules();
        this.loadOverview();
        this.cdr.markForCheck();
      },
      error: err => { this.ruleSaving = false; this.ruleError = errorText(err, 'The status could not be changed.'); this.cdr.markForCheck(); },
    });
  }

  compileRule(r: AnomalyRule): void { this.startCompile([r.ruleId], true); }

  trackRule(_: number, r: AnomalyRule): string { return r.ruleId; }

  countEntries(counts: Record<string, number> | null | undefined): { key: string; value: number }[] {
    return Object.entries(counts ?? {}).map(([key, value]) => ({ key, value }));
  }

  // ── Proposals ────────────────────────────────────────────────────────────────────────────────────────────────

  acceptOf(p: AnomalyProposal): { ruleId: string; status: string } {
    let f = this.acceptForm.get(p.id);
    if (!f) { f = { ruleId: '', status: 'probation' }; this.acceptForm.set(p.id, f); }
    return f;
  }

  setAccept(p: AnomalyProposal, key: 'ruleId' | 'status', v: string): void { this.acceptOf(p)[key] = v ?? ''; }

  reasonOf(p: AnomalyProposal): string { return this.rejectReason.get(p.id) ?? ''; }
  setReason(p: AnomalyProposal, v: string): void { this.rejectReason.set(p.id, v); }

  accept(p: AnomalyProposal): void {
    const f = this.acceptOf(p);
    this.decide(p, 'accept', { ruleId: f.ruleId.trim() || null, status: f.status });
  }

  reject(): void {
    const p = this.confirmReject;
    if (!p) return;
    this.decide(p, 'reject', { reason: this.reasonOf(p).trim() || null });
  }

  private decide(p: AnomalyProposal, decision: 'accept' | 'reject', body: { ruleId?: string | null; status?: string | null; reason?: string | null }): void {
    this.deciding = p.id;
    this.decideError.delete(p.id);
    this.api.anomalyDecide<AnomalyProposal>(p.id, decision, body).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: updated => {
        this.deciding = null;
        this.confirmReject = null;
        const list = this.proposals.data ?? [];
        const i = list.findIndex(x => x.id === updated.id);
        if (i >= 0) {
          if (this.proposalFilter && updated.status !== this.proposalFilter) list.splice(i, 1); else list[i] = updated;
        }
        this.loadOverview();
        if (decision === 'accept' && this.rules.data) this.loadRules();
        this.cdr.markForCheck();
      },
      error: err => {
        this.deciding = null;
        this.confirmReject = null;
        this.decideError.set(p.id, errorText(err, `The proposal could not be ${decision === 'accept' ? 'accepted' : 'rejected'}.`));
        if (err?.status === 409) this.loadProposals();
        this.cdr.markForCheck();
      },
    });
  }

  get rejectMessage(): string {
    return this.confirmReject ? `Reject "${this.confirmReject.title}"? Discover will not propose it again.` : '';
  }

  evidenceText(p: AnomalyProposal): string { return asText(p.proposal?.evidence); }

  trackProposal(_: number, p: AnomalyProposal): number { return p.id; }
  trackRun(_: number, r: AnomalyRunSummary): string { return r.runId; }
}
