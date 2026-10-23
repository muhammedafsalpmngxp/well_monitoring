import html2canvas from 'html2canvas';

export interface DashboardWidgetBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardWidgetImage {
  bounds: DashboardWidgetBounds;
  canvas: HTMLCanvasElement;
}

/**
 * html2canvas measures each word's position in its cloned iframe but paints the glyphs on a canvas
 * in the main page. It only awaits the clone's `fonts.ready` BEFORE `onclone` runs — which resolves
 * at once when nothing has requested a web font yet, and never covers faces first needed by
 * `onclone`'s own restyling (e.g. un-truncating a bold title). The words were then positioned with
 * the narrower fallback font and painted with the real one, so they ran into each other in the
 * exported PNG/PDF. Load the actual text in both documents: the clone measures it, but the source
 * document's canvas paints it. Await this before measuring layout and again after export restyling.
 */
export async function loadCloneFonts(document: Document, root: HTMLElement, timeoutMs = 10000): Promise<void> {
  const fonts = document.fonts;
  const view = document.defaultView;
  if (!fonts || !view) return;
  const faces = new Map<string, string>();
  for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
    const text = Array.from(element.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent ?? '').join('');
    if (!text.trim()) continue;
    const style = view.getComputedStyle(element);
    const face = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    faces.set(face, (faces.get(face) ?? '') + text);
  }
  const fontSets = new Set([fonts, globalThis.document.fonts].filter((set): set is FontFaceSet => !!set));
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = view.setTimeout(() => reject(new Error('Dashboard export fonts did not finish loading. Please try again.')), timeoutMs);
  });
  try {
    await Promise.race([
      Promise.all(Array.from(fontSets, async set => {
        await Promise.all(Array.from(faces, ([face, text]) => set.load(face, text)));
        await set.ready;
      })),
      timeout,
    ]);
    void root.offsetHeight;
  } finally {
    view.clearTimeout(timer);
  }
}

/** Capture in layout pixels: html2canvas scales text bounds under CSS zoom, but not canvas fonts. */
export function prepareIndividualChartExportClone(widget: HTMLElement, width: number): void {
  let ancestor: HTMLElement | null = widget;
  while (ancestor) {
    ancestor.style.setProperty('zoom', '1', 'important');
    ancestor.style.setProperty('--app-zoom-factor', '1');
    ancestor = ancestor.parentElement;
  }
  widget.style.setProperty('box-sizing', 'border-box', 'important');
  for (const property of ['width', 'min-width', 'max-width']) {
    widget.style.setProperty(property, `${width}px`, 'important');
  }
}

/**
 * Individual chart downloads can grow to the table's natural width to reveal every column.
 * Dashboard downloads instead keep the card width and wrap the table, avoiding compression
 * when the captured card is composited back into its dashboard slot.
 */
export function measureDashboardWidgetCaptureWidth(widget: HTMLElement, baseWidth: number): number {
  const widgetStyle = getComputedStyle(widget);
  const horizontalPadding = parseFloat(widgetStyle.paddingLeft) + parseFloat(widgetStyle.paddingRight);
  let widest = baseWidth;
  for (const table of widget.querySelectorAll<HTMLTableElement>(
    '.ops-dashboard__chart-table table, .ops-dashboard__chart-data-table table',
  )) {
    widest = Math.max(widest, table.scrollWidth + horizontalPadding);
  }
  return widest;
}

/** One common scale preserves widget sizes, gaps and intentionally empty grid space. */
export function positionDashboardWidgets(images: DashboardWidgetImage[], usableWidth: number, includeScrollableContent = false) {
  const items = images.map(({ bounds, canvas }) => ({
    x: bounds.x * usableWidth,
    y: bounds.y * usableWidth,
    w: bounds.w * usableWidth,
    h: bounds.h * usableWidth,
    canvas,
  }));
  if (includeScrollableContent) {
    const placed: { index: number; originalY: number; originalH: number }[] = [];
    const order = items.map((item, index) => ({ index, originalY: item.y, originalH: item.h }))
      .sort((a, b) => a.originalY - b.originalY);
    for (const entry of order) {
      const item = items[entry.index];
      const canvas = images[entry.index].canvas;
      item.h = Math.max(item.h, canvas.height * item.w / canvas.width);
      for (const previous of placed) {
        const above = items[previous.index];
        const gap = entry.originalY - previous.originalY - previous.originalH;
        if (gap >= -0.01 && item.x < above.x + above.w && item.x + item.w > above.x) {
          item.y = Math.max(item.y, above.y + above.h + Math.max(0, gap));
        }
      }
      placed.push(entry);
    }
  }
  return { items, totalHeight: Math.max(0, ...items.map(item => item.y + item.h)) };
}

