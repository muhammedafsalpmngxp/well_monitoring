import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { catchError, filter, forkJoin, of, Subscription } from 'rxjs';
import { CategoryService } from '../../../core/services/category.service';
import { DashboardService } from '../../../core/services/dashboard.service';
import { WidgetService } from '../../../core/services/widget.service';
import { AuthService } from '../../../core/services/auth.service';
import { UserManagementService } from '../../../core/services/user-management.service';
import { CategoryDropdown } from '../../../core/models/category.model';
import { DateUtil } from '../../../core/utils/date.util';
import {
  DashboardCategoryResponse,
  DashboardSummaryResponse,
  DashboardVersionSummaryResponse,
  WidgetLibraryResponse,
} from '../../../core/models/dashboard.model';
import { NotificationHelper } from '../../../core/helpers/notification.helper';
import { PermissionService } from '../../../core/services/permission.service';

export type BoardAccent = 'purple' | 'green' | 'amber' | 'teal' | 'orange';
export type BoardIcon = 'gauge' | 'calendar' | 'crew';

const GRAPH_IMAGE_BY_ACCENT: Record<BoardAccent, string> = {
  purple: 'assets/images/graph-img1.svg',
  green:  'assets/images/graph-img2.svg',
  amber:  'assets/images/graph-img3.svg',
  teal:   'assets/images/graph-img4.svg',
  orange: 'assets/images/graph-img1.svg',
};

export interface Board {
  id: string;
  title: string;
  description: string;
  category: string;
  chartCount: number;
  modifiedLabel: string;
  modifiedDate: string;
  favorite: boolean;
  recentlyViewed: boolean;
  status: string;
  isActive: boolean;
  accent: BoardAccent;
  icon: BoardIcon;
  versionNo?: number | null;
  createdBy?: string;
}

export interface BoardGroup {
  id: string;
  label: string;
  description?: string;
  icon: 'settings' | 'client' | 'crew';
  expanded: boolean;
  boards: Board[];
}

type TabId = 'all' | 'favorites' | 'recent';
type ViewMode = 'grid' | 'list';
type SortOption = 'default' | 'newest' | 'oldest' | 'name-az' | 'name-za' | 'most-charts';

@Component({
  selector: 'app-standard-boards',
  standalone: false,
  templateUrl: './standard-boards.component.html',
  styleUrls: ['./standard-boards.component.scss'],
})
export class StandardBoardsComponent implements OnInit, OnDestroy {
  constructor(
    private readonly router: Router,
    private readonly categoryService: CategoryService,
    private readonly dashboardService: DashboardService,
    private readonly widgetService: WidgetService,
    private readonly permissionService: PermissionService,
    private readonly authService: AuthService,
    private readonly userManagementService: UserManagementService,
    private readonly cdr: ChangeDetectorRef,
  ) {
    this.notify = new NotificationHelper(cdr);
  }

  get canCreate(): boolean { return this.permissionService.canCreate('dashboard.standard-boards'); }
  get canCopyToDraft(): boolean { return this.permissionService.isAdminUser && this.permissionService.canView('dashboard.wip-boards') && this.permissionService.canCreate('dashboard.wip-boards'); }
  get canUnpublish(): boolean { return this.permissionService.isAdminUser && this.canModify; }
  get canModify(): boolean { return this.permissionService.canModify('dashboard.standard-boards'); }
  get canAdmin(): boolean { return this.permissionService.canAdmin('dashboard.standard-boards'); }

  activeTab: TabId = 'all';
  viewMode: ViewMode = 'grid';
  sortOption: SortOption = 'default';
  categoryFilter: string[] = [];
  searchTerm = '';
  categoryOpen = false;
  sortOpen = false;

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

  // Loading & error state
  isLoading = true;

  private readonly notify: NotificationHelper;

  /** userId -> displayName, prefetched once for resolving CreatedBy/PublishedBy (which the backend stores as raw userId). */
  private tenantUserMap = new Map<number, string>();
  private tenantUsersLoaded = false;

