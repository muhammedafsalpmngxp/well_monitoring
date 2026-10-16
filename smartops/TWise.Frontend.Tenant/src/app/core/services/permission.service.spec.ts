import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionService } from './permission.service';
import { TokenService } from './token.service';

function makeJwt(payload: object): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

describe('PermissionService', () => {
  let service: PermissionService;
  let tokenService: { getAccessToken: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    tokenService = { getAccessToken: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        PermissionService,
        { provide: TokenService, useValue: tokenService },
      ],
    });

    service = TestBed.inject(PermissionService);
  });

  describe('admin user', () => {
    beforeEach(() => {
      tokenService.getAccessToken.mockReturnValue(
        makeJwt({ role: 'admin', perm: [] })
      );
      service.loadFromToken();
    });

    it('should identify as admin', () => {
      expect(service.isAdminUser).toBe(true);
    });

    it('should bypass all permission checks', () => {
      expect(service.canView('user-management.users')).toBe(true);
      expect(service.canView('user-management.roles')).toBe(true);
      expect(service.canView('settings.general')).toBe(true);
      expect(service.canView('settings.database-view')).toBe(true);
      expect(service.canView('nonexistent.module')).toBe(true);
    });
  });

  describe('regular user with specific permissions', () => {
    beforeEach(() => {
      tokenService.getAccessToken.mockReturnValue(
        makeJwt({
          role: 'operator',
          perm: ['dashboard:vcm', 'reports:vc'],
        })
      );
      service.loadFromToken();
    });

    it('should NOT be admin', () => {
      expect(service.isAdminUser).toBe(false);
    });

    it('should BLOCK users page (no user-management.users permission)', () => {
      expect(service.canView('user-management.users')).toBe(false);
    });

    it('should BLOCK roles page (no user-management.roles permission)', () => {
      expect(service.canView('user-management.roles')).toBe(false);
    });

    it('should BLOCK settings page (no settings.general permission)', () => {
      expect(service.canView('settings.general')).toBe(false);
    });

    it('should BLOCK settings parent (no settings permission)', () => {
      expect(service.canView('settings')).toBe(false);
    });

    it('should BLOCK user-management parent (no user-management permission)', () => {
      expect(service.canView('user-management')).toBe(false);
    });

    it('should ALLOW dashboard (has dashboard:vcm)', () => {
      expect(service.canView('dashboard')).toBe(true);
    });

    it('should ALLOW reports (has reports:vc)', () => {
      expect(service.canView('reports')).toBe(true);
    });
  });

  describe('user with user-management permissions only', () => {
    beforeEach(() => {
      tokenService.getAccessToken.mockReturnValue(
        makeJwt({
          role: 'user-admin',
          perm: ['user-management:vcma', 'user-management.users:vcm', 'user-management.roles:v'],
        })
      );
      service.loadFromToken();
    });

    it('should ALLOW user-management parent', () => {
      expect(service.canView('user-management')).toBe(true);
    });

    it('should ALLOW users page', () => {
      expect(service.canView('user-management.users')).toBe(true);
    });

    it('should ALLOW roles page (view only)', () => {
      expect(service.canView('user-management.roles')).toBe(true);
    });

    it('should NOT allow create on roles page', () => {
      expect(service.canCreate('user-management.roles')).toBe(false);
    });

    it('should BLOCK settings', () => {
      expect(service.canView('settings')).toBe(false);
      expect(service.canView('settings.general')).toBe(false);
    });
  });

  describe('no token', () => {
    beforeEach(() => {
      tokenService.getAccessToken.mockReturnValue(null);
      service.loadFromToken();
    });

    it('should block all module access', () => {
      expect(service.canView('user-management.users')).toBe(false);
      expect(service.canView('user-management.roles')).toBe(false);
      expect(service.canView('settings')).toBe(false);
      expect(service.canView('settings.general')).toBe(false);
    });
  });
});
