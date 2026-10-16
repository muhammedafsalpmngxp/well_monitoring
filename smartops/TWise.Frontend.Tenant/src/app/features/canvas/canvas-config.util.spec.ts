import { describe, expect, it } from 'vitest';
import { DbSchemaColumn } from '../../core/services/common-api.service';
import { DatasetDetail } from '../../core/services/model-studio.service';
import { tableKey } from '../model-studio/model-studio.util';
import {
  drillView, levelLabel, recordFields,
  copyItem, readCanvasLook,
  CanvasItem, CrossFilter, SLICER_VALUE_LIMIT, imageUrlProblem, isForeign, itemProblem, itemQuery, moveToDataset, newCanvasConfig,
  measuresOnAxis, newItem, readCanvasConfig, readCanvasDataset, renameMeasure, serializeCanvas, sheetFilters, withDataset,
} from './canvas-config.util';

const chart: CanvasItem = {
  id: 'c1', type: 'chart', title: 'Tasks by crew', x: 0, y: 0, cols: 10, rows: 12,
  datasetId: 7, dimensions: ['CrewType.code'], measures: ['Task Count'], chartType: 'column',
};
const tile: CanvasItem = {
  id: 't1', type: 'tile', title: 'Tasks', x: 10, y: 0, cols: 4, rows: 5, datasetId: 7, dimensions: [], measures: ['Task Count'],
};

describe('chart sort', () => {
  it('orders the axis by another field, which the query groups by too, or by the value either way', () => {
    const months: CanvasItem = { ...chart, dimensions: ['t.month_name'], sortBy: 't.month_no', sortOrder: 'axis_asc' };
    expect(itemQuery(months)).toEqual(expect.objectContaining({ dimensions: ['t.month_name', 't.month_no'], sort: { field: 't.month_no', descending: false } }));
    expect(itemQuery({ ...months, sortOrder: 'value_asc' })).toEqual(expect.objectContaining({ dimensions: ['t.month_name'], sort: { field: 'Task Count', descending: false } }));
    expect(itemQuery({ ...chart, sortOrder: 'axis_desc' })?.sort).toEqual({ field: 'CrewType.code', descending: true });
    expect(itemQuery(chart)?.sort).toEqual({ field: 'Task Count', descending: true });
  });
});

describe('drill down', () => {
  const years: CanvasItem = { ...chart, dimensions: ['t.action_on@year', 't.action_on@month', 'CrewType.code'] };

  it('reads a hierarchy one level at a time, filtered to the values chosen above', () => {
    expect(itemProblem(years)).toBe('');
    expect(itemQuery(years)?.dimensions).toEqual(['t.action_on@year']);
    const view = drillView(years, ['2026', null]);
    expect(view.item.dimensions).toEqual(['CrewType.code']);
    expect(view.filters).toEqual([{ field: 't.action_on@year', op: 'eq', values: ['2026'] }, { field: 't.action_on@month', op: 'is_null' }]);
    expect(drillView(chart, ['x'])).toEqual({ item: chart, filters: [] });
    expect(itemProblem({ ...years, chartType: 'combo', measures: ['A', 'B'] })).toBe('Choose one field to group by.');
  });

  it('names a date level after its column', () => {
    expect(levelLabel('t.action_on@quarter')).toBe('action_on (Quarter)');
    expect(levelLabel('t.action_on@year', { 't.action_on': 'Log date' })).toBe('Log date (Year)');
    expect(levelLabel('CrewType.code')).toBe('code');
  });
});

describe('recordFields', () => {
  const dataset = {
    id: 7, sources: [
      { id: 1, schemaName: 'core', sourceName: 'TaskDaily', alias: 't', hiddenColumns: ['secret'] },
      { id: 2, schemaName: 'ref', sourceName: 'CrewType', alias: 'c' },
    ],
    measures: [{ id: 3, name: 'Task Count', homeSourceId: 1 }], calculatedColumns: [], relationships: [], transforms: [],
  } as unknown as DatasetDetail;
  const column = (name: string) => ({ columnName: name, dataType: 'int', isPrimaryKey: false, isForeignKey: false }) as DbSchemaColumn;
  const columns = new Map([[tableKey('core', 'TaskDaily'), ['id', 'secret', 'hours'].map(column)], [tableKey('ref', 'CrewType'), ['code'].map(column)]]);

  it('lists the visible columns of the table the first measure adds up, or of the first field', () => {
    expect(recordFields({ ...chart, dimensions: ['c.code'] }, dataset, columns)).toEqual(['t.id', 't.hours']);
    expect(recordFields({ ...chart, dimensions: ['c.code'], measures: [] }, dataset, columns)).toEqual(['c.code']);
  });
});

