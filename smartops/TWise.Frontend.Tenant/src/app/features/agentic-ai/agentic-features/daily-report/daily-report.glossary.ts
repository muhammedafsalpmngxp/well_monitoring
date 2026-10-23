/**
 * The words of the Daily Report page, in one place. Every label a reader sees for a code, a column or a figure, and the
 * one-line explanation behind it, is written here and nowhere else: to reword the page, change this file.
 *
 * Only the text shown changes. The codes underneath (NO_ACTUAL, ON_PLAN, ...) stay what the API sends, so filters,
 * drill-downs and the Excel export keep working. A code missing here is shown the generic way (NO_ACTUAL → "No actual"),
 * never dropped.
 */

export interface Term {
  /** What is written on the page. */
  label: string;
  /** One sentence in plain words, shown as a tooltip and in the "How to read this page" legend. */
  tip: string;
}

// ── Codes the API sends ──────────────────────────────────────────────────────────────────────────────────────────

/** What a task's amount done is compared with (quantity status). */
export const QUANTITY_STATUS: Record<string, Term> = {
  ON_PLAN: { label: 'On plan', tip: 'The amount reported done equals the amount planned.' },
  ABOVE_PLAN: { label: 'Above plan', tip: 'More was reported done than planned. This is not an error.' },
  BELOW_PLAN: { label: 'Below plan', tip: 'Less was reported done than planned. On its own this is not an error.' },
  NO_ACTUAL: {
    label: 'Nothing entered',
    tip: 'The task was planned for this day, but no amount done was entered. It does not mean no work happened.',
  },
  NOT_VALIDATED: {
    label: 'No plan to compare',
    tip: 'An amount done was entered, but there is no planned amount to compare it with.',
  },
};

/** The state of a task as of the report date (open work). */
export const TASK_STATE: Record<string, Term> = {
  COMPLETED: { label: 'Completed', tip: 'The task is recorded as finished.' },
  ONGOING: { label: 'Ongoing', tip: 'The task has started and has no end date yet.' },
  NOT_STARTED: { label: 'Not started', tip: 'The task has no start date yet.' },
  ENDED_NOT_COMPLETED: { label: 'Ended, not completed', tip: 'The task has an end date but is not recorded as finished.' },
};

/** A reported date against its planned date. NO_ACTUAL / NOT_VALIDATED read the same way as for quantities. */
export const DATE_STATUS: Record<string, Term> = {
  ON_TIME: { label: 'On time', tip: 'The date reported is the date planned.' },
  EARLY: { label: 'Earlier than planned', tip: 'The date reported is before the date planned.' },
  LATE: { label: 'Later than planned', tip: 'The date reported is after the date planned.' },
  NO_ACTUAL: { label: 'Not entered', tip: 'No date was entered.' },
  NOT_VALIDATED: { label: 'No plan to compare', tip: 'A date was entered, but no planned date exists to compare it with.' },
};

/** Whether the activity, description, WBS and crew of a task could be matched to the master lists. */
export const MAPPING_STATUS: Record<string, Term> = {
  MAPPED: { label: 'Matched', tip: 'The task was matched to the activity list.' },
  UNMAPPED_ACTIVITY: { label: 'Activity name missing', tip: 'The activity code is not in the activity list, so its name is unknown.' },
  UNMAPPED_DESCRIPTION: { label: 'Description missing', tip: 'The task has no description in the activity list.' },
  UNMAPPED_WBS: { label: 'WBS missing', tip: 'The task could not be matched to a WBS (work breakdown) entry.' },
  UNMAPPED_CREW: { label: 'Crew missing', tip: 'The task could not be matched to a crew.' },
};

/** The crew the plan expects against the crew recorded on the task. */
export const CREW_MATCH: Record<string, Term> = {
  MATCHED: { label: 'Same as planned', tip: 'The crew recorded is of the type the plan expects.' },
  MISMATCHED: { label: 'Different from planned', tip: 'The crew recorded is not of the type the plan expects.' },
  NOT_COMPARABLE: { label: 'Cannot compare', tip: 'The plan or the task has no crew type, so the two cannot be compared.' },
};

