import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type TourPlacement = 'right' | 'left' | 'bottom-left' | 'bottom-right';

export interface TourStep {
  id: string;
  title: string;
  description: string;
  details: string;
  /** CSS selector for the on-page element to spotlight; null for steps with no page target. */
  targetSelector: string | null;
  placement: TourPlacement;
  /** Route the app should navigate to before locating the target, if not already there. */
  route?: string;
}

export interface TourState {
  active: boolean;
  currentIndex: number;
  steps: TourStep[];
}

const TOUR_STEPS: TourStep[] = [
  {
    id: 'dashboard-library',
    title: 'Dashboard Library',
    description: 'Explore operational dashboards',
    details: 'Browse standard and work-in-progress dashboards, including operational boards and crew views. Dashboards bring key performance indicators and other operational insights together so you can quickly understand what is happening.',
    targetSelector: '[data-tour="tour-dashboard"]',
    placement: 'right',
  },
  {
    id: 'page-standard-boards',
    title: 'Standard Boards',
    description: 'Browse published dashboards',
    details: 'Explore published dashboards grouped for operational use. Open a board to review its KPIs, charts, and other configured insights.',
    targetSelector: '[data-tour-page="/dashboard/standard-boards"]',
    placement: 'right',
    route: '/dashboard/standard-boards',
  },
  {
    id: 'page-wip-boards',
    title: 'WIP Boards',
    description: 'Build and manage draft dashboards',
    details: 'Create and manage dashboards that are still in progress. Use this workspace to organize dashboard content before it is ready to be published.',
    targetSelector: '[data-tour-page="/dashboard/wip-boards"]',
    placement: 'right',
    route: '/dashboard/wip-boards',
  },
  {
    id: 'page-crew-calendar',
    title: 'Crew Calendar',
    description: 'Review crew plans and activity',
    details: 'View crew assignments and operational activity on a calendar timeline. Use the planning view to understand scheduled work and compare it with progress.',
    targetSelector: '[data-tour-page="/dashboard/crew-calendar"]',
    placement: 'right',
    route: '/dashboard/crew-calendar',
  },
  {
    id: 'charts-tiles',
    title: 'Charts & Tiles',
    description: 'Explore charts and tiles',
    details: 'Find published and work-in-progress charts and tiles, or build your own. Charts help reveal patterns and comparisons in your data, while tiles surface focused metrics and summaries for use in dashboards and other views.',
    targetSelector: '[data-tour="tour-charts-tiles"]',
    placement: 'right',
  },
  {
    id: 'page-standard-charts',
    title: 'Standard Charts',
    description: 'Explore published charts',
    details: 'Browse charts available for general use and open a chart to examine its visualized data and insights.',
    targetSelector: '[data-tour-page="/charts-tiles/standard-charts"]',
    placement: 'right',
    route: '/charts-tiles/standard-charts',
  },
  {
    id: 'page-wip-charts',
    title: 'WIP Charts',
    description: 'Create and manage chart drafts',
    details: 'Work on charts that are still being built. Create or update a chart, organize drafts, and prepare useful visualizations for publication.',
    targetSelector: '[data-tour-page="/charts-tiles/wip-charts"]',
    placement: 'right',
    route: '/charts-tiles/wip-charts',
  },
  {
    id: 'page-standard-tiles',
    title: 'Standard Tiles',
    description: 'Browse published metric tiles',
    details: 'Explore published tiles that present focused metrics and summaries. Tiles make key values easy to scan and reuse in operational views.',
    targetSelector: '[data-tour-page="/charts-tiles/standard-tiles"]',
    placement: 'right',
    route: '/charts-tiles/standard-tiles',
  },
  {
    id: 'page-wip-tiles',
    title: 'WIP Tiles',
    description: 'Create and manage tile drafts',
    details: 'Build and manage tiles that are in progress. Use this area to prepare focused metric summaries before they are made available as standard tiles.',
    targetSelector: '[data-tour-page="/charts-tiles/wip-tiles"]',
    placement: 'right',
    route: '/charts-tiles/wip-tiles',
  },
  {
    id: 'reports',
    title: 'Reports',
    description: 'Explore and create reports',
    details: 'Open standard reports or create and manage your own reports. Reports present detailed information in a structured format that can be reviewed and shared with the people who need it.',
    targetSelector: '[data-tour="tour-reports"]',
    placement: 'right',
  },
  {
    id: 'page-standard-reports',
    title: 'Standard Reports',
    description: 'View published reports',
    details: 'Browse reports published for users across the organization. Open a report to review its detailed information and findings.',
    targetSelector: '[data-tour-page="/reports/standard-reports"]',
    placement: 'right',
    route: '/reports/standard-reports',
  },
  {
    id: 'page-wip-reports',
    title: 'WIP Reports',
    description: 'Create and manage report drafts',
    details: 'Create and maintain reports that are still in progress. Build a report around the information your audience needs, then prepare it for publishing.',
    targetSelector: '[data-tour-page="/reports/my-reports"]',
    placement: 'right',
    route: '/reports/my-reports',
  },
  {
    id: 'data-quality',
    title: 'Data Quality',
    description: 'Review and improve data quality',
    details: 'Inspect data quality issues in the error log, define validation rules, and consult the data dictionary. Available quality tools also include self-healing AI to help address data issues.',
    targetSelector: '[data-tour="tour-data-quality"]',
    placement: 'right',
  },
  {
    id: 'page-error-log-rules',
    title: 'Error Log & Rules',
    description: 'Review data issues and validation rules',
    details: 'Review logged data-quality errors and manage rules that validate incoming or stored data. Use this page to investigate issues and keep quality checks consistent.',
    targetSelector: '[data-tour-page="/data-quality/error-log-rules"]',
    placement: 'right',
    route: '/data-quality/error-log-rules',
  },
  {
    id: 'user-role-management',
    title: 'User & Role Management',
    description: 'Manage users, roles, and permissions',
    details: 'Manage user accounts and organize access through roles and permissions. This helps administrators control which parts of the product each user can access.',
    targetSelector: '[data-tour="tour-user-role-management"]',
    placement: 'right',
  },
  {
    id: 'page-users',
    title: 'User',
    description: 'Manage product user accounts',
    details: 'View and manage user accounts. Administrators can maintain the people who have access to the product and support their account lifecycle.',
    targetSelector: '[data-tour-page="/user-role-management/users"]',
    placement: 'right',
    route: '/user-role-management/users',
  },
  {
    id: 'page-roles-permissions',
    title: 'Roles & Permissions',
    description: 'Control access by role',
    details: 'Create and maintain roles and their permissions. Assigning permissions by role helps provide users with access appropriate to their responsibilities.',
    targetSelector: '[data-tour-page="/user-role-management/roles-permissions"]',
    placement: 'right',
    route: '/user-role-management/roles-permissions',
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Configure data and product options',
    details: 'Manage data sources, database views, and data synchronization, along with other available configuration areas such as the visual marketplace and data model settings.',
    targetSelector: '[data-tour="tour-settings"]',
    placement: 'right',
  },
  {
    id: 'page-database-view',
    title: 'Database View',
    description: 'Browse configured database views',
    details: 'Review database views configured for the product. Views provide structured access to selected data for downstream analysis and reporting.',
    targetSelector: '[data-tour-page="/settings/database-view"]',
    placement: 'right',
    route: '/settings/database-view',
  },
  {
    id: 'page-data-sources',
    title: 'Data Sources',
    description: 'Manage connected data sources',
    details: 'Review and manage the data sources that provide information to the product and its analytics.',
    targetSelector: '[data-tour-page="/settings/data-sources"]',
    placement: 'right',
    route: '/settings/data-sources',
  },
  {
    id: 'page-data-sync',
    title: 'Data Sync',
    description: 'Configure and monitor synchronization',
    details: 'Manage data synchronization settings and review the processes used to keep product data up to date.',
    targetSelector: '[data-tour-page="/settings/data-sync"]',
    placement: 'right',
    route: '/settings/data-sync',
  },
  {
    id: 'page-visual-marketplace',
    title: 'Visual Marketplace',
    description: 'Explore available visual components',
    details: 'Browse visual components made available to enhance dashboards and data presentations.',
    targetSelector: '[data-tour-page="/settings/marketplace"]',
    placement: 'right',
    route: '/settings/marketplace',
  },
  {
    id: 'page-learn-videos',
    title: 'Learn Videos',
    description: 'Access product learning resources',
    details: 'Find video resources that introduce product features and help users learn common workflows.',
    targetSelector: '[data-tour-page="/settings/learn-videos"]',
    placement: 'right',
    route: '/settings/learn-videos',
  },
  {
    id: 'page-dax-model',
    title: 'Dax Model',
    description: 'Work with DAX model configuration',
    details: 'Access the DAX model area for working with the product’s analytical model and its calculations.',
    targetSelector: '[data-tour-page="/settings/dax-model"]',
    placement: 'right',
    route: '/settings/dax-model',
  },
  {
    id: 'bi-canvas',
    title: 'BI Canvas',
    description: 'Build visual canvas workspaces',
    details: 'Use a canvas to arrange multiple data visuals in one custom workspace. Browse published canvases or work on drafts, then combine visual elements into a single view tailored to an operational question.',
    targetSelector: '[data-tour="tour-bi-canvas"]',
    placement: 'right',
  },
  {
    id: 'page-standard-canvases',
    title: 'Standard Canvases',
    description: 'Browse published BI canvases',
    details: 'Open published canvases that bring multiple visualizations together in a single interactive workspace.',
    targetSelector: '[data-tour-page="/canvas/standard"]',
    placement: 'right',
    route: '/canvas/standard',
  },
  {
    id: 'page-wip-canvases',
    title: 'WIP Canvases',
    description: 'Build and manage canvas drafts',
    details: 'Create and edit canvases that are still in progress. Arrange visualizations into a custom workspace before publishing.',
    targetSelector: '[data-tour-page="/canvas/wip"]',
    placement: 'right',
    route: '/canvas/wip',
  },
  {
    id: 'model-studio',
    title: 'Model Studio',
    description: 'Create and manage data models',
    details: 'Browse published data models and work-in-progress datasets, or create and manage models in the studio. Models organize the data that dashboards, charts, and reports rely on.',
    targetSelector: '[data-tour="tour-model-studio"]',
    placement: 'right',
  },
  {
    id: 'page-standard-data-models',
    title: 'Standard Data Models',
    description: 'Browse published data models',
    details: 'Explore published data models available to build dashboards, charts, tiles, and reports.',
    targetSelector: '[data-tour-page="/model-studio/standard"]',
    placement: 'right',
    route: '/model-studio/standard',
  },
  {
    id: 'page-wip-data-models',
    title: 'WIP Data Models',
    description: 'Create and manage model drafts',
    details: 'Create and maintain data models that are still in progress, then prepare them for publishing and use across analytics.',
    targetSelector: '[data-tour-page="/model-studio/wip"]',
    placement: 'right',
    route: '/model-studio/wip',
  },
  {
    id: 'smart-alerts',
    title: 'Smart Alerts',
    description: 'Configure alerts and schedules',
    details: 'Configure alert rules and review generated alerts. The module also includes schedules and a delivery log, so you can manage when notifications are sent and review their delivery history.',
    targetSelector: '[data-tour="tour-smart-alerts"]',
    placement: 'right',
  },
  {
    id: 'page-alerts',
    title: 'Alerts',
    description: 'Review triggered alerts',
    details: 'Review alerts raised by configured rules and follow up on conditions that need attention.',
    targetSelector: '[data-tour-page="/smart-alerts/alerts"]',
    placement: 'right',
    route: '/smart-alerts/alerts',
  },
  {
    id: 'page-alert-rule-configuration',
    title: 'Alert Rule Configuration',
    description: 'Define conditions for alerts',
    details: 'Create and manage rules that evaluate data and determine when an alert should be generated.',
    targetSelector: '[data-tour-page="/smart-alerts/alert-rule-configuration"]',
    placement: 'right',
    route: '/smart-alerts/alert-rule-configuration',
  },
  {
    id: 'page-schedules',
    title: 'Schedules',
    description: 'Manage scheduled notifications',
    details: 'Set up and maintain schedules for automated report or alert delivery.',
    targetSelector: '[data-tour-page="/smart-alerts/schedules"]',
    placement: 'right',
    route: '/smart-alerts/schedules',
  },
  {
    id: 'page-delivery-log',
    title: 'Delivery Log',
    description: 'Review notification delivery history',
    details: 'Check the delivery history to see how scheduled notifications were processed and whether they reached their intended recipients.',
    targetSelector: '[data-tour-page="/smart-alerts/delivery-log"]',
    placement: 'right',
    route: '/smart-alerts/delivery-log',
  },
  {
    id: 'ai-assistant',
    title: 'Agentic AI',
    description: 'Manage AI agents and their activity',
    details: 'Create and manage AI agents that can help answer questions about your data and surface insights. Use the activity log to review agent activity.',
    targetSelector: '[data-tour="tour-ai-assistant"]',
    placement: 'right',
  },
  {
    id: 'page-ai-agents',
    title: 'AI Agents',
    description: 'Create and manage AI agents',
    details: 'Create and configure agents to assist with data-related questions and tasks, then manage the agents available to your team.',
    targetSelector: '[data-tour-page="/agentic-ai/ai-agents"]',
    placement: 'right',
    route: '/agentic-ai/ai-agents',
  },
  {
    id: 'page-ai-activity-log',
    title: 'Activity Log',
    description: 'Review AI agent activity',
    details: 'Review recorded activity from AI agents to understand what they have done and help monitor their use.',
    targetSelector: '[data-tour-page="/agentic-ai/activity-log"]',
    placement: 'right',
    route: '/agentic-ai/activity-log',
  },
  {
    id: 'ai-settings',
    title: 'AI Settings',
    description: 'Configure AI providers, features, Ask Data and prompts, and review AI activity',
    details: 'Set up AI providers and limits, choose which AI features are on, adjust Ask Data and prompts, and review AI usage.',
    targetSelector: '[data-tour="tour-ai-settings"]',
    placement: 'right',
  },
  {
    id: 'create-dashboard',
    title: 'Create New Dashboard',
    description: 'Start a custom dashboard',
    details: 'Use this action to start building a dashboard for the KPIs and operational information that matter to your team.',
    targetSelector: '[data-tour="tour-new-dashboard"]',
    placement: 'left',
    route: '/dashboard/wip-boards',
  },
  {
    id: 'filters',
    title: 'Filters & View Options',
    description: 'Find dashboards with available filters',
    details: 'Use the board list filters and view options to narrow the dashboards shown and find the board you want to work with.',
    targetSelector: '[data-tour="tour-filters"]',
    placement: 'left',
    route: '/dashboard/wip-boards',
  },
  {
    id: 'manage',
    title: 'Manage & Customize',
    description: 'Organize dashboard categories',
    details: 'Use the category management controls to organize dashboards and customize the available board categories.',
    targetSelector: '[data-tour="tour-manage-category"]',
    placement: 'left',
    route: '/dashboard/wip-boards',
  },
  {
    id: 'done',
    title: "You're All Set",
    description: 'Get the most out of T-Wise',
    details: 'You have reached the end of the tour. Use the navigation menu to revisit any module whenever you need it.',
    targetSelector: null,
    placement: 'right',
  },
];

@Injectable({ providedIn: 'root' })
export class ProductTourService {
  private readonly stateSubject = new BehaviorSubject<TourState>({
    active: false,
    currentIndex: 0,
    steps: TOUR_STEPS,
  });

  readonly state$ = this.stateSubject.asObservable();

  get snapshot(): TourState {
    return this.stateSubject.value;
  }

  start(availableTargets?: string[], pageTitles: Record<string, string> = {}): void {
    const availableSteps = availableTargets
      ? TOUR_STEPS.filter(step => !step.targetSelector || availableTargets.includes(step.targetSelector))
      : TOUR_STEPS;
    const steps = availableSteps.map(step =>
      step.route && pageTitles[step.route] ? { ...step, title: pageTitles[step.route] } : step,
    );
    this.stateSubject.next({ active: true, currentIndex: 0, steps });
  }

  next(): void {
    const state = this.snapshot;
    if (state.currentIndex >= state.steps.length - 1) {
      this.end();
      return;
    }
    this.stateSubject.next({ ...state, currentIndex: state.currentIndex + 1 });
  }

  skip(): void {
    this.end();
  }

  private end(): void {
    this.stateSubject.next({ ...this.snapshot, active: false, currentIndex: 0 });
  }
}
