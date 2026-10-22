namespace TWise.Tenant.Domain.Entities;

/// <summary>
/// An AI summary of a chart or a dashboard (Explain), kept until the data it summarised changes: the key is a hash of
/// that data, so new data is a new row. Maps to core.AiSummaries.
/// </summary>
public class AiSummary
{
    public long Id { get; set; }
    public long TenantId { get; set; }
    /// <summary>chart | dashboard</summary>
    public string Kind { get; set; } = "";
    /// <summary>SHA-256 (hex) of the title, data and prompt that were summarised.</summary>
    public string PayloadHash { get; set; } = "";
    public string Text { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Last time it was shown (updated at most daily); summaries unused for AiExplain:SummaryUnusedDays are removed.</summary>
    public DateTime UsedAt { get; set; } = DateTime.UtcNow;
}
