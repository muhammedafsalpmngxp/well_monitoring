using System.Text.Json;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Ai.AskDataSettings;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

public sealed class ExportAgentFlowHandler(IAgentRuntimeClient runtime, IAiProviderRepository providers) : IRequestHandler<ExportAgentFlowQuery, JsonElement>
{
    public async Task<JsonElement> Handle(ExportAgentFlowQuery q, CancellationToken ct) =>
        await runtime.ExportAgentFlowAsync(q.Agent, await AgentFlowModel.ActiveAsync(providers, q.TenantId, ct), ct);
}

public sealed class GetAgentFlowHandler(IAiAgentRepository agents, IAgentRuntimeClient runtime, IAiProviderRepository providers)
    : IRequestHandler<GetAgentFlowQuery, JsonElement?>
{
    public async Task<JsonElement?> Handle(GetAgentFlowQuery q, CancellationToken ct)
    {
        var agent = await agents.GetAsync(q.TenantId, q.Id, ct);
        if (agent is null) return null;
        return await runtime.ExportAgentFlowAsync(AgentMapping.ToRequest(AgentMapping.ToDto(agent, null)),
            await AgentFlowModel.ActiveAsync(providers, q.TenantId, ct), ct);
    }
}

/// <summary>The tenant's active provider for agentflow.json (it used to always say openai / gpt-4o-mini).</summary>
internal static class AgentFlowModel
{
    public static async Task<AgentFlowLlm?> ActiveAsync(IAiProviderRepository providers, long tenantId, CancellationToken ct) =>
        await providers.GetActiveAsync(tenantId, ct) is { } p ? new AgentFlowLlm(p.Provider, p.Model, p.BaseUrl) : null;
}

public sealed class ExportAskDataHandler(IAgentRuntimeClient runtime, IAiSettingsRepository settings) : IRequestHandler<ExportAskDataQuery, AskDataExportFile>
{
    /// <summary>The export re-reads with the tenant's Ask Data settings: hidden tables and columns stay hidden.</summary>
    public async Task<AskDataExportFile> Handle(ExportAskDataQuery q, CancellationToken ct) =>
        await runtime.ExportAskDataAsync(q.Request, AskDataSettingsRules.ToRuntime(await settings.GetAsync(q.TenantId, ct)), ct);
}

public sealed class ImportAgentFlowHandler(IAgentRuntimeClient runtime) : IRequestHandler<ImportAgentFlowQuery, AgentFlowImportDto>
{
    public Task<AgentFlowImportDto> Handle(ImportAgentFlowQuery q, CancellationToken ct) => runtime.ImportAgentFlowAsync(q.Flow, ct);
}
