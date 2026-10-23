import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, forkJoin, of, Subscription } from 'rxjs';
import { TenantReportsService, TenantReportDto } from '../../../core/services/tenant-reports.service';
import { VersionHistoryItem } from '../../../shared/components/version-history/version-history-dialog.component';
import { WidgetService } from '../../../core/services/widget.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { NotificationHelper } from '../../../core/helpers/notification.helper';
import { ListRouteReuseStrategy } from '../../../core/services/list-route-reuse.strategy';
import { CategoryService } from '../../../core/services/category.service';
import { CategoryDropdown } from '../../../core/models/category.model';
import { collapseGroupsOnReenter } from '../../../core/utils/collapse-groups-on-reenter';
import { reloadListOnReenter } from '../../../core/utils/reload-list-on-reenter';

export type ReportAccent = 'purple' | 'blue' | 'green' | 'orange' | 'coral';
export type ReportIcon = 'grid' | 'table' | 'sheet' | 'doc';

export interface Report {
  id: string;
  title: string;
  description: string;
  category: string;
  categoryId: number;
  source: string;
  sourceType: string;
  modifiedLabel: string;
  modifiedDate: string;
  favorite: boolean;
  recentlyViewed: boolean;
  accent: ReportAccent;
  icon: ReportIcon;
  legend?: boolean;
  previewImage?: string;
}

export interface ReportGroup {
  id: string;
  label: string;
  icon: 'wells' | 'daily-plan' | 'crew' | 'monitoring';
  subtitle?: string;
  expanded: boolean;
  reports: Report[];
}

type TabId = 'all' | 'favorites' | 'recent';
type ViewMode = 'grid' | 'list';
type SortOption = 'default' | 'newest' | 'oldest' | 'name-az' | 'name-za' | 'most-charts';

@Component({
  selector: 'app-standard-reports',
  standalone: false,
  templateUrl: './standard-reports.component.html',
  styleUrls: ['./standard-reports.component.scss'],
})
export class StandardReportsComponent implements OnInit, OnDestroy {
  activeTab: TabId = 'all';
  viewMode: ViewMode = 'grid';
  sortOption: SortOption = 'default';
  categoryFilter: string[] = [];
  searchTerm = '';
  categoryOpen = false;
  sortOpen = false;
  isLoading = true;
  error = '';
  private readonly notify: NotificationHelper;
  get successMessage(): string { return this.notify.successMessage; }
  get infoMessage(): string { return this.notify.infoMessage; }

  private readonly subs: Subscription[] = [];
  /** Recency order of viewed report ids, most-recent first */
  private recentOrder: string[] = [];
  private static readonly ACCENTS: ReportAccent[] = ['purple', 'blue', 'green', 'orange', 'coral'];
  private static readonly ICONS: ReportIcon[] = ['grid', 'table', 'sheet', 'doc'];
  private static readonly GROUP_ICONS: Array<'wells' | 'daily-plan' | 'crew' | 'monitoring'> = ['wells', 'daily-plan', 'crew', 'monitoring'];

  private static readonly GROUP_SUBTITLE = 'Review performance, operational data, and business insights.';

  constructor(
    private readonly tenantReports: TenantReportsService,
    private readonly router: Router,
    private readonly widgetService: WidgetService,
    private readonly cdr: ChangeDetectorRef,
    private readonly permissionService: PermissionService,
    private readonly toastService: ToastService,
    private readonly categoryService: CategoryService,
    private readonly listRouteReuse: ListRouteReuseStrategy,
  ) {
    this.notify = new NotificationHelper(cdr);
  }

  get canCreate(): boolean { return this.permissionService.canCreate('reports.standard-reports'); }
  get canCopyToDraft(): boolean { return this.canAdmin && this.permissionService.canView('reports.my-reports') && this.permissionService.canCreate('reports.my-reports'); }
  get canModify(): boolean { return this.permissionService.canModify('reports.standard-reports'); }
  get canAdmin(): boolean { return this.permissionService.canAdmin('reports.standard-reports'); }

