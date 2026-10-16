import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { API_ENDPOINTS } from '../constants/api.constants';
import { ApiResponse } from '../models/api-response.model';
import { DbSchemaTable } from './common-api.service';

export type RlsMode = 'plant' | 'none';
export type Cardinality = 'many_to_one' | 'one_to_one';
/** count_rows is COUNTROWS: it counts the rows of a table, and its column is "*". */
export type AggregateFn = 'sum' | 'avg' | 'count' | 'count_distinct' | 'min' | 'max' | 'count_rows';
export type BinaryOp = '+' | '-' | '*' | '/';
export type ConditionOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';

/** script is a View Builder view used exactly as saved: its batch runs as written, with its DECLAREs. */
export type SourceKind = 'table' | 'view' | 'script';

/** Schema name of a view source; its source name is the View Builder view's id. */
export const VIEW_SCHEMA = 'view';

/** Schema name of a script source; its source name is the View Builder view's id. */
export const SCRIPT_SCHEMA = 'script';

/** The column of a script source that holds each row's place in the view's own order, from 1. */
export const ROW_ORDER = 'row_order';

/**
 * A variable a saved view declares, its type and initial value as written (null for a caller who may not read the view's
 * SQL), and the model field ("alias.column") bound to it. bindable is false when the view sets it again after declaring it.
 */
export interface ScriptParameter { name: string; type: string; default: string | null; field: string | null; bindable?: boolean; }

/** A function of one row, for calculated columns only. */
export type RowFn = 'concat' | 'left' | 'right' | 'upper' | 'lower' | 'trim' | 'year' | 'month'
  | 'if' | 'and' | 'or' | 'not' | 'isblank' | 'coalesce' | 'isnull' | 'iferror' | 'contains' | 'starts_with' | 'ends_with'
  | 'len' | 'replace' | 'substring' | 'split' | 'first_word' | 'last_word' | 'to_number' | 'to_date'
  | 'day' | 'quarter' | 'weekday' | 'month_name' | 'weekday_name' | 'month_start' | 'datediff' | 'today'
  | 'round' | 'abs' | 'floor' | 'ceiling' | 'min_of' | 'max_of';

/** A function of a measure that reads the grouped rows of the query, along its first field. */
export type MeasureFn = 'percent_of_total' | 'running_total' | 'change' | 'change_pct' | 'rank' | 'ytd' | 'moving_avg' | 'threshold';

export type TransformKind = 'trim' | 'null_fill' | 'replace' | 'type' | 'remove_rows';

/**
 * Keeps the rows where a column of the aggregate's own source passes one comparison. value is
 * always text; the server converts it for number and date columns.
 */
export interface MeasureCondition { column: { source: string; column: string }; op: ConditionOp; value: string; }

/**
 * Expression tree of a measure or a calculated column, as the server stores it. A measure aggregates
 * (agg); a calculated column works on one row (text, fn). `kind` must stay the first property of each node.
 */
export type MeasureNode =
  | { kind: 'agg'; fn: AggregateFn; arg: { source: string; column: string }; where?: MeasureCondition }
  | { kind: 'col'; source: string; column: string }
  | { kind: 'num'; value: number }
  | { kind: 'bin'; op: BinaryOp; left: MeasureNode; right: MeasureNode }
  | { kind: 'text'; value: string }
  | { kind: 'fn'; fn: RowFn | MeasureFn; args: MeasureNode[] }
  /** Another measure of the dataset, by name, written [Measure name]; the server puts its formula in place. */
  | { kind: 'ref'; measure: string }
  | { kind: 'cmp'; op: ConditionOp; left: MeasureNode; right: MeasureNode };

export interface DatasetSummary {
  id: number;
  name: string;
  description: string | null;
  connectionId: number;
  status: string;
  createdAt: string;
  /** When canvases last got a new version of the model; null while it was never published. */
  publishedAt?: string | null;
}

