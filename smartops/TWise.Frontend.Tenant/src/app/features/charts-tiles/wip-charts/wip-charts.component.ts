import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, Subscription } from 'rxjs';
import type Highcharts from 'highcharts';
import { Copy, createElement } from 'lucide';
import { CategoryService } from '../../../core/services/category.service';
import { CategoryDropdown } from '../../../core/models/category.model';
import { WidgetService, Widget } from '../../../core/services/widget.service';
import { NotificationHelper } from '../../../core/helpers/notification.helper';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/services/auth.service';
import { PermissionService } from '../../../core/services/permission.service';
import { CHART_AUTO_COLORS } from '../../../core/utils/chart-color.util';
import { ChartView, chartSwitchOptions, chartViewLabel, toChartView } from '../../../core/constants/chart-view.constants';
import { collapseGroupsOnReenter } from '../../../core/utils/collapse-groups-on-reenter';
import { reloadListOnReenter } from '../../../core/utils/reload-list-on-reenter';

const CHART_CONTROL_TYPE = 2;

export type ChartAccent = 'purple' | 'blue' | 'green' | 'orange' | 'coral';
export type ChartVisual = 'donut' | 'bar' | 'pie' | 'line' | 'multiline' | 'area' | 'stacked' | 'spline' | 'column';

const GROUP_LABELS = ['Group A', 'Group B', 'Group C', 'Group D', 'Group E'];
const GROUP_COLORS = [...CHART_AUTO_COLORS];
const GROUP_VALUES = [88, 57, 94, 51, 68];

const CHART_PREVIEW_BY_ACCENT: Record<ChartAccent, string> = {
  purple: 'assets/images/standard-chart.svg',
  blue:   'assets/images/standard-chart1.svg',
  green:  'assets/images/standard-chart2.svg',
  orange: 'assets/images/standard-chart3.svg',
  coral:  'assets/images/standard-chart.svg',
};

export interface ChartItem {
  id: string;
  title: string;
  description: string;
  category: string;
  visual: ChartVisual;
  accent: ChartAccent;
  favorite: boolean;
  recentlyViewed: boolean;
  modifiedLabel?: string;
  previewImage?: string;
  widget?: Widget;
}

export interface ChartGroup {
  category: string;
  description?: string;
  icon: 'settings' | 'productivity' | 'crew';
  charts: ChartItem[];
  expanded: boolean;
}

type TabId = 'all' | 'favorites' | 'recent' | 'draft' | 'completed';
type ViewMode = 'grid' | 'list' | 'chart';
type SortOption = 'default' | 'newest' | 'oldest' | 'name-az' | 'name-za' | 'most-charts';

@Component({
  selector: 'app-wip-charts',
  standalone: false,
  templateUrl: './wip-charts.component.html',
  styleUrls: ['./wip-charts.component.scss'],
})
export class WipChartsComponent implements OnInit, OnDestroy {
  private readonly notify: NotificationHelper;
  get successMessage(): string { return this.notify.successMessage; }
  get error(): string { return this.notify.error; }

  @ViewChild('cloneIcon')
  set cloneIcon(element: ElementRef<HTMLElement> | undefined) {
    element?.nativeElement.replaceChildren(createElement(Copy, { width: 18, height: 18, 'aria-hidden': 'true' }));
  }

  constructor(
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly categoryService: CategoryService,
    private readonly widgetService: WidgetService,
    private readonly cdr: ChangeDetectorRef,
    private readonly toastService: ToastService,
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
  ) {
    this.notify = new NotificationHelper(cdr);
    this.chartGroups = this.groupCharts(this.charts);
  }

  get isAdmin(): boolean { return this.authService.isAdmin(); }
  get canCreate(): boolean { return this.permissionService.canCreate('charts.wip-charts'); }
  get canManageCategories(): boolean { return this.permissionService.canView('charts.categories'); }
  get canModify(): boolean { return this.permissionService.canModify('charts.wip-charts'); }
  get canAdmin(): boolean { return this.permissionService.canAdmin('charts.wip-charts'); }
  canEditChart(chart: ChartItem): boolean {
    return this.canModify && !!chart.widget && chart.widget.status !== 'published';
  }
  mode: 'wip' | 'standard' | 'published' = 'wip';
  get pageTitle(): string {
    if (this.mode === 'published') return 'Published Charts';
    if (this.mode === 'standard') return 'Standard Charts';
    return this.isAdmin ? 'WIP Charts' : 'My Charts';
  }
  get pageSubtitle(): string {
    return this.isAdmin ? 'Manage work in progress Charts' : 'Create, View and Manage your Charts';
  }

