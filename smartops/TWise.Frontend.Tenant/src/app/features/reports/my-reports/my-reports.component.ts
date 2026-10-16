import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, forkJoin, of, Subscription } from 'rxjs';
import { CategoryService } from '../../../core/services/category.service';
import { CategoryDropdown } from '../../../core/models/category.model';
import { TenantReportsService, TenantReportDto } from '../../../core/services/tenant-reports.service';
import { NotificationHelper } from '../../../core/helpers/notification.helper';
import { AuthService } from '../../../core/services/auth.service';
import { WidgetService } from '../../../core/services/widget.service';
import { PermissionService } from '../../../core/services/permission.service';
import { collapseGroupsOnReenter } from '../../../core/utils/collapse-groups-on-reenter';
import { reloadListOnReenter } from '../../../core/utils/reload-list-on-reenter';

type ReportAccent = 'purple' | 'blue' | 'green' | 'orange' | 'coral';

export interface ReportCard {
  id: number;
  categoryId: number;
  title: string;
  description: string;
  category: string;
  source: string;
  sourceType: string;
  status: string;
  modifiedLabel: string;
  modifiedDate: string;
  accent: ReportAccent;
  favorite: boolean;
  recentlyViewed: boolean;
}

export interface ReportGroup {
  id: string;
  label: string;
  icon: 'wells' | 'daily-plan' | 'crew' | 'monitoring';
  subtitle?: string;
  expanded: boolean;
  reports: ReportCard[];
}

type TabId = 'all' | 'favorites' | 'recent' | 'draft' | 'completed';
type ViewMode = 'grid' | 'list';
type SortOption = 'default' | 'newest' | 'oldest' | 'name-az' | 'name-za' | 'most-charts';

@Component({
  selector: 'app-my-reports',
  standalone: false,
  templateUrl: './my-reports.component.html',
  styleUrls: ['./my-reports.component.scss'],
})
export class MyReportsComponent implements OnInit, OnDestroy {
  constructor(
    private readonly router: Router,
    private readonly categoryService: CategoryService,
    private readonly tenantReports: TenantReportsService,
    private readonly cdr: ChangeDetectorRef,
    private readonly authService: AuthService,
    private readonly widgetService: WidgetService,
    private readonly permissionService: PermissionService,
  ) {
    this.notify = new NotificationHelper(cdr);
  }

  get canCreate(): boolean { return this.permissionService.canCreate('reports.my-reports'); }
  get canManageCategories(): boolean { return this.permissionService.canView('reports.categories'); }
  get canModify(): boolean { return this.permissionService.canModify('reports.my-reports'); }
  get canAdmin(): boolean { return this.permissionService.canAdmin('reports.my-reports'); }

  private readonly notify: NotificationHelper;
  isAdmin = false;

  get pageSubtitle(): string {
    return this.isAdmin ? 'Manage work in progress Reports' : 'Create, View and Manage your Reports';
  }

  get successMessage(): string { return this.notify.successMessage; }
  get error(): string { return this.notify.error; }
  get infoMessage(): string { return this.notify.infoMessage; }

  showCategoryManager = false;
  showAddReportModal = false;
  newReportCategory = '';
  newReportCategoryId = 0;
  newReportName = '';
  newReportDescription = '';
  apiCategories: CategoryDropdown[] = [];
  /** Recency order of viewed report ids, most-recent first */
  private recentOrder: string[] = [];
  addModalCategoryOpen = false;

  toggleAddModalCategory(event: Event): void {
    event.stopPropagation();
    this.addModalCategoryOpen = !this.addModalCategoryOpen;
  }

  selectAddModalCategory(categoryId: number, categoryName: string): void {
    this.newReportCategoryId = categoryId;
    this.newReportCategory = categoryName;
    this.addModalCategoryOpen = false;
  }
  isLoading = true;
  groups: ReportGroup[] = [];
  private readonly subs: Subscription[] = [];

  private static readonly ACCENTS: ReportAccent[] = ['purple', 'blue', 'green', 'orange', 'coral'];
  private static readonly GROUP_ICONS: Array<'wells' | 'daily-plan' | 'crew' | 'monitoring'> = ['wells', 'daily-plan', 'crew', 'monitoring'];
  private static readonly GROUP_SUBTITLE = 'Build reports to analyze performance, operational data, and key insights.';

