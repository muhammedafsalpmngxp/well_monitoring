import { NgModule } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { SharedModule } from '../../shared/shared.module';
import { ModelStudioRoutingModule } from './model-studio-routing.module';
import { ModelDialogsModule } from './model-dialogs.module';
import { DatasetListComponent } from './dataset-list/dataset-list.component';
import { StudioComponent } from './studio/studio.component';
import { DiagramComponent } from './studio/diagram/diagram.component';
import { InspectorComponent } from './studio/inspector/inspector.component';
import { TransformsEditorComponent } from './transforms-editor/transforms-editor.component';
import { GetDataComponent } from './get-data/get-data.component';
import { DataViewComponent } from './studio/data-view/data-view.component';
import { TransformDialogComponent } from './studio/transform-dialog/transform-dialog.component';
import { DataPaneComponent } from './studio/data-pane/data-pane.component';

import { RelationshipDialogComponent } from './relationship-dialog/relationship-dialog.component';

@NgModule({
  declarations: [
    DatasetListComponent, StudioComponent, DiagramComponent, InspectorComponent, TransformsEditorComponent, TransformDialogComponent,
    GetDataComponent, DataViewComponent, DataPaneComponent, RelationshipDialogComponent,
  ],
  imports: [SharedModule, ModelStudioRoutingModule, AgGridAngular, IconComponent, ModelDialogsModule],
})
export class ModelStudioModule {}
