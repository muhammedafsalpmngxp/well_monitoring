using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IDashboardSavedFilterRepository
{
    Task<List<DashboardSavedFilter>> GetAllAsync(int dashboardId, long userId, long tenantId, CancellationToken ct = default);

    Task<DashboardSavedFilter> UpsertAsync(
        int dashboardId, long userId, long tenantId, string filterName,
        string? country, string? sector, string? businessUnit, string? division, string? cluster, string? plant,
        string? quickRange, DateTime? fromDate, DateTime? toDate, CancellationToken ct = default);

    Task<DashboardSavedFilter?> RenameAsync(long id, long userId, long tenantId, string newFilterName, CancellationToken ct = default);

    Task<DashboardSavedFilter?> GetByIdAsync(long id, long userId, long tenantId, CancellationToken ct = default);

    Task<DashboardSavedFilter?> SetFavoriteAsync(long id, long userId, long tenantId, bool isFavorite, CancellationToken ct = default);

    Task<bool> DeleteAsync(long id, long userId, long tenantId, CancellationToken ct = default);

    /// <summary>Gets the shared default filter for this dashboard (same for every user), if one has been saved.</summary>
    Task<DashboardSavedFilter?> GetDefaultAsync(int dashboardId, long tenantId, CancellationToken ct = default);

    /// <summary>Upserts the shared default filter for this dashboard (same for every user).</summary>
    Task<DashboardSavedFilter> UpsertDefaultAsync(
        int dashboardId, long tenantId,
        string? country, string? sector, string? businessUnit, string? division, string? cluster, string? plant,
        string? quickRange, DateTime? fromDate, DateTime? toDate, CancellationToken ct = default);

    /// <summary>Duplicates every saved filter (all users, including the shared default) from one dashboard to another - used when copying a published board to a draft.</summary>
    Task CopyAllAsync(int sourceDashboardId, int targetDashboardId, CancellationToken ct = default);
}
