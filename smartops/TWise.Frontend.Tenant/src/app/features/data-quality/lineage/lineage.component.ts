import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { GovernanceService, LineageEdge, LineageKind, LineageNode } from '../../../core/services/governance.service';

interface PlacedNode extends LineageNode {
  x: number;
  y: number;
}

interface PlacedEdge extends LineageEdge {
  path: string;
}

const NODE_W = 210;
const NODE_H = 46;
const ROW_GAP = 14;
const COL_GAP = 130;
const PAD = 24;

/** Column each kind is drawn in: sources → datasets → charts → consumers. */
const LAYER: Record<LineageKind, number> = {
  source: 0, db: 0,
  import: 1, view: 1, table: 1,
  chart: 2,
  dashboard: 3, report: 3,
};

export const LAYER_TITLES = ['Sources', 'Datasets', 'Charts & tiles', 'Dashboards & reports'];

/**
 * Lineage graph: where every dashboard's numbers come from. The server derives the graph from the
 * pointers that already exist (connection → view, import → chart, chart → dashboard…); this page
 * lays it out in four columns and lets the user trace one node up- and downstream.
 */
@Component({
  selector: 'app-lineage',
  standalone: false,
  templateUrl: './lineage.component.html',
  styleUrls: ['./lineage.component.scss'],
})
export class LineageComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  readonly layerTitles = LAYER_TITLES;
  readonly nodeW = NODE_W;
  readonly nodeH = NODE_H;

  nodes: PlacedNode[] = [];
  edges: PlacedEdge[] = [];
  width = 0;
  height = 0;
  loading = false;
  error = '';
  search = '';

  selected: PlacedNode | null = null;
  /** Ids connected to the selected node in either direction, including itself. */
  private related = new Set<string>();
  private upstreamIds = new Set<string>();
  private downstreamIds = new Set<string>();

  constructor(private readonly governance: GovernanceService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loading = true;
    this.governance.lineage().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: graph => {
        this.layout(graph.nodes, graph.edges);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Could not load lineage.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  layerX(layer: number): number {
    return PAD + layer * (NODE_W + COL_GAP);
  }

  select(node: PlacedNode | null): void {
    this.selected = node;
    this.related.clear();
    this.upstreamIds = new Set();
    this.downstreamIds = new Set();
    if (!node) return;
    this.upstreamIds = this.walk(node.id, e => e.to, e => e.from);
    this.downstreamIds = this.walk(node.id, e => e.from, e => e.to);
    this.related = new Set([node.id, ...this.upstreamIds, ...this.downstreamIds]);
  }

  get upstream(): PlacedNode[] { return this.nodes.filter(n => this.upstreamIds.has(n.id)); }
  get downstream(): PlacedNode[] { return this.nodes.filter(n => this.downstreamIds.has(n.id)); }

  isDimmed(node: PlacedNode): boolean {
    if (this.selected) return !this.related.has(node.id);
    const q = this.search.trim().toLowerCase();
    return !!q && !node.label.toLowerCase().includes(q);
  }

  isEdgeActive(edge: PlacedEdge): boolean {
    return !!this.selected && this.related.has(edge.from) && this.related.has(edge.to);
  }

  /** Breadth-first over edges, following `next` from nodes that match `match`. */
  private walk(start: string, match: (e: LineageEdge) => string, next: (e: LineageEdge) => string): Set<string> {
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length) {
      const current = queue.shift()!;
      for (const e of this.edges) {
        if (match(e) !== current) continue;
        const other = next(e);
        if (!seen.has(other) && other !== start) { seen.add(other); queue.push(other); }
      }
    }
    return seen;
  }

  private layout(nodes: LineageNode[], edges: LineageEdge[]): void {
    const columns: LineageNode[][] = [[], [], [], []];
    for (const n of nodes) columns[LAYER[n.kind] ?? 1].push(n);
    columns.forEach(c => c.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label)));

    const placed = new Map<string, PlacedNode>();
    columns.forEach((column, layer) => {
      column.forEach((n, row) => {
        placed.set(n.id, { ...n, x: this.layerX(layer), y: PAD + 28 + row * (NODE_H + ROW_GAP) });
      });
    });

    this.nodes = [...placed.values()];
    this.edges = edges
      .filter(e => placed.has(e.from) && placed.has(e.to))
      .map(e => ({ ...e, path: this.curve(placed.get(e.from)!, placed.get(e.to)!) }));

    const rows = Math.max(1, ...columns.map(c => c.length));
    this.width = PAD * 2 + 4 * NODE_W + 3 * COL_GAP;
    this.height = PAD * 2 + 28 + rows * (NODE_H + ROW_GAP);
  }

  private curve(a: PlacedNode, b: PlacedNode): string {
    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
    const x2 = b.x, y2 = b.y + NODE_H / 2;
    if (a.x === b.x) {
      // Same column (a view built on another view): loop out to the right and back.
      const bend = x1 + 40;
      return `M${x1},${y1} C${bend},${y1} ${bend},${y2} ${x1},${y2}`;
    }
    const mid = (x1 + x2) / 2;
    return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
  }
}
