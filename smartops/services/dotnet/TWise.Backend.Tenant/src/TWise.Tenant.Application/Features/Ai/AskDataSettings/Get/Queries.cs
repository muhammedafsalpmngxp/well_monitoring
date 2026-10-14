using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.AskDataSettings;

/// <summary>The tenant's Ask Data settings (AI Settings → Ask Data & Features).</summary>
public sealed record GetAskDataSettingsQuery(long TenantId) : IRequest<AskDataSettingsDto>;

/// <summary>The Ask Data database's schemas, tables and columns, to choose what Ask Data may read.</summary>
public sealed record GetAskDataCatalogQuery : IRequest<AskDataCatalogDto>;
