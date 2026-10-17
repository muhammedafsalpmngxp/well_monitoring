import { ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { Subscription } from 'rxjs';
import { Agent, AgentLlmUsage, AgentsService, AgentStepResult, SaveAgentRequest } from '../agents.service';
import { callsText, inputTokensText, modelNames, outputTokensText, totalTokensText, usageTitle } from '../llm-usage.util';
import { markdownToHtml } from '../../../core/utils/markdown.util';

/**
 * Runs a saved agent from the AI Agents list: asks for the agent's inputs, streams the run (stage, steps,
 * time) and shows the answer formatted. The run is recorded like a Test run, so it counts in the card's stats.
 */
@Component({
  selector: 'app-run-agent-dialog',
  standalone: false,
  templateUrl: './run-agent-dialog.component.html',
  styleUrls: ['./run-agent-dialog.component.scss'],
})
export class RunAgentDialogComponent implements OnInit, OnDestroy {
  @Input({ required: true }) agent!: Agent;
  /** Emits true when a run finished, so the list can refresh its stats. */
  @Output() closed = new EventEmitter<boolean>();

  values: Record<string, string> = {};
  running = false;
  stage = '';
  steps: (Partial<AgentStepResult> & { step: number; phase: 'start' | 'end' })[] = [];
  answer = '';
  answerHtml = '';
  error = '';
  seconds: number | null = null;
  /** The run's LLM use on the tenant's provider; undefined until the run ends. */
  llm: AgentLlmUsage | null | undefined;
  elapsed = 0;
  private ran = false;
  private sub?: Subscription;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private agents: AgentsService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    for (const i of this.agent.inputs) this.values[i.name] = '';
  }

  ngOnDestroy(): void { this.stop(); }

  get missing(): string[] {
    return this.agent.inputs.filter(i => i.required && !(this.values[i.name] ?? '').trim()).map(i => i.name);
  }

  get doneSteps(): number { return this.steps.filter(s => s.phase === 'end').length; }

  run(): void {
    if (this.running) return;
    if (this.missing.length) { this.error = `Enter ${this.missing.join(', ')}.`; return; }
    this.sub?.unsubscribe();
    Object.assign(this, { running: true, stage: 'Starting', steps: [], answer: '', answerHtml: '', error: '', seconds: null, llm: undefined });
    this.startTimer();
    const values: Record<string, string> = {};
    for (const i of this.agent.inputs) values[i.name] = (this.values[i.name] ?? '').trim();
    let ended = false;
    this.sub = this.agents.test(this.request(), values, this.agent.id).subscribe({
      next: ev => {
        if (ev.type === 'status') this.stage = ev.data.stage;
        else if (ev.type === 'decision') {
          this.stage = ev.data.by === 'router' ? `${ev.data.router}: ${ev.data.branch}`
            : ev.data.by === 'supervisor' ? (ev.data.next === 'answer' ? 'Writing the answer' : `Supervisor → ${ev.data.next}`)
            : `Round ${ev.data.round}: ${ev.data.done ? 'goal met' : 'repeating'}`;
        } else if (ev.type === 'step') {
          const at = this.steps.findIndex(s => s.step === ev.data.step && (s.attempt ?? 1) === (ev.data.attempt ?? 1));
          if (at >= 0) this.steps[at] = { ...this.steps[at], ...ev.data }; else this.steps.push(ev.data);
          if (ev.data.phase === 'start') this.stage = `Step ${ev.data.step}: ${ev.data.question}`;
        } else if (ev.type === 'done') {
          ended = true;
          this.ran = true;
          this.answer = ev.data.answer;
          this.answerHtml = markdownToHtml(ev.data.answer);
          this.seconds = ev.data.seconds;
          this.llm = ev.data.llm ?? null;
          if (!ev.data.ok) this.error = 'The agent could not answer fully. See the steps below.';
        } else if (ev.type === 'error') { ended = true; this.ran = true; this.error = ev.data.message; }
        this.cdr.markForCheck();
      },
      error: err => {
        this.finish();
        const e = err?.error;
        this.error = err?.status === 403 ? 'You do not have permission to run agents.'
          : err?.status >= 400 && err?.status < 500
          ? (e?.errors ? Object.values(e.errors as Record<string, string[]>).flat().join(' ') : e?.message || e?.detail || e?.title || 'The run could not start.')
          : `The connection to the agent service was lost after ${this.elapsed}s (${err?.message ?? 'no reason given'}). Try again.`;
        this.cdr.markForCheck();
      },
      complete: () => {
        this.finish();
        if (!ended) this.error = 'The agent service ended the run without an answer. Check that the agent runtime is running, then try again.';
        this.cdr.markForCheck();
      },
    });
  }

  /** Stops the run (closing the stream aborts the request). */
  cancel(): void {
    if (!this.running) return;
    this.stop();
    this.error = 'Run stopped.';
  }

  close(): void {
    this.stop();
    this.closed.emit(this.ran);
  }

  get llmModel(): string { return modelNames(this.llm); }
  get llmCalls(): string { return callsText(this.llm); }
  get llmInput(): string { return inputTokensText(this.llm); }
  get llmOutput(): string { return outputTokensText(this.llm); }
  get llmTotal(): string { return totalTokensText(this.llm); }
  get llmTitle(): string { return usageTitle(this.llm); }

  copy(): void { navigator.clipboard?.writeText(this.answer).catch(() => { /* not allowed: nothing to do */ }); }

  private request(): SaveAgentRequest {
    const a = this.agent;
    return { name: a.name, role: a.role, description: a.description, systemPrompt: a.systemPrompt, goal: a.goal, steps: a.steps,
      tools: a.tools, inputs: a.inputs, outputs: a.outputs, status: a.status, askData: a.askData, type: a.type, maxIterations: a.maxIterations };
  }

  private stop(): void {
    this.sub?.unsubscribe();
    this.sub = undefined;
    this.finish();
  }

  private finish(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.running = false;
    this.stage = '';
  }

  private startTimer(): void {
    const started = Date.now();
    this.elapsed = 0;
    this.timer = setInterval(() => { this.elapsed = Math.round((Date.now() - started) / 1000); this.cdr.markForCheck(); }, 1000);
  }
}
