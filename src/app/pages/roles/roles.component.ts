import { Component } from '@angular/core';
import { LANDING_OPTIONS, LandingOption, getRoleLandingMap, setRoleLanding } from '../../features/landing/landing';

export interface PermSet { view: boolean; modify: boolean; execute: boolean; }
export type PermType = 'view' | 'modify' | 'execute';

/** A node in the permission tree — modules, functionalities and sub-functionalities. */
export interface PermNode {
  id: string;
  name: string;
  children?: PermNode[];
}

export interface AppRole {
  id: number;
  name: string;
  description: string;
  users: number;
  color: string;
  permissions: Record<string, PermSet>;
}

/**
 * Source tables (and their columns) available to charts / reports. Ticking View
 * on a table or column grants access; leaving it unticked restricts it from the
 * source data a role can use when building or viewing charts / reports.
 */
function sourceTableNodes(prefix: string): PermNode[] {
  const tables: Array<[string, string, string[]]> = [
    ['wmr',  'dbo.WMR',                          ['well_name_after_spud', 'project_id', 'over_all_progress_percentages', 'actual_rig_on_date', 'actual_rig_off_date']],
    ['sds',  'dbo.SAP_DRILLING_SEQUENCE_History', ['pdo_well_id', 'Well_Function', 'Earl_start_date', 'Cluster']],
    ['proj', 'dbo.ProjectIDs',                    ['ID', 'Cluster', 'Site', 'Type', 'Project']]
  ];
  return tables.map(([key, name, cols]) => ({
    id: `${prefix}-${key}`,
    name,
    children: cols.map(c => ({ id: `${prefix}-${key}-${c.toLowerCase()}`, name: c }))
  }));
}

@Component({
  selector: 'app-roles',
  templateUrl: './roles.component.html',
  styleUrls: ['./roles.component.scss']
})
export class RolesComponent {
  /**
   * Module → page/functionality tree, mirroring the current (visible) app
   * features. Each functionality is a single row; the three columns (View /
   * Create-Modify / Admin Control) are the access levels — e.g. View = open /
   * run / download, Create-Modify = create / edit, Admin Control = delete /
   * share / manage. No separate per-action rows (that would duplicate the
   * columns).
   */
  permissionTree: PermNode[] = [
    { id: 'dashboard', name: 'Dashboard', children: [
      { id: 'boards-standard', name: 'Standard Boards' },
      { id: 'boards-my',       name: 'My Boards' },
      { id: 'dashboard-export', name: 'Export / Download Dashboard' },
      { id: 'db-operations', name: 'Operations Dashboard', children: [
        { id: 'dash-odc',            name: 'ODC Overall Status' },
        { id: 'dash-wells-ready',    name: 'Wells Readiness Overall Status' },
        { id: 'dash-cluster-health', name: 'Cluster Operational Health' },
        { id: 'dash-well-hookup',    name: 'Well Hookup Progress Overview' }
      ]}
    ]},
    { id: 'charts', name: 'Charts', children: [
      { id: 'charts-standard', name: 'Standard Charts' },
      { id: 'charts-my',       name: 'My Charts' },
      { id: 'charts-export',   name: 'Export / Download Chart' },
      { id: 'charts-source', name: 'Source Data Access', children: sourceTableNodes('charts-src') }
    ]},
    { id: 'reports', name: 'Reports', children: [
      { id: 'reports-standard',  name: 'Standard Reports' },
      { id: 'reports-my',        name: 'My Reports' },
      { id: 'reports-builder',   name: 'Report Builder' },
      { id: 'reports-schedules', name: 'Report Schedules' },
      { id: 'reports-export',    name: 'Export / Download Report' },
      { id: 'reports-source', name: 'Source Data Access', children: sourceTableNodes('reports-src') }
    ]},
    { id: 'smart-alerts', name: 'Smart Alerts', children: [
      { id: 'alerts', name: 'Smart Alerts' }
    ]},
    { id: 'field-operations', name: 'Field Operations', children: [
      { id: 'fo-material', name: 'Material Availability' },
      { id: 'fo-crewopt',  name: 'Crew Optimization' },
      { id: 'fo-labour',   name: 'Labour Productivity' },
      { id: 'fo-predict',  name: 'Predictive Analysis' }
    ]},
    { id: 'production-intelligence', name: 'Production Intelligence', children: [
      { id: 'pi-incentive',  name: 'Incentive' },
      { id: 'pi-wellcrew',   name: 'Well PI vs Crew PI' },
      { id: 'pi-scorecards', name: 'Scorecards' },
      { id: 'pi-jobcost',    name: 'Job Cost' }
    ]},
    { id: 'data-quality', name: 'Data Quality', children: [
      { id: 'dq-errorlog', name: 'Error Log & Rules' },
      { id: 'dq-selfheal', name: 'Self-Healing AI' },
      { id: 'dq-datadict', name: 'Data Dictionary' }
    ]},
    { id: 'agentic-ai', name: 'Agentic AI', children: [
      { id: 'ai-agents',      name: 'AI Agents' },
      { id: 'ai-activitylog', name: 'Activity Log' }
    ]},
    { id: 'catalogue', name: 'Catalogue', children: [
      { id: 'cat-forms',      name: 'Request Forms' },
      { id: 'cat-portal',     name: 'Request Portal' },
      { id: 'cat-myrequests', name: 'My Requests' }
    ]},
    { id: 'administration', name: 'User & Role Management', children: [
      { id: 'admin-users', name: 'User Management' },
      { id: 'admin-roles', name: 'Role Management' }
    ]}
  ];

