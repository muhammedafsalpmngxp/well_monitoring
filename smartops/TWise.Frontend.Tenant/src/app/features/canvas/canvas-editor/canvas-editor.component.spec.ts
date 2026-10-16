import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import html2canvas from 'html2canvas';
import { LayoutStateService } from '../../../core/services/layout-state.service';
import { MeasureNode } from '../../../core/services/model-studio.service';
import { QUICK_MEASURES } from '../../model-studio/formula-builder/formula-builder.util';
import { ReportSheetsService } from '../../reports/shared/report-sheets.service';
import { CanvasItem, newCanvasConfig, readCanvasBookmarks, readCanvasConfig, readCanvasDataset, serializeCanvas } from '../canvas-config.util';
import { VISUALS } from '../canvas-wells.util';
import { CanvasEditorComponent } from './canvas-editor.component';
// Imported for its NgModule metadata only. CanvasEditorComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { CanvasModule } from '../canvas.module';

vi.mock('html2canvas', () => ({ default: vi.fn() }));

const tile: CanvasItem = {
  id: 't1', type: 'tile', title: 'Tasks', x: 0, y: 0, cols: 4, rows: 5, datasetId: 7, dimensions: [], measures: ['Task Count'],
};
const hours: MeasureNode = { kind: 'agg', fn: 'sum', arg: { source: 'TaskDaily', column: 'data_hours' } };

function detail(id: number, measures: unknown[] = [{ id: 5, name: 'Task Count', expression: null }], calculatedColumns: unknown[] = []) {
  return {
    id, name: id === 7 ? 'Canvas check' : 'Other check', description: null, connectionId: 4, status: 'draft', createdAt: '',
    sources: [
      { id: 1, schemaName: 'core', sourceName: 'TaskDaily', alias: 'TaskDaily', rlsMode: 'none', rlsPlantColumn: null },
      { id: 2, schemaName: 'ref', sourceName: 'CrewType', alias: 'CrewType', rlsMode: 'none', rlsPlantColumn: null },
    ],
    relationships: [], measures, calculatedColumns, transforms: [],
  };
}

