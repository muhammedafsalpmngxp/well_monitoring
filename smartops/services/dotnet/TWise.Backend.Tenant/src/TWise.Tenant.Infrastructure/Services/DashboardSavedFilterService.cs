using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Infrastructure.Services;

public sealed class DashboardSavedFilterService(IDashboardSavedFilterRepository repo) : IDashboardSavedFilterService
{
    public async Task<IReadOnlyList<DashboardSavedFilterDto>> GetAllAsync(int dashboardId, long userId, long tenantId, CancellationToken ct = default)
    {
        var filters = await repo.GetAllAsync(dashboardId, userId, tenantId, ct);
        return filters.Select(ToDto).ToList();
    }

    public async Task<DashboardSavedFilterDto> SaveAsync(int dashboardId, long userId, long tenantId, SaveDashboardSavedFilterRequest request, CancellationToken ct = default)
    {
        var saved = await repo.UpsertAsync(
            dashboardId, userId, tenantId, request.FilterName!,
            request.Country, request.Sector, request.BusinessUnit, request.Division, request.Cluster, request.Plant,
            request.QuickRange, request.FromDate, request.ToDate, ct);
        return ToDto(saved);
    }

    public async Task<DashboardSavedFilterDto?> RenameAsync(long id, long userId, long tenantId, RenameDashboardSavedFilterRequest request, CancellationToken ct = default)
    {
        var renamed = await repo.RenameAsync(id, userId, tenantId, request.NewFilterName, ct);
        return renamed is null ? null : ToDto(renamed);
    }

    public async Task<DashboardSavedFilterDto?> ApplyAsync(long id, long userId, long tenantId, CancellationToken ct = default)
    {
        var found = await repo.GetByIdAsync(id, userId, tenantId, ct);
        return found is null ? null : ToDto(found);
    }

    public async Task<DashboardSavedFilterDto?> SetFavoriteAsync(long id, long userId, long tenantId, SetFavoriteDashboardSavedFilterRequest request, CancellationToken ct = default)
    {
        var updated = await repo.SetFavoriteAsync(id, userId, tenantId, request.IsFavorite, ct);
        return updated is null ? null : ToDto(updated);
    }

    public Task<bool> DeleteAsync(long id, long userId, long tenantId, CancellationToken ct = default)
        => repo.DeleteAsync(id, userId, tenantId, ct);

    public async Task<DashboardSavedFilterDto?> GetDefaultAsync(int dashboardId, long tenantId, CancellationToken ct = default)
    {
        var found = await repo.GetDefaultAsync(dashboardId, tenantId, ct);
        return found is null ? null : ToDto(found);
    }

    public async Task<DashboardSavedFilterDto> SaveDefaultAsync(int dashboardId, long tenantId, SaveDashboardSavedFilterRequest request, CancellationToken ct = default)
    {
        var saved = await repo.UpsertDefaultAsync(
            dashboardId, tenantId,
            request.Country, request.Sector, request.BusinessUnit, request.Division, request.Cluster, request.Plant,
            request.QuickRange, request.FromDate, request.ToDate, ct);
        return ToDto(saved);
    }

    private static DashboardSavedFilterDto ToDto(DashboardSavedFilter f) => new(
        f.Id, f.DashboardId, f.FilterName, f.Country, f.Sector, f.BusinessUnit, f.Division, f.Cluster, f.Plant,
        f.QuickRange, f.FromDate, f.ToDate, f.CreatedOn, f.UpdatedOn, f.IsFavorite);
}
