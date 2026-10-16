import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { CategoryService } from '../../../core/services/category.service';
import { CategoryDropdown } from '../../../core/models/category.model';
import { WidgetService, Widget } from '../../../core/services/widget.service';
import { NotificationHelper } from '../../../core/helpers/notification.helper';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/services/auth.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ListRouteReuseStrategy } from '../../../core/services/list-route-reuse.strategy';
import { collapseGroupsOnReenter } from '../../../core/utils/collapse-groups-on-reenter';

const TILE_CONTROL_TYPE = 3;

export type TileAccent = 'purple' | 'blue' | 'green' | 'orange' | 'coral';

export interface TileItem {
  id: string;
  title: string;
  description: string;
  category: string;
  accent: TileAccent;
  icon: string;
  favorite: boolean;
  recentlyViewed: boolean;
  statLabel: string;
  statValue: string;
  status: string;
  widget?: Widget;
}

export type TileGroupIcon = 'settings' | 'productivity' | 'crew';

export interface TileGroup {
  category: string;
  description?: string;
  icon: TileGroupIcon;
  tiles: TileItem[];
  expanded: boolean;
}

type TabId = 'all' | 'favorites' | 'recent' | 'draft' | 'completed';
type ViewMode = 'grid' | 'list';
type SortOption = 'default' | 'newest' | 'oldest' | 'name-az' | 'name-za' | 'most-charts';
type PageMode = 'wip' | 'standard';

