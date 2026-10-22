import { ChangeDetectorRef, Component, DestroyRef, inject, Input, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin, Observable } from 'rxjs';
import { AiDatasetNote, AiExample, AiMetric, AiNoteProposal, AiRelation, AiService, AiTerm, AskDataCatalog } from '../../../../core/services/ai.service';

interface Message { ok: boolean; text: string }
interface TermRow { term: string; synonyms: string; column: string; value: string; meaning: string }
interface NoteRow { column: string; displayName: string; note: string }
interface MetricRow { name: string; agg: string; column: string; description: string }

/** Ask Data's own knowledge has no dataset: it is stored as source askdata, id 0. */
const SOURCE = 'askdata' as const;
/** Column suggestions listed at once; typing narrows the browser's list. */
const COLUMN_LIST_MAX = 5000;

const clean = (s: string | null | undefined) => (s ?? '').trim();
const fullColumn = (s: string) => clean(s).split('.').length === 3 && clean(s).split('.').every(p => !!p);

/** The aggregations a metric can use, as the API accepts them. */
export const METRIC_AGGS: { key: string; label: string }[] = [
  { key: 'count', label: 'Count rows' }, { key: 'countDistinct', label: 'Count distinct' }, { key: 'sum', label: 'Sum' },
  { key: 'avg', label: 'Average' }, { key: 'min', label: 'Minimum' }, { key: 'max', label: 'Maximum' },
];

/**
 * AI Settings → Ask Data & Features → Terms & column names: what Ask Data knows about the company's data.
 * Edited here and saved together: business terms ("NPT"), metrics ("Rig uptime" = SUM of uptime hours) and what
 * columns and tables are called. Reviewed here, one at a time: answers users liked (approved ones guide similar
 * questions), notes the AI suggested from them, and links between tables the database has no foreign key for.
 * Every Ask Data run applies them within 30 seconds of a change.
 */
