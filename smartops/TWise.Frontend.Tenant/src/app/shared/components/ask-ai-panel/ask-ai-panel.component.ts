import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { AiClarification, AiClarifyOption, AiConversation, AiDataset, AiDatasetNote, AiFeatures, AiAlert, AiAlertKind, AiInsightReport, AiPromptDto, AiExample, AiMetric, AiTraceStep, AiNoteProposal, AiTerm, AiQueryResult, AiQuerySpec, AiService } from '../../../core/services/ai.service';
import { PermissionService } from '../../../core/services/permission.service';
import { AskAiPanelService } from '../../../core/services/ask-ai-panel.service';
import { Router } from '@angular/router';
import { AiChartPreset, AiChartPresetService } from '../../../core/services/ai-chart-preset.service';
import { WidgetService } from '../../../core/services/widget.service';
import { DashboardService } from '../../../core/services/dashboard.service';
import { CategoryService } from '../../../core/services/category.service';
import { normalizeAdvancedChartType } from '../../../core/utils/advanced-chart.util';
import { StringUtil } from '../../../core/utils/string.util';
import { forkJoin } from 'rxjs';

/** One rendered turn: the question plus what came back while it streamed. */
interface Turn {
  question: string;
  status: string;
  spec: AiQuerySpec | null;
  result: AiQueryResult | null;
  answer: string;
  error: string;
  showQuery: boolean;
  /** Chart Builder mapping for this answer, when the query fits a single-series chart. */
  chart: AiChartPreset | null;
  /** Stored assistant message id, needed for thumbs-up. */
  messageId: number | null;
  liked: boolean;
  /** Questions to try after a failure or an empty result. */
  suggestions?: string[];
  /** The AI asks which reading of the question was meant. */
  clarify?: AiClarification;
  /** Findings worked out from the result: trend, top/bottom, share, outliers. */
  insights?: string[];
  /** Prompt trace: sent live, or loaded on demand for stored answers. */
  trace?: AiTraceStep[];
  showTrace?: boolean;
  /** "Alert me" form under the answer, and the result of saving it. */
  alertForm?: { kind: AiAlertKind; threshold: number | null; everyHours: number; notifyEmails: string; saving?: boolean };
  /** Insight report built on demand for a grouped answer. */
  report?: AiInsightReport | null;
  reportLoading?: boolean;
  reportError?: string;
  alertMessage?: string;
  disliked: boolean;
}

/**
 * "Ask your data" drawer. Pick a dataset, type a question, watch the query spec, result table and
 * answer stream in. Follow-up questions reuse the conversation so the model sees earlier specs.
 */
