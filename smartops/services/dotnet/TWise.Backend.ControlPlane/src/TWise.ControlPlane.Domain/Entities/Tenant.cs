namespace TWise.Backend.ControlPlane.Domain.Entities;

public class Tenant : IControlAudited, ISoftDeletable
{
    public long TenantId { get; set; }
    public string TenantCode { get; set; } = default!;
    public string? TenantName { get; set; }
    public int? RegionId { get; set; }
    public string? IsolationMode { get; set; }
    public string? DataPlaneRef { get; set; }
    public int? SchemaVersionId { get; set; }
    public string? Status { get; set; }
    public string? ProvisionStep { get; set; }
    public int RetryCount { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }
    public DateTime? DeletedAt { get; set; }
}
