import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, Output, TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdvancedChartConfig, advancedFieldRoles, defaultAdvancedConfig, getAdvancedCustomRenderers, isAdvancedChart, multiRoleVisualRoles } from '../../../core/utils/advanced-chart.util';
import { WELL_MAP_BACKGROUNDS, WELL_MAP_COORDINATES, WellMapConfig } from '../../../core/utils/well-map.util';

import { FieldLabelDirective } from '../../directives/field-label.directive';
@Component({
  selector: 'app-advanced-chart-mapping',
  standalone: true,
  imports: [FieldLabelDirective, CommonModule, FormsModule],
  template: `
    <ng-template #columnSearchInput>
      <div class="dd__search">
        <input type="text" placeholder="Search columns" aria-label="Search columns"
          [(ngModel)]="columnSearch" (keydown)="$event.stopPropagation()" [disabled]="disabled" />
      </div>
    </ng-template>
    <div class="mapping">
      <label *ngFor="let role of roles">{{ roleLabel(role) }}
        <div class="dd" style="height: 36px;border-radius:10px;" (click)="$event.stopPropagation()">
          <button type="button" class="dd__btn" [class.open]="openDropdown === ('role:' + role)" [disabled]="disabled"
            (click)="toggleDropdown('role:' + role)">
            <ng-container *ngIf="config.fields[role]">
              <ng-container *ngTemplateOutlet="columnIcon; context: { $implicit: config.fields[role] }"></ng-container>
            </ng-container>
            <span class="dd__value" [class.dd__value--placeholder]="!config.fields[role]">{{ config.fields[role] || 'Select column' }}</span>
            <svg class="dd__chevron" width="10" height="6" viewBox="0 0 12 7" fill="none">
              <path d="M0.7 0.7L5.7 5.7L10.7 0.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div class="dd__panel" *ngIf="openDropdown === ('role:' + role)">
            <ng-container *ngTemplateOutlet="columnSearchInput"></ng-container>
            <div class="dd__list">
              <button type="button" class="dd__item" (click)="selectRoleColumn(role, '')">Select column</button>
              <button type="button" class="dd__item" *ngFor="let column of filteredColumns" [class.active]="config.fields[role] === column"
                [disabled]="textOnly(role, column) || usedByOtherRole(role, column)" (click)="selectRoleColumn(role, column)">
                <ng-container *ngTemplateOutlet="columnIcon; context: { $implicit: column }"></ng-container>
                <span>{{ column }}{{ textOnly(role, column) ? ' (text)' : (usedByOtherRole(role, column) ? ' (used)' : '') }}</span>
              </button>
              <div *ngIf="!filteredColumns.length" class="dd__empty" role="status">No columns found</div>
            </div>
          </div>
        </div>
        <small *ngIf="textOnly(role, config.fields[role] || '')" class="hint">Text column — choose a numeric column, or set Aggregation to Count.</small>
      </label>
      <fieldset *ngIf="needsDimensions"><legend>{{ type === 'keyinfluencers' ? 'Explain By' : (multiRoleLabel('dimension') || 'Row Dimensions (in order)') }}</legend>
        <label class="check" *ngFor="let column of columns"><input type="checkbox" [checked]="config.dimensions.includes(column)" (change)="toggle('dimensions', column)" [disabled]="disabled" />{{ column }}<span *ngIf="config.dimensions.includes(column)">{{ config.dimensions.indexOf(column) + 1 }}</span></label>
      </fieldset>
      <fieldset *ngIf="needsMeasures"><legend>{{ multiRoleLabel('measure') || 'Measures' }}</legend>
        <label class="check" *ngFor="let column of columns"><input type="checkbox" [checked]="config.measures.includes(column)" (change)="toggle('measures', column)" [disabled]="disabled" />{{ column }}</label>
      </fieldset>
      <label *ngIf="hasAggregation">Aggregation
        <div class="dd" (click)="$event.stopPropagation()">
          <button type="button" class="dd__btn" [class.open]="openDropdown === 'aggregation'" [disabled]="disabled" (click)="toggleDropdown('aggregation')">
            <span class="dd__value">{{ aggregationLabel(config.aggregation) }}</span>
            <svg class="dd__chevron" width="10" height="6" viewBox="0 0 12 7" fill="none">
              <path d="M0.7 0.7L5.7 5.7L10.7 0.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div class="dd__panel" *ngIf="openDropdown === 'aggregation'">
            <div class="dd__list">
              <button type="button" class="dd__item" *ngFor="let opt of aggregationOptions" [class.active]="config.aggregation === opt.value"
                (click)="selectAggregation(opt.value)">{{ opt.label }}</button>
            </div>
          </div>
        </div>
      </label>
      <label *ngIf="type === 'keyinfluencers'">Minimum Group Size
        <input type="number" min="2" step="1" [ngModel]="config.minimumGroupSize" (ngModelChange)="change({ minimumGroupSize: $event })" [disabled]="disabled" />
      </label>
      <ng-container *ngIf="type === 'wellmap'">
        <label class="wide">Coordinate System
          <div class="dd" (click)="$event.stopPropagation()">
            <button type="button" class="dd__btn" [class.open]="openDropdown === 'map:coordinates'" [disabled]="disabled" (click)="toggleDropdown('map:coordinates')">
              <span class="dd__value">{{ optionLabel(coordinateSystems, config.map.coordinates) }}</span>
              <svg class="dd__chevron" width="10" height="6" viewBox="0 0 12 7" fill="none">
                <path d="M0.7 0.7L5.7 5.7L10.7 0.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <div class="dd__panel" *ngIf="openDropdown === 'map:coordinates'">
              <div class="dd__list">
                <button type="button" class="dd__item" *ngFor="let option of coordinateSystems" [class.active]="config.map.coordinates === option.value"
                  (click)="selectCoordinateSystem(option.value)">{{ option.label }}</button>
              </div>
            </div>
          </div>
        </label>
        <label>Marker Size (optional)
          <div class="dd" (click)="$event.stopPropagation()">
            <button type="button" class="dd__btn" [class.open]="openDropdown === 'map:size'" [disabled]="disabled" (click)="toggleDropdown('map:size')">
              <ng-container *ngIf="config.map.size">
                <ng-container *ngTemplateOutlet="columnIcon; context: { $implicit: config.map.size }"></ng-container>
              </ng-container>
              <span class="dd__value" [class.dd__value--placeholder]="!config.map.size">{{ config.map.size || 'Same size' }}</span>
              <svg class="dd__chevron" width="10" height="6" viewBox="0 0 12 7" fill="none">
                <path d="M0.7 0.7L5.7 5.7L10.7 0.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <div class="dd__panel" *ngIf="openDropdown === 'map:size'">
              <ng-container *ngTemplateOutlet="columnSearchInput"></ng-container>
              <div class="dd__list">
                <button type="button" class="dd__item" (click)="selectMarkerSize('')">Same size</button>
                <button type="button" class="dd__item" *ngFor="let column of filteredSizeColumns" [class.active]="config.map.size === column"
                  (click)="selectMarkerSize(column)">
                  <ng-container *ngTemplateOutlet="columnIcon; context: { $implicit: column }"></ng-container>
                  <span>{{ column }}</span>
                </button>
                <div *ngIf="!filteredSizeColumns.length" class="dd__empty" role="status">No columns found</div>
              </div>
            </div>
          </div>
        </label>
        <label>Marker Colour By (optional)
          <div class="dd" (click)="$event.stopPropagation()">
            <button type="button" class="dd__btn" [class.open]="openDropdown === 'map:color'" [disabled]="disabled" (click)="toggleDropdown('map:color')">
              <ng-container *ngIf="config.map.color">
                <ng-container *ngTemplateOutlet="columnIcon; context: { $implicit: config.map.color }"></ng-container>
              </ng-container>
              <span class="dd__value" [class.dd__value--placeholder]="!config.map.color">{{ config.map.color || 'One colour' }}</span>
              <svg class="dd__chevron" width="10" height="6" viewBox="0 0 12 7" fill="none">
                <path d="M0.7 0.7L5.7 5.7L10.7 0.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <div class="dd__panel" *ngIf="openDropdown === 'map:color'">
              <ng-container *ngTemplateOutlet="columnSearchInput"></ng-container>
              <div class="dd__list">
                <button type="button" class="dd__item" (click)="selectMarkerColor('')">One colour</button>
                <button type="button" class="dd__item" *ngFor="let column of filteredColumns" [class.active]="config.map.color === column"
                  (click)="selectMarkerColor(column)">
                  <ng-container *ngTemplateOutlet="columnIcon; context: { $implicit: column }"></ng-container>
                  <span>{{ column }}</span>
                </button>
                <div *ngIf="!filteredColumns.length" class="dd__empty" role="status">No columns found</div>
              </div>
            </div>
          </div>
        </label>
        <label>Background
          <div class="dd" (click)="$event.stopPropagation()">
            <button type="button" class="dd__btn" [class.open]="openDropdown === 'map:background'" [disabled]="disabled" (click)="toggleDropdown('map:background')">
              <span class="dd__value">{{ optionLabel(backgrounds, config.map.background) }}</span>
              <svg class="dd__chevron" width="10" height="6" viewBox="0 0 12 7" fill="none">
                <path d="M0.7 0.7L5.7 5.7L10.7 0.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <div class="dd__panel" *ngIf="openDropdown === 'map:background'">
              <div class="dd__list">
                <button type="button" class="dd__item" *ngFor="let option of backgrounds" [class.active]="config.map.background === option.value"
                  (click)="selectBackground(option.value)">{{ option.label }}</button>
              </div>
            </div>
          </div>
        </label>
        <fieldset><legend>Tooltip Fields</legend>
          <label class="check" *ngFor="let column of columns"><input type="checkbox" [checked]="config.map.tooltip.includes(column)" (change)="toggleTooltip(column)" [disabled]="disabled" />{{ column }}</label>
        </fieldset>
      </ng-container>
      <label *ngIf="type === 'customvisual'">Renderer
        <div class="dd" (click)="$event.stopPropagation()">
          <button type="button" class="dd__btn" [class.open]="openDropdown === 'renderer'" [disabled]="disabled" (click)="toggleDropdown('renderer')">
            <span class="dd__value">{{ rendererLabel(config.customRenderer) }}</span>
            <svg class="dd__chevron" width="10" height="6" viewBox="0 0 12 7" fill="none">
              <path d="M0.7 0.7L5.7 5.7L10.7 0.7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
          <div class="dd__panel" *ngIf="openDropdown === 'renderer'">
            <div class="dd__list">
              <button type="button" class="dd__item" *ngFor="let renderer of renderers" [class.active]="config.customRenderer === renderer.id"
                (click)="selectRenderer(renderer.id)">{{ renderer.label }}</button>
            </div>
          </div>
        </div>
      </label>
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .mapping { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 12px 0; }
    label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #344054; min-width: 0; overflow-wrap: anywhere; }
    input[type=number], .dd__search input { width: 100%; box-sizing: border-box; min-width: 0; min-height: 36px; border: 1px solid #d0d5dd; border-radius: 8px; background: white; padding: 6px; color: #344054; font: inherit; }
    fieldset { grid-column: 1 / -1; border: 1px solid #e4e7ec; border-radius: 8px; max-height: 180px; overflow: auto; min-width: 0; padding: 8px; }
    legend { font-size: 12px; color: #344054; }
    .check { flex-direction: row; align-items: center; padding: 4px 0; }
    .check span { margin-left: auto; color: #168675; }
    .hint { color: #b42318; font-size: 11px; }
    .wide { grid-column: 1 / -1; }

    /* Custom rounded dropdown — replaces native <select> so the open option list is styled
       consistently with the rest of the app instead of the browser's own square-cornered popup. */
    .dd { position: relative; min-width: 0; }
    .dd__btn {
      display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box;
      min-height: 36px; padding: 6px 10px; border: 1px solid #d0d5dd; border-radius: 8px;
      background: white; color: #344054; font: inherit; text-align: left; cursor: pointer;
    }
    .dd__btn:hover, .dd__btn.open { border-color: #2563eb; }
    .dd__btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .dd__value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dd__value--placeholder { color: #98a2b3; }
    .dd__chevron { flex-shrink: 0; color: #667085; transition: transform 0.15s ease; }
    .dd__btn.open .dd__chevron { transform: rotate(180deg); }
    .dd__panel {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20;
      background: #fff; border: 1px solid #d0d5dd; border-radius: 10px;
      box-shadow: 0 8px 24px rgba(16, 24, 40, 0.12); overflow: hidden;
    }
    .dd__list { max-height: 220px; overflow-y: auto; padding: 4px; }
    .dd__search { padding: 8px; }
    .dd__empty { padding: 8px 10px; color: #667085; font-size: 12px; }
    .dd__item {
      display: flex; align-items: center; gap: 6px; width: 100%; padding: 8px 10px; border: none; border-radius: 6px;
      background: transparent; font: inherit; font-size: 12px; color: #344054; text-align: left;
      cursor: pointer;
    }
    .dd__item:hover:not(:disabled):not(.active) { background: #f9fafb; }
    .dd__item.active { background: #eef2ff; color: #21409a; font-weight: 600; }
    .dd__item:disabled { opacity: 0.5; cursor: not-allowed; }

    @media (max-width: 480px) { .mapping { grid-template-columns: minmax(0, 1fr); } }
  `],
})
export class AdvancedChartMappingComponent {
  @Input() type: string | null = null;
  @Input() columns: string[] = [];
  @Input() columnIcon: TemplateRef<{ $implicit: string }> | null = null;
  /** Columns whose values are all numeric; null disables the Value guard. */
  @Input() numericColumns: string[] | null = null;
  @Input() config: AdvancedChartConfig = defaultAdvancedConfig();
  @Input() disabled = false;
  @Output() configChange = new EventEmitter<AdvancedChartConfig>();
  readonly renderers = getAdvancedCustomRenderers();
  readonly coordinateSystems = WELL_MAP_COORDINATES;
  readonly backgrounds = WELL_MAP_BACKGROUNDS;
  readonly aggregationOptions: { value: AdvancedChartConfig['aggregation']; label: string }[] = [
    { value: 'sum', label: 'Sum' }, { value: 'avg', label: 'Average' }, { value: 'count', label: 'Count' },
    { value: 'min', label: 'Minimum' }, { value: 'max', label: 'Maximum' },
  ];
  readonly labels: Record<string, string> = { q1: 'First Quartile (Q1)', q3: 'Third Quartile (Q3)', region: 'Country ISO Code', destinationLatitude: 'Destination Latitude', destinationLongitude: 'Destination Longitude', column: 'Pivot Column', value: 'Value / Target' };
  /** Only one of this component's custom dropdowns (role columns / aggregation / map fields / renderer) is open at a time. */
  openDropdown: string | null = null;
  columnSearch = '';
  get filteredColumns(): string[] { return this.filterColumns(this.columns); }
  get filteredSizeColumns(): string[] { return this.filterColumns(this.sizeColumns); }
  private filterColumns(columns: string[]): string[] {
    const search = this.columnSearch.trim().toLowerCase();
    return search ? columns.filter(column => column.toLowerCase().includes(search)) : columns;
  }
  toggleDropdown(key: string): void {
    this.columnSearch = '';
    this.openDropdown = this.openDropdown === key ? null : key;
  }
  @HostListener('document:click')
  closeDropdown(): void { this.openDropdown = null; }
  optionLabel(options: { value: string; label: string }[], value: string): string {
    return options.find(option => option.value === value)?.label ?? 'Select';
  }
  aggregationLabel(value: AdvancedChartConfig['aggregation']): string {
    return this.aggregationOptions.find(option => option.value === value)?.label ?? 'Select';
  }
  rendererLabel(value: string): string {
    return this.renderers.find(renderer => renderer.id === value)?.label ?? 'Select';
  }
  roleLabel(role: string): string {
    const visualRole = this.visualRoles.find(entry => entry.key === role);
    if (visualRole) return visualRole.required ? visualRole.label : `${visualRole.label} (optional)`;
    if (this.type === 'wellmap') {
      const wellMap: Record<string, string> = { category: 'Marker Label (e.g. Well)', x: 'X — Easting / Longitude', y: 'Y — Northing / Latitude' };
      if (wellMap[role]) return wellMap[role];
    }
    return this.labels[role] || role.charAt(0).toUpperCase() + role.slice(1);
  }
  /** Marker size needs numbers. */
  get sizeColumns(): string[] { return this.numericColumns ?? this.columns; }
  get roles(): string[] { return isAdvancedChart(this.type) ? advancedFieldRoles(this.type, this.config) : []; }
  /** Roles of the selected custom visual when it needs more than one category and one value. */
  get visualRoles() { return multiRoleVisualRoles(this.type, this.config); }
  /** Label of the multi-role visual's list role (several dimensions or measures), if it has one. */
  multiRoleLabel(type: 'dimension' | 'measure'): string {
    return this.visualRoles.find(role => role.allowMultiple && (role.type === 'measure') === (type === 'measure'))?.label ?? '';
  }
  get needsDimensions(): boolean { return ['pivottable', 'matrix', 'decompositiontree', 'keyinfluencers'].includes(this.type ?? '') || !!this.multiRoleLabel('dimension'); }
  get needsMeasures(): boolean { return ['pivottable', 'matrix', 'stackedarea100'].includes(this.type ?? '') || !!this.multiRoleLabel('measure'); }
  get hasAggregation(): boolean { return ['pivottable', 'matrix', 'stackedarea100', 'decompositiontree', 'filledmap', 'geochart', 'combomap', 'customvisual'].includes(this.type ?? ''); }
  /** The Value role needs numbers unless the aggregation counts rows. */
  textOnly(role: string, column: string): boolean {
    const measureRole = role === 'value' || this.visualRoles.some(entry => entry.key === role && entry.type === 'measure');
    if (!measureRole || !column || !this.numericColumns || !this.hasAggregation) return false;
    return this.config.aggregation !== 'count' && !this.numericColumns.includes(column);
  }
  /** Blocks picking the same column for two different roles (e.g. Category vs Value) on the same chart. */
  usedByOtherRole(role: string, column: string): boolean {
    if (!column) return false;
    return this.roles.some(otherRole => otherRole !== role && this.config.fields[otherRole] === column);
  }
  setField(role: string, value: string): void { this.change({ fields: { ...this.config.fields, [role]: value } }); }
  selectRoleColumn(role: string, column: string): void { this.setField(role, column); this.openDropdown = null; }
  selectAggregation(value: AdvancedChartConfig['aggregation']): void { this.change({ aggregation: value }); this.openDropdown = null; }
  selectCoordinateSystem(value: string): void { this.changeMap({ coordinates: value as WellMapConfig['coordinates'] }); this.openDropdown = null; }
  selectMarkerSize(value: string): void { this.changeMap({ size: value }); this.openDropdown = null; }
  selectMarkerColor(value: string): void { this.changeMap({ color: value }); this.openDropdown = null; }
  selectBackground(value: string): void { this.changeMap({ background: value as WellMapConfig['background'] }); this.openDropdown = null; }
  selectRenderer(value: string): void { this.change({ customRenderer: value }); this.openDropdown = null; }
  toggle(kind: 'dimensions' | 'measures', column: string): void {
    this.change({ [kind]: this.config[kind].includes(column) ? this.config[kind].filter(item => item !== column) : [...this.config[kind], column] });
  }
  changeMap(update: Partial<WellMapConfig>): void { this.change({ map: { ...this.config.map, ...update } }); }
  toggleTooltip(column: string): void {
    const tooltip = this.config.map.tooltip;
    this.changeMap({ tooltip: tooltip.includes(column) ? tooltip.filter(item => item !== column) : [...tooltip, column] });
  }
  change(update: Partial<AdvancedChartConfig>): void { if (!this.disabled) this.configChange.emit({ ...this.config, ...update }); }
}