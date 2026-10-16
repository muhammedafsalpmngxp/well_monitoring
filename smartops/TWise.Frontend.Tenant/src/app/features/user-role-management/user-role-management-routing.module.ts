import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { UsersComponent } from './users/users.component';
import { RolesPermissionsComponent } from './roles-permissions/roles-permissions.component';
import { permissionGuard } from '../../core/guards/permission.guard';

const routes: Routes = [
  { path: '',                  redirectTo: 'users', pathMatch: 'full' },
  { path: 'users',             component: UsersComponent, canActivate: [permissionGuard], data: { permission: 'user-management.users' } },
  { path: 'roles-permissions', component: RolesPermissionsComponent, canActivate: [permissionGuard], data: { permission: 'user-management.roles' } },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class UserRoleManagementRoutingModule {}
