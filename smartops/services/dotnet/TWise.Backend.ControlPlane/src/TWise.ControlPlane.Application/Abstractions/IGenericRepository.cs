using TWise.Backend.ControlPlane.Application.Common;

namespace TWise.Backend.ControlPlane.Application.Abstractions;

/// <summary>
/// Generic repository abstraction for control-plane CRUD operations.
/// </summary>
public interface IGenericRepository<T> where T : class
{
    Task<IReadOnlyList<T>> GetAllAsync(CancellationToken ct = default);
    Task<IReadOnlyList<T>> GetAllUnfilteredAsync(CancellationToken ct = default);
    Task<PagedResult<T>> GetPagedAsync(int page, int pageSize, CancellationToken ct = default);
    Task<T?> GetAsync(object key, CancellationToken ct = default);
    Task<T> AddAsync(T entity, CancellationToken ct = default);
    Task<IReadOnlyList<T>> AddRangeAsync(IEnumerable<T> entities, CancellationToken ct = default);
    Task<bool> UpdateAsync(object key, T incoming, CancellationToken ct = default);
    Task<bool> UpdateRangeAsync(IDictionary<object, T> updates, CancellationToken ct = default);
    Task<bool> DeleteAsync(object key, CancellationToken ct = default);
}
