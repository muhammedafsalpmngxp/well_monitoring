import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';
import { PermissionService } from '../services/permission.service';
import { StorageService } from '../services/storage.service';
import { TokenService } from '../services/token.service';
import { LoginResponse } from '../models/user.model';
import { authInterceptor } from './auth.interceptor';
import { errorInterceptor } from './error.interceptor';

describe('Authentication recovery after idle', () => {
  const dataUrl = `${environment.tenantApiUrl}/login-audit/data`;
  const refreshUrl = `${environment.controlPlaneApiUrl}/auth/refresh-token`;
  let http: HttpClient;
  let requests: HttpTestingController;
  let auth: AuthService;
  let tokens: TokenService;
  let permissions: PermissionService;
  let navigate: ReturnType<typeof vi.fn>;
  let subscriptions: Subscription[];
  let expiredSession: LoginResponse;
  let renewedSession: LoginResponse;

  function token(issuedAt: number, lifetimeHours: number, role = 'admin'): string {
    return `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({
      sub: '42', iat: issuedAt, exp: issuedAt + lifetimeHours * 3600,
      role, perm: 'dashboard.standard-boards:v',
    }))}.test-signature`;
  }

  function startDataRequests(count = 3) {
    return Array.from({ length: count }, (_, index) => {
      const outcome = { next: vi.fn(), error: vi.fn(), complete: vi.fn() };
      subscriptions.push(http.get(`${dataUrl}/${index}`).subscribe(outcome));
      return outcome;
    });
  }

  function rejectInitialRequests() {
    const initialRequests = requests.match(request => request.url.startsWith(dataUrl));
    for (const request of initialRequests) {
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${expiredSession.token}`);
      request.flush({ message: 'Access token expired' }, { status: 401, statusText: 'Unauthorized' });
    }
    return initialRequests.length;
  }

  beforeEach(() => {
    const stored = new Map<string, string>();
    navigate = vi.fn().mockResolvedValue(true);
    subscriptions = [];
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate } },
        { provide: StorageService, useValue: {
          getItem: (key: string) => stored.get(key) ?? null,
          setItem: (key: string, value: string) => stored.set(key, value),
          removeItem: (key: string) => stored.delete(key),
          getSessionItem: (key: string) => stored.get(key) ?? null,
          setSessionItem: (key: string, value: string) => { stored.set(key, value); return true; },
          clearSessionItems: (prefix: string) => {
            for (const key of [...stored.keys()]) if (key.startsWith(prefix)) stored.delete(key);
          },
          clear: () => stored.clear(),
        } },
      ],
    });
    http = TestBed.inject(HttpClient);
    requests = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    tokens = TestBed.inject(TokenService);
    permissions = TestBed.inject(PermissionService);
    const now = Math.floor(Date.now() / 1000);
    const tenHoursAgo = now - 10 * 3600;
    expiredSession = {
      token: token(tenHoursAgo, 8), refreshToken: token(tenHoursAgo, 168),
      userId: 42, email: 'audit@example.invalid', displayName: 'Audit', role: 'admin', tenantId: 7,
    };
    renewedSession = {
      ...expiredSession, token: token(now, 8, 'viewer'), refreshToken: token(now, 168), role: 'viewer',
    };
    auth.applySession(expiredSession);
  });

  afterEach(() => {
    subscriptions.forEach(subscription => subscription.unsubscribe());
    requests.verify();
  });

  it('uses one refresh and retries all three data requests after ten hours', () => {
    const outcomes = startDataRequests();
    expect(rejectInitialRequests()).toBe(3);
    const refresh = requests.expectOne(refreshUrl);
    expect(refresh.request.body).toEqual({ refreshToken: expiredSession.refreshToken });
    refresh.flush(renewedSession);

    const retries = requests.match(request => request.url.startsWith(dataUrl));
    expect(retries).toHaveLength(3);
    retries.forEach(request => {
      expect(request.request.headers.get('Authorization')).toBe(`Bearer ${renewedSession.token}`);
      request.flush({ items: ['fresh-data'] });
    });
    outcomes.forEach(outcome => {
      expect(outcome.next).toHaveBeenCalledWith({ items: ['fresh-data'] });
      expect(outcome.complete).toHaveBeenCalledOnce();
      expect(outcome.error).not.toHaveBeenCalled();
    });
    expect(tokens.getRefreshToken()).toBe(renewedSession.refreshToken);
    expect(auth.getCurrentUser()?.role).toBe('viewer');
    expect(permissions.isAdminUser).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not refresh until a data endpoint actually rejects the old token', () => {
    requests.expectNone(refreshUrl);
    const [outcome] = startDataRequests(1);
    requests.expectOne(`${dataUrl}/0`).flush({ items: ['public-data'] });
    expect(outcome.next).toHaveBeenCalledOnce();
    requests.expectNone(refreshUrl);
    expect(tokens.getAccessToken()).toBe(expiredSession.token);
  });

  it('clears tokens and redirects when the refresh token is absent', () => {
    tokens.clearTokens();
    tokens.setAccessToken(expiredSession.token);
    const [outcome] = startDataRequests(1);
    rejectInitialRequests();
    expect(outcome.error).toHaveBeenCalledOnce();
    expect(tokens.getAccessToken()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/auth/login']);
    requests.expectNone(refreshUrl);
  });

  it('rejects the first data request and clears tokens when refresh has expired', () => {
    const [outcome] = startDataRequests(1);
    rejectInitialRequests();
    requests.expectOne(refreshUrl).flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(outcome.error).toHaveBeenCalledOnce();
    expect(tokens.getAccessToken()).toBeNull();
    expect(tokens.getRefreshToken()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  it('does not refresh or log out on a forbidden data response', () => {
    const [outcome] = startDataRequests(1);
    requests.expectOne(`${dataUrl}/0`).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(outcome.error).toHaveBeenCalledOnce();
    requests.expectNone(refreshUrl);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not recursively refresh when login itself returns unauthorized', () => {
    const error = vi.fn();
    subscriptions.push(auth.login({ email: 'audit@example.invalid', password: 'invalid-password' })
      .subscribe({ error }));
    requests.expectOne(`${environment.controlPlaneApiUrl}/auth/login`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(error).toHaveBeenCalledOnce();
    requests.expectNone(refreshUrl);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('all queued requests terminate when refresh fails', () => {
    const outcomes = startDataRequests();
    rejectInitialRequests();
    requests.expectOne(refreshUrl).flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(outcomes.map(outcome => outcome.error.mock.calls.length)).toEqual([1, 1, 1]);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('failed refresh clears cached user and permissions', () => {
    startDataRequests(1);
    rejectInitialRequests();
    requests.expectOne(refreshUrl).flush({}, { status: 401, statusText: 'Unauthorized' });
    expect({ user: auth.getCurrentUser(), admin: permissions.isAdminUser })
      .toEqual({ user: null, admin: false });
  });

  it('a preferences-only 401 after idle refreshes the session', () => {
    subscriptions.push(http.get(`${environment.controlPlaneApiUrl}/preferences`).subscribe({ error: vi.fn() }));
    requests.expectOne(`${environment.controlPlaneApiUrl}/preferences`)
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    const refreshRequests = requests.match(refreshUrl);
    refreshRequests.forEach(request => request.flush({}, { status: 401, statusText: 'Unauthorized' }));
    expect(refreshRequests).toHaveLength(1);
  });

  it('a data failure after successful refresh does not destroy the new session', () => {
    startDataRequests(1);
    rejectInitialRequests();
    requests.expectOne(refreshUrl).flush(renewedSession);
    requests.expectOne(`${dataUrl}/0`).flush({}, { status: 503, statusText: 'Service Unavailable' });
    expect(tokens.getAccessToken()).toBe(renewedSession.token);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('terminates every waiter on timeout, preserves the session and allows another attempt', async () => {
    vi.useFakeTimers();
    try {
      const outcomes = startDataRequests();
      rejectInitialRequests();
      const timedOut = requests.expectOne(refreshUrl);
      await vi.advanceTimersByTimeAsync(15_001);
      expect(timedOut.cancelled).toBe(true);
      outcomes.forEach(outcome => expect(outcome.error).toHaveBeenCalledOnce());
      expect(tokens.getRefreshToken()).toBe(expiredSession.refreshToken);
      expect(navigate).not.toHaveBeenCalled();

      const [retry] = startDataRequests(1);
      rejectInitialRequests();
      requests.expectOne(refreshUrl).flush(renewedSession);
      requests.expectOne(`${dataUrl}/0`).flush({ items: [] });
      expect(retry.complete).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([0, 500, 503])('terminates all waiters without logout on transient refresh status %s', status => {
    const outcomes = startDataRequests();
    rejectInitialRequests();
    const refresh = requests.expectOne(refreshUrl);
    if (status === 0) refresh.error(new ProgressEvent('error'));
    else refresh.flush({}, { status, statusText: 'Server Error' });
    outcomes.forEach(outcome => expect(outcome.error).toHaveBeenCalledOnce());
    expect(tokens.getAccessToken()).toBe(expiredSession.token);
    expect(auth.getCurrentUser()).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not cancel the shared refresh when its initiating data subscriber unsubscribes', () => {
    const outcomes = startDataRequests();
    rejectInitialRequests();
    const refresh = requests.expectOne(refreshUrl);
    subscriptions[0].unsubscribe();
    expect(refresh.cancelled).toBe(false);
    refresh.flush(renewedSession);
    const retries = requests.match(request => request.url.startsWith(dataUrl));
    expect(retries).toHaveLength(2);
    retries.forEach(request => request.flush({ items: [] }));
    expect(outcomes[0].next).not.toHaveBeenCalled();
    expect(outcomes[1].complete).toHaveBeenCalledOnce();
    expect(outcomes[2].complete).toHaveBeenCalledOnce();
  });

  it('does not restore the session or retry data after logout during refresh', () => {
    const outcomes = startDataRequests();
    rejectInitialRequests();
    auth.logout();
    requests.expectOne(`${environment.controlPlaneApiUrl}/auth/logout`).flush(null, { status: 204, statusText: 'No Content' });
    requests.expectOne(refreshUrl).flush(renewedSession);
    outcomes.forEach(outcome => expect(outcome.error).toHaveBeenCalledOnce());
    expect(tokens.getAccessToken()).toBeNull();
    expect(auth.getCurrentUser()).toBeNull();
    requests.expectNone(request => request.url.startsWith(dataUrl));
  });

  it('does not refresh or clear a new session when logout returns a late 401', () => {
    auth.logout();
    const logout = requests.expectOne(`${environment.controlPlaneApiUrl}/auth/logout`);
    expect(logout.request.method).toBe('POST');
    expect(logout.request.body).toEqual({ refreshToken: expiredSession.refreshToken });
    expect(logout.request.headers.has('Authorization')).toBe(false);
    expect(tokens.getAccessToken()).toBeNull();
    expect(tokens.getRefreshToken()).toBeNull();
    auth.applySession(renewedSession);

    logout.flush({}, { status: 401, statusText: 'Unauthorized' });

    requests.expectNone(refreshUrl);
    expect(tokens.getAccessToken()).toBe(renewedSession.token);
    expect(tokens.getRefreshToken()).toBe(renewedSession.refreshToken);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reuses the renewed token for a late 401 without refreshing twice', () => {
    const outcomes = startDataRequests(2);
    const initial = requests.match(request => request.url.startsWith(dataUrl));
    initial[0].flush({}, { status: 401, statusText: 'Unauthorized' });
    requests.expectOne(refreshUrl).flush(renewedSession);
    requests.expectOne(`${dataUrl}/0`).flush({ items: [] });
    initial[1].flush({}, { status: 401, statusText: 'Unauthorized' });
    const retry = requests.expectOne(`${dataUrl}/1`);
    expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${renewedSession.token}`);
    retry.flush({ items: [] });
    requests.expectNone(refreshUrl);
    outcomes.forEach(outcome => expect(outcome.complete).toHaveBeenCalledOnce());
  });

  describe.each(['refresh', 'already-renewed'] as const)('%s retry', retryPath => {
    function startRetry() {
      const [outcome] = startDataRequests(1);
      if (retryPath === 'already-renewed') auth.applySession(renewedSession);
      rejectInitialRequests();
      if (retryPath === 'refresh') requests.expectOne(refreshUrl).flush(renewedSession);
      requests.expectNone(refreshUrl);
      const retry = requests.expectOne(`${dataUrl}/0`);
      expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${renewedSession.token}`);
      return { outcome, retry };
    }

    it('clears the session and redirects once on 401 without refreshing again', () => {
      const { outcome, retry } = startRetry();
      retry.flush({}, { status: 401, statusText: 'Unauthorized' });
      expect(outcome.error).toHaveBeenCalledOnce();
      requests.expectNone(refreshUrl);
      expect(tokens.getAccessToken()).toBeNull();
      expect(tokens.getRefreshToken()).toBeNull();
      expect(auth.getCurrentUser()).toBeNull();
      expect(permissions.isAdminUser).toBe(false);
      expect(navigate).toHaveBeenCalledExactlyOnceWith(['/auth/login']);
    });

    it.each([0, 403, 500, 503])('preserves the session on retry status %s', status => {
      const { outcome, retry } = startRetry();
      if (status === 0) retry.error(new ProgressEvent('error'));
      else retry.flush({}, { status, statusText: 'Request Failed' });
      expect(outcome.error).toHaveBeenCalledOnce();
      expect(tokens.getAccessToken()).toBe(renewedSession.token);
      expect(tokens.getRefreshToken()).toBe(renewedSession.refreshToken);
      expect(navigate).not.toHaveBeenCalled();
      requests.expectNone(refreshUrl);
    });

    it.each(['access-token', 'refresh-token'] as const)(
      'preserves a newer session when its %s changed before the retry 401', changedToken => {
        const { outcome, retry } = startRetry();
        const newerSession = {
          ...renewedSession,
          token: changedToken === 'access-token' ? 'newer-access-token' : renewedSession.token,
          refreshToken: changedToken === 'refresh-token' ? 'newer-refresh-token' : renewedSession.refreshToken,
        };
        auth.applySession(newerSession);
        retry.flush({}, { status: 401, statusText: 'Unauthorized' });
        expect(outcome.error).toHaveBeenCalledOnce();
        expect(tokens.getAccessToken()).toBe(newerSession.token);
        expect(tokens.getRefreshToken()).toBe(newerSession.refreshToken);
        expect(auth.getCurrentUser()).not.toBeNull();
        expect(navigate).not.toHaveBeenCalled();
        requests.expectNone(refreshUrl);
      },
    );
  });

  it('redirects only once when concurrent retries all return 401', () => {
    const outcomes = startDataRequests();
    rejectInitialRequests();
    requests.expectOne(refreshUrl).flush(renewedSession);
    const retries = requests.match(request => request.url.startsWith(dataUrl));
    expect(retries).toHaveLength(3);
    retries.forEach(request => request.flush({}, { status: 401, statusText: 'Unauthorized' }));
    outcomes.forEach(outcome => expect(outcome.error).toHaveBeenCalledOnce());
    expect(tokens.getAccessToken()).toBeNull();
    expect(tokens.getRefreshToken()).toBeNull();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(['/auth/login']);
    requests.expectNone(refreshUrl);
  });

  it('does not renew the session for an unrelated server', () => {
    const error = vi.fn();
    subscriptions.push(http.get('https://unrelated.example.invalid/data').subscribe({ error }));
    requests.expectOne('https://unrelated.example.invalid/data')
      .flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(error).toHaveBeenCalledOnce();
    requests.expectNone(refreshUrl);
    expect(navigate).not.toHaveBeenCalled();
  });
});