  activeTab: TabId = 'all';
  viewMode: ViewMode = 'grid';
  sortOption: SortOption = 'default';
  categoryFilter: string[] = [];
  searchTerm = '';
  categorySearch = '';
  openMenuId: string | null = null;
  cloningChartIds = new Set<string>();
  categoryOpen = false;
  sortOpen = false;
  isLoading = true;

  readonly sortItems: { value: SortOption; label: string; icon: string }[] = [
    { value: 'default',     label: 'Default',          icon: 'default'     },
    { value: 'newest',      label: 'Newest First',  icon: 'newest'      },
    { value: 'oldest',      label: 'Oldest First',  icon: 'oldest'      },
    { value: 'name-az',     label: 'Name A-Z',      icon: 'name-az'     },
    { value: 'name-za',     label: 'Name Z-A',      icon: 'name-za'     },
    { value: 'most-charts', label: 'Most Charts',   icon: 'most-charts' },
  ];

  get sortButtonLabel(): string {
    if (this.sortOption === 'default') return 'Sort';
    return this.sortItems.find(i => i.value === this.sortOption)?.label ?? 'Sort';
  }

  showAddChartModal = false;
  showCategoryManager = false;
  newChartCategory = '';
  newChartCategoryId = 0;
  newChartName = '';
  newChartDescription = '';
  showNameSuggestions = false;
  addModalCategoryOpen = false;

  toggleAddModalCategory(event: Event): void {
    event.stopPropagation();
    this.addModalCategoryOpen = !this.addModalCategoryOpen;
  }

  selectAddModalCategory(categoryId: number, categoryName: string): void {
    this.newChartCategoryId = categoryId;
    this.newChartCategory = categoryName;
    this.addModalCategoryOpen = false;
  }

  /** Categories fetched from the backend API. */
  apiCategories: CategoryDropdown[] = [];
  private categorySub!: Subscription;
  private reenterSub!: Subscription;
  private reloadSub!: Subscription;

  chartGroups: ChartGroup[] = [];
  /** Expanded category per tab (accordion-style within a tab) — keyed separately so expanding
   *  a group in one tab (e.g. All) doesn't also show it expanded in another (e.g. Favorites). */
  private expandedByTab: Partial<Record<TabId, string>> = {};

