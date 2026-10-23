import { Injectable, signal } from '@angular/core';

/** Open/closed state of the global Ask AI drawer, toggled from the navbar and hosted by the main layout. */
@Injectable({ providedIn: 'root' })
export class AskAiPanelService {
  readonly isOpen = signal(false);
  /** An alert to show (the bell's link to a fired alert); the panel opens its history on it. */
  readonly focusAlert = signal<number | null>(null);
  /** An answer to show (a scheduled insight mail's link); the panel opens the chat that holds it. */
  readonly focusAnswer = signal<number | null>(null);

  toggle(): void { this.isOpen.update(v => !v); }
  openAlert(id: number): void { this.focusAlert.set(id); this.isOpen.set(true); }
  openAnswer(messageId: number): void { this.focusAnswer.set(messageId); this.isOpen.set(true); }
  close(): void { this.isOpen.set(false); }
}
