namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// A user-defined chart type, stored as data rather than code.
///
/// Adding a visual to the native library currently takes five separate code changes (the
/// ChartTypeId union, the validIds allow-list, the display order, a render case and a
/// build*Options method) plus a deployment. A custom visual is registered here instead, and
/// the builder and renderer discover it at runtime.
///
/// Maps to [core].[CustomVisuals].
/// </summary>
public class CustomVisual
{
    public long Id { get; set; }

    /// <summary>
    /// Stable identifier used as the widget's chart type, e.g. "radar-v1". Lower-case,
    /// hyphen-separated; must not collide with a built-in type.
    /// </summary>
    public string VisualKey { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public string? Description { get; set; }

    /// <summary>Icon key the builder palette shows. Falls back to a generic chart glyph.</summary>
    public string? Icon { get; set; }

    /// <summary>How the visual is drawn — see <see cref="CustomVisualRenderKinds"/>.</summary>
    public string RenderKind { get; set; } = CustomVisualRenderKinds.HighchartsTemplate;

    /// <summary>
    /// JSON array of the fields this visual needs, e.g.
    /// <c>[{"key":"category","label":"Category","type":"dimension","required":true}]</c>.
    /// Drives the builder's field pickers, so the form adapts without a code change.
    /// </summary>
    public string DataRolesJson { get; set; } = "[]";

    /// <summary>
    /// Declarative Highcharts options with <c>{{role}}</c> placeholders bound to data roles.
    ///
    /// Deliberately data-only: no JavaScript is stored or evaluated. A visual that could ship
    /// executable code would run with the full privileges of the signed-in user, so v1 trades
    /// that power for safety. See CustomVisualRenderKinds for the intended escape hatch.
    /// </summary>
    public string OptionsTemplateJson { get; set; } = "{}";

    /// <summary>Hidden from the palette when false, without losing widgets already using it.</summary>
    public bool IsActive { get; set; } = true;


    /// <summary>Catalog this was installed from; null when authored in this tenant.</summary>
    public string? CatalogId { get; set; }

    /// <summary>Plugin id within that catalog.</summary>
    public string? CatalogPluginId { get; set; }

    /// <summary>Version installed, compared against the catalog to offer updates.</summary>
    public string? InstalledVersion { get; set; }

    public long TenantId { get; set; }
    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public long? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }
}

/// <summary>How a custom visual is rendered.</summary>
public static class CustomVisualRenderKinds
{
    /// <summary>
    /// A declarative Highcharts options template. Safe: pure JSON, nothing is evaluated.
    /// </summary>
    public const string HighchartsTemplate = "highcharts-template";

    /// <summary>
    /// Reserved. Third-party code would have to run inside a sandboxed iframe communicating
    /// over postMessage — the model Power BI uses — because unsandboxed plug-in JavaScript can
    /// read the user's session and exfiltrate every row it is shown. Not implemented in v1.
    /// </summary>
    public const string SandboxedIframe = "sandboxed-iframe";

    /// <summary>
    /// Metadata imported from a Power BI custom visual package (.pbiviz). Catalogued for reference;
    /// the visual itself runs only inside an embedded Power BI report, so it is never installed.
    /// </summary>
    public const string PowerBiVisual = "pbiviz";

    public static readonly IReadOnlyList<string> All = [HighchartsTemplate];

    public static bool IsSupported(string? kind) =>
        kind is not null && All.Contains(kind.Trim().ToLowerInvariant());
}

/// <summary>What kind of field a data role accepts.</summary>
public static class CustomVisualRoleTypes
{
    /// <summary>A grouping column — category axis, series split.</summary>
    public const string Dimension = "dimension";

    /// <summary>A numeric column that gets aggregated.</summary>
    public const string Measure = "measure";

    public static readonly IReadOnlyList<string> All = [Dimension, Measure];

    public static bool IsSupported(string? t) =>
        t is not null && All.Contains(t.Trim().ToLowerInvariant());
}

/// <summary>
/// The canonical form of a visual key, owned by the domain so that validation, storage and
/// lookup cannot drift apart.
///
/// Keys are accepted in any case for the author's convenience but stored lower-case: a visual
/// saved as "Radar" would otherwise never match a widget whose chart type is "radar".
/// </summary>
public static class CustomVisualKeys
{
    public static string Normalise(string? visualKey) =>
        (visualKey ?? string.Empty).Trim().ToLowerInvariant();
}
