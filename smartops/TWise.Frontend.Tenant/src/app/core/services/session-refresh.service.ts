import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { EMPTY, Observable, catchError, exhaustMap, filter, finalize, fromEvent, map, merge, shareReplay, switchMap, tap, throwError, timeout, timer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { APP_CONSTANTS } from '../constants/app.constants';
import { ROUTES } from '../constants/route.constants';
import { LoginResponse } from '../models/user.model';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

@Injectable({ providedIn: 'root' })
export class SessionRefreshService {
  private refreshRequest?: Observable<string>;
  private redirectingToLogin = false;
  private monitoring = false;
  private monitoredToken: string | null = null;
  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly http: HttpClient,
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly router: Router,
  ) {}

  startMonitoring(): void {
    if (this.monitoring) return;
    this.monitoring = true;
    this.monitoredToken = this.tokens.getAccessToken();
    const checkInterval = 60_000;
    let lastCheckAt: number | null = null;

    const readToken = () => {
      const token = this.tokens.getAccessToken();
      if (!token && this.monitoredToken) {
        this.monitoredToken = null;
        lastCheckAt = null;
        this.endSession();
      }
      this.monitoredToken = token;
      return token;
    };

    merge(
      timer(0),
      fromEvent(window, 'focus'),
      fromEvent(document, 'visibilitychange'),
      fromEvent<StorageEvent>(window, 'storage').pipe(
        filter(event => event.storageArea === window.localStorage
          && (event.key === null || event.key === APP_CONSTANTS.STORAGE_KEYS.ACCESS_TOKEN)),
      ),
    ).pipe(
      tap(() => readToken()),
      switchMap(() => {
        if (document.visibilityState !== 'visible') return EMPTY;
        const delay = lastCheckAt === null ? 0 : Math.max(0, checkInterval - (Date.now() - lastCheckAt));
        return timer(delay, checkInterval);
      }),
      exhaustMap(() => {
        if (!readToken() || document.visibilityState !== 'visible') return EMPTY;
        lastCheckAt = Date.now();
        return this.http.get<void>(`${environment.controlPlaneApiUrl}/auth/session`).pipe(
          timeout({ first: 15_000 }),
          catchError(() => EMPTY),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe();
  }

  refresh(): Observable<string> {
    if (this.refreshRequest) return this.refreshRequest;

    const refreshToken = this.tokens.getRefreshToken();
    if (!refreshToken) {
      this.endSession();
      return throwError(() => new Error('No refresh token available.'));
    }

    this.redirectingToLogin = false;
    const request = this.http.post<LoginResponse>(
      `${environment.controlPlaneApiUrl}/auth/refresh-token`, { refreshToken },
    ).pipe(
      timeout({ first: 15_000 }),
      map(response => {
        if (this.tokens.getRefreshToken() !== refreshToken) {
          throw new Error('The session changed while token renewal was in progress.');
        }
        try {
          this.auth.applySession(response);
        } catch (error) {
          this.endSession();
          throw error;
        }
        return response.token;
      }),
      catchError(error => {
        if (error instanceof HttpErrorResponse && [400, 401, 403].includes(error.status)
          && this.tokens.getRefreshToken() === refreshToken) {
          this.endSession();
        }
        return throwError(() => error);
      }),
      finalize(() => {
        if (this.refreshRequest === request) this.refreshRequest = undefined;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.refreshRequest = request;
    return request;
  }

  endSession(): void {
    const hadSession = !!this.tokens.getAccessToken() || !!this.tokens.getRefreshToken();
    this.auth.clearSession();
    if (!this.redirectingToLogin || hadSession) {
      this.redirectingToLogin = true;
      void this.router.navigate([`/${ROUTES.AUTH.ROOT}/${ROUTES.AUTH.LOGIN}`]);
    }
  }
}