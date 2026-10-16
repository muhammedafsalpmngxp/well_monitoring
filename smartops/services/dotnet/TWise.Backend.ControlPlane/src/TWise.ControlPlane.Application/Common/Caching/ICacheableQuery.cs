namespace TWise.Backend.ControlPlane.Application.Common.Caching;

/// <summary>
/// Marker interface for queries whose results should be cached.
/// Implement on any query record to opt into the caching pipeline.
/// </summary>
public interface ICacheableQuery
{
    string CacheKey { get; }
    TimeSpan? AbsoluteExpiration => TimeSpan.FromMinutes(5);
    TimeSpan? SlidingExpiration => null;
}
