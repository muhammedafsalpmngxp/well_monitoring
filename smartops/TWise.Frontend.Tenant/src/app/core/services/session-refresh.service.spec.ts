import { Location } from '@angular/common';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { environment } from '../../../environments/environment';
import { APP_CONSTANTS } from '../constants/app.constants';
import { errorInterceptor } from '../interceptors/error.interceptor';
import { LoginResponse } from '../models/user.model';
import { AuthService } from './auth.service';
import { SessionRefreshService } from './session-refresh.service';
import { TokenService } from './token.service';

describe('SessionRefreshService monitoring', () => {
  const sessionUrl = `${environment.controlPlaneApiUrl}/auth/session`;
  const refreshUrl = `${environment.controlPlaneApiUrl}/auth/refresh-token`;
  let service: SessionRefreshService;
  let http: HttpTestingController;
  let accessToken: string | null;
  let refreshToken: string | null;
  let visibility: DocumentVisibilityState;
  let logout: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  const storageEvent = (key: string | null = APP_CONSTANTS.STORAGE_KEYS.ACCESS_TOKEN) => {
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: window.localStorage }));
  };

  const setVisibility = (state: DocumentVisibilityState) => {
    visibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  const start = () => {
    service.startMonitoring();
    vi.advanceTimersByTime(1);
  };

  const completeCheck = () => http.expectOne(sessionUrl).flush(null, { status: 204, statusText: 'No Content' });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T00:00:00Z'));
    accessToken = 'access-token';
    refreshToken = 'refresh-token';
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    logout = vi.fn(() => { accessToken = null; refreshToken = null; });
    navigate = vi.fn().mockResolvedValue(true);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        SessionRefreshService,
        { provide: Location, useValue: { path: () => '/dashboard/crew-calendar' } },
        { provide: Router, useValue: { navigate } },
        { provide: TokenService, useValue: {
          getAccessToken: () => accessToken,
          getRefreshToken: () => refreshToken,
        } },
        { provide: AuthService, useValue: {
          clearSession: logout,
          applySession: (response: LoginResponse) => {
            accessToken = response.token;
            refreshToken = response.refreshToken;
          },
        } },
      ],
    });
    service = TestBed.inject(SessionRefreshService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('checks initially and once per minute, not every five seconds', () => {
    start();
    completeCheck();
    vi.advanceTimersByTime(59_999);
    expect(http.match(sessionUrl)).toHaveLength(0);
    vi.advanceTimersByTime(1);
    completeCheck();
    vi.advanceTimersByTime(60_000);
    completeCheck();
  });

  it('does not duplicate monitoring when started twice', () => {
    start();
    service.startMonitoring();
    completeCheck();
    vi.advanceTimersByTime(60_000);
    completeCheck();
    expect(logout).not.toHaveBeenCalled();
  });

  it('deduplicates focus and visibility events without postponing the next check', () => {
    start();
    completeCheck();
    vi.advanceTimersByTime(10_000);
    window.dispatchEvent(new Event('focus'));
    setVisibility('visible');
    vi.advanceTimersByTime(49_999);
    expect(http.match(sessionUrl)).toHaveLength(0);
    vi.advanceTimersByTime(1);
    completeCheck();
  });

  it('pauses hidden-tab checks and resumes immediately when stale', () => {
    start();
    completeCheck();
    setVisibility('hidden');
    vi.advanceTimersByTime(125_000);
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(1);
    expect(http.match(sessionUrl)).toHaveLength(0);
    setVisibility('visible');
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(1);
    completeCheck();
    vi.advanceTimersByTime(60_000);
    completeCheck();
  });

  it('does not check on startup while hidden', () => {
    visibility = 'hidden';
    start();
    vi.advanceTimersByTime(120_000);
    expect(http.match(sessionUrl)).toHaveLength(0);
    setVisibility('visible');
    vi.advanceTimersByTime(1);
    completeCheck();
  });

  it('does not cancel an in-flight request when tab events arrive', () => {
    start();
    const request = http.expectOne(sessionUrl);
    window.dispatchEvent(new Event('focus'));
    setVisibility('hidden');
    expect(request.cancelled).toBe(false);
    request.flush(null, { status: 204, statusText: 'No Content' });
    setVisibility('visible');
    vi.advanceTimersByTime(1);
    http.expectNone(sessionUrl);
  });

  it('does not make requests without a token and detects a later login', () => {
    accessToken = null;
    refreshToken = null;
    start();
    http.expectNone(sessionUrl);
    expect(logout).not.toHaveBeenCalled();
    accessToken = 'new-login';
    refreshToken = 'new-refresh';
    vi.advanceTimersByTime(60_000);
    completeCheck();
  });

  it('handles cross-tab logout immediately while hidden and a request is in flight', () => {
    start();
    const request = http.expectOne(sessionUrl);
    setVisibility('hidden');
    accessToken = null;
    refreshToken = null;
    storageEvent();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    request.flush(null, { status: 204, statusText: 'No Content' });
    storageEvent();
    vi.advanceTimersByTime(120_000);
    expect(logout).toHaveBeenCalledTimes(1);
    http.expectNone(sessionUrl);
  });

  it('handles storage.clear in another tab', () => {
    start();
    completeCheck();
    accessToken = null;
    refreshToken = null;
    storageEvent(null);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('does not log out or immediately poll when a token is replaced', () => {
    start();
    completeCheck();
    accessToken = 'renewed-token';
    storageEvent();
    storageEvent(APP_CONSTANTS.STORAGE_KEYS.THEME);
    vi.advanceTimersByTime(1);
    expect(logout).not.toHaveBeenCalled();
    http.expectNone(sessionUrl);
  });

  it('keeps the monitor alive after a network error without rapid retries', () => {
    start();
    http.expectOne(sessionUrl).error(new ProgressEvent('error'));
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(59_999);
    http.expectNone(sessionUrl);
    expect(logout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    completeCheck();
  });

  it('refreshes an expired token and retries the session check through the interceptor', () => {
    start();
    http.expectOne(sessionUrl).flush(null, { status: 401, statusText: 'Unauthorized' });
    const refresh = http.expectOne(refreshUrl);
    expect(refresh.request.body).toEqual({ refreshToken: 'refresh-token' });
    refresh.flush({ token: 'renewed-access', refreshToken: 'renewed-refresh' });
    const retry = http.expectOne(sessionUrl);
    expect(retry.request.headers.get('Authorization')).toBe('Bearer renewed-access');
    retry.flush(null, { status: 204, statusText: 'No Content' });
    expect(logout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    completeCheck();
  });

  it('logs out when revoked credentials cannot be refreshed', () => {
    start();
    http.expectOne(sessionUrl).flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne(refreshUrl).flush(null, { status: 401, statusText: 'Unauthorized' });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    http.expectNone(sessionUrl);
  });

  it('cleans up timers and browser listeners on destruction', () => {
    start();
    completeCheck();
    TestBed.resetTestingModule();
    accessToken = null;
    storageEvent();
    window.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(120_000);
    expect(logout).not.toHaveBeenCalled();
    http.expectNone(sessionUrl);
    expect(vi.getTimerCount()).toBe(0);
  });
});