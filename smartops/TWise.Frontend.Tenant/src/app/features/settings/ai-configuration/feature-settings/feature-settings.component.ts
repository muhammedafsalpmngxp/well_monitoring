import { ChangeDetectorRef, Component, DestroyRef, EventEmitter, inject, Input, OnChanges, Output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AgenticFeatureSettings, AiService, AskDataCatalog, FeatureAccess, FeatureSettingDefinition } from '../../../../core/services/ai.service';

interface Message { ok: boolean; text: string }
interface MapRow { name: string; value: number | null }

/** Lowercase, for comparing database names. */
const low = (s: string) => s.trim().toLowerCase();
/** The schema of a schema.table, lower case. */
const schemaOf = (full: string) => low(full.split('.')[0]);

/**
 * One Agentic Feature's section of Settings → AI Settings: every setting it has (from its definitions: no field is
 * hard-coded here), grouped as the definitions say, and what it may read in the Ask Data database. "tables" features
 * (Slippage, Daily Report) read fixed tables through their verified SQL: the admin ticks those tables. "schemas"
 * features (Data Anomaly) write their own SQL: the admin chooses schemas and hides tables or columns, as for Ask Data.
 */
@Component({
  selector: 'app-feature-settings',
  standalone: false,
  templateUrl: './feature-settings.component.html',
  styleUrls: ['../ai-configuration.component.scss', './feature-settings.component.scss'],
})
export class FeatureSettingsComponent implements OnChanges {
  private readonly destroyRef = inject(DestroyRef);

  @Input({ required: true }) settings!: AgenticFeatureSettings;
  @Input() catalog: AskDataCatalog | null = null;
  @Input() catalogError = '';
  @Output() saved = new EventEmitter<AgenticFeatureSettings>();
  @Output() reloadCatalog = new EventEmitter<void>();

  readonly tableListMax = 300;

  values: Record<string, any> = {};
  /** List settings are edited one item per line; map settings as name / number rows. */
  listText: Record<string, string> = {};
  mapRows: Record<string, MapRow[]> = {};
  access: FeatureAccess = { allowedSchemas: [], includedTables: [], excludedTables: [], excludedColumns: [] };
  saving = false;
  message: Message | null = null;
  confirmReset = false;
  tableSearch = '';
  onlyTicked = false;
  customTable = '';
  customColumn = '';
  columnTable = '';
  /** Tables mode: the schemas whose tables are listed (lower case). Not saved: it starts as the schemas of the ticked
   *  tables and of the tables its queries read. */
  shownSchemas = new Set<string>();
  /** Groups shown open; the first group starts open. */
  open = new Set<string>();

  constructor(private readonly ai: AiService, private readonly cdr: ChangeDetectorRef) {}

  ngOnChanges(): void {
    this.apply(this.settings);
    if (!this.open.size && this.groups.length) this.open.add(this.groups[0].name);
  }