@Component({
  selector: 'app-wip-tiles',
  standalone: false,
  templateUrl: './wip-tiles.component.html',
  styleUrls: ['./wip-tiles.component.scss'],
})
export class WipTilesComponent implements OnInit, OnDestroy {
  private readonly notify: NotificationHelper;
  get successMessage(): string { return this.notify.successMessage; }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly categoryService: CategoryService,
    private readonly widgetService: WidgetService,
    private readonly cdr: ChangeDetectorRef,
    private readonly toastService: ToastService,
    private readonly authService: AuthService,
    private readonly permissionService: PermissionService,
    private readonly listRouteReuse: ListRouteReuseStrategy,
  ) {
    this.notify = new NotificationHelper(cdr);
  }

  get isAdmin(): boolean { return this.authService.isAdmin(); }
  mode: PageMode = 'wip';
  get isPublishedMode(): boolean { return this.mode === 'standard'; }
  private get moduleCode(): string { return this.isPublishedMode ? 'charts.standard-tiles' : 'charts.wip-tiles'; }
  get canCreate(): boolean { return this.permissionService.canCreate(this.moduleCode); }
  get canManageCategories(): boolean { return this.permissionService.canView('charts.categories'); }
  get canModify(): boolean { return this.permissionService.canModify(this.moduleCode); }
  get canAdmin(): boolean { return this.permissionService.canAdmin(this.moduleCode); }
  canEditTile(tile: TileItem): boolean {
    return this.canModify && !!tile.widget && tile.status !== 'published';
  }
  get pageTitle(): string {
    if (this.mode === 'standard') return 'Standard Tiles';
    return this.isAdmin ? 'WIP Tiles' : 'My Tiles';
  }
  get pageSubtitle(): string {
    if (this.isPublishedMode) return 'Explore Standard Tiles';
    return this.isAdmin ? 'Manage work in progress Tiles' : 'Create, View and Manage your Tiles';
  }

  // Groups for published/standard mode
  tileGroups: TileGroup[] = [];

  apiCategories: CategoryDropdown[] = [];
  private categorySub!: Subscription;
  private reenterSub!: Subscription;
  newTileCategoryId = 0;
  newTileCategoryName = '';
  addModalCategoryOpen = false;
  addModalCategorySearch = '';

  toggleAddModalCategory(event: Event): void {
    event.stopPropagation();
    this.addModalCategoryOpen = !this.addModalCategoryOpen;
    if (this.addModalCategoryOpen) this.addModalCategorySearch = '';
  }

  get filteredAddModalCategories(): CategoryDropdown[] {
    const term = this.addModalCategorySearch.trim().toLowerCase();
    if (!term) return this.apiCategories;
    return this.apiCategories.filter(c => c.categoryName.toLowerCase().includes(term));
  }

  selectAddModalCategory(categoryId: number, categoryName: string): void {
    this.newTileCategoryId = categoryId;
    this.newTileCategoryName = categoryName;
    this.addModalCategoryOpen = false;
  }

  ngOnInit(): void {
    this.mode = (this.route.snapshot.data['mode'] as PageMode) ?? 'wip';
    const pending = this.toastService.consume();
    if (pending) this.notify.showSuccess(pending);
    this.reenterSub = collapseGroupsOnReenter(this.router, ['wip-tiles', 'standard-tiles'], () => this.tileGroups, () => this.cdr.markForCheck(), () => {
      this.searchTerm = '';
      this.sortOption = 'default';
      this.categoryFilter = [];
      this.categoryOpen = false;
      this.sortOpen = false;
      this.computeGroupOrder();
      this.cdr.markForCheck();
    });
    let wasActive = true;
    this.reenterSub.add(this.router.events.subscribe(event => {
      if (!(event instanceof NavigationEnd)) return;
      const containsRoute = (route: ActivatedRoute): boolean =>
        route === this.route || route.children.some(containsRoute);
      const isActive = containsRoute(this.router.routerState.root);
      if (isActive && !wasActive) {
        this.isLoading = true;
        this.loadTiles();
        const message = this.toastService.consume();
        if (message) this.notify.showSuccess(message);
      }
      wasActive = isActive;
    }));
    this.categorySub = this.categoryService.getCategoriesByType('tile').subscribe((cats) => {
      this.apiCategories = cats;
      this.tileGroups.forEach(g => { g.description = cats.find(c => c.categoryName === g.category)?.description; });
      this.cdr.markForCheck();
    });
    this.loadTiles();
  }

  private favouriteIds = new Set<number>();
  private recentIds: number[] = [];
  private locallyViewedIds: number[] = [];

  private loadTilePreferences(): void {
    this.widgetService.getFavourites(TILE_CONTROL_TYPE).subscribe({
      next: (prefs) => {
        this.favouriteIds = new Set(prefs.map(p => p.controlId));
        this.tiles = this.tiles.map(t => ({ ...t, favorite: this.favouriteIds.has(Number(t.id)) }));
        this.tileGroups = this.tileGroups.map(g => ({
          ...g, tiles: g.tiles.map(t => ({ ...t, favorite: this.favouriteIds.has(Number(t.id)) }))
        }));
        if (!this.tileGroups.some(g => g.expanded)) this.computeGroupOrder();
        this.cdr.markForCheck();
      }, error: () => { /* suppress */ },
    });
    this.widgetService.getRecentlyViewed(TILE_CONTROL_TYPE, 50).subscribe({
      next: (prefs) => {
        this.recentIds = [...new Set([...this.locallyViewedIds, ...prefs.map(p => p.controlId)])];
        this.tiles = this.tiles.map(t => ({ ...t, recentlyViewed: this.recentIds.includes(Number(t.id)) }));
        this.tileGroups = this.tileGroups.map(g => ({
          ...g, tiles: g.tiles.map(t => ({ ...t, recentlyViewed: this.recentIds.includes(Number(t.id)) }))
        }));
        if (!this.tileGroups.some(g => g.expanded)) this.computeGroupOrder();
        this.cdr.markForCheck();
      }, error: () => { /* suppress */ },
    });
  }

  // Requests against a local/dev API can resolve in a few ms — too fast for the
  // loader to ever be visible on screen. Holding it up for a minimum stretch
  // keeps it perceptible without meaningfully slowing down real network calls.
  private static readonly MIN_LOADER_MS = 300;

  private stopLoading(startedAt: number): void {
    const elapsed = Date.now() - startedAt;
    if (elapsed >= WipTilesComponent.MIN_LOADER_MS) {
      this.isLoading = false;
      this.cdr.markForCheck();
    } else {
      setTimeout(() => { this.isLoading = false; this.cdr.markForCheck(); }, WipTilesComponent.MIN_LOADER_MS - elapsed);
    }
  }

  private loadTiles(): void {
    const status = this.isPublishedMode ? 'published' : undefined;
    const startedAt = Date.now();
    this.widgetService.getWidgets(status, 'tile').subscribe({
      next: (widgets) => {
        const allTiles = widgets
          .filter((w: Widget) => this.isPublishedMode ? w.status === 'published' : w.status !== 'published')
          .map((w: Widget) => {
            let design: Record<string, unknown> = {};
            try { design = JSON.parse(w.designJson ?? '{}'); } catch { /* ignore */ }
            const accents: TileAccent[] = ['purple', 'blue', 'green', 'orange', 'coral'];
            return {
              id: String(w.id),
              title: w.name,
              description: w.description || `${w.source ?? ''} — ${(design['aggregation'] as string) ?? 'count'}`,
              category: w.categoryName ?? 'Uncategorized',
              accent: accents[w.id % accents.length] as TileAccent,
              icon: (design['tileIcon'] as string) ?? 'well',
              // Carry the already-known preference flags over; resetting them to false here would
              // empty the Favorites/Recent tabs until loadTilePreferences() completes a second round-trip.
              favorite: this.favouriteIds.has(w.id),
              recentlyViewed: this.recentIds.includes(w.id),
              statLabel: w.name.toUpperCase(),
              statValue: '—',
              status: w.status ?? 'draft',
              widget: w,
            };
          });

        if (this.isPublishedMode) {
          // Group by category for published/standard view
          const grouped = new Map<string, TileItem[]>();
          allTiles.forEach(t => {
            if (!grouped.has(t.category)) grouped.set(t.category, []);
            grouped.get(t.category)!.push(t);
          });
          const icons: TileGroupIcon[] = ['settings', 'productivity', 'crew'];
          let iconIdx = 0;
          this.tileGroups = Array.from(grouped.entries()).map(([category, tiles]) => ({
            category,
            description: this.apiCategories.find(c => c.categoryName === category)?.description,
            icon: icons[iconIdx++ % 3],
            tiles,
            expanded: false,
          }));
          this.computeGroupOrder();
        } else {
          // Group by category for wip/my view too
          const grouped = new Map<string, TileItem[]>();
          allTiles.forEach(t => {
            if (!grouped.has(t.category)) grouped.set(t.category, []);
            grouped.get(t.category)!.push(t);
          });
          const icons: TileGroupIcon[] = ['settings', 'productivity', 'crew'];
          let iconIdx = 0;
          this.tileGroups = Array.from(grouped.entries()).map(([category, tiles]) => ({
            category,
            description: this.apiCategories.find(c => c.categoryName === category)?.description,
            icon: icons[iconIdx++ % 3],
            tiles,
            expanded: false,
          }));
          this.computeGroupOrder();
          this.tiles = allTiles;
        }
        this.stopLoading(startedAt);
        this.loadTilePreferences();
      },
      error: () => {
        this.stopLoading(startedAt);
      },
    });
  }

  toggleGroup(group: TileGroup): void {
    const isOpen = !!this.tileGroups.find(g => g.category === group.category)?.expanded;
    // accordion: close all groups, then open the clicked one if it was closed
    this.tileGroups.forEach(g => { g.expanded = false; });
    const source = this.tileGroups.find(g => g.category === group.category);
    if (source) source.expanded = !isOpen;
  }

  trackByGroup(_index: number, group: TileGroup): string {
    return group.category;
  }

  openTile(tile: TileItem): void {
    const tileId = Number(tile.id);
    tile.recentlyViewed = true;
    this.locallyViewedIds = [tileId, ...this.locallyViewedIds.filter(id => id !== tileId)];
    this.recentIds = [tileId, ...this.recentIds.filter(id => id !== tileId)];
    this.tiles.forEach(item => {
      if (item.id === tile.id) item.recentlyViewed = true;
    });
    this.tileGroups.forEach(group => group.tiles.forEach(item => {
      if (item.id === tile.id) item.recentlyViewed = true;
    }));
    this.widgetService.trackView(TILE_CONTROL_TYPE, tileId).subscribe({ error: () => {} });
    this.router.navigate(['/charts-tiles/view', tile.id], { queryParams: { type: 'tile', from: this.isPublishedMode ? 'standard' : 'wip' } });
  }

  editTile(tile: TileItem): void {
    this.router.navigate(['/charts-tiles/tile-builder'], { queryParams: { editId: tile.id } });
  }

  openMenuId: string | null = null;

  toggleMenu(tile: TileItem): void {
    this.openMenuId = this.openMenuId === tile.id ? null : tile.id;
  }

  closeMenu(): void { this.openMenuId = null; }

  markTileAsCompleted(tile: TileItem): void {
    this.closeMenu();
    const w = tile.widget;
    if (!w) return;
    this.widgetService.updateWidget(Number(tile.id), {
      name: w.name, type: w.type, libraryId: w.libraryId,
      source: w.source, sourceType: w.sourceType,
      sourceId: w.sourceId ?? null, description: w.description,
      designJson: w.designJson, categoryId: w.categoryId, status: 'completed',
    }).subscribe({
      next: () => { this.notify.showSuccess(`'${tile.title}' marked as completed.`); this.loadTiles(); },
      error: () => this.notify.showError(`Failed to mark '${tile.title}' as completed.`),
    });
  }

  moveTileToDraft(tile: TileItem): void {
    this.closeMenu();
    const w = tile.widget;
    if (!w) return;
    this.widgetService.updateWidget(Number(tile.id), {
      name: w.name, type: w.type, libraryId: w.libraryId,
      source: w.source, sourceType: w.sourceType,
      sourceId: w.sourceId ?? null, description: w.description,
      designJson: w.designJson, categoryId: w.categoryId, status: 'draft',
    }).subscribe({
      next: () => { this.notify.showSuccess(`'${tile.title}' moved to Draft.`); this.loadTiles(); },
      error: () => this.notify.showError(`Failed to move '${tile.title}' to Draft.`),
    });
  }

  showUnpublishConfirm = false;
  pendingUnpublishTile: TileItem | null = null;
  unpublishConfirmBusy = false;

  /** Opens the "Unpublish tile?" confirmation instead of unpublishing immediately. */
  togglePublish(tile: TileItem): void {
    if (this.isPublishedMode) {
      if (!tile.widget) {
        this.notify.showError(`Failed to unpublish '${tile.title}'.`);
        this.closeMenu();
        return;
      }
      this.pendingUnpublishTile = tile;
      this.showUnpublishConfirm = true;
      this.cdr.markForCheck();
    } else {
      this.publishTile(tile);
    }
    this.closeMenu();
  }

  cancelUnpublishTile(): void {
    this.showUnpublishConfirm = false;
    this.pendingUnpublishTile = null;
    this.cdr.markForCheck();
  }

  /** Runs the actual unpublish call after the user confirms in the modal. */
  confirmUnpublishTile(): void {
    const tile = this.pendingUnpublishTile;
    const w = tile?.widget;
    if (!tile || !w || this.unpublishConfirmBusy) return;
    this.unpublishConfirmBusy = true;
    this.widgetService.updateWidget(Number(tile.id), {
      name: w.name,
      type: w.type,
      libraryId: w.libraryId ?? 0,
      source: w.source ?? '',
      sourceType: w.sourceType ?? 'Table',
      sourceId: w.sourceId ?? null,
      description: w.description ?? '',
      designJson: w.designJson ?? '',
      categoryId: w.categoryId,
      status: 'draft',
    }).subscribe({
      next: () => {
        this.unpublishConfirmBusy = false;
        this.showUnpublishConfirm = false;
        this.pendingUnpublishTile = null;
        this.notify.showSuccess(`'${tile.title}' unpublished successfully.`);
        this.loadTiles();
      },
      error: () => {
        this.unpublishConfirmBusy = false;
        this.showUnpublishConfirm = false;
        this.pendingUnpublishTile = null;
        this.notify.showError(`Failed to unpublish '${tile.title}'.`);
        this.cdr.markForCheck();
      },
    });
  }

  pendingDeleteTile: TileItem | null = null;

  confirmDeleteTile(tile: TileItem): void {
    this.closeMenu();
    this.pendingDeleteTile = tile;
  }

  cancelDelete(): void { this.pendingDeleteTile = null; }

  executeDelete(): void {
    const tile = this.pendingDeleteTile;
    this.pendingDeleteTile = null;
    if (!tile) return;
    this.widgetService.deleteWidget(Number(tile.id)).subscribe({
      next: () => {
        this.notify.showSuccess(`'${tile.title}' deleted successfully.`);
        this.loadTiles();
      },
      error: () => this.notify.showError(`Failed to delete '${tile.title}'.`),
    });
  }

  publishTile(tile: TileItem): void {
    this.closeMenu();
    if (!tile.widget) return;
    this.pendingPublishTile = tile;
    this.showPublishConfirm = true;
    this.cdr.markForCheck();
  }

  cancelPublishTile(): void {
    this.showPublishConfirm = false;
    this.pendingPublishTile = null;
    this.cdr.markForCheck();
  }

  // ─── Publish confirmation ───────────────────────────────────────────────────
  showPublishConfirm = false;
  pendingPublishTile: TileItem | null = null;
  publishConfirmBusy = false;

  /** Runs the actual publish call after the user confirms in the modal. */
  confirmPublishTile(): void {
    const tile = this.pendingPublishTile;
    const w = tile?.widget;
    if (!tile || !w || this.publishConfirmBusy) return;
    this.publishConfirmBusy = true;
    this.widgetService.updateWidget(Number(tile.id), {
      name: w.name,
      type: w.type,
      libraryId: w.libraryId ?? 0,
      source: w.source ?? '',
      sourceType: w.sourceType ?? 'Table',
      sourceId: w.sourceId ?? null,
      description: w.description ?? '',
      designJson: w.designJson ?? '',
      categoryId: w.categoryId ?? 2,
      status: 'published',
    }).subscribe({
      next: () => {
        this.publishConfirmBusy = false;
        this.showPublishConfirm = false;
        this.pendingPublishTile = null;
        this.notify.showSuccess(`'${tile.title}' published successfully.`);
        this.loadTiles();
      },
      error: () => {
        this.publishConfirmBusy = false;
        this.showPublishConfirm = false;
        this.pendingPublishTile = null;
        this.notify.showError(`Failed to publish '${tile.title}'.`);
        this.cdr.markForCheck();
      },
    });
  }

  copyTileToDraft(tile: TileItem): void {
    this.closeMenu();
    this.widgetService.copyWidgetToDraft(Number(tile.id)).subscribe({
      next: (copy) => {
        this.listRouteReuse.invalidate('wip-tiles');
        this.toastService.pending = `'${copy.name}' copied to Draft.`;
        this.router.navigate(['/charts-tiles/wip-tiles']);
      },
      error: () => this.notify.showError(`Failed to copy '${tile.title}' to Draft.`),
    });
  }

  ngOnDestroy(): void {
    this.categorySub?.unsubscribe();
    this.reenterSub?.unsubscribe();
    this.notify.destroy();
  }

  activeTab: TabId = 'all';
  viewMode: ViewMode = 'grid';
  sortOption: SortOption = 'default';
  categoryFilter: string[] = [];
  searchTerm = '';
  categoryOpen = false;
  sortOpen = false;
  isLoading = true;

  readonly sortItems: { value: SortOption; label: string; icon: string }[] = [
    { value: 'default',     label: 'Default', icon: 'default'     },
    { value: 'newest',      label: 'Newest First',  icon: 'newest'      },
    { value: 'oldest',      label: 'Oldest First',  icon: 'oldest'      },
    { value: 'name-az',     label: 'Name A-Z',      icon: 'name-az'     },
    { value: 'name-za',     label: 'Name Z-A',      icon: 'name-za'     },
    { value: 'most-charts', label: 'Most Tiles',    icon: 'most-charts' },
  ];

  get sortButtonLabel(): string {
    if (this.sortOption === 'default') return 'Sort';
    return this.sortItems.find(i => i.value === this.sortOption)?.label ?? 'Sort';
  }

  showAddTileModal = false;
  showCategoryManager = false;
  newTileCategory = '';
  newTileName = '';
  newTileDescription = '';

  get canContinueAddTile(): boolean {
    return !!this.newTileCategoryId && !!this.newTileName.trim() && !!this.newTileDescription.trim();
  }

  tiles: TileItem[] = Array.from({ length: 10 }, (_, i) => ({
    id: `active-wells-${i + 1}`,
    title: 'Active Wells',
    description: 'Wells currently active across all clusters',
    category: 'Operations',
    accent: 'purple' as TileAccent,
    icon: 'well',
    favorite: i < 5,
    recentlyViewed: i < 3,
    statLabel: 'ACTIVE WELLS',
    statValue: '128',
    status: 'draft',
  }));

  get tabs(): { id: TabId; label: string; count: number }[] {
    const src = this.isPublishedMode ? this.tileGroups.flatMap(g => g.tiles) : this.tiles;
    const tabs: { id: TabId; label: string; count: number }[] = [
      { id: 'all', label: 'All', count: src.length },
      { id: 'favorites', label: 'Favorites', count: src.filter(t => t.favorite).length },
      { id: 'recent', label: 'Recent', count: src.filter(t => t.recentlyViewed).length },
    ];
    if (!this.isPublishedMode) {
      tabs.push(
        { id: 'draft', label: 'Draft', count: src.filter(t => t.status === 'draft').length },
        { id: 'completed', label: 'Completed', count: src.filter(t => t.status === 'completed').length },
      );
    }
    return tabs;
  }

  get categoryOptions(): { value: string; label: string }[] {
    return this.apiCategories.map(c => ({ value: c.categoryName, label: c.categoryName }));
  }

  get visibleTileGroups(): TileGroup[] {
    const term = this.searchTerm.trim().toLowerCase();
    return this.tileGroups
      .map(g => {
        let tiles = g.tiles
          .filter(t => {
            if (this.activeTab === 'all') return true;
            if (this.activeTab === 'favorites') return t.favorite;
            if (this.activeTab === 'draft') return t.status === 'draft';
            if (this.activeTab === 'completed') return t.status === 'completed';
            return t.recentlyViewed;
          })
          .filter(t => this.categoryFilter.length === 0 || this.categoryFilter.includes(t.category))
          .filter(t => !term || t.title.toLowerCase().includes(term));

        if (!this.isPublishedMode && this.sortOption === 'default') {
          tiles = [...tiles].sort((a, b) => this.createdRank(b) - this.createdRank(a));
        }

        if (this.sortOption === 'name-az') {
          tiles = [...tiles].sort((a, b) => a.title.localeCompare(b.title));
        } else if (this.sortOption === 'name-za') {
          tiles = [...tiles].sort((a, b) => b.title.localeCompare(a.title));
        } else if (this.sortOption === 'newest') {
          tiles = [...tiles].sort((a, b) => this.recentRank(a.id) - this.recentRank(b.id));
        } else if (this.sortOption === 'oldest') {
          tiles = [...tiles].sort((a, b) => this.recentRank(b.id) - this.recentRank(a.id));
        } else if (this.sortOption === 'most-charts') {
          tiles = [...tiles].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
        }

        // Recent tab defaults to last-viewed-first within each category
        if (this.activeTab === 'recent' && this.sortOption === 'default') {
          tiles = [...tiles].sort((a, b) => this.recentRank(a.id) - this.recentRank(b.id));
        }

        return { ...g, tiles };
      })
      .filter(g => g.tiles.length > 0)
      .sort((a, b) => {
        if (this.activeTab === 'recent' && this.sortOption === 'default') return this.recentGroupRank(a.tiles) - this.recentGroupRank(b.tiles);
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
  private createdRank(item: TileItem): number {
    return item.widget?.id ?? 0;
  }

  get visibleTiles(): TileItem[] {
    const term = this.searchTerm.trim().toLowerCase();

    let tiles = this.tiles
      .filter(t => {
        if (this.activeTab === 'all') return true;
        if (this.activeTab === 'favorites') return t.favorite;
        if (this.activeTab === 'draft') return t.status === 'draft';
        if (this.activeTab === 'completed') return t.status === 'completed';
        return t.recentlyViewed;
      })
      .filter(t => this.categoryFilter.length === 0 || this.categoryFilter.includes(t.category))
      .filter(t => !term || t.title.toLowerCase().includes(term));

    if (!this.isPublishedMode && this.sortOption === 'default') {
      tiles = [...tiles].sort((a, b) => this.createdRank(b) - this.createdRank(a));
    }

    if (this.sortOption === 'name-az') {
      tiles = [...tiles].sort((a, b) => a.title.localeCompare(b.title));
    } else if (this.sortOption === 'name-za') {
      tiles = [...tiles].sort((a, b) => b.title.localeCompare(a.title));
    } else if (this.sortOption === 'newest') {
      tiles = [...tiles].sort((a, b) => this.recentRank(a.id) - this.recentRank(b.id));
    } else if (this.sortOption === 'oldest') {
      tiles = [...tiles].sort((a, b) => this.recentRank(b.id) - this.recentRank(a.id));
    } else if (this.sortOption === 'most-charts') {
      tiles = [...tiles].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
    }

    // Recent tab defaults to last-viewed-first
    if (this.activeTab === 'recent' && this.sortOption === 'default') {
      tiles = [...tiles].sort((a, b) => this.recentRank(a.id) - this.recentRank(b.id));
    }

    return tiles;
  }

  trackByTile(_index: number, tile: TileItem): string {
    return tile.id;
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
    if (!this.tileGroups.some(g => g.expanded)) this.computeGroupOrder();
  }

  /** Snapshot of category keys in current sortOption order — recomputed only when nothing is expanded. */
  private groupOrder: string[] = [];

  private computeGroupOrder(): void {
    const sorted = [...this.tileGroups].sort((a, b) => {
      if (this.sortOption === 'name-az') return a.category.localeCompare(b.category);
      if (this.sortOption === 'name-za') return b.category.localeCompare(a.category);
      if (this.sortOption === 'newest') return this.recentGroupRank(a.tiles) - this.recentGroupRank(b.tiles);
      if (this.sortOption === 'oldest') return this.recentGroupRank(b.tiles) - this.recentGroupRank(a.tiles);
      if (this.sortOption === 'most-charts') return b.tiles.length - a.tiles.length;
      return 0;
    });
    this.groupOrder = sorted.map(g => g.category);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.categoryOpen = false;
    this.sortOpen = false;
    this.addModalCategoryOpen = false;
    this.openMenuId = null;
  }

  setTab(id: TabId): void {
    this.activeTab = id;
    // Recently-viewed can change while this reused route stays alive; refresh on demand.
    if (id === 'recent') this.loadTiles();
  }

  setViewMode(mode: ViewMode): void {
    this.viewMode = mode;
    const visibleGroups = this.visibleTileGroups;
    if (visibleGroups.length && !visibleGroups.some(group => group.expanded)) {
      this.toggleGroup(visibleGroups[0]);
    }
  }

  toggleFavorite(tile: TileItem): void {
    const id = Number(tile.id);
    const newState = !tile.favorite;
    this.applyFavouriteState(id, newState); // optimistic
    this.widgetService.toggleFavourite(TILE_CONTROL_TYPE, id).subscribe({
      next: (pref) => { this.applyFavouriteState(id, pref.isFavourite); this.cdr.markForCheck(); },
      error: () => { this.applyFavouriteState(id, !newState); this.cdr.markForCheck(); },
    });
  }

  /** Keep favourite state consistent across favouriteIds, the flat list and the grouped list. */
  private applyFavouriteState(id: number, fav: boolean): void {
    if (fav) this.favouriteIds.add(id); else this.favouriteIds.delete(id);
    this.tiles = this.tiles.map(t => Number(t.id) === id ? { ...t, favorite: fav } : t);
    this.tileGroups = this.tileGroups.map(g => ({
      ...g, tiles: g.tiles.map(t => Number(t.id) === id ? { ...t, favorite: fav } : t),
    }));
  }

  openAddTileModal(): void {
    this.newTileCategory = '';
    this.newTileCategoryId = 0;
    this.newTileCategoryName = '';
    this.addModalCategoryOpen = false;
    this.addModalCategorySearch = '';
    this.newTileName = '';
    this.newTileDescription = '';
    this.showAddTileModal = true;
  }

  closeAddTileModal(): void { this.showAddTileModal = false; }

  continueToBuilder(): void {
    if (!this.canContinueAddTile) return;
    const catId = Number(this.newTileCategoryId);
    const cat = this.apiCategories.find(c => c.categoryId === catId);
    this.closeAddTileModal();
    this.router.navigate(['/charts-tiles/tile-builder'], {
      queryParams: { name: this.newTileName, description: this.newTileDescription, categoryId: catId, category: cat?.categoryName ?? '' },
    });
  }

  onCategoryManagerClosed(): void {
    this.showCategoryManager = false;
    this.categoryService.getCategoriesByType('tile').subscribe(cats => {
      this.apiCategories = cats;
      this.tileGroups.forEach(g => { g.description = cats.find(c => c.categoryName === g.category)?.description; });
      this.cdr.markForCheck();
    });
  }

  private static readonly DRAG_THRESHOLD_PX = 5;
  private dragState: { el: HTMLElement; pointerId: number; startX: number; startScrollLeft: number; dragging: boolean } | null = null;

  onCardsPointerDown(event: PointerEvent, el: HTMLElement): void {
    // defer capture until movement — capturing on every pointerdown retargets click to the container
    this.dragState = { el, pointerId: event.pointerId, startX: event.clientX, startScrollLeft: el.scrollLeft, dragging: false };
  }

  onCardsPointerMove(event: PointerEvent): void {
    if (!this.dragState) return;
    const dx = event.clientX - this.dragState.startX;
    if (!this.dragState.dragging) {
      if (Math.abs(dx) < WipTilesComponent.DRAG_THRESHOLD_PX) return;
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
