import { Component, AfterViewInit, OnDestroy, OnInit, ElementRef, ViewChild } from '@angular/core';
import { Subscription, skip } from 'rxjs';
import { DashboardService, WellExecChartPoint, WellExecMilestone, DailyOutputRate, CriticalDateTimelineItem, HfbFilter, ActivityGanttRow, ClusterWells, WellStagesResponse, WellStageItem, CrewPiHeatmapResponse, CrewPiPeriod, CrewPiDistribution, TargetFinishTimelineItem } from '../../services/dashboard.service';

declare var agGrid: any;

export interface TopDelayedJob {
  wellId: string; category: string; plan: number; actual: number; variance: number; targetEnd: string;
}
export interface GanttRow {
  wellId: string; category: string; progress: string;
  type: 'overdue' | 'within30' | 'within60' | 'after60';
  label: string; barPct: number;
}
export interface ActivityRow {
  id: string; name: string; plan: string; actual: string; color: string;
  hasChildren: boolean; expanded?: boolean; level: number;
  startDay: number; endDay: number; pct: number; isWell?: boolean;
  /** True for type='M' rows that group a set of type='A' activities. */
  isMilestone?: boolean;
  /** Absolute timestamps (ms). Populated when rows come from ActivityTaskPlan. */
  startTs?: number; endTs?: number;
}

@Component({
  selector: 'app-wellexecution',
  templateUrl: './wellexecution.component.html',
  styleUrls: ['./wellexecution.component.scss'],

})



export class WellExecutionComponent implements OnInit, AfterViewInit, OnDestroy {

  @ViewChild('weeklyTrendChart')      weeklyTrendRef!: ElementRef<HTMLDivElement>;
  @ViewChild('sCurveChart')           sCurveRef!: ElementRef<HTMLDivElement>;
  @ViewChild('categoryBarChart')      categoryBarRef!: ElementRef<HTMLDivElement>;
  @ViewChild('revPhysChart')          revPhysRef!: ElementRef<HTMLDivElement>;
  @ViewChild('wexecParChart')         wexecParRef!: ElementRef<HTMLDivElement>;
  @ViewChild('activityGanttChart')    activityGanttRef!: ElementRef<HTMLDivElement>;

  private kpiSub?: Subscription;

  // Live chart data populated from API (falls back to hardcoded if API not yet loaded)
  private wexecChartData: WellExecChartPoint[] = [];
  private wexecMilestones: WellExecMilestone[] = [];

  constructor(private dashboardService: DashboardService) {}
  @ViewChild('targetFinishChart')     targetFinishRef!: ElementRef<HTMLDivElement>;
  @ViewChild('crewPiChart')           crewPiRef!: ElementRef<HTMLDivElement>;

  private charts: any[] = [];
  private delayedGrid: any = null;
  private cdtSub?: Subscription;
  private dailyOutputSub?: Subscription;
  private filterSub?: Subscription;
  private crewPiSub?: Subscription;
  private targetFinishSub?: Subscription;

  // ── KPI ──────────────────────────────────────────────────────────────────
  overallProgress = 8.76;
  overallVsPlan   = -23.91;
  totalJobs       = 240;
  // Breakdown of totalJobs by status (rendered under the Total Jobs card)
  activeJobs        = 148;
  inProgressJobs    = 110;
  holdJobs          = 3;
  delayedJobs     = 174;
  delayedJobsPct  = 72.5;
  revenueAchieved = '0.96M';
  revenuePlanned  = '10.97M';
  revenuePct      = 8.76;
  upcomingEnds    = 27;

  /** True while the KPI API call is in-flight — hides dummy values in the template. */
  kpiLoading = true;

  // ── DB-issues drawer (per KPI card) ────────────────────────────────────────
  // Opens the shared right-side drawer defined in assets/well-detail-live.js.
  // Each KPI is sourced from WellMonitoringReport_Latest and/or Revenue.
  widgetIntegrationInfo: Record<string, any> = {
    weCrewPi: {
      title: 'Crew PI Rating Heatmap',
      summary: 'Weekly PI rating (P0–P8) per crew, plus the KPI tiles and distribution. Ratings come ' +
               'from PH_Productivity; cluster/well filtering has to be inferred via task_daily → ProjectIDs.',
      tables: [
        {
          table: 'dbo.PH_Productivity',
          reliability: 'Low', reliabilityPct: 40,
          issues: [
            { field: '(table-level)', category: 'Other', type: 'Missing column', severity: 'High',
              detail: 'PH_Productivity has NO well / cluster / well-type column, so this heatmap cannot be filtered by well on its own — the crew→well link must be inferred from other tables (see the task_daily tab).' },
            { field: 'PI (T-Wise), PI (CMR)', category: 'No Standardization', severity: 'High',
              detail: 'The rating is COALESCE of two separate PI columns — there is no single authoritative PI value, and if the two disagree the T-Wise one silently wins. The names also contain spaces and parentheses.' },
            { field: 'PI (T-Wise), PI (CMR)', category: 'Data Type Mismatch', severity: 'High',
              detail: 'Stored as text and parsed to P0–P8 (TryParsePRating); any value that does not parse is silently dropped from the heatmap.' },
            { field: 'Crew Type', category: 'No Standardization', severity: 'High',
              detail: 'The crew identity is taken from a "Crew Type" column with inconsistent free-text values (ETS0601, FEC-0602, FCE-0302 — mixed with/without dashes); there is no crew master or crew id.' },
            { field: 'Date', category: 'Null Values',
              detail: 'Weekly/daily bucketing relies on Date; rows with a null/blank date are dropped.' },
            { field: '(table-level)', category: 'Primary Key',
              detail: 'No key — multiple rows per crew/date are aggregated; nothing guarantees one rating per crew per period.' }
          ]
        },
        {
          table: 'dbo.task_daily + dbo.ProjectIDs',
          reliability: 'Low', reliabilityPct: 40,
          issues: [
            { field: 'task_daily.crew_type ↔ well_id', category: 'Foreign Key', severity: 'High',
              detail: 'Because PH_Productivity has no well column, filtering the heatmap by cluster/well matches PH_Productivity.[Crew Type] to task_daily.crew_type (as strings) and task_daily.well_id to the well set. No FK anywhere — any naming mismatch drops the crew from a filtered view.' },
            { field: 'ProjectIDs.column2', category: 'No Standardization',
              detail: 'Cluster / well-type are derived by splitting the free-text column2 (first word = cluster, remainder = well type) — the same fragile convention used across the dashboard.' }
          ]
        }
      ]
    },
    weTargetFinish: {
      title: 'Target Finish Timeline',
      summary: 'Per-well target-finish bars (Overdue / Due in N days) with category and progress. Built ' +
               'by joining four tables — the well + rig-off window, the target-end date, revenue progress, ' +
               'and the category.',
      tables: [
        {
          table: 'dbo.Job_Progress_PlanSnapshot',
          reliability: 'Low', reliabilityPct: 40,
          issues: [
            { field: 'Latest_Target_End', category: 'Null Values', severity: 'High',
              detail: 'The entire Overdue / "Due in N days" status and bar position depend on this target-finish date (MAX per well). If it is missing the row shows "No Target Set" and cannot be placed on the timeline.' },
            { field: 'Latest_Target_End', category: 'Data Type Mismatch',
              detail: 'Used directly in DATEDIFF against today; if stored as text it must be a real DATE for the day-count (and therefore the bar) to be correct.' },
            { field: 'Well_ID', category: 'Foreign Key',
              detail: 'LEFT JOIN on well id with no enforced FK; a target-end row that does not match a well is dropped.' }
          ]
        },
        {
          table: 'dbo.WellMonitoringReport_Latest',
          reliability: 'Low', reliabilityPct: 45,
          issues: [
            { field: 'exp.rig_off_location_sap_data', category: 'No Standardization', severity: 'High',
              detail: 'The whole list is windowed on this non-standardly named, un-indexed rig-off date column — wells without a rig-off date in range never appear, regardless of their target finish.' },
            { field: 'pdo_well_id', category: 'Primary Key',
              detail: 'Base table for the join; rows with a blank pdo_well_id are excluded. No enforced uniqueness.' }
          ]
        },
        {
          table: 'dbo.Revenue',
          reliability: 'Low', reliabilityPct: 40,
          issues: [
            { field: 'created_at', category: 'No Standardization', severity: 'High',
              detail: 'The "latest" revenue row is chosen via ROW_NUMBER ORDER BY created_at, but created_at is a bulk-insert timestamp shared by all rows — so "latest" is effectively arbitrary and the Progress % can come from the wrong row.' },
            { field: 'act_percent', category: 'Data Type Mismatch',
              detail: 'Progress % is NVARCHAR — TRY_CAST AS FLOAT with fraction-vs-percentage normalisation.' },
            { field: 'well_id', category: 'Foreign Key',
              detail: 'Joined by string well id with no enforced FK.' }
          ]
        },
        {
          table: 'dbo.Dashboarding_Job_Progress',
          reliability: 'Low', reliabilityPct: 45,
          issues: [
            { field: '[Well ID], Category', category: 'No Standardization', severity: 'High',
              detail: 'The Category shown (e.g. "Marmul Location", "Nimr Flowline") is free text taken via MAX(Category) per well — if a well has more than one category the value is arbitrary. The key column name also contains a space ([Well ID]).' },
            { field: '[Well ID]', category: 'Foreign Key',
              detail: 'LEFT JOIN on the spaced well-id column with no enforced FK; an unmatched well shows Category = "N/A".' }
          ]
        }
      ]
    },
    weActivityGantt: {
      title: 'Activity Gantt',
      summary: 'Multi-well Activity / WBS schedule (plan vs actual). The well list comes from the ' +
               'cluster-wells cache; activity bars come from ActivityTaskPlan (type A/M).',
      tables: [
        {
          table: 'dbo.ActivityTaskPlan',
          reliability: 'Low', reliabilityPct: 30,
          issues: [
            { field: 'Well_ID, [type]', category: 'Other', type: 'Missing index', severity: 'High',
              detail: 'There is no index on Well_ID or [type], so a cross-well query times out — the bulk gantt returns EMPTY until an in-memory cache warms, otherwise each well must be lazy-loaded one at a time. This is why most rows show blank 0% bars. Add indexes on Well_ID and [type].' },
            { field: 'actual_start, actual_end', category: 'Other', type: 'Missing data', severity: 'High',
              detail: 'The bulk cache stores only PLANNED dates — actual dates are not kept — so the "Actual" column / actual bars cannot be drawn from the bulk path, only plan.' },
            { field: 'progress', category: 'Data Type Mismatch', severity: 'High',
              detail: 'Stored as NVARCHAR and normalised (>1 → ÷100); blank/non-numeric becomes 0, so wells with no progress entry render as flat 0% bars.' },
            { field: 'target_start, target_end', category: 'Null Values',
              detail: 'Missing dates are stored as a 1901-01-01 sentinel rather than NULL, so a well with no real schedule has nothing to plot (empty gantt area).' },
            { field: 'type', category: 'No Standardization',
              detail: 'Free-text type ("A" / "M", "T" excluded) decides what is shown; a mistyped value is dropped from the gantt.' },
            { field: 'Well_ID', category: 'Foreign Key',
              detail: 'Joined by string well id with no enforced FK; the 500+ well list comes from cluster-wells, so wells with no ActivityTaskPlan rows still appear (empty).' }
          ]
        }
      ]
    },
    weProgressRevenue: {
      title: 'Planned vs Actual Job Progress & Revenue',
      summary: 'Cumulative planned vs actual progress (%) and revenue over time, with milestones. Built ' +
               'from the pre-pivoted weekly columns of Dashboarding_Job_Progress.',
      tables: [
        {
          table: 'dbo.Dashboarding_Job_Progress',
          reliability: 'Low', reliabilityPct: 35,
          issues: [
            { field: 'Week-1..5 Plan/Actual %, Cum-Prior/Current Month columns', category: 'Other', type: 'Schema shape', severity: 'High',
              detail: 'Progress & revenue are stored as fixed WIDE columns (Cum-Prior Month, Week-1..5, Cum-Current Month) for the current month only — not a real date/value time series. The chart can therefore only ever show ~6 points for the current month; arbitrary ranges and history are impossible. A long-form table (well, date, planned%, actual%, planned_rev, actual_rev) is needed.' },
            { field: '[Well ID], [Week-1 Plan %], [Cum - Current Month Plan]', category: 'No Standardization', severity: 'High',
              detail: 'Column names contain spaces and inconsistent dash spacing ("Cum-Current Month Plan %" vs "Cum - Current Month Plan"), so every reference must be bracket-quoted and is easy to get wrong.' },
            { field: 'x-axis dates', category: 'Other', type: 'Derived', severity: 'High',
              detail: 'The date labels (31 May, 07 Jun …) are synthesised from today’s calendar month, NOT stored with the data — so they do not reflect the real reporting weeks and will not align when viewing other periods.' },
            { field: 'Milestones (Rig Move In, FLAF)', category: 'Other', type: 'Hard-coded', severity: 'High',
              detail: 'The API returns no milestones; the markers shown are hard-coded defaults in the front-end. Real milestone names/dates need a source table.' },
            { field: 'all % and revenue columns', category: 'Data Type Mismatch',
              detail: 'Stored as NVARCHAR; read via CAST(... AS FLOAT) with ISNULL(...,0), so blank/non-numeric values silently become 0.' },
            { field: 'revenue points', category: 'Other', type: 'Derived',
              detail: 'Revenue is monthly cumulative, linearly interpolated across the 6 weekly points — an assumption, not real weekly revenue.' },
            { field: '[Well ID]', category: 'Foreign Key',
              detail: 'Aggregated (AVG/SUM) across wells and joined by string well id with no enforced FK.' }
          ]
        }
      ]
    },
    weTotalJobs: {
      title: 'Total Jobs',
      summary: 'Count of wells in scope split into Complete / In Progress / Not Started. The count comes ' +
               'from WellMonitoringReport_Latest; the status split is derived from Revenue.act_percent.',
      tables: [
        {
          table: 'dbo.WellMonitoringReport_Latest',
          reliability: 'Medium', reliabilityPct: 60,
          issues: [
            { field: 'exp.rig_off_location_sap_data', category: 'No Standardization', severity: 'High',
              detail: 'The job count is filtered by this rig-off date column, which has a non-standard name (literal "exp." prefix) and is un-indexed — so the date filter is applied in memory to avoid a full-table scan/timeout.' },
            { field: 'pdo_well_id', category: 'Primary Key',
              detail: 'Jobs are counted per row; rows with a blank pdo_well_id are skipped. No enforced uniqueness on the well key.' }
          ]
        },
        {
          table: 'dbo.Revenue',
          reliability: 'Low', reliabilityPct: 45,
          issues: [
            { field: 'act_percent', category: 'Other', type: 'Derived', severity: 'High',
              detail: 'Complete / In Progress / Not Started is decided from Revenue.act_percent — i.e. job status is inferred from a REVENUE figure, not a physical-progress field.' },
            { field: 'act_percent', category: 'Data Type Mismatch',
              detail: 'Stored as NVARCHAR; read via TRY_CAST AS FLOAT and normalised (>1 used as-is, else ×100).' },
            { field: 'act_percent', category: 'Null Values',
              detail: 'A well with no Revenue row has a NULL act_percent and is bucketed as "Not Started" even if work has been done.' },
            { field: 'well_id', category: 'Foreign Key',
              detail: 'LEFT JOIN on well_id with no enforced FK to WellMonitoringReport_Latest.' }
          ]
        }
      ]
    },
    weOverallProgress: {
      title: 'Overall Progress',
      summary: 'Average actual progress % across the wells in scope, shown against a plan. The “vs Plan” ' +
               'comparison is not actually wired up.',
      tables: [
        {
          table: 'dbo.Revenue',
          reliability: 'Low', reliabilityPct: 35,
          issues: [
            { field: 'vs Plan (variance)', category: 'Other', type: 'Hard-coded', severity: 'High',
              detail: '"vs Plan 0%" is hard-coded to 0 — there is no planned-progress baseline wired up, so the comparison is meaningless until a plan source is added.' },
            { field: 'act_percent', category: 'Other', type: 'Derived', severity: 'High',
              detail: 'Overall Progress is the AVERAGE of a revenue-table percentage (Revenue.act_percent), not a real physical-progress measure.' },
            { field: 'act_percent', category: 'Data Type Mismatch',
              detail: 'NVARCHAR → TRY_CAST AS FLOAT, with fraction-vs-percentage normalisation.' },
            { field: 'well_id', category: 'Foreign Key',
              detail: 'Aggregated by well_id and joined with no FK; wells with no revenue row score 0.' }
          ]
        }
      ]
    },
    weDelayedJobs: {
      title: 'Delayed Jobs',
      summary: 'Wells whose rig-off (target end) date has passed but have no actual finish date recorded.',
      tables: [
        {
          table: 'dbo.WellMonitoringReport_Latest',
          reliability: 'Low', reliabilityPct: 45,
          issues: [
            { field: 'exp.rig_off_location_sap_data', category: 'No Standardization', severity: 'High',
              detail: 'The target-end date is this non-standardly named, un-indexed column; "delayed" means it is earlier than today. A blank value means the job cannot be assessed as delayed at all.' },
            { field: 'actual_finish_date', category: 'Null Values', severity: 'High',
              detail: 'A job counts as delayed only when actual_finish_date is NULL — so if completed jobs never get their finish date recorded, they keep counting as delayed.' },
            { field: 'pdo_well_id', category: 'Primary Key',
              detail: 'No enforced uniqueness; the percentage is delayed ÷ total rows.' }
          ]
        }
      ]
    },
    weRevenue: {
      title: 'Revenue Achievement',
      summary: 'Sum of actual purpose value vs planned purpose value across the wells in scope.',
      tables: [
        {
          table: 'dbo.Revenue',
          reliability: 'Low', reliabilityPct: 50,
          issues: [
            { field: 'planned_purpose_value, actual_purpose_value', category: 'Data Type Mismatch', severity: 'High',
              detail: 'Both monetary values are stored as NVARCHAR and summed via TRY_CAST AS FLOAT; non-numeric text becomes NULL and is dropped from the total.' },
            { field: 'planned_purpose_value', category: 'Null Values',
              detail: 'If planned value is blank/0 the % achieved is forced to 0 even when actual revenue exists.' },
            { field: 'well_id', category: 'Foreign Key',
              detail: 'Aggregated by well_id with no FK; revenue rows whose well is not in scope are silently excluded.' }
          ]
        }
      ]
    },
    weUpcomingEnds: {
      title: 'Upcoming Target Ends',
      summary: 'Wells whose rig-off (target end) date falls within the next 30 days and have no actual ' +
               'finish recorded.',
      tables: [
        {
          table: 'dbo.WellMonitoringReport_Latest',
          reliability: 'Low', reliabilityPct: 45,
          issues: [
            { field: 'exp.rig_off_location_sap_data', category: 'No Standardization', severity: 'High',
              detail: 'The whole tile depends on this non-standardly named, un-indexed and frequently blank rig-off date column; wells with no date never appear, so the count can read 0 even when ends are near.' },
            { field: 'actual_finish_date', category: 'Null Values',
              detail: 'Only wells with a NULL actual_finish_date are counted, so missing finish dates inflate the upcoming list.' }
          ]
        }
      ]
    }
  };

