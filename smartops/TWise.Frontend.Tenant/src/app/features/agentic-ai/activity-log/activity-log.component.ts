import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { catchError, forkJoin, of } from 'rxjs';
import {
  ColDef, ModuleRegistry, ClientSideRowModelModule, themeQuartz,
  RowSelectionModule, RowSelectionOptions, SelectionColumnDef,
} from 'ag-grid-community';
import { Agent, AgentRun, AgentsService } from '../agents.service';
import { countText, inputTokensText, modelNames, outputTokensText, totalTokensText, usageTitle } from '../llm-usage.util';

ModuleRegistry.registerModules([ClientSideRowModelModule, RowSelectionModule]);

/**
 * The run's agent now: on AI Agents and switched on (Active) or off by an admin (Inactive), removed (Deleted), or
 * never saved (Unsaved: a test before the first Save).
 */
export type AgentState = 'Active' | 'Inactive' | 'Deleted' | 'Unsaved';

export interface ActivityRow {
  run: string;
  /** The agent as shown: its current name, with (inactive) / (deleted) / (unsaved test) unless Active. */
  agent: string;
  /** What the Agent filter matches on: the agent id (renamed agents stay together), or the name for unsaved tests. */
  agentKey: string;
  agentState: AgentState;
  runBy: string;
  inputSummary: string;
  verdict: string;
  duration: string;
  /** The run's LLM use on the tenant's provider: models, input and output tokens, and the full numbers for the tooltip. */
  llmModel: string;
  inputTokens: string;
  outputTokens: string;
  totalTokens: string;
  llmTitle: string;
  /** For sorting (-1 = not recorded). */
  inputCount: number;
  outputCount: number;
  totalCount: number;
  started: string;
  /** For sorting and the date filter. */
  startedAt: number;
  status: 'Success' | 'Failed';
}

export interface FilterChip {
  key: string;
  label: string;
}

const ACT_GRID_THEME = themeQuartz.withParams({
  accentColor: '#21409A',
  backgroundColor: '#ffffff',
  borderColor: '#dfe6e9',
  borderRadius: 8,
  checkboxBorderRadius: 4,
  fontFamily: 'Inter, sans-serif',
  headerBackgroundColor: '#ffffff',
  headerTextColor: '#344054',
  headerFontWeight: 600,
  rowHoverColor: '#F5F8FF',
  selectedRowBackgroundColor: '#F5F8FF',
  wrapperBorder: false,
  wrapperBorderRadius: 0,
});

/** A cell as text in a span (never HTML: answers and inputs come from users and the model). */
function textCell(text: string, style: Partial<CSSStyleDeclaration> = {}): HTMLElement {
  const span = document.createElement('span');
  span.textContent = text;
  Object.assign(span.style, style);
  return span;
}

/** What follows an agent's name in the grid and the Agent filter when it is not Active. */
const STATE_SUFFIX: Record<Exclude<AgentState, 'Active'>, string> = { Inactive: 'inactive', Deleted: 'deleted', Unsaved: 'unsaved test' };

/** How many runs the page loads (the API returns at most 200, newest first). */
const RUN_LIMIT = 200;

/**
 * Agentic AI → Activity Log: the saved test runs of the tenant's agents (core.AiAgentRuns via GET /api/agents/runs).
 * It used to show 8,618 generated rows with geography filters that had nothing to do with agent runs.
 */
@Component({
  selector: 'app-activity-log',
  standalone: false,
  templateUrl: './activity-log.component.html',
  styleUrls: ['./activity-log.component.scss'],
})
export class ActivityLogComponent implements OnInit {
  gridTheme = ACT_GRID_THEME;

  constructor(private agents: AgentsService, private cdr: ChangeDetectorRef) {}

  loading = true;
  error = '';
  private rows: ActivityRow[] = [];
  /** False when the agent list could not be read: rows then keep the run's name and the Agent status filter is hidden. */
  agentsKnown = false;

