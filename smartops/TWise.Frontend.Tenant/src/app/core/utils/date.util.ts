export class DateUtil {
  /** Parses a timestamp that has no timezone marker (common for `DateTime` — as opposed to
   *  `DateTimeOffset` — fields returned by the .NET backend) as UTC instead of letting the
   *  browser's `Date` constructor silently treat it as local time, which skews relative-time
   *  labels like "Modified Xh ago" by the viewer's UTC offset. */
  static parseUtc(iso: string): Date {
    const hasZone = /Z$|[+-]\d{2}:?\d{2}$/.test(iso);
    return new Date(hasZone ? iso : `${iso}Z`);
  }

  static formatCellValue(value: unknown): string {
    const text = value == null ? '' : String(value);
    const match = /^(\d{4})([-/])(\d{2})\2(\d{2})(?:(T| )(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?))?$/.exec(text);
    if (!match) return text;
    const [, year, , month, day, , time] = match;
    const date = new Date(`${year}-${month}-${day}T${time || '00:00:00'}${time ? '' : 'Z'}`);
    const calendarDate = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || calendarDate.getUTCFullYear() !== Number(year)
      || calendarDate.getUTCMonth() + 1 !== Number(month) || calendarDate.getUTCDate() !== Number(day)) return text;
    return `${month}-${day}-${year}${time ? ` ${time}` : ''}`;
  }

  static formatDate(date: Date | string, _format = 'DD-MMM-YY'): string {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    });
  }

  static isToday(date: Date | string): boolean {
    const d = new Date(date);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  }

  static daysDiff(dateA: Date | string, dateB: Date | string): number {
    const msPerDay = 1000 * 60 * 60 * 24;
    return Math.round(
      (new Date(dateB).getTime() - new Date(dateA).getTime()) / msPerDay
    );
  }

  static toISODate(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
