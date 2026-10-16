import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { ExecSummaryComponent } from './pages/execsummary/execsummary.component';
import { MdBriefingComponent } from './pages/mdbriefing/mdbriefing.component';
import { CmdOverviewComponent } from './pages/cmdoverview/cmdoverview.component';
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
import { BoardsComponent } from './pages/boards/boards.component';
import { StandardChartsComponent } from './pages/standardcharts/standardcharts.component';
import { MyChartsComponent } from './pages/mycharts/mycharts.component';
import { ChartsGalleryComponent } from './pages/charts-gallery/charts-gallery.component';
import { ChartDrilldownComponent } from './pages/chart-drilldown/chart-drilldown.component';
import { ChartViewComponent } from './pages/chart-view/chart-view.component';
import { ScopedRolesComponent } from './pages/scoped-roles/scoped-roles.component';
import { LoginComponent } from './pages/login/login.component';
import { DailyPlanNimrComponent } from './pages/daily-plan-nimr/daily-plan-nimr.component';
import { ReportGridComponent } from './pages/report-grid/report-grid.component';
import { ReportGridBuilderComponent } from './pages/report-grid-builder/report-grid-builder.component';
import { ReportsGalleryComponent } from './pages/reports-gallery/reports-gallery.component';
import { UsersComponent } from './pages/users/users.component';
import { RolesComponent } from './pages/roles/roles.component';
import { DbViewsComponent } from './pages/db-views/db-views.component';
import { DbViewDetailComponent } from './pages/db-view-detail/db-view-detail.component';
import { DbViewBuilderComponent } from './pages/db-view-builder/db-view-builder.component';
import { AlertRulesComponent } from './pages/alert-rules/alert-rules.component';