  get visibleChartGroups(): ChartGroup[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.chartGroups
      .map(g => {
        let charts = g.charts
          .filter(c => {
            if (this.activeTab === 'all') return true;
            if (this.activeTab === 'favorites') return c.favorite;
            if (this.activeTab === 'draft') return c.widget?.status === 'draft';
            if (this.activeTab === 'completed') return c.widget?.status === 'completed';
            return c.recentlyViewed;
          })
          .filter(c => this.categoryFilter.length === 0 || this.categoryFilter.includes(c.category))
          .filter(c => !term || c.title.toLowerCase().includes(term));

        if (this.sortOption === 'default') {
          charts = [...charts].sort((a, b) => this.createdRank(b) - this.createdRank(a));
        }

        if (this.sortOption === 'name-az') {
          charts = [...charts].sort((a, b) => a.title.localeCompare(b.title));
        } else if (this.sortOption === 'name-za') {
          charts = [...charts].sort((a, b) => b.title.localeCompare(a.title));
        } else if (this.sortOption === 'newest') {
          charts = [...charts].sort((a, b) => this.recentRank(a.id) - this.recentRank(b.id));
        } else if (this.sortOption === 'oldest') {
          charts = [...charts].sort((a, b) => this.recentRank(b.id) - this.recentRank(a.id));
        } else if (this.sortOption === 'most-charts') {
          charts = [...charts].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
        }

        // Recent tab defaults to last-viewed-first within each category
        if (this.activeTab === 'recent' && this.sortOption === 'default') {
          charts = [...charts].sort((a, b) => this.recentRank(a.id) - this.recentRank(b.id));
        }

        return { ...g, charts, expanded: this.expandedByTab[this.activeTab] === g.category };
      })
      .filter(g => g.charts.length > 0)
      .sort((a, b) => {
        if (this.activeTab === 'recent' && this.sortOption === 'default') return this.recentGroupRank(a.charts) - this.recentGroupRank(b.charts);
        const rank = (key: string) => { const i = this.groupOrder.indexOf(key); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
        return rank(a.category) - rank(b.category);
      });
  }

  /** Lowest recency index among a group's items; groups with no recently-viewed items sort last. */
  private recentGroupRank(items: { id: string }[]): number {
    let best = Number.MAX_SAFE_INTEGER;
    for (const item of items) {
      const idx = this.recentIds.indexOf(Number(item.id));
      if (idx !== -1 && idx < best) best = idx;
    }
    return best;
  }

  /** Recency position of an item (0 = most recent); non-viewed items sort last. */
  private recentRank(id: string): number {
    const idx = this.recentIds.indexOf(Number(id));
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  }

  /** Monotonic widget id — a higher value means created more recently. Seed/demo items rank 0. */
  private createdRank(item: ChartItem): number {
    return item.widget?.id ?? 0;
  }

  private groupCharts(items: ChartItem[]): ChartGroup[] {
    const grouped = new Map<string, ChartItem[]>();
    items.forEach(c => {
      if (!grouped.has(c.category)) grouped.set(c.category, []);
      grouped.get(c.category)!.push(c);
    });
    const icons: ('settings' | 'productivity' | 'crew')[] = ['settings', 'productivity', 'crew'];
    let iconIdx = 0;
    return Array.from(grouped.entries()).map(([category, charts]) => ({
      category,
      description: this.apiCategories.find(c => c.categoryName === category)?.description,
      icon: icons[iconIdx++ % 3],
      charts,
      // Carry forward expanded state so the background reload on reenter doesn't collapse
      // a category the user just opened while the refetch was still in flight.
      expanded: this.chartGroups.find(g => g.category === category)?.expanded ?? false,
    }));
  }

  toggleGroup(group: ChartGroup): void {
    // Accordion within the active tab only — toggling here must not touch other tabs' state.
    const isOpen = this.expandedByTab[this.activeTab] === group.category;
    this.expandedByTab[this.activeTab] = isOpen ? undefined : group.category;
  }

  ngOnInit(): void {
    this.mode = this.route.snapshot.data['mode'] ?? 'wip';
    const pending = this.toastService.consume();
    if (pending) this.notify.showSuccess(pending);
    this.reenterSub = collapseGroupsOnReenter(this.router, ['wip-charts'], () => this.chartGroups, () => this.cdr.markForCheck(), () => {
      this.searchTerm = '';
      this.sortOption = 'default';
      this.categoryFilter = [];
      this.categoryOpen = false;
      this.sortOpen = false;
      this.expandedByTab = {};
      this.computeGroupOrder();
      this.cdr.markForCheck();
    });
    this.reloadSub = reloadListOnReenter(this.router, ['wip-charts'], () => this.loadCharts());
    this.categorySub = this.categoryService.getCategoriesByType('chart').subscribe((cats) => {
      this.apiCategories = cats;
    });
    this.loadCharts();
    // preferences are loaded inside loadCharts() after charts arrive
  }

  // Favourite IDs and recently-viewed IDs from API
  private favouriteIds  = new Set<number>();
  private recentIds: number[] = [];
  private locallyViewedIds: number[] = [];

  private loadPreferences(): void {
    // Silently load — errors (e.g. table not yet created) must NOT trigger the global 401 redirect
    this.widgetService.getFavourites(CHART_CONTROL_TYPE).subscribe({
      next: (prefs) => {
        this.favouriteIds = new Set(prefs.map(p => p.controlId));
        this.charts = this.charts.map(c => ({ ...c, favorite: this.favouriteIds.has(Number(c.id)) }));
        this.chartGroups = this.groupCharts(this.charts);
        this.computeGroupOrder();
        this.cdr.markForCheck();
      },
      error: () => { /* suppress — preference table may not exist yet */ },
    });
    this.widgetService.getRecentlyViewed(CHART_CONTROL_TYPE, 50).subscribe({
      next: (prefs) => {
        this.recentIds = [...new Set([...this.locallyViewedIds, ...prefs.map(p => p.controlId)])];
        this.charts = this.charts.map(c => ({ ...c, recentlyViewed: this.recentIds.includes(Number(c.id)) }));
        this.chartGroups = this.groupCharts(this.charts);
        this.computeGroupOrder();
        this.cdr.markForCheck();
      },
      error: () => { /* suppress */ },
    });
  }

  // Requests against a local/dev API can resolve in a few ms — too fast for the
  // loader to ever be visible on screen. Holding it up for a minimum stretch
  // keeps it perceptible without meaningfully slowing down real network calls.
  private static readonly MIN_LOADER_MS = 300;

  private stopLoading(startedAt: number): void {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= WipChartsComponent.MIN_LOADER_MS) {
      this.isLoading = false;
      this.cdr.markForCheck();
    } else {
      setTimeout(() => { this.isLoading = false; this.cdr.markForCheck(); }, WipChartsComponent.MIN_LOADER_MS - elapsed);
    }
  }

