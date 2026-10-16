import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { permissionGuard } from './permission.guard';
import { PermissionService } from '../services/permission.service';
import { ROUTES } from '../constants/route.constants';

describe('permissionGuard', () => {
  let permissionService: { canView: ReturnType<typeof vi.fn> };
  let router: Router;

  beforeEach(() => {
    permissionService = { canView: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: PermissionService, useValue: permissionService },
      ],
    });

    router = TestBed.inject(Router);
    vi.spyOn(router, 'createUrlTree');
  });

  function runGuard(permission?: string | string[]): boolean | ReturnType<typeof router.createUrlTree> {
    const route = { data: permission ? { permission } : {} } as unknown as ActivatedRouteSnapshot;
    const state = {} as RouterStateSnapshot;
    return TestBed.runInInjectionContext(() => permissionGuard(route, state)) as any;
  }

  it('should allow access when user has view permission', () => {
    permissionService.canView.mockReturnValue(true);
    expect(runGuard('user-management.users')).toBe(true);
  });

  it('should redirect to dashboard when user lacks permission', () => {
    permissionService.canView.mockReturnValue(false);
    const result = runGuard('user-management.users');
    expect(router.createUrlTree).toHaveBeenCalledWith([`/${ROUTES.DASHBOARD}`]);
    expect(result).not.toBe(true);
  });

  it('should allow access when no permission data is configured', () => {
    expect(runGuard()).toBe(true);
    expect(permissionService.canView).not.toHaveBeenCalled();
  });

  it('should block users page for unauthorized users', () => {
    permissionService.canView.mockReturnValue(false);
    const result = runGuard('user-management.users');
    expect(result).not.toBe(true);
  });

  it('should block roles page for unauthorized users', () => {
    permissionService.canView.mockReturnValue(false);
    const result = runGuard('user-management.roles');
    expect(result).not.toBe(true);
  });

  it('should block settings page for unauthorized users', () => {
    permissionService.canView.mockReturnValue(false);
    const result = runGuard('settings.general');
    expect(result).not.toBe(true);
  });

  it('should block settings database-view for unauthorized users', () => {
    permissionService.canView.mockReturnValue(false);
    const result = runGuard('settings.database-view');
    expect(result).not.toBe(true);
  });

  it('should block user-role-management parent route for unauthorized users', () => {
    permissionService.canView.mockReturnValue(false);
    const result = runGuard('user-management');
    expect(result).not.toBe(true);
  });

  it('should block settings parent route for unauthorized users', () => {
    permissionService.canView.mockReturnValue(false);
    const result = runGuard('settings');
    expect(result).not.toBe(true);
  });

  it('lets in a user who may view any one of several listed modules', () => {
    permissionService.canView.mockImplementation((code: string) => code === 'model.standard-datasets');
    expect(runGuard(['model.studio', 'model.standard-datasets'])).toBe(true);
    permissionService.canView.mockReturnValue(false);
    expect(runGuard(['model.studio', 'model.standard-datasets'])).not.toBe(true);
  });
});