@Component({
  selector: 'app-ask-ai-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ask-ai-panel.component.html',
  styleUrls: ['./ask-ai-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AskAiPanelComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  @ViewChild('scroller') private scroller?: ElementRef<HTMLElement>;

  datasets: AiDataset[] = [];
  conversations: AiConversation[] = [];
  alerts: AiAlert[] = [];
  readonly alertKinds: { value: AiAlertKind; label: string }[] = [
    { value: 'above', label: 'Goes above' }, { value: 'below', label: 'Goes below' }, { value: 'unusual', label: 'Looks unusual' }, { value: 'change', label: 'Changes by more than (%)' },
  ];
  readonly alertEvery = [{ hours: 1, label: 'Hourly' }, { hours: 24, label: 'Daily' }, { hours: 168, label: 'Weekly' }];
  selectedKey = '';
  conversationId: number | null = null;
  sourceName = '';
  turns: Turn[] = [];
  question = '';
  private pendingSpec: AiQuerySpec | null = null;
  busy = false;
  showHistory = false;
  loadError = '';
  features: AiFeatures = { enabled: [] };

  can(key: string): boolean { return this.features.enabled.includes(key); }

  /** Admin notes editor for the current dataset (grounds the model). */
  showNotes = false;
  notesColumns: string[] = [];
  /** Every column of the dataset, for the term and metric pickers (notes only list columns that have one). */
  datasetColumns: string[] = [];
  notes: AiDatasetNote[] = [];
  datasetNote = '';
  savingNotes = false;
  notesMessage = '';
  /** Instructions overridden for this dataset (admin): drafts by key, the key being saved, and per-key result. */
  datasetPrompts: AiPromptDto[] = [];
  promptDrafts: Record<string, string> = {};
  savingPrompt: string | null = null;
  promptMessage: Record<string, string> = {};
  proposals: AiNoteProposal[] = [];
  metrics: AiMetric[] = [];
  terms: AiTerm[] = [];
  learned: AiExample[] = [];
  savingTerms = false;
  termsMessage = '';
  savingMetrics = false;
  metricsMessage = '';
  readonly aggs = ['sum', 'avg', 'count', 'countDistinct', 'min', 'max'];
  private askSub?: Subscription;

  constructor(readonly panel: AskAiPanelService, private readonly ai: AiService, private readonly cdr: ChangeDetectorRef,
    private readonly presets: AiChartPresetService, private readonly router: Router, private readonly permissions: PermissionService,
    private readonly widgets: WidgetService, private readonly dashboards: DashboardService, private readonly categories: CategoryService) {}

  // ── Add to dashboard: save the answer as a chart, then open a dashboard with it placed ──
  addTarget: Turn | null = null;
  addDashboards: { dashboardId: number; dashboardName: string }[] = [];
  addDashboardId: number | 'new' = 'new';
  addBusy = false;
  addError = '';

  openAddToDashboard(t: Turn): void {
    this.addTarget = t;
    this.addError = '';
    this.addDashboardId = 'new';
    this.dashboards.getWipDashboardsMinimal().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: d => { this.addDashboards = d; this.cdr.markForCheck(); },
      error: () => { /* "new dashboard" still works */ },
    });
  }

  /** Creates a draft chart widget from the answer's mapping and opens the Dashboard Builder with it placed. */
  confirmAddToDashboard(): void {
    const preset = this.addTarget?.chart;
    if (!preset || this.addBusy) return;
    this.addBusy = true;
    this.addError = '';
    forkJoin({ library: this.widgets.getWidgetLibraryCharts(), categories: this.categories.getCategoriesByType('chart') })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ({ library, categories }) => {
          const lib = library.find(i => normalizeAdvancedChartType(i.widgetName) === preset.chartType);
          if (!lib) { this.addBusy = false; this.addError = `The "${preset.chartType}" chart type is not in the widget library.`; this.cdr.markForCheck(); return; }
          const payload = this.presets.widgetPayload(preset);
          this.widgets.createWidget({
            name: preset.title, description: this.addTarget?.question ?? '', type: 'chart', libraryId: lib.id,
            source: payload.source, sourceType: payload.sourceType, sourceId: payload.sourceId, designJson: payload.designJson,
            categoryId: categories[0]?.categoryId || 2,
          }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
            next: w => {
              this.addBusy = false;
              this.addTarget = null;
              this.panel.close();
              const route = this.addDashboardId === 'new' ? ['/dashboard/builder'] : ['/dashboard/builder', this.addDashboardId];
              this.router.navigate(route, { queryParams: { addChartId: w.id } });
            },
            error: err => { this.addBusy = false; this.addError = err?.error?.message ?? err?.error?.error ?? 'The chart could not be saved.'; this.cdr.markForCheck(); },
          });
        },
        error: () => { this.addBusy = false; this.addError = 'The chart library could not be loaded.'; this.cdr.markForCheck(); },
      });
  }

  get isAdmin(): boolean { return this.permissions.isAdminUser; }

  /** The dataset the notes editor works on: the open conversation's, or the picker's. */
  private get currentSource(): { type: 'view' | 'import'; id: number } | null {
    if (!this.selectedKey) return null;
    const [type, id] = this.selectedKey.split(':');
    return { type: type as 'view' | 'import', id: Number(id) };
  }

  ngOnInit(): void {
    this.ai.features().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: f => { this.features = f; this.cdr.markForCheck(); }, error: () => { /* defaults */ } });
    this.ai.datasets().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: d => { this.datasets = d; this.cdr.markForCheck(); },
      error: err => { this.loadError = err?.status === 401 ? 'Your session has expired. Please sign in again.' : (err?.error?.message ?? 'Datasets could not be loaded.'); this.cdr.markForCheck(); },
    });
    this.loadConversations();
    this.loadAlerts();
  }

  get canAsk(): boolean {
    return !this.busy && !!this.question.trim() && (this.conversationId !== null || !!this.selectedKey);
  }

  /** Nothing asked yet on this thread: the dataset picker is still editable. */
  get pickingDataset(): boolean {
    return this.conversationId === null && this.turns.length === 0;
  }

  newConversation(): void {
    this.askSub?.unsubscribe();
    this.conversationId = null;
    this.sourceName = '';
    this.turns = [];
    this.busy = false;
    this.showHistory = false;
    this.showNotes = false;
  }

  openConversation(c: AiConversation): void {
    this.showHistory = false;
    this.ai.conversation(c.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: d => {
        this.conversationId = d.conversation.id;
        this.sourceName = d.conversation.sourceName;
        this.selectedKey = `${d.conversation.sourceType}:${d.conversation.sourceId}`;
        // Pair user/assistant messages into turns; stored answers have no result table.
        this.turns = [];
        for (const m of d.messages) {
          if (m.role === 'user') this.turns.push({ question: m.content, status: '', spec: null, result: null, answer: '', error: '', showQuery: false, chart: null, messageId: null, liked: false, disliked: false });
          else if (this.turns.length) { const t = this.turns[this.turns.length - 1]; t.answer = m.content; t.spec = m.querySpec ?? null; t.messageId = m.id; }
        }
        this.cdr.markForCheck();
        this.scrollToEnd();
      },
    });
  }

  deleteConversation(c: AiConversation, ev: Event): void {
    ev.stopPropagation();
    this.ai.deleteConversation(c.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.conversations = this.conversations.filter(x => x.id !== c.id);
      if (this.conversationId === c.id) this.newConversation();
      this.cdr.markForCheck();
    });
  }

  toggleAlertForm(t: Turn): void {
    t.alertForm = t.alertForm ? undefined : { kind: 'above', threshold: null, everyHours: 24, notifyEmails: '' };
    t.alertMessage = '';
  }

  /** Saves the alert; the first check runs straight away and its result is shown. */
  createAlert(t: Turn): void {
    if (!t.messageId || !t.alertForm) return;
    const f = t.alertForm;
    // The first check runs before the reply, which takes a few seconds: show that it is working.
    f.saving = true;
    this.ai.createAlert({ messageId: t.messageId, kind: f.kind, threshold: f.kind === 'unusual' ? null : f.threshold, everyHours: f.everyHours, notifyEmails: f.notifyEmails.trim() || null })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: a => { t.alertForm = undefined; t.alertMessage = `Alert saved. Now: ${a.lastMessage ?? ''}`; this.alerts = [a, ...this.alerts]; this.cdr.markForCheck(); },
        error: err => { f.saving = false; t.alertMessage = err?.error?.message ?? 'The alert could not be saved.'; this.cdr.markForCheck(); },
      });
  }

  checkAlert(a: AiAlert): void {
    this.ai.checkAlert(a.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: x => { this.alerts = this.alerts.map(y => y.id === x.id ? x : y); this.cdr.markForCheck(); },
      error: () => { /* the list keeps the last result */ },
    });
  }

  deleteAlert(a: AiAlert): void {
    this.ai.deleteAlert(a.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.alerts = this.alerts.filter(x => x.id !== a.id);
      this.cdr.markForCheck();
    });
  }

  alertRule(a: AiAlert): string {
    const every = this.alertEvery.find(e => e.hours === a.everyHours)?.label ?? `Every ${a.everyHours} h`;
    const rule = a.kind === 'unusual' ? 'Looks unusual' : a.kind === 'change' ? `Changes > ${a.threshold}%` : `${a.kind === 'above' ? 'Above' : 'Below'} ${a.threshold}`;
    return `${rule} · ${every}${a.notifyEmails ? ' · ✉' : ''}`;
  }

  /** Builds (or hides) the insight report: the query runs again and the AI adds recommendations. */
  toggleReport(t: Turn): void {
    if (t.report) { t.report = null; return; }
    if (!t.messageId || t.reportLoading) return;
    t.reportLoading = true; t.reportError = '';
    this.ai.report(t.messageId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => { t.report = r; t.reportLoading = false; this.cdr.markForCheck(); },
      error: err => { t.reportLoading = false; t.reportError = err?.error?.message ?? 'The report could not be built.'; this.cdr.markForCheck(); },
    });
  }

  /** Runs the option the user picked: its query exactly, labelled with the choice. */
  pickOption(t: Turn, o: AiClarifyOption): void {
    if (this.busy) return;
    this.pendingSpec = o.spec;
    this.question = `${t.question} (${o.label})`;
    this.ask();
  }

  /** Asks a suggested question in the same conversation. */
  askSuggestion(q: string): void {
    if (this.busy) return;
    this.question = q;
    this.ask();
  }

  private takePendingSpec(): AiQuerySpec | null {
    const s = this.pendingSpec;
    this.pendingSpec = null;
    return s;
  }

  ask(): void {
    if (!this.canAsk) return;
    const question = this.question.trim();
    const [sourceType, id] = this.selectedKey.split(':');
    const turn: Turn = { question, status: 'Sending…', spec: null, result: null, answer: '', error: '', showQuery: false, chart: null, messageId: null, liked: false, disliked: false };
    this.turns = [...this.turns, turn];
    this.question = '';
    this.busy = true;
    this.scrollToEnd();

    this.askSub = this.ai.ask({
      conversationId: this.conversationId,
      sourceType: this.conversationId ? null : (sourceType as 'view' | 'import'),
      sourceId: this.conversationId ? null : Number(id),
      question,
      spec: this.takePendingSpec(),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ev => {
        switch (ev.type) {
          case 'status': turn.status = ev.data; break;
          case 'spec': turn.spec = ev.data; turn.status = 'Running the query…'; break;
          case 'result':
            turn.result = ev.data; turn.status = 'Writing the answer…';
            if (turn.spec) turn.chart = this.presets.suggest(turn.spec, ev.data, question, sourceType as 'view' | 'import', Number(id), this.sourceName || this.datasets.find(d => `${d.sourceType}:${d.sourceId}` === this.selectedKey)?.name || '');
            break;
          case 'answer': turn.answer += ev.data; turn.status = ''; break;
          case 'done': if (ev.data && 'conversationId' in ev.data) { this.conversationId = ev.data.conversationId; this.sourceName = ev.data.sourceName; turn.messageId = ev.data.messageId; this.loadConversations(); } break;
          case 'suggestions': turn.suggestions = ev.data; break;
          case 'clarify': turn.clarify = ev.data; turn.status = ''; break;
          case 'insights': turn.insights = ev.data; break;
          case 'trace': turn.trace = ev.data; break;
          case 'error': turn.error = ev.data; turn.status = ''; break;
        }
        this.cdr.markForCheck();
        this.scrollToEnd();
      },
      error: err => { turn.error = err?.message ?? 'The request failed.'; turn.status = ''; this.busy = false; this.cdr.markForCheck(); },
      complete: () => { this.busy = false; turn.status = ''; this.cdr.markForCheck(); },
    });
  }

  /** Thumbs-up toggles whether this answer is kept as an example for the dataset. */
  toggleLike(t: Turn): void {
    if (!t.messageId) return;
    const call$ = t.liked ? this.ai.unlike(t.messageId) : this.ai.like(t.messageId);
    const next = !t.liked;
    call$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { t.liked = next; t.disliked = false; this.cdr.markForCheck(); },
      error: () => { /* leave the icon as it was */ },
    });
  }

  /** Thumbs-down: this answer is never used as an example. Clicking again removes the rating. */
  toggleDislike(t: Turn): void {
    if (!t.messageId) return;
    const call$ = t.disliked ? this.ai.unlike(t.messageId) : this.ai.dislike(t.messageId);
    const next = !t.disliked;
    call$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { t.disliked = next; t.liked = false; this.cdr.markForCheck(); },
      error: () => { /* leave the icon as it was */ },
    });
  }

  /** Admin: use or stop using a learned example, or delete it. */
  reviewExample(e: AiExample, action: 'approved' | 'rejected' | 'delete'): void {
    const call$ = action === 'delete' ? this.ai.deleteExample(e.id) : this.ai.setExampleStatus(e.id, action);
    call$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.learned = action === 'delete' ? this.learned.filter(x => x.id !== e.id) : this.learned.map(x => x.id === e.id ? { ...x, status: action, review: 'Set by an admin.' } : x);
        this.cdr.markForCheck();
      },
      error: () => { this.notesMessage = 'The example could not be updated.'; this.cdr.markForCheck(); },
    });
  }

  readonly stepNames: Record<AiTraceStep['step'], string> = {
    load: 'Load data', context: 'Build context', ask: 'AI: question to query', query: 'Run query', rejected: 'Query rejected', answer: 'AI: answer',
  };

  /** Show or hide the steps behind an answer; stored answers fetch their trace the first time. */
  toggleTrace(t: Turn): void {
    t.showTrace = !t.showTrace;
    if (!t.showTrace || t.trace || !t.messageId) return;
    this.ai.trace(t.messageId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: x => { t.trace = x; this.cdr.markForCheck(); },
      error: () => { t.trace = []; this.cdr.markForCheck(); },
    });
  }

  /** Columns offered in the term and metric pickers: the dataset's own, else those with notes. */
  get pickColumns(): string[] {
    return this.datasetColumns.length ? this.datasetColumns : this.notesColumns;
  }

  exampleUsed(e: AiExample): boolean {
    return e.status === 'liked' || e.status === 'approved';
  }

  openNotes(): void {
    const src = this.currentSource;
    if (!src) return;
    this.showHistory = false;
    this.showNotes = true;
    this.notesMessage = '';
    // Column list: from the last result's source columns when available, else from stored notes.
    const fromTurns = this.turns.map(t => t.result?.columns ?? []).flat();
    this.ai.proposals(src.type, src.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: p => { this.proposals = p; this.cdr.markForCheck(); }, error: () => { this.proposals = []; } });
    this.ai.examples(src.type, src.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: x => { this.learned = x; this.cdr.markForCheck(); }, error: () => { this.learned = []; } });
    this.ai.terms(src.type, src.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: t => { this.terms = t.map(x => ({ ...x })); this.cdr.markForCheck(); }, error: () => { this.terms = []; } });
    this.datasetColumns = [];
    this.ai.datasetColumns(src.type, src.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: c => { this.datasetColumns = c; this.cdr.markForCheck(); }, error: () => { /* pickers fall back to noted columns */ } });
    this.ai.metrics(src.type, src.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: m => { this.metrics = m.map(x => ({ ...x })); this.cdr.markForCheck(); }, error: () => { this.metrics = []; } });
    this.ai.datasetPrompts(src.type, src.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: p => { this.applyDatasetPrompts(p); this.cdr.markForCheck(); }, error: () => { this.datasetPrompts = []; } });
    this.ai.notes(src.type, src.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: notes => {
        this.datasetNote = notes.find(n => n.column === null)?.note ?? '';
        const stored = notes.filter(n => n.column !== null);
        this.notesColumns = [...new Set([...stored.map(n => n.column!), ...fromTurns])];
        this.notes = this.notesColumns.map(c => { const s = stored.find(n => n.column === c); return { column: c, note: s?.note ?? '', displayName: s?.displayName ?? '' }; });
        this.cdr.markForCheck();
      },
      error: () => { this.showNotes = false; this.cdr.markForCheck(); },
    });
  }

  /** Approve merges the proposal into the notes (server-side) and refreshes the editor; reject just drops it. */
  reviewProposal(p: AiNoteProposal, action: 'approve' | 'reject'): void {
    this.ai.reviewProposal(p.id, action).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.proposals = this.proposals.filter(x => x.id !== p.id); if (action === 'approve') this.openNotes(); else this.cdr.markForCheck(); },
      error: () => { this.notesMessage = 'The proposal could not be updated.'; this.cdr.markForCheck(); },
    });
  }

  addMetric(): void {
    this.metrics = [...this.metrics, { name: '', agg: 'sum', column: this.pickColumns[0] ?? null, description: '' }];
  }

  removeMetric(i: number): void {
    this.metrics = this.metrics.filter((_, idx) => idx !== i);
  }

  saveMetrics(): void {
    const src = this.currentSource;
    if (!src) return;
    this.savingMetrics = true;
    this.metricsMessage = '';
    const payload = this.metrics.filter(m => m.name.trim()).map(m => ({ ...m, column: m.agg === 'count' ? null : m.column }));
    this.ai.saveMetrics(src.type, src.id, payload).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: m => { this.metrics = m; this.savingMetrics = false; this.metricsMessage = 'Saved. Questions that name a metric now use its definition.'; this.cdr.markForCheck(); },
      error: err => { this.savingMetrics = false; this.metricsMessage = err?.error?.message ?? 'The metrics could not be saved.'; this.cdr.markForCheck(); },
    });
  }

  addTerm(): void {
    this.terms = [...this.terms, { term: '', synonyms: '', column: null, value: '', meaning: '' }];
  }

  removeTerm(i: number): void {
    this.terms = this.terms.filter((_, idx) => idx !== i);
  }

  saveTerms(): void {
    const src = this.currentSource;
    if (!src) return;
    this.savingTerms = true;
    this.termsMessage = '';
    const payload = this.terms.filter(t => t.term.trim()).map(t => ({ ...t, value: t.column ? t.value : null }));
    this.ai.saveTerms(src.type, src.id, payload).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: t => { this.terms = t; this.savingTerms = false; this.termsMessage = 'Saved. Questions using these words now get their meaning.'; this.cdr.markForCheck(); },
      error: err => { this.savingTerms = false; this.termsMessage = err?.error?.message ?? 'The terms could not be saved.'; this.cdr.markForCheck(); },
    });
  }

  addNoteColumn(name: string): void {
    const c = name.trim();
    if (!c || this.notes.some(n => n.column === c)) return;
    this.notes = [...this.notes, { column: c, note: '', displayName: '' }];
  }

  /** Saves one dataset instruction; reset sends an empty text, which goes back to the tenant's text. */
  saveDatasetPrompt(p: AiPromptDto, reset = false): void {
    const src = this.currentSource;
    if (!src) return;
    this.savingPrompt = p.key;
    this.promptMessage[p.key] = '';
    this.ai.saveDatasetPrompt(src.type, src.id, p.key, reset ? '' : this.promptDrafts[p.key]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: list => { this.applyDatasetPrompts(list); this.savingPrompt = null; this.promptMessage[p.key] = reset ? 'Back to the tenant text.' : 'Saved.'; this.cdr.markForCheck(); },
      error: err => { this.savingPrompt = null; this.promptMessage[p.key] = err?.error?.message ?? err?.error?.errors?.[0]?.message ?? 'The text could not be saved.'; this.cdr.markForCheck(); },
    });
  }

  get hasDatasetPromptOverride(): boolean { return this.datasetPrompts.some(p => p.isCustom); }

  private applyDatasetPrompts(list: AiPromptDto[]): void {
    this.datasetPrompts = list;
    this.promptDrafts = Object.fromEntries(list.map(p => [p.key, p.text]));
  }

  saveNotes(): void {
    const src = this.currentSource;
    if (!src) return;
    this.savingNotes = true;
    const payload: AiDatasetNote[] = [{ column: null, note: this.datasetNote }, ...this.notes];
    this.ai.saveNotes(src.type, src.id, payload).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.savingNotes = false; this.notesMessage = 'Saved. New questions will use these notes.'; this.cdr.markForCheck(); },
      error: err => { this.savingNotes = false; this.notesMessage = err?.error?.message ?? 'The notes could not be saved.'; this.cdr.markForCheck(); },
    });
  }

  /** Hands the answer's mapping to the Chart Builder, which opens with the dataset and axes preset. */
  openInChartBuilder(t: Turn): void {
    if (!t.chart) return;
    this.presets.set(t.chart);
    this.panel.close();
    this.router.navigate(['/charts-tiles/builder']);
  }

  onEnter(ev: Event): void {
    const e = ev as KeyboardEvent;
    if (!e.shiftKey) { e.preventDefault(); this.ask(); }
  }

  /** Human-readable one-liner for a spec, e.g. "sum(Amount) by Region · where Year eq 2025 · top 10". */
  describe(spec: AiQuerySpec): string {
    const parts: string[] = [];
    const measures = (spec.measures ?? []).map(m => m.column ? `${m.agg}(${m.column})` : 'count');
    if (measures.length) parts.push(measures.join(', ') + ((spec.groupBy?.length) ? ` by ${spec.groupBy!.join(', ')}` : ''));
    else if (spec.select?.length) parts.push(`columns ${spec.select.join(', ')}`);
    else parts.push('all columns');
    for (const f of spec.filters ?? []) parts.push(`where ${f.column} ${f.op} ${f.value === undefined || f.value === null ? '' : JSON.stringify(f.value)}`.trim());
    if (spec.sort) parts.push(`sort ${spec.sort.column} ${spec.sort.descending ? 'desc' : 'asc'}`);
    if (spec.limit) parts.push(`limit ${spec.limit}`);
    return parts.join(' · ');
  }

  /** A cell for people; an empty group value reads "(blank)" so the row does not look broken. */
  format(v: unknown, group = false): string {
    if (v === null || v === undefined || (group && String(v).trim() === '')) return group ? '(blank)' : '';
    if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    return String(v);
  }

  /** Column header for people (cluster_name → Cluster Name); the raw name stays in the tooltip. */
  label(column: string, labels?: Record<string, string> | null): string { return labels?.[column] ?? StringUtil.toLabel(column); }

  trackTurn(i: number): number { return i; }

  private loadAlerts(): void {
    this.ai.alerts().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: a => { this.alerts = a; this.cdr.markForCheck(); },
      error: () => { /* alerts are optional */ },
    });
  }

  private loadConversations(): void {
    this.ai.conversations().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: c => { this.conversations = c; this.cdr.markForCheck(); },
      error: () => { /* history is optional */ },
    });
  }

  private scrollToEnd(): void {
    setTimeout(() => { const el = this.scroller?.nativeElement; if (el) el.scrollTop = el.scrollHeight; });
  }
}
