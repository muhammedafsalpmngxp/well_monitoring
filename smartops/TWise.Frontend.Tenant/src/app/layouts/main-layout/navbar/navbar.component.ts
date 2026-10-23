import { Component, ChangeDetectorRef, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { CommonModule, Location, formatDate } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { Observable, Subject, Subscription, interval, merge, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, startWith, switchMap, tap, timeout } from 'rxjs/operators';
import { AuthService } from '../../../core/services/auth.service';
import { CommonApiService } from '../../../core/services/common-api.service';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ROUTES } from '../../../core/constants/route.constants';
import { FontSizeService, FontSizePreset } from '../../../core/services/font-size.service';
import { GlobalSearchService, GlobalSearchResult } from '../../../core/services/global-search.service';
import { NotificationsAggregatorService } from '../../../core/services/notifications-aggregator.service';
import { ControlPlaneNotificationsService } from '../../../core/services/control-plane-notifications.service';
import { NotificationRefreshService } from '../../../core/services/notification-refresh.service';
import { AskAiPanelService } from '../../../core/services/ask-ai-panel.service';
import { AiFeatures, AiService } from '../../../core/services/ai.service';
import { NotificationItem as CoreNotificationItem } from '../../../core/models/notification.model';

import { A11yDialogDirective } from '../../../shared/directives/a11y-dialog.directive';
import { KeyClickDirective } from '../../../shared/directives/key-click.directive';
import { FieldLabelDirective } from '../../../shared/directives/field-label.directive';
interface AiQuickAction {
  label: string;
  icon: 'summarize' | 'issue' | 'report';
}

interface AiMessage {
  sender: 'ai' | 'user';
  text: string;
  time: string;
  bullets?: string[];
}

/**
 * One navbar-bell entry. Notification sources are pluggable (see NOTIFICATION_SOURCES in
 * app.config.ts) — this UI-only wrapper just adds the client-only `unread`/`timeAgo` state on
 * top of the generic NotificationItem each source already returns.
 */
interface DisplayNotification extends CoreNotificationItem {
  timeAgo: string;
  unread: boolean;
}

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [FieldLabelDirective, A11yDialogDirective, KeyClickDirective, CommonModule, FormsModule, RouterModule],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss'],
})
export class NavbarComponent implements OnInit, OnDestroy {
  @Output() menuToggle = new EventEmitter<void>();
  @Input() isSidebarCollapsed = false;
  @Output() sidebarCollapseToggle = new EventEmitter<void>();

  readonly settingsRoute = `/${ROUTES.SETTINGS}`;
  readonly agenticAiRoute = `/${ROUTES.AGENTIC_AI}`;
  readonly alertsRoute = `/${ROUTES.SMART_ALERTS}/alerts`;

  isUserMenuOpen = false;
  isFontSizeMenuOpen = false;
  isNotificationsOpen = false;
  // MM-DD-YYYY, hh.mm AM/PM in Oman time; null until the first successful load.
  lastSyncedLabel: string | null = null;
  syncTimeChecked = false;

  private static readonly SYNC_POLL_MS = 5 * 60 * 1000;
  private static readonly OMAN_UTC_OFFSET = '+0400';
  private syncSub?: Subscription;

  notifications: DisplayNotification[] = [];

  // Read/unread state is real and persisted server-side (control.NotificationRecipient.is_read) —
  // only the fetch LOOKBACK window is client-side (how far back to even ask for), not the seen
  // marker. Poll interval is intentionally coarse (60s) and only fetches a small, SQL-bounded
  // "what's in the last N days" set, never a full listing, to avoid hammering the backend.
  private static readonly NOTIF_LOOKBACK_DAYS = 30;
  private static readonly NOTIF_POLL_MS = 60000;
  private notifSub?: Subscription;

  get newNotificationsCount(): number { return this.notifications.filter(n => n.unread).length; }


  isAiAssistantOpen = false;
  isAiAssistantExpanded = false;
  aiDraftMessage = '';

  readonly aiQuickActions: AiQuickAction[] = [
    { label: 'Summarize this page', icon: 'summarize' },
    { label: 'Find workflow Issue', icon: 'issue' },
    { label: 'Generate report', icon: 'report' },
  ];

  aiMessages: AiMessage[] = [
    {
      sender: 'ai',
      text: "Hi there! I'm Jenny, your AI mate. I can help you with summaries, insights, reports, and more. What would you like to explore today?",
      time: '11:13 AM',
    },
    {
      sender: 'user',
      text: 'Can you summarize the key workflow issue on this page ?',
      time: '11:13 AM',
    },
    {
      sender: 'ai',
      text: "Sure! Here's a summary of the key workflow issues I found on this page.",
      time: '11:13 AM',
      bullets: ['3 overdue tasks in the approval step', '3 overdue tasks in the approval step'],
    },
  ];

