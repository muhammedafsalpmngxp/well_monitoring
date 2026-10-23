export type TileLayout = 'two-rows' | 'single-row';

export function resolveTileLayout(value: unknown): TileLayout {
  return value === 'single-row' ? 'single-row' : 'two-rows';
}
