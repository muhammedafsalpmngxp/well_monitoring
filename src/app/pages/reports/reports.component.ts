import { Component, AfterViewInit, OnDestroy, ViewEncapsulation, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
declare var agGrid: any;
declare function require(id: string): any;
import { HttpClient } from '@angular/common/http';
// AG Grid loaded via CDN — type aliases so no npm package needed
type ColDef = any;
type ColGroupDef = any;
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

export type ReportVizType = 'bar' | 'pie' | 'donut' | 'line' | 'kpi' | 'list';
export type ReportAggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max';

/** Headline-metric keys the builder can enable for a report. */
export type ReportMetricKey =
  | 'records' | 'distinctGroups' | 'highestGroup' | 'lowestGroup' | 'total' | 'avgPerGroup';

/** A pre-built, fixed-format report layout selectable in the report builder. */
export interface ReportLayoutDef {
  id: string;
  name: string;
  description: string;
}

/** Available report layouts. Selecting one in the builder makes the saved
    report render in that fixed format instead of a standard chart/list. */
export const REPORT_LAYOUTS: ReportLayoutDef[] = [
  {
    id: 'daily-plan',
    name: 'Daily Plan (ODC South)',
    description: 'Formatted daily plan — grouped by ATNM / Sub-Contractors with permit & resource-count totals'
  }
];

/** Static preview of a layout, used by the builder before the report is saved. */
export function buildLayoutPreviewHtml(layoutId: string): string {
  if (layoutId === 'daily-plan') {
    const cols = ['Sl.No','ATNM/SC','Discipline','Well ID','PA Name','PA Mob No','PH Emp ID','PH Name','PH Mob No','WBS','Well Category','Location','Job Title / Project Name','ATNM Permit No','PDO Permit No','Manpower','Eqpt','Vehicle'];
    const span = cols.length;
    const band = (txt: string, cls: string) => `<tr class="${cls}"><td colspan="${span}">${txt}</td></tr>`;
    const head =
      '<thead>' +
      '<tr class="rl-title"><td colspan="' + span + '">AL TASNIM ENTERPRISES LLC.<br>CONTRACT NO. C3100000177, OFF PLOT DELIVERY CONTRACT (ODC SOUTH)</td></tr>' +
      '<tr class="rl-band"><td colspan="' + span + '">DAILY PLAN</td></tr>' +
      '<tr class="rl-cols">' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>' +
      '</thead>';
    const dataRow =
      '<tr class="rl-data"><td>1</td><td>ATNM</td><td></td><td>30750</td><td>karthik</td><td>79211154</td>' +
      '<td>970688</td><td>LAVLESH KUMAR SINGH</td><td>71379925</td><td>WD-3522-30750-FLC-1-M</td>' +
      '<td>Nimr Conversion with Flowline</td><td>AL BURJ</td><td>ALBRG_1405250004_WI2</td>' +
      '<td></td><td></td><td>5</td><td>6</td><td></td></tr>';
    const body =
      '<tbody>' +
      band('ATNM', 'rl-grp') +
      band('Flowline', 'rl-sub') +
      dataRow +
      band('Location', 'rl-sub') +
      band('Others', 'rl-sub') +
      '<tr class="rl-total"><td colspan="13">ATNM TOTAL (PH Count: 1)</td><td></td><td></td><td>5</td><td>6</td><td></td></tr>' +
      band('Sub Contractors', 'rl-grp') +
      band('Flowline', 'rl-sub') +
      band('Location', 'rl-sub') +
      band('Others', 'rl-sub') +
      '<tr class="rl-total"><td colspan="13">Sub Contractors TOTAL (PH Count: 0)</td><td></td><td></td><td></td><td></td><td></td></tr>' +
      '<tr class="rl-grand"><td colspan="13">GRAND TOTAL (PH Count: 1)</td><td></td><td></td><td>5</td><td>6</td><td></td></tr>' +
      '</tbody>';
    return '<div class="rl-preview-scroll"><table class="rl-table">' + head + body + '</table></div>';
  }
  return '';
}

/** A filter exposed on the report viewer — a column the user can slice by. */
export interface ReportFilterDef {
  column: string;
  label: string;
  /** 'text' = value dropdown (default); 'date' = From/To range on a date column. */
  type?: 'text' | 'date';
}

export interface SavedReport {
  id: string;
  name: string;
  description: string;
  sourceTableId: string;
  sourceTableName?: string;
  vizType: ReportVizType;
  groupBy?: string;
  aggregateColumn?: string;
  aggregateFn?: ReportAggregateFn;
  /** Headline metrics to show (defaults to the first four when omitted). */
  metrics?: ReportMetricKey[];
  /** Column ids included in the report output (defaults to all when omitted). */
  columns?: string[];
  /** Optional pre-built report layout (e.g. 'daily-plan'). When set, the report
      renders in that fixed format instead of the standard chart/list. */
  layoutId?: string;
  /** Columns exposed as filters on the report view. */
  filters?: ReportFilterDef[];
  createdAt: string;
  updatedAt: string;
  owner?: string;
  lastRun?: string;
}

const STORAGE_KEY = 'altasnim.reports.v6';

const DEFAULT_REPORTS: SavedReport[] = [
  {
    id: 'rep-seed-well-status',
    name: 'Well Status Report',
    description: 'Distribution of wells by delivery status — On Track / At Risk / Critical / Ahead',
    sourceTableId: 'wells',
    sourceTableName: 'Wells',
    vizType: 'pie',
    groupBy: 'status',
    aggregateFn: 'count',
    metrics: ['records', 'distinctGroups', 'highestGroup', 'total'],
    filters: [
      { column: 'cluster',    label: 'Cluster' },
      { column: 'discipline', label: 'Discipline' }
    ],
    createdAt: '2026-04-25T08:00:00.000Z',
    updatedAt: '2026-05-02T09:15:00.000Z',
    owner: 'You',
    lastRun: '2026-05-02 09:15'
  },
  {
    id: 'rep-seed-daily-plan-report',
    name: 'Daily Plan Report',
    description: 'Count of active wells grouped by cluster — quick programme distribution view',
    sourceTableId: 'wells',
    sourceTableName: 'Wells',
    vizType: 'bar',
    groupBy: 'cluster',
    aggregateFn: 'count',
    layoutId: 'daily-plan',
    createdAt: '2026-04-20T08:00:00.000Z',
    updatedAt: '2026-04-28T14:30:00.000Z',
    owner: 'You',
    lastRun: '2026-05-02 09:15'
  },
  {
    id: 'rep-seed-job-progress',
    name: 'Job Progress',
    description: 'Programme health snapshot — On Track vs At Risk vs Critical vs Ahead',
    sourceTableId: 'wells',
    sourceTableName: 'Wells',
    vizType: 'pie',
    groupBy: 'status',
    aggregateFn: 'count',
    createdAt: '2026-04-21T10:00:00.000Z',
    updatedAt: '2026-04-29T11:20:00.000Z',
    owner: 'You',
    lastRun: '2026-05-02 09:15'
  },
  {
    id: 'rep-seed-og-core-kpis',
    name: 'O&G Core KPIs',
    description: 'Sum of penalty exposure (OMR) per cluster — drives the next governance call',
    sourceTableId: 'wells',
    sourceTableName: 'Wells',
    vizType: 'bar',
    groupBy: 'cluster',
    aggregateColumn: 'penalty',
    aggregateFn: 'sum',
    createdAt: '2026-04-22T11:30:00.000Z',
    updatedAt: '2026-04-30T08:45:00.000Z',
    owner: 'You',
    lastRun: '2026-05-01 18:00'
  },
  {
    id: 'rep-seed-ph-productivity',
    name: 'PH Productivity',
    description: 'Crew headcount split by discipline (Mechanical / Civil / Electrical / Instrument)',
    sourceTableId: 'crews',
    sourceTableName: 'Crews',
    vizType: 'donut',
    groupBy: 'discipline',
    aggregateFn: 'count',
    createdAt: '2026-04-23T09:00:00.000Z',
    updatedAt: '2026-04-30T15:10:00.000Z',
    owner: 'You',
    lastRun: '2026-05-02 06:00'
  },
  {
    id: 'rep-seed-wmr-inputs',
    name: 'WMR',
    description: 'Weekly Management Report inputs — field data entries and submission status',
    sourceTableId: 'wells',
    sourceTableName: 'Wells',
    vizType: 'bar',
    groupBy: 'cluster',
    aggregateFn: 'count',
    createdAt: '2026-04-24T08:00:00.000Z',
    updatedAt: '2026-04-30T16:00:00.000Z',
    owner: 'You',
    lastRun: '2026-05-02 09:15'
  }
];

/** Reports to drop from the list (removed by request). Matched by id or name. */
const REMOVED_REPORT_IDS = new Set<string>(['rep-seed-ph-productivity-report', 'rep-seed-ph-productivity-list']);
const REMOVED_REPORT_NAMES = new Set<string>(['PH Productivity Report', 'PH Productivity List Report', 'PTEST']);
function pruneRemovedReports(items: SavedReport[]): SavedReport[] {
  return items.filter(r =>
    !REMOVED_REPORT_IDS.has(r.id) && !REMOVED_REPORT_NAMES.has((r.name || '').trim())
  );
}

export function readAllReports(): SavedReport[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      const seeded = pruneRemovedReports(DEFAULT_REPORTS);
      writeAllReports(seeded);
      return seeded.slice();
    }
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const pruned = pruneRemovedReports(arr);
    // Persist the one-time cleanup so the removed reports don't come back.
    if (pruned.length !== arr.length) writeAllReports(pruned);
    return pruned;
  } catch {
    return [];
  }
}

export function writeAllReports(items: SavedReport[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }
  catch (e) { console.error('[reports] persist failed', e); }
}

export function upsertReport(report: SavedReport): void {
  const items = readAllReports();
  const idx = items.findIndex(x => x.id === report.id);
  if (idx >= 0) items[idx] = report;
  else items.unshift(report);
  writeAllReports(items);
}

export function findReport(id: string): SavedReport | null {
  return readAllReports().find(r => r.id === id) || null;
}

export function deleteReport(id: string): void {
  writeAllReports(readAllReports().filter(r => r.id !== id));
}

/** Publish the report list to a global the sidebar's "Standard Reports" reads. */
export function publishReportsList(): void {
  try {
    (window as any).__reportsStandard = readAllReports().map(r => ({ id: r.id, name: r.name }));
    const fn = (window as any).sbRenderStdReports;
    if (typeof fn === 'function') fn();
  } catch { /* no-op */ }
}
// Populate once at module load so the sidebar has data before /reports is opened.
publishReportsList();

// ── Job Progress sample data (mirrors Reports.html illustrative data) ──
const JOB_DATA: any[] = [
  {cat:'Flowline', cluster:'Nimr',   well:'NR-1182', name:'Nimr 1182 Flowline',    po:'PO-44821/10', wbs:'FL-1182', purpose:185000, cumP:30, cumA:28, wk:[[8,7],[8,9],[8,6],[8,8],[0,0]],   tf:'14 Jul 26', isNew:false},
  {cat:'Flowline', cluster:'Nimr',   well:'NR-1190', name:'Nimr 1190 Flowline',    po:'PO-44833/20', wbs:'FL-1190', purpose:142000, cumP:55, cumA:60, wk:[[10,11],[10,12],[10,10],[8,9],[0,0]], tf:'02 Jul 26', isNew:false},
  {cat:'Flowline', cluster:'Marmul', well:'MM-0902', name:'Marmul 0902 Flowline',  po:'PO-51002/10', wbs:'FL-0902', purpose:168000, cumP:20, cumA:14, wk:[[9,5],[9,6],[9,7],[9,4],[4,0]],   tf:'22 Aug 26', isNew:false},
  {cat:'Location', cluster:'Nimr',   well:'NR-1201', name:'Nimr 1201 Location',    po:'PO-44910/30', wbs:'LO-1201', purpose:96000,  cumP:42, cumA:45, wk:[[12,13],[12,12],[12,14],[0,0],[0,0]], tf:'28 Jun 26', isNew:false},
  {cat:'Location', cluster:'Nimr',   well:'NR-1210', name:'Nimr 1210 Location',    po:'PO-44950/10', wbs:'LO-1210', purpose:104000, cumP:10, cumA:6,  wk:[[10,5],[10,6],[10,5],[10,4],[5,2]],  tf:'15 Aug 26', isNew:false},
  {cat:'Location', cluster:'Marmul', well:'MM-0915', name:'Marmul 0915 Location',  po:'PO-51044/20', wbs:'LO-0915', purpose:88000,  cumP:0,  cumA:0,  wk:[[null,8],[null,9],[null,7],[null,6],[null,4]], tf:'30 Aug 26', isNew:true},
  {cat:'Conversion',cluster:'Marmul',well:'MM-0944', name:'Marmul 0944 Conversion',po:'PO-51080/10', wbs:'CV-0944', purpose:210000, cumP:65, cumA:67, wk:[[9,10],[9,9],[8,9],[0,0],[0,0]],   tf:'05 Jul 26', isNew:false},
  {cat:'Conversion',cluster:'Nimr',  well:'NR-1233', name:'Nimr 1233 Conversion',  po:'PO-44988/40', wbs:'CV-1233', purpose:176000, cumP:35, cumA:30, wk:[[11,7],[11,8],[11,6],[11,7],[0,0]], tf:'18 Jul 26', isNew:false},
  {cat:'Reopen',   cluster:'Nimr',   well:'NR-1245', name:'Nimr 1245 Reopen',      po:'PO-45010/10', wbs:'RO-1245', purpose:72000,  cumP:50, cumA:52, wk:[[14,15],[14,14],[12,13],[0,0],[0,0]], tf:'03 Jul 26', isNew:false},
];
const WK_LABELS = ['W1 (1–7)','W2 (8–14)','W3 (15–21)','W4 (22–28)','W5 (29–end)'];

/** PH Productivity source rows — shared by the report builder and viewer. */
export const PH_PROD_ROWS: any[] = [
  { crew_id:'CW-001', p_rating:'P7', activity_name:'Flowline Welding', activity_id:'ACT-1001', well_id:'34565', progress:82, status:'On Track', date:'2026-04-28' },
  { crew_id:'CW-002', p_rating:'P5', activity_name:'Cable Laying',     activity_id:'ACT-1002', well_id:'34561', progress:64, status:'At Risk',  date:'2026-05-12' },
  { crew_id:'CW-003', p_rating:'P8', activity_name:'Hook-up',          activity_id:'ACT-1003', well_id:'31780', progress:91, status:'Ahead',    date:'2026-03-17' },
  { crew_id:'CW-004', p_rating:'P4', activity_name:'Excavation',       activity_id:'ACT-1004', well_id:'36078', progress:55, status:'At Risk',  date:'2026-03-15' },
  { crew_id:'CW-005', p_rating:'P6', activity_name:'Pegging',          activity_id:'ACT-1005', well_id:'34422', progress:73, status:'On Track', date:'2026-04-22' },
  { crew_id:'CW-006', p_rating:'P2', activity_name:'Backfill',         activity_id:'ACT-1006', well_id:'37797', progress:38, status:'Critical', date:'2026-04-10' },
  { crew_id:'CW-007', p_rating:'P9', activity_name:'Commissioning',    activity_id:'ACT-1007', well_id:'34357', progress:96, status:'Ahead',    date:'2026-04-30' },
  { crew_id:'CW-008', p_rating:'P5', activity_name:'Survey & Design',  activity_id:'ACT-1008', well_id:'24665', progress:68, status:'On Track', date:'2026-04-05' },
  { crew_id:'CW-009', p_rating:'P7', activity_name:'Testing',          activity_id:'ACT-1009', well_id:'30330', progress:80, status:'On Track', date:'2026-05-08' },
  { crew_id:'CW-010', p_rating:'P3', activity_name:'Rigging',          activity_id:'ACT-1010', well_id:'36076', progress:47, status:'Critical', date:'2026-03-29' },
  { crew_id:'CW-011', p_rating:'P6', activity_name:'Flowline Welding', activity_id:'ACT-1011', well_id:'36075', progress:71, status:'On Track', date:'2026-05-15' },
  { crew_id:'CW-012', p_rating:'P1', activity_name:'Cable Laying',     activity_id:'ACT-1012', well_id:'36106', progress:29, status:'Critical', date:'2026-05-20' },
  { crew_id:'CW-013', p_rating:'P8', activity_name:'Hook-up',          activity_id:'ACT-1013', well_id:'33146', progress:88, status:'Ahead',    date:'2026-05-01' },
  { crew_id:'CW-014', p_rating:'P5', activity_name:'Excavation',       activity_id:'ACT-1014', well_id:'33147', progress:66, status:'At Risk',  date:'2026-04-18' },
  { crew_id:'CW-015', p_rating:'P6', activity_name:'Pegging',          activity_id:'ACT-1015', well_id:'33152', progress:74, status:'On Track', date:'2026-04-25' },
  { crew_id:'CW-016', p_rating:'P4', activity_name:'Backfill',         activity_id:'ACT-1016', well_id:'33153', progress:52, status:'At Risk',  date:'2026-05-25' },
  { crew_id:'CW-017', p_rating:'P0', activity_name:'Survey & Design',  activity_id:'ACT-1017', well_id:'36748', progress:12, status:'Critical', date:'2026-04-12' },
  { crew_id:'CW-018', p_rating:'P7', activity_name:'Commissioning',    activity_id:'ACT-1018', well_id:'36749', progress:84, status:'Ahead',    date:'2026-03-20' },
  { crew_id:'CW-019', p_rating:'P5', activity_name:'Testing',          activity_id:'ACT-1019', well_id:'36757', progress:69, status:'On Track', date:'2026-05-03' },
  { crew_id:'CW-020', p_rating:'P6', activity_name:'Rigging',          activity_id:'ACT-1020', well_id:'36758', progress:72, status:'On Track', date:'2026-05-18' }
];


