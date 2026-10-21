import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AgentCustomTool, AgentMemory, AgentNote, AgentsService, SaveAgentRequest } from '../../agents.service';
import { Analysis, analyzeAgent, PriceCatalog } from '../../analyzer/agent-analyzer';

/** Built-ins that run on the tenant's model: a step using one can set model, temperature and max tokens. */
const MODEL_TOOLS = ['ask_ai', 'api', 'url_context', 'load_memory', 'preload_memory', 'exit_loop', 'evaluator', 'guardrail'];
import { FormsModule } from '@angular/forms';
import {
  FCanvasComponent, FCreateConnectionEvent, FCreateNodeEvent, FFlowComponent, FFlowModule, FMoveNodesEvent, FSelectionChangeEvent, FZoomDirective,
} from '@foblex/flow';
import { cloneSteps } from './canvas-clipboard';

/** An instruction as the canvas sees it: the New Agent page's own item (same object, so both views edit one agent). */
/** id is always set by the page before the canvas opens (see NewAgentComponent.setView). */
export interface CanvasBranch { id: string; label?: string | null; input?: string | null; op: string; value?: string | null; target?: string | null; }
export interface CanvasStep {
  id?: string; value: string; x?: number; y?: number;
  /** 'setup' (step 1, Saved SQL) is drawn as an instruction; it is set in the Form view. */
  kind?: 'step' | 'router' | 'setup'; routeBy?: 'rules' | 'ai'; branches?: CanvasBranch[]; next?: string | null;
  /** The step's own tool; null = the agent's first tool. */
  tool?: { agent: string; action: string } | null;
  /** Saved SQL steps: the SELECT they run. */
  sql?: string | null;
  expectedOutput?: string | null; outputKey?: string | null; model?: string | null; temperature?: number | null; maxTokens?: number | null;
  forEach?: string | null; retries?: number | null; options?: Record<string, unknown> | null;
}
export interface CanvasTool { id: string; label: string; }

/**
 * One palette entry, after the AgenticUIFramework's node palette (same groups, names and descriptions).
 * `data` is what a drop creates: 'step' (an instruction) or 'tool:<agent>:<action>'; entries without it are
 * shown as on the canvas already or coming soon.
 */
interface PaletteItem { label: string; description: string; data?: string; note?: string; section?: string; }
interface PaletteGroup { label: string; items: PaletteItem[]; }

interface CanvasNode {
  id: string;
  kind: 'start' | 'step' | 'router' | 'answer' | 'tool' | 'supervisor' | 'check';
  title: string;
  detail: string;
  position: { x: number; y: number };
  /** Router only: one output port per branch. */
  branches?: { port: string; label: string }[];
}

interface CanvasConnection { id: string; source: string; target: string; uses: boolean; back?: boolean; loop?: boolean; label?: string; }

type AgentType = 'sequential' | 'parallel' | 'supervisor' | 'loop';

const STEP_GAP = 280;
const newBranchId = () => 'br-' + Math.random().toString(36).slice(2, 10);
const OP_TEXT: Record<string, string> = {
  equals: '=', not_equals: '≠', contains: 'contains', not_contains: 'does not contain',
  gt: '>', gte: '≥', lt: '<', lte: '≤', empty: 'is empty', not_empty: 'is not empty',
};
const ROW_Y = 220;

/**
 * Canvas view of the New Agent page (Foblex Flow). It draws the agent's shape for its type (the AgenticUIFramework's
 * process): sequential chain, parallel fan-out, supervisor hub, or chain with a loop-back check; each tool is linked
 * to the instructions that use it. Edits go out as events; the page owns the agent and re-renders this view from it.
 * Foblex runs outside change detection, so every handler calls markForCheck().
 */
/** Canvas node id prefix of a sticky note. */
const NOTE = 'note:';

