import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { StandardChartsComponent } from './standard-charts/standard-charts.component';
import { WipChartsComponent } from './wip-charts/wip-charts.component';
import { WipTilesComponent } from './wip-tiles/wip-tiles.component';
import { ChartBuilderComponent } from './chart-builder/chart-builder.component';
import { TileBuilderComponent } from './tile-builder/tile-builder.component';
import { WidgetViewComponent } from './widget-view/widget-view.component';
import { ChartDrilldownComponent } from './chart-drilldown/chart-drilldown.component';
import { permissionGuard } from '../../core/guards/permission.guard';

const routes: Routes = [
  { path: '',                       redirectTo: 'standard-charts', pathMatch: 'full' },
  { path: 'standard-charts',        component: StandardChartsComponent, canActivate: [permissionGuard], data: { permission: 'charts.standard-charts' } },
  { path: 'wip-charts',             component: WipChartsComponent, canActivate: [permissionGuard], data: { permission: 'charts.wip-charts', mode: 'wip' } },
  { path: 'wip-tiles',              component: WipTilesComponent, canActivate: [permissionGuard], data: { permission: 'charts.wip-tiles', mode: 'wip' } },
  { path: 'standard-tiles',         component: WipTilesComponent, canActivate: [permissionGuard], data: { permission: 'charts.standard-tiles', mode: 'standard' } },
  { path: 'builder',                component: ChartBuilderComponent, canActivate: [permissionGuard], runGuardsAndResolvers: 'always', data: { permission: 'charts.wip-charts', permissionAction: 'build' } },
  { path: 'edit/:id',               component: ChartBuilderComponent, canActivate: [permissionGuard], runGuardsAndResolvers: 'always', data: { permission: 'charts.wip-charts', permissionAction: 'build' } },
  { path: 'tile-builder',           component: TileBuilderComponent, canActivate: [permissionGuard], runGuardsAndResolvers: 'always', data: { permission: 'charts.wip-tiles', permissionAction: 'build' } },
  { path: 'view/:id/drilldown',     component: ChartDrilldownComponent, canActivate: [permissionGuard], runGuardsAndResolvers: 'always', data: { permission: 'charts.standard-charts', permissionByContext: { wip: 'charts.wip-charts' } } },
  { path: 'view/:id',               component: WidgetViewComponent, canActivate: [permissionGuard], runGuardsAndResolvers: 'always', data: { permission: 'charts.standard-charts', permissionByContext: { wip: 'charts.wip-charts', 'tile-wip': 'charts.wip-tiles', 'tile-standard': 'charts.standard-tiles' } } },
  { path: 'odc-overall-status/:id', component: WidgetViewComponent, canActivate: [permissionGuard], data: { permission: 'charts.standard-charts' } },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ChartsTilesRoutingModule {}
