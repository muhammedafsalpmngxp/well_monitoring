import type Highcharts from 'highcharts';
import { CHART_COLORS } from '../../core/constants/chart-view.constants';

/**
 * How an object looks, as Power BI's Format pane sets it. General settings apply to every object (title, effects,
 * padding); visual settings apply to the type that reads them (legend and axes to charts, value size to cards,
 * header and stripes to tables, fit and link to images, html to text). Every field is optional: unset is the default.
 */
export interface ItemStyle {
  // General: title
  showTitle?: boolean;
  subtitle?: string;
  titleSize?: number;
  titleColor?: string;
  titleAlign?: 'left' | 'center' | 'right';
  titleBold?: boolean;
  // General: effects
  background?: string;
  backgroundOpacity?: number;
  border?: boolean;
  borderColor?: string;
  borderWidth?: number;
  radius?: number;
  shadow?: boolean;
  padding?: number;
  // Visual: charts
  legend?: boolean;
  legendPosition?: 'top' | 'bottom' | 'left' | 'right';
  legendSize?: number;
  legendColor?: string;
  xTitle?: string;
  yTitle?: string;
  /** Axis labels shown unless false; x labels turned by 0, -45 or -90 degrees (unset: Highcharts decides). */
  xLabels?: boolean;
  yLabels?: boolean;
  xRotation?: number;
  // Visual: data labels (shown when the object's dataLabels is on; pies show theirs always)
  labelPosition?: 'inside' | 'outside';
  labelSize?: number;
  labelColor?: string;
  gridlines?: boolean;
  yMin?: number | null;
  yMax?: number | null;
  axisFontSize?: number;
  axisColor?: string;
  palette?: string[];
  smooth?: boolean;
  markers?: boolean;
  // Visual: cards
  valueSize?: number;
  valueColor?: string;
  showIcon?: boolean;
  // Visual: tables and matrices. Density sets row and header heights (compact unless set); the totals row can carry
  // its own label and colours, and a matrix can leave out its subtotals.
  density?: 'compact' | 'normal' | 'comfortable';
  totalsLabel?: string;
  totalsBackground?: string;
  totalsColor?: string;
  subtotals?: boolean;
  /** Value columns drawn with a bar in each cell, and value columns shaded from light to dark by their value. */
  dataBars?: string[];
  heatmap?: string[];
  barColor?: string;
  heatColor?: string;
  fontSize?: number;
  headerBackground?: string;
  headerColor?: string;
  striped?: boolean;
  // Visual: text and images
  html?: string;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  /** Text boxes: the text shrinks until it fits the box, so it never needs a scrollbar. */
  fitText?: boolean;
  fit?: 'contain' | 'cover' | 'fill' | 'none';
  link?: string;
}

export type ThemeId = 'tasnim' | 'ocean' | 'sunset' | 'forest' | 'royal' | 'mono';

/** Page settings of one sheet, as Power BI's Canvas background, Wallpaper and Theme set them. */
export interface PageStyle {
  background?: string;
  backgroundImage?: string;
  backgroundFit?: 'cover' | 'contain' | 'tile';
  backgroundOpacity?: number;
  wallpaper?: string;
  theme?: ThemeId;
  spacing?: number;
  showGrid?: boolean;
}

