import { Location } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { templateAgent } from '../catalog/agent-templates';
import { EditHistory } from './agent-canvas/canvas-clipboard';
import { AiService } from '../../../core/services/ai.service';
import { costOfUsage, ModelUsage, PriceCatalog } from '../analyzer/agent-analyzer';
import { duplicateOf } from '../catalog/agent-catalog.component';
import { Agent, AgentBranch, AgentRunEvent, AgentSchedule, AgentCustomTool, AgentNote, AgentsService, AgentTool, AgentVersion, AgentStepResult, AgentToolOption, AgentType,
  QUESTION_INPUT, SaveAgentRequest, SQL_QUERY_TOOL, StepKind, understoodText } from '../agents.service';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { circleAt, neverReached, stepsToSave } from '../agent-steps.util';
import { usageLine, usageTitle } from '../llm-usage.util';
import { markdownToHtml } from '../../../core/utils/markdown.util';

export interface InstructionItem {
  value: string;
  /** Instructions only: stable id and canvas position, saved with the step. */
  id?: string;
  x?: number;
  y?: number;
  /** A router picks one of its branches; next = the step to run after this one (null = the following).
   *  'setup' (step 1, Saved SQL) runs first and its first row sets the inputs. */
  kind?: StepKind;
  routeBy?: 'rules' | 'ai';
  branches?: AgentBranch[];
  next?: string | null;
  /** The step's own tool; null = the agent's first tool. */
  tool?: AgentTool | null;
  /** Saved SQL steps: the SELECT they run. */
  sql?: string | null;
  expectedOutput?: string | null; outputKey?: string | null; model?: string | null; temperature?: number | null; maxTokens?: number | null;
  forEach?: string | null; retries?: number | null; options?: Record<string, unknown> | null;
}

const newStepId = () => 'st-' + Math.random().toString(36).slice(2, 10);

export interface IORow {
  name: string;
  type: string;
  requirement: string;
  description: string;
}

export interface AvailableToolAction {
  id: string;
  method: string;
  name: string;
  path: string;
}

export interface AvailableConnection {
  id: string;
  name: string;
  subtitle: string;
  type: string;
  status: string;
  expanded: boolean;
  actions: AvailableToolAction[];
}

export interface SelectedAction {
  connectionId: string;
  connectionName: string;
  connectionType: string;
  connectionStatus: string;
  actionId: string;
  method: string;
  name: string;
  path: string;
}

export interface AgentToolGroup {
  connectionId: string;
  connectionName: string;
  connectionType: string;
  connectionStatus: string;
  actions: AgentToolAction[];
}

export interface AgentToolAction {
  id: string;
  method: string;
  name: string;
  path: string;
}

const BUILT_IN_TOOLS = ['ask_data', 'ask_ai', 'url_context', 'load_memory', 'preload_memory', 'exit_loop', 'approval', 'evaluator', 'guardrail', 'compute', 'merge'];

@Component({
  selector: 'app-new-agent',
  standalone: false,
  templateUrl: './new-agent.component.html',
  styleUrls: ['./new-agent.component.scss'],
})
export class NewAgentComponent implements OnInit, OnDestroy {

  /** Set once the agent is saved (or when editing /ai-agents/:id). */
  agentId: number | null = null;
  status: 'draft' | 'published' = 'draft';
  saving = false;
  message = '';
  messageKind: 'ok' | 'bad' = 'ok';
  toolsMessage = '';

  agentName = 'My AI Agent';
  editingName = false;
  tempName = '';

  activeSection = 'section-role';

  navSections = [
    { label: 'Identity & Role',      iconType: 'identity',  anchor: 'section-role' },
    { label: 'Goal & Instructions',  iconType: 'goal',      anchor: 'section-goal' },
    { label: 'Tools & Capabilities', iconType: 'tools',     anchor: 'section-tools' },
    { label: 'Inputs & Outputs',     iconType: 'inputs',    anchor: 'section-io' },
    { label: 'Knowledge Source',     iconType: 'knowledge', anchor: 'section-knowledge' },
    { label: 'Triggers',             iconType: 'triggers',  anchor: 'section-triggers' },
  ];

  // Section 1
  rolePersona = '';
  roleDescription = '';
  systemPrompt = '';

  // Section 2
  primaryGoal = '';
  goalInstructions: InstructionItem[] = [{ id: newStepId(), value: '' }];

  /** Form and Canvas edit the same agent; the canvas gets a snapshot of tools and inputs when it opens. */
  view: 'form' | 'canvas' | 'json' = 'form';
  /** Test Agent panel folded to a strip (its state and results are kept). */
  testCollapsed = false;

  /** Agent type: the AgenticUIFramework's LangGraph process. */
  agentType: AgentType = 'sequential';
  maxIterations = 5;
  readonly agentTypes: { value: AgentType; label: string; hint: string }[] = [
    { value: 'sequential', label: 'Sequential', hint: 'Runs the instructions one after another.' },
    { value: 'parallel', label: 'Parallel', hint: 'Runs every instruction at once, then combines the answers.' },
    { value: 'supervisor', label: 'Supervisor', hint: 'A supervisor picks which instruction to run next until the goal is answered; each instruction runs as written.' },
    { value: 'loop', label: 'Loop', hint: 'Repeats the instructions until the goal is met.' },
  ];
  get agentTypeHint(): string { return this.agentTypes.find(t => t.value === this.agentType)?.hint ?? ''; }

  // JSON view: the agent as agentflow.json v1 (AgenticUIFramework format)
  jsonText = '';
  jsonError = '';
  importWarnings: string[] = [];
  canvasTools: { id: string; label: string }[] = [];
  /** The agent's Tool nodes (REST calls), edited on the canvas. */
  customTools: AgentCustomTool[] = [];
  /** Canvas sticky notes. */
  notes: AgentNote[] = [];
  /** Every tool the agent could use, for the canvas palette's Tools group. */
  paletteTools: { id: string; label: string }[] = [];
  canvasInputs: string[] = [];

  // Section 3 – Tools
  agentToolGroups: AgentToolGroup[] = [];
  showAddToolModal = false;
  addToolTab: 'external' | 'agent' = 'external';
  addToolSearch = '';
  selectedActions: SelectedAction[] = [];

  /** Tools from the agent service: one "connection" per agent, one action per capability. */
  availableConnections: AvailableConnection[] = [];

  // Section 4
  typeOptions = ['String', 'Number', 'Boolean', 'Array', 'Object'];
  requirementOptions = ['Required', 'Optional'];
  inputs: IORow[] = [{ name: '', type: 'String', requirement: 'Required', description: '' }];
  outputs: IORow[] = [{ name: '', type: 'String', requirement: '', description: '' }];

  // Section 5: Knowledge Source for the Ask Data tool (blank = the workspace's default knowledge)
  askBusinessRules = '';
  askExamples = '';
  askSchemas = '';
  askMaxRows = 500;

  // Test panel
  testValues: Record<string, string> = {};
  testing = false;
  testStage = '';
  /** Router, supervisor and loop decisions of the last test, kept after it ends. */
  testDecisions: string[] = [];
  /** What the question and the setup step set during the last test ("Understood as"). */
  testUnderstood: string[] = [];
  testSteps: (Partial<AgentStepResult> & { step: number; phase: 'start' | 'end' })[] = [];
  testAnswer = '';
  /** The answer's Outputs as typed fields, when the agent has Outputs. */
  testOutput: { name: string; value: string }[] = [];
  testError = '';
  testSeconds: number | null = null;
  /** The run's LLM use on the tenant's provider: "5 calls · 3.2k tokens" and the full numbers. */
  testLlm = '';
  testLlmTitle = '';
  private testSub?: Subscription;

  // Column resize state
  sidebarWidth = 264;
  testPanelWidth = 380;
  private resizingCol: 'sidebar' | 'testPanel' | null = null;
  private resizeStartX = 0;
  private resizeStartW = 0;
  private boundColMove = this.onColResizeMove.bind(this);
  private boundColEnd  = this.onColResizeEnd.bind(this);