  private loadCharts(): void {
    const isPublishedMode = this.mode === 'standard' || this.mode === 'published';
    const statusParam = isPublishedMode ? 'published' : undefined;
    const startedAt = Date.now();

    this.widgetService.getWidgets(statusParam, 'chart').subscribe({
      next: (widgets) => {
        // For WIP/My: exclude published charts
        const filtered = isPublishedMode
          ? widgets
          : widgets.filter((w: Widget) => w.status !== 'published');
        const apiCharts: ChartItem[] = filtered.map((w: Widget, i: number) => {
          let design: Record<string, unknown> = {};
          try { design = JSON.parse(w.designJson ?? '{}'); } catch { /* ignore */ }
          const chartType = (design['chartType'] as string) ?? '';
          const isPieType = ['pie', 'donut'].includes(chartType);
          const accents: ChartAccent[] = ['purple', 'blue', 'green', 'orange', 'coral'];
          const accent = accents[i % accents.length];
          const visual: ChartVisual = (chartType as ChartVisual) || (isPieType ? 'donut' : 'bar');
          // Per-card switch group mirrors the Chart Details page; 'table' is a separate tab so it's excluded here.
          const savedView = toChartView(chartType);
          this.cardChartTypeOptions[String(w.id)] = chartSwitchOptions(savedView, design).filter(t => t !== 'table');
          this.cardChartType[String(w.id)] ??= savedView;
          return {
            id: String(w.id),
            title: w.name,
            description: w.description || `${w.source ?? ''} — ${chartType || 'chart'}`,
            category: w.categoryName ?? 'Uncategorized',
            visual, accent,
            favorite: this.favouriteIds.has(w.id),
            recentlyViewed: this.recentIds.includes(w.id),
            modifiedLabel: this.relativeTime(w.createdAt),
            previewImage: CHART_PREVIEW_BY_ACCENT[accent],
            widget: w,
          };
        });
        this.charts = apiCharts;
        this.chartGroups = this.groupCharts(apiCharts);
        this.computeGroupOrder();
        this.stopLoading(startedAt);
        // Load preferences AFTER charts are set so the mapping is applied to real data
        this.loadPreferences();
      },
      error: () => {
        this.stopLoading(startedAt);
      },
    });
  }

  openChart(chart: ChartItem): void {
    const chartId = Number(chart.id);
    chart.recentlyViewed = true;
    this.locallyViewedIds = [chartId, ...this.locallyViewedIds.filter(id => id !== chartId)];
    this.recentIds = [chartId, ...this.recentIds.filter(id => id !== chartId)];
    // Track view before navigating
    this.widgetService.trackView(CHART_CONTROL_TYPE, chartId).subscribe({ error: () => {} });
    this.router.navigate(['/charts-tiles/view', chart.id], { queryParams: { type: 'chart', from: 'wip' } });
  }

  // Ignore clicks on the Highcharts legend pager (page arrows/"1/2" text) so they scroll
  // the legend instead of bubbling up and navigating to the chart's detail page.
  onChartCardClick(event: MouseEvent, chart: ChartItem): void {
    const target = event.target as Element | null;
    if (target?.closest?.('.highcharts-legend-nav-active, .highcharts-legend-nav-inactive, .highcharts-legend-navigation')) {
      return;
    }
    this.openChart(chart);
  }

  ngOnDestroy(): void {
    this.categorySub?.unsubscribe();
    this.reenterSub?.unsubscribe();
    this.reloadSub?.unsubscribe();
    this.notify.destroy();
  }

  onCategoryManagerClosed(): void {
    this.showCategoryManager = false;
    this.categoryService.getCategoriesByType('chart').subscribe(cats => {
      this.apiCategories = cats;
      this.chartGroups.forEach(g => { g.description = cats.find(c => c.categoryName === g.category)?.description; });
      this.cdr.markForCheck();
    });
  }

  chartNameSuggestions = [
    'Well Uptime Summary',
    'Crew Utilization Trend',
    'Penalty Exposure Breakdown',
    'Production Variance',
    'Safety Incidents Overview',
  ];

  charts: ChartItem[] = [
    {
      id: 'odc-overall-status',
      title: 'ODC Overall Status',
      description: 'Drilled / hook-up / due wells status doughnut with breakdown.',
      category: 'Operations',
      visual: 'donut',
      accent: 'purple',
      favorite: true,
      recentlyViewed: true,
      previewImage: 'assets/images/standard-chart.svg',
    },
    {
      id: 'my-crew-utilization',
      title: 'My Crew Utilization',
      description: 'Active vs idle crew hours by shift, saved from Standard Charts.',
      category: 'Crew',
      visual: 'bar',
      accent: 'green',
      favorite: false,
      recentlyViewed: true,
      previewImage: 'assets/images/standard-chart2.svg',
    },
    {
      id: 'my-well-uptime',
      title: 'Well Uptime (My View)',
      description: 'Average uptime % across wells I track.',
      category: 'Operations',
      visual: 'donut',
      accent: 'blue',
      favorite: true,
      recentlyViewed: false,
      previewImage: 'assets/images/standard-chart1.svg',
    },
  ];

