import { HttpInterceptorFn, HttpErrorResponse, HttpRequest } from '@angular/common/http';
import { Location } from '@angular/common';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { TokenService } from '../services/token.service';
import { SessionRefreshService } from '../services/session-refresh.service';
import { environment } from '../../../environments/environment';

/**
 * On 401, attempts a one-time token refresh and retries the request.
 * Clears the session when renewal fails or the current credentials are still unauthorized.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const tokenService = inject(TokenService);
  const sessionRefresh = inject(SessionRefreshService);
  const isPublicDashboard = /^\/shared-dashboard\/public\/[^/?#]+(?:[/?#]|$)/.test(inject(Location).path());

  if (isPublicDashboard) return next(req);

  const retryWithToken = (token: string) => {
    const refreshToken = tokenService.getRefreshToken();
    return next(withBearer(req, token)).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401 && tokenService.getAccessToken() === token
          && tokenService.getRefreshToken() === refreshToken) {
          sessionRefresh.endSession();
        }
        return throwError(() => error);
      }),
    );
  };

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      const isAuthCall = req.url.includes('/auth/login') || req.url.includes('/auth/refresh-token')
        || req.url.includes('/auth/logout');
      const isApiCall = [environment.controlPlaneApiUrl, environment.tenantApiUrl]
        .some(baseUrl => req.url === baseUrl || req.url.startsWith(`${baseUrl}/`));

      if (error.status !== 401 || isAuthCall || !isApiCall) {
        return throwError(() => error);
      }

      if (!tokenService.getRefreshToken()) {
        sessionRefresh.endSession();
        return throwError(() => error);
      }

      const currentToken = tokenService.getAccessToken();
      const sentAuthorization = req.headers.get('Authorization');
      if (currentToken && sentAuthorization && sentAuthorization !== `Bearer ${currentToken}`) {
        return retryWithToken(currentToken);
      }

      return sessionRefresh.refresh().pipe(
        switchMap(newToken => retryWithToken(newToken)),
      );
    }),
  );
};

function withBearer(req: HttpRequest<unknown>, token: string): HttpRequest<unknown> {
  return req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
}
