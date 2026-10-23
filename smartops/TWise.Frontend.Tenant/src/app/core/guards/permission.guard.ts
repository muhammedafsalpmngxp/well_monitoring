import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PermissionService } from '../services/permission.service';
import { ROUTES } from '../constants/route.constants';
import { MENU_STRUCTURE } from '../constants/menu.constants';

// The dashboard when the user may open it, otherwise the first menu page they may open (avoids a redirect loop).
function fallbackRoute(permissionService: PermissionService): string {
  const dashboard = `/${ROUTES.DASHBOARD}`;
  if (permissionService.canView('dashboard.standard-boards')) return dashboard;
  const pages = MENU_STRUCTURE.flatMap(group => group.items.flatMap(item => item.children ?? []));
  const page = pages.find(child => child.route && child.moduleCode && !child.hidden && !child.adminOnly
    && permissionService.canView(child.moduleCode));
  return page?.route ?? dashboard;
}

export const permissionGuard: CanActivateFn = (route, _state) => {
  const permissionService = inject(PermissionService);
  const router = inject(Router);

  // One module code, or a list of codes of which any one grants the page.
  const context = `${route.queryParams?.['type'] === 'tile' ? 'tile-' : ''}${route.queryParams?.['from'] === 'wip' ? 'wip' : 'standard'}`;
  const required = (route.data?.['permissionByContext']?.[context] ?? route.data?.['permission']) as string | string[] | undefined;
  if (!required) return true;

  const editing = ['id', 'editId', 'dashboardId'].some(key => !!(route.params?.[key] || route.queryParams?.[key]));
  const builder = route.data?.['permissionAction'] === 'build';
  if ((Array.isArray(required) ? required : [required]).some(code => permissionService.canView(code)
    && (!builder || (editing ? permissionService.canModify(code) : permissionService.canCreate(code))))) return true;

  return router.createUrlTree([fallbackRoute(permissionService)]);
};
