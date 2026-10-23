import { renameDaxColumn, type DaxMeasureConfig } from './dax-evaluator.util';
import { remapAdvancedColumns } from './advanced-chart.util';
import { coerceNumberAllowPercent, isPercentValue } from './percent-number.util';

export type ParameterFilterAction =
  | 'type_change'
  | 'rename_column'
  | 'replace_nulls'
  | 'deduplicate'
  | 'split_column'
  | 'merge_columns'
  | 'trim_text'
  | 'text_operation'
  | 'append_text'
  | 'prepend_text'
  | 'extract_value'
  | 'json_extract'
  | 'math_transform'
  | 'date_operation';

export interface ParameterFilterRule {
  id: number;
  // '' = no action chosen yet — the Action dropdown shows its Select placeholder until picked.
  action: ParameterFilterAction | '';
  enabled?: boolean;
  sourceColumn?: string;
  sourceColumns?: string[];
  secondaryColumn?: string;
  targetType?: string;
  newColumnName?: string;
  replaceValue?: string;
  valueText?: string;
  dedupStrategy?: string;
  delimiter?: string;
  separator?: string;
  textTransform?: string;
  textOperation?: string;
  literalText?: string;
  findText?: string;
  replaceText?: string;
  textLength?: number;
  padDirection?: string;
  padCharacter?: string;
  dateOperation?: string;
  dateFormat?: string;
  datePart?: string;
  dateAmount?: number | null;
  dateUnit?: string;
  extractMode?: string;
  extractLength?: number;
  startIndex?: number;
  jsonPath?: string;
  mathOperator?: string;
  mathValue?: number | null;
}

/** Math operators that need no user-entered value. */
const MATH_OPERATORS_WITHOUT_VALUE = new Set(['sqrt']);

/**
 * Why a rule cannot run yet, or null when it is complete. Incomplete rules are skipped by
 * applyParameterFilters and the message is shown under the rule in the builder, so a half-typed
 * rule never silently corrupts the preview (e.g. multiplying by an empty value, or splitting on
 * an empty delimiter, which split every character into its own column).
 */
/** How many of the rows have a value at the rule's JSON path in its source column. */
export function countJsonPathMatches(rows: Record<string, unknown>[], column: string, path: string): number {
  const key = resolveColumnKey(rows[0], column);
  return rows.filter(row => extractJsonPath(row[key], path) !== undefined).length;
}

export function getParameterRuleError(rule: ParameterFilterRule): string | null {
  switch (rule.action) {
    case 'type_change':
      return rule.targetType === '' ? 'Select a target data type.' : null;
    case 'deduplicate':
      return rule.dedupStrategy === '' ? 'Select a deduplication strategy.' : null;
    case 'split_column':
      return rule.delimiter ? null : 'Enter the delimiter to split on.';
    case 'append_text':
    case 'prepend_text':
      // An empty value would be a no-op (and must not coerce null cells into ''), so require text.
      return (rule.literalText ?? '') !== '' ? null : 'Enter the text to add.';
    case 'math_transform': {
      const op = rule.mathOperator ?? '+';
      if (MATH_OPERATORS_WITHOUT_VALUE.has(op)) return null;
      const raw = rule.mathValue;
      if (raw === null || raw === undefined || (raw as unknown) === '' || !Number.isFinite(Number(raw))) return 'Enter the value to apply.';
      if ((op === '/' || op === '%') && Number(raw) === 0) return 'Cannot divide by zero.';
      return null;
    }
    case 'date_operation':
      if (!rule.dateOperation) return 'Select the date operation.';
      if (rule.dateOperation === 'Add/Subtract Duration' && (rule.dateAmount === null || rule.dateAmount === undefined || (rule.dateAmount as unknown) === '')) return 'Enter the amount to add or subtract.';
      if (rule.dateOperation === 'Date Difference' && !rule.secondaryColumn) return 'Select the column to compare with.';
      return null;
    default:
      return null;
  }
}