  get pageTitle(): string { return 'Standard Boards'; }
  get breadcrumbs() { return [{label:'Home', route:'/'}, {label:'Dashboard', route:'/dashboard'}, {label: this.pageTitle}]; }

  get successMessage(): string { return this.notify.successMessage; }
  get error(): string { return this.notify.error; }

  // Toggle active
  /** Card toggle is hidden for now; set to true to show it again. */
  showCardToggle = false;
  togglingBoardId: string | null = null;
  showUnpublishConfirm = false;
  pendingUnpublishBoard: Board | null = null;

  // Card kebab menu
  openMenuBoardId: string | null = null;

  // Delete
  showDeleteConfirm = false;
  deletingBoard: Board | null = null;

  // History / details popup
  showHistoryModal = false;
  historyBoard: Board | null = null;
  historyLoading = false;
  historyVersions: DashboardVersionSummaryResponse[] = [];
  historyWidgets: WidgetLibraryResponse = { tiles: [], charts: [] };

  /** Categories fetched from the backend API. */
  apiCategories: CategoryDropdown[] = [];
  /** Recency order of viewed board ids, most-recent first */
  private recentOrder: string[] = [];
  /** Board ids flagged recently-viewed — re-applied whenever the cache re-emits freshly mapped boards. */
  private recentIds = new Set<string>();
  private categorySub!: Subscription;
  private dashboardSub!: Subscription;
  private loadSub!: Subscription;
  private routerSub!: Subscription;

  private static readonly ACCENTS: BoardAccent[] = ['purple', 'green', 'amber', 'teal', 'orange'];
  private static readonly ICONS: BoardIcon[] = ['gauge', 'calendar', 'crew'];
  private static readonly GROUP_ICONS: Array<'settings' | 'client' | 'crew'> = ['settings', 'client', 'crew'];

