namespace TWise.Backend.ControlPlane.Domain.DTOs;

/// <summary>Users of a tenant to look up: by id, and every user holding one of the role codes.</summary>
public record ResolveUsersRequest(long TenantId, List<long>? UserIds, List<string>? RoleCodes);

/// <summary>
/// A tenant user as another service needs them now: address, name, whether they may sign in, roles, plants, and the
/// page modules their roles may view in the tenant (the same effective permissions the access token carries).
/// </summary>
public record DirectoryUserDto(
    long UserId, string Email, string? Name, bool IsActive, List<string> RoleCodes, List<int> PlantCodes, List<string> ViewModules);