function setup(configJson: string, status = 'Draft', canModify = true) {
  const dashboards = {
    getDashboardById: vi.fn().mockReturnValue(of({
      success: true, statusCode: 200, message: '',
      data: {
        dashboardId: 31, dashboardName: 'Crew canvas', categoryId: 2147, categoryName: 'Test Category', status,
        configJson, isActive: true, versionNo: null, isLatestVersion: false,
      },
    })),
    updateDashboard: vi.fn().mockReturnValue(of({ success: true, statusCode: 200, message: '', data: {} })),
    publishDashboard: vi.fn().mockReturnValue(of({
      success: true, statusCode: 200, message: '', data: { dashboardId: 31, status: 'Published', message: "'Crew canvas' has been published as v0." },
    })),
    unpublishDashboard: vi.fn().mockReturnValue(of({ success: true, statusCode: 200, message: '', data: { dashboardId: 0, status: 'Draft', message: '' } })),
  };
  const modelStudio = {
    list: vi.fn().mockReturnValue(of([
      { id: 7, name: 'Canvas check', description: null, connectionId: 4, status: 'draft', createdAt: '' },
      { id: 8, name: 'Other check', description: null, connectionId: 4, status: 'draft', createdAt: '' },
    ])),
    get: vi.fn().mockImplementation((id: number) => of(detail(id))),
    viewTables: vi.fn().mockReturnValue(of([])),
    addMeasure: vi.fn(),
    updateMeasure: vi.fn(),
    addCalculatedColumn: vi.fn(),
  };
  const commonApi = {
    getConnectionSchema: vi.fn().mockReturnValue(of({ tables: [
      { schemaName: 'core', tableName: 'TaskDaily', columnCount: 1, columns: [{ columnName: 'task_daily_id', ordinalPosition: 1 }] },
      { schemaName: 'ref', tableName: 'CrewType', columnCount: 1, columns: [{ columnName: 'code', ordinalPosition: 2 }] },
    ] })),
  };
  const route = { snapshot: { paramMap: new Map([['id', '31']]) } };
  const router = { navigate: vi.fn(), navigateByUrl: vi.fn() };
  const permissions = { canModify: vi.fn().mockReturnValue(canModify), canView: vi.fn().mockReturnValue(true) };
  const host = document.createElement('div');
  const layout = new LayoutStateService();
  const brandKits = { list: vi.fn().mockReturnValue(of([])), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const comments = { getThread: vi.fn().mockReturnValue(of([])), create: vi.fn().mockReturnValue(of({})), delete: vi.fn().mockReturnValue(of(undefined)) };
  const component = new CanvasEditorComponent(
    route as never, router as never, new ReportSheetsService(), dashboards as never, modelStudio as never, commonApi as never,
    permissions as never, { nativeElement: host } as never, { markForCheck: vi.fn(), detectChanges: vi.fn() } as never, layout,
    brandKits as never, comments as never);
  component.ngOnInit();
  return { component, dashboards, modelStudio, commonApi, router, permissions, host, layout, brandKits, comments };
}

describe('CanvasEditorComponent', () => {
  it('loads the sheets and the canvas data model, builds objects from the Data pane, and saves the data model with the sheets', () => {
    const { component, dashboards, commonApi, layout } = setup(serializeCanvas([{ name: 'Overview', items: [tile] }, { name: 'Detail', items: [] }], 7));

    // A desktop tool: the sidebar folds to its rail while the canvas is open (P8-19).
    expect(layout.isCollapsed).toBe(true);
    expect(component.sheets.sheets.map(sheet => sheet.name)).toEqual(['Overview', 'Detail']);
    expect(component.items).toEqual([tile]);
    expect(component.datasetId).toBe(7);
    expect(commonApi.getConnectionSchema).toHaveBeenCalledExactlyOnceWith(4);
    expect(component.model?.dataset.name).toBe('Canvas check');
    expect(component.model?.columns.get('ref.crewtype')?.map(column => column.columnName)).toEqual(['code']);

    component.addVisual(VISUALS.find(visual => visual.id === 'bar')!);
    const chart = component.items[1];
    expect(chart).toMatchObject({ type: 'chart', chartType: 'bar', datasetId: 7, x: 0, y: 5 });
    expect(component.selectedId).toBe(chart.id);
    component.pick({ kind: 'field', name: 'CrewType.code' });
    component.pick({ kind: 'measure', name: 'Task Count' });
    const configured = component.items[1];
    expect(configured).toMatchObject({ dimensions: ['CrewType.code'], measures: ['Task Count'] });

    component.selectedId = null;
    component.pick({ kind: 'measure', name: 'Task Count' });
    expect(component.toast?.text).toBe('Select an object on the sheet first, or add one from Visualizations.');

    component.addSheet();
    component.startRename();
    component.renameValue = ' Spare ';
    component.finishRename();
    // The rename box loses focus as it closes; that must not rename again.
    component.renameValue = 'Twice';
    component.finishRename();
    component.moveSheet(-1);
    expect(component.sheets.sheets.map(sheet => sheet.name)).toEqual(['Overview', 'Spare', 'Detail']);
    component.deleteActiveSheet();
    component.runConfirmed();
    expect(component.sheets.sheets.map(sheet => sheet.name)).toEqual(['Overview', 'Detail']);

    component.refreshAll();
    expect(component.refreshToken).toBe(1);

    component.save();
    expect(dashboards.updateDashboard).toHaveBeenCalledWith(31, expect.objectContaining({ dashboardName: 'Crew canvas', categoryId: 2147 }));
    const body = dashboards.updateDashboard.mock.calls[0][1] as { configJson: string };
    expect(readCanvasConfig(body.configJson)).toEqual([{ name: 'Overview', items: [tile, configured] }, { name: 'Detail', items: [] }]);
    expect(readCanvasDataset(body.configJson)).toBe(7);
    expect(component.toast?.kind).toBe('success');
    component.ngOnDestroy();
    expect(layout.isCollapsed).toBe(false);
  });

  it('does not open a v1 dashboard, and present mode turns editing off until Escape', () => {
    const dashboard = setup('{"widgets":[{"chartId":1,"sortOrder":1,"type":"chart"}]}').component;
    expect(dashboard.canvas).toBeNull();
    expect(dashboard.error).toContain('not a canvas');

    const { component } = setup(serializeCanvas([{ name: 'Overview', items: [tile] }], 7));
    component.select(tile);
    expect(component.selectedId).toBe('t1');

    component.present();
    expect(component.presenting).toBe(true);
    expect(component.selectedId).toBeNull();
    expect(component.options.draggable?.enabled).toBe(false);

    component.onEscape();
    expect(component.presenting).toBe(false);
    expect(component.options.draggable?.enabled).toBe(true);
    component.ngOnDestroy();
  });

  it('opens in present mode for a user who may only view canvases, and keeps it after Escape', () => {
    const { component, router } = setup(serializeCanvas([{ name: 'Overview', items: [tile] }], 7), 'Published', false);
    expect(component.viewOnly).toBe(true);
    expect(component.presenting).toBe(true);
    expect(component.editing).toBe(false);

    component.onEscape();
    expect(component.presenting).toBe(true);

    component.close();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/canvas');
    component.ngOnDestroy();
  });

  it('takes the first object data model for an older canvas, flags objects on another one, and clears them when the data model changes', () => {
    const fresh = setup(newCanvasConfig());
    expect(fresh.component.datasetId).toBeNull();
    expect(fresh.modelStudio.get).not.toHaveBeenCalled();
    fresh.component.chooseDataset(7);
    expect(fresh.component.confirm).toBeNull();
    expect(fresh.component.model?.dataset.name).toBe('Canvas check');

    const other: CanvasItem = { ...tile, id: 't2', y: 5, datasetId: 8, measures: ['Crew Types'] };
    const legacy = JSON.stringify({ kind: 'canvas', layout: { version: 2, columns: 20, sheets: [{ name: 'Overview', items: [tile, other] }] } });
    const { component, modelStudio } = setup(legacy);

    expect(component.datasetId).toBe(7);
    expect(component.foreignCount).toBe(1);
    expect(modelStudio.get).toHaveBeenCalledExactlyOnceWith(7);
    component.select(other);
    component.pick({ kind: 'measure', name: 'Task Count' });
    expect(component.toast?.text).toBe('This object uses another data model. Move it to Canvas check first.');

    component.chooseDataset(8);
    expect(component.confirm?.message).toContain('1 object');
    expect(component.datasetId).toBe(7);
    component.runConfirmed();
    expect(component.datasetId).toBe(8);
    expect(component.items.map(item => [item.datasetId, item.measures])).toEqual([[8, []], [8, ['Crew Types']]]);
    expect(component.foreignCount).toBe(0);
    expect(component.model?.dataset.name).toBe('Other check');
  });

  it('adds and edits measures and adds calculated columns on the canvas data model, and keeps its objects on a renamed measure', () => {
    const { component, modelStudio } = setup(serializeCanvas([{ name: 'Overview', items: [tile] }], 7));
    modelStudio.addMeasure
      .mockReturnValueOnce(throwError(() => ({ error: { message: 'A measure called Hours already exists in this data model.' } })))
      .mockReturnValueOnce(of(detail(7, [{ id: 5, name: 'Task Count', expression: null }, { id: 6, name: 'Hours', expression: hours }])));
    modelStudio.updateMeasure.mockReturnValue(of(detail(7, [{ id: 5, name: 'Tasks', expression: hours }])));
    modelStudio.addCalculatedColumn.mockReturnValue(of(detail(7, undefined, [{ id: 20, sourceId: 1, name: 'Minutes', dataType: 'number', expression: null }])));

    expect(component.canChangeModel).toBe(true);
    expect(component.modelNotice).toBe('This saves to the data model "Canvas check". Every canvas built on it sees the change.');

    component.openMeasure(null, QUICK_MEASURES.find(quick => quick.id === 'ratio')!);
    expect(component.formula?.start).toMatchObject({ name: 'Ratio', visual: { left: { fn: 'sum', source: 'TaskDaily' }, op: '/' } });

    component.saveMeasure({ name: 'Hours', expression: hours });
    expect(component.formula).not.toBeNull();
    expect(component.formulaError).toBe('A measure called Hours already exists in this data model.');
    component.saveMeasure({ name: 'Hours', expression: hours });
    expect(modelStudio.addMeasure).toHaveBeenLastCalledWith(7, 'Hours', hours);
    expect(component.formula).toBeNull();
    expect(component.model?.dataset.measures.map(measure => measure.name)).toEqual(['Task Count', 'Hours']);

    component.openMeasure(component.model!.dataset.measures[0]);
    component.saveMeasure({ name: 'Tasks', expression: hours });
    expect(modelStudio.updateMeasure).toHaveBeenCalledWith(7, 5, 'Tasks', hours);
    expect(component.items[0].measures).toEqual(['Tasks']);
    expect(component.refreshToken).toBe(1);
    expect(component.toast?.text).toBe('Tasks was saved. Save the canvas to keep the new name on its objects.');

    const minutes: MeasureNode = { kind: 'bin', op: '*', left: { kind: 'col', source: 'TaskDaily', column: 'data_hours' }, right: { kind: 'num', value: 60 } };
    component.openColumn(component.model!.dataset.sources[0]);
    component.saveColumn({ name: 'Minutes', expression: minutes });
    expect(modelStudio.addCalculatedColumn).toHaveBeenCalledWith(7, 1, 'Minutes', minutes);
    expect(component.columnDialog).toBeNull();
    expect(component.model?.dataset.calculatedColumns.map(column => column.name)).toEqual(['Minutes']);
    component.ngOnDestroy();
  });

  it('saves before opening the model, with the canvas to come back to', () => {
    const { component, dashboards, router } = setup(serializeCanvas([{ name: 'Overview', items: [tile] }], 7));
    component.openModel();
    expect(dashboards.updateDashboard).toHaveBeenCalledOnce();
    expect(router.navigate).toHaveBeenCalledWith(['/', 'model-studio', 7], { queryParams: { canvas: 31 } });

    const failing = setup(serializeCanvas([{ name: 'Overview', items: [tile] }], 7));
    failing.dashboards.updateDashboard.mockReturnValue(throwError(() => ({ error: { message: 'The canvas could not be saved.' } })));
    failing.component.openModel();
    expect(failing.router.navigate).not.toHaveBeenCalled();
    expect(failing.component.toast?.kind).toBe('error');
    component.ngOnDestroy();
    failing.component.ngOnDestroy();
  });

  it('publishes after saving and then shows the canvas read-only; unpublishing goes back to the list', () => {
    const { component, dashboards } = setup(serializeCanvas([{ name: 'Overview', items: [tile] }], 7));
    expect(component.canPublish).toBe(true);

    component.publish();
    expect(dashboards.updateDashboard).toHaveBeenCalledOnce();
    expect(dashboards.publishDashboard).toHaveBeenCalledWith(31);
    expect(dashboards.updateDashboard.mock.invocationCallOrder[0]).toBeLessThan(dashboards.publishDashboard.mock.invocationCallOrder[0]);
    expect(component.published).toBe(true);
    expect(component.readonly).toBe(true);
    expect(component.editing).toBe(false);
    expect(component.toast?.text).toBe("'Crew canvas' has been published as v0.");

    const published = setup(serializeCanvas([{ name: 'Overview', items: [tile] }], 7), 'Published');
    expect(published.component.canPublish).toBe(false);
    expect(published.component.canUnpublish).toBe(true);
    published.component.unpublish();
    expect(published.dashboards.unpublishDashboard).toHaveBeenCalledWith(31);
    expect(published.router.navigate).toHaveBeenCalledWith(['/', 'canvas']);
    component.ngOnDestroy();
    published.component.ngOnDestroy();
  });

  it('exports the open sheet as a PNG named after the canvas and the sheet', async () => {
    const toDataURL = vi.fn().mockReturnValue('data:image/png;base64,AAAA');
    vi.mocked(html2canvas).mockResolvedValue({ toDataURL } as unknown as HTMLCanvasElement);
    const names: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    const { component, host } = setup(serializeCanvas([{ name: 'Overview', items: [tile] }], 7));
    host.innerHTML = '<section class="canvas-editor__stage"></section>';

    const done = component.exportAs('png');
    expect(component.exporting).toBe(true);
    await done;
    expect(component.exporting).toBe(false);

    expect(html2canvas).toHaveBeenCalledWith(host.querySelector('.canvas-editor__stage'), expect.objectContaining({ scale: 2, useCORS: true }));
    expect(toDataURL).toHaveBeenCalledWith('image/png');
    expect(names).toEqual(['Crew canvas - Overview.png']);
    click.mockRestore();
    component.ngOnDestroy();
  });

  it('exports the sheets the Export dialog names: the open one, all of them or the ones ticked, in sheet order', () => {
    const { component } = setup(serializeCanvas([{ name: 'Overview', items: [tile] }, { name: 'Detail', items: [] }, { name: 'Notes', items: [] }], 7));
    const [first, second, third] = component.sheets.sheets.map(sheet => sheet.id);
    component.openExport();
    const choice = component.exportDialog!;
    expect(choice).toEqual(expect.objectContaining({ kind: 'pdf', sheets: 'all', size: 'fit' }));
    expect(component.exportSheetIds(choice)).toEqual([first, second, third]);

    choice.sheets = 'chosen';
    component.toggleExportSheet(second);
    expect(component.exportSheetIds(choice)).toEqual([first, third]);

    choice.sheets = 'current';
    expect(component.exportSheetIds(choice)).toEqual([component.sheets.activeId]);
    component.ngOnDestroy();
  });

  it("filters the other objects of the sheet by a slicer, keeps the same filters between checks, and saves the slicer's choice", () => {
    const slicer: CanvasItem = { ...tile, id: 's1', type: 'slicer', x: 4, dimensions: ['CrewType.code'], measures: [], slicer: { kind: 'list', values: [] } };
    const { component, dashboards } = setup(serializeCanvas([{ name: 'Overview', items: [tile, slicer] }], 7));

    const before = component.filtersFor(tile);
    expect(before).toEqual([]);
    expect(component.filtersFor(tile)).toBe(before);

    component.onSlicerChange(component.items[1], { kind: 'list', values: ['WL'] });
    const after = component.filtersFor(component.items[0]);
    expect(after).toEqual([{ field: 'CrewType.code', op: 'in', values: ['WL'] }]);
    expect(component.filtersFor(component.items[0])).toBe(after);
    expect(component.filtersFor(component.items[1])).toEqual([]);

    component.save();
    const body = dashboards.updateDashboard.mock.calls[0][1] as { configJson: string };
    expect(readCanvasConfig(body.configJson)?.[0].items[1].slicer).toEqual({ kind: 'list', values: ['WL'] });
    component.ngOnDestroy();
  });

  it('cross-filters the other objects by a clicked point, and clears it on a second click, on Escape and on another sheet', () => {
    const chart: CanvasItem = { ...tile, id: 'c1', type: 'chart', x: 4, cols: 10, rows: 12, dimensions: ['CrewType.code'], chartType: 'column' };
    const { component } = setup(serializeCanvas([{ name: 'Overview', items: [tile, chart] }, { name: 'Detail', items: [] }], 7));

    component.onPointClick(chart, { field: 'CrewType.code', value: 'WL' });
    expect(component.crossFilter).toEqual({ sourceId: 'c1', field: 'CrewType.code', values: ['WL'] });
    expect(component.crossFilterLabel).toBe('code: WL');
    expect(component.filtersFor(tile)).toEqual([{ field: 'CrewType.code', op: 'eq', values: ['WL'] }]);
    expect(component.filtersFor(chart)).toEqual([]);

    component.onPointClick(chart, { field: 'CrewType.code', value: 'WL' });
    expect(component.crossFilter).toBeNull();

    component.onPointClick(chart, { field: 'CrewType.code', value: null });
    expect(component.crossFilterLabel).toBe('code: (blank)');
    component.onEscape();
    expect(component.crossFilter).toBeNull();

    component.onPointClick(chart, { field: 'CrewType.code', value: 7 });
    expect(component.crossFilter?.values).toEqual(['7']);
    component.selectSheet(component.sheets.sheets[1].id);
    expect(component.crossFilter).toBeNull();
    component.ngOnDestroy();
  });

  it('saves a bookmark of the sheet, slicers, filters and chosen point, and brings them back', () => {
    const slicer: CanvasItem = { ...tile, id: 's1', type: 'slicer', x: 4, dimensions: ['CrewType.code'], measures: [], slicer: { kind: 'list', values: ['WL'] } };
    const chart: CanvasItem = { ...tile, id: 'c1', type: 'chart', x: 8, cols: 10, rows: 12, dimensions: ['CrewType.code'], chartType: 'column' };
    const { component, dashboards } = setup(serializeCanvas([{ name: 'Overview', items: [slicer, chart] }, { name: 'Detail', items: [] }], 7));
    component.onPointClick(chart, { field: 'CrewType.code', value: 'RG' });
    component.bookmarkName = 'Wireline only';
    component.addBookmark();

    component.onSlicerChange(component.items[0], { kind: 'list', values: [] });
    component.selectSheet(component.sheets.sheets[1].id);
    component.applyBookmark(component.bookmarks[0]);

    expect(component.sheets.active?.name).toBe('Overview');
    expect(component.items[0].slicer?.values).toEqual(['WL']);
    expect(component.crossFilter?.values).toEqual(['RG']);
    component.save();
    const body = dashboards.updateDashboard.mock.calls[0][1] as { configJson: string };
    expect(readCanvasBookmarks(body.configJson).map(mark => [mark.name, mark.sheet])).toEqual([['Wireline only', 'Overview']]);
    component.ngOnDestroy();
  });

  it('reads and posts the canvas comments, and starts one about a visual', () => {
    const { component, comments } = setup(serializeCanvas([{ name: 'Overview', items: [tile] }], 7));
    component.openComments(tile);
    expect(comments.getThread).toHaveBeenCalledWith('Canvas', 31);
    expect(component.commentDraft).toBe(`On "${tile.title}": `);
    component.commentDraft += 'looks low';
    component.postComment();
    expect(comments.create).toHaveBeenCalledWith({ targetType: 'Canvas', targetId: 31, parentCommentId: null, body: `On "${tile.title}": looks low` });
    component.ngOnDestroy();
  });

  it('adds points with Ctrl, and filters, highlights in or leaves alone each visual by its interaction', () => {
    const chart: CanvasItem = { ...tile, id: 'c1', type: 'chart', x: 4, cols: 10, rows: 12, dimensions: ['CrewType.code'], chartType: 'column' };
    const other: CanvasItem = { ...chart, id: 'c2', y: 12, dimensions: ['TaskDaily.task_code'], interaction: 'highlight' };
    const quiet: CanvasItem = { ...tile, id: 't2', x: 16, interaction: 'none' };
    const { component } = setup(serializeCanvas([{ name: 'Overview', items: [tile, chart, other, quiet] }], 7));

    component.onPointClick(chart, { field: 'CrewType.code', value: 'WL' });
    component.onPointClick(chart, { field: 'CrewType.code', value: 'CT', additive: true });
    expect(component.crossFilter?.values).toEqual(['WL', 'CT']);
    expect(component.filtersFor(tile)).toEqual([{ field: 'CrewType.code', op: 'in', values: ['WL', 'CT'] }]);
    expect(component.filtersFor(other)).toEqual([]);
    expect(component.highlightOf(other)).toEqual({ field: 'CrewType.code', values: ['WL', 'CT'], filter: { field: 'CrewType.code', op: 'in', values: ['WL', 'CT'] } });
    expect(component.highlightOf(other)).toBe(component.highlightOf(other));
    expect(component.highlightOf(chart)?.values).toEqual(['WL', 'CT']);
    expect(component.filtersFor(quiet)).toEqual([]);
    expect(component.crossFilterLabel).toBe('code: WL, CT');

    component.onPointClick(chart, { field: 'CrewType.code', value: 'WL', additive: true });
    component.onPointClick(chart, { field: 'CrewType.code', value: 'CT', additive: true });
    expect(component.crossFilter).toBeNull();
    component.ngOnDestroy();
  });

  it('applies a saved brand kit as its own copy and saves the canvas kit as a new or updated kit', () => {
    const { component, brandKits } = setup(serializeCanvas([{ name: 'Overview', items: [tile] }], 7));
    component.savedKits = [{ id: 4, name: 'Tasnim', kit: { font: 'Arial', titleSize: 15 } }];
    component.applySavedKit(4);
    expect(component.brand).toEqual({ font: 'Arial', titleSize: 15, kitId: 4, kitName: 'Tasnim' });
    expect(component.stageStyle['--canvas-title-size']).toBe('15px');

    brandKits.update.mockReturnValue(of({ id: 4, name: 'Tasnim', kit: { font: 'Arial', titleSize: 15 } }));
    component.saveKit({ name: 'Tasnim', update: true });
    expect(brandKits.update).toHaveBeenCalledWith(4, 'Tasnim', component.brand);

    brandKits.create.mockReturnValue(of({ id: 9, name: 'Ocean', kit: { font: 'Arial' } }));
    component.saveKit({ name: 'Ocean', update: false });
    expect(component.brand?.kitId).toBe(9);
    expect(component.savedKits.map(kit => kit.name)).toEqual(['Ocean', 'Tasnim']);
    component.ngOnDestroy();
  });

  it('resets slicers and pane filters to the canvas as it was saved', () => {
    const saved: CanvasItem = { ...tile, id: 's1', type: 'slicer', x: 4, dimensions: ['CrewType.code'], measures: [], slicer: { kind: 'list', values: ['WL'] } };
    const { component } = setup(serializeCanvas([{ name: 'Overview', items: [tile, saved] }], 7));
    component.updateItem({ ...saved, slicer: { kind: 'list', values: ['NP', 'XX'] } });
    component.canvasFilters = [{ field: 'CrewType.code', kind: 'text', mode: 'basic', values: ['A'] }];
    component.crossFilter = { sourceId: tile.id, field: 'CrewType.code', values: ['WL'] };

    component.resetFilters();

    expect(component.items.find(item => item.id === saved.id)?.slicer).toEqual({ kind: 'list', values: ['WL'] });
    expect(component.canvasFilters).toEqual([]);
    expect(component.crossFilter).toBeNull();
    component.ngOnDestroy();
  });
});
