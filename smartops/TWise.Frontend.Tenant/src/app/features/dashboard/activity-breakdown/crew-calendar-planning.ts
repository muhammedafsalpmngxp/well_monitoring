import { CalendarActivity, CalendarCrew, CalendarGroup, CrewBooking, CrewCalendarData, CrewRosterData } from '../../../core/models/crew-calendar.model';

type Interval = { start: number; end: number };
const dayMilliseconds = 86_400_000;
const crewOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const normalized = (value: string): string => value.trim().toLowerCase();

function dayNumber(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.NaN;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp / dayMilliseconds : Number.NaN;
}

function interval(booking: CrewBooking): Interval | null {
  const start = dayNumber(booking.plannedStart);
  const end = dayNumber(booking.plannedEnd);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? { start, end } : null;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  intervals.sort((first, second) => first.start - second.start || first.end - second.end);
  for (const current of intervals) {
    const previous = result.at(-1);
    if (previous && current.start <= previous.end + 1) previous.end = Math.max(previous.end, current.end);
    else result.push({ ...current });
  }
  return result;
}

function firstPossibleInterval(bookings: Interval[], start: number): number {
  let lower = 0;
  let upper = bookings.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (bookings[middle].end < start) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

function activityKey(activity: CalendarActivity): string {
  return JSON.stringify([normalized(activity.activityCode), normalized(activity.wellId || ''),
    activity.plannedStart, activity.plannedEnd]);
}

export function bookedDaysInWindow(bookings: CrewBooking[], from: string, to: string): number {
  if (!bookings.length) return 0;
  const window = interval({ plannedStart: from, plannedEnd: to });
  if (!window) return 0;
  const clipped = bookings.flatMap(booking => {
    const range = interval(booking);
    if (!range) return [];
    const start = Math.max(range.start, window.start);
    const end = Math.min(range.end, window.end);
    return end >= start ? [{ start, end }] : [];
  });
  return mergeIntervals(clipped).reduce((total, booking) => total + booking.end - booking.start + 1, 0);
}

export function uncoveredBookings(bookings: CrewBooking[], activities: CrewBooking[]): CrewBooking[] {
  const occupied = mergeIntervals(bookings.flatMap(booking => interval(booking) ?? []));
  const covered = mergeIntervals(activities.flatMap(activity => interval(activity) ?? []));
  const result: Interval[] = [];
  for (const booking of occupied) {
    let start = booking.start;
    let position = firstPossibleInterval(covered, start);
    while (position < covered.length && covered[position].start <= booking.end) {
      const current = covered[position++];
      if (current.start > start) result.push({ start, end: current.start - 1 });
      start = Math.max(start, current.end + 1);
    }
    if (start <= booking.end) result.push({ start, end: booking.end });
  }
  return result.map(booking => ({
    plannedStart: new Date(booking.start * dayMilliseconds).toISOString().slice(0, 10),
    plannedEnd: new Date(booking.end * dayMilliseconds).toISOString().slice(0, 10),
  }));
}

interface PlanningState {
  groups: Map<string, CalendarGroup>;
  eligible: Map<string, Set<string>>;
  crewLookup: Map<string, Map<string, CalendarCrew>>;
  reservations: Map<string, Interval[]>;
}

function getGroup(state: PlanningState, code: string, name?: string | null): CalendarGroup {
  const key = normalized(code);
  let group = state.groups.get(key);
  if (!group) {
    group = { crewGroupCode: code.trim(), crewGroupName: name, activityCount: 0, completionPct: 0, crews: [] };
    state.groups.set(key, group);
    state.crewLookup.set(key, new Map());
  }
  if (name) group.crewGroupName = name;
  return group;
}

function getCrew(state: PlanningState, group: CalendarGroup, code: string): CalendarCrew {
  const lookup = state.crewLookup.get(normalized(group.crewGroupCode))!;
  const key = normalized(code);
  let crew = lookup.get(key);
  if (!crew) {
    crew = { crewCode: code.trim(), activities: [], bookings: [] };
    lookup.set(key, crew);
    group.crews.push(crew);
  }
  return crew;
}

function reserveBookings(state: PlanningState, crewCode: string, bookings: CrewBooking[]): void {
  const key = normalized(crewCode);
  const occupied = state.reservations.get(key) ?? [];
  for (const booking of bookings) {
    const range = interval(booking);
    if (range) occupied.push(range);
  }
  state.reservations.set(key, occupied);
}

function loadRoster(state: PlanningState, roster: CrewRosterData): void {
  for (const rosterGroup of roster.groups) {
    const group = getGroup(state, rosterGroup.crewGroupCode, rosterGroup.crewGroupName);
    const groupKey = normalized(group.crewGroupCode);
    const members = state.eligible.get(groupKey) ?? new Set<string>();
    state.eligible.set(groupKey, members);
    for (const member of rosterGroup.crews) {
      if (!member.crewUid.trim()) continue;
      const crew = getCrew(state, group, member.crewUid);
      crew.crewTypeCode = member.crewTypeCode;
      crew.projects = member.projects ?? [];
      crew.bookings!.push(...member.bookings);
      members.add(normalized(crew.crewCode));
      reserveBookings(state, crew.crewCode, member.bookings);
    }
  }
}

function loadAssignments(state: PlanningState, data: CrewCalendarData): void {
  for (const sourceGroup of data.groups) {
    const group = getGroup(state, sourceGroup.crewGroupCode, sourceGroup.crewGroupName);
    for (const sourceCrew of sourceGroup.crews) {
      const crew = getCrew(state, group, sourceCrew.crewCode || '');
      const activities = sourceCrew.activities.filter(activity => activity.source !== 'draft');
      crew.activities.push(...activities);
      if (crew.crewCode) reserveBookings(state, crew.crewCode, activities);
    }
  }
}

function allocateCrew(crew: CalendarCrew, occupied: Interval[],
  candidates: { activity: CalendarActivity; range: Interval | null }[], remaining: Set<CalendarActivity>): void {
  for (const { activity, range } of candidates) {
    if (!remaining.has(activity) || !range) continue;
    const position = firstPossibleInterval(occupied, range.start);
    if (position < occupied.length && occupied[position].start <= range.end) continue;
    crew.activities.push({ ...activity, proposed: true });
    occupied.splice(position, 0, range);
    remaining.delete(activity);
  }
}

function allocateGroup(state: PlanningState, group: CalendarGroup): void {
  group.crews.sort((first, second) => crewOrder.compare(first.crewCode, second.crewCode));
  const unallocated = group.crews.find(crew => !crew.crewCode);
  const assignedKeys = new Set(group.crews.filter(crew => crew.crewCode)
    .flatMap(crew => crew.activities.map(activityKey)));
  const pending = (unallocated?.activities ?? []).filter(activity => {
    const key = activityKey(activity);
    if (assignedKeys.has(key) && !activity.actualStart && !activity.actualEnd && !activity.progress) return false;
    assignedKeys.add(key);
    return true;
  }).sort((first, second) => first.plannedStart.localeCompare(second.plannedStart)
    || first.plannedEnd.localeCompare(second.plannedEnd) || crewOrder.compare(activityKey(first), activityKey(second)));
  const remaining = new Set(pending);
  const candidates = pending.filter(activity => !activity.actualStart && !activity.actualEnd && !activity.isMilestone
    && !activity.progress).map(activity => ({ activity, range: interval(activity) }));
  const members = state.eligible.get(normalized(group.crewGroupCode));
  for (const crew of group.crews) {
    if (!remaining.size) break;
    const key = normalized(crew.crewCode);
    if (members?.has(key)) allocateCrew(crew, state.reservations.get(key)!, candidates, remaining);
  }
  if (unallocated) unallocated.activities = [...remaining];
  group.crews = group.crews.filter(crew => crew.crewCode || crew.activities.length);
  group.activityCount = group.crews.reduce((total, crew) => total + crew.activities.length, 0);
}

function restoreRetainedActivity(state: PlanningState, group: CalendarGroup, crew: CalendarCrew,
  savedActivity: CalendarActivity): void {
  if (savedActivity.source === 'draft') return;
  const key = activityKey(savedActivity);
  if (group.crews.some(member => member.crewCode && member.activities.some(activity => activityKey(activity) === key))) return;
  const pendingCrew = group.crews.find(member => !member.crewCode);
  const activity = pendingCrew?.activities.find(candidate => activityKey(candidate) === key);
  if (!activity || activity.actualStart || activity.actualEnd || activity.progress || activity.isMilestone) return;
  const range = interval(activity);
  if (!range) return;
  const occupied = state.reservations.get(normalized(crew.crewCode))!;
  const position = firstPossibleInterval(occupied, range.start);
  if (position < occupied.length && occupied[position].start <= range.end) return;
  crew.activities.push({ ...activity, proposed: true });
  occupied.splice(position, 0, range);
  if (pendingCrew) pendingCrew.activities = pendingCrew.activities.filter(candidate => candidate !== activity);
}

function restoreRetainedPlan(state: PlanningState, retained: CalendarGroup[]): void {
  for (const savedGroup of retained) {
    const groupKey = normalized(savedGroup.crewGroupCode);
    const group = state.groups.get(groupKey);
    if (!group) continue;
    for (const savedCrew of savedGroup.crews) {
      if (!state.eligible.get(groupKey)?.has(normalized(savedCrew.crewCode))) continue;
      const crew = getCrew(state, group, savedCrew.crewCode);
      savedCrew.activities.forEach(activity => restoreRetainedActivity(state, group, crew, activity));
    }
  }
}

export function buildCrewCalendarPlan(data: CrewCalendarData, roster: CrewRosterData,
  retained: CalendarGroup[] = []): CrewCalendarData {
  const state: PlanningState = { groups: new Map(), eligible: new Map(), crewLookup: new Map(), reservations: new Map() };
  loadRoster(state, roster);
  loadAssignments(state, data);
  for (const [key, occupied] of state.reservations) state.reservations.set(key, mergeIntervals(occupied));
  restoreRetainedPlan(state, retained);
  for (const group of state.groups.values()) allocateGroup(state, group);
  const result = [...state.groups.values()].sort((first, second) =>
    second.activityCount - first.activityCount || crewOrder.compare(first.crewGroupCode, second.crewGroupCode));
  return {
    ...data, groups: result, totalGroups: result.length,
    totalCrews: result.reduce((total, group) => total + group.crews.filter(crew => crew.crewCode).length, 0),
    totalActivities: result.reduce((total, group) => total + group.activityCount, 0),
  };
}

