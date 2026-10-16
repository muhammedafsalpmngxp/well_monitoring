/**
 * Database View engine.
 *
 * A saved view is a serialisable DbViewSpec (base table + joins + selected
 * columns + filters). One set of pure functions maps a spec → a CREATE VIEW
 * SQL string and → a preview rowset (the join/filter executed over the demo
 * SAMPLE data). The View Builder authors specs; the list & detail pages read
 * them. In production the SQL would run against the real database; here the
 * preview engine emulates it over sample rows so the flow is fully working.
 */

/* ─────────────────────────── Schema (well-monitoring domain) ─────────────────────────── */

export interface SchemaColumn { n: string; t: string; pk?: boolean; fk?: { table: string; col: string }; }
export interface SchemaTable { columns: SchemaColumn[]; }

export const SCHEMA: Record<string, SchemaTable> = {
  daily_plan: { columns: [
    { n: 'plan_id', t: 'varchar', pk: true }, { n: 'plan_date', t: 'date' },
    { n: 'well_id', t: 'varchar', fk: { table: 'wells', col: 'well_id' } },
    { n: 'discipline', t: 'varchar' }, { n: 'contractor_type', t: 'varchar' },
    { n: 'ph_emp_id', t: 'varchar', fk: { table: 'personnel', col: 'emp_id' } },
    { n: 'permit_id', t: 'varchar', fk: { table: 'permits', col: 'permit_id' } },
    { n: 'job_id', t: 'varchar', fk: { table: 'job_projects', col: 'job_id' } },
    { n: 'manpower', t: 'int' }, { n: 'equipment', t: 'int' }, { n: 'vehicle', t: 'int' } ] },
  wells: { columns: [
    { n: 'well_id', t: 'varchar', pk: true }, { n: 'well_name', t: 'varchar' },
    { n: 'well_category', t: 'varchar' },
    { n: 'location_id', t: 'varchar', fk: { table: 'locations', col: 'location_id' } },
    { n: 'status', t: 'varchar' }, { n: 'spud_date', t: 'date' } ] },
  locations: { columns: [
    { n: 'location_id', t: 'varchar', pk: true }, { n: 'location_name', t: 'varchar' },
    { n: 'field', t: 'varchar' }, { n: 'block', t: 'varchar' } ] },
  personnel: { columns: [
    { n: 'emp_id', t: 'varchar', pk: true }, { n: 'full_name', t: 'varchar' },
    { n: 'role', t: 'varchar' }, { n: 'mobile_no', t: 'varchar' },
    { n: 'contractor_id', t: 'varchar', fk: { table: 'contractors', col: 'contractor_id' } } ] },
  permits: { columns: [
    { n: 'permit_id', t: 'varchar', pk: true }, { n: 'permit_no', t: 'varchar' },
    { n: 'permit_type', t: 'varchar' }, { n: 'issued_date', t: 'date' },
    { n: 'expiry_date', t: 'date' }, { n: 'status', t: 'varchar' } ] },
  contractors: { columns: [
    { n: 'contractor_id', t: 'varchar', pk: true }, { n: 'contractor_name', t: 'varchar' },
    { n: 'contractor_type', t: 'varchar' }, { n: 'contract_no', t: 'varchar' } ] },
  job_projects: { columns: [
    { n: 'job_id', t: 'varchar', pk: true }, { n: 'job_title', t: 'varchar' },
    { n: 'project_code', t: 'varchar' }, { n: 'wbs', t: 'varchar' }, { n: 'po_no', t: 'varchar' } ] },
  resources: { columns: [
    { n: 'resource_id', t: 'varchar', pk: true },
    { n: 'plan_id', t: 'varchar', fk: { table: 'daily_plan', col: 'plan_id' } },
    { n: 'resource_type', t: 'varchar' }, { n: 'quantity', t: 'int' }, { n: 'unit', t: 'varchar' } ] }
};

