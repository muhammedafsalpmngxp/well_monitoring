using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;

namespace TWise.Backend.ControlPlane.Application.Features.Access;

/// <summary>
/// Looks up users of one tenant for another service (the Tenant API's scheduled deliveries): the named users and every
/// user holding one of the role codes in that tenant. Only users with an active role in the tenant are returned; a user
/// who may not sign in comes back with IsActive false, so the caller can tell a disabled user from a missing one. Only
/// active roles count. viewModulesByRole holds, per role id, the module codes the role may view in the tenant.
/// </summary>
public static class UserDirectory
{
    public const int MaxLookups = 500;

    /// <summary>The role ids that give tenant access (active membership of an active role), whose modules Resolve needs.</summary>
    public static HashSet<int> TenantRoleIds(long tenantId, IEnumerable<UserTenantRole> tenantRoles, IEnumerable<Role> roles)
    {
        var active = roles.Where(r => r.IsActive).Select(r => r.RoleId).ToHashSet();
        return tenantRoles.Where(r => r.TenantId == tenantId && r.IsActive && active.Contains(r.RoleId)).Select(r => r.RoleId).ToHashSet();
    }

    public static List<DirectoryUserDto> Resolve(
        ResolveUsersRequest request, IEnumerable<AppUser> users, IEnumerable<UserTenantRole> tenantRoles,
        IEnumerable<Role> roles, IEnumerable<UserPlantAccess> plants, IReadOnlyDictionary<int, List<string>> viewModulesByRole)
    {
        var roleCodes = roles.Where(r => r.IsActive).ToDictionary(r => r.RoleId, r => r.RoleCode);
        var held = tenantRoles.Where(r => r.TenantId == request.TenantId && r.IsActive && roleCodes.ContainsKey(r.RoleId))
            .GroupBy(r => r.UserId)
            .ToDictionary(g => g.Key, g => g.Select(r => r.RoleId).Distinct().ToList());
        var memberships = held.ToDictionary(p => p.Key, p => p.Value.Select(id => roleCodes[id]).Distinct(StringComparer.OrdinalIgnoreCase).ToList());
        var ids = (request.UserIds ?? []).ToHashSet();
        var codes = (request.RoleCodes ?? []).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var plantCodes = plants.Where(p => p.IsActive).GroupBy(p => p.UserId).ToDictionary(g => g.Key, g => g.Select(p => p.PlantCode).ToList());

        return users
            .Where(u => memberships.TryGetValue(u.UserId, out var codesHeld) && (ids.Contains(u.UserId) || codesHeld.Any(codes.Contains)))
            .OrderBy(u => u.UserId)
            .Select(u => new DirectoryUserDto(u.UserId, u.Email, u.DisplayName, u.IsActive, memberships[u.UserId],
                plantCodes.GetValueOrDefault(u.UserId) ?? [],
                held[u.UserId].SelectMany(id => viewModulesByRole.GetValueOrDefault(id) ?? []).Distinct().ToList()))
            .ToList();
    }
}
