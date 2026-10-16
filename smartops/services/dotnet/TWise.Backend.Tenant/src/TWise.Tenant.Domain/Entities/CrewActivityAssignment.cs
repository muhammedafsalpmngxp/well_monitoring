namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// A crew→activity assignment created from the Activity Breakdown board.
/// Lives in the tenant DB (core schema); the crews/activities it references
/// come from the legacy AppMasterDB (stored as plain key values, no cross-DB FK).
/// Maps to [core].[CrewActivityAssignment].
/// </summary>
public class CrewActivityAssignment : BaseEntity
{
    public long Id { get; set; }

    public string CrewGroupCode { get; set; } = string.Empty;
    public string CrewUid { get; set; } = string.Empty;
    public string? CrewTypeCode { get; set; }

    public string ActivityCode { get; set; } = string.Empty;
    public string ActivityName { get; set; } = string.Empty;
    public string? WellId { get; set; }
    public string? ProjectId { get; set; }

    public DateTime? PlannedStart { get; set; }
    public DateTime? PlannedEnd { get; set; }
    public decimal Progress { get; set; }

    public string Status { get; set; } = "assigned";
}