  openWidgetInfo(id: string): void {
    const info = this.widgetIntegrationInfo[id];
    const show = (window as any).wdWidgetInfoShowData;
    if (info && typeof show === 'function') {
      show(info);
    } else {
      console.warn('[wellexecution] DB-issues drawer not available for', id);
    }
  }

  /** Overall reliability % for a widget = average of its tables' reliabilityPct. */
  widgetRelPct(id: string): number | null {
    const tables = this.widgetIntegrationInfo[id]?.tables || [];
    if (!tables.length) return null;
    const sum = tables.reduce(
      (s: number, t: any) => s + (typeof t.reliabilityPct === 'number' ? t.reliabilityPct : 0), 0);
    return Math.round(sum / tables.length);
  }

  /** Colour band class for the reliability badge. */
  widgetRelClass(id: string): string {
    const pct = this.widgetRelPct(id);
    if (pct == null) return '';
    return pct >= 75 ? 'rel-high' : pct >= 50 ? 'rel-med' : 'rel-low';
  }

  // ── Category bars (chart 3) ───────────────────────────────────────────────
  categoryBars = [
    { name: 'NIMR Flowline',   plan: 36.31, actual: 9.39 },
    { name: 'NIMR Location',   plan: 27.24, actual: 5.74 },
    { name: 'Marmul Flowline', plan: 19.22, actual: 3.85 },
    { name: 'NIMR SNLP',       plan: 17.23, actual: 3.32 },
  ];
  catAxisMax = 40;

  // ── Activity / WBS rows (left panel of Activity Gantt) ────────────────────
  /** Activity template — same list reused under every well until per-well data is wired up. */
  activityWbs: ActivityRow[] = [
    { id: '1',   name: 'Location Start',  plan: '01 May', actual: '01 May',        color: '#00B050', hasChildren: true,  level: 0, startDay: 1,  endDay: 8,  pct: 1.0 },
    { id: '1.1', name: 'Site Survey',           plan: '01 May', actual: '01 May (100%)', color: '#00B050', hasChildren: false, level: 1, startDay: 1,  endDay: 3,  pct: 1.0 },
    { id: '1.2', name: 'Access Road',           plan: '03 May', actual: '04 May (100%)', color: '#00B050', hasChildren: false, level: 1, startDay: 3,  endDay: 6,  pct: 1.0 },
    { id: '1.3', name: 'Pad Construction',      plan: '05 May', actual: '08 May (100%)', color: '#00B050', hasChildren: false, level: 1, startDay: 5,  endDay: 8,  pct: 1.0 },
    { id: '2',   name: 'Location FInish',  plan: '02 May', actual: '03 May',        color: '#00B050', hasChildren: true,  level: 0, startDay: 2,  endDay: 11, pct: 1.0 },
    { id: '2.1', name: 'Layout Design',         plan: '02 May', actual: '04 May (100%)', color: '#00B050', hasChildren: false, level: 1, startDay: 2,  endDay: 6,  pct: 1.0 },
    { id: '2.2', name: 'Construction of Access Road',              plan: '07 May', actual: '11 May (100%)', color: '#00B050', hasChildren: false, level: 1, startDay: 7,  endDay: 11, pct: 1.0 },
    { id: '3',   name: 'Rig - On',  plan: '03 May', actual: '05 May',        color: '#00B050', hasChildren: true,  level: 0, startDay: 3,  endDay: 15, pct: 1.0 },
    { id: '3.1', name: 'PO Issued',             plan: '03 May', actual: '05 May (100%)', color: '#00B050', hasChildren: false, level: 1, startDay: 3,  endDay: 7,  pct: 1.0 },
    { id: '3.2', name: 'HDPE liner laying works',    plan: '08 May', actual: '15 May (100%)', color: '#00B050', hasChildren: false, level: 1, startDay: 8,  endDay: 15, pct: 1.0 },
    { id: '4',   name: 'Rig - Off', plan: '08 May', actual: '11 May',        color: '#29378d', hasChildren: true,  level: 0, expanded: true, startDay: 8, endDay: 19, pct: 0.6 },
    { id: '4.1', name: 'Trenching',             plan: '08 May', actual: '10 May (60%)',  color: '#3B82F6', hasChildren: false, level: 1, startDay: 8,  endDay: 15, pct: 0.6 },
    { id: '4.2', name: 'Pipe Laying',           plan: '10 May', actual: '11 May (40%)',  color: '#3B82F6', hasChildren: false, level: 1, startDay: 10, endDay: 17, pct: 0.4 },
    { id: '4.3', name: 'Welding',               plan: '12 May', actual: '– (0%)',        color: '#F59E0B', hasChildren: false, level: 1, startDay: 12, endDay: 19, pct: 0.0 },
    { id: '4.4', name: 'Coating & Lowering',    plan: '13 May', actual: '– (0%)',        color: '#9CA3AF', hasChildren: false, level: 1, startDay: 13, endDay: 19, pct: 0.0 },
    { id: '5',   name: 'Location Start',      plan: '14 May', actual: '– (0%)',        color: '#F59E0B', hasChildren: true,  level: 0, startDay: 14, endDay: 19, pct: 0.0 },
    { id: '5.1', name: 'Tower Erection',        plan: '14 May', actual: '– (0%)',        color: '#F59E0B', hasChildren: false, level: 1, startDay: 14, endDay: 17, pct: 0.0 },
    { id: '5.2', name: 'Stringing',             plan: '17 May', actual: '– (0%)',        color: '#F59E0B', hasChildren: false, level: 1, startDay: 17, endDay: 19, pct: 0.0 },
    { id: '6',   name: 'Location FInish',     plan: '20 May', actual: '– (0%)',        color: '#D1D5DB', hasChildren: true,  level: 0, startDay: 20, endDay: 27, pct: 0.0 },
    { id: '6.1', name: 'Pressure Test',         plan: '20 May', actual: '– (0%)',        color: '#D1D5DB', hasChildren: false, level: 1, startDay: 20, endDay: 23, pct: 0.0 },
    { id: '6.2', name: 'Hydrostatic Test',      plan: '23 May', actual: '– (0%)',        color: '#D1D5DB', hasChildren: false, level: 1, startDay: 23, endDay: 27, pct: 0.0 },
    { id: '7',   name: 'Rig - On',         plan: '24 May', actual: '– (0%)',        color: '#D1D5DB', hasChildren: true,  level: 0, startDay: 24, endDay: 27, pct: 0.0 },
    { id: '7.1', name: 'Start-up',              plan: '24 May', actual: '– (0%)',        color: '#D1D5DB', hasChildren: false, level: 1, startDay: 24, endDay: 26, pct: 0.0 },
    { id: '7.2', name: 'Handover',              plan: '26 May', actual: '– (0%)',        color: '#D1D5DB', hasChildren: false, level: 1, startDay: 26, endDay: 27, pct: 0.0 }
  ];

  /** Activity WBS view mode — accordion tree or flat list. */
  wbsViewMode: 'tree' | 'list' = 'tree';

  /** Wells listed in the left column. Each well owns a copy of the activity template. */
  wellGroups: { wellId: string; activities: ActivityRow[]; expanded?: boolean; loaded?: boolean; loading?: boolean }[] = [];

  /** Cached flattened rows for the template — rebuilt only when wells/view-mode change. */
  visibleWbs: any[] = [];

  /** True while the Activity Gantt is fetching real data. Gates the loader overlay so the
   *  dummy fallback never flashes before the API responds; cleared once real (or fallback) data lands. */
  ganttLoading = true;

  /** How many wells to show before the "Show more" toggle. */
  private readonly wellsCollapsedLimit = 10;
  /** Whether the full wells list is currently expanded. */
  wellsExpanded = false;
  /** Total wells in wellGroups (used by the Show more / Show less button). */
  get totalWells(): number { return this.wellGroups.length; }
  /** Whether the Show-more toggle should be rendered. */
  get hasMoreWells(): boolean { return this.wellGroups.length > this.wellsCollapsedLimit; }

  /** Toggle the wells-list "Show more / Show less". */
  toggleWellsExpanded(): void {
    this.wellsExpanded = !this.wellsExpanded;
    this.rebuildVisibleWbs();
    this.buildActivityGanttChart();
  }

  /** Build the wells list from the available mocked well IDs (used as fallback). */
  private initWellGroups(): void {
    const wellIds = (this.topDelayedJobs || []).map(j => j.wellId);
    this.wellGroups = wellIds.map((wellId, idx) => ({
      wellId,
      activities: this.activityWbs.map(a => ({ ...a })),
      expanded: idx === 0,
      loaded: true
    }));
    this.rebuildVisibleWbs();
  }

  /** Subscriptions for the ATP-related API calls. */
  private activityGanttSub?: Subscription;
  private clusterWellsSub?: Subscription;
  private wellStagesSubs = new Map<string, Subscription>();

  /**
   * Two-stage population:
   *  1. Try the bulk /dashboard/activity-gantt endpoint — works once the backend cache is warm.
   *  2. Otherwise fall back to /cluster-wells for the well list, then lazy-load each well's
   *     ATP rows (type A/M) via /dashboard/well-stages/{wellId} when the row is expanded.
   *  3. If everything fails, the dummy `initWellGroups()` fallback already populated wellGroups.
   */
  private loadActivityGantt(): void {
    this.ganttLoading = true;
    this.activityGanttSub?.unsubscribe();
    this.activityGanttSub = this.dashboardService.getActivityGantt().subscribe({
      next: (rows) => {
        if (rows && rows.length > 0) {
          this.wellGroups = this.buildWellGroupsFromApi(rows);
          this.ganttLoading = false;
          this.rebuildVisibleWbs();
          this.buildActivityGanttChart();
          return;
        }
        // Bulk endpoint returned empty — fall back to cluster-wells + lazy per-well loading.
        this.loadClusterWells();
      },
      error: (err) => {
        console.warn('[wellexecution] activity-gantt API failed, falling back to cluster-wells', err);
        this.loadClusterWells();
      }
    });
  }

