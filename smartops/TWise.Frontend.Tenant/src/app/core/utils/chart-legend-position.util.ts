import type Highcharts from 'highcharts';

/** Where a chart's legend sits around the plot. Saved in a chart's designJson as `legendPosition`. */
export type LegendPosition = 'top' | 'right' | 'bottom' | 'left';

export const DEFAULT_LEGEND_POSITION: LegendPosition = 'bottom';

export const LEGEND_POSITION_OPTIONS: readonly { value: LegendPosition; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
];

const POSITIONS = new Set<string>(LEGEND_POSITION_OPTIONS.map(option => option.value));

export function isLegendPosition(value: unknown): value is LegendPosition {
  return typeof value === 'string' && POSITIONS.has(value);
}

/** The saved position, or bottom for charts saved before the option existed (or with an unknown value). */
export function readLegendPosition(design: { legendPosition?: unknown } | null | undefined): LegendPosition {
  const value = design?.legendPosition;
  return isLegendPosition(value) ? value : DEFAULT_LEGEND_POSITION;
}

/**
 * Class list for the `.chart-legend-layout` wrapper (styles/_chart-legend-layout.scss) placed around a chart and
 * its HTML legend. Bottom keeps the host's own layout untouched.
 */
export function legendLayoutClass(position: LegendPosition | null | undefined): string {
  return `chart-legend-layout chart-legend-layout--${isLegendPosition(position) ? position : DEFAULT_LEGEND_POSITION}`;
}

/** Highcharts' own legend placed at the position: side legends stack vertically, centred on the plot. */
export function highchartsLegendPosition(position: LegendPosition): Pick<Highcharts.LegendOptions, 'layout' | 'align' | 'verticalAlign'> {
  const side = position === 'left' || position === 'right';
  return {
    layout: side ? 'vertical' : 'horizontal',
    align: side ? position : 'center',
    verticalAlign: side ? 'middle' : position,
  };
}
