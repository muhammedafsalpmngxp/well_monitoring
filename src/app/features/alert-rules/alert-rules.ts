/**
 * Smart Alert rule engine.
 *
 * A platform admin doesn't act on individual alerts — they define the *rules*
 * that raise alerts and assign each to the roles / users / clusters / sites /
 * wells it applies to. A rule is generic: it composes one or more predefined
 * conditions (building blocks) with a match mode (ALL = AND / ANY = OR), each
 * condition carrying its own tunable thresholds. Enabled rules are evaluated
 * (here, over representative demo data) to produce the Smart Alerts.
 *
 * No backend — rules persist in localStorage and alert generation runs over
 * sample situations so the flow is fully working end-to-end.
 */

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type MatchMode = 'ALL' | 'ANY';

/** How a rule decides *who* to notify — chosen by the admin per rule. */
export type AssignMethod = 'attribute' | 'scope' | 'ownership' | 'groups' | 'oncall';

/** A tunable threshold on a condition. */
export interface ConditionParam { key: string; label: string; default: number; unit: string; }

/** A predefined condition (building block) an admin can add to a rule. */
export interface ConditionDef {
  key: string;
  label: string;              // short label for pickers / grid
  summary: string;            // what it detects
  category: string;           // display category
  catClass: string;           // Smart Alerts colour class
  suggestSeverity: Severity;  // prefills rule severity when it's the first condition
  params: ConditionParam[];
}

/* ─────────────────────────── Condition catalogue ───────────────────────────
   Atomic, predefined conditions. A rule = one or more of these, combined. */

export const CONDITIONS: ConditionDef[] = [
  { key: 'rig-on-approaching', label: 'Rig-on date approaching', summary: 'The rig on-site (spud) date is within the lead window.',
    category: 'Rig Management', catClass: 'sa-cat-rig', suggestSeverity: 'CRITICAL',
    params: [{ key: 'leadDays', label: 'Rig-on date within', default: 7, unit: 'days' }] },
  { key: 'progress-below-plan', label: 'Progress below plan', summary: 'Actual progress is below the planned progress by more than the threshold.',
    category: 'Operations', catClass: 'sa-cat-ops', suggestSeverity: 'HIGH',
    params: [{ key: 'gapPct', label: 'Below plan by', default: 10, unit: '%' }] },
  { key: 'progress-below-norm', label: 'Progress below norm rate', summary: 'Actual progress rate is below the agreed norm rate by more than the threshold.',
    category: 'Operations', catClass: 'sa-cat-ops', suggestSeverity: 'HIGH',
    params: [{ key: 'normGapPct', label: 'Below norm by', default: 15, unit: '%' }] },
  { key: 'activity-planned-soon', label: 'Activity planned soon', summary: 'An activity is planned within the lead window (e.g. tomorrow).',
    category: 'Crew & Activities', catClass: 'sa-cat-ops', suggestSeverity: 'HIGH',
    params: [{ key: 'leadDays', label: 'Activity within next', default: 1, unit: 'days' }] },
  { key: 'crew-unassigned', label: 'No crew assigned', summary: 'The activity has no crew / PH IDs assigned to it.',
    category: 'Crew & Activities', catClass: 'sa-cat-ops', suggestSeverity: 'HIGH', params: [] },
  { key: 'permit-expiring', label: 'Permit expiring', summary: 'A work permit (PTW/PDO) expires within the window.',
    category: 'Regulatory', catClass: 'sa-cat-reg', suggestSeverity: 'MEDIUM',
    params: [{ key: 'daysBefore', label: 'Expiry within', default: 3, unit: 'days' }] },
  { key: 'milestone-passed', label: 'Milestone date passed', summary: 'A key milestone (spud, rig release, first oil) date has passed.',
    category: 'Rig Management', catClass: 'sa-cat-rig', suggestSeverity: 'CRITICAL',
    params: [{ key: 'slipDays', label: 'Slippage beyond', default: 0, unit: 'days' }] },
  { key: 'material-po-missing', label: 'Material / PO not raised', summary: 'The required material PO for an activity has not been raised.',
    category: 'Material', catClass: 'sa-cat-mat', suggestSeverity: 'MEDIUM', params: [] },
  { key: 'activity-overdue', label: 'Activity overdue', summary: 'A planned activity is past its planned end date and not complete.',
    category: 'Operations', catClass: 'sa-cat-ops', suggestSeverity: 'HIGH',
    params: [{ key: 'overdueDays', label: 'Overdue beyond', default: 0, unit: 'days' }] },
  { key: 'idle-crew', label: 'Crew idle (no activity)', summary: 'A crew is assigned but has no planned activity — an idle resource.',
    category: 'Crew & Activities', catClass: 'sa-cat-ops', suggestSeverity: 'LOW',
    params: [{ key: 'idleDays', label: 'Idle for at least', default: 1, unit: 'days' }] }
];

