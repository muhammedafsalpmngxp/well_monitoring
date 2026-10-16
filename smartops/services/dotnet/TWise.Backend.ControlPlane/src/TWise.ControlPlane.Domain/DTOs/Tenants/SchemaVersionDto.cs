namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record SchemaVersionDto(int SchemaVersionId, string VersionNo, string? Description, DateTime? ReleasedAt, bool IsCurrent, bool IsActive);
public record SchemaVersionCreateRequest(string VersionNo, string? Description, DateTime? ReleasedAt, bool IsCurrent, bool IsActive = true);
public record SchemaVersionUpdateRequest(string VersionNo, string? Description, DateTime? ReleasedAt, bool IsCurrent, bool IsActive = true);