export const SAMPLE: Record<string, any[]> = {
  daily_plan: [
    { plan_id: 'DP-1', plan_date: '2026-06-19', well_id: '30750', discipline: 'Flowline', contractor_type: 'ATNM', ph_emp_id: '970688', permit_id: 'PM-1', job_id: 'JB-1', manpower: 5, equipment: 6, vehicle: 0 },
    { plan_id: 'DP-2', plan_date: '2026-06-19', well_id: '31022', discipline: 'Flowline', contractor_type: 'ATNM', ph_emp_id: '970712', permit_id: 'PM-2', job_id: 'JB-2', manpower: 4, equipment: 3, vehicle: 1 },
    { plan_id: 'DP-3', plan_date: '2026-06-19', well_id: '30991', discipline: 'Location', contractor_type: 'ATNM', ph_emp_id: '970655', permit_id: 'PM-3', job_id: 'JB-3', manpower: 8, equipment: 4, vehicle: 2 },
    { plan_id: 'DP-4', plan_date: '2026-06-19', well_id: '30480', discipline: 'Flowline', contractor_type: 'Sub Contractors', ph_emp_id: '880231', permit_id: 'PM-4', job_id: 'JB-4', manpower: 6, equipment: 2, vehicle: 0 }
  ],
  wells: [
    { well_id: '30750', well_name: 'AL BURJ-12', well_category: 'Nimr Conversion with Flowline', location_id: 'LOC-01', status: 'Active', spud_date: '2026-05-10' },
    { well_id: '31022', well_name: 'AL BURJ-19', well_category: 'Nimr Conversion with Flowline', location_id: 'LOC-01', status: 'Active', spud_date: '2026-05-22' },
    { well_id: '30991', well_name: 'RIMA-07', well_category: 'Location Preparation', location_id: 'LOC-02', status: 'Planned', spud_date: '2026-06-01' },
    { well_id: '30480', well_name: 'NIMR-33', well_category: 'Flowline Tie-in', location_id: 'LOC-02', status: 'Active', spud_date: '2026-04-18' }
  ],
  locations: [
    { location_id: 'LOC-01', location_name: 'Al Burj', field: 'South', block: 'B-12' },
    { location_id: 'LOC-02', location_name: 'Rima / Nimr', field: 'South', block: 'B-20' }
  ],
  personnel: [
    { emp_id: '970688', full_name: 'LAVLESH KUMAR SINGH', role: 'PH', mobile_no: '71379925', contractor_id: 'C-1' },
    { emp_id: '970712', full_name: 'SURESH MENON', role: 'PH', mobile_no: '71380110', contractor_id: 'C-1' },
    { emp_id: '970655', full_name: 'MOHAMMED AL BALUSHI', role: 'PH', mobile_no: '71377654', contractor_id: 'C-1' },
    { emp_id: '880231', full_name: 'K. SANTOSH', role: 'PH', mobile_no: '71355012', contractor_id: 'C-2' }
  ],
  permits: [
    { permit_id: 'PM-1', permit_no: 'PTW-26-4470', permit_type: 'Hot Work', issued_date: '2026-06-18', expiry_date: '2026-06-25', status: 'Active' },
    { permit_id: 'PM-2', permit_no: 'PTW-26-4471', permit_type: 'Cold Work', issued_date: '2026-06-18', expiry_date: '2026-06-25', status: 'Active' },
    { permit_id: 'PM-3', permit_no: 'PTW-26-4502', permit_type: 'Excavation', issued_date: '2026-06-17', expiry_date: '2026-06-24', status: 'Active' },
    { permit_id: 'PM-4', permit_no: 'PDO-PTW-88213', permit_type: 'Hot Work', issued_date: '2026-06-16', expiry_date: '2026-06-23', status: 'Active' }
  ],
  contractors: [
    { contractor_id: 'C-1', contractor_name: 'Al Tasnim Enterprises', contractor_type: 'ATNM', contract_no: 'C3100000177' },
    { contractor_id: 'C-2', contractor_name: 'Desert Line Services', contractor_type: 'Sub Contractors', contract_no: 'C3100000201' }
  ],
  job_projects: [
    { job_id: 'JB-1', job_title: 'WI2 Conversion', project_code: 'ALBRG_1405250004', wbs: 'WD-3522-30750-FLC-1-M', po_no: '' },
    { job_id: 'JB-2', job_title: 'WI3 Conversion', project_code: 'ALBRG_1405250012', wbs: 'WD-3610-31022-FLC-2-M', po_no: '' },
    { job_id: 'JB-3', job_title: 'Location Prep', project_code: 'RIMA_1405250021', wbs: 'WD-3522-30991-LOC-1-M', po_no: '' },
    { job_id: 'JB-4', job_title: 'Flowline Tie-in', project_code: 'NIMR_1405250008', wbs: 'WD-3401-30480-FLC-1-S', po_no: 'PO-88213' }
  ],
  resources: [
    { resource_id: 'R-1', plan_id: 'DP-1', resource_type: 'Excavator', quantity: 2, unit: 'nos' },
    { resource_id: 'R-2', plan_id: 'DP-1', resource_type: 'Crew', quantity: 5, unit: 'pax' },
    { resource_id: 'R-3', plan_id: 'DP-3', resource_type: 'Grader', quantity: 1, unit: 'nos' }
  ]
};

