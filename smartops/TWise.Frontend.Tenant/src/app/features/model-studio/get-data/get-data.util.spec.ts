import { describe, expect, it } from 'vitest';
import { DbSchemaTable } from '../../../core/services/common-api.service';
import { DatasetConnection, DatasetDetail, ImportTable, ViewChoice } from '../../../core/services/model-studio.service';
import { filterItems, itemOrigin, navigatorItems, newSettings, settingsProblem, sourceBody, viewOffer } from './get-data.util';

const table = (schemaName: string, tableName: string, ...columns: string[]) => ({
  schemaName, tableName, columnCount: columns.length, columns: columns.map((columnName, i) => ({ columnName, ordinalPosition: i + 1 })),
}) as unknown as DbSchemaTable;

const dataset = {
  id: 1, sources: [{ id: 1, schemaName: 'core', sourceName: 'TaskDaily', alias: 'TaskDaily', rlsMode: 'none', rlsPlantColumn: null }],
} as unknown as DatasetDetail;

const tables = [table('ref', 'CrewType', 'crew_type_id', 'code'), table('core', 'TaskDaily', 'task_daily_id'), table('import', 'Crew_hours', 'Crew', 'Hours')];

const views: ViewChoice[] = [
  { id: 12, name: 'Crew types', description: 'One row per crew type.', usable: true, problems: [], columns: [{ name: 'crew_code', dataType: 'nvarchar(20)' }] },
  { id: 13, name: 'Commissioning', description: '', usable: false, problems: ['Rule 4: The description does not state the grain.'], columns: [] },
];

const imports: ImportTable[] = [
  { id: 3, tableName: 'Crew_hours', fileName: 'crew.xlsx', sheetName: 'Hours', headerRow: 3, lastRow: 7, loadedRows: 3, modifiedAt: '' },
];

