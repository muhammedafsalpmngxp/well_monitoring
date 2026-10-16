import { environment } from '../environments/environment';
import { Component, OnInit, HostListener, NgZone } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { JennyAiService } from './services/jenny-ai.service';
import { DashboardService } from './services/dashboard.service';
import { SidebarService } from './services/sidebar.service';
import { BreadcrumbService } from './services/breadcrumb.service';
import { AuthService } from './services/auth.service';
import { BREADCRUMB_MAP } from './breadcrumb-map';

interface AdvFilterGroup {
  key: string;
  label: string;
  selected: string[];
  options: string[];
  dropdownOpen?: boolean;
}

/**
 * Top-level shell — sidebar, topbar, filter dock, router-outlet,
 * well detail overlay, and shared modals.
 */
@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {

  currentYear = new Date().getFullYear();
  /** End-of-range default = financial-year end (30 Jun), matching "This Year". */
  today = this.formatDate(this.fyRange().end);
  /** Start date defaults to the financial-year start (1 Jul), matching "This Year". */
  monthStart = this.formatDate(this.fyRange().start);

  /** ID of the currently-active page (e.g. 'wellexecution', 'cmdoverview').
   * Used to scope the HFB Well ID dropdown to the wellexecution page only. */
  currentPageId = 'cmdoverview';

  /** The actual click-through path (drilled page / drilled page …) shown
   *  above every page's content — see BreadcrumbService for how drill-downs
   *  extend it vs. ordinary navigation resetting it. */
  get crumbs() {
    return this.breadcrumbSvc.trail;
  }

  goToCrumb(index: number): void {
    this.breadcrumbSvc.goTo(index, this.router.url.split('?')[0], url => this.router.navigateByUrl(url));
  }

  goHome(): void {
    this.router.navigateByUrl('/');
  }

  /** Selected Site filter — '' (All Sites) or any site value from the API. */
  selectedSite = '';
  /** Selected Cluster ID (lowercase HFB key, e.g. 'nimr', 'marmul', or '' for All). */
  selectedCluster = '';

  /** Advanced Filter dock state */
  filterPanelOpen = false;
  /** When pinned, the filter docks beside the sidebar and pushes the content;
   *  when unpinned it floats over the content as an overlay. */
  filterPinned = false;
  filterFromDate = '';
  filterToDate = '';
  filterWellId = '';

  filterGroups: AdvFilterGroup[] = [
    {
      key: 'management', label: 'Management',
      selected: ['Executive Director'],
      options: ['Executive Director', 'Managing Director', 'Deputy Director']
    },
    {
      key: 'ceo', label: 'CEO / Sector Head',
      selected: ['Chief Executive Officer'],
      options: ['Chief Executive Officer', 'Chief Operating Officer', 'Chief Financial Officer']
    },
    {
      key: 'bu', label: 'BU Head',
      selected: ['Director - Cement', 'Director - Civil & Infra', 'Director - GRC & Compliance', 'Director - Manufacturing'],
      options: ['Director - Cement', 'Director - Civil & Infra', 'Director - GRC & Compliance', 'Director - Manufacturing', 'Director - Mining', 'Director - Aluminium']
    },
    {
      key: 'division', label: 'Division Head',
      selected: ['Aluminium Process', 'General Manager - Cement', 'General Manager - Civil', 'General Manager - Mining'],
      options: ['Aluminium Process', 'General Manager - Cement', 'General Manager - Civil', 'General Manager - Mining', 'General Manager - GRC', 'General Manager - Manufacturing']
    },
    {
      key: 'cluster', label: 'Cluster Heads',
      selected: ['Cluster Manager', 'NA', 'TBD'],
      options: ['Cluster Manager', 'Regional Manager', 'NA', 'TBD']
    },
    {
      key: 'project', label: 'Project Head',
      selected: ['Factory Manager', 'Project Manager', 'Site Manager'],
      options: ['Factory Manager', 'Project Manager', 'Site Manager', 'Plant Manager', 'Operations Manager']
    }
  ];

  toggleFilterPanel(): void { this.filterPanelOpen = !this.filterPanelOpen; }
  /** Open the advanced filter: docked (pinned) by default, and collapse the
   *  left menu to make room. The user can re-expand the menu manually. */
  openFilter(): void {
    this.filterPanelOpen = true;
    this.filterPinned = true;
    this.sidebarSvc.collapse();
  }
  closeFilterPanel(): void {
    this.filterPanelOpen = false;
    this.filterGroups.forEach(g => g.dropdownOpen = false);
  }
  /** Pin docks the filter beside the sidebar; unpin makes it float. */
  toggleFilterPin(): void {
    this.filterPinned = !this.filterPinned;
    if (this.filterPinned) {
      this.filterPanelOpen = true;     // pinning implies visible
      this.sidebarSvc.collapse();      // make room for the dock
    }
  }
  toggleGroupDropdown(group: AdvFilterGroup): void {
    this.filterGroups.forEach(g => { if (g !== group) g.dropdownOpen = false; });
    group.dropdownOpen = !group.dropdownOpen;
  }
  removeChip(group: AdvFilterGroup, value: string): void {
    group.selected = group.selected.filter(v => v !== value);
  }
  toggleOption(group: AdvFilterGroup, value: string): void {
    if (group.selected.includes(value)) this.removeChip(group, value);
    else group.selected = [...group.selected, value];
  }
  clearGroup(group: AdvFilterGroup): void { group.selected = []; }
  resetFilters(): void {
    this.filterGroups.forEach(g => g.selected = []);
    this.filterFromDate = '';
    this.filterToDate = '';
    this.filterWellId = '';
  }
  applyFilters(): void {
    this.dashboardSvc.setFilter({ wellId: this.filterWellId || undefined });
    // Keep a pinned filter docked after applying; only close the floating one.
    if (this.filterPinned) this.filterGroups.forEach(g => g.dropdownOpen = false);
    else this.closeFilterPanel();
  }

  private formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  constructor(
    private router: Router,
    private jennyAi: JennyAiService,
    private dashboardSvc: DashboardService,
    private sidebarSvc: SidebarService,
    private readonly breadcrumbSvc: BreadcrumbService,
    private auth: AuthService,
    private zone: NgZone
  ) {
    this.breadcrumbSvc.resolveRouteChange(
      this.breadcrumbTitleFor(this.currentPageId),
      '/' + this.currentPageId
    );
  }

  /** pageIds whose sidebar label is renamed for admins (see sidebar.component.ts) —
   *  the shared breadcrumb bar needs the same renaming, or it keeps reading
   *  "Standard ..." after an admin navigates via the "Published ..." link. */
  private static readonly ADMIN_BREADCRUMB_TITLE: Record<string, string> = {
    standardboards: 'Published Boards',
    standardcharts: 'Published Charts',
    standardreports: 'Published Reports',
  };

  private breadcrumbTitleFor(pageId: string): string {
    const isAdmin = (this.auth.currentUser?.role || '').toLowerCase() === 'admin';
    if (isAdmin && AppComponent.ADMIN_BREADCRUMB_TITLE[pageId]) {
      return AppComponent.ADMIN_BREADCRUMB_TITLE[pageId];
    }
    return BREADCRUMB_MAP[pageId]?.title || pageId;
  }

  /**
   * Predefined global-filter selection applied when the Site Engineer role is
   * chosen (invoked from setRole in app-globals.js). Mirrors the fixed board
   * scope: Oman · Construction & Real Estate · Energy · Oil Field Projects ·
   * NIMR · Coastal, over This Year.
   */
  applySiteEngineerPreset(): void {
    this.zone.run(() => {
      const presets: Record<string, string> = {
        country: 'Oman',
        sector: 'Construction & Real Estate',
        businessUnit: 'Energy',
        division: 'Oil Field Projects',
        cluster: 'NIMR',
        plant: '3009 - MFG-PRC-Camp-Thumrait'
      };
      this.headerFilters.forEach(f => {
        const v = presets[f.key];
        f.selected = v ? [v] : [];
        f.open = false;
      });
      // Date range → This Year (financial year 1 Jul → 30 Jun).
      const fy = this.fyRange();
      this.datePresetLabel = 'This Year';
      this.applyDates(fy.start, fy.end);
      // Site Engineer: lock the predefined selection so it can't be changed.
      this.filtersLocked = true;
    });
  }

  /** Lock/unlock the global header filters (bridged to app-globals setRole). */
  setGlobalFiltersLocked(locked: boolean): void {
    this.zone.run(() => {
      this.filtersLocked = locked;
      if (locked) this.headerFilters.forEach(f => f.open = false);
    });
  }

  ngOnInit(): void {
    // Route the legacy global JS bundle's relative /api/* fetch calls to the
    // configured backend (environment.apiBaseUrl), so app-globals.js connects
    // to the live API instead of the dev-server origin. Angular services
    // already use the full apiBaseUrl. No-op when apiBaseUrl is empty.
    const apiBase = environment.apiBaseUrl;
    if (apiBase && !(window as any).__apiFetchPatched) {
      (window as any).__apiFetchPatched = true;
      const origFetch = window.fetch.bind(window);
      (window as any).fetch = (input: any, init?: any) => {
        try {
          if (typeof input === 'string' && input.indexOf('/api/') === 0) {
            input = apiBase + input;
          } else if (input && typeof input.url === 'string' && input.url.indexOf('/api/') === 0) {
            input = new Request(apiBase + input.url, input);
          }
        } catch { /* fall through with original input */ }
        return origFetch(input, init);
      };
    }

    // The advanced filter always starts closed on load; it opens only when the
    // user clicks the launcher (openFilter), and stays closed once dismissed.

    // Expose initial preset label so JS widgets can read it before any user interaction
    (window as any).__globalDatePresetLabel = this.datePresetLabel;
    // Emit initial "This Year" range (financial year 1 Jul – 30 Jun) so all widgets start aligned
    this.dashboardSvc.setFilter({ startDate: this.monthStart, endDate: this.today });

    // Expose the Site Engineer global-filter preset so the role switcher
    // (setRole in app-globals.js) can apply it when that role is selected.
    (window as any).applySiteEngineerPreset = () => this.applySiteEngineerPreset();

    // Expose the filter lock/unlock so the role switcher can toggle it per role.
    (window as any).setGlobalFiltersLocked = (locked: boolean) => this.setGlobalFiltersLocked(locked);

    // Expose logout so the topbar's (global-JS) Logout button clears the
    // AuthService session and returns to the login page.
    (window as any).__authLogout = () => this.zone.run(() => {
      this.auth.logout();
      this.router.navigateByUrl('/login');
    });

    // Expose Jenny AI service to global JS (used by marinaSend in app-globals.js)
    (window as any).__jennyAi = {
      sendMessage: (msg: string) => this.jennyAi.sendMessage(msg),
      clearHistory: () => this.jennyAi.clearHistory()
    };

    // Prefetch global-filter reliability score from live API
    void this.fetchFilterDqScore();

    // Initialise the HFB filter dock (populates selects, applies pin state),
    // then load live clusters/wells from the API.
    setTimeout(() => {
      try { if ((window as any).hfbInit) (window as any).hfbInit(); } catch(e) { console.warn('[AppComponent] hfbInit error:', e); }
      this.dashboardSvc.getClusterWells().subscribe({
        next: (clusters) => {
          if ((window as any).hfbLoadApiClusters) {
            (window as any).hfbLoadApiClusters(clusters);
          }
        },
        error: (err) => console.warn('[AppComponent] cluster-wells API unavailable, using static data:', err.message ?? err)
      });
    }, 0);

    // Bridge legacy navigate(pageId, el?) calls from inline onclick handlers
    // (and from the original page-render scripts) into the Angular Router.
    const router = this.router;

    const angularNavigate = (page: string, _el?: any) => {
      if (!page) return;
      router.navigateByUrl('/' + page);
    };

    // Override the originals; the original implementations only managed
    // page show/hide + sidebar highlight, both of which the Router now
    // handles. Lazy-init render calls still happen via PageHostComponent.
    (window as any).navigate = angularNavigate;
    (window as any).navigateTopLevel = angularNavigate;

    // Delegated click handler for breadcrumbs. Any <a> inside .breadcrumb
    // (or matching variants) becomes navigable: reads optional `data-page`
    // attribute, otherwise defaults to the dashboard.
    document.addEventListener('click', (ev: Event) => {
      const tgt = ev.target as HTMLElement | null;
      if (!tgt || !tgt.closest) return;
      const link = tgt.closest(
        '.breadcrumb a, .breadcrumb [data-page], ' +
        '.dq-breadcrumb a, .dq-breadcrumb [data-page], ' +
        '.sa-breadcrumb [data-page], ' +
        '.apm-breadcrumb [data-page], .ad-breadcrumb [data-page], ' +
        '.pa-breadcrumb [data-page], .po-breadcrumb [data-page], ' +
        '.fai-breadcrumb [data-page], .cp-breadcrumb [data-page]'
      ) as HTMLElement | null;
      if (!link) return;
      // The active-page label should never navigate.
      if (link.classList.contains('current') || link.classList.contains('cur') ||
          link.classList.contains('apm-bc-cur') || link.classList.contains('ad-bc-cur') ||
          link.classList.contains('pa-bc-cur') || link.classList.contains('po-bc-cur') ||
          link.classList.contains('fai-bc-cur') || link.classList.contains('cp-bc-cur')) return;
      // Defer to inline onclick handlers (legacy pages already wired).
      if (link.hasAttribute('onclick')) return;
      const page = link.getAttribute('data-page') || 'cmdoverview';
      ev.preventDefault();
      router.navigateByUrl('/' + page);
    });

    // Keep the sidebar's "active" highlight in sync with the URL.
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe((e: any) => {
        const url: string = (e.urlAfterRedirects || e.url || '').split('?')[0];
        const pageId = url.replace(/^\/+/, '') || 'cmdoverview';
        // Auth gate — unauthenticated users are sent to the login page.
        if (pageId !== 'login' && !this.auth.isAuthenticated()) {
          this.router.navigateByUrl('/login');
          return;
        }
        this.currentPageId = pageId;
        this.breadcrumbSvc.resolveRouteChange(this.breadcrumbTitleFor(pageId), url);
        // Defer to next tick so the sidebar DOM (rendered separately) is ready.
        setTimeout(() => this.syncSidebarActive(pageId), 0);
      });
  }

  /** True when the login page is showing — used to hide the app shell chrome. */
  get isLoginPage(): boolean { return this.currentPageId === 'login'; }

  private syncSidebarActive(pageId: string): void {
    document.querySelectorAll('.sb-sub-item').forEach((el) => el.classList.remove('active'));
    document.querySelectorAll('.sb-item').forEach((el) => {
      if ((el as HTMLElement).id === 'sb-execsummary') {
        el.classList.remove('active');
      }
    });
    const target = document.getElementById('nav-' + pageId)
      || document.getElementById('sb-' + pageId);
    if (target) target.classList.add('active');
  }

  onHfbChange(level: string, value: string): void {
    if ((window as any).hfbOnChange) (window as any).hfbOnChange(level, value);
    if (level === 'cluster') {
      this.selectedCluster = value || '';
      this.selectedSite = '';
      this.dashboardSvc.setFilter({ cluster: value || undefined, location: undefined, project: undefined, wellId: undefined, site: undefined });
    }
    if (level === 'site') {
      this.selectedSite = value || '' as any;
      this.dashboardSvc.setFilter({ site: value || undefined });
    }
    if (level === 'project') this.dashboardSvc.setFilter({ project: value || undefined, location: undefined, wellId: undefined });
    if (level === 'location') this.dashboardSvc.setFilter({ location: value || undefined, wellId: undefined });
    if (level === 'well') {
      // Strip cluster prefix: 'amin-10205' → '10205'
      const bare = value ? value.split('-').slice(1).join('-') || value : undefined;
      this.dashboardSvc.setFilter({ wellId: bare });
    }
  }
  onHfbDateChange(field: 'startDate' | 'endDate', value: string): void {
    if ((window as any).hfbDateChange) (window as any).hfbDateChange(field, value);
    this.dashboardSvc.setFilter({ [field]: value || undefined });
  }
  onHfbReset(): void {
    if ((window as any).hfbReset) (window as any).hfbReset();
    this.dashboardSvc.resetFilter();
  }
  /**
   * Top-bar quick From/To pickers. Editing either end switches the active
   * range to a custom one and emits the filter, mirroring applyCustomDate.
   */
  onRangeDateChange(field: 'startDate' | 'endDate', value: string): void {
    if (!value) return;
    if (field === 'startDate') this.monthStart = value;
    else this.today = value;
    this.datePresetLabel = 'Custom';
    (window as any).__globalDatePresetLabel = 'Custom';
    this.dashboardSvc.setFilter({ [field]: value });
    if ((window as any).hfbDateChange) (window as any).hfbDateChange(field, value);
  }
  onHfbTogglePin(): void {
    if ((window as any).hfbTogglePin) (window as any).hfbTogglePin();
  }
  onHfbExpand(): void {
    if ((window as any).hfbExpand) (window as any).hfbExpand();
  }

  // ── Date Preset Dropdown ──
  datePresetOpen = false;
  datePresetLabel = 'This Year';
  customFrom = '';
  customTo = '';

  toggleDatePreset(event: Event): void {
    event.stopPropagation();
    this.datePresetOpen = !this.datePresetOpen;
  }

  /**
   * Financial-year range (client FY runs 1 Jul → 30 Jun) that contains `ref`.
   * e.g. any date in Jul 2026–Jun 2027 → { 01-Jul-2026, 30-Jun-2027 }.
   */
  private fyRange(ref: Date = new Date()): { start: Date; end: Date } {
    const startYear = ref.getMonth() >= 6 ? ref.getFullYear() : ref.getFullYear() - 1;
    return { start: new Date(startYear, 6, 1), end: new Date(startYear + 1, 6, 0) };
  }

  selectDatePreset(preset: string): void {
    const today = new Date();
    let start: Date;
    let end: Date = today;

    switch (preset) {
      case 'today':
        start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        this.datePresetLabel = 'Today';
        this.applyDates(start, end);
        this.datePresetOpen = false;
        break;
      case 'thisWeek': {
        start = new Date(today);
        start.setDate(today.getDate() - today.getDay());
        this.datePresetLabel = 'This Week';
        this.applyDates(start, end);
        this.datePresetOpen = false;
        break;
      }
      case 'nextWeek': {
        start = new Date(today);
        start.setDate(today.getDate() + ((8 - today.getDay()) % 7 || 7));
        end = new Date(start);
        end.setDate(start.getDate() + 6);
        this.datePresetLabel = 'Next Week';
        this.applyDates(start, end);
        this.datePresetOpen = false;
        break;
      }
      case 'lastWeek': {
        start = new Date(today);
        start.setDate(today.getDate() - today.getDay() - 7);
        end = new Date(today);
        end.setDate(today.getDate() - today.getDay() - 1);
        this.datePresetLabel = 'Last Week';
        this.applyDates(start, end);
        this.datePresetOpen = false;
        break;
      }
      case 'last30':
        start = new Date(today);
        start.setDate(start.getDate() - 29);
        this.datePresetLabel = 'Last 30 Days';
        this.applyDates(start, end);
        this.datePresetOpen = false;
        break;
      case 'last60':
        start = new Date(today);
        start.setDate(start.getDate() - 59);
        this.datePresetLabel = 'Last 60 Days';
        this.applyDates(start, end);
        this.datePresetOpen = false;
        break;
      case 'last90':
        start = new Date(today);
        start.setDate(start.getDate() - 89);
        this.datePresetLabel = 'Last 90 Days';
        this.applyDates(start, end);
        this.datePresetOpen = false;
        break;
      case 'last120':
        start = new Date(today);
        start.setDate(start.getDate() - 119);
        this.datePresetLabel = 'Last 120 Days';
        this.applyDates(start, end);
        this.datePresetOpen = false;
        break;
      case 'nextMonth': {
        start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        end   = new Date(today.getFullYear(), today.getMonth() + 2, 0);
        this.datePresetLabel = 'Next Month';
        this.applyDates(start, end);
        this.datePresetOpen = false;
        break;
      }
      case 'thisYear': {
        // Client financial year: 1 Jul → 30 Jun.
        const fy = this.fyRange(today);
        start = fy.start; end = fy.end;
        this.datePresetLabel = 'This Year';
        this.applyDates(start, end);
        this.datePresetOpen = false;
        break;
      }
      case 'lastYear': {
        // Previous financial year.
        const prev = this.fyRange(new Date(today.getFullYear() - 1, today.getMonth(), 1));
        start = prev.start; end = prev.end;
        this.datePresetLabel = 'Last Year';
        this.applyDates(start, end);
        this.datePresetOpen = false;
        break;
      }
      case 'custom':
        this.datePresetLabel = 'Custom';
        // Keep dropdown open to show the custom panel
        break;
    }
  }

  applyCustomDate(): void {
    if (this.customFrom && this.customTo) {
      this.monthStart = this.customFrom;
      this.today = this.customTo;
      if ((window as any).hfbDateChange) {
        (window as any).hfbDateChange('startDate', this.customFrom);
        (window as any).hfbDateChange('endDate', this.customTo);
      }
      (window as any).__globalDatePresetLabel = 'Custom';
      this.dashboardSvc.setFilter({ startDate: this.customFrom, endDate: this.customTo });
      this.datePresetOpen = false;
    }
  }

  cancelCustomDate(): void {
    this.datePresetOpen = false;
  }

  private applyDates(start: Date, end: Date): void {
    const startStr = this.formatDate(start);
    const endStr = this.formatDate(end);
    this.monthStart = startStr;
    this.today = endStr;
    // Expose the preset label BEFORE emitting filter so subscribers read the correct label
    (window as any).__globalDatePresetLabel = this.datePresetLabel;
    // Emit filter so Angular components re-fetch
    this.dashboardSvc.setFilter({ startDate: startStr, endDate: endStr });
    try {
      if ((window as any).hfbDateChange) {
        (window as any).hfbDateChange('startDate', startStr);
        (window as any).hfbDateChange('endDate', endStr);
      }
    } catch (e) {
      console.warn('[applyDates] hfbDateChange error:', e);
    }
  }

  /** Tablet/mobile: the header filter bar (Country → Plant, date range,
   *  preset) collapses into a single "Filter" button; clicking it opens
   *  this off-canvas panel listing the same fields stacked vertically,
   *  bound to the exact same model as the desktop bar. */
  tabFilterOpen = false;

  toggleTabFilter(): void {
    this.tabFilterOpen = !this.tabFilterOpen;
    if (!this.tabFilterOpen) this.headerFilters.forEach(f => f.open = false);
  }

  closeTabFilter(): void {
    this.tabFilterOpen = false;
    this.headerFilters.forEach(f => f.open = false);
    this.datePresetOpen = false;
  }

  // ── Header Multiselect Filters (left side of bar) ──
  headerFilters: { key: string; label: string; options: string[]; selected: string[]; open: boolean }[] = [
    { key: 'country',      label: 'Country',       options: ['India', 'Namibia', 'Oman', 'United Arab Emirates'],    selected: [], open: false },
    { key: 'sector',       label: 'Sector',        options: ['Construction & Real Estate', 'Industrial Projects', 'Mining'], selected: [], open: false },
    { key: 'businessUnit', label: 'Business Unit', options: ['Energy', 'Asphalt', 'Carpentry & Fit-out', 'Cement Products', 'Drilling & Blasting', 'EPC Civil Projects', 'EPC Industrial Projects', 'EPC Road Projects'], selected: [], open: false },
    { key: 'division',     label: 'Division',      options: ['Oil Field Projects', 'Asphalt', 'Carpentry & Fit-out', 'Cement Products', 'Drilling & Blasting', 'EPC Civil Projects', 'EPC Industrial Projects', 'EPC Road Projects', 'Exploration Projects'], selected: [], open: false },
    { key: 'cluster',      label: 'Cluster',       options: ['MARMUL', 'NIMR'],                                      selected: [], open: false },
    { key: 'plant',        label: 'Plant',         options: ['3009 - MFG-PRC-Camp-Thumrait', '3020 - CVL-Red-Camp-Seeb', '3270 - R&I-RDS-Division Comn'], selected: [], open: false },
  ];

  /** When true (Site Engineer role), the global header filters are locked to
      their predefined selection and cannot be changed. */
  filtersLocked = false;

  toggleHeaderFilter(f: any, event: Event): void {
    event.stopPropagation();
    if (this.filtersLocked) return;   // Site Engineer: filters are read-only
    const wasOpen = f.open;
    this.headerFilters.forEach(x => x.open = false);
    this.roleDropdownOpen = false;
    this.datePresetOpen = false;
    f.open = !wasOpen;
  }

  toggleHeaderFilterOption(f: any, opt: string): void {
    const idx = f.selected.indexOf(opt);
    if (idx === -1) f.selected.push(opt); else f.selected.splice(idx, 1);
  }

  getHeaderFilterLabel(f: any): string {
    if (!f.selected.length) return f.label;
    if (f.selected.length === 1) return f.selected[0];
    return `${f.selected.length} ${f.label}`;
  }

  // ── Role Multiselect Dropdown ──
  roleOptions = ['Admin', 'Cluster Admin', 'Site Admin', 'Planner'];
  selectedRoles: string[] = [];
  roleDropdownOpen = false;

  get roleLabel(): string {
    if (!this.selectedRoles.length) return 'All Roles';
    if (this.selectedRoles.length === 1) return this.selectedRoles[0];
    return `${this.selectedRoles.length} Roles`;
  }

  toggleRoleDropdown(event: Event): void {
    event.stopPropagation();
    this.roleDropdownOpen = !this.roleDropdownOpen;
    if (this.roleDropdownOpen) {
      this.headerFilters.forEach(x => x.open = false);
      this.datePresetOpen = false;
    }
  }

  toggleRoleOption(role: string): void {
    const idx = this.selectedRoles.indexOf(role);
    if (idx === -1) this.selectedRoles.push(role); else this.selectedRoles.splice(idx, 1);
  }

  isRoleSelected(role: string): boolean { return this.selectedRoles.includes(role); }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    const target = event.target as HTMLElement;
    if (this.datePresetOpen && !target.closest('.hfb-preset-wrap')) this.datePresetOpen = false;
    if (this.roleDropdownOpen && !target.closest('.hfb-role-wrap')) this.roleDropdownOpen = false;
    if (this.headerFilters.some(f => f.open) && !target.closest('.hfb-mf-wrap')) {
      this.headerFilters.forEach(f => f.open = false);
    }
  }

  /** Live global-filter reliability score fetched from data-quality API. */
  filterDqApiScore: number | null = null;
  private filterDqApiData: any = null;

  private async fetchFilterDqScore(): Promise<void> {
    try {
      const resp = await fetch(environment.apiBaseUrl + '/api/v1/wells/data-quality/tile?tile=globalFilter');
      if (!resp.ok) return;
      const data = await resp.json();
      this.filterDqApiData = data;
      this.filterDqApiScore = Math.round(data.overallReliabilityScore ?? 0);
    } catch { /* fall back to static */ }
  }

  /** Compute per-table score using same weights as wdTableReliability() in well-detail-live.js */
  private filterDqTableScore(issues: Array<{ category: string }>): number {
    const penalty = issues.reduce((s, i) => {
      const sev = (['Data Type Mismatch', 'Foreign Key'].includes(i.category)) ? 'High'
                : (['No Standardization', 'Primary Key', 'Null Values'].includes(i.category)) ? 'Medium'
                : 'Low';
      return s + (sev === 'High' ? 18 : sev === 'Medium' ? 10 : 4);
    }, 0);
    return Math.max(0, 100 - penalty);
  }

  /** Score (0–100) for the global filter — live API when available, static fallback. */
  filterDqScore(): number {
    if (this.filterDqApiScore !== null) return this.filterDqApiScore;
    // Static fallback
    const projectIdsIssues = [
      { category: 'No Standardization' }, { category: 'No Standardization' },
      { category: 'No Standardization' }, { category: 'Null Values' },
      { category: 'Data Type Mismatch' }
    ];
    const wmrIssues = [
      { category: 'Null Values' }, { category: 'Data Type Mismatch' },
      { category: 'No Standardization' }, { category: 'Primary Key' }
    ];
    const avg = (this.filterDqTableScore(projectIdsIssues) + this.filterDqTableScore(wmrIssues)) / 2;
    return Math.round(avg);
  }

  filterDqScoreColor(): string {
    const r = this.filterDqScore();
    return r >= 85 ? '#2e9e5b' : r >= 65 ? '#f5a623' : '#d9534f';
  }

  openFilterInfo(): void {
    const show = (window as any).wdWidgetInfoShowData;
    if (typeof show !== 'function') return;

    // If live API data is loaded, use it
    if (this.filterDqApiData?.tables?.length) {
      const scoringNote =
        'Reliability is scored across 5 weighted dimensions: ' +
        'Completeness (30%) — critical fields are populated; ' +
        'Validity (20%) — correct formats/ranges; ' +
        'Consistency (25%) — related fields agree; ' +
        'Integrity (15%) — no duplicates, referential links hold; ' +
        'Freshness (10%) — data is recent. ' +
        'Scores are computed from live row counts queried on every API call.';
      show({
        title: this.filterDqApiData.title ?? 'Global Filter Dropdowns',
        summary: this.filterDqApiData.description + '\n\n' + scoringNote,
        tables: (this.filterDqApiData.tables as any[]).map((t: any) => ({
          table: t.table,
          totalRows: t.totalRows,
          reliabilityScore: t.reliabilityScore,
          reliabilityLabel: t.reliabilityLabel,
          issues: (t.issues as any[]).map((iss: any) => ({
            field:    iss.field,
            category: iss.dimension,
            detail:   iss.description + (iss.affected > 0 ? ` (${iss.affected.toLocaleString()} affected)` : '')
          }))
        }))
      });
      return;
    }

    // Static fallback
    show({
      title: 'Global Filter Dropdowns',
      summary: 'The Cluster, Site, Well Type, Project, and Well ID dropdowns are all populated from a single API call: ' +
               'GET /dashboard/cluster-wells. This endpoint joins dbo.ProjectIDs (master project registry) with ' +
               'dbo.WMR (weekly monitoring records) to produce the full list of clusters, sites, well types, projects, ' +
               'and well IDs available for filtering. Results are cached for 30 minutes.',
      tables: [
        {
          table: 'dbo.ProjectIDs',
          issues: [
            { field: 'Cluster',  category: 'No Standardization',
              detail: 'LTRIM/RTRIM is applied but mixed casing between rows (e.g. "NIMR" vs "Nimr") can cause the same cluster to appear twice in the dropdown with different display names.' },
            { field: 'Site',     category: 'No Standardization',
              detail: 'LTRIM/RTRIM applied. Blank or NULL Site values are excluded from the Site dropdown — projects without a Site are invisible to Site-level filtering.' },
            { field: 'Type',     category: 'No Standardization',
              detail: 'Used to populate the Well Type dropdown. NULL or blank Type rows are excluded. Multiple project IDs may share the same Type name — handled correctly by grouping in the query.' },
            { field: 'Project',  category: 'Null Values',
              detail: 'NULL or blank Project values are excluded from the Project dropdown. Wells belonging to those project IDs cannot be filtered by Project even though they appear in the Well ID list.' },
            { field: 'ID',       category: 'Data Type Mismatch',
              detail: 'Numeric ID — CAST to NVARCHAR(100) is required to join with WMR.project_id. Any mismatch (leading zeros, extra whitespace) causes the project row to have no associated wells.' }
          ]
        },
        {
          table: 'dbo.WMR',
          issues: [
            { field: 'pdo_well_id', category: 'Null Values',
              detail: 'LEFT JOIN to ProjectIDs — only rows where pdo_well_id IS NOT NULL and pdo_well_id <> \'\' are included in the Well ID dropdown. Wells with a blank pdo_well_id are invisible even if they have a valid project entry.' },
            { field: 'project_id',  category: 'Data Type Mismatch',
              detail: 'NVARCHAR — joined to ProjectIDs.ID via CAST(ID AS NVARCHAR(100)). Type or format mismatch (e.g. integer vs string) silently orphans the WMR well — it has no cluster/site/type and is excluded from all dropdowns.' },
            { field: 'well_name_after_spud', category: 'No Standardization',
              detail: 'Free-text NVARCHAR used as the display label in the Well ID dropdown. No deduplication — if the same well appears in multiple WMR rows with different names, GROUP BY picks an arbitrary name.' },
            { field: '(table)', category: 'Primary Key',
              detail: 'No primary key. A well can appear in many WMR snapshot rows (one per week). GROUP BY in the cluster-wells query collapses them, but inconsistent values across rows (e.g. different well names) result in arbitrary display values.' }
          ]
        }
      ]
    });
  }  // end openFilterInfo

}