describe('readCanvasConfig', () => {
  it('leaves v1 dashboards and unreadable JSON to the dashboard reader', () => {
    expect(readCanvasConfig('{"widgets":[{"chartId":1,"sortOrder":1,"type":"chart"}],"layout":{"version":1,"columns":20,"items":[]}}'))
      .toBeNull();
    expect(readCanvasConfig(null)).toBeNull();
    expect(readCanvasConfig('not json')).toBeNull();
    expect(readCanvasConfig('{"kind":"canvas","layout":{"version":1,"items":[]}}')).toBeNull();
  });

  it('reads a canvas and drops objects it cannot place', () => {
    const json = JSON.stringify({
      kind: 'canvas',
      layout: { version: 2, columns: 20, sheets: [{ name: 'Overview', items: [chart, { ...tile, type: 'map' }, { ...tile, id: 't2', x: 18 }, tile] }] },
    });

    expect(readCanvasConfig(json)).toEqual([{ name: 'Overview', items: [chart, tile] }]);
  });

  it('always gives at least one named sheet', () => {
    expect(readCanvasConfig('{"kind":"canvas","layout":{"version":2,"columns":20,"sheets":[]}}')).toEqual([{ name: 'Sheet 1', items: [] }]);
    expect(readCanvasConfig('{"kind":"canvas","layout":{"version":2,"columns":20,"sheets":[{"name":"A","items":[]},{"name":"  ","items":null}]}}'))
      .toEqual([{ name: 'A', items: [] }, { name: 'Sheet 2', items: [] }]);
  });
});

describe('serializeCanvas', () => {
  it('writes kind first, keeps only the stored properties and reads back to the same sheets', () => {
    const json = serializeCanvas([{ name: 'Overview', items: [{ ...chart, layerIndex: 3 } as CanvasItem, tile] }, { name: 'Detail', items: [] }]);

    expect(json.startsWith('{"kind":"canvas","layout":{"version":2,"columns":20,"sheets":[')).toBe(true);
    expect(json).not.toContain('layerIndex');
    expect(readCanvasConfig(json)).toEqual([{ name: 'Overview', items: [chart, tile] }, { name: 'Detail', items: [] }]);
  });

  it('starts a new canvas with one empty sheet', () => {
    expect(readCanvasConfig(newCanvasConfig())).toEqual([{ name: 'Sheet 1', items: [] }]);
  });
});

describe('newItem', () => {
  it('places a new object at the left edge below the others, with its default size', () => {
    const table = newItem('table', [chart, tile], 7);
    const another = newItem('tile', [chart, tile], null);

    expect(table).toMatchObject({ type: 'table', title: 'New table', x: 0, y: 12, cols: 10, rows: 12, datasetId: 7, dimensions: [], measures: [] });
    expect(table.chartType).toBeUndefined();
    expect(another).toMatchObject({ type: 'tile', y: 12, cols: 5, rows: 6, datasetId: null });
    expect(newItem('chart', [], 7)).toMatchObject({ y: 0, chartType: 'column' });
    expect(table.id).not.toBe(another.id);
  });
});

describe('itemProblem and itemQuery', () => {
  it('names what an object still needs and sends no query until it is complete', () => {
    expect(itemProblem({ ...chart, datasetId: null })).toBe('Choose a data model.');
    expect(itemProblem({ ...chart, chartType: 'line', dimensions: [] })).toBe('Choose one field to group by.');
    expect(itemProblem({ ...chart, measures: [] })).toBe('Choose at least one measure.');
    expect(itemProblem({ ...chart, chartType: 'pie', measures: ['Task Count', 'Hours'] })).toBe('A pie chart shows one measure. Keep one.');
    expect(itemProblem({ ...tile, measures: [] })).toBe('Choose one measure.');
    expect(itemProblem({ ...tile, type: 'table', measures: [] })).toBe('Choose at least one field or measure.');
    expect(itemProblem(chart)).toBe('');
    expect(itemQuery({ ...chart, measures: [] })).toBeNull();
  });

  it('asks charts for the largest values first, and lines in field order', () => {
    expect(itemQuery(chart)).toEqual({
      datasetId: 7, dimensions: ['CrewType.code'], measures: ['Task Count'], topN: 50, sort: { field: 'Task Count', descending: true },
    });
    expect(itemQuery({ ...chart, chartType: 'line' })?.sort).toEqual({ field: 'CrewType.code', descending: false });
  });

  it('limits tables to 200 rows, asks for their grand total unless it is off, and sends a tile its one measure', () => {
    expect(itemQuery({ ...tile, type: 'table', dimensions: ['CrewType.code'] }))
      .toEqual({ datasetId: 7, dimensions: ['CrewType.code'], measures: ['Task Count'], topN: 200, totals: true });
    expect(itemQuery({ ...tile, type: 'table', dimensions: ['CrewType.code'], totals: false }))
      .toEqual({ datasetId: 7, dimensions: ['CrewType.code'], measures: ['Task Count'], topN: 200 });
    expect(itemQuery(tile)).toEqual({ datasetId: 7, dimensions: [], measures: ['Task Count'] });
  });
});

