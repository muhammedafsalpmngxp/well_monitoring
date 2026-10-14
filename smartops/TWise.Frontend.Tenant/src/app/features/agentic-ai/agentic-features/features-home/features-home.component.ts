import { ChangeDetectorRef, Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PermissionService } from '../../../../core/services/permission.service';
import { AgenticFeaturesService, AgenticFeatureSummary, errorText } from '../agentic-features.service';

/**
 * Agentic AI → Agentic Features: one card per feature the user may open (the API filters by permission). Each card
 * says whether the feature is ready: AI switched on, and an admin has chosen the tables it may read.
 */
@Component({
  selector: 'app-features-home',
  standalone: false,
  templateUrl: './features-home.component.html',
  styleUrls: ['./features-home.component.scss'],
})
export class FeaturesHomeComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  readonly breadcrumbs = [{ label: 'Home' }, { label: 'Agentic AI' }, { label: 'Agentic Features' }];

  features: AgenticFeatureSummary[] = [];
  loading = true;
  error = '';

  constructor(private readonly api: AgenticFeaturesService, private readonly permissions: PermissionService,
              private readonly cdr: ChangeDetectorRef) {}

  /** Admins can open the feature's settings and prompts from its card. */
  get isAdmin(): boolean { return this.permissions.isAdminUser; }

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = '';
    this.api.list().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: f => { this.features = f; this.loading = false; this.cdr.markForCheck(); },
      error: err => { this.loading = false; this.error = errorText(err, 'The Agentic Features could not be loaded.'); this.cdr.markForCheck(); },
    });
  }

  /** What the feature needs before it works fully; empty when it is ready. */
  notes(f: AgenticFeatureSummary): string[] {
    const n: string[] = [];
    if (!f.configured) n.push('Not set up: an admin chooses what it may read under AI Settings → Ask Data & Features.');
    if (!f.aiEnabled) n.push(f.feature === 'anomaly'
      ? 'AI is off: runs use the checks already compiled; compile and discover need AI.'
      : 'AI is off: the figures work, the AI explanations do not.');
    return n;
  }

  trackFeature(_: number, f: AgenticFeatureSummary): string { return f.feature; }
}
