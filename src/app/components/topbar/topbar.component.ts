import { Component, HostListener, OnInit, OnDestroy } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { DashboardService, ClusterWells } from '../../services/dashboard.service';
import { WellDetailService } from '../../services/well-detail.service';
import { SidebarService } from '../../services/sidebar.service';
import { openAlertsForViewer, GeneratedAlert } from '../../features/alert-rules/alert-rules';

interface FilterGroup {
  key: string;
  label: string;
  selected: string[];
  options: string[];
  dropdownOpen?: boolean;
}

@Component({
  selector: 'app-topbar',
  templateUrl: './topbar.component.html',
  styleUrls: ['./topbar.component.scss']
})
export class TopbarComponent implements OnInit, OnDestroy {

  currentLang: string;

  /** Global autocomplete search */
  searchQuery = '';
  searchOpen = false;
  searchActiveIndex = 0;
  /** Below 540px .nb-search collapses to an icon; this expands it as an overlay. */
  mobileSearchOpen = false;

  /** The Well ID search only appears on dashboard views and wells listing pages. */
  showWellSearch = false;
  private readonly WELL_SEARCH_PAGES = [
    'cmdoverview', 'welldashboard', 'odcsouthwelldelivery', 'welldeliverystatus',
    'allwells', 'odcwells', 'drilledwells', 'duewells'
  ];

  /** App-wide font size (scale) — adjustable from the topbar "AA" control. */
  private readonly FONT_KEY = 'smartops.fontScale';
  fontOpen = false;
  fontScale = 1;
  readonly FONT_MIN = 0.8;
  readonly FONT_MAX = 1.3;

  toggleFontMenu(ev: Event): void { ev.stopPropagation(); this.fontOpen = !this.fontOpen; }
  closeFontMenu(): void { this.fontOpen = false; }

  /** Apply an app-wide font size by zooming the document root. */
  applyFontScale(scale: number, persist = true): void {
    const s = Math.min(this.FONT_MAX, Math.max(this.FONT_MIN, Number(scale) || 1));
    this.fontScale = s;
    (document.documentElement.style as any).zoom = s === 1 ? '' : String(s);
    if (persist) { try { localStorage.setItem(this.FONT_KEY, String(s)); } catch { /* noop */ } }
  }
  onFontSlider(value: string | number): void { this.applyFontScale(Number(value)); }
  setFontPreset(preset: 'small' | 'medium' | 'large'): void {
    this.applyFontScale(preset === 'small' ? 0.9 : preset === 'large' ? 1.15 : 1);
  }
  resetFont(): void { this.applyFontScale(1); }
  get fontPreset(): 'small' | 'medium' | 'large' | 'custom' {
    if (this.fontScale === 0.9) return 'small';
    if (this.fontScale === 1) return 'medium';
    if (this.fontScale === 1.15) return 'large';
    return 'custom';
  }

  /** Well IDs loaded from API, grouped by cluster */
  private clusterWellsData: ClusterWells[] = [];
  /** Well IDs for the currently selected cluster */
  wellIdOptions: string[] = [];
  private selectedCluster = '';
  private subscriptions: Subscription[] = [];

  /** Advanced Filter off-canvas open/close state */
  filterPanelOpen = false;
  filterFromDate = '2026-05-26';
  filterToDate = '2026-05-26';

