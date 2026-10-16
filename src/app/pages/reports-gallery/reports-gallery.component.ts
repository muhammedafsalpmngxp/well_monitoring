import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { readAllReports, SavedReport } from '../reports/reports.component';
import { PublishService } from '../../features/publishing/publish.service';
import { AuthService } from '../../services/auth.service';
import { getAllSpecs } from '../../features/report-engine/report-spec';

type RIcon = 'bar' | 'donut' | 'line' | 'kpi' | 'table';

interface GReport {
  id: string;
  name: string;
  desc: string;
  category: string;
  icon: RIcon;
  /** For page-backed reports (e.g. All Wells) — open this route instead of the report viewer. */
  route?: string;
  /** True for seeded/standard reports (published by default); created reports start as drafts. */
  standard: boolean;
}

const FAV_KEY = 'smartops.reports.favourites';
const RECENT_KEY = 'smartops.reports.recent';

/**
 * Reports gallery — Standard Reports / My Reports. Same design as the Boards
 * and Charts galleries (tabs, search, category accordion, card/tile toggle).
 * My Reports adds "New Report" + category management; Standard Reports does not.
 * Clicking a report opens it in the Reports viewer.
 */
@Component({
  selector: 'app-reports-gallery',
  templateUrl: './reports-gallery.component.html',
  styleUrls: ['./reports-gallery.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class ReportsGalleryComponent implements AfterViewInit, OnDestroy {

  scope: 'standard' | 'my' = 'standard';
  pageTitle = 'Standard Reports';

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
  groups: { name: string; reports: GReport[] }[] = [];
  flatReports: GReport[] = [];
  recentReports: GReport[] = [];
  allCount = 0;
  favCount = 0;

  private routerSub?: Subscription;

  constructor(private router: Router, private pub: PublishService, private auth: AuthService) {
    this.loadState();
    this.applyScope(this.router.url);
  }

  // ── Publish / draft ──────────────────────────────────────
  isPublished(r: GReport): boolean { return this.pub.isPublished('report', r.id, r.standard); }
  isDraft(r: GReport): boolean { return !this.isPublished(r); }

  /** Publish a draft report — it moves into Standard Reports. */
  publish(r: GReport, ev: Event): void {
    ev.stopPropagation();
    this.pub.publish('report', r.id);
    this.recompute();
  }

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
    const next: 'standard' | 'my' = u.indexOf('myreports') >= 0 ? 'my' : 'standard';
    this.scope = next;
    const admin = (this.auth.currentUser?.role || '').toLowerCase() === 'admin';
    this.pageTitle = next === 'my'
      ? (admin ? 'WIP Reports' : 'My Reports')
      : (admin ? 'Published Reports' : 'Standard Reports');
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
  toggleFav(r: GReport, ev: Event): void {
    ev.stopPropagation();
    const i = this.favourites.indexOf(r.id);
    if (i >= 0) this.favourites.splice(i, 1); else this.favourites.push(r.id);
    this.persist();
    this.recompute();
  }

  /** Reports in the current scope.
   *  - Standard Reports: the pre-built (seeded) reports, read-only.
   *  - My Reports: the user's full report set (seeded defaults are owned by
   *    the user, plus anything created via "New Report").
   */
  /** Page-backed reports that open a full page instead of the report viewer. */
  private readonly pageReports: GReport[] = [
    { id: 'page-allwells', name: 'All Wells', desc: 'Full well register — status, cluster, progress and penalty across the programme.', category: 'Wells', icon: 'table', route: 'allwells', standard: true },
    { id: 'page-daily-plan-nimr', name: 'Daily Plan-Nimr', desc: 'Daily plan grouped by ATNM / Sub Contractors → Discipline with resource totals.', category: 'Daily Plan', icon: 'table', route: 'daily-plan-nimr', standard: true }
  ];

  private isSeed(r: SavedReport): boolean { return (r.id || '').indexOf('rep-seed-') === 0; }

  private mapReport(r: SavedReport, standard: boolean): GReport {
    return {
      id: r.id,
      name: r.name,
      desc: r.description || (r.sourceTableName || ''),
      category: (r as any).category ||
        (standard ? (r.sourceTableName || 'Reports') : 'My Reports'),
      icon: this.iconFor(r),
      standard
    };
  }

  /** Reports in the current scope.
   *  - My Reports: the user's created reports (drafts + published).
   *  - Standard Reports: page-backed + seeded reports + any created report published by an admin.
   */
  private scopeReports(): GReport[] {
    let all: SavedReport[] = [];
    try { all = readAllReports(); } catch { all = []; }
    const created = all.filter(r => !this.isSeed(r));
    if (this.scope === 'my') return created.map(r => this.mapReport(r, false)).concat(this.specReports());

    const seeds = all.filter(r => this.isSeed(r)).map(r => this.mapReport(r, true));
    const publishedCreated = created.map(r => this.mapReport(r, false)).filter(r => this.isPublished(r));
    return this.pageReports.concat(seeds).concat(publishedCreated).concat(this.specReports());
  }

  /** Grouped reports authored via the spec builder. Built-in → Standard; user
   *  specs live in My and promote to Standard once published. */
  private specReports(): GReport[] {
    const mapped: GReport[] = getAllSpecs().map(s => ({
      id: 'spec-' + s.id, name: s.name, desc: s.description || '',
      category: s.category || 'Reports', icon: 'table' as RIcon,
      route: 'report-grid?id=' + s.id, standard: !!s.builtIn
    }));
    return this.scope === 'my'
      ? mapped.filter(r => !r.standard)
      : mapped.filter(r => r.standard || this.isPublished(r));
  }

  private iconFor(r: SavedReport): RIcon {
    const v = r.vizType;
    if (v === 'donut' || v === 'pie') return 'donut';
    if (v === 'line') return 'line';
    if (v === 'kpi') return 'kpi';
    if (v === 'list') return 'table';
    return 'bar';
  }

  private base(): GReport[] {
    let list = this.scopeReports();
    if (this.tab === 'favourites') list = list.filter(r => this.isFav(r.id));
    else if (this.tab === 'draft') list = list.filter(r => this.isDraft(r));
    else if (this.tab === 'recent') list = this.recentIds.map(id => list.find(r => r.id === id)).filter(Boolean) as GReport[];
    const q = this.search.trim().toLowerCase();
    if (q) list = list.filter(r => (r.name + ' ' + r.desc + ' ' + r.category).toLowerCase().includes(q));
    if (this.categoryFilter !== 'All') list = list.filter(r => r.category === this.categoryFilter);
    if (this.tab !== 'recent' && this.sort === 'name') list = list.slice().sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }

  private recompute(): void {
    const scoped = this.scopeReports();
    const w = window as any;
    const data = (typeof w.dbGetData === 'function') ? w.dbGetData() : null;
    const mgrCats: string[] = (data && Array.isArray(data.categories)) ? data.categories.map((c: any) => c.name) : [];
    this.categories = Array.from(new Set(scoped.map(r => r.category).concat(this.scope === 'my' ? mgrCats : [])));
    this.allCount = scoped.length;
    this.favCount = scoped.filter(r => this.isFav(r.id)).length;
    this.draftCount = this.scope === 'my' ? scoped.filter(r => this.isDraft(r)).length : 0;

    const list = this.base();
    this.flatReports = list;
    const map: Record<string, GReport[]> = {};
    const order: string[] = [];
    list.forEach(r => { if (!map[r.category]) { map[r.category] = []; order.push(r.category); } map[r.category].push(r); });
    this.groups = order.map(name => ({ name, reports: map[name] }));
    this.recentReports = this.recentIds.map(id => scoped.find(r => r.id === id)).filter(Boolean).slice(0, 3) as GReport[];
  }

  open(r: GReport): void {
    this.recentIds = [r.id, ...this.recentIds.filter(id => id !== r.id)].slice(0, 8);
    this.persist();
    this.recompute();
    // Page-backed report → open the full page (keeps all its API integrations).
    if (r.route) { this.router.navigateByUrl('/' + r.route); return; }
    const w = window as any;
    if (typeof w.openReportById === 'function') w.openReportById(r.id);
    else this.router.navigateByUrl('/reports');
  }

  /** New Report — opens the Grouped Report Builder (My Reports only). */
  newReport(): void { this.router.navigateByUrl('/report-grid-builder'); }

  /** Manage report categories (shared category manager). */
  manageCategories(): void {
    const w = window as any;
    if (typeof w.dbOpenCategoryMgr === 'function') w.dbOpenCategoryMgr();
    setTimeout(() => this.recompute(), 400);
  }

  trackById = (_: number, r: GReport) => r.id;
}
