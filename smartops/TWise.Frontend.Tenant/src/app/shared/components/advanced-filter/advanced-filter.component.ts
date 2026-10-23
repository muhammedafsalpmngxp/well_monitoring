import { Component, ChangeDetectorRef, ElementRef, EventEmitter, HostListener, Input, OnChanges, OnDestroy, OnInit, Output, SimpleChanges } from '@angular/core';
import { CommonApiService, OrgStructureRow, PlantFilterDto } from '../../../core/services/common-api.service';
import { DashboardShareContext } from '../../../core/services/widget.service';
import {
  GlobalFilterSelection,
  hasGlobalSelection,
  matchesGlobalSelection,
} from '../../../core/utils/global-filter-selection.util';
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

const ALL_RESOURCE_TYPES = '__all_resource_types__';

@Component({
  selector: 'app-advanced-filter',
  standalone: false,
  templateUrl: './advanced-filter.component.html',
  styleUrls: ['./advanced-filter.component.scss'],
})
export class AdvancedFilterComponent implements OnInit, OnDestroy, OnChanges {
  @Input() globalCountry: GlobalFilterSelection = '';
  @Input() globalSector: GlobalFilterSelection = '';
  @Input() globalBusinessUnit: GlobalFilterSelection = '';
  @Input() globalDivision: GlobalFilterSelection = '';
  @Input() globalCluster: GlobalFilterSelection = '';
  @Input() globalPlant: GlobalFilterSelection = '';
  @Input() shareContext?: DashboardShareContext;
  @Output() applied = new EventEmitter<AdvancedFilterValue>();

  showPanel = false;
  hasAppliedFilters = false;
  searchTerm = '';
  identificationExpanded = true;
  hierarchyExpanded = true;
  wellId = '';
  loadError = '';

  hierarchyFields: AdvancedFilterField[] = [
    { id: 'ceo-sector-head', label: 'Sector Head', options: [], selected: [], dropdownOpen: false },
    { id: 'bu-head', label: 'BU Head', options: [], selected: [], dropdownOpen: false },
    { id: 'division-head', label: 'Division Head', options: [], selected: [], dropdownOpen: false },
    { id: 'cluster-heads', label: 'Cluster Heads', options: [], selected: [], dropdownOpen: false },
    { id: 'plant-project-head', label: 'Plant / Project Head', options: [], selected: [], dropdownOpen: false },
    { id: 'nationality', label: 'Nationality', options: [{ value: 'National', label: 'National' }, { value: 'Expat', label: 'Expat' }], selected: [], dropdownOpen: false },
    { id: 'resource-type', label: 'Resource Type', options: [], selected: [], dropdownOpen: false },
    { id: 'position-category', label: 'Position Category', options: [{ value: 'Staff', label: 'Staff' }, { value: 'Labour', label: 'Labour' }], selected: [], dropdownOpen: false },
    { id: 'subcontractor-company', label: 'Subcontractor Company', options: [], selected: [], dropdownOpen: false },
  ];

  private readonly destroy$ = new Subject<void>();

  get identificationActiveCount(): number {
    return this.wellId.trim() ? 1 : 0;
  }

