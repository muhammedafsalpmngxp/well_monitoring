import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AgenticAiComponent } from './agentic-ai.component';
import { AiAgentsComponent } from './ai-agents/ai-agents.component';
import { ActivityLogComponent } from './activity-log/activity-log.component';
import { NewAgentComponent } from './new-agent/new-agent.component';
import { permissionGuard } from '../../core/guards/permission.guard';

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
    ],
  },
];

@NgModule({ imports: [RouterModule.forChild(routes)], exports: [RouterModule] })
export class AgenticAiRoutingModule {}
