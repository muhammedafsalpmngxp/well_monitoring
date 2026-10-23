import type { Location } from '@angular/common';
import type { Router } from '@angular/router';

export interface ReliabilitySource {
  sourceLabel: string;
  tableName: string | null;
  viewId: number | null;
}

export function decodeReliabilitySource(value: string | null): ReliabilitySource | null {
  if (!value) return null;
  try {
    const source: unknown = JSON.parse(value);
    if (!source || typeof source !== 'object') return null;
    const { sourceLabel, tableName, viewId } = source as ReliabilitySource;
    if (typeof sourceLabel !== 'string'
      || (tableName !== null && (typeof tableName !== 'string' || !tableName.trim()))
      || (viewId !== null && (!Number.isInteger(viewId) || viewId <= 0))
      || (!tableName && viewId === null)) return null;
    return { sourceLabel, tableName, viewId };
  } catch {
    return null;
  }
}

export function consumeReliabilityReturn(router: Router, location: Location): ReliabilitySource | null {
  const state = location.getState() as Record<string, unknown> | null;
  if (!state || !Object.hasOwn(state, 'reliabilityReturn')) return null;
  const { reliabilityReturn, ...remainingState } = state;
  location.replaceState(location.path(true), '', remainingState);
  if (!reliabilityReturn || typeof reliabilityReturn !== 'object') return null;
  const context = reliabilityReturn as { url?: unknown; source?: unknown };
  if (context.url !== router.url || typeof context.source !== 'string') return null;
  return decodeReliabilitySource(context.source);
}