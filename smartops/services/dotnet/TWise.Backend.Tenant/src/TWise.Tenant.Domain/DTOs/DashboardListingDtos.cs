namespace TWise.Tenant.Domain.DTOs;

// ─── Category Dropdown ───────────────────────────────────────────────────────

public class CategoryDropdownResponse
{
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string ControlType { get; set; } = string.Empty;
    public int ItemCount { get; set; }
}

// ─── Dashboard Grouped by Category ──────────────────────────────────────────

public class DashboardCategoryResponse
{
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int DashboardCount { get; set; }
    public List<DashboardSummaryResponse> Dashboards { get; set; } = new();
}

public class DashboardSummaryResponse
{
    public int DashboardId { get; set; }
    public string DashboardName { get; set; } = string.Empty;
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int WidgetCount { get; set; }
    public DateTime? ModifiedDate { get; set; }
    public string? CreatedBy { get; set; }
    public int? VersionNo { get; set; }
}

/// <summary>Minimal WIP dashboard entry used to populate the "copy chart to dashboard" picker.</summary>
public class DashboardMinimalResponse
{
    public int DashboardId { get; set; }
    public string DashboardName { get; set; } = string.Empty;
}

// ─── Publish ─────────────────────────────────────────────────────────────────

public class PublishDashboardResponse
{
    public int DashboardId { get; set; }
    public string Status { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}

// ─── Complete ────────────────────────────────────────────────────────────────

public class CompleteDashboardResponse
{
    public int DashboardId { get; set; }
    public string Status { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}

// ─── Reopen (Completed → Draft) ──────────────────────────────────────────────────────

public class ReopenDashboardResponse
{
    public int DashboardId { get; set; }
    public string Status { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}

// ─── Update Dashboard Response ───────────────────────────────────────────────

public class UpdateDashboardResponse
{
    public int DashboardId { get; set; }
    public string DashboardName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}

// ─── Toggle Active ───────────────────────────────────────────────────────────

public class ToggleDashboardActiveResponse
{
    public int DashboardId { get; set; }
    public bool IsActive { get; set; }
    public string Message { get; set; } = string.Empty;
}

// ─── Dashboard Detail (with widgets) ─────────────────────────────────────────

public class DashboardDetailResponse
{
    public int DashboardId { get; set; }
    public string DashboardName { get; set; } = string.Empty;
    public int CategoryId { get; set; }
    public string CategoryName { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? ConfigJson { get; set; }
    public bool IsActive { get; set; }
    public int? VersionNo { get; set; }
    public bool IsLatestVersion { get; set; }
}

public class DashboardShareLinkResponse
{
    public int DashboardId { get; set; }
    public string Token { get; set; } = string.Empty;
}

public class ShareDashboardInternallyResponse
{
    public int DashboardId { get; set; }
    public int SharedWithCount { get; set; }
}

// ─── Version History ─────────────────────────────────────────────────────────

public class DashboardVersionSummaryResponse
{
    public int DashboardId { get; set; }
    public int VersionNo { get; set; }
    public string Status { get; set; } = string.Empty;
    public bool IsLatestVersion { get; set; }
    public string? PublishedBy { get; set; }
    public DateTime? ModifiedDate { get; set; }
}

/// <summary>
/// Result of restoring a previous published version.
/// Restore is append-only: the chosen version's content is republished as a NEW version,
/// so the version history is never rewritten.
/// </summary>
public class RestoreDashboardVersionResponse
{
    /// <summary>Id of the newly created version (not the version that was restored from).</summary>
    public int DashboardId { get; set; }

    /// <summary>The version number that was used as the source.</summary>
    public int RestoredFromVersionNo { get; set; }

    /// <summary>The version number created by this restore.</summary>
    public int NewVersionNo { get; set; }

    public string Status { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
}

public class PatchDashboardLayoutResponse
{
    public int DashboardId { get; set; }
    public string Message { get; set; } = string.Empty;
}
