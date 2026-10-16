import { describe, expect, it } from 'vitest';
import { AgentStep } from './agents.service';
import { circleAt, neverReached, stepsToSave } from './agent-steps.util';

const step = (id: string, text = id.toUpperCase(), more: Partial<AgentStep> = {}): AgentStep => ({ id, text, kind: 'step', ...more });
const router = (id: string, targets: (string | null)[]): AgentStep => ({
  id, text: 'Route', kind: 'router', routeBy: 'rules',
  branches: targets.map((target, i) => ({ id: `${id}-b${i}`, op: i === targets.length - 1 ? 'else' : 'equals', target })),
});

describe('circleAt', () => {
  it('finds a link back to an earlier step', () => {
    expect(circleAt([step('a'), step('b'), step('c', 'C', { next: 'a' })], 'sequential')).toBe('A');
    expect(circleAt([step('a'), step('b'), step('c', 'C', { next: 'a' })], 'loop')).toBe('A');
  });

  it('finds a router branch back to an earlier step', () => {
    expect(circleAt([step('a'), router('r', ['a', 'answer'])], 'sequential')).toBe('A');
  });

  it('accepts forward links, the answer and branches that skip ahead', () => {
    expect(circleAt([step('a', 'A', { next: 'c' }), step('b'), step('c', 'C', { next: 'answer' })], 'sequential')).toBeNull();
    expect(circleAt([router('r', ['b', null]), step('a'), step('b')], 'sequential')).toBeNull();
  });

  it('ignores links in agents whose steps do not run in order', () => {
    expect(circleAt([step('a'), step('b', 'B', { next: 'a' })], 'parallel')).toBeNull();
  });
});

describe('neverReached', () => {
  it('finds a router nothing links to', () => {
    // What the Canvas used to build: the last step ends at the answer and the router dropped after it never runs.
    expect(neverReached([step('a', 'A', { next: 'answer' }), router('r', ['answer'])], 'sequential')).toBe('Route');
  });

  it('accepts a router the last step leads into, and steps reached by a branch', () => {
    expect(neverReached([step('a', 'A', { next: 'r' }), router('r', ['c', null]), step('c')], 'sequential')).toBeNull();
    expect(neverReached([step('a'), step('b')], 'sequential')).toBeNull();
  });

  it('ignores agent types whose steps all run', () => {
    expect(neverReached([step('a', 'A', { next: 'answer' }), step('b')], 'parallel')).toBeNull();
  });
});

describe('stepsToSave', () => {
  it('drops blank steps and points links to them at the following step', () => {
    const saved = stepsToSave([step('a', 'A', { next: 'b' }), step('b', '   '), router('r', ['b', 'answer']), step('c')], 'sequential');
    expect(saved.map(s => s.id)).toEqual(['a', 'r', 'c']);
    expect(saved[0].next).toBeNull();
    expect(saved[1].branches!.map(b => b.target)).toEqual([null, 'answer']);
  });

  it('keeps links that still have a target and trims the text', () => {
    const saved = stepsToSave([step('a', '  Ask  ', { next: 'c' }), step('c')], 'loop');
    expect(saved[0]).toMatchObject({ text: 'Ask', next: 'c' });
  });

  it('drops step links left over when the agent is no longer sequential', () => {
    // A router added and removed on the Canvas leaves the last step ending at the answer.
    const saved = stepsToSave([step('a'), step('b', 'B', { next: 'answer' })], 'parallel');
    expect(saved.every(s => s.next === null)).toBe(true);
  });
});
