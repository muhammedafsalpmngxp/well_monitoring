namespace TWise.Backend.ControlPlane.Domain.Entities;

public class CanonicalEntity : IControlAudited, ISoftDeletable
{
    public int CanonicalEntityId { get; set; }
    public string EntityName { get; set; } = default!;
    public int? SchemaVersionId { get; set; }
    public string? Layer { get; set; }
    public string? Description { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
