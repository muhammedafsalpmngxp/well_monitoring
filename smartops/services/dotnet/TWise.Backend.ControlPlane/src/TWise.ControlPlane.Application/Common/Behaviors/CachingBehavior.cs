using MediatR;
using Microsoft.Extensions.Logging;
using TWise.Backend.ControlPlane.Application.Common.Caching;

namespace TWise.Backend.ControlPlane.Application.Common.Behaviors;

/// <summary>
/// MediatR pipeline behavior that intercepts cacheable queries.
/// On cache hit → returns immediately without executing the handler.
/// On cache miss → executes handler, stores result, then returns.
/// </summary>
public sealed class CachingBehavior<TRequest, TResponse>(
    ICacheService cache,
    ILogger<CachingBehavior<TRequest, TResponse>> logger)
    : IPipelineBehavior<TRequest, TResponse>
    where TRequest : IRequest<TResponse>
{
    public async Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken cancellationToken)
    {
        if (request is not ICacheableQuery cacheableQuery)
            return await next();

        var cacheKey = cacheableQuery.CacheKey;
        var cached = await cache.GetAsync<TResponse>(cacheKey, cancellationToken);

        if (cached is not null)
        {
            logger.LogDebug("[Cache] HIT: {CacheKey}", cacheKey);
            return cached;
        }

        logger.LogDebug("[Cache] MISS: {CacheKey}", cacheKey);
        var response = await next();

        await cache.SetAsync(
            cacheKey,
            response,
            cacheableQuery.AbsoluteExpiration,
            cacheableQuery.SlidingExpiration,
            cancellationToken);

        return response;
    }
}
