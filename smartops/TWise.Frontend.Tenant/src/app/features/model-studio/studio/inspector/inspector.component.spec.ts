import { describe, expect, it } from 'vitest';
import { InspectorComponent } from './inspector.component';

const viewSource = {
  id: 1, schemaName: 'view', sourceName: '12', alias: 'Crews', rlsMode: 'none' as const, rlsPlantColumn: null,
  kind: 'view' as const, viewChanged: true,
};
const dataset = {
  id: 1, name: 'D', description: null, connectionId: 4, status: 'draft', createdAt: '',
  sources: [viewSource], relationships: [], measures: [], calculatedColumns: [], transforms: [],
};

describe('InspectorComponent view-changed notice', () => {
  it('shows the notice and offers Update from view with modify permission', () => {
    const component = new InspectorComponent();
    component.dataset = dataset as never;
    component.selection = { kind: 'source', id: 1 };
    component.readonly = false;

    expect(component.viewSourceChanged).toBe(true);
    expect(component.canUpdateView).toBe(true);
  });

  it('keeps the notice but hides Update from view without modify permission', () => {
    const component = new InspectorComponent();
    component.dataset = dataset as never;
    component.selection = { kind: 'source', id: 1 };
    component.readonly = true;

    expect(component.viewSourceChanged).toBe(true);
    expect(component.canUpdateView).toBe(false);
  });

  it('has no notice for a source whose view has not changed', () => {
    const unchanged = { ...dataset, sources: [{ ...viewSource, viewChanged: false }] };
    const component = new InspectorComponent();
    component.dataset = unchanged as never;
    component.selection = { kind: 'source', id: 1 };

    expect(component.viewSourceChanged).toBe(false);
    expect(component.canUpdateView).toBe(false);
  });
});

describe('InspectorComponent saved view parameters', () => {
  const saved = {
    id: 2, schemaName: 'script', sourceName: '10117', alias: 'Delivery', rlsMode: 'none' as const, rlsPlantColumn: null, kind: 'script' as const,
    sql: 'DECLARE @plant NVARCHAR(100) = NULL; SELECT 1 AS n', parameters: [{ name: '@plant', type: 'nvarchar(100)', default: 'NULL', field: null }],
  };
  const plant = { id: 3, schemaName: 'dbo', sourceName: 'plant_description', alias: 'Plant', rlsMode: 'none' as const, rlsPlantColumn: null };
  const withSaved = { ...dataset, sources: [saved, plant] };

  it('lists every field of the model to bind to, and sends each variable with its field or null', () => {
    const component = new InspectorComponent();
    component.dataset = withSaved as never;
    component.columns = new Map([['dbo.plant_description', [{ columnName: 'plant_description' }]]]) as never;
    component.selection = { kind: 'source', id: 2 };
    component.ngOnChanges({ dataset: {}, columns: {}, selection: {} } as never);
    const sent: unknown[] = [];
    component.saveParameters.subscribe(event => sent.push(event));

    expect(component.fieldGroups).toEqual([{ table: 'Delivery', fields: [] }, { table: 'Plant', fields: ['Plant.plant_description'] }]);
    expect(component.parametersChanged(saved as never)).toBe(false);
    component.paramFields['@plant'] = 'Plant.plant_description';
    expect(component.parametersChanged(saved as never)).toBe(true);
    component.submitParameters(saved as never);
    expect(sent).toEqual([{ sourceId: 2, bindings: [{ name: '@plant', field: 'Plant.plant_description' }] }]);
  });
});
