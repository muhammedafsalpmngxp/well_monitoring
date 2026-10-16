import { Component, Input } from '@angular/core';

@Component({
  selector: 'svg[appTileIcon]',
  standalone: false,
  host: {
    '[attr.viewBox]': 'viewBox',
    '[attr.stroke]': 'strokeColor',
    '[attr.stroke-width]': "icon === 'gauge' || icon === 'calendar' ? 1.6 : 2",
    'fill': 'none',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  },
  template: `
    <svg:g [ngSwitch]="icon">
      <svg:g *ngSwitchCase="'well'">
        <svg:path d="M11 11.9167C12.5188 11.9167 13.75 10.6856 13.75 9.16675C13.75 7.64797 12.5188 6.41675 11 6.41675C9.48117 6.41675 8.25 7.64797 8.25 9.16675C8.25 10.6856 9.48117 11.9167 11 11.9167Z" />
        <svg:path d="M11.0001 20.1666C14.6667 16.4999 18.3334 13.2167 18.3334 9.16659C18.3334 5.1165 15.0502 1.83325 11.0001 1.83325C6.94999 1.83325 3.66675 5.1165 3.66675 9.16659C3.66675 13.2167 7.33341 16.4999 11.0001 20.1666Z" />
      </svg:g>
      <svg:path *ngSwitchCase="'gauge'" d="M16.2665 14.6668C16.9915 13.6274 17.4167 12.3634 17.4167 11.0002M5.73348 14.6668C5.0085 13.6275 4.58334 12.3634 4.58334 11.0002C4.58334 7.45634 7.45619 4.5835 11 4.5835M15.1249 6.87516L10.9999 11.0002M20.1667 11.0002C20.1667 16.0627 16.0626 20.1668 11 20.1668C5.9374 20.1668 1.83334 16.0627 1.83334 11.0002C1.83334 5.93755 5.9374 1.8335 11 1.8335C16.0626 1.8335 20.1667 5.93755 20.1667 11.0002Z" />
      <svg:g *ngSwitchCase="'crew'">
        <svg:path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <svg:circle cx="9" cy="7" r="4" />
        <svg:path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <svg:path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg:g>
      <svg:path *ngSwitchCase="'calendar'" d="M19.25 9.16683H2.75M14.6667 1.8335V5.50016M7.33333 1.8335V5.50016M7.15 20.1668H14.85C16.3902 20.1668 17.1602 20.1668 17.7485 19.8671C18.266 19.6034 18.6866 19.1828 18.9503 18.6653C19.25 18.077 19.25 17.307 19.25 15.7668V8.06683C19.25 6.52668 19.25 5.75661 18.9503 5.16836C18.6866 4.65091 18.266 4.23021 17.7485 3.96656C17.1602 3.66683 16.3902 3.66683 14.85 3.66683H7.15C5.60985 3.66683 4.83978 3.66683 4.25153 3.96656C3.73408 4.23021 3.31338 4.65091 3.04973 5.16836C2.75 5.75661 2.75 6.52668 2.75 8.06683V15.7668C2.75 17.307 2.75 18.077 3.04973 18.6653C3.31338 19.1828 3.73408 19.6034 4.25153 19.8671C4.83978 20.1668 5.60985 20.1668 7.15 20.1668Z" />
      <svg:path *ngSwitchCase="'derrick'" d="M12 2v20M6 8l6-4 6 4M4 12h16M8 16l-2 6M16 16l2 6" />
      <svg:g *ngSwitchCase="'check'">
        <svg:path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <svg:path d="M22 4L12 14.01 9 11.01" />
      </svg:g>
      <svg:path *ngSwitchCase="'alert'" d="M12 9v4m0 4h.01M10.62 3.89L2.4 18.1c-.46.79-.69 1.18-.66 1.5a1 1 0 0 0 .65.71c.26.17.72.17 1.63.17h16.45c.91 0 1.37 0 1.63-.17a1 1 0 0 0 .65-.71c.03-.33-.2-.72-.66-1.51L13.39 3.89c-.45-.79-.68-1.18-.97-1.33a1 1 0 0 0-.84 0c-.29.15-.52.54-.97 1.33Z" />
      <svg:g *ngSwitchDefault>
        <svg:polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <svg:polyline points="17 6 23 6 23 12" />
      </svg:g>
    </svg:g>
  `,
})
export class TileIconComponent {
  @Input() appTileIcon: string | null | undefined = 'well';
  @Input() color = 'currentColor';

  get icon(): string {
    const aliases: Record<string, string> = {
      pin: 'well', location: 'well', users: 'crew',
      'check-circle': 'check', 'alert-triangle': 'alert',
      chart: 'trend', image: 'trend', 'trending-up': 'trend',
    };
    return aliases[this.appTileIcon ?? 'well'] ?? this.appTileIcon ?? 'well';
  }

  get viewBox(): string {
    return ['well', 'gauge', 'calendar'].includes(this.icon) ? '0 0 22 22' : '0 0 24 24';
  }

  get strokeColor(): string {
    const colors: Record<string, string> = {
      blue: '#2563EB', green: '#12B76A', red: '#D92D20', purple: '#7C3AED', orange: '#F58220',
      amber: '#F59E0B', teal: '#14B8A6', gray: '#9CA3AF',
    };
    return colors[this.color] ?? this.color;
  }
}