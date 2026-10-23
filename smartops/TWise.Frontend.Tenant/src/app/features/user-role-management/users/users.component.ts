import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ClientSideRowModelModule, ColDef, GetRowIdParams, ModuleRegistry, RowSelectionModule, RowSelectionOptions, SelectionColumnDef, themeQuartz } from 'ag-grid-community';
import { EmployeeCellRendererComponent } from './cell-renderers/employee-cell-renderer.component';
import { RoleCellRendererComponent } from './cell-renderers/role-cell-renderer.component';
import { StatusCellRendererComponent } from './cell-renderers/status-cell-renderer.component';
import { ActionsCellRendererComponent } from './cell-renderers/actions-cell-renderer.component';
import { AuthService } from '../../../core/services/auth.service';
import { UserManagementService, TenantUserDto, PagedResult, RoleDto, EmployeePlantAccess } from '../../../core/services/user-management.service';
import { ToastService } from '../../../core/services/toast.service';
import { NotificationHelper } from '../../../core/helpers/notification.helper';

ModuleRegistry.registerModules([ClientSideRowModelModule, RowSelectionModule]);

export type StatAccent = 'blue' | 'green' | 'orange' | 'purple';
export type AvatarAccent = 'blue' | 'green' | 'orange' | 'purple' | 'teal' | 'pink' | 'violet';
export type UserStatus = 'active' | 'inactive';
export type RoleAccent = 'blue' | 'teal' | 'green' | 'purple';

export interface UserStat {
  label: string;
  value: number;
  icon: 'total' | 'active' | 'inactive' | 'admin';
  accent: StatAccent;
}

export interface UserRow {
  id: string;
  name: string;
  initials: string;
  avatarAccent: AvatarAccent;
  employeeId: string;
  email: string;
  role: string;
  roleIds?: number[];
  roles?: { name: string; accent: RoleAccent }[];
  roleAccent: RoleAccent;
  plantAccess: string[];
  status: UserStatus;
  loginTime: string;
}

const gridTheme = themeQuartz.withParams({
  accentColor: '#21409A',
  backgroundColor: '#ffffff',
  borderColor: '#dfe6e9',
  borderRadius: 8,
  fontFamily: 'Inter, sans-serif',
  headerBackgroundColor: '#ffffff',
  headerTextColor: '#344054',
  headerFontWeight: 600,
  rowHoverColor: '#F5F8FF',
  selectedRowBackgroundColor: '#F5F8FF',
  wrapperBorder: false,
  wrapperBorderRadius: 0,
});

const rowSelection: RowSelectionOptions<UserRow> = {
  mode: 'multiRow',
  checkboxes: true,
  headerCheckbox: true,
  enableClickSelection: false,
};

@Component({
  selector: 'app-users',
  standalone: false,
  templateUrl: './users.component.html',
  styleUrls: ['./users.component.scss'],
})
export class UsersComponent implements OnInit, OnDestroy {
  private readonly notify: NotificationHelper;
  get successMessage(): string { return this.notify.successMessage; }

  constructor(
    private readonly authService: AuthService,
    private readonly userManagementService: UserManagementService,
    private readonly toastService: ToastService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.notify = new NotificationHelper(cdr);
  }

  ngOnDestroy(): void {
    this.notify.destroy();
  }

  readonly stats: UserStat[] = [
    { label: 'Total Users', value: 0, icon: 'total', accent: 'blue' },
    { label: 'Active on Page', value: 0, icon: 'active', accent: 'green' },
    { label: 'Inactive on Page', value: 0, icon: 'inactive', accent: 'orange' },
  ];

  showGlobalFilter = true;

  countrySearch = 'UAE';
  roleOptions: RoleDto[] = [];
  plantOptions: EmployeePlantAccess[] = [];
  roleFilter = '';
  statusFilter: 'all' | UserStatus = 'all';

  get activeFilters(): { key: string; label: string; value: string }[] {
    const filters: { key: string; label: string; value: string }[] = [];
    if (this.countrySearch) filters.push({ key: 'country', label: 'Country', value: this.countrySearch });
    if (this.roleFilter) filters.push({ key: 'role', label: 'Role', value: this.roleFilter });
    if (this.statusFilter !== 'all') filters.push({ key: 'status', label: 'Status', value: this.statusFilter === 'active' ? 'Active' : 'Inactive' });
    return filters;
  }

  toggleGlobalFilter(): void {
    this.showGlobalFilter = !this.showGlobalFilter;
  }

  setStatusFilter(status: 'all' | UserStatus): void {
    this.statusFilter = status;
  }

  clearFilter(key: string): void {
    if (key === 'country') this.countrySearch = '';
    if (key === 'role') this.roleFilter = '';
    if (key === 'status') this.statusFilter = 'all';
  }

  users: UserRow[] = [];
  isLoading = true;

