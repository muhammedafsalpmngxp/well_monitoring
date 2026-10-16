namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record AuditEventDto(long AuditEventId, long? TenantId, long? UserId, string? Action, string? Entity, string? Detail, DateTime? OccurredAt);
public record AuditEventCreateRequest(long? TenantId, long? UserId, string? Action, string? Entity, string? Detail, DateTime? OccurredAt);
public record AuditEventUpdateRequest(long? TenantId, long? UserId, string? Action, string? Entity, string? Detail, DateTime? OccurredAt);
