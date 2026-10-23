import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { catchError, EMPTY, filter, finalize, forkJoin, of, Subject, Subscription, switchMap, take } from 'rxjs';
import { CategoryService } from '../../../core/services/category.service';
import { DashboardService } from '../../../core/services/dashboard.service';
import { WidgetService } from '../../../core/services/widget.service';
import { AuthService } from '../../../core/services/auth.service';
import { PermissionService } from '../../../core/services/permission.service';
import { UserManagementService, TenantUserDto, RoleDto } from '../../../core/services/user-management.service';
import { CategoryDropdown } from '../../../core/models/category.model';
import { DateUtil } from '../../../core/utils/date.util';
import {
  DashboardCategoryResponse,
  DashboardSummaryResponse,
  DashboardVersionSummaryResponse,
  WidgetLibraryResponse,
} from '../../../core/models/dashboard.model';
import { NotificationHelper } from '../../../core/helpers/notification.helper';
import { ToastService } from '../../../core/services/toast.service';

export type BoardAccent = 'purple' | 'blue' | 'green' | 'orange';
export type BoardIcon = 'gauge' | 'calendar' | 'crew';

const GRAPH_IMAGE_BY_ACCENT: Record<BoardAccent, string> = {
  purple: 'assets/images/graph-img1.svg',
  blue: 'assets/images/graph-img2.svg',
  green: 'assets/images/graph-img3.svg',
  orange: 'assets/images/graph-img4.svg',
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
  draft: boolean;
  status: string;
  accent: BoardAccent;
  icon: BoardIcon;
  /** True when this card came from the "Shared" tab (shared internally by another user). */
  shared?: boolean;
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
  published?: Board[];
  drafts?: Board[];
  completed?: Board[];
  shared?: Board[];
}

type TabId = 'all' | 'favorites' | 'recent' | 'draft' | 'completed' | 'shared';
type ViewMode = 'grid' | 'list';
type SortOption = 'default' | 'newest' | 'oldest' | 'name-az' | 'name-za' | 'most-charts';

@Component({
  selector: 'app-wip-boards',
  standalone: false,
  templateUrl: './wip-boards.component.html',
  styleUrls: ['./wip-boards.component.scss'],
})
export class WipBoardsComponent implements OnInit, OnDestroy {
  constructor(
    private readonly router: Router,
    private readonly categoryService: CategoryService,
    private readonly dashboardService: DashboardService,
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
    private readonly widgetService: WidgetService,
    private readonly userManagementService: UserManagementService,
    private readonly cdr: ChangeDetectorRef,
    private readonly toastService: ToastService,
  ) {
    this.notify = new NotificationHelper(cdr);
  }

  get canCreate(): boolean { return this.permissionService.canCreate('dashboard.wip-boards'); }
  get canManageCategories(): boolean { return this.permissionService.canView('dashboard.categories'); }
  get canModify(): boolean { return this.permissionService.canModify('dashboard.wip-boards'); }
  get canAdmin(): boolean { return this.permissionService.canAdmin('dashboard.wip-boards'); }

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

  showAddDashboardModal = false;
  showCategoryManager = false;
  newDashboardCategory = '';
  newDashboardName = '';
  newDashboardDescription = '';
  addModalCategoryOpen = false;

  toggleAddModalCategory(event: Event): void {
    event.stopPropagation();
    this.addModalCategoryOpen = !this.addModalCategoryOpen;
  }

  selectAddModalCategory(cat: string): void {
    this.newDashboardCategory = cat;
    this.addModalCategoryOpen = false;
  }

  // Loading & error state
  isLoading = true;
  isSaving = false;

  private readonly notify: NotificationHelper;

  get isAdmin(): boolean { return this.authService.isAdmin(); }
  get pageTitle(): string { return this.isAdmin ? 'WIP Boards' : 'My Boards'; }
  get pageSubtitle(): string {
    return this.isAdmin
      ? 'Manage Work In Progress Dashboards'
      : 'Create, View and Manage your Dashboards';
  }
  get breadcrumbs() { return [{label:'Home', route:'/'}, {label:'Dashboard', route:'/dashboard'}, {label: this.pageTitle}]; }

