/**
 * Declarative report engine (AG Grid Enterprise).
 *
 * A report is a JSON ReportSpec. One generic renderer maps a spec →
 * AG Grid columnDefs + gridOptions, using Enterprise features for multi-level
 * row grouping, subtotals/grand total, aggregation, and native filters/sort.
 * The Report Builder authors these specs; nothing is hand-coded per report.
 */

export type ColType = 'text' | 'number' | 'percent' | 'money';
export type AggFn = 'sum' | 'avg' | 'min' | 'max' | 'count';

/** A column node — a leaf (field) or a group with children (→ nested column groups). */
export interface ColNode {
  key: string;
  header: string;
  field?: string;      // leaf only
  type?: ColType;      // leaf only
  agg?: AggFn;         // leaf only — aggregation for group/total rows
  width?: number;
  children?: ColNode[]; // group only (children may themselves be groups → groups-of-groups)
}

/** Report chrome shown above the grid (logo + title block + banner). */
export interface ReportHeader {
  logo?: string;        // left image data URL
  logoWidth?: number;   // px (resizable)
  logoRight?: string;   // right image data URL
  logoRightWidth?: number; // px (resizable)
  title?: string;       // e.g. "AL TASNIM ENTERPRISES LLC."
  subtitle?: string;    // e.g. "CONTRACT NO. C3100000177 …"
  banner?: string;      // full-width band, e.g. "JOB PROGRESS REPORT - NIMR"
}

/** Colour theming. */
export interface ReportStyle {
  headerBg?: string;    // column-header background
  headerText?: string;  // column-header text
  bannerBg?: string;    // banner band background
  /** Per column-group / sub-group colour, keyed by the group node key
   *  ("g:Group", "g:Group > Group1"). The colour bands the whole column
   *  (group + sub-group header cells and every data cell beneath it). */
  columnGroupColors?: Record<string, string>;
  /** Top-level row-group value → row background (row-wise colour per group). */
  groupColors?: Record<string, string>;
  /** Report font. */
  fontFamily?: string;
  fontSize?: number;    // px
  fontColor?: string;   // data text colour
}

export interface ReportSpec {
  id: string;
  name: string;
  category: string;
  description?: string;
  /** Dataset id from the dataset registry (or, later, a query across tables). */
  datasetId: string;
  /** Ordered group-by fields → row sections then sub-sections (e.g. cluster → contractor → disc). */
  rowGroups: string[];
  /** Column tree (leaves + nested groups). */
  columns: ColNode[];
  totals: { perGroup: boolean; grand: boolean };
  header?: ReportHeader;
  style?: ReportStyle;
  builtIn?: boolean;
}

/* ─────────────────────────── Dataset registry ───────────────────────────
   Flat, denormalized rowsets. In production a backend report endpoint would
   run the query/joins across tables and return rows + schema; the renderer
   stays data-agnostic. Here we register demo datasets. */

export interface DatasetField { field: string; header: string; type: ColType; }
export interface Dataset { id: string; name: string; fields: DatasetField[]; rows: any[]; }

const DAILY_PLAN_ROWS = [
  { cluster:'Nimr',   contractor:'ATNM',            disc:'Flowline', wellId:'30750', phName:'LAVLESH KUMAR SINGH', wbs:'WD-3522-30750-FLC-1-M', category:'Nimr Conversion with Flowline', location:'AL BURJ', atnmPermit:'PTW-26-4471', pdoPermit:'', manpower:5, eqpt:6, vehicle:2, planPct:70, actualPct:78 },
  { cluster:'Nimr',   contractor:'ATNM',            disc:'Flowline', wellId:'31022', phName:'SURESH MENON',        wbs:'WD-3610-31022-FLC-2-M', category:'Nimr Conversion with Flowline', location:'NIMR',    atnmPermit:'PTW-26-4472', pdoPermit:'', manpower:4, eqpt:3, vehicle:1, planPct:65, actualPct:64 },
  { cluster:'Nimr',   contractor:'ATNM',            disc:'Location', wellId:'30991', phName:'MOHAMMED AL BALUSHI',  wbs:'WD-3522-30991-LOC-1-M', category:'Location Preparation',          location:'NIMR',    atnmPermit:'PTW-26-4502', pdoPermit:'', manpower:8, eqpt:4, vehicle:2, planPct:80, actualPct:88 },
  { cluster:'Nimr',   contractor:'Sub Contractors', disc:'Flowline', wellId:'30480', phName:'K. SANTOSH',          wbs:'WD-3401-30480-FLC-1-S', category:'Flowline Tie-in',               location:'NIMR',    atnmPermit:'', pdoPermit:'PDO-PTW-88213', manpower:6, eqpt:2, vehicle:2, planPct:60, actualPct:47 },
  { cluster:'Nimr',   contractor:'Sub Contractors', disc:'Others',   wellId:'30640', phName:'M. IQBAL',            wbs:'WD-3401-30640-OTH-1-S', category:'Civil Works',                   location:'NIMR',    atnmPermit:'', pdoPermit:'PDO-PTW-88301', manpower:7, eqpt:3, vehicle:2, planPct:55, actualPct:58 },
  { cluster:'Marmul', contractor:'ATNM',            disc:'Flowline', wellId:'34565', phName:'A. RAHMAN',           wbs:'WD-3401-34565-FLC-2-S', category:'Flowline Tie-in',               location:'MARMUL',  atnmPermit:'PTW-26-4520', pdoPermit:'', manpower:5, eqpt:2, vehicle:1, planPct:75, actualPct:71 },
  { cluster:'Marmul', contractor:'ATNM',            disc:'Location', wellId:'34561', phName:'GEORGE THOMAS',       wbs:'WD-3522-34561-LOC-2-M', category:'Location Preparation',          location:'MARMUL',  atnmPermit:'PTW-26-4510', pdoPermit:'', manpower:6, eqpt:3, vehicle:1, planPct:70, actualPct:81 },
  { cluster:'Marmul', contractor:'Sub Contractors', disc:'Others',   wellId:'31780', phName:'RAKESH PILLAI',       wbs:'WD-3401-31780-OTH-1-S', category:'Civil Works',                   location:'MARMUL',  atnmPermit:'', pdoPermit:'PDO-PTW-88220', manpower:3, eqpt:1, vehicle:1, planPct:50, actualPct:52 }
];

