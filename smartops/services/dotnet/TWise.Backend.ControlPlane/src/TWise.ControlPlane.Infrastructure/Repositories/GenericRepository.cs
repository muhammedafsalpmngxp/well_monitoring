using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.Entities;
using TWise.Backend.ControlPlane.Infrastructure.Persistence;

namespace TWise.Backend.ControlPlane.Infrastructure.Repositories;

/// <summary>
/// Generic EF Core repository over the control-plane DbContext. Works for any mapped
/// entity regardless of its PK name/type (uses the model's primary-key metadata).
/// </summary>
public sealed class GenericRepository<T>(ControlPlaneDbContext db, ILogger<GenericRepository<T>> logger) : IGenericRepository<T> where T : class
{
    private static readonly string EntityName = typeof(T).Name;
    private DbSet<T> Set => db.Set<T>();

    public async Task<IReadOnlyList<T>> GetAllAsync(CancellationToken ct = default)
        => await Set.AsNoTracking().ToListAsync(ct);

    public async Task<IReadOnlyList<T>> GetAllUnfilteredAsync(CancellationToken ct = default)
        => await Set.AsNoTracking().IgnoreQueryFilters().ToListAsync(ct);

    public async Task<PagedResult<T>> GetPagedAsync(int page, int pageSize, CancellationToken ct = default)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 1000);

        var pk = db.Model.FindEntityType(typeof(T))!.FindPrimaryKey()!.Properties[0].Name;
        var totalCount = await Set.AsNoTracking().CountAsync(ct);
        var items = await Set.AsNoTracking()
            .OrderBy(e => EF.Property<object>(e, pk))
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);
        return new PagedResult<T>(items, totalCount, page, pageSize);
    }

    public async Task<T?> GetAsync(object key, CancellationToken ct = default)
        => await Set.FindAsync([key], ct);

    public async Task<T> AddAsync(T entity, CancellationToken ct = default)
    {
        Stamp(entity, isNew: true);
        Set.Add(entity);
        await db.SaveChangesAsync(ct);
        logger.LogInformation("[ControlPlane] Created {Entity} entity", EntityName);
        return entity;
    }

    public async Task<IReadOnlyList<T>> AddRangeAsync(IEnumerable<T> entities, CancellationToken ct = default)
    {
        var list = entities.ToList();
        foreach (var entity in list) Stamp(entity, isNew: true);
        Set.AddRange(list);
        await db.SaveChangesAsync(ct);
        logger.LogInformation("[ControlPlane] Bulk-created {Count} {Entity} entities", list.Count, EntityName);
        return list;
    }

    public async Task<bool> UpdateAsync(object key, T incoming, CancellationToken ct = default)
    {
        var existing = await Set.FindAsync([key], ct);
        if (existing is null)
        {
            logger.LogWarning("[ControlPlane] Update failed: {Entity} with key {Key} not found", EntityName, key);
            return false;
        }

        var entry = db.Entry(existing);
        var pkProps = entry.Metadata.FindPrimaryKey()!.Properties;
        var pkNames = pkProps.Select(p => p.Name).ToList();
        var keyValues = pkNames.ToDictionary(name => name, name => entry.Property(name).CurrentValue);
        entry.CurrentValues.SetValues(incoming);
        foreach (var name in pkNames) entry.Property(name).CurrentValue = keyValues[name];

        Stamp(existing, isNew: false);
        await db.SaveChangesAsync(ct);
        logger.LogInformation("[ControlPlane] Updated {Entity} with key {Key}", EntityName, key);
        return true;
    }

    public async Task<bool> UpdateRangeAsync(IDictionary<object, T> updates, CancellationToken ct = default)
    {
        if (updates.Count == 0) return true;

        // Single DB round-trip: load all entities matching the given keys
        var entities = await LoadByKeysAsync(updates.Keys, ct);
        if (entities.Count != updates.Count)
        {
            var loadedKeys = entities.Select(GetPrimaryKeyValue).ToHashSet();
            var missing = updates.Keys.First(k => !loadedKeys.Contains(k));
            logger.LogWarning("[ControlPlane] Bulk update failed: {Entity} with key {Key} not found", EntityName, missing);
            db.ChangeTracker.Clear();
            return false;
        }

        foreach (var existing in entities)
        {
            var key = GetPrimaryKeyValue(existing);
            var incoming = updates[key];

            var entry = db.Entry(existing);
            var pkProps = entry.Metadata.FindPrimaryKey()!.Properties;
            var pkNames = pkProps.Select(p => p.Name).ToList();
            var keyValues = pkNames.ToDictionary(name => name, name => entry.Property(name).CurrentValue);
            entry.CurrentValues.SetValues(incoming);
            foreach (var name in pkNames) entry.Property(name).CurrentValue = keyValues[name];

            Stamp(existing, isNew: false);
        }

        await db.SaveChangesAsync(ct);
        logger.LogInformation("[ControlPlane] Bulk-updated {Count} {Entity} entities", updates.Count, EntityName);
        return true;
    }

    private object GetPrimaryKeyValue(T entity)
    {
        var entityType = db.Model.FindEntityType(typeof(T))!;
        var pkProp = entityType.FindPrimaryKey()!.Properties[0];
        return pkProp.PropertyInfo!.GetValue(entity)!;
    }

    private async Task<List<T>> LoadByKeysAsync(IEnumerable<object> keys, CancellationToken ct)
    {
        var entityType = db.Model.FindEntityType(typeof(T))!;
        var pkProp = entityType.FindPrimaryKey()!.Properties[0];
        var clrType = pkProp.ClrType;
        var propertyInfo = pkProp.PropertyInfo!;

        // Build expression: e => keyList.Contains(e.PkProperty)
        var param = Expression.Parameter(typeof(T), "e");
        var propertyAccess = Expression.Property(param, propertyInfo);

        var typedKeys = keys.Select(k => Convert.ChangeType(k, clrType)).ToArray();
        var keyListType = typeof(List<>).MakeGenericType(clrType);
        var keyList = (System.Collections.IList)Activator.CreateInstance(keyListType, typedKeys.Length)!;
        foreach (var k in typedKeys) keyList.Add(k);

        var containsMethod = keyListType.GetMethod("Contains", [clrType])!;
        var listConstant = Expression.Constant(keyList);
        var containsCall = Expression.Call(listConstant, containsMethod, propertyAccess);
        var lambda = Expression.Lambda<Func<T, bool>>(containsCall, param);

        return await Set.Where(lambda).ToListAsync(ct);
    }

    public async Task<bool> DeleteAsync(object key, CancellationToken ct = default)
    {
        var existing = await Set.FindAsync([key], ct);
        if (existing is null)
        {
            logger.LogWarning("[ControlPlane] Delete failed: {Entity} with key {Key} not found", EntityName, key);
            return false;
        }

        if (existing is ISoftDeletable deletable)
        {
            deletable.IsDeleted = true;
            deletable.DeletedAt = DateTime.UtcNow;
        }

        if (existing is IControlAudited audited)
        {
            audited.ModifiedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(ct);
        logger.LogInformation("[ControlPlane] Soft-deleted {Entity} with key {Key}", EntityName, key);
        return true;
    }

    private static void Stamp(T entity, bool isNew)
    {
        if (entity is IControlAudited a)
        {
            var now = DateTime.UtcNow;
            if (isNew) a.CreatedAt = now;
            a.ModifiedAt = now;
        }
    }
}
