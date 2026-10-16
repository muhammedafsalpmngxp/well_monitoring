namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record CanonicalEntityDto(int CanonicalEntityId, string EntityName, int? SchemaVersionId, string? Layer, string? Description, bool IsActive);
public record CanonicalEntityCreateRequest(string EntityName, int? SchemaVersionId, string? Layer, string? Description, bool IsActive = true);
public record CanonicalEntityUpdateRequest(string EntityName, int? SchemaVersionId, string? Layer, string? Description, bool IsActive = true);

// Bulk operations
public record BulkCanonicalEntityCreateRequest(List<CanonicalEntityCreateRequest> Items);
public record BulkCanonicalEntityUpdateItem(int CanonicalEntityId, string EntityName, int? SchemaVersionId, string? Layer, string? Description, bool IsActive = true);
public record BulkCanonicalEntityUpdateRequest(List<BulkCanonicalEntityUpdateItem> Items);
