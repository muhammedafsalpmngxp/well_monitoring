import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import { AdvancedChartComponent } from './components/advanced-chart/advanced-chart.component';
import { AdvancedChartMappingComponent } from './components/advanced-chart/advanced-chart-mapping.component';

import { ButtonComponent } from './components/button/button.component';
import { ChartTableComponent } from './components/chart-table/chart-table.component';
import { CardComponent } from './components/card/card.component';
import { LoaderComponent } from './components/loader/loader.component';
import { TileIconComponent } from './components/tile-icon/tile-icon.component';
import { EmptyStateComponent } from './components/empty-state/empty-state.component';
import { ChartNoDataComponent } from './components/chart-no-data/chart-no-data.component';
import { ItemCardComponent } from './components/item-card/item-card.component';
import { PageHeaderComponent } from './components/page-header/page-header.component';
import { ConfirmationDialogComponent } from './components/confirmation-dialog/confirmation-dialog.component';
import { VersionHistoryDialogComponent } from './components/version-history/version-history-dialog.component';
import { ReliabilityDetailsDialogComponent } from './components/reliability-details/reliability-details-dialog.component';
import { CategoryManagerComponent } from './components/category-manager/category-manager.component';
import { CategorySearchComponent } from './components/category-manager/category-search.component';
import { DaxMetricSelectComponent } from './components/dax-metric-select/dax-metric-select.component';
import { MultiSelectComponent } from './components/multi-select/multi-select.component';
import { AdvancedFilterComponent } from './components/advanced-filter/advanced-filter.component';
import { DateInputComponent } from './components/date-input/date-input.component';
import { DateRangePopupComponent } from './components/date-range-popup/date-range-popup.component';
import { IconComponent } from './components/icon/icon.component';
import { CategoryNameCellRendererComponent } from './components/category-manager/cell-renderers/category-name-cell-renderer.component';
import { CategoryDashboardCellRendererComponent } from './components/category-manager/cell-renderers/category-dashboard-cell-renderer.component';
import { CategoryActionsCellRendererComponent } from './components/category-manager/cell-renderers/category-actions-cell-renderer.component';
import { TruncatePipe } from './pipes/truncate.pipe';
import { DateFormatPipe } from './pipes/date-format.pipe';
import { PieChartEmptyPipe } from './pipes/pie-chart-empty.pipe';
import { ClickOutsideDirective } from './directives/click-outside.directive';
import { HasRoleDirective } from './directives/has-role.directive';
import { LazyVisibleDirective } from './directives/lazy-visible.directive';
import { ScrollPositionPersistDirective } from './directives/scroll-position-persist.directive';
import { A11yDialogDirective } from './directives/a11y-dialog.directive';
import { KeyClickDirective } from './directives/key-click.directive';
import { LegendPagerDirective } from './directives/legend-pager.directive';
import { FloatingMenuDirective } from './directives/floating-menu.directive';
import { FieldLabelDirective } from './directives/field-label.directive';
import { GlobalFilterOptionDirective } from './directives/global-filter-option.directive';
import { TileTooltipDirective } from './directives/tile-tooltip.directive';

const SHARED_COMPONENTS = [
  ChartTableComponent,
  ButtonComponent,
  CardComponent,
  LoaderComponent,
  TileIconComponent,
  EmptyStateComponent,
  ChartNoDataComponent,
  ItemCardComponent,
  PageHeaderComponent,
  ConfirmationDialogComponent,
  VersionHistoryDialogComponent,
  ReliabilityDetailsDialogComponent,
  CategoryManagerComponent,
  MultiSelectComponent,
  AdvancedFilterComponent,
  DateInputComponent,
  DateRangePopupComponent,
];

const SHARED_PIPES = [TruncatePipe, DateFormatPipe, PieChartEmptyPipe];

const SHARED_DIRECTIVES = [ClickOutsideDirective, HasRoleDirective, LazyVisibleDirective, ScrollPositionPersistDirective];

@NgModule({
  declarations: [
    ...SHARED_COMPONENTS,
    ...SHARED_PIPES,
    ...SHARED_DIRECTIVES,
  ],
  imports: [CommonModule, ReactiveFormsModule, FormsModule, RouterModule, IconComponent,
    AdvancedChartComponent,
    AdvancedChartMappingComponent,
    CategorySearchComponent,
    DaxMetricSelectComponent,
    AgGridAngular,
    CategoryNameCellRendererComponent,
    CategoryDashboardCellRendererComponent,
    CategoryActionsCellRendererComponent,
    A11yDialogDirective,
    KeyClickDirective,
    LegendPagerDirective,
    FloatingMenuDirective,
    FieldLabelDirective,
    GlobalFilterOptionDirective,
    TileTooltipDirective,
  ],
  exports: [
    CategorySearchComponent,
    DaxMetricSelectComponent,
    AdvancedChartComponent,
    AdvancedChartMappingComponent,
    // Angular modules re-exported for convenience
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule,
    // Shared items
    ...SHARED_COMPONENTS,
    ...SHARED_PIPES,
    ...SHARED_DIRECTIVES,
    A11yDialogDirective,
    KeyClickDirective,
    LegendPagerDirective,
    FloatingMenuDirective,
    FieldLabelDirective,
    GlobalFilterOptionDirective,
    TileTooltipDirective,
  ],
})
export class SharedModule {}
