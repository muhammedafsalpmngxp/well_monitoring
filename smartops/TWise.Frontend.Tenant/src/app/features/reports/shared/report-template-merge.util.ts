import { ParameterFilterRule, applyParameterFilters, getRuleSourceColumns } from '../../../core/utils/parameter-filter.util';
import { DaxMeasureConfig, DaxModelConfig, getDaxReferencedColumns } from '../../../core/utils/dax-evaluator.util';
import { ConditionalRule, MergedCellRange, ReportConditionalFilter } from './report-config.model';
import { ReportColumnKeyedSettings } from './report-column-rename.util';

/**
 * Applying a template setup to a report: template items that reference columns the report does
 * not have are skipped (they would filter out every row, add empty columns or paint nothing), and
 * the report's own settings are kept — template items are added, replacing only the report's item
 * for the same thing (same cell/column key, same rule on the same column).
 */

type Has = (column: string) => boolean;

/** Case-insensitive membership test over column names. */
export function columnNameSet(names: Iterable<string>): Has {
  const set = new Set([...names].map(name => name.trim().toLowerCase()));
  return column => set.has(column.trim().toLowerCase());
}

function ruleReferences(rule: ParameterFilterRule): string[] {
  return [...getRuleSourceColumns(rule), ...(rule.secondaryColumn?.trim() ? [rule.secondaryColumn.trim()] : [])];
}

/** Columns that exist after running `rules` over a report whose source columns are `baseColumns`. */
export function columnsAfterRules(baseColumns: string[], rules: ParameterFilterRule[]): string[] {
  if (!baseColumns.length) return [];
  const row = Object.fromEntries(baseColumns.map(column => [column, '']));
  const result = applyParameterFilters([row], rules, baseColumns);
  return [...new Set([...baseColumns, ...result.columns, ...Object.keys(result.rows[0] ?? {})])];
}

function ruleSignature(rule: ParameterFilterRule): string {
  const { id: _id, ...rest } = rule;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

const sameColumns = (a: string[], b: string[]) =>
  a.length === b.length && a.every(column => b.some(other => other.toLowerCase() === column.toLowerCase()));

/**
 * The report's rules plus the template rules whose columns exist (after the rules before them).
 * A template rule replaces the report's rule with the same action on the same column(s); an
 * identical rule is not duplicated.
 */
export function mergeTemplateRules(own: ParameterFilterRule[], template: ParameterFilterRule[], baseColumns: string[]): ParameterFilterRule[] {
  let kept = [...own];
  const accepted: ParameterFilterRule[] = [];
  let nextId = own.reduce((max, rule) => Math.max(max, rule.id), 0) + 1;
  for (const rule of template) {
    if (!rule?.action) continue;
    const references = ruleReferences(rule);
    const available = columnNameSet(columnsAfterRules(baseColumns, [...kept, ...accepted]));
    if (!references.every(available)) continue;
    if ([...kept, ...accepted].some(existing => ruleSignature(existing) === ruleSignature(rule))) continue;
    const sources = getRuleSourceColumns(rule);
    kept = kept.filter(existing => !(existing.action === rule.action && sameColumns(getRuleSourceColumns(existing), sources)));
    accepted.push({ ...rule, id: nextId++, sourceColumns: sources });
  }
  return [...kept, ...accepted];
}

/** The report's conditional filters plus the template filters on columns that exist. */
export function mergeConditionalFilters(own: ReportConditionalFilter[], template: ReportConditionalFilter[], has: Has): ReportConditionalFilter[] {
  const signature = (filter: ReportConditionalFilter) =>
    [filter.sourceColumn.toLowerCase(), filter.operator, filter.valueText, filter.mode].join('\u0000');
  const seen = new Set(own.map(signature));
  let nextId = own.reduce((max, filter) => Math.max(max, filter.id), 0) + 1;
  const added = template
    .filter(filter => filter?.sourceColumn && has(filter.sourceColumn) && !seen.has(signature(filter)))
    .map(filter => ({ ...filter, id: nextId++ }));
  return [...own, ...added];
}

function measureReferences(measure: DaxMeasureConfig): string[] {
  return [...getDaxReferencedColumns(measure), ...(measure.columns ?? []), ...(measure.numeratorColumns ?? []), ...(measure.denominatorColumns ?? [])];
}

/** The report's DAX measures plus the template measures whose columns (or measures) exist. */
export function mergeDaxModels(own: DaxModelConfig, template: DaxModelConfig | null | undefined, has: Has): DaxModelConfig {
  const ownMeasures = (own.measures ?? []).filter(measure => measure.expression?.trim());
  const candidates = (template?.measures ?? []).filter(measure => measure.expression?.trim());
  const measureNames = columnNameSet([...ownMeasures, ...candidates].map(measure => measure.name ?? ''));
  const signature = (measure: DaxMeasureConfig) => `${(measure.expression ?? '').replace(/\s+/g, '').toLowerCase()}\u0000${measure.evaluationScope ?? 'column'}`;
  const ownNames = columnNameSet(ownMeasures.map(measure => measure.name ?? ''));
  const ownSignatures = new Set(ownMeasures.map(signature));
  const ownIds = new Set(ownMeasures.map(measure => measure.id));
  const added = candidates
    .filter(measure => measureReferences(measure).every(column => has(column) || measureNames(column)))
    .filter(measure => !ownNames(measure.name ?? '') && !ownSignatures.has(signature(measure)))
    .map(measure => (ownIds.has(measure.id) ? { ...measure, id: `${measure.id}-template` } : measure));
  if (!added.length) return own;
  return { ...own, enabled: own.enabled || !!template?.enabled, measures: [...ownMeasures, ...added] };
}

function keepRecord<T>(record: Record<string, T>, keepKey: (key: string) => boolean): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => keepKey(key)));
}

