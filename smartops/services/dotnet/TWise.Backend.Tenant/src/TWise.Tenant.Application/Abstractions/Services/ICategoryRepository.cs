using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions.Services;

public interface ICategoryRepository
{
    Task<IReadOnlyList<Category>> GetAllAsync(string? controlType = null, string? createdBy = null, CancellationToken ct = default);
    Task<Category?> GetByIdAsync(int categoryId, CancellationToken ct = default);
    /// <summary>
    /// Returns a tracked category with non-deleted dashboards for the soft-delete workflow.
    /// Reuses an instance already loaded in the current unit of work.
    /// </summary>
    Task<Category?> GetByIdWithDashboardsAsync(int categoryId, CancellationToken ct = default);
    Task<bool> ExistsByNameAsync(string categoryName, string controlType, CancellationToken ct = default, int? excludeId = null, string? createdBy = null);
    Task CreateAsync(Category category, CancellationToken ct = default);
    Task UpdateAsync(Category category, CancellationToken ct = default);
    Task<IReadOnlyDictionary<int, int>> GetItemCountsByCategoryAsync(string controlType, string? userId, bool isAdmin, CancellationToken ct = default);
}