  // ── State ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private apply(s: AgenticFeatureSettings): void {
    this.values = structuredClone(s.values ?? {});
    this.listText = {};
    this.mapRows = {};
    for (const d of s.definitions) {
      const v = this.values[d.key];
      if (d.type === 'list') this.listText[d.key] = (Array.isArray(v) ? v : []).join('\n');
      if (d.type === 'map') this.mapRows[d.key] = Object.entries(v ?? {}).map(([name, value]) => ({ name, value: value as number }));
    }
    this.access = structuredClone(s.access);
    this.shownSchemas = new Set([...this.access.includedTables, ...s.queryTables].map(schemaOf));
  }

  get groups(): { name: string; defs: FeatureSettingDefinition[] }[] {
    const out: { name: string; defs: FeatureSettingDefinition[] }[] = [];
    for (const d of this.settings?.definitions ?? []) {
      let g = out.find(x => x.name === d.group);
      if (!g) out.push(g = { name: d.group, defs: [] });
      g.defs.push(d);
    }
    return out;
  }

  toggleGroup(name: string): void { this.open.has(name) ? this.open.delete(name) : this.open.add(name); }

  /** The values as they will be sent (list and map editors folded back). */
  private collect(): Record<string, any> {
    const v: Record<string, any> = { ...this.values };
    for (const d of this.settings.definitions) {
      if (d.type === 'list') v[d.key] = this.lines(this.listText[d.key]);
      if (d.type === 'map') v[d.key] = Object.fromEntries((this.mapRows[d.key] ?? []).filter(r => r.name.trim()).map(r => [r.name.trim(), r.value]));
    }
    return v;
  }

  private lines(text: string | undefined): string[] {
    const seen = new Set<string>();
    return (text ?? '').split('\n').map(x => x.trim()).filter(x => x && !seen.has(x) && !!seen.add(x));
  }

  private snapshot(values: Record<string, any>, access: FeatureAccess): string {
    const sorted = (a: string[]) => [...(a ?? [])].map(low).sort();
    const keys = Object.keys(values).sort();
    return JSON.stringify({
      values: keys.map(k => [k, values[k]]),
      access: { s: sorted(access.allowedSchemas), i: sorted(access.includedTables), t: sorted(access.excludedTables), c: sorted(access.excludedColumns) },
    });
  }

  get dirty(): boolean {
    return !!this.settings && this.snapshot(this.collect(), this.access) !== this.snapshot(this.settings.values, this.settings.access);
  }

  isChanged(d: FeatureSettingDefinition): boolean {
    return JSON.stringify(this.collect()[d.key]) !== JSON.stringify(d.default);
  }

  // ── Checks (the same the server makes) ────────────────────────────────────────────────────────────────────────

  problem(d: FeatureSettingDefinition): string | null {
    const v = this.collect()[d.key];
    const range = (n: number) => (d.min != null && n < d.min) || (d.max != null && n > d.max)
      ? `must be from ${d.min ?? '…'} to ${d.max ?? '…'}.` : null;
    switch (d.type) {
      case 'int': return typeof v !== 'number' || !Number.isInteger(v) ? 'must be a whole number.' : range(v);
      case 'decimal': return typeof v !== 'number' || Number.isNaN(v) ? 'must be a number.' : range(v);
      case 'enum': return d.options.includes(v) ? null : `must be one of ${d.options.join(', ')}.`;
      case 'text': return typeof v === 'string' && v.length <= (d.max ?? 20000) ? null : `must be at most ${(d.max ?? 20000).toLocaleString('en')} characters.`;
      case 'list': return v.length > (d.max ?? 500) ? `may hold at most ${d.max ?? 500} items.` : v.some((x: string) => x.length > 400) ? 'each item must be at most 400 characters.' : null;
      case 'map':
        for (const r of this.mapRows[d.key] ?? []) {
          if (!r.name.trim()) continue;
          if (typeof r.value !== 'number' || Number.isNaN(r.value)) return `"${r.name}" must be a number.`;
          const p = range(r.value);
          if (p) return `"${r.name}" ${p}`;
        }
        return null;
      default: return null;
    }
  }

  get problems(): string[] {
    const p = this.settings.definitions.map(d => [d, this.problem(d)] as const).filter(([, x]) => x).map(([d, x]) => `${d.label}: ${x}`);
    if (this.settings.accessMode === 'tables' && !this.access.includedTables.length) p.push(`Tick at least one table ${this.settings.title} may read.`);
    if (this.settings.accessMode === 'schemas' && !this.access.allowedSchemas.length && !this.access.includedTables.length)
      p.push(`Choose at least one schema ${this.settings.title} may read.`);
    return p;
  }

  get configured(): boolean {
    const a = this.settings.access;
    return a.includedTables.length > 0 || (this.settings.accessMode === 'schemas' && a.allowedSchemas.length > 0);
  }

  // ── Map rows ──────────────────────────────────────────────────────────────────────────────────────────────────

  addMapRow(key: string): void { (this.mapRows[key] ??= []).push({ name: '', value: 0 }); }
  removeMapRow(key: string, i: number): void { this.mapRows[key].splice(i, 1); }

  // ── Tables mode ───────────────────────────────────────────────────────────────────────────────────────────────

  isIncluded(full: string): boolean { return this.access.includedTables.some(t => low(t) === low(full)); }

  toggleIncluded(full: string): void {
    this.access.includedTables = this.isIncluded(full)
      ? this.access.includedTables.filter(t => low(t) !== low(full))
      : [...this.access.includedTables, full];
  }

  /** Tables its verified SQL reads but that are not ticked: those queries are refused. */
  get missingQueryTables(): string[] { return this.settings.queryTables.filter(t => !this.isIncluded(t)); }

  /** Ticked tables the database does not have (any more): the server refuses them. */
  get unknownIncluded(): string[] {
    if (!this.catalog) return [];
    const all = new Set(this.allTables.map(t => low(t.full)));
    return this.access.includedTables.filter(t => !all.has(low(t)));
  }

  tickQueryTables(): void {
    for (const t of this.missingQueryTables) {
      this.access.includedTables = [...this.access.includedTables, this.catalogName(t) ?? t];
      this.shownSchemas.add(schemaOf(t));
    }
  }

  isShown(schema: string): boolean { return this.shownSchemas.has(low(schema)); }

  /** Lists or stops listing a schema's tables. Stopping also unticks them, so no ticked table is out of sight. */
  toggleShown(schema: string): void {
    const s = low(schema);
    if (!this.shownSchemas.delete(s)) { this.shownSchemas.add(s); return; }
    this.access.includedTables = this.access.includedTables.filter(t => schemaOf(t) !== s);
  }

  /** The database's spelling of a schema.table, when it has it. */
  private catalogName(full: string): string | null { return this.allTables.find(t => low(t.full) === low(full))?.full ?? null; }

  isQueryTable(full: string): boolean { return this.settings.queryTables.some(t => low(t) === low(full)); }

  get allTables(): { full: string; schema: string; table: string; columns: number }[] {
    return (this.catalog?.schemas ?? []).flatMap(s => s.tables.map(t => ({ full: `${s.name}.${t.name}`, schema: s.name, table: t.name, columns: t.columns.length })));
  }

  get tableRows(): { full: string; schema: string; table: string; columns: number }[] {
    const words = low(this.tableSearch).split(/\s+/).filter(Boolean);
    return this.allTables
      .filter(t => this.isShown(t.schema) && (!this.onlyTicked || this.isIncluded(t.full) || this.isQueryTable(t.full))
        && words.every(w => low(t.full).includes(w)))
      // The tables its queries read first, then the ticked ones, then the rest.
      .sort((a, b) => Number(this.isQueryTable(b.full)) - Number(this.isQueryTable(a.full))
        || Number(this.isIncluded(b.full)) - Number(this.isIncluded(a.full)) || a.full.localeCompare(b.full));
  }

  // ── Schemas mode ──────────────────────────────────────────────────────────────────────────────────────────────

  isAllowed(schema: string): boolean { return this.access.allowedSchemas.some(s => low(s) === low(schema)); }

  toggleSchema(schema: string): void {
    this.access.allowedSchemas = this.isAllowed(schema)
      ? this.access.allowedSchemas.filter(s => low(s) !== low(schema))
      : [...this.access.allowedSchemas, schema];
  }

  get missingSchemas(): string[] {
    if (!this.catalog) return [];
    return this.access.allowedSchemas.filter(s => !this.catalog!.schemas.some(c => low(c.name) === low(s)));
  }

  get allowedCatalog() { return (this.catalog?.schemas ?? []).filter(s => this.isAllowed(s.name)); }

  isTableHidden(schema: string, table: string): boolean {
    const full = low(`${schema}.${table}`), bare = low(table);
    return this.access.excludedTables.some(x => low(x) === full || low(x) === bare);
  }

  hiddenByName(table: string): boolean { return this.access.excludedTables.some(x => low(x) === low(table)); }

  toggleHidden(schema: string, table: string): void {
    const full = `${schema}.${table}`;
    if (this.access.excludedTables.some(x => low(x) === low(full))) this.access.excludedTables = this.access.excludedTables.filter(x => low(x) !== low(full));
    else if (!this.hiddenByName(table)) this.access.excludedTables = [...this.access.excludedTables, full];
  }

  get hiddenRows(): { schema: string; table: string; columns: number }[] {
    const words = low(this.tableSearch).split(/\s+/).filter(Boolean);
    return this.allowedCatalog.flatMap(s => s.tables.map(t => ({ schema: s.name, table: t.name, columns: t.columns.length })))
      .filter(r => words.every(w => low(`${r.schema}.${r.table}`).includes(w)));
  }

  get visibleCount(): number {
    return this.allowedCatalog.reduce((n, s) => n + s.tables.filter(t => !this.isTableHidden(s.name, t.name)).length, 0);
  }

  addCustomTable(): void {
    const name = this.customTable.trim();
    if (name && !this.access.excludedTables.some(x => low(x) === low(name))) this.access.excludedTables = [...this.access.excludedTables, name];
    this.customTable = '';
  }

  removeHiddenTable(name: string): void { this.access.excludedTables = this.access.excludedTables.filter(x => x !== name); }

  isColumnHidden(schema: string, table: string, column: string): boolean {
    const names = [low(`${schema}.${table}.${column}`), low(`${table}.${column}`), low(column)];
    return this.access.excludedColumns.some(x => names.includes(low(x)));
  }

  columnHiddenWider(table: string, column: string): boolean {
    const names = [low(`${table}.${column}`), low(column)];
    return this.access.excludedColumns.some(x => names.includes(low(x)));
  }

  toggleColumn(schema: string, table: string, column: string): void {
    const full = `${schema}.${table}.${column}`;
    if (this.access.excludedColumns.some(x => low(x) === low(full))) this.access.excludedColumns = this.access.excludedColumns.filter(x => low(x) !== low(full));
    else if (!this.columnHiddenWider(table, column)) this.access.excludedColumns = [...this.access.excludedColumns, full];
  }

  get columnTableOptions(): string[] {
    return this.allowedCatalog.flatMap(s => s.tables.filter(t => !this.isTableHidden(s.name, t.name)).map(t => `${s.name}.${t.name}`));
  }

  get pickedColumns(): { schema: string; table: string; columns: string[] } | null {
    const [schema, ...rest] = this.columnTable.split('.');
    const table = rest.join('.');
    const t = this.catalog?.schemas.find(s => s.name === schema)?.tables.find(x => x.name === table);
    return t ? { schema, table, columns: t.columns } : null;
  }

  addCustomColumn(): void {
    const name = this.customColumn.trim();
    if (name && !this.access.excludedColumns.some(x => low(x) === low(name))) this.access.excludedColumns = [...this.access.excludedColumns, name];
    this.customColumn = '';
  }

  removeHiddenColumn(name: string): void { this.access.excludedColumns = this.access.excludedColumns.filter(x => x !== name); }

  // ── Save / reset ──────────────────────────────────────────────────────────────────────────────────────────────

  save(): void {
    if (this.saving || !this.dirty || this.problems.length) return;
    this.saving = true;
    this.message = null;
    this.ai.saveFeatureSettings(this.settings.feature, { values: this.collect(), access: this.access })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: s => this.done(s, `Saved. ${s.title} uses these settings from its next request.`),
        error: err => this.fail(err, 'The settings could not be saved.'),
      });
  }

  discard(): void {
    this.apply(this.settings);
    this.message = null;
  }

  reset(): void {
    this.confirmReset = false;
    this.saving = true;
    this.message = null;
    this.ai.resetFeatureSettings(this.settings.feature).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: s => this.done(s, `Restored the default settings and tables of ${s.title}.`),
      error: err => this.fail(err, 'The defaults could not be restored.'),
    });
  }

  private done(s: AgenticFeatureSettings, text: string): void {
    this.settings = s;
    this.apply(s);
    this.saving = false;
    this.message = { ok: true, text };
    this.saved.emit(s);
    this.cdr.markForCheck();
  }

  private fail(err: any, fallback: string): void {
    this.saving = false;
    this.message = { ok: false, text: err?.status === 403 ? 'Only admins can change the AI settings.' : (err?.error?.message ?? fallback) };
    this.cdr.markForCheck();
  }

  defaultText(d: FeatureSettingDefinition): string {
    if (d.type === 'bool') return d.default ? 'on' : 'off';
    if (d.type === 'list') return (d.default ?? []).length ? (d.default as string[]).join(', ') : 'none';
    if (d.type === 'map') return Object.entries(d.default ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
    return d.default === '' ? '(empty)' : String(d.default);
  }

  trackDef(_: number, d: FeatureSettingDefinition): string { return d.key; }
  trackName(_: number, x: string | { name: string }): string { return typeof x === 'string' ? x : x.name; }
  trackFull(_: number, r: { full?: string; schema: string; table: string }): string { return r.full ?? `${r.schema}.${r.table}`; }
}
