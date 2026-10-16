using System.Text.Json;

namespace TWise.Tenant.Application.Features.Dashboards;

/// <summary>
/// What a core.Dashboard row holds, read from the "kind" string at the root of its ConfigJson.
/// Rows without one are dashboards, which is every row saved before the reporting canvas. The
/// canvas page writes {"kind":"canvas","layout":{"version":2,...}}.
/// </summary>
public static class DashboardKind
{
    public const string Dashboard = "dashboard";
    public const string Canvas = "canvas";
    public const string UnknownKindMessage = "kind must be dashboard or canvas.";

    /// <summary>
    /// Canvas when the root "kind" is canvas, otherwise dashboard: no kind, an unknown kind and
    /// JSON that cannot be read all count as dashboard, so the row still shows in a list.
    /// </summary>
    public static string Of(string? configJson)
        => TryReadRootKind(configJson, out var kind) && kind.ValueKind == JsonValueKind.String
            && Normalize(kind.GetString()) == Canvas
            ? Canvas
            : Dashboard;

    /// <summary>
    /// False when the config has a root "kind" that is not dashboard or canvas. Create and update
    /// refuse such a config, as the row would otherwise be listed as something it is not.
    /// </summary>
    public static bool HasKnownKind(string? configJson)
        => !TryReadRootKind(configJson, out var kind)
            || (kind.ValueKind == JsonValueKind.String && IsKnown(kind.GetString()));

    /// <summary>
    /// Why a save that replaces the stored config may not go ahead, or null when it may. A save
    /// may not change the kind: the v1 builder saving over a canvas would drop its sheets, and
    /// the canvas page saving over a dashboard would drop its widgets.
    /// </summary>
    public static string? ChangeRefusal(string? storedConfigJson, string? incomingConfigJson)
    {
        var stored = Of(storedConfigJson);
        if (stored == Of(incomingConfigJson)) return null;
        return stored == Canvas
            ? "This is a canvas. Open it from BI Canvas to change it."
            : "This is a dashboard. Open it from the dashboard builder to change it.";
    }

    /// <summary>True for a kind a listing may ask for: none (meaning dashboard), dashboard or canvas.</summary>
    public static bool IsKnown(string? requested) => Normalize(requested) is Dashboard or Canvas;

    /// <summary>True when the row is of the requested kind. Asking for none means dashboards, so existing callers see what they saw before.</summary>
    public static bool Matches(string? configJson, string? requested) => Of(configJson) == Normalize(requested);

    private static bool TryReadRootKind(string? configJson, out JsonElement kind)
    {
        kind = default;
        if (string.IsNullOrWhiteSpace(configJson)) return false;
        try
        {
            using var document = JsonDocument.Parse(configJson);
            if (document.RootElement.ValueKind != JsonValueKind.Object
                || !document.RootElement.TryGetProperty("kind", out var found))
                return false;
            kind = found.Clone();
            return true;
        }
        // An nvarchar column can hold a lone UTF-16 surrogate, which the parser refuses with an ArgumentException.
        catch (Exception ex) when (ex is JsonException or ArgumentException)
        {
            return false;
        }
    }

    private static string Normalize(string? kind)
        => string.IsNullOrWhiteSpace(kind) ? Dashboard : kind.Trim().ToLowerInvariant();
}
