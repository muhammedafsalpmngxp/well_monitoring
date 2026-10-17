using System.Text.Json;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>The tenant's active AI provider as agentflow.json records it: which provider and model, no key.</summary>
public sealed record AgentFlowLlm(string Provider, string Model, string? BaseUrl);

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
    /// reason for a token or query that cannot be exported. The Ask Data database is attached by the client.</summary>
    Task<AskDataExportFile> ExportAskDataAsync(AskDataExportRequest request, CancellationToken ct);

    /// <summary>Runs one agent configuration and yields the runtime's events; the last is done or error. The Ask Data
    /// database is attached by the client when a tool is ask_data.</summary>
    IAsyncEnumerable<AgentRuntimeEvent> RunAsync(SaveAiAgentRequest agent, IReadOnlyDictionary<string, string> inputs,
        AgentRuntimeLlm? llm, string sessionId, CancellationToken ct);

    /// <summary>Ask your data: one question on the Ask Data database with the same graph as an agent's ask_data step
    /// (deep mode). History is earlier {user, assistant} turns. Yields status / node events, then done or error.</summary>
    IAsyncEnumerable<AgentRuntimeEvent> AskDataAsync(string question, IReadOnlyList<Dictionary<string, string>> history,
        AgentRuntimeLlm llm, CancellationToken ct);
}