/** Comparison operators offered in the filter UI: [sqlOp, humanLabel]. */
export const OPS: Array<[string, string]> = [
  ['=', '='], ['<>', '≠'], ['>', '>'], ['<', '<'], ['>=', '≥'], ['<=', '≤'], ['LIKE', 'contains']
];

/* ─────────────────────────── Spec model (serialisable) ─────────────────────────── */

export interface DbTableRef { id: number; table: string; alias: string; }
export interface DbCondition { leftId: number; leftCol: string; rightCol: string; }
export interface DbJoin { type: string; conditions: DbCondition[]; }
export interface DbFilter { fid: number; tableId: number; col: string; op: string; value: string; connector: string; }

export interface DbViewSpec {
  id: string;
  name: string;
  description?: string;
  distinct: boolean;
  tables: DbTableRef[];                 // ordered; tables[0] is the base (FROM)
  joins: Record<number, DbJoin>;        // keyed by joined-table id
  checked: string[];                    // selected columns as "tableId.colName"
  aliases: Record<string, string>;      // "tableId.colName" → output alias
  filters: DbFilter[];
  manualSql?: string | null;            // non-null when the user hand-edited the SQL
  builtIn?: boolean;
  createdAt?: number;
}

/** Preview column: how a selected column surfaces in the result grid. */
export interface PreviewColumn { tableId: number; alias: string; col: string; type: string; as: string; }
export interface PreviewResult { cols: PreviewColumn[]; rows: any[][]; note: string; }

/* ─────────────────────────── SQL generation ─────────────────────────── */

const tById = (spec: DbViewSpec, id: number) => spec.tables.find(t => t.id === id);

/** Checked columns in table-then-schema order (drives both SELECT and preview). */
export function orderedColumns(spec: DbViewSpec): PreviewColumn[] {
  const checked = new Set(spec.checked);
  const out: PreviewColumn[] = [];
  spec.tables.forEach(t => {
    (SCHEMA[t.table]?.columns || []).forEach(c => {
      const key = t.id + '.' + c.n;
      if (checked.has(key)) out.push({ tableId: t.id, alias: t.alias, col: c.n, type: c.t, as: (spec.aliases[key] || '').trim() });
    });
  });
  return out;
}

function isNumeric(v: any): boolean { return /^-?\d+(\.\d+)?$/.test(String(v).trim()); }

