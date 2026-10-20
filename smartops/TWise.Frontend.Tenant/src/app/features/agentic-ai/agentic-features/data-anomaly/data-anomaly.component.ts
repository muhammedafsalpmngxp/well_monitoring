import { Component } from '@angular/core';

/** Agentic AI → Agentic Features → Data Anomaly. */
@Component({
  selector: 'app-data-anomaly',
  standalone: false,
  templateUrl: './data-anomaly.component.html',
  styleUrls: ['./data-anomaly.component.scss'],
})
export class DataAnomalyComponent {
  readonly breadcrumbs = [{ label: 'Home' }, { label: 'Agentic AI' }, { label: 'Agentic Features', route: '/agentic-ai/features' }, { label: 'Data Anomaly' }];
}
