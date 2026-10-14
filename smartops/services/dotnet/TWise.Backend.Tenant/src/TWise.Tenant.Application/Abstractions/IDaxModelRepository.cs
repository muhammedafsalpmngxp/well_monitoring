using TWise.Tenant.Domain.Entities;

namespace TWise.Tenant.Application.Abstractions;

/// <param name="OwnerId">Only this user's models; null for all models (admins).</param>
public sealed record DaxModelListFilter(string? Search, string? Status, int? SinceDays, int Page, int PageSize, long? OwnerId);

public interface IDaxModelRepository
{
    /// <summary>A page of models, newest first, and the number matching the filter.</summary>
    Task<(IReadOnlyList<SavedDaxModel> Items, int Total)> ListAsync(DaxModelListFilter filter, CancellationToken ct = default);

    /// <summary>Counts over the owner's models (every model when ownerId is null): all, from tables, from views.</summary>
    Task<(int All, int Tables, int Views)> CountBySourceTypeAsync(long? ownerId, CancellationToken ct = default);

    /// <summary>How many saved charts reference each model id (measures carry "savedModelId").</summary>
    Task<IReadOnlyDictionary<long, int>> CountChartUsageAsync(IReadOnlyCollection<long> ids, CancellationToken ct = default);

    /// <summary>The saved charts that use the model, by name.</summary>
    Task<IReadOnlyList<DaxModelChartUse>> ListChartsUsingAsync(long id, CancellationToken ct = default);

    /// <summary>A tracked model by id, or null when it does not exist, is deleted or belongs to another user
    /// (ownerId null = any owner, for admins).</summary>
    Task<SavedDaxModel?> GetByIdAsync(long id, long? ownerId, CancellationToken ct = default);

    Task<SavedDaxModel> AddAsync(SavedDaxModel model, CancellationToken ct = default);

    /// <summary>Saves changes made to a model returned by <see cref="GetByIdAsync"/>.</summary>
    Task UpdateAsync(SavedDaxModel model, CancellationToken ct = default);
}

/// <summary>A saved chart that uses a DAX model, with what decides who may see its name.</summary>
public sealed record DaxModelChartUse(string Name, long CreatedBy, bool Published);
