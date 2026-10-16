import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import {
  CanvasItem, FormatRule, MAX_RULES, NumberStyle, RuleOp, RuleTone, SLICER_STYLES, SLICER_STYLE_LABELS, SlicerState, SlicerStyle,
  Interaction, SortOrder, TEXT_MAX_LENGTH, ValueFn, isDataItem, isForeign, itemProblem, slicerKindOf, slicerStyle, withDataset,
} from '../canvas-config.util';
import { FieldKind } from '../canvas-filter.util';
import { ruleProblem } from '../canvas-format.util';
import {
  BRAND_FONTS, BrandKit, IMAGE_DATA_MAX, ItemStyle, PAGE_SIZES, PageSize, PageSizeId, PageStyle, THEMES, THEME_IDS, ThemeId, sanitizeRichText,
} from '../canvas-style.util';
import {
  DataDrag, VALUE_FN_LABELS, VISUALS, Visual, VisualId, Well, WellId, applyVisual, canStack, dropOnWell, removeFromWell, setValueFn,
  valueFns, valueName, visualOf, wellsFor,
} from '../canvas-wells.util';

/**
 * The Visualizations pane (D-13): an icon per visual, then the selected object's title, field wells and
 * settings. With nothing selected an icon adds that visual to the sheet; with a chart, tile or table selected,
 * a chart, tile or table icon changes it. Every change emits a new object.
 */
@Component({
  selector: 'app-canvas-properties',
  standalone: false,
  templateUrl: './canvas-properties.component.html',
  styleUrls: ['./canvas-properties.component.scss'],
})
export class CanvasPropertiesComponent implements OnChanges {
  @Input() item: CanvasItem | null = null;
  /** The canvas dataset; an object on another one is offered a move (plan decision P8-2). */
  @Input() canvasDatasetId: number | null = null;
  @Input() datasetName = '';
  /** What is being dragged from the Data pane, set by the editor. */
  @Input() dragging: DataDrag | null = null;
  /** The open sheet's page settings, which the Format tab shows while no object is selected. */
  @Input() page: PageStyle | undefined;
  /** The kind of the selected slicer's field, which sets the styles it offers. */
  @Input() fieldKind: FieldKind = 'text';
  /** The names of the other sheets, which a slicer can sync to. */
  @Input() otherSheets: string[] = [];
  /** The canvas's names for fields and measures (Data pane Rename), shown in the wells as on the objects. */
  @Input() labels: Record<string, string> = {};
  @Output() add = new EventEmitter<Visual>();
  /** The canvas's own name and description, edited with the sheet's format and saved with the canvas. */
  @Input() canvasName = '';
  @Input() canvasDescription: string | null = null;
  @Output() detailsChange = new EventEmitter<{ name: string; description: string | null }>();
  @Output() pageChange = new EventEmitter<PageStyle>();
  @Output() collapse = new EventEmitter<void>();
  @Output() itemChange = new EventEmitter<CanvasItem>();
  @Output() remove = new EventEmitter<CanvasItem>();
  @Output() closed = new EventEmitter<void>();
  /** The canvas brand kit and page size, set with the page format and kept for every sheet. */
  @Input() brand: BrandKit | null = null;
  @Input() pageSize: PageSize | null = null;
  @Output() brandChange = new EventEmitter<BrandKit | null>();
  @Output() pageSizeChange = new EventEmitter<PageSize | null>();
  @Output() insertLogo = new EventEmitter<void>();
  /** Saved brand kits: apply one, save this canvas's kit as a new one or over the one it came from, delete one. */
  @Input() savedKits: { id: number; name: string }[] = [];
  @Input() kitMessage: { kind: 'success' | 'error'; text: string } | null = null;
  @Output() applyKit = new EventEmitter<number>();
  @Output() saveKit = new EventEmitter<{ name: string; update: boolean }>();
  @Output() deleteKit = new EventEmitter<number>();
  /** The name typed for a new saved kit, while the box is open. */
  newKitName: string | null = null;
  /** Floats a text or image over the sheet, or puts it back on the grid. */
  @Output() floatChange = new EventEmitter<boolean>();
  /** Opens the text object in the large text dialog. */
  @Output() editText = new EventEmitter<CanvasItem>();

