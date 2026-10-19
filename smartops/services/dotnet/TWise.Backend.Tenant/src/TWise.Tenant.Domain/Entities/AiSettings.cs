namespace TWise.Tenant.Domain.Entities;

/// <summary>Tenant-wide AI switches: on/off. Which model to use, and its daily call quota, is an AiProvider row.</summary>
public class AiSettings : BaseEntity
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public bool IsEnabled { get; set; }
    /// <summary>No longer used: the AI prompts are in core.AiPrompt. Kept so the column stays mapped.</summary>
    public string? PromptsJson { get; set; }

    // Ask Data: what it may read and its limits (Settings → AI Settings). The lists are JSON arrays; no allowed schemas
    // means Ask Data is not set up and refuses to run.
    public string? AskDataAllowedSchemas { get; set; }
    public string? AskDataExcludedTables { get; set; }
    public string? AskDataExcludedColumns { get; set; }
    public int AskDataMaxRows { get; set; } = 500;
    public int AskDataQueryTimeout { get; set; } = 60;
    public int AskDataMaxQueries { get; set; } = 3;
    public int AskDataSqlRetries { get; set; } = 2;
    public int AskDataVerifyRetries { get; set; } = 1;
    public int AskDataHistoryTurns { get; set; } = 3;
    public string? AskDataOrgName { get; set; }
    public string? AskDataExportPrefix { get; set; }
    /// <summary>deep | normal: how the Ask your data chatbot (side panel) answers. Agents choose their own mode per step.</summary>
    public string AskDataChatMode { get; set; } = "deep";
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
