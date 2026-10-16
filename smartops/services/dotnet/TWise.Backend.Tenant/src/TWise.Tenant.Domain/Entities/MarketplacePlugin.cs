namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// One visual in the built-in "TWise Visuals" marketplace. Rows are seeded by
/// infra/sql/add-marketplace-plugins.sql and served as a catalog by GET /api/marketplace/catalog.
/// Maps to [core].[MarketplacePlugins].
/// </summary>
public class MarketplacePlugin
{
    public long Id { get; set; }

    /// <summary>Plugin id within the catalog, e.g. "radar".</summary>
    public string PluginId { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Version { get; set; } = string.Empty;
    public string Publisher { get; set; } = string.Empty;

    /// <summary>Renderer id once installed; must not collide with a built-in chart type.</summary>
    public string VisualKey { get; set; } = string.Empty;

    public string RenderKind { get; set; } = CustomVisualRenderKinds.HighchartsTemplate;
    public string? Icon { get; set; }

    /// <summary>JSON array of CustomVisualDataRole.</summary>
    public string DataRolesJson { get; set; } = "[]";

    /// <summary>JSON array of short bullet points for the marketplace card.</summary>
    public string? FeaturesJson { get; set; }

    public string? ImageUrl { get; set; }
    public string OptionsTemplateJson { get; set; } = "{}";

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}