export function getCondition(key: string): ConditionDef | undefined { return CONDITIONS.find(c => c.key === key); }

/* ─────────────────────────── Rule model ─────────────────────────── */

/** One condition instance inside a rule (a catalogue key + its threshold values). */
export interface RuleCondition { key: string; params: Record<string, number>; }

/** Who a rule applies to (Scope-first method). Empty array in a dimension = "any". */
export interface RuleScope { roles: string[]; users: string[]; clusters: string[]; plants: string[]; wells: string[]; }

/** Attribute-based (dynamic audience): a live rule over employee attributes. */
export interface AttrClause { field: string; values: string[]; }
export interface AttributeAssignment { match: MatchMode; clauses: AttrClause[]; }

/** Responsibility / ownership routing: notify the owner(s) of the affected entity. */
export interface OwnershipAssignment { targets: string[]; escalation: string[]; }

/** Groups / distribution lists synced from HR / AD / IdP. */
export interface GroupsAssignment { groups: string[]; }

/** On-call schedule / rotation: notify whoever is on shift. */
export interface OncallAssignment { schedules: string[]; }

export interface AlertRule {
  id: string;
  name: string;
  severity: Severity;
  match: MatchMode;               // combine conditions with AND (ALL) / OR (ANY)
  conditions: RuleCondition[];
  slaHours: number;               // assigned users must close the alert within this
  enabled: boolean;
  /** Assignment strategy + its per-method config (defaults to 'scope'). */
  assignMethod?: AssignMethod;
  scope: RuleScope;               // 'scope' method
  attribute?: AttributeAssignment;// 'attribute' method
  ownership?: OwnershipAssignment; // 'ownership' method
  groups?: GroupsAssignment;      // 'groups' method
  oncall?: OncallAssignment;      // 'oncall' method
  builtIn?: boolean;
  createdAt: number;
}

/** A generated alert, shaped for the existing Smart Alerts renderer (saAlertsData). */
export interface GeneratedAlert {
  id: string;
  sev: Severity; cat: string; catClass: string; due: string;
  title: string; desc: string; well: string; time: string; user: string; pct: number;
  ruleId: string; scopeLabel: string; slaHours: number; slaText: string;
  condKey: string;        // primary condition key (drives runbook / current-value context)
  ruleName: string;       // owning rule name (for grouping / history)
}

/* ─────────────────────────── Assignment option lists ─────────────────────────── */

export const ROLE_OPTIONS = ['Admin', 'Cluster Admin', 'Site Admin', 'Planner', 'Site Engineer', 'Site MGT', 'QA QC', 'HSE'];
export const USER_OPTIONS = ['Lavlesh Kumar Singh', 'Suresh Menon', 'Mohammed Al Balushi', 'K. Santosh', 'George Thomas', 'Rakesh Pillai'];
export const CLUSTER_OPTIONS = ['Nimr', 'Marmul', 'Amin'];
export const PLANT_OPTIONS = ['Nimr CPF', 'Marmul CPF', 'Amin CPF'];
export const WELL_OPTIONS = ['30750', '31022', '30991', '30480', '34357', '34422', '36078'];
export const DISCIPLINE_OPTIONS = ['Civil', 'Mechanical', 'Electrical', 'Instrumentation', 'HSE'];

/** Attribute-based method — the employee attributes an audience rule can filter on. */
export interface AttrField { key: string; label: string; options: string[]; }
export const ATTR_FIELDS: AttrField[] = [
  { key: 'role', label: 'Role', options: ROLE_OPTIONS },
  { key: 'cluster', label: 'Cluster', options: CLUSTER_OPTIONS },
  { key: 'plant', label: 'Site / Plant', options: PLANT_OPTIONS },
  { key: 'discipline', label: 'Discipline', options: DISCIPLINE_OPTIONS }
];

/** Ownership method — who "owns" the affected entity, plus escalation tiers. */
export const OWNER_TARGETS = ['Well owner', 'Site supervisor', 'Crew lead', 'Assigned planner', 'Discipline lead'];
export const ESCALATION_TIERS = ['Supervisor', 'Cluster manager', 'Operations director'];

