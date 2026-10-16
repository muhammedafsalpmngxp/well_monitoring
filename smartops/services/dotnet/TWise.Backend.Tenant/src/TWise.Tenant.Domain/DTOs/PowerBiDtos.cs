namespace TWise.Tenant.Domain.DTOs;

/// <summary>The tenant's Power BI connection. The client secret is never returned; HasSecret says whether one is stored.</summary>
public record PowerBiSettingsDto(string AzureTenantId, string ClientId, string WorkspaceId, bool HasSecret, DateTime ModifiedAt);

/// <summary>Creates or updates the connection. Leave ClientSecret blank on update to keep the stored one.</summary>
public record SavePowerBiSettingsRequest(string AzureTenantId, string ClientId, string WorkspaceId, string? ClientSecret = null);

/// <summary>A report in the configured workspace, as the Power BI REST API lists it.</summary>
public record PowerBiReportDto(string Id, string Name, string EmbedUrl, string? DatasetId);

/// <summary>Everything powerbi-client needs to embed one report. The embed token is short-lived and scoped to that report.</summary>
public record PowerBiEmbedConfigDto(string ReportId, string EmbedUrl, string EmbedToken, DateTime Expiration);
