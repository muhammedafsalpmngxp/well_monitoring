import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SharedModule } from '../../../shared/shared.module';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { CrewCalendarService } from '../../../core/services/crew-calendar.service';
import { CrewCalendarData, CalendarGroup, CalendarActivity, CalendarFilters, CrewBooking, CrewProjectMapping, CrewActualWork, UnassignedCrewGroup, AssignableActivity, CrewUtilizationReport, CrewUtilizationStatus } from '../../../core/models/crew-calendar.model';
import { CommonApiService, PlantFilterDto } from '../../../core/services/common-api.service';
import { AuthService } from '../../../core/services/auth.service';
import { from, of, Subject } from 'rxjs';
import { catchError, concatMap, map, takeUntil, toArray } from 'rxjs/operators';
import { bookedDaysInWindow, buildCrewCalendarPlan, uncoveredBookings } from './crew-calendar-planning';
import { actualDaysInWindow, buildCrewUtilizationReport, crewUtilizationStatus } from './crew-utilization';
import { CrewReportIconDirective, CrewUtilizationReportComponent } from './crew-utilization-report.component';

import { A11yDialogDirective } from '../../../shared/directives/a11y-dialog.directive';
import { KeyClickDirective } from '../../../shared/directives/key-click.directive';
export type BarType = 'in-progress' | 'completed' | 'delayed' | 'overdue' | 'not-started' | 'unassigned' | 'baseline' | 'milestone' | 'planned' | 'slip';
export type ScheduleFilter = 'planned-actual' | 'planned' | 'actual';
export type ViewBy = 'wells' | 'activities';
export type TimeUnit = 'day' | 'week' | 'month';

export interface ProgressSegment {
  color: string;
  pct: number;
}

export interface CalendarTooltipActivity extends CalendarActivity {
  crewId?: string | null;
}

type SavedAssignmentActivity = CalendarTooltipActivity & { assignmentId: number };

export interface GanttBar {
  type: BarType;
  startDay: number;
  spanDays: number;
  label?: string;
  wellId?: string;
  plannedStartDay: number;
  plannedSpanDays: number;
  actualSpanDays: number;
  actualStartDay?: number;
  slipDays: number;
  progress: number;
  plannedStart?: string;
  plannedEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  source?: CalendarActivity['source'];
  milestone?: boolean;
  completionMarker?: boolean;
  activities?: CalendarTooltipActivity[];
  summary?: boolean;
  hasCrew?: boolean;
  proposed?: boolean;
  reserved?: boolean;
  lane?: number;
}

export interface ActivityRow {
  id: string;
  name: string;
  category: string;
  status: BarType;
  percent: number;
  bar: GanttBar;
}

export interface WellRow {
  id: string;
  hierarchyKey?: string;
  name: string;
  percent?: number;
  expanded: boolean;
  bars: GanttBar[];
  activities: ActivityRow[];
  noActivities?: boolean;
  unassigned?: boolean;
  crewTypeCode?: string | null;
  projects?: CrewProjectMapping[];
  bookedDays?: number;
  actualDays?: number;
  rowHeight?: number;
}

export interface CrewGroup {
  id: string;
  hierarchyKey?: string;
  name: string;
  crewGroupName?: string | null;
  subtitle: string;
  percent: number;
  color: string;
  expanded: boolean;
  bars: GanttBar[];
  wells: WellRow[];
  assignedCount?: number;
  unassignedCount?: number;
  utilization?: {
    bookedCrewDays: number;
    capacityCrewDays: number;
    percent: number | null;
  };
}

export interface CrewCluster {
  id: string;
  name: string;
  expanded: boolean;
  groups: CrewGroup[];
}

export interface WeekHeader {
  label: string;
  days: { dayOfWeek: string; date: number; isToday?: boolean }[];
  startDay: number;
}

@Component({
  selector: 'app-activity-breakdown',
  standalone: true,
  imports: [A11yDialogDirective, KeyClickDirective, SharedModule, CrewReportIconDirective, CrewUtilizationReportComponent],
  templateUrl: './activity-breakdown.component.html',
  styleUrls: ['./activity-breakdown.component.scss'],
})
export class ActivityBreakdownComponent implements OnInit, OnDestroy {
  @ViewChild('barAreaWrap') barAreaWrap?: ElementRef<HTMLElement>;
  @ViewChild('leftRows') leftRows?: ElementRef<HTMLElement>;
  @ViewChild('assignmentMenuElement') assignmentMenuElement?: ElementRef<HTMLElement>;
  @ViewChild('assignmentDeleteDialog', { read: ElementRef }) assignmentDeleteDialog?: ElementRef<HTMLElement>;
  @ViewChild('utilizationReportButton') utilizationReportButton?: ElementRef<HTMLButtonElement>;
  utilizationReport: CrewUtilizationReport | null = null;
  utilizationPlannedReport: CrewUtilizationReport | null = null;
  utilizationActualReport: CrewUtilizationReport | null = null;
  utilizationScopeLabel = '';
  utilizationSelectionLabel = '';
  utilizationExportCluster = '';
  utilizationExportView = 'Planned';
  utilizationScopedActivities = false;
  wellId = '35495';
  wellName = 'Crew Calendar';
  get subtitle(): string {
    if (this.showUnassigned) return `${this.crewGroups.length} crew groups`;
    const assigned = this.crewGroups.reduce((sum, group) => sum + (group.assignedCount ?? 0), 0);
    const unassigned = this.crewGroups.reduce((sum, group) => sum + (group.unassignedCount ?? 0), 0);
    return `${this.crewGroups.length} crew groups | ${assigned} assigned activities | ${unassigned} unassigned activities`;
  }

  viewBy: ViewBy = 'activities';
  get calendarSummary(): { label: string; count: number | null; unit?: string }[] {
    return this.crewPlanning && this.scheduleFilter === 'actual'
      ? this.actualCalendarSummary() : this.rosterCalendarSummary();
  }

  private rosterCalendarSummary(): { label: string; count: number | null; unit?: string }[] {
    const groups = new Set<string>();
    const actualCrews = new Set<string>();
    const rosterCrews = new Set<string>();
    let bookedCrewDays = 0;
    let actualCrewDays = 0;
    for (const group of this.ganttGroups) {
      const groupId = group.id.trim().toLowerCase();
      const crews = this.visibleCrews(group);
      if (!groupId || !crews.length) continue;
      groups.add(groupId);
      const members = this.rosterCrewIdsByGroup.get(groupId);
      for (const crew of crews) {
        const crewId = crew.id.trim().toLowerCase();
        if (crewId && (this.showUnassigned || !crew.unassigned)) {
          actualCrews.add(crewId);
        }
        const capacityKey = JSON.stringify([groupId, crewId]);
        if (!members?.has(crewId) || rosterCrews.has(capacityKey)) continue;
        rosterCrews.add(capacityKey);
        bookedCrewDays += crew.bookedDays ?? 0;
        actualCrewDays += crew.actualDays ?? 0;
      }
    }
    const capacityCrewDays = rosterCrews.size * this.totalDays;
    return [
      { label: 'Total crew groups', count: groups.size },
      { label: 'Total actual crews', count: actualCrews.size },
      { label: 'Avg Planned Utilization', count: capacityCrewDays > 0 ? bookedCrewDays / capacityCrewDays * 100 : null, unit: '%' },
      { label: 'Avg Actual Utilization', count: capacityCrewDays > 0 ? actualCrewDays / capacityCrewDays * 100 : null, unit: '%' },
    ];
  }

  get visibleCalendarSummary(): { label: string; count: number | null; unit?: string }[] {
    const hiddenLabel = this.scheduleFilter === 'actual' ? 'Avg Planned Utilization' : 'Avg Actual Utilization';
    return this.calendarSummary.filter(metric => metric.label !== hiddenLabel);
  }

  scheduleFilter: ScheduleFilter = 'planned';
  timeUnit: TimeUnit = 'month';
  searchTerm = '';
  private readonly hierarchyExpansion = new Map<string, boolean>();
  private readonly rosterProjectsByCrew = new Map<string, CrewProjectMapping[]>();
  private clustersExpandedByDefault = false;
  private clusterRowsSource: CrewGroup[] | null = null;
  private clusterRowsFilterKey = '';
  private clusterRows: CrewCluster[] = [];
  showFilterPanel = false;
  showRowFilter = false;
  rowFilterSelected: Set<string> = new Set();
  showUtilizationFilter = false;
  utilizationBasis: 'planned' | 'actual' = 'planned';
  utilizationFilter: CrewUtilizationStatus | 'all' = 'all';
  readonly utilizationFilterOptions: { value: CrewUtilizationStatus | 'all'; label: string }[] = [
    { value: 'all', label: 'All utilization' },
    { value: 'Scarce', label: 'Scarce (>=95%)' },
    { value: 'Well-Utilized', label: 'Well-Utilized (80% to <95%)' },
    { value: 'Underutilized', label: 'Underutilized (50% to <80%)' },
    { value: 'Surplus', label: 'Surplus (<50%)' },
    { value: 'N/A', label: 'N/A (unknown capacity)' },
  ];

  // Interactive legend toggles
  legendFilters: Record<string, boolean> = {
    'planned': true, 'in-progress': true, 'completed': true, 'delayed': true,
    'not-started': true, 'milestone': true, 'overdue': true, 'baseline': true,
    'actual': true, 'unassigned': true, 'today': true, 'past': true, 'future': true,
  };
  readonly legendItems: { key: string; label: string }[] = [
    { key: 'planned', label: 'Planned' },
    { key: 'actual', label: 'Actual' },
  ];

  get visibleLegendItems(): { key: string; label: string }[] {
    return this.legendItems.filter(item => item.key === this.scheduleFilter);
  }

  groupBy: 'crew-group' | 'well' = 'crew-group';

  // Filter bar state
  openFilterName: string | null = null;
  filterCountry      = '';
  filterSector       = '';
  filterBusinessUnit = '';
  filterDivision     = '';
  filterCluster      = '';
  filterPlant        = '';
  filterFrom         = '';
  filterTo           = '';
  filterQuickRange   = '';

  filterCountryOptions:      string[] = [];
  filterSectorOptions:       string[] = [];
  filterBusinessUnitOptions: string[] = [];
  filterDivisionOptions:     string[] = [];
  filterClusterOptions:      string[] = [];
  filterPlantOptions:        string[] = [];
  readonly filterQuickRangeOptions   = ['This Week', 'Till Last Tuesday', 'This Month', 'Last 3 Months', 'This Year'];
  private allPlants: PlantFilterDto[] = [];
  private readonly destroy$ = new Subject<void>();
  private calendarRequestId = 0;
  private calendarScope: CalendarFilters = {};

  toggleFilterDropdown(name: string, event: Event): void {
    event.stopPropagation();
    this.openFilterName = this.openFilterName === name ? null : name;
  }

  selectFilterOption(field: string, value: string): void {
    switch (field) {
      case 'country':      this.filterCountry = value; this.filterSector = ''; this.filterBusinessUnit = ''; this.filterDivision = ''; this.filterCluster = ''; this.filterPlant = ''; break;
      case 'sector':       this.filterSector = value; this.filterBusinessUnit = ''; this.filterDivision = ''; this.filterCluster = ''; this.filterPlant = ''; break;
      case 'businessUnit': this.filterBusinessUnit = value; this.filterDivision = ''; this.filterCluster = ''; this.filterPlant = ''; break;
      case 'division':     this.filterDivision = value; this.filterCluster = ''; this.filterPlant = ''; break;
      case 'cluster':      this.filterCluster = value; this.filterPlant = ''; break;
      case 'plant':        this.filterPlant = value; break;
      case 'quickRange': {
        this.filterQuickRange = value;
        const range = this.resolveQuickRange(value);
        if (range) {
          this.filterFrom = range.from;
          this.filterTo = range.to;
        }
        break;
      }
    }
    this.rebuildCascadingOptions();
    this.openFilterName = null;
  }

  private rebuildCascadingOptions(): void {
    let filtered = this.allPlants;
    if (this.filterCountry) filtered = filtered.filter(p => p.country === this.filterCountry);
    this.filterSectorOptions = this.filterCountry ? this.distinctValues(filtered, p => p.sector) : [];
    if (this.filterSector) filtered = filtered.filter(p => p.sector === this.filterSector);
    this.filterBusinessUnitOptions = this.filterSector ? this.distinctValues(filtered, p => p.businessUnit) : [];
    if (this.filterBusinessUnit) filtered = filtered.filter(p => p.businessUnit === this.filterBusinessUnit);
    this.filterDivisionOptions = this.filterBusinessUnit ? this.distinctValues(filtered, p => p.division) : [];
    if (this.filterDivision) filtered = filtered.filter(p => p.division === this.filterDivision);
    this.filterClusterOptions = this.filterDivision ? this.distinctValues(filtered, p => p.cluster) : [];
    // Narrowing down to a single cluster/plant should auto-select it instead of leaving it blank.
    if (!this.filterCluster && this.filterClusterOptions.length === 1) this.filterCluster = this.filterClusterOptions[0];
    if (this.filterCluster) filtered = filtered.filter(p => p.cluster === this.filterCluster);
    this.filterPlantOptions = this.distinctValues(filtered, p => p.plantDescription);
    if (!this.filterPlant && this.filterPlantOptions.length === 1) this.filterPlant = this.filterPlantOptions[0];
  }