/** Reveal scroll content in the download clone without reflowing or enlarging the chart itself. */
export function expandDashboardChartScrollAreas(widget: HTMLElement): void {
  // The card itself owns the scrollbar in the dashboard; its children can already be full-height.
  // (No upfront "any overflow?" bail: prior style overrides can make that check miss a still-too-wide table.)
  const containers = [widget, ...Array.from(widget.querySelectorAll<HTMLElement>(
    '.ops-dashboard__chart-body, .ops-dashboard__chart-table, .ops-dashboard__chart-data-table, .ops-dashboard__table-grid',
  ))];
  const view = widget.ownerDocument.defaultView;
  if (!view) throw new Error('Dashboard chart export window is unavailable.');
  // Inline stat tiles within a chart card (e.g. "Total/Actual/Plan" above a pie chart) are
  // ellipsis-truncated like a KPI tile's label - un-clip them so the full name is captured.
  // Shrinking the font (instead of wrapping to 2 lines) keeps the label on one line, so it can
  // never overlap the value below it.
  for (const span of widget.querySelectorAll<HTMLElement>('.ops-dashboard__card-stat-text > span')) {
    span.style.setProperty('overflow', 'visible', 'important');
    span.style.setProperty('text-overflow', 'unset', 'important');
    span.style.setProperty('white-space', 'nowrap', 'important');
    const available = span.parentElement?.clientWidth ?? 0;
    if (available > 0 && span.scrollWidth > available) {
      const currentSize = parseFloat(view.getComputedStyle(span).fontSize) || 12;
      span.style.setProperty('font-size', `${Math.max(8, Math.floor(currentSize * (available / span.scrollWidth)))}px`, 'important');
    }
  }
  // Without wrapping, a row of several tiles overflows the card width and the excess tiles'
  // names get cut off at the fixed capture edge instead of just wrapping to a new line.
  const cardStatsEl = widget.querySelector('.ops-dashboard__card-stats') as HTMLElement | null;
  cardStatsEl?.style.setProperty('flex-wrap', 'wrap', 'important');
  // The chart legend's ellipsis/tooltip truncation lives on the label, not its pill wrapper.
  for (const label of widget.querySelectorAll<HTMLElement>('.ops-dashboard__chart-legend-item, .ops-dashboard__chart-legend-label')) {
    label.style.setProperty('overflow', 'visible', 'important');
    label.style.setProperty('text-overflow', 'unset', 'important');
    label.style.setProperty('max-width', 'none', 'important');
    label.style.setProperty('white-space', 'normal', 'important');
    label.style.setProperty('overflow-wrap', 'anywhere', 'important');
  }
  // The card itself is still locked to its original (pre-wrap) on-screen height at this point
  // (prepareDashboardWidgetClone set it before this function ran) - grow it now, before the chart
  // height below gets measured/locked, so a taller wrapped stats row pushes the chart down instead
  // of the two overlapping within the still-fixed-height card.
  widget.style.setProperty('height', 'auto', 'important');
  widget.style.setProperty('max-height', 'none', 'important');
  // html2canvas replaces custom-element hosts and drops their original tag/attributes.
  for (const chart of widget.querySelectorAll<HTMLElement>(
    'highcharts-chart, app-advanced-chart, .ops-dashboard__chart-body > html2canvascustomelement',
  )) {
    const height = view.getComputedStyle(chart).height;
    for (const property of ['height', 'min-height', 'max-height']) chart.style.setProperty(property, height, 'important');
    chart.style.setProperty('flex', '0 0 auto', 'important');
  }
  for (const table of widget.querySelectorAll<HTMLTableElement>(
    '.ops-dashboard__chart-table table, .ops-dashboard__chart-data-table table, .ops-dashboard__table-grid table',
  )) {
    // Always fit (not gated on a scrollWidth/contentWidth check): the table's own scrollWidth can
    // already equal its content width here (its max-content parent already sized to it, so there is
    // no "internal" scroll to detect), which made that check unreliable and left wide tables un-wrapped.
    // Fit every column in the export copy; wrapping retains font sizes and the dashboard width.
    const container = table.closest<HTMLElement>(
      '.ops-dashboard__chart-table, .ops-dashboard__chart-data-table, .ops-dashboard__table-grid',
    );
    if (container) {
      container.style.setProperty('box-sizing', 'border-box', 'important');
      container.style.setProperty('width', '100%', 'important');
      container.style.setProperty('min-width', '0', 'important');
      container.style.setProperty('max-width', '100%', 'important');
    }
    table.style.setProperty('table-layout', 'fixed', 'important');
    table.style.setProperty('width', '100%', 'important');
    table.style.setProperty('min-width', '0', 'important');
    for (const cell of table.querySelectorAll<HTMLElement>('th, td')) {
      // html2canvas inlines measured column widths; fixed layout otherwise keeps the wide table.
      cell.style.setProperty('width', 'auto', 'important');
      cell.style.setProperty('inline-size', 'auto', 'important');
      cell.style.setProperty('white-space', 'normal', 'important');
      cell.style.setProperty('overflow-wrap', 'anywhere', 'important');
    }
  }
  for (const element of containers) {
    const minimumHeight = view.getComputedStyle(element).height;
    element.scrollTop = 0;
    element.scrollLeft = 0;
    element.style.setProperty('height', 'auto', 'important');
    element.style.setProperty('min-height', minimumHeight, 'important');
    element.style.setProperty('max-height', 'none', 'important');
    element.style.setProperty('overflow-y', 'visible', 'important');
    element.style.setProperty('overflow-x', 'visible', 'important');
    element.style.setProperty('flex-shrink', '0', 'important');
  }
  // Force layout to settle on the final (wrapped-text/grown-height) geometry now - html2canvas
  // reads positions right after this returns, and without this the browser can still be on the
  // stale pre-wrap layout, painting the value text at its old (now overlapping) position.
  void widget.offsetHeight;
}

