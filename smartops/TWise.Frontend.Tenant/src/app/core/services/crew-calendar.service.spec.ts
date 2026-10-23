import '@angular/compiler';
import { HttpClient } from '@angular/common/http';
import { EMPTY, firstValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { CalendarActivity, CrewCalendarData } from '../models/crew-calendar.model';
import { activityClusterKey, buildCrewCalendarPlan, crewClusterNames } from '../../features/dashboard/activity-breakdown/crew-calendar-planning';
import { buildCrewUtilizationReport } from '../../features/dashboard/activity-breakdown/crew-utilization';
import { ApiService } from './api.service';
import { CrewCalendarService } from './crew-calendar.service';
import { StorageService } from './storage.service';

const activity = (code: string, start: string, end: string,
  values: Partial<CalendarActivity> = {}): CalendarActivity => ({
  activityCode: code, activityName: code, wellId: 'W1', category: null,
  plannedStart: start, plannedEnd: end, actualStart: null, actualEnd: null,
  progress: 0, status: 'planned', isMilestone: false, rigOnDate: null,
  expectedRigOnDate: null, normsPerDay: null, productivityPct: null, ...values,
});

function fixture(pending: CalendarActivity[]): CrewCalendarData {
  const recorded = activity('RECORDED', '2026-10-01', '2026-10-31',
    { actualStart: '2026-10-01', actualEnd: '2026-10-15' });
  return {
    fromDate: '2026-10-01', toDate: '2026-10-31',
    totalGroups: 1, totalCrews: 1, totalActivities: pending.length + 1, totalMilestones: 0, milestones: [],
    groups: [{ crewGroupCode: 'G1', activityCount: pending.length + 1, completionPct: 50,
      crews: [{ crewCode: 'Crew 1', activities: [recorded] }, { crewCode: '', activities: pending }],
    }],
    actualGroups: [{ crewGroupCode: 'G1', activityCount: 1, completionPct: 0,
      crews: [{ crewCode: 'Crew 1', activities: [recorded] }],
    }],
    roster: { groups: [{ crewGroupCode: 'G1', crewGroupName: 'Group 1',
      crews: ['Crew 10', 'Crew 2', 'Crew 1'].map(crewUid => ({
        crewUid, crewTypeCode: 'G1',
        bookings: [{ plannedStart: '2026-01-01', plannedEnd: '2030-09-28' }],
      })),
    }] },
  };
}

function setCrewClusters(data: CrewCalendarData, clusters: Record<string, (string | null)[]>): void {
  for (const group of data.roster!.groups) {
    for (const crew of group.crews) {
      crew.projects = (clusters[crew.crewUid] ?? []).map((cluster, index) => ({
        projectId: `P${index}`, projectCode: null, cluster,
      }));
    }
  }
}

async function load(data: CrewCalendarData, includeRoster = true): Promise<CrewCalendarData> {
  const api = new ApiService(new HttpClient({ handle: () => EMPTY }));
  vi.spyOn(api, 'get').mockReturnValue(of({ data, message: '', success: true, statusCode: 200 }));
  const storage = new StorageService();
  vi.spyOn(storage, 'getItem').mockReturnValue(null);
  return firstValueFrom(new CrewCalendarService(api, storage).getCalendar({
    from: data.fromDate, to: data.toDate, includeRoster,
  }));
}

describe('Crew Calendar independent planning scenario', () => {
  it('loads only pending unassigned work, clears historical reservations and leaves Actual and the source unchanged', async () => {
    const pending = activity('PENDING', '2026-10-01', '2026-10-10');
    const data = fixture([
      pending,
      activity('STARTED', '2026-10-01', '2026-10-10', { actualStart: '2026-10-01' }),
      activity('FINISHED', '2026-10-01', '2026-10-10', { actualEnd: '2026-10-10' }),
      activity('PROGRESS', '2026-10-01', '2026-10-10', { progress: 10 }),
      activity('MILESTONE', '2026-10-01', '2026-10-01', { isMilestone: true }),
      activity('DRAFT', '2026-10-01', '2026-10-10', { source: 'draft' }),
    ]);
    const before = JSON.stringify(data);
    const result = await load(data);
    expect(result.groups[0].crews).toEqual([{ crewCode: '', activities: [pending] }]);
    expect(result).toMatchObject({ totalGroups: 1, totalCrews: 0, totalActivities: 1 });
    expect(result.roster!.groups[0].crews.every(crew => crew.bookings.length === 0)).toBe(true);
    expect(result.actualGroups).toBe(data.actualGroups);
    expect(JSON.stringify(data)).toBe(before);
  });

  it('assigns in date order to the first conflict-free crew, ignoring recorded assignments and reservations', async () => {
    const input = await load(fixture([
      activity('C', '2026-10-11', '2026-10-20'),
      activity('B', '2026-10-08', '2026-10-15'),
      activity('A', '2026-10-01', '2026-10-10'),
    ]));
    const plan = buildCrewCalendarPlan(input, input.roster!);
    expect(plan.groups[0].crews.map(crew => [crew.crewCode, crew.activities.map(item => item.activityCode)]))
      .toEqual([['Crew 1', ['A', 'C']], ['Crew 2', ['B']], ['Crew 10', []]]);
    expect(plan.groups[0].crews.flatMap(crew => crew.activities).every(item => item.proposed)).toBe(true);
  });

  it('treats a shared end/start day as a conflict and returns to the first crew for later free dates', async () => {
    const input = await load(fixture([
      activity('A', '2026-10-01', '2026-10-10'),
      activity('B', '2026-10-10', '2026-10-10'),
      activity('C', '2026-10-11', '2026-10-11'),
    ]));
    const plan = buildCrewCalendarPlan(input, input.roster!);
    expect(plan.groups[0].crews.map(crew => crew.activities.map(item => item.activityCode)))
      .toEqual([['A', 'C'], ['B'], []]);
  });

  it('matches the repeated 1-7 allocation example while keeping 10-13 on the first crew', async () => {
    const input = await load(fixture([
      activity('A', '2026-10-01', '2026-10-07'),
      activity('B', '2026-10-10', '2026-10-13'),
      activity('C', '2026-10-01', '2026-10-07'),
      activity('D', '2026-10-01', '2026-10-07'),
      activity('E', '2026-10-01', '2026-10-07'),
    ]));
    const plan = buildCrewCalendarPlan(input, input.roster!);
    const assignments = Object.fromEntries(plan.groups[0].crews.flatMap(crew =>
      crew.activities.map(item => [item.activityCode, crew.crewCode])));
    expect(assignments).toEqual({ A: 'Crew 1', B: 'Crew 1', C: 'Crew 2', D: 'Crew 10', E: 'Crew 1' });
    expect(plan.totalActivities).toBe(5);
    expect(plan.groups[0].crews.some(crew => !crew.crewCode)).toBe(false);
  });

  it('uses every crew before repeating the first crew in each additional allocation round', async () => {
    const input = await load(fixture(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(code =>
      activity(code, '2026-10-01', '2026-10-07'))));
    const snapshot = JSON.stringify(input);
    const plan = buildCrewCalendarPlan(input, input.roster!);
    expect(plan.groups[0].crews.map(crew => [crew.crewCode, crew.activities.map(item => item.activityCode)]))
      .toEqual([['Crew 1', ['A', 'D', 'G']], ['Crew 2', ['B', 'E']], ['Crew 10', ['C', 'F']]]);
    expect(plan.totalCrews).toBe(3);
    expect(plan.totalActivities).toBe(7);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(buildCrewCalendarPlan(input, input.roster!)).toEqual(plan);
  });

  it('counts repeated full-month allocations as 200% without duplicating source rows', async () => {
    const input = await load(fixture([
      ...['A', 'B', 'C', 'D'].map(code => activity(code, '2026-10-01', '2026-10-31')),
      activity('A', '2026-10-01', '2026-10-31'),
    ]));
    const plan = buildCrewCalendarPlan(input, input.roster!);
    const report = buildCrewUtilizationReport(plan, '2026-10-01', '2026-10-31', '2026-10-20', 'planned');
    expect(plan.totalActivities).toBe(4);
    expect(report.groups[0].crews.map(crew => crew.utilization)).toEqual([200, 100, 100]);
    expect(report.groups[0].crews[0]).toMatchObject({
      availableDays: 31, plannedDays: 62, idleDays: 0, actualAssignedDays: 0,
    });
    expect(report.totals).toMatchObject({ availableDays: 93, plannedDays: 124, actualAssignedDays: 0 });
  });

  it('does not use another group for overflow or invent a crew for an empty roster', async () => {
    const data = fixture(['A', 'B', 'C', 'D'].map(code => activity(code, '2026-10-01', '2026-10-07')));
    data.roster!.groups.push({ crewGroupCode: 'G2', crewGroupName: 'Other group', crews: [
      { crewUid: 'Other crew', crewTypeCode: 'G2', bookings: [] },
    ] });
    data.groups.push({ crewGroupCode: 'G3', activityCount: 1, completionPct: 0,
      crews: [{ crewCode: '', activities: [activity('NO-CREW', '2026-10-01', '2026-10-07')] }],
    });
    const input = await load(data);
    const plan = buildCrewCalendarPlan(input, input.roster!);
    expect(plan.groups.find(group => group.crewGroupCode === 'G1')!.crews[0].activities
      .map(item => item.activityCode)).toEqual(['A', 'D']);
    expect(plan.groups.find(group => group.crewGroupCode === 'G2')!.crews[0].activities).toEqual([]);
    expect(plan.groups.find(group => group.crewGroupCode === 'G3')!.crews)
      .toEqual([{ crewCode: '', activities: [activity('NO-CREW', '2026-10-01', '2026-10-07')], bookings: [] }]);
  });

  it('does not change recorded Actual work when the independent plan starts another round', async () => {
    const input = await load(fixture(['A', 'B', 'C', 'D'].map(code =>
      activity(code, '2026-10-01', '2026-10-31'))));
    const actual = JSON.stringify(input.actualGroups);
    const plan = buildCrewCalendarPlan(input, input.roster!);
    expect(plan.actualGroups).toBe(input.actualGroups);
    expect(JSON.stringify(plan.actualGroups)).toBe(actual);
    expect(plan.actualGroups![0].crews[0].activities.map(item => item.activityCode)).toEqual(['RECORDED']);
  });

  it('does not bypass recorded reservations for callers outside the independent planning scenario', () => {
    const data = fixture([activity('BLOCKED', '2026-10-01', '2026-10-31')]);
    const plan = buildCrewCalendarPlan(data, data.roster!);
    expect(plan.groups[0].crews.find(crew => !crew.crewCode)?.activities.map(item => item.activityCode))
      .toEqual(['BLOCKED']);
    expect(plan.groups[0].crews.flatMap(crew => crew.activities).some(item => item.proposed)).toBe(false);
  });

  it('assigns each activity only to a crew in both its cluster and its crew group', async () => {
    const data = fixture([
      activity('NIMR', '2026-10-01', '2026-10-07', { cluster: 'Nimr' }),
      activity('MARMUL', '2026-10-01', '2026-10-07', { cluster: 'Marmul' }),
      activity('AMAL', '2026-10-01', '2026-10-07', { cluster: 'Amal' }),
    ]);
    setCrewClusters(data, { 'Crew 1': ['Marmul'], 'Crew 2': ['Nimr'], 'Crew 10': ['Amal'] });
    const input = await load(data);
    const plan = buildCrewCalendarPlan(input, input.roster!);
    expect(plan.groups[0].crews.map(crew => [crew.crewCode, crew.activities.map(item => item.activityCode)]))
      .toEqual([['Crew 1', ['MARMUL']], ['Crew 2', ['NIMR']], ['Crew 10', ['AMAL']]]);
  });

  it('repeats only among matching-cluster crews instead of using a free crew from another cluster', async () => {
    const data = fixture(['A', 'B', 'C', 'D'].map(code =>
      activity(code, '2026-10-01', '2026-10-31', { cluster: 'Nimr' })));
    setCrewClusters(data, { 'Crew 1': ['Marmul'], 'Crew 2': ['Nimr'], 'Crew 10': ['Amal'] });
    const input = await load(data);
    const plan = buildCrewCalendarPlan(input, input.roster!);
    expect(plan.groups[0].crews.map(crew => crew.activities.length)).toEqual([0, 4, 0]);
    expect(buildCrewUtilizationReport(plan, input.fromDate, input.toDate, '2026-10-20', 'planned')
      .groups[0].crews[1].utilization).toBe(400);
  });

  it('shares a multi-cluster crew without double-booking it within an allocation round', async () => {
    const data = fixture([
      activity('A-NIMR', '2026-10-01', '2026-10-07', { cluster: 'Nimr' }),
      activity('B-MARMUL', '2026-10-01', '2026-10-07', { cluster: 'Marmul' }),
      activity('C-NIMR', '2026-10-01', '2026-10-07', { cluster: 'Nimr' }),
      activity('D-MARMUL', '2026-10-01', '2026-10-07', { cluster: 'Marmul' }),
    ]);
    setCrewClusters(data, { 'Crew 1': ['Nimr', 'Marmul'], 'Crew 2': ['Nimr'], 'Crew 10': ['Marmul'] });
    const input = await load(data);
    const plan = buildCrewCalendarPlan(input, input.roster!);
    expect(plan.groups[0].crews.map(crew => crew.activities.map(item => item.activityCode)))
      .toEqual([['A-NIMR', 'D-MARMUL'], ['C-NIMR'], ['B-MARMUL']]);
  });

  it('normalizes cluster names and preserves mappings from duplicate roster memberships', async () => {
    const data = fixture([activity('NIMR', '2026-10-01', '2026-10-07', { cluster: ' niMR ' })]);
    setCrewClusters(data, { 'Crew 1': [' NIMR '] });
    data.roster!.groups[0].crews.push({ crewUid: ' crew 1 ', crewTypeCode: 'G1', bookings: [], projects: [] });
    const input = await load(data);
    const plan = buildCrewCalendarPlan(input, input.roster!);
    expect(plan.groups[0].crews[0]).toMatchObject({
      crewCode: 'Crew 1', activities: [expect.objectContaining({ activityCode: 'NIMR', cluster: ' niMR ' })],
    });
  });

  it('leaves named-cluster work unallocated when the group has only unmapped crews', async () => {
    const input = await load(fixture([activity('NIMR', '2026-10-01', '2026-10-07', { cluster: 'Nimr' })]));
    const plan = buildCrewCalendarPlan(input, input.roster!);
    expect(plan.groups[0].crews.find(crew => !crew.crewCode)?.activities[0].activityCode).toBe('NIMR');
    expect(plan.groups[0].crews.filter(crew => crew.crewCode).every(crew => !crew.activities.length)).toBe(true);
  });

  it('does not borrow a matching-cluster crew from a different crew group', async () => {
    const data = fixture([activity('G1-NIMR', '2026-10-01', '2026-10-07', { cluster: 'Nimr' })]);
    setCrewClusters(data, { 'Crew 1': ['Marmul'], 'Crew 2': ['Marmul'], 'Crew 10': ['Marmul'] });
    data.roster!.groups.push({ crewGroupCode: 'G2', crewGroupName: 'Other group', crews: [
      { crewUid: 'Other crew', crewTypeCode: 'G2', bookings: [],
        projects: [{ projectId: 'P1', projectCode: null, cluster: 'Nimr' }] },
    ] });
    const input = await load(data);
    const plan = buildCrewCalendarPlan(input, input.roster!);
    expect(plan.groups.find(group => group.crewGroupCode === 'G1')!.crews
      .find(crew => !crew.crewCode)?.activities[0].activityCode).toBe('G1-NIMR');
    expect(plan.groups.find(group => group.crewGroupCode === 'G2')!.crews[0].activities).toEqual([]);
  });

  it('keeps unclassified work with unmapped crews rather than treating it as a wildcard', async () => {
    const data = fixture([activity('UNMAPPED', '2026-10-01', '2026-10-07')]);
    setCrewClusters(data, { 'Crew 1': ['Nimr'], 'Crew 2': [], 'Crew 10': ['Marmul'] });
    const input = await load(data);
    const plan = buildCrewCalendarPlan(input, input.roster!);
    expect(plan.groups[0].crews.map(crew => crew.activities.map(item => item.activityCode)))
      .toEqual([[], ['UNMAPPED'], []]);
    expect([...crewClusterNames().entries()]).toEqual([['', 'Unmapped']]);
    expect(activityClusterKey({ cluster: '  ' })).toBe('');
  });

  it('uses identical cluster keys for allocation and hierarchy display without duplicating parent clusters', () => {
    const clusters = crewClusterNames([
      { projectId: 'P1', projectCode: null, cluster: ' Nimr ' },
      { projectId: 'P2', projectCode: null, cluster: 'NIMR' },
      { projectId: 'P3', projectCode: null, cluster: null },
      { projectId: 'P4', projectCode: null, cluster: 'Marmul' },
    ]);
    expect([...clusters.entries()]).toEqual([['nimr', 'Nimr'], ['marmul', 'Marmul']]);
    expect(clusters.has(activityClusterKey({ cluster: ' NIMR ' }))).toBe(true);
    expect(clusters.has(activityClusterKey({ cluster: 'Amal' }))).toBe(false);
  });

  it('preserves Actual fallback data when the API does not supply separate actual groups', async () => {
    const data = fixture([activity('PLAN', '2026-10-01', '2026-10-10')]);
    delete data.actualGroups;
    expect((await load(data)).actualGroups).toBe(data.groups);
  });

  it('returns calendar data unchanged when planning with a roster was not requested', async () => {
    const data = fixture([]);
    expect(await load(data, false)).toBe(data);
  });

  it('returns calendar data unchanged when there is no roster', async () => {
    const data = fixture([]);
    delete data.roster;
    expect(await load(data)).toBe(data);
  });
});
