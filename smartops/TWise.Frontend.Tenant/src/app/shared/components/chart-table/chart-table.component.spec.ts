import { describe, expect, it } from 'vitest';
import { RowClassParams } from 'ag-grid-community';
import { ChartTableComponent } from './chart-table.component';

describe('ChartTableComponent row colors', () => {
  const rowParams = (index: number) => ({ data: { index } }) as RowClassParams;

  it('preserves rule backgrounds and text colors under the hover overlay', () => {
    const component = new ChartTableComponent();
    component.rowColors = ['#3B82F6'];
    component.rowTextColors = ['#FFFFFF'];
    expect(component.rowStyle(rowParams(0))).toEqual({
      backgroundColor: '#3B82F6',
      '--ag-row-hover-color': 'transparent',
      color: '#FFFFFF',
    });
  });

  it('preserves saved custom row backgrounds on hover', () => {
    const component = new ChartTableComponent();
    component.designJson = JSON.stringify({ tableRowColors: ['#123456'] });
    component.ngOnChanges();
    expect(component.rowStyle(rowParams(0))).toMatchObject({
      backgroundColor: '#123456',
      '--ag-row-hover-color': 'transparent',
    });
  });

  it('keeps normal hover highlighting for rows without custom colors', () => {
    const component = new ChartTableComponent();
    component.rowColors = ['#3B82F6'];
    expect(component.rowStyle(rowParams(1))).toMatchObject({
      backgroundColor: '#FFF7ED',
      '--ag-row-hover-color': '#F5F8FF',
    });
  });

  it('restores normal hover highlighting when a rule is removed', () => {
    const component = new ChartTableComponent();
    component.rowColors = ['#3B82F6'];
    expect(component.rowStyle(rowParams(0))['--ag-row-hover-color']).toBe('transparent');
    component.rowColors = [];
    expect(component.rowStyle(rowParams(0))).toMatchObject({
      backgroundColor: '#EFF6FF',
      '--ag-row-hover-color': '#F5F8FF',
    });
  });
});
