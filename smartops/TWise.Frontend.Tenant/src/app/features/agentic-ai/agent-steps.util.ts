import { AgentStep, AgentType } from './agents.service';

/** Routers and step links only mean something where steps run one after another. */
export const routes = (type: AgentType) => type === 'sequential' || type === 'loop';

/**
 * The steps as they are saved: blank instructions are dropped and links to them go to the following step / the answer
 * (as when a step is removed on the Canvas). Agents whose steps do not run in order keep no `next` links: the Canvas
 * hides them there, so a link left from an earlier Sequential layout would block saving with nothing to remove.
 */
export function stepsToSave(steps: AgentStep[], type: AgentType): AgentStep[] {
  const kept = steps.filter(s => s.text.trim());
  const dropped = new Set(steps.filter(s => !s.text.trim() && s.id).map(s => s.id!));
  const live = (target?: string | null) => (target && dropped.has(target) ? null : target ?? null);
  return kept.map(s => ({
    ...s,
    text: s.text.trim(),
    next: routes(type) ? live(s.next) : null,
    branches: s.branches ? s.branches.map(b => ({ ...b, target: live(b.target) })) : s.branches ?? null,
  }));
}

/**
 * The text of the step the links lead back to, or null. Same walk as the runtime (graph.py _check_no_cycle) and the
 * Tenant API validator: within one run (or one loop round) a step is reached at most once; unknown targets end the path.
 */
export function circleAt(steps: AgentStep[], type: AgentType): string | null {
  return walk(steps, type).circle;
}

/**
 * The text of the first step no path from the start reaches (a router dropped on the Canvas with nothing linking
 * to it), or null. Checked on save, as the Tenant API does: such a step is saved but never runs.
 */
export function neverReached(steps: AgentStep[], type: AgentType): string | null {
  const { circle, reached } = walk(steps, type);
  if (circle !== null || !reached) return null;
  const i = reached.findIndex(r => !r);
  return i < 0 ? null : steps[i].text;
}

function walk(steps: AgentStep[], type: AgentType): { circle: string | null; reached: boolean[] | null } {
  if (!routes(type) || !steps.length) return { circle: null, reached: null };
  const index = new Map<string, number>();
  steps.forEach((s, i) => { if (s.id && !index.has(s.id)) index.set(s.id, i); });
  const to = (target?: string | null) => (!target || target === 'answer' ? undefined : index.get(target));
  const next = (i: number): (number | undefined)[] => {
    const s = steps[i];
    if (s.kind === 'router') return (s.branches ?? []).map(b => to(b.target));
    if (s.next) return [to(s.next)];
    return [i + 1 < steps.length ? i + 1 : undefined];
  };

  const state = new Array<number>(steps.length).fill(0);   // 1 = on the current path, 2 = done
  const visit = (i: number): string | null => {
    if (state[i] === 2) return null;
    if (state[i] === 1) return steps[i].text;
    state[i] = 1;
    for (const n of next(i)) {
      const hit = n === undefined ? null : visit(n);
      if (hit !== null) return hit;
    }
    state[i] = 2;
    return null;
  };
  const circle = visit(0);
  return { circle, reached: state.map(s => s !== 0) };
}
