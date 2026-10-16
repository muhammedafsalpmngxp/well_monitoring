namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record TenantDto(long TenantId, string TenantCode, string? TenantName, int? RegionId, string? IsolationMode, string? DataPlaneRef, int? SchemaVersionId, string? Status, string? ProvisionStep, bool IsActive);
public record TenantProvisionStatusDto(long TenantId, string? Status, string? ProvisionStep, string? DataPlaneRef, int RetryCount);
public record TenantCreateRequest(string TenantCode, string? TenantName, int? RegionId, string? IsolationMode, string? DataPlaneRef, int? SchemaVersionId, string? Status, bool IsActive = true);
public record TenantUpdateRequest(string TenantCode, string? TenantName, int? RegionId, string? IsolationMode, string? DataPlaneRef, int? SchemaVersionId, string? Status, bool IsActive = true);
public record ProvisionTenantRequest(long TenantId);