  private distinctValues(plants: PlantFilterDto[], selector: (p: PlantFilterDto) => string): string[] {
    return [...new Set(plants.map(selector).filter(v => !!v))].sort((a, b) => a.localeCompare(b));
  }

  @HostListener('document:click')
  closeFilterDropdowns(): void {
    this.openFilterName = null;
    this.showRowFilter = false;
    this.showUtilizationFilter = false;
    this.closeAssignmentMenu();
  }

  applyDashboardFilters(): void {
    const range = this.resolveQuickRange(this.filterQuickRange) ?? {
      from: this.filterFrom,
      to: this.filterTo,
    };
    if (!range.from || !range.to || range.to < range.from) return;
    this.setCalendarDateRange(range.from, range.to);
    const matchingPlants = this.allPlants.filter(plant => plant.plantDescription === this.filterPlant &&
      (!this.filterCluster || plant.cluster === this.filterCluster));
    const site = matchingPlants.length === 1 ? String(matchingPlants[0].plantCode) : this.filterPlant || undefined;
    this.calendarScope = { cluster: this.filterCluster || undefined, site };
    this.loadCalendarData({
      ...this.calendarScope,
      from: range.from,
      to: range.to,
    });
    this.showFilterPanel = false;
  }

  resetDashboardFilters(): void {
    this.filterCountry = '';
    this.filterSector = '';
    this.filterBusinessUnit = '';
    this.filterDivision = '';
    this.filterCluster = '';
    this.filterPlant = '';
    this.filterQuickRange = '';
    const now = new Date();
    this.setCalendarDateRange(
      this.toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
      this.toDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    );
    this.calendarScope = {};
    this.rebuildCascadingOptions();
    this.loadCalendarData();
  }

  private setCalendarDateRange(from: string, to: string): void {
    this.filterFrom = this.selectedFrom = from;
    this.filterTo = this.selectedTo = to;
    this.updateTimelineWindow(new Date(`${from}T00:00:00`));
    this.buildTimeline();
  }

  private resolveQuickRange(label: string): { from: string; to: string } | null {
    const now = new Date();
    switch (label) {
      case 'This Week': {
        const start = new Date(now); start.setDate(now.getDate() - now.getDay());
        const end = new Date(start); end.setDate(start.getDate() + 6);
        return { from: this.toDateStr(start), to: this.toDateStr(end) };
      }
      case 'Till Last Tuesday': {
        const diff = ((now.getDay() - 2) + 7) % 7 || 7;
        const end = new Date(now); end.setDate(now.getDate() - diff);
        const start = new Date(now.getFullYear(), 0, 1);
        return { from: this.toDateStr(start), to: this.toDateStr(end) };
      }
      case 'This Month': {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { from: this.toDateStr(start), to: this.toDateStr(end) };
      }
      case 'Last 3 Months': {
        const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        return { from: this.toDateStr(start), to: this.toDateStr(now) };
      }
      case 'This Year': {
        const start = new Date(now.getFullYear(), 0, 1);
        const end = new Date(now.getFullYear(), 11, 31);
        return { from: this.toDateStr(start), to: this.toDateStr(end) };
      }
      default:
        return null;
    }
  }

  today = new Date();
  totalDays = new Date(this.today.getFullYear(), this.today.getMonth() + 1, 0).getDate();
  timelineStart = new Date(this.today.getFullYear(), this.today.getMonth(), 1);
  todayOffset = this.dayOffset(this.today);

  breadcrumbs = [
    { label: 'Dashboard', route: '/dashboard' },
    { label: 'Crew Calendar' },
  ];

  weeks: WeekHeader[] = [];
  days: { dayOfWeek: string; date: number; calendarDate: Date; monthLabel?: string; isToday?: boolean; isWeekend?: boolean; isPast?: boolean }[] = [];

  selectedGroupId: string | null = null;
  selectedWellId: string | null = null;

  crewGroups: CrewGroup[] = [];
  wellRows: WellRow[] = [];
  loading = false;
  loadError: string | null = null;

  // Unassigned crews + inline assign panel
  showUnassigned = false;
  unassignedLoading = false;
  unassignedGroups: UnassignedCrewGroup[] = [];
  private unassignedRequestId = 0;
  assignError: string | null = null;
  assignPanel: {
    crewGroupCode: string;
    crewGroupName: string | null;
    crewUid: string;
    crewTypeCode: string | null;
    activities: AssignableActivity[];
    loadingActivities: boolean;
    selectedActivityCodes: string[];
    activitySearch: string;
    plannedStart: string;
    plannedEnd: string;
    saving: boolean;
  } | null = null;
  assignmentMenu: { activity: SavedAssignmentActivity; left: number; top: number } | null = null;
  assignmentDeletion: { activity: SavedAssignmentActivity; saving: boolean; error: string | null } | null = null;
  private assignmentMenuTrigger: HTMLElement | null = null;

  private readonly GROUP_COLORS = ['#1765E8', '#16A34A', '#7C3AED', '#06A5B8', '#F97316', '#DC2626', '#8B5CF6', '#0891B2'];

