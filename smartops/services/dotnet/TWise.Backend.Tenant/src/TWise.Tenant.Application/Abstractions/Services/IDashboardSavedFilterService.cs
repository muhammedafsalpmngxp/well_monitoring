using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

public interface IDashboardSavedFilterService
{
    Task<IReadOnlyList<DashboardSavedFilterDto>> GetAllAsync(int dashboardId, long userId, long tenantId, CancellationToken ct = default);
    Task<DashboardSavedFilterDto> SaveAsync(int dashboardId, long userId, long tenantId, SaveDashboardSavedFilterRequest request, CancellationToken ct = default);
    Task<DashboardSavedFilterDto?> RenameAsync(long id, long userId, long tenantId, RenameDashboardSavedFilterRequest request, CancellationToken ct = default);
    Task<DashboardSavedFilterDto?> ApplyAsync(long id, long userId, long tenantId, CancellationToken ct = default);
    Task<DashboardSavedFilterDto?> SetFavoriteAsync(long id, long userId, long tenantId, SetFavoriteDashboardSavedFilterRequest request, CancellationToken ct = default);
    Task<bool> DeleteAsync(long id, long userId, long tenantId, CancellationToken ct = default);

    /// <summary>Gets the shared default filter for this dashboard (same for every user), if one has been saved.</summary>
    Task<DashboardSavedFilterDto?> GetDefaultAsync(int dashboardId, long tenantId, CancellationToken ct = default);

    /// <summary>Saves the shared default filter for this dashboard (same for every user).</summary>
    Task<DashboardSavedFilterDto> SaveDefaultAsync(int dashboardId, long tenantId, SaveDashboardSavedFilterRequest request, CancellationToken ct = default);
}
