using MediatR;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.PowerBi;

// Thin handlers — behaviour lives in IPowerBiService, matching the other features.

public sealed class GetPowerBiSettingsHandler(IPowerBiService svc) : IRequestHandler<GetPowerBiSettingsQuery, PowerBiSettingsDto?>
{
    public Task<PowerBiSettingsDto?> Handle(GetPowerBiSettingsQuery r, CancellationToken ct) => svc.GetSettingsAsync(r.TenantId, ct);
}
public sealed class SavePowerBiSettingsHandler(IPowerBiService svc) : IRequestHandler<SavePowerBiSettingsCommand, PowerBiSettingsDto>
{
    public Task<PowerBiSettingsDto> Handle(SavePowerBiSettingsCommand r, CancellationToken ct) => svc.SaveSettingsAsync(r.Request, r.TenantId, r.UserId, ct);
}
public sealed class ListPowerBiReportsHandler(IPowerBiService svc) : IRequestHandler<ListPowerBiReportsQuery, IReadOnlyList<PowerBiReportDto>>
{
    public Task<IReadOnlyList<PowerBiReportDto>> Handle(ListPowerBiReportsQuery r, CancellationToken ct) => svc.ListReportsAsync(r.TenantId, ct);
}
public sealed class GetPowerBiEmbedConfigHandler(IPowerBiService svc) : IRequestHandler<GetPowerBiEmbedConfigQuery, PowerBiEmbedConfigDto>
{
    public Task<PowerBiEmbedConfigDto> Handle(GetPowerBiEmbedConfigQuery r, CancellationToken ct) => svc.GetEmbedConfigAsync(r.ReportId, r.TenantId, ct);
}
