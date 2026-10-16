namespace TWise.Backend.ControlPlane.Domain.Entities;

public class CanonicalField : IControlAudited, ISoftDeletable
{
    public int CanonicalFieldId { get; set; }
    public int CanonicalEntityId { get; set; }
    public string FieldName { get; set; } = default!;
    public string? DataType { get; set; }
    public bool IsRequired { get; set; }
    public bool IsUnique { get; set; }
    public int? ReferenceEntityId { get; set; }
    public string? Description { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
