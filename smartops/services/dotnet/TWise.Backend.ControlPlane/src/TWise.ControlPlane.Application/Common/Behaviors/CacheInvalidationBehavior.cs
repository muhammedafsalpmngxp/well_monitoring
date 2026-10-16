using MediatR;
using Microsoft.Extensions.Logging;
using TWise.Backend.ControlPlane.Application.Common.Caching;

namespace TWise.Backend.ControlPlane.Application.Common.Behaviors;

/// <summary>
/// MediatR pipeline behavior that evicts cache entries after a command executes.
/// Runs after the handler succeeds — ensures stale data is removed.
/// </summary>
public sealed class CacheInvalidationBehavior<TRequest, TResponse>(
    ICacheService cache,
    ILogger<CacheInvalidationBehavior<TRequest, TResponse>> logger)
    : IPipelineBehavior<TRequest, TResponse>
    where TRequest : IRequest<TResponse>
{
    public async Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken cancellationToken)
    {
        var response = await next();

        if (request is not ICacheInvalidator invalidator)
            return response;

        // Only invalidate on success (supports Result and Result<T>)
        if (response is Result r && !r.IsSuccess)
            return response;
        if (response is not Result && response is not null)
        {
            var t = response.GetType();
            if (t.IsGenericType && t.GetGenericTypeDefinition() == typeof(Result<>))
            {
                var isSuccess = (bool)t.GetProperty("IsSuccess")!.GetValue(response)!;
                if (!isSuccess)
                    return response;
            }
        }

        foreach (var key in invalidator.CacheKeysToInvalidate)
        {
            if (key.EndsWith("*", StringComparison.Ordinal))
            {
                var prefix = key[..^1];
                await cache.RemoveByPrefixAsync(prefix, cancellationToken);
                logger.LogDebug("[Cache] Invalidated prefix: {Prefix}", prefix);
            }
            else
            {
                await cache.RemoveAsync(key, cancellationToken);
                logger.LogDebug("[Cache] Invalidated key: {Key}", key);
            }
        }

        await cache.EvictOutputCacheAsync(cancellationToken);

        return response;
    }
}
