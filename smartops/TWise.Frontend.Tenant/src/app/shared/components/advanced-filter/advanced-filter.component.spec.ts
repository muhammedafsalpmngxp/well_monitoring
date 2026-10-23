import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { of, Subject, throwError } from 'rxjs';
import { ElementRef } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommonApiService, OrgStructureRow, PlantFilterDto } from '../../../core/services/common-api.service';
import { AdvancedFilterComponent } from './advanced-filter.component';

const plants: PlantFilterDto[] = [1, 2, 3].map(id => ({
  plantCode: id,
  plantDescription: `Plant ${id}`,
  cluster: `Cluster ${id}`,
  division: `Division ${id}`,
  businessUnit: `BU ${id}`,
  sector: `Sector ${id}`,
  country: `Country ${id}`,
}));
const orgStructure: OrgStructureRow[] = plants.map(plant => ({
  plantCode: plant.plantCode,
  ceo: 'Shared sector head',
  executiveVicePresident: `BU head ${plant.plantCode}`,
  projectDirectorID: plant.plantCode,
  projectDirectorName: `Division head ${plant.plantCode}`,
  clusterManager: `Cluster head ${plant.plantCode}`,
  siteManagerA: `Plant head ${plant.plantCode}`,
  siteManagerB: '',
}));
const hierarchySelections = [
  ['globalCountry', ['Country 1', 'Country 2']],
  ['globalSector', ['Sector 1', 'Sector 2']],
  ['globalBusinessUnit', ['BU 1', 'BU 2']],
  ['globalDivision', ['Division 1', 'Division 2']],
  ['globalCluster', ['Cluster 1', 'Cluster 2']],
  ['globalPlant', ['Plant 1', 'Plant 2']],
] as const;

