import { Component, AfterViewInit, OnDestroy, HostListener, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';

interface ProjectItem {
  code: string;       // project code (e.g. NL0010)
  name: string;
  region: string;     // tag shown top-right (e.g. NIMR / MARMUL)
  site: string;       // site within the cluster
  wellType: string;   // e.g. 'Conventional well'
  wells: number;      // total wells
  done: number;       // completed wells
  inProgress: number; // wells in progress
}

interface ProjectGroup {
  name: string;       // accordion header (e.g. NIMR)
  open: boolean;
  items: ProjectItem[];
}

@Component({
  selector: 'app-allprojects',
  templateUrl: './allprojects.component.html',
  styleUrls: ['./allprojects.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class AllProjectsComponent implements AfterViewInit, OnDestroy {

  /** Project groups — replace with an API call when the endpoint is available. */
  groups: ProjectGroup[] = [
    {
      name: 'NIMR', open: true, items: [
        { code: 'NL0010',  name: 'Location',                 region: 'NIMR', site: 'Nimr North', wellType: 'Conventional well', wells: 45, done: 28, inProgress: 17 },
        { code: 'NF0010',  name: 'Flowline',                 region: 'NIMR', site: 'Nimr North', wellType: 'Conventional well', wells: 32, done: 20, inProgress: 12 },
        { code: 'NS0010',  name: 'SNLP',                     region: 'NIMR', site: 'Nimr North', wellType: 'Conventional well', wells: 24, done: 15, inProgress: 9  },
        { code: 'NNSW10',  name: 'Non-Standard Well',        region: 'NIMR', site: 'Nimr South', wellType: 'Conventional well', wells: 18, done: 11, inProgress: 7  },
        { code: 'NCWF10',  name: 'Conversion with Flowline', region: 'NIMR', site: 'Nimr South', wellType: 'Conventional well', wells: 14, done: 9,  inProgress: 5  },
        { code: 'NCOF10',  name: 'Conversion without Flowline', region: 'NIMR', site: 'Nimr South', wellType: 'Conventional well', wells: 11, done: 6, inProgress: 5 },
        { code: 'NROP10',  name: 'Re-Open',                  region: 'NIMR', site: 'Nimr North', wellType: 'Conventional well', wells: 13, done: 8,  inProgress: 5  },
        { code: 'NROT10',  name: 'Rotoflex',                 region: 'NIMR', site: 'Nimr South', wellType: 'Conventional well', wells: 9,  done: 6,  inProgress: 3  },
        { code: 'NLTP10',  name: 'LTP',                      region: 'NIMR', site: 'Nimr North', wellType: 'Conventional well', wells: 7,  done: 4,  inProgress: 3  },
        { code: 'NY0010',  name: 'Yibal',                    region: 'NIMR', site: 'Nimr South', wellType: 'Conventional well', wells: 21, done: 13, inProgress: 8  }
      ]
    },
    {
      name: 'MARMUL', open: false, items: [
        { code: 'ML0010',  name: 'Location',                    region: 'MARMUL', site: 'Marmul East', wellType: 'Conventional well', wells: 38, done: 24, inProgress: 14 },
        { code: 'MF0010',  name: 'Flowline',                    region: 'MARMUL', site: 'Marmul East', wellType: 'Conventional well', wells: 29, done: 18, inProgress: 11 },
        { code: 'MS0010',  name: 'SNLP',                        region: 'MARMUL', site: 'Marmul East', wellType: 'Conventional well', wells: 22, done: 14, inProgress: 8  },
        { code: 'MNSW10',  name: 'Non-Standard Well',           region: 'MARMUL', site: 'Marmul West', wellType: 'Conventional well', wells: 16, done: 10, inProgress: 6  },
        { code: 'MCWF10',  name: 'Conversion with Flowline',    region: 'MARMUL', site: 'Marmul West', wellType: 'Conventional well', wells: 13, done: 8,  inProgress: 5  },
        { code: 'MCOF10',  name: 'Conversion without flowline', region: 'MARMUL', site: 'Marmul West', wellType: 'Conventional well', wells: 12, done: 7,  inProgress: 5  },
        { code: 'MRWF10',  name: 'Reopen With Flowline',        region: 'MARMUL', site: 'Marmul East', wellType: 'Conventional well', wells: 10, done: 6,  inProgress: 4  },
        { code: 'MROP10',  name: 'Re-Open',                     region: 'MARMUL', site: 'Marmul West', wellType: 'Conventional well', wells: 11, done: 7,  inProgress: 4  },
        { code: 'MY0010',  name: 'Yibal',                       region: 'MARMUL', site: 'Marmul East', wellType: 'Conventional well', wells: 19, done: 12, inProgress: 7  }
      ]
    }
  ];

  // ── Search (autocomplete) ──
  searchQuery = '';
  showSuggestions = false;

  // ── Filter popup ──
  filterOpen = false;
  filter: { cluster: string; site: string; wellType: string; project: string; wellId: string } = { cluster: '', site: '', wellType: '', project: '', wellId: '' };

  private get allItems(): ProjectItem[] {
    return this.groups.reduce<ProjectItem[]>((acc, g) => acc.concat(g.items), []);
  }

  /** Clusters available (derived from project regions). */
  get clusters(): string[] {
    return Array.from(new Set(this.allItems.map(i => i.region)));
  }
  /** Sites available for the chosen cluster. */
  get sites(): string[] {
    if (!this.filter.cluster) return [];
    return Array.from(new Set(
      this.allItems.filter(i => i.region === this.filter.cluster).map(i => i.site)
    ));
  }
  get wellTypes(): string[] {
    return Array.from(new Set(this.allItems.map(i => i.wellType)));
  }
  /** Projects available for the chosen cluster/site (or all when none chosen). */
  get projectNames(): string[] {
    const list = this.allItems.filter(i =>
      (!this.filter.cluster || i.region === this.filter.cluster) &&
      (!this.filter.site || i.site === this.filter.site)
    );
    return Array.from(new Set(list.map(i => i.name)));
  }
  /** Well IDs available for the current cluster/site/project scope. */
  get wellIds(): string[] {
    if (!this.filter.cluster) return [];
    const list = this.allItems.filter(i =>
      i.region === this.filter.cluster &&
      (!this.filter.site || i.site === this.filter.site) &&
      (!this.filter.project || i.name === this.filter.project)
    );
    // Two sample wells per in-scope project (e.g. NL0010-W01, NL0010-W02)
    return list.reduce<string[]>((acc, i) => acc.concat([`${i.code}-W01`, `${i.code}-W02`]), []);
  }

  /** Title-cased region for the card subtitle (e.g. NIMR → Nimr). */
  subtitle(item: ProjectItem): string {
    const place = item.region.charAt(0).toUpperCase() + item.region.slice(1).toLowerCase();
    return `${place} · ${item.wellType}`;
  }

  /** Items in a group after applying search + filter. */
  visibleItems(group: ProjectGroup): ProjectItem[] {
    const q = this.searchQuery.trim().toLowerCase();
    return group.items.filter(it => {
      if (this.filter.cluster && it.region !== this.filter.cluster) return false;
      if (this.filter.site && it.site !== this.filter.site) return false;
      if (this.filter.wellType && it.wellType !== this.filter.wellType) return false;
      if (this.filter.project && it.name !== this.filter.project) return false;
      if (this.filter.wellId && !this.filter.wellId.startsWith(it.code)) return false;
      if (q && !(it.name.toLowerCase().includes(q) || it.code.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  /** True while a search term or filter is active (forces groups open). */
  get hasQuery(): boolean {
    return !!this.searchQuery.trim() || !!this.filter.cluster || !!this.filter.site || !!this.filter.wellType || !!this.filter.project || !!this.filter.wellId;
  }

  /** Autocomplete suggestions across all groups (match by name). */
  get suggestions(): ProjectItem[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return [];
    return this.allItems
      .filter(i => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q))
      .slice(0, 6);
  }

  get activeFilterCount(): number {
    return (this.filter.cluster ? 1 : 0) + (this.filter.site ? 1 : 0) + (this.filter.wellType ? 1 : 0) + (this.filter.project ? 1 : 0) + (this.filter.wellId ? 1 : 0);
  }

  /** Reset dependent Site/Project/Well selections when Cluster changes. */
  onClusterChange(): void {
    this.filter.site = '';
    this.filter.wellId = '';
    if (this.filter.project && !this.projectNames.includes(this.filter.project)) {
      this.filter.project = '';
    }
  }

  /** Reset dependent Project/Well selections when Site changes. */
  onSiteChange(): void {
    this.filter.wellId = '';
    if (this.filter.project && !this.projectNames.includes(this.filter.project)) {
      this.filter.project = '';
    }
  }

  /** Reset dependent Well selection when Project changes. */
  onProjectChange(): void {
    if (this.filter.wellId && !this.wellIds.includes(this.filter.wellId)) {
      this.filter.wellId = '';
    }
  }

  constructor(private router: Router) {}

  /** Open the dashboard for a project. */
  openProject(it: ProjectItem): void {
    this.router.navigate(['/cmdoverview'], { queryParams: { project: it.code } });
  }

  /** Completion percentage (done / wells) for the card progress bar. */
  progressPct(it: ProjectItem): number {
    return it.wells > 0 ? Math.round((it.done / it.wells) * 100) : 0;
  }

  // ── Accordion ──
  toggleGroup(group: ProjectGroup): void { group.open = !group.open; }

  // ── Search handlers ──
  onSearchInput(): void { this.showSuggestions = true; }
  selectSuggestion(it: ProjectItem): void {
    this.searchQuery = it.name;
    this.showSuggestions = false;
  }
  clearSearch(): void {
    this.searchQuery = '';
    this.showSuggestions = false;
  }

  // ── Filter handlers ──
  toggleFilter(): void { this.filterOpen = !this.filterOpen; }
  applyFilter(): void { this.filterOpen = false; }
  clearFilter(): void { this.filter = { cluster: '', site: '', wellType: '', project: '', wellId: '' }; }

  /** Close the suggestions dropdown / filter popup when clicking outside them. */
  @HostListener('document:click')
  onDocumentClick(): void {
    this.showSuggestions = false;
    this.filterOpen = false;
  }

  ngAfterViewInit(): void {
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;
  }

  ngOnDestroy(): void {}
}
