/**
 * Shared registry for the "Customise widgets" drawer used by the Cluster
 * Overview (cmdoverview) and ODC South Well Delivery dashboards.
 *
 * Each dashboard lists its own KPI cards + charts. Widget ids are unique across
 * dashboards so a single visibility map (persisted under CUST_LS_KEY) covers
 * every board — toggling a widget from either drawer takes effect when that
 * board is loaded.
 */

export interface CustWidget {
  /** Stable id — matches the `data-cw-id` attribute on the widget's root element. */
  id: string;
  title: string;
  group: 'KPI cards' | 'Charts & widgets';
  type: 'KPI' | 'Chart';
}

export interface CustDashboard {
  id: string;
  name: string;
  category: string;
  /** Page id to load (via the global navigate bridge) when Done is clicked. */
  route: string;
  widgets: CustWidget[];
}

/** localStorage key holding the shared per-widget visibility map. */
export const CUST_LS_KEY = 'smartops.customise.widgetVisible';

/** Cluster Overview (Operations Dashboard) widgets — cmdoverview page. */
export const CLUSTER_OVERVIEW_WIDGETS: CustWidget[] = [
  { id: 'w_total',         title: 'Total Wells',                                  group: 'KPI cards',        type: 'KPI'   },
  { id: 'w_completed',     title: 'Completed Wells',                              group: 'KPI cards',        type: 'KPI'   },
  { id: 'w_penalty',       title: 'Penalty Exposure',                             group: 'KPI cards',        type: 'KPI'   },
  { id: 'w_bonus',         title: 'Bonus Potential',                              group: 'KPI cards',        type: 'KPI'   },
  { id: 'w_crews',         title: 'Crews Deployed',                               group: 'KPI cards',        type: 'KPI'   },
  { id: 'w_odc',           title: 'ODC Overall Status',                           group: 'Charts & widgets', type: 'Chart' },
  { id: 'w_wro',           title: 'Wells Readiness Overall Status',               group: 'Charts & widgets', type: 'Chart' },
  { id: 'w_clusterHealth', title: 'Cluster Health',                               group: 'Charts & widgets', type: 'Chart' },
  { id: 'w_prating',       title: 'Crew P-Rating',                                group: 'Charts & widgets', type: 'Chart' },
  { id: 'w_workload',      title: 'Workload Analysis',                            group: 'Charts & widgets', type: 'Chart' },
  { id: 'w_comm',          title: 'PDO Commissioning Status',                     group: 'Charts & widgets', type: 'Chart' },
  { id: 'w_buffer',        title: 'Buffer Flowlines Ready',                       group: 'Charts & widgets', type: 'Chart' },
  { id: 'w_cwd',           title: 'Construction Well Delivery — Pegging Status',  group: 'Charts & widgets', type: 'Chart' },
  { id: 'w_cfo',           title: 'Flowline & OHL Construction Progress',         group: 'Charts & widgets', type: 'Chart' },
  { id: 'w_cwp',           title: 'Well Delivery Completion Overview',            group: 'Charts & widgets', type: 'Chart' },
  { id: 'w_cwc',           title: 'Well Hookup Progress Overview',                group: 'Charts & widgets', type: 'Chart' },
  { id: 'w_wdct',          title: 'Well Delivery Cycle Time',                     group: 'Charts & widgets', type: 'Chart' },
  { id: 'w_wpa',           title: 'Wells — Planned vs. Actual',                   group: 'Charts & widgets', type: 'Chart' },
];

/** ODC South Well Delivery widgets — odcsouthwelldelivery page. */
export const ODC_SOUTH_WIDGETS: CustWidget[] = [
  { id: 'o_total',     title: 'Total Wells',                          group: 'KPI cards',        type: 'KPI'   },
  { id: 'o_completed', title: 'Completed Wells',                      group: 'KPI cards',        type: 'KPI'   },
  { id: 'o_penalty',   title: 'Penalty Exposure',                     group: 'KPI cards',        type: 'KPI'   },
  { id: 'o_bonus',     title: 'Bonus Potential',                      group: 'KPI cards',        type: 'KPI'   },
  { id: 'o_crews',     title: 'Crews Deployed',                       group: 'KPI cards',        type: 'KPI'   },
  { id: 'o_clusters',  title: 'Cluster Pie Charts',                   group: 'Charts & widgets', type: 'Chart' },
  { id: 'o_metrics',   title: 'Well Delivery Metrics',                group: 'Charts & widgets', type: 'Chart' },
  { id: 'o_buffer',    title: 'Buffer Flowlines Ready',               group: 'Charts & widgets', type: 'Chart' },
  { id: 'o_comm',      title: 'PDO Commissioning Status — ATNM Ready',group: 'Charts & widgets', type: 'Chart' },
  { id: 'o_workload',  title: 'Work Load Analysis',                   group: 'Charts & widgets', type: 'Chart' },
  { id: 'o_due',       title: '% Completed of Due Wells',             group: 'Charts & widgets', type: 'Chart' },
  { id: 'o_drilled',   title: '% Completed of Drilled Wells',         group: 'Charts & widgets', type: 'Chart' },
];

/** Well Dashboard widgets — welldashboard page. */
export const WELL_DASHBOARD_WIDGETS: CustWidget[] = [
  { id: 'wd_total',         title: 'Total Wells',                                  group: 'KPI cards',        type: 'KPI'   },
  { id: 'wd_completed',     title: 'Completed Wells',                              group: 'KPI cards',        type: 'KPI'   },
  { id: 'wd_active',        title: 'Active Wells',                                 group: 'KPI cards',        type: 'KPI'   },
  { id: 'wd_penalty',       title: 'Penalty Exposure',                             group: 'KPI cards',        type: 'KPI'   },
  { id: 'wd_bonus',         title: 'Bonus Potential',                              group: 'KPI cards',        type: 'KPI'   },
  { id: 'wd_crews',         title: 'Crews Deployed',                               group: 'KPI cards',        type: 'KPI'   },
  { id: 'wd_drilled',       title: 'Total Drilled Wells',                          group: 'Charts & widgets', type: 'Chart' },
  { id: 'wd_funnel',        title: 'Well Delivery Funnel',                         group: 'Charts & widgets', type: 'Chart' },
  { id: 'wd_execstatus',    title: 'Execution Status',                             group: 'Charts & widgets', type: 'Chart' },
];

/** Category → Dashboard registry shared by every Customise drawer. */
export const CUST_DASHBOARDS: CustDashboard[] = [
  { id: 'cluster-overview', name: 'Cluster Overview',        category: 'Built-in', route: 'cmdoverview',          widgets: CLUSTER_OVERVIEW_WIDGETS },
  { id: 'odc-south',        name: 'ODC South Well Delivery', category: 'Built-in', route: 'odcsouthwelldelivery', widgets: ODC_SOUTH_WIDGETS },
  { id: 'well-dashboard',   name: 'Well Dashboard',          category: 'Built-in', route: 'welldashboard',        widgets: WELL_DASHBOARD_WIDGETS },
];

/** All widgets across every dashboard — used to seed the visibility map. */
export function allCustWidgets(): CustWidget[] {
  return CUST_DASHBOARDS.reduce<CustWidget[]>((acc, d) => acc.concat(d.widgets), []);
}
