namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record RoleModulePermissionDto(
    string ModuleCode, bool CanView, bool CanCreate, bool CanModify, bool CanAdmin);

public record RoleModulePermissionBulkRequest(List<RoleModulePermissionItem> Permissions);

public record RoleModulePermissionItem(
    string ModuleCode, bool CanView, bool CanCreate, bool CanModify, bool CanAdmin);

public record EffectivePermission(
    string ModuleCode, bool CanView, bool CanCreate, bool CanModify, bool CanAdmin);