function cellKeyField(key: string): string | undefined {
  if (key.startsWith('record:')) {
    try {
      const parsed: unknown = JSON.parse(key.slice('record:'.length));
      return Array.isArray(parsed) && typeof parsed[1] === 'string' ? parsed[1] : undefined;
    } catch {
      return undefined;
    }
  }
  return /^\d+:([\s\S]*)$/.exec(key)?.[1];
}

function groupKeyFields(key: string): string[] | undefined {
  if (!key.startsWith('group:')) return undefined;
  try {
    const path: unknown = JSON.parse(key.slice('group:'.length));
    return Array.isArray(path) ? path.map(entry => (Array.isArray(entry) ? String(entry[0]) : '')) : undefined;
  } catch {
    return undefined;
  }
}

/** Template column-keyed settings without entries for columns the report does not have. */
export function dropMissingColumnKeys<T extends ReportColumnKeyedSettings>(settings: T, has: Has): T {
  const out: T = { ...settings };
  const set = <K extends keyof ReportColumnKeyedSettings>(prop: K, value: ReportColumnKeyedSettings[K]) => {
    (out as ReportColumnKeyedSettings)[prop] = value;
  };
  for (const prop of ['headerCellColors', 'headerCellTextColors', 'headerCellOrientations', 'headerCellAlignments', 'headerCellBorders'] as const) {
    const value = settings[prop] as Record<string, unknown> | undefined;
    if (value) set(prop, keepRecord(value, has) as never);
  }
  for (const prop of ['cellColors', 'cellTextColors', 'cellOrientations', 'cellAlignments', 'cellBorders', 'cellEmbeds', 'cellOverrides'] as const) {
    const value = settings[prop] as Record<string, unknown> | undefined;
    if (value) set(prop, keepRecord(value, key => { const field = cellKeyField(key); return field == null || has(field); }) as never);
  }
  for (const prop of ['rowColorsByKey', 'rowTextColorsByKey'] as const) {
    const value = settings[prop];
    if (value) set(prop, keepRecord(value, key => groupKeyFields(key)?.every(has) ?? true));
  }
  for (const prop of ['pinnedColumns', 'dataBarColumns', 'rowGroupFields'] as const) {
    const value = settings[prop];
    if (value) set(prop, value.filter(has));
  }
  if (settings.manualRows) {
    set('manualRows', Object.fromEntries(Object.entries(settings.manualRows).map(([id, values]) => [id, values ? keepRecord(values, has) : values])));
  }
  if (settings.mergedCellRanges) set('mergedCellRanges', settings.mergedCellRanges.filter(range => has(range.field)));
  if (settings.conditionalRules) set('conditionalRules', settings.conditionalRules.filter(rule => has(rule.field)));
  return out;
}

