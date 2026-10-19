namespace TWise.Tenant.Domain.Entities;

/// <summary>Tenant-wide AI switches: on/off. Which model to use, and its daily call quota, is an AiProvider row.</summary>
public class AiSettings : BaseEntity
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public bool IsEnabled { get; set; }
    /// <summary>Admin's custom AI instructions as JSON {key: text}; missing keys use the defaults in AiPrompts.</summary>
    public string? PromptsJson { get; set; }
}

/// <summary>
/// One registered LLM endpoint for a tenant. Several can exist; exactly one is active and used by the
/// AI features. The API key is encrypted with the connection-password cipher and never returned.
/// </summary>
public class AiProvider : BaseEntity
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    /// <summary>Display name chosen by the admin, e.g. "OpenAI production" or "Local Ollama".</summary>
    public string Name { get; set; } = "";
    /// <summary>openai | anthropic | azure | ollama | custom. Only changes headers/defaults; all use the OpenAI chat shape.</summary>
    public string Provider { get; set; } = "openai";
    public string BaseUrl { get; set; } = "";
    public string Model { get; set; } = "";
    /// <summary>Optional cheaper model for routing / planning steps (Ask Data). Null = Model.</summary>
    public string? FastModel { get; set; }
    public string? ApiKeyEncrypted { get; set; }
    /// <summary>Max AI calls per tenant per UTC day while this provider is active; 0 = unlimited.</summary>
    public int DailyQuota { get; set; } = 500;
    public bool IsActive { get; set; }
}
