export const CHART_AUTO_COLORS = [
  '#4285F4',
  '#FBBC05',
  '#34A853',
  '#AB47BC',
  '#00ACC1',
  '#FF7043',
  '#9E9D24',
  '#5C6BC0',
  '#00897B',
  '#7E57C2',
  '#37474F',
  '#8E2430',
  '#1E3A8A',
  '#D81B60',
  '#7986CB',
  '#B5523C',
] as const;

const SERIES_COLOR_MAP: Readonly<Record<string, string>> = {
  'total drilled wells': '#3F7D32',
  'total drilled': '#3F7D32',
  'plan - due well': '#168BCB',
  'plan due well': '#168BCB',
  'actual - wells completed': '#F58220',
  'actual wells completed': '#F58220',
  'actual completed wells': '#F58220',
};

function normalizeSeriesName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[_/\\]+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+/g, ' ')
    .trim();
}

export function getSeriesColorByName(name: string | undefined | null, fallbackIndex = 0): string {
  const normalized = normalizeSeriesName(String(name ?? ''));

  if (!normalized) {
    return chartFallbackColor('Unnamed Series', fallbackIndex);
  }

  if (SERIES_COLOR_MAP[normalized]) {
    return SERIES_COLOR_MAP[normalized];
  }

  if (normalized.includes('total') && normalized.includes('drill')) {
    return '#3F7D32';
  }

  if (normalized.includes('plan') && (normalized.includes('due') || normalized.includes('well'))) {
    return '#168BCB';
  }

  if (normalized.includes('actual') && (normalized.includes('completed') || normalized.includes('complete') || normalized.includes('well'))) {
    return '#F58220';
  }

  return chartFallbackColor(normalized, fallbackIndex);
}

export function chartFallbackColor(_seed: string, index: number): string {
  return CHART_AUTO_COLORS[index % CHART_AUTO_COLORS.length];
}

export function usesSeriesCategoryColorRules(chartType: string | null | undefined, xAxis: string | null | undefined): boolean {
  return chartType === 'stacked' || chartType === 'grouped' || chartType === 'combo'
    || xAxis?.trim().toLowerCase() === 'period';
}

export function usesPeriodLineCategoryColorRules(
  chartType: string | null | undefined,
  xAxis: string | null | undefined,
  seriesType?: string | null,
): boolean {
  if (xAxis?.trim().toLowerCase() !== 'period') return false;
  const lineTypes = ['line', 'spline', 'area', 'areaspline'];
  return lineTypes.includes((seriesType ?? chartType ?? '').toLowerCase())
    || (!seriesType && ['multiline', 'trend'].includes((chartType ?? '').toLowerCase()));
}