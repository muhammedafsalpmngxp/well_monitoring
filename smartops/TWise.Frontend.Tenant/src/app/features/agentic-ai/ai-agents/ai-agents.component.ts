import { ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Agent, AgentsService } from '../agents.service';
import { modelsLine, usageLine, usageTitle } from '../llm-usage.util';

export interface AgentCard {
  id: number;
  name: string;
  role: string;
  status: 'Published' | 'Draft';
  description: string;
  iconBg: string;
  iconType: 'database' | 'chart' | 'mail';
  capabilities: string[];
  runs: number;
  successRate: string;
  avgTime: string;
  /** LLM use on the tenant's provider: "5 calls · 3.2k tokens", the models, and the full numbers. */
  llmUsage: string;
  llmModels: string;
  llmTitle: string;
}

@Component({
  selector: 'app-ai-agents',
  standalone: false,
  templateUrl: './ai-agents.component.html',
  styleUrls: ['./ai-agents.component.scss'],
})
export class AiAgentsComponent implements OnInit {

  constructor(private router: Router, private agentsApi: AgentsService, private cdr: ChangeDetectorRef) {}

  loading = true;
  error = '';

  createNewAgent(): void {
    this.router.navigate(['/agentic-ai/ai-agents/new']);
  }

  openAgent(agent: AgentCard): void {
    this.router.navigate(['/agentic-ai/ai-agents', agent.id]);
  }

  /** The agent open in the Run dialog. */
  running: Agent | null = null;

  runAgent(agent: AgentCard): void {
    this.menuFor = null;
    this.running = this.saved.find(a => a.id === agent.id) ?? null;
  }

  /** After a run the card's runs / success / time changed: reload them. */
  runClosed(ran: boolean): void {
    this.running = null;
    if (ran) this.agentsApi.list().subscribe({ next: list => { this.saved = list; this.render(); }, error: () => { /* keep the old stats */ } });
    this.cdr.markForCheck();
  }

  /** The card whose ⋮ menu is open, and the agent being deleted. */
  menuFor: number | null = null;
  deleting: number | null = null;

  toggleMenu(agent: AgentCard, e: Event): void { e.stopPropagation(); this.menuFor = this.menuFor === agent.id ? null : agent.id; }

  @HostListener('document:click')
  closeMenu(): void { this.menuFor = null; }

  /** The agent the delete dialog asks about, and why its delete failed (shown in the dialog). */
  confirmDelete: AgentCard | null = null;
  deleteError: string | null = null;

  /** Asks first, in the app's confirmation dialog. */
  deleteAgent(agent: AgentCard): void {
    this.menuFor = null;
    this.deleteError = null;
    this.confirmDelete = agent;
  }

