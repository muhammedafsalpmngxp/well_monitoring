import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type Highcharts from 'highcharts';
import { Subscription } from 'rxjs';
import { AiService } from '../../../core/services/ai.service';
import { chartDataFromOptions } from '../../../core/utils/chart-data.util';

/**
 * "Explain" button for any chart rendered from Highcharts options. Sends the chart's visible data
 * (not the raw source) to the AI and streams a short narrative into a popover. Hidden unless the
 * user's role has the "summary" feature.
 */
@Component({
  selector: 'app-ai-explain',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ai-explain.component.html',
  styleUrls: ['./ai-explain.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiExplainComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  @Input() options: Highcharts.Options | null | undefined;
  /** Dashboard mode: every placed chart's title and options; takes precedence over `options`. */
  @Input() charts: { title: string; options: Highcharts.Options | null | undefined }[] | null = null;
  @Input() title = '';
  /** Optional hint for the model, e.g. the axis titles or the dashboard name. */
  @Input() context = '';
  /** Category column label used in the table sent to the model. */
  @Input() categoryLabel = 'Category';

  allowed = false;
  open = false;
  busy = false;
  text = '';
  error = '';
  cached = false;
  private sub?: Subscription;

  constructor(private readonly ai: AiService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.ai.features().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(f => { this.allowed = f.enabled.includes('summary'); this.cdr.markForCheck(); });
  }

  get isDashboard(): boolean { return !!this.charts; }

  get hasData(): boolean {
    return this.charts
      ? this.charts.some(c => !!chartDataFromOptions(c.options)?.rows.length)
      : !!chartDataFromOptions(this.options, this.categoryLabel)?.rows.length;
  }

  /** `force` skips the server cache (Regenerate). */
  explain(force = false): void {
    let request$;
    if (this.charts) {
      const charts = this.charts.map(c => ({ title: c.title, data: chartDataFromOptions(c.options) })).filter(c => c.data?.rows.length)
        .map(c => ({ title: c.title, columns: c.data!.columns, rows: c.data!.rows }));
      if (!charts.length) { this.error = 'No chart has data to explain yet.'; this.open = true; return; }
      request$ = this.ai.summarizeDashboard({ title: this.title || 'Dashboard', charts, force });
    } else {
      const data = chartDataFromOptions(this.options, this.categoryLabel);
      if (!data) { this.error = 'This chart type cannot be explained yet.'; this.open = true; return; }
      request$ = this.ai.summarize({ title: this.title || 'Chart', columns: data.columns, rows: data.rows, context: this.context || null, force });
    }
    this.sub?.unsubscribe();
    this.open = true;
    this.busy = true;
    this.text = '';
    this.error = '';
    this.cached = false;
    this.sub = request$
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: ev => {
          if (ev.type === 'answer') this.text += ev.data;
          else if (ev.type === 'error') this.error = ev.data;
          else if (ev.type === 'done' && ev.data && 'cached' in ev.data) this.cached = ev.data.cached;
          this.cdr.markForCheck();
        },
        error: err => { this.error = err?.message ?? 'The request failed.'; this.busy = false; this.cdr.markForCheck(); },
        complete: () => { this.busy = false; this.cdr.markForCheck(); },
      });
  }

  close(): void {
    this.sub?.unsubscribe();
    this.open = false;
    this.busy = false;
  }

  copy(): void {
    navigator.clipboard?.writeText(this.text).catch(() => { /* clipboard blocked */ });
  }
}
