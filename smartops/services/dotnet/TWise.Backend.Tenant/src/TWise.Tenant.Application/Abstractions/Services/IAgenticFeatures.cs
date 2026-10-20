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
}

/// <summary>Calls a feature endpoint of the agent runtime with the tenant's envelope and logs the AI usage it reports.</summary>
public interface IAgenticFeatureGateway
{
    Task<JsonElement> CallAsync(long tenantId, string? userId, string feature, string path, object? body, bool needsAi, CancellationToken ct);

    Task<AskDataExportFile> FileAsync(long tenantId, string feature, string path, object? body, CancellationToken ct);
}
