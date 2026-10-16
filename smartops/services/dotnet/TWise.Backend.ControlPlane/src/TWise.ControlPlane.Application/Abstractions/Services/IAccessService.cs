using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Abstractions.Services;

public interface IAccessService
{
    Task<PagedResult<AppUserDto>> ListUsersAsync(int page, int pageSize, CancellationToken ct);
    Task<AppUserDto?> GetUserAsync(long id, CancellationToken ct);
    Task<UserDuplicateCheckResponse> CheckUserDuplicatesAsync(string? email, string? employeeId, CancellationToken ct);
    Task<AppUserDto> CreateUserAsync(AppUserCreateRequest request, CancellationToken ct);
    Task<bool> UpdateUserAsync(long id, AppUserUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteUserAsync(long id, CancellationToken ct);
    Task<List<int>?> GetUserPlantAccessAsync(long userId, long callerTenantId, CancellationToken ct);
    Task<bool> UpdateUserPlantAccessAsync(long userId, List<int> plantCodes, long callerTenantId, CancellationToken ct);
    Task<bool> UpdateUserWithAccessAsync(long id, UpdateUserWithAccessRequest request, long callerTenantId, CancellationToken ct);
    Task<UserExistsResponse> CheckUserExistsByIdAsync(long userId, long tenantId, CancellationToken ct);
    /// <summary>Users of the tenant by id and by role code, with their roles and plants (UserDirectory).</summary>
    Task<List<DirectoryUserDto>> ResolveUsersAsync(ResolveUsersRequest request, CancellationToken ct);
    Task<PagedResult<TenantUserDto>> ListUsersByTenantAsync(long tenantId, int page, int pageSize, CancellationToken ct);
    Task<ResetPasswordResponse?> ResetUserPasswordAsync(long userId, long callerTenantId, long? actingUserId, CancellationToken ct);

    Task<PagedResult<RoleDto>> ListRolesAsync(long callerTenantId, int page, int pageSize, CancellationToken ct);
    Task<RoleDto?> GetRoleAsync(int id, long callerTenantId, CancellationToken ct);
    Task<RoleDto> CreateRoleAsync(RoleCreateRequest request, long callerTenantId, CancellationToken ct);
    Task<bool> UpdateRoleAsync(int id, RoleUpdateRequest request, long callerTenantId, CancellationToken ct);
    Task<bool> DeleteRoleAsync(int id, long callerTenantId, CancellationToken ct);

    Task<PagedResult<UserTenantRoleDto>> ListUserTenantRolesAsync(long callerTenantId, int page, int pageSize, CancellationToken ct);
    Task<UserTenantRoleDto?> GetUserTenantRoleAsync(long id, long callerTenantId, CancellationToken ct);
    Task<UserTenantRoleDto> CreateUserTenantRoleAsync(UserTenantRoleCreateRequest request, long callerTenantId, CancellationToken ct);
    Task<bool> UpdateUserTenantRoleAsync(long id, UserTenantRoleUpdateRequest request, long callerTenantId, CancellationToken ct);
    Task<bool> DeleteUserTenantRoleAsync(long id, long callerTenantId, CancellationToken ct);

    Task<PagedResult<FeatureDto>> ListFeaturesAsync(int page, int pageSize, CancellationToken ct);
    Task<FeatureDto?> GetFeatureAsync(int id, CancellationToken ct);
    Task<FeatureDto> CreateFeatureAsync(FeatureCreateRequest request, CancellationToken ct);
    Task<bool> UpdateFeatureAsync(int id, FeatureUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteFeatureAsync(int id, CancellationToken ct);

    Task<PagedResult<TenantFeatureDto>> ListTenantFeaturesAsync(int page, int pageSize, CancellationToken ct);
    Task<TenantFeatureDto?> GetTenantFeatureAsync(long id, CancellationToken ct);
    Task<TenantFeatureDto> CreateTenantFeatureAsync(TenantFeatureCreateRequest request, CancellationToken ct);
    Task<bool> UpdateTenantFeatureAsync(long id, TenantFeatureUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteTenantFeatureAsync(long id, CancellationToken ct);

    Task<List<ModuleTreeNode>> ListModuleTreeAsync(CancellationToken ct);
    Task<ModuleDto?> GetModuleAsync(int id, CancellationToken ct);
    Task<ModuleDto> CreateModuleAsync(ModuleCreateRequest request, CancellationToken ct);
    Task<bool> UpdateModuleAsync(int id, ModuleUpdateRequest request, CancellationToken ct);
    Task<bool> DeleteModuleAsync(int id, CancellationToken ct);

    Task<List<RoleModulePermissionDto>> GetRolePermissionsAsync(int roleId, long callerTenantId, CancellationToken ct);
    Task<bool> BulkUpsertRolePermissionsAsync(int roleId, RoleModulePermissionBulkRequest request, long callerTenantId, CancellationToken ct);
    Task<List<EffectivePermission>> GetEffectivePermissionsAsync(int roleId, long tenantId, CancellationToken ct);

    Task<CreateUserWithAccessResponse> CreateUserWithAccessAsync(CreateUserWithAccessRequest request, long callerTenantId, CancellationToken ct);
}
