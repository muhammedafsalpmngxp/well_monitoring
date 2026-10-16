import { Injectable, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { API_ENDPOINTS } from '../constants/api.constants';
import { TokenService } from './token.service';

export type AiProvider = 'openai' | 'anthropic' | 'azure' | 'ollama' | 'custom';

/** Tenant-wide switches. activeProviderId is null until a provider is chosen. */
/** An editable AI instruction; text is the one in use (custom or default). */
export interface AiPromptDto { key: string; name: string; description: string; defaultText: string; text: string; isCustom: boolean }

export interface AiSettingsDto {
  dailyQuota: number;
  isEnabled: boolean;
  activeProviderId?: number | null;
  modifiedAt?: string | null;
}

export interface SaveAiSettingsRequest { dailyQuota: number; isEnabled: boolean }

export type AiFeatureKey = 'ask' | 'chart' | 'learning';

/** Feature keys the signed-in user may use; master flag, active provider and role grants already folded in. */
export interface AiFeatures { enabled: string[] }
export interface AiInsightReport { question: string; sourceName: string; totalRows: number; trend: string[]; findings: string[]; anomalies: string[]; recommendations: string[] }

export interface AiFeatureDef { key: string; name: string; description: string }

/** Admin view: catalog plus role codes granted per feature key. */
export interface AiFeatureAccess { features: AiFeatureDef[]; access: Record<string, string[]> }

/** A registered provider. The key never comes back, only hasApiKey. */
export interface AiProviderDto {
  id: number;
  name: string;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  /** Cheaper model for routing / planning steps; null = model. */
  fastModel?: string | null;
  hasApiKey: boolean;
  isActive: boolean;
  modifiedAt: string;
}

/** apiKey empty keeps the stored key on update. */
export interface SaveAiProviderRequest { name: string; provider: AiProvider; baseUrl: string; model: string; apiKey?: string | null; fastModel?: string | null }

export interface AiTestResultDto { success: boolean; message: string; latencyMs: number }

export interface AiUsageDayDto { day: string; calls: number; failed: number; promptTokens: number; completionTokens: number }

export interface AiUsageSummaryDto { callsToday: number; dailyQuota: number; days: AiUsageDayDto[] }
export interface AiActivityItem { messageId: number; conversationId: number; userId: string; userName: string | null; sourceType: AiSourceType; sourceId: number; sourceName: string;
  question: string; answer: string; hasQuery: boolean; hasTrace: boolean; totalMs: number | null; createdAt: string }
export interface AiActivityPage { total: number; items: AiActivityItem[] }
export type AiRelationStatus = 'suggested' | 'confirmed' | 'rejected';
export interface AiRelation { id: number; fromType: AiSourceType; fromId: number; fromName: string; fromColumn: string; toType: AiSourceType; toId: number; toName: string; toColumn: string;
  status: AiRelationStatus; overlap: number | null; modifiedAt: string }
export interface AiRelationNode { sourceType: AiSourceType; sourceId: number; name: string; links: number }
export interface AiRelationGraph { nodes: AiRelationNode[]; links: AiRelation[] }
export interface AiRelationScan { datasetsScanned: number; suggested: number; kept: number; skipped: string[] }
export interface AiFailure { id: number; userId: string | null; userName: string | null; purpose: string; model: string; latencyMs: number; error: string | null; createdAt: string }

// ── Ask your data ─────────────────────────────────────────────────────────────

export type AiSourceType = 'view' | 'import';

export interface AiDataset { sourceType: AiSourceType; sourceId: number; name: string; description?: string | null; rowCount?: number | null }

export interface AiMeasure { agg: string; column?: string | null; alias?: string | null }
export interface AiFilter { column: string; op: string; value?: unknown }

/** The query the AI produced; validated and run on the server, never SQL. */
export interface AiQuerySpec {
  select?: string[] | null;
  groupBy?: string[] | null;
  measures?: AiMeasure[] | null;
  filters?: AiFilter[] | null;
  sort?: { column: string; descending: boolean } | null;
  limit?: number | null;
}

export interface AiQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  sourceRows: number;
  sourceTruncated: boolean;
  /** Admin display names for result columns that have one. */
  labels?: Record<string, string> | null;
}