  permTypes: Array<{ key: PermType; label: string; color: string }> = [
    { key: 'view',    label: 'View',    color: '#29378d' },
    { key: 'modify',  label: 'Modify',  color: '#16a34a' },
    { key: 'execute', label: 'Execute', color: '#ea580c' }
  ];

  private palette = ['#d97706', '#29378d', '#16a34a', '#7c3aed', '#6b7280', '#0d9488', '#dc2626'];

  roles: AppRole[] = [];
  selectedRoleId = 0;
  /** node id → collapsed? (default expanded) */
  collapsed: Record<string, boolean> = {};

  // ── Add / edit modal ──
  modalOpen = false;
  editing: AppRole | null = null;
  form = { name: '', description: '' };

  constructor() {
    // Per-role policy: top-level module id → [view, modify, execute] applied to every descendant.
    const seed: Array<{ name: string; description: string; users: number; color: string; def: [boolean, boolean, boolean]; rules: Record<string, [boolean, boolean, boolean]> }> = [
      { name: 'Admin', description: 'Full administrative access', users: 3, color: '#b45309', def: [true, true, true],
        rules: {} },
      { name: 'Cluster Admin', description: 'Manage cluster users and data', users: 4, color: '#0d9488', def: [true, true, false],
        rules: { administration: [true, true, false] } },
      { name: 'Site Admin', description: 'Manage site users and data', users: 6, color: '#0891b2', def: [true, true, false],
        rules: { administration: [true, false, false] } },
      { name: 'Planner', description: 'Plan and schedule activities', users: 4, color: '#4f46e5', def: [true, true, false],
        rules: { 'agentic-ai': [true, false, false], administration: [false, false, false] } },
      { name: 'Site Engineer', description: 'Execute and update site activities', users: 8, color: '#2563eb', def: [true, false, false],
        rules: { dashboard: [true, true, false], charts: [true, true, false], 'field-operations': [true, true, true], reports: [true, false, false], administration: [false, false, false] } },
      { name: 'Site MGT', description: 'Site management oversight', users: 5, color: '#7c3aed', def: [true, true, false],
        rules: { administration: [false, false, false] } },
      { name: 'QA QC', description: 'Quality assurance and control', users: 3, color: '#059669', def: [true, false, false],
        rules: { 'data-quality': [true, true, false], administration: [false, false, false] } },
      { name: 'HSE', description: 'Health, safety and environment', users: 2, color: '#dc2626', def: [true, false, false],
        rules: { 'data-quality': [true, false, false], administration: [false, false, false] } }
    ];

    this.roles = seed.map((s, i) => ({
      id: i + 1, name: s.name, description: s.description, users: s.users, color: s.color,
      permissions: this.grantByModule(s.def, s.rules)
    }));
    this.selectedRoleId = this.roles[0].id;

    // Start with every accordion group collapsed.
    this.flatten(this.permissionTree).forEach(n => { if (n.children?.length) this.collapsed[n.id] = true; });

    this.roleLanding = getRoleLandingMap();
  }

