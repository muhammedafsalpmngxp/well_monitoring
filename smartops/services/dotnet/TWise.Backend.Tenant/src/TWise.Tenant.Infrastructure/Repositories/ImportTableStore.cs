using System.Data;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Application.Features.Model.Imports;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Model;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

/// <summary>
/// Writes uploaded sheets to the [import] schema through the API's own tenant connection, which is
/// the tenant database, the only one files are loaded into (DatasetRules.IsTenantDatabase).
/// </summary>
public sealed class ImportTableStore(TenantDbContext db) : IImportTableStore
{
    public async Task<IReadOnlyList<ImportTable>> ListAsync(long connectionId, long tenantId, CancellationToken ct = default)
        => await db.ImportTables.AsNoTracking()
            .Where(t => t.ConnectionId == connectionId && t.TenantId == tenantId)
            .OrderByDescending(t => t.ModifiedAt)
            .ToListAsync(ct);

    public Task<ImportTable?> GetAsync(long id, long tenantId, CancellationToken ct = default)
        => db.ImportTables.FirstOrDefaultAsync(t => t.Id == id && t.TenantId == tenantId, ct);

    public async Task<bool> NameTakenAsync(string tableName, CancellationToken ct = default)
        => await db.ImportTables.AnyAsync(t => t.TableName == tableName, ct)
           || await db.Database
               .SqlQuery<int>($"SELECT COUNT(*) AS Value FROM sys.tables WHERE schema_id = SCHEMA_ID({ImportRules.Schema}) AND name = {tableName}")
               .SingleAsync(ct) > 0;

    public async Task<IReadOnlyList<(Dataset Dataset, DatasetParts Parts)>> UsagesAsync(
        long connectionId, long tenantId, string tableName, CancellationToken ct = default)
    {
        var datasets = await db.Datasets.AsNoTracking()
            // A data model on another database of the server may read the table too (DatasetSource.ConnectionId).
            .Where(d => d.TenantId == tenantId
                        && db.DatasetSources.Any(s => s.DatasetId == d.Id && (s.ConnectionId ?? d.ConnectionId) == connectionId
                            && ((s.SourceKind == "table" && s.SchemaName == ImportRules.Schema && s.SourceName == tableName)
                                || ((s.SourceKind == "view" || s.SourceKind == "script") && s.ViewSql != null && s.ViewSql.Contains(tableName)))))
            .ToListAsync(ct);

        var usages = new List<(Dataset, DatasetParts)>(datasets.Count);
        foreach (var dataset in datasets)
            usages.Add((dataset, new DatasetParts(
                await db.DatasetSources.AsNoTracking().Where(s => s.DatasetId == dataset.Id).ToListAsync(ct),
                await db.DatasetRelationships.AsNoTracking().Where(r => r.DatasetId == dataset.Id).ToListAsync(ct),
                await db.DatasetMeasures.AsNoTracking().Where(m => m.DatasetId == dataset.Id).ToListAsync(ct),
                await db.DatasetCalculatedColumns.AsNoTracking().Where(c => c.DatasetId == dataset.Id).ToListAsync(ct),
                await db.DatasetTransforms.AsNoTracking().Where(t => t.DatasetId == dataset.Id).ToListAsync(ct))));
        return usages;
    }

    public async Task<ImportTable?> WriteAsync(ImportTable table, ImportShape shape, CancellationToken ct = default)
    {
        var now = DateTime.UtcNow;
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            // DDL names the import schema only, with every identifier bracket-quoted (ImportRules.WriteTableSql).
            await db.Database.ExecuteSqlRawAsync(ImportRules.WriteTableSql(table.TableName, shape, replace: table.Id != 0), ct);

            using (var bulk = new SqlBulkCopy((SqlConnection)db.Database.GetDbConnection(), SqlBulkCopyOptions.Default, (SqlTransaction)tx.GetDbTransaction()))
            {
                bulk.DestinationTableName = ImportRules.QualifiedName(table.TableName);
                bulk.BulkCopyTimeout = 300;
                foreach (var column in shape.Columns) bulk.ColumnMappings.Add(column.Name, column.Name);
                await bulk.WriteToServerAsync(ToDataTable(shape), ct);
            }

            // The table's columns as a schema sync writes them, so the catalogue knows the table at once.
            await db.DatabaseSchemas
                .Where(s => s.ConnectionId == table.ConnectionId && s.TenantId == table.TenantId && !s.IsDeleted
                            && s.SchemaName == ImportRules.Schema && s.TableName == table.TableName)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.IsDeleted, true), ct);
            db.DatabaseSchemas.AddRange(ImportRules.CatalogRows(shape).Select((column, i) => new DatabaseSchema
            {
                ConnectionId = table.ConnectionId, SchemaName = ImportRules.Schema, TableName = table.TableName,
                ColumnName = column.Name, DataType = column.DataType, IsNullable = true, MaxLength = column.MaxLength,
                OrdinalPosition = i + 1, TenantId = table.TenantId, SyncedAt = now,
            }));

            table.LoadedRows = shape.Rows.Count;
            table.ModifiedAt = now;
            if (table.Id == 0)
            {
                table.CreatedAt = now;
                db.ImportTables.Add(table);
            }
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return table;
        }
        // 2714: a table of that name exists already. 2601 and 2627: another upload took the name first.
        // Leaving without a commit rolls every step back, the DDL included.
        catch (SqlException ex) when (ex.Number is 2714 or 2601 or 2627)
        {
            return null;
        }
        catch (DbUpdateException ex) when (ex.InnerException is SqlException { Number: 2601 or 2627 })
        {
            return null;
        }
        // 2705: CREATE TABLE named a column twice as the database's collation compares names.
        catch (SqlException ex) when (ex.Number == 2705)
        {
            throw new DuplicateImportColumnException();
        }
    }

    private static DataTable ToDataTable(ImportShape shape)
    {
        var data = new DataTable();
        foreach (var column in shape.Columns) data.Columns.Add(column.Name, ImportRules.ClrType(column.Type));
        foreach (var row in shape.Rows) data.Rows.Add(row.Select(value => value ?? DBNull.Value).ToArray());
        return data;
    }
}
