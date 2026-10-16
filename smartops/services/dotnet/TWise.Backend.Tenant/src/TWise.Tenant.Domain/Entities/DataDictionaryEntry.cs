namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// Business documentation for one dataset column, or for the dataset itself when
/// <see cref="ColumnName"/> is null. Maps to [core].[DataDictionary]. The technical columns
/// come from the dataset (imports: columns_json, views: preview columns) and are not stored here.
/// </summary>
public class DataDictionaryEntry
{
    public long Id { get; set; }

    /// <summary>import | view</summary>
    public string DatasetKind { get; set; } = string.Empty;
    public long DatasetId { get; set; }

    /// <summary>Null for the dataset-level entry.</summary>
    public string? ColumnName { get; set; }

    public string? BusinessName { get; set; }
    public string? Description { get; set; }
    public string? Owner { get; set; }

    /// <summary>public | internal | confidential | pii</summary>
    public string Sensitivity { get; set; } = "internal";

    /// <summary>Comma-separated tags.</summary>
    public string? Tags { get; set; }

    public long TenantId { get; set; }
    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public long? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }
}
