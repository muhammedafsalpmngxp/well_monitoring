import { DbSchemaTable } from '../../../core/services/common-api.service';
import {
  AddSourceBody, DatasetConnection, DatasetDetail, ImportTable, ImportType, RlsMode, SCRIPT_SCHEMA, SourceKind, VIEW_SCHEMA, ViewChoice,
} from '../../../core/services/model-studio.service';
import { SourceOrigin, describeOrigin, sameName, suggestAlias, tableKey } from '../model-studio.util';

/** Schema of the tables loaded from uploaded files. */
export const IMPORT_SCHEMA = 'import';

export type NavigatorGroup = 'tables' | 'views' | 'files';

export const GROUP_LABELS: Record<NavigatorGroup, string> = { tables: 'Database tables', views: 'Views', files: 'Files and Google Sheets' };

export const GROUP_ICONS: Record<NavigatorGroup, string> = { tables: 'database_view', views: 'view_column', files: 'description' };

export const IMPORT_TYPE_LABELS: Record<ImportType, string> = {
  text: 'Text', whole: 'Whole number', decimal: 'Decimal number', date: 'Date', datetime: 'Date and time', boolean: 'True/false',
};

/**
 * One entry of the navigator. A table or view carries the source it adds, and an uploaded table also its registry
 * row. A sheet belongs to the file being uploaded and becomes a table when it is loaded.
 */
export interface NavigatorItem {
  key: string;
  group: NavigatorGroup;
  label: string;
  detail: string;
  /** Already a source of the dataset. */
  added: boolean;
  /** Cannot be ticked: already added, or a view that fails the view contract. */
  disabled: boolean;
  /** Why a view cannot be added, as the view contract check words it. */
  reasons: string[];
  /** For a view offered as a saved view: why it is not a plain view, shown as its tooltip. */
  note?: string[];
  /** Column names known before loading; a sheet's come from its preview. */
  columns: string[];
  /** connectionId is set for a table of another database than the model's. */
  source?: { kind: SourceKind; schemaName: string; sourceName: string; connectionId?: number };
  /** The database of a table of another database, shown as a badge. */
  database?: string;
  imported?: ImportTable;
  sheet?: string;
}

/** How a ticked item is added: its name in the dataset and who sees which rows. A sheet also says how it is read. */
export interface LoadSettings {
  alias: string;
  rlsMode: RlsMode | '';
  plantColumn: string;
  tableName?: string;
  headerRow?: number;
  lastRow?: number;
  types?: ImportType[];
}

// The server's rules: DatasetValidationRules.SourceAlias and ImportRules.IsTableName.
const ALIAS = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const TABLE_NAME = /^[A-Za-z][A-Za-z0-9_]{0,99}$/;

/**
 * The navigator's entries in group order: database tables, View Builder views, uploaded tables, then the sheets of the
 * file being uploaded. tables are the catalogue of the data model's own database; its tables are listed without schema
 * import, whose tables are listed as uploads. other lists the tables of another database of the model's server
 * instead, every schema included. Views and uploads always belong to the model's own database.
 */
export function navigatorItems(
  dataset: DatasetDetail, tables: DbSchemaTable[], views: ViewChoice[], imports: ImportTable[], sheets: string[],
  other?: { connection: DatasetConnection; tables: DbSchemaTable[] },
): NavigatorItem[] {
  const addedFrom = (connectionId: number | undefined) => new Set(dataset.sources
    .filter(source => (source.connectionId ?? undefined) === connectionId).map(source => tableKey(source.schemaName, source.sourceName)));
  const added = addedFrom(undefined);
  const columnsOf = new Map(tables.map(t => [tableKey(t.schemaName, t.tableName), t.columns.map(c => c.columnName)]));
  const entry = (group: NavigatorGroup, label: string, detail: string, source: NonNullable<NavigatorItem['source']>,
    columns: string[], reasons: string[] = [], isAdded = added): NavigatorItem => {
    const key = tableKey(source.schemaName, source.sourceName);
    return {
      key: `${source.kind}:${source.connectionId ? `${source.connectionId}:` : ''}${key}`, group, label, detail, added: isAdded.has(key),
      disabled: isAdded.has(key) || reasons.length > 0, reasons, columns, source,
    };
  };
  const listed = other
    ? other.tables.filter(t => t.schemaName !== VIEW_SCHEMA && t.schemaName !== SCRIPT_SCHEMA).map(t => ({
      ...entry('tables', `${t.schemaName}.${t.tableName}`, `${t.columns.length} columns`,
        { kind: 'table', schemaName: t.schemaName, sourceName: t.tableName, connectionId: other.connection.id },
        t.columns.map(c => c.columnName), [], addedFrom(other.connection.id)),
      database: other.connection.databaseName,
    }))
    : tables.filter(t => t.schemaName !== IMPORT_SCHEMA && t.schemaName !== VIEW_SCHEMA && t.schemaName !== SCRIPT_SCHEMA)
      .map(t => entry('tables', `${t.schemaName}.${t.tableName}`, `${t.columns.length} columns`,
        { kind: 'table', schemaName: t.schemaName, sourceName: t.tableName }, t.columns.map(c => c.columnName)));

  return [
    ...listed.sort((a, b) => a.label.localeCompare(b.label)),
    ...views.map(v => {
      const offer = viewOffer(v);
      return {
        ...entry('views', v.name, offer.detail, { kind: offer.kind, schemaName: offer.schemaName, sourceName: String(v.id) },
          v.columns.map(c => c.name), offer.reasons),
        ...(offer.note.length ? { note: offer.note } : {}),
      };
    }),
    ...imports.map(i => ({
      ...entry('files', i.tableName, `${i.fileName}${i.sheetName ? `, ${i.sheetName}` : ''}, ${i.loadedRows} rows`,
        { kind: 'table', schemaName: IMPORT_SCHEMA, sourceName: i.tableName }, columnsOf.get(tableKey(IMPORT_SCHEMA, i.tableName)) ?? []),
      imported: i,
    })),
    ...sheets.map((sheet): NavigatorItem => ({
      key: `sheet:${sheet}`, group: 'files', label: sheet, detail: 'Sheet of the uploaded file', added: false, disabled: false,
      reasons: [], columns: [], sheet,
    })),
  ];
}

