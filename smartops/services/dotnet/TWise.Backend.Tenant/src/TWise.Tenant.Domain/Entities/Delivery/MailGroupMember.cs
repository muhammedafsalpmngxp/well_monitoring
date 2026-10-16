namespace TWise.Tenant.Domain.Entities.Delivery;

/// <summary>An address of a mail group. Maps to [delivery].[MailGroupMember].</summary>
public class MailGroupMember
{
    public long Id { get; set; }
    public long MailGroupId { get; set; }
    public string Email { get; set; } = string.Empty;
}
