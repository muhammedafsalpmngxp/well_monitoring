import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from './api.service';
import { WidgetDataFilter, WidgetService } from './widget.service';

describe('additional dashboard cross filters', () => {
  let service: WidgetService;
  let http: HttpTestingController;
  const local = { sourceTable: 'Readiness', sourceColumn: 'Status', controlType: 'Dropdown', value: 'Ready' };
  const additional = {
    sourceTable: 'Plants', sourceColumn: 'Region', controlType: 'Dropdown', value: 'North',
    dashboardAdditional: true,
  };
  const request = {
    chartSource: 'Readiness', chartSourceType: 'Table', viewId: null,
    filters: [local, additional], fromDate: '2026-01-01', preserveFutureDateRange: true,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), WidgetService,
        { provide: ApiService, useValue: {} }],
    });
    service = TestBed.inject(WidgetService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('marks additional fields so unsupported view placeholders return no data', async () => {
    const result = firstValueFrom(service.getFilteredChartData(request));
    const pending = http.expectOne(req => req.url.endsWith('/chart-data/filtered'));
    expect(pending.request.body.filters).toEqual([local, additional]);
    pending.flush({ columns: ['Status'], rows: [{ Status: 'Ready' }] });
    expect((await result).rows).toEqual([{ Status: 'Ready' }]);
  });

  it('logs and returns no data without retrying when a join is rejected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const context = { dashboardId: 42, token: 'test-token' };
    const result = firstValueFrom(service.getFilteredChartData(request, context));
    const pending = http.expectOne(req => req.url.endsWith('/chart-data/filtered'));
    expect(pending.request.params.get('shareDashboardId')).toBe('42');
    expect(pending.request.params.get('shareToken')).toBe('test-token');
    pending.flush(null, { status: 404, statusText: 'Not Found' });
    expect(warn).toHaveBeenCalledOnce();
    http.expectNone(req => req.url.endsWith('/chart-data/filtered'));
    expect(await result).toEqual({ columns: [], rows: [] });
  });

  it('returns no data for imported charts that cannot cross filter', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await firstValueFrom(service.getFilteredChartData(
      { ...request, chartSourceType: 'Import' },
    ))).toEqual({ columns: [], rows: [] });
    http.expectNone(req => req.url.endsWith('/chart-data/filtered'));
  });

  it.each([400, 401, 403, 500])('does not hide HTTP %s errors with a fallback', async status => {
    const result = firstValueFrom(service.getFilteredChartData(request));
    const assertion = expect(result).rejects.toMatchObject({ status });
    http.expectOne(req => req.url.endsWith('/chart-data/filtered')).flush(null, { status, statusText: 'Failed' });
    await assertion;
  });

  it('does not retry a rejected ordinary local filter', async () => {
    const result = firstValueFrom(service.getFilteredChartData({ ...request, filters: [local] }));
    const assertion = expect(result).rejects.toMatchObject({ status: 404 });
    http.expectOne(req => req.url.endsWith('/chart-data/filtered')).flush(null, { status: 404, statusText: 'Not Found' });
    await assertion;
  });

  const global: WidgetDataFilter = {
    sourceTable: 'country', sourceColumn: 'country', controlType: 'Dropdown', value: 'Oman',
    globalHierarchy: true,
  };

  it('omits unrelated global filters without removing local or additional filters', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = firstValueFrom(service.getFilteredChartData({ ...request, filters: [local, additional, global] }));
    http.expectOne(req => req.method === 'GET' && req.params.get('sourceName') === 'Readiness')
      .flush({ columns: ['Status'], rows: [] });
    const pending = http.expectOne(req => req.url.endsWith('/chart-data/filtered'));
    expect(pending.request.body.filters).toEqual([local, additional]);
    expect(warn).toHaveBeenCalledOnce();
    pending.flush({ columns: ['Status'], rows: [{ Status: 'Ready' }] });
    expect((await result).rows).toEqual([{ Status: 'Ready' }]);
  });

  it('maps matching globals to real source columns and preserves multiple values', async () => {
    const result = firstValueFrom(service.getFilteredChartData({
      ...request, filters: [
        { ...global, controlType: 'MultiSelect', value: 'Oman,UAE', values: ['Oman', 'UAE'] },
        { ...global, sourceTable: 'business_unit', sourceColumn: 'business_unit', value: 'Energy' },
        { ...global, sourceTable: 'plant_description', sourceColumn: 'plant_description', value: 'Plant A' },
      ],
    }));
    http.expectOne(req => req.method === 'GET').flush({
      columns: ['Country', 'Business Unit', 'Plant'], rows: [],
    });
    const pending = http.expectOne(req => req.url.endsWith('/chart-data/filtered'));
    expect(pending.request.body.filters).toEqual([
      { sourceTable: 'Readiness', sourceColumn: 'Country', controlType: 'MultiSelect', value: 'Oman,UAE', values: ['Oman', 'UAE'] },
      { sourceTable: 'Readiness', sourceColumn: 'Business Unit', controlType: 'Dropdown', value: 'Energy' },
      { sourceTable: 'Readiness', sourceColumn: 'Plant', controlType: 'Dropdown', value: 'Plant A' },
    ]);
    pending.flush({ columns: [], rows: [] });
    await result;
  });

  it('keeps view placeholder filters unchanged without loading table metadata', async () => {
    const result = firstValueFrom(service.getFilteredChartData({
      ...request, chartSourceType: 'View', viewId: 7, filters: [global],
    }));
    http.expectNone(req => req.method === 'GET');
    const pending = http.expectOne(req => req.url.endsWith('/chart-data/filtered'));
    const { globalHierarchy, ...filter } = global;
    expect(pending.request.body.filters).toEqual([filter]);
    pending.flush({ columns: [], rows: [] });
    await result;
  });

  it('preserves server aggregation instead of aggregating the metadata preview', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = firstValueFrom(service.getFilteredChartData({
      ...request, filters: [global], aggregation: 'count',
    }));
    http.expectOne(req => req.method === 'GET').flush({
      columns: ['EmployeeId'], rows: Array.from({ length: 1000 }, (_, EmployeeId) => ({ EmployeeId })),
    });
    const pending = http.expectOne(req => req.url.endsWith('/chart-data/filtered'));
    expect(pending.request.body).toMatchObject({ aggregation: 'count', filters: [] });
    pending.flush({ columns: ['Value'], rows: [{ Value: 25000 }] });
    expect((await result).rows).toEqual([{ Value: 25000 }]);
  });

  it('retains share credentials on metadata and filtered requests', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = firstValueFrom(service.getFilteredChartData(
      { ...request, filters: [global] }, { dashboardId: 42, token: 'test-token' },
    ));
    const metadata = http.expectOne(req => req.method === 'GET');
    expect(metadata.request.params.get('shareDashboardId')).toBe('42');
    expect(metadata.request.params.get('shareToken')).toBe('test-token');
    metadata.flush({ columns: ['Status'], rows: [] });
    const pending = http.expectOne(req => req.url.endsWith('/chart-data/filtered'));
    expect(pending.request.params.get('shareToken')).toBe('test-token');
    pending.flush({ columns: [], rows: [] });
    await result;
  });

  it('surfaces metadata failures without sending an unfiltered fallback', async () => {
    const result = firstValueFrom(service.getFilteredChartData({ ...request, filters: [global] }));
    const assertion = expect(result).rejects.toMatchObject({ status: 500 });
    http.expectOne(req => req.method === 'GET').flush(null, { status: 500, statusText: 'Failed' });
    await assertion;
    http.expectNone(req => req.method === 'POST');
  });

  it('does not treat missing table metadata as an unsupported additional join', async () => {
    const result = firstValueFrom(service.getFilteredChartData({ ...request, filters: [global, additional] }));
    const assertion = expect(result).rejects.toMatchObject({ status: 404 });
    http.expectOne(req => req.method === 'GET').flush(null, { status: 404, statusText: 'Not Found' });
    await assertion;
    http.expectNone(req => req.method === 'POST');
  });

  it('does not swallow filtered request failures after resolving global fields', async () => {
    const result = firstValueFrom(service.getFilteredChartData({ ...request, filters: [global] }));
    const assertion = expect(result).rejects.toMatchObject({ status: 404 });
    http.expectOne(req => req.method === 'GET').flush({ columns: ['country'], rows: [] });
    http.expectOne(req => req.method === 'POST').flush(null, { status: 404, statusText: 'Not Found' });
    await assertion;
  });
});
