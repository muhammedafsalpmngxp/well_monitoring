import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { CHART_COLORS } from '../../../../core/constants/chart-view.constants';
import { DiagramComponent } from './diagram.component';
// Imported for its NgModule metadata only. DiagramComponent is `standalone: false`,
// so without its declaring module the compiler sees an empty template scope and fails NG8001.
import { ModelStudioModule } from '../../model-studio.module';

describe('DiagramComponent', () => {
  it('gives each table card its own colour from the chart palette, in data model order', () => {
    const component = new DiagramComponent({ nativeElement: {} } as never, { markForCheck: vi.fn() } as never);
    component.sources = Array.from({ length: CHART_COLORS.length + 1 }, (_, i) => ({
      id: i + 1, schemaName: 'core', sourceName: `Table${i}`, alias: `Table${i}`, rlsMode: 'none', rlsPlantColumn: null,
    })) as never;

    component.ngOnChanges();

    expect(component.cards.map(card => card.accent)).toEqual([...CHART_COLORS, CHART_COLORS[0]]);
  });
});
