import { Component, ViewEncapsulation } from '@angular/core';
import { Router } from '@angular/router';

interface StandardBoard {
  id: string;
  name: string;
  description: string;
  icon: 'bar' | 'donut' | 'grid';
  /** Angular route, for boards backed by a dedicated page. */
  route?: string;
  /** dbDashboards id, for custom boards opened via the board switcher (view mode). */
  legacyId?: number;
}

@Component({
  selector: 'app-standardboards',
  templateUrl: './standardboards.component.html',
  styleUrls: ['./standardboards.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class StandardBoardsComponent {

  constructor(private router: Router) {}

  readonly boards: StandardBoard[] = [
    {
      id: 'cluster-overview',
      name: 'Operations Dashboard',
      description: 'Cluster-wide well operations overview — KPIs, ODC status, readiness, and delivery progress.',
      route: '/cmdoverview',
      icon: 'bar'
    },
    {
      id: 'odc-south',
      name: 'ODC South Well Delivery',
      description: 'Well delivery tracking for the ODC South scope — cluster breakdowns, commissioning, and workload.',
      route: '/odcsouthwelldelivery',
      icon: 'donut'
    },
    {
      id: 'daily-ops-briefing',
      name: 'Daily Operations Briefing',
      description: 'Active wells, progress, penalty exposure, and at-risk wells for the daily stand-up.',
      legacyId: 1,
      icon: 'grid'
    },
    {
      id: 'crew-performance',
      name: 'Crew Performance',
      description: 'Crews deployed, PI trend, crew roster, and AI-flagged PI anomalies.',
      legacyId: 2,
      icon: 'grid'
    },
    {
      id: 'operation-dashboard',
      name: 'Operation Dashboard',
      description: 'Project progress, bonus potential, crew utilisation, and well status at a glance.',
      legacyId: 3,
      icon: 'grid'
    }
  ];

  open(board: StandardBoard): void {
    if (board.legacyId != null) {
      const w = window as any;
      if (typeof w.dvsOpenBoard === 'function') w.dvsOpenBoard(board.legacyId);
      return;
    }
    if (board.route) this.router.navigate([board.route]);
  }
}
