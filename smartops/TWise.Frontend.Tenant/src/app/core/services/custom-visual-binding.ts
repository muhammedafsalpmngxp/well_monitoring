import { CustomVisualDataRole } from './marketplace.service';

/**
 * The data a template is bound against. Both render pipelines supply this shape, which is what
 * keeps a visual looking the same in the builder preview and in the saved widget.
 */
export interface CustomVisualBindingData {
  /** Category labels, bound to dimension roles. */
  labels: string[];
  /** Numeric values, bound to measure roles. Null where a category has no value. */
  values: (number | null)[];
  /** Column name shown for dimension roles; falls back to the role's own label. */
  dimensionLabel?: string;
  /** Column name shown for measure roles; falls back to the role's own label. */
  measureLabel?: string;
}

/**
 * Series types that label each point themselves instead of through an x-axis, and the point shape
 * each one expects. Anything not listed takes a plain numeric array against the category axis.
 */
const NAMED_POINT_SHAPES: Record<string, (name: string, y: number | null) => Record<string, unknown>> = {
  pie: (name, y) => ({ name, y }),
  funnel: (name, y) => ({ name, y }),
  pyramid: (name, y) => ({ name, y }),
  variablepie: (name, y) => ({ name, y, z: y }),
  item: (name, y) => ({ name, y }),
  wordcloud: (name, y) => ({ name, weight: y ?? 0 }),
  packedbubble: (name, y) => ({ name, value: y }),
  sunburst: (name, y) => ({ id: name, name, value: y }),
};

/** Series that compute their points from another series (baseSeries) and must not be given data. */
const DERIVED_SERIES = new Set(['pareto', 'bellcurve', 'histogram']);

/** Matches a string that is EXACTLY a placeholder, optionally with the `.label` suffix. */

const PLACEHOLDER = /^\s*\{\{\s*([a-zA-Z0-9_]+)(?:\.(label))?\s*\}\}\s*$/;

/**
 * Binds data into a custom visual's options template.
 *
 * Deliberately a pure function with no Angular dependencies: it is the piece that decides whether
 * a visual renders at all, so it has to be directly testable. The service and both render
 * pipelines call it rather than each doing their own substitution, which would let the builder
 * preview drift from what the saved widget draws.
 *
 * Binding contract — explicit, so what a placeholder resolves to never depends on where it sits:
 *
 *   {{role}}        the role's DATA: category labels for a dimension, numbers for a measure.
 *   {{role.label}}  the role's COLUMN NAME as text, for titles and series names.
 *
 * Only a string that is EXACTLY a placeholder is substituted, and it is replaced by a real value
 * rather than by text, so an array arrives at Highcharts as an array. The template is pure JSON —
 * validated server-side — so nothing here is evaluated.
 *
 * Returns null when the template is unusable; callers render that as an empty chart rather than
 * throwing inside a render cycle and blanking the page.
 */
export function bindCustomVisualTemplate(
  optionsTemplateJson: string,
  dataRoles: CustomVisualDataRole[],
  data: CustomVisualBindingData,
): Record<string, any> | null {
  let template: unknown;
  try {
    template = JSON.parse(optionsTemplateJson);
  } catch {
    return null;
  }
  if (!template || typeof template !== 'object' || Array.isArray(template)) return null;

  const bindings = new Map<string, { data: unknown; label: string }>();
  for (const role of dataRoles ?? []) {
    bindings.set(role.key.toLowerCase(), role.type === 'measure'
      ? { data: data.values, label: data.measureLabel || role.label }
      : { data: data.labels, label: data.dimensionLabel || role.label });
  }

  const bound = substitute(template, bindings) as Record<string, any>;

  if (Array.isArray(bound['series'])) {
    const chartType = (bound['chart'] as any)?.type;

    bound['series'] = bound['series'].map((entry: any) => {
      if (!entry || typeof entry !== 'object') return entry;
      const next = { ...entry };

      // Highcharts needs a concrete series type. A template that sets only chart.type leaves
      // the series untyped, which silently renders nothing.
      if (!next.type && chartType) next.type = chartType;

      // A series with no data gets the measure values, so the common single-measure template
      // does not have to repeat the binding on every series entry. Slice-based series have no
      // x-axis to take category names from, so they get named points instead.
      if (next.data === undefined && !DERIVED_SERIES.has(next.type)) {
        const shape = NAMED_POINT_SHAPES[next.type];
        next.data = shape ? data.values.map((y, i) => shape(data.labels[i], y)) : data.values;
      }

      return next;
    });
  }

  return bound;
}

/** Recursively replaces exact-match placeholders with their bound value. */
function substitute(node: unknown, bindings: Map<string, { data: unknown; label: string }>): unknown {
  if (typeof node === 'string') {
    const match = PLACEHOLDER.exec(node);
    if (!match) return node;

    const binding = bindings.get(match[1].toLowerCase());
    if (!binding) return node;           // unbound: leave the literal text so it is visible
    return match[2] ? binding.label : binding.data;
  }

  if (Array.isArray(node)) return node.map(item => substitute(item, bindings));

  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = substitute(value, bindings);
    }
    return out;
  }

  return node;
}
