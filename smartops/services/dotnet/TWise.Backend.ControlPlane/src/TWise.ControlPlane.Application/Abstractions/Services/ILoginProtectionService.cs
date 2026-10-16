namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

/// <summary>
/// Per-account brute-force protection: after a number of failed logins the account is locked for
/// a cooling-off period. Works alongside the per-IP request rate limiter, which cannot see
/// attempts spread across many addresses.
/// </summary>
public interface ILoginProtectionService
{
    /// <summary>Minutes left on a lock for this account, or null when not locked.</summary>
    int? LockedMinutesRemaining(string email);

    /// <summary>Records a failed attempt; returns true when this attempt triggered a lock.</summary>
    bool RecordFailure(string email);

    /// <summary>Clears the failure count after a successful login.</summary>
    void Reset(string email);
}

/// <summary>Thrown by login when the account is temporarily locked.</summary>
public sealed class AccountLockedException(int minutesRemaining)
    : Exception($"Too many failed attempts. Try again in {minutesRemaining} minute{(minutesRemaining == 1 ? "" : "s")}.")
{
    public int MinutesRemaining { get; } = minutesRemaining;
}