  readonly visuals = VISUALS;
  readonly textMax = TEXT_MAX_LENGTH;
  readonly trackWell = (_: number, well: Well) => well.id;
  readonly numberStyles: { id: NumberStyle | ''; label: string }[] = [
    { id: '', label: 'Automatic' }, { id: 'number', label: 'Number' }, { id: 'compact', label: 'Short, as 12.5K' },
    { id: 'percent', label: 'Percent' }, { id: 'currency', label: 'Currency' },
  ];
  readonly currencies = ['OMR', 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'INR'];
  readonly ruleOps: { id: RuleOp; label: string }[] = [
    { id: 'gt', label: 'is more than' }, { id: 'gte', label: 'is at least' }, { id: 'lt', label: 'is less than' },
    { id: 'lte', label: 'is at most' }, { id: 'between', label: 'is between' }, { id: 'eq', label: 'is' }, { id: 'neq', label: 'is not' },
    { id: 'contains', label: 'contains' }, { id: 'blank', label: 'is blank' },
  ];
  readonly tones: { id: RuleTone; label: string }[] = [
    { id: 'good', label: 'Good (green)' }, { id: 'warn', label: 'Watch (amber)' }, { id: 'bad', label: 'Bad (red)' },
  ];
  readonly maxRules = MAX_RULES;
  readonly themes = THEME_IDS.map(id => ({ id, ...THEMES[id] }));
  readonly brandFonts = BRAND_FONTS;
  readonly pageSizes = Object.entries(PAGE_SIZES).map(([id, size]) => ({ id: id as PageSizeId, ...size }));

  /** A theme is on when the sheet chose it; Al Tasnim also when nothing is chosen and there is no brand kit. */
  themeOn(id: ThemeId): boolean {
    return this.page?.theme === id || (!this.page?.theme && !this.brand?.colors && id === 'tasnim');
  }

  /** The brand colours to edit: the kit's, or the Al Tasnim colours to start from. */
  get brandColors(): string[] { return this.brand?.colors ?? THEMES.tasnim.colors.slice(0, 8); }

  setBrand(patch: Partial<BrandKit>): void {
    const next: BrandKit = { ...(this.brand ?? {}), ...patch };
    (Object.keys(next) as (keyof BrandKit)[]).forEach(key => (next[key] === undefined || next[key] === '') && delete next[key]);
    this.brandChange.emit(Object.keys(next).length ? next : null);
  }

  /** A text size of the kit, kept within its range; blank goes back to the default. */
  setBrandSize(key: 'titleSize' | 'subtitleSize' | 'bodySize', text: string, low: number, high: number): void {
    const value = text.trim() === '' ? undefined : Math.min(high, Math.max(low, Math.round(Number(text))));
    this.setBrand({ [key]: value !== undefined && Number.isFinite(value) ? value : undefined });
  }

  setBrandColor(index: number, value: string): void {
    const colors = [...this.brandColors];
    colors[index] = value;
    this.setBrand({ colors });
  }

  /** A preset, a custom size (kept within 320 to 4000 pixels), or none: fit to the screen. */
  choosePageSize(id: string, width?: string, height?: string): void {
    if (!id) { this.pageSizeChange.emit(null); return; }
    if (id === 'custom') {
      const clamp = (text: string | undefined, fallback: number) => {
        const n = Math.round(Number(text));
        return Number.isFinite(n) && n > 0 ? Math.min(4000, Math.max(320, n)) : fallback;
      };
      this.pageSizeChange.emit({ preset: 'custom', width: clamp(width, this.pageSize?.width ?? 1280), height: clamp(height, this.pageSize?.height ?? 720) });
      return;
    }
    const preset = PAGE_SIZES[id as Exclude<PageSizeId, 'custom'>];
    if (preset) this.pageSizeChange.emit({ preset: id as PageSizeId, width: preset.width, height: preset.height });
  }

  /** Build: the visual and its fields. Format: how it looks, or the page when nothing is selected. */
  tab: 'build' | 'format' = 'build';
  imageProblem = '';

