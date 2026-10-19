import { Location } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { Agent, AgentBranch, AgentsService, AgentTool, AgentStepResult, AgentToolOption, AgentType, QUESTION_INPUT, SaveAgentRequest, SQL_QUERY_TOOL,
  StepKind, understoodText } from '../agents.service';
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

  /** Section badges from what is on the page (they were fixed values before). */
  get navSections(): { label: string; iconType: string; status: 'complete' | 'warning' | 'soon'; note: string; anchor: string }[] {
    const ok = (missing: string) => missing ? { status: 'warning' as const, note: missing } : { status: 'complete' as const, note: 'Complete' };
    const steps = this.goalInstructions.filter(i => i.value.trim());
    const inputNames = new Set(this.inputs.map(i => i.name.trim()).filter(Boolean));
    const unknown = steps.flatMap(s => [...`${s.value} ${this.isSqlStep(s) ? s.sql ?? '' : ''}`.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map(m => m[1]))
      .find(n => !inputNames.has(n));
    const noSql = steps.some(s => this.isSqlStep(s) && !s.sql?.trim());
    return [
      { label: 'Identity & Role', iconType: 'identity', anchor: 'section-role', ...ok(this.agentName.trim() ? '' : 'Needs a name') },
      { label: 'Goal & Instructions', iconType: 'goal', anchor: 'section-goal',
        ...ok(!steps.length ? 'Add an instruction' : noSql ? 'A Saved SQL step needs its SQL' : '') },
      { label: 'Tools & Capabilities', iconType: 'tools', anchor: 'section-tools', ...ok(this.agentToolGroups.length ? '' : 'Add a tool') },
      { label: 'Inputs & Outputs', iconType: 'inputs', anchor: 'section-io', ...ok(unknown ? `Add input "${unknown}"` : '') },
      { label: 'Knowledge Source', iconType: 'knowledge', anchor: 'section-knowledge', ...ok('') },
      { label: 'Triggers', iconType: 'triggers', anchor: 'section-triggers', status: 'soon', note: 'Coming soon' },
    ];
  }

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
              private layoutState: LayoutStateService, private location: Location) {}

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
    this.agents.tools().subscribe({
      next: r => {
        this.availableConnections = r.tools.map(t => this.toConnection(t));
        this.toolsMessage = r.message ?? '';
        this.nameToolGroups();
        this.refreshCanvasTools();
        this.cdr.markForCheck();
      },
      error: () => { this.toolsMessage = 'Could not load the tools.'; this.cdr.markForCheck(); },
    });
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id > 0) this.agents.get(id).subscribe({
      next: a => {
        this.load(a);
        this.markSaved();
        // Agents built before routers were linked in can hold a step nothing reaches: say so on open, not only on Save.
        const dead = this.unreachable(this.request(this.status));
        if (dead) this.show(`${dead} Saving is blocked until then; tests still run.`, 'bad');
        this.cdr.markForCheck();
      },
      error: () => this.show('Agent not found.', 'bad'),
    });
    else this.markSaved();
  }

  ngOnDestroy(): void { this.confirmBox?.resolve(false); this.testSub?.unsubscribe(); this.stopTimer(); this.restoreSidebar(); }

  /** The page as last loaded or saved, to tell unsaved changes. */
  private savedSnapshot = '';
  private markSaved(): void { this.savedSnapshot = JSON.stringify(this.request('draft')); }
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

  /** Saved tools carry only the agent key; show its title and status once the tool list is known. */
  private nameToolGroups(): void {
    for (const g of this.agentToolGroups) {
      const c = this.availableConnections.find(x => x.id === g.connectionId);
      if (c) { g.connectionName = c.name; g.connectionStatus = c.status; }
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
          sql: s.sql ?? null }))
      : [{ id: newStepId(), value: '' }];
    this.agentToolGroups = [];
    for (const t of a.tools) {
      let group = this.agentToolGroups.find(g => g.connectionId === t.agent);
      if (!group) {
        group = { connectionId: t.agent, connectionName: t.agent, connectionType: 'Agent', connectionStatus: '', actions: [] };
        this.agentToolGroups.push(group);
      }
      group.actions.push({ id: `${t.agent}:${t.action}`, method: 'RUN', name: t.action, path: t.agent });
    }
    this.inputs = a.inputs.map(i => ({ name: i.name, type: this.title(i.type), requirement: i.required ? 'Required' : 'Optional', description: i.description ?? '' }));
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
        sql: this.isSqlStep(i) ? i.sql?.trim() || null : null })),
        this.agentType).map((s, at) => s.kind === 'setup' && (at > 0 || !s.sql) ? { ...s, kind: 'step' as const } : s),
      tools: this.agentToolGroups.flatMap(g => g.actions.map(a => ({ agent: g.connectionId, action: a.name }))),
      inputs: this.inputs.filter(i => i.name.trim()).map(i => ({ name: i.name.trim(), type: (i.type || 'String').toLowerCase(), required: i.requirement !== 'Optional', description: blank(i.description) })),
      outputs: this.outputs.filter(o => o.name.trim()).map(o => ({ name: o.name.trim(), type: (o.type || 'String').toLowerCase(), description: blank(o.description) })),
      status,
      type: this.agentType,
      maxIterations: Number(this.maxIterations) || 5,
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

  private show(text: string, kind: 'ok' | 'bad'): void { this.message = text; this.messageKind = kind; this.cdr.markForCheck(); }

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
        this.agentId = a.id;
        this.status = a.status;
        this.markSaved();
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
    this.canvasTools = this.agentToolGroups.flatMap(g => g.actions.map(a => ({ id: `${g.connectionId}:${a.name}`, label: `${g.connectionName} · ${a.name}` })));
    // Only built-in tools: the twise agents are agents to be rebuilt in this builder, not tools.
    this.paletteTools = this.availableConnections.filter(c => c.id === 'ask_data' || c.id === SQL_QUERY_TOOL)
      .flatMap(c => c.actions.map(a => ({ id: `${c.id}:${a.name}`, label: `${c.name} · ${a.name}` })));
  }

  /** Remove a tool (from the canvas Properties panel); steps that used it go back to the agent's first tool. */
  canvasRemoveTool(id: string): void {
    const at = id.indexOf(':');
    const [agent, action] = [id.slice(0, at), id.slice(at + 1)];
    for (const g of this.agentToolGroups) if (g.connectionId === agent) g.actions = g.actions.filter(a => a.name !== action);
    this.agentToolGroups = this.agentToolGroups.filter(g => g.actions.length);
    for (const i of this.goalInstructions) if (i.tool?.agent === agent && i.tool.action === action) i.tool = null;
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

  discard(): void { this.markSaved(); this.router.navigate(['/agentic-ai/ai-agents']); }
  saveAsDraft(): void { this.save('draft'); }
  publish(): void { this.save('published'); }

  /** Runs the configuration on screen and shows each step's progress and the answer as it streams. */
  testAgent(): void {
    const req = this.request(this.status);
    const problem = this.problems(req);
    if (problem) { this.testError = problem; return; }
    this.testSub?.unsubscribe();
    Object.assign(this, { testing: true, testStage: 'Starting', testSteps: [], testAnswer: '', testError: '', testSeconds: null, testLlm: '', testLlmTitle: '',
      testDecisions: [], testUnderstood: [] });
    this.startTimer();
    const values: Record<string, string> = {};
    for (const i of req.inputs) values[i.name] = this.testValues[i.name] ?? '';
    let ended = false;
    const why = (reason?: string) => reason ? ` (${reason})` : '';
    this.testSub = this.agents.test(req, values, this.agentId).subscribe({
      next: ev => {
        if (ev.type === 'status') this.testStage = ev.data.stage;
        else if (ev.type === 'inputs') this.testUnderstood.push(understoodText(ev.data));
        else if (ev.type === 'decision') {
          this.testStage = ev.data.by === 'router'
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