  ngOnInit(): void {
    const user = this.authService.getCurrentUser();
    this.isAdmin = user?.role?.toLowerCase() === 'admin';
    this.subs.push(
      collapseGroupsOnReenter(this.router, ['my-reports'], () => this.groups, () => this.cdr.markForCheck(), () => {
        this.searchTerm = '';
        this.sortOption = 'default';
        this.categoryFilter = [];
        this.categoryOpen = false;
        this.sortOpen = false;
        // Reset to the "All" tab too, so a report just created (always a draft) is visible on
        // return instead of being hidden behind a previously selected tab such as Completed.
        this.activeTab = 'all';
        this.computeGroupOrder();
        this.cdr.markForCheck();
      }),
      // Kept alive by ListRouteReuseStrategy, so re-fetch on every re-entry so a report created or
      // status-changed elsewhere (e.g. a published report copied back to draft) shows without a
      // hard refresh.
      reloadListOnReenter(this.router, ['my-reports'], () => this.reloadReports()),
      this.categoryService.getCategoriesByType('report').subscribe({
        next: (cats) => {
          this.apiCategories = cats;
          this.groups.forEach(g => { g.subtitle = cats.find(c => c.categoryName === g.label)?.description || MyReportsComponent.GROUP_SUBTITLE; });
          this.cdr.markForCheck();
        },
      }),
    );
    this.loadReports(true);
  }