  /** The rule being written in the Format section. */
  draftRule: FormatRule = blankRule();
  ruleError = '';

  dropTarget: WellId | null = null;
  /** A well entry being dragged to another well. */
  private moving: { from: WellId; entry: string; drag: DataDrag; fn?: ValueFn } | null = null;
  dropProblem = '';

  get foreign(): boolean { return !!this.item && isForeign(this.item, this.canvasDatasetId); }
  /**
   * Whether the chart shows its legend: as set in the Format pane, else as the chart draws it by default, which is for
   * more than one series on charts with axes; pies, funnels, treemaps and point charts label their own parts.
   */
  get legendShown(): boolean {
    const item = this.item;
    if (!item || item.type !== 'chart') return false;
    if (item.style?.legend !== undefined) return item.style.legend;
    const own = ['pie', 'donut', 'treemap', 'funnel', 'scatter', 'bubble', 'bullet', 'waterfall'].includes(item.chartType ?? 'column');
    return !own && (!!item.series || item.measures.length > 1);
  }

  /** Charts with an axis to order. */
  get sortable(): boolean {
    return this.item?.type === 'chart' && !['scatter', 'bubble', 'pie', 'donut', 'treemap', 'funnel'].includes(this.item.chartType ?? 'column');
  }

  setSortOrder(order: SortOrder | ''): void {
    if (this.item) this.emit({ ...this.item, sortOrder: order || undefined });
  }

  /** A well entry as shown: a date hierarchy level reads "Task.action_on (Year)". */
  entryName(entry: string): string {
    if (this.labels[entry]) return this.labels[entry];
    const at = entry.lastIndexOf('@');
    return at > 0 ? `${entry.slice(0, at)} (${entry.charAt(at + 1).toUpperCase()}${entry.slice(at + 2)})` : entry;
  }

  /** Charts, cards, tables and matrices answer clicks on other visuals; slicers only filter. */
  get takesInteraction(): boolean { return !!this.item && isDataItem(this.item.type) && this.item.type !== 'slicer' && !this.foreign; }

  setInteraction(interaction: Interaction): void {
    if (this.item) this.emit({ ...this.item, interaction: interaction === 'filter' ? undefined : interaction });
  }
  get wells(): Well[] { return this.item && !this.foreign ? wellsFor(this.item) : []; }
  get problem(): string { return this.item ? itemProblem(this.item) : ''; }
  get active(): VisualId | null { return this.item ? visualOf(this.item) : null; }
  get hint(): string {
    return this.item && isDataItem(this.item.type) && !this.foreign
      ? 'A chart, tile or table icon changes the selected object. Text and image are added as new objects.'
      : 'Choose a visual to add it to the sheet.';
  }

  private get chartType(): string | null { return this.item?.type === 'chart' ? this.item.chartType ?? 'column' : null; }
  get canStack(): boolean { return !!this.item && canStack(this.item); }
  /** Pies, donuts, treemaps and funnels have no axes. */
  get hasAxes(): boolean { return this.item?.type === 'chart' && !['pie', 'donut', 'treemap', 'funnel'].includes(this.item.chartType ?? 'column'); }
  get hasDataLabels(): boolean {
    const type = this.chartType;
    return !!type && ['column', 'bar', 'line', 'area', 'combo', 'waterfall'].includes(type);
  }
  /** Objects that show numbers take a number format (P10-8). */
  get formats(): boolean { return !!this.item && ['chart', 'tile', 'table', 'matrix'].includes(this.item.type) && !this.foreign; }
  /** A rule can colour any field or measure the object shows. */
  get ruleFields(): string[] { return this.item ? [...this.item.dimensions, ...this.item.measures] : []; }

  ngOnChanges(changes: SimpleChanges): void {
    const item = changes['item'];
    if (item && item.previousValue?.id !== item.currentValue?.id) {
      this.dropProblem = '';
      this.draftRule = blankRule();
      this.ruleError = '';
    }
  }

