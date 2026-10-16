using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Access;

public sealed class ListUsersHandler(IAccessService svc) : IRequestHandler<ListUsersQuery, Result<PagedResult<AppUserDto>>>
{
    public async Task<Result<PagedResult<AppUserDto>>> Handle(ListUsersQuery request, CancellationToken ct)
        => Result<PagedResult<AppUserDto>>.Success(await svc.ListUsersAsync(request.Page, request.PageSize, ct));
}

public sealed class GetUserHandler(IAccessService svc) : IRequestHandler<GetUserQuery, Result<AppUserDto>>
{
    public async Task<Result<AppUserDto>> Handle(GetUserQuery request, CancellationToken ct)
    {
        var dto = await svc.GetUserAsync(request.Id, ct);
        return dto is null ? Result<AppUserDto>.NotFound() : Result<AppUserDto>.Success(dto);
    }
}

public sealed class CheckUserDuplicatesHandler(IAccessService svc) : IRequestHandler<CheckUserDuplicatesQuery, Result<UserDuplicateCheckResponse>>
{
    public async Task<Result<UserDuplicateCheckResponse>> Handle(CheckUserDuplicatesQuery request, CancellationToken ct)
        => Result<UserDuplicateCheckResponse>.Success(await svc.CheckUserDuplicatesAsync(request.Email, request.EmployeeId, ct));
}

public sealed class ListUsersByTenantHandler(IAccessService svc) : IRequestHandler<ListUsersByTenantQuery, Result<PagedResult<TenantUserDto>>>
{
    public async Task<Result<PagedResult<TenantUserDto>>> Handle(ListUsersByTenantQuery request, CancellationToken ct)
        => Result<PagedResult<TenantUserDto>>.Success(await svc.ListUsersByTenantAsync(request.TenantId, request.Page, request.PageSize, ct));
}

public sealed class SearchEmployeesHandler(ILegacyDirectoryService svc) : IRequestHandler<SearchEmployeesQuery, Result<IReadOnlyList<EmployeeSearchResult>>>
{
    public async Task<Result<IReadOnlyList<EmployeeSearchResult>>> Handle(SearchEmployeesQuery request, CancellationToken ct)
        => Result<IReadOnlyList<EmployeeSearchResult>>.Success(await svc.SearchEmployeesAsync(request.Term, ct));
}

public sealed class GetUserPlantAccessHandler(IAccessService svc) : IRequestHandler<GetUserPlantAccessQuery, Result<List<int>>>
{
    public async Task<Result<List<int>>> Handle(GetUserPlantAccessQuery request, CancellationToken ct)
    {
        var list = await svc.GetUserPlantAccessAsync(request.UserId, request.CallerTenantId, ct);
        return list is null ? Result<List<int>>.NotFound() : Result<List<int>>.Success(list);
    }
}

public sealed class ListPlantsHandler(ILegacyDirectoryService svc) : IRequestHandler<ListPlantsQuery, Result<IReadOnlyList<EmployeePlantAccess>>>
{
    public async Task<Result<IReadOnlyList<EmployeePlantAccess>>> Handle(ListPlantsQuery request, CancellationToken ct)
        => Result<IReadOnlyList<EmployeePlantAccess>>.Success(await svc.ListPlantsAsync(ct));
}

public sealed class ListRolesHandler(IAccessService svc) : IRequestHandler<ListRolesQuery, Result<PagedResult<RoleDto>>>
{
    public async Task<Result<PagedResult<RoleDto>>> Handle(ListRolesQuery request, CancellationToken ct)
        => Result<PagedResult<RoleDto>>.Success(await svc.ListRolesAsync(request.CallerTenantId, request.Page, request.PageSize, ct));
}

public sealed class GetRoleHandler(IAccessService svc) : IRequestHandler<GetRoleQuery, Result<RoleDto>>
{
    public async Task<Result<RoleDto>> Handle(GetRoleQuery request, CancellationToken ct)
    {
        var dto = await svc.GetRoleAsync(request.Id, request.CallerTenantId, ct);
        return dto is null ? Result<RoleDto>.NotFound() : Result<RoleDto>.Success(dto);
    }
}

public sealed class ListUserTenantRolesHandler(IAccessService svc) : IRequestHandler<ListUserTenantRolesQuery, Result<PagedResult<UserTenantRoleDto>>>
{
    public async Task<Result<PagedResult<UserTenantRoleDto>>> Handle(ListUserTenantRolesQuery request, CancellationToken ct)
        => Result<PagedResult<UserTenantRoleDto>>.Success(await svc.ListUserTenantRolesAsync(request.CallerTenantId, request.Page, request.PageSize, ct));
}

