import type Highcharts from 'highcharts';

export function applyScenarioChartReadability(options: Highcharts.Options, hasForecast: boolean): Highcharts.Options {
  if (!hasForecast || !options.series?.length
    || !options.series.every(series => 'type' in series && typeof series.type === 'string'
      && ['line', 'spline', 'area', 'areaspline', 'column', 'bar'].includes(series.type))) {
    return options;
  }
  options.tooltip = { ...options.tooltip, shared: true, valueDecimals: 2 };
  improveLabels(options.plotOptions);
  improveLabels(options.series);
  return options;
}

function improveLabels(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(improveLabels);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'dataLabels') styleLabels(value);
    else improveLabels(value);
  }
}

function styleLabels(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach(styleLabels);
    return;
  }
  const labels = value as Record<string, unknown>;
  labels['allowOverlap'] = false;
  labels['padding'] = 3;
  labels['backgroundColor'] = '#FFFFFF';
  labels['borderRadius'] = 3;
  const style = labels['style'];
  labels['style'] = {
    ...(style && typeof style === 'object' ? style : {}),
    color: '#344054', fontSize: '12px', textOutline: 'none',
  };
}