describe('choices', () => {
  it('clears fields and measures when the data model changes', () => {
    expect(withDataset(chart, 7)).toBe(chart);
    expect(withDataset(chart, 8)).toEqual({ ...chart, datasetId: 8, dimensions: [], measures: [] });
  });

});

describe('one data model per canvas', () => {
  it('stores the canvas data model after the sheets and reads it back', () => {
    const json = serializeCanvas([{ name: 'Overview', items: [chart] }], 7);

    expect(json.startsWith('{"kind":"canvas","layout":{"version":2,"columns":20,"sheets":[')).toBe(true);
    expect(json.endsWith('"datasetId":7}}')).toBe(true);
    expect(readCanvasDataset(json)).toBe(7);
    expect(readCanvasDataset(newCanvasConfig())).toBeNull();
    expect(readCanvasDataset('{"widgets":[]}')).toBeNull();
  });

  it('takes the first object data model, in sheet order, for a canvas saved before it had one', () => {
    const legacy = JSON.stringify({ kind: 'canvas', layout: { version: 2, columns: 20, sheets: [
      { name: 'A', items: [{ ...tile, datasetId: null }] },
      { name: 'B', items: [{ ...chart, datasetId: 9 }, { ...tile, id: 't2', datasetId: 7 }] },
    ] } });

    expect(readCanvasDataset(legacy)).toBe(9);
  });

  it('moves data objects to a data model and tells which ones are still on another', () => {
    const text = newItem('text', [], 7);

    expect(text.datasetId).toBeNull();
    expect(moveToDataset([chart, { ...tile, datasetId: 8 }, text], 8)).toEqual([
      { ...chart, datasetId: 8, dimensions: [], measures: [] }, { ...tile, datasetId: 8 }, text,
    ]);
    expect(isForeign(chart, 8)).toBe(true);
    expect(isForeign(chart, 7)).toBe(false);
    expect(isForeign({ ...chart, datasetId: null }, 8)).toBe(false);
    expect(isForeign(text, 8)).toBe(false);
  });

  it('renames a measure on the objects of its data model only', () => {
    expect(renameMeasure([chart, { ...tile, datasetId: 8 }], 7, 'Task Count', 'Tasks'))
      .toEqual([{ ...chart, measures: ['Tasks'] }, { ...tile, datasetId: 8 }]);
  });
});

