namespace TWise.Tenant.Domain.Entities.Delivery;

/// <summary>A named list of addresses that schedules can send to. Maps to [delivery].[MailGroup].</summary>
public class MailGroup
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public long CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; }
    public long? ModifiedBy { get; set; }
    public DateTime ModifiedAt { get; set; }
    public bool IsDeleted { get; set; }

    public List<MailGroupMember> Members { get; set; } = [];
}