  chooseVisual(visual: Visual): void {
    this.dropProblem = '';
    if (this.item && isDataItem(this.item.type) && isDataItem(visual.type) && !this.foreign) {
      this.emit(applyVisual(this.item, visual));
    } else {
      this.add.emit(visual);
    }
  }

  /**
   * An entry dragged out of a well to move it to another, as in Power BI: x to Legend, Legend to x and so on. A field
   * added up in a value well moves as its field, and keeps how it is added up when it lands in another value well.
   */
  startMove(event: DragEvent, well: Well, entry: string): void {
    const value = this.item?.aggregates?.[entry];
    const drag: DataDrag = value
      ? { kind: 'field', name: value.field, fieldKind: value.kind }
      : { kind: well.accepts, name: entry };
    this.moving = { from: well.id, entry, drag, fn: value?.fn };
    // Firefox only starts a drag when some data is set.
    event.dataTransfer?.setData('text/plain', entry);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  /** A move dropped outside the wells changes nothing. */
  endMove(): void {
    this.moving = null;
    this.dropTarget = null;
  }

  /** Every well accepts the drop, so a wrong kind is explained instead of silently refused. */
  onDragOver(event: DragEvent, well: Well): void {
    if (!this.dragging && !this.moving) return;
    event.preventDefault();
    this.dropTarget = well.id;
  }

  onDrop(event: DragEvent, well: Well): void {
    event.preventDefault();
    this.dropTarget = null;
    const moving = this.moving;
    this.moving = null;
    const drag = this.dragging ?? moving?.drag;
    if (!this.item || !drag || moving?.from === well.id) return;
    const from = moving ? removeFromWell(this.item, moving.from, moving.entry) : this.item;
    const result = dropOnWell(from, well.id, drag);
    if ('problem' in result) {
      this.dropProblem = result.problem;
      return;
    }
    this.dropProblem = '';
    let next = result.item;
    // A moved Sum of hours stays a Sum, where the well would otherwise pick its own way of adding it up.
    const landed = moving?.fn && drag.kind === 'field' ? next.aggregates?.[valueName({ field: drag.name, fn: drag.fieldKind === 'number' ? 'sum' : 'count', kind: drag.fieldKind ?? 'text' })] : undefined;
    if (landed && moving?.fn) next = setValueFn(next, valueName(landed), moving.fn);
    // Moving onto a one-entry well that holds something swaps the two, as in Power BI.
    const displaced = moving && well.single ? well.entries.find(entry => entry !== moving.entry) : undefined;
    if (displaced && moving) {
      const back = dropOnWell(next, moving.from, { kind: well.accepts, name: displaced });
      if (!('problem' in back)) next = back.item;
    }
    this.emit(next);
  }

  readonly valueFnLabels = VALUE_FN_LABELS;

  /** The ways a field value in a well can be added up, or none for a measure or a field in a field well. */
  valueFnsOf(entry: string): ValueFn[] {
    const aggregate = this.item?.aggregates?.[entry];
    return aggregate ? valueFns(aggregate.kind) : [];
  }

  changeValueFn(entry: string, fn: ValueFn): void {
    if (this.item) this.emit(setValueFn(this.item, entry, fn));
  }

  /** A value well also takes fields, which it adds up. */
  takes(well: Well): boolean {
    const drag = this.dragging ?? this.moving?.drag;
    return !!drag && (drag.kind === well.accepts || (well.accepts === 'measure' && drag.kind === 'field'));
  }

  removeEntry(well: Well, name: string): void {
    if (this.item) this.emit(removeFromWell(this.item, well.id, name));
  }

  moveToCanvasDataset(): void {
    if (this.item) this.emit(withDataset(this.item, this.canvasDatasetId));
  }

  setTitle(title: string): void { this.change({ title }); }

  /** A Format pane setting of the object; an empty value goes back to the default. */
  /** Turns data bars or heatmap shading on or off for one value column. */
  toggleCue(key: 'dataBars' | 'heatmap', name: string): void {
    const now = this.item?.style?.[key] ?? [];
    const next = now.includes(name) ? now.filter(entry => entry !== name) : [...now, name];
    this.setStyle({ [key]: next.length ? next : undefined });
  }

  setStyle(patch: Partial<ItemStyle>): void {
    if (!this.item) return;
    const style: Record<string, unknown> = { ...(this.item.style ?? {}), ...patch };
    for (const [key, value] of Object.entries(style)) if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) delete style[key];
    this.change({ style: Object.keys(style).length ? style as ItemStyle : undefined });
  }

