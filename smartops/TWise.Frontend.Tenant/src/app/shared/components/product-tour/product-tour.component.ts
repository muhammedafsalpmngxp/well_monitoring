import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ProductTourService, TourState, TourStep } from '../../../core/services/product-tour.service';

interface TargetRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface TooltipBox {
  top: number;
  left: number;
  width: number;
}

const TOOLTIP_WIDTH = 300;
const TOOLTIP_GAP = 22;
const PANEL_CLEARANCE = 340;
const TOOLTIP_MAX_HEIGHT = 280;
const MAX_LOCATE_ATTEMPTS = 40;

@Component({
  selector: 'app-product-tour',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './product-tour.component.html',
  styleUrls: ['./product-tour.component.scss'],
})
export class ProductTourComponent implements OnInit, OnDestroy {
  state: TourState = { active: false, currentIndex: 0, steps: [] };
  targetRect: TargetRect | null = null;

  private sub!: Subscription;
  private raf = 0;
  private listScrollRaf = 0;

  constructor(
    private readonly tour: ProductTourService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.sub = this.tour.state$.subscribe((next) => {
      const stepChanged = next.currentIndex !== this.state.currentIndex || next.active !== this.state.active;
      this.state = next;
      if (next.active && stepChanged) {
        this.locateCurrentTarget();
        this.scrollCurrentStepIntoView();
      }
      if (!next.active) this.targetRect = null;
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.listScrollRaf);
  }

  get currentStep(): TourStep | null {
    return this.state.steps[this.state.currentIndex] ?? null;
  }

  get isLastStep(): boolean {
    return this.state.currentIndex >= this.state.steps.length - 1;
  }

  get progressPercent(): number {
    return this.state.steps.length ? ((this.state.currentIndex + 1) / this.state.steps.length) * 100 : 0;
  }

  next(): void {
    this.tour.next();
  }

  skip(): void {
    this.tour.skip();
  }

  @HostListener('window:resize')
  onResize(): void {
    if (this.state.active) this.locateCurrentTarget();
  }

  private locateCurrentTarget(): void {
    cancelAnimationFrame(this.raf);
    const step = this.currentStep;
    if (!step) {
      this.targetRect = null;
      return;
    }

    if (step.route && !this.router.url.startsWith(step.route)) {
      this.router.navigateByUrl(step.route).then(() => this.pollForTarget(step, MAX_LOCATE_ATTEMPTS));
      return;
    }
    this.pollForTarget(step, MAX_LOCATE_ATTEMPTS);
  }

  private scrollCurrentStepIntoView(): void {
    cancelAnimationFrame(this.listScrollRaf);
    this.listScrollRaf = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.product-tour__list li.active')?.scrollIntoView({ block: 'nearest' });
    });
  }

  private pollForTarget(step: TourStep, attemptsLeft: number): void {
    if (!step.targetSelector) {
      this.targetRect = null;
      this.cdr.markForCheck();
      return;
    }
    const el = document.querySelector(step.targetSelector) as HTMLElement | null;
    if (el) {
      const r = el.getBoundingClientRect();
      this.targetRect = { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      this.cdr.markForCheck();
      return;
    }
    if (attemptsLeft <= 0) {
      const fallbackSelector = step.route ? this.moduleTargetForRoute(step.route) : null;
      const fallback = fallbackSelector ? document.querySelector<HTMLElement>(fallbackSelector) : null;
      if (fallback) {
        const r = fallback.getBoundingClientRect();
        this.targetRect = { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      } else {
        this.targetRect = null;
      }
      this.cdr.markForCheck();
      return;
    }
    this.raf = requestAnimationFrame(() => this.pollForTarget(step, attemptsLeft - 1));
  }

  private moduleTargetForRoute(route: string): string | null {
    const moduleTargets: Record<string, string> = {
      dashboard: 'tour-dashboard',
      'charts-tiles': 'tour-charts-tiles',
      reports: 'tour-reports',
      'data-quality': 'tour-data-quality',
      'user-role-management': 'tour-user-role-management',
      settings: 'tour-settings',
      canvas: 'tour-bi-canvas',
      'model-studio': 'tour-model-studio',
      'smart-alerts': 'tour-smart-alerts',
      'agentic-ai': 'tour-ai-assistant',
    };
    const module = route.split('/').filter(Boolean)[0];
    const target = module ? moduleTargets[module] : null;
    return target ? `[data-tour="${target}"]` : null;
  }

  // ─── Layout math ────────────────────────────────────────────────────────

  get spotlightStyle(): Record<string, string> {
    if (!this.targetRect) return {};
    const pad = 6;
    return {
      top: `${this.targetRect.top - pad}px`,
      left: `${this.targetRect.left - pad}px`,
      width: `${this.targetRect.width + pad * 2}px`,
      height: `${this.targetRect.height + pad * 2}px`,
    };
  }

  get badgeStyle(): Record<string, string> {
    if (!this.targetRect) return {};
    return { top: `${this.targetRect.top}px`, left: `${this.targetRect.right}px` };
  }

  get tooltipStyle(): Record<string, string> {
    const box = this.tooltipBox;
    if (!box) return {};
    return { top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px` };
  }

  get connectorPath(): string {
    const box = this.tooltipBox;
    if (!this.targetRect || !box) return '';
    const bx = this.targetRect.right;
    const by = this.targetRect.top;
    const tx = box.left + 24;
    const ty = box.top;
    const midX = (bx + tx) / 2;
    const midY = Math.min(by, ty) - 40;
    return `M ${bx} ${by} Q ${midX} ${midY} ${tx} ${ty}`;
  }

  private get tooltipBox(): TooltipBox | null {
    const step = this.currentStep;
    if (!step || !this.targetRect) return null;
    const r = this.targetRect;
    let top: number;
    let left: number;

    switch (step.placement) {
      case 'right':
        top = r.top - 10;
        left = r.right + TOOLTIP_GAP;
        break;
      case 'left':
        top = r.top - 10;
        left = r.left - TOOLTIP_WIDTH - TOOLTIP_GAP;
        break;
      case 'bottom-left':
        top = r.bottom + TOOLTIP_GAP;
        left = r.right - TOOLTIP_WIDTH;
        break;
      default:
        top = r.bottom + TOOLTIP_GAP;
        left = r.left;
        break;
    }

    const maxLeft = window.innerWidth - TOOLTIP_WIDTH - PANEL_CLEARANCE;
    left = Math.max(16, Math.min(left, maxLeft));
    top = Math.max(16, Math.min(top, window.innerHeight - TOOLTIP_MAX_HEIGHT - 16));
    return { top, left, width: TOOLTIP_WIDTH };
  }
}
