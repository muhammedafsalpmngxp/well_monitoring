import type { CanvasStep } from './agent-canvas.component';

const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Copies of steps for Duplicate / Paste: new ids, placed below-right, links between the copied steps kept (to the
 * copies), links to other steps kept as they were, and output keys made unique (and renamed in the copies' text).
 */
export function cloneSteps(steps: CanvasStep[], existingKeys: Set<string>, offset = { x: 40, y: 60 }): CanvasStep[] {
  const ids = new Map(steps.map(s => [s.id ?? '', newId('st')]));
  const keys = new Map<string, string>();
  const taken = new Set(existingKeys);
  for (const s of steps) {
    if (!s.outputKey) continue;
    const base = s.outputKey.replace(/_\d+$/, '');   // a copy of title_2 becomes title_3, not title_2_2
    let n = 2, key = `${base}_${n}`;
    while (taken.has(key)) key = `${base}_${++n}`;
    taken.add(key);
    keys.set(s.outputKey, key);
  }
  const target = (t: string | null | undefined) => (t && ids.has(t) ? ids.get(t)! : t ?? null);
  const rename = (text: string) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (keys.has(k) ? `{{${keys.get(k)}}}` : m));
  return steps.map(s => {
    const copy: CanvasStep = structuredClone(s);
    copy.id = ids.get(s.id ?? '');
    copy.value = rename(s.value);
    copy.x = (s.x ?? 0) + offset.x;
    copy.y = (s.y ?? 0) + offset.y;
    copy.next = target(s.next);
    copy.outputKey = s.outputKey ? keys.get(s.outputKey)! : s.outputKey;
    copy.forEach = s.forEach && keys.has(s.forEach) ? keys.get(s.forEach)! : s.forEach;
    copy.branches = s.branches?.map(b => ({ ...b, id: newId('br'), target: target(b.target) }));
    const back = copy.options?.['retryFrom'];
    if (typeof back === 'string' && ids.has(back)) copy.options = { ...copy.options, retryFrom: ids.get(back) };
    return copy;
  });
}

/** Undo / redo over snapshots of the agent (JSON), newest last; at most `limit` steps back. */
export class EditHistory {
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private current: string | null = null;

  constructor(private readonly limit = 50) {}

  /** The agent now; a change since the last call becomes one undo step. */
  record(snapshot: string): void {
    if (this.current === null) { this.current = snapshot; return; }
    if (snapshot === this.current) return;
    this.undoStack.push(this.current);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    this.current = snapshot;
  }

  /** The agent as it is now, without making it a step (after applying an undo / redo). */
  sync(snapshot: string): void { this.current = snapshot; }

  /** Start over from this snapshot (after a load or save). */
  reset(snapshot: string): void { this.undoStack = []; this.redoStack = []; this.current = snapshot; }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  undo(): string | null {
    const prev = this.undoStack.pop();
    if (prev === undefined || this.current === null) return null;
    this.redoStack.push(this.current);
    this.current = prev;
    return prev;
  }

  redo(): string | null {
    const next = this.redoStack.pop();
    if (next === undefined || this.current === null) return null;
    this.undoStack.push(this.current);
    this.current = next;
    return next;
  }
}
