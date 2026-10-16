import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

export type ItemCardAccent = 'blue' | 'green' | 'orange' | 'purple';

/**
 * A list card in the look of the report, chart and tile lists: accent border, type icon, status, a menu of
 * actions (projected buttons with the attribute item-card-action), a preview image and a footer with Publish.
 */
@Component({
  selector: 'app-item-card',
  standalone: false,
  templateUrl: './item-card.component.html',
  styleUrls: ['./item-card.component.scss'],
})
export class ItemCardComponent {
  @Input() title = '';
  @Input() description: string | null = null;
  @Input() status = 'Draft';
  @Input() published = false;
  @Input() accent: ItemCardAccent = 'blue';
  /** An app-icon name for the type tile. */
  @Input() icon = 'dashboard';
  @Input() category: string | null = null;
  @Input() modified: string | null = null;
  @Input() preview = 'assets/images/new-dashboard-img.svg';
  /** Shows the Publish button in the footer. */
  @Input() canPublish = false;
  @Input() publishing = false;
  /** Shows the menu button; the actions are projected. */
  @Input() hasMenu = false;
  @Output() opened = new EventEmitter<void>();
  @Output() publish = new EventEmitter<void>();

  menuOpen = false;

  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen = !this.menuOpen;
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  closeMenu(): void {
    this.menuOpen = false;
  }
}
