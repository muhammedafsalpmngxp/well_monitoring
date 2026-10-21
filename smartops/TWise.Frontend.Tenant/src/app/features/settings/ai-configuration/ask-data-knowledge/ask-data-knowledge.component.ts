import { ChangeDetectorRef, Component, DestroyRef, inject, Input, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { AiDatasetNote, AiService, AiTerm, AskDataCatalog } from '../../../../core/services/ai.service';

interface Message { ok: boolean; text: string }
interface TermRow { term: string; synonyms: string; column: string; value: string; meaning: string }
interface NoteRow { column: string; displayName: string; note: string }

/** Ask Data's own knowledge has no dataset: it is stored as source askdata, id 0. */
const SOURCE = 'askdata' as const;
/** Column suggestions listed at once; typing narrows the browser's list. */
const COLUMN_LIST_MAX = 5000;

const clean = (s: string | null | undefined) => (s ?? '').trim();

/**
 * AI Settings → Ask Data & Features → Terms & column names: the company's words ("NPT = downtime hours where category is
 * Non-productive") and what columns and tables are called ("FLAF Score" for bl_flaf_scr). Every Ask Data run applies
 * them: a term only when the question uses it, a name in the AI's view of the database and in answer tables.
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

  terms: TermRow[] = [];
  notes: NoteRow[] = [];
  loading = true;
  saving = false;
  loadError = '';
  message: Message | null = null;
  private saved = '';

  constructor(private readonly ai: AiService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.loadError = '';
    forkJoin({ terms: this.ai.terms(SOURCE, 0), notes: this.ai.notes(SOURCE, 0) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => { this.apply(r.terms, r.notes); this.loading = false; this.cdr.markForCheck(); },
        error: err => { this.loadError = err?.error?.message ?? 'The terms and column names could not be loaded.'; this.loading = false; this.cdr.markForCheck(); },
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
      if (clean(t.column) && clean(t.column).split('.').length !== 3) out.push(`Term "${name}": give the column as schema.table.column.`);
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
  addNote(): void { this.notes = [...this.notes, { column: '', displayName: '', note: '' }]; }
  removeNote(i: number): void { this.notes = this.notes.filter((_, j) => j !== i); }

  discard(): void {
    const s = JSON.parse(this.saved) as { terms: TermRow[]; notes: NoteRow[] };
    this.terms = s.terms;
    this.notes = s.notes;
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
    forkJoin({ terms: this.ai.saveTerms(SOURCE, 0, terms), notes: this.ai.saveNotes(SOURCE, 0, notes) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => {
          this.apply(r.terms, r.notes);
          this.saving = false;
          this.message = { ok: true, text: 'Saved. Ask Data uses them from the next question.' };
          this.cdr.markForCheck();
        },
        error: err => {
          this.saving = false;
          this.message = { ok: false, text: err?.error?.message ?? 'The terms and column names could not be saved.' };
          this.cdr.markForCheck();
        },
      });
  }

  trackIndex(i: number): number { return i; }

  private apply(terms: AiTerm[], notes: AiDatasetNote[]): void {
    this.terms = terms.map(t => ({ term: t.term, synonyms: t.synonyms ?? '', column: t.column ?? '', value: t.value ?? '', meaning: t.meaning ?? '' }));
    this.notes = notes.filter(n => n.column).map(n => ({ column: n.column ?? '', displayName: n.displayName ?? '', note: n.note ?? '' }));
    this.saved = this.snapshot();
  }

  private snapshot(): string {
    return JSON.stringify({ terms: this.terms, notes: this.notes });
  }
}