describe('text and image objects', () => {
  it('need no data model and send no query', () => {
    const text: CanvasItem = { ...newItem('text', [chart], 7), text: 'Crew hours, September' };
    const image: CanvasItem = { ...newItem('image', [], null), imageUrl: 'https://example.com/logo.png', alt: 'Logo' };

    expect(text).toMatchObject({ type: 'text', title: 'Text', x: 0, y: 12, cols: 6, rows: 4, datasetId: null, dimensions: [], measures: [] });
    expect(itemProblem({ ...text, text: '  ' })).toBe('Write the text.');
    expect(itemProblem(text)).toBe('');
    expect(itemQuery(text)).toBeNull();
    expect(itemProblem(image)).toBe('');
    expect(itemQuery(image)).toBeNull();
  });

  it('take an image from an https address, a path on this site or a small embedded image', () => {
    expect(imageUrlProblem('')).toBe('Enter the address of the image.');
    expect(imageUrlProblem('/assets/al-tasnim-logo.svg')).toBe('');
    expect(imageUrlProblem(' https://example.com/a.png ')).toBe('');
    expect(imageUrlProblem('data:image/png;base64,AAAA')).toBe('');
    for (const bad of ['http://example.com/a.png', 'javascript:alert(1)', 'data:image/svg+xml;base64,AAAA', '//example.com/a.png', '/\\example.com/a.png', 'logo.png']) {
      expect(imageUrlProblem(bad)).toBe(
        'Use an address that starts with https://, a path on this site that starts with /, or upload a png, jpeg, gif or webp under 300 KB.');
    }
  });

  it('keep the style of an object and the page of a sheet through a save, checked as they are read', () => {
    const text: CanvasItem = { ...newItem('text', [], null), id: 'x1', text: '', style: { html: '<b>Crew</b>', background: '#ffffff', radius: 12 } };
    const json = serializeCanvas([{ name: 'A', items: [text], page: { theme: 'ocean', wallpaper: '#0b1220' } }]);

    expect(readCanvasConfig(json)).toEqual([{ name: 'A', items: [text], page: { theme: 'ocean', wallpaper: '#0b1220' } }]);
    const tampered = json.replace('<b>Crew</b>', '<b>Crew</b><img src=x onerror=alert(1)>').replace('"radius":12', '"radius":"big"');
    expect(readCanvasConfig(tampered)![0].items[0].style).toEqual({ html: '<b>Crew</b>', background: '#ffffff' });
    expect(itemProblem(text)).toBe('');
  });

  it('keep their text and image through a save, and refuse values that are not text', () => {
    const text: CanvasItem = { ...newItem('text', [], null), id: 'x1', text: 'Notes' };
    const image: CanvasItem = { ...newItem('image', [], null), id: 'i1', y: 4, imageUrl: '/assets/al-tasnim-logo.svg', alt: 'Al Tasnim' };
    const json = serializeCanvas([{ name: 'A', items: [text, image] }]);

    expect(readCanvasConfig(json)).toEqual([{ name: 'A', items: [text, image] }]);
    expect(readCanvasConfig(json.replace('"text":"Notes"', '"text":42'))).toEqual([{ name: 'A', items: [image] }]);
  });
});

