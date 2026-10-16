using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>Power BI "embed for your customers": service-principal auth and report embedding for one tenant.</summary>
public interface IPowerBiService
{
    /// <summary>Null when the tenant has not configured Power BI.</summary>
    Task<PowerBiSettingsDto?> GetSettingsAsync(long tenantId, CancellationToken ct = default);

    Task<PowerBiSettingsDto> SaveSettingsAsync(SavePowerBiSettingsRequest request, long tenantId, long userId, CancellationToken ct = default);

    /// <summary>Reports in the configured workspace.</summary>
    Task<IReadOnlyList<PowerBiReportDto>> ListReportsAsync(long tenantId, CancellationToken ct = default);

    /// <summary>Embed URL plus a view-only embed token for one report.</summary>
    Task<PowerBiEmbedConfigDto> GetEmbedConfigAsync(string reportId, long tenantId, CancellationToken ct = default);
}
