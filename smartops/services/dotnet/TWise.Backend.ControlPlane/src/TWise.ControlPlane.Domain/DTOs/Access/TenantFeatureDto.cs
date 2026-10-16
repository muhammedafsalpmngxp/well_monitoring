namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record TenantFeatureDto(long TenantFeatureId, long TenantId, int FeatureId, bool IsEnabled, DateTime? ValidFrom, DateTime? ValidTo, bool IsActive);
public record TenantFeatureCreateRequest(long TenantId, int FeatureId, bool IsEnabled, DateTime? ValidFrom, DateTime? ValidTo, bool IsActive = true);
public record TenantFeatureUpdateRequest(long TenantId, int FeatureId, bool IsEnabled, DateTime? ValidFrom, DateTime? ValidTo, bool IsActive = true);