/** A watched answer: re-checked every everyHours; the owner is notified when it starts firing. */
export type AiAlertKind = 'above' | 'below' | 'unusual' | 'change';
export interface AiAlert { id: number; sourceType: AiSourceType; sourceId: number; sourceName: string; question: string; kind: AiAlertKind; threshold: number | null; everyHours: number; notifyEmails: string | null;
  isTriggered: boolean; lastMessage: string | null; lastCheckedAt: string | null; nextCheckAt: string }
export interface AiConversation { id: number; sourceType: AiSourceType; sourceId: number; sourceName: string; title: string; modifiedAt: string }

export interface AiChatMessage { id: number; role: 'user' | 'assistant'; content: string; querySpec?: AiQuerySpec | null; createdAt: string }

/** column null is the dataset-level note. */
export interface AiDatasetNote { column: string | null; note: string; displayName?: string | null }

/** A named, trusted measure: name = agg(column). Column null only for count. */
export interface AiMetric { name: string; agg: string; column: string | null; description?: string | null }
/** A business word for a dataset: a filter (column = value) and/or a free-text meaning. Synonyms comma separated. */
/** liked/disliked = a user's rating; approved/rejected = the AI's review or an admin; pending = review not done. */
export type AiExampleStatus = 'liked' | 'approved' | 'pending' | 'rejected' | 'disliked';
export interface AiExample { id: number; messageId: number; question: string; status: AiExampleStatus; review: string | null; createdAt: string }
/** One step behind an answer; prompt and reply only for AI calls. */
export interface AiTraceStep { step: 'load' | 'context' | 'ask' | 'query' | 'rejected' | 'answer'; ms: number; detail: string | null; prompt: { role: string; content: string }[] | null; reply: string | null }
export interface AiTerm { term: string; synonyms: string | null; column: string | null; value: string | null; meaning: string | null }

/** A rule the model extracted from a conversation, awaiting admin review. */
export interface AiNoteProposal { id: number; column: string | null; note: string; confidence: string; question: string; createdAt: string }

export interface AiConversationDetail { conversation: AiConversation; messages: AiChatMessage[] }

export interface AiColumnProfile { distinct: number; samples: string[] }
export interface AiFilterSuggestChart { title: string; sourceTable: string; sourceType: string; columns: Record<string, AiColumnProfile> }
export interface AiFilterSuggestRequest { dashboardName: string; charts: AiFilterSuggestChart[]; alreadyAdded: string[] }
export interface AiFilterSuggestion { sourceTable: string; sourceColumn: string; label: string; reason: string }

/** Editable Chart Builder fields; in a patch every field is optional. */
export interface AiChartState {
  chartType?: string | null; xAxis?: string | null; yAxis?: string | null; yAggColumn?: string | null;
  title?: string | null; xAxisTitle?: string | null; yAxisTitle?: string | null;
  showLegend?: boolean | null; showDataLabels?: boolean | null; showAxisTitle?: boolean | null; includeDataTable?: boolean | null;
  limitCategory?: string | null; topN?: number | null; bottomN?: number | null; groupRestAsOthers?: boolean | null;
}
export interface AiChartEditRequest { instruction: string; current: AiChartState; columns: string[]; chartTypes: string[] }
export interface AiChartEditResponse { patch: AiChartState; message: string }

export interface AiChartSuggestRequest { sourceName: string; rowCount: number; columns: Record<string, AiColumnProfile>; chartTypes: string[] }
export interface AiChartSuggestion { patch: AiChartState; reason: string }
export interface AiDashboardSuggestRequest extends AiChartSuggestRequest { goal: string }
export interface AiDashboardSuggestion { title: string; charts: AiChartSuggestion[] }

export interface AiSummaryRequest { title: string; columns: string[]; rows: Record<string, unknown>[]; context?: string | null; force?: boolean }
export interface AiDashboardSummaryRequest { title: string; charts: AiSummaryRequest[]; force?: boolean }
export interface SqlPlanFacts { statements: number; scans: string[]; missingIndexes: string[]; warnings: string[]; estimatedCost: number; estimatedRows: number }
export interface AiSqlIssue { severity: 'high' | 'medium' | 'low'; text: string }
export interface AiSqlReview { explanation: string; issues: AiSqlIssue[]; suggestions: string[]; optimisedSql: string | null; optimisedNote: string | null; plan: SqlPlanFacts | null }
export interface AiDeckSlide { title: string; bullets: string[]; takeaway: string | null }
export interface AiDeck { title: string; headline: string; slides: AiDeckSlide[]; closing: string }

