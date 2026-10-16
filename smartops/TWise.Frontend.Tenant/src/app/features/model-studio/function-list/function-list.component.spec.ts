import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { FunctionListComponent } from './function-list.component';
// Imported for its NgModule metadata only. FunctionListComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { ModelDialogsModule } from '../model-dialogs.module';

describe('FunctionListComponent', () => {
  it('lists row functions for a column and calculations for a measure, filtered by the search', () => {
    const component = new FunctionListComponent();
    expect(component.groups.map(g => g.category)).toEqual(['Logic', 'Text', 'Date', 'Number']);

    component.mode = 'measure';
    expect(component.groups.map(g => g.category)).toEqual(['Aggregate', 'Across rows']);

    component.term = 'running';
    expect(component.groups.flatMap(g => g.functions.map(f => f.name))).toEqual(['RUNNING_TOTAL']);
  });

  it('hands the example of the chosen function to the host', () => {
    const component = new FunctionListComponent();
    const inserted = vi.fn();
    component.insert.subscribe(inserted);
    component.term = 'month_start';

    component.choose(component.groups[0].functions[0]);

    expect(inserted).toHaveBeenCalledWith('MONTH_START(TaskDaily.action_on)');
  });
});