  filterGroups: FilterGroup[] = [
    {
      key: 'management',
      label: 'Management',
      selected: ['Executive Director'],
      options: ['Executive Director', 'Managing Director', 'Deputy Director']
    },
    {
      key: 'ceo',
      label: 'CEO / Sector Head',
      selected: ['Chief Executive Officer'],
      options: ['Chief Executive Officer', 'Chief Operating Officer', 'Chief Financial Officer']
    },
    {
      key: 'bu',
      label: 'BU Head',
      selected: ['Director - Cement', 'Director - Civil & Infra', 'Director - GRC & Compliance', 'Director - Manufacturing'],
      options: ['Director - Cement', 'Director - Civil & Infra', 'Director - GRC & Compliance', 'Director - Manufacturing', 'Director - Mining', 'Director - Aluminium']
    },
    {
      key: 'division',
      label: 'Division Head',
      selected: ['Aluminium Process', 'General Manager - Cement', 'General Manager - Civil', 'General Manager - Mining'],
      options: ['Aluminium Process', 'General Manager - Cement', 'General Manager - Civil', 'General Manager - Mining', 'General Manager - GRC', 'General Manager - Manufacturing']
    },
    {
      key: 'cluster',
      label: 'Cluster Heads',
      selected: ['Cluster Manager', 'NA', 'TBD'],
      options: ['Cluster Manager', 'Regional Manager', 'NA', 'TBD']
    },
    {
      key: 'project',
      label: 'Project Head',
      selected: ['Factory Manager', 'Project Manager', 'Site Manager'],
      options: ['Factory Manager', 'Project Manager', 'Site Manager', 'Plant Manager', 'Operations Manager']
    }
  ];

  constructor(
    private translate: TranslateService,
    private router: Router,
    private dashboardSvc: DashboardService,
    private wellDetailSvc: WellDetailService,
    private sidebarSvc: SidebarService
  ) {
    this.translate.setDefaultLang('en');
    this.translate.use('en');
    this.currentLang = 'en';
  }

  /** Hamburger toggle for the mobile off-canvas sidebar drawer (<=1199px). */
  toggleMobileSidebar(): void {
    this.sidebarSvc.toggleMobile();
  }

