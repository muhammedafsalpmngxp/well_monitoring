namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>
/// Provides the current authenticated user's identity.
/// </summary>
public interface ICurrentUserService
{
    /// <summary>
    /// Gets the current user's ID (from JWT claims or HTTP context).
    /// </summary>
    string? UserId { get; }

    /// <summary>
    /// Gets the current user's role (Admin, Planner, Viewer, etc.).
    /// </summary>
    string? Role { get; }

    /// <summary>
    /// Gets all roles assigned to the current user.
    /// </summary>
    IReadOnlyList<string> Roles { get; }

    /// <summary>
    /// Gets the plant codes (Plant Access) assigned to the current user. Empty if
    /// the user isn't authenticated or has no plant restrictions embedded in the token.
    /// </summary>
    IReadOnlyList<int> PlantCodes { get; }
}
