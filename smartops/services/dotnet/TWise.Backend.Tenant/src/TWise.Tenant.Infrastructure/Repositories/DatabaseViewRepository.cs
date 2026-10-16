using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class DatabaseViewRepository(TenantDbContext db) : IDatabaseViewRepository
{
    public async Task<IReadOnlyList<DatabaseView>> GetAllAsync(long tenantId, string? viewType = null, CancellationToken cancellationToken = default)
    {
        var query = db.DatabaseViews
            .Include(v => v.Connection)
            .Where(v => v.TenantId == tenantId);

        if (!string.IsNullOrEmpty(viewType))
            query = query.Where(v => v.ViewType == viewType);

        // select only list-needed columns — exclude GeneratedSql/ManualSql/PreviewData to avoid loading large text fields
        return await query
            .Select(v => new DatabaseView
            {
                Id           = v.Id,
                ViewName     = v.ViewName,
                Description  = v.Description,
                ConnectionId = v.ConnectionId,
                Connection   = v.Connection,
                TablesUsed   = v.TablesUsed,
                ColumnCount  = v.ColumnCount,
                RowCount     = v.RowCount,
                SourceType   = v.SourceType,
                ViewType     = v.ViewType,
                TenantId     = v.TenantId,
                CreatedBy    = v.CreatedBy,
                CreatedAt    = v.CreatedAt,
                ModifiedBy   = v.ModifiedBy,
                ModifiedAt   = v.ModifiedAt,
            })
            .OrderByDescending(v => v.ModifiedAt)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<DatabaseView>> GetContractSourcesAsync(long tenantId, CancellationToken cancellationToken = default)
        => await db.DatabaseViews
            .Where(v => v.TenantId == tenantId)
            .Select(v => new DatabaseView
            {
                Id           = v.Id,
                ViewName     = v.ViewName,
                ViewType     = v.ViewType,
                Description  = v.Description,
                GeneratedSql = v.GeneratedSql,
                ManualSql    = v.ManualSql,
            })
            .OrderBy(v => v.ViewName)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<DatabaseView>> GetByIdsAsync(IEnumerable<long> ids, long tenantId, CancellationToken cancellationToken = default)
    {
        var idList = ids.ToList();
        return await db.DatabaseViews
            .Include(v => v.Connection)
            .Where(v => v.TenantId == tenantId && idList.Contains(v.Id))
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public Task<string?> GetNameAsync(long id, long tenantId, CancellationToken cancellationToken = default)
        => db.DatabaseViews.Where(v => v.Id == id && v.TenantId == tenantId).Select(v => v.ViewName).FirstOrDefaultAsync(cancellationToken);

    public async Task<DatabaseView?> GetByIdAsync(long id, long tenantId, CancellationToken cancellationToken = default)
        => await db.DatabaseViews
            .Include(v => v.Connection)
            .FirstOrDefaultAsync(v => v.Id == id && v.TenantId == tenantId, cancellationToken);

    public async Task<DatabaseView?> GetDetailAsync(long id, long tenantId, CancellationToken cancellationToken = default)
        => await db.DatabaseViews
            .Where(v => v.Id == id && v.TenantId == tenantId)
            .Select(v => new DatabaseView
            {
                Id = v.Id, ConnectionId = v.ConnectionId, Connection = v.Connection,
                ViewName = v.ViewName, Description = v.Description, IsDistinct = v.IsDistinct,
                TablesJson = v.TablesJson, JoinsJson = v.JoinsJson, SelectedColumnsJson = v.SelectedColumnsJson,
                ColumnAliasesJson = v.ColumnAliasesJson, FiltersJson = v.FiltersJson,
                GeneratedSql = v.GeneratedSql, ManualSql = v.ManualSql,
                PreviewRowCount = v.PreviewRowCount, PreviewExecutedAt = v.PreviewExecutedAt,
                TablesUsed = v.TablesUsed, ColumnsUsed = v.ColumnsUsed, ColumnCount = v.ColumnCount,
                RowCount = v.RowCount, Reliability = v.Reliability,
                SourceType = v.SourceType, ViewType = v.ViewType,
                ReferencedCteIdsJson = v.ReferencedCteIdsJson, ReferencedComponentIdsJson = v.ReferencedComponentIdsJson,
                TenantId = v.TenantId, CreatedBy = v.CreatedBy, CreatedAt = v.CreatedAt,
                ModifiedBy = v.ModifiedBy, ModifiedAt = v.ModifiedAt, IsDeleted = v.IsDeleted,
            })
            .AsNoTracking()
            .FirstOrDefaultAsync(cancellationToken);

    public async Task SavePreviewAsync(long id, long tenantId, string columnsJson, string dataJson, int rowCount, CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        await db.DatabaseViews
            .Where(v => v.Id == id && v.TenantId == tenantId)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(v => v.PreviewColumnsJson, columnsJson)
                .SetProperty(v => v.PreviewDataJson, dataJson)
                .SetProperty(v => v.PreviewRowCount, rowCount)
                .SetProperty(v => v.PreviewExecutedAt, now)
                .SetProperty(v => v.RowCount, rowCount)
                .SetProperty(v => v.ModifiedAt, now), cancellationToken);
    }

    public async Task<(string? ColumnsJson, string? RowsJson, int? RowCount, DateTime? ExecutedAt)?> GetPreviewSnapshotAsync(
        long id, long tenantId, int maxRows, CancellationToken cancellationToken = default)
    {
        var meta = await db.DatabaseViews
            .Where(v => v.Id == id && v.TenantId == tenantId)
            .Select(v => new { v.PreviewColumnsJson, v.PreviewRowCount, v.PreviewExecutedAt })
            .AsNoTracking()
            .FirstOrDefaultAsync(cancellationToken);
        if (meta is null) return null;

        // preview_data_json can be tens of MB; OPENJSON cuts it to the rows shown, returned as one JSON array.
        var rows = await db.Database.SqlQuery<string?>($"""
            SELECT '[' + STRING_AGG(CAST(t.[value] AS nvarchar(max)), ',') WITHIN GROUP (ORDER BY t.[k]) + ']' AS [Value]
            FROM (SELECT TOP ({maxRows}) j.[value], CAST(j.[key] AS int) AS [k]
                  FROM [core].[DatabaseViews] v CROSS APPLY OPENJSON(v.[preview_data_json]) j
                  WHERE v.[id] = {id} AND v.[tenant_id] = {tenantId} AND v.[is_deleted] = 0) t
            """).FirstOrDefaultAsync(cancellationToken);
        return (meta.PreviewColumnsJson, rows, meta.PreviewRowCount, meta.PreviewExecutedAt);
    }

    public async Task<DatabaseView> AddAsync(DatabaseView entity, CancellationToken cancellationToken = default)
    {
        db.DatabaseViews.Add(entity);
        await db.SaveChangesAsync(cancellationToken);
        await db.Entry(entity).Reference(v => v.Connection).LoadAsync(cancellationToken);
        return entity;
    }

    public async Task UpdateAsync(DatabaseView entity, CancellationToken cancellationToken = default)
    {
        // Explicitly mark the entity as modified to ensure all property changes are persisted,
        // including subsequent updates to the same row (e.g. preview data overwrites).
        db.Entry(entity).State = EntityState.Modified;
        await db.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> SoftDeleteAsync(long id, long userId, long tenantId, CancellationToken cancellationToken = default)
    {
        var entity = await db.DatabaseViews
            .FirstOrDefaultAsync(v => v.Id == id && v.TenantId == tenantId, cancellationToken);
        if (entity is null) return false;

        entity.IsDeleted = true;
        entity.ModifiedBy = userId;
        entity.ModifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<bool> ExistsByNameAsync(string viewName, long tenantId, long? excludeId = null, CancellationToken cancellationToken = default)
    {
        var query = db.DatabaseViews
            .Where(v => v.TenantId == tenantId && v.ViewName == viewName);

        if (excludeId.HasValue)
            query = query.Where(v => v.Id != excludeId.Value);

        return await query.AnyAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<DatabaseView>> GetWithColumnsUsedAsync(long tenantId, CancellationToken cancellationToken = default)
        => await db.DatabaseViews
            .AsNoTracking()
            .Where(v => v.TenantId == tenantId && v.ColumnsUsed != null && v.ColumnsUsed != "")
            .Select(v => new DatabaseView
            {
                Id = v.Id,
                ViewName = v.ViewName,
                TablesUsed = v.TablesUsed,
                ColumnsUsed = v.ColumnsUsed,
                TenantId = v.TenantId,
            })
            .ToListAsync(cancellationToken);

    public async Task UpdateReliabilityAsync(long id, long tenantId, decimal? reliability, CancellationToken cancellationToken = default)
        => await db.DatabaseViews
            .Where(v => v.Id == id && v.TenantId == tenantId)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(v => v.Reliability, reliability)
                .SetProperty(v => v.ModifiedAt, DateTime.UtcNow), cancellationToken);
}
