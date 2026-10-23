import { ParameterFilterRule } from '../../../core/utils/parameter-filter.util';
import { DaxModelConfig, renameDaxColumn } from '../../../core/utils/dax-evaluator.util';
import { CellBorder, CellEmbed, ConditionalRule, MergedCellRange, ReportConditionalFilter, ReportJsonConfig, TextAlign, TextOrientation } from './report-config.model';
import { reportCellSettingKey } from './report-grid-columns.util';

/**
 * Report formatting is keyed by the column name the grid displays. A Data Transformation
 * `rename_column` rule changes that name, so these helpers move every column-keyed setting
 * from one rename state to another (via the column's source name). Templates store the
 * source names (`columnKeyBasis: 'source'`) so they map onto any target report's renames.
 */

/** Column-keyed settings that follow a column through renames. */
export interface ReportColumnKeyedSettings {
  headerCellColors?: Record<string, string>;
  headerCellTextColors?: Record<string, string>;
  headerCellOrientations?: Record<string, TextOrientation>;
  headerCellAlignments?: Record<string, TextAlign>;
  headerCellBorders?: Record<string, CellBorder>;
  cellColors?: Record<string, string>;
  cellTextColors?: Record<string, string>;
  cellOrientations?: Record<string, TextOrientation>;
  cellAlignments?: Record<string, TextAlign>;
  cellBorders?: Record<string, CellBorder>;
  cellEmbeds?: Record<string, CellEmbed>;
  cellOverrides?: Record<string, unknown>;
  rowColorsByKey?: Record<string, string>;
  rowTextColorsByKey?: Record<string, string>;
  manualRows?: Record<string, Record<string, unknown>>;
  mergedCellRanges?: MergedCellRange[];
  pinnedColumns?: string[];
  dataBarColumns?: string[];
  rowGroupFields?: string[];
  conditionalRules?: ConditionalRule[];
}

/** Where a template's column-keyed settings point: the source columns (current) or its displayed names (legacy). */
export type ReportColumnKeyBasis = 'source' | 'display';

/** Builds displayed-column → source-column mappings from rename-column rules. */
function getReportColumnSourceMap(config: { columns: { field: string; header: string }[]; parameterFilters: ParameterFilterRule[] }): Map<string, string> {
  const currentNames = new Map(config.columns.map(column => [column.field, column.field]));
  const sourceKeys = ['sourceColumn', 'source_column', 'oldName', 'old_name', 'from', 'source', 'column', 'field'];
  const targetKeys = ['targetColumn', 'target_column', 'newName', 'new_name', 'to', 'target', 'displayName', 'renamedColumn'];

  for (const rule of config.parameterFilters ?? []) {
    const values = rule as unknown as Record<string, unknown>;
    const normalized = (value: unknown) => typeof value === 'string' ? value.replace(/[_\s-]/g, '').toLowerCase() : '';
    const kind = Object.entries(values).find(([key]) => ['type', 'action', 'operation', 'ruleType'].includes(normalized(key)))?.[1];
    if (kind != null && normalized(kind) !== 'renamecolumn') continue;
    const source = sourceKeys.map(key => values[key]).find((value): value is string => typeof value === 'string');
    const target = targetKeys.map(key => values[key]).find((value): value is string => typeof value === 'string');
    if (source == null || target == null) continue;
    for (const [original, current] of currentNames) {
      if (current === source) currentNames.set(original, target);
    }
  }

  return new Map([...currentNames].map(([source, display]) => [display, source]));
}

const FIELD_KEYED = ['headerCellColors', 'headerCellTextColors', 'headerCellOrientations', 'headerCellAlignments', 'headerCellBorders'] as const;
const CELL_KEYED = ['cellColors', 'cellTextColors', 'cellOrientations', 'cellAlignments', 'cellBorders', 'cellEmbeds', 'cellOverrides'] as const;
const GROUP_KEYED = ['rowColorsByKey', 'rowTextColorsByKey'] as const;
const FIELD_LISTS = ['pinnedColumns', 'dataBarColumns', 'rowGroupFields'] as const;

/** Source column → displayed name, for columns a rename rule actually changes. */
export function getRenamedColumnDisplayNames(fields: readonly string[], rules: ParameterFilterRule[] | null | undefined): Map<string, string> {
  const renames = new Map<string, string>();
  if (!rules?.length) return renames;
  const sources = getReportColumnSourceMap({ columns: fields.map(field => ({ field, header: field })), parameterFilters: rules });
  const existing = new Set(fields.map(field => field.toLowerCase()));
  for (const [display, source] of sources) {
    if (display === source) continue;
    // Renaming onto another column's name overwrites that column; never re-key formatting onto it.
    if (existing.has(display.toLowerCase()) && display.toLowerCase() !== source.toLowerCase()) continue;
    renames.set(source, display);
  }
  return renames;
}

export function sameColumnRenames(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [source, display] of a) if (b.get(source) !== display) return false;
  return true;
}

/** Moves a displayed name under `from` renames to its displayed name under `to` renames. */
export function columnKeyRenamer(from: ReadonlyMap<string, string>, to: ReadonlyMap<string, string>): (field: string) => string {
  const sourceOfDisplay = new Map([...from].map(([source, display]) => [display, source]));
  return field => {
    const source = sourceOfDisplay.get(field) ?? field;
    return to.get(source) ?? source;
  };
}

/** Like columnKeyRenamer, but only moves names that were rename outputs under `from` (source names are left alone). */
export function renamedOutputRenamer(from: ReadonlyMap<string, string>, to: ReadonlyMap<string, string>): (field: string) => string {
  const sourceOfDisplay = new Map([...from].map(([source, display]) => [display, source]));
  return field => {
    const source = sourceOfDisplay.get(field);
    return source == null ? field : to.get(source) ?? source;
  };
}

