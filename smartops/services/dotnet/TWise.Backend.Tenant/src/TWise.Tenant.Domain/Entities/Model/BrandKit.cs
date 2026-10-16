namespace TWise.Tenant.Domain.Entities.Model;

/// <summary>
/// A saved brand kit for the reporting canvas: its name and the kit as JSON (colours, font, logo, text sizes).
/// A canvas keeps its own copy of a kit it applies. Maps to [model].[BrandKit].
/// </summary>
public class BrandKit
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Kit { get; set; } = "{}";
    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public long? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
}
