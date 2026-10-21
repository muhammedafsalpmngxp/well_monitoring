using System.Text.Json;
using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Agents;

/// <summary>The agent on the page (saved or not) as agentflow.json v1, for the JSON view.</summary>
public sealed record ExportAgentFlowQuery(SaveAiAgentRequest Agent, long TenantId) : IRequest<JsonElement>;

/// <summary>A saved agent as agentflow.json v1, for download; null when it is not the tenant's.</summary>
public sealed record GetAgentFlowQuery(long TenantId, long Id) : IRequest<JsonElement?>;

/// <summary>
/// An agentflow.json v1 (made here or in the AgenticUIFramework) turned into an agent for the page to show.
/// Nothing is saved: the user reviews it and saves.
/// </summary>
public sealed record ImportAgentFlowQuery(JsonElement Flow) : IRequest<AgentFlowImportDto>;

/// <summary>The data behind an Ask Data answer as an xlsx or docx file (re-reads the answer's SQL; no model call).</summary>
/// <summary>One call of a Tool with sample values (no model): {status, result}.</summary>
public sealed record TryAgentToolQuery(long TenantId, TryAgentToolRequest Request) : IRequest<JsonElement>;
public sealed record ExportAskDataQuery(AskDataExportRequest Request, long TenantId) : IRequest<AskDataExportFile>;
