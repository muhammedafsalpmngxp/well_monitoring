import {
  CalendarActivity, CalendarCrew, CrewBooking, CrewCalendarData, CrewUtilizationGroup,
  CrewUtilizationReport, CrewUtilizationRow, CrewUtilizationStatus, CrewUtilizationTotals, CrewReportStatus,
} from '../../../core/models/crew-calendar.model';
import { bookedDaysInWindow } from './crew-calendar-planning';

const normalize = (value: string): string => value.trim().toLowerCase();
const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function validDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

export function crewUtilizationStatus(utilization: number | null): CrewUtilizationStatus {
  if (utilization === null) return 'N/A';
  if (utilization >= 95) return 'Scarce';
  if (utilization >= 80) return 'Well-Utilized';
  if (utilization >= 50) return 'Underutilized';
  return 'Surplus';
}

export function crewReportStatus(utilization: number | null): CrewReportStatus {
  if (utilization === 100) return 'Fully utilized';
  if (utilization === 0) return 'Not utilized';
  if (utilization !== null && utilization > 0 && utilization < 100) return 'Partially utilized';
  return 'N/A';
}

function totalsFor(availableDays: number | null, plannedDays: number, actualAssignedDays: number,
  basis: 'planned' | 'actual'): CrewUtilizationTotals {
  const occupiedDays = basis === 'planned' ? plannedDays : actualAssignedDays;
  const utilization = availableDays !== null && availableDays > 0 ? occupiedDays / availableDays * 100 : null;
  return {
    availableDays, plannedDays, actualAssignedDays,
    idleDays: availableDays === null ? null : Math.max(0, availableDays - occupiedDays),
    utilization, status: crewReportStatus(utilization),
    unknownCapacity: availableDays === null ? 1 : 0,
  };
}

function sumRows(rows: CrewUtilizationRow[], basis: 'planned' | 'actual'): CrewUtilizationTotals {
  const known = rows.filter(row => row.availableDays !== null);
  const availableDays = known.length ? known.reduce((total, row) => total + row.availableDays!, 0) : null;
  return {
    ...totalsFor(availableDays,
      known.reduce((total, row) => total + row.plannedDays, 0),
      known.reduce((total, row) => total + row.actualAssignedDays, 0), basis),
    plannedDays: rows.reduce((total, row) => total + row.plannedDays, 0),
    actualAssignedDays: rows.reduce((total, row) => total + row.actualAssignedDays, 0),
    unknownCapacity: rows.length - known.length,
  };
}

function actualBooking(activity: CalendarActivity, today: string): CrewBooking[] {
  const actualStart = validDate(activity.actualStart) ? activity.actualStart : null;
  const actualEnd = validDate(activity.actualEnd) ? activity.actualEnd : null;
  if ((!actualStart && !actualEnd) || !validDate(today)) return [];
  const validPlan = validDate(activity.plannedStart) && validDate(activity.plannedEnd) &&
    activity.plannedEnd >= activity.plannedStart;
  const start = actualStart ?? (validPlan && activity.plannedStart <= actualEnd! ? activity.plannedStart : actualEnd!);
  const end = actualEnd && actualEnd < today ? actualEnd : today;
  return start <= end ? [{ plannedStart: start, plannedEnd: end }] : [];
}

export function actualDaysInWindow(activities: CalendarActivity[], from: string, to: string, today: string): number {
  return bookedDaysInWindow(activities
    .filter(activity => !activity.isMilestone && activity.source !== 'draft')
    .flatMap(activity => actualBooking(activity, today)), from, to);
}

export function buildCrewUtilizationReport(
  data: CrewCalendarData, from: string, to: string, today: string, basis: 'planned' | 'actual' = 'actual',
): CrewUtilizationReport {
  const periodDays = bookedDaysInWindow([{ plannedStart: from, plannedEnd: to }], from, to);
  const roster = new Map<string, Set<string>>();
  for (const group of data.roster?.groups ?? []) {
    const groupCode = normalize(group.crewGroupCode);
    const members = roster.get(groupCode) ?? new Set<string>();
    for (const crew of group.crews) if (crew.crewUid.trim()) members.add(normalize(crew.crewUid));
    roster.set(groupCode, members);
  }
  const grouped = new Map<string, { code: string; name: string | null; crews: Map<string, CalendarCrew> }>();
  for (const source of data.groups) {
    const groupCode = normalize(source.crewGroupCode);
    if (!groupCode) continue;
    let group = grouped.get(groupCode);
    if (!group) {
      group = { code: source.crewGroupCode.trim(), name: source.crewGroupName ?? null, crews: new Map() };
      grouped.set(groupCode, group);
    }
    for (const crew of source.crews) {
      const crewId = normalize(crew.crewCode);
      if (!crewId) continue;
      const existing = group.crews.get(crewId);
      group.crews.set(crewId, {
        crewCode: existing?.crewCode ?? crew.crewCode.trim(),
        activities: [...(existing?.activities ?? []), ...crew.activities],
        bookings: [...(existing?.bookings ?? []), ...(crew.bookings ?? [])],
      });
    }
  }
  const groups: CrewUtilizationGroup[] = [];
  for (const [groupCode, source] of grouped) {
    const crews: CrewUtilizationRow[] = [...source.crews].map(([crewId, crew]) => {
      const activities = crew.activities.filter(activity => !activity.isMilestone && activity.source !== 'draft');
      const plannedDays = bookedDaysInWindow([...activities, ...(crew.bookings ?? [])], from, to);
      const actualAssignedDays = actualDaysInWindow(activities, from, to, today);
      return {
        crewId: crew.crewCode,
        ...totalsFor(periodDays > 0 && roster.get(groupCode)?.has(crewId) ? periodDays : null, plannedDays, actualAssignedDays, basis),
      };
    }).sort((first, second) => naturalOrder.compare(first.crewId, second.crewId));
    if (crews.length) groups.push({ code: source.code, name: source.name, crews, ...sumRows(crews, basis) });
  }
  groups.sort((first, second) => naturalOrder.compare(first.code, second.code));
  return summarizeCrewUtilizationReport(groups, from, to, basis);
}

export function summarizeCrewUtilizationReport(
  source: Pick<CrewUtilizationGroup, 'code' | 'name' | 'crews'>[], from: string, to: string,
  basis: 'planned' | 'actual',
): CrewUtilizationReport {
  const groups = source.filter(group => group.crews.length > 0).map(group => {
    const crews = group.crews.map(crew => ({ ...crew,
      ...totalsFor(crew.availableDays, crew.plannedDays, crew.actualAssignedDays, basis),
    }));
    return { ...group, crews, ...sumRows(crews, basis) };
  });
  const rows = groups.flatMap(group => group.crews);
  const known = rows.filter(row => row.utilization !== null);
  return {
    from, to, groups, totals: sumRows(rows, basis),
    summary: {
      crewGroups: groups.length,
      actualCrews: new Set(rows.map(row => normalize(row.crewId))).size,
      averagePlannedUtilization: known.length
        ? known.reduce((sum, row) => sum + row.plannedDays / row.availableDays! * 100, 0) / known.length : null,
      averageUtilization: known.length ? known.reduce((sum, row) => sum + row.actualAssignedDays / row.availableDays! * 100, 0) / known.length : null,
      unknownCapacity: rows.filter(row => row.availableDays === null).length,
    },
  };
}