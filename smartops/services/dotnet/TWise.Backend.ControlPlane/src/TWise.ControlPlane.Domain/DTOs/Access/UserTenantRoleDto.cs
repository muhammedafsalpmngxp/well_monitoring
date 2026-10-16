namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record UserTenantRoleDto(long UserTenantRoleId, long UserId, long TenantId, int RoleId, bool IsActive);
public record UserTenantRoleCreateRequest(long UserId, long TenantId, int RoleId, bool IsActive = true);
public record UserTenantRoleUpdateRequest(long UserId, long TenantId, int RoleId, bool IsActive = true);
