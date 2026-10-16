using Microsoft.Extensions.Caching.Memory;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

/// <summary>
/// In-memory lockout: 5 failures within 15 minutes lock the account for 15 minutes. Memory is
/// enough for a single ControlPlane instance and keeps the hot login path off the database; move
/// the two entries to a distributed cache if the ControlPlane is ever scaled out.
/// </summary>
public sealed class LoginProtectionService(IMemoryCache cache) : ILoginProtectionService
{
    private const int MaxFailures = 5;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan LockDuration = TimeSpan.FromMinutes(15);

    private static string FailKey(string email) => "login:fail:" + email.Trim().ToLowerInvariant();
    private static string LockKey(string email) => "login:lock:" + email.Trim().ToLowerInvariant();

    public int? LockedMinutesRemaining(string email)
    {
        if (!cache.TryGetValue(LockKey(email), out DateTime until)) return null;
        var left = until - DateTime.UtcNow;
        return left <= TimeSpan.Zero ? null : Math.Max(1, (int)Math.Ceiling(left.TotalMinutes));
    }

    public bool RecordFailure(string email)
    {
        var key = FailKey(email);
        var count = cache.TryGetValue(key, out int n) ? n + 1 : 1;
        cache.Set(key, count, Window);
        if (count < MaxFailures) return false;
        cache.Set(LockKey(email), DateTime.UtcNow.Add(LockDuration), LockDuration);
        cache.Remove(key);
        return true;
    }

    public void Reset(string email)
    {
        cache.Remove(FailKey(email));
        cache.Remove(LockKey(email));
    }
}