/** Colour sets for charts; a sheet picks one, and an object may set its own. */
export const THEMES: Record<ThemeId, { label: string; colors: string[] }> = {
  tasnim: { label: 'Al Tasnim', colors: CHART_COLORS },
  ocean: { label: 'Ocean', colors: ['#0B6E99', '#12A4B6', '#57C4E5', '#1D3557', '#8ECAE6', '#219EBC', '#023047', '#6FB7C8'] },
  sunset: { label: 'Sunset', colors: ['#F94144', '#F3722C', '#F8961E', '#F9C74F', '#E76F51', '#9C2A4F', '#FF9F80', '#C1121F'] },
  forest: { label: 'Forest', colors: ['#2D6A4F', '#40916C', '#74C69D', '#95D5B2', '#1B4332', '#B7E4C7', '#52B788', '#081C15'] },
  royal: { label: 'Royal', colors: ['#3A0CA3', '#7209B7', '#4361EE', '#F72585', '#4CC9F0', '#560BAD', '#B5179E', '#480CA8'] },
  mono: { label: 'Slate', colors: ['#1F2937', '#374151', '#4B5563', '#6B7280', '#9CA3AF', '#D1D5DB', '#111827', '#E5E7EB'] },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

/**
 * The canvas brand kit (item 10): chart colours, a font and a logo for the whole canvas. A sheet theme chosen on a
 * sheet and an object's own colours still win over the brand colours.
 */
export interface BrandKit {
  colors?: string[];
  font?: string;
  logo?: string;
  /** Text sizes for every object of the canvas: titles, subtitles and text boxes; an object's own size still wins. */
  titleSize?: number;
  subtitleSize?: number;
  bodySize?: number;
  /** The saved kit this canvas copied its kit from, to offer updating it. */
  kitId?: number;
  kitName?: string;
}

/** Fonts every browser here has; a free text font name is not allowed, since it would go into CSS. */
export const BRAND_FONTS = ['Arial', 'Segoe UI', 'Calibri', 'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Times New Roman', 'Courier New'];

export type PageSizeId = '16:9' | '4:3' | 'a4' | 'letter' | 'custom';

/** A fixed page size for every sheet (item 18), in CSS pixels; no size means the sheet fits the screen. */
export interface PageSize { preset: PageSizeId; width: number; height: number; }

export const PAGE_SIZES: Record<Exclude<PageSizeId, 'custom'>, { label: string; width: number; height: number }> = {
  '16:9': { label: '16:9 slide (1280 x 720)', width: 1280, height: 720 },
  '4:3': { label: '4:3 slide (1024 x 768)', width: 1024, height: 768 },
  a4: { label: 'A4 landscape (1123 x 794)', width: 1123, height: 794 },
  letter: { label: 'Letter landscape (1056 x 816)', width: 1056, height: 816 },
};

export function readBrandKit(raw: unknown): BrandKit | null {
  const kept = keep(raw, {
    colors: value => Array.isArray(value) && value.length > 0 && value.length <= 12 && value.every(color),
    font: oneOf(BRAND_FONTS),
    logo: value => typeof value === 'string' && isImageSource(value),
    titleSize: range(10, 32), subtitleSize: range(9, 20), bodySize: range(10, 24),
    kitId: value => Number.isInteger(value) && (value as number) > 0, kitName: text(80),
  }) as BrandKit | undefined;
  return kept ?? null;
}

export function readPageSize(raw: unknown): PageSize | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const size = raw as PageSize;
  const ok = ['16:9', '4:3', 'a4', 'letter', 'custom'].includes(size.preset)
    && [size.width, size.height].every(value => Number.isInteger(value) && value >= 320 && value <= 4000);
  return ok ? { preset: size.preset, width: size.width, height: size.height } : null;
}

const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8}|transparent)$/i;
const ALIGNS = ['left', 'center', 'right'];
const POSITIONS = ['top', 'bottom', 'left', 'right'];
const FITS = ['contain', 'cover', 'fill', 'none'];
const VERTICAL = ['top', 'middle', 'bottom'];
export const RICH_TEXT_MAX = 8000;
export const IMAGE_DATA_MAX = 400_000;

type Check = (value: unknown) => boolean;
const text = (max: number): Check => value => typeof value === 'string' && value.length <= max;
const bool: Check = value => typeof value === 'boolean';
const color: Check = value => typeof value === 'string' && COLOR.test(value);
const names: Check = value => Array.isArray(value) && value.length <= 20 && value.every(name => typeof name === 'string' && name.length <= 200);
const range = (low: number, high: number): Check => value => typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high;
const oneOf = (options: string[]): Check => value => typeof value === 'string' && options.includes(value);
const numberOrNull: Check = value => value === null || (typeof value === 'number' && Number.isFinite(value));

const ITEM_CHECKS: Record<keyof ItemStyle, Check> = {
  showTitle: bool, subtitle: text(160), titleSize: range(10, 40), titleColor: color, titleAlign: oneOf(ALIGNS), titleBold: bool,
  background: color, backgroundOpacity: range(0, 100), border: bool, borderColor: color, borderWidth: range(0, 8), radius: range(0, 32),
  shadow: bool, padding: range(0, 40),
  legend: bool, legendPosition: oneOf(POSITIONS), legendSize: range(8, 20), legendColor: color,
  xTitle: text(80), yTitle: text(80), gridlines: bool, yMin: numberOrNull, yMax: numberOrNull,
  xLabels: bool, yLabels: bool, xRotation: value => value === 0 || value === -45 || value === -90,
  labelPosition: oneOf(['inside', 'outside']), labelSize: range(8, 20), labelColor: color,
  axisFontSize: range(8, 20), axisColor: color,
  palette: value => Array.isArray(value) && value.length <= 12 && value.every(color), smooth: bool, markers: bool,
  valueSize: range(14, 72), valueColor: color, showIcon: bool,
  fontSize: range(10, 20), headerBackground: color, headerColor: color, striped: bool,
  density: oneOf(['compact', 'normal', 'comfortable']), totalsLabel: text(40), totalsBackground: color, totalsColor: color, subtotals: bool,
  dataBars: names, heatmap: names, barColor: color, heatColor: color,
  html: text(RICH_TEXT_MAX), verticalAlign: oneOf(VERTICAL), fitText: bool, fit: oneOf(FITS), link: value => typeof value === 'string' && (value === '' || isSafeLink(value)),
};