  orgLabel = 'Tasnim Maps';
  language: 'en' | 'ar' = 'en';
  theme: 'light' | 'dark' | 'contrast' = 'light';

  // Global search (boards, charts, tiles, reports)
  searchTerm = '';
  searchResults: GlobalSearchResult[] = [];
  isSearching = false;
  showSearchResults = false;
  private readonly searchInput$ = new Subject<string>();
  private readonly searchSub: Subscription;
  // Must match GlobalSearchHandler.MaxResults on the backend — if the last fetch hit this cap it
  // may be missing matches for a more specific term, so we can't safely refine it client-side.
  private static readonly MAX_RESULTS_CAP = 50;
  private lastSearchTerm = '';
  private lastSearchResults: GlobalSearchResult[] = [];

  /** Which AI features this user may use; the sparkle button hides when Ask is off. */
  readonly aiFeatures$: Observable<AiFeatures>;

  constructor(
    private readonly authService: AuthService,
    private readonly breadcrumbService: BreadcrumbService,
    private readonly permissionService: PermissionService,
    private readonly router: Router,
    private readonly location: Location,
    private readonly globalSearchService: GlobalSearchService,
    private readonly notificationsAggregator: NotificationsAggregatorService,
    private readonly controlPlaneNotifications: ControlPlaneNotificationsService,
    private readonly notificationRefreshService: NotificationRefreshService,
    private readonly cdr: ChangeDetectorRef,
    private readonly commonApi: CommonApiService,
    readonly fontSizeService: FontSizeService,
    readonly askAi: AskAiPanelService,
    private readonly aiService: AiService,
  ) {
    this.aiFeatures$ = this.aiService.features();
    this.searchSub = this.searchInput$
      .pipe(
        debounceTime(200),
        distinctUntilChanged(),
        switchMap(term => {
          const q = term.trim();
          if (!q) return of<GlobalSearchResult[]>([]);
          this.isSearching = true;
          // timeout() bounds the worst case to 8s so a slow/blocked backend query never leaves
          // the UI stuck on "Searching…" indefinitely. catchError is on the inner observable
          // (not subscribe's error) so one failed request can't terminate this subscription and
          // silently kill every search after it.
          return this.globalSearchService.search(q).pipe(
            timeout(8000),
            catchError(() => of<GlobalSearchResult[]>([])),
          );
        }),
      )
      .subscribe(results => {
        this.isSearching = false;
        this.searchResults = results;
        this.showSearchResults = true;
        this.lastSearchTerm = this.searchTerm.trim().toLowerCase();
        this.lastSearchResults = results;
        // This is a lightweight hint for Angular to re-check the view when the observable
        // resolves asynchronously. The component uses the default change-detection strategy,
        // so the real bottleneck is usually the search latency itself, not CD alone.
        this.cdr.markForCheck();
      });
  }

