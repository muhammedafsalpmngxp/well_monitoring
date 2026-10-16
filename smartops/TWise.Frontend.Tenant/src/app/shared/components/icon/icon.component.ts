import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Small set of hand-drawn, two-tone flat icons for the top-level sidebar
 * groups. Kept separate from Material Icons (which is single-color only)
 * so the sidebar can show the colourful glyph style used in the product's
 * navigation mockups without depending on an external icon pack.
 */
@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './icon.component.html',
  styleUrls: ['./icon.component.scss'],
})
export class IconComponent {
  @Input() name: string | undefined = '';
}
