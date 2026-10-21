import { Injectable, NgZone } from '@angular/core';
import { HttpClient, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { TokenService } from '../../core/services/token.service';

/** A twise agent and one of its actions, e.g. db_assistant / chat. */
export interface AgentTool { agent: string; action: string; }
/** id / x / y: the canvas node id and position (layout only). */
export type BranchOp = 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'empty' | 'not_empty' | 'else';
/** One way out of a router: rule `input op value` (input may be last_answer), or 'else'; target = step id, 'answer' or null. */
export interface AgentBranch { id: string; label?: string | null; input?: string | null; op: BranchOp; value?: string | null; target?: string | null; }
/**
 * kind 'router' picks one branch (routeBy rules or ai); next = the step to run after this one (null = the following).
 * kind 'setup' (first step, Saved SQL only) runs before the others; its first row's columns named like inputs set them.
 */
export interface AgentStep {
  text: string; tool?: AgentTool | null; id?: string | null; x?: number | null; y?: number | null;
  kind?: StepKind; routeBy?: 'rules' | 'ai'; branches?: AgentBranch[] | null; next?: string | null;
  /** Saved SQL steps: the SELECT they run; {{input}} placeholders are bound as parameters. */
  sql?: string | null;
  /** agentflow Agent / Task fields: expected output and output key ({{key}} later) on every step; model, temperature
   *  and max tokens for the built-in Ask AI tool. */
  expectedOutput?: string | null; outputKey?: string | null; model?: string | null; temperature?: number | null; maxTokens?: number | null;
  /** For Each: the input or output key holding a list; the step runs once per item ({{item}}). */
  forEach?: string | null;
  /** Retry a failed step this many more times (0–5). */
  retries?: number | null;
  /** Settings of the Evaluator / Guardrail / Compute / Merge steps. */
  options?: Record<string, unknown> | null;
}

export type StepKind = 'step' | 'router' | 'setup';

/** The built-in Saved SQL tool: a step runs its own SELECT, with no model call (the summary action adds one). */
export const SQL_QUERY_TOOL = 'sql_query';
/** An input with this name lets people ask in their own words; one fast-model call fills the agent's other inputs. */
export const QUESTION_INPUT = 'question';

/** "Understood as" text for the inputs a question or the setup step set during a run. */
export function understoodText(e: { by: 'question' | 'setup'; values: Record<string, string>; note?: string }): string {
  const set = Object.entries(e.values).map(([k, v]) => `${k} = ${v}`).join(' · ');
  const from = e.by === 'question' ? 'From your question' : 'Setup step';
  return `${from}: ${set || 'nothing set'}${e.note ? ` (${e.note})` : ''}`;
}

export interface AgentInput { name: string; type: string; required: boolean; description?: string | null; }
export interface AgentOutput { name: string; type: string; description?: string | null; }

/** Knowledge Source and limits for the built-in Ask Data tool: business rules are added to the tenant defaults; examples replace them (blank = defaults). */
export interface AskDataOptions { businessRules: string | null; examples: string | null; allowedSchemas: string[]; maxRows: number; }

/** Agent types: the AgenticUIFramework's LangGraph `process` values. */
export type AgentType = 'sequential' | 'parallel' | 'supervisor' | 'loop';

export type ToolParamType = 'str' | 'int' | 'float' | 'bool' | 'list' | 'dict';
export interface AgentToolParam { name: string; type: ToolParamType; description?: string | null; required: boolean; }
/** A Tool node: a REST call the model can make (tool { agent: 'api', action: name }). authSecret is write-only:
 *  empty keeps the stored secret; responses never include it (hasAuthSecret). */
export interface AgentCustomTool {
  name: string; description?: string | null; parameters: AgentToolParam[];
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; headers: { name: string; value: string }[];
  body?: string | null; responsePath?: string | null; authScheme: 'none' | 'bearer' | 'basic' | 'api_key';
  authSecret?: string | null; hasAuthSecret?: boolean; timeout: number;
}

/** Evals: a test case (inputs + what a good answer is), and the results of Run all. */
export interface AgentEvalRule { op: 'contains' | 'not_contains' | 'number'; value: string; }
export interface AgentEvalCase { id: number; name: string; inputs: Record<string, string>; expectation: string | null; rules: AgentEvalRule[]; createdBy: string; updatedAt: string; }
export interface AgentEvalResult { caseId: number; name: string; passed: boolean; reasons: string[]; answer: string | null; runId: number | null; seconds: number; }
export interface AgentEvalRun { id: number; versionNo: number | null; draft: boolean; passed: number; total: number; runBy: string; startedAt: string; seconds: number; results: AgentEvalResult[] | null; }
export type AgentEvalEvent =
  | { type: 'case'; data: { caseId: number; name: string; phase: 'start' | 'end' } & Partial<AgentEvalResult> }
  | { type: 'done'; data: { evalRunId: number; passed: number; total: number; versionNo: number | null; draft: boolean; seconds: number } }
  | { type: 'error'; data: { message: string } };

/** A trigger: runs the published agent on a cron (in timeZone) or once, and may mail the answer. */
export interface AgentSchedule {
  id: number; cron: string | null; runOnceAt: string | null; timeZone: string; inputs: Record<string, string>; emailTo: string[];
  isActive: boolean; nextRunAt: string | null; lastRunAt: string | null; lastRunId: number | null; lastStatus: string | null;
  createdBy: string; nextRuns: string[];
}
export interface SaveAgentSchedule {
  cron: string | null; runOnceAt: string | null; timeZone: string; inputs: Record<string, string>; emailTo: string[]; isActive: boolean;
}

/** A fact an agent with Load / Preload Memory keeps between runs. */
export interface AgentMemory { id: number; text: string; runId: number | null; createdAt: string; }

/** One saved version of an agent: every Save as Draft / Publish that changed it. */
export interface AgentVersion { versionNo: number; status: 'draft' | 'published'; createdBy: string; createdAt: string; }

export interface SaveAgentRequest {
  name: string;
  role: string | null;
  description: string | null;
  systemPrompt: string | null;
  goal: string | null;
  steps: AgentStep[];
  tools: AgentTool[];
  inputs: AgentInput[];
  outputs: AgentOutput[];
  status: 'draft' | 'published';
  askData: AskDataOptions | null;
  type: AgentType;
  /** Supervisor rounds / loop repeats at most. */
  maxIterations: number;
  customTools: AgentCustomTool[];
  notes?: AgentNote[];
}

/** One saved test run (core.AiAgentRuns); agentId is null for a test of an agent that was never saved. */
/** LLM calls of one model for an agent or a run, and their tokens. */
export interface AgentModelUsage { model: string; calls: number; promptTokens: number; completionTokens: number; }

/** LLM use on the tenant's provider; null for runs made before usage was tied to agents. */
export interface AgentLlmUsage {
  calls: number; promptTokens: number; completionTokens: number; totalTokens: number; models: AgentModelUsage[];
}

export interface AgentRun {
  id: number; agentId: number | null; agentName: string; runBy: string; status: 'success' | 'failed' | string;
  answer: string | null; error: string | null; seconds: number; startedAt: string;
  inputs: Record<string, string> | null; steps: { step: number; question: string; ok: boolean; error?: string | null }[] | null;
  llm?: AgentLlmUsage | null;
  /** Tokens saved on the run row (core.AiAgentRuns.input_tokens / output_tokens / total_tokens). */
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
}

export interface AgentStats {
  runs: number; successRate: number | null; avgSeconds: number | null; lastRunAt: string | null; llm?: AgentLlmUsage | null;
}

/** A sticky note on the canvas: editor only, never sent to runs or exports. */
export interface AgentNote { id: string; text: string; x: number; y: number; color: 'yellow' | 'blue' | 'green' | 'pink'; }

export interface Agent extends SaveAgentRequest {
  id: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  stats: AgentStats;
  /** core.AiAgents.agent_state: an admin switches an agent off without deleting it; inactive agents cannot run. */
  agentState?: AgentState;
}

export type AgentState = 'active' | 'inactive';

/** A tool the Add Tool dialog offers: a twise agent and its actions. */
export interface AgentToolOption { agent: string; title: string; description: string; capabilities: string[]; ready: boolean; }

/** One step's result in a test run. */
export interface AgentStepResult {
  step: number; attempt?: number; question: string; agent: string; action: string; answer: string;
  sql: string[]; ok: boolean; error: string | null; seconds: number;
  /** Ask Data: sql | clarify | chitchat, the verifier's verdict and the result table; Saved SQL: its rows. */
  route?: string; verified?: boolean; needs_analysis?: boolean;
  /** Signed handle for the Excel / Word download of this step's data (Ask Data, twise export). */
  export_token?: string | null;
  data?: { columns: string[]; rows: unknown[][]; truncated: boolean } | null;
  /** The setup step (runs first; its row set the inputs). */
  setup?: boolean;
}

/** Test Agent stream: step (phase start/end), status, node, then done or error. */
export type AgentRunEvent =
  | { type: 'step'; data: Partial<AgentStepResult> & { step: number; phase: 'start' | 'end' } }
  | { type: 'status'; data: { step?: number; stage: string; seconds?: number } }
  | { type: 'node'; data: { step: number; node: string } }
  | { type: 'decision'; data: { by: 'supervisor' | 'loop' | 'router' | 'exit_loop' | 'approval'; next?: string; task?: string; done?: boolean; reason?: string; round?: number; router?: string; branch?: string; decision?: string; reviewer?: string; step?: number } }
  /** Human Approval: the run is waiting; resume it with the token. */
  | { type: 'approval'; data: { runId: number; token: string; step: number; question: string; draft: string } }
  | { type: 'ping'; data: Record<string, never> }   // keeps the stream open while a step waits
  | { type: 'inputs'; data: { by: 'question' | 'setup'; values: Record<string, string>; note?: string } }
  | { type: 'done'; data: { runId: number; ok: boolean; answer: string; steps: AgentStepResult[]; seconds: number; output?: Record<string, unknown> | null;
      usage?: { model: string; calls: number; input: number; output: number }[]; llm?: AgentLlmUsage | null } }
  | { type: 'error'; data: { message: string; runId?: number } };

/** Agentic AI → AI Agents, against the Tenant API's /api/agents. */
@Injectable({ providedIn: 'root' })
export class AgentsService {
  private readonly api = `${environment.tenantApiUrl}/agents`;   // tenantApiUrl already ends in /api

  constructor(private readonly http: HttpClient, private readonly tokens: TokenService, private readonly zone: NgZone) {}

  list(): Observable<Agent[]> { return this.http.get<Agent[]>(this.api); }
  get(id: number): Observable<Agent> { return this.http.get<Agent>(`${this.api}/${id}`); }
  evals(id: number): Observable<{ cases: AgentEvalCase[]; runs: AgentEvalRun[] }> {
    return this.http.get<{ cases: AgentEvalCase[]; runs: AgentEvalRun[] }>(`${this.api}/${id}/evals`);
  }
  saveEvalCase(id: number, body: { name: string; inputs: Record<string, string>; expectation: string | null; rules: AgentEvalRule[] }, caseId?: number): Observable<AgentEvalCase> {
    return caseId ? this.http.put<AgentEvalCase>(`${this.api}/${id}/evals/cases/${caseId}`, body) : this.http.post<AgentEvalCase>(`${this.api}/${id}/evals/cases`, body);
  }
  deleteEvalCase(id: number, caseId: number): Observable<void> { return this.http.delete<void>(`${this.api}/${id}/evals/cases/${caseId}`); }
  evalRun(id: number, runId: number): Observable<AgentEvalRun> { return this.http.get<AgentEvalRun>(`${this.api}/${id}/evals/runs/${runId}`); }
  /** Run all: each case's result as it finishes, then the score. */
  runEvals(id: number, body: { agent: SaveAgentRequest; draft: boolean }): Observable<AgentEvalEvent> {
    return this.events(`${id}/evals/run`, body) as unknown as Observable<AgentEvalEvent>;
  }
  schedules(id: number): Observable<AgentSchedule[]> { return this.http.get<AgentSchedule[]>(`${this.api}/${id}/schedules`); }
  saveSchedule(id: number, s: SaveAgentSchedule, scheduleId?: number): Observable<AgentSchedule> {
    return scheduleId ? this.http.put<AgentSchedule>(`${this.api}/${id}/schedules/${scheduleId}`, s) : this.http.post<AgentSchedule>(`${this.api}/${id}/schedules`, s);
  }
  deleteSchedule(id: number, scheduleId: number): Observable<void> { return this.http.delete<void>(`${this.api}/${id}/schedules/${scheduleId}`); }
  runScheduleNow(id: number, scheduleId: number): Observable<void> { return this.http.post<void>(`${this.api}/${id}/schedules/${scheduleId}/run`, {}); }
  previewSchedule(s: { cron: string | null; runOnceAt: string | null; timeZone: string }): Observable<{ problem: string | null; next: string[] }> {
    return this.http.post<{ problem: string | null; next: string[] }>(`${this.api}/schedules/preview`, s);
  }
  memories(id: number): Observable<AgentMemory[]> { return this.http.get<AgentMemory[]>(`${this.api}/${id}/memories`); }
  forgetMemory(id: number, memoryId?: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/${id}/memories${memoryId ? '/' + memoryId : ''}`);
  }
  /** The agent's latest runs (for the analyzer's real average). */
  runsOf(id: number, take = 10): Observable<{ status: string; usage: { model: string; calls: number; input: number; output: number }[] | null }[]> {
    return this.http.get<{ status: string; usage: { model: string; calls: number; input: number; output: number }[] | null }[]>(`${this.api}/${id}/runs?take=${take}`);
  }
  versions(id: number): Observable<AgentVersion[]> { return this.http.get<AgentVersion[]>(`${this.api}/${id}/versions`); }
  version(id: number, versionNo: number): Observable<SaveAgentRequest> { return this.http.get<SaveAgentRequest>(`${this.api}/${id}/versions/${versionNo}`); }
  tools(): Observable<{ tools: AgentToolOption[]; message: string | null }> { return this.http.get<{ tools: AgentToolOption[]; message: string | null }>(`${this.api}/tools`); }
  create(req: SaveAgentRequest): Observable<Agent> { return this.http.post<Agent>(this.api, req); }
  update(id: number, req: SaveAgentRequest): Observable<Agent> { return this.http.put<Agent>(`${this.api}/${id}`, req); }
  delete(id: number): Observable<void> { return this.http.delete<void>(`${this.api}/${id}`); }
  /** Admins only: switch an agent on or off. */
  setState(id: number, agentState: AgentState): Observable<Agent> { return this.http.put<Agent>(`${this.api}/${id}/state`, { agentState }); }

  /** The latest test runs of every agent (newest first), for the Activity Log. */
  runs(take = 200): Observable<AgentRun[]> { return this.http.get<AgentRun[]>(`${this.api}/runs`, { params: { take } }); }

  /** The agent on the page (saved or not) as agentflow.json v1, the AgenticUIFramework's format. */
  exportAgentFlow(req: SaveAgentRequest): Observable<unknown> { return this.http.post<unknown>(`${this.api}/agentflow`, req); }
  /** The data behind an Ask Data answer as a file: every row, re-read with the answer's SQL (no model call). */
  exportAskData(req: { token: string; format: 'xlsx' | 'docx'; question: string; answer: string; verified: boolean; askData: AskDataOptions | null }): Observable<HttpResponse<Blob>> {
    return this.http.post(`${this.api}/askdata/export`, req, { observe: 'response', responseType: 'blob' });
  }

  /** One call of a Tool with sample values (no model); agentId fills in the saved secret. */
  tryTool(tool: AgentCustomTool, args: Record<string, unknown>, agentId: number | null): Observable<{ status: number; result: string }> {
    return this.http.post<{ status: number; result: string }>(`${this.api}/tools/try`, { tool, args, agentId });
  }

  /** An agentflow.json v1 as an agent for the page (not saved), plus what could not be used. */
  importAgentFlow(flow: unknown): Observable<{ agent: SaveAgentRequest; warnings: string[] }> {
    return this.http.post<{ agent: SaveAgentRequest; warnings: string[] }>(`${this.api}/agentflow/import`, flow);
  }

  /**
   * Runs the configuration as it is on screen (saved or not) and streams its progress. Uses fetch
   * rather than HttpClient because HttpClient buffers the whole body (same as AiService).
   */
  /** threadId continues a conversation: the agent gets that thread's earlier answers. */
  test(agent: SaveAgentRequest, inputs: Record<string, string>, agentId: number | null, threadId: string | null = null): Observable<AgentRunEvent> {
    return this.events('test', { agent, inputs, agentId, threadId });
  }

  /** Human Approval: continue a waiting run; the rest streams like test. */
  resume(runId: number, token: string, decision: 'approve' | 'edit' | 'reject', text: string): Observable<AgentRunEvent> {
    return this.events(`runs/${runId}/resume`, { token, decision, text });
  }

  /** POSTs to the agents API and reads its server-sent events. */
  private events(path: string, body: unknown): Observable<AgentRunEvent> {
    return new Observable<AgentRunEvent>(subscriber => {
      const controller = new AbortController();
      const run = async () => {
        const res = await fetch(`${this.api}/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.tokens.getAccessToken() ?? ''}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          // Keep the status and the API's reason (e.g. a validation message) like HttpClient errors do.
          const body = await res.json().catch(() => null);
          const message = res.status === 401 ? 'Please sign in again.' : res.status === 403 ? 'You do not have permission to test agents.'
            : `The request failed (HTTP ${res.status}).`;
          throw Object.assign(new Error(message), { status: res.status, error: body ?? { message } });
        }
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
            if (type && data !== undefined) this.zone.run(() => subscriber.next({ type, data: JSON.parse(data) } as AgentRunEvent));
          }
        }
        this.zone.run(() => subscriber.complete());
      };
      run().catch(err => { if (err?.name !== 'AbortError') this.zone.run(() => subscriber.error(err)); });
      return () => controller.abort();
    });
  }
}
