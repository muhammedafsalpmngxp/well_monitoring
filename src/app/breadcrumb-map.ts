/** Static Home / Group / Page breadcrumb text for every routed page, keyed by
 *  the URL's first path segment (matches AppComponent.currentPageId). Grouped
 *  to mirror the sidebar's section names so the trail reads naturally even
 *  for pages whose sidebar entry is currently hidden. */
export interface BreadcrumbEntry {
  group: string;
  title: string;
}

export const BREADCRUMB_MAP: Record<string, BreadcrumbEntry> = {
  // Executive
  execsummary:   { group: 'Executive', title: 'Executive Summary' },
  mdbriefing:    { group: 'Executive', title: 'MD Briefing' },

  // Dashboard
  cmdoverview:     { group: 'Dashboard', title: 'Operations Dashboard' },
  welldashboard:   { group: 'Dashboard', title: 'Well Dashboard' },
  standardboards:  { group: 'Dashboard', title: 'Standard Boards' },
  myboards:        { group: 'Dashboard', title: 'My Boards' },
  dashboards:      { group: 'Dashboard', title: 'Dashboards' },
  'dashboard-edit': { group: 'Dashboard', title: 'Edit Dashboard' },

  // Charts
  standardcharts:   { group: 'Charts', title: 'Standard Charts' },
  mycharts:         { group: 'Charts', title: 'My Charts' },
  'chart-drilldown': { group: 'Charts', title: 'Chart Details' },
  charts:           { group: 'Charts', title: 'Charts' },

  // Reports
  reports:            { group: 'Reports', title: 'Reports' },
  standardreports:    { group: 'Reports', title: 'Standard Reports' },
  myreports:          { group: 'Reports', title: 'All Reports' },
  'report-builder':   { group: 'Reports', title: 'Report Builder' },
  'report-schedules': { group: 'Reports', title: 'Report Schedules' },

  // Well Operations
  allwells:                  { group: 'Well Operations', title: 'All Wells' },
  odcwells:                  { group: 'Well Operations', title: 'ODC Wells' },
  drilledwells:              { group: 'Well Operations', title: 'Drilled Wells' },
  duewells:                  { group: 'Well Operations', title: 'Due Wells' },
  wellsreadiness:            { group: 'Well Operations', title: 'Wells Readiness' },
  'wells-readiness-details': { group: 'Well Operations', title: 'Wells Readiness Details' },
  'cprog-details':           { group: 'Well Operations', title: 'Construction Progress Details' },
  'hookup-drilldown':        { group: 'Well Operations', title: 'Hookup Details' },
  wellexecution:             { group: 'Well Operations', title: 'Well Execution' },
  critdates:                 { group: 'Well Operations', title: 'Critical Dates' },
  wellcalendar:              { group: 'Well Operations', title: 'Well Calendar' },
  odcsouthwelldelivery:      { group: 'Well Operations', title: 'ODC South Well Delivery' },
  welldeliverystatus:        { group: 'Well Operations', title: 'Well Delivery Status' },

  // Smart Alerts
  smartalerts:   { group: 'Smart Alerts', title: 'Smart Alerts' },
  watchlist:     { group: 'Smart Alerts', title: 'Watchlist' },
  delayforecast: { group: 'Smart Alerts', title: 'Delay Forecast' },

  // Field Operations
  activities:   { group: 'Field Operations', title: 'Activities' },
  commission:   { group: 'Field Operations', title: 'Commissioning' },
  projoverview: { group: 'Field Operations', title: 'Project Overview' },
  allprojects:  { group: 'Field Operations', title: 'All Projects' },
  material:     { group: 'Field Operations', title: 'Material Availability' },
  crewopt:      { group: 'Field Operations', title: 'Crew Optimization' },

  // Crew & Activities
  crewmaster:          { group: 'Crew & Activities', title: 'Crew Master' },
  crewlist:            { group: 'Crew & Activities', title: 'Crew List' },
  crewassign:          { group: 'Crew & Activities', title: 'Crew Assignment' },
  crewcalendar:        { group: 'Crew & Activities', title: 'Crew Calendar' },
  crewgantt:           { group: 'Crew & Activities', title: 'Crew Gantt' },
  'crewgantt-updated': { group: 'Crew & Activities', title: 'Crew Gantt (Updated)' },
  crewpi:              { group: 'Crew & Activities', title: 'Well PI vs Crew PI' },
  perfanalysis:        { group: 'Crew & Activities', title: 'Predictive Analysis' },
  actmaster:           { group: 'Crew & Activities', title: 'Activity Master' },
  labour:              { group: 'Crew & Activities', title: 'Labour Productivity' },

  // Production Intel
  prating:   { group: 'Production Intel', title: 'P Rating' },
  incentive: { group: 'Production Intel', title: 'Incentive' },
  pianomaly: { group: 'Production Intel', title: 'PI Anomaly Detection' },
  penalty:   { group: 'Production Intel', title: 'Penalty' },

  // Data Quality
  errorlog: { group: 'Data Quality', title: 'Error Log' },
  selfheal: { group: 'Data Quality', title: 'Self Healing' },
  datadict: { group: 'Data Quality', title: 'Data Dictionary' },
  pirevamp: { group: 'Data Quality', title: 'PI Revamp' },
  scorecards: { group: 'Data Quality', title: 'Scorecards' },
  jobcost:  { group: 'Data Quality', title: 'Job Cost' },

  // AI Intelligence
  aiopt:      { group: 'AI Intelligence', title: 'AI Optimization' },
  predict:    { group: 'AI Intelligence', title: 'Predictive Model' },
  forecastai: { group: 'AI Intelligence', title: 'Forecast AI' },

  // Analytics & Reports
  criticalpath: { group: 'Analytics & Reports', title: 'Critical Path' },
  rootcause:    { group: 'Analytics & Reports', title: 'Root Cause Analysis' },
  progopt:      { group: 'Analytics & Reports', title: 'Program Optimization' },
  variance:     { group: 'Analytics & Reports', title: 'Variance Analysis' },
  resalloc:     { group: 'Analytics & Reports', title: 'Resource Allocation' },
  anomaly:      { group: 'Analytics & Reports', title: 'Anomaly Detection' },
  predictive:   { group: 'Analytics & Reports', title: 'Predictive Analytics' },
  autopm:       { group: 'Analytics & Reports', title: 'Auto Preventive Maintenance' },

  // Process Automation
  flowdesigner: { group: 'Process Automation', title: 'Flow Designer' },
  flowedit:     { group: 'Process Automation', title: 'Flow Editor' },
  connections:  { group: 'Process Automation', title: 'Connections' },

  // Agentic AI
  aiagents:     { group: 'Agentic AI', title: 'AI Agents' },
  'aiagent-edit': { group: 'Agentic AI', title: 'Edit AI Agent' },
  agentruns:    { group: 'Agentic AI', title: 'Activity Log' },

  // Catalogue
  forms:          { group: 'Catalogue', title: 'Request Forms' },
  'form-details': { group: 'Catalogue', title: 'Form Details' },
  cataloguenew:   { group: 'Catalogue', title: 'New Catalogue Item' },
  requestportal:  { group: 'Catalogue', title: 'Request Portal' },
  myrequests:     { group: 'Catalogue', title: 'My Requests' },

  // Settings
  settings: { group: 'Settings', title: 'Settings' },

  // User & Role Management
  users: { group: 'User & Role Management', title: 'Users' },
  roles: { group: 'User & Role Management', title: 'Roles' },
};
