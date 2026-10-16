namespace TWise.Backend.ControlPlane.Application.Common.Caching;

/// <summary>
/// Marker interface for commands that should invalidate cache entries.
/// Implement on any command record to trigger eviction after execution.
/// </summary>
public interface ICacheInvalidator
{
    string[] CacheKeysToInvalidate { get; }
}