const PAGE_CHECKS: Record<keyof PageStyle, Check> = {
  background: color, backgroundImage: value => typeof value === 'string' && (value === '' || isImageSource(value)),
  backgroundFit: oneOf(['cover', 'contain', 'tile']), backgroundOpacity: range(0, 100), wallpaper: color,
  theme: oneOf(THEME_IDS), spacing: range(2, 24), showGrid: bool,
};

/**
 * The style as stored, keeping only the settings whose shape is right; null when none is left. A saved canvas is
 * written by any author, so nothing is trusted: rich text is sanitized again as it is read.
 */
export function readItemStyle(raw: unknown): ItemStyle | undefined {
  const kept = keep(raw, ITEM_CHECKS) as ItemStyle | undefined;
  if (kept?.html !== undefined) kept.html = sanitizeRichText(kept.html);
  return kept;
}

export function readPageStyle(raw: unknown): PageStyle | undefined {
  return keep(raw, PAGE_CHECKS) as PageStyle | undefined;
}

function keep<T extends object>(raw: unknown, checks: Record<string, Check>): T | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw).filter(([key, value]) => key in checks && value !== undefined && checks[key](value));
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

/** An https address, a path on this site, or a small image embedded as data (png, jpeg, gif, webp). */
export function isImageSource(value: string): boolean {
  const url = value.trim();
  if (/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(url)) return url.length <= IMAGE_DATA_MAX;
  if (/^\/(?![/\\])/.test(url)) return true;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** A link an image or a text may open: https, mailto, or a path on this site. */
export function isSafeLink(value: string): boolean {
  const url = value.trim();
  if (/^\/(?![/\\])/.test(url)) return true;
  try {
    return ['https:', 'mailto:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

const RICH_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI', 'A', 'FONT', 'H1', 'H2', 'H3', 'BLOCKQUOTE']);
const RICH_STYLES: Record<string, RegExp> = {
  'color': /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i,
  'background-color': /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent|[a-z]+)$/i,
  'font-size': /^\d{1,2}(\.\d+)?(px|pt|em|rem|%)$|^(x-small|small|medium|large|x-large|xx-large)$/i,
  'font-weight': /^(bold|normal|[1-9]00)$/i,
  'font-style': /^(italic|normal)$/i,
  'text-decoration': /^(underline|line-through|none)( (underline|line-through))?$/i,
  'text-decoration-line': /^(underline|line-through|none)$/i,
  'text-align': /^(left|center|right|justify)$/i,
};

/**
 * Rich text as the text object stores it: only simple formatting tags, links that are https or mailto (opened in a
 * new tab), and a few style properties with checked values. Everything else, scripts and event handlers included,
 * is dropped. The result is safe to show with innerHTML.
 */
export function sanitizeRichText(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html.slice(0, RICH_TEXT_MAX)}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return '';
  clean(root);
  return root.innerHTML;
}

function clean(element: Element): void {
  for (const child of [...element.children]) {
    if (!RICH_TAGS.has(child.tagName)) {
      // Unknown tags go, but their text stays; scripts and styles go with their content.
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'MATH'].includes(child.tagName)) child.remove();
      else child.replaceWith(...child.childNodes);
      continue;
    }
    for (const attribute of [...child.attributes]) {
      const name = attribute.name.toLowerCase();
      const keepIt = (name === 'href' && child.tagName === 'A' && isSafeLink(attribute.value))
        || (name === 'color' && child.tagName === 'FONT' && COLOR.test(attribute.value))
        || (name === 'size' && child.tagName === 'FONT' && /^[1-7]$/.test(attribute.value))
        || name === 'style';
      if (!keepIt) child.removeAttribute(attribute.name);
    }
    const style = child.getAttribute('style');
    if (style !== null) {
      const safe = style.split(';').map(part => part.split(':').map(bit => bit.trim()))
        .filter(([property, value]) => property && value && RICH_STYLES[property.toLowerCase()]?.test(value))
        .map(([property, value]) => `${property.toLowerCase()}: ${value}`).join('; ');
      if (safe) child.setAttribute('style', safe);
      else child.removeAttribute('style');
    }
    if (child.tagName === 'A') {
      child.setAttribute('target', '_blank');
      child.setAttribute('rel', 'noopener noreferrer');
    }
    clean(child);
  }
}

