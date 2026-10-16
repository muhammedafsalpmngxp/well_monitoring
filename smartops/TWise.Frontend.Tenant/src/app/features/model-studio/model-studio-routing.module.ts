import { NgModule, inject } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DatasetListComponent } from './dataset-list/dataset-list.component';
import { StudioComponent } from './studio/studio.component';
import { permissionGuard } from '../../core/guards/permission.guard';
import { PermissionService } from '../../core/services/permission.service';

// The parent route in app.routes.ts lets in users who may view either list. Standard lists published
// datasets (model.standard-datasets), WIP lists datasets not yet published (model.studio).
// fullBleed: the shell gives the Studio the whole content area, with no padding or footer (MainLayoutComponent).
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: () => inject(PermissionService).canView('model.studio') ? 'wip' : 'standard' },
  { path: 'standard', component: DatasetListComponent, canActivate: [permissionGuard], data: { permission: 'model.standard-datasets', mode: 'standard' } },
  { path: 'wip', component: DatasetListComponent, canActivate: [permissionGuard], data: { permission: 'model.studio', mode: 'wip' } },
  { path: ':id', component: StudioComponent, data: { fullBleed: true } },
];

@NgModule({ imports: [RouterModule.forChild(routes)], exports: [RouterModule] })
export class ModelStudioRoutingModule {}
