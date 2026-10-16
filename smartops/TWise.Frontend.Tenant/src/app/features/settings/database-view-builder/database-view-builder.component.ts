import { ChangeDetectorRef, Component, DestroyRef, HostListener, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { PermissionService } from '../../../core/services/permission.service';
import { AiService, AiSqlReview } from '../../../core/services/ai.service';
import { CommonApiService, CreateDatabaseViewRequest, DatabaseViewDetail, DbConnection, DbSchema, DbSchemaTable, ViewContractViolation, ViewIndexAdvice } from '../../../core/services/common-api.service';

export type JoinType = 'Left Join' | 'Inner Join' | 'Right Join' | 'Full Join';
export type MiddleTab = 'tables' | 'filters' | 'options' | 'columns' | 'ctes' | 'indexes';
export type RightTab = 'sql' | 'preview';
export type FilterOperator =
  '=' | '!=' | '>' | '<' | '>=' | '<=' |
  'LIKE' | 'NOT LIKE' | 'Contains' | 'Starts With' | 'Ends With' |
  'IN' | 'NOT IN' |
  'BETWEEN' | 'NOT BETWEEN' |
  'IS NULL' | 'IS NOT NULL';

export interface AvailableTable {
  id: string;
  name: string;
  columns: number;
}

export interface TableInView {
  name: string;
  alias: string;
  columns: number;
  role: 'Base' | 'Join';
}

export interface JoinCondition {
  id: string;
  leftAlias: string;
  leftColumn: string;
  rightAlias: string;
  rightColumn: string;
}

export interface JoinClause {
  id: string;
  type: JoinType;
  table: string;
  alias: string;
  conditions: JoinCondition[];
}

export interface FilterRow {
  id: string;
  tableAlias: string;
  column: string;
  datePart?: string;       // e.g. 'YEAR', 'MONTH' — wraps column in date function
  operator: FilterOperator;
  value: string;
  value2: string;   // used by BETWEEN / NOT BETWEEN
  logic?: 'AND' | 'OR';
  isExpression?: boolean;  // when true, value is raw SQL (e.g. GETDATE(), YEAR(...))
  subqueryCte?: string;    // when set, IN/NOT IN uses SELECT ... FROM CTE
  subqueryColumn?: string; // column to select from the CTE
}

// Column counts are fetched live from /api/database-connections/{id}/schema.

/** Return the right operators for a given SQL data type. */
function operatorsForType(dt: string): FilterOperator[] {
  const d = dt.toLowerCase();
  const isNum = ['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money'].some(t => d.includes(t));
  const isDate = ['date', 'time', 'datetime'].some(t => d.includes(t));
  const isBool = d === 'bit';
  if (isBool)  return ['=', '!=', 'IS NULL', 'IS NOT NULL'];
  if (isNum)   return ['=', '!=', '>', '<', '>=', '<=', 'BETWEEN', 'NOT BETWEEN', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL'];
  if (isDate)  return ['=', '!=', '>', '<', '>=', '<=', 'BETWEEN', 'NOT BETWEEN', 'IS NULL', 'IS NOT NULL'];
  return ['=', '!=', 'Contains', 'Starts With', 'Ends With', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL'];
}

/** Wrap bare date literals (e.g. 2025-01-01) in single quotes if not already quoted or a function. */
function wrapDateLiteral(val: string): string {
  if (!val) return val;
  // Already quoted or is a SQL function/expression — leave as-is
  if (val.startsWith("'") || /[A-Z_]\s*\(/i.test(val)) return val;
  // Looks like a bare date: 2025-01-01 or 2025-01-01T00:00:00
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) return `'${val}'`;
  return val;
}

const VALID_DATE_PARTS = new Set(['YEAR', 'QUARTER', 'MONTH', 'WEEK', 'DAY']);

/** Build the SQL fragment for a single filter row. */
function filterToSql(f: FilterRow): string {
  const rawCol = `${f.tableAlias}.${f.column}`;
  const dp = (f.datePart ?? '').toUpperCase();
  const col = (dp && VALID_DATE_PARTS.has(dp))
    ? `DATEPART(${dp}, ${rawCol})`
    : rawCol;

  // Subquery CTE mode for IN / NOT IN
  if (f.subqueryCte && (f.operator === 'IN' || f.operator === 'NOT IN')) {
    const subCol = f.subqueryColumn || f.column;
    return `${col} ${f.operator} (SELECT ${subCol} FROM ${f.subqueryCte})`;
  }

  // Expression mode: value is raw SQL, no quoting
  if (f.isExpression) {
    const raw = wrapDateLiteral(f.value.trim());
    const raw2 = wrapDateLiteral(f.value2?.trim() ?? '');
    switch (f.operator) {
      case 'IS NULL':      return `${col} IS NULL`;
      case 'IS NOT NULL':  return `${col} IS NOT NULL`;
      case 'BETWEEN':      return `${col} BETWEEN ${raw} AND ${raw2}`;
      case 'NOT BETWEEN':  return `${col} NOT BETWEEN ${raw} AND ${raw2}`;
      case 'IN':           return `${col} IN (${raw})`;
      case 'NOT IN':       return `${col} NOT IN (${raw})`;
      default:             return `${col} ${f.operator} ${raw}`;
    }
  }

  const v = f.value.replaceAll("'", "''");
  const v2 = f.value2?.replaceAll("'", "''") ?? '';
  switch (f.operator) {
    case 'IS NULL':      return `${col} IS NULL`;
    case 'IS NOT NULL':  return `${col} IS NOT NULL`;
    case 'BETWEEN':      return `${col} BETWEEN '${v}' AND '${v2}'`;
    case 'NOT BETWEEN':  return `${col} NOT BETWEEN '${v}' AND '${v2}'`;
    case 'IN':           { const items = f.value.split(',').map(x => `'${x.trim().replaceAll("'", "''")}'`).join(','); return `${col} IN (${items})`; }
    case 'NOT IN':       { const items = f.value.split(',').map(x => `'${x.trim().replaceAll("'", "''")}'`).join(','); return `${col} NOT IN (${items})`; }
    case 'Contains':     return `${col} LIKE '%${v.replace(/[%_[]/g, '[$&]')}%'`;
    case 'Starts With':  return `${col} LIKE '${v.replace(/[%_[]/g, '[$&]')}%'`;
    case 'Ends With':    return `${col} LIKE '%${v.replace(/[%_[]/g, '[$&]')}'`;
    case 'NOT LIKE':     return `${col} NOT LIKE '${v}'`;
    default:             return `${col} ${f.operator} '${v}'`;
  }
}

const JOIN_TYPES: JoinType[] = ['Left Join', 'Inner Join', 'Right Join', 'Full Join'];
const FILTER_OPERATORS: FilterOperator[] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'NOT LIKE', 'Contains', 'Starts With', 'Ends With', 'IN', 'NOT IN', 'BETWEEN', 'NOT BETWEEN', 'IS NULL', 'IS NOT NULL'];
const AGGREGATIONS = ['', 'COUNT', 'COUNT DISTINCT', 'SUM', 'AVG', 'MIN', 'MAX'];

export interface CalcColumn { id: string; expression: string; alias: string; }
export interface SortRow    { id: string; column: string; direction: 'ASC' | 'DESC'; }
export interface CteDefinition { id: string; name: string; sql: string; }
export interface DeclareVariable { id: string; name: string; dataType: string; defaultValue: string; }
export interface UnionBlock {
  id: string;
  sql: string;                                    // raw SQL fallback
  mode: 'raw' | 'structured';                     // toggle between raw textarea and structured fields
  columns: { expression: string; alias: string }[]; // structured columns
  fromSource: string;                             // CTE name or empty
  whereCondition: string;                         // WHERE clause (without the WHERE keyword)
}

export interface SourceJoin {
  id: string;
  source: string;      // referenced CTE/component/view name
  alias: string;       // alias for the joined source
  joinType: 'INNER JOIN' | 'LEFT JOIN' | 'RIGHT JOIN' | 'CROSS JOIN';
  onCondition: string; // ON clause (free text, supports BETWEEN etc.)
}

// Longest-match-first so "CREATE OR REPLACE VIEW" wins over a bare "CREATE".
const SQL_KEYWORDS = [
  'CREATE OR REPLACE VIEW', 'UNION ALL', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN',
  'GROUP BY', 'ORDER BY', 'HAVING', 'SELECT', 'FROM', 'WHERE', 'LIMIT', 'DISTINCT', 'WITH', 'DECLARE',
];

export interface SqlLineView {
  indent: string;
  keyword: string;
  rest: string;
  isComment: boolean;
}

let nextId = 1;
function uid(prefix: string): string {
  return `${prefix}-${nextId++}`;
}

function aliasFor(tableName: string): string {
  const parts = tableName.split('_').filter(Boolean);
  const short = parts.length > 1 ? parts.map(p => p[0]).join('') : tableName.slice(0, 3);
  return short.toLowerCase();
}

@Component({
  selector: 'app-database-view-builder',
  standalone: false,
  templateUrl: './database-view-builder.component.html',
  styleUrls: ['./database-view-builder.component.scss'],
})
export class DatabaseViewBuilderComponent implements OnInit {
  private readonly permissions = inject(PermissionService);

  get canSaveView(): boolean {
    return this.permissions.canView('settings.database-view') && (this.editViewId
      ? this.permissions.canModify('settings.database-view')
      : this.permissions.canCreate('settings.database-view'));
  }

  readonly joinTypes = JOIN_TYPES;
  readonly filterOperators = FILTER_OPERATORS;
  readonly aggregations = AGGREGATIONS;
  readonly viewTypeOptions: { value: 'view' | 'cte' | 'component'; label: string }[] = [
    { value: 'view', label: 'View' },
    { value: 'cte', label: 'CTE' },
    { value: 'component', label: 'Component' },
  ];
  readonly sourceJoinTypes: SourceJoin['joinType'][] = ['INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'CROSS JOIN'];
  readonly filterLogicOptions: ('AND' | 'OR')[] = ['AND', 'OR'];
  readonly sortDirectionOptions: ('ASC' | 'DESC')[] = ['ASC', 'DESC'];
  readonly declareDataTypes = [
    'DATE', 'DATETIME', 'INT', 'BIGINT', 'FLOAT', 'DECIMAL(18,2)',
    'VARCHAR(255)', 'VARCHAR(MAX)', 'NVARCHAR(255)', 'NVARCHAR(MAX)', 'BIT',
  ];

  // ─── Resizable 3-panel layout (drag the dot dividers between panels) ───
  sourcesWidth = 257;
  rightWidth = 300;
  private readonly MIN_SOURCES_WIDTH = 200;
  private readonly MAX_SOURCES_WIDTH = 480;
  private readonly MIN_RIGHT_WIDTH = 240;
  private readonly MAX_RIGHT_WIDTH = 560;
  resizingPanel: 'sources' | 'right' | null = null;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  /** Below this the layout stacks to a single column (see .db-builder-layout media query), so the
   *  inline grid-template-columns must not apply or it would fight that responsive layout. */
  isDesktopViewport = true;

  get layoutGridColumns(): string | null {
    if (!this.isDesktopViewport) return null;
    return `${this.sourcesWidth}px 4px minmax(0, 1fr) 4px ${this.rightWidth}px`;
  }

  onDividerMouseDown(event: MouseEvent, panel: 'sources' | 'right'): void {
    this.resizingPanel = panel;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = panel === 'sources' ? this.sourcesWidth : this.rightWidth;
    event.preventDefault();
  }

  @HostListener('document:mousemove', ['$event'])
  onDividerMouseMove(event: MouseEvent): void {
    if (!this.resizingPanel) return;
    const delta = event.clientX - this.resizeStartX;
    if (this.resizingPanel === 'sources') {
      this.sourcesWidth = Math.min(this.MAX_SOURCES_WIDTH, Math.max(this.MIN_SOURCES_WIDTH, this.resizeStartWidth + delta));
    } else {
      // Right panel sits on the right edge, so dragging left grows it.
      this.rightWidth = Math.min(this.MAX_RIGHT_WIDTH, Math.max(this.MIN_RIGHT_WIDTH, this.resizeStartWidth - delta));
    }
  }

  @HostListener('document:mouseup')
  onDividerMouseUp(): void {
    this.resizingPanel = null;
  }

  @HostListener('window:resize')
  onWindowResizeCheckViewport(): void {
    this.isDesktopViewport = window.innerWidth > 1280;
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.connSelectOpen = false;
    this.openDropdownKey = null;
  }

  // -- Save state -------------------------------------
  saveLoading = false;
  saveError = '';
  saveAttempted = false;
  // -- Preview state --------------------------------
  previewLoading = false;
  previewError = '';
  previewData: { columns: string[]; rows: Record<string, unknown>[] } | null = null;
  // -- Column enhancements ---------------------------
  columnTransforms: Record<string, string> = {};     // key: alias.col ? 'YEAR'|'UPPER' etc
  columnAggregations: Record<string, string> = {};   // key: alias.col ? 'SUM'|'COUNT' etc
  calcColumns: CalcColumn[] = [];
  // -- Custom dropdown state (Aggregate/Transform grid + all other selects) ----
  openDropdownKey: string | null = null;
  dropdownPos: { top: number; left: number; width: number } | null = null;
  dropdownSearch = '';
  // -- Sort & limit ----------------------------------
  sortRows: SortRow[] = [];
  rowLimit: number | null = null;
  // -- GROUP BY & HAVING -----------------------------
  groupByExpressions: string[] = [];
  havingCondition = '';
  // -- DECLARE variables ------------------------------
  declareVariables: DeclareVariable[] = [];
  // -- CTEs & UNION ALL ------------------------------
  cteDefinitions: CteDefinition[] = [];
  unionBlocks: UnionBlock[] = [];

  // -- View Type & reusable references ----------------
  viewType: 'view' | 'cte' | 'component' = 'view';
  /** Saved CTE-type and view-type items available for subquery referencing */
  availableCtes: { id: number; name: string; sql: string; viewType: string }[] = [];
  /** Saved component-type and view-type items available for UNION ALL */
  availableComponents: { id: number; name: string; sql: string; viewType: string }[] = [];
  /** IDs of CTEs selected for use in this view */
  referencedCteIds: Set<number> = new Set();
  /** IDs of components selected for UNION ALL in this view */
  referencedComponentIds: Set<number> = new Set();
  /** CTE name to use as FROM source when no base table is selected */
  fromCte = '';
  /** Alias for the primary FROM source */
  fromCteAlias = '';
  /** Joins between referenced sources (CTEs, components, views) */
  sourceJoins: SourceJoin[] = [];

  viewName = '';
  /** Stored as the view description; rule 4 of the view contract expects the grain here. */
  viewDescription = '';
  /** Contract result for the view being edited; null for a new view. */
  contractViolations: ViewContractViolation[] | null = null;

  activeMiddleTab: MiddleTab = 'tables';
  // -- Indexes tab: existing and suggested indexes for the tables the SQL reads --
  indexAdvice: ViewIndexAdvice | null = null;
  indexLoading = false;
  indexError = '';
  /** SQL the current advice was built from; the tab re-checks only when the SQL changed. */
  private indexAdviceSql = '';
  copiedIndexSql = '';
  activeRightTab: RightTab = 'sql';

  searchQuery = '';

  baseTable = { name: '', alias: '' };

  joins: JoinClause[] = [];

  // -- Database connection dropdown ----------------------------------
  connections: DbConnection[] = [];
  selectedConnectionId: number | null = null;
  connectionsLoading = false;
  schemaLoading = false;
  connSelectOpen = false;

  availableTables: AvailableTable[] = [];
  /** Full list from the selected schema — used to restore when a join is removed. */
  private allSchemaTables: AvailableTable[] = [];
  /** Column names keyed by table name, populated from schema API. */
  private columnsCache: Record<string, string[]> = {};
  /** Column data types keyed by tableName ? columnName ? dataType. */
  private readonly columnTypesCache: Record<string, Record<string, string>> = {};
  /** Memoized transform options per alias.col — stable references prevent *ngFor re-rendering. */
  private readonly transformsCache: Record<string, string[]> = {};

  filters: FilterRow[] = [];
  distinctRows = false;

  selectedColumns: Record<string, boolean> = {};
  outputAliases: Record<string, string> = {};

  editSql = false;
  manualSql: string | null = null;
  copied = false;
  /** AI review of the current SQL (SQL review feature): shown under the SQL tab. */
  canAiReview = false;
  aiReview: AiSqlReview | null = null;
  aiReviewLoading = false;
  aiReviewError = '';

  showResetConfirm = false;
  showDiscardConfirm = false;

  private readonly expandedSections = new Set<string>();

  /** Collapsed data-source groups. Subquery & Union start collapsed; table groups stay expanded. */
  readonly collapsedGroups = new Set<string>(['subquery', 'union']);

  private readonly destroyRef = inject(DestroyRef);

  /** When editing an existing view, holds its id. */
  editViewId: number | null = null;
  private pendingEditDetail: DatabaseViewDetail | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly commonApi: CommonApiService,
    private readonly cdr: ChangeDetectorRef,
    private readonly ai: AiService,
  ) {
    this.syncSelectedColumns();
  }

  ngOnInit(): void {
    this.ai.features().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: f => { this.canAiReview = f.enabled.includes('sql'); this.cdr.markForCheck(); }, error: () => { /* button stays hidden */ } });
    this.isDesktopViewport = window.innerWidth > 1280;
    const editId = this.route.snapshot.queryParamMap.get('editId');
    if (editId) {
      this.editViewId = Number(editId);
    }

    const typeParam = this.route.snapshot.queryParamMap.get('type');
    if (typeParam === 'cte' || typeParam === 'component') {
      this.viewType = typeParam;
    }

    this.connectionsLoading = true;
    this.commonApi.getConnections().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (list) => {
        this.connections = list;
        this.connectionsLoading = false;
        // If editing, load the view detail first, then schema
        if (this.editViewId) {
          this.loadEditView(this.editViewId);
        } else if (list.length === 1) {
          this.selectedConnectionId = list[0].id;
          this.loadSchema(list[0].id);
        }
        this.cdr.markForCheck();
      },
      error: () => { this.connectionsLoading = false; this.cdr.markForCheck(); },
    });

    // Load available CTEs and components for the builder
    this.loadAvailableSources();
  }

  /** Load all saved views/CTEs/components as potential sources */
  private loadAvailableSources(): void {
    this.commonApi.getDatabaseViews().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (items) => {
        // Exclude the current view being edited
        const filtered = items.filter(v => v.id !== this.editViewId);
        // All saved items can be used as subquery (CTE) or union (component) sources
        this.availableCtes = filtered
          .map(v => ({ id: v.id, name: v.viewName, sql: '', viewType: v.viewType }));
        this.availableComponents = filtered
          .map(v => ({ id: v.id, name: v.viewName, sql: '', viewType: v.viewType }));
        // Eagerly load SQL for any IDs that are already referenced (editing existing view)
        for (const id of this.referencedCteIds) this.loadRefSql(id, 'cte');
        for (const id of this.referencedComponentIds) this.loadRefSql(id, 'component');
        this.cdr.markForCheck();
      },
    });
  }

  toggleCteRef(id: number): void {
    if (this.referencedCteIds.has(id)) {
      this.referencedCteIds.delete(id);
    } else {
      this.referencedCteIds.add(id);
      this.loadRefSql(id, 'cte');
    }
  }

  toggleComponentRef(id: number): void {
    if (this.referencedComponentIds.has(id)) {
      this.referencedComponentIds.delete(id);
    } else {
      this.referencedComponentIds.add(id);
      this.loadRefSql(id, 'component');
    }
  }

  /** Lazy-load generated SQL for a referenced CTE or component */
  private loadRefSql(id: number, type: 'cte' | 'component'): void {
    const list = type === 'cte' ? this.availableCtes : this.availableComponents;
    const item = list.find(c => c.id === id);
    if (!item || item.sql) return; // already loaded
    this.commonApi.getDatabaseViewById(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (detail) => {
        item.sql = detail.manualSql || detail.generatedSql;
        this.cdr.markForCheck();
      },
    });
  }

  get referencedCteNames(): string[] {
    return this.availableCtes.filter(c => this.referencedCteIds.has(c.id)).map(c => c.name);
  }

  /** All referenced source names (subquery + union) for the FROM Source dropdown */
  get allReferencedSourceNames(): string[] {
    const names = new Set<string>();
    for (const c of this.availableCtes) {
      if (this.referencedCteIds.has(c.id)) names.add(c.name);
    }
    for (const c of this.availableComponents) {
      if (this.referencedComponentIds.has(c.id)) names.add(c.name);
    }
    // Include current view name for recursive self-reference (e.g. FROM Months inside Months CTE)
    if (this.viewName.trim()) names.add(this.viewName.trim());
    // Include inline CTE definitions
    for (const cte of this.cteDefinitions) {
      if (cte.name) names.add(cte.name);
    }
    return [...names];
  }

  private loadEditView(viewId: number): void {
    this.commonApi.getDatabaseViewById(viewId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (detail) => {
        this.pendingEditDetail = detail;
        this.selectedConnectionId = detail.connectionId;
        this.viewName = detail.viewName;
        this.viewDescription = detail.description ?? '';
        this.contractViolations = detail.contractViolations ?? null;
        this.distinctRows = detail.isDistinct;
        this.viewType = (detail.viewType as 'view' | 'cte' | 'component') || 'view';

        // Restore referenced CTE/component IDs
        try {
          const cteIds = JSON.parse(detail.referencedCteIdsJson || '[]') as number[];
          this.referencedCteIds = new Set(cteIds);
        } catch { this.referencedCteIds = new Set(); }
        try {
          const compIds = JSON.parse(detail.referencedComponentIdsJson || '[]') as number[];
          this.referencedComponentIds = new Set(compIds);
        } catch { this.referencedComponentIds = new Set(); }

        this.loadSchema(detail.connectionId);
      },
      error: () => { this.saveError = 'Failed to load view for editing.'; this.cdr.markForCheck(); },
    });
  }

  private applyEditDetail(detail: DatabaseViewDetail): void {
    // Restore tables & joins from saved JSON
    try {
      const tables = JSON.parse(detail.tablesJson || '[]') as TableInView[];
      const base = tables.find(t => t.role === 'Base');
      if (base) {
        this.baseTable = { name: base.name, alias: base.alias };
      }
    } catch { /* ignore */ }

    try {
      this.joins = JSON.parse(detail.joinsJson || '[]') as JoinClause[];
    } catch { this.joins = []; }

    try {
      const selectedCols = JSON.parse(detail.selectedColumnsJson || '[]') as string[];
      // Reset all to false, then enable saved ones
      this.allSelectableColumns.forEach(key => { this.selectedColumns[key] = false; });
      selectedCols.forEach(key => { this.selectedColumns[key] = true; });
    } catch { /* ignore */ }

    try {
      this.outputAliases = JSON.parse(detail.columnAliasesJson || '{}');
    } catch { this.outputAliases = {}; }

    try {
      this.filters = JSON.parse(detail.filtersJson || '[]') as FilterRow[];
    } catch { this.filters = []; }

    if (detail.manualSql) {
      this.editSql = true;
      this.manualSql = detail.manualSql;
    }

    // Hydrate DECLARE variables from generatedSql
    this.declareVariables = this.parseDeclareStatements(detail.generatedSql || '');

    // Remove tables in view from available tables
    const inViewNames = new Set(this.tablesInView.map(t => t.name));
    this.availableTables = this.allSchemaTables.filter(t => !inViewNames.has(t.name));

    this.syncSelectedColumns();
    this.cdr.markForCheck();
  }

  onConnectionChange(connectionId: number | null): void {
    this.selectedConnectionId = connectionId;
    if (!connectionId) return;
    // Switching the data source only invalidates the schema-bound builder state; keep the
    // view name the user already typed/loaded (the explicit Reset button still clears it).
    const preservedViewName = this.viewName;
    this.resetBuilder();
    this.viewName = preservedViewName;
    this.loadSchema(connectionId);
  }

  get selectedConnectionLabel(): string {
    const c = this.connections.find(x => x.id === this.selectedConnectionId);
    return c ? `${c.connectionName} (${c.databaseName})` : '';
  }

  toggleConnSelect(event: Event): void {
    event.stopPropagation();
    if (this.connectionsLoading) return;
    this.connSelectOpen = !this.connSelectOpen;
  }

  selectConnection(connectionId: number): void {
    this.connSelectOpen = false;
    if (connectionId === this.selectedConnectionId) return;
    this.onConnectionChange(connectionId);
  }

  private loadSchema(connectionId: number): void {
    this.schemaLoading = true;
    this.availableTables = [];
    this.allSchemaTables = [];
    this.columnsCache = {};
    this.commonApi.getConnectionSchema(connectionId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (schema: DbSchema) => {
        const inViewNames = new Set(this.tablesInView.map(t => t.name));
        this.allSchemaTables = schema.tables.map((t: DbSchemaTable) => {
          const fullName = t.schemaName ? `${t.schemaName}.${t.tableName}` : t.tableName;
          return { id: fullName, name: fullName, columns: t.columnCount };
        });
        // Pre-populate columns cache from schema response
        schema.tables.forEach((t: DbSchemaTable) => {
          const fullName = t.schemaName ? `${t.schemaName}.${t.tableName}` : t.tableName;
          this.columnsCache[fullName] = [...t.columns]
            .sort((a, b) => a.ordinalPosition - b.ordinalPosition)
            .map(c => c.columnName);
          this.columnTypesCache[fullName] = {};
          t.columns.forEach(c => { this.columnTypesCache[fullName][c.columnName] = c.dataType; });
        });
        this.availableTables = this.allSchemaTables.filter(t => !inViewNames.has(t.name));
        this.schemaLoading = false;

        // If editing, apply the saved state now that schema is loaded
        if (this.pendingEditDetail) {
          this.applyEditDetail(this.pendingEditDetail);
          this.pendingEditDetail = null;
        }

        this.cdr.markForCheck();
      },
      error: () => { this.schemaLoading = false; this.saveError = 'Failed to load database schema.'; this.cdr.markForCheck(); },
    });
  }

  isExpanded(key: string): boolean {
    return this.expandedSections.has(key);
  }

  toggleExpand(key: string): void {
    if (this.expandedSections.has(key)) this.expandedSections.delete(key);
    else this.expandedSections.add(key);
  }

  isGroupCollapsed(key: string): boolean {
    return this.collapsedGroups.has(key);
  }

  toggleGroup(key: string): void {
    if (this.collapsedGroups.has(key)) this.collapsedGroups.delete(key);
    else this.collapsedGroups.add(key);
  }

  // ---------- Tables in view / schema helpers ----------

  get tablesInView(): TableInView[] {
    const base: TableInView[] = this.baseTable.name
      ? [{ name: this.baseTable.name, alias: this.baseTable.alias, columns: this.columnsFor(this.baseTable.name).length, role: 'Base' }]
      : [];
    return [
      ...base,
      ...this.joins.map(j => ({ name: j.table, alias: j.alias, columns: this.columnsFor(j.table).length, role: 'Join' as const })),
    ];
  }

  get filteredAvailableTables(): AvailableTable[] {
    const term = this.searchQuery.trim().toLowerCase();
    if (!term) return this.availableTables;
    return this.availableTables.filter(t => t.name.toLowerCase().includes(term));
  }

  get filteredAvailableCtes(): { id: number; name: string; sql: string; viewType: string }[] {
    const term = this.searchQuery.trim().toLowerCase();
    if (!term) return this.availableCtes;
    return this.availableCtes.filter(c => c.name.toLowerCase().includes(term));
  }

  get filteredAvailableComponents(): { id: number; name: string; sql: string; viewType: string }[] {
    const term = this.searchQuery.trim().toLowerCase();
    if (!term) return this.availableComponents;
    return this.availableComponents.filter(c => c.name.toLowerCase().includes(term));
  }

  get filteredTablesInView(): TableInView[] {
    const term = this.searchQuery.trim().toLowerCase();
    if (!term) return this.tablesInView;
    return this.tablesInView.filter(t => t.name.toLowerCase().includes(term));
  }

  /** Returns type-appropriate filter operators for the column a filter row targets. */
  operatorsForFilter(f: FilterRow): FilterOperator[] {
    const tableName = this.tableNameFor(f.tableAlias);
    const dt = this.columnTypesCache[tableName]?.[f.column] ?? 'varchar';
    return operatorsForType(dt);
  }

  /** Date-part options for a filter row (empty array if column is not a date). */
  datePartsForFilter(f: FilterRow): string[] {
    const tableName = this.tableNameFor(f.tableAlias);
    const dt = (this.columnTypesCache[tableName]?.[f.column] ?? '').toLowerCase();
    if (['date', 'datetime', 'datetime2', 'smalldatetime'].some(t => dt.includes(t)))
      return ['', 'YEAR', 'QUARTER', 'MONTH', 'WEEK', 'DAY'];
    return [];
  }

  /** True when the operator needs no value input. */
  operatorHasNoValue(op: FilterOperator): boolean {
    return op === 'IS NULL' || op === 'IS NOT NULL';
  }

  /** True when the operator needs a second value (BETWEEN). */
  operatorNeedsValue2(op: FilterOperator): boolean {
    return op === 'BETWEEN' || op === 'NOT BETWEEN';
  }

  // ---------- Column data type helpers ----------

  dataTypeFor(alias: string, col: string): string {
    const tableName = this.tableNameFor(alias);
    return this.columnTypesCache[tableName]?.[col] ?? 'varchar';
  }

  transformsForColumn(alias: string, col: string): string[] {
    const key = `${alias}.${col}`;
    if (this.transformsCache[key]) return this.transformsCache[key];
    const dt = this.dataTypeFor(alias, col).toLowerCase();
    let result: string[];
    if (['date', 'datetime', 'datetime2', 'smalldatetime'].some(t => dt.includes(t)))
      result = ['', 'YEAR', 'QUARTER', 'MONTH', 'WEEK', 'DAY', 'HOUR'];
    else if (['varchar', 'nvarchar', 'char', 'nchar', 'text'].some(t => dt.includes(t)))
      result = ['', 'UPPER', 'LOWER', 'TRIM'];
    else
      result = [];
    this.transformsCache[key] = result;
    return result;
  }

  getTransform(alias: string, col: string): string {
    return this.columnTransforms[`${alias}.${col}`] ?? '';
  }

  setTransform(alias: string, col: string, value: string): void {
    this.columnTransforms[`${alias}.${col}`] = value;
  }

  getAggregation(alias: string, col: string): string {
    return this.columnAggregations[`${alias}.${col}`] ?? '';
  }

  setAggregation(alias: string, col: string, value: string): void {
    this.columnAggregations[`${alias}.${col}`] = value;
  }

  toggleDropdown(event: Event, key: string, disabled = false): void {
    event.stopPropagation();
    if (disabled) return;
    if (this.openDropdownKey === key) {
      this.openDropdownKey = null;
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const width = Math.max(rect.width, 260);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    this.dropdownPos = { top: rect.bottom + 4, left: Math.max(left, 8), width };
    this.openDropdownKey = key;
    this.dropdownSearch = '';
  }

  isDropdownOpen(key: string): boolean {
    return this.openDropdownKey === key;
  }

  closeDropdown(): void {
    this.openDropdownKey = null;
  }

  private get dropdownSearchTerm(): string {
    return this.dropdownSearch.trim().toLowerCase();
  }

  /** Filters a plain string option list against the current dropdown search box.
   *  Generic so literal-union arrays (e.g. JoinType[]) keep their type through the filter. */
  filterStrings<T extends string>(items: T[]): T[] {
    const t = this.dropdownSearchTerm;
    return t ? items.filter(i => i.toLowerCase().includes(t)) : items;
  }

  /** Filters {alias, table} option lists (join/filter table-alias pickers). */
  filterAliases(items: { alias: string; table: string }[]): { alias: string; table: string }[] {
    const t = this.dropdownSearchTerm;
    return t ? items.filter(a => `${a.alias} ${a.table}`.toLowerCase().includes(t)) : items;
  }

  /** Filters the view-type {value, label} option list. */
  filterViewTypeOptions(): { value: 'view' | 'cte' | 'component'; label: string }[] {
    const t = this.dropdownSearchTerm;
    return t ? this.viewTypeOptions.filter(o => o.label.toLowerCase().includes(t)) : this.viewTypeOptions;
  }

  selectAggregation(alias: string, col: string, value: string): void {
    this.setAggregation(alias, col, value);
    this.openDropdownKey = null;
  }

  selectTransform(alias: string, col: string, value: string): void {
    this.setTransform(alias, col, value);
    this.openDropdownKey = null;
  }

  get hasAnyAggregation(): boolean {
    return Object.values(this.columnAggregations).some(v => !!v);
  }

  /** Build a SELECT expression for alias.col with transforms + aggregation applied. */
  buildColExpr(alias: string, col: string): string {
    const dt = this.dataTypeFor(alias, col).toLowerCase();
    const transform = this.getTransform(alias, col);
    const agg = this.getAggregation(alias, col);
    let expr = `${alias}.${col}`;

    if (transform) {
      const isDate = ['date', 'datetime'].some(t => dt.includes(t));
      if (isDate) {
        const qpart = ['QUARTER', 'WEEK', 'HOUR'];
        expr = qpart.includes(transform)
          ? `DATEPART(${transform.toLowerCase()}, ${expr})`
          : `${transform}(${expr})`;
      } else {
        expr = `${transform}(${expr})`;
      }
    }

    if (agg) {
      expr = agg === 'COUNT DISTINCT' ? `COUNT(DISTINCT ${expr})` : `${agg}(${expr})`;
    }

    return expr;
  }

  // ---------- Calculated columns ----------

  addCalcColumn(): void {
    this.calcColumns.push({ id: uid('calc'), expression: '', alias: `col_${this.calcColumns.length + 1}` });
  }

  removeCalcColumn(calc: CalcColumn): void {
    this.calcColumns = this.calcColumns.filter(c => c.id !== calc.id);
  }

  // ---------- Sort / ORDER BY ----------

  addSortRow(): void {
    const first = this.selectedColumnKeys[0] ?? '';
    this.sortRows.push({ id: uid('sort'), column: first, direction: 'ASC' });
  }

  removeSortRow(sort: SortRow): void {
    this.sortRows = this.sortRows.filter(s => s.id !== sort.id);
  }

  // ---------- GROUP BY & HAVING ----------

  addGroupByExpression(): void {
    this.groupByExpressions.push('');
  }

  removeGroupByExpression(index: number): void {
    this.groupByExpressions.splice(index, 1);
  }

  trackByIndex(index: number): number {
    return index;
  }

  // ---------- Source Joins ----------

  addSourceJoin(): void {
    this.sourceJoins.push({ id: uid('sj'), source: '', alias: '', joinType: 'INNER JOIN', onCondition: '' });
  }

  removeSourceJoin(join: SourceJoin): void {
    this.sourceJoins = this.sourceJoins.filter(j => j.id !== join.id);
  }

  // ---------- CTEs ----------

  addDeclareVariable(): void {
    this.declareVariables.push({ id: uid('decl'), name: '', dataType: 'DATE', defaultValue: '' });
  }

  removeDeclareVariable(decl: DeclareVariable): void {
    this.declareVariables = this.declareVariables.filter(d => d.id !== decl.id);
  }

  private parseDeclareStatements(sql: string): DeclareVariable[] {
    const re = /DECLARE\s+(@\w+)\s+([\w(),.]+?)(?:\s*=\s*([^;]+))?;/gi;
    const results: DeclareVariable[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      results.push({ id: uid('decl'), name: m[1], dataType: m[2].trim(), defaultValue: (m[3] ?? '').trim() });
    }
    return results;
  }

  addCte(): void {
    this.cteDefinitions.push({ id: uid('cte'), name: `cte_${this.cteDefinitions.length + 1}`, sql: '' });
  }

  removeCte(cte: CteDefinition): void {
    this.cteDefinitions = this.cteDefinitions.filter(c => c.id !== cte.id);
    // Clear subquery refs that pointed to removed CTE
    this.filters.forEach(f => { if (f.subqueryCte === cte.name) { f.subqueryCte = ''; f.subqueryColumn = ''; } });
  }

  get cteNames(): string[] {
    const inline = this.cteDefinitions.filter(c => c.name).map(c => c.name);
    const referenced = this.referencedCteNames;
    return [...new Set([...referenced, ...inline])];
  }

  // ---------- UNION ALL blocks ----------

  addUnionBlock(): void {
    this.unionBlocks.push({
      id: uid('union'), sql: '', mode: 'structured',
      columns: [{ expression: '', alias: '' }],
      fromSource: '', whereCondition: ''
    });
  }

  addUnionBlockColumn(block: UnionBlock): void {
    block.columns.push({ expression: '', alias: '' });
  }

  removeUnionBlockColumn(block: UnionBlock, idx: number): void {
    block.columns.splice(idx, 1);
  }

  removeUnionBlock(block: UnionBlock): void {
    this.unionBlocks = this.unionBlocks.filter(b => b.id !== block.id);
  }

  // ---------- Filter helpers ----------

  /** Whether the IN/NOT IN filter uses a CTE subquery reference. */
  isSubqueryFilter(f: FilterRow): boolean {
    return (f.operator === 'IN' || f.operator === 'NOT IN') && !!f.subqueryCte;
  }

  columnsFor(tableName: string): string[] {
    return this.columnsCache[tableName] ?? [];
  }

  // Every alias currently in the FROM/JOIN clauses — used to populate the
  // "left side" / "right side" pickers on join conditions and filters.
  get aliasesInView(): { alias: string; table: string }[] {
    return this.tablesInView.map(t => ({ alias: t.alias, table: t.name }));
  }

  get allSelectableColumns(): string[] {
    return this.tablesInView.flatMap(t => this.columnsFor(t.name).map(col => `${t.alias}.${col}`));
  }

  // Selection state keys off "alias.column" so it survives table renames but
  // resets when a join is added/removed (new keys default to selected).
  private syncSelectedColumns(): void {
    const next: Record<string, boolean> = {};
    for (const key of this.allSelectableColumns) {
      next[key] = this.selectedColumns[key] ?? true;
    }
    this.selectedColumns = next;
  }

  // ---------- Left panel: search + add/remove tables ----------

  addTable(table: AvailableTable): void {
    if (!this.baseTable.name) {
      this.baseTable = { name: table.name, alias: aliasFor(table.name) };
    } else {
      const alias = this.uniqueAlias(aliasFor(table.name));
      const join: JoinClause = { id: uid('join'), type: 'Left Join', table: table.name, alias, conditions: [] };
      this.joins.push(join);
      // Seed a default ON condition so a join is never accidentally left without one.
      this.addCondition(join);
    }
    this.availableTables = this.availableTables.filter(t => t.id !== table.id);
    this.syncSelectedColumns();
  }

  removeJoin(join: JoinClause): void {
    this.joins = this.joins.filter(j => j.id !== join.id);
    const src = this.allSchemaTables.find(s => s.name === join.table);
    if (src && !this.availableTables.some(t => t.name === join.table)) {
      this.availableTables.push({ ...src });
    }
    this.syncSelectedColumns();
  }

  /** Base can only be removed outright while no joins depend on it — otherwise use promoteToBase() to swap. */
  get canRemoveBaseTable(): boolean {
    return !!this.baseTable.name && this.joins.length === 0;
  }

  removeBaseTable(): void {
    if (!this.canRemoveBaseTable) return;
    const src = this.allSchemaTables.find(s => s.name === this.baseTable.name);
    if (src && !this.availableTables.some(t => t.name === this.baseTable.name)) {
      this.availableTables.push({ ...src });
    }
    this.baseTable = { name: '', alias: '' };
    this.syncSelectedColumns();
  }

  private flipJoinType(type: JoinType): JoinType {
    if (type === 'Left Join') return 'Right Join';
    if (type === 'Right Join') return 'Left Join';
    return type; // Inner/Full joins are symmetric — order doesn't change results
  }

  /** Swap this join's table into the Base role, demoting the current base into a join in its place.
   *  All aliases, ON conditions, filters, columns and calculated columns keep referencing the same
   *  alias strings, so nothing else needs to change. Only the demoted join's type is flipped
   *  (Left <-> Right) to keep the exact same rows in the result. */
  promoteToBase(join: JoinClause): void {
    const oldBase = this.baseTable;
    this.baseTable = { name: join.table, alias: join.alias };
    const demoted: JoinClause = {
      id: join.id,
      type: this.flipJoinType(join.type),
      table: oldBase.name,
      alias: oldBase.alias,
      conditions: join.conditions,
    };
    // Demoted table goes first so any join that referenced the old base alias still finds it
    // introduced before it runs, wherever that join sits in the array.
    this.joins = [demoted, ...this.joins.filter(j => j.id !== join.id)];
    this.closeDropdown();
    this.syncSelectedColumns();
  }

  private uniqueAlias(base: string): string {
    const used = new Set(this.aliasesInView.map(a => a.alias));
    if (!used.has(base)) return base;
    let i = 2;
    while (used.has(`${base}${i}`)) i++;
    return `${base}${i}`;
  }

  // ---------- Middle panel: tabs, joins, conditions ----------

  setMiddleTab(tab: MiddleTab): void {
    this.activeMiddleTab = tab;
    if (tab === 'indexes') this.loadIndexAdvice();
  }

  /** Reads existing indexes and suggestions for the tables in the current SQL (nothing is created). */
  loadIndexAdvice(force = false): void {
    const sql = this.displaySql.trim();
    if (!this.selectedConnectionId || !sql) {
      this.indexAdvice = null;
      this.indexError = 'Choose a database and add a table to see its indexes.';
      return;
    }
    if (!force && sql === this.indexAdviceSql && (this.indexAdvice || this.indexLoading)) return;
    this.indexAdviceSql = sql;
    this.indexLoading = true;
    this.indexError = '';
    this.commonApi.getIndexAdvice(this.selectedConnectionId, sql)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: advice => {
          this.indexAdvice = advice;
          this.indexError = advice.supported ? '' : (advice.message ?? 'Index suggestions are not available.');
          this.indexLoading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.indexAdvice = null;
          this.indexAdviceSql = '';
          this.indexError = 'Could not read the indexes. Check the database connection and try again.';
          this.indexLoading = false;
          this.cdr.markForCheck();
        },
      });
  }

  get suggestedIndexCount(): number {
    return this.indexAdvice?.tables.reduce((n, t) => n + t.suggestedIndexes.length, 0) ?? 0;
  }

  copyIndexSql(sql: string): void {
    navigator.clipboard?.writeText(sql).then(() => {
      this.copiedIndexSql = sql;
      setTimeout(() => (this.copiedIndexSql = ''), 1500);
    });
  }

  copyAllIndexSql(): void {
    const all = this.indexAdvice?.tables.flatMap(t => t.suggestedIndexes.map(s => s.createSql)).join('\n') ?? '';
    if (all) this.copyIndexSql(all);
  }

  addCondition(join: JoinClause): void {
    const base = this.aliasesInView.find(a => a.alias === this.baseTable.alias);
    const firstCol = base ? this.columnsFor(base.table)[0] : '';
    const joinCol = this.columnsFor(join.table)[0] ?? '';
    join.conditions.push({
      id: uid('cond'),
      leftAlias: this.baseTable.alias,
      leftColumn: firstCol,
      rightAlias: join.alias,
      rightColumn: joinCol,
    });
  }

  removeCondition(join: JoinClause, condition: JoinCondition): void {
    join.conditions = join.conditions.filter(c => c.id !== condition.id);
  }

  /** A join needs at least one ON condition with both sides fully chosen. */
  isJoinConditionValid(join: JoinClause): boolean {
    return join.conditions.length > 0
      && join.conditions.every(c => !!c.leftAlias && !!c.leftColumn && !!c.rightAlias && !!c.rightColumn);
  }

  // ---------- Filters tab ----------

  addFilter(): void {
    const first = this.aliasesInView[0];
    const tableAlias = first?.alias ?? '';
    const column = first ? (this.columnsFor(first.table)[0] ?? '') : '';
    this.filters.push({ id: uid('filter'), tableAlias, column, operator: '=', value: '', value2: '', logic: 'AND' });
  }

  removeFilter(filter: FilterRow): void {
    this.filters = this.filters.filter(f => f.id !== filter.id);
  }

  tableNameFor(alias: string): string {
    return this.aliasesInView.find(a => a.alias === alias)?.table ?? '';
  }

  isPrimaryKey(tableName: string, col: string): boolean {
    const cols = this.columnsFor(tableName);
    return cols.length > 0 && cols[0] === col;
  }

  selectedCountFor(alias: string, tableName: string): number {
    return this.columnsFor(tableName).filter(col => this.selectedColumns[`${alias}.${col}`]).length;
  }

  selectAllFor(alias: string, tableName: string): void {
    this.columnsFor(tableName).forEach(col => { this.selectedColumns[`${alias}.${col}`] = true; });
  }

  clearFor(alias: string, tableName: string): void {
    this.columnsFor(tableName).forEach(col => { this.selectedColumns[`${alias}.${col}`] = false; });
  }

  selectAllColumns(): void {
    this.allSelectableColumns.forEach(key => { this.selectedColumns[key] = true; });
  }

  clearAllColumns(): void {
    this.allSelectableColumns.forEach(key => { this.selectedColumns[key] = false; });
  }

  private readonly collapsedColGroups = new Set<string>();
  /** Column-name search term per table alias, for the Columns tab. */
  columnSearch: Record<string, string> = {};

  isColGroupExpanded(alias: string): boolean {
    return !this.collapsedColGroups.has(alias);
  }

  setColumnSearch(alias: string, value: string): void {
    this.columnSearch[alias] = value;
  }

  /** Columns for a table filtered by that table's column-search box. */
  visibleColumnsFor(alias: string, tableName: string): string[] {
    const term = (this.columnSearch[alias] ?? '').trim().toLowerCase();
    const cols = this.columnsFor(tableName);
    return term ? cols.filter(c => c.toLowerCase().includes(term)) : cols;
  }

  // Stable key so change detection doesn't rebuild rows (which closes an open native <select>).
  trackByTableAlias(_index: number, table: TableInView): string {
    return table.alias;
  }

  trackByColName(_index: number, col: string): string {
    return col;
  }

  toggleColGroup(alias: string): void {
    if (this.collapsedColGroups.has(alias)) this.collapsedColGroups.delete(alias);
    else this.collapsedColGroups.add(alias);
  }

  getOutputAlias(alias: string, col: string): string {
    return this.outputAliases[`${alias}.${col}`] ?? col;
  }

  setOutputAlias(alias: string, col: string, event: Event): void {
    this.outputAliases[`${alias}.${col}`] = (event.target as HTMLInputElement).value;
  }

  // ---------- Columns tab ----------

  toggleColumn(key: string): void {
    this.selectedColumns[key] = !this.selectedColumns[key];
  }

  get selectedColumnKeys(): string[] {
    return this.allSelectableColumns.filter(key => this.selectedColumns[key]);
  }

  // ---------- SQL generation ----------

  get generatedSql(): string {
    const output: string[] = [];

    // DECLARE variable statements
    const validDecls = this.declareVariables.filter(d => d.name && d.dataType);
    for (const d of validDecls) {
      const name = d.name.startsWith('@') ? d.name : `@${d.name}`;
      const init = d.defaultValue ? ` = ${d.defaultValue}` : '';
      output.push(`DECLARE ${name} ${d.dataType}${init};`);
    }
    if (validDecls.length) output.push('');

    // Collect all CTEs: referenced saved CTEs + inline CTE definitions
    const allCtes: { name: string; sql: string }[] = [];
    const cteNames = new Set<string>();

    // Referenced saved CTEs (from Subquery Sources checkboxes)
    for (const cte of this.availableCtes) {
      if (this.referencedCteIds.has(cte.id) && cte.sql) {
        // Extract any embedded WITH clauses and DECLARE statements from the saved SQL
        const { ctes: embedded, body, declares } = this.extractCtesFromSql(cte.sql);
        // Hoist DECLARE statements to the outer batch
        for (const decl of declares) {
          if (!output.includes(decl)) output.push(decl);
        }
        // Add embedded CTEs as top-level (deduplicated)
        for (const inner of embedded) {
          if (!cteNames.has(inner.name)) {
            allCtes.push(inner);
            cteNames.add(inner.name);
          }
        }
        // Add this CTE with only the body (SELECT part)
        if (!cteNames.has(cte.name)) {
          allCtes.push({ name: cte.name, sql: body });
          cteNames.add(cte.name);
        }
      }
    }

    // Inline CTE definitions (manual textarea)
    const validInlineCtes = this.cteDefinitions.filter(c => c.name && c.sql.trim());
    for (const cte of validInlineCtes) {
      if (!cteNames.has(cte.name)) {
        allCtes.push({ name: cte.name, sql: cte.sql.trim() });
        cteNames.add(cte.name);
      }
    }

    // Collect referenced component union parts (from left panel checkboxes)
    const refUnionRaw: string[] = [];
    for (const comp of this.availableComponents) {
      if (this.referencedComponentIds.has(comp.id) && comp.sql) {
        refUnionRaw.push(comp.sql);
      }
    }
    // Collect inline union blocks (from CTEs & Union tab — always included)
    const inlineUnionRaw: string[] = [];
    for (const block of this.unionBlocks) {
      if (block.mode === 'structured') {
        const validCols = block.columns.filter(c => c.expression);
        if (validCols.length) {
          const lines: string[] = ['SELECT'];
          validCols.forEach((col, i) => {
            const alias = col.alias ? ` AS ${col.alias}` : '';
            lines.push(`  ${col.expression}${alias}${i < validCols.length - 1 ? ',' : ''}`);
          });
          if (block.fromSource) lines.push(`FROM ${block.fromSource}`);
          if (block.whereCondition) lines.push(`WHERE ${block.whereCondition}`);
          inlineUnionRaw.push(lines.join('\n'));
        }
      } else if (block.sql.trim()) {
        inlineUnionRaw.push(block.sql.trim());
      }
    }

    // Extract CTEs embedded in union SQL and strip them
    const refUnionParts: string[] = [];
    for (const raw of refUnionRaw) {
      const { ctes, body, declares } = this.extractCtesFromSql(raw);
      for (const decl of declares) { if (!output.includes(decl)) output.push(decl); }
      for (const cte of ctes) {
        if (!cteNames.has(cte.name)) {
          allCtes.push(cte);
          cteNames.add(cte.name);
        }
      }
      refUnionParts.push(body);
    }
    const inlineUnionParts: string[] = [];
    for (const raw of inlineUnionRaw) {
      const { ctes, body, declares } = this.extractCtesFromSql(raw);
      for (const decl of declares) { if (!output.includes(decl)) output.push(decl); }
      for (const cte of ctes) {
        if (!cteNames.has(cte.name)) {
          allCtes.push(cte);
          cteNames.add(cte.name);
        }
      }
      inlineUnionParts.push(body);
    }

    // Emit deduplicated CTEs once at the top
    if (allCtes.length) {
      allCtes.forEach((cte, i) => {
        output.push(`${i === 0 ? 'WITH' : ','} ${cte.name} AS (`);
        cte.sql.split('\n').forEach(l => output.push(`  ${l}`));
        output.push(')');
      });
      output.push('');
    }

    // Main SELECT block — skip if no base table and no expressions
    const hasCalcColumns = this.calcColumns.some(c => c.expression && c.alias);
    const hasSelectedColumns = this.selectedColumnKeys.length > 0;

    if (this.baseTable.name) {
      output.push(...this.buildSelectBlock());
      for (const part of [...refUnionParts, ...inlineUnionParts]) {
        output.push('', 'UNION ALL', '', ...part.split('\n'));
      }
    } else if (hasCalcColumns || hasSelectedColumns) {
      // Has expressions — SELECT without FROM
      output.push(...this.buildSelectBlockNoFrom());
      // Inline union blocks (CTEs & Union tab) always append
      for (const part of inlineUnionParts) {
        output.push('', 'UNION ALL', '', ...part.split('\n'));
      }
      // Referenced component unions only if 2+ (single = same content as main)
      if (refUnionParts.length > 1) {
        for (const part of refUnionParts) {
          output.push('', 'UNION ALL', '', ...part.split('\n'));
        }
      }
    } else if (refUnionParts.length || inlineUnionParts.length) {
      // No base table, no columns: just join all union parts directly
      const allParts = [...refUnionParts, ...inlineUnionParts];
      allParts.forEach((part, i) => {
        if (i > 0) output.push('', 'UNION ALL', '');
        output.push(...part.split('\n'));
      });
    }

    return output.join('\n');
  }

  /** Extract WITH ... AS (...) blocks from SQL and return them separately from the body */
  private extractCtesFromSql(sql: string): { ctes: { name: string; sql: string }[]; body: string; declares: string[] } {
    const ctes: { name: string; sql: string }[] = [];
    const declares: string[] = [];
    let remaining = sql.trim();

    // Strip leading DECLARE statements and hoist them
    const declRe = /^\s*DECLARE\s+@\w+\s+[\w(),.]+?(?:\s*=[^;]+)?;\s*/i;
    while (declRe.test(remaining)) {
      const m = declRe.exec(remaining)!;
      declares.push(m[0].trim());
      remaining = remaining.slice(m[0].length);
    }

    // Match leading WITH block(s): WITH name AS (...) [, name2 AS (...)]
    const withRegex = /^WITH\s+/i;
    if (!withRegex.test(remaining)) {
      return { ctes, body: remaining, declares };
    }

    // Remove leading WITH keyword
    remaining = remaining.replace(withRegex, '');

    // Parse comma-separated CTE definitions
    while (remaining.length) {
      // Match: name AS (
      const nameMatch = /^(\w+)\s+AS\s*\(\s*/i.exec(remaining);
      if (!nameMatch) break;

      const cteName = nameMatch[1];
      remaining = remaining.slice(nameMatch[0].length);

      // Find matching closing parenthesis (handle nested parens)
      let depth = 1;
      let i = 0;
      while (i < remaining.length && depth > 0) {
        if (remaining[i] === '(') depth++;
        else if (remaining[i] === ')') depth--;
        i++;
      }

      const cteSql = remaining.slice(0, i - 1).trim();
      remaining = remaining.slice(i).trim();
      ctes.push({ name: cteName, sql: cteSql });

      // Check for comma (another CTE follows) or break
      if (remaining.startsWith(',')) {
        remaining = remaining.slice(1).trim();
      } else {
        break;
      }
    }

    return { ctes, body: remaining, declares };
  }

  private buildSelectBlock(): string[] {
    const lines: string[] = [];
    const topClause = this.rowLimit ? ` TOP ${this.rowLimit}` : '';
    lines.push(`SELECT${topClause}`);

    const columns = this.selectedColumnKeys;
    if (columns.length || this.calcColumns.length) {
      const allCols: string[] = [];
      columns.forEach((key, i) => {
        const [a, c] = key.split('.');
        const expr = this.buildColExpr(a, c);
        const outAlias = this.outputAliases[key] ?? c;
        const needsAlias = expr !== key || outAlias !== c;
        const displayExpr = needsAlias ? `${expr} AS ${outAlias}` : expr;
        allCols.push(`  ${this.distinctRows && i === 0 ? 'DISTINCT ' : ''}${displayExpr}`);
      });
      this.calcColumns.filter(c => c.expression && c.alias && /^[a-zA-Z_]\w*$/.test(c.alias)).forEach(c => {
        allCols.push(`  ${c.expression} AS ${c.alias}`);
      });
      allCols.forEach((col, i) => lines.push(`${col}${i < allCols.length - 1 ? ',' : ''}`));
    } else {
      lines.push('  *');
    }

    lines.push(`FROM ${this.baseTable.name} ${this.baseTable.alias}`);

    for (const join of this.joins) {
      const keyword = join.type.toUpperCase();
      if (!join.conditions.length) {
        lines.push(`${keyword} ${join.table} ${join.alias} /* define join condition */`);
        continue;
      }
      const on = join.conditions.map(c => `${c.leftAlias}.${c.leftColumn} = ${c.rightAlias}.${c.rightColumn}`).join(' AND ');
      lines.push(`${keyword} ${join.table} ${join.alias} ON ${on}`);
    }

    if (this.filters.length) {
      const active = this.filters.filter(f => f.column);
      if (active.length) {
        const parts = active.map((f, i) => {
          const prefix = i === 0 ? 'WHERE' : (active[i].logic ?? 'AND');
          return `${i === 0 ? '' : '  '}${prefix} ${filterToSql(f)}`;
        });
        lines.push(parts.join('\n'));
      }
    }

    // GROUP BY — explicit expressions take priority, then auto from aggregations
    const explicitGroupBy = this.groupByExpressions.filter(g => g.trim());
    if (explicitGroupBy.length) {
      lines.push(`GROUP BY ${explicitGroupBy.join(', ')}`);
    } else if (this.hasAnyAggregation) {
      const groupCols = columns
        .filter(key => !this.columnAggregations[key])
        .map(key => { const [a, c] = key.split('.'); return this.buildColExpr(a, c); });
      if (groupCols.length) lines.push(`GROUP BY ${groupCols.join(', ')}`);
    }

    // HAVING
    if (this.havingCondition.trim()) {
      lines.push(`HAVING ${this.havingCondition.trim()}`);
    }

    // ORDER BY
    const activeSorts = this.sortRows.filter(s => s.column);
    if (activeSorts.length) {
      const orderExpr = activeSorts.map(s => `${s.column} ${s.direction}`).join(', ');
      lines.push(`ORDER BY ${orderExpr}`);
    }

    return lines;
  }

  /** Build SELECT block without FROM — for expression-only queries (e.g. CTEs using subqueries) */
  private buildSelectBlockNoFrom(): string[] {
    const lines: string[] = [];
    lines.push('SELECT');

    const allCols: string[] = [];
    this.selectedColumnKeys.forEach((key, i) => {
      const [a, c] = key.split('.');
      const expr = this.buildColExpr(a, c);
      const outAlias = this.outputAliases[key] ?? c;
      const needsAlias = expr !== key || outAlias !== c;
      const displayExpr = needsAlias ? `${expr} AS ${outAlias}` : expr;
      allCols.push(`  ${this.distinctRows && i === 0 ? 'DISTINCT ' : ''}${displayExpr}`);
    });
    this.calcColumns.filter(c => c.expression && c.alias && /^[a-zA-Z_]\w*$/.test(c.alias)).forEach(c => {
      allCols.push(`  ${c.expression} AS ${c.alias}`);
    });
    allCols.forEach((col, i) => lines.push(`${col}${i < allCols.length - 1 ? ',' : ''}`));

    // Add FROM <cte> if user selected a CTE as the FROM source
    if (this.fromCte) {
      const alias = this.fromCteAlias.trim() ? ` ${this.fromCteAlias.trim()}` : '';
      lines.push(`FROM ${this.fromCte}${alias}`);
    }

    // Source Joins (JOINs between CTEs/components/views)
    for (const sj of this.sourceJoins) {
      if (!sj.source) continue;
      const alias = sj.alias.trim() ? ` ${sj.alias.trim()}` : '';
      const on = sj.onCondition.trim() ? ` ON ${sj.onCondition.trim()}` : '';
      lines.push(`${sj.joinType} ${sj.source}${alias}${on}`);
    }

    // GROUP BY
    const explicitGroupBy = this.groupByExpressions.filter(g => g.trim());
    if (explicitGroupBy.length) {
      lines.push(`GROUP BY ${explicitGroupBy.join(', ')}`);
    }

    // HAVING
    if (this.havingCondition.trim()) {
      lines.push(`HAVING ${this.havingCondition.trim()}`);
    }

    // ORDER BY
    const activeSorts = this.sortRows.filter(s => s.column);
    if (activeSorts.length) {
      const orderExpr = activeSorts.map(s => `${s.column} ${s.direction}`).join(', ');
      lines.push(`ORDER BY ${orderExpr}`);
    }

    return lines;
  }

  get displaySql(): string {
    return this.editSql && this.manualSql !== null ? this.manualSql : this.generatedSql;
  }

  get sqlLines(): string[] {
    return this.displaySql.split('\n');
  }

  get sqlLineViews(): SqlLineView[] {
    return this.sqlLines.map(line => {
      const [, indent = '', remainder = ''] = /^(\s*)(\S.*|)$/.exec(line) ?? [];
      const keyword = SQL_KEYWORDS.find(k => remainder.toUpperCase().startsWith(k));
      const rest = keyword ? remainder.slice(keyword.length) : remainder;
      return {
        indent,
        keyword: keyword ? remainder.slice(0, keyword.length) : '',
        rest,
        isComment: rest.includes('/*'),
      };
    });
  }

  setRightTab(tab: RightTab): void {
    this.activeRightTab = tab;
  }

  toggleEditSql(): void {
    this.editSql = !this.editSql;
    if (this.editSql && this.manualSql === null) {
      this.manualSql = this.generatedSql;
    }
  }

  rebuildSql(): void {
    this.manualSql = this.generatedSql;
  }

  /** Explains and tunes the SQL shown on the tab; the estimated plan is read without running the query. */
  reviewSql(): void {
    if (!this.selectedConnectionId || this.aiReviewLoading) return;
    const sql = this.displaySql.trim();
    if (!sql) { this.aiReviewError = 'There is no SQL to review yet.'; return; }
    this.aiReviewLoading = true; this.aiReviewError = ''; this.aiReview = null;
    this.ai.sqlReview({ connectionId: this.selectedConnectionId, sql, viewId: null }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => { this.aiReview = r; this.aiReviewLoading = false; this.cdr.markForCheck(); },
      error: err => { this.aiReviewLoading = false; this.aiReviewError = err?.error?.message ?? 'The SQL could not be reviewed.'; this.cdr.markForCheck(); },
    });
  }

  /** Puts the proposed query into the editor (Edit SQL on); the original stays in the review until the next run. */
  useOptimisedSql(): void {
    if (!this.aiReview?.optimisedSql) return;
    this.editSql = true;
    this.manualSql = this.aiReview.optimisedSql;
    this.cdr.markForCheck();
  }

  copySql(): void {
    navigator.clipboard?.writeText(this.displaySql).then(() => {
      this.copied = true;
      setTimeout(() => (this.copied = false), 1500);
    });
  }

  // ---------- Data preview ----------

  get previewColumns(): string[] {
    if (this.previewData) return this.previewData.columns;
    return this.selectedColumnKeys;
  }

  get previewRows(): Record<string, unknown>[] {
    return this.previewData?.rows ?? [];
  }

  /** Strip CREATE VIEW DDL prefix — DECLARE + SELECT batches are accepted by the preview API. */
  private extractSelectForPreview(sql: string): string {
    return sql.replace(/^CREATE\s+OR\s+REPLACE\s+VIEW\s+\S+\s+AS\s*/i, '');
  }

  runPreview(): void {
    if (!this.selectedConnectionId) return;
    // Skip the builder join check when the SQL was written by hand.
    const isManualMode = this.editSql && !!this.manualSql?.trim();
    if (!isManualMode) {
      const badJoin = this.joins.find(j => !this.isJoinConditionValid(j));
      if (badJoin) {
        this.previewError = `Join on "${badJoin.table}" needs a complete ON condition before you can preview.`;
        this.previewData = null;
        this.cdr.markForCheck();
        return;
      }
    }
    this.previewLoading = true;
    this.previewError = '';
    this.previewData = null;
    this.commonApi.previewView({
      connectionId: this.selectedConnectionId,
      sql: this.extractSelectForPreview(this.displaySql),
      viewId: this.editViewId ?? 0,
      maxRows: 100,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => { this.previewLoading = false; this.previewData = data; this.cdr.markForCheck(); },
      error: (err) => { this.previewLoading = false; this.previewError = err?.error?.message || 'Preview failed. Check SQL syntax.'; this.cdr.markForCheck(); },
    });
  }

  // ---------- Header actions ----------

  requestReset(): void {
    this.showResetConfirm = true;
  }

  confirmReset(): void {
    this.resetBuilder();
    this.showResetConfirm = false;
    if (this.selectedConnectionId) this.loadSchema(this.selectedConnectionId);
  }

  private resetBuilder(): void {
    this.viewName = '';
    this.viewDescription = '';
    this.baseTable = { name: '', alias: '' };
    this.joins = [];
    this.filters = [];
    this.distinctRows = false;
    this.editSql = false;
    this.manualSql = null;
    this.searchQuery = '';
    this.activeMiddleTab = 'tables';
    this.activeRightTab = 'sql';
    this.saveError = '';
    this.previewData = null;
    this.previewError = '';
    this.columnTransforms = {};
    this.columnAggregations = {};
    this.calcColumns = [];
    this.sortRows = [];
    this.rowLimit = null;
    this.groupByExpressions = [];
    this.havingCondition = '';
    this.declareVariables = [];
    this.cteDefinitions = [];
    this.unionBlocks = [];
    this.referencedCteIds = new Set();
    this.referencedComponentIds = new Set();
    this.fromCte = '';
    this.fromCteAlias = '';
    this.sourceJoins = [];
    this.columnSearch = {};
    this.availableTables = [...this.allSchemaTables];
    this.syncSelectedColumns();
  }

  cancelReset(): void {
    this.showResetConfirm = false;
  }

  requestDiscard(): void {
    this.showDiscardConfirm = true;
  }

  confirmDiscard(): void {
    this.showDiscardConfirm = false;
    this.router.navigate(['/settings/database-view']);
  }

  cancelDiscard(): void {
    this.showDiscardConfirm = false;
  }

  saveView(): void {
    if (!this.canSaveView) return;
    this.saveError = '';
    this.saveAttempted = true;
    if (!this.viewName.trim()) { this.saveError = 'View name is required.'; return; }
    if (!this.selectedConnectionId) { this.saveError = 'Select a database connection.'; return; }
    if (!/^[a-zA-Z_][a-zA-Z0-9_ ]*$/.test(this.viewName.trim())) {
      this.saveError = 'View name must start with a letter or underscore and contain only letters, digits, spaces, and underscores.';
      return;
    }

    // When user wrote SQL manually, skip builder validations (table/join/alias checks don't apply).
    const isManualMode = this.editSql && !!this.manualSql?.trim();

    if (!isManualMode) {
      const hasUnionSources = this.referencedComponentIds.size > 0 || this.unionBlocks.some(b => b.mode === 'structured' ? b.columns.some(c => c.expression) : b.sql.trim());
      const hasCalcColumns = this.calcColumns.some(c => c.expression && c.alias);
      const hasSubquerySources = this.referencedCteIds.size > 0;
      if (!this.baseTable.name && !hasUnionSources && !hasCalcColumns && !hasSubquerySources) { this.saveError = 'Add at least one table, select sources, or add calculated columns.'; return; }
      const badJoin = this.joins.find(j => !this.isJoinConditionValid(j));
      if (badJoin) { this.saveError = `Join on "${badJoin.table}" needs a complete ON condition.`; return; }
      const aliases = [
        ...this.selectedColumnKeys.map(k => { const [, c] = k.split('.'); return this.outputAliases[k] ?? c; }),
        ...this.calcColumns.filter(c => c.alias).map(c => c.alias),
      ];
      const dups = aliases.filter((a, i) => aliases.indexOf(a) !== i);
      if (dups.length) { this.saveError = `Duplicate output column names: ${[...new Set(dups)].join(', ')}.`; return; }
    }

    this.saveLoading = true;
    const sqlToSave = this.displaySql;

    // Parse tables and column count from SQL for manual mode
    let manualTablesUsed = '';
    let manualColumnCount = 0;
    if (isManualMode && sqlToSave) {
      const clean = sqlToSave.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const tables: string[] = [];
      const fromRe = /\bFROM\s+([\w.]+)/gi;
      const joinRe = /\bJOIN\s+([\w.]+)/gi;
      let m: RegExpExecArray | null;
      while ((m = fromRe.exec(clean)) !== null) tables.push(m[1]);
      while ((m = joinRe.exec(clean)) !== null) tables.push(m[1]);
      manualTablesUsed = [...new Set(tables)].join(',');
      const selIdx = clean.search(/\bSELECT\b/i);
      const fromIdx = clean.search(/\bFROM\b/i);
      if (selIdx !== -1 && fromIdx > selIdx) {
        const colsRaw = clean.slice(selIdx + 6, fromIdx).trim();
        const colsPart = colsRaw.replace(/^DISTINCT\s+/i, '').trim();
        if (colsPart === '*') { manualColumnCount = 1; }
        else { let depth = 0; let cnt = 1; for (const ch of colsPart) { if (ch === '(') depth++; else if (ch === ')') depth--; else if (ch === ',' && depth === 0) cnt++; } manualColumnCount = cnt; }
      }
    }

    const req: CreateDatabaseViewRequest = {
      connectionId: this.selectedConnectionId!,
      viewName: this.viewName.trim(),
      description: this.viewDescription.trim(),
      isDistinct: this.distinctRows,
      tablesJson: isManualMode ? '[]' : JSON.stringify(this.tablesInView),
      joinsJson: isManualMode ? '[]' : JSON.stringify(this.joins),
      selectedColumnsJson: isManualMode ? '[]' : JSON.stringify(this.selectedColumnKeys),
      columnAliasesJson: isManualMode ? '{}' : JSON.stringify(this.outputAliases),
      filtersJson: isManualMode ? '[]' : JSON.stringify(this.filters),
      generatedSql: sqlToSave,
      manualSql: this.manualSql ?? '',
      tablesUsed: isManualMode ? manualTablesUsed : this.tablesInView.map(t => t.name).join(','),
      columnCount: isManualMode ? manualColumnCount : this.selectedColumnKeys.length + this.calcColumns.filter(c => c.expression && c.alias).length,
      viewType: this.viewType,
      referencedCteIdsJson: this.referencedCteIds.size ? JSON.stringify([...this.referencedCteIds]) : undefined,
      referencedComponentIdsJson: this.referencedComponentIds.size ? JSON.stringify([...this.referencedComponentIds]) : undefined,
    };
    const save$ = this.editViewId
      ? this.commonApi.updateView(this.editViewId, req)
      : this.commonApi.saveView(req);
    save$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.saveLoading = false; this.router.navigate(['/settings/database-view']); },
      error: (err) => { this.saveLoading = false; this.saveError = err?.error?.message || 'Failed to save view. Please try again.'; this.cdr.markForCheck(); },
    });
  }
}