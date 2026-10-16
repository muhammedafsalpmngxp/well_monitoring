export interface ViewDateRangeDefaults {
  hasStartDate: boolean;
  hasEndDate: boolean;
  hasFutureDate: boolean;
  fromDate?: string;
  toDate?: string;
}

function dateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function variableExpression(sql: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`DECLARE\\s+@${escapedName}\\s+\\w+(?:\\s*\\([^)]*\\))?\\s*(?:=\\s*([^;]+))?;`, 'i').exec(sql);
  const assignment = new RegExp(`SET\\s+@${escapedName}\\s*=\\s*([^;]+);`, 'i').exec(sql);
  return assignment?.[1]?.trim() ?? match?.[1]?.trim();
}

function addMonths(value: string, months: number): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const targetMonth = new Date(year, month + months, 1);
  const lastDay = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
  targetMonth.setDate(Math.min(day, lastDay));
  return dateString(targetMonth);
}

function resolveDateExpression(expression: string | undefined, startDate: string | undefined, today: string): string | undefined {
  if (!expression) return undefined;
  const literal = /^'(\d{4}-\d{2}-\d{2})'$/.exec(expression);
  if (literal) return literal[1];
  if (/^(?:CAST\s*\(\s*)?GETDATE\s*\(\s*\)(?:\s+AS\s+DATE\s*\))?$/i.test(expression)) return today;

  const dateFromParts = /^DATEFROMPARTS\s*\(\s*YEAR\s*\(\s*GETDATE\s*\(\s*\)\s*\)\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)$/i.exec(expression);
  if (dateFromParts) {
    const year = Number(today.slice(0, 4));
    const month = Number(dateFromParts[1]);
    const day = Number(dateFromParts[2]);
    const candidate = new Date(year, month - 1, day);
    if (candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return undefined;
  }

  const mostRecentTuesday = /^DATEADD\s*\(\s*DAY\s*,\s*-\s*\(\s*DATEDIFF\s*\(\s*DAY\s*,\s*'19000102'\s*,\s*CAST\s*\(\s*GETDATE\s*\(\s*\)\s*AS\s+DATE\s*\)\s*\)\s*%\s*7\s*\)\s*,\s*CAST\s*\(\s*GETDATE\s*\(\s*\)\s*AS\s+DATE\s*\)\s*\)$/i.exec(expression);
  if (mostRecentTuesday) {
    const date = new Date(`${today}T00:00:00`);
    date.setDate(date.getDate() - ((date.getDay() + 5) % 7));
    return dateString(date);
  }

  const dateAdd = /^DATEADD\s*\(\s*MONTH\s*,\s*(-?\d+)\s*,\s*(@start_date|(?:CAST\s*\(\s*GETDATE\s*\(\s*\)\s+AS\s+DATE\s*\))|GETDATE\s*\(\s*\))\s*\)$/i.exec(expression);
  if (!dateAdd) return undefined;
  const baseDate = dateAdd[2].toLowerCase() === '@start_date' ? startDate : today;
  return baseDate ? addMonths(baseDate, Number(dateAdd[1])) : undefined;
}

export function hasFutureDateParameter(sql: string): boolean {
  return /DECLARE\s+@future_date\s+\w+/i.test(sql);
}

export function getViewDateRangeDefaults(sql: string, today = new Date()): ViewDateRangeDefaults {
  const hasStartDate = /DECLARE\s+@start_date\s+\w+/i.test(sql);
  const hasEndDate = /DECLARE\s+@end_date\s+\w+/i.test(sql);
  const hasFutureDate = hasFutureDateParameter(sql);
  const todayString = dateString(today);

  if (!hasFutureDate) return { hasStartDate, hasEndDate, hasFutureDate };

  const fromDate = resolveDateExpression(variableExpression(sql, 'start_date'), undefined, todayString);
  const toDate = resolveDateExpression(variableExpression(sql, 'future_date'), fromDate, todayString);
  return { hasStartDate, hasEndDate, hasFutureDate, fromDate, toDate };
}

export function replaceViewDateRangeParameters(sql: string, fromDate: string, toDate: string): string {
  const replaceDeclaration = (name: string, value: string): string => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return sql;
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const assignment = new RegExp(`(SET\\s+@${escapedName}\\s*=\\s*)[^;]+;`, 'i');
    if (assignment.test(sql)) return sql.replace(assignment, `$1'${value}';`);
    const declaration = new RegExp(`DECLARE\\s+@${escapedName}\\s+(\\w+(?:\\s*\\([^)]*\\))?)(?:\\s*=[^;]+)?;`, 'i');
    return sql.replace(declaration, `DECLARE @${name} $1 = '${value}';`);
  };

  sql = replaceDeclaration('start_date', fromDate);
  const endParameter = hasFutureDateParameter(sql) ? 'future_date' : 'end_date';
  return replaceDeclaration(endParameter, toDate);
}