@Component({
  selector: 'app-agent-canvas',
  standalone: true,
  imports: [CommonModule, FormsModule, FFlowModule],
  templateUrl: './agent-canvas.component.html',
  styleUrls: ['./agent-canvas.component.scss'],
})
export class AgentCanvasComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() steps: CanvasStep[] = [];
  @Input() tools: CanvasTool[] = [];
  @Input() inputs: string[] = [];
  @Input() type: AgentType = 'sequential';
  /** Every tool the agent could use (built-in Ask Data and twise agents), for the Tools group. */
  @Input() availableTools: CanvasTool[] = [];
  @Input() maxIterations = 5;
  /** The agent's Tool nodes (the page's objects: edits here are the page's). */
  @Input() customTools: AgentCustomTool[] = [];
  @Input() agentId: number | null = null;
  /** The agent, prices and measured runs, for the Analysis tab. */
  @Input() analysisSource: (() => { agent: SaveAgentRequest; catalog: PriceCatalog; measured: { runs: number; tokens: number; cost: number | null } | null; agentId: number | null }) | null = null;
  @Output() newTool = new EventEmitter<void>();
  @Output() renameTool = new EventEmitter<{ from: string; to: string }>();
  @Output() maxIterationsChange = new EventEmitter<number>();

  /** A new instruction (or router) dropped from the palette at this canvas position. */
  @Output() addStep = new EventEmitter<{ x: number; y: number; kind?: 'router' }>();
  @Output() removeStep = new EventEmitter<string>();
  /** Copies to add (Duplicate / Paste), already with new ids, positions and links. */
  @Output() insertSteps = new EventEmitter<CanvasStep[]>();
  @Output() removeSteps = new EventEmitter<string[]>();
  @Output() undo = new EventEmitter<void>();
  @Output() redo = new EventEmitter<void>();
  @Input() canUndo = false;
  /** Sticky notes (the page's objects); a new list is emitted when one is added or removed. */
  @Input() notes: AgentNote[] = [];
  @Output() notesChange = new EventEmitter<AgentNote[]>();
  @Input() canRedo = false;
  /** Move `stepId` to run right after `afterId` ('start' = first). */
  @Output() reorder = new EventEmitter<{ stepId: string; afterId: string }>();
  /** Positions changed (steps only; the other nodes are placed around them). */
  @Output() moved = new EventEmitter<{ id: string; x: number; y: number }[]>();
  @Output() changed = new EventEmitter<void>();
  /** A tool dragged from the palette: '<agent>:<action>'. */
  @Output() addTool = new EventEmitter<string>();
  /** Remove a tool from the agent: '<agent>:<action>'. */
  @Output() removeTool = new EventEmitter<string>();

  palette: PaletteGroup[] = [];
  readonly ruleOps = Object.entries(OP_TEXT).map(([value, label]) => ({ value, label }));
  /** Nodes palette / Properties panel folded to a strip. */
  paletteCollapsed = false;
  propertiesCollapsed = false;
  /** The framework keeps Built-in Tools folded by default. */
  collapsed = new Set<string>(['Built-in Tools']);

  nodes: CanvasNode[] = [];
  connections: CanvasConnection[] = [];
  selectedId: string | null = null;
  /** Set when links go round in a circle (the run would be refused). */
  loopNote = '';
  /** What would stop the agent running as drawn; id = the node to select (null = the agent as a whole). */
  issues: { id: string | null; text: string }[] = [];
  showIssues = false;
  /** Remove from agent asks for a second click. */
  confirmRemoveTool = false;

  @ViewChild(FCanvasComponent) private fCanvas?: FCanvasComponent;
  @ViewChild(FFlowComponent) private fFlow?: FFlowComponent;
  // Zoom through the directive: FCanvasComponent.setScale / resetScale change the model without redrawing.
  @ViewChild(FZoomDirective) private fZoom?: FZoomDirective;

  // ── Tool node (REST call) ─────────────────────────────────────────────────
  readonly methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
  readonly paramTypes = ['str', 'int', 'float', 'bool', 'list', 'dict'] as const;
  /** Try it: sample values per parameter, and the last result. */
  tryArgs: Record<string, string> = {};
  tryResult: { ok: boolean; text: string } | null = null;
  trying = false;

  /** The custom tool behind the selected tool node, if it is one. */
  get selectedCustomTool(): AgentCustomTool | undefined {
    const id = this.selectedId ?? '';
    return id.startsWith('tool:api:') ? this.customTools.find(t => t.name === id.slice(9)) : undefined;
  }

  renameSelectedTool(name: string): void {
    const tool = this.selectedCustomTool;
    const to = name.trim();
    if (!tool || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(to) || this.customTools.some(t => t !== tool && t.name === to)) return;
    const from = tool.name;
    tool.name = to;
    this.selectedId = 'tool:api:' + to;
    this.renameTool.emit({ from, to });
  }

  toolChanged(): void { this.changed.emit(); this.cdr.markForCheck(); }

  constructor(private readonly cdr: ChangeDetectorRef, private readonly agentsApi: AgentsService,
              private readonly host: ElementRef<HTMLElement>) {}

  /**
   * Foblex measures node ports when it draws; when the canvas area changes size (Test panel or Properties folded,
   * window resized) the links stayed where the ports used to be. Redraw them on every resize.
   */
  private resize?: ResizeObserver;
  private resizeFrame = 0;

  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resize = new ResizeObserver(() => {
      cancelAnimationFrame(this.resizeFrame);
      this.resizeFrame = requestAnimationFrame(() => this.fFlow?.redraw());
    });
    this.resize.observe(this.host.nativeElement);
  }

  ngOnDestroy(): void { this.resize?.disconnect(); cancelAnimationFrame(this.resizeFrame); }

  tryTool(tool: AgentCustomTool): void {
    const args: Record<string, unknown> = {};
    for (const p of tool.parameters) {
      const raw = this.tryArgs[p.name];
      if (raw === undefined || raw === '') continue;
      args[p.name] = p.type === 'int' || p.type === 'float' ? Number(raw) : p.type === 'bool' ? raw === 'true'
        : p.type === 'list' || p.type === 'dict' ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : raw;
    }
    this.trying = true;
    this.tryResult = null;
    this.agentsApi.tryTool({ ...tool, authSecret: tool.authSecret || null }, args, this.agentId).subscribe({
      next: r => { this.trying = false; this.tryResult = { ok: r.status < 400, text: `HTTP ${r.status}\n${r.result}` }; this.cdr.markForCheck(); },
      error: err => {
        this.trying = false;
        const e = err?.error;
        this.tryResult = { ok: false, text: e?.message ?? (e?.errors ? Object.values(e.errors).flat().join(' ') : 'The call failed.') };
        this.cdr.markForCheck();
      },
    });
  }

  /** Open with every node in view, never zoomed past 100%, so the nodes stay readable. */
  onRendered(): void { this.fit(); }

  fit(): void { this.fCanvas?.fitToScreen({ x: 60, y: 60 }, false, false, 1); }

  zoomIn(): void { this.fZoom?.zoomIn(); }

  zoomOut(): void { this.fZoom?.zoomOut(); }

  actualSize(): void { this.fZoom?.reset(); }

  ngOnChanges(): void { this.build(); this.buildPalette(); }

  private buildPalette(): void {
    const soon = 'Coming soon';
    // The AgenticUIFramework's palette for LangGraph: same groups, order, names and descriptions.
    const builtin = (label: string, description: string, id: string, section: string) =>
      this.availableTools.some(t => t.id === id) ? { label, description, section, data: 'tool:' + id }
        : { label, description, section, note: 'Needs the latest agent runtime' };
    const evaluator = builtin('Evaluator', 'Checks the latest answer against criteria; on fail the run goes back to an earlier step.',
      'evaluator:check', 'Quality');
    const approval = builtin('Human Approval', 'Pauses the run so a person can approve, edit or reject the latest answer.',
      'approval:review', 'Human-in-the-loop');
    const exitLoop = builtin('Exit Loop', 'Lets an agent inside a LoopAgent escalate and break out of the loop.', 'exit_loop:check', 'Loop control');
    this.palette = [
      // The framework's built-ins for LangGraph, run on the tenant's model (Google Search is not offered).
      { label: 'Built-in Tools', items: [
        builtin('URL Context', 'Fetches and summarizes URLs supplied in the prompt.', 'url_context:read', 'Search'),
        builtin('Load Memory', 'Reads relevant facts from the long-term memory bank into the prompt.', 'load_memory:search', 'Memory'),
        builtin('Preload Memory', 'Injects all stored memories as context. Useful for small memory banks.', 'preload_memory:all', 'Memory'),
        this.type === 'loop' ? exitLoop : { ...exitLoop, data: undefined, note: 'Loop agents only' },
        this.type !== 'parallel' ? approval : { ...approval, data: undefined, note: 'Not in Parallel agents' },
        this.routable ? evaluator : { ...evaluator, data: undefined, note: 'Sequential and loop agents only' },
        builtin('Guardrail', 'Checks inputs or the answer for personal data, blocked words or a policy; stops or warns.', 'guardrail:check', 'Quality'),
        builtin('Compute', 'A template, a JSON field or arithmetic over earlier answers. No AI call.', 'compute:run', 'Data'),
        builtin('Merge', 'Joins earlier answers under headings. No AI call.', 'merge:join', 'Data'),
      ] },
      { label: 'Flow', items: [
        // One entry and one exit per graph: dropping these selects the existing node.
        { label: 'Trigger', description: 'Workflow entry point — accepts the user query', data: 'trigger' },
        { label: 'Output', description: 'Final result destination', data: 'output' },
        this.routable
          ? { label: 'Conditional', description: 'Routes to one of its branches, by rules or by AI', data: 'router' }
          : { label: 'Conditional', description: 'Routes to one of its branches, by rules or by AI', note: 'Sequential and loop agents only' },
      ] },
      { label: 'Agents', items: [
        { label: 'Agent', description: 'An LLM agent with a role, goal, and tools', data: 'step' },
        { label: 'Task', description: 'A unit of work assigned to an agent', data: 'step' },
      ] },
      { label: 'Tools', items: [
        { label: 'Tool', description: 'A callable function available to agents', data: 'newtool' },
      ] },
      { label: 'RAG', items: [
        { label: 'Document Loader', description: 'Loads documents from text / web / file / PDF / CSV', note: soon },
        { label: 'Text Splitter', description: 'Chunks documents into smaller pieces for indexing', note: soon },
        { label: 'Embedder', description: 'Embedding model used to vectorize documents and queries', note: soon },
        { label: 'Vector Store', description: 'Embedded document store — backs retrievers', note: soon },
        { label: 'Retriever', description: 'Tool that returns top-k chunks from a vector store', note: soon },
      ] },
      { label: 'Annotations', items: [{ label: 'Sticky Note', description: 'Free-form annotation — never appears in generated code', data: 'note' }] },
    ];
  }

  toggleGroup(label: string): void {
    if (this.collapsed.has(label)) this.collapsed.delete(label); else this.collapsed.add(label);
  }

  get selectedStep(): CanvasStep | undefined { return this.steps.find(s => s.id === this.selectedId); }

  /**
   * Steps keep their saved position; others are placed for the agent type (a row for sequential / loop, a column for
   * parallel / supervisor). Start, Answer, the supervisor or loop check, and the tools sit around them.
   */
  build(): void {
    const column = this.type === 'parallel' || this.type === 'supervisor';
    const baseX = column ? STEP_GAP * 2 : STEP_GAP;
    const steps = this.steps.map((s, i) => ({
      s, position: { x: s.x ?? (column ? baseX : STEP_GAP * (i + 1)), y: s.y ?? (column ? ROW_Y + (i - (this.steps.length - 1) / 2) * 120 : ROW_Y) },
    }));
    const first = steps[0]?.position ?? { x: baseX, y: ROW_Y };
    const last = steps[steps.length - 1]?.position ?? first;
    const ids = this.steps.map(s => s.id ?? '');
    const flow = (from: string, to: string, back = false): CanvasConnection =>
      ({ id: `flow:${from}:${to}`, source: `${from}:out`, target: `${to}:in`, uses: false, back });

    const start: CanvasNode = { id: 'start', kind: 'start', title: 'Trigger', detail: this.inputs.length ? 'Inputs: ' + this.inputs.join(', ') : 'Manual run',
      position: { x: (column ? baseX - STEP_GAP * (this.type === 'supervisor' ? 2 : 1) : first.x - STEP_GAP), y: column ? ROW_Y : first.y } };
    const answer: CanvasNode = { id: 'answer', kind: 'answer', title: 'Output', detail: steps.length > 1 ? 'Combines the step answers' : 'The step answer',
      // Right of the rightmost step: with routers the last step in the list is not always the furthest right.
      position: { x: (column ? baseX + STEP_GAP : Math.max(last.x, ...steps.map(p => p.position.x)) + STEP_GAP), y: column ? ROW_Y : last.y } };
    const extra: CanvasNode[] = [];
    let links: CanvasConnection[];

    if (this.type === 'parallel') {
      links = [...ids.map(id => flow('start', id)), ...ids.map(id => flow(id, 'answer'))];
    } else if (this.type === 'supervisor') {
      extra.push({ id: 'supervisor', kind: 'supervisor', title: 'Supervisor', detail: `Picks the next instruction, up to ${this.maxIterations} rounds`,
        position: { x: baseX - STEP_GAP, y: ROW_Y } });
      answer.position = { x: baseX - STEP_GAP, y: ROW_Y + Math.max(160, steps.length * 70) };
      links = [flow('start', 'supervisor'), ...ids.map(id => flow('supervisor', id)), ...ids.map(id => flow(id, 'supervisor', true)), flow('supervisor', 'answer')];
    } else {
      // A step goes to its link, else the following step; a router has one way out per branch (unwired = the end).
      const end = this.type === 'loop' ? 'check' : 'answer';
      const to = (t?: string | null) => !t || t === 'answer' ? end : t;
      links = ids.length ? [flow('start', ids[0])] : [];
      this.steps.forEach((s, i) => {
        if (s.kind === 'router') {
          for (const b of s.branches ?? []) links.push({ id: `flow:${ids[i]}:${b.id}`, source: `${ids[i]}:br:${b.id}`, target: `${to(b.target)}:in`, uses: false });
        } else links.push(flow(ids[i], s.next ? to(s.next) : ids[i + 1] ?? end));
      });
      this.markLoops(links);
      if (this.type === 'loop' && ids.length) {
        extra.push({ id: 'check', kind: 'check', title: 'Goal met?', detail: `Repeats up to ${this.maxIterations} times`,
          position: { x: last.x, y: last.y + 160 } });
        links.push(flow('check', ids[0], true), flow('check', 'answer'));
      }
    }

    this.nodes = [
      start,
      ...steps.map(({ s, position }, i): CanvasNode => s.kind === 'router'
        ? { id: s.id ?? '', kind: 'router', title: s.routeBy === 'ai' ? 'Conditional (AI)' : 'Conditional', detail: s.value || '(empty)', position,
            branches: (s.branches ?? []).map(b => ({ port: `${s.id}:br:${b.id}`, label: this.branchLabel(b) })) }
        : { id: s.id ?? '', kind: 'step', title: `Instruction ${i + 1}`, detail: s.value || '(empty)', position }),
      ...extra,
      answer,
      ...this.tools.map((t, i) => ({
        id: 'tool:' + t.id, kind: 'tool' as const, title: t.label, detail: 'Tool',
        position: { x: (column ? baseX + STEP_GAP : first.x) + i * STEP_GAP, y: (column ? Math.min(...steps.map(x => x.position.y), ROW_Y) : first.y) - 170 },
      })),
    ];
    this.connections = [
      ...links,
      // Each instruction is linked to the tool it runs with (its own, else the agent's first).
      ...this.steps.filter(s => s.kind !== 'router' && this.tools.some(t => t.id === this.toolOf(s)))
        .map(s => ({ id: `uses:${s.id}`, source: `tool:${this.toolOf(s)}:out`, target: `${s.id}:tool`, uses: true })),
    ];
    this.checkIssues(links);
  }

  /** The same rules the API and the runtime apply, shown before saving or testing. */
  private checkIssues(links: CanvasConnection[]): void {
    const issues: { id: string | null; text: string }[] = [];
    const label = (s: CanvasStep) => `${s.kind === 'router' ? 'Conditional' : 'Instruction'} ${this.steps.indexOf(s) + 1}`;
    if (!this.tools.length) issues.push({ id: null, text: 'The agent has no tool. Add one under Tools & Capabilities or drag one in.' });
    const keys = this.steps.filter(s => s.outputKey).map(s => s.outputKey!);
    for (const s of this.steps) {
      if (!s.value.trim()) issues.push({ id: s.id ?? null, text: `${label(s)} is empty.` });
      const known = new Set([...this.inputs, ...keys.filter(k => k !== s.outputKey)]);
      for (const m of s.value.matchAll(/\{\{\s*(\w+)\s*\}\}/g))
        if (!known.has(m[1]) && !(m[1] === 'item' && s.forEach)) issues.push({ id: s.id ?? null, text: `${label(s)} uses {{${m[1]}}}, which is not an input or an output key.` });
      if (s.outputKey && (keys.filter(k => k === s.outputKey).length > 1 || this.inputs.includes(s.outputKey)))
        issues.push({ id: s.id ?? null, text: `${label(s)}: output key "${s.outputKey}" is used twice or is an input name.` });
      if (s.kind === 'router') {
        if (!this.routable) issues.push({ id: s.id ?? null, text: `${label(s)}: conditionals work in Sequential and Loop agents only.` });
        if (!s.branches?.length) issues.push({ id: s.id ?? null, text: `${label(s)} has no branches.` });
        for (const b of s.branches ?? []) {
          if (b.op === 'else') continue;
          if (s.routeBy === 'ai' ? !b.label?.trim() : (!['empty', 'not_empty'].includes(b.op) && !b.value?.trim()))
            issues.push({ id: s.id ?? null, text: `${label(s)}: branch "${this.branchLabel(b) || '?'}" needs ${s.routeBy === 'ai' ? 'a name' : 'a value'}.` });
        }
      }
    }
    if (this.routable && this.steps.length) {
      // Steps nothing leads to never run.
      const next = new Map<string, string[]>();
      for (const l of links) next.set(l.source.split(':')[0], [...(next.get(l.source.split(':')[0]) ?? []), l.target.split(':')[0]]);
      const seen = new Set<string>(['start']);
      const queue = ['start'];
      while (queue.length) for (const n of next.get(queue.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
      for (const s of this.steps) if (s.id && !seen.has(s.id)) issues.push({ id: s.id, text: `${label(s)} never runs: nothing leads to it.` });
    }
    for (const s of this.steps) if (s.forEach && !this.listSources(s).includes(s.forEach))
      issues.push({ id: s.id ?? null, text: `${label(s)}: For each uses {{${s.forEach}}}, which is not an input or another step's output key.` });
        if (!this.routable)
      for (const s of this.steps) if (s.kind !== 'router' && this.toolOf(s) === 'evaluator:check')
        issues.push({ id: s.id ?? null, text: `${label(s)} uses an Evaluator, which works in Sequential and Loop agents only.` });
    if (this.type === 'parallel')
      for (const s of this.steps) if (s.kind !== 'router' && this.toolOf(s) === 'approval:review')
        issues.push({ id: s.id ?? null, text: `${label(s)} uses Human Approval, which does not work in Parallel agents.` });
    if (this.type !== 'loop')
      for (const s of this.steps) if (s.kind !== 'router' && this.toolOf(s) === 'exit_loop:check')
        issues.push({ id: s.id ?? null, text: `${label(s)} uses Exit Loop, which works in Loop agents only.` });
    if (this.loopNote) issues.push({ id: null, text: this.loopNote });
    this.issues = issues;
    if (this.panelTab === 'analysis') this.refreshAnalysis();
    if (!issues.length) this.showIssues = false;
  }

  /** Select the node an issue is about and bring it into view. */
  focusIssue(issue: { id: string | null }): void {
    this.showIssues = false;
    if (issue.id) {
      this.selectedId = issue.id;
      this.propertiesCollapsed = false;
      this.fCanvas?.centerGroupOrNode(issue.id, true);
    }
    this.cdr.markForCheck();
  }

  /** Same rule as the runtime: a step's link may not go back (a circle); a Conditional's branch may, up to Max iterations. */
  private markLoops(links: CanvasConnection[]): void {
    this.loopNote = '';
    const out = new Map<string, CanvasConnection[]>();
    for (const l of links) {
      const from = l.source.split(':')[0];
      out.set(from, [...(out.get(from) ?? []), l]);
    }
    const state = new Map<string, number>();   // 1 = on the current path, 2 = done
    const name = (id: string) => {
      const s = this.steps.find(x => x.id === id);
      return s ? `${this.steps.indexOf(s) + 1}. ${s.value.slice(0, 30)}` : id;
    };
    const visit = (n: string) => {
      state.set(n, 1);
      for (const l of out.get(n) ?? []) {
        const to = l.target.split(':')[0];
        if (state.get(to) === 1) {
          l.loop = true;
          if (this.steps.find(x => x.id === n)?.kind === 'router') l.label = `back · up to ${this.maxIterations}×`;
          if (this.steps.find(x => x.id === n)?.kind !== 'router')
            this.loopNote ||= `"${name(n)}" goes back to "${name(to)}", so the steps go round in a circle. Point the link forward, or go back through a Conditional (it repeats at most Max iterations times).`;
        } else if (!state.has(to)) visit(to);
      }
      state.set(n, 2);
    };
    visit('start');
  }

  onCreateNode(e: FCreateNodeEvent<string>): void {
    if (e.data?.startsWith('tool:')) { this.addTool.emit(e.data.slice(5)); this.cdr.markForCheck(); return; }
    if (e.data === 'newtool') { this.newTool.emit(); this.cdr.markForCheck(); return; }
    if (e.data === 'note') { const at = e.dropPosition ?? e.externalItemRect; this.addNote(Math.round(at.x), Math.round(at.y)); return; }
    if (e.data === 'trigger' || e.data === 'output') { this.focusIssue({ id: e.data === 'trigger' ? 'start' : 'answer' }); return; }
    if (e.data !== 'step' && e.data !== 'router') return;
    const at = e.dropPosition ?? e.externalItemRect;
    this.addStep.emit({ x: Math.round(at.x), y: Math.round(at.y), ...(e.data === 'router' ? { kind: 'router' as const } : {}) });
  }

  onMoveNodes(e: FMoveNodesEvent): void {
    for (const n of e.nodes) {
      const note = this.notes.find(x => NOTE + x.id === n.id);
      if (note) { note.x = Math.round(n.position.x); note.y = Math.round(n.position.y); this.changed.emit(); }
    }
    const moves = e.nodes.filter(n => this.steps.some(s => s.id === n.id))
      .map(n => ({ id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) }));
    if (moves.length) this.moved.emit(moves);
    this.cdr.markForCheck();
  }

  /**
   * A branch's output sets where that branch goes. A step's output puts the target right after it, or, once the
   * agent routes (a router or a link exists), links the step to the target so branches can join again.
   */
  onCreateConnection(e: FCreateConnectionEvent): void {
    const target = (e.targetId ?? '').replace(/:in$/, '');
    const valid = (from: string) => target !== from && (target === 'answer' || this.steps.some(s => s.id === target));
    const branch = /^(.+):br:(.+)$/.exec(e.sourceId);
    if (branch) {
      const b = this.steps.find(s => s.id === branch[1])?.branches?.find(x => x.id === branch[2]);
      if (b && valid(branch[1])) { b.target = target; this.edited(); }
    } else if (this.routable) {   // order only matters when steps run one after another
      const from = e.sourceId.replace(/:out$/, '');
      const step = this.steps.find(s => s.id === from);
      if (this.routed && step && valid(from)) { step.next = target; this.edited(); }
      else if (target !== 'answer' && valid(from)) this.reorder.emit({ stepId: target, afterId: from });
    }
    this.cdr.markForCheck();
  }

  /** Routers and step links work where steps run in order. */
  get routable(): boolean { return this.type === 'sequential' || this.type === 'loop'; }

  /** A router or a link exists: connections set where a step goes instead of reordering. */
  get routed(): boolean { return this.steps.some(s => s.kind === 'router' || !!s.next); }

  /** The other steps, for the Go to lists. */
  get targets(): { id: string; label: string }[] {
    return this.steps.filter(s => s.id !== this.selectedId)
      .map(s => ({ id: s.id ?? '', label: `${this.steps.indexOf(s) + 1}. ${s.kind === 'router' ? 'Conditional: ' : ''}${s.value.slice(0, 40)}` }));
  }

  get hasOtherwise(): boolean { return !!this.selectedStep?.branches?.some(b => b.op === 'else'); }

  branchLabel(b: CanvasBranch): string {
    if (b.op === 'else') return 'Otherwise';
    if (b.label?.trim()) return b.label;
    return `${b.input === 'last_answer' ? 'previous answer' : b.input ?? ''} ${OP_TEXT[b.op] ?? b.op} ${b.value ?? ''}`.trim();
  }

  addBranch(otherwise = false): void {
    const step = this.selectedStep;
    if (!step) return;
    const all = step.branches ?? [];
    const rules = all.filter(b => b.op !== 'else');
    const added: CanvasBranch = otherwise ? { id: newBranchId(), label: 'Otherwise', op: 'else' }
      : { id: newBranchId(), label: `Branch ${rules.length + 1}`, input: this.inputs[0] ?? 'last_answer', op: 'equals', value: '' };
    // The fallback stays last: rules are checked in order.
    step.branches = otherwise ? [...all, added] : [...rules, added, ...all.filter(b => b.op === 'else')];
    this.edited();
  }

  removeBranch(id: string): void {
    const step = this.selectedStep;
    if (!step) return;
    step.branches = (step.branches ?? []).filter(b => b.id !== id);
    this.edited();
  }

  setRouteBy(by: 'rules' | 'ai'): void {
    if (this.selectedStep) { this.selectedStep.routeBy = by; this.edited(); }
  }

  setNext(next: string): void {
    if (this.selectedStep) { this.selectedStep.next = next || null; this.edited(); }
  }

  /** Re-draw after an in-place edit (the page shares the step objects). */
  edited(): void { this.build(); this.changed.emit(); this.cdr.markForCheck(); }

  /** Any node can be selected; the Properties panel shows what that kind of node has. */
  onSelection(e: FSelectionChangeEvent): void {
    this.selectedIds = e.nodeIds;
    this.selectedId = e.nodeIds[0] ?? null;
    this.confirmRemoveTool = false;
    this.tryArgs = {};
    this.tryResult = null;
    this.loadMemories();
    if (this.selectedId) this.propertiesCollapsed = false;
    this.cdr.markForCheck();
  }

  get selectedNode(): CanvasNode | undefined { return this.nodes.find(n => n.id === this.selectedId); }

  /** '<agent>:<action>' the step runs with. */
  toolOf(s: CanvasStep): string | undefined { return s.tool ? `${s.tool.agent}:${s.tool.action}` : this.tools[0]?.id; }

  setStepTool(id: string): void {
    const step = this.selectedStep;
    if (!step) return;
    const at = id.indexOf(':');
    // The agent's first tool is the default, so it is stored as "no tool of its own".
    step.tool = !id || id === this.tools[0]?.id ? null : { agent: id.slice(0, at), action: id.slice(at + 1) };
    this.edited();
  }

  /** Ask AI steps run on the tenant's model, so they take a model, temperature and max tokens. */
  // ── Analysis tab ────────────────────────────────────────────────────────────
  panelTab: 'properties' | 'analysis' = 'properties';
  analysis: Analysis | null = null;
  measured: { runs: number; tokens: number; cost: number | null } | null = null;
  /** Token budget per run, kept per agent on this browser. */
  budget: number | null = null;

  showAnalysis(): void {
    this.panelTab = 'analysis';
    const id = this.analysisSource?.().agentId;
    try { const b = localStorage.getItem(`twise.agent-budget.${id ?? 'new'}`); this.budget = b ? Number(b) : null; } catch { this.budget = null; }
    this.refreshAnalysis();
  }

  setBudget(v: number | null): void {
    this.budget = v && v > 0 ? Math.round(v) : null;
    const id = this.analysisSource?.().agentId;
    try { if (this.budget) localStorage.setItem(`twise.agent-budget.${id ?? 'new'}`, String(this.budget)); else localStorage.removeItem(`twise.agent-budget.${id ?? 'new'}`); } catch { /* storage blocked */ }
    this.refreshAnalysis();
  }

  refreshAnalysis(): void {
    const src = this.analysisSource?.();
    if (!src) return;
    this.measured = src.measured;
    this.analysis = analyzeAgent(src.agent, src.catalog, { budget: this.budget, issues: this.issues.map(i => i.text) });
    this.cdr.markForCheck();
  }

  /** The steps with tokens, costliest first (worst case). */
  get costlySteps() { return (this.analysis?.steps ?? []).filter(s => s.calls).sort((a, b) => b.calls * (b.input + b.output) * b.worstRuns - a.calls * (a.input + a.output) * a.worstRuns); }

  scoreClass(v: number, higherIsBetter = true): string {
    const good = higherIsBetter ? v >= 70 : v < 35, bad = higherIsBetter ? v < 45 : v >= 65;
    return good ? 'ac__score--good' : bad ? 'ac__score--bad' : 'ac__score--mid';
  }

  // ── Editing: selection, keyboard, clipboard, command palette ─────────────────
  /** Every selected node (Ctrl/Shift+click, or Shift+drag a box). */
  selectedIds: string[] = [];
  paletteOpen = false;
  paletteQuery = '';
  paletteIndex = 0;
  helpOpen = false;
  private static clipboard: CanvasStep[] = [];

  // ── Sticky notes ──
  readonly noteColors: AgentNote['color'][] = ['yellow', 'blue', 'green', 'pink'];
  readonly notePrefix = NOTE;

  get selectedNotes(): AgentNote[] { return this.notes.filter(n => this.selectedIds.includes(NOTE + n.id)); }

  addNote(x: number, y: number): void {
    this.notesChange.emit([...this.notes, { id: `note-${Math.random().toString(36).slice(2, 10)}`, text: '', x, y, color: 'yellow' }]);
    this.cdr.markForCheck();
  }

  removeNote(id: string): void { this.notesChange.emit(this.notes.filter(n => n.id !== id)); this.cdr.markForCheck(); }

  nextColor(n: AgentNote): void { n.color = this.noteColors[(this.noteColors.indexOf(n.color) + 1) % this.noteColors.length]; this.changed.emit(); }

  /** The selected instructions and conditionals (not Trigger, Output or tools). */
  get selectedSteps(): CanvasStep[] { return this.steps.filter(s => s.id && this.selectedIds.includes(s.id)); }

  readonly commands: { id: string; label: string; keys: string; run: () => void; on?: () => boolean }[] = [
    { id: 'add', label: 'Add an instruction', keys: 'A', run: () => this.addStep.emit(this.freeSpot()) },
    { id: 'note', label: 'Add a sticky note', keys: 'N', run: () => this.addNote(Math.min(...this.nodes.map(n => n.position.x)), Math.min(...this.nodes.map(n => n.position.y)) - 160) },   // above the graph
    { id: 'router', label: 'Add a conditional', keys: 'Shift+A', run: () => this.routable && this.addStep.emit({ ...this.freeSpot(), kind: 'router' }), on: () => this.routable },
    { id: 'dup', label: 'Duplicate the selection', keys: 'Ctrl+D', run: () => this.duplicateSelected(), on: () => this.selectedSteps.length > 0 },
    { id: 'copy', label: 'Copy the selection', keys: 'Ctrl+C', run: () => this.copySelected(), on: () => this.selectedSteps.length > 0 },
    { id: 'paste', label: 'Paste', keys: 'Ctrl+V', run: () => this.paste(), on: () => AgentCanvasComponent.clipboard.length > 0 },
    { id: 'del', label: 'Delete the selection', keys: 'Delete', run: () => this.deleteSelection(), on: () => this.selectedSteps.length + this.selectedNotes.length > 0 },
    { id: 'all', label: 'Select all steps', keys: 'Ctrl+A', run: () => this.selectAll() },
    { id: 'undo', label: 'Undo', keys: 'Ctrl+Z', run: () => this.undo.emit(), on: () => this.canUndo },
    { id: 'redo', label: 'Redo', keys: 'Ctrl+Y', run: () => this.redo.emit(), on: () => this.canRedo },
    { id: 'fit', label: 'Fit to screen', keys: 'F', run: () => this.fit() },
    { id: 'zin', label: 'Zoom in', keys: '+', run: () => this.zoomIn() },
    { id: 'zout', label: 'Zoom out', keys: '−', run: () => this.zoomOut() },
    { id: 'analysis', label: 'Show the analysis', keys: '', run: () => { this.propertiesCollapsed = false; this.showAnalysis(); } },
    { id: 'issues', label: 'Show the issues', keys: '', run: () => { this.showIssues = this.issues.length > 0; }, on: () => this.issues.length > 0 },
    { id: 'nodes', label: 'Show or hide the Nodes palette', keys: '', run: () => { this.paletteCollapsed = !this.paletteCollapsed; } },
    { id: 'help', label: 'Keyboard shortcuts', keys: '?', run: () => { this.helpOpen = true; } },
  ];

  get paletteCommands() {
    const q = this.paletteQuery.trim().toLowerCase();
    return this.commands.filter(c => (!c.on || c.on()) && (!q || c.label.toLowerCase().includes(q)));
  }

  openPalette(): void { this.paletteOpen = true; this.paletteQuery = ''; this.paletteIndex = 0; this.cdr.markForCheck(); }

  runCommand(c: { run: () => void }): void {
    this.paletteOpen = false;
    c.run();
    this.cdr.markForCheck();
  }

  paletteKey(e: KeyboardEvent): void {
    const list = this.paletteCommands;
    if (e.key === 'ArrowDown') { this.paletteIndex = Math.min(this.paletteIndex + 1, list.length - 1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { this.paletteIndex = Math.max(this.paletteIndex - 1, 0); e.preventDefault(); }
    else if (e.key === 'Enter' && list[this.paletteIndex]) { this.runCommand(list[this.paletteIndex]); e.preventDefault(); }
    else if (e.key === 'Escape') { this.paletteOpen = false; e.preventDefault(); }
  }

  /** Shortcuts on the canvas; typing in a field keeps its own keys. */
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    const el = e.target as HTMLElement | null;
    const typing = !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (mod && key === 'k') { this.paletteOpen ? (this.paletteOpen = false) : this.openPalette(); e.preventDefault(); return; }
    if (e.key === 'Escape') { this.paletteOpen = this.helpOpen = false; this.clearSelection(); return; }
    if (typing || this.paletteOpen) return;
    const run = (id: string) => { const c = this.commands.find(x => x.id === id)!; if (!c.on || c.on()) c.run(); e.preventDefault(); this.cdr.markForCheck(); };
    if (mod && key === 'z' && !e.shiftKey) run('undo');
    else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) run('redo');
    else if (mod && key === 'd') run('dup');
    else if (mod && key === 'c') run('copy');
    else if (mod && key === 'v') run('paste');
    else if (mod && key === 'a') run('all');
    else if (mod) return;
    else if (e.key === 'Delete' || e.key === 'Backspace') run('del');
    else if (key === 'f') run('fit');
    else if (e.key === '+' || e.key === '=') run('zin');
    else if (e.key === '-') run('zout');
    else if (e.key === '?') run('help');
    else if (key === 'a') run(e.shiftKey ? 'router' : 'add');
    else if (key === 'n') run('note');
  }

  /** Below the lowest step, so a new one does not land on another. */
  private freeSpot(): { x: number; y: number } {
    const ys = this.steps.map(s => s.y ?? 0);
    return { x: Math.min(...this.steps.map(s => s.x ?? 0), 260), y: (ys.length ? Math.max(...ys) : 0) + 140 };
  }

  copySelected(): void {
    AgentCanvasComponent.clipboard = structuredClone(this.selectedSteps);
  }

  paste(): void {
    if (!AgentCanvasComponent.clipboard.length) return;
    this.insert(cloneSteps(AgentCanvasComponent.clipboard, this.outputKeys()));
  }

  duplicateSelected(): void {
    if (this.selectedSteps.length) this.insert(cloneSteps(this.selectedSteps, this.outputKeys()));
  }

  private outputKeys(): Set<string> {
    return new Set([...this.inputs, ...this.steps.map(s => s.outputKey).filter((k): k is string => !!k)]);
  }

  /** Adds the copies and selects them once they are drawn. */
  private insert(copies: CanvasStep[]): void {
    this.insertSteps.emit(copies);
    const ids = copies.map(c => c.id!);
    setTimeout(() => { this.fFlow?.select(ids, []); this.selectedIds = ids; this.selectedId = ids[0] ?? null; this.cdr.markForCheck(); }, 120);
  }

  deleteSelection(): void {
    const ids = this.selectedSteps.map(s => s.id!);
    const notes = this.selectedNotes;
    if (!ids.length && !notes.length) return;
    if (notes.length) this.notesChange.emit(this.notes.filter(n => !notes.includes(n)));
    if (ids.length) this.removeSteps.emit(ids);
    this.clearSelection();
  }

  selectAll(): void {
    const ids = this.steps.map(s => s.id!).filter(Boolean);
    this.fFlow?.select(ids, []);
    this.selectedIds = ids;
    this.selectedId = ids[0] ?? null;
  }

  private clearSelection(): void {
    this.fFlow?.clearSelection();
    this.selectedIds = [];
    this.selectedId = null;
    this.cdr.markForCheck();
  }

  /** A setting of the selected Evaluator / Guardrail / Compute / Merge step. */
  option(name: string): unknown { return this.selectedStep?.options?.[name]; }

  setOption(name: string, value: unknown): void {
    const step = this.selectedStep;
    if (!step) return;
    const next = { ...(step.options ?? {}) };
    if (value === '' || value === null || value === undefined) delete next[name]; else next[name] = value;
    step.options = Object.keys(next).length ? next : null;
    this.changed.emit();
  }

  /** The steps before the selected one (where an Evaluator may send the run back). */
  get earlierSteps(): CanvasStep[] {
    const at = this.steps.findIndex(s => s === this.selectedStep);
    return at > 0 ? this.steps.slice(0, at).filter(s => s.kind !== 'router') : [];
  }

  /** For Each sources: the inputs and the other steps' output keys. */
  listSources(s: CanvasStep): string[] {
    return [...this.inputs, ...this.steps.filter(o => o !== s && o.outputKey).map(o => o.outputKey!)];
  }

  takesModel(s: CanvasStep): boolean { return MODEL_TOOLS.includes((this.toolOf(s) ?? '').split(':')[0]); }

  /** The built-in behind a tool node id ("tool:<agent>:<action>"). */
  builtinOf(nodeId: string): string { return nodeId.split(':')[1] ?? ''; }

  // ── Memory (Load / Preload Memory nodes) ─────────────────────────────────
  memories: AgentMemory[] | null = null;
  memoryError = '';

  private loadMemories(): void {
    this.memories = null;
    this.memoryError = '';
    const kind = this.builtinOf(this.selectedId ?? '');
    if (!this.selectedId?.startsWith('tool:') || (kind !== 'load_memory' && kind !== 'preload_memory') || !this.agentId) return;
    this.agentsApi.memories(this.agentId).subscribe({
      next: m => { this.memories = m; this.cdr.markForCheck(); },
      error: () => { this.memoryError = 'Could not load the memories. Restart the Tenant API if it was just updated.'; this.cdr.markForCheck(); },
    });
  }

  forget(memoryId?: number): void {
    if (!this.agentId) return;
    this.agentsApi.forgetMemory(this.agentId, memoryId).subscribe({
      next: () => { this.memories = memoryId ? (this.memories ?? []).filter(m => m.id !== memoryId) : []; this.cdr.markForCheck(); },
      error: () => { this.memoryError = 'Could not forget it.'; this.cdr.markForCheck(); },
    });
  }

  /** Set one agent field on the selected step ('' / null clears it). */
  setField(field: 'expectedOutput' | 'outputKey' | 'model' | 'temperature' | 'maxTokens' | 'forEach' | 'retries', value: string | number | null): void {
    const step = this.selectedStep;
    if (!step) return;
    (step as unknown as Record<string, unknown>)[field] = value === '' || value === undefined ? null : value;
    this.changed.emit();
  }

  /** The instructions that run with a tool node's tool. */
  usersOf(toolId: string): string[] {
    return this.steps.filter(s => s.kind !== 'router' && this.toolOf(s) === toolId).map(s => `${this.steps.indexOf(s) + 1}. ${s.value.slice(0, 40)}`);
  }

  removeSelectedTool(): void {
    const id = this.selectedId?.replace(/^tool:/, '');
    if (!id) return;
    if (!this.confirmRemoveTool) { this.confirmRemoveTool = true; return; }
    this.confirmRemoveTool = false;
    this.removeTool.emit(id);
    this.selectedId = null;
  }

  setMaxIterations(value: number): void {
    const n = Math.min(20, Math.max(1, Math.round(Number(value) || 1)));
    this.maxIterations = n;
    this.maxIterationsChange.emit(n);
    this.build();
  }

  editSelected(text: string): void {
    const step = this.selectedStep;
    if (!step) return;
    step.value = text;
    this.build();
    this.changed.emit();
  }

  readonly sqlPlaceholder = 'SELECT col FROM schema.table\nWHERE other = {{input}}';

  /** The step runs with Saved SQL (sql_query), so Properties shows its SQL. */
  isSqlStep(s: CanvasStep): boolean { return this.toolOf(s)?.startsWith('sql_query:') ?? false; }

  editSql(sql: string): void {
    const step = this.selectedStep;
    if (!step) return;
    step.sql = sql;
    this.changed.emit();
  }

  deleteSelected(): void {
    if (!this.selectedId) return;
    this.removeStep.emit(this.selectedId);
    this.selectedId = null;
  }

  trackById(_: number, x: { id: string }): string { return x.id; }
}
