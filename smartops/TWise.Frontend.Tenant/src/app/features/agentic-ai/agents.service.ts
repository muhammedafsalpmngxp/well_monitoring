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
/** kind 'router' picks one branch (routeBy rules or ai); next = the step to run after this one (null = the following). */
export interface AgentStep {
  text: string; tool?: AgentTool | null; id?: string | null; x?: number | null; y?: number | null;
  kind?: 'step' | 'router'; routeBy?: 'rules' | 'ai'; branches?: AgentBranch[] | null; next?: string | null;
}
export interface AgentInput { name: string; type: string; required: boolean; description?: string | null; }
export interface AgentOutput { name: string; type: string; description?: string | null; }

/** Knowledge Source and limits for the built-in Ask Data tool; blank knowledge uses the Al Tasnim defaults. */
export interface AskDataOptions { businessRules: string | null; examples: string | null; allowedSchemas: string[]; maxRows: number; }

/** Agent types: the AgenticUIFramework's LangGraph `process` values. */
export type AgentType = 'sequential' | 'parallel' | 'supervisor' | 'loop';

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
}

export interface AgentStats { runs: number; successRate: number | null; avgSeconds: number | null; lastRunAt: string | null; }

export interface Agent extends SaveAgentRequest {
  id: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  stats: AgentStats;
}

/** A tool the Add Tool dialog offers: a twise agent and its actions. */
export interface AgentToolOption { agent: string; title: string; description: string; capabilities: string[]; ready: boolean; }

/** One step's result in a test run. */
export interface AgentStepResult {
  step: number; attempt?: number; question: string; agent: string; action: string; answer: string;
  sql: string[]; ok: boolean; error: string | null; seconds: number;
  /** Ask Data only: sql | clarify | chitchat, the verifier's verdict and the result table. */
  route?: string; verified?: boolean; needs_analysis?: boolean;
  /** Signed handle for the Excel / Word download of this step's data (Ask Data, twise export). */
  export_token?: string | null;
  data?: { columns: string[]; rows: unknown[][]; truncated: boolean } | null;
}

/** Test Agent stream: step (phase start/end), status, node, then done or error. */
export type AgentRunEvent =
  | { type: 'step'; data: Partial<AgentStepResult> & { step: number; phase: 'start' | 'end' } }
  | { type: 'status'; data: { step?: number; stage: string; seconds?: number } }
  | { type: 'node'; data: { step: number; node: string } }
  | { type: 'decision'; data: { by: 'supervisor' | 'loop' | 'router'; next?: string; task?: string; done?: boolean; reason?: string; round?: number; router?: string; branch?: string } }
  | { type: 'ping'; data: Record<string, never> }   // keeps the stream open while a step waits
  | { type: 'done'; data: { runId: number; ok: boolean; answer: string; steps: AgentStepResult[]; seconds: number } }
  | { type: 'error'; data: { message: string; runId?: number } };

/** Agentic AI → AI Agents, against the Tenant API's /api/agents. */
@Injectable({ providedIn: 'root' })
export class AgentsService {
  private readonly api = `${environment.tenantApiUrl}/agents`;   // tenantApiUrl already ends in /api

  constructor(private readonly http: HttpClient, private readonly tokens: TokenService, private readonly zone: NgZone) {}

  list(): Observable<Agent[]> { return this.http.get<Agent[]>(this.api); }
  get(id: number): Observable<Agent> { return this.http.get<Agent>(`${this.api}/${id}`); }
  tools(): Observable<{ tools: AgentToolOption[]; message: string | null }> { return this.http.get<{ tools: AgentToolOption[]; message: string | null }>(`${this.api}/tools`); }
  create(req: SaveAgentRequest): Observable<Agent> { return this.http.post<Agent>(this.api, req); }
  update(id: number, req: SaveAgentRequest): Observable<Agent> { return this.http.put<Agent>(`${this.api}/${id}`, req); }
  delete(id: number): Observable<void> { return this.http.delete<void>(`${this.api}/${id}`); }

  /** The agent on the page (saved or not) as agentflow.json v1, the AgenticUIFramework's format. */
  exportAgentFlow(req: SaveAgentRequest): Observable<unknown> { return this.http.post<unknown>(`${this.api}/agentflow`, req); }
  /** The data behind an Ask Data answer as a file: every row, re-read with the answer's SQL (no model call). */
  exportAskData(req: { token: string; format: 'xlsx' | 'docx'; question: string; answer: string; verified: boolean; askData: AskDataOptions | null }): Observable<HttpResponse<Blob>> {
    return this.http.post(`${this.api}/askdata/export`, req, { observe: 'response', responseType: 'blob' });
  }
  /** An agentflow.json v1 as an agent for the page (not saved), plus what could not be used. */
  importAgentFlow(flow: unknown): Observable<{ agent: SaveAgentRequest; warnings: string[] }> {
    return this.http.post<{ agent: SaveAgentRequest; warnings: string[] }>(`${this.api}/agentflow/import`, flow);
  }

  /**
   * Runs the configuration as it is on screen (saved or not) and streams its progress. Uses fetch
   * rather than HttpClient because HttpClient buffers the whole body (same as AiService).
   */
  test(agent: SaveAgentRequest, inputs: Record<string, string>, agentId: number | null): Observable<AgentRunEvent> {
    return new Observable<AgentRunEvent>(subscriber => {
      const controller = new AbortController();
      const run = async () => {
        const res = await fetch(`${this.api}/test`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.tokens.getAccessToken() ?? ''}` },
          body: JSON.stringify({ agent, inputs, agentId }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(res.status === 401 ? 'Please sign in again.' : res.status === 403 ? 'You do not have permission to test agents.' : `The request failed (HTTP ${res.status}).`);
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
