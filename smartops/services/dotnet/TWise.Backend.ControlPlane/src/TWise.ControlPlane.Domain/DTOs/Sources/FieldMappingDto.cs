namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record FieldMappingDto(long FieldMappingId, long TenantSourceId, int CanonicalFieldId, string? SourceObject, string? SourceField, string? TransformRule, bool IsActive);
public record FieldMappingCreateRequest(long TenantSourceId, int CanonicalFieldId, string? SourceObject, string? SourceField, string? TransformRule, bool IsActive = true);
public record FieldMappingUpdateRequest(long TenantSourceId, int CanonicalFieldId, string? SourceObject, string? SourceField, string? TransformRule, bool IsActive = true);

// Bulk operations
public record BulkFieldMappingCreateRequest(List<FieldMappingCreateRequest> Items);
public record BulkFieldMappingUpdateItem(long FieldMappingId, long TenantSourceId, int CanonicalFieldId, string? SourceObject, string? SourceField, string? TransformRule, bool IsActive = true);
public record BulkFieldMappingUpdateRequest(List<BulkFieldMappingUpdateItem> Items);
