namespace TWise.Tenant.Domain.Entities.Delivery;

/// <summary>
/// One recipient of a schedule. Kind is To, Cc or Bcc. RecipientType is User (Value is the user id), Role (the role
/// code), Group (the mail group id) or Email (the address). Label is what the dialog showed. Maps to [delivery].[ScheduleRecipient].
/// </summary>
public class ScheduleRecipient
{
    public long Id { get; set; }
    public long ScheduleId { get; set; }
    public string Kind { get; set; } = "To";
    public string RecipientType { get; set; } = "Email";
    public string Value { get; set; } = string.Empty;
    public string? Label { get; set; }
}
