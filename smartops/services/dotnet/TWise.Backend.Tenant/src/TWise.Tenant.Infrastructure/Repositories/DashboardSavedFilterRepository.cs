using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class DashboardSavedFilterRepository(TenantDbContext db) : IDashboardSavedFilterRepository
{
    public async Task<List<DashboardSavedFilter>> GetAllAsync(int dashboardId, long userId, long tenantId, CancellationToken ct = default)
        => await db.DashboardSavedFilters
            .AsNoTracking()
            .Where(f => f.DashboardId == dashboardId && f.UserId == userId && f.TenantId == tenantId)
            .OrderByDescending(f => f.IsFavorite)
            .ThenByDescending(f => f.UpdatedOn)
            .ToListAsync(ct);

    // ── UPSERT — same FilterName for the same user+dashboard overwrites, otherwise creates a new row ──
    public async Task<DashboardSavedFilter> UpsertAsync(
        int dashboardId, long userId, long tenantId, string filterName,
        string? country, string? sector, string? businessUnit, string? division, string? cluster, string? plant,
        string? quickRange, DateTime? fromDate, DateTime? toDate, CancellationToken ct = default)
    {
        var existing = await db.DashboardSavedFilters.FirstOrDefaultAsync(
            f => f.DashboardId == dashboardId && f.UserId == userId && f.TenantId == tenantId && f.FilterName == filterName, ct);

        if (existing is not null)
        {
            existing.Country = country;
            existing.Sector = sector;
            existing.BusinessUnit = businessUnit;
            existing.Division = division;
            existing.Cluster = cluster;
            existing.Plant = plant;
            existing.QuickRange = quickRange;
            existing.FromDate = fromDate;
            existing.ToDate = toDate;
            existing.UpdatedOn = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return existing;
        }

        var created = new DashboardSavedFilter
        {
            TenantId = tenantId,
            DashboardId = dashboardId,
            UserId = userId,
            FilterName = filterName,
            Country = country,
            Sector = sector,
            BusinessUnit = businessUnit,
            Division = division,
            Cluster = cluster,
            Plant = plant,
            QuickRange = quickRange,
            FromDate = fromDate,
            ToDate = toDate,
            CreatedOn = DateTime.UtcNow,
            UpdatedOn = DateTime.UtcNow,
        };
        db.DashboardSavedFilters.Add(created);
        await db.SaveChangesAsync(ct);
        return created;
    }

    public async Task<DashboardSavedFilter?> RenameAsync(long id, long userId, long tenantId, string newFilterName, CancellationToken ct = default)
    {
        var existing = await db.DashboardSavedFilters
            .FirstOrDefaultAsync(f => f.Id == id && f.UserId == userId && f.TenantId == tenantId, ct);
        if (existing is null) return null;

        var duplicate = await db.DashboardSavedFilters.AnyAsync(
            f => f.DashboardId == existing.DashboardId && f.UserId == userId && f.TenantId == tenantId
                && f.FilterName == newFilterName && f.Id != id, ct);
        if (duplicate) throw new InvalidOperationException($"A saved filter named '{newFilterName}' already exists.");

        existing.FilterName = newFilterName;
        existing.UpdatedOn = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return existing;
    }

    public async Task<DashboardSavedFilter?> GetByIdAsync(long id, long userId, long tenantId, CancellationToken ct = default)
        => await db.DashboardSavedFilters
            .AsNoTracking()
            .FirstOrDefaultAsync(f => f.Id == id && f.UserId == userId && f.TenantId == tenantId, ct);

    public async Task<DashboardSavedFilter?> SetFavoriteAsync(long id, long userId, long tenantId, bool isFavorite, CancellationToken ct = default)
    {
        var existing = await db.DashboardSavedFilters
            .FirstOrDefaultAsync(f => f.Id == id && f.UserId == userId && f.TenantId == tenantId, ct);
        if (existing is null) return null;

        existing.IsFavorite = isFavorite;
        await db.SaveChangesAsync(ct);
        return existing;
    }

    public async Task<bool> DeleteAsync(long id, long userId, long tenantId, CancellationToken ct = default)
    {
        var existing = await db.DashboardSavedFilters
            .FirstOrDefaultAsync(f => f.Id == id && f.UserId == userId && f.TenantId == tenantId, ct);
        if (existing is null) return false;

        existing.IsDeleted = true;
        await db.SaveChangesAsync(ct);
        return true;
    }

    // ── Shared default filter — stored as an ordinary row under a reserved name/UserId so it
    // needs no schema change and never shows up in a real user's saved-filter list. ──
    private const long DefaultFilterUserId = 0;
    private const string DefaultFilterName = "__default__";

    public Task<DashboardSavedFilter?> GetDefaultAsync(int dashboardId, long tenantId, CancellationToken ct = default)
        => db.DashboardSavedFilters
            .AsNoTracking()
            .FirstOrDefaultAsync(f => f.DashboardId == dashboardId && f.TenantId == tenantId
                && f.UserId == DefaultFilterUserId && f.FilterName == DefaultFilterName, ct);

    public Task<DashboardSavedFilter> UpsertDefaultAsync(
        int dashboardId, long tenantId,
        string? country, string? sector, string? businessUnit, string? division, string? cluster, string? plant,
        string? quickRange, DateTime? fromDate, DateTime? toDate, CancellationToken ct = default)
        => UpsertAsync(dashboardId, DefaultFilterUserId, tenantId, DefaultFilterName,
            country, sector, businessUnit, division, cluster, plant, quickRange, fromDate, toDate, ct);

    public async Task CopyAllAsync(int sourceDashboardId, int targetDashboardId, CancellationToken ct = default)
    {
        var sourceFilters = await db.DashboardSavedFilters
            .AsNoTracking()
            .Where(f => f.DashboardId == sourceDashboardId && !f.IsDeleted)
            .ToListAsync(ct);
        if (sourceFilters.Count == 0) return;

        var now = DateTime.UtcNow;
        var copies = sourceFilters.Select(f => new DashboardSavedFilter
        {
            TenantId = f.TenantId,
            DashboardId = targetDashboardId,
            UserId = f.UserId,
            FilterName = f.FilterName,
            Country = f.Country,
            Sector = f.Sector,
            BusinessUnit = f.BusinessUnit,
            Division = f.Division,
            Cluster = f.Cluster,
            Plant = f.Plant,
            QuickRange = f.QuickRange,
            FromDate = f.FromDate,
            ToDate = f.ToDate,
            CreatedOn = now,
            UpdatedOn = now,
            IsFavorite = f.IsFavorite,
        });
        db.DashboardSavedFilters.AddRange(copies);
        await db.SaveChangesAsync(ct);
    }
}
