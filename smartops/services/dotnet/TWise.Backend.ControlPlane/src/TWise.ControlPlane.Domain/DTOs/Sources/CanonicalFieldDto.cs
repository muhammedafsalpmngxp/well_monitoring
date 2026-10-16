namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record CanonicalFieldDto(int CanonicalFieldId, int CanonicalEntityId, string FieldName, string? DataType, bool IsRequired, bool IsUnique, int? ReferenceEntityId, string? Description, bool IsActive);
public record CanonicalFieldCreateRequest(int CanonicalEntityId, string FieldName, string? DataType, bool IsRequired, bool IsUnique = false, int? ReferenceEntityId = null, string? Description = null, bool IsActive = true);
public record CanonicalFieldUpdateRequest(int CanonicalEntityId, string FieldName, string? DataType, bool IsRequired, bool IsUnique = false, int? ReferenceEntityId = null, string? Description = null, bool IsActive = true);

// Bulk operations
public record BulkCanonicalFieldCreateRequest(List<CanonicalFieldCreateRequest> Items);
public record BulkCanonicalFieldUpdateItem(int CanonicalFieldId, int CanonicalEntityId, string FieldName, string? DataType, bool IsRequired, bool IsUnique = false, int? ReferenceEntityId = null, string? Description = null, bool IsActive = true);
public record BulkCanonicalFieldUpdateRequest(List<BulkCanonicalFieldUpdateItem> Items);
