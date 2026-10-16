using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

public interface IWidgetRepository
{
    Task<IReadOnlyList<Widget>> GetAllAsync(string? status, string? type, long userId, bool isAdmin, CancellationToken ct = default);
    Task<Widget?> GetAccessibleByIdAsync(long id, long userId, CancellationToken ct = default);
    /// <summary>Widgets by id in one query (tiles attached to a chart the caller can already see).</summary>
    Task<IReadOnlyList<Widget>> GetByIdsAsync(IReadOnlyCollection<long> ids, CancellationToken ct = default);
    Task<Widget> CreateAndLoadCategoryAsync(Widget widget, CancellationToken ct = default);
    Task<Widget> SaveAndLoadCategoryAsync(Widget widget, CancellationToken ct = default);
    Task<Widget> PublishCopyToSourceAsync(Widget source, Widget copy, CancellationToken ct = default);
    Task<bool> SoftDeleteAsync(long id, long userId, CancellationToken ct = default);

    /// <summary>Count of non-deleted widgets (charts/tiles) still assigned to this category.</summary>
    Task<int> CountActiveByCategoryAsync(int categoryId, CancellationToken ct = default);

    /// <summary>Returns true if a non-deleted widget with the same name and type already exists for this user (excluding the given id).</summary>
    Task<bool> IsDuplicateNameAsync(string name, string type, long userId, long? excludeId, CancellationToken ct = default);
}
