import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { AgentEvalCase, AgentEvalResult, AgentEvalRule, AgentEvalRun, AgentsService, SaveAgentRequest } from '../../agents.service';

/** A case's result while Run all streams: running, or done with its reasons. */
interface LiveResult { caseId: number; name: string; running: boolean; result?: AgentEvalResult; }

/**
 * The Test panel's Evals tab: an agent's test cases (inputs + what a good answer is), Run all on the page's draft,
 * and the score history per version.
 */
@Component({
  selector: 'app-agent-evals',
  templateUrl: './agent-evals.component.html',
  styleUrls: ['./agent-evals.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class AgentEvalsComponent implements OnChanges, OnDestroy {
  @Input() agentId: number | null = null;
  /** The agent's input names (each case gives them values). */
  @Input() inputNames: string[] = [];
  /** The page's agent and whether it has unsaved changes. */
  @Input() current!: () => { agent: SaveAgentRequest; dirty: boolean };

  readonly ruleOps = [{ value: 'contains', label: 'contains' }, { value: 'not_contains', label: 'does not contain' }, { value: 'number', label: 'gives the number' }];
  cases: AgentEvalCase[] = [];
  runs: AgentEvalRun[] = [];
  loaded = false;
  error = '';
  /** The case being added (id null) or edited. */
  form: { id: number | null; name: string; inputs: Record<string, string>; expectation: string; rules: AgentEvalRule[] } | null = null;
  live: LiveResult[] = [];
  running = false;
  score: { passed: number; total: number } | null = null;
  /** A past eval run opened from the history. */
  opened: AgentEvalRun | null = null;
  private sub?: Subscription;

  constructor(private agents: AgentsService, private cdr: ChangeDetectorRef) {}

  ngOnChanges(): void { this.load(); }
  ngOnDestroy(): void { this.sub?.unsubscribe(); }

  private load(): void {
    if (!this.agentId) return;
    this.agents.evals(this.agentId).subscribe({
      next: e => { this.cases = e.cases; this.runs = e.runs; this.loaded = true; this.cdr.markForCheck(); },
      error: () => { this.error = 'Could not load the test cases. Restart the Tenant API if it was just updated.'; this.cdr.markForCheck(); },
    });
  }

  newCase(): void {
    this.form = { id: null, name: '', inputs: Object.fromEntries(this.inputNames.map(n => [n, ''])), expectation: '', rules: [] };
    this.error = '';
  }

  editCase(c: AgentEvalCase): void {
    this.form = { id: c.id, name: c.name, inputs: { ...Object.fromEntries(this.inputNames.map(n => [n, ''])), ...c.inputs },
      expectation: c.expectation ?? '', rules: c.rules.map(r => ({ ...r })) };
    this.error = '';
  }

  saveCase(): void {
    const f = this.form;
    if (!f || !this.agentId) return;
    const body = { name: f.name.trim(), inputs: f.inputs, expectation: f.expectation.trim() || null,
      rules: f.rules.filter(r => r.value.trim()).map(r => ({ op: r.op, value: r.value.trim() })) };
    this.agents.saveEvalCase(this.agentId, body, f.id ?? undefined).subscribe({
      next: () => { this.form = null; this.load(); },
      error: err => { this.error = this.reason(err, 'The test case could not be saved.'); this.cdr.markForCheck(); },
    });
  }

  deleteCase(c: AgentEvalCase): void {
    if (!this.agentId || !confirm(`Delete the test case "${c.name}"?`)) return;
    this.agents.deleteEvalCase(this.agentId, c.id).subscribe({ next: () => this.load() });
  }

  /** Runs every case on the page's agent as it is now (saved or not). */
  runAll(): void {
    if (!this.agentId || !this.cases.length) return;
    const { agent, dirty } = this.current();
    this.sub?.unsubscribe();
    Object.assign(this, { running: true, score: null, opened: null, error: '', live: this.cases.map(c => ({ caseId: c.id, name: c.name, running: false })) });
    this.sub = this.agents.runEvals(this.agentId, { agent, draft: dirty }).subscribe({
      next: ev => {
        if (ev.type === 'case') {
          const row = this.live.find(l => l.caseId === ev.data.caseId);
          if (row) { row.running = ev.data.phase === 'start'; if (ev.data.phase === 'end') row.result = ev.data as AgentEvalResult; }
        } else if (ev.type === 'done') {
          this.score = { passed: ev.data.passed, total: ev.data.total };
          this.load();
        } else if (ev.type === 'error') this.error = ev.data.message;
        this.cdr.markForCheck();
      },
      error: err => { this.running = false; this.error = err?.message ?? 'Run all stopped.'; this.cdr.markForCheck(); },
      complete: () => { this.running = false; this.cdr.markForCheck(); },
    });
  }

  openRun(r: AgentEvalRun): void {
    if (!this.agentId) return;
    this.agents.evalRun(this.agentId, r.id).subscribe(full => { this.opened = full; this.live = []; this.score = null; this.cdr.markForCheck(); });
  }

  inputsText(c: AgentEvalCase): string { return Object.entries(c.inputs).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'No inputs'; }
  version(r: AgentEvalRun): string { return (r.versionNo ? `v${r.versionNo}` : 'Unsaved') + (r.draft ? ' + unsaved changes' : ''); }
  utc(t: string): string { return /Z|[+-]\d\d:\d\d$/.test(t) ? t : t + 'Z'; }

  private reason(err: any, fallback: string): string {
    const e = err?.error;
    return e?.errors ? Object.values(e.errors as Record<string, string[]>).flat().join(' ') : e?.message ?? fallback;
  }
}