/** Groups method — named distribution lists (synced from HR / AD / IdP). */
export const GROUP_OPTIONS = ['Nimr Ops Team', 'Marmul Ops Team', 'Amin Ops Team', 'HSE On-Call', 'Well Delivery', 'Drilling Supervisors', 'Planners Guild'];

/** On-call method — rotation schedules. */
export const ONCALL_OPTIONS = ['Drilling On-Call (24×7)', 'HSE On-Call', 'Nimr Day Shift', 'Marmul Night Shift', 'Duty Planner Rotation'];

/** The five assignment strategies an admin can choose between, per rule. */
export const ASSIGN_METHODS: { key: AssignMethod; label: string; desc: string }[] = [
  { key: 'attribute', label: 'Attribute-based (dynamic)',    desc: 'Resolve recipients live from a rule over employee attributes (Role, Cluster, Site, Discipline). New joiners/movers are auto-included.' },
  { key: 'scope',     label: 'Scope-first',                  desc: 'Assign by organizational scope (roles × clusters / sites / wells) with optional individual overrides.' },
  { key: 'ownership', label: 'Responsibility / ownership',   desc: 'Route to whoever owns the affected entity (site supervisor, crew lead, well owner), with an escalation chain.' },
  { key: 'groups',    label: 'Groups / distribution lists',  desc: 'Assign to named groups synced from HR / AD / IdP — membership is maintained centrally.' },
  { key: 'oncall',    label: 'On-call schedule / rotation',  desc: 'Notify whoever is on shift in the selected rotation, not the whole role.' }
];
export function assignMethodLabel(m?: AssignMethod): string {
  return (ASSIGN_METHODS.find(x => x.key === (m || 'scope')) || ASSIGN_METHODS[1]).label;
}

export function emptyScope(): RuleScope { return { roles: [], users: [], clusters: [], plants: [], wells: [] }; }
export function defaultAttribute(): AttributeAssignment { return { match: 'ALL', clauses: [] }; }
export function defaultOwnership(): OwnershipAssignment { return { targets: [], escalation: [] }; }
export function defaultGroups(): GroupsAssignment { return { groups: [] }; }
export function defaultOncall(): OncallAssignment { return { schedules: [] }; }

export function scopeSummary(scope: RuleScope): string {
  const parts: string[] = [];
  const add = (label: string, arr: string[]) => { if (arr && arr.length) parts.push(label + ': ' + arr.join(', ')); };
  add('Roles', scope.roles); add('Users', scope.users);
  add('Clusters', scope.clusters); add('Sites', scope.plants); add('Wells', scope.wells);
  return parts.length ? parts.join('  ·  ') : 'Everyone (unscoped)';
}

/** Readable "Assigned to" summary for whichever assignment method the rule uses. */
export function assignmentSummary(rule: AlertRule): string {
  const m = rule.assignMethod || 'scope';
  if (m === 'attribute') {
    const a = rule.attribute;
    const clauses = (a?.clauses || []).filter(c => c.values.length);
    if (!clauses.length) return 'Dynamic · all employees (no filter)';
    const fieldLabel = (k: string) => ATTR_FIELDS.find(f => f.key === k)?.label || k;
    const joiner = a!.match === 'ALL' ? '  AND  ' : '  OR  ';
    return 'Where ' + clauses.map(c => `${fieldLabel(c.field)} ∈ {${c.values.join(', ')}}`).join(joiner);
  }
  if (m === 'ownership') {
    const o = rule.ownership;
    const t = (o?.targets.length) ? o!.targets.join(', ') : 'Entity owner';
    const esc = (o?.escalation.length) ? '  ·  Escalates: ' + o!.escalation.join(' → ') : '';
    return 'Owner: ' + t + esc;
  }
  if (m === 'groups') {
    const g = rule.groups;
    return (g?.groups.length) ? 'Groups: ' + g!.groups.join(', ') : 'No groups selected';
  }
  if (m === 'oncall') {
    const s = rule.oncall;
    return (s?.schedules.length) ? 'On-call: ' + s!.schedules.join(', ') : 'No schedule selected';
  }
  return scopeSummary(rule.scope);
}

/** Roles a rule targets (used to filter what a non-admin viewer sees), across methods. */
export function rolesTargeted(rule: AlertRule): string[] {
  const m = rule.assignMethod || 'scope';
  if (m === 'scope') return rule.scope.roles || [];
  if (m === 'attribute') { const c = (rule.attribute?.clauses || []).find(x => x.field === 'role'); return c ? c.values : []; }
  return [];   // ownership / groups / oncall resolve recipients dynamically → not role-gated in the demo
}

