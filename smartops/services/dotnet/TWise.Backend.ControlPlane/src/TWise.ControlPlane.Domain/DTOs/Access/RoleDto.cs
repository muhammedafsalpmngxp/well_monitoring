namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record RoleDto(int RoleId, string RoleCode, string? RoleName, string? Description, string? Scope, long? TenantId, bool IsSystemRole, bool IsActive);
public record RoleCreateRequest(string RoleCode, string? RoleName, string? Description, string? Scope, bool IsActive = true);
public record RoleUpdateRequest(string RoleCode, string? RoleName, string? Description, string? Scope, bool IsActive = true);