/**
 * The largest font size, in half pixels from min up to max, at which the text fits its box; min when none does.
 * fits sets the size on the box and says whether the content then fits.
 */
export function fitFontSize(fits: (size: number) => boolean, max: number, min = 6): number {
  if (fits(max)) return max;
  let low = min;
  let high = max;
  while (high - low > 0.5) {
    const middle = Math.round(((low + high) / 2) * 2) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  fits(low);
  return low;
}

/** The plain text of rich text, for a problem check and for screen readers. */
export function richTextPlain(html: string | undefined): string {
  if (!html) return '';
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() ?? '';
}

/** A colour with an opacity from 0 to 100, as CSS. */
export function withOpacity(hex: string | undefined, opacity: number | undefined): string | undefined {
  if (!hex || hex === 'transparent') return hex;
  if (opacity === undefined || opacity >= 100) return hex;
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join('')}` : hex.slice(0, 7);
  const alpha = Math.round((Math.max(0, opacity) / 100) * 255).toString(16).padStart(2, '0');
  return `${full}${alpha}`;
}

/** The CSS of an object's frame on the sheet: background, border, corners, shadow and padding. */
export function frameCss(style: ItemStyle | undefined): Record<string, string> {
  if (!style) return {};
  const css: Record<string, string> = {};
  if (style.background) css['background'] = withOpacity(style.background, style.backgroundOpacity) ?? '';
  if (style.border === false) css['border-color'] = 'transparent';
  else if (style.border) {
    css['border-color'] = style.borderColor ?? 'var(--color-border)';
    css['border-width'] = `${style.borderWidth ?? 1}px`;
    css['border-style'] = 'solid';
  }
  if (style.radius !== undefined) css['border-radius'] = `${style.radius}px`;
  if (style.shadow === false) css['box-shadow'] = 'none';
  if (style.shadow) css['box-shadow'] = '0 10px 28px rgba(15, 23, 42, 0.16)';
  if (style.padding !== undefined) css['--canvas-object-padding'] = `${style.padding}px`;
  return css;
}

/** The CSS of an object's title. */
export function titleCss(style: ItemStyle | undefined): Record<string, string> {
  if (!style) return {};
  const css: Record<string, string> = {};
  if (style.titleSize) css['font-size'] = `${style.titleSize}px`;
  if (style.titleColor) css['color'] = style.titleColor;
  if (style.titleAlign) css['text-align'] = style.titleAlign;
  if (style.titleBold === false) css['font-weight'] = '400';
  if (style.titleBold) css['font-weight'] = '700';
  return css;
}

/** The CSS of a sheet: its background, image and wallpaper. */
export function pageCss(page: PageStyle | undefined): { stage: Record<string, string>; sheet: Record<string, string> } {
  const stage: Record<string, string> = {};
  const sheet: Record<string, string> = {};
  if (!page) return { stage, sheet };
  if (page.wallpaper) stage['background'] = page.wallpaper;
  if (page.showGrid === false && !page.wallpaper) stage['background'] = 'var(--color-bg-app)';
  const layers: string[] = [];
  if (page.backgroundImage) {
    const fit = page.backgroundFit ?? 'cover';
    layers.push(`url("${page.backgroundImage.replace(/"/g, '%22')}") center / ${fit === 'tile' ? 'auto' : fit} ${fit === 'tile' ? 'repeat' : 'no-repeat'}`);
  }
  if (page.background) layers.push(withOpacity(page.background, page.backgroundOpacity) ?? '');
  if (layers.length) sheet['background'] = layers.join(', ');
  return { stage, sheet };
}

/** The chart colours of an object: its own palette, the sheet theme's, the brand kit's, or Al Tasnim's. */
export function paletteFor(style: ItemStyle | undefined, theme: ThemeId | undefined, brand?: string[]): string[] {
  if (style?.palette?.length) return style.palette;
  if (theme) return THEMES[theme].colors;
  return brand?.length ? brand : THEMES.tasnim.colors;
}

