import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, from, of } from 'rxjs';
import { catchError, concatMap, toArray } from 'rxjs/operators';
import {
  AnySourceType,
  CreateDataSourceRequest,
  CreateSqlConnectionRequest,
  DataSourceAuthType,
  DataSourceConfigField,
  DataSourceConnection,
  DataSourceKind,
  DataSourceKindOption,
  DataSourceObject,
  DataSourceService,
  isSqlProvider,
  SQL_PROVIDER_DEFAULT_PORTS,
  SQL_PROVIDER_LABELS,
  SQL_PROVIDERS,
  SqlConnection,
  SqlProvider,
} from '../../../core/services/data-source.service';
import { ImportedDatasetDto } from '../../../core/services/imported-dataset.service';
import { PermissionService } from '../../../core/services/permission.service';

type PanelMode = 'closed' | 'create' | 'edit';

interface Banner {
  kind: 'success' | 'error' | 'info';
  text: string;
}

/**
 * One row in the unified list. The two families live in different tables behind
 * different endpoints, so they are normalised here for display.
 */
interface SourceRow {
  /** 'sql' = queried live via the View Builder; 'pull' = fetched and ingested. */
  family: 'sql' | 'pull';
  id: number;
  name: string;
  typeLabel: string;
  detail: string;
  status: 'ok' | 'failed' | 'idle';
  statusLabel: string;
  errorMessage?: string | null;
  lastCheckedAt?: string | null;
  isActive: boolean;
  isGoogle: boolean;
  hasCredentials: boolean;
  sql?: SqlConnection;
  pull?: DataSourceConnection;
}

/**
 * Manages every external data source in one place:
 *
 *  - SQL databases (SQL Server, PostgreSQL, MySQL) — queried live by the View Builder
 *  - Pull sources (Google Sheets, Google Drive, REST API) — fetched and stored as datasets
 *
 * They use different endpoints and behave differently, but a user adding "a data source"
 * should not have to know that, so both are created from this one screen.
 */
@Component({
  selector: 'app-data-sources',
  standalone: false,
  templateUrl: './data-sources.component.html',
  styleUrls: ['./data-sources.component.scss'],
})
export class DataSourcesComponent implements OnInit {
  private readonly permissions = inject(PermissionService);

  get canCreate(): boolean {
    return this.permissions.canView('settings.data-sources') && this.permissions.canCreate('settings.data-sources');
  }

  get canModify(): boolean {
    return this.permissions.canView('settings.data-sources') && this.permissions.canModify('settings.data-sources');
  }

  private readonly api = inject(DataSourceService);
  private readonly route = inject(ActivatedRoute);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  loading = true;
  saving = false;
  banner: Banner | null = null;

  rows: SourceRow[] = [];
  kindOptions: DataSourceKindOption[] = [];

  readonly sqlProviders = SQL_PROVIDERS;
  readonly sqlProviderLabels = SQL_PROVIDER_LABELS;

  // ── Create / edit panel ───────────────────────────────────────────────────
  panelMode: PanelMode = 'closed';
  editingRow: SourceRow | null = null;

  formType: AnySourceType = 'mssql';
  formName = '';
  formActive = true;

  // Pull-source fields
  formAuthType: DataSourceAuthType = 'none';
  formValues: Record<string, string> = {};

  // SQL-source fields
  sqlServer = '';
  sqlPort = 1433;
  sqlDatabase = '';
  sqlUsername = '';
  sqlPassword = '';
  sqlTrustCert = true;

  // ── Ingest panel ──────────────────────────────────────────────────────────
  ingestFor: DataSourceConnection | null = null;
  ingestObjects: DataSourceObject[] = [];
  /** Object refs ticked for import. A Drive folder or a workbook can offer several. */
  ingestSelected = new Set<string>();
  /** Dataset name; used only when exactly one object is selected, otherwise each takes its own name. */
  ingestDatasetName = '';
  ingestLoading = false;

  busyId: string | null = null;