  ngOnInit(): void {
    const tenantId = this.authService.getCurrentUser()?.tenantId;
    if (!tenantId) {
      this.isLoading = false;
      return;
    }
    this.loadUsers(tenantId);
    this.userManagementService.listRoles().subscribe(r => {
      this.roleOptions = r.items.filter(role => role.isActive);
      this.cdr.detectChanges();
    });
    this.userManagementService.listPlants().subscribe(p => {
      this.plantOptions = p;
      this.cdr.detectChanges();
    });
  }

  private loadUsers(tenantId: number, page = this.currentPage): void {
    this.isLoading = true;
    this.userManagementService.listUsersByTenant(tenantId, page, this.pageSize)
      .subscribe({
        next: (result) => {
          const lastPage = Math.max(1, Math.ceil(result.totalCount / this.pageSize));
          if (page > lastPage) {
            this.loadUsers(tenantId, lastPage);
            return;
          }
          this.users = result.items.map(u => this.mapToUserRow(u));
          this.totalCount = result.totalCount;
          this.currentPage = page;
          this.updateStats();
          this.isLoading = false;
          this.cdr.detectChanges();
        },
        error: () => {
          this.isLoading = false;
          this.toastService.pending = 'Failed to load users. Please try again.';
          this.cdr.detectChanges();
        },
      });
  }

  private mapToUserRow(u: TenantUserDto): UserRow {
    const name = u.displayName || u.email.split('@')[0];
    const parts = name.split(' ');
    const initials = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.substring(0, 2).toUpperCase();

    const accentPool: AvatarAccent[] = ['blue', 'green', 'orange', 'purple', 'teal', 'pink', 'violet'];
    const avatarAccent = accentPool[u.userId % accentPool.length];

    const roleAccentMap: Record<string, RoleAccent> = { admin: 'purple', cluster_admin: 'blue', site_admin: 'teal', planner: 'green' };
    const roleAccent: RoleAccent = roleAccentMap[u.roleCode] ?? 'blue';
    const roles = (u.roles?.length ? u.roles : [u]).map(role => ({
      name: role.roleName ?? role.roleCode,
      accent: roleAccentMap[role.roleCode] ?? 'blue' as RoleAccent,
    }));

    return {
      id: u.userId.toString(),
      name,
      initials,
      avatarAccent,
      employeeId: u.employeeId ?? '',
      email: u.email,
      role: roles.map(role => role.name).join(', '),
      roleIds: u.roleIds,
      roles,
      roleAccent,
      plantAccess: u.plantCodes?.map(c => c.toString()) ?? [],
      status: u.isActive ? 'active' : 'inactive',
      loginTime: this.formatLoginTime(u.lastLoginAt),
    };
  }

  private formatLoginTime(value: string | null): string {
    if (!value) return 'Never';
    const date = new Date(value);
    if (isNaN(date.getTime())) return 'Never';
    return date.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }

  private updateStats(): void {
    const total = this.users.length;
    const active = this.users.filter(u => u.status === 'active').length;
    const inactive = total - active;
    this.stats[0].value = this.totalCount;
    this.stats[1].value = active;
    this.stats[2].value = inactive;
  }

  showCreateUserModal = false;
  editingUser: UserRow | null = null;

  openCreateUserModal(): void {
    this.editingUser = null;
    this.showCreateUserModal = true;
  }

  openEditUserModal(user: UserRow): void {
    this.editingUser = user;
    this.showCreateUserModal = true;
  }

  onUserCreated(_user: UserRow): void {
    this.showCreateUserModal = false;
    this.editingUser = null;
    this.refreshUsers(Math.ceil((this.totalCount + 1) / this.pageSize));
    this.notify.showSuccess('User added successfully.');
  }

  onUserUpdated(_user: UserRow): void {
    this.showCreateUserModal = false;
    this.editingUser = null;
    this.refreshUsers();
    this.notify.showSuccess('User updated successfully.');
  }

  showResetPasswordModal = false;
  resetPasswordUser: UserRow | null = null;
  resetPasswordValue = '';
  resettingUserId: string | null = null;

  showResetConfirm = false;
  pendingResetUser: UserRow | null = null;

  requestResetPassword(user: UserRow): void {
    this.pendingResetUser = user;
    this.showResetConfirm = true;
  }

  cancelResetPassword(): void {
    this.showResetConfirm = false;
    this.pendingResetUser = null;
  }

  confirmResetPassword(): void {
    const user = this.pendingResetUser;
    this.showResetConfirm = false;
    this.pendingResetUser = null;
    if (!user || this.resettingUserId) return;

    this.resettingUserId = user.id;
    this.userManagementService.resetPassword(Number(user.id)).subscribe({
      next: (res) => {
        this.resetPasswordUser = user;
        this.resetPasswordValue = res.temporaryPassword;
        this.showResetPasswordModal = true;
        this.resettingUserId = null;
        this.cdr.detectChanges();
      },
      error: () => {
        this.resettingUserId = null;
        this.toastService.pending = 'Failed to reset password. Please try again.';
        this.cdr.detectChanges();
      },
    });
  }

