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

    /// <summary>Calls one Tool (REST) once; throws InvalidOperationException with the reason when it may not or could not be called.</summary>
    Task<JsonElement> TryToolAsync(AiAgentCustomToolDto tool, IReadOnlyDictionary<string, JsonElement> args, CancellationToken ct);

    /// <summary>An Ask Data answer's data as a file (every row, no model call); throws InvalidOperationException with the
    /// reason for a token or query that cannot be exported. The Ask Data database is attached by the client;
    /// <paramref name="askData"/> are the tenant's Ask Data settings.</summary>
    Task<AskDataExportFile> ExportAskDataAsync(AskDataExportRequest request, AgentRuntimeAskData askData, CancellationToken ct);

    /// <summary>Runs one agent configuration and yields the runtime's events; the last is done, approval (paused: its
    /// state and step) or error (done.memories: new facts to keep). The Ask Data database is attached by the client
    /// when the agent or a sub-agent uses ask_data.</summary>
    IAsyncEnumerable<AgentRuntimeEvent> RunAsync(AgentRunContext run, CancellationToken ct);

    /// <summary>Eval: whether the answer meets the expectation, judged by the tenant's model (temperature 0).</summary>
    Task<AgentJudgeResult> JudgeAsync(AgentRuntimeLlm llm, string question, string answer, string expectation, CancellationToken ct);

    /// <summary>Continues a run paused at Human Approval from its saved state; events as RunAsync.</summary>
    IAsyncEnumerable<AgentRuntimeEvent> ResumeAsync(AgentRunContext run, AgentResume resume, CancellationToken ct);

    /// <summary>Ask your data: one question on the Ask Data database with the same graph as an agent's ask_data step
    /// (deep mode). History is earlier {user, assistant} turns. Yields status / node events, then done or error.</summary>
    IAsyncEnumerable<AgentRuntimeEvent> AskDataAsync(string question, IReadOnlyList<Dictionary<string, string>> history,
        AgentRuntimeLlm llm, IReadOnlyDictionary<string, string> prompts, AgentRuntimeAskData askData, CancellationToken ct);

    /// <summary>An Agentic Feature endpoint (POST /api/agent-runtime/features/{feature}/{path}) with the envelope and
    /// <paramref name="body"/>'s fields; the Ask Data database is attached. Throws AgentRuntimeException with the
    /// runtime's status and message when it refuses, HttpRequestException when it is down.</summary>
    Task<JsonElement> FeatureCallAsync(string feature, string path, AgenticFeatureEnvelope envelope, object? body, CancellationToken ct);

    /// <summary>A feature endpoint that returns a file (e.g. Daily Report's Excel export).</summary>
    Task<AskDataExportFile> FeatureFileAsync(string feature, string path, AgenticFeatureEnvelope envelope, object? body, CancellationToken ct);

    /// <summary>A long feature operation as server-sent events (progress…, then result or error). No time limit:
    /// it ends when the runtime finishes or <paramref name="ct"/> is cancelled.</summary>
    IAsyncEnumerable<AgentRuntimeEvent> FeatureStreamAsync(string feature, string path, AgenticFeatureEnvelope envelope, object? body,
        CancellationToken ct);
}

/// <summary>
/// One run as the runtime takes it: the agent (with its tool secrets), inputs, the tenant's model, the saved agent's
/// memories, the published agents its steps run (by id), the conversation so far, the session id (= resume token), the tenant's AI prompts (AiPromptCatalog.RuntimeTexts; the
/// runtime has none of its own) and its Ask Data settings (AskDataSettingsRules.ToRuntime).
/// </summary>
public sealed record AgentRunContext(SaveAiAgentRequest Agent, IReadOnlyDictionary<string, string> Inputs, AgentRuntimeLlm? Llm,
    IReadOnlyList<string> Memories, IReadOnlyDictionary<string, SaveAiAgentRequest> Subagents, IReadOnlyList<AgentThreadTurn> Thread,
    string SessionId, IReadOnlyDictionary<string, string>? Prompts = null, AgentRuntimeAskData? AskData = null);

/// <summary>A person's decision on a paused run, with the state and step (node) it paused at.</summary>
public sealed record AgentResume(System.Text.Json.JsonElement State, string Node, string Decision, string? Text, string By);

/// <summary>The judge's verdict on one eval answer.</summary>
public sealed record AgentJudgeResult(bool Pass, string Reason);
