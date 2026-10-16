namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// Metadata for a file (CSV/XLSX/XLS/JSON) imported as a chart data source.
/// Maps to [core].[ImportedDatasets]. Actual rows live in ImportedDataRow.
/// </summary>
public class ImportedDataset
{
    public long Id { get; set; }
    public string DatasetName { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;

    /// <summary>csv | xlsx | xls | json</summary>
    public string FileType { get; set; } = string.Empty;

    /// <summary>JSON array: [{"name":"Depth","type":"number"}, ...]</summary>
    public string ColumnsJson { get; set; } = "[]";

    public int RowCount { get; set; }

    /// <summary>pending | processing | completed | failed</summary>
    public string Status { get; set; } = "pending";
    public string? ErrorMessage { get; set; }

    /// <summary>
    /// FK → core.DataSourceConnections.id when this dataset came from a connector.
    /// Null for a plain file upload, which has no source to refresh from — this is what
    /// makes a dataset refreshable at all.
    /// </summary>
    public long? DataSourceConnectionId { get; set; }

    /// <summary>Connector object this dataset was fetched from, replayed on each refresh.</summary>
    public string? SourceObjectRef { get; set; }

    /// <summary>
    /// When this dataset's rows were last replaced by a refresh. Null for a dataset that has
    /// only ever been imported once — the UI falls back to CreatedAt in that case.
    /// </summary>
    public DateTime? LastRefreshedAt { get; set; }

    /// <summary>Outcome of the most recent refresh — see RefreshJobStatuses.</summary>
    public string? LastRefreshStatus { get; set; }

    /// <summary>Job code of the most recent refresh, so the UI can link to its history row.</summary>
    public string? LastRefreshJobCode { get; set; }

    public long TenantId { get; set; }
    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public long? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
    public bool IsDeleted { get; set; }
}
