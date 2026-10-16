import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-empty-state',
  standalone: false,
  templateUrl: './empty-state.component.html',
  styleUrls: ['./empty-state.component.scss'],
})
export class EmptyStateComponent {
  @Input() title = 'No Data Found';
  @Input() description?: string;
  @Input() icon = 'inbox';
  @Input() image?: string;
  /**
   * An app-icon name shown in a tinted tile instead of `icon`. `icon` needs the Material Icons font,
   * which the app does not load, so it prints the name as text. Opt-in, so other pages keep their look.
   */
  @Input() appIcon?: string;
}
