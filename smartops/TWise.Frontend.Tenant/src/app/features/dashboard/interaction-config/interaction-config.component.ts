import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, Input, NgZone, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type Highcharts from 'highcharts';
import { HighchartsChartComponent } from 'highcharts-angular';
import { Observable, Subject, forkJoin, from, of } from 'rxjs';
import { catchError, map, mergeMap, shareReplay, switchMap, takeUntil } from 'rxjs/operators';
import { CommonApiService, PreviewViewRequest } from '../../../core/services/common-api.service';
import { WidgetService } from '../../../core/services/widget.service';
import { A11yDialogDirective } from '../../../shared/directives/a11y-dialog.directive';
import { SharedModule } from '../../../shared/shared.module';
import { buildInteractionChartOptions, buildLegendEntries, LegendEntry } from './interaction-chart.util';
import { legendLayoutClass, LegendPosition, readLegendPosition } from '../../../core/utils/chart-legend-position.util';
import {
  ChartShape, DashboardInteractionConfig, DataRow, INTERACTION_MODES, InteractionMode, InteractionSelection,
  InteractionVisualInput, TileAppearance, VisualProfile, aggregateChartData, alignHighlight, applyDesignRowFilters, buildVisualProfile,
  computeTileResult, connectionBetween, distinctValues, mergeMatrix, resolveTargetRows, sharesValues, tileAppearance, visualKey,
} from './interaction.util';

/** Lets the hosting builder apply its own global filter bar (cluster, plant, dates, ...) to the rows the preview loads. */
export interface InteractionDataAdapter {
  transformSql?: (sql: string) => string;
  previewFilters?: (viewId: number) => PreviewViewRequest['filters'];
  filterRows?: (rows: DataRow[]) => DataRow[];
}

interface SelectRow {
  profile: VisualProfile;
  selected: boolean;
  anchor: boolean;
  disabled: boolean;
  hint: string;
}

interface TargetSetting {
  profile: VisualProfile;
  connected: boolean;
  reason: string;
  mode: InteractionMode;
}

interface TableRowModel { category: string; cells: string[]; selected: boolean; matched: boolean; muted: boolean }

interface VisualRender {
  status: 'loading' | 'ready' | 'error';
  isSource: boolean;
  /** How the current source selection treats this visual; null when nothing is applied to it. */
  applied: InteractionMode | null;
  empty: boolean;
  options?: Highcharts.Options;
  legend?: LegendEntry[];
  /** Changes when the series layout changes (highlight on/off) so the chart is rebuilt instead of patched. */
  chartKey?: string;
  table?: { headers: string[]; rows: TableRowModel[] };
  value?: string;
  highlightValue?: string;
  records?: number;
}

type Role = 'admin' | 'viewer';
type Stage = 'select' | 'preview';

const MODE_LABELS: Record<InteractionMode, string> = { filter: 'Filter', highlight: 'Highlight', none: 'None' };

