using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.AskDataSettings;

/// <summary>The tenant's Ask Data settings (AI Settings → Ask Data & Features).</summary>
public sealed record GetAskDataSettingsQuery(long TenantId) : IRequest<AskDataSettingsDto>;

/// <summary>Suggested first questions for the Ask your data panel (runtime, from the column profiles); empty when Ask your
/// data is off for the user or not set up, the profiles are not built yet or the runtime is down.</summary>
public sealed record GetAskDataStartersQuery(long TenantId) : IRequest<IReadOnlyList<string>>;

/// <summary>The Ask Data database's schemas, tables and columns, to choose what Ask Data may read.</summary>
public sealed record GetAskDataCatalogQuery : IRequest<AskDataCatalogDto>;