public sealed class GetUserTenantRoleHandler(IAccessService svc) : IRequestHandler<GetUserTenantRoleQuery, Result<UserTenantRoleDto>>
{
    public async Task<Result<UserTenantRoleDto>> Handle(GetUserTenantRoleQuery request, CancellationToken ct)
    {
        var dto = await svc.GetUserTenantRoleAsync(request.Id, request.CallerTenantId, ct);
        return dto is null ? Result<UserTenantRoleDto>.NotFound() : Result<UserTenantRoleDto>.Success(dto);
    }
}

public sealed class ListFeaturesHandler(IAccessService svc) : IRequestHandler<ListFeaturesQuery, Result<PagedResult<FeatureDto>>>
{
    public async Task<Result<PagedResult<FeatureDto>>> Handle(ListFeaturesQuery request, CancellationToken ct)
        => Result<PagedResult<FeatureDto>>.Success(await svc.ListFeaturesAsync(request.Page, request.PageSize, ct));
}

public sealed class GetFeatureHandler(IAccessService svc) : IRequestHandler<GetFeatureQuery, Result<FeatureDto>>
{
    public async Task<Result<FeatureDto>> Handle(GetFeatureQuery request, CancellationToken ct)
    {
        var dto = await svc.GetFeatureAsync(request.Id, ct);
        return dto is null ? Result<FeatureDto>.NotFound() : Result<FeatureDto>.Success(dto);
    }
}

public sealed class ListTenantFeaturesHandler(IAccessService svc) : IRequestHandler<ListTenantFeaturesQuery, Result<PagedResult<TenantFeatureDto>>>
{
    public async Task<Result<PagedResult<TenantFeatureDto>>> Handle(ListTenantFeaturesQuery request, CancellationToken ct)
        => Result<PagedResult<TenantFeatureDto>>.Success(await svc.ListTenantFeaturesAsync(request.Page, request.PageSize, ct));
}

public sealed class GetTenantFeatureHandler(IAccessService svc) : IRequestHandler<GetTenantFeatureQuery, Result<TenantFeatureDto>>
{
    public async Task<Result<TenantFeatureDto>> Handle(GetTenantFeatureQuery request, CancellationToken ct)
    {
        var dto = await svc.GetTenantFeatureAsync(request.Id, ct);
        return dto is null ? Result<TenantFeatureDto>.NotFound() : Result<TenantFeatureDto>.Success(dto);
    }
}

public sealed class CheckUserExistsHandler(IAccessService svc) : IRequestHandler<CheckUserExistsQuery, Result<UserExistsResponse>>
{
    public async Task<Result<UserExistsResponse>> Handle(CheckUserExistsQuery request, CancellationToken ct)
        => Result<UserExistsResponse>.Success(await svc.CheckUserExistsByIdAsync(request.UserId, request.TenantId, ct));
}

public sealed class ResolveUsersHandler(IAccessService svc) : IRequestHandler<ResolveUsersQuery, Result<List<DirectoryUserDto>>>
{
    public async Task<Result<List<DirectoryUserDto>>> Handle(ResolveUsersQuery request, CancellationToken ct)
        => Result<List<DirectoryUserDto>>.Success(await svc.ResolveUsersAsync(request.Request, ct));
}

public sealed class ListModuleTreeHandler(IAccessService svc) : IRequestHandler<ListModuleTreeQuery, Result<List<ModuleTreeNode>>>
{
    public async Task<Result<List<ModuleTreeNode>>> Handle(ListModuleTreeQuery request, CancellationToken ct)
        => Result<List<ModuleTreeNode>>.Success(await svc.ListModuleTreeAsync(ct));
}

public sealed class GetModuleHandler(IAccessService svc) : IRequestHandler<GetModuleQuery, Result<ModuleDto>>
{
    public async Task<Result<ModuleDto>> Handle(GetModuleQuery request, CancellationToken ct)
    {
        var dto = await svc.GetModuleAsync(request.Id, ct);
        return dto is null ? Result<ModuleDto>.NotFound() : Result<ModuleDto>.Success(dto);
    }
}

public sealed class GetRolePermissionsHandler(IAccessService svc) : IRequestHandler<GetRolePermissionsQuery, Result<List<RoleModulePermissionDto>>>
{
    public async Task<Result<List<RoleModulePermissionDto>>> Handle(GetRolePermissionsQuery request, CancellationToken ct)
        => Result<List<RoleModulePermissionDto>>.Success(await svc.GetRolePermissionsAsync(request.RoleId, request.CallerTenantId, ct));
}

public sealed class GetEffectivePermissionsHandler(IAccessService svc) : IRequestHandler<GetEffectivePermissionsQuery, Result<List<EffectivePermission>>>
{
    public async Task<Result<List<EffectivePermission>>> Handle(GetEffectivePermissionsQuery request, CancellationToken ct)
        => Result<List<EffectivePermission>>.Success(await svc.GetEffectivePermissionsAsync(request.RoleId, request.TenantId, ct));
}
