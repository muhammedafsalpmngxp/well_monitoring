namespace TWise.Backend.ControlPlane.Application.Common.Caching;

/// <summary>
/// Abstraction over the caching store. Supports both in-memory and distributed implementations.
/// </summary>
public interface ICacheService
{
    Task<T?> GetAsync<T>(string key, CancellationToken ct = default);
    Task SetAsync<T>(string key, T value, TimeSpan? absoluteExpiration = null, TimeSpan? slidingExpiration = null, CancellationToken ct = default);
    Task RemoveAsync(string key, CancellationToken ct = default);
    Task RemoveByPrefixAsync(string prefix, CancellationToken ct = default);
    Task EvictOutputCacheAsync(CancellationToken ct = default);
}
