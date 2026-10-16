namespace TWise.Backend.ControlPlane.Domain.Entities;

public class SourceSystem : IControlAudited, ISoftDeletable
{
    public int SourceSystemId { get; set; }
    public string SourceCode { get; set; } = default!;
    public string? SourceName { get; set; }
    public string? SourceKind { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
