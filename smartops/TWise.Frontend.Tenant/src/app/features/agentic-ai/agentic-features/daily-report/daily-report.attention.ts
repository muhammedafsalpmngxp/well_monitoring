/**
 * "Needs attention": what a reader should look at first on the Daily Report page, as a short list of plain sentences.
 *
 * Each rule below is one condition and one sentence. To add, remove or reword a rule, change only that rule. The rules
 * read figures the page already has (the runtime's counts); they calculate nothing of their own.
 */
import { QUANTITY_STATUS } from './daily-report.glossary';

export type AttentionTone = 'bad' | 'warn' | 'info' | 'ok';

/** Where a "Show" link takes the reader. */
export type AttentionAction =
  | { kind: 'group'; status: string }
  | { kind: 'wells' }
  | { kind: 'quality' }
  | { kind: 'milestones' };

export interface AttentionItem {
  id: string;
  tone: AttentionTone;
  text: string;
  action?: AttentionAction;
  actionLabel?: string;
}

/** What the rules read. A figure that is not loaded yet is null, and its rule stays quiet. */
export interface AttentionInput {
  taskCount: number;
  statusCounts: Record<string, number>;
  /** Tasks with a problem in how they were entered. */
  flaggedTasks: number;
  /** Wells with open work that reported no task on the report date. */
  wellsWithoutEntry: number | null;
  /** Milestone deadlines already past, and those inside the window (counted from today, not the report date). */
  overdueMilestones: number | null;
  upcomingMilestones: number | null;
  windowDays: number;
}

const plural = (n: number, one: string, many: string): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

type Rule = (i: AttentionInput) => AttentionItem | null;

/** In the order they are shown: what stops the day being read first, then open work, then deadlines. */
const RULES: Rule[] = [
  i => i.taskCount === 0
    ? { id: 'no-tasks', tone: 'warn', text: 'No task was reported on this date. Pick another date, or see the wells with open work below.' }
    : null,

  i => {
    const n = i.statusCounts['NO_ACTUAL'] ?? 0;
    if (!n || !i.taskCount) return null;
    const text = n === i.taskCount
      ? `None of the ${plural(i.taskCount, 'task', 'tasks')} reported has an amount done entered yet.`
      : `${plural(n, 'task has', 'tasks have')} no amount done entered yet, out of ${i.taskCount.toLocaleString('en-US')} reported.`;
    return { id: 'nothing-entered', tone: 'bad', text, action: { kind: 'group', status: 'NO_ACTUAL' }, actionLabel: 'Show these tasks' };
  },

  i => {
    const n = i.statusCounts['BELOW_PLAN'] ?? 0;
    return n ? { id: 'below-plan', tone: 'warn', text: `${plural(n, 'task is', 'tasks are')} below plan: less was done than planned.`,
      action: { kind: 'group', status: 'BELOW_PLAN' }, actionLabel: 'Show these tasks' } : null;
  },

  i => {
    const n = i.statusCounts['NOT_VALIDATED'] ?? 0;
    return n ? { id: 'no-plan', tone: 'info', text: `${plural(n, 'task has', 'tasks have')} an amount entered but no planned amount to compare it with.`,
      action: { kind: 'group', status: 'NOT_VALIDATED' }, actionLabel: 'Show these tasks' } : null;
  },

  i => i.flaggedTasks > 0
    ? { id: 'entry-problems', tone: 'warn', text: `${plural(i.flaggedTasks, 'task has', 'tasks have')} a problem in how it was entered (see Data quality). The amounts are not changed.`,
        action: { kind: 'quality' }, actionLabel: 'See the problems' }
    : null,

  i => i.wellsWithoutEntry
    ? { id: 'wells-without-entry', tone: 'warn', text: `${plural(i.wellsWithoutEntry, 'well still has', 'wells still have')} open work but no task reported on this date.`,
        action: { kind: 'wells' }, actionLabel: 'Show the wells' }
    : null,

  i => i.overdueMilestones
    ? { id: 'overdue-milestones', tone: 'bad', text: `${plural(i.overdueMilestones, 'milestone deadline is', 'milestone deadlines are')} already overdue: the milestone was not reached by its deadline (counted from today).`,
        action: { kind: 'milestones' }, actionLabel: 'See the deadlines' }
    : null,

  i => i.upcomingMilestones
    ? { id: 'upcoming-milestones', tone: 'info', text: `${plural(i.upcomingMilestones, 'milestone is', 'milestones are')} due within the next ${plural(i.windowDays, 'day', 'days')}.`,
        action: { kind: 'milestones' }, actionLabel: 'See the deadlines' }
    : null,
];

/** The items to show, most urgent first as listed above. When no rule fires the list says so instead of staying empty. */
export function attentionItems(input: AttentionInput): AttentionItem[] {
  const items = RULES.map(rule => rule(input)).filter((i): i is AttentionItem => i !== null);
  return items.length ? items : [{ id: 'all-clear', tone: 'ok', text: 'Nothing needs attention on this date.' }];
}

/** The status the "Show these tasks" links name, for the tooltip of the link. */
export function attentionHint(item: AttentionItem): string {
  return item.action?.kind === 'group' ? (QUANTITY_STATUS[item.action.status]?.tip ?? '') : '';
}
