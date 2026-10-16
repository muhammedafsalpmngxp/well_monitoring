namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// Base entity with common audit columns.
/// All entities must inherit from this.
/// </summary>
public abstract class BaseEntity
{
    public bool IsDeleted { get; set; } = false;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
    public string? CreatedBy { get; set; }
    public string? ModifiedBy { get; set; }
    public string? DeletedBy { get; set; }
}
