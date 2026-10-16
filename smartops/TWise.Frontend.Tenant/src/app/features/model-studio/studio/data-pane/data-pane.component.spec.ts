import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { DataPaneComponent } from './data-pane.component';
// Imported for its NgModule metadata only. DataPaneComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { ModelStudioModule } from '../../model-studio.module';

const dataset = {
  id: 1, name: 'Pane check', description: null, connectionId: 4, status: 'draft', createdAt: '',
  sources: [{ id: 2, schemaName: 'ref', sourceName: 'CrewType', alias: 'CrewType', rlsMode: 'none', rlsPlantColumn: null }],
  relationships: [],
  measures: [{ id: 5, name: 'Crew Count', expression: null }],
  calculatedColumns: [{ id: 20, sourceId: 2, name: 'Prefix', dataType: 'text', expression: null }],
  transforms: [],
};
const columns = new Map([['ref.crewtype', [{ id: 22, columnName: 'code', ordinalPosition: 1 }]]]);

describe('DataPaneComponent', () => {
  it('lists the tables, fields and measures, and filters them as the search changes', () => {
    const component = new DataPaneComponent();
    component.dataset = dataset as never;
    component.columns = columns as never;
    component.ngOnChanges();

    expect(component.tables.map(t => t.source.alias)).toEqual(['CrewType']);
    expect(component.tables[0].fields.map(f => [f.name, !!f.calculated])).toEqual([['code', false], ['Prefix', true]]);
    expect(component.measures.flatMap(g => g.measures.map(m => m.name))).toEqual(['Crew Count']);
    expect(component.describeColumn(dataset.calculatedColumns[0] as never))
      .toBe('This column cannot be read. Open it to write it again, or delete it.');

    component.search = 'count';
    component.filter();
    expect(component.tables).toEqual([]);
    expect(component.measures.flatMap(g => g.measures.map(m => m.name))).toEqual(['Crew Count']);
  });

  it('starts with tables and folders folded, unfolds on toggle, and a search shows every match', () => {
    const component = new DataPaneComponent();
    component.dataset = dataset as never;
    component.columns = columns as never;
    component.ngOnChanges();
    expect(component.isOpen(2)).toBe(false);
    expect(component.isFolderOpen(2, 'KPIs')).toBe(false);

    component.toggleTable(2);
    component.toggleFolder(2, 'KPIs');
    expect(component.isOpen(2)).toBe(true);
    expect(component.isFolderOpen(2, 'KPIs')).toBe(true);
    component.toggleTable(2);
    expect(component.isOpen(2)).toBe(false);

    component.search = 'code';
    component.filter();
    expect(component.isOpen(2)).toBe(true);
    expect(component.isFolderOpen(0, 'Other')).toBe(true);

    component.search = '';
    component.filter();
    expect(component.isOpen(2)).toBe(false);
  });

  it('lists a measure under its table and in its folder, the others with the data model', () => {
    const component = new DataPaneComponent();
    component.dataset = {
      ...dataset,
      measures: [
        { id: 5, name: 'Crew Count', expression: null, homeSourceId: 2, folder: 'KPIs' },
        { id: 6, name: 'Hours', expression: null, homeSourceId: null, folder: null },
        { id: 7, name: 'Lost', expression: null, homeSourceId: 99, folder: null },
      ],
    } as never;
    component.columns = columns as never;
    component.ngOnChanges();

    expect(component.tables[0].measures).toEqual([{ folder: 'KPIs', measures: [expect.objectContaining({ name: 'Crew Count' })] }]);
    expect(component.measures.flatMap(g => g.measures.map(m => m.name))).toEqual(['Hours', 'Lost']);
    expect(component.folders).toEqual(['KPIs']);
  });

  it('moves a measure from its menu and by a drop on a table, and not when nothing changes', () => {
    const component = new DataPaneComponent();
    component.dataset = dataset as never;
    component.ngOnChanges();
    const placed: unknown[] = [];
    component.placeMeasure.subscribe(event => placed.push([event.measure.name, event.homeSourceId, event.folder]));
    const measure = dataset.measures[0] as never;
    const click = { type: 'click', preventDefault: vi.fn(), stopPropagation: vi.fn(), currentTarget: null, clientX: 10, clientY: 10 } as never;

    component.openMenu(click, measure);
    component.moveTo(2);
    component.openMenu(click, measure);
    component.putInFolder('  Targets ');
    component.openMenu(click, measure);
    component.moveTo(null);
    expect(component.menu).toBeNull();

    const drag = { preventDefault: vi.fn(), dataTransfer: null } as never;
    component.onMeasureDragStart({ ...(drag as object), dataTransfer: { setData: vi.fn() } } as never, measure);
    component.onDragOver(drag, 2);
    expect(component.dropTarget).toBe(2);
    component.onDrop(drag, 2);

    expect(placed).toEqual([['Crew Count', 2, null], ['Crew Count', null, 'Targets'], ['Crew Count', 2, null]]);
  });
});
