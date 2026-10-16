import { Component, ChangeDetectorRef, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonApiService, OrgStructureRow, PlantFilterDto } from '../../../core/services/common-api.service';
import { DashboardShareContext } from '../../../core/services/widget.service';
import { forkJoin, of, Subject } from 'rxjs';
import { catchError, takeUntil } from 'rxjs/operators';

export interface AdvancedFilterOption {
  value: string;
  label: string;
}

export interface AdvancedFilterField {
  id: string;
  label: string;
  options: AdvancedFilterOption[];
  selected: string[];
  dropdownOpen: boolean;
  hidden?: boolean;
}

export interface AdvancedFilterValue {
  wellId: string;
  hierarchy: Record<string, string[]>;
}

@Component({
  selector: 'app-advanced-filter',
  standalone: false,
  templateUrl: './advanced-filter.component.html',
  styleUrls: ['./advanced-filter.component.scss'],
})
export class AdvancedFilterComponent implements OnInit, OnDestroy, OnChanges {
  @Input() globalCountry = '';
  @Input() globalSector = '';
  @Input() globalBusinessUnit = '';
  @Input() globalDivision = '';
  @Input() globalCluster = '';
  @Input() globalPlant = '';
  @Input() shareContext?: DashboardShareContext;
  @Output() applied = new EventEmitter<AdvancedFilterValue>();

  showPanel = false;
  searchTerm = '';
  identificationExpanded = true;
  hierarchyExpanded = true;
  wellId = '';

  hierarchyFields: AdvancedFilterField[] = [
    { id: 'ceo-sector-head', label: 'Sector Head', options: [], selected: [], dropdownOpen: false },
    { id: 'bu-head', label: 'BU Head', options: [], selected: [], dropdownOpen: false },
    { id: 'division-head', label: 'Division Head', options: [], selected: [], dropdownOpen: false },
    { id: 'cluster-heads', label: 'Cluster Heads', options: [], selected: [], dropdownOpen: false },
    { id: 'plant-project-head', label: 'Plant / Project Head', options: [], selected: [], dropdownOpen: false },
    { id: 'nationality', label: 'Nationality', options: [{ value: 'National', label: 'National' }, { value: 'Expat', label: 'Expat' }], selected: [], dropdownOpen: false },
    { id: 'resource-type', label: 'Resource Type', options: [{ value: 'ATNM', label: 'ATNM' }, { value: 'SubContractor', label: 'SubContractor' }], selected: [], dropdownOpen: false },
    { id: 'position-category', label: 'Position Category', options: [{ value: 'Staff', label: 'Staff' }, { value: 'Labour', label: 'Labour' }], selected: [], dropdownOpen: false },
    { id: 'subcontractor-company', label: 'Subcontractor Company', options: [], selected: [], dropdownOpen: false },
  ];

  private readonly destroy$ = new Subject<void>();

  get identificationActiveCount(): number {
    return this.wellId.trim() ? 1 : 0;
  }

  get hierarchyActiveCount(): number {
    return this.hierarchyFields.reduce((sum, f) => sum + f.selected.length, 0);
  }

