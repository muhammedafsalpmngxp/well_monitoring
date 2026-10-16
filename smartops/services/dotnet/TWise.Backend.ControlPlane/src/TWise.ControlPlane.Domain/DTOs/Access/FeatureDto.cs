namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record FeatureDto(int FeatureId, string FeatureCode, string? FeatureName, bool IsActive);
public record FeatureCreateRequest(string FeatureCode, string? FeatureName, bool IsActive = true);
public record FeatureUpdateRequest(string FeatureCode, string? FeatureName, bool IsActive = true);
