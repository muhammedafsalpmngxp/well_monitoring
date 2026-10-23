/**
 * Types and presentation helpers of the Data Anomaly page. DTO fields are camelCase (Tenant API); the run result and
 * the proposal body are the engine's own JSON (snake_case) as stored. Nothing here derives a figure: the page shows
 * what the API returned. Model text becomes plain blocks rendered by interpolation, so no model HTML reaches the DOM.
 */
import { AiFeatureJob } from '../agentic-features.service';

/** One call's state on the page. */
export interface Load<T> { loading: boolean; error: string; data: T | null }
export function idle<T>(): Load<T> { return { loading: false, error: '', data: null }; }

export type Severity = 'critical' | 'high' | 'medium' | 'low';
export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
/** Statuses an admin may set a rule to (the API's list). */
export const RULE_STATUSES = ['active', 'probation', 'draft', 'disabled'];
export const PROPOSAL_STATUSES = ['pending', 'accepted', 'rejected', 'dropped'];

// ── API DTOs ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AnomalyRunSummary {
  runId: string; status: string; databaseName: string | null; startedAt: string; finishedAt: string | null;
  score: number | null; probesRun: number | null; recordsExamined: number | null; recordsFlagged: number | null;
  startedBy: string; error: string | null; reports: string[];
}

export interface AnomalyOverview {
  latestRun: AnomalyRunSummary | null;
  rulesByStatus: Record<string, number>;
  probesByStatus: Record<string, number>;
  pendingProposals: number;
  activeJob: AiFeatureJob | null;
  lastJob: AiFeatureJob | null;
  configured: boolean;
  aiEnabled: boolean;
}

export interface RuleDefinition {
  ruleId?: string; title?: string; category?: string; severity?: string; entity?: string; method?: string; sqlMode?: string;
  status?: string; source?: string; tags?: string[]; expandsOver?: unknown; body?: string; params?: Record<string, unknown>;
  summarySql?: string; detailSql?: string; discovery?: Record<string, unknown>;
}

export interface AnomalyRule {
  ruleId: string; title: string; category: string | null; severity: string; status: string; source: string;
  definition: RuleDefinition | null; probeStatus: string | null; probes: number; failedProbes: number; probeError: string | null;
  compiledAt: string | null; edited: boolean; modifiedBy: string; modifiedAt: string;
}

/** One compiled check of a rule: DetailSql lists the flagged records, SummarySql counts them. */
export interface AnomalyCheck {
  probeId: string; ruleId: string; status: string; summarySql: string | null; detailSql: string | null;
  tables: string[]; error: string | null; compiledAt: string;
}

export interface RankedFinding {
  rule_id: string; title: string; category: string; severity: string; status?: string; scope_total: number;
  anomaly_count: number; anomaly_pct: number; share: number; contribution?: number; detail_total?: number; concerns?: string[];
}

export interface RunTotals {
  probes_run?: number; probes_failed?: number; probes_clean?: number; probes_with_findings?: number; probes_empty_scope?: number;
  records_examined?: number; records_flagged?: number; not_running?: number;
}

export interface RunResult {
  run_id?: string; started_at?: string; database?: { name?: string; server?: string } | null; seconds?: number;
  score?: number | null; score_basis?: string; rule_set_fingerprint?: string; summary?: string;
  totals?: RunTotals; by_severity?: Partial<Record<string, number>>;
  by_category?: { category: string; rules: number; anomalies: number }[];
  ranked?: RankedFinding[]; discovered_ranked?: RankedFinding[]; discovered_totals?: RunTotals;
  empty_scope?: string[]; not_running?: { rule_id: string; title?: string; status?: string; reason?: string }[];
  failed?: { rule_id: string; error?: string }[]; catalog_stale?: boolean; catalog_note?: string; error?: string | null;
  staleProbes?: { ruleId: string; title?: string; reason?: string; rebuilt?: boolean }[];
}

export interface AnomalyRun { run: AnomalyRunSummary; result: RunResult | null }

