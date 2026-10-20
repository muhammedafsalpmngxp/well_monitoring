import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AgenticAiComponent } from './agentic-ai.component';
import { AiAgentsComponent } from './ai-agents/ai-agents.component';
import { ActivityLogComponent } from './activity-log/activity-log.component';
import { NewAgentComponent } from './new-agent/new-agent.component';
import { permissionGuard } from '../../core/guards/permission.guard';
import { FeaturesHomeComponent } from './agentic-features/features-home/features-home.component';
import { SlippageComponent } from './agentic-features/slippage/slippage.component';
import { DailyReportComponent } from './agentic-features/daily-report/daily-report.component';
import { DataAnomalyComponent } from './agentic-features/data-anomaly/data-anomaly.component';

/** Asks before leaving the agent editor with unsaved changes. */
const leaveAgent = (c: NewAgentComponent) => c.canLeave();

const routes: Routes = [
  {
    path: '',
    component: AgenticAiComponent,
    children: [
      { path: '', redirectTo: 'ai-agents', pathMatch: 'full' },
      { path: 'ai-agents',         component: AiAgentsComponent, canActivate: [permissionGuard], data: { permission: 'agentic-ai.agents' } },
      { path: 'ai-agents/new',     component: NewAgentComponent, canActivate: [permissionGuard], canDeactivate: [leaveAgent], data: { permission: 'agentic-ai.agents' } },
      { path: 'ai-agents/:id',     component: NewAgentComponent, canActivate: [permissionGuard], canDeactivate: [leaveAgent], data: { permission: 'agentic-ai.agents' } },
      { path: 'activity-log',      component: ActivityLogComponent, canActivate: [permissionGuard], data: { permission: 'agentic-ai.activity-log' } },
      // Agentic Features: the landing page, then one page per feature (each with its own permission module).
      { path: 'features',              component: FeaturesHomeComponent, canActivate: [permissionGuard], data: { permission: 'agentic-ai.features' } },
      { path: 'features/slippage',     component: SlippageComponent, canActivate: [permissionGuard], data: { permission: 'agentic-ai.slippage' } },
      { path: 'features/daily-report', component: DailyReportComponent, canActivate: [permissionGuard], data: { permission: 'agentic-ai.daily-report' } },
      { path: 'features/data-anomaly', component: DataAnomalyComponent, canActivate: [permissionGuard], data: { permission: 'agentic-ai.data-anomaly' } },
    ],
  },
];

@NgModule({ imports: [RouterModule.forChild(routes)], exports: [RouterModule] })
export class AgenticAiRoutingModule {}
