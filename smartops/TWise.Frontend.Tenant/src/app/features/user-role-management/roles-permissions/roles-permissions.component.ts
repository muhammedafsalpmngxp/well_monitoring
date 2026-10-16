import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { UserManagementService, RoleDto } from '../../../core/services/user-management.service';
import { AuthService } from '../../../core/services/auth.service';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

export type RoleIcon = 'admin' | 'cluster_admin' | 'site_admin' | 'planner' | 'site_engineer' | 'site_mgt' | 'qa_qc' | 'hse';
export type RoleAccent = 'blue' | 'purple' | 'orange' | 'teal' | 'green' | 'red';

export interface Role {
  id: string;
  name: string;
  description: string;
  icon: RoleIcon;
  accent: RoleAccent;
  roleCode: string;
  scope: string | null;
}

export interface PermissionNode {
  id: string;
  label: string;
  moduleIcon?: string;
  children?: PermissionNode[];
}

export interface PermissionFlags {
  view: boolean;
  create: boolean;
  modify: boolean;
  adminControl: boolean;
}

interface RolePermissionDto {
  moduleCode: string;
  canView: boolean;
  canCreate: boolean;
  canModify: boolean;
  canAdmin: boolean;
}

interface ModuleTreeDto {
  moduleCode: string;
  parentCode: string | null;
  displayName: string | null;
  featureCode: string | null;
  sortOrder: number;
  children: ModuleTreeDto[];
}

const ROLE_ICON_MAP: Record<string, RoleIcon> = {
  platform_admin: 'admin', tenant_admin: 'cluster_admin', admin: 'admin',
  operator: 'site_engineer', viewer: 'planner', User: 'site_mgt',
};
const ROLE_ACCENT_MAP: Record<string, RoleAccent> = {
  platform_admin: 'purple', tenant_admin: 'blue', admin: 'purple',
  operator: 'orange', viewer: 'teal', User: 'green',
};

@Component({
  selector: 'app-roles-permissions',
  standalone: false,
  templateUrl: './roles-permissions.component.html',
  styleUrls: ['./roles-permissions.component.scss'],
})
export class RolesPermissionsComponent implements OnInit {
  private readonly baseUrl = environment.controlPlaneApiUrl;

  allRoles: Role[] = [];
  permissionTree: PermissionNode[] = [];

  roleSearchTerm = '';
  selectedRoleId = '';
  expandedNodeIds = new Set<string>();
  permissionState: Record<string, PermissionFlags> = {};
  landingPageByRole: Record<string, string> = {};
  isSaving = false;

  isLoading = true;
  private rolesLoaded = false;
  private moduleTreeLoaded = false;

  constructor(
    private readonly userManagementService: UserManagementService,
    private readonly authService: AuthService,
    private readonly http: HttpClient,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.loadRoles();
    this.loadModuleTree();
  }

