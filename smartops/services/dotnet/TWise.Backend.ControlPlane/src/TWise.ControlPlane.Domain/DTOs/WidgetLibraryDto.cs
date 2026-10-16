namespace TWise.Backend.ControlPlane.Domain.DTOs;

public record WidgetLibraryDto(
    int Id,
    string WidgetName,
    string Type,
    string? Json,
    long CreatedBy,
    DateTime CreatedAt,
    long? ModifiedBy,
    DateTime ModifiedAt
);

public record CreateWidgetLibraryRequest(
    string WidgetName,
    string Type,
    string? Json
);

public record UpdateWidgetLibraryRequest(
    string WidgetName,
    string Type,
    string? Json
);
