import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { StandardReportsComponent } from './standard-reports/standard-reports.component';
import { MyReportsComponent } from './my-reports/my-reports.component';
import { ReportBuilderComponent } from './report-builder/report-builder.component';
import { ReportViewerComponent } from './report-viewer/report-viewer.component';
import { permissionGuard } from '../../core/guards/permission.guard';

const routes: Routes = [
  { path: '',                  redirectTo: 'standard-reports', pathMatch: 'full' },
  { path: 'standard-reports',  component: StandardReportsComponent, canActivate: [permissionGuard], data: { permission: 'reports.standard-reports' } },
  { path: 'my-reports',        component: MyReportsComponent, canActivate: [permissionGuard], data: { permission: 'reports.my-reports' } },
  { path: 'builder',           component: ReportBuilderComponent, canActivate: [permissionGuard], runGuardsAndResolvers: 'always', data: { permission: 'reports.my-reports', permissionAction: 'build' } },
  { path: 'view/:id',          component: ReportViewerComponent, canActivate: [permissionGuard], runGuardsAndResolvers: 'always', data: { permission: 'reports.standard-reports', permissionByContext: { wip: 'reports.my-reports' } } },
];

@NgModule({ imports: [RouterModule.forChild(routes)], exports: [RouterModule] })
export class ReportsRoutingModule {}
