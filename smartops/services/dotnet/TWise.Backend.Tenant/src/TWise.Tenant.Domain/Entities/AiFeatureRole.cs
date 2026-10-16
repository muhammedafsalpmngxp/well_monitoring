namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// One row = "role X may use AI feature Y" for this tenant. Applies to admin roles too.
/// Maps to core.AiFeatureRoles. Feature keys come from AiFeatureCatalog in Application.
/// </summary>
public class AiFeatureRole
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string FeatureKey { get; set; } = "";
    /// <summary>Role code as carried in the JWT role claim, e.g. planner.</summary>
    public string RoleCode { get; set; } = "";
}
