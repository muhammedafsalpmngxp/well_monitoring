namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// A visual catalog a tenant has registered from the marketplace screen. Replaces hard-coding
/// catalog URLs in appsettings; entries there still work as a fallback for operator-managed
/// catalogs. Maps to [core].[MarketplaceCatalogs].
/// </summary>
public class MarketplaceCatalog
{
    public long Id { get; set; }

    /// <summary>Stable key used as the catalogId in marketplace endpoints and on installed visuals.</summary>
    public string CatalogKey { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    /// <summary>HTTPS URL returning the catalog JSON array. Checked by OutboundUrlGuard on every fetch.</summary>
    public string Url { get; set; } = string.Empty;

    /// <summary>Optional header sent with the fetch, e.g. "Authorization" or "X-Api-Key".</summary>
    public string? AuthHeader { get; set; }

    /// <summary>Header value, AES-encrypted at rest with ConnectionPasswordHelper. Never returned to clients.</summary>
    public string? AuthValueEncrypted { get; set; }

    public long TenantId { get; set; }
    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }
}