  get successMessage(): string { return this.notify.successMessage; }
  get error(): string { return this.notify.error; }

  // Delete confirmation
  showDeleteConfirm = false;
  deletingBoard: Board | null = null;

  // History / details popup
  showHistoryModal = false;
  historyBoard: Board | null = null;
  historyLoading = false;
  historyVersions: DashboardVersionSummaryResponse[] = [];
  historyWidgets: WidgetLibraryResponse = { tiles: [], charts: [] };
  /** userId -> displayName, prefetched once for resolving CreatedBy/PublishedBy (which the backend stores as raw userId). */
  private tenantUserMap = new Map<number, string>();
  private tenantUsersLoaded = false;

  // Publish
  publishingBoardId: string | null = null;
  showPublishConfirm = false;
  publishingBoard: Board | null = null;

  // Complete
  completingBoardId: string | null = null;

  // Reopen (Completed -> Draft)
  reopeningBoardId: string | null = null;

  // Un-publish (toggle active)
  togglingBoardId: string | null = null;

  // Card kebab menu
  openMenuBoardId: string | null = null;
  cloningBoardIds = new Set<string>();
  showShareModal = false;
  sharingBoard: Board | null = null;
  shareLink = '';
  isCreatingShareLink = false;
  isShareLinkCopied = false;
  private shareLinkCopiedTimeout: ReturnType<typeof setTimeout> | null = null;

  // Share internally
  shareModalMode: 'internal' | 'external' = 'internal';
  isLoadingShareUsers = false;
  isSharingInternally = false;
  repeatShareMessage = '';
  private repeatShareConfirmation: Subject<boolean> | null = null;
  internalShareRoleFilter = '';
  internalShareSearchTerm = '';
  allTenantUsers: TenantUserDto[] = [];
  allTenantRoles: RoleDto[] = [];
  selectedShareUserIds = new Set<number>();

  /** Categories fetched from the backend API. */
  apiCategories: CategoryDropdown[] = [];
  /** Recency order of viewed board ids, most-recent first */
  private recentOrder: string[] = [];
  /** Board ids flagged favourite/recently-viewed — re-applied whenever the cache re-emits fresh boards. */
  private favoriteIds = new Set<string>();
  private recentIds = new Set<string>();
  private categorySub!: Subscription;
  private dashboardSub!: Subscription;
  private sharedDashboardSub!: Subscription;
  private loadSub!: Subscription;
  private routerSub!: Subscription;