  /**
   * Loads the user's draft + completed reports and re-applies favourite / recently-viewed flags.
   * Used for both the initial load and every re-entry reload so the listing is always complete.
   */
  private loadReports(initial: boolean): void {
    this.subs.push(forkJoin({
      drafts: this.tenantReports.getAll('draft'),
      completed: this.tenantReports.getAll('completed'),
      favourites: this.widgetService.getFavourites(4).pipe(catchError(() => of([]))),
      recentlyViewed: this.widgetService.getRecentlyViewed(4).pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ drafts, completed, favourites, recentlyViewed }) => {
        this.groups = this.mapToGroups([...drafts, ...completed]);
        this.recentOrder = recentlyViewed.map(r => String(r.controlId));
        const favIds = new Set(favourites.filter(f => f.isFavourite).map(f => String(f.controlId)));
        const recentIds = new Set(this.recentOrder);
        this.groups.forEach(g => g.reports.forEach(r => {
          if (favIds.has(String(r.id))) r.favorite = true;
          if (recentIds.has(String(r.id))) r.recentlyViewed = true;
        }));
        this.computeGroupOrder();
        this.isLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoading = false;
        if (!initial) this.notify.showError(err?.error?.message || err?.message || 'Failed to reload reports.');
        this.cdr.markForCheck();
      },
    }));
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.notify.destroy();
  }

  private mapToGroups(reports: TenantReportDto[]): ReportGroup[] {
    const grouped = new Map<string, TenantReportDto[]>();
    for (const r of reports) {
      const cat = r.categoryName || 'Uncategorized';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(r);
    }
    return Array.from(grouped.entries()).map(([label, items], gi) => {
      const icon = MyReportsComponent.GROUP_ICONS[gi % MyReportsComponent.GROUP_ICONS.length];
      return {
        id: `cat-${gi}`,
        label,
        icon,
        subtitle: this.apiCategories.find(c => c.categoryName === label)?.description || MyReportsComponent.GROUP_SUBTITLE,
        expanded: false,
        reports: items.map((r, ri) => this.mapToCard(r, ri)),
      };
    });
  }

  private mapToCard(r: TenantReportDto, index: number): ReportCard {
    return {
      id: r.id,
      categoryId: r.categoryId,
      title: r.reportName,
      description: `Source: ${r.sourceName} (${r.sourceType})`,
      category: r.categoryName || 'Uncategorized',
      source: r.sourceName,
      sourceType: r.sourceType,
      status: r.status,
      modifiedLabel: this.formatRelativeTime(r.updatedAt),
      modifiedDate: r.updatedAt || '',
      accent: MyReportsComponent.ACCENTS[index % MyReportsComponent.ACCENTS.length],
      favorite: false,
      recentlyViewed: false,
    };
  }

  private formatRelativeTime(iso: string | null | undefined): string {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  get allReports(): ReportCard[] {
    return this.groups.flatMap(g => g.reports);
  }

  // ─── Add Report Modal ────────────────────────────────────────────────────

  get canContinueToBuilder(): boolean {
    return !!this.newReportCategoryId && !!this.newReportName.trim() && !!this.newReportDescription.trim();
  }

  openAddReportModal(): void {
    this.newReportCategory = '';
    this.newReportCategoryId = 0;
    this.newReportName = '';
    this.newReportDescription = '';
    this.addModalCategoryOpen = false;
    this.showAddReportModal = true;
  }

  closeAddReportModal(): void {
    this.showAddReportModal = false;
  }

  continueToBuilder(): void {
    if (!this.canContinueToBuilder) return;
    this.closeAddReportModal();
    this.router.navigate(['/reports/builder'], {
      queryParams: {
        name: this.newReportName.trim(),
        category: this.newReportCategory,
        categoryId: this.newReportCategoryId,
        description: this.newReportDescription.trim(),
      },
    });
  }

  activeTab: TabId = 'all';
  viewMode: ViewMode = 'grid';
  sortOption: SortOption = 'default';
  categoryFilter: string[] = [];
  searchTerm = '';
  categoryOpen = false;
  sortOpen = false;

  private _cachedTabs: { id: TabId; label: string; count: number }[] = [];
  private _cachedTabsGroupsRef: ReportGroup[] | null = null;

  get tabs(): { id: TabId; label: string; count: number }[] {
    // Recompute only when groups array reference changes
    if (this._cachedTabsGroupsRef !== this.groups) {
      this._cachedTabsGroupsRef = this.groups;
      const all = this.allReports;
      this._cachedTabs = [
        { id: 'all', label: 'All', count: all.length },
        { id: 'favorites', label: 'Favorites', count: all.filter(r => r.favorite).length },
        { id: 'recent', label: 'Recent', count: all.filter(r => r.recentlyViewed).length },
        { id: 'draft', label: 'Draft', count: all.filter(r => r.status === 'draft').length },
        { id: 'completed', label: 'Completed', count: all.filter(r => r.status === 'completed').length },
      ];
    }
    return this._cachedTabs;
  }

  get categoryOptions(): { value: string; label: string }[] {
    if (this.apiCategories.length > 0) {
      return this.apiCategories.map(c => ({ value: c.categoryName, label: c.categoryName }));
    }
    return [...new Set(this.allReports.map(r => r.category))].map(c => ({ value: c, label: c }));
  }

  get visibleGroups(): ReportGroup[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.groups
      .map(group => {
        let reports = group.reports
          .filter(r => this.activeTab === 'all'
            || (this.activeTab === 'favorites' && r.favorite)
            || (this.activeTab === 'recent' && r.recentlyViewed)
            || (this.activeTab === 'draft' && r.status === 'draft')
            || (this.activeTab === 'completed' && r.status === 'completed'))
          .filter(r => this.categoryFilter.length === 0 || this.categoryFilter.includes(r.category))
          .filter(r => !term || r.title.toLowerCase().includes(term));
        if (this.sortOption === 'name-az') {
          reports = [...reports].sort((a, b) => a.title.localeCompare(b.title));
        } else if (this.sortOption === 'name-za') {
          reports = [...reports].sort((a, b) => b.title.localeCompare(a.title));
        } else if (this.sortOption === 'newest') {
          reports = [...reports].sort((a, b) => (b.modifiedDate || '').localeCompare(a.modifiedDate || ''));
        } else if (this.sortOption === 'oldest') {
          reports = [...reports].sort((a, b) => (a.modifiedDate || '').localeCompare(b.modifiedDate || ''));
        }
        return { ...group, reports };
      })
      .filter(group => group.reports.length > 0)
      .sort((a, b) => {
        if (this.activeTab === 'recent' && this.sortOption === 'default') return this.recentGroupRank(a.reports) - this.recentGroupRank(b.reports);
        const rank = (id: string) => { const i = this.groupOrder.indexOf(id); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
        return rank(a.id) - rank(b.id);
      });
  }

  /** Lowest recency index among a group's items; groups with no recently-viewed items sort last. */
  private recentGroupRank(items: { id: number }[]): number {
    let best = Number.MAX_SAFE_INTEGER;
    for (const item of items) {
      const idx = this.recentOrder.indexOf(String(item.id));
      if (idx !== -1 && idx < best) best = idx;
    }
    return best;
  }

  trackByGroup(_index: number, group: ReportGroup): string {
    return group.id;
  }

  trackByReport(_index: number, report: ReportCard): number {
    return report.id;
  }

  private static readonly DRAG_THRESHOLD_PX = 4;
  private dragState: { el: HTMLElement; pointerId: number; startX: number; startScrollLeft: number; dragging: boolean } | null = null;

  onCardsPointerDown(event: PointerEvent, el: HTMLElement): void {
    this.dragState = { el, pointerId: event.pointerId, startX: event.clientX, startScrollLeft: el.scrollLeft, dragging: false };
  }

  onCardsPointerMove(event: PointerEvent): void {
    if (!this.dragState) return;
    const dx = event.clientX - this.dragState.startX;
    if (!this.dragState.dragging) {
      if (Math.abs(dx) < MyReportsComponent.DRAG_THRESHOLD_PX) return;
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

  toggleGroup(group: ReportGroup): void {
    const source = this.groups.find(g => g.id === group.id);
    if (!source) return;
    const wasExpanded = source.expanded;
    // Accordion: collapse every category, then expand the clicked one only if it was closed —
    // only one category stays open at a time (matches WIP charts/tiles and dashboards).
    this.groups.forEach(g => { g.expanded = false; });
    source.expanded = !wasExpanded;
    // Collapsing categories hides their rows, so dismiss any open row menu that's no longer visible.
    if (this.openMenuId != null && (!source.expanded || !source.reports.some(r => r.id === this.openMenuId))) {
      this.closeMenu();
    }
  }

  readonly sortItems: { value: SortOption; label: string; icon: string }[] = [
    { value: 'default', label: 'Default',     icon: 'default' },
    { value: 'newest',  label: 'Newest First', icon: 'newest' },
    { value: 'oldest',  label: 'Oldest First', icon: 'oldest' },
    { value: 'name-az', label: 'Name A-Z', icon: 'name-az' },
    { value: 'name-za', label: 'Name Z-A', icon: 'name-za' },
    { value: 'most-charts', label: 'Most Reports', icon: 'most-charts' },
  ];

  get sortButtonLabel(): string {
    if (this.sortOption === 'default') return 'Sort';
    return this.sortItems.find(i => i.value === this.sortOption)?.label ?? 'Sort';
  }

  setTab(id: TabId): void {
    this.activeTab = id;
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    const visibleGroups = this.visibleGroups;
    if (visibleGroups.length && !visibleGroups.some(group => group.expanded)) {
      this.toggleGroup(visibleGroups[0]);
    }
  }

  toggleFavorite(report: ReportCard): void {
    const prev = report.favorite;
    report.favorite = !prev;
    this._cachedTabsGroupsRef = null;
    this.widgetService.toggleFavourite(4, Number(report.id)).subscribe({
      next: (res) => {
        report.favorite = res.isFavourite;
        this._cachedTabsGroupsRef = null;
        this.cdr.markForCheck();
      },
      error: () => {
        report.favorite = prev;
        this._cachedTabsGroupsRef = null;
        this.cdr.markForCheck();
      },
    });
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
      if (this.sortOption === 'newest') return this.groupMaxModified(b.reports).localeCompare(this.groupMaxModified(a.reports));
      if (this.sortOption === 'oldest') return this.groupMaxModified(a.reports).localeCompare(this.groupMaxModified(b.reports));
      if (this.sortOption === 'most-charts') return b.reports.length - a.reports.length;
      return 0;
    });
    this.groupOrder = sorted.map(g => g.id);
  }

  /** Latest modifiedDate among a group's reports, for group-level Newest/Oldest sort. */
  private groupMaxModified(reports: { modifiedDate?: string }[]): string {
    return reports.reduce((max, r) => (r.modifiedDate || '') > max ? (r.modifiedDate || '') : max, '');
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.categoryOpen = false;
    this.sortOpen = false;
    this.addModalCategoryOpen = false;
  }

  // ─── Delete Report ───────────────────────────────────────────────────────────

  showDeleteConfirm = false;
  deletingReport: ReportCard | null = null;

  confirmDelete(report: ReportCard): void {
    this.deletingReport = report;
    this.showDeleteConfirm = true;
  }

  cancelDelete(): void {
    this.showDeleteConfirm = false;
    this.deletingReport = null;
  }

  deleteReport(): void {
    if (!this.deletingReport) return;
    const reportName = this.deletingReport.title;
    this.subs.push(this.tenantReports.delete(this.deletingReport.id).subscribe({
      next: () => {
        this.showDeleteConfirm = false;
        this.deletingReport = null;
        this.notify.showSuccess(`'${reportName}' deleted successfully.`);
        this.reloadReports();
      },
      error: (err) => {
        this.showDeleteConfirm = false;
        this.deletingReport = null;
        this.notify.showError(err?.error?.message || err?.message || 'Failed to delete report.');
      },
    }));
  }

  // ─── View / Edit / Publish Report ──────────────────────────────────────────

  viewReport(report: ReportCard): void {
    this.widgetService.trackView(4, report.id).subscribe({ error: () => {} });
    report.recentlyViewed = true;
    this._cachedTabsGroupsRef = null;
    this.router.navigate(['/reports/view', report.id], { queryParams: { from: 'wip' } });
  }

  openMenuId: number | null = null;

  toggleMenu(report: ReportCard): void {
    this.openMenuId = this.openMenuId === report.id ? null : report.id;
  }

  closeMenu(): void { this.openMenuId = null; }

  markReportAsCompleted(report: ReportCard): void {
    this.closeMenu();
    this.notify.showInfo('Processing your request… please wait');
    this.tenantReports.update(report.id, {
      reportName: report.title, categoryId: report.categoryId,
      sourceName: report.source, sourceType: report.sourceType, status: 'completed',
    }).subscribe({
      next: () => {
        this.notify.clearInfo();
        this.notify.showSuccess(`'${report.title}' marked as completed.`);
        this.reloadReports();
      },
      error: (err) => {
        this.notify.clearInfo();
        this.notify.showError(err?.error?.message || err?.message || 'Failed to complete report.');
      },
    });
  }

  moveReportToDraft(report: ReportCard): void {
    this.closeMenu();
    this.notify.showInfo('Processing your request… please wait');
    this.tenantReports.update(report.id, {
      reportName: report.title, categoryId: report.categoryId,
      sourceName: report.source, sourceType: report.sourceType, status: 'draft',
    }).subscribe({
      next: () => {
        this.notify.clearInfo();
        this.notify.showSuccess(`'${report.title}' moved to draft.`);
        this.reloadReports();
      },
      error: (err) => {
        this.notify.clearInfo();
        this.notify.showError(err?.error?.message || err?.message || 'Failed to move report to draft.');
      },
    });
  }

  editReport(report: ReportCard): void {
    this.router.navigate(['/reports/builder'], {
      queryParams: { id: report.id, name: report.title, category: report.category },
    });
  }

  // ─── Publish confirmation ───────────────────────────────────────────────────
  showPublishConfirm = false;
  pendingPublishReport: ReportCard | null = null;
  publishConfirmBusy = false;

  /** Opens the "Publish report?" confirmation instead of publishing immediately. */
  publishReport(report: ReportCard): void {
    this.pendingPublishReport = report;
    this.showPublishConfirm = true;
    this.cdr.markForCheck();
  }

  cancelPublishReport(): void {
    this.showPublishConfirm = false;
    this.pendingPublishReport = null;
    this.cdr.markForCheck();
  }

  /** Runs the actual publish call after the user confirms in the modal. */
  confirmPublishReport(): void {
    const report = this.pendingPublishReport;
    if (!report || this.publishConfirmBusy) return;
    this.publishConfirmBusy = true;
    this.notify.showInfo('Processing your request… please wait');
    this.subs.push(this.tenantReports.update(report.id, {
      reportName: report.title,
      categoryId: report.categoryId,
      sourceName: report.source,
      sourceType: report.sourceType,
      status: 'published',
    }).subscribe({
      next: () => {
        this.publishConfirmBusy = false;
        this.showPublishConfirm = false;
        this.pendingPublishReport = null;
        this.notify.clearInfo();
        this.notify.showSuccess(`'${report.title}' published successfully.`);
        this.reloadReports();
      },
      error: (err) => {
        this.publishConfirmBusy = false;
        this.showPublishConfirm = false;
        this.pendingPublishReport = null;
        this.notify.clearInfo();
        this.notify.showError(err?.error?.message || err?.message || 'Failed to publish report.');
        this.cdr.markForCheck();
      },
    }));
  }

  // ─── Reload ──────────────────────────────────────────────────────────────────

  private reloadReports(): void {
    this.loadReports(false);
  }

  onCategoryManagerClosed(): void {
    this.showCategoryManager = false;
    this.categoryService.getCategoriesByType('report').subscribe(cats => {
      this.apiCategories = cats;
      this.groups.forEach(g => { g.subtitle = cats.find(c => c.categoryName === g.label)?.description || MyReportsComponent.GROUP_SUBTITLE; });
      this.cdr.markForCheck();
    });
  }
}