  /** Pull the real well list from /cluster-wells and seed wellGroups (activities loaded on expand). */
  private loadClusterWells(): void {
    this.clusterWellsSub?.unsubscribe();
    this.clusterWellsSub = this.dashboardService.getClusterWells().subscribe({
      next: (clusters: ClusterWells[]) => {
        const f = this.readHfbFilters();
        // Cluster names in the API are mixed-case (e.g. "Marmul", "NIMR"); the HFB filter
        // stores a lowercase slug. Compare case-insensitively to bridge the two.
        const clusterMatch = (cluster: string): boolean => {
          if (!f.cluster) return true;
          return cluster.trim().toLowerCase() === f.cluster.trim().toLowerCase();
        };
        const wellTypeMatch = (wellType: string | null | undefined): boolean => {
          if (!f.wellType) return true;
          return (wellType || '').trim().toLowerCase() === f.wellType.trim().toLowerCase();
        };

        const ids: string[] = [];
        for (const c of clusters || []) {
          if (!clusterMatch(c.cluster || '')) continue;
          for (const w of c.wells || []) {
            if (!w?.id) continue;
            if (!wellTypeMatch(w.wellType)) continue;
            ids.push(w.id);
          }
        }
        // If a specific well is selected globally, restrict the list to just that well.
        const filteredByWellId = f.wellId ? ids.filter(id => id === f.wellId) : ids;
        if (filteredByWellId.length === 0) {
          this.wellGroups = [];
          this.ganttLoading = false;
          this.rebuildVisibleWbs();
          this.buildActivityGanttChart();
          return;
        }
        // De-duplicate while preserving order.
        const seen = new Set<string>();
        const unique = filteredByWellId.filter(id => seen.has(id) ? false : (seen.add(id), true));
        // Promote wells known to have ActivityTaskPlan data to the top of the list so the
        // user lands on a populated well immediately. Add more here as data is seeded.
        const preferredWellIds = ['33151'];
        const promoted: string[] = [];
        const rest: string[] = [];
        for (const id of unique) (preferredWellIds.includes(id) ? promoted : rest).push(id);
        // Maintain preferredWellIds ordering for those that exist.
        promoted.sort((a, b) => preferredWellIds.indexOf(a) - preferredWellIds.indexOf(b));
        const ordered = [...promoted, ...rest];
        this.wellGroups = ordered.map(wellId => ({
          wellId,
          activities: [],
          expanded: false,
          loaded: false,
          loading: false
        }));
        // Auto-expand the first well so the user sees content immediately.
        if (this.wellGroups[0]) {
          this.wellGroups[0].expanded = true;
          this.loadWellActivities(this.wellGroups[0]);
        }
        this.ganttLoading = false;
        this.rebuildVisibleWbs();
        this.buildActivityGanttChart();
      },
      error: (err) => {
        // Last resort: every API path failed — show the dummy wells so the widget isn't blank.
        console.warn('[wellexecution] cluster-wells API failed, showing dummy wells as fallback', err);
        this.initWellGroups();
        this.ganttLoading = false;
        this.buildActivityGanttChart();
      }
    });
  }

  /** Fetch one well's ATP rows via /dashboard/well-stages/{wellId} and keep only type A/M. */
  private loadWellActivities(g: { wellId: string; activities: ActivityRow[]; loaded?: boolean; loading?: boolean }): void {
    if (g.loaded || g.loading) return;
    g.loading = true;
    this.wellStagesSubs.get(g.wellId)?.unsubscribe();
    const sub = this.dashboardService.getWellStages(g.wellId).subscribe({
      next: (resp: WellStagesResponse) => {
        // 1. Keep only Activity / Milestone rows.
        const items = (resp?.stages || []).filter((s: WellStageItem) => {
          const t = (s.stageType || '').toUpperCase();
          return t === 'A' || t === 'M';
        });
        // 2. Sort chronologically by targetStart so milestones (M) and the activities (A)
        //    that follow them on the schedule pair up naturally. Tie-break:
        //      M before A when dates are identical (so an M opens its group correctly), then
        //      stageName for total ordering. Rows without a plan date fall to the end.
        items.sort((a, b) => {
          const ta = a.targetStart ? Date.parse(a.targetStart) : Number.POSITIVE_INFINITY;
          const tb = b.targetStart ? Date.parse(b.targetStart) : Number.POSITIVE_INFINITY;
          if (ta !== tb) return ta - tb;
          const ma = (a.stageType || '').toUpperCase() === 'M' ? 0 : 1;
          const mb = (b.stageType || '').toUpperCase() === 'M' ? 0 : 1;
          if (ma !== mb) return ma - mb;
          return (a.stageName || '').localeCompare(b.stageName || '');
        });
        // 3. De-duplicate by (stageType, stageName). DB stores N duplicates per activity
        //    template (one per phase/project), all with the same human-readable text — those
        //    are visual repeats from the user's point of view. Keep the first occurrence
        //    (earliest plan date wins thanks to step 2).
        const seen = new Set<string>();
        const unique: WellStageItem[] = [];
        for (const s of items) {
          const key = (s.stageType || '').toUpperCase()
                    + '|' + (s.stageName || '').trim().toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(s);
        }
        // 4. Group into the nested "N. Milestone → N.x Activity" pattern. Each M row starts
        //    a new group; A rows attach to the most recent M (or get their own top-level slot
        //    if they appear before any M).
        const out: ActivityRow[] = [];
        let milestoneIdx = 0;
        let activityIdx = 0;
        let currentMilestoneId: string | null = null;
        for (const s of unique) {
          const type = (s.stageType || '').toUpperCase();
          if (type === 'M') {
            milestoneIdx++;
            activityIdx = 0;
            currentMilestoneId = String(milestoneIdx);
            // Milestones sit just below the well (level 1) and are independently expandable.
            const m = this.stageItemToActivityRow(s, currentMilestoneId, 1, true);
            m.hasChildren = true;  // chevron renders; set to false later if no activities follow
            m.expanded    = false; // collapsed by default to save vertical space
            out.push(m);
          } else {
            activityIdx++;
            const id = currentMilestoneId
              ? `${currentMilestoneId}.${activityIdx}`
              : `${++milestoneIdx}`;
            // Activities sit one indent deeper than their parent milestone (level 2).
            out.push(this.stageItemToActivityRow(s, id, 2, false));
          }
        }
        // Strip the chevron off any milestone that ended up with no activities behind it.
        for (let i = 0; i < out.length; i++) {
          if (out[i].isMilestone) {
            const next = out[i + 1];
            if (!next || next.isMilestone) out[i].hasChildren = false;
          }
        }
        g.activities = out;
        g.loaded = true;
        g.loading = false;
        this.rebuildVisibleWbs();
        this.buildActivityGanttChart();
      },
      error: (err) => {
        console.warn('[wellexecution] well-stages failed for', g.wellId, err);
        g.loading = false;
      }
    });
    this.wellStagesSubs.set(g.wellId, sub);
  }

  /**
   * Map a WellStageItem (from /well-stages) onto the row shape the template + chart consume.
   * @param id           Display id ("1", "2", "1.1", "1.2", …)
   * @param level        0 = milestone (treated as a heading row under the well),
   *                     1 = activity child of a milestone
   * @param isMilestone  true for type='M' (used by the template to vary styling)
   */
  private stageItemToActivityRow(s: WellStageItem, id: string, level: number, isMilestone: boolean): ActivityRow {
    // /well-stages returns progress as 0–100; normalise to 0..1.
    const pct = Math.max(0, Math.min(1, (s.progress ?? 0) / 100));
    const pctTxt = Math.round(pct * 100) + '%';

    const ts = (v: string | null | undefined): number | undefined => {
      if (!v) return undefined;
      const t = Date.parse(v);
      return isNaN(t) ? undefined : t;
    };
    const fmt = (v: string | null | undefined): string => {
      const t = ts(v);
      if (t === undefined) return '–';
      const d = new Date(t);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    };

    const startTs       = ts(s.targetStart);
    const endTs         = ts(s.targetEnd) ?? startTs;
    const actualStartTs = ts(s.actualStart);

    let color = '#9CA3AF';
    if (pct >= 1)                          color = '#00B050';
    else if (pct > 0)                      color = '#29378d';
    else if (actualStartTs !== undefined)  color = '#F59E0B';

    return {
      id,
      name: s.stageName || '',
      plan:   fmt(s.targetStart),
      actual: actualStartTs !== undefined ? `${fmt(s.actualStart)} (${pctTxt})` : `– (${pctTxt})`,
      color,
      hasChildren: false,
      level,
      startDay: startTs !== undefined ? new Date(startTs).getUTCDate() : 1,
      endDay:   endTs   !== undefined ? new Date(endTs).getUTCDate()   : 1,
      pct,
      startTs, endTs,
      isWell: false,
      isMilestone
    };
  }