const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', redirectTo: 'standardboards', pathMatch: 'full' },

  // Executive
  { path: 'execsummary',    component: ExecSummaryComponent },
  { path: 'mdbriefing',     component: MdBriefingComponent },

  // Insight
  { path: 'cmdoverview',    component: CmdOverviewComponent },
  { path: 'welldashboard',  component: WellDashboardComponent },
  { path: 'standardboards', component: BoardsComponent },
  { path: 'myboards',       component: BoardsComponent },
  { path: 'standardcharts', component: ChartsGalleryComponent },
  { path: 'mycharts',       component: ChartsGalleryComponent },
  { path: 'publishedtiles', component: ChartsGalleryComponent },
  { path: 'wiptiles',       component: ChartsGalleryComponent },
  { path: 'chart-drilldown', component: ChartDrilldownComponent },
  { path: 'chart-view',     component: ChartViewComponent },
  { path: 'allwells',       component: AllWellsComponent },
  { path: 'odcwells',       component: OdcWellsComponent },
  { path: 'drilledwells',   component: DrilledWellsComponent },
  { path: 'duewells',       component: DueWellsComponent },
  { path: 'wellsreadiness', component: WellsReadinessComponent },
  { path: 'wells-readiness-details', component: WrDrilldownComponent },
  { path: 'cprog-details', component: CprogDrilldownComponent },
  { path: 'hookup-drilldown', component: HookupDrilldownComponent },
  { path: 'wellexecution',  component: WellExecutionComponent },
  { path: 'critdates',      component: CritDatesComponent },
  { path: 'smartalerts',    component: SmartAlertsComponent },
  { path: 'alert-rules',    component: AlertRulesComponent },
  { path: 'watchlist',      component: WatchlistComponent },
  { path: 'delayforecast',  component: DelayForecastComponent },

  // Field Operations
  { path: 'activities',     component: ActivitiesComponent },
  { path: 'commission',     component: CommissionComponent },
  { path: 'projoverview',   component: ProjOverviewComponent },
  { path: 'allprojects',    component: AllProjectsComponent },
  { path: 'material',       component: MaterialComponent },
  { path: 'crewopt',        component: CrewOptComponent },

  // Crew & Activities
  { path: 'crewmaster',     component: CrewMasterComponent },
  { path: 'crewlist',       component: CrewListComponent },
  { path: 'crewassign',     component: CrewAssignComponent },
  { path: 'crewcalendar',   component: CrewCalendarComponent },
  { path: 'crewgantt',      component: CrewGanttComponent },
  { path: 'crewgantt-updated', component: CrewGanttUpdatedComponent },
  { path: 'crewpi',         component: CrewPiComponent },
  { path: 'perfanalysis',   component: PerfAnalysisComponent },
  { path: 'wellcalendar',   component: WellCalendarComponent },
  { path: 'actmaster',      component: ActMasterComponent },
  { path: 'labour',         component: LabourComponent },

  // Production Intel
  { path: 'prating',        component: PratingComponent },
  { path: 'incentive',      component: IncentiveComponent },
  { path: 'pianomaly',      component: PiAnomalyComponent },
  { path: 'penalty',        component: PenaltyComponent },

  // Data Quality
  { path: 'errorlog',       component: ErrorLogComponent },
  { path: 'selfheal',       component: SelfHealComponent },
  { path: 'datadict',       component: DataDictComponent },
  { path: 'pirevamp',       component: PiRevampComponent },
  { path: 'scorecards',     component: ScorecardsComponent },
  { path: 'jobcost',        component: JobCostComponent },

  // AI Intelligence
  { path: 'aiopt',          component: AiOptComponent },
  { path: 'predict',        component: PredictComponent },
  { path: 'forecastai',     component: ForecastAiComponent },

  // Analytics & Reports
  { path: 'criticalpath',   component: CriticalPathComponent },
  { path: 'rootcause',      component: RootCauseComponent },
  { path: 'progopt',        component: ProgOptComponent },
  { path: 'variance',       component: VarianceComponent },
  { path: 'resalloc',       component: ResAllocComponent },
  { path: 'anomaly',        component: AnomalyComponent },
  { path: 'predictive',     component: PredictiveComponent },
  { path: 'autopm',         component: AutoPmComponent },

  // Process Automation
  { path: 'flowdesigner',   component: FlowDesignerComponent },
  { path: 'flowedit',       component: FlowEditComponent },
  { path: 'connections',    component: ConnectionsComponent },

  // Agentic AI
  { path: 'aiagents',       component: AiAgentsComponent },
  { path: 'aiagent-edit',   component: AiAgentEditComponent },
  { path: 'agentruns',      component: AgentRunsComponent },
  { path: 'forms',          component: FormsComponent },
  { path: 'form-details',   component: FormDetailsComponent },
  { path: 'cataloguenew',   component: CatalogueNewComponent },
  { path: 'requestportal',  component: RequestPortalComponent },
  { path: 'myrequests',     component: MyRequestsComponent },
  { path: 'reports',          component: ReportsComponent },
  { path: 'standardreports',  component: ReportsGalleryComponent },
  { path: 'myreports',        component: ReportsGalleryComponent },
  { path: 'report-builder',   component: ReportBuilderComponent },
  { path: 'daily-plan-nimr',  component: DailyPlanNimrComponent },
  { path: 'report-grid',         component: ReportGridComponent },
  { path: 'report-grid-builder', component: ReportGridBuilderComponent },
  { path: 'report-schedules', component: ReportSchedulesComponent },

  // ODC South Well Delivery
  { path: 'odcsouthwelldelivery', component: OdcSouthWellDeliveryComponent },
  { path: 'welldeliverystatus', component: OdcSouthWellDeliveryComponent },

  // Dashboards
  { path: 'dashboards',     component: DashboardsComponent },
  { path: 'dashboard-edit', component: DashboardEditComponent },

  // Charts
  { path: 'charts',         component: ChartsComponent },

  // Settings
  { path: 'settings',       component: SettingsComponent },
  { path: 'db-views',        component: DbViewsComponent },
  { path: 'db-view-detail',  component: DbViewDetailComponent },
  { path: 'db-view-builder', component: DbViewBuilderComponent },

  // User & Role Management
  { path: 'users',          component: UsersComponent },
  { path: 'roles',          component: RolesComponent },
  { path: 'scoped-roles',   component: ScopedRolesComponent },

  // Catch-all
  { path: '**', redirectTo: 'standardboards' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes, { useHash: false })],
  exports: [RouterModule]
})
export class AppRoutingModule {}
