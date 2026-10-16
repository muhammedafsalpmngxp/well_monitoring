using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Abstractions.Services;

/// <summary>
/// Authorizes anonymous (share-token) requests for the underlying table/view data behind a
/// specific dashboard's widgets — used so an externally shared dashboard's charts/tiles can
/// load data without a JWT, while still only exposing exactly what that dashboard references.
/// </summary>
public interface IDashboardShareAccessService
{
    Task<WidgetDto?> FindSharedWidgetByIdAsync(int dashboardId, string token, long widgetId, CancellationToken ct = default);

    /// <summary>Returns the widget on the shared dashboard using this table source, or null if unauthorized/not found.</summary>
    Task<WidgetDto?> FindSharedTableWidgetAsync(int dashboardId, string token, string sourceName, string sourceType, CancellationToken ct = default);

    /// <summary>Returns the widget on the shared dashboard using this database view, or null if unauthorized/not found.</summary>
    Task<WidgetDto?> FindSharedViewWidgetAsync(int dashboardId, string token, long viewId, CancellationToken ct = default);

    /// <summary>Returns true if the token is currently valid for this dashboard — used to gate generic (non-widget-specific) reference data like plant/org filters.</summary>
    Task<bool> IsValidShareTokenAsync(int dashboardId, string token, CancellationToken ct = default);
}
