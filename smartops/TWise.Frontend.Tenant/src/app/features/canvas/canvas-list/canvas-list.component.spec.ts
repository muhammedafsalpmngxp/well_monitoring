import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { newCanvasConfig } from '../canvas-config.util';
import { CanvasListComponent } from './canvas-list.component';
// Imported for its NgModule metadata only. CanvasListComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { CanvasModule } from '../canvas.module';

describe('CanvasListComponent', () => {
  it('lists my canvases, creates one with an empty sheet, and deletes only after confirmation', () => {
    const dashboards = {
      getMyCanvases: vi.fn().mockReturnValue(of([{
        categoryId: 2147, categoryName: 'Test Category', dashboardCount: 1,
        dashboards: [{ dashboardId: 31, dashboardName: 'Crew canvas', categoryId: 2147, categoryName: 'Test Category', status: 'Draft', widgetCount: 0 }],
      }])),
      createDashboard: vi.fn().mockReturnValue(of({
        success: true, statusCode: 201, message: '',
        data: { dashboardId: 32, dashboardName: 'New canvas', categoryId: 2147, status: 'Draft', message: '' },
      })),
      deleteDashboard: vi.fn().mockReturnValue(of(null)),
      getPublishedCanvases: vi.fn().mockReturnValue(of([])),
    };
    // Only dashboard-typed categories may be offered: a report/chart/tile category (also returned by
    // GET /api/dashboard/categories) would create a canvas that GET /api/dashboard/wip?kind=canvas
    // cannot group, so it would vanish from the Canvases list.
    const categoryService = { getCategoriesByType: vi.fn().mockReturnValue(of([{ categoryId: 2147, categoryName: 'Test Category' }])) };
    const permissions = { canCreate: vi.fn().mockReturnValue(true), canModify: vi.fn().mockReturnValue(true) };
    const router = { navigate: vi.fn() };
    const component = new CanvasListComponent(
      dashboards as never, categoryService as never, permissions as never, router as never, { markForCheck: vi.fn() } as never,
    );

    component.ngOnInit();
    expect(component.canvases.map(c => c.dashboardName)).toEqual(['Crew canvas']);
    expect(categoryService.getCategoriesByType).toHaveBeenCalledWith('dashboard');
    expect(component.categories).toEqual([{ categoryId: 2147, categoryName: 'Test Category' }]);

    component.openCreate();
    expect(component.form.categoryId).toBe(2147);
    component.form.name = ' New canvas ';
    component.create();
    expect(dashboards.createDashboard).toHaveBeenCalledWith({ dashboardName: 'New canvas', categoryId: 2147, configJson: newCanvasConfig() });
    expect(router.navigate).toHaveBeenCalledWith(['/', 'canvas', 32]);

    component.pendingDelete = component.canvases[0];
    expect(dashboards.deleteDashboard).not.toHaveBeenCalled();
    component.confirmDelete();
    expect(dashboards.deleteDashboard).toHaveBeenCalledWith(31);
    expect(component.canvases).toEqual([]);
    expect(component.toast?.kind).toBe('success');
    component.ngOnDestroy();
  });

  it('lists published canvases apart from mine', () => {
    const dashboards = {
      getMyCanvases: vi.fn().mockReturnValue(of([])),
      getPublishedCanvases: vi.fn().mockReturnValue(of([{
        categoryId: 2147, categoryName: 'Test Category', dashboardCount: 1,
        dashboards: [{ dashboardId: 40, dashboardName: 'Crew report', categoryId: 2147, categoryName: 'Test Category', status: 'Published', widgetCount: 0 }],
      }])),
    };
    const categoryService = { getCategoriesByType: vi.fn().mockReturnValue(of([])) };
    const permissions = { canCreate: vi.fn().mockReturnValue(false), canModify: vi.fn().mockReturnValue(false) };
    const component = new CanvasListComponent(
      dashboards as never, categoryService as never, permissions as never, { navigate: vi.fn() } as never, { markForCheck: vi.fn() } as never,
    );

    component.ngOnInit();
    expect(component.canvases).toEqual([]);
    expect(component.published.map(canvas => canvas.dashboardName)).toEqual(['Crew report']);
    expect(component.empty).toBe(false);
    component.ngOnDestroy();
  });

  it('shows only published canvases under Standard and only mine under WIP', () => {
    const group = (id: number, name: string, status: string) => of([{ categoryId: 1, categoryName: 'C', dashboardCount: 1,
      dashboards: [{ dashboardId: id, dashboardName: name, categoryId: 1, categoryName: 'C', status, widgetCount: 0 }] }]);
    const make = (mode: string) => {
      const component = new CanvasListComponent(
        { getMyCanvases: () => group(1, 'Mine', 'Draft'), getPublishedCanvases: () => group(2, 'Live', 'Published') } as never,
        { getCategoriesByType: () => of([]) } as never, { canCreate: () => true, canModify: () => true } as never,
        { navigate: vi.fn() } as never, { markForCheck: vi.fn() } as never, { snapshot: { data: { mode } } } as never);
      component.ngOnInit();
      return component;
    };
    const standard = make('standard');
    expect([standard.showWip, standard.showStandard]).toEqual([false, true]);
    const wip = make('wip');
    expect([wip.showWip, wip.showStandard]).toEqual([true, false]);
    wip.canvases = [];
    expect(wip.empty).toBe(true);
  });
});
