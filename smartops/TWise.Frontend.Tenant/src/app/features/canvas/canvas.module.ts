import { RichTextEditorComponent } from './rich-text-editor/rich-text-editor.component';
import { NgModule } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { Gridster, GridsterItem } from 'angular-gridster2';
import { HighchartsChartComponent } from 'highcharts-angular';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { SharedModule } from '../../shared/shared.module';
import { CanvasRoutingModule } from './canvas-routing.module';
import { CanvasListComponent } from './canvas-list/canvas-list.component';
import { CanvasEditorComponent } from './canvas-editor/canvas-editor.component';
import { CanvasObjectComponent } from './canvas-object/canvas-object.component';
import { CanvasPropertiesComponent } from './canvas-properties/canvas-properties.component';
import { CanvasDataPaneComponent } from './canvas-data-pane/canvas-data-pane.component';
import { CanvasFiltersComponent } from './canvas-filters/canvas-filters.component';
import { ModelDialogsModule } from '../model-studio/model-dialogs.module';
import { ScheduleDialogModule } from '../../shared/schedule-dialog/schedule-dialog.module';

@NgModule({
  declarations: [
    CanvasListComponent, CanvasEditorComponent, CanvasObjectComponent, CanvasPropertiesComponent, CanvasDataPaneComponent, RichTextEditorComponent,
    CanvasFiltersComponent,
  ],
  // angular-gridster2@22 ships Gridster and GridsterItem as standalone components, imported like the dashboard module does.
  imports: [SharedModule, CanvasRoutingModule, AgGridAngular, HighchartsChartComponent, Gridster, GridsterItem, IconComponent, ModelDialogsModule, ScheduleDialogModule],
})
export class CanvasModule {}
