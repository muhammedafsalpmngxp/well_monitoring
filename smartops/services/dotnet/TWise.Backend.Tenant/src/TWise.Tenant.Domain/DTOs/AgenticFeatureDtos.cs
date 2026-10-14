using System.Text.Json;

namespace TWise.Tenant.Domain.DTOs;

/// <summary>
/// The tables an Agentic Feature may read (AI Settings → Ask Data & Features → the feature). A table is readable when it is not
/// excluded and either listed in IncludedTables or, when that list is empty, in one of AllowedSchemas.
/// </summary>
public record FeatureAccessDto(
    IReadOnlyList<string> AllowedSchemas,
    IReadOnlyList<string> IncludedTables,
    IReadOnlyList<string> ExcludedTables,
    IReadOnlyList<string> ExcludedColumns)
{
    public static readonly FeatureAccessDto Empty = new([], [], [], []);
}

/// <summary>One setting of an Agentic Feature, as AI Settings → Ask Data & Features shows it. Type: int | decimal | bool | text |
/// list | enum | map. Min / Max bound numbers (and map values); Options are the enum's values.</summary>
public record FeatureSettingDefinitionDto(string Key, string Label, string Help, string Group, string Type, JsonElement Default,
    double? Min, double? Max, IReadOnlyList<string> Options);

/// <summary>
/// An Agentic Feature's settings page. AccessMode "tables": the admin ticks the tables it may read (Slippage, Daily
/// Report, whose verified SQL reads fixed tables, listed in QueryTables). AccessMode "schemas": the admin chooses
/// schemas and hidden tables / columns, as for Ask Data (Data Anomaly, whose AI writes the SQL).
/// </summary>
public record AgenticFeatureSettingsDto(
    string Feature,
    string Title,
    string Description,
    string AccessMode,
    IReadOnlyList<FeatureSettingDefinitionDto> Definitions,
    IReadOnlyDictionary<string, JsonElement> Values,
    FeatureAccessDto Access,
    FeatureAccessDto DefaultAccess,
    IReadOnlyList<string> QueryTables,
    bool Customized,
    string? ModifiedBy,
    DateTime? ModifiedAt);

public record SaveAgenticFeatureSettingsRequest(IReadOnlyDictionary<string, JsonElement>? Values, FeatureAccessDto? Access);

/// <summary>The Agentic Features the signed-in user may open, for the landing page.</summary>
public record AgenticFeatureSummaryDto(string Feature, string Title, string Description, string Route, string ModuleCode,
    bool AiEnabled, bool Configured);

/// <summary>A verified query as the feature pages show it (read-only).</summary>
public record AgenticFeatureQueryDto(string Key, string Label, string? Description, string Sql, IReadOnlyList<string> Params,
    IReadOnlyList<string> Columns, DateTime ModifiedAt, bool Edited);

/// <summary>A long operation of a feature (Data Anomaly compile / run / discover).</summary>
public record AiFeatureJobDto(long Id, string Feature, string Kind, string Status, JsonElement? Request, JsonElement? Progress,
    JsonElement? Result, string? Error, string RequestedBy, DateTime CreatedAt, DateTime? StartedAt, DateTime? FinishedAt);

/// <summary>Slippage: one verified query (well_slippage, activity_summary, crew_availability; activity_delay needs WellId).</summary>
public record SlippageQueryRequest(string? Key, string? WellId);

/// <summary>Slippage advisor: why a well (or, with TaskCode, one late task) is delayed and how to recover. Fresh asks the
/// model again instead of reusing an answer that rests on the same data.</summary>
public record SlippageAdviseRequest(string? WellId, string? TaskCode, bool Fresh);

/// <summary>Daily Report: a figure of one report date. Refresh reads the database again instead of the short-lived cache.
/// The group filters (Status, Wbs, ActivityCode, Uom) select the tasks behind one summary figure; WellId one well.</summary>
public record DailyReportDayRequest(DateOnly? ReportDate, bool Refresh, string? Status, string? Wbs, string? ActivityCode,
    string? Uom, long? WellId);

/// <summary>Daily Report: deadlines due within WindowDays (the setting when null) of Today (the user's date).</summary>
public record DailyReportMilestonesRequest(int? WindowDays, DateOnly? Today);

/// <summary>Daily Report AI brief: Scope day, well (WellId) or task (TaskDailyId). Today is the user's date.</summary>
public record DailyReportBriefRequest(DateOnly? ReportDate, string? Scope, long? WellId, long? TaskDailyId, DateOnly? Today);

/// <summary>Daily Report: a free question about one report date, answered by the agent from the report's data.</summary>
public record DailyReportAskRequest(DateOnly? ReportDate, string? Question, DateOnly? Today);

/// <summary>Data Anomaly: start a compile (the AI writes and checks each rule's SQL), a run (the checks run, scored, with
/// Excel / Word reports) or a discover (the AI proposes new rules). One job at a time per tenant.</summary>
public record StartAnomalyJobRequest(string Kind, IReadOnlyList<string>? RuleIds, bool Force, bool RetryFailed,
    IReadOnlyList<string>? Formats, int? MaxProposals);

/// <summary>A Data Anomaly rule with how its compiled check stands. ProbeStatus: active | failed | not_applicable |
/// disabled, null when not compiled yet; a family rule (expandsOver) has one probe per member (Probes counts them).</summary>
public record AnomalyRuleDto(string RuleId, string Title, string? Category, string Severity, string Status, string Source,
    JsonElement Definition, string? ProbeStatus, int Probes, int FailedProbes, string? ProbeError, DateTime? CompiledAt, bool Edited,
    string ModifiedBy, DateTime ModifiedAt);

public record SetAnomalyRuleStatusRequest(string? Status);

/// <summary>One detection run for lists. Reports: the formats that can be downloaded.</summary>
public record AnomalyRunSummaryDto(string RunId, string Status, string? DatabaseName, DateTime StartedAt, DateTime? FinishedAt,
    decimal? Score, int? ProbesRun, long? RecordsExamined, long? RecordsFlagged, string StartedBy, string? Error,
    IReadOnlyList<string> Reports);

/// <summary>A run with its whole result (findings ranked worst first, totals, coverage, summary).</summary>
public record AnomalyRunDto(AnomalyRunSummaryDto Run, JsonElement? Result);

public record AnomalyProposalDto(long Id, string Hash, string Status, string Title, JsonElement Proposal, string? RuleId,
    string? Reason, string? DecidedBy, DateTime? DecidedAt, DateTime CreatedAt);

/// <summary>Accept (it becomes a rule, by default on probation) or reject (Discover will not propose it again).</summary>
public record DecideAnomalyProposalRequest(string? RuleId, string? Status, string? Reason);

/// <summary>The Data Anomaly dashboard: latest run, rules and compiled checks by status, proposals waiting, the job in
/// progress, and whether the feature can run (tables chosen, AI on).</summary>
public record AnomalyOverviewDto(AnomalyRunSummaryDto? LatestRun, IReadOnlyDictionary<string, int> RulesByStatus,
    IReadOnlyDictionary<string, int> ProbesByStatus, int PendingProposals, AiFeatureJobDto? ActiveJob, AiFeatureJobDto? LastJob,
    bool Configured, bool AiEnabled);
