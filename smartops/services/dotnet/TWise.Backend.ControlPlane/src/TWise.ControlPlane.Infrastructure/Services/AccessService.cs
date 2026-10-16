using FluentValidation;
using FluentValidation.Results;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using TWise.Backend.ControlPlane.Application.Abstractions;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Features.Access;
using TWise.Backend.ControlPlane.Domain.DTOs;
using TWise.Backend.ControlPlane.Domain.Entities;
using TWise.Backend.ControlPlane.Infrastructure.Persistence;

namespace TWise.Backend.ControlPlane.Infrastructure.Services;

public sealed class AccessService(
    ControlPlaneDbContext db,
    IGenericRepository<AppUser> appUserRepo,
    IGenericRepository<Role> roleRepo,
    IGenericRepository<UserTenantRole> userTenantRoleRepo,
    IGenericRepository<Feature> featureRepo,
    IGenericRepository<TenantFeature> tenantFeatureRepo,
    IGenericRepository<FeatureModule> moduleRepo,
    IGenericRepository<RoleModulePermissions> roleModulePermissionRepo,
    IGenericRepository<UserPlantAccess> userPlantAccessRepo,
    IGenericRepository<AuditEvent> auditEventRepo,
    INotificationService notifications,
    ILogger<AccessService> logger) : IAccessService
{
    // ─── AppUser ─────────────────────────────────────────────────────────────

    public async Task<PagedResult<AppUserDto>> ListUsersAsync(int page, int pageSize, CancellationToken ct)
    {
        var paged = await appUserRepo.GetPagedAsync(page, pageSize, ct);
        return new PagedResult<AppUserDto>(
            paged.Items.Select(e => new AppUserDto(e.UserId, e.Email,e.EmployeeId, e.DisplayName, e.IsSso, e.Status, e.IsActive)).ToList(),
            paged.TotalCount, paged.Page, paged.PageSize);
    }

    public async Task<AppUserDto?> GetUserAsync(long id, CancellationToken ct)
    {
        var e = await appUserRepo.GetAsync(id, ct);
        return e is null ? null : new AppUserDto(e.UserId, e.Email, e.EmployeeId, e.DisplayName, e.IsSso, e.Status, e.IsActive);
    }

    public async Task<AppUserDto> CreateUserAsync(AppUserCreateRequest request, CancellationToken ct)
    {
        var entity = new AppUser
        {
            Email = request.Email,
            DisplayName = request.DisplayName,
            IsSso = request.IsSso,
            Status = request.Status,
            IsActive = request.IsActive,
            PasswordHash = string.IsNullOrWhiteSpace(request.Password)
                ? null
                : PasswordHelper.Hash(request.Password)
        };
        var e = await appUserRepo.AddAsync(entity, ct);
        return new AppUserDto(e.UserId, e.Email,e.EmployeeId, e.DisplayName, e.IsSso, e.Status, e.IsActive);
    }

    public async Task<bool> UpdateUserAsync(long id, AppUserUpdateRequest request, CancellationToken ct)
    {
        var e = await appUserRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.Email = request.Email;
        e.DisplayName = request.DisplayName;
        e.Status = request.Status;
        e.IsActive = request.IsActive;

        return await appUserRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteUserAsync(long id, CancellationToken ct)
    {
        var user = await appUserRepo.GetAsync(id, ct);
        if (user is null) return false;

        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            try
            {
                var assignments = (await userTenantRoleRepo.GetAllAsync(ct))
                    .Where(assignment => assignment.UserId == id).ToList();
                var deletedAt = DateTime.UtcNow;
                foreach (var assignment in assignments)
                {
                    assignment.IsActive = false;
                    assignment.IsDeleted = true;
                    assignment.DeletedAt = deletedAt;
                }

                var updates = assignments.ToDictionary(assignment => (object)assignment.UserTenantRoleId);
                if (!await userTenantRoleRepo.UpdateRangeAsync(updates, ct))
                {
                    await tx.RollbackAsync(ct);
                    return false;
                }

                user.IsActive = false;
                user.IsDeleted = true;
                user.DeletedAt = deletedAt;
                if (!await appUserRepo.UpdateAsync(id, user, ct))
                {
                    await tx.RollbackAsync(ct);
                    return false;
                }

                await tx.CommitAsync(ct);
                return true;
            }
            catch
            {
                await tx.RollbackAsync(ct);
                throw;
            }
        });
    }

    private async Task<bool> UserBelongsToTenantAsync(long userId, long tenantId, CancellationToken ct)
    {
        var roles = await userTenantRoleRepo.GetAllAsync(ct);
        return roles.Any(r => r.UserId == userId && r.TenantId == tenantId && r.IsActive);
    }

    public async Task<List<int>?> GetUserPlantAccessAsync(long userId, long callerTenantId, CancellationToken ct)
    {
        if (!await UserBelongsToTenantAsync(userId, callerTenantId, ct)) return null;
        var all = await userPlantAccessRepo.GetAllAsync(ct);
        return all.Where(p => p.UserId == userId && p.IsActive && !p.IsDeleted)
                  .Select(p => p.PlantCode).ToList();
    }

    public async Task<bool> UpdateUserPlantAccessAsync(long userId, List<int> plantCodes, long callerTenantId, CancellationToken ct)
    {
        if (!await UserBelongsToTenantAsync(userId, callerTenantId, ct)) return false;
        var user = await appUserRepo.GetAsync(userId, ct);
        if (user is null) return false;

        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            try
            {
                var existing = (await userPlantAccessRepo.GetAllUnfilteredAsync(ct))
                    .Where(p => p.UserId == userId).ToList();

                foreach (var e in existing.Where(e => e.IsActive && !plantCodes.Contains(e.PlantCode)))
                {
                    e.IsActive = false;
                    e.IsDeleted = true;
                    e.DeletedAt = DateTime.UtcNow;
                    await userPlantAccessRepo.UpdateAsync(e.UserPlantAccessId, e, ct);
                }

                foreach (var code in plantCodes)
                {
                    var match = existing.FirstOrDefault(e => e.PlantCode == code);
                    if (match is not null)
                    {
                        if (!match.IsActive) await ReactivatePlantAccessAsync(match.UserPlantAccessId, ct);
                    }
                    else
                    {
                        await userPlantAccessRepo.AddAsync(new UserPlantAccess { UserId = userId, PlantCode = code, IsActive = true }, ct);
                    }
                }

                await tx.CommitAsync(ct);
                return true;
            }
            catch
            {
                await tx.RollbackAsync(ct);
                throw;
            }
        });
    }

    // GenericRepository.UpdateAsync locates the row via Set.FindAsync, which is excluded by the
    // global "!IsDeleted" query filter — so it silently fails to find (and thus never reactivates)
    // a previously soft-deleted UserPlantAccess row. Bypass the filter directly here instead.
    private async Task ReactivatePlantAccessAsync(long userPlantAccessId, CancellationToken ct)
    {
        var tracked = await db.UserPlantAccesses.IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.UserPlantAccessId == userPlantAccessId, ct);
        if (tracked is null) return;
        tracked.IsActive = true;
        tracked.IsDeleted = false;
        tracked.DeletedAt = null;
        tracked.ModifiedAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
    }

    public async Task<bool> UpdateUserWithAccessAsync(long id, UpdateUserWithAccessRequest request, long callerTenantId, CancellationToken ct)
    {
        if (!await UserBelongsToTenantAsync(id, callerTenantId, ct)) return false;
        var user = await appUserRepo.GetAsync(id, ct);
        if (user is null) return false;
        var selectedRoles = request.RoleIds is null ? null
            : await ValidateSelectedRolesAsync(request.RoleIds, callerTenantId, callerTenantId, ct);

        var strategy = db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            try
            {
                user.Email = request.Email;
                user.DisplayName = request.DisplayName;
                user.EmployeeId = request.EmployeeId;
                user.Status = request.Status;
                user.IsActive = request.IsActive;
                await appUserRepo.UpdateAsync(id, user, ct);

                if (selectedRoles is not null)
                {
                    var selectedIds = selectedRoles.Select(role => role.RoleId).ToHashSet();
                    var assignments = await db.UserTenantRoles.IgnoreQueryFilters()
                        .Where(assignment => assignment.UserId == id && assignment.TenantId == callerTenantId)
                        .ToListAsync(ct);
                    foreach (var assignment in assignments)
                    {
                        assignment.IsActive = selectedIds.Contains(assignment.RoleId);
                        assignment.IsDeleted = !assignment.IsActive;
                        assignment.DeletedAt = assignment.IsDeleted ? DateTime.UtcNow : null;
                        assignment.ModifiedAt = DateTime.UtcNow;
                    }
                    await db.SaveChangesAsync(ct);
                    foreach (var roleId in selectedIds.Except(assignments.Select(assignment => assignment.RoleId)))
                    {
                        await userTenantRoleRepo.AddAsync(new UserTenantRole
                        {
                            UserId = id, TenantId = callerTenantId, RoleId = roleId, IsActive = true
                        }, ct);
                    }
                }

                var existing = (await userPlantAccessRepo.GetAllUnfilteredAsync(ct))
                    .Where(p => p.UserId == id).ToList();

                foreach (var e in existing.Where(e => e.IsActive && !request.PlantCodes.Contains(e.PlantCode)))
                {
                    e.IsActive = false; e.IsDeleted = true; e.DeletedAt = DateTime.UtcNow;
                    await userPlantAccessRepo.UpdateAsync(e.UserPlantAccessId, e, ct);
                }

                foreach (var code in request.PlantCodes)
                {
                    var match = existing.FirstOrDefault(e => e.PlantCode == code);
                    if (match is not null)
                    {
                        if (!match.IsActive) await ReactivatePlantAccessAsync(match.UserPlantAccessId, ct);
                    }
                    else
                    {
                        await userPlantAccessRepo.AddAsync(new UserPlantAccess { UserId = id, PlantCode = code, IsActive = true }, ct);
                    }
                }

                await tx.CommitAsync(ct);
                return true;
            }
            catch
            {
                await tx.RollbackAsync(ct);
                throw;
            }
        });
    }

    public async Task<UserExistsResponse> CheckUserExistsByIdAsync(long userId, long tenantId, CancellationToken ct)
    {
        // getting user with userId
        var user = await appUserRepo.GetAsync(userId, ct);
        if (user is null)
            return new UserExistsResponse(false, null, null, null);

        // checking the user have an appropriate role for the tenantId
        var roles = await userTenantRoleRepo.GetAllAsync(ct);
        var hasTenantAccess = roles.Any(r => r.UserId == userId && r.TenantId == tenantId && r.IsActive);

        return hasTenantAccess
            ? new UserExistsResponse(true, user.UserId, tenantId, user.Email)
            : new UserExistsResponse(false, user.UserId, null, null);
    }

    // ponytail: reads the tables whole, as ListUsersByTenantAsync does, and each tenant role's permissions once per call;
    // filter in SQL when they grow large.
    public async Task<List<DirectoryUserDto>> ResolveUsersAsync(ResolveUsersRequest request, CancellationToken ct)
    {
        var tenantRoles = await userTenantRoleRepo.GetAllAsync(ct);
        var roles = await roleRepo.GetAllAsync(ct);
        // The view modules of each role, from the same effective permissions the access token is built from.
        var viewModules = new Dictionary<int, List<string>>();
        foreach (var roleId in UserDirectory.TenantRoleIds(request.TenantId, tenantRoles, roles))
            viewModules[roleId] = (await GetEffectivePermissionsAsync(roleId, request.TenantId, ct))
                .Where(p => p.CanView).Select(p => p.ModuleCode).ToList();
        return UserDirectory.Resolve(request, await appUserRepo.GetAllAsync(ct), tenantRoles, roles,
            await userPlantAccessRepo.GetAllAsync(ct), viewModules);
    }

    public async Task<PagedResult<TenantUserDto>> ListUsersByTenantAsync(long tenantId, int page, int pageSize, CancellationToken ct)
    {
        var utrs = (await userTenantRoleRepo.GetAllAsync(ct))
            .Where(r => r.TenantId == tenantId && r.IsActive)
            .ToList();

        if (utrs.Count == 0) return new PagedResult<TenantUserDto>([], 0, page, pageSize);

        var allUsers = await appUserRepo.GetAllAsync(ct);
        var allRoles = await roleRepo.GetAllAsync(ct);
        var allPlantAccess = await userPlantAccessRepo.GetAllAsync(ct);
        var userLookup = allUsers.ToDictionary(u => u.UserId);
        var roleLookup = allRoles.ToDictionary(r => r.RoleId);
        var plantLookup = allPlantAccess
            .Where(p => p.IsActive && !p.IsDeleted)
            .GroupBy(p => p.UserId)
            .ToDictionary(g => g.Key, g => g.Select(p => p.PlantCode).ToList());

        var items = utrs
            .Where(utr => userLookup.ContainsKey(utr.UserId))
            .GroupBy(utr => utr.UserId)
            .Select(assignments =>
            {
                var user = userLookup[assignments.Key];
                var assignedRoles = assignments.Select(assignment => roleLookup.GetValueOrDefault(assignment.RoleId))
                    .OfType<Role>().Where(role => role.IsActive && !role.IsDeleted
                        && (role.TenantId is null || role.TenantId == tenantId))
                    .DistinctBy(role => role.RoleId).OrderBy(role => role.RoleId).ToList();
                var role = assignedRoles.FirstOrDefault();
                var plants = plantLookup.GetValueOrDefault(user.UserId) ?? [];
                return new TenantUserDto(
                    user.UserId, user.Email, user.DisplayName, user.EmployeeId,
                    user.Status, user.IsActive,
                    role?.RoleCode ?? "unknown", role?.RoleName, plants, user.LastLoginAt,
                    assignedRoles.Select(assignedRole => assignedRole.RoleId).ToList(),
                    assignedRoles.Select(assignedRole => new UserRoleDto(assignedRole.RoleId, assignedRole.RoleCode, assignedRole.RoleName)).ToList());
            })
                    .OrderBy(user => user.UserId)
            .ToList();

        var totalCount = items.Count;
        var paged = items.Skip((page - 1) * pageSize).Take(pageSize).ToList();
        return new PagedResult<TenantUserDto>(paged, totalCount, page, pageSize);
    }

    // ─── Role ────────────────────────────────────────────────────────────────

    private async Task AuditRoleAsync(string action, Role role, long callerTenantId, CancellationToken ct) =>
        await auditEventRepo.AddAsync(new AuditEvent
        {
            TenantId = role.TenantId ?? (callerTenantId > 0 ? callerTenantId : null),
            Action = action,
            Entity = "Role",
            Detail = $"{role.RoleCode} (id={role.RoleId})",
            OccurredAt = DateTime.UtcNow,
        }, ct);

    private static RoleDto ToRoleDto(Role e) =>
        new(e.RoleId, e.RoleCode, e.RoleName, e.Description, e.Scope, e.TenantId, e.IsSystemRole, e.IsActive);

    private static bool CanAccessRole(Role role, long callerTenantId) =>
        callerTenantId >= 0
        && (callerTenantId == 0 || role.TenantId is null || role.TenantId == callerTenantId);

    private static bool CanMutateRole(Role role, long callerTenantId) =>
        callerTenantId >= 0
        && (callerTenantId == 0 || (role.TenantId is not null && role.TenantId == callerTenantId));

    public async Task<PagedResult<RoleDto>> ListRolesAsync(long callerTenantId, int page, int pageSize, CancellationToken ct)
    {
        var all = await roleRepo.GetAllAsync(ct);
        var filtered = all.Where(r => CanAccessRole(r, callerTenantId)).ToList();
        var paged = filtered.Skip((page - 1) * pageSize).Take(pageSize).Select(ToRoleDto).ToList();
        return new PagedResult<RoleDto>(paged, filtered.Count, page, pageSize);
    }

    public async Task<RoleDto?> GetRoleAsync(int id, long callerTenantId, CancellationToken ct)
    {
        var e = await roleRepo.GetAsync(id, ct);
        if (e is null || !CanAccessRole(e, callerTenantId)) return null;
        return ToRoleDto(e);
    }

    public async Task<RoleDto> CreateRoleAsync(RoleCreateRequest request, long callerTenantId, CancellationToken ct)
    {
        var entity = new Role
        {
            RoleCode = request.RoleCode,
            RoleName = request.RoleName,
            Description = request.Description,
            Scope = callerTenantId > 0 ? "tenant" : request.Scope,
            TenantId = callerTenantId > 0 ? callerTenantId : null,
            IsActive = request.IsActive
        };
        var e = await roleRepo.AddAsync(entity, ct);
        await AuditRoleAsync("CreateRole", e, callerTenantId, ct);
        return ToRoleDto(e);
    }

    public async Task<bool> UpdateRoleAsync(int id, RoleUpdateRequest request, long callerTenantId, CancellationToken ct)
    {
        var e = await roleRepo.GetAsync(id, ct);
        if (e is null || !CanMutateRole(e, callerTenantId)) return false;

        e.RoleCode = request.RoleCode;
        e.RoleName = request.RoleName;
        e.Description = request.Description;
        e.Scope = e.TenantId is not null ? "tenant" : request.Scope;
        e.IsActive = request.IsActive;

        var result = await roleRepo.UpdateAsync(id, e, ct);
        if (result) await AuditRoleAsync("UpdateRole", e, callerTenantId, ct);
        return result;
    }

    public async Task<bool> DeleteRoleAsync(int id, long callerTenantId, CancellationToken ct)
    {
        var e = await roleRepo.GetAsync(id, ct);
        if (e is null || !CanMutateRole(e, callerTenantId)) return false;

        var assignments = await userTenantRoleRepo.GetAllAsync(ct);
        var users = await appUserRepo.GetAllAsync(ct);
        var userIds = users.Select(user => user.UserId).ToHashSet();
        if (assignments.Any(utr => utr.RoleId == id && utr.IsActive && userIds.Contains(utr.UserId)))
            return false;

        var result = await roleRepo.DeleteAsync(id, ct);
        if (result) await AuditRoleAsync("DeleteRole", e, callerTenantId, ct);
        return result;
    }

    // ─── UserTenantRole ──────────────────────────────────────────────────────

    public async Task<PagedResult<UserTenantRoleDto>> ListUserTenantRolesAsync(long callerTenantId, int page, int pageSize, CancellationToken ct)
    {
        var all = await userTenantRoleRepo.GetAllAsync(ct);
        var filtered = callerTenantId == 0
            ? all.ToList()
            : all.Where(e => e.TenantId == callerTenantId).ToList();
        var paged = filtered
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(e => new UserTenantRoleDto(e.UserTenantRoleId, e.UserId, e.TenantId, e.RoleId, e.IsActive))
            .ToList();
        return new PagedResult<UserTenantRoleDto>(paged, filtered.Count, page, pageSize);
    }

    public async Task<UserTenantRoleDto?> GetUserTenantRoleAsync(long id, long callerTenantId, CancellationToken ct)
    {
        var e = await userTenantRoleRepo.GetAsync(id, ct);
        if (e is null) return null;
        if (callerTenantId < 0 || (callerTenantId > 0 && e.TenantId != callerTenantId)) return null;
        return new UserTenantRoleDto(e.UserTenantRoleId, e.UserId, e.TenantId, e.RoleId, e.IsActive);
    }

    public async Task<UserTenantRoleDto> CreateUserTenantRoleAsync(UserTenantRoleCreateRequest request, long callerTenantId, CancellationToken ct)
    {
        ValidateRoleTenantAssignment(
            await roleRepo.GetAsync(request.RoleId, ct),
            request.TenantId, request.RoleId, callerTenantId);

        var entity = new UserTenantRole
        {
            UserId = request.UserId,
            TenantId = request.TenantId,
            RoleId = request.RoleId,
            IsActive = request.IsActive
        };
        var e = await userTenantRoleRepo.AddAsync(entity, ct);
        return new UserTenantRoleDto(e.UserTenantRoleId, e.UserId, e.TenantId, e.RoleId, e.IsActive);
    }

    public async Task<bool> UpdateUserTenantRoleAsync(long id, UserTenantRoleUpdateRequest request, long callerTenantId, CancellationToken ct)
    {
        var e = await userTenantRoleRepo.GetAsync(id, ct);
        if (e is null) return false;

        var newRole = await roleRepo.GetAsync(request.RoleId, ct);
        ValidateRoleTenantAssignment(newRole, request.TenantId, request.RoleId, callerTenantId);

        // Tenant admins can only manage assignments within their own tenant
        if (callerTenantId > 0 && e.TenantId != callerTenantId) return false;

        var roleChanged = e.RoleId != request.RoleId;

        e.UserId = request.UserId;
        e.TenantId = request.TenantId;
        e.RoleId = request.RoleId;
        e.IsActive = request.IsActive;

        var updated = await userTenantRoleRepo.UpdateAsync(id, e, ct);
        if (updated && roleChanged)
        {
            // The role change above is already committed — a notification failure (e.g. transient
            // DB hiccup) must never turn a successful update into an error response to the caller.
            try
            {
                await notifications.CreateAsync(request.TenantId, "RbacRoleChange", "Your role was updated",
                    $"Your role was changed to '{newRole?.RoleName ?? newRole?.RoleCode ?? "unknown"}'",
                    "/user-role-management/roles-permissions", [request.UserId], null, ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to publish RbacRoleChange notification for user {UserId}", request.UserId);
            }
        }
        return updated;
    }

    private static void ValidateRoleTenantAssignment(Role? role, long assignmentTenantId, int roleId, long callerTenantId)
    {
        if (role is null)
            throw new InvalidOperationException($"Role {roleId} not found.");
        if (role.TenantId is not null && role.TenantId != assignmentTenantId)
            throw new InvalidOperationException("Cannot assign a tenant-scoped role to a different tenant.");
        if (callerTenantId < 0 || (callerTenantId > 0 && assignmentTenantId != callerTenantId))
            throw new InvalidOperationException("Cannot manage assignments for another tenant.");
    }

    public async Task<bool> DeleteUserTenantRoleAsync(long id, long callerTenantId, CancellationToken ct)
    {
        var e = await userTenantRoleRepo.GetAsync(id, ct);
        if (e is null) return false;
        if (callerTenantId < 0 || (callerTenantId > 0 && e.TenantId != callerTenantId)) return false;
        return await userTenantRoleRepo.DeleteAsync(id, ct);
    }

    // ─── Feature ─────────────────────────────────────────────────────────────

    public async Task<PagedResult<FeatureDto>> ListFeaturesAsync(int page, int pageSize, CancellationToken ct)
    {
        var paged = await featureRepo.GetPagedAsync(page, pageSize, ct);
        return new PagedResult<FeatureDto>(
            paged.Items.Select(e => new FeatureDto(e.FeatureId, e.FeatureCode, e.FeatureName, e.IsActive)).ToList(),
            paged.TotalCount, paged.Page, paged.PageSize);
    }

    public async Task<FeatureDto?> GetFeatureAsync(int id, CancellationToken ct)
    {
        var e = await featureRepo.GetAsync(id, ct);
        return e is null ? null : new FeatureDto(e.FeatureId, e.FeatureCode, e.FeatureName, e.IsActive);
    }

    public async Task<FeatureDto> CreateFeatureAsync(FeatureCreateRequest request, CancellationToken ct)
    {
        var entity = new Feature
        {
            FeatureCode = request.FeatureCode,
            FeatureName = request.FeatureName,
            IsActive = request.IsActive
        };
        var e = await featureRepo.AddAsync(entity, ct);
        return new FeatureDto(e.FeatureId, e.FeatureCode, e.FeatureName, e.IsActive);
    }

    public async Task<bool> UpdateFeatureAsync(int id, FeatureUpdateRequest request, CancellationToken ct)
    {
        var e = await featureRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.FeatureCode = request.FeatureCode;
        e.FeatureName = request.FeatureName;
        e.IsActive = request.IsActive;

        return await featureRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteFeatureAsync(int id, CancellationToken ct)
    {
        return await featureRepo.DeleteAsync(id, ct);
    }

    // ─── TenantFeature ───────────────────────────────────────────────────────

    public async Task<PagedResult<TenantFeatureDto>> ListTenantFeaturesAsync(int page, int pageSize, CancellationToken ct)
    {
        var paged = await tenantFeatureRepo.GetPagedAsync(page, pageSize, ct);
        return new PagedResult<TenantFeatureDto>(
            paged.Items.Select(e => new TenantFeatureDto(e.TenantFeatureId, e.TenantId, e.FeatureId, e.IsEnabled, e.ValidFrom, e.ValidTo, e.IsActive)).ToList(),
            paged.TotalCount, paged.Page, paged.PageSize);
    }

    public async Task<TenantFeatureDto?> GetTenantFeatureAsync(long id, CancellationToken ct)
    {
        var e = await tenantFeatureRepo.GetAsync(id, ct);
        return e is null ? null : new TenantFeatureDto(e.TenantFeatureId, e.TenantId, e.FeatureId, e.IsEnabled, e.ValidFrom, e.ValidTo, e.IsActive);
    }

    public async Task<TenantFeatureDto> CreateTenantFeatureAsync(TenantFeatureCreateRequest request, CancellationToken ct)
    {
        var entity = new TenantFeature
        {
            TenantId = request.TenantId,
            FeatureId = request.FeatureId,
            IsEnabled = request.IsEnabled,
            ValidFrom = request.ValidFrom,
            ValidTo = request.ValidTo,
            IsActive = request.IsActive
        };
        var e = await tenantFeatureRepo.AddAsync(entity, ct);
        return new TenantFeatureDto(e.TenantFeatureId, e.TenantId, e.FeatureId, e.IsEnabled, e.ValidFrom, e.ValidTo, e.IsActive);
    }

    public async Task<bool> UpdateTenantFeatureAsync(long id, TenantFeatureUpdateRequest request, CancellationToken ct)
    {
        var e = await tenantFeatureRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.TenantId = request.TenantId;
        e.FeatureId = request.FeatureId;
        e.IsEnabled = request.IsEnabled;
        e.ValidFrom = request.ValidFrom;
        e.ValidTo = request.ValidTo;
        e.IsActive = request.IsActive;

        return await tenantFeatureRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteTenantFeatureAsync(long id, CancellationToken ct)
    {
        return await tenantFeatureRepo.DeleteAsync(id, ct);
    }

    // ─── Module ───────────────────────────────────────────────────────────────

    public async Task<List<ModuleTreeNode>> ListModuleTreeAsync(CancellationToken ct)
    {
        var all = (await moduleRepo.GetAllAsync(ct))
            .Where(p => p.IsActive)
            .OrderBy(p => p.SortOrder)
            .ToList();

        var lookup = all.ToLookup(p => p.ParentCode ?? "");

        List<ModuleTreeNode> BuildChildren(string parentCode)
            => lookup[parentCode]
                .Select(p => new ModuleTreeNode(
                    p.ModuleCode, p.ParentCode, p.DisplayName,
                    p.FeatureCode, p.SortOrder, BuildChildren(p.ModuleCode)))
                .ToList();

        return BuildChildren("");
    }

    public async Task<ModuleDto?> GetModuleAsync(int id, CancellationToken ct)
    {
        var e = await moduleRepo.GetAsync(id, ct);
        return e is null ? null : new ModuleDto(e.ModuleId, e.ModuleCode, e.ParentCode, e.DisplayName, e.FeatureCode, e.SortOrder, e.IsActive);
    }

    public async Task<ModuleDto> CreateModuleAsync(ModuleCreateRequest request, CancellationToken ct)
    {
        var entity = new FeatureModule
        {
            ModuleCode = request.ModuleCode,
            ParentCode = request.ParentCode,
            DisplayName = request.DisplayName,
            FeatureCode = request.FeatureCode,
            SortOrder = request.SortOrder,
            IsActive = request.IsActive
        };
        var e = await moduleRepo.AddAsync(entity, ct);
        return new ModuleDto(e.ModuleId, e.ModuleCode, e.ParentCode, e.DisplayName, e.FeatureCode, e.SortOrder, e.IsActive);
    }

    public async Task<bool> UpdateModuleAsync(int id, ModuleUpdateRequest request, CancellationToken ct)
    {
        var e = await moduleRepo.GetAsync(id, ct);
        if (e is null) return false;

        e.ModuleCode = request.ModuleCode;
        e.ParentCode = request.ParentCode;
        e.DisplayName = request.DisplayName;
        e.FeatureCode = request.FeatureCode;
        e.SortOrder = request.SortOrder;
        e.IsActive = request.IsActive;

        return await moduleRepo.UpdateAsync(id, e, ct);
    }

    public async Task<bool> DeleteModuleAsync(int id, CancellationToken ct)
    {
        return await moduleRepo.DeleteAsync(id, ct);
    }

    // ─── RoleModulePermission ────────────────────────────────────────────────

    public async Task<List<RoleModulePermissionDto>> GetRolePermissionsAsync(int roleId, long callerTenantId, CancellationToken ct)
    {
        var role = await roleRepo.GetAsync(roleId, ct);
        if (role is null || !CanAccessRole(role, callerTenantId)) return [];

        var all = await roleModulePermissionRepo.GetAllAsync(ct);
        var modules = await moduleRepo.GetAllAsync(ct);
        var moduleLookup = modules.ToDictionary(m => m.ModuleId, m => m.ModuleCode);

        return all
            .Where(rp => rp.RoleId == roleId && rp.IsActive)
            .Where(rp => moduleLookup.ContainsKey(rp.ModuleId))
            .Select(rp => new RoleModulePermissionDto(
                moduleLookup[rp.ModuleId], rp.CanView, rp.CanCreate, rp.CanModify, rp.CanAdmin))
            .ToList();
    }

    public async Task<bool> BulkUpsertRolePermissionsAsync(int roleId, RoleModulePermissionBulkRequest request, long callerTenantId, CancellationToken ct)
    {
        var role = await roleRepo.GetAsync(roleId, ct);
        if (role is null || !CanMutateRole(role, callerTenantId)) return false;

        var modules = await moduleRepo.GetAllAsync(ct);
        var moduleLookup = modules.ToDictionary(m => m.ModuleCode, m => m.ModuleId);
        var moduleNameLookup = modules.ToDictionary(m => m.ModuleId, m => m.DisplayName ?? m.ModuleCode);

        var existing = (await roleModulePermissionRepo.GetAllAsync(ct))
            .Where(rp => rp.RoleId == roleId)
            .ToDictionary(rp => rp.ModuleId);

        var changedModuleNames = new List<string>();

        foreach (var item in request.Permissions)
        {
            if (!moduleLookup.TryGetValue(item.ModuleCode, out var moduleId)) continue;

            if (existing.TryGetValue(moduleId, out var rp))
            {
                // Only stamp/update rows whose flags actually changed — the Save button resubmits
                // every module in the matrix, not just the edited one, so touching ModifiedAt
                // unconditionally would refresh every row's timestamp on every save and flood the
                // navbar-bell with one spurious "changed" notification per untouched module.
                var changed = rp.CanView != item.CanView || rp.CanCreate != item.CanCreate
                    || rp.CanModify != item.CanModify || rp.CanAdmin != item.CanAdmin || !rp.IsActive;
                if (changed)
                {
                    rp.CanView = item.CanView;
                    rp.CanCreate = item.CanCreate;
                    rp.CanModify = item.CanModify;
                    rp.CanAdmin = item.CanAdmin;
                    rp.IsActive = true;
                    await roleModulePermissionRepo.UpdateAsync(rp.RoleModulePermissionId, rp, ct);
                    changedModuleNames.Add(moduleNameLookup.GetValueOrDefault(moduleId, item.ModuleCode));
                }
                existing.Remove(moduleId);
            }
            else if (item.CanView || item.CanCreate || item.CanModify || item.CanAdmin)
            {
                await roleModulePermissionRepo.AddAsync(new RoleModulePermissions
                {
                    RoleId = roleId,
                    ModuleId = moduleId,
                    CanView = item.CanView,
                    CanCreate = item.CanCreate,
                    CanModify = item.CanModify,
                    CanAdmin = item.CanAdmin,
                    IsActive = true,
                }, ct);
                changedModuleNames.Add(moduleNameLookup.GetValueOrDefault(moduleId, item.ModuleCode));
            }
        }

        // Zero out permissions no longer in the request (keep row to avoid unique index conflicts) —
        // skip rows already zeroed/inactive so re-saving doesn't keep refreshing their ModifiedAt.
        foreach (var leftover in existing.Values)
        {
            if (!leftover.CanView && !leftover.CanCreate && !leftover.CanModify && !leftover.CanAdmin && !leftover.IsActive)
                continue;

            leftover.CanView = false;
            leftover.CanCreate = false;
            leftover.CanModify = false;
            leftover.CanAdmin = false;
            leftover.IsActive = false;
            await roleModulePermissionRepo.UpdateAsync(leftover.RoleModulePermissionId, leftover, ct);
            changedModuleNames.Add(moduleNameLookup.GetValueOrDefault(leftover.ModuleId, "a module"));
        }

        if (changedModuleNames.Count > 0)
        {
            var notifyTenantId = role.TenantId ?? callerTenantId;
            var recipientUserIds = (await userTenantRoleRepo.GetAllAsync(ct))
                .Where(utr => utr.RoleId == roleId && utr.IsActive)
                .Select(utr => utr.UserId)
                .Distinct()
                .ToList();

            // Permissions above are already committed — don't fail the save because notifying failed.
            try
            {
                await notifications.CreateAsync(notifyTenantId, "RbacPermissionChange", "Your permissions were updated",
                    $"Your '{role.RoleName ?? role.RoleCode}' role's access changed for: {string.Join(", ", changedModuleNames)}",
                    "/user-role-management/roles-permissions", recipientUserIds, null, ct);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to publish RbacPermissionChange notification for role {RoleId}", roleId);
            }
        }

        return true;
    }

    public async Task<List<EffectivePermission>> GetEffectivePermissionsAsync(int roleId, long tenantId, CancellationToken ct)
    {
        // One query instead of loading four tables: role permissions on active modules whose
        // feature is enabled for the tenant. This runs on every login.
        var rows = await (
            from rp in db.RoleModulePermissions.AsNoTracking()
            join m in db.Modules on rp.ModuleId equals m.ModuleId
            where rp.RoleId == roleId && rp.IsActive && m.IsActive
               && db.TenantFeatures.Any(tf => tf.TenantId == tenantId && tf.IsEnabled && tf.IsActive
                    && db.Features.Any(f => f.FeatureId == tf.FeatureId && f.IsActive && f.FeatureCode == m.FeatureCode))
            select new { m.ModuleCode, rp.CanView, rp.CanCreate, rp.CanModify, rp.CanAdmin })
            .ToListAsync(ct);

        return rows.Select(r => new EffectivePermission(r.ModuleCode, r.CanView, r.CanCreate, r.CanModify, r.CanAdmin)).ToList();
    }

    public async Task<UserDuplicateCheckResponse> CheckUserDuplicatesAsync(string? email, string? employeeId, CancellationToken ct)
    {
        var normalizedEmail = email?.Trim().ToUpperInvariant();
        var normalizedEmployeeId = employeeId?.Trim().ToUpperInvariant();
        var emailExists = !string.IsNullOrEmpty(normalizedEmail)
            && await db.Users.AnyAsync(existing => !existing.IsDeleted
                && existing.Email.Trim().ToUpper() == normalizedEmail, ct);
        var employeeIdExists = !string.IsNullOrEmpty(normalizedEmployeeId)
            && await db.Users.AnyAsync(existing => !existing.IsDeleted && existing.EmployeeId != null
                && existing.EmployeeId.Trim().ToUpper() == normalizedEmployeeId, ct);
        return new UserDuplicateCheckResponse(emailExists, employeeIdExists);
    }

    private async Task<List<Role>> ValidateSelectedRolesAsync(List<int> roleIds, long tenantId, long callerTenantId, CancellationToken ct)
    {
        if (roleIds.Count == 0)
            throw new ValidationException([new ValidationFailure("Roles", "Select at least one role.")]);
        var roles = new List<Role>();
        foreach (var roleId in roleIds.Distinct())
        {
            var role = await roleRepo.GetAsync(roleId, ct);
            if (role is null || !role.IsActive || role.IsDeleted)
                throw new ValidationException([new ValidationFailure("Roles", "Select valid active roles.")]);
            ValidateRoleTenantAssignment(role, tenantId, roleId, callerTenantId);
            roles.Add(role);
        }
        return roles;
    }

    public async Task<CreateUserWithAccessResponse> CreateUserWithAccessAsync(CreateUserWithAccessRequest request, long callerTenantId, CancellationToken ct)
    {
        // Reject cross-tenant creation and role/tenant mismatches before writing any rows.
        var roles = await ValidateSelectedRolesAsync(request.RoleIds ?? [request.RoleId], request.TenantId, callerTenantId, ct);
        var role = roles.FirstOrDefault();

        var email = request.Email.Trim();
        var employeeId = string.IsNullOrWhiteSpace(request.EmployeeId) ? null : request.EmployeeId.Trim();
        var duplicates = await CheckUserDuplicatesAsync(email, employeeId, ct);
        var validationErrors = new List<ValidationFailure>();
        if (duplicates.EmailExists)
        {
            validationErrors.Add(new ValidationFailure(nameof(request.Email), "A user with this email already exists."));
        }

        if (duplicates.EmployeeIdExists)
        {
            validationErrors.Add(new ValidationFailure(nameof(request.EmployeeId), "A user with this employee ID already exists."));
        }

        if (validationErrors.Count > 0)
        {
            throw new ValidationException(validationErrors);
        }

        var user = new AppUser
        {
            Email = email,
            DisplayName = request.DisplayName,
            EmployeeId = employeeId,
            IsSso = false,
            Status = request.Status,
            IsActive = request.IsActive,
            PasswordHash = string.IsNullOrWhiteSpace(request.Password) ? null : PasswordHelper.Hash(request.Password),
        };
        var created = await appUserRepo.AddAsync(user, ct);

        foreach (var selectedRole in roles)
        {
            await userTenantRoleRepo.AddAsync(new UserTenantRole
            {
                UserId = created.UserId,
                TenantId = request.TenantId,
                RoleId = selectedRole.RoleId,
                IsActive = true,
            }, ct);
        }

        foreach (var plantCode in request.PlantCodes)
        {
            await userPlantAccessRepo.AddAsync(new UserPlantAccess
            {
                UserId = created.UserId,
                PlantCode = plantCode,
                IsActive = true,
            }, ct);
        }

        return new CreateUserWithAccessResponse(
            created.UserId, created.Email, created.DisplayName, created.EmployeeId,
            role?.RoleName ?? role?.RoleCode ?? "unknown",
            request.PlantCodes);
    }

    public async Task<ResetPasswordResponse?> ResetUserPasswordAsync(long userId, long callerTenantId, long? actingUserId, CancellationToken ct)
    {
        var user = await appUserRepo.GetAsync(userId, ct);
        if (user is null) return null;

        var newPassword = PasswordHelper.Generate();
        user.PasswordHash = PasswordHelper.Hash(newPassword);
        await appUserRepo.UpdateAsync(userId, user, ct);

        await auditEventRepo.AddAsync(new AuditEvent
        {
            TenantId = callerTenantId > 0 ? callerTenantId : null,
            UserId = actingUserId,
            Action = "ResetPassword",
            Entity = "AppUser",
            Detail = $"{user.Email} (id={user.UserId})",
            OccurredAt = DateTime.UtcNow,
        }, ct);

        return new ResetPasswordResponse(user.UserId, user.Email, newPassword);
    }
}