  /** Group API rows by Well_ID and convert each row to an ActivityRow. */
  private buildWellGroupsFromApi(rows: ActivityGanttRow[]):
    { wellId: string; activities: ActivityRow[]; expanded?: boolean }[]
  {
    const byWell = new Map<string, ActivityGanttRow[]>();
    for (const r of rows) {
      const wid = (r.wellId || '').trim();
      if (!wid) continue;
      const list = byWell.get(wid);
      if (list) list.push(r);
      else byWell.set(wid, [r]);
    }

    const out: { wellId: string; activities: ActivityRow[]; expanded?: boolean }[] = [];
    let idx = 0;
    for (const [wellId, list] of byWell) {
      // Sort each well's rows by code so 1, 1.1, 1.2, 2, 2.1, ... appear in order.
      list.sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true, sensitivity: 'base' }));
      const activities = list.map(r => this.apiRowToActivityRow(r));
      out.push({ wellId, activities, expanded: idx === 0 });
      idx++;
    }
    return out;
  }

  /** Map one API row to the row shape the template + chart already consume. */
  private apiRowToActivityRow(r: ActivityGanttRow): ActivityRow {
    const ts = (s: string | null | undefined): number | undefined => {
      if (!s) return undefined;
      const t = Date.parse(s);
      return isNaN(t) ? undefined : t;
    };
    const fmt = (s: string | null | undefined): string => {
      const t = ts(s);
      if (t === undefined) return '–';
      const d = new Date(t);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    };

    const startTs = ts(r.targetStart);
    const endTs   = ts(r.targetEnd) ?? startTs;
    const actualStartTs = ts(r.actualStart);
    const pct = Math.max(0, Math.min(1, r.progress || 0));
    const pctTxt = Math.round(pct * 100) + '%';

    // Colour mirrors the legend: 100% green, in-progress blue, started-but-stale amber, not-started grey.
    let color = '#9CA3AF';
    if (pct >= 1)                     color = '#00B050';
    else if (pct > 0)                 color = '#29378d';
    else if (actualStartTs !== undefined) color = '#F59E0B';

    return {
      id: r.code || '',
      name: r.text || r.code || '',
      plan: fmt(r.targetStart),
      actual: actualStartTs !== undefined ? `${fmt(r.actualStart)} (${pctTxt})` : `– (${pctTxt})`,
      color,
      hasChildren: false,
      level: 1,
      // Day-of-month fallback for the legacy May-2026 axis; absolute ts drives the new dynamic axis.
      startDay: startTs !== undefined ? new Date(startTs).getUTCDate() : 1,
      endDay:   endTs   !== undefined ? new Date(endTs).getUTCDate()   : 1,
      pct,
      startTs, endTs,
      isWell: false
    };
  }

  /** Rebuild the cached visible-rows list. Wells become level-0; expanded well's activities follow. */
  private rebuildVisibleWbs(): void {
    const out: any[] = [];
    const expandAll = this.wbsViewMode === 'list';
    // Apply "Show more / Show less" — collapsed by default, with the currently-opened well
    // always kept visible so its activities don't disappear if it sits past the limit.
    const visibleWellGroups = (this.wellsExpanded || expandAll)
      ? this.wellGroups
      : (() => {
          const head = this.wellGroups.slice(0, this.wellsCollapsedLimit);
          const openOutside = this.wellGroups
            .slice(this.wellsCollapsedLimit)
            .filter(g => g.expanded);
          return head.concat(openOutside);
        })();
    for (const g of visibleWellGroups) {
      const acts = g.activities;
      let minStart = Infinity, maxEnd = -Infinity, sumPct = 0;
      let minStartTs: number | undefined, maxEndTs: number | undefined;
      for (const a of acts) {
        if (a.startDay < minStart) minStart = a.startDay;
        if (a.endDay   > maxEnd)   maxEnd   = a.endDay;
        sumPct += a.pct;
        if (a.startTs !== undefined && (minStartTs === undefined || a.startTs < minStartTs)) minStartTs = a.startTs;
        if (a.endTs   !== undefined && (maxEndTs   === undefined || a.endTs   > maxEndTs))   maxEndTs   = a.endTs;
      }
      out.push({
        id: '',
        name: g.wellId,
        plan: '',
        actual: '',
        color: '#94A3B8',
        hasChildren: true,
        expanded: expandAll || !!g.expanded,
        level: 0,
        startDay: acts.length ? minStart : 1,
        endDay:   acts.length ? maxEnd   : 1,
        pct:      acts.length ? sumPct / acts.length : 0,
        startTs:  minStartTs,
        endTs:    maxEndTs,
        isWell:   true,
        _group:   g
      });
      if (expandAll || g.expanded) {
        // Walk acts in order; an A is rendered only if its preceding M is expanded
        // (or there is no preceding M yet — orphan activities show by default).
        let milestoneOpen = true;
        for (const a of acts) {
          if (a.isMilestone) {
            milestoneOpen = expandAll || !!a.expanded;
            // Push by reference so the chevron's expanded state mutates in place.
            out.push(a);
          } else if (milestoneOpen) {
            out.push(a);
          }
        }
      }
    }
    this.visibleWbs = out;
  }

  /** Stable identity for *ngFor — keeps DOM nodes across CD cycles. */
  trackWbsRow = (_i: number, r: any): string => r.isWell ? 'w:' + r.name : 'a:' + (r._group?.wellId || '') + ':' + r.id;

  /**
   * Click handler for a WBS row.
   *  - Well row     → accordion-toggles the well (only one well open at a time),
   *                   lazy-loading its ATP rows on first open.
   *  - Milestone    → independently toggles its activity list (multiple milestones
   *                   can be open at once so the user can compare phases).
   *  - Activity row → no-op (leaf).
   */
  toggleWbsRow(r: any): void {
    if (this.wbsViewMode !== 'tree') return;

    if (r.isWell) {
      const g = r._group;
      if (!g) return;
      const wasOpen = !!g.expanded;
      for (const x of this.wellGroups) x.expanded = false;
      if (!wasOpen) {
        g.expanded = true;
        if (!g.loaded) this.loadWellActivities(g);
      }
      this.rebuildVisibleWbs();
      this.buildActivityGanttChart();
      return;
    }

    if (r.isMilestone && r.hasChildren) {
      r.expanded = !r.expanded;
      this.rebuildVisibleWbs();
      this.buildActivityGanttChart();
    }
  }

  /** Switch between tree and list view of the WBS. */
  setWbsViewMode(mode: 'tree' | 'list'): void {
    if (this.wbsViewMode === mode) return;
    this.wbsViewMode = mode;
    this.rebuildVisibleWbs();
    this.buildActivityGanttChart();
  }

  /** Planned vs Actual Progress & Revenue period toggle. */
  parPeriod: 'day' | 'week' | 'month' = 'week';
  setParPeriod(p: 'day' | 'week' | 'month'): void {
    console.log('[wellexecution] setParPeriod clicked:', p, 'current:', this.parPeriod);
    if (this.parPeriod === p) return;
    this.parPeriod = p;
    // Period toggle only re-buckets the chart; KPI card values stay anchored to the
    // global date-picker window and don't refresh here.
    this.loadWellExecChartOnly();
  }

  /**
   * Refetch /well-execution-kpi for the chart only. Mirrors loadWellExecKpi's argument
   * derivation but updates ONLY the chart-series fields so the KPI card numbers don't
   * blink/recompute on Day/Week/Month toggles.
   */
  private loadWellExecChartOnly(): void {
    this.kpiSub?.unsubscribe();
    const f = this.readHfbFilters();

    // Force a network round-trip on every period toggle so the chart can't be served a
    // stale, cross-period response from the in-memory cache.
    this.dashboardService.clearCache();

    console.log('[wellexecution] loadWellExecChartOnly fetching', { period: this.parPeriod, ...f });
    this.kpiSub = this.dashboardService.getWellExecKpi({
      period: this.parPeriod,
      cluster:  f.cluster,
      wellType: f.wellType,
      wellId:   f.wellId,
      from:     f.from,
      to:       f.to,
      chartOnly: true,
    }).subscribe({
      next: (data) => {
        console.log('[wellexecution] chart data received:', data.chartSeries?.length, 'points, first label =', data.chartSeries?.[0]?.label);
        this.wexecChartData  = data.chartSeries;
        this.wexecMilestones = data.milestones;
        // Make sure the chart actually rebuilds even if a prior loadWellExecKpi left
        // kpiLoading=true (race when user toggles before the initial load finished).
        this.kpiLoading = false;
        this.buildWexecParChart();
      },
      error: (err) => {
        console.warn('[wellexecution] chart refresh failed', err);
      }
    });
  }

  // ── Crew PI Rating Heatmap ───────────────────────────────────────────────
  /** Period toggle for the Crew PI Heatmap (Day / Week / Month). */
  crewPiPeriod: 'day' | 'week' | 'month' = 'week';
  setCrewPiPeriod(p: 'day' | 'week' | 'month'): void {
    if (this.crewPiPeriod === p) return;
    this.crewPiPeriod = p;
    this.applyCrewPiDistribution();
    this.buildCrewPiHeatmap();
  }

  /** Per-period distribution buckets from the API; falls back to the static set below. */
  private crewPiDistByPeriod: Partial<Record<'day' | 'week' | 'month', CrewPiDistribution[]>> = {};

  /** Switch the distribution panel to match the active period (no-op until API data arrives). */
  private applyCrewPiDistribution(): void {
    const d = this.crewPiDistByPeriod[this.crewPiPeriod];
    if (d && d.length) this.crewPiDistribution = d;
  }

  /** P-rating colour scale — P8 green → P0 red (gradient across 9 stops). */
  ratingScale = [
    { label: 'P8', color: '#15803D' },
    { label: 'P7', color: '#22C55E' },
    { label: 'P6', color: '#84CC16' },
    { label: 'P5', color: '#EAB308' },
    { label: 'P4', color: '#F59E0B' },
    { label: 'P3', color: '#F97316' },
    { label: 'P2', color: '#EF4444' },
    { label: 'P1', color: '#DC2626' },
    { label: 'P0', color: '#991B1B' }
  ];

  /** Headline KPIs above the heatmap. */
  crewPiKpis = {
    totalCrews: 18,
    avgRating: '5.2',
    avgDelta:  '0.6',
    topCrew:   'Crew A',
    topRating: '7.6',
    lowCrew:   'Crew L',
    lowRating: '1.4',
    belowP3:   3,
    belowP3Pct: 17
  };

  /** Per-period datasets — heatmap reads the entry matching `crewPiPeriod`. */
  crewPiDatasets: Record<'day' | 'week' | 'month', {
    columns: string[];
    rows: { crew: string; avg: number; vals: (number | null)[] }[];
  }> = {
    day: {
      columns: [
        'Mon\n19 May', 'Tue\n20 May', 'Wed\n21 May', 'Thu\n22 May',
        'Fri\n23 May', 'Sat\n24 May', 'Sun\n25 May'
      ],
      rows: [
        { crew: 'Crew A', avg: 7.9, vals: [7, 8, 8, 8, 8, 8, 8] },
        { crew: 'Crew B', avg: 7.0, vals: [6, 7, 7, 7, 7, 8, 7] },
        { crew: 'Crew C', avg: 6.0, vals: [5, 6, 6, 6, 6, 7, 6] },
        { crew: 'Crew D', avg: 5.1, vals: [5, 5, 5, 5, 5, 6, 5] },
        { crew: 'Crew E', avg: 4.3, vals: [4, 4, 4, 4, 5, 5, 4] },
        { crew: 'Crew F', avg: 3.7, vals: [3, 4, 4, 4, 3, 4, 4] },
        { crew: 'Crew G', avg: 3.0, vals: [3, 3, 3, 3, 3, 3, 3] },
        { crew: 'Crew H', avg: 2.6, vals: [2, 3, 2, 3, 3, 2, 3] },
        { crew: 'Crew I', avg: 2.0, vals: [2, 2, 2, 2, 2, 2, 2] },
        { crew: 'Crew J', avg: 1.7, vals: [2, 2, 2, 1, 1, 2, 2] },
        { crew: 'Crew K', avg: 1.4, vals: [1, 1, 2, 1, 1, 2, 1] },
        { crew: 'Crew L', avg: 1.3, vals: [1, 1, 1, 2, 1, 2, 1] }
      ]
    },
    week: {
      columns: [
        'W1\n27 Apr - 03 May',
        'W2\n04 May - 10 May',
        'W3\n11 May - 17 May',
        'W4\n18 May - 25 May'
      ],
      rows: [
        { crew: 'Crew A', avg: 7.6, vals: [6, 7, 8, 8] },
        { crew: 'Crew B', avg: 6.3, vals: [5, 6, 6, 8] },
        { crew: 'Crew C', avg: 5.5, vals: [5, 5, 6, 6] },
        { crew: 'Crew D', avg: 4.8, vals: [4, 5, 5, 5] },
        { crew: 'Crew E', avg: 4.0, vals: [4, 4, 4, 4] },
        { crew: 'Crew F', avg: 3.5, vals: [3, 4, 3, 4] },
        { crew: 'Crew G', avg: 3.0, vals: [3, 3, 3, 3] },
        { crew: 'Crew H', avg: 2.5, vals: [2, 3, 2, 3] },
        { crew: 'Crew I', avg: 2.0, vals: [2, 2, 2, 2] },
        { crew: 'Crew J', avg: 1.8, vals: [2, 2, 2, 1] },
        { crew: 'Crew K', avg: 1.5, vals: [1, 1, 2, 1] },
        { crew: 'Crew L', avg: 1.4, vals: [1, 1, 1, 2] }
      ]
    },
    month: {
      columns: ['Mar \'26', 'Apr \'26', 'May \'26'],
      rows: [
        { crew: 'Crew A', avg: 6.7, vals: [5, 7, 8] },
        { crew: 'Crew B', avg: 5.7, vals: [5, 6, 6] },
        { crew: 'Crew C', avg: 5.0, vals: [4, 5, 6] },
        { crew: 'Crew D', avg: 4.3, vals: [4, 4, 5] },
        { crew: 'Crew E', avg: 3.7, vals: [3, 4, 4] },
        { crew: 'Crew F', avg: 3.0, vals: [3, 3, 3] },
        { crew: 'Crew G', avg: 2.7, vals: [2, 3, 3] },
        { crew: 'Crew H', avg: 2.3, vals: [2, 2, 3] },
        { crew: 'Crew I', avg: 2.0, vals: [2, 2, 2] },
        { crew: 'Crew J', avg: 1.7, vals: [2, 1, 2] },
        { crew: 'Crew K', avg: 1.3, vals: [1, 1, 2] },
        { crew: 'Crew L', avg: 1.3, vals: [1, 1, 2] }
      ]
    }
  };

  crewPiInsights = [
    'Crew A improved from P6 to P8 and is the top performer.',
    'Crew L is consistently below P2 and needs immediate attention.',
    'Overall average PI Rating improved by 0.6 compared to last period.'
  ];

  crewPiDistribution = [
    { range: 'P8 - P7', count: 4, pct: 22, color: '#15803D' },
    { range: 'P6',      count: 5, pct: 28, color: '#22C55E' },
    { range: 'P5 - P4', count: 3, pct: 17, color: '#EAB308' },
    { range: 'P3 - P2', count: 3, pct: 17, color: '#F97316' },
    { range: 'P1 - P0', count: 3, pct: 16, color: '#DC2626' }
  ];

  // ── Top Delayed Jobs (table 5) ────────────────────────────────────────────
  topDelayedJobs: TopDelayedJob[] = [
    { wellId: 'WD-3522-05087-SNL-1-L', category: 'NIMR SNLP',    plan: 12.17, actual: 0.00, variance: -12.17, targetEnd: '24 Jun 2025' },
    { wellId: 'WD-3522-02286-SNL-1-L', category: 'Marmul SNLP',  plan:  2.00, actual: 0.00, variance:  -2.00, targetEnd: '27 May 2025' },
    { wellId: 'WD-3522-02198-SNL-1-L', category: 'NIMR SNLP',    plan: 13.00, actual: 0.00, variance: -13.00, targetEnd: '25 May 2025' },
    { wellId: 'WD-3522-04895-SNL-1-L', category: 'NIMR SNLP',    plan: 13.00, actual: 0.00, variance: -13.00, targetEnd: '16 May 2025' },
    { wellId: 'WD-3522-01918-SNL-1-L', category: 'NIMR SNLP',    plan: 85.00, actual:  0.38, variance: -84.62, targetEnd: '26 Apr 2025' },
    { wellId: 'WD-3522-02263-SNL-1-L', category: 'Marmul SNLP',  plan:  0.00, actual: 0.00, variance:   0.00, targetEnd: '23 May 2025' },
    { wellId: 'WD-3522-24172-FLC-1-L', category: 'Marmul Flowline', plan: 0.45, actual: 0.00, variance: -0.45, targetEnd: '26 May 2025' },
    { wellId: 'WD-3522-24245-FLC-1-L', category: 'Marmul Cvr. w/ Flowline', plan: 0.00, actual: 0.00, variance: 0.00, targetEnd: '02 Jul 2025' },
    { wellId: 'WD-3522-24176-FLC-1-L', category: 'Marmul Flowline', plan: 0.00, actual: 0.00, variance: 0.00, targetEnd: '04 Jul 2025' },
    { wellId: 'WD-3522-05501-SNL-1-L', category: 'NIMR SNLP',    plan:  0.00, actual: 0.00, variance:   0.00, targetEnd: '06 Jul 2025' },
  ];

  /**
   * Live rows for the Target Finish Timeline, populated from /dashboard/target-finish-timeline.
   * Kept separate from `topDelayedJobs` so the "Top Delayed Jobs" grid (which needs plan/variance
   * the timeline API doesn't supply) is unaffected.
   */
  private targetFinishJobs: TopDelayedJob[] = [];

  /**
   * True once the API has answered at least once. Before that the chart shows `topDelayedJobs`
   * (sample) so it isn't blank on first paint. After the first response we ALWAYS use the live
   * rows — even when empty — so a filter that matches no wells shows an empty timeline instead of
   * the sample (whose 2025 dates would otherwise render as misleading all-overdue bars).
   */
  private targetFinishLoaded = false;

  /** Source the Target Finish Timeline (left table + chart) reads from: live data once loaded, else sample. */
  private get timelineJobs(): TopDelayedJob[] {
    return this.targetFinishLoaded ? this.targetFinishJobs : this.topDelayedJobs;
  }

  // ── Gantt (chart 6) ───────────────────────────────────────────────────────
  ganttRows: GanttRow[] = [];

  // Timeline ticks shown in header
  ganttTicks = [
    { month: 'May 2025', days: [25, 27, 29, 31] },
    { month: 'Jun 2025', days: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30] },
    { month: 'Jul 2025', days: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22] },
  ];
  // Total number of ticks for positioning: 4 + 15 + 11 = 30 ticks (every 2 days over 60 days)
  ganttTotalDays = 60;

  ngOnInit(): void {
    // No eager dummy data — loadActivityGantt() shows a loader until real data lands and
    // only falls back to initWellGroups() if every API call fails.
    this.loadActivityGantt();
    this.loadWellExecKpi();
    this.loadCrewPiHeatmap();
    this.loadTargetFinishTimeline();
  }

  /**
   * Loads the Target Finish Timeline from /dashboard/target-finish-timeline, mapping each row to
   * the TopDelayedJob shape the chart + left table already consume. Honors the active HFB filters
   * (cluster / well type / well id). On success it repoints `targetFinishJobs` and rebuilds the
   * gantt rows + chart; on error/empty it leaves the sample rows in place.
   */
  private loadTargetFinishTimeline(): void {
    this.targetFinishSub?.unsubscribe();
    const f = this.readHfbFilters();
    this.targetFinishSub = this.dashboardService.getTargetFinishTimeline({
      cluster:  f.cluster,
      site:     f.site,
      wellType: f.wellType,
      wellId:   f.wellId,
      from:     f.from,   // defaults to last 90 days (see readHfbFilters)
      to:       f.to,
      take:     50,
    }).subscribe({
      next: (res) => {
        const items = res?.items ?? [];
        // No matching wells → show an empty timeline (don't fall back to sample, which would
        // misrepresent the filter result). Once loaded, the getter always uses these live rows.
        this.targetFinishJobs = items.map((it: TargetFinishTimelineItem) => this.timelineItemToJob(it));
        this.targetFinishLoaded = true;
        this.buildGanttRows();
        this.buildTargetFinishChart();
      },
      error: (err) => console.warn('[wellexecution] target-finish-timeline failed, keeping current data', err),
    });
  }

  /** Map a /target-finish-timeline row onto the TopDelayedJob shape (targetEnd as "DD Mon YYYY"). */
  private timelineItemToJob(it: TargetFinishTimelineItem): TopDelayedJob {
    // Prefer the DB Category (e.g. "Nimr Flowline"); fall back to cluster + well type.
    const category = (it.category && it.category !== 'N/A')
      ? it.category
      : ([it.cluster, it.wellType].filter(v => v && v !== 'N/A').join(' ') || '—');
    let targetEnd = '';
    if (it.targetFinishDate) {
      const d = new Date(it.targetFinishDate + 'T00:00:00');
      if (!isNaN(d.getTime())) {
        targetEnd = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      }
    }
    const actual = Math.round((it.progressPct ?? 0) * 100) / 100;
    return { wellId: it.wellId, category, plan: 0, actual, variance: 0, targetEnd };
  }

  /**
   * Loads the Crew PI Rating heatmap from dbo.PH_Productivity. The component ships with sample
   * data so the widget renders before the first API response. Once data arrives it is replaced
   * with live data; the cluster / WELL TYPE / WELL ID filters restrict which crews appear, so a
   * filter that matches no crews shows an empty heatmap rather than the sample.
   */
  private loadCrewPiHeatmap(): void {
    this.crewPiSub?.unsubscribe();
    const f = this.readHfbFilters();
    const hasFilter = !!(f.cluster || f.wellType || f.wellId);
    this.crewPiSub = this.dashboardService.getCrewPiHeatmap({
      cluster:  f.cluster,
      wellType: f.wellType,
      wellId:   f.wellId,
      from:     f.from,
      to:       f.to,
    }).subscribe({
      next: (res) => this.applyCrewPiHeatmap(res, hasFilter),
      error: (err) => console.warn('[wellexecution] Crew PI heatmap API failed, using sample data', err),
    });
  }

  /** Map the API payload onto the heatmap's view models. */
  private applyCrewPiHeatmap(res: CrewPiHeatmapResponse, hasFilter: boolean): void {
    if (!res) return;
    const hasAny = (res.week?.rows?.length || res.day?.rows?.length || res.month?.rows?.length);
    if (!hasAny) {
      // No rows: if a filter is active this means "no crews match" → show empty. With no filter
      // it usually means the source is unavailable → keep the built-in sample so the page isn't blank.
      if (hasFilter) this.clearCrewPiHeatmap();
      return;
    }

    if (res.kpis) this.crewPiKpis = res.kpis;

    const applyPeriod = (key: 'day' | 'week' | 'month', p: CrewPiPeriod | undefined) => {
      if (!p) return;
      this.crewPiDatasets[key] = {
        columns: p.columns ?? [],
        rows: (p.rows ?? []).map(r => ({ crew: r.crew, avg: r.avg, vals: r.vals })),
      };
      this.crewPiDistByPeriod[key] = p.distribution ?? [];
    };
    applyPeriod('day',   res.day);
    applyPeriod('week',  res.week);
    applyPeriod('month', res.month);

    this.crewPiInsights = res.insights?.length ? res.insights : [];
    this.applyCrewPiDistribution();
    this.buildCrewPiHeatmap();
  }

  /** Blank the heatmap (used when an active filter matches no crews). */
  private clearCrewPiHeatmap(): void {
    this.crewPiKpis = {
      totalCrews: 0, avgRating: '0.0', avgDelta: '0.0',
      topCrew: '—', topRating: '0.0', lowCrew: '—', lowRating: '0.0',
      belowP3: 0, belowP3Pct: 0,
    };
    (['day', 'week', 'month'] as const).forEach(k => {
      this.crewPiDatasets[k] = { columns: [], rows: [] };
      this.crewPiDistByPeriod[k] = [];
    });
    this.crewPiDistribution = [];
    this.crewPiInsights = ['No crews match the selected filters.'];
    this.buildCrewPiHeatmap();
  }

  /**
   * Reads the active HFB filter values (cluster, well-type, well-id, date range) and
   * applies a 90-day default for the date window when nothing is selected. The fields
   * map to the API like this:
   *   HFB "CLUSTER"   → API cluster
   *   HFB "WELL TYPE" (stored as `location` in HfbFilter) → API wellType
   *   HFB "WELL ID"   → API wellId
   */
  private readHfbFilters(): { cluster?: string; site?: string; wellType?: string; wellId?: string; from: string; to: string } {
    const hfb = (window as any).hfbState as { startDate?: string; endDate?: string; cluster?: string; site?: string; location?: string; well?: string } | undefined;
    // `site` is stored on the filter via setFilter({site} as any), so read it untyped.
    const dsFilter = (this.dashboardService.currentFilter || {}) as any;
    const today  = new Date();
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const ninetyDaysAgo = new Date(today.getTime() - 90 * 24 * 3600 * 1000);
    const wellRaw = dsFilter.wellId || (hfb?.well ? (hfb.well.split('-').slice(1).join('-') || hfb.well) : undefined);
    return {
      cluster:  dsFilter.cluster  || hfb?.cluster  || undefined,
      site:     dsFilter.site     || hfb?.site     || undefined,   // "SITE" dropdown
      wellType: dsFilter.location || hfb?.location || undefined,   // "WELL TYPE" dropdown
      wellId:   wellRaw || undefined,
      from:     dsFilter.startDate || hfb?.startDate || fmt(ninetyDaysAgo),
      to:       dsFilter.endDate   || hfb?.endDate   || fmt(today),
    };
  }

  private loadWellExecKpi(): void {
    this.kpiLoading = true;
    this.kpiSub?.unsubscribe();
    const f = this.readHfbFilters();

    this.kpiSub = this.dashboardService.getWellExecKpi({
      period: this.parPeriod,
      cluster:  f.cluster,
      wellType: f.wellType,
      wellId:   f.wellId,
      from:     f.from,
      to:       f.to,
    }).subscribe({
      next: (data) => {
        // ── KPI Cards ──────────────────────────────────────────────────────
        this.totalJobs      = data.jobCounts.total;
        this.activeJobs     = data.jobCounts.completed;
        this.inProgressJobs = data.jobCounts.inProgress;
        this.holdJobs       = data.jobCounts.notStarted;

        this.overallProgress = data.progress.actualPct;
        this.overallVsPlan   = data.progress.variancePct;

        this.delayedJobs    = data.delayed.count;
        this.delayedJobsPct = data.delayed.pctOfTotal;

        const aM = data.revenue.actualM;
        const pM = data.revenue.plannedM;
        this.revenueAchieved = aM >= 1 ? aM.toFixed(2) + 'M' : (aM * 1000).toFixed(0) + 'K';
        this.revenuePlanned  = pM >= 1 ? pM.toFixed(2) + 'M' : (pM * 1000).toFixed(0) + 'K';
        this.revenuePct      = data.revenue.pctAchieved;

        this.upcomingEnds = data.upcomingTargetEnds;

        // ── Chart ──────────────────────────────────────────────────────────
        this.wexecChartData  = data.chartSeries;
        this.wexecMilestones = data.milestones;
        this.kpiLoading = false;
        this.buildWexecParChart();
      },
      error: (err) => {
        console.warn('[wellexecution] KPI API failed, using defaults', err);
        this.kpiLoading = false;
        this.buildWexecParChart();
      }
    });
  }

  ngAfterViewInit(): void {
    this.buildGanttRows();
    setTimeout(() => {
      // Each build is isolated — a failure in one must not abort the rest
      const safe = (fn: () => void, label: string) => {
        try { fn(); } catch (e) { console.error('[wellexecution]', label, 'failed:', e); }
      };
      safe(() => this.buildWeeklyTrendChart(),  'buildWeeklyTrendChart');
      safe(() => this.buildSCurveChart(),       'buildSCurveChart');
      safe(() => this.buildCategoryBarChart(),  'buildCategoryBarChart');
      safe(() => this.buildRevPhysChart(),      'buildRevPhysChart');
      safe(() => this.buildWexecParChart(),     'buildWexecParChart');
      safe(() => this.buildActivityGanttChart(),'buildActivityGanttChart');
      safe(() => this.buildTargetFinishChart(), 'buildTargetFinishChart');
      safe(() => this.buildDelayedGrid(),       'buildDelayedGrid');
      safe(() => this.buildCrewPiHeatmap(),     'buildCrewPiHeatmap');
      // Fetch Daily Output Rate with current HFB filters.
      // Use dashboardService.currentFilter for dates — it reflects the global
      // date preset (e.g. "Last 90 Days") set in AppComponent.ngOnInit.
      // hfbState.startDate is only first-of-month by default and does NOT
      // match the preset dropdown, causing the chart to show fewer days.
      const hfb0 = (window as any).hfbState;
      const f0Init = this.dashboardService.currentFilter;
      this.fetchDailyOutputRate({
        cluster:  hfb0?.cluster  || undefined,
        site:     hfb0?.site     || undefined,
        wellId:   hfb0?.well ? hfb0.well.split('-').pop() : undefined,
        location: hfb0?.location || undefined,
        project:  hfb0?.project  || undefined,
        from:     f0Init.startDate || hfb0?.startDate || undefined,
        to:       f0Init.endDate   || hfb0?.endDate   || undefined,
      });
      // Expose bridge so wfb widget filter can trigger re-fetch from plain JS
      (window as any).__fetchDailyOutputRate = (ov: any) => {
        const hfb = (window as any).hfbState;
        const fCur = this.dashboardService.currentFilter;
        if (!ov) {
          this.fetchDailyOutputRate({ cluster: hfb?.cluster, site: hfb?.site, wellId: hfb?.well ? hfb.well.split('-').pop() : undefined, location: hfb?.location, project: hfb?.project || undefined, from: fCur.startDate || hfb?.startDate, to: fCur.endDate || hfb?.endDate });
        } else if (ov.mode === 'cluster') {
          this.fetchDailyOutputRate({ cluster: ov.cluster });
        } else if (ov.mode === 'well') {
          this.fetchDailyOutputRate({ cluster: ov.cluster, wellId: ov.well ? ov.well.split('-').pop() : undefined });
        } else if (ov.mode === 'date') {
          this.fetchDailyOutputRate({ from: ov.dateFrom, to: ov.dateTo });
        }
      };
      // Subscribe to global HFB filter changes
      this.filterSub = this.dashboardService.filter$.pipe(skip(1)).subscribe((f: HfbFilter) => {
        this.fetchDailyOutputRate({ cluster: f.cluster, site: f.site || undefined, wellId: f.wellId, location: f.location || undefined, project: f.project || undefined, from: f.startDate || undefined, to: f.endDate || undefined });
        // Re-fetch KPI + chart so the "Planned vs Actual" series reflects the new date range.
        this.loadWellExecKpi();
        // Re-fetch the Crew PI heatmap so it honours the new date range (e.g. Last 30 Days).
        this.loadCrewPiHeatmap();
        // Re-filter the Activity Gantt's well list against the new cluster / well-type
        // / well-id filters so the dropdown only shows the matching wells.
        this.loadClusterWells();
        // Re-fetch Critical Dates Timeline with new filters
        this.cdtSub?.unsubscribe();
        this.cdtSub = this.dashboardService.getCriticalDatesTimeline(
          1, 200,
          f.startDate  || undefined,
          f.endDate    || undefined,
          f.cluster    || undefined,
          f.site       || undefined,
          f.wellId     || undefined,
          f.location   || undefined
        ).subscribe({
          next: (page) => {
            (window as any)['__cdtApiRows__'] = page.items.map((item: CriticalDateTimelineItem) => ({
              wellId:       item.wellId,
              stage:        item.stageItem,
              owner:        item.assignee || '',
              dateLabel:    item.dateLabel,
              dateIso:      item.dateLabel,
              actualIso:    item.dateType === 'Actual'   ? item.dateLabel : null,
              forecastIso:  item.dateType === 'Forecast' ? item.dateLabel : null,
              plannedIso:   null,
              type:         item.type,
              status:       item.status === 'Completed' ? 'done'
                          : item.status === 'Overdue'   ? 'overdue'
                          : 'upcoming',
              progress:     item.progressPct,
              varDays:      item.varianceDays ?? 0,
              blockers:     0,
              predecessor:  item.predecessor || '—',
              predName:     null,
              predActivity: '',
              predStatus:   'planned',
              predProgress: 0
            }));
            const render = (window as any)['renderDashCritDatesGrid'];
            if (typeof render === 'function') render();
            const countEl = document.getElementById('dashCdtCount');
            if (countEl) countEl.textContent = page.items.length + ' milestones' + (page.hasMore ? '+' : '');
          },
          error: (err) => console.warn('[wellexecution] critical-dates-timeline filter error:', err.message || err)
        });
        // Re-fetch the Target Finish Timeline so it reflects the new cluster / well-type / well-id.
        this.loadTargetFinishTimeline();
      });
      // Load CDT data from API then render the grid
      this.cdtSub?.unsubscribe();
      this.cdtSub = this.dashboardService.getCriticalDatesTimeline(
        1, 200,
        f0Init.startDate || undefined,
        f0Init.endDate   || undefined,
        hfb0?.cluster    || undefined,
        hfb0?.site       || undefined,
        hfb0?.well ? hfb0.well.split('-').pop() : undefined,
        hfb0?.location   || undefined
      ).subscribe({
        next: (page) => {
          (window as any)['__cdtApiRows__'] = page.items.map((item: CriticalDateTimelineItem) => ({
            wellId:       item.wellId,
            stage:        item.stageItem,
            owner:        item.assignee || '',
            dateLabel:    item.dateLabel,
            dateIso:      item.dateLabel,
            actualIso:    item.dateType === 'Actual'   ? item.dateLabel : null,
            forecastIso:  item.dateType === 'Forecast' ? item.dateLabel : null,
            plannedIso:   null,
            type:         item.type,
            status:       item.status === 'Completed' ? 'done'
                        : item.status === 'Overdue'   ? 'overdue'
                        : 'upcoming',
            progress:     item.progressPct,
            varDays:      item.varianceDays ?? 0,
            blockers:     0,
            predecessor:  item.predecessor || '—',
            predName:     null,
            predActivity: '',
            predStatus:   'planned',
            predProgress: 0
          }));
          const render = (window as any)['renderDashCritDatesGrid'];
          if (typeof render === 'function') render();
          // Update milestone count badge (matches cmdoverview behaviour)
          const countEl = document.getElementById('dashCdtCount');
          if (countEl) countEl.textContent = page.items.length + ' milestones' + (page.hasMore ? '+' : '');
        },
        error: (err) => console.warn('[wellexecution] critical-dates-timeline error:', err.message || err)
      });
      // Also attempt an immediate render in case cached rows already exist
      if (typeof (window as any).renderDashCritDatesGrid === 'function') {
        requestAnimationFrame(() => (window as any).renderDashCritDatesGrid());
      }
    }, 300);
  }

  private fetchDailyOutputRate(filters?: { cluster?: string; site?: string; wellId?: string; location?: string; project?: string; from?: string; to?: string }): void {
    this.dailyOutputSub?.unsubscribe();
    this.dailyOutputSub = this.dashboardService.getDailyOutputRate(filters).subscribe({
      next: (data: DailyOutputRate) => {
        (window as any).__dailyOutputData = data;
        const render = (window as any).renderDailyOutputTrend;
        if (typeof render === 'function') render(data);
      },
      error: (err) => console.warn('[wellexecution] daily-output-rate error:', err?.message || err)
    });
  }

  // ─── Daily Output Rate DQ scoring ───────────────────────────────────────────
  // Mirrors the same issues defined in openDailyOutputInfo() — severity drives
  // the per-table score and the badge auto-computes as the average.
  private readonly DAILY_OUTPUT_DQ_TABLES: Array<{ issues: Array<{ severity: string }> }> = [
    { // dbo.task_daily
      issues: [
        { severity: 'High' },    // data_hours: NVARCHAR → FLOAT cast silently nulls
        { severity: 'High' },    // required: NVARCHAR → FLOAT cast silently nulls
        { severity: 'Medium' },  // ActionOn: No standardization / time truncation
        { severity: 'High' },    // well_id: FK missing — rows dropped on filter
        { severity: 'Medium' },  // data_hours/required: Null/zero rows excluded
      ]
    },
    { // dbo.WMR
      issues: [
        { severity: 'High' },    // pdo_well_id: FK missing — wells excluded on filter
        { severity: 'High' },    // project_id: NVARCHAR type mismatch
      ]
    },
    { // dbo.ProjectIDs
      issues: [
        { severity: 'High' },    // ID: Data type mismatch — rows silently excluded
        { severity: 'Medium' },  // Cluster/Site/Type/Project: No standardization
      ]
    }
  ];

  private weDqTableScore(issues: Array<{ severity: string }>): number {
    // Matches well-detail-live.js wdTableReliability() weights exactly:
    // High=18, Medium=10, Low=4, floor=0
    const penalty = issues.reduce((s, i) =>
      s + (i.severity === 'High' ? 18 : i.severity === 'Medium' ? 10 : 4), 0);
    return Math.max(0, 100 - penalty);
  }

  dailyOutputDqScore(): number {
    const avg = this.DAILY_OUTPUT_DQ_TABLES.reduce((s, t) => s + this.weDqTableScore(t.issues), 0)
                / this.DAILY_OUTPUT_DQ_TABLES.length;
    return Math.round(avg);
  }

  dailyOutputDqScoreColor(): string {
    const r = this.dailyOutputDqScore();
    return r >= 90 ? '#2e9e5b' : r >= 70 ? '#f5a623' : '#d9534f';
  }

  openDailyOutputInfo(): void {
    const show = (window as any).wdWidgetInfoShowData;
    if (typeof show !== 'function') return;
    show({
      title: 'Daily Output Rate Trend',
      summary: 'Actual vs Asking Rate per day from GET /dashboard/daily-output-rate. ' +
               'Each point is AVG(data_hours) for Actual Rate and AVG(required) for Asking Rate ' +
               'from dbo.task_daily, grouped by ActionOn date. ' +
               'Filters: cluster, site, wellId, location, project, from, to.',
      tables: [
        {
          table: 'dbo.task_daily',
          issues: [
            { field: 'data_hours', category: 'Data Type Mismatch',
              detail: 'Stored as NVARCHAR — CAST to FLOAT required. Invalid values silently become NULL and are excluded from AVG(), lowering the Actual Rate for that day without any warning.' },
            { field: 'required', category: 'Data Type Mismatch',
              detail: 'Stored as NVARCHAR — CAST to FLOAT required. Cast failures produce NULL, excluded from AVG(), so the Asking Rate for that day is underestimated or missing entirely.' },
            { field: 'ActionOn', category: 'No Standardization',
              detail: 'Used as the grouping date. Rows where ActionOn is NULL or outside the from/to range are excluded. If ActionOn contains time components they are truncated via CAST(ActionOn AS DATE) — inconsistent time values are silently collapsed.' },
            { field: 'well_id', category: 'Foreign Key',
              detail: 'Joined to WMR.pdo_well_id via direct equality for wellId filter. No formal FK — case or whitespace differences between task_daily.well_id and WMR.pdo_well_id cause rows to be dropped when the wellId filter is applied.' },
            { field: 'data_hours, required', category: 'Null Values',
              detail: 'Only rows where data_hours IS NOT NULL AND data_hours > 0 are included. Rows with zero or null data_hours are filtered out — days with genuinely zero output are invisible on the chart.' }
          ]
        },
        {
          table: 'dbo.WMR',
          issues: [
            { field: 'pdo_well_id', category: 'Foreign Key',
              detail: 'Used in IN subquery to resolve cluster/site/location/project filters to a set of well_ids for task_daily. No FK exists — wells in task_daily that lack a WMR record are always excluded when any of these filters are active.' },
            { field: 'project_id', category: 'Data Type Mismatch',
              detail: 'NVARCHAR — joined to ProjectIDs.ID via CAST(ID AS NVARCHAR(100)). Type mismatch silently drops wells that have no matching ProjectIDs row, narrowing the result set.' }
          ]
        },
        {
          table: 'dbo.ProjectIDs',
          issues: [
            { field: 'ID', category: 'Data Type Mismatch',
              detail: 'Numeric ID joined to WMR.project_id via CAST(ID AS NVARCHAR(100)). Mismatched rows are silently excluded — wells are missing from cluster/site/project filtered views.' },
            { field: 'Cluster, Site, Type, Project', category: 'No Standardization',
              detail: 'LTRIM/RTRIM applied to all filter columns. Trailing/leading spaces still present in the DB cause equality mismatches if not trimmed, resulting in 0 results for valid filter values.' }
          ]
        }
      ]
    });
  }

  ngOnDestroy(): void {
    this.dailyOutputSub?.unsubscribe();
    this.cdtSub?.unsubscribe();
    this.kpiSub?.unsubscribe();
    this.activityGanttSub?.unsubscribe();
    this.clusterWellsSub?.unsubscribe();
    this.wellStagesSubs.forEach(s => { try { s.unsubscribe(); } catch (_) {} });
    this.wellStagesSubs.clear();
    this.filterSub?.unsubscribe();
    this.crewPiSub?.unsubscribe();
    this.targetFinishSub?.unsubscribe();
    delete (window as any).__fetchDailyOutputRate;
    this.charts.forEach(c => { try { c.destroy(); } catch (_) {} });
    if (this.delayedGrid) { try { this.delayedGrid.destroy(); } catch (_) {} }
  }

  getVarianceClass(v: number): string {
    return v < 0 ? 'jp2-var--neg' : v > 0 ? 'jp2-var--pos' : '';
  }

  private parseDate(s: string): Date {
    const [d, m, y] = s.split(' ');
    const months: Record<string, number> = {
      Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11
    };
    return new Date(parseInt(y), months[m], parseInt(d));
  }

  /** Today at local midnight — the anchor for the Target Finish Timeline's status buckets. */
  private timelineToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private buildGanttRows(): void {
    const start = this.timelineToday();
    const total = this.ganttTotalDays;

    this.ganttRows = this.timelineJobs.map(j => {
      const td = j.targetEnd ? this.parseDate(j.targetEnd) : null;
      const valid = td !== null && !isNaN(td.getTime());
      const daysFromStart = valid ? Math.round((td!.getTime() - start.getTime()) / 86400000) : NaN;

      let type: 'overdue' | 'within30' | 'within60' | 'after60';
      let label: string;
      if (!valid) {
        type = 'after60'; label = 'No target';
      } else if (daysFromStart < 0) {
        type = 'overdue'; label = 'Overdue';
      } else if (daysFromStart <= 30) {
        type = 'within30';
        label = daysFromStart <= 0 ? 'Due today' : `Due in ${daysFromStart} day${daysFromStart === 1 ? '' : 's'}`;
      } else if (daysFromStart <= 60) {
        type = 'within60';
        label = `Due in ${daysFromStart} days`;
      } else {
        type = 'after60'; label = 'Due after 60 days';
      }

      // Bar pct: for overdue/invalid → 0 (no forward bar), for future → clamp to 100
      const barPct = (!valid || daysFromStart < 0) ? 0 : Math.min(100, (daysFromStart / total) * 100);

      return { wellId: j.wellId, category: j.category, progress: j.actual + '%', type, label, barPct };
    });
  }

  // ── Chart builders ────────────────────────────────────────────────────────

  private buildWeeklyTrendChart(): void {
    const el = this.weeklyTrendRef?.nativeElement;
    const Highcharts = (window as any).Highcharts;
    if (!el || !Highcharts) return;

    const categories = [
      'Week 1<br/>27 Apr–03 May',
      'Week 2<br/>04 May–10 May',
      'Week 3<br/>11 May–17 May',
      'Week 4<br/>18 May–24 May',
      'Week 5<br/>25 May–31 May'
    ];
    const planData     = [9.47,  11.91, 46.97, 40.94, 1.29];
    const actualData   = [9.99,   7.19, 27.50, 29.06, 0.00];
    const varianceData = [-0.38, -4.72, -19.47, -11.88, -1.29];

    const chart = Highcharts.chart(el, {
      chart: { backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: {
        align: 'center',
        verticalAlign: 'bottom',
        layout: 'horizontal',
        itemStyle: { fontSize: '9px', fontWeight: '500' },
        symbolHeight: 10,
        symbolWidth: 10,
        symbolRadius: 2,
        margin: 12
      },
      xAxis: {
        categories,
        labels: { style: { fontSize: '7.5px' }, useHTML: true },
        lineColor: 'rgba(0,0,0,0.08)',
        tickColor: 'rgba(0,0,0,0.08)'
      },
      yAxis: {
        min: -40,
        max: 80,
        tickInterval: 20,
        title: { text: undefined },
        labels: { format: '{value}%', style: { fontSize: '8.5px' } },
        gridLineColor: 'rgba(0,0,0,0.06)',
        plotLines: [{ value: 0, color: 'rgba(0,0,0,0.18)', width: 1, zIndex: 3 }]
      },
      tooltip: {
        shared: true,
        useHTML: true,
        pointFormat: '<span style="color:{series.color}">●</span> {series.name}: <b>{point.y}%</b><br/>'
      },
      plotOptions: {
        column: {
          grouping: true,
          pointPadding: 0.08,
          groupPadding: 0.14,
          borderWidth: 0
        },
        line: {
          marker: {
            radius: 4,
            fillColor: '#fff',
            lineWidth: 2,
            lineColor: '#FF0000'
          },
          dataLabels: {
            enabled: true,
            format: '{point.y}%',
            style: { color: '#FF0000', fontSize: '8px', fontWeight: 'bold', textOutline: 'none' },
            y: -6
          }
        }
      },
      series: [
        { type: 'column', name: 'Plan %',     data: planData,     color: '#29378d' },
        { type: 'column', name: 'Actual %',   data: actualData,   color: '#00B050' },
        { type: 'line',   name: 'Variance %', data: varianceData, color: '#FF0000', lineWidth: 2 }
      ]
    });
    this.charts.push(chart);
  }

  private buildSCurveChart(): void {
    const el = this.sCurveRef?.nativeElement;
    const Highcharts = (window as any).Highcharts;
    if (!el || !Highcharts) return;

    const categories = [
      'Week 1<br/>27 Apr–03 May',
      'Week 2<br/>04 May–10 May',
      'Week 3<br/>11 May–17 May',
      'Week 4<br/>18 May–24 May',
      'Week 5<br/>25 May–31 May'
    ];
    const cumPlan   = [9.47,  21.38,  68.36, 109.39, 110.59];
    const cumActual = [9.09,  16.28,  43.78, 113.78, 113.78];

    const chart = Highcharts.chart(el, {
      chart: { type: 'areaspline', backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: {
        align: 'center',
        verticalAlign: 'bottom',
        layout: 'horizontal',
        itemStyle: { fontSize: '9px', fontWeight: '500' },
        symbolHeight: 10,
        symbolWidth: 10,
        symbolRadius: 2,
        margin: 12
      },
      xAxis: {
        categories,
        labels: { style: { fontSize: '7.5px' }, useHTML: true },
        lineColor: 'rgba(0,0,0,0.08)',
        tickColor: 'rgba(0,0,0,0.08)'
      },
      yAxis: {
        min: 0,
        max: 120,
        tickInterval: 20,
        title: { text: undefined },
        labels: { format: '{value}%', style: { fontSize: '8.5px' } },
        gridLineColor: 'rgba(0,0,0,0.06)'
      },
      tooltip: {
        shared: true,
        useHTML: true,
        pointFormat: '<span style="color:{series.color}">●</span> {series.name}: <b>{point.y}%</b><br/>'
      },
      plotOptions: {
        areaspline: {
          fillOpacity: 0.10,
          lineWidth: 2.5,
          marker: {
            radius: 5,
            fillColor: '#fff',
            lineWidth: 2,
            symbol: 'circle'
          },
          dataLabels: {
            enabled: true,
            format: '{point.y}%',
            style: { fontSize: '8px', fontWeight: 'bold', textOutline: 'none' },
            y: -8
          }
        }
      },
      series: [
        { name: 'Cumulative Plan %',   data: cumPlan,   color: '#29378d', marker: { lineColor: '#29378d' }, dataLabels: { color: '#29378d' } },
        { name: 'Cumulative Actual %', data: cumActual, color: '#00B050', marker: { lineColor: '#00B050' }, dataLabels: { color: '#00B050' } }
      ]
    });
    this.charts.push(chart);
  }

  private buildCategoryBarChart(): void {
    const el = this.categoryBarRef?.nativeElement;
    const Highcharts = (window as any).Highcharts;
    if (!el || !Highcharts) return;

    const categories = this.categoryBars.map(c => c.name);
    const planData   = this.categoryBars.map(c => c.plan);
    const actualData = this.categoryBars.map(c => c.actual);

    const chart = Highcharts.chart(el, {
      chart: { type: 'bar', backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: {
        align: 'center',
        verticalAlign: 'bottom',
        layout: 'horizontal',
        itemStyle: { fontSize: '9px', fontWeight: '500' },
        symbolHeight: 10,
        symbolWidth: 10,
        symbolRadius: 2,
        margin: 12
      },
      xAxis: {
        categories,
        labels: { style: { fontSize: '9px', fontWeight: '600' } },
        lineColor: 'rgba(0,0,0,0.08)',
        tickColor: 'rgba(0,0,0,0.08)'
      },
      yAxis: {
        min: 0,
        max: this.catAxisMax,
        tickInterval: 10,
        title: { text: undefined },
        labels: { format: '{value}%', style: { fontSize: '8.5px' } },
        gridLineColor: 'rgba(0,0,0,0.06)'
      },
      tooltip: {
        shared: true,
        useHTML: true,
        pointFormat: '<span style="color:{series.color}">●</span> {series.name}: <b>{point.y}%</b><br/>'
      },
      plotOptions: {
        bar: {
          borderWidth: 0,
          borderRadius: 3,
          groupPadding: 0.12,
          pointPadding: 0.06,
          dataLabels: {
            enabled: true,
            format: '{point.y}%',
            style: { fontSize: '8.5px', fontWeight: 'bold', textOutline: 'none' }
          }
        }
      },
      series: [
        { type: 'bar', name: 'Plan %',   data: planData,   color: '#29378d' },
        { type: 'bar', name: 'Actual %', data: actualData, color: '#00B050' }
      ]
    });
    this.charts.push(chart);
  }

  private buildRevPhysChart(): void {
    const el = this.revPhysRef?.nativeElement;
    const Highcharts = (window as any).Highcharts;
    if (!el || !Highcharts) return;

    const categories = [
      'Week 1<br/>27 Apr–03 May',
      'Week 2<br/>04 May–10 May',
      'Week 3<br/>11 May–17 May',
      'Week 4<br/>18 May–24 May',
      'Week 5<br/>25 May–31 May'
    ];
    const revData  = [0.10, 0.19, 0.48, 0.80, 0.96];
    const physData = [9.09, 16.28, 43.78, 113.78, 113.78];

    const chart = Highcharts.chart(el, {
      chart: { type: 'areaspline', backgroundColor: 'transparent', spacing: [10, 10, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: {
        align: 'center',
        verticalAlign: 'bottom',
        layout: 'horizontal',
        itemStyle: { fontSize: '9px', fontWeight: '500' },
        symbolHeight: 10,
        symbolWidth: 10,
        symbolRadius: 2,
        margin: 12
      },
      xAxis: {
        categories,
        labels: { style: { fontSize: '7.5px' }, useHTML: true },
        lineColor: 'rgba(0,0,0,0.08)',
        tickColor: 'rgba(0,0,0,0.08)'
      },
      yAxis: [
        {
          min: 0, max: 14, tickInterval: 2,
          title: { text: undefined },
          labels: { format: '{value}M', style: { fontSize: '8.5px' } },
          gridLineColor: 'rgba(0,0,0,0.06)'
        },
        {
          min: 0, max: 140, tickInterval: 20,
          title: { text: undefined },
          labels: { format: '{value}%', style: { fontSize: '8.5px' } },
          opposite: true,
          gridLineWidth: 0
        }
      ],
      tooltip: {
        shared: true,
        useHTML: true,
        formatter: function(this: any) {
          let html = '<b>' + this.x.replace('<br/>', ' ') + '</b><br/>';
          this.points.forEach((p: any) => {
            const suffix = p.series.options.yAxis === 1 ? '%' : 'M';
            html += '<span style="color:' + p.series.color + '">●</span> ' + p.series.name + ': <b>' + p.y + suffix + '</b><br/>';
          });
          return html;
        }
      },
      plotOptions: {
        areaspline: {
          fillOpacity: 0.10,
          lineWidth: 2.5,
          marker: { radius: 5, fillColor: '#fff', lineWidth: 2, symbol: 'circle' }
        }
      },
      series: [
        {
          name: 'Revenue Achieved (M)', data: revData, color: '#00B0F0', yAxis: 0,
          marker: { lineColor: '#00B0F0' },
          dataLabels: {
            enabled: true,
            format: '{point.y}M',
            style: { color: '#00B0F0', fontSize: '8px', fontWeight: 'bold', textOutline: 'none' },
            y: -8
          }
        },
        {
          name: 'Cumulative Actual Progress %', data: physData, color: '#00B050', yAxis: 1,
          marker: { lineColor: '#00B050' },
          dataLabels: {
            enabled: true,
            format: '{point.y}%',
            style: { color: '#00B050', fontSize: '8px', fontWeight: 'bold', textOutline: 'none' },
            y: -8
          }
        }
      ]
    });
    this.charts.push(chart);
  }

  private buildWexecParChart(): void {
    // Don't gate on kpiLoading — this function is only called once data is in hand
    // (success path of loadWellExecKpi / loadWellExecChartOnly). Gating here was
    // silently dropping the Day/Month chart rebuild when a parallel load (HFB filter,
    // initial fetch) still had kpiLoading=true.
    const el = this.wexecParRef?.nativeElement;
    const Highcharts = (window as any).Highcharts;
    if (!el || !Highcharts) return;

    // Drop any prior instance so toggling Day/Week/Month doesn't stack charts
    const prior = this.charts.find(c => c && c.renderTo === el);
    if (prior) {
      this.charts = this.charts.filter(c => c !== prior);
      try { prior.destroy(); } catch (_) {}
    }

    // ── Resolve data: use live API data if available, else hardcoded fallback ──
    let categories: string[];
    let plannedPct: (number | null)[];
    let actualPct:  (number | null)[];
    let plannedRev: (number | null)[];
    let actualRev:  (number | null)[];

    if (this.wexecChartData && this.wexecChartData.length > 0) {
      categories = this.wexecChartData.map(p => p.label);
      plannedPct = this.wexecChartData.map(p => p.plannedPct);
      actualPct  = this.wexecChartData.map(p => p.actualPct);
      plannedRev = this.wexecChartData.map(p => p.plannedRevM);
      actualRev  = this.wexecChartData.map(p => p.actualRevM);
    } else {
      // hardcoded fallback
      categories = [
        '20 Apr \'26','27 Apr \'26','04 May \'26','11 May \'26','18 May \'26','25 May \'26',
        '01 Jun \'26','08 Jun \'26','15 Jun \'26','22 Jun \'26','29 Jun \'26','06 Jul \'26'
      ];
      plannedPct = [8, 15, 23, 32, 40, 48, 56, 64, 72, 80, 90, 100];
      actualPct  = [5, 11, 17, 26, 33, 43, 47, 57, 70, null, null, null];
      plannedRev = [0.60, 1.20, 1.95, 2.85, 3.85, 4.90, 6.10, 7.35, 8.75, 10.20, 11.35, 12.45];
      actualRev  = [0.35, 0.70, 1.10, 1.60, 2.20, 3.10, 3.95, 4.80, 5.70, 6.65, 7.50, 8.32];
    }

    // ── Compute variance band ──────────────────────────────────────────────
    const varianceBand: ([number, number] | [null, null])[] = plannedPct.map((p, i) => {
      const a = actualPct[i];
      if (p === null || a === null) return [null, null];
      return [Math.min(p, a), Math.max(p, a)];
    });

    // ── Milestones: map to x-axis index by closest category date ─────────
    const defaultMilestones = [
      { x: 0, name: 'Rig Move In' },
      { x: 3, name: 'FLAF' },
      { x: 6, name: 'Flowline Complete' },
      { x: 8, name: 'Hook-Up' },
      { x: 10, name: 'Commissioning' }
    ];

    let milestones = defaultMilestones;
    if (this.wexecMilestones && this.wexecMilestones.length > 0) {
      milestones = this.wexecMilestones.map((m, i) => ({ x: i * 2, name: m.name }));
    }

    const chart = Highcharts.chart(el, {
      chart: { zoomType: 'x', backgroundColor: 'transparent', spacing: [40, 16, 10, 10] },
      title: { text: undefined },
      credits: { enabled: false },
      legend: {
        align: 'center',
        verticalAlign: 'bottom',
        layout: 'horizontal',
        itemStyle: { fontSize: '9px', fontWeight: '500' },
        symbolHeight: 10,
        symbolWidth: 10,
        symbolRadius: 2,
        margin: 12
      },
      xAxis: {
        categories,
        labels: { style: { fontSize: '8px' } },
        lineColor: 'rgba(0,0,0,0.08)',
        tickColor: 'rgba(0,0,0,0.08)',
        plotLines: milestones.map(m => ({
          value: m.x,
          color: 'rgba(100, 116, 139, 0.35)',
          dashStyle: 'Dash',
          width: 1,
          zIndex: 2,
          label: {
            text: '◆ ' + m.name,
            rotation: 0,
            y: -16,
            x: 0,
            align: 'center',
            style: { color: '#475569', fontSize: '8.5px', fontWeight: '600' }
          }
        }))
      },
      yAxis: [
        {
          min: 0, max: 100, tickInterval: 20,
          title: { text: 'Progress (%)', style: { fontSize: '8.5px', color: '#64748b' } },
          labels: { format: '{value}%', style: { fontSize: '8px' } },
          gridLineColor: 'rgba(0,0,0,0.06)'
        },
        {
          min: 0, max: 15, tickInterval: 2.5,
          title: { text: 'Revenue', style: { fontSize: '8.5px', color: '#64748b' } },
          labels: { format: '{value}M', style: { fontSize: '8px' } },
          opposite: true,
          gridLineWidth: 0
        }
      ],
      tooltip: {
        shared: true,
        useHTML: true,
        formatter: function(this: any) {
          let html = '<b>' + this.x + '</b><br/>';
          this.points.forEach((p: any) => {
            if (p.series.type === 'arearange') return;
            const isRev = p.series.options.yAxis === 1;
            const suffix = isRev ? 'M' : '%';
            html += '<span style="color:' + p.series.color + '">●</span> ' + p.series.name + ': <b>' + p.y + suffix + '</b><br/>';
          });
          return html;
        }
      },
      plotOptions: {
        column: {
          grouping: true,
          pointPadding: 0.06,
          groupPadding: 0.15,
          borderWidth: 0,
          borderRadius: 2,
          dataLabels: {
            enabled: true,
            format: '{point.y}M',
            style: { fontSize: '7.5px', fontWeight: 'bold', textOutline: 'none' }
          }
        },
        line: {
          marker: { radius: 3, fillColor: '#fff', lineWidth: 1.5, symbol: 'circle' },
          dataLabels: {
            enabled: true,
            format: '{point.y}%',
            style: { fontSize: '7.5px', fontWeight: 'bold', textOutline: 'none' },
            y: -6
          }
        },
        arearange: {
          enableMouseTracking: false,
          marker: { enabled: false }
        }
      },
      series: [
        {
          type: 'arearange', name: 'Progress Variance', data: varianceBand,
          color: '#C4B5FD', fillOpacity: 0.45, lineWidth: 0, yAxis: 0, zIndex: 1
        },
        {
          type: 'line', name: 'Planned Progress (%)', data: plannedPct, color: '#3B82F6',
          dashStyle: 'Dash', lineWidth: 2, yAxis: 0, zIndex: 3,
          marker: { lineColor: '#3B82F6' },
          dataLabels: { color: '#3B82F6' }
        },
        {
          type: 'line', name: 'Actual Progress (%)', data: actualPct, color: '#00B050',
          lineWidth: 2.5, yAxis: 0, zIndex: 3,
          marker: { lineColor: '#00B050' },
          dataLabels: { color: '#00B050' }
        },
        {
          type: 'column', name: 'Planned Revenue', data: plannedRev,
          color: '#BFDBFE', yAxis: 1, zIndex: 2,
          dataLabels: { color: '#1e40af' }
        },
        {
          type: 'column', name: 'Actual Revenue', data: actualRev,
          color: '#00B050', yAxis: 1, zIndex: 2,
          dataLabels: { color: '#065F46' }
        },
        {
          type: 'scatter', name: 'Milestone', data: [],
          color: '#475569',
          marker: { symbol: 'diamond', radius: 6, fillColor: '#475569', lineWidth: 0 },
          showInLegend: true,
          enableMouseTracking: false,
          events: { legendItemClick: function() { return false; } }
        }
      ]
    });
    this.charts.push(chart);
  }

  private buildActivityGanttChart(): void {
    const el = this.activityGanttRef?.nativeElement;
    const Highcharts = (window as any).Highcharts;
    if (!el || !Highcharts) return;

    // Drop any previous instance so we can rebuild on accordion toggle
    const existing = this.charts.find(c => c && c.renderTo === el);
    if (existing) {
      this.charts = this.charts.filter(c => c !== existing);
      try { existing.destroy(); } catch (_) {}
    }

    const day = (d: number) => Date.UTC(2026, 4, d); // May 2026 — fallback when no real ts present

    const rows = this.visibleWbs;
    // Use absolute timestamps when ANY row carries them (real ATP data), else fall back to May 2026 days.
    const useTs = rows.some(r => r.startTs !== undefined && r.endTs !== undefined);
    const x  = (r: any) => useTs ? (r.startTs ?? r.endTs ?? Date.now()) : day(r.startDay);
    const x2 = (r: any) => useTs ? (r.endTs   ?? r.startTs ?? Date.now()) : day(r.endDay);

    const categories = rows.map(r => {
      if (r.isWell) return r.name;
      return r.level > 0 ? '   ' + r.id + ' ' + r.name : r.id + '. ' + r.name;
    });
    const data = rows.map((r, i) => ({
      x:  x(r),
      x2: x2(r),
      y: i,
      partialFill: r.pct,
      color: r.color,
      name: r.name
    }));

    const today = useTs ? Date.now() : day(20);

    // Dynamic axis range when using real timestamps; otherwise keep the May window.
    let axisMin = day(1);
    let axisMax = day(27);
    if (useTs) {
      // Use the 5th–95th percentile of start dates rather than absolute min/max so a
      // single far-out milestone (e.g. multi-year-away end date) doesn't compress the
      // whole gantt into a sliver. Outliers still render but get clipped at the edges.
      const starts: number[] = [];
      for (const r of rows) if (r.startTs !== undefined) starts.push(r.startTs);
      if (starts.length > 0) {
        starts.sort((a, b) => a - b);
        const pick = (p: number) => starts[Math.min(starts.length - 1, Math.max(0, Math.floor(p * (starts.length - 1))))];
        const p05 = pick(0.05);
        const p95 = pick(0.95);
        const dayMs = 24 * 3600 * 1000;
        // Pad each side by ~5% of the visible range, clamped to a sensible min/max.
        const span = Math.max(p95 - p05, 7 * dayMs);
        const pad  = Math.min(30 * dayMs, Math.max(3 * dayMs, span * 0.05));
        axisMin = p05 - pad;
        axisMax = p95 + pad;
        // Keep "Today" visible when it's reasonably close to the data — improves readability.
        const now = Date.now();
        if (now >= p05 - 90 * dayMs && now <= p95 + 90 * dayMs) {
          if (now < axisMin) axisMin = now - pad;
          if (now > axisMax) axisMax = now + pad;
        }
      }
    }
    const HEADER = 60;
    const FOOTER = 4;
    const ROW = 36;
    const height = HEADER + FOOTER + rows.length * ROW;

    const chart = Highcharts.chart(el, {
      chart: {
        type: 'xrange',
        backgroundColor: 'transparent',
        height,
        spacingTop: HEADER,
        spacingBottom: FOOTER,
        spacingLeft: 0,
        spacingRight: 8
      },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        type: 'datetime',
        min: axisMin,
        max: axisMax,
        opposite: true,
        // Day ticks for short windows, auto-bucketed once the window stretches beyond ~2 months.
        tickInterval: (axisMax - axisMin) > 60 * 24 * 3600 * 1000 ? undefined : 24 * 3600 * 1000,
        labels: {
          format: (axisMax - axisMin) > 60 * 24 * 3600 * 1000 ? '{value:%b %y}' : '{value:%d %b}',
          style: { fontSize: '8.5px' }
        },
        gridLineWidth: 1,
        gridLineColor: 'rgba(0,0,0,0.05)',
        plotLines: [
          {
            value: today,
            color: '#29378d',
            width: 2,
            zIndex: 5,
            label: {
              text: 'Today',
              align: 'center',
              y: -4,
              style: { color: '#fff', background: '#29378d', fontSize: '8.5px', fontWeight: '700' }
            }
          }
        ]
      },
      yAxis: {
        categories,
        reversed: true,
        title: { text: undefined },
        labels: { enabled: false },
        gridLineColor: 'rgba(0,0,0,0.05)',
        lineWidth: 0,
        tickWidth: 0
      },
      tooltip: {
        useHTML: true,
        formatter: function(this: any) {
          const start = Highcharts.dateFormat('%e %b', this.point.x);
          const end = Highcharts.dateFormat('%e %b', this.point.x2);
          const pct = Math.round((this.point.partialFill || 0) * 100);
          return `<b>${this.point.name}</b><br/>${start} → ${end}<br/>Progress: <b>${pct}%</b>`;
        }
      },
      plotOptions: {
        xrange: {
          borderRadius: 6,
          borderWidth: 0,
          pointPadding: 0.15,
          groupPadding: 0,
          dataLabels: {
            enabled: true,
            inside: false,
            align: 'right',
            formatter: function(this: any) {
              return Math.round((this.point.partialFill || 0) * 100) + '%';
            },
            style: { fontSize: '8.5px', fontWeight: '700', textOutline: 'none' },
            x: 32
          }
        }
      },
      series: [{
        name: 'Activities',
        pointWidth: 14,
        data
      }]
    });
    this.charts.push(chart);
  }

  private buildTargetFinishChart(): void {
    const el = this.targetFinishRef?.nativeElement;
    const Highcharts = (window as any).Highcharts;
    if (!el || !Highcharts) return;

    // Drop any prior instance
    const prior = this.charts.find(c => c && c.renderTo === el);
    if (prior) {
      this.charts = this.charts.filter(c => c !== prior);
      try { prior.destroy(); } catch (_) {}
    }

    const today = this.timelineToday().getTime();
    const day = 24 * 3600 * 1000;
    const colors: Record<string, string> = {
      overdue:  '#FF0000',
      within30: '#FFC000',
      within60: '#00B050',
      after60:  '#29378d'
    };

    const jobs = this.timelineJobs;
    const categories = this.ganttRows.map(r => r.wellId);
    const data = this.ganttRows.map((r, i) => {
      const parsed = jobs[i]?.targetEnd ? this.parseDate(jobs[i].targetEnd).getTime() : NaN;
      const isOverdue = r.type === 'overdue';
      let x: number, x2: number;
      if (isOverdue) {
        x = today - 6 * day;
        x2 = today;
      } else {
        x = today;
        const minEnd = today + 1.5 * day;
        x2 = isNaN(parsed) ? minEnd : Math.max(parsed, minEnd);
      }
      const baseColor = colors[r.type] || '#9CA3AF';
      return {
        x, x2, y: i,
        // Overdue items use a soft tint with a colored border (matches screenshot style)
        color: isOverdue ? 'rgba(255, 0, 0, 0.12)' : baseColor,
        borderColor: isOverdue ? '#FF0000' : 'transparent',
        borderWidth: isOverdue ? 1 : 0,
        textColor: isOverdue ? '#B91C1C' : '#fff',
        name: r.wellId,
        label: r.label
      };
    });

    // Explicit axis range so bars proportion correctly regardless of container width at init.
    // Guard against an empty result set (Math.max(...[]) === -Infinity).
    const xMin = today - 7 * day;
    const xMax = (data.length ? Math.max(...data.map(d => d.x2)) : today + 60 * day) + 2 * day;

    // These MUST match the left table's CSS so bars line up with their well-ID rows:
    //   HEADER = .jp2__gantt-col-head height (44px), ROW = .jp2__gantt-row-left height (34px),
    //   FOOTER = 0 (the left table has no footer). Mismatched values make the bars drift onto
    //   a different line than their label.
    const HEADER = 44;
    const FOOTER = 0;
    const ROW = 34;
    const height = HEADER + FOOTER + this.ganttRows.length * ROW;

    // Month plotBands generated dynamically across [xMin, xMax] (alternating tint), so the
    // header months track the live data range instead of the old hardcoded May–Jul 2025.
    const monthBands: any[] = [];
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    {
      const first = new Date(xMin); first.setDate(1); first.setHours(0, 0, 0, 0);
      let cursor = new Date(first);
      let idx = 0;
      while (cursor.getTime() <= xMax) {
        const from = cursor.getTime();
        const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        monthBands.push({
          from,
          to: next.getTime(),
          color: idx % 2 === 0 ? 'rgba(0,0,0,0.025)' : 'rgba(0,0,0,0)',
          label: {
            text: `${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`,
            verticalAlign: 'top', y: -28, align: 'center',
            style: { fontSize: '9.5px', fontWeight: '700', color: '#1e293b' }
          }
        });
        cursor = next;
        idx++;
      }
    }

    const chart = Highcharts.chart(el, {
      chart: {
        type: 'xrange',
        backgroundColor: 'transparent',
        height,
        spacingTop: HEADER,
        spacingBottom: FOOTER,
        spacingLeft: 0,
        spacingRight: 8
      },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        type: 'datetime',
        opposite: true,
        min: xMin,
        max: xMax,
        tickInterval: 2 * 24 * 3600 * 1000,
        labels: {
          format: '{value:%e}',
          style: { fontSize: '8px', color: '#94a3b8', fontWeight: '500' }
        },
        gridLineWidth: 1,
        gridLineColor: 'rgba(0,0,0,0.04)',
        dateTimeLabelFormats: { day: '%e', week: '%e %b', month: '%b %Y' },
        plotBands: monthBands,
        plotLines: []
      },
      yAxis: {
        categories,
        reversed: true,
        title: { text: undefined },
        labels: { enabled: false },
        gridLineColor: 'rgba(0,0,0,0.05)',
        lineWidth: 0,
        tickWidth: 0,
        alternateGridColor: 'rgba(0,0,0,0.015)'
      },
      tooltip: {
        useHTML: true,
        formatter: function(this: any) {
          const start = Highcharts.dateFormat('%e %b %Y', this.point.x);
          const end = Highcharts.dateFormat('%e %b %Y', this.point.x2);
          return `<b>${this.point.name}</b><br/>${this.point.label}<br/>${start} → ${end}`;
        }
      },
      plotOptions: {
        xrange: {
          borderRadius: 4,
          minPointLength: 50,
          dataLabels: {
            enabled: true,
            useHTML: true,
            inside: true,
            align: 'left',
            verticalAlign: 'middle',
            crop: false,
            overflow: 'allow',
            formatter: function(this: any) {
              const p = this.point;
              const w = Math.max((p.shapeArgs && p.shapeArgs.width) || 0, 0);
              const innerW = Math.max(w - 12, 20);
              const color = p.textColor || '#fff';
              return `<span style="display:inline-block;width:${innerW}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${color};font-size:8.5px;font-weight:700;line-height:1.2;">${p.label}</span>`;
            },
            x: 6,
            y: 0,
            style: { textOutline: 'none' }
          }
        }
      },
      series: [{
        name: 'Target Finish',
        pointWidth: 14,
        data
      }]
    });
    this.charts.push(chart);
    // Reflow to actual container width once the layout is settled
    setTimeout(() => { try { chart.reflow(); } catch (_) {} }, 50);
  }

  private buildDelayedGrid(): void {
    const gridEl = document.getElementById('jp2DelayedGrid');
    if (!gridEl || typeof agGrid === 'undefined') return;

    const dk = !document.documentElement.classList.contains('navbar-light');
    gridEl.className = (dk ? 'ag-theme-alpine-dark' : 'ag-theme-alpine') + ' jp2__grid';

    const fmt2 = (v: number) => v.toFixed(2) + '%';

    const columnDefs = [
      {
        headerName: 'Well ID', field: 'wellId', flex: 2, minWidth: 180, sortable: true, filter: true,
        cellRenderer: (p: any) =>
          `<span style="font-family:var(--font-family-mono);font-weight:700;color:${dk ? '#00B0F0' : '#29378d'}">${p.value}</span>`
      },
      { headerName: 'Category', field: 'category', flex: 1.5, minWidth: 140, sortable: true, filter: true },
      {
        headerName: 'Plan %', field: 'plan', flex: 1, minWidth: 100, sortable: true,
        filter: 'agNumberColumnFilter', type: 'numericColumn',
        cellRenderer: (p: any) =>
          `<span style="font-family:var(--font-family-mono);font-weight:600">${fmt2(p.value)}</span>`
      },
      {
        headerName: 'Actual %', field: 'actual', flex: 1, minWidth: 100, sortable: true,
        filter: 'agNumberColumnFilter', type: 'numericColumn',
        cellRenderer: (p: any) =>
          `<span style="font-family:var(--font-family-mono);font-weight:600">${fmt2(p.value)}</span>`
      },
      {
        headerName: 'Variance %', field: 'variance', flex: 1, minWidth: 110, sortable: true,
        filter: 'agNumberColumnFilter', type: 'numericColumn',
        cellRenderer: (p: any) => {
          const color = p.value < 0 ? '#FF0000' : p.value > 0 ? '#00B050' : 'var(--txt-1)';
          return `<span style="font-family:var(--font-family-mono);font-weight:700;color:${color}">${fmt2(p.value)}</span>`;
        }
      },
      {
        headerName: 'Target End', field: 'targetEnd', flex: 1, minWidth: 120, sortable: true, filter: true,
        cellStyle: { fontFamily: 'var(--font-family-mono)', fontSize: '8.5pt' }
      }
    ];

    if (this.delayedGrid) { try { this.delayedGrid.destroy(); } catch (_) {} }

    this.delayedGrid = agGrid.createGrid(gridEl, {
      columnDefs,
      rowData: this.topDelayedJobs,
      defaultColDef: { resizable: true },
      domLayout: 'normal' as const,
      pagination: true,
      paginationPageSize: 10,
      paginationPageSizeSelector: [5, 10, 20],
      animateRows: true,
      suppressHorizontalScroll: false
    });
  }

  /** Build the Crew PI Rating heatmap (Highcharts `heatmap` type). */
  private buildCrewPiHeatmap(): void {
    const el = this.crewPiRef?.nativeElement;
    const Highcharts = (window as any).Highcharts;
    if (!el || !Highcharts) return;

    // Drop any prior instance so the period toggle doesn't stack charts
    const prior = this.charts.find(c => c && c.renderTo === el);
    if (prior) {
      this.charts = this.charts.filter(c => c !== prior);
      try { prior.destroy(); } catch (_) {}
    }

    // Pick the dataset matching the active Day/Week/Month tab
    const ds = this.crewPiDatasets[this.crewPiPeriod];
    const crews = ds.rows.map(r => r.crew);
    const weeks = ds.columns;

    // Heatmap point shape: [x, y, value] — x=column, y=row (crew).
    // null values render as a neutral "no data" cell rather than P0.
    const data: any[] = [];
    ds.rows.forEach((row, y) => {
      row.vals.forEach((v, x) => {
        data.push({ x, y, value: v == null ? null : v, name: v == null ? 'No data' : 'P' + v });
      });
    });

    const chart = Highcharts.chart(el, {
      chart: {
        type: 'heatmap',
        backgroundColor: 'transparent',
        height: 460,
        spacing: [10, 10, 10, 10],
        style: { fontFamily: "'Inter','Calibri','Arial',sans-serif" }
      },
      title:   { text: undefined },
      credits: { enabled: false },
      legend:  { enabled: false },
      xAxis: {
        categories: weeks,
        opposite: true,
        labels: {
          useHTML: true,
          formatter: function(this: any) {
            const parts = String(this.value).split('\n');
            return '<div style="text-align:center;line-height:1.3"><div style="font-weight:700;color:#1F2937">' + parts[0] + '</div>' +
              (parts[1] ? '<div style="font-size:8pt;color:#6B7280;margin-top:2px">' + parts[1] + '</div>' : '') +
              '</div>';
          },
          style: { fontSize: '9pt' }
        },
        lineWidth: 0,
        tickWidth: 0
      },
      yAxis: {
        categories: crews,
        reversed: true,
        title: { text: undefined },
        labels: {
          style: { fontSize: '9pt', fontWeight: '600', color: '#1F2937' }
        },
        gridLineWidth: 0
      },
      colorAxis: {
        min: 0, max: 8,
        stops: [
          [0.00, '#991B1B'],  // P0
          [0.125,'#DC2626'],  // P1
          [0.25, '#EF4444'],  // P2
          [0.375,'#F97316'],  // P3
          [0.50, '#F59E0B'],  // P4
          [0.625,'#EAB308'],  // P5
          [0.75, '#84CC16'],  // P6
          [0.875,'#22C55E'],  // P7
          [1.00, '#15803D']   // P8
        ]
      },
      tooltip: {
        useHTML: true,
        formatter: function(this: any) {
          const label = this.point.value == null ? 'No data' : 'P' + this.point.value;
          return '<b>' + crews[this.point.y] + '</b> · ' + weeks[this.point.x].split('\n')[0] +
            '<br/>Rating: <b>' + label + '</b>';
        }
      },
      plotOptions: {
        heatmap: {
          borderWidth: 2,
          borderColor: '#FFFFFF',
          nullColor: '#EEF1F5',
          dataLabels: {
            enabled: true,
            formatter: function(this: any) { return this.point.value == null ? '' : 'P' + this.point.value; },
            style: { fontSize: '9pt', fontWeight: '700', color: '#FFFFFF', textOutline: 'none' }
          }
        }
      },
      series: [{ name: 'PI Rating', data, turboThreshold: 0 }]
    });
    this.charts.push(chart);
  }
}