export type CalendarActivitySource = 'legacy' | 'assignment' | 'draft';

export interface CalendarActivity {
  activityCode: string;
  activityName: string;
  wellId: string;
  category: string | null;
  plannedStart: string;
  plannedEnd: string;
  actualStart: string | null;
  actualEnd: string | null;
  progress: number;
  status: string;
  isMilestone: boolean;
  rigOnDate: string | null;
  expectedRigOnDate: string | null;
  normsPerDay: number | null;
  productivityPct: number | null;
  source?: CalendarActivitySource;
  proposed?: boolean;
  assignmentId?: number | null;
  cluster?: string | null;
  plantCode?: number | null;
}

export interface CrewBooking {
  plannedStart: string;
  plannedEnd: string;
}

export interface CrewProjectMapping {
  projectId: string;
  projectCode: string | null;
  cluster: string | null;
}

export interface CrewRosterMember {
  crewUid: string;
  crewTypeCode: string | null;
  bookings: CrewBooking[];
  projects?: CrewProjectMapping[];
}

export interface CrewRosterData {
  groups: {
    crewGroupCode: string;
    crewGroupName: string | null;
    crews: CrewRosterMember[];
  }[];
}

export interface CalendarCrew {
  crewCode: string;
  activities: CalendarActivity[];
  crewTypeCode?: string | null;
  bookings?: CrewBooking[];
  projects?: CrewProjectMapping[];
}

export interface CalendarGroup {
  crewGroupCode: string;
  crewGroupName?: string | null;
  activityCount: number;
  completionPct: number;
  crews: CalendarCrew[];
}

export interface CrewActualWork {
  crewGroupCode: string;
  crewCode: string;
  actualStart: string;
  actualEnd: string | null;
}

export interface CrewCalendarData {
  totalGroups: number;
  totalCrews: number;
  totalActivities: number;
  totalMilestones: number;
  fromDate: string;
  toDate: string;
  groups: CalendarGroup[];
  milestones: CalendarActivity[];
  roster?: CrewRosterData;
  planningScope?: CalendarFilters;
  retainedPlan?: CalendarGroup[];
  actualCrewWork?: CrewActualWork[];
  actualGroups?: CalendarGroup[];
}

export interface StoredCrewCalendarPlan {
  activities: CalendarActivity[];
  bookings: [group: string, crew: string, activity: number, from: string, to: string][];
}

export interface CalendarFilters {
  cluster?: string;
  site?: string;
  wellType?: string;
  project?: string;
  from?: string;
  to?: string;
  includeAssignments?: boolean;
  includeRoster?: boolean;
}

export type CrewUtilizationStatus = 'Scarce' | 'Well-Utilized' | 'Underutilized' | 'Surplus' | 'N/A';

export type CrewReportStatus = 'Fully utilized' | 'Partially utilized' | 'Not utilized' | 'N/A';

export interface CrewUtilizationTotals {
  availableDays: number | null;
  plannedDays: number;
  actualAssignedDays: number;
  idleDays: number | null;
  utilization: number | null;
  status: CrewReportStatus;
  unknownCapacity: number;
}

export interface CrewUtilizationRow extends CrewUtilizationTotals {
  crewId: string;
}

export interface CrewUtilizationGroup extends CrewUtilizationTotals {
  code: string;
  name: string | null;
  crews: CrewUtilizationRow[];
}

export interface CrewReportGridRow extends CrewUtilizationTotals {
  id: string;
  path: string[];
  kind: 'group' | 'crew' | 'total';
  groupCode: string;
  crewId: string;
  crewLabel?: string;
  crewCount?: number;
}

export interface CrewUtilizationReport {
  from: string;
  to: string;
  groups: CrewUtilizationGroup[];
  totals: CrewUtilizationTotals;
  summary: {
    crewGroups: number;
    actualCrews: number;
    averagePlannedUtilization: number | null;
    averageUtilization: number | null;
    unknownCapacity: number;
  };
}

// ─── Crew assignment (unassigned crews + activity picker + write) ──────────────

export interface UnassignedCrew {
  crewUid: string;
  crewTypeCode: string | null;
}

export interface UnassignedCrewGroup {
  crewGroupCode: string;
  crewGroupName: string | null;
  crews: UnassignedCrew[];
}

export interface UnassignedCrewsData {
  totalGroups: number;
  totalCrews: number;
  groups: UnassignedCrewGroup[];
}

export interface AssignableActivity {
  activityCode: string;
  activityName: string;
  crewGroupCode: string | null;
  crewTypeCode: string | null;
  discipline: string | null;
  uom: string | null;
  norm: number | null;
}

export interface AssignableActivitiesData {
  total: number;
  activities: AssignableActivity[];
}

export interface CreateCrewAssignmentRequest {
  crewGroupCode: string;
  crewUid: string;
  crewTypeCode?: string | null;
  activityCode: string;
  activityName: string;
  wellId?: string | null;
  projectId?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
}

export interface CrewAssignment {
  id: number;
  crewGroupCode: string;
  crewUid: string;
  crewTypeCode: string | null;
  activityCode: string;
  activityName: string;
  wellId: string | null;
  projectId: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  progress: number;
  status: string;
  message: string;
}
