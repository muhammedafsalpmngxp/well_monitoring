namespace TWise.Backend.ControlPlane.Domain.Entities;

public class TenantSource : IControlAudited, ISoftDeletable
{
    public long TenantSourceId { get; set; }
    public long TenantId { get; set; }
    public int SourceSystemId { get; set; }
    public string? ConnectionRef { get; set; }
    public string? IngestionMode { get; set; }
    public bool IsSystemOfRecord { get; set; }
    public string? Status { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
