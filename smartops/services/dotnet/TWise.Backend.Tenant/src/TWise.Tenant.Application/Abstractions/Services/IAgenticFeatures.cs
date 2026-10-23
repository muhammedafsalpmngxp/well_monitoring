using System.Text.Json;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>One verified query as the agent runtime receives it: SQL, its ? parameters in order, its output contract.</summary>
public sealed record FeatureQueryPayload(string Sql, IReadOnlyList<string> Params, IReadOnlyList<string> Columns);

/// <summary>
/// Everything an Agentic Feature request carries to the agent runtime besides its own fields (the runtime keeps nothing
/// of a tenant's): the AI provider (null when the call needs none), the feature's prompts (core.AiPrompt), its settings
/// with defaults filled in and the tables it may read (core.AiSettings), and its verified SQL (core.AiFeatureQuery).
/// The Ask Data database is added by the runtime client.
/// </summary>
public sealed record AgenticFeatureEnvelope(
    AgentRuntimeLlm? Llm,
    IReadOnlyDictionary<string, string> Prompts,
    IReadOnlyDictionary<string, JsonElement> Settings,
    FeatureAccessDto Access,
    IReadOnlyDictionary<string, FeatureQueryPayload> Queries);

/// <summary>The agent runtime refused or failed a feature request: Status is its HTTP status (400 bad input / refused
/// SQL or table, 404 not found, 503 database or AI provider unavailable); Message is safe to show.</summary>
public sealed class AgentRuntimeException(int status, string message) : Exception(message)
{
    public int Status { get; } = status;
}

/// <summary>The request clashes with the feature's current state (e.g. a job is already running): 409 with the message.</summary>
public sealed class FeatureConflictException(string message) : Exception(message);

/// <summary>The verified SQL of Slippage and Daily Report in core.AiFeatureQuery, seeded from the feature seed.</summary>
public interface IAiFeatureQueryStore
{
    /// <summary>The feature's queries by key, as the runtime receives them (seeds or upgrades the tenant's copy first).</summary>
    Task<IReadOnlyDictionary<string, FeatureQueryPayload>> GetAsync(long tenantId, string feature, CancellationToken ct);

    Task<IReadOnlyList<AgenticFeatureQueryDto>> ListAsync(long tenantId, string feature, CancellationToken ct);
}

/// <summary>Builds the envelope of a feature request for a tenant.</summary>
public interface IAgenticFeatureContext
{
    /// <summary><paramref name="needsAi"/>: resolves the tenant's AI provider (throws InvalidOperationException with the
    /// reason when AI is off, no provider is active or the daily quota is used up); otherwise Llm is null.</summary>
    Task<AgenticFeatureEnvelope> BuildAsync(long tenantId, string feature, bool needsAi, CancellationToken ct);
}

/// <summary>
/// Data Anomaly's state in the tenant database: its rules (core.AnomalyRule, seeded), the SQL compiled for them
/// (core.AnomalyProbe), runs and their reports (core.AnomalyRun / AnomalyRunReport), rules Discover proposed
/// (core.AnomalyProposal) and its long jobs (core.AiFeatureJob, run by the background worker).
/// KeyNotFoundException: no such rule / run / proposal / job; InvalidOperationException: the request breaks a rule.
/// </summary>
public interface IDataAnomalyService
{
    Task<AnomalyOverviewDto> OverviewAsync(long tenantId, CancellationToken ct);
    Task<IReadOnlyList<AnomalyRuleDto>> RulesAsync(long tenantId, CancellationToken ct);
    Task<AnomalyRuleDto> SetRuleStatusAsync(long tenantId, string ruleId, string? status, string user, CancellationToken ct);

    /// <summary>The compiled checks of a rule (by rule id) or the one check of a family member (by its probe id), with
    /// their SQL. Empty when nothing is compiled.</summary>
    Task<IReadOnlyList<AnomalyCheckDto>> ChecksAsync(long tenantId, string id, CancellationToken ct);
    Task<IReadOnlyList<AnomalyRunSummaryDto>> RunsAsync(long tenantId, int take, CancellationToken ct);
    Task<AnomalyRunDto> RunAsync(long tenantId, string runId, CancellationToken ct);
    Task<AskDataExportFile> ReportAsync(long tenantId, string runId, string format, CancellationToken ct);
    Task<IReadOnlyList<AnomalyProposalDto>> ProposalsAsync(long tenantId, string? status, CancellationToken ct);
    Task<AnomalyProposalDto> AcceptProposalAsync(long tenantId, long id, DecideAnomalyProposalRequest request, string user, CancellationToken ct);
    Task<AnomalyProposalDto> RejectProposalAsync(long tenantId, long id, DecideAnomalyProposalRequest request, string user, CancellationToken ct);
    Task<AiFeatureJobDto> StartJobAsync(long tenantId, StartAnomalyJobRequest request, string user, CancellationToken ct);
    Task<IReadOnlyList<AiFeatureJobDto>> JobsAsync(long tenantId, int take, CancellationToken ct);
    Task<AiFeatureJobDto> JobAsync(long tenantId, long id, CancellationToken ct);
    Task<AiFeatureJobDto> CancelJobAsync(long tenantId, long id, string user, CancellationToken ct);
}

