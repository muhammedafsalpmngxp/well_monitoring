import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AiDataset, AiRelation, AiRelationNode, AiRelationStatus, AiService, AiSourceType } from '../../../core/services/ai.service';

interface GraphNode extends AiRelationNode { key: string; x: number; y: number }
interface GraphLink { rel: AiRelation; x1: number; y1: number; x2: number; y2: number }

/**
 * Admin page: the relationship graph between datasets. A scan finds columns two datasets share
 * (same name, overlapping values); the admin confirms or rejects each link or draws one by hand.
 * Confirmed links are told to the AI so it can point to the dataset that has what a question asks.
 */
@Component({
  selector: 'app-ai-relations',
  standalone: false,
  templateUrl: './ai-relations.component.html',
  styleUrls: ['../ai-settings/ai-settings.component.scss', './ai-relations.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiRelationsComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  readonly breadcrumbs = [{ label: 'Home' }, { label: 'AI Settings', route: '/settings/ai' }, { label: 'AI Relationships' }];
  readonly size = 520;

  datasets: AiDataset[] = [];
  nodes: GraphNode[] = [];
  links: GraphLink[] = [];
  relations: AiRelation[] = [];
  filter: AiRelationStatus | 'all' = 'all';
  loading = true;
  error = '';
  message = '';
  /** Scan: which datasets to include (empty = first 40) and the in-flight flag. */
  showScan = false;
  scanSelection = new Set<string>();
  scanning = false;
  busyId: number | null = null;
  /** Manual link form. */
  showAdd = false;
  add = { from: '', fromColumn: '', to: '', toColumn: '' };
  fromColumns: string[] = [];
  toColumns: string[] = [];
  adding = false;

  constructor(private readonly ai: AiService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.ai.datasets().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: d => { this.datasets = d; this.cdr.markForCheck(); }, error: () => { /* scan list stays empty */ } });
    this.load();
  }

  load(): void {
    this.loading = true; this.error = '';
    this.ai.relations().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: g => { this.relations = g.links; this.layout(g.nodes); this.loading = false; this.cdr.markForCheck(); },
      error: err => { this.error = err?.error?.message ?? 'Relationships could not be loaded.'; this.loading = false; this.cdr.markForCheck(); },
    });
  }

  /** Datasets on a circle; a link is a line between its two datasets, drawn for every status but rejected. */
  private layout(nodes: AiRelationNode[]): void {
    const r = this.size / 2 - 70, cx = this.size / 2, cy = this.size / 2;
    this.nodes = nodes.map((n, i) => {
      const a = (2 * Math.PI * i) / Math.max(nodes.length, 1) - Math.PI / 2;
      return { ...n, key: `${n.sourceType}:${n.sourceId}`, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
    const at = new Map(this.nodes.map(n => [n.key, n]));
    this.links = this.relations.filter(l => l.status !== 'rejected').map(rel => {
      const a = at.get(`${rel.fromType}:${rel.fromId}`)!, b = at.get(`${rel.toType}:${rel.toId}`)!;
      return { rel, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    });
  }

  get shown(): AiRelation[] { return this.filter === 'all' ? this.relations : this.relations.filter(r => r.status === this.filter); }
  count(status: AiRelationStatus): number { return this.relations.filter(r => r.status === status).length; }

  setStatus(r: AiRelation, status: AiRelationStatus): void {
    this.busyId = r.id; this.message = '';
    this.ai.setRelationStatus(r.id, status).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.busyId = null; this.load(); },
      error: err => { this.busyId = null; this.message = err?.error?.message ?? 'The link could not be updated.'; this.cdr.markForCheck(); },
    });
  }

  remove(r: AiRelation): void {
    this.busyId = r.id; this.message = '';
    this.ai.deleteRelation(r.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.busyId = null; this.load(); },
      error: () => { this.busyId = null; this.message = 'The link could not be deleted.'; this.cdr.markForCheck(); },
    });
  }

  toggleScanAll(on: boolean): void {
    this.scanSelection = new Set(on ? this.datasets.map(d => `${d.sourceType}:${d.sourceId}`) : []);
  }
  toggleScan(key: string): void { this.scanSelection.has(key) ? this.scanSelection.delete(key) : this.scanSelection.add(key); }

  scan(): void {
    this.scanning = true; this.message = '';
    this.ai.detectRelations([...this.scanSelection]).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: s => {
        this.scanning = false; this.showScan = false;
        this.message = `${s.datasetsScanned} datasets scanned, ${s.suggested} link${s.suggested === 1 ? '' : 's'} suggested` +
          (s.skipped.length ? ` (could not load: ${s.skipped.join(', ')})` : '') + '.';
        this.load();
      },
      error: err => { this.scanning = false; this.message = err?.error?.message ?? err?.error?.errors?.[0]?.message ?? 'The scan failed.'; this.cdr.markForCheck(); },
    });
  }

  pickDataset(side: 'from' | 'to'): void {
    const key = this.add[side];
    const [type, id] = key.split(':');
    if (side === 'from') { this.fromColumns = []; this.add.fromColumn = ''; } else { this.toColumns = []; this.add.toColumn = ''; }
    if (!key) return;
    this.ai.datasetColumns(type as AiSourceType, +id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: c => { if (side === 'from') this.fromColumns = c; else this.toColumns = c; this.cdr.markForCheck(); },
      error: () => { /* the admin can still type the column */ },
    });
  }

  addRelation(): void {
    const [ft, fi] = this.add.from.split(':'), [tt, ti] = this.add.to.split(':');
    this.adding = true; this.message = '';
    this.ai.addRelation({ fromType: ft as AiSourceType, fromId: +fi, fromColumn: this.add.fromColumn, toType: tt as AiSourceType, toId: +ti, toColumn: this.add.toColumn })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.adding = false; this.showAdd = false; this.add = { from: '', fromColumn: '', to: '', toColumn: '' }; this.load(); },
        error: err => { this.adding = false; this.message = err?.error?.message ?? err?.error?.errors?.[0]?.message ?? 'The link could not be added.'; this.cdr.markForCheck(); },
      });
  }

  get canAdd(): boolean { return !!this.add.from && !!this.add.to && this.add.from !== this.add.to && !!this.add.fromColumn.trim() && !!this.add.toColumn.trim(); }
  trackByKey(_: number, n: GraphNode): string { return n.key; }
  trackById(_: number, r: AiRelation): number { return r.id; }
}
