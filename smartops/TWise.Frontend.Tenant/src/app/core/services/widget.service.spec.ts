import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from './api.service';
import { WidgetService } from './widget.service';

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
});
