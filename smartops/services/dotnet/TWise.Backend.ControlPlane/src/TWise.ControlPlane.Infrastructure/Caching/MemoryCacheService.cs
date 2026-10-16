using System.Collections.Concurrent;
using Microsoft.AspNetCore.OutputCaching;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using TWise.Backend.ControlPlane.Application.Common.Caching;

namespace TWise.Backend.ControlPlane.Infrastructure.Caching;

/// <summary>
/// In-process memory cache implementation. Suitable for single-instance deployments.
/// For multi-instance (K8s pods), layer Redis on top via a decorator.
/// </summary>
public sealed class MemoryCacheService(
    IMemoryCache memoryCache,
    IOutputCacheStore outputCacheStore,
    ILogger<MemoryCacheService> _logger) : ICacheService
{
    // Track keys by prefix for prefix-based invalidation
    private readonly ConcurrentDictionary<string, byte> _keys = new();

    public Task<T?> GetAsync<T>(string key, CancellationToken ct = default)
    {
        _logger.LogDebug("Getting cache entry for key: {Key}", key);
        return Task.FromResult(memoryCache.TryGetValue(key, out T? value) ? value : default);
    }

    public Task SetAsync<T>(string key, T value, TimeSpan? absoluteExpiration = null, TimeSpan? slidingExpiration = null, CancellationToken ct = default)
    {
        var options = new MemoryCacheEntryOptions();

        if (absoluteExpiration.HasValue)
            options.AbsoluteExpirationRelativeToNow = absoluteExpiration;

        if (slidingExpiration.HasValue)
            options.SlidingExpiration = slidingExpiration;

        options.RegisterPostEvictionCallback((evictedKey, _, _, _) =>
            _keys.TryRemove(evictedKey.ToString()!, out _));

        memoryCache.Set(key, value, options);
        _keys.TryAdd(key, 0);
        _logger.LogDebug("Creating cache entry for key: {Key}", key);

        return Task.CompletedTask;
    }

    public Task RemoveAsync(string key, CancellationToken ct = default)
    {
        memoryCache.Remove(key);
        _keys.TryRemove(key, out _);
        return Task.CompletedTask;
    }

    public Task RemoveByPrefixAsync(string prefix, CancellationToken ct = default)
    {
        var keysToRemove = _keys.Keys
            .Where(k => k.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            .ToList();

        foreach (var key in keysToRemove)
        {
            memoryCache.Remove(key);
            _keys.TryRemove(key, out _);
        }

        return Task.CompletedTask;
    }

    public async Task EvictOutputCacheAsync(CancellationToken ct = default)
    {
        await outputCacheStore.EvictByTagAsync("controlplane", ct);
    }
}
