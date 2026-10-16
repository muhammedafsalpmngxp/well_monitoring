import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { AgGridAngular } from 'ag-grid-angular';
import { AgenticAiRoutingModule } from './agentic-ai-routing.module';
import { AgenticAiComponent } from './agentic-ai.component';
import { AiAgentsComponent } from './ai-agents/ai-agents.component';
import { ActivityLogComponent } from './activity-log/activity-log.component';
import { NewAgentComponent } from './new-agent/new-agent.component';
import { AgentCanvasComponent } from './new-agent/agent-canvas/agent-canvas.component';

@NgModule({
  declarations: [AgenticAiComponent, AiAgentsComponent, ActivityLogComponent, NewAgentComponent],
  imports: [SharedModule, AgGridAngular, AgenticAiRoutingModule, AgentCanvasComponent],
})
export class AgenticAiModule {}
