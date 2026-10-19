using System.Text.Json;
using System.Text.Json.Serialization;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>The tenant's active AI provider as agentflow.json records it: which provider and model, no key.</summary>
public sealed record AgentFlowLlm(string Provider, string Model, string? BaseUrl);

/// <summary>
/// The tenant's Ask Data settings as the runtime takes them (core.AiSettings, Settings → AI Settings): what Ask Data may
/// read and its limits. The runtime has no list of its own; no allowed schemas means it refuses (not set up).
/// ChatMode (deep | normal) is only the Ask your data chatbot's mode: it is sent as that request's mode, never with an
/// agent run (agents choose their mode per step).
/// </summary>
public sealed record AgentRuntimeAskData(
    IReadOnlyList<string> AllowedSchemas,
    IReadOnlyList<string> ExcludedTables,
    IReadOnlyList<string> ExcludedColumns,
    int MaxRows,
    int QueryTimeout,
    int MaxQueries,
    int MaxSqlRetries,
    int VerifyRetries,
    int HistoryTurns,
    string OrgName,
    string ExportPrefix,
    [property: JsonIgnore] string ChatMode = "deep");

/// <summary>The Python agent runtime (services/python/agent_runtime), which runs agents as LangGraph graphs.</summary>
public interface IAgentRuntimeClient
{
    /// <summary>The tools a step can use, with a message when twise is down. Throws HttpRequestException when the runtime is down.</summary>
    Task<AgentToolsDto> ListToolsAsync(CancellationToken ct);

    /// <summary>The agent as agentflow.json v1 (AgenticUIFramework format), naming the tenant's model when one is
    /// active (never its key).</summary>
    Task<JsonElement> ExportAgentFlowAsync(SaveAiAgentRequest agent, AgentFlowLlm? llm, CancellationToken ct);

    /// <summary>An agentflow.json v1 as an agent; throws InvalidOperationException with the reason when it is not usable.</summary>
    Task<AgentFlowImportDto> ImportAgentFlowAsync(JsonElement flow, CancellationToken ct);

    /// <summary>An Ask Data answer's data as a file (every row, no model call); throws InvalidOperationException with the
    /// reason for a token or query that cannot be exported. The Ask Data database is attached by the client;
    /// <paramref name="askData"/> are the tenant's Ask Data settings.</summary>
    Task<AskDataExportFile> ExportAskDataAsync(AskDataExportRequest request, AgentRuntimeAskData askData, CancellationToken ct);

    /// <summary>Runs one agent configuration and yields the runtime's events; the last is done or error. The Ask Data
    /// database is attached by the client when a tool is ask_data. <paramref name="prompts"/> are the tenant's AI prompts
    /// for the runtime (AiPromptCatalog.RuntimeTexts): it has no texts of its own. <paramref name="askData"/> are the
    /// tenant's Ask Data settings (AskDataSettingsRules.ToRuntime).</summary>
    IAsyncEnumerable<AgentRuntimeEvent> RunAsync(SaveAiAgentRequest agent, IReadOnlyDictionary<string, string> inputs,
        AgentRuntimeLlm? llm, string sessionId, IReadOnlyDictionary<string, string> prompts, AgentRuntimeAskData askData,
        CancellationToken ct);

    /// <summary>Ask your data: one question on the Ask Data database with the same graph as an agent's ask_data step
    /// (deep mode). History is earlier {user, assistant} turns. Yields status / node events, then done or error.</summary>
    IAsyncEnumerable<AgentRuntimeEvent> AskDataAsync(string question, IReadOnlyList<Dictionary<string, string>> history,
        AgentRuntimeLlm llm, IReadOnlyDictionary<string, string> prompts, AgentRuntimeAskData askData, CancellationToken ct);
}