  ngOnInit(): void {
    this.loadTenantUsersForNameResolution();
    // This route is kept alive by ListRouteReuseStrategy, so revisiting reattaches the same
    // instance without re-running ngOnInit. Collapse every category on each entry so a category
    // left open before navigating away never stays expanded on return. Back keeps the page as it was.
    let viaBack = false;
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationStart | NavigationEnd => e instanceof NavigationStart || e instanceof NavigationEnd))
      .subscribe((e) => {
        if (e instanceof NavigationStart) { viaBack = e.navigationTrigger === 'popstate'; return; }
        if (e.urlAfterRedirects.includes('/standard-boards') && !viaBack) {
          this.searchTerm = '';
          this.activeTab = 'all';
          this.sortOption = 'default';
          this.categoryFilter = [];
          this.categoryOpen = false;
          this.sortOpen = false;
          this.expandedByTab = {};
          this.collapseAllGroups();
          this.computeGroupOrder();
          this.cdr.markForCheck();
        }
      });
    this.categorySub = this.categoryService.getCategoriesByType('dashboard').subscribe((cats) => {
      this.apiCategories = cats;
      this.cdr.markForCheck();
    });
    this.dashboardSub = this.dashboardService.published$.subscribe((data) => {
      this.groups = this.mapToGroups(data);
      this.applyRecentFlags();
      this.computeGroupOrder();
      this.cdr.markForCheck();
    });

    this.loadSub = forkJoin({
      dashboards: this.dashboardService.loadPublishedDashboards(),
      recentlyViewed: this.widgetService.getRecentlyViewed(1).pipe(catchError(() => of([]))),
      favourites: this.widgetService.getFavourites(1).pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ recentlyViewed, favourites }) => {
        // Merge rather than replace: a board opened before this response landed is already tracked locally.
        this.recentOrder = [...this.recentOrder, ...recentlyViewed.map(r => String(r.controlId)).filter(id => !this.recentIds.has(id))];
        this.recentIds = new Set(this.recentOrder);
        const favIds = new Set(favourites.filter(f => f.isFavourite).map(f => String(f.controlId)));
        this.groups.forEach(g => g.boards.forEach(b => {
          if (this.recentIds.has(b.id)) b.recentlyViewed = true;
          if (favIds.has(b.id)) b.favorite = true;
        }));
        this.isLoading = false;
        this.notify.clearError();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.showError(err?.error?.message || err?.message || 'Failed to load dashboards.');
        this.isLoading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.categorySub?.unsubscribe();
    this.dashboardSub?.unsubscribe();
    this.loadSub?.unsubscribe();
    this.routerSub?.unsubscribe();
    this.notify.destroy();
  }

  /** Force every category accordion closed (called on each entry to this reused route). */
  private collapseAllGroups(): void {
    let changed = false;
    this.groups.forEach(g => { if (g.expanded) { g.expanded = false; changed = true; } });
    if (changed) this.cdr.markForCheck();
  }

  groups: BoardGroup[] = [];
  /** Expanded category per tab (accordion-style within a tab) — keyed separately so expanding
   *  a group in one tab (e.g. All) doesn't also show it expanded in another (e.g. Favorites). */
  private expandedByTab: Partial<Record<TabId, string>> = {};

  private mapToGroups(data: DashboardCategoryResponse[]): BoardGroup[] {
    return data.map((cat, gi) => ({
      id: `cat-${cat.categoryId}`,
      label: cat.categoryName,
      description: cat.description ?? undefined,
      icon: StandardBoardsComponent.GROUP_ICONS[gi % StandardBoardsComponent.GROUP_ICONS.length],
      expanded: false,
      boards: cat.dashboards.map((d, bi) => this.mapToBoard(d, bi))
        .filter(board => !board.title.toLowerCase().includes('well & crew schedule')),
    })).filter(group => group.boards.length > 0);
  }

  /** Re-stamps the recently-viewed flag, which freshly mapped boards always start without. */
  private applyRecentFlags(): void {
    this.groups.forEach(g => g.boards.forEach(b => {
      if (this.recentIds.has(b.id)) b.recentlyViewed = true;
    }));
  }

  private mapToBoard(d: DashboardSummaryResponse, index: number): Board {
    return {
      id: String(d.dashboardId),
      title: d.dashboardName,
      description: d.description || '',
      category: d.categoryName,
      chartCount: d.widgetCount,
      modifiedLabel: d.modifiedDate ? this.formatRelativeTime(d.modifiedDate) : '',
      modifiedDate: d.modifiedDate || '',
      favorite: false,
      recentlyViewed: false,
      status: d.status,
      isActive: d.status !== 'Inactive',
      accent: StandardBoardsComponent.ACCENTS[index % StandardBoardsComponent.ACCENTS.length],
      icon: StandardBoardsComponent.ICONS[index % StandardBoardsComponent.ICONS.length],
      versionNo: d.versionNo,
      createdBy: d.createdBy,
    };
  }

  private formatRelativeTime(iso: string): string {
    const diff = Date.now() - DateUtil.parseUtc(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  get allBoards(): Board[] {
    return this.groups.flatMap(g => g.boards);
  }

  get tabs(): { id: TabId; label: string; count: number }[] {
    return [
      { id: 'all', label: 'All', count: this.allBoards.length },
      { id: 'favorites', label: 'Favorites', count: this.allBoards.filter(b => b.favorite).length },
      { id: 'recent', label: 'Recent', count: this.allBoards.filter(b => b.recentlyViewed).length },
    ];
  }

  get categories(): string[] {
    const apiNames = this.apiCategories.map(c => c.categoryName);
    const boardCats = this.allBoards.map(b => b.category);
    return ['all', ...new Set([...apiNames, ...boardCats])];
  }
  get categoryOptions(): { value: string; label: string }[] {
    return [...new Set(this.allBoards.map(b => b.category))]
      .map(category => ({ value: category, label: category }));
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
    if (!this.expandedByTab[this.activeTab]) this.computeGroupOrder();
  }

  /** Snapshot of category ids in current sortOption order — recomputed only when nothing is expanded. */
  private groupOrder: string[] = [];

  private computeGroupOrder(): void {
    const sorted = [...this.groups].sort((a, b) => {
      if (this.sortOption === 'name-az') return a.label.localeCompare(b.label);
      if (this.sortOption === 'name-za') return b.label.localeCompare(a.label);
      if (this.sortOption === 'newest') return this.groupMaxModified(b.boards).localeCompare(this.groupMaxModified(a.boards));
      if (this.sortOption === 'oldest') return this.groupMaxModified(a.boards).localeCompare(this.groupMaxModified(b.boards));
      if (this.sortOption === 'most-charts') return b.boards.length - a.boards.length;
      return 0;
    });
    this.groupOrder = sorted.map(g => g.id);
  }
  @HostListener('document:click')
  onDocumentClick(): void {
    this.categoryOpen = false;
    this.sortOpen = false;
    this.openMenuBoardId = null;
  }
  /** Groups filtered by the active tab, search term and category — with boards sorted per sortOption. */
  get visibleGroups(): BoardGroup[] {
    const term = this.searchTerm.trim().toLowerCase();

    return this.groups
      .map(group => {
        let boards = group.boards
          .filter(b => {
            if (this.activeTab === 'all') return true;
            if (this.activeTab === 'favorites') return b.favorite;
            return b.recentlyViewed;
          })
          .filter(b => this.categoryFilter.length === 0 || this.categoryFilter.includes(b.category))
          .filter(b => !term || b.title.toLowerCase().includes(term));

        if (this.sortOption !== 'default') {
          if (this.sortOption === 'name-az') {
            boards = [...boards].sort((a, b) => a.title.localeCompare(b.title));
          } else if (this.sortOption === 'name-za') {
            boards = [...boards].sort((a, b) => b.title.localeCompare(a.title));
          } else if (this.sortOption === 'newest') {
            boards = [...boards].sort((a, b) => (b.modifiedDate || '').localeCompare(a.modifiedDate || ''));
          } else if (this.sortOption === 'oldest') {
            boards = [...boards].sort((a, b) => (a.modifiedDate || '').localeCompare(b.modifiedDate || ''));
          }
        }

        // Recent tab defaults to last-opened-first within each category.
        if (this.activeTab === 'recent' && this.sortOption === 'default') {
          boards = [...boards].sort((a, b) => this.recentRank(a.id) - this.recentRank(b.id));
        }

        // Stable re-sort: inactive boards always at the end
        boards = [...boards].sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));

        return { ...group, boards, expanded: this.expandedByTab[this.activeTab] === group.id };
      })
      .filter(group => group.boards.length > 0)
      .sort((a, b) => {
        if (this.activeTab === 'recent' && this.sortOption === 'default') return this.recentGroupRank(a.boards) - this.recentGroupRank(b.boards);
        const rank = (id: string) => { const i = this.groupOrder.indexOf(id); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
        return rank(a.id) - rank(b.id);
      });
  }

  /** Latest modifiedDate among a group's boards, for group-level Newest/Oldest sort. */
  private groupMaxModified(boards: { modifiedDate?: string }[]): string {
    return boards.reduce((max, b) => (b.modifiedDate || '') > max ? (b.modifiedDate || '') : max, '');
  }

  /** Lowest recency index among a group's items; groups with no recently-viewed items sort last. */
  private recentGroupRank(items: { id: string }[]): number {
    let best = Number.MAX_SAFE_INTEGER;
    for (const item of items) {
      const idx = this.recentOrder.indexOf(item.id);
      if (idx !== -1 && idx < best) best = idx;
    }
    return best;
  }

  /** Recency position of a board (0 = most recent); never-opened boards sort last. */
  private recentRank(id: string): number {
    const idx = this.recentOrder.indexOf(id);
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  }

  trackByGroup(_index: number, group: BoardGroup): string {
    return group.id;
  }

  trackByBoard(_index: number, board: Board): string {
    return board.id;
  }

  previewImage(accent: BoardAccent): string {
    return GRAPH_IMAGE_BY_ACCENT[accent];
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

  toggleGroup(group: BoardGroup): void {
    // Accordion within the active tab only — toggling here must not expand this category in
    // another tab (e.g. All vs Favorites) since they share the same underlying group objects.
    const isOpen = this.expandedByTab[this.activeTab] === group.id;
    this.expandedByTab[this.activeTab] = isOpen ? undefined : group.id;
  }

  toggleFavorite(board: Board): void {
    const numId = Number(board.id);
    if (Number.isNaN(numId)) return;
    const prev = board.favorite;
    board.favorite = !prev;
    this.widgetService.toggleFavourite(1, numId).subscribe({
      next: (res) => {
        board.favorite = res.isFavourite;
        this.cdr.markForCheck();
      },
      error: () => {
        board.favorite = prev;
        this.cdr.markForCheck();
      },
    });
  }

  openBoard(board: Board): void {
    if (!board.isActive) return;
    const numId = Number(board.id);
    if (!Number.isNaN(numId)) this.widgetService.trackView(1, numId).subscribe({ error: () => {} });
    board.recentlyViewed = true;
    this.recentIds.add(board.id);
    // Promote to the front so the Recent tab lists it first right away, without waiting for a refetch.
    this.recentOrder = [board.id, ...this.recentOrder.filter(id => id !== board.id)];

    // Developer Comment: Crew schedule board has no charts; route it to the dedicated Gantt view instead of the empty operations dashboard.
    if (board.title.toLowerCase().includes('well & crew schedule')) {
      this.router.navigate(['/dashboard/crew-calendar']);
      return;
    }
    this.router.navigate(['/dashboard/operations-dashboard', board.id], { queryParams: { from: 'standard' } });
  }

  // ─── Card menu ─────────────────────────────────────────────────────────────

  toggleBoardMenu(event: Event, board: Board): void {
    event.stopPropagation();
    this.openMenuBoardId = this.openMenuBoardId === board.id ? null : board.id;
  }

  closeBoardMenu(): void {
    this.openMenuBoardId = null;
  }

  editBoard(board: Board): void {
    this.closeBoardMenu();
    this.router.navigate(['/dashboard/builder'], { queryParams: { dashboardId: board.id, name: board.title } });
  }

  markAsCompleted(board: Board): void {
    this.closeBoardMenu();
    // placeholder — wire up completion API when available
    this.notify.showSuccess(`'${board.title}' marked as completed.`);
  }

  copyToDraft(board: Board): void {
    this.closeBoardMenu();
    if (!this.canCopyToDraft) return;
    const numId = Number(board.id);
    if (Number.isNaN(numId)) return;

    this.dashboardService.copyDashboardToDraft(numId).subscribe({
      next: (res) => {
        const name = res.data?.dashboardName ?? board.title;
        this.notify.showSuccess(`'${name}' has been added to WIP Boards.`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.showError(err?.error?.message || err?.message || 'Failed to copy dashboard to draft.');
        this.cdr.markForCheck();
      },
    });
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  confirmDeleteBoard(board: Board): void {
    this.closeBoardMenu();
    this.deletingBoard = board;
    this.showDeleteConfirm = true;
  }

  cancelDeleteBoard(): void {
    this.showDeleteConfirm = false;
    this.deletingBoard = null;
  }

  deleteBoard(): void {
    if (!this.deletingBoard) return;
    const boardName = this.deletingBoard.title;
    const boardId = Number(this.deletingBoard.id);

    this.dashboardService.deleteDashboard(boardId).subscribe({
      next: () => {
        this.showDeleteConfirm = false;
        this.deletingBoard = null;
        this.showSuccess(`'${boardName}' deleted successfully.`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.showError(err?.error?.message || err?.message || 'Failed to delete dashboard.');
        this.showDeleteConfirm = false;
        this.deletingBoard = null;
        this.cdr.markForCheck();
      },
    });
  }

  // ─── History / Details popup ────────────────────────────────────────────────

  /** Prefetches tenant users once so CreatedBy/PublishedBy (raw userId strings from the backend) can show a name. */
  private loadTenantUsersForNameResolution(): void {
    if (this.tenantUsersLoaded) return;
    const tenantId = this.authService.getCurrentUser()?.tenantId;
    if (!tenantId) return;
    this.userManagementService.listUsersByTenant(tenantId).subscribe({
      next: (res) => {
        this.tenantUserMap = new Map(res.items.map(u => [u.userId, u.displayName || u.email]));
        this.tenantUsersLoaded = true;
        this.cdr.markForCheck();
      },
      error: () => {},
    });
  }

  /** CreatedBy/PublishedBy are stored as raw userId strings — resolve to a display name when known. */
  resolveUserName(userIdOrName?: string | null): string {
    if (!userIdOrName) return '—';
    const numId = Number(userIdOrName);
    if (!Number.isNaN(numId) && this.tenantUserMap.has(numId)) return this.tenantUserMap.get(numId)!;
    return userIdOrName;
  }

  get canViewVersionHistory(): boolean {
    return this.permissionService.canView('dashboard.versions');
  }

  openHistoryModal(event: Event, board: Board): void {
    event.stopPropagation();
    if (!this.canViewVersionHistory) return;
    this.historyBoard = board;
    this.showHistoryModal = true;
    this.historyLoading = true;
    this.historyVersions = [];
    this.historyWidgets = { tiles: [], charts: [] };

    const numId = Number(board.id);
    if (Number.isNaN(numId)) {
      this.historyLoading = false;
      return;
    }

    forkJoin({
      versions: this.dashboardService.getVersionHistory(numId).pipe(catchError(() => of([] as DashboardVersionSummaryResponse[]))),
      widgets: this.dashboardService.getDashboardWidgets(numId).pipe(catchError(() => of({ tiles: [], charts: [] } as WidgetLibraryResponse))),
    }).subscribe(({ versions, widgets }) => {
      this.historyVersions = versions;
      this.historyWidgets = widgets;
      this.historyLoading = false;
      this.cdr.markForCheck();
    });
  }

  closeHistoryModal(): void {
    this.showHistoryModal = false;
    this.historyBoard = null;
    this.restoringVersionNo = null;
    this.pendingRestoreVersionNo = null;
    this.restoreError = '';
  }

  // ─── Rollback ────────────────────────────────────────────────────────────────

  /** Version currently being restored, so only that row shows progress. */
  restoringVersionNo: number | null = null;
  /** Version awaiting confirmation. Restoring changes what every viewer sees. */
  pendingRestoreVersionNo: number | null = null;
  restoreError = '';

  /** The version number a restore would create — one past the highest that exists. */
  get nextRestoreVersionNo(): number {
    if (!this.historyVersions.length) return 0;
    return Math.max(...this.historyVersions.map(v => v.versionNo)) + 1;
  }

  askRestoreVersion(versionNo: number): void {
    this.pendingRestoreVersionNo = versionNo;
    this.restoreError = '';
  }

  cancelRestoreVersion(): void {
    this.pendingRestoreVersionNo = null;
  }

  confirmRestoreVersion(): void {
    const versionNo = this.pendingRestoreVersionNo;
    const board = this.historyBoard;
    if (versionNo === null || !board) return;

    this.pendingRestoreVersionNo = null;
    this.restoringVersionNo = versionNo;
    this.restoreError = '';

    this.dashboardService.restoreVersion(Number(board.id), versionNo).subscribe({
      next: (res) => {
        this.restoringVersionNo = null;
        this.notify.showSuccess(res.message);

        // A restore publishes a NEW version, so refresh both the history list and the
        // published boards (whose cards show the version number).
        this.dashboardService.getVersionHistory(Number(board.id))
          .pipe(catchError(() => of([] as DashboardVersionSummaryResponse[])))
          .subscribe((versions) => {
            this.historyVersions = versions;
            this.cdr.markForCheck();
          });

        this.dashboardService.loadPublishedDashboards()
          .subscribe({ error: () => { /* list refresh is best-effort */ } });

        this.cdr.markForCheck();
      },
      error: (err) => {
        this.restoringVersionNo = null;
        this.restoreError = err?.error?.message || err?.message || 'Failed to restore this version.';
        this.cdr.markForCheck();
      },
    });
  }

  get historyVersionCount(): number {
    return this.historyVersions.length;
  }

  /** historyVersions is sorted DESC by versionNo, so [0] = most recently published version. */
  get historyLastPublishedBy(): string {
    return this.resolveUserName(this.historyVersions[0]?.publishedBy);
  }

  get historyLastPublishedDate(): string {
    const iso = this.historyVersions[0]?.modifiedDate;
    return iso ? this.formatFullDate(iso) : '—';
  }

  /** historyVersions is sorted DESC by versionNo, so the last item = V0 = the first-ever published version. */
  get historyFirstPublishedBy(): string {
    return this.resolveUserName(this.historyVersions[this.historyVersions.length - 1]?.publishedBy);
  }

  get historyFirstPublishedDate(): string {
    const iso = this.historyVersions[this.historyVersions.length - 1]?.modifiedDate;
    return iso ? this.formatFullDate(iso) : '—';
  }

  get historyModifiedDateLabel(): string {
    return this.historyBoard?.modifiedDate ? this.formatFullDate(this.historyBoard.modifiedDate) : '—';
  }

  get historyChartCount(): number {
    return this.historyWidgets.charts?.length ?? 0;
  }

  get historyTileCount(): number {
    return this.historyWidgets.tiles?.length ?? 0;
  }

  formatFullDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  private static readonly DRAG_THRESHOLD_PX = 5;

  private dragState: { el: HTMLElement; pointerId: number; startX: number; startScrollLeft: number; dragging: boolean } | null = null;

  onCardsPointerDown(event: PointerEvent, el: HTMLElement): void {
    // Pointer capture is deferred until real movement is seen — capturing on every
    // pointerdown (even a plain click) causes the browser to retarget the follow-up
    // `click` event to `el` instead of the card the user clicked, breaking navigation.
    this.dragState = { el, pointerId: event.pointerId, startX: event.clientX, startScrollLeft: el.scrollLeft, dragging: false };
  }

  onCardsPointerMove(event: PointerEvent): void {
    if (!this.dragState) return;
    const dx = event.clientX - this.dragState.startX;

    if (!this.dragState.dragging) {
      if (Math.abs(dx) < StandardBoardsComponent.DRAG_THRESHOLD_PX) return;
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

  // ─── Toggle Active ─────────────────────────────────────────────────────────

  /** Deactivating (Un Publish) asks for confirmation first; reactivating (Publish) runs immediately. */
  toggleActive(event: Event, board: Board): void {
    event.stopPropagation();
    if (!this.canUnpublish || this.togglingBoardId) return;

    if (board.isActive) {
      this.pendingUnpublishBoard = board;
      this.showUnpublishConfirm = true;
      this.cdr.markForCheck();
      return;
    }
    this.runToggleActive(board);
  }

  cancelUnpublishBoard(): void {
    this.showUnpublishConfirm = false;
    this.pendingUnpublishBoard = null;
    this.cdr.markForCheck();
  }

  /** Runs the actual toggle call after the user confirms in the modal. */
  confirmUnpublishBoard(): void {
    const board = this.pendingUnpublishBoard;
    if (!board || this.togglingBoardId) return;
    this.showUnpublishConfirm = false;
    this.runToggleActive(board);
  }

  private runToggleActive(board: Board): void {
    this.togglingBoardId = board.id;
    this.dashboardService.toggleDashboardActive(Number(board.id)).subscribe({
      next: (response) => {
        this.togglingBoardId = null;
        this.pendingUnpublishBoard = null;
        this.showSuccess(response.data?.message || `'${board.title}' ${response.data?.isActive ? 'activated' : 'deactivated'} successfully.`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.togglingBoardId = null;
        this.pendingUnpublishBoard = null;
        this.showError(err?.error?.message || err?.message || 'Failed to toggle dashboard state.');
        this.cdr.markForCheck();
      },
    });
  }

  // ─── Notifications ─────────────────────────────────────────────────────────

  private showSuccess(message: string): void { this.notify.showSuccess(message); }
  private showError(message: string): void { this.notify.showError(message); }
}
