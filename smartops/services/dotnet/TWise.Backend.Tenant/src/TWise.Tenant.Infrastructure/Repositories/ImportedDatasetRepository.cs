using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class ImportedDatasetRepository(TenantDbContext db) : IImportedDatasetRepository
{
    public async Task<IReadOnlyList<ImportedDataset>> GetAllAsync(long tenantId, long userId, CancellationToken ct = default)
        => await db.ImportedDatasets
            .AsNoTracking()
            .Where(d => d.TenantId == tenantId && d.CreatedBy == userId)
            .OrderByDescending(d => d.CreatedAt)
            .ToListAsync(ct);

    public async Task<IReadOnlyList<ImportedDataset>> GetAllForTenantAsync(long tenantId, CancellationToken ct = default)
        => await db.ImportedDatasets
            .AsNoTracking()
            .Where(d => d.TenantId == tenantId)
            .OrderByDescending(d => d.CreatedAt)
            .ToListAsync(ct);

    public async Task<ImportedDataset?> GetByIdAsync(long id, long tenantId, CancellationToken ct = default)
        => await db.ImportedDatasets
            .FirstOrDefaultAsync(d => d.Id == id && d.TenantId == tenantId, ct);

    public async Task<ImportedDataset> CreateWithRowsAsync(ImportedDataset dataset, IReadOnlyList<string> rowJsonList, CancellationToken ct = default)
    {
        db.ImportedDatasets.Add(dataset);
        await db.SaveChangesAsync(ct);

        var rowIndex = 0;
        var rows = rowJsonList.Select(json => new ImportedDataRow
        {
            DatasetId = dataset.Id,
            RowIndex = rowIndex++,
            DataJson = json,
            CreatedAt = DateTime.UtcNow
        }).ToList();

        db.ImportedDataRows.AddRange(rows);
        await db.SaveChangesAsync(ct);
        return dataset;
    }

    public async Task<IReadOnlyList<string>> GetRowsAsync(long datasetId, int maxRows, CancellationToken ct = default)
        => await db.ImportedDataRows
            .AsNoTracking()
            .Where(r => r.DatasetId == datasetId)
            .OrderBy(r => r.RowIndex)
            .Take(maxRows)
            .Select(r => r.DataJson)
            .ToListAsync(ct);

    public async Task<bool> SoftDeleteAsync(long id, long userId, long tenantId, CancellationToken ct = default)
    {
        var entity = await db.ImportedDatasets.FirstOrDefaultAsync(d => d.Id == id && d.TenantId == tenantId, ct);
        if (entity is null) return false;

        entity.IsDeleted = true;
        entity.ModifiedBy = userId;
        entity.ModifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }
}
