namespace TWise.Tenant.Application.Abstractions;

public interface IRepository<T> where T : class
{
    Task<T?> GetAsync(long id, CancellationToken ct = default);
    Task<IReadOnlyList<T>> GetAllAsync(CancellationToken ct = default);
    Task<T> AddAsync(T entity, CancellationToken ct = default);
    Task UpdateAsync(T entity, CancellationToken ct = default);
    Task DeleteAsync(long id, CancellationToken ct = default);
}
