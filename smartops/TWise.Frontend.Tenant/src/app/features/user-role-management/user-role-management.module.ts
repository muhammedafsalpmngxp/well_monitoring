import { NgModule } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { SharedModule } from '../../shared/shared.module';
import { UserRoleManagementRoutingModule } from './user-role-management-routing.module';
import { UsersComponent } from './users/users.component';
import { RolesPermissionsComponent } from './roles-permissions/roles-permissions.component';
import { EmployeeCellRendererComponent } from './users/cell-renderers/employee-cell-renderer.component';
import { RoleCellRendererComponent } from './users/cell-renderers/role-cell-renderer.component';
import { StatusCellRendererComponent } from './users/cell-renderers/status-cell-renderer.component';
import { ActionsCellRendererComponent } from './users/cell-renderers/actions-cell-renderer.component';
import { CreateUserModalComponent } from './users/create-user-modal/create-user-modal.component';
import { ResetPasswordModalComponent } from './users/reset-password-modal/reset-password-modal.component';

@NgModule({
  declarations: [UsersComponent, RolesPermissionsComponent, CreateUserModalComponent, ResetPasswordModalComponent],
  imports: [
    SharedModule,
    UserRoleManagementRoutingModule,
    AgGridAngular,
    IconComponent,
    EmployeeCellRendererComponent,
    RoleCellRendererComponent,
    StatusCellRendererComponent,
    ActionsCellRendererComponent,
  ],
})
export class UserRoleManagementModule {}
