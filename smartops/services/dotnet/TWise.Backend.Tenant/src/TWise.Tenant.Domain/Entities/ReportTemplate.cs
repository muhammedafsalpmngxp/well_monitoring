namespace TWise.Tenant.Domain.Entities;

/// <summary>A saved report design (columns, formatting, appearance) for a data source, scoped to the user who created it.</summary>
public class ReportTemplate
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public long CreatedBy { get; set; }
    public string SourceName { get; set; } = string.Empty;

    /// <summary>User-defined display name for this saved chart/report/tile. Mandatory.</summary>
    public string CustomName { get; set; } = string.Empty;

    /// <summary>View or Table</summary>
    public string SourceType { get; set; } = string.Empty;

    /// <summary>JSON blob storing the saved design (same shape as Report.ReportJson, minus data/filters)</summary>
    public string TemplateJson { get; set; } = string.Empty;

    /// <summary>Chart or Report — which builder owns this template, since both call the same API. Null on legacy rows created before this column existed.</summary>
    public string? Type { get; set; }

    public bool? IsActive { get; set; }

    /// <summary>References core.DatabaseViews(id) when SourceType is 'View'; null for Table sources.</summary>
    public long? ViewId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