describe('Advanced Filter global hierarchy alignment', () => {
  let fixture: ComponentFixture<AdvancedFilterComponent>;
  const api = {
    getAdvancedFilters: vi.fn(),
    getPlantFilters: vi.fn(),
  };

  beforeEach(() => {
    api.getAdvancedFilters.mockReturnValue(of({ orgStructure, companies: [], resourceTypes: ['ATNM', 'SC'] }));
    api.getPlantFilters.mockReturnValue(of(plants));
    TestBed.configureTestingModule({
      declarations: [AdvancedFilterComponent],
      imports: [CommonModule, FormsModule],
      providers: [{ provide: CommonApiService, useValue: api }],
    });
    fixture = TestBed.createComponent(AdvancedFilterComponent);
  });

  function expectHeads(ids: number[]): void {
    const fields = fixture.componentInstance.hierarchyFields;
    const expected: Record<string, string[]> = {
      'ceo-sector-head': ids.length ? ['Shared sector head'] : [],
      'bu-head': ids.map(id => `BU head ${id}`),
      'division-head': ids.map(id => `Division head ${id}`),
      'cluster-heads': ids.map(id => `Cluster head ${id}`),
      'plant-project-head': ids.map(id => `Plant head ${id}`),
    };
    for (const [id, selected] of Object.entries(expected)) {
      const field = fields.find(field => field.id === id)!;
      expect(field.selected).toEqual(selected);
      expect(field.options).toEqual(selected.map(value => ({ value, label: value })));
    }
  }

  it('defaults Resource Type to All and displays the available options', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const resourceType = component.hierarchyFields.find(field => field.id === 'resource-type')!;
    expect(component.isAllHierarchySelected(resourceType)).toBe(true);
    expect(component.availableHierarchyOptions(resourceType)).toEqual(resourceType.options);
    const fields = fixture.nativeElement.querySelectorAll('.filter-field');
    const resourceField = fields[component.hierarchyFields.indexOf(resourceType)] as HTMLElement;
    expect(resourceField.querySelector('.filter-chip')?.textContent).toContain('All');
    const emit = vi.spyOn(component.applied, 'emit');
    component.apply();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      hierarchy: expect.objectContaining({ 'resource-type': [] }),
    }));
  });

  it('treats Resource Type All as no applied filter', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.clearHierarchyFilters();
    const resourceType = component.hierarchyFields.find(field => field.id === 'resource-type')!;
    component.selectAllHierarchyOptions(resourceType);
    const emit = vi.spyOn(component.applied, 'emit');

    component.apply();

    expect(component.hasAppliedFilters).toBe(false);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      hierarchy: expect.objectContaining({ 'resource-type': [] }),
    }));
  });

  it('keeps Resource Type options open for multiple selections and replaces All', () => {
    api.getAdvancedFilters.mockReturnValue(of({
      orgStructure, companies: [{ companyId: 7, companyName: 'Company A' }], resourceTypes: ['ATNM', 'SC'],
    }));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.open();
    for (const [index, field] of component.hierarchyFields.entries()) {
      component.clearHierarchyField(field);
      const element = fixture.nativeElement.querySelectorAll('.filter-field')[index] as HTMLElement;
      (element.querySelector('.filter-multiselect__toggle') as HTMLButtonElement).click();
      fixture.detectChanges();
      if (field.id !== 'resource-type') {
        const options = Array.from(element.querySelectorAll('.filter-multiselect__option'));
        expect(options.map(option => option.textContent?.trim())).not.toContain('All');
        (options[0] as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(component.isAllHierarchySelected(field)).toBe(false);
        expect(field.selected).toEqual([field.options[0].value]);
        expect(element.querySelectorAll('.filter-chip')).toHaveLength(1);
        expect(element.querySelector('.filter-chip')?.textContent).toContain(field.options[0].label);
        continue;
      }
      const allButton = element.querySelector('.filter-multiselect__option') as HTMLButtonElement;
      expect(allButton.textContent?.trim()).toBe('All');
      allButton.click();
      fixture.detectChanges();
      expect(component.isAllHierarchySelected(field)).toBe(true);
      expect(component.availableHierarchyOptions(field)).toEqual(field.options);
      expect(element.querySelectorAll('.filter-multiselect__option')).toHaveLength(field.options.length + 1);
      expect(field.dropdownOpen).toBe(true);
      (element.querySelectorAll('.filter-multiselect__option')[1] as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(field.selected).toEqual([field.options[0].value]);
      expect(component.isAllHierarchySelected(field)).toBe(false);
      expect(element.querySelector('.filter-chip')?.textContent).toContain(field.options[0].label);
      expect(field.dropdownOpen).toBe(true);
      (element.querySelectorAll('.filter-multiselect__option')[1] as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(field.selected).toEqual(field.options.slice(0, 2).map(option => option.value));
      expect(field.dropdownOpen).toBe(true);
      const emit = vi.spyOn(component.applied, 'emit');
      component.apply();
      expect(emit).toHaveBeenCalledWith(expect.objectContaining({
        hierarchy: expect.objectContaining({ 'resource-type': field.options.slice(0, 2).map(option => option.value) }),
      }));
    }
  });

  it('does not treat an empty dropdown as all selected', () => {
    api.getAdvancedFilters.mockReturnValue(of({ orgStructure, companies: [], resourceTypes: [] }));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const resource = component.hierarchyFields.find(field => field.id === 'resource-type')!;
    component.selectAllHierarchyOptions(resource);
    expect(resource.selected).toEqual([]);
    expect(component.isAllHierarchySelected(resource)).toBe(false);
  });

  it('tracks applied filters independently of defaults and unapplied panel changes', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    expect(component.hasAppliedFilters).toBe(false);
    component.apply();
    expect(component.hasAppliedFilters).toBe(true);
    component.clearHierarchyFilters();
    component.close();
    expect(component.hasAppliedFilters).toBe(true);
    component.apply();
    expect(component.hasAppliedFilters).toBe(false);
    component.wellId = 'Well 1';
    component.apply();
    expect(component.hasAppliedFilters).toBe(true);
    component.reset();
    expect(component.hasAppliedFilters).toBe(true);
    component.clear();
    expect(component.hasAppliedFilters).toBe(false);
    component.wellId = '   ';
    component.apply();
    expect(component.hasAppliedFilters).toBe(false);
  });

  it('restores all changed selections to defaults when the Reset button is clicked without applying', () => {
    api.getAdvancedFilters.mockReturnValue(of({
      orgStructure, companies: [{ companyId: 7, companyName: 'Company A' }, { companyId: 8, companyName: 'Company B' }],
      resourceTypes: ['Overall', 'ATNM', 'Subcontractor'],
    }));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.open();
    component.wellId = 'Changed';
    component.hierarchyFields.forEach(field => {
      field.selected = ['Changed'];
      field.dropdownOpen = true;
    });
    const emit = vi.spyOn(component.applied, 'emit');
    const button = fixture.nativeElement.querySelector('.advanced-filter-panel__reset-btn') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();
    expectHeads([1, 2, 3]);
    const defaults: Record<string, string[]> = {
      nationality: ['National'], 'position-category': ['Staff'], 'subcontractor-company': ['7'],
    };
    for (const [id, values] of Object.entries(defaults)) {
      expect(component.hierarchyFields.find(field => field.id === id)!.selected).toEqual(values);
    }
    expect(component.isAllHierarchySelected(component.hierarchyFields.find(field => field.id === 'resource-type')!)).toBe(true);
    expect(component.wellId).toBe('');
    expect(component.hierarchyFields.every(field => !field.dropdownOpen)).toBe(true);
    expect(component.showPanel).toBe(true);
    expect(emit).not.toHaveBeenCalled();
    component.apply();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({
      hierarchy: expect.objectContaining({ ...defaults, 'resource-type': [] }),
    }));
  });

  it('resets hierarchy heads to defaults for the current global selection', () => {
    fixture.componentRef.setInput('globalCluster', 'Cluster 2');
    fixture.detectChanges();
    fixture.componentInstance.clearHierarchyFilters();
    fixture.componentInstance.reset();
    expectHeads([2]);
  });

  it('keeps empty lookup fields empty on Reset and preserves explicit page-level clearing', () => {
    api.getAdvancedFilters.mockReturnValue(of({ orgStructure, companies: [], resourceTypes: [] }));
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.reset();
    expect(component.hierarchyFields.find(field => field.id === 'resource-type')!.selected).toEqual([]);
    expect(component.hierarchyFields.find(field => field.id === 'subcontractor-company')!.selected).toEqual([]);
    component.clear();
    expect(component.hierarchyFields.every(field => !field.selected.length)).toBe(true);
    component.reset();
    expectHeads([1, 2, 3]);
    expect(component.hierarchyFields.find(field => field.id === 'nationality')!.selected).toEqual(['National']);
  });

  it.each([
    { orgStructure, companies: [{ companyId: 7, companyName: 'Company A' }] },
    { orgStructure, companies: [{ companyId: 7, companyName: 'Company A' }],
      resourceTypes: [], resourceTypesError: 'Unable to load Resource Type options.' },
  ])('keeps existing defaults and heads when Resource Type is unavailable (%j)', response => {
    api.getAdvancedFilters.mockReturnValue(of(response));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      fixture.detectChanges();
      expectHeads([1, 2, 3]);
      const fields = fixture.componentInstance.hierarchyFields;
      expect(fields.find(field => field.id === 'nationality')!.selected).toEqual(['National']);
      expect(fields.find(field => field.id === 'position-category')!.selected).toEqual(['Staff']);
      expect(fields.find(field => field.id === 'subcontractor-company')!.selected).toEqual(['7']);
      expect(fixture.componentInstance.loadError).toContain('Resource Type');
      expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('Resource Type');
    } finally {
      log.mockRestore();
    }
  });

  it('retains loaded selections and options if a subsequent lookup fails', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const fields = component.hierarchyFields.map(field => ({
      id: field.id, options: [...field.options], selected: [...field.selected],
    }));
    api.getAdvancedFilters.mockReturnValue(throwError(() => new Error('lookup failed')));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      component['loadAdvancedFilterData']();
      expect(component.hierarchyFields.map(field => ({
        id: field.id, options: field.options, selected: field.selected,
      }))).toEqual(fields);
      expect(component.loadError).toContain('Unable to load');
    } finally {
      log.mockRestore();
    }
  });

  it('retains Nationality and Position Category defaults when the first lookup fails', () => {
    api.getAdvancedFilters.mockReturnValue(throwError(() => new Error('lookup failed')));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      fixture.detectChanges();
      const fields = fixture.componentInstance.hierarchyFields;
      expect(fields.find(field => field.id === 'nationality')!.selected).toEqual(['National']);
      expect(fields.find(field => field.id === 'position-category')!.selected).toEqual(['Staff']);
      expect(fixture.componentInstance.loadError).toContain('Unable to load');
    } finally {
      log.mockRestore();
    }
  });

  it.each(hierarchySelections)('includes all selected values for %s, without unrelated heads', (input, values) => {
    fixture.componentRef.setInput(input, [...values]);
    fixture.detectChanges();
    expectHeads([1, 2]);
  });

  it('intersects selections across fields instead of including unrelated plants', () => {
    fixture.componentRef.setInput('globalCountry', ['Country 1', 'Country 2']);
    fixture.componentRef.setInput('globalCluster', ['Cluster 2', 'Cluster 3']);
    fixture.componentRef.setInput('globalPlant', ['Plant 1', 'Plant 2', 'Plant 3']);
    fixture.detectChanges();
    expectHeads([2]);
  });

  it('updates selected heads and options when a multi-selection is narrowed or cleared', () => {
    fixture.componentRef.setInput('globalCluster', ['Cluster 1', 'Cluster 2']);
    fixture.detectChanges();
    expectHeads([1, 2]);
    fixture.componentRef.setInput('globalCluster', 'Cluster 2');
    fixture.detectChanges();
    expectHeads([2]);
    fixture.componentRef.setInput('globalCluster', 'All');
    fixture.detectChanges();
    expectHeads([1, 2, 3]);
    expect(fixture.componentInstance.hierarchyFields.find(field => field.id === 'nationality')!.selected)
      .toEqual(['National']);
  });

  it('preserves other restrictions when one global field is reset to All', () => {
    fixture.componentRef.setInput('globalCluster', ['Cluster 1', 'Cluster 2']);
    fixture.componentRef.setInput('globalPlant', 'Plant 2');
    fixture.detectChanges();
    fixture.componentRef.setInput('globalCluster', 'All');
    fixture.detectChanges();
    expectHeads([2]);
  });

  it('does not fall back to every head when selected fields have no matching plants', () => {
    fixture.componentRef.setInput('globalCluster', ['Cluster 1', 'Cluster 2']);
    fixture.componentRef.setInput('globalPlant', 'Plant 3');
    fixture.detectChanges();
    expectHeads([]);
  });

  it('uses the latest multi-selection when hierarchy data arrives after the inputs', () => {
    const filters = new Subject<{ orgStructure: OrgStructureRow[]; companies: []; resourceTypes: string[] }>();
    const plantFilters = new Subject<PlantFilterDto[]>();
    api.getAdvancedFilters.mockReturnValue(filters);
    api.getPlantFilters.mockReturnValue(plantFilters);
    fixture.componentRef.setInput('globalCluster', ['Cluster 1', 'Cluster 2']);
    fixture.detectChanges();
    fixture.componentRef.setInput('globalCluster', ['Cluster 2', 'Cluster 3']);
    fixture.detectChanges();
    filters.next({ orgStructure, companies: [], resourceTypes: ['ATNM', 'SC'] });
    filters.complete();
    plantFilters.next(plants);
    plantFilters.complete();
    fixture.detectChanges();
    expectHeads([2, 3]);
  });

});