/** html2canvas misplaces transformed virtual rows and cannot paint AG Grid's CSS-mask icons. */
export function prepareDashboardTableClone(document: Document, widget: HTMLElement): void {
  const view = document.defaultView;
  if (!view) throw new Error('Dashboard table export window is unavailable.');
  // html2canvas renames custom-element hosts, so select AG Grid's retained classes.
  for (const row of widget.querySelectorAll<HTMLElement>('.ag-root-wrapper .ag-row')) {
    const style = view.getComputedStyle(row);
    if (style.transform !== 'none') {
      const matrix = new view.DOMMatrix(style.transform);
      row.style.setProperty('top', `${(parseFloat(style.top) || 0) + matrix.m42}px`, 'important');
      row.style.setProperty('left', `${(parseFloat(style.left) || 0) + matrix.m41}px`, 'important');
      row.style.setProperty('transform', 'none', 'important');
      row.style.setProperty('transition', 'none', 'important');
    }
  }
  const icons = widget.querySelectorAll<HTMLElement>('.ag-root-wrapper .ag-icon');
  if (!icons.length) return;
  const overrides = document.createElement('style');
  overrides.textContent = '[data-dashboard-export-icon]::before { content: none !important; }';
  document.head.append(overrides);
  for (const icon of icons) {
    const pseudo = view.getComputedStyle(icon, '::before');
    const mask = pseudo.maskImage || pseudo.getPropertyValue('-webkit-mask-image');
    const url = /^url\(["']?(data:image\/svg\+xml[^"']+)["']?\)$/.exec(mask);
    if (!url) continue;
    const comma = url[1].indexOf(',');
    const data = url[1].slice(comma + 1);
    const svg = url[1].slice(0, comma).endsWith(';base64') ? view.atob(data) : decodeURIComponent(data);
    const svgDocument = new view.DOMParser().parseFromString(svg, 'image/svg+xml');
    if (svgDocument.querySelector('parsererror')) throw new Error('Dashboard table export icon is invalid.');
    svgDocument.documentElement.setAttribute('width', pseudo.width);
    svgDocument.documentElement.setAttribute('height', pseudo.height);
    const color = pseudo.backgroundColor;
    // Mask SVGs use black for opaque strokes/fills; paint those in the resolved mask colour.
    for (const element of [svgDocument.documentElement, ...Array.from(svgDocument.querySelectorAll('*'))]) {
      for (const attribute of ['stroke', 'fill']) {
        const value = element.getAttribute(attribute);
        if (value && value !== 'none' && value !== 'transparent') element.setAttribute(attribute, color);
      }
    }
    const image = document.createElement('img');
    image.src = `data:image/svg+xml,${encodeURIComponent(new view.XMLSerializer().serializeToString(svgDocument))}`;
    image.style.cssText = `display:block;width:${pseudo.width};height:${pseudo.height};`;
    icon.setAttribute('data-dashboard-export-icon', '');
    icon.replaceChildren(image);
  }
}

const PAINTED_COLOUR_PROPERTIES = [
  'color', 'background-color', 'background-image', 'border-top-color', 'border-right-color', 'border-bottom-color',
  'border-left-color', 'outline-color', 'text-decoration-color', 'box-shadow', 'text-shadow', 'fill', 'stroke',
  'stop-color', 'column-rule-color', 'caret-color', '-webkit-text-stroke-color', '-webkit-text-fill-color',
];

