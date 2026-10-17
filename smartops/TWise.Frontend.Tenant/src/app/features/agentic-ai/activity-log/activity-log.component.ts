import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import {
  ColDef, ModuleRegistry, ClientSideRowModelModule, themeQuartz,
  RowSelectionModule, RowSelectionOptions, SelectionColumnDef,
} from 'ag-grid-community';
import { AgentRun, AgentsService } from '../agents.service';
import { countText, inputTokensText, modelNames, outputTokensText, totalTokensText, usageTitle } from '../llm-usage.util';

ModuleRegistry.registerModules([ClientSideRowModelModule, RowSelectionModule]);

export interface ActivityRow {
  run: string;
  agent: string;
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

  ngOnInit(): void {
    this.agents.runs(RUN_LIMIT).subscribe({
      next: runs => {
        this.rows = runs.map(r => this.toRow(r));
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

  private toRow(r: AgentRun): ActivityRow {
    const started = new Date(r.startedAt.endsWith('Z') ? r.startedAt : r.startedAt + 'Z');   // stored as UTC
    const inputs = Object.entries(r.inputs ?? {}).map(([k, v]) => `${k}: ${v || '(blank)'}`).join(', ');
    const failed = r.status !== 'success';
    return {
      run: `R-${r.id}`,
      agent: r.agentName + (r.agentId === null ? ' (unsaved)' : ''),
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

  filterAgent = '';
  filterStatus = '';
  filterRunBy = '';
  /** yyyy-mm-dd (date inputs). */
  filterFrom = '';
  filterTo = '';

  filterQuickRangeOptions = ['Today', 'This Week', 'This Month', 'This Year'];
  filterQuickRange = '';

  searchTerm = '';

  get agentOptions(): string[] { return [...new Set(this.rows.map(r => r.agent))].sort(); }
  get runByOptions(): string[] { return [...new Set(this.rows.map(r => r.runBy))].sort(); }
  readonly statusOptions = ['Success', 'Failed'];

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
    if (this.filterAgent)  chips.push({ key: 'agent',  label: 'Agent: ' + this.filterAgent });
    if (this.filterStatus) chips.push({ key: 'status', label: 'Status: ' + this.filterStatus });
    if (this.filterRunBy)  chips.push({ key: 'runBy',  label: 'Run by: ' + this.filterRunBy });
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
      case 'from':   this.filterFrom = '';  this.filterQuickRange = ''; break;
      case 'to':     this.filterTo = '';    this.filterQuickRange = ''; break;
    }
    this.currentPage = 1;
  }

  clearFilters(): void {
    Object.assign(this, { filterAgent: '', filterStatus: '', filterRunBy: '', filterFrom: '', filterTo: '', filterQuickRange: '', searchTerm: '' });
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
    const key = JSON.stringify([this.rows.length, this.filterAgent, this.filterStatus, this.filterRunBy, this.filterFrom,
      this.filterTo, this.searchTerm]);
    if (key !== this.filteredKey) { this.filteredKey = key; this.filteredCache = this.computeFiltered(); }
    return this.filteredCache;
  }

  private computeFiltered(): ActivityRow[] {
    const from = this.filterFrom ? new Date(this.filterFrom + 'T00:00:00').getTime() : -Infinity;
    const to = this.filterTo ? new Date(this.filterTo + 'T23:59:59.999').getTime() : Infinity;
    const q = this.searchTerm.trim().toLowerCase();
    return this.rows.filter(r =>
      (!this.filterAgent || r.agent === this.filterAgent) &&
      (!this.filterStatus || r.status === this.filterStatus) &&
      (!this.filterRunBy || r.runBy === this.filterRunBy) &&
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