export interface DatasetSource {
  id: number;
  schemaName: string;
  sourceName: string;
  alias: string;
  rlsMode: RlsMode;
  rlsPlantColumn: string | null;
  /** table, view or script. */
  kind?: SourceKind;
  /** schema.table for a table, the view's name for a view. */
  label?: string;
  /** True for a view source whose view no longer matches the SQL approved when it was added. */
  viewChanged?: boolean;
  /** Columns hidden from report builders; they still work in measures, relationships and filters. */
  hiddenColumns?: string[];
  /** The table's name as people read it; formulas use the alias. */
  caption?: string | null;
  description?: string | null;
  /** Set for a table read from another database than the model's (on the same server); null or absent for the model's own. */
  connectionId?: number | null;
  /** The connection and database the source is read from, the model's own included; null when that connection is gone. */
  connectionName?: string | null;
  databaseName?: string | null;
  /** For a script source: the batch it runs, as saved, and the variables it declares. */
  sql?: string | null;
  parameters?: ScriptParameter[] | null;
}

/** For many_to_one, from is the many side. */
export interface DatasetRelationship {
  id: number;
  fromSourceId: number;
  fromColumn: string;
  toSourceId: number;
  toColumn: string;
  cardinality: Cardinality;
  detectedFrom: string;
}

/** expression is null when the stored measure cannot be read. */
export interface DatasetMeasure {
  id: number;
  name: string;
  expression: MeasureNode | null;
  /** A display folder the Data pane groups the measure under. */
  folder?: string | null;
  /** The table the measure is listed under; null lists it with the dataset's measures. */
  homeSourceId?: number | null;
}

/** A calculation on one row of a table, used like its columns. expression is null when it cannot be read. */
export interface DatasetCalculatedColumn {
  id: number;
  sourceId: number;
  name: string;
  dataType: 'number' | 'text' | 'date';
  expression: MeasureNode | null;
}

/**
 * A change applied to a column of a table whenever it is read, in sortOrder. value is what fills blank cells, the
 * text a replace finds, the new type, or what a removal compares with. options holds the other settings: with and
 * match for replace, style for a change to date, op for remove_rows.
 */
export interface DatasetTransform {
  id: number;
  sourceId: number;
  column: string;
  kind: TransformKind;
  value: string | null;
  sortOrder: number;
  options?: Record<string, string> | null;
}

/** A formula that passed the checks of saving it, and the kind of value it gives. */
export interface FormulaCheck { kind: 'number' | 'text' | 'date'; }

export interface DatasetDetail extends DatasetSummary {
  sources: DatasetSource[];
  relationships: DatasetRelationship[];
  measures: DatasetMeasure[];
  calculatedColumns: DatasetCalculatedColumn[];
  transforms: DatasetTransform[];
  /** True while the draft differs from what canvases read; always true before the first Publish. */
  hasDraftChanges?: boolean;
}

export interface RelationshipSuggestion {
  fromSourceId: number;
  fromColumn: string;
  toSourceId: number;
  toColumn: string;
  cardinality: Cardinality;
  /** fk: a declared foreign key; data: found in the rows, with the share of the many side's values that matched. */
  basis?: 'fk' | 'data';
  matchPercent?: number | null;
}

/**
 * A connection of the tenant. In the Get Data list of one data model, joinable says whether its tables can be added to
 * that model, and reason says why not.
 */
export interface DatasetConnection { id: number; connectionName: string; databaseName: string; joinable?: boolean; reason?: string | null; }

export interface CreateDatasetBody { name: string; description: string | null; connectionId: number; }
/** connectionId reads a table from another database on the model's server; left out, the model's own database. */
export interface AddSourceBody {
  schemaName: string; sourceName: string; alias: string; rlsMode: RlsMode; rlsPlantColumn: string | null; kind?: SourceKind; connectionId?: number;
}
export interface RlsBody { rlsMode: RlsMode; rlsPlantColumn: string | null; }
export interface AddRelationshipBody {
  fromSourceId: number; fromColumn: string; toSourceId: number; toColumn: string; cardinality: Cardinality; detectedFrom: 'fk' | 'user';
}

