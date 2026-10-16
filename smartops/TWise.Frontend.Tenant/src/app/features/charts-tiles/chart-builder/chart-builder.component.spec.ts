import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartBuilderComponent } from './chart-builder.component';
import { ChartsTilesModule } from '../charts-tiles.module';
import { WidgetViewComponent } from '../widget-view/widget-view.component';
// The component is built from its prototype below, never rendered, so no TestBed or
// test NgModule is needed. Declaring it in one here would be a second declaration
// alongside ChartsTilesModule and fails NG6007.

describe('ChartBuilderComponent table preview', () => {
  let component: ChartBuilderComponent;

  beforeEach(() => {
    component = Object.assign(Object.create(ChartBuilderComponent.prototype), {
      xAxis: 'Name', yAxis: 'Amount', xAxisTitle: '', yAxisTitle: '',
      tableHeaderColor: '', tableHeaderTextColor: '',
      tableRowColors: [], tableRowTextColors: [],
      tableRows: [{ Name: 'First', Amount: 0 }, { Name: 'Second', Amount: null }],
      rawLoadedColumns: ['Name', 'Amount'], yAxisColumns: ['Name', 'Amount'],
      multiYColumns: [], parameterFilters: [], filterValues: {},
      crossTableFilterRows: null, fromDate: '', toDate: '',
    });
    vi.spyOn(component, 'daxRowWiseMeasures', 'get').mockReturnValue([]);
    vi.spyOn(component, 'daxRowSummaryMeasures', 'get').mockReturnValue([]);
  });

    describe('ChartBuilderComponent period category color rules', () => {
      let component: ChartBuilderComponent;

      beforeEach(() => {
        component = Object.assign(Object.create(ChartBuilderComponent.prototype), {
          selectedChartType: 'multiline', xAxis: 'Period', yAxis: 'Plan', xAxisTitle: '',
          yAggColumn: '', multiYColumns: ['Plan', 'Actual'], comboLineColumns: [],
          previewData: { categories: ['Oct 2026', 'Nov 2026'], values: [] },
          previewLegendItems: [], colorOverrides: {},
          colorRules: [{ id: 1, field: 'Category', operator: '', value: '',
            categories: ['Actual'], color: '#123456' }],
          chartPreviewOptions: null,
          filterFieldSearch: '',
          colorRuleFields: ['Category', 'Progress%', 'Status', 'Quantity', 'Priority'],
          colorRuleOperators: ['>=', '<=', '>', '<', 'Equal', 'Not Equal', 'Between'],
        });
        vi.spyOn(component, 'previewRows', 'get').mockReturnValue([]);
      });

      it('uses the existing chart module for template dependencies', () => {
        expect(ChartsTilesModule).toBeDefined();
      });

      it('offers legend series instead of periods before the preview is rendered', () => {
        expect(component.colorRuleCategories).toEqual(['Plan', 'Actual']);
      });

      it('uses the actual preview series labels and removes duplicates', () => {
        component.chartPreviewOptions = { series: [
          { type: 'line', name: 'Planned Wells', data: [] },
          { type: 'line', name: 'Issued Wells', data: [] },
          { type: 'line', name: 'Issued Wells', data: [] },
        ] };
        expect(component.colorRuleCategories).toEqual(['Planned Wells', 'Issued Wells']);
      });

      it('offers the single series name for a period-axis line chart', () => {
        component.selectedChartType = 'line';
        expect(component.colorRuleCategories).toEqual(['Plan']);
      });

      it('offers Period as a rule field only when the chart uses Period on the X axis', () => {
        expect(component.filteredColorRuleFields().slice(0, 2)).toEqual(['Category', 'Period']);
        component.colorRules[0].field = 'Period';
        expect(component.filteredColorRuleOperators(component.colorRules[0])).toEqual(['Equal', 'Not Equal']);
        component.xAxis = 'Well Name';
        expect(component.filteredColorRuleFields()).not.toContain('Period');
      });

      it('lists distinct X-axis periods as the Period rule values', () => {
        component.previewData.categories = ['Oct 2026', 'Nov 2026', 'Oct 2026', ' '];
        expect(component.periodColorRuleValues).toEqual(['Oct 2026', 'Nov 2026']);
      });

      it('clears stale values and uses a supported operator when Period is selected', () => {
        const rule = component.colorRules[0];
        rule.operator = '>=';
        rule.value = '5';
        rule.value2 = '10';
        vi.spyOn(component, 'onColorRuleChange').mockImplementation(() => undefined);
        component.selectColorRuleField(rule, 'Period');
        expect(rule).toMatchObject({
          field: 'Period', operator: 'Equal', value: '', value2: undefined, categories: undefined,
        });
      });

      it('matches a Period rule against the selected X-axis period, not a series name', () => {
        component.colorRules = [{
          id: 2, field: 'Period', operator: 'Equal', value: 'Nov 2026', color: '#654321',
        }];
        expect(component['previewColorFor']('Nov 2026', 3, 'Actual')).toBe('#654321');
        expect(component['previewColorFor']('Oct 2026', 2, 'Actual')).toBeUndefined();
      });

      it('matches Category rules against legend names across every period', () => {
        expect(component['previewCategoryColorFor']('Oct 2026', 'Actual')).toBe('#123456');
        expect(component['previewCategoryColorFor']('Nov 2026', 'actual')).toBe('#123456');
        expect(component['previewColorFor']('Oct 2026', 2, 'Actual')).toBe('#123456');
        expect(component['previewCategoryColorFor']('Actual', 'Plan')).toBeUndefined();
      });

      it('applies the chosen color to a period line only and preserves point colors', () => {
        const series = component['applyPreviewColorRules']([
          { type: 'line', name: 'Actual', color: '#abcabc', data: [
            { y: 2, color: '#112233' }, { y: 3, color: '#445566' },
          ] },
        ], ['Oct 2026', 'Nov 2026']);
        expect(series[0]).toEqual(expect.objectContaining({
          color: '#123456',
          data: [
            expect.objectContaining({ color: '#112233' }),
            expect.objectContaining({ color: '#445566' }),
          ],
        }));
      });

      it('preserves the normal per-period marker palette when series data has no explicit point colors', () => {
        const series = component['applyPreviewColorRules']([
          { type: 'line', name: 'Actual', color: '#aabbcc', data: [2, 3] },
        ], ['Oct 2026', 'Nov 2026']);
        const points = (series[0] as any).data as { color: string }[];
        expect((series[0] as any).color).toBe('#123456');
        expect(points.map(point => point.color)).toEqual([
          component['previewPointColor']('Oct 2026', 2, 0, 'Actual', false),
          component['previewPointColor']('Nov 2026', 3, 1, 'Actual', false),
        ]);
        expect(points[0].color).not.toBe('#123456');
        expect(points[1].color).not.toBe('#123456');
      });

      it('does not apply the selected series color to line points after chart creation', () => {
        const componentColor = component as any;
        componentColor.cdr = { detectChanges: vi.fn() };
        componentColor.previewPointColor = vi.fn(() => undefined);
        const points = [
          { category: 'Oct 2026', y: 2, color: '#112233', index: 0, options: {} },
          { category: 'Nov 2026', y: 3, color: '#445566', index: 1, options: {} },
        ];
        const chart = { series: [{ type: 'line', name: 'Actual', color: '#123456', points }], redraw: vi.fn() } as any;
        component.onPreviewChartInstance(chart);
        expect(points.map(point => point.color)).toEqual(['#112233', '#445566']);
      });

      it('retains X-axis category options and matching for non-period multiline charts', () => {
        component.xAxis = 'Plant';
        component.colorRules[0].categories = ['Amal'];
        component.previewData.categories = ['Amal', 'Nimr'];
        expect(component.colorRuleCategories).toEqual(['Amal', 'Nimr']);
        expect(component['previewCategoryColorFor']('Amal', 'Actual')).toBe('#123456');
        expect(component['previewCategoryColorFor']('Nimr', 'Amal')).toBeUndefined();
      });

      it('keeps legend-category rule matching when the saved chart is opened', () => {
        const viewer: WidgetViewComponent = Object.assign(Object.create(WidgetViewComponent.prototype), {
          design: { chartType: 'multiline', xAxis: 'Period', colorRules: component.colorRules },
        });
        expect(viewer['categoryColorForRule']('Oct 2026', 'Actual')).toBe('#123456');
        expect(viewer['colorForRule']('Nov 2026', 3, 'Actual')).toBe('#123456');
        expect(viewer['categoryColorForRule']('Actual', 'Plan')).toBeUndefined();
      });

      it('changes a saved line series color while retaining its existing point colors', () => {
        const viewer: WidgetViewComponent = Object.assign(Object.create(WidgetViewComponent.prototype), {
          design: {
            chartType: 'multiline', xAxis: 'Period', yAxis: 'Actual',
            colorRules: component.colorRules,
          },
          multiSeriesData: [{ name: 'Actual', data: [2, 3], color: '#aabbcc' }],
          categories: [{ label: 'Oct 2026' }, { label: 'Nov 2026' }],
          chart: { title: 'Production' },
        });
        const options = viewer['buildLineOptions']('line', 'M', () => undefined);
        const series = options.series![0] as any;
        const pointColors = series.data.map((point: { color?: string }) => point.color);
        const noRuleViewer: WidgetViewComponent = Object.assign(Object.create(WidgetViewComponent.prototype), {
          ...viewer,
          design: { ...viewer.design, colorRules: [] },
        });
        const noRuleOptions = noRuleViewer['buildLineOptions']('line', 'M', () => undefined);
        const noRulePointColors = (noRuleOptions.series![0] as any).data
          .map((point: { color?: string }) => point.color);
        expect(series.color).toBe('#123456');
        expect(pointColors).toEqual(noRulePointColors);
      });
    });

  it('keeps unchanged column and row references stable across change detection', () => {
    expect(component.tablePreviewColumnDefs).toBe(component.tablePreviewColumnDefs);
    expect(component.tablePreviewRowData).toBe(component.tablePreviewRowData);
  });

  it('preserves mapped column order, zero values and null placeholders', () => {
    expect(component.tablePreviewColumnDefs.map(column => column.headerName)).toEqual(['Name', 'Amount']);
    expect(component.tablePreviewRowData.map(row => row.values)).toEqual([
      ['First', 0], ['Second', '\u2014'],
    ]);
  });

  it('offers renamed columns for local interactive filters without sending them to SQL', () => {
    Object.assign(component, {
      selectedChartModelId: 'Wells',
      filterFieldSearch: '',
      conditionalFilters: [],
      interactiveFilters: [{ id: 1, sourceTable: 'Wells', sourceColumn: 'Well Name',
        controlType: 'Dropdown', locked: true, lockedValue: 'First' }],
      parameterFilters: [{ id: 2, action: 'rename_column', sourceColumn: 'Name', newColumnName: 'Well Name' }],
      tableRows: [{ 'Well Name': 'First', Amount: 0 }, { 'Well Name': 'Second', Amount: 1 }],
    });
    const filter = component.interactiveFilters[0];
    expect(component.filteredFilterColumns(filter)[0]).toBe('Well Name');
    filter.locked = false;
    expect(component.getPreviewFilterOptions(filter)).toEqual(['First', 'Second']);
    filter.locked = true;
    expect((component as any).lockedInteractiveFilterPayload()).toEqual([]);
  });
});