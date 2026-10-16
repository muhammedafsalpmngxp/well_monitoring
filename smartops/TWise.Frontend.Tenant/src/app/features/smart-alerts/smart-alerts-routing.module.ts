import { NgModule, inject } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AlertsComponent } from './alerts/alerts.component';
import { AlertRuleConfigurationComponent } from './alert-rule-configuration/alert-rule-configuration.component';
import { AlertRuleBuilderComponent } from './alert-rule-builder/alert-rule-builder.component';
import { AlertRuleDetailComponent } from './alert-rule-detail/alert-rule-detail.component';
import { permissionGuard } from '../../core/guards/permission.guard';
import { PermissionService } from '../../core/services/permission.service';
import { SCHEDULES_MODULE } from '../../core/services/schedule.service';
import { SchedulesComponent } from './schedules/schedules.component';
import { DeliveryLogComponent } from './delivery-log/delivery-log.component';

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: () => inject(PermissionService).canView('smart-alerts.alerts') || !inject(PermissionService).canView(SCHEDULES_MODULE) ? 'alerts' : 'schedules' },
  { path: 'alerts', component: AlertsComponent, canActivate: [permissionGuard], data: { permission: 'smart-alerts.alerts' } },
  { path: 'alert-rule-configuration', component: AlertRuleConfigurationComponent, canActivate: [permissionGuard], data: { permission: 'smart-alerts.rule-config' } },
  { path: 'alert-rule-configuration/create', component: AlertRuleBuilderComponent, canActivate: [permissionGuard], data: { permission: 'smart-alerts.rule-config' } },
  { path: 'schedules', component: SchedulesComponent, canActivate: [permissionGuard], data: { permission: SCHEDULES_MODULE } },
  { path: 'delivery-log', component: DeliveryLogComponent, canActivate: [permissionGuard], data: { permission: SCHEDULES_MODULE } },
  { path: 'alert-rule-configuration/:id', component: AlertRuleDetailComponent, canActivate: [permissionGuard], data: { permission: 'smart-alerts.rule-config' } },
];

@NgModule({ imports: [RouterModule.forChild(routes)], exports: [RouterModule] })
export class SmartAlertsRoutingModule {}
