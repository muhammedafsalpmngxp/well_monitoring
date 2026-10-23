import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AgenticFeatureSettings, AiService, AskDataCatalog, AskDataSettings, SaveAskDataSettings } from '../../../core/services/ai.service';

/** The fixed sections of AI Settings → Ask Data & Features. Ask Data is the first; each Agentic Feature adds its own (from the API). */
export const AI_SETTINGS_SECTIONS: { key: string; title: string; hint: string }[] = [
  { key: 'ask-data', title: 'Ask Data', hint: 'What Ask your data and agent Ask Data steps may read, and their limits.' },
  { key: 'ask-data-terms', title: 'Terms & column names', hint: "The company's words and what columns are called, for Ask Data." },
];

/** A number field of the Limits card: bounds as the API checks them. */
interface LimitField { key: keyof Pick<SaveAskDataSettings, 'maxRows' | 'queryTimeout' | 'maxQueries' | 'sqlRetries' | 'verifyRetries' | 'historyTurns'>; label: string; hint: string; min: number; max: number; unit?: string }

export const ASK_DATA_LIMITS: LimitField[] = [
  { key: 'maxRows', label: 'Rows per query', hint: 'The most rows one query returns. An agent can lower it, never raise it.', min: 1, max: 10000 },
  { key: 'queryTimeout', label: 'Query time limit', hint: 'A query running longer is stopped.', min: 5, max: 600, unit: 'seconds' },
  { key: 'maxQueries', label: 'Queries per question', hint: 'How many queries deep mode may run to answer one question.', min: 1, max: 10 },
  { key: 'sqlRetries', label: 'SQL rewrites after an error', hint: 'How often a query that failed is rewritten and run again.', min: 0, max: 5 },
  { key: 'verifyRetries', label: 'Answer re-checks', hint: 'How often deep mode retries an answer its checker rejected.', min: 0, max: 3 },
  { key: 'historyTurns', label: 'Conversation turns remembered', hint: 'Earlier questions and answers the chatbot keeps for follow-ups.', min: 0, max: 20 },
];

/** The Ask your data chatbot's two modes. Agents choose their own mode per step (New Agent page). */
export const CHAT_MODES: { key: 'deep' | 'normal'; title: string; hint: string }[] = [
  { key: 'deep', title: 'Deep', hint: 'Plans multi-part questions, can run several queries and has a verifier check the answer against the question. Most accurate; slower.' },
  { key: 'normal', title: 'Normal', hint: 'One query and a quick code check, no AI verifier. Faster; best for simple lookups and counts.' },
];

interface Message { ok: boolean; text: string }

/** Lowercase, for comparing names the way Ask Data does. */
const low = (s: string) => s.trim().toLowerCase();

/** The schema of "schema.table". */
const schemaOf = (full: string) => low(full.split('.')[0]);

/**
 * AI Settings → Ask Data & Features (admins only): how the AI works for this tenant, stored in core.AiSettings. The Ask Data
 * section ticks the tables it may read (the same picker as Slippage, Daily Report and Crew Management), the columns that
 * stay hidden, and its limits; the agent runtime has no list of its own, so until a table is ticked Ask Data refuses to
 * run. Tables and columns are picked from the Ask Data database itself; column names that no longer exist (or apply in
 * every table) can still be hidden. A tenant saved before the table list (allowed schemas minus hidden tables) opens with
 * every table it could read ticked, to review and save.
 */
