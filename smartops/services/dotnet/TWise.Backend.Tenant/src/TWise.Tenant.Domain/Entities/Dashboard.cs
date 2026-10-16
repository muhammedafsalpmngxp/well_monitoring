namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// Represents a user-created dashboard.
/// Status flow: Draft → Published / Deleted / Inactive
/// Widget layout is stored as JSON in ConfigJson.
/// </summary>
public class Dashboard : BaseEntity
{
    public int DashboardId { get; set; }
    public string DashboardName { get; set; } = string.Empty;
    public int CategoryId { get; set; }
    public string Status { get; set; } = DashboardStatus.Draft;
    public string? Description { get; set; }
    public string? ConfigJson { get; set; }
    public string? PublishedBy { get; set; }
    public bool IsActive { get; set; } = true;

    /// <summary>Shared by every version of the same logical dashboard (v0, v1, v2...).</summary>
    public Guid DashboardSeriesId { get; set; } = Guid.NewGuid();
    /// <summary>Null while Draft/Completed; set to 0, 1, 2... on each publish.</summary>
    public int? VersionNo { get; set; }
    /// <summary>True only for the version currently shown in Standard Boards.</summary>
    public bool IsLatestVersion { get; set; }

    // Navigation
    public Category? Category { get; set; }
}

/// <summary>
/// Dashboard status constants.
/// </summary>
public static class DashboardStatus
{
    public const string Draft = "Draft";
    public const string Published = "Published";
    public const string Completed = "Completed";
    public const string Inactive = "Inactive";
    public const string Deleted = "Deleted";
}
