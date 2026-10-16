namespace TWise.Backend.ControlPlane.Domain.Entities;

/// <summary>Implemented by entities that support soft-delete. Separate from audit concerns.</summary>
public interface ISoftDeletable
{
    bool IsDeleted { get; set; }
    DateTime? DeletedAt { get; set; }
}
