import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { DashboardService } from './dashboard.service';
import { DashboardSavedFilterService } from './dashboard-saved-filter.service';

describe('DashboardService.cloneDashboard', () => {
  function setup(configJson?: string) {
    const source = {
      dashboardId: 42,
      dashboardName: 'Production',
      categoryId: 7,
      description: 'Daily production',
      status: 'Published',
      versionNo: 3,
      configJson,
    };
    const created = { dashboardId: 99, dashboardName: 'Production Clone', status: 'Draft' };
    const api = {
      get: vi.fn().mockImplementation((path: string) => of({
        success: true,
        data: path === '/dashboard/42' ? source : [],
      })),
      post: vi.fn().mockReturnValue(of({ success: true, data: created })),
    };
    const service = new DashboardService(api as unknown as ApiService, { getAll: () => of([]) } as unknown as DashboardSavedFilterService);
    return { api, service, source, created };
  }

  it('creates an independent draft with the Clone suffix and complete configuration', async () => {
    const config = {
      widgets: [{ chartId: 12, type: 'chart', sortOrder: 1, presetValue: 'North' }],
      layout: { version: 1, columns: 20, items: [{ id: 12, x: 0, y: 5, cols: 10, rows: 16 }] },
      filters: { region: 'North' },
    };
    const { api, service, source, created } = setup(JSON.stringify(config));

    const response = await firstValueFrom(service.cloneDashboard(42));

    expect(api.get).toHaveBeenCalledWith('/dashboard/42');
    expect(api.post).toHaveBeenCalledExactlyOnceWith('/dashboard', {
      dashboardName: 'Production Clone',
      categoryId: 7,
      description: 'Daily production',
      configJson: JSON.stringify(config),
    });
    expect(api.get).toHaveBeenCalledWith('/dashboard/wip');
    expect(response.data).toEqual(created);
    expect(source.dashboardName).toBe('Production');
    expect(source.status).toBe('Published');
  });

  it('does not inherit sharing access and preserves other configuration metadata', async () => {
    const config = {
      widgets: [],
      _meta: { publicShareTokenHash: 'old-hash', sharedWithUserIds: [5], customSetting: true },
    };
    const { api, service, source } = setup(JSON.stringify(config));

    await firstValueFrom(service.cloneDashboard(42));

    expect(JSON.parse(api.post.mock.calls[0][1].configJson)).toEqual({
      widgets: [], _meta: { customSetting: true },
    });
    expect(source.configJson).toBe(JSON.stringify(config));
  });

  it('supports dashboards without saved configuration', async () => {
    const { api, service } = setup();
    await firstValueFrom(service.cloneDashboard(42));
    expect(api.post.mock.calls[0][1].configJson).toBeUndefined();
  });

  it('does not create an empty clone when loading the source fails', async () => {
    const { api, service } = setup();
    api.get.mockReturnValue(throwError(() => new Error('Not found')));
    await expect(firstValueFrom(service.cloneDashboard(42))).rejects.toThrow('Not found');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('does not refresh WIP when creation fails', async () => {
    const { api, service } = setup();
    api.post.mockReturnValue(throwError(() => new Error('Creation failed')));
    await expect(firstValueFrom(service.cloneDashboard(42))).rejects.toThrow('Creation failed');
    expect(api.get).not.toHaveBeenCalledWith('/dashboard/wip');
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('uses numbered names on name conflicts without reloading the source', async () => {
    const { api, service } = setup();
    api.post.mockReturnValueOnce(throwError(() => ({ status: 409 })));
    api.post.mockReturnValueOnce(throwError(() => ({ status: 409 })));

    await firstValueFrom(service.cloneDashboard(42));

    expect(api.post.mock.calls.map(call => call[1].dashboardName)).toEqual([
      'Production Clone', 'Production Clone (2)', 'Production Clone (3)',
    ]);
    expect(api.get.mock.calls.filter(call => call[0] === '/dashboard/42')).toHaveLength(1);
  });

  it('bounds name-conflict retries and surfaces the final error', async () => {
    const { api, service } = setup();
    api.post.mockReturnValue(throwError(() => ({ status: 409 })));
    await expect(firstValueFrom(service.cloneDashboard(42))).rejects.toEqual({ status: 409 });
    expect(api.post).toHaveBeenCalledTimes(10);
    expect(api.get).not.toHaveBeenCalledWith('/dashboard/wip');
  });
});

describe('DashboardService.getMyCanvases', () => {
  it('asks the WIP list for canvases only and leaves the cached dashboard lists alone', async () => {
    const groups = [{ categoryId: 2147, categoryName: 'Test Category', dashboardCount: 1, dashboards: [{ dashboardId: 31 }] }];
    const api = { get: vi.fn().mockReturnValue(of({ success: true, data: groups })) };
    const service = new DashboardService(api as unknown as ApiService, { getAll: () => of([]) } as unknown as DashboardSavedFilterService);

    expect(await firstValueFrom(service.getMyCanvases())).toEqual(groups);
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/dashboard/wip?kind=canvas');
    expect(await firstValueFrom(service.wip$)).toEqual([]);
  });
});

describe('DashboardService.getPublishedCanvases', () => {
  it('asks the published list for canvases only and leaves the cached dashboard lists alone', async () => {
    const groups = [{ categoryId: 2147, categoryName: 'Test Category', dashboardCount: 1, dashboards: [{ dashboardId: 40 }] }];
    const api = { get: vi.fn().mockReturnValue(of({ success: true, data: groups })) };
    const service = new DashboardService(api as unknown as ApiService, { getAll: () => of([]) } as unknown as DashboardSavedFilterService);

    expect(await firstValueFrom(service.getPublishedCanvases())).toEqual(groups);
    expect(api.get).toHaveBeenCalledExactlyOnceWith('/dashboard/published?kind=canvas');
    expect(await firstValueFrom(service.published$)).toEqual([]);
  });
});