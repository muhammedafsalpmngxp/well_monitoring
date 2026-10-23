import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { TileBuilderComponent } from './tile-builder.component';

describe('table tile global filtering', () => {
  it('requests a server aggregate rather than calculating over the preview rows', () => {
    const getFilteredChartData = vi.fn(() => of({ columns: ['Value'], rows: [{ Value: 25000 }] }));
    const component = Object.assign(Object.create(TileBuilderComponent.prototype), {
      dataSourceMode: 'table', selectedDataSourceId: 'crew_employee', dataSources: [],
      columnsForSource: ['EmployeeId'], tableRows: [{ EmployeeId: 1 }],
      filterValues: { country: 'Oman' }, calculation: 'count', valueColumn: '',
      daxModel: { enabled: false, measures: [] },
      widgetService: { getFilteredChartData },
      cdr: { markForCheck: vi.fn() },
    }) as TileBuilderComponent;

    component['computeTileValueFromServer']();

    expect(getFilteredChartData).toHaveBeenCalledWith(expect.objectContaining({
      chartSource: 'crew_employee', aggregation: 'count',
      filters: [expect.objectContaining({ sourceColumn: 'country', globalHierarchy: true })],
    }));
    expect(component.liveValue).toBe(25000);
  });
});