  constructor(private readonly elementRef: ElementRef<HTMLElement>, private readonly commonApi: CommonApiService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    document.body.appendChild(this.elementRef.nativeElement);
    this.loadAdvancedFilterData();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (['globalCountry', 'globalSector', 'globalBusinessUnit', 'globalDivision', 'globalCluster', 'globalPlant']
      .some(input => changes[input])) {
      this.refreshHierarchyFields();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.elementRef.nativeElement.remove();
  }

  private allOrg: OrgStructureRow[] = [];
  private allPlants: PlantFilterDto[] = [];

  private loadAdvancedFilterData(): void {
    forkJoin({
      filters: this.commonApi.getAdvancedFilters(this.shareContext).pipe(catchError(() => of({ orgStructure: [] as OrgStructureRow[], companies: [] as { companyId: number; companyName: string }[] }))),
      plants: this.commonApi.getPlantFilters(this.shareContext).pipe(catchError(() => of([] as PlantFilterDto[]))),
    }).pipe(takeUntil(this.destroy$)).subscribe(({ filters, plants }) => {
      this.allOrg = filters.orgStructure;
      this.allPlants = plants;

      this.getField('subcontractor-company').options = filters.companies.map(c => ({ value: String(c.companyId), label: c.companyName }));

      // Pre-select first option for static and company fields
      for (const id of ['nationality', 'resource-type', 'position-category', 'subcontractor-company']) {
        const f = this.getField(id);
        if (!f.selected.length && f.options.length) f.selected = [f.options[0].value];
      }

      this.refreshHierarchyFields();
      this.cdr.markForCheck();
    });
  }

  private refreshHierarchyFields(): void {
    const criteria: [keyof PlantFilterDto, string][] = [
      ['country', this.globalCountry],
      ['sector', this.globalSector],
      ['businessUnit', this.globalBusinessUnit],
      ['division', this.globalDivision],
      ['cluster', this.globalCluster],
      ['plantDescription', this.globalPlant],
    ];
    const activeCriteria = criteria.filter(([, value]) => value && value !== 'All');
    const plantCodes = new Set(this.allPlants
      .filter(plant => activeCriteria.every(([key, value]) => plant[key] === value))
      .map(plant => plant.plantCode));
    const org = activeCriteria.length ? this.allOrg.filter(row => plantCodes.has(row.plantCode)) : this.allOrg;
    const fields: [string, string[]][] = [
      ['ceo-sector-head', org.map(row => row.ceo)],
      ['bu-head', org.map(row => row.executiveVicePresident)],
      ['division-head', org.map(row => row.projectDirectorName)],
      ['cluster-heads', org.map(row => row.clusterManager)],
      ['plant-project-head', org.flatMap(row => [row.siteManagerA, row.siteManagerB])],
    ];
    for (const [id, values] of fields) {
      const field = this.getField(id);
      field.selected = [...new Set(values.filter(value => !!value))].sort((first, second) => first.localeCompare(second));
      field.options = field.selected.map(value => ({ value, label: value }));
      field.dropdownOpen = false;
    }
  }

  private getField(id: string): AdvancedFilterField {
    return this.hierarchyFields.find(f => f.id === id)!;
  }

  open(): void {
    this.showPanel = true;
    // Force sync render since callers (e.g. OnPush pages) may not trigger a tick for this DOM-detached component
    this.cdr.detectChanges();
  }

  close(): void {
    this.showPanel = false;
    this.hierarchyFields.forEach(f => (f.dropdownOpen = false));
    this.cdr.detectChanges();
  }

  toggleIdentificationSection(): void {
    this.identificationExpanded = !this.identificationExpanded;
  }

  toggleHierarchySection(): void {
    this.hierarchyExpanded = !this.hierarchyExpanded;
  }

  clearIdentificationFilters(): void {
    this.wellId = '';
  }

  clearHierarchyFilters(): void {
    this.hierarchyFields.forEach(f => (f.selected = []));
  }

  clearHierarchyField(field: AdvancedFilterField): void {
    field.selected = [];
  }

  toggleHierarchyFieldDropdown(field: AdvancedFilterField): void {
    const willOpen = !field.dropdownOpen;
    this.hierarchyFields.forEach(f => (f.dropdownOpen = f.id === field.id && willOpen));
  }

  selectHierarchyOption(field: AdvancedFilterField, option: AdvancedFilterOption): void {
    if (!field.selected.includes(option.value)) field.selected = [...field.selected, option.value];
    field.dropdownOpen = false;
  }

  removeHierarchyChip(field: AdvancedFilterField, value: string): void {
    field.selected = field.selected.filter(v => v !== value);
  }

  hierarchyOptionLabel(field: AdvancedFilterField, value: string): string {
    return field.options.find(o => o.value === value)?.label || value;
  }

  availableHierarchyOptions(field: AdvancedFilterField): AdvancedFilterOption[] {
    return field.options.filter(o => !field.selected.includes(o.value));
  }

  reset(): void {
    this.wellId = '';
    this.hierarchyFields.forEach(f => (f.selected = []));
  }

  apply(): void {
    this.applied.emit({
      wellId: this.wellId,
      hierarchy: Object.fromEntries(this.hierarchyFields.map(f => [f.id, f.selected])),
    });
    this.close();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.hierarchyFields.forEach(f => (f.dropdownOpen = false));
  }
}
