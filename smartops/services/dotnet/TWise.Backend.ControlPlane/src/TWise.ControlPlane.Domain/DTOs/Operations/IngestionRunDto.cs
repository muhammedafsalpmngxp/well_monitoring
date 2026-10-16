namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record IngestionRunDto(long IngestionRunId, long TenantSourceId, DateTime? StartedAt, DateTime? FinishedAt, string? Status, int? RowsExtracted, int? RowsLoaded, int? ErrorCount);
public record IngestionRunCreateRequest(long TenantSourceId, DateTime? StartedAt, DateTime? FinishedAt, string? Status, int? RowsExtracted, int? RowsLoaded, int? ErrorCount);
public record IngestionRunUpdateRequest(long TenantSourceId, DateTime? StartedAt, DateTime? FinishedAt, string? Status, int? RowsExtracted, int? RowsLoaded, int? ErrorCount);
