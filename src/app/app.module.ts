import { NgModule, APP_INITIALIZER } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule, HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';

export function HttpLoaderFactory(http: HttpClient) {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { TopbarComponent } from './components/topbar/topbar.component';
import { WellDetailOverlayComponent } from './components/well-detail-overlay/well-detail-overlay.component';
import { ShellModalsComponent } from './components/shell-modals/shell-modals.component';

import { GlobalsLoaderService } from './services/globals-loader.service';

// Page components
import { ExecSummaryComponent } from './pages/execsummary/execsummary.component';
import { MdBriefingComponent } from './pages/mdbriefing/mdbriefing.component';
import { CmdOverviewComponent } from './pages/cmdoverview/cmdoverview.component';
import { WmrComponent } from './pages/cmdoverview/tabs/wmr/wmr.component';
import { DailyPlanComponent } from './pages/cmdoverview/tabs/daily-plan/daily-plan.component';
import { PhProductivityComponent } from './pages/cmdoverview/tabs/ph-productivity/ph-productivity.component';
import { JobProgressComponent } from './pages/cmdoverview/tabs/job-progress/job-progress.component';
import { FlowlineReadinessComponent } from './pages/cmdoverview/tabs/flowline-readiness/flowline-readiness.component';
import { OhlReadinessComponent } from './pages/cmdoverview/tabs/ohl-readiness/ohl-readiness.component';
import { BufferLocationReadinessComponent } from './pages/cmdoverview/tabs/buffer-location-readiness/buffer-location-readiness.component';
import { Overall1ReadinessComponent } from './pages/cmdoverview/tabs/overall1-readiness/overall1-readiness.component';
import { ActivitiesComponent } from './pages/activities/activities.component';
import { ActMasterComponent } from './pages/actmaster/actmaster.component';
import { AgentRunsComponent } from './pages/agentruns/agentruns.component';
import { AiAgentEditComponent } from './pages/aiagent-edit/aiagent-edit.component';
import { AiAgentsComponent } from './pages/aiagents/aiagents.component';
import { AiOptComponent } from './pages/aiopt/aiopt.component';
import { AllWellsComponent } from './pages/allwells/allwells.component';
import { OdcWellsComponent } from './pages/odcwells/odcwells.component';
import { DrilledWellsComponent } from './pages/drilledwells/drilledwells.component';
import { DueWellsComponent } from './pages/duewells/duewells.component';
import { AnomalyComponent } from './pages/anomaly/anomaly.component';
import { AutoPmComponent } from './pages/autopm/autopm.component';
import { CommissionComponent } from './pages/commission/commission.component';
import { ConnectionsComponent } from './pages/connections/connections.component';
import { CrewAssignComponent } from './pages/crewassign/crewassign.component';
import { CrewListComponent } from './pages/crewlist/crewlist.component';
import { CrewMasterComponent } from './pages/crewmaster/crewmaster.component';
import { CrewOptComponent } from './pages/crewopt/crewopt.component';
import { CrewCalendarComponent } from './pages/crewcalendar/crewcalendar.component';
import { CrewGanttComponent } from './pages/crewgantt/crewgantt.component';
import { CrewGanttUpdatedComponent } from './pages/crewgantt-updated/crewgantt-updated.component';
import { CrewPiComponent } from './pages/crewpi/crewpi.component';
import { PerfAnalysisComponent } from './pages/perfanalysis/perfanalysis.component';
import { WellCalendarComponent } from './pages/wellcalendar/wellcalendar.component';
import { CritDatesComponent } from './pages/critdates/critdates.component';
import { CriticalPathComponent } from './pages/criticalpath/criticalpath.component';
import { DashboardEditComponent } from './pages/dashboard-edit/dashboard-edit.component';
import { DashboardsComponent } from './pages/dashboards/dashboards.component';
import { ChartsComponent } from './pages/charts/charts.component';
import { DataDictComponent } from './pages/datadict/datadict.component';
import { DelayForecastComponent } from './pages/delayforecast/delayforecast.component';
import { ErrorLogComponent } from './pages/errorlog/errorlog.component';
import { FlowDesignerComponent } from './pages/flowdesigner/flowdesigner.component';
import { FlowEditComponent } from './pages/flowedit/flowedit.component';
import { ForecastAiComponent } from './pages/forecastai/forecastai.component';
import { FormsComponent } from './pages/forms/forms.component';
import { FormDetailsComponent } from './pages/form-details/form-details.component';
import { CatalogueNewComponent } from './pages/cataloguenew/cataloguenew.component';
import { RequestPortalComponent } from './pages/requestportal/requestportal.component';
import { MyRequestsComponent } from './pages/myrequests/myrequests.component';
import { ReportsComponent } from './pages/reports/reports.component';
import { ReportBuilderComponent } from './pages/report-builder/report-builder.component';
import { ReportSchedulesComponent } from './pages/report-schedules/report-schedules.component';
import { IncentiveComponent } from './pages/incentive/incentive.component';
import { JobCostComponent } from './pages/jobcost/jobcost.component';
import { LabourComponent } from './pages/labour/labour.component';
import { MaterialComponent } from './pages/material/material.component';
import { PenaltyComponent } from './pages/penalty/penalty.component';
import { PiAnomalyComponent } from './pages/pianomaly/pianomaly.component';
import { PiRevampComponent } from './pages/pirevamp/pirevamp.component';
import { PratingComponent } from './pages/prating/prating.component';
import { PredictComponent } from './pages/predict/predict.component';
import { PredictiveComponent } from './pages/predictive/predictive.component';
import { ProgOptComponent } from './pages/progopt/progopt.component';
import { ProjOverviewComponent } from './pages/projoverview/projoverview.component';
import { AllProjectsComponent } from './pages/allprojects/allprojects.component';
import { ResAllocComponent } from './pages/resalloc/resalloc.component';
import { RootCauseComponent } from './pages/rootcause/rootcause.component';
import { ScorecardsComponent } from './pages/scorecards/scorecards.component';
import { SelfHealComponent } from './pages/selfheal/selfheal.component';
import { SettingsComponent } from './pages/settings/settings.component';
import { UsersComponent } from './pages/users/users.component';
import { RolesComponent } from './pages/roles/roles.component';
import { SmartAlertsComponent } from './pages/smartalerts/smartalerts.component';
import { VarianceComponent } from './pages/variance/variance.component';
import { WatchlistComponent } from './pages/watchlist/watchlist.component';
import { WellsReadinessComponent } from './pages/wellsreadiness/wellsreadiness.component';
import { WellExecutionComponent } from './pages/wellexecution/wellexecution.component';
import { WrDrilldownComponent } from './pages/wr-drilldown/wr-drilldown.component';
import { CprogDrilldownComponent } from './pages/cprog-drilldown/cprog-drilldown.component';
import { HookupDrilldownComponent } from './pages/hookup-drilldown/hookup-drilldown.component';
import { OdcSouthWellDeliveryComponent } from './pages/odcsouthwelldelivery/odcsouthwelldelivery.component';
import { WellDashboardComponent } from './pages/welldashboard/welldashboard.component';
import { StandardBoardsComponent } from './pages/standardboards/standardboards.component';
import { MyBoardsComponent } from './pages/myboards/myboards.component';
import { StandardChartsComponent } from './pages/standardcharts/standardcharts.component';
import { MyChartsComponent } from './pages/mycharts/mycharts.component';
import { BoardsComponent } from './pages/boards/boards.component';
import { ChartsGalleryComponent } from './pages/charts-gallery/charts-gallery.component';
import { ChartDrilldownComponent } from './pages/chart-drilldown/chart-drilldown.component';
import { ChartViewComponent } from './pages/chart-view/chart-view.component';
import { ScopedRolesComponent } from './pages/scoped-roles/scoped-roles.component';
import { LoginComponent } from './pages/login/login.component';
import { DailyPlanNimrComponent } from './pages/daily-plan-nimr/daily-plan-nimr.component';
import { ReportGridComponent } from './pages/report-grid/report-grid.component';
import { ReportGridBuilderComponent } from './pages/report-grid-builder/report-grid-builder.component';
import { ReportsGalleryComponent } from './pages/reports-gallery/reports-gallery.component';
import { DbViewsComponent } from './pages/db-views/db-views.component';
import { DbViewDetailComponent } from './pages/db-view-detail/db-view-detail.component';
import { DbViewBuilderComponent } from './pages/db-view-builder/db-view-builder.component';
import { AlertRulesComponent } from './pages/alert-rules/alert-rules.component';

/**
 * APP_INITIALIZER — inject the original SPA's global JavaScript bundle
 * before the first route renders.
 */
export function appInitializerFactory(
  globals: GlobalsLoaderService
) {
  return () => globals.load();
}

@NgModule({
  declarations: [
    AppComponent,
    SidebarComponent,
    TopbarComponent,
    WellDetailOverlayComponent,
    ShellModalsComponent,
    // Page components
    ExecSummaryComponent,
    MdBriefingComponent,
    CmdOverviewComponent,
    WmrComponent,
    DailyPlanComponent,
    PhProductivityComponent,
    JobProgressComponent,
    FlowlineReadinessComponent,
    OhlReadinessComponent,
    BufferLocationReadinessComponent,
    Overall1ReadinessComponent,
    ActivitiesComponent,
    ActMasterComponent,
    AgentRunsComponent,
    AiAgentEditComponent,
    AiAgentsComponent,
    AiOptComponent,
    AllWellsComponent,
    OdcWellsComponent,
    DrilledWellsComponent,
    DueWellsComponent,
    AnomalyComponent,
    AutoPmComponent,
    CommissionComponent,
    ConnectionsComponent,
    CrewAssignComponent,
    CrewListComponent,
    CrewMasterComponent,
    CrewOptComponent,
    CrewCalendarComponent,
    CrewGanttComponent,
    CrewGanttUpdatedComponent,
    CrewPiComponent,
    PerfAnalysisComponent,
    WellCalendarComponent,
    CritDatesComponent,
    CriticalPathComponent,
    DashboardEditComponent,
    DashboardsComponent,
    ChartsComponent,
    DataDictComponent,
    DelayForecastComponent,
    ErrorLogComponent,
    FlowDesignerComponent,
    FlowEditComponent,
    ForecastAiComponent,
    FormsComponent,
    FormDetailsComponent,
    CatalogueNewComponent,
    RequestPortalComponent,
    MyRequestsComponent,
    ReportsComponent,
    ReportBuilderComponent,
    ReportSchedulesComponent,
    IncentiveComponent,
    JobCostComponent,
    LabourComponent,
    MaterialComponent,
    PenaltyComponent,
    PiAnomalyComponent,
    PiRevampComponent,
    PratingComponent,
    PredictComponent,
    PredictiveComponent,
    ProgOptComponent,
    ProjOverviewComponent,
    AllProjectsComponent,
    ResAllocComponent,
    RootCauseComponent,
    ScorecardsComponent,
    SelfHealComponent,
    SettingsComponent,
    UsersComponent,
    RolesComponent,
    SmartAlertsComponent,
    VarianceComponent,
    WatchlistComponent,
    WellsReadinessComponent,
    WellExecutionComponent,
    WrDrilldownComponent,
    CprogDrilldownComponent,
    HookupDrilldownComponent,
    OdcSouthWellDeliveryComponent,
    WellDashboardComponent,
    StandardBoardsComponent,
    MyBoardsComponent,
    StandardChartsComponent,
    MyChartsComponent,
    BoardsComponent,
    ChartsGalleryComponent,
    ChartDrilldownComponent,
    ChartViewComponent,
    ScopedRolesComponent,
    LoginComponent,
    DailyPlanNimrComponent,
    ReportGridComponent,
    ReportGridBuilderComponent,
    ReportsGalleryComponent,
    DbViewsComponent,
    DbViewDetailComponent,
    DbViewBuilderComponent,
    AlertRulesComponent
  ],
  imports: [
    BrowserModule,
    HttpClientModule,
    FormsModule,
    AppRoutingModule,
    TranslateModule.forRoot({
      defaultLanguage: 'en',
      loader: {
        provide: TranslateLoader,
        useFactory: HttpLoaderFactory,
        deps: [HttpClient]
      }
    })
  ],
  providers: [
    {
      provide: APP_INITIALIZER,
      useFactory: appInitializerFactory,
      deps: [GlobalsLoaderService],
      multi: true
    }
  ],
  bootstrap: [AppComponent]
})
export class AppModule {}
