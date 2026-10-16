import { NgModule } from '@angular/core';
import { AiExplainComponent } from '../../shared/components/ai-explain/ai-explain.component';
import { HighchartsChartComponent } from 'highcharts-angular';
import { Gridster, GridsterItem } from 'angular-gridster2';
import { SharedModule } from '../../shared/shared.module';
import { DashboardRoutingModule } from './dashboard-routing.module';
import { StandardBoardsComponent } from './standard-boards/standard-boards.component';
import { WipBoardsComponent } from './wip-boards/wip-boards.component';
import { DashboardBuilderComponent } from './dashboard-builder/dashboard-builder.component';
import { OperationsDashboardComponent } from './operations-dashboard/operations-dashboard.component';
import { BoardBuilderComponent } from './board-builder/board-builder.component';
import { BoardBuilderTestComponent } from './board-builder-test/board-builder-test.component';
import { ActivityBreakdownComponent } from './activity-breakdown/activity-breakdown.component';
import { ChartTypeIconComponent } from '../../shared/components/chart-type-icon.component';
import { DashboardBrandingComponent } from './dashboard-branding/dashboard-branding.component';
import { DashboardBrandingEditorComponent } from './dashboard-branding/dashboard-branding-editor.component';
import { DashboardPreviewComponent } from './dashboard-preview/dashboard-preview.component';
import { ScheduleDialogModule } from '../../shared/schedule-dialog/schedule-dialog.module';

@NgModule({
  declarations: [StandardBoardsComponent, WipBoardsComponent, DashboardBuilderComponent, OperationsDashboardComponent, BoardBuilderComponent, BoardBuilderTestComponent],
  // Note: angular-gridster2@22 ships `Gridster`/`GridsterItem` as standalone components — there is
  // no `GridsterModule` to import in this version, so they're imported directly like the other
  // standalone components already registered here (HighchartsChartComponent, etc.).
  imports: [SharedModule, DashboardRoutingModule, HighchartsChartComponent, ActivityBreakdownComponent, ChartTypeIconComponent, Gridster, GridsterItem, DashboardBrandingComponent, DashboardBrandingEditorComponent, DashboardPreviewComponent, ScheduleDialogModule, AiExplainComponent],
})
export class DashboardModule {}