const DATASETS: Dataset[] = [
  {
    id: 'daily-plan', name: 'Daily Plan (Wells · Crews · Permits)',
    fields: [
      { field:'cluster',    header:'Cluster',       type:'text' },
      { field:'contractor', header:'ATNM / SC',     type:'text' },
      { field:'disc',       header:'Discipline',    type:'text' },
      { field:'wellId',     header:'Well ID',       type:'text' },
      { field:'phName',     header:'PH Name',       type:'text' },
      { field:'wbs',        header:'WBS',           type:'text' },
      { field:'category',   header:'Well Category', type:'text' },
      { field:'location',   header:'Location',      type:'text' },
      { field:'atnmPermit', header:'ATNM Permit No',type:'text' },
      { field:'pdoPermit',  header:'PDO Permit No', type:'text' },
      { field:'manpower',   header:'Manpower',      type:'number' },
      { field:'eqpt',       header:'Eqpt',          type:'number' },
      { field:'vehicle',    header:'Vehicle',       type:'number' },
      { field:'planPct',    header:'Plan %',        type:'percent' },
      { field:'actualPct',  header:'Actual %',      type:'percent' }
    ],
    rows: DAILY_PLAN_ROWS
  }
];

export function getDatasets(): Dataset[] { return DATASETS; }
export function getDataset(id: string): Dataset | undefined { return DATASETS.find(d => d.id === id); }
/** Rows for a spec's source. (Backend query/join would plug in here.) */
export function getRowsFor(spec: ReportSpec): any[] { return getDataset(spec.datasetId)?.rows || []; }

/* ─────────────────────────── Spec registry ─────────────────────────── */

const KEY = 'smartops.reportSpecs';

/** Built-in example spec: Job Progress-Nimr — Cluster → ATNM/SC → Discipline. */
const BUILT_IN: ReportSpec[] = [
  {
    id: 'job-progress-nimr',
    name: 'Job Progress-Nimr',
    category: 'Daily Plan',
    description: 'Cluster → ATNM/SC → Discipline with permit & resource groups and plan-vs-actual totals.',
    datasetId: 'daily-plan',
    rowGroups: ['cluster', 'contractor', 'disc'],
    columns: [
      { key: 'wellId',   header: 'Well ID',       field: 'wellId',   type: 'text', width: 110 },
      { key: 'phName',   header: 'PH Name',       field: 'phName',   type: 'text', width: 200 },
      { key: 'wbs',      header: 'WBS',           field: 'wbs',      type: 'text', width: 210 },
      { key: 'category', header: 'Well Category', field: 'category', type: 'text', width: 210 },
      { key: 'location', header: 'Location',      field: 'location', type: 'text', width: 110 },
      { key: 'permit', header: 'Permit No', children: [
        { key: 'atnmPermit', header: 'ATNM Permit No', field: 'atnmPermit', type: 'text', width: 150 },
        { key: 'pdoPermit',  header: 'PDO Permit No',  field: 'pdoPermit',  type: 'text', width: 150 }
      ]},
      { key: 'res', header: 'Resource Details (Nos)', children: [
        { key: 'manpower', header: 'Manpower', field: 'manpower', type: 'number', agg: 'sum', width: 120 },
        { key: 'eqpt',     header: 'Eqpt',     field: 'eqpt',     type: 'number', agg: 'sum', width: 100 },
        { key: 'vehicle',  header: 'Vehicle',  field: 'vehicle',  type: 'number', agg: 'sum', width: 110 }
      ]},
      { key: 'progress', header: 'Progress (%)', children: [
        { key: 'planPct',   header: 'Plan %',   field: 'planPct',   type: 'percent', agg: 'avg', width: 110 },
        { key: 'actualPct', header: 'Actual %', field: 'actualPct', type: 'percent', agg: 'avg', width: 110 }
      ]}
    ],
    totals: { perGroup: true, grand: true },
    header: {
      title: 'AL TASNIM ENTERPRISES LLC.',
      subtitle: 'CONTRACT NO. C3100000177, OFF PLOT DELIVERY CONTRACT (ODC SOUTH)',
      banner: 'JOB PROGRESS REPORT - NIMR',
      logoWidth: 120
    },
    style: {
      headerBg: '#B7C0E8', headerText: '#1F2A6B', bannerBg: '#2E7D32',
      groupColors: { Nimr: '#E7EFF6', Marmul: '#FBF0DD' }
    },
    builtIn: true
  }
];

function loadUser(): ReportSpec[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function saveUser(specs: ReportSpec[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(specs)); } catch { /* noop */ }
}

export function getAllSpecs(): ReportSpec[] { return [...BUILT_IN, ...loadUser()]; }
export function getSpec(id: string): ReportSpec | undefined { return getAllSpecs().find(s => s.id === id); }
export function getUserSpecs(): ReportSpec[] { return loadUser(); }

export function saveSpec(spec: ReportSpec): void {
  const user = loadUser().filter(s => s.id !== spec.id);
  user.unshift(spec);
  saveUser(user);
}
export function deleteSpec(id: string): void { saveUser(loadUser().filter(s => s.id !== id)); }
