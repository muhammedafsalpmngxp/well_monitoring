import { Injectable, signal } from '@angular/core';

/** Open/closed state of the global Ask AI drawer, toggled from the navbar and hosted by the main layout. */
@Injectable({ providedIn: 'root' })
export class AskAiPanelService {
  readonly isOpen = signal(false);

  toggle(): void { this.isOpen.update(v => !v); }
  close(): void { this.isOpen.set(false); }
}
