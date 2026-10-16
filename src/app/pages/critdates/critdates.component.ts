import { Component, AfterViewInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { DelayImpactService, DelayCard } from '../../services/delay-impact.service';

@Component({
  selector: 'app-critdates',
  templateUrl: './critdates.component.html',
  styleUrls: ['./critdates.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class CritDatesComponent implements AfterViewInit, OnDestroy {

  delayCards: DelayCard[] = [];
  delayLoading = true;

  private static readonly FALLBACK_CARDS: DelayCard[] = [
    {
      well: '31780',
      rootCause: 'Material PO not raised (FLAF valve) — procurement engaged too late',
      cascade: [
        { phase: 'Material delivery', slip: '+95d' },
        { phase: 'FL Construction', slip: '+23d' },
        { phase: 'Commissioning', slip: '+23d' },
        { phase: 'RIG-ON DATE', slip: '+23d' }
      ],
      penalty: 52000,
      recoveries: [
        { rank: 1, action: 'Expedite pipe delivery', cost: 8000, daysSaved: 7, netSaving: 6000 },
        { rank: 2, action: 'Redeploy 3 welding crews', cost: 18000, daysSaved: 10, netSaving: 2000 },
        { rank: 3, action: 'Emergency PO for FLAF valve', cost: 5000, daysSaved: 5, netSaving: 1000 }
      ]
    },
    {
      well: '37797',
      rootCause: 'Gravel delivery short by 280m³ — quarry truck availability constraint',
      cascade: [
        { phase: 'Pre-padding backfill', slip: '+17d' },
        { phase: 'Civil compaction', slip: '+17d' },
        { phase: 'FL Construction', slip: '+17d' },
        { phase: 'RIG-ON DATE', slip: '+17d' }
      ],
      penalty: 48000,
      recoveries: [
        { rank: 1, action: 'Emergency gravel delivery', cost: 6000, daysSaved: 5, netSaving: 4000 },
        { rank: 2, action: 'Redeploy CW-004 Lima Civil', cost: 14000, daysSaved: 8, netSaving: 2000 },
        { rank: 3, action: 'Second grading crew on parallel', cost: 22000, daysSaved: 6, netSaving: 1000 }
      ]
    },
    {
      well: '34561',
      rootCause: 'Foundation blocks 6 units short — Al-Tamimi late delivery',
      cascade: [
        { phase: 'Foundation installation', slip: '+8d' },
        { phase: 'Backfill & compaction', slip: '+6d' },
        { phase: 'Reinstatement', slip: '+5d' },
        { phase: 'RIG-ON DATE', slip: '+8d' }
      ],
      penalty: 19000,
      recoveries: [
        { rank: 1, action: 'Priority delivery 6 blocks', cost: 2000, daysSaved: 4, netSaving: 2000 },
        { rank: 2, action: 'Double-shift on backfill', cost: 4000, daysSaved: 3, netSaving: 1000 },
        { rank: 3, action: 'Parallel working', cost: 6000, daysSaved: 5, netSaving: 500 }
      ]
    },
    {
      well: '34357',
      rootCause: 'FLAF number not assigned — PM has not engaged PDO focal point',
      cascade: [
        { phase: 'FLAF assignment', slip: '+20d' },
        { phase: 'Commissioning start', slip: '+10d' },
        { phase: 'Final sign-off', slip: '+10d' },
        { phase: 'RIG-ON DATE', slip: '+10d' }
      ],
      penalty: 19000,
      recoveries: [
        { rank: 1, action: 'Escalate to PDO FM today — 3 days impact', cost: 0, daysSaved: 3, netSaving: 3000 },
        { rank: 2, action: 'Pre-start commissioning docs', cost: 2000, daysSaved: 2, netSaving: 1000 },
        { rank: 3, action: 'Add welding crew', cost: 8000, daysSaved: 4, netSaving: 500 }
      ]
    },
    {
      well: '36075',
      rootCause: 'Valve SKU-0881 out of stock — procurement not flagged until W15',
      cascade: [
        { phase: 'Valve installation', slip: '+5d' },
        { phase: 'Pressure test', slip: '+5d' },
        { phase: 'Commissioning', slip: '+5d' },
        { phase: 'RIG-ON DATE', slip: '+5d' }
      ],
      penalty: 8000,
      recoveries: [
        { rank: 1, action: 'Source alternative valve spec', cost: 1000, daysSaved: 3, netSaving: 2000 },
        { rank: 2, action: 'Expedite from Dubai warehouse', cost: 3000, daysSaved: 2, netSaving: 1000 },
        { rank: 3, action: 'Reschedule commissioning sequence', cost: 0, daysSaved: 1, netSaving: 1000 }
      ]
    }
  ];

  constructor(private readonly delayImpactService: DelayImpactService) {}

  ngAfterViewInit(): void {
    // Scroll to top
    const scrollEl = document.querySelector('.page-scroll');
    if (scrollEl) (scrollEl as HTMLElement).scrollTop = 0;

    // Prevent vanilla JS renderDelayCards() from overwriting Angular-managed content
    const delayEl = document.getElementById('cdtDelayCards');
    if (delayEl) (delayEl as any)._built = true;

    // Call page renderer for other tabs (gantt, milestones, etc.)
    const fn = (window as any)['renderCritDates'];
    if (typeof fn === 'function') {
      try { fn(); } catch (e) { console.error('[critdates] renderer threw', e); }
    }

    // Load delay impact data from API
    this.loadDelayImpact();
  }

  private loadDelayImpact(): void {
    this.delayImpactService.fetchDelayImpact().subscribe({
      next: (cards) => {
        this.delayCards = cards.length > 0 ? cards : CritDatesComponent.FALLBACK_CARDS;
        this.delayLoading = false;
      },
      error: () => {
        this.delayCards = CritDatesComponent.FALLBACK_CARDS;
        this.delayLoading = false;
      }
    });
  }

  getPenaltyClass(penalty: number): string {
    if (penalty >= 40000) return 'critical';
    if (penalty >= 15000) return 'high';
    return 'medium';
  }

  formatCost(cost: number): string {
    if (cost === 0) return '0';
    return cost >= 1000 ? Math.round(cost / 1000) + 'K' : cost.toString();
  }

  ngOnDestroy(): void {}
}
