import type Highcharts from 'highcharts';

/**
 * Optional "Show Data Labels" support. Existing charts have no `showDataLabels` flag, so they are
 * treated as enabled and their options pass through untouched — guaranteeing no change in behaviour.
 * Only when a chart explicitly sets the flag to `false` are all value labels turned off; tooltips,
 * hover and every other interaction are left exactly as before.
 */
export function applyDataLabelPreference<T extends Highcharts.Options | null | undefined>(
  options: T,
  showDataLabels: boolean | undefined,
): T {
  if (showDataLabels !== false || !options) return options;
  disableEnabledDataLabels(options);
  return options;
}

/** Recursively flips every `dataLabels.enabled === true` to `false`; leaves format-only labels (e.g. gauges) alone. */
function disableEnabledDataLabels(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) disableEnabledDataLabels(item);
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === 'dataLabels') turnOff(value);
    else disableEnabledDataLabels(value);
  }
}

function turnOff(dataLabels: unknown): void {
  if (!dataLabels || typeof dataLabels !== 'object') return;
  if (Array.isArray(dataLabels)) {
    for (const item of dataLabels) turnOff(item);
    return;
  }
  const record = dataLabels as Record<string, unknown>;
  if (record['enabled'] === true) record['enabled'] = false;
}