/** Short label for a rule's composed conditions (for the grid "Scenario" column). */
export function conditionsSummary(rule: AlertRule): string {
  const labels = rule.conditions.map(c => getCondition(c.key)?.label || c.key);
  if (!labels.length) return '—';
  return labels.join(rule.match === 'ALL' ? '  AND  ' : '  OR  ');
}

/* ─────────────────────────── Alert generation ─────────────────────────── */

interface Situation { well: string; pct: number; due: string; }

/** Representative situations each condition would flag (drives the demo alerts).
 *  Each condition maps to several wells so an enabled rule raises multiple alerts. */
const SITUATIONS: Record<string, Situation[]> = {
  'rig-on-approaching': [
    { well: '30750', pct: 58, due: '6 days' }, { well: '31022', pct: 64, due: '5 days' }, { well: '30991', pct: 40, due: '3 days' }
  ],
  'progress-below-plan': [
    { well: '30750', pct: 58, due: '6 days' }, { well: '30480', pct: 47, due: '4 days' }, { well: '34422', pct: 51, due: '7 days' },
    { well: '31022', pct: 62, due: '5 days' }, { well: '34357', pct: 55, due: '8 days' }
  ],
  'progress-below-norm': [
    { well: '30480', pct: 47, due: '4 days' }, { well: '34422', pct: 51, due: '6 days' }, { well: '36078', pct: 44, due: '9 days' }
  ],
  'activity-planned-soon': [
    { well: '30991', pct: 40, due: '1 day' }, { well: '30480', pct: 47, due: '1 day' }, { well: '31022', pct: 64, due: '2 days' }
  ],
  'crew-unassigned': [
    { well: '30991', pct: 40, due: '1 day' }, { well: '36078', pct: 44, due: '1 day' }, { well: '34357', pct: 76, due: '2 days' }
  ],
  'permit-expiring': [
    { well: '31022', pct: 64, due: '3 days' }, { well: '30750', pct: 58, due: '2 days' }, { well: '30480', pct: 47, due: '4 days' }
  ],
  'milestone-passed': [
    { well: 'AMIN_OP31', pct: 16, due: 'Overdue' }, { well: '30991', pct: 40, due: 'Overdue' }
  ],
  'material-po-missing': [
    { well: '30480', pct: 47, due: '5 days' }, { well: '34357', pct: 76, due: '6 days' }
  ],
  'activity-overdue': [
    { well: '34357', pct: 76, due: 'Overdue' }, { well: '34422', pct: 71, due: 'Overdue' }
  ],
  'idle-crew': [
    { well: '34422', pct: 71, due: '—' }, { well: '36078', pct: 44, due: '—' }
  ]
};

/** A readable clause for a single condition, with its thresholds filled in. */
function conditionPhrase(c: RuleCondition): string {
  const p = c.params || {};
  switch (c.key) {
    case 'rig-on-approaching': return `rig-on date is within ${p['leadDays']} days`;
    case 'progress-below-plan': return `progress is more than ${p['gapPct']}% below plan`;
    case 'progress-below-norm': return `progress rate is more than ${p['normGapPct']}% below norm`;
    case 'activity-planned-soon': return `an activity is planned within ${p['leadDays']} day(s)`;
    case 'crew-unassigned': return `no crew / PH IDs are assigned`;
    case 'permit-expiring': return `a permit expires within ${p['daysBefore']} days`;
    case 'milestone-passed': return `a milestone date has passed by more than ${p['slipDays']} day(s)`;
    case 'material-po-missing': return `the required material PO has not been raised`;
    case 'activity-overdue': return `an activity is overdue by more than ${p['overdueDays']} day(s)`;
    case 'idle-crew': return `a crew is idle for at least ${p['idleDays']} day(s)`;
    default: return getCondition(c.key)?.label || c.key;
  }
}

/**
 * Evaluate enabled rules → alerts for the Smart Alerts list.
 * `viewerRole` (if given) filters to rules that apply to that role — Admin sees
 * all. Rules scoped to specific wells emit an alert per well.
 */
