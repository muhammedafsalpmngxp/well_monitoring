import { ChangeDetectorRef, Component, EventEmitter, Input, OnDestroy, Output } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, timer } from 'rxjs';
import { debounceTime, distinctUntilChanged, switchMap, tap, catchError, takeUntil, timeout } from 'rxjs/operators';
import { of } from 'rxjs';
import type { MultiSelectOption } from '../../../../shared/components/multi-select/multi-select.component';
import type { RoleAccent, StatAccent, UserRow, UserStatus } from '../users.component';
import { UserManagementService, EmployeeSearchResult, EmployeePlantAccess, RoleDto, CreateUserWithAccessRequest, UpdateUserWithAccessRequest } from '../../../../core/services/user-management.service';
import { AuthService } from '../../../../core/services/auth.service';

export type UserType = 'internal' | 'external';

interface OrgMappingEntry {
  cluster: string;
  sector: string;
  bu: string;
  division: string;
  plant: string;
}

const ROLE_ACCENT_MAP: Record<string, RoleAccent> = {
  admin: 'purple', cluster_admin: 'blue', site_admin: 'teal', planner: 'green',
};
const AVATAR_ACCENT_MAP: Record<string, StatAccent> = {
  admin: 'purple', cluster_admin: 'purple', site_admin: 'blue', planner: 'green',
};

interface FormErrors {
  save?: string;
  userType?: string;
  name?: string;
  employeeId?: string;
  email?: string;
  roles?: string;
  plants?: string;
}

@Component({
  selector: 'app-create-user-modal',
  standalone: false,
  templateUrl: './create-user-modal.component.html',
  styleUrls: ['./create-user-modal.component.scss'],
})
export class CreateUserModalComponent implements OnDestroy {
  @Input() isOpen = false;
  @Input() roleOptions: RoleDto[] = [];
  @Input() plantOptions: EmployeePlantAccess[] = [];
  @Input() set editUser(user: UserRow | null) {
    this._editUser = user;
    if (user) this.prefillForEdit(user);
  }
  get editUser(): UserRow | null { return this._editUser; }
  private _editUser: UserRow | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<UserRow>();
  @Output() updated = new EventEmitter<UserRow>();

  userType: UserType = 'internal';
  name = '';
  employeeId = '';
  email = '';
  generatedPassword = '';
  status: UserStatus = 'active';
  selectedRoleIds: string[] = [];
  selectedPlantIds: string[] = [];
  errors: FormErrors = {};

  // Search state for internal user lookup
  searchResults: EmployeeSearchResult[] = [];
  showSearchDropdown = false;
  isSearching = false;
  private readonly searchSubject = new Subject<string>();
  private readonly duplicateCheckSubject = new Subject<void>();
  private readonly destroyed = new Subject<void>();
  private duplicateErrors: Pick<FormErrors, 'email' | 'employeeId'> = {};

  isSaving = false;