describe('Advanced Filter database resource options', () => {
    function create(resources: string[]) {
      const component: AdvancedFilterComponent = Object.assign(Object.create(AdvancedFilterComponent.prototype), {
        hierarchyFields: ['resource-type', 'nationality', 'position-category', 'subcontractor-company',
          'ceo-sector-head', 'bu-head', 'division-head', 'cluster-heads', 'plant-project-head']
          .map(id => ({ id, options: [], selected: [], dropdownOpen: false })),
        destroy$: new Subject<void>(), cdr: { markForCheck: vi.fn() },
        commonApi: {
          getAdvancedFilters: vi.fn(() => of({ orgStructure: [], companies: [], resourceTypes: resources })),
          getPlantFilters: vi.fn(() => of([])),
        },
        shareContext: { dashboardId: 5, token: 'share-token' },
      });
      return component;
    }

    it('uses API values as labels and values without hardcoded resource options', () => {
      const component = create(['Internal resource', 'SC', 'New resource']);
      component['loadAdvancedFilterData']();
      const resource = component.hierarchyFields.find(field => field.id === 'resource-type')!;
      expect(resource.options).toEqual(['Internal resource', 'SC', 'New resource'].map(value => ({ value, label: value })));
      expect(component.isAllHierarchySelected(resource)).toBe(true);
      expect(component['commonApi'].getAdvancedFilters).toHaveBeenCalledWith(component.shareContext);
    });

    it('keeps empty lookup data empty rather than restoring hardcoded options', () => {
      const component = create([]);
      component['loadAdvancedFilterData']();
      expect(component.hierarchyFields.find(field => field.id === 'resource-type')!.options).toEqual([]);
      expect(component.hierarchyFields.find(field => field.id === 'resource-type')!.selected).toEqual([]);
    });

    it('initializes resource options empty before loading', () => {
      const component = new AdvancedFilterComponent(new ElementRef(document.createElement('div')),
        create([])['commonApi'], create([])['cdr']);
      expect(component.hierarchyFields.find(field => field.id === 'resource-type')!.options).toEqual([]);
    });

    it('surfaces lookup failures without hardcoded fallback values', () => {
      const component = create([]);
      vi.spyOn(component['commonApi'], 'getAdvancedFilters').mockReturnValue(throwError(() => new Error('lookup unavailable')));
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        component['loadAdvancedFilterData']();
        expect(component.loadError).toContain('Unable to load');
        expect(component.hierarchyFields.find(field => field.id === 'resource-type')!.options).toEqual([]);
        expect(log).toHaveBeenCalled();
      } finally {
        log.mockRestore();
      }
  });
});