export function getParameterSelectionError(rules: ParameterFilterRule[]): string | null {
  for (const rule of rules) {
    if (rule.enabled === false || (rule.action !== 'type_change' && rule.action !== 'deduplicate')) continue;
    const error = getParameterRuleError(rule);
    if (error) return error;
  }
  return null;
}

export function getRuleSourceColumns(rule: ParameterFilterRule | undefined | null): string[] {
  if (!rule) return [];
  if (Array.isArray(rule.sourceColumns) && rule.sourceColumns.length > 0) {
    return rule.sourceColumns.filter(c => typeof c === 'string' && c.trim() !== '');
  }
  return rule.sourceColumn?.trim() ? [rule.sourceColumn.trim()] : [];
}

export function getRenamedColumnNames(rules: ParameterFilterRule[]): string[] {
  const renamed = new Set<string>();
  for (const rule of rules) {
    if (rule.action !== 'rename_column' || rule.enabled === false || !rule.newColumnName?.trim()) continue;
    const sources = getRuleSourceColumns(rule);
    const name = rule.newColumnName.trim();
    for (const source of sources) {
      const target = sources.length === 1 ? name
        : name.includes('{col}') || name.includes('{}')
          ? name.replace(/\{col\}|\{\}/gi, source).trim()
          : `${source}_${name}`;
      if (target && target !== source) renamed.add(target);
    }
  }
  return [...renamed];
}

export function getTransformationSourceColumns(columns: string[], rules: ParameterFilterRule[]): string[] {
  const available = new Set(columns);
  const renamedColumns: string[] = [];
  for (const rule of rules) {
    if (rule.action !== 'rename_column' || rule.enabled === false || !rule.newColumnName?.trim()) continue;
    const sources = getRuleSourceColumns(rule);
    for (const source of sources) {
      if (!available.has(source)) continue;
      const name = rule.newColumnName.trim();
      const renamed = sources.length === 1 ? name
        : name.includes('{col}') || name.includes('{}')
          ? name.replace(/\{col\}|\{\}/gi, source).trim()
          : `${source}_${name}`;
      if (renamed && !available.has(renamed)) {
        available.add(renamed);
        renamedColumns.push(renamed);
      }
    }
  }
  return [...renamedColumns, ...columns];
}

export function getSavedParameterFilters(design: Record<string, unknown> | null | undefined): ParameterFilterRule[] {
  const saved = design?.['parameterFilters'] as ParameterFilterRule[] | undefined;
  if (!Array.isArray(saved)) return [];
  return saved
    .filter(r => (Array.isArray(r?.sourceColumns) && r.sourceColumns.length > 0) || !!r?.sourceColumn || r?.action === 'merge_columns')
    .map(r => ({ ...r, separator: r.separator?.trim() ? r.separator : '' }));
}

function safeString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function resolveColumnKey(sample: Record<string, unknown> | undefined, colName: string): string {
  if (!sample || colName in sample) return colName;
  const lower = colName.toLowerCase();
  return Object.keys(sample).find(k => k.toLowerCase() === lower) ?? colName;
}

function resolveTransformedColumnKey(
  sample: Record<string, unknown> | undefined,
  sourceColumn: string,
  rules: ParameterFilterRule[],
): string {
  const directKey = resolveColumnKey(sample, sourceColumn);
  if (sample && directKey in sample) return directKey;

  const renameRule = rules.find(rule =>
    rule.action === 'rename_column' &&
    rule.enabled !== false &&
    getRuleSourceColumns(rule).length === 1 &&
    getRuleSourceColumns(rule)[0].toLowerCase() === sourceColumn.toLowerCase() &&
    !!rule.newColumnName?.trim());
  return renameRule ? resolveColumnKey(sample, renameRule.newColumnName!.trim()) : directKey;
}

