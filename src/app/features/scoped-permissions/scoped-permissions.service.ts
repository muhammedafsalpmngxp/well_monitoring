import { Injectable } from '@angular/core';
import {
  PermModule, PermSet, PermType, RoleDef, ScopeNode, DemoUser, Resolved, Contributor
} from './scoped-permissions.model';

/** Compact PermSet builder: p(view, modify, execute). */
function p(v: boolean, m: boolean, e: boolean): PermSet {
  return { view: v, modify: m, execute: e };
}

/**
 * Scoped-permission resolution + seed data (Option A).
 *
 * Roles are scope-agnostic templates; the scope lives on each user's
 * RoleAssignment. `resolve()` unions every grant whose scope *covers* the
 * active node (ancestor-or-equal prefix match), so a cluster-level grant
 * flows down to its sites and plants/wells.
 *
 * Front-end demo only — no backend. In production the assignments and the
 * resolution would be enforced server-side; this mirrors the logic client-side.
 */
@Injectable({ providedIn: 'root' })
export class ScopedPermissionsService {

  /** Permission subjects (kept small for the demo). */
  readonly modules: PermModule[] = [
    { id: 'dashboard',    name: 'Dashboards' },
    { id: 'well-ops',     name: 'Well Operations' },
    { id: 'crew',         name: 'Crew & Activities' },
    { id: 'reports',      name: 'Reports' },
    { id: 'data-quality', name: 'Data Quality' },
    { id: 'admin',        name: 'Administration' }
  ];

  /** Reusable role templates — no scope baked in. */
  readonly roles: RoleDef[] = [
    {
      id: 'site-engineer', name: 'Site Engineer', color: '#2563eb',
      description: 'Execute and update site activities',
      permissions: {
        'dashboard':    p(true,  true,  false),
        'well-ops':     p(true,  true,  true),
        'crew':         p(true,  true,  false),
        'reports':      p(true,  false, false),
        'data-quality': p(false, false, false),
        'admin':        p(false, false, false)
      }
    },
    {
      id: 'planner', name: 'Planner', color: '#7c3aed',
      description: 'Plan and schedule activities',
      permissions: {
        'dashboard':    p(true,  true,  false),
        'well-ops':     p(true,  false, false),
        'crew':         p(true,  true,  true),
        'reports':      p(true,  true,  false),
        'data-quality': p(true,  false, false),
        'admin':        p(false, false, false)
      }
    },
    {
      id: 'viewer', name: 'Viewer', color: '#6b7280',
      description: 'Read-only access',
      permissions: {
        'dashboard':    p(true, false, false),
        'well-ops':     p(true, false, false),
        'crew':         p(true, false, false),
        'reports':      p(true, false, false),
        'data-quality': p(true, false, false),
        'admin':        p(false, false, false)
      }
    },
    {
      id: 'admin', name: 'Admin', color: '#b45309',
      description: 'Full administrative access',
      permissions: {
        'dashboard':    p(true, true, true),
        'well-ops':     p(true, true, true),
        'crew':         p(true, true, true),
        'reports':      p(true, true, true),
        'data-quality': p(true, true, true),
        'admin':        p(true, true, true)
      }
    }
  ];

  /** Scope hierarchy: Cluster → Site → Plant/Well (leaf). */
  readonly hierarchy: ScopeNode = {
    key: '*', label: 'All Clusters', level: 'ALL',
    children: [
      { key: 'NIMR', label: 'NIMR', level: 'cluster', children: [
        { key: 'NIMR/Coastal', label: 'Coastal', level: 'site', children: [
          { key: 'NIMR/Coastal/PL-3009', label: 'Plant 3009 — Thumrait', level: 'plant' },
          { key: 'NIMR/Coastal/W-34565', label: 'Well 34565', level: 'plant' }
        ]},
        { key: 'NIMR/Central', label: 'Central', level: 'site', children: [
          { key: 'NIMR/Central/PL-3020', label: 'Plant 3020 — Seeb', level: 'plant' },
          { key: 'NIMR/Central/W-34561', label: 'Well 34561', level: 'plant' }
        ]}
      ]},
      { key: 'AMIN', label: 'AMIN', level: 'cluster', children: [
        { key: 'AMIN/North', label: 'Amin North', level: 'site', children: [
          { key: 'AMIN/North/PL-3270', label: 'Plant 3270 — RDS', level: 'plant' },
          { key: 'AMIN/North/W-31780', label: 'Well 31780', level: 'plant' }
        ]},
        { key: 'AMIN/South', label: 'Amin South', level: 'site', children: [
          { key: 'AMIN/South/W-36078', label: 'Well 36078', level: 'plant' }
        ]}
      ]},
      { key: 'RAKID', label: 'RAKID', level: 'cluster', children: [
        { key: 'RAKID/Main', label: 'Rakid Main', level: 'site', children: [
          { key: 'RAKID/Main/W-34422', label: 'Well 34422', level: 'plant' },
          { key: 'RAKID/Main/W-37797', label: 'Well 37797', level: 'plant' }
        ]}
      ]}
    ]
  };

