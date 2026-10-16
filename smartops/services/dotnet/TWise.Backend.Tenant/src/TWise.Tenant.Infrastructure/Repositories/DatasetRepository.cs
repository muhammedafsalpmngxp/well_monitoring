using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Features.Model;
using TWise.Tenant.Application.Features.Model.Datasets;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Domain.Entities.Model;
using TWise.Tenant.Infrastructure.Persistence;
using TWise.Tenant.Infrastructure.Services;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class DatasetRepository(
    TenantDbContext db, IDbContextFactory<TenantDbContext> contexts, IConfiguration configuration, IMemoryCache cache) : IDatasetRepository
{
    public string? TenantDatabaseName { get; } = DatabaseOf(configuration.GetConnectionString("TenantDb"));

    public async Task<IReadOnlyList<Dataset>> ListAsync(long tenantId, CancellationToken ct = default)
        => await db.Datasets.AsNoTracking()
            .Where(d => d.TenantId == tenantId)
            .OrderBy(d => d.Name)
            .ToListAsync(ct);

    public Task<Dataset?> GetAsync(long id, long tenantId, CancellationToken ct = default)
        => db.Datasets.FirstOrDefaultAsync(d => d.Id == id && d.TenantId == tenantId, ct);

    public Task<bool> NameTakenAsync(long tenantId, string name, long? exceptId, CancellationToken ct = default)
        => db.Datasets.AnyAsync(d => d.TenantId == tenantId && d.Name == name && (exceptId == null || d.Id != exceptId), ct);

    public async Task<IReadOnlyList<DatabaseConnection>> GetConnectionsAsync(long tenantId, CancellationToken ct = default)
        => await db.DatabaseConnections.AsNoTracking()
            .Where(c => c.TenantId == tenantId && !c.IsDeleted)
            .OrderBy(c => c.ConnectionName)
            .ToListAsync(ct);

    public async Task<DatasetParts> GetPartsAsync(long datasetId, CancellationToken ct = default)
        => new(
            await db.DatasetSources.Where(s => s.DatasetId == datasetId).ToListAsync(ct),
            await db.DatasetRelationships.Where(r => r.DatasetId == datasetId).ToListAsync(ct),
            await db.DatasetMeasures.Where(m => m.DatasetId == datasetId).ToListAsync(ct),
            await db.DatasetCalculatedColumns.Where(c => c.DatasetId == datasetId).ToListAsync(ct),
            await db.DatasetTransforms.Where(t => t.DatasetId == datasetId).ToListAsync(ct));

    public async Task<IReadOnlyList<CatalogColumn>> GetColumnsAsync(
        long connectionId, long tenantId, IReadOnlyCollection<string> tables, CancellationToken ct = default)
        => await db.DatabaseSchemas.AsNoTracking()
            .Where(c => c.ConnectionId == connectionId && c.TenantId == tenantId && !c.IsDeleted && tables.Contains(c.TableName))
            .OrderBy(c => c.SchemaName).ThenBy(c => c.TableName).ThenBy(c => c.OrdinalPosition)
            .Select(c => new CatalogColumn(c.SchemaName, c.TableName, c.ColumnName, c.IsPrimaryKey, c.IsForeignKey,
                c.ForeignKeySchema, c.ForeignKeyTable, c.ForeignKeyColumn, c.DataType))
            .ToListAsync(ct);

    public async Task<JoinProbe> ProbeJoinAsync(JoinCandidate candidate, DatabaseConnection connection, CancellationToken ct = default)
    {
        await using var sql = new SqlConnection(ConnectionPasswordHelper.BuildConnectionString(connection));
        await sql.OpenAsync(ct);
        await using var command = sql.CreateCommand();
        command.CommandText = JoinFinder.ProbeSql(candidate);
        command.CommandTimeout = 15;
        await using var reader = await command.ExecuteReaderAsync(ct);
        await reader.ReadAsync(ct);
        return new JoinProbe(reader.GetInt64(0), reader.GetInt64(1), reader.GetInt64(2), reader.GetInt64(3),
            reader.GetInt32(4), reader.GetInt32(5), reader.GetInt32(6), reader.GetInt32(7));
    }

    public async Task<IReadOnlyList<PreparedView>> GetViewsAsync(
        long connectionId, long tenantId, IReadOnlyCollection<long>? ids, CancellationToken ct = default)
    {
        var connection = await db.DatabaseConnections.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == connectionId && c.TenantId == tenantId && !c.IsDeleted, ct);
        return connection is null ? [] : await ViewSources.LoadAsync(db, cache, connection, tenantId, ids, ct);
    }

    public async Task<IReadOnlyList<CatalogColumn>> GetViewSourceColumnsAsync(
        long connectionId, long tenantId, IReadOnlyCollection<DatasetSource> sources, CancellationToken ct = default)
    {
        var connection = await db.DatabaseConnections.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == connectionId && c.TenantId == tenantId && !c.IsDeleted, ct);
        return connection is null ? [] : await ViewSources.StoredColumnsAsync(cache, connection, sources, ct);
    }

    public async Task<ModelSnapshot?> GetSnapshotAsync(long id, long tenantId, CancellationToken ct = default)
    {
        // Nine reads started together, each on a context of its own, so the wait is one round trip
        // instead of nine. The connection and the catalogue reach the dataset through a subquery,
        // so none of them waits for another. The parts are read by dataset id alone; they are only
        // returned when the dataset read, which checks the tenant, finds the dataset.
        var dataset = ReadAsync(c => c.Datasets.AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == id && d.TenantId == tenantId, ct), ct);
        var connection = ReadAsync(c => c.DatabaseConnections.AsNoTracking()
            .FirstOrDefaultAsync(x => x.TenantId == tenantId
                && c.Datasets.Any(d => d.Id == id && d.TenantId == tenantId && d.ConnectionId == x.Id), ct), ct);
        var connections = ReadAsync(c => c.DatabaseConnections.AsNoTracking()
            .Where(x => x.TenantId == tenantId && !x.IsDeleted).ToListAsync(ct), ct);
        var sources = ReadAsync(c => c.DatasetSources.AsNoTracking().Where(s => s.DatasetId == id).ToListAsync(ct), ct);
        var relationships = ReadAsync(c => c.DatasetRelationships.AsNoTracking().Where(r => r.DatasetId == id).ToListAsync(ct), ct);
        var measures = ReadAsync(c => c.DatasetMeasures.AsNoTracking().Where(m => m.DatasetId == id).ToListAsync(ct), ct);
        var calculated = ReadAsync(c => c.DatasetCalculatedColumns.AsNoTracking().Where(x => x.DatasetId == id).ToListAsync(ct), ct);
        var transforms = ReadAsync(c => c.DatasetTransforms.AsNoTracking().Where(t => t.DatasetId == id).ToListAsync(ct), ct);
        // A table in a schema called view or script would pass for a view or script source's columns, so none is read. Each table's
        // columns come from the connection it is read from: its own, or else the dataset's.
        var columns = ReadAsync(c => c.DatabaseSchemas.AsNoTracking()
            .Where(x => x.TenantId == tenantId && !x.IsDeleted && x.SchemaName != ViewSource.Schema && x.SchemaName != ScriptSource.Schema
                && c.Datasets.Any(d => d.Id == id && d.TenantId == tenantId
                    && c.DatasetSources.Any(s => s.DatasetId == id && s.SourceName == x.TableName && (s.ConnectionId ?? d.ConnectionId) == x.ConnectionId)))
            .Select(x => new CatalogColumn(x.SchemaName, x.TableName, x.ColumnName, x.IsPrimaryKey, x.IsForeignKey,
                x.ForeignKeySchema, x.ForeignKeyTable, x.ForeignKeyColumn, x.DataType))
            .ToListAsync(ct), ct);

        await Task.WhenAll(dataset, connection, connections, sources, relationships, measures, columns, calculated, transforms);
        if (await dataset is not { } found) return null;

        IReadOnlyList<CatalogColumn> viewColumns = await connection is { } open
            ? await ViewSources.StoredColumnsAsync(cache, open, await sources, ct)
            : [];
        var published = PublishedModel.Read(found.PublishedModel);
        var publishedColumns = published is null ? [] : await PublishedOnlyColumnsAsync(found, await connection, await sources, published, ct);
        var batches = await connection is { } described
            ? await ViewSources.BatchesAsync(cache, described, [.. await sources, .. published?.Sources ?? []], ct)
            : new Dictionary<string, IReadOnlyList<ViewColumn>>();
        return new ModelSnapshot(0, found, await connection, await sources, await relationships, await measures,
            [.. await columns, .. viewColumns], await calculated, await transforms)
            { Published = published, PublishedColumns = publishedColumns, Connections = await connections, Batches = batches };
    }

    /// <summary>
    /// The catalogue columns of the tables and views the published version has and the draft no longer has,
    /// so canvases keep working while a table is removed in the draft. Usually nothing to read.
    /// </summary>
    private async Task<IReadOnlyList<CatalogColumn>> PublishedOnlyColumnsAsync(
        Dataset dataset, DatabaseConnection? connection, IReadOnlyList<DatasetSource> draft, PublishedModel published, CancellationToken ct)
    {
        var have = draft.Select(s => (s.SourceKind, s.SchemaName, s.SourceName, s.ViewSql)).ToHashSet();
        var missing = published.Sources.Where(s => !have.Contains((s.SourceKind, s.SchemaName, s.SourceName, s.ViewSql))).ToList();
        if (missing.Count == 0) return [];
        var tableColumns = new List<CatalogColumn>();
        foreach (var tables in missing.Where(s => s.SourceKind == "table").GroupBy(s => s.ConnectionId ?? dataset.ConnectionId))
            tableColumns.AddRange(await GetColumnsAsync(tables.Key, dataset.TenantId, tables.Select(s => s.SourceName).Distinct().ToList(), ct));
        var views = missing.Where(s => s.SourceKind != "table").ToList();
        IReadOnlyList<CatalogColumn> viewColumns = views.Count == 0 || connection is null ? [] : await ViewSources.StoredColumnsAsync(cache, connection, views, ct);
        return [.. tableColumns, .. viewColumns];
    }

    /// <summary>One read on a context of its own: a DbContext runs one command at a time.</summary>
    private async Task<T> ReadAsync<T>(Func<TenantDbContext, Task<T>> read, CancellationToken ct)
    {
        await using var context = await contexts.CreateDbContextAsync(ct);
        return await read(context);
    }

    public async Task AddAsync<T>(T entity, CancellationToken ct = default) where T : class
    {
        db.Add(entity);
        await db.SaveChangesAsync(ct);
    }

    public async Task DeleteAsync<T>(T entity, CancellationToken ct = default) where T : class
    {
        db.Remove(entity);
        await db.SaveChangesAsync(ct);
    }

    public Task SaveAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);

    public async Task<bool> RemoveSourceAsync(long datasetId, long sourceId, CancellationToken ct = default)
    {
        // The relationships, calculated columns and transforms go first: they reference model.DatasetSource.
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            await db.DatasetRelationships
                .Where(r => r.DatasetId == datasetId && (r.FromSourceId == sourceId || r.ToSourceId == sourceId))
                .ExecuteDeleteAsync(ct);
            await db.DatasetCalculatedColumns.Where(c => c.DatasetId == datasetId && c.SourceId == sourceId).ExecuteDeleteAsync(ct);
            await db.DatasetTransforms.Where(t => t.DatasetId == datasetId && t.SourceId == sourceId).ExecuteDeleteAsync(ct);
            // Measures listed under the table move back to the dataset's measures.
            await db.DatasetMeasures.Where(m => m.DatasetId == datasetId && m.HomeSourceId == sourceId)
                .ExecuteUpdateAsync(set => set.SetProperty(m => m.HomeSourceId, (long?)null), ct);
            await db.DatasetSources.Where(s => s.DatasetId == datasetId && s.Id == sourceId).ExecuteDeleteAsync(ct);
        }
        // 547: a relationship to the source was added after the first delete. Disposing the
        // transaction rolls back, so the source and its relationships stay as they were.
        catch (SqlException ex) when (ex.Number == 547)
        {
            return false;
        }
        await tx.CommitAsync(ct);
        return true;
    }

    public async Task ReplacePartsAsync(long datasetId, PublishedModel model, CancellationToken ct = default)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        // The rows that reference model.DatasetSource go first, then the sources.
        await db.DatasetRelationships.Where(r => r.DatasetId == datasetId).ExecuteDeleteAsync(ct);
        await db.DatasetCalculatedColumns.Where(c => c.DatasetId == datasetId).ExecuteDeleteAsync(ct);
        await db.DatasetTransforms.Where(t => t.DatasetId == datasetId).ExecuteDeleteAsync(ct);
        await db.DatasetMeasures.Where(m => m.DatasetId == datasetId).ExecuteDeleteAsync(ct);
        await db.DatasetSources.Where(s => s.DatasetId == datasetId).ExecuteDeleteAsync(ct);

        // Sources are written first for their new ids; everything that names a source is written with the new one.
        var sources = model.Sources.ToDictionary(s => s.Id, s => new DatasetSource
        {
            DatasetId = datasetId, SourceKind = s.SourceKind, SchemaName = s.SchemaName, SourceName = s.SourceName, Alias = s.Alias, ConnectionId = s.ConnectionId,
            RlsMode = s.RlsMode, RlsPlantColumn = s.RlsPlantColumn, RowEstimate = s.RowEstimate, ViewSql = s.ViewSql, HiddenColumns = s.HiddenColumns,
            Caption = s.Caption, Description = s.Description, ParamsJson = s.ParamsJson,
        });
        db.DatasetSources.AddRange(sources.Values);
        await db.SaveChangesAsync(ct);
        long Id(long old) => sources[old].Id;
        long? Home(long? old) => old is { } id && sources.TryGetValue(id, out var source) ? source.Id : null;

        db.DatasetRelationships.AddRange(model.Relationships.Select(r => new DatasetRelationship
        {
            DatasetId = datasetId, FromSourceId = Id(r.FromSourceId), FromColumn = r.FromColumn, ToSourceId = Id(r.ToSourceId),
            ToColumn = r.ToColumn, Cardinality = r.Cardinality, IsActive = r.IsActive, DetectedFrom = r.DetectedFrom,
        }));
        db.DatasetCalculatedColumns.AddRange(model.CalculatedColumns.Select(c => new DatasetCalculatedColumn
        {
            DatasetId = datasetId, SourceId = Id(c.SourceId), Name = c.Name, ExpressionAst = c.ExpressionAst,
            ExpressionText = c.ExpressionText, DataType = c.DataType,
        }));
        db.DatasetTransforms.AddRange(model.Transforms.Select(t => new DatasetTransform
        {
            DatasetId = datasetId, SourceId = Id(t.SourceId), ColumnName = t.ColumnName, Kind = t.Kind, ConfigJson = t.ConfigJson, SortOrder = t.SortOrder,
        }));
        db.DatasetMeasures.AddRange(model.Measures.Select(m => new DatasetMeasure
        {
            DatasetId = datasetId, Name = m.Name, ExpressionAst = m.ExpressionAst, ExpressionText = m.ExpressionText, Format = m.Format,
            Folder = m.Folder, HomeSourceId = Home(m.HomeSourceId), IsCertified = m.IsCertified,
        }));
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
    }

    /// <summary>Initial Catalog of the connection string; null when it is missing, unreadable or names no database.</summary>
    private static string? DatabaseOf(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString)) return null;
        try
        {
            var database = new SqlConnectionStringBuilder(connectionString).InitialCatalog;
            return string.IsNullOrWhiteSpace(database) ? null : database;
        }
        catch (ArgumentException)
        {
            return null;
        }
    }
}
