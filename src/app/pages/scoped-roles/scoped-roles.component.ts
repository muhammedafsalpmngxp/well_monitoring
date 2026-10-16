import { Component, ViewEncapsulation } from '@angular/core';
import { ScopedPermissionsService } from '../../features/scoped-permissions/scoped-permissions.service';
import { DemoUser, PermType, Resolved, ScopeNode } from '../../features/scoped-permissions/scoped-permissions.model';

/**
 * Scoped Role Assignment — interactive demo (front-end only, mock data).
 *
 * Pick a user, then click any node in the Cluster → Site → Plant/Well tree to
 * set the "active scope". The effective-permission table on the right updates
 * live, showing how the same role resolves to different access depending on
 * where the user is granted it (and how ancestor grants inherit downward).
 *
 * Reached at /scoped-roles — deliberately not wired into the sidebar so no
 * existing screen is altered.
 */
@Component({
  selector: 'app-scoped-roles',
  templateUrl: './scoped-roles.component.html',
  styleUrls: ['./scoped-roles.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ScopedRolesComponent {

  readonly users = this.svc.users;
  readonly modules = this.svc.modules;
  readonly hierarchy = this.svc.hierarchy;
  readonly permTypes: PermType[] = ['view', 'modify', 'execute'];

  selectedUserId = this.users[0].id;
  activeScopeKey = '*';
  private collapsed: Record<string, boolean> = {};

  constructor(private readonly svc: ScopedPermissionsService) {}

  // ── Selection / interaction ──────────────────────────────────────────────
  selectUser(u: DemoUser): void { this.selectedUserId = u.id; }
  setScope(node: ScopeNode): void { this.activeScopeKey = node.key; }
  isActiveScope(node: ScopeNode): boolean { return this.activeScopeKey === node.key; }

  toggleExpand(node: ScopeNode, ev: Event): void {
    ev.stopPropagation();
    this.collapsed[node.key] = !this.collapsed[node.key];
  }
  isExpanded(node: ScopeNode): boolean { return !this.collapsed[node.key]; }
  hasChildren(node: ScopeNode): boolean { return !!(node.children && node.children.length); }

  // ── Derived view state ───────────────────────────────────────────────────
  get selectedUser(): DemoUser | undefined { return this.svc.getUser(this.selectedUserId); }
  get resolved(): Resolved { return this.svc.resolve(this.selectedUserId, this.activeScopeKey); }
  get activeScopePath(): string { return this.svc.scopePath(this.activeScopeKey); }

  perm(moduleId: string, type: PermType): boolean {
    return !!this.resolved.perms[moduleId]?.[type];
  }

  /** Assignment chips for a user card: "Role @ Scope". */
  assignmentChips(u: DemoUser): { role: string; color: string; scope: string }[] {
    const out: { role: string; color: string; scope: string }[] = [];
    for (const a of u.assignments) {
      const role = this.svc.getRole(a.roleId);
      if (!role) continue;
      for (const key of a.scopeKeys) {
        out.push({ role: role.name, color: role.color, scope: this.svc.scopeLabel(key) });
      }
    }
    return out;
  }

  /** True if this user has ANY grant covering the current active scope. */
  coversActive(u: DemoUser): boolean {
    return u.assignments.some(a => a.scopeKeys.some(k => this.svc.covers(k, this.activeScopeKey)));
  }
}