  private checkInitialLoadComplete(): void {
    if (this.rolesLoaded && this.moduleTreeLoaded) {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  private loadRoles(): void {
    this.userManagementService.listRoles().subscribe({
      next: (result) => {
        this.allRoles = result.items.filter(r => r.isActive).map(r => ({
          id: r.roleId.toString(),
          name: r.roleName ?? r.roleCode,
          description: r.description ?? '',
          icon: ROLE_ICON_MAP[r.roleCode] ?? 'planner',
          accent: ROLE_ACCENT_MAP[r.roleCode] ?? 'blue',
          roleCode: r.roleCode,
          scope: r.scope,
        }));
        if (this.allRoles.length && !this.selectedRoleId) {
          this.selectedRoleId = this.allRoles[0].id;
          this.loadRolePermissions(this.selectedRoleId);
        }
        this.rolesLoaded = true;
        this.checkInitialLoadComplete();
        this.cdr.detectChanges();
      },
      error: () => {
        this.rolesLoaded = true;
        this.checkInitialLoadComplete();
      },
    });
  }

  private loadModuleTree(): void {
    this.http.get<ModuleTreeDto[]>(`${this.baseUrl}/feature-modules`).subscribe({
      next: (tree) => {
        this.permissionTree = tree.map(m => this.mapModuleToNode(m));
        this.moduleTreeLoaded = true;
        this.checkInitialLoadComplete();
        this.cdr.detectChanges();
      },
      error: () => {
        this.moduleTreeLoaded = true;
        this.checkInitialLoadComplete();
      },
    });
  }

  private mapModuleToNode(m: ModuleTreeDto): PermissionNode {
    return {
      id: m.moduleCode,
      label: m.displayName ?? m.moduleCode,
      moduleIcon: this.resolveIcon(m.moduleCode),
      children: m.children?.map(c => this.mapModuleToNode(c)),
    };
  }

  private resolveIcon(code: string): string | undefined {
    const map: Record<string, string> = {
      dashboard: 'dashboard', charts: 'bar_chart', report: 'description',
      'smart-alerts': 'notifications', 'field-operations': 'field_operations',
      'production-intelligence': 'production_intelligence', 'data-quality': 'shield',
    };
    return map[code];
  }

  private loadRolePermissions(roleId: string): void {
    this.http.get<RolePermissionDto[]>(`${this.baseUrl}/roles/${roleId}/permissions`).subscribe(perms => {
      for (const p of perms) {
        const key = `${roleId}::${p.moduleCode}`;
        this.permissionState[key] = {
          view: p.canView,
          create: p.canCreate,
          modify: p.canModify,
          adminControl: p.canAdmin,
        };
      }
      this.cdr.detectChanges();
    });
  }

  get roles(): Role[] {
    const term = this.roleSearchTerm.trim().toLowerCase();
    if (!term) return this.allRoles;
    return this.allRoles.filter(r => r.name.toLowerCase().includes(term));
  }

  get selectedRole(): Role {
    return this.allRoles.find(r => r.id === this.selectedRoleId) ?? { id: '', name: '', description: '', icon: 'admin', accent: 'blue', roleCode: '', scope: null };
  }

  get landingPageOptions(): string[] {
    const leaves: string[] = [];
    const collect = (nodes: PermissionNode[]): void => {
      for (const n of nodes) {
        if (n.children?.length) collect(n.children);
        else if (!n.id.endsWith('.categories') && !['dashboard.comments', 'dashboard.versions'].includes(n.id)) leaves.push(n.label);
      }
    };
    collect(this.permissionTree);
    return leaves;
  }

  get selectedLandingPage(): string {
    return this.landingPageByRole[this.selectedRoleId] ?? this.landingPageOptions[0];
  }

  set selectedLandingPage(value: string) {
    this.landingPageByRole[this.selectedRoleId] = value;
  }

  selectRole(id: string): void {
    if (id === this.selectedRoleId) return;
    // Unsaved edits are not dropped silently: ask first, then switch.
    if (this.isEditingPermissions && this.pendingPermissionChanges > 0) {
      this.pendingRoleSwitch = id;
      return;
    }
    this.cancelPermissionEdit();
    this.selectedRoleId = id;
    this.loadRolePermissions(id);
  }

  // ── Edit mode: permissions are read-only until "Edit Permissions"; saving asks for confirmation ──
  isEditingPermissions = false;
  showSavePermissionsConfirm = false;
  permissionSaveError: string | null = null;
  /** Role the user clicked while having unsaved edits (asks to discard). */
  pendingRoleSwitch: string | null = null;
  /** The selected role's permissions as they were when editing started. */
  private permissionSnapshot: Record<string, PermissionFlags> = {};

  startPermissionEdit(): void {
    const prefix = `${this.selectedRoleId}::`;
    this.permissionSnapshot = Object.fromEntries(Object.entries(this.permissionState)
      .filter(([key]) => key.startsWith(prefix)).map(([key, flags]) => [key, { ...flags }]));
    this.permissionSaveError = null;
    this.isEditingPermissions = true;
  }

  /** Modules of the selected role whose View/Create/Modify/Admin differ from when editing started. */
  get pendingPermissionChanges(): number {
    if (!this.isEditingPermissions) return 0;
    const prefix = `${this.selectedRoleId}::`;
    const keys = new Set([...Object.keys(this.permissionSnapshot), ...Object.keys(this.permissionState).filter(k => k.startsWith(prefix))]);
    const none: PermissionFlags = { view: false, create: false, modify: false, adminControl: false };
    let changed = 0;
    for (const key of keys) {
      const before = this.permissionSnapshot[key] ?? none;
      const after = this.permissionState[key] ?? none;
      if (before.view !== after.view || before.create !== after.create || before.modify !== after.modify || before.adminControl !== after.adminControl) changed++;
    }
    return changed;
  }

  /** Puts back the permissions from when editing started and leaves edit mode. */
  cancelPermissionEdit(): void {
    if (this.isEditingPermissions) {
      const prefix = `${this.selectedRoleId}::`;
      for (const key of Object.keys(this.permissionState)) if (key.startsWith(prefix)) delete this.permissionState[key];
      for (const [key, flags] of Object.entries(this.permissionSnapshot)) this.permissionState[key] = { ...flags };
    }
    this.isEditingPermissions = false;
    this.showSavePermissionsConfirm = false;
    this.permissionSaveError = null;
  }

  requestSavePermissions(): void {
    if (this.pendingPermissionChanges === 0) { this.cancelPermissionEdit(); return; }
    this.permissionSaveError = null;
    this.showSavePermissionsConfirm = true;
  }

  confirmSavePermissions(): void {
    this.savePermissions();
  }

  confirmDiscardAndSwitch(): void {
    const id = this.pendingRoleSwitch;
    this.pendingRoleSwitch = null;
    this.cancelPermissionEdit();
    if (id) { this.selectedRoleId = id; this.loadRolePermissions(id); }
  }

  // Falls back to the scope label only for display; never persisted as the real description.
  roleSubtitle(role: Role): string {
    return role.description || (role.scope ? `${role.scope} scope` : '');
  }

  isExpanded(nodeId: string): boolean {
    return this.expandedNodeIds.has(nodeId);
  }

  toggleNode(nodeId: string): void {
    if (this.expandedNodeIds.has(nodeId)) this.expandedNodeIds.delete(nodeId);
    else this.expandedNodeIds.add(nodeId);
  }

  flagsFor(nodeId: string): PermissionFlags {
    const key = `${this.selectedRoleId}::${nodeId}`;
    return this.permissionState[key] ?? (this.permissionState[key] = { view: false, create: false, modify: false, adminControl: false });
  }

  toggleFlag(nodeId: string, key: keyof PermissionFlags): void {
    // Read-only unless "Edit Permissions" was clicked; nothing is saved until "Save Changes" is confirmed.
    if (!this.isEditingPermissions) return;
    const flags = this.flagsFor(nodeId);
    flags[key] = !flags[key];
    if (nodeId.endsWith('.categories') || nodeId === 'dashboard.comments') {
      if ((key === 'create' || key === 'modify') && flags[key]) flags.view = true;
      if (key === 'view' && !flags.view) {
        flags.create = false;
        flags.modify = false;
        flags.adminControl = false;
      }
    }
    if (key === 'create' && flags.create) {
      flags.modify = true;
    }
  }

  private savePermissions(): void {
    const permissions: { moduleCode: string; canView: boolean; canCreate: boolean; canModify: boolean; canAdmin: boolean }[] = [];
    const prefix = `${this.selectedRoleId}::`;
    for (const [key, flags] of Object.entries(this.permissionState)) {
      if (!key.startsWith(prefix)) continue;
      const moduleCode = key.slice(prefix.length);
      if (flags.view || flags.create || flags.modify || flags.adminControl) {
        permissions.push({ moduleCode, canView: flags.view, canCreate: flags.create, canModify: flags.modify, canAdmin: flags.adminControl });
      }
    }
    this.isSaving = true;
    this.http.put(`${this.baseUrl}/roles/${this.selectedRoleId}/permissions`, { permissions }).subscribe({
      next: () => {
        this.isSaving = false;
        this.showSavePermissionsConfirm = false;
        this.isEditingPermissions = false;
        this.cdr.detectChanges();
      },
      error: () => {
        // Stay in edit mode with the user's changes so they can retry.
        this.isSaving = false;
        this.permissionSaveError = 'The permissions could not be saved. Please try again.';
        this.cdr.detectChanges();
      },
    });
  }

  showAddRoleModal = false;
  newRoleName = '';
  newRoleDescription = '';
  isEditMode = false;
  showUpdateConfirm = false;
  showDeleteConfirm = false;
  showDeleteBlockedInfo = false;
  deleteErrorMessage = '';
  private editingRole: Role | null = null;
  roleToDelete: Role | null = null;

  openAddRoleModal(): void {
    this.isEditMode = false;
    this.editingRole = null;
    this.newRoleName = '';
    this.newRoleDescription = '';
    this.showAddRoleModal = true;
  }

  openEditRoleModal(role: Role, event?: Event): void {
    event?.stopPropagation();
    this.isEditMode = true;
    this.editingRole = role;
    this.newRoleName = role.name;
    this.newRoleDescription = role.description ?? '';
    this.showAddRoleModal = true;
  }

  closeAddRoleModal(): void {
    this.showAddRoleModal = false;
    this.isEditMode = false;
    this.editingRole = null;
  }

  get isRoleFormValid(): boolean {
    return !!this.newRoleName.trim() && !!this.newRoleDescription.trim();
  }

  onDeleteRoleClick(role: Role, event?: Event): void {
    event?.stopPropagation();
    this.deleteErrorMessage = '';

    const tenantId = this.authService.getCurrentUser()?.tenantId;
    if (!tenantId) {
      this.roleToDelete = role;
      this.showDeleteConfirm = true;
      return;
    }

    // Warn upfront instead of letting the delete call fail silently on the backend guard.
    this.userManagementService.listUsersByTenant(tenantId, 1, 1000).subscribe({
      next: (result) => {
        const hasUsers = result.items.some(user => user.isActive && (
          user.roleIds?.includes(Number(role.id))
          ?? user.roles?.some(assignedRole => assignedRole.roleId === Number(role.id))
          ?? user.roleCode === role.roleCode
        ));
        if (hasUsers) {
          this.deleteErrorMessage = `Users exist under the '${role.name}' role. Reassign them before deleting.`;
          this.showDeleteBlockedInfo = true;
          this.cdr.detectChanges();
          return;
        }
        this.roleToDelete = role;
        this.showDeleteConfirm = true;
        this.cdr.detectChanges();
      },
      error: () => {
        this.roleToDelete = role;
        this.showDeleteConfirm = true;
      },
    });
  }

  cancelDeleteRole(): void {
    this.showDeleteConfirm = false;
    this.roleToDelete = null;
  }

  confirmDeleteRole(): void {
    const role = this.roleToDelete;
    this.showDeleteConfirm = false;
    if (!role) return;

    // Backend performs a soft delete (IsDeleted flag); the row is never hard-removed.
    this.http.delete<void>(`${this.baseUrl}/roles/${role.id}`).subscribe({
      next: () => {
        this.roleToDelete = null;
        if (this.selectedRoleId === role.id) this.selectedRoleId = '';
        this.loadRoles();
      },
      error: () => {
        this.roleToDelete = null;
        this.deleteErrorMessage = `'${role.name}' could not be deleted. It may still be assigned to users.`;
        this.showDeleteBlockedInfo = true;
        this.cdr.detectChanges();
      },
    });
  }

  submitRole(): void {
    if (!this.isRoleFormValid) return;
    if (this.isEditMode) {
      this.showUpdateConfirm = true;
      return;
    }
    this.createRole();
  }

  confirmUpdateRole(): void {
    if (!this.editingRole) {
      this.showUpdateConfirm = false;
      return;
    }
    this.http.put<void>(`${this.baseUrl}/roles/${this.editingRole.id}`, {
      roleCode: this.editingRole.roleCode,
      roleName: this.newRoleName.trim(),
      description: this.newRoleDescription.trim(),
      scope: this.editingRole.scope,
      isActive: true,
    }).subscribe(() => {
      this.loadRoles();
      this.showUpdateConfirm = false;
      this.closeAddRoleModal();
    });
  }

  createRole(): void {
    if (!this.newRoleName.trim() || !this.newRoleDescription.trim()) return;
    const code = this.newRoleName.trim().toLowerCase().replace(/\s+/g, '_');
    this.http.post<any>(`${this.baseUrl}/roles`, {
      roleCode: code,
      roleName: this.newRoleName.trim(),
      description: this.newRoleDescription.trim(),
      scope: 'tenant',
      isActive: true,
    }).subscribe(created => {
      this.loadRoles();
      this.closeAddRoleModal();
    });
  }
}
