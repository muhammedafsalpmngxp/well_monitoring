using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

/// <summary>
/// Repository implementation for Dashboard operations.
/// </summary>
public class DashboardRepository(TenantDbContext db, ILogger<DashboardRepository> logger) : IDashboardRepository
{
    public async Task<T> ExecuteInTransactionAsync<T>(Func<Task<T>> action, CancellationToken ct = default)
    {
        return await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync(ct);
            var result = await action();
            await transaction.CommitAsync(ct);
            return result;
        });
    }

    public async Task<bool> DashboardExistsAsync(string dashboardName, int categoryId, CancellationToken ct = default)
    {
        return await db.Set<Dashboard>()
            .AnyAsync(d => EF.Functions.Collate(d.DashboardName, "Latin1_General_CI_AS") == dashboardName
                        && d.CategoryId == categoryId
                        && !d.IsDeleted, ct);
    }

    public async Task<bool> CategoryExistsAsync(int categoryId, CancellationToken ct = default)
    {
        return await db.Set<Category>()
            .AnyAsync(c => c.CategoryId == categoryId && !c.IsDeleted, ct);
    }

    public async Task<Dashboard> CreateDashboardAsync(Dashboard dashboard, CancellationToken ct = default)
    {
        await db.Set<Dashboard>().AddAsync(dashboard, ct);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Dashboard created successfully. DashboardId={DashboardId}, Name={Name}",
            dashboard.DashboardId, dashboard.DashboardName);

        return dashboard;
    }

    public async Task<IReadOnlyList<Category>> GetDashboardCategoriesAsync(CancellationToken ct = default)
    {
        return await db.Set<Category>()
            .AsNoTracking()
            .Where(c => !c.IsDeleted && c.ControlType == "dashboard")
            .OrderBy(c => c.CategoryName)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyList<Dashboard>> GetDashboardsByStatusAsync(string status, CancellationToken ct = default)
    {
        return await (
            from d in db.Set<Dashboard>().AsNoTracking()
            join c in db.Set<Category>() on d.CategoryId equals c.CategoryId
            where d.Status == status && !d.IsDeleted
            orderby d.ModifiedAt descending
            select new Dashboard
            {
                DashboardId = d.DashboardId,
                DashboardName = d.DashboardName,
                CategoryId = d.CategoryId,
                Status = d.Status,
                Description = d.Description,
                ConfigJson = d.ConfigJson,
                IsActive = d.IsActive,
                ModifiedAt = d.ModifiedAt,
                CreatedBy = d.CreatedBy,
                VersionNo = d.VersionNo,
                IsLatestVersion = d.IsLatestVersion,
                DashboardSeriesId = d.DashboardSeriesId,
                Category = new Category { CategoryId = c.CategoryId, CategoryName = c.CategoryName },
            }
        ).ToListAsync(ct);
    }

    public async Task<IReadOnlyList<Dashboard>> GetDashboardsByStatusesAsync(IEnumerable<string> statuses, CancellationToken ct = default)
    {
        var statusList = statuses.ToList();
        return await (
            from d in db.Set<Dashboard>().AsNoTracking()
            join c in db.Set<Category>() on d.CategoryId equals c.CategoryId
            where statusList.Contains(d.Status) && !d.IsDeleted
            orderby d.ModifiedAt descending
            select new Dashboard
            {
                DashboardId = d.DashboardId,
                DashboardName = d.DashboardName,
                CategoryId = d.CategoryId,
                Status = d.Status,
                Description = d.Description,
                ConfigJson = d.ConfigJson,
                IsActive = d.IsActive,
                ModifiedAt = d.ModifiedAt,
                CreatedBy = d.CreatedBy,
                VersionNo = d.VersionNo,
                IsLatestVersion = d.IsLatestVersion,
                DashboardSeriesId = d.DashboardSeriesId,
                Category = new Category { CategoryId = c.CategoryId, CategoryName = c.CategoryName },
            }
        ).ToListAsync(ct);
    }

    public async Task<IReadOnlyList<Dashboard>> GetPublishedListAsync(bool includeInactive, CancellationToken ct = default)
    {
        return await (
            from d in db.Set<Dashboard>().AsNoTracking()
            join c in db.Set<Category>() on d.CategoryId equals c.CategoryId
            where !d.IsDeleted &&
                  ((d.Status == DashboardStatus.Published && d.IsLatestVersion) ||
                   (includeInactive && d.Status == DashboardStatus.Inactive))
            orderby d.ModifiedAt descending
            select new Dashboard
            {
                DashboardId = d.DashboardId,
                DashboardName = d.DashboardName,
                CategoryId = d.CategoryId,
                Status = d.Status,
                Description = d.Description,
                ConfigJson = d.ConfigJson,
                IsActive = d.IsActive,
                ModifiedAt = d.ModifiedAt,
                CreatedBy = d.CreatedBy,
                VersionNo = d.VersionNo,
                IsLatestVersion = d.IsLatestVersion,
                DashboardSeriesId = d.DashboardSeriesId,
                Category = new Category { CategoryId = c.CategoryId, CategoryName = c.CategoryName },
            }
        ).ToListAsync(ct);
    }

    public async Task<IReadOnlyList<Dashboard>> GetDashboardsByCreatorAsync(string createdBy, IEnumerable<string> statuses, CancellationToken ct = default)
    {
        var statusList = statuses.ToList();
        return await (
            from d in db.Set<Dashboard>().AsNoTracking()
            join c in db.Set<Category>() on d.CategoryId equals c.CategoryId
            where d.CreatedBy == createdBy && statusList.Contains(d.Status) && !d.IsDeleted
            orderby d.ModifiedAt descending
            select new Dashboard
            {
                DashboardId = d.DashboardId,
                DashboardName = d.DashboardName,
                CategoryId = d.CategoryId,
                Status = d.Status,
                Description = d.Description,
                ConfigJson = d.ConfigJson,
                IsActive = d.IsActive,
                ModifiedAt = d.ModifiedAt,
                CreatedBy = d.CreatedBy,
                VersionNo = d.VersionNo,
                IsLatestVersion = d.IsLatestVersion,
                DashboardSeriesId = d.DashboardSeriesId,
                Category = new Category { CategoryId = c.CategoryId, CategoryName = c.CategoryName },
            }
        ).ToListAsync(ct);
    }

    public async Task<IReadOnlyList<Dashboard>> GetAllDashboardsForShareLookupAsync(CancellationToken ct = default)
    {
        return await (
            from d in db.Set<Dashboard>().AsNoTracking()
            join c in db.Set<Category>() on d.CategoryId equals c.CategoryId
            where !d.IsDeleted
            orderby d.ModifiedAt descending
            select new Dashboard
            {
                DashboardId = d.DashboardId,
                DashboardName = d.DashboardName,
                CategoryId = d.CategoryId,
                Status = d.Status,
                Description = d.Description,
                ConfigJson = d.ConfigJson,
                IsActive = d.IsActive,
                ModifiedAt = d.ModifiedAt,
                CreatedBy = d.CreatedBy,
                VersionNo = d.VersionNo,
                IsLatestVersion = d.IsLatestVersion,
                DashboardSeriesId = d.DashboardSeriesId,
                Category = new Category { CategoryId = c.CategoryId, CategoryName = c.CategoryName },
            }
        ).ToListAsync(ct);
    }

    public async Task<IReadOnlyList<Dashboard>> GetShareNotificationCandidatesAsync(DateTime since, CancellationToken ct = default)
    {
        // Both filters run in SQL: ModifiedAt > since bounds the scan to whatever changed since the
        // caller's last poll (normally 0-few rows), and the ConfigJson.Contains check further limits
        // it to dashboards that were ever internally shared — no category join, no full ConfigJson-
        // for-every-row scan like GetAllDashboardsForShareLookupAsync.
        return await db.Set<Dashboard>().AsNoTracking()
            .Where(d => !d.IsDeleted
                        && d.ModifiedAt > since
                        && d.ConfigJson != null && d.ConfigJson.Contains("sharedWithUserIds")
                        && (d.Status != DashboardStatus.Published || d.IsLatestVersion))
            .OrderByDescending(d => d.ModifiedAt)
            .Select(d => new Dashboard
            {
                DashboardId = d.DashboardId,
                DashboardName = d.DashboardName,
                ConfigJson = d.ConfigJson,
                ModifiedAt = d.ModifiedAt,
                Status = d.Status,
                IsLatestVersion = d.IsLatestVersion,
            })
            .Take(50)
            .ToListAsync(ct);
    }

    public async Task<Dashboard?> GetDashboardByIdAsync(int dashboardId, CancellationToken ct = default)
    {
        return await db.Set<Dashboard>()
            .Include(d => d.Category)
            .FirstOrDefaultAsync(d => d.DashboardId == dashboardId && !d.IsDeleted, ct);
    }

    public async Task<Dashboard?> GetDashboardDetailByIdAsync(int dashboardId, CancellationToken ct = default)
    {
        return await db.Set<Dashboard>()
            .AsNoTracking()
            .Include(d => d.Category)
            .FirstOrDefaultAsync(d => d.DashboardId == dashboardId && !d.IsDeleted, ct);
    }

    public async Task<Dashboard> PublishDashboardAsync(Dashboard dashboard, CancellationToken ct = default)
    {
        db.Set<Dashboard>().Update(dashboard);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Dashboard published successfully. DashboardId={DashboardId}", dashboard.DashboardId);
        return dashboard;
    }

    public async Task<Dashboard> UpdateDashboardAsync(Dashboard dashboard, CancellationToken ct = default)
    {
        db.Set<Dashboard>().Update(dashboard);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Dashboard updated. DashboardId={DashboardId}", dashboard.DashboardId);
        return dashboard;
    }

    public async Task UpdateDashboardConfigAsync(Dashboard dashboard, CancellationToken ct = default)
    {
        db.Attach(dashboard);
        db.Entry(dashboard).Property(d => d.ConfigJson).IsModified = true;
        db.Entry(dashboard).Property(d => d.ModifiedBy).IsModified = true;
        db.Entry(dashboard).Property(d => d.ModifiedAt).IsModified = true;
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Dashboard config updated. DashboardId={DashboardId}", dashboard.DashboardId);
    }

    public async Task<Dashboard?> GetLatestVersionAsync(Guid seriesId, CancellationToken ct = default)
    {
        return await db.Set<Dashboard>()
            .FirstOrDefaultAsync(d => d.DashboardSeriesId == seriesId && d.IsLatestVersion && !d.IsDeleted, ct);
    }

    public async Task<int?> GetMaxVersionNoAsync(Guid seriesId, CancellationToken ct = default)
    {
        var versions = await db.Set<Dashboard>()
            .Where(d => d.DashboardSeriesId == seriesId && d.VersionNo != null && !d.IsDeleted)
            .Select(d => d.VersionNo!.Value)
            .ToListAsync(ct);
        return versions.Count > 0 ? versions.Max() : (int?)null;
    }

    public async Task<Dashboard?> GetActiveDraftForSeriesAsync(Guid seriesId, CancellationToken ct = default)
    {
        return await db.Set<Dashboard>()
            .FirstOrDefaultAsync(d => d.DashboardSeriesId == seriesId && d.VersionNo == null && !d.IsDeleted, ct);
    }

    public async Task<IReadOnlyList<Dashboard>> GetVersionHistoryAsync(Guid seriesId, CancellationToken ct = default)
    {
        return await db.Set<Dashboard>()
            .AsNoTracking()
            .Where(d => d.DashboardSeriesId == seriesId && d.VersionNo != null && !d.IsDeleted)
            .OrderByDescending(d => d.VersionNo)
            .ToListAsync(ct);
    }

    public async Task<Dashboard> PublishNewVersionAsync(Dashboard? previousLatest, Dashboard newVersion, CancellationToken ct = default)
    {
        // Single SaveChanges call = single implicit transaction, so archiving the old
        // version and activating the new one happen atomically.
        if (previousLatest is not null)
            db.Set<Dashboard>().Update(previousLatest);
        db.Set<Dashboard>().Update(newVersion);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Dashboard published as new version. DashboardId={DashboardId}, VersionNo={VersionNo}",
            newVersion.DashboardId, newVersion.VersionNo);
        return newVersion;
    }

    public async Task<Dashboard?> GetVersionAsync(Guid seriesId, int versionNo, CancellationToken ct = default)
    {
        return await db.Set<Dashboard>()
            .FirstOrDefaultAsync(d => d.DashboardSeriesId == seriesId && d.VersionNo == versionNo && !d.IsDeleted, ct);
    }

    public async Task<Dashboard> RestoreVersionAsync(Dashboard? previousLatest, Dashboard restoredVersion, CancellationToken ct = default)
    {
        // Single SaveChanges call = single implicit transaction, so demoting the old latest
        // and inserting the restored version cannot leave two rows flagged IsLatestVersion.
        if (previousLatest is not null)
            db.Set<Dashboard>().Update(previousLatest);

        await db.Set<Dashboard>().AddAsync(restoredVersion, ct);
        await db.SaveChangesAsync(ct);

        logger.LogInformation(
            "Dashboard version restored. SeriesId={SeriesId}, NewDashboardId={DashboardId}, NewVersionNo={VersionNo}",
            restoredVersion.DashboardSeriesId, restoredVersion.DashboardId, restoredVersion.VersionNo);

        return restoredVersion;
    }

    public async Task<Dashboard> UnpublishToNewDraftAsync(Dashboard archivedPublished, Dashboard? newDraft, CancellationToken ct = default)
    {
        db.Set<Dashboard>().Update(archivedPublished);
        if (newDraft is not null)
            await db.Set<Dashboard>().AddAsync(newDraft, ct);
        await db.SaveChangesAsync(ct);

        logger.LogInformation("Dashboard unpublished. ArchivedId={ArchivedId}, DraftId={DraftId}",
            archivedPublished.DashboardId, (newDraft ?? archivedPublished).DashboardId);
        return newDraft ?? archivedPublished;
    }
}
