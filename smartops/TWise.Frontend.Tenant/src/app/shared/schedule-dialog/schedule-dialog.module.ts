import { NgModule } from '@angular/core';
import { IconComponent } from '../components/icon/icon.component';
import { SharedModule } from '../shared.module';
import { ScheduleDialogComponent } from './schedule-dialog.component';

/** The schedule dialog, for Smart Alerts > Schedules and the Schedule buttons of reports, dashboards and canvases. */
@NgModule({
  declarations: [ScheduleDialogComponent],
  imports: [SharedModule, IconComponent],
  exports: [ScheduleDialogComponent],
})
export class ScheduleDialogModule {}
