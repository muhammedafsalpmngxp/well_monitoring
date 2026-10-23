import '@angular/compiler';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { ActivityBreakdownComponent } from './activity-breakdown.component';
import { bookedDaysInWindow, buildCrewCalendarPlan, uncoveredBookings } from './crew-calendar-planning';
import { buildCrewUtilizationReport, crewReportStatus } from './crew-utilization';
import { CrewUtilizationReportComponent } from './crew-utilization-report.component';
import { CalendarActivity, CrewCalendarData, CrewRosterData } from '../../../core/models/crew-calendar.model';
import { CrewCalendarService } from '../../../core/services/crew-calendar.service';
import { CommonApiService } from '../../../core/services/common-api.service';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { StorageService } from '../../../core/services/storage.service';
import { AuthService } from '../../../core/services/auth.service';
import { APP_CONSTANTS } from '../../../core/constants/app.constants';
import { MENU_STRUCTURE } from '../../../core/constants/menu.constants';
import { SidebarComponent } from '../../../layouts/main-layout/sidebar/sidebar.component';
import { ConfirmationDialogComponent } from '../../../shared/components/confirmation-dialog/confirmation-dialog.component';

describe('Crew calendar planning', () => {
  it('calculates report utilization, idle days and status using the selected view', () => {
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [activity('WORK', '2026-09-01', '2026-09-30',
      { actualStart: '2026-09-01', actualEnd: '2026-09-15' })] }, { crewCode: 'Crew 2', activities: [] }];
    const snapshot = JSON.stringify(data);
    const planned = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-25', 'planned');
    const actual = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-25', 'actual');
    expect(planned.groups[0].crews[0]).toMatchObject({ plannedDays: 30, idleDays: 0, utilization: 100, status: 'Fully utilized' });
    expect(actual.groups[0].crews[0]).toMatchObject({ actualAssignedDays: 15, idleDays: 15, utilization: 50, status: 'Partially utilized' });
    expect(planned.totals).toMatchObject({ availableDays: 60, idleDays: 30, utilization: 50 });
    expect(actual.totals).toMatchObject({ availableDays: 60, idleDays: 45, utilization: 25 });
    expect(planned.summary).toEqual(actual.summary);
    expect(planned.groups[0].crews[1].status).toBe('Not utilized');
    expect(JSON.stringify(data)).toBe(snapshot);
  });

  it('reports 200% for two full-range activities without duplicating the same activity or its roster reservation', () => {
    const data = calendar([]);
    data.roster = roster();
    const first = activity('FIRST', '2026-09-01', '2026-09-30',
      { actualStart: '2026-09-01', actualEnd: '2026-09-30' });
    const second = activity('SECOND', '2026-09-01', '2026-09-30',
      { actualStart: '2026-09-01', actualEnd: '2026-09-30' });
    const booking = { plannedStart: '2026-09-01', plannedEnd: '2026-09-30' };
    data.groups[0].crews = [
      { crewCode: 'Crew 1', activities: [first, second], bookings: [booking] },
      { crewCode: ' crew 1 ', activities: [{ ...first }], bookings: [booking] },
    ];
    const snapshot = JSON.stringify(data);
    for (const basis of ['planned', 'actual'] as const) {
      const report = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-30', basis);
      expect(report.groups[0].crews).toHaveLength(1);
      expect(report.groups[0].crews[0]).toMatchObject({
        availableDays: 30, plannedDays: 60, actualAssignedDays: 60, idleDays: 0,
        utilization: 200, status: 'Fully utilized',
      });
      expect(report.totals).toMatchObject({ availableDays: 30, plannedDays: 60,
        actualAssignedDays: 60, idleDays: 0, utilization: 200 });
      expect(report.summary).toMatchObject({ averagePlannedUtilization: 200, averageUtilization: 200 });
    }
    expect(JSON.stringify(data)).toBe(snapshot);
  });

  it('exports 200% as numeric percentages in the planned and actual Excel sheets', async () => {
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
      activity('FIRST', '2026-09-01', '2026-09-30',
        { actualStart: '2026-09-01', actualEnd: '2026-09-30' }),
      activity('SECOND', '2026-09-01', '2026-09-30',
        { actualStart: '2026-09-01', actualEnd: '2026-09-30' }),
    ] }];
    const component = new CrewUtilizationReportComponent({ markForCheck: vi.fn() } as any);
    component.plannedReport = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-30', 'planned');
    component.actualReport = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-30', 'actual');
    component.report = component.plannedReport;
    component.ngOnChanges();
    const workbook = await component.createWorkbook();
    for (const view of ['Planned', 'Actual']) {
      const sheet = workbook.getWorksheet(view)!;
      expect(sheet.getCell('C5').value).toBe(2);
      expect(sheet.getCell('D8').value).toBe(60);
      expect(sheet.getCell('E8').value).toBe(0);
      expect(sheet.getCell('F8').value).toBe(2);
      expect(sheet.getCell('F8').numFmt).toBe('0.0%');
      expect(sheet.getCell('G8').value).toBe('Fully utilized');
    }
  });

  it.each([
    [0, 'Not utilized'], [0.01, 'Partially utilized'], [50, 'Partially utilized'],
    [99.99, 'Partially utilized'], [100, 'Fully utilized'], [200, 'Fully utilized'], [null, 'N/A'],
  ])('uses the requested report status at %s percent', (value, expected) => {
    expect(crewReportStatus(value as number | null)).toBe(expected);
  });

  const activity = (code: string, start: string, end: string, values: Partial<CalendarActivity> = {}): CalendarActivity => ({
    activityCode: code, activityName: code, wellId: 'W1', category: null, plannedStart: start, plannedEnd: end,
    actualStart: null, actualEnd: null, progress: 0, status: 'planned', isMilestone: false,
    rigOnDate: null, expectedRigOnDate: null, normsPerDay: null, productivityPct: null, ...values,
  });
  const calendar = (activities: CalendarActivity[]): CrewCalendarData => ({
    totalGroups: 1, totalCrews: 0, totalActivities: activities.length, totalMilestones: 0,
    fromDate: '2026-09-01', toDate: '2026-09-30', milestones: [],
    groups: [{ crewGroupCode: 'G1', activityCount: activities.length, completionPct: 0,
      crews: [{ crewCode: '', activities }] }],
  });
  const roster = (): CrewRosterData => ({ groups: [{ crewGroupCode: 'G1', crewGroupName: 'Group 1',
    crews: ['Crew 3', 'Crew 2', 'Crew 1'].map(crewUid => ({ crewUid, crewTypeCode: 'G1', bookings: [] })) }] });

  it('exposes Crew Calendar after WIP Boards and keeps its breadcrumb directly under Dashboard', () => {
    const dashboard = MENU_STRUCTURE.flatMap(group => group.items).find(item => item.label === 'Dashboard')!;
    expect(dashboard.children?.map(item => item.label)).toEqual(['Standard Boards', 'WIP Boards', 'Crew Calendar']);
    expect(dashboard.children?.[2]).toMatchObject({
      route: '/dashboard/crew-calendar', moduleCode: 'dashboard.standard-boards',
    });
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any, {} as any, {} as any, {} as any, {} as any,
    );
    const breadcrumbs = [{ label: 'Dashboard', route: '/dashboard' }, { label: 'Crew Calendar' }];
    expect(component.breadcrumbs).toEqual(breadcrumbs);
    (component as any).applyCalendarData(calendar([]));
    expect(component.breadcrumbs).toEqual(breadcrumbs);
  });

  it.each(['/dashboard/crew-calendar', '/dashboard/activity-breakdown/2150?from=standard',
    '/dashboard/activity-breakdown/35495#details'])('highlights Crew Calendar for %s without highlighting Standard Boards', currentUrl => {
    const sidebar = { currentUrl, layoutState: { activeNavOverride: '/dashboard/standard-boards' } } as any;
    expect(SidebarComponent.prototype.isChildActive.call(sidebar, '/dashboard/crew-calendar')).toBe(true);
    expect(SidebarComponent.prototype.isChildActive.call(sidebar, '/dashboard/standard-boards')).toBe(false);
  });

  it('groups crews by undated master parents and keeps activities and reservations with their crew without inflating totals', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const data = calendar([]);
    data.roster = roster();
    data.roster.groups[0].crews.push({ crewUid: '3522-IDLE', crewTypeCode: 'G1', bookings: [],
      projects: [{ projectId: 'UNKNOWN', projectCode: null, cluster: null }] });
    data.roster.groups[0].crews.find(crew => crew.crewUid === 'Crew 1')!.projects = [
      { projectId: 'P1', projectCode: 'NY0010', cluster: 'Nimr' },
      { projectId: 'P2', projectCode: 'MY0010', cluster: 'Marmul' },
      { projectId: 'P3', projectCode: 'NF0010', cluster: ' nimr ' },
    ];
    data.roster.groups[0].crews.find(crew => crew.crewUid === 'Crew 2')!.projects = [
      { projectId: 'P4', projectCode: 'AMP2A4', cluster: 'Amal' },
    ];
    data.roster.groups[0].crews.find(crew => crew.crewUid === 'Crew 1')!.bookings = [
      { plannedStart: '2026-09-21', plannedEnd: '2026-09-23' },
    ];
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
      activity('NIMR', '2026-09-01', '2026-09-03', { cluster: 'Nimr' }),
      activity('NIMR-2', '2026-09-05', '2026-09-06', { cluster: ' nimr ' }),
      activity('MARMUL', '2026-09-08', '2026-09-10', { cluster: 'Marmul' }),
      activity('MAPS', '2026-09-15', '2026-09-16', { source: 'assignment', assignmentId: 42 }),
    ] }, { crewCode: 'Crew 3', activities: [
      activity('UNMAPPED-CREW', '2026-09-17', '2026-09-18', { cluster: 'Nimr' }),
    ] }];
    (component as any).applyCalendarData(data);
    const before = JSON.stringify((component as any).calendarData);
    const summary = component.calendarSummary;
    const clusters = component.ganttClusters;
    expect(clusters.map(cluster => cluster.name)).toEqual(['Amal', 'Marmul', 'Nimr', 'Unmapped']);
    expect(component.ganttClusters).toBe(clusters);
    expect(clusters.every(cluster => !cluster.expanded && cluster.groups.every(group => !group.expanded))).toBe(true);
    expect(new Set(clusters.flatMap(cluster => cluster.groups.map(group => group.hierarchyKey))).size).toBe(4);
    expect(clusters[0].groups[0].wells[0]).toMatchObject({ id: 'Crew 2', activities: [], noActivities: true });
    for (const cluster of clusters.slice(1, 3)) {
      const crew = cluster.groups[0].wells[0];
      expect(crew.id).toBe('Crew 1');
      expect(crew.activities.map(row => row.bar.label).sort()).toEqual(['MAPS', 'MARMUL', 'NIMR', 'NIMR-2']);
      expect(crew.activities.find(row => row.bar.label === 'MAPS')!.bar.activities![0].assignmentId).toBe(42);
      expect(crew.bars.filter(bar => bar.reserved)).toHaveLength(1);
    }
    const unmapped = clusters[3].groups[0].wells;
    expect(unmapped.some(crew => crew.id === '3522-IDLE')).toBe(true);
    expect(unmapped.some(crew => crew.id === 'Crew 1')).toBe(false);
    expect(unmapped.find(crew => crew.id === 'Crew 3')!.activities[0].bar.label).toBe('UNMAPPED-CREW');
    expect(component.visibleGroupUtilization(clusters[2].groups[0])?.capacityCrewDays).toBe(30);
    component.expandAll();
    expect(component.allExpanded()).toBe(true);
    expect(component.ganttClusters.flatMap(cluster => cluster.groups.flatMap(group => group.wells))
      .every(crew => crew.expanded)).toBe(true);
    const expandedReservedCrew = component.ganttClusters[2].groups[0].wells[0];
    expect(component.visibleCrewBars(expandedReservedCrew)).toHaveLength(5);
    expect(component.visibleCrewBars(expandedReservedCrew).some(bar => bar.reserved)).toBe(true);
    component.collapseAll();
    expect(component.ganttClusters.every(cluster => !cluster.expanded)).toBe(true);
    expect(component.calendarSummary).toEqual(summary);
    component.openUtilizationReport();
    expect(component.utilizationReport?.summary).toMatchObject({ crewGroups: 1, actualCrews: 4 });
    expect(component.utilizationReport?.totals.availableDays).toBe(120);
    expect(JSON.stringify((component as any).calendarData)).toBe(before);
    const membership = () => component.ganttClusters.map(cluster => [cluster.name,
      cluster.groups.map(group => [group.name, group.wells.map(crew => crew.id)])]);
    const originalMembership = membership();
    component.closeUtilizationReport();
    component.timelineStart = new Date(2035, 0, 1);
    (component as any).selectedFrom = '2035-01-01';
    (component as any).selectedTo = '2035-01-07';
    (component as any).applyCalendarData({ ...data, fromDate: '2035-01-01', toDate: '2035-01-07', groups: [] });
    expect(membership()).toEqual(originalMembership);
    expect(component.ganttClusters.flatMap(cluster => cluster.groups.flatMap(group => group.wells))
      .every(crew => !crew.activities.length && !crew.bars.length)).toBe(true);
    component.scheduleFilter = 'actual';
    expect(membership()).toEqual(originalMembership);
  });

  it('shows only the applied cluster and its crews, including shared crews, and restores all branches on reset', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    component.filterFrom = '2026-09-01';
    component.filterTo = '2026-09-30';
    (component as any).selectedFrom = component.filterFrom;
    (component as any).selectedTo = component.filterTo;
    vi.spyOn(component as any, 'loadCalendarData').mockImplementation(() => {});
    const data = calendar([]);
    data.roster = roster();
    data.roster.groups[0].crews.find(crew => crew.crewUid === 'Crew 1')!.projects = [
      { projectId: 'P1', projectCode: 'AMP2A4', cluster: 'Amal' },
      { projectId: 'P2', projectCode: 'NY0010', cluster: 'Nimr' },
    ];
    data.roster.groups[0].crews.find(crew => crew.crewUid === 'Crew 2')!.projects = [
      { projectId: 'P3', projectCode: 'MY0010', cluster: 'Marmul' },
    ];
    (component as any).applyCalendarData(data);
    const originalGroups = component.crewGroups;
    const originalClusters = component.ganttClusters;
    expect(originalClusters.map(cluster => cluster.name)).toEqual(['Amal', 'Marmul', 'Nimr', 'Unmapped']);

    component.filterCluster = ' aMaL ';
    expect(component.ganttClusters).toBe(originalClusters);
    component.applyDashboardFilters();
    expect(component.crewGroups).toBe(originalGroups);
    expect(component.ganttClusters.map(cluster => cluster.name)).toEqual(['Amal']);
    expect(component.ganttClusters[0].groups[0].wells.map(crew => crew.id)).toEqual(['Crew 1']);

    component.filterCluster = 'Marmul';
    expect(component.ganttClusters.map(cluster => cluster.name)).toEqual(['Amal']);
    component.applyDashboardFilters();
    expect(component.ganttClusters.map(cluster => cluster.name)).toEqual(['Marmul']);
    expect(component.ganttClusters[0].groups[0].wells.map(crew => crew.id)).toEqual(['Crew 2']);

    component.filterCluster = 'Missing';
    component.applyDashboardFilters();
    expect(component.ganttClusters).toEqual([]);
    component.resetDashboardFilters();
    expect(component.ganttClusters.map(cluster => cluster.name)).toEqual(['Amal', 'Marmul', 'Nimr', 'Unmapped']);
  });

  it('keeps crew parent branches and expansion stable when filtering actual activities', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const data = calendar([]);
    data.roster = roster();
    data.roster.groups[0].crews.find(crew => crew.crewUid === 'Crew 1')!.projects = [
      { projectId: 'P1', projectCode: 'NY0010', cluster: 'Nimr' },
      { projectId: 'P2', projectCode: 'MY0010', cluster: 'Marmul' },
    ];
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
      activity('ACTUAL', '2026-09-01', '2026-09-03', { cluster: 'Nimr', actualStart: '2026-09-01', actualEnd: '2026-09-02' }),
      activity('PLAN', '2026-09-08', '2026-09-10', { cluster: 'Marmul' }),
    ] }];
    (component as any).applyCalendarData(data);
    component.rowFilterSelected = new Set(['Crew 1']);
    component.toggleCluster(component.ganttClusters.find(cluster => cluster.name === 'Nimr')!, new Event('click'));
    const group = component.ganttClusters.find(cluster => cluster.name === 'Nimr')!.groups[0];
    component.toggleGroup(group, new Event('click'));
    component.toggleCrew(group.wells[0], new Event('click'));
    component.searchTerm = 'G1';
    let nimr = component.ganttClusters.find(cluster => cluster.name === 'Nimr')!;
    expect(nimr.groups[0].expanded).toBe(true);
    expect(nimr.groups[0].wells[0].expanded).toBe(true);
    expect(component.ganttClusters.find(cluster => cluster.name === 'Marmul')!.groups[0].expanded).toBe(false);
    component.scheduleFilter = 'actual';
    expect(component.ganttClusters.map(cluster => cluster.name)).toEqual(['Marmul', 'Nimr']);
    expect(component.ganttClusters[0].groups[0].bars[0].activities?.map(row => row.activityCode)).toEqual(['ACTUAL']);
    component.utilizationBasis = 'actual';
    component.utilizationFilter = 'Scarce';
    expect(component.ganttClusters).toEqual([]);
    component.utilizationFilter = 'Surplus';
    nimr = component.ganttClusters.find(cluster => cluster.name === 'Nimr')!;
    expect(nimr.groups[0].expanded).toBe(true);
    component.toggleCluster(nimr, new Event('click'));
    expect(component.ganttClusters.find(cluster => cluster.name === 'Nimr')!.expanded).toBe(false);
    component.toggleCluster(component.ganttClusters.find(cluster => cluster.name === 'Nimr')!, new Event('click'));
    expect(component.ganttClusters.find(cluster => cluster.name === 'Nimr')!.groups[0].wells[0].expanded).toBe(true);
    component.searchTerm = 'does-not-match';
    expect(component.ganttClusters).toEqual([]);
  });

  it('stops expansion at crews and keeps their bars and both panes in sync after filtering', async () => {
    const responses = new Subject<CrewCalendarData>();
    const service = { getCalendar: vi.fn(() => responses), saveSessionPlan: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [ActivityBreakdownComponent],
      providers: [provideRouter([]),
        { provide: CrewCalendarService, useValue: service },
        { provide: CommonApiService, useValue: { getPlantFilters: () => of([]) } },
        { provide: LayoutStateService, useValue: { isCollapsed: false, collapse: vi.fn(), expand: vi.fn() } },
        { provide: AuthService, useValue: { isAdmin: () => true } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ActivityBreakdownComponent);
    const component = fixture.componentInstance;
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const data = calendar([]);
    data.roster = roster();
    data.roster.groups[0].crews.find(crew => crew.crewUid === 'Crew 1')!.projects = [
      { projectId: 'P1', projectCode: 'NY0010', cluster: 'Nimr' },
    ];
    data.roster.groups[0].crews.find(crew => crew.crewUid === 'Crew 2')!.bookings = [
      { plannedStart: '2026-09-01', plannedEnd: '2026-09-30' },
    ];
    data.groups[0].crews = [{ crewCode: '', activities: [
      activity('ACTIVITY', '2026-09-01', '2026-09-03', { cluster: 'Nimr' }),
    ] }];
    const host: HTMLElement = fixture.nativeElement;
    const click = (label: string) => {
      const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      expect(button).not.toBeNull();
      button!.click();
      fixture.detectChanges();
    };
    const expectMatchingRows = () => {
      const keys = (selector: string) => [...host.querySelectorAll(selector)]
        .map(row => row.getAttribute('data-hierarchy-key'));
      expect(keys('.ab-gantt__left-rows .ab-row')).toEqual(keys('.ab-bar-area-wrap .ab-bar-row'));
    };
    try {
      fixture.detectChanges();
      responses.next(data);
      fixture.detectChanges();
      const originalPlan = JSON.stringify((component as any).calendarData);
      const originalSummary = component.calendarSummary;
      expect(component.scheduleFilter).toBe('planned');
      expect([...host.querySelectorAll('[aria-label="Schedule view"] button')].map(button => button.textContent?.trim()))
        .toEqual(['Planned', 'Actual']);
      expect([...host.querySelectorAll('.ab-row--cluster .ab-row__name')].map(row => row.textContent?.trim()))
        .toEqual(['Nimr', 'Unmapped']);
      expect([...host.querySelectorAll('.ab-row--cluster .ab-row__badge--utilization')].map(badge => badge.textContent?.trim()))
        .toEqual(['10%', '50%']);
      expect(host.querySelector('.ab-row--cluster .ab-row__badge--utilization')?.getAttribute('aria-label'))
        .toBe('10% scheduled utilization');
      expect([...host.querySelectorAll('.ab-row--cluster')].every(row => row.getAttribute('aria-expanded') === 'false')).toBe(true);
      expect(host.querySelectorAll('.ab-row--group')).toHaveLength(0);
      expect(host.querySelectorAll('.ab-row--well')).toHaveLength(0);
      expectMatchingRows();
      click('Toggle cluster Nimr');
      expect(host.querySelectorAll('.ab-row--group')).toHaveLength(1);
      expect(host.querySelector('button[aria-label="Toggle G1"]')?.getAttribute('aria-expanded')).toBe('false');
      expect(host.querySelectorAll('.ab-row--well')).toHaveLength(0);
      expectMatchingRows();
      click('Toggle G1');
      expect(host.querySelector('button[aria-label="Toggle Crew 1"]')).toBeNull();
      expect(host.querySelector('.ab-row--well .ab-row__name')?.textContent?.trim()).toBe('crew-1');
      expect(host.querySelector('.ab-row--well .ab-row__name')?.getAttribute('title')).toBe('Crew 1');
      host.querySelector<HTMLElement>('.ab-row--well')!.click();
      fixture.detectChanges();
      expect(component.selectedWellId).toBe(component.ganttClusters[0].groups[0].wells[0].hierarchyKey);
      expect(host.querySelectorAll('.ab-row--activity')).toHaveLength(0);
      expect(host.querySelectorAll('.ab-bar-row--activity')).toHaveLength(0);
      expect(host.querySelectorAll('.ab-bar-row--crew-planning .ab-bar--preview')).toHaveLength(1);
      expectMatchingRows();
      const filterButton = host.querySelector<HTMLButtonElement>('button[title="Filter rows by status"]')!;
      filterButton.click();
      fixture.detectChanges();
      const crewOption = [...host.querySelectorAll<HTMLElement>('.ab-row-filter-panel__option--crew')]
        .find(option => option.textContent?.trim() === 'Crew 1')!;
      crewOption.click();
      fixture.detectChanges();
      filterButton.click();
      fixture.detectChanges();
      expect(host.querySelectorAll('.ab-row--cluster')).toHaveLength(1);
      expect(host.querySelectorAll('.ab-row--activity')).toHaveLength(0);
      expectMatchingRows();
      click('Toggle cluster Nimr');
      expect(host.querySelectorAll('.ab-gantt__left-rows .ab-row')).toHaveLength(1);
      expectMatchingRows();
      click('Toggle cluster Nimr');
      expect(host.querySelectorAll('.ab-row--activity')).toHaveLength(0);
      expect(host.querySelectorAll('.ab-bar-row--crew-planning .ab-bar--preview')).toHaveLength(1);
      expectMatchingRows();
      click('Toggle G1');
      expect(host.querySelectorAll('.ab-row--well')).toHaveLength(0);
      filterButton.click();
      fixture.detectChanges();
      host.querySelector<HTMLElement>('.ab-row-filter-panel__option')!.click();
      fixture.detectChanges();
      expectMatchingRows();
      [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Expand all')!.click();
      fixture.detectChanges();
      expect(host.querySelectorAll('.ab-bar--reserved')).toHaveLength(1);
      expect(host.querySelectorAll('.ab-bar-row--crew-planning .ab-bar--preview')).toHaveLength(1);
      expect(host.querySelectorAll('.ab-row--activity, .ab-bar-row--activity')).toHaveLength(0);
      expect([...host.querySelectorAll('.ab-row--well .ab-row__name')].map(row => row.textContent?.trim()))
        .toEqual(['crew-1', 'crew-1', 'crew-2']);
      expect([...host.querySelectorAll('.ab-row--well .ab-row__name')].map(row => row.getAttribute('title')))
        .toEqual(['Crew 1', 'Crew 2', 'Crew 3']);
      expectMatchingRows();
      [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Collapse all')!.click();
      fixture.detectChanges();
      expect(host.querySelectorAll('.ab-gantt__left-rows .ab-row')).toHaveLength(2);
      expectMatchingRows();
      expect(component.calendarSummary).toEqual(originalSummary);
      expect(JSON.stringify((component as any).calendarData)).toBe(originalPlan);
      const scheduleButtons = host.querySelectorAll<HTMLButtonElement>('[aria-label="Schedule view"] button');
      expect([...host.querySelectorAll('.ab-summary__metric dt')].map(metric => metric.textContent?.trim()))
        .toEqual(['Total crew groups', 'Total actual crews', 'Avg Planned Utilization']);
      scheduleButtons[1].click();
      fixture.detectChanges();
      expect(scheduleButtons[1].getAttribute('aria-pressed')).toBe('true');
      expect(component.utilizationBasis).toBe('actual');
      expect([...host.querySelectorAll('.ab-summary__metric dt')].map(metric => metric.textContent?.trim()))
        .toEqual(['Total crew groups', 'Total actual crews', 'Avg Actual Utilization']);
      expect(host.querySelectorAll('.ab-row--cluster')).toHaveLength(2);
      expect(host.querySelectorAll('.ab-bar--planned, .ab-bar--reserved, .ab-row--activity')).toHaveLength(0);
      expectMatchingRows();
      [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Expand all')!.click();
      fixture.detectChanges();
      expect([...host.querySelectorAll('.ab-row--well .ab-row__name')].map(row => row.textContent?.trim()))
        .toEqual(['Crew 1', 'Crew 2', 'Crew 3']);
      expect(host.querySelectorAll('.ab-row--activity, .ab-bar--planned, .ab-bar--reserved, .ab-bar--actual')).toHaveLength(0);
      scheduleButtons[0].click();
      fixture.detectChanges();
      expect(component.scheduleFilter).toBe('planned');
      expect(component.utilizationBasis).toBe('planned');
      expect([...host.querySelectorAll('.ab-row--well .ab-row__name')].map(row => row.textContent?.trim()))
        .toEqual(['crew-1', 'crew-1', 'crew-2']);
      expect(JSON.stringify((component as any).calendarData)).toBe(originalPlan);
      expect(service.getCalendar).toHaveBeenCalledTimes(1);
      expect(service.getCalendar).toHaveBeenCalledWith(expect.objectContaining({ includeAssignments: false, includeRoster: true }));
      expect(service.saveSessionPlan).not.toHaveBeenCalled();
    } finally {
      fixture.destroy();
      TestBed.resetTestingModule();
    }
  });

  it('selects planned and actual activities by their own dates and restores the planned allocations on return', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const data = calendar([]);
    data.roster = roster();
    data.roster.groups[0].crews.find(crew => crew.crewUid === 'Crew 1')!.projects = [
      { projectId: 'P1', projectCode: 'AMP2A4', cluster: 'Amal' },
    ];
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
      activity('PLAN-ONLY', '2026-09-10', '2026-09-12'),
      activity('ACTUAL-ONLY', '2026-08-01', '2026-08-02', { actualStart: '2026-09-01', actualEnd: '2026-09-03' }),
      activity('NO-PLAN', '', '', { actualStart: '2026-09-05', actualEnd: '2026-09-05' }),
      activity('OUTSIDE', '2026-08-01', '2026-08-02', { actualStart: '2026-08-01', actualEnd: '2026-08-02' }),
    ] }];
    data.actualGroups = data.groups;
    data.groups = data.groups.map(group => ({ ...group, crews: group.crews.map(crew => ({ ...crew,
      activities: crew.activities.filter(record => record.activityCode === 'PLAN-ONLY'),
    })) }));
    (component as any).calendarScope = { cluster: 'Amal' };
    (component as any).applyCalendarData(data);
    const snapshot = JSON.stringify((component as any).calendarData);
    const cluster = component.ganttClusters[0];
    component.toggleCluster(cluster, new Event('click'));
    component.toggleGroup(component.ganttClusters[0].groups[0], new Event('click'));
    const plannedCrew = component.ganttClusters[0].groups[0].wells[0];
    expect(plannedCrew.activities.map(row => row.bar.label)).toEqual(['PLAN-ONLY']);
    expect(component.visibleCalendarSummary.at(-1)).toMatchObject({ label: 'Avg Planned Utilization', count: 10 });

    component.setScheduleFilter('actual');
    const actualCluster = component.ganttClusters[0];
    const actualCrew = actualCluster.groups[0].wells[0];
    expect(actualCluster.expanded).toBe(true);
    expect(actualCluster.groups[0].expanded).toBe(true);
    expect(actualCrew.activities.map(row => row.bar.label)).toEqual(['ACTUAL-ONLY', 'NO-PLAN']);
    expect(component.visibleCrewBars(actualCrew).every(bar => !bar.reserved && !bar.proposed && !component.showPlannedBar(bar)))
      .toBe(true);
    expect(component.visibleClusterUtilization(actualCluster)?.percent).toBeCloseTo(4 / 30 * 100, 10);
    expect(component.visibleCalendarSummary.at(-1)?.count).toBeCloseTo(4 / 30 * 100, 10);

    component.setScheduleFilter('planned');
    expect(component.ganttClusters[0].groups[0].wells[0].activities.map(row => row.bar.label)).toEqual(['PLAN-ONLY']);
    expect(component.visibleClusterUtilization(component.ganttClusters[0])?.percent).toBe(10);
    expect(JSON.stringify((component as any).calendarData)).toBe(snapshot);
  });

  it('uses the master crew list in both views and reports without adding activity-only crew IDs', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const data = calendar([]);
    data.roster = { groups: [{ crewGroupCode: 'G1', crewGroupName: 'Master group', crews: [
      { crewUid: 'Crew 1', crewTypeCode: 'G1', bookings: [],
        projects: [{ projectId: 'P1', projectCode: 'AM1', cluster: 'Amal' }] },
      { crewUid: 'Crew 2', crewTypeCode: 'G1', bookings: [],
        projects: [{ projectId: 'P1', projectCode: 'AM1', cluster: 'Amal' }] },
    ] }] };
    data.groups[0].crews = [
      { crewCode: ' crew 1 ', activities: [activity('PLAN', '2026-09-01', '2026-09-03')] },
      { crewCode: 'PLAN-ONLY-ID', activities: [activity('OTHER-PLAN', '2026-09-01', '2026-09-10')] },
      { crewCode: '', activities: [activity('NO-ID', '2026-09-01', '2026-09-30', { actualStart: '2026-09-01' })] },
    ];
    data.actualGroups = [{ crewGroupCode: 'G1', activityCount: 2, completionPct: 100, crews: [
      { crewCode: 'CREW 1', activities: [activity('ACTUAL', '', '', { actualStart: '2026-09-01', actualEnd: '2026-09-06' })] },
      { crewCode: 'ACTUAL-ONLY-ID', activities: [activity('OTHER-ACTUAL', '', '', { actualStart: '2026-09-01', actualEnd: '2026-09-06' })] },
    ] }, { crewGroupCode: 'ACTIVITY-GROUP', activityCount: 1, completionPct: 100, crews: [
      { crewCode: 'EXTRA-ID', activities: [activity('EXTRA', '', '', { actualEnd: '2026-09-03' })] },
    ] }];
    const source = JSON.stringify(data);
    (component as any).applyCalendarData(data);
    const allocations = JSON.stringify((component as any).calendarData);
    for (const view of ['planned', 'actual', 'planned'] as const) {
      component.setScheduleFilter(view);
      const groups = component.ganttClusters.flatMap(cluster => cluster.groups);
      expect(groups.map(group => group.name)).toEqual(['G1']);
      expect(groups[0].wells.map(crew => crew.id)).toEqual(['Crew 1', 'Crew 2']);
      expect(component.calendarSummary.slice(0, 2).map(metric => metric.count)).toEqual([1, view === 'actual' ? 1 : 2]);
      expect(groups[0].wells[0].activities.map(row => row.bar.label)).toEqual([view === 'actual' ? 'ACTUAL' : 'PLAN']);
      expect(groups[0].wells[1].activities).toEqual([]);
      expect(component.visibleClusterUtilization(component.ganttClusters[0])?.percent).toBe(view === 'actual' ? 10 : 5);
      for (const useFilterRange of [false, true]) {
        component.openUtilizationReport(useFilterRange);
        expect(component.utilizationReport?.summary).toMatchObject({ crewGroups: 1, actualCrews: 2, unknownCapacity: 0 });
        expect(component.utilizationReport?.groups[0].crews.map(crew => crew.crewId)).toEqual(['Crew 1', 'Crew 2']);
        component.closeUtilizationReport();
      }
    }
    expect(JSON.stringify(data)).toBe(source);
    expect(JSON.stringify((component as any).calendarData)).toBe(allocations);
  });

  it('shows all identified roster crews in Actual and sorts cluster groups by actual utilization without changing Planned', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const data = calendar([]);
    const project = { projectId: 'P1', projectCode: 'AMP2A4', cluster: 'Amal' };
    data.roster = { groups: ['G1', 'G2', 'G3', 'G4', 'G5'].map(code => ({
      crewGroupCode: code, crewGroupName: code, crews: [
        { crewUid: `${code}-active`, crewTypeCode: code, projects: [project], bookings: [] },
        { crewUid: `${code}-idle`, crewTypeCode: code, projects: [project], bookings: [] },
      ],
    })) };
    data.groups = [
      { crewGroupCode: 'G1', activityCount: 1, completionPct: 0, crews: [
        { crewCode: 'G1-active', activities: [activity('LOW', '2026-09-01', '2026-09-03',
          { actualStart: '2026-09-01', actualEnd: '2026-09-03' })] },
      ] },
      { crewGroupCode: 'G2', activityCount: 1, completionPct: 0, crews: [
        { crewCode: 'G2-active', activities: [activity('HIGH', '2026-09-01', '2026-09-15',
          { actualStart: '2026-09-01', actualEnd: '2026-09-15' })] },
      ] },
      { crewGroupCode: 'G3', activityCount: 1, completionPct: 0, crews: [
        { crewCode: 'G3-active', activities: [activity('PLAN', '2026-09-01', '2026-09-03')] },
      ] },
      { crewGroupCode: 'G4', activityCount: 1, completionPct: 0, crews: [
        { crewCode: 'G4-active', activities: [activity('OUTSIDE', '2026-09-01', '2026-09-03',
          { actualStart: '2026-08-01', actualEnd: '2026-08-03' })] },
      ] },
      { crewGroupCode: 'G5', activityCount: 1, completionPct: 0, crews: [
        { crewCode: 'G5-active', activities: [activity('TIE', '2026-09-01', '2026-09-03',
          { actualStart: '2026-09-01', actualEnd: '2026-09-03' })] },
      ] },
    ];
    (component as any).applyCalendarData(data);
    const before = JSON.stringify((component as any).calendarData);
    const plannedSummary = component.calendarSummary;
    expect(component.ganttClusters[0].groups.map(group => group.name)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5']);
    component.setScheduleFilter('actual');
    const groups = component.ganttClusters[0].groups;
    expect(groups.map(group => group.name)).toEqual(['G2', 'G1', 'G5', 'G3', 'G4']);
    expect(groups.map(group => component.visibleGroupUtilization(group)?.percent)).toEqual([25, 5, 5, 0, 0]);
    expect(groups.flatMap(group => group.wells.map(crew => crew.id))).toEqual([
      'G2-active', 'G2-idle', 'G1-active', 'G1-idle', 'G5-active', 'G5-idle',
      'G3-active', 'G3-idle', 'G4-active', 'G4-idle',
    ]);
    expect(component.ganttGroups).toHaveLength(5);
    expect(component.visibleCalendarSummary.slice(0, 2).map(metric => metric.count)).toEqual([3, 3]);
    component.openUtilizationReport();
    expect(component.utilizationReport?.summary.actualCrews).toBe(10);
    component.openUtilizationReport(true);
    expect(component.utilizationReport?.summary.actualCrews).toBe(10);
    expect(component.utilizationReport?.groups.find(group => group.code === 'G3')?.crews.every(crew =>
      crew.actualAssignedDays === 0 && crew.status === 'Not utilized')).toBe(true);
    component.closeUtilizationReport();
    component.rowFilterSelected = new Set(['G1-idle']);
    const idleCrew = component.ganttClusters[0].groups[0].wells[0];
    expect(idleCrew.id).toBe('G1-idle');
    expect(component.visibleActivities(idleCrew)).toEqual([]);
    expect(component.visibleCrewBars(idleCrew)).toEqual([]);
    expect(component.visibleClusterUtilization(component.ganttClusters[0])?.percent).toBe(0);
    component.clearRowFilter();
    component.setScheduleFilter('planned');
    expect(component.ganttClusters[0].groups.map(group => group.name)).toEqual(['G1', 'G2', 'G3', 'G4', 'G5']);
    expect(component.ganttClusters[0].groups.flatMap(group => group.wells)).toHaveLength(10);
    expect(component.calendarSummary).toEqual(plannedSummary);
    expect(JSON.stringify((component as any).calendarData)).toBe(before);
  });

  it.each([
    { actualStart: '2026-09-01', actualEnd: null },
    { actualStart: null, actualEnd: '2026-09-03' },
    { actualStart: '2026-09-01', actualEnd: '2026-09-03' },
  ])('requires a crew ID for actual work with dates $actualStart / $actualEnd', dates => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = [
      { crewCode: 'Crew 1', activities: [activity('ASSIGNED', '2026-09-01', '2026-09-03', dates)] },
      { crewCode: '', activities: [activity('NO-CREW', '2026-09-01', '2026-09-03', dates)] },
      { crewCode: '   ', activities: [activity('BLANK-CREW', '2026-09-01', '2026-09-03', dates)] },
    ];
    data.actualGroups = data.groups;
    data.groups = [];
    (component as any).applyCalendarData(data);
    const before = JSON.stringify((component as any).calendarData);
    component.setScheduleFilter('actual');
    expect(component.ganttClusters.flatMap(cluster => cluster.groups.flatMap(group => group.wells.map(crew => crew.id))))
      .toEqual(['Crew 1', 'Crew 2', 'Crew 3']);
    expect(component.groupActivities(component.ganttGroups[0]).map(row => row.bar.label)).toEqual(['ASSIGNED']);
    component.rowFilterSelected = new Set(['Unassigned activities']);
    expect(component.ganttClusters).toEqual([]);
    component.clearRowFilter();
    component.setScheduleFilter('planned');
    expect(JSON.stringify((component as any).calendarData)).toBe(before);
  });

  it('refreshes cluster metadata on retained preview allocations without changing their crew or dates', () => {
    const source = calendar([activity('PLAN', '2026-09-01', '2026-09-03', { cluster: 'Nimr' })]);
    const members = roster();
    members.groups[0].crews.find(crew => crew.crewUid === 'Crew 1')!.projects = [
      { projectId: 'P1', projectCode: 'NM1', cluster: 'Nimr' },
    ];
    const retained = buildCrewCalendarPlan(source, members).groups;
    const previousCrew = retained[0].crews.find(crew => crew.activities.length)!;
    delete previousCrew.activities[0].cluster;
    const restored = buildCrewCalendarPlan(source, members, retained);
    const restoredCrew = restored.groups[0].crews.find(crew => crew.activities.length)!;
    expect(restoredCrew.crewCode).toBe(previousCrew.crewCode);
    expect(restoredCrew.activities[0]).toMatchObject({ cluster: 'Nimr', proposed: true,
      plannedStart: '2026-09-01', plannedEnd: '2026-09-03' });
  });

  it('shows each planning preview only under its activity cluster for a multi-cluster crew', () => {
    const component = new ActivityBreakdownComponent(
      {} as ActivatedRoute, {} as Router, {} as ChangeDetectorRef, {} as LayoutStateService,
      {} as CommonApiService, {} as CrewCalendarService, {} as AuthService,
    );
    component.timelineStart = new Date(2026, 8, 1);
    component['selectedFrom'] = '2026-09-01';
    component['selectedTo'] = '2026-09-30';
    const data = calendar([
      activity('NIMR', '2026-09-01', '2026-09-03', { cluster: 'Nimr' }),
      activity('MARMUL', '2026-09-08', '2026-09-10', { cluster: 'Marmul' }),
    ]);
    data.roster = roster();
    data.roster.groups[0].crews.forEach(crew => {
      crew.projects = (crew.crewUid === 'Crew 1' ? ['Nimr', 'Marmul'] :
        crew.crewUid === 'Crew 2' ? ['Nimr'] : ['Marmul']).map(cluster => ({
        projectId: cluster, projectCode: null, cluster,
      }));
    });
    component['applyCalendarData'](data);
    const nimr = component.ganttClusters.find(cluster => cluster.name === 'Nimr')!.groups[0];
    const marmul = component.ganttClusters.find(cluster => cluster.name === 'Marmul')!.groups[0];
    expect(nimr.wells.find(crew => crew.id === 'Crew 1')!.activities.map(row => row.bar.label)).toEqual(['NIMR']);
    expect(marmul.wells.find(crew => crew.id === 'Crew 1')!.activities.map(row => row.bar.label)).toEqual(['MARMUL']);
    expect(nimr.wells.find(crew => crew.id === 'Crew 2')!.noActivities).toBe(true);
    expect(marmul.wells.find(crew => crew.id === 'Crew 3')!.noActivities).toBe(true);
    expect(component['calendarData']!.groups[0].crews[0].activities).toHaveLength(2);
  });

  it('counts overlapping activities separately but counts shared reservations once without adding historical-only actual evidence', () => {
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
      activity('A', '2026-09-01', '2026-09-10', { actualStart: '2026-09-01', actualEnd: '2026-09-05' }),
      activity('B', '2026-09-08', '2026-09-15', { actualStart: '2026-09-04', actualEnd: '2026-09-08' }),
    ], bookings: [{ plannedStart: '2026-09-14', plannedEnd: '2026-09-17' }] },
    { crewCode: 'Crew 2', activities: [] }];
    data.actualCrewWork = [{ crewGroupCode: 'G1', crewCode: 'Crew 2', actualStart: '2026-09-01', actualEnd: null }];
    const before = JSON.stringify(data);
    const report = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-21');
    expect(report.groups[0].crews[0]).toMatchObject({ availableDays: 30, plannedDays: 20, actualAssignedDays: 10, idleDays: 20, status: 'Partially utilized' });
    expect(report.groups[0].crews[1].actualAssignedDays).toBe(0);
    expect(report.totals).toMatchObject({ availableDays: 60, plannedDays: 20, actualAssignedDays: 10, idleDays: 50 });
    expect(report.summary).toMatchObject({ crewGroups: 1, actualCrews: 2, unknownCapacity: 0 });
    expect(report.summary.averagePlannedUtilization).toBe(20 / 60 * 100);
    expect(JSON.stringify(data)).toBe(before);
  });

  it.each([
    [20, 'Fully utilized'], [19, 'Partially utilized'], [18, 'Partially utilized'], [16, 'Partially utilized'],
    [15, 'Partially utilized'], [10, 'Partially utilized'], [9, 'Partially utilized'], [0, 'Not utilized'],
  ])('classifies %s actual days using the workbook thresholds without counting subtotals', (actualDays, expectedStatus) => {
    const data = calendar([]);
    data.roster = roster();
    const end = Number(actualDays) ? `2026-09-${String(actualDays).padStart(2, '0')}` : null;
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [activity('A', '2026-09-01', '2026-09-20', {
      actualStart: end ? '2026-09-01' : null, actualEnd: end,
    })] }];
    const report = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-20', '2026-09-21');
    expect(report.groups[0].crews[0].status).toBe(expectedStatus);
    expect(report.totals.status).toBe(expectedStatus);
    expect(report.groups[0].status).toBe(expectedStatus);
  });

  it('clips ongoing and end-only actual days to the selected period and today, ignoring invalid actual ranges', () => {
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
      activity('ONGOING', '2026-09-01', '2026-09-30', { actualStart: '2026-08-01' }),
    ] }, { crewCode: 'Crew 2', activities: [
      activity('END', '2026-09-05', '2026-09-08', { actualEnd: '2026-09-08' }),
      activity('REVERSED', '2026-09-01', '2026-09-30', { actualStart: '2026-09-19', actualEnd: '2026-09-10' }),
    ] }];
    expect(buildCrewUtilizationReport(data, '2026-09-06', '2026-09-30', '2026-09-21').groups[0].crews
      .map(crew => crew.actualAssignedDays)).toEqual([16, 3]);
    expect(buildCrewUtilizationReport(data, '2026-09-22', '2026-09-30', '2026-09-21').totals.actualAssignedDays).toBe(0);
  });

  it('retains known totals when a crew has unknown capacity and normalizes duplicate crew memberships', () => {
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = [
      { crewCode: 'Crew 1', activities: [activity('A', '2026-09-01', '2026-09-05')] },
      { crewCode: ' crew 1 ', activities: [activity('A', '2026-09-01', '2026-09-05')] },
      { crewCode: 'Historical', activities: [activity('H', '2026-09-01', '2026-09-02', { actualStart: '2026-09-01', actualEnd: '2026-09-02' })] },
      { crewCode: '', activities: [activity('UNASSIGNED', '2026-09-01', '2026-09-30')] },
    ];
    const report = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-21');
    expect(report.groups[0].crews).toHaveLength(2);
    expect(report.groups[0].crews[0].plannedDays).toBe(5);
    expect(report.groups[0].crews[1]).toMatchObject({ availableDays: null, actualAssignedDays: 2, idleDays: null, utilization: null, status: 'N/A' });
    expect(report.totals).toMatchObject({ availableDays: 30, plannedDays: 7, actualAssignedDays: 2,
      idleDays: 30, utilization: 0, status: 'Not utilized', unknownCapacity: 1 });
    expect(report.groups[0]).toMatchObject(report.totals);
    expect(report.summary).toMatchObject({ actualCrews: 2, unknownCapacity: 1, averageUtilization: 0 });
    expect(report.summary.averagePlannedUtilization).toBe(5 / 30 * 100);
  });

  it('sums all activity days but uses matching known-capacity crews for partial utilization and idle totals across groups', () => {
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = [
      { crewCode: 'Crew 1', activities: [activity('KNOWN', '2026-09-01', '2026-09-30', {
        actualStart: '2026-09-01', actualEnd: '2026-09-15',
      })] },
      { crewCode: 'Historical', activities: [activity('UNKNOWN', '2026-09-01', '2026-09-05', {
        actualStart: '2026-09-01', actualEnd: '2026-09-05',
      })] },
    ];
    data.roster.groups.push({ crewGroupCode: 'G2', crewGroupName: 'Group 2',
      crews: [{ crewUid: 'Crew 4', crewTypeCode: 'G2', bookings: [] }] });
    data.groups.push({ crewGroupCode: 'G2', activityCount: 1, completionPct: 0,
      crews: [{ crewCode: 'Crew 4', activities: [activity('OTHER', '2026-09-01', '2026-09-30', {
        actualStart: '2026-09-01', actualEnd: '2026-09-09',
      })] }] }, { crewGroupCode: 'G3', activityCount: 1, completionPct: 0,
      crews: [{ crewCode: 'Other historical', activities: [activity('UNMAPPED', '2026-09-01', '2026-09-03', {
        actualStart: '2026-09-01', actualEnd: '2026-09-03',
      })] }] });
    const report = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-21');
    expect(report.groups[0]).toMatchObject({ availableDays: 30, plannedDays: 35, actualAssignedDays: 20,
      idleDays: 15, utilization: 50, status: 'Partially utilized', unknownCapacity: 1 });
    expect(report.groups[1]).toMatchObject({ availableDays: 30, plannedDays: 30, actualAssignedDays: 9,
      idleDays: 21, utilization: 30, status: 'Partially utilized', unknownCapacity: 0 });
    expect(report.groups[2]).toMatchObject({ availableDays: null, plannedDays: 3, actualAssignedDays: 3,
      idleDays: null, utilization: null, status: 'N/A', unknownCapacity: 1 });
    expect(report.totals).toEqual({ availableDays: 60, plannedDays: 68, actualAssignedDays: 32,
      idleDays: 36, utilization: 40, status: 'Partially utilized', unknownCapacity: 2 });
    expect(report.summary.averagePlannedUtilization).toBe(100);
  });

  it('returns an empty report without invented capacity and excludes milestones and obsolete drafts', () => {
    const data = calendar([]);
    expect(buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-21').summary)
      .toMatchObject({ crewGroups: 0, actualCrews: 0, averagePlannedUtilization: null, averageUtilization: null });
    data.roster = roster();
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
      activity('MILESTONE', '2026-09-01', '2026-09-30', { isMilestone: true }),
      activity('DRAFT', '2026-09-01', '2026-09-30', { source: 'draft', proposed: true }),
    ] }];
    expect(buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-21').totals.plannedDays).toBe(0);
    expect(buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-21').summary.averagePlannedUtilization).toBe(0);
    const invalidPeriod = buildCrewUtilizationReport(data, '2026-09-30', '2026-09-01', '2026-09-21');
    expect(invalidPeriod.totals.availableDays).toBeNull();
    expect(invalidPeriod.summary.averagePlannedUtilization).toBeNull();
    delete data.roster;
    expect(buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-21').summary.averagePlannedUtilization).toBeNull();
  });

  it('opens a report for the visible dates and crew filters using applied scope, then returns without reloading or changing allocations', () => {
    const service = { getCalendar: vi.fn(), saveSessionPlan: vi.fn() };
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, service as any, {} as any,
    );
    (component as any).selectedFrom = '2026-09-06';
    (component as any).selectedTo = '2026-09-18';
    component.timelineStart = new Date(2026, 8, 6);
    const data = calendar([]);
    data.roster = roster();
    data.roster.groups[0].crews.find(crew => crew.crewUid === 'Crew 1')!.projects = [
      { projectId: 'P1', projectCode: 'NY0010', cluster: 'Nimr' },
    ];
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
      activity('A', '2026-09-01', '2026-09-20', { actualStart: '2026-09-06', actualEnd: '2026-09-08' }),
    ] }];
    (component as any).applyCalendarData(data);
    (component as any).calendarScope = { cluster: 'Nimr', site: '3522' };
    (component as any).allPlants = [{ plantCode: 3522, plantDescription: 'Nimr ODC' }];
    component.filterCluster = 'Marmul';
    component.filterPlant = 'Marmul ODC';
    component.rowFilterSelected = new Set(['Crew 1']);
    const before = JSON.stringify((component as any).calendarData);

    component.openUtilizationReport();

    expect(component.utilizationReport).toMatchObject({ from: '2026-09-06', to: '2026-09-18',
      summary: { actualCrews: 1, crewGroups: 1 },
      totals: { availableDays: 13, plannedDays: 13, actualAssignedDays: 3, idleDays: 0, utilization: 100 } });
    expect(component.utilizationReport?.summary.averagePlannedUtilization).toBe(component.calendarSummary[2].count);
    expect(component.utilizationReport?.summary.averageUtilization).toBeCloseTo(component.calendarSummary[3].count!, 10);
    expect(component.utilizationScopeLabel).toBe('Nimr / Nimr ODC');
    expect(component.utilizationScopedActivities).toBe(true);
    component.closeUtilizationReport();
    expect(component.utilizationReport).toBeNull();
    expect(component.rowFilterSelected).toEqual(new Set(['Crew 1']));
    expect(JSON.stringify((component as any).calendarData)).toBe(before);
    expect(service.getCalendar).not.toHaveBeenCalled();
    expect(service.saveSessionPlan).not.toHaveBeenCalled();
  });

  it('restricts report rows to the actual Gantt selection and opens an honest empty report for no search matches', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [activity('ACTUAL', '2026-09-01', '2026-09-30', {
      actualStart: '2026-09-01', actualEnd: '2026-09-02',
    })] }];
    (component as any).applyCalendarData(data);
    component.scheduleFilter = 'actual';
    component.openUtilizationReport();
    expect(component.utilizationReport?.summary.actualCrews).toBe(3);
    component.closeUtilizationReport();
    component.searchTerm = 'does-not-match';
    component.openUtilizationReport();
    expect(component.utilizationReport?.groups).toHaveLength(0);
    expect(component.utilizationReport?.summary.averageUtilization).toBeNull();
  });

  it('does not open a report while calendar data is missing, loading or failed', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.openUtilizationReport();
    expect(component.utilizationReport).toBeNull();
    (component as any).calendarData = calendar([]);
    component.loading = true;
    component.openUtilizationReport();
    expect(component.utilizationReport).toBeNull();
    component.loading = false;
    component.loadError = 'Unavailable';
    component.openUtilizationReport();
    expect(component.utilizationReport).toBeNull();
  });

  it('regenerates an open report from applied dates and cluster/plant filters, ignores stale responses and recovers after errors', () => {
    const responses: Subject<CrewCalendarData>[] = [];
    const service = { getCalendar: vi.fn(() => {
      const response = new Subject<CrewCalendarData>();
      responses.push(response);
      return response;
    }) };
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, service as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    (component as any).allPlants = [
      { country: 'Oman', sector: 'Construction', businessUnit: 'Energy', division: 'Oilfield Projects', cluster: 'Amal', plantDescription: 'Amal ODC', plantCode: 100 },
      { country: 'Oman', sector: 'Construction', businessUnit: 'Energy', division: 'Oilfield Projects', cluster: 'Nimr', plantDescription: 'Nimr ODC', plantCode: 3522 },
    ];
    const data = calendar([]);
    data.roster = { groups: [{ crewGroupCode: 'G1', crewGroupName: 'Group 1', crews: [
      { crewUid: 'Crew 1', crewTypeCode: 'G1', bookings: [], projects: [{ projectId: 'P1', projectCode: 'AM1', cluster: 'Amal' }] },
      { crewUid: 'Crew 2', crewTypeCode: 'G1', bookings: [], projects: [{ projectId: 'P2', projectCode: 'NM1', cluster: 'Nimr' }] },
    ] }] };
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [activity('AMAL', '2026-09-01', '2026-09-15',
      { actualStart: '2026-09-01', actualEnd: '2026-09-05' })] },
      { crewCode: 'Crew 2', activities: [activity('NIMR', '2026-09-01', '2026-09-30')] }];
    (component as any).applyCalendarData(data);
    component.openUtilizationReport();
    expect(component.utilizationReport?.summary.actualCrews).toBe(2);
    component.selectFilterOption('country', 'Oman');
    component.selectFilterOption('sector', 'Construction');
    component.selectFilterOption('businessUnit', 'Energy');
    component.selectFilterOption('division', 'Oilfield Projects');
    expect(component.filterClusterOptions).toEqual(['Amal', 'Nimr']);
    component.clearGlobalFilterSelection('cluster', new MouseEvent('click'));
    component.selectFilterOption('cluster', 'Nimr');
    expect(component.filterPlant).toBe('Nimr ODC');
    component.timeUnit = 'day';
    component.filterFrom = '2026-09-01';
    component.filterTo = '2026-09-10';
    component.applyDashboardFilters();
    expect(component.loading).toBe(true);
    expect(service.getCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ cluster: 'Nimr', site: '3522', from: '2026-09-01', to: '2026-09-10' }));
    component.clearGlobalFilterSelection('cluster', new MouseEvent('click'));
    component.selectFilterOption('cluster', 'Amal');
    component.applyDashboardFilters();
    expect(service.getCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ cluster: 'Amal', site: '100' }));
    responses[0].next({ ...data, fromDate: '2026-09-01', toDate: '2026-09-10' });
    expect(component.loading).toBe(true);
    responses[1].next({ ...data, fromDate: '2026-09-01', toDate: '2026-09-10' });
    expect(component.loading).toBe(false);
    expect(component.utilizationScopeLabel).toBe('Amal / Amal ODC');
    expect(component.utilizationReport).toMatchObject({ from: '2026-09-01', to: '2026-09-10',
      summary: { actualCrews: 1 }, totals: { availableDays: 10, plannedDays: 10, actualAssignedDays: 5,
        utilization: 100, status: 'Fully utilized' } });
    expect(component.utilizationPlannedReport).toMatchObject({ from: '2026-09-01', to: '2026-09-10',
      summary: { actualCrews: 1 }, totals: { plannedDays: 10, utilization: 100, idleDays: 0 } });
    expect(component.utilizationActualReport).toMatchObject({ from: '2026-09-01', to: '2026-09-10',
      summary: { actualCrews: 1 }, totals: { actualAssignedDays: 5, utilization: 50, idleDays: 5 } });
    const allocations = JSON.stringify((component as any).calendarData);
    component.setUtilizationReportView('actual');
    expect(component.utilizationReport).toMatchObject({ from: '2026-09-01', to: '2026-09-10',
      summary: { actualCrews: 1 }, totals: { availableDays: 10, actualAssignedDays: 5, idleDays: 5,
        utilization: 50, status: 'Partially utilized' } });
    expect(component.utilizationExportView).toBe('Actual');
    component.setUtilizationReportView('planned');
    expect(component.utilizationReport).toMatchObject({ from: '2026-09-01', to: '2026-09-10',
      summary: { actualCrews: 1 }, totals: { utilization: 100, idleDays: 0, status: 'Fully utilized' } });
    expect(component.utilizationExportView).toBe('Planned');
    expect(JSON.stringify((component as any).calendarData)).toBe(allocations);
    expect(service.getCalendar).toHaveBeenCalledTimes(2);
    component.filterTo = '2026-08-31';
    component.applyDashboardFilters();
    expect(service.getCalendar).toHaveBeenCalledTimes(2);
    component.filterTo = '2026-09-10';
    component.applyDashboardFilters();
    responses[2].error({ status: 500 });
    expect(component.loadError).toContain('retry');
    component.applyDashboardFilters();
    responses[3].next({ ...data, groups: [], roster: { groups: [] } });
    expect(component.loadError).toBeNull();
    expect(component.utilizationReport?.groups).toEqual([]);
    component.resetDashboardFilters();
    expect(service.getCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ cluster: undefined, site: undefined }));
    responses[4].next(data);
    expect(component.utilizationReport?.summary.actualCrews).toBe(2);
  });

  it('provides every crew to the virtualized grid without changing summary or subtotal values', () => {
    const data = calendar([]);
    data.groups[0].crews = Array.from({ length: 123 }, (_, index) => ({ crewCode: `Crew ${index + 1}`, activities: [] }));
    const component = new CrewUtilizationReportComponent({ markForCheck: vi.fn() } as any);
    component.report = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-21');
    component.ngOnChanges();
    expect(component.expanded.size).toBe(0);
    component.expandAll();
    expect(component.allExpanded).toBe(true);
    const before = JSON.stringify(component.report);
    expect(component.rows.filter(row => row.kind === 'crew')).toHaveLength(123);
    expect(component.rows.filter(row => row.kind === 'group')).toHaveLength(1);
    expect(new Set(component.rows.map(row => row.id)).size).toBe(124);
    expect(component.totals[0]).toMatchObject(component.report.totals);
    component.collapseAll();
    expect(component.expanded.size).toBe(0);
    expect(JSON.stringify(component.report)).toBe(before);
  });

  it.each([1, 4, 10, 11, 124, 4, 0])('sizes the report grid for %s displayed rows', rowCount => {
    const component = new CrewUtilizationReportComponent({ markForCheck: vi.fn() } as any);
    component.onModelUpdated({ api: { getDisplayedRowCount: () => rowCount, forEachNodeAfterFilter: vi.fn() } } as any);
    expect(component.autoHeight).toBe(rowCount > 0 && rowCount <= 10);
  });

  it('renders AG Grid with collapsed groups, sortable crews, and pinned totals', async () => {
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = data.roster.groups[0].crews.map(crew => ({ crewCode: crew.crewUid, activities: [] }));
    const report = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-21');
    const originalReport = JSON.stringify(report);
    await TestBed.configureTestingModule({ imports: [CrewUtilizationReportComponent] }).compileComponents();
    const fixture = TestBed.createComponent(CrewUtilizationReportComponent);
    fixture.componentRef.setInput('report', report);
    fixture.componentRef.setInput('scopedActivities', true);
    fixture.componentRef.setInput('scopeLabel', 'Amal / Amal ODC');
    fixture.componentRef.setInput('selectionLabel', 'Assigned | Planned');
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    try {
      await vi.waitFor(() => expect(fixture.componentInstance.gridApi).not.toBeNull());
      const api = fixture.componentInstance.gridApi!;
      await vi.waitFor(() => expect(api.getDisplayedRowCount()).toBe(1));
      expect(api.getGridOption('domLayout')).toBe('autoHeight');
      expect(api.getGridOption('headerHeight')).toBe(40);
      expect(api.getGridOption('floatingFiltersHeight')).toBe(40);
      expect(host.querySelector('ag-grid-angular')?.classList.contains('cu-report__grid--auto-height')).toBe(true);
      const groupLabel = fixture.componentInstance.autoGroupColumnDef.cellRendererParams.innerRenderer({
        data: api.getDisplayedRowAtIndex(0)?.data,
      });
      expect(groupLabel.textContent).toBe('G1');
      expect(fixture.componentInstance.autoGroupColumnDef.cellRendererParams.suppressCount).toBe(true);
      expect(host.querySelector('.page-header__title')?.textContent?.trim()).toBe('Crew Utilization');
      expect(host.querySelector('.page-header__subtitle')?.textContent?.trim()).toBe('September 2026');
      expect(host.querySelector('.cu-report__scope')?.textContent?.trim()).toBe('Amal / Amal ODC');
      const toolbar = host.querySelector('.cu-report__toolbar');
      expect(toolbar?.firstElementChild).toBe(host.querySelector('.cu-report__scope'));
      expect(toolbar?.lastElementChild).toBe(host.querySelector('[aria-label="Report view"]'));
      expect(host.textContent).not.toContain('Assigned | Planned');
      expect(host.querySelector('app-page-header .cu-report__export')?.classList.contains('btn-primary')).toBe(true);
      const backButton = host.querySelector<HTMLButtonElement>('.page-header__left button[aria-label="Back to Crew Calendar"]');
      expect(backButton).not.toBeNull();
      expect(host.querySelector('.cu-report__header-actions button[aria-label="Back to Crew Calendar"]')).toBeNull();
      expect(host.querySelector('.page-header__title-group')?.firstElementChild).toBe(backButton);
      const closed = vi.spyOn(fixture.componentInstance.closed, 'emit');
      backButton!.click();
      expect(closed).toHaveBeenCalledTimes(1);
      expect(host.querySelector('#crew-utilization-title')?.getAttribute('tabindex')).toBe('-1');
      expect([...host.querySelectorAll('.cu-report__metrics dt')].map(element => element.textContent?.trim()))
        .toEqual(['Crew Groups', 'Actual Crews', 'Avg. Actual Utilization']);
      expect(host.querySelectorAll('.cu-report__metrics > div')).toHaveLength(3);
      expect(host.querySelectorAll('.cu-report__metric-icon[aria-hidden="true"] svg')).toHaveLength(3);
      expect(host.querySelectorAll('.cu-report__metrics dd')[2].textContent?.trim()).toBe('0%');
      expect(fixture.componentInstance.columns.map(column => column.field)).not.toContain('plannedDays');
      expect(fixture.componentInstance.columns.map(column => column.field)).toContain('actualAssignedDays');
      const viewChanged = vi.spyOn(fixture.componentInstance.viewChanged, 'emit');
      const viewButtons = host.querySelectorAll<HTMLButtonElement>('[aria-label="Report view"] button');
      expect([...viewButtons].map(button => button.textContent?.trim())).toEqual(['Planned', 'Actual']);
      viewButtons[0].click();
      expect(viewChanged).toHaveBeenLastCalledWith('planned');
      fixture.componentRef.setInput('view', 'planned');
      fixture.detectChanges();
      expect(viewButtons[0].getAttribute('aria-pressed')).toBe('true');
      expect(fixture.componentInstance.columns.map(column => column.field)).not.toContain('actualAssignedDays');
      expect(fixture.componentInstance.columns.map(column => column.field)).toContain('plannedDays');
      expect(fixture.componentInstance.rows.filter(row => row.kind === 'crew').map(row => row.crewLabel))
        .toEqual(['crew-1', 'crew-2', 'crew-3']);
      expect([...host.querySelectorAll('.cu-report__metrics dt')].map(element => element.textContent?.trim()))
        .toEqual(['Crew Groups', 'Avg. Planned Utilization']);
      expect(host.querySelectorAll('.cu-report__metrics > div')).toHaveLength(2);
      expect(host.querySelector('.cu-report__metrics')?.classList.contains('cu-report__metrics--planned')).toBe(true);
      viewButtons[1].click();
      expect(viewChanged).toHaveBeenLastCalledWith('actual');
      fixture.componentRef.setInput('view', 'actual');
      fixture.detectChanges();
      expect([...host.querySelectorAll('.cu-report__metrics dt')].map(element => element.textContent?.trim()))
        .toEqual(['Crew Groups', 'Actual Crews', 'Avg. Actual Utilization']);
      expect(host.querySelectorAll('.cu-report__metrics > div')).toHaveLength(3);
      expect(host.querySelector('.cu-report__metrics')?.classList.contains('cu-report__metrics--planned')).toBe(false);
      expect(fixture.componentInstance.rows.filter(row => row.kind === 'crew').map(row => row.crewLabel))
        .toEqual(['Crew 1', 'Crew 2', 'Crew 3']);
      expect(host.querySelectorAll('.cu-report__basis, .cu-report__footer, .cu-report__formulas, .cu-report__notes, .cu-report__legend'))
        .toHaveLength(0);
      expect(host.querySelector('.cu-report__table-actions')).toBeNull();
      expect(host.querySelector('.cu-report__notice')).toBeNull();
      expect(host.textContent).not.toContain('Filtered activities; crew capacity and reservations remain global.');
      expect(host.querySelector('button[aria-label="Expand all report groups"]')).toBeNull();
      expect(host.querySelector('button[aria-label="Collapse all report groups"]')).toBeNull();
      expect(host.querySelector('ag-grid-angular')).not.toBeNull();
      expect(host.querySelector('table')).toBeNull();
      expect(api.getRowNode(JSON.stringify(['G1']))?.expanded).toBe(false);
      api.getRowNode(JSON.stringify(['G1']))!.setExpanded(true);
      await vi.waitFor(() => expect(api.getDisplayedRowCount()).toBe(4));
      expect(api.getGridOption('domLayout')).toBe('autoHeight');
      api.applyColumnState({ state: [{ colId: 'crewId', sort: 'desc' }] });
      expect(api.getDisplayedRowAtIndex(1)?.data?.crewId).toBe('Crew 3');
      api.getRowNode(JSON.stringify(['G1']))!.setExpanded(false);
      await vi.waitFor(() => expect(api.getDisplayedRowCount()).toBe(1));
      fixture.detectChanges();
      expect(api.getPinnedBottomRowCount()).toBe(1);
      expect(api.getPinnedBottomRow(0)?.data).toMatchObject(report.totals);
      expect(JSON.stringify(fixture.componentInstance.report)).toBe(originalReport);
      fixture.componentRef.setInput('loading', true);
      fixture.detectChanges();
      expect(host.querySelector('ag-grid-angular')).toBeNull();
      expect(fixture.componentInstance.gridApi).toBeNull();
      expect(host.querySelector('output')?.textContent).toContain('Generating');
      expect(host.querySelector('output')?.getAttribute('aria-busy')).toBe('true');
      expect(host.querySelector('app-loader .loader--lg')?.getAttribute('src')).toBe('assets/images/Final_with_out_.gif');
      expect(host.querySelector<HTMLButtonElement>('.cu-report__export')?.disabled).toBe(true);
      fixture.componentRef.setInput('loading', false);
      fixture.componentRef.setInput('loadError', 'Unable to load crew data. Please retry.');
      fixture.detectChanges();
      expect(host.querySelector('ag-grid-angular')).toBeNull();
      expect(fixture.componentInstance.gridApi).toBeNull();
      expect(host.querySelector('app-loader')).toBeNull();
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('retry');
      expect(host.querySelector<HTMLButtonElement>('.cu-report__export')?.disabled).toBe(true);
      fixture.componentRef.setInput('loadError', null);
      fixture.componentRef.setInput('report', buildCrewUtilizationReport(calendar([]), '2026-09-01', '2026-09-30', '2026-09-21'));
      fixture.detectChanges();
      await vi.waitFor(() => expect(fixture.componentInstance.gridApi).not.toBeNull());
      expect(host.querySelector('app-loader')).toBeNull();
      expect(fixture.componentInstance.rows).toEqual([]);
      expect(fixture.componentInstance.totals).toEqual([]);
      expect(fixture.componentInstance.gridApi!.getGridOption('domLayout')).toBe('normal');
    } finally {
      fixture.destroy();
      TestBed.resetTestingModule();
    }
  });

  it('filters report columns by group, displayed crew label, numeric values and status without changing totals', async () => {
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = [
      { crewCode: 'Crew 1', activities: [activity('FULL', '2026-09-01', '2026-09-20',
        { actualStart: '2026-09-01', actualEnd: '2026-09-20' })] },
      { crewCode: 'Crew 2', activities: [activity('PART', '2026-09-01', '2026-09-10',
        { actualStart: '2026-09-01', actualEnd: '2026-09-05' })] },
      { crewCode: 'Crew 3', activities: [] },
    ];
    data.groups.push({ crewGroupCode: 'G2', activityCount: 0, completionPct: 0,
      crews: [{ crewCode: 'Other', activities: [] }] });
    const report = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-20', '2026-09-25');
    const snapshot = JSON.stringify(report);
    await TestBed.configureTestingModule({ imports: [CrewUtilizationReportComponent] }).compileComponents();
    const fixture = TestBed.createComponent(CrewUtilizationReportComponent);
    fixture.componentRef.setInput('report', report);
    fixture.detectChanges();
    try {
      await vi.waitFor(() => expect(fixture.componentInstance.gridApi).not.toBeNull());
      const api = fixture.componentInstance.gridApi!;
      await vi.waitFor(() => expect(api.getDisplayedRowCount()).toBe(2));
      const matchingCrews = () => {
        const crews: string[] = [];
        api.forEachNodeAfterFilter(node => {
          if (node.data?.kind === 'crew') crews.push(node.data.crewId);
        });
        return crews.sort();
      };
      const filter = async (column: string, model: object, expected: string[]) => {
        api.setFilterModel(null);
        await api.setColumnFilterModel(column, model);
        api.onFilterChanged();
        await vi.waitFor(() => expect(matchingCrews()).toEqual(expected));
      };
      expect(fixture.componentInstance.defaultColDef.floatingFilter).toBe(true);
      expect(fixture.componentInstance.columns.filter(column => column.type === 'numericColumn')
        .every(column => column.filter === 'agNumberColumnFilter')).toBe(true);
      const groupColumn = api.getAllDisplayedColumns()[0].getColId();
      await filter(groupColumn, { filterType: 'text', type: 'equals', filter: 'G1' }, ['Crew 1', 'Crew 2', 'Crew 3']);
      await filter('crewId', { filterType: 'text', type: 'contains', filter: 'Crew 2' }, ['Crew 2']);
      await filter('actualAssignedDays', { filterType: 'number', type: 'greaterThan', filter: 9 }, ['Crew 1']);
      await filter('utilization', { filterType: 'number', type: 'equals', filter: 25 }, ['Crew 2']);
      await filter('status', { filterType: 'text', type: 'equals', filter: 'Not utilized' }, ['Crew 3']);
      await filter('crewId', { filterType: 'text', type: 'equals', filter: 'missing' }, []);
      expect(api.getDisplayedRowCount()).toBe(0);
      api.setFilterModel(null);
      fixture.componentRef.setInput('view', 'planned');
      fixture.componentRef.setInput('report', buildCrewUtilizationReport(data, '2026-09-01', '2026-09-20', '2026-09-25', 'planned'));
      fixture.detectChanges();
      await filter(groupColumn, { filterType: 'text', type: 'equals', filter: 'G1' }, ['Crew 1', 'Crew 2', 'Crew 3']);
      await api.setColumnFilterModel('crewId', { filterType: 'text', type: 'equals', filter: 'crew-2' });
      api.onFilterChanged();
      await vi.waitFor(() => expect(matchingCrews()).toEqual(['Crew 2']));
      await filter('plannedDays', { filterType: 'number', type: 'equals', filter: 10 }, ['Crew 2']);
      api.setFilterModel(null);
      await vi.waitFor(() => expect(matchingCrews()).toEqual(['Crew 1', 'Crew 2', 'Crew 3', 'Other']));
      expect(api.getPinnedBottomRow(0)?.data).toMatchObject(fixture.componentInstance.report.totals);
      expect(JSON.stringify(report)).toBe(snapshot);
    } finally {
      fixture.destroy();
      TestBed.resetTestingModule();
    }
  });

  it.each(['planned', 'actual'] as const)('exports filtered and sorted %s crews, including collapsed groups, with recalculated totals', async view => {
    const data = calendar([]);
    data.roster = roster();
    data.roster.groups[0].crewGroupCode = 'BPL-0302';
    data.groups = [{ crewGroupCode: 'BPL-0302', activityCount: 2, completionPct: 0, crews: [
      { crewCode: 'Crew 1', activities: [activity('FULL', '2026-09-01', '2026-09-20',
        { actualStart: '2026-09-01', actualEnd: '2026-09-10' })] },
      { crewCode: 'Crew 2', activities: [activity('PART', '2026-09-01', '2026-09-10',
        { actualStart: '2026-09-01', actualEnd: '2026-09-05' })] },
      { crewCode: 'Crew 3', activities: [] },
    ] }, { crewGroupCode: 'OTHER', activityCount: 1, completionPct: 0, crews: [
      { crewCode: 'Historical', activities: [activity('UNKNOWN', '2026-09-01', '2026-09-02',
        { actualStart: '2026-09-01', actualEnd: '2026-09-01' })] },
    ] }];
    const report = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-20', '2026-09-25', view);
    const snapshot = JSON.stringify(report);
    const planned = view === 'planned';
    await TestBed.configureTestingModule({ imports: [CrewUtilizationReportComponent] }).compileComponents();
    const fixture = TestBed.createComponent(CrewUtilizationReportComponent);
    fixture.componentRef.setInput('report', report);
    fixture.componentRef.setInput('view', view);
    fixture.componentRef.setInput('exportView', planned ? 'Planned' : 'Actual');
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const host: HTMLElement = fixture.nativeElement;
    try {
      await vi.waitFor(() => expect(component.gridApi?.getDisplayedRowCount()).toBe(2));
      const api = component.gridApi!;
      const groupColumn = api.getAllDisplayedColumns()[0].getColId();
      const groupFilter = { [groupColumn]: { filterType: 'text', type: 'equals', filter: 'BPL-0302' } };
      const filter = async (model: object, count: number) => {
        api.setFilterModel(model);
        await vi.waitFor(() => expect(component.exportableCrewCount).toBe(count));
        fixture.detectChanges();
      };
      const workbookFor = async () => {
        const workbook = await component.createWorkbook();
        expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['Planned', 'Actual']);
        return workbook.getWorksheet(planned ? 'Planned' : 'Actual')!;
      };
      const summaryValues = (sheet: Awaited<ReturnType<typeof workbookFor>>, row: number) =>
        ['C', 'D', 'E', 'F', 'G'].map(column => sheet.getCell(`${column}${row}`).value);
      const originalPinned = JSON.stringify(api.getPinnedBottomRow(0)?.data);
      await filter(groupFilter, 3);
      expect(api.getRowNode(JSON.stringify(['BPL-0302']))?.expanded).toBe(false);
      expect(api.getDisplayedRowCount()).toBe(1);
      let sheet = await workbookFor();
      expect(sheet.getCell('A5').value).toBe(1);
      expect(sheet.getCell('B5').value).toBe(3);
      expect(sheet.getCell('C5').value).toBe(planned ? 0.5 : 0.25);
      expect([8, 9, 10].map(row => sheet.getCell(`A${row}`).value)).toEqual(['BPL-0302', 'BPL-0302', 'BPL-0302']);
      expect(summaryValues(sheet, 11)).toEqual([60, planned ? 30 : 15, planned ? 30 : 45, planned ? 0.5 : 0.25, 'Partially utilized']);
      expect(summaryValues(sheet, 12)).toEqual(summaryValues(sheet, 11));
      expect(sheet.rowCount).toBe(12);
      api.applyColumnState({ state: [{ colId: 'crewId', sort: 'desc' }], defaultState: { sort: null } });
      sheet = await workbookFor();
      expect([8, 9, 10].map(row => sheet.getCell(`B${row}`).value))
        .toEqual(planned ? ['crew-3', 'crew-2', 'crew-1'] : ['Crew 3', 'Crew 2', 'Crew 1']);
      await filter({ ...groupFilter, crewId: { filterType: 'text', type: 'equals', filter: planned ? 'crew-2' : 'Crew 2' } }, 1);
      sheet = await workbookFor();
      expect(sheet.getCell('B8').value).toBe(planned ? 'crew-2' : 'Crew 2');
      expect(sheet.getCell('B5').value).toBe(1);
      expect(summaryValues(sheet, 10)).toEqual([20, planned ? 10 : 5, planned ? 10 : 15, planned ? 0.5 : 0.25, 'Partially utilized']);
      expect(sheet.rowCount).toBe(10);
      const daysColumn = planned ? 'plannedDays' : 'actualAssignedDays';
      await filter({ [daysColumn]: { filterType: 'number', type: 'greaterThan', filter: planned ? 10 : 5 } }, 1);
      sheet = await workbookFor();
      expect(sheet.getCell('B8').value).toBe(planned ? 'crew-1' : 'Crew 1');
      expect(sheet.getCell('G10').value).toBe(planned ? 'Fully utilized' : 'Partially utilized');
      await filter({ status: { filterType: 'text', type: 'equals', filter: 'Not utilized' } }, 1);
      sheet = await workbookFor();
      expect(sheet.getCell('B8').value).toBe(planned ? 'crew-3' : 'Crew 3');
      expect(summaryValues(sheet, 10)).toEqual([20, 0, 20, 0, 'Not utilized']);
      await filter({ status: { filterType: 'text', type: 'equals', filter: 'N/A' } }, 1);
      sheet = await workbookFor();
      expect(summaryValues(sheet, 10)).toEqual(['N/A', planned ? 2 : 1, 'N/A', 'N/A', 'N/A']);
      expect(sheet.getCell('C5').value).toBe('N/A');
      await filter({ crewId: { filterType: 'text', type: 'equals', filter: 'no-such-crew' } }, 0);
      expect(host.querySelector<HTMLButtonElement>('.cu-report__export')?.disabled).toBe(true);
      await expect(component.createWorkbook()).rejects.toThrow('No crews match');
      const create = vi.spyOn(component, 'createWorkbook');
      await component.exportExcel();
      expect(create).not.toHaveBeenCalled();
      create.mockRestore();
      await filter({}, 4);
      expect(host.querySelector<HTMLButtonElement>('.cu-report__export')?.disabled).toBe(false);
      api.applyColumnState({ state: [{ colId: groupColumn, sort: 'desc' }], defaultState: { sort: null } });
      sheet = await workbookFor();
      expect(sheet.getCell('A8').value).toBe('OTHER');
      expect(sheet.getCell('B8').value).toBe(planned ? 'crew-1' : 'Historical');
      expect(sheet.getCell('A10').value).toBe('BPL-0302');
      expect(sheet.getCell('B10').value).toBe(planned ? 'crew-3' : 'Crew 3');
      expect(sheet.getCell('A5').value).toBe(2);
      expect(sheet.getCell('B5').value).toBe(4);
      expect(summaryValues(sheet, 14)).toEqual([60, planned ? 32 : 16, planned ? 30 : 45, planned ? 0.5 : 0.25, 'Partially utilized']);
      expect(sheet.getCell('F14').note).toBe(component.partialTotalsNote);
      expect(JSON.stringify(api.getPinnedBottomRow(0)?.data)).toBe(originalPinned);
      expect(JSON.stringify(report)).toBe(snapshot);
    } finally {
      fixture.destroy();
      TestBed.resetTestingModule();
    }
  });

  it.each(['planned', 'actual'] as const)('exports %s columns on their own sheet with matching totals, labels and statuses', async view => {
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [activity('A', '2026-09-01', '2026-09-20', {
      actualStart: '2026-09-01', actualEnd: '2026-09-19',
    })] }, { crewCode: 'Crew 2', activities: [] }];
    const component = new CrewUtilizationReportComponent({ markForCheck: vi.fn() } as any);
    component.view = view;
    component.report = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-20', '2026-09-21', view);
    component.scopeLabel = 'Nimr / Nimr ODC';
    component.selectionLabel = view === 'planned' ? 'Assigned | Planned' : 'Assigned | Actual';
    const workbook = await component.createWorkbook();
    const planned = view === 'planned';
    const sheetName = planned ? 'Planned' : 'Actual';
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['Planned', 'Actual']);
    const sheet = workbook.getWorksheet(sheetName)!;
    const average = planned ? 0.5 : 0.475;
    expect(sheet.columnCount).toBe(7);
    expect(sheet.getCell('C4').text).toBe(planned ? 'Avg. Planned Utilization' : 'Avg. Actual Utilization');
    expect(sheet.getCell('C5').value).toBe(average);
    expect(sheet.getCell('C5').numFmt).toBe('0.0%');
    expect(sheet.getCell('D5').value).toBeNull();
    expect(sheet.getRow(7).values).toEqual([undefined, 'Crew Group', planned ? 'Crew' : 'Actual Crew ID',
      'Available Days', planned ? 'Planned Days' : 'Actual Assigned Days', 'Idle Days', 'Utilization %', 'Status']);
    for (const column of ['A', 'B', 'C']) {
      expect(sheet.getCell(`${column}4`).alignment).toMatchObject({ horizontal: 'left', vertical: 'middle', wrapText: true });
      expect(sheet.getCell(`${column}5`).alignment).toMatchObject({ horizontal: 'left', vertical: 'middle' });
    }
    for (const column of ['C', 'D', 'E', 'F']) {
      expect(sheet.getCell(`${column}7`).alignment).toMatchObject({ horizontal: 'right', vertical: 'middle', wrapText: true });
      expect(sheet.getCell(`${column}8`).alignment).toMatchObject({ horizontal: 'right', vertical: 'middle' });
    }
    expect(sheet.getCell('B8').alignment).toMatchObject({ horizontal: 'left', vertical: 'middle', wrapText: true });
    expect(sheet.getCell('G8').alignment).toMatchObject({ horizontal: 'left', vertical: 'middle', wrapText: true });
    expect(sheet.getCell('A2').alignment).toMatchObject({ horizontal: 'left', vertical: 'middle', wrapText: true });
    expect(sheet.getCell('C8').numFmt).toBe('#,##0');
    expect(sheet.getRow(7).height).toBe(36);
    expect(sheet.getRow(8).height).toBe(30);
    expect(sheet.getCell('B8').value).toBe(planned ? 'crew-1' : 'Crew 1');
    expect(sheet.getCell('D8').value).toBe(planned ? 20 : 19);
    expect(sheet.getCell('F8').value).toBe(planned ? 1 : 0.95);
    expect(sheet.getCell('G8').value).toBe(planned ? 'Fully utilized' : 'Partially utilized');
    expect(sheet.getCell('C10').value).toBe(40);
    expect(sheet.getCell('D10').value).toBe(planned ? 20 : 19);
    expect(sheet.getCell('F11').value).toBe(average);
    expect(sheet.rowCount).toBe(11);
    expect(sheet.lastRow?.getCell(1).text).toBe('GRAND TOTAL - All Selected Crew Groups');
    expect(sheet.getCell('A2').text).toContain('Nimr / Nimr ODC');
    for (let rowNumber = 7; rowNumber <= sheet.rowCount; rowNumber++) {
      expect(sheet.getCell(`F${rowNumber}`).isMerged).toBe(false);
      expect(sheet.getCell(`G${rowNumber}`).isMerged).toBe(false);
      expect(sheet.getCell(`F${rowNumber}`).border.right).toEqual({ style: 'thin', color: { argb: 'FFD7DFED' } });
      expect(sheet.getCell(`G${rowNumber}`).alignment.indent).toBe(1);
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const ExcelJS = await import('exceljs');
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer);
    expect(reopened.worksheets.map(sheet => sheet.name)).toEqual(['Planned', 'Actual']);
    expect(reopened.getWorksheet(sheetName)!.getCell('C5').value).toBe(average);
    expect(reopened.getWorksheet(sheetName)!.getCell('C8').alignment).toMatchObject({ horizontal: 'right', vertical: 'middle' });
    expect(reopened.getWorksheet(sheetName)!.getCell('B8').alignment).toMatchObject({ horizontal: 'left', vertical: 'middle', wrapText: true });
    expect(reopened.getWorksheet(sheetName)!.getCell('C11').alignment).toMatchObject({ horizontal: 'right', vertical: 'middle' });
    expect(reopened.getWorksheet(sheetName)!.getCell('D11').value).toBe(planned ? 20 : 19);
    expect(reopened.getWorksheet(sheetName)!.rowCount).toBe(11);
    expect(reopened.getWorksheet(sheetName)!.getCell('F11').border.right)
      .toEqual({ style: 'thin', color: { argb: 'FFD7DFED' } });
    expect(reopened.getWorksheet(sheetName)!.getCell('G11').alignment.indent).toBe(1);
  });

  it('renders partial subtotal and grand-total values without hiding unknown-crew activity days', async () => {
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = [
      { crewCode: 'Crew 1', activities: [activity('KNOWN', '2026-09-01', '2026-09-15', {
        actualStart: '2026-09-01', actualEnd: '2026-09-15',
      })] },
      { crewCode: 'Historical', activities: [activity('UNKNOWN', '2026-09-01', '2026-09-02', {
        actualStart: '2026-09-01', actualEnd: '2026-09-02',
      })] },
    ];
    const report = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-21');
    const originalReport = JSON.stringify(report);
    await TestBed.configureTestingModule({ imports: [CrewUtilizationReportComponent] }).compileComponents();
    const fixture = TestBed.createComponent(CrewUtilizationReportComponent);
    fixture.componentRef.setInput('report', report);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    try {
      await vi.waitFor(() => expect(fixture.componentInstance.gridApi).not.toBeNull());
      const api = fixture.componentInstance.gridApi!;
      await vi.waitFor(() => expect(api.getDisplayedRowCount()).toBe(1));
      expect(host.querySelectorAll('.cu-report__metrics dd')[2].textContent?.trim()).toBe('50%');
      expect(api.getPinnedBottomRow(0)?.data).toMatchObject({ availableDays: 30, plannedDays: 17,
        actualAssignedDays: 17, idleDays: 15, utilization: 50, status: 'Partially utilized', unknownCapacity: 1 });
      expect(api.getRowNode(JSON.stringify(['G1']))?.data).toMatchObject(report.totals);
      const label = fixture.componentInstance.autoGroupColumnDef.cellRendererParams.innerRenderer({ data: api.getPinnedBottomRow(0)?.data });
      expect(label.textContent).toContain('Partial capacity');
      expect(host.querySelector('.cu-report__notice')).toBeNull();
      expect(JSON.stringify(fixture.componentInstance.report)).toBe(originalReport);
      const unknownReport = buildCrewUtilizationReport({ ...data, roster: undefined }, '2026-09-01', '2026-09-30', '2026-09-21');
      fixture.componentRef.setInput('report', unknownReport);
      fixture.detectChanges();
      expect(host.querySelector('.cu-report__notice')).toBeNull();
      expect(host.querySelectorAll('.cu-report__metrics dd')[2].textContent?.trim()).toBe('N/A');
    } finally {
      fixture.destroy();
      TestBed.resetTestingModule();
    }
  });

  it('writes Excel-compatible worksheet property order while retaining crew outlines and print settings', async () => {
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = data.roster.groups[0].crews.map(crew => ({ crewCode: crew.crewUid, activities: [] }));
    const component = new CrewUtilizationReportComponent({ markForCheck: vi.fn() } as any);
    component.report = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-21');
    const workbook = await component.createWorkbook();
    const JSZip = (await import('jszip')).default;
    const archive = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
    const xml = new DOMParser().parseFromString(await archive.file('xl/worksheets/sheet1.xml')!.async('string'), 'application/xml');
    expect(xml.getElementsByTagName('parsererror')).toHaveLength(0);
    const properties = xml.getElementsByTagName('sheetPr').item(0)!;
    const childNames = [...properties.children].map(child => child.localName);
    const schemaOrder = ['tabColor', 'outlinePr', 'pageSetUpPr'];
    expect(childNames).toEqual([...childNames].sort((first, second) => schemaOrder.indexOf(first) - schemaOrder.indexOf(second)));
    expect(xml.getElementsByTagName('pageSetUpPr').item(0)?.getAttribute('fitToPage')).toBe('1');
    expect(xml.getElementsByTagName('pageSetup').item(0)?.getAttribute('orientation')).toBe('landscape');
    expect(xml.getElementsByTagName('pane').item(0)?.getAttribute('ySplit')).toBe('7');
    expect([...xml.getElementsByTagName('row')].filter(row => row.getAttribute('outlineLevel') === '1')).toHaveLength(3);
  });

  it('exports numeric partial totals and explains why their utilization excludes unknown-capacity actual days', async () => {
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = [
      { crewCode: 'Crew 1', activities: [activity('KNOWN', '2026-09-01', '2026-09-20', {
        actualStart: '2026-09-01', actualEnd: '2026-09-19',
      })] },
      { crewCode: 'Historical', activities: [activity('UNKNOWN', '2026-09-01', '2026-09-02', {
        actualStart: '2026-09-01', actualEnd: '2026-09-02',
      })] },
    ];
    const component = new CrewUtilizationReportComponent({ markForCheck: vi.fn() } as any);
    component.report = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-20', '2026-09-21');
    const workbook = await component.createWorkbook();
    const sheet = workbook.getWorksheet('Actual')!;
    expect(sheet.getCell('C9').value).toBe('N/A');
    expect(sheet.getCell('D9').value).toBe(2);
    expect(sheet.getCell('C5').value).toBe(0.95);
    expect(sheet.getCell('D5').value).toBeNull();
    for (const rowNumber of [10, 11]) {
      expect(sheet.getCell(`A${rowNumber}`).text).toContain('(partial capacity)');
      expect(['C', 'D', 'E', 'F', 'G'].map(column => sheet.getCell(`${column}${rowNumber}`).value))
        .toEqual([20, 21, 1, 0.95, 'Partially utilized']);
      expect(sheet.getCell(`F${rowNumber}`).note).toBe(component.partialTotalsNote);
    }
    const ExcelJS = await import('exceljs');
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
    expect(reopened.getWorksheet('Actual')!.getCell('F11').value).toBe(0.95);
    expect(reopened.getWorksheet('Actual')!.rowCount).toBe(11);
    expect(reopened.getWorksheet('Actual')!.lastRow?.getCell(1).text)
      .toBe('GRAND TOTAL - All Selected Crew Groups (partial capacity)');
  });

  it.each([
    ['', 'Actual', 'All-clusters_Planned-Actual'],
    ['Amal', 'Planned', 'Amal_Planned-Actual'],
    ['Marmul', 'Actual', 'Marmul_Planned-Actual'],
    ['Nimr', 'Unassigned', 'Nimr_Planned-Actual'],
    [' A/B: North? ', 'Planned + Actual', 'A-B-North_Planned-Actual'],
  ])('names the export using cluster %s, view %s, applied dates and UTC timestamp', (cluster, view, scope) => {
    const component = new CrewUtilizationReportComponent({ markForCheck: vi.fn() } as any);
    component.report = buildCrewUtilizationReport(calendar([]), '2026-09-01', '2026-09-30', '2026-09-25');
    component.exportCluster = cluster;
    component.exportView = view;
    const filename = (component as any).exportFileName(new Date('2026-09-25T06:01:02.003Z'));
    expect(filename).toBe(`Crew_Utilization_${scope}_2026-09-01_2026-09-30_2026-09-25T06-01-02-003Z.xlsx`);
    expect(filename).not.toMatch(/[<>:"/\\|?*]/);
    expect((component as any).exportFileName(new Date('2026-09-25T06:01:02.004Z'))).not.toBe(filename);
  });

  it('writes both sheets from independent datasets using the same filtered crews without renumbering or switching views', async () => {
    const data = calendar([]);
    data.roster = roster();
    data.groups[0].crews = [
      { crewCode: 'Crew 1', activities: [activity('PLAN1', '2026-09-01', '2026-09-20')] },
      { crewCode: 'Crew 2', activities: [activity('PLAN2', '2026-09-01', '2026-09-10')] },
      { crewCode: 'Crew 3', activities: [] },
    ];
    const actualData = { ...data, groups: [{ ...data.groups[0], crews: [
      { crewCode: 'Crew 1', activities: [] },
      { crewCode: 'Crew 2', activities: [activity('ACTUAL-ONLY', '', '',
        { actualStart: '2026-09-06', actualEnd: '2026-09-10' })] },
      { crewCode: 'Crew 3', activities: [] },
    ] }] };
    const component = new CrewUtilizationReportComponent({ markForCheck: vi.fn() } as any);
    component.plannedReport = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-20', '2026-09-25', 'planned');
    component.actualReport = buildCrewUtilizationReport(actualData, '2026-09-01', '2026-09-20', '2026-09-25', 'actual');
    component.report = component.actualReport;
    component.view = 'actual';
    component.ngOnChanges();
    const before = JSON.stringify([component.plannedReport, component.actualReport]);
    vi.spyOn(component as any, 'exportRows').mockReturnValue(component.rows.filter(row => row.crewId === 'Crew 2'));
    const workbook = await component.createWorkbook();
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['Planned', 'Actual']);
    const planned = workbook.getWorksheet('Planned')!;
    const actual = workbook.getWorksheet('Actual')!;
    expect(planned.getCell('B8').value).toBe('crew-2');
    expect(actual.getCell('B8').value).toBe('Crew 2');
    expect(planned.getCell('D7').value).toBe('Planned Days');
    expect(actual.getCell('D7').value).toBe('Actual Assigned Days');
    expect(planned.getCell('D8').value).toBe(10);
    expect(actual.getCell('D8').value).toBe(5);
    expect(planned.getCell('F8').value).toBe(0.5);
    expect(actual.getCell('F8').value).toBe(0.25);
    expect(planned.getCell('E10').value).toBe(10);
    expect(actual.getCell('E10').value).toBe(15);
    expect(planned.getCell('B5').value).toBe(1);
    expect(actual.getCell('B5').value).toBe(1);
    expect(planned.getCell('C5').value).toBe(0.5);
    expect(actual.getCell('C5').value).toBe(0.25);
    expect(planned.rowCount).toBe(10);
    expect(actual.rowCount).toBe(10);
    expect(component.view).toBe('actual');
    expect(JSON.stringify([component.plannedReport, component.actualReport])).toBe(before);
  });

  it('keeps export retryable after a failure and prevents duplicate export submissions', async () => {
    const data = calendar([]);
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [] }];
    const component = new CrewUtilizationReportComponent({ markForCheck: vi.fn() } as any);
    component.report = buildCrewUtilizationReport(data, '2026-09-01', '2026-09-30', '2026-09-21');
    const create = vi.spyOn(component, 'createWorkbook').mockRejectedValue(new Error('test export failure'));
    component.exporting = true;
    await component.exportExcel();
    expect(create).not.toHaveBeenCalled();
    component.exporting = false;
    await component.exportExcel();
    expect(create).toHaveBeenCalledOnce();
    expect(component.exporting).toBe(false);
    expect(component.exportError).toContain('try again');
  });

  it('fills the first crew, respects inclusive overlaps, and retains empty crews without mutating source data', () => {
    const data = calendar([activity('A', '2026-09-01', '2026-09-10'), activity('B', '2026-09-08', '2026-09-15'),
      activity('C', '2026-09-11', '2026-09-20')]);
    const before = JSON.stringify(data);
    const result = buildCrewCalendarPlan(data, roster());
    expect(result.groups[0].crews.map(crew => [crew.crewCode, crew.activities.map(item => item.activityCode)]))
      .toEqual([['Crew 1', ['A', 'C']], ['Crew 2', ['B']], ['Crew 3', []]]);
    expect(result.groups[0].crews[0].activities.every(item => item.proposed)).toBe(true);
    expect(JSON.stringify(data)).toBe(before);
    expect(buildCrewCalendarPlan(data, roster())).toEqual(result);
  });

  it('fills the first crew through month end when real activities fit and uses each activity once', () => {
    const data = calendar([
      activity('A', '2026-09-01', '2026-09-10'), activity('B', '2026-09-11', '2026-09-20'),
      activity('C', '2026-09-21', '2026-09-30'), activity('OVERLAP', '2026-09-08', '2026-09-15'),
    ]);
    const result = buildCrewCalendarPlan(data, roster());
    expect(result.groups[0].crews.map(crew => crew.activities.map(item => item.activityCode)))
      .toEqual([['A', 'B', 'C'], ['OVERLAP'], []]);
    expect(result.totalActivities).toBe(4);
    expect(bookedDaysInWindow(result.groups[0].crews[0].activities, '2026-09-01', '2026-09-30')).toBe(30);
  });

  it('allocates a real activity only to crews in its own group even when other groups have free crews', () => {
    const data = calendar([]);
    data.groups.push({ crewGroupCode: 'G2', activityCount: 1, completionPct: 0,
      crews: [{ crewCode: '', activities: [activity('OTHER-GROUP', '2026-09-01', '2026-09-30')] }] });
    const members = roster();
    const unallocated = buildCrewCalendarPlan(data, members);
    expect(unallocated.groups.find(group => group.crewGroupCode === 'G1')?.crews.every(crew => !crew.activities.length)).toBe(true);
    expect(unallocated.groups.find(group => group.crewGroupCode === 'G2')?.crews[0].crewCode).toBe('');
    members.groups.push({ crewGroupCode: 'G2', crewGroupName: 'Other category',
      crews: [{ crewUid: 'G2-Crew 1', crewTypeCode: 'G2', bookings: [] }] });
    const allocated = buildCrewCalendarPlan(data, members);
    expect(allocated.groups.find(group => group.crewGroupCode === 'G2')?.crews[0]).toMatchObject({
      crewCode: 'G2-Crew 1', activities: [expect.objectContaining({ activityCode: 'OTHER-GROUP',
        plannedStart: '2026-09-01', plannedEnd: '2026-09-30', proposed: true })],
    });
    expect(allocated.totalActivities).toBe(1);
  });

  it('leaves September 10, 18 and 20 free when no remaining real activity fits', () => {
    const members = roster();
    members.groups[0].crews[2].bookings = [{ plannedStart: '2026-09-25', plannedEnd: '2026-09-30' }];
    const saved = [
      activity('A', '2026-09-01', '2026-09-09'),
      activity('B', '2026-09-11', '2026-09-17'),
      activity('C', '2026-09-19', '2026-09-19'),
      activity('D', '2026-09-21', '2026-09-24'),
    ];
    const data = calendar([]);
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: saved }];
    const result = buildCrewCalendarPlan({ ...data, roster: members }, members);
    const first = result.groups[0].crews.find(crew => crew.crewCode === 'Crew 1')!;
    expect(first.activities).toEqual(saved);
    expect(bookedDaysInWindow([...first.activities, ...first.bookings!], '2026-09-01', '2026-09-30')).toBe(27);
    expect(result.groups[0].crews.slice(1).every(crew => crew.activities.length === 0)).toBe(true);
    const restored = buildCrewCalendarPlan({ ...data, roster: members }, members, result.groups);
    expect(restored).toEqual(result);
  });

  it('leaves real demand unassigned when eligible crews are fully reserved', () => {
    const members = roster();
    members.groups[0].crews.forEach(crew => crew.bookings = [{ plannedStart: '2026-09-01', plannedEnd: '2026-09-30' }]);
    const data = calendar([activity('REAL', '2026-09-05', '2026-09-06')]);
    data.groups[0].crews.push({ crewCode: 'HISTORICAL', activities: [] });
    const plan = buildCrewCalendarPlan({ ...data, roster: members }, members);
    expect(plan.totalActivities).toBe(1);
    expect(plan.groups[0].crews.find(crew => !crew.crewCode)?.activities[0].activityCode).toBe('REAL');
    expect(plan.groups[0].crews.filter(crew => crew.crewCode).every(crew => !crew.activities.length)).toBe(true);
  });

  it('ignores cached placeholders and cached activities that are absent from the current source group', () => {
    const members = roster();
    const cached = calendar([]);
    cached.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
      activity('G1', '2026-09-01', '2026-09-30', { source: 'draft', proposed: true }),
      activity('REMOVED', '2026-09-01', '2026-09-30', { source: 'legacy', proposed: true }),
    ] }];
    const result = buildCrewCalendarPlan({ ...calendar([]), roster: members }, members, cached.groups);
    expect(result.totalActivities).toBe(0);
    expect(result.groups[0].crews).toHaveLength(3);
    expect(result.groups[0].crews.every(crew => crew.activities.length === 0)).toBe(true);
  });

  it('retains real allocations across service recreation and drops old generated cache entries', () => {
    const storage = new StorageService();
    vi.spyOn(storage, 'getItem').mockReturnValue(JSON.stringify({ userId: 21, tenantId: 5 }));
    const service = new CrewCalendarService({} as any, storage);
    const members = roster();
    const plan = buildCrewCalendarPlan({ ...calendar([activity('REAL', '2026-09-05', '2026-09-06')]), roster: members }, members);
    const expected = plan.groups[0].crews.filter(crew => crew.activities.length).map(crew => crew.activities);
    const scope = { from: '2026-09-01', to: '2026-09-30', project: 'P1' };
    try {
      expect(service.saveSessionPlan(scope, plan)).toBe(true);
      const recreated = new CrewCalendarService({} as any, storage);
      expect(recreated.getSessionPlan(scope)[0].crews.map(crew => crew.activities)).toEqual(expected);
      const cacheKey = Object.keys(sessionStorage).find(key => key.startsWith(APP_CONSTANTS.STORAGE_KEYS.CREW_CALENDAR_SESSION))!;
      const olderCache = JSON.parse(sessionStorage.getItem(cacheKey)!);
      olderCache.activities.push(activity('PLACEHOLDER', '', '', { source: 'draft', proposed: true }));
      olderCache.bookings.push(['G1', 'Crew 3', olderCache.activities.length - 1, '2026-09-01', '2026-09-30']);
      sessionStorage.setItem(cacheKey, JSON.stringify(olderCache));
      expect(recreated.getSessionPlan(scope)[0].crews.map(crew => crew.activities)).toEqual(expected);
      expect(recreated.saveSessionPlan(scope, plan)).toBe(true);
      expect(JSON.parse(sessionStorage.getItem(cacheKey)!).activities.every((item: CalendarActivity) => item.source !== 'draft')).toBe(true);
      expect(recreated.getSessionPlan({ ...scope, project: 'P2' })).toEqual([]);
      expect(recreated.getSessionPlan({ ...scope, to: '2026-10-31' })).toEqual([]);
      vi.mocked(storage.getItem).mockReturnValue(JSON.stringify({ userId: 22, tenantId: 5 }));
      expect(recreated.getSessionPlan(scope)).toEqual([]);
      vi.mocked(storage.getItem).mockReturnValue(JSON.stringify({ userId: 21, tenantId: 6 }));
      expect(recreated.getSessionPlan(scope)).toEqual([]);
      vi.mocked(storage.getItem).mockReturnValue(JSON.stringify({ userId: 21, tenantId: 5 }));
      storage.clearSessionItems(APP_CONSTANTS.STORAGE_KEYS.CREW_CALENDAR_SESSION);
      expect(recreated.getSessionPlan(scope)).toEqual([]);
    } finally {
      storage.clearSessionItems(APP_CONSTANTS.STORAGE_KEYS.CREW_CALENDAR_SESSION);
    }
  });

  it('clears calendar session plans on logout without clearing unrelated browser session state', () => {
    const storage = new StorageService();
    const clear = vi.spyOn(storage, 'clearSessionItems');
    vi.spyOn(storage, 'removeItem').mockImplementation(() => {});
    const prefix = APP_CONSTANTS.STORAGE_KEYS.CREW_CALENDAR_SESSION;
    sessionStorage.setItem(prefix + 'test', '{}');
    sessionStorage.setItem('unrelated-calendar-test', 'keep');
    try {
      const auth = new AuthService({} as any, { clearTokens: vi.fn(), getRefreshToken: () => null } as any, { clear: vi.fn() } as any,
        storage, { clearCache: vi.fn() } as any, { clearCache: vi.fn() } as any,
        { clearCache: vi.fn() } as any, { clear: vi.fn() } as any);
      auth.logout();
      expect(clear).toHaveBeenCalledWith(prefix);
      expect(sessionStorage.getItem(prefix + 'test')).toBeNull();
      expect(sessionStorage.getItem('unrelated-calendar-test')).toBe('keep');
    } finally {
      sessionStorage.removeItem(prefix + 'test');
      sessionStorage.removeItem('unrelated-calendar-test');
    }
  });

  it('replans cached proposals onto the first currently free crew when roster or bookings change', () => {
    const members = roster();
    const data = { ...calendar([activity('REAL', '2026-09-01', '2026-09-02')]), roster: members };
    const retained = buildCrewCalendarPlan(data, members);
    const changed = roster();
    changed.groups[0].crews.push({ crewUid: 'Crew 0', crewTypeCode: 'G1', bookings: [] });
    const result = buildCrewCalendarPlan({ ...data, roster: changed }, changed, retained.groups);
    expect(result.groups[0].crews.find(crew => crew.crewCode === 'Crew 0')?.activities)
      .toEqual(retained.groups[0].crews[0].activities);
    expect(result.groups[0].crews.find(crew => crew.crewCode === 'Crew 1')?.activities).toEqual([]);
    changed.groups[0].crews.find(crew => crew.crewUid === 'Crew 0')!.bookings =
      [{ plannedStart: '2026-09-01', plannedEnd: '2026-09-02' }];
    const refreshed = buildCrewCalendarPlan({ ...data, roster: changed }, changed, retained.groups);
    expect(refreshed.groups[0].crews.find(crew => crew.crewCode === 'Crew 0')?.activities).toEqual([]);
    expect(refreshed.groups[0].crews.find(crew => crew.crewCode === 'Crew 1')?.activities[0]).toMatchObject({
      activityCode: 'REAL', plannedStart: '2026-09-01', plannedEnd: '2026-09-02',
    });
    changed.groups[0].crews.find(crew => crew.crewUid === 'Crew 1')!.bookings =
      [{ plannedStart: '2026-09-01', plannedEnd: '2026-09-02' }];
    const next = buildCrewCalendarPlan({ ...data, roster: changed }, changed, retained.groups);
    expect(next.groups[0].crews.find(crew => crew.crewCode === 'Crew 2')?.activities[0]).toMatchObject({
      activityCode: 'REAL', proposed: true,
    });
    expect(next.totalActivities).toBe(1);
  });

  it('gives a newly added earlier activity priority over a later cached preview', () => {
    const members = roster();
    const retained = buildCrewCalendarPlan(calendar([
      activity('LATE', '2026-09-10', '2026-09-20'),
    ]), members);
    const updated = calendar([
      activity('LATE', '2026-09-10', '2026-09-20'),
      activity('EARLY', '2026-09-01', '2026-09-15'),
    ]);
    const result = buildCrewCalendarPlan(updated, members, retained.groups);
    expect(result.groups[0].crews.map(crew => crew.activities.map(item => item.activityCode)))
      .toEqual([['EARLY'], ['LATE'], []]);
    expect(result.groups[0].crews[0].activities[0].proposed).toBe(true);
  });

  it('does not restore a cached proposal when the same activity has since been saved to another crew', () => {
    const members = roster();
    const data = calendar([activity('REAL', '2026-09-01', '2026-09-02')]);
    const cached = buildCrewCalendarPlan(data, members);
    data.groups[0].crews.push({ crewCode: 'Crew 2', activities: [
      activity('REAL', '2026-09-01', '2026-09-02', { source: 'assignment' }),
    ] });
    const result = buildCrewCalendarPlan(data, members, cached.groups);
    expect(result.totalActivities).toBe(1);
    expect(result.groups[0].crews.find(crew => crew.crewCode === 'Crew 1')?.activities).toEqual([]);
    expect(result.groups[0].crews.find(crew => crew.crewCode === 'Crew 2')?.activities[0].source).toBe('assignment');
  });

  it('caches the real allocation while displaying partially booked and empty crew rows', () => {
    const calendarService = { saveSessionPlan: vi.fn() };
    const component = new ActivityBreakdownComponent({} as any, {} as any,
      { detectChanges: vi.fn() } as any, {} as any, {} as any, calendarService as any, {} as any);
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const scope = { from: '2026-09-01', to: '2026-09-30', project: 'FILTERED-PROJECT' };
    (component as any).applyCalendarData({ ...calendar([activity('REAL', '2026-09-01', '2026-09-10')]), roster: roster(), planningScope: scope });
    expect(component.crewGroups[0].wells.map(crew => crew.percent)).toEqual([33, 0, 0]);
    expect(component.crewGroups[0].wells[0].activities[0].bar.proposed).toBe(true);
    expect(component.crewGroups[0].wells.slice(1).every(crew => crew.noActivities)).toBe(true);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 3, 10 / 90 * 100, 0]);
    expect(calendarService.saveSessionPlan).toHaveBeenCalledOnce();
    expect(calendarService.saveSessionPlan).toHaveBeenCalledWith(scope, expect.any(Object));
  });

  it('loads calendar planning without fetching an activity catalogue', () => {
    const scope = { from: '2026-09-01', to: '2026-09-30', includeRoster: true };
    const data = { ...calendar([]), roster: roster() };
    const api = { get: vi.fn(() => of({ data })) };
    const storage = new StorageService();
    vi.spyOn(storage, 'getItem').mockReturnValue(null);
    const service = new CrewCalendarService(api as any, storage);
    let response: CrewCalendarData | undefined;
    service.getCalendar(scope).subscribe(result => response = result);
    expect(api.get).toHaveBeenCalledOnce();
    expect(api.get).toHaveBeenCalledWith('/crews/calendar', expect.anything());
    expect(response).toMatchObject({ ...data, groups: [], totalGroups: 0, actualGroups: data.groups,
      planningScope: scope, retainedPlan: [] });
  });

  it('keeps September 9-10 free when the only nearby activity also requires the occupied September 8', () => {
    const data = calendar([
      activity('FLEI1290-28095', '2026-09-07', '2026-09-08'),
      activity('FLCO1020-28095', '2026-09-08', '2026-09-09'),
      activity('FLEI1250-28137', '2026-09-11', '2026-09-11'),
    ]);
    const result = buildCrewCalendarPlan(data, roster());
    const firstCrew = result.groups[0].crews.find(crew => crew.crewCode === 'Crew 1')!;
    const secondCrew = result.groups[0].crews.find(crew => crew.crewCode === 'Crew 2')!;
    expect(firstCrew.activities.map(item => item.activityCode)).toEqual(['FLEI1290-28095', 'FLEI1250-28137']);
    expect(bookedDaysInWindow(firstCrew.activities, '2026-09-09', '2026-09-10')).toBe(0);
    expect(secondCrew.activities).toEqual([expect.objectContaining({
      activityCode: 'FLCO1020-28095', plannedStart: '2026-09-08', plannedEnd: '2026-09-09', proposed: true,
    })]);
  });

  it('preserves recorded crew assignments and reserves bookings outside the visible activity scope', () => {
    const data = calendar([activity('NEW', '2026-09-05', '2026-09-06')]);
    data.groups[0].crews.push({ crewCode: 'Crew 2', activities: [activity('SAVED', '2026-09-01', '2026-09-10')] });
    const crews = roster();
    crews.groups[0].crews[2].bookings.push({ plannedStart: '2026-09-01', plannedEnd: '2026-09-10' });
    const result = buildCrewCalendarPlan(data, crews);
    expect(result.groups[0].crews[1].activities[0]).toMatchObject({ activityCode: 'SAVED' });
    expect(result.groups[0].crews[1].activities[0].proposed).toBeUndefined();
    expect(result.groups[0].crews[2].activities[0]).toMatchObject({ activityCode: 'NEW', proposed: true });
  });

  it('starts another planning round for excess demand but leaves missing-crew actual work unallocated', () => {
    const data = calendar(['A', 'B', 'C', 'D'].map(code => activity(code, '2026-09-01', '2026-09-30')));
    data.groups[0].crews[0].activities.push(activity('ACTUAL', '2026-09-01', '2026-09-02', { actualStart: '2026-09-01' }));
    const result = buildCrewCalendarPlan(data, roster());
    expect(result.groups[0].crews.find(crew => !crew.crewCode)?.activities.map(item => item.activityCode)).toEqual(['ACTUAL']);
    expect(result.groups[0].crews.find(crew => crew.crewCode === 'Crew 1')?.activities.map(item => item.activityCode))
      .toEqual(['A', 'D']);
    expect(result.totalActivities).toBe(5);
  });

  it('does not allocate invalid dates, milestones, work in progress, or crews from another group', () => {
    const data = calendar([activity('INVALID', '2026-09-31', '2026-10-02'),
      activity('PROGRESS', '2026-09-01', '2026-09-03', { progress: 20 }),
      activity('MILESTONE', '2026-09-01', '2026-09-01', { isMilestone: true })]);
    const crews = roster();
    crews.groups[0].crewGroupCode = 'G2';
    expect(buildCrewCalendarPlan(data, crews).groups.find(group => group.crewGroupCode === 'G1')?.crews[0].activities).toHaveLength(3);
    expect(buildCrewCalendarPlan(data, roster()).groups[0].crews.find(crew => !crew.crewCode)?.activities).toHaveLength(3);
  });

  it('does not propose the unassigned copy of an already saved booking', () => {
    const data = calendar([activity('A', '2026-09-01', '2026-09-10')]);
    data.groups[0].crews.push({ crewCode: 'Crew 2', activities: [activity('a', '2026-09-01', '2026-09-10', { wellId: 'w1' })] });
    const result = buildCrewCalendarPlan(data, roster());
    expect(result.totalActivities).toBe(1);
    expect(result.groups[0].crews.flatMap(crew => crew.activities).some(item => item.proposed)).toBe(false);
  });

  it('does not attribute missing-crew actual work to a matching planned assignment', () => {
    const data = calendar([activity('A', '2026-09-01', '2026-09-10', { actualStart: '2026-09-02', progress: 20 })]);
    data.groups[0].crews.push({ crewCode: 'Crew 2', activities: [
      activity('A', '2026-09-01', '2026-09-10', { source: 'assignment' }),
    ] });
    const result = buildCrewCalendarPlan(data, roster());
    expect(result.groups[0].crews.find(crew => !crew.crewCode)?.activities[0].actualStart).toBe('2026-09-02');
    expect(result.groups[0].crews.find(crew => crew.crewCode === 'Crew 2')?.activities[0].actualStart).toBeNull();
    expect(result.groups[0].crews.flatMap(crew => crew.activities).some(item => item.proposed)).toBe(false);
  });

  it('counts unique booked calendar days, clips to the visible window, and handles leap dates', () => {
    expect(bookedDaysInWindow([
      { plannedStart: '2026-08-29', plannedEnd: '2026-09-10' },
      { plannedStart: '2026-09-08', plannedEnd: '2026-09-18' },
      { plannedStart: '2026-09-25', plannedEnd: '2026-10-05' },
    ], '2026-09-01', '2026-09-30')).toBe(24);
    expect(bookedDaysInWindow([{ plannedStart: '2028-02-28', plannedEnd: '2028-03-01' }], '2028-02-01', '2028-02-29')).toBe(2);
    expect(bookedDaysInWindow([], '2026-09-01', '2026-09-30')).toBe(0);
  });

  it('starts roster groups collapsed, preserves manual expansion and keeps empty crews with booked percentages', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    (component as any).fetchedFrom = new Date(2026, 8, 1);
    (component as any).fetchedTo = new Date(2026, 8, 30);
    (component as any).applyCalendarData({ ...calendar([
      activity('A', '2026-09-01', '2026-09-10'), activity('B', '2026-09-08', '2026-09-15'),
      activity('C', '2026-09-11', '2026-09-20'),
    ]), roster: roster() });
    expect(component.crewPlanning).toBe(true);
    expect(component.crewGroups[0].wells.map(crew => [crew.name, crew.percent])).toEqual([
      ['Crew 1', 67], ['Crew 2', 27], ['Crew 3', 0],
    ]);
    const utilization = component.crewGroups[0].utilization;
    expect(utilization).toEqual({ bookedCrewDays: 28, capacityCrewDays: 90, percent: 28 / 90 * 100 });
    expect(component.crewGroups[0].percent).toBe(0);
    expect(component.crewGroups[0].wells[2].noActivities).toBe(true);
    expect(component.crewGroups[0].wells[0].activities[0].bar.activities?.[0].proposed).toBe(true);
    expect(component.crewGroups[0].expanded).toBe(false);
    expect(component.visibleBars(component.crewGroups[0].wells[0])).toHaveLength(2);
    expect(component.visibleBars(component.crewGroups[0].wells[0]).map(bar => bar.lane)).toEqual([0, 0]);
    component.collapseAll();
    expect(component.crewGroups[0].expanded).toBe(false);
    expect(component.crewGroups[0].utilization).toBe(utilization);
    expect(component.visibleBars(component.crewGroups[0]).some(bar => component.showPlannedBar(bar))).toBe(true);
    component.expandAll();
    expect(component.crewGroups[0].wells.every(crew => crew.expanded)).toBe(true);
    (component as any).rebuildBars();
    expect(component.crewGroups[0].expanded).toBe(true);
    component.showUnassigned = true;
    component.loadUnassignedCrews();
    expect(component.crewGroups[0].wells.map(crew => crew.name)).toEqual(['Crew 3']);
    expect(component.crewGroups[0].utilization).toBeUndefined();
    component.setCrewView('assigned');
    expect(component.crewGroups[0].expanded).toBe(false);
    expect(component.crewGroups[0].utilization).toEqual(utilization);
    expect(component.crewGroups[0].wells[0].activities.map(item => item.name)).toEqual(['A', 'C']);
    component.setTimeUnit('week');
    expect(component.crewGroups[0].wells[0].activities.map(item => item.name)).toEqual(['A']);
    expect(component.crewGroups[0].utilization).toEqual({ bookedCrewDays: 7, capacityCrewDays: 21, percent: 7 / 21 * 100 });
    component.setTimeUnit('day');
    expect(component.crewGroups[0].utilization).toEqual({ bookedCrewDays: 1, capacityCrewDays: 3, percent: 1 / 3 * 100 });
    component.setTimeUnit('month');
    expect(component.crewGroups[0].wells[0].activities.map(item => item.name)).toEqual(['A', 'C']);
    expect(component.crewGroups[0].utilization).toEqual(utilization);
  });

  it.each([
    { mode: 'month', from: '2026-09-01', to: '2026-09-30', booked: 25, capacity: 90 },
    { mode: 'week', from: '2026-09-01', to: '2026-09-30', booked: 12, capacity: 21 },
    { mode: 'day', from: '2026-09-01', to: '2026-09-30', booked: 2, capacity: 3 },
    { mode: 'week', from: '2026-09-29', to: '2026-09-30', booked: 2, capacity: 6 },
    { mode: 'month', from: '2026-09-29', to: '2026-09-30', booked: 2, capacity: 6 },
    { mode: 'day', from: '2026-09-30', to: '2026-09-30', booked: 1, capacity: 3 },
    { mode: 'month', from: '2026-09-21', to: '2026-09-28', booked: 0, capacity: 24 },
    { mode: 'month', from: '2028-02-01', to: '2028-02-29', booked: 0, capacity: 87 },
  ] as const)('calculates roster utilization for $mode from $from to $to without duplicating covered reservations', ({ mode, from, to, booked, capacity }) => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timeUnit = mode;
    component.timelineStart = new Date(`${from}T00:00:00`);
    (component as any).selectedFrom = from;
    (component as any).selectedTo = to;
    const members = roster();
    members.groups[0].crews[2].bookings.push({ plannedStart: '2026-09-05', plannedEnd: '2026-09-12' });
    members.groups[0].crews[1].bookings.push({ plannedStart: '2026-09-01', plannedEnd: '2026-09-05' });
    members.groups.push({ crewGroupCode: ' g1 ', crewGroupName: null, crews: [
      { crewUid: ' CREW 1 ', crewTypeCode: 'G1', bookings: [] },
      { crewUid: ' ', crewTypeCode: 'G1', bookings: [] },
    ] });
    const data = calendar([
      activity('PROPOSED', '2026-09-29', '2026-09-30'),
      activity('UNASSIGNED-ACTUAL', '2026-09-01', '2026-09-30', { actualStart: '2026-09-01' }),
    ]);
    data.groups[0].crews.push({ crewCode: 'crew 1', activities: [
      activity('SAVED', '2026-09-01', '2026-09-10', { source: 'assignment', progress: 80 }),
      activity('OVERLAP', '2026-09-08', '2026-09-15', { source: 'assignment' }),
    ] }, { crewCode: 'HISTORICAL-NON-ROSTER', activities: [activity('HISTORY', '2026-09-01', '2026-09-30')] });
    (component as any).applyCalendarData({ ...data, roster: members });
    const utilization = component.crewGroups[0].utilization;
    expect(utilization).toEqual({ bookedCrewDays: booked, capacityCrewDays: capacity, percent: booked / capacity * 100 });
    for (const filter of ['planned', 'actual', 'planned-actual'] as const) {
      component.scheduleFilter = filter;
      expect(component.crewGroups[0].utilization).toBe(utilization);
    }
    component.searchTerm = 'Crew 1';
    expect(component.filteredGroups[0].utilization).toBe(utilization);
  });

  it('shows no crew rows for an empty master roster and preserves legacy behavior without a roster', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const data = calendar([activity('UNASSIGNED', '2026-09-01', '2026-09-30')]);
    (component as any).applyCalendarData({ ...data, roster: { groups: [] } });
    expect(component.crewGroups).toEqual([]);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([0, 0, null, null]);
    component.setScheduleFilter('actual');
    expect(component.crewGroups).toEqual([]);
    component.setScheduleFilter('planned');
    (component as any).applyCalendarData(data);
    expect(component.crewGroups[0].utilization).toBeUndefined();
  });

  it('leaves booking bars unlabeled without changing their dates or availability behavior', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    component.totalDays = 30;
    const booking = { plannedStart: '2026-09-01', plannedEnd: '2026-09-30' };
    const before = JSON.stringify(booking);
    const bar = (component as any).mapReservationToBar(booking);
    expect(bar).toMatchObject({ ...booking, reserved: true, plannedStartDay: 0, plannedSpanDays: 30 });
    expect(component.barLabel(bar)).toBe('');
    expect(component.showPlannedBar(bar)).toBe(true);
    expect(component.showActualBar(bar)).toBe(false);
    expect(bookedDaysInWindow([booking], '2026-09-01', '2026-09-30')).toBe(30);
    expect(JSON.stringify(booking)).toBe(before);
  });

  it('shows only uncovered reservations and keeps distinct gaps in the timeline', () => {
    expect(uncoveredBookings([
      { plannedStart: '2026-09-01', plannedEnd: '2026-09-20' },
      { plannedStart: '2026-09-19', plannedEnd: '2026-09-22' },
    ], [
      { plannedStart: '2026-08-30', plannedEnd: '2026-09-05' },
      { plannedStart: '2026-09-10', plannedEnd: '2026-09-15' },
    ])).toEqual([
      { plannedStart: '2026-09-06', plannedEnd: '2026-09-09' },
      { plannedStart: '2026-09-16', plannedEnd: '2026-09-22' },
    ]);
  });

  it('summarizes Actual work over the full applied range without changing roster rows or Planned totals', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 8, 12));
    try {
      const component = new ActivityBreakdownComponent(
        {} as any, {} as any, { detectChanges: vi.fn() } as any,
        {} as any, {} as any, {} as any, {} as any,
      );
      component.timelineStart = new Date(2026, 8, 1);
      (component as any).selectedFrom = '2026-09-01';
      (component as any).selectedTo = '2026-10-31';
      (component as any).fetchedFrom = new Date(2026, 8, 1);
      (component as any).fetchedTo = new Date(2026, 9, 31);
      const data = calendar([]);
      data.toDate = '2026-10-31';
      data.roster = { groups: [
        { crewGroupCode: 'G1', crewGroupName: 'Working group', crews: [
          { crewUid: 'Crew 1', crewTypeCode: 'G1', bookings: [] },
          { crewUid: 'Crew 2', crewTypeCode: 'G1', bookings: [] },
        ] },
        { crewGroupCode: 'G2', crewGroupName: 'Idle group', crews: [
          { crewUid: 'Crew 3', crewTypeCode: 'G2', bookings: [] },
        ] },
      ] };
      data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
        activity('PLAN', '2026-09-01', '2026-09-03'),
      ] }];
      data.actualGroups = [{ crewGroupCode: 'G1', activityCount: 2, completionPct: 100, crews: [
        { crewCode: 'Crew 1', activities: [
          activity('ACTUAL-ONLY', '2026-08-01', '2026-08-02',
            { actualStart: '2026-09-29', actualEnd: '2026-10-02' }),
          activity('OVERLAP', '', '', { actualStart: '2026-10-01', actualEnd: '2026-10-04' }),
        ] },
      ] }];
      const source = JSON.stringify(data);
      (component as any).applyCalendarData(data);
      const allocations = JSON.stringify((component as any).calendarData);
      const planned = component.visibleCalendarSummary;
      const rangeGroups = vi.spyOn(component as any, 'reportGroupsInRange');
      component.setScheduleFilter('actual');
      for (const unit of ['month', 'week', 'day'] as const) {
        component.setTimeUnit(unit);
        expect(component.visibleCalendarSummary).toEqual([
          { label: 'Total crew groups', count: 1 },
          { label: 'Total actual crews', count: 1 },
          { label: 'Avg Actual Utilization', count: 8 / (3 * 61) * 100, unit: '%' },
        ]);
        expect(component.ganttGroups.flatMap(group => component.visibleCrews(group))).toHaveLength(3);
      }
      component.navigateTimeline(1);
      expect(component.visibleCalendarSummary.at(-1)?.count).toBeCloseTo(8 / (3 * 61) * 100, 10);
      expect(rangeGroups).toHaveBeenCalledTimes(1);
      component.setScheduleFilter('planned');
      component.setTimeUnit('month');
      expect(component.visibleCalendarSummary).toEqual(planned);
      expect(JSON.stringify((component as any).calendarData)).toBe(allocations);
      expect(JSON.stringify(data)).toBe(source);
      component.setScheduleFilter('actual');
      (component as any).setCalendarDateRange('2026-09-01', '2026-09-30');
      expect(component.visibleCalendarSummary.at(-1)?.count).toBeCloseTo(2 / 90 * 100, 10);
      (component as any).setCalendarDateRange('2026-10-01', '2026-10-31');
      expect(component.visibleCalendarSummary.at(-1)?.count).toBeCloseTo(6 / 93 * 100, 10);
      (component as any).setCalendarDateRange('2035-01-01', '2035-01-07');
      expect(component.visibleCalendarSummary.map(metric => metric.count)).toEqual([0, 0, 0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { actualStart: '2026-09-01', actualEnd: null, expectedDays: 8 },
    { actualStart: '2026-09-01', actualEnd: '2026-09-10', expectedDays: 8 },
    { actualStart: '2026-08-29', actualEnd: '2026-09-03', expectedDays: 3 },
    { actualStart: null, actualEnd: '2026-09-05', expectedDays: 5 },
    { actualStart: '2026-09-09', actualEnd: null, expectedDays: 0 },
    { actualStart: '2026-09-08', actualEnd: '2026-09-07', expectedDays: 0 },
    { actualStart: null, actualEnd: null, expectedDays: 0 },
  ])('bounds Actual summary work to the range and today: $actualStart / $actualEnd', values => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 8, 12));
    try {
      const component = new ActivityBreakdownComponent(
        {} as any, {} as any, { detectChanges: vi.fn() } as any,
        {} as any, {} as any, {} as any, {} as any,
      );
      (component as any).selectedFrom = '2026-09-01';
      (component as any).selectedTo = '2026-09-10';
      const data = calendar([]);
      data.toDate = '2026-09-10';
      data.roster = roster();
      data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
        activity('WORK', '2026-09-01', '2026-09-10', { ...values, progress: 100 }),
      ] }];
      (component as any).applyCalendarData(data);
      component.setScheduleFilter('actual');
      const workingCount = values.expectedDays > 0 ? 1 : 0;
      expect(component.visibleCalendarSummary.slice(0, 2).map(metric => metric.count)).toEqual([workingCount, workingCount]);
      expect(component.visibleCalendarSummary.at(-1)?.count).toBeCloseTo(values.expectedDays / 30 * 100, 10);
      expect(component.ganttGroups.flatMap(group => component.visibleCrews(group))).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes the Actual summary for filters and new data without double-counting shared cluster crews', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const data = calendar([]);
    data.roster = roster();
    const project = { projectId: 'P1', projectCode: 'AM1', cluster: 'Amal' };
    data.roster.groups[0].crews.find(crew => crew.crewUid === 'Crew 1')!.projects = [project,
      { projectId: 'P2', projectCode: 'NM1', cluster: 'Nimr' }];
    data.roster.groups[0].crews.find(crew => crew.crewUid === 'Crew 2')!.projects = [project];
    data.groups[0].crews = [
      { crewCode: 'Crew 1', activities: [activity('WORK', '', '',
        { actualStart: '2026-09-01', actualEnd: '2026-09-03' })] },
      { crewCode: 'UNKNOWN', activities: [activity('UNKNOWN-WORK', '', '',
        { actualStart: '2026-09-01', actualEnd: '2026-09-30' })] },
    ];
    (component as any).applyCalendarData(data);
    component.setScheduleFilter('actual');
    expect(component.visibleCalendarSummary.slice(0, 2).map(metric => metric.count)).toEqual([1, 1]);
    expect(component.visibleCalendarSummary.at(-1)?.count).toBeCloseTo(3 / 90 * 100, 10);
    expect(component.ganttClusters.flatMap(cluster => cluster.groups.flatMap(group => group.wells)))
      .toHaveLength(4);
    (component as any).calendarScope = { cluster: 'Amal' };
    expect(component.visibleCalendarSummary.at(-1)?.count).toBe(5);
    component.rowFilterSelected = new Set(['Crew 2']);
    expect(component.visibleCalendarSummary.map(metric => metric.count)).toEqual([0, 0, 0]);
    component.clearRowFilter();
    component.searchTerm = 'no match';
    expect(component.visibleCalendarSummary.map(metric => metric.count)).toEqual([0, 0, null]);
    component.searchTerm = 'G1';
    expect(component.visibleCalendarSummary.at(-1)?.count).toBe(5);
    component.utilizationFilter = 'Scarce';
    expect(component.visibleCalendarSummary.map(metric => metric.count)).toEqual([0, 0, null]);
    component.utilizationFilter = 'Surplus';
    expect(component.visibleCalendarSummary.at(-1)?.count).toBe(5);
    const updated = { ...data, groups: [{ ...data.groups[0], crews: [
      { crewCode: 'Crew 1', activities: [activity('UPDATED', '', '',
        { actualStart: '2026-09-01', actualEnd: '2026-09-06' })] },
    ] }] };
    (component as any).applyCalendarData(updated);
    expect(component.visibleCalendarSummary.at(-1)?.count).toBe(10);
    component.utilizationFilter = 'all';
    (component as any).applyCalendarData({ ...calendar([]), roster: { groups: [] } });
    expect(component.visibleCalendarSummary.map(metric => metric.count)).toEqual([0, 0, null]);
  });

  it('counts all Gantt crews and averages planned and actual utilization over known-capacity crews', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    (component as any).fetchedFrom = new Date(2026, 8, 1);
    (component as any).fetchedTo = new Date(2026, 8, 30);
    const members = roster();
    members.groups.push({ crewGroupCode: 'G2', crewGroupName: 'Other', crews: [
      { crewUid: 'Other crew', crewTypeCode: 'G2', bookings: [{ plannedStart: '2026-09-01', plannedEnd: '2026-09-15' }] },
    ] });
    const data = calendar([
      activity('PLAN', '2026-09-01', '2026-09-10'),
      activity('MISSING-CREW', '2026-09-01', '2026-09-30', { actualStart: '2026-09-01' }),
    ]);
    data.groups[0].crews.push({ crewCode: 'Crew 2', activities: [
      activity('ACTUAL', '2026-09-01', '2026-09-30', { actualStart: '2026-09-02', actualEnd: '2026-09-30', progress: 80 }),
    ] });
    (component as any).applyCalendarData({ ...data, roster: members });
    component.today = new Date(2026, 8, 30);
    (component as any).rebuildBars();
    const snapshot = JSON.stringify((component as any).calendarData);
    const summary = component.calendarSummary;
    expect(summary).toEqual([
      { label: 'Total crew groups', count: 2 },
      { label: 'Total actual crews', count: 4 },
      { label: 'Avg Planned Utilization', count: 55 / 120 * 100, unit: '%' },
      { label: 'Avg Actual Utilization', count: 29 / 120 * 100, unit: '%' },
    ]);
    component.collapseAll();
    for (const filter of ['planned', 'planned-actual'] as const) {
      component.scheduleFilter = filter;
      expect(component.calendarSummary).toEqual(summary);
      expect(component.ganttGroups.map(group => group.name)).toEqual(['G1', 'G2']);
    }
    component.setScheduleFilter('actual');
    expect(component.visibleCalendarSummary).toEqual([
      { label: 'Total crew groups', count: 1 },
      { label: 'Total actual crews', count: 1 },
      { label: 'Avg Actual Utilization', count: 29 / 120 * 100, unit: '%' },
    ]);
    component.setScheduleFilter('planned');
    component.setTimeUnit('week');
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([2, 4, 75, 6 / 28 * 100]);
    component.rowFilterSelected = new Set(['Crew 1']);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 1, 100, 0]);
    component.clearRowFilter();
    component.setTimeUnit('day');
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([2, 4, 75, 0]);
    component.setTimeUnit('month');
    component.searchTerm = 'G2';
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 1, 50, 0]);
    component.searchTerm = '';
    component.setCrewView('unassigned');
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 1, 0, 0]);
    component.setCrewView('assigned');
    expect(component.calendarSummary).toEqual(summary);
    expect(JSON.stringify((component as any).calendarData)).toBe(snapshot);
  });

  it('calculates planned and actual averages from applied cluster crews without double-counting shared crews', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    component.filterFrom = '2026-09-01';
    component.filterTo = '2026-09-30';
    (component as any).selectedFrom = component.filterFrom;
    (component as any).selectedTo = component.filterTo;
    vi.spyOn(component as any, 'loadCalendarData').mockImplementation(() => {});
    const data = calendar([]);
    data.roster = { groups: [{ crewGroupCode: 'G1', crewGroupName: 'Group 1', crews: [
      { crewUid: 'Crew 1', crewTypeCode: 'G1',
        projects: [{ projectId: 'P1', projectCode: 'AMP2A4', cluster: 'Amal' },
          { projectId: 'P2', projectCode: 'NY0010', cluster: 'Nimr' }],
        bookings: [{ plannedStart: '2026-09-01', plannedEnd: '2026-09-15' }] },
      { crewUid: 'Crew 2', crewTypeCode: 'G1',
        projects: [{ projectId: 'P3', projectCode: 'MY0010', cluster: 'Marmul' }],
        bookings: [{ plannedStart: '2026-09-01', plannedEnd: '2026-09-30' }] },
      { crewUid: 'Crew 3', crewTypeCode: 'G1',
        projects: [{ projectId: 'P1', projectCode: 'AMP2A4', cluster: 'Amal' }], bookings: [] },
    ] }, { crewGroupCode: 'G2', crewGroupName: 'Other', crews: [
      { crewUid: 'Other crew', crewTypeCode: 'G2',
        projects: [{ projectId: 'P2', projectCode: 'NY0010', cluster: 'Nimr' }],
        bookings: [{ plannedStart: '2026-09-01', plannedEnd: '2026-09-10' }] },
    ] }] };
    data.groups[0].crews = [
      { crewCode: 'Crew 1', activities: [activity('AMAL', '2026-09-01', '2026-09-06',
        { actualStart: '2026-09-01', actualEnd: '2026-09-06' })] },
      { crewCode: 'Crew 2', activities: [activity('MARMUL', '2026-09-01', '2026-09-12',
        { actualStart: '2026-09-01', actualEnd: '2026-09-12' })] },
    ];
    data.groups.push({ crewGroupCode: 'G2', activityCount: 1, completionPct: 0, crews: [
      { crewCode: 'Other crew', activities: [activity('NIMR', '2026-09-01', '2026-09-03',
        { actualStart: '2026-09-01', actualEnd: '2026-09-03' })] },
    ] });
    (component as any).applyCalendarData(data);
    component.today = new Date(2026, 8, 30);
    (component as any).rebuildBars();
    const original = component.calendarSummary;
    expect(original.map(metric => metric.count)).toEqual([2, 4, 55 / 120 * 100, 21 / 120 * 100]);
    expect(component.ganttClusters.map(cluster => [cluster.name, component.visibleClusterUtilization(cluster)]))
      .toEqual([
        ['Amal', { bookedCrewDays: 15, capacityCrewDays: 60, percent: 25 }],
        ['Marmul', { bookedCrewDays: 30, capacityCrewDays: 30, percent: 100 }],
        ['Nimr', { bookedCrewDays: 25, capacityCrewDays: 60, percent: 25 / 60 * 100 }],
      ]);
    component.filterCluster = 'Amal';
    expect(component.calendarSummary).toEqual(original);
    component.applyDashboardFilters();
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 2, 25, 10]);
    expect(component.visibleClusterUtilization(component.ganttClusters[0])?.percent).toBe(25);
    component.setScheduleFilter('actual');
    expect(component.visibleClusterUtilization(component.ganttClusters[0]))
      .toEqual({ bookedCrewDays: 6, capacityCrewDays: 60, percent: 10 });
    expect(component.visibleCalendarSummary.at(-1)).toMatchObject({ label: 'Avg Actual Utilization', count: 10 });
    component.setScheduleFilter('planned');
    component.rowFilterSelected = new Set(['Crew 1']);
    expect(component.visibleClusterUtilization(component.ganttClusters[0]))
      .toEqual({ bookedCrewDays: 15, capacityCrewDays: 30, percent: 50 });
    component.clearRowFilter();
    component.openUtilizationReport();
    expect(component.utilizationReport?.summary).toMatchObject({
      crewGroups: 1, actualCrews: 2, averagePlannedUtilization: 25, averageUtilization: 10,
    });
    component.closeUtilizationReport();
    component.filterCluster = 'Marmul';
    component.applyDashboardFilters();
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 1, 100, 40]);
    component.filterCluster = ' nimr ';
    component.applyDashboardFilters();
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([2, 2, 25 / 60 * 100, 15]);
    component.filterCluster = 'Missing';
    component.applyDashboardFilters();
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([0, 0, null, null]);
    component.filterCluster = '';
    component.applyDashboardFilters();
    expect(component.calendarSummary).toEqual(original);
  });

  it.each([0, 13, 23])('counts all crews but averages actual work only through today at %s:00 across day navigation', hour => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, hour));
    try {
      const component = new ActivityBreakdownComponent(
        {} as any, {} as any, { detectChanges: vi.fn() } as any,
        {} as any, {} as any, {} as any, {} as any,
      );
      (component as any).selectedFrom = '2026-09-01';
      (component as any).selectedTo = '2026-09-30';
      (component as any).fetchedFrom = new Date(2026, 8, 1);
      (component as any).fetchedTo = new Date(2026, 8, 30);
      const data = calendar([]);
      data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
        activity('ONGOING', '2026-09-01', '2026-09-30', { actualStart: '2026-01-01', progress: 100 }),
      ] }];
      (component as any).applyCalendarData({ ...data, roster: roster() });
      const before = JSON.stringify((component as any).calendarData);
      component.setTimeUnit('day');
      component.goToToday();
      expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 3, 1 / 3 * 100, 1 / 3 * 100]);
      const crew = component.crewGroups[0].wells[0];
      expect(crew.bars).toHaveLength(1);
      expect(component.actualBarStyle(crew.bars[0])).toMatchObject({ width: '100%', display: 'flex' });
      component.navigateTimeline(1);
      expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 3, 1 / 3 * 100, 0]);
      expect(component.crewGroups[0].wells[0].bars).toHaveLength(1);
      component.scheduleFilter = 'actual';
      expect(component.ganttGroups).toHaveLength(1);
      expect(component.visibleCrews(component.ganttGroups[0])).toHaveLength(3);
      expect(component.visibleCrews(component.ganttGroups[0]).flatMap(crew => component.visibleCrewBars(crew))).toEqual([]);
      expect(component.visibleCalendarSummary).toEqual([
        { label: 'Total crew groups', count: 1 },
        { label: 'Total actual crews', count: 1 },
        { label: 'Avg Actual Utilization', count: 20 / 90 * 100, unit: '%' },
      ]);
      component.scheduleFilter = 'planned-actual';
      expect(component.todayOffset).toBe(-1);
      component.navigateTimeline(-1);
      expect(component.calendarSummary[1].count).toBe(3);
      expect(JSON.stringify((component as any).calendarData)).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { plannedStart: '', plannedEnd: '', actualStart: '2026-09-14', actualEnd: null, expectedDays: 4 },
    { plannedStart: '', plannedEnd: '', actualStart: '2026-09-14', actualEnd: '2026-09-16', expectedDays: 2 },
    { plannedStart: '', plannedEnd: '', actualStart: null, actualEnd: '2026-09-16', expectedDays: 1 },
    { plannedStart: '2026-09-30', plannedEnd: '2026-09-01', actualStart: '2026-09-14', actualEnd: '2026-09-16', expectedDays: 2 },
    { plannedStart: '', plannedEnd: '', actualStart: '2026-09-18', actualEnd: '2026-09-16', expectedDays: 0 },
    { plannedStart: '', plannedEnd: '', actualStart: '2026-09-21', actualEnd: null, expectedDays: 0 },
  ])('excludes actual-only history from both the grid and its tiles: $actualStart / $actualEnd', values => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, 15));
    try {
      const component = new ActivityBreakdownComponent(
        {} as any, {} as any, { detectChanges: vi.fn() } as any,
        {} as any, {} as any, {} as any, {} as any,
      );
      component.timelineStart = new Date(2026, 8, 15);
      (component as any).selectedFrom = '2026-09-15';
      (component as any).selectedTo = '2026-09-18';
      const data = calendar([]);
      data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [activity('ACTUAL',
        values.plannedStart, values.plannedEnd, { actualStart: values.actualStart, actualEnd: values.actualEnd }),
      ] }];
      (component as any).applyCalendarData({ ...data, roster: roster() });
      expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 3, 0, 0]);
      const group = component.crewGroups[0];
      const bars = [...group.bars, ...group.wells[0].bars];
      expect(bars).toEqual([]);
      expect(group.wells).toHaveLength(3);
      expect(group.wells.every(crew => crew.activities.length === 0)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts normalized crew identities once across groups, including progress-only crews but excluding missing IDs', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const data = calendar([]);
    data.groups = ['G1', 'G2'].map((crewGroupCode, index) => ({
      crewGroupCode, activityCount: 3, completionPct: 0, crews: [
        { crewCode: index ? ' Shared Crew ' : 'SHARED CREW', activities: [
          activity(crewGroupCode, '2026-09-01', '2026-09-30', { actualStart: '2026-09-02', actualEnd: '2026-09-03' }),
        ] },
        { crewCode: '', activities: [activity('MISSING', '2026-09-01', '2026-09-30', { actualEnd: '2026-09-03' })] },
        { crewCode: 'PROGRESS-ONLY', activities: [activity('PROGRESS', '2026-09-01', '2026-09-30', { progress: 100 })] },
      ],
    }));
    (component as any).applyCalendarData(data);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([2, 2, null, null]);
  });

  it('does not count actual-only source records when the assigned or unassigned Gantt has no activities', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const data = calendar([]);
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
      activity('ACTUAL-ONLY', '', '', { actualStart: '2026-09-02', actualEnd: '2026-09-03' }),
    ] }];
    (component as any).applyCalendarData({ ...data, roster: roster() });
    const summary = component.calendarSummary;
    expect(summary.map(metric => metric.count)).toEqual([1, 3, 0, 0]);
    component.setCrewView('unassigned');
    expect(component.crewGroups[0].wells.every(crew => !crew.activities.length)).toBe(true);
    expect(component.calendarSummary).toEqual(summary);
    component.rowFilterSelected = new Set(['Crew 2']);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 1, 0, 0]);
  });

  it.each([false, true])('keeps the grid, tiles and allocations independent of actual-only history (separate payload: %s)', separate => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    (component as any).fetchedFrom = new Date(2026, 8, 1);
    (component as any).fetchedTo = new Date(2026, 8, 30);
    const data = calendar([
      activity('FIRST', '2026-09-01', '2026-09-10'), activity('SECOND', '2026-09-11', '2026-09-20'),
      activity('THIRD', '2026-09-21', '2026-09-30'),
    ]);
    data.groups.push({ crewGroupCode: 'G2', activityCount: 1, completionPct: 0,
      crews: [{ crewCode: '', activities: [activity('OTHER-PLAN', '2026-09-01', '2026-09-30')] }] });
    const historical = ['H1', 'H2', 'H3', 'H4'].map(crewCode => ({ crewCode, activities: [
      activity('OLD-' + crewCode, '2026-01-01', '2026-01-31', {
        actualStart: '2026-01-01', actualEnd: '2026-09-05', progress: 100,
      }),
    ] }));
    if (separate) {
      data.actualCrewWork = historical.map(crew => ({ crewGroupCode: 'G2', crewCode: crew.crewCode,
        actualStart: '2026-01-01', actualEnd: '2026-09-05' }));
      data.actualCrewWork.push({ crewGroupCode: 'G1', crewCode: 'Crew 1',
        actualStart: '2026-01-01', actualEnd: '2026-09-30' });
    } else {
      data.groups[1].crews.push(...historical);
    }
    const members = roster();
    members.groups.push({ crewGroupCode: 'G2', crewGroupName: 'Other',
      crews: [{ crewUid: 'Other crew', crewTypeCode: 'G2', bookings: [] }] });
    const before = JSON.stringify(data);
    (component as any).applyCalendarData({ ...data, roster: members });
    expect(component.crewGroups.map(group => [group.name, group.wells.length, group.expanded]))
      .toEqual([['G1', 3, false], ['G2', 1, false]]);
    expect(component.crewGroups[0].wells[0].activities.map(row => row.name)).toEqual(['FIRST', 'SECOND', 'THIRD']);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([2, 4, 50, 0]);
    expect((component as any).calendarData.totalActivities).toBe(4);
    expect(JSON.stringify(data)).toBe(before);
    const plan = JSON.stringify((component as any).calendarData.groups);
    component.searchTerm = 'G2';
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 1, 100, 0]);
    component.searchTerm = '';
    component.rowFilterSelected = new Set(['Other crew']);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 1, 100, 0]);
    component.clearRowFilter();
    component.setTimeUnit('week');
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([2, 4, 50, 0]);
    component.navigateTimeline(1);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([2, 4, 50, 0]);
    expect(component.crewGroups[0].wells).toHaveLength(3);
    component.setTimeUnit('month');
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([2, 4, 50, 0]);
    expect(JSON.stringify((component as any).calendarData.groups)).toBe(plan);
  });

  it.each([
    ['Surplus', ['Crew 0', 'Crew 9']],
    ['Underutilized', ['Crew 10', 'Crew 15']],
    ['Well-Utilized', ['Crew 16', 'Crew 18']],
    ['Scarce', ['Crew 19', 'Crew 20']],
    ['N/A', []],
  ] as const)('filters crews by the planned %s utilization band without changing allocations', (status, expected) => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-20';
    const members = roster();
    members.groups[0].crews = [0, 9, 10, 15, 16, 18, 19, 20].map(days => ({
      crewUid: `Crew ${days}`, crewTypeCode: 'G1', bookings: days ? [{
        plannedStart: '2026-09-01', plannedEnd: `2026-09-${String(days).padStart(2, '0')}`,
      }] : [],
    }));
    const data = calendar([]);
    data.groups[0].crews = [{ crewCode: 'Unknown', activities: [activity('UNKNOWN', '2026-09-01', '2026-09-20')] }];
    (component as any).applyCalendarData({ ...data, roster: members });
    const before = JSON.stringify((component as any).calendarData);
    const groups = component.crewGroups;
    const group = groups[0];
    component.utilizationFilter = status;
    expect(component.ganttGroups).toEqual(expected.length ? [group] : []);
    expect(component.visibleCrews(group).map(crew => crew.id).sort()).toEqual([...expected].sort());
    expect(component.calendarSummary[1].count).toBe(expected.length);
    expect(component.visibleGroupUtilization(group)?.percent).toBe(component.calendarSummary[2].count);
    component.selectGroup(group);
    expect(group.expanded).toBe(true);
    component.openUtilizationReport();
    expect(component.utilizationReport?.groups.flatMap(row => row.crews.map(crew => crew.crewId)).sort()).toEqual([...expected].sort());
    expect(component.utilizationSelectionLabel).toContain(`Planned utilization: ${status}`);
    component.closeUtilizationReport();
    component.searchTerm = 'no matching group';
    expect(component.ganttGroups).toEqual([]);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([0, 0, null, null]);
    component.clearRowFilter();
    component.utilizationFilter = 'all';
    expect(component.ganttGroups).toEqual(groups);
    expect(component.visibleCrews(group)).toHaveLength(8);
    expect(JSON.stringify((component as any).calendarData)).toBe(before);
  });

  it('counts overlapping actual engagements for master-crew utilization filtering without adding unknown crew rows', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-20';
    const data = calendar([]);
    data.groups[0].crews = [
      { crewCode: 'Crew 1', activities: [
        activity('FIRST', '2026-09-01', '2026-09-20', { actualStart: '2026-09-01', actualEnd: '2026-09-08' }),
        activity('OVERLAP', '2026-09-01', '2026-09-20', { actualStart: '2026-09-05', actualEnd: '2026-09-12' }),
      ] },
      { crewCode: 'Unknown', activities: [activity('UNKNOWN', '2026-09-01', '2026-09-20', {
        actualStart: '2026-09-01', actualEnd: '2026-09-20',
      })] },
    ];
    (component as any).applyCalendarData({ ...data, roster: roster() });
    component.today = new Date(2026, 8, 20);
    (component as any).rebuildBars();
    const group = component.crewGroups[0];
    const before = JSON.stringify((component as any).calendarData);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 3, 40 / 60 * 100, 16 / 60 * 100]);
    component.utilizationBasis = 'actual';
    component.utilizationFilter = 'Well-Utilized';
    expect(component.visibleCrews(group).map(crew => crew.id)).toEqual(['Crew 1']);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 1, 200, 80]);
    expect(component.visibleBars(group).flatMap(bar => bar.activities!.map(activity => activity.activityCode)).sort())
      .toEqual(['FIRST', 'OVERLAP']);
    component.rowFilterSelected = new Set(['Crew 2']);
    expect(component.ganttGroups).toEqual([]);
    component.clearRowFilter();
    component.utilizationFilter = 'Scarce';
    expect(component.ganttGroups).toEqual([]);
    component.utilizationFilter = 'N/A';
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([0, 0, null, null]);
    component.utilizationFilter = 'Surplus';
    component.setCrewView('unassigned');
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 2, 0, 0]);
    component.showUtilizationFilter = true;
    component.onEsc();
    expect(component.showUtilizationFilter).toBe(false);
    component.showUtilizationFilter = true;
    component.closeFilterDropdowns();
    expect(component.showUtilizationFilter).toBe(false);
    expect(JSON.stringify((component as any).calendarData)).toBe(before);
  });

  const deletionFixture = () => {
    const deletion = new Subject<void>();
    const service = {
      unassign: vi.fn(() => deletion),
      getCalendar: vi.fn(() => of({ ...calendar([]), roster: roster() })),
    };
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, service as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    (component as any).fetchedFrom = new Date(2026, 8, 1);
    (component as any).fetchedTo = new Date(2026, 8, 30);
    const data = calendar([]);
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
      activity('SAVED', '2026-09-09', '2026-09-10', { source: 'assignment', assignmentId: 42 }),
    ] }];
    (component as any).applyCalendarData({ ...data, roster: roster() });
    const bar = component.crewGroups[0].wells[0].activities[0].bar;
    return { component, service, deletion, bar };
  };

  it('opens a saved assignment menu by exact ID and cancels without deleting', () => {
    const { component, service, bar } = deletionFixture();
    const event = new MouseEvent('contextmenu', { cancelable: true, clientX: 10000, clientY: 10000 });
    component.tooltipText = 'show';
    component.openAssignmentMenu(event, bar);
    expect(event.defaultPrevented).toBe(true);
    expect(component.assignmentMenu?.activity).toMatchObject({ assignmentId: 42, crewId: 'Crew 1' });
    expect(component.assignmentMenu!.left).toBeLessThan(window.innerWidth);
    expect(component.assignmentMenu!.top).toBeLessThan(window.innerHeight);
    expect(component.tooltipText).toBeNull();
    expect(service.unassign).not.toHaveBeenCalled();
    component.requestAssignmentDeletion();
    expect(component.assignmentMenu).toBeNull();
    expect(component.assignmentDeletion?.activity.assignmentId).toBe(42);
    component.onEsc();
    expect(component.assignmentDeletion).toBeNull();
    expect(service.unassign).not.toHaveBeenCalled();
    component.openAssignmentMenu(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true }), bar);
    expect(component.assignmentMenu).not.toBeNull();
    component.closeFilterDropdowns();
    expect(component.assignmentMenu).toBeNull();
  });

  it.each(['legacy', 'preview', 'reservation', 'summary', 'multiple', 'missing-id', 'zero-id', 'unsafe-id'])(
    'does not offer deletion for %s bars', invalid => {
      const { component, service, bar } = deletionFixture();
      if (invalid === 'legacy') bar.source = 'legacy';
      if (invalid === 'preview') bar.proposed = true;
      if (invalid === 'reservation') bar.reserved = true;
      if (invalid === 'summary') bar.summary = true;
      if (invalid === 'multiple') bar.activities!.push({ ...bar.activities![0], assignmentId: 43 });
      if (invalid === 'missing-id') bar.activities![0].assignmentId = undefined;
      if (invalid === 'zero-id') bar.activities![0].assignmentId = 0;
      if (invalid === 'unsafe-id') bar.activities![0].assignmentId = Number.MAX_SAFE_INTEGER + 1;
      const event = new MouseEvent('contextmenu', { cancelable: true });
      component.openAssignmentMenu(event, bar);
      component.requestAssignmentDeletion();
      component.confirmAssignmentDeletion();
      expect(event.defaultPrevented).toBe(false);
      expect(component.assignmentMenu).toBeNull();
      expect(service.unassign).not.toHaveBeenCalled();
    },
  );

  it('deletes once, blocks cancellation while saving, and reloads the same range and week', () => {
    const { component, service, deletion, bar } = deletionFixture();
    component.setTimeUnit('week');
    component.navigateTimeline(1);
    component.openAssignmentMenu(new MouseEvent('contextmenu'), bar);
    component.requestAssignmentDeletion();
    component.confirmAssignmentDeletion();
    component.confirmAssignmentDeletion();
    component.cancelAssignmentDeletion();
    expect(component.assignmentDeletion?.saving).toBe(true);
    expect(service.unassign).toHaveBeenCalledExactlyOnceWith(42);
    expect(service.getCalendar).not.toHaveBeenCalled();
    deletion.next();
    deletion.complete();
    expect(component.assignmentDeletion).toBeNull();
    expect(service.getCalendar).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      from: '2026-09-01', to: '2026-09-30', includeAssignments: false, includeRoster: true,
    }));
    expect(component.timelineStart).toEqual(new Date(2026, 8, 8));
    expect(component.timeUnit).toBe('week');
    expect(component.totalDays).toBe(7);
    expect(component.crewGroups[0].wells.every(crew => !crew.activities.length)).toBe(true);
    expect(component.crewGroups[0].utilization?.bookedCrewDays).toBe(0);
  });

  it.each([403, 500])('keeps the assignment and supports retry after a %s deletion error', status => {
    const { component, service, deletion, bar } = deletionFixture();
    component.openAssignmentMenu(new MouseEvent('contextmenu'), bar);
    component.requestAssignmentDeletion();
    component.confirmAssignmentDeletion();
    deletion.error({ status });
    expect(component.assignmentDeletion?.saving).toBe(false);
    expect(component.assignmentDeletion?.error).toBeTruthy();
    expect(component.crewGroups[0].wells[0].activities[0].bar.activities?.[0].assignmentId).toBe(42);
    expect(service.getCalendar).not.toHaveBeenCalled();
    const retry = new Subject<void>();
    service.unassign.mockReturnValue(retry);
    component.confirmAssignmentDeletion();
    expect(component.assignmentDeletion?.error).toBeNull();
    retry.next();
    retry.complete();
    expect(component.assignmentDeletion).toBeNull();
    expect(service.unassign).toHaveBeenCalledTimes(2);
    expect(service.getCalendar).toHaveBeenCalledOnce();
  });

  it('refreshes a stale assignment when the server reports it already removed', () => {
    const { component, service, deletion, bar } = deletionFixture();
    component.openAssignmentMenu(new MouseEvent('contextmenu'), bar);
    component.requestAssignmentDeletion();
    component.confirmAssignmentDeletion();
    deletion.error({ status: 404 });
    expect(component.assignmentDeletion).toBeNull();
    expect(service.getCalendar).toHaveBeenCalledOnce();
  });

  it('uses the assignment delete endpoint and prevents busy confirmation-dialog events', () => {
    const api = { delete: vi.fn(() => of({})) };
    const service = new CrewCalendarService(api as any, {} as any);
    service.unassign(42).subscribe();
    expect(api.delete).toHaveBeenCalledExactlyOnceWith('/crew-assignments/42');
    const dialog = new ConfirmationDialogComponent();
    const confirmed = vi.fn();
    const cancelled = vi.fn();
    dialog.confirmed.subscribe(confirmed);
    dialog.cancelled.subscribe(cancelled);
    dialog.busy = true;
    dialog.onConfirm();
    dialog.onCancel();
    expect(confirmed).not.toHaveBeenCalled();
    expect(cancelled).not.toHaveBeenCalled();
    dialog.busy = false;
    dialog.onConfirm();
    dialog.onCancel();
    expect(confirmed).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it('separates overlapping saved work into lanes and displays external reservations without counting them as activities', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const data = calendar([]);
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
      activity('A', '2026-09-01', '2026-09-10'), activity('B', '2026-09-08', '2026-09-15'),
    ] }];
    const members = roster();
    members.groups[0].crews[1].bookings.push({ plannedStart: '2026-09-01', plannedEnd: '2026-09-05' });
    (component as any).applyCalendarData({ ...data, roster: members });
    const crews = component.crewGroups[0].wells;
    expect(crews[0].bars.map(bar => bar.lane)).toEqual([0, 1]);
    expect(crews[0].rowHeight).toBe(96);
    expect(crews[0].percent).toBe(60);
    expect(crews[1].activities).toHaveLength(0);
    expect(crews[1].bars[0].reserved).toBe(true);
    expect(crews[1].noActivities).toBe(false);
    expect(crews[1].percent).toBe(17);
  });

  it('shows overlapping 200% engagements in calendar badges, utilization filters and both report views', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const data = calendar([]);
    const members = roster();
    members.groups[0].crews.find(crew => crew.crewUid === 'Crew 1')!.bookings =
      [{ plannedStart: '2026-09-01', plannedEnd: '2026-09-30' }];
    data.groups[0].crews = [{ crewCode: 'Crew 1', activities: [
      activity('FIRST', '2026-09-01', '2026-09-30',
        { actualStart: '2026-09-01', actualEnd: '2026-09-30' }),
      activity('SECOND', '2026-09-01', '2026-09-30',
        { actualStart: '2026-09-01', actualEnd: '2026-09-30' }),
    ] }];
    (component as any).applyCalendarData({ ...data, roster: members });
    component.today = new Date(2026, 8, 30);
    (component as any).rebuildBars();
    const group = component.crewGroups[0];
    const first = group.wells.find(crew => crew.id === 'Crew 1')!;
    expect(first).toMatchObject({ bookedDays: 60, actualDays: 60, percent: 200 });
    expect(component.crewUtilization(group, first, 'planned')).toBe(200);
    expect(component.crewUtilization(group, first, 'actual')).toBe(200);
    component.utilizationFilter = 'Scarce';
    expect(component.visibleCrews(group).map(crew => crew.id)).toEqual(['Crew 1']);
    component.openUtilizationReport(true);
    expect(component.utilizationReport?.groups[0].crews[0]).toMatchObject({
      plannedDays: 60, actualAssignedDays: 60, utilization: 200, status: 'Fully utilized',
    });
    expect(component.utilizationReport?.totals).toMatchObject({ availableDays: 30, utilization: 200, idleDays: 0 });
    component.setUtilizationReportView('actual');
    expect(component.utilizationReport?.groups[0].crews[0]).toMatchObject({
      actualAssignedDays: 60, utilization: 200, status: 'Fully utilized',
    });
  });
});