  onColResizeStart(event: MouseEvent, col: 'sidebar' | 'testPanel'): void {
    event.preventDefault();
    this.resizingCol  = col;
    this.resizeStartX = event.clientX;
    this.resizeStartW = col === 'sidebar' ? this.sidebarWidth : this.testPanelWidth;
    document.addEventListener('mousemove', this.boundColMove);
    document.addEventListener('mouseup',   this.boundColEnd);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  private onColResizeMove(event: MouseEvent): void {
    if (!this.resizingCol) return;
    const delta = event.clientX - this.resizeStartX;
    if (this.resizingCol === 'sidebar') {
      this.sidebarWidth = Math.max(180, Math.min(420, this.resizeStartW + delta));
    } else {
      this.testPanelWidth = Math.max(260, Math.min(520, this.resizeStartW - delta));
    }
  }

  private onColResizeEnd(): void {
    this.resizingCol = null;
    document.removeEventListener('mousemove', this.boundColMove);
    document.removeEventListener('mouseup',   this.boundColEnd);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }

  constructor(private router: Router, private route: ActivatedRoute, private agents: AgentsService, private cdr: ChangeDetectorRef,
              private layoutState: LayoutStateService, private location: Location, private ai: AiService) {}

  // ── Cost: the price catalog, the real usage of the last runs and of the Test run ─
  catalog: PriceCatalog = { activeModel: null, fastModel: null, prices: [] };
  /** Average real tokens / cost of the agent's last successful runs (null = none yet). */
  measured: { runs: number; tokens: number; cost: number | null } | null = null;
  /** The Test run's tokens and cost. */
  testCost: { input: number; output: number; cost: number; unpriced: string[] } | null = null;
  /** For the canvas Analysis tab. */
  readonly analysisSource = () => ({ agent: this.request(this.status), catalog: this.catalog, measured: this.measured, agentId: this.agentId });

  private loadCost(): void {
    this.ai.modelPrices().subscribe({ next: c => { this.catalog = c; this.cdr.markForCheck(); }, error: () => {} });
    if (!this.agentId) return;
    this.agents.runsOf(this.agentId).subscribe({
      next: runs => {
        const used = runs.filter(r => r.status === 'success' && r.usage?.length).map(r => costOfUsage(r.usage as ModelUsage[], this.catalog));
        this.measured = used.length ? { runs: used.length, tokens: Math.round(used.reduce((n, u) => n + u.input + u.output, 0) / used.length),
          cost: used.every(u => !u.unpriced.length) ? used.reduce((n, u) => n + u.cost, 0) / used.length : null } : null;
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  /** App sidebar state before the editor opened: the editor (Form and Canvas) collapses it for room, leaving restores it. */
  private sidebarBefore: boolean | null = null;

  private restoreSidebar(): void {
    if (this.sidebarBefore === null) return;
    if (this.sidebarBefore) this.layoutState.collapse(); else this.layoutState.expand();
    this.sidebarBefore = null;
  }

  ngOnInit(): void {
    this.sidebarBefore = this.layoutState.isCollapsed;
    this.layoutState.collapse();
    this.agents.list().subscribe({ next: list => { this.subAgents = list; this.addSubAgents(); this.cdr.markForCheck(); } });
    this.agents.tools().subscribe({
      next: r => {
        this.availableConnections = r.tools.map(t => this.toConnection(t));
        this.addSubAgents();
        this.toolsMessage = r.message ?? '';
        this.nameToolGroups();
        this.refreshCanvasTools();
        this.cdr.markForCheck();
      },
      error: () => { this.toolsMessage = 'Could not load the tools.'; this.cdr.markForCheck(); },
    });
    const id = Number(this.route.snapshot.paramMap.get('id'));
    const query = this.route.snapshot.queryParamMap;
    if (id > 0) this.agents.get(id).subscribe({
      next: a => {
        this.load(a);
        this.markSaved();
        this.offerAutosave();
        this.loadSchedules();
        this.loadCost();
        // Agents built before routers were linked in can hold a step nothing reaches: say so on open, not only on Save.
        const dead = this.unreachable(this.request(this.status));
        if (dead) this.show(`${dead} Saving is blocked until then; tests still run.`, 'bad');
        this.cdr.markForCheck();
      },
      error: () => this.show('Agent not found.', 'bad'),
    });
    else {
      this.markSaved();
      this.loadCost();
      // From the Agent Catalog: a template or a copy of a published agent, not saved yet.
      const template = query.get('template'), copy = Number(query.get('duplicate'));
      if (template) {
        const req = templateAgent(template);
        if (req) { this.loadRequest(req, 'draft'); this.show(`Started from the "${req.name}" template. Review it, then Save as Draft or Publish.`, 'ok'); }
      } else if (copy > 0) {
        this.agents.get(copy).subscribe({
          next: a => { this.loadRequest(duplicateOf(a), 'draft'); this.show(`Copied "${a.name}". Tool secrets are not copied; enter them again.`, 'ok'); },
          error: () => this.show('That agent could not be copied.', 'bad'),
        });
      } else this.offerAutosave();
    }
    this.autosaveTimer = setInterval(() => this.autosave(), 2000);
    this.historyTimer = setInterval(() => this.history.record(this.snapshot()), 700);
  }

  ngOnDestroy(): void { this.confirmBox?.resolve(false); this.testSub?.unsubscribe(); this.stopTimer(); this.restoreSidebar(); clearInterval(this.autosaveTimer); clearTimeout(this.messageTimer); clearInterval(this.historyTimer); }

  // ── AutoSave: unsaved changes are kept on this browser until Save or Discard ─
  private autosaveTimer: ReturnType<typeof setInterval> | undefined;
  private autosavedJson = '';
  /** When the last unsaved change was kept, for the header. */
  autosavedAt: Date | null = null;
  /** Unsaved changes found when the page opened: Restore or Dismiss. */
  autosaveOffer: { savedAt: string; request: SaveAgentRequest } | null = null;

  private get autosaveKey(): string { return `twise.agent-autosave.${this.agentId ?? 'new'}`; }

  /** Keeps the page's state (never tool secrets) while it differs from what was saved. */
  private autosave(): void {
    // Not before the agent has loaded, and never over changes the user has not restored or dismissed yet.
    if (!this.savedSnapshot || this.autosaveOffer) return;
    try {
      if (!this.dirty) {
        if (this.autosavedJson) { localStorage.removeItem(this.autosaveKey); this.autosavedJson = ''; this.autosavedAt = null; this.cdr.markForCheck(); }
        return;
      }
      const req = this.request('draft');
      const json = JSON.stringify({ ...req, customTools: req.customTools.map(t => ({ ...t, authSecret: null })) });
      if (json === this.autosavedJson) return;
      localStorage.setItem(this.autosaveKey, JSON.stringify({ savedAt: new Date().toISOString(), request: JSON.parse(json) }));
      this.autosavedJson = json;
      this.autosavedAt = new Date();
      this.cdr.markForCheck();
    } catch { /* storage blocked or full: the page still works, only nothing is kept */ }
  }

  private clearAutosave(key = this.autosaveKey): void {
    try { localStorage.removeItem(key); } catch { /* storage blocked */ }
    this.autosavedJson = '';
    this.autosavedAt = null;
  }

  private offerAutosave(): void {
    try {
      const kept = JSON.parse(localStorage.getItem(this.autosaveKey) ?? 'null');
      if (kept?.request && JSON.stringify(kept.request) !== this.savedSnapshot) this.autosaveOffer = kept;
    } catch { /* nothing usable kept */ }
  }

  restoreAutosave(): void {
    const kept = this.autosaveOffer;
    if (!kept) return;
    this.autosaveOffer = null;
    this.loadRequest(kept.request, this.status);
    this.show('Restored your unsaved changes. Tool secrets typed before are not kept; enter them again if needed.', 'ok');
  }

  dismissAutosave(): void { this.autosaveOffer = null; this.clearAutosave(); this.cdr.markForCheck(); }

  /** An agent object (a version or kept changes) into the editor, keeping this agent's id; nothing is saved. */
  private loadRequest(req: SaveAgentRequest, status: 'draft' | 'published'): void {
    const keepId = this.agentId;
    this.load({ ...req, id: keepId ?? 0, createdBy: '', createdAt: '', updatedAt: '',
      stats: { runs: 0, successRate: null, avgSeconds: null, lastRunAt: null } } as Agent);
    this.agentId = keepId;
    this.status = status;
    // The canvas works on a snapshot of the inputs and needs step ids: take them again (a load can happen on the canvas).
    this.goalInstructions = this.goalInstructions.map(i => i.id ? i : { ...i, id: newStepId() });
    this.canvasInputs = this.inputs.map(i => i.name.trim()).filter(Boolean);
    this.refreshCanvasTools();
    this.refreshJson();
    this.cdr.markForCheck();
  }

  // ── Triggers: schedules that run the published agent ────────────────────
  schedules: AgentSchedule[] = [];
  readonly repeats = [
    { value: 'daily', label: 'Every day at' }, { value: 'weekdays', label: 'Every weekday (Mon–Fri) at' },
    { value: 'weekly', label: 'Every week on' }, { value: 'hourly', label: 'Every hour' },
    { value: 'once', label: 'Once at' }, { value: 'cron', label: 'Custom (cron)' },
  ];
  readonly weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  /** The trigger being added (id null) or edited. */
  scheduleForm: { id: number | null; repeat: string; time: string; weekday: number; once: string; cron: string; timeZone: string;
    inputs: Record<string, string>; emailTo: string; isActive: boolean } | null = null;
  schedulePreview: { problem: string | null; next: string[] } | null = null;
  scheduleError = '';

  private loadSchedules(): void {
    if (!this.agentId) return;
    this.agents.schedules(this.agentId).subscribe({ next: s => { this.schedules = s; this.cdr.markForCheck(); }, error: () => { this.schedules = []; } });
  }

  newSchedule(): void {
    this.scheduleForm = { id: null, repeat: 'daily', time: '06:00', weekday: 0, once: '', cron: '0 6 * * *', timeZone: 'Asia/Muscat',
      inputs: Object.fromEntries(this.testInputs.map(i => [i.name.trim(), ''])), emailTo: '', isActive: true };
    this.schedulePreview = null;
    this.scheduleError = '';
  }

  editSchedule(s: AgentSchedule): void {
    const m = /^(\d+) (\d+) \* \* (\*|1-5|\d)$/.exec(s.cron ?? '');
    const repeat = !s.cron ? 'once' : s.cron === '0 * * * *' ? 'hourly' : !m ? 'cron' : m[3] === '*' ? 'daily' : m[3] === '1-5' ? 'weekdays' : 'weekly';
    this.scheduleForm = {
      id: s.id, repeat, time: m ? `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}` : '06:00', weekday: m && /^\d$/.test(m[3]) ? +m[3] : 0,
      once: s.runOnceAt ? this.utc(s.runOnceAt).slice(0, 16) : '', cron: s.cron ?? '', timeZone: s.timeZone,
      inputs: { ...Object.fromEntries(this.testInputs.map(i => [i.name.trim(), ''])), ...s.inputs }, emailTo: s.emailTo.join(', '), isActive: s.isActive,
    };
    this.schedulePreview = null;
    this.scheduleError = '';
  }

  /** The form as cron / once. Once is entered in UTC (the list shows times in your browser's zone). */
  private scheduleSpec(): { cron: string | null; runOnceAt: string | null; timeZone: string } {
    const f = this.scheduleForm!;
    const [h, min] = (f.time || '06:00').split(':').map(Number);
    const cron = f.repeat === 'daily' ? `${min} ${h} * * *` : f.repeat === 'weekdays' ? `${min} ${h} * * 1-5`
      : f.repeat === 'weekly' ? `${min} ${h} * * ${f.weekday}` : f.repeat === 'hourly' ? '0 * * * *' : f.repeat === 'cron' ? f.cron.trim() : null;
    return { cron, runOnceAt: cron ? null : f.once ? new Date(f.once + 'Z').toISOString() : null, timeZone: f.timeZone.trim() };
  }

  previewSchedule(): void {
    this.agents.previewSchedule(this.scheduleSpec()).subscribe({
      next: p => { this.schedulePreview = p; this.cdr.markForCheck(); },
      error: err => { this.scheduleError = this.errorText(err, 'Could not check the schedule.'); this.cdr.markForCheck(); },
    });
  }

  saveSchedule(): void {
    const f = this.scheduleForm;
    if (!f || !this.agentId) return;
    const body = { ...this.scheduleSpec(), inputs: f.inputs, isActive: f.isActive,
      emailTo: f.emailTo.split(/[,;]/).map(e => e.trim()).filter(Boolean) };
    this.agents.saveSchedule(this.agentId, body, f.id ?? undefined).subscribe({
      next: () => { this.scheduleForm = null; this.show('Trigger saved.', 'ok'); this.loadSchedules(); },
      error: err => { this.scheduleError = this.errorText(err, 'The trigger could not be saved.'); this.cdr.markForCheck(); },
    });
  }

  toggleSchedule(s: AgentSchedule): void {
    if (!this.agentId) return;
    this.agents.saveSchedule(this.agentId, { cron: s.cron, runOnceAt: s.runOnceAt, timeZone: s.timeZone, inputs: s.inputs,
      emailTo: s.emailTo, isActive: !s.isActive }, s.id).subscribe({
      next: () => this.loadSchedules(),
      error: err => this.show(this.errorText(err, 'The trigger could not be changed.'), 'bad'),
    });
  }

  runScheduleNow(s: AgentSchedule): void {
    if (!this.agentId) return;
    this.agents.runScheduleNow(this.agentId, s.id).subscribe({
      next: () => { this.show('The trigger runs within a minute. Its run appears in the agent\'s run history.', 'ok'); setTimeout(() => this.loadSchedules(), 65000); },
      error: err => this.show(this.errorText(err, 'The trigger could not be run.'), 'bad'),
    });
  }

  deleteSchedule(s: AgentSchedule): void {
    if (!this.agentId || !confirm('Delete this trigger?')) return;
    this.agents.deleteSchedule(this.agentId, s.id).subscribe({ next: () => this.loadSchedules() });
  }

  /** A trigger in words. */
  scheduleText(s: AgentSchedule): string {
    if (!s.cron) return s.runOnceAt ? 'Once' : '—';
    const m = /^(\d+) (\d+) \* \* (\*|1-5|\d)$/.exec(s.cron);
    if (s.cron === '0 * * * *') return 'Every hour';
    if (!m) return `Cron ${s.cron}`;
    const at = `${m[2].padStart(2, '0')}:${m[1].padStart(2, '0')}`;
    return m[3] === '*' ? `Every day at ${at}` : m[3] === '1-5' ? `Weekdays at ${at}` : `Every ${this.weekdays[+m[3]]} at ${at}`;
  }

  // ── Section status (the form's side menu) ─────────────────────────────────
  /** complete = required parts done; warning = something to fix; optional = not needed here. */
  sectionStatus(anchor: string): { kind: 'complete' | 'warning' | 'optional'; text: string } {
    const named = (rows: IORow[]) => rows.filter(r => r.name.trim());
    switch (anchor) {
      case 'section-role':
        return this.agentName.trim() ? { kind: 'complete', text: 'Complete' } : { kind: 'warning', text: 'Add a name' };
      case 'section-goal':
        if (!this.goalInstructions.some(i => i.value.trim())) return { kind: 'warning', text: 'Add an instruction' };
        return this.goalInstructions.some(i => i.value.trim() && this.isSqlStep(i) && !i.sql?.trim())
          ? { kind: 'warning', text: 'A Saved SQL step needs its SQL' } : { kind: 'complete', text: 'Complete' };
      case 'section-tools':
        return this.agentToolGroups.some(g => g.actions.length) ? { kind: 'complete', text: 'Complete' } : { kind: 'warning', text: 'Add a tool' };
      case 'section-io': {
        const known = new Set([...named(this.inputs).map(i => i.name.trim()),
          ...this.goalInstructions.map(i => i.outputKey?.trim()).filter((k): k is string => !!k)]);
        // {{item}} is a For Each step's current item.
        const unknown = this.goalInstructions.flatMap(i => [...`${i.value} ${this.isSqlStep(i) ? i.sql ?? '' : ''}`.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1])
          .filter(n => !(n === 'item' && i.forEach))).find(n => !known.has(n));
        if (unknown) return { kind: 'warning', text: `{{${unknown}}} is not an input` };
        return named(this.inputs).length || named(this.outputs).length ? { kind: 'complete', text: 'Complete' } : { kind: 'optional', text: 'Optional' };
      }
      case 'section-knowledge':
        return this.agentToolGroups.some(g => g.connectionId === 'ask_data')
          ? { kind: 'complete', text: this.askBusinessRules.trim() || this.askExamples.trim() ? 'Complete' : 'Default rules' }
          : { kind: 'optional', text: 'Not used' };
      default: {
        const on = this.schedules.filter(s => s.isActive).length;
        return on ? { kind: 'complete', text: `${on} schedule${on > 1 ? 's' : ''} on` } : { kind: 'optional', text: 'Manual (Test Agent)' };
      }
    }
  }

  // ── Versions ─────────────────────────────────────────────────────────────
  versionsOpen = false;
  versions: AgentVersion[] | null = null;
  /** The version being looked at, and how it differs from the page now. */
  versionPick: { no: number; request: SaveAgentRequest; changes: string[] } | null = null;

  toggleVersions(): void {
    this.versionsOpen = !this.versionsOpen;
    this.versionPick = null;
    if (!this.versionsOpen || !this.agentId) return;
    this.versions = null;
    this.agents.versions(this.agentId).subscribe({
      next: v => { this.versions = v; this.cdr.markForCheck(); },
      error: err => { this.versionsOpen = false; this.show(this.errorText(err, 'Could not load the versions.'), 'bad'); },
    });
  }

  pickVersion(no: number): void {
    if (!this.agentId) return;
    this.agents.version(this.agentId, no).subscribe({
      next: r => { this.versionPick = { no, request: r, changes: this.versionChanges(r, this.request(this.status)) }; this.cdr.markForCheck(); },
      error: err => this.show(this.errorText(err, 'Could not load that version.'), 'bad'),
    });
  }

  restoreVersion(): void {
    const pick = this.versionPick;
    if (!pick) return;
    this.loadRequest(pick.request, 'draft');
    this.versionsOpen = false;
    this.versionPick = null;
    this.show(`Loaded version ${pick.no}. Save as Draft or Publish to keep it; Discard to go back.`, 'ok');
  }

  /** The API's UTC times come without a zone. */
  utc(t: string): string { return /Z|[+-]\d\d:\d\d$/.test(t) ? t : t + 'Z'; }

  /** What restoring `v` would change on the page `now`. */
  private versionChanges(v: SaveAgentRequest, now: SaveAgentRequest): string[] {
    const out: string[] = [];
    const fields: [keyof SaveAgentRequest, string][] = [['name', 'Name'], ['role', 'Role'], ['description', 'Description'],
      ['systemPrompt', 'System prompt'], ['goal', 'Goal'], ['type', 'Agent type'], ['maxIterations', 'Max iterations']];
    for (const [k, label] of fields) if (JSON.stringify(v[k] ?? null) !== JSON.stringify(now[k] ?? null)) out.push(`${label} differs`);
    const short = (t: string) => t.length > 40 ? t.slice(0, 40) + '…' : t;
    const strip = (s: object) => JSON.stringify({ ...s, x: null, y: null });
    for (const s of v.steps) {
      const cur = now.steps.find(c => c.id === s.id);
      if (!cur) out.push(`Brings back “${short(s.text)}”`);
      else if (strip(cur) !== strip(s)) out.push(`Changes “${short(cur.text)}”`);
    }
    for (const c of now.steps) if (!v.steps.some(s => s.id === c.id)) out.push(`Removes “${short(c.text)}”`);
    const names = (r: SaveAgentRequest) => [...r.tools.map(t => `${t.agent}:${t.action}`), ...(r.customTools ?? []).map(t => JSON.stringify({ ...t, authSecret: null, hasAuthSecret: null }))].sort().join('|');
    if (names(v) !== names(now)) out.push('Tools differ');
    if (JSON.stringify([v.inputs, v.outputs, v.askData ?? null]) !== JSON.stringify([now.inputs, now.outputs, now.askData ?? null])) out.push('Inputs, outputs or Ask Data settings differ');
    return out.length ? out : ['Same as the page now (only positions may differ).'];
  }

  /** The page as last loaded or saved, to tell unsaved changes. */
  private savedSnapshot = '';
  private markSaved(): void { this.savedSnapshot = JSON.stringify(this.request('draft')); this.history.reset(this.snapshot()); }
  get dirty(): boolean { return JSON.stringify(this.request('draft')) !== this.savedSnapshot; }

  /** Refresh or closing the tab with unsaved changes: the browser asks first. */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(e: BeforeUnloadEvent): void { if (this.dirty) e.preventDefault(); }

  /** Leaving inside the app (route guard). */
  canLeave(): boolean | Promise<boolean> {
    return !this.dirty || this.ask({ title: 'Unsaved changes', message: 'You have unsaved changes to this agent. Leave without saving?',
      confirmLabel: 'Leave without saving', cancelLabel: 'Stay here', variant: 'warning' });
  }

  /** The open confirmation (the app's dialog, not the browser's confirm()); resolve gets the answer. */
  confirmBox: { title: string; message: string; confirmLabel: string; cancelLabel: string; variant: 'danger' | 'warning' | 'info';
    resolve: (ok: boolean) => void } | null = null;

  private ask(box: Omit<NonNullable<NewAgentComponent['confirmBox']>, 'resolve'>): Promise<boolean> {
    this.confirmBox?.resolve(false);
    return new Promise<boolean>(resolve => { this.confirmBox = { ...box, resolve }; this.cdr.markForCheck(); });
  }

  answerConfirm(ok: boolean): void {
    const box = this.confirmBox;
    this.confirmBox = null;
    box?.resolve(ok);
    this.cdr.markForCheck();
  }

  /** A twise agent as an Add Tool "connection"; each capability is an action. */
  private toConnection(t: AgentToolOption): AvailableConnection {
    return {
      id: t.agent, name: t.title, subtitle: t.description, type: 'Agent', status: t.ready ? 'Online' : 'Offline', expanded: false,
      actions: t.capabilities.map(c => ({ id: `${t.agent}:${c}`, method: 'RUN', name: c, path: t.agent })),
    };
  }

  // ── Sub-agents: published agents a step can run (tool subagent / <id>) ──────
  private subAgents: Agent[] = [];

  /** The Sub-agents group of Add Tool: the tenant's published agents but this one. */
  private addSubAgents(): void {
    this.availableConnections = this.availableConnections.filter(c => c.id !== 'subagent');
    const list = this.subAgents.filter(a => a.status === 'published' && a.id !== this.agentId);
    if (list.length) this.availableConnections.push({
      id: 'subagent', name: 'Sub-agents', subtitle: 'Run another published agent as one step. Its inputs take the values with the same name; the first one left gets the instruction.',
      type: 'Agent', status: 'Online', expanded: false,
      actions: list.map(a => ({ id: `subagent:${a.id}`, method: 'RUN', name: String(a.id), path: 'subagent' })),
    });
    this.nameToolGroups();
    this.refreshCanvasTools();
  }

  /** A tool action's name as shown: a sub-agent by its agent's name. */
  actionLabel(a: { name: string; path: string }): string {
    if (a.path !== 'subagent') return a.name;
    return this.subAgents.find(x => String(x.id) === a.name)?.name ?? `Agent ${a.name}`;
  }

  /** Saved tools carry only the agent key; show its title and status once the tool list is known. */
  private nameToolGroups(): void {
    for (const g of this.agentToolGroups) {
      const c = this.availableConnections.find(x => x.id === g.connectionId);
      if (c) { g.connectionName = c.name; g.connectionStatus = c.status; }
      if (g.connectionId === 'api') g.connectionName = 'Tool';
      if (g.connectionId === 'subagent') g.connectionName = 'Sub-agents';
    }
  }

  private load(a: Agent): void {
    this.agentId = a.id;
    this.status = a.status;
    this.agentType = a.type ?? 'sequential';
    this.maxIterations = a.maxIterations ?? 5;
    this.agentName = a.name;
    this.rolePersona = a.role ?? '';
    this.roleDescription = a.description ?? '';
    this.systemPrompt = a.systemPrompt ?? '';
    this.primaryGoal = a.goal ?? '';
    this.goalInstructions = a.steps.length
      ? a.steps.map(s => ({ id: s.id ?? newStepId(), value: s.text, x: s.x ?? undefined, y: s.y ?? undefined,
          kind: s.kind ?? 'step', routeBy: s.routeBy ?? 'rules', branches: s.branches ?? undefined, next: s.next ?? null, tool: s.tool ?? null,
          expectedOutput: s.expectedOutput ?? null, outputKey: s.outputKey ?? null, model: s.model ?? null,
          temperature: s.temperature ?? null, maxTokens: s.maxTokens ?? null, forEach: s.forEach ?? null, retries: s.retries ?? null, options: s.options ?? null,
          sql: s.sql ?? null }))
      : [{ id: newStepId(), value: '' }];
    this.agentToolGroups = [];
    for (const t of a.tools) {
      let group = this.agentToolGroups.find(g => g.connectionId === t.agent);
      if (!group) {
        group = { connectionId: t.agent, connectionName: t.agent, connectionType: 'Agent', connectionStatus: '', actions: [] };
        this.agentToolGroups.push(group);
      }
      group.actions.push({ id: `${t.agent}:${t.action}`, method: 'RUN', name: t.action, path: t.agent === 'subagent' ? 'subagent' : t.agent });
    }
    this.inputs = a.inputs.map(i => ({ name: i.name, type: this.title(i.type), requirement: i.required ? 'Required' : 'Optional', description: i.description ?? '' }));
    this.customTools = (a.customTools ?? []).map(t => ({ ...t, authSecret: '', parameters: t.parameters ?? [], headers: t.headers ?? [] }));
    this.notes = (a.notes ?? []).map(n => ({ ...n }));
    this.nameToolGroups();
    this.askBusinessRules = a.askData?.businessRules ?? '';
    this.askExamples = a.askData?.examples ?? '';
    this.askSchemas = (a.askData?.allowedSchemas ?? []).join(', ');
    this.askMaxRows = a.askData?.maxRows ?? 500;
    this.outputs = a.outputs.map(o => ({ name: o.name, type: this.title(o.type), requirement: '', description: o.description ?? '' }));
  }

  private title(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : 'String'; }

  /** The page as the API's request; blank rows are dropped. */
  private request(status: 'draft' | 'published'): SaveAgentRequest {
    const blank = (s: string) => s.trim() || null;
    return {
      name: this.agentName.trim(),
      role: blank(this.rolePersona),
      description: blank(this.roleDescription),
      systemPrompt: blank(this.systemPrompt),
      goal: blank(this.primaryGoal),
      // A step only stays the setup step while it is step 1 and uses Saved SQL: moved on the Canvas or given another
      // tool, it becomes an ordinary step (its checkbox is shown only on step 1, so it could not be unticked there).
      steps: stepsToSave(this.goalInstructions.map(i => ({ text: i.value, id: i.id ?? newStepId(), x: i.x ?? null, y: i.y ?? null,
        kind: i.kind ?? 'step', routeBy: i.routeBy ?? 'rules', branches: i.branches ?? null, next: i.next ?? null, tool: i.tool ?? null,
        expectedOutput: i.expectedOutput?.trim() || null, outputKey: i.outputKey?.trim() || null, model: i.model?.trim() || null,
        temperature: i.temperature ?? null, maxTokens: i.maxTokens ?? null, forEach: i.forEach?.trim() || null,
        retries: i.retries ? Number(i.retries) : null, options: i.options && Object.keys(i.options).length ? i.options : null,
        sql: this.isSqlStep(i) ? i.sql?.trim() || null : null })),
        this.agentType).map((s, at) => s.kind === 'setup' && (at > 0 || !s.sql) ? { ...s, kind: 'step' as const } : s),
      tools: this.agentToolGroups.flatMap(g => g.actions.map(a => ({ agent: g.connectionId, action: a.name }))),
      inputs: this.inputs.filter(i => i.name.trim()).map(i => ({ name: i.name.trim(), type: (i.type || 'String').toLowerCase(), required: i.requirement !== 'Optional', description: blank(i.description) })),
      outputs: this.outputs.filter(o => o.name.trim()).map(o => ({ name: o.name.trim(), type: (o.type || 'String').toLowerCase(), description: blank(o.description) })),
      status,
      type: this.agentType,
      maxIterations: Number(this.maxIterations) || 5,
      customTools: this.customTools.map(t => ({ ...t, authSecret: t.authSecret || null, body: t.body || null, responsePath: t.responsePath || null })),
      notes: this.notes.map(n => ({ ...n })),
      // Ask Data's Knowledge Source; Saved SQL uses its row limit and allowed schemas.
      askData: this.agentToolGroups.some(g => g.connectionId === 'ask_data' || g.connectionId === SQL_QUERY_TOOL) ? {
        businessRules: blank(this.askBusinessRules),
        examples: blank(this.askExamples),
        allowedSchemas: this.askSchemas.split(',').map(x => x.trim()).filter(Boolean),
        maxRows: Number(this.askMaxRows) || 500,
      } : null,
    };
  }

  /** What is missing before saving or testing; empty when ready. */
  private problems(r: SaveAgentRequest): string {
    if (!r.name) return 'Give the agent a name.';
    if (!r.steps.length) return 'Add at least one instruction under Goal & Instructions.';
    if (r.steps.some(s => s.kind === 'router' || s.next) && r.type !== 'sequential' && r.type !== 'loop')
      return 'Routers and step links work in Sequential and Loop agents. Change the agent type or remove them on the Canvas.';
    const circle = circleAt(r.steps, r.type);
    if (circle !== null)
      return `The steps go round in a circle at '${circle.slice(0, 40)}'. On the Canvas, point that link forward or to the answer.`;
    if (!r.tools.length) return 'Add at least one tool under Tools & Capabilities (for example Ask Data · deep).';
    const noLabel = r.steps.findIndex(s => !s.text);
    if (noLabel >= 0) return `Step ${noLabel + 1} has SQL but no instruction: give it a short label, e.g. "Recent report dates".`;
    const noSql = r.steps.findIndex(s => s.kind !== 'router' && (s.tool ?? r.tools[0])?.agent === SQL_QUERY_TOOL && !s.sql);
    if (noSql >= 0) return `Step ${noSql + 1} ('${r.steps[noSql].text.slice(0, 40)}') uses Saved SQL: write its SQL.`;
    if (r.steps[0]?.kind === 'setup' && r.steps.length < 2) return 'Add at least one step after the setup step.';
    return '';
  }

  /** Step 1 as the setup step: it runs before the others, and its first row's columns named like inputs set them. */
  setSetup(item: InstructionItem, on: boolean): void { item.kind = on ? 'setup' : 'step'; if (on) item.next = null; }

  /** The agent takes a question: people can ask in their own words and one fast-model call fills the other inputs. */
  get asksQuestion(): boolean { return this.inputs.some(i => i.name.trim() === QUESTION_INPUT); }

  /** The tool a step runs with: its own, else the agent's first. */
  private toolOf(item: InstructionItem): AgentTool | null {
    const first = this.agentToolGroups[0];
    return item.tool ?? (first?.actions[0] ? { agent: first.connectionId, action: first.actions[0].name } : null);
  }

  readonly sqlPlaceholder = 'SELECT TOP 10 report_date, COUNT(*) AS entries\nFROM dbo.daily_report\nWHERE cluster = {{cluster}}\nGROUP BY report_date';

  /** A Saved SQL step: an instruction whose tool is sql_query; the Form and Canvas show its SQL box. */
  isSqlStep(item: InstructionItem): boolean { return item.kind !== 'router' && this.toolOf(item)?.agent === SQL_QUERY_TOOL; }

  /** Save-only check (a test may try a half-built flow): every step must be reachable from the start. */
  private unreachable(r: SaveAgentRequest): string {
    const step = neverReached(r.steps, r.type);
    return step === null ? '' : `'${step.slice(0, 40)}' is never reached. On the Canvas, link a step or a branch to it, or remove it.`;
  }

  /** Inputs the Test panel asks for: the named rows under Inputs & Outputs. */
  get testInputs(): IORow[] { return this.inputs.filter(i => i.name.trim()); }

  /** Page messages show as a floating alert: confirmations close by themselves, problems stay until closed. */
  private messageTimer: ReturnType<typeof setTimeout> | undefined;
  private show(text: string, kind: 'ok' | 'bad'): void {
    this.message = text;
    this.messageKind = kind;
    clearTimeout(this.messageTimer);
    if (kind === 'ok') this.messageTimer = setTimeout(() => this.closeMessage(), 6000);
    this.cdr.markForCheck();
  }

  closeMessage(): void { clearTimeout(this.messageTimer); this.message = ''; this.cdr.markForCheck(); }

  private save(status: 'draft' | 'published'): void {
    const req = this.request(status);
    const problem = this.problems(req) || this.unreachable(req);
    if (problem) { this.show(problem, 'bad'); return; }
    if (status === 'draft' && this.agentId && this.status === 'published') {
      this.ask({ title: 'Unpublish agent', message: 'This agent is published. Saving it as a draft unpublishes it. Continue?',
        confirmLabel: 'Save as draft', cancelLabel: 'Cancel', variant: 'warning' })
        .then(ok => { if (ok) this.send(status, req); });
      return;
    }
    this.send(status, req);
  }

  private send(status: 'draft' | 'published', req: SaveAgentRequest): void {
    this.saving = true;
    const call = this.agentId ? this.agents.update(this.agentId, req) : this.agents.create(req);
    call.subscribe({
      next: a => {
        this.saving = false;
        this.clearAutosave();
        if (!this.agentId) this.clearAutosave('twise.agent-autosave.new');
        this.agentId = a.id;
        this.status = a.status;
        this.markSaved();
        this.versions = null;
        if (status === 'published') { this.router.navigate(['/agentic-ai/ai-agents']); return; }
        this.show('Saved as draft.', 'ok');
        // Only the address changes (/new → /:id): navigating rebuilt the page and lost this message and the test results.
        this.location.replaceState(`/agentic-ai/ai-agents/${a.id}`);
      },
      error: err => { this.saving = false; this.show(this.errorText(err), 'bad'); },
    });
  }

  /** A readable reason from an API error; `fallback` names what was being done. */
  private errorText(err: any, fallback = 'Saving failed.'): string {
    const e = err?.error;
    if (e?.errors) return Object.values(e.errors as Record<string, string[]>).flat().join(' ');
    if (err?.status === 404 || err?.status === 405) return `${fallback} This needs the latest Tenant API and agent runtime; restart them.`;
    if (err?.status === 403) return 'You do not have permission to do this.';
    return e?.message || e?.detail || e?.title || fallback;
  }

  startEditName(): void { this.tempName = this.agentName; this.editingName = true; }
  confirmEditName(): void {
    if (this.tempName.trim()) this.agentName = this.tempName.trim();
    this.editingName = false;
  }

  scrollTo(anchor: string): void {
    this.activeSection = anchor;
    document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  addGoalInstruction(): void { this.goalInstructions.push({ id: newStepId(), value: '' }); }

  setView(view: 'form' | 'canvas' | 'json'): void {
    if (view === this.view) return;
    if (view === 'json') this.refreshJson();
    if (view === 'canvas') {
      this.goalInstructions = this.goalInstructions.map(i => i.id ? i : { ...i, id: newStepId() });
      this.refreshCanvasTools();
      this.canvasInputs = this.inputs.map(i => i.name.trim()).filter(Boolean);
    }
    this.view = view;
  }

  // Canvas edits replace the array, so the canvas (and the form) re-render from the one list.
  canvasAdd(at: { x: number; y: number; kind?: 'router' }): void {
    const item: InstructionItem = at.kind === 'router'
      ? { id: newStepId(), value: 'Decide which way to go', x: at.x, y: at.y, kind: 'router', routeBy: 'rules', branches: [
          { id: newStepId(), label: 'Branch 1', input: this.canvasInputs[0] ?? 'last_answer', op: 'equals', value: '' },
          { id: newStepId(), label: 'Otherwise', op: 'else' }] }
      : { id: newStepId(), value: 'New instruction', x: at.x, y: at.y };
    const kept = this.goalInstructions.filter(i => i.value.trim());
    // The router goes last in the list and the step that was last now leads into it, so the router runs.
    // (It used to be sent to the answer, leaving the router unreachable; a branch back to an earlier step
    // is now caught as a circle before saving.)
    const lastStep = kept[kept.length - 1];
    if (at.kind === 'router' && lastStep && lastStep.kind !== 'router' && !lastStep.next) lastStep.next = item.id!;
    this.goalInstructions = [...kept, item];
    this.cdr.markForCheck();
  }

  /** Duplicate / Paste on the canvas: the copies come with new ids, positions and links. */
  canvasInsert(steps: unknown[]): void {
    this.goalInstructions = [...this.goalInstructions, ...(steps as InstructionItem[])];
    this.refreshCanvasTools();
    this.cdr.markForCheck();
  }

  canvasRemoveMany(ids: string[]): void {
    this.goalInstructions = this.goalInstructions.filter(i => !ids.includes(i.id ?? ''));
    for (const id of ids) this.unlink(id);
    if (!this.goalInstructions.length) this.goalInstructions = [{ id: newStepId(), value: '' }];
    this.cdr.markForCheck();
  }

  // ── Undo / redo: every change to the agent (form or canvas) is a step back ─
  readonly history = new EditHistory(50);
  private historyTimer: ReturnType<typeof setInterval> | undefined;
  private snapshot(): string { return JSON.stringify(this.request(this.status)); }

  // Record first: a change made since the last tick would otherwise be skipped.
  undoEdit(): void { this.history.record(this.snapshot()); this.applyHistory(this.history.undo()); }
  redoEdit(): void { this.applyHistory(this.history.redo()); }

  private applyHistory(snap: string | null): void {
    if (!snap) return;
    this.loadRequest(JSON.parse(snap), this.status);
    this.history.sync(this.snapshot());   // the editor may normalise the loaded agent: that is not a new step
    this.show('Undone — Ctrl+Y redoes it.', 'ok');
  }

  canvasRemove(id: string): void {
    this.goalInstructions = this.goalInstructions.filter(i => i.id !== id);
    this.unlink(id);
    this.cdr.markForCheck();
  }

  /** Links and branches that went to a removed step now go to the following step / the answer. */
  private unlink(id?: string): void {
    for (const i of this.goalInstructions) {
      if (i.next === id) i.next = null;
      for (const b of i.branches ?? []) if (b.target === id) b.target = null;
      if (i.options?.['retryFrom'] === id) { const rest = { ...i.options }; delete rest['retryFrom']; i.options = Object.keys(rest).length ? rest : null; }
    }
  }

  canvasReorder(e: { stepId: string; afterId: string }): void {
    const moving = this.goalInstructions.find(i => i.id === e.stepId);
    if (!moving) return;
    const rest = this.goalInstructions.filter(i => i !== moving);
    const at = e.afterId === 'start' ? 0 : rest.findIndex(i => i.id === e.afterId) + 1;
    if (at < 0) return;
    rest.splice(at, 0, moving);
    this.goalInstructions = rest;
    this.cdr.markForCheck();
  }

  canvasMoved(moves: { id: string; x: number; y: number }[]): void {
    this.goalInstructions = this.goalInstructions.map(i => {
      const m = moves.find(x => x.id === i.id);
      return m ? { ...i, x: m.x, y: m.y } : i;
    });
    this.cdr.markForCheck();
  }
  removeGoalInstruction(i: number): void { const [gone] = this.goalInstructions.splice(i, 1); this.unlink(gone?.id); }
  clearGoalInstructions(): void { this.goalInstructions = []; }

  // New rows show what they save as (an empty "Select" was saved as String / Required).
  addInput(): void { this.inputs.push({ name: '', type: 'String', requirement: 'Required', description: '' }); }
  removeInput(i: number): void { this.inputs.splice(i, 1); }
  clearInputs(): void { this.inputs = []; }

  addOutput(): void { this.outputs.push({ name: '', type: 'String', requirement: '', description: '' }); }
  removeOutput(i: number): void { this.outputs.splice(i, 1); }
  clearOutputs(): void { this.outputs = []; }

  // ── Tool modal helpers ────────────────────────────────────
  get filteredConnections(): AvailableConnection[] {
    // The two tabs split the list: agent tools (Ask Data, twise agents) and external connections (none yet).
    const inTab = this.availableConnections.filter(c => (c.type === 'Agent') === (this.addToolTab === 'agent'));
    if (!this.addToolSearch.trim()) return inTab;
    const q = this.addToolSearch.toLowerCase();
    return inTab.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.actions.some(a => a.name.toLowerCase().includes(q))
    );
  }

  get selectedGroups(): { connectionId: string; connectionName: string; connectionType: string; connectionStatus: string; actions: { id: string; method: string; name: string; path: string }[] }[] {
    const grouped: any[] = [];
    for (const sel of this.selectedActions) {
      let group = grouped.find((g: any) => g.connectionId === sel.connectionId);
      if (!group) {
        group = { connectionId: sel.connectionId, connectionName: sel.connectionName, connectionType: sel.connectionType, connectionStatus: sel.connectionStatus, actions: [] };
        grouped.push(group);
      }
      group.actions.push({ id: sel.actionId, method: sel.method, name: sel.name, path: sel.path });
    }
    return grouped;
  }

  openAddToolModal(): void {
    this.showAddToolModal = true;
    this.addToolTab = 'agent';
    this.addToolSearch = '';
    this.selectedActions = [];
  }

  closeAddToolModal(): void { this.showAddToolModal = false; }

  toggleConnectionExpand(conn: AvailableConnection): void { conn.expanded = !conn.expanded; }

  isActionSelected(actionId: string): boolean {
    return this.selectedActions.some(a => a.actionId === actionId);
  }

  toggleActionSelection(conn: AvailableConnection, action: AvailableToolAction): void {
    const idx = this.selectedActions.findIndex(a => a.actionId === action.id);
    if (idx >= 0) {
      this.selectedActions.splice(idx, 1);
    } else {
      this.selectedActions.push({
        connectionId: conn.id, connectionName: conn.name,
        connectionType: conn.type, connectionStatus: conn.status,
        actionId: action.id, method: action.method,
        name: action.name, path: action.path,
      });
    }
  }

  removeFromSelected(actionId: string): void {
    const idx = this.selectedActions.findIndex(a => a.actionId === actionId);
    if (idx >= 0) this.selectedActions.splice(idx, 1);
  }

  clearSelectedActions(): void { this.selectedActions = []; }

  private refreshCanvasTools(): void {
    this.canvasTools = this.agentToolGroups.flatMap(g => g.actions.map(a => ({ id: `${g.connectionId}:${a.name}`, label: `${g.connectionName} · ${this.actionLabel(a)}` })));
    // Built-in tools the canvas can add (its palette shows the framework's Built-in Tools; Ask Data / Ask AI via Tools & Capabilities).
    this.paletteTools = this.availableConnections.filter(c => BUILT_IN_TOOLS.includes(c.id) || c.id === SQL_QUERY_TOOL)
      .flatMap(c => c.actions.map(a => ({ id: `${c.id}:${a.name}`, label: `${c.name} · ${a.name}` })));
  }

  /** Remove a tool (from the canvas Properties panel); steps that used it go back to the agent's first tool. */
  canvasRemoveTool(id: string): void {
    const at = id.indexOf(':');
    const [agent, action] = [id.slice(0, at), id.slice(at + 1)];
    for (const g of this.agentToolGroups) if (g.connectionId === agent) g.actions = g.actions.filter(a => a.name !== action);
    this.agentToolGroups = this.agentToolGroups.filter(g => g.actions.length);
    for (const i of this.goalInstructions) if (i.tool?.agent === agent && i.tool.action === action) i.tool = null;
    if (agent === 'api') this.customTools = this.customTools.filter(t => t.name !== action);
    this.refreshCanvasTools();
    this.cdr.markForCheck();
  }

  /** A new Tool node from the canvas palette: a REST call the agent's model can make. */
  canvasNewTool(): void {
    let n = this.customTools.length + 1;
    while (this.customTools.some(t => t.name === `tool_${n}`)) n++;
    const tool: AgentCustomTool = { name: `tool_${n}`, description: '', parameters: [], method: 'GET', url: 'https://', headers: [],
      body: '', responsePath: '', authScheme: 'none', authSecret: '', timeout: 30 };
    this.customTools = [...this.customTools, tool];
    let group = this.agentToolGroups.find(g => g.connectionId === 'api');
    if (!group) {
      group = { connectionId: 'api', connectionName: 'Tool', connectionType: 'Tool', connectionStatus: '', actions: [] };
      this.agentToolGroups.push(group);
    }
    group.actions.push({ id: `api:${tool.name}`, method: 'RUN', name: tool.name, path: 'api' });
    this.refreshCanvasTools();
    this.cdr.markForCheck();
  }

  /** A Tool node renamed on the canvas: its references follow. */
  canvasRenameTool(e: { from: string; to: string }): void {
    for (const g of this.agentToolGroups) if (g.connectionId === 'api')
      for (const a of g.actions) if (a.name === e.from) { a.name = e.to; a.id = `api:${e.to}`; }
    for (const i of this.goalInstructions) if (i.tool?.agent === 'api' && i.tool.action === e.from) i.tool = { agent: 'api', action: e.to };
    this.refreshCanvasTools();
    this.cdr.markForCheck();
  }

  /** A tool dragged from the canvas palette: add it as Add Tool would. */
  canvasAddTool(id: string): void {
    const [agent, action] = id.split(':');
    const conn = this.availableConnections.find(c => c.id === agent);
    const act = conn?.actions.find(a => a.name === action);
    if (!conn || !act) return;
    let group = this.agentToolGroups.find(g => g.connectionId === conn.id);
    if (!group) {
      group = { connectionId: conn.id, connectionName: conn.name, connectionType: conn.type, connectionStatus: conn.status, actions: [] };
      this.agentToolGroups.push(group);
    }
    if (!group.actions.some(a => a.id === act.id)) group.actions.push({ id: act.id, method: act.method, name: act.name, path: act.path });
    this.refreshCanvasTools();
    this.cdr.markForCheck();
  }

  addToolActions(): void {
    for (const sel of this.selectedActions) {
      let group = this.agentToolGroups.find(g => g.connectionId === sel.connectionId);
      if (!group) {
        group = { connectionId: sel.connectionId, connectionName: sel.connectionName, connectionType: sel.connectionType, connectionStatus: sel.connectionStatus, actions: [] };
        this.agentToolGroups.push(group);
      }
      if (!group.actions.find(a => a.id === sel.actionId)) {
        group.actions.push({ id: sel.actionId, method: sel.method, name: sel.name, path: sel.path });
      }
    }
    this.closeAddToolModal();
  }

  /** Remove a tool (Form view); steps that used it go back to the agent's first tool, as on the Canvas. */
  removeAgentToolAction(groupIdx: number, actionIdx: number): void {
    const group = this.agentToolGroups[groupIdx];
    const [removed] = group.actions.splice(actionIdx, 1);
    if (group.actions.length === 0) {
      this.agentToolGroups.splice(groupIdx, 1);
    }
    for (const i of this.goalInstructions)
      if (i.tool?.agent === group.connectionId && i.tool.action === removed?.name) i.tool = null;
    this.refreshCanvasTools();
  }

  addTool(): void { this.openAddToolModal(); }

  discard(): void { this.clearAutosave(); this.markSaved(); this.router.navigate(['/agentic-ai/ai-agents']); }
  saveAsDraft(): void { this.save('draft'); }
  publish(): void { this.save('published'); }

  /** Runs the configuration on screen and shows each step's progress and the answer as it streams. */
  testAgent(): void {
    const req = this.request(this.status);
    const problem = this.problems(req);
    if (problem) { this.testError = problem; return; }
    Object.assign(this, { testSteps: [], testAnswer: '', testOutput: [], testSeconds: null, testCost: null, testLlm: '', testLlmTitle: '',
      testDecisions: [], testUnderstood: [] });
    const values: Record<string, string> = {};
    for (const i of req.inputs) values[i.name] = this.testValues[i.name] ?? '';
    if (this.conversation && !this.threadId) this.threadId = crypto.randomUUID();
    if (this.conversation) this.turns++;
    this.follow(this.agents.test(req, values, this.agentId, this.conversation ? this.threadId : null));
  }

  /** The Test panel: run once (Test) or the agent's test cases (Evals). */
  panelTab: 'test' | 'evals' = 'test';
  /** For the Evals tab: the agent as it is on the page, and whether it has unsaved changes. */
  readonly evalCurrent = () => ({ agent: this.request(this.status), dirty: this.dirty });
  get inputNames(): string[] { return this.testInputs.map(i => i.name.trim()); }

  /** Conversation: each Test Agent run continues the same thread (the agent gets the earlier answers). */
  conversation = false;
  threadId: string | null = null;
  turns = 0;

  newConversation(): void { this.threadId = null; this.turns = 0; }

  /** Human Approval: the run waiting for a decision, and the text (the draft, editable). */
  approval: { runId: number; token: string; step: number; question: string; draft: string } | null = null;
  approvalText = '';

  decide(decision: 'approve' | 'reject'): void {
    const a = this.approval;
    if (!a) return;
    const edited = decision === 'approve' && this.approvalText.trim() !== a.draft.trim();
    this.follow(this.agents.resume(a.runId, a.token, edited ? 'edit' : decision, this.approvalText));
  }

  /** Shows a run's (or a resumed run's) progress as it streams. */
  private follow(events: Observable<AgentRunEvent>): void {
    this.testSub?.unsubscribe();
    Object.assign(this, { testing: true, testStage: 'Starting', testError: '', approval: null });
    this.startTimer();
    let ended = false;
    const why = (reason?: string) => reason ? ` (${reason})` : '';
    this.testSub = events.subscribe({
      next: ev => {
        if (ev.type === 'status') this.testStage = ev.data.stage;
        else if (ev.type === 'inputs') this.testUnderstood.push(understoodText(ev.data));
        else if (ev.type === 'approval') {
          ended = true;   // paused, not lost: the decision continues it
          this.approval = ev.data;
          this.approvalText = ev.data.draft;
        } else if (ev.type === 'decision') {
          this.testStage = ev.data.by === 'approval' ? `Step ${ev.data.step}: ${ev.data.decision}${ev.data.reviewer ? ' by ' + ev.data.reviewer : ''}`
            : ev.data.by === 'exit_loop' ? `Exit Loop: ${ev.data.done ? 'goal met' : 'not yet'}${why(ev.data.reason)}`
            : ev.data.by === 'router'
            ? `${ev.data.router}: ${ev.data.branch}${why(ev.data.reason)}`
            : ev.data.by === 'supervisor'
            ? (ev.data.next === 'answer' ? `Supervisor: finished${why(ev.data.reason)}` : `Supervisor → ${ev.data.next}${why(ev.data.reason)}`)
            : `Round ${ev.data.round}: ${ev.data.done ? 'goal met' : 'repeating'}${why(ev.data.reason)}`;
          this.testDecisions.push(this.testStage);
        } else if (ev.type === 'step') {
          // Supervisor and loop can run a step more than once: one entry per attempt.
          const at = this.testSteps.findIndex(s => s.step === ev.data.step && (s.attempt ?? 1) === (ev.data.attempt ?? 1));
          if (at >= 0) this.testSteps[at] = { ...this.testSteps[at], ...ev.data }; else this.testSteps.push(ev.data);
          this.testStage = ev.data.phase === 'start' ? `Step ${ev.data.step}: ${ev.data.question}` : this.testStage;
        } else if (ev.type === 'done') {
          ended = true;
          this.testAnswer = ev.data.answer;
          this.testCost = ev.data.usage?.length ? costOfUsage(ev.data.usage, this.catalog) : null;
          this.testOutput = Object.entries(ev.data.output ?? {}).map(([name, v]) => ({ name, value: v === null ? '—' : typeof v === 'string' ? v : JSON.stringify(v) }));
          this.testSeconds = ev.data.seconds;
          this.testLlm = ev.data.llm ? usageLine(ev.data.llm) : '';
          this.testLlmTitle = usageTitle(ev.data.llm);
          if (!ev.data.ok) this.testError = 'The agent could not answer. See the steps below.';
        } else if (ev.type === 'error') { ended = true; this.testError = ev.data.message; }
        this.cdr.markForCheck();
      },
      error: err => {
        this.stopTimer();
        this.testing = false;
        // A refused request (4xx) has a reason from the API; only a broken stream is a lost connection.
        this.testError = err?.status >= 400 && err?.status < 500
          ? this.errorText(err, 'The test could not start.')
          : `The connection to the agent service was lost after ${this.testElapsed}s (${err?.message ?? 'no reason given'}). `
            + 'The run is recorded as stopped; try again.';
        this.cdr.markForCheck();
      },
      complete: () => {
        this.stopTimer();
        this.testing = false;
        this.testStage = '';
        if (!ended) this.testError = 'The agent service ended the run without an answer. Check that the agent runtime is running, then try again.';
        this.cdr.markForCheck();
      },
    });
  }

  /** Download a test step's data (Ask Data export): the file name comes from the server. */
  exportStep(s: Partial<AgentStepResult>, format: 'xlsx' | 'docx'): void {
    if (!s.export_token) return;
    const askData = this.request(this.status).askData;
    this.agents.exportAskData({ token: s.export_token, format, question: s.question ?? '', answer: s.answer ?? '', verified: s.verified ?? true, askData })
      .subscribe({
        next: res => {
          const name = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `export.${format}`;
          const url = URL.createObjectURL(res.body!);
          const a = document.createElement('a');
          a.href = url;
          a.download = decodeURIComponent(name);
          a.click();
          URL.revokeObjectURL(url);
        },
        error: err => { this.testError = this.errorText(err, 'The data could not be exported.'); this.cdr.markForCheck(); },
      });
  }

  /** Seconds since Test Agent was pressed, shown while it runs. */
  testElapsed = 0;
  private testTimer?: ReturnType<typeof setInterval>;

  private startTimer(): void {
    this.stopTimer();
    const started = Date.now();
    this.testElapsed = 0;
    this.testTimer = setInterval(() => { this.testElapsed = Math.round((Date.now() - started) / 1000); this.cdr.markForCheck(); }, 1000);
  }

  private stopTimer(): void { if (this.testTimer) clearInterval(this.testTimer); this.testTimer = undefined; }

  /** The page as agentflow.json v1, from the runtime's converter (what Download and Copy give). */
  refreshJson(): void {
    this.jsonError = '';
    this.agents.exportAgentFlow(this.request(this.status)).subscribe({
      next: flow => { this.jsonText = JSON.stringify(flow, null, 2); this.cdr.markForCheck(); },
      error: err => { this.jsonError = this.errorText(err, 'agentflow.json could not be built.'); this.jsonText = ''; this.cdr.markForCheck(); },
    });
  }

  copyJson(): void { navigator.clipboard?.writeText(this.jsonText).then(() => this.show('agentflow.json copied.', 'ok')); }

  downloadJson(): void {
    const url = URL.createObjectURL(new Blob([this.jsonText], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(this.agentName || 'agent').replace(/[^\w-]+/g, '-').toLowerCase()}.agentflow.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Loads an agentflow.json (from here or the AgenticUIFramework) into the page; nothing is saved until Save. */
  importJson(file: File | undefined): void {
    if (!file) return;
    file.text().then(text => {
      let flow: unknown;
      try { flow = JSON.parse(text); } catch { this.show('That file is not JSON.', 'bad'); return; }
      this.agents.importAgentFlow(flow).subscribe({
        next: r => {
          // An import is a new agent: keeping the open agent's id made Save overwrite that agent.
          this.load({ ...r.agent, id: 0, createdBy: '', createdAt: '', updatedAt: '',
            stats: { runs: 0, successRate: null, avgSeconds: null, lastRunAt: null } } as Agent);
          this.agentId = null;
          this.status = 'draft';
          this.location.replaceState('/agentic-ai/ai-agents/new');
          this.importWarnings = r.warnings;
          this.show(`Imported "${r.agent.name}" as a new agent. Review it, then Save as Draft or Publish.`, 'ok');
          this.refreshJson();
        },
        error: err => this.show(this.errorText(err, 'The file could not be imported.'), 'bad'),
      });
    });
  }

  /** Answers come as markdown; show them as plain text without the ** and __ markers. */
  plain(text: string | null | undefined): string { return (text ?? '').replace(/\*\*|__/g, ''); }

  /** Answers as formatted HTML (tables, headings, lists); converted once per text, not on every check. */
  private mdCache = new Map<string, string>();
  md(text: string | null | undefined): string {
    const key = text ?? '';
    let html = this.mdCache.get(key);
    if (html === undefined) {
      if (this.mdCache.size > 50) this.mdCache.clear();
      this.mdCache.set(key, (html = markdownToHtml(key)));
    }
    return html;
  }

  trackByIndex(i: number): number { return i; }
  trackByLabel(_: number, n: { label: string }): string { return n.label; }
}
