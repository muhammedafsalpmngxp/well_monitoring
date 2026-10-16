import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { StandardBoardsComponent } from './standard-boards/standard-boards.component';
import { WipBoardsComponent } from './wip-boards/wip-boards.component';
import { DashboardBuilderComponent } from './dashboard-builder/dashboard-builder.component';
import { OperationsDashboardComponent } from './operations-dashboard/operations-dashboard.component';
import { BoardBuilderComponent } from './board-builder/board-builder.component';
import { BoardBuilderTestComponent } from './board-builder-test/board-builder-test.component';
import { ActivityBreakdownComponent } from './activity-breakdown/activity-breakdown.component';
import { permissionGuard } from '../../core/guards/permission.guard';

const routes: Routes = [
  { path: '',                     redirectTo: 'standard-boards', pathMatch: 'full' },
  { path: 'standard-boards',      component: StandardBoardsComponent, canActivate: [permissionGuard], data: { permission: 'dashboard.standard-boards' } },
  { path: 'wip-boards',           component: WipBoardsComponent, canActivate: [permissionGuard], data: { permission: 'dashboard.wip-boards' } },
  { path: 'crew-calendar',        component: ActivityBreakdownComponent, canActivate: [permissionGuard], data: { permission: 'dashboard.standard-boards' } },
  { path: 'builder',              component: DashboardBuilderComponent, canActivate: [permissionGuard], runGuardsAndResolvers: 'always', data: { permission: 'dashboard.wip-boards', permissionAction: 'build' } },
  { path: 'builder/:id',          component: DashboardBuilderComponent, canActivate: [permissionGuard], runGuardsAndResolvers: 'always', data: { permission: 'dashboard.wip-boards', permissionAction: 'build' } },
  { path: 'operations-dashboard/:id', component: OperationsDashboardComponent, canActivate: [permissionGuard], runGuardsAndResolvers: 'always', data: { permission: 'dashboard.standard-boards', permissionByContext: { wip: 'dashboard.wip-boards' } } },
  { path: 'shared/:id',               component: OperationsDashboardComponent, canActivate: [permissionGuard], data: { permission: 'dashboard.wip-boards' } },
  { path: 'public/:id',               component: OperationsDashboardComponent },
  { path: 'board-builder',            component: BoardBuilderComponent, canActivate: [permissionGuard], runGuardsAndResolvers: 'always', data: { permission: 'dashboard.wip-boards', permissionAction: 'build' } },
  { path: 'board-builder-test',       component: BoardBuilderTestComponent, canActivate: [permissionGuard], runGuardsAndResolvers: 'always', data: { permission: 'dashboard.wip-boards', permissionAction: 'build' } },
  { path: 'activity-breakdown/:wellId', component: ActivityBreakdownComponent, canActivate: [permissionGuard], data: { permission: 'dashboard.standard-boards' } },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class DashboardRoutingModule {}