describe('ActivityBreakdownComponent', () => {
  it.each([
    { now: '2026-09-19T12:00:00', from: '2026-09-01', to: '2026-09-30', days: 30 },
    { now: '2027-02-15T12:00:00', from: '2027-02-01', to: '2027-02-28', days: 28 },
    { now: '2028-02-29T12:00:00', from: '2028-02-01', to: '2028-02-29', days: 29 },
    { now: '2026-12-31T12:00:00', from: '2026-12-01', to: '2026-12-31', days: 31 },
  ])('defaults the calendar, filter dates and API request to $from through $to', ({ now, from, to, days }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    try {
      const calendarService = { getCalendar: vi.fn(() => of({ groups: [], fromDate: from, toDate: to })) };
      const component = new ActivityBreakdownComponent(
        { snapshot: { paramMap: { get: () => '2150' } } } as any, {} as any,
        { detectChanges: vi.fn(), markForCheck: vi.fn() } as any,
        { isCollapsed: false, collapse: vi.fn() } as any,
        { getPlantFilters: vi.fn(() => of([])) } as any,
        calendarService as any, {} as any,
      );

      component.ngOnInit();

      expect(component.timeUnit).toBe('month');
      expect(component.timelineStart).toEqual(new Date(`${from}T00:00:00`));
      expect((component as any).timelineEnd).toEqual(new Date(`${to}T00:00:00`));
      expect(component.totalDays).toBe(days);
      expect(component.days).toHaveLength(days);
      expect(component.filterFrom).toBe(from);
      expect(component.filterTo).toBe(to);
      expect(calendarService.getCalendar).toHaveBeenCalledWith(expect.objectContaining({ from, to }));
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([false, true])('applies the filter range to calendar loading and keeps it across date views (unassigned: %s)', unassigned => {
    const service = {
      getCalendar: vi.fn(() => of({ groups: [], fromDate: '2026-09-06', toDate: '2026-09-18', roster: { groups: [] } })),
    };
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, service as any, {} as any,
    );
    component.showUnassigned = unassigned;
    component.showFilterPanel = true;
    component.filterCluster = 'nimr';
    component.filterPlant = 'P1';
    component.filterFrom = '2026-09-06';
    component.filterTo = '2026-09-18';
    component.applyDashboardFilters();
    expect(service.getCalendar).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      from: '2026-09-06', to: '2026-09-18', cluster: 'nimr', site: 'P1', includeRoster: true,
    }));
    expect(component.showFilterPanel).toBe(false);
    expect(component.timelineStart).toEqual(new Date(2026, 8, 6));
    expect(component.totalDays).toBe(13);
    for (const [mode, days] of [['week', 7], ['day', 1], ['month', 13]] as const) {
      component.setTimeUnit(mode);
      expect([component.filterFrom, component.filterTo]).toEqual(['2026-09-06', '2026-09-18']);
      expect([(component as any).selectedFrom, (component as any).selectedTo]).toEqual(['2026-09-06', '2026-09-18']);
      expect(component.totalDays).toBe(days);
    }
    expect(service.getCalendar).toHaveBeenCalledOnce();
  });

  it.each([
    ['Nimr', 'Nimr ODC', '3522'],
    ['Amal', 'Amal ODC', '3523'],
    ['Marmul', 'Marmul ODC', '3524'],
    ['GB', 'GB', '3525'],
    ['Marmul', 'Marmul Projects', '3526'],
    ['', 'Nimr ODC', '3522'],
  ])('applies cluster %s and plant %s using stable plant code %s', (cluster, plant, code) => {
    const service = {
      getCalendar: vi.fn(() => of({ groups: [], fromDate: '2026-09-01', toDate: '2026-09-30', roster: { groups: [] } })),
    };
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, service as any, {} as any,
    );
    (component as any).allPlants = [
      { cluster: 'Nimr', plantDescription: 'Nimr ODC', plantCode: 3522 },
      { cluster: 'Amal', plantDescription: 'Amal ODC', plantCode: 3523 },
      { cluster: 'Marmul', plantDescription: 'Marmul ODC', plantCode: 3524 },
      { cluster: 'GB', plantDescription: 'GB', plantCode: 3525 },
      { cluster: 'Marmul', plantDescription: 'Marmul Projects', plantCode: 3526 },
    ];
    component.filterCluster = cluster;
    component.filterPlant = plant;
    component.filterFrom = '2026-09-01';
    component.filterTo = '2026-09-30';

    component.applyDashboardFilters();

    expect(service.getCalendar).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      cluster: cluster || undefined, site: code, from: '2026-09-01', to: '2026-09-30', includeRoster: true,
    }));
    expect((component as any).calendarScope).toEqual({ cluster: cluster || undefined, site: code });
    expect(component.filterPlant).toBe(plant);
    expect(component.filterCluster).toBe(cluster);
  });

  it('cascades options from any selected parent and keeps a remaining scalar selection scalar', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    (component as any).allPlants = [
      { country: 'UAE', sector: 'Industrial' },
      { country: 'Oman', sector: 'Residential' },
      { country: 'Saudi Arabia', sector: 'Commercial' },
    ];
    component.filterCountry = ['UAE', 'Oman'];

    (component as any).rebuildCascadingOptions();

    expect(component.filterSectorOptions).toEqual(['Industrial', 'Residential']);
    component.selectFilterOption('country', 'UAE');
    expect(component.filterCountry).toBe('Oman');
    expect(component.filterSectorOptions).toEqual(['Residential']);
  });

  it('applies OR within a multi-cluster selection and AND across hierarchy fields', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    (component as any).allPlants = [
      { country: 'Oman', cluster: 'Amal', plantDescription: 'Amal ODC', plantCode: 100 },
      { country: 'UAE', cluster: 'Nimr', plantDescription: 'Nimr ODC', plantCode: 3522 },
      { country: 'Oman', cluster: 'Marmul', plantDescription: 'Marmul ODC', plantCode: 3524 },
    ];
    component.filterCountry = 'Oman';
    component.filterCluster = ['Amal', 'Nimr'];
    const makeActivity = (wellId: string, plantCode: number): CalendarActivity => ({
      activityCode: wellId, activityName: wellId, wellId, plantCode, category: null,
      plannedStart: '2026-09-01', plannedEnd: '2026-09-02',
      actualStart: '2026-09-01', actualEnd: '2026-09-02', progress: 0, status: 'planned', isMilestone: false,
      rigOnDate: null, expectedRigOnDate: null, normsPerDay: null, productivityPct: null,
    });
    const data: CrewCalendarData = {
      totalGroups: 1, totalCrews: 4, totalActivities: 4, totalMilestones: 2,
      fromDate: '2026-09-01', toDate: '2026-09-30', milestones: [],
      groups: [{
        crewGroupCode: 'G1', activityCount: 4, completionPct: 0,
        crews: [
          { crewCode: 'Amal', activities: [makeActivity('28721', 100)] },
          { crewCode: 'Nimr', activities: [makeActivity('28736', 3522)] },
          { crewCode: 'Marmul', activities: [makeActivity('28690', 3524)] },
          { crewCode: 'Unmapped', activities: [{ ...makeActivity('100', 0), plantCode: null }] },
        ],
      }],
    };
    data.actualGroups = data.groups;
    data.retainedPlan = data.groups;
    data.milestones = [makeActivity('28721', 100), makeActivity('28736', 3522)]
      .map(activity => ({ ...activity, isMilestone: true }));
    const source = JSON.stringify(data);

    const filtered = (component as any).filterCalendarDataByGlobalSelection(data) as CrewCalendarData;

    expect(filtered.groups[0].crews.map(crew => crew.crewCode)).toEqual(['Amal']);
    expect(filtered.actualGroups?.[0].crews.map(crew => crew.crewCode)).toEqual(['Amal']);
    expect(filtered.retainedPlan?.[0].crews.map(crew => crew.crewCode)).toEqual(['Amal']);
    expect(filtered.milestones.map(activity => activity.wellId)).toEqual(['28721']);
    expect([filtered.totalGroups, filtered.totalCrews, filtered.totalActivities, filtered.totalMilestones]).toEqual([1, 1, 1, 1]);
    expect(JSON.stringify(data)).toBe(source);
  });

  it('preserves planned and actual well activities when default hierarchy selections cover all plants', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    (component as any).allPlants = [
      { country: 'Oman', sector: 'Energy', businessUnit: 'Operations', division: 'Oilfield Projects',
        cluster: 'Nimr', plantDescription: 'Nimr ODC', plantCode: 3522 },
      { country: 'Oman', sector: 'Energy', businessUnit: 'Operations', division: 'Oilfield Projects',
        cluster: 'Marmul', plantDescription: 'Marmul ODC', plantCode: 3524 },
    ];
    component.filterCountry = 'Oman';
    component.filterSector = 'Energy';
    component.filterBusinessUnit = 'Operations';
    component.filterDivision = 'Oilfield Projects';
    component.filterCluster = 'All';
    component.filterPlant = 'All';
    const planned: CalendarActivity = {
      activityCode: 'PLAN', activityName: 'Plan', wellId: '28721', category: null,
      plannedStart: '2026-09-01', plannedEnd: '2026-09-03', actualStart: null, actualEnd: null,
      progress: 0, status: 'planned', isMilestone: false, rigOnDate: null,
      expectedRigOnDate: null, normsPerDay: null, productivityPct: null,
    };
    const data: CrewCalendarData = {
      totalGroups: 1, totalCrews: 1, totalActivities: 1, totalMilestones: 0,
      fromDate: '2026-09-01', toDate: '2026-09-30', milestones: [],
      groups: [{ crewGroupCode: 'G1', activityCount: 1, completionPct: 0,
        crews: [{ crewCode: 'Crew 1', activities: [planned] }] }],
    };
    data.actualGroups = [{ ...data.groups[0], crews: [{ crewCode: 'Crew 1', activities: [
      { ...planned, activityCode: 'ACTUAL', wellId: '28736', actualStart: '2026-09-01', actualEnd: '2026-09-03' },
    ] }] }];
    const source = JSON.stringify(data);

    const filtered = (component as any).filterCalendarDataByGlobalSelection(data) as CrewCalendarData;

    expect(filtered).toBe(data);
    expect(filtered.actualGroups?.[0].crews[0].activities[0].activityCode).toBe('ACTUAL');
    expect(JSON.stringify(data)).toBe(source);
  });

  it.each([
    ['2026-09-20', '2026-09-01'], ['', '2026-09-30'], ['2026-09-01', ''],
  ])('rejects an invalid filter range %s to %s without loading or changing the calendar', (from, to) => {
    const service = { getCalendar: vi.fn() };
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, service as any, {} as any,
    );
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    component.filterFrom = from;
    component.filterTo = to;
    component.showFilterPanel = true;
    component.applyDashboardFilters();
    expect(service.getCalendar).not.toHaveBeenCalled();
    expect(component.showFilterPanel).toBe(true);
    expect([(component as any).selectedFrom, (component as any).selectedTo]).toEqual(['2026-09-01', '2026-09-30']);
  });

  it('synchronizes quick ranges and resets the filter dates and calendar to the current month', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2028, 1, 20));
    try {
      const service = { getCalendar: vi.fn(() => of({ groups: [] })) };
      const component = new ActivityBreakdownComponent(
        {} as any, {} as any, { detectChanges: vi.fn() } as any,
        {} as any, {} as any, service as any, {} as any,
      );
      component.filterFrom = '2026-12-12';
      component.filterTo = '2026-12-12';
      component.selectFilterOption('quickRange', 'This Month');
      expect([component.filterFrom, component.filterTo]).toEqual(['2028-02-01', '2028-02-29']);
      expect(service.getCalendar).not.toHaveBeenCalled();
      component.applyDashboardFilters();
      expect(service.getCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2028-02-01', to: '2028-02-29' }));
      component.filterFrom = '2028-04-02';
      component.filterTo = '2028-04-06';
      component.filterQuickRange = '';
      component.applyDashboardFilters();
      expect(service.getCalendar).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2028-04-02', to: '2028-04-06' }));
      component.setTimeUnit('day');
      component.filterCluster = 'nimr';
      component.filterPlant = 'P1';
      component.showFilterPanel = true;
      component.resetDashboardFilters();
      expect([component.filterFrom, component.filterTo]).toEqual(['2028-02-01', '2028-02-29']);
      expect([(component as any).selectedFrom, (component as any).selectedTo]).toEqual(['2028-02-01', '2028-02-29']);
      expect(component.timelineStart).toEqual(new Date(2028, 1, 1));
      expect(component.totalDays).toBe(1);
      expect(component.timeUnit).toBe('day');
      expect(component.filterQuickRange).toBe('');
      expect(component.showFilterPanel).toBe(true);
      expect(service.getCalendar).toHaveBeenLastCalledWith(expect.objectContaining({
        from: '2028-02-01', to: '2028-02-29', cluster: undefined, site: undefined,
      }));
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults to Month and displays the selected calendar month when data loads', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    expect(component.timeUnit).toBe('month');
    component.timelineStart = new Date(2026, 5, 1);
    (component as any).selectedFrom = '2026-06-01';
    (component as any).selectedTo = '2026-06-30';

    (component as any).applyCalendarData({ groups: [] });

    expect(component.days).toHaveLength(30);
    expect(component.weeks.map(header => header.label)).toEqual(['Jun 2026']);
    expect((component as any).selectedFrom).toBe('2026-06-01');
    expect((component as any).selectedTo).toBe('2026-06-30');
  });

  it('keeps four summary tiles in the unassigned view and counts every selected crew', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.showUnassigned = true;
    component.crewGroups = (component as any).mapUnassignedToCrewGroups([
      { crewGroupCode: 'G1', crewGroupName: 'Earthworks', crews: [{ crewUid: 'C1' }, { crewUid: 'C2' }] },
      { crewGroupCode: 'G2', crewGroupName: 'Welding', crews: [{ crewUid: ' c1 ' }, { crewUid: 'C3' }] },
      { crewGroupCode: 'EMPTY', crews: [] },
    ]);
    const expected = [
      { label: 'Total crew groups', count: 2 },
      { label: 'Total actual crews', count: 3 },
      { label: 'Avg Planned Utilization', count: null, unit: '%' },
      { label: 'Avg Actual Utilization', count: null, unit: '%' },
    ];
    expect(component.calendarSummary).toEqual(expected);
    component.crewGroups[0].expanded = true;
    component.scheduleFilter = 'actual';
    component.legendFilters['planned'] = false;
    expect(component.calendarSummary).toEqual(expected);
    component.searchTerm = 'Welding';
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 2, null, null]);
    component.searchTerm = '';
    component.rowFilterSelected = new Set(['C2']);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 1, null, null]);
    component.clearRowFilter();
    expect(component.calendarSummary).toEqual(expected);
    component.searchTerm = 'not matching';
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([0, 0, null, null]);
    component.showUnassigned = false;
    expect(component.calendarSummary.map(metric => metric.label)).toEqual([
      'Total crew groups', 'Total actual crews', 'Avg Planned Utilization', 'Avg Actual Utilization',
    ]);
  });

  it('keeps crew group names for tooltips without replacing row codes', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    const group = { crewGroupCode: 'G1', crewGroupName: ' Earthworks ', crews: [] };
    const assigned = (component as any).mapGroup(group, 0);
    const unassigned = (component as any).mapUnassignedToCrewGroups([group])[0];
    expect(assigned).toMatchObject({ name: 'G1', crewGroupName: 'Earthworks' });
    expect(unassigned).toMatchObject({ name: 'G1', crewGroupName: 'Earthworks' });
    expect((component as any).mapGroup({ ...group, crewGroupName: null }, 0).crewGroupName).toBeUndefined();
  });

  it('sorts all available groups by unique activities in the visible period without assigning their free crews', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.showUnassigned = true;
    component.timelineStart = new Date(2026, 8, 1);
    component.totalDays = 7;
    const activity = (activityCode: string, values = {}) => ({
      activityCode, wellId: 'W1', plannedStart: '2026-09-01', plannedEnd: '2026-09-07', ...values,
    });
    (component as any).calendarData = { groups: [
      { crewGroupCode: 'g1', crews: [{ crewCode: 'C1', activities: [
        activity('A1'), activity('A1', { source: 'assignment' }), activity('a1', { wellId: 'w1' }),
      ] }] },
      { crewGroupCode: ' G2 ', crews: [{ crewCode: '', activities: [
        activity('A2'), activity('A3', { plannedStart: '2026-08-01', plannedEnd: '2026-10-01' }),
      ] }] },
      { crewGroupCode: 'G3', crews: [{ crewCode: 'C3', activities: [
        activity('PAST', { plannedStart: '2026-08-01', plannedEnd: '2026-08-31' }),
      ] }] },
      { crewGroupCode: 'G4', crews: [{ crewCode: 'C4', activities: [
        activity('FUTURE', { plannedStart: '2026-09-08', plannedEnd: '2026-09-30' }),
      ] }] },
    ] };
    const groups = ['G4', 'G3', 'G1', 'G0', 'G2'].map(code => ({
      crewGroupCode: code, crews: [{ crewUid: `${code}-FREE`, crewTypeCode: code }],
    }));
    component.crewGroups = (component as any).mapUnassignedToCrewGroups(groups);
    expect(component.crewGroups.map(group => group.name)).toEqual(['G2', 'G1', 'G0', 'G3', 'G4']);
    expect(groups.map(group => group.crewGroupCode)).toEqual(['G4', 'G3', 'G1', 'G0', 'G2']);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([5, 5, null, null]);
    for (const group of component.crewGroups) {
      expect(group.bars).toEqual([]);
      expect(group.wells[0]).toMatchObject({
        id: `${group.name}-FREE`, activities: [], bars: [], unassigned: true, noActivities: true,
      });
    }
  });

  it('updates unassigned activity ordering when the visible week changes and preserves group expansion', () => {
    const groups = ['G2', 'G1', 'G0'].map(code => ({
      crewGroupCode: code, crews: [{ crewUid: `${code}-FREE` }],
    }));
    const calendarService = { getUnassignedCrews: vi.fn(() => of({ groups })) };
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, calendarService as any, {} as any,
    );
    component.showUnassigned = true;
    component.timeUnit = 'week';
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    (component as any).applyCalendarData({ groups: [
      { crewGroupCode: 'G1', crews: [{ crewCode: '', activities: [{
        activityCode: 'FIRST', wellId: 'W1', plannedStart: '2026-09-01', plannedEnd: '2026-09-07',
      }] }] },
      { crewGroupCode: 'G2', crews: [{ crewCode: '', activities: [{
        activityCode: 'SECOND', wellId: 'W2', plannedStart: '2026-09-08', plannedEnd: '2026-09-14',
      }] }] },
    ] });
    expect(component.crewGroups.map(group => group.name)).toEqual(['G1', 'G0', 'G2']);
    component.crewGroups[0].expanded = true;
    const summary = component.calendarSummary;
    component.navigateTimeline(1);
    expect(component.crewGroups.map(group => group.name)).toEqual(['G2', 'G0', 'G1']);
    expect(component.crewGroups.find(group => group.name === 'G1')?.expanded).toBe(true);
    expect(component.calendarSummary).toEqual(summary);
    expect(calendarService.getUnassignedCrews).toHaveBeenLastCalledWith(undefined, '2026-09-08', '2026-09-14');
  });

  it.each([0, 13, 23])('keeps full dates and the correct current-day marker across month boundaries at %s:00', hour => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.timeUnit = 'week';
    component.timelineStart = new Date(2026, 8, 27);
    component.totalDays = 7;
    component.today = new Date(2026, 8, 30, hour);
    component.todayOffset = Math.round((component.today.getTime() - component.timelineStart.getTime()) / 86_400_000);

    (component as any).buildTimeline();

    expect(component.days.map(day => day.calendarDate)).toEqual([
      new Date(2026, 8, 27), new Date(2026, 8, 28), new Date(2026, 8, 29),
      new Date(2026, 8, 30), new Date(2026, 9, 1), new Date(2026, 9, 2), new Date(2026, 9, 3),
    ]);
    expect(component.days.filter(day => day.isWeekend).map(day => day.date)).toEqual([27, 3]);
    expect(component.days.filter(day => day.isToday).map(day => day.date)).toEqual([30]);
    expect(component.weeks).toHaveLength(1);
    expect(component.weeks[0].days).toEqual(component.days);
  });

  it.each([false, true])('bounds day, week and month views by the selected range (unassigned: %s)', unassigned => {
    const calendarService = {
      getCalendar: vi.fn(() => of({ groups: [] })),
      getUnassignedCrews: vi.fn(() => of({ groups: [] })),
    };
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, calendarService as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    (component as any).fetchedFrom = new Date(2026, 8, 1);
    (component as any).fetchedTo = new Date(2026, 8, 30);
    component.showUnassigned = unassigned;
    (component as any).applyCalendarData({ groups: [] });
    const dateRange = [(component as any).selectedFrom, (component as any).selectedTo];
    calendarService.getUnassignedCrews.mockClear();

    for (const [mode, length] of [['day', 1], ['week', 7], ['month', 30], ['day', 1]] as const) {
      component.setTimeUnit(mode);
      expect([(component as any).selectedFrom, (component as any).selectedTo]).toEqual(dateRange);
      expect(component.totalDays).toBe(length);
      expect(component.days).toHaveLength(length);
      expect(component.days[0].date).toBe(1);
      expect(component.days.at(-1)?.date).toBe(length);
      expect(component.weeks).toHaveLength(1);
      expect((component as any).selectedFrom).toBe('2026-09-01');
      expect((component as any).selectedTo).toBe('2026-09-30');
      if (unassigned) {
        expect(calendarService.getUnassignedCrews).toHaveBeenLastCalledWith(undefined, '2026-09-01', `2026-09-${String(length).padStart(2, '0')}`);
      }
    }
    expect(calendarService.getCalendar).not.toHaveBeenCalled();
    (component as any).applyCalendarData({ groups: [] });
    expect([(component as any).selectedFrom, (component as any).selectedTo]).toEqual(dateRange);
    expect(component.totalDays).toBe(1);
  });

  it.each([false, true])('shows Today in the selected date view without leaving the range (unassigned: %s)', unassigned => {
    const calendarService = {
      getCalendar: vi.fn(() => of({ groups: [] })),
      getUnassignedCrews: vi.fn(() => of({ groups: [] })),
    };
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, calendarService as any, {} as any,
    );
    component.showUnassigned = unassigned;
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    (component as any).fetchedFrom = new Date(2026, 8, 1);
    (component as any).fetchedTo = new Date(2026, 8, 30);
    for (const [mode, length, from, to] of [
      ['day', 1, '2026-09-09', '2026-09-09'],
      ['week', 7, '2026-09-08', '2026-09-14'],
      ['month', 30, '2026-09-01', '2026-09-30'],
    ] as const) {
      component.today = new Date(2026, 8, 9);
      component.setTimeUnit(mode);
      component.goToToday();
      expect(component.totalDays).toBe(length);
      expect(component.days).toHaveLength(length);
      expect(component.timelineStart).toEqual(new Date(`${from}T00:00:00`));
      expect((component as any).selectedFrom).toBe('2026-09-01');
      expect((component as any).selectedTo).toBe('2026-09-30');
      if (unassigned) {
        expect(calendarService.getUnassignedCrews).toHaveBeenLastCalledWith(undefined, from, to);
      }
    }
    expect(calendarService.getCalendar).not.toHaveBeenCalled();
    component.today = new Date(2026, 9, 1);
    expect(component.canGoToToday).toBe(false);
    component.goToToday();
    expect(component.timelineStart).toEqual(new Date(2026, 8, 1));
  });

  it('clips month navigation to the selected range and respects leap February', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    (component as any).selectedFrom = '2028-02-10';
    (component as any).selectedTo = '2028-04-06';
    (component as any).fetchedFrom = new Date(2028, 1, 10);
    (component as any).fetchedTo = new Date(2028, 3, 6);
    component.setTimeUnit('month');
    expect(component.timelineStart).toEqual(new Date(2028, 1, 10));
    expect(component.totalDays).toBe(20);
    expect(component.canNavigateTimeline(-1)).toBe(false);
    component.navigateTimeline(-1);
    expect(component.days.at(-1)?.date).toBe(29);
    component.navigateTimeline(1);
    expect(component.timelineStart).toEqual(new Date(2028, 2, 1));
    expect(component.totalDays).toBe(31);
    component.navigateTimeline(1);
    expect(component.timelineStart).toEqual(new Date(2028, 3, 1));
    expect(component.totalDays).toBe(6);
    expect(component.canNavigateTimeline(1)).toBe(false);
    component.navigateTimeline(1);
    expect(component.totalDays).toBe(6);
    component.navigateTimeline(-1);
    expect(component.timelineStart).toEqual(new Date(2028, 2, 1));
    expect(component.totalDays).toBe(31);
  });

  it('keeps spanning activities in daily data and clips the last week to the selection', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    (component as any).fetchedFrom = new Date(2026, 8, 1);
    (component as any).fetchedTo = new Date(2026, 8, 30);
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).applyCalendarData({ groups: [{ crewGroupCode: 'G1', crews: [{
      crewCode: 'C1', activities: [{
        activityCode: 'SPANNING', activityName: 'Spanning activity', wellId: 'W1',
        plannedStart: '2026-08-28', plannedEnd: '2026-10-02', progress: 0,
      }, {
        activityCode: 'LATER', activityName: 'Later activity', wellId: 'W1',
        plannedStart: '2026-09-09', plannedEnd: '2026-09-10', progress: 0,
      }],
    }] }] });
    component.setTimeUnit('day');
    expect(component.calendarSummary[0].count).toBe(1);
    expect(component.crewGroups[0].wells[0].activities[0].bar.label).toBe('SPANNING');
    component.setTimeUnit('month');
    expect(component.crewGroups[0].wells[0].activities).toHaveLength(2);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 1, null, null]);
    component.setTimeUnit('week');
    for (let period = 0; period < 4; period++) component.navigateTimeline(1);
    expect(component.timelineStart).toEqual(new Date(2026, 8, 29));
    expect(component.totalDays).toBe(2);
    expect(component.canNavigateTimeline(1)).toBe(false);
    component.navigateTimeline(-1);
    expect(component.timelineStart).toEqual(new Date(2026, 8, 22));
    expect(component.totalDays).toBe(7);
  });

  it('renders only the crew rows near the visible part of an expanded calendar and keeps the scroll height', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    const crews = (prefix: string) => Array.from({ length: 100 }, (_, index) =>
      ({ id: `${prefix}-${index}`, name: `${prefix}-${index}`, activities: [], bars: [] }) as any);
    const groups = ['G1', 'G2'].map(name => ({ id: name, name, expanded: true, wells: crews(name) }) as any);
    const clusters = [{ id: 'C1', name: 'Nimr', expanded: true, groups }];
    vi.spyOn(component, 'ganttClusters', 'get').mockReturnValue(clusters);
    const list = { clientHeight: 500, scrollTop: 0 };
    (component as any).leftRows = { nativeElement: list };
    const total = 100 * 56;

    // Cluster row 40 px, then G1 header 56 px; G1 crews start at 96 px. Window = 0..(500 + 400 + 1200) px.
    let first = component.crewWindow(groups[0]);
    let second = component.crewWindow(groups[1]);
    expect(first.start).toBe(0);
    expect(first.crews.map(crew => crew.id)).toEqual(groups[0].wells.slice(0, 36).map((crew: any) => crew.id));
    expect(first.before + first.crews.length * 56 + first.after).toBe(total);
    expect(second.crews).toHaveLength(0);
    expect(second.before + second.after).toBe(total);
    expect(component.crewWindow(groups[0])).toBe(first);

    list.scrollTop = 6000;
    first = component.crewWindow(groups[0]);
    second = component.crewWindow(groups[1]);
    expect(first.crews.length).toBeGreaterThan(0);
    expect(first.start).toBeGreaterThan(0);
    expect(first.before).toBe(first.start * 56);
    expect(first.before + first.crews.length * 56 + first.after).toBe(total);
    expect(second.start).toBe(0);
    expect(second.crews.length).toBeGreaterThan(0);
    expect(second.crews.length).toBeLessThan(100);
    expect(second.before + second.crews.length * 56 + second.after).toBe(total);

    list.clientHeight = 0;
    expect(component.crewWindow(groups[0]).crews).toHaveLength(100);
    expect(component.crewWindow(groups[1]).crews).toHaveLength(100);

    // Crew planning rows use their own heights; spacers must add up to the same total.
    (component as any).calendarData = { groups: [], milestones: [], roster: { groups: [] } };
    groups[0].wells.forEach((crew: any, index: number) => { crew.rowHeight = index % 3 ? 56 : 98; });
    const planningClusters = [{ ...clusters[0], groups: [...groups] }];
    vi.spyOn(component, 'ganttClusters', 'get').mockReturnValue(planningClusters);
    list.clientHeight = 500;
    list.scrollTop = 3000;
    const planned = component.crewWindow(groups[0]);
    const heights = groups[0].wells.map((crew: any) => crew.rowHeight);
    const sum = (values: number[]) => values.reduce((total: number, value: number) => total + value, 0);
    expect(planned.crews.length).toBeGreaterThan(0);
    expect(planned.before).toBe(sum(heights.slice(0, planned.start)));
    expect(planned.before + sum(planned.crews.map((crew: any) => crew.rowHeight)) + planned.after).toBe(sum(heights));
  });

  it('applies the crew search once typing pauses and clears a pending search with All', () => {
    vi.useFakeTimers();
    try {
      const detectChanges = vi.fn();
      const component = new ActivityBreakdownComponent(
        {} as any, {} as any, { detectChanges } as any,
        {} as any, {} as any, {} as any, {} as any,
      );
      for (const value of ['F', 'FB', 'FBB']) {
        component.onSearchInput(value);
        vi.advanceTimersByTime(100);
      }
      expect(component.searchInput).toBe('FBB');
      expect(component.searchTerm).toBe('');
      expect(detectChanges).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(component.searchTerm).toBe('FBB');
      expect(detectChanges).toHaveBeenCalledOnce();

      component.onSearchInput('FBB-05');
      const box = document.createElement('input');
      box.value = 'FBB-05';
      component.crewSearchInput = { nativeElement: box } as any;
      component.clearRowFilter();
      vi.advanceTimersByTime(1000);
      expect(box.value).toBe('');
      expect(component.searchInput).toBe('');
      expect(component.searchTerm).toBe('');
      expect(detectChanges).toHaveBeenCalledOnce();

      box.value = 'G2';
      box.dispatchEvent(new Event('input'));
      expect(component.searchInput).toBe('G2');
      vi.advanceTimersByTime(300);
      expect(component.searchTerm).toBe('G2');

      component.ngOnDestroy();
      box.value = 'ignored';
      box.dispatchEvent(new Event('input'));
      expect(component.searchInput).toBe('G2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores all rows and summary counts when All clears search and row selections', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    (component as any).applyCalendarData({ groups: ['G1', 'G2'].map(group => ({
      crewGroupCode: group,
      crews: [{ crewCode: `${group}-CREW`, activities: [{
        activityCode: `${group}-ACTIVITY`, activityName: group, wellId: group,
        plannedStart: '2026-09-01', plannedEnd: '2026-09-10',
        actualStart: null, actualEnd: null, progress: 0, status: 'planned',
      }] }],
    })) });
    const dateRange = [(component as any).selectedFrom, (component as any).selectedTo];
    const summary = component.calendarSummary;
    for (const search of ['G1', 'no matching crew']) {
      component.searchTerm = search;
      component.rowFilterSelected = new Set(['G1-CREW']);
      component.showRowFilter = true;
      expect(component.filteredGroups.length).toBeLessThan(2);

      component.clearRowFilter();

      expect(component.searchTerm).toBe('');
      expect(component.rowFilterSelected.size).toBe(0);
      expect(component.showRowFilter).toBe(false);
      expect(component.filteredGroups).toEqual(component.crewGroups);
      expect(component.ganttGroups).toEqual(component.crewGroups);
      expect(component.calendarSummary).toEqual(summary);
      expect([(component as any).selectedFrom, (component as any).selectedTo]).toEqual(dateRange);
    }
  });

  it('uses gray for Maps bars and preserves separate planned and actual colors for legacy or mixed bars', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    component.totalDays = 30;
    const activity = {
      activityCode: 'MAPS', plannedStart: '2026-09-05', plannedEnd: '2026-09-06',
      actualStart: '2026-09-05', actualEnd: '2026-09-06', progress: 100, source: 'assignment',
    };
    const maps = (component as any).mapActivityToBar(activity, true);
    const legacy = (component as any).mapActivityToBar({ ...activity, source: 'legacy' }, true);
    const gray = { background: '#6B7280', 'border-color': '#4B5563', color: '#FFFFFF' };
    expect(component.barStyle(maps)).toMatchObject(gray);
    expect(component.actualBarStyle(maps)).toMatchObject(gray);
    const summary = (component as any).summarizeBars([maps])[0];
    expect(component.barStyle(summary)).toMatchObject(gray);
    expect(component.actualBarStyle(summary)).toMatchObject(gray);
    expect(component.barStyle(legacy)['background']).toBe('#F97316');
    const mixed = (component as any).summarizeBars([maps, legacy])[0];
    expect(component.barStyle(mixed)['background']).toBe('#F97316');
    expect(component.actualBarStyle(mixed)['background']).toBe('#1D4ED8');
  });

  it('keeps end-only actual work visible in a single summary beside work that has not started', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    component.totalDays = 30;
    const planned = (component as any).mapActivityToBar({
      activityCode: 'PLANNED', plannedStart: '2026-09-01', plannedEnd: '2026-09-30', progress: 0,
    }, true);
    const completed = (component as any).mapActivityToBar({
      activityCode: 'COMPLETED', plannedStart: '2026-09-01', plannedEnd: '2026-09-10',
      actualEnd: '2026-09-05', progress: 100,
    }, true);
    const bars = (component as any).summarizeBars([planned, completed]);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ actualStart: undefined, actualEnd: undefined, actualSpanDays: 5 });
    expect(component.showPlannedBar(bars[0])).toBe(true);
    expect(component.showActualBar(bars[0])).toBe(false);
    component.setScheduleFilter('actual');
    expect(component.showPlannedBar(bars[0])).toBe(false);
    expect(component.showActualBar(bars[0])).toBe(true);
    expect(component.actualBarStyle(bars[0])).toMatchObject({
      left: '0%', width: `${5 / 30 * 100}%`, display: 'flex', background: '#1D4ED8',
    });
    component.toggleLegendFilter('actual');
    expect(component.showActualBar(bars[0])).toBe(false);
    component.setScheduleFilter('planned');
    expect(component.showPlannedBar(bars[0])).toBe(true);
  });

  it.each([false, true])('keeps completed planned and actual bars in their separate views (summary: %s)', summary => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    component.totalDays = 30;
    const activity = {
      activityCode: 'COMPLETED', activityName: 'Completed work', wellId: 'W1',
      plannedStart: '2026-09-01', plannedEnd: '2026-09-10',
      actualStart: '2026-09-02', actualEnd: '2026-09-08', progress: 100, source: 'legacy',
    };
    const activityBar = (component as any).mapActivityToBar(activity, true);
    const bar = summary ? (component as any).summarizeBars([activityBar])[0] : activityBar;

    expect(bar.type).toBe('completed');
    expect(component.showPlannedBar(bar)).toBe(true);
    expect(component.showActualBar(bar)).toBe(false);
    expect(component.barStyle(bar)).toMatchObject({
      left: '0%', width: `${10 / 30 * 100}%`, display: 'flex', background: '#F97316',
    });
    expect(component.actualBarStyle(bar)).toMatchObject({
      left: `${1 / 30 * 100}%`, width: `${7 / 30 * 100}%`, display: 'flex',
    });
    if (summary) {
      expect(component.barStyle(bar)).toMatchObject({ top: '0px', height: '12px' });
      expect(component.actualBarStyle(bar)).toMatchObject({ top: '0px', height: '12px', background: '#1D4ED8' });
    }

    component.scheduleFilter = 'planned';
    expect(component.showPlannedBar(bar)).toBe(true);
    expect(component.showActualBar(bar)).toBe(false);
    expect(component.barStyle(bar)['background']).toBe('#F97316');
    component.scheduleFilter = 'actual';
    expect(component.showPlannedBar(bar)).toBe(false);
    expect(component.showActualBar(bar)).toBe(true);
    if (summary) expect(component.actualBarStyle(bar)).toMatchObject({ height: '12px', background: '#1D4ED8' });
    component.scheduleFilter = 'planned-actual';
    component.toggleLegendFilter('actual');
    expect(component.showPlannedBar(bar)).toBe(true);
    expect(component.showActualBar(bar)).toBe(false);
    component.toggleLegendFilter('planned');
    expect(component.showPlannedBar(bar)).toBe(false);
  });

  it.each([false, true])('does not extend completed actual work into its visible planned dates (summary: %s)', summary => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 7);
    (component as any).selectedFrom = '2026-09-07';
    (component as any).selectedTo = '2026-09-30';
    const activity = {
      activityCode: 'LCPC1030-36736', activityName: 'Completed activity', wellId: '33151',
      plannedStart: '2026-02-12', plannedEnd: '2029-01-28',
      actualStart: '2026-02-12', actualEnd: '2026-02-16', progress: 100, status: 'completed',
    };
    (component as any).applyCalendarData({ groups: [{
      crewGroupCode: 'LCP-0511', crews: [{ crewCode: 'NIM_CWL0511_R6', activities: [activity] }],
    }] });
    const group = component.crewGroups[0];
    const bar = summary ? group.bars[0] : group.wells[0].activities[0].bar;

    expect(component.showPlannedBar(bar)).toBe(true);
    expect(component.showActualBar(bar)).toBe(false);
    expect(component.barStyle(bar)).toMatchObject({ left: '0%', width: '100%', display: 'flex', background: '#F97316' });
    expect(component.actualBarStyle(bar)['display']).toBe('none');
    expect([bar.actualStart, bar.actualEnd]).toEqual(['2026-02-12', '2026-02-16']);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 1, null, null]);
    if (summary) {
      expect(component.actualBarStyle(bar)).toMatchObject({ height: '12px', background: '#1D4ED8' });
    }

    component.scheduleFilter = 'actual';
    expect(component.actualBarStyle(bar)['display']).toBe('none');
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 1, null, null]);
    expect(component.ganttGroups).toEqual([group]);
    expect(component.visibleCrewBars(group.wells[0])).toEqual([]);
    component.scheduleFilter = 'planned';
    expect(component.showActualBar(bar)).toBe(false);
    expect(activity.actualStart).toBe('2026-02-12');
    expect(activity.actualEnd).toBe('2026-02-16');
  });

  it('counts every crew under the selected Gantt groups independently of expansion', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timeUnit = 'month';
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const activity = (activityCode: string, wellId: string, values = {}) => ({
      activityCode, activityName: activityCode, wellId,
      plannedStart: '2026-09-01', plannedEnd: '2026-09-10',
      actualStart: null, actualEnd: null, progress: 0, status: 'planned', ...values,
    });
    const started = activity('A1', 'W1', { actualStart: '2026-09-02' });
    (component as any).applyCalendarData({ groups: [
      { crewGroupCode: 'G1', crews: [
        { crewCode: 'C1', activities: [started, { ...started, source: 'assignment' },
          activity('A1', 'W2', { actualEnd: '2026-09-03' }),
          activity('A2', 'W1', { progress: 100 }),
          activity('BEFORE', 'W1', { actualStart: '2026-08-31', actualEnd: '2026-09-05' }),
          activity('AFTER', 'W1', { actualStart: '2026-10-01' }),
          activity('FIRST', 'W1', { actualStart: '2026-09-01' }),
          activity('LAST', 'W1', { actualStart: '2026-09-30' })] },
        { crewCode: '', activities: [activity('A3', '', { actualStart: '2026-09-04' })] },
      ] },
      { crewGroupCode: 'G2', crews: [{ crewCode: 'C2', activities: [
        activity('A4', 'W3'),
        activity('OLD', 'W4', { plannedStart: '2026-01-17', plannedEnd: '2026-03-17', actualStart: '2026-01-17' }),
      ] }] },
    ] });
    component.today = new Date(2026, 8, 15);
    component.todayOffset = 14;
    const counts = () => component.calendarSummary.map(metric => metric.count);
    expect(component.calendarSummary.map(metric => metric.label)).toEqual([
      'Total crew groups', 'Total actual crews', 'Avg Planned Utilization', 'Avg Actual Utilization',
    ]);
    expect(counts()).toEqual([2, 2, null, null]);
    component.crewGroups[0].expanded = true;
    component.crewGroups[0].wells[0].expanded = true;
    expect(counts()).toEqual([2, 2, null, null]);
    component.scheduleFilter = 'planned';
    expect(counts()).toEqual([2, 2, null, null]);
    component.scheduleFilter = 'actual';
    expect(counts()).toEqual([2, 2, null, null]);
    expect(component.ganttGroups.map(group => group.name)).toEqual(['G1', 'G2']);
    component.rowFilterSelected = new Set(['G2']);
    expect(counts()).toEqual([1, 1, null, null]);
    expect(component.ganttGroups.map(group => group.name)).toEqual(['G2']);
    component.scheduleFilter = 'planned';
    expect(counts()).toEqual([1, 1, null, null]);
    component.scheduleFilter = 'planned-actual';
    expect(counts()).toEqual([1, 1, null, null]);
    component.rowFilterSelected.clear();
    component.timelineStart = new Date(2026, 9, 1);
    component.totalDays = 30;
    (component as any).rebuildBars();
    expect(counts()).toEqual([0, 0, null, null]);
  });

  it('filters actual groups, crews, activities and summaries without changing stored rows or expansion', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timeUnit = 'week';
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const activity = (activityCode: string, values = {}) => ({
      activityCode, activityName: activityCode, wellId: 'W1',
      plannedStart: '2026-09-01', plannedEnd: '2026-09-30',
      actualStart: null, actualEnd: null, progress: 0, status: 'planned', ...values,
    });
    (component as any).applyCalendarData({ groups: [
      { crewGroupCode: 'MIXED', crews: [
        { crewCode: 'ACTUAL-CREW', activities: [
          activity('DONE', { actualStart: '2026-08-30', actualEnd: '2026-09-02' }),
          activity('PLANNED'),
          activity('ENDED-BEFORE', { actualStart: '2026-08-01', actualEnd: '2026-08-31' }),
          activity('STARTS-LATER', { actualStart: '2026-09-08', actualEnd: '2026-09-10' }),
        ] },
        { crewCode: 'PLANNED-CREW', activities: [activity('PLAN-W2', { wellId: 'W2' })] },
        { crewCode: '', activities: [
          activity('MISSING-CREW', { actualStart: '2026-09-01' }), activity('UNASSIGNED-PLAN'),
        ] },
      ] },
      { crewGroupCode: 'PLANNED-GROUP', crews: [{
        crewCode: 'OTHER-CREW', activities: [activity('PLAN-W3', { wellId: 'W3' })],
      }] },
    ] });
    const stored = component.crewGroups;
    const group = stored[0];
    const crew = group.wells[0];
    group.expanded = true;
    crew.expanded = true;
    component.scheduleFilter = 'actual';

    expect(component.ganttGroups).toEqual(stored);
    expect(component.ganttGroups[0]).toBe(group);
    expect(component.visibleCrews(group).map(row => row.id)).toEqual(['ACTUAL-CREW', 'PLANNED-CREW']);
    expect(component.visibleActivities(crew).map(row => row.bar.label)).toEqual(['DONE']);
    expect(component.groupActivities(group).map(row => row.bar.label)).toEqual(['DONE']);
    expect(component.visibleBars(group).flatMap(bar => bar.activities!.map(record => record.activityCode)).sort())
      .toEqual(['DONE']);
    expect(component.visibleBars(crew).flatMap(bar => bar.activities!.map(record => record.activityCode)))
      .toEqual(['DONE']);
    expect(component.filteredWellRows.map(well => well.id)).toEqual(['W1']);
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([2, 3, null, null]);
    const missingCrew = group.wells.find(row => row.unassigned)!;
    expect(component.hasMissingCrewId(missingCrew.activities[0].bar)).toBe(true);
    expect(component.hasMissingCrewId(missingCrew.activities[1].bar)).toBe(false);
    expect(component.hasMissingCrewId(crew.activities[0].bar)).toBe(false);
    expect(component.groupHasMissingCrewId(group)).toBe(false);
    expect(component.groupHasMissingCrewId(stored[1])).toBe(false);
    for (const bar of component.visibleBars(group)) {
      component.showTooltip(new MouseEvent('mouseenter'), bar);
      for (const record of component.tooltipActivities) {
        expect(record.crewId).toBe('ACTUAL-CREW');
      }
    }
    expect((component as any).calendarData.groups[0].crews[2].activities[0]).not.toHaveProperty('crewId');

    component.legendFilters['actual'] = false;
    expect(component.ganttGroups).toEqual(stored);
    component.rowFilterSelected = new Set(['PLANNED-CREW']);
    expect(component.ganttGroups).toHaveLength(1);
    expect(component.visibleCrews(component.ganttGroups[0]).map(row => row.id)).toEqual(['PLANNED-CREW']);
    expect(component.visibleBars(component.ganttGroups[0])).toEqual([]);
    component.clearRowFilter();
    component.scheduleFilter = 'planned-actual';
    expect(component.crewGroups).toBe(stored);
    expect(component.ganttGroups).toEqual(stored);
    expect(component.visibleCrews(group)).toBe(group.wells);
    expect(component.visibleActivities(crew)).toBe(crew.activities);
    expect(group.expanded).toBe(true);
    expect(crew.expanded).toBe(true);

    component.showUnassigned = true;
    component.scheduleFilter = 'actual';
    expect(component.ganttGroups).toEqual(stored);
    expect(component.visibleCrews(group)).toBe(group.wells);
    expect(component.groupHasMissingCrewId(group)).toBe(false);
  });

  it('counts groups and actual crews from the Gantt selection for each bar mode', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    component.timeUnit = 'month';
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const activity = {
      activityCode: 'ACTIVITY', activityName: 'Activity', wellId: 'W1',
      plannedStart: '2026-09-01', plannedEnd: '2026-09-30',
      actualStart: null, actualEnd: null, progress: 0, status: 'planned',
    };
    const groups = [
      { code: 'PLANNED', values: {} },
      { code: 'ONGOING', values: { actualStart: '2026-08-30' } },
      { code: 'ENDED', values: { actualEnd: '2026-09-03' } },
      { code: 'FIRST-DAY', values: { actualStart: '2026-08-01', actualEnd: '2026-09-01' } },
      { code: 'LAST-DAY', values: { actualStart: '2026-09-30', actualEnd: '2026-10-02' } },
      { code: 'BEFORE', values: { actualStart: '2026-08-01', actualEnd: '2026-08-31' } },
      { code: 'AFTER', values: { actualStart: '2026-10-01', actualEnd: '2026-10-02' } },
      { code: 'NO-DATES', values: { status: 'completed', progress: 100 } },
    ];
    (component as any).applyCalendarData({ groups: groups.map(group => ({
      crewGroupCode: group.code,
      crews: [{ crewCode: `${group.code}-CREW`, activities: [
        { ...activity, ...group.values },
        { ...activity, ...group.values, source: 'assignment' },
      ] }],
    })) });
    component.today = new Date(2026, 8, 15);
    component.todayOffset = 14;
    const groupCount = () => component.calendarSummary.find(metric => metric.label === 'Total crew groups')!.count;
    const crewCount = () => component.calendarSummary.find(metric => metric.label === 'Total actual crews')!.count;
    expect(groupCount()).toBe(8);
    expect(crewCount()).toBe(8);
    component.scheduleFilter = 'planned';
    expect(groupCount()).toBe(8);
    component.scheduleFilter = 'actual';
    expect(groupCount()).toBe(8);
    expect(crewCount()).toBe(8);
    component.searchTerm = 'NO-DATES';
    expect(groupCount()).toBe(1);
    expect(crewCount()).toBe(1);
    component.searchTerm = 'ONGOING';
    expect(groupCount()).toBe(1);
    expect(crewCount()).toBe(1);
    component.searchTerm = '';
    component.scheduleFilter = 'planned-actual';
    expect(groupCount()).toBe(8);
    expect(crewCount()).toBe(8);
  });

  it.each([
    ['2026-06-01', '2026-09-30', 4, 8],
    ['2026-09-10', '2026-09-10', 2, 8],
    ['2026-09-11', '2026-09-30', 1, 8],
  ])('matches Actual-only bar overlap for %s to %s without counting out-of-range completed references', (from, to, expected, plannedCount) => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    (component as any).selectedFrom = from;
    (component as any).selectedTo = to;
    const activity = (activityCode: string, values = {}) => ({
      activityCode, activityName: activityCode, wellId: 'W1',
      plannedStart: '2026-06-01', plannedEnd: '2026-09-30',
      actualStart: null, actualEnd: null, progress: 0, status: 'planned', ...values,
    });
    const ongoing = activity('ONGOING', { actualStart: '2026-02-09', progress: 90 });
    (component as any).applyCalendarData({ groups: [{ crewGroupCode: 'G1', crews: [{
      crewCode: '', activities: [
        ongoing, { ...ongoing, source: 'assignment' },
        activity('ENDED-BEFORE', { actualStart: '2026-05-01', actualEnd: '2026-05-31' }),
        activity('ENDS-ON-FIRST', { actualStart: '2026-05-01', actualEnd: '2026-06-01' }),
        activity('STARTS-ON-LAST', { actualStart: '2026-09-30', actualEnd: '2026-10-02' }),
        activity('STARTS-AFTER', { actualStart: '2026-10-01', actualEnd: '2026-10-02' }),
        activity('COMPLETED-FALLBACK', { progress: 100 }),
        activity('COMPLETED-WITHOUT-END', { actualStart: '2026-02-01', status: 'completed', progress: 100 }),
        activity('PLANNED-ONLY'),
        activity('OUTSIDE-PLAN', { plannedStart: '2026-01-01', plannedEnd: '2026-01-31', actualStart: '2026-01-01' }),
      ],
    }] }] });
    component.timelineStart = new Date(`${from}T00:00:00`);
    component.totalDays = Math.round((new Date(`${to}T00:00:00`).getTime() - component.timelineStart.getTime()) / 86_400_000) + 1;
    (component as any).rebuildBars();
    component.today = new Date(2026, 8, 10);
    component.todayOffset = Math.round((component.today.getTime() - component.timelineStart.getTime()) / 86_400_000);
    const bars = component.crewGroups.flatMap(group => group.wells.flatMap(crew => crew.activities.map(row => row.bar)));
    component.scheduleFilter = 'actual';
    const actualBars = new Set(bars.filter(bar => component.showActualBar(bar) && component.actualBarStyle(bar)['display'] !== 'none')
      .map(bar => JSON.stringify([bar.label, bar.wellId])));
    expect(actualBars.size).toBe(expected);
    component.scheduleFilter = 'planned-actual';
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([1, 0, null, null]);
    expect(new Set(bars.filter(bar => component.barStyle(bar)['display'] !== 'none')
      .map(bar => JSON.stringify([bar.label, bar.wellId]))).size).toBe(plannedCount);
    const summary = component.calendarSummary;
    component.scheduleFilter = 'planned';
    component.legendFilters['actual'] = false;
    expect(component.calendarSummary).toEqual(summary);
    component.scheduleFilter = 'actual';
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([0, 0, null, null]);
    component.scheduleFilter = 'planned-actual';
    expect(component.calendarSummary).toEqual(summary);
    component.searchTerm = 'not-matching';
    expect(component.calendarSummary.map(metric => metric.count)).toEqual([0, 0, null, null]);
  });

  it('requires an actual end for completion regardless of progress or reported status', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    const activity = {
      plannedStart: '2026-09-01', plannedEnd: '2026-09-10',
      progress: 0, status: 'delayed', actualStart: null, actualEnd: null,
    };
    const bar = (values: object, hasCrew: boolean) =>
      (component as any).mapActivityToBar({ ...activity, ...values }, hasCrew);
    expect(bar({}, true).type).toBe('planned');
    expect(bar({}, false).type).toBe('planned');
    expect(bar({ actualStart: '2026-09-02' }, true).type).toBe('in-progress');
    expect(bar({ actualStart: '2026-09-02' }, false).type).toBe('in-progress');
    expect(bar({ actualEnd: '2026-09-05' }, true).type).toBe('completed');
    expect(bar({ progress: 100, status: 'completed' }, true).type).toBe('planned');
    const started = bar({ actualStart: '2026-09-02', progress: 100, status: 'completed' }, true);
    expect(started).toMatchObject({ type: 'in-progress', progress: 100, completionMarker: false });
    expect(started.actualEnd).toBeUndefined();
    component.timelineStart = new Date(2026, 8, 1);
    component.totalDays = 30;
    component.todayOffset = 14;
    component.today = new Date(2026, 8, 15);
    expect(component.actualBarStyle(started)).toMatchObject({ left: `${1 / 30 * 100}%`, width: `${14 / 30 * 100}%`, display: 'flex' });
    expect(component.actualDatesLabel(started.activities[0])).toBe('2026-09-02 → Ongoing');
    expect((component as any).summarizeBars([started])[0]).toMatchObject({ type: 'in-progress', actualEnd: undefined });
    expect((component as any).mergeCrewBars(started.activities)[0].type).not.toBe('completed');
    expect((component as any).mergeGroupBars({ crews: [{ activities: started.activities }] })[0].type).not.toBe('completed');
    const ended = bar({ actualStart: '2026-09-02', actualEnd: '2026-09-05', progress: 40 }, true);
    expect(ended).toMatchObject({ type: 'completed', actualEnd: '2026-09-05', completionMarker: true });
    expect(component.actualDatesLabel(ended.activities[0])).toBe('2026-09-02 → 2026-09-05');
  });

  function assignmentFixture() {
    const calendarService = {
      assignActivity: vi.fn(() => of({ id: 1 })),
      getAssignableActivities: vi.fn(() => of({ activities: [
        { activityCode: 'A1', activityName: 'Concrete work' },
        { activityCode: 'A2', activityName: 'Excavation' },
      ] })),
      getUnassignedCrews: vi.fn(() => of({ groups: [] })),
    };
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any,
      { detectChanges: vi.fn(), markForCheck: vi.fn() } as any,
      {} as any, {} as any, calendarService as any, {} as any,
    );
    component.showUnassigned = true;
    component.openAssign('G1', 'Group', 'C1', 'G1');
    return { component, calendarService };
  }

  it('keeps multiple selections while searching by name or code and assigns each once', () => {
    const { component, calendarService } = assignmentFixture();
    component.toggleAssignActivity('A1');
    component.assignPanel!.activitySearch = 'excavation';
    expect(component.filteredAssignActivities.map(activity => activity.activityCode)).toEqual(['A2']);
    component.toggleAssignActivity('A2');
    component.assignPanel!.activitySearch = 'a1';
    expect(component.filteredAssignActivities).toHaveLength(1);
    component.assignPanel!.plannedStart = '2026-10-01';
    component.assignPanel!.plannedEnd = '2026-10-03';
    component.confirmAssign();
    expect(calendarService.assignActivity).toHaveBeenCalledTimes(2);
    for (const activityCode of ['A1', 'A2']) {
      expect(calendarService.assignActivity).toHaveBeenCalledWith(expect.objectContaining({
        activityCode, crewUid: 'C1', plannedStart: '2026-10-01', plannedEnd: '2026-10-03',
      }));
    }
    expect(calendarService.getUnassignedCrews).toHaveBeenCalledTimes(1);
    expect(component.assignPanel).toBeNull();
  });

  it('retains only failed selections for retry after partial success', () => {
    const { component, calendarService } = assignmentFixture();
    calendarService.assignActivity.mockReturnValueOnce(of({ id: 1 }))
      .mockReturnValueOnce(throwError(() => ({ error: { message: 'Already assigned' } })));
    component.toggleAssignActivity('A1');
    component.toggleAssignActivity('A2');
    component.confirmAssign();
    expect(component.assignPanel!.selectedActivityCodes).toEqual(['A2']);
    expect(component.assignPanel!.activities.map(activity => activity.activityCode)).toEqual(['A2']);
    expect(component.assignError).toContain('1 assigned; 1 failed. A2: Already assigned');
    component.confirmAssign();
    expect(calendarService.assignActivity).toHaveBeenCalledTimes(3);
    expect(calendarService.assignActivity).toHaveBeenLastCalledWith(expect.objectContaining({ activityCode: 'A2' }));
    expect(component.assignPanel).toBeNull();
  });

  it('blocks closing and duplicate submission while saving activities sequentially', () => {
    const { component, calendarService } = assignmentFixture();
    const response = new Subject<{ id: number }>();
    calendarService.assignActivity.mockReturnValueOnce(response);
    component.toggleAssignActivity('A1');
    component.toggleAssignActivity('A2');
    component.confirmAssign();
    component.closeAssign();
    component.confirmAssign();
    expect(component.assignPanel!.saving).toBe(true);
    expect(calendarService.assignActivity).toHaveBeenCalledTimes(1);
    response.next({ id: 1 });
    response.complete();
    expect(calendarService.assignActivity).toHaveBeenCalledTimes(2);
    expect(component.assignPanel).toBeNull();
  });

  it('rejects reversed dates before sending any assignments', () => {
    const { component, calendarService } = assignmentFixture();
    component.toggleAssignActivity('A1');
    component.assignPanel!.plannedStart = '2026-10-03';
    component.assignPanel!.plannedEnd = '2026-10-01';
    component.confirmAssign();
    expect(calendarService.assignActivity).not.toHaveBeenCalled();
    expect(component.assignError).toContain('Planned end must be on or after planned start');
  });

  it('keeps the visible date range when an activity is assigned for a different period', () => {
    const calendarService = {
      assignActivity: vi.fn(() => of({ id: 1 })),
      getUnassignedCrews: vi.fn(() => of({ groups: [{
        crewGroupCode: 'G1', crews: [{ crewUid: 'C1', crewTypeCode: 'G1' }],
      }] })),
      getCalendar: vi.fn(),
    };
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any,
      { detectChanges: vi.fn(), markForCheck: vi.fn() } as any,
      {} as any, {} as any, calendarService as any, {} as any,
    );
    component.showUnassigned = true;
    component.timelineStart = new Date(2026, 8, 1);
    component.totalDays = 30;
    component.assignPanel = {
      crewGroupCode: 'G1', crewGroupName: 'Group', crewUid: 'C1', crewTypeCode: 'G1',
      activities: [{ activityCode: 'A1', activityName: 'Activity' } as any],
      loadingActivities: false, selectedActivityCodes: ['A1'], activitySearch: '',
      plannedStart: '2026-10-01', plannedEnd: '2026-10-03', saving: false,
    };

    component.confirmAssign();

    expect(calendarService.assignActivity).toHaveBeenCalledWith(expect.objectContaining({
      crewUid: 'C1', activityCode: 'A1', plannedStart: '2026-10-01', plannedEnd: '2026-10-03',
    }));
    expect(calendarService.getUnassignedCrews).toHaveBeenCalledWith(undefined, '2026-09-01', '2026-09-30');
    expect(calendarService.getCalendar).not.toHaveBeenCalled();
    expect(component.totalDays).toBe(30);
    expect(component.crewGroups[0].wells[0].id).toBe('C1');
    expect(component.assignPanel).toBeNull();
  });

  it('reloads unassigned crews for inline date changes instead of rebuilding assigned bars', () => {
    const calendarService = {
      getUnassignedCrews: vi.fn(() => of({ groups: [{
        crewGroupCode: 'EMPTY',
        crewGroupName: 'Unassigned group',
        crews: [{ crewUid: 'EMPTY-01', crewTypeCode: 'EMPTY' }],
      }] })),
    };
    const component = new ActivityBreakdownComponent(
      {} as any,
      { navigate: vi.fn() } as any,
      { detectChanges: vi.fn(), markForCheck: vi.fn() } as any,
      {} as any,
      {} as any,
      calendarService as any,
      {} as any,
    );
    component.showUnassigned = true;
    component.timeUnit = 'week';
    component.timelineStart = new Date(2026, 8, 1);
    component.totalDays = 35;
    (component as any).fetchedFrom = new Date(2026, 0, 1);
    (component as any).fetchedTo = new Date(2026, 11, 31);
    const rebuildBars = vi.spyOn(component as any, 'rebuildBars');

    component.navigateTimeline(1);

    expect(calendarService.getUnassignedCrews).toHaveBeenLastCalledWith(undefined, '2026-09-08', '2026-09-14');
    expect(rebuildBars).not.toHaveBeenCalled();
    expect(component.crewGroups[0].wells[0]).toMatchObject({ id: 'EMPTY-01', unassigned: true, activities: [], bars: [] });

    component.today = new Date(2026, 8, 8);
    component.goToToday();
    expect(calendarService.getUnassignedCrews).toHaveBeenLastCalledWith(undefined, '2026-09-08', '2026-09-14');
    const requests = calendarService.getUnassignedCrews.mock.calls.length;
    component.setTimeUnit('day');
    expect(calendarService.getUnassignedCrews).toHaveBeenCalledTimes(requests + 1);
    expect(component.totalDays).toBe(1);
    (component as any).fetchedFrom = null;
    (component as any).fetchedTo = null;
    component.navigateTimeline(-1);
    expect(calendarService.getUnassignedCrews).toHaveBeenLastCalledWith(undefined, '2026-09-07', '2026-09-07');
    expect(rebuildBars).not.toHaveBeenCalled();
  });

  it.each([
    ['2026-10-01', '2026-10-31'],
    ['2027-01-01', '2027-01-31'],
  ])('preserves the %s to %s window and scope when switching crew views', (from, to) => {
    const data = { groups: [{ crewGroupCode: 'G1', crews: [{
      crewCode: 'C1', activities: [{
        activityCode: 'ACT-1', activityName: 'Future activity', wellId: '2064',
        plannedStart: from, plannedEnd: to, actualStart: null, actualEnd: null,
        progress: 0, status: 'planned',
      }],
    }] }] };
    const calendarService = {
      getCalendar: vi.fn(() => of(data)),
      getUnassignedCrews: vi.fn(() => of({ groups: [] })),
    };
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, calendarService as any, {} as any,
    );
    (component as any).selectedFrom = from;
    (component as any).selectedTo = to;
    (component as any).calendarScope = { cluster: 'nimr', project: 'P1' };
    component.timeUnit = 'month';
    (component as any).applyCalendarData(data);
    const summary = component.calendarSummary;
    const dateRange = [(component as any).selectedFrom, (component as any).selectedTo];

    component.setCrewView('unassigned');
    component.setCrewView('assigned');

    expect(calendarService.getCalendar).toHaveBeenCalledTimes(2);
    for (const [request] of (calendarService.getCalendar.mock.calls as any[][])) {
      expect(request).toMatchObject({ from, to, cluster: 'nimr', project: 'P1', includeAssignments: false });
    }
    expect(calendarService.getUnassignedCrews).toHaveBeenCalledWith(undefined, from, to);
    expect([(component as any).selectedFrom, (component as any).selectedTo]).toEqual(dateRange);
    expect(component.calendarSummary).toEqual(summary);
    expect(component.crewGroups[0].wells[0].activities[0].bar.label).toBe('ACT-1');
  });

  it('keeps assigned calendar rows out of the unassigned view and ignores stale unassigned responses', () => {
    const firstResponse = new Subject<any>();
    const secondResponse = new Subject<any>();
    const thirdResponse = new Subject<any>();
    const calendarService = {
      getUnassignedCrews: vi.fn()
        .mockReturnValueOnce(firstResponse)
        .mockReturnValueOnce(secondResponse)
        .mockReturnValueOnce(thirdResponse),
      getCalendar: vi.fn(() => of({ groups: [] })),
    };
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any,
      { detectChanges: vi.fn(), markForCheck: vi.fn() } as any,
      {} as any, {} as any, calendarService as any, {} as any,
    );
    component.timeUnit = 'week';
    component.timelineStart = new Date(2026, 8, 1);
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    component.showUnassigned = true;
    const mapGroup = vi.spyOn(component as any, 'mapGroup');
    (component as any).applyCalendarData({ groups: [{ crewGroupCode: 'ASSIGNED', crews: [] }] });
    expect(mapGroup).not.toHaveBeenCalled();
    expect(component.crewGroups).toEqual([]);
    expect(component.unassignedLoading).toBe(true);

    component.navigateTimeline(1);
    const newest = { groups: [{ crewGroupCode: 'NEW', crews: [{ crewUid: 'NEW-01' }] }] };
    secondResponse.next(newest);
    firstResponse.next({ groups: [{ crewGroupCode: 'OLD', crews: [] }] });
    firstResponse.error(new Error('Late failure'));
    expect(component.crewGroups[0].name).toBe('NEW');
    expect(component.unassignedLoading).toBe(false);

    component.navigateTimeline(1);
    component.setCrewView('assigned');
    thirdResponse.next(newest);
    expect(component.crewGroups).toEqual([]);
    expect(component.unassignedLoading).toBe(false);
  });

  it('keeps the full calendar response until a well filter is explicitly applied', () => {
    const route = {
      snapshot: {
        paramMap: {
          get: (key: string) => (key === 'wellId' ? '2064' : null),
        },
      },
    } as any;

    const component = new ActivityBreakdownComponent(
      route,
      { navigate: vi.fn() } as any,
      { detectChanges: () => undefined, markForCheck: () => undefined } as any,
      { isCollapsed: false, collapse: () => undefined, expand: () => undefined } as any,
      { getPlantFilters: () => of([]) } as any,
      {} as any,
      { isAdmin: () => false } as any,
    );

    const data: any = {
      totalGroups: 2,
      totalCrews: 2,
      totalActivities: 3,
      totalMilestones: 0,
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
      groups: [
        {
          crewGroupCode: 'G1',
          activityCount: 2,
          completionPct: 50,
          crews: [
            {
              crewCode: 'C1',
              activities: [
                {
                  activityCode: 'ACT-01',
                  activityName: 'Activity 1',
                  wellId: '2064',
                  category: 'General',
                  plannedStart: '2026-09-01',
                  plannedEnd: '2026-09-10',
                  actualStart: null,
                  actualEnd: null,
                  progress: 25,
                  status: 'inprogress',
                  isMilestone: false,
                  rigOnDate: null,
                  expectedRigOnDate: null,
                  normsPerDay: 100,
                  productivityPct: 125,
                },
                {
                  activityCode: 'A2',
                  activityName: 'Activity 2',
                  wellId: '9999',
                  category: 'General',
                  plannedStart: '2026-09-11',
                  plannedEnd: '2026-09-20',
                  actualStart: null,
                  actualEnd: null,
                  progress: 10,
                  status: 'notstarted',
                  isMilestone: false,
                  rigOnDate: null,
                  expectedRigOnDate: null,
                  normsPerDay: null,
                  productivityPct: null,
                },
              ],
            },
          ],
        },
        {
          crewGroupCode: 'G2',
          activityCount: 1,
          completionPct: 100,
          crews: [
            {
              crewCode: 'C2',
              activities: [
                {
                  activityCode: 'A3',
                  activityName: 'Activity 3',
                  wellId: '2064',
                  category: 'General',
                  plannedStart: '2026-09-15',
                  plannedEnd: '2026-09-22',
                  actualStart: null,
                  actualEnd: null,
                  progress: 50,
                  status: 'completed',
                  isMilestone: false,
                  rigOnDate: null,
                  expectedRigOnDate: null,
                  normsPerDay: null,
                  productivityPct: null,
                },
              ],
            },
          ],
        },
      ],
      milestones: [],
    };

    component.wellId = '2064';
    component.timeUnit = 'month';
    const next = { ...data, totalActivities: 3 };
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    (component as any).applyCalendarData(next);

    expect(component.wellId).toBe('2064');
    expect(component.crewGroups.length).toBe(2);
    expect(component.crewGroups.flatMap(group => group.wells).length).toBe(2);
    expect(component.crewGroups.flatMap(group => group.wells).every((well: any) => well.activities.length > 0)).toBe(true);
    const firstCrew = component.crewGroups[0].wells[0];
    expect(component.barLabel(firstCrew.bars[0])).toBe('ACT-01, A2');
    expect(component.barLabel(firstCrew.activities[0].bar)).toBe('ACT-01');
    expect(component.barLabel(component.crewGroups[0].bars[0])).toBe('ACT-01, A2');
    component.showTooltip(new MouseEvent('mouseenter'), firstCrew.activities[0].bar);
    expect(component.tooltipActivities[0]).toMatchObject({ wellId: '2064', activityCode: 'ACT-01', normsPerDay: 100 });
    expect(component.actualNorms(component.tooltipActivities[0])).toBe(125);
    expect(component.actualDatesLabel(component.tooltipActivities[0])).toBe('Not recorded → Not recorded');
    expect(component.actualNorms({ ...component.tooltipActivities[0], productivityPct: null })).toBeNull();
    expect(component.actualNorms({ ...component.tooltipActivities[0], productivityPct: 0 })).toBe(0);
    expect(component.currentNorms(component.tooltipActivities[0])).toBe(100);
    expect(component.currentNorms({ ...component.tooltipActivities[0], productivityPct: null })).toBeNull();
    expect(component.currentNorms({ ...component.tooltipActivities[0], normsPerDay: null })).toBeNull();
    expect(component.currentNorms({ ...component.tooltipActivities[0], productivityPct: 0 })).toBe(100);
    expect(component.currentNorms({ ...component.tooltipActivities[0], normsPerDay: 0 })).toBe(0);
    expect(component.tooltipActivities[0].normsPerDay).toBe(100);
    component.showTooltip(new MouseEvent('mouseenter'), firstCrew.bars[0]);
    expect(component.tooltipActivities).toHaveLength(2);
    component.expandAll();
    expect(component.crewGroups.every(group => group.expanded)).toBe(true);
    expect(component.crewGroups.flatMap(group => group.wells).every(well => well.expanded)).toBe(true);
    const crewBars = component.visibleCrewBars(firstCrew);
    component.selectWell(firstCrew, component.crewGroups[0], new Event('click'));
    expect(firstCrew.expanded).toBe(true);
    expect(component.selectedWellId).toBe(firstCrew.id);
    expect(component.visibleCrewBars(firstCrew)).toEqual(crewBars);
    component.selectWell(firstCrew, component.crewGroups[0], new Event('click'));
    expect(firstCrew.expanded).toBe(true);
    expect(component.selectedWellId).toBe(firstCrew.id);
  });

  it('shows the planned and actual bars based on the selected schedule filter', () => {
    const route = {
      snapshot: {
        paramMap: {
          get: (key: string) => (key === 'wellId' ? '2064' : null),
        },
      },
    } as any;

    const component = new ActivityBreakdownComponent(
      route,
      { navigate: vi.fn() } as any,
      { detectChanges: () => undefined, markForCheck: () => undefined } as any,
      { isCollapsed: false, collapse: () => undefined, expand: () => undefined } as any,
      { getPlantFilters: () => of([]) } as any,
      {} as any,
      { isAdmin: () => false } as any,
    );

    const bar: any = {
      plannedStartDay: 0,
      plannedSpanDays: 10,
      actualSpanDays: 6,
      actualStart: '2026-09-01',
      type: 'in-progress',
    };

    component.scheduleFilter = 'planned-actual';
    expect(component.showPlannedBar(bar)).toBe(true);
    expect(component.showActualBar(bar)).toBe(true);

    component.scheduleFilter = 'planned';
    expect(component.showPlannedBar(bar)).toBe(true);
    expect(component.showActualBar(bar)).toBe(false);

    component.scheduleFilter = 'actual';
    expect(component.showPlannedBar(bar)).toBe(false);
    expect(component.showActualBar(bar)).toBe(true);
  });

  it('shows the actual bar when progress indicates work has started even if actualSpanDays is zero', () => {
    const route = {
      snapshot: {
        paramMap: {
          get: (key: string) => (key === 'wellId' ? '2064' : null),
        },
      },
    } as any;

    const component = new ActivityBreakdownComponent(
      route,
      { navigate: vi.fn() } as any,
      { detectChanges: () => undefined, markForCheck: () => undefined } as any,
      { isCollapsed: false, collapse: () => undefined, expand: () => undefined } as any,
      { getPlantFilters: () => of([]) } as any,
      {} as any,
      { isAdmin: () => false } as any,
    );

    const bar: any = {
      plannedStartDay: 0,
      plannedSpanDays: 10,
      actualSpanDays: 0,
      progress: 35,
      actualStart: '2026-09-05',
      actualEnd: null,
      type: 'in-progress',
    };

    component.scheduleFilter = 'actual';
    expect(component.showActualBar(bar)).toBe(true);
    component.timelineStart = new Date(2026, 8, 1);
    component.totalDays = 10;
    component.todayOffset = 7;
    component.today = new Date(2026, 8, 8);
    expect(component.actualBarStyle(bar)).toEqual({ left: '40%', width: '40%', display: 'flex', background: '#1D4ED8' });

    bar.actualStart = undefined;
    bar.plannedSpanDays = 1;
    expect(component.actualBarStyle(bar)).toMatchObject({ width: '0%', display: 'none' });
    expect(component.showActualBar(bar)).toBe(false);

    bar.actualStart = '2026-09-01';
    bar.plannedEnd = '2026-09-03';
    bar.type = 'completed';
    bar.progress = 100;
    expect(component.actualBarStyle(bar)).toEqual({ left: '0%', width: '80%', display: 'flex', background: '#1D4ED8' });
    bar.actualEnd = '2026-09-03';
    expect(component.actualBarStyle(bar)).toEqual({ left: '0%', width: '30%', display: 'flex', background: '#1D4ED8' });

    bar.plannedStartDay = -10;
    bar.plannedSpanDays = 2;
    expect(component.barStyle(bar)['display']).toBe('none');
    bar.plannedStartDay = 11;
    expect(component.barStyle(bar)).toMatchObject({ left: '100%', width: '0%', display: 'none' });
    bar.plannedStartDay = -1;
    expect(component.barStyle(bar)).toMatchObject({ left: '0%', width: '10%', display: 'flex' });
  });

  it('counts only visible activities and keeps unassigned tasks under their group', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, { detectChanges: vi.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
    (component as any).selectedFrom = '2026-09-01';
    (component as any).selectedTo = '2026-09-30';
    const activity = (activityCode: string, values = {}) => ({
      activityCode, activityName: activityCode, wellId: 'W1',
      plannedStart: '2026-09-01', plannedEnd: '2026-09-30',
      actualStart: null, actualEnd: null, progress: 0, status: 'planned', ...values,
    });
    const outside = activity('OUT', { plannedStart: '2026-10-01', plannedEnd: '2026-10-02' });
    (component as any).applyCalendarData({ fromDate: '2026-09-01', toDate: '2026-10-02', groups: [
      { crewGroupCode: 'G1', crews: [
        { crewCode: 'C1', activities: [
          activity('STARTED', { actualStart: '2026-09-01' }),
          activity('DONE', { actualEnd: '2026-09-02', progress: 100 }),
          activity('BOUNDARY', { plannedStart: '2026-08-31', plannedEnd: '2026-09-01' }),
          outside,
        ] },
        { crewCode: '', activities: [activity('UNASSIGNED')] },
      ] },
      { crewGroupCode: 'OUTSIDE', crews: [{ crewCode: 'C2', activities: [outside] }] },
    ] });
    expect(component.crewGroups).toHaveLength(1);
    const group = component.crewGroups[0];
    expect(group).toMatchObject({ assignedCount: 3, unassignedCount: 1 });
    expect(group.wells[1]).toMatchObject({ name: 'Unassigned activities', unassigned: true });
    expect(group.wells[1].activities[0].bar.type).toBe('planned');
    expect(group.bars.map(bar => bar.type)).toEqual(['in-progress']);
    expect(group.bars[0].activities?.map(activity => activity.activityCode).sort())
      .toEqual(['BOUNDARY', 'DONE', 'STARTED', 'UNASSIGNED']);
    expect(component.legendItems).toEqual([{ key: 'planned', label: 'Planned' }, { key: 'actual', label: 'Actual' }]);
    expect(component.statusDotColor('completed')).toBe('#1D4ED8');
    expect(component.statusDotColor('not-started')).toBe('#1D4ED8');
    expect(component.showPlannedBar(group.bars[0])).toBe(true);
    expect(component.showActualBar(group.bars[0])).toBe(false);
    component.toggleLegendFilter('planned');
    expect(component.showPlannedBar(group.bars[0])).toBe(false);
    component.setScheduleFilter('actual');
    expect(component.showActualBar(group.bars[0])).toBe(true);
    component.setScheduleFilter('planned');
    expect(group.wells[1].activities[0].bar).toMatchObject({ label: 'UNASSIGNED', hasCrew: false });
    expect(component.getSegments(component.groupActivities(group)).reduce((sum, segment) => sum + segment.pct, 0)).toBe(100);
    component.timelineStart = new Date(2026, 9, 1);
    component.totalDays = 2;
    (component as any).rebuildBars();
    expect(component.crewGroups).toHaveLength(2);
    expect(component.crewGroups[0]).toMatchObject({ assignedCount: 1, unassignedCount: 0 });
  });

  it('includes plans overlapping or spanning the visible range and excludes non-overlapping plans', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 5, 1);
    component.totalDays = 30;
    const activities = [
      { activityCode: 'START', plannedStart: '2026-06-30', plannedEnd: '2026-07-10' },
      { activityCode: 'END', plannedStart: '2026-05-20', plannedEnd: '2026-06-01' },
      { activityCode: 'BOTH', plannedStart: '2026-06-01', plannedEnd: '2026-06-30' },
      { activityCode: 'SINGLE', plannedStart: '2026-06-15', plannedEnd: '2026-06-15' },
      { activityCode: 'SPANNING', plannedStart: '2026-05-01', plannedEnd: '2026-07-01' },
      { activityCode: 'BEFORE', plannedStart: '2026-05-01', plannedEnd: '2026-05-31' },
      { activityCode: 'AFTER', plannedStart: '2026-07-01', plannedEnd: '2026-07-15' },
    ];
    const groups = (component as any).groupsInWindow([{ crewGroupCode: 'G1', crews: [{ crewCode: 'C1', activities }] }]);
    expect(groups[0].crews[0].activities.map((activity: any) => activity.activityCode))
      .toEqual(['START', 'END', 'BOTH', 'SINGLE', 'SPANNING']);
  });

  it('keeps actual-only work outside the planned grid without changing source dates', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    component.today = new Date(2026, 8, 9);
    component.totalDays = 30;
    const activity = { plannedStart: '2026-01-17', plannedEnd: '2026-03-17',
      actualStart: '2026-01-17', actualEnd: null, progress: 50, status: 'inprogress' };
    const groups = (component as any).groupsInWindow([{ crewGroupCode: 'G1', crews: [
      { crewCode: 'C1', activities: [activity] }, { crewCode: '', activities: [activity] },
    ] }]);
    expect(groups).toEqual([]);
    component.scheduleFilter = 'actual';
    const planned = (component as any).mapActivityToBar({ ...activity, actualStart: null }, true);
    expect(component.showActualBar(planned)).toBe(false);
    const unassigned = (component as any).mapActivityToBar(activity, false);
    expect(component.showActualBar(unassigned)).toBe(true);
    const completed = (component as any).mapActivityToBar({ ...activity, actualStart: null, progress: 100 }, true);
    expect(completed.type).toBe('planned');
    expect(component.showActualBar(completed)).toBe(false);
  });

  it('uses planned dates for grid selection and recorded actual dates for its bars even without a crew', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    component.totalDays = 30;
    component.todayOffset = 8;
    component.today = new Date(2026, 8, 9);
    const activity = {
      activityCode: 'ACTUAL', activityName: 'Started work', wellId: 'W1',
      plannedStart: '2026-09-01', plannedEnd: '2026-09-20',
      actualStart: '2026-09-05', actualEnd: null, progress: 40, status: 'planned',
    };
    const groups = (component as any).groupsInWindow([{
      crewGroupCode: 'G1', crews: [{ crewCode: '', activities: [activity] }],
    }]);
    expect(groups).toHaveLength(1);
    const group = (component as any).mapGroup(groups[0], 0);
    const bar = group.wells[0].activities[0].bar;
    expect(bar).toMatchObject({ type: 'in-progress', actualStart: '2026-09-05', progress: 40, hasCrew: false });
    component.scheduleFilter = 'actual';
    expect(component.showActualBar(bar)).toBe(true);
    expect(component.actualBarStyle(bar)).toEqual({ left: `${4 / 30 * 100}%`, width: `${5 / 30 * 100}%`, display: 'flex', background: '#1D4ED8' });
    const completed = (component as any).mapActivityToBar({ ...activity, actualEnd: '2026-09-07' }, false);
    expect(completed.type).toBe('completed');
    expect(component.showActualBar(completed)).toBe(true);
    expect(component.actualBarStyle(completed)).toEqual({ left: `${4 / 30 * 100}%`, width: '10%', display: 'flex', background: '#1D4ED8' });
    component.scheduleFilter = 'planned';
    expect(component.showActualBar(bar)).toBe(false);
  });

  it('places assigned crews before unassigned activities without changing activity counts', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    component.totalDays = 30;
    const activity = (code: string) => ({
      activityCode: code, activityName: code, wellId: 'W1',
      plannedStart: '2026-09-01', plannedEnd: '2026-09-05', progress: 0, status: 'planned',
    });
    const group = (component as any).mapGroup({ crewGroupCode: 'FBH-0502', crews: [
      { crewCode: '', activities: [activity('UNASSIGNED')] },
      { crewCode: '3522-FBH-0502-', activities: [activity('ASSIGNED-1'), activity('ASSIGNED-2')] },
    ] }, 0);
    expect(group).toMatchObject({ assignedCount: 2, unassignedCount: 1 });
    expect(group.wells[0]).toMatchObject({ name: '3522-FBH-0502-', unassigned: false });
    expect(group.wells[0].activities).toHaveLength(2);
    expect(group.wells[1].unassigned).toBe(true);
  });

  it('retains unassigned activity details and individual dated bars for group expansion', () => {
    const component = new ActivityBreakdownComponent(
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    component.timelineStart = new Date(2026, 8, 1);
    component.totalDays = 10;
    const activity = (name: string, start: string, end: string) => ({
      activityCode: name, activityName: name, wellId: 'W1', progress: 0,
      plannedStart: start, plannedEnd: end, status: 'planned',
    });
    const group = (component as any).mapGroup({ crewGroupCode: 'G1', crews: [{
      crewCode: '', activities: [
        activity('Excavation', '2026-09-01', '2026-09-05'),
        activity('Compaction', '2026-09-03', '2026-09-07'),
        activity('Cleanup', '2026-09-08', '2026-09-09'),
      ],
    }] }, 0);
    expect(group.unassignedCount).toBe(3);
    expect(group.bars).toHaveLength(1);
    expect(group.wells[0].unassigned).toBe(true);
    expect(group.wells[0].activities.map((activity: any) => activity.name)).toEqual(['Excavation', 'Compaction', 'Cleanup']);
    const bars = group.wells[0].activities.map((activity: any) => activity.bar);
    expect(bars.map((bar: any) => bar.label)).toEqual(['Excavation', 'Compaction', 'Cleanup']);
    expect(bars.map((bar: any) => component.barStyle(bar))).toEqual([
      { left: '0%', width: '50%', display: 'flex', background: '#F97316' },
      { left: '20%', width: '50%', display: 'flex', background: '#F97316' },
      { left: '70%', width: '20%', display: 'flex', background: '#F97316' },
    ]);
    expect(bars.every((bar: any) => component.showPlannedBar(bar))).toBe(true);
    expect(bars.every((bar: any) => !component.showActualBar(bar))).toBe(true);
  });
});
