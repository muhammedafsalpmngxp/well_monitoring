import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { noAuthGuard } from './core/guards/no-auth.guard';
import { permissionGuard } from './core/guards/permission.guard';
import { askAiAnswerLinkGuard } from './core/guards/ask-ai-answer-link.guard';
import { MainLayoutComponent } from './layouts/main-layout/main-layout.component';
import { AuthLayoutComponent } from './layouts/auth-layout/auth-layout.component';
import { ROUTES } from './core/constants/route.constants';

export const routes: Routes = [
  { path: '', redirectTo: ROUTES.DASHBOARD, pathMatch: 'full' },
  {
    path: 'shared-dashboard',
    loadChildren: () => import('./features/dashboard/dashboard.module').then(m => m.DashboardModule),
  },
  {
    path: ROUTES.AUTH.ROOT,
    component: AuthLayoutComponent,
    canActivate: [noAuthGuard],
    loadChildren: () => import('./auth/auth.module').then(m => m.AuthModule),
  },
  {
    path: '',
    component: MainLayoutComponent,
    canActivate: [authGuard],
    children: [
      // A scheduled insight mail's link: opens the Ask AI panel on that answer, over the dashboard.
      { path: 'ask-ai/answers/:id', canActivate: [askAiAnswerLinkGuard], children: [] },
      {
        path: ROUTES.DASHBOARD,
        data: { preloadWhenIdle: true },
        loadChildren: () => import('./features/dashboard/dashboard.module').then(m => m.DashboardModule),
      },
      {
        path: ROUTES.CHARTS_TILES,
        loadChildren: () => import('./features/charts-tiles/charts-tiles.module').then(m => m.ChartsTilesModule),
      },
      {
        path: ROUTES.REPORTS,
        loadChildren: () => import('./features/reports/reports.module').then(m => m.ReportsModule),
      },
      {
        path: ROUTES.SMART_ALERTS,
        loadChildren: () => import('./features/smart-alerts/smart-alerts.module').then(m => m.SmartAlertsModule),
      },
      {
        path: ROUTES.DATA_QUALITY,
        loadChildren: () => import('./features/data-quality/data-quality.module').then(m => m.DataQualityModule),
      },
      {
        path: ROUTES.AGENTIC_AI,
        loadChildren: () => import('./features/agentic-ai/agentic-ai.module').then(m => m.AgenticAiModule),
      },
      {
        path: ROUTES.USER_ROLE_MANAGEMENT,
        canActivate: [permissionGuard],
        data: { permission: ['user-management.users', 'user-management.roles'] },
        loadChildren: () => import('./features/user-role-management/user-role-management.module').then(m => m.UserRoleManagementModule),
      },
      {
        path: ROUTES.SETTINGS,
        loadChildren: () => import('./features/settings/settings.module').then(m => m.SettingsModule),
      },
      {
        path: ROUTES.MODEL_STUDIO,
        canActivate: [permissionGuard],
        data: { permission: ['model.studio', 'model.standard-datasets'] },
        loadChildren: () => import('./features/model-studio/model-studio.module').then(m => m.ModelStudioModule),
      },
      {
        path: ROUTES.CANVAS,
        canActivate: [permissionGuard],
        data: { permission: ['dashboard.canvas', 'dashboard.standard-canvases'] },
        loadChildren: () => import('./features/canvas/canvas.module').then(m => m.CanvasModule),
      },
    ],
  },
  { path: '**', redirectTo: ROUTES.DASHBOARD },
];