  private _prevSidebarState = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
    private readonly layoutState: LayoutStateService,
    private readonly commonApi: CommonApiService,
    private readonly calendarService: CrewCalendarService,
    private readonly authService: AuthService,
  ) {}

  get isAdmin(): boolean { return this.authService.isAdmin(); }

  ngOnInit(): void {
    //this._prevSidebarState = this.layoutState.isCollapsed;
    //this.layoutState.collapse();
    this.wellId = this.route.snapshot.paramMap.get('wellId') ?? '35495';
    this.updateTimelineWindow();
    this.filterFrom = this.selectedFrom!;
    this.filterTo = this.selectedTo!;
    this.loadCalendarData();
    this.buildTimeline();
    this.commonApi.getPlantFilters().pipe(
      catchError(() => of([])),
      takeUntil(this.destroy$),
    ).subscribe(plants => {
      this.allPlants = plants;
      this.filterCountryOptions = this.distinctValues(plants, p => p.country);
      this.autoSelectSingle();
      this.rebuildCascadingOptions();
      this.cdr.markForCheck();
    });
  }

  private autoSelectSingle(): void {
    const active = (v: string) => v && v !== 'All';
    if (this.filterCountryOptions.length === 1) this.filterCountry = this.filterCountryOptions[0];
    let filtered = this.allPlants;
    if (active(this.filterCountry)) filtered = filtered.filter(p => p.country === this.filterCountry);
    const sectors = this.distinctValues(filtered, p => p.sector);
    if (sectors.length === 1) this.filterSector = sectors[0];
    if (active(this.filterSector)) filtered = filtered.filter(p => p.sector === this.filterSector);
    const bus = this.distinctValues(filtered, p => p.businessUnit);
    if (bus.length === 1) this.filterBusinessUnit = bus[0];
    if (active(this.filterBusinessUnit)) filtered = filtered.filter(p => p.businessUnit === this.filterBusinessUnit);
    const divs = this.distinctValues(filtered, p => p.division);
    if (divs.length === 1) this.filterDivision = divs[0];
  }

  ngOnDestroy(): void {
    this.keepTooltipOpen();
    //this._prevSidebarState ? this.layoutState.collapse() : this.layoutState.expand();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private buildTimeline(): void {
    const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    this.weeks = [];
    this.days = [];
    for (let d = 0; d < this.totalDays; d++) {
      const date = new Date(this.timelineStart);
      date.setDate(date.getDate() + d);
      const isToday = date.toDateString() === this.today.toDateString();
      const dow = DOW[date.getDay()];
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      this.days.push({ dayOfWeek: dow, date: date.getDate(), calendarDate: date, isToday, isWeekend, isPast: d < this.todayOffset });
      if (d === 0 || this.timeUnit === 'day' ||
          (this.timeUnit === 'week' && d % 7 === 0) ||
          (this.timeUnit === 'month' && date.getDate() === 1)) {
        const end = new Date(date);
        if (this.timeUnit === 'week') end.setDate(end.getDate() + 6);
        if (this.timeUnit === 'month') end.setMonth(end.getMonth() + 1, 0);
        const visibleEnd = new Date(this.timelineStart);
        visibleEnd.setDate(visibleEnd.getDate() + this.totalDays - 1);
        if (end > visibleEnd) end.setTime(visibleEnd.getTime());
        this.weeks.push({
          label: this.timeUnit === 'month' ? `${MONTHS[date.getMonth()]} ${date.getFullYear()}`
            : this.timeUnit === 'day' ? `${MONTHS[date.getMonth()]} ${date.getDate()}`
            : `${MONTHS[date.getMonth()]} ${date.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}`,
          days: [],
          startDay: d,
        });
      }
      this.weeks[this.weeks.length - 1].days.push(this.days[d]);
    }
  }

  private dayOffset(date: Date): number {
    const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const start = Date.UTC(this.timelineStart.getFullYear(), this.timelineStart.getMonth(), this.timelineStart.getDate());
    return (day - start) / 86_400_000;
  }

  private loadCalendarData(filters?: CalendarFilters): void {
    this.closeAssignmentMenu();
    const requestId = ++this.calendarRequestId;
    filters = { ...this.calendarScope, ...filters };
    this.loading = true;
    this.loadError = null;
    const now = new Date();
    // Default to a wide window so navigating the timeline doesn't run out of fetched data.
    const fromDate = filters.from ?? this.selectedFrom;
    const toDate = filters.to ?? this.selectedTo;
    const from = fromDate ? new Date(`${fromDate}T00:00:00`) : new Date(now.getTime() - 45 * 86_400_000);
    const to = toDate ? new Date(`${toDate}T00:00:00`) : new Date(now.getTime() + 45 * 86_400_000);
    this.fetchedFrom = from;
    this.fetchedTo = to;
    this.calendarService.getCalendar({
      cluster: filters?.cluster,
      site: filters?.site,
      wellType: filters?.wellType,
      project: filters?.project,
      from: this.toDateStr(from),
      to: this.toDateStr(to),
      includeAssignments: false,
      includeRoster: true,
    }).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
      if (requestId !== this.calendarRequestId) return;
        if (data && data.groups && data.groups.length > 0) {
          this.applyCalendarData(data);
        } else {
          // Genuine empty result — clear the board and show an empty state, never mock.
          this.applyCalendarData({ ...data, groups: [] } as CrewCalendarData);
        }
        this.loading = false;
        if (this.utilizationReport) this.openUtilizationReport(true);
        this.cdr.detectChanges();
      },
      error: (err) => {
        if (requestId !== this.calendarRequestId) return;
        // Surface the failure instead of silently rendering stale or mock data.
        this.crewGroups = [];
        this.calendarData = null;
        this.loadError = err?.status === 401
          ? 'Your session has expired. Please sign in again to load crew data.'
          : 'Unable to load crew data. Please retry.';
        this.loading = false;
        this.cdr.detectChanges();
      },
    });
  }

  reload(): void {
    this.loadCalendarData();
  }

  openAssignmentMenu(event: Event, bar: GanttBar): void {
    this.closeAssignmentMenu();
    const activity = bar.activities?.[0];
    if (this.loading || this.assignmentDeletion || bar.summary || bar.reserved || bar.proposed ||
        bar.source !== 'assignment' || bar.activities?.length !== 1 || activity?.source !== 'assignment' ||
        activity.proposed || typeof activity.assignmentId !== 'number' ||
        !Number.isSafeInteger(activity.assignmentId) || activity.assignmentId <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.keepTooltipOpen();
    this.tooltipText = null;
    this.tooltipActivities = [];
    this.assignmentMenuTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const bounds = this.assignmentMenuTrigger?.getBoundingClientRect();
    const left = event instanceof MouseEvent ? event.clientX : bounds?.left ?? 8;
    const top = event instanceof MouseEvent ? event.clientY : bounds?.bottom ?? 8;
    this.assignmentMenu = {
      activity: { ...activity, assignmentId: activity.assignmentId },
      left: Math.max(8, Math.min(left, window.innerWidth - 216)),
      top: Math.max(8, Math.min(top, window.innerHeight - 56)),
    };
    this.cdr.detectChanges();
    this.assignmentMenuElement?.nativeElement.querySelector<HTMLButtonElement>('button')?.focus();
  }

  @HostListener('window:resize')
  closeAssignmentMenu(): void {
    this.assignmentMenu = null;
  }

  requestAssignmentDeletion(): void {
    if (!this.assignmentMenu || this.assignmentDeletion) return;
    this.assignmentDeletion = { activity: this.assignmentMenu.activity, saving: false, error: null };
    this.closeAssignmentMenu();
    this.cdr.detectChanges();
    this.assignmentDeleteDialog?.nativeElement.querySelector<HTMLButtonElement>('.btn-secondary')?.focus();
  }

  cancelAssignmentDeletion(): void {
    if (this.assignmentDeletion?.saving) return;
    this.assignmentDeletion = null;
    this.restoreAssignmentFocus();
  }

  confirmAssignmentDeletion(): void {
    const deletion = this.assignmentDeletion;
    if (!deletion || deletion.saving) return;
    deletion.saving = true;
    deletion.error = null;
    this.cdr.detectChanges();
    this.calendarService.unassign(deletion.activity.assignmentId).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        if (this.assignmentDeletion === deletion) this.finishAssignmentDeletion();
      },
      error: error => {
        if (this.assignmentDeletion !== deletion) return;
        if (error?.status === 404) {
          this.finishAssignmentDeletion();
          return;
        }
        deletion.saving = false;
        deletion.error = error?.status === 403
          ? 'You do not have permission to delete this assignment.'
          : 'Unable to delete the assignment. Please try again.';
        this.cdr.detectChanges();
      },
    });
  }

  private finishAssignmentDeletion(): void {
    this.assignmentDeletion = null;
    this.restoreAssignmentFocus();
    this.reload();
  }

  private restoreAssignmentFocus(): void {
    if (this.assignmentMenuTrigger?.isConnected) this.assignmentMenuTrigger.focus();
    this.assignmentMenuTrigger = null;
  }

  trapAssignmentDeleteFocus(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    const buttons = this.assignmentDeleteDialog?.nativeElement.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    if (!buttons?.length) {
      event.preventDefault();
      return;
    }
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // ─── Unassigned crews + inline assign ────────────────────────────────────────

  toggleUnassigned(): void {
    this.showUnassigned = !this.showUnassigned;
    this.unassignedRequestId++;
    this.unassignedLoading = false;
    this.crewGroups = [];
    this.wellRows = [];
    if (!this.showUnassigned) {
      this.assignPanel = null;
      this.unassignedGroups = [];
    }
    if (this.calendarData?.roster) {
      this.rebuildView();
      return;
    }
    // Reload the calendar; applyCalendarData refreshes the unassigned list for the window.
    this.loadCalendarData({
      from: this.selectedFrom ?? this.toDateStr(this.timelineStart),
      to: this.selectedTo ?? this.toDateStr(this.timelineEnd),
    });
  }

  // Segmented "Assigned / Unassigned" view switch.
  setCrewView(view: 'assigned' | 'unassigned'): void {
    const wantUnassigned = view === 'unassigned';
    if (this.showUnassigned === wantUnassigned) return;
    this.toggleUnassigned();
  }

  loadUnassignedCrews(): void {
    const requestId = ++this.unassignedRequestId;
    const expandedGroups = new Map(this.crewGroups.map(group => [group.id, group.expanded]));
    this.unassignedLoading = true;
    this.unassignedGroups = [];
    this.crewGroups = [];
    this.wellRows = [];
    // Scope the unassigned list to the visible date window.
    const visibleEnd = new Date(this.timelineStart.getTime() + (this.totalDays - 1) * 86_400_000);
    const from = this.toDateStr(this.timelineStart);
    const to = this.toDateStr(visibleEnd);
    if (this.calendarData?.roster) {
      this.unassignedGroups = this.calendarData.groups.map(group => ({
        crewGroupCode: group.crewGroupCode,
        crewGroupName: group.crewGroupName ?? null,
        crews: group.crews.filter(crew => crew.crewCode &&
          bookedDaysInWindow([...crew.activities, ...(crew.bookings ?? [])], from, to) === 0)
          .map(crew => ({ crewUid: crew.crewCode, crewTypeCode: crew.crewTypeCode ?? null })),
      })).filter(group => group.crews.length > 0);
      this.crewGroups = this.mapUnassignedToCrewGroups(this.unassignedGroups);
      this.crewGroups.forEach(group => { group.expanded = expandedGroups.get(group.id) ?? false; });
      this.unassignedLoading = false;
      this.cdr.detectChanges();
      return;
    }
    this.calendarService.getUnassignedCrews(undefined, from, to).pipe(takeUntil(this.destroy$)).subscribe({
      next: (data) => {
        if (!this.showUnassigned || requestId !== this.unassignedRequestId) return;
        this.unassignedGroups = data?.groups ?? [];
        // Render unassigned crews as native Gantt crew-group/crew rows.
        this.crewGroups = this.mapUnassignedToCrewGroups(this.unassignedGroups);
        this.crewGroups.forEach(group => { group.expanded = expandedGroups.get(group.id) ?? false; });
        this.unassignedLoading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        if (!this.showUnassigned || requestId !== this.unassignedRequestId) return;
        this.unassignedGroups = [];
        this.crewGroups = [];
        this.unassignedLoading = false;
        this.cdr.detectChanges();
      },
    });
  }

  openAssign(crewGroupCode: string, crewGroupName: string | null, crewUid: string, crewTypeCode: string | null): void {
    this.assignError = null;
    this.assignPanel = {
      crewGroupCode,
      crewGroupName,
      crewUid,
      crewTypeCode,
      activities: [],
      loadingActivities: true,
      selectedActivityCodes: [],
      activitySearch: '',
      plannedStart: '',
      plannedEnd: '',
      saving: false,
    };
    const panel = this.assignPanel;
    this.calendarService
      .getAssignableActivities(crewGroupCode, crewTypeCode ?? undefined)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (data) => {
          if (this.assignPanel === panel) {
            this.assignPanel.activities = [...new Map((data?.activities ?? []).map(activity => [activity.activityCode, activity])).values()];
            this.assignPanel.loadingActivities = false;
          }
          this.cdr.detectChanges();
        },
        error: () => {
          if (this.assignPanel === panel) {
            this.assignPanel.activities = [];
            this.assignPanel.loadingActivities = false;
            this.assignError = 'Failed to load activities. Close and reopen to retry.';
          }
          this.cdr.detectChanges();
        },
      });
  }

  closeAssign(): void {
    if (this.assignPanel?.saving) return;
    this.assignPanel = null;
    this.assignError = null;
  }

  get filteredAssignActivities(): AssignableActivity[] {
    const panel = this.assignPanel;
    if (!panel) return [];
    const search = panel.activitySearch.trim().toLowerCase();
    return panel.activities.filter(activity =>
      `${activity.activityCode} ${activity.activityName}`.toLowerCase().includes(search));
  }

  toggleAssignActivity(code: string): void {
    const panel = this.assignPanel;
    if (!panel || panel.saving) return;
    panel.selectedActivityCodes = panel.selectedActivityCodes.includes(code)
      ? panel.selectedActivityCodes.filter(selected => selected !== code)
      : [...panel.selectedActivityCodes, code];
  }

  confirmAssign(): void {
    const p = this.assignPanel;
    if (!p?.selectedActivityCodes.length || p.saving) return;
    const activities = p.activities.filter(activity => p.selectedActivityCodes.includes(activity.activityCode));
    if (!activities.length) return;
    if (p.plannedStart && p.plannedEnd && p.plannedEnd < p.plannedStart) {
      this.assignError = 'Planned end must be on or after planned start.';
      return;
    }

    p.saving = true;
    this.assignError = null;
    from(activities).pipe(concatMap(activity => this.calendarService.assignActivity({
      crewGroupCode: p.crewGroupCode,
      crewUid: p.crewUid,
      crewTypeCode: p.crewTypeCode,
      activityCode: activity.activityCode,
      activityName: activity.activityName,
      wellId: this.wellId || null,
      projectId: null,
      plannedStart: p.plannedStart || null,
      plannedEnd: p.plannedEnd || null,
    }).pipe(
      map(() => ({ code: activity.activityCode, error: null as string | null })),
      catchError(err => of({ code: activity.activityCode, error: String(err?.error?.message ?? 'Failed to assign activity.') })),
    )), toArray(), takeUntil(this.destroy$)).subscribe({
      next: results => {
        const failures = results.filter(result => result.error !== null);
        const succeeded = results.length - failures.length;
        p.saving = false;
        p.selectedActivityCodes = failures.map(result => result.code);
        const assignedCodes = new Set(results.filter(result => result.error === null).map(result => result.code));
        p.activities = p.activities.filter(activity => !assignedCodes.has(activity.activityCode));
        if (failures.length) {
          this.assignError = `${succeeded} assigned; ${failures.length} failed. ${failures.map(result => `${result.code}: ${result.error}`).join(' ')}`;
        } else {
          this.assignPanel = null;
        }
        this.cdr.detectChanges();
        if (!succeeded) return;
        if (this.showUnassigned) {
          this.loadUnassignedCrews();
        } else {
          this.loadCalendarData({
            from: this.selectedFrom ?? this.toDateStr(this.timelineStart),
            to: this.selectedTo ?? this.toDateStr(this.timelineEnd),
          });
        }
      },
    });
  }

  private generateMockCalendarData(from: Date, to: Date): CrewCalendarData {
    const toDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    
    const wellIds = ['35495', '35496', '35497', '35498'];
    const activities = ['Drilling', 'Completion', 'Production Testing', 'Well Intervention', 'Stimulation'];
    const statuses = ['completed', 'inprogress', 'delayed', 'not-started'];
    
    const mockGroups: CalendarGroup[] = [
      {
        crewGroupCode: 'FRL-0504',
        activityCount: 8,
        completionPct: 65,
        crews: [
          {
            crewCode: 'CREW-001',
            activities: Array.from({ length: 4 }, (_, i) => ({
              activityCode: `ACT-${i + 1}`,
              activityName: activities[i % activities.length],
              wellId: wellIds[i % wellIds.length],
              category: 'Drilling',
              plannedStart: toDateStr(new Date(from.getTime() + i * 7 * 86400000)),
              plannedEnd: toDateStr(new Date(from.getTime() + (i * 7 + 5) * 86400000)),
              actualStart: i % 2 === 0 ? toDateStr(new Date(from.getTime() + i * 7 * 86400000)) : null,
              actualEnd: i === 0 ? toDateStr(new Date(from.getTime() + (i * 7 + 4) * 86400000)) : null,
              progress: i === 0 ? 100 : i === 1 ? 75 : i === 2 ? 45 : 0,
              status: statuses[i],
              isMilestone: i === 3,
              rigOnDate: null,
              expectedRigOnDate: null,
              normsPerDay: 100,
              productivityPct: 95,
            })),
          },
        ],
      },
      {
        crewGroupCode: 'LCC-0803',
        activityCount: 6,
        completionPct: 40,
        crews: [
          {
            crewCode: 'CREW-002',
            activities: Array.from({ length: 3 }, (_, i) => ({
              activityCode: `ACT-C2-${i + 1}`,
              activityName: activities[(i + 2) % activities.length],
              wellId: wellIds[(i + 1) % wellIds.length],
              category: 'Completion',
              plannedStart: toDateStr(new Date(from.getTime() + (i + 2) * 7 * 86400000)),
              plannedEnd: toDateStr(new Date(from.getTime() + (i * 7 + 12) * 86400000)),
              actualStart: i % 2 === 0 ? toDateStr(new Date(from.getTime() + (i + 2) * 7 * 86400000)) : null,
              actualEnd: null,
              progress: i === 0 ? 80 : i === 1 ? 35 : 0,
              status: i === 0 ? 'inprogress' : i === 1 ? 'not-started' : 'delayed',
              isMilestone: false,
              rigOnDate: null,
              expectedRigOnDate: null,
              normsPerDay: 85,
              productivityPct: 88,
            })),
          },
        ],
      },
      {
        crewGroupCode: 'FCC-0501',
        activityCount: 5,
        completionPct: 55,
        crews: [
          {
            crewCode: 'CREW-003',
            activities: Array.from({ length: 2 }, (_, i) => ({
              activityCode: `ACT-C3-${i + 1}`,
              activityName: activities[(i + 3) % activities.length],
              wellId: wellIds[(i + 2) % wellIds.length],
              category: 'Production Testing',
              plannedStart: toDateStr(new Date(from.getTime() + (i + 3) * 7 * 86400000)),
              plannedEnd: toDateStr(new Date(from.getTime() + (i + 8) * 7 * 86400000)),
              actualStart: i === 0 ? toDateStr(new Date(from.getTime() + (i + 3) * 7 * 86400000)) : null,
              actualEnd: i === 0 ? toDateStr(new Date(from.getTime() + (i + 6) * 7 * 86400000)) : null,
              progress: i === 0 ? 100 : 20,
              status: i === 0 ? 'completed' : 'inprogress',
              isMilestone: i === 1,
              rigOnDate: null,
              expectedRigOnDate: null,
              normsPerDay: 120,
              productivityPct: 92,
            })),
          },
        ],
      },
    ];

    return {
      totalGroups: mockGroups.length,
      totalCrews: 3,
      totalActivities: 9,
      totalMilestones: 2,
      fromDate: toDateStr(from),
      toDate: toDateStr(to),
      groups: mockGroups,
      milestones: [],
    };
  }

  private calendarData: CrewCalendarData | null = null;
  private actualCalendarGroups: CalendarGroup[] = [];
  private actualSummaryCache: {
    source: CalendarGroup[];
    key: string;
    metrics: { label: string; count: number | null; unit?: string }[];
  } | null = null;
  private readonly rosterCrewIdsByGroup = new Map<string, Set<string>>();

  private get activeCalendarGroups(): CalendarGroup[] {
    return this.calendarGroupsFor(this.scheduleFilter === 'actual' ? 'actual' : 'planned');
  }

  private calendarGroupsFor(view: 'planned' | 'actual'): CalendarGroup[] {
    const groups = view === 'actual' ? this.actualCalendarGroups : this.calendarData?.groups ?? [];
    if (!this.calendarData?.roster) return groups;
    return groups.map(group => {
      const members = this.rosterCrewIdsByGroup.get(group.crewGroupCode.trim().toLowerCase());
      return { ...group, crews: group.crews.filter(crew => members?.has(crew.crewCode.trim().toLowerCase())) };
    }).filter(group => group.crews.length > 0);
  }

  private actualCalendarSummary(): { label: string; count: number | null; unit?: string }[] {
    const from = this.selectedFrom ?? this.toDateStr(this.timelineStart);
    const to = this.selectedTo ?? this.toDateStr(this.timelineEnd);
    const today = this.toDateStr(new Date());
    const key = JSON.stringify([from, to, today, this.calendarScope.cluster, this.calendarScope.site,
      this.searchTerm, [...this.rowFilterSelected], this.utilizationBasis, this.utilizationFilter]);
    if (this.actualSummaryCache?.source === this.actualCalendarGroups && this.actualSummaryCache.key === key) {
      return this.actualSummaryCache.metrics;
    }
    const report = buildCrewUtilizationReport({ ...this.calendarData!, groups: this.reportGroupsInRange(from, to) },
      from, to, today, 'actual');
    const workingGroups = report.groups.filter(group => group.crews.some(crew => crew.actualAssignedDays > 0));
    const workingCrews = new Set(workingGroups.flatMap(group => group.crews
      .filter(crew => crew.actualAssignedDays > 0).map(crew => crew.crewId.trim().toLowerCase())));
    const metrics = [
      { label: 'Total crew groups', count: workingGroups.length },
      { label: 'Total actual crews', count: workingCrews.size },
      { label: 'Avg Planned Utilization', count: report.summary.averagePlannedUtilization, unit: '%' },
      { label: 'Avg Actual Utilization', count: report.totals.utilization, unit: '%' },
    ];
    this.actualSummaryCache = { source: this.actualCalendarGroups, key, metrics };
    return metrics;
  }

  openUtilizationReport(useFilterRange = false, range?: Pick<CrewUtilizationReport, 'from' | 'to'>): void {
    if (this.loading || this.loadError || !this.calendarData) return;
    const selected = new Map(this.ganttGroups.map(group => [group.name.trim().toLowerCase(),
      new Set(this.visibleCrews(group).map(crew => crew.id.trim().toLowerCase()))]));
    const from = range?.from ?? (useFilterRange && this.selectedFrom ? this.selectedFrom : this.toDateStr(this.timelineStart));
    const to = range?.to ?? (useFilterRange && this.selectedTo ? this.selectedTo : this.toDateStr(this.timelineEnd));
    const groups = useFilterRange ? this.reportGroupsInRange(from, to) : this.groupsInWindow(this.activeCalendarGroups, from, to, true)
      .filter(group => selected.has(group.crewGroupCode.trim().toLowerCase()))
      .map(group => ({ ...group, crews: group.crews.filter(crew =>
        selected.get(group.crewGroupCode.trim().toLowerCase())!.has(crew.crewCode.trim().toLowerCase())) }));
    this.utilizationReport = buildCrewUtilizationReport({ ...this.calendarData, groups }, from, to, this.toDateStr(new Date()),
      this.scheduleFilter === 'actual' ? 'actual' : 'planned');
    const reportMembers = new Map(groups.map(group => [group.crewGroupCode.trim().toLowerCase(),
      new Set(group.crews.map(crew => crew.crewCode.trim().toLowerCase()))]));
    const reportFor = (view: 'planned' | 'actual') => {
      const matchingGroups = this.groupsInWindow(this.calendarGroupsFor(view), from, to, true, view)
        .filter(group => reportMembers.has(group.crewGroupCode.trim().toLowerCase()))
        .map(group => ({ ...group, crews: group.crews.filter(crew =>
          reportMembers.get(group.crewGroupCode.trim().toLowerCase())!.has(crew.crewCode.trim().toLowerCase())) }));
      return buildCrewUtilizationReport({ ...this.calendarData!, groups: matchingGroups }, from, to, this.toDateStr(new Date()), view);
    };
    this.utilizationPlannedReport = reportFor('planned');
    this.utilizationActualReport = reportFor('actual');
    const site = this.calendarScope.site;
    const plant = this.allPlants.find(item => String(item.plantCode) === site)?.plantDescription ?? site;
    this.filterFrom = from;
    this.filterTo = to;
    this.filterCluster = this.calendarScope.cluster ?? '';
    this.filterPlant = plant ?? '';
    this.utilizationScopeLabel = `${this.calendarScope.cluster || 'All clusters'} / ${plant || 'All plants'}`;
    this.utilizationScopedActivities = !!(this.calendarScope.cluster || site);
    const mode = { planned: 'Planned', actual: 'Actual', 'planned-actual': 'Planned + Actual' }[this.scheduleFilter];
    this.utilizationExportCluster = this.calendarScope.cluster ?? '';
    this.utilizationExportView = this.showUnassigned ? 'Unassigned' : mode;
    const selections = [this.showUnassigned ? 'Unassigned' : `Assigned | ${mode}`];
    if (this.searchTerm.trim()) selections.push(`Search: ${this.searchTerm.trim()}`);
    if (this.rowFilterSelected.size) selections.push(`${this.rowFilterSelected.size} row selections`);
    if (this.utilizationFilter !== 'all') {
      selections.push(`${this.utilizationBasis === 'planned' ? 'Planned' : 'Actual'} utilization: ${this.utilizationFilter}`);
    }
    this.utilizationSelectionLabel = selections.join(' | ');
    this.keepTooltipOpen();
    this.tooltipText = null;
    this.closeAssignmentMenu();
  }

  setUtilizationReportView(view: 'planned' | 'actual'): void {
    if (!this.utilizationReport || this.loading || this.loadError) return;
    const range = { from: this.utilizationReport.from, to: this.utilizationReport.to };
    this.setScheduleFilter(view);
    this.openUtilizationReport(true, range);
  }

  closeUtilizationReport(): void {
    this.utilizationReport = null;
    this.utilizationPlannedReport = null;
    this.utilizationActualReport = null;
    this.cdr.detectChanges();
    this.utilizationReportButton?.nativeElement.focus({ preventScroll: true });
  }

  private reportGroupsInRange(from: string, to: string): CalendarGroup[] {
    const candidates = this.groupsInWindow(this.activeCalendarGroups, from, to, true);
    const measures = buildCrewUtilizationReport({ ...this.calendarData!, groups: candidates }, from, to, this.toDateStr(new Date()));
    const metrics = new Map(measures.groups.map(group => [group.code.trim().toLowerCase(),
      new Map(group.crews.map(crew => [crew.crewId.trim().toLowerCase(), crew]))]));
    const cluster = this.calendarScope.cluster?.trim().toLowerCase();
    const search = this.searchTerm.trim().toLowerCase();
    return candidates.map(group => {
      const members = metrics.get(group.crewGroupCode.trim().toLowerCase());
      const crews = group.crews.filter(crew => {
        const metric = members?.get(crew.crewCode.trim().toLowerCase());
        if (!metric) return false;
        const projects = this.rosterProjectsByCrew.get(crew.crewCode.trim().toLowerCase()) ?? crew.projects ?? [];
        if (cluster && !projects.some(project => project.cluster?.trim().toLowerCase() === cluster)) return false;
        if (this.showUnassigned && metric.plannedDays > 0) return false;
        if (this.rowFilterSelected.size && !this.rowFilterSelected.has(group.crewGroupCode) && !this.rowFilterSelected.has(crew.crewCode)) return false;
        const plannedUtilization = metric.availableDays ? metric.plannedDays / metric.availableDays * 100 : null;
        const utilization = this.utilizationBasis === 'actual' ? metric.utilization : plannedUtilization;
        return this.utilizationFilter === 'all' || crewUtilizationStatus(utilization) === this.utilizationFilter;
      });
      const matches = !search || group.crewGroupCode.toLowerCase().includes(search) ||
        group.crewGroupName?.toLowerCase().includes(search) || crews.some(crew => crew.crewCode.toLowerCase().includes(search) ||
          crew.activities.some(activity => (activity.activityName || activity.activityCode).toLowerCase().includes(search)));
      return { ...group, crews: matches ? crews : [] };
    }).filter(group => group.crews.length > 0);
  }

  private selectedFrom: string | null = null;
  private selectedTo: string | null = null;

  // The actual window last fetched from the API (with buffer). Timeline navigation
  // re-fetches only when the visible range moves outside this window.
  private fetchedFrom: Date | null = null;
  private fetchedTo: Date | null = null;

  get crewPlanning(): boolean {
    return !!this.calendarData?.roster && !this.showUnassigned;
  }

  private applyCalendarData(data: CrewCalendarData): void {
    const expandedGroups = new Map(this.crewGroups.map(group => [group.id, group.expanded]));
    const planningData = {
      ...data,
      actualCrewWork: data.actualCrewWork ?? this.extractActualCrewWork(data.groups),
      groups: this.groupsInWindow(data.groups,
        data.fromDate || this.selectedFrom || this.toDateStr(this.timelineStart),
        data.toDate || this.selectedTo || this.toDateStr(this.timelineEnd), false, 'planned'),
    };
    this.calendarData = data.roster ? buildCrewCalendarPlan(planningData, data.roster, data.retainedPlan) : planningData;
    const actualData = { ...data, groups: this.groupsInWindow(data.actualGroups ?? data.groups,
      data.fromDate || this.selectedFrom || this.toDateStr(this.timelineStart),
      data.toDate || this.selectedTo || this.toDateStr(this.timelineEnd), false, 'actual') };
    this.actualCalendarGroups = data.roster ? buildCrewCalendarPlan(actualData, data.roster).groups : actualData.groups;
    this.rosterCrewIdsByGroup.clear();
    this.rosterProjectsByCrew.clear();
    for (const group of data.roster?.groups ?? []) {
      const groupId = group.crewGroupCode.trim().toLowerCase();
      const crewIds = this.rosterCrewIdsByGroup.get(groupId) ?? new Set<string>();
      for (const crew of group.crews) {
        const crewId = crew.crewUid.trim().toLowerCase();
        if (crewId) crewIds.add(crewId);
        this.rosterProjectsByCrew.set(crewId, crew.projects ?? []);
      }
      this.rosterCrewIdsByGroup.set(groupId, crewIds);
    }
    if (data.roster && data.planningScope) {
      this.calendarService.saveSessionPlan(data.planningScope, this.calendarData);
    }
    this.today = new Date();
    this.updateTimelineWindow();

    this.wellName = 'Crew Calendar';
    this.breadcrumbs[1] = { label: this.wellName };

    if (!this.showUnassigned) {
      this.crewGroups = this.groupsInWindow(this.activeCalendarGroups).map((g, i) => this.mapGroup(g, i));
      this.crewGroups.forEach(group => {
        group.expanded = expandedGroups.get(group.id) ?? false;
      });
      this.buildWellRows();
    }
    this.buildTimeline();

    // Unassigned view renders its own crew-group/crew rows scoped to the window.
    if (this.showUnassigned) this.loadUnassignedCrews();
  }

  private extractActualCrewWork(groups: CalendarGroup[]): CrewActualWork[] {
    return groups.flatMap(group => group.crews.filter(crew => crew.crewCode.trim()).flatMap(crew =>
      crew.activities.filter(activity => !activity.isMilestone && (activity.actualStart || activity.actualEnd)).flatMap(activity => {
        const validPlan = activity.plannedStart && activity.plannedEnd &&
          activity.plannedEnd >= activity.plannedStart && activity.actualEnd && activity.plannedStart <= activity.actualEnd;
        const start = activity.actualStart || (validPlan ? activity.plannedStart : activity.actualEnd);
        return start ? [{ crewGroupCode: group.crewGroupCode, crewCode: crew.crewCode,
          actualStart: start, actualEnd: activity.actualEnd }] : [];
      }),
    ));
  }

  private mapUnassignedToCrewGroups(groups: UnassignedCrewGroup[]): CrewGroup[] {
    const activityCounts = new Map<string, number>();
    for (const group of this.groupsInWindow(this.calendarData?.groups ?? [])) {
      const activities = new Set(group.crews.flatMap(crew => crew.activities
        .filter(activity => !!activity.activityCode?.trim())
        .map(activity => JSON.stringify([
          activity.activityCode.trim().toLowerCase(), activity.wellId?.trim().toLowerCase() || '',
        ])),
      ));
      activityCounts.set(group.crewGroupCode.trim().toLowerCase(), activities.size);
    }
    return groups.map((g, i) => ({
      id: g.crewGroupCode.toLowerCase(),
      name: g.crewGroupCode,
      crewGroupName: g.crewGroupName?.trim(),
      subtitle: g.crewGroupName || `${g.crews.length} crews`,
      percent: 0,
      color: this.GROUP_COLORS[i % this.GROUP_COLORS.length],
      expanded: false,
      bars: [],
      wells: g.crews.map(c => ({
        id: c.crewUid,
        name: c.crewUid,
        percent: 0,
        expanded: false,
        bars: [],
        activities: [],
        noActivities: true,
        unassigned: true,
        crewTypeCode: c.crewTypeCode,
        projects: this.rosterProjectsByCrew.get(c.crewUid.trim().toLowerCase()) ?? [],
      })),
    })).sort((first, second) =>
      (activityCounts.get(second.id.trim()) ?? 0) - (activityCounts.get(first.id.trim()) ?? 0) ||
      first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: 'base' }),
    );
  }

  private groupsInWindow(groups: CalendarGroup[], from = this.toDateStr(this.timelineStart),
    to = this.toDateStr(this.timelineEnd), keepEmptyCrews = this.crewPlanning,
    schedule: ScheduleFilter = this.scheduleFilter): CalendarGroup[] {
    return groups.map(group => ({
      ...group,
      crews: group.crews.map(crew => ({
        ...crew,
        activities: crew.activities.filter(activity => {
          const planned = !!activity.plannedStart && !!activity.plannedEnd &&
            activity.plannedEnd >= activity.plannedStart && activity.plannedStart <= to && activity.plannedEnd >= from;
          if (schedule === 'planned') return planned;
          const actual = actualDaysInWindow([activity], from, to, this.toDateStr(this.today)) > 0;
          return schedule === 'actual' ? actual : planned || actual;
        }),
      })).filter(crew => crew.activities.length > 0 || (keepEmptyCrews && !!crew.crewCode.trim())),
    })).filter(group => group.crews.length > 0);
  }

  private mapGroup(g: CalendarGroup, index: number): CrewGroup {
    const fromDate = this.toDateStr(this.timelineStart);
    const toDate = this.toDateStr(this.timelineEnd);
    const wells: WellRow[] = g.crews.map(c => {
      const activities: ActivityRow[] = c.activities.map(a => {
        const bar = this.mapActivityToBar({ ...a, crewId: c.crewCode?.trim() || null }, !!c.crewCode?.trim());
        const status = bar.type;
        return {
          id: `${a.activityCode}-${a.wellId}`,
          name: a.activityName || a.activityCode,
          category: a.category || 'General',
          status,
          percent: Math.round(bar.progress),
          bar,
        };
      });
      const avgProgress = activities.length > 0
        ? Math.round(activities.reduce((sum, activity) => sum + activity.percent, 0) / activities.length)
        : 0;
      const hasCrew = !!c.crewCode?.trim();
      const crewBars = this.crewPlanning
        ? this.layoutCrewBars([...activities.map(activity => activity.bar),
          ...uncoveredBookings(c.bookings ?? [], c.activities).map(booking => this.mapReservationToBar(booking))])
        : this.summarizeBars(activities.map(activity => activity.bar));
      const bookedDays = bookedDaysInWindow([...c.activities, ...(c.bookings ?? [])],
        fromDate, toDate);
      return {
        id: hasCrew ? c.crewCode : `${g.crewGroupCode}:unassigned`,
        name: hasCrew ? c.crewCode : 'Unassigned activities',
        percent: this.crewPlanning && hasCrew ? Math.round(bookedDays / this.totalDays * 100) : avgProgress,
        expanded: false, bars: crewBars, activities,
        unassigned: !hasCrew,
        noActivities: hasCrew && crewBars.length === 0,
        crewTypeCode: c.crewTypeCode,
        projects: c.projects ?? [],
        bookedDays,
        actualDays: actualDaysInWindow(c.activities, fromDate, toDate, this.toDateStr(this.today)),
        rowHeight: Math.max(56, crewBars.reduce((height, bar) => Math.max(height, ((bar.lane ?? 0) + 1) * 42 + 12), 0)),
      };
    });
    wells.sort((first, second) => Number(first.unassigned) - Number(second.unassigned));

    const groupBars = this.summarizeBars(wells.flatMap(crew => crew.activities.map(activity => activity.bar)));
    const allActivities = g.crews.flatMap(c => c.activities);
    // Activity-weighted average: every activity counts equally, instead of an
    // unweighted mean-of-crew-means that over-weights crews with few activities.
    const avgGroupProgress = allActivities.length > 0
      ? Math.round(wells.flatMap(crew => crew.activities).reduce((sum, activity) => sum + activity.percent, 0) / allActivities.length)
      : 0;

    const uniqueWells = new Set(allActivities.map(a => a.wellId).filter(Boolean));
    const unassignedCount = wells.filter(crew => crew.unassigned).reduce((sum, crew) => sum + crew.activities.length, 0);
    const assignedCount = allActivities.length - unassignedCount;
    const rosterCrewIds = this.rosterCrewIdsByGroup.get(g.crewGroupCode.trim().toLowerCase());
    const bookedCrewDays = wells.reduce((total, crew) => total + (
      !crew.unassigned && rosterCrewIds?.has(crew.id.trim().toLowerCase()) ? crew.bookedDays ?? 0 : 0
    ), 0);
    const capacityCrewDays = (rosterCrewIds?.size ?? 0) * this.totalDays;

    return {
      id: g.crewGroupCode.toLowerCase(),
      name: g.crewGroupCode,
      crewGroupName: g.crewGroupName?.trim(),
      subtitle: this.crewPlanning ? `${wells.filter(crew => !crew.unassigned).length} crews`
        : `${uniqueWells.size} ${uniqueWells.size === 1 ? 'well' : 'wells'}`,
      percent: avgGroupProgress,
      color: this.GROUP_COLORS[index % this.GROUP_COLORS.length],
      expanded: false,
      bars: groupBars,
      wells,
      assignedCount,
      unassignedCount,
      utilization: this.crewPlanning ? {
        bookedCrewDays,
        capacityCrewDays,
        percent: capacityCrewDays > 0 ? bookedCrewDays / capacityCrewDays * 100 : null,
      } : undefined,
    };
  }

  private summarizeBars(bars: GanttBar[]): GanttBar[] {
    const matching = bars.filter(bar => bar.plannedSpanDays > 0 || this.hasActualWork(bar));
    if (!matching.length) return [];
    const type: BarType = matching.every(bar => bar.type === 'completed') ? 'completed'
      : matching.some(bar => this.hasActualWork(bar)) ? 'in-progress' : 'planned';
    const planned = matching.filter(bar => bar.plannedSpanDays > 0);
    const startDay = planned.length ? Math.min(...planned.map(bar => bar.plannedStartDay)) : 0;
    const endDay = planned.length ? Math.max(...planned.map(bar => bar.plannedStartDay + bar.plannedSpanDays)) : 0;
    const actualRanges = matching.map(bar => this.actualBarRange(bar)).filter(range => range.spanDays > 0);
    const actualStartDay = actualRanges.length ? Math.min(...actualRanges.map(range => range.startDay)) : undefined;
    const actualEndDay = actualRanges.length ? Math.max(...actualRanges.map(range => range.startDay + range.spanDays)) : 0;
    const actualStarts = matching.map(bar => bar.actualStart).filter((date): date is string => !!date).sort();
    const actualEnds = matching.map(bar => bar.actualEnd).filter((date): date is string => !!date).sort();
    const activities = matching.flatMap(bar => bar.activities ?? []);
    return [{
      type, summary: true, hasCrew: matching.some(bar => bar.hasCrew),
      wellId: matching[0].wellId,
      startDay, spanDays: endDay - startDay,
      plannedStartDay: startDay, plannedSpanDays: endDay - startDay,
      plannedStart: planned.map(bar => bar.plannedStart!).sort()[0],
      plannedEnd: planned.map(bar => bar.plannedEnd!).sort().at(-1),
      actualStart: actualStarts[0],
      actualEnd: actualEnds.length === matching.length ? actualEnds.at(-1) : undefined,
      progress: Math.round(matching.reduce((sum, bar) => sum + bar.progress, 0) / matching.length),
      actualStartDay, actualSpanDays: actualStartDay === undefined ? 0 : actualEndDay - actualStartDay,
      slipDays: 0, activities,
      label: [...new Set(activities.map(activity => activity.activityCode))].join(', '),
    }];
  }

  private mapReservationToBar(booking: CrewBooking): GanttBar {
    const startDay = this.dayOffset(new Date(`${booking.plannedStart}T00:00:00`));
    const spanDays = this.dayOffset(new Date(`${booking.plannedEnd}T00:00:00`)) - startDay + 1;
    return {
      ...booking, type: 'planned', reserved: true, hasCrew: true,
      startDay, spanDays, plannedStartDay: startDay, plannedSpanDays: spanDays,
      actualSpanDays: 0, slipDays: 0, progress: 0,
    };
  }

  private layoutCrewBars(bars: GanttBar[]): GanttBar[] {
    const laneEnds: number[] = [];
    return bars.filter(bar => (bar.plannedSpanDays > 0 && bar.plannedStartDay < this.totalDays &&
      bar.plannedStartDay + bar.plannedSpanDays > 0) || this.hasActualInWindow(bar))
      .sort((first, second) => first.plannedStartDay - second.plannedStartDay)
      .map(bar => {
        const actual = this.actualBarRange(bar);
        const start = Math.min(bar.plannedStartDay, actual.startDay);
        const end = Math.max(bar.plannedStartDay + bar.plannedSpanDays, actual.startDay + actual.spanDays);
        let lane = laneEnds.findIndex(laneEnd => laneEnd <= start);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = end;
        bar.lane = lane;
        return bar;
      });
  }

  private mergeCrewBars(activities: CalendarActivity[]): GanttBar[] {
    if (!activities.length) return [];
    
    // Filter activities with valid dates
    const validActivities = activities.filter(a => a.plannedStart && a.plannedEnd);
    if (!validActivities.length) {
      // If no valid dates, create a default bar spanning today
      const today = new Date();
      const startDay = this.dayOffset(today);
      const spanDays = 5;
      const avgProgress = activities.reduce((s, a) => s + a.progress, 0) / activities.length;
      return [{
        type: 'not-started' as BarType,
        startDay: Math.max(0, startDay),
        spanDays,
        plannedStartDay: Math.max(0, startDay),
        plannedSpanDays: spanDays,
        actualSpanDays: Math.round(spanDays * (avgProgress / 100)),
        slipDays: 0,
        progress: Math.round(avgProgress),
        completionMarker: false,
        wellId: [...new Set(activities.map(a => a.wellId).filter(Boolean))][0],
        label: [...new Set(activities.map(a => a.activityCode).filter(Boolean))].join(', '),
        activities,
      }];
    }
    
    const starts = validActivities.map(a => new Date(a.plannedStart + 'T00:00:00').getTime());
    const ends = validActivities.map(a => new Date(a.plannedEnd + 'T00:00:00').getTime());
    const earliest = new Date(Math.min(...starts));
    const latest = new Date(Math.max(...ends));
    const startDay = this.dayOffset(earliest);
    const spanDays = Math.max(1, Math.round((latest.getTime() - earliest.getTime()) / 86_400_000) + 1);
    const avgProgress = validActivities.reduce((s, a) => s + a.progress, 0) / validActivities.length;
    const actualSpanDays = Math.round(spanDays * (avgProgress / 100));
    const completedCount = validActivities.filter(a => !!a.actualEnd).length;
    const delayedCount = validActivities.filter(a => a.status === 'delayed').length;
    const overdueCount = validActivities.filter(a => a.status === 'overdue').length;
    const inProgressCount = validActivities.filter(a => a.status === 'inprogress').length;
    let type: BarType;
    if (completedCount === validActivities.length) type = 'completed';
    else if (delayedCount > 0) type = 'delayed';
    else if (overdueCount > 0) type = 'overdue';
    else if (avgProgress > 0 || inProgressCount > 0) type = 'in-progress';
    else type = 'not-started';
    const wellIds = [...new Set(validActivities.map(a => a.wellId).filter(Boolean))];
    const pStarts = validActivities.map(a => a.plannedStart).sort();
    const pEnds = validActivities.map(a => a.plannedEnd).sort().reverse();
    const aStarts = validActivities.map(a => a.actualStart).filter(Boolean).sort() as string[];
    const aEnds = validActivities.map(a => a.actualEnd).filter(Boolean).sort().reverse() as string[];
    return [{
      type, startDay, spanDays,
      plannedStartDay: startDay, plannedSpanDays: spanDays,
      actualSpanDays, slipDays: 0, progress: Math.round(avgProgress),
      completionMarker: completedCount === validActivities.length,
      wellId: wellIds[0], label: [...new Set(validActivities.map(a => a.activityCode).filter(Boolean))].join(', '),
      activities: validActivities,
      plannedStart: pStarts[0], plannedEnd: pEnds[0],
      actualStart: aStarts[0], actualEnd: aEnds.length === validActivities.length ? aEnds[0] : undefined,
    }];
  }

  private mapActivityToBar(a: CalendarTooltipActivity, hasCrew = true): GanttBar {
    const start = new Date(a.plannedStart + 'T00:00:00');
    const end = new Date(a.plannedEnd + 'T00:00:00');
    const validPlan = Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end >= start;
    const plannedStartDay = validPlan ? this.dayOffset(start) : 0;
    const plannedSpanDays = validPlan ? this.dayOffset(end) - plannedStartDay + 1 : 0;
    const actualSpanDays = Math.round(plannedSpanDays * (a.progress / 100));
    const todayMs = this.today.getTime();
    const slipDays = (validPlan && !a.actualEnd && a.status === 'delayed' && todayMs > end.getTime())
      ? Math.round((todayMs - end.getTime()) / 86_400_000) : 0;

    let type: BarType;
    if (a.actualEnd) type = 'completed';
    else if (a.actualStart) type = 'in-progress';
    else type = 'planned';

    return {
      type,
      hasCrew,
      startDay: plannedStartDay,
      spanDays: plannedSpanDays,
      wellId: a.wellId,
      label: a.activityCode,
      activities: [a],
      plannedStartDay,
      plannedSpanDays,
      actualSpanDays,
      slipDays,
      progress: type === 'completed' ? 100 : Math.max(0, Math.min(100, a.progress)),
      plannedStart: a.plannedStart,
      plannedEnd: a.plannedEnd,
      actualStart: a.actualStart ?? undefined,
      actualEnd: a.actualEnd ?? undefined,
      source: a.source ?? 'legacy',
      proposed: a.proposed,
      completionMarker: type === 'completed',
      milestone: a.isMilestone,
    };
  }

  private mergeGroupBars(g: CalendarGroup): GanttBar[] {
    const allActs = g.crews.flatMap(c => c.activities);
    if (!allActs.length) return [];
    
    // Filter activities with valid dates
    const validActs = allActs.filter(a => a.plannedStart && a.plannedEnd);
    if (!validActs.length) {
      // If no valid dates, create a default bar spanning today
      const today = new Date();
      const startDay = this.dayOffset(today);
      const spanDays = 5;
      const avgProgress = allActs.reduce((s, a) => s + a.progress, 0) / allActs.length;
      return [{
        type: 'not-started' as BarType,
        startDay: Math.max(0, startDay),
        spanDays,
        plannedStartDay: Math.max(0, startDay),
        plannedSpanDays: spanDays,
        actualSpanDays: Math.round(spanDays * (avgProgress / 100)),
        slipDays: 0,
        progress: Math.round(avgProgress),
        completionMarker: false,
        wellId: [...new Set(allActs.map(a => a.wellId).filter(Boolean))][0],
        label: [...new Set(allActs.map(a => a.activityCode).filter(Boolean))].join(', '),
        activities: allActs,
      }];
    }
    
    const starts = validActs.map(a => new Date(a.plannedStart + 'T00:00:00').getTime());
    const ends = validActs.map(a => new Date(a.plannedEnd + 'T00:00:00').getTime());
    const earliest = new Date(Math.min(...starts));
    const latest = new Date(Math.max(...ends));
    const startDay = this.dayOffset(earliest);
    const spanDays = Math.max(1, Math.round((latest.getTime() - earliest.getTime()) / 86_400_000) + 1);
    const avgProgress = validActs.reduce((s, a) => s + a.progress, 0) / validActs.length;
    const actualSpanDays = Math.round(spanDays * (avgProgress / 100));

    const completedCount = validActs.filter(a => !!a.actualEnd).length;
    const delayedCount = validActs.filter(a => a.status === 'delayed').length;
    const overdueCount = validActs.filter(a => a.status === 'overdue').length;
    const inProgressCount = validActs.filter(a => a.status === 'inprogress').length;
    let type: BarType;
    if (completedCount === validActs.length) type = 'completed';
    else if (delayedCount > 0) type = 'delayed';
    else if (overdueCount > 0) type = 'overdue';
    else if (avgProgress > 0 || inProgressCount > 0) type = 'in-progress';
    else type = 'not-started';

    const wellIds = [...new Set(validActs.map(a => a.wellId).filter(Boolean))];
    const pStarts = validActs.map(a => a.plannedStart).sort();
    const pEnds = validActs.map(a => a.plannedEnd).sort().reverse();
    const aStarts = validActs.map(a => a.actualStart).filter(Boolean).sort() as string[];
    const aEnds = validActs.map(a => a.actualEnd).filter(Boolean).sort().reverse() as string[];
    return [{
      type, startDay, spanDays,
      plannedStartDay: startDay, plannedSpanDays: spanDays,
      actualSpanDays, slipDays: 0, progress: Math.round(avgProgress),
      completionMarker: completedCount === validActs.length,
      wellId: wellIds[0], label: [...new Set(validActs.map(a => a.activityCode).filter(Boolean))].join(', '),
      activities: validActs,
      plannedStart: pStarts[0], plannedEnd: pEnds[0],
      actualStart: aStarts[0], actualEnd: aEnds.length === validActs.length ? aEnds[0] : undefined,
    }];
  }

  private toDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // Clip a bar's [start, start+span] to the visible [0, totalDays] window so
  // activities outside the window don't overflow the track.
  private clipStyle(startDay: number, spanDays: number): Record<string, string> {
    const s = Math.min(this.totalDays, Math.max(0, startDay));
    const e = Math.min(this.totalDays, startDay + spanDays);
    const w = Math.max(0, e - s);
    const pct = (v: number) => `${(v / this.totalDays) * 100}%`;
    return { left: pct(s), width: pct(w), display: w > 0 ? 'flex' : 'none' };
  }

  barStyle(bar: GanttBar): Record<string, string> {
    return {
      ...this.clipStyle(bar.plannedStartDay, bar.plannedSpanDays),
      background: this.statusDotColor('planned'),
      ...this.summaryStyle(bar, false),
      ...this.assignmentBarStyle(bar),
      ...this.crewBookingStyle(bar, false),
    };
  }

  private crewBookingStyle(bar: GanttBar, actual: boolean): Record<string, string> {
    if (!this.crewPlanning || bar.lane === undefined) return {};
    const style: Record<string, string> = {
      top: `${bar.lane * 42 + (actual && this.scheduleFilter === 'planned-actual' ? 30 : 8)}px`,
      transform: 'none', height: actual ? '12px' : '18px',
    };
    if (bar.reserved) Object.assign(style, { background: '#E5E7EB', 'border-color': '#98A2B3', color: '#344054' });
    return style;
  }

  private assignmentBarStyle(bar: GanttBar): Record<string, string> {
    const isAssignment = bar.source === 'assignment' ||
      (bar.activities?.length && bar.activities.every(activity => activity.source === 'assignment'));
    return isAssignment ? { background: '#6B7280', 'border-color': '#4B5563', color: '#FFFFFF' } : {};
  }

  private summaryStyle(bar: GanttBar, actual: boolean): Record<string, string> {
    if (!bar.summary) return {};
    const overlaysPlan = actual && this.scheduleFilter === 'planned-actual';
    return {
      top: overlaysPlan ? '2px' : '0px', transform: 'none', height: overlaysPlan ? '8px' : '12px',
      background: this.statusDotColor(actual ? 'in-progress' : 'planned'),
      border: 'none',
    };
  }

  // Wells view labels bars with the well id; Activities view shows the activity code.
  barLabel(bar: GanttBar): string {
    if (this.groupBy === 'well') return bar.wellId ?? '';
    return bar.label ?? '';
  }

  actualBarStyle(bar: GanttBar): Record<string, string> {
    const range = this.actualBarRange(bar);
    let style = this.clipStyle(range.startDay, range.spanDays);
    if (this.scheduleFilter === 'planned-actual' && bar.type === 'completed' && bar.actualEnd && style['display'] === 'none') {
      style = this.clipStyle(bar.plannedStartDay, bar.plannedSpanDays);
    }
    return { ...style, background: this.statusDotColor('in-progress'),
      ...this.summaryStyle(bar, true), ...this.assignmentBarStyle(bar), ...this.crewBookingStyle(bar, true) };
  }

  private actualBarRange(bar: GanttBar): { startDay: number; spanDays: number } {
    if (bar.summary && bar.actualStartDay !== undefined) {
      return { startDay: bar.actualStartDay, spanDays: bar.actualSpanDays };
    }
    if (bar.actualStart) {
      const startDay = this.dayOffset(new Date(bar.actualStart + 'T00:00:00'));
      const actualEnd = bar.actualEnd;
      const endDay = actualEnd
        ? this.dayOffset(new Date(actualEnd + 'T00:00:00')) + 1
        : this.dayOffset(this.today) + 1;
      return { startDay, spanDays: Math.max(0, endDay - startDay) };
    }
    if (!bar.actualEnd) return { startDay: bar.plannedStartDay, spanDays: 0 };
    const endDay = this.dayOffset(new Date(bar.actualEnd + 'T00:00:00'));
    const startDay = bar.plannedSpanDays > 0 && bar.plannedStartDay <= endDay ? bar.plannedStartDay : endDay;
    return { startDay, spanDays: endDay - startDay + 1 };
  }

  private hasActualWork(bar: GanttBar): boolean {
    return !!bar.actualStart || !!bar.actualEnd ||
      (!!bar.summary && bar.actualStartDay !== undefined && bar.actualSpanDays > 0);
  }

  private hasActualInWindow(bar: GanttBar): boolean {
    if (!this.hasActualWork(bar)) return false;
    const range = this.actualBarRange(bar);
    return range.spanDays > 0 && range.startDay < this.totalDays && range.startDay + range.spanDays > 0;
  }

  showPlannedBar(bar: GanttBar): boolean {
    return this.scheduleFilter !== 'actual' && this.legendFilters['planned'];
  }

  showActualBar(bar: GanttBar): boolean {
    if (this.scheduleFilter === 'planned') return false;
    if (!this.legendFilters['actual']) return false;
    return this.hasActualWork(bar);
  }

  showMilestone(bar: GanttBar): boolean {
    return !!bar.milestone && this.legendFilters['milestone'];
  }

  slipBarStyle(bar: GanttBar): Record<string, string> {
    return this.clipStyle(bar.plannedStartDay + bar.plannedSpanDays, bar.slipDays);
  }

  get todayLinePct(): number {
    return (this.todayOffset / this.totalDays) * 100;
  }

  get todayInRange(): boolean {
    return this.todayOffset >= 0 && this.todayOffset <= this.totalDays;
  }

  statusDotColor(status: BarType): string {
    const map: Record<string, string> = {
      'completed': '#1D4ED8', 'in-progress': '#1D4ED8', 'delayed': '#F97316',
      'overdue': '#DC2626', 'not-started': '#1D4ED8', 'planned': '#F97316',
    };
    return map[status] ?? '#9CA3AF';
  }

  /** Crew-gantt-chart logic: proportional colored segments by activity status, same as crewgantt-updated's segments(). */
  getSegments(activities: ActivityRow[]): ProgressSegment[] {
    if (!activities.length) return [];
    const order: BarType[] = ['completed', 'in-progress', 'planned'];
    const total = activities.length;
    const segments: ProgressSegment[] = [];
    order.forEach(status => {
      const count = activities.filter(a => a.status === status).length;
      if (count) segments.push({ color: this.statusDotColor(status), pct: (count / total) * 100 });
    });
    return segments;
  }

  /** All activities rolled up under a crew group, across its crews/wells. */
  groupActivities(group: CrewGroup): ActivityRow[] {
    return this.visibleCrews(group).flatMap(crew => this.visibleActivities(crew));
  }

  visibleActivities(crew: WellRow): ActivityRow[] {
    if (this.showUnassigned || this.scheduleFilter !== 'actual') return crew.activities;
    return crew.activities.filter(activity => !!activity.bar.label?.trim() && this.hasActualInWindow(activity.bar));
  }

  visibleCrews(group: CrewGroup): WellRow[] {
    const crews = this.showUnassigned || this.scheduleFilter !== 'actual'
      ? group.wells : group.wells.filter(crew => !crew.unassigned && !!crew.id.trim());
    if (this.utilizationFilter === 'all') return crews;
    return crews.filter(crew => (this.showUnassigned || !crew.unassigned) &&
      crewUtilizationStatus(this.crewUtilization(group, crew)) === this.utilizationFilter);
  }

  crewUtilization(group: CrewGroup, crew: WellRow, basis = this.utilizationBasis): number | null {
    const members = this.rosterCrewIdsByGroup.get(group.id.trim().toLowerCase());
    if (this.totalDays <= 0 || !members?.has(crew.id.trim().toLowerCase())) return null;
    return (basis === 'planned' ? crew.bookedDays ?? 0 : crew.actualDays ?? 0) / this.totalDays * 100;
  }

  visibleGroupUtilization(group: CrewGroup): CrewGroup['utilization'] {
    if (!group.utilization || (!group.hierarchyKey && this.utilizationFilter === 'all' && !this.rowFilterSelected.size && this.scheduleFilter !== 'actual')) {
      return group.utilization;
    }
    let bookedCrewDays = 0;
    let capacityCrewDays = 0;
    for (const crew of this.visibleCrews(group)) {
      if (this.crewUtilization(group, crew, 'planned') === null) continue;
      bookedCrewDays += (this.scheduleFilter === 'actual' ? crew.actualDays : crew.bookedDays) ?? 0;
      capacityCrewDays += this.totalDays;
    }
    return { bookedCrewDays, capacityCrewDays, percent: capacityCrewDays > 0 ? bookedCrewDays / capacityCrewDays * 100 : null };
  }

  setScheduleFilter(filter: 'planned' | 'actual'): void {
    this.scheduleFilter = filter;
    this.utilizationBasis = filter;
    this.closeAssignmentMenu();
    this.tooltipText = null;
    if (!this.showUnassigned) this.rebuildBars();
  }

  get utilizationLabel(): string {
    return this.scheduleFilter === 'actual' ? 'Actual utilization' : 'Scheduled utilization';
  }

  utilizationTitle(utilization: NonNullable<CrewGroup['utilization']>): string {
    if (utilization.percent === null) return `${this.utilizationLabel} unavailable: no roster crews`;
    const details = this.scheduleFilter === 'actual'
      ? 'crew-days of recorded actual work'
      : 'crew-days occupied (including reservations and preview allocations)';
    return `${this.utilizationLabel} across all work for these crews: ${utilization.bookedCrewDays} of ${utilization.capacityCrewDays} ${details}`;
  }

  visibleClusterUtilization(cluster: CrewCluster): CrewGroup['utilization'] {
    let bookedCrewDays = 0;
    let capacityCrewDays = 0;
    let hasUtilization = false;
    for (const group of cluster.groups) {
      const utilization = this.visibleGroupUtilization(group);
      if (!utilization) continue;
      hasUtilization = true;
      bookedCrewDays += utilization.bookedCrewDays;
      capacityCrewDays += utilization.capacityCrewDays;
    }
    if (!hasUtilization) return undefined;
    return { bookedCrewDays, capacityCrewDays, percent: capacityCrewDays > 0 ? bookedCrewDays / capacityCrewDays * 100 : null };
  }

  visibleBars(row: CrewGroup | WellRow): GanttBar[] {
    if (this.crewPlanning && 'activities' in row) {
      return this.scheduleFilter === 'actual' ? row.bars.filter(bar => this.hasActualInWindow(bar)) : row.bars;
    }
    const filteredGroup = !('activities' in row) && this.utilizationFilter !== 'all';
    if (this.showUnassigned || (this.scheduleFilter !== 'actual' && !filteredGroup)) return row.bars;
    const activities = 'activities' in row ? this.visibleActivities(row) : this.groupActivities(row);
    return this.summarizeBars(activities.map(activity => activity.bar));
  }

  visibleCrewBars(crew: WellRow): GanttBar[] {
    return this.visibleBars(crew);
  }

  trackSummaryBar(index: number, bar: GanttBar): string {
    return this.crewPlanning && !bar.summary ? `${bar.label}:${bar.wellId}:${bar.plannedStart}:${index}` : bar.type;
  }

  hasMissingCrewId(bar: GanttBar): boolean {
    return bar.hasCrew === false && this.hasActualInWindow(bar);
  }

  groupHasMissingCrewId(group: CrewGroup): boolean {
    return !this.showUnassigned && this.groupActivities(group).some(activity => this.hasMissingCrewId(activity.bar));
  }

  hasManualActivity(well: WellRow): boolean {
    return well.activities.some(activity => activity.bar.source === 'assignment');
  }

  tooltipText: string | null = null;
  tooltipActivities: CalendarTooltipActivity[] = [];
  @ViewChild('barTooltip') barTooltip?: ElementRef<HTMLElement>;
  private tooltipHideTimer?: ReturnType<typeof setTimeout>;
  tooltipX = 0;
  tooltipY = 0;

  showTooltip(event: MouseEvent, bar: GanttBar): void {
    if (this.assignmentMenu || this.assignmentDeletion) return;
    this.keepTooltipOpen();
    this.tooltipActivities = bar.activities ?? [];
    if (!this.tooltipActivities.length) {
      this.tooltipText = null;
      return;
    }
    this.tooltipText = 'show';
    this.cdr.detectChanges();
    const bounds = this.barTooltip?.nativeElement.getBoundingClientRect();
    this.tooltipX = Math.max(8, Math.min(event.clientX + 12, window.innerWidth - (bounds?.width ?? 360) - 8));
    const height = bounds?.height ?? 220;
    this.tooltipY = event.clientY + 12 + height <= window.innerHeight - 8
      ? event.clientY + 12
      : Math.max(8, event.clientY - height - 12);
    this.cdr.detectChanges();
  }

  currentNorms(activity: CalendarActivity): number | null {
    return this.actualNorms(activity) == null ? null : activity.normsPerDay ?? null;
  }

  actualNorms(activity: CalendarActivity): number | null {
    if (activity.normsPerDay == null || activity.productivityPct == null) return null;
    return activity.normsPerDay * activity.productivityPct / 100;
  }

  actualDatesLabel(activity: CalendarActivity): string {
    const end = activity.actualEnd ?? (activity.actualStart ? 'Ongoing' : 'Not recorded');
    return `${activity.actualStart ?? 'Not recorded'} → ${end}`;
  }

  keepTooltipOpen(): void {
    clearTimeout(this.tooltipHideTimer);
  }

  hideTooltip(): void {
    this.tooltipHideTimer = setTimeout(() => {
      this.tooltipText = null;
      this.cdr.markForCheck();
    }, 150);
  }

  syncBarScroll(event: Event): void {
    this.closeAssignmentMenu();
    const scrollTop = (event.target as HTMLElement).scrollTop;
    if (this.barAreaWrap?.nativeElement && this.barAreaWrap.nativeElement.scrollTop !== scrollTop) {
      this.barAreaWrap.nativeElement.scrollTop = scrollTop;
    }
  }

  syncLeftScroll(event: Event): void {
    this.closeAssignmentMenu();
    const scrollTop = (event.target as HTMLElement).scrollTop;
    if (this.leftRows?.nativeElement && this.leftRows.nativeElement.scrollTop !== scrollTop) {
      this.leftRows.nativeElement.scrollTop = scrollTop;
    }
  }

  private get timelineEnd(): Date {
    const end = new Date(this.timelineStart);
    end.setDate(end.getDate() + this.totalDays - 1);
    return end;
  }

  private updateTimelineWindow(anchor = this.timelineStart): void {
    this.selectedFrom ??= this.toDateStr(this.timelineStart);
    this.selectedTo ??= this.toDateStr(this.timelineEnd);
    const from = new Date(`${this.selectedFrom}T00:00:00`);
    const to = new Date(`${this.selectedTo}T00:00:00`);
    const date = new Date(Math.max(from.getTime(), Math.min(anchor.getTime(), to.getTime())));
    let start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    let end = new Date(start);
    if (this.timeUnit === 'month') {
      start = new Date(date.getFullYear(), date.getMonth(), 1);
      end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    } else if (this.timeUnit === 'week') {
      const offset = Math.round((start.getTime() - from.getTime()) / 86_400_000);
      start = new Date(from);
      start.setDate(start.getDate() + Math.floor(offset / 7) * 7);
      end = new Date(start);
      end.setDate(end.getDate() + 6);
    }
    this.timelineStart = start < from ? from : start;
    if (end > to) end = to;
    this.totalDays = Math.round((end.getTime() - this.timelineStart.getTime()) / 86_400_000) + 1;
    this.todayOffset = this.dayOffset(this.today);
  }

  canNavigateTimeline(direction: number): boolean {
    if (direction < 0) return !this.selectedFrom || this.toDateStr(this.timelineStart) > this.selectedFrom;
    return !this.selectedTo || this.toDateStr(this.timelineEnd) < this.selectedTo;
  }

  get canGoToToday(): boolean {
    const today = this.toDateStr(this.today);
    return (!this.selectedFrom || today >= this.selectedFrom) && (!this.selectedTo || today <= this.selectedTo);
  }

  navigateTimeline(direction: number): void {
    this.updateTimelineWindow();
    if (!this.canNavigateTimeline(direction)) return;
    let anchor = new Date(this.timelineStart);
    if (this.timeUnit === 'month') {
      anchor = direction < 0
        ? new Date(anchor.getFullYear(), anchor.getMonth(), 0)
        : new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    } else {
      anchor.setDate(anchor.getDate() + direction * (this.timeUnit === 'week' ? 7 : 1));
    }
    this.updateTimelineWindow(anchor);
    this.refreshTimeline();
  }

  goToToday(): void {
    if (!this.canGoToToday) return;
    this.updateTimelineWindow(this.today);
    this.refreshTimeline();
  }

  setTimeUnit(unit: TimeUnit): void {
    this.timeUnit = unit;
    this.updateTimelineWindow();
    this.refreshTimeline();
  }

  private refreshTimeline(): void {
    this.closeAssignmentMenu();
    if (!this.showUnassigned && (!this.fetchedFrom || !this.fetchedTo ||
        this.timelineStart < this.fetchedFrom || this.timelineEnd > this.fetchedTo)) {
      this.buildTimeline();
      this.loadCalendarData({ from: this.selectedFrom ?? undefined, to: this.selectedTo ?? undefined });
    } else {
      this.rebuildView();
    }
  }

  private rebuildView(): void {
    this.todayOffset = this.dayOffset(this.today);
    if (this.showUnassigned) {
      this.loadUnassignedCrews();
    } else {
      this.rebuildBars();
    }
    this.buildTimeline();
    this.cdr.detectChanges();
  }

  private rebuildBars(): void {
    if (!this.calendarData) return;
    const expandedGroups = new Map(this.crewGroups.map(g => [g.id, g.expanded]));
    const expandedCrews = new Map<string, boolean>();
    this.crewGroups.forEach(g => g.wells.forEach(w => expandedCrews.set(`${g.id}:${w.id}`, w.expanded)));
    this.crewGroups = this.groupsInWindow(this.activeCalendarGroups).map((g, i) => {
      const mapped = this.mapGroup(g, i);
      mapped.expanded = expandedGroups.get(mapped.id) ?? false;
      mapped.wells.forEach(w => { w.expanded = expandedCrews.get(`${mapped.id}:${w.id}`) ?? false; });
      return mapped;
    });
    this.buildWellRows();
  }

  selectGroup(group: CrewGroup): void {
    this.selectedWellId = null;
    this.setHierarchyExpanded(group, !group.expanded);
    this.selectedGroupId = group.expanded ? group.hierarchyKey ?? group.id : null;
  }

  toggleCrew(crew: WellRow, event: Event): void {
    event.stopPropagation();
    this.setHierarchyExpanded(crew, !crew.expanded);
  }

  selectWell(well: WellRow, group: CrewGroup, event: Event): void {
    event.stopPropagation();
    this.selectedWellId = well.hierarchyKey ?? well.id;
    this.selectedGroupId = null;
    this.setHierarchyExpanded(group, true);
  }

  toggleGroup(group: CrewGroup, event: Event): void {
    event.stopPropagation();
    this.setHierarchyExpanded(group, !group.expanded);
  }

  toggleCluster(cluster: CrewCluster, event: Event): void {
    event.stopPropagation();
    this.setHierarchyExpanded(cluster, !cluster.expanded);
  }

  private setHierarchyExpanded(row: { id: string; hierarchyKey?: string; expanded: boolean }, expanded: boolean): void {
    row.expanded = expanded;
    this.hierarchyExpansion.set(row.hierarchyKey ?? row.id, expanded);
    this.clusterRowsSource = null;
  }

  expandAll(): void {
    this.hierarchyExpansion.clear();
    this.clustersExpandedByDefault = true;
    this.clusterRowsSource = null;
    this.crewGroups.forEach(g => {
      g.expanded = true;
      g.wells.forEach(w => (w.expanded = true));
    });
  }

  collapseAll(): void {
    this.hierarchyExpansion.clear();
    this.clustersExpandedByDefault = false;
    this.clusterRowsSource = null;
    this.crewGroups.forEach(g => {
      g.expanded = false;
      g.wells.forEach(w => (w.expanded = false));
    });
  }

  allExpanded(): boolean {
    return this.ganttClusters.every(cluster => cluster.expanded && cluster.groups.every(group =>
      group.expanded && group.wells.every(crew => !crew.activities.length || crew.expanded)));
  }

  goBack(): void {
    this.router.navigate(['/dashboard/standard-boards']);
  }

  getBadgeBg(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},0.10)`;
  }

  getWellBarColor(item: { bars: GanttBar[] }): string {
    const colorMap: Record<string, string> = {
      'in-progress': '#1D4ED8', 'completed': '#1D4ED8', 'delayed': '#F97316',
      'overdue': '#DC2626', 'not-started': '#1D4ED8', 'unassigned': '#E5E7EB', 'planned': '#F97316',
    };
    const last = item.bars.at(-1)?.type;
    return last ? (colorMap[last] ?? '#E2E7EF') : '#E2E7EF';
  }

  @HostListener('document:keydown.escape')
  onEsc(): void {
    if (this.assignmentDeletion) this.cancelAssignmentDeletion();
    else if (this.assignmentMenu) {
      this.closeAssignmentMenu();
      this.restoreAssignmentFocus();
    }
    this.showFilterPanel = false;
    this.showRowFilter = false;
    this.showUtilizationFilter = false;
  }

  get filteredGroups(): CrewGroup[] {
    const t = this.searchTerm.trim().toLowerCase();
    let groups = this.crewGroups;
    const selectedCluster = this.calendarScope.cluster?.trim().toLowerCase();
    if (selectedCluster) {
      groups = groups.map(group => ({ ...group, wells: group.wells.filter(crew =>
        crew.projects?.some(project => project.cluster?.trim().toLowerCase() === selectedCluster)),
      })).filter(group => group.wells.length > 0);
    }
    if (t) {
      groups = groups.filter(g =>
        g.name.toLowerCase().includes(t) ||
        g.subtitle.toLowerCase().includes(t) ||
        g.wells.some(w => w.name.toLowerCase().includes(t) ||
          w.activities.some(a => a.name.toLowerCase().includes(t))),
      );
    }
    if (this.rowFilterSelected.size > 0) {
      groups = groups.map(g => {
        const matchGroup = this.rowFilterSelected.has(g.name);
        const filteredWells = g.wells.filter(w => this.rowFilterSelected.has(w.name));
        if (matchGroup) return g;
        if (filteredWells.length > 0) return { ...g, wells: filteredWells };
        return null;
      }).filter((g): g is CrewGroup => g !== null);
    }
    return groups;
  }

  get rowFilterOptions(): { type: 'group' | 'crew'; name: string }[] {
    const items: { type: 'group' | 'crew'; name: string }[] = [];
    for (const g of this.crewGroups) {
      items.push({ type: 'group', name: g.name });
      for (const w of g.wells) {
        items.push({ type: 'crew', name: w.name });
      }
    }
    return items;
  }

  toggleRowFilter(name: string): void {
    if (this.rowFilterSelected.has(name)) {
      this.rowFilterSelected.delete(name);
    } else {
      this.rowFilterSelected.add(name);
    }
    this.rowFilterSelected = new Set(this.rowFilterSelected);
  }

  clearRowFilter(): void {
    this.searchTerm = '';
    this.rowFilterSelected = new Set();
    this.showRowFilter = false;
  }

  get ganttGroups(): CrewGroup[] {
    const base = (this.showUnassigned || this.scheduleFilter !== 'actual') && this.utilizationFilter === 'all'
      ? this.filteredGroups
      : this.filteredGroups.filter(group => this.visibleCrews(group).length > 0);
    if (this.groupBy === 'well') return base.map(g => ({ ...g, expanded: true }));
    return base;
  }

  get ganttClusters(): CrewCluster[] {
    const filterKey = JSON.stringify([this.searchTerm, [...this.rowFilterSelected], this.showUnassigned,
      this.scheduleFilter, this.utilizationBasis, this.utilizationFilter, this.groupBy,
      this.crewPlanning, this.totalDays, this.timelineStart.getTime(), this.calendarScope.cluster]);
    if (this.clusterRowsSource !== this.crewGroups || this.clusterRowsFilterKey !== filterKey) {
      this.clusterRows = this.buildClusterRows(this.ganttGroups);
      this.clusterRowsSource = this.crewGroups;
      this.clusterRowsFilterKey = filterKey;
    }
    return this.clusterRows;
  }

  trackHierarchyRow(_index: number, row: { id: string; hierarchyKey?: string }): string {
    return row.hierarchyKey ?? row.id;
  }

  private buildClusterRows(groups: CrewGroup[]): CrewCluster[] {
    const clusters = new Map<string, CrewCluster>();
    for (const group of groups) {
      const clusterGroups = new Map<string, CrewGroup>();
      const partitions = this.visibleCrews(group).flatMap(crew => this.partitionCrewByCluster(group, crew));
      for (const partition of partitions) {
        let cluster = clusters.get(partition.key);
        if (!cluster) {
          cluster = { id: partition.key, name: partition.name,
            expanded: this.hierarchyExpansion.get(partition.key) ?? this.clustersExpandedByDefault, groups: [] };
          clusters.set(partition.key, cluster);
        }
        let clusterGroup = clusterGroups.get(partition.key);
        if (!clusterGroup) {
          const hierarchyKey = JSON.stringify([partition.key, group.id]);
          clusterGroup = { ...group, hierarchyKey, wells: [], bars: [],
            expanded: this.hierarchyExpansion.get(hierarchyKey) ?? group.expanded };
          clusterGroups.set(partition.key, clusterGroup);
          cluster.groups.push(clusterGroup);
        }
        clusterGroup.wells.push(partition.crew);
      }
      for (const clusterGroup of clusterGroups.values()) {
        const activities = clusterGroup.wells.flatMap(crew => crew.activities);
        clusterGroup.bars = this.summarizeBars(activities.map(activity => activity.bar));
        clusterGroup.percent = Math.round(activities.reduce((total, activity) => total + activity.percent, 0) / (activities.length || 1));
        const count = clusterGroup.wells.filter(crew => this.showUnassigned || !crew.unassigned).length;
        clusterGroup.subtitle = `${count} ${count === 1 ? 'crew' : 'crews'}`;
      }
    }
    for (const cluster of clusters.values()) {
      const utilization = new Map(cluster.groups.map(group => [group.id,
        !this.showUnassigned && this.scheduleFilter === 'actual'
          ? this.visibleGroupUtilization(group)?.percent ?? -1 : 0]));
      cluster.groups.sort((first, second) => utilization.get(second.id)! - utilization.get(first.id)! ||
        first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: 'base' }));
    }
    const unmappedKey = JSON.stringify(['cluster', '']);
    return [...clusters.values()].sort((first, second) =>
      Number(first.id === unmappedKey) - Number(second.id === unmappedKey) ||
      first.name.localeCompare(second.name, undefined, { sensitivity: 'base', numeric: true }));
  }

  private partitionCrewByCluster(group: CrewGroup, crew: WellRow): { key: string; name: string; crew: WellRow }[] {
    const parents = new Map<string, string>();
    const selectedCluster = this.calendarScope.cluster?.trim().toLowerCase();
    for (const project of crew.projects ?? []) {
      const name = project.cluster?.trim();
      if (selectedCluster && name?.toLowerCase() !== selectedCluster) continue;
      if (name && !parents.has(name.toLowerCase())) parents.set(name.toLowerCase(), name);
    }
    if (selectedCluster && !parents.size) return [];
    if (!parents.size) parents.set('', 'Unmapped');
    const activities = this.visibleActivities(crew);
    const reservations = !this.showUnassigned && this.scheduleFilter === 'actual'
      ? [] : crew.bars.filter(bar => bar.reserved);
    const activityBars = activities.map(activity => activity.bar);
    const bars = this.crewPlanning
      ? this.layoutCrewBars([...activityBars, ...reservations]) : this.summarizeBars(activityBars);
    const rowHeight = Math.max(56, bars.reduce((height, bar) => Math.max(height, ((bar.lane ?? 0) + 1) * 42 + 12), 0));
    return [...parents.entries()].map(([clusterName, name]) => {
      const key = JSON.stringify(['cluster', clusterName]);
      const hierarchyKey = JSON.stringify([key, group.id, crew.id]);
      return { key, name, crew: { ...crew, hierarchyKey, activities, bars, rowHeight,
        expanded: this.hierarchyExpansion.get(hierarchyKey) ?? crew.expanded,
      } };
    });
  }

  setGroupBy(mode: 'crew-group' | 'well'): void {
    this.groupBy = mode;
    if (mode === 'well') {
      this.viewBy = 'wells';
      this.crewGroups.forEach(g => g.expanded = true);
      this.buildWellRows();
    } else {
      this.viewBy = 'activities';
    }
  }

  setViewBy(view: ViewBy): void {
    this.viewBy = view;
    this.setGroupBy(view === 'wells' ? 'well' : 'crew-group');
  }

  private buildWellRows(): void {
    const wellMap = new Map<string, ActivityRow[]>();
    for (const group of this.crewGroups) {
      for (const crew of group.wells) {
        for (const act of crew.activities) {
          const wid = act.bar.wellId || act.id;
          if (!wellMap.has(wid)) wellMap.set(wid, []);
          wellMap.get(wid)!.push(act);
        }
      }
    }
    this.wellRows = [...wellMap.entries()].map(([wid, acts], i) => {
      const pct = acts.length ? Math.round(acts.reduce((s, a) => s + a.percent, 0) / acts.length) : 0;
      const bars = this.summarizeBars(acts.map(activity => activity.bar));
      const existing = this.wellRows.find(w => w.id === wid);
      return { id: wid, name: `Well ${wid}`, percent: pct, expanded: existing?.expanded ?? true, bars, activities: acts };
    });
  }

  toggleLegendFilter(key: string): void {
    this.legendFilters[key] = !this.legendFilters[key];
  }

  isBarVisible(bar: GanttBar): boolean {
    return this.showPlannedBar(bar) || this.showActualBar(bar);
  }

  onBarClick(bar: GanttBar): void {
    if (bar.wellId) {
      this.router.navigate(['/dashboard/activity-breakdown', bar.wellId]);
    }
  }

  get filteredWellRows(): WellRow[] {
    const t = this.searchTerm.trim().toLowerCase();
    const rows = this.showUnassigned || this.scheduleFilter !== 'actual'
      ? this.wellRows
      : this.wellRows.filter(well => this.visibleActivities(well).length > 0);
    if (!t) return rows;
    return rows.filter(w =>
      w.name.toLowerCase().includes(t) || this.visibleActivities(w).some(a => a.name.toLowerCase().includes(t)),
    );
  }

  get wellGroupedRows(): WellRow[] {
    const wellMap = new Map<string, ActivityRow[]>();
    for (const group of this.ganttGroups) {
      for (const crew of this.visibleCrews(group)) {
        for (const act of this.visibleActivities(crew)) {
          const wid = act.bar.wellId || act.id;
          if (!wellMap.has(wid)) wellMap.set(wid, []);
          wellMap.get(wid)!.push(act);
        }
      }
    }
    return [...wellMap.entries()].map(([wid, acts]) => {
      const pct = acts.length ? Math.round(acts.reduce((s, a) => s + a.percent, 0) / acts.length) : 0;
      const bars = this.summarizeBars(acts.map(activity => activity.bar));
      return { id: wid, name: `Well ${wid}`, percent: pct, expanded: true, bars, activities: acts };
    });
  }

  private mergeBarsFromRows(activities: ActivityRow[]): GanttBar[] {
    if (!activities.length) return [];
    const bars = activities.map(a => a.bar);
    const startDay = Math.min(...bars.map(b => b.plannedStartDay));
    const endDay = Math.max(...bars.map(b => b.plannedStartDay + b.plannedSpanDays));
    const spanDays = Math.max(1, endDay - startDay);
    const avgProgress = activities.reduce((s, a) => s + a.percent, 0) / activities.length;
    const actualSpanDays = Math.round(spanDays * (avgProgress / 100));
    const completedAll = activities.every(a => !!a.bar.actualEnd);
    const hasDelayed = activities.some(a => a.status === 'delayed');
    const hasOverdue = activities.some(a => a.status === 'overdue');
    const hasInProgress = activities.some(a => a.status === 'in-progress');
    let type: BarType;
    if (completedAll) type = 'completed';
    else if (hasDelayed) type = 'delayed';
    else if (hasOverdue) type = 'overdue';
    else if (avgProgress > 0 || hasInProgress) type = 'in-progress';
    else type = 'not-started';
    const wellIds = [...new Set(activities.map(a => a.bar.wellId).filter(Boolean))];
    const pStarts = activities.map(a => a.bar.plannedStart).filter(Boolean).sort() as string[];
    const pEnds = activities.map(a => a.bar.plannedEnd).filter(Boolean).sort().reverse() as string[];
    const aStarts = activities.map(a => a.bar.actualStart).filter(Boolean).sort() as string[];
    const aEnds = activities.map(a => a.bar.actualEnd).filter(Boolean).sort().reverse() as string[];
    return [{
      type, startDay, spanDays,
      plannedStartDay: startDay, plannedSpanDays: spanDays,
      actualSpanDays, slipDays: 0, progress: Math.round(avgProgress),
      completionMarker: completedAll, wellId: wellIds[0], label: wellIds.join(', '),
      activities: bars.flatMap(bar => bar.activities ?? []),
      plannedStart: pStarts[0], plannedEnd: pEnds[0],
      actualStart: aStarts[0], actualEnd: aEnds.length === activities.length ? aEnds[0] : undefined,
    }];
  }
}
