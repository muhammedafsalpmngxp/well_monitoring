using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Application.Common.Caching;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Access;

public record ListUsersQuery(int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<AppUserDto>>>;
public record GetUserQuery(long Id) : IRequest<Result<AppUserDto>>;
public record CheckUserDuplicatesQuery(string? Email, string? EmployeeId) : IRequest<Result<UserDuplicateCheckResponse>>;
public record ListUsersByTenantQuery(long TenantId, int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<TenantUserDto>>>;
public record SearchEmployeesQuery(string Term) : IRequest<Result<IReadOnlyList<EmployeeSearchResult>>>;
public record ListPlantsQuery() : IRequest<Result<IReadOnlyList<EmployeePlantAccess>>>, ICacheableQuery
{
    public string CacheKey => "plants:all";
    public TimeSpan? AbsoluteExpiration => TimeSpan.FromMinutes(30);
}
public record ListRolesQuery(long CallerTenantId, int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<RoleDto>>>, ICacheableQuery
{
    public string CacheKey => $"roles:t{CallerTenantId}:p{Page}:s{PageSize}";
    public TimeSpan? AbsoluteExpiration => TimeSpan.FromMinutes(10);
}
public record GetRoleQuery(int Id, long CallerTenantId) : IRequest<Result<RoleDto>>;
public record ListUserTenantRolesQuery(long CallerTenantId, int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<UserTenantRoleDto>>>;
public record GetUserTenantRoleQuery(long Id, long CallerTenantId) : IRequest<Result<UserTenantRoleDto>>;
public record ListFeaturesQuery(int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<FeatureDto>>>, ICacheableQuery
{
    public string CacheKey => $"features:p{Page}:s{PageSize}";
    public TimeSpan? AbsoluteExpiration => TimeSpan.FromMinutes(10);
}
public record GetFeatureQuery(int Id) : IRequest<Result<FeatureDto>>;
public record ListTenantFeaturesQuery(int Page = 1, int PageSize = 200) : IRequest<Result<PagedResult<TenantFeatureDto>>>;
public record GetTenantFeatureQuery(long Id) : IRequest<Result<TenantFeatureDto>>;
public record CheckUserExistsQuery(long UserId, long TenantId) : IRequest<Result<UserExistsResponse>>;
public record ResolveUsersQuery(ResolveUsersRequest Request) : IRequest<Result<List<DirectoryUserDto>>>;
public record GetUserPlantAccessQuery(long UserId, long CallerTenantId) : IRequest<Result<List<int>>>;

public record ListModuleTreeQuery() : IRequest<Result<List<ModuleTreeNode>>>, ICacheableQuery
{
    public string CacheKey => "modules:tree";
    public TimeSpan? AbsoluteExpiration => TimeSpan.FromMinutes(30);
}
public record GetModuleQuery(int Id) : IRequest<Result<ModuleDto>>;
public record GetRolePermissionsQuery(int RoleId, long CallerTenantId) : IRequest<Result<List<RoleModulePermissionDto>>>;
public record GetEffectivePermissionsQuery(int RoleId, long TenantId) : IRequest<Result<List<EffectivePermission>>>;
