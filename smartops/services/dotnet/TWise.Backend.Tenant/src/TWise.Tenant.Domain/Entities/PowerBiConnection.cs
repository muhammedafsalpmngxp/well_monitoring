namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// The tenant's Power BI embedding identity ("embed for your customers"): an Azure AD app
/// registration acting as a service principal on one Power BI workspace. One row per tenant.
/// Maps to [core].[PowerBiConnections].
/// </summary>
public class PowerBiConnection
{
    public long Id { get; set; }
    public long TenantId { get; set; }

    /// <summary>Azure AD (Entra) directory id that issues the access token.</summary>
    public string AzureTenantId { get; set; } = string.Empty;

    /// <summary>App registration client id.</summary>
    public string ClientId { get; set; } = string.Empty;

    /// <summary>Client secret, AES-encrypted at rest with ConnectionPasswordHelper. Never returned to clients.</summary>
    public string ClientSecretEncrypted { get; set; } = string.Empty;

    /// <summary>Power BI workspace (group) whose reports are offered for embedding.</summary>
    public string WorkspaceId { get; set; } = string.Empty;

    public long ModifiedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}
