import { switchMap } from 'rxjs';
import type { Observable } from 'rxjs';
import type { CommonApiService, DatabaseViewDetail } from '../../../core/services/common-api.service';
import { replaceViewDateRangeParameters } from '../../../core/utils/view-date-parameters.util';

export function formatReportPeriod(fromDate: string, toDate: string): string {
  const formatDate = (value: string): string => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    const normalized = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (normalized !== value) return '';
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const from = formatDate(fromDate);
  const to = formatDate(toDate);
  if ((fromDate && !from) || (toDate && !to) || (from && to && fromDate > toDate)) return '';
  if (!from && !to) return '';
  const period = from && to
    ? (fromDate === toDate ? from : `${from} - ${to}`)
    : (from ? `From ${from}` : `Through ${to}`);
  return `Reporting period \u00b7 ${period}`;
}

export function filterReportMonthColumns(
  fields: readonly string[],
  columns: readonly { field: string; header?: string; group?: string }[],
  fromDate: string,
  toDate: string,
): string[] {
  if (!formatReportPeriod(fromDate, toDate)) return [...fields];
  const monthIndex = (date: string): number => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const fromMonth = fromDate ? monthIndex(fromDate) : -Infinity;
  const toMonth = toDate ? monthIndex(toDate) : Infinity;
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const columnConfig = new Map(columns.map(column => [column.field, column]));
  const monthPattern = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{4}|\d{2})$/i;
  return fields.filter(field => {
    const column = columnConfig.get(field);
    const match = monthPattern.exec(field.trim()) || monthPattern.exec(column?.header?.trim() ?? '');
    if (!match) return true;
    const year = Number(match[2]) + (match[2].length === 2 ? 2000 : 0);
    const month = year * 12 + months.indexOf(match[1].toLowerCase());
    return month >= fromMonth && month <= toMonth;
  });
}

export function applyReportViewParameters(
  sql: string,
  hierarchy: Readonly<Record<string, string>>,
  fromDate: string,
  toDate: string,
): string {
  sql = replaceViewDateRangeParameters(sql, fromDate, toDate);
  for (const name of ['country', 'sector', 'businessUnit', 'division', 'cluster', 'plant']) {
    const value = hierarchy[name];
    // All must clear a stored view's default, rather than retaining its original scope.
    const literal = !value || value === 'All' ? 'NULL' : `N'${value.replace(/'/g, "''")}'`;
    const names = name === 'businessUnit' ? ['businessUnit', 'business_unit'] : [name];
    for (const parameter of names) {
      const declaration = new RegExp(
        `(DECLARE\\s+@${parameter}\\s+\\w+(?:\\s*\\([^)]*\\))?)\\s*(?:=[^;]+)?;`, 'gi',
      );
      const assignment = new RegExp(`(SET\\s+@${parameter}\\s*=\\s*)[^;]+;`, 'gi');
      sql = sql.replace(declaration, (_, prefix: string) => `${prefix} = ${literal};`);
      sql = sql.replace(assignment, (_, prefix: string) => `${prefix}${literal};`);
    }
  }
  return sql;
}

export function previewReportView(
  api: {
    getDatabaseViewById: (id: number) => Observable<Pick<DatabaseViewDetail, 'id' | 'connectionId' | 'viewName' | 'manualSql' | 'generatedSql'>>;
    previewView: CommonApiService['previewView'];
  },
  viewId: number,
  hierarchy: Readonly<Record<string, string>>,
  fromDate: string,
  toDate: string,
) {
  return api.getDatabaseViewById(viewId).pipe(
    switchMap(view => {
      const sql = view.manualSql?.trim() ? view.manualSql : view.generatedSql;
      if (!sql?.trim()) throw new Error(`Report source view "${view.viewName}" has no SQL definition.`);
      return api.previewView({
        connectionId: view.connectionId,
        viewId: view.id,
        sql: applyReportViewParameters(sql, hierarchy, fromDate, toDate),
        maxRows: 0,
      });
    }),
  );
}