@Component({
  selector: 'app-ask-data-knowledge',
  standalone: false,
  templateUrl: './ask-data-knowledge.component.html',
  styleUrls: ['../ai-configuration.component.scss', './ask-data-knowledge.component.scss'],
})
export class AskDataKnowledgeComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  /** The Ask Data database's schemas, tables and columns (the column suggestions). */
  @Input() catalog: AskDataCatalog | null = null;

  readonly aggs = METRIC_AGGS;
  terms: TermRow[] = [];
  notes: NoteRow[] = [];
  metrics: MetricRow[] = [];
  examples: AiExample[] = [];
  proposals: AiNoteProposal[] = [];
  links: AiRelation[] = [];
  newLink = { from: '', to: '' };
  loading = true;
  saving = false;
  scanning = false;
  loadError = '';
  message: Message | null = null;
  /** Result of a review action (examples, notes, links), shown under its card. */
  reviewMessage: Message | null = null;
  private saved = '';

  constructor(private readonly ai: AiService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    forkJoin({
      terms: this.ai.terms(SOURCE, 0), notes: this.ai.notes(SOURCE, 0), metrics: this.ai.metrics(SOURCE, 0),
      examples: this.ai.examples(SOURCE, 0), proposals: this.ai.proposals(SOURCE, 0), links: this.ai.askDataLinks(),
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => {
        this.apply(r.terms, r.notes, r.metrics);
        this.examples = r.examples;
        this.proposals = r.proposals;
        this.links = r.links;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: err => { this.loadError = err?.error?.message ?? 'Ask Data\'s knowledge could not be loaded.'; this.loading = false; this.cdr.markForCheck(); },
    });
  }

  /** "schema.table.column" of every column Ask Data can see in the catalog. */
  get columns(): string[] {
    const out: string[] = [];
    for (const s of this.catalog?.schemas ?? [])
      for (const t of s.tables)
        for (const c of t.columns) {
          if (out.length >= COLUMN_LIST_MAX) return out;
          out.push(`${s.name}.${t.name}.${c}`);
        }
    return out;
  }

  /** "schema.table" of every table, for table notes. */
  get tables(): string[] {
    return (this.catalog?.schemas ?? []).flatMap(s => s.tables.map(t => `${s.name}.${t.name}`)).slice(0, COLUMN_LIST_MAX);
  }

  get dirty(): boolean {
    return this.snapshot() !== this.saved;
  }

  get waitingExamples(): number { return this.examples.filter(e => e.status === 'pending').length; }
  get suggestedLinks(): AiRelation[] { return this.links.filter(l => l.status === 'suggested'); }
  get confirmedLinks(): AiRelation[] { return this.links.filter(l => l.status === 'confirmed'); }

  /** What the API would refuse, checked as the admin types. */
  get problems(): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of this.terms) {
      const name = clean(t.term);
      if (!name) { if (clean(t.column) || clean(t.value) || clean(t.meaning)) out.push('Every term needs a name.'); continue; }
      for (const w of [name, ...t.synonyms.split(',').map(clean).filter(Boolean)]) {
        if (seen.has(w.toLowerCase())) out.push(`"${w}" is used by more than one term.`);
        seen.add(w.toLowerCase());
      }
      if (!!clean(t.column) !== !!clean(t.value)) out.push(`Term "${name}": give both a column and a value, or neither.`);
      else if (!clean(t.column) && !clean(t.meaning)) out.push(`Term "${name}": give a column and value, or a meaning.`);
      if (clean(t.column) && !fullColumn(t.column)) out.push(`Term "${name}": give the column as schema.table.column.`);
    }
    const metricNames = new Set<string>();
    for (const m of this.metrics) {
      const name = clean(m.name);
      if (!name) { if (clean(m.column) || clean(m.description)) out.push('Every metric needs a name.'); continue; }
      if (metricNames.has(name.toLowerCase())) out.push(`Metric "${name}" is listed twice.`);
      metricNames.add(name.toLowerCase());
      if (!clean(m.column) && m.agg !== 'count') out.push(`Metric "${name}": choose a column (only "Count rows" needs none).`);
      if (clean(m.column) && !fullColumn(m.column)) out.push(`Metric "${name}": give the column as schema.table.column.`);
    }
    for (const n of this.notes) {
      const parts = clean(n.column).split('.');
      if (!clean(n.column)) { if (clean(n.displayName) || clean(n.note)) out.push('Every name or note needs its column or table.'); continue; }
      if (parts.length < 2 || parts.length > 3 || parts.some(p => !p)) out.push(`"${clean(n.column)}": give schema.table.column (or schema.table).`);
      else if (!clean(n.displayName) && !clean(n.note)) out.push(`"${clean(n.column)}": give a name or a note.`);
    }
    return [...new Set(out)];
  }

  addTerm(): void { this.terms = [...this.terms, { term: '', synonyms: '', column: '', value: '', meaning: '' }]; }
  removeTerm(i: number): void { this.terms = this.terms.filter((_, j) => j !== i); }
  addMetric(): void { this.metrics = [...this.metrics, { name: '', agg: 'sum', column: '', description: '' }]; }
  removeMetric(i: number): void { this.metrics = this.metrics.filter((_, j) => j !== i); }
  addNote(): void { this.notes = [...this.notes, { column: '', displayName: '', note: '' }]; }
  removeNote(i: number): void { this.notes = this.notes.filter((_, j) => j !== i); }

  discard(): void {
    const s = JSON.parse(this.saved) as { terms: TermRow[]; notes: NoteRow[]; metrics: MetricRow[] };
    this.terms = s.terms;
    this.notes = s.notes;
    this.metrics = s.metrics;
    this.message = null;
  }

  save(): void {
    if (this.saving || this.problems.length) return;
    this.saving = true;
    this.message = null;
    const terms: AiTerm[] = this.terms.filter(t => clean(t.term)).map(t => ({
      term: clean(t.term), synonyms: clean(t.synonyms) || null, column: clean(t.column) || null,
      value: clean(t.value) || null, meaning: clean(t.meaning) || null,
    }));
    const notes: AiDatasetNote[] = this.notes.filter(n => clean(n.column)).map(n => ({
      column: clean(n.column), displayName: clean(n.displayName) || null, note: clean(n.note),
    }));
    const metrics: AiMetric[] = this.metrics.filter(m => clean(m.name)).map(m => ({
      name: clean(m.name), agg: m.agg, column: clean(m.column) || null, description: clean(m.description) || null,
    }));
    forkJoin({ terms: this.ai.saveTerms(SOURCE, 0, terms), notes: this.ai.saveNotes(SOURCE, 0, notes), metrics: this.ai.saveMetrics(SOURCE, 0, metrics) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => {
          this.apply(r.terms, r.notes, r.metrics);
          this.saving = false;
          this.message = { ok: true, text: 'Saved. Ask Data uses them within 30 seconds.' };
          this.cdr.markForCheck();
        },
        error: err => {
          this.saving = false;
          this.message = { ok: false, text: err?.error?.message ?? 'The terms, metrics and column names could not be saved.' };
          this.cdr.markForCheck();
        },
      });
  }

  // ── Reviews: each acts at once ────────────────────────────────────────────

  reviewExample(e: AiExample, status: 'approved' | 'rejected'): void {
    this.review(this.ai.setExampleStatus(e.id, status), () => { e.status = status; }, status === 'approved'
      ? 'Approved: it now guides similar questions.' : 'Rejected: it will not be used.');
  }

  deleteExample(e: AiExample): void {
    this.review(this.ai.deleteExample(e.id), () => { this.examples = this.examples.filter(x => x !== e); }, 'Example deleted.');
  }

  reviewProposal(p: AiNoteProposal, action: 'approve' | 'reject'): void {
    this.review(this.ai.reviewProposal(p.id, action), () => {
      this.proposals = this.proposals.filter(x => x !== p);
      // An approved note is added to the column's note on the server: show it, unless the admin is editing.
      if (action === 'approve' && !this.dirty) this.ai.notes(SOURCE, 0).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(n => {
        this.apply(this.snapshotTerms(), n, this.snapshotMetrics());
        this.cdr.markForCheck();
      });
    }, action === 'approve' ? 'Note added to Column names and notes.' : 'Suggestion rejected.');
  }

  setLink(l: AiRelation, status: 'confirmed' | 'rejected'): void {
    this.review(this.ai.setRelationStatus(l.id, status), () => { l.status = status; },
      status === 'confirmed' ? 'Link confirmed: Ask Data can join these tables.' : 'Link rejected: it will not be suggested again.');
  }

  deleteLink(l: AiRelation): void {
    this.review(this.ai.deleteRelation(l.id), () => { this.links = this.links.filter(x => x !== l); }, 'Link removed.');
  }

  addLink(): void {
    const from = clean(this.newLink.from), to = clean(this.newLink.to);
    if (!fullColumn(from) || !fullColumn(to) || from.toLowerCase() === to.toLowerCase()) {
      this.reviewMessage = { ok: false, text: 'Give two different columns as schema.table.column.' };
      return;
    }
    this.review(this.ai.addAskDataLink(from, to), l => { this.links = [...this.links, l as AiRelation]; this.newLink = { from: '', to: '' }; }, 'Link added and confirmed.');
  }

  scanLinks(): void {
    if (this.scanning) return;
    this.scanning = true;
    this.reviewMessage = null;
    this.ai.scanAskDataLinks().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: l => {
        this.links = l;
        this.scanning = false;
        const n = this.suggestedLinks.length;
        this.reviewMessage = { ok: true, text: n ? `${n} link${n === 1 ? '' : 's'} to review.` : 'No new links found (the database may still be profiling: try again in a few minutes).' };
        this.cdr.markForCheck();
      },
      error: err => { this.scanning = false; this.reviewMessage = { ok: false, text: err?.error?.message ?? 'The tables could not be scanned.' }; this.cdr.markForCheck(); },
    });
  }

  linkText(l: AiRelation): string { return `${l.fromName}.${l.fromColumn} → ${l.toName}.${l.toColumn}`; }
  trackIndex(i: number): number { return i; }
  trackId(_: number, x: { id: number }): number { return x.id; }

  private review<T>(call: Observable<T>, done: (r: T) => void, text: string): void {
    this.reviewMessage = null;
    call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => { done(r); this.reviewMessage = { ok: true, text }; this.cdr.markForCheck(); },
      error: err => { this.reviewMessage = { ok: false, text: err?.error?.message ?? 'That did not work; try again.' }; this.cdr.markForCheck(); },
    });
  }

  private apply(terms: AiTerm[], notes: AiDatasetNote[], metrics: AiMetric[]): void {
    this.terms = terms.map(t => ({ term: t.term, synonyms: t.synonyms ?? '', column: t.column ?? '', value: t.value ?? '', meaning: t.meaning ?? '' }));
    this.notes = notes.filter(n => n.column).map(n => ({ column: n.column ?? '', displayName: n.displayName ?? '', note: n.note ?? '' }));
    this.metrics = metrics.map(m => ({ name: m.name, agg: m.agg, column: m.column ?? '', description: m.description ?? '' }));
    this.saved = this.snapshot();
  }

  private snapshotTerms(): AiTerm[] {
    return this.terms.map(t => ({ term: t.term, synonyms: t.synonyms || null, column: t.column || null, value: t.value || null, meaning: t.meaning || null }));
  }

  private snapshotMetrics(): AiMetric[] {
    return this.metrics.map(m => ({ name: m.name, agg: m.agg, column: m.column || null, description: m.description || null }));
  }

  private snapshot(): string {
    return JSON.stringify({ terms: this.terms, notes: this.notes, metrics: this.metrics });
  }
}
