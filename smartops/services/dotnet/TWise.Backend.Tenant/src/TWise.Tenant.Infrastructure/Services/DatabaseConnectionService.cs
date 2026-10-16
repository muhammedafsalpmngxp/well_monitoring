using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Application.Abstractions.DataSources;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Domain.DTOs;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Services;

public sealed class DatabaseConnectionService(
    IDatabaseConnectionRepository repo,
    TenantDbContext db,
    ISqlProviderFactory providerFactory,
    ILogger<DatabaseConnectionService> logger) : IDatabaseConnectionService
{
    /// <summary>
    /// Budget for the catalogue query. Discovering a few hundred columns with their foreign
    /// keys can exceed the 30s driver default on a large schema.
    /// </summary>
    private const int SchemaSyncCommandTimeoutSeconds = 180;

    public async Task<IReadOnlyList<DatabaseConnectionDto>> GetAllAsync(long tenantId, CancellationToken cancellationToken = default)
    {
        var entities = await repo.GetAllAsync(tenantId, cancellationToken);
        return entities.Select(ToDto).ToList();
    }

    public async Task<DatabaseConnectionDto?> GetByIdAsync(long id, long tenantId, CancellationToken cancellationToken = default)
    {
        var entity = await repo.GetByIdAsync(id, tenantId, cancellationToken);
        return entity is null ? null : ToDto(entity);
    }

    public async Task<DatabaseConnectionDto> CreateAsync(
        CreateDatabaseConnectionRequest request, long userId, long tenantId, CancellationToken cancellationToken = default)
    {
        if (await repo.ExistsByNameAsync(request.ConnectionName, tenantId, cancellationToken: cancellationToken))
            throw new InvalidOperationException($"A connection named '{request.ConnectionName}' already exists.");

        var entity = new DatabaseConnection
        {
            ConnectionName = request.ConnectionName,
            Server = request.Server,
            Port = request.Port,
            DatabaseName = request.DatabaseName,
            Username = request.Username,
            PasswordHash = ConnectionPasswordHelper.Encrypt(request.Password),
            Provider = request.Provider,
            TrustServerCertificate = request.TrustServerCertificate,
            IsActive = true,
            TenantId = tenantId,
            CreatedBy = userId,
            CreatedAt = DateTime.UtcNow,
            ModifiedAt = DateTime.UtcNow
        };

        var saved = await repo.AddAsync(entity, cancellationToken);
        logger.LogInformation("Database connection '{Name}' created for tenant {TenantId}", request.ConnectionName, tenantId);
        return ToDto(saved);
    }

    public async Task<DatabaseConnectionDto?> UpdateAsync(
        long id, UpdateDatabaseConnectionRequest request, long userId, long tenantId, CancellationToken cancellationToken = default)
    {
        var entity = await repo.GetByIdAsync(id, tenantId, cancellationToken);
        if (entity is null) return null;

        if (await repo.ExistsByNameAsync(request.ConnectionName, tenantId, id, cancellationToken))
            throw new InvalidOperationException($"A connection named '{request.ConnectionName}' already exists.");

        entity.ConnectionName = request.ConnectionName;
        entity.Server = request.Server;
        entity.Port = request.Port;
        entity.DatabaseName = request.DatabaseName;
        entity.Username = request.Username;
        entity.Provider = request.Provider;
        entity.TrustServerCertificate = request.TrustServerCertificate;
        entity.IsActive = request.IsActive;
        entity.ModifiedBy = userId;
        entity.ModifiedAt = DateTime.UtcNow;

        if (!string.IsNullOrWhiteSpace(request.Password))
            entity.PasswordHash = ConnectionPasswordHelper.Encrypt(request.Password);

        await repo.UpdateAsync(entity, cancellationToken);
        return ToDto(entity);
    }

    public async Task<bool> DeleteAsync(long id, long tenantId, CancellationToken cancellationToken = default)
        => await repo.SoftDeleteAsync(id, tenantId, cancellationToken);

    public async Task<DatabaseSchemaResponse?> GetSchemaAsync(long connectionId, long tenantId, CancellationToken cancellationToken = default)
    {
        var entity = await repo.GetByIdAsync(connectionId, tenantId, cancellationToken);
        if (entity is null) return null;

        var rows = await db.DatabaseSchemas
            .Where(s => s.ConnectionId == connectionId && s.TenantId == tenantId)
            .OrderBy(s => s.SchemaName).ThenBy(s => s.TableName).ThenBy(s => s.OrdinalPosition)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        var syncedAt = rows.FirstOrDefault()?.SyncedAt ?? DateTime.MinValue;

        var tableGroups = rows
            .GroupBy(r => new { r.SchemaName, r.TableName })
            .Select(g => new DatabaseSchemaTableGroup(
                g.Key.SchemaName,
                g.Key.TableName,
                g.Count(),
                g.Select(c => new DatabaseSchemaColumnDto(
                    c.Id, c.ColumnName, c.DataType, c.IsNullable,
                    c.IsPrimaryKey, c.IsForeignKey, c.ForeignKeySchema,
                    c.ForeignKeyTable, c.ForeignKeyColumn,
                    c.MaxLength, c.OrdinalPosition
                )).ToList()
            )).ToList();

        return new DatabaseSchemaResponse(entity.Id, entity.ConnectionName, entity.DatabaseName, syncedAt, tableGroups);
    }

    public async Task<DatabaseSchemaResponse?> SyncSchemaAsync(long connectionId, long tenantId, CancellationToken cancellationToken = default)
    {
        var entity = await repo.GetByIdAsync(connectionId, tenantId, cancellationToken);
        if (entity is null) return null;

        var provider = providerFactory.Get(entity);
        var connectionString = provider.BuildConnectionString(entity, connectTimeoutSeconds: 15);

        IReadOnlyList<DiscoveredColumn> discoveredColumns;
        try
        {
            await using var remote = provider.CreateConnection(connectionString);
            await remote.OpenAsync(cancellationToken);
            discoveredColumns = await provider.DiscoverSchemaAsync(remote, SchemaSyncCommandTimeoutSeconds, cancellationToken);
        }
        catch (Exception ex) when (provider.IsTransportException(ex))
        {
            logger.LogError(ex, "Failed to connect to remote {Provider} database for connection {ConnectionId}, tenant {TenantId}",
                provider.Provider, connectionId, tenantId);
            throw; // rethrow — middleware returns 502
        }
        var now = DateTime.UtcNow;

        // The old rows are soft-deleted and the new ones added in one transaction, so a dataset
        // read (and cached) in between never sees an empty or half-written catalogue.
        // ExecuteUpdateAsync runs on the context's connection inside this transaction, and
        // SaveChangesAsync uses it instead of opening its own.
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // Soft-delete existing schema rows for this connection
        await db.DatabaseSchemas
            .Where(s => s.ConnectionId == connectionId && s.TenantId == tenantId)
            .ExecuteUpdateAsync(s => s.SetProperty(r => r.IsDeleted, true), cancellationToken);

        // Insert fresh schema rows
        var entities = discoveredColumns.Select(col => new DatabaseSchema
        {
            ConnectionId = connectionId,
            SchemaName = col.SchemaName,
            TableName = col.TableName,
            ColumnName = col.ColumnName,
            DataType = col.DataType,
            IsNullable = col.IsNullable,
            IsPrimaryKey = col.IsPrimaryKey,
            IsForeignKey = col.IsForeignKey,
            ForeignKeySchema = col.ForeignKeySchema,
            ForeignKeyTable = col.ForeignKeyTable,
            ForeignKeyColumn = col.ForeignKeyColumn,
            MaxLength = col.MaxLength,
            OrdinalPosition = col.OrdinalPosition,
            TenantId = tenantId,
            SyncedAt = now
        });

        db.DatabaseSchemas.AddRange(entities);
        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        logger.LogInformation("Schema synced for connection {ConnectionId}, tenant {TenantId}: {RowCount} columns",
            connectionId, tenantId, discoveredColumns.Count);

        return await GetSchemaAsync(connectionId, tenantId, cancellationToken);
    }

    private static DatabaseConnectionDto ToDto(DatabaseConnection e) => new(
        e.Id, e.ConnectionName, e.Server, e.Port, e.DatabaseName, e.Username,
        e.Provider, e.TrustServerCertificate, e.IsActive,
        e.TenantId, e.CreatedBy, e.CreatedAt, e.ModifiedBy, e.ModifiedAt);
}
