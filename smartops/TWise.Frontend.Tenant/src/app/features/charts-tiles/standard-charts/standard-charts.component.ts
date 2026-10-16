import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription, switchMap } from 'rxjs';
import type Highcharts from 'highcharts';
import { CategoryService } from '../../../core/services/category.service';
import { CategoryDropdown } from '../../../core/models/category.model';
import { WidgetService, Widget, UserPreferenceDto } from '../../../core/services/widget.service';
import { NotificationHelper } from '../../../core/helpers/notification.helper';
import { ToastService } from '../../../core/services/toast.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ListRouteReuseStrategy } from '../../../core/services/list-route-reuse.strategy';
import { CHART_AUTO_COLORS } from '../../../core/utils/chart-color.util';
import { collapseGroupsOnReenter } from '../../../core/utils/collapse-groups-on-reenter';
import { reloadListOnReenter } from '../../../core/utils/reload-list-on-reenter';


export type ChartAccent = 'purple' | 'blue' | 'green' | 'orange' | 'coral';
export type ChartVisual = 'donut' | 'bar';

const GROUP_LABELS = ['Group A', 'Group B', 'Group C', 'Group D', 'Group E'];
const GROUP_COLORS = [...CHART_AUTO_COLORS];
const GROUP_VALUES = [88, 57, 94, 51, 68];

const CHART_CONTROL_TYPE = 2;

/** Fallback preview image per accent — same graph-img assets used by Standard Boards */
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
  /** Chart-specific preview image; falls back to accent-based graph-img when absent */
  previewImage?: string;
  widget?: Widget;
}

export interface ChartGroup {
  id: string;
  label: string;
  icon: 'settings' | 'productivity' | 'crew';
  expanded: boolean;
  charts: ChartItem[];
  subtitle?: string;
}

type TabId = 'all' | 'favorites' | 'recent';
type ViewMode = 'grid' | 'list' | 'chart';
type SortOption = 'default' | 'newest' | 'oldest' | 'name-az' | 'name-za' | 'most-charts';

@Component({
  selector: 'app-standard-charts',
  standalone: false,
  templateUrl: './standard-charts.component.html',
  styleUrls: ['./standard-charts.component.scss'],
})
export class StandardChartsComponent implements OnInit, OnDestroy {
  activeTab: TabId = 'all';
  viewMode: ViewMode = 'grid';
  sortOption: SortOption = 'default';
  categoryFilter: string[] = [];
  searchTerm = '';
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

  // Card kebab menu
  openMenuId: string | null = null;

  // Un-publish
  togglingChartId: string | null = null;
  showUnpublishConfirm = false;
  pendingUnpublishChart: ChartItem | null = null;

  // Delete
  showDeleteConfirm = false;
  deletingChart: ChartItem | null = null;

  private readonly notify: NotificationHelper;
  get successMessage(): string { return this.notify.successMessage; }
  get error(): string { return this.notify.error; }

  /** Categories fetched from the backend API. */
  apiCategories: CategoryDropdown[] = [];
  private categorySub!: Subscription;
  private reenterSub!: Subscription;
  private reloadSub!: Subscription;

  get pageTitle(): string { return 'Standard Charts'; }

  private favouriteIds = new Set<number>();
  private recentIds: number[] = [];
  private locallyViewedIds: number[] = [];

  private loadPreferences(): void {
    this.widgetService.getFavourites(CHART_CONTROL_TYPE).subscribe({
      next: (prefs) => {
        this.favouriteIds = new Set(prefs.map((p: UserPreferenceDto) => p.controlId));
        this.groups = this.groups.map(g => ({
          ...g, charts: g.charts.map(c => ({ ...c, favorite: this.favouriteIds.has(Number(c.id)) }))
        }));
        if (!this.groups.some(g => g.expanded)) this.computeGroupOrder();
        this.cdr.markForCheck();
      }, error: () => { /* suppress */ },
    });
    this.widgetService.getRecentlyViewed(CHART_CONTROL_TYPE, 50).subscribe({
      next: (prefs) => {
        this.recentIds = [...new Set([...this.locallyViewedIds, ...prefs.map((p: UserPreferenceDto) => p.controlId)])];
        this.groups = this.groups.map(g => ({
          ...g, charts: g.charts.map(c => ({ ...c, recentlyViewed: this.recentIds.includes(Number(c.id)) }))
        }));
        if (!this.groups.some(g => g.expanded)) this.computeGroupOrder();
        this.cdr.markForCheck();
      }, error: () => { /* suppress */ },
    });
  }

