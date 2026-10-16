import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  FCanvasComponent, FCreateConnectionEvent, FCreateNodeEvent, FFlowComponent, FFlowModule, FMoveNodesEvent, FSelectionChangeEvent, FZoomDirective,
} from '@foblex/flow';

/** An instruction as the canvas sees it: the New Agent page's own item (same object, so both views edit one agent). */
/** id is always set by the page before the canvas opens (see NewAgentComponent.setView). */
export interface CanvasBranch { id: string; label?: string | null; input?: string | null; op: string; value?: string | null; target?: string | null; }
export interface CanvasStep {
  id?: string; value: string; x?: number; y?: number;
  kind?: 'step' | 'router'; routeBy?: 'rules' | 'ai'; branches?: CanvasBranch[]; next?: string | null;
  /** The step's own tool; null = the agent's first tool. */
  tool?: { agent: string; action: string } | null;
}
export interface CanvasTool { id: string; label: string; }

/**
 * One palette entry, after the AgenticUIFramework's node palette (same groups, names and descriptions).
 * `data` is what a drop creates: 'step' (an instruction) or 'tool:<agent>:<action>'; entries without it are
 * shown as on the canvas already or coming soon.
 */
interface PaletteItem { label: string; description: string; data?: string; note?: string; }
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

interface CanvasConnection { id: string; source: string; target: string; uses: boolean; back?: boolean; loop?: boolean; }

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
  @Output() maxIterationsChange = new EventEmitter<number>();

  /** A new instruction (or router) dropped from the palette at this canvas position. */
  @Output() addStep = new EventEmitter<{ x: number; y: number; kind?: 'router' }>();
  @Output() removeStep = new EventEmitter<string>();
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
  collapsed = new Set<string>();

  nodes: CanvasNode[] = [];
  connections: CanvasConnection[] = [];
  selectedId: string | null = null;
  /** Set when links go round in a circle (the run would be refused). */
  loopNote = '';
  /** Remove from agent asks for a second click. */
  confirmRemoveTool = false;

  @ViewChild(FCanvasComponent) private fCanvas?: FCanvasComponent;
  @ViewChild(FFlowComponent) private fFlow?: FFlowComponent;
  // Zoom through the directive: FCanvasComponent.setScale / resetScale change the model without redrawing.
  @ViewChild(FZoomDirective) private fZoom?: FZoomDirective;

  constructor(private readonly cdr: ChangeDetectorRef, private readonly host: ElementRef<HTMLElement>) {}

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

  /** Open with every node in view, never zoomed past 100%, so the nodes stay readable. */
  onRendered(): void { this.fit(); }

  fit(): void { this.fCanvas?.fitToScreen({ x: 60, y: 60 }, false, false, 1); }

  zoomIn(): void { this.fZoom?.zoomIn(); }

  zoomOut(): void { this.fZoom?.zoomOut(); }

  actualSize(): void { this.fZoom?.reset(); }

  ngOnChanges(): void { this.build(); this.buildPalette(); }

  private buildPalette(): void {
    const soon = 'Coming soon';
    this.palette = [
      { label: 'Flow', items: [
        { label: 'Trigger', description: 'Workflow entry point: accepts the user query', note: 'On the canvas (Start)' },
        { label: 'Output', description: 'Final result destination', note: 'On the canvas (Answer)' },
        this.routable
          ? { label: 'Router', description: 'Picks one branch, by rules or by AI, and goes to its step', data: 'router' }
          : { label: 'Router', description: 'Picks one branch, by rules or by AI', note: 'Sequential and loop agents only' },
      ] },
      { label: 'Agents', items: [
        { label: 'Agent', description: 'An LLM step with the agent\'s role and goal, run with its tool', data: 'step' },
        { label: 'Task', description: 'A unit of work; here an agent step and its task are one instruction', data: 'step' },
      ] },
      { label: 'Tools', items: this.availableTools.map(t => ({
        label: t.label, data: 'tool:' + t.id,
        description: this.tools.some(x => x.id === t.id) ? 'Already added to this agent' : 'Drag onto the canvas to add it to this agent',
      })) },
      { label: 'RAG', items: ['Document Loader', 'Text Splitter', 'Embedder', 'Vector Store', 'Retriever'].map(label =>
        ({ label, description: 'Knowledge sources for the agent', note: soon })) },
      { label: 'Integrations', items: [{ label: 'MCP Toolset', description: 'Model Context Protocol toolset', note: soon }] },
      { label: 'Annotations', items: [{ label: 'Sticky Note', description: 'Free-form note on the canvas', note: soon }] },
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

    const start: CanvasNode = { id: 'start', kind: 'start', title: 'Start', detail: this.inputs.length ? 'Inputs: ' + this.inputs.join(', ') : 'Manual run',
      position: { x: (column ? baseX - STEP_GAP * (this.type === 'supervisor' ? 2 : 1) : first.x - STEP_GAP), y: column ? ROW_Y : first.y } };
    const answer: CanvasNode = { id: 'answer', kind: 'answer', title: 'Answer', detail: steps.length > 1 ? 'Combines the step answers' : 'The step answer',
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
        ? { id: s.id ?? '', kind: 'router', title: s.routeBy === 'ai' ? 'Router (AI)' : 'Router', detail: s.value || '(empty)', position,
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
  }

  /** Same rule as the runtime: within a run a step is reached at most once. Marks the links that close a circle. */
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
          this.loopNote ||= `"${name(n)}" goes back to "${name(to)}", so the steps go round in a circle. Point the link forward or to the Answer.`;
        } else if (!state.has(to)) visit(to);
      }
      state.set(n, 2);
    };
    visit('start');
  }

  onCreateNode(e: FCreateNodeEvent<string>): void {
    if (e.data?.startsWith('tool:')) { this.addTool.emit(e.data.slice(5)); this.cdr.markForCheck(); return; }
    if (e.data !== 'step' && e.data !== 'router') return;
    const at = e.dropPosition ?? e.externalItemRect;
    this.addStep.emit({ x: Math.round(at.x), y: Math.round(at.y), ...(e.data === 'router' ? { kind: 'router' as const } : {}) });
  }

  onMoveNodes(e: FMoveNodesEvent): void {
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
      .map(s => ({ id: s.id ?? '', label: `${this.steps.indexOf(s) + 1}. ${s.kind === 'router' ? 'Router: ' : ''}${s.value.slice(0, 40)}` }));
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
    this.selectedId = e.nodeIds[0] ?? null;
    this.confirmRemoveTool = false;
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

  deleteSelected(): void {
    if (!this.selectedId) return;
    this.removeStep.emit(this.selectedId);
    this.selectedId = null;
  }

  trackById(_: number, x: { id: string }): string { return x.id; }
}