export function prepareDashboardWidgetClone(
  document: Document,
  widget: HTMLElement,
  width: string,
  height: string,
  staticTable?: HTMLTableElement | null,
): void {
  // Fix the clone, not the live card: grid tracks and scrollbars must not resize the capture.
  widget.style.setProperty('position', 'fixed', 'important');
  widget.style.setProperty('left', '0', 'important');
  widget.style.setProperty('top', '0', 'important');
  widget.style.setProperty('margin', '0', 'important');
  for (const property of ['width', 'min-width', 'max-width']) widget.style.setProperty(property, width, 'important');
  for (const property of ['height', 'min-height', 'max-height']) widget.style.setProperty(property, height, 'important');
  const elements: Element[] = [widget, ...Array.from(widget.querySelectorAll('*'))];
  let ancestor = widget.parentElement;
  while (ancestor) {
    ancestor.style.setProperty('overflow', 'visible', 'important');
    elements.push(ancestor);
    ancestor = ancestor.parentElement;
  }
  const gridHost = widget.querySelector<HTMLElement>('app-chart-table, .ops-dashboard__table-grid > html2canvascustomelement');
  if (gridHost && staticTable) {
    gridHost.style.setProperty('display', 'none', 'important');
    const table = document.importNode(staticTable, true);
    gridHost.insertAdjacentElement('afterend', table);
    elements.push(table, ...Array.from(table.querySelectorAll('*')));
  } else {
    prepareDashboardTableClone(document, widget);
    elements.push(...Array.from(widget.querySelectorAll('[data-dashboard-export-icon] img')));
  }

  // html2canvas cannot parse modern CSS colour functions (including SVG/text-stroke colours).
  const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!context || !document.defaultView) throw new Error('Dashboard export colour conversion is unavailable.');
  // html2canvas adopts cloned nodes into an iframe; their prototypes can belong to the source window.
  for (const element of elements.filter((element): element is HTMLElement | SVGElement => 'style' in element)) {
    const computed = document.defaultView.getComputedStyle(element);
    // Only the colours html2canvas paints: enumerating every computed property (AG Grid adds hundreds
    // of CSS variables) took ~0.7 s per table widget.
    for (const property of PAINTED_COLOUR_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      const normalized = value.replace(/(?:color|oklab|oklch|lab|lch)\([^()]*\)/g, color => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
        return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
      });
      if (normalized !== value) element.style.setProperty(property, normalized, 'important');
    }
  }
}

/**
 * html2canvas `ignoreElements`: copy only the widget, its ancestors and the page styles. By default it
 * copies the whole page for every widget (~2 s each); the widget is pinned to a fixed box in the copy,
 * so dropping the rest changes nothing in the image.
 */
export function onlyDashboardWidget(widget: HTMLElement): (element: Element) => boolean {
  return element => !!(widget.contains(element) && element.closest('.ops-dashboard__card-controls, .wv-period-tabs'))
    || !(element.contains(widget) || widget.contains(element)
      || element.closest('head') || element.tagName === 'STYLE' || element.tagName === 'LINK');
}

/** Retain the displayed appearance; optionally reveal inner scroll content for downloads only. */
export function captureVisibleDashboardWidget(
  widget: HTMLElement,
  staticTable?: HTMLTableElement | null,
  includeScrollableContent = false,
  /** Extra changes made to html2canvas's copy only, never the live widget. */
  prepareClone?: (clone: HTMLElement) => void,
): Promise<HTMLCanvasElement> {
  const rect = widget.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return Promise.reject(new Error('Dashboard widget has no visible size.'));
  const layoutWidth = widget.offsetWidth;
  const layoutHeight = widget.offsetHeight;
  if (layoutWidth <= 0 || layoutHeight <= 0) return Promise.reject(new Error('Dashboard widget has no layout size.'));
  // DOM bounds include app zoom; canvas font sizes do not. Remove zoom in the clone and apply
  // the displayed scale to the completed capture, keeping text, SVG charts and boxes consistent.
  const captureScale = 2 * rect.width / layoutWidth;
  // Keep the dashboard slot's width: widening for long table headers squeezes the entire card
  // when composited back into that slot. expandDashboardChartScrollAreas wraps the table instead.
  const captureWidth = layoutWidth;
  return html2canvas(widget, {
    scale: captureScale,
    useCORS: true,
    backgroundColor: '#ffffff',
    x: 0,
    y: 0,
    width: captureWidth,
    height: includeScrollableContent ? undefined : layoutHeight,
    scrollX: 0,
    scrollY: 0,
    windowWidth: document.documentElement.clientWidth,
    windowHeight: document.documentElement.clientHeight,
    ignoreElements: onlyDashboardWidget(widget),
    onclone: async (document, clone) => {
      prepareClone?.(clone);
      prepareIndividualChartExportClone(clone, captureWidth);
      await loadCloneFonts(document, clone);
      prepareDashboardWidgetClone(document, clone, `${captureWidth}px`, `${layoutHeight}px`, staticTable);
      if (includeScrollableContent) expandDashboardChartScrollAreas(clone);
      return loadCloneFonts(document, clone);
    },
  });
}
