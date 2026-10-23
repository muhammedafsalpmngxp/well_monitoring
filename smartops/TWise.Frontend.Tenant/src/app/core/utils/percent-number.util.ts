/**
 * Percentage-aware number parsing. Cells such as "12.5%" (e.g. produced by an Append Text "%"
 * transformation or a percent-formatted measure) are numeric for every math/aggregate/compare
 * operation; any other text stays non-numeric.
 */
const PERCENT_VALUE_PATTERN = /^\s*[-+]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?\s*%\s*$/;

/** True for a percentage cell string such as "12.5%", "-3 %" or "1,250.75%". */
export function isPercentValue(value: unknown): boolean {
  return typeof value === 'string' && PERCENT_VALUE_PATTERN.test(value);
}

/** Number() coercion with support for a numeric "%" suffix, without scaling by 100. */
export function coerceNumberAllowPercent(value: unknown): number {
  return typeof value === 'string' && isPercentValue(value)
    ? Number(value.replace(/[%,\s]/g, ''))
    : Number(value);
}

/**
 * Numeric value of a cell: numbers as-is, numeric strings via Number(), and percentage strings
 * with the trailing "%" stripped ("12.5%" → 12.5). Blank, boolean and other text yields NaN.
 */
export function parseNumberAllowPercent(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value == null || value === '' || typeof value === 'boolean') return NaN;
  if (typeof value === 'string' && value.trim() === '') return NaN;
  return coerceNumberAllowPercent(value);
}

/** Numeric value formatted back as percentage text, e.g. 150.5 → "150.5%". */
export function formatPercentValue(value: number): string {
  const rounded = Number.isInteger(value) ? value : +value.toFixed(2);
  return `${rounded}%`;
}
