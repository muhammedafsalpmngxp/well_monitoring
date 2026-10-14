import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AgenticFeatureSettings, AiService, AskDataCatalog, AskDataSettings, SaveAskDataSettings } from '../../../core/services/ai.service';

/** The fixed sections of AI Settings → Ask Data & Features. Ask Data is the first; each Agentic Feature adds its own (from the API). */
export const AI_SETTINGS_SECTIONS: { key: string; title: string; hint: string }[] = [
  { key: 'ask-data', title: 'Ask Data', hint: 'What Ask your data and agent Ask Data steps may read, and their limits.' },
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

/**
 * AI Settings → Ask Data & Features (admins only): how the AI works for this tenant, stored in core.AiSettings. The Ask Data
 * section sets which schemas it may read, which tables and columns stay hidden, and its limits; the agent runtime has
 * no list of its own, so until a schema is chosen Ask Data refuses to run. Schemas, tables and columns are picked
 * from the Ask Data database itself; names that no longer exist (or apply in every schema / table) can still be hidden.
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
  /** Tables listed at once in the hidden-tables picker; the search narrows the rest. */
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
  customTable = '';
  customColumn = '';

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
    if (key === 'ask-data') return !!this.saved?.configured;
    const f = this.feature(key);
    return !!f && (f.access.includedTables.length > 0 || (f.accessMode === 'schemas' && f.access.allowedSchemas.length > 0));
  }

  onFeatureSaved(s: AgenticFeatureSettings): void {
    this.features = this.features.map(f => (f.feature === s.feature ? s : f));
  }

  loadCatalog(): void {
    this.catalogError = '';
    this.ai.askDataCatalog().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: c => { this.catalog = c; this.cdr.markForCheck(); },
      error: err => {
        this.catalog = null;
        this.catalogError = err?.error?.message ?? 'The Ask Data database could not be read.';
        this.cdr.markForCheck();
      },
    });
  }

  // ── State ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private blank(): SaveAskDataSettings {
    return { allowedSchemas: [], excludedTables: [], excludedColumns: [], maxRows: 500, queryTimeout: 60, maxQueries: 3, sqlRetries: 2,
      verifyRetries: 1, historyTurns: 3, orgName: '', exportPrefix: '', chatMode: 'deep' };
  }

  private apply(s: AskDataSettings): void {
    this.saved = s;
    this.draft = {
      allowedSchemas: [...s.allowedSchemas], excludedTables: [...s.excludedTables], excludedColumns: [...s.excludedColumns],
      maxRows: s.maxRows, queryTimeout: s.queryTimeout, maxQueries: s.maxQueries, sqlRetries: s.sqlRetries,
      verifyRetries: s.verifyRetries, historyTurns: s.historyTurns, orgName: s.orgName ?? '', exportPrefix: s.exportPrefix ?? '',
      chatMode: s.chatMode === 'normal' ? 'normal' : 'deep',
    };
  }

  private snapshot(s: SaveAskDataSettings): string {
    const sorted = (a: string[]) => [...a].map(low).sort();
    return JSON.stringify({ ...s, allowedSchemas: sorted(s.allowedSchemas), excludedTables: sorted(s.excludedTables),
      excludedColumns: sorted(s.excludedColumns), orgName: (s.orgName ?? '').trim(), exportPrefix: (s.exportPrefix ?? '').trim().toLowerCase() });
  }

  get dirty(): boolean {
    if (!this.saved) return false;
    const { configured, modifiedBy, modifiedAt, ...saved } = this.saved;
    return this.snapshot(this.draft) !== this.snapshot({ ...saved, orgName: saved.orgName ?? '', exportPrefix: saved.exportPrefix ?? '' });
  }

  /** Problems the server would refuse, shown before saving. */
  get problems(): string[] {
    const p: string[] = [];
    if (!this.draft.allowedSchemas.length) p.push('Choose at least one schema Ask Data may read.');
    for (const f of this.limits) {
      const v = this.draft[f.key];
      if (!Number.isInteger(v) || v < f.min || v > f.max) p.push(`${f.label} must be a whole number from ${f.min} to ${f.max.toLocaleString('en')}.`);
    }
    const prefix = (this.draft.exportPrefix ?? '').trim().toLowerCase();
    if (prefix && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(prefix)) p.push('The export file prefix may use only a-z, 0-9 and single dashes.');
    if ((this.draft.orgName ?? '').trim().length > 200) p.push('The organisation name must be under 200 characters.');
    return p;
  }

  // ── Schemas ───────────────────────────────────────────────────────────────────────────────────────────────────

  isAllowed(schema: string): boolean { return this.draft.allowedSchemas.some(s => low(s) === low(schema)); }

  toggleSchema(schema: string): void {
    this.draft.allowedSchemas = this.isAllowed(schema)
      ? this.draft.allowedSchemas.filter(s => low(s) !== low(schema))
      : [...this.draft.allowedSchemas, schema];
    if (this.columnTable && !this.isAllowed(this.columnTable.split('.')[0])) this.columnTable = '';
  }

  /** Allowed schemas the database no longer has (kept until the admin removes them; the server refuses them). */
  get missingSchemas(): string[] {
    if (!this.catalog) return [];
    return this.draft.allowedSchemas.filter(s => !this.catalog!.schemas.some(c => low(c.name) === low(s)));
  }

  get allowedCatalog() { return (this.catalog?.schemas ?? []).filter(s => this.isAllowed(s.name)); }

  /** Tables and columns Ask Data will see with the draft settings (secret-named columns aside). */
  get visibleCounts(): { tables: number; totalTables: number; columns: number } {
    let tables = 0, columns = 0, totalTables = 0;
    for (const s of this.catalog?.schemas ?? []) {
      totalTables += s.tables.length;
      if (!this.isAllowed(s.name)) continue;
      for (const t of s.tables) {
        if (this.isTableHidden(s.name, t.name)) continue;
        tables++;
        columns += t.columns.filter(c => !this.isColumnHidden(s.name, t.name, c)).length;
      }
    }
    return { tables, totalTables, columns };
  }

  // ── Hidden tables ─────────────────────────────────────────────────────────────────────────────────────────────

  isTableHidden(schema: string, table: string): boolean {
    const full = low(`${schema}.${table}`), bare = low(table);
    return this.draft.excludedTables.some(x => low(x) === full || low(x) === bare);
  }

  /** Hidden by its bare name (every schema): the checkbox cannot unhide only this one. */
  hiddenByName(table: string): boolean { return this.draft.excludedTables.some(x => low(x) === low(table)); }

  toggleTable(schema: string, table: string): void {
    const full = `${schema}.${table}`;
    if (this.draft.excludedTables.some(x => low(x) === low(full))) {
      this.draft.excludedTables = this.draft.excludedTables.filter(x => low(x) !== low(full));
    } else if (!this.hiddenByName(table)) {
      this.draft.excludedTables = [...this.draft.excludedTables, full];
    }
  }

  /** Tables of the allowed schemas matching the search, capped at tableListMax. */
  get tableRows(): { schema: string; table: string; columns: number }[] {
    const words = low(this.tableSearch).split(/\s+/).filter(Boolean);
    const rows: { schema: string; table: string; columns: number }[] = [];
    for (const s of this.allowedCatalog)
      for (const t of s.tables)
        if (words.every(w => low(`${s.name}.${t.name}`).includes(w))) rows.push({ schema: s.name, table: t.name, columns: t.columns.length });
    return rows;
  }

  addCustomTable(): void {
    const name = this.customTable.trim();
    if (!name || this.draft.excludedTables.some(x => low(x) === low(name))) { this.customTable = ''; return; }
    this.draft.excludedTables = [...this.draft.excludedTables, name];
    this.customTable = '';
  }

  removeTable(name: string): void { this.draft.excludedTables = this.draft.excludedTables.filter(x => x !== name); }

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

  /** Tables of the allowed schemas, for the column picker. */
  get columnTableOptions(): string[] {
    return this.allowedCatalog.flatMap(s => s.tables.filter(t => !this.isTableHidden(s.name, t.name)).map(t => `${s.name}.${t.name}`));
  }

  // ── Save ──────────────────────────────────────────────────────────────────────────────────────────────────────

  save(): void {
    if (this.saving || !this.dirty || this.problems.length) return;
    this.saving = true;
    this.message = null;
    const body: SaveAskDataSettings = {
      ...this.draft,
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
  trackRow(_: number, r: { schema: string; table: string }): string { return `${r.schema}.${r.table}`; }
}