export function generateAlertsFromRules(viewerRole?: string): GeneratedAlert[] {
  const isAdmin = !viewerRole || /admin/i.test(viewerRole);
  const out: GeneratedAlert[] = [];
  for (const rule of getAllRules()) {
    if (!rule.enabled || !rule.conditions.length) continue;
    const roles = rolesTargeted(rule);
    if (!isAdmin && roles.length && !roles.includes(viewerRole!)) continue;

    const primary = getCondition(rule.conditions[0].key);
    if (!primary) continue;
    const sits = SITUATIONS[rule.conditions[0].key] || [{ well: '—', pct: 50, due: '—' }];
    const joiner = rule.match === 'ALL' ? ' AND ' : ' OR ';
    const clause = rule.conditions.map(conditionPhrase).join(joiner);

    // The Scope method can pin a rule to specific wells → one alert per well.
    // For any other method (or unscoped) the admin monitors every situation,
    // while a normal user is typically tied to a single well → one alert.
    const pinnedWells = (rule.assignMethod || 'scope') === 'scope' ? rule.scope.wells : [];
    const entries: Situation[] = pinnedWells.length
      ? pinnedWells.map(w => ({ well: w, pct: sits[0].pct, due: sits[0].due }))
      : (isAdmin ? sits : [sits[0]]);
    for (const s of entries) {
      out.push({
        id: rule.id + '|' + s.well,
        sev: rule.severity, cat: primary.category, catClass: primary.catClass, due: s.due,
        title: `${rule.name} — ${s.well}`,
        desc: `Triggered because ${clause}.`,
        well: s.well, pct: s.pct, time: 'from rule', user: 'Rule Engine',
        ruleId: rule.id, scopeLabel: assignmentSummary(rule),
        slaHours: rule.slaHours || 0, slaText: rule.slaHours ? ('SLA ' + rule.slaHours + 'h') : '',
        condKey: rule.conditions[0].key, ruleName: rule.name
      });
    }
  }
  return out;
}

/* ─────────────── User-side alert state (triage / act / collaborate) ───────────────
   Everything an assigned user does to an alert — acknowledge, close (with a
   resolution code + note), snooze, reassign, comment — persists here so the
   experience is fully working without a backend. Keyed by alert id. */

export type AlertStatus = 'active' | 'acknowledged' | 'snoozed' | 'closed';
export interface AlertComment { author: string; text: string; at: number; }
export interface AlertState {
  status: AlertStatus;
  ackAt?: number; ackBy?: string;
  closedAt?: number; resolution?: string; note?: string;
  snoozeUntil?: number;
  assignee?: string;
  comments: AlertComment[];
}

/** Resolution codes captured when a user closes an alert. */
export const RESOLUTION_CODES = ['Crew assigned', 'Permit renewed', 'PO raised', 'Rescheduled', 'Escalated', 'False alarm', 'Resolved — other'];

/** Recommended next step (runbook) per condition — shown on the alert card. */
const RUNBOOK: Record<string, string> = {
  'rig-on-approaching': 'Confirm rig mobilisation & location readiness with the drilling supervisor.',
  'progress-below-plan': 'Review the schedule and reallocate crew / resources to recover the gap.',
  'progress-below-norm': 'Investigate the low rate — check crew size, equipment and permit blockers.',
  'activity-planned-soon': 'Verify crew, materials and permits are in place for the upcoming activity.',
  'crew-unassigned': 'Assign a crew / PH IDs to the activity in the scheduler.',
  'permit-expiring': 'Raise a permit renewal (PTW / PDO) before it lapses.',
  'milestone-passed': 'Update the milestone plan and flag the slippage to the planner.',
  'material-po-missing': 'Raise the material PO with procurement.',
  'activity-overdue': 'Close out or reschedule the overdue activity.',
  'idle-crew': 'Reassign the idle crew to a planned activity.'
};
export function runbookForCondition(condKey: string): string { return RUNBOOK[condKey] || 'Review the alert and take the appropriate action.'; }

/** Severity → escalation target (who it goes to if unacknowledged in time). */
const ESCALATE_TO: Record<Severity, string> = {
  CRITICAL: 'Operations Director', HIGH: 'Cluster Manager', MEDIUM: 'Site Supervisor', LOW: 'Team Lead', INFO: 'Team Lead'
};
export function escalatesTo(sev: Severity): string { return ESCALATE_TO[sev] || 'Supervisor'; }

const SEV_WEIGHT: Record<Severity, number> = { CRITICAL: 100, HIGH: 70, MEDIUM: 45, LOW: 20, INFO: 10 };

const STATE_KEY = 'smartops.saUserState';
const FIRED_KEY = 'smartops.saFiredAt';
const MUTE_KEY = 'smartops.saMutedRules';
const HR = 3600 * 1000;