/** Problems found in how a task was entered. They never change the planned or actual amounts. */
export const DATA_FLAG: Record<string, Term> = {
  UNMAPPED_ACTIVITY: MAPPING_STATUS['UNMAPPED_ACTIVITY'],
  UNMAPPED_DESCRIPTION: MAPPING_STATUS['UNMAPPED_DESCRIPTION'],
  UNMAPPED_WBS: MAPPING_STATUS['UNMAPPED_WBS'],
  UNMAPPED_CREW: MAPPING_STATUS['UNMAPPED_CREW'],
  MISSING_UOM: { label: 'Unit missing', tip: 'No unit of measure (m, m³, joints...) is recorded for the task.' },
  INVALID_DAILY_JSON: { label: 'Entry unreadable', tip: 'The entry could not be read, so it was left out.' },
  UNPARSEABLE_ACTUAL_QUANTITY: { label: 'Amount unreadable', tip: 'The amount done was entered in a form that could not be read as a number.' },
  DUPLICATE_ACTUAL_ENTRY: { label: 'Amount entered twice', tip: 'The amount done was entered more than once for the same task and day.' },
  MULTIPLE_TASK_ROWS: { label: 'Task on several rows', tip: 'The task appears on more than one row; the latest one was used.' },
  MISSING_PLANNED: { label: 'No planned amount', tip: 'The task has no planned amount, so it cannot be compared.' },
  MALFORMED_TASK_CODE: { label: 'Task code looks wrong', tip: 'The task code is not in the usual form.' },
  INVALID_DATE_SEQUENCE: { label: 'End before start', tip: 'The end date is earlier than the start date.' },
};

/** Every code table, searched in this order for a code's label. */
const CODE_TABLES = [QUANTITY_STATUS, TASK_STATE, DATE_STATUS, MAPPING_STATUS, CREW_MATCH, DATA_FLAG];

export function codeTerm(code: string | null | undefined): Term | null {
  if (!code) return null;
  for (const table of CODE_TABLES) if (table[code]) return table[code];
  return null;
}

// ── Words of the page itself ─────────────────────────────────────────────────────────────────────────────────────

/** Column headings, card labels and figures. */
export const FIELD = {
  planned: { label: 'Planned', tip: 'The amount the schedule expected to be done on this day.' },
  actual: { label: 'Actual (done)', tip: 'The amount the crew reported as done on this day.' },
  progress: { label: 'Progress', tip: 'How much of the whole task is finished so far, as recorded in the schedule.' },
  status: { label: 'Status', tip: 'How the amount done compares with the amount planned.' },
  tasksReported: { label: 'Tasks reported', tip: 'Every task that has an entry on this date. Select it to see them.' },
  wellsReporting: { label: 'Wells reporting', tip: 'Wells that have at least one task entry on this date.' },
  activityToday: { label: 'Activity today', tip: 'The activity most of the well\'s tasks of the day belong to.' },
  statusToday: { label: 'Status today', tip: 'How today\'s entries of the well compare with the plan.' },
  open: { label: 'Open', tip: 'Every task of the well not recorded as completed.' },
  incomplete: { label: 'Incomplete', tip: 'Open tasks that are not ongoing: not started, or ended without being completed.' },
  ongoing: { label: 'Ongoing', tip: 'Open tasks that have started and have no end date yet.' },
  reportedToday: { label: 'Reported today', tip: 'Tasks the well reported on the report date.' },
  lastTaskDate: { label: 'Last task date', tip: 'The latest date the well appears in the task records, on or before the report date.' },
} satisfies Record<string, Term>;

/** The data-quality counters of the day. */
export const DATA_QUALITY = {
  rowsRead: { label: 'Entries read', tip: 'Every entry found for this day, before repeated ones are merged.' },
  tasks: { label: 'Tasks', tip: 'Different tasks, after repeated entries of the same task are merged.' },
  superseded: { label: 'Entries replaced', tip: 'Older entries of a task that a newer entry took the place of.' },
  severalRows: { label: 'Tasks on several rows', tip: 'Tasks entered on more than one row; the latest row was used.' },
  duplicateActual: { label: 'Amounts entered twice', tip: 'Tasks whose amount done was entered more than once.' },
  unreadableEntries: { label: 'Entries unreadable', tip: 'Entries that could not be read at all, so they were left out.' },
  unreadableAmounts: { label: 'Amounts unreadable', tip: 'Amounts done that could not be read as a number.' },
} satisfies Record<string, Term>;

/** The terms the "How to read this page" legend explains, in order. */
export const LEGEND: Term[] = [
  FIELD.planned,
  FIELD.actual,
  FIELD.progress,
  QUANTITY_STATUS['ON_PLAN'],
  QUANTITY_STATUS['ABOVE_PLAN'],
  QUANTITY_STATUS['BELOW_PLAN'],
  QUANTITY_STATUS['NO_ACTUAL'],
  QUANTITY_STATUS['NOT_VALIDATED'],
  { label: 'Open work', tip: 'Tasks of a well that are not recorded as completed: ongoing, not started, or ended without being completed.' },
];
