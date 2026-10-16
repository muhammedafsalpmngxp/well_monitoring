namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record CapabilityProfileDto(long CapabilityId, long TenantSourceId, int CanonicalFieldId, bool IsAvailable, string? Note, bool IsActive);
public record CapabilityProfileCreateRequest(long TenantSourceId, int CanonicalFieldId, bool IsAvailable, string? Note, bool IsActive = true);
public record CapabilityProfileUpdateRequest(long TenantSourceId, int CanonicalFieldId, bool IsAvailable, string? Note, bool IsActive = true);
