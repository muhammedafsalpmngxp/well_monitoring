using System.Net.Http.Json;
using TWise.Tenant.Application.Features.Delivery;

namespace TWise.Tenant.Infrastructure.Delivery;

/// <summary>
/// Reads schedule owners and recipients from the control plane (POST internal/users/resolve, API key). Unlike the
/// notification client it throws on failure: a run must fail rather than send as an unchecked owner or to fewer people.
/// </summary>
public sealed class ControlPlaneDirectoryClient(HttpClient http) : IRecipientResolver
{
    private sealed record ResolveUsersRequest(long TenantId, IReadOnlyCollection<long> UserIds, IReadOnlyCollection<string> RoleCodes);

    public async Task<IReadOnlyList<DirectoryUser>> ResolveAsync(
        long tenantId, IReadOnlyCollection<long> userIds, IReadOnlyCollection<string> roleCodes, CancellationToken ct)
    {
        if (userIds.Count + roleCodes.Count == 0) return [];
        using var response = await http.PostAsJsonAsync("internal/users/resolve", new ResolveUsersRequest(tenantId, userIds, roleCodes), ct);
        if (!response.IsSuccessStatusCode)
            throw new DeliveryException($"The user directory could not be read (control plane answered {(int)response.StatusCode}).");
        return await response.Content.ReadFromJsonAsync<List<DirectoryUser>>(cancellationToken: ct) ?? [];
    }
}
