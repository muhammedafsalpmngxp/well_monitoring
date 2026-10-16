import { Injectable } from '@angular/core';
import { AiQueryResult, AiQuerySpec, AiSourceType } from './ai.service';

/** What the Ask AI panel hands to the Chart Builder: dataset plus the axis mapping the answer used. */
export interface AiChartPreset {
  sourceType: AiSourceType;
  sourceId: number;
  /** View name or dataset name; the widget's `source` for views. */
  sourceName: string;
  title: string;
  chartType: string;
  xAxis: string;
  /** Chart Builder function label, e.g. "Sum (F)". Empty for table charts. */
  yAxis: string;
  yAggColumn: string;
  topN: number | null;
}

const AGG_TO_FUNCTION: Record<string, string> = {
  count: 'Count (F)', countDistinct: 'Count Distinct (F)', sum: 'Sum (F)', avg: 'Average (F)', min: 'Min (F)', max: 'Max (F)',
};
const STORAGE_KEY = 'chart-builder-ai-preset';

/**
 * One-shot hand-off from the Ask AI panel to the Chart Builder through sessionStorage, so the
 * builder can be opened by a normal navigation and pick the preset up in ngOnInit.
 */
@Injectable({ providedIn: 'root' })
export class AiChartPresetService {
  /** Maps an answered query onto the Chart Builder's single-series model; null when it does not fit (e.g. two group-by columns). */
  suggest(spec: AiQuerySpec, result: AiQueryResult, question: string, sourceType: AiSourceType, sourceId: number, sourceName: string): AiChartPreset | null {
    const measures = spec.measures ?? [];
    const groupBy = spec.groupBy ?? [];
    const title = question.length > 60 ? question.slice(0, 57) + '…' : question;
    if (measures.length === 0) {
      return { sourceType, sourceId, sourceName, title, chartType: 'table', xAxis: result.columns[0] ?? '', yAxis: '', yAggColumn: '', topN: null };
    }
    if (groupBy.length !== 1 || measures.length !== 1) return null;
    const m = measures[0];
    const x = groupBy[0];
    const looksLikeDate = result.rows.slice(0, 5).every(r => { const v = r[x]; return typeof v === 'string' && !Number.isNaN(Date.parse(v)); });
    const chartType = looksLikeDate ? 'line' : result.totalRows <= 6 ? 'pie' : 'bar';
    const topN = spec.limit && spec.sort?.column === (m.alias ?? '') && spec.sort.descending && result.totalRows > spec.limit ? spec.limit : null;
    return { sourceType, sourceId, sourceName, title, chartType, xAxis: x, yAxis: AGG_TO_FUNCTION[m.agg] ?? 'Count (F)', yAggColumn: m.column ?? '', topN };
  }

  /** The fields a saved chart widget needs; mirrors what the Chart Builder writes for a plain single-series chart. */
  widgetPayload(p: AiChartPreset): { source: string; sourceType: string; sourceId: number; designJson: string } {
    const isView = p.sourceType === 'view';
    const design = {
      chartType: p.chartType, xAxis: p.xAxis, yAxis: p.yAxis || 'Count (F)', yAggColumn: p.yAggColumn,
      xAxisTitle: '', yAxisTitle: '', showLegend: true, includeDataTable: false, showAxisTitle: false, showDataLabels: true, showStackTotal: true,
      limitCategory: p.topN ? 'top' : 'all', topN: p.topN ?? 100, bottomN: 0, groupRestAsOthers: false,
      source: isView ? p.sourceName : String(p.sourceId), sourceType: isView ? 'View' : 'Import', dataSourceMode: p.sourceType, viewId: p.sourceId,
      interactiveFilters: [],
    };
    return { source: design.source, sourceType: design.sourceType, sourceId: p.sourceId, designJson: JSON.stringify(design) };
  }

  set(preset: AiChartPreset): void {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(preset)); } catch { /* storage blocked: the builder just opens empty */ }
  }

  /** Reads and clears the preset so a later plain visit to the builder starts clean. */
  take(): AiChartPreset | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(STORAGE_KEY);
      return JSON.parse(raw) as AiChartPreset;
    } catch { return null; }
  }
}
