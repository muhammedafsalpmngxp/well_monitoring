import { Component, Input, Output, EventEmitter, ChangeDetectorRef, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { Router } from '@angular/router';
import { forkJoin, of, Observable } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import {
  ClientSideRowModelModule,
  ColDef,
  ModuleRegistry,
  themeQuartz,
} from 'ag-grid-community';
import { AvrFieldTagsRendererComponent } from './cell-renderers/avr-field-tags-renderer.component';
import { AvrActionsRendererComponent } from './cell-renderers/avr-actions-renderer.component';
import { CommonApiService, DatabaseViewListItem, DatabaseViewDetail } from '../../../core/services/common-api.service';
import { DataQualityService } from '../../../core/services/data-quality.service';
import { NotificationHelper } from '../../../core/helpers/notification.helper';

ModuleRegistry.registerModules([ClientSideRowModelModule]);

export interface FieldGroup {
  sourceTable: string;
  addedColumns: number;
  fields: string[];
  fieldTypes?: Record<string, string>;
  primaryKeys?: string[];
}

@Component({
  selector: 'app-add-validation-rule',
  standalone: false,
  templateUrl: './add-validation-rule.component.html',
  styleUrls: ['./add-validation-rule.component.scss'],
})
export class AddValidationRuleComponent implements OnInit, OnChanges {
  @Input() isModal = false;
  @Input() editRuleId: string | null = null;
  @Input() viewMode = false;
  @Input() preloadedViews: DatabaseViewListItem[] = [];
  @Output() ruleSaved = new EventEmitter<void>();

  get isEditMode(): boolean { return !!this.editRuleId; }

  // ─── Rule Details ────────────────────────────────────────────────────────
  ruleName = '';
  category = '';
  severity = 'Critical';

  readonly categoryOptions = ['Completeness', 'Reference', 'Data Integrity', 'Range Check', 'Calculation / Formula', 'Logical', 'Format Validation'];
  readonly severityOptions = ['Critical', 'High', 'Medium', 'Low'];

  get descriptionHint(): string {
    switch (this.category) {
      case 'Completeness':
        return 'Auto-checks selected field(s) for NULL or blank values.\nExample: "Ensure well_id is never empty."';
      case 'Reference':
      case 'Data Integrity':
        return 'Checks for duplicate rows across selected columns.\nExample: "No duplicate (well_id, week_number) pairs."';
      case 'Range Check':
        return 'Flags values that are not valid numbers.\nExample: "progress_pct must be a valid numeric value."';
      case 'Calculation / Formula':
        return 'Flags numeric values outside the 0–1 range.\nExample: "overall_progress must be between 0 and 1 (0% to 100%)."';
      case 'Logical':
        return 'Compares two columns — flags rows where Column A > Column B.\nExample: "rig_off_date must not be before rig_on_date."\nNote: Select at least 2 columns, or write your own condition in Rule Condition.';
      case 'Format Validation':
        return 'Flags values that cannot be parsed as a valid date or number.\nExample: "spud_date must be a valid date format (YYYY-MM-DD)."';
      default:
        return 'Human-readable description of what this rule checks...';
    }
  }

  get generatedQueryDisplay(): string {
    if (this.sourceType === 'view') {
      const byTable = this.groupFieldsByTable(this.fieldGroups.flatMap(group => group.fields));
      if (byTable && byTable.size > 1) return this.buildMultiTableQuery(byTable);
    }

    const resolved = this.resolveTableAndFields();
    if (!resolved) return this.conditionLogic;

    const { table, fields, primaryKeys } = resolved;
    const top = this.maximumRecords ? `TOP ${Number.parseInt(this.maximumRecords, 10)} ` : '';
    const columns = fields.map(field => `[${field.replace(/[[\]]/g, '')}]`);
    const primaryKeyColumns = primaryKeys
      .filter(primaryKey => !fields.some(field => field.toLowerCase() === primaryKey.toLowerCase()))
      .map(primaryKey => `[${primaryKey.replace(/[[\]]/g, '')}]`);
    const timestampSql = this.quotedTimestampColumn();
    const timestampAlreadyProjected = [...primaryKeys, ...fields]
      .some(field => field.replace(/[\[\]]/g, '').toLowerCase() === this.timestampColumn.toLowerCase());
    const projectedColumns = [...primaryKeyColumns, ...columns, ...(timestampSql && !timestampAlreadyProjected ? [timestampSql] : [])];
    const colList = columns.join(', ');
    const projectedColList = projectedColumns.join(', ');
    const quotedTable = this.quoteTableForDisplay(table);
    const condition = this.expandShorthandCondition(this.additionalCondition.trim(), fields[0]);
    const rangeCondition = this.rangeCheckCondition(condition, fields[0]);
    const withCondition = (whereClause: string, appendedCondition = condition) => whereClause + (appendedCondition ? ` AND (${appendedCondition})` : '');
    const withDateDefault = (predicate: string, nullSafe = false) => {
      const extra = [...this.defaultDatePredicates(fields, columns, nullSafe), ...this.timestampDatePredicates()];
      return extra.length ? `(${predicate}) AND ${extra.join(' AND ')}` : predicate;
    };

    switch (this.category) {
      case 'Reference':
      case 'Data Integrity': {
        const duplicateColumns = this.parseDuplicateCondition(condition, fields, columns);
        const dupColList = duplicateColumns ?? colList;
        const primaryKeyProjection = this.buildPrimaryKeyProjection(primaryKeyColumns);
        const timestampAggregate = timestampSql && !dupColList.toLowerCase().includes(timestampSql.toLowerCase())
          ? `MIN(${timestampSql}) AS ${timestampSql}, `
          : '';
        const dupFilters = [
          ...(condition && !duplicateColumns ? [`(${condition})`] : []),
          ...this.defaultDatePredicates(fields, columns, false),
          ...this.timestampDatePredicates(),
        ];
        return `SELECT ${primaryKeyProjection}${timestampAggregate}${dupColList}, COUNT(*) AS dup_count FROM ${quotedTable}`
          + (dupFilters.length ? ` WHERE ${dupFilters.join(' AND ')}` : '') + ` GROUP BY ${dupColList} HAVING COUNT(*) > 1`;
      }
      case 'Range Check': {
        const between = this.parseBetweenCondition(condition, fields, columns);
        return `SELECT ${top}${projectedColList} FROM ${quotedTable} WHERE `
          + withDateDefault(between || rangeCondition || columns.map((column, index) => this.rangeCheckPredicate(column, this.fieldTypeFor(fields[index]))).join(' OR '));
      }
      case 'Logical': {
        const logicalCondition = this.parseLogicalCondition(condition, fields, columns);
        if (logicalCondition) {
          return `SELECT ${top}${projectedColList} FROM ${quotedTable} WHERE ${withDateDefault(logicalCondition)}`;
        }
        if (condition) {
          return `SELECT ${top}${projectedColList} FROM ${quotedTable} WHERE ${withDateDefault(condition)}`;
        }
        if (columns.length >= 2) {
          const compareColumns = columns[0] + ' IS NOT NULL AND ' + columns[1] + ' IS NOT NULL AND ' + columns[0] + ' > ' + columns[1];
          return `SELECT ${top}${projectedColList} FROM ${quotedTable} WHERE ${withDateDefault(compareColumns)}`;
        }
        break;
      }
      case 'Calculation':
      case 'Formula':
      case 'Calculation / Formula': {
        const arithmetic = this.parseArithmeticCondition(condition, fields, columns);
        if (arithmetic) {
          return `SELECT ${top}${projectedColList} FROM ${quotedTable} WHERE ${withDateDefault(arithmetic)}`;
        }
        const between = this.parseBetweenCondition(condition, fields, columns);
        return `SELECT ${top}${projectedColList} FROM ${quotedTable} WHERE `
          + withDateDefault(between || rangeCondition || columns.map((column, index) => this.rangeCheckPredicate(column, this.fieldTypeFor(fields[index]))).join(' OR '));
      }
      case 'Format Validation': {
        const formatCondition = this.parseFormatValidationCondition(condition, fields, columns);
        if (formatCondition) {
          return `SELECT ${top}${projectedColList} FROM ${quotedTable} WHERE ${withDateDefault(formatCondition)}`;
        }
        return `SELECT ${top}${projectedColList} FROM ${quotedTable} WHERE ` + withDateDefault(withCondition(
          columns.map(c => `(${c} IS NOT NULL AND LTRIM(RTRIM(CAST(${c} AS NVARCHAR(MAX)))) <> '' AND TRY_CAST(${c} AS DATE) IS NULL AND TRY_CAST(${c} AS FLOAT) IS NULL)`).join(' OR ')));
      }
      case 'Completeness':
        break;
      default:
        // No category chosen yet — preview the NULL/blank check so the box is never empty
        break;
    }

    const nullCheck = columns
      .map(column => `(${column} IS NULL OR LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX)))) = '')`)
      .join(' OR ');

    return `SELECT ${top}${projectedColList} FROM ${quotedTable} WHERE ` + withDateDefault(withCondition(nullCheck), true);
  }

  private static readonly DefaultDateTypes = ['date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset'];

  /** `<col> <> '1900-01-01 ...'` for each selected date/time column; nullSafe keeps NULLs matchable (Completeness). */
  private defaultDatePredicates(fields: string[], columns: string[], nullSafe: boolean): string[] {
    // User is explicitly checking the placeholder date — don't exclude it.
    if (this.additionalCondition.includes('1900-01-01')) return [];
    return fields.flatMap((field, index) => {
      const type = this.resolvedFieldType(field)?.toLowerCase();
      if (!type || !AddValidationRuleComponent.DefaultDateTypes.includes(type)) return [];
      // DATETIME/SMALLDATETIME/DATE cannot implicitly convert a 7-digit fractional literal.
      const literal = type === 'datetime2' || type === 'datetimeoffset' ? '1900-01-01 00:00:00.0000000' : '1900-01-01';
      const predicate = `${columns[index]} <> '${literal}'`;
      return [nullSafe ? `(${columns[index]} IS NULL OR ${predicate})` : predicate];
    });
  }

  private timestampDatePredicates(table?: string): string[] {
    if (!this.timestampColumn || (!this.customStartDate && !this.customEndDate)) return [];
    if (table && table.toLowerCase() !== this.sourceTable.toLowerCase()) return [];
    const column = `[${this.timestampColumn.replace(/]/g, ']]')}]`;
    const start = this.customStartDate ? this.formatSqlTimestamp(this.customStartDate) : null;
    const end = this.customEndDate ? this.formatSqlTimestamp(this.customEndDate) : null;
    if ((this.customStartDate && !start) || (this.customEndDate && !end)) return [];
    if (!this.customStartDate || !this.customEndDate) {
      return [`${column} = '${start ?? end}'`];
    }
    return [`${column} >= '${start}'`, `${column} <= '${end}'`];
  }

  private formatSqlTimestamp(value: string): string | null {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?$/.exec(value);
    if (!match) return null;
    const seconds = match[4] ?? '00';
    const fraction = (match[5] ?? '').padEnd(7, '0');
    return `${match[1]} ${match[2]}:${match[3]}:${seconds}.${fraction}`;
  }

  private resolvedFieldType(field: string): string | undefined {
    const direct = this.fieldTypeFor(field) ?? this.columnTypes[field];
    if (direct) return direct;
    const suffix = `.${field}`.toLowerCase();
    for (const group of this.fieldGroups) {
      const key = Object.keys(group.fieldTypes ?? {}).find(name => name.toLowerCase().endsWith(suffix));
      if (key) return group.fieldTypes![key];
    }
    return undefined;
  }

  private buildPrimaryKeyProjection(primaryKeyColumns: string[]): string {
    const projection = primaryKeyColumns.map(column => `MIN(${column}) AS ${column}`).join(', ');
    return projection ? `${projection}, ` : '';
  }

  private quotedTimestampColumn(table?: string): string {
    if (!this.timestampColumn || (table && table.toLowerCase() !== this.sourceTable.toLowerCase())) return '';
    return `[${this.timestampColumn.replace(/]/g, ']]')}]`;
  }

  /**
   * Resolves the real table + raw columns to generate a query against. For table-source rules
   * this is just the added field groups. For view-source rules whose fields were parsed from raw
   * SQL as `tableName.columnName`, the underlying table is extracted so the query runs directly
   * against it instead of the view (whose own output doesn't expose those raw columns).
   */
  private resolveTableAndFields(): { table: string; fields: string[]; primaryKeys: string[] } | null {
    if (!this.fieldGroups.length) return null;
    if (this.sourceType === 'table') {
      return {
        table: this.fieldGroups.map(group => group.sourceTable).join(', '),
        fields: this.fieldGroups.flatMap(group => group.fields),
        primaryKeys: this.fieldGroups.flatMap(group => group.primaryKeys ?? []),
      };
    }
    if (this.sourceType === 'view') {
      return this.parseTableQualifiedFields(this.fieldGroups.flatMap(group => group.fields));
    }
    return null;
  }

  /** Splits `schema.tableName.columnName` field entries into a single `schema.table` + raw column names. */
  private parseTableQualifiedFields(fields: string[]): { table: string; fields: string[]; primaryKeys: string[] } | null {
    if (!fields.length) return null;
    const parsed = fields.map(f => {
      const parts = f.split('.');
      return parts.length >= 3 ? { table: `${parts[0]}.${parts[1]}`, column: parts.slice(2).join('.') } : null;
    });
    if (parsed.some(p => !p)) return null;
    const tables = new Set(parsed.map(p => p!.table));
    if (tables.size !== 1) return null;
    const table = [...tables][0];
    return { table, fields: parsed.map(p => p!.column), primaryKeys: this.primaryKeysByTable.get(table) ?? [] };
  }

  /** Groups `schema.tableName.columnName` field entries by their `schema.table`. Null if any field isn't fully qualified. */
  private groupFieldsByTable(fields: string[]): Map<string, string[]> | null {
    if (!fields.length) return null;
    const byTable = new Map<string, string[]>();
    for (const f of fields) {
      const parts = f.split('.');
      if (parts.length < 3) return null;
      const table = `${parts[0]}.${parts[1]}`;
      const column = parts.slice(2).join('.');
      const columns = byTable.get(table) ?? [];
      if (!columns.includes(column)) columns.push(column);
      byTable.set(table, columns);
    }
    return byTable;
  }

  /** Builds a per-table query for fields sourced from more than one table in a view. */
  private buildMultiTableQuery(byTable: Map<string, string[]>): string {
    const top = this.maximumRecords ? `TOP ${Number.parseInt(this.maximumRecords, 10)} ` : '';
    const rawCondition = this.additionalCondition.trim();
    const selects: string[] = [];
    byTable.forEach((columns, table) => {
      const condition = this.expandShorthandCondition(rawCondition, columns[0]);
      const quotedTable = this.quoteTableForDisplay(table);
      const tableLiteral = table.replaceAll("'", "''");
      const timestampSql = this.quotedTimestampColumn(table);
      const timestampInFields = columns.some(column => column.toLowerCase() === this.timestampColumn.toLowerCase());
      const timestampColumnProjection = timestampSql && !timestampInFields ? `${timestampSql}, ` : '';
      const columnsSql = columns.map(col => `[${col.replace(/[\[\]]/g, '')}]`).join(', ');
      const primaryKeys = this.primaryKeysByTable.get(table) ?? [];
      const primaryKeyColumns = primaryKeys
        .filter(primaryKey => !columns.some(column => column.toLowerCase() === primaryKey.toLowerCase()))
        .map(primaryKey => `[${primaryKey.replaceAll('[', '').replaceAll(']', '')}]`);
      const primaryKeyValue = this.buildNormalizedPrimaryKeyProjection(primaryKeyColumns, false);
      const rangeCondition = this.rangeCheckCondition(condition, columns[0]);
      const quotedColumns = columns.map(col => `[${col.replace(/[[\]]/g, '')}]`);

      if (this.category === 'Reference' || this.category === 'Data Integrity') {
        const primaryKeyProjection = this.buildNormalizedPrimaryKeyProjection(primaryKeyColumns, true);
        const timestampAggregate = timestampSql && !columnsSql.toLowerCase().includes(timestampSql.toLowerCase())
          ? `MIN(${timestampSql}) AS ${timestampSql}, `
          : '';
        const dupFilters = [...(condition ? [`(${condition})`] : []), ...this.defaultDatePredicates(columns, quotedColumns, false), ...this.timestampDatePredicates(table)];
        selects.push(`SELECT '${tableLiteral}' AS source_table, ${primaryKeyProjection}${timestampAggregate}COUNT(*) AS duplicate_count FROM ${quotedTable}`
          + (dupFilters.length ? ` WHERE ${dupFilters.join(' AND ')}` : '')
          + ` GROUP BY ${columnsSql} HAVING COUNT(*) > 1`);
        return;
      }

      if (this.category === 'Logical' && columns.length >= 2) {
        const first = `[${columns[0].replace(/[\[\]]/g, '')}]`;
        const second = `[${columns[1].replace(/[\[\]]/g, '')}]`;
        const baseWhere = condition || `${first} IS NOT NULL AND ${second} IS NOT NULL AND ${first} > ${second}`;
        const dateFilters = [...this.defaultDatePredicates(columns, quotedColumns, false), ...this.timestampDatePredicates(table)];
        const where = dateFilters.length ? `(${baseWhere}) AND ${dateFilters.join(' AND ')}` : baseWhere;
        selects.push(`SELECT ${top}'${tableLiteral}' AS source_table, ${primaryKeyValue}${timestampColumnProjection}${columnsSql} FROM ${quotedTable} WHERE ${where}`);
        return;
      }

      columns.forEach(col => {
        const quotedCol = `[${col.replace(/[[\]]/g, '')}]`;
        const colLiteral = col.replaceAll("'", "''");
        let check: string;
        switch (this.category) {
          case 'Range Check':
            check = rangeCondition || this.rangeCheckPredicate(quotedCol, this.fieldTypeFor(col));
            break;
          case 'Calculation':
          case 'Formula':
          case 'Calculation / Formula':
            check = rangeCondition || this.rangeCheckPredicate(quotedCol, this.fieldTypeFor(col));
            break;
          case 'Format Validation':
            check = `(${quotedCol} IS NOT NULL AND LTRIM(RTRIM(CAST(${quotedCol} AS NVARCHAR(MAX)))) <> '' AND TRY_CAST(${quotedCol} AS DATE) IS NULL AND TRY_CAST(${quotedCol} AS FLOAT) IS NULL)`;
            break;
          default:
            check = `(${quotedCol} IS NULL OR LTRIM(RTRIM(CAST(${quotedCol} AS NVARCHAR(MAX)))) = '')`;
            break;
        }
        const baseWhere = this.category === 'Range Check' || this.category === 'Calculation' || this.category === 'Formula' || this.category === 'Calculation / Formula'
          ? check
          : condition ? `${check} AND (${condition})` : check;
        const isNullCheck = !['Range Check', 'Calculation', 'Formula', 'Calculation / Formula', 'Format Validation'].includes(this.category);
        const dateFilters = [...this.defaultDatePredicates([col], [quotedCol], isNullCheck), ...this.timestampDatePredicates(table)];
        const where = dateFilters.length ? `(${baseWhere}) AND ${dateFilters.join(' AND ')}` : baseWhere;
        selects.push(`SELECT ${top}'${tableLiteral}' AS source_table, ${primaryKeyValue}${timestampColumnProjection}'${colLiteral}' AS column_name, CAST(${quotedCol} AS NVARCHAR(4000)) AS value FROM ${quotedTable} WHERE ${where}`);
      });
    });
    return selects.join('\nUNION ALL\n');
  }

  private buildNormalizedPrimaryKeyProjection(primaryKeyColumns: string[], aggregate: boolean): string {
    if (!primaryKeyColumns.length) return "CAST(NULL AS NVARCHAR(4000)) AS primary_key, ";
    const values = primaryKeyColumns.map(column => `CAST(${column} AS NVARCHAR(4000))`).join(', ');
    const expression = `CONCAT_WS('|', ${values})`;
    return aggregate ? `MIN(${expression}) AS primary_key, ` : `${expression} AS primary_key, `;
  }

  private quoteTableForDisplay(table: string): string {
    return table.split(',').map(value => value.trim().split('.', 2)
      .map(part => `[${part.replace(/[\[\]]/g, '')}]`).join('.')).join(', ');
  }

  private rangeCheckPredicate(column: string, dataType?: string): string {
    const value = `CAST(${column} AS NVARCHAR(MAX))`;
    const normalizedType = dataType?.toLowerCase() ?? '';
    const dateTypes = ['date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset', 'time'];
    const numericTypes = ['bigint', 'int', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney', 'bit'];
    const conversion = dateTypes.includes(normalizedType)
      ? `TRY_CONVERT(DATETIME2, ${value})`
      : numericTypes.includes(normalizedType)
        ? `TRY_CONVERT(FLOAT, ${value})`
        : `TRY_CONVERT(FLOAT, ${value})`;
    return `(${conversion} IS NULL AND ${column} IS NOT NULL AND LTRIM(RTRIM(${value})) <> '')`;
  }

  /** Turns an operator-only condition like "= '1900-01-01'" into "<selected col> = '1900-01-01'". */
  private expandShorthandCondition(condition: string, selectedField?: string): string {
    if (!condition || !selectedField) return condition;
    const match = /^(<=|>=|<>|!=|=|<|>|NOT\s+LIKE\b|LIKE\b|NOT\s+IN\b|IN\b|IS\b)\s*([\s\S]+)$/i.exec(condition);
    if (!match) return condition;
    const name = selectedField.replace(/^.*\./, '').replace(/[[\]]/g, '');
    const column = /^[A-Za-z_]\w*$/.test(name) ? name : `[${name}]`;
    return `${column} ${match[1].toUpperCase().replace(/\s+/g, ' ')} ${match[2].trim()}`;
  }

  private rangeCheckCondition(condition: string, selectedField?: string): string {
    if (!condition) return '';
    const shorthand = condition.match(/^(<=|>=|<>|=|<|>)\s*([A-Za-z_][\w]*)$/);
    const fullCondition = shorthand && selectedField
      ? `${selectedField} ${shorthand[1]} ${shorthand[2]}`
      : condition;

    return fullCondition.replace(/\b[A-Za-z_][\w]*\b/g, identifier => {
      const dataType = this.fieldTypeFor(identifier) ?? this.columnTypes[identifier];
      if (!dataType) return identifier;
      const column = `[${identifier}]`;
      const normalizedType = dataType.toLowerCase();
      if (['date', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset', 'time'].includes(normalizedType))
        return `TRY_CONVERT(DATETIME2, CAST(${column} AS NVARCHAR(MAX)))`;
      if (['bigint', 'int', 'smallint', 'tinyint', 'decimal', 'numeric', 'float', 'real', 'money', 'smallmoney', 'bit'].includes(normalizedType))
        return `TRY_CONVERT(FLOAT, CAST(${column} AS NVARCHAR(MAX)))`;
      return column;
    });
  }

  private fieldTypeFor(field: string): string | undefined {
    return this.fieldGroups.find(group => group.fields.includes(field))?.fieldTypes?.[field];
  }

  /** Maps a raw field name (e.g. "well_id") to its quoted, bracketed selected column, if it's one of the selected fields. */
  private matchSelectedColumn(name: string, fields: string[], columns: string[]): string | null {
    const normalizedFields = fields.map(field => field.replace(/^.*\./, '').replace(/[\[\]]/g, ''));
    const index = normalizedFields.findIndex(field => field.toLowerCase() === name.toLowerCase());
    return index >= 0 ? columns[index] : null;
  }

  /** Extracts the column named at the start of a condition (e.g. "spud_date must be..."), if it's a selected field. */
  private extractLeadingColumn(condition: string, fields: string[], columns: string[]): string | null {
    const match = condition.match(/^\s*([A-Za-z_]\w*)/);
    return match ? this.matchSelectedColumn(match[1], fields, columns) : null;
  }

  /** Parses plain text like "No duplicate (well_id, week_number) pairs." into the matching selected columns. */
  private parseDuplicateCondition(condition: string, fields: string[], columns: string[]): string | null {
    if (!condition || !/duplicate|repeated/i.test(condition)) return null;

    const stopWords = new Set(['no', 'duplicate', 'duplicates', 'pair', 'pairs', 'combination', 'combinations',
      'key', 'keys', 'set', 'sets', 'and', 'or', 'where', 'should', 'must', 'be', 'the', 'with', 'check',
      'for', 'not', 'repeated', 'unique', 'row', 'rows', 'across']);
    const tokens = Array.from(condition.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)).map(match => match[0]);
    const mentioned = tokens.filter(token => !stopWords.has(token.toLowerCase()));

    const matchedColumns: string[] = [];
    for (const token of mentioned) {
      const column = this.matchSelectedColumn(token, fields, columns);
      if (column && !matchedColumns.includes(column)) matchedColumns.push(column);
    }
    if (!matchedColumns.length) return null;
    return matchedColumns.join(', ');
  }

  private readonly monthNameToNumber: Record<string, string> = {
    jan: '01', january: '01', feb: '02', february: '02', mar: '03', march: '03',
    apr: '04', april: '04', may: '05', jun: '06', june: '06', jul: '07', july: '07',
    aug: '08', august: '08', sep: '09', sept: '09', september: '09', oct: '10', october: '10',
    nov: '11', november: '11', dec: '12', december: '12',
  };

  /** Normalizes an ISO date or a "Jan 1 2026" / "1 Jan 2026" style date into YYYY-MM-DD, or null if unrecognized. */
  private parseFlexibleDate(text: string): string | null {
    const trimmed = text.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

    const monthDayYear = trimmed.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
    if (monthDayYear) {
      const month = this.monthNameToNumber[monthDayYear[1].toLowerCase()];
      if (!month) return null;
      return `${monthDayYear[3]}-${month}-${monthDayYear[2].padStart(2, '0')}`;
    }

    const dayMonthYear = trimmed.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/i);
    if (dayMonthYear) {
      const month = this.monthNameToNumber[dayMonthYear[2].toLowerCase()];
      if (!month) return null;
      return `${dayMonthYear[3]}-${month}-${dayMonthYear[1].padStart(2, '0')}`;
    }

    return null;
  }

  /**
   * Parses plain text like "overall_progress must be between 0 and 1", "spud_date must be
   * between 2024-01-01 and 2024-12-31", or "rig_on_date must be between jan 1 2026 and aug 31
   * 2026" into a NOT BETWEEN violation check. Works for both numeric and date fields (ISO or
   * "Month Day Year" / "Day Month Year" style dates); only strictly numeric or recognized date
   * bounds are accepted to keep the generated SQL free of injectable text.
   */
  private parseBetweenCondition(condition: string, fields: string[], columns: string[]): string | null {
    if (!condition) return null;
    const match = condition.match(/\bbetween\b\s+(.+?)\s+\band\b\s+(.+?)(?:\s*[.;]\s*)?$/i);
    if (!match) return null;

    const clean = (value: string) => value.trim().replace(/^[(['"]+/, '').replace(/[)\]'".,;:]+$/, '');
    const low = clean(match[1]);
    const high = clean(match[2]);
    if (!low || !high) return null;

    const numericPattern = /^-?\d+(\.\d+)?$/;
    const isNumeric = numericPattern.test(low) && numericPattern.test(high);

    const lowDate = this.parseFlexibleDate(low);
    const highDate = this.parseFlexibleDate(high);
    const isDate = !!lowDate && !!highDate;
    if (!isNumeric && !isDate) return null;

    const column = this.extractLeadingColumn(condition, fields, columns) ?? columns[0];
    if (!column) return null;

    if (isDate) {
      return `TRY_CONVERT(DATE, CAST(${column} AS NVARCHAR(MAX))) NOT BETWEEN '${lowDate}' AND '${highDate}'`;
    }
    return `TRY_CONVERT(FLOAT, CAST(${column} AS NVARCHAR(MAX))) NOT BETWEEN ${low} AND ${high}`;
  }

  /**
   * Parses plain text arithmetic like "overall_progress must equal planned_progress + actual_progress"
   * or "total_cost must be the sum of cost_a and cost_b" into a violation check comparing a target
   * column against a computed expression of other selected columns. Supports +, -, *, / (also
   * "plus"/"minus"/"times"/"multiplied by"/"divided by") plus sum/difference/product/quotient
   * phrasing. Every identifier in the expression must resolve to a selected column, otherwise the
   * text is rejected and the caller falls back to the default check.
   */
  private parseArithmeticCondition(condition: string, fields: string[], columns: string[]): string | null {
    if (!condition) return null;

    const sumOf = condition.match(/^\s*([A-Za-z_]\w*)\s+(?:must|should)\s+(?:be\s+)?(?:equal\s+to\s+)?(?:the\s+)?sum\s+of\s+([A-Za-z_]\w*)\s+and\s+([A-Za-z_]\w*)/i);
    if (sumOf) return this.buildArithmeticCheck(sumOf[1], `${sumOf[2]} + ${sumOf[3]}`, fields, columns);

    const differenceOf = condition.match(/^\s*([A-Za-z_]\w*)\s+(?:must|should)\s+(?:be\s+)?(?:equal\s+to\s+)?(?:the\s+)?difference\s+(?:of|between)\s+([A-Za-z_]\w*)\s+and\s+([A-Za-z_]\w*)/i);
    if (differenceOf) return this.buildArithmeticCheck(differenceOf[1], `${differenceOf[2]} - ${differenceOf[3]}`, fields, columns);

    const productOf = condition.match(/^\s*([A-Za-z_]\w*)\s+(?:must|should)\s+(?:be\s+)?(?:equal\s+to\s+)?(?:the\s+)?product\s+of\s+([A-Za-z_]\w*)\s+and\s+([A-Za-z_]\w*)/i);
    if (productOf) return this.buildArithmeticCheck(productOf[1], `${productOf[2]} * ${productOf[3]}`, fields, columns);

    const quotientOf = condition.match(/^\s*([A-Za-z_]\w*)\s+(?:must|should)\s+(?:be\s+)?(?:equal\s+to\s+)?(?:the\s+)?quotient\s+of\s+([A-Za-z_]\w*)\s+and\s+([A-Za-z_]\w*)/i);
    if (quotientOf) return this.buildArithmeticCheck(quotientOf[1], `${quotientOf[2]} / NULLIF(${quotientOf[3]}, 0)`, fields, columns);

    const equationMatch = condition.match(/^\s*([A-Za-z_]\w*)\s+(?:must|should)\s+(?:be\s+)?(?:equal\s+to\s+)?([A-Za-z0-9_+\-*/.()\s]+?)\s*\.?\s*$/i);
    if (equationMatch) {
      let expression = equationMatch[2].trim();
      expression = expression
        .replace(/\bmultiplied\s+by\b/gi, '*')
        .replace(/\bdivided\s+by\b/gi, '/')
        .replace(/\btimes\b/gi, '*')
        .replace(/\bplus\b/gi, '+')
        .replace(/\bminus\b/gi, '-');
      if (expression && /[+\-*/]/.test(expression)) {
        return this.buildArithmeticCheck(equationMatch[1], expression, fields, columns);
      }
    }

    return null;
  }

  /** Substitutes every identifier in an arithmetic expression with its selected column, rejecting unknown identifiers or characters. */
  private buildArithmeticCheck(targetName: string, expression: string, fields: string[], columns: string[]): string | null {
    const targetColumn = this.matchSelectedColumn(targetName, fields, columns);
    if (!targetColumn) return null;
    if (!/^[A-Za-z0-9_+\-*/.()\s]+$/.test(expression)) return null;

    const tokens = Array.from(expression.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)).map(m => m[0]);
    if (!tokens.length) return null;

    let resolvedExpression = expression;
    for (const token of tokens) {
      const column = this.matchSelectedColumn(token, fields, columns);
      if (!column) return null;
      resolvedExpression = resolvedExpression.replace(
        new RegExp(`\\b${token}\\b`, 'g'),
        `TRY_CONVERT(FLOAT, CAST(${column} AS NVARCHAR(MAX)))`,
      );
    }

    const targetValue = `TRY_CONVERT(FLOAT, CAST(${targetColumn} AS NVARCHAR(MAX)))`;
    return `${targetColumn} IS NOT NULL AND ${targetValue} IS NOT NULL AND ABS(${targetValue} - (${resolvedExpression})) > 0.0001`;
  }

  /**
   * Parses plain text like "spud_date must be a valid date format (YYYY-MM-DD)" or "progress_pct
   * must be a valid numeric value" into a Format Validation check. A parenthesized date token
   * (e.g. YYYY-MM-DD, MM/DD/YYYY) is translated into a strict LIKE pattern; otherwise falls back
   * to a generic "valid date" or "valid number" check depending on the wording used.
   */
  /**
   * Parses plain text like "material_avail_date must be in format 'dd-mm-yyyy'" or "progress_pct
   * must be a valid numeric value" into a Format Validation check — replacing the default
   * date-or-number check whenever the text names a specific format or data type. A date token
   * (quoted, parenthesized, or bare — e.g. 'dd-mm-yyyy', (YYYY-MM-DD), MM/DD/YYYY) is translated
   * into a strict LIKE pattern; other recognized data types (integer, decimal places, boolean,
   * email) get their own dedicated check; otherwise falls back to a generic "valid date" or
   * "valid number" check depending on the wording used.
   */
  private parseFormatValidationCondition(condition: string, fields: string[], columns: string[]): string | null {
    if (!condition) return null;

    const explicitColumn = this.extractLeadingColumn(condition, fields, columns);
    const targetColumns = explicitColumn ? [explicitColumn] : columns;
    if (!targetColumns.length) return null;

    const dateToken = this.extractDateFormatToken(condition);
    const likePattern = dateToken ? this.buildDateLikePattern(dateToken) : null;
    if (likePattern) {
      return targetColumns.map(column =>
        `(${column} IS NOT NULL AND LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX)))) <> '' AND (CAST(${column} AS NVARCHAR(MAX)) NOT LIKE '${likePattern}' OR TRY_CAST(${column} AS DATE) IS NULL))`,
      ).join(' OR ');
    }

    if (/\bemail\b/i.test(condition)) {
      return targetColumns.map(column =>
        `(${column} IS NOT NULL AND LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX)))) <> '' AND CAST(${column} AS NVARCHAR(MAX)) NOT LIKE '_%@_%._%')`,
      ).join(' OR ');
    }

    if (/\bbool(ean)?\b/i.test(condition)) {
      return targetColumns.map(column =>
        `(${column} IS NOT NULL AND LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX)))) <> '' AND LOWER(LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX))))) NOT IN ('0','1','true','false','yes','no'))`,
      ).join(' OR ');
    }

    const exactLengthMatch = condition.match(/(?:exactly|must\s+be)\s*(\d+)\s*characters?/i);
    if (exactLengthMatch) {
      const length = Number.parseInt(exactLengthMatch[1], 10);
      return targetColumns.map(column =>
        `(${column} IS NOT NULL AND LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX)))) <> '' AND LEN(LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX))))) <> ${length})`,
      ).join(' OR ');
    }

    const minLengthMatch = condition.match(/(?:at\s+least|minimum(?:\s+of)?)\s*(\d+)\s*characters?/i);
    if (minLengthMatch) {
      const length = Number.parseInt(minLengthMatch[1], 10);
      return targetColumns.map(column =>
        `(${column} IS NOT NULL AND LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX)))) <> '' AND LEN(LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX))))) < ${length})`,
      ).join(' OR ');
    }

    const maxLengthMatch = condition.match(/(?:at\s+most|maximum(?:\s+of)?|no\s+more\s+than|not\s+exceed)\s*(\d+)\s*characters?/i);
    if (maxLengthMatch) {
      const length = Number.parseInt(maxLengthMatch[1], 10);
      return targetColumns.map(column =>
        `(${column} IS NOT NULL AND LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX)))) <> '' AND LEN(LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX))))) > ${length})`,
      ).join(' OR ');
    }

    if (/\balphanumeric\b/i.test(condition)) {
      return targetColumns.map(column =>
        `(${column} IS NOT NULL AND LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX)))) <> '' AND CAST(${column} AS NVARCHAR(MAX)) LIKE '%[^A-Za-z0-9]%')`,
      ).join(' OR ');
    }

    if (/\buppercase\b/i.test(condition)) {
      return targetColumns.map(column => {
        const value = `CAST(${column} AS NVARCHAR(MAX)) COLLATE Latin1_General_CS_AS`;
        return `(${column} IS NOT NULL AND LTRIM(RTRIM(${value})) <> '' AND ${value} <> UPPER(${value}))`;
      }).join(' OR ');
    }

    if (/\blowercase\b/i.test(condition)) {
      return targetColumns.map(column => {
        const value = `CAST(${column} AS NVARCHAR(MAX)) COLLATE Latin1_General_CS_AS`;
        return `(${column} IS NOT NULL AND LTRIM(RTRIM(${value})) <> '' AND ${value} <> LOWER(${value}))`;
      }).join(' OR ');
    }

    const textPatternToken = this.extractTextPatternToken(condition);
    const textLikePattern = textPatternToken ? this.buildTextLikePattern(textPatternToken) : null;
    if (textLikePattern) {
      return targetColumns.map(column =>
        `(${column} IS NOT NULL AND LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX)))) <> '' AND CAST(${column} AS NVARCHAR(MAX)) NOT LIKE '${textLikePattern}')`,
      ).join(' OR ');
    }

    const decimalMatch = condition.match(/(\d+)\s*decimal/i);
    if (decimalMatch) {
      const places = Number.parseInt(decimalMatch[1], 10);
      return targetColumns.map(column => {
        const value = `CAST(${column} AS NVARCHAR(MAX))`;
        return `(${column} IS NOT NULL AND LTRIM(RTRIM(${value})) <> '' AND (TRY_CAST(${column} AS FLOAT) IS NULL OR CHARINDEX('.', ${value}) = 0 OR LEN(${value}) - CHARINDEX('.', ${value}) <> ${places}))`;
      }).join(' OR ');
    }

    if (/\binteger\b|\bwhole\s+number\b/i.test(condition)) {
      return targetColumns.map(column =>
        `(${column} IS NOT NULL AND LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX)))) <> '' AND TRY_CAST(${column} AS BIGINT) IS NULL)`,
      ).join(' OR ');
    }

    const wantsDate = /\bdate\b/i.test(condition);
    const wantsNumeric = /\bnumb?er(ic)?\b/i.test(condition);
    if (wantsDate && !wantsNumeric) {
      return targetColumns.map(column =>
        `(${column} IS NOT NULL AND LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX)))) <> '' AND TRY_CAST(${column} AS DATE) IS NULL)`,
      ).join(' OR ');
    }
    if (wantsNumeric && !wantsDate) {
      return targetColumns.map(column =>
        `(${column} IS NOT NULL AND LTRIM(RTRIM(CAST(${column} AS NVARCHAR(MAX)))) <> '' AND TRY_CAST(${column} AS FLOAT) IS NULL)`,
      ).join(' OR ');
    }
    return null;
  }

  /** Finds a date format token near the word "format" or wrapped in quotes/parens (e.g. 'dd-mm-yyyy', (YYYY/MM/DD)). */
  private extractDateFormatToken(condition: string): string | null {
    const nearFormatKeyword = condition.match(/\bformat\b\s*(?:is\s*)?[:\-]?\s*['"(]?([ymd]{2,4}(?:[\/\-.][ymd]{2,4}){1,2})['")]?/i);
    if (nearFormatKeyword) return nearFormatKeyword[1];
    const quotedOrParenthesized = condition.match(/['"(]([ymd]{2,4}(?:[\/\-.][ymd]{2,4}){1,2})['")]/i);
    return quotedOrParenthesized ? quotedOrParenthesized[1] : null;
  }

  /** Finds a text-format template near "format" or quoted (e.g. 'XXX-9999', "AA-999999") using X/A for letters and 9 for digits. */
  private extractTextPatternToken(condition: string): string | null {
    const nearFormatKeyword = condition.match(/\bformat\b\s*(?:is\s*)?[:\-]?\s*['"(]?([A-Za-z0-9]+(?:[\-_\/.][A-Za-z0-9]+)*)['")]?/i);
    const candidate = nearFormatKeyword?.[1] ?? condition.match(/['"]([A-Za-z0-9]+(?:[\-_\/.][A-Za-z0-9]+)*)['"]/)?.[1];
    if (!candidate) return null;
    return /9/.test(candidate) || /[Xx]/.test(candidate) ? candidate : null;
  }

  /** Converts an X/A (letter) + 9 (digit) template into a SQL LIKE pattern, keeping other characters literal. */
  private buildTextLikePattern(token: string): string | null {
    let pattern = '';
    for (const char of token) {
      if (char === '9') { pattern += '[0-9]'; continue; }
      if (char === 'X' || char === 'x' || char === 'A' || char === 'a') { pattern += '[A-Za-z]'; continue; }
      if (/[\-_\/.]/.test(char)) { pattern += char; continue; }
      return null;
    }
    return pattern || null;
  }

  /** Converts a YYYY/MM/DD-style date format token (with -, / or . separators) into a SQL LIKE digit pattern. */
  private buildDateLikePattern(token: string): string | null {
    const digitGroup: Record<string, string> = {
      YYYY: '[0-9][0-9][0-9][0-9]',
      YY: '[0-9][0-9]',
      MM: '[0-2][0-9]',
      DD: '[0-3][0-9]',
    };
    const parts = token.split(/([\/\-.])/);
    let pattern = '';
    for (const part of parts) {
      if (!part) continue;
      if (/^[\/\-.]$/.test(part)) { pattern += part; continue; }
      const digits = digitGroup[part.toUpperCase()];
      if (!digits) return null;
      pattern += digits;
    }
    return pattern || null;
  }

  /**
   * Parses plain text comparing two selected columns (e.g. "rig_off_date must be greater than
   * rig_on_date", "rig_off_date must not be before rig_on_date") into a violation check. Supports
   * greater/less than (or equal to), and before/after phrasing.
   */
  private parseLogicalCondition(condition: string, fields: string[], columns: string[]): string | null {
    if (!condition) return null;

    // operator, violation-when clause when the plain-text comparison is FALSE
    const phraseToViolationOperator: [RegExp, string][] = [
      [/must\s+not\s+be\s+before/i, '<'],
      [/must\s+not\s+be\s+after/i, '>'],
      [/must\s+be\s+(?:greater\s+than\s+or\s+equal\s+to|>=)/i, '<'],
      [/must\s+be\s+(?:less\s+than\s+or\s+equal\s+to|<=)/i, '>'],
      [/must\s+be\s+(?:greater\s+than|after|>)/i, '<='],
      [/must\s+be\s+(?:less\s+than|before|<)/i, '>='],
    ];

    for (const [phrase, violationOperator] of phraseToViolationOperator) {
      const match = condition.match(new RegExp(`([A-Za-z_]\\w*)\\s+${phrase.source}\\s+([A-Za-z_]\\w*)`, 'i'));
      if (!match) continue;
      const columnA = this.matchSelectedColumn(match[1], fields, columns);
      const columnB = this.matchSelectedColumn(match[2], fields, columns);
      if (columnA && columnB) return `${columnA} IS NOT NULL AND ${columnB} IS NOT NULL AND ${columnA} ${violationOperator} ${columnB}`;
    }

    return null;
  }

  // ─── Source Fields ────────────────────────────────────────────────────────
  sourceType: 'table' | 'view' = 'table';
  sourceTable = '';
  selectedColumns: string[] = [];

  // View mode
  availableViews: DatabaseViewListItem[] = [];
  selectedViewId: number | null = null;
  selectedViewColumn: string[] = [];
  viewSearch = '';
  columnSearch = '';
  /** Each option's label shows the source table.column it comes from; value is the view's output column name. */
  viewColumns: { value: string; label: string }[] = [];
  viewRows: Record<string, unknown>[] = [];
  viewLoading = false;

  // ─── Custom dropdown (combo) open/closed state — replaces native <datalist> popups ────────────
  sourceTableDropdownOpen = false;
  columnDropdownOpen = false;
  viewDropdownOpen = false;
  viewColumnDropdownOpen = false;

  private filterOptions(options: string[], term: string): string[] {
    const t = (term ?? '').trim().toLowerCase();
    return t ? options.filter(o => o.toLowerCase().includes(t)) : options;
  }

  get filteredSourceTableOptions(): string[] {
    const options = this.filterOptions(this.sourceTableOptions, this.sourceTableSearch);
    return this.sourceTableDropdownOpen ? options.filter(table => table !== this.sourceTable) : options;
  }

  get filteredColumnOptions(): string[] {
    const options = this.filterOptions(this.columnOptions, this.tableColumnSearch);
    return this.columnDropdownOpen ? options.filter(column => !this.selectedColumns.includes(column)) : options;
  }

  get filteredTimestampColumnOptions(): string[] {
    const options = this.filterOptions(this.columnOptions, this.timestampColumnSearch);
    return this.timestampColumnDropdownOpen ? options.filter(column => column !== this.timestampColumn) : options;
  }

  get filteredViewOptions(): DatabaseViewListItem[] {
    const t = (this.viewSearch ?? '').trim().toLowerCase();
    return t ? this.availableViews.filter(v => v.viewName.toLowerCase().includes(t)) : this.availableViews;
  }

  get filteredViewColumnOptions(): { value: string; label: string }[] {
    const t = (this.columnSearch ?? '').trim().toLowerCase();
    return t ? this.viewColumns.filter(c => c.value.toLowerCase().includes(t)) : this.viewColumns;
  }

  /** The datalist supplies whole `schema.table.column` values, so only an exact hit counts as a pick. */
  onColumnSearchChange(term: string): void {
    this.viewColumnDropdownOpen = true;
    const match = this.viewColumns.find(c => c.value === (term ?? '').trim());
    this.selectedViewColumn = match ? [match.value] : [];
  }

  openViewColumnDropdown(): void {
    if (this.viewColumns.length) this.viewColumnDropdownOpen = true;
  }

  closeViewColumnDropdown(): void {
    this.viewColumnDropdownOpen = false;
  }

  selectViewColumn(col: { value: string; label: string }): void {
    this.columnSearch = col.value;
    this.selectedViewColumn = [col.value];
    this.viewColumnDropdownOpen = false;
  }

  get selectedView(): DatabaseViewListItem | undefined {
    return this.availableViews.find(v => v.id === this.selectedViewId);
  }

  onViewSearchChange(term: string): void {
    this.viewDropdownOpen = true;
    const match = this.availableViews.find(v => v.viewName === (term ?? '').trim());
    if (match && match.id !== this.selectedViewId) this.chooseView(match);
  }

  openViewDropdown(): void {
    this.viewDropdownOpen = true;
  }

  closeViewDropdown(): void {
    this.viewDropdownOpen = false;
    this.normalizeViewSearch();
  }

  /** Discards free text that doesn't name a view so the input always reflects the actual selection. */
  normalizeViewSearch(): void {
    this.viewSearch = this.selectedView?.viewName ?? '';
  }

  chooseView(view: DatabaseViewListItem): void {
    this.viewSearch = view.viewName;
    this.viewDropdownOpen = false;
    this.selectView(view);
  }

  // Table mode — loaded from DB
  sourceTableOptions: string[] = [];
  columnOptions: string[] = [];
  columnTypes: Record<string, string> = {};
  primaryKeyColumns: string[] = [];
  private readonly primaryKeysByTable = new Map<string, string[]>();
  tableColumnSearch = '';
  sourceTableSearch = '';

  onSourceTableSearchChange(term: string): void {
    this.sourceTableDropdownOpen = true;
    const match = this.sourceTableOptions.find(t => t === (term ?? '').trim());
    if (!match || match === this.sourceTable) return;
    this.sourceTable = match;
    this.onSourceTableChange();
  }

  openSourceTableDropdown(): void {
    this.sourceTableSearch = '';
    this.sourceTableDropdownOpen = true;
  }

  closeSourceTableDropdown(): void {
    this.sourceTableDropdownOpen = false;
    this.normalizeSourceTableSearch();
  }

  selectSourceTable(table: string): void {
    this.sourceTableSearch = table;
    this.sourceTableDropdownOpen = false;
    if (table === this.sourceTable) return;
    this.sourceTable = table;
    this.onSourceTableChange();
  }

  /** Discards free text that doesn't name a table so the input always reflects the actual selection. */
  normalizeSourceTableSearch(): void {
    this.sourceTableSearch = this.sourceTable;
  }

  onTableColumnSearchChange(term: string): void {
    this.columnDropdownOpen = true;
    const match = this.columnOptions.find(c => c === (term ?? '').trim());
    this.selectedColumns = match ? [match] : [];
  }

  openColumnDropdown(): void {
    if (!this.columnOptions.length) return;
    this.tableColumnSearch = '';
    this.columnDropdownOpen = true;
  }

  closeColumnDropdown(): void {
    this.columnDropdownOpen = false;
    this.tableColumnSearch = this.selectedColumns[0] ?? '';
  }

  selectTableColumn(col: string): void {
    this.tableColumnSearch = col;
    this.selectedColumns = [col];
    this.columnDropdownOpen = false;
  }

  fieldGroups: FieldGroup[] = [];

  // ─── Validation Settings ─────────────────────────────────────────────────
  validationPeriod = '';
  maximumRecords = '';
  timestampColumn = '';
  timestampColumnSearch = '';
  timestampColumnDropdownOpen = false;
  conditionLogic = '';
  /** True once the user has typed into the query box directly — their text then overrides auto-generation. */
  queryTouched = false;

  get queryTextValue(): string {
    return this.queryTouched ? this.conditionLogic : this.generatedQueryDisplay;
  }

  queryCopied = false;

  copyGeneratedQuery(): void {
    const query = this.queryTextValue;
    if (!query) return;
    navigator.clipboard.writeText(query).then(
      () => {
        this.queryCopied = true;
        this.cdr.markForCheck();
        setTimeout(() => { this.queryCopied = false; this.cdr.markForCheck(); }, 2000);
      },
      () => this.notify.showError('Could not copy the query to the clipboard.'),
    );
  }

  onQueryTextChanged(value: string): void {
    this.queryTouched = true;
    this.conditionLogic = value;
  }

  onMaximumRecordsChanged(value: string): void {
    this.maximumRecords = value ?? '';
    this.refreshGeneratedQuery();
  }

  onCategoryChanged(value: string): void {
    this.category = value ?? '';
    this.refreshGeneratedQuery();
  }

  onAdditionalConditionChanged(value: string): void {
    this.additionalCondition = value ?? '';
    this.refreshGeneratedQuery();
  }

  onTimestampColumnSearchChange(value: string): void {
    this.timestampColumnSearch = value ?? '';
    this.timestampColumnDropdownOpen = true;
    const selected = this.columnOptions.find(column => column.toLowerCase() === this.timestampColumnSearch.trim().toLowerCase());
    this.timestampColumn = selected ?? '';
    this.refreshGeneratedQuery();
  }

  openTimestampColumnDropdown(): void {
    if (this.sourceType !== 'table' || !this.columnOptions.length) return;
    this.timestampColumnSearch = '';
    this.timestampColumnDropdownOpen = true;
  }

  closeTimestampColumnDropdown(): void {
    this.timestampColumnDropdownOpen = false;
    this.timestampColumnSearch = this.timestampColumn;
  }

  selectTimestampColumn(column: string): void {
    this.timestampColumn = column;
    this.timestampColumnSearch = column;
    this.timestampColumnDropdownOpen = false;
    this.refreshGeneratedQuery();
  }

  onDateRangeChanged(endpoint: 'start' | 'end', value: string): void {
    if (endpoint === 'start') this.customStartDate = value ?? '';
    else this.customEndDate = value ?? '';
    this.refreshGeneratedQuery();
  }

  private refreshGeneratedQuery(): void {
    this.queryTouched = false;
    this.conditionLogic = '';
  }
  additionalCondition = '';
  description = '';
  ruleIsActive = true;

  readonly validationPeriodOptions = ['Today', 'This Week', 'This Month', 'This Quarter', 'This Year', 'Custom Date'];
  readonly maximumRecordsOptions = ['100', '500', '1000', '5000', '10000'];
  customStartDate = '';
  customEndDate = '';

  constructor(
    private readonly router: Router,
    private readonly commonApi: CommonApiService,
    private readonly dataQualityService: DataQualityService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.notify = new NotificationHelper(cdr);
  }

  readonly notify: NotificationHelper;

  ngOnInit(): void {
    this.loadSourceTables();
    this.loadDatabaseViews();
    if (this.editRuleId) this.loadRuleForEdit(this.editRuleId);
  }

  private loadSourceTables(): void {
    this.commonApi.getBISources().subscribe({
      next: (sources) => {
        // Only tables — views are handled by the dedicated "View" source type tab
        this.sourceTableOptions = sources
          .filter(s => s.sourceType?.toLowerCase() === 'table')
          .map(s => `${s.schemaName}.${s.name}`)
          .filter(Boolean);
        this.cdr.markForCheck();
      },
      error: () => {
        this.sourceTableOptions = [];
        this.notify.showError('Unable to load AlTasnimBI tables. Please try again.');
        this.cdr.markForCheck();
      },
    });
  }

  onSourceTableChange(): void {
    this.tableColumnSearch = '';
    this.selectedColumns = [];
    this.timestampColumn = '';
    this.timestampColumnSearch = '';
    this.timestampColumnDropdownOpen = false;
    if (!this.sourceTable) { this.columnOptions = []; this.columnTypes = {}; this.primaryKeyColumns = []; return; }
    // Pass just the table name — the backend resolves schema via sys.tables lookup
    // The full schema.table is preserved in sourceTable for query generation
    const parts = this.sourceTable.split('.');
    const tableName = parts.length > 1 ? parts[parts.length - 1] : this.sourceTable;
    this.commonApi.getTableData(tableName, 'Table').subscribe({
      next: (data) => {
        this.columnOptions = data.columns ?? [];
        this.columnTypes = data.columnTypes ?? {};
        this.primaryKeyColumns = data.primaryKeys ?? [];
        this.selectedColumns = [];
        this.cdr.markForCheck();
      },
      error: () => { this.columnOptions = []; this.columnTypes = {}; this.primaryKeyColumns = []; },
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['editRuleId'] && !changes['editRuleId'].firstChange && this.editRuleId) {
      this.loadRuleForEdit(this.editRuleId);
    }
  }

  private loadRuleForEdit(ruleId: string): void {
    // Views must be resolved first — the rule's view is matched against availableViews below
    forkJoin([this.dataQualityService.listRules(), this.viewsReady()]).subscribe({
      next: ([res]) => {
        const rule = res.data?.rules?.find(r => r.ruleId === ruleId);
        if (!rule) return;
        this.ruleName = rule.ruleName;
        this.category = rule.category;
        this.severity = rule.severity;
        // Preserve existing date range — period name not stored, so leave empty to keep saved dates on update
        this.validationPeriod = '';
        this.customStartDate = this.toDateTimeLocal(rule.startDate ?? '');
        this.customEndDate = this.toDateTimeLocal(rule.endDate ?? '');
        this.maximumRecords = rule.maxRecords != null ? String(rule.maxRecords) : '';
        this.conditionLogic = rule.query ?? '';
        this.queryTouched = !!this.conditionLogic.trim();
        const timestampSelection = this.extractTimestampSelection(this.conditionLogic);
        this.timestampColumn = timestampSelection.column;
        if (timestampSelection.startDate) this.customStartDate = this.toDateTimeLocal(timestampSelection.startDate);
        if (timestampSelection.endDate) this.customEndDate = this.toDateTimeLocal(timestampSelection.endDate);
        this.description = rule.ruleDesc ?? '';
        this.ruleIsActive = rule.activeYn === 'Y';

        // Build field groups — one group per table, with its fields
        const tables = (rule.table ?? '').split(',').map(t => t.trim()).filter(Boolean);
        const fields = (rule.fields ?? '').split(',').map(f => f.trim()).filter(Boolean);
        const primaryKeys = (rule.primaryField ?? '').split(',').map(field => field.trim()).filter(Boolean);
        const matchedView = rule.sourceType !== 'table'
          ? this.availableViews.find(v => v.id === rule.viewId) ?? this.availableViews.find(v => v.viewName === tables[0])
          : undefined;

        if (matchedView) {
          this.sourceType = 'view';
          this.selectedViewId = matchedView.id;
          this.viewSearch = matchedView.viewName;
          this.loadViewColumns(matchedView.id);
          // Single-table view rules store bare column names — requalify them as schema.table.column
          // so the query regenerates when more columns are added.
          const qualified = fields.every(f => f.split('.').length >= 3)
            ? fields
            : tables.flatMap(t => fields.map(f => `${t}.${f}`));
          this.fieldGroups = [{ sourceTable: matchedView.viewName, addedColumns: qualified.length, fields: qualified }];
        } else if (tables.length === 1) {
          this.fieldGroups = [{ sourceTable: tables[0], addedColumns: fields.length, fields, primaryKeys }];
        } else {
          this.fieldGroups = tables.map(t => ({ sourceTable: t, addedColumns: fields.length, fields: [...fields], primaryKeys: [...primaryKeys] }));
        }

        if (tables.length) this.sourceTable = tables[0];
        this.sourceTableSearch = this.sourceTable;
        if (this.sourceType === 'table' && this.sourceTable) {
          this.onSourceTableChange();
          this.timestampColumn = timestampSelection.column;
          this.timestampColumnSearch = timestampSelection.column;
        }

        this.cdr.markForCheck();
      },
    });
  }

  private extractTimestampSelection(query: string): { column: string; startDate?: string; endDate?: string } {
    const dateValue = `(\\d{4}-\\d{2}-\\d{2}(?:[ T]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?)?)`;
    const equalities = [...query.matchAll(new RegExp(`\\[([^\\]]+)\\]\\s*=\\s*'${dateValue}'`, 'gi'))];
    const ranges = [...query.matchAll(new RegExp(`\\[([^\\]]+)\\]\\s*>=\\s*'${dateValue}'\\s+AND\\s+\\[\\1\\]\\s*(?:<=\\s*'${dateValue}'|<\\s*DATEADD\\(DAY,\\s*1,\\s*'${dateValue}'\\))`, 'gi'))];
    const equality = equalities.at(-1);
    const range = ranges.at(-1);
    if (range && (!equality || (range.index ?? 0) > (equality.index ?? 0))) {
      return { column: range[1].replace(/]]/g, ']'), startDate: range[2], endDate: range[3] ?? range[4] };
    }
    return equality
      ? { column: equality[1].replace(/]]/g, ']'), startDate: equality[2] }
      : { column: '' };
  }

  private toDateTimeLocal(value: string): string {
    if (!value) return '';
    const normalized = value.replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return `${normalized}T00:00`;
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?(?:\.(\d{1,7}))?$/.exec(normalized);
    if (!match) return '';
    return `${match[1]}T${match[2]}:${match[3] ?? '00'}${match[4] ? `.${match[4].padEnd(7, '0')}` : ''}`;
  }

  switchSourceType(type: 'table' | 'view'): void {
    if (this.sourceType === type) return;
    this.sourceType = type;
    this.timestampColumn = '';
    this.timestampColumnSearch = '';
    this.timestampColumnDropdownOpen = false;
    this.sourceTable = '';
    this.sourceTableSearch = '';
    this.selectedColumns = [];
    this.tableColumnSearch = '';
    this.selectedViewId = null;
    this.viewSearch = '';
    this.columnSearch = '';
    this.viewColumns = [];
    this.viewRows = [];
    this.sourceTableDropdownOpen = false;
    this.columnDropdownOpen = false;
    this.viewDropdownOpen = false;
    this.viewColumnDropdownOpen = false;
    this.refreshGeneratedQuery();
    if (type === 'view' && !this.availableViews.length) {
      this.loadDatabaseViews();
    }
  }

  private loadDatabaseViews(): void {
    this.viewsReady().subscribe(() => this.cdr.detectChanges());
  }

  private viewsReady(): Observable<DatabaseViewListItem[]> {
    if (this.availableViews.length) return of(this.availableViews);
    if (this.preloadedViews.length) {
      this.availableViews = this.preloadedViews;
      return of(this.availableViews);
    }
    // Uses shareReplay cache — instant if parent already loaded
    return this.commonApi.getDatabaseViews('view').pipe(tap(views => this.availableViews = views ?? []));
  }

  selectView(view: DatabaseViewListItem): void {
    this.selectedViewId = view.id;
    this.primaryKeysByTable.clear();
    this.fieldGroups = [];
    this.selectedViewColumn = [];
    this.columnSearch = '';
    this.refreshGeneratedQuery();
    this.loadViewColumns(view.id);
  }

  private loadViewColumns(viewId: number): void {
    this.viewLoading = true;
    // Fetch full detail since list DTO may omit generatedSql
    this.commonApi.getDatabaseViewById(viewId).subscribe({
      next: (detail) => {
        this.viewColumns = this.buildViewColumnOptions(detail);
        this.loadViewPrimaryKeys(this.viewColumns.map(column => column.value));
        if (!this.viewColumns.length) this.loadViewColumnsFromSchema(detail.manualSql || detail.generatedSql);
        this.commonApi.previewView({
          connectionId: detail.connectionId,
          sql: detail.generatedSql,
          viewId: detail.id,
          maxRows: 1000,
        }).subscribe({
          next: (res) => {
            this.viewLoading = false;
            this.viewRows = res.rows ?? [];
            // No table/column metadata could be recovered — fall back to output columns as-is
            if (!this.viewColumns.length) this.viewColumns = (res.columns ?? []).map(c => ({ value: c, label: c }));
            this.cdr.markForCheck();
          },
          error: () => {
            this.viewLoading = false;
            this.cdr.markForCheck();
          },
        });
      },
      error: () => {
        this.viewLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  /** Parses the view's table/column metadata to label each column as `schema.tableName.columnName`. */
  private buildViewColumnOptions(detail: DatabaseViewDetail): { value: string; label: string }[] {
    try {
      const tables = JSON.parse(detail.tablesJson || '[]') as { id?: string; name?: string; table?: string; alias?: string }[];
      const columnKeys = JSON.parse(detail.selectedColumnsJson || '[]') as (string | { table?: string; tableId?: string; alias?: string; name?: string; column?: string })[];
      if (!columnKeys.length) return [];
      const tableByKey = new Map<string, string>();
      tables.forEach(t => {
        const tableName = t.name ?? t.table;
        if (!tableName) return;
        [t.id, t.alias, t.name, t.table].filter(Boolean).forEach(key => tableByKey.set(String(key), tableName));
      });
      return columnKeys.flatMap(key => {
        const ref = typeof key === 'string' ? this.parseColumnKey(key) : {
          tableRef: key.table ?? key.tableId ?? key.alias,
          column: key.name ?? key.column,
        };
        if (!ref.tableRef || !ref.column) return [];
        const tableName = this.ensureSchemaQualified(tableByKey.get(ref.tableRef) ?? ref.tableRef);
        const qualified = `${tableName}.${ref.column}`;
        return [{ value: qualified, label: qualified }];
      });
    } catch {
      return [];
    }
  }

  private parseColumnKey(key: string): { tableRef: string; column: string } {
    const parts = key.split('.').map(part => part.trim()).filter(Boolean);
    if (parts.length <= 1) return { tableRef: '', column: parts[0] ?? '' };
    return { tableRef: parts[0], column: parts.slice(1).join('.') };
  }

  /** Prefixes a bare table name with the default `dbo` schema when none is already present. */
  private ensureSchemaQualified(name: string): string {
    return name.includes('.') ? name : `dbo.${name}`;
  }

  /**
   * Views saved without column metadata expose no field list, so the base tables are parsed out of
   * the raw SQL and each one's real column list is fetched from the database — guessing column
   * names from the SQL text produced phantom fields (e.g. window-function names).
   */
  private loadViewColumnsFromSchema(sql: string): void {
    const tables = this.extractViewTables(sql);
    if (!tables.length) return;

    forkJoin(tables.map(table =>
      this.commonApi.getTableData(table.split('.').pop()!, 'Table').pipe(
        map(data => {
          this.primaryKeysByTable.set(table, data.primaryKeys ?? []);
          return (data.columns ?? []).map(col => ({ value: `${table}.${col}`, label: `${table}.${col}` }));
        }),
        catchError(() => of([] as { value: string; label: string }[])),
      ),
    )).subscribe(groups => {
      const options = groups.flat();
      if (options.length) this.viewColumns = options;
      this.cdr.markForCheck();
    });
  }

  private loadViewPrimaryKeys(qualifiedFields: string[]): void {
    const tables = [...new Set(qualifiedFields.flatMap(field => {
      const parts = field.split('.');
      return parts.length >= 3 ? [`${parts[0]}.${parts[1]}`] : [];
    }))];
    tables.forEach(table => {
      this.commonApi.getTableData(table.split('.').pop()!, 'Table').subscribe({
        next: data => {
          this.primaryKeysByTable.set(table, data.primaryKeys ?? []);
          this.cdr.markForCheck();
        },
      });
    });
  }

  /** Fully qualified `schema.table` names referenced by a manual/raw SQL view, excluding CTEs and functions. */
  private extractViewTables(sql: string): string[] {
    if (!sql?.trim()) return [];
    const text = this.stripCommentsAndParams(sql);
    return [...this.findRealTables(text, this.extractCteNames(text))];
  }

  private stripCommentsAndParams(sql: string): string {
    let text = sql.replace(/--.*$/gm, '');
    text = text.replace(/^\s*DECLARE\b[^;]*;/gim, '');
    text = text.replace(/@\w+/g, ' ');
    return text.replace(/'(?:[^']|'')*'/g, "''");
  }

  private extractCteNames(text: string): Set<string> {
    const cteNames = new Set<string>();
    const cteDeclRe = /(?:\bWITH\b|,)\s*\[?(\w+)\]?\s+AS\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = cteDeclRe.exec(text))) cteNames.add(m[1].toLowerCase());
    return cteNames;
  }

  /** Returns each real table found as a fully qualified `schema.table` string (defaulting schema to `dbo`). */
  private findRealTables(block: string, cteNames: Set<string>): Set<string> {
    const tableFromJoinRe = /\b(?:FROM|JOIN)\s+(\[?\w+\]?(?:\s*\.\s*\[?\w+\]?){0,2})/gi;
    const tables = new Set<string>();
    let tm: RegExpExecArray | null;
    while ((tm = tableFromJoinRe.exec(block))) {
      const segments = tm[1].split('.').map(s => s.trim().replace(/[[\]]/g, ''));
      const tableName = segments.at(-1)!;
      const schemaName = segments.length >= 2 ? segments.at(-2)! : 'dbo';
      const followedByParen = block.slice(tm.index + tm[0].length).trimStart().startsWith('(');
      if (followedByParen || cteNames.has(tableName.toLowerCase())) continue;
      tables.add(`${schemaName}.${tableName}`);
    }
    return tables;
  }

  addSelectedViewField(): void {
    if (!this.selectedView || !this.selectedViewColumn.length) return;
    const viewName = this.selectedView.viewName;
    const newFields = this.selectedViewColumn;
    const existing = this.fieldGroups.find(g => g.sourceTable === viewName);
    if (existing) {
      const merged = [...existing.fields];
      newFields.forEach(f => { if (!merged.includes(f)) merged.push(f); });
      existing.fields = merged;
      existing.addedColumns = merged.length;
      existing.fieldTypes = { ...existing.fieldTypes, ...Object.fromEntries(newFields.map(field => [field, this.columnTypes[field]])) };
    } else {
      this.fieldGroups = [...this.fieldGroups, {
        sourceTable: viewName,
        addedColumns: newFields.length,
        fields: [...newFields],
      }];
    }
    this.fieldGroups = [...this.fieldGroups];
    this.selectedViewColumn = [];
    this.columnSearch = '';
    this.refreshGeneratedQuery();
  }

  // ─── AG Grid ─────────────────────────────────────────────────────────────
  readonly gridTheme = themeQuartz.withParams({
    accentColor: '#21409A',
    backgroundColor: '#ffffff',
    borderColor: '#E6EBF2',
    borderRadius: 0,
    fontFamily: 'Inter, sans-serif',
    headerBackgroundColor: '#FFF8EE',
    headerTextColor: '#667085',
    headerFontWeight: 600,
    rowHoverColor: '#FFFBF5',
    wrapperBorder: false,
    wrapperBorderRadius: 0,
  });

  readonly columnDefs: ColDef<FieldGroup>[] = [
    { headerName: 'Source tables', field: 'sourceTable',    minWidth: 160, flex: 1 },
    { headerName: 'Added columns', field: 'addedColumns',   minWidth: 140, flex: 1 },
    { headerName: 'Fields',        field: 'fields',         minWidth: 300, flex: 3,
      cellDataType: false, cellRenderer: AvrFieldTagsRendererComponent, autoHeight: true },
    { headerName: 'Actions',       field: 'addedColumns',   minWidth: 130, flex: 1,
      headerClass: 'avr-col-right',
      cellRenderer: AvrActionsRendererComponent },
  ];

  readonly defaultColDef: ColDef<FieldGroup> = {
    sortable: false,
    resizable: false,
  };

  readonly gridContext = {
    onDelete: (idx: number) => this.removeFieldGroup(idx),
    onEdit: (_idx: number) => { /* future implementation */ },
    onRemoveField: (idx: number, field: string) => this.removeField(idx, field),
  };

  addSelectedField(): void {
    if (!this.sourceTable || !this.selectedColumns.length) return;
    const newFields = this.selectedColumns;
    const existing = this.fieldGroups.find(g => g.sourceTable === this.sourceTable);
    if (existing) {
      const merged = [...existing.fields];
      newFields.forEach(f => { if (!merged.includes(f)) merged.push(f); });
      existing.fields = merged;
      existing.addedColumns = merged.length;
    } else {
      this.fieldGroups = [...this.fieldGroups, {
        sourceTable: this.sourceTable,
        addedColumns: newFields.length,
        fields: [...newFields],
        fieldTypes: Object.fromEntries(newFields.map(field => [field, this.columnTypes[field]])),
        primaryKeys: [...this.primaryKeyColumns],
      }];
    }
    this.fieldGroups = [...this.fieldGroups];
    this.selectedColumns = [];
    this.tableColumnSearch = '';
    this.refreshGeneratedQuery();
  }

  removeFieldGroup(index: number): void {
    this.fieldGroups = this.fieldGroups.filter((_, i) => i !== index);
    this.refreshGeneratedQuery();
  }

  /** Removes a single field tag from a group; removes the whole group once its last field is gone. */
  removeField(groupIndex: number, field: string): void {
    const group = this.fieldGroups[groupIndex];
    if (!group) return;
    const fields = group.fields.filter(f => f !== field);
    if (!fields.length) {
      this.removeFieldGroup(groupIndex);
      return;
    }
    const fieldTypes = group.fieldTypes ? { ...group.fieldTypes } : undefined;
    if (fieldTypes) delete fieldTypes[field];
    this.fieldGroups = this.fieldGroups.map((g, i) => i === groupIndex ? { ...g, fields, addedColumns: fields.length, fieldTypes } : g);
    this.refreshGeneratedQuery();
  }

  discard(): void {
    if (this.isModal) {
      this.ruleSaved.emit();
    } else {
      this.router.navigate(['/data-quality/error-log-rules']);
    }
  }

  saving = false;

  saveRule(): void {
    const missing: string[] = [];
    if (!this.ruleName) missing.push('Rule Name');
    if (!this.category) missing.push('Category');
    if (!this.severity) missing.push('Severity');
    if (!this.description.trim()) missing.push('Rule Description');
    if (this.fieldGroups.length === 0) missing.push('Source Fields');
    const hasDateRange = !!(this.customStartDate || this.customEndDate);
    if (hasDateRange) {
      if (!this.timestampColumn) missing.push('Timestamp Column');
      if (this.customStartDate && this.customEndDate && this.customStartDate > this.customEndDate) {
        this.notify.showError('Start Date must be before End Date.');
        this.cdr.detectChanges();
        return;
      }
    }
    if (missing.length) {
      this.notify.showError(`Please fill in: ${missing.join(', ')}.`);
      this.cdr.detectChanges();
      return;
    }
    this.saving = true;
    this.notify.clearError();

    const viewName = this.fieldGroups.length ? this.fieldGroups.map(g => g.sourceTable).join(', ') : this.sourceTable || '';
    const allFields = this.fieldGroups.flatMap(g => g.fields);
    // View fields parsed from raw SQL as `tableName.columnName` resolve to the real underlying
    // table — its raw columns aren't in the view's own output, so the query runs against it directly.
    const resolved = this.sourceType === 'view' ? this.parseTableQualifiedFields(allFields) : null;
    const table = resolved?.table ?? viewName;
    const fields = resolved?.fields ?? allFields;
    const viewFieldsByTable = this.sourceType === 'view' ? this.groupFieldsByTable(allFields) : null;
    const primaryFields = this.sourceType === 'table'
      ? this.fieldGroups.flatMap(group => group.primaryKeys ?? [])
      : resolved
        ? resolved.primaryKeys
        : viewFieldsByTable
          ? [...viewFieldsByTable.keys()].flatMap(sourceTable =>
              (this.primaryKeysByTable.get(sourceTable) ?? []).map(primaryKey => `${sourceTable}.${primaryKey}`))
          : [];
    const primaryField = [...new Set(primaryFields)].join(', ');

    // A user-edited query always wins over the auto-generated one
    if (this.queryTouched) {
      this.submitRule(table, fields, primaryField, this.conditionLogic.trim());
      return;
    }

    // Fields from multiple underlying view tables are checked independently in one UNION ALL query.
    if (this.sourceType === 'view') {
      const byTable = this.groupFieldsByTable(allFields);
      if (byTable && byTable.size > 1) {
        const multiTableQuery = this.buildMultiTableQuery(byTable);
        this.submitRule([...byTable.keys()].join(', '), allFields, primaryField, multiTableQuery);
        return;
      }
    }

    // Fields resolved to a real table (view parsed from raw SQL) — generate like a table-source rule
    if (this.sourceType === 'view' && resolved) {
      this.submitRule(table, fields, primaryField, this.generatedQueryDisplay);
      return;
    }

    // Otherwise, when source is a view, fetch full detail for generatedSql then save
    if (this.sourceType === 'view' && this.selectedViewId) {
      this.commonApi.getDatabaseViewById(this.selectedViewId).subscribe({
        next: (detail) => {
          const viewQuery = detail.generatedSql
            ? this.buildViewQuery(detail.generatedSql, detail.viewName, allFields,
                this.maximumRecords ? Number.parseInt(this.maximumRecords, 10) : undefined, this.category,
                this.additionalCondition.trim())
            : '';
          this.submitRule(table, allFields, primaryField, viewQuery);
        },
        error: () => this.submitRule(table, allFields, primaryField, ''),
      });
    } else {
      this.submitRule(table, allFields, primaryField, this.generatedQueryDisplay);
    }
  }

  private submitRule(table: string, allFields: string[], primaryField: string, generatedQuery: string): void {
    const request = {
      category: this.category,
      ruleName: this.ruleName,
      table,
      severity: this.severity,
      query: generatedQuery,
      validationPeriod: this.customStartDate || this.customEndDate ? 'Custom Date' : this.validationPeriod || undefined,
      customStartDate: this.customStartDate || undefined,
      customEndDate: this.customEndDate || undefined,
      maxRecords: this.maximumRecords ? Number.parseInt(this.maximumRecords, 10) : undefined,
      primaryField,
      fields: allFields.join(', '),
      ruleDesc: this.description || undefined,
      additionalCondition: this.additionalCondition.trim() || undefined,
      sourceType: this.sourceType,
      viewId: this.sourceType === 'view' ? this.selectedViewId ?? undefined : undefined,
    };

    const onSuccess = () => {
      this.saving = false;
      if (this.isModal) {
        this.ruleSaved.emit();
      } else {
        this.notify.showSuccess(this.isEditMode ? 'Validation rule updated successfully.' : 'Validation rule added successfully.');
        setTimeout(() => this.router.navigate(['/data-quality/error-log-rules']), 1500);
      }
    };
    const onError = (err: any) => {
      this.saving = false;
      const msg = err?.error?.message || 'Failed to save validation rule. Please try again.';
      this.notify.showError(msg);
      this.cdr.detectChanges();
    };

    if (this.isEditMode) {
      this.dataQualityService.updateRule(this.editRuleId!, request).subscribe({ next: onSuccess, error: onError });
    } else {
      this.dataQualityService.createRule(request).subscribe({ next: onSuccess, error: onError });
    }
  }

  private buildViewQuery(viewSql: string, viewName: string, fields: string[], maxRows: number | undefined, category: string, additionalCondition = ''): string {
    const alias = viewName.replace(/\W/g, '_');
    const cols = fields.length ? fields.map(f => `[${f}]`).join(', ') : '*';
    const top = maxRows ? `TOP ${maxRows} ` : '';
    const extra = additionalCondition ? ` AND (${additionalCondition})` : '';

    // Strip DECLARE statements and hoist them before the CTE
    const declares: string[] = [];
    let cleanSql = viewSql.trim();
    const declRe = /^\s*DECLARE\s+@\w+\s+[\w(),.]+?(?:\s*=[^;]+)?;\s*/i;
    while (declRe.test(cleanSql)) {
      const m = declRe.exec(cleanSql)!;
      declares.push(m[0].trim());
      cleanSql = cleanSql.slice(m[0].length);
    }

    // Strip leading WITH from the view SQL to avoid nested WITH...WITH
    const withRe = /^WITH\s+/i;
    let innerCtePart = '';
    if (withRe.test(cleanSql)) {
      // View has its own CTEs — chain them before our alias CTE
      cleanSql = cleanSql.replace(withRe, '');
      // Find the final SELECT (after the last CTE closing paren)
      const lastSelectIdx = cleanSql.search(/\bSELECT\b(?![^(]*\))/i);
      if (lastSelectIdx > 0) {
        innerCtePart = cleanSql.substring(0, lastSelectIdx).trim();
        if (innerCtePart.endsWith(',')) innerCtePart = innerCtePart.slice(0, -1).trim();
        cleanSql = cleanSql.substring(lastSelectIdx);
      }
    }

    const prefix = declares.length ? declares.join('\n') + '\n' : '';
    const cte = innerCtePart
      ? `${prefix}WITH ${innerCtePart}, [${alias}] AS (${cleanSql})`
      : `${prefix}WITH [${alias}] AS (${cleanSql})`;

    if (!fields.length) return `${cte} SELECT ${top}* FROM [${alias}]`;

    switch (category) {
      case 'Completeness':
        return `${cte} SELECT ${top}${cols} FROM [${alias}] WHERE ${fields.map(f => `([${f}] IS NULL OR LTRIM(RTRIM(CAST([${f}] AS NVARCHAR(MAX)))) = '')`).join(' OR ')}${extra}`;
      case 'Reference':
      case 'Data Integrity':
        return `${cte} SELECT ${cols}, COUNT(*) AS dup_count FROM [${alias}]${additionalCondition ? ` WHERE (${additionalCondition})` : ''} GROUP BY ${cols} HAVING COUNT(*) > 1`;
      case 'Range Check':
        return `${cte} SELECT ${top}${cols} FROM [${alias}] WHERE ${fields.map(f => this.rangeCheckPredicate(`[${f}]`)).join(' OR ')}${extra}`;
      case 'Logical':
        if (additionalCondition) return `${cte} SELECT ${top}${cols} FROM [${alias}] WHERE ${additionalCondition}`;
        if (fields.length >= 2) return `${cte} SELECT ${top}${cols} FROM [${alias}] WHERE [${fields[0]}] IS NOT NULL AND [${fields[1]}] IS NOT NULL AND [${fields[0]}] > [${fields[1]}]`;
        break;
      case 'Calculation':
      case 'Formula':
      case 'Calculation / Formula':
        return `${cte} SELECT ${top}${cols} FROM [${alias}] WHERE ${fields.map(f => `(TRY_CAST([${f}] AS FLOAT) NOT BETWEEN 0 AND 1 AND [${f}] IS NOT NULL)`).join(' OR ')}${extra}`;
      case 'Format Validation':
        return `${cte} SELECT ${top}${cols} FROM [${alias}] WHERE ${fields.map(f => `([${f}] IS NOT NULL AND LTRIM(RTRIM(CAST([${f}] AS NVARCHAR(MAX)))) <> '' AND TRY_CAST([${f}] AS DATE) IS NULL AND TRY_CAST([${f}] AS FLOAT) IS NULL)`).join(' OR ')}${extra}`;
    }
    return `${cte} SELECT ${top}${cols} FROM [${alias}] WHERE ${fields.map(f => `([${f}] IS NULL OR LTRIM(RTRIM(CAST([${f}] AS NVARCHAR(MAX)))) = '')`).join(' OR ')}${extra}`;
  }
}
