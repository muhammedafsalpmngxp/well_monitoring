namespace TWise.Tenant.Domain.DTOs;

/// <summary>Returned to the frontend — a saved filter preset for a dashboard.</summary>
public record DashboardSavedFilterDto(
    long Id,
    int DashboardId,
    string FilterName,
    string? Country,
    string? Sector,
    string? BusinessUnit,
    string? Division,
    string? Cluster,
    string? Plant,
    string? QuickRange,
    DateTime? FromDate,
    DateTime? ToDate,
    DateTime CreatedOn,
    DateTime UpdatedOn,
    bool IsFavorite
);

/// <summary>
/// Sent by the frontend to save (create or overwrite) a filter preset by name,
/// or to apply an existing preset — set Id to apply, omit it to save.
/// </summary>
public record SaveDashboardSavedFilterRequest(
    string? FilterName,
    string? Country,
    string? Sector,
    string? BusinessUnit,
    string? Division,
    string? Cluster,
    string? Plant,
    string? QuickRange,
    DateTime? FromDate,
    DateTime? ToDate,
    long? Id = null
);

/// <summary>Sent by the frontend to rename an existing saved filter preset.</summary>
public record RenameDashboardSavedFilterRequest(string NewFilterName);

/// <summary>Sent by the frontend to mark/unmark a saved filter preset as a favorite.</summary>
public record SetFavoriteDashboardSavedFilterRequest(bool IsFavorite);
