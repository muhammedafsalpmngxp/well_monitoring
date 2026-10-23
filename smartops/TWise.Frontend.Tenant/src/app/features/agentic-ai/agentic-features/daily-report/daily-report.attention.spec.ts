import { describe, expect, it } from 'vitest';
import { AttentionInput, attentionHint, attentionItems } from './daily-report.attention';

const day = (over: Partial<AttentionInput> = {}): AttentionInput => ({
  taskCount: 22,
  statusCounts: { ON_PLAN: 0, ABOVE_PLAN: 0, BELOW_PLAN: 0, NO_ACTUAL: 0, NOT_VALIDATED: 0 },
  flaggedTasks: 0,
  wellsWithoutEntry: 0,
  overdueMilestones: 0,
  upcomingMilestones: 0,
  windowDays: 7,
  ...over,
});

const ids = (i: AttentionInput) => attentionItems(i).map(a => a.id);

describe('Needs attention', () => {
  it('says so when there is nothing to flag, instead of showing an empty box', () => {
    expect(attentionItems(day())).toEqual([{ id: 'all-clear', tone: 'ok', text: 'Nothing needs attention on this date.' }]);
  });

  it('flags a day on which nothing was entered, in plain words, with a link to the tasks', () => {
    const [item] = attentionItems(day({ statusCounts: { NO_ACTUAL: 22 } }));
    expect(item.id).toBe('nothing-entered');
    expect(item.tone).toBe('bad');
    expect(item.text).toBe('None of the 22 tasks reported has an amount done entered yet.');
    expect(item.action).toEqual({ kind: 'group', status: 'NO_ACTUAL' });
    expect(attentionHint(item)).toContain('does not mean no work happened');
  });

  it('counts a partly entered day', () => {
    const [item] = attentionItems(day({ statusCounts: { NO_ACTUAL: 1 } }));
    expect(item.text).toBe('1 task has no amount done entered yet, out of 22 reported.');
  });

  it('uses the singular and the plural correctly', () => {
    expect(attentionItems(day({ wellsWithoutEntry: 1 }))[0].text).toBe('1 well still has open work but no task reported on this date.');
    expect(attentionItems(day({ wellsWithoutEntry: 185 }))[0].text).toBe('185 wells still have open work but no task reported on this date.');
    expect(attentionItems(day({ upcomingMilestones: 1, windowDays: 1 }))[0].text).toBe('1 milestone is due within the next 1 day.');
  });

  it('keeps the rules in order: day entries, entry problems, wells, then deadlines', () => {
    expect(ids(day({ statusCounts: { NO_ACTUAL: 5, BELOW_PLAN: 2, NOT_VALIDATED: 1 }, flaggedTasks: 3, wellsWithoutEntry: 9,
      overdueMilestones: 4, upcomingMilestones: 2 })))
      .toEqual(['nothing-entered', 'below-plan', 'no-plan', 'entry-problems', 'wells-without-entry', 'overdue-milestones', 'upcoming-milestones']);
  });

  it('reports a day with no task, and does not call it "nothing to flag"', () => {
    const items = attentionItems(day({ taskCount: 0, statusCounts: {} }));
    expect(items.map(i => i.id)).toEqual(['no-tasks']);
  });

  it('keeps a rule quiet while its figure is not loaded', () => {
    expect(ids(day({ wellsWithoutEntry: null, overdueMilestones: null, upcomingMilestones: null }))).toEqual(['all-clear']);
  });

  it('says deadlines are counted from today, not the report date', () => {
    expect(attentionItems(day({ overdueMilestones: 446 }))[0].text).toBe('446 milestone deadlines are already overdue: the milestone was not reached by its deadline (counted from today).');
  });

  it('gives every link a label', () => {
    const all = attentionItems(day({ statusCounts: { NO_ACTUAL: 5, BELOW_PLAN: 2, NOT_VALIDATED: 1 }, flaggedTasks: 3, wellsWithoutEntry: 9,
      overdueMilestones: 4, upcomingMilestones: 2 }));
    for (const item of all) expect(item.action && !item.actionLabel, item.id).toBeFalsy();
  });
});
