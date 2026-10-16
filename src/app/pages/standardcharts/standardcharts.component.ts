import { Component, ViewEncapsulation } from '@angular/core';

interface StandardChart {
  id: string;
  name: string;
  description: string;
  icon: 'bar' | 'donut' | 'line';
}

@Component({
  selector: 'app-standardcharts',
  templateUrl: './standardcharts.component.html',
  styleUrls: ['./standardcharts.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class StandardChartsComponent {

  readonly charts: StandardChart[] = [
    { id: 'std-jobprogress', name: 'Job Progress',        description: 'PMS completed per workgroup',      icon: 'bar' },
    { id: 'std-odcstatus',   name: 'ODC Overall Status',  description: 'Wells by delivery status',          icon: 'donut' },
    { id: 'std-crewutil',    name: 'Crew Utilisation',    description: 'Crew utilisation by cluster',       icon: 'bar' },
    { id: 'std-wellstatus',  name: 'Well Status',         description: 'Count of wells by status',          icon: 'donut' },
    { id: 'std-pitrend',     name: 'PI Trend',            description: 'Performance index over time',       icon: 'line' }
  ];

  open(chart: StandardChart): void {
    const w = window as any;
    if (typeof w.chartsOpen === 'function') w.chartsOpen(chart.id);
  }
}