  get tabs(): { id: TabId; label: string; count: number }[] {
    return [
      { id: 'all', label: 'All', count: this.charts.length },
      { id: 'favorites', label: 'Favorites', count: this.charts.filter(c => c.favorite).length },
      { id: 'recent', label: 'Recent', count: this.charts.filter(c => c.recentlyViewed).length },
      { id: 'draft', label: 'Draft', count: this.charts.filter(c => c.widget?.status === 'draft').length },
      { id: 'completed', label: 'Completed', count: this.charts.filter(c => c.widget?.status === 'completed').length },
    ];
  }

  get categories(): string[] {
    const apiNames = this.apiCategories.map(c => c.categoryName);
    const chartCats = this.charts.map(c => c.category);
    return ['all', ...new Set([...apiNames, ...chartCats])];
  }

  get categoryOptions(): { value: string; label: string }[] {
    return this.apiCategories.map(c => ({ value: c.categoryName, label: c.categoryName }));
  }

  get filteredCategoryOptions(): { value: string; label: string }[] {
    const term = this.categorySearch.trim().toLowerCase();
    return this.categoryOptions.filter(option => option.label.toLowerCase().includes(term));
  }

  /** Charts filtered by the active tab, search term and category. */
  get visibleCharts(): ChartItem[] {
    const term = this.searchTerm.trim().toLowerCase();

    let charts = this.charts
      .filter(c => {
        if (this.activeTab === 'all') return true;
        if (this.activeTab === 'favorites') return c.favorite;
        if (this.activeTab === 'draft') return c.widget?.status === 'draft';
        if (this.activeTab === 'completed') return c.widget?.status === 'completed';
        return c.recentlyViewed;
      })
      .filter(c => this.categoryFilter.length === 0 || this.categoryFilter.includes(c.category))
      .filter(c => !term || c.title.toLowerCase().includes(term));

    if (this.sortOption === 'default') {
      charts = [...charts].sort((a, b) => this.createdRank(b) - this.createdRank(a));
    }

    if (this.sortOption === 'name-az') {
      charts = [...charts].sort((a, b) => a.title.localeCompare(b.title));
    } else if (this.sortOption === 'name-za') {
      charts = [...charts].sort((a, b) => b.title.localeCompare(a.title));
    } else if (this.sortOption === 'newest') {
      charts = [...charts].sort((a, b) => (b.recentlyViewed ? 1 : 0) - (a.recentlyViewed ? 1 : 0));
    } else if (this.sortOption === 'oldest') {
      charts = [...charts].sort((a, b) => (a.recentlyViewed ? 1 : 0) - (b.recentlyViewed ? 1 : 0));
    } else if (this.sortOption === 'most-charts') {
      charts = [...charts].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
    }

    return charts;
  }

  trackByGroup(_index: number, group: ChartGroup): string {
    return group.category;
  }

  trackByChart(_index: number, chart: ChartItem): string {
    return chart.id;
  }

  toggleCategoryDropdown(): void {
    this.categoryOpen = !this.categoryOpen;
    if (this.categoryOpen) {
      this.categorySearch = '';
      this.sortOpen = false;
    }
  }

  closeCategoryDropdown(): void { this.categoryOpen = false; }

  setCategoryFilter(value: string): void {
    if (value === 'all') {
      this.categoryFilter = [];
      this.categoryOpen = false;
      return;
    }
    this.categoryFilter = this.categoryFilter.includes(value)
      ? this.categoryFilter.filter(v => v !== value)
      : [...this.categoryFilter, value];
  }

  toggleSortDropdown(): void {
    this.sortOpen = !this.sortOpen;
    if (this.sortOpen) this.categoryOpen = false;
  }

  closeSortDropdown(): void { this.sortOpen = false; }

  setSortOption(value: SortOption): void {
    this.sortOption = value;
    this.sortOpen = false;
    // Only reorder categories when none is expanded; otherwise keep the current
    // outer order and let the sort apply to the open category's items only.
    if (!this.expandedByTab[this.activeTab]) this.computeGroupOrder();
  }

  /** Snapshot of category keys in current sortOption order — recomputed only when nothing is expanded. */
  private groupOrder: string[] = [];

