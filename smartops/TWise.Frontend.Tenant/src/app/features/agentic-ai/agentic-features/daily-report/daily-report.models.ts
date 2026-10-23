/**
 * Response shapes of the Daily Report feature, exactly as the agent runtime returns them (snake_case; the Tenant API
 * passes the bodies through). Source: agent_runtime/app/features/dailyreport/schemas.py and agent/service.py.
 * Quantities travel as strings so the database's exact decimal reaches the page.
 */

export interface RecentDate { report_date: string; row_count: number; well_count: number }
export interface RecentDatesResponse { dates: RecentDate[] }

export interface DailyTask {
  task_daily_id: number; well_id: number; action_on: string; schedule_id: number | null; task_code: string | null;
  activity_id: string | null; activity_code: string | null; activity_description: string | null; wbs: string | null;
  crew_code: string | null; uom_id: number | null; uom_code: string | null; activity_uom: string | null;
  crew_id: number | null; crew_type_name: string | null; crew_type_code: string | null; crew_instance_code: string | null;
  crew_supervisor: string | null; crew_employees: string[];
  planned_start: string | null; planned_end: string | null; actual_start: string | null; actual_end: string | null;
  planned: string | null; actual_quantity: string | null; progress: string | null; daily_completed: boolean | null;
  ph_name: string | null; quantity_status: string; mapping_status: string; crew_match_status: string;
  start_date_status: string; end_date_status: string; data_quality_flags: string[];
  group_row_count: number; group_actual_entry_count: number;
}

export interface GroupQuantities {
  well_count: number; task_count: number; uom_code: string | null; uom_codes: string[]; quantities_summable: boolean;
  planned_quantity: string | null; actual_quantity: string | null; data_quality_counts: Record<string, number>;
}
export interface ActivityGroup extends GroupQuantities {
  activity_code: string | null; activity_description: string | null; wbs: string | null; status: string;
}
export interface WbsGroup extends GroupQuantities { wbs: string | null; status: string; activities: ActivityGroup[] }
export interface StatusGroup extends GroupQuantities { status: string; wbs_groups: WbsGroup[] }

export interface DayTotals { task_count: number; well_count: number; status_counts: Record<string, number> }
export interface DataQuality {
  flag_counts: Record<string, number>; affected_task_count: number; raw_row_count: number; logical_task_count: number;
  superseded_row_count: number; multi_row_task_count: number; duplicate_actual_task_count: number;
  invalid_json_row_count: number; unparseable_actual_row_count: number;
}

export interface SummaryResponse {
  report_date: string; generated_at: string; totals: DayTotals; data_quality: DataQuality;
  status_groups: StatusGroup[]; view_mode: 'detail' | 'grouped' | string; detail_view_task_threshold: number;
  tasks: DailyTask[];
}

export interface WellTaskSummary {
  well_id: number; task_count: number; status_counts: Record<string, number>;
  planned_quantity: string | null; actual_quantity: string | null; uom_code: string | null;
}

export interface GroupDetailsResponse {
  report_date: string;
  filters: { status: string | null; wbs: string | null; activity_code: string | null; uom: string | null };
  task_count: number; well_count: number; wells: WellTaskSummary[]; tasks: DailyTask[];
}

/** One logical task in its latest state as of the date (open work). */
export interface LogicalTask {
  well_id: number; schedule_id: number | null; task_code: string | null; task_state: string;
  last_task_date: string | null; actual_start: string | null; actual_end: string | null; completed: boolean | null;
  activity_id: string | null; activity_code: string | null; activity_description: string | null; wbs: string | null;
}

export interface WellActivity {
  well_id: number; today_reported_task_count: number; has_task_on_report_date: boolean; open_task_count: number;
  incomplete_task_count: number; ongoing_task_count: number; not_started_task_count: number;
  ended_not_completed_task_count: number; completed_task_count: number; logical_task_count: number;
  task_state_counts: Record<string, number>; last_task_date: string | null;
}
export interface WellActivityResponse { report_date: string; well_count: number; wells: WellActivity[]; tasks: LogicalTask[] }

