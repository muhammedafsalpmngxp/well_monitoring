import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AiActivityItem, AiFailure, AiService, AiTraceStep } from '../../../core/services/ai.service';

/**
 * Admin page: every user's Ask AI answers with their traces (what was sent to the AI, what came back,
 * timings) and the failed AI calls, so answers can be checked and problems found without asking users.
 */
@Component({
  selector: 'app-ai-activity',
  standalone: false,
  templateUrl: './ai-activity.component.html',
  styleUrls: ['../ai-settings/ai-settings.component.scss', './ai-activity.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiActivityComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  readonly breadcrumbs = [{ label: 'Home' }, { label: 'Settings', route: '/settings' }, { label: 'AI Activity' }];
  readonly pageSize = 50;
  readonly dayOptions = [{ days: 1, label: 'Today' }, { days: 7, label: 'Last 7 days' }, { days: 30, label: 'Last 30 days' }, { days: 90, label: 'Last 90 days' }];
  readonly stepNames: Record<string, string> = {
    load: 'Load data', context: 'Build context', ask: 'AI: question to query', query: 'Run query', rejected: 'Query rejected', answer: 'AI: answer',
  };

  days = 7;
  search = '';
  skip = 0;
  total = 0;
  items: AiActivityItem[] = [];
  failures: AiFailure[] = [];
  loading = true;
  error = '';
  /** Expanded answer and its trace (loaded on first open). */
  openId: number | null = null;
  traces = new Map<number, AiTraceStep[] | null>();
  traceLoading: number | null = null;

  constructor(private readonly ai: AiService, private readonly cdr: ChangeDetectorRef) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true; this.error = ''; this.openId = null;
    this.ai.activity(this.days, this.search.trim() || null, this.skip, this.pageSize).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: p => { this.items = p.items; this.total = p.total; this.loading = false; this.cdr.markForCheck(); },
      error: err => { this.error = err?.error?.message ?? 'AI activity could not be loaded.'; this.loading = false; this.cdr.markForCheck(); },
    });
    this.ai.failures(this.days).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: f => { this.failures = f; this.cdr.markForCheck(); },
      error: () => { this.failures = []; this.cdr.markForCheck(); },
    });
  }

  applyFilter(): void { this.skip = 0; this.load(); }
  page(delta: number): void { this.skip = Math.max(0, this.skip + delta * this.pageSize); this.load(); }

  toggle(item: AiActivityItem): void {
    this.openId = this.openId === item.messageId ? null : item.messageId;
    if (this.openId === null || !item.hasTrace || this.traces.has(item.messageId)) return;
    this.traceLoading = item.messageId;
    this.ai.activityTrace(item.messageId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: t => { this.traces.set(item.messageId, t); this.traceLoading = null; this.cdr.markForCheck(); },
      error: () => { this.traces.set(item.messageId, null); this.traceLoading = null; this.cdr.markForCheck(); },
    });
  }

  trackById(_: number, item: AiActivityItem): number { return item.messageId; }
}