/** Parses a JSON cell; also accepts single-quoted JSON (e.g. {'count': 5}) as some sources export it. */
function parseJsonCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  try {
    return JSON.parse(text);
  } catch {
    if (!/^[[{]/.test(text)) return undefined;
    try { return JSON.parse(text.replace(/'/g, '"')); } catch { return undefined; }
  }
}

function extractJsonPath(value: unknown, path: string): unknown {
  const parsed = parseJsonCell(value);
  if (parsed === undefined) return undefined;

  const normalizedPath = path.trim().replace(/^\$\.?/, '');
  if (!normalizedPath) return parsed;

  const segments = normalizedPath.match(/[^.[\]]+|\[(?:"([^"]+)"|'([^']+)'|(\d+))\]/g);
  if (!segments) return undefined;
    const keys = segments.map(segment => segment.startsWith('[')
      ? segment.slice(1, -1).replace(/^["']|["']$/g, '')
      : segment);

    const readPath = (current: unknown, index: number): unknown => {
      if (index === keys.length) return current;
      if (current == null || (typeof current !== 'object' && !Array.isArray(current))) return undefined;

      const key = keys[index];
      if (Array.isArray(current) && !/^\d+$/.test(key)) {
        const values = current.map(item => readPath(item, index));
        return values.length === 1 ? values[0] : values;
      }

      const record = current as Record<string, unknown>;
      // Keys match case-insensitively when there is no exact match ($.count finds "Count").
      const actualKey = key in record ? key : Object.keys(record).find(k => k.toLowerCase() === key.toLowerCase());
      return readPath(actualKey === undefined ? undefined : record[actualKey], index + 1);
    };

    return readPath(parsed, 0);
}

function formatExtractedJsonValue(value: unknown): unknown {
  if (value == null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : value;
}

function parseDate(value: unknown): Date | null {
  const text = safeString(value).trim();
  if (!text) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    const parsed = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Strict ISO (YYYY-MM-DD, optionally with a time) only. Unlike parseDate, this never falls back
// to V8's lenient Date parser, which turns free text like "NIMR-1704" into 01-Jan-1704.
function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getMonth() === Number(match[2]) - 1 ? date : null;
}

function dateToDayNumber(value: unknown): number | null {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  const wallClockTime = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
  return Math.round((wallClockTime - Date.UTC(1900, 0, 1)) / 86400000);
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(date: Date, format: string): string {
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const longMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const replacements: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: longMonths[date.getMonth()],
    MMM: shortMonths[date.getMonth()],
    MM: String(date.getMonth() + 1).padStart(2, '0'),
    DD: String(date.getDate()).padStart(2, '0'),
  };
  return format.replace(/YYYY|MMMM|MMM|MM|DD|YY/g, token => replacements[token]);
}

function getDatePart(date: Date, part: string): string | number {
  switch (part) {
    case 'Year': return date.getFullYear();
    case 'Quarter': return Math.floor(date.getMonth() / 3) + 1;
    case 'Month': return date.getMonth() + 1;
    case 'Week': {
      const start = new Date(date.getFullYear(), 0, 1);
      return Math.ceil((((date.getTime() - start.getTime()) / 86400000) + start.getDay() + 1) / 7);
    }
    case 'Day': return date.getDate();
    default: return toIsoDate(date);
  }
}

function addDateDuration(date: Date, amount: number, unit: string): Date {
  const result = new Date(date);
  if (unit === 'Years') result.setFullYear(result.getFullYear() + amount);
  else if (unit === 'Months') result.setMonth(result.getMonth() + amount);
  else if (unit === 'Weeks') result.setDate(result.getDate() + amount * 7);
  else result.setDate(result.getDate() + amount);
  return result;
}

function dateDifference(left: Date, right: Date, unit: string): number {
  const milliseconds = left.getTime() - right.getTime();
  if (unit === 'Years') return left.getFullYear() - right.getFullYear();
  if (unit === 'Months') return (left.getFullYear() - right.getFullYear()) * 12 + left.getMonth() - right.getMonth();
  if (unit === 'Weeks') return Math.trunc(milliseconds / 604800000);
  return Math.trunc(milliseconds / 86400000);
}

function replaceText(text: string, find: string, replacement: string): string {
  if (!find) return text;
  return text.replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replacement);
}

/** Applies parameter-driven transformation rules to in-memory rows without altering DB tables. */
export function applyParameterFilters(
  rows: Record<string, unknown>[],
  rules: ParameterFilterRule[],
  columns?: string[],
): { rows: Record<string, unknown>[]; columns: string[] } {
  if (!rows.length || !rules.length) return { rows, columns: columns ?? [] };

  let currentRows = rows.map(r => ({ ...r }));
  let currentCols = [...(columns ?? Object.keys(rows[0] ?? {}))];

  for (const rule of rules) {
    if (!rule.action || rule.enabled === false) continue;
    const targetCols = getRuleSourceColumns(rule);
    if (!targetCols.length && rule.action !== 'merge_columns') continue;
    if (getParameterRuleError(rule)) continue;

    switch (rule.action) {
      case 'type_change': {
        const targetType = rule.targetType ?? 'Text';
        for (const col of targetCols) {
          const colKey = resolveTransformedColumnKey(currentRows[0], col, rules);
          currentRows.forEach(row => {
            const val = row[colKey];
            if (val == null) return;
            if (targetType === 'Number') {
              if (val instanceof Date) {
                row[colKey] = dateToDayNumber(val) ?? 0;
              } else {
                const num = coerceNumberAllowPercent(val);
                row[colKey] = Number.isFinite(num) ? num : dateToDayNumber(val) ?? 0;
              }
            } else if (targetType === 'Text') {
              row[colKey] = safeString(val);
            } else if (targetType === 'Boolean') {
              row[colKey] = Boolean(val && val !== 'false' && val !== '0');
            } else if (targetType === 'Date') {
              const d = new Date(safeString(val));
              row[colKey] = !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : val;
            }
          });
        }
        break;
      }

      case 'rename_column': {
        const rawNewName = rule.newColumnName?.trim();
        if (!rawNewName) break;

        if (targetCols.length === 1) {
          const colKey = resolveColumnKey(currentRows[0], targetCols[0]);
          // Skip when the source column isn't present in this data source: resolveColumnKey
          // falls back to the literal name, so renaming would assign undefined and blank out
          // an already-correct destination column (e.g. a template's "Rig No." → "Rig No" rule
          // applied to a source that already has "Rig No").
          if (rawNewName !== colKey && colKey in (currentRows[0] ?? {})) {
            currentRows.forEach(row => {
              row[rawNewName] = row[colKey];
              delete row[colKey];
            });
            currentCols = currentCols.map(c => c === colKey ? rawNewName : c);
          }
        } else {
          for (const col of targetCols) {
            const colKey = resolveColumnKey(currentRows[0], col);
            const renamed = rawNewName.includes('{col}') || rawNewName.includes('{}')
              ? rawNewName.replace(/\{col\}|\{\}/gi, colKey).trim()
              : `${colKey}_${rawNewName}`;
            if (renamed && renamed !== colKey && colKey in (currentRows[0] ?? {})) {
              currentRows.forEach(row => {
                row[renamed] = row[colKey];
                delete row[colKey];
              });
              currentCols = currentCols.map(c => c === colKey ? renamed : c);
            }
          }
        }
        break;
      }

      case 'replace_nulls': {
        const fill = rule.replaceValue ?? '0';
        for (const col of targetCols) {
          const colKey = resolveTransformedColumnKey(currentRows[0], col, rules);
          currentRows.forEach(row => {
            const val = row[colKey];
            if (val == null || val === '' || val === 'null' || val === 'undefined') {
              const num = Number(fill);
              row[colKey] = !isNaN(num) && fill.trim() !== '' ? num : fill;
            }
          });
        }
        break;
      }

      case 'deduplicate': {
        const strategy = rule.dedupStrategy ?? 'Keep First';
        const resolvedKeys = targetCols.map(c => resolveTransformedColumnKey(currentRows[0], c, rules));
        const seen = new Map<string, Record<string, unknown>>();
        const duplicates = new Set<string>();

        const getCompoundKey = (r: Record<string, unknown>) =>
          resolvedKeys.map(k => safeString(r[k]).toLowerCase()).join('___');

        if (strategy === 'Keep Last') {
          for (let i = currentRows.length - 1; i >= 0; i--) {
            const k = getCompoundKey(currentRows[i]);
            if (!seen.has(k)) seen.set(k, currentRows[i]);
          }
          currentRows = Array.from(seen.values()).reverse();
        } else if (strategy === 'Keep Unique') {
          const counts = new Map<string, number>();
          currentRows.forEach(r => {
            const k = getCompoundKey(r);
            counts.set(k, (counts.get(k) ?? 0) + 1);
          });
          currentRows = currentRows.filter(r => counts.get(getCompoundKey(r)) === 1);
        } else {
          // Keep First
          const out: Record<string, unknown>[] = [];
          currentRows.forEach(r => {
            const k = getCompoundKey(r);
            if (!duplicates.has(k)) {
              duplicates.add(k);
              out.push(r);
            }
          });
          currentRows = out;
        }
        break;
      }

      case 'split_column': {
        const delim = rule.delimiter!;
        for (const col of targetCols) {
          const colKey = resolveTransformedColumnKey(currentRows[0], col, rules);
          const prefix = (targetCols.length === 1 && rule.newColumnName?.trim()) ? rule.newColumnName.trim() : `${col}_part`;
          const sourceColumnIndex = currentCols.indexOf(colKey);
          let nextColumnIndex = sourceColumnIndex >= 0 ? sourceColumnIndex + 1 : currentCols.length;
          currentRows.forEach(row => {
            const rawValue = row[colKey];
            const isoDate = rawValue instanceof Date ? rawValue : parseIsoDate(rawValue);
            const text = isoDate ? formatDate(isoDate, 'DD-MMM-YYYY') : safeString(rawValue);
            const parts = text.split(delim);
            parts.forEach((p, idx) => {
              const partCol = `${prefix}_${idx + 1}`;
              row[partCol] = p.trim();
              if (!currentCols.includes(partCol)) currentCols.splice(nextColumnIndex++, 0, partCol);
            });
          });
        }
        break;
      }

      case 'merge_columns': {
        const keysToMerge = targetCols.map(c => resolveTransformedColumnKey(currentRows[0], c, rules));
        if (rule.secondaryColumn) {
          const colKey2 = resolveTransformedColumnKey(currentRows[0], rule.secondaryColumn, rules);
          if (!keysToMerge.includes(colKey2)) keysToMerge.push(colKey2);
        }
        if (!keysToMerge.length) break;
        const sep = rule.separator ?? ' ';
        const mergedCol = rule.newColumnName?.trim() || keysToMerge.join('_');
        currentRows.forEach(row => {
          row[mergedCol] = keysToMerge.map(k => safeString(row[k])).join(sep);
        });
        const firstSourceIndex = Math.min(...keysToMerge
          .map(key => currentCols.indexOf(key))
          .filter(index => index >= 0));
        currentCols = currentCols.filter(column => !keysToMerge.includes(column));
        currentCols.splice(firstSourceIndex >= 0 ? firstSourceIndex : currentCols.length, 0, mergedCol);
        break;
      }

      case 'trim_text': {
        const transform = rule.textTransform ?? 'Trim Whitespace';
        for (const col of targetCols) {
          const colKey = resolveTransformedColumnKey(currentRows[0], col, rules);
          currentRows.forEach(row => {
            let text = safeString(row[colKey]);
            if (transform === 'Trim Whitespace') text = text.trim();
            else if (transform === 'UPPERCASE') text = text.toUpperCase();
            else if (transform === 'lowercase') text = text.toLowerCase();
            else if (transform === 'Title Case') {
              text = text.toLowerCase().replace(/(?:^|\s)\S/g, a => a.toUpperCase());
            }
            row[colKey] = text;
          });
        }
        break;
      }

      case 'text_operation': {
        const operation = rule.textOperation ?? 'Trim Whitespace';
        if (operation === 'Concatenate') {
          const keysToConcatenate = targetCols.map(col => resolveTransformedColumnKey(currentRows[0], col, rules));
          const targetCol = rule.newColumnName?.trim() || keysToConcatenate.join('_');
          const separator = rule.separator ?? ' ';
          currentRows.forEach(row => {
            const values = keysToConcatenate.map(key => safeString(row[key]));
            if (rule.literalText) values.push(rule.literalText);
            row[targetCol] = values.join(separator);
          });
          if (!currentCols.includes(targetCol)) currentCols.push(targetCol);
          break;
        }
        for (const col of targetCols) {
          const colKey = resolveTransformedColumnKey(currentRows[0], col, rules);
          const targetCol = (targetCols.length === 1 && rule.newColumnName?.trim()) ? rule.newColumnName.trim() : colKey;
          const secondaryKey = rule.secondaryColumn
            ? resolveTransformedColumnKey(currentRows[0], rule.secondaryColumn, rules)
            : '';
          currentRows.forEach(row => {
            const text = safeString(row[colKey]);
            let result = text;
            if (operation === 'Trim Whitespace') result = text.trim();
            else if (operation === 'UPPERCASE') result = text.toUpperCase();
            else if (operation === 'lowercase') result = text.toLowerCase();
            else if (operation === 'Title Case') result = text.toLowerCase().replace(/(?:^|\s)\S/g, char => char.toUpperCase());
            else if (operation === 'Replace Text') result = replaceText(text, rule.findText ?? '', rule.replaceText ?? '');
            else if (operation === 'First N Chars') result = text.slice(0, Math.max(0, Number(rule.textLength) || 0));
            else if (operation === 'Last N Chars') result = text.slice(-Math.max(0, Number(rule.textLength) || 0));
            else if (operation === 'Substring') result = text.slice(Math.max(0, Number(rule.startIndex) || 0), Math.max(0, Number(rule.startIndex) || 0) + Math.max(0, Number(rule.textLength) || 0));
            else if (operation === 'Pad') result = (rule.padDirection === 'Left' ? text.padStart : text.padEnd).call(text, Math.max(text.length, Number(rule.textLength) || 0), rule.padCharacter || ' ');
            else if (operation === 'Remove Characters') result = text.split(rule.findText ?? '').join('');
            else if (operation === 'Regex Extract') {
              try { result = text.match(new RegExp(rule.findText ?? ''))?.[0] ?? ''; } catch { result = ''; }
            }
            row[targetCol] = result;
          });
          if (!currentCols.includes(targetCol)) currentCols.push(targetCol);
        }
        break;
      }

      case 'append_text':
      case 'prepend_text': {
        // Adds a fixed string to the end (append) or start (prepend) of each non-empty cell.
        // Blank/null cells are left untouched so the column isn't polluted with the lone value.
        const addition = rule.literalText ?? '';
        const isAppend = rule.action === 'append_text';
        for (const col of targetCols) {
          const colKey = resolveTransformedColumnKey(currentRows[0], col, rules);
          const targetCol = (targetCols.length === 1 && rule.newColumnName?.trim()) ? rule.newColumnName.trim() : colKey;
          currentRows.forEach(row => {
            const raw = row[colKey];
            if (raw == null || raw === '') {
              if (targetCol !== colKey) row[targetCol] = raw ?? '';
              return;
            }
            const text = safeString(raw);
            row[targetCol] = isAppend ? text + addition : addition + text;
          });
          if (!currentCols.includes(targetCol)) currentCols.push(targetCol);
        }
        break;
      }

      case 'extract_value': {
        const mode = rule.extractMode ?? 'First N Chars';
        const len = Math.max(1, Number(rule.extractLength) || 1);
        const start = Math.max(0, Number(rule.startIndex) || 0);

        for (const col of targetCols) {
          const colKey = resolveTransformedColumnKey(currentRows[0], col, rules);
          const targetCol = (targetCols.length === 1 && rule.newColumnName?.trim()) ? rule.newColumnName.trim() : colKey;
          currentRows.forEach(row => {
            const text = safeString(row[colKey]);
            let extracted = text;
            if (mode === 'First N Chars') extracted = text.slice(0, len);
            else if (mode === 'Last N Chars') extracted = text.slice(-len);
            else if (mode === 'Substring') extracted = text.slice(start, start + len);
            row[targetCol] = extracted;
          });
          if (!currentCols.includes(targetCol)) currentCols.push(targetCol);
        }
        break;
      }

      case 'json_extract': {
        const path = rule.jsonPath ?? '';
        for (const col of targetCols) {
          const colKey = resolveTransformedColumnKey(currentRows[0], col, rules);
          const targetCol = (targetCols.length === 1 && rule.newColumnName?.trim()) ? rule.newColumnName.trim() : colKey;
          const extracted = currentRows.map(row => extractJsonPath(row[colKey], path));
          // A path that matches nothing must not blank out the source column it would overwrite.
          if (targetCol === colKey && extracted.every(value => value === undefined)) continue;
          currentRows.forEach((row, index) => { row[targetCol] = formatExtractedJsonValue(extracted[index]); });
          if (!currentCols.includes(targetCol)) currentCols.push(targetCol);
        }
        break;
      }

      case 'math_transform': {
        const op = rule.mathOperator ?? '+';
        if (!MATH_OPERATORS_WITHOUT_VALUE.has(op) && (rule.mathValue == null || String(rule.mathValue).trim() === '')) break;
        const operand = Number(rule.mathValue ?? 0);
        if (!Number.isFinite(operand)) break;

        for (const col of targetCols) {
          const colKey = resolveTransformedColumnKey(currentRows[0], col, rules);
          const targetCol = (targetCols.length === 1 && rule.newColumnName?.trim()) ? rule.newColumnName.trim() : colKey;
          currentRows.forEach(row => {
            const cell = row[colKey];
            const num = coerceNumberAllowPercent(cell);
            if (!Number.isFinite(num)) return;
            let result = num;
            if (op === '+') result = num + operand;
            else if (op === '-') result = num - operand;
            else if (op === '*') result = num * operand;
            else if (op === '/' && operand !== 0) result = num / operand;
            else if (op === 'average') result = (num + operand) / 2;
            else if (op === '%' && operand !== 0) result = num % operand;
            else if (op === 'power') result = Math.pow(num, operand);
            else if (op === 'abs') result = Math.abs(num - operand);
            else if (op === 'sqrt' && num + operand >= 0) result = Math.sqrt(num + operand);
            else if (op === 'percentage') result = num * operand / 100;
            row[targetCol] = isPercentValue(cell) ? `${result}%` : result;
          });
          if (!currentCols.includes(targetCol)) currentCols.push(targetCol);
        }
        break;
      }

      case 'date_operation': {
        const operation = rule.dateOperation!;
        for (const col of targetCols) {
          const colKey = resolveTransformedColumnKey(currentRows[0], col, rules);
          const targetCol = (targetCols.length === 1 && rule.newColumnName?.trim()) ? rule.newColumnName.trim() : colKey;
          const secondaryKey = rule.secondaryColumn
            ? resolveTransformedColumnKey(currentRows[0], rule.secondaryColumn, rules)
            : '';
          currentRows.forEach(row => {
            const date = parseDate(row[colKey]);
            if (!date) return;
            if (operation === 'Format Date') row[targetCol] = formatDate(date, rule.dateFormat || 'YYYY-MM-DD');
            else if (operation === 'Extract Date Part') row[targetCol] = getDatePart(date, rule.datePart || 'Year');
            else if (operation === 'Add/Subtract Duration') row[targetCol] = toIsoDate(addDateDuration(date, Number(rule.dateAmount) || 0, rule.dateUnit || 'Days'));
            else if (operation === 'Start of Period') {
              const result = new Date(date);
              if (rule.datePart === 'Year') result.setMonth(0, 1);
              else if (rule.datePart === 'Quarter') result.setMonth(Math.floor(result.getMonth() / 3) * 3, 1);
              else if (rule.datePart === 'Month') result.setDate(1);
              else if (rule.datePart === 'Week') result.setDate(result.getDate() - result.getDay());
              row[targetCol] = toIsoDate(result);
            } else if (operation === 'End of Period') {
              const result = new Date(date);
              if (rule.datePart === 'Year') result.setMonth(11, 31);
              else if (rule.datePart === 'Quarter') result.setMonth(Math.floor(result.getMonth() / 3) * 3 + 3, 0);
              else if (rule.datePart === 'Month') result.setMonth(result.getMonth() + 1, 0);
              else if (rule.datePart === 'Week') result.setDate(result.getDate() + (6 - result.getDay()));
              row[targetCol] = toIsoDate(result);
            } else if (operation === 'Date Difference') {
              const comparison = parseDate(row[secondaryKey]);
              if (comparison) row[targetCol] = dateDifference(date, comparison, rule.dateUnit || 'Days');
            }
          });
          if (!currentCols.includes(targetCol)) currentCols.push(targetCol);
        }
        break;
      }
    }
  }

  return { rows: currentRows, columns: currentCols };
}

/** Updates design column references (xAxis, yAxis, yAggColumn, multiYColumns, comboLineColumns) when columns are renamed. */
export function remapDesignColumns(design: Record<string, any>, rules: ParameterFilterRule[]): Record<string, any> {
  if (!design || !rules.length) return design;
  const updated = { ...design };
  for (const rule of rules) {
    if (rule.action === 'rename_column' && rule.enabled !== false && rule.newColumnName?.trim()) {
      const cols = getRuleSourceColumns(rule);
      if (cols.length === 1) {
        const oldCol = cols[0];
        const newCol = rule.newColumnName.trim();
        if (oldCol && newCol && oldCol !== newCol) {
          if (updated['advancedConfig']) updated['advancedConfig'] = remapAdvancedColumns(updated['advancedConfig'], oldCol, newCol);
          if (Array.isArray(updated['daxModel']?.measures)) {
            updated['daxModel'] = { ...updated['daxModel'], measures: updated['daxModel'].measures.map((m: DaxMeasureConfig) => renameDaxColumn(m, oldCol, newCol)) };
          }
          if (updated['xAxis'] === oldCol) {
            updated['xAxis'] = newCol;
            updated['xAxisTitle'] = newCol;
          }
          if (updated['yAxis'] === oldCol) {
            updated['yAxis'] = newCol;
            updated['yAxisTitle'] = newCol;
          }
          if (updated['yAggColumn'] === oldCol) updated['yAggColumn'] = newCol;
          if (Array.isArray(updated['multiYColumns'])) {
            updated['multiYColumns'] = updated['multiYColumns'].map((c: string) => c === oldCol ? newCol : c);
          }
          if (Array.isArray(updated['comboLineColumns'])) {
            updated['comboLineColumns'] = updated['comboLineColumns'].map((c: string) => c === oldCol ? newCol : c);
          }
        }
      } else if (cols.length > 1) {
        for (const oldCol of cols) {
          const newCol = rule.newColumnName.includes('{col}') || rule.newColumnName.includes('{}')
            ? rule.newColumnName.replace(/\{col\}|\{\}/gi, oldCol).trim()
            : `${oldCol}_${rule.newColumnName.trim()}`;
          if (oldCol && newCol && oldCol !== newCol) {
            if (updated['advancedConfig']) updated['advancedConfig'] = remapAdvancedColumns(updated['advancedConfig'], oldCol, newCol);
          if (Array.isArray(updated['daxModel']?.measures)) {
            updated['daxModel'] = { ...updated['daxModel'], measures: updated['daxModel'].measures.map((m: DaxMeasureConfig) => renameDaxColumn(m, oldCol, newCol)) };
          }
            if (updated['xAxis'] === oldCol) {
              updated['xAxis'] = newCol;
              updated['xAxisTitle'] = newCol;
            }
            if (updated['yAxis'] === oldCol) {
              updated['yAxis'] = newCol;
              updated['yAxisTitle'] = newCol;
            }
            if (updated['yAggColumn'] === oldCol) updated['yAggColumn'] = newCol;
            if (Array.isArray(updated['multiYColumns'])) {
              updated['multiYColumns'] = updated['multiYColumns'].map((c: string) => c === oldCol ? newCol : c);
            }
            if (Array.isArray(updated['comboLineColumns'])) {
              updated['comboLineColumns'] = updated['comboLineColumns'].map((c: string) => c === oldCol ? newCol : c);
            }
          }
        }
      }
    }
  }
  return updated;
}