  constructor(
    private readonly categoryService: CategoryService,
    private readonly widgetService: WidgetService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
    private readonly toastService: ToastService,
    private readonly permissionService: PermissionService,
    private readonly listRouteReuse: ListRouteReuseStrategy,
  ) {
    this.notify = new NotificationHelper(cdr);
  }

  get canCreate(): boolean { return this.permissionService.canCreate('charts.standard-charts'); }
  get canCopyToDraft(): boolean { return this.canAdmin && this.permissionService.canView('charts.wip-charts') && this.permissionService.canCreate('charts.wip-charts'); }
  get canModify(): boolean { return this.permissionService.canModify('charts.standard-charts'); }
  get canAdmin(): boolean { return this.permissionService.canAdmin('charts.standard-charts'); }

  // Requests against a local/dev API can resolve in a few ms — too fast for the
  // loader to ever be visible on screen. Holding it up for a minimum stretch
  // keeps it perceptible without meaningfully slowing down real network calls.
  private static readonly MIN_LOADER_MS = 300;

  private stopLoading(startedAt: number): void {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= StandardChartsComponent.MIN_LOADER_MS) {
      this.isLoading = false;
      this.cdr.markForCheck();
    } else {
      setTimeout(() => { this.isLoading = false; this.cdr.markForCheck(); }, StandardChartsComponent.MIN_LOADER_MS - elapsed);
    }
  }

  ngOnInit(): void {
    const pending = this.toastService.consume();
    if (pending) this.notify.showSuccess(pending);
    this.reenterSub = collapseGroupsOnReenter(this.router, ['standard-charts'], () => this.groups, () => this.cdr.markForCheck(), () => {
      this.searchTerm = '';
      this.sortOption = 'default';
      this.categoryFilter = [];
      this.categoryOpen = false;
      this.sortOpen = false;
      this.computeGroupOrder();
      this.cdr.markForCheck();
    });
    this.reloadSub = reloadListOnReenter(this.router, ['standard-charts'], () => this.loadCharts());
    this.categorySub = this.categoryService.getCategoriesByType('chart').subscribe((cats) => {
      this.apiCategories = cats;
    });

    this.loadCharts();
  }

  /** Load published charts from API (type=chart only). Re-runnable so revisiting the route refreshes. */
  private loadCharts(): void {
    const startedAt = Date.now();
    this.widgetService.getWidgets('published', 'chart').subscribe({
      next: (widgets) => {
        if (!widgets?.length) { this.stopLoading(startedAt); return; }
        const accents: ChartAccent[] = ['purple', 'blue', 'green', 'orange', 'coral'];
        // Group by categoryName
        const grouped = new Map<string, ChartItem[]>();
        widgets.forEach((w: Widget, i: number) => {
          let design: { chartType?: string } = {};
          try { design = JSON.parse(w.designJson ?? '{}'); } catch { /* ignore */ }
          const isPieType = ['pie', 'donut'].includes(design.chartType ?? '');
          const accent = accents[i % accents.length];
          const item: ChartItem = {
            id: String(w.id),
            title: w.name,
            description: w.description || `${w.source ?? ''} — ${design.chartType ?? 'chart'}`,
            category: w.categoryName ?? 'Uncategorised',
            visual: isPieType ? 'donut' : 'bar',
            accent,
            favorite: false,
            recentlyViewed: this.recentIds.includes(w.id),
            modifiedLabel: this.relativeTime(w.createdAt),
            previewImage: CHART_PREVIEW_BY_ACCENT[accent],
            widget: w,
          };
          const key = w.categoryName ?? 'Uncategorised';
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(item);
        });

        const icons: ('settings' | 'productivity' | 'crew')[] = ['settings', 'productivity', 'crew'];
        let iconIdx = 0;
        const apiGroups: ChartGroup[] = [];
        for (const [label, charts] of grouped) {
          apiGroups.push({
            id: label.toLowerCase().replace(/\s+/g, '-'),
            label,
            subtitle: this.apiCategories.find(c => c.categoryName === label)?.description,
            icon: icons[iconIdx++ % 3],
            expanded: false,
            charts,
          });
        }
        this.groups = apiGroups;
        this.computeGroupOrder();
        this.stopLoading(startedAt);
        this.loadPreferences();
      },
      error: () => {
        this.stopLoading(startedAt);
        /* keep mock data on error */
      },
    });
  }

  ngOnDestroy(): void {
    this.categorySub?.unsubscribe();
    this.reenterSub?.unsubscribe();
    this.reloadSub?.unsubscribe();
    this.notify.destroy();
  }

  openChart(chart: ChartItem): void {
    const chartId = Number(chart.id);
    chart.recentlyViewed = true;
    this.locallyViewedIds = [chartId, ...this.locallyViewedIds.filter(id => id !== chartId)];
    this.recentIds = [chartId, ...this.recentIds.filter(id => id !== chartId)];
    this.widgetService.trackView(CHART_CONTROL_TYPE, chartId).subscribe({ error: () => {} });
    this.router.navigate(['/charts-tiles/view', chart.id], { queryParams: { type: 'chart', from: 'standard' } });
  }

  groups: ChartGroup[] = [
    {
      id: 'operational-dashboard',
      label: 'Operational Dashboard',
      icon: 'settings',
      expanded: false,
      charts: [
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
          id: 'wells-readiness-overall-status',
          title: 'Wells Readiness Overall Status',
          description: 'Plan vs actual readiness funnel with backlog / acceleration.',
          category: 'Operations',
          visual: 'bar',
          accent: 'blue',
          favorite: false,
          recentlyViewed: true,
          previewImage: 'assets/images/standard-chart1.svg',
        },
        {
          id: 'cluster-operational-health',
          title: 'Cluster Operational Health',
          description: 'Plan vs actual by cluster with critical / at-risk counts.',
          category: 'Operations',
          visual: 'bar',
          accent: 'green',
          favorite: false,
          recentlyViewed: true,
          previewImage: 'assets/images/standard-chart2.svg',
        },
        {
          id: 'well-hookup-progress-overview',
          title: 'Well Hookup Progress Overview',
          description: 'Hook-up plan-to-actual waterfall + completion donut.',
          category: 'Operations',
          visual: 'donut',
          accent: 'orange',
          favorite: true,
          recentlyViewed: false,
          previewImage: 'assets/images/standard-chart3.svg',
        },
      ],
    },
    {
      id: 'productivity',
      label: 'Productivity',
      icon: 'productivity',
      expanded: false,
      charts: [
        {
          id: 'task-completion-rate',
          title: 'Task Completion Rate',
          description: 'Completed vs planned tasks by crew, week over week.',
          category: 'Productivity',
          visual: 'bar',
          accent: 'blue',
          favorite: false,
          recentlyViewed: false,
        },
      ],
    },
    {
      id: 'operational',
      label: 'Operational',
      icon: 'settings',
      expanded: false,
      charts: [
        {
          id: 'active-permits-status',
          title: 'Active Permits Status',
          description: 'Valid PTW/PDO permits by cluster with expiry breakdown.',
          category: 'Operations',
          visual: 'donut',
          accent: 'blue',
          favorite: false,
          recentlyViewed: false,
        },
        {
          id: 'ooc-alerts-trend',
          title: 'OOC Alerts Trend',
          description: 'Out-of-compliance alerts over the last 30 days.',
          category: 'Operations',
          visual: 'bar',
          accent: 'orange',
          favorite: false,
          recentlyViewed: false,
        },
        {
          id: 'well-uptime-summary',
          title: 'Well Uptime Summary',
          description: 'Average uptime % across active wells.',
          category: 'Operations',
          visual: 'donut',
          accent: 'green',
          favorite: true,
          recentlyViewed: false,
        },
        {
          id: 'maintenance-backlog',
          title: 'Maintenance Backlog',
          description: 'Open maintenance tickets by priority.',
          category: 'Operations',
          visual: 'bar',
          accent: 'purple',
          favorite: false,
          recentlyViewed: false,
        },
        {
          id: 'production-variance',
          title: 'Production Variance',
          description: 'Actual vs forecast production by well cluster.',
          category: 'Operations',
          visual: 'bar',
          accent: 'blue',
          favorite: false,
          recentlyViewed: false,
        },
        {
          id: 'penalty-exposure-breakdown',
          title: 'Penalty Exposure Breakdown',
          description: 'Contractual penalty exposure by cause.',
          category: 'Operations',
          visual: 'donut',
          accent: 'orange',
          favorite: false,
          recentlyViewed: false,
        },
      ],
    },
    {
      id: 'crews-and-activities',
      label: 'Crews & Activities',
      icon: 'crew',
      expanded: false,
      charts: [
        {
          id: 'crew-utilization',
          title: 'Crew Utilization',
          description: 'Active vs idle crew hours by shift.',
          category: 'Crew',
          visual: 'bar',
          accent: 'green',
          favorite: false,
          recentlyViewed: false,
        },
        {
          id: 'crew-deployment-map',
          title: 'Crew Deployment Overview',
          description: 'Crew allocation across active sites.',
          category: 'Crew',
          visual: 'donut',
          accent: 'purple',
          favorite: false,
          recentlyViewed: false,
        },
        {
          id: 'training-compliance-rate',
          title: 'Training Compliance Rate',
          description: 'Crew certifications up to date vs expired.',
          category: 'Crew',
          visual: 'donut',
          accent: 'blue',
          favorite: false,
          recentlyViewed: false,
        },
        {
          id: 'safety-incidents-trend',
          title: 'Safety Incidents Trend',
          description: 'Reported incidents over the last 6 months.',
          category: 'Crew',
          visual: 'bar',
          accent: 'orange',
          favorite: false,
          recentlyViewed: false,
        },
        {
          id: 'shift-handover-quality',
          title: 'Shift Handover Quality',
          description: 'Handover checklist completion by crew.',
          category: 'Crew',
          visual: 'bar',
          accent: 'blue',
          favorite: false,
          recentlyViewed: false,
        },
        {
          id: 'crew-performance-scorecard',
          title: 'Crew Performance Scorecard',
          description: 'Composite performance score by crew.',
          category: 'Crew',
          visual: 'donut',
          accent: 'green',
          favorite: false,
          recentlyViewed: false,
        },
      ],
    },
  ];

  get allCharts(): ChartItem[] {
    return this.groups.flatMap(g => g.charts);
  }

  get tabs(): { id: TabId; label: string; count: number }[] {
    return [
      { id: 'all', label: 'All', count: this.allCharts.length },
      { id: 'favorites', label: 'Favorites', count: this.allCharts.filter(c => c.favorite).length },
      { id: 'recent', label: 'Recent', count: this.allCharts.filter(c => c.recentlyViewed).length },
    ];
  }

  get categories(): string[] {
    const apiNames = this.apiCategories.map(c => c.categoryName);
    const chartCats = this.allCharts.map(c => c.category);
    return ['all', ...new Set([...apiNames, ...chartCats])];
  }

  get categoryOptions(): { value: string; label: string }[] {
    return this.apiCategories.map(c => ({ value: c.categoryName, label: c.categoryName }));
  }

  /** Groups filtered by the active tab, search term and category. */
  get visibleGroups(): ChartGroup[] {
    const term = this.searchTerm.trim().toLowerCase();

    return this.groups
      .map(group => {
        let charts = group.charts
          .filter(c => {
            if (this.activeTab === 'all') return true;
            if (this.activeTab === 'favorites') return c.favorite;
            return c.recentlyViewed;
          })
          .filter(c => this.categoryFilter.length === 0 || this.categoryFilter.includes(c.category))
          .filter(c => !term || c.title.toLowerCase().includes(term));

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

        return { ...group, charts };
      })
      .filter(group => group.charts.length > 0)
      .sort((a, b) => {
        if (this.activeTab === 'recent' && this.sortOption === 'default') return this.recentGroupRank(a.charts) - this.recentGroupRank(b.charts);
        const rank = (id: string) => { const i = this.groupOrder.indexOf(id); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
        return rank(a.id) - rank(b.id);
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

  trackByGroup(_index: number, group: ChartGroup): string {
    return group.id;
  }

  trackByChart(_index: number, chart: ChartItem): string {
    return chart.id;
  }

  toggleCategoryDropdown(): void {
    this.categoryOpen = !this.categoryOpen;
    if (this.categoryOpen) this.sortOpen = false;
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
    if (!this.groups.some(g => g.expanded)) this.computeGroupOrder();
  }

  /** Snapshot of category ids in current sortOption order — recomputed only when nothing is expanded. */
  private groupOrder: string[] = [];

  private computeGroupOrder(): void {
    const sorted = [...this.groups].sort((a, b) => {
      if (this.sortOption === 'name-az') return a.label.localeCompare(b.label);
      if (this.sortOption === 'name-za') return b.label.localeCompare(a.label);
      if (this.sortOption === 'newest') return this.recentGroupRank(a.charts) - this.recentGroupRank(b.charts);
      if (this.sortOption === 'oldest') return this.recentGroupRank(b.charts) - this.recentGroupRank(a.charts);
      if (this.sortOption === 'most-charts') return b.charts.length - a.charts.length;
      return 0;
    });
    this.groupOrder = sorted.map(g => g.id);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.categoryOpen = false;
    this.sortOpen = false;
    this.openMenuId = null;
  }

  setTab(id: TabId): void {
    this.activeTab = id;
    // Recently-viewed can change while this reused route stays alive; refresh on demand.
    if (id === 'recent') this.loadCharts();
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    const visibleGroups = this.visibleGroups;
    if (mode !== 'chart' && visibleGroups.length && !visibleGroups.some(group => group.expanded)) {
      this.toggleGroup(visibleGroups[0]);
    }
  }

  toggleGroup(group: ChartGroup): void {
    const source = this.groups.find(g => g.id === group.id);
    if (!source) return;
    const isOpen = source.expanded;
    // accordion: close all groups, then open the clicked one if it was closed
    this.groups.forEach(g => { g.expanded = false; });
    source.expanded = !isOpen;
  }

  toggleFavorite(chart: ChartItem): void {
    chart.favorite = !chart.favorite;
    this.widgetService.toggleFavourite(CHART_CONTROL_TYPE, Number(chart.id)).subscribe({
      next: (pref) => { chart.favorite = pref.isFavourite; this.cdr.markForCheck(); },
      error: () => { chart.favorite = !chart.favorite; this.cdr.markForCheck(); },
    });
  }

  // ─── Card menu ─────────────────────────────────────────────────────────────

  toggleMenu(event: Event, chart: ChartItem): void {
    event.stopPropagation();
    this.openMenuId = this.openMenuId === chart.id ? null : chart.id;
  }

  closeMenu(): void {
    this.openMenuId = null;
  }

  editChart(chart: ChartItem): void {
    this.closeMenu();
    this.router.navigate(['/charts-tiles/edit', chart.id]);
  }

  copyToDraft(chart: ChartItem): void {
    this.closeMenu();
    const numId = Number(chart.id);
    if (Number.isNaN(numId)) return;

    this.widgetService.copyWidgetToDraft(numId).subscribe({
      next: (copy) => {
        this.listRouteReuse.invalidate('wip-charts');
        const name = copy.name ?? chart.title;
        this.notify.showSuccess(`'${name}' has been added to WIP Charts.`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.notify.showError(err?.error?.message || err?.message || 'Failed to copy chart to draft.');
        this.cdr.markForCheck();
      },
    });
  }

  // ─── Un-publish ────────────────────────────────────────────────────────────

  /** Opens the "Unpublish chart?" confirmation instead of unpublishing immediately. */
  unpublishChart(event: Event, chart: ChartItem): void {
    event.stopPropagation();
    this.closeMenu();
    if (this.togglingChartId) return;
    this.pendingUnpublishChart = chart;
    this.showUnpublishConfirm = true;
    this.cdr.markForCheck();
  }

  cancelUnpublishChart(): void {
    this.showUnpublishConfirm = false;
    this.pendingUnpublishChart = null;
    this.cdr.markForCheck();
  }

  /** Runs the actual unpublish call after the user confirms in the modal. */
  confirmUnpublishChart(): void {
    const chart = this.pendingUnpublishChart;
    if (!chart || this.togglingChartId) return;
    this.showUnpublishConfirm = false;

    const id = Number(chart.id);
    this.togglingChartId = chart.id;
    this.widgetService.getWidgetById(id).pipe(
      switchMap((w) => this.widgetService.updateWidget(id, {
        name: w.name,
        description: w.description,
        type: w.type,
        libraryId: w.libraryId,
        source: w.source,
        sourceType: w.sourceType,
        designJson: w.designJson,
        categoryId: w.categoryId,
        status: 'draft',
      })),
    ).subscribe({
      next: () => {
        this.togglingChartId = null;
        this.pendingUnpublishChart = null;
        this.groups = this.groups
          .map(g => ({ ...g, charts: g.charts.filter(c => c.id !== chart.id) }))
          .filter(g => g.charts.length > 0);
        this.notify.showSuccess(`'${chart.title}' unpublished successfully.`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.togglingChartId = null;
        this.pendingUnpublishChart = null;
        this.notify.showError(err?.error?.message || err?.message || 'Failed to unpublish chart.');
        this.cdr.markForCheck();
      },
    });
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  confirmDeleteChart(chart: ChartItem): void {
    this.closeMenu();
    this.deletingChart = chart;
    this.showDeleteConfirm = true;
  }

  cancelDeleteChart(): void {
    this.showDeleteConfirm = false;
    this.deletingChart = null;
  }

  deleteChart(): void {
    if (!this.deletingChart) return;
    const chartId = this.deletingChart.id;
    const chartTitle = this.deletingChart.title;

    this.widgetService.deleteWidget(Number(chartId)).subscribe({
      next: () => {
        this.groups = this.groups
          .map(g => ({ ...g, charts: g.charts.filter(c => c.id !== chartId) }))
          .filter(g => g.charts.length > 0);
        this.showDeleteConfirm = false;
        this.deletingChart = null;
        this.notify.showSuccess(`'${chartTitle}' deleted successfully.`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.notify.showError(err?.error?.message || err?.message || 'Failed to delete chart.');
        this.showDeleteConfirm = false;
        this.deletingChart = null;
        this.cdr.markForCheck();
      },
    });
  }

  // Computed once and reused by reference — passing a freshly-built options
  // object on every change-detection pass would make highcharts-angular think
  // the options changed and redraw the chart on every check.
  readonly donutChartOptions: Highcharts.Options = {
    chart: { type: 'pie', backgroundColor: 'transparent', height: 260 },
    title: { text: undefined },
    credits: { enabled: false },
    tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.1f}%)' },
    legend: {
      enabled: true,
      align: 'center',
      verticalAlign: 'bottom',
      layout: 'horizontal',
      squareSymbol: false,
      symbolRadius: 4,
      symbolHeight: 8,
      symbolWidth: 8,
      itemDistance: 10,
      itemStyle: { fontSize: '10px', fontWeight: '500', color: '#667085' },
      itemMarginTop: 0,
    },
    plotOptions: {
      pie: {
        innerSize: '55%',
        borderWidth: 2,
        borderColor: '#fff',
        showInLegend: true,
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

  /** Returns the specific preview image for this chart, or the accent-based fallback. */
  chartPreviewImage(chart: ChartItem): string {
    return chart.previewImage ?? CHART_PREVIEW_BY_ACCENT[chart.accent];
  }

  private relativeTime(dateStr: string): string {
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if (days === 0) return 'today';
    if (days === 1) return '1d ago';
    return `${days}d ago`;
  }

  private static readonly DRAG_THRESHOLD_PX = 5;

  private dragState: { el: HTMLElement; pointerId: number; startX: number; startScrollLeft: number; dragging: boolean } | null = null;

  onCardsPointerDown(event: PointerEvent, el: HTMLElement): void {
    // Pointer capture is deferred until real movement is seen — capturing on every
    // pointerdown (even a plain click) causes the browser to retarget the follow-up
    // `click` event to `el` instead of the card the user clicked.
    this.dragState = { el, pointerId: event.pointerId, startX: event.clientX, startScrollLeft: el.scrollLeft, dragging: false };
  }

  onCardsPointerMove(event: PointerEvent): void {
    if (!this.dragState) return;
    const dx = event.clientX - this.dragState.startX;

    if (!this.dragState.dragging) {
      if (Math.abs(dx) < StandardChartsComponent.DRAG_THRESHOLD_PX) return;
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