  closeResetPasswordModal(): void {
    this.showResetPasswordModal = false;
    this.resetPasswordUser = null;
    this.resetPasswordValue = '';
  }

  showDeleteConfirm = false;
  pendingDeleteUser: UserRow | null = null;
  deletingUserId: string | null = null;

  requestDeleteUser(user: UserRow): void {
    this.pendingDeleteUser = user;
    this.showDeleteConfirm = true;
  }

  cancelDeleteUser(): void {
    this.showDeleteConfirm = false;
    this.pendingDeleteUser = null;
  }

  confirmDeleteUser(): void {
    const user = this.pendingDeleteUser;
    this.showDeleteConfirm = false;
    this.pendingDeleteUser = null;
    if (!user || this.deletingUserId) return;

    this.deletingUserId = user.id;
    this.userManagementService.deleteUser(Number(user.id)).subscribe({
      next: () => {
        this.deletingUserId = null;
        this.refreshUsers();
        this.notify.showSuccess('User deleted successfully.');
        this.cdr.detectChanges();
      },
      error: () => {
        this.deletingUserId = null;
        this.toastService.pending = 'Failed to delete user. Please try again.';
        this.cdr.detectChanges();
      },
    });
  }

  get gridContext() {
    return {
      onEdit: (user: UserRow) => this.openEditUserModal(user),
      onResetPassword: (user: UserRow) => this.requestResetPassword(user),
      onDelete: (user: UserRow) => this.requestDeleteUser(user),
      plantOptions: this.plantOptions,
    };
  }

  readonly gridTheme = gridTheme;
  readonly rowSelection = rowSelection;
  readonly getRowId = (params: GetRowIdParams<UserRow>): string => params.data.id;

  readonly selectionColumnDef: SelectionColumnDef = {
    width: 48,
    maxWidth: 48,
    minWidth: 48,
    suppressHeaderMenuButton: true,
    suppressMovable: true,
  };

  readonly columnDefs: ColDef<UserRow>[] = [
    { headerName: 'Employee Name', field: 'name', cellRenderer: EmployeeCellRendererComponent, minWidth: 200 },
    { headerName: 'Employee ID', field: 'employeeId', minWidth: 130 },
    { headerName: 'Email', field: 'email', minWidth: 220 },
    { headerName: 'Role', field: 'role', cellRenderer: RoleCellRendererComponent, minWidth: 150,
      autoHeight: true, wrapText: true, tooltip: p => p.data?.role },
    { headerName: 'Plant Access', field: 'plantAccess',
      valueFormatter: p => {
        const codes: string[] = p.value ?? [];
        const plants = p.context?.plantOptions ?? [];
        return codes.map((c: string) => {
          const pl = plants.find((o: any) => o.plantCode.toString() === c);
          return pl ? pl.plantName : c;
        }).join(', ');
      },
      tooltip: p => {
        const codes: string[] = p.data?.plantAccess ?? [];
        const plants = p.context?.plantOptions ?? [];
        return codes.map((c: string) => {
          const pl = plants.find((o: any) => o.plantCode.toString() === c);
          return pl ? `${pl.plantCode}- ${pl.plantName}` : c;
        }).join(', ');
      },
      minWidth: 180 },
    { headerName: 'Status', field: 'status', cellRenderer: StatusCellRendererComponent, minWidth: 120 },
    { headerName: 'Login Time', field: 'loginTime', minWidth: 180 },
    { headerName: 'Actions', sortable: false, filter: false, cellRenderer: ActionsCellRendererComponent, minWidth: 150, maxWidth: 150 },
  ];

  readonly defaultColDef: ColDef<UserRow> = {
    sortable: true,
    resizable: true,
    flex: 1,
  };

  totalCount = 0;
  pageSize = 20;
  currentPage = 1;

  showExportModal = false;
  toggleExportModal(): void { this.showExportModal = !this.showExportModal; }
  exportAs(_format: string): void { this.showExportModal = false; }

  @HostListener('document:click')
  closeExportModal(): void { this.showExportModal = false; }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalCount / this.pageSize));
  }

  get rangeStart(): number {
    return this.totalCount === 0 ? 0 : (this.currentPage - 1) * this.pageSize + 1;
  }

  get rangeEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalCount);
  }

  goToFirstPage(): void {
    this.goToPage(1);
  }

  goToPrevPage(): void {
    this.goToPage(this.currentPage - 1);
  }

  goToNextPage(): void {
    this.goToPage(this.currentPage + 1);
  }

  goToLastPage(): void {
    this.goToPage(this.totalPages);
  }

  private goToPage(page: number): void {
    const nextPage = Math.max(1, Math.min(this.totalPages, page));
    if (this.isLoading || this.deletingUserId || nextPage === this.currentPage) return;
    this.refreshUsers(nextPage);
  }

  private refreshUsers(page = this.currentPage): void {
    const tenantId = this.authService.getCurrentUser()?.tenantId;
    if (tenantId) this.loadUsers(tenantId, page);
  }
}
