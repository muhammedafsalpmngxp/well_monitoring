import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { PermissionService } from './permission.service';
import { StorageService } from './storage.service';
import { HttpClient } from '@angular/common/http';
import { APP_CONSTANTS } from '../constants/app.constants';
import { LoginCredentials, LoginResponse } from '../models/user.model';
import { environment } from '../../../environments/environment';

const STORAGE = APP_CONSTANTS.STORAGE_KEYS;

const loginResponse: LoginResponse = {
  token: 'access-token',
  refreshToken: 'refresh-token',
  userId: 42,
  employeeId: 'EMP00042',
  email: 'user@example.com',
  displayName: 'Regular User',
  role: 'operator',
  tenantId: 7,
};

describe('AuthService', () => {
  let service: AuthService;
  let http: { post: ReturnType<typeof vi.fn> };
  let tokenService: {
    setAccessToken: ReturnType<typeof vi.fn>;
    setRefreshToken: ReturnType<typeof vi.fn>;
    getAccessToken: ReturnType<typeof vi.fn>;
    getRefreshToken: ReturnType<typeof vi.fn>;
    clearTokens: ReturnType<typeof vi.fn>;
  };
  let permissionService: {
    loadFromToken: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    isAdminUser: boolean;
  };
  let storageService: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
    clearSessionItems: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    http = { post: vi.fn() };
    tokenService = {
      setAccessToken: vi.fn(),
      setRefreshToken: vi.fn(),
      getAccessToken: vi.fn(),
      getRefreshToken: vi.fn(),
      clearTokens: vi.fn(),
    };
    permissionService = { loadFromToken: vi.fn(), clear: vi.fn(), isAdminUser: false };
    storageService = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clearSessionItems: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        AuthService,
        { provide: HttpClient, useValue: http },
        { provide: TokenService, useValue: tokenService },
        { provide: PermissionService, useValue: permissionService },
        { provide: StorageService, useValue: storageService },
      ],
    });

    service = TestBed.inject(AuthService);
  });

  describe('login', () => {
    const credentials: LoginCredentials = { email: 'user@example.com', password: 'secret' };

    beforeEach(() => {
      http.post.mockReturnValue(of(loginResponse));
    });

    it('should POST credentials and return the login response', () => {
      let result: LoginResponse | undefined;
      service.login(credentials).subscribe((r) => (result = r));

      expect(http.post).toHaveBeenCalledWith(expect.stringContaining('/auth/login'), credentials);
      expect(result).toEqual(loginResponse);
    });

    it('should persist both tokens', () => {
      service.login(credentials).subscribe();

      expect(tokenService.setAccessToken).toHaveBeenCalledWith('access-token');
      expect(tokenService.setRefreshToken).toHaveBeenCalledWith('refresh-token');
    });

    it('should reload permissions from the new token', () => {
      service.login(credentials).subscribe();

      expect(permissionService.loadFromToken).toHaveBeenCalledTimes(1);
    });

    it('should clear the previous calendar plan when starting a new login session', () => {
      service.login(credentials).subscribe();
      expect(storageService.clearSessionItems).toHaveBeenCalledWith(STORAGE.CREW_CALENDAR_SESSION);
    });

    it('should cache the user profile in storage', () => {
      service.login(credentials).subscribe();

      expect(storageService.setItem).toHaveBeenCalledWith(
        STORAGE.USER_DATA,
        JSON.stringify({
          userId: 42,
          employeeId: 'EMP00042',
          email: 'user@example.com',
          displayName: 'Regular User',
          role: 'operator',
          tenantId: 7,
        }),
      );
    });

    it('should expose the logged-in user via getCurrentUser', () => {
      service.login(credentials).subscribe();

      expect(service.getCurrentUser()).toMatchObject({ userId: 42, employeeId: 'EMP00042', role: 'operator' });
    });

    it('should not touch storage or tokens before the response arrives', () => {
      http.post.mockReturnValue(of(loginResponse));
      service.login(credentials); // not subscribed

      expect(tokenService.setAccessToken).not.toHaveBeenCalled();
      expect(storageService.setItem).not.toHaveBeenCalled();
    });
  });

  describe('employee ID in session updates', () => {
    it.each([null, undefined, '', '   '])('keeps a missing employee ID (%s) null instead of using the user ID', employeeId => {
      service.applySession({ ...loginResponse, employeeId });

      expect(service.getCurrentUser()?.employeeId).toBeNull();
    });

    it('updates the employee ID when the session is refreshed', () => {
      service.applySession(loginResponse);
      service.applySession({ ...loginResponse, employeeId: '00076' });

      expect(service.getCurrentUser()?.employeeId).toBe('00076');
    });

    it('clears an old employee ID when refresh explicitly returns null', () => {
      const token = `header.${btoa(JSON.stringify({ sub: '42', tenantId: 7, email: loginResponse.email, role: 'operator' }))}.signature`;
      service.applySession({ ...loginResponse, token });
      service.applySession({ ...loginResponse, token, employeeId: null });

      expect(service.getCurrentUser()?.employeeId).toBeNull();
    });

    it('preserves the same user employee ID when an older response omits it', () => {
      const token = `header.${btoa(JSON.stringify({ sub: '42', tenantId: 7, email: loginResponse.email, role: 'operator' }))}.signature`;
      service.applySession({ ...loginResponse, token });
      service.applySession({ ...loginResponse, token, employeeId: undefined });

      expect(service.getCurrentUser()?.employeeId).toBe('EMP00042');
    });

    it('does not carry an employee ID over to a different user', () => {
      const token = `header.${btoa(JSON.stringify({ sub: '43', tenantId: 7, email: 'other@example.com', role: 'operator' }))}.signature`;
      service.applySession(loginResponse);
      service.applySession({ ...loginResponse, userId: 43, token, email: 'other@example.com', employeeId: undefined });

      expect(service.getCurrentUser()?.employeeId).toBeNull();
    });
  });

  describe('logout', () => {
    beforeEach(() => {
      http.post.mockReturnValue(of(loginResponse));
      service.login({ email: 'user@example.com', password: 'secret' }).subscribe();
      vi.clearAllMocks();
      tokenService.getRefreshToken.mockReturnValue('refresh-token');
    });

    afterEach(() => vi.useRealTimers());

    it('posts the captured refresh token after clearing local credentials', () => {
      http.post.mockImplementation(() => {
        expect(tokenService.clearTokens).toHaveBeenCalledOnce();
        return of(null);
      });

      service.logout();

      expect(http.post).toHaveBeenCalledWith(`${environment.controlPlaneApiUrl}/auth/logout`, { refreshToken: 'refresh-token' });
    });

    it('clears the local session without an API call when there is no refresh token', () => {
      tokenService.getRefreshToken.mockReturnValue(null);
      service.logout();

      expect(http.post).not.toHaveBeenCalled();
      expect(tokenService.clearTokens).toHaveBeenCalledOnce();
    });

    it('keeps local logout working if the API fails', () => {
      http.post.mockReturnValue(throwError(() => new Error('Network unavailable')));

      expect(() => service.logout()).not.toThrow();
      expect(tokenService.clearTokens).toHaveBeenCalledOnce();
      expect(permissionService.clear).toHaveBeenCalledOnce();
    });

    it('bounds a stalled API request without waiting to clear local credentials', () => {
      vi.useFakeTimers();
      const response = new Subject<void>();
      http.post.mockReturnValue(response);
      service.logout();

      expect(tokenService.clearTokens).toHaveBeenCalledOnce();
      expect(response.observed).toBe(true);
      vi.advanceTimersByTime(5_000);
      expect(response.observed).toBe(false);
    });

    it('does not clear a newly signed-in session when an old logout request fails', () => {
      const response = new Subject<void>();
      http.post.mockReturnValue(response);
      service.logout();
      service.applySession(loginResponse);
      response.error(new Error('Late logout response'));

      expect(tokenService.clearTokens).toHaveBeenCalledOnce();
      expect(service.getCurrentUser()?.userId).toBe(loginResponse.userId);
    });

    it('sends only one API request for repeated logout after tokens are removed', () => {
      tokenService.clearTokens.mockImplementation(() => tokenService.getRefreshToken.mockReturnValue(null));
      service.logout();
      service.logout();

      expect(http.post).toHaveBeenCalledTimes(1);
    });

    it('keeps automatic session cleanup local without calling logout', () => {
      service.clearSession();

      expect(http.post).not.toHaveBeenCalled();
      expect(tokenService.clearTokens).toHaveBeenCalledOnce();
    });

    it('should clear tokens', () => {
      service.logout();
      expect(tokenService.clearTokens).toHaveBeenCalledTimes(1);
    });

    it('should clear session-only crew allocations on logout', () => {
      service.logout();
      expect(storageService.clearSessionItems).toHaveBeenCalledWith(STORAGE.CREW_CALENDAR_SESSION);
    });

    it('should clear cached permissions', () => {
      service.logout();
      expect(permissionService.clear).toHaveBeenCalledTimes(1);
    });

    it('should remove the cached user profile from storage', () => {
      service.logout();
      expect(storageService.removeItem).toHaveBeenCalledWith(STORAGE.USER_DATA);
    });

    it('should drop the in-memory user so getCurrentUser returns null', () => {
      storageService.getItem.mockReturnValue(null);
      service.logout();
      expect(service.getCurrentUser()).toBeNull();
    });
  });

  describe('isAuthenticated', () => {
    it('should retain calendar drafts when refreshing the existing token session', () => {
      service.applySession(loginResponse);
      expect(storageService.clearSessionItems).not.toHaveBeenCalled();
    });

    it('should be true when an access token exists', () => {
      tokenService.getAccessToken.mockReturnValue('access-token');
      expect(service.isAuthenticated()).toBe(true);
    });

    it('should be false when no access token exists', () => {
      tokenService.getAccessToken.mockReturnValue(null);
      expect(service.isAuthenticated()).toBe(false);
    });

    it.fails('known defect: should not accept an access token expired during ten hours of idle', () => {
      const now = Math.floor(Date.now() / 1000);
      const payload = btoa(JSON.stringify({ iat: now - 10 * 3600, exp: now - 2 * 3600 }));
      tokenService.getAccessToken.mockReturnValue(`header.${payload}.test-signature`);
      expect(service.isAuthenticated()).toBe(false);
    });

    it.fails('known defect: should not accept a malformed stored access token', () => {
      tokenService.getAccessToken.mockReturnValue('not-a-jwt');
      expect(service.isAuthenticated()).toBe(false);
    });
  });

  describe('isAdmin', () => {
    it('should delegate to the current token via PermissionService', () => {
      permissionService.isAdminUser = true;
      expect(service.isAdmin()).toBe(true);

      permissionService.isAdminUser = false;
      expect(service.isAdmin()).toBe(false);
    });
  });

  describe('getCurrentUser', () => {
    it.each(['00076', null, undefined])('hydrates employee ID %s from a cached profile with a valid token', employeeId => {
      const token = `header.${btoa(JSON.stringify({ sub: '42', tenantId: 7, email: loginResponse.email, role: 'operator' }))}.signature`;
      tokenService.getAccessToken.mockReturnValue(token);
      storageService.getItem.mockReturnValue(JSON.stringify({ ...loginResponse, employeeId }));

      expect(service.getCurrentUser()?.employeeId).toBe(employeeId ?? null);
    });

    it('should hydrate from storage when no user is held in memory', () => {
      storageService.getItem.mockReturnValue(
        JSON.stringify({ userId: 99, email: 'stored@example.com', role: 'viewer' }),
      );

      expect(service.getCurrentUser()).toMatchObject({ userId: 99, role: 'viewer' });
    });

    it('should discard corrupt stored data', () => {
      storageService.getItem.mockReturnValue('{ not valid json');

      expect(service.getCurrentUser()).toBeNull();
      expect(storageService.removeItem).toHaveBeenCalledWith(STORAGE.USER_DATA);
    });
  });
});
