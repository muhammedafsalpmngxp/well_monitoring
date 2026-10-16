import { NgModule } from '@angular/core';
import { AiExplainComponent } from '../../shared/components/ai-explain/ai-explain.component';
import { HighchartsChartComponent } from 'highcharts-angular';
import { SharedModule } from '../../shared/shared.module';
import { ChartsTilesRoutingModule } from './charts-tiles-routing.module';
import { StandardChartsComponent } from './standard-charts/standard-charts.component';
import { WipChartsComponent } from './wip-charts/wip-charts.component';
import { WipTilesComponent } from './wip-tiles/wip-tiles.component';
import { ChartBuilderComponent } from './chart-builder/chart-builder.component';
import { TileBuilderComponent } from './tile-builder/tile-builder.component';
import { WidgetViewComponent } from './widget-view/widget-view.component';
import { ChartCardPreviewComponent } from '../../shared/components/chart-card-preview/chart-card-preview.component';
import { ChartDrilldownComponent } from './chart-drilldown/chart-drilldown.component';
import { AgGridAngular } from 'ag-grid-angular';

import { DaxExpressionInputComponent } from '../../shared/components/dax-expression-input/dax-expression-input.component';

@NgModule({
  declarations: [StandardChartsComponent, WipChartsComponent, WipTilesComponent, ChartBuilderComponent, TileBuilderComponent, WidgetViewComponent, ChartCardPreviewComponent, ChartDrilldownComponent],
  imports: [SharedModule, ChartsTilesRoutingModule, HighchartsChartComponent, AgGridAngular, AiExplainComponent, DaxExpressionInputComponent],
})
export class ChartsTilesModule {}