describe('the visuals of plan 10', () => {
  it('says what each new visual still needs', () => {
    const problem = (patch: Partial<CanvasItem>) => itemProblem({ ...chart, ...patch });
    expect(problem({ chartType: 'donut', measures: ['Task Count', 'Hours'] })).toBe('A donut chart shows one measure. Keep one.');
    expect(problem({ chartType: 'combo' })).toBe('A combo chart needs two measures: the first is drawn as columns, the rest as lines.');
    expect(problem({ chartType: 'combo', measures: ['Task Count', 'Hours'] })).toBe('');
    expect(problem({ series: 'CrewType.code' })).toBe('Choose a different field for Legend than for the X-axis.');
    expect(problem({ series: 'TaskDaily.status', measures: ['Task Count', 'Hours'] }))
      .toBe('Legend splits one measure. Keep one measure, or remove the Legend field.');
    expect(itemProblem({ ...tile, gauge: true })).toBe('A gauge needs a target. Drag a measure onto Target, or enter a target value.');
    expect(itemProblem({ ...tile, gauge: true, targetValue: 500 })).toBe('');

    const matrix: CanvasItem = { ...newItem('matrix', [], 7), dimensions: ['CrewType.code'] };
    expect(matrix).toMatchObject({ type: 'matrix', title: 'New matrix', totals: true });
    expect(itemProblem(matrix)).toBe('Choose at least one field for Rows and one measure for Values.');
    expect(itemProblem({ ...matrix, dimensions: ['a.b', 'a.c', 'a.d', 'a.e'], measures: ['Task Count'] }))
      .toBe('A matrix groups by up to 3 fields. Remove one from Rows.');

    const slicer = newItem('slicer', [], 7);
    expect(slicer).toMatchObject({ type: 'slicer', title: 'New slicer', cols: 4, rows: 8, datasetId: 7, slicer: { kind: 'list', values: [] } });
    expect(itemProblem(slicer)).toBe('Choose one field to slice by.');
    expect(itemProblem({ ...slicer, dimensions: ['CrewType.code'] })).toBe('');
  });

  it('asks the server for what each new visual shows', () => {
    expect(itemQuery({ ...chart, series: 'TaskDaily.status' })).toEqual({
      datasetId: 7, dimensions: ['CrewType.code', 'TaskDaily.status'], measures: ['Task Count'], topN: 400,
      sort: { field: 'CrewType.code', descending: false },
      filters: [
        { field: 'TaskDaily.status', op: 'top', values: ['8', 'Task Count'] },
        { field: 'CrewType.code', op: 'top', values: ['50', 'Task Count'] },
      ],
    });
    expect(itemQuery({ ...chart, chartType: 'line', series: 'TaskDaily.status' })?.filters).toEqual([{ field: 'TaskDaily.status', op: 'top', values: ['8', 'Task Count'] }]);
    expect(itemQuery({ ...chart, chartType: 'pie', series: 'TaskDaily.status' })?.dimensions).toEqual(['CrewType.code']);
    expect(itemQuery({ ...chart, chartType: 'waterfall' })?.sort).toEqual({ field: 'CrewType.code', descending: false });
    expect(itemQuery({ ...chart, chartType: 'funnel' })?.sort).toEqual({ field: 'Task Count', descending: true });
    expect(itemQuery({ ...tile, target: 'Task Target', compare: 'Task Count' })?.measures).toEqual(['Task Count', 'Task Target']);
    expect(itemQuery({ ...newItem('matrix', [], 7), dimensions: ['CrewType.code'], measures: ['Task Count'] })).toEqual({
      datasetId: 7, dimensions: ['CrewType.code'], measures: ['Task Count'], topN: 500, totals: true,
    });
    expect(itemQuery({ ...newItem('slicer', [], 7), dimensions: ['CrewType.code'] })).toEqual({
      datasetId: 7, dimensions: ['CrewType.code'], measures: [], topN: SLICER_VALUE_LIMIT, sort: { field: 'CrewType.code', descending: false },
    });
    const filters = [{ field: 'CrewType.code', op: 'eq' as const, values: ['WL'] }];
    expect(itemQuery(tile, filters)).toEqual({ datasetId: 7, dimensions: [], measures: ['Task Count'], filters });
  });

  it('filters the objects of a sheet by its slicers and the clicked point, but never an object by itself', () => {
    const list: CanvasItem = { ...newItem('slicer', [], 7), id: 's1', dimensions: ['CrewType.code'], slicer: { kind: 'list', values: ['WL', 'RG'] } };
    const range: CanvasItem = { ...newItem('slicer', [], 7), id: 's2', dimensions: ['TaskDaily.data_hours'], slicer: { kind: 'range', values: ['2', ''] } };
    const empty: CanvasItem = { ...newItem('slicer', [], 7), id: 's3', dimensions: ['TaskDaily.status'] };
    const other: CanvasItem = { ...tile, id: 't9', datasetId: 8 };
    const items = [chart, tile, list, range, empty, other];
    const cross: CrossFilter = { sourceId: 'c1', field: 'CrewType.code', values: [null] };

    expect(sheetFilters(items, tile, 7, cross)).toEqual([
      { field: 'CrewType.code', op: 'in', values: ['WL', 'RG'] },
      { field: 'TaskDaily.data_hours', op: 'gte', values: ['2'] },
      { field: 'CrewType.code', op: 'is_null' },
    ]);
    expect(sheetFilters(items, chart, 7, cross)).toHaveLength(2);
    expect(sheetFilters(items, list, 7, null)).toEqual([{ field: 'TaskDaily.data_hours', op: 'gte', values: ['2'] }]);
    expect(sheetFilters(items, other, 7, cross)).toEqual([]);
    expect(sheetFilters([{ ...range, slicer: { kind: 'range', values: ['2', '8'] } }], tile, 7, { ...cross, values: ['WL'] })).toEqual([
      { field: 'TaskDaily.data_hours', op: 'between', values: ['2', '8'] },
      { field: 'CrewType.code', op: 'eq', values: ['WL'] },
    ]);
  });

  it('keeps formats, rules, targets and slicer choices through a save, and drops an object whose settings are broken', () => {
    const formatted: CanvasItem = {
      ...chart, series: 'TaskDaily.status', stacking: 'percent', dataLabels: true, format: { style: 'currency', decimals: 2, currency: 'OMR' },
    };
    const card: CanvasItem = { ...tile, target: 'Task Target', targetValue: null, compare: 'Last month', warnAt: 80, lowerIsBetter: true };
    const table: CanvasItem = {
      ...chart, id: 'r1', type: 'table', chartType: undefined, rules: [{ field: 'Task Count', op: 'gt', values: ['100'], tone: 'bad' }],
    };
    const slicer: CanvasItem = { ...newItem('slicer', [], 7), id: 's1', y: 20, dimensions: ['CrewType.code'], slicer: { kind: 'list', values: ['WL'] } };
    const json = serializeCanvas([{ name: 'A', items: [formatted, card, table, slicer] }], 7);

    expect(readCanvasConfig(json)).toEqual([{ name: 'A', items: [formatted, card, table, slicer] }]);
    for (const broken of [
      { ...formatted, format: { style: 'money', decimals: 2 } },
      { ...formatted, stacking: 'side' },
      { ...card, warnAt: 150 },
      { ...table, rules: [{ field: 'Task Count', op: 'like', values: [], tone: 'bad' }] },
      { ...slicer, slicer: { kind: 'list', values: [7] } },
    ]) {
      expect(readCanvasConfig(serializeCanvas([{ name: 'A', items: [broken as unknown as CanvasItem] }]))).toEqual([{ name: 'A', items: [] }]);
    }
  });

  it('copies an object with a new id next to the original, below it, or under everything', () => {
    const a = { id: 'a', type: 'tile', title: 'A', x: 0, y: 0, cols: 5, rows: 6, datasetId: 7, dimensions: [], measures: ['Oil'],
      filters: [{ field: 'w.Region', kind: 'text', mode: 'basic', values: ['N'] }] } as CanvasItem;
    const right = copyItem(a, [a]);
    expect(right).toEqual({ ...a, id: right.id, x: 5, y: 0 });
    expect(right.id).not.toBe('a');
    expect(right.filters).not.toBe(a.filters);

    const wide = { ...a, id: 'w', cols: 20 };
    expect([copyItem(wide, [wide]).x, copyItem(wide, [wide]).y]).toEqual([0, 6]);

    const blockers = [wide, { ...a, id: 'b', x: 0, y: 6, cols: 20, rows: 4 }];
    expect([copyItem(wide, blockers).x, copyItem(wide, blockers).y]).toEqual([0, 10]);
  });

  it('saves the brand kit and page size with the canvas', () => {
    const json = serializeCanvas([{ name: 'A', items: [] }], 7, { brand: { font: 'Arial' }, size: { preset: 'a4', width: 1123, height: 794 } });
    expect(readCanvasLook(json)).toEqual({ brand: { font: 'Arial' }, size: { preset: 'a4', width: 1123, height: 794 } });
    expect(readCanvasLook(serializeCanvas([{ name: 'A', items: [] }]))).toEqual({ brand: null, size: null });
  });

  it('keeps floating text and images with a sane box, and offsets a floating copy', () => {
    const logo = { id: 'l', type: 'image', title: 'Logo', x: 0, y: 0, cols: 3, rows: 3, datasetId: null, dimensions: [], measures: [],
      imageUrl: '/assets/logo.svg', alt: '', float: { x: 20, y: 10, w: 160, h: 60 } } as CanvasItem;
    const tile = { id: 't', type: 'tile', title: 'T', x: 0, y: 0, cols: 3, rows: 3, datasetId: 7, dimensions: [], measures: ['M'], float: logo.float } as CanvasItem;
    const read = readCanvasConfig(serializeCanvas([{ name: 'A', items: [logo, tile, { ...logo, id: 'bad', float: { x: -5, y: 0, w: 10, h: 10 } }] }]))![0].items;
    expect(read.map(item => item.id)).toEqual(['l']);
    expect(read[0].float).toEqual({ x: 20, y: 10, w: 160, h: 60 });
    expect(copyItem(logo, [logo]).float).toEqual({ x: 36, y: 26, w: 160, h: 60 });
  });
});

describe('measures on the axis', () => {
  const plan: CanvasItem = { ...chart, dimensions: [], measures: ['Plan', 'Plan Due', 'Completed'] };

  it('lets a column or bar chart with no axis field show one bar per measure', () => {
    expect(itemProblem(plan)).toBe('');
    expect(itemProblem({ ...plan, chartType: 'bar' })).toBe('');
    expect(measuresOnAxis(plan)).toBe(true);
  });

  it('still asks for an axis field on other charts, or when a legend field is set', () => {
    expect(itemProblem({ ...plan, chartType: 'line' })).toBe('Choose one field to group by.');
    expect(itemProblem({ ...plan, series: 'CrewType.code' })).toBe('Choose one field to group by.');
    expect(measuresOnAxis({ ...plan, chartType: 'line' })).toBe(false);
    expect(measuresOnAxis(chart)).toBe(false);
  });

  it('reads every measure in one row, without a sort or a row limit', () => {
    expect(itemQuery(plan)).toEqual({ datasetId: 7, dimensions: [], measures: ['Plan', 'Plan Due', 'Completed'] });
  });
});