export interface ProposalBody {
  title?: string; what_is_wrong?: string; why_it_matters?: string; how_to_detect?: string; do_not_flag?: string;
  category?: string; severity?: string; entity?: string; evidence?: unknown; observation_id?: string; confidence?: number | string;
  observation_fact?: string; tables?: string[]; hash?: string;
}

export interface AnomalyProposal {
  id: number; hash: string; status: string; title: string; proposal: ProposalBody | null; ruleId: string | null;
  reason: string | null; decidedBy: string | null; decidedAt: string | null; createdAt: string;
}

/** The engine's introspect summary (the fields this page shows; the rest is ignored). */
export interface SchemaInfo {
  tables?: number; emptyTables?: number; foreignKeys?: number; tablesWithStats?: number; fingerprint?: string;
  fromCache?: boolean; notes?: string[]; tableList?: { name: string; rows: number | null; columns: number }[];
}

// ── Formatting ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** probation → "Probation", not_applicable → "Not applicable". */
export function label(code: string | null | undefined): string {
  if (!code) return '';
  const words = String(code).replace(/[_-]/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

export function severityRank(s: string | null | undefined): number {
  const i = SEVERITIES.indexOf((s ?? '').toLowerCase() as Severity);
  return i < 0 ? SEVERITIES.length : i;
}

/** A severity class suffix: critical | high | medium | low | none. */
export function sevClass(s: string | null | undefined): string {
  const v = (s ?? '').toLowerCase();
  return (SEVERITIES as string[]).includes(v) ? v : 'none';
}

/** Tone of a rule, probe, run, job or proposal status. */
export function statusTone(s: string | null | undefined): 'ok' | 'warn' | 'bad' | 'info' | 'neutral' {
  switch ((s ?? '').toLowerCase()) {
    case 'active': case 'succeeded': case 'completed': case 'accepted': return 'ok';
    case 'probation': case 'pending': case 'queued': case 'running': return 'info';
    case 'failed': case 'error': case 'rejected': return 'bad';
    case 'not_applicable': case 'cancelled': case 'partial': case 'draft': return 'warn';
    default: return 'neutral';
  }
}

/** Anything the engine stored, as display text (objects as compact JSON). */
export function asText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

/** Progress of a job as 0–100, or null when the stage has no total. */
export function jobPercent(job: AiFeatureJob | null | undefined): number | null {
  const p = job?.progress;
  if (!p || !p.total || p.total <= 0 || p.done == null) return null;
  return Math.max(0, Math.min(100, Math.round((100 * p.done) / p.total)));
}

export function jobActive(job: AiFeatureJob | null | undefined): boolean {
  return !!job && (job.status === 'queued' || job.status === 'running');
}

// ── Model text → safe blocks ─────────────────────────────────────────────────────────────────────────────────────────

export interface TextPart { kind: 'text' | 'strong' | 'code'; text: string }
export interface TextBlock { kind: 'p' | 'h' | 'ul'; parts?: TextPart[]; items?: TextPart[][] }

function inline(text: string): TextPart[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map(part => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return { kind: 'strong' as const, text: part.slice(2, -2) };
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return { kind: 'code' as const, text: part.slice(1, -1) };
    return { kind: 'text' as const, text: part };
  });
}

/** Paragraphs, "#" headings and "-" / "*" / "1." bullet lines; everything else is text. */
export function toBlocks(text: string | null | undefined): TextBlock[] {
  const blocks: TextBlock[] = [];
  let para: string[] = [];
  let list: TextPart[][] | null = null;
  const flushPara = () => { if (para.length) { blocks.push({ kind: 'p', parts: inline(para.join(' ')) }); para = []; } };
  const flushList = () => { if (list) { blocks.push({ kind: 'ul', items: list }); list = null; } };
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); continue; }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (heading) { flushPara(); flushList(); blocks.push({ kind: 'h', parts: inline(heading[1]) }); }
    else if (bullet) { flushPara(); (list ??= []).push(inline(bullet[1])); }
    else { flushList(); para.push(line); }
  }
  flushPara();
  flushList();
  return blocks;
}
