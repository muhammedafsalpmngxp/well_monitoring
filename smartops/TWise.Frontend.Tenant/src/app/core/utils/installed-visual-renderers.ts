import { bindCustomVisualTemplate } from '../services/custom-visual-binding';
import { InstalledVisual } from '../services/marketplace.service';
import { getAdvancedCustomRenderers, registerAdvancedCustomRenderer } from './advanced-chart.util';

/**
 * Turns visuals installed from the marketplace into renderers for the 'customvisual' chart type.
 *
 * This is what makes a plugin usable without a deployment: the definition lives in the database,
 * and each one becomes an ordinary entry in the Renderer dropdown alongside the built-in shapes.
 * Reusing that extension point keeps one chart type rather than a second, parallel mechanism.
 */
export function registerInstalledVisuals(visuals: InstalledVisual[]): void {
  const existing = new Set(getAdvancedCustomRenderers().map(r => r.id));

  for (const visual of visuals) {
    // Only declarative templates are supported; any other kind needs a sandbox that does not
    // exist yet, and silently rendering it would be worse than leaving it out.
    if (visual.renderKind !== 'highcharts-template') continue;
    if (existing.has(visual.visualKey)) continue;

    registerAdvancedCustomRenderer({
      id: visual.visualKey,
      label: visual.displayName,
      render: (categories, values) =>
        bindCustomVisualTemplate(visual.optionsTemplateJson, visual.dataRoles ?? [], {
          labels: categories,
          values,
        }) ?? { series: [] },
    });
  }
}