function loadStates(): Record<string, AlertState> {
  try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch { return {}; }
}
function saveStates(m: Record<string, AlertState>): void {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(m)); } catch { /* noop */ }
}
export function getAlertState(id: string): AlertState {
  const s = loadStates()[id];
  return s ? { comments: [], ...s } : { status: 'active', comments: [] };
}
function mutateState(id: string, fn: (s: AlertState) => void): void {
  const m = loadStates();
  const s: AlertState = m[id] ? { comments: [], ...m[id] } : { status: 'active', comments: [] };
  fn(s); m[id] = s; saveStates(m);
}

/** Stable "fired" timestamp per alert (first time it's seen) → drives SLA countdown. */
function firedMap(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(FIRED_KEY) || '{}'); } catch { return {}; }
}
function getFiredAt(id: string, now: number): number {
  const m = firedMap();
  if (!m[id]) { m[id] = now; try { localStorage.setItem(FIRED_KEY, JSON.stringify(m)); } catch { /* noop */ } }
  return m[id];
}

/* Muted rules (per-user noise control). */
export function getMutedRules(): string[] { try { return JSON.parse(localStorage.getItem(MUTE_KEY) || '[]'); } catch { return []; } }
export function isRuleMuted(ruleId: string): boolean { return getMutedRules().includes(ruleId); }
export function setRuleMuted(ruleId: string, muted: boolean): void {
  const set = new Set(getMutedRules());
  if (muted) set.add(ruleId); else set.delete(ruleId);
  try { localStorage.setItem(MUTE_KEY, JSON.stringify([...set])); } catch { /* noop */ }
}

/* ── Actions the acting user can take ── */
export function ackAlert(id: string, by: string, now = Date.now()): void {
  mutateState(id, s => { if (s.status !== 'closed') { s.status = 'acknowledged'; s.ackAt = now; s.ackBy = by; } });
}
export function closeAlertWithReason(id: string, resolution: string, note: string, now = Date.now()): void {
  mutateState(id, s => { s.status = 'closed'; s.closedAt = now; s.resolution = resolution; s.note = note; });
}
/** Back-compat: legacy plain close (no reason). */
export function closeAlert(id: string): void { closeAlertWithReason(id, 'Resolved', '', Date.now()); }
export function snoozeAlert(id: string, until: number): void {
  mutateState(id, s => { if (s.status !== 'closed') { s.status = 'snoozed'; s.snoozeUntil = until; } });
}
export function reassignAlert(id: string, assignee: string): void { mutateState(id, s => { s.assignee = assignee; }); }
export function addComment(id: string, author: string, text: string, now = Date.now()): void {
  mutateState(id, s => { s.comments = s.comments || []; s.comments.push({ author, text, at: now }); });
}
export function reopenAlert(id: string): void {
  mutateState(id, s => { s.status = 'active'; s.closedAt = undefined; s.resolution = undefined; s.snoozeUntil = undefined; });
}

/** Closed ids (derived from state) — kept for back-compat with the bell/legacy view. */
export function getClosedIds(): string[] {
  const m = loadStates(); return Object.keys(m).filter(id => m[id].status === 'closed');
}

/* ── Enriched alerts (SLA countdown, priority, runbook, live state) ── */
export interface EnrichedAlert extends GeneratedAlert {
  state: AlertState;
  effectiveStatus: AlertStatus;   // snooze auto-expires back to active
  firedAt: number;
  deadline: number;               // firedAt + slaHours (0 = no SLA)
  msLeft: number;                 // deadline - now (negative = breached)
  hasSla: boolean;
  atRisk: boolean;                // < 1h left, open
  breached: boolean;              // past deadline, open
  priority: number;               // triage score
  runbook: string;
  escalateTo: string;
  muted: boolean;
}

