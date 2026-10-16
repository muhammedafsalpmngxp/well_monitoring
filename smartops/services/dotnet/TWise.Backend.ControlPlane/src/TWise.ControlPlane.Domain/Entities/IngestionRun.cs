namespace TWise.Backend.ControlPlane.Domain.Entities;

public class IngestionRun : ISoftDeletable
{
    public long IngestionRunId { get; set; }
    public long TenantSourceId { get; set; }
    public DateTime? StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    public string? Status { get; set; }
    public int? RowsExtracted { get; set; }
    public int? RowsLoaded { get; set; }
    public int? ErrorCount { get; set; }
    public DateTime CreatedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
