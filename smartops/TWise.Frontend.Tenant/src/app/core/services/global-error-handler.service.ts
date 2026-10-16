import { DOCUMENT } from '@angular/common';
import { ErrorHandler, Injectable, inject, signal } from '@angular/core';

@Injectable()
export class GlobalErrorHandlerService implements ErrorHandler {
  private readonly document = inject(DOCUMENT);
  readonly chunkLoadFailed = signal(false);

  handleError(error: unknown): void {
    console.error('[GlobalErrorHandler] Unhandled error:', error);
    if (this.isChunkLoadError(error)) {
      this.chunkLoadFailed.set(true);
    }
  }

  dismissChunkLoadError(): void {
    this.chunkLoadFailed.set(false);
  }

  reloadPage(): void {
    this.document.defaultView?.location.reload();
  }

  private isChunkLoadError(error: unknown, seen = new Set<unknown>()): boolean {
    if (error == null || seen.has(error)) return false;
    seen.add(error);

    const chunkErrorPattern = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk .+ failed/i;
    if (typeof error === 'string') return chunkErrorPattern.test(error);
    if (typeof error !== 'object') return false;

    const candidate = error as Record<string, unknown>;
    return candidate['name'] === 'ChunkLoadError'
      || (typeof candidate['message'] === 'string' && chunkErrorPattern.test(candidate['message']))
      || ['rejection', 'reason', 'ngOriginalError', 'originalError', 'cause'].some(
        key => this.isChunkLoadError(candidate[key], seen),
      );
  }
}