function sqlValue(op: string, val: any): string {
  val = val == null ? '' : String(val);
  if (op === 'LIKE') return "'%" + val.replace(/'/g, "''") + "%'";
  if (isNumeric(val)) return val.trim();
  return "'" + val.replace(/'/g, "''") + "'";
}

/** Map a spec → a formatted `CREATE OR REPLACE VIEW … AS SELECT …` statement. */
export function generateSQL(spec: DbViewSpec): string {
  const name = (spec.name || 'new_view').trim();
  if (!spec.tables.length) return '-- Add at least one table to start building your view.';
  const cols = orderedColumns(spec);
  const lines: string[] = [];
  lines.push('CREATE OR REPLACE VIEW ' + name + ' AS');
  lines.push('SELECT' + (spec.distinct ? ' DISTINCT' : ''));
  if (!cols.length) {
    lines.push('    *');
  } else {
    const exprs = cols.map(c => {
      const left = c.alias + '.' + c.col;
      const useAs = c.as && c.as !== c.col ? c.as : null;
      return { left, as: useAs };
    });
    const pad = Math.max(...exprs.map(e => e.left.length));
    exprs.forEach((e, i) => {
      let line = '    ' + e.left;
      if (e.as) line += ' '.repeat(pad - e.left.length + 1) + 'AS ' + e.as;
      lines.push(line + (i < exprs.length - 1 ? ',' : ''));
    });
  }
  const base = spec.tables[0];
  lines.push('FROM ' + base.table + ' ' + base.alias);
  spec.tables.slice(1).forEach(t => {
    const j = spec.joins[t.id] || { type: 'LEFT', conditions: [] };
    const conds = (j.conditions || []).filter(c => c.leftCol && c.rightCol).map(c => {
      const lt = tById(spec, c.leftId); const la = lt ? lt.alias : '?';
      return la + '.' + c.leftCol + ' = ' + t.alias + '.' + c.rightCol;
    });
    const onStr = conds.length ? conds.join('\n    AND ') : '/* define join condition */';
    lines.push(j.type + ' JOIN ' + t.table + ' ' + t.alias + ' ON ' + onStr);
  });
  if (spec.filters.length) {
    const parts: string[] = [];
    spec.filters.forEach(f => {
      const t = tById(spec, f.tableId); if (!t || !f.col) return;
      const clause = t.alias + '.' + f.col + ' ' + f.op + ' ' + sqlValue(f.op, f.value);
      parts.push((parts.length ? (f.connector || 'AND') + ' ' : '') + clause);
    });
    if (parts.length) { lines.push('WHERE ' + parts[0]); for (let i = 1; i < parts.length; i++) lines.push('  ' + parts[i]); }
  }
  return lines.join('\n') + '\n;';
}

/** The SQL a view exposes — the user's manual edit if present, else generated. */
export function viewSQL(spec: DbViewSpec): string {
  return spec.manualSql != null ? spec.manualSql : generateSQL(spec);
}

/* ─────────────────────────── Preview engine (join + filter over SAMPLE) ─────────────────────────── */

/** Execute the spec's joins + filters over the demo SAMPLE data → result rows. */
export function runPreview(spec: DbViewSpec): PreviewResult {
  if (!spec.tables.length) return { cols: [], rows: [], note: 'Add tables to preview output.' };
  let note = '';
  let combined: Array<Record<number, any>> = (SAMPLE[spec.tables[0].table] || []).map(r => ({ [spec.tables[0].id]: r }));
  for (let i = 1; i < spec.tables.length; i++) {
    const t = spec.tables[i]; const j = spec.joins[t.id] || { type: 'LEFT', conditions: [] };
    const rrows = SAMPLE[t.table] || []; const conds = (j.conditions || []).filter(c => c.leftCol && c.rightCol);
    const type = j.type || 'LEFT'; const next: Array<Record<number, any>> = []; const matched = new Set<any>();
    if (!conds.length) note = 'Add a join condition for “' + t.table + '” to match rows.';
    combined.forEach(cr => {
      const ms = conds.length ? rrows.filter(rr => conds.every(c => {
        const lv = cr[c.leftId] ? cr[c.leftId][c.leftCol] : undefined; return lv != null && String(lv) === String(rr[c.rightCol]);
      })) : [];
      if (ms.length) { ms.forEach(m => { matched.add(m); next.push({ ...cr, [t.id]: m }); }); }
      else if (type === 'LEFT' || type === 'FULL') next.push({ ...cr, [t.id]: null });
    });
    if (type === 'RIGHT' || type === 'FULL') {
      rrows.forEach(rr => { if (!matched.has(rr)) next.push({ [t.id]: rr }); });
      note = 'RIGHT/FULL joins are approximated in this preview.';
    }
    combined = next;
  }
  // WHERE filters
  combined = combined.filter(cr => {
    if (!spec.filters.length) return true;
    let acc: boolean | null = null;
    spec.filters.forEach(f => {
      const t = tById(spec, f.tableId); if (!t || !f.col) return;
      const v = cr[f.tableId] ? cr[f.tableId][f.col] : null;
      let ok: boolean;
      const val = f.value, num = isNumeric(val) && isNumeric(v);
      const a: any = num ? parseFloat(v) : String(v == null ? '' : v), b: any = num ? parseFloat(val) : String(val == null ? '' : val);
      switch (f.op) {
        case '=': ok = String(v) === String(val); break;
        case '<>': ok = String(v) !== String(val); break;
        case '>': ok = a > b; break; case '<': ok = a < b; break;
        case '>=': ok = a >= b; break; case '<=': ok = a <= b; break;
        case 'LIKE': ok = String(v == null ? '' : v).toLowerCase().includes(String(val).toLowerCase()); break;
        default: ok = true;
      }
      acc = acc === null ? ok : ((f.connector || 'AND') === 'OR' ? (acc || ok) : (acc && ok));
    });
    return acc === null ? true : acc;
  });
  const cols = orderedColumns(spec);
  let rows = combined.map(cr => cols.map(c => { const s = cr[c.tableId]; return s ? s[c.col] : null; }));
  if (spec.distinct) { const seen = new Set<string>(); rows = rows.filter(r => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; }); }
  return { cols, rows, note };
}

/** Display header for a preview column (output alias if set, else `alias.col`). */
export function columnHeader(c: PreviewColumn): string {
  return (c.as && c.as !== c.col) ? c.as : c.alias + '.' + c.col;
}

/** Distinct source tables a view reads from (for the "tables used" display). */
export function tablesUsed(spec: DbViewSpec): string[] {
  return Array.from(new Set(spec.tables.map(t => t.table)));
}

/* ─────────────────────────── Persistence + seeds ─────────────────────────── */

const KEY = 'smartops.dbViews';

/** Two ready-made views so the list is populated on first visit. */
const SEED_VIEWS: DbViewSpec[] = [
  {
    id: 'well_activity_view', name: 'well_activity_view', builtIn: true,
    description: 'Daily plan rows enriched with well name, category and status.',
    distinct: false,
    tables: [{ id: 1, table: 'daily_plan', alias: 'dp' }, { id: 2, table: 'wells', alias: 'w' }],
    joins: { 2: { type: 'LEFT', conditions: [{ leftId: 1, leftCol: 'well_id', rightCol: 'well_id' }] } },
    checked: [
      '1.plan_date', '1.discipline', '1.contractor_type', '1.manpower', '1.equipment', '1.vehicle',
      '2.well_name', '2.well_category', '2.status'
    ],
    aliases: {}, filters: [], createdAt: 0
  },
  {
    id: 'permit_ph_view', name: 'permit_ph_view', builtIn: true,
    description: 'Active permits per daily plan with the responsible PH and permit number.',
    distinct: false,
    tables: [
      { id: 1, table: 'daily_plan', alias: 'dp' },
      { id: 2, table: 'permits', alias: 'pm' },
      { id: 3, table: 'personnel', alias: 'p' }
    ],
    joins: {
      2: { type: 'INNER', conditions: [{ leftId: 1, leftCol: 'permit_id', rightCol: 'permit_id' }] },
      3: { type: 'LEFT', conditions: [{ leftId: 1, leftCol: 'ph_emp_id', rightCol: 'emp_id' }] }
    },
    checked: ['1.plan_date', '1.well_id', '1.discipline', '2.permit_no', '2.permit_type', '2.status', '3.full_name'],
    aliases: { '3.full_name': 'ph_name', '2.status': 'permit_status' },
    filters: [{ fid: 1, tableId: 2, col: 'status', op: '=', value: 'Active', connector: 'AND' }],
    createdAt: 0
  }
];

function loadUser(): DbViewSpec[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function saveUser(specs: DbViewSpec[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(specs)); } catch { /* noop */ }
}

export function getAllViews(): DbViewSpec[] { return [...SEED_VIEWS, ...loadUser()]; }
export function getView(id: string): DbViewSpec | undefined { return getAllViews().find(s => s.id === id); }

export function saveView(spec: DbViewSpec): void {
  const user = loadUser().filter(s => s.id !== spec.id);
  user.unshift(spec);
  saveUser(user);
}
export function deleteView(id: string): void { saveUser(loadUser().filter(s => s.id !== id)); }