  ngOnInit(): void {
    // The Google OAuth callback returns here with ?google=success|error.
    const googleResult = this.route.snapshot.queryParamMap.get('google');
    if (googleResult === 'success') {
      this.banner = { kind: 'success', text: 'Google account connected. Test the data source to confirm access.' };
    } else if (googleResult === 'error') {
      const reason = this.route.snapshot.queryParamMap.get('reason') ?? 'unknown error';
      this.banner = { kind: 'error', text: `Google authorisation failed (${reason}). Please try again.` };
    }

    this.loadOptions();
    this.loadAll();
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  private loadOptions(): void {
    this.api.getOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: options => {
          this.kindOptions = options.kinds;
          this.cdr.markForCheck();
        },
        error: () => this.showError('Could not load data source options.'),
      });
  }

  private loadAll(): void {
    this.loading = true;

    // Both families are fetched together so the list is never half-populated.
    forkJoin({
      sql: this.api.listSqlConnections(),
      pull: this.api.list(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ sql, pull }) => {
          this.rows = [...sql.map(c => this.toSqlRow(c)), ...pull.map(c => this.toPullRow(c))];
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading = false;
          this.showError('Could not load data sources.');
        },
      });
  }

  private toSqlRow(c: SqlConnection): SourceRow {
    return {
      family: 'sql',
      id: c.id,
      name: c.connectionName,
      typeLabel: SQL_PROVIDER_LABELS[c.provider] ?? c.provider,
      detail: `${c.server}:${c.port} · ${c.databaseName}`,
      // Live SQL connections have no stored test result; schema sync is the check.
      status: 'idle',
      statusLabel: 'Live SQL',
      isActive: c.isActive,
      isGoogle: false,
      hasCredentials: true,
      sql: c,
    };
  }

  private toPullRow(c: DataSourceConnection): SourceRow {
    const status = c.lastStatus === 'ok' ? 'ok' : c.lastStatus === 'failed' ? 'failed' : 'idle';
    return {
      family: 'pull',
      id: c.id,
      name: c.connectionName,
      typeLabel: this.kindLabel(c.kind),
      detail: this.describePullConfig(c),
      status,
      statusLabel: status === 'ok' ? 'Connected' : status === 'failed' ? 'Failed' : 'Not tested',
      errorMessage: c.lastErrorMessage,
      lastCheckedAt: c.lastTestedAt,
      isActive: c.isActive,
      isGoogle: c.kind === 'google_sheets' || c.kind === 'google_drive',
      hasCredentials: c.hasCredentials,
      pull: c,
    };
  }

  private describePullConfig(c: DataSourceConnection): string {
    try {
      const config = JSON.parse(c.configJson || '{}') as Record<string, unknown>;
      return String(config['url'] ?? config['spreadsheetId'] ?? config['folderId'] ?? c.authType);
    } catch {
      return c.authType;
    }
  }

  // ── Panel ─────────────────────────────────────────────────────────────────

  openCreate(): void {
    if (!this.canCreate) return;
    this.panelMode = 'create';
    this.editingRow = null;
    this.formName = '';
    this.formActive = true;
    this.formValues = {};
    this.onTypeChange('mssql');
  }

  openEdit(row: SourceRow): void {
    if (!this.canModify) return;
    this.panelMode = 'edit';
    this.editingRow = row;
    this.formName = row.name;
    this.formActive = row.isActive;
    this.formValues = {};

    if (row.family === 'sql' && row.sql) {
      this.formType = row.sql.provider;
      this.sqlServer = row.sql.server;
      this.sqlPort = row.sql.port;
      this.sqlDatabase = row.sql.databaseName;
      this.sqlUsername = row.sql.username;
      this.sqlPassword = '';                 // never returned; blank keeps the stored one
      this.sqlTrustCert = row.sql.trustServerCertificate;
      return;
    }

    if (row.pull) {
      this.formType = row.pull.kind;
      this.formAuthType = row.pull.authType;
      try {
        const config = JSON.parse(row.pull.configJson || '{}') as Record<string, unknown>;
        for (const [key, value] of Object.entries(config)) {
          this.formValues[key] = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
        }
      } catch {
        this.banner = { kind: 'info', text: 'The stored configuration could not be parsed and was left blank.' };
      }
    }
  }

  closePanel(): void {
    this.panelMode = 'closed';
    this.editingRow = null;
  }

  onTypeChange(type: AnySourceType): void {
    this.formType = type;
    this.formValues = {};
    // A dropdown always shows a value, so the saved config must hold it too.
    for (const f of this.configFields) if (f.fieldType === 'select' && f.options?.length) this.formValues[f.name] = f.options[0];

    if (isSqlProvider(type)) {
      this.sqlPort = SQL_PROVIDER_DEFAULT_PORTS[type];
      this.sqlServer = '';
      this.sqlDatabase = '';
      this.sqlUsername = '';
      this.sqlPassword = '';
      this.sqlTrustCert = true;
      return;
    }

    this.formAuthType = this.defaultAuthTypeFor(type);
  }

  get isSqlForm(): boolean {
    return isSqlProvider(this.formType);
  }

  get activeKindOption(): DataSourceKindOption | undefined {
    return this.kindOptions.find(k => k.kind === this.formType);
  }

  get configFields(): DataSourceConfigField[] {
    return this.activeKindOption?.configFields.filter(f => !f.secret) ?? [];
  }

  get secretFields(): DataSourceConfigField[] {
    return this.activeKindOption?.configFields.filter(f => f.secret) ?? [];
  }

  get isGoogleKind(): boolean {
    return this.formType === 'google_sheets' || this.formType === 'google_drive';
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  save(): void {
    if (this.panelMode === 'closed' || !(this.panelMode === 'create' ? this.canCreate : this.canModify)) return;
    if (!this.formName.trim()) {
      this.showError('Enter a name for this data source.');
      return;
    }

    if (this.isSqlForm) {
      this.saveSql();
      return;
    }

    this.savePull();
  }

  private saveSql(): void {
    const provider = this.formType as SqlProvider;

    if (!this.sqlServer.trim() || !this.sqlDatabase.trim() || !this.sqlUsername.trim()) {
      this.showError('Server, Database and Username are required.');
      return;
    }

    if (this.panelMode === 'create' && !this.sqlPassword && this.formType !== 'trino') {
      this.showError('Password is required.');
      return;
    }

    const base: CreateSqlConnectionRequest = {
      connectionName: this.formName.trim(),
      server: this.sqlServer.trim(),
      port: Number(this.sqlPort) || SQL_PROVIDER_DEFAULT_PORTS[provider],
      databaseName: this.sqlDatabase.trim(),
      username: this.sqlUsername.trim(),
      password: this.sqlPassword,
      provider,
      trustServerCertificate: this.sqlTrustCert,
    };

    this.saving = true;

    if (this.panelMode === 'create') {
      this.api.createSqlConnection(base)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: created => {
            this.saving = false;
            this.closePanel();
            this.loadAll();
            this.banner = {
              kind: 'info',
              text: `"${created.connectionName}" created. Choose Sync schema to discover its tables.`,
            };
            this.cdr.markForCheck();
          },
          error: err => this.handleSaveError(err),
        });
      return;
    }

    if (!this.editingRow) return;

    this.api.updateSqlConnection(this.editingRow.id, {
      ...base,
      // Blank password means "keep the stored one".
      password: this.sqlPassword ? this.sqlPassword : null,
      isActive: this.formActive,
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving = false;
          this.closePanel();
          this.loadAll();
          this.banner = { kind: 'success', text: 'Database connection updated.' };
          this.cdr.markForCheck();
        },
        error: err => this.handleSaveError(err),
      });
  }

  private savePull(): void {
    const missing = this.configFields.filter(f => f.required && !this.formValues[f.name]?.trim());
    if (missing.length > 0) {
      this.showError(`${missing.map(f => f.label).join(', ')} is required.`);
      return;
    }

    let config: Record<string, unknown>;
    let credentials: Record<string, string>;
    try {
      ({ config, credentials } = this.splitFormValues());
    } catch (err) {
      // Raised for a malformed JSON value in a key/value field.
      this.showError(err instanceof Error ? err.message : 'One of the fields is not valid.');
      return;
    }

    this.saving = true;

    if (this.panelMode === 'create') {
      const request: CreateDataSourceRequest = {
        connectionName: this.formName.trim(),
        kind: this.formType as DataSourceKind,
        authType: this.formAuthType,
        config,
        credentials,
      };

      this.api.create(request)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: created => {
            this.saving = false;
            this.closePanel();
            this.loadAll();
            this.banner = this.isGoogleKindFor(created.kind)
              ? { kind: 'info', text: `"${created.connectionName}" created. Connect it with Google to authorise access.` }
              : { kind: 'success', text: `"${created.connectionName}" created. Run a test to confirm it works.` };
            this.cdr.markForCheck();
          },
          error: err => this.handleSaveError(err),
        });
      return;
    }

    if (!this.editingRow) return;

    this.api.update(this.editingRow.id, {
      connectionName: this.formName.trim(),
      authType: this.formAuthType,
      config,
      // Null means "keep stored secrets" — only send when the user typed something.
      credentials: Object.keys(credentials).length > 0 ? credentials : null,
      isActive: this.formActive,
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving = false;
          this.closePanel();
          this.loadAll();
          this.banner = { kind: 'success', text: 'Data source updated.' };
          this.cdr.markForCheck();
        },
        error: err => this.handleSaveError(err),
      });
  }

  // ── Row actions ───────────────────────────────────────────────────────────

  /** Test for a pull source; schema sync for a SQL one — both answer "can we reach it?". */
  check(row: SourceRow): void {
    if (!this.canModify) return;
    this.busyId = this.rowKey(row);

    if (row.family === 'sql') {
      this.api.syncSqlSchema(row.id)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: schema => {
            this.busyId = null;
            this.banner = {
              kind: 'success',
              text: `Connected to ${schema.databaseName}. Discovered ${schema.tables.length} table(s).`,
            };
            this.cdr.markForCheck();
          },
          error: err => {
            this.busyId = null;
            this.showError(this.readError(err, 'Could not reach the database.'));
          },
        });
      return;
    }

    this.api.test(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: result => {
          this.busyId = null;
          // A failed test is a 200 with success=false, so branch on the flag.
          this.banner = { kind: result.success ? 'success' : 'error', text: result.message };
          this.loadAll();
          this.cdr.markForCheck();
        },
        error: () => {
          this.busyId = null;
          this.showError('The test could not be run.');
        },
      });
  }

  connectGoogle(row: SourceRow): void {
    if (!this.canModify) return;
    if (!row.pull) return;

    this.api.startGoogleAuth(row.id, row.pull.kind === 'google_drive')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ authorizationUrl }) => { window.location.href = authorizationUrl; },
        error: err => this.showError(this.readError(err, 'Could not start Google authorisation.')),
      });
  }

  openIngest(row: SourceRow): void {
    if (!this.canCreate) return;
    if (!row.pull) return;

    this.ingestFor = row.pull;
    this.ingestObjects = [];
    this.ingestSelected.clear();
    this.ingestDatasetName = '';
    this.ingestLoading = true;

    this.api.listObjects(row.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: objects => {
          this.ingestObjects = objects;
          if (objects[0]) this.ingestSelected.add(objects[0].ref);
          this.ingestDatasetName = objects[0]?.name ?? row.name;
          this.ingestLoading = false;
          this.cdr.markForCheck();
        },
        error: err => {
          this.ingestLoading = false;
          this.showError(this.readError(err, 'Could not list what this source offers.'));
        },
      });
  }

  /** Drive reports MIME types; show the file kind a user recognises. */
  objectTypeLabel(objectType: string): string {
    const known: Record<string, string> = {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
      'application/vnd.ms-excel': 'XLS',
      'application/vnd.google-apps.spreadsheet': 'Google Sheet',
      'text/csv': 'CSV', 'application/csv': 'CSV',
      'application/json': 'JSON', 'text/json': 'JSON',
    };
    return known[objectType] ?? objectType;
  }

  toggleIngestObject(ref: string, checked: boolean): void {
    checked ? this.ingestSelected.add(ref) : this.ingestSelected.delete(ref);
    if (this.ingestSelected.size === 1) {
      const [only] = this.ingestSelected;
      this.ingestDatasetName = this.ingestObjects.find(o => o.ref === only)?.name ?? this.ingestDatasetName;
    }
  }

  toggleAllIngestObjects(checked: boolean): void {
    this.ingestSelected = new Set(checked ? this.ingestObjects.map(o => o.ref) : []);
  }

  get allIngestObjectsSelected(): boolean {
    return this.ingestObjects.length > 0 && this.ingestSelected.size === this.ingestObjects.length;
  }

  closeIngest(): void {
    this.ingestFor = null;
  }

  /**
   * Imports every ticked object, one after another so the API is not hit with parallel fetches
   * from the same Google account. Each becomes its own dataset, named after the file unless a
   * single object is selected and a name was typed. Failures are reported per file; the rest
   * still import.
   */
  runIngest(): void {
    if (!this.canCreate) return;
    const source = this.ingestFor;
    if (!source) return;
    const refs = this.ingestObjects.length ? [...this.ingestSelected] : [null];
    if (!refs.length) { this.showError('Select at least one file to import.'); return; }

    const single = refs.length === 1;
    const nameOf = (ref: string | null) => this.ingestObjects.find(o => o.ref === ref)?.name ?? null;

    this.ingestLoading = true;
    from(refs).pipe(
      concatMap(ref => this.api.ingest(source.id, ref, single ? (this.ingestDatasetName || null) : nameOf(ref)).pipe(
        catchError(err => of({ failed: nameOf(ref) ?? source.connectionName, reason: this.readError(err, 'The import failed.') })),
      )),
      toArray(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(results => {
      this.ingestLoading = false;
      this.closeIngest();
      const done = results.filter((r): r is ImportedDatasetDto => 'datasetName' in r);
      const failed = results.filter((r): r is { failed: string; reason: string } => 'failed' in r);
      const summary = done.map(r => `"${r.datasetName}" (${r.rowCount} rows)`).join(', ');
      if (done.length && !failed.length) {
        this.banner = { kind: 'success', text: `Imported ${summary}. Now available as a chart or tile source.` };
      } else if (done.length) {
        this.banner = { kind: 'error', text: `Imported ${summary}. Failed: ${failed.map(f => `${f.failed} — ${f.reason}`).join('; ')}` };
      } else {
        this.banner = { kind: 'error', text: failed.map(f => `${f.failed} — ${f.reason}`).join('; ') };
      }
      this.loadAll();
      this.cdr.markForCheck();
    });
  }

  remove(row: SourceRow): void {
    if (!this.canModify) return;
    const request$ = row.family === 'sql'
      ? this.api.deleteSqlConnection(row.id)
      : this.api.delete(row.id);

    request$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.banner = { kind: 'success', text: `"${row.name}" deleted.` };
          this.loadAll();
          this.cdr.markForCheck();
        },
        error: () => this.showError('Could not delete the data source.'),
      });
  }

  // ── Display helpers ───────────────────────────────────────────────────────

  kindLabel(kind: string): string {
    return this.kindOptions.find(k => k.kind === kind)?.label ?? kind;
  }

  isGoogleKindFor(kind: string): boolean {
    return kind === 'google_sheets' || kind === 'google_drive';
  }

  /** Family and id together — ids are only unique within a family. */
  rowKey(row: SourceRow): string {
    return `${row.family}-${row.id}`;
  }

  // Angular invokes trackBy unbound, so `this` is the differ, not the component —
  // this must not call any instance member.
  trackByKey(_index: number, row: SourceRow): string {
    return `${row.family}-${row.id}`;
  }

  dismissBanner(): void {
    this.banner = null;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /** Splits the flat form into the config and credentials bags the API expects. */
  private splitFormValues(): { config: Record<string, unknown>; credentials: Record<string, string> } {
    const config: Record<string, unknown> = {};
    const credentials: Record<string, string> = {};

    for (const field of this.activeKindOption?.configFields ?? []) {
      const raw = this.formValues[field.name]?.trim();
      if (!raw) continue;

      if (field.secret) {
        credentials[field.name] = raw;
        continue;
      }

      if (field.fieldType === 'number') {
        const parsed = Number(raw);
        if (!Number.isNaN(parsed)) config[field.name] = parsed;
        continue;
      }

      if (field.fieldType === 'keyvalue') {
        // Entered as JSON so headers and query parameters need no bespoke editor.
        try {
          config[field.name] = JSON.parse(raw);
        } catch {
          throw new Error(`${field.label} must be valid JSON, for example {"X-Key": "value"}.`);
        }
        continue;
      }

      config[field.name] = raw;
    }

    return { config, credentials };
  }

  private defaultAuthTypeFor(kind: AnySourceType): DataSourceAuthType {
    return this.kindOptions.find(k => k.kind === kind)?.supportedAuthTypes[0] ?? 'none';
  }

  private handleSaveError(err: unknown): void {
    this.saving = false;
    this.showError(this.readError(err, 'Could not save the data source.'));
  }

  /** Surfaces the API's own message where there is one — it is written to be shown. */
  private readError(err: unknown, fallback: string): string {
    const body = (err as { error?: { error?: string; message?: string; detail?: string } })?.error;
    return body?.error ?? body?.message ?? body?.detail ?? fallback;
  }

  private showError(text: string): void {
    this.banner = { kind: 'error', text };
    this.cdr.markForCheck();
  }
}
