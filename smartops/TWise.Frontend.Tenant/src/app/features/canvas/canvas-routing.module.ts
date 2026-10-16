import { NgModule, inject } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CanvasListComponent } from './canvas-list/canvas-list.component';
import { CanvasEditorComponent } from './canvas-editor/canvas-editor.component';
import { permissionGuard } from '../../core/guards/permission.guard';
import { PermissionService } from '../../core/services/permission.service';

// The parent route in app.routes.ts lets in users who may view either list. Standard lists published
// canvases (dashboard.standard-canvases), WIP lists the user's own drafts (dashboard.canvas).
// fullBleed: the shell gives the editor the whole content area, with no padding or footer (MainLayoutComponent).
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: () => inject(PermissionService).canView('dashboard.canvas') ? 'wip' : 'standard' },
  { path: 'standard', component: CanvasListComponent, canActivate: [permissionGuard], data: { permission: 'dashboard.standard-canvases', mode: 'standard' } },
  { path: 'wip', component: CanvasListComponent, canActivate: [permissionGuard], data: { permission: 'dashboard.canvas', mode: 'wip' } },
  { path: ':id', component: CanvasEditorComponent, data: { fullBleed: true } },
];

@NgModule({ imports: [RouterModule.forChild(routes)], exports: [RouterModule] })
export class CanvasRoutingModule {}