/// <summary>Wakes the job worker at once when a job is queued on this instance (other instances poll).</summary>
public interface IAgenticJobSignal
{
    void Notify();
    Task WaitAsync(TimeSpan timeout, CancellationToken ct);

    /// <summary>True while this instance's job worker is running: a job started here is then created already claimed
    /// (status running) and run here, so another instance polling the same database never takes it.</summary>
    bool RunsJobsHere { get; }

    /// <summary>A job created already claimed by this instance, for its worker to start at once.</summary>
    void Claimed(long jobId);
}

/// <summary>A saved verified answer as the agent runtime takes it back ("knownAnswers"): reused only when Key is the
/// key of the answer being asked for.</summary>
public sealed record KnownAnswerPayload(string Key, string Draft, JsonElement? Verification, string? Model);

/// <summary>
/// Verified AI answers of an Agentic Feature in core.AiFeatureAnswer (infra/sql/add-ai-feature-answers.sql). Without
/// that table both methods do nothing (logged once): answers are then kept only in the agent runtime's memory.
/// </summary>
public interface IAiFeatureAnswerStore
{
    /// <summary>The report date's most recently used answers, newest first (at most <paramref name="take"/>).</summary>
    Task<IReadOnlyList<KnownAnswerPayload>> RecentAsync(long tenantId, string feature, DateOnly reportDate, int take,
        CancellationToken ct);

    /// <summary>The answer of this kind and scope last used for the date (null when none), for the page to show at once
    /// while it checks that the data did not change. One indexed read: no AI provider, no agent runtime.</summary>
    Task<SavedAiAnswerDto?> LatestAsync(long tenantId, string feature, DateOnly reportDate, string kind, string? scope,
        CancellationToken ct);

    /// <summary>Saves the reply's answer when it is verified and has an answer_key (a reused one is marked used), then
    /// keeps only the date's <paramref name="keep"/> most recently used answers.</summary>
    Task SaveAsync(long tenantId, string feature, DateOnly reportDate, string kind, string? scope, string? user,
        JsonElement reply, int keep, CancellationToken ct);
}

/// <summary>A Daily Report AI brief: the day, a well (WellId) or a task (TaskDailyId) of ReportDate, with Today the
/// users' date (deadlines are counted from it).</summary>
public sealed record DailyBrief(DateOnly ReportDate, string Scope, long? WellId, long? TaskDailyId, DateOnly Today);

/// <summary>
/// Daily Report's AI: briefs and questions through the agent runtime, with the date's saved answers sent along (so
/// an answer on unchanged data comes back at once, without an AI call) and every new verified answer saved.
/// InvalidOperationException: AI is off, no provider is active or the daily quota is used up.
/// </summary>
public interface IDailyReportAgent
{
    Task<JsonElement> BriefAsync(long tenantId, string? userId, DailyBrief brief, CancellationToken ct);

    /// <summary>The brief as the runtime streams it: stage / delta / restart while it works, then result or error.
    /// Failures before the first event (AI off, a refusal) are thrown as by BriefAsync.</summary>
    IAsyncEnumerable<AgentRuntimeEvent> BriefStreamAsync(long tenantId, string? userId, DailyBrief brief, CancellationToken ct);

    Task<JsonElement> AskAsync(long tenantId, string? userId, DateOnly reportDate, string question, DateOnly today,
        CancellationToken ct);
}

/// <summary>Calls a feature endpoint of the agent runtime with the tenant's envelope and logs the AI usage it reports.</summary>
public interface IAgenticFeatureGateway
{
    Task<JsonElement> CallAsync(long tenantId, string? userId, string feature, string path, object? body, bool needsAi, CancellationToken ct);

    Task<AskDataExportFile> FileAsync(long tenantId, string feature, string path, object? body, CancellationToken ct);
}
