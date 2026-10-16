namespace TWise.Tenant.Domain.Entities;

/// <summary>One row per LLM call, for quota enforcement and cost visibility. Prompts are not stored.</summary>
public class AiUsageLog
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    public string? UserId { get; set; }
    /// <summary>What the call was for: test, ask, chart, summary (set by the caller).</summary>
    public string Purpose { get; set; } = "";
    public string Model { get; set; } = "";
    public int PromptTokens { get; set; }
    public int CompletionTokens { get; set; }
    public int LatencyMs { get; set; }
    public bool Succeeded { get; set; }
    public string? Error { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