  /** A number setting from its input: empty clears it, anything else is kept inside its limits. */
  setStyleNumber(key: keyof ItemStyle, text: string, low: number, high: number): void {
    const value = text.trim() === '' ? undefined : Math.min(high, Math.max(low, Number(text)));
    this.setStyle({ [key]: value !== undefined && Number.isFinite(value) ? value : undefined } as Partial<ItemStyle>);
  }

  /** The chart colours: the object's own, or none to follow the sheet theme. */
  setPaletteColor(index: number, color: string): void {
    const palette = [...(this.item?.style?.palette ?? THEMES[this.page?.theme ?? 'tasnim'].colors.slice(0, 8))];
    palette[index] = color;
    this.setStyle({ palette });
  }

  get palette(): string[] {
    return this.item?.style?.palette ?? THEMES[this.page?.theme ?? 'tasnim'].colors.slice(0, 8);
  }

  setRichText(html: string): void {
    this.setStyle({ html: sanitizeRichText(html) });
  }

  /** An uploaded image is kept in the canvas, so it is limited to about 300 KB of png, jpeg, gif or webp. */
  uploadImage(event: Event, target: 'item' | 'page' | 'logo'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    this.imageProblem = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      this.imageProblem = 'Choose a png, jpeg, gif or webp image.';
      return;
    }
    if (file.size > (IMAGE_DATA_MAX * 3) / 4 - 1024) {
      this.imageProblem = 'The image is larger than 300 KB. Use a smaller one, or an https address.';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result);
      if (target === 'item') this.setImage(data);
      else if (target === 'logo') this.setBrand({ logo: data });
      else this.setPage({ backgroundImage: data });
    };
    reader.readAsDataURL(file);
  }

  /** A page setting of the open sheet; an empty value goes back to the default. */
  setPage(patch: Partial<PageStyle>): void {
    const page: Record<string, unknown> = { ...(this.page ?? {}), ...patch };
    for (const [key, value] of Object.entries(page)) if (value === undefined || value === '') delete page[key];
    this.page = page as PageStyle;
    this.pageChange.emit(page as PageStyle);
  }

  setTheme(theme: string): void {
    this.setPage({ theme: THEME_IDS.includes(theme as ThemeId) ? theme as ThemeId : undefined });
  }
  setText(text: string): void { this.change({ text }); }
  setImage(imageUrl: string): void { this.change({ imageUrl }); }
  setAlt(alt: string): void { this.change({ alt }); }

  /** An empty style is Automatic. Decimals and currency keep their current values when not given. */
  setFormat(style: string, decimals?: string, currency?: string): void {
    if (!style) {
      this.change({ format: undefined });
      return;
    }
    const current = this.item?.format;
    const places = decimals === undefined ? current?.decimals ?? 0 : Math.min(6, Math.max(0, Math.trunc(Number(decimals) || 0)));
    const code = currency || current?.currency || 'OMR';
    this.change({ format: { style: style as NumberStyle, decimals: places, ...(style === 'currency' ? { currency: code } : {}) } });
  }

  setStacking(value: string): void { this.change({ stacking: value === 'normal' || value === 'percent' ? value : null }); }
  setDataLabels(on: boolean): void { this.change({ dataLabels: on }); }

  setTargetValue(text: string): void {
    const value = Number(text);
    this.change({ targetValue: text.trim() && Number.isFinite(value) ? value : null });
  }

  setWarnAt(text: string): void {
    const value = Math.trunc(Number(text));
    this.change({ warnAt: Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 90 });
  }

  setLowerIsBetter(on: boolean): void { this.change({ lowerIsBetter: on }); }
  setTotals(on: boolean): void { this.change({ totals: on }); }

  readonly slicerStyleLabels = SLICER_STYLE_LABELS;

  get slicerStyles(): SlicerStyle[] {
    const styles = SLICER_STYLES[this.fieldKind];
    const current = slicerStyle(this.item?.slicer);
    return styles.includes(current) ? styles : [current, ...styles];
  }

  get slicerStyle(): SlicerStyle { return slicerStyle(this.item?.slicer); }
  get listSlicer(): boolean { return slicerKindOf(this.slicerStyle) === 'list'; }

  /** How the slicer syncs: this sheet only, every sheet, or chosen sheets. */
  get syncMode(): 'sheet' | 'all' | 'chosen' {
    const sync = this.item?.slicer?.sync;
    return sync === 'all' ? 'all' : Array.isArray(sync) ? 'chosen' : 'sheet';
  }

  /** Another style keeps the choice when it keeps the same kind of choice, as list and tiles do; else it starts empty. */
  setSlicerStyle(style: string): void {
    const next = style as SlicerStyle;
    const current = this.item?.slicer ?? { kind: 'list' as const, values: [] };
    const kind = slicerKindOf(next);
    const { last: _last, ...rest } = current;
    this.setSlicer(kind === current.kind ? { ...current, style: next } : { ...rest, kind, values: [], style: next });
  }

  setSingle(single: boolean): void {
    const current = this.item?.slicer ?? { kind: 'list' as const, values: [] };
    const { single: _old, ...rest } = current;
    this.setSlicer(single ? { ...rest, single: true, values: current.values.slice(0, 1) } : rest);
  }

  setSync(mode: string): void {
    const { sync: _old, ...rest } = this.item?.slicer ?? { kind: 'list' as const, values: [] };
    this.setSlicer(mode === 'all' ? { ...rest, sync: 'all' } : mode === 'chosen' ? { ...rest, sync: [] } : rest);
  }

  isSyncedTo(sheet: string): boolean {
    const sync = this.item?.slicer?.sync;
    return Array.isArray(sync) && sync.includes(sheet);
  }

  toggleSyncSheet(sheet: string, on: boolean): void {
    const current = this.item?.slicer ?? { kind: 'list' as const, values: [] };
    const chosen = Array.isArray(current.sync) ? current.sync.filter(name => name !== sheet) : [];
    this.setSlicer({ ...current, sync: on ? [...chosen, sheet] : chosen });
  }

  private setSlicer(slicer: SlicerState): void { this.change({ slicer }); }

  addRule(): void {
    const draft = this.draftRule;
    const values = draft.op === 'blank' ? [] : draft.op === 'between' ? draft.values.slice(0, 2).map(value => value.trim()) : [draft.values[0]?.trim() ?? ''];
    const rule: FormatRule = { ...draft, values };
    const rules = this.item?.rules ?? [];
    this.ruleError = rules.length >= MAX_RULES ? `An object takes up to ${MAX_RULES} rules.` : ruleProblem(rule);
    if (this.ruleError || !this.item) return;
    this.change({ rules: [...rules, rule] });
    this.draftRule = { ...blankRule(), field: rule.field };
  }

  removeRule(index: number): void {
    const rules = (this.item?.rules ?? []).filter((_, i) => i !== index);
    this.change({ rules: rules.length ? rules : undefined });
  }

  ruleText(rule: FormatRule): string {
    const label = this.ruleOps.find(op => op.id === rule.op)?.label ?? rule.op;
    const values = rule.op === 'blank' ? '' : rule.op === 'between' ? ` ${rule.values[0]} and ${rule.values[1]}` : ` ${rule.values[0]}`;
    return `${rule.field} ${label}${values}`;
  }

  private change(values: Partial<CanvasItem>): void {
    if (this.item) this.emit({ ...this.item, ...values });
  }

  /**
   * Keeps the pane on the object it just emitted. The parent sends it back only on its next change detection,
   * and two edits in a row (decimals, then the number style) must not build the second on the stale object.
   */
  private emit(next: CanvasItem): void {
    this.item = next;
    this.itemChange.emit(next);
  }
}

function blankRule(): FormatRule {
  return { field: '', op: 'gt', values: ['', ''], tone: 'bad' };
}
