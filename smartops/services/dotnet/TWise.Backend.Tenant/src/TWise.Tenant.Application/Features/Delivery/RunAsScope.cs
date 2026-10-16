using TWise.Tenant.Application.Features.Model.Query;

namespace TWise.Tenant.Application.Features.Delivery;

/// <summary>
/// The user a scheduled run acts as. The worker has no HTTP user, and run now must read data as the schedule's owner
/// rather than as the caller, so CurrentUserService reads this first. It flows with the async calls made inside Begin.
/// </summary>
// ponytail: an ambient AsyncLocal, read only by CurrentUserService; code that reads HttpContext.User directly still sees
// the HTTP caller (or nobody). Pass the user explicitly if a renderer ever reaches such code.
public static class RunAsScope
{
    private static readonly AsyncLocal<DirectoryUser?> Current = new();

    public static DirectoryUser? User => Current.Value;

    /// <summary>Acts as the user until the returned scope is disposed.</summary>
    public static IDisposable Begin(DirectoryUser user)
    {
        var previous = Current.Value;
        Current.Value = user;
        return new Restore(previous);
    }

    /// <summary>The user's role codes, with "admin" added for an admin role code, as the access token carries them.</summary>
    public static IReadOnlyList<string> Roles(DirectoryUser user)
        => user.RoleCodes.Any(RunModelQueryHandler.AdminRoles.Contains)
            ? [.. user.RoleCodes, "admin"]
            : user.RoleCodes;

    private sealed class Restore(DirectoryUser? previous) : IDisposable
    {
        public void Dispose() => Current.Value = previous;
    }
}
