import { ChangeDetectorRef, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { Router } from '@angular/router';
import { DataQualityService, ReliabilityRule } from '../../../core/services/data-quality.service';
import { DashboardShareContext } from '../../../core/services/widget.service';

@Component({
  selector: 'app-reliability-details-dialog',
  standalone: false,
  templateUrl: './reliability-details-dialog.component.html',
  styleUrls: ['./reliability-details-dialog.component.scss'],
})
export class ReliabilityDetailsDialogComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() title = 'Reliability Score Details';
  @Input() sourceLabel = '';
  @Input() tableName: string | null = null;
  @Input() viewId: number | null = null;
  @Input() shareContext?: DashboardShareContext;
  @Input() boardFrom: 'wip' | 'standard' | null = null;
  @Input() boardId: number | null = null;
  @Input() boardTitle = '';
  @Input() boardParentLabel = '';
  @Output() closed = new EventEmitter<void>();

  rules: ReliabilityRule[] = [];
  overallScore: number | null = null;
  breakdown = '';
  loading = false;
  error = '';
  showCalculation = false;

  toggleCalculation(): void {
    this.showCalculation = !this.showCalculation;
  }

  get contributingRules(): ReliabilityRule[] {
    return this.rules.filter(rule => rule.contributes && rule.reliability != null);
  }

  get scoreFormula(): string {
    const scores = this.contributingRules.map(rule => rule.reliability);
    if (scores.length === 0) return '';
    return `(${scores.join(' + ')}) ÷ ${scores.length} = ${this.overallScore}`;
  }

  constructor(
    private readonly dataQualityService: DataQualityService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) this.load();
  }

  onClose(): void {
    this.closed.emit();
  }

  scoreClass(score: number | null): string {
    if (score == null) return 'rd-score--none';
    if (score >= 80) return 'rd-score--green';
    if (score >= 60) return 'rd-score--blue';
    if (score >= 40) return 'rd-score--orange';
    return 'rd-score--red';
  }

  /** Opens the rule in the Data Quality rule view; that page returns here on close. */
  openRule(ruleId: string): void {
    if (this.shareContext) return;
    const returnUrl = this.router.url;
    const queryParams: Record<string, string> = {
      viewRuleId: ruleId,
      returnUrl,
      reliabilitySource: JSON.stringify({
        sourceLabel: this.sourceLabel,
        tableName: this.tableName,
        viewId: this.viewId,
      }),
    };
    if (this.boardFrom && this.boardId != null && this.boardTitle.trim() && this.boardParentLabel.trim()) {
      queryParams['boardFrom'] = this.boardFrom;
      queryParams['boardId'] = String(this.boardId);
      queryParams['boardTitle'] = this.boardTitle;
      queryParams['boardParentLabel'] = this.boardParentLabel;
    }
    this.router.navigate(['/data-quality/error-log-rules'], { queryParams });
  }

  private load(): void {
    this.showCalculation = false;
    if (!this.tableName && this.viewId == null) {
      this.rules = [];
      this.error = 'No data source is linked to this chart.';
      return;
    }
    this.loading = true;
    this.error = '';
    this.dataQualityService.getReliabilityDetail({ tableName: this.tableName, viewId: this.viewId }, this.shareContext).subscribe({
      next: (res) => {
        this.rules = res.data?.rules ?? [];
        this.overallScore = res.data?.reliability ?? null;
        this.breakdown = res.data?.reliabilityBreakdown ?? '';
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.rules = [];
        this.error = 'Failed to load reliability details.';
        this.loading = false;
        this.cdr.detectChanges();
      },
    });
  }
}
