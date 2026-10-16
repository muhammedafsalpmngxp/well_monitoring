/**
 * Per-role landing pages (admin-configurable).
 *
 * An admin picks, on the Roles page, which page/dashboard each role lands on
 * after login. The choice is persisted in localStorage keyed by role name and
 * applied by the login flow. Front-end/demo only — no backend.
 */

export interface LandingOption {
  id: string;
  label: string;
  route: string;      // route to navigate to
  dvsId?: number;     // for dashboards that open as a dvs board on /cmdoverview
}

/** Pages and dashboards an admin can set as a role's landing page. */
export const LANDING_OPTIONS: LandingOption[] = [
  { id: 'standardboards',  label: 'Standard Boards (default)',   route: 'standardboards' },
  { id: 'cmdoverview',     label: 'Operations Dashboard',        route: 'cmdoverview' },
  { id: 'welldashboard',   label: 'Well Dashboard',              route: 'welldashboard' },
  { id: 'odcsouth',        label: 'ODC South Well Delivery',     route: 'odcsouthwelldelivery' },
  { id: 'daily',           label: 'Daily Operations Briefing',   route: 'cmdoverview', dvsId: 1 },
  { id: 'crew',            label: 'Crew Performance',            route: 'cmdoverview', dvsId: 2 },
  { id: 'opdash',          label: 'Operation Dashboard',         route: 'cmdoverview', dvsId: 3 },
  { id: 'allwells',        label: 'All Wells',                   route: 'allwells' },
  { id: 'standardreports', label: 'Standard Reports',            route: 'standardreports' },
  { id: 'standardcharts',  label: 'Standard Charts',             route: 'standardcharts' },
  { id: 'scorecards',      label: 'Scorecards',                  route: 'scorecards' },
  { id: 'execsummary',     label: 'Executive Summary',           route: 'execsummary' }
];

const KEY = 'smartops.roleLanding';

/** role name → landing option id. */
export function getRoleLandingMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch { return {}; }
}

export function setRoleLanding(roleName: string, landingId: string): void {
  const m = getRoleLandingMap();
  if (landingId) m[roleName] = landingId; else delete m[roleName];
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* noop */ }
}

export function landingOptionById(id: string): LandingOption | undefined {
  return LANDING_OPTIONS.find(o => o.id === id);
}

/** Resolve the landing option configured for a role name (or undefined). */
export function landingForRole(roleName: string): LandingOption | undefined {
  const id = getRoleLandingMap()[roleName];
  return id ? landingOptionById(id) : undefined;
}
