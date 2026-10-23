import { describe, expect, it, vi } from 'vitest';
import { ChartBuilderComponent } from './chart-builder.component';

function createBuilder(colorOverrides: Record<string, string> = {}): ChartBuilderComponent {
  return Object.assign(Object.create(ChartBuilderComponent.prototype), {
    colorOverrides, cdr: { markForCheck: vi.fn() },
  });
}

function openPicker(builder: ChartBuilderComponent, currentColor?: unknown): void {
  const event = { preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 10, clientY: 10 } as unknown as Event;
  builder.openPointColorPicker('North', 'Value', event, undefined, currentColor);
}

describe('ChartBuilderComponent point color picker', () => {
  it('opens on the clicked point\'s rendered color', () => {
    const builder = createBuilder();
    openPicker(builder, '#FBBC05');
    expect(builder.colorPickerValue).toBe('#fbbc05');
    expect(builder.colorPickerOpen).toBe(true);
  });

  it('normalizes short hex and rgb colors for the color input', () => {
    const builder = createBuilder();
    openPicker(builder, '#0f8');
    expect(builder.colorPickerValue).toBe('#00ff88');
    openPicker(builder, 'rgba(52, 168, 83, 0.9)');
    expect(builder.colorPickerValue).toBe('#34a853');
  });

  it('prefers a saved manual override for that point', () => {
    const builder = createBuilder({ 'Value:North': '#123456' });
    openPicker(builder, '#FBBC05');
    expect(builder.colorPickerValue).toBe('#123456');
  });

  it('falls back to the default blue when the point color is unknown', () => {
    const builder = createBuilder();
    openPicker(builder, { linearGradient: {} });
    expect(builder.colorPickerValue).toBe('#3B82F6');
  });
});