  ngOnInit(): void {
    this.pollShareNotifications();
    // Merges the 60s timer with an on-demand signal (e.g. DataQualityService calling
    // NotificationRefreshService.requestRefresh() right after a rule trigger succeeds) so the
    // bell updates immediately for the acting user instead of waiting for the next tick.
    this.notifSub = merge(interval(NavbarComponent.NOTIF_POLL_MS), this.notificationRefreshService.refreshRequested$)
      .subscribe(() => this.pollShareNotifications());

    // A failed poll keeps the last known sync time rather than blanking the badge.
    this.syncSub = interval(NavbarComponent.SYNC_POLL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.commonApi.getSyncTime().pipe(
          timeout(15000),
          catchError(() => of(null)),
        )),
      )
      .subscribe(response => {
        if (response?.omanTimestamp) {
          this.lastSyncedLabel = formatDate(
            response.omanTimestamp, 'MM-dd-yyyy, hh.mm a', 'en-US', NavbarComponent.OMAN_UTC_OFFSET);
        }
        this.syncTimeChecked = true;
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy(): void {
    this.searchSub.unsubscribe();
    this.notifSub?.unsubscribe();
    this.syncSub?.unsubscribe();
  }

  get currentUser() { return this.authService.getCurrentUser(); }

  get moduleCount(): number {
    const granted = this.permissionService.grantedModuleCount;
    return granted > 0 ? granted : (this.currentUser?.permissions?.length || 0);
  }

  get accessLevelLabel(): string { return this.permissionService.accessLevelLabel; }

  get breadcrumbs() { return this.breadcrumbService.breadcrumbs().filter(c => c.label !== 'Home'); }

  trackByBreadcrumbIndex(index: number): number { return index; }

  get isDashboardRoute(): boolean {
    const path = this.router.url.split(/[?#]/)[0];
    const dashboardBase = `/${ROUTES.DASHBOARD}`;
    return path.includes(`${dashboardBase}/standard-boards`);
  }
 
  goBack(): void {
    if (this.isDashboardRoute) return;
    this.location.back();
  }

  goForward(): void {
    this.location.forward();
  }

  toggleUserMenu(): void { this.isUserMenuOpen = !this.isUserMenuOpen; }

  closeUserMenu(): void { this.isUserMenuOpen = false; }

  setLanguage(language: 'en' | 'ar'): void { this.language = language; }

  setTheme(theme: 'light' | 'dark' | 'contrast'): void { this.theme = theme; }

  toggleFontSizeMenu(): void { this.isFontSizeMenuOpen = !this.isFontSizeMenuOpen; }

  toggleNotifications(): void {
    this.isNotificationsOpen = !this.isNotificationsOpen;
    // Opening the bell no longer auto-marks everything as read — the user must explicitly click
    // "Read All" or an individual item. Just forces an immediate refresh (not just waiting for
    // the next 60s timer tick) so the list is never stale by up to a minute when the user checks.
    if (this.isNotificationsOpen) {
      this.fetchNotifications().subscribe();
    }
  }

  /** "Read All" button in the panel header — marks every currently-listed item read and removes them all. */
  markAllRead(): void {
    if (this.notifications.length === 0) return;
    this.controlPlaneNotifications.markAllAsRead().subscribe(() => {
      this.notifications = [];
      this.cdr.detectChanges();
    });
  }

  closeNotifications(): void { this.isNotificationsOpen = false; }

  openNotification(notification: DisplayNotification): void {
    this.closeNotifications();
    // Clicking one item marks ONLY that item read and removes just it from the list — the rest
    // stay unread until individually clicked or "Read All" is used.
    this.controlPlaneNotifications.markAsRead(notification.id).subscribe();
    this.notifications = this.notifications.filter(n => n.id !== notification.id);
    // An AI alert has no page of its own: its link opens the Ask AI panel on that alert.
    const alert = /^\/ask-ai\/alerts\/(\d+)$/.exec(notification.route ?? '');
    if (alert) this.askAi.openAlert(Number(alert[1]));
    else if (notification.route) this.router.navigateByUrl(notification.route);
  }

  private pollShareNotifications(): void {
    this.fetchNotifications().subscribe();
  }

  private fetchNotifications() {
    const since = new Date(Date.now() - NavbarComponent.NOTIF_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Merges every registered NOTIFICATION_SOURCES (ControlPlane today, the single centralized
    // store) — adding a new notification TYPE never touches this component, see
    // notifications-aggregator.service.ts.
    return this.notificationsAggregator.pollAll(since).pipe(
      tap(feed => {
        this.notifications = feed.items.map(item => ({
          ...item,
          timeAgo: this.formatRelativeTime(item.changedAt),
          unread: !item.isRead,
        }));
        // Forces an immediate re-render for this data-driven update — the automatic (non-click)
        // refresh path was observed not reflecting fresh data in the badge without this.
        this.cdr.detectChanges();
      }),
    );
  }

  private formatRelativeTime(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const minutes = Math.round(diffMs / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  }

  // Webkit browsers have no native "filled track" pseudo-element (unlike
  // Firefox's ::-moz-range-progress), so the blue fill up to the thumb is
  // painted as the input's own background gradient, recomputed on every move.
  get fontSizeSliderBackground(): string {
    const { zoom, minZoom, maxZoom } = this.fontSizeService;
    const percent = ((zoom - minZoom) / (maxZoom - minZoom)) * 100;
    return `linear-gradient(to right, #42A5F5, #21409A ${percent}%, #E4E7EC ${percent}%, #E4E7EC 100%)`;
  }

  closeFontSizeMenu(): void { this.isFontSizeMenuOpen = false; }

  selectFontSizePreset(preset: FontSizePreset): void { this.fontSizeService.setZoom(preset.zoom); }

  onFontSizeSliderInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.fontSizeService.setZoom(value);
  }

  resetFontSize(): void { this.fontSizeService.reset(); }

  toggleAiAssistant(): void { this.isAiAssistantOpen = !this.isAiAssistantOpen; }

  closeAiAssistant(): void {
    this.isAiAssistantOpen = false;
    this.isAiAssistantExpanded = false;
  }

  toggleAiAssistantExpand(): void { this.isAiAssistantExpanded = !this.isAiAssistantExpanded; }

  sendAiQuickAction(action: AiQuickAction): void {
    this.aiDraftMessage = action.label;
    this.sendAiMessage();
  }

  sendAiMessage(): void {
    const text = this.aiDraftMessage.trim();
    if (!text) return;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    this.aiMessages.push({ sender: 'user', text, time });
    this.aiDraftMessage = '';

    this.aiMessages.push({
      sender: 'ai',
      text: "I'm still learning — a teammate will follow up with more detail on this shortly.",
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  }

  logout(): void {
    this.authService.logout();
    this.router.navigate([`/${ROUTES.AUTH.ROOT}/${ROUTES.AUTH.LOGIN}`]);
  }

  onSearchInput(term: string): void {
    this.searchTerm = term;
    const q = term.trim();

    if (!q) {
      this.searchResults = [];
      this.showSearchResults = false;
      this.lastSearchTerm = '';
      this.lastSearchResults = [];
      this.cdr.markForCheck();
      return;
    }

    const lower = q.toLowerCase();

    // Typing forward from a term whose complete (non-truncated) result set we already have —
    // filter it in memory instantly instead of hitting the backend again on every keystroke.
    // Backspacing to something shorter skips this (it could surface matches the narrower fetch
    // never returned), so that still goes through the debounced backend call below.
    const canRefineLocally = this.lastSearchTerm.length > 0
      && lower.startsWith(this.lastSearchTerm)
      && this.lastSearchResults.length < NavbarComponent.MAX_RESULTS_CAP;

    if (canRefineLocally) {
      this.isSearching = false;
      const filtered = this.lastSearchResults.filter(r => r.name.toLowerCase().includes(lower));
      this.searchResults = filtered;
      this.showSearchResults = true;
      this.lastSearchTerm = lower;
      this.lastSearchResults = filtered;
      this.cdr.markForCheck();
      return;
    }

    this.searchInput$.next(term);
  }

  onSearchFocus(): void {
    if (this.searchTerm.trim() && this.searchResults.length) this.showSearchResults = true;
  }

  // Delayed so a click on a result (below) still registers before the dropdown closes.
  onSearchBlur(): void {
    setTimeout(() => (this.showSearchResults = false), 200);
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.searchResults = [];
    this.showSearchResults = false;
    this.lastSearchTerm = '';
    this.lastSearchResults = [];
  }

  browseAllItems(): void {
    this.clearSearch();
    this.router.navigateByUrl('/dashboard');
  }

  selectSearchResult(result: GlobalSearchResult): void {
    this.clearSearch();
    const pathOf = (url: string) => url.split(/[?#]/)[0].split('/').slice(0, -1).join('/');
    // Detail pages read their id once, so moving from one detail page to another of the same kind
    // passes through a blank route to rebuild the page for the new item.
    if (pathOf(this.router.url) === pathOf(result.url)) {
      this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => this.router.navigateByUrl(result.url));
      return;
    }
    this.router.navigateByUrl(result.url);
  }

  searchTypeLabel(type: GlobalSearchResult['type']): string {
    switch (type) {
      case 'dashboard': return 'Board';
      case 'chart': return 'Chart';
      case 'tile': return 'Tile';
      case 'report': return 'Report';
      default: return type;
    }
  }

  // Descriptive path shown under the result name (e.g. "Dashboard › WIP Boards").
  searchResultPath(result: GlobalSearchResult): string {
    const isDraftLike = result.status?.toLowerCase() !== 'published';
    switch (result.type) {
      case 'dashboard': return `Dashboard › ${isDraftLike ? 'WIP Boards' : 'Standard Boards'}`;
      case 'chart': return `Charts & Tiles › ${isDraftLike ? 'WIP Charts' : 'Standard Charts'}`;
      case 'tile': return `Charts & Tiles › ${isDraftLike ? 'WIP Tiles' : 'Standard Tiles'}`;
      case 'report': return `Reports › ${isDraftLike ? 'My Reports' : 'Standard Reports'}`;
      default: return '';
    }
  }

  // Full breadcrumb trail under the result name, ending with the item itself
  // styled as a link (e.g. "Dashboard › WIP Boards › N_Well Delivery Completion...").
  searchResultBreadcrumb(result: GlobalSearchResult): string[] {
    return [...this.searchResultPath(result).split(' › '), result.name];
  }

  // Splits a result name into plain/matched chunks so the current search term can be
  // highlighted via <mark> without ever touching innerHTML (avoids XSS).
  searchNameSegments(name: string): { text: string; match: boolean }[] {
    const term = this.searchTerm.trim();
    if (!term) return [{ text: name, match: false }];

    const lowerName = name.toLowerCase();
    const lowerTerm = term.toLowerCase();
    const segments: { text: string; match: boolean }[] = [];
    let start = 0;
    let idx = lowerName.indexOf(lowerTerm, start);
    if (idx === -1) return [{ text: name, match: false }];

    while (idx !== -1) {
      if (idx > start) segments.push({ text: name.substring(start, idx), match: false });
      segments.push({ text: name.substring(idx, idx + term.length), match: true });
      start = idx + term.length;
      idx = lowerName.indexOf(lowerTerm, start);
    }
    if (start < name.length) segments.push({ text: name.substring(start), match: false });
    return segments;
  }
}
