namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// Shared category used across Dashboards, Charts, Tiles, and Reports.
/// A default "Others" category is always seeded.
/// </summary>
public class Category : BaseEntity
{
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string ControlType { get; set; } = string.Empty;

    // Navigation
    public ICollection<Dashboard> Dashboards { get; set; } = new List<Dashboard>();
    public ICollection<Report> Reports { get; set; } = [];
}
