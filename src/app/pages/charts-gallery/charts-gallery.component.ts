import { Component, AfterViewInit, OnDestroy, ViewEncapsulation, NgZone } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { PublishService } from '../../features/publishing/publish.service';
import { AuthService } from '../../services/auth.service';

type ChartIcon = 'bar' | 'donut' | 'line' | 'kpi' | 'table';

interface GChart {
  id: string;
  name: string;
  desc: string;
  category: string;
  icon: ChartIcon;
  custom: boolean;
  /** Operations Dashboard composite chart — opens as a page-level drill-down. */
  ops: boolean;
  /** Labour-productivity AI chart — keeps its dedicated viewer. */
  labour: boolean;
  /** True for built-in standard charts (published by default); user charts start as drafts. */
  standard: boolean;
}

const FAV_KEY = 'smartops.charts.favourites';
const RECENT_KEY = 'smartops.charts.recent';

/**
 * Charts gallery — Standard Charts / My Charts. Same design as the Boards
 * gallery: tabs, search, category accordion, card/tile toggle. My Charts adds
 * an "Add Chart" action and category management. Clicking a chart opens its
 * viewer.
 */
@Component({
  selector: 'app-charts-gallery',
  templateUrl: './charts-gallery.component.html',
  styleUrls: ['./charts-gallery.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ChartsGalleryComponent implements AfterViewInit, OnDestroy {

  scope: 'standard' | 'my' = 'standard';
  /** 'charts' = regular charts gallery; 'tiles' = KPI-tile gallery (Published/WIP Tiles). */
  kind: 'charts' | 'tiles' = 'charts';
  pageTitle = 'Standard Charts';

  get isTiles(): boolean { return this.kind === 'tiles'; }
  /** Singular noun for labels/empty states ("chart" / "tile"). */
  get noun(): string { return this.isTiles ? 'tile' : 'chart'; }

  tab: 'all' | 'favourites' | 'recent' | 'draft' = 'all';
  view: 'card' | 'tile' = 'card';
  search = '';
  categoryFilter = 'All';
  sort: 'recent' | 'name' = 'recent';
  draftCount = 0;

  private expanded: Record<string, boolean> = {};
  favourites: string[] = [];
  recentIds: string[] = [];

  categories: string[] = [];
  groups: { name: string; charts: GChart[] }[] = [];
  flatCharts: GChart[] = [];
  recentCharts: GChart[] = [];
  allCount = 0;
  favCount = 0;

  private routerSub?: Subscription;

  constructor(private router: Router, private pub: PublishService, private zone: NgZone, private auth: AuthService) {
    this.loadState();
    this.applyScope(this.router.url);
  }

  // ── Publish / draft ──────────────────────────────────────
  isPublished(c: GChart): boolean { return this.pub.isPublished('chart', c.id, c.standard); }
  isDraft(c: GChart): boolean { return !this.isPublished(c); }

  /** Publish a draft chart — it moves into Standard Charts. */
  publish(c: GChart, ev: Event): void {
    ev.stopPropagation();
    this.pub.publish('chart', c.id);
    this.recompute();
  }

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;
    this.routerSub = this.router.events
      .pipe(filter(e => e instanceof NavigationEnd))
      .subscribe((e: any) => this.applyScope(e.urlAfterRedirects || e.url || ''));
    // Let the (global-JS) Chart AI Agent refresh this gallery after it saves a chart.
    (window as any).__chartsGalleryRefresh = () => this.zone.run(() => this.recompute());
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    if ((window as any).__chartsGalleryRefresh) { try { delete (window as any).__chartsGalleryRefresh; } catch { /* noop */ } }
  }

  private applyScope(url: string): void {
    const u = (url || '').split('?')[0];
    this.kind = u.indexOf('tiles') >= 0 ? 'tiles' : 'charts';
    const my = u.indexOf('mycharts') >= 0 || u.indexOf('wiptiles') >= 0;
    this.scope = my ? 'my' : 'standard';
    const admin = (this.auth.currentUser?.role || '').toLowerCase() === 'admin';
    if (this.isTiles) {
      this.pageTitle = my
        ? (admin ? 'WIP Tiles' : 'My Tiles')
        : (admin ? 'Published Tiles' : 'Standard Tiles');
    } else {
      this.pageTitle = my
        ? (admin ? 'WIP Charts' : 'My Charts')
        : (admin ? 'Published Charts' : 'Standard Charts');
    }
    this.recompute();
  }

  private loadState(): void {
    try { this.favourites = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { this.favourites = []; }
    try { this.recentIds = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { this.recentIds = []; }
  }
  private persist(): void {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(this.favourites)); } catch {}
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(this.recentIds)); } catch {}
  }

  setTab(t: 'all' | 'favourites' | 'recent' | 'draft'): void { this.tab = t; this.recompute(); }
  setView(v: 'card' | 'tile'): void { this.view = v; }
  onFilterChange(): void { this.recompute(); }
  isExpanded(cat: string): boolean { return this.expanded[cat] !== false; }
  toggleCategory(cat: string): void { this.expanded[cat] = this.isExpanded(cat) ? false : true; }

  isFav(id: string): boolean { return this.favourites.includes(id); }
  toggleFav(c: GChart, ev: Event): void {
    ev.stopPropagation();
    const i = this.favourites.indexOf(c.id);
    if (i >= 0) this.favourites.splice(i, 1); else this.favourites.push(c.id);
    this.persist();
    this.recompute();
  }

  private mapChart(c: any, standard: boolean): GChart {
    return {
      id: c.id,
      name: c.name || 'Untitled chart',
      desc: c.desc || '',
      category: c.category || (standard ? 'Standard Charts' : 'My Charts'),
      icon: this.iconFor(c.type),
      custom: !!c.custom,
      ops: !!c.ops,
      labour: !!c.labourProd,
      standard
    };
  }

  /** Charts belonging to the current scope, read live from app-globals.
   *  - My Charts: the user's charts (drafts + published).
   *  - Standard Charts: built-in charts + any user chart an admin has published.
   */
  private scopeCharts(): GChart[] {
    const w = window as any;
    const rawStd: any[] = (typeof w.chartsGetStandard === 'function') ? w.chartsGetStandard() : [];
    const rawUser: any[] = (typeof w.chartsGetUser === 'function') ? w.chartsGetUser() : [];
    const user = rawUser.map(c => this.mapChart(c, false));
    if (this.scope === 'my') return this.byKind(user);
    const std = rawStd.map(c => this.mapChart(c, true));
    return this.byKind(std.concat(user.filter(c => this.isPublished(c))));
  }

  /** Tiles gallery shows only KPI tiles; the charts gallery shows everything else. */
  private byKind(list: GChart[]): GChart[] {
    return list.filter(c => this.isTiles ? c.icon === 'kpi' : c.icon !== 'kpi');
  }

  private iconFor(type: string): ChartIcon {
    if (type === 'donut' || type === 'pie') return 'donut';
    if (type === 'line') return 'line';
    if (type === 'kpi') return 'kpi';
    if (type === 'table') return 'table';
    return 'bar';
  }

  private base(): GChart[] {
    let list = this.scopeCharts();
    if (this.tab === 'favourites') list = list.filter(c => this.isFav(c.id));
    else if (this.tab === 'draft') list = list.filter(c => this.isDraft(c));
    else if (this.tab === 'recent') list = this.recentIds.map(id => list.find(c => c.id === id)).filter(Boolean) as GChart[];
    const q = this.search.trim().toLowerCase();
    if (q) list = list.filter(c => (c.name + ' ' + c.desc + ' ' + c.category).toLowerCase().includes(q));
    if (this.categoryFilter !== 'All') list = list.filter(c => c.category === this.categoryFilter);
    if (this.tab !== 'recent' && this.sort === 'name') list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }

  private recompute(): void {
    const scoped = this.scopeCharts();
    // Category dropdown = categories present on charts + any manager-defined ones.
    const w = window as any;
    const data = (typeof w.dbGetData === 'function') ? w.dbGetData() : null;
    const mgrCats: string[] = (data && Array.isArray(data.categories)) ? data.categories.map((c: any) => c.name) : [];
    this.categories = Array.from(new Set(scoped.map(c => c.category).concat(this.scope === 'my' ? mgrCats : [])));
    this.allCount = scoped.length;
    this.favCount = scoped.filter(c => this.isFav(c.id)).length;
    this.draftCount = this.scope === 'my' ? scoped.filter(c => this.isDraft(c)).length : 0;

    const list = this.base();
    this.flatCharts = list;
    const map: Record<string, GChart[]> = {};
    const order: string[] = [];
    list.forEach(c => { if (!map[c.category]) { map[c.category] = []; order.push(c.category); } map[c.category].push(c); });
    this.groups = order.map(name => ({ name, charts: map[name] }));
    // Pin "Operations Dashboard" to the top of the category list (below the
    // Recently Viewed row, above Productivity and the rest).
    this.groups.sort((a, b) => this.catRank(a.name) - this.catRank(b.name));
    this.recentCharts = this.recentIds.map(id => scoped.find(c => c.id === id)).filter(Boolean).slice(0, 3) as GChart[];
  }

  /** Category sort rank — pinned categories first, everything else in place. */
  private catRank(name: string): number {
    const PINNED = ['Operations Dashboard'];
    const i = PINNED.indexOf(name);
    return i === -1 ? PINNED.length : i;
  }

  open(c: GChart): void {
    this.recentIds = [c.id, ...this.recentIds.filter(id => id !== c.id)].slice(0, 8);
    this.persist();
    this.recompute();
    // Charts open as an inside page (not a popup):
    //  • Operations Dashboard composite charts → their click-to-drill page.
    //  • Everything else (incl. Labour-productivity AI charts) → the Chart View page.
    if (c.ops) {
      this.router.navigate(['/chart-drilldown'], { queryParams: { id: c.id } });
      return;
    }
    this.router.navigate(['/chart-view'], { queryParams: { id: c.id } });
  }

  /** Add button → chart or tile depending on the gallery kind. */
  addItem(): void { if (this.isTiles) this.addTile(); else this.addChart(); }

  /** Edit an existing custom chart/tile — opens the builder pre-filled. */
  editChart(c: GChart, ev: Event): void {
    ev.stopPropagation();
    const w = window as any;
    if (typeof w.chartsEditChart === 'function') w.chartsEditChart(c.id);
  }

  /** Add a chart — new charts land in the active category (else "My Charts"). */
  addChart(): void {
    const w = window as any;
    w.__chartForceType = null;
    w.__chartAddCategory = (this.categoryFilter !== 'All') ? this.categoryFilter : 'My Charts';
    if (typeof w.chartsAddChart === 'function') w.chartsAddChart();
    setTimeout(() => this.recompute(), 400);
  }

  /** Add a tile — same builder as Add Chart, but the type is locked to a KPI tile. */
  addTile(): void {
    const w = window as any;
    w.__chartForceType = 'kpi';
    w.__chartAddCategory = (this.categoryFilter !== 'All') ? this.categoryFilter : 'My Tiles';
    if (typeof w.chartsAddChart === 'function') w.chartsAddChart();
    setTimeout(() => this.recompute(), 400);
  }

  /** Create a chart with the AI agent (same one used in dashboard creation). */
  aiChart(): void {
    const w = window as any;
    w.__chartAddCategory = (this.categoryFilter !== 'All') ? this.categoryFilter : 'My Charts';
    if (typeof w.chartsOpenAIAgent === 'function') w.chartsOpenAIAgent();
  }

  /** Manage chart categories (shared category manager). */
  manageCategories(): void {
    const w = window as any;
    if (typeof w.dbOpenCategoryMgr === 'function') w.dbOpenCategoryMgr();
    setTimeout(() => this.recompute(), 400);
  }

  trackById = (_: number, c: GChart) => c.id;
}
