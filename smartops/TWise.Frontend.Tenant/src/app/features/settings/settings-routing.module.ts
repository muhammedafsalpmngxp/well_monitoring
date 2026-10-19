import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SettingsComponent } from './settings.component';
import { DatabaseViewComponent } from './database-view/database-view.component';
import { DatabaseViewBuilderComponent } from './database-view-builder/database-view-builder.component';
import { DatabaseViewDetailComponent } from './database-view-detail/database-view-detail.component';
import { DataSyncComponent } from './data-sync/data-sync.component';
import { AiSettingsComponent } from './ai-settings/ai-settings.component';
import { AiActivityComponent } from './ai-activity/ai-activity.component';
import { AiRelationsComponent } from './ai-relations/ai-relations.component';
import { AiPromptsComponent } from './ai-prompts/ai-prompts.component';
import { AiConfigurationComponent } from './ai-configuration/ai-configuration.component';
import { DataSourcesComponent } from './data-sources/data-sources.component';
import { MarketplaceComponent } from './marketplace/marketplace.component';
import { PowerBiComponent } from './power-bi/power-bi.component';
import { LearnVideosComponent } from './learn-videos/learn-videos.component';
import { DaxModelComponent } from './dax-model/dax-model.component';
import { permissionGuard } from '../../core/guards/permission.guard';
import { adminGuard } from '../../core/guards/admin.guard';

const routes: Routes = [
  { path: '',                      redirectTo: 'database-view', pathMatch: 'full' },
  { path: 'settings',              component: SettingsComponent, canActivate: [permissionGuard], data: { permission: 'settings.general' } },
  { path: 'database-view',         component: DatabaseViewComponent, canActivate: [permissionGuard], data: { permission: 'settings.database-view' } },
  { path: 'database-view/builder', component: DatabaseViewBuilderComponent, canActivate: [permissionGuard], runGuardsAndResolvers: 'always', data: { permission: 'settings.database-view', permissionAction: 'build' } },
  { path: 'database-view/:id',     component: DatabaseViewDetailComponent, canActivate: [permissionGuard], data: { permission: 'settings.database-view' } },
  { path: 'data-sync',             component: DataSyncComponent, canActivate: [permissionGuard], data: { permission: 'settings.data-sync' } },
  { path: 'ai',                    redirectTo: 'ai/providers', pathMatch: 'full' },
  { path: 'ai/providers',          component: AiSettingsComponent, canActivate: [permissionGuard], data: { permission: 'settings.ai', section: 'providers' } },
  { path: 'ai/features',           component: AiSettingsComponent, canActivate: [permissionGuard], data: { permission: 'settings.ai', section: 'features' } },
  // How the AI works for the tenant (Ask Data: what it may read, its limits): admins only (the API checks too).
  { path: 'ai/settings',           component: AiConfigurationComponent, canActivate: [permissionGuard, adminGuard], data: { permission: 'settings.ai' } },
  // Every AI prompt of the tenant (database), with version history: admins only (the API checks too).
  { path: 'ai/prompts',            component: AiPromptsComponent, canActivate: [permissionGuard, adminGuard], data: { permission: 'settings.ai' } },
  { path: 'ai/activity',           component: AiActivityComponent, canActivate: [permissionGuard], data: { permission: 'settings.ai' } },
  { path: 'ai/relations',          component: AiRelationsComponent, canActivate: [permissionGuard], data: { permission: 'settings.ai' } },
  { path: 'data-sources',          component: DataSourcesComponent, canActivate: [permissionGuard], data: { permission: 'settings.data-sources' } },
  { path: 'marketplace',           component: MarketplaceComponent, canActivate: [permissionGuard], data: { permission: 'settings.marketplace' } },
  { path: 'power-bi',              component: PowerBiComponent, canActivate: [permissionGuard], data: { permission: 'settings.power-bi' } },
  { path: 'learn-videos',          component: LearnVideosComponent, canActivate: [permissionGuard], data: { permission: 'settings.learn-videos' } },
  { path: 'dax-model',             component: DaxModelComponent, canActivate: [permissionGuard], data: { permission: 'settings.dax-model' } },
];

@NgModule({ imports: [RouterModule.forChild(routes)], exports: [RouterModule] })
export class SettingsRoutingModule {}
