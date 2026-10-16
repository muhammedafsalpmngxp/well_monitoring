import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { DatasetListComponent } from './dataset-list.component';
// Imported for its NgModule metadata only. DatasetListComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { ModelStudioModule } from '../model-studio.module';

describe('DatasetListComponent', () => {
  it('loads data models and connections, and deletes only after confirmation', () => {
    const modelStudio = {
      list: vi.fn().mockReturnValue(of([
        { id: 1, name: 'Slice check', description: null, connectionId: 4, status: 'draft', createdAt: '2026-09-21T07:23:51Z' },
      ])),
      delete: vi.fn().mockReturnValue(of(undefined)),
      connections: vi.fn().mockReturnValue(of([])),
    };
    const commonApi = {
      getConnections: vi.fn().mockReturnValue(of([
        { id: 4, connectionName: 'Tenant database', databaseName: 'smartops_tenant_TNT-1000', server: 'qa', port: 1433 },
      ])),
    };
    const permissions = { canCreate: vi.fn().mockReturnValue(true), canModify: vi.fn().mockReturnValue(true) };
    const component = new DatasetListComponent(
      modelStudio as never, commonApi as never, permissions as never, { navigate: vi.fn() } as never, { markForCheck: vi.fn() } as never);

    component.ngOnInit();
    expect(component.datasets.map(d => d.name)).toEqual(['Slice check']);
    expect(component.connectionName(4)).toBe('Tenant database');

    component.pendingDelete = component.datasets[0];
    expect(modelStudio.delete).not.toHaveBeenCalled();
    component.confirmDelete();

    expect(modelStudio.delete).toHaveBeenCalledWith(1);
    expect(component.datasets).toEqual([]);
    expect(component.toast?.kind).toBe('success');
    component.ngOnDestroy();
  });

  function withEligible(eligible: unknown[]): DatasetListComponent {
    const modelStudio = { list: vi.fn().mockReturnValue(of([])), connections: vi.fn().mockReturnValue(of(eligible)) };
    const commonApi = {
      getConnections: vi.fn().mockReturnValue(of([
        { id: 4, connectionName: 'Tenant database', databaseName: 'smartops_tenant_TNT-1000', server: 'qa', port: 1433 },
        { id: 5, connectionName: 'BI', databaseName: 'AlTasnimBI', server: 'qa', port: 1433 },
      ])),
    };
    const permissions = { canCreate: vi.fn().mockReturnValue(true), canModify: vi.fn().mockReturnValue(true) };
    const component = new DatasetListComponent(
      modelStudio as never, commonApi as never, permissions as never, { navigate: vi.fn() } as never, { markForCheck: vi.fn() } as never);
    component.ngOnInit();
    return component;
  }

  it('offers only the tenant database connections and preselects the only one', () => {
    const component = withEligible([{ id: 4, connectionName: 'Tenant database', databaseName: 'smartops_tenant_TNT-1000' }]);

    component.openCreate();

    expect(component.eligibleConnections.map(c => c.id)).toEqual([4]);
    expect(component.form.connectionId).toBe(4);
    expect(component.noEligibleConnection).toBe(false);
    expect(component.connectionName(5)).toBe('BI');
  });

  it('says no tenant database is set up when none is eligible', () => {
    const component = withEligible([]);

    component.openCreate();

    expect(component.form.connectionId).toBeNull();
    expect(component.noEligibleConnection).toBe(true);
  });

  it('shows published data models under Standard and the rest under WIP', () => {
    const datasets = [
      { id: 1, name: 'Draft one', description: null, connectionId: 4, status: 'draft', createdAt: '2026-09-21T07:23:51Z' },
      { id: 2, name: 'Live one', description: null, connectionId: 4, status: 'published', createdAt: '2026-09-21T07:23:51Z' },
    ];
    const make = (mode: string) => {
      const component = new DatasetListComponent(
        { list: () => of(datasets), connections: () => of([]) } as never, { getConnections: () => of([]) } as never,
        { canCreate: () => true, canModify: () => true } as never, { navigate: vi.fn() } as never, { markForCheck: vi.fn() } as never,
        { snapshot: { data: { mode } } } as never);
      component.ngOnInit();
      return component;
    };
    expect(make('standard').shown.map(d => d.name)).toEqual(['Live one']);
    expect(make('wip').shown.map(d => d.name)).toEqual(['Draft one']);
  });
});
