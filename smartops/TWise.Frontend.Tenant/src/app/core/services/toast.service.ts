import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private _pending = '';

  /** Set a message to be shown on the next page load. */
  set pending(msg: string) { this._pending = msg; }

  /** Consume the pending message (returns empty string if none). */
  consume(): string {
    const msg = this._pending;
    this._pending = '';
    return msg;
  }
}
