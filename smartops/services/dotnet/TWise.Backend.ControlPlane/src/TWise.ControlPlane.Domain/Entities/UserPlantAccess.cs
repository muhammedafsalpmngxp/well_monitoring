namespace TWise.Backend.ControlPlane.Domain.Entities;

public class UserPlantAccess : IControlAudited, ISoftDeletable
{
    public long UserPlantAccessId { get; set; }
    public long UserId { get; set; }
    public int PlantCode { get; set; }
    public bool IsActive { get; set; } = true;
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }

    public AppUser User { get; set; } = null!;
}