/**
 * How a View Builder view is offered: as a view when it meets the view contract; otherwise as a saved view that runs as
 * written when the server says it can (note keeps why it is not a plain view); otherwise not at all, and reasons say why.
 */
export function viewOffer(view: ViewChoice): { kind: SourceKind; schemaName: string; detail: string; reasons: string[]; note: string[] } {
  if (view.usable) return { kind: 'view', schemaName: VIEW_SCHEMA, detail: `${view.columns.length} columns`, reasons: [], note: [] };
  const contract = view.problems.length ? view.problems : ['This view cannot be used.'];
  return view.asScript
    ? { kind: 'script', schemaName: SCRIPT_SCHEMA, detail: 'Add as saved view (runs as written)', reasons: [], note: contract }
    : { kind: 'view', schemaName: VIEW_SCHEMA, detail: 'Does not meet the view contract', reasons: [...contract, ...view.scriptProblems ?? []], note: [] };
}

/** The entries whose name, detail or a column contains the search text, ignoring case. */
export function filterItems(items: NavigatorItem[], term: string): NavigatorItem[] {
  const text = term.trim().toLowerCase();
  return !text ? items : items.filter(item => item.label.toLowerCase().includes(text) || item.detail.toLowerCase().includes(text)
    || item.columns.some(column => column.toLowerCase().includes(text)));
}

/** Settings for a newly ticked item: a free alias from its name, and no row filter yet, because that choice is required. */
export function newSettings(item: NavigatorItem, taken: string[], tableName = ''): LoadSettings {
  const base = item.sheet ? tableName || item.label : item.source && item.source.kind !== 'table' ? item.label : item.source?.sourceName ?? item.label;
  return { alias: suggestAlias(base, taken), rlsMode: '', plantColumn: '', ...(item.sheet ? { tableName } : {}) };
}

/** Why the item cannot be loaded yet, in words for the user; '' when it can. taken holds every other alias in use. */
export function settingsProblem(item: NavigatorItem, settings: LoadSettings | undefined, taken: string[]): string {
  if (!settings) return `Choose how to load ${item.label}.`;
  if (!ALIAS.test(settings.alias)) {
    return `${item.label}: the name in the data model uses letters, digits and underscores, and does not start with a digit.`;
  }
  if (taken.some(alias => sameName(alias, settings.alias))) return `${item.label}: another table is already called ${settings.alias}.`;
  if (!settings.rlsMode) return `${item.label}: choose who sees which rows.`;
  if (settings.rlsMode === 'plant' && !settings.plantColumn) return `${item.label}: choose the column that holds the plant code.`;
  if (item.sheet && !TABLE_NAME.test(settings.tableName ?? '')) {
    return `${item.label}: the table name starts with a letter and uses letters, digits and underscores.`;
  }
  if (item.sheet && !settings.types?.length) return `${item.label}: wait for the sheet's preview before loading it.`;
  return '';
}

/** The add-source body for an item. A sheet is added as the table it was loaded into. */
export function sourceBody(item: NavigatorItem, settings: LoadSettings, loadedTable?: string): AddSourceBody {
  const source: NonNullable<NavigatorItem['source']> = item.sheet
    ? { kind: 'table', schemaName: IMPORT_SCHEMA, sourceName: loadedTable ?? '' }
    : item.source!;
  return {
    schemaName: source.schemaName, sourceName: source.sourceName, alias: settings.alias, kind: source.kind,
    rlsMode: settings.rlsMode as RlsMode, rlsPlantColumn: settings.rlsMode === 'plant' ? settings.plantColumn : null,
    ...(source.connectionId ? { connectionId: source.connectionId } : {}),
  };
}

/** Where an entry is read from; null for a sheet, which is not in a database yet. Views and uploads are on the model's own database. */
export function itemOrigin(item: NavigatorItem, dataset: DatasetDetail, connections: DatasetConnection[]): SourceOrigin | null {
  if (!item.source) return null;
  const connection = connections.find(c => c.id === (item.source!.connectionId ?? dataset.connectionId));
  return describeOrigin(connection?.connectionName, connection?.databaseName, !!item.source.connectionId, item.source.kind !== 'table'
    ? { view: item.label, id: item.source.sourceName }
    : { schema: item.source.schemaName, table: item.source.sourceName });
}