describe('get data navigator helpers', () => {
  it('lists tenant tables, views greyed out with their reasons, uploaded tables and the sheets of a new file', () => {
    const items = navigatorItems(dataset, tables, views, imports, ['Hours', 'Cover']);

    expect(items.map(item => [item.group, item.label, item.added, item.disabled])).toEqual([
      ['tables', 'core.TaskDaily', true, true],
      ['tables', 'ref.CrewType', false, false],
      ['views', 'Crew types', false, false],
      ['views', 'Commissioning', false, true],
      ['files', 'Crew_hours', false, false],
      ['files', 'Hours', false, false],
      ['files', 'Cover', false, false],
    ]);
    expect(items[3].reasons).toEqual(['Rule 4: The description does not state the grain.']);
    expect(items[4].columns).toEqual(['Crew', 'Hours']);
    expect(items[4].detail).toBe('crew.xlsx, Hours, 3 rows');
    expect(items[2].source).toEqual({ kind: 'view', schemaName: 'view', sourceName: '12' });
  });

  it('finds entries by name, detail or column, ignoring case', () => {
    const items = navigatorItems(dataset, tables, views, imports, []);

    expect(filterItems(items, 'CODE').map(item => item.label)).toEqual(['ref.CrewType', 'Crew types']);
    expect(filterItems(items, ' ')).toHaveLength(items.length);
  });

  it('suggests a free name in the data model from the table, the view or the sheet', () => {
    const items = navigatorItems(dataset, tables, views, imports, ['Hours']);

    expect(newSettings(items[1], ['TaskDaily'])).toEqual({ alias: 'CrewType', rlsMode: '', plantColumn: '' });
    expect(newSettings(items[2], []).alias).toBe('Crew_types');
    expect(newSettings(items[5], ['Crew_hours_Hours'], 'Crew_hours_Hours'))
      .toEqual({ alias: 'Crew_hours_Hours2', rlsMode: '', plantColumn: '', tableName: 'Crew_hours_Hours' });
  });

  it('names the first thing to settle before an item can be loaded', () => {
    const [, crews] = navigatorItems(dataset, tables, views, imports, []);
    const settings = newSettings(crews, []);

    expect(settingsProblem(crews, undefined, [])).toBe('Choose how to load ref.CrewType.');
    expect(settingsProblem(crews, { ...settings, alias: '1crew' }, [])).toContain('letters, digits and underscores');
    expect(settingsProblem(crews, settings, ['crewtype'])).toBe('ref.CrewType: another table is already called CrewType.');
    expect(settingsProblem(crews, settings, [])).toBe('ref.CrewType: choose who sees which rows.');
    expect(settingsProblem(crews, { ...settings, rlsMode: 'plant' }, [])).toBe('ref.CrewType: choose the column that holds the plant code.');
    expect(settingsProblem(crews, { ...settings, rlsMode: 'none' }, [])).toBe('');
  });

  it('builds the add-source body of a view and of a loaded sheet', () => {
    const items = navigatorItems(dataset, tables, views, imports, ['Hours']);

    expect(sourceBody(items[2], { alias: 'Crews', rlsMode: 'plant', plantColumn: 'plant_code' }))
      .toEqual({ schemaName: 'view', sourceName: '12', alias: 'Crews', kind: 'view', rlsMode: 'plant', rlsPlantColumn: 'plant_code' });
    expect(sourceBody(items[5], { alias: 'Hours', rlsMode: 'none', plantColumn: 'x', tableName: 'Crew_hours_2' }, 'Crew_hours_2'))
      .toEqual({ schemaName: 'import', sourceName: 'Crew_hours_2', alias: 'Hours', kind: 'table', rlsMode: 'none', rlsPlantColumn: null });
  });
  const connections: DatasetConnection[] = [
    { id: 4, connectionName: 'Tenant database', databaseName: 'smartops_tenant_TNT-1000', joinable: true },
    { id: 7, connectionName: 'BI', databaseName: 'AlTasnimBI', joinable: true },
  ];
  const biTables = [table('dbo', 'Orders', 'order_id'), table('import', 'Budget', 'amount'), table('core', 'TaskDaily', 'task_daily_id')];

  it('lists the tables of another database with their database, keeps views and uploads on the model database', () => {
    const withBi = { ...dataset, connectionId: 4, sources: [...dataset.sources, { id: 2, schemaName: 'dbo', sourceName: 'Orders', alias: 'Orders', connectionId: 7 }] } as DatasetDetail;
    const items = navigatorItems(withBi, tables, views, imports, [], { connection: connections[1], tables: biTables });

    expect(items.filter(item => item.group === 'tables').map(item => [item.key, item.added, item.database])).toEqual([
      ['table:7:core.taskdaily', false, 'AlTasnimBI'],
      ['table:7:dbo.orders', true, 'AlTasnimBI'],
      ['table:7:import.budget', false, 'AlTasnimBI'],
    ]);
    expect(items.filter(item => item.group !== 'tables').every(item => !item.database && !item.source?.connectionId)).toBe(true);
    expect(items.find(item => item.group === 'files')!.columns).toEqual(['Crew', 'Hours']);
  });

  it('sends the connection of a table of another database and nothing for the model database', () => {
    const [bi] = navigatorItems(dataset, tables, views, imports, [], { connection: connections[1], tables: biTables });
    const [own] = navigatorItems(dataset, tables, views, imports, []);
    const settings = { alias: 'T', rlsMode: 'none' as const, plantColumn: '' };

    expect(sourceBody(bi, settings)).toEqual({
      schemaName: 'core', sourceName: 'TaskDaily', alias: 'T', kind: 'table', rlsMode: 'none', rlsPlantColumn: null, connectionId: 7,
    });
    expect(sourceBody(own, settings)).not.toHaveProperty('connectionId');
  });

  it('says where an entry comes from: database, schema and table, or the view by name and id', () => {
    const withConnection = { ...dataset, connectionId: 4 } as DatasetDetail;
    const [bi] = navigatorItems(withConnection, tables, views, imports, [], { connection: connections[1], tables: biTables });
    const items = navigatorItems(withConnection, tables, views, imports, ['Hours']);

    expect(itemOrigin(bi, withConnection, connections)!.rows).toEqual([
      { label: 'Database', value: 'AlTasnimBI (BI)' }, { label: 'Schema', value: 'core' }, { label: 'Table', value: 'TaskDaily' },
    ]);
    expect(itemOrigin(items[2], withConnection, connections)!.rows).toEqual([
      { label: 'Database', value: 'smartops_tenant_TNT-1000 (Tenant database)' }, { label: 'View', value: 'Crew types' }, { label: 'View id', value: '12' },
    ]);
    expect(itemOrigin(items[4], withConnection, connections)!.path).toBe('smartops_tenant_TNT-1000.import.Crew_hours');
    expect(itemOrigin(items[5], withConnection, connections)).toBeNull();
  });

  it('offers a view that fails the contract but runs as written as a saved view, with the contract reasons as its note', () => {
    const saved: ViewChoice = {
      id: 10117, name: 'Well delivery', description: null, usable: false, problems: ['Rule 1: It has more than one statement.'],
      columns: [{ name: 'Category', dataType: 'varchar(40)' }], asScript: true, scriptProblems: [],
    };
    const broken: ViewChoice = { ...saved, id: 10118, asScript: false, scriptProblems: ['It runs EXEC.'] };

    expect(viewOffer(views[0])).toEqual({ kind: 'view', schemaName: 'view', detail: '1 columns', reasons: [], note: [] });
    expect(viewOffer(saved)).toEqual({
      kind: 'script', schemaName: 'script', detail: 'Add as saved view (runs as written)', reasons: [],
      note: ['Rule 1: It has more than one statement.'],
    });
    expect(viewOffer(broken).reasons).toEqual(['Rule 1: It has more than one statement.', 'It runs EXEC.']);
    expect(viewOffer(views[1])).toMatchObject({ kind: 'view', reasons: ['Rule 4: The description does not state the grain.'] });

    const [item] = navigatorItems(dataset, [], [saved], [], []);
    expect([item.disabled, item.note, item.source]).toEqual([
      false, ['Rule 1: It has more than one statement.'], { kind: 'script', schemaName: 'script', sourceName: '10117' },
    ]);
    expect(newSettings(item, []).alias).toBe('Well_delivery');
    expect(sourceBody(item, { alias: 'Delivery', rlsMode: 'none', plantColumn: '' }).kind).toBe('script');
  });
});
