import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { environment } from '../../../environments/environment';
import { DatasetDetail, MeasureNode, ModelStudioService } from './model-studio.service';

describe('ModelStudioService', () => {
  const base = `${environment.tenantApiUrl}/model/datasets`;
  let service: ModelStudioService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ModelStudioService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('unwraps the envelope of the dataset list', async () => {
    const result = firstValueFrom(service.list());

    http.expectOne(base).flush({ success: true, statusCode: 200, message: 'OK', data: [{ id: 1, name: 'Slice check' }] });

    expect(await result).toEqual([{ id: 1, name: 'Slice check' }]);
  });

  it('reads the connections a new dataset may use', async () => {
    const result = firstValueFrom(service.connections());

    http.expectOne(`${base}/connections`).flush({ success: true, statusCode: 200, message: 'OK',
      data: [{ id: 4, connectionName: 'Tenant database', databaseName: 'smartops_tenant_TNT-1000' }] });

    expect(await result).toEqual([{ id: 4, connectionName: 'Tenant database', databaseName: 'smartops_tenant_TNT-1000' }]);
  });

  it('posts a measure with kind as the first property of its expression', async () => {
    const result = firstValueFrom(service.addMeasure(1, 'Task Count',
      { kind: 'agg', fn: 'count', arg: { source: 'TaskDaily', column: 'task_daily_id' } }));

    const request = http.expectOne(`${base}/1/measures`);
    expect(request.request.method).toBe('POST');
    expect(JSON.stringify(request.request.body)).toBe(
      '{"name":"Task Count","expression":{"kind":"agg","fn":"count","arg":{"source":"TaskDaily","column":"task_daily_id"}}}');
    request.flush({ success: true, statusCode: 200, message: 'OK', data: { id: 1, measures: [] } });

    expect((await result).id).toBe(1);
  });

  it('puts an edited measure, condition included', async () => {
    const expression: MeasureNode = {
      kind: 'agg', fn: 'count', arg: { source: 'TaskDaily', column: 'task_daily_id' },
      where: { column: { source: 'TaskDaily', column: 'data_hours' }, op: 'gt', value: '0' },
    };
    const result = firstValueFrom(service.updateMeasure(1, 5, 'Worked Tasks', expression));

    const request = http.expectOne(`${base}/1/measures/5`);
    expect(request.request.method).toBe('PUT');
    expect(JSON.stringify(request.request.body)).toBe(
      '{"name":"Worked Tasks","expression":{"kind":"agg","fn":"count","arg":{"source":"TaskDaily","column":"task_daily_id"},'
      + '"where":{"column":{"source":"TaskDaily","column":"data_hours"},"op":"gt","value":"0"}}}');
    request.flush({ success: true, statusCode: 200, message: 'OK', data: { id: 1, measures: [] } });

    expect((await result).id).toBe(1);
  });

  it('sends a preview to POST /api/query and passes a refusal through with its code', async () => {
    const result = firstValueFrom(service.runQuery({ datasetId: 1, dimensions: ['CrewType.code'], measures: ['Task Count'], topN: 200 }));

    const request = http.expectOne(`${environment.tenantApiUrl}/query`);
    expect(request.request.body.dimensions).toEqual(['CrewType.code']);
    request.flush({ code: 'missing_relationship', message: 'TaskDaily and CrewType are not related. Add a relationship?' },
      { status: 422, statusText: 'Unprocessable Entity' });

    await expect(result).rejects.toMatchObject({ status: 422, error: { code: 'missing_relationship' } });
  });

  it('posts a calculated column with its table, and kind first in its formula', async () => {
    const expression: MeasureNode = { kind: 'fn', fn: 'year', args: [{ kind: 'col', source: 'TaskDaily', column: 'action_on' }] };
    const result = firstValueFrom(service.addCalculatedColumn(1, 3, 'Task year', expression));

    const request = http.expectOne(`${base}/1/calculated-columns`);
    expect(request.request.method).toBe('POST');
    expect(JSON.stringify(request.request.body)).toBe(
      '{"sourceId":3,"name":"Task year","expression":{"kind":"fn","fn":"year","args":[{"kind":"col","source":"TaskDaily","column":"action_on"}]}}');
    request.flush({ success: true, statusCode: 200, message: 'OK', data: { id: 1, calculatedColumns: [] } });

    expect((await result).id).toBe(1);
  });

  it('edits and removes calculated columns, and adds and removes transforms, at their own addresses', () => {
    const minutes: MeasureNode = {
      kind: 'bin', op: '*', left: { kind: 'col', source: 'TaskDaily', column: 'data_hours' }, right: { kind: 'num', value: 60 },
    };
    service.updateCalculatedColumn(1, 20, 'Minutes', minutes).subscribe();
    service.removeCalculatedColumn(1, 20).subscribe();
    service.addTransform(1, { sourceId: 3, column: 'task_assignee', kind: 'null_fill', value: 'Unassigned' }).subscribe();
    service.removeTransform(1, 30).subscribe();

    const put = http.expectOne(r => r.method === 'PUT' && r.url === `${base}/1/calculated-columns/20`);
    expect(put.request.body).toEqual({ name: 'Minutes', expression: minutes });
    http.expectOne(r => r.method === 'DELETE' && r.url === `${base}/1/calculated-columns/20`);
    const post = http.expectOne(r => r.method === 'POST' && r.url === `${base}/1/transforms`);
    expect(post.request.body).toEqual({ sourceId: 3, column: 'task_assignee', kind: 'null_fill', value: 'Unassigned' });
    http.expectOne(r => r.method === 'DELETE' && r.url === `${base}/1/transforms/30`);
  });

  it('posts to refresh a view source and returns the updated dataset', async () => {
    const result = firstValueFrom(service.refreshViewSource(1, 7));

    const request = http.expectOne(`${base}/1/sources/7/refresh-view`);
    expect(request.request.method).toBe('POST');
    request.flush({ success: true, statusCode: 200, message: 'OK', data: { id: 1, sources: [] } });

    expect((await result).id).toBe(1);
  });

  it('reads the views of a dataset and turns the usable ones into tables for the columns map', async () => {
    const withView = { id: 1, sources: [{ id: 2, schemaName: 'view', sourceName: '12', alias: 'Crews', kind: 'view' }] } as unknown as DatasetDetail;
    const result = firstValueFrom(service.viewTables(withView));

    http.expectOne(`${base}/1/views`).flush({ success: true, statusCode: 200, message: 'OK', data: [
      { id: 12, name: 'Crew types', description: 'One row per crew type.', usable: true, problems: [],
        columns: [{ name: 'crew_code', dataType: 'nvarchar(20)' }] },
      { id: 13, name: 'Old crews', description: null, usable: false, problems: ['Rule 4: no grain.'], columns: [] },
    ] });

    const tables = await result;
    expect(tables.map(t => `${t.schemaName}.${t.tableName}`)).toEqual(['view.12']);
    expect(tables[0].columns.map(c => [c.columnName, c.dataType, c.ordinalPosition])).toEqual([['crew_code', 'nvarchar(20)', 1]]);
  });

  it('asks for no views when the dataset has no view source', async () => {
    const tables = await firstValueFrom(service.viewTables({ id: 1, sources: [{ kind: 'table' }] } as unknown as DatasetDetail));

    expect(tables).toEqual([]);
    http.expectNone(`${base}/1/views`);
  });

  it('posts an upload preview as a form with one types entry per column', async () => {
    const file = new File(['Crew,Hours\n'], 'crew.csv', { type: 'text/csv' });
    const result = firstValueFrom(service.previewImport(1, file, { sheet: 'crew', headerRow: 1, lastRow: 5, types: ['text', 'decimal'] }));

    const request = http.expectOne(`${base}/1/imports/preview`);
    expect(request.request.method).toBe('POST');
    const form = request.request.body as FormData;
    expect((form.get('file') as File).name).toBe('crew.csv');
    expect([form.get('sheet'), form.get('headerRow'), form.get('lastRow')]).toEqual(['crew', '1', '5']);
    expect(form.getAll('types')).toEqual(['text', 'decimal']);
    expect(form.has('tableName')).toBe(false);
    request.flush({ success: true, statusCode: 200, message: 'OK', data: { sheet: 'crew' } });

    expect((await result).sheet).toBe('crew');
  });

  it('creates an uploaded table with a POST and replaces one with a PUT', async () => {
    const file = new File(['x'], 'crew.csv');
    const created = firstValueFrom(service.createImport(1, file, { tableName: 'Crew_hours', types: ['text'] }));

    const post = http.expectOne(`${base}/1/imports`);
    expect(post.request.method).toBe('POST');
    expect((post.request.body as FormData).get('tableName')).toBe('Crew_hours');
    post.flush({ success: true, statusCode: 201, message: 'OK', data: { id: 3, tableName: 'Crew_hours' } });
    expect((await created).id).toBe(3);

    const replaced = firstValueFrom(service.replaceImport(1, 3, file, { types: ['text'] }));
    const put = http.expectOne(`${base}/1/imports/3`);
    expect(put.request.method).toBe('PUT');
    put.flush({ success: true, statusCode: 200, message: 'OK', data: { id: 3, tableName: 'Crew_hours' } });
    expect((await replaced).tableName).toBe('Crew_hours');
  });
});
