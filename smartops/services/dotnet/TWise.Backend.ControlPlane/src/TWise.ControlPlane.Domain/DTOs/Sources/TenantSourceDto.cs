namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record TenantSourceDto(long TenantSourceId, long TenantId, int SourceSystemId, string? ConnectionRef, string? IngestionMode, bool IsSystemOfRecord, string? Status, bool IsActive);
public record TenantSourceCreateRequest(long TenantId, int SourceSystemId, string? ConnectionRef, string? IngestionMode, bool IsSystemOfRecord, string? Status, bool IsActive = true);
public record TenantSourceUpdateRequest(long TenantId, int SourceSystemId, string? ConnectionRef, string? IngestionMode, bool IsSystemOfRecord, string? Status, bool IsActive = true);