@Component({
  selector: 'app-interaction-config',
  standalone: true,
  imports: [CommonModule, FormsModule, SharedModule, HighchartsChartComponent, A11yDialogDirective],
  templateUrl: './interaction-config.component.html',
  styleUrls: ['./interaction-config.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InteractionConfigComponent implements OnInit, OnChanges, OnDestroy {
  /** Every chart and tile the dashboard builder can offer. */
  @Input() charts: InteractionVisualInput[] = [];
  @Input() tiles: InteractionVisualInput[] = [];
  /** The interaction setup already saved with the dashboard, if any. */
  @Input() config: DashboardInteractionConfig | null = null;
  @Input() adapter: InteractionDataAdapter = {};
  /** Shows the finished dashboard inline for people viewing it: no editing, just clicking charts to filter or highlight. */
  @Input() viewer = false;
  /** Changing this value reloads the data (the hosting page's filters changed). */
  @Input() reloadToken = 0;
  @Output() saved = new EventEmitter<DashboardInteractionConfig | null>();
  @Output() closed = new EventEmitter<void>();

  readonly modes = INTERACTION_MODES;
  readonly modeLabels = MODE_LABELS;

  stage: Stage = 'select';
  role: Role = 'admin';
  search = '';

  chartRows: SelectRow[] = [];
  tileRows: SelectRow[] = [];

  previewProfiles: VisualProfile[] = [];
  previewCharts: VisualProfile[] = [];
  previewTiles: VisualProfile[] = [];
  matrix: Record<string, Record<string, InteractionMode>> = {};
  activeSourceKey = '';
  selection: InteractionSelection | null = null;
  targetSettings: TargetSetting[] = [];
  /** Values of the active source chart that can be tried out from the admin panel. */
  sourceValues: string[] = [];
  renders: Record<string, VisualRender> = {};

  private profiles: VisualProfile[] = [];
  private readonly selectedKeys = new Set<string>();
  private anchorKey: string | null = null;
  private data: Record<string, { status: 'loading' | 'ready' | 'error'; rows: DataRow[] }> = {};
  private fetchCache = new Map<string, Observable<DataRow[]>>();
  /** Visuals on another data source are only usable once their data is seen to contain the source's category values. */
  private readonly verification = new Map<string, 'checking' | 'yes' | 'no'>();
  private readonly verifyCancel$ = new Subject<void>();
  private readonly relationCache = new Map<string, boolean>();
  private readonly destroy$ = new Subject<void>();

  constructor(
    private readonly commonApi: CommonApiService,
    private readonly widgetService: WidgetService,
    private readonly cdr: ChangeDetectorRef,
    private readonly zone: NgZone,
  ) {}

  ngOnInit(): void {
    this.profiles = this.buildProfiles();
    this.seedFromConfig();
    if (this.viewer) {
      this.openPreview();
      return;
    }
    this.startVerification();
  }

  /** The widget library can finish loading while the panel is open; a viewer reloads its data when the page filters change. */
  ngOnChanges(changes: SimpleChanges): void {
    if (this.viewer) {
      if (changes['reloadToken'] && !changes['reloadToken'].firstChange) {
        this.fetchCache.clear();
        this.loadData();
      }
      return;
    }
    const libraryChanged = [changes['charts'], changes['tiles']].some(change => change && !change.firstChange);
    if (!libraryChanged || this.stage !== 'select') return;
    this.profiles = this.buildProfiles();
    for (const key of [...this.selectedKeys]) if (!this.profileOf(key)) this.selectedKeys.delete(key);
    if (this.anchorKey && !this.profileOf(this.anchorKey)) this.anchorKey = null;
    if (!this.selectedKeys.size) this.seedFromConfig();
    this.startVerification();
  }

  private buildProfiles(): VisualProfile[] {
    return [
      ...this.charts.map(chart => buildVisualProfile('chart', chart)),
      ...this.tiles.map(tile => buildVisualProfile('tile', tile)),
    ];
  }

  ngOnDestroy(): void {
    this.verifyCancel$.next();
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ─── Step 1: choose the visuals ───────────────────────────

  get selectedCount(): number { return this.selectedKeys.size; }
  get hasAnchor(): boolean { return !!this.anchorKey; }
  get anchorTitle(): string { return this.profileOf(this.anchorKey)?.title ?? ''; }
  get anchorDimension(): string { return this.profileOf(this.anchorKey)?.dimension ?? ''; }
  get canAdd(): boolean { return !!this.anchorKey && this.selectedKeys.size >= 2; }
  get hasSavedConfig(): boolean { return !!this.config; }

  showInfo = false;

  /** How many other visuals the chosen source can drive, and how many it cannot (visuals still being checked are not counted). */
  enabledCount = 0;
  disabledCount = 0;

  onSearch(): void { this.refreshRows(); }

  toggle(row: SelectRow): void {
    if (row.disabled && !row.selected) return;
    const key = row.profile.key;
    const previousAnchor = this.anchorKey;
    if (this.selectedKeys.has(key)) {
      this.selectedKeys.delete(key);
      if (key === this.anchorKey) this.reassignAnchor();
    } else {
      this.selectedKeys.add(key);
      if (!this.anchorKey && row.profile.canSource) this.anchorKey = key;
    }
    if (this.anchorKey !== previousAnchor) this.startVerification(); else this.refreshRows();
  }

  makeSource(row: SelectRow, event: Event): void {
    event.stopPropagation();
    if (!row.selected || !row.profile.canSource) return;
    this.anchorKey = row.profile.key;
    this.pruneDisconnected();
    this.startVerification();
  }

  trackRow = (_: number, row: SelectRow): string => row.profile.key;
  trackProfile = (_: number, profile: VisualProfile): string => profile.key;
  readonly legendLayoutClass = legendLayoutClass;
  legendPositionOf(profile: VisualProfile): LegendPosition { return readLegendPosition(profile.design); }
  trackTarget = (_: number, target: TargetSetting): string => target.profile.key;

  addToDashboard(): void {
    if (!this.canAdd) return;
    this.openPreview();
  }

  private openPreview(): void {
    const chosen = this.profiles.filter(profile => this.selectedKeys.has(profile.key));
    this.previewProfiles = chosen;
    this.previewCharts = chosen.filter(profile => profile.kind === 'chart');
    this.previewTiles = chosen.filter(profile => profile.kind === 'tile');
    this.matrix = mergeMatrix(chosen, this.config?.matrix);
    this.activeSourceKey = this.anchorKey ?? '';
    this.selection = null;
    this.role = this.viewer ? 'viewer' : 'admin';
    this.stage = 'preview';
    this.refreshTargets();
    this.loadData();
  }

  /** Hands the setup to the builder (shown inline there, stored when the dashboard is saved) and closes the popup. */
  saveConfiguration(): void {
    this.emitConfig();
    this.closed.emit();
  }

  backToSelection(): void {
    this.stage = 'select';
    this.selection = null;
    this.refreshRows();
  }

  removeConfig(): void {
    this.saved.emit(null);
    this.closed.emit();
  }

  close(): void { this.closed.emit(); }

  // ─── Step 2: the dashboard preview ────────────────────────

  get isAdmin(): boolean { return this.role === 'admin'; }
  get activeSource(): VisualProfile | null { return this.profileOf(this.activeSourceKey); }
  get sourceChoices(): VisualProfile[] { return this.previewCharts.filter(profile => profile.canSource); }
  get fixedTargets(): VisualProfile[] { return this.previewProfiles.filter(profile => !profile.canSource); }

  get stateLabel(): string {
    if (!this.selection) return 'No active interaction';
    const source = this.profileOf(this.selection.sourceKey);
    return `${source?.title ?? ''} → ${this.selection.values.join(', ')}`;
  }

  setRole(role: Role): void {
    this.role = role;
  }

  onSourceChange(key: string): void {
    this.activeSourceKey = key;
    this.selection = null;
    this.refreshTargets();
    this.recompute();
  }

  setMode(target: TargetSetting, mode: InteractionMode): void {
    if (!target.connected) return;
    this.matrix[this.activeSourceKey] = { ...this.matrix[this.activeSourceKey], [target.profile.key]: mode };
    this.refreshTargets();
    this.recompute();
  }

  isValueSelected(value: string): boolean {
    return this.selection?.sourceKey === this.activeSourceKey && this.selection.values.includes(value);
  }

  pickValue(value: string, additive = false): void {
    this.pick(this.activeSourceKey, value, additive);
  }

  pick(sourceKey: string, category: string, additive: boolean): void {
    const source = this.profileOf(sourceKey);
    if (!source?.canSource) return;
    if (this.selection?.sourceKey !== sourceKey) {
      this.activeSourceKey = sourceKey;
      this.selection = { sourceKey, dimension: source.dimension, values: [category] };
      this.refreshTargets();
      this.recompute();
      return;
    }
    const current = this.selection.values;
    const next = additive
      ? (current.includes(category) ? current.filter(value => value !== category) : [...current, category])
      : (current.length === 1 && current[0] === category ? [] : [category]);
    this.selection = next.length ? { ...this.selection, values: next } : null;
    this.recompute();
  }

  clearSelection(): void {
    this.selection = null;
    this.recompute();
  }

  /** Hands the current setup to the builder so it is stored when the dashboard is saved. */
  private emitConfig(): void {
    if (this.viewer) return;
    const config: DashboardInteractionConfig = {
      version: 1,
      visuals: this.previewProfiles.map(profile => ({ kind: profile.kind, id: profile.id })),
      sourceKey: this.activeSourceKey || null,
      matrix: this.matrix,
    };
    this.config = config;
    this.saved.emit(config);
  }

  pickFromTable(profile: VisualProfile, row: TableRowModel, event: MouseEvent): void {
    this.pick(profile.key, row.category, event.ctrlKey || event.metaKey);
  }

  // ─── Internals ────────────────────────────────────────────

  private profileOf(key: string | null): VisualProfile | null {
    return key ? this.profiles.find(profile => profile.key === key) ?? null : null;
  }

  private seedFromConfig(): void {
    const saved = this.config;
    if (!saved) return;
    for (const ref of saved.visuals) {
      const key = visualKey(ref.kind, ref.id);
      if (this.profileOf(key)) this.selectedKeys.add(key);
    }
    const preferred = this.profileOf(saved.sourceKey);
    this.anchorKey = preferred?.canSource && this.selectedKeys.has(preferred.key)
      ? preferred.key
      : this.profiles.find(profile => this.selectedKeys.has(profile.key) && profile.canSource)?.key ?? null;
    this.pruneDisconnected();
    if (!this.anchorKey) this.selectedKeys.clear();
  }

  private reassignAnchor(): void {
    this.anchorKey = this.profiles.find(profile => this.selectedKeys.has(profile.key) && profile.canSource)?.key ?? null;
    if (this.anchorKey) this.pruneDisconnected(); else this.selectedKeys.clear();
  }

  /** After the source changes, drops chosen visuals that the new source cannot filter. */
  private pruneDisconnected(): void {
    const anchor = this.profileOf(this.anchorKey);
    if (!anchor) return;
    for (const key of [...this.selectedKeys]) {
      const profile = this.profileOf(key);
      if (key !== anchor.key && profile && !connectionBetween(anchor, profile).connected) this.selectedKeys.delete(key);
    }
  }

  private refreshRows(): void {
    const term = this.search.trim().toLowerCase();
    const anchor = this.profileOf(this.anchorKey);
    const toRow = (profile: VisualProfile): SelectRow => {
      const selected = this.selectedKeys.has(profile.key);
      const isAnchor = profile.key === this.anchorKey;
      let disabled = false;
      let hint = '';
      if (isAnchor) {
        hint = 'Source';
      } else if (anchor) {
        const connection = connectionBetween(anchor, profile);
        const crossSource = connection.connected && profile.sourceKey !== anchor.sourceKey;
        const check = crossSource ? this.verification.get(profile.key) : 'yes';
        disabled = !connection.connected || check !== 'yes';
        hint = !connection.connected ? connection.reason
          : check === 'no' ? 'No matching values in this data'
          : check === 'yes' ? connection.reason : 'Checking data...';
      } else if (profile.kind === 'tile') {
        disabled = true;
        hint = 'Choose a source chart first';
      } else if (!profile.canSource) {
        disabled = true;
        hint = 'No category field, so it cannot be the source';
      } else {
        hint = profile.dimension ? `Filters by "${profile.dimension}"` : '';
      }
      return { profile, selected, anchor: isAnchor, disabled, hint };
    };
    const matches = (profile: VisualProfile) => !term || profile.title.toLowerCase().includes(term);
    // Once a source is chosen, what it can drive comes first so nobody has to scroll past unrelated visuals.
    const rank = (row: SelectRow) => !anchor ? 0 : row.anchor ? 0 : row.selected ? 1 : !row.disabled ? 2 : row.hint === 'Checking data...' ? 3 : 4;
    const ordered = (kind: VisualProfile['kind']) => this.profiles
      .filter(profile => profile.kind === kind && matches(profile)).map(toRow)
      .map((row, index) => ({ row, index }))
      .sort((left, right) => rank(left.row) - rank(right.row) || left.index - right.index)
      .map(item => item.row);
    this.chartRows = ordered('chart');
    this.tileRows = ordered('tile');
    const everyRow = this.profiles.map(toRow).filter(row => !row.anchor);
    this.enabledCount = everyRow.filter(row => !row.disabled).length;
    this.disabledCount = everyRow.filter(row => row.disabled && row.hint !== 'Checking data...').length;
    this.cdr.markForCheck();
  }

  /** Checks, against the real data, which visuals on other data sources actually contain the source chart's values. */
  private startVerification(): void {
    this.verifyCancel$.next();
    this.verification.clear();
    const anchor = this.profileOf(this.anchorKey);
    if (!anchor) { this.refreshRows(); return; }
    const pending = this.profiles.filter(profile => profile.key !== anchor.key && profile.sourceKey !== anchor.sourceKey
      && connectionBetween(anchor, profile).connected);
    pending.forEach(profile => this.verification.set(profile.key, 'checking'));
    this.refreshRows();
    if (!pending.length) return;
    this.fetchRows(anchor).pipe(
      map(rows => distinctValues(applyDesignRowFilters(rows, anchor.design), anchor.dimension)),
      catchError(() => of(new Set<string>())),
      switchMap(values => from(pending).pipe(mergeMap(profile => this.fetchRows(profile).pipe(
        map(rows => ({ key: profile.key, related: sharesValues(applyDesignRowFilters(rows, profile.design), anchor.dimension, values) })),
        catchError(() => of({ key: profile.key, related: false })),
      ), 4))),
      takeUntil(this.verifyCancel$), takeUntil(this.destroy$),
    ).subscribe(result => {
      this.verification.set(result.key, result.related ? 'yes' : 'no');
      if (!result.related) this.selectedKeys.delete(result.key);
      this.refreshRows();
    });
  }

  /** Whether clicking `source` can reach `target`: connected by design and, across data sources, sharing real values. */
  private isRelated(source: VisualProfile, target: VisualProfile): boolean {
    if (!connectionBetween(source, target).connected) return false;
    if (source.sourceKey === target.sourceKey) return true;
    const cacheKey = `${source.key}>${target.key}`;
    const cached = this.relationCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const sourceData = this.data[source.key];
    const targetData = this.data[target.key];
    if (sourceData?.status !== 'ready' || targetData?.status !== 'ready') return true;
    const related = sharesValues(targetData.rows, source.dimension, distinctValues(sourceData.rows, source.dimension));
    this.relationCache.set(cacheKey, related);
    return related;
  }

  private refreshTargets(): void {
    const source = this.activeSource;
    this.targetSettings = source
      ? this.previewProfiles.filter(profile => profile.key !== source.key).map(profile => {
          const connection = connectionBetween(source, profile);
          const related = this.isRelated(source, profile);
          return {
            profile, connected: related,
            reason: related || !connection.connected ? connection.reason : 'No matching values in this data',
            mode: related ? this.matrix[source.key]?.[profile.key] ?? 'filter' : 'none',
          };
        })
      : [];
    const rows = source ? this.data[source.key]?.rows ?? [] : [];
    this.sourceValues = source && rows.length ? aggregateChartData(rows, source.design).categories : [];
    this.cdr.markForCheck();
  }

  private fetchRows(profile: VisualProfile): Observable<DataRow[]> {
    const cached = this.fetchCache.get(profile.sourceKey);
    if (cached) return cached;
    const raw$ = profile.isView
      ? this.commonApi.getDatabaseViewById(profile.viewId).pipe(switchMap(view => this.commonApi.previewView({
          connectionId: view.connectionId, sql: this.adapter.transformSql?.(view.generatedSql) ?? view.generatedSql,
          viewId: view.id, maxRows: 1000, filters: this.adapter.previewFilters?.(view.id),
        })))
      : this.widgetService.getTableData(profile.source, profile.sourceType);
    const rows$ = raw$.pipe(
      map(result => result.rows ?? []),
      map(rows => this.adapter.filterRows ? this.adapter.filterRows(rows) : rows),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.fetchCache.set(profile.sourceKey, rows$);
    return rows$;
  }

  private loadData(): void {
    this.data = {};
    this.relationCache.clear();
    for (const profile of this.previewProfiles) this.data[profile.key] = { status: 'loading', rows: [] };
    this.recompute();
    forkJoin(this.previewProfiles.map(profile => this.fetchRows(profile).pipe(
      map(rows => ({ key: profile.key, status: 'ready' as const, rows: applyDesignRowFilters(rows, profile.design) })),
      catchError(() => {
        this.fetchCache.delete(profile.sourceKey);
        return of({ key: profile.key, status: 'error' as const, rows: [] as DataRow[] });
      }),
    ))).pipe(takeUntil(this.destroy$)).subscribe(results => {
      for (const result of results) this.data[result.key] = { status: result.status, rows: result.rows };
      this.refreshTargets();
      this.recompute();
    });
  }

  private recompute(): void {
    const selection = this.selection;
    const source = selection ? this.profileOf(selection.sourceKey) : null;
    const next: Record<string, VisualRender> = {};
    for (const profile of this.previewProfiles) {
      const entry = this.data[profile.key];
      if (!entry || entry.status !== 'ready') {
        next[profile.key] = { status: entry?.status ?? 'loading', isSource: false, applied: null, empty: false };
        continue;
      }
      const isSource = !!source && source.key === profile.key;
      const mode = source && !isSource && this.isRelated(source, profile) ? this.matrix[source.key]?.[profile.key] ?? 'none' : 'none';
      const target = resolveTargetRows(entry.rows, profile, source, selection, mode);
      next[profile.key] = {
        empty: false,
        ...(profile.kind === 'tile' ? this.renderTile(profile, target) : this.renderChart(profile, target, isSource ? selection!.values : [])),
        status: 'ready', isSource, applied: target.active ? mode : null,
      };
    }
    this.renders = next;
    this.cdr.markForCheck();
  }

  private renderTile(profile: VisualProfile, target: ReturnType<typeof resolveTargetRows>): Partial<VisualRender> {
    const value = computeTileResult(target.rows, profile.design);
    return {
      value: value.text, records: target.rows.length, empty: false,
      highlightValue: target.highlightRows ? computeTileResult(target.highlightRows, profile.design).text : undefined,
    };
  }

  private renderChart(profile: VisualProfile, target: ReturnType<typeof resolveTargetRows>, selected: string[]): Partial<VisualRender> {
    const data = aggregateChartData(target.rows, profile.design);
    if (!data.categories.length) return { empty: true };
    const highlight = target.highlightRows ? alignHighlight(data, aggregateChartData(target.highlightRows, profile.design)) : null;
    const shape = profile.shape as ChartShape;
    if (shape === 'table') {
      const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
      const chosen = new Set(selected.map(value => value.toLowerCase()));
      return {
        empty: false,
        table: {
          headers: [data.xHeader, ...data.series.map(series => series.name)],
          rows: data.categories.map((category, index) => {
            const matched = !!highlight && highlight.series.some(series => (series.values[index] ?? 0) !== 0);
            return {
              category, selected: chosen.has(category.toLowerCase()), matched, muted: !!highlight && !matched,
              cells: data.series.map((series, seriesIndex) => highlight
                ? `${format(series.values[index] ?? 0)} (${format(highlight.series[seriesIndex]?.values[index] ?? 0)})`
                : format(series.values[index] ?? 0)),
            };
          }),
        },
      };
    }
    return {
      empty: false,
      chartKey: highlight ? 'highlight' : 'plain',
      legend: profile.design['showLegend'] === false ? [] : buildLegendEntries({ shape, data, highlight, selected }),
      options: buildInteractionChartOptions({
        shape, data, highlight, selected,
        onPick: (category, additive) => this.zone.run(() => this.pick(profile.key, category, additive)),
      }),
    };
  }

  private readonly tileLooks = new Map<string, TileAppearance>();

  /** The colour and icon the tile was given in the Tile Builder. */
  tileLook(profile: VisualProfile): TileAppearance {
    let look = this.tileLooks.get(profile.key);
    if (!look) { look = tileAppearance(profile.design); this.tileLooks.set(profile.key, look); }
    return look;
  }

  tileLabel(profile: VisualProfile): string {
    const label = profile.design['label'];
    return typeof label === 'string' && label.trim() ? label.trim() : profile.title;
  }

  pickFromLegend(profile: VisualProfile, entry: LegendEntry, event: MouseEvent): void {
    if (entry.pickable) this.pick(profile.key, entry.label, event.ctrlKey || event.metaKey);
  }
}
