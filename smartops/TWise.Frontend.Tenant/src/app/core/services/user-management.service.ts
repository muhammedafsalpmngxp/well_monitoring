import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface TenantUserDto {
  userId: number;
  email: string;
  displayName: string | null;
  employeeId: string | null;
  status: string | null;
  isActive: boolean;
  roleCode: string;
  roleName: string | null;
  roleIds?: number[];
  roles?: Pick<RoleDto, 'roleId' | 'roleCode' | 'roleName'>[];
  plantCodes: number[];
  lastLoginAt: string | null;
}

export interface UserSearchDto {
  userId: number;
  displayName: string;
  email: string;
  employeeId?: string;
}

export interface EmployeePlantAccess {
  plantCode: number;
  plantName: string;
  cluster: string;
  division: string;
  businessUnit: string;
  sector: string;
  country: string;
}

export interface EmployeeSearchResult {
  employeeId: string;
  displayName: string;
  email: string | null;
  plantAccess: EmployeePlantAccess[];
}

export interface RoleDto {
  roleId: number;
  roleCode: string;
  roleName: string | null;
  description: string | null;
  scope: string | null;
  isActive: boolean;
}

export interface PagedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface AppUserUpdateRequest {
  email: string;
  displayName: string | null;
  status: string | null;
  isActive: boolean;
}

export interface UpdateUserWithAccessRequest {
  email: string;
  displayName: string | null;
  employeeId: string | null;
  status: string | null;
  isActive: boolean;
  roleIds: number[];
  plantCodes: number[];
}

export interface CreateUserWithAccessRequest {
  email: string;
  displayName: string;
  employeeId: string | null;
  password: string;
  status: string;
  isActive: boolean;
  tenantId: number;
  roleId: number;
  roleIds: number[];
  plantCodes: number[];
}

export interface CreateUserWithAccessResponse {
  userId: number;
  email: string;
  displayName: string | null;
  employeeId: string | null;
  role: string;
  plantCodes: number[];
}

export interface UserDuplicateCheckResponse {
  emailExists: boolean;
  employeeIdExists: boolean;
}

export interface ResetPasswordResponse {
  userId: number;
  email: string;
  temporaryPassword: string;
}

@Injectable({ providedIn: 'root' })
export class UserManagementService {
  private readonly baseUrl = environment.controlPlaneApiUrl;

  constructor(private readonly http: HttpClient) {}

  listUsersByTenant(tenantId: number, page = 1, pageSize = 200): Observable<PagedResult<TenantUserDto>> {
    const params = new HttpParams()
      .set('page', page)
      .set('pageSize', pageSize);
    return this.http.get<PagedResult<TenantUserDto>>(
      `${this.baseUrl}/users/by-tenant/${tenantId}`, { params });
  }

  searchUsers(term: string): Observable<EmployeeSearchResult[]> {
    const params = new HttpParams().set('q', term);
    return this.http.get<EmployeeSearchResult[]>(
      `${this.baseUrl}/users/search`, { params });
  }

  listRoles(): Observable<PagedResult<RoleDto>> {
    return this.http.get<PagedResult<RoleDto>>(`${this.baseUrl}/roles`);
  }

  listPlants(): Observable<EmployeePlantAccess[]> {
    return this.http.get<EmployeePlantAccess[]>(`${this.baseUrl}/plants`);
  }

  createUserWithAccess(request: CreateUserWithAccessRequest): Observable<CreateUserWithAccessResponse> {
    return this.http.post<CreateUserWithAccessResponse>(`${this.baseUrl}/users/with-access`, request);
  }

  checkUserDuplicates(email: string, employeeId: string): Observable<UserDuplicateCheckResponse> {
    const params = new HttpParams().set('email', email).set('employeeId', employeeId);
    return this.http.get<UserDuplicateCheckResponse>(`${this.baseUrl}/users/check-duplicates`, { params });
  }

  updateUser(id: number, request: AppUserUpdateRequest): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/users/${id}`, request);
  }

  updateUserWithAccess(id: number, request: UpdateUserWithAccessRequest): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/users/${id}/with-access`, request);
  }

  getUserPlantAccess(userId: number): Observable<number[]> {
    return this.http.get<number[]>(`${this.baseUrl}/users/${userId}/plant-access`);
  }

  updateUserPlantAccess(userId: number, plantCodes: number[]): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/users/${userId}/plant-access`, { plantCodes });
  }

  resetPassword(userId: number): Observable<ResetPasswordResponse> {
    return this.http.post<ResetPasswordResponse>(`${this.baseUrl}/users/${userId}/reset-password`, {});
  }

  deleteUser(userId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/users/${userId}`);
  }
}
