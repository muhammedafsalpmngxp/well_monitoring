namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// A single row of parsed data belonging to an ImportedDataset, stored as a JSON
/// object keyed by column name so any imported file's schema is stored consistently.
/// Maps to [core].[ImportedDataRows].
/// </summary>
public class ImportedDataRow
{
    public long Id { get; set; }
    public long DatasetId { get; set; }
    public int RowIndex { get; set; }

    /// <summary>JSON object: {"WellName":"W1","Depth":120}</summary>
    public string DataJson { get; set; } = "{}";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