  /**
   * Demo users. Note the scoped variation:
   *  • Ravi & Sara hold the SAME role (Site Engineer) but at different scopes →
   *    different reach.
   *  • Priya holds TWO roles at different scopes → different capabilities per plant.
   *  • Omar is Admin org-wide; Leena is a global Viewer (for contrast).
   */
  readonly users: DemoUser[] = [
    { id: 1, name: 'Ravi Kumar', email: 'ravi.k@company.com', assignments: [
      { roleId: 'site-engineer', scopeKeys: ['NIMR/Coastal'] }
    ]},
    { id: 2, name: 'Sara Abdullah', email: 'sara.a@company.com', assignments: [
      { roleId: 'site-engineer', scopeKeys: ['AMIN'] }
    ]},
    { id: 3, name: 'Priya Ramesh', email: 'priya.r@company.com', assignments: [
      { roleId: 'site-engineer', scopeKeys: ['NIMR'] },
      { roleId: 'planner',       scopeKeys: ['RAKID/Main'] }
    ]},
    { id: 4, name: 'Omar Saleh', email: 'omar.s@company.com', assignments: [
      { roleId: 'admin', scopeKeys: ['*'] }
    ]},
    { id: 5, name: 'Leena Sharma', email: 'leena.s@company.com', assignments: [
      { roleId: 'viewer', scopeKeys: ['*'] }
    ]}
  ];

  /** key → { label, level } for fast label / level lookup (incl. '*'). */
  private readonly index: Record<string, { label: string; level: string }> = (() => {
    const out: Record<string, { label: string; level: string }> = {};
    const walk = (n: ScopeNode) => {
      out[n.key] = { label: n.label, level: n.level };
      (n.children || []).forEach(walk);
    };
    walk(this.hierarchy);
    return out;
  })();

  getRole(id: string): RoleDef | undefined { return this.roles.find(r => r.id === id); }
  getUser(id: number): DemoUser | undefined { return this.users.find(u => u.id === id); }
  scopeLabel(key: string): string { return this.index[key]?.label ?? key; }

  /** Full breadcrumb for a scope key, e.g. "NIMR › Coastal › Well 34565". */
  scopePath(key: string): string {
    if (key === '*') return this.index['*']?.label ?? 'All Clusters';
    const parts = key.split('/');
    const labels: string[] = [];
    let acc = '';
    for (const part of parts) {
      acc = acc ? acc + '/' + part : part;
      labels.push(this.index[acc]?.label ?? part);
    }
    return labels.join(' › ');
  }

  /**
   * Does a grant at `grantKey` cover the `activeKey` node?
   * True when the grant is org-wide, equal to, or an ancestor of the active node.
   */
  covers(grantKey: string, activeKey: string): boolean {
    if (grantKey === '*') return true;
    if (grantKey === activeKey) return true;
    return activeKey.startsWith(grantKey + '/');
  }

  /**
   * Resolve a user's effective permissions at an active scope by unioning every
   * assignment whose scope covers that node (most-permissive-wins).
   */
  resolve(userId: number, activeKey: string): Resolved {
    const user = this.getUser(userId);
    const perms: Record<string, PermSet> = {};
    this.modules.forEach(m => { perms[m.id] = { view: false, modify: false, execute: false }; });
    const contributors: Contributor[] = [];

    if (!user) return { perms, contributors, hasAny: false };

    for (const a of user.assignments) {
      const role = this.getRole(a.roleId);
      if (!role) continue;
      for (const scopeKey of a.scopeKeys) {
        if (!this.covers(scopeKey, activeKey)) continue;
        contributors.push({
          roleId: role.id, roleName: role.name, roleColor: role.color,
          scopeKey, scopeLabel: this.scopeLabel(scopeKey)
        });
        // Union this role's grants into the effective set.
        for (const m of this.modules) {
          const rp = role.permissions[m.id];
          if (!rp) continue;
          perms[m.id].view    = perms[m.id].view    || rp.view;
          perms[m.id].modify  = perms[m.id].modify  || rp.modify;
          perms[m.id].execute = perms[m.id].execute || rp.execute;
        }
      }
    }
    return { perms, contributors, hasAny: contributors.length > 0 };
  }

  /** Convenience single-permission check. */
  can(userId: number, moduleId: string, type: PermType, activeKey: string): boolean {
    return !!this.resolve(userId, activeKey).perms[moduleId]?.[type];
  }
}
