using MediatR;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.AskDataSettings;

public sealed class GetAskDataSettingsHandler(IAiSettingsRepository settings) : IRequestHandler<GetAskDataSettingsQuery, AskDataSettingsDto>
{
    public async Task<AskDataSettingsDto> Handle(GetAskDataSettingsQuery q, CancellationToken ct) =>
        AskDataSettingsRules.ToDto(await settings.GetAsync(q.TenantId, ct));
}

public sealed class GetAskDataCatalogHandler(IAskDataCatalogReader catalog) : IRequestHandler<GetAskDataCatalogQuery, AskDataCatalogDto>
{
    public Task<AskDataCatalogDto> Handle(GetAskDataCatalogQuery q, CancellationToken ct) => catalog.ReadAsync(ct);
}
