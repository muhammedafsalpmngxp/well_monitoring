import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Observable, catchError, tap, timeout } from 'rxjs';
import { TokenService } from './token.service';
import { PermissionService } from './permission.service';
import { StorageService } from './storage.service';
import { DashboardService } from './dashboard.service';
import { CategoryService } from './category.service';
import { CommonApiService } from './common-api.service';
import { ListRouteReuseStrategy } from './list-route-reuse.strategy';
import { User, LoginCredentials, LoginResponse } from '../models/user.model';
import { APP_CONSTANTS } from '../constants/app.constants';
import { API_ENDPOINTS } from '../constants/api.constants';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly currentUser = signal<User | null>(null);

  constructor(
    private readonly http: HttpClient,
    private readonly tokenService: TokenService,
    private readonly permissionService: PermissionService,
    private readonly storageService: StorageService,
    private readonly dashboardService: DashboardService,
    private readonly categoryService: CategoryService,
    private readonly commonApiService: CommonApiService,
    private readonly listRouteReuseStrategy: ListRouteReuseStrategy,
  ) {}

  login(credentials: LoginCredentials): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${environment.controlPlaneApiUrl}/auth/login`, credentials)
      .pipe(tap((response) => {
        this.storageService.clearSessionItems(APP_CONSTANTS.STORAGE_KEYS.CREW_CALENDAR_SESSION);
        this.applySession(response);
        // The previous user's logout already cleared the caches, but ListRouteReuseStrategy's
        // detach/store for the vacated list route (e.g. standard-boards) only runs during the
        // navigate-to-login transition AFTER logout() — i.e. AFTER logout's own clear() call,
        // re-populating it with a stale (now-empty) component. Clearing again here, once the
        // new login actually succeeds, guarantees it runs after that re-population and before
        // the post-login navigation re-attaches the stale instance.
        this.listRouteReuseStrategy.clear();
      }));
  }

  /** Refreshes the cached profile + permissions from a new token pair (called after a token refresh). */
  applySession(response: LoginResponse): void {
    if (!response || typeof response.token !== 'string' || !response.token.trim()
      || typeof response.refreshToken !== 'string' || !response.refreshToken.trim()) {
      throw new Error('The session response is missing tokens. Please sign in again.');
    }
    const user = this.resolveUser(response, response.token, this.getCurrentUser());
    this.tokenService.setAccessToken(response.token);
    this.tokenService.setRefreshToken(response.refreshToken);
    this.permissionService.loadFromToken();
    this.currentUser.set(user);
    this.storageService.setItem(APP_CONSTANTS.STORAGE_KEYS.USER_DATA, JSON.stringify(user));
  }

  private resolveUser(profile: Partial<User>, token: string, cachedUser: User | null): User {
    const tokenUser = this.readTokenUser(token);
    if (tokenUser && ((profile.userId != null && profile.userId !== tokenUser.userId)
      || (profile.tenantId != null && profile.tenantId !== tokenUser.tenantId))) {
      throw new Error('The profile does not match the session. Please sign in again.');
    }
    const sameUser = tokenUser && cachedUser?.userId === tokenUser.userId
      && cachedUser?.tenantId === tokenUser.tenantId ? cachedUser : null;
    const email = this.profileText(profile.email) || tokenUser?.email || this.profileText(sameUser?.email);
    const user: User = {
      userId: profile.userId ?? tokenUser?.userId ?? 0,
      employeeId: this.profileText(profile.employeeId !== undefined ? profile.employeeId : sameUser?.employeeId) || null,
      email,
      displayName: this.profileText(profile.displayName) || tokenUser?.displayName
        || this.profileText(sameUser?.displayName) || email,
      role: tokenUser?.role || this.profileText(profile.role),
      tenantId: profile.tenantId ?? tokenUser?.tenantId ?? -1,
    };
    if (!Number.isSafeInteger(user.userId) || user.userId <= 0
      || !Number.isSafeInteger(user.tenantId) || user.tenantId < 0 || !user.email || !user.role) {
      throw new Error('The session profile is incomplete. Please sign in again.');
    }
    return user;
  }

  private readTokenUser(token: string): Partial<User> | null {
    try {
      const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const bytes = Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')),
        character => character.charCodeAt(0));
      const claims = JSON.parse(new TextDecoder().decode(bytes));
      const userId = Number(claims.sub);
      const tenantId = claims.tenantId == null ? -1 : Number(claims.tenantId);
      if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(tenantId) || tenantId < 0) return null;
      return {
        userId,
        tenantId,
        email: this.profileText(claims.email),
        displayName: this.profileText(claims.name),
        role: this.profileText(claims['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] || claims.role),
      };
    } catch {
      return null;
    }
  }

  private profileText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  logout(): void {
    const refreshToken = this.tokenService.getRefreshToken();
    this.clearSession();
    if (!refreshToken) return;

    this.http.post<void>(`${environment.controlPlaneApiUrl}${API_ENDPOINTS.AUTH.LOGOUT}`, { refreshToken }).pipe(
      timeout({ first: 5_000 }),
      catchError(() => EMPTY),
    ).subscribe();
  }

  clearSession(): void {
    this.storageService.clearSessionItems(APP_CONSTANTS.STORAGE_KEYS.CREW_CALENDAR_SESSION);
    this.tokenService.clearTokens();
    this.permissionService.clear();
    this.storageService.removeItem(APP_CONSTANTS.STORAGE_KEYS.USER_DATA);
    this.currentUser.set(null);
    // Reset per-user caches so the next login doesn't briefly show the previous user's data.
    this.dashboardService.clearCache();
    this.categoryService.clearCache();
    // Plant-filters are scoped per-user's Plant Access — without this, a broader-access user's
    // cached plant/cluster list would leak into the next login on the same browser session.
    this.commonApiService.clearCache();
    // Standard/WIP boards|charts|tiles|reports are kept alive (detached, not destroyed) by
    // ListRouteReuseStrategy for back-navigation — without this, a stale detached instance is
    // reattached on the next login, still holding the (now-cleared) previous data forever.
    this.listRouteReuseStrategy.clear();
  }

  isAuthenticated(): boolean {
    return !!this.tokenService.getAccessToken();
  }

  getCurrentUser(): User | null {
    if (!this.currentUser()) {
      const stored = this.storageService.getItem(APP_CONSTANTS.STORAGE_KEYS.USER_DATA);
      let profile: User | null = null;
      if (stored) {
        try { profile = JSON.parse(stored); } catch { this.storageService.removeItem(APP_CONSTANTS.STORAGE_KEYS.USER_DATA); }
      }
      const token = this.tokenService.getAccessToken();
      if (token) {
        try {
          const tokenUser = this.readTokenUser(token);
          if (tokenUser && (profile?.userId !== tokenUser.userId || profile?.tenantId !== tokenUser.tenantId)) {
            profile = null;
          }
          profile = this.resolveUser(profile ?? {}, token, null);
          this.storageService.setItem(APP_CONSTANTS.STORAGE_KEYS.USER_DATA, JSON.stringify(profile));
        } catch {
          profile = null;
          this.storageService.removeItem(APP_CONSTANTS.STORAGE_KEYS.USER_DATA);
        }
      }
      return profile;
    }
    return this.currentUser();
  }

  isAdmin(): boolean {
    // Single source of truth: derived from the current token, so it stays correct after a refresh.
    return this.permissionService.isAdminUser;
  }
}