/** spec: an option picked from a clarification, run as given. */
export interface AiAskRequest { conversationId?: number | null; sourceType?: AiSourceType | null; sourceId?: number | null; question: string; spec?: AiQuerySpec | null }
export interface AiClarifyOption { label: string; spec: AiQuerySpec }
export interface AiClarification { question: string; options: AiClarifyOption[] }

export type AiAskEvent =
  | { type: 'status'; data: string }
  | { type: 'spec'; data: AiQuerySpec }
  | { type: 'result'; data: AiQueryResult }
  | { type: 'answer'; data: string }
  | { type: 'done'; data: { conversationId: number; sourceName: string; messageId: number } | { cached: boolean } | null }
  | { type: 'suggestions'; data: string[] }
  | { type: 'clarify'; data: AiClarification }
  | { type: 'insights'; data: string[] }
  | { type: 'trace'; data: AiTraceStep[] }
  | { type: 'error'; data: string };

@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly api = environment.tenantApiUrl;

  constructor(private readonly http: HttpClient, private readonly tokens: TokenService, private readonly zone: NgZone) {}

  getSettings(): Observable<AiSettingsDto> {
    return this.http.get<AiSettingsDto>(`${this.api}${API_ENDPOINTS.AI.SETTINGS}`);
  }

  saveSettings(request: SaveAiSettingsRequest): Observable<AiSettingsDto> {
    return this.http.put<AiSettingsDto>(`${this.api}${API_ENDPOINTS.AI.SETTINGS}`, request);
  }

  providers(): Observable<AiProviderDto[]> {
    return this.http.get<AiProviderDto[]>(`${this.api}${API_ENDPOINTS.AI.PROVIDERS}`);
  }

  addProvider(request: SaveAiProviderRequest): Observable<AiProviderDto> {
    return this.http.post<AiProviderDto>(`${this.api}${API_ENDPOINTS.AI.PROVIDERS}`, request);
  }

  updateProvider(id: number, request: SaveAiProviderRequest): Observable<AiProviderDto> {
    return this.http.put<AiProviderDto>(`${this.api}${API_ENDPOINTS.AI.PROVIDER(id)}`, request);
  }

  deleteProvider(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}${API_ENDPOINTS.AI.PROVIDER(id)}`);
  }

  activateProvider(id: number): Observable<AiProviderDto> {
    return this.http.post<AiProviderDto>(`${this.api}${API_ENDPOINTS.AI.PROVIDER_ACTIVATE(id)}`, {});
  }

  /** Sends a one-line prompt to this provider; counts against the quota. */
  testProvider(id: number): Observable<AiTestResultDto> {
    return this.http.post<AiTestResultDto>(`${this.api}${API_ENDPOINTS.AI.PROVIDER_TEST(id)}`, {});
  }

  /** Admin: the relationship graph between datasets and the actions on it. */
  relations(): Observable<AiRelationGraph> {
    return this.http.get<AiRelationGraph>(`${this.api}${API_ENDPOINTS.AI.RELATIONS}`);
  }

  detectRelations(datasets: string[]): Observable<AiRelationScan> {
    return this.http.post<AiRelationScan>(`${this.api}${API_ENDPOINTS.AI.RELATIONS}/detect`, { datasets });
  }

  addRelation(req: { fromType: AiSourceType; fromId: number; fromColumn: string; toType: AiSourceType; toId: number; toColumn: string }): Observable<AiRelation> {
    return this.http.post<AiRelation>(`${this.api}${API_ENDPOINTS.AI.RELATIONS}`, req);
  }

  setRelationStatus(id: number, status: AiRelationStatus): Observable<AiRelation> {
    return this.http.put<AiRelation>(`${this.api}${API_ENDPOINTS.AI.RELATION_STATUS(id)}`, { status });
  }

  deleteRelation(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}${API_ENDPOINTS.AI.RELATION(id)}`);
  }

  /** Admin: every user's answers in the period, newest first. */
  activity(days: number, q: string | null, skip: number, take: number): Observable<AiActivityPage> {
    return this.http.get<AiActivityPage>(`${this.api}${API_ENDPOINTS.AI.ACTIVITY}`, { params: { days, skip, take, ...(q ? { q } : {}) } });
  }

  activityTrace(messageId: number): Observable<AiTraceStep[]> {
    return this.http.get<AiTraceStep[]>(`${this.api}${API_ENDPOINTS.AI.ACTIVITY_TRACE(messageId)}`);
  }

  failures(days: number): Observable<AiFailure[]> {
    return this.http.get<AiFailure[]>(`${this.api}${API_ENDPOINTS.AI.ACTIVITY_FAILURES}`, { params: { days } });
  }

  getUsage(days = 14): Observable<AiUsageSummaryDto> {
    return this.http.get<AiUsageSummaryDto>(`${this.api}${API_ENDPOINTS.AI.USAGE}`, { params: { days } });
  }

  /** Live per-session view of the flags; the navbar and panel hide what is off. Loaded on first use. */
  features(): Observable<AiFeatures> {
    if (!this.featuresLoaded) { this.featuresLoaded = true; this.loadFeatures(); }
    return this.features$.pipe(filter((f): f is AiFeatures => f !== null));
  }
  private readonly features$ = new BehaviorSubject<AiFeatures | null>(null);
  private featuresLoaded = false;

  /** Called after an admin saves settings so every subscriber (navbar, panel) updates without a reload. */
  refreshFeatures(): void { this.loadFeatures(); }

  private loadFeatures(): void {
    this.http.get<AiFeatures>(`${this.api}${API_ENDPOINTS.AI.FEATURES}`).subscribe({
      next: f => this.features$.next(f),
      error: () => this.features$.next({ enabled: [] }),
    });
  }

  featureAccess(): Observable<AiFeatureAccess> {
    return this.http.get<AiFeatureAccess>(`${this.api}${API_ENDPOINTS.AI.FEATURE_ACCESS}`);
  }

  saveFeatureAccess(access: Record<string, string[]>): Observable<AiFeatureAccess> {
    return this.http.put<AiFeatureAccess>(`${this.api}${API_ENDPOINTS.AI.FEATURE_ACCESS}`, access);
  }

  /** Admin: the editable AI instructions. */
  prompts(): Observable<AiPromptDto[]> {
    return this.http.get<AiPromptDto[]>(`${this.api}${API_ENDPOINTS.AI.PROMPTS}`);
  }

  /** Admin: save one instruction; empty text resets it to the default. Returns every prompt. */
  savePrompt(key: string, text: string): Observable<AiPromptDto[]> {
    return this.http.put<AiPromptDto[]>(`${this.api}${API_ENDPOINTS.AI.PROMPT(key)}`, { text });
  }

  datasets(): Observable<AiDataset[]> {
    return this.http.get<AiDataset[]>(`${this.api}${API_ENDPOINTS.AI.DATASETS}`);
  }

  alerts(): Observable<AiAlert[]> {
    return this.http.get<AiAlert[]>(`${this.api}${API_ENDPOINTS.AI.ALERTS}`);
  }

  /** Watch one of your answers; it is checked once straight away. */
  createAlert(req: { messageId: number; kind: AiAlertKind; threshold: number | null; everyHours: number; notifyEmails: string | null }): Observable<AiAlert> {
    return this.http.post<AiAlert>(`${this.api}${API_ENDPOINTS.AI.ALERTS}`, req);
  }

  checkAlert(id: number): Observable<AiAlert> {
    return this.http.post<AiAlert>(`${this.api}${API_ENDPOINTS.AI.ALERT_CHECK(id)}`, {});
  }

  deleteAlert(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}${API_ENDPOINTS.AI.ALERT(id)}`);
  }

  conversations(): Observable<AiConversation[]> {
    return this.http.get<AiConversation[]>(`${this.api}${API_ENDPOINTS.AI.CONVERSATIONS}`);
  }

  conversation(id: number): Observable<AiConversationDetail> {
    return this.http.get<AiConversationDetail>(`${this.api}${API_ENDPOINTS.AI.CONVERSATION(id)}`);
  }

  deleteConversation(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}${API_ENDPOINTS.AI.CONVERSATION(id)}`);
  }

  /** Thumbs-up: the answer's question and query become an example for later questions on that dataset. */
  like(messageId: number): Observable<void> {
    return this.http.post<void>(`${this.api}${API_ENDPOINTS.AI.MESSAGE_LIKE(messageId)}`, {});
  }

  unlike(messageId: number): Observable<void> {
    return this.http.delete<void>(`${this.api}${API_ENDPOINTS.AI.MESSAGE_LIKE(messageId)}`);
  }

  /** Thumbs-down: the answer is never used as an example. Removing the rating is unlike(). */
  dislike(messageId: number): Observable<void> {
    return this.http.post<void>(`${this.api}${API_ENDPOINTS.AI.MESSAGE_DISLIKE(messageId)}`, {});
  }

  /** Prompt trace: what was sent to the AI for an answer and what came back (own answers, last 30 days). */
  /** Insight report for a stored answer: checked trend/findings/anomalies plus AI recommendations. */
  report(messageId: number): Observable<AiInsightReport> {
    return this.http.post<AiInsightReport>(`${this.api}${API_ENDPOINTS.AI.MESSAGE_REPORT(messageId)}`, {});
  }

  trace(messageId: number): Observable<AiTraceStep[]> {
    return this.http.get<AiTraceStep[]>(`${this.api}${API_ENDPOINTS.AI.MESSAGE_TRACE(messageId)}`);
  }

  /** Admin: examples learned for a dataset (liked first), with their review status. */
  examples(sourceType: AiSourceType, sourceId: number): Observable<AiExample[]> {
    return this.http.get<AiExample[]>(`${this.api}${API_ENDPOINTS.AI.DATASET_EXAMPLES(sourceType, sourceId)}`);
  }

  /** Admin: use (approved) or stop using (rejected) a learned example. */
  setExampleStatus(id: number, status: 'approved' | 'rejected'): Observable<void> {
    return this.http.put<void>(`${this.api}${API_ENDPOINTS.AI.EXAMPLE_STATUS(id)}`, { status });
  }

  deleteExample(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}${API_ENDPOINTS.AI.EXAMPLE(id)}`);
  }

  notes(sourceType: AiSourceType, sourceId: number): Observable<AiDatasetNote[]> {
    return this.http.get<AiDatasetNote[]>(`${this.api}${API_ENDPOINTS.AI.DATASET_NOTES(sourceType, sourceId)}`);
  }

  metrics(sourceType: AiSourceType, sourceId: number): Observable<AiMetric[]> {
    return this.http.get<AiMetric[]>(`${this.api}${API_ENDPOINTS.AI.DATASET_METRICS(sourceType, sourceId)}`);
  }

  /** The dataset's real column names (for the term and metric column pickers). */
  datasetColumns(sourceType: AiSourceType, sourceId: number): Observable<string[]> {
    return this.http.get<string[]>(`${this.api}${API_ENDPOINTS.AI.DATASET_COLUMNS(sourceType, sourceId)}`);
  }

  terms(sourceType: AiSourceType, sourceId: number): Observable<AiTerm[]> {
    return this.http.get<AiTerm[]>(`${this.api}${API_ENDPOINTS.AI.DATASET_TERMS(sourceType, sourceId)}`);
  }

  /** Admin: replaces the dataset's business terms. */
  saveTerms(sourceType: AiSourceType, sourceId: number, terms: AiTerm[]): Observable<AiTerm[]> {
    return this.http.put<AiTerm[]>(`${this.api}${API_ENDPOINTS.AI.DATASET_TERMS(sourceType, sourceId)}`, terms);
  }

  /** Admin: replaces the dataset's metrics. */
  saveMetrics(sourceType: AiSourceType, sourceId: number, metrics: AiMetric[]): Observable<AiMetric[]> {
    return this.http.put<AiMetric[]>(`${this.api}${API_ENDPOINTS.AI.DATASET_METRICS(sourceType, sourceId)}`, metrics);
  }

  /** Admin: pending AI-extracted proposals for a dataset. */
  proposals(sourceType: AiSourceType, sourceId: number): Observable<AiNoteProposal[]> {
    return this.http.get<AiNoteProposal[]>(`${this.api}${API_ENDPOINTS.AI.DATASET_PROPOSALS(sourceType, sourceId)}`);
  }

  reviewProposal(id: number, action: 'approve' | 'reject'): Observable<void> {
    return this.http.post<void>(`${this.api}${API_ENDPOINTS.AI.PROPOSAL_REVIEW(id, action)}`, {});
  }

  /** Admin: replaces the dataset's notes. */
  /** Instructions that can differ per dataset (admin); defaultText is the tenant text in use. */
  datasetPrompts(sourceType: AiSourceType, sourceId: number): Observable<AiPromptDto[]> {
    return this.http.get<AiPromptDto[]>(`${this.api}${API_ENDPOINTS.AI.DATASET_PROMPTS(sourceType, sourceId)}`);
  }

  saveDatasetPrompt(sourceType: AiSourceType, sourceId: number, key: string, text: string): Observable<AiPromptDto[]> {
    return this.http.put<AiPromptDto[]>(`${this.api}${API_ENDPOINTS.AI.DATASET_PROMPTS(sourceType, sourceId)}/${key}`, { text });
  }

  saveNotes(sourceType: AiSourceType, sourceId: number, notes: AiDatasetNote[]): Observable<AiDatasetNote[]> {
    return this.http.put<AiDatasetNote[]>(`${this.api}${API_ENDPOINTS.AI.DATASET_NOTES(sourceType, sourceId)}`, notes);
  }

  /** Asks a question and emits server-sent events as they arrive. */
  ask(request: AiAskRequest): Observable<AiAskEvent> {
    return this.stream(API_ENDPOINTS.AI.ASK, request);
  }

  /** Recommends dashboard-wide filters; validated server-side, may be empty. */
  suggestFilters(request: AiFilterSuggestRequest): Observable<AiFilterSuggestion[]> {
    return this.http.post<AiFilterSuggestion[]>(`${this.api}${API_ENDPOINTS.AI.SUGGEST_FILTERS}`, request);
  }

  /** Up to three chart suggestions for a loaded data source. */
  chartSuggest(request: AiChartSuggestRequest): Observable<AiChartSuggestion[]> {
    return this.http.post<AiChartSuggestion[]>(`${this.api}${API_ENDPOINTS.AI.CHART_SUGGEST}`, request);
  }

  /** A dashboard title and up to six chart patches for a dataset and a goal. */
  dashboardSuggest(request: AiDashboardSuggestRequest): Observable<AiDashboardSuggestion> {
    return this.http.post<AiDashboardSuggestion>(`${this.api}${API_ENDPOINTS.AI.DASHBOARD_SUGGEST}`, request);
  }

  /** Plain-language chart edit; the patch is validated server-side against the given columns and chart types. */
  chartEdit(request: AiChartEditRequest): Observable<AiChartEditResponse> {
    return this.http.post<AiChartEditResponse>(`${this.api}${API_ENDPOINTS.AI.CHART_EDIT}`, request);
  }

  /** Explains a chart's rendered data; emits answer deltas then done. */
  summarize(request: AiSummaryRequest): Observable<AiAskEvent> {
    return this.stream(API_ENDPOINTS.AI.SUMMARY, request);
  }

  /** Explains a whole dashboard from its charts' rendered data. */
  summarizeDashboard(request: AiDashboardSummaryRequest): Observable<AiAskEvent> {
    return this.stream(API_ENDPOINTS.AI.DASHBOARD_SUMMARY, request);
  }

  /** Explains a view's SQL with estimated-plan facts, lists issues and proposes an optimised query. */
  sqlReview(req: { connectionId: number; sql: string | null; viewId: number | null }): Observable<AiSqlReview> {
    return this.http.post<AiSqlReview>(`${this.api}${API_ENDPOINTS.AI.SQL_REVIEW}`, req);
  }

  /** The narrative for a slide deck: headline, one slide per chart (in the order given), closing. */
  deck(request: { title: string; charts: AiSummaryRequest[] }): Observable<AiDeck> {
    return this.http.post<AiDeck>(`${this.api}${API_ENDPOINTS.AI.DECK}`, request);
  }

  /**
   * POSTs and reads a server-sent event stream. Uses fetch rather than HttpClient because HttpClient
   * buffers the whole body; the Bearer token is added by hand for the same reason.
   */
  private stream(path: string, body: unknown): Observable<AiAskEvent> {
    return new Observable<AiAskEvent>(subscriber => {
      const controller = new AbortController();
      const run = async () => {
        const res = await fetch(`${this.api}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.tokens.getAccessToken() ?? ''}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(res.status === 401 ? 'Please sign in again.' : `The request failed (HTTP ${res.status}).`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const type = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (type && data !== undefined) this.zone.run(() => subscriber.next({ type, data: JSON.parse(data) } as AiAskEvent));
          }
        }
        this.zone.run(() => subscriber.complete());
      };
      run().catch(err => this.zone.run(() => subscriber.error(err)));
      return () => controller.abort();
    });
  }
}
