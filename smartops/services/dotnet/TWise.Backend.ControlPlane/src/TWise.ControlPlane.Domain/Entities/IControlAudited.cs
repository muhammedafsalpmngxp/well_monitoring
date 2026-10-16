namespace TWise.Backend.ControlPlane.Domain.Entities;

/// <summary>Implemented by control-plane tables that carry created_at / modified_at.</summary>
public interface IControlAudited
{
    DateTime CreatedAt { get; set; }
    DateTime ModifiedAt { get; set; }
}
