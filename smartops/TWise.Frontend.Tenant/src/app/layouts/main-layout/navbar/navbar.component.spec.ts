import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { User } from '../../../core/models/user.model';
import { AuthService } from '../../../core/services/auth.service';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { CommonApiService, SyncTimeResponse } from '../../../core/services/common-api.service';
import { NotificationRefreshService } from '../../../core/services/notification-refresh.service';
import { NotificationsAggregatorService } from '../../../core/services/notifications-aggregator.service';
import { PermissionService } from '../../../core/services/permission.service';
import { NavbarComponent } from './navbar.component';

function configureNavbar(user: User, getSyncTime: () => Observable<SyncTimeResponse>): void {
  TestBed.configureTestingModule({
    imports: [NavbarComponent],
    providers: [
      provideHttpClient(),
      provideRouter([]),
      { provide: AuthService, useValue: { getCurrentUser: () => user } },
      { provide: BreadcrumbService, useValue: { breadcrumbs: () => [] } },
      { provide: PermissionService, useValue: { grantedModuleCount: 0, accessLevelLabel: 'Read Only' } },
      { provide: NotificationsAggregatorService, useValue: { pollAll: vi.fn(() => of({ items: [] })) } },
      { provide: NotificationRefreshService, useValue: { refreshRequested$: new Subject<void>() } },
      { provide: CommonApiService, useValue: { getSyncTime: vi.fn(getSyncTime) } },
    ],
  });
}

function testUser(): User {
  return {
    userId: 10076,
    employeeId: null,
    email: 'profile@example.com',
    displayName: 'Profile User',
    role: 'viewer',
    tenantId: 7,
  };
}

function syncText(root: HTMLElement): string | undefined {
  return root.querySelector('.navbar__sync span')?.textContent?.trim();
}

describe('NavbarComponent employee profile', () => {
  let user: User;

  beforeEach(() => {
    user = testUser();
    configureNavbar(user, () => of({ omanTimestamp: '2026-10-20T02:15:11.926+04:00' }));
  });

  it.each([
    ['EMP00042', 'EMP00042'],
    ['00076', '00076'],
    [null, 'N/A'],
    [undefined, 'N/A'],
    ['', 'N/A'],
  ])('renders employee ID %s as %s instead of the user ID', (employeeId, expected) => {
    user.employeeId = employeeId;
    const fixture = TestBed.createComponent(NavbarComponent);
    fixture.componentInstance.isUserMenuOpen = true;
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    const row = root.querySelector('.navbar__profile-info-content');
    expect(row?.querySelector('.navbar__profile-info-label')?.textContent).toBe('Employee');
    expect(row?.querySelector('.navbar__profile-info-value')?.textContent?.trim()).toBe(expected);
  });
});

describe('NavbarComponent sync time', () => {
  it.each([
    ['2026-10-20T02:15:11.926+04:00', 'Synced • 10-20-2026, 02.15 AM'],
    ['2026-10-19T22:15:11Z', 'Synced • 10-20-2026, 02.15 AM'],
    ['2026-10-20T14:05:09+04:00', 'Synced • 10-20-2026, 02.05 PM'],
  ])('shows %s from the API in Oman time as "%s"', (omanTimestamp, expected) => {
    configureNavbar(testUser(), () => of({ omanTimestamp }));
    const fixture = TestBed.createComponent(NavbarComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    expect(syncText(fixture.nativeElement)).toBe(expected);
    expect(TestBed.inject(CommonApiService).getSyncTime).toHaveBeenCalledTimes(1);
  });

  it('shows an unavailable state when the sync time cannot be loaded', () => {
    configureNavbar(testUser(), () => throwError(() => new Error('404')));
    const fixture = TestBed.createComponent(NavbarComponent);
    fixture.detectChanges();
    fixture.detectChanges();

    expect(syncText(fixture.nativeElement)).toBe('Sync time unavailable');
  });

  it('stops polling the sync time when destroyed', () => {
    vi.useFakeTimers();
    try {
      configureNavbar(testUser(), () => of({ omanTimestamp: '2026-10-20T02:15:11+04:00' }));
      const fixture = TestBed.createComponent(NavbarComponent);
      fixture.detectChanges();
      const api = TestBed.inject(CommonApiService);

      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(api.getSyncTime).toHaveBeenCalledTimes(2);

      fixture.destroy();
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(api.getSyncTime).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
