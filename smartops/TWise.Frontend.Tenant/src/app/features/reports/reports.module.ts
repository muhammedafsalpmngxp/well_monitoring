import { NgModule } from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { AgGridAngular } from 'ag-grid-angular';
import { ReportsRoutingModule } from './reports-routing.module';
import { PinHeaderComponent } from './report-viewer/pin-header.component';
import { EditableHeaderComponent } from './report-builder/editable-header.component';
import { EmbeddedCellComponent } from './report-builder/embedded-cell.component';
import { StandardReportsComponent } from './standard-reports/standard-reports.component';
import { MyReportsComponent } from './my-reports/my-reports.component';
import { ReportBuilderComponent } from './report-builder/report-builder.component';
import { ReportViewerComponent } from './report-viewer/report-viewer.component';
import { ScheduleDialogModule } from '../../shared/schedule-dialog/schedule-dialog.module';

@NgModule({
  declarations: [StandardReportsComponent, MyReportsComponent, ReportBuilderComponent, ReportViewerComponent],
  imports: [SharedModule, AgGridAngular, PinHeaderComponent, EditableHeaderComponent, EmbeddedCellComponent, ReportsRoutingModule, ScheduleDialogModule],
})
export class ReportsModule {}
