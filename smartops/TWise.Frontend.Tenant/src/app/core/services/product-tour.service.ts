import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type TourPlacement = 'right' | 'left' | 'bottom-left' | 'bottom-right';

export interface TourStep {
  id: string;
  title: string;
  description: string;
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
    description: 'View all dashboards',
    targetSelector: '[data-tour="tour-dashboard"]',
    placement: 'right',
  },
  {
    id: 'charts-tiles',
    title: 'Charts & Tiles',
    description: 'Build charts and tiles to visualize your data',
    targetSelector: '[data-tour="tour-charts-tiles"]',
    placement: 'right',
  },
  {
    id: 'reports',
    title: 'Reports',
    description: 'Create and share detailed reports',
    targetSelector: '[data-tour="tour-reports"]',
    placement: 'right',
  },
  {
    id: 'bi-canvas',
    title: 'BI Canvas',
    description: 'Design custom canvases combining multiple visuals',
    targetSelector: '[data-tour="tour-bi-canvas"]',
    placement: 'right',
  },
  {
    id: 'model-studio',
    title: 'Model Studio',
    description: 'Create and manage your data models',
    targetSelector: '[data-tour="tour-model-studio"]',
    placement: 'right',
  },
  {
    id: 'smart-alerts',
    title: 'Smart Alerts',
    description: 'Set up automated alerts and notifications',
    targetSelector: '[data-tour="tour-smart-alerts"]',
    placement: 'right',
  },
  {
    id: 'data-quality',
    title: 'Data Quality',
    description: 'Monitor and improve the quality of your data',
    targetSelector: '[data-tour="tour-data-quality"]',
    placement: 'right',
  },
  {
    id: 'ai-assistant',
    title: 'Agentic AI',
    description: 'Use AI to get insights, generate reports, and ask questions about your data',
    targetSelector: '[data-tour="tour-ai-assistant"]',
    placement: 'right',
  },
  {
    id: 'user-role-management',
    title: 'User & Role Management',
    description: 'Manage system users and their roles',
    targetSelector: '[data-tour="tour-user-role-management"]',
    placement: 'right',
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Configure data sources, views, and system settings',
    targetSelector: '[data-tour="tour-settings"]',
    placement: 'right',
  },
  {
    id: 'create-dashboard',
    title: 'Create New Dashboard',
    description: 'Build custom dashboards to track what matters most',
    targetSelector: '[data-tour="tour-new-dashboard"]',
    placement: 'left',
    route: '/dashboard/wip-boards',
  },
  {
    id: 'filters',
    title: 'Filters & View Options',
    description: 'Filter with ease',
    targetSelector: '[data-tour="tour-filters"]',
    placement: 'left',
    route: '/dashboard/wip-boards',
  },
  {
    id: 'manage',
    title: 'Manage & Customize',
    description: 'Categories, settings & more',
    targetSelector: '[data-tour="tour-manage-category"]',
    placement: 'left',
    route: '/dashboard/wip-boards',
  },
  {
    id: 'done',
    title: "You're All Set",
    description: 'Get the most out of T-Wise',
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

  start(): void {
    this.stateSubject.next({ ...this.snapshot, active: true, currentIndex: 0 });
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