  get deleteMessage(): string {
    const name = (this.confirmDelete?.name ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `Delete <strong>${name}</strong>? This cannot be undone. Its test runs stay in the Activity Log.`;
  }

  cancelDelete(): void { if (this.deleting === null) { this.confirmDelete = null; this.deleteError = null; } }

  /** Deletes the agent (its run history stays, for the Activity Log). */
  doDelete(): void {
    const agent = this.confirmDelete;
    if (!agent || this.deleting !== null) return;
    this.error = '';   // a message from an earlier failed delete hid the list's empty state for good
    this.deleteError = null;
    this.deleting = agent.id;
    this.agentsApi.delete(agent.id).subscribe({
      next: () => {
        this.deleting = null;
        this.confirmDelete = null;
        this.saved = this.saved.filter(a => a.id !== agent.id);
        this.render();
      },
      error: err => {
        this.deleting = null;
        // Already gone (deleted elsewhere): drop the card, nothing to retry.
        if (err?.status === 404) {
          this.confirmDelete = null;
          this.saved = this.saved.filter(a => a.id !== agent.id);
          this.render();
          return;
        }
        this.deleteError = err?.status === 403 ? 'You do not have permission to delete agents.' : `Could not delete "${agent.name}". Try again.`;
        this.cdr.markForCheck();
      },
    });
  }

  kpis = this.kpisFor([]);

  sourceOptions = ['All', 'Published', 'Draft'];
  activeSource = 'All';
  searchTerm = '';

  agents: AgentCard[] = [];

  private static readonly ICONS: { iconBg: string; iconType: AgentCard['iconType'] }[] = [
    { iconBg: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)', iconType: 'database' },
    { iconBg: 'linear-gradient(135deg, #22C7F2 0%, #2563EB 100%)', iconType: 'chart' },
    { iconBg: 'linear-gradient(135deg, #22C55E 0%, #059669 100%)', iconType: 'mail' },
  ];

  /** The saved agents as loaded, and each tool key's display name from the agent service. */
  private saved: Agent[] = [];
  private toolTitles = new Map<string, string>();

  ngOnInit(): void {
    this.agentsApi.tools().subscribe({
      next: r => { this.toolTitles = new Map(r.tools.map(t => [t.agent, t.title])); this.render(); },
      error: () => { /* raw tool keys are shown */ },
    });
    this.agentsApi.list().subscribe({
      next: list => {
        this.saved = list;
        this.loading = false;
        this.render();
      },
      error: err => {
        this.loading = false;
        this.error = err?.status === 403 ? 'You do not have permission to view agents.' : 'Could not load the agents.';
        this.cdr.markForCheck();
      },
      complete: () => { this.loading = false; this.cdr.markForCheck(); },
    });
  }

  private render(): void {
    this.agents = this.saved.map(a => this.toCard(a));
    this.kpis = this.kpisFor(this.saved);
    this.cdr.markForCheck();
  }

  private toCard(a: Agent): AgentCard {
    return {
      id: a.id,
      name: a.name,
      role: a.role ?? '',
      status: a.status === 'published' ? 'Published' : 'Draft',
      description: a.description || a.goal || a.steps.map(s => s.text).join(' · '),
      // By id, not list position: the list is sorted by last update, so the icon changed after every save.
      ...AiAgentsComponent.ICONS[a.id % AiAgentsComponent.ICONS.length],
      capabilities: a.tools.map(t => `${this.toolTitles.get(t.agent) ?? t.agent.replace(/_/g, ' ')} · ${t.action}`),
      runs: a.stats.runs,
      successRate: a.stats.successRate === null ? '—' : `${a.stats.successRate}%`,
      avgTime: a.stats.avgSeconds === null ? '—' : `${a.stats.avgSeconds}s`,
      llmUsage: usageLine(a.stats.llm),
      llmModels: modelsLine(a.stats.llm),
      llmTitle: usageTitle(a.stats.llm),
    };
  }

  /** The four tiles from the saved agents and their test runs. */
  private kpisFor(list: Agent[]) {
    const published = list.filter(a => a.status === 'published');
    const runs = list.reduce((n, a) => n + a.stats.runs, 0);
    const withRuns = published.filter(a => a.stats.runs > 0);
    const weighted = (pick: (a: Agent) => number | null) => {
      const n = withRuns.reduce((t, a) => t + a.stats.runs, 0);
      return n ? withRuns.reduce((t, a) => t + (pick(a) ?? 0) * a.stats.runs, 0) / n : null;
    };
    const rate = weighted(a => a.stats.successRate);
    const avg = weighted(a => a.stats.avgSeconds);
    return [
      { label: 'Active Agents', value: String(published.length), desc: `Out of ${list.length} total`, iconBg: '#EEF8EE', iconColor: '#66BB6A', iconType: 'bot' },
      { label: 'Total Invocations', value: String(runs), desc: 'Test runs across all agents', iconBg: '#EAF4FF', iconColor: '#2563EB', iconType: 'pulse' },
      { label: 'AVG Success Rate', value: rate === null ? '—' : `${rate.toFixed(1)}%`, desc: 'Across all published agents', iconBg: '#EAF6FF', iconColor: '#29B6F6', iconType: 'trend' },
      { label: 'AVG Run Time', value: avg === null ? '—' : `${avg.toFixed(1)}s`, desc: 'Per run, published agents', iconBg: '#FFF4E8', iconColor: '#FFA726', iconType: 'cost' },
    ];
  }

  get filteredAgents(): AgentCard[] {
    return this.agents.filter(a => {
      const matchSource = this.activeSource === 'All' || a.status === this.activeSource;
      const matchSearch = !this.searchTerm || a.name.toLowerCase().includes(this.searchTerm.toLowerCase());
      return matchSource && matchSearch;
    });
  }
}
