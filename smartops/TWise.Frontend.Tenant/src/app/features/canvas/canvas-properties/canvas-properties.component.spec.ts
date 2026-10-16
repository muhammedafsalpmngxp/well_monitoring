import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { CanvasItem, newItem } from '../canvas-config.util';
import { VISUALS, Visual } from '../canvas-wells.util';
import { CanvasPropertiesComponent } from './canvas-properties.component';
// Imported for its NgModule metadata only. CanvasPropertiesComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { CanvasModule } from '../canvas.module';

const chart: CanvasItem = {
  id: 'c1', type: 'chart', title: 'Tasks by crew', x: 0, y: 0, cols: 10, rows: 12,
  datasetId: 7, dimensions: ['CrewType.code'], measures: ['Task Count'], chartType: 'column',
};
const visual = (id: string) => VISUALS.find(candidate => candidate.id === id)!;

function pane(item: CanvasItem | null) {
  const component = new CanvasPropertiesComponent();
  component.item = item;
  component.canvasDatasetId = 7;
  const emitted: CanvasItem[] = [];
  const added: Visual[] = [];
  component.itemChange.subscribe(changed => emitted.push(changed));
  component.add.subscribe(chosen => added.push(chosen));
  return { component, emitted, added };
}

describe('CanvasPropertiesComponent', () => {
  it('adds a visual when nothing is selected, and changes a selected chart, tile or table', () => {
    const { component, emitted, added } = pane(null);
    component.chooseVisual(visual('pie'));
    expect(added.map(entry => entry.id)).toEqual(['pie']);
    expect(component.wells).toEqual([]);

    component.item = chart;
    expect(component.active).toBe('column');
    component.chooseVisual(visual('tile'));
    expect(emitted[0]).toMatchObject({ type: 'tile', dimensions: [], measures: ['Task Count'] });
    component.chooseVisual(visual('text'));
    expect(added.map(entry => entry.id)).toEqual(['pie', 'text']);
    expect(emitted).toHaveLength(1);
  });

  it('names well entries as the canvas names them', () => {
    const { component } = pane(chart);
    expect(component.entryName('Task Count')).toBe('Task Count');
    component.labels = { 'Task Count': 'Tasks done' };
    expect(component.entryName('Task Count')).toBe('Tasks done');
  });

  it('fills a well from a drop, refuses the wrong kind with a sentence, and removes entries', () => {
    const { component, emitted } = pane(chart);
    const [axis, values] = component.wells;
    const event = { preventDefault: vi.fn() } as unknown as DragEvent;

    component.dragging = { kind: 'measure', name: 'Hours' };
    component.onDragOver(event, values);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(component.dropTarget).toBe('values');
    component.onDrop(event, values);
    expect(emitted[0].measures).toEqual(['Task Count', 'Hours']);
    expect(component.dropTarget).toBeNull();

    component.onDrop(event, axis);
    expect(component.dropProblem).toBe('X-axis takes fields. Drag a field of a table here.');
    expect(emitted).toHaveLength(1);

    component.removeEntry(values, 'Task Count');
    expect(emitted[1].measures).toEqual(['Hours']);
  });

  it('offers to move an object on another data model, and edits text and image objects', () => {
    const { component, emitted } = pane({ ...chart, datasetId: 9 });
    component.datasetName = 'Canvas check';
    expect(component.foreign).toBe(true);
    expect(component.wells).toEqual([]);
    component.moveToCanvasDataset();
    expect(emitted[0]).toMatchObject({ datasetId: 7, dimensions: [], measures: [] });

    component.item = { ...newItem('text', [], null), id: 'x1' };
    expect(component.foreign).toBe(false);
    expect(component.problem).toBe('Write the text.');
    component.setText('Notes');
    component.item = { ...newItem('image', [], null), id: 'i1' };
    component.setImage('https://example.com/logo.png');
    component.setAlt('Logo');

    expect(emitted.slice(1).map(item => [item.text, item.imageUrl, item.alt])).toEqual([
      ['Notes', undefined, undefined], [undefined, 'https://example.com/logo.png', ''], [undefined, 'https://example.com/logo.png', 'Logo'],
    ]);
  });

  it('sets the number format, data labels and stacking of a chart', () => {
    const { component, emitted } = pane({ ...chart, series: 'TaskDaily.status' });
    expect(component.canStack).toBe(true);
    expect(component.hasDataLabels).toBe(true);

    component.setFormat('currency', '2', '');
    component.setFormat('compact', '9', 'USD');
    component.setFormat('');
    component.setDataLabels(true);
    component.setStacking('percent');
    component.setStacking('');
    expect(emitted.map(item => [item.format, item.dataLabels, item.stacking])).toEqual([
      [{ style: 'currency', decimals: 2, currency: 'OMR' }, undefined, undefined],
      [{ style: 'compact', decimals: 6 }, undefined, undefined],
      [undefined, undefined, undefined],
      [undefined, true, undefined],
      [undefined, true, 'percent'],
      [undefined, true, null],
    ]);

    component.item = { ...chart, chartType: 'pie' };
    expect(component.canStack).toBe(false);
    expect(component.hasDataLabels).toBe(false);
  });

  it('builds each edit on the one before, before the parent sends the object back', () => {
    const { component, emitted } = pane({ ...chart, format: { style: 'number', decimals: 1 } });
    component.setFormat('number', '4');
    component.setFormat('currency');
    expect(emitted[1].format).toEqual({ style: 'currency', decimals: 4, currency: 'OMR' });
  });

  it('sets the target value and the bands of a KPI card', () => {
    const { component, emitted } = pane({ ...chart, id: 't1', type: 'tile', dimensions: [], chartType: undefined });
    expect(component.wells.map(well => well.label)).toEqual(['Value', 'Target', 'Compare with']);

    component.setTargetValue('1200');
    component.setTargetValue('');
    component.setWarnAt('150');
    component.setLowerIsBetter(true);
    expect(emitted.map(item => [item.targetValue, item.warnAt, item.lowerIsBetter])).toEqual([
      [1200, undefined, undefined], [null, undefined, undefined], [null, 100, undefined], [null, 100, true],
    ]);
  });

  it('adds conditional formatting rules to a table, refuses an incomplete one and removes them', () => {
    const { component, emitted } = pane({ ...chart, id: 'r1', type: 'table', chartType: undefined });
    expect(component.ruleFields).toEqual(['CrewType.code', 'Task Count']);

    component.draftRule = { field: 'Task Count', op: 'between', values: ['10', ''], tone: 'warn' };
    component.addRule();
    expect(component.ruleError).toBe('Enter two numbers.');
    expect(emitted).toHaveLength(0);

    component.draftRule = { field: 'Task Count', op: 'gt', values: [' 100 ', 'ignored'], tone: 'bad' };
    component.addRule();
    expect(component.ruleError).toBe('');
    expect(emitted[0].rules).toEqual([{ field: 'Task Count', op: 'gt', values: ['100'], tone: 'bad' }]);
    expect(component.draftRule).toMatchObject({ field: 'Task Count', values: ['', ''] });
    expect(component.ruleText(emitted[0].rules![0])).toBe('Task Count is more than 100');

    component.item = emitted[0];
    component.removeRule(0);
    expect(emitted[1].rules).toBeUndefined();
  });

  it('changes a slicer style, keeping the choice only when the kind of choice stays, and sets single select and sync', () => {
    const { component, emitted } = pane({ ...chart, id: 's1', type: 'slicer', chartType: undefined, measures: [], slicer: { kind: 'list', values: ['WL', 'NP'] } });
    expect(component.formats).toBe(false);

    component.setSlicerStyle('tiles');
    expect(emitted[0].slicer).toEqual({ kind: 'list', values: ['WL', 'NP'], style: 'tiles' });
    component.setSlicerStyle('between');
    expect(emitted[1].slicer).toEqual({ kind: 'range', values: [], style: 'between' });

    component.item = emitted[0];
    component.setSingle(true);
    expect(emitted[2].slicer).toEqual({ kind: 'list', values: ['WL'], style: 'tiles', single: true });
    component.otherSheets = ['Detail', 'Map'];
    component.setSync('chosen');
    component.item = emitted[3];
    expect(component.syncMode).toBe('chosen');
    component.toggleSyncSheet('Map', true);
    expect(emitted[4].slicer!.sync).toEqual(['Map']);
  });
});
