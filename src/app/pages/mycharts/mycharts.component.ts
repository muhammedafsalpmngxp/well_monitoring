import { Component, OnInit, ViewEncapsulation } from '@angular/core';

interface MyChart {
  id: string;
  name: string;
  description: string;
  icon: 'bar' | 'donut' | 'line';
}

@Component({
  selector: 'app-mycharts',
  templateUrl: './mycharts.component.html',
  styleUrls: ['./mycharts.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class MyChartsComponent implements OnInit {

  charts: MyChart[] = [];

  ngOnInit(): void {
    const w = window as any;
    if (typeof w.chartsGetUserList === 'function') {
      this.charts = w.chartsGetUserList().map((c: { id: string; name: string; desc: string; type: string }) => ({
        id: c.id,
        name: c.name,
        description: c.desc || 'Custom chart created from the chart builder.',
        icon: (c.type === 'donut' || c.type === 'pie') ? 'donut' : (c.type === 'line' ? 'line' : 'bar')
      }));
    }
  }

  open(chart: MyChart): void {
    const w = window as any;
    if (typeof w.chartsOpen === 'function') w.chartsOpen(chart.id);
  }

  addChart(): void {
    const w = window as any;
    if (typeof w.chartsAddChart === 'function') w.chartsAddChart();
  }
}