  constructor(
    private readonly userManagementService: UserManagementService,
    private readonly authService: AuthService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.searchSubject.pipe(
      debounceTime(150),
      distinctUntilChanged(),
      tap(() => { this.isSearching = true; }),
      switchMap(term => {
        if (!term || term.length < 2) {
          return of([] as EmployeeSearchResult[]);
        }
        return this.userManagementService.searchUsers(term).pipe(
          catchError(() => of([] as EmployeeSearchResult[]))
        );
      }),
      takeUntil(this.destroyed),
    ).subscribe(results => {
      this.searchResults = results;
      this.showSearchDropdown = results.length > 0;
      this.isSearching = false;
      this.cdr.detectChanges();
    });

    this.duplicateCheckSubject.pipe(
      switchMap(() => {
        const email = this.isValidEmail(this.email.trim()) ? this.email.trim() : '';
        const employeeId = this.employeeId.trim();
        if (this.isEditMode || this.isSaving || (!email && !employeeId)) return of(null);
        return timer(400).pipe(
          switchMap(() => this.userManagementService.checkUserDuplicates(email, employeeId)),
          timeout(10000),
          catchError(() => of(null)),
        );
      }),
      takeUntil(this.destroyed),
    ).subscribe(result => {
      if (!result) return;
      this.duplicateErrors = {};
      if (result.emailExists) this.duplicateErrors.email = 'A user with this email already exists.';
      if (result.employeeIdExists) this.duplicateErrors.employeeId = 'A user with this employee ID already exists.';
      this.errors = { ...this.errors, email: undefined, employeeId: undefined, ...this.duplicateErrors };
      this.cdr.markForCheck();
    });

    this.generatePassword();
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  onIdentityInput(): void {
    this.duplicateErrors = {};
    delete this.errors.email;
    delete this.errors.employeeId;
    this.duplicateCheckSubject.next();
  }

  get isEditMode(): boolean { return !!this._editUser; }

  get isInternal(): boolean {
    return this.userType === 'internal';
  }

  get plantSelectOptions(): MultiSelectOption[] {
    return this.plantOptions.map(p => ({ id: p.plantCode.toString(), label: `${p.plantCode}- ${p.plantName}` }));
  }

  get roleSelectOptions(): MultiSelectOption[] {
    return this.roleOptions.map(r => ({
      id: r.roleId.toString(),
      label: r.roleName ?? r.roleCode,
      accent: ROLE_ACCENT_MAP[r.roleCode] ?? 'blue' as RoleAccent,
    }));
  }

  get orgMapping(): OrgMappingEntry | null {
    if (!this.selectedPlantIds.length) return null;
    const selected = this.plantOptions.filter(p => this.selectedPlantIds.includes(p.plantCode.toString()));
    if (!selected.length) return null;
    const first = selected[0];
    return {
      cluster: selected.map(p => `${p.plantCode}- ${p.plantName}`).join(', '),
      sector: first.sector,
      bu: first.businessUnit,
      division: first.division,
      plant: selected.map(p => p.plantName).join(', '),
    };
  }

  onUserTypeChange(): void {
    this.name = '';
    this.employeeId = '';
    this.email = '';
    this.searchResults = [];
    this.showSearchDropdown = false;
    this.errors = {};
    this.onIdentityInput();
  }

  onNameInput(value: string): void {
    this.name = value;
    if (this.isInternal && value.length >= 2) {
      this.searchSubject.next(value);
    } else {
      this.searchResults = [];
      this.showSearchDropdown = false;
    }
  }

  selectSearchResult(result: EmployeeSearchResult): void {
    this.name = result.displayName;
    this.employeeId = result.employeeId;
    // Fall back to the corporate email pattern when the directory has no email on file.
    this.email = result.email?.trim() || this.deriveEmail(result.displayName, result.employeeId);
    if (result.plantAccess?.length) {
      const codes = result.plantAccess.map(p => p.plantCode.toString());
      this.selectedPlantIds = codes.filter(c => this.plantOptions.some(p => p.plantCode.toString() === c));
    }
    this.showSearchDropdown = false;
    this.searchResults = [];
    this.onIdentityInput();
  }

  // Corporate email pattern: {firstName}.{employeeId}@ong.altasnim.com
  private deriveEmail(displayName: string, employeeId: string): string {
    const first = (displayName ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!first || !employeeId) return '';
    return `${first}.${employeeId}@ong.altasnim.com`;
  }

  hideSearchDropdown(): void {
    setTimeout(() => { this.showSearchDropdown = false; }, 200);
  }

  generatePassword(): void {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    const array = new Uint32Array(12);
    crypto.getRandomValues(array);
    for (let i = 0; i < 12; i++) {
      password += chars[array[i] % chars.length];
    }
    this.generatedPassword = password;
  }

  onDiscard(): void {
    this.resetForm();
    this.closed.emit();
  }

  onSave(): void {
    if (this.isSaving) return;
    this.errors = this.validate();
    if (Object.keys(this.errors).length) return;

    if (this.isEditMode) {
      this.saveEdit();
      return;
    }

    const tenantId = this.authService.getCurrentUser()?.tenantId;
    if (!tenantId) return;

    const roleId = parseInt(this.selectedRoleIds[0], 10);
    const plantCodes = this.selectedPlantIds.map(id => parseInt(id, 10));

    const request: CreateUserWithAccessRequest = {
      email: this.email.trim(),
      displayName: this.name.trim(),
      employeeId: this.employeeId.trim() || null,
      password: this.generatedPassword,
      status: this.status,
      isActive: this.status === 'active',
      tenantId,
      roleId,
      roleIds: this.selectedRoleIds.map(Number),
      plantCodes,
    };

    this.isSaving = true;
    this.duplicateCheckSubject.next();
    this.userManagementService.createUserWithAccess(request).subscribe({
      next: (res) => {
        const firstRole = this.roleOptions.find(r => r.roleId.toString() === this.selectedRoleIds[0]);
        const roleAccent: RoleAccent = ROLE_ACCENT_MAP[firstRole?.roleCode ?? ''] ?? 'blue';
        const avatarAccent: StatAccent = AVATAR_ACCENT_MAP[firstRole?.roleCode ?? ''] ?? 'blue';
        const user: UserRow = {
          id: res.userId.toString(),
          name: res.displayName ?? this.name.trim(),
          initials: this.initialsFor(this.name),
          avatarAccent,
          employeeId: res.employeeId ?? this.employeeId.trim(),
          email: res.email,
          role: res.role,
          roleIds: this.selectedRoleIds.map(Number),
          roleAccent,
          plantAccess: res.plantCodes.map(c => c.toString()),
          status: this.status,
          loginTime: 'Never',
        };
        this.created.emit(user);
        this.resetForm();
        this.isSaving = false;
      },
      error: (err: HttpErrorResponse) => this.handleSaveError(err),
    });
  }

  private validate(): FormErrors {
    const errors: FormErrors = { ...this.duplicateErrors };
    if (!this.name.trim()) errors.name = 'Name is required.';
    if (!this.isValidEmail(this.email.trim())) errors.email = 'A valid email is required.';
    if (!this.selectedRoleIds.length) errors.roles = 'Select at least one role.';
    if (!this.selectedPlantIds.length) errors.plants = 'Select at least one plant.';
    return errors;
  }

  private isValidEmail(value: string): boolean {
    const at = value.indexOf('@');
    if (at <= 0) return false;
    const domain = value.slice(at + 1);
    const dot = domain.indexOf('.');
    return dot > 0 && dot < domain.length - 1 && !/\s/.test(value);
  }

  private initialsFor(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  private prefillForEdit(user: UserRow): void {
    this.name = user.name;
    this.email = user.email;
    this.employeeId = user.employeeId;
    this.status = user.status;
    const matchedRole = this.roleOptions.find(r => (r.roleName ?? r.roleCode) === user.role);
    this.selectedRoleIds = user.roleIds?.map(String) ?? (matchedRole ? [matchedRole.roleId.toString()] : []);
    this.selectedPlantIds = user.plantAccess
      .filter(c => this.plantOptions.some(p => p.plantCode.toString() === c))
      .map(c => c);
    this.onIdentityInput();
  }

  private saveEdit(): void {
    const userId = Number(this._editUser!.id);
    const plantCodes = this.selectedPlantIds.map(id => Number.parseInt(id, 10));

    const request: UpdateUserWithAccessRequest = {
      email: this.email.trim(),
      displayName: this.name.trim(),
      employeeId: this.employeeId.trim() || null,
      status: this.status,
      isActive: this.status === 'active',
      roleIds: this.selectedRoleIds.map(Number),
      plantCodes,
    };

    this.isSaving = true;
    this.userManagementService.updateUserWithAccess(userId, request).subscribe({
      next: () => {
        const updatedUser: UserRow = {
          ...this._editUser!,
          name: this.name.trim(),
          initials: this.initialsFor(this.name),
          email: this.email.trim(),
          employeeId: this.employeeId.trim(),
          roleIds: this.selectedRoleIds.map(Number),
          plantAccess: this.selectedPlantIds,
          status: this.status,
        };
        this.updated.emit(updatedUser);
        this.resetForm();
        this.isSaving = false;
      },
      error: (err: HttpErrorResponse) => this.handleSaveError(err),
    });
  }

  private handleSaveError(err: HttpErrorResponse): void {
    this.isSaving = false;
    const apiError = err.error?.error ?? err.error;
    if (apiError?.code === 'DUPLICATE_ENTRY') {
      this.errors = { ...this.errors, email: 'A user with this email already exists.' };
    } else if (apiError?.code === 'VALIDATION_FAILED') {
      const details = apiError.details;
      const fields: (keyof FormErrors)[] = ['name', 'employeeId', 'email', 'roles', 'plants'];
      for (const field of fields) {
        const key = Object.keys(details ?? {}).find(key => key.toLowerCase() === field.toLowerCase());
        const messages = key ? details[key] : null;
        if (Array.isArray(messages) && typeof messages[0] === 'string') {
          this.errors[field] = messages[0];
        }
      }
      if (!Object.keys(this.errors).length) {
        this.errors.save = 'The user could not be saved. Please check the details and try again.';
      }
    } else {
      this.errors = { ...this.errors, save: 'The user could not be saved. Please try again.' };
    }
    this.cdr.markForCheck();
  }

  private resetForm(): void {
    this._editUser = null;
    this.userType = 'internal';
    this.name = '';
    this.employeeId = '';
    this.email = '';
    this.status = 'active';
    this.selectedRoleIds = [];
    this.selectedPlantIds = [];
    this.searchResults = [];
    this.showSearchDropdown = false;
    this.errors = {};
    this.onIdentityInput();
    this.generatePassword();
  }
}
