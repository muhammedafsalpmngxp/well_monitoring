import { MenuGroup } from '../models/menu.model';
import { ROUTES } from './route.constants';

export const MENU_STRUCTURE: MenuGroup[] = [
  {
    label: 'OPERATIONS',
    items: [
      {
        label: 'Dashboard',
        icon: 'dashboard',
        children: [
          { label: 'Standard Boards', icon: 'standard_boards', route: `/${ROUTES.DASHBOARD}/standard-boards`, moduleCode: 'dashboard.standard-boards' },
          { label: 'WIP Boards',      icon: 'my_boards',       route: `/${ROUTES.DASHBOARD}/wip-boards`,      moduleCode: 'dashboard.wip-boards' },
          { label: 'Crew Calendar',   icon: 'view_column',     route: `/${ROUTES.DASHBOARD}/crew-calendar`,   moduleCode: 'dashboard.standard-boards' },
        ],
      },
      {
        label: 'Charts & Tiles',
        icon: 'bar_chart',
        children: [
          { label: 'Standard Charts', icon: 'grid_view',   route: `/${ROUTES.CHARTS_TILES}/standard-charts`, moduleCode: 'charts.standard-charts' },
          { label: 'WIP Charts',      icon: 'view_column', route: `/${ROUTES.CHARTS_TILES}/wip-charts`,      moduleCode: 'charts.wip-charts' },
          { label: 'Standard Tiles',  icon: 'grid_view',   route: `/${ROUTES.CHARTS_TILES}/standard-tiles`,  moduleCode: 'charts.standard-tiles' },
          { label: 'WIP Tiles',       icon: 'view_column', route: `/${ROUTES.CHARTS_TILES}/wip-tiles`,       moduleCode: 'charts.wip-tiles' },
        ],
      },
      {
        label: 'Reports',
        icon: 'description',
        children: [
          { label: 'Standard Reports', icon: 'grid_view',   route: `/${ROUTES.REPORTS}/standard-reports`, moduleCode: 'reports.standard-reports' },
          { label: 'WIP Reports',      icon: 'view_column', route: `/${ROUTES.REPORTS}/my-reports`,       moduleCode: 'reports.my-reports' },
        ],
      },
      {
        label: 'Data Quality',
        icon: 'shield',
        children: [
          { label: 'Error Log & Rules', icon: 'database_view', route: `/${ROUTES.DATA_QUALITY}/error-log-rules`,   moduleCode: 'data-quality.error-log' },
          { label: 'Self-Healing AI',   icon: 'database_view', route: `/${ROUTES.DATA_QUALITY}/self-healing-ai`,   moduleCode: 'data-quality.self-healing', hidden: true },
          { label: 'Data Dictionary',   icon: 'database_view', route: `/${ROUTES.DATA_QUALITY}/data-dictionary`,   moduleCode: 'data-quality.data-dictionary' },
          { label: 'Data Lineage',      icon: 'database_view', route: `/${ROUTES.DATA_QUALITY}/lineage`,           moduleCode: 'data-quality.lineage' },
        ],
      },
      {
        label: 'User & Role Management',
        icon: 'manage_accounts',
        children: [
          { label: 'User',                icon: 'user',              route: `/${ROUTES.USER_ROLE_MANAGEMENT}/users`,             moduleCode: 'user-management.users' },
          { label: 'Roles & Permissions', icon: 'roles_permissions', route: `/${ROUTES.USER_ROLE_MANAGEMENT}/roles-permissions`, moduleCode: 'user-management.roles' },
        ],
      },
      {
        label: 'Settings',
        icon: 'settings',
        children: [
          { label: 'Database View', icon: 'database_view', route: `/${ROUTES.SETTINGS}/database-view`, moduleCode: 'settings.database-view' },
          { label: 'Data Sources', icon: 'database_view', route: `/${ROUTES.SETTINGS}/data-sources`, moduleCode: 'settings.data-sources' },
          { label: 'Data Sync', icon: 'database_view', route: `/${ROUTES.SETTINGS}/data-sync`, moduleCode: 'settings.data-sync' },
          { label: 'AI Providers', icon: 'auto_awesome', route: `/${ROUTES.SETTINGS}/ai/providers`, moduleCode: 'settings.ai' },
          { label: 'AI Features', icon: 'auto_awesome', route: `/${ROUTES.SETTINGS}/ai/features`, moduleCode: 'settings.ai' },
          { label: 'AI Prompts', icon: 'auto_awesome', route: `/${ROUTES.SETTINGS}/ai/prompts`, moduleCode: 'settings.ai', adminOnly: true },
          { label: 'AI Activity', icon: 'auto_awesome', route: `/${ROUTES.SETTINGS}/ai/activity`, moduleCode: 'settings.ai' },
          { label: 'AI Relationships', icon: 'auto_awesome', route: `/${ROUTES.SETTINGS}/ai/relations`, moduleCode: 'settings.ai' },
          { label: 'Visual Marketplace', icon: 'database_view', route: `/${ROUTES.SETTINGS}/marketplace`, moduleCode: 'settings.marketplace' },
          // Power BI hidden for now; may be enabled later.
          // { label: 'Power BI', icon: 'database_view', route: `/${ROUTES.SETTINGS}/power-bi`, moduleCode: 'settings.power-bi' },
          { label: 'Learn Videos', icon: 'database_view', route: `/${ROUTES.SETTINGS}/learn-videos`, moduleCode: 'settings.learn-videos' },
          { label: 'Dax Model', icon: 'measure', route: `/${ROUTES.SETTINGS}/dax-model`, moduleCode: 'settings.dax-model' },
        ],
      },
      {
        label: 'BI Canvas',
        icon: 'bi_canvas',
        children: [
          { label: 'Standard Canvases', icon: 'grid_view',   route: `/${ROUTES.CANVAS}/standard`, moduleCode: 'dashboard.standard-canvases' },
          { label: 'WIP Canvases',      icon: 'view_column', route: `/${ROUTES.CANVAS}/wip`,      moduleCode: 'dashboard.canvas' },
        ],
      },
      {
        label: 'Model Studio',
        icon: 'model_studio',
        children: [
          { label: 'Standard Data Models', icon: 'grid_view',   route: `/${ROUTES.MODEL_STUDIO}/standard`, moduleCode: 'model.standard-datasets' },
          { label: 'WIP Data Models',      icon: 'view_column', route: `/${ROUTES.MODEL_STUDIO}/wip`,      moduleCode: 'model.studio' },
        ],
      },
      {
        label: 'Smart Alerts',
        icon: 'notifications',
        badge: 'BETA',
        children: [
          { label: 'Alerts',                   icon: 'database_view', route: `/${ROUTES.SMART_ALERTS}/alerts`,                   moduleCode: 'smart-alerts.alerts' },
          { label: 'Alert Rule Configuration', icon: 'database_view', route: `/${ROUTES.SMART_ALERTS}/alert-rule-configuration`, moduleCode: 'smart-alerts.rule-config' },
          { label: 'Schedules',                icon: 'calendar',      route: `/${ROUTES.SMART_ALERTS}/schedules`,                moduleCode: 'smart-alerts.schedules' },
          { label: 'Delivery Log',             icon: 'description',   route: `/${ROUTES.SMART_ALERTS}/delivery-log`,             moduleCode: 'smart-alerts.schedules' },
        ],
      },
      
      {
        label: 'Agentic AI',
        icon: 'auto_awesome',
        badge: 'BETA',
        children: [
          { label: 'AI Agents',    icon: 'database_view', route: `/${ROUTES.AGENTIC_AI}/ai-agents`,    moduleCode: 'agentic-ai.agents' },
          { label: 'Activity Log', icon: 'database_view', route: `/${ROUTES.AGENTIC_AI}/activity-log`, moduleCode: 'agentic-ai.activity-log' },
        ],
      },
    ],
  },
];
