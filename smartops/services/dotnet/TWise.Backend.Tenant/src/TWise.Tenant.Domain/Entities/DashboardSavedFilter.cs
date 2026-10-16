namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// Per-user saved filter preset (Country/Sector/.../QuickRange/Date range) for a dashboard.
/// </summary>
public class DashboardSavedFilter
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public int DashboardId { get; set; }
    public long UserId { get; set; }
    public string FilterName { get; set; } = string.Empty;
    public string? Country { get; set; }
    public string? Sector { get; set; }
    public string? BusinessUnit { get; set; }
    public string? Division { get; set; }
    public string? Cluster { get; set; }
    public string? Plant { get; set; }
    public string? QuickRange { get; set; }
    public DateTime? FromDate { get; set; }
    public DateTime? ToDate { get; set; }
    public DateTime CreatedOn { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedOn { get; set; } = DateTime.UtcNow;
    public bool IsFavorite { get; set; }
    public bool IsDeleted { get; set; }

    // Navigation
    public Dashboard? Dashboard { get; set; }
}