/** All alerts for a viewer (incl. closed), enriched for the user experience. */
export function enrichedAlertsForViewer(role: string | undefined, now = Date.now()): EnrichedAlert[] {
  return generateAlertsFromRules(role).map(a => {
    const state = getAlertState(a.id);
    const firedAt = getFiredAt(a.id, now);
    const hasSla = (a.slaHours || 0) > 0;
    const deadline = hasSla ? firedAt + a.slaHours * HR : 0;
    const msLeft = hasSla ? deadline - now : Infinity;
    // Snooze auto-expires.
    let effectiveStatus = state.status;
    if (effectiveStatus === 'snoozed' && state.snoozeUntil && state.snoozeUntil <= now) effectiveStatus = 'active';
    const open = effectiveStatus === 'active' || effectiveStatus === 'acknowledged';
    const breached = hasSla && open && msLeft < 0;
    const atRisk = hasSla && open && msLeft >= 0 && msLeft < HR;
    const urgency = !hasSla ? 0 : (msLeft < 0 ? 60 : msLeft < HR ? 45 : msLeft < 4 * HR ? 25 : 8);
    const priority = SEV_WEIGHT[a.sev] + urgency + (effectiveStatus === 'acknowledged' ? -5 : 0);
    return {
      ...a, state, effectiveStatus, firedAt, deadline, msLeft, hasSla, atRisk, breached,
      priority, runbook: runbookForCondition(a.condKey), escalateTo: escalatesTo(a.sev), muted: isRuleMuted(a.ruleId)
    };
  });
}

/** Open (active/acknowledged, not snoozed/closed) alerts — used by the bell + legacy view. */
export function openAlertsForViewer(role?: string): GeneratedAlert[] {
  return enrichedAlertsForViewer(role).filter(a => a.effectiveStatus === 'active' || a.effectiveStatus === 'acknowledged');
}

/** One-line AI-style summary of the user's open alerts. */
export function aiAlertSummary(alerts: EnrichedAlert[]): string {
  const open = alerts.filter(a => a.effectiveStatus === 'active' || a.effectiveStatus === 'acknowledged');
  if (!open.length) return 'You’re all clear — no open alerts right now.';
  const crit = open.filter(a => a.sev === 'CRITICAL').length;
  const breaching = open.filter(a => a.atRisk).length;
  const breached = open.filter(a => a.breached).length;
  const wells = Array.from(new Set(open.map(a => a.well)));
  const parts: string[] = [`${open.length} open alert${open.length === 1 ? '' : 's'} across ${wells.length} well${wells.length === 1 ? '' : 's'}`];
  if (crit) parts.push(`${crit} critical`);
  if (breached) parts.push(`${breached} past SLA`);
  else if (breaching) parts.push(`${breaching} breaching within the hour`);
  const soonest = open.filter(a => a.hasSla && a.msLeft > 0).sort((x, y) => x.msLeft - y.msLeft)[0];
  if (soonest) { const mins = Math.max(1, Math.round(soonest.msLeft / 60000)); parts.push(`next SLA in ${mins < 60 ? mins + 'm' : Math.round(mins / 60) + 'h'}`); }
  return parts.join(' · ') + '.';
}

/** Suggested resolution for an alert, learned from how similar ones were closed. */
export function suggestedResolution(alert: EnrichedAlert): string {
  const states = loadStates();
  const counts: Record<string, number> = {};
  Object.keys(states).forEach(id => {
    const st = states[id];
    if (st.status === 'closed' && st.resolution && id.split('|')[0] === alert.ruleId) counts[st.resolution] = (counts[st.resolution] || 0) + 1;
  });
  const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  return top || '';
}

/** Personal accountability summary over closed alerts. */
export interface AlertPerf { closed: number; onTime: number; breached: number; onTimePct: number; avgResponseMins: number; }
export function alertPerformance(role: string | undefined, now = Date.now()): AlertPerf {
  const states = loadStates();
  const fired = firedMap();
  let closed = 0, onTime = 0, breached = 0, respSum = 0, respN = 0;
  const mine = new Set(generateAlertsFromRules(role).map(a => a.id));
  Object.keys(states).forEach(id => {
    const st = states[id];
    if (st.status !== 'closed' || !mine.has(id)) return;
    closed++;
    const rule = getRule(id.split('|')[0]);
    const sla = rule?.slaHours || 0;
    const f = fired[id];
    if (sla && f && st.closedAt != null) {
      if (st.closedAt <= f + sla * HR) onTime++; else breached++;
    }
    const start = f; const end = st.ackAt || st.closedAt;
    if (start && end) { respSum += (end - start); respN++; }
  });
  return {
    closed, onTime, breached,
    onTimePct: (onTime + breached) ? Math.round((onTime / (onTime + breached)) * 100) : 100,
    avgResponseMins: respN ? Math.round(respSum / respN / 60000) : 0
  };
}

/* ─────────────────────────── Persistence + seeds ─────────────────────────── */

const KEY = 'smartops.alertRules';

