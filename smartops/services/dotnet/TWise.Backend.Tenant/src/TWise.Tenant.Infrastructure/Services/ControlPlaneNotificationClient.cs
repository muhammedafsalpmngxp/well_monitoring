using System.Net.Http.Json;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;

namespace TWise.Tenant.Infrastructure.Services;

public sealed class ControlPlaneNotificationClient(HttpClient http, ILogger<ControlPlaneNotificationClient> logger)
    : IControlPlaneNotificationClient
{
    private record CreateNotificationRequest(long TenantId, string Type, string Title, string? Description,
        string? Route, IReadOnlyList<long> RecipientUserIds, string? ModuleCode);

    public async Task PublishAsync(long tenantId, string type, string title, string? description, string? route,
        IReadOnlyList<long> recipientUserIds, string? moduleCode, CancellationToken ct)
    {
        try
        {
            var response = await http.PostAsJsonAsync("internal/notifications",
                new CreateNotificationRequest(tenantId, type, title, description, route, recipientUserIds, moduleCode), ct);
            if (!response.IsSuccessStatusCode)
                logger.LogWarning("ControlPlane notification ingest returned {StatusCode} for type {Type}", response.StatusCode, type);
        }
        catch (Exception ex)
        {
            // A ControlPlane outage must never break the tenant-side operation (dashboard share,
            // rule execution) that triggered this notification — log and move on.
            logger.LogWarning(ex, "Failed to publish notification of type {Type} to ControlPlane", type);
        }
    }
}
