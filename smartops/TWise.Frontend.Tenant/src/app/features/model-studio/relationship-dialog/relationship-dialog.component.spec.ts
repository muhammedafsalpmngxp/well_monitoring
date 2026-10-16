import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { DatasetDetail, DatasetRelationship } from '../../../core/services/model-studio.service';
import { RelationshipDialogComponent, relationshipBody, sameEnds } from './relationship-dialog.component';
// Imported for its NgModule metadata only; the component is declared there.
import { ModelStudioModule } from '../model-studio.module';

const dataset = {
  id: 7, name: 'D', description: null, connectionId: 4, status: 'draft', createdAt: '',
  sources: [
    { id: 1, schemaName: 'core', sourceName: 'TaskDaily', alias: 't', rlsMode: 'none', rlsPlantColumn: null },
    { id: 2, schemaName: 'ref', sourceName: 'CrewType', alias: 'c', rlsMode: 'none', rlsPlantColumn: null },
  ],
  relationships: [], measures: [], calculatedColumns: [], transforms: [],
} as unknown as DatasetDetail;

describe('relationship editor', () => {
  it('saves one to many as many to one from the other side, and knows when only the cardinality changed', () => {
    const t = { sourceId: 1, column: 'crew_type_id' };
    const c = { sourceId: 2, column: 'crew_type_id' };
    expect(relationshipBody(t, c, 'many_to_one')).toEqual({
      fromSourceId: 1, fromColumn: 'crew_type_id', toSourceId: 2, toColumn: 'crew_type_id', cardinality: 'many_to_one', detectedFrom: 'user',
    });
    expect(relationshipBody(c, t, 'one_to_many')).toEqual(relationshipBody(t, c, 'many_to_one'));
    expect(relationshipBody(t, { sourceId: 2, column: null }, 'one_to_one')).toBeNull();
    const stored = { id: 9, fromSourceId: 1, fromColumn: 'crew_type_id', toSourceId: 2, toColumn: 'crew_type_id', cardinality: 'many_to_one' } as DatasetRelationship;
    expect(sameEnds(relationshipBody(t, c, 'one_to_one')!, stored)).toBe(true);
    expect(sameEnds(relationshipBody(t, { sourceId: 2, column: 'code' }, 'many_to_one')!, stored)).toBe(false);
  });

  it('counts the chosen columns and warns when the one side repeats values', () => {
    const modelStudio = {
      previewSource: vi.fn().mockReturnValue(of({ columns: ['crew_type_id'], rows: [{ crew_type_id: 1 }] })),
      runQuery: vi.fn().mockImplementation((request: { values: { field: string }[] }) =>
        of({ rows: [request.values[0].field === 't.crew_type_id' ? { Rows: 10, Distinct: 3 } : { Rows: 5, Distinct: 5 }] })),
    };
    const component = new RelationshipDialogComponent(modelStudio as never, { markForCheck: vi.fn() } as never);
    component.dataset = dataset;
    component.ngOnInit();
    expect(component.problems.blocking).toEqual(['Click the matching column in each table.']);

    component.chooseColumn('from', 'crew_type_id');
    component.chooseColumn('to', 'crew_type_id');
    expect([component.uniqueness.from, component.uniqueness.to]).toEqual(['repeated', 'unique']);
    expect(component.problems).toEqual({ blocking: [], warnings: [] });

    component.shape = 'one_to_many';
    expect(component.problems.warnings[0]).toContain('t.crew_type_id repeats values');
    component.swap();
    expect(component.problems.warnings).toEqual([]);

    const saved: unknown[] = [];
    component.save.subscribe(body => saved.push(body));
    component.submit();
    expect(saved).toEqual([relationshipBody({ sourceId: 1, column: 'crew_type_id' }, { sourceId: 2, column: 'crew_type_id' }, 'many_to_one')]);
    component.ngOnDestroy();
  });
});