const SEED_RULES: AlertRule[] = [
  {
    id: 'seed-progress-plan', name: 'Well progress behind plan',
    severity: 'HIGH', match: 'ALL', slaHours: 24,
    conditions: [{ key: 'progress-below-plan', params: { gapPct: 8 } }],
    // Scope method, unscoped → applies to every viewer, so the list is never sparse.
    enabled: true, assignMethod: 'scope', scope: { roles: [], users: [], clusters: [], plants: [], wells: [] },
    builtIn: true, createdAt: Date.parse('2026-05-28T09:00:00')
  },
  {
    id: 'seed-rig-progress', name: 'Rig-on approaching & progress behind plan',
    severity: 'CRITICAL', match: 'ALL', slaHours: 8,
    conditions: [
      { key: 'rig-on-approaching', params: { leadDays: 7 } },
      { key: 'progress-below-plan', params: { gapPct: 10 } }
    ],
    // Scope method — role × cluster.
    enabled: true, assignMethod: 'scope',
    scope: { roles: ['Planner', 'Site MGT'], users: [], clusters: ['Nimr'], plants: [], wells: [] },
    builtIn: true, createdAt: Date.parse('2026-06-02T08:15:00')
  },
  {
    id: 'seed-unassigned-crew', name: 'Tomorrow’s activity has no crew assigned',
    severity: 'HIGH', match: 'ALL', slaHours: 24,
    conditions: [
      { key: 'activity-planned-soon', params: { leadDays: 1 } },
      { key: 'crew-unassigned', params: {} }
    ],
    // Attribute-based (dynamic audience) — any Planner or Site Engineer.
    enabled: true, assignMethod: 'attribute',
    attribute: { match: 'ANY', clauses: [{ field: 'role', values: ['Planner', 'Site Engineer'] }] },
    scope: { roles: [], users: [], clusters: [], plants: [], wells: [] },
    builtIn: true, createdAt: Date.parse('2026-06-10T10:40:00')
  },
  {
    id: 'seed-permit-expiry', name: 'Permit expiring before activity completes',
    severity: 'MEDIUM', match: 'ALL', slaHours: 48,
    conditions: [{ key: 'permit-expiring', params: { daysBefore: 3 } }],
    // Groups / distribution list method.
    enabled: true, assignMethod: 'groups',
    groups: { groups: ['HSE On-Call'] },
    scope: { roles: [], users: [], clusters: [], plants: [], wells: [] },
    builtIn: true, createdAt: Date.parse('2026-06-21T14:05:00')
  },
  {
    id: 'seed-crew-idle', name: 'Crew idle — notify whoever is on shift',
    severity: 'LOW', match: 'ALL', slaHours: 24,
    conditions: [{ key: 'idle-crew', params: { idleDays: 1 } }],
    // On-call schedule / rotation method.
    enabled: false, assignMethod: 'oncall',
    oncall: { schedules: ['Drilling On-Call (24×7)'] },
    scope: { roles: [], users: [], clusters: [], plants: [], wells: [] },
    builtIn: true, createdAt: Date.parse('2026-06-25T11:20:00')
  }
];

function loadUser(): AlertRule[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function saveUser(rules: AlertRule[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(rules)); } catch { /* noop */ }
}

export function getAllRules(): AlertRule[] { return [...SEED_RULES, ...loadUser()]; }
export function getRule(id: string): AlertRule | undefined { return getAllRules().find(r => r.id === id); }

export function saveRule(rule: AlertRule): void {
  const user = loadUser().filter(r => r.id !== rule.id);
  user.unshift(rule);
  saveUser(user);
}
export function deleteRule(id: string): void { saveUser(loadUser().filter(r => r.id !== id)); }

/** Enable/disable. Built-in rules store their state in a small override map. */
const OVR_KEY = 'smartops.alertRuleOverrides';
function loadOverrides(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(OVR_KEY) || '{}'); } catch { return {}; }
}
export function setRuleEnabled(id: string, enabled: boolean): void {
  const seed = SEED_RULES.find(r => r.id === id);
  if (seed) {
    const ovr = loadOverrides(); ovr[id] = enabled;
    try { localStorage.setItem(OVR_KEY, JSON.stringify(ovr)); } catch { /* noop */ }
    seed.enabled = enabled;
  } else {
    const rule = loadUser().find(r => r.id === id);
    if (rule) { rule.enabled = enabled; saveRule(rule); }
  }
}

// Apply persisted overrides to seed rules on module load.
(() => { const ovr = loadOverrides(); SEED_RULES.forEach(r => { if (r.id in ovr) r.enabled = ovr[r.id]; }); })();
