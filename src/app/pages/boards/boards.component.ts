import { Component, AfterViewInit, OnDestroy, ViewEncapsulation, OnInit } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { BreadcrumbService } from '../../services/breadcrumb.service';
import { PublishService } from '../../features/publishing/publish.service';
import { AuthService } from '../../services/auth.service';
import { HttpClient } from '@angular/common/http';

type BoardIcon = 'bar' | 'donut' | 'grid' | 'line';
type OpenType = 'nav' | 'navtop' | 'dvs';

interface Board {
  id: string;
  name: string;
  desc: string;
  category: string;
  icon: BoardIcon;
  openType: OpenType;
  openArg: string;      // route id or dvs board id
  charts: number;
  created: string;
  modified: string;
  scopes: ('standard' | 'my')[];
}

const FAV_KEY = 'smartops.boards.favourites';
const RECENT_KEY = 'smartops.boards.recent';

/**
 * Boards gallery — Standard Boards / My Boards. Shows the existing dashboards
 * as cards grouped by category (accordion), with search, sort, tabs
 * (All / Favourites / Recently viewed) and a card/tile view toggle.
 * Clicking a board opens the complete dashboard.
 */
@Component({
  selector: 'app-boards',
  templateUrl: './boards.component.html',
  styleUrls: ['./boards.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class BoardsComponent implements AfterViewInit, OnDestroy, OnInit {

  /** Which listing this is — drives the page title. */
  scope: 'standard' | 'my' = 'standard';
  pageTitle = 'Standard Boards';

  tab: 'all' | 'favourites' | 'recent' | 'draft' = 'all';
  view: 'card' | 'tile' = 'card';   // default = card view
  search = '';
  categoryFilter = 'All';
  sort: 'recent' | 'name' | 'charts' = 'recent';

  private expanded: Record<string, boolean> = {};
  favourites: string[] = [];
  recentIds: string[] = [];

  private routerSub?: Subscription;

  /** Master board list (the existing dashboards). */
  boards: Board[] = [
    { id: 'ops',    name: 'Operations Dashboard',      desc: 'Cluster-wide well operations overview — KPIs, ODC status, cluster health.', category: 'Operations Overview', icon: 'bar',   openType: 'nav',    openArg: 'cmdoverview',          charts: 9, created: '01-Jan-26', modified: '02-Jul-26', scopes: ['standard'] },
    { id: 'daily',  name: 'Daily Operations Briefing', desc: 'Active wells, progress, penalty exposure, and at-risk wells for the day.',   category: 'Operations Overview', icon: 'grid',  openType: 'dvs',    openArg: '1',                    charts: 6, created: '18-Mar-26', modified: '25-Apr-26', scopes: ['standard','my'] },
    { id: 'crew',   name: 'Crew Performance',          desc: 'Crews deployed, PI trend, crew roster, and AI-flagged PI anomalies.',        category: 'Operations Overview', icon: 'grid',  openType: 'dvs',    openArg: '2',                    charts: 4, created: '20-Mar-26', modified: '22-Apr-26', scopes: ['standard','my'] },
    { id: 'opdash', name: 'Operation Dashboard',       desc: 'Project progress, bonus potential, crew utilisation, and well status.',      category: 'Operations Overview', icon: 'grid',  openType: 'dvs',    openArg: '3',                    charts: 8, created: '02-Jul-26', modified: '02-Jul-26', scopes: ['standard','my'] },
    { id: 'odc',    name: 'ODC South Well Delivery',   desc: 'Well delivery tracking for the ODC South scope — cluster & well level.',     category: 'Client Boards',       icon: 'donut', openType: 'navtop', openArg: 'odcsouthwelldelivery', charts: 12, created: '01-Jan-25', modified: '02-Jul-26', scopes: ['standard'] },
    { id: 'wds',    name: 'Well Delivery Status',      desc: 'Editable well delivery status board for the ODC South scope.',               category: 'Client Boards',       icon: 'donut', openType: 'navtop', openArg: 'welldeliverystatus',   charts: 12, created: '01-Jan-25', modified: '02-Jul-26', scopes: ['my'] },
    // Crews & Activities boards (moved from the Crew & Activities menu)
    { id: 'crewgantt',     name: 'Well & Crew Schedule Board',         desc: 'Well & crew scheduling gantt — assignments across the programme timeline.', category: 'Crews & Activities', icon: 'grid', openType: 'nav', openArg: 'crewgantt',         charts: 4, created: '10-Feb-26', modified: '02-Jul-26', scopes: ['standard'] },
    { id: 'crewganttupd',  name: 'Well & Crew Schedule Board Updated', desc: 'Updated well & crew scheduling gantt with the latest plan revisions.',      category: 'Crews & Activities', icon: 'grid', openType: 'nav', openArg: 'crewgantt-updated', charts: 4, created: '18-Mar-26', modified: '02-Jul-26', scopes: ['standard'] },
    { id: 'crewpi',        name: 'PI Ratings — Crews & Groups',        desc: 'Performance-index ratings by crew and group over time.',                    category: 'Crews & Activities', icon: 'line', openType: 'nav', openArg: 'crewpi',           charts: 5, created: '05-Feb-26', modified: '02-Jul-26', scopes: ['standard'] },
    { id: 'perfanalysis',  name: 'Performance Analysis',               desc: 'Crew and activity performance analysis matrix.',                            category: 'Crews & Activities', icon: 'bar',  openType: 'nav', openArg: 'perfanalysis',      charts: 6, created: '05-Feb-26', modified: '02-Jul-26', scopes: ['standard'] }
  ];

  constructor(
    private router: Router,
    private readonly breadcrumb: BreadcrumbService,
    private pub: PublishService,
    private auth: AuthService,
    private http: HttpClient
  ) {
    this.loadState();
    this.applyScope(this.router.url);
  }

  /** Dashboards loaded from backend API */
  private backendWipBoards: Board[] = [];
  private backendPublishedBoards: Board[] = [];

  ngOnInit(): void {
    this.loadFromBackend();
  }

  /** Admin sees the WIP/Published labelling and no separate Draft tab. */
  get isAdmin(): boolean { return (this.auth.currentUser?.role || '').toLowerCase() === 'admin'; }

  // ── Publish / draft ──────────────────────────────────────
  /** Boards seeded as standard are published by default; the rest start as drafts. */
  private naturalPublished(b: Board): boolean { return b.scopes.indexOf('standard') >= 0; }
  isPublished(b: Board): boolean { return this.pub.isPublished('board', b.id, this.naturalPublished(b)); }
  isDraft(b: Board): boolean { return !this.isPublished(b); }

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;
    this.routerSub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: any) => this.applyScope(e.urlAfterRedirects || e.url || ''));
  }

  ngOnDestroy(): void { this.routerSub?.unsubscribe(); }

  private applyScope(url: string): void {
    const u = (url || '').split('?')[0];
    const next: 'standard' | 'my' = u.indexOf('myboards') >= 0 ? 'my' : 'standard';
    this.scope = next;
    // Admin sees renamed listings: Standard → Published, My → WIP.
    const admin = (this.auth.currentUser?.role || '').toLowerCase() === 'admin';
    this.pageTitle = next === 'my'
      ? (admin ? 'WIP Boards' : 'My Boards')
      : (admin ? 'Published Boards' : 'Standard Boards');
    this.recompute();
  }

  private loadState(): void {
    try { this.favourites = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { this.favourites = []; }
    try { this.recentIds  = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { this.recentIds = []; }
    if (!this.recentIds.length) this.recentIds = ['ops', 'crew', 'odc'];   // sensible seed
  }
  private persist(): void {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(this.favourites)); } catch {}
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(this.recentIds)); } catch {}
  }

  // Cached view models — recomputed only on real changes (never in a getter,
  // so the template never rebuilds arrays during change detection).
  categories: string[] = [];
  groups: { name: string; boards: Board[] }[] = [];
  flatBoards: Board[] = [];
  recentBoards: Board[] = [];
  allCount = 0;
  favCount = 0;
  draftCount = 0;

  // ── Tabs / view / accordion ──────────────────────────────
  setTab(t: 'all' | 'favourites' | 'recent' | 'draft'): void { this.tab = t; this.recompute(); }
  setView(v: 'card' | 'tile'): void { this.view = v; }
  onFilterChange(): void { this.recompute(); }
  isExpanded(cat: string): boolean { return this.expanded[cat] !== false; }   // default open
  toggleCategory(cat: string): void { this.expanded[cat] = this.isExpanded(cat) ? false : true; }

  isFav(id: string): boolean { return this.favourites.includes(id); }
  toggleFav(b: Board, ev: Event): void {
    ev.stopPropagation();
    const i = this.favourites.indexOf(b.id);
    if (i >= 0) this.favourites.splice(i, 1); else this.favourites.push(b.id);
    this.persist();
    this.recompute();
  }

  /** Boards belonging to the current listing (Standard vs My).
   *  - My Boards: the user's own boards (seeded 'my' + created) — drafts and published.
   *  - Standard Boards: every published board (incl. ones an admin published from My Boards).
   */
  private scopeBoards(): Board[] {
    if (this.scope === 'my') {
      return this.boards.filter(b => b.scopes.indexOf('my') >= 0).concat(this.myCreatedBoards());
    }
    return this.boards.concat(this.myCreatedBoards()).filter(b => this.isPublished(b));
  }

  /** User-created dashboards (from the BI-Boards builder) shown under My Boards,
      grouped under their assigned category. */
  private myCreatedBoards(): Board[] {
    // Combine in-memory (dbGetData) + backend API boards
    const inMemory = this.myCreatedBoardsFromMemory();
    const fromApi = this.scope === 'my' ? this.backendWipBoards : this.backendPublishedBoards;
    // Dedupe by id
    const ids = new Set(inMemory.map(b => b.id));
    return [...inMemory, ...fromApi.filter(b => !ids.has(b.id))];
  }

  private myCreatedBoardsFromMemory(): Board[] {
    const w = window as any;
    const data = (typeof w.dbGetData === 'function') ? w.dbGetData() : null;
    const dashes: any[] = (data && Array.isArray(data.dashboards)) ? data.dashboards : [];
    const cats: any[] = (data && Array.isArray(data.categories)) ? data.categories : [];
    const catName = (id: any) => { const c = cats.find(x => x.id === id); return c ? c.name : 'My Dashboards'; };
    const seeded = new Set([1, 2, 3, 4]);   // already represented (daily/crew/opdash) or hidden (wds copy)
    return dashes.filter(d => !seeded.has(d.id)).map(d => ({
      id: 'db-' + d.id,
      name: d.name || 'Untitled Dashboard',
      desc: (d.widgets ? d.widgets.length : 0) + ' widgets · ' + (d.owner || 'You'),
      category: catName(d.catId),
      icon: 'grid' as BoardIcon,
      openType: 'dvs' as OpenType,
      openArg: String(d.id),
      charts: d.widgets ? d.widgets.length : 0,
      created: d.created || '—',
      modified: d.modified || '—',
      scopes: ['my'] as ('standard' | 'my')[]
    }));
  }

  /** Load dashboards from backend API grouped by category */
  private loadFromBackend(): void {
    // Load WIP boards
    this.http.get<any[]>('/api/tenant/dashboard/wip').subscribe({
      next: (categories) => {
        this.backendWipBoards = this.mapApiResponse(categories, 'my');
        this.recompute();
      },
      error: () => {} // silent — backend may not be running
    });
    // Load Published boards
    this.http.get<any[]>('/api/tenant/dashboard/published').subscribe({
      next: (categories) => {
        this.backendPublishedBoards = this.mapApiResponse(categories, 'standard');
        this.recompute();
      },
      error: () => {}
    });
  }

  /** Map backend API response to Board[] format */
  private mapApiResponse(categories: any[], scope: 'standard' | 'my'): Board[] {
    const boards: Board[] = [];
    for (const cat of categories) {
      for (const d of (cat.dashboards || [])) {
        boards.push({
          id: 'api-' + d.dashboardId,
          name: d.dashboardName,
          desc: d.description || (d.widgetCount + ' widgets'),
          category: cat.categoryName || d.categoryName || 'Others',
          icon: 'grid' as BoardIcon,
          openType: 'dvs' as OpenType,
          openArg: String(d.dashboardId),
          charts: d.widgetCount || 0,
          created: d.createdBy || '—',
          modified: d.modifiedDate ? new Date(d.modifiedDate).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'2-digit'}) : '—',
          scopes: [scope]
        });
      }
    }
    return boards;
  }

  /** Publish a draft board — calls backend API then refreshes. */
  publish(b: Board, ev: Event): void {
    ev.stopPropagation();
    const apiId = b.id.replace('api-', '');
    if (b.id.startsWith('api-')) {
      this.http.post<any>(`/api/tenant/dashboard/${apiId}/publish`, {}).subscribe({
        next: () => {
          this.loadFromBackend(); // refresh from backend
        },
        error: (err) => {
          const msg = err.error?.message || 'Failed to publish dashboard.';
          alert(msg);
        }
      });
    } else {
      // Legacy in-memory publish
      this.pub.publish('board', b.id);
      this.recompute();
    }
  }

  /** Open the "new dashboard" flow (category + name → builder). */
  newDashboard(): void {
    const w = window as any;
    if (typeof w.dbOpenAddDashboard === 'function') w.dbOpenAddDashboard();
    else this.router.navigateByUrl('/dashboard-edit');
    setTimeout(() => this.recompute(), 400);
  }

  /** Open the category manager (create / edit / delete dashboard categories). */
  manageCategories(): void {
    const w = window as any;
    if (typeof w.dbOpenCategoryMgr === 'function') w.dbOpenCategoryMgr();
    setTimeout(() => this.recompute(), 400);
  }

  private base(): Board[] {
    let list = this.scopeBoards();
    if (this.tab === 'favourites') list = list.filter(b => this.isFav(b.id));
    else if (this.tab === 'draft') list = list.filter(b => this.isDraft(b));
    else if (this.tab === 'recent') {
      const inScope = this.scopeBoards();
      list = this.recentIds.map(id => inScope.find(b => b.id === id)).filter(Boolean) as Board[];
    }
    const q = this.search.trim().toLowerCase();
    if (q) list = list.filter(b => (b.name + ' ' + b.desc + ' ' + b.category).toLowerCase().includes(q));
    if (this.categoryFilter !== 'All') list = list.filter(b => b.category === this.categoryFilter);
    if (this.tab !== 'recent') {
      if (this.sort === 'name') list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
      else if (this.sort === 'charts') list = list.slice().sort((a, b) => b.charts - a.charts);
    }
    return list;
  }

  /** Rebuild all cached view models from the current state. */
  private recompute(): void {
    const scoped = this.scopeBoards();
    this.categories = Array.from(new Set(scoped.map(b => b.category)));
    this.allCount = scoped.length;
    this.favCount = scoped.filter(b => this.isFav(b.id)).length;
    this.draftCount = this.scope === 'my' ? scoped.filter(b => this.isDraft(b)).length : 0;

    const list = this.base();
    this.flatBoards = list;

    const map: Record<string, Board[]> = {};
    const order: string[] = [];
    list.forEach(b => { if (!map[b.category]) { map[b.category] = []; order.push(b.category); } map[b.category].push(b); });
    this.groups = order.map(name => ({ name, boards: map[name] }));

    this.recentBoards = this.recentIds.map(id => scoped.find(b => b.id === id)).filter(Boolean).slice(0, 3) as Board[];
  }

  // ── Open a board ─────────────────────────────────────────
  open(b: Board): void {
    // record recent
    this.recentIds = [b.id, ...this.recentIds.filter(id => id !== b.id)].slice(0, 8);
    this.persist();
    this.recompute();
    const w = window as any;
    if (b.openType === 'dvs' && typeof w.dvsOpenBoard === 'function') {
      w.dvsOpenBoard(parseInt(b.openArg, 10));
    } else if (b.openType === 'navtop' && typeof w.navigateTopLevel === 'function') {
      this.breadcrumb.queuePush(b.name);
      w.navigateTopLevel(b.openArg);
    } else {
      this.breadcrumb.queuePush(b.name);
      this.router.navigateByUrl('/' + b.openArg);
    }
  }

  trackById = (_: number, b: Board) => b.id;
}