function conditionalRuleSignature(rule: ConditionalRule): string {
  const { id: _id, ...rest } = rule;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

/** The report's own column-keyed settings with the template's added; the template wins on the same key. */
export function mergeReportColumnKeys(own: Required<ReportColumnKeyedSettings>, incoming: Required<ReportColumnKeyedSettings>): Required<ReportColumnKeyedSettings> {
  const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
  const rangeKey = (range: MergedCellRange) => `${range.rowIndex}\u0000${range.field}`;
  const incomingRanges = new Set(incoming.mergedCellRanges.map(rangeKey));
  const ownRuleSignatures = new Set(own.conditionalRules.map(conditionalRuleSignature));
  const ownRuleIds = new Set(own.conditionalRules.map(rule => rule.id));
  const manualRows = { ...own.manualRows };
  for (const [id, values] of Object.entries(incoming.manualRows)) manualRows[id] = { ...(own.manualRows[id] ?? {}), ...values };
  return {
    headerCellColors: { ...own.headerCellColors, ...incoming.headerCellColors },
    headerCellTextColors: { ...own.headerCellTextColors, ...incoming.headerCellTextColors },
    headerCellOrientations: { ...own.headerCellOrientations, ...incoming.headerCellOrientations },
    headerCellAlignments: { ...own.headerCellAlignments, ...incoming.headerCellAlignments },
    headerCellBorders: { ...own.headerCellBorders, ...incoming.headerCellBorders },
    cellColors: { ...own.cellColors, ...incoming.cellColors },
    cellTextColors: { ...own.cellTextColors, ...incoming.cellTextColors },
    cellOrientations: { ...own.cellOrientations, ...incoming.cellOrientations },
    cellAlignments: { ...own.cellAlignments, ...incoming.cellAlignments },
    cellBorders: { ...own.cellBorders, ...incoming.cellBorders },
    cellEmbeds: { ...own.cellEmbeds, ...incoming.cellEmbeds },
    cellOverrides: { ...own.cellOverrides, ...incoming.cellOverrides },
    rowColorsByKey: { ...own.rowColorsByKey, ...incoming.rowColorsByKey },
    rowTextColorsByKey: { ...own.rowTextColorsByKey, ...incoming.rowTextColorsByKey },
    manualRows,
    mergedCellRanges: [...own.mergedCellRanges.filter(range => !incomingRanges.has(rangeKey(range))), ...incoming.mergedCellRanges],
    pinnedColumns: union(own.pinnedColumns, incoming.pinnedColumns),
    dataBarColumns: union(own.dataBarColumns, incoming.dataBarColumns),
    rowGroupFields: incoming.rowGroupFields.length ? incoming.rowGroupFields : own.rowGroupFields,
    conditionalRules: [
      ...own.conditionalRules,
      ...incoming.conditionalRules
        .filter(rule => !ownRuleSignatures.has(conditionalRuleSignature(rule)))
        .map(rule => (ownRuleIds.has(rule.id) ? { ...rule, id: `${rule.id}-template` } : rule)),
    ],
  };
}