/** value and options are as in DatasetTransform. */
export interface AddTransformBody { sourceId: number; column: string; kind: TransformKind; value: string | null; options?: Record<string, string>; }

/** Field is one of the requested dimensions or measure names. */
export interface QuerySort { field: string; descending: boolean; }

/** A filter as the server takes it (QueryCompiler.RenderFilter). Values go as text; SQL Server compares them with the column's type. */
export interface QueryFilter {
  field: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'between' | 'is_null' | 'not_null'
    | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'any' | 'top' | 'bottom';
  values?: string[];
  /** For any: the conditions, on the same field, of which one must hold. */
  any?: QueryFilter[];
}

/**
 * Dimensions are "alias.column"; measures are measure names. filters narrow the rows before they are grouped.
 * refresh makes the server read the rows from the database even when it has them cached, and keeps what it read.
 * totals adds subtotal and grand-total rows and a last "__level" column that tells them apart (no sort then).
 */
export interface QueryRequest {
  datasetId: number;
  dimensions: string[];
  measures: string[];
  filters?: QueryFilter[];
  sort?: QuerySort;
  topN?: number;
  refresh?: boolean;
  totals?: boolean;
  /** Runs on the dataset as it is being edited, not its published version: Model Studio and canvases in draft. */
  draft?: boolean;
  /** Fields added up without a stored measure; each name is also listed in measures. */
  values?: FieldValue[];
}

/** fn of field ("alias.column") under name, for a value a report object asks for without a stored measure. */
export interface FieldValue { name: string; field: string; fn: string; }

/** fetchedAt is when the rows were read from the database (ISO 8601, UTC); fromCache is true when the server answered from its cache. */
/** skippedFilters names the filter fields the rows are not filtered by: a query on saved views alone skips a filter no variable takes. */
export interface QueryResult { columns: string[]; rows: Record<string, unknown>[]; fetchedAt: string; fromCache: boolean; skippedFilters?: string[]; }

/** A View Builder view on the dataset's connection. usable is false, with the reasons in problems, when it cannot be added. */
export interface ViewChoice {
  id: number;
  name: string;
  description: string | null;
  usable: boolean;
  problems: string[];
  /** The view's columns; for a view offered as a saved view (asScript), those of its batch. */
  columns: { name: string; dataType: string }[];
  /** Fails the view contract but can be added as a saved view that runs as written; scriptProblems say why not when it cannot. */
  asScript?: boolean;
  scriptProblems?: string[] | null;
}

export type ImportType = 'text' | 'whole' | 'decimal' | 'date' | 'datetime' | 'boolean';
export interface ImportColumn { name: string; type: ImportType; }

/** One sheet of an uploaded file as the server reads it. rows are the first data rows, as text. */
export interface ImportPreview {
  sheets: string[];
  sheet: string;
  sheetRows: number;
  headerRow: number;
  lastRow: number;
  columns: ImportColumn[];
  rows: string[][];
  dataRows: number;
  suggestedTableName: string;
}

/** A table loaded from an uploaded file, in schema import. */
export interface ImportTable {
  id: number;
  tableName: string;
  fileName: string;
  sheetName: string | null;
  headerRow: number;
  lastRow: number;
  loadedRows: number;
  modifiedAt: string;
}

/** How to read a sheet. What is left out, the server suggests. */
export interface ImportOptions { sheet?: string; headerRow?: number; lastRow?: number; types?: ImportType[]; tableName?: string; }

export interface SourcePreviewBody { kind: SourceKind; schemaName: string; sourceName: string; connectionId?: number; }

/**
 * A view's columns in the shape of a schema table, so view sources share the columns map with tables. A view offered
 * as a saved view is keyed by the script schema and starts with row_order, as the server lists a script source's columns.
 */
export function viewAsTable(view: ViewChoice): DbSchemaTable {
  const columns = view.usable ? view.columns : [{ name: ROW_ORDER, dataType: 'int' }, ...view.columns];
  return {
    schemaName: view.usable ? VIEW_SCHEMA : SCRIPT_SCHEMA,
    tableName: String(view.id),
    columnCount: columns.length,
    columns: columns.map((column, i) => ({
      id: 0, columnName: column.name, dataType: column.dataType, isNullable: true, isPrimaryKey: false, isForeignKey: false,
      foreignKeyTable: null, foreignKeyColumn: null, maxLength: null, ordinalPosition: i + 1,
    })),
  };
}