  /* ── Last DB sync timestamp (shown next to Jenny AI) ── */
  lastSync = '';
  private formatSync(d: Date): string {
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    const p = (n: number) => (n < 10 ? '0' + n : '' + n);
    return `${p(d.getDate())} ${mon}, ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* ── Notification bell (Smart Alerts assigned to the current viewer) ── */
  notifOpen = false;
  notifs: GeneratedAlert[] = [];
  notifCount = 0;
  private notifListener = () => this.refreshNotifs();

  private refreshNotifs(): void {
    const role = (window as any).__currentUser?.role;
    this.notifs = openAlertsForViewer(role);
    this.notifCount = this.notifs.length;
  }
  toggleNotif(ev: Event): void { ev.stopPropagation(); this.refreshNotifs(); this.notifOpen = !this.notifOpen; }
  closeNotif(): void { this.notifOpen = false; }
  goToAlerts(): void { this.notifOpen = false; this.router.navigate(['/smartalerts']); }
  sevDot(sev: string): string { return 'nb-notif-sev sev-' + (sev || '').toLowerCase(); }

  ngOnInit(): void {
    // Restore the saved app font size, if any.
    try {
      const saved = localStorage.getItem(this.FONT_KEY);
      if (saved) this.applyFontScale(parseFloat(saved), false);
    } catch { /* noop */ }

    // Show the Well ID search only on dashboard / wells pages; hide it elsewhere.
    this.updateSearchVisibility(this.router.url);
    this.subscriptions.push(
      this.router.events
        .pipe(filter(e => e instanceof NavigationEnd))
        .subscribe((e: any) => this.updateSearchVisibility(e.urlAfterRedirects || e.url || ''))
    );

    // Load cluster-wells data from API
    this.dashboardSvc.getClusterWells().subscribe({
      next: (data) => {
        this.clusterWellsData = data;
        this.updateWellIdOptions();
      },
      error: () => { this.clusterWellsData = []; }
    });

    // Listen to cluster filter changes
    this.subscriptions.push(
      this.dashboardSvc.filter$.subscribe(filter => {
        this.selectedCluster = filter.cluster || '';
        this.updateWellIdOptions();
      })
    );

    // Last DB sync timestamp with the source database.
    this.lastSync = this.formatSync(new Date());

    // Notification bell — recompute alerts on load, on navigation, and when the
    // Smart Alerts page signals a change (e.g. a user closed an alert).
    this.refreshNotifs();
    this.subscriptions.push(
      this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe(() => this.refreshNotifs())
    );
    window.addEventListener('sa-alerts-changed', this.notifListener);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s.unsubscribe());
    window.removeEventListener('sa-alerts-changed', this.notifListener);
  }

  private updateSearchVisibility(url: string): void {
    const pageId = (url || '').split('?')[0].replace(/^\/+/, '') || 'cmdoverview';
    this.showWellSearch = this.WELL_SEARCH_PAGES.includes(pageId);
    if (!this.showWellSearch) { this.searchOpen = false; this.mobileSearchOpen = false; }
  }

  private updateWellIdOptions(): void {
    if (!this.selectedCluster) {
      // Show all well IDs across all clusters
      this.wellIdOptions = this.clusterWellsData
        .reduce((acc, c) => acc.concat(c.wells.map(w => w.id)), [] as string[]);
    } else {
      // Show only well IDs for the selected cluster
      const match = this.clusterWellsData.find(
        c => c.cluster.toLowerCase() === this.selectedCluster.toLowerCase()
      );
      this.wellIdOptions = match ? match.wells.map(w => w.id) : [];
    }
  }

  /* ── Search autocomplete ─────────────────────────── */
  get filteredSuggestions(): string[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return this.wellIdOptions;
    return this.wellIdOptions.filter(id => id.toLowerCase().includes(q));
  }

  onSearchFocus(): void {
    this.searchOpen = true;
    this.searchActiveIndex = 0;
  }

  onSearchInput(): void {
    this.searchOpen = true;
    this.searchActiveIndex = 0;
  }

  onSearchEnter(): void {
    const list = this.filteredSuggestions;
    if (list.length) {
      this.selectSuggestion(list[Math.min(this.searchActiveIndex, list.length - 1)]);
    }
  }

  selectSuggestion(wellId: string): void {
    this.searchQuery = wellId;
    this.wellDetailSvc.open(wellId);
    this.closeSearch();
  }

  clearSearch(): void {
    this.searchQuery = '';
    this.searchActiveIndex = 0;
  }

  closeSearch(): void {
    this.searchOpen = false;
  }

  toggleMobileSearch(): void {
    this.mobileSearchOpen = !this.mobileSearchOpen;
    if (!this.mobileSearchOpen) this.closeSearch();
  }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent): void {
    const target = ev.target as HTMLElement | null;
    if (!target?.closest('.nb-search')) this.closeSearch();
    if (!target?.closest('.nb-search') && !target?.closest('.nb-search-toggle')) {
      this.mobileSearchOpen = false;
    }
    if (this.fontOpen && !target?.closest('.nb-font-wrap')) this.fontOpen = false;
    if (this.notifOpen && !target?.closest('.nb-bell-wrap')) this.notifOpen = false;
  }

  switchLanguage(lang: string): void {
    this.currentLang = lang;
    this.translate.use(lang);
    const htmlEl = document.documentElement;
    if (lang === 'ar') {
      htmlEl.setAttribute('dir', 'rtl');
      htmlEl.setAttribute('lang', 'ar');
    } else {
      htmlEl.setAttribute('dir', 'ltr');
      htmlEl.setAttribute('lang', 'en');
    }
  }

  toggleFilterPanel(): void {
    this.filterPanelOpen = !this.filterPanelOpen;
  }

  closeFilterPanel(): void {
    this.filterPanelOpen = false;
    this.filterGroups.forEach(g => g.dropdownOpen = false);
  }

  toggleGroupDropdown(group: FilterGroup): void {
    this.filterGroups.forEach(g => { if (g !== group) g.dropdownOpen = false; });
    group.dropdownOpen = !group.dropdownOpen;
  }

  removeChip(group: FilterGroup, value: string): void {
    group.selected = group.selected.filter(v => v !== value);
  }

  toggleOption(group: FilterGroup, value: string): void {
    if (group.selected.includes(value)) {
      this.removeChip(group, value);
    } else {
      group.selected = [...group.selected, value];
    }
  }

  clearGroup(group: FilterGroup): void {
    group.selected = [];
  }

  resetFilters(): void {
    this.filterGroups.forEach(g => g.selected = []);
    this.filterFromDate = '';
    this.filterToDate = '';
  }

  applyFilters(): void {
    // Placeholder — wire up to your filter service when ready
    this.closeFilterPanel();
  }
}