  // ── Landing page per role (admin) ──
  landingOptions: LandingOption[] = LANDING_OPTIONS;
  /** role name → landing option id. */
  roleLanding: Record<string, string> = {};

  getLanding(role: AppRole | undefined): string {
    return role ? (this.roleLanding[role.name] || '') : '';
  }
  setLanding(role: AppRole | undefined, id: string): void {
    if (!role) return;
    this.roleLanding = { ...this.roleLanding, [role.name]: id };
    setRoleLanding(role.name, id);
  }

  /**
   * Build a permission map for every descendant node. Each top-level module uses
   * its explicit rule if given, otherwise the role's default triple `def` (so new
   * modules are covered without listing every one per role).
   */
  private grantByModule(def: [boolean, boolean, boolean], rules: Record<string, [boolean, boolean, boolean]>): Record<string, PermSet> {
    const out: Record<string, PermSet> = {};
    const walk = (nodes: PermNode[], g: [boolean, boolean, boolean]) => {
      for (const n of nodes) {
        out[n.id] = { view: g[0], modify: g[1], execute: g[2] };
        if (n.children) walk(n.children, g);
      }
    };
    for (const mod of this.permissionTree) walk(mod.children || [], rules[mod.id] || def);
    return out;
  }

  // ── Selection / accordion ──
  get selectedRole(): AppRole | undefined { return this.roles.find(r => r.id === this.selectedRoleId); }
  selectRole(r: AppRole): void { this.selectedRoleId = r.id; }
  toggleNode(n: PermNode): void { this.collapsed[n.id] = !this.collapsed[n.id]; }
  isOpen(n: PermNode): boolean { return !this.collapsed[n.id]; }

  // ── Permission read/write ──
  getPerm(id: string, type: PermType): boolean {
    const r = this.selectedRole;
    return !!(r && r.permissions[id] && r.permissions[id][type]);
  }
  togglePerm(id: string, type: PermType): void {
    const r = this.selectedRole;
    if (!r) return;
    if (!r.permissions[id]) r.permissions[id] = { view: false, modify: false, execute: false };
    r.permissions[id][type] = !r.permissions[id][type];
  }

  // ── Accordion header counts ──
  private flatten(nodes: PermNode[]): PermNode[] {
    const out: PermNode[] = [];
    const walk = (ns: PermNode[]) => ns.forEach(n => { out.push(n); if (n.children) walk(n.children); });
    walk(nodes);
    return out;
  }
  moduleGranted(mod: PermNode): number {
    const r = this.selectedRole;
    return this.flatten(mod.children || []).filter(n => { const p = r?.permissions[n.id]; return p && (p.view || p.modify || p.execute); }).length;
  }
  moduleTotal(mod: PermNode): number { return this.flatten(mod.children || []).length; }

  // ── CRUD ──
  openAdd(): void { this.editing = null; this.form = { name: '', description: '' }; this.modalOpen = true; }
  openEdit(r: AppRole): void { this.editing = r; this.form = { name: r.name, description: r.description }; this.modalOpen = true; }
  closeModal(): void { this.modalOpen = false; this.editing = null; }

  save(): void {
    if (!this.form.name.trim()) return;
    if (this.editing) {
      this.editing.name = this.form.name;
      this.editing.description = this.form.description;
    } else {
      const id = this.roles.reduce((m, r) => Math.max(m, r.id), 0) + 1;
      const color = this.palette[(id - 1) % this.palette.length];
      this.roles.push({ id, name: this.form.name, description: this.form.description, users: 0, color, permissions: this.grantByModule([false, false, false], {}) });
      this.selectedRoleId = id;
    }
    this.closeModal();
  }

  remove(r: AppRole): void {
    if (!confirm(`Delete role "${r.name}"?`)) return;
    this.roles = this.roles.filter(x => x.id !== r.id);
    if (this.selectedRoleId === r.id && this.roles.length) this.selectedRoleId = this.roles[0].id;
  }
}
