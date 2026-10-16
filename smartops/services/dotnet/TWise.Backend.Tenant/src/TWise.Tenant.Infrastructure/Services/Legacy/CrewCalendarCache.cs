using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using Microsoft.Extensions.Caching.Memory;

namespace TWise.Tenant.Infrastructure.Services.Legacy;

public sealed class CrewCalendarCache(IMemoryCache cache)
{
    private static readonly ConditionalWeakTable<IMemoryCache, ConcurrentDictionary<string, PendingLoad>> Loads = new();

    private sealed record PendingLoad(Lazy<Task<object>> Result, CancellationToken OwnerCancellation);

    public async Task<T> GetOrCreateAsync<T>(string key, TimeSpan lifetime,
        Func<CancellationToken, Task<T>> load, CancellationToken cancellationToken,
        Func<T, DateTimeOffset?>? expiresAt = null) where T : class
    {
        var pending = Loads.GetValue(cache, _ => new());
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (cache.TryGetValue(key, out T? cached) && cached is not null) return cached;

            PendingLoad? candidate = null;
            candidate = new PendingLoad(new Lazy<Task<object>>(() => LoadAsync(candidate!)), cancellationToken);
            var selected = pending.GetOrAdd(key, candidate);
            try
            {
                return (T)await selected.Result.Value.WaitAsync(cancellationToken);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && selected.OwnerCancellation.IsCancellationRequested)
            {
                pending.TryRemove(new KeyValuePair<string, PendingLoad>(key, selected));
            }

            async Task<object> LoadAsync(PendingLoad owner)
            {
                try
                {
                    if (cache.TryGetValue(key, out T? existing) && existing is not null) return existing;
                    var result = await load(cancellationToken);
                    cache.Set(key, result, expiresAt?.Invoke(result) ?? DateTimeOffset.UtcNow.Add(lifetime));
                    return result;
                }
                finally
                {
                    pending.TryRemove(new KeyValuePair<string, PendingLoad>(key, owner));
                }
            }
        }
    }
}