  ngOnInit(): void {
    this.showPendingSuccess();
    this.loadTenantUsersForNameResolution();
    // This route is kept alive by ListRouteReuseStrategy, so revisiting reattaches the same
    // instance without re-running ngOnInit. Collapse every category on each entry so a category
    // left open before navigating away never stays expanded on return. Back keeps the page as it was.
    let viaBack = false;
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationStart | NavigationEnd => e instanceof NavigationStart || e instanceof NavigationEnd))
      .subscribe((e) => {
        if (e instanceof NavigationStart) { viaBack = e.navigationTrigger === 'popstate'; return; }
        if (e.urlAfterRedirects.includes('/wip-boards')) {
          this.showPendingSuccess();
          if (viaBack) return;
          this.searchTerm = '';
          this.activeTab = 'all';
          this.sortOption = 'default';
          this.categoryFilter = [];
          this.categoryOpen = false;
          this.sortOpen = false;
          this.collapseAllGroups();
          this.computeGroupOrder();
          this.cdr.markForCheck();
        }
      });
    this.categorySub = this.categoryService.getCategoriesByType('dashboard').subscribe((cats) => {
      this.apiCategories = cats;
      this.cdr.markForCheck();
    });

    // Subscribe to reactive cache for ongoing updates (after mutations)
    this.dashboardSub = this.dashboardService.wip$.subscribe((data) => {
      this.groups = this.mapToGroups(data);
      this.applyUserBoardFlags();
      this.computeGroupOrder();
      this.cdr.markForCheck();
    });

    // Boards other users have shared internally with the current user (any status).
    this.sharedDashboardSub = this.dashboardService.shared$.subscribe((data) => {
      this.sharedGroups = this.mapToGroups(data).map(group => ({
        ...group,
        expanded: false,
        boards: group.boards.map(board => ({ ...board, shared: true })),
      }));
      this.cdr.markForCheck();
    });

    // Initial load with recently viewed and favourites
    this.loadSub = forkJoin({
      dashboards: this.dashboardService.loadWipDashboards(),
      sharedWithMe: this.dashboardService.loadSharedWithMeDashboards().pipe(catchError(() => of([]))),
      recentlyViewed: this.widgetService.getRecentlyViewed(1).pipe(catchError(() => of([]))),
      favourites: this.widgetService.getFavourites(1).pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ recentlyViewed, favourites }) => {
        // Merge rather than replace: a board opened before this response landed is already tracked locally.
        this.recentOrder = [...this.recentOrder, ...recentlyViewed.map(r => String(r.controlId)).filter(id => !this.recentIds.has(id))];
        this.recentIds = new Set(this.recentOrder);
        this.favoriteIds = new Set(favourites.filter(f => f.isFavourite).map(f => String(f.controlId)));
        this.applyUserBoardFlags();
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
    this.resolveRepeatShare(false);
    this.categorySub?.unsubscribe();
    this.dashboardSub?.unsubscribe();
    this.sharedDashboardSub?.unsubscribe();
    this.loadSub?.unsubscribe();
    this.routerSub?.unsubscribe();
    if (this.shareLinkCopiedTimeout) clearTimeout(this.shareLinkCopiedTimeout);
    this.notify.destroy();
  }

  /** Force every category accordion closed (called on each entry to this reused route). */
  private collapseAllGroups(): void {
    this.expandedByTab = {};
  }

  private showPendingSuccess(): void {
    const pending = this.toastService.consume();
    if (pending) {
      this.notify.showSuccess(pending);
      this.cdr.markForCheck();
    }
  }

  groups: BoardGroup[] = [];
  sharedGroups: BoardGroup[] = [];
  /** Expanded category per tab (accordion-style within a tab) — keyed separately so expanding
   *  a group in one tab (e.g. All) doesn't also show it expanded in another (e.g. Favorites). */
  private expandedByTab: Partial<Record<TabId, string>> = {};

  private static readonly ACCENTS: BoardAccent[] = ['purple', 'blue', 'green', 'orange'];
  private static readonly ICONS: BoardIcon[] = ['gauge', 'calendar', 'crew'];
  private static readonly GROUP_ICONS: Array<'settings' | 'client' | 'crew'> = ['settings', 'client', 'crew'];

  private mapToGroups(data: DashboardCategoryResponse[]): BoardGroup[] {
    return data.map((cat, gi) => ({
      id: `cat-${cat.categoryId}`,
      label: cat.categoryName,
      description: cat.description ?? undefined,
      icon: WipBoardsComponent.GROUP_ICONS[gi % WipBoardsComponent.GROUP_ICONS.length],
      expanded: false,
      boards: cat.dashboards.map((d, bi) => this.mapToBoard(d, bi)),
    }));
  }

  /** Re-stamps favourite/recently-viewed flags, which freshly mapped boards always start without. */
  private applyUserBoardFlags(): void {
    this.groups.forEach(g => g.boards.forEach(b => {
      if (this.recentIds.has(b.id)) b.recentlyViewed = true;
      if (this.favoriteIds.has(b.id)) b.favorite = true;
    }));
  }

  /** Case/whitespace-insensitive status match — guards against boards whose status differs only
   *  by casing (e.g. legacy 'draft' vs 'Draft') being misclassified as an unrecognized status. */
  private static isStatus(status: string, expected: string): boolean {
    return (status || '').trim().toLowerCase() === expected.toLowerCase();
  }

  private mapToBoard(d: DashboardSummaryResponse, index: number): Board {
    return {
      id: String(d.dashboardId),
      title: d.dashboardName,
      description: d.description ?? '',
      category: d.categoryName,
      chartCount: d.widgetCount,
      modifiedLabel: d.modifiedDate ? this.formatRelativeTime(d.modifiedDate) : '',
      modifiedDate: d.modifiedDate || '',
      favorite: false,
      recentlyViewed: false,
      draft: WipBoardsComponent.isStatus(d.status, 'Draft'),
      status: d.status,
      accent: WipBoardsComponent.ACCENTS[index % WipBoardsComponent.ACCENTS.length],
      icon: WipBoardsComponent.ICONS[index % WipBoardsComponent.ICONS.length],
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

  /** Boards internally shared with the current user by other users, flattened. */
  get sharedBoards(): Board[] {
    return this.sharedGroups.flatMap(g => g.boards);
  }

  get tabs(): { id: TabId; label: string; count: number }[] {
    const tabs: { id: TabId; label: string; count: number }[] = [
      { id: 'all', label: 'All', count: this.allBoards.length },
      { id: 'favorites', label: 'Favorites', count: this.allBoards.filter(b => b.favorite).length },
      { id: 'recent', label: 'Recent', count: this.allBoards.filter(b => b.recentlyViewed).length },
      { id: 'draft', label: 'Draft', count: this.allBoards.filter(b => b.draft).length },
    ];
    tabs.push({ id: 'completed', label: 'Completed', count: this.allBoards.filter(b => WipBoardsComponent.isStatus(b.status, 'Completed')).length });
    tabs.push({ id: 'shared', label: 'Shared', count: this.sharedBoards.length });
    return tabs;
  }

  get categories(): string[] {
    const apiNames = this.apiCategories.map(c => c.categoryName);
    const boardCats = this.allBoards.map(b => b.category);
    return ['all', ...new Set([...apiNames, ...boardCats])];
  }

  get categoryOptions(): { value: string; label: string }[] {
    return this.apiCategories.map(c => ({ value: c.categoryName, label: c.categoryName }));
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
    this.addModalCategoryOpen = false;
  }

  /** Groups filtered by the active tab, search term and category — with boards sorted per sortOption. */
  get visibleGroups(): BoardGroup[] {
    const term = this.searchTerm.trim().toLowerCase();

    if (this.activeTab === 'shared') {
      return this.sharedGroups
        .map(group => {
          let boards = group.boards
            .filter(b => this.categoryFilter.length === 0 || this.categoryFilter.includes(b.category))
            .filter(b => !term || b.title.toLowerCase().includes(term));

          boards = this.applyBoardSort(boards);

          return { ...group, boards, published: [], drafts: [], completed: [], shared: boards, expanded: this.expandedByTab['shared'] === group.id };
        })
        .filter(group => group.boards.length > 0);
    }

    return this.groups
      .map(group => {
        let boards = group.boards
          .filter(b => {
            if (this.activeTab === 'all') return true;
            if (this.activeTab === 'favorites') return b.favorite;
            if (this.activeTab === 'recent') return b.recentlyViewed;
            if (this.activeTab === 'completed') return WipBoardsComponent.isStatus(b.status, 'Completed');
            return b.draft;
          })
          .filter(b => this.categoryFilter.length === 0 || this.categoryFilter.includes(b.category))
          .filter(b => !term || b.title.toLowerCase().includes(term));

        boards = this.applyBoardSort(boards);

        // Recent tab defaults to last-opened-first within each category.
        if (this.activeTab === 'recent' && this.sortOption === 'default') {
          boards = [...boards].sort((a, b) => this.recentRank(a.id) - this.recentRank(b.id));
        }

        const published = boards.filter(b => WipBoardsComponent.isStatus(b.status, 'Published') || WipBoardsComponent.isStatus(b.status, 'Inactive'));
        const drafts = boards.filter(b => WipBoardsComponent.isStatus(b.status, 'Draft'));
        const completed = boards.filter(b => WipBoardsComponent.isStatus(b.status, 'Completed'));
        return { ...group, boards, published, drafts, completed, expanded: this.expandedByTab[this.activeTab] === group.id };
      })
      .filter(group => group.boards.length > 0)
      .sort((a, b) => {
        if (this.activeTab === 'recent' && this.sortOption === 'default') return this.recentGroupRank(a.boards) - this.recentGroupRank(b.boards);
        const rank = (id: string) => { const i = this.groupOrder.indexOf(id); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
        return rank(a.id) - rank(b.id);
      });
  }

  /** Board-level ordering for the current sortOption ('most-charts' only reorders categories, not boards). */
  private applyBoardSort(boards: Board[]): Board[] {
    if (this.sortOption === 'name-az') return [...boards].sort((a, b) => a.title.localeCompare(b.title));
    if (this.sortOption === 'name-za') return [...boards].sort((a, b) => b.title.localeCompare(a.title));
    if (this.sortOption === 'newest') return [...boards].sort((a, b) => (b.modifiedDate || '').localeCompare(a.modifiedDate || ''));
    if (this.sortOption === 'oldest') return [...boards].sort((a, b) => (a.modifiedDate || '').localeCompare(b.modifiedDate || ''));
    return boards;
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

  /** Latest modifiedDate among a group's boards, for group-level Newest/Oldest sort. */
  private groupMaxModified(boards: { modifiedDate: string }[]): string {
    return boards.reduce((max, b) => (b.modifiedDate || '') > max ? (b.modifiedDate || '') : max, '');
  }

  trackByGroup(_index: number, group: BoardGroup): string {
    return group.id;
  }

  trackByBoard(_index: number, board: Board): string {
    return board.id;
  }

  /** Boards within a group that have been published (Published/Inactive). */
  publishedBoards(group: BoardGroup): Board[] {
    return group.published ?? group.boards.filter(b => WipBoardsComponent.isStatus(b.status, 'Published') || WipBoardsComponent.isStatus(b.status, 'Inactive'));
  }

  /** Boards within a group that are still drafts. */
  draftBoards(group: BoardGroup): Board[] {
    return group.drafts ?? group.boards.filter(b => WipBoardsComponent.isStatus(b.status, 'Draft'));
  }

  /** Boards within a group that are completed. */
  completedBoards(group: BoardGroup): Board[] {
    return group.completed ?? group.boards.filter(b => WipBoardsComponent.isStatus(b.status, 'Completed'));
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
    // another tab (e.g. All vs Favorites vs Shared) since they share underlying group objects.
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
        if (res.isFavourite) this.favoriteIds.add(board.id); else this.favoriteIds.delete(board.id);
        this.cdr.markForCheck();
      },
      error: () => {
        board.favorite = prev;
        this.cdr.markForCheck();
      },
    });
  }

  openBoard(board: Board): void {
    const numId = Number(board.id);
    if (!Number.isNaN(numId)) this.widgetService.trackView(1, numId).subscribe({ error: () => {} });
    board.recentlyViewed = true;
    this.recentIds.add(board.id);
    // Promote to the front so the Recent tab lists it first right away, without waiting for a refetch.
    this.recentOrder = [board.id, ...this.recentOrder.filter(id => id !== board.id)];
    if (board.title.toLowerCase().includes('well & crew schedule')) {
      this.router.navigate(['/dashboard/activity-breakdown', board.id]);
      return;
    }
    if (board.shared) {
      // Recipients may lack 'dashboard.standard-boards'; this route only requires
      // 'dashboard.wip-boards', which they already have by being on this page.
      this.router.navigate(['/dashboard/shared', board.id], { queryParams: { from: 'wip' } });
      return;
    }
    this.router.navigate(['/dashboard/operations-dashboard', board.id], { queryParams: { from: 'wip' } });
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

  cloneBoard(board: Board): void {
    this.closeBoardMenu();
    const dashboardId = Number(board.id);
    if (!this.canCreate || !Number.isSafeInteger(dashboardId) || dashboardId <= 0 || this.cloningBoardIds.has(board.id)) return;

    this.cloningBoardIds.add(board.id);
    this.dashboardService.cloneDashboard(dashboardId).pipe(
      finalize(() => {
        this.cloningBoardIds.delete(board.id);
        this.cdr.markForCheck();
      }),
    ).subscribe({
      next: (response) => {
        if (!response.success || !response.data) {
          this.showError(response.message || 'Failed to clone dashboard.');
          return;
        }
        this.showSuccess(`'${response.data.dashboardName}' has been added to ${this.pageTitle}.`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.showError(err?.error?.message || err?.message || 'Failed to clone dashboard.');
      },
    });
  }

  openShareModal(board: Board): void {
    this.closeBoardMenu();
    this.sharingBoard = board;
    this.shareLink = '';
    this.isShareLinkCopied = false;
    this.shareModalMode = 'internal';
    this.internalShareRoleFilter = '';
    this.internalShareSearchTerm = '';
    this.selectedShareUserIds.clear();
    this.showShareModal = true;
    this.loadTenantUsersForShare();
  }

  closeShareModal(): void {
    const confirmation = this.repeatShareConfirmation;
    this.repeatShareConfirmation = null;
    this.repeatShareMessage = '';
    this.showShareModal = false;
    this.sharingBoard = null;
    this.shareLink = '';
    this.isShareLinkCopied = false;
    this.shareModalMode = 'internal';
    confirmation?.next(false);
    confirmation?.complete();
    this.cdr.markForCheck();
  }

  /** Switches between the Internal/External share tabs, lazily loading each tab's data on first visit. */
  switchShareTab(mode: 'internal' | 'external'): void {
    if (this.shareModalMode === mode) return;
    this.shareModalMode = mode;
    if (mode === 'internal' && !this.allTenantUsers.length) this.loadTenantUsersForShare();
    if (mode === 'external' && !this.shareLink) this.createExternalShareLink();
  }

  createExternalShareLink(): void {
    if (!this.sharingBoard || this.isCreatingShareLink) return;
    this.isCreatingShareLink = true;
    this.dashboardService.createShareLink(Number(this.sharingBoard.id)).subscribe({
      next: (response) => {
        const data = response.data;
        if (data) this.shareLink = `${window.location.origin}/shared-dashboard/public/${data.dashboardId}?token=${encodeURIComponent(data.token)}`;
        this.isCreatingShareLink = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.showError(err?.error?.message || err?.message || 'Failed to create share link.');
        this.isCreatingShareLink = false;
        this.cdr.markForCheck();
      },
    });
  }

  copyShareLink(): void {
    if (!this.shareLink) return;
    this.isShareLinkCopied = true;
    if (this.shareLinkCopiedTimeout) clearTimeout(this.shareLinkCopiedTimeout);
    this.shareLinkCopiedTimeout = setTimeout(() => {
      this.isShareLinkCopied = false;
      this.cdr.markForCheck();
    }, 2000);

    const copy = navigator.clipboard?.writeText(this.shareLink) ?? this.copyShareLinkFallback();
    copy.catch(() => {
      this.isShareLinkCopied = false;
      this.showError('Unable to copy the share link.');
      this.cdr.markForCheck();
    });
  }

  private copyShareLinkFallback(): Promise<void> {
    const input = document.createElement('textarea');
    input.value = this.shareLink;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(input);
    return copied ? Promise.resolve() : Promise.reject();
  }

  // ─── Share internally ───────────────────────────────────────────────────────

  private loadTenantUsersForShare(): void {
    const currentUser = this.authService.getCurrentUser();
    const tenantId = currentUser?.tenantId;
    if (!tenantId) return;
    this.isLoadingShareUsers = true;
    forkJoin({
      users: this.userManagementService.listUsersByTenant(tenantId, 1, 1000),
      roles: this.userManagementService.listRoles(),
    }).subscribe({
      next: ({ users, roles }) => {
        this.allTenantUsers = users.items.filter(u => u.isActive && u.userId !== currentUser?.userId);
        this.allTenantRoles = roles.items;
        this.isLoadingShareUsers = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.isLoadingShareUsers = false;
        this.showError(err?.error?.message || err?.message || 'Failed to load users.');
        this.cdr.markForCheck();
      },
    });
  }

  get filteredShareUsers(): TenantUserDto[] {
    const term = this.internalShareSearchTerm.trim().toLowerCase();
    return this.allTenantUsers
      .filter(u => !this.internalShareRoleFilter || u.roleCode === this.internalShareRoleFilter)
      .filter(u => !term || (u.displayName || u.email).toLowerCase().includes(term));
  }

  /** Full user records for the currently selected ids, for rendering the selected-user chips. */
  get selectedShareUsers(): TenantUserDto[] {
    return this.allTenantUsers.filter(u => this.selectedShareUserIds.has(u.userId));
  }

  get isAllShareUsersSelected(): boolean {
    const visible = this.filteredShareUsers;
    return visible.length > 0 && visible.every(u => this.selectedShareUserIds.has(u.userId));
  }

  setInternalShareRoleFilter(roleCode: string): void {
    this.internalShareRoleFilter = roleCode;
  }

  setInternalShareSearchTerm(term: string): void {
    this.internalShareSearchTerm = term;
  }

  toggleShareUserSelection(userId: number): void {
    if (this.selectedShareUserIds.has(userId)) this.selectedShareUserIds.delete(userId);
    else this.selectedShareUserIds.add(userId);
  }

  toggleSelectAllShareUsers(): void {
    const visible = this.filteredShareUsers;
    if (this.isAllShareUsersSelected) {
      visible.forEach(u => this.selectedShareUserIds.delete(u.userId));
    } else {
      visible.forEach(u => this.selectedShareUserIds.add(u.userId));
    }
  }

  clearSelectedShareUsers(): void {
    this.selectedShareUserIds.clear();
  }

  /** Two-letter initials for a user's chip/list avatar, e.g. "Maya Roy" -> "MR". */
  shareUserInitials(user: TenantUserDto): string {
    const name = (user.displayName || user.email || '').trim();
    if (!name) return '?';
    const parts = name.split(/\s+/);
    return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
  }

  submitShareInternally(): void {
    if (!this.sharingBoard || this.selectedShareUserIds.size === 0 || this.isSharingInternally) return;
    const board = this.sharingBoard;
    const userIds = [...this.selectedShareUserIds];
    const selectedUsers = [...this.selectedShareUsers];
    this.isSharingInternally = true;
    this.dashboardService.getDashboardById(Number(board.id)).pipe(
      switchMap(response => {
        if (this.sharingBoard !== board || !this.showShareModal) return EMPTY;
        if (!response.success || !response.data) {
          throw new Error(response.message || 'Unable to check existing dashboard shares. Please try again.');
        }
        const config = response.data.configJson ? JSON.parse(response.data.configJson) : {};
        const sharedUserIds: number[] = config?._meta?.sharedWithUserIds ?? [];
        const duplicateNames = selectedUsers
          .filter(user => sharedUserIds.includes(user.userId))
          .map(user => user.displayName || user.email);
        if (duplicateNames.length) {
          this.repeatShareMessage = `Dashboard "${response.data.dashboardName}" is already shared with ${duplicateNames.join(', ')}. Do you want to share it again?`;
          this.repeatShareConfirmation = new Subject<boolean>();
          this.cdr.markForCheck();
          return this.repeatShareConfirmation.pipe(
            take(1),
            switchMap(confirmed => confirmed
              ? this.dashboardService.shareDashboardInternally(Number(board.id), userIds)
              : EMPTY),
          );
        }
        return this.dashboardService.shareDashboardInternally(Number(board.id), userIds);
      }),
      finalize(() => {
        this.isSharingInternally = false;
        this.cdr.markForCheck();
      }),
    ).subscribe({
      next: (response) => {
        if (!response.success) {
          this.showError(response.message || 'Failed to share dashboard.');
          return;
        }
        this.showSuccess(`Shared with ${userIds.length} user(s).`);
        if (this.sharingBoard === board) this.closeShareModal();
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.showError(err?.error?.message || err?.message || 'Failed to share dashboard.');
        this.cdr.markForCheck();
      },
    });
  }

  resolveRepeatShare(confirmed: boolean): void {
    const confirmation = this.repeatShareConfirmation;
    if (!confirmation) return;
    this.repeatShareConfirmation = null;
    this.closeShareModal();
    confirmation.next(confirmed);
    confirmation.complete();
    this.cdr.markForCheck();
  }

  get canContinueToBuilder(): boolean {
    return !!this.newDashboardCategory && !!this.newDashboardName.trim() && !!this.newDashboardDescription.trim();
  }

  openAddDashboardModal(): void {
    this.newDashboardCategory = '';
    this.newDashboardName = '';
    this.newDashboardDescription = '';
    this.showAddDashboardModal = true;
  }

  closeAddDashboardModal(): void {
    this.showAddDashboardModal = false;
  }

  continueToBuilder(): void {
    if (!this.canContinueToBuilder) return;
    this.closeAddDashboardModal();
    this.router.navigate(['/dashboard/board-builder'], {
      queryParams: { name: this.newDashboardName.trim(), category: this.newDashboardCategory, description: this.newDashboardDescription.trim() || undefined },
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

  // ─── Publish ───────────────────────────────────────────────────────────────

  /** Opens the "Publish dashboard?" confirmation instead of publishing immediately. */
  publishBoard(event: Event, board: Board): void {
    event.stopPropagation();
    this.closeBoardMenu();
    if (this.publishingBoardId) return;

    this.publishingBoard = board;
    this.showPublishConfirm = true;
  }

  cancelPublishBoard(): void {
    this.showPublishConfirm = false;
    this.publishingBoard = null;
  }

  /** Runs the actual publish call after the user confirms in the modal. */
  confirmPublishBoard(): void {
    const board = this.publishingBoard;
    if (!board || this.publishingBoardId) return;
    this.showPublishConfirm = false;

    this.publishingBoardId = board.id;
    this.dashboardService.publishDashboard(Number(board.id)).subscribe({
      next: (response) => {
        this.publishingBoardId = null;
        this.publishingBoard = null;
        this.showSuccess(response.data?.message || `'${board.title}' published successfully.`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.publishingBoardId = null;
        this.publishingBoard = null;
        const status = err?.status;
        this.showError(status === 403
          ? 'Dashboards can only be published by Admin users.'
          : err?.error?.message || err?.message || 'Failed to publish dashboard.');
        this.cdr.markForCheck();
      },
    });
  }

  // ─── Complete ──────────────────────────────────────────────────────────────

  completeBoard(event: Event, board: Board): void {
    event.stopPropagation();
    this.closeBoardMenu();
    if (this.completingBoardId) return;

    this.completingBoardId = board.id;
    this.dashboardService.completeDashboard(Number(board.id)).subscribe({
      next: (response) => {
        this.completingBoardId = null;
        this.showSuccess(response.data?.message || `'${board.title}' marked as completed.`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.completingBoardId = null;
        this.showError(err?.error?.message || err?.message || 'Failed to mark dashboard as completed.');
        this.cdr.markForCheck();
      },
    });
  }

  // ─── Reopen (Completed → Draft) ─────────────────────────────────────────────

  reopenBoard(event: Event, board: Board): void {
    event.stopPropagation();
    this.closeBoardMenu();
    if (this.reopeningBoardId) return;

    this.reopeningBoardId = board.id;
    this.dashboardService.reopenDashboard(Number(board.id)).subscribe({
      next: (response) => {
        this.reopeningBoardId = null;
        this.showSuccess(response.data?.message || `'${board.title}' moved back to Draft.`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.reopeningBoardId = null;
        this.showError(err?.error?.message || err?.message || 'Failed to reopen dashboard.');
        this.cdr.markForCheck();
      },
    });
  }

  // ─── Un-publish (toggle active) ────────────────────────────────────────────

  toggleActive(event: Event, board: Board): void {
    event.stopPropagation();
    this.closeBoardMenu();
    if (this.togglingBoardId) return;

    this.togglingBoardId = board.id;
    this.dashboardService.toggleDashboardActive(Number(board.id)).subscribe({
      next: (response) => {
        this.togglingBoardId = null;
        this.showSuccess(response.data?.message || `'${board.title}' ${response.data?.isActive ? 'activated' : 'deactivated'} successfully.`);
        this.cdr.markForCheck();
      },
      error: (err) => {
        this.togglingBoardId = null;
        this.showError(err?.error?.message || err?.message || 'Failed to toggle dashboard state.');
        this.cdr.markForCheck();
      },
    });
  }

  // ─── Notifications ─────────────────────────────────────────────────────────

  private showSuccess(message: string): void { this.notify.showSuccess(message); }
  private showError(message: string): void { this.notify.showError(message); }

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
      if (Math.abs(dx) < WipBoardsComponent.DRAG_THRESHOLD_PX) return;
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

  onCategoryManagerClosed(): void {
    this.showCategoryManager = false;
    this.categoryService.getCategoriesByType('dashboard').subscribe(cats => {
      this.apiCategories = cats;
      [...this.groups, ...this.sharedGroups].forEach(group => {
        const category = cats.find(c => `cat-${c.categoryId}` === group.id);
        if (category) group.description = category.description;
      });
      this.cdr.markForCheck();
    });
  }
}
