namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// One verified SQL query of an Agentic Feature (Slippage, Daily Report), core.AiFeatureQuery. The agent runtime keeps
/// no SQL: the Tenant API sends these with every request. SeedHash is the seed text the row was copied from (null once
/// edited), so a newer seed replaces only queries nobody changed.
/// </summary>
public class AiFeatureQuery
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string Feature { get; set; } = "";
    public string QueryKey { get; set; } = "";
    public string Label { get; set; } = "";
    public string? Description { get; set; }
    public string SqlText { get; set; } = "";
    public string ParamsJson { get; set; } = "[]";
    public string ColumnsJson { get; set; } = "[]";
    public string? SeedHash { get; set; }
    public string ModifiedBy { get; set; } = "";
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>
/// A verified AI answer of an Agentic Feature (Daily Report's briefs and questions), core.AiFeatureAnswer. AnswerKey
/// is the agent runtime's content hash of everything the answer rests on (data, prompts, model, settings): the answer
/// is sent back with later requests and reused only for exactly that input, so a restart of the runtime loses none
/// and a brief prepared in the background is ready when the page opens.
/// </summary>
public class AiFeatureAnswer
{
    public long TenantId { get; set; }
    public string Feature { get; set; } = "";
    public string AnswerKey { get; set; } = "";
    public DateOnly ReportDate { get; set; }
    public string Kind { get; set; } = "";
    public string? Scope { get; set; }
    public string Draft { get; set; } = "";
    public string? Verification { get; set; }
    public string? Model { get; set; }
    public string? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UsedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A long operation of an Agentic Feature (Data Anomaly compile / run / discover), core.AiFeatureJob. At most
/// one queued or running job per tenant and feature (a filtered unique index).</summary>
public class AiFeatureJob
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string Feature { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Status { get; set; } = AiFeatureJobStatus.Queued;
    public string? RequestJson { get; set; }
    public string? ProgressJson { get; set; }
    public string? ResultJson { get; set; }
    public string? Error { get; set; }
    public string RequestedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public DateTime? HeartbeatAt { get; set; }
}

public static class AiFeatureJobStatus
{
    public const string Queued = "queued";
    public const string Running = "running";
    public const string Succeeded = "succeeded";
    public const string Failed = "failed";
    public const string Cancelled = "cancelled";

    public static bool IsActive(string status) => status is Queued or Running;
}

/// <summary>A Data Anomaly rule in plain English (core.AnomalyRule). DefinitionJson holds the whole rule as the agent
/// runtime reads it; the other columns repeat what lists and filters need.</summary>
public class AnomalyRule
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string RuleId { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Category { get; set; }
    public string Severity { get; set; } = "medium";
    public string Status { get; set; } = "active";
    public string Source { get; set; } = "declared";
    public string DefinitionJson { get; set; } = "{}";
    public string? SeedHash { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string ModifiedBy { get; set; } = "";
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>The SQL the AI compiled for a rule (or one member of a rule family), core.AnomalyProbe.</summary>
public class AnomalyProbe
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string ProbeId { get; set; } = "";
    public string RuleId { get; set; } = "";
    public string Status { get; set; } = "";
    public string ProbeJson { get; set; } = "{}";
    public DateTime CompiledAt { get; set; } = DateTime.UtcNow;
}

/// <summary>One detection run, core.AnomalyRun. ResultJson is the runtime's result (findings, summary, coverage).</summary>
public class AnomalyRun
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string RunId { get; set; } = "";
    public string Status { get; set; } = "";
    public string? DatabaseName { get; set; }
    public DateTime StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public decimal? Score { get; set; }
    public int? ProbesRun { get; set; }
    public long? RecordsExamined { get; set; }
    public long? RecordsFlagged { get; set; }
    public string? RuleSetFingerprint { get; set; }
    public string? ResultJson { get; set; }
    public string? Error { get; set; }
    public string StartedBy { get; set; } = "";
}

/// <summary>A run's Word or Excel report, core.AnomalyRunReport.</summary>
public class AnomalyRunReport
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string RunId { get; set; } = "";
    public string Format { get; set; } = "";
    public string FileName { get; set; } = "";
    public byte[] Content { get; set; } = [];
    public long SizeBytes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>A rule proposed by Discover, until an admin accepts (it becomes a rule) or rejects it, core.AnomalyProposal.</summary>
public class AnomalyProposal
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string ProposalHash { get; set; } = "";
    public string Status { get; set; } = "pending";
    public string Title { get; set; } = "";
    public string ProposalJson { get; set; } = "{}";
    public string? RuleId { get; set; }
    public string? Reason { get; set; }
    public string? DecidedBy { get; set; }
    public DateTime? DecidedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