/** The Format pane's chart settings laid over the options chartOptions built. */
export function styleChart(options: Highcharts.Options, style: ItemStyle | undefined): Highcharts.Options {
  if (!style) return options;
  const next: Highcharts.Options = { ...options };
  const axisLabel = { ...(style.axisFontSize ? { fontSize: `${style.axisFontSize}px` } : {}), ...(style.axisColor ? { color: style.axisColor } : {}) };
  if (style.legend !== undefined || style.legendPosition || style.legendSize || style.legendColor) {
    const position = style.legendPosition ?? 'bottom';
    const side = position === 'left' || position === 'right';
    const legend = options.legend as Highcharts.LegendOptions | undefined;
    next.legend = {
      ...legend,
      ...(style.legend !== undefined ? { enabled: style.legend } : {}),
      layout: side ? 'vertical' : 'horizontal',
      align: side ? position : 'center',
      verticalAlign: side ? 'middle' : position,
      itemStyle: {
        ...(legend?.itemStyle ?? {}),
        ...(style.legendSize ? { fontSize: `${style.legendSize}px` } : {}),
        ...(style.legendColor ? { color: style.legendColor } : {}),
      },
    };
  }
  // Data labels: position and text, laid over every plot option the chart set, so pies and funnels take them too.
  if (style.labelPosition || style.labelSize || style.labelColor) {
    const labelStyle = {
      ...(style.labelSize ? { fontSize: `${style.labelSize}px` } : {}),
      ...(style.labelColor ? { color: style.labelColor } : {}),
    };
    const plot = { ...(options.plotOptions ?? {}) } as Record<string, { dataLabels?: Highcharts.DataLabelsOptions } | undefined>;
    for (const key of new Set([...Object.keys(plot), 'series'])) {
      const current = plot[key]?.dataLabels ?? {};
      plot[key] = {
        ...plot[key],
        dataLabels: {
          ...current,
          ...(style.labelPosition ? (key === 'pie' ? { distance: style.labelPosition === 'inside' ? -30 : 20 } : { inside: style.labelPosition === 'inside' }) : {}),
          style: { ...(current.style ?? {}), ...labelStyle },
        },
      };
    }
    next.plotOptions = plot as Highcharts.PlotOptions;
  }
  const restyleAxis = (axis: Highcharts.XAxisOptions | Highcharts.YAxisOptions | undefined, title: string | undefined, isValue: boolean) => {
    if (!axis) return axis;
    const labels = { ...axis.labels, style: { ...(axis.labels?.style ?? {}), ...axisLabel } };
    const shown = isValue ? style.yLabels : style.xLabels;
    return {
      ...axis,
      labels: {
        ...labels,
        ...(shown === false ? { enabled: false } : {}),
        ...(!isValue && style.xRotation !== undefined ? { rotation: style.xRotation, autoRotation: undefined } : {}),
      },
      ...(title !== undefined ? { title: { text: title || undefined, style: axisLabel } } : {}),
      ...(isValue && style.gridlines !== undefined ? { gridLineWidth: style.gridlines ? 1 : 0 } : {}),
      ...(isValue && style.yMin !== undefined && style.yMin !== null ? { min: style.yMin } : {}),
      ...(isValue && style.yMax !== undefined && style.yMax !== null ? { max: style.yMax } : {}),
    };
  };
  if (options.xAxis && !Array.isArray(options.xAxis)) next.xAxis = restyleAxis(options.xAxis, style.xTitle, false) as Highcharts.XAxisOptions;
  if (options.yAxis) {
    next.yAxis = Array.isArray(options.yAxis)
      ? options.yAxis.map((axis, i) => restyleAxis(axis, i === 0 ? style.yTitle : undefined, i === 0) as Highcharts.YAxisOptions)
      : restyleAxis(options.yAxis, style.yTitle, true) as Highcharts.YAxisOptions;
  }
  if (style.smooth || style.markers !== undefined) {
    next.series = (options.series ?? []).map(series => {
      const type = (series as { type?: string }).type;
      const curved = style.smooth && (type === 'line' || type === 'area') ? { type: type === 'line' ? 'spline' : 'areaspline' } : {};
      const marker = style.markers !== undefined && (type === 'line' || type === 'area') ? { marker: { enabled: style.markers } } : {};
      return { ...series, ...curved, ...marker } as Highcharts.SeriesOptionsType;
    });
  }
  return next;
}
