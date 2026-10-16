namespace TWise.Tenant.Domain.Entities;

/// <summary>Stores per-user favourites and recently-viewed records for any control type.</summary>
public class UserPreference
{
    public long PreferenceId   { get; set; }
    public long UserId         { get; set; }

    /// <summary>1=Dashboard  2=Chart  3=Tile  4=Report</summary>
    public int  ControlTypeId  { get; set; }

    /// <summary>PK of the referenced entity (DashboardId / Widget.Id / Report.Id).</summary>
    public long ControlId      { get; set; }

    public bool      IsFavourite  { get; set; } = false;
    public DateTime? LastViewedOn { get; set; }
}
