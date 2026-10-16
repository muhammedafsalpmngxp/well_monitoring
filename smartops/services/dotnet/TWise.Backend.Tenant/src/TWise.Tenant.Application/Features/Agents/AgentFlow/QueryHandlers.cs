using System.Text.Json;
using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

public sealed class ExportAgentFlowHandler(IAgentRuntimeClient runtime) : IRequestHandler<ExportAgentFlowQuery, JsonElement>
{
    public Task<JsonElement> Handle(ExportAgentFlowQuery q, CancellationToken ct) => runtime.ExportAgentFlowAsync(q.Agent, ct);
}

public sealed class GetAgentFlowHandler(IAiAgentRepository agents, IAgentRuntimeClient runtime) : IRequestHandler<GetAgentFlowQuery, JsonElement?>
{
    public async Task<JsonElement?> Handle(GetAgentFlowQuery q, CancellationToken ct)
    {
        var agent = await agents.GetAsync(q.TenantId, q.Id, ct);
        if (agent is null) return null;
        return await runtime.ExportAgentFlowAsync(AgentMapping.ToRequest(AgentMapping.ToDto(agent, null)), ct);
    }
}

public sealed class ExportAskDataHandler(IAgentRuntimeClient runtime) : IRequestHandler<ExportAskDataQuery, AskDataExportFile>
{
    public Task<AskDataExportFile> Handle(ExportAskDataQuery q, CancellationToken ct) => runtime.ExportAskDataAsync(q.Request, ct);
}

public sealed class ImportAgentFlowHandler(IAgentRuntimeClient runtime) : IRequestHandler<ImportAgentFlowQuery, AgentFlowImportDto>
{
    public Task<AgentFlowImportDto> Handle(ImportAgentFlowQuery q, CancellationToken ct) => runtime.ImportAgentFlowAsync(q.Flow, ct);
}