  readonly sortItems: { value: SortOption; label: string; icon: string }[] = [
    { value: 'default', label: 'Default',          icon: 'default' },
    { value: 'newest',  label: 'Newest First',  icon: 'newest'  },
    { value: 'oldest',  label: 'Oldest First',  icon: 'oldest'  },
    { value: 'name-az', label: 'Name A-Z',      icon: 'name-az' },
    { value: 'name-za', label: 'Name Z-A',      icon: 'name-za' },
    { value: 'most-charts', label: 'Most Reports', icon: 'most-charts' },
  ];

  get sortButtonLabel(): string {
    if (this.sortOption === 'default') return 'Sort';
    return this.sortItems.find(i => i.value === this.sortOption)?.label ?? 'Sort';
  }

  groups: ReportGroup[] = [];
  apiCategories: CategoryDropdown[] = [];

  ngOnInit(): void {
    this.subs.push(
      collapseGroupsOnReenter(this.router, ['standard-reports'], () => this.groups, () => this.cdr.markForCheck(), () => {
        this.searchTerm = '';
        this.sortOption = 'default';
        this.categoryFilter = [];
        this.categoryOpen = false;
        this.sortOpen = false;
        // Reset to the "All" tab too, so a report just published from WIP is visible on return
        // instead of being hidden behind a previously selected tab such as Favorites or Recent.
        this.activeTab = 'all';
        this.computeGroupOrder();
        this.cdr.markForCheck();
      }),
      // Kept alive by ListRouteReuseStrategy, so re-fetch on every re-entry — otherwise a report
      // published from WIP Reports stays invisible here until the component is finally torn down.
      reloadListOnReenter(this.router, ['standard-reports'], () => this.loadReports()),
    );
    this.loadReports();
  }

