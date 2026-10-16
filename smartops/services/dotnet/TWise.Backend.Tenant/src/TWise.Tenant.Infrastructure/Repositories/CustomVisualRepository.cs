using Microsoft.EntityFrameworkCore;
using TWise.Tenant.Application.Abstractions;
using TWise.Tenant.Domain.Entities;
using TWise.Tenant.Infrastructure.Persistence;

namespace TWise.Tenant.Infrastructure.Repositories;

public sealed class CustomVisualRepository(TenantDbContext db) : ICustomVisualRepository
{
    public async Task<IReadOnlyList<CustomVisual>> GetAllAsync(long tenantId, bool activeOnly, CancellationToken ct = default)
        => await db.CustomVisuals
            .AsNoTracking()
            .Where(v => v.TenantId == tenantId && (!activeOnly || v.IsActive))
            .OrderBy(v => v.DisplayName)
            .ToListAsync(ct);

    public Task<CustomVisual?> GetByIdAsync(long id, long tenantId, CancellationToken ct = default)
        => db.CustomVisuals.FirstOrDefaultAsync(v => v.Id == id && v.TenantId == tenantId, ct);

    public Task<CustomVisual?> GetByKeyAsync(string visualKey, long tenantId, CancellationToken ct = default)
    {
        var key = CustomVisualKeys.Normalise(visualKey);
        return db.CustomVisuals
            .AsNoTracking()
            .FirstOrDefaultAsync(v => v.TenantId == tenantId && v.VisualKey == key, ct);
    }

    public Task<CustomVisual?> GetByCatalogPluginAsync(string catalogId, string pluginId, long tenantId, CancellationToken ct = default)
        => db.CustomVisuals.FirstOrDefaultAsync(
            v => v.TenantId == tenantId && v.CatalogId == catalogId && v.CatalogPluginId == pluginId, ct);

    public Task<bool> KeyExistsAsync(string visualKey, long tenantId, long? excludeId = null, CancellationToken ct = default)
    {
        var key = CustomVisualKeys.Normalise(visualKey);
        return db.CustomVisuals
            .AnyAsync(v => v.TenantId == tenantId
                        && v.VisualKey == key
                        && (excludeId == null || v.Id != excludeId), ct);
    }

    public async Task<CustomVisual> AddAsync(CustomVisual visual, CancellationToken ct = default)
    {
        db.CustomVisuals.Add(visual);
        await db.SaveChangesAsync(ct);
        return visual;
    }

    public async Task UpdateAsync(CustomVisual visual, CancellationToken ct = default)
    {
        visual.ModifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    public async Task<bool> SoftDeleteAsync(long id, long tenantId, CancellationToken ct = default)
    {
        var visual = await db.CustomVisuals.FirstOrDefaultAsync(v => v.Id == id && v.TenantId == tenantId, ct);
        if (visual is null) return false;

        visual.IsDeleted = true;
        visual.ModifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>
    /// A widget stores its chart type inside DesignJson rather than in a column, so usage can
    /// only be found by matching the serialised property. Both spacings JSON.NET/System.Text.Json
    /// can emit are checked. The key's character set (letters, digits, hyphen) contains no LIKE
    /// metacharacters, so the pattern needs no escaping.
    /// </summary>
    public Task<int> CountWidgetsUsingAsync(string visualKey, long tenantId, CancellationToken ct = default)
    {
        var key = CustomVisualKeys.Normalise(visualKey);
        var compact = $"%\"chartType\":\"{key}\"%";
        var spaced = $"%\"chartType\": \"{key}\"%";

        return db.Widgets
            .AsNoTracking()
            .Where(w => w.TenantId == tenantId
                     && w.DesignJson != null
                     && (EF.Functions.Like(w.DesignJson, compact) || EF.Functions.Like(w.DesignJson, spaced)))
            .CountAsync(ct);
    }
}