  get hierarchyActiveCount(): number {
    return this.hierarchyFields.reduce((sum, field) =>
      sum + field.selected.filter(value => value !== ALL_RESOURCE_TYPES).length, 0);
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
    this.loadError = '';
    for (const id of ['nationality', 'position-category']) {
      const field = this.getField(id);
      if (!field.selected.length && field.options.length) field.selected = [field.options[0].value];
    }
    forkJoin({
      filters: this.commonApi.getAdvancedFilters(this.shareContext).pipe(catchError((error: unknown) => {
        console.error('Failed to load Advanced Filter options.', error);
        this.loadError = 'Unable to load Advanced Filter options. Reopen the page to retry.';
        return of(null);
      })),
      plants: this.commonApi.getPlantFilters(this.shareContext).pipe(catchError((error: unknown) => {
        console.error('Failed to load Advanced Filter plant hierarchy.', error);
        this.loadError = 'Unable to load the plant hierarchy for Advanced Filters. Reopen the page to retry.';
        return of(null);
      })),
    }).pipe(takeUntil(this.destroy$)).subscribe(({ filters, plants }) => {
      if (plants) this.allPlants = plants;
      if (!filters) {
        this.cdr.markForCheck();
        return;
      }
      this.allOrg = filters.orgStructure;

      this.getField('subcontractor-company').options = filters.companies.map(c => ({ value: String(c.companyId), label: c.companyName }));
      if (filters.resourceTypesError || !Array.isArray(filters.resourceTypes)) {
        this.loadError = filters.resourceTypesError
          || 'Resource Type options are unavailable. Update the tenant backend and reload the page.';
        console.error(this.loadError);
      } else {
        this.getField('resource-type').options = filters.resourceTypes.map(value => ({ value, label: value }));
      }

      // Pre-select first option for static and company fields
      for (const id of ['nationality', 'resource-type', 'position-category', 'subcontractor-company']) {
        const f = this.getField(id);
        if (!f.selected.length && f.options.length) {
          f.selected = id === 'resource-type' ? [ALL_RESOURCE_TYPES] : [f.options[0].value];
        }
      }

      this.refreshHierarchyFields();
      this.cdr.markForCheck();
    });
  }

  private refreshHierarchyFields(): void {
    const criteria: [keyof PlantFilterDto, GlobalFilterSelection][] = [
      ['country', this.globalCountry],
      ['sector', this.globalSector],
      ['businessUnit', this.globalBusinessUnit],
      ['division', this.globalDivision],
      ['cluster', this.globalCluster],
      ['plantDescription', this.globalPlant],
    ];
    const activeCriteria = criteria.filter(([, value]) => hasGlobalSelection(value));
    const plantCodes = new Set(this.allPlants
      .filter(plant => activeCriteria.every(([key, value]) => matchesGlobalSelection(plant[key], value)))
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
    const selected = field.id === 'resource-type'
      ? field.selected.filter(value => value !== ALL_RESOURCE_TYPES)
      : field.selected;
    if (!selected.includes(option.value)) field.selected = [...selected, option.value];
    if (field.id !== 'resource-type') field.dropdownOpen = false;
  }

  selectAllHierarchyOptions(field: AdvancedFilterField): void {
    if (field.id === 'resource-type') {
      field.selected = field.options.length ? [ALL_RESOURCE_TYPES] : [];
      field.dropdownOpen = true;
    }
  }

  isAllHierarchySelected(field: AdvancedFilterField): boolean {
    return field.id === 'resource-type' && field.options.length > 0
      && field.selected.includes(ALL_RESOURCE_TYPES);
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
    this.refreshHierarchyFields();
    for (const id of ['nationality', 'resource-type', 'position-category', 'subcontractor-company']) {
      const field = this.getField(id);
      field.selected = id === 'resource-type'
        ? field.options.length ? [ALL_RESOURCE_TYPES] : []
        : field.options.length ? [field.options[0].value] : [];
    }
    this.hierarchyFields.forEach(field => (field.dropdownOpen = false));
  }

  clear(): void {
    this.hasAppliedFilters = false;
    this.wellId = '';
    this.hierarchyFields.forEach(f => (f.selected = []));
  }

  apply(): void {
    const hierarchy = Object.fromEntries(this.hierarchyFields.map(field => [
      field.id,
      this.isAllHierarchySelected(field) ? [] : field.selected,
    ]));
    this.hasAppliedFilters = !!this.wellId.trim()
      || this.hierarchyFields.some(field => hierarchy[field.id].length > 0);
    this.applied.emit({
      wellId: this.wellId,
      hierarchy,
    });
    this.close();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.hierarchyFields.forEach(f => (f.dropdownOpen = false));
  }
}