/** Model Studio datasets. Every change returns the whole dataset, unwrapped from the API envelope. */
@Injectable({ providedIn: 'root' })
export class ModelStudioService {
  private readonly base = `${environment.tenantApiUrl}${API_ENDPOINTS.MODEL.DATASETS}`;

  constructor(private readonly http: HttpClient) {}

  list(): Observable<DatasetSummary[]> {
    return this.http.get<ApiResponse<DatasetSummary[]>>(this.base).pipe(map(r => r.data));
  }

  connections(): Observable<DatasetConnection[]> {
    return this.http.get<ApiResponse<DatasetConnection[]>>(`${this.base}/connections`).pipe(map(r => r.data));
  }

  /** Every connection of the tenant, each saying whether the data model can add its tables (the Get Data database choice). */
  sourceConnections(id: number): Observable<DatasetConnection[]> {
    return this.http.get<ApiResponse<DatasetConnection[]>>(`${this.base}/${id}/connections`).pipe(map(r => r.data));
  }

  get(id: number): Observable<DatasetDetail> {
    return this.detail(this.http.get<ApiResponse<DatasetDetail>>(`${this.base}/${id}`));
  }

  create(body: CreateDatasetBody): Observable<DatasetDetail> {
    return this.detail(this.http.post<ApiResponse<DatasetDetail>>(this.base, body));
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  addSource(id: number, body: AddSourceBody): Observable<DatasetDetail> {
    return this.detail(this.http.post<ApiResponse<DatasetDetail>>(`${this.base}/${id}/sources`, body));
  }

  updateSource(id: number, sourceId: number, body: RlsBody): Observable<DatasetDetail> {
    return this.detail(this.http.put<ApiResponse<DatasetDetail>>(`${this.base}/${id}/sources/${sourceId}`, body));
  }

  removeSource(id: number, sourceId: number): Observable<DatasetDetail> {
    return this.detail(this.http.delete<ApiResponse<DatasetDetail>>(`${this.base}/${id}/sources/${sourceId}`));
  }

  /** Stores the view behind a view source as it is now, after checking it as when it was added. */
  refreshViewSource(id: number, sourceId: number): Observable<DatasetDetail> {
    return this.detail(this.http.post<ApiResponse<DatasetDetail>>(`${this.base}/${id}/sources/${sourceId}/refresh-view`, {}));
  }

  addRelationship(id: number, body: AddRelationshipBody): Observable<DatasetDetail> {
    return this.detail(this.http.post<ApiResponse<DatasetDetail>>(`${this.base}/${id}/relationships`, body));
  }

  updateRelationship(id: number, relationshipId: number, cardinality: Cardinality): Observable<DatasetDetail> {
    return this.detail(this.http.put<ApiResponse<DatasetDetail>>(`${this.base}/${id}/relationships/${relationshipId}`, { cardinality }));
  }

  removeRelationship(id: number, relationshipId: number): Observable<DatasetDetail> {
    return this.detail(this.http.delete<ApiResponse<DatasetDetail>>(`${this.base}/${id}/relationships/${relationshipId}`));
  }

  suggestions(id: number): Observable<RelationshipSuggestion[]> {
    return this.http.get<ApiResponse<RelationshipSuggestion[]>>(`${this.base}/${id}/relationship-suggestions`).pipe(map(r => r.data));
  }

  views(id: number): Observable<ViewChoice[]> {
    return this.http.get<ApiResponse<ViewChoice[]>>(`${this.base}/${id}/views`).pipe(map(r => r.data));
  }

  /** The columns of the dataset's view and script sources, as tables. No request when it has neither. */
  viewTables(dataset: DatasetDetail): Observable<DbSchemaTable[]> {
    if (!dataset.sources.some(source => source.kind === 'view' || source.kind === 'script')) return of([]);
    return this.views(dataset.id).pipe(map(views => views.filter(view => view.usable || view.asScript).map(viewAsTable)));
  }

  /** The first rows of a table or view. A non-administrator gets HTTP 422 with code rows_hidden. */
  previewSource(id: number, body: SourcePreviewBody): Observable<QueryResult> {
    return this.http.post<ApiResponse<QueryResult>>(`${this.base}/${id}/source-preview`, body).pipe(map(r => r.data));
  }

  imports(id: number): Observable<ImportTable[]> {
    return this.http.get<ApiResponse<ImportTable[]>>(`${this.base}/${id}/imports`).pipe(map(r => r.data));
  }

  previewImport(id: number, file: File, options: ImportOptions): Observable<ImportPreview> {
    return this.http.post<ApiResponse<ImportPreview>>(`${this.base}/${id}/imports/preview`, importForm(file, options)).pipe(map(r => r.data));
  }

  createImport(id: number, file: File, options: ImportOptions): Observable<ImportTable> {
    return this.http.post<ApiResponse<ImportTable>>(`${this.base}/${id}/imports`, importForm(file, options)).pipe(map(r => r.data));
  }

  /** A Google Sheet shared by link, downloaded by the server as an .xlsx to read like an uploaded file. */
  googleSheet(id: number, link: string): Observable<File> {
    return this.http.get<ApiResponse<{ fileName: string; content: string }>>(`${this.base}/${id}/imports/google-sheet`, { params: { link } })
      .pipe(map(r => new File([Uint8Array.from(atob(r.data.content), c => c.charCodeAt(0))], r.data.fileName)));
  }

  replaceImport(id: number, importId: number, file: File, options: ImportOptions): Observable<ImportTable> {
    return this.http.put<ApiResponse<ImportTable>>(`${this.base}/${id}/imports/${importId}`, importForm(file, options)).pipe(map(r => r.data));
  }

  addMeasure(id: number, name: string, expression: MeasureNode): Observable<DatasetDetail> {
    return this.detail(this.http.post<ApiResponse<DatasetDetail>>(`${this.base}/${id}/measures`, { name, expression }));
  }

  updateMeasure(id: number, measureId: number, name: string, expression: MeasureNode): Observable<DatasetDetail> {
    return this.detail(this.http.put<ApiResponse<DatasetDetail>>(`${this.base}/${id}/measures/${measureId}`, { name, expression }));
  }

  /** Hides columns of one table from report builders; an empty list shows them all. */
  setSourceDetails(id: number, sourceId: number, caption: string | null, description: string | null): Observable<DatasetDetail> {
    return this.detail(this.http.put<ApiResponse<DatasetDetail>>(`${this.base}/${id}/sources/${sourceId}/details`, { caption, description }));
  }

  /** Binds each variable of a saved view to a model field, or unbinds it with null; the list replaces the bindings it had. */
  setSourceParameters(id: number, sourceId: number, bindings: { name: string; field: string | null }[]): Observable<DatasetDetail> {
    return this.detail(this.http.put<ApiResponse<DatasetDetail>>(`${this.base}/${id}/sources/${sourceId}/parameters`, bindings));
  }

  setHiddenColumns(id: number, sourceId: number, columns: string[]): Observable<DatasetDetail> {
    return this.detail(this.http.put<ApiResponse<DatasetDetail>>(`${this.base}/${id}/sources/${sourceId}/hidden-columns`, { columns }));
  }

  /** Renames the dataset and sets its description; not part of the draft, so canvases see it at once. */
  updateDetails(id: number, name: string, description: string | null): Observable<DatasetDetail> {
    return this.detail(this.http.put<ApiResponse<DatasetDetail>>(`${this.base}/${id}`, { name, description }));
  }

  /** Makes the draft the version canvases read (POST .../publish). */
  publish(id: number): Observable<DatasetDetail> {
    return this.detail(this.http.post<ApiResponse<DatasetDetail>>(`${this.base}/${id}/publish`, {}));
  }

  /** Throws the draft away and goes back to the published version. */
  discardDraft(id: number): Observable<DatasetDetail> {
    return this.detail(this.http.post<ApiResponse<DatasetDetail>>(`${this.base}/${id}/discard-draft`, {}));
  }

  /** Lists a measure under a table (or null for the dataset's measures) and in a folder (or none). */
  placeMeasure(id: number, measureId: number, homeSourceId: number | null, folder: string | null): Observable<DatasetDetail> {
    return this.detail(this.http.put<ApiResponse<DatasetDetail>>(`${this.base}/${id}/measures/${measureId}/placement`, { homeSourceId, folder }));
  }

  removeMeasure(id: number, measureId: number): Observable<DatasetDetail> {
    return this.detail(this.http.delete<ApiResponse<DatasetDetail>>(`${this.base}/${id}/measures/${measureId}`));
  }

  /** Runs the checks of saving a measure without saving it (POST .../measures/check). measureId names the one being edited. */
  checkMeasure(id: number, name: string, expression: MeasureNode, measureId: number | null): Observable<FormulaCheck> {
    return this.http.post<ApiResponse<FormulaCheck>>(`${this.base}/${id}/measures/check`, { name, expression, measureId }).pipe(map(r => r.data));
  }

  /** Runs the checks of saving a calculated column without saving it. columnId names the one being edited. */
  checkCalculatedColumn(id: number, sourceId: number, name: string, expression: MeasureNode, columnId: number | null): Observable<FormulaCheck> {
    return this.http.post<ApiResponse<FormulaCheck>>(`${this.base}/${id}/calculated-columns/check`, { sourceId, name, expression, columnId })
      .pipe(map(r => r.data));
  }

  addCalculatedColumn(id: number, sourceId: number, name: string, expression: MeasureNode): Observable<DatasetDetail> {
    return this.detail(this.http.post<ApiResponse<DatasetDetail>>(`${this.base}/${id}/calculated-columns`, { sourceId, name, expression }));
  }

  updateCalculatedColumn(id: number, columnId: number, name: string, expression: MeasureNode): Observable<DatasetDetail> {
    return this.detail(this.http.put<ApiResponse<DatasetDetail>>(`${this.base}/${id}/calculated-columns/${columnId}`, { name, expression }));
  }

  removeCalculatedColumn(id: number, columnId: number): Observable<DatasetDetail> {
    return this.detail(this.http.delete<ApiResponse<DatasetDetail>>(`${this.base}/${id}/calculated-columns/${columnId}`));
  }

  addTransform(id: number, body: AddTransformBody): Observable<DatasetDetail> {
    return this.detail(this.http.post<ApiResponse<DatasetDetail>>(`${this.base}/${id}/transforms`, body));
  }

  removeTransform(id: number, transformId: number): Observable<DatasetDetail> {
    return this.detail(this.http.delete<ApiResponse<DatasetDetail>>(`${this.base}/${id}/transforms/${transformId}`));
  }

  /** POST /api/query. A refusal arrives as HTTP 422 with { code, message }. */
  runQuery(request: QueryRequest): Observable<QueryResult> {
    return this.http.post<QueryResult>(`${environment.tenantApiUrl}${API_ENDPOINTS.MODEL.QUERY}`, request);
  }

  private detail(request: Observable<ApiResponse<DatasetDetail>>): Observable<DatasetDetail> {
    return request.pipe(map(r => r.data));
  }
}

/** The multipart form of an upload. types is sent once per column, in column order. */
function importForm(file: File, options: ImportOptions): FormData {
  const form = new FormData();
  form.append('file', file);
  if (options.sheet !== undefined) form.append('sheet', options.sheet);
  if (options.headerRow !== undefined) form.append('headerRow', String(options.headerRow));
  if (options.lastRow !== undefined) form.append('lastRow', String(options.lastRow));
  for (const type of options.types ?? []) form.append('types', type);
  if (options.tableName !== undefined) form.append('tableName', options.tableName);
  return form;
}
