import { NgModule } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { HighchartsChartComponent } from 'highcharts-angular';
import { PowerBIEmbedModule } from 'powerbi-client-angular';
import { SharedModule } from '../../shared/shared.module';
import { DaxExpressionInputComponent } from '../../shared/components/dax-expression-input/dax-expression-input.component';
import { SettingsRoutingModule } from './settings-routing.module';
import { SettingsComponent } from './settings.component';
import { DatabaseViewComponent } from './database-view/database-view.component';
import { ViewNameCellRendererComponent } from './database-view/cell-renderers/view-name-cell-renderer.component';
import { TablesCellRendererComponent } from './database-view/cell-renderers/tables-cell-renderer.component';
import { SourceCellRendererComponent } from './database-view/cell-renderers/source-cell-renderer.component';
import { DbActionsCellRendererComponent } from './database-view/cell-renderers/db-actions-cell-renderer.component';
import { DatabaseViewBuilderComponent } from './database-view-builder/database-view-builder.component';
import { DatabaseViewDetailComponent } from './database-view-detail/database-view-detail.component';
import { DataSyncComponent } from './data-sync/data-sync.component';
import { AiSettingsComponent } from './ai-settings/ai-settings.component';
import { AiActivityComponent } from './ai-activity/ai-activity.component';
import { AiRelationsComponent } from './ai-relations/ai-relations.component';
import { AiPromptsComponent } from './ai-prompts/ai-prompts.component';
import { AiConfigurationComponent } from './ai-configuration/ai-configuration.component';
import { DataSourcesComponent } from './data-sources/data-sources.component';
import { MarketplaceComponent } from './marketplace/marketplace.component';
import { PowerBiComponent } from './power-bi/power-bi.component';
import { LearnVideosComponent } from './learn-videos/learn-videos.component';
import { JobStatusCellRendererComponent } from './data-sync/cell-renderers/job-status-cell-renderer.component';
import { JobActionsCellRendererComponent } from './data-sync/cell-renderers/job-actions-cell-renderer.component';
import { RecurringActionsCellRendererComponent } from './data-sync/cell-renderers/recurring-actions-cell-renderer.component';
import { LogStatusCellRendererComponent } from './data-sync/cell-renderers/log-status-cell-renderer.component';
import { DaxModelComponent } from './dax-model/dax-model.component';
import { DaxSourceTypeCellRendererComponent } from './dax-model/cell-renderers/dax-source-type-cell-renderer.component';
import { DaxColumnsCellRendererComponent } from './dax-model/cell-renderers/dax-columns-cell-renderer.component';
import { DaxActionsCellRendererComponent } from './dax-model/cell-renderers/dax-actions-cell-renderer.component';
import { DaxUsedInCellRendererComponent } from './dax-model/cell-renderers/dax-used-in-cell-renderer.component';

@NgModule({
  declarations: [SettingsComponent, DatabaseViewComponent, DatabaseViewBuilderComponent, DatabaseViewDetailComponent, DataSyncComponent, DataSourcesComponent, MarketplaceComponent, PowerBiComponent, LearnVideosComponent, DaxModelComponent, AiSettingsComponent, AiActivityComponent, AiRelationsComponent, AiPromptsComponent, AiConfigurationComponent],
  imports: [
    SharedModule,
    SettingsRoutingModule,
    AgGridAngular,
    DaxExpressionInputComponent,
    HighchartsChartComponent,
    PowerBIEmbedModule,
    ViewNameCellRendererComponent,
    TablesCellRendererComponent,
    SourceCellRendererComponent,
    DbActionsCellRendererComponent,
    JobStatusCellRendererComponent,
    JobActionsCellRendererComponent,
    RecurringActionsCellRendererComponent,
    LogStatusCellRendererComponent,
    DaxSourceTypeCellRendererComponent,
    DaxColumnsCellRendererComponent,
    DaxActionsCellRendererComponent,
    DaxUsedInCellRendererComponent,
  ],
})
export class SettingsModule {}
