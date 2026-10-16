import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PermissionService } from '../services/permission.service';
import { ROUTES } from '../constants/route.constants';

/** Tenant-admin-only screens (e.g. Settings → Learn Videos). Non-admins are sent to the dashboard. */
export const adminGuard: CanActivateFn = () => {
  const permissionService = inject(PermissionService);
  const router = inject(Router);
  return permissionService.isAdminUser ? true : router.createUrlTree([`/${ROUTES.DASHBOARD}`]);
};
