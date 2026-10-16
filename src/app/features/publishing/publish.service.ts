import { Injectable } from '@angular/core';

export type PublishKind = 'board' | 'chart' | 'report';
export type PublishStatus = 'draft' | 'published';

/**
 * Publish / draft state for gallery items (boards, charts, reports).
 *
 * Front-end only (demo) — statuses are persisted in localStorage keyed by kind.
 * An item not present in the map falls back to its "natural" default supplied
 * by the caller: seeded/standard items default to published, user-created items
 * default to draft. Publishing a draft moves it into the Standard listing.
 */
@Injectable({ providedIn: 'root' })
export class PublishService {

  private cache: Record<string, Record<string, PublishStatus>> = {};

  private key(kind: PublishKind): string { return `smartops.publish.${kind}`; }

  private map(kind: PublishKind): Record<string, PublishStatus> {
    if (!this.cache[kind]) {
      try { this.cache[kind] = JSON.parse(localStorage.getItem(this.key(kind)) || '{}'); }
      catch { this.cache[kind] = {}; }
    }
    return this.cache[kind];
  }

  private save(kind: PublishKind): void {
    try { localStorage.setItem(this.key(kind), JSON.stringify(this.map(kind))); } catch { /* noop */ }
  }

  /** Resolved status — explicit override if set, else the natural default. */
  status(kind: PublishKind, id: string, naturalPublished: boolean): PublishStatus {
    const explicit = this.map(kind)[id];
    if (explicit) return explicit;
    return naturalPublished ? 'published' : 'draft';
  }

  isPublished(kind: PublishKind, id: string, naturalPublished: boolean): boolean {
    return this.status(kind, id, naturalPublished) === 'published';
  }

  isDraft(kind: PublishKind, id: string, naturalPublished: boolean): boolean {
    return this.status(kind, id, naturalPublished) === 'draft';
  }

  /** Publish a draft — it now appears in the Standard listing. */
  publish(kind: PublishKind, id: string): void {
    this.map(kind)[id] = 'published';
    this.save(kind);
  }

  /** Send a published item back to draft (admin unpublish). */
  unpublish(kind: PublishKind, id: string): void {
    this.map(kind)[id] = 'draft';
    this.save(kind);
  }
}