  /** Loads the published reports plus favourite / recently-viewed flags and category metadata. */
  private loadReports(): void {
    this.subs.push(
      forkJoin({
        reports: this.tenantReports.getAll('published'),
        favourites: this.widgetService.getFavourites(4).pipe(catchError(() => of([]))),
        recentlyViewed: this.widgetService.getRecentlyViewed(4).pipe(catchError(() => of([]))),
        categories: this.categoryService.getCategoriesByType('report').pipe(catchError(() => of([]))),
      }).subscribe({
        next: ({ reports, favourites, recentlyViewed, categories }) => {
          this.apiCategories = categories;
          this.groups = this.mapToGroups(reports);
          this.recentOrder = recentlyViewed.map(r => String(r.controlId));
          const favIds = new Set(favourites.filter(f => f.isFavourite).map(f => String(f.controlId)));
          const recentIds = new Set(this.recentOrder);
          this.groups.forEach(g => g.reports.forEach(r => {
            if (favIds.has(r.id)) r.favorite = true;
            if (recentIds.has(r.id)) r.recentlyViewed = true;
          }));
          this.computeGroupOrder();
          this.isLoading = false;
          this.cdr.detectChanges();
        },
        error: () => {
          this.isLoading = false;
          this.error = 'Failed to load reports.';
          this.cdr.detectChanges();
        },
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.notify.destroy();
  }

  private mapToGroups(reports: TenantReportDto[]): ReportGroup[] {
    const grouped = new Map<number, TenantReportDto[]>();
    for (const r of reports) {
      if (!grouped.has(r.categoryId)) grouped.set(r.categoryId, []);
      grouped.get(r.categoryId)!.push(r);
    }
    return Array.from(grouped.entries()).map(([categoryId, items], gi) => {
      const icon = StandardReportsComponent.GROUP_ICONS[gi % StandardReportsComponent.GROUP_ICONS.length];
      return {
        id: `cat-${categoryId}`,
        label: items[0].categoryName || 'Uncategorized',
        icon,
        subtitle: items[0].categoryDescription || StandardReportsComponent.GROUP_SUBTITLE,
        expanded: this.groups.find(g => g.id === `cat-${categoryId}`)?.expanded ?? false,
        reports: items.map((r, ri) => this.mapToReport(r, ri)),
      };
    });
  }

  private mapToReport(r: TenantReportDto, index: number): Report {
    return {
      id: String(r.id),
      title: r.reportName,
      description: `Source: ${r.sourceName} (${r.sourceType})`,
      category: r.categoryName || 'Uncategorized',
      categoryId: r.categoryId,
      source: r.sourceName,
      sourceType: r.sourceType,
      modifiedLabel: this.formatRelativeTime(r.updatedAt),
      modifiedDate: r.updatedAt || '',
      favorite: false,
      recentlyViewed: false,
      accent: StandardReportsComponent.ACCENTS[index % StandardReportsComponent.ACCENTS.length],
      icon: StandardReportsComponent.ICONS[index % StandardReportsComponent.ICONS.length],
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

  viewReport(report: Report): void {
    const numId = Number(report.id);
    if (!Number.isNaN(numId)) this.widgetService.trackView(4, numId).subscribe({ error: () => {} });
    report.recentlyViewed = true;
    this.router.navigate(['/reports/view', report.id], { queryParams: { from: 'standard' } });
  }

  openMenuId: string | null = null;

  toggleMenu(report: Report): void {
    this.openMenuId = this.openMenuId === report.id ? null : report.id;
  }

  closeMenu(): void { this.openMenuId = null; }

  copyToDraft(report: Report): void {
    this.closeMenu();
    this.notify.showInfo('Processing your request… please wait');
    this.tenantReports.copyToDraft(Number(report.id)).subscribe({
      next: (copy) => {
        this.listRouteReuse.invalidate('my-reports');
        this.notify.clearInfo();
        this.notify.showSuccess(`'${copy.reportName}' copied to Draft.`);
        this.cdr.markForCheck();
      },
      error: (err) => { this.notify.clearInfo(); this.error = err?.error?.message || err?.message || 'Failed to copy report to draft.'; this.cdr.markForCheck(); },
    });
  }

  // ─── Version history / rollback ──────────────────────────────────────────────

  versionDialogOpen = false;
  versionDialogTitle = '';
  versionsLoading = false;
  versionsError = '';
  versions: VersionHistoryItem[] = [];
  restoringVersionNo: number | null = null;
  private versionReportId: number | null = null;

  openVersionHistory(report: Report): void {
    this.closeMenu();
    this.versionReportId = Number(report.id);
    this.versionDialogTitle = report.title;
    this.versionDialogOpen = true;
    this.versionsLoading = true;
    this.versionsError = '';
    this.versions = [];
    this.loadVersions();
  }

  private loadVersions(): void {
    if (this.versionReportId === null) return;

    this.subs.push(this.tenantReports.getVersions(this.versionReportId).subscribe({
      next: (rows) => {
        this.versions = rows.map(v => ({
          versionNo: v.versionNo,
          label: v.description || v.reportName,
          isCurrent: v.isCurrent,
          publishedAt: v.publishedAt,
          reason: v.reason,
          restoredFromVersionNo: v.restoredFromVersionNo,
        }));
        this.versionsLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.versionsLoading = false;
        this.versionsError = err?.error?.message || err?.message || 'Failed to load version history.';
        this.cdr.markForCheck();
      },
    }));
  }

  restoreVersion(versionNo: number): void {
    if (this.versionReportId === null) return;

    this.restoringVersionNo = versionNo;
    this.versionsError = '';

    this.subs.push(this.tenantReports.restoreVersion(this.versionReportId, versionNo).subscribe({
      next: (res) => {
        this.restoringVersionNo = null;
        this.toastService.pending = res.message;
        // Reload both the history (a restore appends a version) and the report list,
        // whose cards show the restored content.
        this.loadVersions();
        this.reloadReports();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.restoringVersionNo = null;
        this.versionsError = err?.error?.error || err?.error?.message || err?.message || 'Failed to restore this version.';
        this.cdr.markForCheck();
      },
    }));
  }

  closeVersionHistory(): void {
    this.versionDialogOpen = false;
    this.versionReportId = null;
    this.versions = [];
    this.versionsError = '';
  }

  markReportAsCompleted(report: Report): void {
    this.closeMenu();
    // placeholder — wire up completion API when available
  }

  showUnpublishConfirm = false;
  pendingUnpublishReport: Report | null = null;
  unpublishConfirmBusy = false;

  /** Opens the "Unpublish report?" confirmation instead of unpublishing immediately. */
  unpublishReport(report: Report): void {
    this.closeMenu();
    this.pendingUnpublishReport = report;
    this.showUnpublishConfirm = true;
    this.cdr.markForCheck();
  }

  cancelUnpublishReport(): void {
    this.showUnpublishConfirm = false;
    this.pendingUnpublishReport = null;
    this.cdr.markForCheck();
  }

  /** Runs the actual unpublish call after the user confirms in the modal. */
  confirmUnpublishReport(): void {
    const report = this.pendingUnpublishReport;
    if (!report || this.unpublishConfirmBusy) return;
    this.unpublishConfirmBusy = true;
    this.notify.showInfo('Processing your request… please wait');
    this.subs.push(this.tenantReports.update(Number(report.id), {
      reportName: report.title,
      categoryId: report.categoryId,
      sourceName: report.source,
      sourceType: report.sourceType,
      status: 'draft',
    }).subscribe({
      next: () => {
        this.unpublishConfirmBusy = false;
        this.showUnpublishConfirm = false;
        this.pendingUnpublishReport = null;
        this.notify.clearInfo();
        this.notify.showSuccess(`'${report.title}' moved to draft.`);
        this.reloadReports();
      },
      error: (err) => {
        this.unpublishConfirmBusy = false;
        this.showUnpublishConfirm = false;
        this.pendingUnpublishReport = null;
        this.notify.clearInfo();
        this.error = err?.error?.message || err?.message || 'Failed to unpublish report.';
        this.cdr.markForCheck();
      },
    }));
  }

  private reloadReports(): void {
    this.subs.push(this.tenantReports.getAll('published').subscribe({
      next: (reports) => {
        this.groups = this.mapToGroups(reports);
        this.computeGroupOrder();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.error = err?.error?.message || err?.message || 'Failed to reload reports.';
        this.cdr.markForCheck();
      },
    }));
  }

  get allReports(): Report[] {
    return this.groups.flatMap(g => g.reports);
  }

  get tabs(): { id: TabId; label: string; count: number }[] {
    return [
      { id: 'all', label: 'All', count: this.allReports.length },
      { id: 'favorites', label: 'Favorites', count: this.allReports.filter(r => r.favorite).length },
      { id: 'recent', label: 'Recent', count: this.allReports.filter(r => r.recentlyViewed).length },
    ];
  }

  get categoryOptions(): { value: string; label: string }[] {
    return [...new Set(this.allReports.map(r => r.category))].map(c => ({ value: c, label: c }));
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

  @HostListener('document:click')
  onDocumentClick(): void {
    this.categoryOpen = false;
    this.sortOpen = false;
  }

  /** Groups filtered by the active tab, search term and category — with reports sorted per sortOption. */
  get visibleGroups(): ReportGroup[] {
    const term = this.searchTerm.trim().toLowerCase();

    return this.groups
      .map(group => {
        let reports = group.reports
          .filter(r => this.activeTab === 'all' || (this.activeTab === 'favorites' ? r.favorite : r.recentlyViewed))
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

  /** Latest modifiedDate among a group's reports, for group-level Newest/Oldest sort. */
  private groupMaxModified(reports: { modifiedDate?: string }[]): string {
    return reports.reduce((max, r) => (r.modifiedDate || '') > max ? (r.modifiedDate || '') : max, '');
  }

  /** Lowest recency index among a group's items; groups with no recently-viewed items sort last. */
  private recentGroupRank(items: { id: string }[]): number {
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

  trackByReport(_index: number, report: Report): string {
    return report.id;
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

  toggleGroup(group: ReportGroup): void {
    // `group` here may be the spread copy handed out by the `visibleGroups`
    // getter, not the source object — mutate the real entry in `groups` so
    // the change actually survives the next change-detection pass.
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

  toggleFavorite(report: Report): void {
    const numId = Number(report.id);
    if (Number.isNaN(numId)) return;
    const prev = report.favorite;
    report.favorite = !prev;
    this.widgetService.toggleFavourite(4, numId).subscribe({
      next: (res) => {
        report.favorite = res.isFavourite;
        this.cdr.markForCheck();
      },
      error: () => {
        report.favorite = prev;
        this.cdr.markForCheck();
      },
    });
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
      if (Math.abs(dx) < StandardReportsComponent.DRAG_THRESHOLD_PX) return;
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
