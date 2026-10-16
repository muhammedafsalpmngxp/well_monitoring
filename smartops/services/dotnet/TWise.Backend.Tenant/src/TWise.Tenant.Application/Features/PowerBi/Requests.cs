using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.PowerBi;

public sealed record GetPowerBiSettingsQuery(long TenantId) : IRequest<PowerBiSettingsDto?>;
public sealed record SavePowerBiSettingsCommand(SavePowerBiSettingsRequest Request, long TenantId, long UserId) : IRequest<PowerBiSettingsDto>;
public sealed record ListPowerBiReportsQuery(long TenantId) : IRequest<IReadOnlyList<PowerBiReportDto>>;
public sealed record GetPowerBiEmbedConfigQuery(string ReportId, long TenantId) : IRequest<PowerBiEmbedConfigDto>;