  private computeGroupOrder(): void {
    const sorted = [...this.chartGroups].sort((a, b) => {
      if (this.sortOption === 'name-az') return a.category.localeCompare(b.category);
      if (this.sortOption === 'name-za') return b.category.localeCompare(a.category);
      if (this.sortOption === 'newest') return this.recentGroupRank(a.charts) - this.recentGroupRank(b.charts);
      if (this.sortOption === 'oldest') return this.recentGroupRank(b.charts) - this.recentGroupRank(a.charts);
      if (this.sortOption === 'most-charts') return b.charts.length - a.charts.length;
      return 0;
    });
    this.groupOrder = sorted.map(g => g.category);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.categoryOpen = false;
    this.sortOpen = false;
    this.addModalCategoryOpen = false;
    this.chartTypeMenuOpenId = null;
  }

  setTab(id: TabId): void {
    this.activeTab = id;
    // Recently-viewed can change while this reused route stays alive; refresh on demand.
    if (id === 'recent') this.loadCharts();
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    if (mode !== 'chart') {
      this.cardChartType = {};
      this.cardTabMode = {};
      const visibleGroups = this.visibleChartGroups;
      if (visibleGroups.length && !visibleGroups.some(group => group.expanded)) {
        this.toggleGroup(visibleGroups[0]);
      }
    }
  }

  // Chart type selector per card in chart view mode. Options are computed per chart (same group as the
  // Chart Details page) in loadCharts(); 'table' is offered via the separate Table tab, not this dropdown.
  cardChartTypeOptions: Record<string, ChartView[]> = {};
  cardChartType: Record<string, string> = {};
  cardTabMode: Record<string, 'chart' | 'table'> = {};
  chartTypeMenuOpenId: string | null = null;

  setCardTab(id: string, tab: 'chart' | 'table', event: Event): void {
    event.stopPropagation();
    this.cardTabMode[id] = tab;
    this.chartTypeMenuOpenId = null;
    this.cdr.markForCheck();
  }

  toggleChartTypeMenu(id: string, event: Event): void {
    event.stopPropagation();
    this.chartTypeMenuOpenId = this.chartTypeMenuOpenId === id ? null : id;
    this.openMenuId = null;
    this.cdr.markForCheck();
  }

  selectCardChartType(id: string, type: ChartView, event: Event): void {
    event.stopPropagation();
    this.cardChartType[id] = type;
    this.cardTabMode[id] = 'chart';
    this.chartTypeMenuOpenId = null;
    this.cdr.markForCheck();
  }

  getChartTypeLabel(id: string): string {
    const view = this.cardChartType[id];
    return view ? chartViewLabel(view as ChartView) : 'Chart';
  }

  /** Display label for a chart-type option in the per-card dropdown. */
  typeLabel(view: ChartView): string { return chartViewLabel(view); }

  toggleFavorite(chart: ChartItem): void {
    // Optimistic UI update
    chart.favorite = !chart.favorite;
    this.openMenuId = null;
    // Persist to API
    this.widgetService.toggleFavourite(CHART_CONTROL_TYPE, Number(chart.id)).subscribe({
      next: (pref) => {
        chart.favorite = pref.isFavourite;
        if (pref.isFavourite) { this.favouriteIds.add(Number(chart.id)); }
        else { this.favouriteIds.delete(Number(chart.id)); }
        this.cdr.markForCheck();
      },
      error: () => { chart.favorite = !chart.favorite; this.cdr.markForCheck(); }, // rollback
    });
  }

  toggleMenu(chart: ChartItem): void {
    this.openMenuId = this.openMenuId === chart.id ? null : chart.id;
    this.chartTypeMenuOpenId = null;
  }

  closeMenu(): void {
    this.openMenuId = null;
  }

  editChart(chart: ChartItem): void {
    this.closeMenu();
    this.router.navigate(['/charts-tiles/edit', chart.id]);
  }

  cloneChart(chart: ChartItem): void {
    this.closeMenu();
    const chartId = Number(chart.id);
    if (this.mode !== 'wip' || !this.canCreate || !Number.isSafeInteger(chartId) || chartId <= 0 || this.cloningChartIds.has(chart.id)) return;
    this.notify.clearError();
    this.notify.clearSuccess();
    this.cloningChartIds.add(chart.id);
    this.widgetService.cloneChart(chartId).pipe(
      finalize(() => {
        this.cloningChartIds.delete(chart.id);
        this.cdr.markForCheck();
      }),
    ).subscribe({
      next: (created) => {
        this.notify.showSuccess(`'${created.name}' has been added to ${this.pageTitle}.`);
        this.loadCharts();
      },
      error: (error) => this.notify.showError(error?.error?.error || error?.error?.message || error?.message || 'Failed to clone chart.'),
    });
  }

  // ─── Publish ───────────────────────────────────────────────────────────────
  showPublishConfirm = false;
  pendingPublishChart: ChartItem | null = null;
  publishConfirmBusy = false;