  ngOnInit(): void {
    // The agents on AI Agents tell which runs belong to an agent that still exists; without them the log still loads.
    forkJoin({ runs: this.agents.runs(RUN_LIMIT), agents: this.agents.list().pipe(catchError(() => of(null))) }).subscribe({
      next: ({ runs, agents }) => {
        this.agentsKnown = agents !== null;
        const current = new Map((agents ?? []).map((a: Agent) => [a.id, a]));
        this.rows = runs.map(r => this.toRow(r, current));
        // Agents in use are what the log is about; deleted and unsaved ones are one choice away.
        if (this.agentsKnown) this.filterAgentStatus = 'Active';
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: err => {
        this.loading = false;
        this.error = err?.status === 403 ? 'You do not have permission to view the activity log.' : 'Could not load the agent runs.';
        this.cdr.markForCheck();
      },
    });
  }

  private toRow(r: AgentRun, current: Map<number, Agent>): ActivityRow {
    const started = new Date(r.startedAt.endsWith('Z') ? r.startedAt : r.startedAt + 'Z');   // stored as UTC
    const inputs = Object.entries(r.inputs ?? {}).map(([k, v]) => `${k}: ${v || '(blank)'}`).join(', ');
    const failed = r.status !== 'success';
    const agent = r.agentId === null ? undefined : current.get(r.agentId);
    // Unknown agent list: treat saved agents as active rather than call them deleted.
    const state: AgentState = r.agentId === null ? 'Unsaved'
      : agent ? (agent.agentState === 'inactive' ? 'Inactive' : 'Active')
      : this.agentsKnown ? 'Deleted' : 'Active';
    const name = agent?.name ?? r.agentName;
    return {
      run: `R-${r.id}`,
      agent: state === 'Active' ? name : `${name} (${STATE_SUFFIX[state]})`,
      agentKey: r.agentId === null ? `unsaved:${r.agentName}` : `id:${r.agentId}`,
      agentState: state,
      runBy: r.runBy,
      inputSummary: inputs || '—',
      // Answers are markdown: one plain line for the grid (the full text is in the tooltip).
      verdict: ((failed ? r.error || r.answer : r.answer) || '—').replace(/[#*_`>|]+/g, '').replace(/\s+/g, ' ').trim(),
      duration: `${r.seconds.toFixed(1)}s`,
      llmModel: modelNames(r.llm),
      inputTokens: r.llm ? inputTokensText(r.llm) : countText(r.inputTokens),
      outputTokens: r.llm ? outputTokensText(r.llm) : countText(r.outputTokens),
      totalTokens: r.llm ? totalTokensText(r.llm) : countText(r.totalTokens),
      llmTitle: usageTitle(r.llm),
      inputCount: r.llm?.promptTokens ?? r.inputTokens ?? -1,
      outputCount: r.llm?.completionTokens ?? r.outputTokens ?? -1,
      totalCount: r.llm?.totalTokens ?? r.totalTokens ?? -1,
      started: started.toLocaleString(undefined, { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
      startedAt: started.getTime(),
      status: failed ? 'Failed' : 'Success',
    };
  }

  // ── Filter Panel ───────────────────────────────────────
  showFilterPanel = true;
  filterPinned = false;

  /** An agentKey ('' = all agents). */
  filterAgent = '';
  filterStatus = '';
  filterRunBy = '';
  /** '' = all; set to Active once the agent list has loaded. */
  filterAgentStatus: '' | AgentState = '';
  /** yyyy-mm-dd (date inputs). */
  filterFrom = '';
  filterTo = '';

  filterQuickRangeOptions = ['Today', 'This Week', 'This Month', 'This Year'];
  filterQuickRange = '';

  searchTerm = '';

  private agentOptionsKey = '';
  private agentOptionsCache: { value: string; label: string }[] = [];

  /** The agents whose runs match the Agent status filter, one entry per agent (newest run's label), by name. */
  get agentOptions(): { value: string; label: string }[] {
    const key = `${this.rows.length}|${this.filterAgentStatus}`;
    if (key !== this.agentOptionsKey) {
      const byKey = new Map<string, string>();
      for (const r of this.rows)
        if ((!this.filterAgentStatus || r.agentState === this.filterAgentStatus) && !byKey.has(r.agentKey)) byKey.set(r.agentKey, r.agent);
      this.agentOptionsKey = key;
      this.agentOptionsCache = [...byKey].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    }
    return this.agentOptionsCache;
  }

  trackOption = (_: number, o: { value: string }) => o.value;

  get runByOptions(): string[] { return [...new Set(this.rows.map(r => r.runBy))].sort(); }
  readonly statusOptions = ['Success', 'Failed'];
  readonly agentStatusOptions: { value: AgentState; label: string }[] = [
    { value: 'Active', label: 'Active' },
    { value: 'Inactive', label: 'Inactive' },
    { value: 'Deleted', label: 'Deleted' },
    { value: 'Unsaved', label: 'Unsaved test' },
  ];

  /** A chosen agent that the new status no longer lists is cleared, so the two filters never contradict. */
  onAgentStatusChange(): void {
    if (this.filterAgent && !this.agentOptions.some(o => o.value === this.filterAgent)) this.filterAgent = '';
    this.currentPage = 1;
  }

  onQuickRangeChange(range: string): void {
    this.filterQuickRange = range;
    const today = new Date();
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const from = range === 'Today' ? today
      : range === 'This Week' ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay())
      : range === 'This Month' ? new Date(today.getFullYear(), today.getMonth(), 1)
      : new Date(today.getFullYear(), 0, 1);
    this.filterFrom = ymd(from);
    this.filterTo = ymd(today);
    this.currentPage = 1;
  }

  get activeFilterChips(): FilterChip[] {
    const chips: FilterChip[] = [];
    if (this.filterAgent)  chips.push({ key: 'agent',  label: 'Agent: ' + (this.rows.find(r => r.agentKey === this.filterAgent)?.agent ?? this.filterAgent) });
    if (this.filterStatus) chips.push({ key: 'status', label: 'Status: ' + this.filterStatus });
    if (this.filterRunBy)  chips.push({ key: 'runBy',  label: 'Run by: ' + this.filterRunBy });
    if (this.filterAgentStatus)
      chips.push({ key: 'agentStatus', label: 'Agent state: ' +this.agentStatusOptions.find(o => o.value === this.filterAgentStatus)?.label });
    if (this.filterFrom)   chips.push({ key: 'from',   label: 'From: ' + this.filterFrom });
    if (this.filterTo)     chips.push({ key: 'to',     label: 'To: ' + this.filterTo });
    return chips;
  }

  toggleFilterPanel(): void {
    if (!this.filterPinned) this.showFilterPanel = !this.showFilterPanel;
  }

  togglePin(): void {
    this.filterPinned = !this.filterPinned;
    if (this.filterPinned) this.showFilterPanel = true;
  }

  removeFilterChip(key: string): void {
    switch (key) {
      case 'agent':  this.filterAgent = '';  break;
      case 'status': this.filterStatus = ''; break;
      case 'runBy':  this.filterRunBy = '';  break;
      case 'agentStatus': this.filterAgentStatus = ''; break;
      case 'from':   this.filterFrom = '';  this.filterQuickRange = ''; break;
      case 'to':     this.filterTo = '';    this.filterQuickRange = ''; break;
    }
    this.currentPage = 1;
  }

  clearFilters(): void {
    Object.assign(this, { filterAgent: '', filterStatus: '', filterRunBy: '', filterAgentStatus: '', filterFrom: '', filterTo: '',
      filterQuickRange: '', searchTerm: '' });
    this.currentPage = 1;
  }

  /**
   * The rows after the filters, recomputed only when a filter changes: change detection reads these getters
   * many times, and a new array each time made ag-grid reset its rows (and the checkbox selection).
   */
  private filteredKey = '';
  private filteredCache: ActivityRow[] = [];
  private pagedKey = '';
  private pagedCache: ActivityRow[] = [];

  private get filteredRows(): ActivityRow[] {
    const key = JSON.stringify([this.rows.length, this.filterAgent, this.filterStatus, this.filterRunBy, this.filterAgentStatus,
      this.filterFrom, this.filterTo, this.searchTerm]);
    if (key !== this.filteredKey) { this.filteredKey = key; this.filteredCache = this.computeFiltered(); }
    return this.filteredCache;
  }

  private computeFiltered(): ActivityRow[] {
    const from = this.filterFrom ? new Date(this.filterFrom + 'T00:00:00').getTime() : -Infinity;
    const to = this.filterTo ? new Date(this.filterTo + 'T23:59:59.999').getTime() : Infinity;
    const q = this.searchTerm.trim().toLowerCase();
    return this.rows.filter(r =>
      (!this.filterAgent || r.agentKey === this.filterAgent) &&
      (!this.filterStatus || r.status === this.filterStatus) &&
      (!this.filterRunBy || r.runBy === this.filterRunBy) &&
      (!this.filterAgentStatus || r.agentState === this.filterAgentStatus) &&
      r.startedAt >= from && r.startedAt <= to &&
      (!q || [r.run, r.agent, r.runBy, r.inputSummary, r.verdict].some(v => v.toLowerCase().includes(q))));
  }

  // ── Grid ───────────────────────────────────────────────
  readonly rowSelection: RowSelectionOptions<ActivityRow> = {
    mode: 'multiRow',
    checkboxes: true,
    headerCheckbox: true,
    enableClickSelection: false,
  };

  readonly selectionColumnDef: SelectionColumnDef = {
    width: 48,
    maxWidth: 48,
    minWidth: 48,
    suppressHeaderMenuButton: true,
    suppressMovable: true,
  };

  columnDefs: ColDef<ActivityRow>[] = [
    { field: 'run', headerName: 'Run', flex: 0.6, minWidth: 80 },
    { field: 'agent',        headerName: 'Agent',         flex: 1.3, minWidth: 160 },
    { field: 'runBy',        headerName: 'Run by',        flex: 1.1, minWidth: 150 },
    { field: 'inputSummary', headerName: 'Inputs',        flex: 1.1, minWidth: 140, tooltipField: 'inputSummary' },
    {
      field: 'verdict', headerName: 'Answer / error', flex: 2, minWidth: 220, tooltipField: 'verdict',
      cellRenderer: (p: { value: string; data?: ActivityRow }) =>
        textCell(p.value ?? '', { color: p.data?.status === 'Failed' ? '#C62828' : 'inherit' }),
    },
    { field: 'duration', headerName: 'Duration', flex: 0.6, minWidth: 90 },
    { field: 'llmModel', headerName: 'LLM model', flex: 1, minWidth: 140, tooltipField: 'llmTitle' },
    { field: 'inputTokens', headerName: 'Input tokens', flex: 0.7, minWidth: 110, tooltipField: 'llmTitle', type: 'rightAligned',
      comparator: (_a, _b, x, y) => (x.data?.inputCount ?? -1) - (y.data?.inputCount ?? -1) },
    { field: 'outputTokens', headerName: 'Output tokens', flex: 0.7, minWidth: 110, tooltipField: 'llmTitle', type: 'rightAligned',
      comparator: (_a, _b, x, y) => (x.data?.outputCount ?? -1) - (y.data?.outputCount ?? -1) },
    { field: 'totalTokens', headerName: 'Total tokens', flex: 0.7, minWidth: 110, tooltipField: 'llmTitle', type: 'rightAligned',
      comparator: (_a, _b, x, y) => (x.data?.totalCount ?? -1) - (y.data?.totalCount ?? -1) },
    { field: 'started',  headerName: 'Started',  flex: 1, minWidth: 140, comparator: (_a, _b, x, y) => (x.data?.startedAt ?? 0) - (y.data?.startedAt ?? 0) },
    {
      field: 'status', headerName: 'Status', flex: 0.8, minWidth: 110,
      cellRenderer: (p: { value: ActivityRow['status'] }) => {
        const bad = p.value === 'Failed';
        const chip = textCell(p.value ?? '', {
          display: 'inline-flex', alignItems: 'center', height: '24px', padding: '0 10px', borderRadius: '20px',
          border: `1px solid ${bad ? '#F8C7C6' : '#D8F4D9'}`, background: bad ? '#FDECEC' : '#EEF8EE',
          fontSize: '12px', fontWeight: '500', color: bad ? '#C62828' : '#1B7A3A',
        });
        return chip;
      },
    },
  ];

  defaultColDef: ColDef = { sortable: true, resizable: true, suppressMovable: true };

  // ── Pagination ─────────────────────────────────────────
  readonly pageSize = 20;
  currentPage = 1;

  get totalRecords(): number { return this.filteredRows.length; }
  get totalPages(): number { return Math.max(1, Math.ceil(this.totalRecords / this.pageSize)); }

  get pagedRows(): ActivityRow[] {
    const rows = this.filteredRows;
    const start = (Math.min(this.currentPage, this.totalPages) - 1) * this.pageSize;
    const key = `${this.filteredKey}|${start}`;
    if (key !== this.pagedKey) { this.pagedKey = key; this.pagedCache = rows.slice(start, start + this.pageSize); }
    return this.pagedCache;
  }

  /** Stable row ids, so a refresh keeps ag-grid's rows (and their selection) in place. */
  readonly getRowId = (p: { data: ActivityRow }) => p.data.run;

  get paginationInfo(): string {
    if (!this.totalRecords) return '0 runs';
    const start = (Math.min(this.currentPage, this.totalPages) - 1) * this.pageSize + 1;
    const end = Math.min(start + this.pageSize - 1, this.totalRecords);
    return `${start} to ${end} of ${this.totalRecords.toLocaleString()}` + (this.rows.length >= RUN_LIMIT ? ` (latest ${RUN_LIMIT} runs)` : '');
  }

  firstPage(): void { this.currentPage = 1; }
  prevPage(): void  { if (this.currentPage > 1) this.currentPage--; }
  nextPage(): void  { if (this.currentPage < this.totalPages) this.currentPage++; }
  lastPage(): void  { this.currentPage = this.totalPages; }
}
