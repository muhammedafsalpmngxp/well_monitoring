using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface ICustomVisualRepository
{
    /// <summary>All visuals for the tenant. <paramref name="activeOnly"/> is what the builder
    /// palette uses; the management screen passes false so deactivated ones remain editable.</summary>
    Task<IReadOnlyList<CustomVisual>> GetAllAsync(long tenantId, bool activeOnly, CancellationToken ct = default);

    Task<CustomVisual?> GetByIdAsync(long id, long tenantId, CancellationToken ct = default);

    /// <summary>Looked up by the renderer, which only knows the widget's chart type.</summary>
    Task<CustomVisual?> GetByKeyAsync(string visualKey, long tenantId, CancellationToken ct = default);

    /// <summary>The visual installed from a given catalog plugin, or null when not installed.</summary>
    Task<CustomVisual?> GetByCatalogPluginAsync(string catalogId, string pluginId, long tenantId, CancellationToken ct = default);

    Task<bool> KeyExistsAsync(string visualKey, long tenantId, long? excludeId = null, CancellationToken ct = default);

    Task<CustomVisual> AddAsync(CustomVisual visual, CancellationToken ct = default);
    Task UpdateAsync(CustomVisual visual, CancellationToken ct = default);
    Task<bool> SoftDeleteAsync(long id, long tenantId, CancellationToken ct = default);

    /// <summary>
    /// Number of widgets still referencing this visual. Deleting one that is in use would leave
    /// those widgets unable to render, so the caller warns instead of silently breaking them.
    /// </summary>
    Task<int> CountWidgetsUsingAsync(string visualKey, long tenantId, CancellationToken ct = default);
}