  /** Opens the "Publish chart?" confirmation instead of publishing immediately. */
  publishChart(chart: ChartItem): void {
    this.closeMenu();
    if (!chart.widget) return;
    this.pendingPublishChart = chart;
    this.showPublishConfirm = true;
    this.cdr.markForCheck();
  }

  cancelPublishChart(): void {
    this.showPublishConfirm = false;
    this.pendingPublishChart = null;
    this.cdr.markForCheck();
  }

  /** Runs the actual publish call after the user confirms in the modal. */
  confirmPublishChart(): void {
    const chart = this.pendingPublishChart;
    const w = chart?.widget;
    if (!chart || !w || this.publishConfirmBusy) return;
    this.publishConfirmBusy = true;
    this.widgetService.updateWidget(Number(chart.id), {
      name: w.name, type: w.type, libraryId: w.libraryId ?? 0,
      source: w.source ?? '', sourceType: w.sourceType ?? 'Table',
      sourceId: w.sourceId ?? null, description: w.description ?? '',
      designJson: w.designJson ?? '', categoryId: w.categoryId ?? 2, status: 'published',
    }).subscribe({
        next: () => {
          this.publishConfirmBusy = false;
          this.showPublishConfirm = false;
          this.pendingPublishChart = null;
          this.notify.showSuccess(`'${chart.title}' published successfully.`);
          this.loadCharts();
        },
        error: () => {
          this.publishConfirmBusy = false;
          this.showPublishConfirm = false;
          this.pendingPublishChart = null;
          this.notify.showError(`Failed to publish '${chart.title}'.`);
          this.cdr.markForCheck();
        },
      });
  }

  completeChart(chart: ChartItem): void {
    this.closeMenu();
    const w = chart.widget;
    if (!w) return;
    this.widgetService.updateWidget(Number(chart.id), {
      name: w.name, type: w.type, libraryId: w.libraryId,
      source: w.source, sourceType: w.sourceType,
      sourceId: w.sourceId ?? null, description: w.description,
      designJson: w.designJson, categoryId: w.categoryId, status: 'completed',
    }).subscribe({
        next: () => {
          this.notify.showSuccess(`'${chart.title}' marked as completed.`);
          this.loadCharts();
        },
        error: () => this.notify.showError(`Failed to mark '${chart.title}' as completed.`),
      });
  }

  moveToDraft(chart: ChartItem): void {
    this.closeMenu();
    const w = chart.widget;
    if (!w) return;
    this.widgetService.updateWidget(Number(chart.id), {
      name: w.name, type: w.type, libraryId: w.libraryId,
      source: w.source, sourceType: w.sourceType,
      sourceId: w.sourceId ?? null, description: w.description,
      designJson: w.designJson, categoryId: w.categoryId, status: 'draft',
    }).subscribe({
      next: () => {
        this.notify.showSuccess(`'${chart.title}' moved to Draft.`);
        this.loadCharts();
      },
      error: () => this.notify.showError(`Failed to move '${chart.title}' to Draft.`),
    });
  }

  showDeleteConfirmId: string | null = null;

  confirmDeleteChart(chart: ChartItem): void {
    this.closeMenu();
    this.showDeleteConfirmId = chart.id;
  }

  cancelDelete(): void { this.showDeleteConfirmId = null; }

  executeDelete(): void {
    if (!this.showDeleteConfirmId) return;
    const id = Number(this.showDeleteConfirmId);
    this.showDeleteConfirmId = null;
    this.widgetService.deleteWidget(id)
      .subscribe({
        next: () => {
          this.notify.showSuccess('Chart deleted successfully.');
          this.loadCharts();
        },
        error: () => this.notify.showError('Failed to delete chart.'),
      });
  }

  get canContinueToBuilder(): boolean {
    return !!this.newChartCategoryId && !!this.newChartName.trim() && !!this.newChartDescription.trim();
  }

  onCategoryChange(categoryId: number): void {
    const cat = this.apiCategories.find(c => c.categoryId === Number(categoryId));
    this.newChartCategory = cat?.categoryName ?? '';
  }

  openAddChartModal(): void {
    this.newChartCategory = '';
    this.newChartCategoryId = 0;
    this.newChartName = '';
    this.newChartDescription = '';
    this.showNameSuggestions = false;
    this.showAddChartModal = true;
  }

  closeAddChartModal(): void {
    this.showAddChartModal = false;
  }

  onNameInputBlur(): void {
    // Delay so a suggestion's (mousedown) can still register before the list unmounts.
    setTimeout(() => (this.showNameSuggestions = false), 150);
  }

  selectNameSuggestion(name: string): void {
    this.newChartName = name;
    this.showNameSuggestions = false;
  }

