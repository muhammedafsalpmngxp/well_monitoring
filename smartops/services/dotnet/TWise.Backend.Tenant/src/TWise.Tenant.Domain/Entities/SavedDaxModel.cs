namespace TWise.Tenant.Domain.Entities;

/// <summary>A named DAX measure saved for reuse, listed on Settings → Dax Model. Maps to [core].[DaxModels].</summary>
public class SavedDaxModel
{
    public long Id { get; set; }
    public string Name { get; set; } = string.Empty;

    /// <summary>Table | View</summary>
    public string SourceType { get; set; } = string.Empty;

    /// <summary>Table or view the expression was written for.</summary>
    public string DataSource { get; set; } = string.Empty;

    /// <summary>Column | Row</summary>
    public string CalculatedBy { get; set; } = string.Empty;

    public string? Operation { get; set; }

    /// <summary>JSON array of the column names picked for the operation.</summary>
    public string? ColumnsJson { get; set; }

    public string Expression { get; set; } = string.Empty;

    /// <summary>Active | Draft</summary>
    public string Status { get; set; } = "Active";

    /// <summary>User who created the model. Each user sees only their own models (admins see all).
    /// Null on models saved before ownership was recorded — only admins see those.</summary>
    public long? CreatedBy { get; set; }

    public bool IsDeleted { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}