@Component({
  selector: 'app-ai-configuration',
  standalone: false,
  templateUrl: './ai-configuration.component.html',
  styleUrls: ['./ai-configuration.component.scss'],
})
export class AiConfigurationComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  /** Ask Data, then one section per Agentic Feature (Slippage, Daily Report, Data Anomaly), as the API lists them. */
  sections = [...AI_SETTINGS_SECTIONS];
  readonly limits = ASK_DATA_LIMITS;
  readonly chatModes = CHAT_MODES;
  readonly breadcrumbs = [{ label: 'Home' }, { label: 'AI Settings', route: '/settings/ai' }, { label: 'Ask Data & Features' }];
  /** Tables listed at once in the table picker; the search narrows the rest. */
  readonly tableListMax = 200;

  activeSection = inject(ActivatedRoute).snapshot.queryParamMap.get('section') ?? AI_SETTINGS_SECTIONS[0].key;
  /** The Agentic Features' settings; each renders its own section (kept alive, so switching sections keeps drafts). */
  features: AgenticFeatureSettings[] = [];
  featuresError = '';
  loading = true;
  error = '';
  catalog: AskDataCatalog | null = null;
  catalogError = '';
  saved: AskDataSettings | null = null;
  draft: SaveAskDataSettings = this.blank();
  saving = false;
  message: Message | null = null;

  tableSearch = '';
  columnTable = '';
  customColumn = '';
  /** Schemas whose tables the picker lists (a view filter only: what Ask Data reads is the ticked tables). */
  shownSchemas = new Set<string>();
  onlyTicked = false;
  /** Tables ticked from the old settings (allowed schemas minus hidden tables) for the admin to review and save; 0 = none. */
  movedFromSchemas = 0;

  constructor(private readonly ai: AiService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    this.message = null;
    this.ai.askDataSettings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: s => {
        this.apply(s);
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: err => {
        this.loading = false;
        this.error = err?.status === 403 ? 'Only admins can see the AI settings.' : (err?.error?.message ?? 'The AI settings could not be loaded.');
        this.cdr.markForCheck();
      },
    });
    this.loadCatalog();
    this.loadFeatures();
  }

  loadFeatures(): void {
    this.featuresError = '';
    this.ai.featureSettings().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: f => {
        this.features = f;
        this.sections = [...AI_SETTINGS_SECTIONS, ...f.map(x => ({ key: x.feature, title: x.title, hint: this.featureHint(x) }))];
        if (!this.sections.some(s => s.key === this.activeSection)) this.activeSection = AI_SETTINGS_SECTIONS[0].key;
        this.cdr.markForCheck();
      },
      error: err => { this.featuresError = err?.error?.message ?? 'The Agentic Features settings could not be loaded.'; this.cdr.markForCheck(); },
    });
  }

  private featureHint(f: AgenticFeatureSettings): string {
    return f.accessMode === 'tables' ? 'The tables its verified queries may read, and its settings.' : 'The schemas its AI checks may read, and its settings.';
  }

  feature(key: string): AgenticFeatureSettings | undefined { return this.features.find(f => f.feature === key); }

  /** Set up: Ask Data has a schema; a feature has its tables (or schemas) chosen. */
  isConfigured(key: string): boolean {
    if (key === 'ask-data' || key === 'ask-data-terms') return !!this.saved?.configured;
    const f = this.feature(key);
    return !!f && (f.access.includedTables.length > 0 || (f.accessMode === 'schemas' && f.access.allowedSchemas.length > 0));
  }

  onFeatureSaved(s: AgenticFeatureSettings): void {
    this.features = this.features.map(f => (f.feature === s.feature ? s : f));
  }

  loadCatalog(): void {
    this.catalogError = '';
    this.ai.askDataCatalog().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: c => { this.catalog = c; this.moveFromSchemas(); this.cdr.markForCheck(); },
      error: err => {
        this.catalog = null;
        this.catalogError = err?.error?.message ?? 'The Ask Data database could not be read.';
        this.cdr.markForCheck();
      },
    });
  }

  // ── State ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private blank(): SaveAskDataSettings {
    return { allowedSchemas: [], includedTables: [], excludedTables: [], excludedColumns: [], maxRows: 500, queryTimeout: 60, maxQueries: 3,
      sqlRetries: 2, verifyRetries: 1, historyTurns: 3, orgName: '', exportPrefix: '', chatMode: 'deep' };
  }

  private apply(s: AskDataSettings): void {
    this.saved = s;
    this.draft = {
      allowedSchemas: [...s.allowedSchemas], includedTables: [...(s.includedTables ?? [])], excludedTables: [...s.excludedTables],
      excludedColumns: [...s.excludedColumns], maxRows: s.maxRows, queryTimeout: s.queryTimeout, maxQueries: s.maxQueries,
      sqlRetries: s.sqlRetries, verifyRetries: s.verifyRetries, historyTurns: s.historyTurns, orgName: s.orgName ?? '',
      exportPrefix: s.exportPrefix ?? '', chatMode: s.chatMode === 'normal' ? 'normal' : 'deep',
    };
    this.movedFromSchemas = 0;
    this.shownSchemas = new Set(this.draft.includedTables.map(schemaOf));
    this.moveFromSchemas();
  }

  /**
   * Saved before the table list (allowed schemas, hidden tables, no included tables): tick every table Ask Data reads today,
   * so saving changes nothing it can see. Runs once the settings and the catalog have both loaded; only the draft changes.
   */
  private moveFromSchemas(): void {
    const s = this.saved;
    if (!s || !this.catalog || (s.includedTables ?? []).length || !s.allowedSchemas.length || this.draft.includedTables.length) return;
    const hidden = s.excludedTables.map(low);
    const allowed = s.allowedSchemas.map(low);
    const tables = this.catalog.schemas.filter(x => allowed.includes(low(x.name)))
      .flatMap(x => x.tables.filter(t => !hidden.includes(low(`${x.name}.${t.name}`)) && !hidden.includes(low(t.name)))
        .map(t => `${x.name}.${t.name}`));
    this.draft.includedTables = tables;
    this.movedFromSchemas = tables.length;
    this.shownSchemas = new Set(tables.map(schemaOf));
  }

  private snapshot(s: SaveAskDataSettings): string {
    const sorted = (a: string[]) => [...a].map(low).sort();
    return JSON.stringify({ ...s, allowedSchemas: sorted(s.allowedSchemas), includedTables: sorted(s.includedTables ?? []),
      excludedTables: sorted(s.excludedTables), excludedColumns: sorted(s.excludedColumns), orgName: (s.orgName ?? '').trim(),
      exportPrefix: (s.exportPrefix ?? '').trim().toLowerCase() });
  }

  get dirty(): boolean {
    if (!this.saved) return false;
    const { configured, modifiedBy, modifiedAt, ...saved } = this.saved;
    return this.snapshot(this.draft) !== this.snapshot({ ...saved, orgName: saved.orgName ?? '', exportPrefix: saved.exportPrefix ?? '' });
  }

  /** Problems the server would refuse, shown before saving. */
  get problems(): string[] {
    const p: string[] = [];
    if (!this.draft.includedTables.length) p.push('Tick at least one table Ask Data may read.');
    if (this.unknownIncluded.length) p.push(`Not in the database: ${this.unknownIncluded.slice(0, 5).join(', ')}. Remove them to save.`);
    for (const f of this.limits) {
      const v = this.draft[f.key];
      if (!Number.isInteger(v) || v < f.min || v > f.max) p.push(`${f.label} must be a whole number from ${f.min} to ${f.max.toLocaleString('en')}.`);
    }
    const prefix = (this.draft.exportPrefix ?? '').trim().toLowerCase();
    if (prefix && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(prefix)) p.push('The export file prefix may use only a-z, 0-9 and single dashes.');
    if ((this.draft.orgName ?? '').trim().length > 200) p.push('The organisation name must be under 200 characters.');
    return p;
  }

  // ── Tables Ask Data may read ──────────────────────────────────────────────────────────────────────────────────

  // Every change replaces draft.includedTables, so the lookup set is rebuilt only when the array is a new one.
  private includedOf: string[] | null = null;
  private includedSet = new Set<string>();

  isIncluded(full: string): boolean {
    if (this.includedOf !== this.draft.includedTables) {
      this.includedOf = this.draft.includedTables;
      this.includedSet = new Set(this.includedOf.map(low));
    }
    return this.includedSet.has(low(full));
  }

  toggleIncluded(full: string): void {
    this.draft.includedTables = this.isIncluded(full)
      ? this.draft.includedTables.filter(t => low(t) !== low(full))
      : [...this.draft.includedTables, full];
    if (this.columnTable && !this.isIncluded(this.columnTable)) this.columnTable = '';
  }

  /** Tick (or untick) every table the picker lists with the current schemas, search and filter, not only the first 200. */
  tickListed(on: boolean): void {
    const listed = this.tableRows.map(r => r.full);
    const listedSet = new Set(listed.map(low));
    this.draft.includedTables = on
      ? [...this.draft.includedTables, ...listed.filter(t => !this.isIncluded(t))]
      : this.draft.includedTables.filter(t => !listedSet.has(low(t)));
    if (this.columnTable && !this.isIncluded(this.columnTable)) this.columnTable = '';
  }

  /** Ticked tables the database no longer has (kept until the admin removes them; the server refuses them). */
  get unknownIncluded(): string[] {
    if (!this.catalog) return [];
    const known = new Set(this.catalog.schemas.flatMap(s => s.tables.map(t => low(`${s.name}.${t.name}`))));
    return this.draft.includedTables.filter(t => !known.has(low(t)));
  }

  isShown(schema: string): boolean { return this.shownSchemas.has(low(schema)); }

  toggleShown(schema: string): void {
    const s = low(schema);
    if (!this.shownSchemas.delete(s)) this.shownSchemas.add(s);
    this.shownSchemas = new Set(this.shownSchemas);
  }

  /** Ticked tables of one schema, for its count beside the schema. */
  tickedIn(schema: string): number { return this.draft.includedTables.filter(t => schemaOf(t) === low(schema)).length; }

  /** Tables of the listed schemas matching the search (and "Ticked only"): ticked first, then by name. */
  get tableRows(): { full: string; schema: string; table: string; columns: number }[] {
    const words = low(this.tableSearch).split(/\s+/).filter(Boolean);
    const rows: { full: string; schema: string; table: string; columns: number }[] = [];
    for (const s of this.catalog?.schemas ?? []) {
      if (!this.isShown(s.name)) continue;
      for (const t of s.tables) {
        const full = `${s.name}.${t.name}`;
        if (this.onlyTicked && !this.isIncluded(full)) continue;
        if (words.every(w => low(full).includes(w))) rows.push({ full, schema: s.name, table: t.name, columns: t.columns.length });
      }
    }
    return rows.sort((a, b) => Number(this.isIncluded(b.full)) - Number(this.isIncluded(a.full)) || a.full.localeCompare(b.full));
  }

  /** Tables and columns Ask Data will see with the draft settings (secret-named columns aside). */
  get visibleCounts(): { tables: number; totalTables: number; columns: number } {
    let tables = 0, columns = 0, totalTables = 0;
    for (const s of this.catalog?.schemas ?? []) {
      totalTables += s.tables.length;
      for (const t of s.tables) {
        if (!this.isIncluded(`${s.name}.${t.name}`)) continue;
        tables++;
        columns += t.columns.filter(c => !this.isColumnHidden(s.name, t.name, c)).length;
      }
    }
    return { tables, totalTables, columns };
  }

  // ── Hidden columns ────────────────────────────────────────────────────────────────────────────────────────────

  isColumnHidden(schema: string, table: string, column: string): boolean {
    const names = [low(`${schema}.${table}.${column}`), low(`${table}.${column}`), low(column)];
    return this.draft.excludedColumns.some(x => names.includes(low(x)));
  }

  /** Hidden by a wider entry (table.column or column): the checkbox cannot unhide only this table's. */
  columnHiddenWider(table: string, column: string): boolean {
    const names = [low(`${table}.${column}`), low(column)];
    return this.draft.excludedColumns.some(x => names.includes(low(x)));
  }

  /** Columns of the table chosen in the picker ("schema.table"). */
  get pickedColumns(): { schema: string; table: string; columns: string[] } | null {
    const [schema, ...rest] = this.columnTable.split('.');
    const table = rest.join('.');
    const t = this.catalog?.schemas.find(s => s.name === schema)?.tables.find(x => x.name === table);
    return t ? { schema, table, columns: t.columns } : null;
  }

  toggleColumn(schema: string, table: string, column: string): void {
    const full = `${schema}.${table}.${column}`;
    if (this.draft.excludedColumns.some(x => low(x) === low(full))) {
      this.draft.excludedColumns = this.draft.excludedColumns.filter(x => low(x) !== low(full));
    } else if (!this.columnHiddenWider(table, column)) {
      this.draft.excludedColumns = [...this.draft.excludedColumns, full];
    }
  }

  addCustomColumn(): void {
    const name = this.customColumn.trim();
    if (!name || this.draft.excludedColumns.some(x => low(x) === low(name))) { this.customColumn = ''; return; }
    this.draft.excludedColumns = [...this.draft.excludedColumns, name];
    this.customColumn = '';
  }

  removeColumn(name: string): void { this.draft.excludedColumns = this.draft.excludedColumns.filter(x => x !== name); }

  /** The ticked tables the database has, for the column picker. */
  get columnTableOptions(): string[] {
    return (this.catalog?.schemas ?? []).flatMap(s => s.tables.map(t => `${s.name}.${t.name}`).filter(full => this.isIncluded(full)));
  }

  // ── Save ──────────────────────────────────────────────────────────────────────────────────────────────────────

  save(): void {
    if (this.saving || !this.dirty || this.problems.length) return;
    this.saving = true;
    this.message = null;
    // The ticked tables replace the schemas and hidden tables: the server stores their schemas as the allowed ones.
    const body: SaveAskDataSettings = {
      ...this.draft,
      allowedSchemas: [...new Set(this.draft.includedTables.map(t => t.split('.')[0]))],
      excludedTables: [],
      orgName: (this.draft.orgName ?? '').trim() || null,
      exportPrefix: (this.draft.exportPrefix ?? '').trim().toLowerCase() || null,
    };
    this.ai.saveAskDataSettings(body).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: s => {
        this.apply(s);
        this.saving = false;
        this.message = { ok: true, text: 'Saved. Ask Data uses these settings from the next question.' };
        this.cdr.markForCheck();
      },
      error: err => {
        this.saving = false;
        this.message = { ok: false, text: err?.error?.message ?? 'The settings could not be saved.' };
        this.cdr.markForCheck();
      },
    });
  }

  discard(): void {
    if (this.saved) this.apply(this.saved);
    this.message = null;
  }

  trackFeature(_: number, f: AgenticFeatureSettings): string { return f.feature; }

  trackName(_: number, x: { name: string } | string): string { return typeof x === 'string' ? x : x.name; }
  trackRow(_: number, r: { full: string }): string { return r.full; }
}
