import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { AgGridAngular } from 'ag-grid-angular';
import { HighchartsChartComponent } from 'highcharts-angular';
import { AgenticAiRoutingModule } from './agentic-ai-routing.module';
import { AgenticAiComponent } from './agentic-ai.component';
import { AiAgentsComponent } from './ai-agents/ai-agents.component';
import { ActivityLogComponent } from './activity-log/activity-log.component';
import { NewAgentComponent } from './new-agent/new-agent.component';
import { AgentCanvasComponent } from './new-agent/agent-canvas/agent-canvas.component';
import { RunAgentDialogComponent } from './run-agent/run-agent-dialog.component';
import { FeaturesHomeComponent } from './agentic-features/features-home/features-home.component';
import { SlippageComponent } from './agentic-features/slippage/slippage.component';
import { DailyReportComponent } from './agentic-features/daily-report/daily-report.component';
import { DataAnomalyComponent } from './agentic-features/data-anomaly/data-anomaly.component';

@NgModule({
  declarations: [AgenticAiComponent, AiAgentsComponent, ActivityLogComponent, NewAgentComponent, RunAgentDialogComponent,
    FeaturesHomeComponent, SlippageComponent, DailyReportComponent, DataAnomalyComponent],
  imports: [SharedModule, AgGridAngular, HighchartsChartComponent, AgenticAiRoutingModule, AgentCanvasComponent],
})
export class AgenticAiModule {}
