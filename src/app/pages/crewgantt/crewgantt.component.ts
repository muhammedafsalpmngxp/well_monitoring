import {
  Component,
  AfterViewInit,
  OnDestroy,
  ViewEncapsulation,
  ElementRef,
  ViewChild
} from '@angular/core';
import { Subscription } from 'rxjs';
import { CrewService, CrewCalendarResponse, CalendarGroup, CalendarActivity, CalendarFilters } from '../../services/crew.service';
import { DashboardService, HfbFilter } from '../../services/dashboard.service';

declare const Highcharts: any;

type WellStatus = 'planned' | 'inprogress' | 'completed' | 'delayed' | 'notstarted';
type ViewMode = 'day' | 'week' | 'month';
type NodeType = 'group' | 'activity' | 'well' | 'crew';

interface TreeNode {
  key: string;
  name: string;            // group name / crew id / activity id
  type: NodeType;
  expanded: boolean;
  children: TreeNode[];
  spanStart: number;       // PLANNED start
  spanEnd: number;         // PLANNED end
  actualStart?: number;    // actual start (undefined if not started yet)
  actualEnd?: number;      // actual end / progress-to-date
  status: WellStatus;
  completion: number;
  category?: string;       // activity only
  milestone?: boolean;     // activity only
  wellId?: string;         // activity only — which well the activity is on
  crewCode?: string;       // drill-down activity only — e.g. FL-CV-ML01-01
  desc?: string;           // drill-down activity only — description
  crewId?: string;         // assigned crew (only set ~1 day before work); undefined = not yet assigned
  crewGroup?: string;      // activity only — the crew group responsible
  actName?: string;        // activity only — human-readable name (id shown on hover)
  rawKey?: string;         // activity only — stable identity for manual crew assignment
}

interface RowVM {
  key: string;
  node: TreeNode;
  type: NodeType;
  depth: number;
  open: boolean;
  name: string;
  completion: number;
  count: string;
  segments: { color: string; pct: number }[];
  dotColor: string;
  isMilestone: boolean;
  category?: string;       // right-aligned sub text (category in main, description in drill)
  crewCode?: string;       // drill-down leaf
  crewId?: string;         // assigned crew (undefined = not assigned)
  crewGroup?: string;      // crew group responsible (well-tree leaf)
  crewUnassigned?: boolean;// true for an activity row with no crew yet
  actName?: string;        // activity display name (id on hover)
  expandable?: boolean;    // whether the row shows a chevron / can expand
  status: WellStatus;
  subCount?: number;       // number of sub-items when collapsed (for dynamic row height)
}

const DAY = 24 * 3600 * 1000;
const ROW_H = 36;
const HEADER_H = 80;

