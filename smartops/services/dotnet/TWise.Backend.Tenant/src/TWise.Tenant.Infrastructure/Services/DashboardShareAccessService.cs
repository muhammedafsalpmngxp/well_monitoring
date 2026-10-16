using System.Text.Json;
using System.Text.Json.Nodes;
using TWise.Tenant.Application.Abstractions.Services;
using TWise.Tenant.Application.Features.Dashboards;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Infrastructure.Services;

public sealed class DashboardShareAccessService(
    IDashboardRepository dashboardRepo,
    IWidgetService widgetService) : IDashboardShareAccessService
{
    public Task<WidgetDto?> FindSharedWidgetByIdAsync(int dashboardId, string token, long widgetId, CancellationToken ct = default)
        => FindSharedWidgetAsync(dashboardId, token, widget => widget.Id == widgetId, ct);

    public Task<WidgetDto?> FindSharedTableWidgetAsync(int dashboardId, string token, string sourceName, string sourceType, CancellationToken ct = default)
        => FindSharedWidgetAsync(dashboardId, token,
            widget => UsesTableSource(widget, sourceName, sourceType),
            ct);

    public Task<WidgetDto?> FindSharedViewWidgetAsync(int dashboardId, string token, long viewId, CancellationToken ct = default)
        => FindSharedWidgetAsync(dashboardId, token, widget => UsesView(widget, viewId), ct);

    private static bool UsesView(WidgetDto widget, long viewId)
    {
        if (viewId <= 0) return false;
        if (widget.SourceId == viewId) return true;
        var design = ReadDesign(widget.DesignJson);
        return MatchesId(design?["viewId"], viewId) || MatchesId(design?["drillDownViewId"], viewId);
    }

    private static bool UsesTableSource(WidgetDto widget, string sourceName, string sourceType)
    {
        if (string.IsNullOrWhiteSpace(sourceName)
            || !(Same(sourceType, "Table") || Same(sourceType, "View"))) return false;
        if (Same(widget.Source, sourceName) && Same(widget.SourceType, sourceType)) return true;

        var design = ReadDesign(widget.DesignJson);
        if (design is null) return false;
        if (Same(Text(design["source"]), sourceName)
            && Same(Text(design["sourceType"]) ?? widget.SourceType, sourceType)) return true;

        foreach (var property in new[] { "interactiveFilters", "conditionalFilters" })
        {
            if (Entries(design[property]).Any(filter => Same(Text(filter["sourceTable"]), sourceName)))
                return true;
        }

        return Entries(design["breakdownRows"]).Any(row =>
            Same(Text(row["sourceName"]), sourceName)
            && Same(Text(row["sourceType"]) ?? "Table", sourceType));
    }

    private static JsonObject? ReadDesign(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonNode.Parse(json) as JsonObject; }
        catch (JsonException) { return null; }
    }

    private static IEnumerable<JsonObject> Entries(JsonNode? node)
        => node is JsonArray array ? array.OfType<JsonObject>() : [];

    private static string? Text(JsonNode? node)
        => node is JsonValue value && value.TryGetValue<string>(out var text) ? text : null;

    private static bool MatchesId(JsonNode? node, long expected)
        => node is JsonValue value && value.TryGetValue<long>(out var actual) && actual == expected;

    private static bool Same(string? left, string? right)
        => string.Equals(left, right, StringComparison.OrdinalIgnoreCase);

    public async Task<bool> IsValidShareTokenAsync(int dashboardId, string token, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(token)) return false;
        var dashboard = await dashboardRepo.GetDashboardByIdAsync(dashboardId, ct);
        return dashboard is not null && DashboardShareLink.HasToken(dashboard.ConfigJson, token);
    }

    private async Task<WidgetDto?> FindSharedWidgetAsync(int dashboardId, string token, Func<WidgetDto, bool> matches, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;

        var dashboard = await dashboardRepo.GetDashboardByIdAsync(dashboardId, ct);
        if (dashboard is null || !DashboardShareLink.HasToken(dashboard.ConfigJson, token)) return null;

        if (!long.TryParse(dashboard.CreatedBy, out var ownerId)) ownerId = 0;

        var attachedTileIds = new HashSet<long>();
        var visited = new HashSet<long>();
        foreach (var widgetId in DashboardWidgetLookup.GetWidgetIds(dashboard.ConfigJson))
        {
            if (!visited.Add(widgetId)) continue;
            var widget = await widgetService.GetByIdAsync(widgetId, ownerId, ct);
            if (widget is null) continue;
            if (matches(widget)) return widget;
            if (ReadDesign(widget.DesignJson)?["attachedTileIds"] is JsonArray tileIds)
            {
                foreach (var node in tileIds)
                    if (node is JsonValue value && value.TryGetValue<long>(out var tileId) && tileId > 0)
                        attachedTileIds.Add(tileId);
            }
        }

        foreach (var tileId in attachedTileIds)
        {
            if (!visited.Add(tileId)) continue;
            var tile = await widgetService.GetByIdAsync(tileId, ownerId, ct);
            if (tile is not null && Same(tile.Type, "tile") && matches(tile)) return tile;
        }

        return null;
    }
}