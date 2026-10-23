namespace TWise.Tenant.Domain.DTOs;

public record WidgetDto(
    long Id,
    string Name,
    string? Description,
    string Type,
    int? LibraryId,
    string Source,
    string SourceType,
    long? SourceId,
    string? DesignJson,
    string Status,
    int? CategoryId,
    string? CategoryName,
    long TenantId,
    long CreatedBy,
    DateTime CreatedAt,
    long? ModifiedBy,
    DateTime ModifiedOn,
    /// <summary>
    /// Tiles listed in the chart's DesignJson attachedTileIds, in that order, so the chart view
    /// needs no extra request per tile. Only set by GET /api/widgets/{id}; null elsewhere.
    /// </summary>
    IReadOnlyList<WidgetDto>? AttachedTiles = null,
    string? CategoryDescription = null
);

public record CreateWidgetRequest(
    string Name,
    string? Description,
    string Type,
    int? LibraryId,
    string Source,
    string SourceType,
    long? SourceId,
    string? DesignJson,
    int? CategoryId
);

public record UpdateWidgetRequest(
    string Name,
    string? Description,
    string Type,
    int? LibraryId,
    string Source,
    string SourceType,
    long? SourceId,
    string? DesignJson,
    string? Status,
    int? CategoryId
);