export interface WellDetailResponse {
  report_date: string; well_id: number; task_count: number; tasks: DailyTask[];
  activity: WellActivity | null; open_tasks: LogicalTask[];
}

export interface MilestoneAlert {
  well_id: number; milestone: string; milestone_label: string; deadline_date: string; days_remaining: number;
  overdue: boolean; pegged_date: string | null; flaf_issue_date: string | null; ex_rig_on_date: string | null;
  rig_on_date: string | null; ex_rig_off_date: string | null; rig_off_date: string | null;
}
export interface MilestonesResponse {
  generated_at: string; window_days: number; upcoming: MilestoneAlert[]; overdue_count: number; overdue: MilestoneAlert[];
}

// ── The agents (brief / ask) ─────────────────────────────────────────────────────────────────────────────────────

export interface AgentVerification { passed?: boolean; issues?: string[]; checked_numbers?: number; llm_second_opinion?: boolean }
export interface AgentPlanStep { tool: string; args?: Record<string, unknown>; why?: string }
export interface AgentTraceStep {
  node?: string; tool?: string; args?: Record<string, unknown>; why?: string; mode?: string; ok?: boolean;
  error?: string | null; passed?: boolean; issues?: number; model?: string; duration_s?: number;
  /** verify: why the checker rejected the draft. write: "patch" fixed only `sentences` sentences. */
  reasons?: string[]; sentences?: number; [key: string]: unknown;
}
export interface SqlSource { label: string; file: string; parameters?: string[]; sql: string }
export interface ProofRow {
  well_id: number; task_code: string | null; schedule_id: number | null; activity_code: string | null;
  description: string | null; wbs: string | null; task_state: string; counts_as_incomplete: boolean;
  counts_as_ongoing: boolean; completed: boolean; actual_start: string | null; actual_end: string | null;
  last_task_date: string | null; reason: string;
}

export interface CrewCandidate {
  crew_id: number; crew_type: string | null; supervisor: string | null; historical_completed_task_count: number;
  distinct_completed_well_count: number; typical_completion_days: number | null; most_recent_success_date: string | null;
  evidence_strength?: string; derived_availability?: string;
}
export interface CrewSuggestion {
  eligible?: boolean; suppression_reason?: string | null;
  current_crew?: { crew_id: number | null; recorded: boolean; crew_type: string | null; supervisor: string | null };
  suggested_crew?: CrewCandidate; consult_crew?: CrewCandidate; no_suggestion_reason?: string;
}

/** A brief or an answer. available:false carries the reason in error and never any invented text. */
export interface AgentAnswer {
  report_date: string; kind: 'brief' | 'ask'; scope: string | null; question?: string | null; available: boolean;
  explanation?: string | null; error?: string | null; model?: string | null; models?: Record<string, string>;
  cached?: boolean; verified?: boolean; verification?: AgentVerification; revisions?: number;
  plan?: AgentPlanStep[]; trace?: AgentTraceStep[]; evidence?: Record<string, any>;
  evidence_withheld_from_model?: string[]; sql_sources?: SqlSource[]; proof?: ProofRow[]; proof_note?: string | null;
  duration_s?: number;
}

/** One async call's state on the page. */
export interface Load<T> { loading: boolean; error: string; data: T | null }

export function idle<T>(): Load<T> { return { loading: false, error: '', data: null }; }

/** A brief while it streams: the text written so far (live) and what the agent is doing (stage), then the checked answer. */
export interface BriefLoad extends Load<AgentAnswer> {
  /** The brief saved for the date, shown the moment it is asked for, until the check against the data ends. */
  preview: string;
  live: string;
  stage: '' | 'data' | 'writing' | 'checking' | 'revising' | 'reused';
  stop?: () => void;
}