@Component({
  selector: 'app-crewgantt',
  templateUrl: './crewgantt.component.html',
  styleUrls: ['./crewgantt.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class CrewGanttComponent implements AfterViewInit, OnDestroy {
  @ViewChild('chartHost', { static: true }) chartHost!: ElementRef<HTMLDivElement>;

  constructor(private crewService: CrewService, private dashService: DashboardService) {}

  /** True while the initial API call is in flight */
  loading = false;
  loadError: string | null = null;
  private filterSub?: Subscription;
  private currentApiFilters: CalendarFilters = {};

  /** ---- UI state ---- */
  view: ViewMode = 'week';
  search = '';
  windowStart = 0;
  rangeLabel = '';
  rowH = ROW_H;
  headerH = HEADER_H;

  displayRows: RowVM[] = [];
  selectedKey: string | null = null;
  openMenuKey: string | null = null;

  /** Assign-crew dialog */
  assignTarget: TreeNode | null = null;
  assignChoice: string | null = null;
  private manualCrew: Record<string, string> = {};

  /** Occupancy tooltip popover */
  occTipVisible = false;
  occTipX = 0;
  occTipY = 0;
  occTipTitle = '';
  occTipBody = '';
  private occTipTimer: any;

  showOccTip(event: MouseEvent, r: RowVM): void {
    clearTimeout(this.occTipTimer);
    const el = event.target as HTMLElement;
    const rect = el.getBoundingClientRect();
    this.occTipX = rect.left + rect.width / 2;
    this.occTipY = rect.top - 8;
    const node = r.node;
    const wS = this.windowStart;
    const wE = wS + this.spanDays() * DAY;
    const windowDays = this.spanDays();
    const fmtD = (ts: number) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const winLabel = `${fmtD(wS)} – ${fmtD(wE - DAY)}`;

    if (node.type === 'crew') {
      this.occTipTitle = `Crew Occupancy: ${r.completion}%`;
      const acts = node.children.filter(a => !a.milestone);
      let lines: string[] = [];
      let totalHrs = 0;
      acts.forEach(a => {
        const s = Math.max(a.spanStart, wS);
        const e = Math.min(a.spanEnd, wE - DAY);
        if (e >= s) {
          const days = Math.round((e - s) / DAY) + 1;
          totalHrs += days * 8;
          lines.push(`<b>${a.name}</b>: ${days} day${days > 1 ? 's' : ''} × 8 hrs = <b>${days * 8} hrs</b>`);
        }
      });
      const available = windowDays * 8;
      if (!lines.length) {
        this.occTipBody = `No activities overlap the view window.<br><span class="cg-occ-tip-dim">Window: ${winLabel} (${windowDays} days)</span>`;
      } else {
        this.occTipBody = lines.join('<br>')
          + `<br><span class="cg-occ-tip-sep"></span>`
          + `Total hours: <b>${totalHrs} hrs</b><br>`
          + `Available: ${windowDays} days × 8 hrs = <b>${available} hrs</b><br>`
          + `Occupancy = ${totalHrs} ÷ ${available} = <b>${r.completion}%</b>`
          + `<br><span class="cg-occ-tip-dim">Window: ${winLabel}</span>`;
      }
    } else {
      const crews = this.collectCrews(node);
      this.occTipTitle = `Avg Occupancy: ${r.completion}%`;
      const crewLines = crews.map(c => {
        const occ = this.crewOccupancy(c.children);
        return `<b>${c.name}</b>: ${occ}%`;
      });
      this.occTipBody = crewLines.join('<br>')
        + `<br><span class="cg-occ-tip-sep"></span>`
        + `Average of ${crews.length} crew${crews.length > 1 ? 's' : ''} = <b>${r.completion}%</b>`
        + `<br><span class="cg-occ-tip-dim">Window: ${winLabel} · Each crew = (overlap days × 8) ÷ (${windowDays} × 8)</span>`;
    }
    this.occTipVisible = true;
  }

  hideOccTip(): void {
    this.occTipTimer = setTimeout(() => { this.occTipVisible = false; }, 100);
  }

  /** Legend toggles — keys turned off here are hidden from the chart/tree. */
  legendOff = new Set<string>();
  toggleLegend(key: string): void {
    if (this.legendOff.has(key)) this.legendOff.delete(key);
    else this.legendOff.add(key);
    this.refresh();
  }
  isLegendOff(key: string): boolean { return this.legendOff.has(key); }

  /** Planned vs Actual rendering mode */
  compareMode: 'both' | 'planned' | 'actual' = 'both';

  /** Left tree organisation */
  treeMode: 'crew' | 'well' = 'crew';

  /** What the main-view timeline bars represent.
   *  crew tree → 'wells' | 'activities';  well tree → 'activities' | 'crew' */
  timelineBy: 'wells' | 'activities' | 'crew' = 'wells';

  /** Well-level drill-down: null = main crew-group view, else the well id being inspected */
  drillWell: string | null = null;
  private savedView: ViewMode = 'week';
  private savedWindow = 0;

  /** ---- filter state ---- */
  filterOpen = false;
  filterGroups: string[] = [];
  filterStatus: WellStatus[] = [];
  filterCategory: string[] = [];
  filterWell: string[] = [];
  groupOptions: string[] = [];
  wellOptions: string[] = [];
  statusOptions: { key: WellStatus; label: string }[] = [
    { key: 'inprogress', label: 'In Progress' },
    { key: 'completed',  label: 'Completed' },
    { key: 'delayed',    label: 'Delayed' },
    { key: 'notstarted', label: 'Not Started' }
  ];
  categoryOptions: string[] = ['Sleeper Laying', 'Foundation Installation', 'RDX / WDX Excavation', 'Milestone'];

  private today = Date.now();

  readonly legend: { key: WellStatus | 'milestone'; label: string; color: string }[] = [
    { key: 'planned',    label: 'Planned',     color: '#cbd5e1' },
    { key: 'inprogress', label: 'In Progress', color: '#29378d' },
    { key: 'completed',  label: 'Completed',   color: '#16a34a' },
    { key: 'delayed',    label: 'Delayed',     color: '#f59e0b' },
    { key: 'notstarted', label: 'Not Started', color: '#e2e8f0' },
    { key: 'milestone',  label: 'Milestone',   color: '#7c3aed' }
  ];
  private statusColor(s: WellStatus): string {
    return this.legend.find(l => l.key === s)!.color as string;
  }

  private chart: any;
  private tree: TreeNode[] = [];
  private nodeMap: Record<string, TreeNode> = {};
  private themeObserver?: MutationObserver;

  /** ---- Source data: Crew Group → Activity (FLCV…) directly; each activity is on a Well.
   *       s/e = planned start/end, as/ae = actual start/end (omitted if not started). ---- */
  private rawGroups: any[] = [
    { name: 'FRL-0504', activities: [
      { name: 'FLCV1000', well: '34398', cat: 'Sleeper Laying',          s: [4, 28], e: [5, 3],  as: [4, 28], ae: [5, 4],  st: 'completed'  },
      { name: 'FLCV1030', well: '34398', cat: 'Foundation Installation', s: [5, 4],  e: [5, 12], as: [5, 5],  ae: [5, 14], st: 'completed'  },
      { name: 'FLCV1130', well: '34397', cat: 'RDX / WDX Excavation',    s: [5, 13], e: [5, 22], as: [5, 14], ae: [5, 18], st: 'inprogress' },
      { name: 'FLCV1140', well: '34397', cat: 'RDX / WDX Excavation',    s: [5, 23], e: [6, 1],  st: 'notstarted' },
      { name: 'FLCV1010', well: '25150', cat: 'Sleeper Laying',          s: [5, 5],  e: [5, 11], as: [5, 5],  ae: [5, 10], st: 'completed'  },
      { name: 'FLCV1040', well: '25150', cat: 'Foundation Installation', s: [5, 12], e: [5, 20], as: [5, 12], ae: [5, 18], st: 'inprogress' },
      { name: 'FLCV1150', well: '25150', cat: 'RDX / WDX Excavation',    s: [5, 21], e: [5, 30], st: 'notstarted' },
      { name: 'MS1000',   well: '34398', cat: 'Milestone', date: [5, 2],  milestone: true },
      { name: 'MS1010',   well: '34397', cat: 'Milestone', date: [6, 1],  milestone: true },
      { name: 'MIL2000',  well: '25150', cat: 'Milestone', date: [5, 30], milestone: true }
    ]},
    { name: 'LCC-0803', activities: [
      { name: 'FLCV1020', well: '34400', cat: 'Sleeper Laying',          s: [4, 25], e: [5, 1],  as: [4, 26], ae: [5, 2],  st: 'completed'  },
      { name: 'FLCV1050', well: '34400', cat: 'Foundation Installation', s: [5, 2],  e: [5, 10], as: [5, 2],  ae: [5, 9],  st: 'completed'  },
      { name: 'FLCV1060', well: '34400', cat: 'Foundation Installation', s: [5, 11], e: [5, 18], as: [5, 11], ae: [5, 18], st: 'inprogress' },
      { name: 'FLCV1160', well: '34400', cat: 'RDX / WDX Excavation',    s: [5, 9],  e: [5, 15], as: [5, 11], ae: [5, 19], st: 'delayed'    },
      { name: 'FLCV1070', well: '31352', cat: 'Foundation Installation', s: [5, 8],  e: [5, 16], as: [5, 9],  ae: [5, 18], st: 'inprogress' },
      { name: 'FLCV1170', well: '31352', cat: 'RDX / WDX Excavation',    s: [5, 17], e: [5, 26], as: [5, 17], ae: [5, 18], st: 'inprogress' },
      { name: 'FLCV1180', well: '31352', cat: 'RDX / WDX Excavation',    s: [5, 27], e: [6, 5],  st: 'notstarted' },
      { name: 'MS1015',   well: '34400', cat: 'Milestone', date: [5, 28], milestone: true },
      { name: 'MS1020',   well: '31352', cat: 'Milestone', date: [6, 5],  milestone: true }
    ]},
    { name: 'FCC-0501', activities: [
      { name: 'FLCV1080', well: '30347', cat: 'Foundation Installation', s: [5, 1],  e: [5, 9],  as: [5, 1],  ae: [5, 8],  st: 'completed'  },
      { name: 'FLCV1090', well: '30347', cat: 'Foundation Installation', s: [5, 4],  e: [5, 11], as: [5, 6],  ae: [5, 16], st: 'delayed'    },
      { name: 'FLCV1190', well: '30347', cat: 'RDX / WDX Excavation',    s: [5, 19], e: [5, 29], st: 'notstarted' },
      { name: 'FLCV1011', well: '25150', cat: 'Sleeper Laying',          s: [5, 18], e: [5, 24], st: 'notstarted' },
      { name: 'FLCV1031', well: '25150', cat: 'Foundation Installation', s: [5, 12], e: [5, 20], as: [5, 13], ae: [5, 18], st: 'inprogress' },
      { name: 'FLCV1141', well: '25150', cat: 'RDX / WDX Excavation',    s: [5, 21], e: [6, 2],  st: 'notstarted' },
      { name: 'MIL2010',  well: '30347', cat: 'Milestone', date: [5, 29], milestone: true },
      { name: 'MS1030',   well: '25150', cat: 'Milestone', date: [6, 2],  milestone: true }
    ]}
  ];

  /** ---- Drill-down activity catalog (per well) — from the flowline breakdown sheet ---- */
  private drillCatalog: { id: string; code: string; cat: string; desc: string; dur: number }[] = [
    { id: 'FLCV1000', code: 'FL-CV-ML01-01',   cat: 'Sleeper Laying',          desc: 'Surveying & Setting out for Flow Line', dur: 4 },
    { id: 'FLCV1010', code: 'FL-CV-ML01-02',   cat: 'Sleeper Laying',          desc: 'Flow line Route Grading', dur: 5 },
    { id: 'FLCV1020', code: 'FL-CV-ML01-03',   cat: 'Sleeper Laying',          desc: 'Unloading, installation and alignment of sleeper', dur: 6 },
    { id: 'FLCV1030', code: 'FL-CV-ML02-01',   cat: 'Foundation Installation', desc: 'Unloading, Installation and Alignment of Anchor Foundation at site / Higher sleeper', dur: 6 },
    { id: 'FLCV1040', code: 'FL-CV-ML02-02-2', cat: 'Foundation Installation', desc: 'Excavation and Cleaning for Pipe support foundation in Normal Soil', dur: 5 },
    { id: 'FLCV1050', code: 'FL-CV-ML02-02-1', cat: 'Foundation Installation', desc: 'Excavation and Cleaning for pipe support foundation in Hard Rock', dur: 7 },
    { id: 'FLCV1060', code: 'FL-CV-ML02-03',   cat: 'Foundation Installation', desc: 'Manual Excavation and Removal of Normal Soil for Foundation', dur: 5 },
    { id: 'FLCV1070', code: 'FL-CV-ML02-04',   cat: 'Foundation Installation', desc: 'Unloading, Installation and Alignment of Precast Pipe Support Foundation at site', dur: 6 },
    { id: 'FLCV1080', code: 'FL-CV-ML02-05',   cat: 'Foundation Installation', desc: 'Backfilling for Pipe support Foundation', dur: 4 },
    { id: 'FLCV1090', code: 'FL-CV-ML02-06',   cat: 'Foundation Installation', desc: 'Grouting for Structural Pipe Support', dur: 4 },
    { id: 'FLCV1130', code: 'FL-CV-ML02-10',   cat: 'RDX / WDX Excavation & prepad', desc: 'Construction of Diversion to Access Road for Road Crossing', dur: 5 },
    { id: 'FLCV1140', code: 'FL-CV-ML03-01-1', cat: 'RDX / WDX Excavation & prepad', desc: 'Excavation in Hard Rock for Road Crossing, Wadi and Water catchment', dur: 7 },
    { id: 'FLCV1150', code: 'FL-CV-ML03-01-2', cat: 'RDX / WDX Excavation & prepad', desc: 'Excavation in normal soil for Road Crossing, Wadi and Water catchment', dur: 5 },
    { id: 'FLCV1160', code: 'FL-CV-ML03-01-3', cat: 'RDX / WDX Excavation & prepad', desc: 'Excavation in Ex Hard Rock for Rd Crossing, Wadi and Water catchment', dur: 6 },
    { id: 'FLCV1170', code: 'FL-CV-ML03-02-1', cat: 'RDX / WDX Excavation & prepad', desc: 'Manual Excavation for Live Cable Crossing / Pipeline Crossing for normal soil', dur: 5 },
    { id: 'FLCV1180', code: 'FL-CV-ML03-02-2', cat: 'RDX / WDX Excavation & prepad', desc: 'Manual Excavation for Live Cable Crossing / Pipeline Crossing for hard rock', dur: 6 },
    { id: 'FLCV1190', code: 'FL-CV-ML03-02-3', cat: 'RDX / WDX Excavation & prepad', desc: 'Manual Excavation for Live Cable Crossing / Pipeline Crossing for extreme hard rock', dur: 7 },
    { id: 'FLCV1200', code: 'FL-CV-ML03-03',   cat: 'RDX / WDX Excavation & prepad', desc: 'Cleaning and Pre Padding of Road Crossing, Wadi and Water catchment', dur: 4 },
    { id: 'FLCV1210', code: 'FL-CV-ML03-04',   cat: 'RDX / WDX Excavation & prepad', desc: 'Excavation for Ramp (Upto 3 Pipe lines)', dur: 5 },
    { id: 'FLCV1220', code: 'FL-CV-ML03-05',   cat: 'RDX / WDX Excavation & prepad', desc: 'Cleaning & Pre Padding for Ramp Works', dur: 4 }
  ];
  /** A starting month per well so each drill-down shows different progress. */
  private wellBase: Record<string, number[]> = {
    '34398': [3, 25], '34397': [4, 15], '25150': [3, 10],
    '34400': [4, 5],  '31352': [4, 28], '30347': [4, 1]
  };

  /** Crew teams available per crew group (drawn from just before work starts). */
  private crewPools: Record<string, string[]> = {
    'FRL-0504': ['FRL-CR-01', 'FRL-CR-02', 'FRL-CR-03'],
    'LCC-0803': ['LCC-CR-01', 'LCC-CR-02'],
    'FCC-0501': ['FCC-CR-01', 'FCC-CR-02', 'FCC-CR-03']
  };

  /** Crews are assigned only ~1 day before the activity actually starts; before that
   *  the activity is held against the crew group with no crew id. */
  private assignCrew(spanStart: number, idx: number, pool: string[]): string | undefined {
    return spanStart <= this.today + DAY ? pool[idx % pool.length] : undefined;
  }

  /** Human-readable activity name for a given activity id (from the breakdown catalog). */
  private _nameMap?: Record<string, string>;
  private nameOf(id: string): string {
    if (!this._nameMap) {
      this._nameMap = {};
      this.drillCatalog.forEach(c => (this._nameMap![c.id] = c.desc));
    }
    return this._nameMap[id] || '';
  }

  /** ---- lifecycle ---- */
  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    this.themeObserver = new MutationObserver(() => this.buildChart());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    // Subscribe to global filter changes (Cluster, Site, Project, WellType)
    this.filterSub = this.dashService.filter$.subscribe(f => {
      this.onGlobalFilterChange(f);
    });
  }

  /** React to global filter bar changes — re-fetch API with new filter params. */
  private onGlobalFilterChange(f: HfbFilter): void {
    this.currentApiFilters = {
      cluster:  f.cluster || undefined,
      site:     f.site || undefined,
      project:  f.project || undefined,
      // Note: f.location is well classification (Conventional/Horizontal) — not activity type (A/T/W/M).
      // Do NOT pass it as wellType to this API.
    };
    this.loadCalendarData();
  }

  /** Fetch crew calendar from API; falls back to hardcoded data on error. */
  private loadCalendarData(): void {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    this.loading = true;
    this.loadError = null;

    const filters: CalendarFilters = {
      ...this.currentApiFilters,
      from,
      to
    };

    this.crewService.getCrewCalendar(filters).subscribe({
      next: (res) => {
        this.applyCalendarResponse(res);
        this.loading = false;
      },
      error: (err) => {
        console.warn('Crew calendar API unavailable, using fallback data', err);
        this.loadError = 'API unavailable — showing demo data';
        this.loading = false;
        this.initWithFallbackData();
      }
    });
  }

  /** Transform API response into the rawGroups format the tree builders expect. */
  private applyCalendarResponse(res: CrewCalendarResponse): void {
    this.rawGroups = res.groups.map((g: CalendarGroup) => ({
      name: g.crewGroupCode,
      activities: (g.crews.flatMap((c) =>
        c.activities.map((a: CalendarActivity) => ({
          name: a.activityCode,
          well: a.wellId,
          cat: a.category || 'General',
          actText: a.activityName || undefined,
          s: a.plannedStart,
          e: a.plannedEnd,
          as: a.actualStart || undefined,
          ae: a.actualEnd || undefined,
          st: a.status === 'milestone' ? 'notstarted' : a.status,
          prog: a.progress ?? 0,
          milestone: a.isMilestone,
          date: a.isMilestone ? a.plannedStart : undefined,
          _crewId: c.crewCode
        }))
      ) as any[]).concat(
        // Attach milestones from the same wells to this group
        res.milestones
          .filter((m: CalendarActivity) =>
            g.crews.some(c => c.activities.some(a => a.wellId === m.wellId)))
          .map((m: CalendarActivity) => ({
            name: m.activityCode,
            well: m.wellId,
            cat: 'Milestone',
            s: m.plannedStart,
            e: m.plannedEnd,
            as: undefined,
            ae: undefined,
            st: 'notstarted' as const,
            milestone: true,
            date: m.plannedStart,
            _crewId: undefined
          }))
      )
    }));

    // Build crew pools from actual crew_uid values
    this.crewPools = {};
    res.groups.forEach((g: CalendarGroup) => {
      this.crewPools[g.crewGroupCode] = g.crews.map(c => c.crewCode);
    });

    this.today = Date.now();
    this.initAfterDataLoad();
  }

  /** Initialize with hardcoded fallback data. */
  private initWithFallbackData(): void {
    this.initAfterDataLoad();
  }

  /** Common init after data (API or fallback) is ready. */
  private initAfterDataLoad(): void {
    this.wellOptions = [...new Set(this.rawGroups.flatMap((g: any) => g.activities.map((a: any) => a.well)))].sort();
    // Build category options dynamically from actual data + Milestone
    const cats = new Set<string>(this.rawGroups.flatMap((g: any) =>
      g.activities.filter((a: any) => !a.milestone && a.cat).map((a: any) => a.cat as string)));
    this.categoryOptions = [...cats].sort();
    if (!this.categoryOptions.includes('Milestone')) this.categoryOptions.push('Milestone');
    this.buildTree();
    const now = new Date();
    this.windowStart = Date.UTC(now.getFullYear(), now.getMonth(), 1);
    this.refresh();
  }

  ngOnDestroy(): void {
    this.themeObserver?.disconnect();
    this.filterSub?.unsubscribe();
    this.chart?.destroy?.();
  }

  /** ---- tree build ---- */
  /** Parse a date — accepts [month,day] arrays (legacy) or ISO date strings (API). */
  private d(p: number[] | string): number {
    if (typeof p === 'string') return new Date(p + 'T00:00:00Z').getTime();
    return Date.UTC(2026, p[0], p[1]);
  }

  private aggStatus(leaves: TreeNode[]): WellStatus {
    const set = new Set(leaves.map(l => l.status));
    if (set.has('delayed')) return 'delayed';
    if (set.has('inprogress')) return 'inprogress';
    if (set.has('completed') && (set.has('notstarted') || set.has('planned'))) return 'inprogress';
    if (set.has('completed')) return 'completed';
    return 'notstarted';
  }
  /** Occupancy % for a single crew's activities within the current view window.
   *  Formula: min(sum(overlapDays × 8) / (windowDays × 8) × 100, 100) */
  private crewOccupancy(activities: TreeNode[]): number {
    const wS = this.windowStart;
    const wE = wS + this.spanDays() * DAY;
    const windowDays = this.spanDays();
    if (!windowDays) return 0;
    let totalHrs = 0;
    activities.forEach(a => {
      if (a.milestone) return;
      const s = Math.max(a.spanStart, wS);
      const e = Math.min(a.spanEnd, wE - DAY);
      if (e >= s) {
        const overlapDays = Math.round((e - s) / DAY) + 1;
        totalHrs += overlapDays * 8;
      }
    });
    return Math.min(Math.round((totalHrs / (windowDays * 8)) * 100), 100);
  }

  /** Occupancy for a node: crew → its own activities, group/well → average of crew children. */
  private pct(node: TreeNode): number {
    if (node.type === 'activity') return 0;
    if (node.type === 'crew') return this.crewOccupancy(node.children);
    // group or well: average of crew occupancies
    const crewNodes = this.collectCrews(node);
    if (!crewNodes.length) return 0;
    const sum = crewNodes.reduce((s, c) => s + this.crewOccupancy(c.children), 0);
    return Math.round(sum / crewNodes.length);
  }

  /** Collect all crew-type descendants of a node. */
  private collectCrews(node: TreeNode): TreeNode[] {
    if (node.type === 'crew') return [node];
    return node.children.flatMap(c => this.collectCrews(c));
  }

  /** True when the Well tree is grouped by crew (activities on the timeline). */
  private get wellActivities(): boolean { return this.treeMode === 'well' && this.timelineBy === 'activities'; }
  private get wellCrew(): boolean { return this.treeMode === 'well' && this.timelineBy === 'crew'; }

  /** Create an activity tree node from a raw activity record. */
  private makeActivityNode(a: any, crewGroup: string, keyPrefix: string, i: number, pool: string[]): TreeNode {
    const pStart = a.milestone ? this.d(a.date) : this.d(a.s);
    const rawKey = `${crewGroup}|${a.well}|${a.name}|${i}`;
    const node: TreeNode = {
      key: keyPrefix + '/' + a.name + '/' + i, rawKey,
      name: a.name, type: 'activity', expanded: false, children: [],
      category: a.cat, milestone: !!a.milestone, wellId: a.well, crewGroup,
      actName: a.milestone ? a.name : (a.actText || this.nameOf(a.name) || a.cat),
      spanStart: pStart,
      spanEnd:   a.milestone ? this.d(a.date) : this.d(a.e),
      actualStart: a.as ? this.d(a.as) : undefined,
      actualEnd:   a.ae ? this.d(a.ae) : undefined,
      crewId: a.milestone ? undefined : (this.manualCrew[rawKey] ?? a._crewId ?? this.assignCrew(pStart, i, pool)),
      status: a.st || 'notstarted', completion: a.prog ?? (a.st === 'completed' ? 100 : 0)
    };
    this.nodeMap[node.key] = node;
    return node;
  }

  /** All non-milestone activity descendants of a node. */
  private allLeaves(n: TreeNode): TreeNode[] {
    if (n.type === 'activity') return n.milestone ? [] : [n];
    return n.children.flatMap(c => this.allLeaves(c));
  }

  private buildTree(): void {
    this.nodeMap = {};
    this.tree = this.rawGroups.map(g => {
      const gKey = 'g/' + g.name;
      const pool = this.crewPools[g.name] || ['CR-01', 'CR-02'];
      const acts: TreeNode[] = g.activities.map((a: any, i: number) =>
        this.makeActivityNode(a, g.name, gKey, i, pool));
      // group activities under their assigned Crew ID; activities with no crew yet
      // (and milestones) sit directly under the crew group.
      const crewMap = new Map<string, TreeNode[]>();
      const loose: TreeNode[] = [];
      acts.forEach(a => {
        if (!a.milestone && a.crewId) {
          const arr = crewMap.get(a.crewId) || [];
          arr.push(a);
          crewMap.set(a.crewId, arr);
        } else {
          loose.push(a);
        }
      });
      const crewNodes: TreeNode[] = [];
      [...crewMap.keys()].sort().forEach(crewId => {
        const arr = crewMap.get(crewId)!;
        const cKey = gKey + '/' + crewId;
        const crewNode: TreeNode = {
          key: cKey, name: crewId, type: 'crew', expanded: false, children: arr, crewGroup: g.name,
          spanStart: Math.min(...arr.map(a => a.spanStart)),
          spanEnd:   Math.max(...arr.map(a => a.spanEnd)),
          status: this.aggStatus(arr), completion: 0
        };
        this.nodeMap[cKey] = crewNode;
        crewNodes.push(crewNode);
      });

      const leafActs = acts.filter(a => !a.milestone);
      const grp: TreeNode = {
        key: gKey, name: g.name, type: 'group', expanded: false, children: [...crewNodes, ...loose],
        spanStart: leafActs.length ? Math.min(...leafActs.map(a => a.spanStart)) : this.today,
        spanEnd:   leafActs.length ? Math.max(...leafActs.map(a => a.spanEnd))   : this.today + 7 * DAY,
        status: this.aggStatus(leafActs), completion: 0
      };
      this.nodeMap[gKey] = grp;
      return grp;
    });
    this.groupOptions = this.rawGroups.map(g => g.name);
  }

  /** Well tree dispatcher — structure depends on the timeline toggle:
   *  Activities → Well → Crew Group → Crew ID;  Crew → Well → Work Group → Activities. */
  private buildWellTree(): void {
    if (this.timelineBy === 'crew') this.buildWellTreeByWorkGroup();
    else this.buildWellTreeByCrew();
  }

  /** Well → Crew Group → Crew ID (crew ids are leaves; activities live on the timeline). */
  private buildWellTreeByCrew(): void {
    this.nodeMap = {};
    type GE = { crews: Map<string, TreeNode[]>; loose: TreeNode[] };
    const byWell = new Map<string, Map<string, GE>>();

    this.rawGroups.forEach(g => {
      const pool = this.crewPools[g.name] || ['CR-01', 'CR-02'];
      g.activities.forEach((a: any, i: number) => {
        const node = this.makeActivityNode(a, g.name, 'wc/' + a.well + '/' + g.name, i, pool);
        if (!byWell.has(a.well)) byWell.set(a.well, new Map());
        const groups = byWell.get(a.well)!;
        if (!groups.has(g.name)) groups.set(g.name, { crews: new Map(), loose: [] });
        const entry = groups.get(g.name)!;
        if (node.crewId && !node.milestone) {
          const arr = entry.crews.get(node.crewId) || [];
          arr.push(node);
          entry.crews.set(node.crewId, arr);
        } else {
          entry.loose.push(node);
        }
      });
    });

    this.tree = [];
    [...byWell.keys()].sort().forEach(well => {
      const wKey = 'wc/' + well;
      const groups = byWell.get(well)!;
      const groupNodes: TreeNode[] = [];
      [...groups.keys()].sort().forEach(cg => {
        const entry = groups.get(cg)!;
        const gKey = wKey + '/' + cg;
        const crewNodes: TreeNode[] = [];
        [...entry.crews.keys()].sort().forEach(crewId => {
          const arr = entry.crews.get(crewId)!;
          const cKey = gKey + '/' + crewId;
          const cNode: TreeNode = {
            key: cKey, name: crewId, type: 'crew', expanded: false, children: arr, crewGroup: cg,
            spanStart: Math.min(...arr.map(a => a.spanStart)),
            spanEnd:   Math.max(...arr.map(a => a.spanEnd)),
            status: this.aggStatus(arr), completion: 0
          };
          this.nodeMap[cKey] = cNode;
          crewNodes.push(cNode);
        });
        const gNode: TreeNode = {
          key: gKey, name: cg, type: 'group', expanded: false, children: [...crewNodes, ...entry.loose], crewGroup: cg,
          spanStart: this.today, spanEnd: this.today + 7 * DAY, status: 'notstarted', completion: 0
        };
        const gl = this.allLeaves(gNode);
        if (gl.length) {
          gNode.spanStart = Math.min(...gl.map(a => a.spanStart));
          gNode.spanEnd = Math.max(...gl.map(a => a.spanEnd));
          gNode.status = this.aggStatus(gl);
        }
        this.nodeMap[gKey] = gNode;
        groupNodes.push(gNode);
      });
      const wellNode: TreeNode = {
        key: wKey, name: well, type: 'well', expanded: false, children: groupNodes,
        spanStart: Math.min(...groupNodes.map(g => g.spanStart)),
        spanEnd:   Math.max(...groupNodes.map(g => g.spanEnd)),
        status: 'notstarted', completion: 0
      };
      const wl = groupNodes.flatMap(gn => this.allLeaves(gn));
      if (wl.length) { wellNode.status = this.aggStatus(wl); }
      this.nodeMap[wKey] = wellNode;
      this.tree.push(wellNode);
    });
    this.groupOptions = this.tree.map(w => w.name);
  }

  /** Build the Well tree: Well → Work Group (category) → Activities,
   *  each activity carrying its crew group and (just-in-time) crew id. */
  private buildWellTreeByWorkGroup(): void {
    this.nodeMap = {};
    const byWell = new Map<string, Map<string, TreeNode[]>>();

    this.rawGroups.forEach(g => {
      const pool = this.crewPools[g.name] || ['CR-01', 'CR-02'];
      g.activities.forEach((a: any, i: number) => {
        const pStart = a.milestone ? this.d(a.date) : this.d(a.s);
        const node: TreeNode = {
          key: 'w/' + a.well + '/' + g.name + '/' + a.name + '/' + i,
          name: a.name, type: 'activity', expanded: false, children: [],
          category: a.cat, milestone: !!a.milestone, wellId: a.well, crewGroup: g.name,
          actName: a.milestone ? a.name : (a.actText || this.nameOf(a.name) || a.cat),
          spanStart: pStart,
          spanEnd:   a.milestone ? this.d(a.date) : this.d(a.e),
          actualStart: a.as ? this.d(a.as) : undefined,
          actualEnd:   a.ae ? this.d(a.ae) : undefined,
          crewId: a.milestone ? undefined : this.assignCrew(pStart, i, pool),
          status: a.st || 'notstarted', completion: a.prog ?? (a.st === 'completed' ? 100 : 0)
        };
        this.nodeMap[node.key] = node;
        if (!byWell.has(a.well)) byWell.set(a.well, new Map());
        const catMap = byWell.get(a.well)!;
        if (!catMap.has(a.cat)) catMap.set(a.cat, []);
        catMap.get(a.cat)!.push(node);
      });
    });

    this.tree = [];
    byWell.forEach((catMap, well) => {
      const wKey = 'w/' + well;
      const workGroups: TreeNode[] = [];
      catMap.forEach((acts, cat) => {
        const gKey = wKey + '/' + cat;
        const leaf = acts.filter(a => !a.milestone);
        const wg: TreeNode = {
          key: gKey, name: cat, type: 'group', expanded: false, children: acts,
          spanStart: leaf.length ? Math.min(...leaf.map(a => a.spanStart)) : this.today,
          spanEnd:   leaf.length ? Math.max(...leaf.map(a => a.spanEnd))   : this.today + 7 * DAY,
          status: this.aggStatus(leaf), completion: 0
        };
        this.nodeMap[gKey] = wg;
        workGroups.push(wg);
      });
      const allLeaf = workGroups.flatMap(wg => wg.children.filter(a => !a.milestone));
      const wellNode: TreeNode = {
        key: wKey, name: well, type: 'well', expanded: false, children: workGroups,
        spanStart: Math.min(...workGroups.map(w => w.spanStart)),
        spanEnd:   Math.max(...workGroups.map(w => w.spanEnd)),
        status: this.aggStatus(allLeaf), completion: 0
      };
      this.nodeMap[wKey] = wellNode;
      this.tree.push(wellNode);
    });
    this.tree.sort((a, b) => a.name.localeCompare(b.name));
    this.groupOptions = this.tree.map(w => w.name);
  }

  /** Which crew group handles each work-group / activity category. */
  private catToCrewGroup: Record<string, string> = {
    'Sleeper Laying': 'FRL-0504',
    'Foundation Installation': 'LCC-0803',
    'RDX / WDX Excavation & prepad': 'FCC-0501'
  };

  /** Build the drill-down tree for one well: Crew Group → Crew ID (leaves).
   *  Activities are NOT tree rows — they appear on the timeline against each crew. */
  private buildDrillTree(wellId: string): void {
    this.nodeMap = {};
    // Collect real activities for this well from all crew groups in rawGroups
    const byGroup = new Map<string, { crews: Map<string, TreeNode[]>; loose: TreeNode[] }>();

    this.rawGroups.forEach(g => {
      g.activities
        .filter((a: any) => a.well === wellId)
        .forEach((a: any, idx: number) => {
          const pStart = a.milestone ? this.d(a.date) : this.d(a.s);
          const pEnd = a.milestone ? this.d(a.date) : this.d(a.e);
          const aStart = a.as ? this.d(a.as) : undefined;
          const aEnd = a.ae ? this.d(a.ae) : undefined;
          const status: WellStatus = a.st || 'notstarted';
          const completion = a.prog ?? (status === 'completed' ? 100 : 0);

          const cg = g.name;
          const pool = this.crewPools[cg] || ['CR-01', 'CR-02'];
          const rawKey = `drill|${wellId}|${a.name}|${idx}`;
          const crewId = this.manualCrew[rawKey] ?? a._crewId ?? this.assignCrew(pStart, idx, pool);
          const node: TreeNode = {
            key: 'd/' + wellId + '/' + a.name + '/' + idx, name: a.name, type: 'activity',
            expanded: false, children: [], rawKey,
            category: a.cat || 'General', crewCode: undefined, desc: a.cat,
            wellId, actName: a.actText || this.nameOf(a.name) || a.cat, crewGroup: cg, crewId: a.milestone ? undefined : crewId,
            milestone: !!a.milestone,
            spanStart: pStart, spanEnd: pEnd, actualStart: aStart, actualEnd: aEnd,
            status, completion
          };
          this.nodeMap[node.key] = node;

          if (!byGroup.has(cg)) byGroup.set(cg, { crews: new Map(), loose: [] });
          const entry = byGroup.get(cg)!;
          if (!a.milestone && crewId) {
            const arr = entry.crews.get(crewId) || [];
            arr.push(node);
            entry.crews.set(crewId, arr);
          } else {
            entry.loose.push(node);
          }
        });
    });

    this.tree = [];
    [...byGroup.keys()].sort().forEach(cg => {
      const entry = byGroup.get(cg)!;
      const gKey = 'dg/' + wellId + '/' + cg;
      const crewNodes: TreeNode[] = [];
      [...entry.crews.keys()].sort().forEach(crewId => {
        const arr = entry.crews.get(crewId)!;
        const cKey = gKey + '/' + crewId;
        const cNode: TreeNode = {
          key: cKey, name: crewId, type: 'crew', expanded: false, children: arr, crewGroup: cg,
          spanStart: Math.min(...arr.map(a => a.spanStart)),
          spanEnd:   Math.max(...arr.map(a => a.spanEnd)),
          status: this.aggStatus(arr), completion: 0
        };
        this.nodeMap[cKey] = cNode;
        crewNodes.push(cNode);
      });
      const allActs = [...crewNodes.flatMap(c => c.children), ...entry.loose];
      if (!allActs.length) return;
      const grp: TreeNode = {
        key: gKey, name: cg, type: 'group', expanded: true, children: [...crewNodes, ...entry.loose],
        spanStart: Math.min(...allActs.map(a => a.spanStart)),
        spanEnd:   Math.max(...allActs.map(a => a.spanEnd)),
        status: this.aggStatus(allActs), completion: 0
      };
      this.nodeMap[gKey] = grp;
      this.tree.push(grp);
    });
    this.groupOptions = this.tree.map(g => g.name);
  }

  /** ---- search / filter predicates ---- */
  private get q(): string { return this.search.trim().toLowerCase(); }

  private descMatches(n: TreeNode): boolean {
    if (!this.q) return true;
    if (n.name.toLowerCase().includes(this.q)) return true;
    if (n.wellId && n.wellId.toLowerCase().includes(this.q)) return true;
    if (n.category && n.category.toLowerCase().includes(this.q)) return true;
    if (n.actName && n.actName.toLowerCase().includes(this.q)) return true;
    if (n.crewCode && n.crewCode.toLowerCase().includes(this.q)) return true;
    if (n.crewGroup && n.crewGroup.toLowerCase().includes(this.q)) return true;
    return n.children.some(c => this.descMatches(c));
  }
  private isOpen(n: TreeNode): boolean {
    if (n.type === 'activity') return false;
    if (this.q && n.children.some(c => this.descMatches(c))) return true;
    return n.expanded;
  }
  private groupAllowed(name: string): boolean {
    return !this.filterGroups.length || this.filterGroups.includes(name);
  }
  /** Legend visibility toggles (status / milestone / unassigned / past / future). */
  private legendPasses(a: TreeNode): boolean {
    const off = this.legendOff;
    if (a.milestone) { if (off.has('milestone')) return false; }
    else {
      if (off.has(a.status)) return false;
      if (off.has('unassigned') && !a.crewId) return false;
    }
    if (off.has('past') && a.spanEnd < this.today) return false;
    if (off.has('future') && a.spanStart > this.today) return false;
    return true;
  }
  private leafPasses(a: TreeNode): boolean {
    if (!this.legendPasses(a)) return false;
    // In planned-only mode, exclude completed activities — they should only appear in Actual or Both modes
    if (this.compareMode === 'planned' && a.status === 'completed') return false;
    // In actual-only mode, exclude non-milestone activities with no actual progress
    if (this.compareMode === 'actual' && !a.milestone && a.actualStart == null) return false;
    const wellOk = !this.filterWell.length || (a.wellId != null && this.filterWell.includes(a.wellId));
    if (a.milestone) return wellOk && (!this.filterCategory.length || this.filterCategory.includes('Milestone'));
    const statusOk = !this.filterStatus.length || this.filterStatus.includes(a.status);
    const catOk = !this.filterCategory.length || this.filterCategory.some(f => (a.category || '').startsWith(f));
    return wellOk && statusOk && catOk;
  }
  private nodePasses(n: TreeNode): boolean {
    if (n.type === 'activity') return this.leafPasses(n);
    return n.children.some(c => this.nodePasses(c));
  }
  private passingLeaves(n: TreeNode): TreeNode[] {
    if (n.type === 'activity') return (!n.milestone && this.leafPasses(n)) ? [n] : [];
    return n.children.flatMap(c => this.passingLeaves(c));
  }
  private milestoneDescendants(n: TreeNode): TreeNode[] {
    if (n.type === 'activity') return n.milestone ? [n] : [];
    return n.children.flatMap(c => this.milestoneDescendants(c));
  }
  /** Group a node's passing activities by Well → one timeline bar per assigned well,
   *  with both planned and actual envelopes. */
  private rollupByWell(n: TreeNode): {
    wellId: string; pStart: number; pEnd: number;
    aStart?: number; aEnd?: number; status: WellStatus; progress: number;
  }[] {
    const byWell = new Map<string, TreeNode[]>();
    this.passingLeaves(n).forEach(l => {
      const arr = byWell.get(l.wellId!) || [];
      arr.push(l);
      byWell.set(l.wellId!, arr);
    });
    const out: any[] = [];
    byWell.forEach((arr, wellId) => {
      const withActual = arr.filter(a => a.actualStart != null);
      const completed = withActual.filter(a => a.actualEnd != null);
      const pEnd = Math.max(...arr.map(a => a.spanEnd));
      const avgProgress = arr.length > 0 ? Math.round(arr.reduce((s, a) => s + a.completion, 0) / arr.length * 10) / 10 : 0;
      out.push({
        wellId,
        pStart: Math.min(...arr.map(a => a.spanStart)),
        pEnd,
        aStart: withActual.length ? Math.min(...withActual.map(a => a.actualStart!)) : undefined,
        aEnd:   completed.length  ? Math.max(...completed.map(a => a.actualEnd!))    : undefined,
        status: this.aggStatus(arr),
        progress: avgProgress
      });
    });
    return out;
  }
  private distinctWells(n: TreeNode): number {
    return new Set(this.passingLeaves(n).map(l => l.wellId)).size;
  }
  private actCount(n: TreeNode): number {
    if (n.type === 'activity') return n.milestone ? 0 : 1;
    return n.children.reduce((s, c) => s + this.actCount(c), 0);
  }
  private segments(n: TreeNode): { color: string; pct: number }[] {
    const leaves = this.passingLeaves(n);
    if (!leaves.length) return [];
    const order: WellStatus[] = ['completed', 'inprogress', 'delayed', 'notstarted', 'planned'];
    const total = leaves.length;
    const segs: { color: string; pct: number }[] = [];
    order.forEach(st => {
      const c = leaves.filter(l => l.status === st).length;
      if (c) segs.push({ color: this.statusColor(st), pct: Math.round((c / total) * 100) });
    });
    return segs;
  }

  /** ---- visible rows view-model ---- */
  private computeRows(): RowVM[] {
    const rows: RowVM[] = [];
    const crewGroupTree = this.treeMode === 'crew' && !this.drillWell;
    const drill = !!this.drillWell;
    const crewLeaf = drill || this.wellActivities;     // crew ids are leaves (activities only on timeline)
    const hideActRows = drill || this.wellActivities;  // don't render activity rows in these modes
    const expandableOf = (n: TreeNode) => n.type !== 'activity' && !(crewLeaf && n.type === 'crew');
    const walk = (n: TreeNode, depth: number) => {
      if (depth === 0 && !this.groupAllowed(n.name)) return;   // filter top-level (crew group OR well)
      if (!this.nodePasses(n)) return;
      if (this.q && !this.descMatches(n)) return;
      const expandable = expandableOf(n);
      const open = expandable && this.isOpen(n);
      // Count sub-items for collapsed rows to size the row height
      let subCount = 1;
      if (expandable && !open) {
        const perWell = crewGroupTree && this.timelineBy === 'wells';
        subCount = perWell ? this.distinctWells(n) : Math.min(this.passingLeaves(n).length, 6);
      }
      rows.push({
        key: n.key, node: n, type: n.type, depth, open, name: n.name,
        completion: n.type === 'activity' ? n.completion : this.pct(n),
        count: n.type === 'well' ? `${n.children.length} ${this.wellActivities ? 'crew groups' : 'work groups'}`
             : n.type === 'crew' ? `${this.actCount(n)} activities`
             : n.type === 'group' ? (crewGroupTree ? `${this.distinctWells(n)} Wells`
                                                    : `${this.actCount(n)} activities`)
             : '',
        segments: expandable ? this.segments(n) : [],
        dotColor: n.milestone ? '#7c3aed' : this.statusColor(n.status),
        isMilestone: !!n.milestone,
        category: this.drillWell ? n.desc : n.category,
        crewCode: n.crewCode,
        crewId: n.crewId,
        crewGroup: n.crewGroup,
        crewUnassigned: n.type === 'activity' && !n.milestone && !n.crewId,
        actName: n.actName,
        expandable,
        status: n.status,
        subCount
      });
      if (open) n.children.forEach(c => {
        // crew tree: under a crew group only show Crew IDs — hide loose (unassigned / milestone) activities
        if (crewGroupTree && n.type === 'group' && c.type === 'activity') return;
        // drill-down & well-by-crew: never render activity rows (they live on the timeline only)
        if (hideActRows && c.type === 'activity') return;
        walk(c, depth + 1);
      });
    };
    this.tree.forEach(g => walk(g, 0));
    return rows;
  }

  private refresh(): void { this.displayRows = this.computeRows(); this.buildChart(); }

  /** ---- toolbar / interaction ---- */
  setView(v: ViewMode): void {
    this.view = v;
    if (v === 'day') {
      // alignToWeek may have pushed windowStart into the last days of the
      // previous month — offset by 7 days so we land in the correct month.
      const d = new Date((this.windowStart || this.today) + 7 * DAY);
      this.windowStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    } else {
      this.windowStart = this.alignToWeek(this.windowStart);
    }
    this.refresh();
  }
  setCompare(m: 'both' | 'planned' | 'actual'): void { this.compareMode = m; this.refresh(); }
  setTimelineBy(m: 'wells' | 'activities' | 'crew'): void {
    this.timelineBy = m;
    if (this.treeMode === 'well') { this.buildWellTree(); this.refresh(); }   // well-tree structure depends on this toggle
    else this.refresh();
  }

  setTreeMode(m: 'crew' | 'well'): void {
    if (this.treeMode === m) return;
    this.treeMode = m;
    this.drillWell = null;
    this.selectedKey = null; this.search = '';
    this.filterGroups = []; this.filterStatus = []; this.filterCategory = []; this.filterWell = [];
    if (m === 'well') { this.buildWellTree(); this.timelineBy = 'activities'; }
    else { this.buildTree(); this.timelineBy = 'wells'; }
    this.refresh();
  }
  goToday(): void {
    if (this.view === 'day') {
      const d = new Date(this.today);
      this.windowStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    } else {
      this.windowStart = this.view === 'month' ? Date.UTC(2026, 3, 1) : this.alignToWeek(this.today - (this.spanDays() / 2) * DAY);
    }
    this.refresh();
  }
  shift(dir: -1 | 1): void {
    if (this.view === 'day') {
      // Shift by one month
      const d = new Date(this.windowStart);
      this.windowStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1);
    } else {
      this.windowStart += dir * this.spanDays() * DAY;
    }
    this.refresh();
  }
  onSearch(): void { this.refresh(); }

  onRowClick(r: RowVM): void {
    if (r.type === 'activity' && r.crewUnassigned) { this.openAssign(r.node); return; }
    if (r.expandable) { this.toggleNode(r.key); return; }
    this.selectedKey = this.selectedKey === r.key ? null : r.key;
    this.buildChart();
  }

  /** ---- assign-crew dialog ---- */
  get assignPool(): string[] {
    return (this.assignTarget && this.crewPools[this.assignTarget.crewGroup || '']) || [];
  }
  openAssign(node: TreeNode): void {
    if (!node || node.type !== 'activity' || node.milestone || node.crewId) return;
    this.assignTarget = node;
    this.assignChoice = this.assignPool[0] || null;
    this.openMenuKey = null;
  }
  assignFromMenu(r: RowVM, ev: Event): void { ev.stopPropagation(); this.closeMenu(); this.openAssign(r.node); }
  chooseCrew(c: string): void { this.assignChoice = c; }
  confirmAssign(): void {
    if (this.assignTarget?.rawKey && this.assignChoice) {
      this.manualCrew[this.assignTarget.rawKey] = this.assignChoice;
    }
    this.assignTarget = null;
    this.rebuildTree();
    this.refresh();
  }
  cancelAssign(): void { this.assignTarget = null; }

  private rebuildTree(): void {
    if (this.drillWell) this.buildDrillTree(this.drillWell);
    else if (this.treeMode === 'well') this.buildWellTree();
    else this.buildTree();
  }

  /** Click a Well bar in the main view → drill into that well's activities. */
  onBarClick(point: any): void {
    const c = point?.custom;
    if (c?.assignable && c.nodeKey) {                          // unassigned activity bar → assign a crew
      const n = this.nodeMap[c.nodeKey];
      if (n) { this.openAssign(n); return; }
    }
    if (this.drillWell || this.treeMode === 'well') return;   // drill only from the crew-group / wells timeline
    if (this.timelineBy !== 'wells') return;                  // only well bars drill
    const well = point?.name;
    if (well) this.drillInto(well);
  }
  drillInto(wellId: string): void {
    if (!wellId) return;
    this.savedView = this.view;
    this.savedWindow = this.windowStart;
    this.drillWell = wellId;
    this.selectedKey = null; this.search = '';
    this.filterGroups = []; this.filterStatus = []; this.filterCategory = []; this.filterWell = [];
    this.buildDrillTree(wellId);
    this.view = 'month';
    const earliest = Math.min(...this.tree.map(g => g.spanStart));
    const ed = new Date(earliest);
    this.windowStart = Date.UTC(ed.getUTCFullYear(), ed.getUTCMonth(), 1);
    this.refresh();
  }
  backToMain(): void {
    this.drillWell = null;
    this.selectedKey = null; this.search = '';
    this.filterGroups = []; this.filterStatus = []; this.filterCategory = []; this.filterWell = [];
    this.buildTree();
    this.view = this.savedView;
    this.windowStart = this.savedWindow;
    this.refresh();
  }
  toggleNode(key: string): void {
    const n = this.nodeMap[key];
    if (n && n.type !== 'activity') { n.expanded = !n.expanded; this.refresh(); }
  }
  selectRow(r: RowVM, ev: Event): void {
    ev.stopPropagation();
    this.selectedKey = this.selectedKey === r.key ? null : r.key;
    this.buildChart();
  }
  toggleMenu(key: string, ev: Event): void { ev.stopPropagation(); this.openMenuKey = this.openMenuKey === key ? null : key; }
  closeMenu(): void { this.openMenuKey = null; }
  menuAction(_action: string, ev: Event): void { ev.stopPropagation(); this.closeMenu(); }

  expandAll(expand: boolean): void {
    Object.values(this.nodeMap).forEach(n => { if (n.type !== 'activity') n.expanded = expand; });
    this.refresh();
  }
  exportChart(): void { this.chart?.exportChart?.({ type: 'image/png', filename: 'crew-gantt-calendar' }); }

  /** ---- filters ---- */
  toggleFilterPanel(): void { this.filterOpen = !this.filterOpen; }
  private toggleIn<T>(arr: T[], v: T): T[] { return arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]; }
  toggleGroupFilter(v: string): void { this.filterGroups = this.toggleIn(this.filterGroups, v); this.refresh(); }
  toggleStatusFilter(v: WellStatus): void { this.filterStatus = this.toggleIn(this.filterStatus, v); this.refresh(); }
  toggleCategoryFilter(v: string): void { this.filterCategory = this.toggleIn(this.filterCategory, v); this.refresh(); }
  toggleWellFilter(v: string): void { this.filterWell = this.toggleIn(this.filterWell, v); this.refresh(); }
  isGroupFilterOn(v: string): boolean { return this.filterGroups.includes(v); }
  isStatusFilterOn(v: WellStatus): boolean { return this.filterStatus.includes(v); }
  isCategoryFilterOn(v: string): boolean { return this.filterCategory.includes(v); }
  isWellFilterOn(v: string): boolean { return this.filterWell.includes(v); }
  get activeFilterCount(): number { return this.filterGroups.length + this.filterStatus.length + this.filterCategory.length + this.filterWell.length; }
  clearFilters(): void { this.filterGroups = []; this.filterStatus = []; this.filterCategory = []; this.filterWell = []; this.refresh(); }
  statusLabel(s: WellStatus): string { return this.statusOptions.find(o => o.key === s)?.label || s; }

  /** ---- window helpers ---- */
  private spanDays(): number {
    if (this.view === 'day') {
      // Full month: calculate days in the month of windowStart
      const d = new Date(this.windowStart);
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    }
    return this.view === 'week' ? 30 : 168;
  }
  private alignToWeek(ms: number): number {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay());
  }
  private fmtDay(ms: number): string {
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  /** ---- theme palette ---- */
  private palette() {
    const light = document.documentElement.classList.contains('navbar-light');
    return light
      ? { text: '#1a1a2e', sub: '#6b7280', grid: 'rgba(0,0,0,0.06)',
          past: 'rgba(0,0,0,0.028)', rowAlt: 'rgba(0,0,0,0.012)', sel: 'rgba(41,55,141,0.10)',
          group: 'rgba(0,0,0,0.02)', today: '#29378d', barText: '#334155',
          plannedFill: '#cbd5e1', plannedBorder: '#cbd5e1', unassignedFill: 'rgba(245,158,11,0.16)' }
      : { text: '#e8ecf5', sub: '#9aa6c0', grid: 'rgba(255,255,255,0.07)',
          past: 'rgba(255,255,255,0.03)', rowAlt: 'rgba(255,255,255,0.015)', sel: 'rgba(96,165,250,0.16)',
          group: 'rgba(255,255,255,0.025)', today: '#60a5fa', barText: '#e8ecf5',
          plannedFill: 'rgba(255,255,255,0.12)', plannedBorder: 'rgba(255,255,255,0.30)', unassignedFill: 'rgba(245,158,11,0.22)' };
  }

  /** ---- render the timeline chart ---- */
  private buildChart(): void {
    if (typeof Highcharts === 'undefined' || !this.chartHost) return;

    const rows = this.displayRows;
    const pal = this.palette();
    const min = this.windowStart;
    const max = this.windowStart + this.spanDays() * DAY;
    this.rangeLabel = `${this.fmtDay(min)} – ${this.fmtDay(max - DAY)}, 2026`;

    // Build cumulative y positions — collapsed rows with multiple sub-items take more vertical space
    const yPositions: number[] = [];
    let cumY = 0;
    rows.forEach(r => {
      yPositions.push(cumY);
      cumY += Math.max(1, r.subCount || 1);
    });

    const plannedPts: any[] = [];
    const actualPts: any[] = [];
    const slipPts: any[] = [];
    const milestones: any[] = [];
    const mode = this.compareMode;
    const yOff = mode === 'both' ? 0.15 : 0;
    const showPlanned = !this.legendOff.has('planned-bar');
    const showActual  = !this.legendOff.has('actual-bar');

    const addItem = (y: number, label: string, pS: number, pE: number,
                     aS: number | undefined, aE: number | undefined, status: WellStatus,
                     custom: any, unassigned = false) => {
      const hasA = aS != null && aE != null;
      const hasStart = aS != null;
      const ongoing = hasStart && !hasA;
      const cu = { ...custom, status, planned: [pS, pE], actual: hasA ? [aS, aE] : (hasStart ? [aS, null] : null) };
      const showSlip = !this.legendOff.has('overdue');
      if (mode === 'planned') {
        if (showPlanned) plannedPts.push(this.plannedPoint(pS, pE, y, label, true, cu, pal, unassigned));
      } else if (mode === 'actual') {
        if (hasA && showActual) {
          if (showSlip && aE! > pE) {
            actualPts.push(this.actualPoint(aS!, pE, y, label, status, true, cu, pal));
            slipPts.push(this.slipPoint(pE, aE!, y, label, cu));
          } else {
            actualPts.push(this.actualPoint(aS!, aE!, y, label, status, true, cu, pal));
          }
        } else if (ongoing && showActual) {
          if (showSlip && pE < this.today) {
            actualPts.push(this.actualPoint(aS!, pE, y, label, status, true, cu, pal));
            slipPts.push(this.slipPoint(pE, this.today, y, label, cu));
          } else {
            actualPts.push(this.actualPoint(aS!, this.today, y, label, status, true, cu, pal));
          }
        }
        // In actual-only mode, don't show planned bars as fallback for activities with no actual data
      } else {
        if (showPlanned) plannedPts.push(this.plannedPoint(pS, pE, y - yOff, label, !hasA && !ongoing, cu, pal, unassigned));
        if (hasA && showActual) {
          if (showSlip && aE! > pE) {
            actualPts.push(this.actualPoint(aS!, pE, y + yOff, label, status, true, cu, pal));
            slipPts.push(this.slipPoint(pE, aE!, y + yOff, label, cu));
          } else {
            actualPts.push(this.actualPoint(aS!, aE!, y + yOff, label, status, true, cu, pal));
          }
        } else if (ongoing && showActual) {
          if (showSlip && pE < this.today) {
            actualPts.push(this.actualPoint(aS!, pE, y + yOff, label, status, true, cu, pal));
            slipPts.push(this.slipPoint(pE, this.today, y + yOff, label, cu));
          } else {
            actualPts.push(this.actualPoint(aS!, this.today, y + yOff, label, status, true, cu, pal));
          }
        }
      }
    };

    const drill = !!this.drillWell;
    const perWell = !drill && this.treeMode === 'crew' && this.timelineBy === 'wells';
    const byCrew  = !drill && this.treeMode === 'well' && this.timelineBy === 'crew';

    // Emit a planned+actual pair for a single activity leaf, labelled per the active mode.
    const emit = (y: number, l: TreeNode) => {
      const nm = l.actName || l.name;
      let label: string, title: string, sub: string;
      if (byCrew) {
        label = l.crewId || l.crewGroup || '—';
        title = l.crewId ? `Crew ${l.crewId}` : `${l.crewGroup || ''} — crew not assigned`;
        sub = `${l.name} · ${nm} · Well ${l.wellId}`;
      } else if (drill) {
        label = l.name; title = nm;
        sub = `${l.name}${l.crewCode ? ' · ' + l.crewCode : ''}${l.crewGroup ? ' · ' + l.crewGroup : ''}`;
      } else {
        // activity-labelled (activities mode, either tree) — bar shows id, tooltip shows name
        label = l.name; title = nm;
        sub = `${l.name} · Well ${l.wellId}${l.crewGroup ? ' · ' + l.crewGroup : ''}`;
      }
      addItem(y, label, l.spanStart, l.spanEnd, l.actualStart, l.actualEnd, l.status,
              { title, sub, crew: l.crewId ?? null, nodeKey: l.key, assignable: !l.crewId && !l.milestone, progress: l.completion }, !l.crewId);
    };

    const mStone = (y: number, m: TreeNode) => {
      const lbl = byCrew ? (m.crewId || m.crewGroup) : (perWell ? m.wellId : m.name);
      const ttl = byCrew ? (m.crewId || `${m.crewGroup} — crew TBA`) : (perWell ? `Well ${m.wellId}` : m.name);
      return { x: m.spanStart, y, name: lbl, custom: { title: ttl, activityId: m.name } };
    };

    rows.forEach((r, idx) => {
      const y = yPositions[idx];
      const sub = Math.max(1, r.subCount || 1);
      const n = r.node;
      if (n.type === 'activity') {
        if (!n.milestone && this.leafPasses(n)) {
          if (perWell) {
            addItem(y, n.wellId!, n.spanStart, n.spanEnd, n.actualStart, n.actualEnd, n.status,
                    { title: `Well ${n.wellId}`, sub: `${n.name}${n.category ? ' · ' + n.category : ''}`, crew: n.crewId ?? null,
                      nodeKey: n.key, assignable: !n.crewId && !n.milestone, progress: n.completion }, !n.crewId);
          } else {
            emit(y, n);
          }
        } else if (n.milestone && this.leafPasses(n)) {
          milestones.push(mStone(y, n));
        }
      } else if (!r.open) {
        if (perWell) {
          // collapsed crew group → each well gets its own sub-row
          const wells = this.rollupByWell(n);
          wells.forEach((w, i) => {
            const ySlot = sub > 1 ? y + i : y;
            addItem(ySlot, w.wellId, w.pStart, w.pEnd, w.aStart, w.aEnd, w.status, { title: `Well ${w.wellId}`, sub: '', progress: w.progress });
          });
        } else {
          // collapsed parent → each activity gets its own sub-row
          const leaves = this.passingLeaves(n);
          leaves.forEach((l, i) => {
            const ySlot = sub > 1 ? y + Math.min(i, sub - 1) : y;
            const nm = l.actName || l.name;
            const label = l.name;
            const title = nm;
            const subText = `${l.name} · Well ${l.wellId}${l.crewGroup ? ' · ' + l.crewGroup : ''}`;
            addItem(ySlot, label, l.spanStart, l.spanEnd, l.actualStart, l.actualEnd, l.status,
              { title, sub: subText, crew: l.crewId ?? null, nodeKey: l.key, assignable: !l.crewId && !l.milestone, progress: l.completion }, !l.crewId);
          });
        }
        this.milestoneDescendants(n).filter(m => this.leafPasses(m)).forEach(m => milestones.push(mStone(y, m)));
      } else if (n.type === 'group') {
        if (perWell) {
          // expanded crew group in wells mode: show a span indicator (individual wells shown on child crew rows)
          const leaves = this.passingLeaves(n);
          if (leaves.length) {
            const gStart = Math.min(...leaves.map(l => l.spanStart));
            const gEnd   = Math.max(...leaves.map(l => l.spanEnd));
            plannedPts.push(this.plannedPoint(gStart, gEnd, y, n.name, false,
              { title: n.name, sub: `${this.distinctWells(n)} wells`, progress: null }, pal, false));
          }
        } else {
          // expanded crew group: show a span indicator so users can see where work begins/ends
          const leaves = this.passingLeaves(n);
          if (leaves.length) {
            const gStart = Math.min(...leaves.map(l => l.spanStart));
            const gEnd   = Math.max(...leaves.map(l => l.spanEnd));
            plannedPts.push(this.plannedPoint(gStart, gEnd, y, n.name, false,
              { title: n.name, sub: `${leaves.length} activities`, progress: null }, pal, false));
          }
        }
        // also render unassigned activities and milestones on the group row
        n.children.filter(c => c.type === 'activity' && !c.milestone && this.leafPasses(c)).forEach(l => emit(y, l));
        n.children.filter(c => c.type === 'activity' && c.milestone && this.leafPasses(c)).forEach(m => milestones.push(mStone(y, m)));
      }
    });

    const pw = mode === 'both' ? 9 : 16;

    const nRows = cumY || 1;
    const height = nRows * ROW_H + HEADER_H;

    const rowBands = rows.map((r, i) => {
      const yStart = yPositions[i];
      const ySize = Math.max(1, r.subCount || 1);
      let color = i % 2 ? pal.rowAlt : 'transparent';
      if (r.type === 'group') color = pal.group;
      if (r.key === this.selectedKey) color = pal.sel;
      return { from: yStart - 0.5, to: yStart + ySize - 0.5, color };
    });

    const self = this;

    // In day view, fit to available container width (no horizontal scroll)
    if (this.chartHost?.nativeElement) {
      this.chartHost.nativeElement.style.minWidth = '';
    }

    const options: any = {
      chart: {
        renderTo: this.chartHost.nativeElement, type: 'xrange', height,
        backgroundColor: 'transparent', marginLeft: 6, marginRight: 20,
        marginTop: HEADER_H, marginBottom: 0, spacingBottom: 0,
        style: { fontFamily: 'Inter, system-ui, sans-serif' }
      },
      credits: { enabled: false },
      title: { text: undefined },
      exporting: { enabled: false },
      legend: { enabled: false },
      tooltip: {
        useHTML: true,
        formatter(this: any) {
          const p = this.point, c = p.custom || {};
          if (p.x2 === undefined) {
            return `<b>◆ ${c.activityId || ''}</b><br/>${c.title || ('Well ' + p.name)}<br/>${self.fmtDay(p.x)}`;
          }
          let s = `<b>${c.title || ('Well ' + p.name)}</b>`;
          if (c.sub) s += `<br/>${c.sub}`;
          if (c.crew) s += `<br/><span style="opacity:.7">Crew:</span> ${c.crew}`;
          else if (c.crew === null) s += `<br/><span style="opacity:.7">Crew:</span> <span style="color:#f59e0b;font-weight:600">not assigned</span>`;
          if (c.planned) s += `<br/><span style="opacity:.7">Planned:</span> ${self.fmtDay(c.planned[0])} → ${self.fmtDay(c.planned[1])}`;
          if (c.actual) {
            if (c.actual[1]) {
              const dv = Math.round((c.actual[1] - c.planned[1]) / DAY);
              const v = dv > 0 ? `<span style="color:#dc2626;font-weight:700">+${dv}d</span>` : dv < 0 ? `<span style="color:#16a34a;font-weight:700">${dv}d</span>` : '<span style="color:#16a34a;font-weight:700">on plan</span>';
              s += `<br/><b>Actual:</b> ${self.fmtDay(c.actual[0])} → ${self.fmtDay(c.actual[1])} ${v}`;
            } else {
              s += `<br/><b>Actual:</b> ${self.fmtDay(c.actual[0])} → <span style="opacity:.6">ongoing</span>`;
            }
          } else {
            s += `<br/><b>Actual:</b> —`;
          }
          if (c.progress != null) s += `<br/><span style="opacity:.7">Progress:</span> ${c.progress}%`;
          return s;
        }
      },
      xAxis: this.buildXAxes(min, max, pal),
      yAxis: {
        type: 'category', categories: Array.from({ length: nRows }, (_, i) => ''), reversed: true,
        title: { text: null }, gridLineWidth: 1, gridLineColor: pal.grid,
        lineWidth: 0, tickWidth: 0,
        min: -0.5, max: nRows - 0.5, startOnTick: false, endOnTick: false,
        labels: { enabled: false }, plotBands: rowBands
      },
      plotOptions: {
        series: {
          animation: false, borderRadius: 4, cursor: 'pointer',
          point: { events: { click(this: any) { self.onBarClick(this); } } }
        }
      },
      series: [
        {
          name: 'Planned', pointWidth: pw, color: pal.plannedFill,
          grouping: false, colorByPoint: false,
          borderColor: pal.plannedBorder, borderWidth: 1, data: plannedPts,
          dataLabels: {
            enabled: true, formatter(this: any) { return this.point.name; },
            style: { fontSize: '10px', fontWeight: '600', textOutline: 'none' }
          }
        },
        {
          name: 'Actual', pointWidth: pw, color: '#29378d', borderColor: 'rgba(0,0,0,0.06)', data: actualPts,
          grouping: false,
          dataLabels: {
            enabled: true, formatter(this: any) { return this.point.name; },
            style: { fontSize: '10px', fontWeight: '600', textOutline: 'none' }
          }
        },
        {
          name: 'Slip', pointWidth: pw, data: slipPts,
          grouping: false,
          borderColor: '#dc2626', borderWidth: 1,
          dataLabels: { enabled: false }
        },
        {
          name: 'Milestones', type: 'scatter',
          marker: { symbol: 'diamond', radius: 7, fillColor: '#7c3aed', lineColor: '#ffffff', lineWidth: 1 },
          data: milestones, dataLabels: { enabled: false }
        }
      ]
    };

    this.chart?.destroy?.();
    this.chart = Highcharts.chart(options);
  }

  private plannedPoint(s: number, e: number, y: number, label: string, labeled: boolean, custom: any, pal: any, unassigned = false) {
    const pt: any = { x: s, x2: Math.max(e, s + DAY), y, name: label, custom, color: pal.plannedFill, borderColor: pal.plannedBorder, borderWidth: 1, dataLabels: { enabled: labeled, color: pal.barText } };
    if (unassigned) {
      pt.color = pal.unassignedFill;
      pt.borderColor = '#f59e0b';
      pt.borderWidth = 1.5;
    } else if (custom?.status === 'completed') {
      // Use solid green for completed activities so they're clearly visible
      // even when the actual bar is outside the viewport (e.g. finished early).
      pt.color = '#16a34a';
      pt.borderColor = '#15803d';
      pt.borderWidth = 1;
      pt.dataLabels = { enabled: labeled, color: '#ffffff' };
    } else if (custom?.status === 'notstarted' || custom?.status === 'planned') {
      // Keep default gray for planned/not-started activities
      pt.color = pal.plannedFill;
      pt.borderColor = pal.plannedBorder;
    }
    return pt;
  }
  private actualPoint(s: number, e: number, y: number, label: string, status: WellStatus, labeled: boolean, custom: any, pal: any) {
    const light = status === 'notstarted' || status === 'planned';
    return {
      x: s, x2: Math.max(e, s + DAY), y, name: label, color: this.statusColor(status), custom,
      dataLabels: { enabled: labeled, color: light ? pal.barText : '#ffffff' }
    };
  }

  /** Ongoing point: actual_start present but no actual_end — show solid bar till today (or planned_end if delayed). */
  private ongoingPoint(aS: number, pS: number, pE: number, y: number, label: string, status: WellStatus, custom: any, pal: any) {
    const barEnd = (status === 'delayed' && pE < this.today) ? pE : this.today;
    const light = status === 'notstarted' || status === 'planned';

    return {
      x: aS, x2: barEnd, y, name: label, color: this.statusColor(status), custom,
      borderColor: this.statusColor(status), borderWidth: 0,
      dashStyle: 'Solid',
      dataLabels: { enabled: true, color: light ? pal.barText : '#ffffff' }
    };
  }

  /** Slip point: red hatched bar from planned end to actual/forecast end (delayed activities). */
  private slipPoint(plannedEnd: number, actualEnd: number, y: number, label: string, custom: any) {
    return {
      x: plannedEnd, x2: actualEnd, y, name: '', custom,
      color: {
        pattern: {
          path: { d: 'M 0 0 L 10 10 M -1 9 L 1 11 M 9 -1 L 11 1', stroke: '#dc2626', strokeWidth: 2 },
          width: 10, height: 10, backgroundColor: 'rgba(220,38,38,0.08)'
        }
      },
      borderColor: '#dc2626', borderWidth: 1,
      dataLabels: { enabled: false }
    };
  }

  /** Variance badge text for a given activity. */
  private varianceBadge(plannedEnd: number, actualEnd: number | undefined, status: WellStatus): string {
    if (!actualEnd || status === 'notstarted') return '';
    const diffDays = Math.round((actualEnd - plannedEnd) / DAY);
    if (diffDays > 0) return `+${diffDays}d`;
    if (diffDays < 0) return `${diffDays}d`;
    return 'on plan';
  }

  private buildXAxes(min: number, max: number, pal: any): any[] {
    const self = this;

    // Snap "today" to UTC midnight so the plotLine aligns with day gridlines
    const td = new Date(this.today);
    const todayMidnight = Date.UTC(td.getUTCFullYear(), td.getUTCMonth(), td.getUTCDate());

    const plotLines = this.legendOff.has('today') ? [] : [{
      value: todayMidnight, color: pal.today, width: 2, zIndex: 5,
      label: { text: 'Today', style: { color: pal.today, fontWeight: '700', fontSize: '10px' }, y: -6 }
    }];
    const plotBands = this.legendOff.has('past') ? [] : [{ from: min, to: Math.min(todayMidnight, max), color: pal.past }];

    // Primary axis: carries the plotLines / plotBands
    const primary = {
      min, max, type: 'datetime',
      gridLineWidth: 1, gridLineColor: pal.grid, lineColor: pal.grid, tickColor: pal.grid,
      plotLines, plotBands
    };

    // Linked axis: same scale, no duplicate plotLines / plotBands
    const linked = {
      min, max, type: 'datetime',
      gridLineWidth: 1, gridLineColor: pal.grid, lineColor: pal.grid, tickColor: pal.grid,
      linkedTo: 0, opposite: true
    };

    if (this.view === 'month') {
      return [
        { ...primary, opposite: true, tickInterval: 30 * DAY, labels: {
            style: { color: pal.text, fontWeight: '700', fontSize: '11px' },
            formatter(this: any) {
              return new Date(this.value).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
            } } },
        { ...linked, tickInterval: 7 * DAY, labels: {
            style: { color: pal.sub, fontSize: '9px' },
            formatter(this: any) { return self.fmtDay(this.value); } } }
      ];
    }
    if (this.view === 'day') {
      return [
        { ...primary, opposite: true, tickInterval: DAY, labels: {
            allowOverlap: false,
            style: { color: pal.text, fontWeight: '600', fontSize: '10px' },
            formatter(this: any) { return self.fmtDay(this.value); } } },
        { ...linked, tickInterval: DAY, labels: {
            allowOverlap: false,
            style: { color: pal.sub, fontSize: '9px' },
            formatter(this: any) { return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(this.value).getUTCDay()]; } } }
      ];
    }
    return [
      { ...primary, opposite: true, tickInterval: 7 * DAY, labels: {
          style: { color: pal.text, fontWeight: '700', fontSize: '11px' },
          formatter(this: any) { return `${self.fmtDay(this.value)} – ${self.fmtDay(this.value + 6 * DAY)}`; } } },
      { ...linked, tickInterval: DAY, labels: {
          style: { color: pal.sub, fontSize: '9px' },
          formatter(this: any) { return ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(this.value).getUTCDay()]; } } }
    ];
  }
}
