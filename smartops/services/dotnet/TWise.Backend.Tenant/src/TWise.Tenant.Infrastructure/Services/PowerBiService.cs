using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

/// <summary>
/// Power BI "embed for your customers". The tenant stores a service principal; this service
/// exchanges it for an Azure AD access token, lists the workspace's reports and mints view-only
/// embed tokens. The Azure AD token never leaves the server — the browser only ever receives an
/// embed token scoped to a single report.
/// </summary>
public sealed class PowerBiService(
    IPowerBiConnectionRepository connections,
    IHttpClientFactory httpClientFactory) : IPowerBiService
{
    private const string Scope = "https://analysis.windows.net/powerbi/api/.default";
    private const string ApiBase = "https://api.powerbi.com/v1.0/myorg";

    public async Task<PowerBiSettingsDto?> GetSettingsAsync(long tenantId, CancellationToken ct = default)
    {
        var row = await connections.GetAsync(tenantId, ct);
        return row is null ? null : ToDto(row);
    }

    public async Task<PowerBiSettingsDto> SaveSettingsAsync(SavePowerBiSettingsRequest request, long tenantId, long userId, CancellationToken ct = default)
    {
        // All three ids are interpolated into Microsoft URLs, so they must be GUIDs and nothing else.
        var azureTenantId = RequireGuid(request.AzureTenantId, "Azure tenant id");
        var clientId = RequireGuid(request.ClientId, "Client id");
        var workspaceId = RequireGuid(request.WorkspaceId, "Workspace id");

        var row = await connections.GetAsync(tenantId, ct) ?? new PowerBiConnection { TenantId = tenantId };
        var secret = request.ClientSecret?.Trim();
        if (string.IsNullOrEmpty(secret) && row.Id == 0)
            throw new InvalidOperationException("A client secret is required.");

        row.AzureTenantId = azureTenantId;
        row.ClientId = clientId;
        row.WorkspaceId = workspaceId;
        if (!string.IsNullOrEmpty(secret)) row.ClientSecretEncrypted = ConnectionPasswordHelper.Encrypt(secret);
        row.ModifiedBy = userId;
        row.ModifiedAt = DateTime.UtcNow;

        // Fail now, with Microsoft's reason, rather than on the first report list.
        await AcquireAccessTokenAsync(row, ct);

        return ToDto(await connections.SaveAsync(row, ct));
    }

    public async Task<IReadOnlyList<PowerBiReportDto>> ListReportsAsync(long tenantId, CancellationToken ct = default)
    {
        var (client, row) = await AuthenticatedClientAsync(tenantId, ct);
        using var response = await client.GetAsync($"{ApiBase}/groups/{row.WorkspaceId}/reports", ct);
        await EnsureSuccessAsync(response, "list reports", ct);

        var page = await response.Content.ReadFromJsonAsync<ReportsPage>(JsonOptions, ct);
        return (page?.Value ?? []).Select(r => new PowerBiReportDto(r.Id, r.Name, r.EmbedUrl, r.DatasetId)).ToList();
    }

    public async Task<PowerBiEmbedConfigDto> GetEmbedConfigAsync(string reportId, long tenantId, CancellationToken ct = default)
    {
        reportId = RequireGuid(reportId, "Report id");
        var (client, row) = await AuthenticatedClientAsync(tenantId, ct);

        using var reportResponse = await client.GetAsync($"{ApiBase}/groups/{row.WorkspaceId}/reports/{reportId}", ct);
        await EnsureSuccessAsync(reportResponse, "read the report", ct);
        var report = await reportResponse.Content.ReadFromJsonAsync<Report>(JsonOptions, ct)
            ?? throw new InvalidOperationException("Power BI returned no report.");

        using var tokenResponse = await client.PostAsJsonAsync(
            $"{ApiBase}/groups/{row.WorkspaceId}/reports/{reportId}/GenerateToken",
            new { accessLevel = "View" }, ct);
        await EnsureSuccessAsync(tokenResponse, "generate an embed token", ct);
        var token = await tokenResponse.Content.ReadFromJsonAsync<EmbedToken>(JsonOptions, ct)
            ?? throw new InvalidOperationException("Power BI returned no embed token.");

        return new PowerBiEmbedConfigDto(report.Id, report.EmbedUrl, token.Token, token.Expiration);
    }

    private async Task<(HttpClient Client, PowerBiConnection Row)> AuthenticatedClientAsync(long tenantId, CancellationToken ct)
    {
        var row = await connections.GetAsync(tenantId, ct)
            ?? throw new InvalidOperationException("Power BI is not configured for this workspace.");
        var client = httpClientFactory.CreateClient(nameof(PowerBiService));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", await AcquireAccessTokenAsync(row, ct));
        return (client, row);
    }

    /// <summary>Client-credentials grant against the tenant's Azure AD directory.</summary>
    private async Task<string> AcquireAccessTokenAsync(PowerBiConnection row, CancellationToken ct)
    {
        var client = httpClientFactory.CreateClient(nameof(PowerBiService));
        using var response = await client.PostAsync(
            $"https://login.microsoftonline.com/{row.AzureTenantId}/oauth2/v2.0/token",
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "client_credentials",
                ["client_id"] = row.ClientId,
                ["client_secret"] = ConnectionPasswordHelper.Decrypt(row.ClientSecretEncrypted),
                ["scope"] = Scope,
            }), ct);

        if (!response.IsSuccessStatusCode)
        {
            var error = await response.Content.ReadFromJsonAsync<AadError>(JsonOptions, ct);
            throw new InvalidOperationException(
                $"Azure AD rejected the Power BI credentials: {error?.ErrorDescription?.Split("\r\n")[0] ?? response.StatusCode.ToString()}");
        }
        var token = await response.Content.ReadFromJsonAsync<AadToken>(JsonOptions, ct);
        return token?.AccessToken ?? throw new InvalidOperationException("Azure AD returned no access token.");
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage response, string action, CancellationToken ct)
    {
        if (response.IsSuccessStatusCode) return;
        // Power BI's error body names the cause (e.g. the service principal is not a workspace
        // member); the status code alone would send the user guessing.
        var body = await response.Content.ReadAsStringAsync(ct);
        throw new InvalidOperationException($"Power BI could not {action} ({(int)response.StatusCode}): {Truncate(body)}");
    }

    private static string Truncate(string s) => s.Length <= 300 ? s : s[..300] + "…";

    private static string RequireGuid(string? value, string name)
        => Guid.TryParse(value?.Trim(), out var guid) ? guid.ToString() : throw new InvalidOperationException($"{name} must be a GUID.");

    private static PowerBiSettingsDto ToDto(PowerBiConnection c)
        => new(c.AzureTenantId, c.ClientId, c.WorkspaceId, HasSecret: true, c.ModifiedAt);

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    // Microsoft response shapes, reduced to what is used.
    private sealed record AadToken([property: JsonPropertyName("access_token")] string AccessToken);
    private sealed record AadError([property: JsonPropertyName("error_description")] string? ErrorDescription);
    private sealed record ReportsPage(List<Report> Value);
    private sealed record Report(string Id, string Name, string EmbedUrl, string? DatasetId);
    private sealed record EmbedToken(string Token, DateTime Expiration);
}
