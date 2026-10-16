import { Component, Input } from '@angular/core';

export type LoaderType = 'spinner' | 'skeleton-bars' | 'skeleton-table' | 'skeleton-tile';

@Component({
  selector: 'app-loader',
  standalone: false,
  templateUrl: './loader.component.html',
  styleUrls: ['./loader.component.scss'],
})
export class LoaderComponent {
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  @Input() overlay = false;
  @Input() message?: string;

  /** 'spinner' (default brand GIF) or a content-shaped shimmer skeleton for compact/inline use (e.g. a grid of cards). */
  @Input() type: LoaderType = 'spinner';
  /** When several loaders sit in a grid, pass the item's index so their shimmer staggers instead of pulsing in lockstep. */
  @Input() groupIndex = 0;

  readonly barHeights = [55, 80, 40, 95, 65, 75, 50];
  readonly legendPills = [1, 2, 3, 4, 5, 6];
  readonly tableRows = [1, 2, 3, 4, 5];

  /** Staggered animation-delay (ms) for the item at `itemIndex` within this loader instance. */
  delay(itemIndex: number, stepMs = 70): number {
    return this.groupIndex * 150 + itemIndex * stepMs;
  }
}
