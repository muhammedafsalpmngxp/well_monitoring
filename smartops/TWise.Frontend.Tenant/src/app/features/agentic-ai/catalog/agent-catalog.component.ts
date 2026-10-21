import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Agent, AgentsService, AgentStep, SaveAgentRequest } from '../agents.service';
import { AGENT_TEMPLATES, AgentTemplate, Pattern, PATTERNS } from './agent-templates';

const TOOL_LABEL: Record<string, string> = {
  ask_data: 'Ask Data', ask_ai: 'Ask AI', url_context: 'URL Context', load_memory: 'Load Memory',
  preload_memory: 'Preload Memory', exit_loop: 'Exit Loop', api: 'REST Tool', subagent: 'Sub-agent', approval: 'Human Approval', evaluator: 'Evaluator', guardrail: 'Guardrail', compute: 'Compute', merge: 'Merge',
};
const TYPE_LABEL: Record<string, string> = { sequential: 'Sequential', parallel: 'Parallel', supervisor: 'Supervisor', loop: 'Loop' };

/** Agentic AI → Agent Catalog: ready-made agents (templates) and the tenant's published agents; a choice opens the editor. */
@Component({
  selector: 'app-agent-catalog',
  templateUrl: './agent-catalog.component.html',
  styleUrls: ['./agent-catalog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class AgentCatalogComponent implements OnInit {
  readonly patterns = PATTERNS;
  tab: 'templates' | 'ours' = 'templates';
  search = '';
  pattern: Pattern | null = null;
  ours: Agent[] | null = null;
  oursError = '';

  constructor(private router: Router, private agents: AgentsService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.agents.list().subscribe({
      next: a => { this.ours = a.filter(x => x.status === 'published'); this.cdr.markForCheck(); },
      error: () => { this.oursError = 'Could not load the agents.'; this.cdr.markForCheck(); },
    });
  }

  private matches(text: string): boolean {
    const q = this.search.trim().toLowerCase();
    return !q || text.toLowerCase().includes(q);
  }

  get templates(): AgentTemplate[] {
    return AGENT_TEMPLATES.filter(t => (!this.pattern || t.patterns.includes(this.pattern))
      && this.matches(`${t.name} ${t.summary} ${t.patterns.join(' ')}`));
  }

  get ourAgents(): Agent[] {
    return (this.ours ?? []).filter(a => this.matches(`${a.name} ${a.description ?? ''} ${a.role ?? ''}`));
  }

  count(p: Pattern): number { return AGENT_TEMPLATES.filter(t => t.patterns.includes(p)).length; }

  /** The steps as the card's small diagram (routers as ◇). */
  flow(a: SaveAgentRequest): { label: string; router: boolean }[] {
    return a.steps.slice(0, 5).map((s: AgentStep) => ({ router: s.kind === 'router', label: s.kind === 'router' ? 'Route'
      : TOOL_LABEL[(s.tool ?? a.tools[0])?.agent ?? ''] ?? (s.tool ?? a.tools[0])?.agent ?? '?' }));
  }

  /** Between steps: in order (→), at once (+), or workers a supervisor picks from (·). */
  joiner(a: SaveAgentRequest): string { return a.type === 'parallel' ? '+' : a.type === 'supervisor' ? '·' : '→'; }
  typeLabel(t: string): string { return TYPE_LABEL[t] ?? t; }

  tools(a: SaveAgentRequest): string[] {
    return [...new Set([...a.tools.map(t => TOOL_LABEL[t.agent] ?? t.agent), ...(a.customTools.length ? ['REST Tool'] : [])])];
  }

  useTemplate(t: AgentTemplate): void {
    if (t.comingSoon) return;
    this.router.navigate(['/agentic-ai/ai-agents/new'], { queryParams: { template: t.id } });
  }

  open(a: Agent): void { this.router.navigate(['/agentic-ai/ai-agents', a.id]); }

  duplicate(a: Agent): void { this.router.navigate(['/agentic-ai/ai-agents/new'], { queryParams: { duplicate: a.id } }); }
}

/** A saved agent as a new draft: same configuration, new name, no tool secrets. */
export function duplicateOf(a: Agent): SaveAgentRequest {
  const { id, createdBy, createdAt, updatedAt, stats, ...req } = structuredClone(a);
  return { ...req, name: `${a.name} (copy)`, status: 'draft',
    customTools: req.customTools.map(t => ({ ...t, authSecret: null, hasAuthSecret: false })) };
}
