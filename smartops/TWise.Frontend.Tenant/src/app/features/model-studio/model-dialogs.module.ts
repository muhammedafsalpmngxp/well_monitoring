import { FieldSuggestComponent } from './field-suggest/field-suggest.component';
import { NgModule } from '@angular/core';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { SharedModule } from '../../shared/shared.module';
import { CalculatedColumnDialogComponent } from './calculated-column/calculated-column-dialog.component';
import { FormulaBuilderComponent } from './formula-builder/formula-builder.component';
import { FunctionListComponent } from './function-list/function-list.component';

/**
 * The measure and calculated-column dialogs, for Model Studio and for the canvas Data pane (D-16).
 * Their own module, because ModelStudioModule brings its routes with it.
 */
@NgModule({
  declarations: [FormulaBuilderComponent, CalculatedColumnDialogComponent, FunctionListComponent, FieldSuggestComponent],
  imports: [SharedModule, IconComponent],
  exports: [FormulaBuilderComponent, CalculatedColumnDialogComponent],
})
export class ModelDialogsModule {}
