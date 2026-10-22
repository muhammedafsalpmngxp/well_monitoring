import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AiActivityFilter, AiActivityItem, AiActivityUser, AiAdminOptions, AiCall, AiService, AiTraceStep } from '../../../core/services/ai.service';

/**
 * Admin page: every user's Ask AI answers with their traces (what was sent to the AI, what came back,
 * timings), and every AI call of any feature (failed ones can be shown alone), filtered by period, user,
 * purpose and text. Periods, page size and retention come from the server's AiAdmin settings.
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
  readonly breadcrumbs = [{ label: 'Home' }, { label: 'AI Settings', route: '/settings/ai' }, { label: 'AI Activity' }];
  readonly stepNames: Record<string, string> = {
    load: 'Load data', context: 'Build context', ask: 'AI: question to query', query: 'Run query', rejected: 'Query rejected', answer: 'AI: answer',
  };

  options: AiAdminOptions | null = null;
  /** A quick period in days, or 0 for the dates below. */
  days = 0;
  from = '';
  to = '';
  userId = '';
  users: AiActivityUser[] = [];

  // Answers
  search = '';
  skip = 0;
  total = 0;
  items: AiActivityItem[] = [];
  loading = true;
  /** Expanded answer and its trace (loaded on first open). */
  openId: number | null = null;
  traces = new Map<number, AiTraceStep[] | null>();
  traceLoading: number | null = null;

  // AI calls (any feature)
  purpose = '';
  purposes: string[] = [];
  failedOnly = false;
  callSearch = '';
  callSkip = 0;
  callTotal = 0;
  calls: AiCall[] = [];
  callsLoading = true;

  error = '';

  // Responses render with detectChanges: on this page markForCheck alone was not followed by a render (seen in the browser).
  constructor(private readonly ai: AiService, private readonly cdr: ChangeDetectorRef) {}

  get pageSize(): number { return this.options?.pageSize ?? 0; }

  ngOnInit(): void {
    this.ai.adminOptions().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: o => { this.options = o; this.days = o.activityDays; this.load(); },
      error: err => { this.error = err?.error?.message ?? 'AI activity could not be loaded.'; this.loading = this.callsLoading = false; this.cdr.detectChanges(); },
    });
  }

  dayLabel(d: number): string { return d === 1 ? 'Today' : `Last ${d} days`; }

  /** The period and user shared by both lists: a quick period, else the chosen dates. */
  private filter(skip: number, q: string): AiActivityFilter {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const from = this.days ? iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (this.days - 1)))) : this.from || null;
    const to = this.days ? null : this.to || null;
    return { from, to, userId: this.userId || null, q: q.trim() || null, skip, take: this.pageSize };
  }

  load(): void { this.loadAnswers(); this.loadCalls(); }

  loadAnswers(): void {
    this.loading = true; this.error = ''; this.openId = null;
    this.ai.activity(this.filter(this.skip, this.search)).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: p => { this.items = p.items; this.total = p.total; this.loading = false; this.cdr.detectChanges(); },
      error: err => { this.error = err?.error?.message ?? 'AI activity could not be loaded.'; this.items = []; this.total = 0; this.loading = false; this.cdr.detectChanges(); },
    });
  }

  loadCalls(): void {
    this.callsLoading = true;
    this.ai.calls({ ...this.filter(this.callSkip, this.callSearch), purpose: this.purpose || null, failed: this.failedOnly })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: p => { this.calls = p.items; this.callTotal = p.total; this.users = p.users; this.purposes = p.purposes; this.callsLoading = false; this.cdr.detectChanges(); },
        error: err => { this.error = err?.error?.message ?? 'AI calls could not be loaded.'; this.calls = []; this.callTotal = 0; this.callsLoading = false; this.cdr.detectChanges(); },
      });
  }

  /** Period or user changed: both lists start again from the first page. */
  applyFilter(): void { this.skip = 0; this.callSkip = 0; this.load(); }
  applyAnswerSearch(): void { this.skip = 0; this.loadAnswers(); }
  applyCallFilter(): void { this.callSkip = 0; this.loadCalls(); }
  page(delta: number): void { this.skip = Math.max(0, this.skip + delta * this.pageSize); this.loadAnswers(); }
  callPage(delta: number): void { this.callSkip = Math.max(0, this.callSkip + delta * this.pageSize); this.loadCalls(); }

  toggle(item: AiActivityItem): void {
    this.openId = this.openId === item.messageId ? null : item.messageId;
    if (this.openId === null || !item.hasTrace || this.traces.has(item.messageId)) return;
    this.traceLoading = item.messageId;
    this.ai.activityTrace(item.messageId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: t => { this.traces.set(item.messageId, t); this.traceLoading = null; this.cdr.detectChanges(); },
      error: () => { this.traces.set(item.messageId, null); this.traceLoading = null; this.cdr.detectChanges(); },
    });
  }

  trackById(_: number, item: AiActivityItem): number { return item.messageId; }
  trackCall(_: number, c: AiCall): number { return c.id; }
}
