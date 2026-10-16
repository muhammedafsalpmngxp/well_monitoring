import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Agent, AgentsService } from '../agents.service';

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

  ngOnInit(): void {
    this.agentsApi.list().subscribe({
      next: list => {
        this.agents = list.map((a, i) => this.toCard(a, i));
        this.kpis = this.kpisFor(list);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: err => {
        this.loading = false;
        this.error = err?.status === 403 ? 'You do not have permission to view agents.' : 'Could not load the agents.';
        this.cdr.markForCheck();
      },
      complete: () => { this.loading = false; this.cdr.markForCheck(); },
    });
  }

  private toCard(a: Agent, i: number): AgentCard {
    return {
      id: a.id,
      name: a.name,
      role: a.role ?? '',
      status: a.status === 'published' ? 'Published' : 'Draft',
      description: a.description || a.goal || a.steps.map(s => s.text).join(' · '),
      ...AiAgentsComponent.ICONS[i % AiAgentsComponent.ICONS.length],
      capabilities: a.tools.map(t => `${t.agent.replace(/_/g, ' ')} · ${t.action}`),
      runs: a.stats.runs,
      successRate: a.stats.successRate === null ? '—' : `${a.stats.successRate}%`,
      avgTime: a.stats.avgSeconds === null ? '—' : `${a.stats.avgSeconds}s`,
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
