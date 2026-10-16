import { NgModule } from '@angular/core';
import { HighchartsChartComponent } from 'highcharts-angular';
import { AgGridAngular } from 'ag-grid-angular';
import { SharedModule } from '../../shared/shared.module';
import { DataQualityRoutingModule } from './data-quality-routing.module';
import { DataQualityComponent } from './data-quality.component';
import { ErrorLogRulesComponent } from './error-log-rules/error-log-rules.component';
import { SelfHealingAiComponent } from './self-healing-ai/self-healing-ai.component';
import { DataDictionaryComponent } from './data-dictionary/data-dictionary.component';
import { LineageComponent } from './lineage/lineage.component';
import { AddValidationRuleComponent } from './add-validation-rule/add-validation-rule.component';
import { ShaBadgeRendererComponent } from './self-healing-ai/cell-renderers/sha-badge-renderer.component';
import { AvrFieldTagsRendererComponent } from './add-validation-rule/cell-renderers/avr-field-tags-renderer.component';
import { AvrActionsRendererComponent } from './add-validation-rule/cell-renderers/avr-actions-renderer.component';
import { VrActionsRendererComponent } from './error-log-rules/cell-renderers/vr-actions-renderer.component';
import { ElStatusRendererComponent } from './error-log-rules/cell-renderers/el-status-renderer.component';
import { VrRuleIdRendererComponent } from './error-log-rules/cell-renderers/vr-ruleid-renderer.component';

@NgModule({
  declarations: [
    DataQualityComponent,
    ErrorLogRulesComponent,
    SelfHealingAiComponent,
    DataDictionaryComponent,
    LineageComponent,
    AddValidationRuleComponent,
  ],
  imports: [
    SharedModule,
    DataQualityRoutingModule,
    HighchartsChartComponent,
    AgGridAngular,
    AvrFieldTagsRendererComponent,
    AvrActionsRendererComponent,
    ShaBadgeRendererComponent,
    VrActionsRendererComponent,
    ElStatusRendererComponent,
    VrRuleIdRendererComponent,
  ],
})
export class DataQualityModule {}