/** Renames keys; a key that stays put wins over one moved onto it, so existing settings are never overwritten. */
function renameRecordKeys<T>(record: Record<string, T>, renameKey: (key: string) => string): Record<string, T> {
  const result: Record<string, T> = {};
  const moved: [string, T][] = [];
  for (const [key, value] of Object.entries(record)) {
    const next = renameKey(key);
    if (next === key) result[key] = value;
    else moved.push([next, value]);
  }
  for (const [key, value] of moved) if (!(key in result)) result[key] = value;
  return result;
}

/** `record:[rowKey, field]` and legacy `${rowIndex}:${field}` cell keys. */
function renameCellKey(key: string, rename: (field: string) => string): string {
  if (key.startsWith('record:')) {
    try {
      const parsed: unknown = JSON.parse(key.slice('record:'.length));
      if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
        const field = rename(parsed[1]);
        return field === parsed[1] ? key : reportCellSettingKey(parsed[0], field);
      }
    } catch {
      return key;
    }
    return key;
  }
  const legacy = /^(\d+):([\s\S]*)$/.exec(key);
  if (!legacy) return key;
  const field = rename(legacy[2]);
  return field === legacy[2] ? key : `${legacy[1]}:${field}`;
}

/** `group:[[field, key], ...]` row-group heading keys. */
function renameGroupKey(key: string, rename: (field: string) => string): string {
  if (!key.startsWith('group:')) return key;
  try {
    const path: unknown = JSON.parse(key.slice('group:'.length));
    if (!Array.isArray(path)) return key;
    let changed = false;
    const next = path.map(entry => {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string') return entry;
      const field = rename(entry[0]);
      if (field === entry[0]) return entry;
      changed = true;
      return [field, ...entry.slice(1)];
    });
    return changed ? `group:${JSON.stringify(next)}` : key;
  } catch {
    return key;
  }
}

function renameList(fields: string[], rename: (field: string) => string): string[] {
  const result: string[] = [];
  for (const field of fields.map(rename)) if (!result.includes(field)) result.push(field);
  return result;
}

/** Copy of `settings` with every column-keyed setting renamed; settings absent on the input stay absent. */
export function renameReportColumnKeys<T extends ReportColumnKeyedSettings>(settings: T, rename: (field: string) => string): T {
  const out: T = { ...settings };
  for (const prop of FIELD_KEYED) {
    const value = settings[prop] as Record<string, unknown> | undefined;
    if (value) (out as ReportColumnKeyedSettings)[prop] = renameRecordKeys(value, rename) as never;
  }
  for (const prop of CELL_KEYED) {
    const value = settings[prop] as Record<string, unknown> | undefined;
    if (value) (out as ReportColumnKeyedSettings)[prop] = renameRecordKeys(value, key => renameCellKey(key, rename)) as never;
  }
  for (const prop of GROUP_KEYED) {
    const value = settings[prop];
    if (value) out[prop] = renameRecordKeys(value, key => renameGroupKey(key, rename));
  }
  for (const prop of FIELD_LISTS) {
    const value = settings[prop];
    if (value) out[prop] = renameList(value, rename);
  }
  if (settings.manualRows) {
    out.manualRows = Object.fromEntries(Object.entries(settings.manualRows)
      .map(([id, values]) => [id, values ? renameRecordKeys(values, rename) : values]));
  }
  if (settings.mergedCellRanges) {
    out.mergedCellRanges = settings.mergedCellRanges.map(range => {
      const field = rename(range.field);
      return field === range.field ? range : { ...range, field };
    });
  }
  if (settings.conditionalRules) {
    out.conditionalRules = settings.conditionalRules.map(rule => {
      const field = rename(rule.field);
      return field === rule.field ? rule : { ...rule, field };
    });
  }
  return out;
}

/** DAX measures referencing renamed names, renamed in one pass (safe for swapped names). */
export function renameDaxModelColumns(model: DaxModelConfig, rename: (field: string) => string, fields: Iterable<string>): DaxModelConfig {
  const pairs = [...new Set(fields)].map(field => [field, rename(field)] as const).filter(([from, to]) => from !== to);
  if (!pairs.length || !model?.measures?.length) return model;
  const token = (index: number) => `__report_column_rename_${index}__`;
  return {
    ...model,
    measures: model.measures.map(measure => {
      let next = measure;
      pairs.forEach(([from], index) => { next = renameDaxColumn(next, from, token(index)); });
      pairs.forEach(([, to], index) => { next = renameDaxColumn(next, token(index), to); });
      return next;
    }),
  };
}

/** Conditional filters on renamed (transformed) columns, renamed to follow them. */
export function renameConditionalFilterColumns(filters: ReportConditionalFilter[], rename: (field: string) => string): ReportConditionalFilter[] {
  return filters.map(filter => {
    const sourceColumn = rename(filter.sourceColumn);
    return sourceColumn === filter.sourceColumn ? filter : { ...filter, sourceColumn };
  });
}

/** Template config with column-keyed settings keyed by source column, whatever basis it was saved with. */
export function toSourceColumnKeys(config: ReportJsonConfig & { columnKeyBasis?: ReportColumnKeyBasis }): ReportJsonConfig & { columnKeyBasis: 'source' } {
  if (config.columnKeyBasis === 'source') return config as ReportJsonConfig & { columnKeyBasis: 'source' };
  const fields = (config.columns ?? []).map(column => column.field);
  const renames = getRenamedColumnDisplayNames(fields, config.parameterFilters);
  return { ...renameReportColumnKeys(config, columnKeyRenamer(renames, new Map())), columnKeyBasis: 'source' };
}
