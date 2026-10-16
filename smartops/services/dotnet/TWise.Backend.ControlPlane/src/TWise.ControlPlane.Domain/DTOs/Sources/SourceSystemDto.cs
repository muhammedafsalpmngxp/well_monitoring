namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record SourceSystemDto(int SourceSystemId, string SourceCode, string? SourceName, string? SourceKind, bool IsActive);
public record SourceSystemCreateRequest(string SourceCode, string? SourceName, string? SourceKind, bool IsActive = true);
public record SourceSystemUpdateRequest(string SourceCode, string? SourceName, string? SourceKind, bool IsActive = true);
