import { NgModule } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { SharedModule } from '../../shared/shared.module';
import { SmartAlertsRoutingModule } from './smart-alerts-routing.module';
import { AlertsComponent } from './alerts/alerts.component';
import { AlertRuleConfigurationComponent } from './alert-rule-configuration/alert-rule-configuration.component';
import { AlertRuleBuilderComponent } from './alert-rule-builder/alert-rule-builder.component';
import { AlertRuleDetailComponent } from './alert-rule-detail/alert-rule-detail.component';
import { ArcRuleNameRendererComponent } from './alert-rule-configuration/cell-renderers/arc-rule-name-renderer.component';
import { ArcTriggerRendererComponent } from './alert-rule-configuration/cell-renderers/arc-trigger-renderer.component';
import { ArcSeverityRendererComponent } from './alert-rule-configuration/cell-renderers/arc-severity-renderer.component';
import { SchedulesComponent } from './schedules/schedules.component';
import { MailGroupsComponent } from './mail-groups/mail-groups.component';
import { DeliveryLogComponent } from './delivery-log/delivery-log.component';
import { DeliveryBadgeRendererComponent } from './delivery-log/delivery-badge-renderer.component';
import { ScheduleDialogModule } from '../../shared/schedule-dialog/schedule-dialog.module';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { ArcStatusRendererComponent } from './alert-rule-configuration/cell-renderers/arc-status-renderer.component';

@NgModule({
  declarations: [
    AlertsComponent,
    AlertRuleConfigurationComponent,
    AlertRuleBuilderComponent,
    AlertRuleDetailComponent,
    SchedulesComponent,
    MailGroupsComponent,
    DeliveryLogComponent,
  ],
  imports: [
    SharedModule,
    SmartAlertsRoutingModule,
    AgGridAngular,
    ArcRuleNameRendererComponent,
    ArcTriggerRendererComponent,
    ArcSeverityRendererComponent,
    ArcStatusRendererComponent,
    DeliveryBadgeRendererComponent,
    ScheduleDialogModule,
    IconComponent,
  ],
})
export class SmartAlertsModule {}