  continueToBuilder(): void {
    if (!this.canContinueToBuilder) return;
    this.closeAddChartModal();
    this.router.navigate(['/charts-tiles/builder'], {
      queryParams: { name: this.newChartName, description: this.newChartDescription, category: this.newChartCategory, categoryId: this.newChartCategoryId },
    });
  }

  // Computed once and reused by reference — passing a freshly-built options
  // object on every change-detection pass would make highcharts-angular think
  // the options changed and redraw the chart on every check.
  readonly donutChartOptions: Highcharts.Options = {
    chart: { type: 'pie', backgroundColor: 'transparent', height: 280 },
    title: { text: undefined },
    credits: { enabled: false },
    tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
    legend: {
      enabled: true,
      layout: 'horizontal',
      align: 'center',
      verticalAlign: 'bottom',
      squareSymbol: false,
      symbolRadius: 4,
      symbolWidth: 8,
      symbolHeight: 8,
      itemDistance: 10,
      itemStyle: { fontSize: '10px', fontWeight: '500', color: '#667085', cursor: 'pointer' },
      itemHoverStyle: { color: '#344054' },
      margin: 4,
    },
    plotOptions: {
      pie: {
        innerSize: '55%',
        borderWidth: 2,
        borderColor: '#fff',
        dataLabels: {
          enabled: true,
          distance: -28,
          format: '{point.y}',
          style: { color: '#fff', fontWeight: '700', fontSize: '12px', textOutline: 'none' },
        },
      },
    },
    series: [
      {
        type: 'pie',
        name: 'Value',
        showInLegend: true,
        data: GROUP_LABELS.map((name, i) => ({ name, y: GROUP_VALUES[i], color: GROUP_COLORS[i] })).filter(d => d.y !== 0),
      },
    ],
  };

  readonly barChartOptions: Highcharts.Options = {
    chart: { type: 'column', backgroundColor: 'transparent', height: 220 },
    title: { text: undefined },
    credits: { enabled: false },
    legend: { enabled: false },
    xAxis: { categories: GROUP_LABELS, labels: { style: { fontSize: '11px', color: '#667085' } }, lineColor: '#E7ECF3' },
    yAxis: { title: { text: undefined }, gridLineColor: '#F1F3F6' },
    tooltip: { pointFormat: '<b>{point.y}</b>' },
    plotOptions: {
      column: {
        borderRadius: 4,
        borderWidth: 0,
        colorByPoint: true,
        colors: GROUP_COLORS,
        dataLabels: { enabled: true, style: { fontSize: '11px', fontWeight: '600' } },
      },
    },
    series: [{ type: 'column', name: 'Value', data: GROUP_VALUES, showInLegend: false }],
  };

  chartOptions(chart: ChartItem): Highcharts.Options {
    return chart.visual === 'donut' ? this.donutChartOptions : this.barChartOptions;
  }

  chartPreviewImage(chart: ChartItem): string {
    return chart.previewImage ?? CHART_PREVIEW_BY_ACCENT[chart.accent];
  }

  private relativeTime(dateStr: string): string {
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  }

  private static readonly DRAG_THRESHOLD_PX = 6;
  private dragState: { el: HTMLElement; pointerId: number; startX: number; startScrollLeft: number; dragging: boolean } | null = null;

  onCardsPointerDown(event: PointerEvent, el: HTMLElement): void {
    this.dragState = { el, pointerId: event.pointerId, startX: event.clientX, startScrollLeft: el.scrollLeft, dragging: false };
  }

  onCardsPointerMove(event: PointerEvent): void {
    if (!this.dragState) return;
    const dx = event.clientX - this.dragState.startX;
    if (!this.dragState.dragging) {
      if (Math.abs(dx) < WipChartsComponent.DRAG_THRESHOLD_PX) return;
      this.dragState.dragging = true;
      this.dragState.el.setPointerCapture(this.dragState.pointerId);
      this.dragState.el.classList.add('dragging');
    }
    this.dragState.el.scrollLeft = this.dragState.startScrollLeft - dx;
  }

  onCardsPointerUp(): void {
    if (!this.dragState) return;
    this.dragState.el.classList.remove('dragging');
    this.dragState = null;
  }

  scrollCards(el: HTMLElement, direction: 1 | -1): void {
    el.scrollBy({ left: direction * 300, behavior: 'smooth' });
  }

  // Fades/disables a nav arrow once the row can't scroll further in that direction.
  canScrollLeft(el: HTMLElement | null): boolean {
    return !!el && el.scrollLeft > 1;
  }

  canScrollRight(el: HTMLElement | null): boolean {
    return !!el && el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
  }
}