@Component({
  selector: 'app-reports',
  templateUrl: './reports.component.html',
  styleUrls: ['./reports.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ReportsComponent implements AfterViewInit, OnDestroy {

  items: SavedReport[] = [];
  query = '';
  selectedReport: SavedReport | null = null;
  private _mc: any = null;
  private _sc: any = null;
  modalStats: {lbl: string, num: string, sd: string, variant: string}[] = [];

  /** Configurable filters shown on the generic report view (built from report.filters). */
  genFilters: { col: string; label: string; type: 'text' | 'date'; value: string; from: string; to: string; options: string[] }[] = [];

  jpFilter = { cluster: 'All', category: 'All' };
  jpLoading = false;
  jpClusters: string[] = [];
  jpCategories: string[] = [];
  dpFilter = { type: 'All', location: 'All', category: 'All', discipline: 'All', wellId: '' };
  dpCategories: string[] = [];
  dpLocations: string[] = [];
  dpColDefs: any[] = [];
  dpRowData: any[] = [];
  dpLoading = false;
  private _allDailyRows: any[] = [];
  private _dpLoaded = false;
  private _dpRawRows: any[] = [];
  private _dpCollapsedTypes = new Set<string>();
  private _dpCollapsedCats  = new Set<string>(); // key: "${typeLabel}__${catLabel}"
  private _dpApi: any = null;

  // ── Custom column-picker panel ────────────────────────────────────────────
  showDpCustomPanel = false;
  showJpCustomPanel = false;
  jpCustomColDefs = [
    { key: 'Category',     label: 'Category',      sel: true,  cols: [{ header: 'Category',      field: 'Category' }] },
    { key: 'WellId',       label: 'Well ID',        sel: true,  cols: [{ header: 'Well ID',        field: 'WellId' }] },
    { key: 'WellName',     label: 'Well Name',      sel: true,  cols: [{ header: 'Well Name',      field: 'WellName' }] },
    { key: 'PoNo',         label: 'PO No',          sel: true, cols: [{ header: 'PO No',          field: 'PoNo' }] },
    { key: 'WbsNo',        label: 'WBS',            sel: true, cols: [{ header: 'WBS',            field: 'WbsNo' }] },
    { key: 'CumPrior',     label: 'Cum Prior',      sel: true,  cols: [{ header: 'Cum Prior Act',  field: 'CumPriorActualPct' }] },
    { key: 'W1',           label: 'W1 (1–7)',       sel: true,  cols: [{ header: 'W1 Plan', field: 'W1PlanPct' }, { header: 'W1 Act', field: 'W1ActualPct' }] },
    { key: 'W2',           label: 'W2 (8–14)',      sel: true,  cols: [{ header: 'W2 Plan', field: 'W2PlanPct' }, { header: 'W2 Act', field: 'W2ActualPct' }] },
    { key: 'W3',           label: 'W3 (15–21)',     sel: true,  cols: [{ header: 'W3 Plan', field: 'W3PlanPct' }, { header: 'W3 Act', field: 'W3ActualPct' }] },
    { key: 'W4',           label: 'W4 (22–28)',     sel: true,  cols: [{ header: 'W4 Plan', field: 'W4PlanPct' }, { header: 'W4 Act', field: 'W4ActualPct' }] },
    { key: 'W5',           label: 'W5 (29–end)',    sel: true,  cols: [{ header: 'W5 Plan', field: 'W5PlanPct' }, { header: 'W5 Act', field: 'W5ActualPct' }] },
    { key: 'CurrentMonth', label: 'Current Month',  sel: true,  cols: [{ header: 'CM Plan', field: 'CmPlanPct' }, { header: 'CM Act', field: 'CmActualPct' }] },
    { key: 'TargetEnd',    label: 'Finish Date',    sel: true,  cols: [{ header: 'Finish',         field: 'TargetEnd' }] },
    { key: 'Status',       label: 'Status',         sel: true,  cols: [{ header: 'Status',         field: 'Status' }] },
    { key: 'Revenue',      label: 'Revenue (OMR)',  sel: true,  cols: [
      { header: 'Cum Prior Act', field: 'CumPriorMonthActual' },
      { header: 'CM Plan',       field: 'CmPlanRevenue' },
      { header: 'CM Act',        field: 'CmActualRevenue' },
      { header: 'Cum Plan',      field: 'CumCmPlanRevenue' },
      { header: 'Cum Act',       field: 'CumCmActualRevenue' },
    ]},
  ];
  dpCustomColDefs = [
    { key: 'type',   label: 'Type',                sel: true  },
    { key: 'well',   label: 'Well ID',             sel: true  },
    { key: 'disc',   label: 'Discipline',          sel: true  },
    { key: 'pa',     label: 'PA Name',             sel: true  },
    { key: 'paMob',  label: 'PA Mob',              sel: true },
    { key: 'phName', label: 'PH Name',             sel: true  },
    { key: 'phId',   label: 'PH ID',               sel: true },
    { key: 'phMob',  label: 'PH Mob',              sel: true },
    { key: 'po',     label: 'PO No',               sel: true },
    { key: 'wbs',    label: 'WBS',                 sel: true },
    { key: 'cat',    label: 'Category',            sel: true  },
    { key: 'loc',    label: 'Location',            sel: true  },
    { key: 'job',    label: 'Job Title / Project', sel: true  },
    { key: 'act',    label: 'Activities',          sel: true  },
    { key: 'man',    label: 'Manpower',           sel: true  },
    { key: 'eqpt',   label: 'Equipment',           sel: true  },
    { key: 'veh',    label: 'Vehicles',            sel: true  },
    { key: 'rem',    label: 'Remarks',             sel: true },
  ];

  jpColDefs: any[] = [];
  jpRowData: any[] = [];
  jpPinnedBottom: any[] = [];
  private _jpRawRows: any[] = [];
  private _jpCollapsed = new Set<string>();
  private _jpApi: any = null;

  // ── WMR state ─────────────────────────────────────────────────────────────
  wmrLoading    = false;
  wmrRowData: any[] = [];
  private _wmrSortedRows: any[] = [];
  private _wmrCollapsedClusters = new Set<string>();
  private _wmrCollapsedProjects = new Set<string>();
  private _wmrApi: any = null;
  wmrClusters: string[] = [];
  wmrLatestDate = '';
  wmrFilter     = { cluster: 'All' };
  showWmrCustomPanel = false;
  wmrCustomGroups: Array<{ key: string; label: string; sel: boolean; cols: Array<{ h: string; f: string }> }> = [
    { key: 'ident', label: 'Well Identification', sel: true, cols: [
      { h: 'Rig No.',                f: 'rig_no' },
      { h: 'Well Location',          f: 'well_location' },
      { h: 'Well Name (after Spud)', f: 'well_name_after_spud' },
      { h: 'PDO Well ID',            f: 'pdo_well_id' },
      { h: 'Well Type',              f: 'well_type' },
    ]},
    { key: 'coords', label: 'Coordinates', sel: true, cols: [
      { h: 'Northing', f: 'northing' },
      { h: 'Easting',  f: 'easting'  },
    ]},
    { key: 'wbs', label: 'WBS No', sel: true, cols: [
      { h: 'Location(DD)',            f: 'locationdd' },
      { h: 'Flow line(DL)',           f: 'flow_linedl' },
      { h: 'Location PO NO',         f: 'location_po_no' },
      { h: 'Location PO Recvd Date', f: 'location_po_recvd_date' },
      { h: 'Location - Purpose Val', f: 'location___purpose_value' },
    ]},
    { key: 'sched', label: 'Scheduling / SCR / MOC', sel: true, cols: [
      { h: 'Last week Exp.Rig On',  f: 'last_week_exp_rig_on_location_sap_data' },
      { h: 'Latest Exp.Rig On',     f: 'latest_exp_rig_on_location_sap_data' },
      { h: 'Exp.Rig Off',           f: 'exp_rig_off_location_sap_data' },
      { h: 'Mat. PO Placed',        f: 'date___material_po_placed' },
      { h: 'Mat. Available',        f: 'date___material_available_at_site' },
      { h: 'SCR No.',               f: 'scr_no' },
      { h: 'SCR Date',              f: 'scr_date' },
      { h: 'MOC Raised',            f: 'moc_raised' },
      { h: 'MOC Approved',          f: 'moc_approved' },
      { h: 'Buffer Status',         f: 'buffer_status' },
      { h: 'Actual Pegged Date',    f: 'actual_pegged_date' },
    ]},
    { key: 'locprep', label: 'Location Preparation', sel: true, cols: [
      { h: 'Last week cum progress (%)',       f: 'last_week_cum_progress' },
      { h: 'Cum progress for This week (%)',  f: 'cum_progress_for_this_week' },
      { h: 'Actual Start date',               f: 'actual_start_date' },
      { h: 'Actual finish Date',              f: 'actual_finish_date' },
      { h: 'FLAF Issue Date',                 f: 'flaf_issue_date' },
      { h: 'RAMZ ID',                         f: 'ramz_id' },
      { h: 'RAMZ ID Received Date',           f: 'ramz_id_received_date_same_day_as_flaf_issue_date' },
      { h: 'Date of Site Survey Report',      f: 'date_of_site_survey_report_issuance' },
      { h: 'Well Eng. to add in EDM',         f: 'well_engineer_to_add_location_name_in_edm' },
      { h: 'ODC Req. (Surface cables)',       f: 'actual_date_odc_requested_field_programmer_oso33x_for_esp_pcp_surface_cables' },
      { h: 'OSO33X Cable Call-Out',           f: 'date_oso33x_call_out_for_cable_installation_to_pcp_esp_vendor' },
      { h: 'Cable Delivery',                  f: 'delivery_of_esp_pcp_surface_cable_by_field_programmer_oso33x' },
      { h: 'Cable Installation',              f: 'installation_of_esp_pcp_surface_cable_by_vendors' },
      { h: 'ODC Req. (Skid)',                f: 'actual_date_odc_requested_field_programmer_oso33x_to_install_esp_pcp_skid' },
      { h: 'Field Prog. Req. Vendor Skid',   f: 'actual_date_field_programmer_oso33x_requested_esp_pcp_vendor_to_install_the_skid' },
      { h: 'Vendor Delivered Skid',          f: 'actual_date_pcp_esp_vendor_delivered_the_skid' },
      { h: 'Skid Installation Date',         f: 'actual_installation_date_by_vendor_of_esp_pcp_skid' },
      { h: 'Flow line PO NO',                f: 'flow_line_po_no' },
      { h: 'F/L PO recd. Date',              f: 'f_l_po_recd__date' },
      { h: 'Flowline - Purpose Value',       f: 'flowline___purpose_value' },
      { h: 'Station Name/ No',               f: 'station_name_no' },
      { h: 'Physical Tie in Port No.',       f: 'physical_tie_in_port_number' },
      { h: 'Tie-In Port Readiness Date',    f: 'date_of_tie_in_port_readiness' },
      { h: 'Tie-In Available at FLAF',      f: 'physical_tie_in_port_available_when_flaf_issued' },
    ]},
    { key: 'engdes', label: 'Engineering (Design Package)', sel: true, cols: [
      { h: 'Eng. Actual Start Date',  f: 'engineering_actual_start_date' },
      { h: 'Eng. Actual Finish Date', f: 'engineering_actual_finish_date' },
      { h: 'Progress (%)',            f: 'progress' },
    ]},
    { key: 'const', label: 'Construction (Fab. & Installation)', sel: true, cols: [
      { h: 'FL dia',                  f: 'fl_dia' },
      { h: 'FL Length (Meter)',        f: 'fl_length_meter' },
      { h: 'Const. Actual Start Date',f: 'const__actual_start_date' },
      { h: 'Const. Complete Date',    f: 'const__complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date' },
      { h: 'Flowline Construction %', f: 'flowline_construction_progress' },
      { h: 'OHL Length (Meter)',       f: 'ohl_length_meter' },
      { h: 'OHL Progress',            f: 'ohl_progress' },
      { h: 'OHL completion Date',     f: 'ohl_completion_date' },
      { h: 'Z6 data submitted date',  f: 'z6_data_submitted_date' },
      { h: 'SAP Notification (Z6)',   f: 'sap_notification_received_date_z6_2_days_before_eng__completion' },
    ]},
    { key: 'engcomm', label: 'Eng & Commissioning', sel: true, cols: [
      { h: 'Actual Rig on Date',          f: 'actual_rig_on_date' },
      { h: 'Actual Rig off Date',         f: 'actual_rig_off_date' },
      { h: 'WLCTF Approval',              f: 'wlctf_acceptanceapproval_from_production' },
      { h: 'Hoist/FBU/RSR on date',      f: 'actual_hoist_fbu_rsr_on_date' },
      { h: 'Hoist/FBU/RSR off date',     f: 'actual_hoist_fbu_rsr_off_date' },
      { h: 'Wellpad handover-2',          f: 'wellpad_handover_2_from_hoist_fbu_rsr_off_date' },
      { h: 'Completion type',             f: 'completion_type_rig_fbu_or_rsr_hoist' },
      { h: 'Actual Eng. Completion Date', f: 'actual_eng__completion_date' },
      { h: 'Actual Comm. Start date',     f: 'actual_comm__start_date' },
      { h: 'Actual Comm. Finish date',    f: 'actual_comm__finish_date_with_in_2_days_from_actual_engg__completion_date' },
      { h: 'Engg KPI after Rig-Off Days',f: 'engg_kpi_after_rig_off_days' },
      { h: 'Data Error',                  f: 'data_error' },
      { h: 'Reason if KPI Not Met',       f: 'reason_if_kpi_not_met' },
      { h: 'Remarks / Issues',            f: 'remark_status_area_of_attention_issues_' },
      { h: 'RLMU submitted to HO',        f: 'rlmu_submitted_to_ho_date_with_in_7_days_from_actual_comm_' },
      { h: 'FL Test Pack Date to QS',     f: 'flow_line_test_pack_completion_doc__submission_date_to_qs_dept_' },
      { h: 'FL Test Pack %',              f: 'flow_line_test_pack_completion_progress' },
      { h: 'Over All progress %',         f: 'over_all_progress_percentages' },
      { h: 'SSFD Wells',                  f: 'ssfd_wells' },
      { h: 'IPM',                         f: 'ipm' },
    ]},
    { key: 'pms_loc', label: 'Location Preparation PMS (%)', sel: true, cols: [
      { h: 'ACCESS ROAD (5%)',                       f: 'access_road_5' },
      { h: 'EARTH WORK (60%)',                       f: 'earth_work_60' },
      { h: 'CELLAR (20%)',                           f: 'cellar_20' },
      { h: 'BEAM PUMP BASE/ESP/PCP FOUNDATION (5%)', f: 'beam_pump_base_esp_pcp_foundation_5' },
      { h: 'EARTHING (1%)',                          f: 'earthing_1' },
      { h: 'SEPTIC TANK (1%)',                       f: 'septic_tank_1' },
      { h: 'Water (2%)',                             f: 'water_2' },
      { h: 'WASTE WATER (2%)',                       f: 'waste_water_2' },
      { h: 'HDPE LINER INSTALAT (4%)',               f: 'hdpe_liner_instalat_4' },
      { h: 'Overall Loc. Preparation (100%)',        f: 'overall_loc__preparation_10_100' },
    ]},
    { key: 'pms_eng', label: 'Engineering %', sel: true, cols: [
      { h: 'Site Survey (5%)',                       f: 'site_survey_5' },
      { h: 'Survey Report Issue (5%)',                f: 'survey_report_issue_5' },
      { h: 'Design Sta (5%)',                         f: 'design_sta_5' },
      { h: 'Design Completed & Issue for TA2 (40%)', f: 'design_completed_issue_for_ta2_5_40' },
      { h: 'Approved by (15%)',                       f: 'approved_by_15' },
      { h: 'AFC (3%) (30%)',                          f: 'afc_3_30' },
      { h: 'Overall Engg. (10%) (100%)',              f: 'overall_engg__10_100' },
    ]},
    { key: 'pms_mat', label: 'Material Availability (%)', sel: true, cols: [
      { h: 'Piping / mech (50%)',           f: 'piping_mech_50' },
      { h: 'Elect (30%)',                   f: 'elect_30' },
      { h: 'Instr (20%)',                   f: 'instr_20' },
      { h: 'Overall Material (10%) (100%)', f: 'overall_material_10_100' },
    ]},
    { key: 'pms_fl', label: 'Flow line (%)', sel: true, cols: [
      { h: 'Cold b (2%)',                    f: 'cold_b_2' },
      { h: 'Sleeper Pre Cast+ Ins (15%)',    f: 'sleeper_pre_cast_ins_15' },
      { h: 'CS Pipe welding + NDT (60%)',    f: 'cs_pipe_welding_ndt_10_rt_for_op_100_for_60' },
      { h: 'PE Fussion & Pull (20%)',        f: 'pe_fussion_pull_20' },
      { h: 'Final Hydro T (3%)',             f: 'final_hydro_t_3' },
      { h: 'Overall Const. (10%) (100%)',    f: 'overall_const__10_100' },
    ]},
    { key: 'pms_ohl', label: 'OHL', sel: true, cols: [
      { h: 'Pole hole drill (40%)',    f: 'pole_hole_drill_40' },
      { h: 'Pole Erect (40%)',         f: 'pole_erect_40' },
      { h: 'Conductor String (18%)',  f: 'conductor_string_18' },
      { h: 'OHL ti (2%)',              f: 'ohl_ti_2' },
      { h: 'Overall OHL Progr (100%)',f: 'overall_ohl_progr_100' },
    ]},
    { key: 'pms_comm', label: 'Commissioning (%)', sel: true, cols: [
      { h: 'Mechani (60%)',                f: 'mechani_60' },
      { h: 'Electri (15%)',                f: 'electri_15' },
      { h: 'Instrumentat (20%)',           f: 'instrumentat_20' },
      { h: 'Overall Comm Mi (5%)',         f: 'overall_comm_mi_5' },
      { h: 'Overall Comm Progress (100%)', f: 'overall_comm_progress_100' },
    ]},
    { key: 'status', label: 'Overall Status', sel: true, cols: [
      { h: 'Loc. Prep. Status',          f: 'location_preparation_status_in_progress_completed' },
      { h: 'FL Const. Status',           f: 'flow_line_const__status_in_progress_completed' },
      { h: 'FL Commi. Status',           f: 'flow_line_commi__status_in_progress_completed' },
      { h: 'Well Year / White Space',    f: 'well_year_white_space' },
      { h: 'Reasons for year 2018',      f: 'reasons_for_year_2018' },
      { h: 'Column7',                    f: 'column7' },
      { h: 'Digital WMR Import Remarks', f: 'digital_wmr_import_remarks' },
    ]},
  ];

  readonly defaultColDef: any = {
    sortable: true, resizable: true,
    filter: 'agTextColumnFilter',
    floatingFilter: true,
    suppressHeaderMenuButton: true,
    cellStyle: { display: 'flex', alignItems: 'center', fontSize: '14px' }
  };

  constructor(private router: Router, private _san: DomSanitizer, private _http: HttpClient) {}

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;
    this.refresh();
    // Allow the sidebar's "Standard Reports" items to open a report here.
    (window as any).__reportsTryOpen = () => this.tryOpenPending();
    (window as any).__reportsCloseModal = () => this.closeModal();
    // Defer to avoid ExpressionChangedAfterItHasBeenCheckedError
    setTimeout(() => this.tryOpenPending(), 0);
  }

  ngOnDestroy(): void {}

  refresh(): void {
    this.items = readAllReports();
    publishReportsList();
  }

  /** Open a report requested from the sidebar (via window.openReportById). */
  private tryOpenPending(): void {
    const id = (window as any).__pendingReportOpen;
    if (!id) return;
    (window as any).__pendingReportOpen = null;
    const r = this.items.find(x => x.id === id) || findReport(id);
    if (r) this.onView(r);
  }

  get filtered(): SavedReport[] {
    const q = (this.query || '').trim().toLowerCase();
    if (!q) return this.items;
    return this.items.filter(r =>
      (r.name + ' ' + (r.description || '') + ' ' + (r.sourceTableName || '')).toLowerCase().indexOf(q) !== -1
    );
  }

  onNew(): void {
    this.router.navigate(['/report-builder']);
  }

  onView(r: SavedReport): void {
    if (this._mc) { try { this._mc.destroy(); } catch {} this._mc = null; }
    if (this._sc) { try { this._sc.destroy(); } catch {} this._sc = null; }
    this.selectedReport = r;
    this._computeModalStats();
    if (r.id === 'rep-seed-job-progress') {
      this.jpFilter = { cluster: 'All', category: 'All' };
      this.jpClusters = [];
      this.jpCategories = [];
      setTimeout(() => this._renderJobView(), 80);
    } else if (r.layoutId === 'daily-plan' || r.id === 'rep-seed-daily-plan-report') {
      const tm = new Date(); tm.setDate(tm.getDate() + 1);
      this.dpFilter = { type: 'All', location: 'All', category: 'All', discipline: 'All', wellId: '' };
      this.dpCategories = [];
      this.dpLocations = [];
      this._dpLoaded = false;
      setTimeout(() => this._renderDailyView(), 80);
    } else if (r.id === 'rep-seed-wmr-inputs') {
      this.wmrFilter = { cluster: 'All' };
      this.wmrClusters = [];
      this.wmrRowData = [];
      this.wmrLatestDate = '';
      setTimeout(() => this._renderWmrView(), 80);
    } else if (r.id === 'rep-seed-ph-productivity') {
      // PH Productivity uses its own embedded component — no generic chart needed
    } else {
      this._buildGenFilters(r);
      this._computeModalStats();
      setTimeout(() => this._renderModalChart(), 80);
    }
  }

  /** Build the filter bar (dropdowns of distinct values) from the report's filter config. */
  private _buildGenFilters(r: SavedReport): void {
    const rows = this._mockRows(r.sourceTableId);
    this.genFilters = (r.filters || []).map(f => ({
      col: f.column,
      label: f.label || f.column,
      type: (f.type === 'date' ? 'date' : 'text') as 'text' | 'date',
      value: 'All',
      from: '',
      to: '',
      options: f.type === 'date' ? [] : [...new Set(rows.map((row: any) => String(row[f.column] ?? '')).filter(Boolean))].sort()
    }));
  }

  /** Rows for the active generic report, after applying the on-view filters. */
  private _genRows(): any[] {
    if (!this.selectedReport) return [];
    let rows = this._mockRows(this.selectedReport.sourceTableId);
    this.genFilters.forEach(f => {
      if (f.type === 'date') {
        if (f.from) rows = rows.filter((row: any) => String(row[f.col] ?? '') >= f.from);
        if (f.to)   rows = rows.filter((row: any) => String(row[f.col] ?? '') <= f.to);
      } else if (f.value && f.value !== 'All') {
        rows = rows.filter((row: any) => String(row[f.col] ?? '') === f.value);
      }
    });
    return rows;
  }

  /** Filter changed on the generic report view → recompute metrics + chart. */
  onGenFilterChange(): void {
    this._computeModalStats();
    setTimeout(() => this._renderModalChart(), 0);
  }

  // ── Generic List / KPI rendering ────────────────────────────────────────
  private _titleCase(s: string): string {
    return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  genListColumns(): { id: string; label: string }[] {
    const rows = this._genRows();
    if (!rows.length) return [];
    let keys = Object.keys(rows[0]);
    const sel = this.selectedReport?.columns;
    if (sel && sel.length) keys = keys.filter(k => sel.includes(k));
    return keys.map(k => ({ id: k, label: this._titleCase(k) }));
  }
  genListRows(): any[] { return this._genRows().slice(0, 30); }

  genKpi(): { value: string; label: string } {
    const r = this.selectedReport;
    if (!r) return { value: '—', label: '' };
    const rows = this._genRows();
    const fn = r.aggregateFn || 'count';
    const acol = r.aggregateColumn || '';
    let value = 0;
    if (fn === 'count') value = rows.length;
    else {
      const nums = rows.map((x: any) => parseFloat(String(x[acol]))).filter((n: number) => !isNaN(n));
      if (fn === 'sum') value = nums.reduce((a: number, b: number) => a + b, 0);
      else if (fn === 'avg') value = nums.length ? nums.reduce((a: number, b: number) => a + b, 0) / nums.length : 0;
      else if (fn === 'min') value = nums.length ? Math.min(...nums) : 0;
      else if (fn === 'max') value = nums.length ? Math.max(...nums) : 0;
    }
    const fmt = (n: number) => n == null || isNaN(n) ? '—' : (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(2));
    const label = fn === 'count'
      ? 'Total ' + (r.sourceTableName || 'records').toLowerCase()
      : this._titleCase(fn) + ' of ' + this._titleCase(acol);
    return { value: fmt(value), label };
  }

  closeModal(): void {
    if (this._mc) { try { this._mc.destroy(); } catch {} this._mc = null; }
    if (this._sc) { try { this._sc.destroy(); } catch {} this._sc = null; }
    this.selectedReport = null;
    this.modalStats = [];
  }

  get isJobProgress(): boolean { return this.selectedReport?.id === 'rep-seed-job-progress'; }
  get isDailyPlan(): boolean   { return this.selectedReport?.layoutId === 'daily-plan' || this.selectedReport?.id === 'rep-seed-daily-plan-report'; }
  get isWmr(): boolean         { return this.selectedReport?.id === 'rep-seed-wmr-inputs'; }
  get isPhProductivity(): boolean { return this.selectedReport?.id === 'rep-seed-ph-productivity'; }

  onJpFilterChange(): void { setTimeout(() => this._renderJobView(), 0); }
  onDpFilterChange(): void { setTimeout(() => this._renderDailyView(), 0); }
  onWmrFilterChange(): void { setTimeout(() => this._renderWmrView(), 0); }

  // ── WMR render ────────────────────────────────────────────────────────────
  private _renderWmrView(): void {
    this.wmrLoading = true;
    const { cluster } = this.wmrFilter;
    const url = `/api/v1/wells/reports/wmr?cluster=${encodeURIComponent(cluster)}`;
    this._http.get<any>(url).subscribe({
      next: (resp) => {
        if (!this.wmrClusters.length) this.wmrClusters = resp.clusters ?? [];
        this.wmrLatestDate = resp.reportDate ?? '';
        this._buildWmrGrid(resp.rows ?? []);
        this.wmrLoading = false;
      },
      error: () => { this.wmrLoading = false; }
    });
  }

  private _buildWmrFlatRows(): any[] {
    const flatRows: any[] = [];
    let lastCluster = '', lastProject = '', seq = 0;
    for (const row of this._wmrSortedRows) {
      const c = row.Cluster || 'Unknown';
      const p = row.Project  || 'Unknown';
      const cCollapsed = this._wmrCollapsedClusters.has(c);
      if (c !== lastCluster) {
        const cnt = this._wmrSortedRows.filter((r: any) => (r.Cluster||'Unknown') === c).length;
        flatRows.push({ _wmrType: 'cluster', _cluster: c, _collapsed: cCollapsed, _label: c.toUpperCase(), _cnt: cnt, Cluster: '' });
        lastCluster = c; lastProject = '';
      }
      if (cCollapsed) continue;
      if (p !== lastProject) {
        const projKey = `${c}__${p}`;
        const pCollapsed = this._wmrCollapsedProjects.has(projKey);
        const cnt = this._wmrSortedRows.filter((r: any) =>
          (r.Cluster||'Unknown') === c && (r.Project||'Unknown') === p).length;
        flatRows.push({ _wmrType: 'project', _cluster: c, _project: p, _collapsed: pCollapsed, _label: p, _cnt: cnt, Cluster: '' });
        lastProject = p;
      }
      const projKey = `${c}__${p}`;
      if (this._wmrCollapsedProjects.has(projKey)) continue;
      flatRows.push({ ...row, _seq: ++seq });
    }
    return flatRows;
  }

  private _buildWmrGrid(rows: any[]): void {
    this.wmrRowData = rows;

    // ── Sort and store for later toggle rebuilds ───────────────────────────
    this._wmrSortedRows = [...rows].sort((a, b) =>
      (a.Cluster||'').localeCompare(b.Cluster||'') ||
      (a.Project||'').localeCompare(b.Project||'') ||
      (a.well_name_after_spud||'').localeCompare(b.well_name_after_spud||''));
    // Reset collapse state when data reloads
    this._wmrCollapsedClusters.clear();
    this._wmrCollapsedProjects.clear();

    const flatRows = this._buildWmrFlatRows();

    const col = (h: string, f: string, w = 120, pin?: string): any => {
      const def: any = { headerName: h, field: f, width: w, filter: 'agTextColumnFilter', floatingFilter: false };
      if (pin) def.pinned = pin;
      return def;
    };
    const grp = (h: string, children: any[]): any => ({ headerName: h, marryChildren: true, children } as ColGroupDef);

    const wmrColDefs: any[] = [
      // Pinned identifiers (from ProjectIDs join) + Sl No.
      { headerName: 'Sl No.', valueGetter: (p: any) => p.data?._wmrType ? '' : (p.data?._seq ?? ''), width: 60, pinned: 'left', filter: false, sortable: false },
      { headerName: 'Cluster', field: 'Cluster', width: 220, pinned: 'left', filter: 'agTextColumnFilter', floatingFilter: false,
        cellStyle: (p: any) => {
          if (p.data?._wmrType === 'cluster') return { fontWeight: 900, fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center' };
          if (p.data?._wmrType === 'project') return { fontWeight: 800, fontSize: '12px', cursor: 'pointer', paddingLeft: '20px', display: 'flex', alignItems: 'center' };
          return null;
        },
        cellRenderer: (p: any) => {
          if (!p.data?._wmrType) return p.value || '';
          const ch = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-right:6px">${p.data._collapsed ? '<polyline points="9 18 15 12 9 6"></polyline>' : '<polyline points="6 9 12 15 18 9"></polyline>'}</svg>`;
          return `${ch}<span>${p.data._label}&ensp;&mdash;&ensp;${p.data._cnt} well(s)</span>`;
        }},
      { headerName: 'Project', field: 'Project', width: 160, pinned: 'left', filter: 'agTextColumnFilter', floatingFilter: false },

      // Client cols 2–6 (no group)
      col('Rig No.',                         'rig_no',                 80),
      col('Well Location',                   'well_location',         140),
      col('Well Name (after Spud)',           'well_name_after_spud',  160),
      col('PDO Well ID',                     'pdo_well_id',           120),
      col('Well Type',                       'well_type',             140),

      // Client cols 7–8
      grp('Coordinates', [
        col('Northing',                      'northing',              110),
        col('Easting',                       'easting',               110),
      ]),

      // Client cols 9–13
      grp('WBS No', [
        col('Location(DD)',                  'locationdd',            130),
        col('Flow line(DL)',                 'flow_linedl',           120),
        col('Location PO NO',               'location_po_no',        130),
        col('Location PO Recvd Date',        'location_po_recvd_date',150),
        col('Location - Purpose Value',      'location___purpose_value',160),
      ]),

      // Client cols 14–24 (no group)
      col('Last week Exp.Rig On Location (SAP data)',    'last_week_exp_rig_on_location_sap_data',    160),
      col('Latest Exp.Rig On Location (SAP data)',       'latest_exp_rig_on_location_sap_data',       160),
      col('Exp.Rig Off Location (SAP data)',             'exp_rig_off_location_sap_data',              150),
      col('Date - Material PO Placed',                   'date___material_po_placed',                  150),
      col('Date - Material Available at Site',           'date___material_available_at_site',           170),
      col('SCR No.',                                     'scr_no',                                       100),
      col('SCR Date',                                    'scr_date',                                     110),
      col('MOC Raised',                                  'moc_raised',                                   130),
      col('MOC Approved',                                'moc_approved',                                  130),
      col('Buffer Status',                               'buffer_status',                                 130),
      col('Actual Pegged Date',                          'actual_pegged_date',                            140),

      // Client cols 25–49
      grp('Location Preparation', [
        col('Last week cum progress (%)',                                                            'last_week_cum_progress',                                                       140),
        col('Cum progress for This week (%)',                                                        'cum_progress_for_this_week',                                                   150),
        col('Actual Start date',                                                                     'actual_start_date',                                                            130),
        col('Actual Date ODC requested Field Programmer (OSO33X) for ESP / PCP Surface cables',     'actual_date_odc_requested_field_programmer_oso33x_for_esp_pcp_surface_cables',  200),
        col('Date OSO33X call out for cable installation to PCP / ESP Vendor',                      'date_oso33x_call_out_for_cable_installation_to_pcp_esp_vendor',                 200),
        col('Delivery of ESP / PCP Surface cable by Field Programmer (OSO33X)',                     'delivery_of_esp_pcp_surface_cable_by_field_programmer_oso33x',                  200),
        col('Installation of ESP / PCP Surface cable by Vendors',                                   'installation_of_esp_pcp_surface_cable_by_vendors',                             170),
        col('Actual finish Date',                                                                    'actual_finish_date',                                                           130),
        col('FLAF Issue Date',                                                                       'flaf_issue_date',                                                              130),
        col('RAMZ ID',                                                                               'ramz_id',                                                                      100),
        col('RAMZ ID Received Date (Same day as FLAF issue Date)',                                  'ramz_id_received_date_same_day_as_flaf_issue_date',                            200),
        col('Date of Site Survey Report Issuance',                                                  'date_of_site_survey_report_issuance',                                           170),
        col('Well Engineer to add location name in EDM',                                            'well_engineer_to_add_location_name_in_edm',                                     180),
        col('Actual date ODC requested Field Programmer (OSO33X) to Install ESP / PCP Skid',       'actual_date_odc_requested_field_programmer_oso33x_to_install_esp_pcp_skid',     200),
        col('Actual date Field Programmer (OSO33X) requested ESP / PCP vendor to install the Skid','actual_date_field_programmer_oso33x_requested_esp_pcp_vendor_to_install_the_skid',200),
        col('Actual date PCP / ESP Vendor delivered the skid',                                      'actual_date_pcp_esp_vendor_delivered_the_skid',                                 170),
        col('Actual Installation Date by vendor of ESP/PCP skid',                                  'actual_installation_date_by_vendor_of_esp_pcp_skid',                            180),
        col('Flow line PO NO',                                                                       'flow_line_po_no',                                                              130),
        col('F/L PO recd. Date',                                                                     'f_l_po_recd__date',                                                            140),
        col('Flowline - Purpose Value',                                                              'flowline___purpose_value',                                                     160),
        col('Station Name/ No',                                                                      'station_name_no',                                                              130),
        col('Physical Tie in Port Number',                                                           'physical_tie_in_port_number',                                                   150),
        col('Date of Tie in port readiness',                                                         'date_of_tie_in_port_readiness',                                                160),
        col('Physical Tie in port Available (When FLAF Issued)',                                    'physical_tie_in_port_available_when_flaf_issued',                               180),
      ]),

      // Client cols 50–52
      grp('Engineering (Design Package)', [
        col('Engineering Actual Start Date',  'engineering_actual_start_date',  160),
        col('Engineering Actual Finish Date', 'engineering_actual_finish_date', 160),
        col('Progress (%)',                   'progress',                        100),
      ]),

      // Client cols 53–62
      grp('Construction (including Fab. & Installation)', [
        col('FL dia',                                                                         'fl_dia',                                                                              80),
        col('FL Length (Meter)',                                                              'fl_length_meter',                                                                    130),
        col('Const. Actual Start Date',                                                      'const__actual_start_date',                                                           150),
        col('Const. Complete Date (including F/L Final Hydro test) 1 day before Rig on date','const__complete_date_including_f_l_final_hydro_test_1_day_before_rig_on_date',        200),
        col('Flowline Construction Progress (%)',                                             'flowline_construction_progress',                                                     160),
        col('OHL Length (Meter)',                                                             'ohl_length_meter',                                                                   130),
        col('OHL Progress',                                                                  'ohl_progress',                                                                       110),
        col('OHL completion Date',                                                           'ohl_completion_date',                                                                140),
        col('Z6 data submitted date',                                                        'z6_data_submitted_date',                                                             150),
        col('SAP notification received date (Z6) 2 days before Eng. completion',            'sap_notification_received_date_z6_2_days_before_eng__completion',                    200),
      ]),

      // Client cols 63–82
      grp('Eng & Commissioning', [
        col('Actual Rig on Date',                                                                                        'actual_rig_on_date',                                                                     140),
        col('Actual Rig off Date',                                                                                       'actual_rig_off_date',                                                                    140),
        col('WLCTF acceptance/approval from Production',                                                                 'wlctf_acceptanceapproval_from_production',                                               180),
        col('Actual Hoist /FBU / RSR on date',                                                                          'actual_hoist_fbu_rsr_on_date',                                                           160),
        col('Actual Hoist /FBU / RSR off date',                                                                         'actual_hoist_fbu_rsr_off_date',                                                          160),
        col('Wellpad handover-2 (from Hoist / FBU / RSR off Date)',                                                     'wellpad_handover_2_from_hoist_fbu_rsr_off_date',                                         200),
        col('Completion type (Rig/ FBU or RSR /Hoist)',                                                                 'completion_type_rig_fbu_or_rsr_hoist',                                                   170),
        col('Actual Eng. Completion Date',                                                                               'actual_eng__completion_date',                                                            160),
        col('Actual Comm. Start date',                                                                                   'actual_comm__start_date',                                                                150),
        col('Actual Comm. Finish date (with in 2 days from Actual Engg. Completion Date)',                              'actual_comm__finish_date_with_in_2_days_from_actual_engg__completion_date',               200),
        col('Engg KPI after Rig-Off (Days)',                                                                             'engg_kpi_after_rig_off_days',                                                            150),
        col('Data Error',                                                                                                'data_error',                                                                              120),
        col('Reason if KPI Not Met',                                                                                     'reason_if_kpi_not_met',                                                                   160),
        col('Remark (Status / Area of attention / Issues)',                                                              'remark_status_area_of_attention_issues_',                                                 190),
        col('RLMU submitted to HO-Date (With in 7 days from Actual Comm.)',                                             'rlmu_submitted_to_ho_date_with_in_7_days_from_actual_comm_',                              200),
        col('Flow line Test pack / completion doc. submission Date to QS Dept.',                                        'flow_line_test_pack_completion_doc__submission_date_to_qs_dept_',                         200),
        col('Flow line Test pack / completion Progress %',                                                              'flow_line_test_pack_completion_progress',                                                  160),
        col('Over All progress Percentages',                                                                             'over_all_progress_percentages',                                                           160),
        col('SSFD Wells',                                                                                                'ssfd_wells',                                                                               100),
        col('IPM',                                                                                                       'ipm',                                                                                       80),
      ]),

      // Client cols 83–92
      grp('Location Preparation PMS (%)', [
        col('ACCESS ROAD (5%)',                             'access_road_5',                       130),
        col('EARTH WORK (60%)',                             'earth_work_60',                       130),
        col('CELLAR (20%)',                                 'cellar_20',                           110),
        col('BEAM PUMP BASE / ESP/ PCP FOUNDATION (5%)',   'beam_pump_base_esp_pcp_foundation_5', 200),
        col('EARTHING (1%)',                                'earthing_1',                          110),
        col('SEPTIC TANK (1%)',                             'septic_tank_1',                       120),
        col('Water (2%)',                                   'water_2',                              90),
        col('WASTE WATER (2%)',                             'waste_water_2',                       120),
        col('HDPE LINER INSTALAT (4%)',                     'hdpe_liner_instalat_4',               150),
        col('Overall Loc. Preparation (10%) (100%)',        'overall_loc__preparation_10_100',     170),
      ]),

      // Client cols 93–99
      grp('Engineering %', [
        col('Site Survey (5%)',                             'site_survey_5',                       130),
        col('Survey Report Issue (5%)',                     'survey_report_issue_5',               160),
        col('Design Sta (5%)',                              'design_sta_5',                        120),
        col('Design Completed & Issue for TA2 (5%) (40%)', 'design_completed_issue_for_ta2_5_40', 190),
        col('Approved by (15%)',                            'approved_by_15',                       130),
        col('AFC (3%) (30%)',                               'afc_3_30',                             120),
        col('Overall Engg. (10%) (100%)',                   'overall_engg__10_100',                 160),
      ]),

      // Client cols 100–103
      grp('Material Availability (%)', [
        col('Piping / mech (50%)',            'piping_mech_50',          140),
        col('Elect (30%)',                    'elect_30',                 110),
        col('Instr (20%)',                    'instr_20',                 110),
        col('Overall Material (10%) (100%)',  'overall_material_10_100',  160),
      ]),

      // Client cols 104–109
      grp('Flow line (%)', [
        col('Cold b (2%)',                                          'cold_b_2',                                     100),
        col('Sleeper Pre Cast+ Ins (15%)',                          'sleeper_pre_cast_ins_15',                       160),
        col('CS Pipe welding + NDT (10% RT for OP, 100% for 60%)', 'cs_pipe_welding_ndt_10_rt_for_op_100_for_60',   200),
        col('PE Fussion & Pull (20%)',                              'pe_fussion_pull_20',                            150),
        col('Final Hydro T (3%)',                                   'final_hydro_t_3',                               130),
        col('Overall Const. (10%) (100%)',                          'overall_const__10_100',                         150),
      ]),

      // Client cols 110–114
      grp('OHL', [
        col('Pole hole drill (40%)',   'pole_hole_drill_40',   140),
        col('Pole Erect (40%)',        'pole_erect_40',         120),
        col('Conductor String (18%)', 'conductor_string_18',   150),
        col('OHL ti (2%)',             'ohl_ti_2',               90),
        col('Overall OHL Progr (100%)','overall_ohl_progr_100', 150),
      ]),

      // Client cols 115–119
      grp('Commissioning (%)', [
        col('Mechani (60%)',               'mechani_60',              120),
        col('Electri (15%)',               'electri_15',              110),
        col('Instrumentat (20%)',          'instrumentat_20',          130),
        col('Overall Comm (Mi (5%)',       'overall_comm_mi_5',        140),
        col('Overall Comm Progress (100%)','overall_comm_progress_100',160),
      ]),

      // Client cols 120–127
      grp('Overall Status', [
        col('Location Preparation Status (In progress / Completed)', 'location_preparation_status_in_progress_completed', 200),
        col('Flow line Const. Status (In progress / Completed)',     'flow_line_const__status_in_progress_completed',     200),
        col('Flow line Commi. Status (In progress / Completed)',     'flow_line_commi__status_in_progress_completed',     200),
        col('Well Year / White Space',                               'well_year_white_space',                              140),
        col('Reasons for year 2018',                                 'reasons_for_year_2018',                              150),
        col('Column7',                                               'column7',                                             90),
        col('Digital WMR Import Remarks',                            'digital_wmr_import_remarks',                          170),
      ]),
    ];

    setTimeout(() => {
      const el = document.getElementById('rp-wmr-grid');
      if (el && typeof agGrid !== 'undefined') {
        el.innerHTML = '';
        this._wmrApi = agGrid.createGrid(el, {
          columnDefs:   wmrColDefs,
          rowData:      flatRows,
          defaultColDef: {
            sortable:    true,
            resizable:   true,
            filter:      'agTextColumnFilter',
            floatingFilter: true,
            suppressHeaderMenuButton: true,
            wrapText:    true,
            autoHeight:  true,
            cellStyle:   { fontSize: '12px', display: 'flex', alignItems: 'center', whiteSpace: 'normal', overflow: 'hidden' },
          },
          rowClassRules: {
            'wmr-cluster-row': (p: any) => p.data?._wmrType === 'cluster',
            'wmr-project-row': (p: any) => p.data?._wmrType === 'project',
          },
          getRowHeight: (params: any) => {
            if (params.data?._wmrType === 'cluster') return 34;
            if (params.data?._wmrType === 'project') return 28;
            return undefined;
          },
          onCellClicked: (e: any) => {
            if (e.data?._wmrType === 'cluster') {
              const c = e.data._cluster;
              this._wmrCollapsedClusters.has(c) ? this._wmrCollapsedClusters.delete(c) : this._wmrCollapsedClusters.add(c);
              this._wmrApi?.setGridOption('rowData', this._buildWmrFlatRows());
            } else if (e.data?._wmrType === 'project') {
              const key = `${e.data._cluster}__${e.data._project}`;
              this._wmrCollapsedProjects.has(key) ? this._wmrCollapsedProjects.delete(key) : this._wmrCollapsedProjects.add(key);
              this._wmrApi?.setGridOption('rowData', this._buildWmrFlatRows());
            }
          },
          animateRows: true,
        });
      }
    });
  }

  onEdit(r: SavedReport): void {
    this.router.navigate(['/report-builder'], { queryParams: { id: r.id } });
  }

  onDelete(r: SavedReport): void {
    if (!confirm(`Delete report "${r.name}"?`)) return;
    deleteReport(r.id);
    this.refresh();
  }

  vizLabel(t: ReportVizType): string {
    return ({ bar: 'Bar', pie: 'Pie', donut: 'Donut', line: 'Line', kpi: 'KPI', list: 'List' } as Record<string,string>)[t] || t;
  }

  vizColor(t: ReportVizType): string {
    return ({ bar: 'blue', pie: 'amber', donut: 'green', line: 'purple', kpi: 'red', list: 'slate' } as Record<string,string>)[t] || 'slate';
  }

  /** Icon key for a report card. PH Productivity is a tabular report, so it
      shows a table icon regardless of its stored visualisation type. */
  cardIcon(r: SavedReport): string {
    if (r.id === 'rep-seed-ph-productivity') return 'table';
    return r.vizType;
  }

  formatDate(iso: string): string {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      const dd = ('0' + d.getDate()).slice(-2);
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const mmm = months[d.getMonth()];
      const yy = String(d.getFullYear()).slice(-2);
      return dd + '-' + mmm + '-' + yy;
    } catch { return iso; }
  }

  trackById = (_: number, item: SavedReport) => item.id;

  private _computeModalStats(): void {
    if (!this.selectedReport) { this.modalStats = []; return; }
    const r = this.selectedReport;
    const rows = this._genRows();
    const gby  = r.groupBy || '';
    const fn   = r.aggregateFn || 'count';
    const acol = r.aggregateColumn || '';
    const groups: Record<string, number[]> = {};
    rows.forEach((row: any) => {
      const k = String(row[gby] ?? 'Unknown');
      if (!groups[k]) groups[k] = [];
      if (fn === 'count') groups[k].push(1);
      else { const n = parseFloat(String(row[acol])); if (!isNaN(n)) groups[k].push(n); }
    });
    const labels = Object.keys(groups);
    const values = labels.map(k => {
      const a = groups[k];
      if (fn === 'count') return a.length;
      if (fn === 'sum')   return a.reduce((s, v) => s + v, 0);
      if (fn === 'avg')   return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
      return 0;
    });
    const total  = values.reduce((s, v) => s + v, 0);
    const maxIdx = values.length ? values.indexOf(Math.max(...values)) : 0;
    const minIdx = values.length ? values.indexOf(Math.min(...values)) : 0;
    const fnLbl  = fn === 'count' ? 'Count' : fn.charAt(0).toUpperCase() + fn.slice(1);

    // All computable metrics, keyed for selective display.
    const all: Record<ReportMetricKey, {lbl: string, num: string, sd: string, variant: string}> = {
      records:        { lbl: 'RECORDS IN SCOPE', num: String(rows.length),   sd: (r.sourceTableName || '') + ' · total rows',        variant: '' },
      distinctGroups: { lbl: 'DISTINCT GROUPS',  num: String(labels.length), sd: 'unique ' + (gby || 'group') + ' values',          variant: '' },
      highestGroup:   { lbl: 'HIGHEST GROUP',    num: labels[maxIdx] || '—',  sd: fnLbl + ': ' + Math.round(values[maxIdx] || 0),     variant: 'good' },
      lowestGroup:    { lbl: 'LOWEST GROUP',     num: labels[minIdx] || '—',  sd: fnLbl + ': ' + Math.round(values[minIdx] || 0),     variant: 'bad' },
      total:          { lbl: fn === 'count' ? 'TOTAL COUNT' : fnLbl.toUpperCase() + ' TOTAL', num: String(Math.round(total)), sd: 'across all groups', variant: '' },
      avgPerGroup:    { lbl: 'AVG PER GROUP',    num: labels.length ? (total / labels.length).toFixed(1) : '0', sd: 'mean ' + fnLbl.toLowerCase() + ' per group', variant: '' }
    };
    const chosen: ReportMetricKey[] = (r.metrics && r.metrics.length)
      ? r.metrics
      : ['records', 'distinctGroups', 'highestGroup', 'total'];
    this.modalStats = chosen.filter(k => all[k]).map(k => all[k]);
  }

  private _renderModalChart(): void {
    if (!this.selectedReport) return;
    const r = this.selectedReport;
    const canvas = document.getElementById('rp-modal-canvas') as HTMLCanvasElement;
    if (!canvas) return;
    if (this._mc) { try { this._mc.destroy(); } catch {} this._mc = null; }
    const Chart = (window as any).Chart;
    if (!Chart) return;
    const rows = this._genRows();
    const gby  = r.groupBy || '';
    const fn   = r.aggregateFn || 'count';
    const acol = r.aggregateColumn || '';
    if (!gby || !rows.length) return;
    const groups: Record<string, number[]> = {};
    rows.forEach((row: any) => {
      const k = String(row[gby] ?? 'Unknown');
      if (!groups[k]) groups[k] = [];
      if (fn === 'count') groups[k].push(1);
      else { const n = parseFloat(String(row[acol])); if (!isNaN(n)) groups[k].push(n); }
    });
    const labels = Object.keys(groups);
    const values = labels.map(k => {
      const a = groups[k];
      if (fn === 'count') return a.length;
      if (fn === 'sum')   return a.reduce((s, v) => s + v, 0);
      if (fn === 'avg')   return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
      return 0;
    });
    const isPie = r.vizType === 'pie' || r.vizType === 'donut';
    const pal = ['#29378d','#00B050','#FFC000','#FF0000','#1F3864','#00B0F0','#7F7F7F','#A5A5A5'];
    this._mc = new Chart(canvas, {
      type: r.vizType === 'donut' ? 'doughnut' : (r.vizType === 'pie' ? 'pie' : r.vizType as string),
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: isPie ? labels.map((_, i) => pal[i % pal.length]) : 'rgba(41,55,141,0.65)',
          borderColor: isPie ? '#fff' : 'rgba(41,55,141,1)',
          borderWidth: isPie ? 2 : 0,
          borderRadius: isPie ? 0 : 4,
          tension: r.vizType === 'line' ? 0.3 : 0,
          fill: r.vizType === 'line',
          pointRadius: r.vizType === 'line' ? 3 : 0
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: isPie, position: 'bottom', labels: { font: { size: 11 }, usePointStyle: true, padding: 12 } },
          tooltip: { callbacks: { label: (c: any) => ` ${c.label}: ${c.parsed.y ?? c.parsed}` } }
        },
        scales: isPie ? {} : {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#1F3864' } },
          y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 10 }, color: '#1F3864' } }
        }
      }
    });
  }

  private _mockRows(tableId: string): any[] {
    if (tableId === 'wells') return [
      { well_id:'34565',cluster:'NIMR',    status:'On Track', discipline:'Mechanical', progress:78, penalty:0,     rig_on:'2026-04-28' },
      { well_id:'34561',cluster:'NIMR',    status:'At Risk',  discipline:'Civil',      progress:64, penalty:19000, rig_on:'2026-05-12' },
      { well_id:'31780',cluster:'NIMR',    status:'Critical', discipline:'Mechanical', progress:62, penalty:52000, rig_on:'2026-03-17' },
      { well_id:'36078',cluster:'NIMR',    status:'Ahead',    discipline:'Electrical', progress:81, penalty:0,     rig_on:'2026-03-15' },
      { well_id:'34422',cluster:'AL BURJ', status:'On Track', discipline:'Mechanical', progress:71, penalty:0,     rig_on:'2026-04-22' },
      { well_id:'37797',cluster:'AL BURJ', status:'Critical', discipline:'Civil',      progress:47, penalty:48000, rig_on:'2026-04-10' },
      { well_id:'34357',cluster:'AL BURJ', status:'At Risk',  discipline:'Mechanical', progress:58, penalty:21000, rig_on:'2026-04-30' },
      { well_id:'24665',cluster:'AL BURJ', status:'On Track', discipline:'Instrument', progress:88, penalty:0,     rig_on:'2026-04-05' },
      { well_id:'30330',cluster:'AMIN',    status:'On Track', discipline:'Civil',      progress:75, penalty:0,     rig_on:'2026-05-08' },
      { well_id:'36076',cluster:'AMIN',    status:'Ahead',    discipline:'Mechanical', progress:92, penalty:0,     rig_on:'2026-03-29' },
      { well_id:'36075',cluster:'AMIN',    status:'On Track', discipline:'Electrical', progress:68, penalty:0,     rig_on:'2026-05-15' },
      { well_id:'36106',cluster:'AMIN',    status:'At Risk',  discipline:'Instrument', progress:52, penalty:18000, rig_on:'2026-05-20' },
      { well_id:'33146',cluster:'TUQAA',   status:'On Track', discipline:'Mechanical', progress:73, penalty:0,     rig_on:'2026-05-01' },
      { well_id:'33147',cluster:'TUQAA',   status:'On Track', discipline:'Civil',      progress:80, penalty:0,     rig_on:'2026-04-18' },
      { well_id:'33152',cluster:'TUQAA',   status:'Critical', discipline:'Mechanical', progress:41, penalty:67000, rig_on:'2026-04-25' },
      { well_id:'33153',cluster:'TUQAA',   status:'Critical', discipline:'Mechanical', progress:38, penalty:71000, rig_on:'2026-05-25' },
      { well_id:'36748',cluster:'RAKID',   status:'On Track', discipline:'Electrical', progress:76, penalty:0,     rig_on:'2026-04-12' },
      { well_id:'36749',cluster:'RAKID',   status:'Ahead',    discipline:'Civil',      progress:95, penalty:0,     rig_on:'2026-03-20' },
      { well_id:'36757',cluster:'RAKID',   status:'On Track', discipline:'Mechanical', progress:72, penalty:0,     rig_on:'2026-05-03' },
      { well_id:'36758',cluster:'RAKID',   status:'At Risk',  discipline:'Instrument', progress:55, penalty:16000, rig_on:'2026-05-18' }
    ];
    if (tableId === 'crews') return [
      { crew_id:'CW-001',discipline:'Mechanical', p_rating:'P6',hours:184,utilization:92 },
      { crew_id:'CW-002',discipline:'Mechanical', p_rating:'P5',hours:176,utilization:88 },
      { crew_id:'CW-003',discipline:'Mechanical', p_rating:'P7',hours:192,utilization:96 },
      { crew_id:'CW-004',discipline:'Civil',      p_rating:'P6',hours:168,utilization:84 },
      { crew_id:'CW-005',discipline:'Civil',      p_rating:'P5',hours:172,utilization:86 },
      { crew_id:'CW-006',discipline:'Civil',      p_rating:'P4',hours:158,utilization:79 },
      { crew_id:'CW-007',discipline:'Civil',      p_rating:'P6',hours:180,utilization:90 },
      { crew_id:'CW-008',discipline:'Civil',      p_rating:'P5',hours:176,utilization:88 },
      { crew_id:'CW-009',discipline:'Electrical', p_rating:'P7',hours:188,utilization:94 },
      { crew_id:'CW-010',discipline:'Electrical', p_rating:'P6',hours:184,utilization:92 },
      { crew_id:'CW-011',discipline:'Instrument', p_rating:'P6',hours:180,utilization:90 },
      { crew_id:'CW-012',discipline:'Instrument', p_rating:'P5',hours:172,utilization:86 },
      { crew_id:'CW-013',discipline:'Mechanical', p_rating:'P8',hours:196,utilization:98 },
      { crew_id:'CW-014',discipline:'Mechanical', p_rating:'P5',hours:174,utilization:87 },
      { crew_id:'CW-015',discipline:'Civil',      p_rating:'P6',hours:178,utilization:89 },
      { crew_id:'CW-016',discipline:'Electrical', p_rating:'P5',hours:170,utilization:85 },
      { crew_id:'CW-017',discipline:'Electrical', p_rating:'P4',hours:162,utilization:81 },
      { crew_id:'CW-018',discipline:'Instrument', p_rating:'P7',hours:186,utilization:93 },
      { crew_id:'CW-019',discipline:'Instrument', p_rating:'P5',hours:174,utilization:87 },
      { crew_id:'CW-020',discipline:'Mechanical', p_rating:'P6',hours:182,utilization:91 }
    ];
    if (tableId === 'phprod') return PH_PROD_ROWS;
    return [];
  }

  // ── Job Progress helpers ────────────────────────────────────────────
  private _jSum(a: (number|null)[]): number { return a.reduce((s, x) => s + (x || 0), 0) as number; }
  private _jCmPlan(w: any): number|null { return w.isNew ? null : this._jSum(w.wk.map((x: any) => x[0])); }
  private _jCmAct(w: any):  number { return this._jSum(w.wk.map((x: any) => x[1])); }
  private _jCumCurAct(w: any): number { return w.cumA + this._jCmAct(w); }
  private _jRvCumPriorAct(w: any): number { return w.purpose * w.cumA / 100; }
  private _jRvCmPlan(w: any): number|null { const p = this._jCmPlan(w); return p === null ? null : w.purpose * p / 100; }
  private _jRvCmAct(w: any):  number { return w.purpose * this._jCmAct(w) / 100; }
  private _jRvCumPlan(w: any): number|null { const p = this._jCmPlan(w); return p === null ? null : w.purpose * (w.cumA + p) / 100; }
  private _jRvCumAct(w: any): number { return w.purpose * this._jCumCurAct(w) / 100; }
  private _jStatus(w: any): string {
    if (w.isNew) return 'New well';
    const d = this._jCmAct(w) - (this._jCmPlan(w) || 0);
    return d < -2 ? 'Behind' : d > 2 ? 'Ahead' : 'On track';
  }
  private _jMoney(n: number): string {
    return 'OMR ' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n));
  }
  private _jFmt(n: number|null): string { return n === null ? '\u2014' : String(n); }

  private _filteredJobRows(): any[] {
    return JOB_DATA.filter(w =>
      (this.jpFilter.cluster === 'All' || w.cluster === this.jpFilter.cluster) &&
      (this.jpFilter.category === 'All' || w.cat === this.jpFilter.category)
    );
  }

  private _renderJobView(): void {
    this.jpLoading = true;
    const { cluster, category } = this.jpFilter;
    const url = `/api/v1/wells/reports/job-progress?cluster=${encodeURIComponent(cluster)}&category=${encodeURIComponent(category)}`;
    this._http.get<any>(url).subscribe({
      next: (resp) => {
        if (!this.jpClusters.length)   this.jpClusters   = resp.clusters   ?? [];
        if (!this.jpCategories.length) this.jpCategories = resp.categories ?? [];
        this._buildJpGrid(resp.rows ?? []);
        this.jpLoading = false;
      },
      error: (err) => {
        console.error('[JobProgress] API error', err);
        this.jpLoading = false;
      }
    });
  }

  private _buildJobCards(rows: any[]): string {
    if (!rows.length) return '<div style="padding:16px;color:#7F7F7F;text-align:center">No wells match current filters.</div>';
    const tp = rows.reduce((s: number, r: any) => s + r.purpose, 0) || 1;
    const wAvg = (fn: (r: any) => number) => rows.reduce((s: number, r: any) => s + r.purpose * fn(r), 0) / tp;
    const planAgg   = wAvg(r => r.isNew ? 0 : (this._jCmPlan(r) || 0));
    const actAgg    = wAvg(r => this._jCmAct(r));
    const cumActAgg = wAvg(r => this._jCumCurAct(r));
    const cmActRev  = rows.reduce((s: number, r: any) => s + this._jRvCmAct(r), 0);
    const cumActRev = rows.reduce((s: number, r: any) => s + this._jRvCumAct(r), 0);
    const behind    = rows.filter(r => this._jStatus(r) === 'Behind').length;
    const news      = rows.filter(r => r.isNew).length;
    const v = actAgg - planAgg;
    const vc = v >= 0 ? '#00B050' : '#FF0000';
    const vspan = `<span style="color:${vc};font-weight:700">${v >= 0 ? '\u25b2' : '\u25bc'} ${Math.abs(v).toFixed(1)} pts</span>`;
    const actBadgeC = actAgg >= planAgg ? 'green' : (actAgg >= planAgg * 0.9 ? 'amber' : 'red');
    const cumBadgeC = cumActAgg >= 70 ? 'green' : (cumActAgg >= 50 ? 'amber' : 'red');
    const behBadgeC = behind === 0 ? 'green' : (behind <= 2 ? 'amber' : 'red');
    const barIco   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
    const gaugeIco = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const cardIco  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`;
    const trendIco = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`;
    const warnIco  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    const plusIco  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`;
    const card = (color: string, lbl: string, badge: string, badgeC: string, num: string, sd: string, ico: string) =>
      `<div class="rp-scard rp-scard--${color}">
        <div class="rp-scard-head">
          <div class="rp-scard-meta">
            <span class="rp-scard-lbl">${lbl}</span>
            <span class="rp-scard-badge rp-scard-badge--${badgeC}">${badge}</span>
          </div>
          <div class="rp-scard-ico">${ico}</div>
        </div>
        <div class="rp-scard-num">${num}</div>
        <div class="rp-scard-sd">${sd}</div>
      </div>`;
    return `<div class="rp-jcards">
      ${card('blue',   'Current-Month Plan vs Actual', actAgg.toFixed(1)+'%',     actBadgeC, `${planAgg.toFixed(1)}% / ${actAgg.toFixed(1)}%`, `Variance ${vspan} (Actual &minus; Plan)`, barIco)}
      ${card('blue',   'Cum Current Actual %',         cumActAgg.toFixed(1)+'%',  cumBadgeC, `${cumActAgg.toFixed(1)}%`,                        'Cum prior actual + current month', gaugeIco)}
      ${card('purple', 'Current-Month Actual Revenue', Math.round(actAgg)+'%',    'amber',   this._jMoney(cmActRev),                            'Purpose value &times; CM actual %', cardIco)}
      ${card('purple', 'Cum Current Actual Revenue',   Math.round(cumActAgg)+'%', 'amber',   this._jMoney(cumActRev),                            'Purpose value &times; cum actual %', trendIco)}
      ${card(behind ? 'red' : 'green', 'Wells Behind Plan', behind+' / '+rows.length, behBadgeC, String(behind), 'Actual &lt; plan by &gt; 2 pts', warnIco)}
      ${card('blue',   'New Wells',                    String(news),              news > 0 ? 'amber' : 'green', String(news), 'Added after monthly freeze (plan blank)', plusIco)}
    </div>`;
  }

  private _buildJobTable(rows: any[]): string {
    if (!rows.length) return '<div style="padding:20px;text-align:center;color:#7F7F7F">No wells match current filters.</div>';
    const TH = 'padding:11px 14px;border:1px solid #2a4a86;font-size:12.5px;font-weight:700;white-space:nowrap;text-align:center';
    const TD = 'padding:9px 14px;border:1px solid #E3E7ED;font-size:13px;white-space:nowrap;text-align:center';
    const vcell = (p: number|null, a: number): string => {
      if (p === null) return `<td style="${TD}">${a}</td>`;
      const beh = a < p - 0.001, ahd = a > p + 0.001;
      const bg  = beh ? 'background:#fde8e8;color:#9c0006;font-weight:700' : (ahd ? 'background:#e7f6ec;color:#06632b;font-weight:700' : '');
      return `<td style="${TD};${bg}">${a}</td>`;
    };
    const money = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n));
    const NCOL = 26;
    let h = `<table style="border-collapse:collapse;width:100%;font-size:11.5px;min-width:1300px">
      <thead>
      <tr style="background:#1F3864;color:#fff">
        <th rowspan="2" style="${TH};text-align:left;min-width:80px">Well ID</th>
        <th rowspan="2" style="${TH};text-align:left;min-width:150px">Well Name</th>
        <th rowspan="2" style="${TH};min-width:100px">PO No</th>
        <th rowspan="2" style="${TH};min-width:72px">WBS</th>
        <th colspan="2" style="${TH}">Cum Prior</th>`;
    WK_LABELS.forEach(l => h += `<th colspan="2" style="${TH}">${l}</th>`);
    h += `<th colspan="2" style="${TH}">Current Month</th>
        <th rowspan="2" style="${TH};min-width:80px">P vs A</th>
        <th rowspan="2" style="${TH};min-width:70px">Finish</th>
        <th rowspan="2" style="${TH}">Status</th>
        <th colspan="5" style="${TH}">Revenue (OMR)</th>
      </tr>
      <tr style="background:#16294d;color:#fff;font-size:10px">
        <th style="${TH}">Plan</th><th style="${TH}">Act</th>`;
    for (let i = 0; i < 5; i++) h += `<th style="${TH}">P</th><th style="${TH}">A</th>`;
    h += `<th style="${TH}">Plan</th><th style="${TH}">Act</th>
        <th style="${TH}">Cum Prior Act</th><th style="${TH}">CM Plan</th>
        <th style="${TH}">CM Act</th><th style="${TH}">Cum Plan</th><th style="${TH}">Cum Act</th>
      </tr></thead><tbody>`;
    const cats = [...new Set(rows.map((r: any) => r.cat))] as string[];
    let g = [0, 0, 0, 0, 0];
    cats.forEach(cat => {
      const cr = rows.filter((r: any) => r.cat === cat);
      h += `<tr style="background:#D6E4F0;font-weight:800;color:#1F3864;font-size:11px">
        <td colspan="${NCOL}" style="${TD};text-align:left;background:#D6E4F0;color:#1F3864;letter-spacing:.3px">\u25b8 ${cat.toUpperCase()} \u2014 ${cr.length} well(s)</td></tr>`;
      let sub = [0, 0, 0, 0, 0];
      cr.forEach((w: any) => {
        const cp = this._jCmPlan(w), ca = this._jCmAct(w), st = this._jStatus(w);
        const rev = [this._jRvCumPriorAct(w), this._jRvCmPlan(w) || 0, this._jRvCmAct(w), this._jRvCumPlan(w) || 0, this._jRvCumAct(w)];
        sub[0] += rev[0]; sub[1] += rev[1]; sub[2] += rev[2]; sub[3] += rev[3]; sub[4] += rev[4];
        const bcolor = st === 'Behind' ? '#FF0000' : st === 'Ahead' ? '#00B050' : st === 'New well' ? '#7c3aed' : '#94a3b8';
        const bbg    = st === 'Behind' ? '#fee2e2' : st === 'Ahead' ? '#dcfce7' : st === 'New well' ? '#ede9fe' : '#f1f5f9';
        const pw = cp === null ? 0 : Math.min(100, cp * 2.2);
        const aw = Math.min(100, ca * 2.2);
        h += `<tr>
          <td style="${TD};text-align:left;font-weight:600;color:#1F3864">${w.well}${w.isNew ? ' <span style="background:#ede9fe;color:#6d28d9;font-size:9px;padding:1px 5px;border-radius:999px;font-weight:700">NEW</span>' : ''}</td>
          <td style="${TD};text-align:left">${w.name}</td>
          <td style="${TD}">${w.po}</td><td style="${TD}">${w.wbs}</td>
          <td style="${TD}">${w.isNew ? '\u2014' : w.cumP}</td>
          <td style="${TD}">${w.cumA}</td>`;
        w.wk.forEach((x: any) => {
          h += `<td style="${TD}">${x[0] === null ? '\u2014' : x[0]}</td>`;
          const beh2 = x[0] !== null && x[1] < x[0] - 0.001;
          const ahd2 = x[0] !== null && x[1] > x[0] + 0.001;
          h += `<td style="${TD};${beh2 ? 'background:#fde8e8;color:#9c0006;font-weight:700' : (ahd2 ? 'background:#e7f6ec;color:#06632b;font-weight:700' : '')}">${x[1]}</td>`;
        });
        h += `<td style="${TD}">${cp === null ? '\u2014' : cp}</td>`;
        h += vcell(cp, ca);
        h += `<td style="${TD}"><div style="display:inline-flex;flex-direction:column;gap:2px;width:72px">
          <div style="height:5px;border-radius:3px;background:#e2e8f0;position:relative;overflow:hidden"><div style="position:absolute;left:0;top:0;bottom:0;width:${pw}%;border-radius:3px;background:#94a3b8"></div></div>
          <div style="height:5px;border-radius:3px;background:#e2e8f0;position:relative;overflow:hidden"><div style="position:absolute;left:0;top:0;bottom:0;width:${aw}%;border-radius:3px;background:#29378d"></div></div>
        </div></td>`;
        h += `<td style="${TD}">${w.tf}</td>`;
        h += `<td style="${TD}"><span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;background:${bbg};color:${bcolor}">${st}</span></td>`;
        h += `<td style="${TD}">${money(rev[0])}</td>`;
        h += `<td style="${TD}">${this._jRvCmPlan(w) === null ? '\u2014' : money(rev[1])}</td>`;
        h += `<td style="${TD}">${money(rev[2])}</td>`;
        h += `<td style="${TD}">${this._jRvCumPlan(w) === null ? '\u2014' : money(rev[3])}</td>`;
        h += `<td style="${TD}">${money(rev[4])}</td></tr>`;
      });
      const SPAN = NCOL - 5;
      h += `<tr style="background:#eef3fa;font-weight:700">
        <td colspan="${SPAN}" style="${TD};text-align:left;background:#eef3fa">Subtotal \u2014 ${cat}</td>
        ${sub.map(x => `<td style="${TD};background:#eef3fa">${money(x)}</td>`).join('')}</tr>`;
      g[0] += sub[0]; g[1] += sub[1]; g[2] += sub[2]; g[3] += sub[3]; g[4] += sub[4];
    });
    h += `<tr style="background:#1F3864;color:#fff;font-weight:800">
      <td colspan="${NCOL - 5}" style="${TD};background:#1F3864;color:#fff;text-align:left">GRAND TOTAL</td>
      ${g.map(x => `<td style="${TD};background:#1F3864;color:#fff">${money(x)}</td>`).join('')}</tr>`;
    h += '</tbody></table>';
    return h;
  }

  private _buildJobRevenue(rows: any[]): string {
    const tp = rows.reduce((s: number, r: any) => s + r.purpose, 0);
    const a  = rows.reduce((s: number, r: any) => s + this._jRvCumPriorAct(r), 0);
    const b  = rows.reduce((s: number, r: any) => s + (this._jRvCmPlan(r) || 0), 0);
    const c  = rows.reduce((s: number, r: any) => s + this._jRvCmAct(r), 0);
    const d  = rows.reduce((s: number, r: any) => s + (this._jRvCumPlan(r) || 0), 0);
    const e  = rows.reduce((s: number, r: any) => s + this._jRvCumAct(r), 0);
    const m  = (n: number) => 'OMR ' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n));
    const row = (lbl: string, val: string) => `<tr><td>${lbl}</td><td>${val}</td></tr>`;
    return `<table>
      ${row('Total purpose value',           m(tp))}
      ${row('Cum prior actual revenue',      m(a))}
      ${row('Current-month plan revenue',    m(b))}
      ${row('Current-month actual revenue',  m(c))}
      ${row('Cum current plan revenue',      m(d))}
      ${row('Cum current actual revenue',    m(e))}
    </table>`;
  }

  private _renderSCurve(rows: any[]): void {
    const canvas = document.getElementById('jp-scurve-canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const Chart = (window as any).Chart;
    if (!Chart) return;
    if (this._sc) { try { this._sc.destroy(); } catch {} this._sc = null; }
    const tp = rows.reduce((s: number, r: any) => s + r.purpose, 0) || 1;
    const base = rows.reduce((s: number, r: any) => s + r.purpose * r.cumA, 0) / tp;
    const planPts = [base], actPts = [base];
    for (let i = 0; i < 5; i++) {
      planPts.push(planPts[planPts.length - 1] + rows.reduce((s: number, r: any) => s + r.purpose * (r.wk[i][0] || 0), 0) / tp);
      actPts.push(actPts[actPts.length - 1]  + rows.reduce((s: number, r: any) => s + r.purpose * (r.wk[i][1] || 0), 0) / tp);
    }
    this._sc = new Chart(canvas, {
      type: 'line',
      data: {
        labels: ['Prior', 'W1', 'W2', 'W3', 'W4', 'W5'],
        datasets: [
          { label: 'Cumulative Plan %',   data: planPts.map(x => +x.toFixed(1)), borderColor: '#94a3b8', backgroundColor: 'rgba(148,163,184,.18)', fill: true, tension: .4, borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#94a3b8' },
          { label: 'Cumulative Actual %', data: actPts.map(x => +x.toFixed(1)),  borderColor: '#29378d', backgroundColor: 'rgba(41,55,141,.18)',   fill: true, tension: .4, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#29378d' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 14, font: { size: 12 }, usePointStyle: true, padding: 20 } }
        },
        scales: {
          y: { ticks: { callback: (v: any) => v + '%', font: { size: 11 } }, grid: { color: 'rgba(0,0,0,0.05)' } },
          x: { ticks: { font: { size: 12 } }, grid: { display: false } }
        }
      }
    });
  }

  // ── Daily Plan helpers ──────────────────────────────────────────────────────
  private _filteredDailyRows(): any[] {
    return this._allDailyRows.filter((w: any) => {
      if (this.dpFilter.type !== 'All') {
        if (this.dpFilter.type === 'ATNM' && !w.atnm) return false;
        if (this.dpFilter.type === 'Sub-Contractor' && w.atnm) return false;
      }
      if (this.dpFilter.location  !== 'All' && w.loc  !== this.dpFilter.location)  return false;
      if (this.dpFilter.category  !== 'All' && w.cat  !== this.dpFilter.category)  return false;
      if (this.dpFilter.discipline !== 'All' && w.disc !== this.dpFilter.discipline) return false;
      if (this.dpFilter.wellId && !w.well.toLowerCase().includes(this.dpFilter.wellId.toLowerCase())) return false;
      return true;
    });
  }

  private _applyDpFilters(): void {
    const rows = this._filteredDailyRows();
    this._buildDpGrid(rows);
  }

  private _loadDailyPlan(): void {
    this.dpLoading = true;
    this._http.get<any[]>('/api/v1/wells/reports/daily-plan').subscribe({
      next: (rows) => {
        this._allDailyRows = rows ?? [];
        this._dpLoaded = true;
        this.dpCategories = [...new Set((rows ?? []).map((r: any) => r.cat).filter(Boolean))].sort();
        this.dpLocations  = [...new Set((rows ?? []).map((r: any) => r.loc).filter(Boolean))].sort();
        this.dpLoading = false;
        this._applyDpFilters();
      },
      error: (err) => {
        console.error('[DailyPlan] API error', err);
        this.dpLoading = false;
      }
    });
  }

  private _renderDailyView(): void {
    if (!this._dpLoaded) {
      this._loadDailyPlan();
    } else {
      this._applyDpFilters();
    }
  }

  private _buildDailyCards(rows: any[]): string {
    const distinct = (arr: string[]) => [...new Set(arr)];
    const sumF = (fn: (r: any) => number) => rows.reduce((s: number, r: any) => s + fn(r), 0);
    const atnmN = rows.filter((r: any) => r.atnm).length;
    const scN   = rows.length - atnmN;
    const locs  = distinct(rows.map((r: any) => r.loc));
    const discs = distinct(rows.map((r: any) => r.disc));
    const eqpt  = sumF((r: any) => r.eqpt);
    const veh   = sumF((r: any) => r.veh);
    const man   = sumF((r: any) => r.man);
    const atnmPct = rows.length ? Math.round(atnmN / rows.length * 100) : 0;
    const calIco   = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
    const usersIco = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
    const userIco  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    const truckIco = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`;
    const toolIco  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
    const card = (color: string, lbl: string, badge: string, badgeC: string, num: string, sd: string, ico: string) =>
      `<div class="rp-scard rp-scard--${color}">
        <div class="rp-scard-head">
          <div class="rp-scard-meta">
            <span class="rp-scard-lbl">${lbl}</span>
            <span class="rp-scard-badge rp-scard-badge--${badgeC}">${badge}</span>
          </div>
          <div class="rp-scard-ico">${ico}</div>
        </div>
        <div class="rp-scard-num">${num}</div>
        <div class="rp-scard-sd">${sd}</div>
      </div>`;
    return `<div class="rp-jcards">
      ${card('blue',   'Activities Planned Today', String(rows.length), 'blue',  String(rows.length), `Across ${locs.length} location(s)`, calIco)}
      ${card('blue',   'ATNM vs Sub-Contractor',   atnmPct+'%',         atnmPct >= 50 ? 'green' : 'amber', `${atnmN} / ${scN}`, 'ATNM listed first', usersIco)}
      ${card('green',  'Total Manpower',            String(man),         'green', String(man),         'Planned crew headcount', userIco)}
      ${card('amber',  'Equipment / Vehicles',      String(eqpt+veh),   'amber', `${eqpt} / ${veh}`,  'Eqpt &amp; heavy/light vehicles', truckIco)}
      ${card('purple', 'Disciplines',               String(discs.length),'blue', String(discs.length), discs.join(', '), toolIco)}
    </div>`;
  }

  private _buildDailyTable(rows: any[]): string {
    if (!rows.length) return '<div style="padding:20px;text-align:center;color:#7F7F7F">No activities match current filters.</div>';
    const TH = 'padding:14px 16px;border:1px solid #2a4a86;font-size:14px;font-weight:700;white-space:nowrap;text-align:center';
    const TD = 'padding:12px 16px;border:1px solid #E3E7ED;font-size:15px;white-space:nowrap';
    const NCOL = 18;
    let h = `<table style="border-collapse:collapse;width:100%;font-size:14px;min-width:1700px">
      <thead>
      <tr style="background:#1F3864;color:#fff">
        <th style="${TH}">Sl.No</th>
        <th style="${TH}">Type</th>
        <th style="${TH}">Discipline</th>
        <th style="${TH};text-align:left">Well ID</th>
        <th style="${TH};text-align:left;min-width:140px">PA Name</th>
        <th style="${TH};min-width:130px">PA Mob</th>
        <th style="${TH};text-align:left;min-width:160px">PH (ID) Name</th>
        <th style="${TH};min-width:130px">PH Mob</th>
        <th style="${TH}">PO No</th>
        <th style="${TH}">WBS</th>
        <th style="${TH}">Category</th>
        <th style="${TH}">Location</th>
        <th style="${TH};text-align:left;min-width:170px">Job Title / Project</th>
        <th style="${TH};text-align:left;min-width:210px">Activities</th>
        <th style="${TH}">Manpower</th>
        <th style="${TH}">Equipment</th>
        <th style="${TH}">Vehicles</th>
        <th style="${TH}">Remarks</th>
      </tr>
      </thead><tbody>`;
    const sorted = [...rows].sort((a: any, b: any) =>
      (a.atnm === b.atnm ? 0 : (a.atnm ? -1 : 1)) || a.loc.localeCompare(b.loc) || a.well.localeCompare(b.well));
    let sl = 0;
    ['ATNM', 'Sub-Contractor'].forEach(grp => {
      const gr = sorted.filter((w: any) => (w.atnm ? 'ATNM' : 'Sub-Contractor') === grp);
      if (!gr.length) return;
      h += `<tr style="background:#D6E4F0;font-weight:800;color:#1F3864;font-size:13px">
        <td colspan="${NCOL}" style="${TD};background:#D6E4F0;color:#1F3864;letter-spacing:.3px">\u25b8 ${grp} \u2014 ${gr.length} activity(ies)</td></tr>`;
      gr.forEach((w: any, i: number) => {
        sl++;
        const badge = w.atnm
          ? `<span style="background:#D6E4F0;color:#1F3864;font-weight:700;font-size:12px;padding:3px 9px;border-radius:5px">ATNM</span>`
          : `<span style="background:#EEF3F9;color:#475569;font-weight:700;font-size:12px;padding:3px 9px;border-radius:5px">SC</span>`;
        const rowBg = i % 2 !== 0 ? 'background:#f8fafc' : '';
        h += `<tr style="${rowBg}">
          <td style="${TD};text-align:center">${sl}</td>
          <td style="${TD};text-align:center">${badge}</td>
          <td style="${TD};text-align:center">${w.disc}</td>
          <td style="${TD};font-weight:700;color:#1F3864">${w.well}</td>
          <td style="${TD}">${w.pa}</td>
          <td style="${TD};text-align:center;color:#29378d;font-weight:600">${w.paMob}</td>
          <td style="${TD}">${w.phName}<br><span style="color:#7F7F7F;font-size:12px">${w.phId}</span></td>
          <td style="${TD};text-align:center;color:#29378d;font-weight:600">${w.phMob}</td>
          <td style="${TD};text-align:center">${w.po}</td>
          <td style="${TD};text-align:center">${w.wbs}</td>
          <td style="${TD};text-align:center">${w.cat}</td>
          <td style="${TD};text-align:center">${w.loc}</td>
          <td style="${TD}">${w.job}</td>
          <td style="${TD}">${w.act}</td>
          <td style="${TD};text-align:center;font-weight:700">${w.man}</td>
          <td style="${TD};text-align:center;font-weight:700">${w.eqpt}</td>
          <td style="${TD};text-align:center;font-weight:700">${w.veh}</td>
          <td style="${TD};color:#7F7F7F">${w.rem || ''}</td>
        </tr>`;
      });
    });
    h += '</tbody></table>';
    return h;
  }

  // ── Export helpers ──────────────────────────────────────────────────────────
  /** Recursively flatten ColGroupDef tree to leaf { header, field } pairs */
  private _flattenCols(defs: any[], group = ''): { header: string; field: string }[] {
    const out: { header: string; field: string }[] = [];
    for (const col of defs) {
      if (col.children?.length) {
        const prefix = group ? `${group} / ${col.headerName}` : col.headerName;
        out.push(...this._flattenCols(col.children, prefix));
      } else if (col.field) {
        out.push({ header: group ? `${group} / ${col.headerName}` : col.headerName, field: col.field });
      }
    }
    return out;
  }

  exportJpExcel(): void {
    const X: any = require('xlsx-js-style');

    const today      = new Date();
    const reportDate = today.toISOString().slice(0, 10);
    const reportDateFmt = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const monthLabel = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + ' Report';
    const { cluster } = this.jpFilter;
    const reportTitle = `JOB PROGRESS REPORT${cluster !== 'All' ? ' \u2014 ' + cluster.toUpperCase() : ''}`;

    const cols      = this._flattenCols(this.jpColDefs);
    const NC        = cols.length;
    const pctFlds   = new Set(['CumPriorActualPct','W1PlanPct','W1ActualPct','W2PlanPct','W2ActualPct',
                                'W3PlanPct','W3ActualPct','W4PlanPct','W4ActualPct',
                                'W5PlanPct','W5ActualPct','CmPlanPct','CmActualPct']);
    const moneyFlds = new Set(['CumPriorMonthActual','CmPlanRevenue','CmActualRevenue',
                                'CumCmPlanRevenue','CumCmActualRevenue']);
    const fmtVal = (field: string, val: any): any => {
      if (val == null || val === '') return '';
      if (field === 'TargetEnd')    return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      if (pctFlds.has(field))       return `${Number(val).toFixed(2)}%`;
      if (moneyFlds.has(field))     return Number(val);
      return val;
    };

    // ── Style helpers ────────────────────────────────────────────────────
    const fl  = (rgb: string) => ({ patternType: 'solid', fgColor: { rgb } });
    const fn  = (rgb: string, sz: number, bold = false, italic = false) =>
                ({ name: 'Calibri', sz, bold, italic, color: { rgb } });
    const bd  = (rgb: string, st = 'thin') => ({ style: st, color: { rgb } });
    const ab  = (rgb: string, st = 'thin') =>
                ({ top: bd(rgb, st), bottom: bd(rgb, st), left: bd(rgb, st), right: bd(rgb, st) });

    const S: { [k: string]: any } = {
      company:  { fill: fl('1F3864'), font: fn('FFFFFF', 16, true),  border: ab('FFFFFF', 'medium'), alignment: { horizontal: 'center', vertical: 'center' } },
      contract: { fill: fl('D6E4F0'), font: fn('1F3864', 10, true),  border: ab('2E5096', 'medium'), alignment: { horizontal: 'center', vertical: 'center' } },
      metaBlank:{ fill: fl('F0F4FA') },
      metaR:    { fill: fl('F0F4FA'), font: fn('374151', 9, false, true), alignment: { horizontal: 'right', vertical: 'center' } },
      title:    { fill: fl('2E5096'), font: fn('FFFFFF', 12, true),  border: ab('FFFFFF', 'medium'), alignment: { horizontal: 'left', vertical: 'center', indent: 1 } },
      sep:      { fill: fl('EFF3FB') },
      colHdr:   { fill: fl('1F3864'), font: fn('FFFFFF', 9,  true),  border: ab('FFFFFF', 'thin'),   alignment: { horizontal: 'center', vertical: 'center', wrapText: true } },
      grpHdr:   { fill: fl('2E5096'), font: fn('FFFFFF', 10, true),  border: ab('8FAFD6', 'thin'),   alignment: { horizontal: 'left',   vertical: 'center', indent: 1 } },
      subTot:   { fill: fl('BFDBFE'), font: fn('1E3A8A', 9,  true),  border: ab('2E5096', 'medium'), alignment: { horizontal: 'center', vertical: 'center' } },
      dataO:    { fill: fl('FFFFFF'), font: fn('1F2937', 9),         border: ab('D1D5DB', 'thin'),   alignment: { horizontal: 'left',   vertical: 'center', wrapText: true } },
      dataE:    { fill: fl('F8FAFC'), font: fn('1F2937', 9),         border: ab('D1D5DB', 'thin'),   alignment: { horizontal: 'left',   vertical: 'center', wrapText: true } },
      numO:     { fill: fl('FFFFFF'), font: fn('1F2937', 9, true),   border: ab('D1D5DB', 'thin'),   alignment: { horizontal: 'center', vertical: 'center' } },
      numE:     { fill: fl('F8FAFC'), font: fn('1F2937', 9, true),   border: ab('D1D5DB', 'thin'),   alignment: { horizontal: 'center', vertical: 'center' } },
      grand:    { fill: fl('1E3A5F'), font: fn('FFFFFF', 10, true),  border: ab('FFFFFF', 'medium'), alignment: { horizontal: 'center', vertical: 'center' } },
    };

    // ── Worksheet helpers ─────────────────────────────────────────────────
    const ws: any = { '!merges': [], '!rows': [], '!cols': [] };
    let maxR = 0;
    const setC = (r: number, c: number, v: any, s: any): void => {
      ws[X.utils.encode_cell({ r, c })] = { v: v ?? '', t: typeof v === 'number' ? 'n' : 's', s };
      if (r > maxR) maxR = r;
    };
    const mrg = (r1: number, c1: number, r2: number, c2: number): void =>
      ws['!merges'].push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
    const fillRow = (r: number, s: any): void => {
      for (let c = 0; c < NC; c++) {
        const addr = X.utils.encode_cell({ r, c });
        if (!ws[addr]) ws[addr] = { v: '', t: 's', s }; else ws[addr].s = s;
      }
    };
    const rowHts: Array<{ hpt: number }> = [];

    // ── Header rows ───────────────────────────────────────────────────────
    // Row 0 – Company (merged)
    setC(0, 0, 'AL TASNIM ENTERPRISES LLC.', S['company']);
    mrg(0, 0, 0, NC - 1); fillRow(0, S['company']); rowHts.push({ hpt: 36 });

    // Row 1 – Contract (merged)
    setC(1, 0, 'CONTRACT NO. C3100000177, OFF PLOT DELIVERY CONTRACT (ODC SOUTH)', S['contract']);
    mrg(1, 0, 1, NC - 1); fillRow(1, S['contract']); rowHts.push({ hpt: 28 });

    // Row 2 – Report date (single cell)
    fillRow(2, S['metaBlank']);
    setC(2, NC - 1, `Report Date: ${reportDateFmt}`, S['metaR']); rowHts.push({ hpt: 18 });

    // Row 3 – Report title (merged full width)
    setC(3, 0, reportTitle, S['title']);
    mrg(3, 0, 3, NC - 1);
    fillRow(3, S['title']); rowHts.push({ hpt: 28 });

    // Row 4 – Separator
    fillRow(4, S['sep']); rowHts.push({ hpt: 6 });

    // Row 5 – Column headers
    for (let c = 0; c < NC; c++)
      setC(5, c, cols[c].header.replace(/.*\/ /, ''), S['colHdr']);
    rowHts.push({ hpt: 36 });

    // ── Data rows ─────────────────────────────────────────────────────────
    let R = 6;
    const numFlds = new Set([...pctFlds, ...moneyFlds]);
    let even = false;

    for (const row of this.jpRowData) {
      if (row._type === 'group') {
        const label = `\u25b8 ${(row._groupLabel || '').toUpperCase()} \u2014 ${row._groupCount} well(s)`;
        setC(R, 0, label, S['grpHdr']);
        mrg(R, 0, R, NC - 1); fillRow(R, S['grpHdr']);
        rowHts.push({ hpt: 22 }); R++; even = false;
      } else if (row._type === 'subtotal') {
        for (let c = 0; c < NC; c++) {
          const v = fmtVal(cols[c].field, row[cols[c].field]);
          setC(R, c, v, S['subTot']);
        }
        rowHts.push({ hpt: 20 }); R++;
      } else {
        const ds = even ? S['dataE'] : S['dataO'];
        const nm = even ? S['numE']  : S['numO'];
        for (let c = 0; c < NC; c++) {
          const v = fmtVal(cols[c].field, row[cols[c].field]);
          setC(R, c, v, numFlds.has(cols[c].field) ? nm : ds);
        }
        rowHts.push({ hpt: 18 }); R++; even = !even;
      }
    }

    // Grand total (pinned bottom)
    if (this.jpPinnedBottom.length) {
      for (let c = 0; c < NC; c++) {
        const v = fmtVal(cols[c].field, this.jpPinnedBottom[0][cols[c].field]);
        setC(R, c, v, S['grand']);
      }
      rowHts.push({ hpt: 24 });
    }

    // ── Finalize ──────────────────────────────────────────────────────────
    ws['!ref']  = X.utils.encode_range({ r: 0, c: 0 }, { r: R, c: NC - 1 });
    ws['!cols'] = cols.map(c => ({ wch: Math.max(c.header.replace(/.*\/ /, '').length + 4, 12) }));
    ws['!rows'] = rowHts;

    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Job Progress');
    const buf = X.write(wb, { type: 'array', bookType: 'xlsx' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `Job_Progress_${reportDate}.xlsx`);
  }

  exportJpCustomExcel(): void {
    this.showJpCustomPanel = false;
    const selGroups = this.jpCustomColDefs.filter(g => g.sel);
    if (!selGroups.length) { alert('Select at least one column group.'); return; }
    // # column always first, then selected groups expanded to flat cols
    const cols: Array<{ header: string; field: string }> = [
      { header: '#', field: 'SlNo' },
      ...selGroups.flatMap(g => g.cols),
    ];
    const NC = cols.length;

    const X: any = require('xlsx-js-style');
    const today      = new Date();
    const reportDate = today.toISOString().slice(0, 10);
    const reportDateFmt = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const monthLabel = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + ' Report';
    const { cluster } = this.jpFilter;
    const reportTitle = `JOB PROGRESS REPORT (CUSTOM)${cluster !== 'All' ? ' \u2014 ' + cluster.toUpperCase() : ''}`;

    const pctFlds   = new Set(['CumPriorActualPct','W1PlanPct','W1ActualPct','W2PlanPct','W2ActualPct',
                                'W3PlanPct','W3ActualPct','W4PlanPct','W4ActualPct',
                                'W5PlanPct','W5ActualPct','CmPlanPct','CmActualPct']);
    const moneyFlds = new Set(['CumPriorMonthActual','CmPlanRevenue','CmActualRevenue',
                                'CumCmPlanRevenue','CumCmActualRevenue']);
    const fmtVal = (field: string, val: any): any => {
      if (val == null || val === '') return '';
      if (field === 'TargetEnd')    return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      if (pctFlds.has(field))       return `${Number(val).toFixed(2)}%`;
      if (moneyFlds.has(field))     return Number(val);
      return val;
    };

    const fl  = (rgb: string) => ({ patternType: 'solid', fgColor: { rgb } });
    const fn  = (rgb: string, sz: number, bold = false, italic = false) =>
                ({ name: 'Calibri', sz, bold, italic, color: { rgb } });
    const bd  = (rgb: string, st = 'thin') => ({ style: st, color: { rgb } });
    const ab  = (rgb: string, st = 'thin') =>
                ({ top: bd(rgb, st), bottom: bd(rgb, st), left: bd(rgb, st), right: bd(rgb, st) });

    const S: { [k: string]: any } = {
      company:  { fill: fl('1F3864'), font: fn('FFFFFF', 16, true),  border: ab('FFFFFF', 'medium'), alignment: { horizontal: 'center', vertical: 'center' } },
      contract: { fill: fl('D6E4F0'), font: fn('1F3864', 10, true),  border: ab('2E5096', 'medium'), alignment: { horizontal: 'center', vertical: 'center' } },
      metaBlank:{ fill: fl('F0F4FA') },
      metaR:    { fill: fl('F0F4FA'), font: fn('374151', 9, false, true), alignment: { horizontal: 'right', vertical: 'center' } },
      title:    { fill: fl('2E5096'), font: fn('FFFFFF', 12, true),  border: ab('FFFFFF', 'medium'), alignment: { horizontal: 'left', vertical: 'center', indent: 1 } },
      sep:      { fill: fl('EFF3FB') },
      colHdr:   { fill: fl('1F3864'), font: fn('FFFFFF', 9,  true),  border: ab('FFFFFF', 'thin'),   alignment: { horizontal: 'center', vertical: 'center', wrapText: true } },
      grpHdr:   { fill: fl('2E5096'), font: fn('FFFFFF', 10, true),  border: ab('8FAFD6', 'thin'),   alignment: { horizontal: 'left',   vertical: 'center', indent: 1 } },
      subTot:   { fill: fl('BFDBFE'), font: fn('1E3A8A', 9,  true),  border: ab('2E5096', 'medium'), alignment: { horizontal: 'center', vertical: 'center' } },
      dataO:    { fill: fl('FFFFFF'), font: fn('1F2937', 9),         border: ab('D1D5DB', 'thin'),   alignment: { horizontal: 'left',   vertical: 'center', wrapText: true } },
      dataE:    { fill: fl('F8FAFC'), font: fn('1F2937', 9),         border: ab('D1D5DB', 'thin'),   alignment: { horizontal: 'left',   vertical: 'center', wrapText: true } },
      numO:     { fill: fl('FFFFFF'), font: fn('1F2937', 9, true),   border: ab('D1D5DB', 'thin'),   alignment: { horizontal: 'center', vertical: 'center' } },
      numE:     { fill: fl('F8FAFC'), font: fn('1F2937', 9, true),   border: ab('D1D5DB', 'thin'),   alignment: { horizontal: 'center', vertical: 'center' } },
      grand:    { fill: fl('1E3A5F'), font: fn('FFFFFF', 10, true),  border: ab('FFFFFF', 'medium'), alignment: { horizontal: 'center', vertical: 'center' } },
    };

    const ws: any = { '!merges': [], '!rows': [], '!cols': [] };
    let maxR = 0;
    const setC = (r: number, c: number, v: any, s: any): void => {
      ws[X.utils.encode_cell({ r, c })] = { v: v ?? '', t: typeof v === 'number' ? 'n' : 's', s };
      if (r > maxR) maxR = r;
    };
    const mrg = (r1: number, c1: number, r2: number, c2: number): void =>
      ws['!merges'].push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
    const fillRow = (r: number, s: any): void => {
      for (let c = 0; c < NC; c++) {
        const addr = X.utils.encode_cell({ r, c });
        if (!ws[addr]) ws[addr] = { v: '', t: 's', s }; else ws[addr].s = s;
      }
    };
    const rowHts: Array<{ hpt: number }> = [];

    // Row 0 – Company
    setC(0, 0, 'AL TASNIM ENTERPRISES LLC.', S['company']);
    mrg(0, 0, 0, NC - 1); fillRow(0, S['company']); rowHts.push({ hpt: 36 });
    // Row 1 – Contract
    setC(1, 0, 'CONTRACT NO. C3100000177, OFF PLOT DELIVERY CONTRACT (ODC SOUTH)', S['contract']);
    mrg(1, 0, 1, NC - 1); fillRow(1, S['contract']); rowHts.push({ hpt: 28 });
    // Row 2 – Report date (single cell)
    fillRow(2, S['metaBlank']);
    setC(2, NC - 1, `Report Date: ${reportDateFmt}`, S['metaR']); rowHts.push({ hpt: 18 });
    // Row 3 – Title (merged full width)
    setC(3, 0, reportTitle, S['title']);
    mrg(3, 0, 3, NC - 1);
    fillRow(3, S['title']); rowHts.push({ hpt: 28 });
    // Row 4 – Separator
    fillRow(4, S['sep']); rowHts.push({ hpt: 6 });
    // Row 5 – Column headers
    for (let c = 0; c < NC; c++) setC(5, c, cols[c].header, S['colHdr']);
    rowHts.push({ hpt: 36 });

    // Data rows
    let R = 6;
    const numFlds = new Set([...pctFlds, ...moneyFlds]);
    let even = false;
    for (const row of this.jpRowData) {
      if (row._type === 'group') {
        const label = `\u25b8 ${(row._groupLabel || '').toUpperCase()} \u2014 ${row._groupCount} well(s)`;
        setC(R, 0, label, S['grpHdr']);
        mrg(R, 0, R, NC - 1); fillRow(R, S['grpHdr']);
        rowHts.push({ hpt: 22 }); R++; even = false;
      } else if (row._type === 'subtotal') {
        for (let c = 0; c < NC; c++) {
          const v = fmtVal(cols[c].field, row[cols[c].field]);
          setC(R, c, v, S['subTot']);
        }
        rowHts.push({ hpt: 20 }); R++;
      } else {
        const ds = even ? S['dataE'] : S['dataO'];
        const nm = even ? S['numE']  : S['numO'];
        for (let c = 0; c < NC; c++) {
          const v = fmtVal(cols[c].field, row[cols[c].field]);
          setC(R, c, v, numFlds.has(cols[c].field) ? nm : ds);
        }
        rowHts.push({ hpt: 18 }); R++; even = !even;
      }
    }
    // Grand total
    if (this.jpPinnedBottom.length) {
      for (let c = 0; c < NC; c++) {
        const v = fmtVal(cols[c].field, this.jpPinnedBottom[0][cols[c].field]);
        setC(R, c, v, S['grand']);
      }
      rowHts.push({ hpt: 24 });
    }

    ws['!ref']  = X.utils.encode_range({ r: 0, c: 0 }, { r: R, c: NC - 1 });
    ws['!cols'] = cols.map(c => ({ wch: Math.max(c.header.length + 4, 12) }));
    ws['!rows'] = rowHts;
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'Job Progress');
    const buf = X.write(wb, { type: 'array', bookType: 'xlsx' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `Job_Progress_Custom_${reportDate}.xlsx`);
  }

  exportJpCustomPdf(): void {
    this.showJpCustomPanel = false;
    const selGroups = this.jpCustomColDefs.filter(g => g.sel);
    if (!selGroups.length) { alert('Select at least one column group.'); return; }
    const cols: Array<{ header: string; field: string }> = [
      { header: '#', field: 'SlNo' },
      ...selGroups.flatMap(g => g.cols),
    ];
    const NC = cols.length;

    const pctFlds   = new Set(['CumPriorActualPct','W1PlanPct','W1ActualPct','W2PlanPct','W2ActualPct',
                                'W3PlanPct','W3ActualPct','W4PlanPct','W4ActualPct',
                                'W5PlanPct','W5ActualPct','CmPlanPct','CmActualPct']);
    const moneyFlds = new Set(['CumPriorMonthActual','CmPlanRevenue','CmActualRevenue',
                                'CumCmPlanRevenue','CumCmActualRevenue']);
    const fmt = (field: string, val: any): string => {
      if (val == null || val === '') return '';
      if (field === 'TargetEnd')      return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
      if (pctFlds.has(field))         return `${Number(val).toFixed(2)}%`;
      if (moneyFlds.has(field))       return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(+val));
      return String(val);
    };

    const today       = new Date();
    const reportDate  = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const monthLabel  = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + ' Report';
    const { cluster } = this.jpFilter;
    const reportTitle = `JOB PROGRESS REPORT (CUSTOM)${cluster !== 'All' ? ' \u2014 ' + cluster.toUpperCase() : ''}`;

    let tbody = '';
    for (const row of this.jpRowData) {
      if (row._type === 'group') {
        tbody += `<tr><td colspan="${NC}" class="grp">&#9658; ${(row._groupLabel||'').toUpperCase()} &mdash; ${row._groupCount} well(s)</td></tr>`;
      } else if (row._type === 'subtotal') {
        tbody += `<tr class="sub">${cols.map(c => `<td>${fmt(c.field, row[c.field])}</td>`).join('')}</tr>`;
      } else {
        tbody += `<tr>${cols.map(c => `<td>${fmt(c.field, row[c.field])}</td>`).join('')}</tr>`;
      }
    }
    const tfoot = this.jpPinnedBottom.length
      ? `<tfoot><tr class="gtotal">${cols.map(c => `<td>${fmt(c.field, this.jpPinnedBottom[0][c.field])}</td>`).join('')}</tr></tfoot>`
      : '';

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${reportTitle}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:7px;margin:6mm;color:#111}
  .co{text-align:center;font-size:10px;font-weight:800;color:#1F3864;padding:2px 0}
  .ct{text-align:center;font-size:8px;font-weight:700;color:#1F3864;border:1.5px solid #1F3864;padding:2px 8px;margin:2px auto 4px;display:table}
  .meta{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:5px}
  .rpt-title{font-size:10px;font-weight:800;color:#1F3864;text-transform:uppercase}
  .rpt-date{font-size:7.5px;color:#475569;text-align:right}
  table{width:100%;border-collapse:collapse}
  thead th{background:#1F3864;color:#fff;padding:3px;text-align:center;font-size:6.5px;white-space:nowrap;border:1px solid #16294d}
  tbody td{padding:2px 3px;border:1px solid #d1d5db;font-size:6.5px;white-space:nowrap;text-align:center}
  tbody tr:nth-child(even) td{background:#f8fafc}
  td.grp{background:#1F3864;color:#fff;font-weight:800;font-size:7.5px;padding:3px 6px;text-align:left;border:none}
  tr.sub td{background:#dbeafe;color:#1e3a8a;font-weight:700;font-style:italic}
  tfoot td{background:#1e3a5f;color:#fff;font-weight:800;font-size:7px;padding:3px;text-align:center;border:1px solid #fff}
  @media print{@page{size:A3 landscape;margin:6mm}}
</style></head><body>
<div class="co">AL TASNIM ENTERPRISES LLC.</div>
<div class="ct">CONTRACT NO. C3100000177, OFF PLOT DELIVERY CONTRACT (ODC SOUTH)</div>
<div class="meta"><span class="rpt-title">${reportTitle}</span><span class="rpt-date">Report Date: ${reportDate}<br>${monthLabel}</span></div>
<table>
  <thead><tr>${cols.map(c => `<th>${c.header}</th>`).join('')}</tr></thead>
  <tbody>${tbody}</tbody>${tfoot}
</table>
</body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  }

  exportJpPdf(): void {
    const cols      = this._flattenCols(this.jpColDefs);
    const NC        = cols.length;
    const pctFlds   = new Set(['CumPriorActualPct','W1PlanPct','W1ActualPct','W2PlanPct','W2ActualPct',
                                'W3PlanPct','W3ActualPct','W4PlanPct','W4ActualPct',
                                'W5PlanPct','W5ActualPct','CmPlanPct','CmActualPct']);
    const moneyFlds = new Set(['CumPriorMonthActual','CmPlanRevenue','CmActualRevenue',
                                'CumCmPlanRevenue','CumCmActualRevenue']);
    const fmt = (field: string, val: any): string => {
      if (val == null || val === '') return '';
      if (field === 'TargetEnd')      return new Date(val).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
      if (pctFlds.has(field))         return `${Number(val).toFixed(2)}%`;
      if (moneyFlds.has(field))       return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(+val));
      return String(val);
    };

    const today      = new Date();
    const reportDate = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const monthLabel = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + ' Report';
    const { cluster, category } = this.jpFilter;
    const reportTitle = `JOB PROGRESS REPORT${cluster !== 'All' ? ' \u2014 ' + cluster.toUpperCase() : ''}`;

    // ── Build table rows ─────────────────────────────────────────────────
    let tbody = '';
    for (const row of this.jpRowData) {
      if (row._type === 'group') {
        tbody += `<tr><td colspan="${NC}" class="grp">&#9658; ${(row._groupLabel||'').toUpperCase()} &mdash; ${row._groupCount} well(s)</td></tr>`;
      } else if (row._type === 'subtotal') {
        tbody += `<tr class="sub">${cols.map(c => `<td>${fmt(c.field, row[c.field])}</td>`).join('')}</tr>`;
      } else {
        tbody += `<tr>${cols.map(c => `<td>${fmt(c.field, row[c.field])}</td>`).join('')}</tr>`;
      }
    }
    const tfoot = this.jpPinnedBottom.length
      ? `<tfoot><tr class="gtotal">${cols.map(c=>`<td>${fmt(c.field,this.jpPinnedBottom[0][c.field])}</td>`).join('')}</tr></tfoot>`
      : '';

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${reportTitle}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:7px;margin:6mm;color:#111}
  /* ── Company / Contract header ── */
  .co{text-align:center;font-size:10px;font-weight:800;color:#1F3864;padding:2px 0;letter-spacing:.4px}
  .ct{text-align:center;font-size:8px;font-weight:700;color:#1F3864;border:1.5px solid #1F3864;
      padding:2px 8px;margin:2px auto 4px;display:table}
  /* ── Report meta row ── */
  .meta{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:5px}
  .rpt-title{font-size:10px;font-weight:800;color:#1F3864;text-transform:uppercase;letter-spacing:.3px}
  .rpt-date{font-size:7.5px;color:#475569;text-align:right;line-height:1.5}
  /* ── Table ── */
  table{width:100%;border-collapse:collapse}
  thead th{background:#1F3864;color:#fff;padding:3px 3px;text-align:center;
           font-size:6.5px;white-space:nowrap;border:1px solid #16294d}
  tbody td{padding:2px 3px;border:1px solid #d1d5db;font-size:6.5px;white-space:nowrap;text-align:center}
  tbody tr:nth-child(even) td{background:#f8fafc}
  /* ── Category group header ── */
  td.grp{background:#1F3864;color:#fff;font-weight:800;font-size:7.5px;
         padding:3px 6px;text-align:left;border:none;letter-spacing:.3px}
  /* ── Revenue subtotal row ── */
  tr.sub td{background:#dbeafe;color:#1e3a8a;font-weight:700;font-style:italic}
  /* ── Grand total ── */
  tfoot tr.gtotal td{background:#1e3a5f;color:#fff;font-weight:800;
                     border-top:2px solid #2e75b6;font-style:normal}
  @page{size:A3 landscape;margin:6mm}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="co">AL TASNIM ENTERPRISES LLC.</div>
<div class="ct">CONTRACT NO. C3100000177, OFF PLOT DELIVERY CONTRACT (ODC SOUTH)</div>
<div class="meta">
  <div class="rpt-title">${reportTitle}</div>
  <div class="rpt-date">Report Date: ${reportDate}<br>${monthLabel}</div>
</div>
<table>
<thead><tr>${cols.map(c=>`<th>${c.header.replace(/.*\/ /,'')}</th>`).join('')}</tr></thead>
<tbody>${tbody}</tbody>
${tfoot}
</table></body></html>`;

    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to export PDF'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 600);
  }

  // ── Custom column-picker panel ────────────────────────────────────────────
  @HostListener('document:click')
  onDocClick(): void { this.showDpCustomPanel = false; this.showJpCustomPanel = false; this.showWmrCustomPanel = false; }

  toggleDpCustomPanel(e: Event): void {
    e.stopPropagation();
    this.showJpCustomPanel = false;
    this.showDpCustomPanel = !this.showDpCustomPanel;
  }

  closeDpCustomPanel(): void { this.showDpCustomPanel = false; }

  toggleJpCustomPanel(e: Event): void {
    e.stopPropagation();
    this.showDpCustomPanel = false;
    this.showJpCustomPanel = !this.showJpCustomPanel;
  }

  closeJpCustomPanel(): void { this.showJpCustomPanel = false; }

  toggleWmrCustomPanel(e: Event): void {
    e.stopPropagation();
    this.showWmrCustomPanel = !this.showWmrCustomPanel;
  }
  closeWmrCustomPanel(): void { this.showWmrCustomPanel = false; }

  shareReport(): void {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.querySelector<HTMLButtonElement>('.rp-strip-btn--share');
      if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
        btn.style.background = '#16a34a';
        setTimeout(() => { btn.innerHTML = orig; btn.style.background = ''; }, 2000);
      }
    }).catch(() => {
      prompt('Copy this link:', url);
    });
  }


  private _wmrExportRows(): { flatRows: any[]; clusters: string[] } {
    const rows = this.wmrRowData;
    const sorted = [...rows].sort((a, b) =>
      (a.Cluster || '').localeCompare(b.Cluster || '') ||
      (a.Project || '').localeCompare(b.Project || '') ||
      (a.well_name_after_spud || '').localeCompare(b.well_name_after_spud || ''));
    const clusters = [...new Set(sorted.map((r: any) => r.Cluster || 'Unknown'))] as string[];
    return { flatRows: sorted, clusters };
  }

  exportWmrPdf(): void { this._buildWmrPdf(this.wmrCustomGroups.filter(g => g.sel)); }
  exportWmrExcel(): void { this._buildWmrExcel(this.wmrCustomGroups.filter(g => g.sel)); }
  exportWmrCustomPdf(): void { this.showWmrCustomPanel = false; this._buildWmrPdf(this.wmrCustomGroups.filter(g => g.sel)); }
  exportWmrCustomExcel(): void { this.showWmrCustomPanel = false; this._buildWmrExcel(this.wmrCustomGroups.filter(g => g.sel)); }

  applyWmrCustom(): void {
    if (this._wmrApi) {
      for (const g of this.wmrCustomGroups) {
        for (const c of g.cols) { this._wmrApi.setColumnVisible(c.f, g.sel); }
      }
    }
    this.showWmrCustomPanel = false;
  }

  applyJpCustom(): void {
    if (this._jpApi) {
      for (const g of this.jpCustomColDefs) {
        for (const c of (g.cols || [])) { this._jpApi.setColumnVisible(c.field, g.sel); }
      }
    }
    this.showJpCustomPanel = false;
  }

  applyDpCustom(): void {
    if (this._dpApi) {
      const fieldMap: Record<string, string> = {
        type: 'typeLabel', well: 'well', disc: 'disc', pa: 'pa', paMob: 'paMob',
        phName: 'phName', phMob: 'phMob', po: 'po', wbs: 'wbs',
        cat: 'cat', loc: 'loc', job: 'job', act: 'act',
        man: 'man', eqpt: 'eqpt', veh: 'veh', rem: 'rem'
      };
      for (const g of this.dpCustomColDefs) {
        const f = fieldMap[g.key];
        if (f) this._dpApi.setColumnVisible(f, g.sel);
      }
    }
    this.showDpCustomPanel = false;
  }

  mailReport(): void {
    const url = window.location.href;
    const name = (this as any).selectedReport?.name || 'Well Monitoring Report';
    const subject = encodeURIComponent(`${name} — ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`);
    const body = encodeURIComponent(`Please find the report at the link below:\n\n${url}\n\n(Download PDF or Excel from the report page for an attachment.)`);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
  }

  private _buildWmrPdf(selGroups: typeof this.wmrCustomGroups): void {
    if (!this.wmrRowData.length) return;
    const allCols = selGroups.flatMap(g => g.cols);
    const NC = allCols.length + 3; // # + Cluster + Project
    const today = new Date();
    const reportDate = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const monthLabel = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + ' Report';
    const { flatRows, clusters } = this._wmrExportRows();

    let tbody = '', sl = 0;
    for (const cluster of clusters) {
      const cRows = flatRows.filter((r: any) => (r.Cluster || 'Unknown') === cluster);
      const projects = [...new Set(cRows.map((r: any) => r.Project || 'Unknown'))].sort() as string[];
      tbody += `<tr><td colspan="${NC}" class="type-grp">${cluster.toUpperCase()} &mdash; ${cRows.length} well(s)</td></tr>`;
      for (const proj of projects) {
        const pRows = cRows.filter((r: any) => (r.Project || 'Unknown') === proj);
        tbody += `<tr><td colspan="${NC}" class="grp">&#9658; ${proj.toUpperCase()} &mdash; ${pRows.length} well(s)</td></tr>`;
        for (const r of pRows) {
          tbody += `<tr><td>${++sl}</td><td>${r.Cluster||''}</td><td>${r.Project||''}</td>${allCols.map(c => `<td>${r[c.f]??''}</td>`).join('')}</tr>`;
        }
      }
    }

    const thead = `<th>#</th><th>Cluster</th><th>Project</th>${allCols.map(c => `<th>${c.h}</th>`).join('')}`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>WMR</title>
<style>
  body{font-family:Arial,sans-serif;font-size:7px;margin:5mm;color:#111}
  .co{text-align:center;font-size:10px;font-weight:800;color:#fff;background:#1F3864;padding:5px;border-radius:4px 4px 0 0;letter-spacing:.4px}
  .meta{display:flex;justify-content:space-between;align-items:flex-end;margin:4px 0}
  .rpt-title{font-size:10px;font-weight:800;color:#1F3864;text-transform:uppercase;letter-spacing:.3px}
  .rpt-date{font-size:7.5px;color:#475569;text-align:right;line-height:1.5}
  table{width:100%;border-collapse:collapse}
  thead th{background:#1F3864;color:#fff;padding:3px;text-align:center;font-size:6px;white-space:nowrap;border:1px solid #16294d}
  tbody td{padding:2px 2px;border:1px solid #d1d5db;font-size:6px;white-space:nowrap;text-align:center}
  tbody tr:nth-child(even) td{background:#f8fafc}
  td.type-grp{background:#1F3864;color:#fff;font-weight:900;font-size:8px;padding:4px 8px;text-align:left;border:none;letter-spacing:.5px}
  td.grp{background:#2E5096;color:#fff;font-weight:800;font-size:7px;padding:3px 6px 3px 20px;text-align:left;border:none}
  @page{size:A3 landscape;margin:5mm}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="co">AL TASNIM ENTERPRISES LLC.</div>
<div class="meta">
  <div class="rpt-title">CLUSTER WELL MONITORING REPORT (WMR)</div>
  <div class="rpt-date">Report Date: ${reportDate}<br>${monthLabel}</div>
</div>
<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></body></html>`;

    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to export PDF'); return; }
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => { w.print(); w.close(); }, 600);
  }

  private _buildWmrExcel(selGroups: typeof this.wmrCustomGroups): void {
    if (!this.wmrRowData.length) return;
    const X: any = require('xlsx-js-style');
    const allCols = selGroups.flatMap(g => g.cols);
    const hdrs = ['#', 'Cluster', 'Project', ...allCols.map(c => c.h)];
    const NC = hdrs.length;

    const fl  = (rgb: string) => ({ patternType: 'solid', fgColor: { rgb } });
    const fn  = (rgb: string, sz: number, bold = false) => ({ name: 'Calibri', sz, bold, color: { rgb } });
    const bd  = (rgb: string, st = 'thin') => ({ style: st, color: { rgb } });
    const ab  = (rgb: string, st = 'thin') => ({ top: bd(rgb,st), bottom: bd(rgb,st), left: bd(rgb,st), right: bd(rgb,st) });

    const S: any = {
      company:  { fill: fl('1F3864'), font: fn('FFFFFF',16,true), border: ab('FFFFFF','medium'), alignment: { horizontal:'center', vertical:'center' } },
      title:    { fill: fl('2E5096'), font: fn('FFFFFF',12,true), border: ab('FFFFFF','medium'), alignment: { horizontal:'left', vertical:'center', indent:1 } },
      colHdr:   { fill: fl('1F3864'), font: fn('FFFFFF',8,true),  border: ab('FFFFFF','thin'),   alignment: { horizontal:'center', vertical:'center', wrapText:true } },
      clGrp:    { fill: fl('1F3864'), font: fn('FFFFFF',11,true), border: ab('FFFFFF','medium'), alignment: { horizontal:'left', vertical:'center', indent:1 } },
      prGrp:    { fill: fl('2E5096'), font: fn('FFFFFF',10,true), border: ab('8FAFD6','thin'),   alignment: { horizontal:'left', vertical:'center', indent:2 } },
      dataO:    { fill: fl('FFFFFF'), font: fn('1F2937',8),       border: ab('D1D5DB','thin'),   alignment: { horizontal:'left', vertical:'center' } },
      dataE:    { fill: fl('F8FAFC'), font: fn('1F2937',8),       border: ab('D1D5DB','thin'),   alignment: { horizontal:'left', vertical:'center' } },
    };

    const ws: any = { '!merges': [], '!rows': [], '!cols': [] };
    let maxR = 0;
    const setC = (r: number, c: number, v: any, s: any) => {
      ws[X.utils.encode_cell({r,c})] = { v: v??'', t: typeof v==='number'?'n':'s', s };
      if (r > maxR) maxR = r;
    };
    const mrg = (r1:number,c1:number,r2:number,c2:number) => ws['!merges'].push({s:{r:r1,c:c1},e:{r:r2,c:c2}});
    const fillRow = (r:number, s:any) => { for (let c=0;c<NC;c++) { const a=X.utils.encode_cell({r,c}); if (!ws[a]) ws[a]={v:'',t:'s',s}; else ws[a].s=s; } };
    const rowHts: any[] = [];

    const today = new Date();
    const reportDate = today.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });

    setC(0,0,'AL TASNIM ENTERPRISES LLC.',S.company); mrg(0,0,0,NC-1); fillRow(0,S.company); rowHts.push({hpt:36});
    setC(1,0,'CLUSTER WELL MONITORING REPORT (WMR)',S.title); mrg(1,0,1,NC-1); fillRow(1,S.title); rowHts.push({hpt:28});
    setC(2,0,'Report Date:', S.dataO); setC(2,1,reportDate,S.dataO); fillRow(2,S.dataO); rowHts.push({hpt:18});

    // Row 3 ── Column GROUP headers — exact UI grid group names; blank where UI has no group
    const uiGrpName: Record<string,string> = {
      ident:    '',   // standalone cols in UI (no group header)
      coords:   'Coordinates',
      wbs:      'WBS No',
      sched:    '',   // standalone cols in UI (no group header)
      locprep:  'Location Preparation',
      engdes:   'Engineering (Design Package)',
      const:    'Construction (including Fab. & Installation)',
      engcomm:  'Eng & Commissioning',
      pms_loc:  'Location Preparation PMS (%)',
      pms_eng:  'Engineering %',
      pms_mat:  'Material Availability (%)',
      pms_fl:   'Flow line (%)',
      pms_ohl:  'OHL',
      pms_comm: 'Commissioning (%)',
      status:   'Overall Status',
    };
    const grpS  = { fill: fl('2E5096'), font: fn('FFFFFF',9,true), border: ab('FFFFFF','thin'), alignment: { horizontal:'center', vertical:'center', wrapText:true } };
    const blkHdr = { fill: fl('1F3864'), font: fn('FFFFFF',9,true), border: ab('FFFFFF','thin'), alignment: { horizontal:'center', vertical:'center' } };
    setC(3,0,'',blkHdr); setC(3,1,'',blkHdr); setC(3,2,'',blkHdr);
    let gOff = 3;
    for (const grp of selGroups) {
      const label = uiGrpName[grp.key] ?? grp.label;
      const cellS = label ? grpS : blkHdr;
      setC(3, gOff, label, cellS);
      if (grp.cols.length > 1) mrg(3, gOff, 3, gOff + grp.cols.length - 1);
      for (let i = 1; i < grp.cols.length; i++) setC(3, gOff + i, '', cellS);
      gOff += grp.cols.length;
    }
    rowHts.push({hpt:24});

    // Row 4 ── Leaf column headers
    for (let c=0;c<NC;c++) setC(4,c,hdrs[c],S.colHdr); rowHts.push({hpt:32});

    let R=5, sl=0;
    const { flatRows, clusters } = this._wmrExportRows();
    for (const cluster of clusters) {
      const cRows = flatRows.filter((r:any)=>(r.Cluster||'Unknown')===cluster);
      const projects = [...new Set(cRows.map((r:any)=>r.Project||'Unknown'))].sort() as string[];
      setC(R,0,`${cluster.toUpperCase()}  —  ${cRows.length} well(s)`,S.clGrp);
      mrg(R,0,R,NC-1); fillRow(R,S.clGrp); rowHts.push({hpt:24}); R++;
      for (const proj of projects) {
        const pRows = cRows.filter((r:any)=>(r.Project||'Unknown')===proj);
        setC(R,0,`${proj}  —  ${pRows.length} well(s)`,S.prGrp);
        mrg(R,0,R,NC-1); fillRow(R,S.prGrp); rowHts.push({hpt:20}); R++;
        let even=false;
        for (const row of pRows) {
          const ds = even?S.dataE:S.dataO;
          const vals=[++sl, row.Cluster||'', row.Project||'', ...allCols.map(c=>row[c.f]??'')];
          for (let c=0;c<NC;c++) setC(R,c,vals[c],ds);
          rowHts.push({hpt:18}); R++; even=!even;
        }
      }
    }

    ws['!ref'] = X.utils.encode_range({r:0,c:0},{r:R,c:NC-1});
    ws['!cols'] = [5,16,20,...allCols.map(()=>14)].map(w=>({wch:w}));
    ws['!rows'] = rowHts;
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'WMR');
    const buf = X.write(wb, { type:'array', bookType:'xlsx' });
    saveAs(new Blob([buf],{type:'application/octet-stream'}), `WMR_${today.toISOString().slice(0,10)}.xlsx`);
  }

  /** Shared field-value accessor for custom exports */
  private _dpFieldVal(key: string, r: any): any {
    const map: Record<string, (row: any) => any> = {
      type:   (row) => row.atnm ? 'ATNM' : 'SC',
      well:   (row) => row.well   ?? '',
      disc:   (row) => row.disc   ?? '',
      pa:     (row) => row.pa     ?? '',
      paMob:  (row) => row.paMob  ?? '',
      phName: (row) => row.phName ?? '',
      phId:   (row) => row.phId   ?? '',
      phMob:  (row) => row.phMob  ?? '',
      po:     (row) => row.po     ?? '',
      wbs:    (row) => row.wbs    ?? '',
      cat:    (row) => row.cat    ?? '',
      loc:    (row) => row.loc    ?? '',
      job:    (row) => row.job    ?? '',
      act:    (row) => row.act    ?? '',
      man:    (row) => Number(row.man)  || 0,
      eqpt:   (row) => Number(row.eqpt) || 0,
      veh:    (row) => Number(row.veh)  || 0,
      rem:    (row) => row.rem    ?? '',
    };
    return map[key]?.(r) ?? '';
  }

  exportDpCustomExcel(): void {
    this.showDpCustomPanel = false;
    const selCols = this.dpCustomColDefs.filter(c => c.sel).map(c => ({ key: c.key, label: c.label }));
    if (!selCols.length) { alert('Select at least one column.'); return; }
    const reportDate = new Date().toISOString().slice(0, 10);
    this._styledDpExcel(this._filteredDailyRows(), selCols, 'Custom Plan', `Daily_Plan_Custom_${reportDate}.xlsx`);
  }

  // ─── (old full exportDpCustomExcel body – replaced) ──────────────
  _oldDpCustomExcel_UNUSED(): void {
    const selCols = this.dpCustomColDefs.filter(c => c.sel);
    if (!selCols.length) { alert('Select at least one column.'); return; }

    const today      = new Date();
    const reportDate = today.toISOString().slice(0, 10);
    const monthLabel = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + ' Report';

    const hdrs = ['#', ...selCols.map(c => c.label)];
    const NC   = hdrs.length;
    const empty = (n: number): any[] => Array(n).fill('');

    // Company / Contract header rows
    const r1 = empty(NC); r1[Math.floor(NC / 2)] = 'AL TASNIM ENTERPRISES LLC.';
    r1[NC - 2] = 'Report Date:'; r1[NC - 1] = reportDate;
    const r2 = empty(NC); r2[Math.floor(NC / 2)] = 'CONTRACT NO. C3100000177, OFF PLOT DELIVERY CONTRACT (ODC SOUTH)';
    const r3 = empty(NC); r3[NC - 1] = monthLabel;
    const r4 = empty(NC); r4[0] = 'DAILY WORK PLAN \u2014 CREW WORK PLAN (CUSTOM)';
    const aoa: any[][] = [r1, r2, r3, r4, empty(NC), [...hdrs]];

    const rows  = this._filteredDailyRows();
    const allCats = [...new Set(rows.map((r: any) => r.cat).filter(Boolean))].sort() as string[];
    if (rows.some((r: any) => !r.cat)) allCats.push('Others');

    // Column positions for numeric totals
    const manPos  = selCols.findIndex(c => c.key === 'man')  + 1;
    const eqptPos = selCols.findIndex(c => c.key === 'eqpt') + 1;
    const vehPos  = selCols.findIndex(c => c.key === 'veh')  + 1;

    const xlTypes = [
      { label: 'ATNM',            filter: (r: any) => !!r.atnm },
      { label: 'Sub Contractors', filter: (r: any) => !r.atnm },
    ];
    let sl = 0, grandMan = 0, grandEqpt = 0, grandVeh = 0, grandPh = 0;

    for (const t of xlTypes) {
      const typeRows = rows.filter(t.filter);
      let typeMan = 0, typeEqpt = 0, typeVeh = 0;

      const th = empty(NC); th[0] = t.label.toUpperCase(); aoa.push(th);

      for (const cat of allCats) {
        const gr = (cat === 'Others' ? typeRows.filter((r: any) => !r.cat) : typeRows.filter((r: any) => r.cat === cat))
          .sort((a: any, b: any) => (a.loc || '').localeCompare(b.loc || '') || (a.well || '').localeCompare(b.well || ''));
        const sub = gr.reduce((s: any, r: any) => ({
          man: s.man + (Number(r.man) || 0), eqpt: s.eqpt + (Number(r.eqpt) || 0), veh: s.veh + (Number(r.veh) || 0),
        }), { man: 0, eqpt: 0, veh: 0 });

        const gh = empty(NC); gh[0] = cat; aoa.push(gh);
        for (const w of gr) {
          aoa.push([++sl, ...selCols.map(c => this._dpFieldVal(c.key, w))]);
        }
        typeMan += sub.man; typeEqpt += sub.eqpt; typeVeh += sub.veh;
      }

      const st = empty(NC);
      st[0] = `${t.label} TOTAL (PH Count: ${typeRows.length})`;
      if (manPos > 0)  st[manPos]  = typeMan;
      if (eqptPos > 0) st[eqptPos] = typeEqpt;
      if (vehPos > 0)  st[vehPos]  = typeVeh;
      aoa.push(st);

      grandMan += typeMan; grandEqpt += typeEqpt; grandVeh += typeVeh; grandPh += typeRows.length;
    }

    const gt = empty(NC);
    gt[0] = `GRAND TOTAL (PH Count: ${grandPh})`;
    if (manPos > 0)  gt[manPos]  = grandMan;
    if (eqptPos > 0) gt[eqptPos] = grandEqpt;
    if (vehPos > 0)  gt[vehPos]  = grandVeh;
    aoa.push(gt);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = hdrs.map(h => ({ wch: Math.max(h.length + 4, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Custom Plan');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `Daily_Plan_Custom_${reportDate}.xlsx`);
  }

  exportDpCustomPdf(): void {
    this.showDpCustomPanel = false;
    const selCols = this.dpCustomColDefs.filter(c => c.sel);
    if (!selCols.length) { alert('Select at least one column.'); return; }

    const rows     = this._filteredDailyRows();
    const today    = new Date();
    const reportDate = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const monthLabel = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + ' Report';

    const NC = selCols.length + 1; // +1 for #
    const allCats = [...new Set(rows.map((r: any) => r.cat).filter(Boolean))].sort() as string[];
    if (rows.some((r: any) => !r.cat)) allCats.push('Others');

    const manIdx  = selCols.findIndex(c => c.key === 'man');
    const eqptIdx = selCols.findIndex(c => c.key === 'eqpt');
    const vehIdx  = selCols.findIndex(c => c.key === 'veh');
    const summarySpan = manIdx >= 0 ? manIdx + 1 : NC;  // label spans up to man column

    const pdfTypes = [
      { label: 'ATNM',            filter: (r: any) => !!r.atnm },
      { label: 'Sub Contractors', filter: (r: any) => !r.atnm },
    ];
    let tbody = '', sl = 0, grandMan = 0, grandEqpt = 0, grandVeh = 0, grandPh = 0;

    for (const t of pdfTypes) {
      const typeRows = rows.filter(t.filter);
      let typeMan = 0, typeEqpt = 0, typeVeh = 0;

      tbody += `<tr><td colspan="${NC}" class="type-grp">${t.label.toUpperCase()}</td></tr>`;

      for (const cat of allCats) {
        const gr = (cat === 'Others' ? typeRows.filter((r: any) => !r.cat) : typeRows.filter((r: any) => r.cat === cat))
          .sort((a: any, b: any) => (a.loc || '').localeCompare(b.loc || '') || (a.well || '').localeCompare(b.well || ''));
        const sub = gr.reduce((s: any, r: any) => ({
          man: s.man + (Number(r.man) || 0), eqpt: s.eqpt + (Number(r.eqpt) || 0), veh: s.veh + (Number(r.veh) || 0),
        }), { man: 0, eqpt: 0, veh: 0 });

        tbody += `<tr><td colspan="${NC}" class="grp">&#9658; ${cat.toUpperCase()} &mdash; ${gr.length} activity(ies)</td></tr>`;
        for (const r of gr) {
          sl++;
          tbody += `<tr><td>${sl}</td>${selCols.map(c => `<td>${this._dpFieldVal(c.key, r)}</td>`).join('')}</tr>`;
        }
        typeMan += sub.man; typeEqpt += sub.eqpt; typeVeh += sub.veh;
      }

      // Type subtotal — label spans to man, then values, then empty for remaining
      let subCells = '';
      if (manIdx >= 0) {
        subCells  = `<td colspan="${summarySpan}" style="text-align:left">${t.label} TOTAL (PH Count: ${typeRows.length})</td>`;
        subCells += `<td>${typeMan}</td>`;
        if (eqptIdx >= 0) subCells += `<td>${typeEqpt}</td>`;
        if (vehIdx >= 0)  subCells += `<td>${typeVeh}</td>`;
        const trailingCols = NC - summarySpan - (eqptIdx >= 0 ? 1 : 0) - (vehIdx >= 0 ? 1 : 0) - 1;
        if (trailingCols > 0) subCells += `<td colspan="${trailingCols}"></td>`;
      } else {
        subCells = `<td colspan="${NC}" style="text-align:left">${t.label} TOTAL (PH Count: ${typeRows.length})</td>`;
      }
      tbody += `<tr class="type-sub">${subCells}</tr>`;

      grandMan += typeMan; grandEqpt += typeEqpt; grandVeh += typeVeh; grandPh += typeRows.length;
    }

    let gtCells = '';
    if (manIdx >= 0) {
      gtCells  = `<td colspan="${summarySpan}">GRAND TOTAL (PH Count: ${grandPh})</td>`;
      gtCells += `<td>${grandMan}</td>`;
      if (eqptIdx >= 0) gtCells += `<td>${grandEqpt}</td>`;
      if (vehIdx >= 0)  gtCells += `<td>${grandVeh}</td>`;
      const trailingCols = NC - summarySpan - (eqptIdx >= 0 ? 1 : 0) - (vehIdx >= 0 ? 1 : 0) - 1;
      if (trailingCols > 0) gtCells += `<td colspan="${trailingCols}"></td>`;
    } else {
      gtCells = `<td colspan="${NC}">GRAND TOTAL (PH Count: ${grandPh})</td>`;
    }
    const tfoot = `<tfoot><tr class="gtotal">${gtCells}</tr></tfoot>`;

    const theadCells = `<th>#</th>${selCols.map(c => `<th>${c.label}</th>`).join('')}`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Daily Plan — Custom</title>
<style>
  body{font-family:Arial,sans-serif;font-size:7px;margin:6mm;color:#111}
  .co{text-align:center;font-size:10px;font-weight:800;color:#1F3864;padding:2px 0;letter-spacing:.4px}
  .ct{text-align:center;font-size:8px;font-weight:700;color:#1F3864;border:1.5px solid #1F3864;
      padding:2px 8px;margin:2px auto 4px;display:table}
  .meta{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:5px}
  .rpt-title{font-size:10px;font-weight:800;color:#1F3864;text-transform:uppercase;letter-spacing:.3px}
  .rpt-date{font-size:7.5px;color:#475569;text-align:right;line-height:1.5}
  table{width:100%;border-collapse:collapse}
  thead th{background:#1F3864;color:#fff;padding:3px;text-align:center;font-size:6.5px;white-space:nowrap;border:1px solid #16294d}
  tbody td{padding:2px 3px;border:1px solid #d1d5db;font-size:6.5px;white-space:nowrap;text-align:center}
  tbody tr:nth-child(even) td{background:#f8fafc}
  td.type-grp{background:#1F3864;color:#fff;font-weight:900;font-size:8.5px;padding:4px 8px;text-align:left;border:none;letter-spacing:.5px;text-transform:uppercase}
  td.grp{background:#2E5096;color:#fff;font-weight:800;font-size:7.5px;padding:3px 6px 3px 20px;text-align:left;border:none;letter-spacing:.3px}
  tr.type-sub td{background:#93c5fd;color:#1e3a8a;font-weight:800}
  tfoot tr.gtotal td{background:#1e3a5f;color:#fff;font-weight:800;border-top:2px solid #2e75b6}
  @page{size:A3 landscape;margin:6mm}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="co">AL TASNIM ENTERPRISES LLC.</div>
<div class="ct">CONTRACT NO. C3100000177, OFF PLOT DELIVERY CONTRACT (ODC SOUTH)</div>
<div class="meta">
  <div class="rpt-title">DAILY WORK PLAN &mdash; CREW WORK PLAN (CUSTOM)</div>
  <div class="rpt-date">Report Date: ${reportDate}<br>${monthLabel}</div>
</div>
<table>
<thead><tr>${theadCells}</tr></thead>
<tbody>${tbody}</tbody>${tfoot}
</table></body></html>`;

    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to export PDF'); return; }
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => { w.print(); w.close(); }, 600);
  }

  // ── Styled Excel export (xlsx-js-style – already in node_modules) ──────────
  private _styledDpExcel(
    rows: any[],
    selCols: Array<{ key: string; label: string }>,
    sheetName: string,
    filename: string
  ): void {
    const X: any = require('xlsx-js-style');

    // ── Style helpers ──────────────────────────────────────────────────────
    const fl  = (rgb: string) => ({ patternType: 'solid', fgColor: { rgb } });
    const fn  = (rgb: string, sz: number, bold = false, italic = false) =>
                ({ name: 'Calibri', sz, bold, italic, color: { rgb } });
    const bd  = (rgb: string, st = 'thin') => ({ style: st, color: { rgb } });
    const ab  = (rgb: string, st = 'thin') =>
                ({ top: bd(rgb, st), bottom: bd(rgb, st), left: bd(rgb, st), right: bd(rgb, st) });

    const hdrs = ['#', ...selCols.map(c => c.label)];
    const NC   = hdrs.length;

    const wchMap: { [k: string]: number } = {
      '#': 5, 'type': 10, 'well': 12, 'disc': 14, 'pa': 18, 'paMob': 14,
      'phName': 22, 'phId': 12, 'phMob': 14, 'po': 14, 'wbs': 14,
      'cat': 18, 'loc': 16, 'job': 28, 'act': 30, 'man': 8, 'eqpt': 8, 'veh': 8, 'rem': 24,
    };
    const colWidths = [wchMap['#'], ...selCols.map(c => wchMap[c.key] ?? 14)];

    // ── Style map ──────────────────────────────────────────────────────────
    const S: { [k: string]: any } = {
      company:     { fill: fl('1F3864'), font: fn('FFFFFF', 16, true),  border: ab('FFFFFF', 'medium'), alignment: { horizontal: 'center', vertical: 'center' } },
      contract:    { fill: fl('D6E4F0'), font: fn('1F3864', 10, true),  border: ab('2E5096', 'medium'), alignment: { horizontal: 'center', vertical: 'center' } },
      metaBlank:   { fill: fl('F0F4FA') },
      metaR:       { fill: fl('F0F4FA'), font: fn('374151', 9, false, true), alignment: { horizontal: 'right', vertical: 'center' } },
      title:       { fill: fl('2E5096'), font: fn('FFFFFF', 12, true),  border: ab('FFFFFF', 'medium'), alignment: { horizontal: 'left',   vertical: 'center', indent: 1 } },
      sep:         { fill: fl('EFF3FB') },
      colHdr:      { fill: fl('1F3864'), font: fn('FFFFFF', 9,  true),  border: ab('FFFFFF', 'thin'),   alignment: { horizontal: 'center', vertical: 'center', wrapText: true } },
      typeHdr:     { fill: fl('1F3864'), font: fn('FFFFFF', 11, true),  border: ab('FFFFFF', 'medium'), alignment: { horizontal: 'left',   vertical: 'center', indent: 1 } },
      catHdr:      { fill: fl('2E5096'), font: fn('FFFFFF', 10, true),  border: ab('8FAFD6', 'thin'),   alignment: { horizontal: 'left',   vertical: 'center', indent: 2 } },
      dataO:       { fill: fl('FFFFFF'), font: fn('1F2937', 9),         border: ab('D1D5DB', 'thin'),   alignment: { horizontal: 'left',   vertical: 'center', wrapText: true } },
      dataE:       { fill: fl('F8FAFC'), font: fn('1F2937', 9),         border: ab('D1D5DB', 'thin'),   alignment: { horizontal: 'left',   vertical: 'center', wrapText: true } },
      numO:        { fill: fl('FFFFFF'), font: fn('1F2937', 9, true),   border: ab('D1D5DB', 'thin'),   alignment: { horizontal: 'center', vertical: 'center' } },
      numE:        { fill: fl('F8FAFC'), font: fn('1F2937', 9, true),   border: ab('D1D5DB', 'thin'),   alignment: { horizontal: 'center', vertical: 'center' } },
      subTotal:    { fill: fl('BFDBFE'), font: fn('1E3A8A', 9, true),   border: ab('2E5096', 'medium'), alignment: { horizontal: 'left',   vertical: 'center', indent: 1 } },
      subTotalNum: { fill: fl('BFDBFE'), font: fn('1E3A8A', 9, true),   border: ab('2E5096', 'medium'), alignment: { horizontal: 'center', vertical: 'center' } },
      grand:       { fill: fl('1E3A5F'), font: fn('FFFFFF', 10, true),  border: ab('FFFFFF', 'medium'), alignment: { horizontal: 'left',   vertical: 'center', indent: 1 } },
      grandNum:    { fill: fl('1E3A5F'), font: fn('FFFFFF', 10, true),  border: ab('FFFFFF', 'medium'), alignment: { horizontal: 'center', vertical: 'center' } },
    };

    // ── Worksheet helpers ──────────────────────────────────────────────────
    const ws: any = { '!merges': [], '!rows': [], '!cols': [] };
    let maxR = 0;
    const setC = (r: number, c: number, v: any, s: any): void => {
      ws[X.utils.encode_cell({ r, c })] = { v: v ?? '', t: typeof v === 'number' ? 'n' : 's', s };
      if (r > maxR) maxR = r;
    };
    const mrg = (r1: number, c1: number, r2: number, c2: number): void =>
      ws['!merges'].push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });
    const fillRow = (r: number, s: any): void => {
      for (let c = 0; c < NC; c++) {
        const addr = X.utils.encode_cell({ r, c });
        if (!ws[addr]) ws[addr] = { v: '', t: 's', s }; else ws[addr].s = s;
      }
    };
    const rowHts: Array<{ hpt: number }> = [];

    // ── Meta ───────────────────────────────────────────────────────────────
    const today2     = new Date();
    const reportDate = today2.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const monthLabel = today2.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + ' Report';

    // Row 0 – Company header (merged)
    setC(0, 0, 'AL TASNIM ENTERPRISES LLC.', S['company']);
    mrg(0, 0, 0, NC - 1); fillRow(0, S['company']); rowHts.push({ hpt: 36 });

    // Row 1 – Contract header (merged)
    setC(1, 0, 'CONTRACT NO. C3100000177, OFF PLOT DELIVERY CONTRACT (ODC SOUTH)', S['contract']);
    mrg(1, 0, 1, NC - 1); fillRow(1, S['contract']); rowHts.push({ hpt: 28 });

    // Row 2 – Report date (single cell)
    fillRow(2, S['metaBlank']);
    setC(2, NC - 1, `Report Date: ${reportDate}`, S['metaR']); rowHts.push({ hpt: 18 });

    // Row 3 – Report title (merged full width)
    setC(3, 0, 'DAILY WORK PLAN — CREW WORK PLAN', S['title']);
    mrg(3, 0, 3, NC - 1);
    fillRow(3, S['title']); rowHts.push({ hpt: 28 });

    // Row 4 – Separator
    fillRow(4, S['sep']); rowHts.push({ hpt: 6 });

    // Row 5 – Column headers
    for (let c = 0; c < NC; c++) setC(5, c, hdrs[c], S['colHdr']);
    rowHts.push({ hpt: 32 });

    // ── Data rows ─────────────────────────────────────────────────────────
    let R = 6;
    const manPos  = selCols.findIndex(c => c.key === 'man')  + 1;
    const eqptPos = selCols.findIndex(c => c.key === 'eqpt') + 1;
    const vehPos  = selCols.findIndex(c => c.key === 'veh')  + 1;
    const numCols = new Set([manPos, eqptPos, vehPos].filter(x => x > 0));

    const allCats2 = [...new Set(rows.map((rr: any) => rr.cat).filter(Boolean))].sort() as string[];
    if (rows.some((rr: any) => !rr.cat)) allCats2.push('Others');

    const xlT = [
      { label: 'ATNM',            filter: (rr: any) => !!rr.atnm },
      { label: 'Sub Contractors', filter: (rr: any) => !rr.atnm },
    ];
    let sl = 0, grandMan = 0, grandEqpt = 0, grandVeh = 0, grandPh = 0;

    for (const t of xlT) {
      const typeRows = rows.filter(t.filter);
      let typeMan = 0, typeEqpt = 0, typeVeh = 0;

      setC(R, 0, t.label.toUpperCase(), S['typeHdr']);
      mrg(R, 0, R, NC - 1); fillRow(R, S['typeHdr']); rowHts.push({ hpt: 24 }); R++;

      for (const cat of allCats2) {
        const gr = (cat === 'Others'
          ? typeRows.filter((rr: any) => !rr.cat)
          : typeRows.filter((rr: any) => rr.cat === cat))
          .sort((a: any, b: any) =>
            (a.loc || '').localeCompare(b.loc || '') || (a.well || '').localeCompare(b.well || ''));
        if (!gr.length) continue;

        const sub = gr.reduce((s: any, rr: any) =>
          ({ man: s.man + (Number(rr.man) || 0), eqpt: s.eqpt + (Number(rr.eqpt) || 0), veh: s.veh + (Number(rr.veh) || 0) }),
          { man: 0, eqpt: 0, veh: 0 });

        setC(R, 0, cat, S['catHdr']);
        mrg(R, 0, R, NC - 1); fillRow(R, S['catHdr']); rowHts.push({ hpt: 20 }); R++;

        let even = false;
        for (const w of gr) {
          const ds = even ? S['dataE'] : S['dataO'];
          const nm = even ? S['numE']  : S['numO'];
          const vals: any[] = [++sl, ...selCols.map(c => this._dpFieldVal(c.key, w))];
          for (let c = 0; c < NC; c++) setC(R, c, vals[c], numCols.has(c) ? nm : ds);
          rowHts.push({ hpt: 20 }); R++; even = !even;
        }
        typeMan += sub.man; typeEqpt += sub.eqpt; typeVeh += sub.veh;
      }

      // Type subtotal
      setC(R, 0, `${t.label} TOTAL  (PH Count: ${typeRows.length})`, S['subTotal']);
      mrg(R, 0, R, NC - 1); fillRow(R, S['subTotal']);
      if (manPos > 0)  setC(R, manPos,  typeMan,  S['subTotalNum']);
      if (eqptPos > 0) setC(R, eqptPos, typeEqpt, S['subTotalNum']);
      if (vehPos > 0)  setC(R, vehPos,  typeVeh,  S['subTotalNum']);
      rowHts.push({ hpt: 22 }); R++;

      grandMan += typeMan; grandEqpt += typeEqpt; grandVeh += typeVeh; grandPh += typeRows.length;
    }

    // Grand total
    setC(R, 0, `GRAND TOTAL  (PH Count: ${grandPh})`, S['grand']);
    mrg(R, 0, R, NC - 1); fillRow(R, S['grand']);
    if (manPos > 0)  setC(R, manPos,  grandMan,  S['grandNum']);
    if (eqptPos > 0) setC(R, eqptPos, grandEqpt, S['grandNum']);
    if (vehPos > 0)  setC(R, vehPos,  grandVeh,  S['grandNum']);
    rowHts.push({ hpt: 26 });

    // ── Finalize ───────────────────────────────────────────────────────────
    ws['!ref']  = X.utils.encode_range({ r: 0, c: 0 }, { r: R, c: NC - 1 });
    ws['!cols'] = colWidths.map(w => ({ wch: w }));
    ws['!rows'] = rowHts;

    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, sheetName);
    const buf = X.write(wb, { type: 'array', bookType: 'xlsx' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), filename);
  }

  exportDpExcel(): void {
    const reportDate = new Date().toISOString().slice(0, 10);
    const allCols = this.dpCustomColDefs.map(c => ({ key: c.key, label: c.label }));
    this._styledDpExcel(this._filteredDailyRows(), allCols, 'Daily Plan', `Daily_Plan_${reportDate}.xlsx`);
  }

  // ─── (old full exportDpExcel body replaced) ───────────────────────
  _oldDpExcel_UNUSED(): void {
    const today      = new Date();
    const reportDate = today.toISOString().slice(0, 10);
    const monthLabel = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + ' Report';

    const hdrs = ['#', 'Type', 'Well ID', 'Discipline', 'PA Name', 'PA Mob',
                  'PH Name', 'PH ID', 'PH Mob', 'PO No', 'WBS', 'Category',
                  'Location', 'Job Title / Project', 'Activities',
                  'Manpower', 'Equipment', 'Vehicles', 'Remarks'];
    const NC = hdrs.length;
    const empty = (n: number): any[] => Array(n).fill('');

    // ── Company / Contract header rows ────────────────────────────────
    const r1 = empty(NC);
    r1[Math.floor(NC / 2)] = 'AL TASNIM ENTERPRISES LLC.';
    r1[NC - 3] = 'Report Date:'; r1[NC - 2] = reportDate;
    const r2 = empty(NC);
    r2[Math.floor(NC / 2)] = 'CONTRACT NO. C3100000177, OFF PLOT DELIVERY CONTRACT (ODC SOUTH)';
    const r3 = empty(NC); r3[NC - 2] = monthLabel;
    const r4 = empty(NC); r4[0] = 'DAILY WORK PLAN \u2014 CREW WORK PLAN';
    const r5 = empty(NC);
    const r6 = [...hdrs];

    const aoa: any[][] = [r1, r2, r3, r4, r5, r6];

    // ── Data rows grouped by Type → Category ──────────────────────────
    const rows = this._filteredDailyRows();
    const allCats = [...new Set(rows.map((r: any) => r.cat).filter(Boolean))].sort() as string[];
    if (rows.some((r: any) => !r.cat)) allCats.push('Others');

    const xlTypes = [
      { label: 'ATNM',            filter: (r: any) => !!r.atnm },
      { label: 'Sub Contractors', filter: (r: any) => !r.atnm },
    ];

    let sl = 0;
    let grandMan = 0, grandEqpt = 0, grandVeh = 0, grandPh = 0;

    for (const t of xlTypes) {
      const typeRows = rows.filter(t.filter);
      let typeMan = 0, typeEqpt = 0, typeVeh = 0;

      // Type header row
      const th = empty(NC); th[0] = t.label.toUpperCase();
      aoa.push(th);

      for (const cat of allCats) {
        const gr = (cat === 'Others'
          ? typeRows.filter((r: any) => !r.cat)
          : typeRows.filter((r: any) => r.cat === cat))
          .sort((a: any, b: any) => (a.loc || '').localeCompare(b.loc || '') || (a.well || '').localeCompare(b.well || ''));
        const sub = gr.reduce((s: any, r: any) => ({
          man:  s.man  + (Number(r.man)  || 0),
          eqpt: s.eqpt + (Number(r.eqpt) || 0),
          veh:  s.veh  + (Number(r.veh)  || 0),
        }), { man: 0, eqpt: 0, veh: 0 });

        // Category header row (always shown)
        const gh = empty(NC); gh[0] = cat;
        aoa.push(gh);

        for (const w of gr) {
          aoa.push([++sl, w.atnm ? 'ATNM' : 'SC', w.well ?? '', w.disc ?? '',
                    w.pa ?? '', w.paMob ?? '', w.phName ?? '', w.phId ?? '', w.phMob ?? '',
                    w.po ?? '', w.wbs ?? '', w.cat ?? '', w.loc ?? '', w.job ?? '', w.act ?? '',
                    Number(w.man) || 0, Number(w.eqpt) || 0, Number(w.veh) || 0, w.rem ?? '']);
        }

        typeMan  += sub.man;  typeEqpt += sub.eqpt;
        typeVeh  += sub.veh;
      }

      // Type subtotal row
      const st = empty(NC);
      st[0] = `${t.label} TOTAL (PH Count: ${typeRows.length})`;
      st[15] = typeMan; st[16] = typeEqpt; st[17] = typeVeh;
      aoa.push(st);

      grandMan  += typeMan;  grandEqpt += typeEqpt;
      grandVeh  += typeVeh;  grandPh   += typeRows.length;
    }

    // Grand total row
    const gt = empty(NC);
    gt[0] = `GRAND TOTAL (PH Count: ${grandPh})`;
    gt[15] = grandMan; gt[16] = grandEqpt; gt[17] = grandVeh;
    aoa.push(gt);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = hdrs.map(h => ({ wch: Math.max(h.length + 4, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Daily Plan');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `Daily_Plan_${reportDate}.xlsx`);
  }

  exportDpPdf(): void {
    const rows = this._filteredDailyRows();
    const today = new Date();
    const reportDate = today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const monthLabel = today.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) + ' Report';

    const cols = [
      { h: '#',                  f: (_: any, i: number) => String(i) },
      { h: 'Type',               f: (r: any) => r.atnm ? 'ATNM' : 'SC' },
      { h: 'Well ID',            f: (r: any) => r.well  ?? '' },
      { h: 'Discipline',         f: (r: any) => r.disc  ?? '' },
      { h: 'PA Name',            f: (r: any) => r.pa    ?? '' },
      { h: 'PA Mob',             f: (r: any) => r.paMob ?? '' },
      { h: 'PH Name',            f: (r: any) => r.phName ?? '' },
      { h: 'PH ID',              f: (r: any) => r.phId  ?? '' },
      { h: 'PH Mob',             f: (r: any) => r.phMob ?? '' },
      { h: 'PO No',              f: (r: any) => r.po    ?? '' },
      { h: 'WBS',                f: (r: any) => r.wbs   ?? '' },
      { h: 'Category',           f: (r: any) => r.cat   ?? '' },
      { h: 'Location',           f: (r: any) => r.loc   ?? '' },
      { h: 'Job Title / Project',f: (r: any) => r.job   ?? '' },
      { h: 'Activities',         f: (r: any) => r.act   ?? '' },
      { h: 'Man',                f: (r: any) => String(r.man  ?? 0) },
      { h: 'Eqpt',               f: (r: any) => String(r.eqpt ?? 0) },
      { h: 'Veh',                f: (r: any) => String(r.veh  ?? 0) },
      { h: 'Remarks',            f: (r: any) => r.rem   ?? '' },
    ];
    const NC = cols.length;

    const allCats = [...new Set(rows.map((r: any) => r.cat).filter(Boolean))].sort() as string[];
    if (rows.some((r: any) => !r.cat)) allCats.push('Others');

    const pdfTypes = [
      { label: 'ATNM',            filter: (r: any) => !!r.atnm },
      { label: 'Sub Contractors', filter: (r: any) => !r.atnm },
    ];

    let tbody = '';
    let sl = 0;
    let grandMan = 0, grandEqpt = 0, grandVeh = 0, grandPh = 0;

    for (const t of pdfTypes) {
      const typeRows = rows.filter(t.filter);
      let typeMan = 0, typeEqpt = 0, typeVeh = 0;

      tbody += `<tr><td colspan="${NC}" class="type-grp">${t.label.toUpperCase()}</td></tr>`;

      for (const cat of allCats) {
        const gr = (cat === 'Others'
          ? typeRows.filter((r: any) => !r.cat)
          : typeRows.filter((r: any) => r.cat === cat))
          .sort((a: any, b: any) => (a.loc || '').localeCompare(b.loc || '') || (a.well || '').localeCompare(b.well || ''));
        const sub = gr.reduce((s: any, r: any) => ({
          man:  s.man  + (Number(r.man)  || 0),
          eqpt: s.eqpt + (Number(r.eqpt) || 0),
          veh:  s.veh  + (Number(r.veh)  || 0),
        }), { man: 0, eqpt: 0, veh: 0 });

        tbody += `<tr><td colspan="${NC}" class="grp">&#9658; ${cat.toUpperCase()} &mdash; ${gr.length} activity(ies)</td></tr>`;
        for (const r of gr) {
          sl++;
          tbody += `<tr>${cols.map((c, ci) => `<td>${ci === 0 ? sl : c.f(r, sl)}</td>`).join('')}</tr>`;
        }

        typeMan  += sub.man;  typeEqpt += sub.eqpt;
        typeVeh  += sub.veh;
      }

      tbody += `<tr class="type-sub">
        <td colspan="15" style="text-align:left">${t.label} TOTAL (PH Count: ${typeRows.length})</td>
        <td>${typeMan}</td><td>${typeEqpt}</td><td>${typeVeh}</td><td></td>
      </tr>`;

      grandMan += typeMan; grandEqpt += typeEqpt;
      grandVeh += typeVeh; grandPh   += typeRows.length;
    }

    const tfoot = `<tfoot>
      <tr class="gtotal">
        <td colspan="15">GRAND TOTAL (PH Count: ${grandPh})</td>
        <td>${grandMan}</td><td>${grandEqpt}</td><td>${grandVeh}</td><td></td>
      </tr>
    </tfoot>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Daily Plan Report</title>
<style>
  body{font-family:Arial,sans-serif;font-size:7px;margin:6mm;color:#111}
  .co{text-align:center;font-size:10px;font-weight:800;color:#1F3864;padding:2px 0;letter-spacing:.4px}
  .ct{text-align:center;font-size:8px;font-weight:700;color:#1F3864;border:1.5px solid #1F3864;
      padding:2px 8px;margin:2px auto 4px;display:table}
  .meta{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:5px}
  .rpt-title{font-size:10px;font-weight:800;color:#1F3864;text-transform:uppercase;letter-spacing:.3px}
  .rpt-date{font-size:7.5px;color:#475569;text-align:right;line-height:1.5}
  table{width:100%;border-collapse:collapse}
  thead th{background:#1F3864;color:#fff;padding:3px 3px;text-align:center;
           font-size:6.5px;white-space:nowrap;border:1px solid #16294d}
  tbody td{padding:2px 3px;border:1px solid #d1d5db;font-size:6.5px;white-space:nowrap;text-align:center}
  tbody tr:nth-child(even) td{background:#f8fafc}
  td.type-grp{background:#1F3864;color:#fff;font-weight:900;font-size:8.5px;
              padding:4px 8px;text-align:left;border:none;letter-spacing:.5px;text-transform:uppercase}
  td.grp{background:#2E5096;color:#fff;font-weight:800;font-size:7.5px;
         padding:3px 6px 3px 20px;text-align:left;border:none;letter-spacing:.3px}
  tr.type-sub td{background:#93c5fd;color:#1e3a8a;font-weight:800;font-style:normal}
  tfoot tr.gtotal td{background:#1e3a5f;color:#fff;font-weight:800;
                     border-top:2px solid #2e75b6;font-style:normal}
  @page{size:A3 landscape;margin:6mm}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="co">AL TASNIM ENTERPRISES LLC.</div>
<div class="ct">CONTRACT NO. C3100000177, OFF PLOT DELIVERY CONTRACT (ODC SOUTH)</div>
<div class="meta">
  <div class="rpt-title">DAILY WORK PLAN &mdash; CREW WORK PLAN</div>
  <div class="rpt-date">Report Date: ${reportDate}<br>${monthLabel}</div>
</div>
<table>
<thead><tr>${cols.map(c => `<th>${c.h}</th>`).join('')}</tr></thead>
<tbody>${tbody}</tbody>
${tfoot}
</table></body></html>`;

    const w = window.open('', '_blank');
    if (!w) { alert('Allow pop-ups to export PDF'); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 600);
  }

  // ── AG Grid builders ────────────────────────────────────────────────────────
  private _buildJpFlatRows(): any[] {
    const getCatType = (cat: string) =>
      (cat || '').replace(/^(Nimr|Marmul)\s+/i, '').trim() || (cat || 'Other');
    const catTypeOrder: string[] = [];
    const catTypeMap = new Map<string, any[]>();
    for (const r of this._jpRawRows) {
      const ct = getCatType(r.Category || '');
      if (!catTypeMap.has(ct)) { catTypeMap.set(ct, []); catTypeOrder.push(ct); }
      catTypeMap.get(ct)!.push(r);
    }
    const revSum = (gr: any[], f: string) =>
      Math.round(gr.reduce((s: number, r: any) => s + (Number(r[f]) || 0), 0));
    const flatRows: any[] = [];
    let slNo = 0;
    for (const ct of catTypeOrder) {
      const gr = catTypeMap.get(ct)!;
      const collapsed = this._jpCollapsed.has(ct);
      flatRows.push({ _type: 'group', _groupLabel: ct, _groupCount: gr.length, _collapsed: collapsed });
      if (!collapsed) {
        for (const r of gr) flatRows.push({ ...r, SlNo: ++slNo });
        flatRows.push({
          _type: 'subtotal', _groupLabel: ct,
          SlNo: '', Category: ct + ' Revenue Subtotal',
          WellId: '', WellName: '', PoNo: '', WbsNo: '',
          TargetEnd: null, Status: '', IsNewWell: false,
          CumPriorMonthActual: revSum(gr, 'CumPriorMonthActual'),
          CmPlanRevenue:       revSum(gr, 'CmPlanRevenue'),
          CmActualRevenue:     revSum(gr, 'CmActualRevenue'),
          CumCmPlanRevenue:    revSum(gr, 'CumCmPlanRevenue'),
          CumCmActualRevenue:  revSum(gr, 'CumCmActualRevenue'),
        });
      }
    }
    return flatRows;
  }

  private _buildJpGrid(rows: any[]): void {
    this._jpRawRows = rows;
    this._jpCollapsed.clear();
    const pct   = (v: any) => v == null ? '—' : v + '%';
    const money = (v: any) => v == null ? '—' : new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(+v));
    const statusStyle = (s: string) => {
      const map: Record<string, string> = { 'Behind': '#C20000', 'Ahead': '#00733A', 'On track': '#475569', 'New well': '#6d28d9' };
      const bg: Record<string, string>  = { 'Behind': '#FCE5E5', 'Ahead': '#E2F3E8', 'On track': '#EEF3F9', 'New well': '#ede9fe' };
      return `background:${bg[s]||'#EEF3F9'};color:${map[s]||'#475569'};font-weight:700;font-size:12px;padding:2px 8px;border-radius:999px`;
    };
    // Guard cellBeh and data access for pinned total row
    const cellBeh = (p: any, a: any) => {
      if (p == null) return {};
      if (+a < +p - 0.001) return { background: '#fde8e8', color: '#9c0006', fontWeight: '700' };
      if (+a > +p + 0.001) return { background: '#e7f6ec', color: '#06632b', fontWeight: '700' };
      return {};
    };
    const safeCell = (node: any, planField: string, actField: string) => {
      if (node?.rowPinned) return {};
      return cellBeh(node?.data?.[planField], node?.data?.[actField]);
    };
    const wkGroup = (label: string, n: number): ColGroupDef => ({
      headerName: label, marryChildren: true,
      children: [
        { headerName: 'P', field: `W${n}PlanPct`,   width: 58,
          valueFormatter: (p: any) => pct(p.value),
          cellStyle: (p: any) => safeCell(p.node, `W${n}PlanPct`, `W${n}ActualPct`) },
        { headerName: 'A', field: `W${n}ActualPct`, width: 58,
          valueFormatter: (p: any) => pct(p.value),
          cellStyle: (p: any) => safeCell(p.node, `W${n}PlanPct`, `W${n}ActualPct`) }
      ]
    });

    // ── Category grouping: extract the "type" after cluster prefix ────────────
    // "Nimr Flowline" → "Flowline",  "Marmul Location" → "Location"
    const getCatType = (cat: string) =>
      (cat || '').replace(/^(Nimr|Marmul)\s+/i, '').trim() || (cat || 'Other');

    // Build ordered list of unique category types (preserving first-seen order)
    const catTypeOrder: string[] = [];
    const catTypeMap = new Map<string, any[]>();
    for (const r of rows) {
      const ct = getCatType(r.Category || '');
      if (!catTypeMap.has(ct)) { catTypeMap.set(ct, []); catTypeOrder.push(ct); }
      catTypeMap.get(ct)!.push(r);
    }

    // Flatten: [group-header, ...data-rows, subtotal] × each category type
    const flatRows = this._buildJpFlatRows();

    // ── Grand total computation ─────────────────────────────────────────────
    // Weighted average by PurposeValue (exclude null-plan rows for plan fields)
    const wAvg = (field: string) => {
      const valid = rows.filter(r => r[field] != null);
      const den = valid.reduce((s: number, r: any) => s + (Number(r['PurposeValue']) || 0), 0);
      return den > 0
        ? valid.reduce((s: number, r: any) => s + (Number(r['PurposeValue']) || 0) * (Number(r[field]) || 0), 0) / den
        : 0;
    };
    const sum = (field: string) => rows.reduce((s: number, r: any) => s + (Number(r[field]) || 0), 0);

    const grandTotal: Record<string, any> = {
      SlNo: '', Category: 'GRAND TOTAL', WellId: `${rows.length} wells`,
      WellName: '', PoNo: '', WbsNo: '', TargetEnd: null, Status: '', IsNewWell: false,
      CumPriorActualPct : Math.round(wAvg('CumPriorActualPct')  * 100) / 100,
      W1PlanPct:  Math.round(wAvg('W1PlanPct')  * 100) / 100,  W1ActualPct: Math.round(wAvg('W1ActualPct')  * 100) / 100,
      W2PlanPct:  Math.round(wAvg('W2PlanPct')  * 100) / 100,  W2ActualPct: Math.round(wAvg('W2ActualPct')  * 100) / 100,
      W3PlanPct:  Math.round(wAvg('W3PlanPct')  * 100) / 100,  W3ActualPct: Math.round(wAvg('W3ActualPct')  * 100) / 100,
      W4PlanPct:  Math.round(wAvg('W4PlanPct')  * 100) / 100,  W4ActualPct: Math.round(wAvg('W4ActualPct')  * 100) / 100,
      W5PlanPct:  Math.round(wAvg('W5PlanPct')  * 100) / 100,  W5ActualPct: Math.round(wAvg('W5ActualPct')  * 100) / 100,
      CmPlanPct:  Math.round(wAvg('CmPlanPct')  * 100) / 100,
      CmActualPct:Math.round(wAvg('CmActualPct') * 100) / 100,
      CumPriorMonthActual : Math.round(sum('CumPriorMonthActual')),
      CmPlanRevenue       : Math.round(sum('CmPlanRevenue')),
      CmActualRevenue     : Math.round(sum('CmActualRevenue')),
      CumCmPlanRevenue    : Math.round(sum('CumCmPlanRevenue')),
      CumCmActualRevenue  : Math.round(sum('CumCmActualRevenue')),
    };

    this.jpColDefs = [
      { headerName: '#',        field: 'SlNo',     pinned: 'left', width: 55,  sortable: false, filter: false, floatingFilter: false },
      { headerName: 'Category', field: 'Category', pinned: 'left', width: 130,
        wrapText: false, autoHeight: false,
        cellRenderer: (p: any) => {
          if (p.data?._type === 'subtotal')
            return `<span style="font-style:italic;font-weight:700;color:#1F3864;white-space:nowrap">↳ ${p.data._groupLabel ?? (p.value||'').replace(' Revenue Subtotal','')} &mdash; Subtotal</span>`;
          return p.value ?? '';
        }},
      { headerName: 'Well ID',  field: 'WellId',   pinned: 'left', width: 90,
        cellStyle: { fontWeight: '700', color: '#1F3864', display: 'flex', alignItems: 'center' },
        cellRenderer: (p: any) => {
          if (p.node?.rowPinned) return `<span style="font-weight:700">${p.value ?? ''}</span>`;
          return p.data?.IsNewWell
            ? `${p.value} <span style="background:#ede9fe;color:#6d28d9;font-size:10px;padding:1px 5px;border-radius:999px;font-weight:700;margin-left:4px">NEW</span>`
            : p.value;
        }},
      { headerName: 'Well Name', field: 'WellName', width: 175 },
      { headerName: 'PO No',     field: 'PoNo',     width: 120 },
      { headerName: 'WBS',       field: 'WbsNo',    width: 90 },
      { headerName: 'Cum Prior', marryChildren: true, children: [
        { headerName: 'Act', field: 'CumPriorActualPct', width: 65, valueFormatter: (p: any) => pct(p.value) }
      ]} as ColGroupDef,
      wkGroup('W1 (1–7)',    1),
      wkGroup('W2 (8–14)',   2),
      wkGroup('W3 (15–21)',  3),
      wkGroup('W4 (22–28)',  4),
      wkGroup('W5 (29–end)', 5),
      { headerName: 'Current Month', marryChildren: true, children: [
        { headerName: 'Plan', field: 'CmPlanPct',   width: 68,
          valueFormatter: (p: any) => p.node?.rowPinned ? pct(p.value) : (p.data?.IsNewWell ? '—' : pct(p.value)),
          cellStyle: (p: any) => safeCell(p.node, 'CmPlanPct', 'CmActualPct') },
        { headerName: 'Act',  field: 'CmActualPct', width: 68,
          valueFormatter: (p: any) => pct(p.value),
          cellStyle: (p: any) => safeCell(p.node, 'CmPlanPct', 'CmActualPct') }
      ]} as ColGroupDef,
      { headerName: 'Finish', field: 'TargetEnd', width: 100,
        valueFormatter: (p: any) => p.value
          ? new Date(p.value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
          : '—' },
      { headerName: 'Status', field: 'Status', width: 105,
        cellRenderer: (p: any) => {
          if (p.node?.rowPinned || !p.value) return '';
          return `<span style="${statusStyle(p.value)}">${p.value}</span>`;
        }},
      { headerName: 'Revenue (OMR)', marryChildren: true, children: [
        { headerName: 'Cum Prior Act', field: 'CumPriorMonthActual', width: 120, valueFormatter: (p: any) => money(p.value) },
        { headerName: 'CM Plan',       field: 'CmPlanRevenue',       width: 100, valueFormatter: (p: any) => p.node?.rowPinned ? money(p.value) : (p.data?.IsNewWell ? '—' : money(p.value)) },
        { headerName: 'CM Act',        field: 'CmActualRevenue',     width: 100, valueFormatter: (p: any) => money(p.value) },
        { headerName: 'Cum Plan',      field: 'CumCmPlanRevenue',    width: 105, valueFormatter: (p: any) => p.node?.rowPinned ? money(p.value) : (p.data?.IsNewWell ? '—' : money(p.value)) },
        { headerName: 'Cum Act',       field: 'CumCmActualRevenue',  width: 105, valueFormatter: (p: any) => money(p.value) },
      ]} as ColGroupDef,
    ];

    this.jpRowData      = flatRows;
    this.jpPinnedBottom = [grandTotal];
    // Render grid using CDN global (same pattern as rest of app)
    setTimeout(() => {
      const el = document.getElementById('rp-jp-grid');
      if (el && typeof agGrid !== 'undefined') {
        el.innerHTML = '';
        this._jpApi = agGrid.createGrid(el, {
          columnDefs:               this.jpColDefs,
          rowData:                  this.jpRowData,
          pinnedBottomRowData:      this.jpPinnedBottom,
          defaultColDef:            { ...this.defaultColDef, floatingFilter: false, wrapText: true, autoHeight: true },
          animateRows:              true,
          suppressColumnVirtualisation: false,
          getRowHeight:             (p: any) => p.data?._type === 'group' ? 36 : p.data?._type === 'subtotal' ? 36 : undefined,
          isFullWidthRow:           (p: any) => p.rowNode?.data?._type === 'group',
          fullWidthCellRenderer:    (p: any) => {
            const div = document.createElement('div');
            const ct  = (p.data?._groupLabel || '').toUpperCase();
            const cnt = p.data?._groupCount  || 0;
            const collapsed = p.data?._collapsed;
            const chSvg = collapsed
              ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'
              : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
            div.style.cssText = 'background:#1F3864;color:#fff;font-weight:800;font-size:13px;padding:0 14px;display:flex;align-items:center;height:100%;letter-spacing:.4px;gap:8px;cursor:pointer;user-select:none';
            div.innerHTML = `${chSvg}${ct}<span style="font-weight:400;font-size:11px;opacity:.65">— ${cnt} well(s)</span>`;
            div.addEventListener('click', () => {
              const lbl = p.data?._groupLabel;
              if (!lbl) return;
              this._jpCollapsed.has(lbl) ? this._jpCollapsed.delete(lbl) : this._jpCollapsed.add(lbl);
              this._jpApi?.setGridOption('rowData', this._buildJpFlatRows());
            });
            return div;
          },
          rowClassRules: {
            'jp-subtotal-row': (p: any) => p.data?._type === 'subtotal',
          },
        });
      }
    });
  }

  private _buildDpFlatRows(): any[] {
    const dpTypes = [
      { label: 'ATNM',            filter: (r: any) => !!r.atnm },
      { label: 'Sub Contractors', filter: (r: any) => !r.atnm },
    ];
    const allCats = [...new Set(this._dpRawRows.map((r: any) => r.cat).filter(Boolean))].sort() as string[];
    if (this._dpRawRows.some((r: any) => !r.cat)) allCats.push('Others');
    const flatRows: any[] = [];
    let sl = 0;
    for (const t of dpTypes) {
      const typeRows = this._dpRawRows.filter(t.filter);
      const typeTotals = { man: 0, eqpt: 0, veh: 0 };
      const tCollapsed = this._dpCollapsedTypes.has(t.label);
      flatRows.push({ _type: 'type-group', _typeLabel: t.label, _typePh: typeRows.length, _collapsed: tCollapsed });
      if (!tCollapsed) {
        for (const cat of allCats) {
          const gr = (cat === 'Others'
            ? typeRows.filter((r: any) => !r.cat)
            : typeRows.filter((r: any) => r.cat === cat))
            .sort((a: any, b: any) =>
              (a.loc || '').localeCompare(b.loc || '') || (a.well || '').localeCompare(b.well || ''));
          const sub = gr.reduce((s: any, r: any) => ({
            man:  s.man  + (Number(r.man)  || 0),
            eqpt: s.eqpt + (Number(r.eqpt) || 0),
            veh:  s.veh  + (Number(r.veh)  || 0),
          }), { man: 0, eqpt: 0, veh: 0 });
          const catKey = `${t.label}__${cat}`;
          const cCollapsed = this._dpCollapsedCats.has(catKey);
          flatRows.push({ _type: 'group', _typeLabel: t.label, _groupLabel: cat, _groupCount: gr.length,
            _man: sub.man, _eqpt: sub.eqpt, _veh: sub.veh, _collapsed: cCollapsed });
          if (!cCollapsed) {
            for (const r of gr) flatRows.push({ ...r, slNo: ++sl, typeLabel: t.label === 'ATNM' ? 'ATNM' : 'SC' });
          }
          typeTotals.man  += sub.man;
          typeTotals.eqpt += sub.eqpt;
          typeTotals.veh  += sub.veh;
        }
        flatRows.push({
          _type: 'type-subtotal', _typeLabel: t.label,
          phName: `${t.label} TOTAL (PH Count: ${typeRows.length})`,
          man: typeTotals.man, eqpt: typeTotals.eqpt, veh: typeTotals.veh,
        });
      }
    }
    return flatRows;
  }

  private _buildDpGrid(rows: any[]): void {
    this._dpRawRows = rows;
    this._dpCollapsedTypes.clear();
    this._dpCollapsedCats.clear();

    const flatRows = this._buildDpFlatRows();

    const dpTypes = [
      { label: 'ATNM',            filter: (r: any) => !!r.atnm },
      { label: 'Sub Contractors', filter: (r: any) => !r.atnm },
    ];

    // Grand total computation from raw rows
    const allCats = [...new Set(rows.map((r: any) => r.cat).filter(Boolean))].sort() as string[];
    if (rows.some((r: any) => !r.cat)) allCats.push('Others');
    const grand = { man: 0, eqpt: 0, veh: 0, ph: 0 };
    for (const t of dpTypes) {
      const typeRows = rows.filter(t.filter);
      grand.ph += typeRows.length;
      for (const cat of allCats) {
        const gr = cat === 'Others' ? typeRows.filter((r: any) => !r.cat) : typeRows.filter((r: any) => r.cat === cat);
        grand.man  += gr.reduce((s: number, r: any) => s + (Number(r.man)  || 0), 0);
        grand.eqpt += gr.reduce((s: number, r: any) => s + (Number(r.eqpt) || 0), 0);
        grand.veh  += gr.reduce((s: number, r: any) => s + (Number(r.veh)  || 0), 0);
      }
    }

    const grandTotal = {
      slNo: '', typeLabel: '', well: `${rows.length} row(s)`, disc: '', pa: '', paMob: '',
      phName: `GRAND TOTAL (PH Count: ${grand.ph})`, phId: '', phMob: '', po: '', wbs: '', cat: '', loc: '', job: '', act: '',
      man: grand.man, eqpt: grand.eqpt, veh: grand.veh, rem: ''
    };

    this.dpRowData = flatRows;

    this.dpColDefs = [
      { headerName: '#',    field: 'slNo',      width: 62,  pinned: 'left', sortable: false, filter: false },
      { headerName: 'Type', field: 'typeLabel', width: 95,  pinned: 'left',
        cellRenderer: (p: any) => {
          if (!p.value) return '';
          return p.value === 'ATNM'
            ? `<span style="background:#D6E4F0;color:#1F3864;font-weight:700;font-size:12px;padding:3px 9px;border-radius:5px">ATNM</span>`
            : `<span style="background:#EEF3F9;color:#475569;font-weight:700;font-size:12px;padding:3px 9px;border-radius:5px">SC</span>`;
        }},
      { headerName: 'Well ID',    field: 'well', width: 100, pinned: 'left',
        cellStyle: { fontWeight: '700', color: '#1F3864', display: 'flex', alignItems: 'center' } },
      { headerName: 'Discipline', field: 'disc', width: 115 },
      { headerName: 'PA Name',    field: 'pa',   width: 165 },
      { headerName: 'PA Mob',     field: 'paMob',width: 145,
        cellRenderer: (p: any) => p.value ? `<a href="tel:${(p.value+'').replace(/\s/g,'')}" style="color:#29378d;font-weight:600;text-decoration:none">${p.value}</a>` : '' },
      { headerName: 'PH (ID) Name', field: 'phName', width: 200,
        cellStyle: { overflow: 'hidden', display: 'block', padding: '6px 8px', lineHeight: '1.5', whiteSpace: 'normal' },
        cellRenderer: (p: any) => {
          if (p.data?._type === 'type-subtotal') return `<span style="font-weight:800;color:#1e3a8a">${p.value || ''}</span>`;
          if (p.node?.rowPinned) return `<span style="font-weight:800">${p.value || ''}</span>`;
          return `${p.data?.phName || ''}<br><span style="color:#7F7F7F;font-size:11px">${p.data?.phId || ''}</span>`;
        }, autoHeight: true },
      { headerName: 'PH Mob',     field: 'phMob',width: 145,
        cellRenderer: (p: any) => p.value ? `<a href="tel:${(p.value+'').replace(/\s/g,'')}" style="color:#29378d;font-weight:600;text-decoration:none">${p.value}</a>` : '' },
      { headerName: 'PO No',      field: 'po',   width: 125 },
      { headerName: 'WBS',        field: 'wbs',  width: 90  },
      { headerName: 'Category',   field: 'cat',  width: 105 },
      { headerName: 'Location',   field: 'loc',  width: 100 },
      { headerName: 'Job Title / Project', field: 'job', width: 205 },
      { headerName: 'Activities', field: 'act',  minWidth: 210, flex: 1 },
      { headerName: 'Manpower',  field: 'man',  width: 100, type: 'numericColumn',
        cellStyle: (p: any) => ({ fontWeight: '700', justifyContent: 'center',
          ...(p.data?._type === 'type-subtotal' ? { background: '#93c5fd', color: '#1e3a8a' } : {}) }) },
      { headerName: 'Equipment', field: 'eqpt', width: 100, type: 'numericColumn',
        cellStyle: (p: any) => ({ fontWeight: '700', justifyContent: 'center',
          ...(p.data?._type === 'type-subtotal' ? { background: '#93c5fd', color: '#1e3a8a' } : {}) }) },
      { headerName: 'Vehicles',  field: 'veh',  width: 100, type: 'numericColumn',
        cellStyle: (p: any) => ({ fontWeight: '700', justifyContent: 'center',
          ...(p.data?._type === 'type-subtotal' ? { background: '#93c5fd', color: '#1e3a8a' } : {}) }) },
      { headerName: 'Remarks', field: 'rem', minWidth: 120, flex: 1 },
    ];

    setTimeout(() => {
      const el = document.getElementById('rp-dp-grid');
      if (el && typeof agGrid !== 'undefined') {
        el.innerHTML = '';
        this._dpApi = agGrid.createGrid(el, {
          columnDefs:          this.dpColDefs,
          rowData:             this.dpRowData,
          pinnedBottomRowData: [grandTotal],
          defaultColDef:       { ...this.defaultColDef, floatingFilter: false, wrapText: true, autoHeight: true },
          animateRows:         true,
          getRowHeight:        (p: any) => (p.data?._type === 'type-group' ? 40 : p.data?._type === 'group' ? 32 : undefined),
          isFullWidthRow:      (p: any) => p.rowNode?.data?._type === 'type-group' || p.rowNode?.data?._type === 'group',
          fullWidthCellRenderer: (p: any) => {
            const div = document.createElement('div');
            if (p.data?._type === 'type-group') {
              const collapsed = p.data?._collapsed;
              const chSvg = collapsed
                ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'
                : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
              div.style.cssText = 'background:#1F3864;color:#fff;font-weight:900;font-size:14px;padding:0 14px;display:flex;align-items:center;height:100%;letter-spacing:.6px;gap:8px;border-bottom:2px solid #3b5fa0;cursor:pointer;user-select:none';
              div.innerHTML = `${chSvg}${(p.data._typeLabel || '').toUpperCase()}&ensp;<span style="font-weight:400;font-size:11px;opacity:.75">${p.data._typePh || 0} activity(ies)</span>`;
              div.addEventListener('click', () => {
                const lbl = p.data?._typeLabel;
                if (!lbl) return;
                this._dpCollapsedTypes.has(lbl) ? this._dpCollapsedTypes.delete(lbl) : this._dpCollapsedTypes.add(lbl);
                this._dpApi?.setGridOption('rowData', this._buildDpFlatRows());
              });
            } else {
              const cat = (p.data?._groupLabel || '').toUpperCase();
              const cnt = p.data?._groupCount || 0;
              const man = p.data?._man || 0, eqpt = p.data?._eqpt || 0, veh = p.data?._veh || 0;
              const collapsed = p.data?._collapsed;
              const chSvg2 = collapsed
                ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>'
                : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';
              div.style.cssText = 'background:#2E5096;color:#fff;font-weight:800;font-size:12px;padding:0 14px 0 28px;display:flex;align-items:center;height:100%;letter-spacing:.4px;gap:8px;cursor:pointer;user-select:none';
              div.innerHTML = `${chSvg2}${cat}<span style="font-weight:400;font-size:11px;opacity:.65">&mdash; ${cnt} activity(ies) &nbsp;|&nbsp; Man: ${man} &nbsp;Eqpt: ${eqpt} &nbsp;Veh: ${veh}</span>`;
              div.addEventListener('click', () => {
                const typeLabel = p.data?._typeLabel;
                const catLabel  = p.data?._groupLabel;
                if (!typeLabel || !catLabel) return;
                const key = `${typeLabel}__${catLabel}`;
                this._dpCollapsedCats.has(key) ? this._dpCollapsedCats.delete(key) : this._dpCollapsedCats.add(key);
                this._dpApi?.setGridOption('rowData', this._buildDpFlatRows());
              });
            }
            return div;
          },
          rowClassRules: {
            'jp-subtotal-row': (p: any) => p.data?._type === 'type-subtotal',
          },
        });
      }
    });
  }
}
