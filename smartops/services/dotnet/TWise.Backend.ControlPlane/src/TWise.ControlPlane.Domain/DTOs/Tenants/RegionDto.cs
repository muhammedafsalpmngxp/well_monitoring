namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record RegionDto(int RegionId, string RegionCode, string? RegionName, bool IsActive);
public record RegionCreateRequest(string RegionCode, string? RegionName, bool IsActive = true);
public record RegionUpdateRequest(string RegionCode, string? RegionName, bool IsActive = true);
